const { app, BrowserWindow, dialog, ipcMain } = require('electron')
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const path = require('node:path')

const MARKER = '小红书运营工坊.json'
const DATA_DIR = '项目数据'
const OUTPUT_DIR = '生成结果'
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

async function loadProject() {
  if (!currentRoot) return null
  const meta = await readMeta()
  if (!meta) return null
  const materialFile = path.join(currentRoot, '业务原始素材.md')
  const materialExists = await exists(materialFile)
  const keywords = await readJson(dataPath(assetFiles.keywords), [])
  const references = await readJson(dataPath(assetFiles.references), [])
  const rules = await readJson(dataPath(assetFiles.rules), [])
  const facts = await readJson(outputPath('业务事实.json'), null)
  const strategies = await readJson(outputPath('策略候选.json'), [])
  const selection = await readJson(outputPath('策略选择.json'), { selectedStrategyId: '', advice: '' })
  const drafts = await readJson(outputPath('终稿版本.json'), [])
  const generationHistory = await readJson(outputPath('生成记录.json'), [])
  const currentGeneration = await readJson(outputPath('当前生成.json'), { id: 'GEN-0001', createdAt: meta.createdAt })
  return {
    meta: { name: meta.name, root: currentRoot, createdAt: meta.createdAt, updatedAt: meta.updatedAt },
    material: {
      exists: materialExists,
      name: materialExists ? '业务原始素材.md' : '',
      content: materialExists ? await fsp.readFile(materialFile, 'utf8') : '',
    },
    keywords, references, rules, facts, strategies,
    selectedStrategyId: selection.selectedStrategyId || '',
    advice: selection.advice || '',
    drafts,
    currentDraft: drafts.length ? drafts[drafts.length - 1] : null,
    currentGeneration,
    generationHistory,
  }
}

async function userConfig() {
  const file = path.join(app.getPath('userData'), 'settings.json')
  return { file, value: await readJson(file, { baseUrl: 'https://api.openai.com/v1', apiKey: '', model: '' }) }
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
async function callModel(system, user) {
  const { value } = await userConfig()
  if (!value.apiKey || !value.model || !value.baseUrl) throw new Error('请先在“模型设置”中填写接口地址、API Key 和模型名称')
  let endpoint = value.baseUrl.replace(/\/+$/, '')
  if (!endpoint.endsWith('/chat/completions')) endpoint += '/chat/completions'
  let response
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${value.apiKey}` },
      body: JSON.stringify({ model: value.model, temperature: 0.45, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }),
    })
  } catch (error) { throw new Error(`无法连接模型接口：${error.message}`) }
  if (!response.ok) {
    const body = await response.text()
    throw new Error(`模型接口返回 ${response.status}：${body.slice(0, 300)}`)
  }
  return parseModelJson(responseText(await response.json()))
}

function assetsForPrompt(project) {
  return {
    keywords: project.keywords.map(({ id, value, note }) => ({ id, value, note })),
    references: project.references.map(({ id, title, body, author, contentType, performance, note }) => ({ id, title, body, author, contentType, performance, note })),
    rules: project.rules.map(({ id, content, note }) => ({ id, content, note })),
  }
}
const modelSystem = '你是严谨的小红书文案工作流引擎。只根据用户提供的信息工作，不得补充、猜测或虚构任何业务事实。必须只输出合法 JSON，不要输出 Markdown 代码块或解释。'

async function initializeProject(folder) {
  const absolute = path.resolve(folder)
  await fsp.access(absolute, fs.constants.R_OK | fs.constants.W_OK)
  await fsp.mkdir(path.join(absolute, DATA_DIR), { recursive: true })
  await fsp.mkdir(path.join(absolute, OUTPUT_DIR), { recursive: true })
  const meta = {
    schemaVersion: 1, name: cleanName(absolute), createdAt: now(), updatedAt: now(),
    counters: { keywords: 0, references: 0, rules: 0, strategies: 0, generations: 1 },
  }
  await writeJson(path.join(absolute, MARKER), meta)
  for (const file of Object.values(assetFiles)) await writeJson(path.join(absolute, DATA_DIR, file), [])
  currentRoot = absolute
  await writeJson(outputPath('当前生成.json'), { id: 'GEN-0001', createdAt: now() })
  await writeJson(outputPath('生成记录.json'), [])
  await addRecent(absolute)
  return loadProject()
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1440, height: 920, minWidth: 1080, minHeight: 700,
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

ipcMain.handle('asset:save', async (_event, kind, value) => {
  try {
    if (!currentRoot || !assetFiles[kind]) throw new Error('项目或资料类型无效')
    const items = await readJson(dataPath(assetFiles[kind]), [])
    const stamp = now()
    if (value.id) {
      const index = items.findIndex((item) => item.id === value.id)
      if (index < 0) throw new Error('没有找到要修改的记录')
      items[index] = { ...items[index], ...value, id: items[index].id, updatedAt: stamp }
    } else {
      const meta = await readMeta()
      meta.counters[kind] = (meta.counters[kind] || 0) + 1
      const id = `${idPrefixes[kind]}-${String(meta.counters[kind]).padStart(4, '0')}`
      items.push({ ...value, id, createdAt: stamp, updatedAt: stamp })
      await writeMeta(meta)
    }
    await writeJson(dataPath(assetFiles[kind]), items)
    return { ok: true, data: await loadProject() }
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

ipcMain.handle('settings:get', async () => (await userConfig()).value)
ipcMain.handle('settings:save', async (_event, settings) => {
  try {
    const { file } = await userConfig()
    await writeJson(file, { baseUrl: String(settings.baseUrl || '').trim(), apiKey: String(settings.apiKey || '').trim(), model: String(settings.model || '').trim() })
    return { ok: true }
  } catch (error) { return { ok: false, error: error.message } }
})

ipcMain.handle('workflow:facts', async (_event, resolution = '') => {
  try {
    const project = await loadProject()
    if (!project?.material.exists) throw new Error('请先导入业务原始素材.md')
    const previous = project.facts?.conflicts?.length ? project.facts.conflicts : []
    const prompt = `请开放式提取并整理以下业务素材中的事实。可能关注产品、人群、场景、卖点、服务、流程、价格、时间、地点、名额、资质、安全、权益和限制，但这些不是必填字段；素材有什么就提取什么，不要把未提及内容判断为缺失。区分可确认事实、宣传性表达和冲突事实。\n\n${resolution ? `上次发现的冲突：${JSON.stringify(previous)}\n用户确认的统一口径：${resolution}\n请重新生成消除冲突后的完整业务事实。\n\n` : ''}原始素材：\n${project.material.content}\n\n输出对象格式：{"confirmedFacts":[{"category":"实际类别","items":["事实"]}],"promotionalExpressions":["表达"],"conflicts":[{"topic":"事项","versions":["口径1","口径2"],"question":"询问用户的简短明确问题"}]}`
    const result = await callModel(modelSystem, prompt)
    const facts = {
      confirmedFacts: Array.isArray(result.confirmedFacts) ? result.confirmedFacts : [],
      promotionalExpressions: Array.isArray(result.promotionalExpressions) ? result.promotionalExpressions : [],
      conflicts: Array.isArray(result.conflicts) ? result.conflicts : [], generatedAt: now(),
    }
    await writeJson(outputPath('业务事实.json'), facts)
    if (facts.conflicts.length === 0) await fsp.writeFile(outputPath('业务事实.md'), facts.confirmedFacts.map((g) => `## ${g.category}\n\n${(g.items || []).map((item) => `- ${item}`).join('\n')}`).join('\n\n'), 'utf8')
    return { ok: true, data: await loadProject() }
  } catch (error) { return { ok: false, error: error.message } }
})

ipcMain.handle('workflow:strategies', async () => {
  try {
    const project = await loadProject()
    if (!project?.facts || project.facts.conflicts?.length) throw new Error('请先形成无冲突的完整业务事实')
    const assets = assetsForPrompt(project)
    const prompt = `根据完整业务事实和项目现有资产，一次性理解全部输入并生成 3–5 个彼此明显不同的文案策略。每个策略只引用真正适合的 1–3 篇参考文案，上限 3 篇；没有合适参考时使用空数组。referenceIds 只能使用给出的稳定编号。每个策略务必简短。\n\n业务事实：${JSON.stringify(project.facts)}\n关键词库：${JSON.stringify(assets.keywords)}\n参考文案库：${JSON.stringify(assets.references)}\n合规准则：${JSON.stringify(assets.rules)}\n\n输出对象格式：{"strategies":[{"name":"策略名称","angle":"一句话核心切入角度","materialPoints":["素材点，2–4个"],"route":"一句话写作路线","referenceIds":["REF-0001"],"bestFor":"最适合的目标"}]}`
    const result = await callModel(modelSystem, prompt)
    const raw = Array.isArray(result.strategies) ? result.strategies.slice(0, 5) : []
    if (raw.length < 3) throw new Error('模型返回的有效策略少于 3 个，请重试')
    const validRefs = new Set(project.references.map((item) => item.id))
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
    await writeJson(outputPath('策略选择.json'), { selectedStrategyId: '', advice: '' })
    return { ok: true, data: await loadProject() }
  } catch (error) { return { ok: false, error: error.message } }
})

ipcMain.handle('workflow:select', async (_event, payload) => {
  try {
    const project = await loadProject()
    if (!project.strategies.some((item) => item.id === payload.id)) throw new Error('请选择一个有效策略')
    await writeJson(outputPath('策略选择.json'), { selectedStrategyId: payload.id, advice: String(payload.advice || '').trim(), selectedAt: now() })
    return { ok: true, data: await loadProject() }
  } catch (error) { return { ok: false, error: error.message } }
})

ipcMain.handle('workflow:new', async () => {
  try {
    const project = await loadProject()
    if (!project) throw new Error('请先创建或打开项目')
    const hasProgress = project.strategies.length > 0 || project.drafts.length > 0 || project.selectedStrategyId
    const history = [...project.generationHistory]
    if (hasProgress) {
      history.push({
        id: project.currentGeneration.id,
        createdAt: project.currentGeneration.createdAt,
        archivedAt: now(),
        strategies: project.strategies,
        selectedStrategyId: project.selectedStrategyId,
        advice: project.advice,
        drafts: project.drafts,
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
    await writeJson(outputPath('策略选择.json'), { selectedStrategyId: '', advice: '' })
    await writeJson(outputPath('终稿版本.json'), [])
    return { ok: true, data: await loadProject() }
  } catch (error) { return { ok: false, error: error.message } }
})

async function makeDraft(revisionRequest = '') {
  const project = await loadProject()
  if (!project?.selectedStrategyId) throw new Error('请先选择一个策略')
  const strategy = project.strategies.find((item) => item.id === project.selectedStrategyId)
  if (!strategy) throw new Error('所选策略已不存在')
  const selectedReferences = project.references.filter((item) => strategy.referenceIds.includes(item.id))
  const base = revisionRequest && project.currentDraft
    ? `请在保持同一策略的前提下修改当前终稿。\n当前终稿：${JSON.stringify(project.currentDraft)}\n新的修改要求：${revisionRequest}`
    : '请根据选定策略直接生成终稿。'
  const prompt = `${base}\n\n只能使用以下业务事实：${JSON.stringify(project.facts)}\n选定的唯一策略：${JSON.stringify(strategy)}\n用户最初补充建议：${project.advice || '无'}\n关键词库：${JSON.stringify(project.keywords.map(({ id, value, note }) => ({ id, value, note })))}\n合规准则：${JSON.stringify(project.rules.map(({ id, content, note }) => ({ id, content, note })))}\n只可参考以下已选中的完整参考文案：${JSON.stringify(selectedReferences)}\n\n遵循策略的核心主题和信息取舍；关键词自然融入，不机械堆砌；参考文案只模仿选题方式、钩子、结构、节奏和语感，不复制原句或业务信息；遵守合规准则。输出对象格式：{"title":"标题","body":"正文","hashtags":["话题标签，不含#"]}`
  const result = await callModel(modelSystem, prompt)
  if (!result.title || !result.body) throw new Error('模型返回的终稿缺少标题或正文，请重试')
  const version = project.drafts.length + 1
  const draft = {
    version, title: String(result.title).trim(), body: String(result.body).trim(),
    hashtags: Array.isArray(result.hashtags) ? result.hashtags.map((tag) => String(tag).replace(/^#/, '').trim()).filter(Boolean) : [],
    strategyId: strategy.id, referenceIds: strategy.referenceIds, revisionRequest, createdAt: now(), confirmed: false,
  }
  const drafts = [...project.drafts, draft]
  await writeJson(outputPath('终稿版本.json'), drafts)
  const markdown = `# ${draft.title}\n\n${draft.body}\n\n${draft.hashtags.map((tag) => `#${tag}`).join(' ')}\n`
  await fsp.writeFile(outputPath(`${project.currentGeneration.id}_终稿_v${version}.md`), markdown, 'utf8')
  return loadProject()
}
ipcMain.handle('workflow:draft', async () => {
  try { return { ok: true, data: await makeDraft() } } catch (error) { return { ok: false, error: error.message } }
})
ipcMain.handle('workflow:revise', async (_event, request) => {
  try {
    if (!String(request || '').trim()) throw new Error('请填写本次修改要求')
    return { ok: true, data: await makeDraft(String(request).trim()) }
  } catch (error) { return { ok: false, error: error.message } }
})
ipcMain.handle('workflow:confirm', async () => {
  try {
    const project = await loadProject()
    if (!project?.drafts.length) throw new Error('还没有可以确认的终稿')
    const drafts = project.drafts.map((item, index) => ({ ...item, confirmed: index === project.drafts.length - 1 }))
    await writeJson(outputPath('终稿版本.json'), drafts)
    const draft = drafts[drafts.length - 1]
    const markdown = `# ${draft.title}\n\n${draft.body}\n\n${draft.hashtags.map((tag) => `#${tag}`).join(' ')}\n`
    await fsp.writeFile(outputPath(`${project.currentGeneration.id}_最终输出.md`), markdown, 'utf8')
    await fsp.writeFile(outputPath('最终输出.md'), markdown, 'utf8')
    return { ok: true, data: await loadProject() }
  } catch (error) { return { ok: false, error: error.message } }
})

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
})
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
