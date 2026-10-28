const test = require('node:test')
const assert = require('node:assert/strict')
const {
  buildImageApiRequest,
  buildNegativePrompt,
  buildXhsImagePrompt,
  detectImageProtocol,
  formatImageApiError,
  normalizeImageSettings,
  parseImageApiResponse,
  resolveImageEndpoint,
  sanitizeImageBrief,
} = require('./image-utils.cjs')

test('sanitizes a partial image brief with safe defaults', () => {
  const brief = sanitizeImageBrief({ coverTitle: ' 周末遛娃新去处 ', style: 'unknown' })
  assert.equal(brief.coverTitle, '周末遛娃新去处')
  assert.equal(brief.style, 'lifestyle')
  assert.match(brief.composition, /标题区域/)
})

test('builds a prompt with exact quoted Chinese copy and xhs layout constraints', () => {
  const prompt = buildXhsImagePrompt({
    coverTitle: '周末遛娃新去处',
    subtitle: '自然探索＋亲子互动',
    style: 'event',
    subject: '亲子家庭在自然营地互动',
    palette: ['草木绿', '暖黄色'],
  })
  assert.match(prompt, /3:4 竖版/)
  assert.match(prompt, /主标题：“周末遛娃新去处”/)
  assert.match(prompt, /副标题：“自然探索＋亲子互动”/)
  assert.match(prompt, /不得改写、增字、漏字/)
})

test('negative prompt includes defaults and project-specific exclusions', () => {
  const prompt = buildNegativePrompt({ mustAvoid: ['红色背景'] })
  assert.match(prompt, /乱码文字/)
  assert.match(prompt, /红色背景/)
})

test('normalizes image settings and clamps candidate count', () => {
  const settings = normalizeImageSettings({ enabled: true, count: 99, promptExtendMode: 'direct' })
  assert.equal(settings.enabled, true)
  assert.equal(settings.protocol, 'dashscope')
  assert.equal(settings.count, 6)
  assert.equal(settings.promptExtendMode, 'direct')
  assert.equal(settings.model, 'qwen-image-3.0-pro')
})

test('resolves a Model Studio workspace domain to the recommended DashScope endpoint', () => {
  const baseUrl = 'https://llm-example.cn-beijing.maas.aliyuncs.com'
  assert.equal(detectImageProtocol(baseUrl), 'dashscope')
  assert.equal(resolveImageEndpoint(baseUrl), `${baseUrl}/api/v1/services/aigc/multimodal-generation/generation`)
  assert.equal(resolveImageEndpoint(`${baseUrl}/api/v1`), `${baseUrl}/api/v1/services/aigc/multimodal-generation/generation`)
  assert.equal(resolveImageEndpoint(`${baseUrl}/api/v1/services/aigc/multimodal-generation/generation`), `${baseUrl}/api/v1/services/aigc/multimodal-generation/generation`)
  assert.equal(resolveImageEndpoint('ftp://example.com'), '')
})

test('keeps OpenAI-compatible image endpoints supported', () => {
  const baseUrl = 'https://llm-example.cn-beijing.maas.aliyuncs.com/compatible-mode/v1'
  assert.equal(detectImageProtocol(baseUrl), 'openai')
  assert.equal(resolveImageEndpoint(baseUrl, 'openai'), `${baseUrl}/images/generations`)
})

test('migrates an old compatible-mode URL to DashScope when the stored protocol is absent', () => {
  const settings = normalizeImageSettings({
    enabled: true,
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen-image-3.0-pro',
  })
  const request = buildImageApiRequest(settings, '宣传图提示词', '乱码', 123)
  assert.equal(settings.protocol, 'dashscope')
  assert.equal(request.protocol, 'dashscope')
  assert.equal(request.endpoint, 'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation')
  assert.deepEqual(request.body.input.messages[0].content, [{ text: '宣传图提示词' }])
})

test('uses OpenAI-compatible request shape only when explicitly selected', () => {
  const settings = normalizeImageSettings({
    enabled: true,
    protocol: 'openai',
    baseUrl: 'https://llm-example.cn-beijing.maas.aliyuncs.com',
    model: 'qwen-image-3.0-pro',
    size: '1080x1440',
    count: 2,
  })
  const request = buildImageApiRequest(settings, '宣传图提示词', '乱码', 123)
  assert.equal(request.protocol, 'openai')
  assert.equal(request.endpoint, 'https://llm-example.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/images/generations')
  assert.equal(request.body.prompt, '宣传图提示词')
  assert.equal(request.body.size, '1080x1440')
  assert.equal(request.body.n, 2)
  assert.equal(request.body.input, undefined)
})

test('builds the nested DashScope request and converts the size separator', () => {
  const settings = normalizeImageSettings({
    enabled: true,
    baseUrl: 'https://llm-example.cn-beijing.maas.aliyuncs.com',
    model: 'qwen-image-3.0-pro',
    size: '1080x1440',
    count: 3,
    promptExtendMode: 'agent',
  })
  const request = buildImageApiRequest(settings, '宣传图提示词', '乱码', 123)
  assert.equal(request.protocol, 'dashscope')
  assert.deepEqual(request.body.input.messages[0].content, [{ text: '宣传图提示词' }])
  assert.equal(request.body.parameters.size, '1080*1440')
  assert.equal(request.body.parameters.n, 3)
  assert.equal(request.body.parameters.negative_prompt, '乱码')
})

test('parses image URLs from DashScope and OpenAI-compatible responses', () => {
  const dashScope = parseImageApiResponse({
    request_id: 'req-1',
    output: { choices: [{ message: { content: [{ image: 'https://example.com/a.png' }] } }] },
    usage: { output_image_count: 1 },
  })
  assert.deepEqual(dashScope.urls, ['https://example.com/a.png'])
  assert.equal(dashScope.requestId, 'req-1')
  const openAi = parseImageApiResponse({ data: [{ url: 'https://example.com/b.png' }] })
  assert.deepEqual(openAi.urls, ['https://example.com/b.png'])
})

test('turns Workspace endpoint denial into an actionable settings error', () => {
  const message = formatImageApiError(
    403,
    JSON.stringify({ request_id: 'req-403', code: 'Endpoint.AccessDenied', message: 'Workspace endpoint access denied.' }),
    'https://llm-example.cn-beijing.maas.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation',
    'qwen-image-3.0-pro',
  )
  assert.match(message, /接口已连接/)
  assert.match(message, /同一业务空间和地域/)
  assert.match(message, /qwen-image-3\.0-pro/)
  assert.match(message, /req-403/)
})
