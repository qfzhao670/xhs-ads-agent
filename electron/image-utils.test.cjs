const test = require('node:test')
const assert = require('node:assert/strict')
const {
  buildImageApiRequest,
  buildNegativePrompt,
  buildRealPosterDecorationNegativePrompt,
  buildRealPosterDecorationPrompt,
  buildReferenceUsePrompt,
  buildXhsImagePrompt,
  detectImageProtocol,
  formatImageApiError,
  inferReferenceVisualMedium,
  normalizeImageSettings,
  parseImageApiResponse,
  resolveImageEndpoint,
  sanitizeImageBrief,
  sanitizeImageReferenceTags,
} = require('./image-utils.cjs')

test('sanitizes a partial image brief with safe defaults', () => {
  const brief = sanitizeImageBrief({ coverTitle: ' 周末遛娃新去处 ', style: 'unknown' })
  assert.equal(brief.coverTitle, '周末遛娃新去处')
  assert.equal(brief.style, 'lifestyle')
  assert.match(brief.composition, /标题区域/)
  assert.equal(brief.visualMode, 'photoreal')
})

test('classifies photographic references and keeps explicit visual metadata', () => {
  assert.equal(inferReferenceVisualMedium({ visualStyle: '自然光纪实摄影，真实校园空间' }), 'photo')
  assert.equal(inferReferenceVisualMedium({ visualStyle: '手绘插画与纸张拼贴' }), 'graphic')
  assert.equal(inferReferenceVisualMedium({ visualStyle: '实拍照片叠加卡片式信息图' }), 'mixed')
  assert.equal(inferReferenceVisualMedium({ visualStyle: '简洁高级视觉' }), 'graphic')
  const tags = sanitizeImageReferenceTags({
    visualMedium: 'photo',
    sceneType: '户外校园',
    photographicElements: ['自然光', '广角空间'],
  })
  assert.equal(tags.visualMedium, 'photo')
  assert.equal(tags.sceneType, '户外校园')
  assert.deepEqual(tags.photographicElements, ['自然光', '广角空间'])
})

test('builds a prompt with exact quoted Chinese copy and xhs layout constraints', () => {
  const prompt = buildXhsImagePrompt({
    coverTitle: '周末遛娃新去处',
    subtitle: '自然探索＋亲子互动',
    style: 'event',
    subject: '亲子家庭在自然营地互动',
    palette: ['草木绿', '暖黄色'],
  }, [{ id: 'XHSIMG-0001', isCover: true, tags: { summary: '留白充足的生活方式封面', visualStyle: '自然摄影' } }])
  assert.match(prompt, /3:4 竖版/)
  assert.match(prompt, /主标题：“周末遛娃新去处”/)
  assert.match(prompt, /副标题：“自然探索＋亲子互动”/)
  assert.match(prompt, /不得改写、增字、漏字/)
  assert.match(prompt, /第三方小红书视觉样本/)
  assert.match(prompt, /严禁照搬其中的人物身份、商品、品牌/)
  assert.match(prompt, /视觉媒介（最高优先级）/)
  assert.match(prompt, /全幅写实摄影场景/)
  assert.match(prompt, /禁止改成手绘插画/)
})

test('describes reference images as visual few-shot samples instead of factual inputs', () => {
  const prompt = buildReferenceUsePrompt([
    { id: 'XHSIMG-0007', isCover: false, tags: { summary: '卡片式攻略页', composition: '三段式信息层级', textLayout: '左对齐粗标题' } },
  ])
  assert.match(prompt, /few-shot 设计参考/)
  assert.match(prompt, /XHSIMG-0007/)
  assert.match(prompt, /唯一内容依据/)
})

test('preserves photographic reference cues instead of flattening them into illustration', () => {
  const prompt = buildReferenceUsePrompt([
    { id: 'XHSIMG-0012', isCover: true, tags: { visualMedium: 'photo', summary: '校园实景封面', sceneType: '户外校园', photographicElements: ['自然侧光', '广角建筑空间'] } },
  ])
  assert.match(prompt, /摄影实景/)
  assert.match(prompt, /实景线索：户外校园、自然侧光、广角建筑空间/)
  assert.match(prompt, /而不是把它重新解释成手绘/)
})

test('builds distinct content-page prompts with suite continuity', () => {
  const prompt = buildXhsImagePrompt({
    pageRole: 'content',
    pageLabel: '费用拆解',
    purpose: '解释费用包含项目',
    coverTitle: '费用怎么组成',
    subtitle: '逐项看清更放心',
    visualContinuity: '藏蓝与白色，统一细线表格和圆角编号',
  })
  assert.match(prompt, /内容信息页/)
  assert.match(prompt, /不能重复封面内容/)
  assert.match(prompt, /套图统一规范：藏蓝与白色/)
  assert.match(prompt, /翻页阅读时信息层级清楚/)
})

test('negative prompt includes defaults and project-specific exclusions', () => {
  const prompt = buildNegativePrompt({ mustAvoid: ['红色背景'] })
  assert.match(prompt, /乱码文字/)
  assert.match(prompt, /红色背景/)
  assert.match(prompt, /纯插画/)
  assert.match(prompt, /纸张拼贴/)
})

test('builds a single-collage decoration prompt with exact copy and protected visual centers', () => {
  const prompt = buildRealPosterDecorationPrompt({
    label: '封面',
    title: '周末去看一场鹤舞',
    subtitle: '在真实现场遇见非遗',
    purpose: '突出现场体验',
    accentColor: '#c94135',
  })
  assert.match(prompt, /图1是一张用户已经完成选图、裁切、排序和版式设计的.*实拍拼图底图/)
  assert.match(prompt, /图1为唯一图片输入/)
  assert.match(prompt, /不参考任何其他图片/)
  assert.match(prompt, /不可重绘、不可篡改/)
  assert.match(prompt, /拼图结构、图片顺序、槽位尺寸、裁切范围、分隔线和全部摄影像素不变/)
  assert.match(prompt, /至少约 90% 的画布区域应直接呈现图1/)
  assert.match(prompt, /每个槽位的视觉重心/)
  assert.match(prompt, /标题与装饰必须优先落在真实留白、画面边缘或拼图分隔线附近/)
  assert.match(prompt, /不能只放置标题和一块标题底板/)
  assert.match(prompt, /至少包含以下三层/)
  assert.match(prompt, /结构层/)
  assert.match(prompt, /细节层/)
  assert.match(prompt, /新增装饰合计建议控制在画面约 5%–10%/)
  assert.match(prompt, /禁止只生成“大标题＋单一色块”的简陋结果/)
  assert.match(prompt, /主标题：“周末去看一场鹤舞”/)
  assert.match(prompt, /副标题：“在真实现场遇见非遗”/)
  assert.match(prompt, /最终只返回完成的宣传图 PNG/)
  const negative = buildRealPosterDecorationNegativePrompt()
  assert.match(negative, /重绘拼图底图/)
  assert.match(negative, /重排图片/)
  assert.match(negative, /拼图缩成卡片/)
  assert.match(negative, /遮挡视觉重心/)
  assert.match(negative, /只有标题没有其他装饰/)
  assert.match(negative, /密集碎元素/)
})

test('mixed visual mode requires a real-scene base without banning editorial overlays', () => {
  const prompt = buildXhsImagePrompt({
    pageRole: 'content',
    coverTitle: '三步看懂流程',
    style: 'guide',
    visualMode: 'mixed',
  })
  assert.match(prompt, /真实摄影或高写实场景作为至少 60%/)
  assert.match(prompt, /实景不是装饰性小照片/)
  const negative = buildNegativePrompt({ style: 'guide', visualMode: 'mixed' })
  assert.match(negative, /无实景底图/)
  assert.doesNotMatch(negative, /纯插画/)
})

test('normalizes image settings and forces one image per page', () => {
  const settings = normalizeImageSettings({ enabled: true, count: 99, promptExtendMode: 'agent' })
  assert.equal(settings.enabled, true)
  assert.equal(settings.protocol, 'dashscope')
  assert.equal(settings.baseUrl, 'https://dashscope.aliyuncs.com/compatible-mode/v1')
  assert.equal(settings.count, 1)
  assert.equal(settings.promptExtendMode, 'direct')
  assert.equal(settings.model, 'qwen-image-3.0-pro')
  assert.equal(settings.size, '1080x1440')
  assert.equal(settings.enableThinking, false)
  assert.equal(settings.watermark, false)
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
  const request = buildImageApiRequest(settings, '宣传图提示词', '乱码', 123, ['data:image/png;base64,AAA'])
  assert.equal(settings.protocol, 'dashscope')
  assert.equal(request.protocol, 'dashscope')
  assert.equal(request.endpoint, 'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation')
  assert.deepEqual(request.body.input.messages[0].content, [{ image: 'data:image/png;base64,AAA' }, { text: '宣传图提示词' }])
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
  const request = buildImageApiRequest(settings, '宣传图提示词', '乱码', 123, ['data:image/png;base64,AAA', 'data:image/jpeg;base64,BBB'])
  assert.equal(request.protocol, 'openai')
  assert.equal(request.endpoint, 'https://llm-example.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/images/generations')
  assert.equal(request.body.prompt, '宣传图提示词')
  assert.equal(request.body.size, '1080x1440')
  assert.equal(request.body.n, 1)
  assert.deepEqual(request.body.image, ['data:image/png;base64,AAA', 'data:image/jpeg;base64,BBB'])
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
  const request = buildImageApiRequest(settings, '宣传图提示词', '乱码', 123, ['data:image/png;base64,AAA'])
  assert.equal(request.protocol, 'dashscope')
  assert.deepEqual(request.body.input.messages[0].content, [{ image: 'data:image/png;base64,AAA' }, { text: '宣传图提示词' }])
  assert.equal(request.body.parameters.size, '1080*1440')
  assert.equal(request.body.parameters.n, 1)
  assert.equal(request.body.parameters.negative_prompt, '乱码')
  assert.equal(request.body.parameters.prompt_extend_mode, 'direct')
})

test('refuses to construct a text-to-image request without references', () => {
  const settings = normalizeImageSettings({ enabled: true, model: 'qwen-image-3.0-pro' })
  assert.throws(() => buildImageApiRequest(settings, '提示词', '乱码', 123), /缺少参考图片/)
})

test('limits qwen image 3.0 to three ordered reference images', () => {
  const settings = normalizeImageSettings({ enabled: true, model: 'qwen-image-3.0-pro' })
  const request = buildImageApiRequest(settings, '提示词', '乱码', 123, ['1', '2', '3', '4'])
  assert.deepEqual(request.body.input.messages[0].content, [{ image: '1' }, { image: '2' }, { image: '3' }, { text: '提示词' }])
})

test('omits unsupported negative prompts for qwen image 2.1 single-collage editing', () => {
  const settings = normalizeImageSettings({ enabled: true, model: 'qwen-image-2.1-pro' })
  const request = buildImageApiRequest(settings, '在拼图上叠加装饰', '重绘拼图底图', 123, ['collage'])
  assert.equal(request.body.parameters.negative_prompt, undefined)
  assert.deepEqual(request.body.input.messages[0].content, [{ image: 'collage' }, { text: '在拼图上叠加装饰' }])
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
