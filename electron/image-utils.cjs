const STYLE_DESCRIPTIONS = {
  lifestyle: '真实生活方式分享，像高质量用户实拍，明亮自然光，轻商业感，亲近可信',
  event: '活动招募封面，人物有参与感，场景有行动氛围，标题醒目但不使用廉价促销元素',
  product: '商业产品摄影，产品为唯一视觉主角，材质真实，背景干净，有自然使用场景',
  guide: '攻略清单封面，卡片式信息层级，少量简洁图形，画面清爽且易于扫读',
  editorial: '现代中文杂志封面，大图与克制留白，高级配色，排版清晰，有编辑设计感',
}

const VISUAL_MODE_DESCRIPTIONS = {
  photoreal: '以全幅写实摄影场景为主画面，真实空间、自然光线、可信材质和生活化瞬间，文字只作为克制的编辑叠加层',
  mixed: '以真实摄影或高写实场景作为至少 60% 的视觉底图，再叠加少量信息卡片、标题和识别元素',
  graphic: '以信息设计、插画、静物拼贴或图形排版为主，适合必须清晰解释结构的信息页',
}

const DEFAULT_IMAGE_SETTINGS = {
  enabled: true,
  protocol: 'dashscope',
  baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  apiKey: '',
  model: 'qwen-image-3.0-pro',
  size: '1080x1440',
  count: 1,
  promptExtendMode: 'direct',
  enableThinking: false,
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
  const pageRole = ['cover', 'content', 'summary'].includes(value.pageRole) ? value.pageRole : 'cover'
  const defaultVisualMode = ['lifestyle', 'event', 'product'].includes(style) ? 'photoreal' : 'mixed'
  const visualMode = VISUAL_MODE_DESCRIPTIONS[value.visualMode] ? value.visualMode : defaultVisualMode
  return {
    purpose: text(value.purpose, pageRole === 'cover' ? '小红书图文笔记首图' : '小红书图文笔记内容页'),
    pageRole,
    pageLabel: text(value.pageLabel, pageRole === 'cover' ? '封面' : pageRole === 'summary' ? '收束页' : '内容页'),
    coverTitle: text(value.coverTitle, fallbackTitle).slice(0, 30),
    subtitle: text(value.subtitle).slice(0, 40),
    style,
    visualMode,
    subject: text(value.subject, '围绕本篇内容主题的真实主体与使用场景'),
    scene: text(value.scene, '明亮自然光下的真实生活场景'),
    composition: text(value.composition, '主体位于画面下半部或右侧，上方或左上保留干净标题区域'),
    palette: list(value.palette, 4),
    mood: text(value.mood, '真实、轻松、可信、有分享感'),
    mustShow: list(value.mustShow),
    mustAvoid: list(value.mustAvoid),
    visualContinuity: text(value.visualContinuity),
    extraNotes: text(value.extraNotes),
  }
}

function inferReferenceVisualMedium(value = {}) {
  const declared = text(value.visualMedium).toLowerCase()
  if (['photo', 'mixed', 'graphic'].includes(declared)) return declared
  const searchable = [
    value.summary, value.visualStyle, value.composition,
    ...(Array.isArray(value.keyElements) ? value.keyElements : []),
    ...(Array.isArray(value.keywords) ? value.keywords : []),
  ].map((item) => text(item)).join(' ')
  const hasPhoto = /(实拍|摄影|照片|写真|真人|纪实|街拍|旅拍|自然光|景深|镜头|真实场景|室内实景|户外实景|建筑实景|风景)/i.test(searchable)
  const hasGraphic = /(插画|手绘|拼贴|剪贴|信息图|扁平|卡片式|纸张|海报设计|纯排版|3D渲染)/i.test(searchable)
  if (hasPhoto && hasGraphic) return 'mixed'
  if (hasPhoto) return 'photo'
  if (hasGraphic) return 'graphic'
  return 'graphic'
}

function sanitizeImageReferenceTags(value = {}) {
  return {
    summary: text(value.summary, '待补充图片描述').slice(0, 240),
    visualMedium: inferReferenceVisualMedium(value),
    sceneType: text(value.sceneType).slice(0, 120),
    photographicElements: list(value.photographicElements, 8),
    useCases: list(value.useCases, 6),
    visualStyle: text(value.visualStyle).slice(0, 160),
    composition: text(value.composition).slice(0, 200),
    textLayout: text(value.textLayout).slice(0, 160),
    colorPalette: list(value.colorPalette, 6),
    keyElements: list(value.keyElements, 8),
    keywords: list(value.keywords, 10),
    avoidCopying: list(value.avoidCopying, 8),
  }
}

function buildReferenceUsePrompt(references = []) {
  if (!references.length) throw new Error('图生图必须至少提供一张参考图片')
  const descriptions = references.map((reference, index) => {
    const tags = sanitizeImageReferenceTags(reference.tags)
    const medium = tags.visualMedium === 'photo' ? '摄影实景' : tags.visualMedium === 'mixed' ? '实景与设计混合' : '纯图形/插画'
    const photographicDetails = [tags.sceneType, ...tags.photographicElements].filter(Boolean).join('、')
    return `图${index + 1}（${reference.isCover ? '封面样本' : '内容页样本'}，${reference.id || '未编号'}，${medium}）：${tags.summary}；可借鉴：${[tags.visualStyle, tags.composition, tags.textLayout].filter(Boolean).join('；') || '整体视觉表达'}${photographicDetails ? `；实景线索：${photographicDetails}` : ''}`
  }).join('\n')
  return `【参考图使用规则】
输入的图1至图${references.length}均为第三方小红书视觉样本，只是 few-shot 设计参考，不是本篇内容素材。
只能借鉴它们的版式结构、构图方法、配色关系、字体气质、留白、材质与视觉节奏；严禁照搬其中的人物身份、商品、品牌、Logo、文字、地点、价格、数据、活动权益或任何业务事实。
当样本标注为“摄影实景”或“实景与设计混合”时，应重点借鉴其摄影媒介、空间层次、自然光、镜头视角和真实材质，而不是把它重新解释成手绘、纸张拼贴或扁平插画。
输出图必须以本篇提供的真实事实、标题和画面要求为唯一内容依据。若参考图内容与本篇事实冲突，必须完全舍弃参考图内容。
${descriptions}`
}

function buildXhsImagePrompt(rawBrief, references = []) {
  const brief = sanitizeImageBrief(rawBrief)
  const style = STYLE_DESCRIPTIONS[brief.style]
  const visualMode = VISUAL_MODE_DESCRIPTIONS[brief.visualMode]
  const exactText = [
    `主标题：“${brief.coverTitle}”`,
    brief.subtitle ? `副标题：“${brief.subtitle}”` : '',
  ].filter(Boolean).join('\n')
  const palette = brief.palette.length ? brief.palette.join('、') : '自然协调、明亮但不过度饱和的配色'
  const mustShow = brief.mustShow.length ? brief.mustShow.join('、') : '清晰的核心主体'
  const mustAvoid = [...new Set([...brief.mustAvoid, '虚构奖项或认证', '随机品牌 Logo'])].join('、')
  const isCover = brief.pageRole === 'cover'
  const pageKind = isCover ? '首图封面' : brief.pageRole === 'summary' ? '结尾收束页' : '内容信息页'

  const referenceRules = references.length ? `${buildReferenceUsePrompt(references)}\n\n` : ''
  return `${referenceRules}【任务】
生成一张适合小红书图文笔记的 3:4 竖版${pageKind}。本页用途：${brief.purpose}。它属于一套连续配图，需要承担独立的信息职责，不能重复封面内容。画面应像真实、有品质的内容分享，不要做成传统电商促销海报。

【画面主体】
${brief.subject}
主体明确，占画面约 55%–65%，第一眼即可识别。人物肢体自然，产品或场景结构真实。

【场景与氛围】
${brief.scene}
整体氛围：${brief.mood}。

【视觉媒介（最高优先级）】
本页采用“${brief.visualMode}”模式：${visualMode}。
${brief.visualMode === 'photoreal' ? '必须让真实场景从画面边缘延伸到边缘，以摄影级光影、空间透视、景深和材质细节构成视觉主体；禁止改成手绘插画、复古纸张拼贴、剪贴画或满版信息卡。' : brief.visualMode === 'mixed' ? '必须先完成可信的实景底图，再在不遮挡主体的区域叠加少量编辑设计；实景不是装饰性小照片，也不能被卡片和纸张元素吞没。' : '优先保证信息结构清楚，但仍需使用可信材质、光影与空间关系，避免廉价模板感。'}
这里的实景可以是根据已确认事实生成的写实视觉表达，不声称是活动现场纪录或证明材料；不得因此添加未经证实的具体人物身份、地点细节、品牌或事件。

【版式构图】
3:4 竖版，小红书${pageKind}构图。${brief.composition}。标题不得遮挡人物面部或产品主体，四周保留约 8% 安全边距，${isCover ? '缩略图状态下主体和标题仍然清晰' : '翻页阅读时信息层级清楚、重点一眼可扫读'}。

【需要准确呈现的文字】
画面中只允许出现以下简体中文：
${exactText}
主标题使用醒目的中文粗体、大字号，最多两行；副标题明显小于主标题。必须逐字准确，不得改写、增字、漏字或生成其他文字。不得出现随机英文、乱码、价格、电话号码、二维码或虚构 Logo。

【视觉风格】
${style}。主辅色：${palette}。画面应有专业摄影或高质量编辑设计的完成度：曝光自然，主体边缘清晰，空间层次丰富，材质可信，避免一眼可见的 AI 塑料感。画面精致、有点击吸引力，同时保留真实分享感。
${brief.visualContinuity ? `套图统一规范：${brief.visualContinuity}。必须沿用统一的色彩、字体气质、边距和视觉符号，但本页构图不得照搬其他页面。` : ''}

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
    '重复肢体', '产品变形', 'AI塑料质感', '假景深', '过度HDR',
    ...(brief.visualMode === 'photoreal' ? ['纯插画', '手绘画风', '纸张拼贴', '剪贴画', '扁平信息图占满画面', '摄影主体被卡片遮挡'] : []),
    ...(brief.visualMode === 'mixed' ? ['无实景底图', '实景仅为装饰性小图', '满版纸张拼贴'] : []),
    ...brief.mustAvoid,
  ])].join('，')
}

function normalizeImageSettings(value = {}) {
  return {
    enabled: value.enabled !== false,
    protocol: value.protocol === 'openai' ? 'openai' : 'dashscope',
    baseUrl: text(value.baseUrl, DEFAULT_IMAGE_SETTINGS.baseUrl),
    apiKey: text(value.apiKey),
    model: text(value.model, DEFAULT_IMAGE_SETTINGS.model),
    size: /^\d+x\d+$/.test(text(value.size)) ? text(value.size) : DEFAULT_IMAGE_SETTINGS.size,
    // 套图中的每一页都有独立提示词。单次接口调用固定只生成一张，避免产生近似候选图。
    count: 1,
    // Qwen Image I2I 不支持 agent 提示词增强，图生图链路固定使用 direct。
    promptExtendMode: 'direct',
    enableThinking: value.enableThinking === true,
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

function buildImageApiRequest(settings, prompt, negativePrompt, seed, referenceImages = []) {
  if (!Array.isArray(referenceImages) || !referenceImages.length) throw new Error('图生图请求缺少参考图片')
  const maximum = /^qwen-image-2\.1/i.test(settings.model) ? 10 : 3
  const images = referenceImages.slice(0, maximum)
  const protocol = settings.protocol === 'openai' ? 'openai' : 'dashscope'
  const common = {
    prompt_extend: true,
    prompt_extend_mode: 'direct',
    enable_thinking: settings.enableThinking,
    negative_prompt: negativePrompt,
    seed,
    watermark: settings.watermark,
  }
  if (protocol === 'openai') {
    return {
      protocol,
      endpoint: resolveImageEndpoint(settings.baseUrl, protocol),
      body: { model: settings.model, prompt, image: images.length === 1 ? images[0] : images, size: settings.size, n: 1, ...common },
    }
  }
  return {
    protocol,
    endpoint: resolveImageEndpoint(settings.baseUrl, protocol),
    body: {
      model: settings.model,
      input: { messages: [{ role: 'user', content: [...images.map((image) => ({ image })), { text: prompt }] }] },
      parameters: { ...common, n: 1, size: settings.size.replace('x', '*') },
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
  VISUAL_MODE_DESCRIPTIONS,
  buildImageApiRequest,
  buildNegativePrompt,
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
}
