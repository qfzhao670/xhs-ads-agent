const STYLE_DESCRIPTIONS = {
  lifestyle: '真实生活方式分享，像高质量用户实拍，明亮自然光，轻商业感，亲近可信',
  event: '活动招募封面，人物有参与感，场景有行动氛围，标题醒目但不使用廉价促销元素',
  product: '商业产品摄影，产品为唯一视觉主角，材质真实，背景干净，有自然使用场景',
  guide: '攻略清单封面，卡片式信息层级，少量简洁图形，画面清爽且易于扫读',
  editorial: '现代中文杂志封面，大图与克制留白，高级配色，排版清晰，有编辑设计感',
}

const DEFAULT_IMAGE_SETTINGS = {
  enabled: false,
  protocol: 'dashscope',
  baseUrl: '',
  apiKey: '',
  model: 'qwen-image-3.0-pro',
  size: '1080x1440',
  count: 3,
  promptExtendMode: 'agent',
  enableThinking: true,
  watermark: false,
}

function text(value, fallback = '') {
  const normalized = String(value ?? '').trim()
  return normalized || fallback
}

function list(value, limit = 6) {
  return Array.isArray(value) ? value.map((item) => text(item)).filter(Boolean).slice(0, limit) : []
}

function sanitizeImageBrief(value = {}, fallbackTitle = '') {
  const style = STYLE_DESCRIPTIONS[value.style] ? value.style : 'lifestyle'
  return {
    purpose: text(value.purpose, '小红书图文笔记首图'),
    coverTitle: text(value.coverTitle, fallbackTitle).slice(0, 30),
    subtitle: text(value.subtitle).slice(0, 40),
    style,
    subject: text(value.subject, '围绕本篇内容主题的真实主体与使用场景'),
    scene: text(value.scene, '明亮自然光下的真实生活场景'),
    composition: text(value.composition, '主体位于画面下半部或右侧，上方或左上保留干净标题区域'),
    palette: list(value.palette, 4),
    mood: text(value.mood, '真实、轻松、可信、有分享感'),
    mustShow: list(value.mustShow),
    mustAvoid: list(value.mustAvoid),
    extraNotes: text(value.extraNotes),
  }
}

function buildXhsImagePrompt(rawBrief) {
  const brief = sanitizeImageBrief(rawBrief)
  const style = STYLE_DESCRIPTIONS[brief.style]
  const exactText = [
    `主标题：“${brief.coverTitle}”`,
    brief.subtitle ? `副标题：“${brief.subtitle}”` : '',
  ].filter(Boolean).join('\n')
  const palette = brief.palette.length ? brief.palette.join('、') : '自然协调、明亮但不过度饱和的配色'
  const mustShow = brief.mustShow.length ? brief.mustShow.join('、') : '清晰的核心主体'
  const mustAvoid = [...new Set([...brief.mustAvoid, '虚构奖项或认证', '随机品牌 Logo'])].join('、')

  return `【任务】
生成一张适合小红书${brief.purpose}的 3:4 竖版宣传封面。画面需要有传播吸引力，但应像真实、有品质的内容分享，不要做成传统电商促销海报。

【画面主体】
${brief.subject}
主体明确，占画面约 55%–65%，第一眼即可识别。人物肢体自然，产品或场景结构真实。

【场景与氛围】
${brief.scene}
整体氛围：${brief.mood}。

【版式构图】
3:4 竖版，小红书首图构图。${brief.composition}。标题不得遮挡人物面部或产品主体，四周保留约 8% 安全边距，缩略图状态下主体和标题仍然清晰。

【需要准确呈现的文字】
画面中只允许出现以下简体中文：
${exactText}
主标题使用醒目的中文粗体、大字号，最多两行；副标题明显小于主标题。必须逐字准确，不得改写、增字、漏字或生成其他文字。不得出现随机英文、乱码、价格、电话号码、二维码或虚构 Logo。

【视觉风格】
${style}。主辅色：${palette}。有自然光和真实材质，画面精致、有点击吸引力，同时保留真实分享感。

【必须呈现】
${mustShow}。

【真实性和宣传边界】
只呈现已提供的事实，不得虚构奖项、认证、销量、功效、用户评价或活动权益。

【额外要求】
${brief.extraNotes || '无。'}

【禁止事项】
${mustAvoid}。避免画面拥挤、文字过多、随机贴纸、乱码、额外人物、重复肢体、异常手指、面部变形、产品变形、低清晰度、廉价电商风、过度磨皮和强烈人工合成感。`
}

function buildNegativePrompt(rawBrief) {
  const brief = sanitizeImageBrief(rawBrief)
  return [...new Set([
    '乱码文字', '随机英文', '额外文字', '二维码', '电话号码', '价格标签', '水印',
    '虚构Logo', '廉价电商海报', '画面拥挤', '低清晰度', '人物变形', '异常手指',
    '重复肢体', '产品变形', ...brief.mustAvoid,
  ])].join('，')
}

function normalizeImageSettings(value = {}) {
  const count = Number.parseInt(value.count, 10)
  return {
    enabled: Boolean(value.enabled),
    protocol: value.protocol === 'openai' ? 'openai' : 'dashscope',
    baseUrl: text(value.baseUrl),
    apiKey: text(value.apiKey),
    model: text(value.model, DEFAULT_IMAGE_SETTINGS.model),
    size: /^\d+x\d+$/.test(text(value.size)) ? text(value.size) : DEFAULT_IMAGE_SETTINGS.size,
    count: Number.isInteger(count) ? Math.min(6, Math.max(1, count)) : DEFAULT_IMAGE_SETTINGS.count,
    promptExtendMode: value.promptExtendMode === 'direct' ? 'direct' : 'agent',
    enableThinking: value.enableThinking !== false,
    watermark: Boolean(value.watermark),
  }
}

function detectImageProtocol(baseUrl) {
  const value = text(baseUrl).toLowerCase()
  return value.includes('/compatible-mode/') || value.endsWith('/images/generations') ? 'openai' : 'dashscope'
}

function resolveImageEndpoint(baseUrl, requestedProtocol) {
  const trimmed = text(baseUrl).replace(/\/+$/, '')
  if (!trimmed) return ''
  const protocol = requestedProtocol || detectImageProtocol(trimmed)
  let parsed
  try { parsed = new URL(trimmed) } catch { return '' }
  if (!['http:', 'https:'].includes(parsed.protocol)) return ''
  const origin = parsed.origin
  const pathname = parsed.pathname.replace(/\/+$/, '')
  if (protocol === 'openai') {
    if (pathname.endsWith('/images/generations')) return `${origin}${pathname}`
    if (pathname.endsWith('/compatible-mode/v1')) return `${origin}${pathname}/images/generations`
    return `${origin}/compatible-mode/v1/images/generations`
  }
  if (pathname.endsWith('/multimodal-generation/generation')) return `${origin}${pathname}`
  return `${origin}/api/v1/services/aigc/multimodal-generation/generation`
}

function buildImageApiRequest(settings, prompt, negativePrompt, seed) {
  const protocol = settings.protocol === 'openai' ? 'openai' : 'dashscope'
  const common = {
    prompt_extend: true,
    prompt_extend_mode: settings.promptExtendMode,
    enable_thinking: settings.enableThinking,
    negative_prompt: negativePrompt,
    seed,
    watermark: settings.watermark,
  }
  if (protocol === 'openai') {
    return {
      protocol,
      endpoint: resolveImageEndpoint(settings.baseUrl, protocol),
      body: { model: settings.model, prompt, size: settings.size, n: settings.count, ...common },
    }
  }
  return {
    protocol,
    endpoint: resolveImageEndpoint(settings.baseUrl, protocol),
    body: {
      model: settings.model,
      input: { messages: [{ role: 'user', content: [{ text: prompt }] }] },
      parameters: { ...common, n: settings.count, size: settings.size.replace('x', '*') },
    },
  }
}

function parseImageApiResponse(data) {
  const openAiUrls = Array.isArray(data?.data) ? data.data.map((item) => item?.url).filter(Boolean) : []
  const dashScopeUrls = Array.isArray(data?.output?.choices)
    ? data.output.choices.flatMap((choice) => Array.isArray(choice?.message?.content)
      ? choice.message.content.map((item) => item?.image).filter(Boolean)
      : [])
    : []
  return {
    urls: openAiUrls.length ? openAiUrls : dashScopeUrls,
    requestId: text(data?.request_id),
    usage: data?.usage || {},
  }
}

function formatImageApiError(status, rawBody, endpoint, model) {
  let data = {}
  try { data = JSON.parse(rawBody) } catch { /* Preserve non-JSON error bodies below. */ }
  const code = text(data?.code || data?.error?.code)
  const message = text(data?.message || data?.error?.message)
  const requestId = text(data?.request_id || data?.error?.request_id)
  const requestSuffix = requestId ? `（Request ID：${requestId}）` : ''
  let host = ''
  try { host = new URL(endpoint).hostname } catch { /* Endpoint validation happens before the request. */ }

  if (status === 403 && code === 'Endpoint.AccessDenied') {
    return `图片接口已连接，但 Workspace 拒绝了当前 API Key（${host}）。请确认图片 API Key 与域名中的 Workspace 属于同一业务空间和地域，并已获 ${model} 调用权限${requestSuffix}`
  }
  if (status === 403 && code === 'Workspace.AccessDenied') {
    return `当前图片 API Key 无权访问这个 Workspace（${host}）。请更换该业务空间所属的 API Key，或为当前账号授予业务空间权限${requestSuffix}`
  }
  if (status === 403 && code === 'Model.AccessDenied') {
    return `当前图片 API Key 没有 ${model} 的调用权限。请在百炼 API Key 权限中授权该模型${requestSuffix}`
  }
  if (status === 401) {
    return `图片 API Key 鉴权失败。请确认 API Key、接口地域和 Workspace 完全匹配${requestSuffix}`
  }
  const detail = [code, message].filter(Boolean).join('：') || rawBody.slice(0, 500)
  return `图片模型接口返回 ${status}（${endpoint}）：${detail}`
}

module.exports = {
  DEFAULT_IMAGE_SETTINGS,
  STYLE_DESCRIPTIONS,
  buildImageApiRequest,
  buildNegativePrompt,
  buildXhsImagePrompt,
  detectImageProtocol,
  formatImageApiError,
  normalizeImageSettings,
  parseImageApiResponse,
  resolveImageEndpoint,
  sanitizeImageBrief,
}
