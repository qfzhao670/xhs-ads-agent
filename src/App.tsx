import { lazy, Suspense, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import {
  Archive, BookOpenText, Brain, Check, CheckCircle2, ChevronDown, ChevronRight,
  Circle, ClipboardPaste, Download, Eye, EyeOff, FileText, FolderOpen, Image as ImageIcon, ImagePlus, KeyRound, LayoutTemplate, LoaderCircle,
  PackageOpen, PenLine, Plus, RefreshCw, Save, Scale, Settings, SlidersHorizontal,
  Sparkles, Trash2, Upload, WandSparkles, X,
} from 'lucide-react'
import {
  defaultRealPosterLayout, REAL_POSTER_LAYOUTS, realPosterLayoutRects,
  renderRealPosterPage, renderRealPosterPreview,
} from './real-poster-renderer'

type Page = 'generate' | 'library' | 'assets' | 'settings'
type Modal = 'project-init' | AssetKind | null
type AssetLibraryTab = AssetKind | 'imageReferences' | 'realPhotos'

const MarkdownReadingView = lazy(() => import('./MarkdownReadingView'))

const flowSteps = [
  ['准备素材', '确认本次生成依据'],
  ['核对事实', '提取并消除冲突'],
  ['内容模式', '选择显式或生活化'],
  ['选择策略', '确定一个微选题方向'],
  ['生成文案', '按选定策略产出'],
  ['审核确认', '修改并确认文案'],
  ['制作配图', '生成图文套图，可跳过'],
  ['确认入库', '进入终稿库与避重范围'],
] as const

const defaultImageSettings: ImageModelSettings = {
  enabled: true, protocol: 'dashscope', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', apiKey: '', model: 'qwen-image-3.0-pro', size: '1080x1440', count: 1,
  promptExtendMode: 'direct', enableThinking: false, watermark: false,
}

function resolvedImageEndpoint(settings: ImageModelSettings) {
  try {
    const parsed = new URL(settings.baseUrl.trim())
    if (!['http:', 'https:'].includes(parsed.protocol)) return ''
    const origin = parsed.origin
    return settings.protocol === 'openai'
      ? `${origin}/compatible-mode/v1/images/generations`
      : `${origin}/api/v1/services/aigc/multimodal-generation/generation`
  } catch { return '' }
}

function usesPublicDashScopeDomain(baseUrl: string) {
  try {
    return ['dashscope.aliyuncs.com', 'dashscope-intl.aliyuncs.com'].includes(new URL(baseUrl.trim()).hostname)
  } catch { return false }
}

const emptyForms = {
  keywords: { id: '', category: '', root: '', partOfSpeech: '', intentTag: '', suggestedUse: '' },
  rules: { id: '', prohibited: '', riskType: '', basis: '', handling: '', replacement: '' },
  references: { id: '', title: '', body: '', hashtags: '' },
}

function App() {
  const [restoringWindow, setRestoringWindow] = useState(true)
  const [page, setPage] = useState<Page>('generate')
  const [project, setProject] = useState<ProjectData | null>(null)
  const [recent, setRecent] = useState<string[]>([])
  const [flowStep, setFlowStep] = useState(1)
  const [viewGeneration, setViewGeneration] = useState('current')
  const [modal, setModal] = useState<Modal>(null)
  const [pendingFolder, setPendingFolder] = useState('')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [assetTab, setAssetTab] = useState<AssetLibraryTab>('keywords')
  const [form, setForm] = useState<Record<string, string>>(emptyForms.keywords)
  const [settings, setSettings] = useState<ModelSettings>({ baseUrl: '', apiKey: '', model: '', visionModel: '', image: defaultImageSettings })
  const [resolution, setResolution] = useState('')
  const [contentMode, setContentMode] = useState<ContentMode | ''>('')
  const [userBrief, setUserBrief] = useState('')
  const [choice, setChoice] = useState<string[]>([])
  const [strategyAdvice, setStrategyAdvice] = useState<Record<string, string>>({})
  const [revision, setRevision] = useState('')
  const [viewVersion, setViewVersion] = useState<number | null>(null)
  const [thinkingModes, setThinkingModes] = useState({ facts: true, strategies: false, draft: false, revise: false })
  const [stream, setStream] = useState({ operation: '', content: '', thinking: '', done: false })
  const [imageProgress, setImageProgress] = useState<Record<string, ImageProgressEvent>>({})
  const [referenceProgress, setReferenceProgress] = useState<ImageReferenceProgressEvent | null>(null)
  const [realPhotoProgress, setRealPhotoProgress] = useState<RealPhotoProgressEvent | null>(null)
  const [materialFiles, setMaterialFiles] = useState<MaterialUploadFile[]>([])
  const [materialUploadOpen, setMaterialUploadOpen] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function restoreWindowState() {
      try {
        const [recentProjects, savedSettings, currentProject] = await Promise.all([
          window.workshop.getRecentProjects(),
          window.workshop.getSettings(),
          window.workshop.getProject(),
        ])
        if (cancelled) return

        setRecent(recentProjects)
        setSettings(savedSettings)
        if (currentProject.ok && currentProject.data) {
          const restoredProject = currentProject.data
          setProject(restoredProject)
          setFlowStep(suggestedStep(restoredProject))
          setViewGeneration('current')
          setPage('generate')
          setChoice(restoredProject.selectedStrategyIds || (restoredProject.selectedStrategyId ? [restoredProject.selectedStrategyId] : []))
          setContentMode(restoredProject.generationConfig.mode)
          setUserBrief(restoredProject.generationConfig.userBriefRaw)
          setStrategyAdvice(restoredProject.strategyAdvice || {})
          setViewVersion(restoredProject.currentDraft?.version || null)
        }
      } catch (e) {
        if (!cancelled) showError(e instanceof Error ? e.message : '恢复应用状态失败')
      } finally {
        if (!cancelled) setRestoringWindow(false)
      }
    }

    void restoreWindowState()
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (restoringWindow) return

    // React has committed the restored DOM, but Chromium may not have swapped
    // that frame to the native window yet. Two frames avoid exposing the prior
    // bootstrap frame when Electron makes the BrowserWindow visible.
    let secondFrame = 0
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => window.workshop.showWindow())
    })
    return () => {
      window.cancelAnimationFrame(firstFrame)
      window.cancelAnimationFrame(secondFrame)
    }
  }, [restoringWindow])

  useEffect(() => {
    setChoice(project?.selectedStrategyIds || (project?.selectedStrategyId ? [project.selectedStrategyId] : []))
    setContentMode(project?.generationConfig.mode || '')
    setUserBrief(project?.generationConfig.userBriefRaw || '')
    setStrategyAdvice(project?.strategyAdvice || {})
    setViewVersion(project?.currentDraft?.version || null)
  }, [project?.meta.root, project?.selectedStrategyIds, project?.selectedStrategyId, project?.strategyAdvice, project?.currentDraft?.version, project?.generationConfig.mode, project?.generationConfig.userBriefRaw])

  useEffect(() => setImageProgress({}), [project?.meta.root, project?.currentGeneration.id])
  useEffect(() => { setMaterialFiles([]); setMaterialUploadOpen(false) }, [project?.meta.root])

  useEffect(() => window.workshop.onModelStream((payload) => {
    setStream((current) => {
      if (payload.reset) return { operation: payload.operation, content: '', thinking: '', done: false }
      const same = current.operation === payload.operation
      return {
        operation: payload.operation,
        content: payload.kind === 'content' ? `${same ? current.content : ''}${payload.chunk}` : same ? current.content : '',
        thinking: payload.kind === 'thinking' ? `${same ? current.thinking : ''}${payload.chunk}` : same ? current.thinking : '',
        done: Boolean(payload.done),
      }
    })
  }), [])

  useEffect(() => window.workshop.onImageProgress((payload) => {
    const task = payload.task
    // Keep progress above ImageStep so switching to an archived generation cannot discard the active canvas state.
    setImageProgress((current) => ({
      ...current,
      [`version:${payload.version}`]: payload,
      ...(task ? { [`task:${task.id}`]: payload } : {}),
    }))
    if (!task) return
    setProject((current) => {
      if (!current) return current
      if (task.generationId === current.currentGeneration.id) {
        const imageTasks = [...current.imageTasks]
        const index = imageTasks.findIndex((item) => item.id === task.id)
        if (index >= 0) imageTasks[index] = task
        else imageTasks.push(task)
        return { ...current, imageTasks }
      }
      return { ...current, generationHistory: current.generationHistory.map((record) => {
        if (record.id !== task.generationId) return record
        const imageTasks = [...(record.imageTasks || [])]
        const index = imageTasks.findIndex((item) => item.id === task.id)
        if (index >= 0) imageTasks[index] = task
        else imageTasks.push(task)
        return { ...record, imageTasks }
      }) }
    })
  }), [])

  useEffect(() => window.workshop.onImageReferenceProgress((payload) => {
    setReferenceProgress(payload)
    const updates = payload.references || (payload.reference ? [payload.reference] : [])
    if (!updates.length) return
    setProject((current) => {
      if (!current) return current
      const imageReferences = [...current.imageReferences]
      for (const update of updates) {
        const index = imageReferences.findIndex((item) => item.id === update.id)
        if (index >= 0) imageReferences[index] = update
        else imageReferences.push(update)
      }
      return { ...current, imageReferences }
    })
  }), [])

  useEffect(() => window.workshop.onRealPhotoProgress((payload) => {
    setRealPhotoProgress(payload)
    const updates = payload.photos || (payload.photo ? [payload.photo] : [])
    if (!updates.length) return
    setProject((current) => {
      if (!current) return current
      const realPhotos = [...current.realPhotos]
      for (const update of updates) {
        const index = realPhotos.findIndex((item) => item.id === update.id)
        if (index >= 0) realPhotos[index] = update
        else realPhotos.push(update)
      }
      return { ...current, realPhotos }
    })
  }), [])

  const completed = useMemo(() => [
    !!project?.material.exists,
    !!project?.facts && project.facts.conflicts.length === 0,
    !!project?.generationConfig.mode,
    !!project?.selectedStrategyIds.length,
    !!project?.currentDraft,
    !!project?.selectedStrategyIds.length && project.selectedStrategyIds.every((id) => project.drafts.some((draft) => draft.strategyId === id && draft.confirmed)),
    !!project?.selectedStrategyIds.length && project.selectedStrategyIds.every((id) => {
      const draft = project.drafts.find((item) => item.strategyId === id && item.confirmed)
      return !!draft && project.imageTasks.some((task) => task.draftVersion === draft.version && imageTaskComplete(task))
    }),
    !!project?.selectedStrategyIds.length && project.selectedStrategyIds.every((id) => {
      const draft = project.drafts.find((item) => item.strategyId === id && item.confirmed)
      return !!draft && project.finalContents.some((item) => item.status === 'archived' && item.generationId === project.currentGeneration.id && item.draftVersion === draft.version)
    }),
  ], [project])

  function suggestedStep(data: ProjectData) {
    const allConfirmed = data.selectedStrategyIds.length > 0 && data.selectedStrategyIds.every((id) => data.drafts.some((draft) => draft.strategyId === id && draft.confirmed))
    const allArchived = allConfirmed && data.selectedStrategyIds.every((id) => {
      const draft = data.drafts.find((item) => item.strategyId === id && item.confirmed)
      return !!draft && data.finalContents.some((item) => item.status === 'archived' && item.generationId === data.currentGeneration.id && item.draftVersion === draft.version)
    })
    if (allArchived) return 8
    if (allConfirmed) return 7
    if (data.currentDraft) return 6
    if (data.selectedStrategyIds.length) return 5
    if (data.strategies.length) return 4
    if (data.generationConfig.mode) return 4
    if (data.facts && data.facts.conflicts.length === 0) return 3
    if (data.material.exists) return 2
    return 1
  }
  function showError(message?: string) { if (message) setError(message) }
  function flash(message: string) {
    setNotice(message)
    window.setTimeout(() => setNotice(''), 2600)
  }
  async function run(label: string, action: () => Promise<ApiResult>, success?: string) {
    setBusy(label); setError('')
    if (['material-ai', 'facts', 'strategies', 'draft', 'revise'].includes(label)) setStream({ operation: label, content: '', thinking: '', done: false })
    try {
      const result = await action()
      if (result.data) setProject(result.data)
      if (!result.ok) { showError(result.error); return false }
      if (success) flash(success)
      return true
    } catch (e) { showError(e instanceof Error ? e.message : '操作失败'); return false }
    finally { setBusy('') }
  }

  async function chooseFolder() {
    setError('')
    const result = await window.workshop.chooseProjectFolder()
    if (!result.ok) { showError(result.error); return }
    if (result.initialized && result.data) {
      setProject(result.data); setFlowStep(suggestedStep(result.data)); setPage('generate'); setViewGeneration('current')
      setRecent(await window.workshop.getRecentProjects())
    } else if (result.folder) {
      setPendingFolder(result.folder); setModal('project-init')
    }
  }
  async function initialize() {
    const ok = await run('initialize', () => window.workshop.initializeProject(pendingFolder), '项目已创建')
    if (ok) { setModal(null); setPage('assets'); setFlowStep(1); setRecent(await window.workshop.getRecentProjects()) }
  }
  async function openRecent(folder: string) {
    const result = await window.workshop.openRecentProject(folder)
    if (!result.ok || !result.data) { showError(result.error); return }
    setProject(result.data); setFlowStep(suggestedStep(result.data)); setViewGeneration('current'); setPage('generate')
  }
  async function importMaterial() { await run('material', () => window.workshop.importMaterial(), '原始素材已更新') }
  function appendMaterialFiles(incoming: MaterialUploadFile[]) {
    if (!incoming.length) { showError('没有读取到可添加的文件'); return }
    const supported = /\.(pdf|png|jpe?g|webp|gif)$/i
    const invalid = incoming.find((file) => !file.path || !supported.test(file.name))
    if (invalid) { showError(`不支持的文件格式：${invalid.name || '未知文件'}`); return }
    const oversized = incoming.find((file) => file.size <= 0 || file.size > 50 * 1024 * 1024)
    if (oversized) { showError(oversized.size <= 0 ? `文件为空：${oversized.name}` : `文件超过 50MB：${oversized.name}`); return }
    setMaterialFiles((current) => {
      const paths = new Set(current.map((file) => file.path))
      const next = [...current]
      for (const file of incoming) {
        if (paths.has(file.path)) continue
        paths.add(file.path)
        next.push(file)
      }
      if (next.length > 20) { showError('一次最多添加 20 个文件'); return current }
      if (next.reduce((total, file) => total + file.size, 0) > 50 * 1024 * 1024) { showError('待提取文件合计不能超过 50MB'); return current }
      setError('')
      return next
    })
  }
  async function selectMaterialFiles() {
    setError('')
    try {
      const result = await window.workshop.selectMaterialFiles()
      if (!result.ok) { showError(result.error); return }
      appendMaterialFiles(result.files || [])
    } catch (e) { showError(e instanceof Error ? e.message : '选择文件失败') }
  }
  function addDroppedMaterialFiles(files: File[]) {
    try {
      appendMaterialFiles(files.map((file) => ({ name: file.name, size: file.size, path: window.workshop.getPathForFile(file) })))
    } catch (e) { showError(e instanceof Error ? e.message : '无法读取拖入的文件') }
  }
  function removeMaterialFile(filePath: string) { setMaterialFiles((current) => current.filter((file) => file.path !== filePath)) }
  async function extractMaterial() {
    if (!materialFiles.length) { showError('请先添加要提取的 PDF 或图片'); return }
    setMaterialUploadOpen(false)
    const ok = await run('material-ai', () => window.workshop.extractMaterial(materialFiles.map((file) => file.path)), 'AI 已提取并更新原始素材')
    if (ok) setMaterialFiles([])
  }
  async function exportMaterial() {
    const ok = await run('export-material', () => window.workshop.exportMaterial())
    if (ok) flash('业务原始素材已导出')
  }
  function openAsset(kind: AssetKind, item?: Keyword | Rule | Reference) {
    setAssetTab(kind)
    if (kind === 'references' && item) {
      const reference = item as Reference
      setForm({ id: reference.id, title: reference.title, body: reference.body, hashtags: reference.hashtags.join(' ') })
    } else setForm(item ? { ...item } as unknown as Record<string, string> : { ...emptyForms[kind] })
    setModal(kind)
  }
  async function saveAsset() {
    if (assetTab === 'imageReferences' || assetTab === 'realPhotos') return
    const required = assetTab === 'keywords' ? form.root : assetTab === 'rules' ? form.prohibited : form.title && form.body
    if (!required?.trim()) {
      setError(assetTab === 'keywords' ? '核心关键词/词根为必填项' : assetTab === 'rules' ? '禁用词/敏感表述为必填项' : '标题和正文为必填项')
      return
    }
    const ok = await run('asset', () => window.workshop.saveAsset(assetTab, form), form.id ? '记录已更新' : '记录已添加')
    if (ok) setModal(null)
  }
  async function downloadAssetTemplate(kind: BatchAssetKind) {
    setBusy(`template-${kind}`); setError('')
    try {
      const result = await window.workshop.downloadAssetTemplate(kind)
      if (!result.ok) { showError(result.error); return }
      flash('模板已保存')
    } catch (e) { showError(e instanceof Error ? e.message : '模板下载失败') }
    finally { setBusy('') }
  }
  async function importAssetBatch(kind: BatchAssetKind) {
    setBusy(`import-${kind}`); setError('')
    try {
      const result = await window.workshop.importAssetBatch(kind)
      if (!result.ok) { showError(result.error); return }
      if (result.data) setProject(result.data)
      flash(`已导入 ${result.imported || 0} 条记录`)
    } catch (e) { showError(e instanceof Error ? e.message : '批量导入失败') }
    finally { setBusy('') }
  }
  async function exportAsset(kind: AssetKind) {
    const ok = await run(`export-${kind}`, () => window.workshop.exportAsset(kind))
    if (ok) flash('资料库已导出')
  }
  async function uploadImageReferences(isCover: boolean) {
    const label = `upload-image-reference-${isCover ? 'cover' : 'content'}`
    setBusy(label); setError('')
    try {
      const result = await window.workshop.uploadImageReferences(isCover)
      if (result.data) setProject(result.data)
      if (!result.ok) { showError(result.error); return }
      flash(result.failed ? `已上传 ${result.imported || 0} 张，${result.failed} 张打标失败，可在卡片中重试` : `已上传并完成 ${result.imported || 0} 张图片打标`)
    } catch (e) { showError(e instanceof Error ? e.message : '图片上传失败') }
    finally { setBusy('') }
  }
  async function importImageReferencePackage() {
    setBusy('import-image-reference-package'); setError('')
    try {
      const result = await window.workshop.importImageReferencePackage()
      if (result.data) setProject(result.data)
      if (!result.ok) { showError(result.error); return }
      const imported = result.imported || 0
      const skipped = result.skipped || 0
      flash(imported
        ? `已导入 ${imported} 张图片并复用原有标签${skipped ? `，跳过 ${skipped} 张重复图片` : ''}`
        : skipped ? `素材包中的 ${skipped} 张图片已存在，未重复导入` : '素材包中没有可导入的图片')
    } catch (e) { showError(e instanceof Error ? e.message : '图片素材包导入失败') }
    finally { setBusy('') }
  }
  async function exportImageReferencePackage() {
    setBusy('export-image-reference-package'); setError('')
    try {
      const result = await window.workshop.exportImageReferencePackage()
      if (!result.ok) { showError(result.error); return }
      if (result.savedPath) flash(`已导出 ${result.exported || 0} 张图片及其标签`)
    } catch (e) { showError(e instanceof Error ? e.message : '图片素材包导出失败') }
    finally { setBusy('') }
  }
  async function retagImageReference(id: string) {
    await run(`retag-image-reference-${id}`, () => window.workshop.retagImageReference(id), '图片标签已更新')
  }
  async function setImageReferenceRole(id: string, isCover: boolean) {
    await run(`role-image-reference-${id}`, () => window.workshop.setImageReferenceRole(id, isCover), '图片类型和标签已更新')
  }
  async function toggleImageReference(id: string, enabled: boolean) {
    await run(`toggle-image-reference-${id}`, () => window.workshop.toggleImageReference(id, enabled))
  }
  async function deleteImageReference(id: string) {
    if (!window.confirm(`确定删除参考图片 ${id}？图片文件也会从项目素材中移除。`)) return
    await run(`delete-image-reference-${id}`, () => window.workshop.deleteImageReference(id), '参考图片已删除')
  }
  async function uploadRealPhotos() {
    setRealPhotoProgress(null)
    setBusy('upload-real-photos'); setError('')
    try {
      const result = await window.workshop.uploadRealPhotos()
      if (result.data) setProject(result.data)
      if (!result.ok) { showError(result.error); return }
      const skipped = result.skipped ? `，跳过 ${result.skipped} 张重复图片` : ''
      const failed = result.failed ? `，${result.failed} 张分析失败` : ''
      flash(`已导入 ${result.imported || 0} 张业务实拍${skipped}${failed}`)
    } catch (e) { showError(e instanceof Error ? e.message : '业务实拍上传失败') }
    finally { setBusy('') }
  }
  async function importRealPhotoPackage() {
    setBusy('import-real-photo-package'); setError('')
    try {
      const result = await window.workshop.importRealPhotoPackage()
      if (result.data) setProject(result.data)
      if (!result.ok) { showError(result.error); return }
      const imported = result.imported || 0
      const skipped = result.skipped || 0
      flash(imported
        ? `已导入 ${imported} 张业务实拍并复用原有标签${skipped ? `，跳过 ${skipped} 张重复图片` : ''}`
        : skipped ? `素材包中的 ${skipped} 张业务实拍已存在，未重复导入` : '素材包中没有可导入的业务实拍')
    } catch (e) { showError(e instanceof Error ? e.message : '业务实拍素材包导入失败') }
    finally { setBusy('') }
  }
  async function exportRealPhotoPackage() {
    setBusy('export-real-photo-package'); setError('')
    try {
      const result = await window.workshop.exportRealPhotoPackage()
      if (!result.ok) { showError(result.error); return }
      if (result.savedPath) flash(`已导出 ${result.exported || 0} 张业务实拍及其标签`)
    } catch (e) { showError(e instanceof Error ? e.message : '业务实拍素材包导出失败') }
    finally { setBusy('') }
  }
  async function retagRealPhoto(id: string) {
    await run(`retag-real-photo-${id}`, () => window.workshop.retagRealPhoto(id), '实拍图片描述与标签已更新')
  }
  async function toggleRealPhoto(id: string, enabled: boolean) {
    await run(`toggle-real-photo-${id}`, () => window.workshop.toggleRealPhoto(id, enabled))
  }
  async function deleteRealPhoto(id: string) {
    if (!window.confirm(`确定删除业务实拍 ${id}？原图也会从当前项目中移除。`)) return
    await run(`delete-real-photo-${id}`, () => window.workshop.deleteRealPhoto(id), '业务实拍已删除')
  }
  async function createRealPosterSet(version: number) {
    setBusy('real-poster-set'); setError('')
    try {
      const planned = await window.workshop.createRealPosterPlan(version)
      if (planned.data) setProject(planned.data)
      if (!planned.ok || !planned.data) { showError(planned.error); return false }
      let current = planned.data
      const task = current.imageTasks.find((item) => item.id === planned.taskId || (item.mode === 'real_photo_poster' && item.draftVersion === version))
      if (!task) throw new Error('实拍宣传图策划已生成，但没有找到对应任务')
      const photoIds = [...new Set(task.plan.pages.flatMap((page) => page.sourcePhotoIds || []))]
      const entries = await Promise.all(photoIds.map(async (id) => {
        const photo = current.realPhotos.find((item) => item.id === id)
        if (!photo) throw new Error(`没有找到实拍素材 ${id}`)
        const result = await window.workshop.readGeneratedImage(photo.relativePath)
        if (!result.ok || !result.imageUrl) throw new Error(result.error || `无法读取实拍素材 ${id}`)
        return [id, result.imageUrl] as const
      }))
      const sources = Object.fromEntries(entries)
      for (const page of task.plan.pages) {
        const dataUrl = await renderRealPosterPage(page, current.realPhotos, sources)
        const saved = await window.workshop.saveRealPosterPage(task.id, page.id, dataUrl)
        if (!saved.ok || !saved.data) throw new Error(saved.error || `保存${page.label}失败`)
        current = saved.data
        setProject(current)
      }
      flash('实拍宣传图已完成并保存到项目')
      return true
    } catch (e) { showError(e instanceof Error ? e.message : '实拍宣传图制作失败'); return false }
    finally { setBusy('') }
  }
  async function saveRealPosterEdit(taskId: string, pageUpdate: RealPosterPageUpdate) {
    if (!project) return false
    setBusy(`real-poster-edit:${pageUpdate.id}`); setError('')
    try {
      const task = project.imageTasks.find((item) => item.id === taskId)
      const page = task?.plan.pages.find((item) => item.id === pageUpdate.id)
      if (!task || !page) throw new Error('没有找到要编辑的实拍宣传图')
      const photoIds = pageUpdate.sourcePhotoIds || []
      const entries = await Promise.all(photoIds.map(async (id) => {
        const photo = project.realPhotos.find((item) => item.id === id)
        if (!photo) throw new Error(`没有找到实拍素材 ${id}`)
        const result = await window.workshop.readGeneratedImage(photo.relativePath)
        if (!result.ok || !result.imageUrl) throw new Error(result.error || `无法读取实拍素材 ${id}`)
        return [id, result.imageUrl] as const
      }))
      const dataUrl = await renderRealPosterPage({ ...page, ...pageUpdate }, project.realPhotos, Object.fromEntries(entries))
      const saved = await window.workshop.saveRealPosterPage(task.id, page.id, dataUrl, pageUpdate)
      if (!saved.ok || !saved.data) throw new Error(saved.error || `保存${page.label}失败`)
      setProject(saved.data)
      flash(`${page.label}已保存为新版本`)
      return true
    } catch (e) { showError(e instanceof Error ? e.message : '实拍宣传图保存失败'); return false }
    finally { setBusy('') }
  }
  async function deleteAsset(kind: AssetKind, id: string) {
    if (!window.confirm(`确定删除 ${id}？该编号之后不会再分配给新记录。`)) return
    await run('delete', () => window.workshop.deleteAsset(kind, id), '记录已删除')
  }
  async function saveSettings() {
    if (!settings.baseUrl || !settings.apiKey || !settings.model) { setError('请完整填写接口地址、API Key 和模型名称'); return }
    if (settings.image.enabled && (!settings.image.baseUrl || !settings.image.apiKey || !settings.image.model)) { setError('请完整填写图片模型的接口地址、API Key 和模型名称'); return }
    if (settings.image.enabled && !resolvedImageEndpoint(settings.image)) { setError('图片模型接口地址不是有效的 HTTP(S) URL'); return }
    if (settings.image.enabled && settings.image.protocol === 'openai' && usesPublicDashScopeDomain(settings.image.baseUrl)) {
      setError('Qwen Image 的 OpenAI 兼容方式需要百炼 Workspace 专属域名；请改填 llm-….maas.aliyuncs.com，或选择 DashScope 同步协议')
      return
    }
    await run('settings', () => window.workshop.saveSettings(settings), '模型设置已保存')
  }
  async function newGeneration() {
    const nextStep = project?.facts && !project.facts.conflicts.length ? 3 : project?.material.exists ? 2 : 1
    const ok = await run('new-generation', () => window.workshop.startNewGeneration(), '已开始新一轮生成')
    if (ok) { setViewGeneration('current'); setFlowStep(nextStep); setChoice([]); setStrategyAdvice({}); setRevision(''); setContentMode(''); setUserBrief('') }
  }
  async function deleteGeneration(id: string) {
    if (!window.confirm(`确定删除 ${id} 的历史生成记录？\n\n只会删除这一轮的过程快照，不会删除终稿内容库、素材库或已生成的图片文件。此操作不可撤销。`)) return
    const ok = await run(`delete-generation:${id}`, () => window.workshop.deleteGeneration(id), `已删除生成记录 ${id}`)
    if (ok && viewGeneration === id) {
      setViewGeneration('current')
      if (project) setFlowStep(suggestedStep(project))
    }
  }
  async function archiveFinal(version: number, force = false) {
    if (!force && !window.confirm('入库后，这篇文案的核心选题、目标人群、切入问题和产品承接方式将进入后续避重范围。图片不会参与重复判断。是否确认入库？')) return false
    setBusy('archive-final'); setError('')
    try {
      const result = await window.workshop.archiveFinal(version, force)
      if (!result.ok && result.duplicateId && !force) {
        setBusy('')
        if (window.confirm(`这篇文字与 ${result.duplicateId} 完全一致。只有你明确希望复用历史内容时才应继续，是否仍然入库？`)) return archiveFinal(version, true)
        return false
      }
      if (!result.ok) { showError(result.error); return false }
      if (result.data) setProject(result.data)
      flash('终稿已入库，后续同模式生成会避开这个方向')
      return true
    } catch (e) { showError(e instanceof Error ? e.message : '终稿入库失败'); return false }
    finally { setBusy('') }
  }
  async function removeFinalContent(id: string) {
    if (!window.confirm(`确定将 ${id} 移出终稿库？移出后，这条内容将不再参与后续避重。`)) return
    await run(`remove-final:${id}`, () => window.workshop.removeFinalContent(id), '已移出终稿库')
  }

  const selectedStrategies = project?.strategies.filter((item) => project.selectedStrategyIds.includes(item.id)) || []
  const viewedDraft = project?.drafts.find((item) => item.version === viewVersion) || project?.currentDraft || null
  const archived = project?.generationHistory.find((item) => item.id === viewGeneration)

  if (restoringWindow) {
    return <div className="app-boot" role="status" aria-label="正在恢复应用状态"><LoaderCircle className="spin" size={22} /><span>正在恢复工作台…</span></div>
  }

  return (
    <div className="app-shell">
      <div className="drag-region" />
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark"><Sparkles size={17} /></span><div><b>红薯文案工坊</b><small>本地智能创作台</small></div></div>
        <nav className="main-nav" aria-label="主导航">
          <NavButton active={page === 'generate'} icon={<WandSparkles size={19} />} label="文案生成" hint="流程与生成记录" onClick={() => setPage('generate')} />
          <NavButton active={page === 'library'} icon={<Archive size={19} />} label="终稿内容库" hint="已确认的文案与图片" onClick={() => setPage('library')} />
          <NavButton active={page === 'assets'} icon={<PackageOpen size={19} />} label="素材管理" hint="项目内容资产" onClick={() => setPage('assets')} />
          <NavButton active={page === 'settings'} icon={<Settings size={19} />} label="设置" hint="模型与连接" onClick={() => setPage('settings')} />
        </nav>
        <div className="sidebar-project">
          <span>当前项目</span>
          <button className="project-switcher" onClick={chooseFolder}>
            <span className="project-icon"><FolderOpen size={17} /></span>
            <span><b>{project?.meta.name || '尚未选择项目'}</b><small>{project ? '点击切换项目' : '选择或创建本地项目'}</small></span>
            <ChevronRight size={16} />
          </button>
          <p>项目资料仅保存在本机</p>
        </div>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div><span className="mobile-brand"><Sparkles size={16} /></span><strong>红薯文案工坊</strong></div>
          <button className="project-chip" onClick={chooseFolder}><FolderOpen size={15} /><span>{project?.meta.name || '选择项目'}</span><ChevronDown size={14} /></button>
        </header>

        {page === 'generate' && <GenerationPage
          project={project} recent={recent} openRecent={openRecent} chooseFolder={chooseFolder}
          flowStep={flowStep} setFlowStep={setFlowStep} completed={completed}
          viewGeneration={viewGeneration} setViewGeneration={(id) => { setViewGeneration(id); setFlowStep(id === 'current' && project ? suggestedStep(project) : project?.generationHistory.find((item) => item.id === id)?.imageTasks?.length ? 7 : 6) }} archived={archived}
          newGeneration={newGeneration} deleteGeneration={deleteGeneration} busy={busy} setPage={setPage}
          stream={stream}
          imageProgress={imageProgress}
          resolution={resolution} setResolution={setResolution}
          thinkingModes={thinkingModes} setThinkingMode={(key, value) => setThinkingModes((current) => ({ ...current, [key]: value }))}
          generateFacts={async () => { const ok = await run('facts', () => window.workshop.extractFacts(resolution, thinkingModes.facts), resolution ? '业务事实已重新生成，请核对后继续' : '业务事实已提取，请核对后继续'); if (ok) setResolution('') }}
          contentMode={contentMode} setContentMode={setContentMode} userBrief={userBrief} setUserBrief={setUserBrief}
          saveGenerationConfig={async () => { if (!contentMode) return showError('请选择本轮内容模式'); const ok = await run('configure', () => window.workshop.configureGeneration(contentMode, userBrief), '本轮内容模式已保存'); if (ok) setFlowStep(4) }}
          generateStrategies={() => run('strategies', () => window.workshop.generateStrategies(thinkingModes.strategies), '策略候选已生成')}
          choice={choice} setChoice={setChoice} strategyAdvice={strategyAdvice} setStrategyAdvice={setStrategyAdvice}
          saveStrategy={async () => { if (!choice.length) return showError('请至少选择一个策略'); const ok = await run('select', () => window.workshop.selectStrategy(choice, strategyAdvice), `已保存 ${choice.length} 个策略`); if (ok) setFlowStep(5) }}
          selectedStrategies={selectedStrategies}
          generateDraft={async () => { const ok = await run('draft', () => window.workshop.generateDraft(thinkingModes.draft), '文案已生成'); if (ok) setFlowStep(6) }}
          draft={viewedDraft} viewVersion={viewVersion} setViewVersion={setViewVersion}
          revision={revision} setRevision={setRevision}
          revise={async () => { if (!viewVersion) return; const ok = await run('revise', () => window.workshop.reviseDraft(revision, viewVersion, thinkingModes.revise), '修改版本已生成'); if (ok) setRevision('') }}
          saveManual={async (value) => { const ok = await run('manual', () => window.workshop.saveManualDraft(value), '手动修改已保存为新版本'); return ok }}
          confirm={(version) => run('confirm', () => window.workshop.confirmDraft(version), '当前文案已确认')}
          createImageSet={(version) => run('image-set', () => window.workshop.createImageSet(version), '整套配图已生成并保存到项目')}
          createRealPosterSet={createRealPosterSet}
          saveRealPosterEdit={saveRealPosterEdit}
          regenerateImage={(taskId, pageId, feedback) => run(`image-regenerate:${pageId}`, () => window.workshop.regenerateImagePage(taskId, pageId, feedback), feedback ? '已按建议生成新版本' : '已改写提示词并生成新版本')}
          exportImage={async (taskId, imageId) => { const result = await window.workshop.exportGeneratedImage(taskId, imageId); if (!result.ok) showError(result.error); else if (result.savedPath) flash('图片已导出') }}
          exportImageSet={async (taskId) => { const result = await window.workshop.exportImageSet(taskId); if (!result.ok) showError(result.error); else if (result.savedPath) flash('整套图片已导出') }}
          goReferenceLibrary={() => { setPage('assets'); setAssetTab('imageReferences') }}
          goRealPhotoLibrary={() => { setPage('assets'); setAssetTab('realPhotos') }}
          archiveFinal={archiveFinal}
        />}
        {page === 'library' && <FinalLibraryPage project={project} chooseFolder={chooseFolder} remove={removeFinalContent} />}
        {page === 'assets' && <AssetsPage project={project} chooseFolder={chooseFolder} importMaterial={importMaterial} materialFiles={materialFiles} selectMaterialFiles={() => setMaterialUploadOpen(true)} addDroppedMaterialFiles={addDroppedMaterialFiles} removeMaterialFile={removeMaterialFile} clearMaterialFiles={() => setMaterialFiles([])} extractMaterial={extractMaterial} exportMaterial={exportMaterial} downloadAssetTemplate={downloadAssetTemplate} importAssetBatch={importAssetBatch} exportAsset={exportAsset} busy={busy} referenceProgress={referenceProgress} realPhotoProgress={realPhotoProgress} tab={assetTab} setTab={setAssetTab} openAsset={openAsset} deleteAsset={deleteAsset} toggleAsset={(kind, id, enabled) => run('toggle-asset', () => window.workshop.toggleAsset(kind, id, enabled))} uploadImageReferences={uploadImageReferences} importImageReferencePackage={importImageReferencePackage} exportImageReferencePackage={exportImageReferencePackage} retagImageReference={retagImageReference} setImageReferenceRole={setImageReferenceRole} toggleImageReference={toggleImageReference} deleteImageReference={deleteImageReference} uploadRealPhotos={uploadRealPhotos} importRealPhotoPackage={importRealPhotoPackage} exportRealPhotoPackage={exportRealPhotoPackage} retagRealPhoto={retagRealPhoto} toggleRealPhoto={toggleRealPhoto} deleteRealPhoto={deleteRealPhoto} goGenerate={() => { setPage('generate'); setFlowStep(project?.facts ? 3 : 2) }} />}
        {page === 'assets' && busy === 'material-ai' && <OcrStreamPreview content={stream.operation === 'material-ai' ? stream.content : ''} fileCount={materialFiles.length} />}
        {page === 'settings' && <SettingsPage settings={settings} setSettings={setSettings} save={saveSettings} busy={busy} />}
      </main>

      <Overlays {...{ modal, setModal, pendingFolder, initialize, busy, error, setError, assetTab: assetTab === 'imageReferences' || assetTab === 'realPhotos' ? 'keywords' : assetTab, form, setForm, saveAsset }} />
      {materialUploadOpen && <MaterialUploadModal files={materialFiles} selectFiles={selectMaterialFiles} addDroppedFiles={addDroppedMaterialFiles} removeFile={removeMaterialFile} clearFiles={() => setMaterialFiles([])} start={extractMaterial} close={() => setMaterialUploadOpen(false)} busy={busy} />}
      <Toast error={error} notice={notice} clear={() => setError('')} />
    </div>
  )
}

function NavButton({ active, icon, label, hint, onClick }: { active: boolean; icon: React.ReactNode; label: string; hint: string; onClick: () => void }) {
  return <button className={active ? 'active' : ''} onClick={onClick}><span className="nav-icon">{icon}</span><span><b>{label}</b><small>{hint}</small></span></button>
}

function PageHeader({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return <div className="page-header"><div><h1>{title}</h1><p>{children}</p></div>{action}</div>
}

type GenerationPageProps = {
  project: ProjectData | null; recent: string[]; openRecent: (folder: string) => void; chooseFolder: () => void;
  flowStep: number; setFlowStep: (step: number) => void; completed: boolean[]; viewGeneration: string; setViewGeneration: (id: string) => void;
  archived?: GenerationRecord; newGeneration: () => void; deleteGeneration: (id: string) => void; busy: string; setPage: (page: Page) => void;
  stream: { operation: string; content: string; thinking: string; done: boolean };
  imageProgress: Record<string, ImageProgressEvent>;
  thinkingModes: Record<'facts' | 'strategies' | 'draft' | 'revise', boolean>;
  setThinkingMode: (key: 'facts' | 'strategies' | 'draft' | 'revise', value: boolean) => void;
  resolution: string; setResolution: (value: string) => void; generateFacts: () => void; generateStrategies: () => void;
  contentMode: ContentMode | ''; setContentMode: (mode: ContentMode) => void; userBrief: string; setUserBrief: (value: string) => void; saveGenerationConfig: () => void;
  choice: string[]; setChoice: (ids: string[]) => void; strategyAdvice: Record<string, string>; setStrategyAdvice: (value: Record<string, string>) => void; saveStrategy: () => void;
  selectedStrategies: Strategy[]; generateDraft: () => void; draft: Draft | null; viewVersion: number | null; setViewVersion: (version: number) => void;
  revision: string; setRevision: (value: string) => void; revise: () => void;
  saveManual: (draft: { version: number; title: string; body: string; hashtags: string }) => Promise<boolean>;
  confirm: (version: number) => void;
  createImageSet: (version: number) => Promise<boolean>;
  createRealPosterSet: (version: number) => Promise<boolean>;
  saveRealPosterEdit: (taskId: string, page: RealPosterPageUpdate) => Promise<boolean>;
  regenerateImage: (taskId: string, pageId: string, feedback: string) => Promise<boolean>;
  exportImage: (taskId: string, imageId: string) => void; exportImageSet: (taskId: string) => void;
  goReferenceLibrary: () => void;
  goRealPhotoLibrary: () => void;
  archiveFinal: (version: number) => Promise<boolean>;
}

function imageTaskComplete(task?: ImageTask) {
  if (!task) return false
  const pages = task.plan?.pages || []
  return pages.length >= (task.mode === 'real_photo_poster' ? 1 : 4) && pages.every((page) => Boolean(task.currentImageIds?.[page.id]))
}

function archivedCompleted(record: GenerationRecord) {
  const selectedIds = record.selectedStrategyIds || (record.selectedStrategyId ? [record.selectedStrategyId] : [])
  const hasDraft = record.drafts.length > 0
  const allConfirmed = selectedIds.length > 0 && selectedIds.every((id) => record.drafts.some((draft) => draft.strategyId === id && draft.confirmed))
  const allIllustrated = selectedIds.length > 0 && selectedIds.every((id) => {
    const draft = record.drafts.find((item) => item.strategyId === id && item.confirmed)
    return !!draft && Boolean(record.imageTasks?.some((task) => task.draftVersion === draft.version && imageTaskComplete(task)))
  })
  return [
    Boolean(record.material?.exists || record.facts || record.strategies.length || hasDraft),
    Boolean((record.facts && !record.facts.conflicts.length) || record.strategies.length || hasDraft),
    Boolean(record.generationConfig?.mode || record.strategies.length || hasDraft),
    selectedIds.length > 0 || hasDraft,
    hasDraft,
    allConfirmed || Boolean(record.drafts.some((draft) => draft.confirmed) && !record.selectedStrategyIds?.length),
    allIllustrated,
    false,
  ]
}

function GenerationPage(props: GenerationPageProps) {
  const { project, recent, openRecent, chooseFolder, flowStep, setFlowStep, completed, viewGeneration, setViewGeneration, archived, newGeneration, busy } = props
  const modelBusy = ['facts', 'strategies', 'draft', 'revise'].includes(busy)
  const displayedCompleted = archived ? archivedCompleted(archived) : completed
  const displayedId = archived?.id || project?.currentGeneration.id
  const displayedAt = archived?.createdAt || project?.currentGeneration.createdAt
  return <div className="page-content generate-page">
    <PageHeader title="文案生成" action={project && <div className="generation-header-actions"><button className="secondary" onClick={newGeneration} disabled={busy === 'new-generation'}>{busy === 'new-generation' ? <LoaderCircle className="spin" size={17} /> : <Plus size={17} />}新建生成</button><GenerationHistory project={project} selected={viewGeneration} onSelect={setViewGeneration} onDelete={props.deleteGeneration} busy={busy} /></div>}>
      按流程完成一篇或多篇文案。同一个项目可以创建多轮生成，素材与历史记录互不丢失。
    </PageHeader>
    {!project ? <ProjectEmpty recent={recent} openRecent={openRecent} chooseFolder={chooseFolder} /> : <>
      <section className="flow-card" aria-label="文案生成流程">
        <div className="flow-context"><div><span>{archived ? '历史生成' : '当前生成'}</span><b>{displayedId}</b></div><small>开始于 {formatTime(displayedAt || '')}</small></div>
        <div className="flow-track">
          {flowSteps.map(([name, hint], index) => {
            const step = index + 1
            const done = displayedCompleted[index]
            return <button key={name} className={`${flowStep === step ? 'active' : ''} ${done ? 'done' : ''}`} onClick={() => setFlowStep(step)}>
              <span className="flow-number">{done ? <Check size={15} /> : step}</span><span><b>{name}</b><small>{hint}</small></span>
            </button>
          })}
        </div>
      </section>
      <div className="generation-main">
        {modelBusy && <GenerationActivity stream={props.stream} busy={busy} project={project} thinkingEnabled={props.thinkingModes[busy as 'facts' | 'strategies' | 'draft' | 'revise']} />}
        {archived ? <ArchivedGeneration record={archived} step={flowStep} busy={busy} regenerateImage={props.regenerateImage} exportImage={props.exportImage} exportImageSet={props.exportImageSet} /> : <CurrentFlow {...props} />}
      </div>
    </>}
  </div>
}

function ProjectEmpty({ recent, openRecent, chooseFolder }: { recent: string[]; openRecent: (folder: string) => void; chooseFolder: () => void }) {
  return <div className="empty-project-layout">
    <section className="empty-project surface-card"><span className="large-icon"><FolderOpen size={28} /></span><h2>先选择一个项目</h2><p>项目是文案、素材和生成记录的本地容器。你可以打开已有项目，或选择空文件夹创建新项目。</p><button className="primary" onClick={chooseFolder}><FolderOpen size={17} />选择项目文件夹</button></section>
    <section className="recent-panel"><div className="section-title"><div><h2>最近项目</h2><p>继续上次的生成进度</p></div></div>{recent.length ? <div className="recent-list">{recent.map((folder) => <button key={folder} onClick={() => openRecent(folder)}><span className="list-icon"><FolderOpen size={16} /></span><span><b>{folder.split('/').pop()}</b><small>{folder}</small></span><ChevronRight size={16} /></button>)}</div> : <div className="compact-empty"><Archive size={22} /><span>还没有最近项目</span></div>}</section>
  </div>
}

function CurrentFlow(props: GenerationPageProps) {
  const { project, flowStep } = props
  if (!project) return null
  if (flowStep === 1) return <SourceStep project={project} goAssets={() => props.setPage('assets')} next={() => props.setFlowStep(2)} />
  if (flowStep === 2) return <FactsStep project={project} busy={props.busy} resolution={props.resolution} setResolution={props.setResolution} thinking={props.thinkingModes.facts} setThinking={(value) => props.setThinkingMode('facts', value)} generate={props.generateFacts} next={() => props.setFlowStep(3)} />
  if (flowStep === 3) return <ModeStep project={project} mode={props.contentMode} setMode={props.setContentMode} userBrief={props.userBrief} setUserBrief={props.setUserBrief} busy={props.busy} save={props.saveGenerationConfig} />
  if (flowStep === 4) return <StrategyStep project={project} busy={props.busy} thinking={props.thinkingModes.strategies} setThinking={(value) => props.setThinkingMode('strategies', value)} generate={props.generateStrategies} choice={props.choice} setChoice={props.setChoice} strategyAdvice={props.strategyAdvice} setStrategyAdvice={props.setStrategyAdvice} save={props.saveStrategy} />
  if (flowStep === 5) return <ComposeStep project={project} strategies={props.selectedStrategies} busy={props.busy} thinking={props.thinkingModes.draft} setThinking={(value) => props.setThinkingMode('draft', value)} generate={props.generateDraft} back={() => props.setFlowStep(4)} />
  if (flowStep === 6) return <ReviewStep key={props.draft?.version ?? 'empty'} project={project} draft={props.draft} viewVersion={props.viewVersion} setViewVersion={props.setViewVersion} revision={props.revision} setRevision={props.setRevision} busy={props.busy} thinking={props.thinkingModes.revise} setThinking={(value) => props.setThinkingMode('revise', value)} revise={props.revise} saveManual={props.saveManual} confirm={props.confirm} goImages={() => props.setFlowStep(7)} />
  if (flowStep === 7) return <ImageStep project={project} busy={props.busy} stream={props.stream} imageProgress={props.imageProgress} createImageSet={props.createImageSet} createRealPosterSet={props.createRealPosterSet} saveRealPosterEdit={props.saveRealPosterEdit} regenerateImage={props.regenerateImage} exportImage={props.exportImage} exportImageSet={props.exportImageSet} goReferenceLibrary={props.goReferenceLibrary} goRealPhotoLibrary={props.goRealPhotoLibrary} goArchive={() => props.setFlowStep(8)} />
  return <ArchiveStep project={project} busy={props.busy} archiveFinal={props.archiveFinal} goImages={() => props.setFlowStep(7)} />
}

function StepHeader({ step, title, children, action }: { step: string; title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return <div className="step-header"><div><span>{step}</span><h2>{title}</h2><p>{children}</p></div>{action}</div>
}

function SourceStep({ project, goAssets, next }: { project: ProjectData; goAssets: () => void; next: () => void }) {
  return <section className="flow-panel surface-card">
    <StepHeader step="步骤 1 / 8" title="确认本轮生成依据">素材可以在项目内长期积累；开始前确认原始素材与增强资料是否已就绪。</StepHeader>
    <div className={`source-file ${project.material.exists ? 'ready' : ''}`}><span className="list-icon"><FileText size={20} /></span><div><b>{project.material.exists ? '业务原始素材.md' : '尚未导入业务原始素材'}</b><small>{project.material.exists ? `${project.material.content.length.toLocaleString()} 个字符 · 可用于事实提取` : '原始素材是生成流程的必需输入'}</small></div><span className="status-label">{project.material.exists ? '已就绪' : '待补充'}</span></div>
    <div className="asset-summary"><div><span>关键词</span><b>{project.keywords.length}</b><small>条</small></div><div><span>参考文案</span><b>{project.references.length}</b><small>篇</small></div><div><span>合规准则</span><b>{project.rules.length}</b><small>条</small></div></div>
    <div className="panel-actions"><button className="secondary" onClick={goAssets}><SlidersHorizontal size={17} />管理素材</button><button className="primary" onClick={next} disabled={!project.material.exists}>继续核对事实<ChevronRight size={17} /></button></div>
  </section>
}

function ThinkingToggle({ checked, onChange, recommended = false, disabled = false }: { checked: boolean; onChange: (value: boolean) => void; recommended?: boolean; disabled?: boolean }) {
  return <label className={`thinking-toggle ${checked ? 'active' : ''}`}><span className="thinking-icon"><Brain size={16} /></span><span><b>思考模式 {recommended && <em>推荐</em>}</b><small>{checked ? '生成时展开模型的思考轨迹' : '关闭时响应更快'}</small></span><span className="switch"><input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} /><span /></span></label>
}

function FactsStep({ project, busy, resolution, setResolution, thinking, setThinking, generate, next }: { project: ProjectData; busy: string; resolution: string; setResolution: (value: string) => void; thinking: boolean; setThinking: (value: boolean) => void; generate: () => void; next: () => void }) {
  const conflicts = project.facts?.conflicts || []
  return <section className="flow-panel surface-card">
    <StepHeader step="步骤 2 / 8" title="核对业务事实">模型只提取素材实际包含的内容，并标记互相冲突的口径。</StepHeader>
    {project.material.exists && <ThinkingToggle checked={thinking} onChange={setThinking} recommended disabled={!!busy} />}
    {!project.material.exists ? <Gate icon={<FileText size={25} />} message="缺少原始素材" target="请先前往素材管理导入业务原始素材。" /> : !project.facts ? <ActionState icon={<BookOpenText size={27} />} title="从原始素材提取事实" description="系统会自动归类、去重，并区分可确认事实、宣传表达和口径冲突。" button={<button className="primary" onClick={generate} disabled={!!busy}>{busy === 'facts' ? <LoaderCircle className="spin" size={17} /> : <WandSparkles size={17} />}开始提取</button>} /> : conflicts.length ? <div className="conflict-area"><div className="alert-heading"><Scale size={20} /><div><b>发现 {conflicts.length} 处口径冲突</b><p>确认统一口径后，系统会重新生成完整事实。</p></div></div>{conflicts.map((item, index) => <div className="conflict-row" key={`${item.topic}-${index}`}><span>{item.topic}</span><b>{item.question}</b><ul>{item.versions.map((version) => <li key={version}>{version}</li>)}</ul></div>)}<label className="field"><span>统一口径</span><textarea rows={4} value={resolution} onChange={(e) => setResolution(e.target.value)} placeholder="逐条说明应采用的标准口径" /></label><button className="primary" onClick={generate} disabled={!resolution.trim() || !!busy}>{busy === 'facts' ? <LoaderCircle className="spin" size={17} /> : <RefreshCw size={17} />}按确认口径重新提取</button></div> : <><div className="facts-heading"><span><CheckCircle2 size={18} />已形成完整业务事实</span><button className="text-button" onClick={generate} disabled={!!busy}><RefreshCw size={15} />重新提取</button></div><div className="facts-table">{project.facts.confirmedFacts.map((group, index) => <div key={`${group.category}-${index}`}><b>{group.category}</b><ul>{group.items.map((item) => <li key={item}>{item}</li>)}</ul></div>)}</div><div className="panel-actions right"><button className="primary" onClick={next}>继续选择内容模式<ChevronRight size={17} /></button></div></>}
  </section>
}

function ModeStep({ project, mode, setMode, userBrief, setUserBrief, busy, save }: { project: ProjectData; mode: ContentMode | ''; setMode: (mode: ContentMode) => void; userBrief: string; setUserBrief: (value: string) => void; busy: string; save: () => void }) {
  if (!project.facts || project.facts.conflicts.length) return <section className="flow-panel surface-card"><StepHeader step="步骤 3 / 8" title="选择内容模式">先完成业务事实核对，再决定本轮的表达方式。</StepHeader><Gate icon={<Circle size={25} />} message="业务事实尚未确认" target="请先完成上一步。" /></section>
  return <section className="flow-panel surface-card mode-step">
    <StepHeader step="步骤 3 / 8" title="选择本轮内容模式">这不是语气选择，而是两套不同的信息取舍规则。每轮只使用一种模式。</StepHeader>
    <div className="mode-picker">
      <button className={mode === 'explicit' ? 'active explicit' : 'explicit'} onClick={() => setMode('explicit')} aria-pressed={mode === 'explicit'}><span><FileText size={21} /></span><div><b>显式宣传</b><p>明确介绍产品、活动或服务。可以出现产品名称和较完整信息，但仍保持一条主线。</p><small>适合产品介绍、活动发布、项目答疑</small></div>{mode === 'explicit' && <CheckCircle2 size={19} />}</button>
      <button className={mode === 'native' ? 'active native' : 'native'} onClick={() => setMode('native')} aria-pressed={mode === 'native'}><span><Sparkles size={21} /></span><div><b>生活化种草 <em>隐式</em></b><p>先解决一个生活问题，再自然连接一至两个业务点；默认不写价格、联系方式和完整流程。</p><small>适合生活灵感、问题解决、场景建议</small></div>{mode === 'native' && <CheckCircle2 size={19} />}</button>
    </div>
    <label className="mode-brief field"><span>这篇你最想怎么写 <small>可选，系统会优先遵循原话</small></span><textarea rows={4} value={userBrief} onChange={(event) => setUserBrief(event.target.value)} placeholder="例如：写给正在安排秋假的初中生家长，从短假期也能打开孩子眼界切入，不要出现价格、报名和每天行程。" /></label>
    <div className="mode-boundary"><Scale size={17} /><p><b>生活化不等于隐藏商业身份。</b>系统不会伪造亲身体验、虚构素人人设或把创意场景写成已经提供的服务。</p></div>
    <div className="panel-actions right"><button className="primary" onClick={save} disabled={!mode || !!busy}>{busy === 'configure' ? <LoaderCircle className="spin" size={17} /> : <Check size={17} />}确认模式并生成策略</button></div>
  </section>
}

function StrategyStep({ project, busy, thinking, setThinking, generate, choice, setChoice, strategyAdvice, setStrategyAdvice, save }: { project: ProjectData; busy: string; thinking: boolean; setThinking: (value: boolean) => void; generate: () => void; choice: string[]; setChoice: (ids: string[]) => void; strategyAdvice: Record<string, string>; setStrategyAdvice: (value: Record<string, string>) => void; save: () => void }) {
  return <section className="flow-panel surface-card">
    <StepHeader step="步骤 4 / 8" title="选择微选题策略" action={project.strategies.length > 0 && <button className="secondary compact" onClick={generate} disabled={!!busy}><RefreshCw size={15} />换一批策略</button>}>可以同时选择多个小切口，后续会为每个策略各生成一篇独立文案。</StepHeader>
    {project.facts && !project.facts.conflicts.length && <ThinkingToggle checked={thinking} onChange={setThinking} disabled={!!busy} />}
    {!project.generationConfig.mode ? <Gate icon={<Circle size={25} />} message="尚未选择内容模式" target="请先完成上一步。" /> : project.strategies.length === 0 ? <ActionState icon={<Sparkles size={27} />} title={`生成${project.generationConfig.mode === 'native' ? '生活化种草' : '显式宣传'}策略`} description={`系统会读取同模式终稿库做避重，并结合 ${project.references.filter((item) => item.enabled).length} 篇参考文案寻找 3–5 个小切口。`} button={<button className="primary" onClick={generate} disabled={!!busy}>{busy === 'strategies' ? <LoaderCircle className="spin" size={17} /> : <WandSparkles size={17} />}生成策略</button>} /> : <><div className="selection-summary">已选 {choice.length} 个策略，将生成 {choice.length} 篇独立文案；每个策略都可以单独填写最高优先级的补充要求。</div><div className="strategy-list">{project.strategies.map((strategy) => <StrategyCard key={strategy.id} strategy={strategy} project={project} selected={choice.includes(strategy.id)} onSelect={() => setChoice(choice.includes(strategy.id) ? choice.filter((id) => id !== strategy.id) : [...choice, strategy.id])} advice={strategyAdvice[strategy.id] || ''} onAdviceChange={(value) => setStrategyAdvice({ ...strategyAdvice, [strategy.id]: value })} />)}</div><div className="panel-actions right"><button className="primary" onClick={save} disabled={!choice.length || !!busy}>{busy === 'select' ? <LoaderCircle className="spin" size={17} /> : <Check size={17} />}确认 {choice.length} 个策略并继续</button></div></>}
  </section>
}

function StrategyCard({ strategy, project, selected, onSelect, advice, onAdviceChange }: { strategy: Strategy; project: ProjectData; selected: boolean; onSelect: () => void; advice?: string; onAdviceChange?: (value: string) => void }) {
  const references = strategy.referenceIds.map((id) => project.references.find((item) => item.id === id)).filter(Boolean) as Reference[]
  return <div className={`strategy-item ${selected ? 'selected' : ''}`}><button className="strategy-row" onClick={onSelect} aria-pressed={selected}><span className="strategy-radio">{selected && <Check size={14} />}</span><span className="strategy-copy"><span><code>{strategy.id}</code><b>{strategy.name}</b></span><strong>{strategy.coreQuestion || strategy.angle}</strong><span className="strategy-facts"><i>写给谁</i>{strategy.targetAudience || '由正文自然确定'}<i>读者得到</i>{strategy.readerValue || strategy.bestFor}<i>业务承接</i>{strategy.businessBridge || strategy.angle}</span><small>{strategy.route}</small>{strategy.differenceFromArchive && <small className="archive-difference">与历史不同：{strategy.differenceFromArchive}</small>}<em>{references.length ? `参考：${references.map((item) => item.title).join('、')}` : '无指定参考文案'}</em></span><ChevronRight size={17} /></button>{selected && onAdviceChange && <label className="strategy-advice"><span><PenLine size={14} />这篇文案的补充要求 <small>优先于策略与参考文案</small></span><textarea rows={3} value={advice} onChange={(event) => onAdviceChange(event.target.value)} placeholder="例如：写给家长；不要价格和逐日行程；结尾不要引导私信" /></label>}</div>
}

function ComposeStep({ project, strategies, busy, thinking, setThinking, generate, back }: { project: ProjectData; strategies: Strategy[]; busy: string; thinking: boolean; setThinking: (value: boolean) => void; generate: () => void; back: () => void }) {
  return <section className="flow-panel surface-card">
    <StepHeader step="步骤 5 / 8" title="生成完整文案">模型会按照选定微策略生成标题、正文和话题标签，并优先执行你的自然语言要求。</StepHeader>
    {!strategies.length ? <Gate icon={<LayoutTemplate size={25} />} message="尚未选定策略" target="请返回上一步选择并确认策略。" /> : <><ThinkingToggle checked={thinking} onChange={setThinking} disabled={!!busy} /><div className="compose-strategy-list">{strategies.map((strategy, index) => <div className="compose-strategy" key={strategy.id}><span>文案 {String.fromCharCode(65 + index)} · {strategy.id}</span><h3>{strategy.name}</h3><p>{strategy.angle}</p>{project.strategyAdvice[strategy.id] && <small>{project.strategyAdvice[strategy.id]}</small>}</div>)}</div><div className="generation-inputs"><div><span>将生成</span><b>{strategies.length} 篇</b></div><div><span>生效关键词</span><b>{project.keywords.filter((item) => item.enabled).length} 条</b></div><div><span>生效合规准则</span><b>{project.rules.filter((item) => item.enabled).length} 条</b></div><div><span>指定参考</span><b>{new Set(strategies.flatMap((strategy) => strategy.referenceIds)).size} 篇</b></div></div><div className="panel-actions"><button className="secondary" onClick={back}>返回调整策略</button><button className="primary" onClick={generate} disabled={!!busy}>{busy === 'draft' ? <LoaderCircle className="spin" size={17} /> : <WandSparkles size={17} />}生成 {strategies.length} 篇文案</button></div></>}
  </section>
}

function documentLabel(index: number) { return `文案 ${String.fromCharCode(65 + index)}` }
function revisionLabel(drafts: Draft[], draft: Draft) {
  const index = drafts.findIndex((item) => item.version === draft.version)
  return index <= 0 ? '初稿' : `修订 ${index}`
}

function ReviewStep({ project, draft, viewVersion, setViewVersion, revision, setRevision, busy, thinking, setThinking, revise, saveManual, confirm, goImages }: { project: ProjectData; draft: Draft | null; viewVersion: number | null; setViewVersion: (version: number) => void; revision: string; setRevision: (value: string) => void; busy: string; thinking: boolean; setThinking: (value: boolean) => void; revise: () => void; saveManual: (draft: { version: number; title: string; body: string; hashtags: string }) => Promise<boolean>; confirm: (version: number) => void; goImages: () => void }) {
  const [manual, setManual] = useState(() => ({
    title: draft?.title || '',
    body: draft?.body || '',
    hashtags: draft?.hashtags.map((tag) => `#${tag}`).join(' ') || '',
  }))
  if (!draft) return <section className="flow-panel surface-card"><StepHeader step="步骤 6 / 8" title="审核并确认文案">确认前，文案不会成为最终输出。</StepHeader><Gate icon={<FileText size={25} />} message="还没有生成文案" target="请先完成策略选择并生成文案。" /></section>
  const strategy = project.strategies.find((item) => item.id === draft.strategyId)
  const strategyIds = [...new Set([...project.selectedStrategyIds, ...project.drafts.map((item) => item.strategyId)])]
  const documentIndex = strategyIds.indexOf(draft.strategyId)
  const revisions = project.drafts.filter((item) => item.strategyId === draft.strategyId)
  const dirty = manual.title !== draft.title || manual.body !== draft.body || manual.hashtags !== draft.hashtags.map((tag) => `#${tag}`).join(' ')
  const allConfirmed = project.selectedStrategyIds.every((id) => project.drafts.some((item) => item.strategyId === id && item.confirmed))
  return <section className="flow-panel review-panel surface-card">
    <StepHeader step="步骤 6 / 8" title="审核并确认文案">最新修改要求可以改变原策略；系统不会为了维持旧方向而忽略你的原话。</StepHeader>
    <div className="review-grid"><article className="draft-preview editable-canvas"><div className="draft-meta"><span>{documentLabel(documentIndex)}</span><span>{strategy?.name || draft.strategyId}</span><span>{revisionLabel(revisions, draft)}</span><span>{formatTime(draft.createdAt)}</span>{draft.confirmed && <b><CheckCircle2 size={14} />已确认</b>}</div><input className="canvas-title" aria-label="文案标题" value={manual.title} onChange={(event) => setManual({ ...manual, title: event.target.value })} /><textarea className="canvas-body" aria-label="文案正文" rows={Math.max(18, manual.body.split('\n').length + 4)} value={manual.body} onChange={(event) => setManual({ ...manual, body: event.target.value })} /><div className="canvas-tags"><span>话题</span><input aria-label="话题标签" value={manual.hashtags} onChange={(event) => setManual({ ...manual, hashtags: event.target.value })} placeholder="#亲子研学 #周末去处" /></div>{dirty && <div className="canvas-savebar"><span>画布中有未保存的修改</span><button className="primary compact" disabled={!manual.title.trim() || !manual.body.trim() || !!busy} onClick={() => saveManual({ version: draft.version, ...manual })}>{busy === 'manual' ? <LoaderCircle className="spin" size={16} /> : <Save size={16} />}保存为{revisions.length ? `修订 ${revisions.length}` : '初稿'}</button></div>}</article><aside className="review-tools"><div className="document-nav"><h3>本轮文案</h3><div className="document-list">{strategyIds.map((strategyId, index) => { const items = project.drafts.filter((item) => item.strategyId === strategyId); const latest = items.at(-1); const itemStrategy = project.strategies.find((item) => item.id === strategyId); if (!latest) return null; return <button key={strategyId} className={strategyId === draft.strategyId ? 'active' : ''} onClick={() => setViewVersion(latest.version)}><span>{documentLabel(index)}</span><b>{itemStrategy?.name || strategyId}</b>{items.some((item) => item.confirmed) ? <CheckCircle2 size={14} /> : <small>{items.length > 1 ? `${items.length - 1} 次修订` : '待审核'}</small>}</button> })}</div><h3>修订记录</h3><div className="revision-tabs">{revisions.map((item) => <button key={item.version} className={viewVersion === item.version ? 'active' : ''} onClick={() => setViewVersion(item.version)}>{revisionLabel(revisions, item)}{item.confirmed && <Check size={12} />}</button>)}</div></div><div className="revision-form"><label className="field"><span>AI 修改这篇文案</span><textarea rows={4} value={revision} onChange={(e) => setRevision(e.target.value)} placeholder="例如：标题更直接；删减第二段；语气再克制一点" /></label><ThinkingToggle checked={thinking} onChange={setThinking} disabled={!!busy} /><button className="secondary full" onClick={revise} disabled={!revision.trim() || !!busy || dirty}>{busy === 'revise' ? <LoaderCircle className="spin" size={17} /> : <RefreshCw size={17} />}生成一次修订</button>{dirty && <p className="inline-hint">请先保存画布中的修改，再使用 AI 修订。</p>}{!draft.confirmed && <button className="primary full" onClick={() => confirm(draft.version)} disabled={!!busy || dirty}><Check size={17} />确认这一稿</button>}</div>{draft.confirmed && <div className="confirmed-state"><CheckCircle2 size={23} /><b>这篇文案已确认</b><p>已保存到项目文件夹。</p></div>}{allConfirmed && <button className="primary full review-new" onClick={goImages}><ImagePlus size={17} />继续制作配图</button>}</aside></div>
  </section>
}

function ImageStep({ project, busy, stream, imageProgress, createImageSet, createRealPosterSet, saveRealPosterEdit, regenerateImage, exportImage, exportImageSet, goReferenceLibrary, goRealPhotoLibrary, goArchive }: {
  project: ProjectData; busy: string; stream: { operation: string; content: string; thinking: string; done: boolean }; imageProgress: Record<string, ImageProgressEvent>;
  createImageSet: (version: number) => Promise<boolean>; createRealPosterSet: (version: number) => Promise<boolean>;
  saveRealPosterEdit: (taskId: string, page: RealPosterPageUpdate) => Promise<boolean>;
  regenerateImage: (taskId: string, pageId: string, feedback: string) => Promise<boolean>;
  exportImage: (taskId: string, imageId: string) => void; exportImageSet: (taskId: string) => void;
  goReferenceLibrary: () => void; goRealPhotoLibrary: () => void; goArchive: () => void;
}) {
  const confirmedDrafts = project.selectedStrategyIds.map((strategyId) => project.drafts.find((item) => item.strategyId === strategyId && item.confirmed)).filter(Boolean) as Draft[]
  const [selectedVersion, setSelectedVersion] = useState(confirmedDrafts[0]?.version || 0)
  const [imageMode, setImageMode] = useState<'ai_generated' | 'real_photo_poster'>('ai_generated')
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({})
  const [feedbacks, setFeedbacks] = useState<Record<string, string>>({})
  const [editingPage, setEditingPage] = useState('')
  const [posterEditorPageId, setPosterEditorPageId] = useState('')
  const planningStreamRef = useRef<HTMLPreElement>(null)
  const draft = confirmedDrafts.find((item) => item.version === selectedVersion) || confirmedDrafts[0]
  const task = project.imageTasks.find((item) => item.draftVersion === draft?.version && item.strategyId === draft?.strategyId && (item.mode || 'ai_generated') === imageMode)
  const isReal = imageMode === 'real_photo_poster'
  const versionProgress = draft ? imageProgress[`version:${draft.version}`] : undefined
  const taskProgress = task ? imageProgress[`task:${task.id}`] : undefined
  const progress = busy === 'image-set' && versionProgress?.phase === 'planning' ? versionProgress : taskProgress || versionProgress || null
  const planningContent = stream.operation === `${isReal ? 'real-poster-plan' : 'image-plan'}:${draft?.version || 0}` ? stream.content : ''

  useEffect(() => { if (!draft && confirmedDrafts[0]) setSelectedVersion(confirmedDrafts[0].version) }, [draft, confirmedDrafts])
  useEffect(() => { if (planningStreamRef.current) planningStreamRef.current.scrollTop = planningStreamRef.current.scrollHeight }, [planningContent])
  useEffect(() => {
    let active = true
    const currentImages = task?.plan.pages.map((page) => task.images.find((image) => image.id === task.currentImageIds?.[page.id])).filter(Boolean) as GeneratedImage[] || []
    const supportImages = isReal
      ? [...new Set(task?.plan.pages.flatMap((page) => page.sourcePhotoIds || []) || [])].map((id) => project.realPhotos.find((item) => item.id === id)).filter(Boolean) as RealPhoto[]
      : [...new Set(task?.plan.pages.flatMap((page) => page.referenceImageIds || []) || [])].map((id) => project.imageReferences.find((item) => item.id === id)).filter(Boolean) as ImageReference[]
    Promise.all([...currentImages, ...supportImages].map(async (image) => {
      const result = await window.workshop.readGeneratedImage(image.relativePath)
      return [image.id, result.ok ? result.imageUrl || '' : ''] as const
    })).then((entries) => { if (active) setImageUrls(Object.fromEntries(entries)) })
    return () => { active = false }
  }, [task?.id, task?.updatedAt, selectedVersion, imageMode, project.imageReferences, project.realPhotos])

  if (!confirmedDrafts.length) return <section className="flow-panel surface-card"><StepHeader step="步骤 7 / 8" title="制作小红书配图">配图只会使用已经确认的文案和业务事实。</StepHeader><Gate icon={<ImageIcon size={25} />} message="还没有已确认的文案" target="请先回到上一步确认文案。" /></section>
  if (!draft) return null

  const pages = task?.plan.pages || []
  const readyCount = pages.filter((page) => task?.currentImageIds?.[page.id]).length
  const generatingSet = busy === 'image-set' || busy === 'real-poster-set'
  const usableReferences = project.imageReferences.filter((item) => item.enabled && item.taggingStatus === 'ready')
  const usableRealPhotos = project.realPhotos.filter((item) => item.enabled && item.taggingStatus === 'ready')
  const ready = isReal ? usableRealPhotos.length > 0 : usableReferences.length > 0
  const hasPlan = Boolean(task && pages.length >= (isReal ? 1 : 4))
  const allIllustrated = confirmedDrafts.every((item) => project.imageTasks.some((candidate) => candidate.draftVersion === item.version && imageTaskComplete(candidate)))

  return <section className="flow-panel image-workspace surface-card">
    <StepHeader step="步骤 7 / 8" title="制作小红书配图" action={task && readyCount > 0 && <button className="secondary compact" onClick={() => exportImageSet(task.id)} disabled={!!busy}><Download size={15} />导出整套</button>}>
      选择 AI 生成新画面，或直接使用业务实拍图片进行分组、拼接和艺术字排版。
    </StepHeader>
    <div className="image-mode-switch" role="group" aria-label="配图制作方式">
      <button className={!isReal ? 'active' : ''} onClick={() => setImageMode('ai_generated')}><WandSparkles size={18} /><span><b>AI 生成套图</b><small>按参考样本生成新画面</small></span></button>
      <button className={isReal ? 'active real' : 'real'} onClick={() => setImageMode('real_photo_poster')}><ImageIcon size={18} /><span><b>实拍宣传图</b><small>原图拼接并覆盖艺术字</small></span></button>
    </div>
    {!ready && <div className="reference-readiness"><ImageIcon size={20} /><div><b>{isReal ? '先建立业务实拍图库' : '先建立小红书图片参考库'}</b><span>{isReal ? '上传真实业务照片，系统会结合业务原始素材生成描述和分类标签。' : '上传你认可的封面和内容页，完成视觉打标后再生成。'}</span></div><button className="secondary compact" onClick={isReal ? goRealPhotoLibrary : goReferenceLibrary}><Upload size={15} />去上传{isReal ? '实拍' : '样本'}</button></div>}
    <div className="image-document-tabs">{confirmedDrafts.map((item, index) => {
      const itemTasks = project.imageTasks.filter((candidate) => candidate.draftVersion === item.version)
      const done = itemTasks.some(imageTaskComplete)
      const count = Math.max(0, ...itemTasks.map((candidate) => candidate.plan.pages.filter((page) => candidate.currentImageIds?.[page.id]).length))
      return <button key={item.version} className={item.version === draft.version ? 'active' : ''} onClick={() => setSelectedVersion(item.version)}><span>{documentLabel(index)}</span><b>{item.title}</b>{done ? <CheckCircle2 size={15} /> : <small>{count ? `${count} 张已完成` : '待生成'}</small>}</button>
    })}</div>

    {generatingSet && !hasPlan ? <div className="image-planning-stage" aria-live="polite">
      <div className="planning-copy"><span><LoaderCircle className="spin" size={17} /></span><div><b>{isReal ? '正在按宣传主题分组实拍图片' : progress?.label || '正在拆解文案与翻页节奏'}</b><small>{isReal ? '分组完成后会在本地自动裁剪、拼接并绘制艺术字' : '先展开画布，规划完成后会逐张呈现成品'}</small></div></div>
      <div className="planning-stream"><div><Sparkles size={14} /><span>{isReal ? '实拍分组实时输出' : '套图策划实时输出'}</span><small>{stream.done ? '正在整理结果' : '生成中'}</small></div><pre ref={planningStreamRef}>{planningContent || (isReal ? '正在读取业务原始素材、已确认文案和实拍图片标签…' : '正在读取已确认文案、业务事实与参考图片标签…')}</pre><i aria-hidden="true" /></div>
    </div> : !hasPlan ? <ActionState
      icon={isReal ? <LayoutTemplate size={27} /> : <ImagePlus size={27} />}
      title={isReal ? `为「${draft.title}」制作实拍宣传图` : `为「${draft.title}」生成整套配图`}
      description={isReal ? '系统会先按共同宣传主题分组，再从单图、双图、三图和四图模板中选择合适版式，在本地准确绘制中文艺术字。' : '系统会先拆解翻页叙事，并从参考库中为每一页选择最合适的视觉样本。通常生成 4–6 张。'}
      button={<button className="primary" onClick={() => isReal ? createRealPosterSet(draft.version) : createImageSet(draft.version)} disabled={!!busy || !ready}>{generatingSet ? <LoaderCircle className="spin" size={17} /> : <WandSparkles size={17} />}{generatingSet ? '正在制作' : isReal ? '用实拍图片制作' : '按参考样本生成整套配图'}</button>}
    /> : <>
      <div className="storyboard-head"><div><span>{isReal ? '实拍分组思路' : '套图思路'}</span><h3>{task!.plan.concept}</h3><p>{task!.plan.visualContinuity}</p></div><div className="storyboard-progress"><b>{readyCount}/{pages.length}</b><span>张已完成</span></div></div>
      {generatingSet && <div className="set-generation-progress" aria-live="polite"><LoaderCircle className="spin" size={18} /><span><b>{isReal ? '正在本地拼接并绘制艺术字' : progress?.label || '正在生成整套配图'}</b><small>{`已完成 ${readyCount} 张，共 ${pages.length} 张`}</small></span><div className="generation-meter"><i style={{ width: `${pages.length ? (readyCount / pages.length) * 100 : 0}%` }} /></div></div>}
      <div className="storyboard-grid">{pages.map((page, index) => {
        const imageId = task!.currentImageIds?.[page.id]
        const image = task!.images.find((item) => item.id === imageId)
        const revisions = task!.images.filter((item) => item.pageId === page.id).length
        const references = isReal
          ? (page.sourcePhotoIds || []).map((id) => project.realPhotos.find((item) => item.id === id)).filter(Boolean) as RealPhoto[]
          : (page.referenceImageIds || []).map((id) => project.imageReferences.find((item) => item.id === id)).filter(Boolean) as ImageReference[]
        const regenerating = !isReal && busy === `image-regenerate:${page.id}`
        const generating = generatingSet && !image
        const editing = editingPage === page.id
        return <article key={page.id} className={`story-page ${page.role === 'cover' ? 'cover' : ''} ${generating ? 'is-generating' : ''} ${imageUrls[image?.id || ''] ? 'is-revealed' : ''}`}>
          <div className="story-image">{image && imageUrls[image.id] ? <img src={imageUrls[image.id]} alt={`${page.label}：${page.title}`} /> : <div className={`story-image-empty ${generating ? 'generation-canvas' : ''}`}>{generating ? <><div className="canvas-orb" /><i className="canvas-scan" /><LoaderCircle className="spin" size={22} /><b>正在制作{page.label}</b></> : <><ImageIcon size={25} /><span>等待生成</span></>}</div>}<span className="story-index">{String(index + 1).padStart(2, '0')}</span><span className="story-role">{page.label}</span>{regenerating && <div className="story-image-busy"><LoaderCircle className="spin" size={25} /><b>正在更新{page.label}</b></div>}</div>
          <div className="story-copy"><div><h3>{page.title}</h3><p>{isReal ? page.groupReason || page.purpose : page.purpose}</p></div><span>版本 {Math.max(1, revisions)}</span></div>
          <div className="story-references"><span>{isReal ? `${references.length} 张实拍` : '本页参考'}</span><div>{references.map((reference) => { const summary = 'originalDescription' in reference.tags ? reference.tags.originalDescription : reference.tags.summary; return <span key={reference.id} title={summary}>{imageUrls[reference.id] ? <img src={imageUrls[reference.id]} alt={summary} /> : <ImageIcon size={14} />}<small>{reference.id}</small></span> })}</div></div>
          <div className="story-actions"><button className="text-button" onClick={() => image && exportImage(task!.id, image.id)} disabled={!image || !!busy}><Download size={14} />导出</button>{isReal ? <button className="secondary compact" onClick={() => setPosterEditorPageId(page.id)} disabled={!image || !!busy}><PenLine size={14} />编辑图片</button> : <><button className="secondary compact" onClick={() => regenerateImage(task!.id, page.id, '')} disabled={!image || !!busy}><RefreshCw size={14} />换一张</button><button className={`secondary compact ${editing ? 'active' : ''}`} onClick={() => setEditingPage(editing ? '' : page.id)} disabled={!image || !!busy}><PenLine size={14} />提修改</button></>}</div>
          {!isReal && editing && <div className="story-feedback"><label htmlFor={`feedback-${page.id}`}>你希望怎么改？</label><textarea id={`feedback-${page.id}`} rows={3} value={feedbacks[page.id] || ''} onChange={(event) => setFeedbacks({ ...feedbacks, [page.id]: event.target.value })} /><button className="primary compact" onClick={async () => { const ok = await regenerateImage(task!.id, page.id, feedbacks[page.id] || ''); if (ok) setEditingPage('') }} disabled={!feedbacks[page.id]?.trim() || !!busy}><WandSparkles size={14} />按要求重新生成</button></div>}
        </article>
      })}</div>
      {isReal && <div className="resume-image-set real-remix"><div><b>需要换一套分组或版式？</b><span>重新制作会基于当前文案和已启用实拍图片生成新方案。</span></div><button className="secondary" onClick={() => createRealPosterSet(draft.version)} disabled={!!busy}><RefreshCw size={16} />重新分组排版</button></div>}
      {!isReal && readyCount < pages.length && !generatingSet && <div className="resume-image-set"><div><b>还有 {pages.length - readyCount} 张未完成</b><span>可以从中断位置继续，不会重复生成已完成页面。</span></div><button className="primary" onClick={() => createImageSet(draft.version)} disabled={!!busy}><ImagePlus size={16} />继续生成</button></div>}
    </>}
    {allIllustrated && <div className="image-finish-bar"><div><CheckCircle2 size={21} /><span><b>本轮套图已完成</b><small>每篇文案都已经有可入库的配图。</small></span></div></div>}
    <div className="panel-actions"><span className="skip-note">配图可以稍后补充；终稿避重只分析文字，不分析图片。</span><button className="primary" onClick={goArchive} disabled={!!busy}>继续确认入库<ChevronRight size={17} /></button></div>
    {isReal && task && posterEditorPageId && task.plan.pages.find((page) => page.id === posterEditorPageId) && <RealPosterEditor
      key={`${task.id}:${posterEditorPageId}`}
      task={task}
      page={task.plan.pages.find((page) => page.id === posterEditorPageId)!}
      photos={project.realPhotos}
      initialSources={imageUrls}
      busy={busy === `real-poster-edit:${posterEditorPageId}`}
      close={() => setPosterEditorPageId('')}
      save={(pageUpdate) => saveRealPosterEdit(task.id, pageUpdate)}
    />}
  </section>
}

function RealPosterEditor({ task, page, photos, initialSources, busy, close, save }: {
  task: ImageTask; page: ImagePlanPage; photos: RealPhoto[]; initialSources: Record<string, string>; busy: boolean;
  close: () => void; save: (page: RealPosterPageUpdate) => Promise<boolean>;
}) {
  const startingIds = page.sourcePhotoIds?.length ? page.sourcePhotoIds.slice(0, 4) : ['']
  const startingLayout = REAL_POSTER_LAYOUTS.some((item) => item.id === page.layoutTemplateId && item.count === startingIds.length)
    ? page.layoutTemplateId! : defaultRealPosterLayout(startingIds.length)
  const startingDraft: RealPosterPageUpdate = {
    id: page.id,
    title: page.title || '',
    subtitle: page.subtitle || '',
    sourcePhotoIds: startingIds,
    layoutTemplateId: startingLayout,
    textPosition: page.textPosition === 'top' ? 'top' : 'bottom',
    accentColor: page.accentColor || '#ffd43b',
  }
  const [draft, setDraft] = useState<RealPosterPageUpdate>(startingDraft)
  const [selectedSlot, setSelectedSlot] = useState(0)
  const [assetSources, setAssetSources] = useState(initialSources)
  const [previewUrl, setPreviewUrl] = useState('')
  const [previewing, setPreviewing] = useState(true)
  const [query, setQuery] = useState('')
  const initialSnapshot = useRef(JSON.stringify(startingDraft))
  const sourceIds = draft.sourcePhotoIds || ['']
  const usablePhotos = photos.filter((photo) => photo.enabled && photo.taggingStatus === 'ready')
  const dirty = JSON.stringify(draft) !== initialSnapshot.current
  const complete = Boolean(draft.title?.trim()) && sourceIds.length > 0 && sourceIds.every(Boolean)
  const selectedPhoto = photos.find((photo) => photo.id === sourceIds[selectedSlot])
  const layouts = REAL_POSTER_LAYOUTS.filter((layout) => layout.count === sourceIds.length)
  const rects = realPosterLayoutRects(draft.layoutTemplateId || defaultRealPosterLayout(sourceIds.length), sourceIds.length)
  const filteredPhotos = usablePhotos.filter((photo) => {
    const haystack = `${photo.id} ${photo.originalName} ${photo.tags.originalDescription} ${photo.tags.themeTags.join(' ')} ${photo.tags.sceneTags.join(' ')}`.toLowerCase()
    return haystack.includes(query.trim().toLowerCase())
  })

  const attemptClose = () => {
    if (!busy && dirty && !window.confirm('当前修改还没有保存，确定关闭编辑器吗？')) return
    close()
  }

  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') attemptClose() }
    document.addEventListener('keydown', onKeyDown)
    return () => { document.body.style.overflow = previousOverflow; document.removeEventListener('keydown', onKeyDown) }
  }, [dirty, busy])

  useEffect(() => {
    let active = true
    const missing = usablePhotos.filter((photo) => !assetSources[photo.id])
    if (!missing.length) return () => { active = false }
    Promise.all(missing.map(async (photo) => {
      const result = await window.workshop.readGeneratedImage(photo.relativePath)
      return [photo.id, result.ok ? result.imageUrl || '' : ''] as const
    })).then((entries) => { if (active) setAssetSources((current) => ({ ...current, ...Object.fromEntries(entries) })) })
    return () => { active = false }
  }, [page.id])

  useEffect(() => {
    let active = true
    const timer = window.setTimeout(() => {
      setPreviewing(true)
      renderRealPosterPreview({ ...page, ...draft }, photos, assetSources)
        .then((url) => { if (active) setPreviewUrl(url) })
        .finally(() => { if (active) setPreviewing(false) })
    }, 120)
    return () => { active = false; window.clearTimeout(timer) }
  }, [draft, assetSources])

  const changeCount = (count: number) => {
    const previousCount = sourceIds.length
    const nextIds = Array.from({ length: count }, (_, index) => sourceIds[index] || '')
    setDraft((current) => ({ ...current, sourcePhotoIds: nextIds, layoutTemplateId: defaultRealPosterLayout(count) }))
    setSelectedSlot((current) => count > previousCount ? previousCount : Math.min(current, count - 1))
  }

  const removeSlot = (index: number) => {
    if (sourceIds.length === 1) {
      setDraft((current) => ({ ...current, sourcePhotoIds: [''] }))
      setSelectedSlot(0)
      return
    }
    const nextIds = sourceIds.filter((_, itemIndex) => itemIndex !== index)
    setDraft((current) => ({ ...current, sourcePhotoIds: nextIds, layoutTemplateId: defaultRealPosterLayout(nextIds.length) }))
    setSelectedSlot((current) => Math.min(current > index ? current - 1 : current, nextIds.length - 1))
  }

  const choosePhoto = (photoId: string) => {
    const nextIds = [...sourceIds]
    const existingIndex = nextIds.indexOf(photoId)
    if (existingIndex >= 0 && existingIndex !== selectedSlot) {
      const previous = nextIds[selectedSlot]
      nextIds[selectedSlot] = photoId
      nextIds[existingIndex] = previous
    } else nextIds[selectedSlot] = photoId
    setDraft((current) => ({ ...current, sourcePhotoIds: nextIds }))
  }

  return <div className="poster-editor-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) attemptClose() }}>
    <div className="poster-editor" role="dialog" aria-modal="true" aria-labelledby="poster-editor-title">
      <header className="poster-editor-head">
        <div><span className="poster-editor-mark"><PenLine size={17} /></span><div><h2 id="poster-editor-title">编辑{page.label}</h2><p>{task.strategyId} · 修改会另存为新版本，原图不会被覆盖</p></div></div>
        <button className="icon-button" onClick={attemptClose} disabled={busy} aria-label="关闭编辑器"><X size={17} /></button>
      </header>
      <div className="poster-editor-body">
        <section className="poster-preview-pane" aria-label="宣传图实时预览">
          <div className="poster-preview-toolbar"><span>实时成片</span><small>{sourceIds.length} 张图片 · {layouts.find((item) => item.id === draft.layoutTemplateId)?.name}</small></div>
          <div className="poster-preview-stage">
            <div className={`poster-preview-canvas ${previewing ? 'updating' : ''}`}>
              {previewUrl ? <img src={previewUrl} alt={`${page.label}编辑预览`} /> : <div className="poster-preview-loading"><LoaderCircle className="spin" size={24} /><span>正在准备画布</span></div>}
              {rects.map((rect, index) => <button
                key={`${index}-${sourceIds[index]}`}
                className={`${selectedSlot === index ? 'selected' : ''} ${sourceIds[index] ? '' : 'empty'}`}
                style={{ left: `${rect.x / 10.8}%`, top: `${rect.y / 14.4}%`, width: `${rect.width / 10.8}%`, height: `${rect.height / 14.4}%` }}
                onClick={() => setSelectedSlot(index)}
                aria-label={`选择图片槽位 ${index + 1}`}
              ><span>{index + 1}</span>{!sourceIds[index] && <b>选择图片</b>}</button>)}
            </div>
          </div>
          <div className="poster-preview-hint"><span>{selectedSlot + 1}</span><div><b>{selectedPhoto ? selectedPhoto.tags.originalDescription || selectedPhoto.originalName : `图片 ${selectedSlot + 1} 还未选择`}</b><small>{selectedPhoto ? '在右侧素材区选择另一张即可替换' : '从右侧素材区选择一张图片填入这里'}</small></div></div>
        </section>
        <aside className="poster-control-pane">
          <section className="poster-control-section">
            <div className="poster-control-heading"><div><b>标题文案</b><span>预览会自动处理换行和可读性</span></div></div>
            <label className="poster-field"><span>主标题 <small>{draft.title?.length || 0}/40</small></span><input maxLength={40} value={draft.title || ''} onChange={(event) => setDraft({ ...draft, title: event.target.value })} placeholder="输入宣传图主标题" /></label>
            <label className="poster-field"><span>副标题 <small>{draft.subtitle?.length || 0}/60</small></span><input maxLength={60} value={draft.subtitle || ''} onChange={(event) => setDraft({ ...draft, subtitle: event.target.value })} placeholder="可选，用一句话补充信息" /></label>
            <div className="poster-style-row"><div><span>文字位置</span><div className="poster-segmented"><button className={draft.textPosition === 'top' ? 'active' : ''} onClick={() => setDraft({ ...draft, textPosition: 'top' })}>顶部</button><button className={draft.textPosition === 'bottom' ? 'active' : ''} onClick={() => setDraft({ ...draft, textPosition: 'bottom' })}>底部</button></div></div><div><span>强调色</span><div className="poster-color-list">{['#ffd43b', '#fb7185', '#5eead4', '#93c5fd', '#ffffff'].map((color) => <button key={color} className={draft.accentColor === color ? 'active' : ''} style={{ backgroundColor: color }} onClick={() => setDraft({ ...draft, accentColor: color })} aria-label={`选择强调色 ${color}`}>{draft.accentColor === color && <Check size={12} />}</button>)}</div></div></div>
          </section>

          <section className="poster-control-section">
            <div className="poster-control-heading"><div><b>图片与排版</b><span>先确定图片数量，再选择对应版式</span></div><em>{sourceIds.filter(Boolean).length}/{sourceIds.length} 已填</em></div>
            <div className="poster-count-picker" role="group" aria-label="图片数量">{[1, 2, 3, 4].map((count) => <button key={count} className={sourceIds.length === count ? 'active' : ''} onClick={() => changeCount(count)}><b>{count}</b><span>{count === 1 ? '单图' : `${count} 图`}</span></button>)}</div>
            <div className="poster-layout-list">{layouts.map((layout) => <button key={layout.id} className={draft.layoutTemplateId === layout.id ? 'active' : ''} onClick={() => setDraft({ ...draft, layoutTemplateId: layout.id })}><PosterLayoutDiagram id={layout.id} count={layout.count} /><span><b>{layout.name}</b><small>{layout.description}</small></span>{draft.layoutTemplateId === layout.id && <CheckCircle2 size={16} />}</button>)}</div>
            <div className="poster-slot-list">{sourceIds.map((id, index) => {
              const photo = photos.find((item) => item.id === id)
              return <div key={`${index}-${id}`} className={`poster-slot-row ${selectedSlot === index ? 'active' : ''}`} role="button" tabIndex={0} onClick={() => setSelectedSlot(index)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelectedSlot(index) } }}><span className="poster-slot-thumb">{id && assetSources[id] ? <img src={assetSources[id]} alt="" /> : <ImageIcon size={17} />}</span><span><b>图片 {index + 1}</b><small>{photo ? photo.tags.originalDescription || photo.originalName : '点击后从下方素材中选择'}</small></span><span className="poster-slot-status">{id ? '替换' : '待选择'}</span><button aria-label={`移除图片 ${index + 1}`} onClick={(event) => { event.stopPropagation(); removeSlot(index) }}><Trash2 size={13} /></button></div>
            })}</div>
          </section>

          <section className="poster-control-section poster-assets-section">
            <div className="poster-control-heading"><div><b>替换图片 {selectedSlot + 1}</b><span>选择素材后会立即出现在左侧画布</span></div></div>
            <label className="poster-search"><ImageIcon size={14} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索图片编号、场景或描述" />{query && <button onClick={() => setQuery('')} aria-label="清空搜索"><X size={13} /></button>}</label>
            {filteredPhotos.length ? <div className="poster-asset-grid">{filteredPhotos.map((photo) => <button key={photo.id} className={sourceIds[selectedSlot] === photo.id ? 'active' : ''} onClick={() => choosePhoto(photo.id)} title={photo.tags.originalDescription || photo.originalName}>{assetSources[photo.id] ? <img src={assetSources[photo.id]} alt={photo.tags.originalDescription || photo.originalName} /> : <span><LoaderCircle className="spin" size={16} /></span>}<small>{photo.id}</small>{sourceIds.includes(photo.id) && <b>{sourceIds.indexOf(photo.id) + 1}</b>}</button>)}</div> : <div className="poster-assets-empty"><ImageIcon size={20} /><span>没有匹配的实拍图片</span></div>}
          </section>
        </aside>
      </div>
      <footer className="poster-editor-actions"><span className={complete && dirty ? 'ready' : ''}>{complete ? dirty ? <><CheckCircle2 size={15} />已准备好保存</> : <>修改任一内容后即可保存新版本</> : <>还有 {sourceIds.filter((id) => !id).length} 个图片位置待填写</>}</span><div><button className="secondary" onClick={attemptClose} disabled={busy}>取消</button><button className="primary" disabled={!complete || !dirty || busy} onClick={async () => { if (await save(draft)) close() }}>{busy ? <LoaderCircle className="spin" size={16} /> : <Save size={16} />}{busy ? '正在保存' : '保存新版本'}</button></div></footer>
    </div>
  </div>
}

function PosterLayoutDiagram({ id, count }: { id: string; count: number }) {
  return <span className={`poster-layout-diagram layout-${id}`}>{Array.from({ length: count }, (_, index) => <i key={index} />)}</span>
}

function ArchiveStep({ project, busy, archiveFinal, goImages }: { project: ProjectData; busy: string; archiveFinal: (version: number) => Promise<boolean>; goImages: () => void }) {
  const confirmedDrafts = project.selectedStrategyIds.map((strategyId) => project.drafts.find((item) => item.strategyId === strategyId && item.confirmed)).filter(Boolean) as Draft[]
  return <section className="flow-panel surface-card archive-step">
    <StepHeader step="步骤 8 / 8" title="确认入库">入库是最终资产确认。入库后，系统会在同一种内容模式下避开完全一致的选题方向。</StepHeader>
    {!confirmedDrafts.length ? <Gate icon={<Archive size={25} />} message="没有可入库的确认稿" target="请先回到审核步骤确认文案。" /> : <div className="archive-candidates">{confirmedDrafts.map((draft) => {
      const strategy = project.strategies.find((item) => item.id === draft.strategyId)
      const archived = project.finalContents.find((item) => item.status === 'archived' && item.generationId === project.currentGeneration.id && item.draftVersion === draft.version)
      const taskCandidates = project.imageTasks.filter((item) => item.draftVersion === draft.version)
      const task = taskCandidates.find(imageTaskComplete) || taskCandidates.at(-1)
      return <article key={draft.version} className={archived ? 'archived' : ''}><div><span>{project.generationConfig.mode === 'native' ? '生活化种草' : '显式宣传'} · 文案 v{draft.version}</span><h3>{draft.title}</h3><p>{strategy?.coreQuestion || strategy?.angle}</p><small>{task ? `${Object.keys(task.currentImageIds || {}).length} 张配图` : '无配图，将仅保存文字'}</small></div>{archived ? <b className="archive-done"><CheckCircle2 size={17} />已入库为 {archived.id}</b> : <button className="primary" onClick={() => archiveFinal(draft.version)} disabled={!!busy}>{busy === 'archive-final' ? <LoaderCircle className="spin" size={16} /> : <Archive size={16} />}确认入库</button>}</article>
    })}</div>}
    <div className="archive-warning"><Scale size={18} /><p>确认入库后，这篇文案的核心选题、目标人群、切入问题和业务承接方式会进入后续避重范围。图片只作为资产保存，不参与重复判断。</p></div>
    <div className="panel-actions"><button className="secondary" onClick={goImages}>返回配图</button></div>
  </section>
}

function GenerationHistory({ project, selected, onSelect, onDelete, busy }: { project: ProjectData; selected: string; onSelect: (id: string) => void; onDelete: (id: string) => void; busy: string }) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])
  const currentConfirmed = project.selectedStrategyIds.length > 0 && project.selectedStrategyIds.every((id) => project.drafts.some((draft) => draft.strategyId === id && draft.confirmed))
  const selectRecord = (id: string) => { onSelect(id); setOpen(false) }
  return <div className={`generation-history ${open ? 'open' : ''}`} ref={containerRef}><button className="secondary generation-history-trigger" onClick={() => setOpen((value) => !value)} aria-expanded={open} aria-haspopup="menu"><Archive size={16} />生成记录<span>{project.generationHistory.length + 1}</span><ChevronDown size={15} /></button>{open && <div className="generation-history-panel" role="menu"><div className="history-list"><button className={selected === 'current' ? 'active' : ''} onClick={() => selectRecord('current')} role="menuitem"><span className="history-status current" /><span><b>{project.currentDraft?.title || '当前生成'}</b><small>{project.currentGeneration.id} · {currentConfirmed ? '已确认' : '进行中'}</small></span></button>{[...project.generationHistory].reverse().map((item) => { const done = archivedCompleted(item)[4]; const deleting = busy === `delete-generation:${item.id}`; return <div key={item.id} className={`history-record ${selected === item.id ? 'active' : ''}`}><button className="history-record-select" onClick={() => selectRecord(item.id)} role="menuitem"><span className="history-status" /><span><b>{item.drafts.at(-1)?.title || '未完成的生成'}</b><small>{item.id} · {done ? '已确认' : '未完成'}</small></span></button><button className="history-record-delete" onClick={() => onDelete(item.id)} disabled={!!busy} title={`删除 ${item.id}`} aria-label={`删除生成记录 ${item.id}`}>{deleting ? <LoaderCircle className="spin" size={14} /> : <Trash2 size={14} />}</button></div> })}</div>{project.generationHistory.length === 0 && <p className="history-empty">完成当前文案后，可以继续创建下一轮。</p>}</div>}</div>
}

function ArchivedGeneration({ record, step, busy, regenerateImage, exportImage, exportImageSet }: { record: GenerationRecord; step: number; busy: string; regenerateImage: (taskId: string, pageId: string, feedback: string) => Promise<boolean>; exportImage: (taskId: string, imageId: string) => void; exportImageSet: (taskId: string) => void }) {
  const selectedIds = record.selectedStrategyIds || (record.selectedStrategyId ? [record.selectedStrategyId] : [])
  const selectedStrategies = record.strategies.filter((item) => selectedIds.includes(item.id))
  if (step === 1) return <section className="flow-panel surface-card"><StepHeader step={`${record.id} · 阶段 1`} title="这轮的生成依据">以下是这轮生成使用的素材。</StepHeader><div className={`source-file ${record.material?.exists ? 'ready' : ''}`}><span className="list-icon"><FileText size={20} /></span><div><b>{record.material?.name || '业务原始素材'}</b><small>{record.material?.content ? `${record.material.content.length.toLocaleString()} 个字符` : '旧版记录未保存原始素材快照'}</small></div></div><div className="asset-summary"><div><span>关键词</span><b>{record.keywords?.length || 0}</b><small>条</small></div><div><span>参考文案</span><b>{record.references?.length || 0}</b><small>篇</small></div><div><span>合规准则</span><b>{record.rules?.length || 0}</b><small>条</small></div></div></section>
  if (step === 2) return <section className="flow-panel surface-card"><StepHeader step={`${record.id} · 阶段 2`} title="这轮的业务事实">这轮生成使用的事实提取结果。</StepHeader>{record.facts ? <div className="facts-table">{record.facts.confirmedFacts.map((group, index) => <div key={`${group.category}-${index}`}><b>{group.category}</b><ul>{group.items.map((item) => <li key={item}>{item}</li>)}</ul></div>)}</div> : <Gate icon={<Archive size={25} />} message="无事实快照" target="这是升级前创建的历史记录。" />}</section>
  if (step === 3) return <section className="flow-panel surface-card"><StepHeader step={`${record.id} · 阶段 3`} title="这轮的内容模式">查看本轮采用的表达方式和用户原始要求。</StepHeader><div className="archived-mode"><b>{record.generationConfig?.mode === 'native' ? '生活化种草（隐式）' : record.generationConfig?.mode === 'explicit' ? '显式宣传' : '旧版记录未保存内容模式'}</b>{record.generationConfig?.userBriefRaw && <p>{record.generationConfig.userBriefRaw}</p>}</div></section>
  if (step === 4) return <section className="flow-panel surface-card"><StepHeader step={`${record.id} · 阶段 4`} title="这轮的策略选择">蓝色高亮项是本轮实际选用的策略。</StepHeader><div className="strategy-list">{record.strategies.map((strategy) => <div key={strategy.id}><StrategyCard strategy={strategy} project={{ references: record.references || [] } as ProjectData} selected={selectedIds.includes(strategy.id)} onSelect={() => undefined} />{selectedIds.includes(strategy.id) && (record.strategyAdvice?.[strategy.id] || (record.selectedStrategyId === strategy.id && record.advice)) && <div className="archived-advice"><PenLine size={13} /><span>{record.strategyAdvice?.[strategy.id] || record.advice}</span></div>}</div>)}</div></section>
  if (step === 5) return <section className="flow-panel surface-card"><StepHeader step={`${record.id} · 阶段 5`} title="这轮的生成任务">本轮按以下 {selectedStrategies.length} 个策略生成文案。</StepHeader><div className="compose-strategy-list">{selectedStrategies.map((strategy, index) => <div className="compose-strategy" key={strategy.id}><span>{documentLabel(index)} · {strategy.id}</span><h3>{strategy.name}</h3><p>{strategy.angle}</p>{(record.strategyAdvice?.[strategy.id] || (record.selectedStrategyId === strategy.id && record.advice)) && <small>{record.strategyAdvice?.[strategy.id] || record.advice}</small>}</div>)}</div></section>
  if (step === 6) return <ArchivedReview record={record} />
  if (step === 7) return <ArchivedImages record={record} busy={busy} regenerateImage={regenerateImage} exportImage={exportImage} exportImageSet={exportImageSet} />
  return <section className="flow-panel surface-card"><StepHeader step={`${record.id} · 阶段 8`} title="确认入库">终稿入库情况请在左侧“终稿内容库”查看。</StepHeader><Gate icon={<Archive size={25} />} message="终稿库独立保存" target="历史生成记录只保留当轮过程，终稿内容库负责长期资产与避重。" /></section>
}

function ArchivedReview({ record }: { record: GenerationRecord }) {
  const initial = [...record.drafts].reverse().find((item) => item.confirmed) || record.drafts.at(-1)
  const [version, setVersion] = useState(initial?.version || 0)
  useEffect(() => setVersion(initial?.version || 0), [record.id])
  const draft = record.drafts.find((item) => item.version === version) || initial
  if (!draft) return <section className="flow-panel surface-card"><StepHeader step={`${record.id} · 阶段 6`} title="这轮的审核结果">这轮生成没有可以查看的文案。</StepHeader><Gate icon={<Archive size={25} />} message="这轮生成没有产出文案" target="记录保留了生成进度，但没有可预览的终稿。" /></section>
  const strategyIds = [...new Set([...(record.selectedStrategyIds || []), ...record.drafts.map((item) => item.strategyId)])]
  const documentIndex = strategyIds.indexOf(draft.strategyId)
  const revisions = record.drafts.filter((item) => item.strategyId === draft.strategyId)
  return <section className="flow-panel surface-card">
    <StepHeader step={`${record.id} · 阶段 6`} title="这轮的审核结果">查看这轮文案及其修订记录。</StepHeader>
    <div className="review-grid">
      <article className="draft-preview"><div className="draft-meta"><span>{documentLabel(documentIndex)}</span><span>{record.strategies.find((item) => item.id === draft.strategyId)?.name || draft.strategyId}</span><span>{revisionLabel(revisions, draft)}</span><span>{formatTime(draft.createdAt)}</span>{draft.confirmed && <b><CheckCircle2 size={14} />已确认</b>}</div><h3>{draft.title}</h3><div>{draft.body.split('\n').map((line, index) => <p key={index}>{line || '\u00a0'}</p>)}</div><footer>{draft.hashtags.map((tag) => <span key={tag}>#{tag}</span>)}</footer></article>
      <aside className="review-tools"><div className="document-nav"><h3>本轮文案</h3><div className="document-list">{strategyIds.map((strategyId, index) => { const items = record.drafts.filter((item) => item.strategyId === strategyId); const latest = [...items].reverse().find((item) => item.confirmed) || items.at(-1); if (!latest) return null; return <button key={strategyId} className={strategyId === draft.strategyId ? 'active' : ''} onClick={() => setVersion(latest.version)}><span>{documentLabel(index)}</span><b>{record.strategies.find((item) => item.id === strategyId)?.name || strategyId}</b>{items.some((item) => item.confirmed) && <CheckCircle2 size={14} />}</button> })}</div><h3>修订记录</h3><div className="revision-tabs">{revisions.map((item) => <button key={item.version} className={item.version === draft.version ? 'active' : ''} onClick={() => setVersion(item.version)}>{revisionLabel(revisions, item)}{item.confirmed && <Check size={12} />}</button>)}</div></div></aside>
    </div>
  </section>
}

function ArchivedImages({ record, busy, regenerateImage, exportImage, exportImageSet }: { record: GenerationRecord; busy: string; regenerateImage: (taskId: string, pageId: string, feedback: string) => Promise<boolean>; exportImage: (taskId: string, imageId: string) => void; exportImageSet: (taskId: string) => void }) {
  const tasks = record.imageTasks || []
  const [sources, setSources] = useState<Record<string, string>>({})
  const [selectedTaskId, setSelectedTaskId] = useState(tasks[0]?.id || '')
  const [feedbacks, setFeedbacks] = useState<Record<string, string>>({})
  const [editingPage, setEditingPage] = useState('')
  const [progress, setProgress] = useState<ImageProgressEvent | null>(null)
  useEffect(() => setSelectedTaskId(tasks[0]?.id || ''), [record.id])
  useEffect(() => window.workshop.onImageProgress((payload) => {
    if (payload.task?.generationId === record.id) setProgress(payload)
  }), [record.id])
  useEffect(() => {
    let active = true
    const images = tasks.flatMap((task) => task.images)
    Promise.all(images.map(async (item) => {
      const result = await window.workshop.readGeneratedImage(item.relativePath)
      return [item.id, result.ok ? result.imageUrl || '' : ''] as const
    })).then((entries) => { if (active) setSources(Object.fromEntries(entries)) })
    return () => { active = false }
  }, [record.id, tasks.map((item) => item.updatedAt).join('|')])
  if (!tasks.length) return <section className="flow-panel surface-card"><StepHeader step={`${record.id} · 阶段 7`} title="制作小红书配图">这轮生成还没有宣传图片。</StepHeader><Gate icon={<ImageIcon size={25} />} message="还没有配图" target="这轮生成可能在制作配图功能上线前完成。" /></section>
  const task = tasks.find((item) => item.id === selectedTaskId) || tasks[0]
  const draft = record.drafts.find((item) => item.version === task.draftVersion)
  const pages = task.plan?.pages || []
  const readyCount = pages.filter((page) => task.currentImageIds?.[page.id]).length
  return <section className="flow-panel image-workspace surface-card">
    <StepHeader step={`${record.id} · 阶段 7`} title="生成一整套小红书配图" action={readyCount > 0 && <button className="secondary compact" onClick={() => exportImageSet(task.id)} disabled={!!busy}><Download size={15} />导出整套</button>}>查看和继续使用这轮生成的封面与内容页。</StepHeader>
    <div className="image-document-tabs">{tasks.map((item, index) => {
      const itemDraft = record.drafts.find((candidate) => candidate.version === item.draftVersion)
      return <button key={item.id} className={item.id === task.id ? 'active' : ''} onClick={() => setSelectedTaskId(item.id)}><span>{documentLabel(index)}</span><b>{itemDraft?.title || item.brief?.coverTitle || '配图任务'}</b>{imageTaskComplete(item) ? <CheckCircle2 size={15} /> : <small>{Object.keys(item.currentImageIds || {}).length} 张已完成</small>}</button>
    })}</div>
    <div className="storyboard-head"><div><span>{task.mode === 'real_photo_poster' ? '实拍分组思路' : '套图思路'}</span><h3>{task.plan?.concept || task.brief?.subject || '历史配图'}</h3><p>{task.plan?.visualContinuity || task.brief?.visualContinuity || ''}</p></div><div className="storyboard-progress"><b>{readyCount}/{pages.length}</b><span>张已完成</span></div></div>
    <div className="storyboard-grid">{pages.map((page, index) => {
      const imageId = task.currentImageIds?.[page.id]
      const image = task.images.find((item) => item.id === imageId)
      const revisions = task.images.filter((item) => item.pageId === page.id).length
      const regenerating = busy === `image-regenerate:${page.id}`
      const editing = editingPage === page.id
      return <article key={page.id} className={`story-page ${page.role === 'cover' ? 'cover' : ''} ${image && sources[image.id] ? 'is-revealed' : ''}`}><div className="story-image">{image && sources[image.id] ? <img src={sources[image.id]} alt={`${page.label}：${page.title}`} /> : <div className="story-image-empty"><ImageIcon size={25} /><span>尚未生成</span></div>}<span className="story-index">{String(index + 1).padStart(2, '0')}</span><span className="story-role">{page.label}</span>{regenerating && task.mode !== 'real_photo_poster' && <div className="story-image-busy"><LoaderCircle className="spin" size={25} /><b>{progress?.pageId === page.id ? progress.label : `正在更新${page.label}`}</b><span>会先重写提示词，再生成图片</span></div>}</div><div className="story-copy"><div><h3>{page.title}</h3><p>{page.purpose}</p></div><span>版本 {Math.max(1, revisions)}</span></div><div className="story-actions"><button className="text-button" onClick={() => image && exportImage(task.id, image.id)} disabled={!image || !!busy}><Download size={14} />导出</button>{task.mode !== 'real_photo_poster' && <><button className="secondary compact" onClick={() => regenerateImage(task.id, page.id, '')} disabled={!image || !!busy}><RefreshCw size={14} />换一张</button><button className={`secondary compact ${editing ? 'active' : ''}`} onClick={() => setEditingPage(editing ? '' : page.id)} disabled={!image || !!busy}><PenLine size={14} />提修改</button></>}</div>{task.mode !== 'real_photo_poster' && editing && <div className="story-feedback"><label htmlFor={`history-feedback-${page.id}`}>你希望怎么改？</label><textarea id={`history-feedback-${page.id}`} rows={3} value={feedbacks[page.id] || ''} onChange={(event) => setFeedbacks({ ...feedbacks, [page.id]: event.target.value })} placeholder="例如：标题再醒目一点，改成真实行李与手册的俯拍画面" /><button className="primary compact" onClick={async () => { const ok = await regenerateImage(task.id, page.id, feedbacks[page.id] || ''); if (ok) { setEditingPage(''); setFeedbacks({ ...feedbacks, [page.id]: '' }) } }} disabled={!feedbacks[page.id]?.trim() || !!busy}><WandSparkles size={14} />按要求重新生成</button></div>}</article>
    })}</div>
    {draft && <div className="generation-set-caption"><span>{task.strategyId} · 文案 v{task.draftVersion}</span><b>{draft.title}</b></div>}
  </section>
}

function partialJsonString(source: string, key: string) {
  const match = new RegExp(`"${key}"\\s*:\\s*"`).exec(source)
  if (!match) return ''
  let value = ''
  for (let index = match.index + match[0].length; index < source.length; index += 1) {
    const char = source[index]
    if (char === '"') break
    if (char !== '\\') { value += char; continue }
    const next = source[index + 1]
    if (!next) break
    if (next === 'n') value += '\n'
    else if (next === 'r') value += '\r'
    else if (next === 't') value += '\t'
    else if (next === 'u' && source.slice(index + 2, index + 6).length === 4) {
      value += String.fromCharCode(Number.parseInt(source.slice(index + 2, index + 6), 16)); index += 4
    } else value += next
    index += 1
  }
  return value
}

function completedJsonStrings(source: string, key: string) {
  const values: string[] = []
  const pattern = new RegExp(`"${key}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`, 'g')
  for (const match of source.matchAll(pattern)) {
    try { values.push(JSON.parse(`"${match[1]}"`)) } catch { values.push(match[1]) }
  }
  return values
}

function partialJsonStringArray(source: string, key: string) {
  const match = new RegExp(`"${key}"\\s*:\\s*\\[`).exec(source)
  if (!match) return []
  const tail = source.slice(match.index + match[0].length)
  const values: string[] = []
  for (const item of tail.matchAll(/"((?:\\.|[^"\\])*)"/g)) {
    try { values.push(JSON.parse(`"${item[1]}"`)) } catch { values.push(item[1]) }
  }
  return values
}

function ThoughtTrace({ content }: { content: string }) {
  const contentRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const viewport = contentRef.current
    if (viewport) viewport.scrollTop = viewport.scrollHeight
  }, [content])

  if (!content.trim()) return <div className="thought-wait"><Brain size={15} /><span>正在等待思考轨迹…</span></div>
  return <details className="thought-trace" open><summary><Brain size={15} />思考过程<span>仅显示模型返回的思考文本</span></summary><div ref={contentRef}>{content}</div></details>
}

function GenerationActivity({ stream, busy, project, thinkingEnabled }: { stream: { operation: string; content: string; thinking: string; done: boolean }; busy: string; project: ProjectData; thinkingEnabled: boolean }) {
  const activityLogRef = useRef<HTMLOListElement>(null)
  const matches = busy === 'facts' ? stream.operation === 'facts' : busy === 'strategies' ? stream.operation === 'strategies' : stream.operation.startsWith('draft:')
  const content = matches ? stream.content : ''
  const thinking = matches ? stream.thinking : ''
  const isThinking = thinkingEnabled && !content.trim() && !stream.done

  useEffect(() => {
    const viewport = activityLogRef.current
    if (viewport) viewport.scrollTop = viewport.scrollHeight
  }, [content])

  if (busy === 'draft' || busy === 'revise') {
    const [, strategyId = '', progress = '1/1'] = stream.operation.split(':')
    const strategy = project.strategies.find((item) => item.id === strategyId)
    const title = partialJsonString(content, 'title')
    const body = partialJsonString(content, 'body')
    const tags = partialJsonStringArray(content, 'hashtags')
    return <section className="live-document" aria-live="polite"><div className="activity-head"><span><LoaderCircle className="spin" size={16} /></span><div><b>{isThinking ? '正在思考' : busy === 'revise' ? '正在生成修订稿' : `正在生成文案 ${progress}`}</b><small>{isThinking ? strategy?.name ? `正在推演「${strategy.name}」的写作路径` : '正在理解要求并规划内容' : strategy?.name || '正在组织标题和正文'}</small></div></div><article className="live-paper"><h3>{title || (isThinking ? '思考完成后开始生成标题' : '标题正在成形…')}</h3><div>{body ? body.split('\n').map((line, index) => <p key={index}>{line || '\u00a0'}</p>) : <p className="typing-placeholder">{isThinking ? '模型正在梳理信息和表达顺序…' : '正文会在这里逐段出现…'}</p>}</div>{tags.length > 0 && <footer>{tags.map((tag) => <span key={tag}>#{tag}</span>)}</footer>}</article>{thinkingEnabled && <ThoughtTrace content={thinking} />}</section>
  }
  const labels = busy === 'facts' ? completedJsonStrings(content, 'category') : completedJsonStrings(content, 'name')
  const conflicts = busy === 'facts' ? completedJsonStrings(content, 'topic') : []
  const noun = busy === 'facts' ? '组事实' : '条策略'
  const base = busy === 'facts' ? '正在阅读素材并识别口径…' : '正在对照事实与项目素材…'
  const hasPromotionalSection = busy === 'facts' && /"promotionalExpressions"\s*:/.test(content)
  const hasConflictSection = busy === 'facts' && /"conflicts"\s*:/.test(content)
  const outputComplete = stream.done || /\]\s*}\s*$/.test(content.trim())
  const activeText = isThinking
    ? '正在思考…'
    : outputComplete
      ? '正在整理生成结果…'
      : busy === 'facts' && hasConflictSection
        ? `正在生成第 ${conflicts.length + 1} 处口径冲突…`
        : busy === 'facts' && hasPromotionalSection
          ? '正在核对宣传性表达…'
          : labels.length
            ? `正在生成第 ${labels.length + 1} ${noun}…`
            : busy === 'facts' ? '正在整理第 1 组事实…' : '正在生成第 1 条策略…'
  return <section className="generation-activity" aria-live="polite"><div className="activity-head"><span><LoaderCircle className="spin" size={16} /></span><div><b>{isThinking ? '正在思考' : busy === 'facts' ? '正在核对业务事实' : '正在生成内容策略'}</b><small>{isThinking ? '正在理解输入并规划输出结构' : `已完成 ${labels.length} ${noun}${conflicts.length ? `，识别 ${conflicts.length} 处冲突` : ''}`}</small></div></div><ol className="activity-log" ref={activityLogRef}>{!isThinking && <li className="done"><Check size={13} /><span>{base.replace('正在', '已').replace('…', '')}</span></li>}{labels.map((label, index) => <li className="done" key={`${label}-${index}`}><Check size={13} /><span>{busy === 'facts' ? `已整理第 ${index + 1} 组：${label}` : `已形成第 ${index + 1} 条：${label}`}</span></li>)}{conflicts.map((label, index) => <li className="done" key={`conflict-${label}-${index}`}><Check size={13} /><span>已识别第 {index + 1} 处口径冲突：{label}</span></li>)}<li className="active"><LoaderCircle className="spin" size={13} /><span>{activeText}</span></li></ol>{thinkingEnabled && <ThoughtTrace content={thinking} />}</section>
}

function FinalCover({ item }: { item: FinalContent }) {
  const [source, setSource] = useState('')
  useEffect(() => {
    let active = true
    const path = item.imagePaths[0]
    if (!path) { setSource(''); return () => { active = false } }
    window.workshop.readGeneratedImage(path).then((result) => { if (active) setSource(result.ok ? result.imageUrl || '' : '') })
    return () => { active = false }
  }, [item.id, item.imagePaths[0]])
  return <div className="final-cover">{source ? <img src={source} alt={item.title} /> : <><FileText size={24} /><span>文字终稿</span></>}</div>
}

function FinalLibraryPage({ project, chooseFolder, remove }: { project: ProjectData | null; chooseFolder: () => void; remove: (id: string) => void }) {
  const [mode, setMode] = useState<ContentMode>('native')
  const items = project?.finalContents.filter((item) => item.status === 'archived' && item.mode === mode).slice().reverse() || []
  const explicitCount = project?.finalContents.filter((item) => item.status === 'archived' && item.mode === 'explicit').length || 0
  const nativeCount = project?.finalContents.filter((item) => item.status === 'archived' && item.mode === 'native').length || 0
  return <div className="page-content final-library-page">
    <PageHeader title="终稿内容库">保存已经确认入库的文字和图片；显式宣传与生活化种草分开积累、分开避重。</PageHeader>
    {!project ? <section className="empty-project surface-card"><span className="large-icon"><FolderOpen size={28} /></span><h2>先选择一个项目</h2><p>终稿内容库属于项目资产，选择项目后才能查看。</p><button className="primary" onClick={chooseFolder}><FolderOpen size={17} />选择项目文件夹</button></section> : <section className="final-library surface-card">
      <div className="final-mode-tabs"><button className={mode === 'native' ? 'active' : ''} onClick={() => setMode('native')}>生活化种草（隐式）<span>{nativeCount}</span></button><button className={mode === 'explicit' ? 'active' : ''} onClick={() => setMode('explicit')}>显式宣传<span>{explicitCount}</span></button></div>
      {items.length ? <div className="final-grid">{items.map((item) => <article className="final-card" key={item.id}><FinalCover item={item} /><div className="final-card-copy"><span>{item.id} · {formatTime(item.archivedAt)}</span><h2>{item.title}</h2><p>{String(item.strategySnapshot.coreQuestion || item.body).slice(0, 110)}</p><div className="final-card-meta"><span>{item.strategySnapshot.targetAudience ? `写给：${item.strategySnapshot.targetAudience}` : '未标注人群'}</span><span>{item.imagePaths.length ? `${item.imagePaths.length} 张配图` : '无配图'}</span></div><div className="final-tags">{item.hashtags.slice(0, 5).map((tag) => <span key={tag}>#{tag}</span>)}</div><details><summary>查看终稿</summary><h3>{item.title}</h3>{item.body.split('\n').map((line, index) => <p key={index}>{line || '\u00a0'}</p>)}</details><button className="text-button danger-text" onClick={() => remove(item.id)}><Trash2 size={14} />移出终稿库</button></div></article>)}</div> : <div className="final-empty"><Archive size={28} /><h2>这个分区还没有终稿</h2><p>在文案生成流程最后点击“确认入库”，内容会出现在这里并参与后续同模式避重。</p></div>}
    </section>}
  </div>
}

function MaterialUploadModal({ files, selectFiles, addDroppedFiles, removeFile, clearFiles, start, close, busy }: {
  files: MaterialUploadFile[]; selectFiles: () => void; addDroppedFiles: (files: File[]) => void; removeFile: (filePath: string) => void;
  clearFiles: () => void; start: () => void; close: () => void; busy: string;
}) {
  const [dragging, setDragging] = useState(false)
  const totalBytes = files.reduce((total, file) => total + file.size, 0)
  return <div className="modal-backdrop material-upload-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) close() }}>
    <section className="material-upload-modal" role="dialog" aria-modal="true" aria-labelledby="material-upload-title">
      <header className="material-upload-head"><div><span className="material-upload-mark"><WandSparkles size={19} /></span><div><h2 id="material-upload-title">AI 提取原始素材</h2><p>添加 PDF 或图片，确认后一次发送给视觉模型。</p></div></div><button className="icon-button" onClick={close} aria-label="关闭 AI 提取弹窗"><X size={18} /></button></header>
      <div className="material-upload-body">
        <div className={`material-modal-dropzone ${dragging ? 'dragging' : ''}`} role="button" tabIndex={0} onClick={selectFiles} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selectFiles() } }} onDragEnter={(event) => { event.preventDefault(); setDragging(true) }} onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; setDragging(true) }} onDragLeave={(event) => { const next = event.relatedTarget; if (!(next instanceof Node) || !event.currentTarget.contains(next)) setDragging(false) }} onDrop={(event) => { event.preventDefault(); setDragging(false); addDroppedFiles(Array.from(event.dataTransfer.files)) }}>
          <span className="material-modal-drop-icon"><Upload size={25} /></span><div><b>拖拽文件到这里</b><p>或点击此区域选择文件</p><small>支持 PDF、PNG、JPG、WEBP、GIF · 最多 20 个 · 合计不超过 50MB</small></div><span className="material-modal-browse">选择文件</span>
        </div>
        {files.length > 0 && <section className="material-file-section"><div className="material-file-section-head"><div><b>已添加 {files.length} 个文件</b><span>{formatFileSize(totalBytes)} / 50MB</span></div><button className="text-button" onClick={clearFiles}>清空</button></div><div className="material-file-cards">{files.map((file) => {
          const isPdf = file.name.toLowerCase().endsWith('.pdf')
          return <article className="material-file-card" key={file.path}><span className={`material-file-type ${isPdf ? 'pdf' : 'image'}`}>{isPdf ? <FileText size={18} /> : <ImageIcon size={18} />}</span><div><b title={file.name}>{file.name}</b><span>{isPdf ? 'PDF 文档' : '图片'} · {formatFileSize(file.size)}</span></div><button className="material-file-remove" onClick={() => removeFile(file.path)} aria-label={`删除 ${file.name}`} title="删除文件"><X size={14} /></button></article>
        })}</div></section>}
      </div>
      <footer className="material-upload-actions"><span>{files.length ? 'AI 将按添加顺序读取并合并为一份 Markdown' : '添加文件后即可开始提取'}</span><div><button className="secondary" onClick={close}>取消</button><button className="primary" onClick={start} disabled={!files.length || !!busy}>{busy === 'material-ai' ? <LoaderCircle className="spin" size={16} /> : <WandSparkles size={16} />}开始提取{files.length ? `（${files.length}）` : ''}</button></div></footer>
    </section>
  </div>
}

function OcrStreamPreview({ content, fileCount }: { content: string; fileCount: number }) {
  const [elapsed, setElapsed] = useState(0)
  const renderedContent = useDeferredValue(content)
  useEffect(() => {
    const startedAt = Date.now()
    const timer = window.setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 1000)
    return () => window.clearInterval(timer)
  }, [])
  let markdown = renderedContent.trimStart()
  if (markdown.startsWith('```') && !markdown.includes('\n')) markdown = ''
  else markdown = markdown.replace(/^```(?:markdown|md)?\s*\n/i, '').replace(/\n```\s*$/i, '')
  const duration = elapsed < 60 ? `${elapsed} 秒` : `${Math.floor(elapsed / 60)} 分 ${elapsed % 60} 秒`
  return <aside className="ocr-stream-panel" aria-label="OCR 实时提取结果">
    <header><span className="ocr-stream-icon"><LoaderCircle className="spin" size={18} /></span><div><b>{content ? '正在生成业务原始素材' : `正在读取 ${fileCount} 个文件`}</b><span aria-live="polite">{content ? `已接收 ${content.length.toLocaleString()} 个字符 · ${duration}` : `等待模型返回首段内容 · ${duration}`}</span></div><span className="ocr-live-badge"><i />实时输出</span></header>
    <div className="ocr-stream-meter"><i /></div>
    <div className="ocr-reading-view">{markdown ? <Suspense fallback={<div className="ocr-waiting"><LoaderCircle className="spin" size={22} /><b>正在准备阅读视图</b></div>}><MarkdownReadingView markdown={markdown} /></Suspense> : <div className="ocr-waiting"><Sparkles size={24} /><b>模型正在理解 PDF 和图片</b><span>收到首段内容后，将在这里按 Markdown 阅读模式实时排版。</span></div>}</div>
  </aside>
}

function AssetsPage({ project, chooseFolder, importMaterial, materialFiles, selectMaterialFiles, addDroppedMaterialFiles, removeMaterialFile, clearMaterialFiles, extractMaterial, exportMaterial, downloadAssetTemplate, importAssetBatch, exportAsset, busy, referenceProgress, realPhotoProgress, tab, setTab, openAsset, deleteAsset, toggleAsset, uploadImageReferences, importImageReferencePackage, exportImageReferencePackage, retagImageReference, setImageReferenceRole, toggleImageReference, deleteImageReference, uploadRealPhotos, importRealPhotoPackage, exportRealPhotoPackage, retagRealPhoto, toggleRealPhoto, deleteRealPhoto, goGenerate }: {
  project: ProjectData | null; chooseFolder: () => void; importMaterial: () => void; materialFiles: MaterialUploadFile[];
  selectMaterialFiles: () => void; addDroppedMaterialFiles: (files: File[]) => void; removeMaterialFile: (filePath: string) => void; clearMaterialFiles: () => void;
  extractMaterial: () => void; exportMaterial: () => void;
  downloadAssetTemplate: (kind: BatchAssetKind) => void; importAssetBatch: (kind: BatchAssetKind) => void; exportAsset: (kind: AssetKind) => void;
  busy: string; referenceProgress: ImageReferenceProgressEvent | null; realPhotoProgress: RealPhotoProgressEvent | null; tab: AssetLibraryTab; setTab: (tab: AssetLibraryTab) => void;
  openAsset: (kind: AssetKind, item?: Keyword | Rule | Reference) => void;
  deleteAsset: (kind: AssetKind, id: string) => void; toggleAsset: (kind: AssetKind, id: string, enabled: boolean) => Promise<boolean>; goGenerate: () => void;
  uploadImageReferences: (isCover: boolean) => void; retagImageReference: (id: string) => void;
  importImageReferencePackage: () => void; exportImageReferencePackage: () => void;
  setImageReferenceRole: (id: string, isCover: boolean) => void; toggleImageReference: (id: string, enabled: boolean) => void; deleteImageReference: (id: string) => void;
  uploadRealPhotos: () => void; importRealPhotoPackage: () => void; exportRealPhotoPackage: () => void;
  retagRealPhoto: (id: string) => void; toggleRealPhoto: (id: string, enabled: boolean) => void; deleteRealPhoto: (id: string) => void;
}) {
  const [draggingMaterial, setDraggingMaterial] = useState(false)
  const labels: Record<AssetLibraryTab, string> = { keywords: '关键词', references: '参考文案', rules: '合规准则', imageReferences: '小红书图片', realPhotos: '业务实拍' }
  const counts: Record<AssetLibraryTab, [number, number]> = {
    keywords: [project?.keywords.filter((item) => item.enabled).length || 0, project?.keywords.length || 0],
    references: [project?.references.filter((item) => item.enabled).length || 0, project?.references.length || 0],
    rules: [project?.rules.filter((item) => item.enabled).length || 0, project?.rules.length || 0],
    imageReferences: [project?.imageReferences.filter((item) => item.enabled && item.taggingStatus === 'ready').length || 0, project?.imageReferences.length || 0],
    realPhotos: [project?.realPhotos.filter((item) => item.enabled && item.taggingStatus === 'ready').length || 0, project?.realPhotos.length || 0],
  }
  const standardTab = tab === 'imageReferences' || tab === 'realPhotos' ? null : tab
  const items = project && standardTab ? project[standardTab] : []
  const materialBytes = materialFiles.reduce((total, file) => total + file.size, 0)
  return <div className="page-content"><PageHeader title="素材管理" action={project && <button className="primary" onClick={goGenerate}><WandSparkles size={17} />前往文案生成</button>}>维护业务事实来源、文案参考和图片素材；生成时只读取当前生效的素材。</PageHeader>{!project ? <ProjectEmpty recent={[]} openRecent={() => undefined} chooseFolder={chooseFolder} /> : <><section className={`material-card surface-card ${project.material.exists ? 'ready' : ''}`}><div className="material-summary"><span className="large-icon"><FileText size={25} /></span><div><span>业务原始素材</span><h2>{project.material.exists ? '业务原始素材.md' : '尚未添加业务原始素材'}</h2><p>{project.material.exists ? `${project.material.content.length.toLocaleString()} 个字符 · 更新后可重新提取业务事实` : '可直接导入 Markdown，或用 AI 从 PDF / 图片提取'}</p></div><div className="material-actions"><button className="secondary compact" onClick={exportMaterial} disabled={!project.material.exists || !!busy}>{busy === 'export-material' ? <LoaderCircle className="spin" size={16} /> : <Download size={16} />}导出</button><button className="secondary compact" onClick={importMaterial} disabled={!!busy}>{busy === 'material' ? <LoaderCircle className="spin" size={16} /> : <FileText size={16} />}{project.material.exists ? '替换 Markdown' : '导入 Markdown'}</button></div></div><div className={`material-dropzone ${draggingMaterial ? 'dragging' : ''}`} onDragEnter={(event) => { event.preventDefault(); setDraggingMaterial(true) }} onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; setDraggingMaterial(true) }} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDraggingMaterial(false) }} onDrop={(event) => { event.preventDefault(); setDraggingMaterial(false); addDroppedMaterialFiles(Array.from(event.dataTransfer.files)) }}><span className="material-drop-icon"><Upload size={20} /></span><div><b>拖拽 PDF 或图片到这里</b><span>可以一个个添加，也可以一次多选；全部添加后再调用 AI</span></div><button className="secondary compact" onClick={selectMaterialFiles} disabled={!!busy}><Plus size={15} />选择文件</button></div>{materialFiles.length > 0 && <div className="material-queue"><div className="material-queue-head"><div><b>待提取文件</b><span>{materialFiles.length}/20 个 · {formatFileSize(materialBytes)}/50MB</span></div><button className="text-button" onClick={clearMaterialFiles} disabled={!!busy}>清空列表</button></div><ol>{materialFiles.map((file, index) => <li key={file.path}><span className="material-file-index">{index + 1}</span><FileText size={16} /><div><b>{file.name}</b><span>{formatFileSize(file.size)}</span></div><button className="text-button" title={`移除 ${file.name}`} aria-label={`移除 ${file.name}`} onClick={() => removeMaterialFile(file.path)} disabled={!!busy}><X size={15} /></button></li>)}</ol><div className="material-queue-actions"><span>AI 将按列表顺序读取，并合并生成一份业务原始素材</span><button className="primary" onClick={extractMaterial} disabled={!!busy}>{busy === 'material-ai' ? <LoaderCircle className="spin" size={16} /> : <WandSparkles size={16} />}{busy === 'material-ai' ? '正在提取' : `开始提取（${materialFiles.length} 个）`}</button></div></div>}</section><section className="asset-library surface-card"><div className="asset-tabs">{(Object.keys(labels) as AssetLibraryTab[]).map((key) => <button key={key} className={tab === key ? 'active' : ''} onClick={() => setTab(key)}>{labels[key]}<span>{counts[key][0]}/{counts[key][1]}</span></button>)}</div>{tab === 'imageReferences' ? <ImageReferenceLibrary items={project.imageReferences} busy={busy} progress={referenceProgress} upload={uploadImageReferences} importPackage={importImageReferencePackage} exportPackage={exportImageReferencePackage} retag={retagImageReference} setRole={setImageReferenceRole} toggle={toggleImageReference} remove={deleteImageReference} /> : tab === 'realPhotos' ? <RealPhotoLibrary items={project.realPhotos} busy={busy} progress={realPhotoProgress} upload={uploadRealPhotos} importPackage={importRealPhotoPackage} exportPackage={exportRealPhotoPackage} retag={retagRealPhoto} toggle={toggleRealPhoto} remove={deleteRealPhoto} /> : <><div className="asset-toolbar"><div><h2>{labels[tab]}</h2><p>支持手动维护、Excel 批量导入与完整导出。关闭“生效”后，该行不会拼接进模型提示词。</p></div><div className="asset-toolbar-actions"><button className="secondary compact" onClick={() => exportAsset(tab)} disabled={!!busy}>{busy === `export-${tab}` ? <LoaderCircle className="spin" size={16} /> : <Download size={16} />}导出</button><button className="secondary compact" onClick={() => downloadAssetTemplate(tab)} disabled={!!busy}>{busy === `template-${tab}` ? <LoaderCircle className="spin" size={16} /> : <LayoutTemplate size={16} />}下载模板</button><button className="secondary compact" onClick={() => importAssetBatch(tab)} disabled={!!busy}>{busy === `import-${tab}` ? <LoaderCircle className="spin" size={16} /> : <Upload size={16} />}批量导入</button><button className="primary compact" onClick={() => openAsset(tab)} disabled={!!busy}><Plus size={16} />新增{tab === 'rules' ? '准则' : labels[tab]}</button></div></div>{items.length === 0 ? <div className="compact-empty tall"><Archive size={25} /><b>还没有{labels[tab]}</b><span>可新增单条记录，也可下载模板后批量导入。</span></div> : <AssetTable kind={tab} items={items} openAsset={openAsset} deleteAsset={deleteAsset} toggleAsset={toggleAsset} />}</>}</section></>}</div>
}

function RealPhotoLibrary({ items, busy, progress, upload, importPackage, exportPackage, retag, toggle, remove }: { items: RealPhoto[]; busy: string; progress: RealPhotoProgressEvent | null; upload: () => void; importPackage: () => void; exportPackage: () => void; retag: (id: string) => void; toggle: (id: string, enabled: boolean) => void; remove: (id: string) => void }) {
  const [sources, setSources] = useState<Record<string, string>>({})
  useEffect(() => {
    let active = true
    Promise.all(items.map(async (item) => { const result = await window.workshop.readGeneratedImage(item.relativePath); return [item.id, result.ok ? result.imageUrl || '' : ''] as const }))
      .then((entries) => { if (active) setSources(Object.fromEntries(entries)) })
    return () => { active = false }
  }, [items])
  const importing = busy === 'upload-real-photos' && progress && progress.phase !== 'done'
  return <><div className="asset-toolbar real-photo-toolbar"><div><h2>业务实拍图片库</h2><p>系统会结合业务原始素材生成图片描述和分类标签；也可通过素材包迁移原图和完整标签。</p></div><div className="asset-toolbar-actions"><button className="secondary compact" onClick={exportPackage} disabled={!!busy || !items.length}>{busy === 'export-real-photo-package' ? <LoaderCircle className="spin" size={16} /> : <Download size={16} />}导出素材包</button><button className="secondary compact" onClick={importPackage} disabled={!!busy}>{busy === 'import-real-photo-package' ? <LoaderCircle className="spin" size={16} /> : <PackageOpen size={16} />}批量导入</button><button className="primary compact" onClick={upload} disabled={!!busy}>{busy === 'upload-real-photos' ? <LoaderCircle className="spin" size={16} /> : <Upload size={16} />}上传业务实拍</button></div></div>{importing && <div className="reference-import-progress real-photo-import-progress" aria-live="polite"><span className="reference-import-pulse"><Sparkles size={17} /></span><div><b>{progress.label}</b><small>图片已进入实拍库，分析结果会逐张补全</small></div><strong>{progress.current}/{progress.total}</strong><div className="generation-meter"><i style={{ width: `${progress.total ? (progress.current / progress.total) * 100 : 0}%` }} /></div></div>}{items.length === 0 ? <div className="image-reference-empty"><div className="reference-empty-frame real"><ImageIcon size={32} /></div><div><h3>把真实现场变成宣传图素材</h3><p>一次可上传多张照片，也可以导入素材包直接复用已完成的图片分析标签。</p></div></div> : <div className="real-photo-grid">{items.map((item) => <article key={item.id} className={`real-photo-card ${item.enabled ? '' : 'disabled'} ${item.taggingStatus}`}><div className="real-photo-preview">{sources[item.id] ? <img src={sources[item.id]} alt={item.tags.originalDescription || item.originalName} /> : <LoaderCircle className="spin" size={20} />}<code>{item.id}</code><span>{item.width} × {item.height}</span></div><div className="real-photo-copy"><div className="reference-card-head"><div><h3>{item.tags.originalDescription || item.originalName}</h3><span>{item.tags.businessRelation || '等待判断与业务素材的关系'}</span></div><label className="switch"><input type="checkbox" checked={item.enabled} onChange={(event) => toggle(item.id, event.target.checked)} disabled={!!busy} /><span /></label></div>{item.taggingStatus === 'ready' ? <><div className="real-tag-row">{[...item.tags.themeTags, ...item.tags.sceneTags].slice(0, 6).map((tag) => <span key={tag}>{tag}</span>)}</div><p>{[...item.tags.subjectTags, ...item.tags.actionTags].slice(0, 6).join(' · ')}</p><small>{item.tags.visualTags.shotScale || '未判断景别'} · {item.tags.visualTags.quality === 'high' ? '画质较好' : item.tags.visualTags.quality === 'low' ? '画质偏低' : '画质一般'} · 留字区 {item.tags.visualTags.textSafeArea}</small></> : item.taggingStatus === 'failed' ? <div className="reference-tag-error"><b>图片分析失败</b><span>{item.taggingError}</span></div> : <div className="reference-tagging"><LoaderCircle className="spin" size={15} /><span>正在结合业务素材分析</span></div>}<div className="reference-card-actions"><button className="text-button" onClick={() => retag(item.id)} disabled={!!busy}><Sparkles size={14} />重新分析</button><button className="icon-button danger" onClick={() => remove(item.id)} disabled={!!busy}><Trash2 size={14} /></button></div></div></article>)}</div>}</>
}

function ImageReferenceLibrary({ items, busy, progress, upload, importPackage, exportPackage, retag, setRole, toggle, remove }: { items: ImageReference[]; busy: string; progress: ImageReferenceProgressEvent | null; upload: (isCover: boolean) => void; importPackage: () => void; exportPackage: () => void; retag: (id: string) => void; setRole: (id: string, isCover: boolean) => void; toggle: (id: string, enabled: boolean) => void; remove: (id: string) => void }) {
  const [sources, setSources] = useState<Record<string, string>>({})
  useEffect(() => {
    let active = true
    Promise.all(items.map(async (item) => {
      const result = await window.workshop.readGeneratedImage(item.relativePath)
      return [item.id, result.ok ? result.imageUrl || '' : ''] as const
    })).then((entries) => { if (active) setSources(Object.fromEntries(entries)) })
    return () => { active = false }
  }, [items])
  const importing = busy.startsWith('upload-image-reference-') && progress && progress.phase !== 'done'
  return <><div className="asset-toolbar image-reference-toolbar"><div><h2>小红书图片参考库</h2><p>上传优秀配图自动打标，或通过素材包分享图片和完整标签；导入素材包无需重复调用视觉模型。</p></div><div className="asset-toolbar-actions"><button className="secondary compact" onClick={exportPackage} disabled={!!busy || !items.length}>{busy === 'export-image-reference-package' ? <LoaderCircle className="spin" size={16} /> : <Download size={16} />}导出素材包</button><button className="secondary compact" onClick={importPackage} disabled={!!busy}>{busy === 'import-image-reference-package' ? <LoaderCircle className="spin" size={16} /> : <PackageOpen size={16} />}批量导入</button><button className="secondary compact" onClick={() => upload(false)} disabled={!!busy}>{busy === 'upload-image-reference-content' ? <LoaderCircle className="spin" size={16} /> : <ImagePlus size={16} />}上传内容页</button><button className="primary compact" onClick={() => upload(true)} disabled={!!busy}>{busy === 'upload-image-reference-cover' ? <LoaderCircle className="spin" size={16} /> : <Upload size={16} />}上传封面</button></div></div>{importing && <div className="reference-import-progress" aria-live="polite"><span className="reference-import-pulse"><Sparkles size={17} /></span><div><b>{progress.label}</b><small>图片已进入素材库，分析结果会逐张补全</small></div><strong>{progress.current}/{progress.total}</strong><div className="generation-meter"><i style={{ width: `${progress.total ? (progress.current / progress.total) * 100 : 0}%` }} /></div></div>}{items.length === 0 ? <div className="image-reference-empty"><div className="reference-empty-frame"><ImageIcon size={32} /></div><div><h3>用好样本教会模型什么是“像小红书”</h3><p>建议先上传 3–6 张封面和 3–6 张内容页。也可以导入别人分享的素材包，直接复用已经完成的视觉标签。</p></div></div> : <div className="image-reference-grid">{items.map((item) => {
    const activeBusy = busy.endsWith(item.id)
    return <article key={item.id} className={`image-reference-card ${item.enabled ? '' : 'disabled'} ${item.taggingStatus}`}><div className="reference-preview">{sources[item.id] ? <img src={sources[item.id]} alt={item.tags.summary || item.originalName} /> : <span><LoaderCircle className="spin" size={20} /></span>}<b>{item.isCover ? '封面样本' : '内容页样本'}</b><code>{item.id}</code></div><div className="reference-card-copy"><div className="reference-card-head"><div><h3>{item.tags.summary || item.originalName}</h3><span>{item.width} × {item.height}</span></div><label className="switch" title={item.enabled ? '点击停用' : '点击生效'}><input type="checkbox" checked={item.enabled} onChange={(event) => toggle(item.id, event.target.checked)} disabled={!!busy} /><span /></label></div>{item.taggingStatus === 'ready' ? <><p>{[item.tags.visualStyle, item.tags.composition, item.tags.textLayout].filter(Boolean).join(' · ')}</p><div className="reference-use-cases"><span>{item.tags.visualMedium === 'photo' ? '摄影实景' : item.tags.visualMedium === 'mixed' ? '实景＋设计' : '图形设计'}</span>{item.tags.useCases.slice(0, 3).map((value) => <span key={value}>{value}</span>)}</div><div className="reference-keywords">{item.tags.keywords.slice(0, 5).map((value) => <small key={value}>#{value}</small>)}</div></> : item.taggingStatus === 'failed' ? <div className="reference-tag-error"><b>自动打标失败</b><span>{item.taggingError}</span></div> : <div className="reference-tagging"><LoaderCircle className="spin" size={15} /><span>正在分析视觉结构</span></div>}<div className="reference-card-actions"><button className="text-button" onClick={() => setRole(item.id, !item.isCover)} disabled={!!busy}>{activeBusy ? <LoaderCircle className="spin" size={14} /> : <RefreshCw size={14} />}改为{item.isCover ? '内容页' : '封面'}</button><button className="text-button" onClick={() => retag(item.id)} disabled={!!busy}><Sparkles size={14} />重新打标</button><button className="icon-button danger" onClick={() => remove(item.id)} disabled={!!busy} title="删除参考图片"><Trash2 size={14} /></button></div></div></article>
  })}</div>}</>
}

const assetTableHeaders: Record<AssetKind, string[]> = {
  keywords: ['编号', '分类', '核心关键词/词根', '词性标签', '痛点/意图标签', '建议用法(槽位)', '操作'],
  rules: ['编号', '禁用词/敏感表述', '风险类型', '判定依据', '处理方式', '替代写法', '操作'],
  references: ['编号', '标题', '正文', '话题标签', '操作'],
}

function displayCell(value?: string) { return value?.trim() || '—' }

function AssetTable({ kind, items, openAsset, deleteAsset, toggleAsset }: {
  kind: AssetKind; items: (Keyword | Rule | Reference)[];
  openAsset: (kind: AssetKind, item: Keyword | Rule | Reference) => void;
  deleteAsset: (kind: AssetKind, id: string) => void;
  toggleAsset: (kind: AssetKind, id: string, enabled: boolean) => Promise<boolean>;
}) {
  return <div className="asset-table-scroll"><table className={`asset-data-table ${kind}`}><thead><tr>{assetTableHeaders[kind].map((header) => <th key={header} scope="col">{header}</th>)}</tr></thead><tbody>{items.map((item) => <tr key={item.id} className={item.enabled ? '' : 'disabled-row'}>{kind === 'keywords' ? <KeywordCells item={item as Keyword} /> : kind === 'rules' ? <RuleCells item={item as Rule} /> : <ReferenceCells item={item as Reference} />}<td className="asset-actions"><div><label className="switch" title={item.enabled ? '点击停用' : '点击生效'}><input type="checkbox" checked={item.enabled} onChange={(event) => toggleAsset(kind, item.id, event.target.checked)} aria-label={`${item.enabled ? '停用' : '启用'} ${item.id}`} /><span /></label><button className="icon-button" title="编辑" aria-label={`编辑 ${item.id}`} onClick={() => openAsset(kind, item)}><PenLine size={15} /></button><button className="icon-button danger" title="删除" aria-label={`删除 ${item.id}`} onClick={() => deleteAsset(kind, item.id)}><Trash2 size={15} /></button></div></td></tr>)}</tbody></table></div>
}

function KeywordCells({ item }: { item: Keyword }) {
  return <><td className="asset-id"><code>{item.id}</code></td><td>{displayCell(item.category)}</td><td className="asset-primary">{displayCell(item.root)}</td><td>{displayCell(item.partOfSpeech)}</td><td>{displayCell(item.intentTag)}</td><td>{displayCell(item.suggestedUse)}</td></>
}

function RuleCells({ item }: { item: Rule }) {
  return <><td className="asset-id"><code>{item.id}</code></td><td className="asset-primary">{displayCell(item.prohibited)}</td><td>{displayCell(item.riskType)}</td><td>{displayCell(item.basis)}</td><td>{displayCell(item.handling)}</td><td>{displayCell(item.replacement)}</td></>
}

function ReferenceCells({ item }: { item: Reference }) {
  return <><td className="asset-id"><code>{item.id}</code></td><td className="asset-primary">{displayCell(item.title)}</td><td className="asset-long-text">{displayCell(item.body)}</td><td>{item.hashtags.length ? item.hashtags.map((tag) => `#${tag}`).join(' ') : '—'}</td></>
}

function SettingsPage({ settings, setSettings, save, busy }: { settings: ModelSettings; setSettings: (settings: ModelSettings) => void; save: () => void; busy: string }) {
  const [showApiKey, setShowApiKey] = useState(false)
  const [showImageApiKey, setShowImageApiKey] = useState(false)

  async function pasteApiKey() {
    const apiKey = (await window.workshop.readClipboardText()).trim()
    if (apiKey) setSettings({ ...settings, apiKey })
  }
  async function pasteImageApiKey() {
    const apiKey = (await window.workshop.readClipboardText()).trim()
    if (apiKey) setSettings({ ...settings, image: { ...settings.image, apiKey } })
  }
  function setImage(value: Partial<ImageModelSettings>) { setSettings({ ...settings, image: { ...settings.image, ...value } }) }
  const imageEndpoint = resolvedImageEndpoint(settings.image)
  const incompatibleOpenAiDomain = settings.image.protocol === 'openai' && usesPublicDashScopeDomain(settings.image.baseUrl)

  return <div className="page-content settings-page"><PageHeader title="设置">分别配置文案、视觉理解和图片生成模型。连接信息保存在本机应用数据中，不会写入项目目录。</PageHeader><div className="settings-stack"><section className="settings-card surface-card"><div className="settings-heading"><span className="large-icon"><KeyRound size={22} /></span><div><h2>文案与视觉理解模型</h2><p>用于文案工作流、PDF / 图片 OCR，以及参考图片检索标签。</p></div><span className={`connection-badge ${settings.apiKey && settings.model ? 'ready' : ''}`}>{settings.apiKey && settings.model ? '已配置' : '待配置'}</span></div><div className="settings-form"><label className="field"><span>接口地址</span><input value={settings.baseUrl} onChange={(e) => setSettings({ ...settings, baseUrl: e.target.value })} placeholder="https://api.openai.com/v1" /></label><div className="field"><label htmlFor="api-key">API Key</label><div className="secret-input"><input id="api-key" type={showApiKey ? 'text' : 'password'} value={settings.apiKey} onChange={(e) => setSettings({ ...settings, apiKey: e.target.value })} placeholder="sk-…" autoComplete="off" /><div className="secret-actions"><button type="button" onClick={() => setShowApiKey((visible) => !visible)} title={showApiKey ? '隐藏 API Key' : '显示 API Key'} aria-label={showApiKey ? '隐藏 API Key' : '显示 API Key'}>{showApiKey ? <EyeOff size={16} /> : <Eye size={16} />}</button><button type="button" onClick={pasteApiKey} title="从剪贴板粘贴 API Key"><ClipboardPaste size={15} /><span>粘贴</span></button></div></div></div><label className="field"><span>文案模型</span><input value={settings.model} onChange={(e) => setSettings({ ...settings, model: e.target.value })} placeholder="例如 qwen-plus" /></label><label className="field"><span>视觉理解 / OCR 模型 <small>需支持图片理解</small></span><input value={settings.visionModel} onChange={(e) => setSettings({ ...settings, visionModel: e.target.value })} placeholder={settings.model || '例如 qwen-vl-max'} /><small className="field-hint">用于 PDF / 图片转 Markdown 和图片打标；PDF 提取还要求当前兼容接口支持文件输入。</small></label></div></section>
    <section className={`settings-card image-settings-card surface-card ${settings.image.enabled ? 'enabled' : ''}`}>
      <div className="settings-heading"><span className="large-icon"><ImageIcon size={22} /></span><div><h2>图片模型</h2><p>只以图生图方式生成小红书 3:4 封面与内容套图，支持阿里云百炼 Qwen Image。</p></div><label className="settings-enable"><span>{settings.image.enabled ? '已启用' : '未启用'}</span><span className="switch"><input type="checkbox" checked={settings.image.enabled} onChange={(event) => setImage({ enabled: event.target.checked })} /><span /></span></label></div>
      {settings.image.enabled && <div className="settings-form">
        <label className="field"><span>接入协议</span><select value={settings.image.protocol} onChange={(e) => setImage({ protocol: e.target.value as 'dashscope' | 'openai' })}><option value="dashscope">DashScope 同步（官方推荐）</option><option value="openai">OpenAI Images 兼容</option></select><small className="field-hint">协议由这里明确指定，不再根据 URL 自动猜测。</small></label>
        <label className="field"><span>接口地址 <small>{settings.image.protocol === 'openai' ? '必须使用 Workspace 专属域名' : '推荐使用 Workspace 专属域名'}</small></span><input value={settings.image.baseUrl} onChange={(e) => setImage({ baseUrl: e.target.value })} placeholder="https://llm-….cn-beijing.maas.aliyuncs.com" /><small className={`field-hint ${incompatibleOpenAiDomain ? 'endpoint-warning' : ''}`}>{incompatibleOpenAiDomain ? '当前公共域名不提供此 OpenAI 图片路由，请改用百炼 Workspace 专属域名，或切回 DashScope 同步。' : '可填写 Workspace 域名、/api/v1 基地址或完整接口；应用会规范化最终路径。'}</small>{imageEndpoint && <code className="endpoint-preview">实际请求：{imageEndpoint}</code>}</label>
        <div className="field"><label htmlFor="image-api-key">API Key</label><div className="secret-input"><input id="image-api-key" type={showImageApiKey ? 'text' : 'password'} value={settings.image.apiKey} onChange={(e) => setImage({ apiKey: e.target.value })} placeholder="sk-…" autoComplete="off" /><div className="secret-actions"><button type="button" onClick={() => setShowImageApiKey((visible) => !visible)} title={showImageApiKey ? '隐藏 API Key' : '显示 API Key'}>{showImageApiKey ? <EyeOff size={16} /> : <Eye size={16} />}</button><button type="button" onClick={pasteImageApiKey} title="从剪贴板粘贴 API Key"><ClipboardPaste size={15} /><span>粘贴</span></button></div></div></div>
        <label className="field"><span>模型名称</span><input value={settings.image.model} onChange={(e) => setImage({ model: e.target.value })} placeholder="qwen-image-3.0-pro" /></label>
        <div className="image-setting-grid"><label className="field"><span>输出尺寸</span><select value={settings.image.size} onChange={(e) => setImage({ size: e.target.value })}><option value="1080x1440">1080 × 1440（推荐）</option><option value="1536x2048">1536 × 2048（高清）</option><option value="1024x1365">1024 × 1365（轻量）</option></select></label><label className="field"><span>提示词增强</span><select value="direct" disabled><option value="direct">Direct 图生图增强</option></select><small className="field-hint">Qwen Image 的 I2I 模式不支持 Agent 增强。</small></label></div>
        <div className="image-option-list"><label><span><b>启用思考模式</b><small>提高复杂版面质量，但生成时间更长</small></span><span className="switch"><input type="checkbox" checked={settings.image.enableThinking} onChange={(event) => setImage({ enableThinking: event.target.checked })} /><span /></span></label><label><span><b>添加模型水印</b><small>默认关闭，便于直接用于内容发布</small></span><span className="switch"><input type="checkbox" checked={settings.image.watermark} onChange={(event) => setImage({ watermark: event.target.checked })} /><span /></span></label></div>
      </div>}
    </section></div><div className="security-note settings-security"><KeyRound size={16} /><span>API Key 仅保存在当前电脑。图片接口、模型和密钥必须属于同一个百炼地域。</span></div><div className="settings-savebar"><button className="primary" onClick={save} disabled={!!busy}>{busy === 'settings' ? <LoaderCircle className="spin" size={17} /> : <Check size={17} />}保存全部设置</button></div></div>
}

function ActionState({ icon, title, description, button }: { icon: React.ReactNode; title: string; description: string; button: React.ReactNode }) {
  return <div className="action-state"><span className="large-icon">{icon}</span><div><h3>{title}</h3><p>{description}</p></div>{button}</div>
}

function Gate({ icon, message, target }: { icon: React.ReactNode; message: string; target: string }) {
  return <div className="gate"><span className="large-icon">{icon}</span><h3>{message}</h3><p>{target}</p></div>
}

function Overlays({ modal, setModal, pendingFolder, initialize, busy, error, setError, assetTab, form, setForm, saveAsset }: { modal: Modal; setModal: (modal: Modal) => void; pendingFolder: string; initialize: () => void; busy: string; error: string; setError: (value: string) => void; assetTab: AssetKind; form: Record<string, string>; setForm: (value: Record<string, string>) => void; saveAsset: () => void }) {
  if (!modal) return null
  const close = () => { setModal(null); setError('') }
  const title = modal === 'project-init' ? '创建本地项目' : assetTab === 'keywords' ? '关键词' : assetTab === 'rules' ? '合规准则' : '参考文案'
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) close() }}><div className="modal" role="dialog" aria-modal="true" aria-label={title}><div className="modal-head"><div><span>{modal === 'project-init' ? '项目初始化' : form.id ? '编辑记录' : '新增记录'}</span><h2>{title}</h2></div><button className="icon-button" onClick={close} aria-label="关闭"><X size={19} /></button></div>{modal === 'project-init' && <><div className="modal-copy"><span className="large-icon"><FolderOpen size={23} /></span><p>系统将在这个文件夹中创建项目配置、素材数据和生成结果：</p><code>{pendingFolder}</code><small>一个项目建议只对应一个业务，后续可以反复生成多篇文案。</small></div><div className="modal-actions"><button className="secondary" onClick={close}>取消</button><button className="primary" onClick={initialize} disabled={!!busy}>{busy === 'initialize' && <LoaderCircle className="spin" size={17} />}确认创建</button></div></>}{(modal === 'keywords' || modal === 'rules' || modal === 'references') && <><div className="form-stack">{form.id && <div className="immutable-id"><span>系统编号</span><code>{form.id}</code></div>}{modal === 'keywords' && <><div className="form-grid"><label className="field"><span>分类 <small>可选</small></span><input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} /></label><label className="field"><span>核心关键词/词根</span><input autoFocus value={form.root} onChange={(e) => setForm({ ...form, root: e.target.value })} /></label><label className="field"><span>词性标签 <small>可选</small></span><input value={form.partOfSpeech} onChange={(e) => setForm({ ...form, partOfSpeech: e.target.value })} /></label><label className="field"><span>痛点/意图标签 <small>可选</small></span><input value={form.intentTag} onChange={(e) => setForm({ ...form, intentTag: e.target.value })} /></label></div><label className="field"><span>建议用法(槽位) <small>可选</small></span><textarea rows={3} value={form.suggestedUse} onChange={(e) => setForm({ ...form, suggestedUse: e.target.value })} /></label></>}{modal === 'rules' && <><label className="field"><span>禁用词/敏感表述</span><textarea autoFocus rows={3} value={form.prohibited} onChange={(e) => setForm({ ...form, prohibited: e.target.value })} /></label><div className="form-grid"><label className="field"><span>风险类型 <small>可选</small></span><input value={form.riskType} onChange={(e) => setForm({ ...form, riskType: e.target.value })} /></label><label className="field"><span>判定依据 <small>可选</small></span><input value={form.basis} onChange={(e) => setForm({ ...form, basis: e.target.value })} /></label><label className="field"><span>处理方式 <small>可选</small></span><input value={form.handling} onChange={(e) => setForm({ ...form, handling: e.target.value })} /></label><label className="field"><span>替代写法 <small>可选</small></span><input value={form.replacement} onChange={(e) => setForm({ ...form, replacement: e.target.value })} /></label></div></>}{modal === 'references' && <><label className="field"><span>标题</span><input autoFocus value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></label><label className="field"><span>正文</span><textarea rows={8} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} /></label><label className="field"><span>话题标签 <small>可选，用空格、逗号或换行分隔</small></span><textarea rows={3} value={form.hashtags} onChange={(e) => setForm({ ...form, hashtags: e.target.value })} placeholder="#亲子研学 #佛山周末" /></label></>}</div><div className="modal-actions"><button className="secondary" onClick={close}>取消</button><button className="primary" onClick={saveAsset} disabled={!!busy}>{form.id ? '保存修改' : '新增记录'}</button></div></>}{error && <p className="modal-error">{error}</p>}</div></div>
}

function Toast({ error, notice, clear }: { error: string; notice: string; clear: () => void }) {
  if (!error && !notice) return null
  return <button className={`toast ${error ? 'error' : ''}`} onClick={clear}>{error ? <X size={17} /> : <Check size={17} />}<span>{error || notice}</span></button>
}

function formatTime(value: string) { return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) }
function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)}KB`
  return `${(bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)}MB`
}

export default App
