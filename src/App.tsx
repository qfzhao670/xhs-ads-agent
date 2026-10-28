import { useEffect, useMemo, useState } from 'react'
import {
  Archive, BookOpenText, Brain, Check, CheckCircle2, ChevronDown, ChevronRight,
  Circle, Download, FileText, FolderOpen, KeyRound, LayoutTemplate, LoaderCircle,
  PackageOpen, PenLine, Plus, RefreshCw, Save, Scale, Settings, SlidersHorizontal,
  Sparkles, Trash2, Upload, WandSparkles, X,
} from 'lucide-react'

type Page = 'generate' | 'assets' | 'settings'
type Modal = 'project-init' | AssetKind | null

const flowSteps = [
  ['准备素材', '确认本次生成依据'],
  ['核对事实', '提取并消除冲突'],
  ['选择策略', '确定一个或多个方向'],
  ['生成文案', '按策略逐篇产出'],
  ['审核确认', '修改、确认并归档'],
] as const

const emptyForms = {
  keywords: { id: '', category: '', root: '', partOfSpeech: '', intentTag: '', suggestedUse: '' },
  rules: { id: '', prohibited: '', riskType: '', basis: '', handling: '', replacement: '' },
  references: { id: '', title: '', body: '', hashtags: '' },
}

function App() {
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
  const [assetTab, setAssetTab] = useState<AssetKind>('keywords')
  const [form, setForm] = useState<Record<string, string>>(emptyForms.keywords)
  const [settings, setSettings] = useState<ModelSettings>({ baseUrl: '', apiKey: '', model: '' })
  const [resolution, setResolution] = useState('')
  const [choice, setChoice] = useState<string[]>([])
  const [strategyAdvice, setStrategyAdvice] = useState<Record<string, string>>({})
  const [revision, setRevision] = useState('')
  const [viewVersion, setViewVersion] = useState<number | null>(null)
  const [thinkingModes, setThinkingModes] = useState({ facts: true, strategies: false, draft: false, revise: false })
  const [stream, setStream] = useState({ operation: '', content: '', thinking: '', done: false })

  useEffect(() => {
    window.workshop.getRecentProjects().then(setRecent)
    window.workshop.getSettings().then(setSettings)
  }, [])

  useEffect(() => {
    setChoice(project?.selectedStrategyIds || (project?.selectedStrategyId ? [project.selectedStrategyId] : []))
    setStrategyAdvice(project?.strategyAdvice || {})
    setViewVersion(project?.currentDraft?.version || null)
  }, [project?.meta.root, project?.selectedStrategyIds, project?.selectedStrategyId, project?.strategyAdvice, project?.currentDraft?.version])

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

  const completed = useMemo(() => [
    !!project?.material.exists,
    !!project?.facts && project.facts.conflicts.length === 0,
    !!project?.selectedStrategyIds.length,
    !!project?.currentDraft,
    !!project?.selectedStrategyIds.length && project.selectedStrategyIds.every((id) => project.drafts.some((draft) => draft.strategyId === id && draft.confirmed)),
  ], [project])

  function suggestedStep(data: ProjectData) {
    if (data.currentDraft) return 5
    if (data.selectedStrategyIds.length) return 4
    if (data.strategies.length) return 3
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
    if (['facts', 'strategies', 'draft', 'revise'].includes(label)) setStream({ operation: label, content: '', thinking: '', done: false })
    try {
      const result = await action()
      if (!result.ok) { showError(result.error); return false }
      if (result.data) setProject(result.data)
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
  function openAsset(kind: AssetKind, item?: Keyword | Rule | Reference) {
    setAssetTab(kind)
    if (kind === 'references' && item) {
      const reference = item as Reference
      setForm({ id: reference.id, title: reference.title, body: reference.body, hashtags: reference.hashtags.join(' ') })
    } else setForm(item ? { ...item } as unknown as Record<string, string> : { ...emptyForms[kind] })
    setModal(kind)
  }
  async function saveAsset() {
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
  async function deleteAsset(kind: AssetKind, id: string) {
    if (!window.confirm(`确定删除 ${id}？该编号之后不会再分配给新记录。`)) return
    await run('delete', () => window.workshop.deleteAsset(kind, id), '记录已删除')
  }
  async function saveSettings() {
    if (!settings.baseUrl || !settings.apiKey || !settings.model) { setError('请完整填写接口地址、API Key 和模型名称'); return }
    await run('settings', () => window.workshop.saveSettings(settings), '模型设置已保存')
  }
  async function newGeneration() {
    const nextStep = project?.facts && !project.facts.conflicts.length ? 3 : project?.material.exists ? 2 : 1
    const ok = await run('new-generation', () => window.workshop.startNewGeneration(), '已开始新一轮生成')
    if (ok) { setViewGeneration('current'); setFlowStep(nextStep); setChoice([]); setStrategyAdvice({}); setRevision('') }
  }

  const selectedStrategies = project?.strategies.filter((item) => project.selectedStrategyIds.includes(item.id)) || []
  const viewedDraft = project?.drafts.find((item) => item.version === viewVersion) || project?.currentDraft || null
  const archived = project?.generationHistory.find((item) => item.id === viewGeneration)

  return (
    <div className="app-shell">
      <div className="drag-region" />
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark"><Sparkles size={17} /></span><div><b>红薯文案工坊</b><small>本地智能创作台</small></div></div>
        <nav className="main-nav" aria-label="主导航">
          <NavButton active={page === 'generate'} icon={<WandSparkles size={19} />} label="文案生成" hint="流程与生成记录" onClick={() => setPage('generate')} />
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
          viewGeneration={viewGeneration} setViewGeneration={(id) => { setViewGeneration(id); setFlowStep(id === 'current' && project ? suggestedStep(project) : 5) }} archived={archived}
          newGeneration={newGeneration} busy={busy} setPage={setPage}
          stream={stream}
          resolution={resolution} setResolution={setResolution}
          thinkingModes={thinkingModes} setThinkingMode={(key, value) => setThinkingModes((current) => ({ ...current, [key]: value }))}
          generateFacts={async () => { const ok = await run('facts', () => window.workshop.extractFacts(resolution, thinkingModes.facts), resolution ? '业务事实已重新生成' : '业务事实已提取'); if (ok) { setResolution(''); setFlowStep(3) } }}
          generateStrategies={() => run('strategies', () => window.workshop.generateStrategies(thinkingModes.strategies), '策略候选已生成')}
          choice={choice} setChoice={setChoice} strategyAdvice={strategyAdvice} setStrategyAdvice={setStrategyAdvice}
          saveStrategy={async () => { if (!choice.length) return showError('请至少选择一个策略'); const ok = await run('select', () => window.workshop.selectStrategy(choice, strategyAdvice), `已保存 ${choice.length} 个策略`); if (ok) setFlowStep(4) }}
          selectedStrategies={selectedStrategies}
          generateDraft={async () => { const ok = await run('draft', () => window.workshop.generateDraft(thinkingModes.draft), `已生成 ${selectedStrategies.length} 篇文案`); if (ok) setFlowStep(5) }}
          draft={viewedDraft} viewVersion={viewVersion} setViewVersion={setViewVersion}
          revision={revision} setRevision={setRevision}
          revise={async () => { if (!viewVersion) return; const ok = await run('revise', () => window.workshop.reviseDraft(revision, viewVersion, thinkingModes.revise), '修改版本已生成'); if (ok) setRevision('') }}
          saveManual={async (value) => { const ok = await run('manual', () => window.workshop.saveManualDraft(value), '手动修改已保存为新版本'); return ok }}
          confirm={(version) => run('confirm', () => window.workshop.confirmDraft(version), '当前文案已确认')}
        />}
        {page === 'assets' && <AssetsPage project={project} chooseFolder={chooseFolder} importMaterial={importMaterial} downloadAssetTemplate={downloadAssetTemplate} importAssetBatch={importAssetBatch} busy={busy} tab={assetTab} setTab={setAssetTab} openAsset={openAsset} deleteAsset={deleteAsset} toggleAsset={(kind, id, enabled) => run('toggle-asset', () => window.workshop.toggleAsset(kind, id, enabled))} goGenerate={() => { setPage('generate'); setFlowStep(project?.facts ? 3 : 2) }} />}
        {page === 'settings' && <SettingsPage settings={settings} setSettings={setSettings} save={saveSettings} busy={busy} />}
      </main>

      <Overlays {...{ modal, setModal, pendingFolder, initialize, busy, error, setError, assetTab, form, setForm, saveAsset }} />
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
  archived?: GenerationRecord; newGeneration: () => void; busy: string; setPage: (page: Page) => void;
  stream: { operation: string; content: string; thinking: string; done: boolean };
  thinkingModes: Record<'facts' | 'strategies' | 'draft' | 'revise', boolean>;
  setThinkingMode: (key: 'facts' | 'strategies' | 'draft' | 'revise', value: boolean) => void;
  resolution: string; setResolution: (value: string) => void; generateFacts: () => void; generateStrategies: () => void;
  choice: string[]; setChoice: (ids: string[]) => void; strategyAdvice: Record<string, string>; setStrategyAdvice: (value: Record<string, string>) => void; saveStrategy: () => void;
  selectedStrategies: Strategy[]; generateDraft: () => void; draft: Draft | null; viewVersion: number | null; setViewVersion: (version: number) => void;
  revision: string; setRevision: (value: string) => void; revise: () => void;
  saveManual: (draft: { version: number; title: string; body: string; hashtags: string }) => Promise<boolean>;
  confirm: (version: number) => void;
}

function archivedCompleted(record: GenerationRecord) {
  const selectedIds = record.selectedStrategyIds || (record.selectedStrategyId ? [record.selectedStrategyId] : [])
  const hasDraft = record.drafts.length > 0
  const allConfirmed = selectedIds.length > 0 && selectedIds.every((id) => record.drafts.some((draft) => draft.strategyId === id && draft.confirmed))
  return [
    Boolean(record.material?.exists || record.facts || record.strategies.length || hasDraft),
    Boolean((record.facts && !record.facts.conflicts.length) || record.strategies.length || hasDraft),
    selectedIds.length > 0 || hasDraft,
    hasDraft,
    allConfirmed || Boolean(record.drafts.some((draft) => draft.confirmed) && !record.selectedStrategyIds?.length),
  ]
}

function GenerationPage(props: GenerationPageProps) {
  const { project, recent, openRecent, chooseFolder, flowStep, setFlowStep, completed, viewGeneration, setViewGeneration, archived, newGeneration, busy } = props
  const modelBusy = ['facts', 'strategies', 'draft', 'revise'].includes(busy)
  const displayedCompleted = archived ? archivedCompleted(archived) : completed
  const displayedId = archived?.id || project?.currentGeneration.id
  const displayedAt = archived?.createdAt || project?.currentGeneration.createdAt
  return <div className="page-content generate-page">
    <PageHeader title="文案生成" action={project && <button className="secondary" onClick={newGeneration} disabled={busy === 'new-generation'}>{busy === 'new-generation' ? <LoaderCircle className="spin" size={17} /> : <Plus size={17} />}新建生成</button>}>
      按流程完成一篇或多篇文案。同一个项目可以创建多轮生成，素材与历史记录互不丢失。
    </PageHeader>
    {!project ? <ProjectEmpty recent={recent} openRecent={openRecent} chooseFolder={chooseFolder} /> : <>
      <section className="flow-card" aria-label="文案生成流程">
        <div className="flow-context"><div><span>{archived ? '历史回放' : '当前生成'}</span><b>{displayedId}</b></div><small>开始于 {formatTime(displayedAt || '')}</small></div>
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
      <div className="generation-layout">
        <div className="generation-main">
          {modelBusy && <GenerationActivity stream={props.stream} busy={busy} project={project} thinkingEnabled={props.thinkingModes[busy as 'facts' | 'strategies' | 'draft' | 'revise']} />}
          {archived ? <ArchivedGeneration record={archived} step={flowStep} /> : <CurrentFlow {...props} />}
        </div>
        <GenerationHistory project={project} selected={viewGeneration} onSelect={setViewGeneration} />
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
  if (flowStep === 3) return <StrategyStep project={project} busy={props.busy} thinking={props.thinkingModes.strategies} setThinking={(value) => props.setThinkingMode('strategies', value)} generate={props.generateStrategies} choice={props.choice} setChoice={props.setChoice} strategyAdvice={props.strategyAdvice} setStrategyAdvice={props.setStrategyAdvice} save={props.saveStrategy} />
  if (flowStep === 4) return <ComposeStep project={project} strategies={props.selectedStrategies} busy={props.busy} thinking={props.thinkingModes.draft} setThinking={(value) => props.setThinkingMode('draft', value)} generate={props.generateDraft} back={() => props.setFlowStep(3)} />
  return <ReviewStep project={project} draft={props.draft} viewVersion={props.viewVersion} setViewVersion={props.setViewVersion} revision={props.revision} setRevision={props.setRevision} busy={props.busy} thinking={props.thinkingModes.revise} setThinking={(value) => props.setThinkingMode('revise', value)} revise={props.revise} saveManual={props.saveManual} confirm={props.confirm} newGeneration={props.newGeneration} />
}

function StepHeader({ step, title, children, action }: { step: string; title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return <div className="step-header"><div><span>{step}</span><h2>{title}</h2><p>{children}</p></div>{action}</div>
}

function SourceStep({ project, goAssets, next }: { project: ProjectData; goAssets: () => void; next: () => void }) {
  return <section className="flow-panel surface-card">
    <StepHeader step="步骤 1 / 5" title="确认本轮生成依据">素材可以在项目内长期积累；开始前确认原始素材与增强资料是否已就绪。</StepHeader>
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
    <StepHeader step="步骤 2 / 5" title="核对业务事实">模型只提取素材实际包含的内容，并标记互相冲突的口径。</StepHeader>
    {project.material.exists && <ThinkingToggle checked={thinking} onChange={setThinking} recommended disabled={!!busy} />}
    {!project.material.exists ? <Gate icon={<FileText size={25} />} message="缺少原始素材" target="请先前往素材管理导入业务原始素材。" /> : !project.facts ? <ActionState icon={<BookOpenText size={27} />} title="从原始素材提取事实" description="系统会自动归类、去重，并区分可确认事实、宣传表达和口径冲突。" button={<button className="primary" onClick={generate} disabled={!!busy}>{busy === 'facts' ? <LoaderCircle className="spin" size={17} /> : <WandSparkles size={17} />}开始提取</button>} /> : conflicts.length ? <div className="conflict-area"><div className="alert-heading"><Scale size={20} /><div><b>发现 {conflicts.length} 处口径冲突</b><p>确认统一口径后，系统会重新生成完整事实。</p></div></div>{conflicts.map((item, index) => <div className="conflict-row" key={`${item.topic}-${index}`}><span>{item.topic}</span><b>{item.question}</b><ul>{item.versions.map((version) => <li key={version}>{version}</li>)}</ul></div>)}<label className="field"><span>统一口径</span><textarea rows={4} value={resolution} onChange={(e) => setResolution(e.target.value)} placeholder="逐条说明应采用的标准口径" /></label><button className="primary" onClick={generate} disabled={!resolution.trim() || !!busy}>{busy === 'facts' ? <LoaderCircle className="spin" size={17} /> : <RefreshCw size={17} />}按确认口径重新提取</button></div> : <><div className="facts-heading"><span><CheckCircle2 size={18} />已形成完整业务事实</span><button className="text-button" onClick={generate} disabled={!!busy}><RefreshCw size={15} />重新提取</button></div><div className="facts-table">{project.facts.confirmedFacts.map((group, index) => <div key={`${group.category}-${index}`}><b>{group.category}</b><ul>{group.items.map((item) => <li key={item}>{item}</li>)}</ul></div>)}</div><div className="panel-actions right"><button className="primary" onClick={next}>继续生成策略<ChevronRight size={17} /></button></div></>}
  </section>
}

function StrategyStep({ project, busy, thinking, setThinking, generate, choice, setChoice, strategyAdvice, setStrategyAdvice, save }: { project: ProjectData; busy: string; thinking: boolean; setThinking: (value: boolean) => void; generate: () => void; choice: string[]; setChoice: (ids: string[]) => void; strategyAdvice: Record<string, string>; setStrategyAdvice: (value: Record<string, string>) => void; save: () => void }) {
  return <section className="flow-panel surface-card">
    <StepHeader step="步骤 3 / 5" title="选择内容策略" action={project.strategies.length > 0 && <button className="secondary compact" onClick={generate} disabled={!!busy}><RefreshCw size={15} />换一批策略</button>}>可以同时选择多个方向；后续会为每个策略各生成一篇独立文案。</StepHeader>
    {project.facts && !project.facts.conflicts.length && <ThinkingToggle checked={thinking} onChange={setThinking} disabled={!!busy} />}
    {!project.facts || project.facts.conflicts.length ? <Gate icon={<Circle size={25} />} message="业务事实尚未确认" target="请先完成上一步，再生成策略。" /> : project.strategies.length === 0 ? <ActionState icon={<Sparkles size={27} />} title="生成本轮策略候选" description={`将读取 ${project.keywords.filter((item) => item.enabled).length} 条生效关键词、${project.references.filter((item) => item.enabled).length} 篇生效参考文案和 ${project.rules.filter((item) => item.enabled).length} 条生效合规准则。`} button={<button className="primary" onClick={generate} disabled={!!busy}>{busy === 'strategies' ? <LoaderCircle className="spin" size={17} /> : <WandSparkles size={17} />}生成策略</button>} /> : <><div className="selection-summary">已选 {choice.length} 个策略，将生成 {choice.length} 篇文案；每个策略可单独填写要求。</div><div className="strategy-list">{project.strategies.map((strategy) => <StrategyCard key={strategy.id} strategy={strategy} project={project} selected={choice.includes(strategy.id)} onSelect={() => setChoice(choice.includes(strategy.id) ? choice.filter((id) => id !== strategy.id) : [...choice, strategy.id])} advice={strategyAdvice[strategy.id] || ''} onAdviceChange={(value) => setStrategyAdvice({ ...strategyAdvice, [strategy.id]: value })} />)}</div><div className="panel-actions right"><button className="primary" onClick={save} disabled={!choice.length || !!busy}>{busy === 'select' ? <LoaderCircle className="spin" size={17} /> : <Check size={17} />}确认 {choice.length} 个策略并继续</button></div></>}
  </section>
}

function StrategyCard({ strategy, project, selected, onSelect, advice, onAdviceChange }: { strategy: Strategy; project: ProjectData; selected: boolean; onSelect: () => void; advice?: string; onAdviceChange?: (value: string) => void }) {
  const references = strategy.referenceIds.map((id) => project.references.find((item) => item.id === id)).filter(Boolean) as Reference[]
  return <div className={`strategy-item ${selected ? 'selected' : ''}`}><button className="strategy-row" onClick={onSelect} aria-pressed={selected}><span className="strategy-radio">{selected && <Check size={14} />}</span><span className="strategy-copy"><span><code>{strategy.id}</code><b>{strategy.name}</b></span><strong>{strategy.angle}</strong><small>{strategy.route}</small><em>{references.length ? references.map((item) => item.title).join('、') : '无指定参考文案'}</em></span><ChevronRight size={17} /></button>{selected && onAdviceChange && <label className="strategy-advice"><span><PenLine size={14} />这条策略的补充要求 <small>可选</small></span><textarea rows={3} value={advice} onChange={(event) => onAdviceChange(event.target.value)} placeholder="仅作用于这篇文案，例如：面向新手，语气克制，强调预约方式" /></label>}</div>
}

function ComposeStep({ project, strategies, busy, thinking, setThinking, generate, back }: { project: ProjectData; strategies: Strategy[]; busy: string; thinking: boolean; setThinking: (value: boolean) => void; generate: () => void; back: () => void }) {
  return <section className="flow-panel surface-card">
    <StepHeader step="步骤 4 / 5" title="生成完整文案">模型会按已选策略逐篇流式生成标题、正文和话题标签。</StepHeader>
    {!strategies.length ? <Gate icon={<LayoutTemplate size={25} />} message="尚未选定策略" target="请返回上一步选择并确认策略。" /> : <><ThinkingToggle checked={thinking} onChange={setThinking} disabled={!!busy} /><div className="compose-strategy-list">{strategies.map((strategy, index) => <div className="compose-strategy" key={strategy.id}><span>文案 {String.fromCharCode(65 + index)} · {strategy.id}</span><h3>{strategy.name}</h3><p>{strategy.angle}</p>{project.strategyAdvice[strategy.id] && <small>{project.strategyAdvice[strategy.id]}</small>}</div>)}</div><div className="generation-inputs"><div><span>将生成</span><b>{strategies.length} 篇</b></div><div><span>生效关键词</span><b>{project.keywords.filter((item) => item.enabled).length} 条</b></div><div><span>生效合规准则</span><b>{project.rules.filter((item) => item.enabled).length} 条</b></div><div><span>指定参考</span><b>{new Set(strategies.flatMap((strategy) => strategy.referenceIds)).size} 篇</b></div></div><div className="panel-actions"><button className="secondary" onClick={back}>返回调整策略</button><button className="primary" onClick={generate} disabled={!!busy}>{busy === 'draft' ? <LoaderCircle className="spin" size={17} /> : <WandSparkles size={17} />}生成 {strategies.length} 篇文案</button></div></>}
  </section>
}

function documentLabel(index: number) { return `文案 ${String.fromCharCode(65 + index)}` }
function revisionLabel(drafts: Draft[], draft: Draft) {
  const index = drafts.findIndex((item) => item.version === draft.version)
  return index <= 0 ? '初稿' : `修订 ${index}`
}

function ReviewStep({ project, draft, viewVersion, setViewVersion, revision, setRevision, busy, thinking, setThinking, revise, saveManual, confirm, newGeneration }: { project: ProjectData; draft: Draft | null; viewVersion: number | null; setViewVersion: (version: number) => void; revision: string; setRevision: (value: string) => void; busy: string; thinking: boolean; setThinking: (value: boolean) => void; revise: () => void; saveManual: (draft: { version: number; title: string; body: string; hashtags: string }) => Promise<boolean>; confirm: (version: number) => void; newGeneration: () => void }) {
  const [manual, setManual] = useState({ title: '', body: '', hashtags: '' })
  useEffect(() => {
    if (!draft) return
    setManual({ title: draft.title, body: draft.body, hashtags: draft.hashtags.map((tag) => `#${tag}`).join(' ') })
  }, [draft?.version])
  if (!draft) return <section className="flow-panel surface-card"><StepHeader step="步骤 5 / 5" title="审核并确认文案">确认前，文案不会成为最终输出。</StepHeader><Gate icon={<FileText size={25} />} message="还没有生成文案" target="请先完成策略选择并生成文案。" /></section>
  const strategy = project.strategies.find((item) => item.id === draft.strategyId)
  const strategyIds = [...new Set([...project.selectedStrategyIds, ...project.drafts.map((item) => item.strategyId)])]
  const documentIndex = strategyIds.indexOf(draft.strategyId)
  const revisions = project.drafts.filter((item) => item.strategyId === draft.strategyId)
  const dirty = manual.title !== draft.title || manual.body !== draft.body || manual.hashtags !== draft.hashtags.map((tag) => `#${tag}`).join(' ')
  const allConfirmed = project.selectedStrategyIds.every((id) => project.drafts.some((item) => item.strategyId === id && item.confirmed))
  return <section className="flow-panel review-panel surface-card">
    <StepHeader step="步骤 5 / 5" title="审核并确认文案">文案按策略分组，每篇文案内部单独保留初稿和修订记录。直接在画布中修改即可。</StepHeader>
    <div className="review-grid"><article className="draft-preview editable-canvas"><div className="draft-meta"><span>{documentLabel(documentIndex)}</span><span>{strategy?.name || draft.strategyId}</span><span>{revisionLabel(revisions, draft)}</span><span>{formatTime(draft.createdAt)}</span>{draft.confirmed && <b><CheckCircle2 size={14} />已确认</b>}</div><input className="canvas-title" aria-label="文案标题" value={manual.title} onChange={(event) => setManual({ ...manual, title: event.target.value })} /><textarea className="canvas-body" aria-label="文案正文" rows={Math.max(18, manual.body.split('\n').length + 4)} value={manual.body} onChange={(event) => setManual({ ...manual, body: event.target.value })} /><div className="canvas-tags"><span>话题</span><input aria-label="话题标签" value={manual.hashtags} onChange={(event) => setManual({ ...manual, hashtags: event.target.value })} placeholder="#亲子研学 #周末去处" /></div>{dirty && <div className="canvas-savebar"><span>画布中有未保存的修改</span><button className="primary compact" disabled={!manual.title.trim() || !manual.body.trim() || !!busy} onClick={() => saveManual({ version: draft.version, ...manual })}>{busy === 'manual' ? <LoaderCircle className="spin" size={16} /> : <Save size={16} />}保存为{revisions.length ? `修订 ${revisions.length}` : '初稿'}</button></div>}</article><aside className="review-tools"><div className="document-nav"><h3>本轮文案</h3><div className="document-list">{strategyIds.map((strategyId, index) => { const items = project.drafts.filter((item) => item.strategyId === strategyId); const latest = items.at(-1); const itemStrategy = project.strategies.find((item) => item.id === strategyId); if (!latest) return null; return <button key={strategyId} className={strategyId === draft.strategyId ? 'active' : ''} onClick={() => setViewVersion(latest.version)}><span>{documentLabel(index)}</span><b>{itemStrategy?.name || strategyId}</b>{items.some((item) => item.confirmed) ? <CheckCircle2 size={14} /> : <small>{items.length > 1 ? `${items.length - 1} 次修订` : '待审核'}</small>}</button> })}</div><h3>修订记录</h3><div className="revision-tabs">{revisions.map((item) => <button key={item.version} className={viewVersion === item.version ? 'active' : ''} onClick={() => setViewVersion(item.version)}>{revisionLabel(revisions, item)}{item.confirmed && <Check size={12} />}</button>)}</div></div><div className="revision-form"><label className="field"><span>AI 修改这篇文案</span><textarea rows={4} value={revision} onChange={(e) => setRevision(e.target.value)} placeholder="例如：标题更直接；删减第二段；语气再克制一点" /></label><ThinkingToggle checked={thinking} onChange={setThinking} disabled={!!busy} /><button className="secondary full" onClick={revise} disabled={!revision.trim() || !!busy || dirty}>{busy === 'revise' ? <LoaderCircle className="spin" size={17} /> : <RefreshCw size={17} />}生成一次修订</button>{dirty && <p className="inline-hint">请先保存画布中的修改，再使用 AI 修订。</p>}{!draft.confirmed && <button className="primary full" onClick={() => confirm(draft.version)} disabled={!!busy || dirty}><Check size={17} />确认这一稿</button>}</div>{draft.confirmed && <div className="confirmed-state"><CheckCircle2 size={23} /><b>这篇文案已确认</b><p>已保存到项目文件夹。</p></div>}{allConfirmed && <button className="primary full review-new" onClick={newGeneration}><Plus size={17} />开始新一轮生成</button>}</aside></div>
  </section>
}

function GenerationHistory({ project, selected, onSelect }: { project: ProjectData; selected: string; onSelect: (id: string) => void }) {
  const currentConfirmed = project.selectedStrategyIds.length > 0 && project.selectedStrategyIds.every((id) => project.drafts.some((draft) => draft.strategyId === id && draft.confirmed))
  return <aside className="generation-history"><div className="section-title"><div><h2>生成记录</h2><p>同一项目的多轮内容</p></div></div><div className="history-list"><button className={selected === 'current' ? 'active' : ''} onClick={() => onSelect('current')}><span className="history-status current" /><span><b>{project.currentDraft?.title || '当前生成'}</b><small>{project.currentGeneration.id} · {currentConfirmed ? '已确认' : '进行中'}</small></span></button>{[...project.generationHistory].reverse().map((item) => { const done = archivedCompleted(item)[4]; return <button key={item.id} className={selected === item.id ? 'active' : ''} onClick={() => onSelect(item.id)}><span className="history-status" /><span><b>{item.drafts.at(-1)?.title || '未完成的生成'}</b><small>{item.id} · {done ? '已确认' : '未完成'}</small></span></button> })}</div>{project.generationHistory.length === 0 && <p className="history-empty">完成当前文案后，可以继续创建下一轮。</p>}</aside>
}

function ArchivedGeneration({ record, step }: { record: GenerationRecord; step: number }) {
  const selectedIds = record.selectedStrategyIds || (record.selectedStrategyId ? [record.selectedStrategyId] : [])
  const selectedStrategies = record.strategies.filter((item) => selectedIds.includes(item.id))
  if (step === 1) return <section className="flow-panel surface-card"><StepHeader step={`${record.id} · 阶段 1`} title="当时的生成依据">以下是归档时保存的素材快照。</StepHeader><div className={`source-file ${record.material?.exists ? 'ready' : ''}`}><span className="list-icon"><FileText size={20} /></span><div><b>{record.material?.name || '业务原始素材'}</b><small>{record.material?.content ? `${record.material.content.length.toLocaleString()} 个字符` : '旧版记录未保存原始素材快照'}</small></div></div><div className="asset-summary"><div><span>关键词</span><b>{record.keywords?.length || 0}</b><small>条</small></div><div><span>参考文案</span><b>{record.references?.length || 0}</b><small>篇</small></div><div><span>合规准则</span><b>{record.rules?.length || 0}</b><small>条</small></div></div></section>
  if (step === 2) return <section className="flow-panel surface-card"><StepHeader step={`${record.id} · 阶段 2`} title="当时的业务事实">归档记录中的事实提取结果。</StepHeader>{record.facts ? <div className="facts-table">{record.facts.confirmedFacts.map((group, index) => <div key={`${group.category}-${index}`}><b>{group.category}</b><ul>{group.items.map((item) => <li key={item}>{item}</li>)}</ul></div>)}</div> : <Gate icon={<Archive size={25} />} message="无事实快照" target="这是升级前创建的历史记录。" />}</section>
  if (step === 3) return <section className="flow-panel surface-card"><StepHeader step={`${record.id} · 阶段 3`} title="当时的策略选择">蓝色高亮项是本轮实际选用的策略。</StepHeader><div className="strategy-list">{record.strategies.map((strategy) => <div key={strategy.id}><StrategyCard strategy={strategy} project={{ references: record.references || [] } as ProjectData} selected={selectedIds.includes(strategy.id)} onSelect={() => undefined} />{selectedIds.includes(strategy.id) && (record.strategyAdvice?.[strategy.id] || (record.selectedStrategyId === strategy.id && record.advice)) && <div className="archived-advice"><PenLine size={13} /><span>{record.strategyAdvice?.[strategy.id] || record.advice}</span></div>}</div>)}</div></section>
  if (step === 4) return <section className="flow-panel surface-card"><StepHeader step={`${record.id} · 阶段 4`} title="当时的生成任务">本轮按以下 {selectedStrategies.length} 个策略生成文案。</StepHeader><div className="compose-strategy-list">{selectedStrategies.map((strategy, index) => <div className="compose-strategy" key={strategy.id}><span>{documentLabel(index)} · {strategy.id}</span><h3>{strategy.name}</h3><p>{strategy.angle}</p>{(record.strategyAdvice?.[strategy.id] || (record.selectedStrategyId === strategy.id && record.advice)) && <small>{record.strategyAdvice?.[strategy.id] || record.advice}</small>}</div>)}</div></section>
  return <ArchivedReview record={record} />
}

function ArchivedReview({ record }: { record: GenerationRecord }) {
  const initial = [...record.drafts].reverse().find((item) => item.confirmed) || record.drafts.at(-1)
  const [version, setVersion] = useState(initial?.version || 0)
  useEffect(() => setVersion(initial?.version || 0), [record.id])
  const draft = record.drafts.find((item) => item.version === version) || initial
  if (!draft) return <section className="flow-panel surface-card"><StepHeader step={`${record.id} · 阶段 5`} title="当时的审核结果">该记录已归档，仅供回放。</StepHeader><Gate icon={<Archive size={25} />} message="这轮生成没有产出文案" target="记录保留了当时的进度，但没有可预览的终稿。" /></section>
  const strategyIds = [...new Set([...(record.selectedStrategyIds || []), ...record.drafts.map((item) => item.strategyId)])]
  const documentIndex = strategyIds.indexOf(draft.strategyId)
  const revisions = record.drafts.filter((item) => item.strategyId === draft.strategyId)
  return <section className="flow-panel surface-card"><StepHeader step={`${record.id} · 阶段 5`} title="当时的审核结果">文案与各自的修订记录按归档时的状态回放。</StepHeader><div className="review-grid"><article className="draft-preview"><div className="draft-meta"><span>{documentLabel(documentIndex)}</span><span>{record.strategies.find((item) => item.id === draft.strategyId)?.name || draft.strategyId}</span><span>{revisionLabel(revisions, draft)}</span><span>{formatTime(draft.createdAt)}</span>{draft.confirmed && <b><CheckCircle2 size={14} />已确认</b>}</div><h3>{draft.title}</h3><div>{draft.body.split('\n').map((line, index) => <p key={index}>{line || '\u00a0'}</p>)}</div><footer>{draft.hashtags.map((tag) => <span key={tag}>#{tag}</span>)}</footer></article><aside className="review-tools"><div className="document-nav"><h3>当时的文案</h3><div className="document-list">{strategyIds.map((strategyId, index) => { const items = record.drafts.filter((item) => item.strategyId === strategyId); const latest = [...items].reverse().find((item) => item.confirmed) || items.at(-1); if (!latest) return null; return <button key={strategyId} className={strategyId === draft.strategyId ? 'active' : ''} onClick={() => setVersion(latest.version)}><span>{documentLabel(index)}</span><b>{record.strategies.find((item) => item.id === strategyId)?.name || strategyId}</b>{items.some((item) => item.confirmed) && <CheckCircle2 size={14} />}</button> })}</div><h3>修订记录</h3><div className="revision-tabs">{revisions.map((item) => <button key={item.version} className={item.version === draft.version ? 'active' : ''} onClick={() => setVersion(item.version)}>{revisionLabel(revisions, item)}{item.confirmed && <Check size={12} />}</button>)}</div></div></aside></div></section>
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
  if (!content.trim()) return <div className="thought-wait"><Brain size={15} /><span>正在等待思考轨迹…</span></div>
  return <details className="thought-trace" open><summary><Brain size={15} />思考过程<span>仅显示模型返回的思考文本</span></summary><div>{content}</div></details>
}

function GenerationActivity({ stream, busy, project, thinkingEnabled }: { stream: { operation: string; content: string; thinking: string; done: boolean }; busy: string; project: ProjectData; thinkingEnabled: boolean }) {
  const matches = busy === 'facts' ? stream.operation === 'facts' : busy === 'strategies' ? stream.operation === 'strategies' : stream.operation.startsWith('draft:')
  const content = matches ? stream.content : ''
  const thinking = matches ? stream.thinking : ''
  if (busy === 'draft' || busy === 'revise') {
    const [, strategyId = '', progress = '1/1'] = stream.operation.split(':')
    const strategy = project.strategies.find((item) => item.id === strategyId)
    const title = partialJsonString(content, 'title')
    const body = partialJsonString(content, 'body')
    const tags = partialJsonStringArray(content, 'hashtags')
    return <section className="live-document" aria-live="polite"><div className="activity-head"><span><LoaderCircle className="spin" size={16} /></span><div><b>{busy === 'revise' ? '正在生成修订稿' : `正在生成文案 ${progress}`}</b><small>{strategy?.name || '正在组织标题和正文'}</small></div></div><article className="live-paper"><h3>{title || '标题正在成形…'}</h3><div>{body ? body.split('\n').map((line, index) => <p key={index}>{line || '\u00a0'}</p>) : <p className="typing-placeholder">正文会在这里逐段出现…</p>}</div>{tags.length > 0 && <footer>{tags.map((tag) => <span key={tag}>#{tag}</span>)}</footer>}</article>{thinkingEnabled && <ThoughtTrace content={thinking} />}</section>
  }
  const labels = busy === 'facts' ? completedJsonStrings(content, 'category') : completedJsonStrings(content, 'name')
  const noun = busy === 'facts' ? '组事实' : '条策略'
  const base = busy === 'facts' ? '正在阅读素材并识别口径…' : '正在对照事实与项目素材…'
  return <section className="generation-activity" aria-live="polite"><div className="activity-head"><span><LoaderCircle className="spin" size={16} /></span><div><b>{busy === 'facts' ? '正在核对业务事实' : '正在生成内容策略'}</b><small>已完成 {labels.length} {noun}</small></div></div><ol className="activity-log"><li className="done"><Check size={13} /><span>{base.replace('正在', '已') .replace('…', '')}</span></li>{labels.map((label, index) => <li className="done" key={`${label}-${index}`}><Check size={13} /><span>{busy === 'facts' ? `已整理第 ${index + 1} 组：${label}` : `已形成第 ${index + 1} 条：${label}`}</span></li>)}<li className="active"><LoaderCircle className="spin" size={13} /><span>{labels.length ? `正在生成第 ${labels.length + 1} ${noun}…` : busy === 'facts' ? '正在整理第 1 组事实…' : '正在生成第 1 条策略…'}</span></li></ol>{thinkingEnabled && <ThoughtTrace content={thinking} />}</section>
}

function AssetsPage({ project, chooseFolder, importMaterial, downloadAssetTemplate, importAssetBatch, busy, tab, setTab, openAsset, deleteAsset, toggleAsset, goGenerate }: {
  project: ProjectData | null; chooseFolder: () => void; importMaterial: () => void;
  downloadAssetTemplate: (kind: BatchAssetKind) => void; importAssetBatch: (kind: BatchAssetKind) => void;
  busy: string; tab: AssetKind; setTab: (tab: AssetKind) => void;
  openAsset: (kind: AssetKind, item?: Keyword | Rule | Reference) => void;
  deleteAsset: (kind: AssetKind, id: string) => void; toggleAsset: (kind: AssetKind, id: string, enabled: boolean) => Promise<boolean>; goGenerate: () => void;
}) {
  const labels = { keywords: ['关键词', '关键词'], references: ['参考文案', '参考文案'], rules: ['合规准则', '准则'] }
  const items = project?.[tab] || []
  const batchKind = tab === 'keywords' || tab === 'rules' ? tab : null
  return <div className="page-content"><PageHeader title="素材管理" action={project && <button className="primary" onClick={goGenerate}><WandSparkles size={17} />前往文案生成</button>}>维护项目的原始素材、关键词、参考文案和合规要求，后续每轮生成都会读取最新版本。</PageHeader>{!project ? <ProjectEmpty recent={[]} openRecent={() => undefined} chooseFolder={chooseFolder} /> : <><section className={`material-card surface-card ${project.material.exists ? 'ready' : ''}`}><span className="large-icon"><FileText size={25} /></span><div><span>业务原始素材</span><h2>{project.material.exists ? '业务原始素材.md' : '尚未导入 Markdown 文件'}</h2><p>{project.material.exists ? `${project.material.content.length.toLocaleString()} 个字符 · 更新后可重新提取业务事实` : '请先将 PDF 和图片完整转换为 Markdown'}</p></div><button className="secondary" onClick={importMaterial} disabled={!!busy}>{busy === 'material' ? <LoaderCircle className="spin" size={17} /> : <FileText size={17} />}{project.material.exists ? '替换文件' : '导入文件'}</button></section><section className="asset-library surface-card"><div className="asset-tabs">{(Object.keys(labels) as AssetKind[]).map((key) => <button key={key} className={tab === key ? 'active' : ''} onClick={() => setTab(key)}>{labels[key][0]}<span>{project[key].filter((item) => item.enabled).length}/{project[key].length}</span></button>)}</div><div className="asset-toolbar"><div><h2>{labels[tab][0]}</h2><p>{batchKind ? '支持手动维护，也可使用 Excel 模板批量导入。' : '标题和正文必填，话题标签可选。'} 关闭“生效”后，该行不会拼接进模型提示词。</p></div><div className="asset-toolbar-actions">{batchKind && <><button className="secondary compact" onClick={() => downloadAssetTemplate(batchKind)} disabled={!!busy}>{busy === `template-${batchKind}` ? <LoaderCircle className="spin" size={16} /> : <Download size={16} />}下载模板</button><button className="secondary compact" onClick={() => importAssetBatch(batchKind)} disabled={!!busy}>{busy === `import-${batchKind}` ? <LoaderCircle className="spin" size={16} /> : <Upload size={16} />}批量导入</button></>}<button className="primary compact" onClick={() => openAsset(tab)} disabled={!!busy}><Plus size={16} />新增{labels[tab][1]}</button></div></div>{items.length === 0 ? <div className="compact-empty tall"><Archive size={25} /><b>还没有{labels[tab][0]}</b><span>这类资料可以暂时留空，不会阻断生成流程。</span></div> : <AssetTable kind={tab} items={items} openAsset={openAsset} deleteAsset={deleteAsset} toggleAsset={toggleAsset} />}</section></>}</div>
}

const assetTableHeaders: Record<AssetKind, string[]> = {
  keywords: ['生效', '编号', '分类', '核心关键词/词根', '词性标签', '痛点/意图标签', '建议用法(槽位)', '操作'],
  rules: ['生效', '编号', '禁用词/敏感表述', '风险类型', '判定依据', '处理方式', '替代写法', '操作'],
  references: ['生效', '编号', '标题', '正文', '话题标签', '操作'],
}

function displayCell(value?: string) { return value?.trim() || '—' }

function AssetTable({ kind, items, openAsset, deleteAsset, toggleAsset }: {
  kind: AssetKind; items: (Keyword | Rule | Reference)[];
  openAsset: (kind: AssetKind, item: Keyword | Rule | Reference) => void;
  deleteAsset: (kind: AssetKind, id: string) => void;
  toggleAsset: (kind: AssetKind, id: string, enabled: boolean) => Promise<boolean>;
}) {
  return <div className="asset-table-scroll"><table className={`asset-data-table ${kind}`}><thead><tr>{assetTableHeaders[kind].map((header) => <th key={header} scope="col">{header}</th>)}</tr></thead><tbody>{items.map((item) => <tr key={item.id} className={item.enabled ? '' : 'disabled-row'}><td className="asset-enabled"><label className="switch"><input type="checkbox" checked={item.enabled} onChange={(event) => toggleAsset(kind, item.id, event.target.checked)} aria-label={`${item.enabled ? '停用' : '启用'} ${item.id}`} /><span /></label></td>{kind === 'keywords' ? <KeywordCells item={item as Keyword} /> : kind === 'rules' ? <RuleCells item={item as Rule} /> : <ReferenceCells item={item as Reference} />}<td className="asset-actions"><div><button className="icon-button" title="编辑" aria-label={`编辑 ${item.id}`} onClick={() => openAsset(kind, item)}><PenLine size={15} /></button><button className="icon-button danger" title="删除" aria-label={`删除 ${item.id}`} onClick={() => deleteAsset(kind, item.id)}><Trash2 size={15} /></button></div></td></tr>)}</tbody></table></div>
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
  return <div className="page-content settings-page"><PageHeader title="设置">配置用于提取事实、生成策略与撰写文案的模型服务。设置保存在本机，不会写入项目目录。</PageHeader><section className="settings-card surface-card"><div className="settings-heading"><span className="large-icon"><KeyRound size={22} /></span><div><h2>模型连接</h2><p>支持 OpenAI Chat Completions 兼容接口。</p></div><span className={`connection-badge ${settings.apiKey && settings.model ? 'ready' : ''}`}>{settings.apiKey && settings.model ? '已配置' : '待配置'}</span></div><div className="settings-form"><label className="field"><span>接口地址</span><input value={settings.baseUrl} onChange={(e) => setSettings({ ...settings, baseUrl: e.target.value })} placeholder="https://api.openai.com/v1" /></label><label className="field"><span>API Key</span><input type="password" value={settings.apiKey} onChange={(e) => setSettings({ ...settings, apiKey: e.target.value })} placeholder="sk-…" /></label><label className="field"><span>模型名称</span><input value={settings.model} onChange={(e) => setSettings({ ...settings, model: e.target.value })} placeholder="例如 gpt-5-mini" /></label></div><div className="security-note"><KeyRound size={16} /><span>密钥仅保存在本机应用数据中，请勿在共享设备上使用个人密钥。</span></div><div className="panel-actions right"><button className="primary" onClick={save} disabled={!!busy}>{busy === 'settings' ? <LoaderCircle className="spin" size={17} /> : <Check size={17} />}保存设置</button></div></section></div>
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

export default App
