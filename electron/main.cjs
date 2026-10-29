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
  buildXhsImagePrompt,
  formatImageApiError,
  normalizeImageSettings,
  parseImageApiResponse,
  sanitizeImageBrief,
  sanitizeImageReferenceTags,
} = require('./image-utils.cjs')

const MARKER = '小红书运营工坊.json'
const DATA_DIR = '项目数据'
const OUTPUT_DIR = '生成结果'
const IMAGE_TASKS_FILE = '配图记录.json'
const IMAGE_REFERENCES_FILE = '小红书图片参考库.json'
const IMAGE_REFERENCES_DIR = '小红书图片参考库'
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
  const facts = await readJson(outputPath('业务事实.json'), null)
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
    keywords, references, rules, imageReferences, facts, strategies,
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
  const contentType = response.headers.get('content-type') || ''
  if (contentType.includes('application/json')) {
    const data = await response.json()
    const text = responseText(data)
    const reasoning = responseThinking(data)
    if (reasoning) onChunk('thinking', reasoning)
    onChunk('content', text)
    return parseModelJson(text)
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
    } catch { /* Wait for the next complete SSE event. */ }
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
  if (!fullText) throw new Error('模型流式返回中没有可读取的内容')
  return parseModelJson(fullText)
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
            { type: 'text', text: `这张图片由用户标注为“${role}”。请分析它适合被哪些小红书选题和页面职责参考，以及可复用的视觉结构。不要评价业务真实性，不要抄录长段原文。输出：{"summary":"一句话描述这幅图适合参考的场景","useCases":["适用场景"],"visualStyle":"视觉风格与质感","composition":"构图和视觉动线","textLayout":"标题与信息排版方式","colorPalette":["主要颜色"],"keyElements":["关键视觉元素"],"keywords":["检索关键词"],"avoidCopying":["不能照搬的具体内容"]}` },
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
    updatedAt: task.updatedAt,
  })
}

function normalizeImageTask(value = {}) {
  const images = Array.isArray(value.images) ? value.images : []
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
  const pages = rawPages.map((page, index) => {
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
  return {
    version: 2,
    concept: String(value.concept || '围绕本篇文案形成连贯视觉叙事').trim(),
    visualContinuity,
    pages,
  }
}

async function createImagePlan(project, draft) {
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
5. 只能使用给出的事实和文案信息，不得虚构人物、地点、行程、价格、权益、资质、奖项或效果。没有真实照片依据时，优先采用编辑设计、信息卡片、物件静物或抽象视觉，不要伪造实拍现场。
6. style 只能从 lifestyle、event、product、guide、editorial 中选择。palette、mustShow、mustAvoid 是简短字符串数组。
7. 你必须只根据下方“参考图片文字标签”判断每一页最适合参考哪些样本，并为每页填写 1–3 个 referenceImageIds。封面优先选择 isCover=true，内容页优先选择 isCover=false；相关性比数量重要。
8. 参考样本只用于借鉴版式、构图、配色、字体气质和视觉节奏。不得把样本中的人物、商品、品牌、文字、地点或业务信息写进页面策划。页面内容只能来自本篇业务事实与文案。

业务事实：${JSON.stringify(project.facts)}
选定策略：${JSON.stringify(strategy)}
已确认文案：${JSON.stringify(draft)}
合规准则：${JSON.stringify(rules)}
参考图片文字标签：${JSON.stringify(referenceCatalog)}

只输出 JSON 对象：{"concept":"整套图的叙事概念","visualContinuity":"整套图统一的颜色、排版、材质和识别元素","pages":[{"role":"cover","label":"封面","purpose":"本页承担的职责","referenceImageIds":["XHSIMG-0001"],"coverTitle":"短标题","subtitle":"可选短副标题","style":"editorial","subject":"具体画面主体","scene":"场景、动作、光线和道具","composition":"构图与信息层级","palette":["颜色1","颜色2"],"mood":"氛围","mustShow":["必须出现"],"mustAvoid":["不得出现"],"extraNotes":"必要补充"}]}`
  const result = await callModel(modelSystem, prompt, () => {}, false)
  return sanitizeImagePlan(result, draft, project.imageReferences)
}

async function rewriteImagePage(project, task, page, feedback) {
  const currentImageId = task.currentImageIds?.[page.id]
  const currentImage = task.images.find((item) => item.id === currentImageId)
  const request = String(feedback || '').trim()
  const prompt = `请重写这张小红书配图的视觉策划，然后再交给图片模型生成。必须产生实质变化，不能只是换随机种子。

${request ? `用户改进建议：${request}` : '用户没有填写建议。请主动诊断当前方案，从构图、视觉主体、信息层级或表现手法中选择至少两项进行明显优化，同时保持本页职责和准确文字不变。'}

套图统一规范：${task.plan.visualContinuity}
本页职责：${page.purpose}
当前页面策划：${JSON.stringify(page.brief)}
上次实际图片提示词：${currentImage?.prompt || ''}
业务事实：${JSON.stringify(project.facts)}
合规准则：${JSON.stringify(project.rules.filter((item) => item.enabled !== false))}

不得新增未经证实的事实；必须保持与整套图一致，但新构图要能让用户一眼看出变化。只输出与当前页面策划相同字段的 JSON 对象。`
  const result = await callModel(modelSystem, prompt, () => {}, false)
  return sanitizeImageBrief({
    ...result,
    pageRole: page.role,
    pageLabel: page.label,
    purpose: page.purpose,
    visualContinuity: task.plan.visualContinuity,
  }, page.title)
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

const modelSystem = '你是严谨的小红书文案工作流引擎。只根据用户提供的信息工作，不得补充、猜测或虚构任何业务事实。必须只输出合法 JSON，不要输出 Markdown 代码块或解释。'

async function initializeProject(folder) {
  const absolute = path.resolve(folder)
  await fsp.access(absolute, fs.constants.R_OK | fs.constants.W_OK)
  await fsp.mkdir(path.join(absolute, DATA_DIR), { recursive: true })
  await fsp.mkdir(path.join(absolute, OUTPUT_DIR), { recursive: true })
  const meta = {
    schemaVersion: 1, name: cleanName(absolute), createdAt: now(), updatedAt: now(),
    counters: { keywords: 0, references: 0, rules: 0, imageReferences: 0, strategies: 0, generations: 1 },
  }
  await writeJson(path.join(absolute, MARKER), meta)
  for (const file of Object.values(assetFiles)) await writeJson(path.join(absolute, DATA_DIR, file), [])
  await writeJson(path.join(absolute, DATA_DIR, IMAGE_REFERENCES_FILE), [])
  await fsp.mkdir(path.join(absolute, DATA_DIR, IMAGE_REFERENCES_DIR), { recursive: true })
  currentRoot = absolute
  await writeJson(outputPath('当前生成.json'), { id: 'GEN-0001', createdAt: now() })
  await writeJson(outputPath('生成记录.json'), [])
  await writeJson(outputPath(IMAGE_TASKS_FILE), [])
  await addRecent(absolute)
  return loadProject()
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1440, height: 920, minWidth: 1080, minHeight: 700,
    icon: applicationIconPath(),
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    backgroundColor: '#f3f1ed',
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false },
  })
  if (process.env.NODE_ENV === 'development' || !app.isPackaged) win.loadURL('http://127.0.0.1:5173')
  else win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
}

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

async function retagImageReference(items, index) {
  const reference = normalizeImageReference(items[index])
  items[index] = { ...reference, taggingStatus: 'pending', taggingError: '', updatedAt: now() }
  await saveImageReferences(items)
  try {
    const tags = await callVisionTagger(reference)
    items[index] = { ...items[index], tags, taggingStatus: 'ready', taggingError: '', updatedAt: now() }
  } catch (error) {
    items[index] = { ...items[index], taggingStatus: 'failed', taggingError: error.message, updatedAt: now() }
  }
  await saveImageReferences(items)
  return items[index]
}

ipcMain.handle('image-reference:upload', async (_event, isCover) => {
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
    let failed = 0
    for (const index of createdIndexes) {
      const tagged = await retagImageReference(items, index)
      if (tagged.taggingStatus !== 'ready') failed += 1
    }
    return { ok: true, imported: createdIndexes.length, failed, data: await loadProject() }
  } catch (error) { return { ok: false, error: error.message, data: currentRoot ? await loadProject() : undefined } }
})

ipcMain.handle('image-reference:retag', async (_event, id) => {
  try {
    const items = (await readJson(dataPath(IMAGE_REFERENCES_FILE), [])).map(normalizeImageReference)
    const index = items.findIndex((item) => item.id === String(id))
    if (index < 0) throw new Error('没有找到要重新打标的图片')
    const tagged = await retagImageReference(items, index)
    if (tagged.taggingStatus !== 'ready') throw new Error(tagged.taggingError || '图片打标失败')
    return { ok: true, data: await loadProject() }
  } catch (error) { return { ok: false, error: error.message, data: currentRoot ? await loadProject() : undefined } }
})

ipcMain.handle('image-reference:set-role', async (_event, id, isCover) => {
  try {
    const items = (await readJson(dataPath(IMAGE_REFERENCES_FILE), [])).map(normalizeImageReference)
    const index = items.findIndex((item) => item.id === String(id))
    if (index < 0) throw new Error('没有找到要修改的图片')
    items[index] = { ...items[index], isCover: Boolean(isCover), updatedAt: now() }
    const tagged = await retagImageReference(items, index)
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
    const result = await callModel(modelSystem, prompt, modelStream(event, operation), thinking)
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

ipcMain.handle('workflow:strategies', async (event, thinking = false) => {
  const operation = 'strategies'
  try {
    const project = await loadProject()
    if (!project?.facts || project.facts.conflicts?.length) throw new Error('请先形成无冲突的完整业务事实')
    const assets = assetMarkdownTables(project)
    const prompt = `根据完整业务事实和项目现有资产，一次性理解全部输入并生成 3–5 个彼此明显不同的文案策略。每个策略只引用真正适合的 1–3 篇参考文案，上限 3 篇；没有合适参考时使用空数组。referenceIds 只能使用给出的稳定编号。每个策略务必简短。\n\n业务事实：${JSON.stringify(project.facts)}\n\n## 关键词库\n\n${assets.keywords}\n\n## 参考文案库\n\n${assets.references}\n\n## 合规准则\n\n${assets.rules}\n\n输出对象格式：{"strategies":[{"name":"策略名称","angle":"一句话核心切入角度","materialPoints":["素材点，2–4个"],"route":"一句话写作路线","referenceIds":["REF-0001"],"bestFor":"最适合的目标"}]}`
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
        materialPoints: Array.isArray(item.materialPoints) ? item.materialPoints.slice(0, 4).map(String) : [],
        route: String(item.route || ''),
        referenceIds: Array.isArray(item.referenceIds) ? item.referenceIds.filter((id) => validRefs.has(id)).slice(0, 3) : [],
        bestFor: String(item.bestFor || ''), createdAt: now(),
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
    await writeJson(outputPath('策略候选.json'), [])
    await writeJson(outputPath('策略选择.json'), { selectedStrategyIds: [], selectedStrategyId: '', strategyAdvice: {}, advice: '' })
    await writeJson(outputPath('终稿版本.json'), [])
    await writeJson(outputPath(IMAGE_TASKS_FILE), [])
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
  const drafts = [...project.drafts]
  for (const [index, strategy] of strategies.entries()) {
    const selectedReferences = project.references.filter((item) => item.enabled !== false && strategy.referenceIds.includes(item.id))
    const assets = assetMarkdownTables(project, selectedReferences)
    const base = revisionRequest && baseDraft
      ? `请在保持同一策略的前提下修改当前终稿。\n当前终稿：${JSON.stringify(baseDraft)}\n新的修改要求：${revisionRequest}`
      : '请根据选定策略直接生成一篇独立终稿。'
    const strategyAdvice = project.strategyAdvice?.[strategy.id] || project.advice || '无'
    const prompt = `${base}\n\n只能使用以下业务事实：${JSON.stringify(project.facts)}\n选定策略：${JSON.stringify(strategy)}\n该策略的补充要求：${strategyAdvice}\n\n## 关键词库\n\n${assets.keywords}\n\n## 合规准则\n\n${assets.rules}\n\n## 只可参考以下已选中的完整参考文案\n\n${assets.references}\n\n遵循策略的核心主题和信息取舍；关键词自然融入，不机械堆砌；参考文案只模仿选题方式、钩子、结构、节奏和语感，不复制原句或业务信息；遵守合规准则。输出对象格式：{"title":"标题","body":"正文","hashtags":["话题标签，不含#"]}`
    const operation = `draft:${strategy.id}:${index + 1}/${strategies.length}`
    const result = await callModel(modelSystem, prompt, modelStream(event, operation), thinking)
    if (!result.title || !result.body) throw new Error('模型返回的终稿缺少标题或正文，请重试')
    const version = drafts.length + 1
    const draft = {
      version, title: String(result.title).trim(), body: String(result.body).trim(),
      hashtags: Array.isArray(result.hashtags) ? result.hashtags.map((tag) => String(tag).replace(/^#/, '').trim()).filter(Boolean) : [],
      strategyId: strategy.id, referenceIds: strategy.referenceIds, revisionRequest, createdAt: now(), confirmed: false,
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

ipcMain.handle('image:create-set', async (event, version) => {
  try {
    const project = await loadProject()
    const draft = project?.drafts.find((item) => item.version === Number(version) && item.confirmed)
    if (!draft) throw new Error('请先确认这篇文案，再生成整套配图')
    const taskId = `IMG-${project.currentGeneration.id}-${draft.strategyId}-V${draft.version}`
    const tasks = [...project.imageTasks]
    let taskIndex = tasks.findIndex((item) => item.id === taskId)
    let task = taskIndex >= 0 ? normalizeImageTask(tasks[taskIndex]) : null
    const usableReferenceIds = new Set(project.imageReferences.filter((item) => item.enabled !== false && item.taggingStatus === 'ready').map((item) => item.id))
    const planNeedsReferences = !task?.plan?.pages?.every((page) => page.referenceImageIds?.some((id) => usableReferenceIds.has(id)))

    if (!task || task.plan.pages.length < 4 || planNeedsReferences) {
      event.sender.send('image:progress', { version: draft.version, phase: 'planning', current: 0, total: 0, label: '正在规划整套图片' })
      const plan = await createImagePlan(project, draft)
      const artifactDir = projectRelative(path.join(outputPath('配图'), project.currentGeneration.id, `${draft.strategyId}_v${draft.version}`))
      task = {
        id: taskId,
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
      await saveImageTasks(tasks)
      await saveImageTaskArtifacts(task)
    }

    const missingPages = task.plan.pages.filter((page) => !task.currentImageIds?.[page.id])
    for (let index = 0; index < missingPages.length; index += 1) {
      const page = missingPages[index]
      event.sender.send('image:progress', {
        version: draft.version,
        phase: 'generating',
        current: index + 1,
        total: missingPages.length,
        label: `正在生成${page.label}`,
      })
      const image = await generateImagePage(project, task, page, page.brief)
      task.images = [...task.images, image]
      task.currentImageIds = { ...task.currentImageIds, [page.id]: image.id }
      task.prompt = image.prompt
      task.negativePrompt = image.negativePrompt
      task.updatedAt = now()
      tasks[taskIndex] = task
      await saveImageTasks(tasks)
      await saveImageTaskArtifacts(task)
    }
    event.sender.send('image:progress', { version: draft.version, phase: 'done', current: task.plan.pages.length, total: task.plan.pages.length, label: '整套配图已生成' })
    return { ok: true, data: await loadProject() }
  } catch (error) {
    return { ok: false, error: error.message, data: currentRoot ? await loadProject() : undefined }
  }
})

ipcMain.handle('image:regenerate-page', async (event, taskId, pageId, feedback) => {
  try {
    const project = await loadProject()
    const index = project?.imageTasks.findIndex((item) => item.id === String(taskId)) ?? -1
    if (index < 0) throw new Error('没有找到这套配图')
    const tasks = [...project.imageTasks]
    const task = normalizeImageTask(tasks[index])
    const pageIndex = task.plan.pages.findIndex((item) => item.id === String(pageId))
    if (pageIndex < 0) throw new Error('没有找到要重新生成的页面')
    const page = task.plan.pages[pageIndex]

    event.sender.send('image:progress', { version: task.draftVersion, pageId: page.id, phase: 'rewriting', current: 0, total: 1, label: `正在重写${page.label}提示词` })
    const rewrittenBrief = await rewriteImagePage(project, task, page, feedback)
    event.sender.send('image:progress', { version: task.draftVersion, pageId: page.id, phase: 'generating', current: 1, total: 1, label: `正在重新生成${page.label}` })
    const image = await generateImagePage(project, task, page, rewrittenBrief, feedback)

    const rewrittenPage = { ...page, title: rewrittenBrief.coverTitle, purpose: rewrittenBrief.purpose, brief: rewrittenBrief }
    task.plan = { ...task.plan, pages: task.plan.pages.map((item, itemIndex) => itemIndex === pageIndex ? rewrittenPage : item) }
    task.images = [...task.images, image]
    task.currentImageIds = { ...task.currentImageIds, [page.id]: image.id }
    task.brief = task.plan.pages[0].brief
    task.prompt = image.prompt
    task.negativePrompt = image.negativePrompt
    task.updatedAt = now()
    tasks[index] = task
    await saveImageTasks(tasks)
    await saveImageTaskArtifacts(task)
    event.sender.send('image:progress', { version: task.draftVersion, pageId: page.id, phase: 'done', current: 1, total: 1, label: `${page.label}已更新` })
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
    const task = project?.imageTasks.find((item) => item.id === String(taskId))
    const image = task?.images.find((item) => item.id === String(imageId))
    if (!task || !image) throw new Error('没有找到要导出的图片')
    const draft = project.drafts.find((item) => item.version === task.draftVersion)
    const safeTitle = String(draft?.title || '小红书封面').replace(/[\\/:*?"<>|]/g, '-').slice(0, 40)
    const result = await dialog.showSaveDialog({
      title: '导出小红书封面',
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
    const task = project?.imageTasks.find((item) => item.id === String(taskId))
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
    const draft = project.drafts.find((item) => item.version === task.draftVersion)
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
