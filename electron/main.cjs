const { app, BrowserWindow, clipboard, dialog, ipcMain, nativeImage } = require('electron')
const crypto = require('node:crypto')
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const path = require('node:path')
const {
  assetMarkdownTables,
  createAssetExportXlsx,
  createTemplateXlsx,
  normalizeAsset,
  readXlsxRows,
  rowsToAssets,
} = require('./asset-utils.cjs')
const {
  DEFAULT_IMAGE_SETTINGS,
  buildImageApiRequest,
  buildNegativePrompt,
  buildRealPosterDecorationNegativePrompt,
  buildRealPosterDecorationPrompt,
  buildXhsImagePrompt,
  formatImageApiError,
  normalizeImageSettings,
  parseImageApiResponse,
  sanitizeImageBrief,
  sanitizeImageReferenceTags,
} = require('./image-utils.cjs')
const {
  createImageReferencePackage,
  imageHash,
  readImageReferencePackage,
} = require('./image-reference-package.cjs')
const {
  buildMaterialExtractionMessages,
  normalizeExtractedMarkdown,
  validateMaterialFiles,
} = require('./material-extraction.cjs')
const {
  sanitizeRealPhotoTags,
  sanitizeRealPosterPlan,
} = require('./real-photo-utils.cjs')
const {
  createRealPhotoPackage,
  readRealPhotoPackage,
} = require('./real-photo-package.cjs')

const MARKER = '小红书运营工坊.json'
const DATA_DIR = '项目数据'
const OUTPUT_DIR = '生成结果'
const IMAGE_TASKS_FILE = '配图记录.json'
const IMAGE_REFERENCES_FILE = '小红书图片参考库.json'
const IMAGE_REFERENCES_DIR = '小红书图片参考库'
const REAL_PHOTOS_FILE = '业务实拍图库.json'
const REAL_PHOTOS_DIR = '业务实拍图库'
const GENERATION_CONFIG_FILE = '生成配置.json'
const FINAL_CONTENTS_FILE = '终稿内容库.json'
let currentRoot = ''

const assetFiles = {
  keywords: '关键词库.json',
  references: '高表现参考文案库.json',
  rules: '合规性准则.json',
}
const idPrefixes = { keywords: 'KW', references: 'REF', rules: 'RULE' }

function now() { return new Date().toISOString() }
function dataPath(name) { return path.join(currentRoot, DATA_DIR, name) }
function outputPath(name) { return path.join(currentRoot, OUTPUT_DIR, name) }
async function exists(file) { try { await fsp.access(file); return true } catch { return false } }
async function readJson(file, fallback) {
  try { return JSON.parse(await fsp.readFile(file, 'utf8')) } catch { return fallback }
}
async function writeJson(file, value) {
  await fsp.mkdir(path.dirname(file), { recursive: true })
  const temporary = `${file}.tmp`
  await fsp.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  await fsp.rename(temporary, file)
}
async function readMeta(root = currentRoot) { return readJson(path.join(root, MARKER), null) }
async function writeMeta(meta) {
  meta.updatedAt = now()
  await writeJson(path.join(currentRoot, MARKER), meta)
}
function normalizeContentMode(value) { return value === 'explicit' || value === 'native' ? value : '' }
function normalizeGenerationConfig(value = {}) {
  return {
    mode: normalizeContentMode(value.mode),
    userBriefRaw: String(value.userBriefRaw || '').trim(),
    updatedAt: String(value.updatedAt || ''),
  }
}
function normalizedText(value) {
  return String(value || '').normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase()
}
function finalTextHash(title, body, hashtags = []) {
  return crypto.createHash('sha256').update(normalizedText(`${title}\n${body}\n${hashtags.join(' ')}`)).digest('hex')
}
function normalizeFinalContent(value = {}) {
  return {
    ...value,
    id: String(value.id || ''),
    mode: normalizeContentMode(value.mode) || 'explicit',
    status: value.status === 'removed' ? 'removed' : 'archived',
    title: String(value.title || ''),
    body: String(value.body || ''),
    hashtags: Array.isArray(value.hashtags) ? value.hashtags.map(String) : [],
    strategySnapshot: value.strategySnapshot && typeof value.strategySnapshot === 'object' ? value.strategySnapshot : {},
    userInstructionsRaw: Array.isArray(value.userInstructionsRaw) ? value.userInstructionsRaw.map(String) : [],
    factIds: Array.isArray(value.factIds) ? value.factIds.map(String) : [],
    referenceIds: Array.isArray(value.referenceIds) ? value.referenceIds.map(String) : [],
    imagePaths: Array.isArray(value.imagePaths) ? value.imagePaths.map(String) : [],
    textHash: String(value.textHash || finalTextHash(value.title, value.body, value.hashtags)),
    duplicateOverride: Boolean(value.duplicateOverride),
  }
}
function cleanName(folder) { return path.basename(folder).trim() || '未命名项目' }
function applicationIconPath() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'icon.png')
    : path.join(__dirname, '..', 'build', 'icon.png')
}

function normalizeImageReference(value = {}) {
  return {
    ...value,
    id: String(value.id || ''),
    originalName: String(value.originalName || ''),
    relativePath: String(value.relativePath || ''),
    isCover: Boolean(value.isCover),
    enabled: value.enabled !== false,
    taggingStatus: ['ready', 'failed', 'pending'].includes(value.taggingStatus) ? value.taggingStatus : value.tags ? 'ready' : 'pending',
    taggingError: String(value.taggingError || ''),
    tags: sanitizeImageReferenceTags(value.tags),
  }
}

function normalizeRealPhoto(value = {}) {
  return {
    ...value,
    id: String(value.id || ''),
    originalName: String(value.originalName || ''),
    relativePath: String(value.relativePath || ''),
    width: Number(value.width) || 0,
    height: Number(value.height) || 0,
    enabled: value.enabled !== false,
    taggingStatus: ['ready', 'failed', 'pending'].includes(value.taggingStatus) ? value.taggingStatus : value.tags ? 'ready' : 'pending',
    taggingError: String(value.taggingError || ''),
    tags: sanitizeRealPhotoTags(value.tags),
  }
}

async function loadProject() {
  if (!currentRoot) return null
  const meta = await readMeta()
  if (!meta) return null
  const materialFile = path.join(currentRoot, '业务原始素材.md')
  const materialExists = await exists(materialFile)
  const keywords = (await readJson(dataPath(assetFiles.keywords), [])).map((item) => normalizeAsset('keywords', item))
  const references = (await readJson(dataPath(assetFiles.references), [])).map((item) => normalizeAsset('references', item))
  const rules = (await readJson(dataPath(assetFiles.rules), [])).map((item) => normalizeAsset('rules', item))
  const imageReferences = (await readJson(dataPath(IMAGE_REFERENCES_FILE), [])).map(normalizeImageReference)
  const realPhotos = (await readJson(dataPath(REAL_PHOTOS_FILE), [])).map(normalizeRealPhoto)
  const finalContents = (await readJson(dataPath(FINAL_CONTENTS_FILE), [])).map(normalizeFinalContent)
  const facts = await readJson(outputPath('业务事实.json'), null)
  const generationConfig = normalizeGenerationConfig(await readJson(outputPath(GENERATION_CONFIG_FILE), {}))
  const strategies = await readJson(outputPath('策略候选.json'), [])
  const selection = await readJson(outputPath('策略选择.json'), { selectedStrategyIds: [], selectedStrategyId: '', strategyAdvice: {}, advice: '' })
  const drafts = await readJson(outputPath('终稿版本.json'), [])
  const imageTasks = (await readJson(outputPath(IMAGE_TASKS_FILE), [])).map(normalizeImageTask)
  const generationHistory = (await readJson(outputPath('生成记录.json'), [])).map((record) => ({
    ...record,
    imageTasks: Array.isArray(record.imageTasks) ? record.imageTasks.map(normalizeImageTask) : [],
  }))
  const currentGeneration = await readJson(outputPath('当前生成.json'), { id: 'GEN-0001', createdAt: meta.createdAt })
  return {
    meta: { name: meta.name, root: currentRoot, createdAt: meta.createdAt, updatedAt: meta.updatedAt },
    material: {
      exists: materialExists,
      name: materialExists ? '业务原始素材.md' : '',
      content: materialExists ? await fsp.readFile(materialFile, 'utf8') : '',
    },
    keywords, references, rules, imageReferences, realPhotos, finalContents, facts, generationConfig, strategies,
    selectedStrategyIds: Array.isArray(selection.selectedStrategyIds)
      ? selection.selectedStrategyIds
      : selection.selectedStrategyId ? [selection.selectedStrategyId] : [],
    selectedStrategyId: selection.selectedStrategyId || selection.selectedStrategyIds?.[0] || '',
    strategyAdvice: selection.strategyAdvice && typeof selection.strategyAdvice === 'object'
      ? selection.strategyAdvice
      : selection.selectedStrategyId && selection.advice ? { [selection.selectedStrategyId]: selection.advice } : {},
    advice: selection.advice || '',
    drafts, imageTasks,
    currentDraft: drafts.length ? drafts[drafts.length - 1] : null,
    currentGeneration,
    generationHistory,
  }
}

async function userConfig() {
  const file = path.join(app.getPath('userData'), 'settings.json')
  const stored = await readJson(file, {})
  return {
    file,
    value: {
      baseUrl: String(stored.baseUrl || 'https://api.openai.com/v1'),
      apiKey: String(stored.apiKey || ''),
      model: String(stored.model || ''),
      visionModel: String(stored.visionModel || stored.model || ''),
      image: normalizeImageSettings({ ...DEFAULT_IMAGE_SETTINGS, ...(stored.image || {}) }),
    },
  }
}
async function recentProjects() {
  const file = path.join(app.getPath('userData'), 'recent-projects.json')
  const list = await readJson(file, [])
  const valid = []
  for (const folder of list) if (await exists(path.join(folder, MARKER))) valid.push(folder)
  if (valid.length !== list.length) await writeJson(file, valid)
  return valid
}
async function addRecent(folder) {
  const file = path.join(app.getPath('userData'), 'recent-projects.json')
  const list = await recentProjects()
  await writeJson(file, [folder, ...list.filter((item) => item !== folder)].slice(0, 8))
}

function responseText(data) {
  const content = data?.choices?.[0]?.message?.content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) return content.map((part) => part.text || '').join('')
  throw new Error('模型没有返回可读取的内容')
}
function parseModelJson(text) {
  const stripped = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  try { return JSON.parse(stripped) } catch {
    const start = Math.min(...['{', '['].map((char) => stripped.indexOf(char)).filter((i) => i >= 0))
    const lastObject = stripped.lastIndexOf('}')
    const lastArray = stripped.lastIndexOf(']')
    const end = Math.max(lastObject, lastArray)
    if (Number.isFinite(start) && end > start) return JSON.parse(stripped.slice(start, end + 1))
    throw new Error('模型返回的内容不是有效 JSON，请重试')
  }
}
function contentText(content) {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) return content.map((part) => part.text || part.content || '').join('')
  return ''
}
function streamDelta(data) {
  const delta = data?.choices?.[0]?.delta || {}
  return {
    content: contentText(delta.content),
    thinking: contentText(delta.reasoning_content || delta.reasoning || delta.thinking),
  }
}
function responseThinking(data) {
  const message = data?.choices?.[0]?.message || {}
  return contentText(message.reasoning_content || message.reasoning || message.thinking)
}
async function readChatCompletionText(response, onChunk, emptyMessage) {
  const contentType = response.headers.get('content-type') || ''
  if (contentType.includes('application/json')) {
    const data = await response.json()
    const text = responseText(data)
    const reasoning = responseThinking(data)
    if (reasoning) onChunk('thinking', reasoning)
    if (text) onChunk('content', text)
    if (!text) throw new Error(emptyMessage)
    return text
  }
  if (!response.body) throw new Error('模型接口未返回可读取的流')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let fullText = ''
  const consume = (line) => {
    const value = line.trim()
    if (!value.startsWith('data:')) return
    const payload = value.slice(5).trim()
    if (!payload || payload === '[DONE]') return
    try {
      const delta = streamDelta(JSON.parse(payload))
      if (delta.thinking) onChunk('thinking', delta.thinking)
      if (delta.content) { fullText += delta.content; onChunk('content', delta.content) }
    } catch { /* Ignore malformed keep-alive events. */ }
  }
  while (true) {
    const { done, value: chunk } = await reader.read()
    buffer += decoder.decode(chunk || new Uint8Array(), { stream: !done })
    const lines = buffer.split(/\r?\n/)
    buffer = lines.pop() || ''
    lines.forEach(consume)
    if (done) break
  }
  if (buffer) consume(buffer)
  if (!fullText) throw new Error(emptyMessage)
  return fullText
}
async function callModel(system, user, onChunk = () => {}, thinking = false) {
  const { value } = await userConfig()
  if (!value.apiKey || !value.model || !value.baseUrl) throw new Error('请先在“模型设置”中填写接口地址、API Key 和模型名称')
  let endpoint = value.baseUrl.replace(/\/+$/, '')
  if (!endpoint.endsWith('/chat/completions')) endpoint += '/chat/completions'
  let response
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${value.apiKey}` },
      body: JSON.stringify({ model: value.model, temperature: 0.45, stream: true, response_format: { type: 'json_object' }, enable_thinking: Boolean(thinking), messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }),
    })
  } catch (error) { throw new Error(`无法连接模型接口：${error.message}`) }
  if (!response.ok) {
    const body = await response.text()
    throw new Error(`模型接口返回 ${response.status}：${body.slice(0, 300)}`)
  }
  return parseModelJson(await readChatCompletionText(response, onChunk, '模型流式返回中没有可读取的内容'))
}

function imageMime(file) {
  const extension = path.extname(file).toLowerCase()
  return extension === '.jpg' || extension === '.jpeg' ? 'image/jpeg'
    : extension === '.webp' ? 'image/webp'
      : extension === '.gif' ? 'image/gif'
        : extension === '.bmp' ? 'image/bmp'
          : extension === '.tif' || extension === '.tiff' ? 'image/tiff'
            : 'image/png'
}

async function imageDataUrl(file) {
  const buffer = await fsp.readFile(file)
  if (!buffer.length) throw new Error('参考图片文件为空')
  if (buffer.length > 10 * 1024 * 1024) throw new Error('参考图片超过 10MB，无法发送给模型')
  return `data:${imageMime(file)};base64,${buffer.toString('base64')}`
}

async function callVisionTagger(reference) {
  const { value } = await userConfig()
  if (!value.apiKey || !value.visionModel || !value.baseUrl) throw new Error('请先在“模型设置”中配置支持图片理解的视觉打标模型')
  let endpoint = value.baseUrl.replace(/\/+$/, '')
  if (!endpoint.endsWith('/chat/completions')) endpoint += '/chat/completions'
  const source = await imageDataUrl(resolveProjectFile(reference.relativePath))
  const role = reference.isCover ? '小红书封面（首图）' : '小红书内容页'
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 120_000)
  let response
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${value.apiKey}` },
      signal: controller.signal,
      body: JSON.stringify({
        model: value.visionModel,
        temperature: 0.2,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: '你是小红书视觉样本分析器。只输出合法 JSON。你的任务是描述可复用的视觉方法，不得把样本中的人物、品牌或业务信息当作未来内容事实。' },
          { role: 'user', content: [
            { type: 'text', text: `这张图片由用户标注为“${role}”。请分析它适合被哪些小红书选题和页面职责参考，以及可复用的视觉结构。必须判断它的主视觉媒介：photo=摄影实景为主，mixed=实景与排版/插画混合，graphic=纯插画、拼贴或信息设计。若含实景，具体描述空间类型、光线、镜头感、人物或物件与环境关系，方便后续优先召回真实场景。不要评价业务真实性，不要抄录长段原文。输出：{"summary":"一句话描述这幅图适合参考的场景","visualMedium":"photo|mixed|graphic","sceneType":"室内/户外/城市/校园/自然/产品场景等，没有则留空","photographicElements":["自然光、广角空间、人物互动等实景要素"],"useCases":["适用场景"],"visualStyle":"视觉风格与质感","composition":"构图和视觉动线","textLayout":"标题与信息排版方式","colorPalette":["主要颜色"],"keyElements":["关键视觉元素"],"keywords":["检索关键词"],"avoidCopying":["不能照搬的具体内容"]}` },
            { type: 'image_url', image_url: { url: source } },
          ] },
        ],
      }),
    })
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('视觉打标超过 2 分钟，请检查模型是否支持图片理解后重试')
    throw new Error(`无法连接视觉打标模型：${error.message}`)
  } finally { clearTimeout(timeout) }
  if (!response.ok) {
    const body = await response.text()
    throw new Error(`视觉打标模型返回 ${response.status}：${body.slice(0, 400)}`)
  }
  return sanitizeImageReferenceTags(parseModelJson(responseText(await response.json())))
}

async function callRealPhotoTagger(photo, materialText) {
  const { value } = await userConfig()
  if (!value.apiKey || !value.visionModel || !value.baseUrl) throw new Error('请先在“模型设置”中配置支持图片理解的视觉模型')
  let endpoint = value.baseUrl.replace(/\/+$/, '')
  if (!endpoint.endsWith('/chat/completions')) endpoint += '/chat/completions'
  const source = await imageDataUrl(resolveProjectFile(photo.relativePath))
  const material = String(materialText || '').slice(0, 16_000)
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 120_000)
  let response
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${value.apiKey}` },
      signal: controller.signal,
      body: JSON.stringify({
        model: value.visionModel,
        temperature: 0.15,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: '你是严谨的实拍图片客观打标器。只描述图片真实可见或可辨认的内容，不判断图片与业务、产品或文案是否相关，不把推测写成事实，只输出合法 JSON。' },
          { role: 'user', content: [
            { type: 'text', text: `业务原始素材中的用词参考：\n${material || '未提供'}\n\n请只为这张实拍图片生成客观、可复用的视觉标签。上面的业务素材只能用于统一已经能从画面确认的名词，不能据此推断活动名称、产品、地点、人物身份、效果或图片与业务的关系。originalDescription、themeTags、sceneTags、subjectTags、actionTags 都只能来自画面可见内容；看不清的文字不要猜。visualTags.subjectPosition 使用 left/center/right 与 top/center/bottom 的组合；textSafeArea 只能是 top、bottom、left、right、none。输出：{"originalDescription":"图片可见内容描述","visibleText":["画面中可确认的短文字"],"themeTags":["可见主题"],"sceneTags":["场景"],"subjectTags":["主体"],"actionTags":["动作"],"visualTags":{"orientation":"landscape|portrait|square","shotScale":"远景/中景/近景/特写","subjectPosition":"center","dominantColors":["颜色"],"quality":"high|medium|low","textSafeArea":"top|bottom|left|right|none"}}` },
            { type: 'image_url', image_url: { url: source } },
          ] },
        ],
      }),
    })
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('实拍图片分析超过 2 分钟，请重试')
    throw new Error(`无法连接视觉模型：${error.message}`)
  } finally { clearTimeout(timeout) }
  if (!response.ok) {
    const body = await response.text()
    throw new Error(`视觉模型返回 ${response.status}：${body.slice(0, 400)}`)
  }
  return sanitizeRealPhotoTags(parseModelJson(responseText(await response.json())))
}

async function callImageModel(brief, references) {
  const { value } = await userConfig()
  const settings = value.image
  if (!settings.enabled) throw new Error('请先在“设置 → 图片模型”中启用图片生成功能')
  if (!settings.apiKey || !settings.model || !settings.baseUrl) throw new Error('请完整填写图片模型的接口地址、API Key 和模型名称')
  if (!Array.isArray(references) || !references.length) throw new Error('没有可用的参考图片。请先到“素材管理 → 小红书图片”上传并完成打标')
  const usableReferences = references.slice(0, /^qwen-image-2\.1/i.test(settings.model) ? 10 : 3)
  const prompt = buildXhsImagePrompt(brief, usableReferences)
  const negativePrompt = buildNegativePrompt(brief)
  const seed = crypto.randomInt(0, 2147483647)
  const referenceImages = await Promise.all(usableReferences.map((reference) => imageDataUrl(resolveProjectFile(reference.relativePath))))
  const request = buildImageApiRequest(settings, prompt, negativePrompt, seed, referenceImages)
  if (!request.endpoint) throw new Error('图片模型接口地址不是有效的 HTTP(S) URL')
  const requestHost = new URL(request.endpoint).hostname
  if (request.protocol === 'openai' && ['dashscope.aliyuncs.com', 'dashscope-intl.aliyuncs.com'].includes(requestHost)) {
    throw new Error('Qwen Image 的 OpenAI 兼容方式需要百炼 Workspace 专属域名；请改填 llm-….maas.aliyuncs.com，或选择 DashScope 同步协议')
  }
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 600_000)
  let response
  try {
    response = await fetch(request.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${settings.apiKey}` },
      signal: controller.signal,
      body: JSON.stringify(request.body),
    })
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('图片生成超过 10 分钟，已停止等待；请稍后重试')
    throw new Error(`无法连接图片模型接口：${error.message}`)
  } finally { clearTimeout(timeout) }
  if (!response.ok) {
    const body = await response.text()
    throw new Error(formatImageApiError(response.status, body, request.endpoint, settings.model))
  }
  const data = await response.json()
  const parsed = parseImageApiResponse(data)
  if (!parsed.urls.length) throw new Error(`图片模型没有返回可下载的图片地址：${JSON.stringify(data).slice(0, 500)}`)
  return {
    urls: parsed.urls,
    prompt,
    negativePrompt,
    seed,
    requestId: parsed.requestId || response.headers.get('x-request-id') || '',
    usage: parsed.usage,
    referenceImageIds: usableReferences.map((reference) => reference.id),
    settings: { model: settings.model, size: settings.size, count: settings.count },
  }
}

function validateRealPosterBaseDataUrl(value) {
  const match = String(value || '').match(/^data:image\/png;base64,([A-Za-z0-9+/=]+)$/)
  if (!match) throw new Error('无文字拼图格式不正确')
  const buffer = Buffer.from(match[1], 'base64')
  if (!buffer.length || buffer.length > 30 * 1024 * 1024) throw new Error('无文字拼图为空或超过 30MB')
  const image = nativeImage.createFromBuffer(buffer)
  const size = image.getSize()
  if (image.isEmpty() || size.width !== 1080 || size.height !== 1440) throw new Error('无文字拼图必须是 1080×1440 的 PNG 图片')
  return `data:image/png;base64,${buffer.toString('base64')}`
}

async function callRealPosterDecorationModel(page, baseDataUrl) {
  const { value } = await userConfig()
  const settings = value.image
  if (!settings.enabled) throw new Error('请先在“设置 → 图片模型”中启用图片生成功能')
  if (!settings.apiKey || !settings.model || !settings.baseUrl) throw new Error('请完整填写图片模型的接口地址、API Key 和模型名称')
  const prompt = buildRealPosterDecorationPrompt(page)
  const negativePrompt = buildRealPosterDecorationNegativePrompt()
  const seed = crypto.randomInt(0, 2147483647)
  const referenceImages = [validateRealPosterBaseDataUrl(baseDataUrl)]
  const requestSettings = { ...settings, size: '1080x1440', count: 1, promptExtendMode: 'direct' }
  const request = buildImageApiRequest(requestSettings, prompt, negativePrompt, seed, referenceImages)
  if (!request.endpoint) throw new Error('图片模型接口地址不是有效的 HTTP(S) URL')
  const requestHost = new URL(request.endpoint).hostname
  if (request.protocol === 'openai' && ['dashscope.aliyuncs.com', 'dashscope-intl.aliyuncs.com'].includes(requestHost)) {
    throw new Error('Qwen Image 的 OpenAI 兼容方式需要百炼 Workspace 专属域名；请改填 llm-….maas.aliyuncs.com，或选择 DashScope 同步协议')
  }
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 600_000)
  let response
  try {
    response = await fetch(request.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${settings.apiKey}` },
      signal: controller.signal,
      body: JSON.stringify(request.body),
    })
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('AI 装饰生成超过 10 分钟，已停止等待；请稍后重试')
    throw new Error(`无法连接图片模型接口：${error.message}`)
  } finally { clearTimeout(timeout) }
  if (!response.ok) {
    const body = await response.text()
    throw new Error(formatImageApiError(response.status, body, request.endpoint, settings.model))
  }
  const data = await response.json()
  const parsed = parseImageApiResponse(data)
  if (!parsed.urls.length) throw new Error(`图片模型没有返回 AI 装饰成片：${JSON.stringify(data).slice(0, 500)}`)
  return {
    url: parsed.urls[0], prompt, negativePrompt, seed,
    requestId: parsed.requestId || response.headers.get('x-request-id') || '',
    referenceImageIds: [],
    model: settings.model,
  }
}

function projectRelative(file) { return path.relative(currentRoot, file).split(path.sep).join('/') }
function resolveProjectFile(relativeFile) {
  const absolute = path.resolve(currentRoot, String(relativeFile || ''))
  const rootPrefix = `${path.resolve(currentRoot)}${path.sep}`
  if (!absolute.startsWith(rootPrefix)) throw new Error('无效的项目文件路径')
  return absolute
}
async function writeBuffer(file, buffer) {
  await fsp.mkdir(path.dirname(file), { recursive: true })
  const temporary = `${file}.tmp`
  await fsp.writeFile(temporary, buffer)
  await fsp.rename(temporary, file)
}
async function downloadGeneratedImage(url, file) {
  const parsed = new URL(url)
  if (!['https:', 'http:'].includes(parsed.protocol)) throw new Error('图片模型返回了不支持的下载地址')
  const response = await fetch(parsed)
  if (!response.ok) throw new Error(`下载生成图片失败：HTTP ${response.status}`)
  const contentType = response.headers.get('content-type') || ''
  if (contentType && !contentType.startsWith('image/') && contentType !== 'application/octet-stream') throw new Error('图片模型返回的文件格式不正确')
  const buffer = Buffer.from(await response.arrayBuffer())
  if (!buffer.length) throw new Error('下载到的生成图片为空')
  if (buffer.length > 30 * 1024 * 1024) throw new Error('生成图片超过 30MB，已停止保存')
  await writeBuffer(file, buffer)
  return buffer
}
async function saveImageTasks(tasks) { await writeJson(outputPath(IMAGE_TASKS_FILE), tasks) }
async function saveImageTaskArtifacts(task) {
  const folder = resolveProjectFile(task.artifactDir)
  await fsp.mkdir(folder, { recursive: true })
  if (task.plan) await writeJson(path.join(folder, 'plan.json'), task.plan)
  if (task.brief) await writeJson(path.join(folder, 'brief.json'), task.brief)
  const currentPrompts = task.plan?.pages?.map((page) => {
    const imageId = task.currentImageIds?.[page.id]
    const image = task.images?.find((item) => item.id === imageId)
    return `# ${page.label || page.id}\n\n${image?.prompt || ''}`
  }).join('\n\n') || task.prompt || ''
  await fsp.writeFile(path.join(folder, 'prompt.txt'), `${currentPrompts}\n`, 'utf8')
  await fsp.writeFile(path.join(folder, 'negative-prompt.txt'), `${task.negativePrompt || ''}\n`, 'utf8')
  await writeJson(path.join(folder, 'metadata.json'), {
    id: task.id,
    generationId: task.generationId,
    strategyId: task.strategyId,
    draftVersion: task.draftVersion,
    selectedImageId: task.selectedImageId,
    currentImageIds: task.currentImageIds || {},
    images: task.images,
    referenceImageIds: [...new Set(task.plan?.pages?.flatMap((page) => page.referenceImageIds || []) || [])],
    sourcePhotoIds: [...new Set(task.plan?.pages?.flatMap((page) => page.sourcePhotoIds || []) || [])],
    updatedAt: task.updatedAt,
  })
}

function normalizeImageTask(value = {}) {
  const images = Array.isArray(value.images) ? value.images : []
  if (value.mode === 'real_photo_poster' && Array.isArray(value.plan?.pages)) {
    const pages = value.plan.pages.map((page, index) => ({
      ...page,
      id: String(page.id || `REAL-PAGE-${String(index + 1).padStart(2, '0')}`),
      role: index === 0 ? 'cover' : 'content',
      label: String(page.label || (index === 0 ? '封面' : `内容页 ${index}`)),
      title: String(page.title || ''),
      subtitle: String(page.subtitle || ''),
      sourcePhotoIds: Array.isArray(page.sourcePhotoIds) ? page.sourcePhotoIds.map(String).slice(0, 4) : [],
      referenceImageIds: [],
    }))
    const normalizedImages = images.map((image) => ({ ...image, pageId: image.pageId || pages[0]?.id || '' }))
    const currentImageIds = { ...(value.currentImageIds || {}) }
    for (const page of pages) {
      if (!currentImageIds[page.id]) currentImageIds[page.id] = normalizedImages.filter((image) => image.pageId === page.id).at(-1)?.id || ''
    }
    return { ...value, mode: 'real_photo_poster', plan: { ...value.plan, pages }, images: normalizedImages, currentImageIds }
  }
  if (Array.isArray(value.plan?.pages) && value.plan.pages.length) {
    const pages = value.plan.pages.map((page, index) => {
      const role = index === 0 ? 'cover' : page.role === 'summary' ? 'summary' : 'content'
      const id = String(page.id || `PAGE-${String(index + 1).padStart(2, '0')}`)
      return {
        ...page,
        id,
        role,
        label: String(page.label || (role === 'cover' ? '封面' : role === 'summary' ? '收束页' : `内容页 ${index}`)),
        referenceImageIds: Array.isArray(page.referenceImageIds) ? page.referenceImageIds.map(String).slice(0, 3) : [],
        brief: sanitizeImageBrief({ ...(page.brief || page), pageRole: role, pageLabel: page.label, visualContinuity: value.plan.visualContinuity }),
      }
    })
    const normalizedImages = images.map((image) => ({ ...image, pageId: image.pageId || pages[0].id }))
    const currentImageIds = { ...(value.currentImageIds || {}) }
    for (const page of pages) {
      if (!currentImageIds[page.id]) currentImageIds[page.id] = normalizedImages.filter((image) => image.pageId === page.id).at(-1)?.id || ''
    }
    return { ...value, plan: { ...value.plan, pages }, images: normalizedImages, currentImageIds }
  }

  // 兼容旧版“多张候选封面”记录：保留已选封面，并把它迁移成一页套图。
  const pageId = 'PAGE-01'
  const brief = sanitizeImageBrief({ ...(value.brief || {}), pageRole: 'cover', pageLabel: '封面' })
  const normalizedImages = images.map((image) => ({ ...image, pageId: image.pageId || pageId }))
  const currentId = value.selectedImageId || normalizedImages.at(-1)?.id || ''
  return {
    ...value,
    images: normalizedImages,
    currentImageIds: { [pageId]: currentId },
    plan: {
      version: 2,
      concept: '旧版封面记录',
      visualContinuity: brief.visualContinuity || '',
      pages: [{ id: pageId, role: 'cover', label: '封面', purpose: brief.purpose, title: brief.coverTitle, referenceImageIds: [], brief }],
    },
  }
}

function sanitizeImagePlan(value, draft, imageReferences) {
  const rawPages = Array.isArray(value?.pages) ? value.pages.slice(0, 6) : []
  if (rawPages.length < 4) throw new Error('图片策划没有形成完整套图，请重试')
  const enabledReferences = imageReferences.filter((item) => item.enabled !== false && item.taggingStatus === 'ready')
  const validIds = new Set(enabledReferences.map((item) => item.id))
  if (!validIds.size) throw new Error('没有已完成打标的参考图片，请先在素材管理中上传图片')
  const visualContinuity = String(value.visualContinuity || value.visualSystem || '').trim()
  let pages = rawPages.map((page, index) => {
    const role = index === 0 ? 'cover' : index === rawPages.length - 1 && page.role === 'summary' ? 'summary' : 'content'
    const id = `PAGE-${String(index + 1).padStart(2, '0')}`
    const label = String(page.label || (role === 'cover' ? '封面' : role === 'summary' ? '收束页' : `内容页 ${index}`)).trim()
    const brief = sanitizeImageBrief({
      ...(page.brief || page),
      pageRole: role,
      pageLabel: label,
      purpose: page.purpose,
      visualContinuity,
    }, index === 0 ? draft.title : label)
    const referenceImageIds = [...new Set((Array.isArray(page.referenceImageIds) ? page.referenceImageIds : []).map(String).filter((referenceId) => validIds.has(referenceId)))].slice(0, 3)
    if (!referenceImageIds.length) throw new Error(`${label}没有选择有效参考图，请重新生成图片策划`)
    return { id, role, label, purpose: brief.purpose, title: brief.coverTitle, referenceImageIds, brief }
  })
  const photographicReferences = enabledReferences.filter((reference) => ['photo', 'mixed'].includes(reference.tags?.visualMedium))
  if (photographicReferences.length) {
    const targetCount = Math.min(3, Math.max(2, Math.floor(pages.length / 2)))
    const preferredIndexes = [...new Set([
      ...pages.map((page, index) => ['lifestyle', 'event', 'product'].includes(page.brief.style) ? index : -1),
      0,
      ...pages.map((page, index) => page.role !== 'summary' ? index : -1),
    ].filter((index) => index >= 0))].slice(0, targetCount)
    pages = pages.map((page, index) => {
      if (!preferredIndexes.includes(index)) return page
      const selectedPhotographic = page.referenceImageIds
        .map((id) => photographicReferences.find((reference) => reference.id === id))
        .find(Boolean)
      const roleMatched = photographicReferences.find((reference) => reference.isCover === (page.role === 'cover'))
      const photographicReference = selectedPhotographic || roleMatched || photographicReferences[0]
      const referenceImageIds = [...new Set([photographicReference.id, ...page.referenceImageIds])].slice(0, 3)
      const visualMode = ['lifestyle', 'event', 'product'].includes(page.brief.style) ? 'photoreal' : 'mixed'
      return { ...page, referenceImageIds, brief: { ...page.brief, visualMode } }
    })
  }
  return {
    version: 3,
    concept: String(value.concept || '围绕本篇文案形成连贯视觉叙事').trim(),
    visualContinuity,
    pages,
  }
}

async function createImagePlan(project, draft, onChunk = () => {}) {
  const strategy = project.strategies.find((item) => item.id === draft.strategyId)
  const rules = project.rules.filter((item) => item.enabled !== false)
  const enabledImageReferences = project.imageReferences.filter((item) => item.enabled !== false && item.taggingStatus === 'ready')
  if (!enabledImageReferences.length) throw new Error('请先到“素材管理 → 小红书图片”上传至少一张优秀样本，并等待自动打标完成')
  const referenceCatalog = enabledImageReferences.map((item) => ({ id: item.id, isCover: item.isCover, tags: item.tags }))
  const prompt = `请为以下已确认的小红书图文笔记策划一套完整配图，不是同一张封面的多个候选。

要求：
1. 根据内容选择 4–6 张 3:4 竖图；第 1 张必须是吸引点击的封面，其余每张分别承接正文中的不同信息，不得重复封面。
2. 整套图形成清楚的翻页叙事：封面点题 → 核心信息/过程/细节/证据 → 总结或行动提示。不要为了凑数量重复同一卖点。
3. 所有页面保持统一的配色、字体气质、边距和识别元素，但构图与画面主体必须有明显变化。
4. 用户不会编辑专业参数，因此你要直接做出完整设计判断。每页只保留一个短标题和一个可选副标题，避免密集小字。
5. 不要把 4–6 页全部做成插画、纸张拼贴、信息卡片或物件静物。只要参考库中存在 visualMedium=photo 或 mixed 的样本，就必须让整套图中至少 2 页、6 页套图中至少 3 页使用真实摄影感场景：全幅实景或以实景为主的编辑排版。封面、人物/活动/空间/过程/体验类页面优先采用实景；只有清单、费用拆解、流程图等确实需要解释结构的页面才优先用纯信息设计。
6. 可以让图片模型根据已确认事实绘制写实场景，不需要素材库提供本项目现场照片。写实场景是视觉表达，不得冒充纪实证据，也不得凭空增加具体人物身份、未确认地点细节、行程、价格、权益、资质、奖项或效果。
7. visualMode 只能从 photoreal、mixed、graphic 中选择：photoreal=全幅摄影级实景，mixed=至少 60% 实景底图加少量编辑排版，graphic=纯信息设计/插画。style 只能从 lifestyle、event、product、guide、editorial 中选择。palette、mustShow、mustAvoid 是简短字符串数组。
8. 你必须只根据下方“参考图片文字标签”判断每一页最适合参考哪些样本，并为每页填写 1–3 个 referenceImageIds。实景页必须优先选择 visualMedium=photo 或 mixed 的样本，并将它放在 referenceImageIds 第一位；封面优先选择 isCover=true，内容页优先选择 isCover=false；相关性比数量重要。
9. 参考样本只用于借鉴版式、构图、配色、字体气质、摄影媒介、光线和视觉节奏。不得把样本中的人物、商品、品牌、文字、地点或业务信息写进页面策划。页面内容只能来自本篇业务事实与文案。
10. 配图只表达这篇已确认文案实际采用的选题，不得因为项目业务事实很多，就在图片中补回文案没有使用的产品总纲、价格、流程或权益。生活化种草的封面优先表达生活问题、场景或情绪，不默认制作产品海报。

业务事实：${JSON.stringify(project.facts)}
内容模式：${project.generationConfig.mode || strategy?.mode || 'explicit'}
选定策略：${JSON.stringify(strategy)}
已确认文案：${JSON.stringify(draft)}
合规准则：${JSON.stringify(rules)}
参考图片文字标签：${JSON.stringify(referenceCatalog)}

只输出 JSON 对象：{"concept":"整套图的叙事概念","visualContinuity":"整套图统一的颜色、排版、材质和识别元素","pages":[{"role":"cover","label":"封面","purpose":"本页承担的职责","referenceImageIds":["XHSIMG-0001"],"coverTitle":"短标题","subtitle":"可选短副标题","style":"editorial","visualMode":"photoreal","subject":"具体画面主体","scene":"具体空间、动作、自然光线、镜头视角和道具","composition":"构图与信息层级","palette":["颜色1","颜色2"],"mood":"氛围","mustShow":["必须出现"],"mustAvoid":["不得出现"],"extraNotes":"必要补充"}]}`
  const result = await callModel(modelSystem, prompt, onChunk, false)
  return sanitizeImagePlan(result, draft, project.imageReferences)
}

async function createRealPosterPlan(project, draft, onChunk = () => {}) {
  const photos = project.realPhotos.filter((item) => item.enabled !== false && item.taggingStatus === 'ready')
  if (!photos.length) throw new Error('请先到“素材管理 → 业务实拍”上传图片并等待分析完成')
  const catalog = photos.map((item) => ({
    id: item.id,
    width: item.width,
    height: item.height,
    tags: {
      originalDescription: item.tags.originalDescription,
      visibleText: item.tags.visibleText,
      businessContext: item.tags.businessContext,
      themeTags: item.tags.themeTags,
      sceneTags: item.tags.sceneTags,
      subjectTags: item.tags.subjectTags,
      actionTags: item.tags.actionTags,
      visualTags: item.tags.visualTags,
    },
  }))
  const prompt = `请围绕当前已确认的小红书文案，对全部业务实拍图片逐张排序，并用贪心方式组织成若干宣传图页面。目标是尽可能生成可编辑初稿，不因相关性较弱而中断。

核心规则：
1. 所有目录图片都是候选。逐张给出匹配等级：direct=直接展示文案对象、活动、过程或细节；supporting=自然辅助具体场景或观点；contextual=适合表达参与者、团队、现场或氛围；fallback=联系较弱但在现有素材中最接近；conflicting=与文案事实明确冲突或存在明显发布风险。
2. 只有 conflicting 才排除。不得因为图片只展示学生合影、人物、环境或活动氛围就直接淘汰；没有强相关图时也要使用 contextual 或 fallback 生成最佳可用方案。
3. 采用贪心选择：每页先选最相关且能独立表达主题的图片，再选择能补充全景、人物、动作或细节的图片；避免选择内容和构图高度重复的照片。
4. 每页使用 1–4 张图片，同一图片不能跨页重复。每张图片必须单独输出 photoMatches，包含自己的等级、文案原句依据和理由，不能让多张图片共用一个相关性结论。
5. direct 和 supporting 的 evidenceQuotes 必须逐字摘录当前文案中的连续原句。contextual 和 fallback 也应尽量提供依据，但没有合适原句时可以为空，不得编造。
6. contextual 和 fallback 只能用于参与者、团队、现场氛围或辅助表达，不能用来证明具体产品功能、效果、价格、权益、资质或业务事实；页面需要标记为建议人工确认。
7. 标题只能来自当前文案，不得添加新的奖项、级别、地点、效果、价格或承诺。主标题 6–16 字，副标题不超过 14 字。
8. layoutTemplateId 按图片数量选择：1 张=single；2 张=split-vertical|split-horizontal|hero-two；3 张=hero-three|left-three；4 张=grid-four|hero-four。
9. textPosition 只能是 top 或 bottom；优先参考图片的 textSafeArea，避免遮挡主要人物、动作、建筑和道具。
10. 只要存在非 conflicting 图片，pages 就不得为空。如果所有图片都是 conflicting，返回一个不含图片的页面，供用户手动选择。

已确认文案：${JSON.stringify(draft)}
实拍图片目录：${JSON.stringify(catalog)}

只输出 JSON：{"concept":"整套实拍宣传图主题","visualContinuity":"统一排版规则","pages":[{"promotionTheme":"本页共同主题","purpose":"本页作用","title":"主标题","subtitle":"副标题","photoMatches":[{"photoId":"REALIMG-0001","relevanceLevel":"direct|supporting|contextual|fallback|conflicting","evidenceQuotes":["当前文案中的逐字原句"],"reason":"这张图片自己的匹配理由"}],"groupReason":"贪心选择及图片互补理由","layoutTemplateId":"single","textPosition":"bottom","accentColor":"#ffd43b"}]}`
  const result = await callModel(modelSystem, prompt, onChunk, false)
  return sanitizeRealPosterPlan(result, draft, photos)
}

async function rewriteImagePage(project, task, page, feedback) {
  const currentImageId = task.currentImageIds?.[page.id]
  const currentImage = task.images.find((item) => item.id === currentImageId)
  const request = String(feedback || '').trim()
  const enabledImageReferences = project.imageReferences.filter((item) => item.enabled !== false && item.taggingStatus === 'ready')
  const referenceCatalog = enabledImageReferences.map((item) => ({ id: item.id, isCover: item.isCover, tags: item.tags }))
  const prompt = `请重写这张小红书配图的视觉策划，然后再交给图片模型生成。必须产生实质变化，不能只是换随机种子。

${request ? `用户改进建议：${request}` : '用户没有填写建议。请主动诊断当前方案，从构图、视觉主体、信息层级或表现手法中选择至少两项进行明显优化，同时保持本页职责和准确文字不变。'}

套图统一规范：${task.plan.visualContinuity}
本页职责：${page.purpose}
当前页面策划：${JSON.stringify(page.brief)}
上次实际图片提示词：${currentImage?.prompt || ''}
业务事实：${JSON.stringify(project.facts)}
合规准则：${JSON.stringify(project.rules.filter((item) => item.enabled !== false))}
可用参考图片标签：${JSON.stringify(referenceCatalog)}

不得新增未经证实的事实；必须保持与整套图一致，但新构图要能让用户一眼看出变化。若用户没有明确要求纯插画/纯信息图，且参考库中存在 photo 或 mixed 样本，优先把新版本改为 photoreal 或 mixed，并选择 1–3 张参考图，将摄影实景样本放在第一位。写实场景是生成式视觉表达，不冒充现场纪录。只输出 JSON 对象：{"referenceImageIds":["XHSIMG-0001"],"visualMode":"photoreal|mixed|graphic","coverTitle":"短标题","subtitle":"副标题","style":"lifestyle|event|product|guide|editorial","subject":"主体","scene":"场景、动作、光线和镜头","composition":"构图","palette":["颜色"],"mood":"氛围","mustShow":["元素"],"mustAvoid":["元素"],"extraNotes":"补充"}。`
  const result = await callModel(modelSystem, prompt, () => {}, false)
  const photographicReferences = enabledImageReferences.filter((reference) => ['photo', 'mixed'].includes(reference.tags?.visualMedium))
  const explicitlyGraphic = /(纯插画|手绘|拼贴|信息图|纯排版)/.test(request)
  const explicitlyPhotographic = /(实景|实拍|照片|摄影|写实)/.test(request)
  const shouldUsePhotography = photographicReferences.length && !explicitlyGraphic && (explicitlyPhotographic || !request)
  const brief = sanitizeImageBrief({
    ...result,
    visualMode: explicitlyGraphic ? 'graphic' : explicitlyPhotographic ? 'photoreal' : shouldUsePhotography && result.visualMode === 'graphic' ? 'mixed' : result.visualMode,
    pageRole: page.role,
    pageLabel: page.label,
    purpose: page.purpose,
    visualContinuity: task.plan.visualContinuity,
  }, page.title)
  let referenceImageIds = [...new Set((Array.isArray(result.referenceImageIds) ? result.referenceImageIds : page.referenceImageIds).map(String)
    .filter((id) => enabledImageReferences.some((reference) => reference.id === id)))].slice(0, 3)
  if (shouldUsePhotography || ['photoreal', 'mixed'].includes(brief.visualMode)) {
    const selectedPhotographic = referenceImageIds.map((id) => photographicReferences.find((reference) => reference.id === id)).find(Boolean)
    const roleMatched = photographicReferences.find((reference) => reference.isCover === (page.role === 'cover'))
    const photographicReference = selectedPhotographic || roleMatched || photographicReferences[0]
    if (photographicReference) referenceImageIds = [...new Set([photographicReference.id, ...referenceImageIds])].slice(0, 3)
  }
  if (!referenceImageIds.length) referenceImageIds = page.referenceImageIds
  return { brief, referenceImageIds }
}

async function generateImagePage(project, task, page, brief, feedback = '') {
  const references = (page.referenceImageIds || []).map((id) => project.imageReferences.find((item) => item.id === id && item.enabled !== false && item.taggingStatus === 'ready')).filter(Boolean)
  if (!references.length) throw new Error(`${page.label}没有可用参考图，无法执行图生图`)
  const generated = await callImageModel(brief, references)
  const url = generated.urls[0]
  const folder = resolveProjectFile(task.artifactDir)
  const stamp = Date.now()
  const revision = task.images.filter((item) => item.pageId === page.id).length + 1
  const file = path.join(folder, `${page.id.toLowerCase()}-v${String(revision).padStart(2, '0')}-${stamp}.png`)
  await downloadGeneratedImage(url, file)
  return {
    id: `${task.id}-${page.id}-${stamp}`,
    pageId: page.id,
    revision,
    feedback: String(feedback || '').trim(),
    relativePath: projectRelative(file),
    createdAt: now(),
    model: generated.settings.model,
    size: generated.settings.size,
    seed: generated.seed,
    requestId: generated.requestId,
    prompt: generated.prompt,
    negativePrompt: generated.negativePrompt,
    referenceImageIds: generated.referenceImageIds,
  }
}

function modelStream(event, operation) {
  event.sender.send('model:stream', { operation, reset: true, chunk: '' })
  return (kind, chunk) => event.sender.send('model:stream', { operation, kind, chunk })
}
function modelStreamDone(event, operation) {
  event.sender.send('model:stream', { operation, done: true, chunk: '' })
}

const modelSystem = `你是严谨的小红书内容策划与写作引擎。不得补充、猜测或虚构产品、服务、价格、行程、权益、资质、名额、效果、联系方式等业务事实。可以扩展稳定的公共背景、生活场景、用户问题、情绪和创意表达，但必须与业务承诺区分，不得伪造亲身体验或把想象写成客户已经提供的服务。在真实性与合规硬边界内，用户当前自然语言要求是最高优先级创作指令，优先于选定策略、关键词、参考文案、历史习惯和系统默认模板。必须只输出合法 JSON，不要输出 Markdown 代码块或解释。`
const factsModelSystem = '你是严谨的业务事实提取引擎。本任务只能提取和整理用户原始素材中明确包含的内容，不得补充公共背景、常识、创意场景、推测或任何素材中没有的业务事实。必须只输出合法 JSON，不要输出 Markdown 代码块或解释。'

async function initializeProject(folder) {
  const absolute = path.resolve(folder)
  await fsp.access(absolute, fs.constants.R_OK | fs.constants.W_OK)
  await fsp.mkdir(path.join(absolute, DATA_DIR), { recursive: true })
  await fsp.mkdir(path.join(absolute, OUTPUT_DIR), { recursive: true })
  const meta = {
    schemaVersion: 1, name: cleanName(absolute), createdAt: now(), updatedAt: now(),
    counters: { keywords: 0, references: 0, rules: 0, imageReferences: 0, realPhotos: 0, strategies: 0, generations: 1, finalContents: 0 },
  }
  await writeJson(path.join(absolute, MARKER), meta)
  for (const file of Object.values(assetFiles)) await writeJson(path.join(absolute, DATA_DIR, file), [])
  await writeJson(path.join(absolute, DATA_DIR, IMAGE_REFERENCES_FILE), [])
  await writeJson(path.join(absolute, DATA_DIR, REAL_PHOTOS_FILE), [])
  await writeJson(path.join(absolute, DATA_DIR, FINAL_CONTENTS_FILE), [])
  await fsp.mkdir(path.join(absolute, DATA_DIR, IMAGE_REFERENCES_DIR), { recursive: true })
  await fsp.mkdir(path.join(absolute, DATA_DIR, REAL_PHOTOS_DIR), { recursive: true })
  currentRoot = absolute
  await writeJson(outputPath('当前生成.json'), { id: 'GEN-0001', createdAt: now() })
  await writeJson(outputPath('生成记录.json'), [])
  await writeJson(outputPath(GENERATION_CONFIG_FILE), normalizeGenerationConfig())
  await writeJson(outputPath(IMAGE_TASKS_FILE), [])
  await addRecent(absolute)
  return loadProject()
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1440, height: 920, minWidth: 1080, minHeight: 700,
    show: false,
    icon: applicationIconPath(),
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    backgroundColor: '#f8fafc',
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false },
  })
  // A renderer failure must not leave the application permanently invisible.
  const revealFallback = setTimeout(() => { if (!win.isDestroyed() && !win.isVisible()) win.show() }, 15000)
  win.once('show', () => clearTimeout(revealFallback))
  if (process.env.NODE_ENV === 'development' || !app.isPackaged) win.loadURL('http://127.0.0.1:5173')
  else win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
}

ipcMain.on('window:show', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (win && !win.isDestroyed() && !win.isVisible()) win.show()
})

ipcMain.handle('project:choose', async () => {
  try {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'], title: '选择项目文件夹', buttonLabel: '选择此文件夹' })
    if (result.canceled) return { ok: false, error: '' }
    const folder = result.filePaths[0]
    const initialized = await exists(path.join(folder, MARKER))
    if (initialized) { currentRoot = folder; await addRecent(folder); return { ok: true, initialized: true, folder, data: await loadProject() } }
    await fsp.access(folder, fs.constants.R_OK | fs.constants.W_OK)
    return { ok: true, initialized: false, folder }
  } catch (error) { return { ok: false, error: `无法使用该文件夹：${error.message}` } }
})
ipcMain.handle('project:initialize', async (_event, folder) => {
  try { return { ok: true, data: await initializeProject(folder) } } catch (error) { return { ok: false, error: error.message } }
})
ipcMain.handle('project:open', async (_event, folder) => {
  try {
    if (!await exists(path.join(folder, MARKER))) throw new Error('这不是已初始化的工坊项目')
    currentRoot = folder; await addRecent(folder)
    return { ok: true, data: await loadProject() }
  } catch (error) { return { ok: false, error: error.message } }
})
ipcMain.handle('project:recent', () => recentProjects())
ipcMain.handle('project:get', async () => ({ ok: true, data: await loadProject() }))

ipcMain.handle('material:import', async () => {
  try {
    if (!currentRoot) throw new Error('请先创建或打开项目')
    const result = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }], title: '导入业务原始素材', buttonLabel: '导入' })
    if (result.canceled) return { ok: false, error: '' }
    const content = await fsp.readFile(result.filePaths[0], 'utf8')
    if (!content.trim()) throw new Error('所选 Markdown 文件为空')
    await fsp.writeFile(path.join(currentRoot, '业务原始素材.md'), content, 'utf8')
    const meta = await readMeta(); await writeMeta(meta)
    return { ok: true, data: await loadProject() }
  } catch (error) { return { ok: false, error: error.message } }
})

async function inspectMaterialFiles(filePaths) {
  if (!Array.isArray(filePaths) || !filePaths.length) throw new Error('请先添加要提取的 PDF 或图片')
  const uniquePaths = [...new Set(filePaths.map((file) => String(file || '')).filter(Boolean))]
  const selected = await Promise.all(uniquePaths.map(async (file) => {
    const stat = await fsp.stat(file)
    if (!stat.isFile()) throw new Error(`不是可读取的文件：${path.basename(file)}`)
    return { name: path.basename(file), file, size: stat.size }
  }))
  validateMaterialFiles(selected)
  return selected
}

ipcMain.handle('material:select', async () => {
  try {
    if (!currentRoot) throw new Error('请先创建或打开项目')
    const result = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'PDF 或图片', extensions: ['pdf', 'png', 'jpg', 'jpeg', 'webp', 'gif'] },
        { name: 'PDF', extensions: ['pdf'] },
        { name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] },
      ],
      title: '添加要 AI 提取的 PDF 或图片',
      buttonLabel: '添加到列表',
    })
    if (result.canceled || !result.filePaths.length) return { ok: false, error: '' }
    return { ok: true, files: await inspectMaterialFiles(result.filePaths) }
  } catch (error) { return { ok: false, error: error.message } }
})

ipcMain.handle('material:extract', async (event, filePaths) => {
  const operation = 'material-ai'
  const onChunk = modelStream(event, operation)
  try {
    if (!currentRoot) throw new Error('请先创建或打开项目')
    const { value } = await userConfig()
    if (!value.apiKey || !value.visionModel || !value.baseUrl) throw new Error('请先在“设置”中配置支持视觉理解的 OCR 模型')
    const selected = await inspectMaterialFiles(filePaths)
    const files = await Promise.all(selected.map(async (item) => ({ ...item, data: await fsp.readFile(item.file) })))
    let endpoint = value.baseUrl.replace(/\/+$/, '')
    if (!endpoint.endsWith('/chat/completions')) endpoint += '/chat/completions'
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10 * 60_000)
    let response
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${value.apiKey}` },
        signal: controller.signal,
        body: JSON.stringify({
          model: value.visionModel,
          temperature: 0.1,
          stream: true,
          messages: buildMaterialExtractionMessages(files),
        }),
      })
    } catch (error) {
      if (error.name === 'AbortError') throw new Error('AI 提取超过 10 分钟，已停止等待；请缩小文件或分批重试')
      throw new Error(`无法连接 OCR 模型接口：${error.message}`)
    } finally { clearTimeout(timeout) }
    if (!response.ok) {
      const body = await response.text()
      const hint = files.some((file) => path.extname(file.name).toLowerCase() === '.pdf')
        ? '；请确认当前视觉模型及兼容接口支持 PDF 文件输入'
        : ''
      throw new Error(`OCR 模型返回 ${response.status}${hint}：${body.slice(0, 500)}`)
    }
    const markdown = normalizeExtractedMarkdown(await readChatCompletionText(response, onChunk, '视觉模型流式返回中没有可读取的 Markdown 内容'))
    const target = path.join(currentRoot, '业务原始素材.md')
    const temporary = `${target}.tmp`
    await fsp.writeFile(temporary, markdown, 'utf8')
    await fsp.rename(temporary, target)
    const meta = await readMeta(); await writeMeta(meta)
    modelStreamDone(event, operation)
    return { ok: true, data: await loadProject() }
  } catch (error) { modelStreamDone(event, operation); return { ok: false, error: error.message } }
})

ipcMain.handle('material:export', async () => {
  try {
    if (!currentRoot) throw new Error('请先创建或打开项目')
    const source = path.join(currentRoot, '业务原始素材.md')
    if (!await exists(source)) throw new Error('还没有可导出的业务原始素材')
    const result = await dialog.showSaveDialog({
      title: '导出业务原始素材',
      defaultPath: '业务原始素材.md',
      buttonLabel: '导出',
      filters: [{ name: 'Markdown', extensions: ['md'] }],
    })
    if (result.canceled || !result.filePath) return { ok: false, error: '' }
    await fsp.copyFile(source, result.filePath)
    return { ok: true, savedPath: result.filePath }
  } catch (error) { return { ok: false, error: error.message } }
})

ipcMain.handle('asset:save', async (_event, kind, value) => {
  try {
    if (!currentRoot || !assetFiles[kind]) throw new Error('项目或资料类型无效')
    const items = await readJson(dataPath(assetFiles[kind]), [])
    const stamp = now()
    const normalized = normalizeAsset(kind, value)
    if (kind === 'keywords' && !normalized.root) throw new Error('核心关键词/词根为必填项')
    if (kind === 'rules' && !normalized.prohibited) throw new Error('禁用词/敏感表述为必填项')
    if (kind === 'references' && (!normalized.title || !normalized.body)) throw new Error('标题和正文为必填项')
    if (value.id) {
      const index = items.findIndex((item) => item.id === value.id)
      if (index < 0) throw new Error('没有找到要修改的记录')
      items[index] = { ...items[index], ...normalized, id: items[index].id, updatedAt: stamp }
    } else {
      const meta = await readMeta()
      meta.counters = meta.counters || {}
      meta.counters[kind] = (meta.counters[kind] || 0) + 1
      const id = `${idPrefixes[kind]}-${String(meta.counters[kind]).padStart(4, '0')}`
      items.push({ ...normalized, id, createdAt: stamp, updatedAt: stamp })
      await writeMeta(meta)
    }
    await writeJson(dataPath(assetFiles[kind]), items)
    return { ok: true, data: await loadProject() }
  } catch (error) { return { ok: false, error: error.message } }
})

ipcMain.handle('asset:template', async (_event, kind) => {
  try {
    if (!assetFiles[kind]) throw new Error('该资料库没有批量导入模板')
    const label = kind === 'keywords' ? '关键词库' : kind === 'references' ? '参考文案库' : '合规准则'
    const result = await dialog.showSaveDialog({
      title: `下载${label}模板`,
      defaultPath: `${label}-模板.xlsx`,
      buttonLabel: '保存模板',
      filters: [{ name: 'Excel 工作簿', extensions: ['xlsx'] }],
    })
    if (result.canceled || !result.filePath) return { ok: false, error: '' }
    await fsp.writeFile(result.filePath, createTemplateXlsx(kind))
    return { ok: true, savedPath: result.filePath }
  } catch (error) { return { ok: false, error: error.message } }
})

ipcMain.handle('asset:import', async (_event, kind) => {
  try {
    if (!currentRoot) throw new Error('请先创建或打开项目')
    if (!assetFiles[kind]) throw new Error('该资料库不支持 Excel 批量导入')
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'Excel 工作簿', extensions: ['xlsx'] }],
      title: kind === 'keywords' ? '导入关键词库' : kind === 'references' ? '导入参考文案库' : '导入合规准则',
      buttonLabel: '导入',
    })
    if (result.canceled) return { ok: false, error: '' }
    const imported = rowsToAssets(kind, readXlsxRows(await fsp.readFile(result.filePaths[0])))
    const items = await readJson(dataPath(assetFiles[kind]), [])
    const meta = await readMeta()
    meta.counters = meta.counters || {}
    const stamp = now()
    const records = imported.map((item) => {
      meta.counters[kind] = (meta.counters[kind] || 0) + 1
      return {
        ...item,
        id: `${idPrefixes[kind]}-${String(meta.counters[kind]).padStart(4, '0')}`,
        createdAt: stamp,
        updatedAt: stamp,
      }
    })
    await writeMeta(meta)
    await writeJson(dataPath(assetFiles[kind]), [...items, ...records])
    return { ok: true, imported: records.length, data: await loadProject() }
  } catch (error) { return { ok: false, error: error.message } }
})
ipcMain.handle('asset:export', async (_event, kind) => {
  try {
    if (!currentRoot || !assetFiles[kind]) throw new Error('项目或资料类型无效')
    const label = kind === 'keywords' ? '关键词库' : kind === 'references' ? '参考文案库' : '合规准则'
    const result = await dialog.showSaveDialog({
      title: `导出${label}`,
      defaultPath: `${label}.xlsx`,
      buttonLabel: '导出',
      filters: [{ name: 'Excel 工作簿', extensions: ['xlsx'] }],
    })
    if (result.canceled || !result.filePath) return { ok: false, error: '' }
    const items = await readJson(dataPath(assetFiles[kind]), [])
    await fsp.writeFile(result.filePath, createAssetExportXlsx(kind, items))
    return { ok: true, savedPath: result.filePath }
  } catch (error) { return { ok: false, error: error.message } }
})
ipcMain.handle('asset:delete', async (_event, kind, id) => {
  try {
    if (!currentRoot || !assetFiles[kind]) throw new Error('项目或资料类型无效')
    const items = await readJson(dataPath(assetFiles[kind]), [])
    await writeJson(dataPath(assetFiles[kind]), items.filter((item) => item.id !== id))
    return { ok: true, data: await loadProject() }
  } catch (error) { return { ok: false, error: error.message } }
})
ipcMain.handle('asset:toggle', async (_event, kind, id, enabled) => {
  try {
    if (!currentRoot || !assetFiles[kind]) throw new Error('项目或资料类型无效')
    const items = await readJson(dataPath(assetFiles[kind]), [])
    const index = items.findIndex((item) => item.id === id)
    if (index < 0) throw new Error('没有找到要修改的记录')
    items[index] = { ...items[index], enabled: Boolean(enabled), updatedAt: now() }
    await writeJson(dataPath(assetFiles[kind]), items)
    return { ok: true, data: await loadProject() }
  } catch (error) { return { ok: false, error: error.message } }
})

async function saveImageReferences(items) {
  await writeJson(dataPath(IMAGE_REFERENCES_FILE), items.map(normalizeImageReference))
}

async function retagImageReference(items, index, onUpdate) {
  const reference = normalizeImageReference(items[index])
  items[index] = { ...reference, taggingStatus: 'pending', taggingError: '', updatedAt: now() }
  await saveImageReferences(items)
  onUpdate?.(items[index], 'tagging')
  try {
    const tags = await callVisionTagger(reference)
    items[index] = { ...items[index], tags, taggingStatus: 'ready', taggingError: '', updatedAt: now() }
  } catch (error) {
    items[index] = { ...items[index], taggingStatus: 'failed', taggingError: error.message, updatedAt: now() }
  }
  await saveImageReferences(items)
  onUpdate?.(items[index], 'item-done')
  return items[index]
}

ipcMain.handle('image-reference:upload', async (event, isCover) => {
  try {
    if (!currentRoot) throw new Error('请先创建或打开项目')
    const result = await dialog.showOpenDialog({
      title: isCover ? '上传优秀的小红书封面样本' : '上传优秀的小红书内容页样本',
      buttonLabel: '上传并自动打标',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: '图片', extensions: ['jpg', 'jpeg', 'png', 'webp'] }],
    })
    if (result.canceled || !result.filePaths.length) return { ok: false, error: '' }
    if (result.filePaths.length > 12) throw new Error('单次最多上传 12 张图片，请分批上传')
    const validatedSources = []
    for (const source of result.filePaths) {
      const buffer = await fsp.readFile(source)
      if (!buffer.length) throw new Error(`${path.basename(source)} 是空文件`)
      if (buffer.length > 10 * 1024 * 1024) throw new Error(`${path.basename(source)} 超过 10MB`)
      const dimensions = nativeImage.createFromBuffer(buffer).getSize()
      if (!dimensions.width || !dimensions.height) throw new Error(`${path.basename(source)} 不是可读取的图片`)
      if (dimensions.width > 8000 || dimensions.height > 8000 || Math.max(dimensions.width, dimensions.height) / Math.min(dimensions.width, dimensions.height) > 10) {
        throw new Error(`${path.basename(source)} 的尺寸不符合模型要求（边长不超过 8000，长宽比不超过 10:1）`)
      }
      validatedSources.push({ source, dimensions })
    }
    const items = (await readJson(dataPath(IMAGE_REFERENCES_FILE), [])).map(normalizeImageReference)
    const meta = await readMeta()
    meta.counters = meta.counters || {}
    const createdIndexes = []
    for (const { source, dimensions } of validatedSources) {
      meta.counters.imageReferences = (meta.counters.imageReferences || 0) + 1
      const id = `XHSIMG-${String(meta.counters.imageReferences).padStart(4, '0')}`
      const extension = path.extname(source).toLowerCase() || '.png'
      const target = dataPath(path.join(IMAGE_REFERENCES_DIR, `${id}${extension}`))
      await fsp.mkdir(path.dirname(target), { recursive: true })
      await fsp.copyFile(source, target)
      items.push(normalizeImageReference({
        id,
        originalName: path.basename(source),
        relativePath: projectRelative(target),
        width: dimensions.width,
        height: dimensions.height,
        isCover: Boolean(isCover),
        enabled: true,
        taggingStatus: 'pending',
        tags: {},
        createdAt: now(),
        updatedAt: now(),
      }))
      createdIndexes.push(items.length - 1)
    }
    await writeMeta(meta)
    await saveImageReferences(items)
    event.sender.send('image-reference:progress', {
      phase: 'added', current: 0, total: createdIndexes.length,
      label: `已导入 ${createdIndexes.length} 张图片，准备分析`,
      references: createdIndexes.map((index) => items[index]),
    })
    let failed = 0
    for (let position = 0; position < createdIndexes.length; position += 1) {
      const index = createdIndexes[position]
      event.sender.send('image-reference:progress', {
        phase: 'tagging', current: position + 1, total: createdIndexes.length,
        label: `正在分析第 ${position + 1} 张图片`, reference: items[index],
      })
      const tagged = await retagImageReference(items, index)
      if (tagged.taggingStatus !== 'ready') failed += 1
      event.sender.send('image-reference:progress', {
        phase: 'item-done', current: position + 1, total: createdIndexes.length,
        label: tagged.taggingStatus === 'ready' ? `第 ${position + 1} 张图片分析完成` : `第 ${position + 1} 张图片分析失败`,
        reference: tagged,
      })
    }
    event.sender.send('image-reference:progress', {
      phase: 'done', current: createdIndexes.length, total: createdIndexes.length,
      label: failed ? `分析完成，${failed} 张需要重试` : '所有图片分析完成',
    })
    return { ok: true, imported: createdIndexes.length, failed, data: await loadProject() }
  } catch (error) { return { ok: false, error: error.message, data: currentRoot ? await loadProject() : undefined } }
})

ipcMain.handle('image-reference:retag', async (event, id) => {
  try {
    const items = (await readJson(dataPath(IMAGE_REFERENCES_FILE), [])).map(normalizeImageReference)
    const index = items.findIndex((item) => item.id === String(id))
    if (index < 0) throw new Error('没有找到要重新打标的图片')
    const tagged = await retagImageReference(items, index, (reference, phase) => {
      event.sender.send('image-reference:progress', {
        phase, current: 1, total: 1,
        label: phase === 'tagging' ? '正在重新分析图片' : reference.taggingStatus === 'ready' ? '图片重新打标完成' : '图片重新打标失败',
        reference,
      })
    })
    event.sender.send('image-reference:progress', {
      phase: 'done', current: 1, total: 1,
      label: tagged.taggingStatus === 'ready' ? '图片重新打标完成' : '图片重新打标失败',
    })
    if (tagged.taggingStatus !== 'ready') throw new Error(tagged.taggingError || '图片打标失败')
    return { ok: true, data: await loadProject() }
  } catch (error) { return { ok: false, error: error.message, data: currentRoot ? await loadProject() : undefined } }
})

ipcMain.handle('image-reference:set-role', async (event, id, isCover) => {
  try {
    const items = (await readJson(dataPath(IMAGE_REFERENCES_FILE), [])).map(normalizeImageReference)
    const index = items.findIndex((item) => item.id === String(id))
    if (index < 0) throw new Error('没有找到要修改的图片')
    items[index] = { ...items[index], isCover: Boolean(isCover), updatedAt: now() }
    const tagged = await retagImageReference(items, index, (reference, phase) => {
      event.sender.send('image-reference:progress', {
        phase, current: 1, total: 1,
        label: phase === 'tagging' ? '正在按新类型重新分析图片' : reference.taggingStatus === 'ready' ? '图片类型和标签已更新' : '图片重新打标失败',
        reference,
      })
    })
    event.sender.send('image-reference:progress', {
      phase: 'done', current: 1, total: 1,
      label: tagged.taggingStatus === 'ready' ? '图片类型和标签已更新' : '图片重新打标失败',
    })
    if (tagged.taggingStatus !== 'ready') throw new Error(tagged.taggingError || '图片重新打标失败')
    return { ok: true, data: await loadProject() }
  } catch (error) { return { ok: false, error: error.message, data: currentRoot ? await loadProject() : undefined } }
})

ipcMain.handle('image-reference:toggle', async (_event, id, enabled) => {
  try {
    const items = (await readJson(dataPath(IMAGE_REFERENCES_FILE), [])).map(normalizeImageReference)
    const index = items.findIndex((item) => item.id === String(id))
    if (index < 0) throw new Error('没有找到要修改的图片')
    items[index] = { ...items[index], enabled: Boolean(enabled), updatedAt: now() }
    await saveImageReferences(items)
    return { ok: true, data: await loadProject() }
  } catch (error) { return { ok: false, error: error.message } }
})

ipcMain.handle('image-reference:delete', async (_event, id) => {
  try {
    const items = (await readJson(dataPath(IMAGE_REFERENCES_FILE), [])).map(normalizeImageReference)
    const index = items.findIndex((item) => item.id === String(id))
    if (index < 0) throw new Error('没有找到要删除的图片')
    const target = resolveProjectFile(items[index].relativePath)
    if (await exists(target)) await fsp.unlink(target)
    items.splice(index, 1)
    await saveImageReferences(items)
    return { ok: true, data: await loadProject() }
  } catch (error) { return { ok: false, error: error.message } }
})

ipcMain.handle('image-reference:export-package', async () => {
  try {
    if (!currentRoot) throw new Error('请先创建或打开项目')
    const items = (await readJson(dataPath(IMAGE_REFERENCES_FILE), [])).map(normalizeImageReference)
    if (!items.length) throw new Error('图片素材库为空，无法导出')
    const meta = await readMeta()
    const safeProjectName = String(meta?.name || cleanName(currentRoot)).replace(/[\\/:*?"<>|]/g, '-').slice(0, 40)
    const result = await dialog.showSaveDialog({
      title: '导出小红书图片素材包',
      defaultPath: `${safeProjectName}-图片素材包-${now().slice(0, 10)}.zip`,
      filters: [{ name: '小红书图片素材包', extensions: ['zip'] }],
    })
    if (result.canceled || !result.filePath) return { ok: true }

    const entries = []
    for (const reference of items) {
      const source = resolveProjectFile(reference.relativePath)
      if (!await exists(source)) throw new Error(`图片文件不存在，无法导出：${reference.originalName || reference.id}`)
      entries.push({
        reference,
        buffer: await fsp.readFile(source),
        extension: path.extname(source),
      })
    }
    const packageBuffer = createImageReferencePackage(entries)
    await fsp.writeFile(result.filePath, packageBuffer)
    return { ok: true, exported: entries.length, savedPath: result.filePath }
  } catch (error) { return { ok: false, error: error.message } }
})

ipcMain.handle('image-reference:import-package', async () => {
  const createdFiles = []
  let committed = false
  try {
    if (!currentRoot) throw new Error('请先创建或打开项目')
    const result = await dialog.showOpenDialog({
      title: '导入小红书图片素材包',
      buttonLabel: '导入并复用标签',
      properties: ['openFile'],
      filters: [{ name: '小红书图片素材包', extensions: ['zip'] }],
    })
    if (result.canceled || !result.filePaths[0]) return { ok: false, error: '' }
    const source = result.filePaths[0]
    const stat = await fsp.stat(source)
    if (stat.size > 300 * 1024 * 1024) throw new Error('素材包超过 300MB，无法导入')
    const { entries } = readImageReferencePackage(await fsp.readFile(source))

    const items = (await readJson(dataPath(IMAGE_REFERENCES_FILE), [])).map(normalizeImageReference)
    const existingHashes = new Set()
    for (const item of items) {
      try {
        const file = resolveProjectFile(item.relativePath)
        if (await exists(file)) existingHashes.add(imageHash(await fsp.readFile(file)))
      } catch { /* A broken existing item should not prevent importing the rest of the package. */ }
    }

    const meta = await readMeta()
    meta.counters = meta.counters || {}
    const highestExistingId = items.reduce((highest, item) => {
      const match = /^XHSIMG-(\d+)$/.exec(item.id)
      return Math.max(highest, match ? Number(match[1]) : 0)
    }, 0)
    meta.counters.imageReferences = Math.max(Number(meta.counters.imageReferences) || 0, highestExistingId)
    let skipped = 0
    const importedItems = []
    for (const entry of entries) {
      if (existingHashes.has(entry.sha256)) { skipped += 1; continue }
      const dimensions = nativeImage.createFromBuffer(entry.buffer).getSize()
      if (!dimensions.width || !dimensions.height) throw new Error(`${entry.reference.originalName || entry.reference.file} 不是可读取的图片`)
      if (dimensions.width > 8000 || dimensions.height > 8000 || Math.max(dimensions.width, dimensions.height) / Math.min(dimensions.width, dimensions.height) > 10) {
        throw new Error(`${entry.reference.originalName || entry.reference.file} 的尺寸不符合要求（边长不超过 8000，长宽比不超过 10:1）`)
      }

      meta.counters.imageReferences = (meta.counters.imageReferences || 0) + 1
      const id = `XHSIMG-${String(meta.counters.imageReferences).padStart(4, '0')}`
      const target = dataPath(path.join(IMAGE_REFERENCES_DIR, `${id}${entry.extension}`))
      await fsp.mkdir(path.dirname(target), { recursive: true })
      await fsp.writeFile(target, entry.buffer, { flag: 'wx' })
      createdFiles.push(target)
      const sourceStatus = entry.reference.taggingStatus
      const imported = normalizeImageReference({
        id,
        originalName: path.basename(String(entry.reference.originalName || `${id}${entry.extension}`)),
        relativePath: projectRelative(target),
        width: dimensions.width,
        height: dimensions.height,
        isCover: Boolean(entry.reference.isCover),
        enabled: entry.reference.enabled !== false,
        taggingStatus: sourceStatus === 'ready' ? 'ready' : 'failed',
        taggingError: sourceStatus === 'ready' ? '' : String(entry.reference.taggingError || '源素材尚未完成打标，请重新打标'),
        tags: sanitizeImageReferenceTags(entry.reference.tags),
        createdAt: now(),
        updatedAt: now(),
      })
      items.push(imported)
      importedItems.push(imported)
      existingHashes.add(entry.sha256)
    }

    if (importedItems.length) {
      await writeMeta(meta)
      await saveImageReferences(items)
    }
    committed = true
    return { ok: true, imported: importedItems.length, skipped, data: await loadProject() }
  } catch (error) {
    if (!committed) for (const file of createdFiles) {
      try { if (await exists(file)) await fsp.unlink(file) } catch { /* Best-effort rollback for newly created package files. */ }
    }
    return { ok: false, error: error.message, data: currentRoot ? await loadProject() : undefined }
  }
})

ipcMain.handle('real-photo:export-package', async () => {
  try {
    if (!currentRoot) throw new Error('请先创建或打开项目')
    const items = (await readJson(dataPath(REAL_PHOTOS_FILE), [])).map(normalizeRealPhoto)
    if (!items.length) throw new Error('业务实拍图库为空，无法导出')
    const meta = await readMeta()
    const safeProjectName = String(meta?.name || cleanName(currentRoot)).replace(/[\\/:*?"<>|]/g, '-').slice(0, 40)
    const result = await dialog.showSaveDialog({
      title: '导出业务实拍素材包',
      defaultPath: `${safeProjectName}-业务实拍素材包-${now().slice(0, 10)}.zip`,
      filters: [{ name: '业务实拍素材包', extensions: ['zip'] }],
    })
    if (result.canceled || !result.filePath) return { ok: true }

    const entries = []
    for (const photo of items) {
      const source = resolveProjectFile(photo.relativePath)
      if (!await exists(source)) throw new Error(`图片文件不存在，无法导出：${photo.originalName || photo.id}`)
      entries.push({ photo, buffer: await fsp.readFile(source), extension: path.extname(source) })
    }
    const packageBuffer = createRealPhotoPackage(entries)
    await fsp.writeFile(result.filePath, packageBuffer)
    return { ok: true, exported: entries.length, savedPath: result.filePath }
  } catch (error) { return { ok: false, error: error.message } }
})

ipcMain.handle('real-photo:import-package', async () => {
  const createdFiles = []
  let committed = false
  try {
    if (!currentRoot) throw new Error('请先创建或打开项目')
    const result = await dialog.showOpenDialog({
      title: '导入业务实拍素材包',
      buttonLabel: '导入并复用标签',
      properties: ['openFile'],
      filters: [{ name: '业务实拍素材包', extensions: ['zip'] }],
    })
    if (result.canceled || !result.filePaths[0]) return { ok: false, error: '' }
    const source = result.filePaths[0]
    const stat = await fsp.stat(source)
    if (stat.size > 300 * 1024 * 1024) throw new Error('实拍素材包超过 300MB，无法导入')
    const { entries } = readRealPhotoPackage(await fsp.readFile(source))

    const items = (await readJson(dataPath(REAL_PHOTOS_FILE), [])).map(normalizeRealPhoto)
    const existingHashes = new Set(items.map((item) => item.hash).filter(Boolean))
    for (const item of items.filter((value) => !value.hash)) {
      try {
        const file = resolveProjectFile(item.relativePath)
        if (await exists(file)) existingHashes.add(imageHash(await fsp.readFile(file)))
      } catch { /* A broken existing item should not prevent importing the rest of the package. */ }
    }

    const meta = await readMeta()
    meta.counters = meta.counters || {}
    const highestExistingId = items.reduce((highest, item) => {
      const match = /^REALIMG-(\d+)$/.exec(item.id)
      return Math.max(highest, match ? Number(match[1]) : 0)
    }, 0)
    meta.counters.realPhotos = Math.max(Number(meta.counters.realPhotos) || 0, highestExistingId)
    let skipped = 0
    const importedItems = []
    for (const entry of entries) {
      if (existingHashes.has(entry.sha256)) { skipped += 1; continue }
      const dimensions = nativeImage.createFromBuffer(entry.buffer).getSize()
      if (!dimensions.width || !dimensions.height) throw new Error(`${entry.photo.originalName || entry.photo.file} 不是可读取的图片`)
      if (dimensions.width > 8000 || dimensions.height > 8000 || Math.max(dimensions.width, dimensions.height) / Math.min(dimensions.width, dimensions.height) > 10) {
        throw new Error(`${entry.photo.originalName || entry.photo.file} 的尺寸不符合要求（边长不超过 8000，长宽比不超过 10:1）`)
      }

      meta.counters.realPhotos = (meta.counters.realPhotos || 0) + 1
      const id = `REALIMG-${String(meta.counters.realPhotos).padStart(4, '0')}`
      const target = dataPath(path.join(REAL_PHOTOS_DIR, `${id}${entry.extension}`))
      await fsp.mkdir(path.dirname(target), { recursive: true })
      await fsp.writeFile(target, entry.buffer, { flag: 'wx' })
      createdFiles.push(target)
      const sourceStatus = entry.photo.taggingStatus
      const imported = normalizeRealPhoto({
        id,
        originalName: path.basename(String(entry.photo.originalName || `${id}${entry.extension}`)),
        relativePath: projectRelative(target),
        hash: entry.sha256,
        width: dimensions.width,
        height: dimensions.height,
        enabled: entry.photo.enabled !== false,
        taggingStatus: sourceStatus === 'ready' ? 'ready' : 'failed',
        taggingError: sourceStatus === 'ready' ? '' : String(entry.photo.taggingError || '源素材尚未完成分析，请重新分析'),
        tags: sanitizeRealPhotoTags(entry.photo.tags),
        createdAt: now(),
        updatedAt: now(),
      })
      items.push(imported)
      importedItems.push(imported)
      existingHashes.add(entry.sha256)
    }

    if (importedItems.length) {
      await writeMeta(meta)
      await saveRealPhotos(items)
    }
    committed = true
    return { ok: true, imported: importedItems.length, skipped, data: await loadProject() }
  } catch (error) {
    if (!committed) for (const file of createdFiles) {
      try { if (await exists(file)) await fsp.unlink(file) } catch { /* Best-effort rollback for newly created package files. */ }
    }
    return { ok: false, error: error.message, data: currentRoot ? await loadProject() : undefined }
  }
})

async function saveRealPhotos(items) {
  await writeJson(dataPath(REAL_PHOTOS_FILE), items.map(normalizeRealPhoto))
}

async function retagRealPhoto(items, index, materialText, onUpdate) {
  const photo = normalizeRealPhoto(items[index])
  items[index] = { ...photo, taggingStatus: 'pending', taggingError: '', updatedAt: now() }
  await saveRealPhotos(items)
  onUpdate?.(items[index], 'analyzing')
  try {
    const tags = await callRealPhotoTagger(photo, materialText)
    items[index] = { ...items[index], tags, taggingStatus: 'ready', taggingError: '', updatedAt: now() }
  } catch (error) {
    items[index] = { ...items[index], taggingStatus: 'failed', taggingError: error.message, updatedAt: now() }
  }
  await saveRealPhotos(items)
  onUpdate?.(items[index], 'item-done')
  return items[index]
}

ipcMain.handle('real-photo:upload', async (event) => {
  try {
    if (!currentRoot) throw new Error('请先创建或打开项目')
    const result = await dialog.showOpenDialog({
      title: '上传业务实拍图片', buttonLabel: '上传并分析', properties: ['openFile', 'multiSelections'],
      filters: [{ name: '图片', extensions: ['jpg', 'jpeg', 'png', 'webp'] }],
    })
    if (result.canceled || !result.filePaths.length) return { ok: false, error: '' }
    if (result.filePaths.length > 20) throw new Error('单次最多上传 20 张业务实拍图片')
    const items = (await readJson(dataPath(REAL_PHOTOS_FILE), [])).map(normalizeRealPhoto)
    const existingHashes = new Set(items.map((item) => item.hash).filter(Boolean))
    const meta = await readMeta()
    meta.counters = meta.counters || {}
    const createdIndexes = []
    let skipped = 0
    for (const source of result.filePaths) {
      const buffer = await fsp.readFile(source)
      if (!buffer.length) throw new Error(`${path.basename(source)} 是空文件`)
      if (buffer.length > 10 * 1024 * 1024) throw new Error(`${path.basename(source)} 超过 10MB`)
      const dimensions = nativeImage.createFromBuffer(buffer).getSize()
      if (!dimensions.width || !dimensions.height) throw new Error(`${path.basename(source)} 不是可读取的图片`)
      const hash = imageHash(buffer)
      if (existingHashes.has(hash)) { skipped += 1; continue }
      existingHashes.add(hash)
      meta.counters.realPhotos = (meta.counters.realPhotos || 0) + 1
      const id = `REALIMG-${String(meta.counters.realPhotos).padStart(4, '0')}`
      const extension = path.extname(source).toLowerCase() || '.jpg'
      const target = dataPath(path.join(REAL_PHOTOS_DIR, `${id}${extension}`))
      await fsp.mkdir(path.dirname(target), { recursive: true })
      await fsp.copyFile(source, target)
      items.push(normalizeRealPhoto({
        id, originalName: path.basename(source), relativePath: projectRelative(target), hash,
        width: dimensions.width, height: dimensions.height, enabled: true,
        taggingStatus: 'pending', tags: {}, createdAt: now(), updatedAt: now(),
      }))
      createdIndexes.push(items.length - 1)
    }
    await writeMeta(meta)
    await saveRealPhotos(items)
    event.sender.send('real-photo:progress', {
      phase: 'added', current: 0, total: createdIndexes.length,
      label: `已导入 ${createdIndexes.length} 张业务实拍，准备分析`,
      photos: createdIndexes.map((index) => items[index]),
    })
    const materialFile = path.join(currentRoot, '业务原始素材.md')
    const materialText = await exists(materialFile) ? await fsp.readFile(materialFile, 'utf8') : ''
    let failed = 0
    for (let position = 0; position < createdIndexes.length; position += 1) {
      const index = createdIndexes[position]
      event.sender.send('real-photo:progress', {
        phase: 'analyzing', current: position + 1, total: createdIndexes.length,
        label: `正在分析第 ${position + 1} 张业务实拍`, photo: items[index],
      })
      const tagged = await retagRealPhoto(items, index, materialText)
      if (tagged.taggingStatus !== 'ready') failed += 1
      event.sender.send('real-photo:progress', {
        phase: 'item-done', current: position + 1, total: createdIndexes.length,
        label: tagged.taggingStatus === 'ready' ? `第 ${position + 1} 张业务实拍分析完成` : `第 ${position + 1} 张业务实拍分析失败`,
        photo: tagged,
      })
    }
    event.sender.send('real-photo:progress', {
      phase: 'done', current: createdIndexes.length, total: createdIndexes.length,
      label: failed ? `分析完成，${failed} 张需要重试` : '所有业务实拍分析完成',
    })
    return { ok: true, imported: createdIndexes.length, skipped, failed, data: await loadProject() }
  } catch (error) { return { ok: false, error: error.message, data: currentRoot ? await loadProject() : undefined } }
})

ipcMain.handle('real-photo:retag', async (event, id) => {
  try {
    const items = (await readJson(dataPath(REAL_PHOTOS_FILE), [])).map(normalizeRealPhoto)
    const index = items.findIndex((item) => item.id === String(id))
    if (index < 0) throw new Error('没有找到要重新分析的实拍图片')
    const materialFile = path.join(currentRoot, '业务原始素材.md')
    const materialText = await exists(materialFile) ? await fsp.readFile(materialFile, 'utf8') : ''
    const tagged = await retagRealPhoto(items, index, materialText, (photo, phase) => {
      event.sender.send('real-photo:progress', {
        phase, current: 1, total: 1,
        label: phase === 'analyzing' ? '正在重新分析业务实拍' : photo.taggingStatus === 'ready' ? '业务实拍重新分析完成' : '业务实拍重新分析失败',
        photo,
      })
    })
    event.sender.send('real-photo:progress', {
      phase: 'done', current: 1, total: 1,
      label: tagged.taggingStatus === 'ready' ? '业务实拍重新分析完成' : '业务实拍重新分析失败',
    })
    if (tagged.taggingStatus !== 'ready') throw new Error(tagged.taggingError || '实拍图片分析失败')
    return { ok: true, data: await loadProject() }
  } catch (error) { return { ok: false, error: error.message, data: currentRoot ? await loadProject() : undefined } }
})

ipcMain.handle('real-photo:toggle', async (_event, id, enabled) => {
  try {
    const items = (await readJson(dataPath(REAL_PHOTOS_FILE), [])).map(normalizeRealPhoto)
    const index = items.findIndex((item) => item.id === String(id))
    if (index < 0) throw new Error('没有找到要修改的实拍图片')
    items[index] = { ...items[index], enabled: Boolean(enabled), updatedAt: now() }
    await saveRealPhotos(items)
    return { ok: true, data: await loadProject() }
  } catch (error) { return { ok: false, error: error.message } }
})

ipcMain.handle('real-photo:delete', async (_event, id) => {
  try {
    const items = (await readJson(dataPath(REAL_PHOTOS_FILE), [])).map(normalizeRealPhoto)
    const index = items.findIndex((item) => item.id === String(id))
    if (index < 0) throw new Error('没有找到要删除的实拍图片')
    const target = resolveProjectFile(items[index].relativePath)
    if (await exists(target)) await fsp.unlink(target)
    items.splice(index, 1)
    await saveRealPhotos(items)
    return { ok: true, data: await loadProject() }
  } catch (error) { return { ok: false, error: error.message } }
})

ipcMain.handle('settings:get', async () => (await userConfig()).value)
ipcMain.handle('clipboard:read-text', () => clipboard.readText())
ipcMain.handle('settings:save', async (_event, settings) => {
  try {
    const { file } = await userConfig()
    await writeJson(file, {
      baseUrl: String(settings.baseUrl || '').trim(),
      apiKey: String(settings.apiKey || '').trim(),
      model: String(settings.model || '').trim(),
      visionModel: String(settings.visionModel || settings.model || '').trim(),
      image: normalizeImageSettings(settings.image),
    })
    return { ok: true }
  } catch (error) { return { ok: false, error: error.message } }
})

ipcMain.handle('workflow:facts', async (event, resolution = '', thinking = true) => {
  const operation = 'facts'
  try {
    const project = await loadProject()
    if (!project?.material.exists) throw new Error('请先导入业务原始素材.md')
    const previous = project.facts?.conflicts?.length ? project.facts.conflicts : []
    const prompt = `请开放式提取并整理以下业务素材中的事实。可能关注产品、人群、场景、卖点、服务、流程、价格、时间、地点、名额、资质、安全、权益和限制，但这些不是必填字段；素材有什么就提取什么，不要把未提及内容判断为缺失。区分可确认事实、宣传性表达和冲突事实。\n\n${resolution ? `上次发现的冲突：${JSON.stringify(previous)}\n用户确认的统一口径：${resolution}\n请重新生成消除冲突后的完整业务事实。\n\n` : ''}原始素材：\n${project.material.content}\n\n输出对象格式：{"confirmedFacts":[{"category":"实际类别","items":["事实"]}],"promotionalExpressions":["表达"],"conflicts":[{"topic":"事项","versions":["口径1","口径2"],"question":"询问用户的简短明确问题"}]}`
    const result = await callModel(factsModelSystem, prompt, modelStream(event, operation), thinking)
    const facts = {
      confirmedFacts: Array.isArray(result.confirmedFacts) ? result.confirmedFacts : [],
      promotionalExpressions: Array.isArray(result.promotionalExpressions) ? result.promotionalExpressions : [],
      conflicts: Array.isArray(result.conflicts) ? result.conflicts : [], generatedAt: now(),
    }
    await writeJson(outputPath('业务事实.json'), facts)
    if (facts.conflicts.length === 0) await fsp.writeFile(outputPath('业务事实.md'), facts.confirmedFacts.map((g) => `## ${g.category}\n\n${(g.items || []).map((item) => `- ${item}`).join('\n')}`).join('\n\n'), 'utf8')
    modelStreamDone(event, operation)
    return { ok: true, data: await loadProject() }
  } catch (error) { modelStreamDone(event, operation); return { ok: false, error: error.message } }
})

ipcMain.handle('workflow:configure', async (_event, payload = {}) => {
  try {
    const project = await loadProject()
    if (!project?.facts || project.facts.conflicts?.length) throw new Error('请先形成无冲突的完整业务事实')
    const mode = normalizeContentMode(payload.mode)
    if (!mode) throw new Error('请选择显式宣传或生活化种草')
    const previousMode = project.generationConfig.mode
    const previousBrief = project.generationConfig.userBriefRaw
    const generationConfig = normalizeGenerationConfig({ mode, userBriefRaw: payload.userBriefRaw, updatedAt: now() })
    await writeJson(outputPath(GENERATION_CONFIG_FILE), generationConfig)
    const downstreamChanged = previousMode && (previousMode !== mode || previousBrief !== generationConfig.userBriefRaw)
    if (downstreamChanged && (project.strategies.length || project.drafts.length)) {
      await writeJson(outputPath('策略候选.json'), [])
      await writeJson(outputPath('策略选择.json'), { selectedStrategyIds: [], selectedStrategyId: '', strategyAdvice: {}, advice: '' })
      await writeJson(outputPath('终稿版本.json'), [])
      await writeJson(outputPath(IMAGE_TASKS_FILE), [])
    }
    return { ok: true, data: await loadProject() }
  } catch (error) { return { ok: false, error: error.message } }
})

ipcMain.handle('workflow:strategies', async (event, thinking = false) => {
  const operation = 'strategies'
  try {
    const project = await loadProject()
    if (!project?.facts || project.facts.conflicts?.length) throw new Error('请先形成无冲突的完整业务事实')
    const mode = project.generationConfig.mode
    if (!mode) throw new Error('请先选择本轮内容模式')
    const assets = assetMarkdownTables(project)
    const sameModeArchive = project.finalContents.filter((item) => item.status === 'archived' && item.mode === mode).slice(-80).map((item) => ({
      id: item.id,
      title: item.title,
      targetAudience: item.strategySnapshot.targetAudience || '',
      triggerMoment: item.strategySnapshot.triggerMoment || '',
      coreQuestion: item.strategySnapshot.coreQuestion || '',
      readerValue: item.strategySnapshot.readerValue || '',
      businessBridge: item.strategySnapshot.businessBridge || '',
      route: item.strategySnapshot.route || item.strategySnapshot.narrativeFrame || '',
    }))
    const modeContract = mode === 'native'
      ? `当前模式是“生活化种草”。每个策略必须只解决一个具体生活问题，提供独立于产品的阅读价值，默认只承接 1 个业务点、最多 2 个；默认不写价格、联系方式、完整行程、报名流程和强转化 CTA。产品不必出现在标题，正文先讲生活问题，再自然连接业务。不得伪装素人或虚构第一人称体验。`
      : `当前模式是“显式宣传”。可以明确出现产品或服务名称，也可以使用较高信息密度，但每个策略仍须有一条清晰主线，不能机械罗列全部资料。`
    const prompt = `${modeContract}

## 用户当前自然语言要求（最高创作优先级）
${project.generationConfig.userBriefRaw || '用户未补充要求'}

请根据业务事实和项目资产生成 3–5 个彼此明显不同的微选题策略。允许围绕地点、季节、生活时刻、用户疑问、情绪和稳定公共背景进行创意发散，但不得把发散内容写成客户已经提供的产品、服务或行程。每个策略只引用真正适合的 1–3 篇参考文案；没有合适参考时使用空数组。referenceIds 只能使用给出的稳定编号。

## 同模式已入库内容
以下内容已经使用过。不要再次生成“目标人群 + 核心问题 + 业务承接方式”完全一致的策略：
${sameModeArchive.length ? JSON.stringify(sameModeArchive) : '暂无已入库内容'}

## 已确认业务事实
${JSON.stringify(project.facts)}

## 关键词库
${assets.keywords}

## 参考文案库
${assets.references}

## 合规准则
${assets.rules}

输出对象格式：{"strategies":[{"name":"策略名称","angle":"一句话核心切入角度","targetAudience":"写给谁","triggerMoment":"什么时刻或场景","coreQuestion":"这篇只解决什么问题","readerValue":"读者能得到什么","businessBridge":"产品或业务如何自然出现","materialPoints":["实际使用的业务素材点"],"creativeContexts":["可扩展的生活背景或创意场景"],"searchPhrases":["自然搜索短语"],"route":"一句话写作路线","productExposure":"light|clear","referenceIds":["REF-0001"],"differenceFromArchive":"与已入库内容的具体差异","mustNotInclude":["本策略默认不写的内容"]}]}`
    const result = await callModel(modelSystem, prompt, modelStream(event, operation), thinking)
    const raw = Array.isArray(result.strategies) ? result.strategies.slice(0, 5) : []
    if (raw.length < 3) throw new Error('模型返回的有效策略少于 3 个，请重试')
    const validRefs = new Set(project.references.filter((item) => item.enabled !== false).map((item) => item.id))
    const meta = await readMeta()
    const strategies = raw.map((item) => {
      meta.counters.strategies = (meta.counters.strategies || 0) + 1
      return {
        id: `STR-${String(meta.counters.strategies).padStart(4, '0')}`,
        name: String(item.name || '未命名策略'), angle: String(item.angle || ''),
        mode,
        targetAudience: String(item.targetAudience || ''),
        triggerMoment: String(item.triggerMoment || ''),
        coreQuestion: String(item.coreQuestion || item.angle || ''),
        readerValue: String(item.readerValue || ''),
        businessBridge: String(item.businessBridge || ''),
        materialPoints: Array.isArray(item.materialPoints) ? item.materialPoints.slice(0, 4).map(String) : [],
        creativeContexts: Array.isArray(item.creativeContexts) ? item.creativeContexts.slice(0, 5).map(String) : [],
        searchPhrases: Array.isArray(item.searchPhrases) ? item.searchPhrases.slice(0, 5).map(String) : [],
        route: String(item.route || ''),
        productExposure: item.productExposure === 'clear' ? 'clear' : 'light',
        referenceIds: Array.isArray(item.referenceIds) ? item.referenceIds.filter((id) => validRefs.has(id)).slice(0, 3) : [],
        differenceFromArchive: String(item.differenceFromArchive || ''),
        mustNotInclude: Array.isArray(item.mustNotInclude) ? item.mustNotInclude.slice(0, 6).map(String) : [],
        bestFor: String(item.bestFor || item.readerValue || ''), createdAt: now(),
      }
    })
    await writeMeta(meta)
    await writeJson(outputPath('策略候选.json'), strategies)
    await writeJson(outputPath('策略选择.json'), { selectedStrategyIds: [], selectedStrategyId: '', strategyAdvice: {}, advice: '' })
    modelStreamDone(event, operation)
    return { ok: true, data: await loadProject() }
  } catch (error) { modelStreamDone(event, operation); return { ok: false, error: error.message } }
})

ipcMain.handle('workflow:select', async (_event, payload) => {
  try {
    const project = await loadProject()
    const ids = Array.isArray(payload.ids) ? [...new Set(payload.ids.map(String))] : payload.id ? [String(payload.id)] : []
    if (!ids.length || ids.some((id) => !project.strategies.some((item) => item.id === id))) throw new Error('请至少选择一个有效策略')
    const strategyAdvice = Object.fromEntries(ids.map((id) => [id, String(payload.strategyAdvice?.[id] || '').trim()]).filter(([, value]) => value))
    await writeJson(outputPath('策略选择.json'), { selectedStrategyIds: ids, selectedStrategyId: ids[0], strategyAdvice, advice: '', selectedAt: now() })
    return { ok: true, data: await loadProject() }
  } catch (error) { return { ok: false, error: error.message } }
})

ipcMain.handle('workflow:new', async () => {
  try {
    const project = await loadProject()
    if (!project) throw new Error('请先创建或打开项目')
    const hasProgress = project.strategies.length > 0 || project.drafts.length > 0 || project.selectedStrategyIds.length > 0
    const history = [...project.generationHistory]
    if (hasProgress) {
      history.push({
        id: project.currentGeneration.id,
        createdAt: project.currentGeneration.createdAt,
        archivedAt: now(),
        material: project.material,
        keywords: project.keywords,
        references: project.references,
        rules: project.rules,
        facts: project.facts,
        generationConfig: project.generationConfig,
        strategies: project.strategies,
        selectedStrategyIds: project.selectedStrategyIds,
        selectedStrategyId: project.selectedStrategyId,
        strategyAdvice: project.strategyAdvice,
        advice: project.advice,
        drafts: project.drafts,
        imageTasks: project.imageTasks,
      })
      await writeJson(outputPath('生成记录.json'), history)
    }
    const meta = await readMeta()
    meta.counters = meta.counters || {}
    meta.counters.generations = Math.max(Number(meta.counters.generations) || 1, history.length) + 1
    const currentGeneration = { id: `GEN-${String(meta.counters.generations).padStart(4, '0')}`, createdAt: now() }
    await writeMeta(meta)
    await writeJson(outputPath('当前生成.json'), currentGeneration)
    await writeJson(outputPath(GENERATION_CONFIG_FILE), normalizeGenerationConfig())
    await writeJson(outputPath('策略候选.json'), [])
    await writeJson(outputPath('策略选择.json'), { selectedStrategyIds: [], selectedStrategyId: '', strategyAdvice: {}, advice: '' })
    await writeJson(outputPath('终稿版本.json'), [])
    await writeJson(outputPath(IMAGE_TASKS_FILE), [])
    return { ok: true, data: await loadProject() }
  } catch (error) { return { ok: false, error: error.message } }
})

ipcMain.handle('generation:delete', async (_event, id) => {
  try {
    const project = await loadProject()
    if (!project) throw new Error('请先创建或打开项目')
    const targetId = String(id || '').trim()
    if (!targetId) throw new Error('请指定要删除的生成记录')
    if (targetId === project.currentGeneration.id) throw new Error('当前生成轮次不能删除，请先新建一轮生成')
    if (!project.generationHistory.some((record) => record.id === targetId)) throw new Error('没有找到这条生成记录')
    await writeJson(outputPath('生成记录.json'), project.generationHistory.filter((record) => record.id !== targetId))
    return { ok: true, data: await loadProject() }
  } catch (error) { return { ok: false, error: error.message } }
})

async function makeDraft(event, revisionRequest = '', baseVersion = null, thinking = false) {
  const project = await loadProject()
  if (!project?.selectedStrategyIds?.length) throw new Error('请先选择至少一个策略')
  const baseDraft = revisionRequest
    ? project.drafts.find((item) => item.version === Number(baseVersion)) || project.currentDraft
    : null
  const strategyIds = baseDraft ? [baseDraft.strategyId] : project.selectedStrategyIds
  const strategies = strategyIds.map((id) => project.strategies.find((item) => item.id === id)).filter(Boolean)
  if (!strategies.length) throw new Error('所选策略已不存在')
  const mode = project.generationConfig.mode || strategies[0]?.mode || 'explicit'
  const archiveExclusions = project.finalContents.filter((item) => item.status === 'archived' && item.mode === mode).slice(-40).map((item) => ({
    id: item.id, title: item.title, strategySnapshot: item.strategySnapshot,
  }))
  const drafts = [...project.drafts]
  for (const [index, strategy] of strategies.entries()) {
    const selectedReferences = project.references.filter((item) => item.enabled !== false && strategy.referenceIds.includes(item.id))
    const assets = assetMarkdownTables(project, selectedReferences)
    const base = revisionRequest && baseDraft
      ? `请根据用户最新修改要求更新当前文案。用户最新要求优先于当前文案、原策略、参考文案和系统默认写法。如果最新要求改变人群、角度、结构、卖点或内容模式，允许改变策略并返回更新后的 strategySnapshot，不要为了维持原策略而削弱用户要求。\n当前终稿：${JSON.stringify(baseDraft)}\n用户最新修改要求：${revisionRequest}`
      : '请根据选定微策略直接生成一篇独立终稿。'
    const strategyAdvice = project.strategyAdvice?.[strategy.id] || project.advice || '无'
    const modeContract = mode === 'native'
      ? '生活化种草模式：只围绕一个具体生活问题展开，先提供独立内容价值，再自然连接一至两个已确认业务点；默认不写完整产品介绍、价格、联系方式、完整行程、报名流程或强转化 CTA。标题不强制出现产品名。不得虚构亲身体验。'
      : '显式宣传模式：可以明确介绍产品或服务，但必须保持单一主线，避免把全部业务事实机械堆入一篇文案。'
    const prompt = `${base}

## 硬边界
只能把以下内容作为业务事实：${JSON.stringify(project.facts)}
${modeContract}

## 用户自然语言要求（最高创作优先级）
本轮总体要求：${project.generationConfig.userBriefRaw || '无'}
该策略补充要求：${strategyAdvice}
${revisionRequest ? `本次最新修改要求：${revisionRequest}` : ''}

## 本轮任务
选定策略：${JSON.stringify(strategy)}

## 同模式已入库内容（避免自动重复）
${archiveExclusions.length ? JSON.stringify(archiveExclusions) : '暂无'}

## 关键词库
${assets.keywords}

## 合规准则
${assets.rules}

## 只可参考以下已选中的完整参考文案
${assets.references}

用户当前要求优先于策略、关键词和参考文案。关键词自然融入，不机械堆砌；参考文案只模仿选题方法、结构、节奏和语感，不复制原句或业务信息。如果用户要求与事实或合规硬边界冲突，不得编造，并在 instructionReport.notFollowed 中说明。输出对象格式：{"title":"标题","body":"正文","hashtags":["话题标签，不含#"],"strategySnapshot":{"targetAudience":"最终目标人群","triggerMoment":"最终触发时刻","coreQuestion":"最终核心问题","readerValue":"最终读者收益","businessBridge":"最终业务承接方式","route":"最终写作路线"},"instructionReport":{"followed":["已执行要求"],"overrodeStrategy":false,"notFollowed":[{"instruction":"未执行要求","reason":"原因"}]}}`
    const operation = `draft:${strategy.id}:${index + 1}/${strategies.length}`
    const result = await callModel(modelSystem, prompt, modelStream(event, operation), thinking)
    if (!result.title || !result.body) throw new Error('模型返回的终稿缺少标题或正文，请重试')
    const version = drafts.length + 1
    const draft = {
      version, title: String(result.title).trim(), body: String(result.body).trim(),
      hashtags: Array.isArray(result.hashtags) ? result.hashtags.map((tag) => String(tag).replace(/^#/, '').trim()).filter(Boolean) : [],
      strategyId: strategy.id, referenceIds: strategy.referenceIds, revisionRequest,
      strategySnapshot: result.strategySnapshot && typeof result.strategySnapshot === 'object' ? result.strategySnapshot : {
        targetAudience: strategy.targetAudience || '', triggerMoment: strategy.triggerMoment || '', coreQuestion: strategy.coreQuestion || strategy.angle || '',
        readerValue: strategy.readerValue || '', businessBridge: strategy.businessBridge || '', route: strategy.route || '',
      },
      instructionReport: result.instructionReport && typeof result.instructionReport === 'object' ? result.instructionReport : { followed: [], overrodeStrategy: false, notFollowed: [] },
      createdAt: now(), confirmed: false,
    }
    for (let draftIndex = 0; draftIndex < drafts.length; draftIndex += 1) {
      if (drafts[draftIndex].strategyId === strategy.id) drafts[draftIndex] = { ...drafts[draftIndex], confirmed: false }
    }
    drafts.push(draft)
    await writeJson(outputPath('终稿版本.json'), drafts)
    const markdown = `# ${draft.title}\n\n${draft.body}\n\n${draft.hashtags.map((tag) => `#${tag}`).join(' ')}\n`
    await fsp.writeFile(outputPath(`${project.currentGeneration.id}_终稿_v${version}.md`), markdown, 'utf8')
    modelStreamDone(event, operation)
  }
  return loadProject()
}
ipcMain.handle('workflow:draft', async (event, thinking = false) => {
  try { return { ok: true, data: await makeDraft(event, '', null, thinking) } } catch (error) { return { ok: false, error: error.message } }
})
ipcMain.handle('workflow:revise', async (event, request, version, thinking = false) => {
  try {
    if (!String(request || '').trim()) throw new Error('请填写本次修改要求')
    return { ok: true, data: await makeDraft(event, String(request).trim(), version, thinking) }
  } catch (error) { return { ok: false, error: error.message } }
})
ipcMain.handle('workflow:manual-save', async (_event, payload) => {
  try {
    const project = await loadProject()
    const source = project?.drafts.find((item) => item.version === Number(payload.version))
    if (!source) throw new Error('没有找到要编辑的文案')
    const title = String(payload.title || '').trim()
    const body = String(payload.body || '').trim()
    if (!title || !body) throw new Error('标题和正文不能为空')
    const hashtags = Array.isArray(payload.hashtags) ? payload.hashtags : String(payload.hashtags || '').split(/[\s,，、]+/)
    const draft = { ...source, version: project.drafts.length + 1, title, body, hashtags: [...new Set(hashtags.map((tag) => String(tag).replace(/^#+/, '').trim()).filter(Boolean))], revisionRequest: '手动编辑', createdAt: now(), confirmed: false }
    const previous = project.drafts.map((item) => item.strategyId === source.strategyId ? { ...item, confirmed: false } : item)
    await writeJson(outputPath('终稿版本.json'), [...previous, draft])
    const markdown = `# ${draft.title}\n\n${draft.body}\n\n${draft.hashtags.map((tag) => `#${tag}`).join(' ')}\n`
    await fsp.writeFile(outputPath(`${project.currentGeneration.id}_终稿_v${draft.version}.md`), markdown, 'utf8')
    return { ok: true, data: await loadProject() }
  } catch (error) { return { ok: false, error: error.message } }
})
ipcMain.handle('workflow:confirm', async (_event, version) => {
  try {
    const project = await loadProject()
    if (!project?.drafts.length) throw new Error('还没有可以确认的终稿')
    const targetVersion = Number(version) || project.currentDraft.version
    const target = project.drafts.find((item) => item.version === targetVersion)
    if (!target) throw new Error('没有找到要确认的版本')
    const drafts = project.drafts.map((item) => item.strategyId === target.strategyId ? { ...item, confirmed: item.version === targetVersion } : item)
    await writeJson(outputPath('终稿版本.json'), drafts)
    const draft = drafts.find((item) => item.version === targetVersion)
    const markdown = `# ${draft.title}\n\n${draft.body}\n\n${draft.hashtags.map((tag) => `#${tag}`).join(' ')}\n`
    await fsp.writeFile(outputPath(`${project.currentGeneration.id}_最终输出_v${draft.version}.md`), markdown, 'utf8')
    await fsp.writeFile(outputPath('最终输出.md'), markdown, 'utf8')
    return { ok: true, data: await loadProject() }
  } catch (error) { return { ok: false, error: error.message } }
})

ipcMain.handle('workflow:archive-final', async (_event, version, force = false, generationId) => {
  try {
    const rootProject = await loadProject()
    const context = findGenerationContext(rootProject, generationId)
    if (!context) throw new Error('没有找到要入库的生成记录')
    const project = context.generationProject
    const draft = project?.drafts.find((item) => item.version === Number(version) && item.confirmed)
    if (!draft) throw new Error('请先确认这篇文案，再执行入库')
    const mode = project.generationConfig.mode || project.strategies.find((item) => item.id === draft.strategyId)?.mode
    if (!mode) throw new Error('这篇文案缺少内容模式，请先重新选择模式并生成')
    const active = project.finalContents.filter((item) => item.status === 'archived')
    const existingVersion = active.find((item) => item.generationId === project.currentGeneration.id && item.draftVersion === draft.version)
    if (existingVersion) return { ok: true, data: await loadProject(), archivedId: existingVersion.id }
    const textHash = finalTextHash(draft.title, draft.body, draft.hashtags)
    const duplicate = active.find((item) => item.mode === mode && item.textHash === textHash)
    if (duplicate && !force) return { ok: false, error: `这篇文字与已入库内容 ${duplicate.id} 完全一致`, duplicateId: duplicate.id }
    const strategy = project.strategies.find((item) => item.id === draft.strategyId) || {}
    const candidateTasks = project.imageTasks.filter((item) => item.draftVersion === draft.version && item.strategyId === draft.strategyId)
    const task = candidateTasks.find((item) => item.plan?.pages?.length && item.plan.pages.every((page) => item.currentImageIds?.[page.id])) || candidateTasks.at(-1)
    const imagePaths = task?.plan?.pages?.map((page) => task.images.find((image) => image.id === task.currentImageIds?.[page.id])?.relativePath).filter(Boolean) || []
    const meta = await readMeta()
    meta.counters = meta.counters || {}
    meta.counters.finalContents = (Number(meta.counters.finalContents) || 0) + 1
    const item = normalizeFinalContent({
      id: `FINAL-${String(meta.counters.finalContents).padStart(4, '0')}`,
      mode,
      status: 'archived',
      generationId: project.currentGeneration.id,
      draftVersion: draft.version,
      strategyId: draft.strategyId,
      title: draft.title,
      body: draft.body,
      hashtags: draft.hashtags,
      strategySnapshot: { ...strategy, ...(draft.strategySnapshot || {}) },
      userInstructionsRaw: [project.generationConfig.userBriefRaw, project.strategyAdvice?.[draft.strategyId], draft.revisionRequest].filter(Boolean),
      referenceIds: draft.referenceIds,
      imageTaskId: task?.id || '',
      imagePaths,
      imageMode: task?.mode || 'ai_generated',
      textHash,
      duplicateOverride: Boolean(force),
      archivedAt: now(),
      removedAt: null,
    })
    await writeMeta(meta)
    await writeJson(dataPath(FINAL_CONTENTS_FILE), [...project.finalContents, item])
    return { ok: true, data: await loadProject(), archivedId: item.id }
  } catch (error) { return { ok: false, error: error.message } }
})

ipcMain.handle('final-content:remove', async (_event, id) => {
  try {
    const project = await loadProject()
    const targetId = String(id || '')
    if (!project?.finalContents.some((item) => item.id === targetId && item.status === 'archived')) throw new Error('没有找到这条已入库内容')
    const items = project.finalContents.map((item) => item.id === targetId ? { ...item, status: 'removed', removedAt: now() } : item)
    await writeJson(dataPath(FINAL_CONTENTS_FILE), items)
    return { ok: true, data: await loadProject() }
  } catch (error) { return { ok: false, error: error.message } }
})

function findGenerationContext(project, generationId) {
  if (!project) return null
  const targetId = String(generationId || project.currentGeneration.id)
  if (targetId === project.currentGeneration.id) {
    return { generationProject: project, record: null, recordIndex: -1 }
  }
  const recordIndex = project.generationHistory.findIndex((item) => item.id === targetId)
  if (recordIndex < 0) return null
  const record = project.generationHistory[recordIndex]
  const selectedStrategyIds = Array.isArray(record.selectedStrategyIds) && record.selectedStrategyIds.length
    ? record.selectedStrategyIds
    : record.selectedStrategyId ? [record.selectedStrategyId] : []
  const drafts = Array.isArray(record.drafts) ? record.drafts : []
  const generationProject = {
    ...project,
    material: record.material || project.material,
    keywords: record.keywords || project.keywords,
    references: record.references || project.references,
    rules: record.rules || project.rules,
    facts: Object.prototype.hasOwnProperty.call(record, 'facts') ? record.facts : project.facts,
    generationConfig: record.generationConfig || normalizeGenerationConfig(),
    strategies: Array.isArray(record.strategies) ? record.strategies : [],
    selectedStrategyIds,
    selectedStrategyId: record.selectedStrategyId || selectedStrategyIds[0] || '',
    strategyAdvice: record.strategyAdvice && typeof record.strategyAdvice === 'object' ? record.strategyAdvice : {},
    advice: record.advice || '',
    drafts,
    currentDraft: drafts.at(-1) || null,
    imageTasks: Array.isArray(record.imageTasks) ? record.imageTasks.map(normalizeImageTask) : [],
    currentGeneration: { id: record.id, createdAt: record.createdAt },
  }
  return { generationProject, record, recordIndex }
}

async function saveGenerationImageTasks(project, context, tasks) {
  if (context.recordIndex < 0) {
    await saveImageTasks(tasks)
    return
  }
  const history = [...project.generationHistory]
  history[context.recordIndex] = { ...context.record, imageTasks: tasks }
  await writeJson(outputPath('生成记录.json'), history)
}

ipcMain.handle('real-poster:create-plan', async (event, version, generationId) => {
  const operation = `real-poster-plan:${Number(version) || 0}`
  try {
    const rootProject = await loadProject()
    const context = findGenerationContext(rootProject, generationId)
    if (!context) throw new Error('没有找到要制作配图的生成记录')
    const project = context.generationProject
    const draft = project?.drafts.find((item) => item.version === Number(version) && item.confirmed)
    if (!draft) throw new Error('请先确认这篇文案，再制作实拍宣传图')
    const plan = await createRealPosterPlan(project, draft, modelStream(event, operation))
    modelStreamDone(event, operation)
    const taskId = `REAL-${project.currentGeneration.id}-${draft.strategyId}-V${draft.version}`
    const tasks = [...project.imageTasks]
    const index = tasks.findIndex((item) => item.id === taskId)
    const previous = index >= 0 ? normalizeImageTask(tasks[index]) : null
    const artifactDir = projectRelative(path.join(outputPath('配图'), project.currentGeneration.id, `${draft.strategyId}_v${draft.version}_real`))
    const task = {
      id: taskId, mode: 'real_photo_poster', generationId: project.currentGeneration.id,
      strategyId: draft.strategyId, draftVersion: draft.version, plan, brief: null,
      prompt: '', negativePrompt: '', artifactDir,
      images: previous?.images || [], currentImageIds: {}, selectedImageId: '',
      createdAt: previous?.createdAt || now(), updatedAt: now(),
    }
    if (index >= 0) tasks[index] = task
    else tasks.push(task)
    await saveGenerationImageTasks(rootProject, context, tasks)
    await saveImageTaskArtifacts(task)
    return { ok: true, data: await loadProject(), taskId }
  } catch (error) {
    modelStreamDone(event, operation)
    return { ok: false, error: error.message, data: currentRoot ? await loadProject() : undefined }
  }
})

ipcMain.handle('image:create-set', async (event, version, generationId) => {
  const planningOperation = `image-plan:${Number(version) || 0}`
  let planningStreamActive = false
  try {
    const rootProject = await loadProject()
    const context = findGenerationContext(rootProject, generationId)
    if (!context) throw new Error('没有找到要制作配图的生成记录')
    const project = context.generationProject
    const draft = project?.drafts.find((item) => item.version === Number(version) && item.confirmed)
    if (!draft) throw new Error('请先确认这篇文案，再生成整套配图')
    const taskId = `IMG-${project.currentGeneration.id}-${draft.strategyId}-V${draft.version}`
    const tasks = [...project.imageTasks]
    let taskIndex = tasks.findIndex((item) => item.id === taskId)
    let task = taskIndex >= 0 ? normalizeImageTask(tasks[taskIndex]) : null
    const usableReferenceIds = new Set(project.imageReferences.filter((item) => item.enabled !== false && item.taggingStatus === 'ready').map((item) => item.id))
    const planNeedsReferences = !task?.plan?.pages?.every((page) => page.referenceImageIds?.some((id) => usableReferenceIds.has(id)))
    const planNeedsPhotographicUpgrade = task && Number(task.plan?.version || 0) < 3

    if (!task || task.plan.pages.length < 4 || planNeedsReferences || planNeedsPhotographicUpgrade) {
      event.sender.send('image:progress', { version: draft.version, phase: 'planning', current: 0, total: 0, label: '正在规划整套图片' })
      planningStreamActive = true
      const plan = await createImagePlan(project, draft, modelStream(event, planningOperation))
      modelStreamDone(event, planningOperation)
      planningStreamActive = false
      const artifactDir = projectRelative(path.join(outputPath('配图'), project.currentGeneration.id, `${draft.strategyId}_v${draft.version}`))
      task = {
        id: taskId,
        mode: 'ai_generated',
        generationId: project.currentGeneration.id,
        strategyId: draft.strategyId,
        draftVersion: draft.version,
        plan,
        brief: plan.pages[0].brief,
        prompt: '',
        negativePrompt: '',
        artifactDir,
        images: task?.images || [],
        // 旧版只有候选封面；升级为套图时保留历史文件，但整套页面全部重新生成。
        currentImageIds: {},
        selectedImageId: '',
        createdAt: task?.createdAt || now(),
        updatedAt: now(),
      }
      if (taskIndex >= 0) tasks[taskIndex] = task
      else { tasks.push(task); taskIndex = tasks.length - 1 }
      await saveGenerationImageTasks(rootProject, context, tasks)
      await saveImageTaskArtifacts(task)
      event.sender.send('image:progress', {
        version: draft.version, phase: 'planning', current: 0, total: task.plan.pages.length,
        label: '套图画布已展开', task,
      })
    }

    const missingPages = task.plan.pages.filter((page) => !task.currentImageIds?.[page.id])
    for (let index = 0; index < missingPages.length; index += 1) {
      const page = missingPages[index]
      event.sender.send('image:progress', {
        version: draft.version,
        pageId: page.id,
        phase: 'generating',
        current: index + 1,
        total: missingPages.length,
        label: `正在生成${page.label}`,
        task,
      })
      const image = await generateImagePage(project, task, page, page.brief)
      task.images = [...task.images, image]
      task.currentImageIds = { ...task.currentImageIds, [page.id]: image.id }
      task.prompt = image.prompt
      task.negativePrompt = image.negativePrompt
      task.updatedAt = now()
      tasks[taskIndex] = task
      await saveGenerationImageTasks(rootProject, context, tasks)
      await saveImageTaskArtifacts(task)
      event.sender.send('image:progress', {
        version: draft.version, pageId: page.id, phase: 'page-done',
        current: index + 1, total: missingPages.length, label: `${page.label}已完成`, task,
      })
    }
    event.sender.send('image:progress', { version: draft.version, phase: 'done', current: task.plan.pages.length, total: task.plan.pages.length, label: '整套配图已生成', task })
    return { ok: true, data: await loadProject() }
  } catch (error) {
    if (planningStreamActive) modelStreamDone(event, planningOperation)
    return { ok: false, error: error.message, data: currentRoot ? await loadProject() : undefined }
  }
})

function findImageTaskContext(project, taskId) {
  const normalizedId = String(taskId)
  const currentIndex = project?.imageTasks.findIndex((item) => item.id === normalizedId) ?? -1
  if (currentIndex >= 0) return { task: normalizeImageTask(project.imageTasks[currentIndex]), taskIndex: currentIndex, recordIndex: -1, record: null }
  for (let recordIndex = 0; recordIndex < (project?.generationHistory || []).length; recordIndex += 1) {
    const record = project.generationHistory[recordIndex]
    const taskIndex = (record.imageTasks || []).findIndex((item) => item.id === normalizedId)
    if (taskIndex >= 0) return { task: normalizeImageTask(record.imageTasks[taskIndex]), taskIndex, recordIndex, record }
  }
  return null
}

ipcMain.handle('real-poster:generate-decoration', async (_event, taskId, pageId, baseDataUrl) => {
  try {
    const project = await loadProject()
    const located = findImageTaskContext(project, taskId)
    if (!located) throw new Error('没有找到要进行 AI 装饰的实拍宣传图')
    const tasks = located.record ? [...(located.record.imageTasks || [])] : [...project.imageTasks]
    const task = located.task
    if (!task || task.mode !== 'real_photo_poster') throw new Error('没有找到要进行 AI 装饰的实拍宣传图')
    const page = task.plan.pages.find((item) => item.id === String(pageId))
    if (!page) throw new Error('没有找到要进行 AI 装饰的页面')
    if (!(page.sourcePhotoIds || []).length) throw new Error('请先为这一页选择实拍图片')
    if (!String(page.title || '').trim()) throw new Error('请先填写宣传图主标题')
    const generated = await callRealPosterDecorationModel({ ...page, visualContinuity: task.plan.visualContinuity }, baseDataUrl)
    const folder = resolveProjectFile(task.artifactDir)
    const revision = task.images.filter((item) => item.pageId === page.id).length + 1
    const stamp = Date.now()
    const file = path.join(folder, `${page.id.toLowerCase()}-v${String(revision).padStart(2, '0')}-ai-${stamp}.png`)
    await downloadGeneratedImage(generated.url, file)
    const image = {
      id: `${task.id}-${page.id}-${stamp}`, pageId: page.id, revision,
      feedback: '一键 AI 装饰', relativePath: projectRelative(file), createdAt: now(),
      model: generated.model, size: '1080x1440', seed: generated.seed, requestId: generated.requestId,
      prompt: generated.prompt, negativePrompt: generated.negativePrompt,
      referenceImageIds: generated.referenceImageIds, sourcePhotoIds: page.sourcePhotoIds,
      renderType: 'real_photo_ai_decorated',
    }
    task.images = [...task.images, image]
    task.currentImageIds = { ...task.currentImageIds, [page.id]: image.id }
    task.prompt = image.prompt
    task.negativePrompt = image.negativePrompt
    task.updatedAt = now()
    tasks[located.taskIndex] = task
    await saveGenerationImageTasks(project, located, tasks)
    await saveImageTaskArtifacts(task)
    return { ok: true, data: await loadProject(), pageId: page.id }
  } catch (error) { return { ok: false, error: error.message } }
})

ipcMain.handle('real-poster:select-variant', async (_event, taskId, pageId, imageId) => {
  try {
    const project = await loadProject()
    const located = findImageTaskContext(project, taskId)
    if (!located) throw new Error('没有找到要切换版本的实拍宣传图任务')
    const tasks = located.record ? [...(located.record.imageTasks || [])] : [...project.imageTasks]
    const task = located.task
    if (task.mode !== 'real_photo_poster') throw new Error('当前任务不是实拍宣传图')
    const page = task.plan.pages.find((item) => item.id === String(pageId))
    if (!page) throw new Error('没有找到要切换版本的页面')
    const image = task.images.find((item) => item.id === String(imageId) && item.pageId === page.id)
    if (!image) throw new Error('没有找到要切换的图片版本')
    task.currentImageIds = { ...task.currentImageIds, [page.id]: image.id }
    task.updatedAt = now()
    tasks[located.taskIndex] = task
    await saveGenerationImageTasks(project, located, tasks)
    await saveImageTaskArtifacts(task)
    return { ok: true, data: await loadProject(), pageId: page.id }
  } catch (error) { return { ok: false, error: error.message, data: currentRoot ? await loadProject() : undefined } }
})

ipcMain.handle('real-poster:save-page', async (_event, taskId, pageId, dataUrl, pageUpdate) => {
  try {
    const project = await loadProject()
    const located = findImageTaskContext(project, taskId)
    if (!located) throw new Error('没有找到实拍宣传图任务')
    const tasks = located.record ? [...(located.record.imageTasks || [])] : [...project.imageTasks]
    const task = located.task
    if (task.mode !== 'real_photo_poster') throw new Error('当前任务不是实拍宣传图')
    let pageIndex = task.plan.pages.findIndex((item) => item.id === String(pageId))
    const creatingPage = pageIndex < 0 && pageUpdate?.createNew === true
    if (pageIndex < 0 && !creatingPage) throw new Error('没有找到要保存的宣传图页面')
    if (creatingPage && task.plan.pages.length >= 12) throw new Error('单个实拍宣传图任务最多包含 12 个页面')
    let page
    if (creatingPage) {
      const usedNumbers = task.plan.pages.map((item) => /^REAL-PAGE-(\d+)$/.exec(String(item.id))?.[1]).filter(Boolean).map(Number)
      const nextNumber = Math.max(0, ...usedNumbers) + 1
      page = {
        id: `REAL-PAGE-${String(nextNumber).padStart(2, '0')}`,
        role: 'content',
        label: `内容页 ${task.plan.pages.length}`,
        purpose: '用户手动新建的实拍宣传图',
        promotionTheme: String(pageUpdate.title || '').trim(),
        title: String(pageUpdate.title || '').trim(),
        subtitle: '',
        sourcePhotoIds: [],
        photoMatches: [],
        groupReason: '用户手动选择图片并完成排版',
        evidenceQuotes: [],
        relevanceLevel: 'contextual',
        relevanceReason: '用户手动创建',
        needsReview: true,
        layoutTemplateId: 'single',
        textPosition: 'bottom',
        accentColor: '#ffd43b',
        referenceImageIds: [],
      }
      pageIndex = task.plan.pages.length
    } else page = task.plan.pages[pageIndex]
    if (pageUpdate && typeof pageUpdate === 'object') {
      const sourcePhotoIds = Array.isArray(pageUpdate.sourcePhotoIds) ? pageUpdate.sourcePhotoIds.map(String).filter(Boolean).slice(0, 4) : []
      if (!sourcePhotoIds.length) throw new Error('宣传图至少需要一张实拍图片')
      if (new Set(sourcePhotoIds).size !== sourcePhotoIds.length) throw new Error('同一张实拍图片不能在一页中重复使用')
      const validPhotoIds = new Set(project.realPhotos.filter((item) => item.enabled !== false && item.taggingStatus === 'ready').map((item) => item.id))
      if (sourcePhotoIds.some((id) => !validPhotoIds.has(id))) throw new Error('宣传图中包含未启用或尚未完成分析的实拍图片')
      const layoutsByCount = {
        1: ['single'],
        2: ['split-vertical', 'split-horizontal', 'hero-two'],
        3: ['left-three', 'hero-three'],
        4: ['hero-four', 'grid-four'],
      }
      const layoutTemplateId = String(pageUpdate.layoutTemplateId || '')
      if (!layoutsByCount[sourcePhotoIds.length]?.includes(layoutTemplateId)) throw new Error('当前图片数量与所选版式不匹配')
      const title = String(pageUpdate.title || '').trim().slice(0, 40)
      if (!title) throw new Error('主标题不能为空')
      const subtitle = String(pageUpdate.subtitle || '').trim().slice(0, 60)
      const textPosition = pageUpdate.textPosition === 'top' ? 'top' : 'bottom'
      const accentColor = /^#[0-9a-f]{6}$/i.test(String(pageUpdate.accentColor || '')) ? String(pageUpdate.accentColor) : '#ffd43b'
      const previousMatches = new Map((page.photoMatches || []).map((item) => [item.photoId, item]))
      const photoMatches = sourcePhotoIds.map((photoId) => previousMatches.get(photoId) || {
        photoId,
        relevanceLevel: 'contextual',
        evidenceQuotes: [],
        reason: '用户手动选择的实拍图片',
      })
      const needsReview = photoMatches.some((item) => ['contextual', 'fallback'].includes(item.relevanceLevel))
      page = { ...page, title, subtitle, sourcePhotoIds, photoMatches, needsReview, layoutTemplateId, textPosition, accentColor }
      task.plan = {
        ...task.plan,
        pages: creatingPage
          ? [...task.plan.pages, page]
          : task.plan.pages.map((item, index) => index === pageIndex ? page : item),
      }
    }
    const match = String(dataUrl || '').match(/^data:image\/png;base64,([A-Za-z0-9+/=]+)$/)
    if (!match) throw new Error('宣传图渲染结果格式不正确')
    const buffer = Buffer.from(match[1], 'base64')
    if (!buffer.length || buffer.length > 30 * 1024 * 1024) throw new Error('宣传图渲染结果为空或过大')
    const folder = resolveProjectFile(task.artifactDir)
    const revision = task.images.filter((item) => item.pageId === page.id).length + 1
    const stamp = Date.now()
    const file = path.join(folder, `${page.id.toLowerCase()}-v${String(revision).padStart(2, '0')}-${stamp}.png`)
    await writeBuffer(file, buffer)
    const image = {
      id: `${task.id}-${page.id}-${stamp}`, pageId: page.id, revision, feedback: '',
      relativePath: projectRelative(file), createdAt: now(), model: 'local-canvas', size: '1080x1440',
      seed: 0, requestId: '', prompt: page.title, negativePrompt: '', referenceImageIds: [],
      sourcePhotoIds: page.sourcePhotoIds, renderType: 'real_photo_poster',
    }
    task.images = [...task.images, image]
    task.currentImageIds = { ...task.currentImageIds, [page.id]: image.id }
    task.updatedAt = now()
    tasks[located.taskIndex] = task
    await saveGenerationImageTasks(project, located, tasks)
    await saveImageTaskArtifacts(task)
    return { ok: true, data: await loadProject(), pageId: page.id }
  } catch (error) { return { ok: false, error: error.message, data: currentRoot ? await loadProject() : undefined } }
})

ipcMain.handle('image:regenerate-page', async (event, taskId, pageId, feedback) => {
  try {
    const project = await loadProject()
    const located = findImageTaskContext(project, taskId)
    if (!located) throw new Error('没有找到这套配图')
    const tasks = located.record ? [...(located.record.imageTasks || [])] : [...project.imageTasks]
    const task = located.task
    const generationProject = located.record ? {
      ...project,
      facts: located.record.facts || project.facts,
      strategies: located.record.strategies,
      rules: located.record.rules || project.rules,
      drafts: located.record.drafts,
    } : project
    const pageIndex = task.plan.pages.findIndex((item) => item.id === String(pageId))
    if (pageIndex < 0) throw new Error('没有找到要重新生成的页面')
    const page = task.plan.pages[pageIndex]

    event.sender.send('image:progress', { version: task.draftVersion, pageId: page.id, phase: 'rewriting', current: 0, total: 1, label: `正在重写${page.label}提示词`, task })
    const rewritten = await rewriteImagePage(generationProject, task, page, feedback)
    const rewrittenBrief = rewritten.brief
    const generationPage = { ...page, referenceImageIds: rewritten.referenceImageIds }
    event.sender.send('image:progress', { version: task.draftVersion, pageId: page.id, phase: 'generating', current: 1, total: 1, label: `正在重新生成${page.label}`, task })
    const image = await generateImagePage(generationProject, task, generationPage, rewrittenBrief, feedback)

    const rewrittenPage = { ...generationPage, title: rewrittenBrief.coverTitle, purpose: rewrittenBrief.purpose, brief: rewrittenBrief }
    task.plan = { ...task.plan, pages: task.plan.pages.map((item, itemIndex) => itemIndex === pageIndex ? rewrittenPage : item) }
    task.images = [...task.images, image]
    task.currentImageIds = { ...task.currentImageIds, [page.id]: image.id }
    task.brief = task.plan.pages[0].brief
    task.prompt = image.prompt
    task.negativePrompt = image.negativePrompt
    task.updatedAt = now()
    tasks[located.taskIndex] = task
    if (located.record) {
      const history = [...project.generationHistory]
      history[located.recordIndex] = { ...located.record, imageTasks: tasks }
      await writeJson(outputPath('生成记录.json'), history)
    } else await saveImageTasks(tasks)
    await saveImageTaskArtifacts(task)
    event.sender.send('image:progress', { version: task.draftVersion, pageId: page.id, phase: 'done', current: 1, total: 1, label: `${page.label}已更新`, task })
    return { ok: true, data: await loadProject() }
  } catch (error) { return { ok: false, error: error.message, data: currentRoot ? await loadProject() : undefined } }
})

ipcMain.handle('image:read', async (_event, relativePath) => {
  try {
    const file = resolveProjectFile(relativePath)
    const buffer = await fsp.readFile(file)
    const extension = path.extname(file).toLowerCase()
    const mime = extension === '.jpg' || extension === '.jpeg' ? 'image/jpeg' : extension === '.webp' ? 'image/webp' : 'image/png'
    return { ok: true, imageUrl: `data:${mime};base64,${buffer.toString('base64')}` }
  } catch (error) { return { ok: false, error: error.message } }
})

ipcMain.handle('image:export', async (_event, taskId, imageId) => {
  try {
    const project = await loadProject()
    const located = findImageTaskContext(project, taskId)
    const task = located?.task
    const image = task?.images.find((item) => item.id === String(imageId))
    if (!task || !image) throw new Error('没有找到要导出的图片')
    const draft = (located?.record?.drafts || project.drafts).find((item) => item.version === task.draftVersion)
    const safeTitle = String(draft?.title || '小红书封面').replace(/[\\/:*?"<>|]/g, '-').slice(0, 40)
    const result = await dialog.showSaveDialog({
      title: '导出小红书图片',
      defaultPath: `${safeTitle}.png`,
      filters: [{ name: 'PNG 图片', extensions: ['png'] }],
    })
    if (result.canceled || !result.filePath) return { ok: true }
    await fsp.copyFile(resolveProjectFile(image.relativePath), result.filePath)
    return { ok: true, savedPath: result.filePath }
  } catch (error) { return { ok: false, error: error.message } }
})

ipcMain.handle('image:export-set', async (_event, taskId) => {
  try {
    const project = await loadProject()
    const located = findImageTaskContext(project, taskId)
    const task = located?.task
    if (!task) throw new Error('没有找到要导出的套图')
    const currentImages = task.plan.pages.map((page) => ({
      page,
      image: task.images.find((item) => item.id === task.currentImageIds?.[page.id]),
    })).filter((item) => item.image)
    if (!currentImages.length) throw new Error('这套配图还没有可导出的图片')
    const result = await dialog.showOpenDialog({
      title: '选择整套图片的导出位置',
      buttonLabel: '导出到这里',
      properties: ['openDirectory', 'createDirectory'],
    })
    if (result.canceled || !result.filePaths[0]) return { ok: true }
    const draft = (located?.record?.drafts || project.drafts).find((item) => item.version === task.draftVersion)
    const safeTitle = String(draft?.title || '小红书配图').replace(/[\\/:*?"<>|]/g, '-').slice(0, 36)
    let target = path.join(result.filePaths[0], `${safeTitle}-整套配图`)
    if (await exists(target)) target = path.join(result.filePaths[0], `${safeTitle}-整套配图-${Date.now()}`)
    await fsp.mkdir(target, { recursive: false })
    for (let index = 0; index < currentImages.length; index += 1) {
      const { page, image } = currentImages[index]
      const label = String(page.label || `第${index + 1}页`).replace(/[\\/:*?"<>|]/g, '-').slice(0, 18)
      await fsp.copyFile(resolveProjectFile(image.relativePath), path.join(target, `${String(index + 1).padStart(2, '0')}-${label}.png`))
    }
    return { ok: true, savedPath: target }
  } catch (error) { return { ok: false, error: error.message } }
})

app.whenReady().then(() => {
  if (process.platform === 'darwin') app.dock.setIcon(applicationIconPath())
  createWindow()
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
})
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
