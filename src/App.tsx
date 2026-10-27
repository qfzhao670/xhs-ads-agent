import { useEffect, useMemo, useState } from 'react'
import {
  Archive, BookOpenText, Check, CheckCircle2, ChevronDown, ChevronRight,
  Circle, FileText, FolderOpen, KeyRound, LayoutTemplate, LoaderCircle,
  PackageOpen, PenLine, Plus, RefreshCw, Scale, Settings, SlidersHorizontal,
  Sparkles, Trash2, WandSparkles, X,
} from 'lucide-react'

type Page = 'generate' | 'assets' | 'settings'
type Modal = 'project-init' | AssetKind | null

const flowSteps = [
  ['准备素材', '确认本次生成依据'],
  ['核对事实', '提取并消除冲突'],
  ['选择策略', '确定唯一内容方向'],
  ['生成文案', '产出标题与正文'],
  ['审核确认', '修改、确认并归档'],
] as const

const emptyForms = {
  keywords: { id: '', value: '', note: '' },
  rules: { id: '', content: '', note: '' },
  references: { id: '', title: '', body: '', author: '', contentType: '', performance: '', note: '' },
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
  const [choice, setChoice] = useState('')
  const [advice, setAdvice] = useState('')
  const [revision, setRevision] = useState('')
  const [viewVersion, setViewVersion] = useState<number | null>(null)

  useEffect(() => {
    window.workshop.getRecentProjects().then(setRecent)
    window.workshop.getSettings().then(setSettings)
  }, [])

  useEffect(() => {
    setChoice(project?.selectedStrategyId || '')
    setAdvice(project?.advice || '')
    setViewVersion(project?.currentDraft?.version || null)
  }, [project?.meta.root, project?.selectedStrategyId, project?.advice, project?.currentDraft?.version])

  const completed = useMemo(() => [
    !!project?.material.exists,
    !!project?.facts && project.facts.conflicts.length === 0,
    !!project?.selectedStrategyId,
    !!project?.currentDraft,
    !!project?.currentDraft?.confirmed,
  ], [project])

  function suggestedStep(data: ProjectData) {
    if (data.currentDraft) return 5
    if (data.selectedStrategyId) return 4
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
    setForm(item ? { ...item } as unknown as Record<string, string> : { ...emptyForms[kind] })
    setModal(kind)
  }
  async function saveAsset() {
    const required = assetTab === 'keywords' ? form.value : assetTab === 'rules' ? form.content : form.title && form.body
    if (!required?.trim()) { setError(assetTab === 'references' ? '标题和正文为必填项' : '请填写内容'); return }
    const ok = await run('asset', () => window.workshop.saveAsset(assetTab, form), form.id ? '记录已更新' : '记录已添加')
    if (ok) setModal(null)
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
    if (ok) { setViewGeneration('current'); setFlowStep(nextStep); setChoice(''); setAdvice(''); setRevision('') }
  }

  const selectedStrategy = project?.strategies.find((item) => item.id === project.selectedStrategyId)
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
          viewGeneration={viewGeneration} setViewGeneration={setViewGeneration} archived={archived}
          newGeneration={newGeneration} busy={busy} setPage={setPage}
          resolution={resolution} setResolution={setResolution}
          generateFacts={async () => { const ok = await run('facts', () => window.workshop.extractFacts(resolution), resolution ? '业务事实已重新生成' : '业务事实已提取'); if (ok) { setResolution(''); setFlowStep(3) } }}
          generateStrategies={() => run('strategies', () => window.workshop.generateStrategies(), '策略候选已生成')}
          choice={choice} setChoice={setChoice} advice={advice} setAdvice={setAdvice}
          saveStrategy={async () => { if (!choice) return showError('请先选择一个策略'); const ok = await run('select', () => window.workshop.selectStrategy(choice, advice), '策略与补充建议已保存'); if (ok) setFlowStep(4) }}
          selectedStrategy={selectedStrategy}
          generateDraft={async () => { const ok = await run('draft', () => window.workshop.generateDraft(), '文案已生成'); if (ok) setFlowStep(5) }}
          draft={viewedDraft} viewVersion={viewVersion} setViewVersion={setViewVersion}
          revision={revision} setRevision={setRevision}
          revise={async () => { const ok = await run('revise', () => window.workshop.reviseDraft(revision), '修改版本已生成'); if (ok) setRevision('') }}
          confirm={() => run('confirm', () => window.workshop.confirmDraft(), '当前版本已确认并归档')}
        />}
        {page === 'assets' && <AssetsPage project={project} chooseFolder={chooseFolder} importMaterial={importMaterial} busy={busy} tab={assetTab} setTab={setAssetTab} openAsset={openAsset} deleteAsset={deleteAsset} goGenerate={() => { setPage('generate'); setFlowStep(project?.facts ? 3 : 2) }} />}
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
  resolution: string; setResolution: (value: string) => void; generateFacts: () => void; generateStrategies: () => void;
  choice: string; setChoice: (id: string) => void; advice: string; setAdvice: (value: string) => void; saveStrategy: () => void;
  selectedStrategy?: Strategy; generateDraft: () => void; draft: Draft | null; viewVersion: number | null; setViewVersion: (version: number) => void;
  revision: string; setRevision: (value: string) => void; revise: () => void; confirm: () => void;
}

function GenerationPage(props: GenerationPageProps) {
  const { project, recent, openRecent, chooseFolder, flowStep, setFlowStep, completed, viewGeneration, setViewGeneration, archived, newGeneration, busy } = props
  return <div className="page-content generate-page">
    <PageHeader title="文案生成" action={project && <button className="secondary" onClick={newGeneration} disabled={busy === 'new-generation'}>{busy === 'new-generation' ? <LoaderCircle className="spin" size={17} /> : <Plus size={17} />}新建生成</button>}>
      按流程完成一篇文案。同一个项目可以创建多轮生成，素材与历史记录互不丢失。
    </PageHeader>
    {!project ? <ProjectEmpty recent={recent} openRecent={openRecent} chooseFolder={chooseFolder} /> : <>
      <section className="flow-card" aria-label="文案生成流程">
        <div className="flow-context"><div><span>当前生成</span><b>{project.currentGeneration.id}</b></div><small>开始于 {formatTime(project.currentGeneration.createdAt)}</small></div>
        <div className="flow-track">
          {flowSteps.map(([name, hint], index) => {
            const step = index + 1
            const done = completed[index]
            return <button key={name} className={`${flowStep === step && viewGeneration === 'current' ? 'active' : ''} ${done ? 'done' : ''}`} onClick={() => { setViewGeneration('current'); setFlowStep(step) }}>
              <span className="flow-number">{done ? <Check size={15} /> : step}</span><span><b>{name}</b><small>{hint}</small></span>
            </button>
          })}
        </div>
      </section>
      <div className="generation-layout">
        <div className="generation-main">
          {archived ? <ArchivedGeneration record={archived} /> : <CurrentFlow {...props} />}
        </div>
        <GenerationHistory project={project} selected={viewGeneration} onSelect={setViewGeneration} onNew={newGeneration} busy={busy} />
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
  if (flowStep === 2) return <FactsStep project={project} busy={props.busy} resolution={props.resolution} setResolution={props.setResolution} generate={props.generateFacts} next={() => props.setFlowStep(3)} />
  if (flowStep === 3) return <StrategyStep project={project} busy={props.busy} generate={props.generateStrategies} choice={props.choice} setChoice={props.setChoice} advice={props.advice} setAdvice={props.setAdvice} save={props.saveStrategy} />
  if (flowStep === 4) return <ComposeStep project={project} strategy={props.selectedStrategy} busy={props.busy} generate={props.generateDraft} back={() => props.setFlowStep(3)} />
  return <ReviewStep project={project} draft={props.draft} viewVersion={props.viewVersion} setViewVersion={props.setViewVersion} revision={props.revision} setRevision={props.setRevision} busy={props.busy} revise={props.revise} confirm={props.confirm} newGeneration={props.newGeneration} />
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

function FactsStep({ project, busy, resolution, setResolution, generate, next }: { project: ProjectData; busy: string; resolution: string; setResolution: (value: string) => void; generate: () => void; next: () => void }) {
  const conflicts = project.facts?.conflicts || []
  return <section className="flow-panel surface-card">
    <StepHeader step="步骤 2 / 5" title="核对业务事实">模型只提取素材实际包含的内容，并标记互相冲突的口径。</StepHeader>
    {!project.material.exists ? <Gate icon={<FileText size={25} />} message="缺少原始素材" target="请先前往素材管理导入业务原始素材。" /> : !project.facts ? <ActionState icon={<BookOpenText size={27} />} title="从原始素材提取事实" description="系统会自动归类、去重，并区分可确认事实、宣传表达和口径冲突。" button={<button className="primary" onClick={generate} disabled={!!busy}>{busy === 'facts' ? <LoaderCircle className="spin" size={17} /> : <WandSparkles size={17} />}开始提取</button>} /> : conflicts.length ? <div className="conflict-area"><div className="alert-heading"><Scale size={20} /><div><b>发现 {conflicts.length} 处口径冲突</b><p>确认统一口径后，系统会重新生成完整事实。</p></div></div>{conflicts.map((item, index) => <div className="conflict-row" key={`${item.topic}-${index}`}><span>{item.topic}</span><b>{item.question}</b><ul>{item.versions.map((version) => <li key={version}>{version}</li>)}</ul></div>)}<label className="field"><span>统一口径</span><textarea rows={4} value={resolution} onChange={(e) => setResolution(e.target.value)} placeholder="逐条说明应采用的标准口径" /></label><button className="primary" onClick={generate} disabled={!resolution.trim() || !!busy}>{busy === 'facts' ? <LoaderCircle className="spin" size={17} /> : <RefreshCw size={17} />}按确认口径重新提取</button></div> : <><div className="facts-heading"><span><CheckCircle2 size={18} />已形成完整业务事实</span><button className="text-button" onClick={generate} disabled={!!busy}><RefreshCw size={15} />重新提取</button></div><div className="facts-table">{project.facts.confirmedFacts.map((group, index) => <div key={`${group.category}-${index}`}><b>{group.category}</b><ul>{group.items.map((item) => <li key={item}>{item}</li>)}</ul></div>)}</div><div className="panel-actions right"><button className="primary" onClick={next}>继续生成策略<ChevronRight size={17} /></button></div></>}
  </section>
}

function StrategyStep({ project, busy, generate, choice, setChoice, advice, setAdvice, save }: { project: ProjectData; busy: string; generate: () => void; choice: string; setChoice: (id: string) => void; advice: string; setAdvice: (value: string) => void; save: () => void }) {
  return <section className="flow-panel surface-card">
    <StepHeader step="步骤 3 / 5" title="选择一个内容策略" action={project.strategies.length > 0 && <button className="secondary compact" onClick={generate} disabled={!!busy}><RefreshCw size={15} />换一批策略</button>}>每轮会给出 3–5 个明确不同的方向；只选择一条主线进入成稿。</StepHeader>
    {!project.facts || project.facts.conflicts.length ? <Gate icon={<Circle size={25} />} message="业务事实尚未确认" target="请先完成上一步，再生成策略。" /> : project.strategies.length === 0 ? <ActionState icon={<Sparkles size={27} />} title="生成本轮策略候选" description={`将读取 ${project.keywords.length} 条关键词、${project.references.length} 篇参考文案和 ${project.rules.length} 条合规准则。`} button={<button className="primary" onClick={generate} disabled={!!busy}>{busy === 'strategies' ? <LoaderCircle className="spin" size={17} /> : <WandSparkles size={17} />}生成策略</button>} /> : <><div className="strategy-list">{project.strategies.map((strategy) => <StrategyCard key={strategy.id} strategy={strategy} project={project} selected={choice === strategy.id} onSelect={() => setChoice(strategy.id)} />)}</div><label className="field advice-field"><span>补充要求 <small>可选</small></span><textarea rows={4} value={advice} onChange={(e) => setAdvice(e.target.value)} placeholder="例如：面向新手；语气克制；必须写明预约方式；不要强调低价" /></label><div className="panel-actions right"><button className="primary" onClick={save} disabled={!choice || !!busy}>{busy === 'select' ? <LoaderCircle className="spin" size={17} /> : <Check size={17} />}确认策略并继续</button></div></>}
  </section>
}

function StrategyCard({ strategy, project, selected, onSelect }: { strategy: Strategy; project: ProjectData; selected: boolean; onSelect: () => void }) {
  const references = strategy.referenceIds.map((id) => project.references.find((item) => item.id === id)).filter(Boolean) as Reference[]
  return <button className={`strategy-row ${selected ? 'selected' : ''}`} onClick={onSelect} aria-pressed={selected}><span className="strategy-radio">{selected && <Check size={14} />}</span><span className="strategy-copy"><span><code>{strategy.id}</code><b>{strategy.name}</b></span><strong>{strategy.angle}</strong><small>{strategy.route}</small><em>{references.length ? references.map((item) => item.title).join('、') : '无指定参考文案'}</em></span><ChevronRight size={17} /></button>
}

function ComposeStep({ project, strategy, busy, generate, back }: { project: ProjectData; strategy?: Strategy; busy: string; generate: () => void; back: () => void }) {
  return <section className="flow-panel surface-card">
    <StepHeader step="步骤 4 / 5" title="生成完整文案">确认本次输入后，模型会直接生成标题、正文和话题标签。</StepHeader>
    {!strategy ? <Gate icon={<LayoutTemplate size={25} />} message="尚未选定策略" target="请返回上一步选择并确认一个策略。" /> : <><div className="compose-strategy"><span>已选策略</span><h3>{strategy.name}</h3><p>{strategy.angle}</p></div><div className="generation-inputs"><div><span>业务事实</span><b>{project.facts?.confirmedFacts.reduce((sum, group) => sum + group.items.length, 0) || 0} 条</b></div><div><span>关键词</span><b>{project.keywords.length} 条</b></div><div><span>合规准则</span><b>{project.rules.length} 条</b></div><div><span>指定参考</span><b>{strategy.referenceIds.length} 篇</b></div></div>{project.advice && <div className="advice-note"><span>补充要求</span><p>{project.advice}</p></div>}<div className="panel-actions"><button className="secondary" onClick={back}>返回调整策略</button><button className="primary" onClick={generate} disabled={!!busy}>{busy === 'draft' ? <LoaderCircle className="spin" size={17} /> : <WandSparkles size={17} />}{project.currentDraft ? '重新生成一版' : '生成完整文案'}</button></div></>}
  </section>
}

function ReviewStep({ project, draft, viewVersion, setViewVersion, revision, setRevision, busy, revise, confirm, newGeneration }: { project: ProjectData; draft: Draft | null; viewVersion: number | null; setViewVersion: (version: number) => void; revision: string; setRevision: (value: string) => void; busy: string; revise: () => void; confirm: () => void; newGeneration: () => void }) {
  if (!draft) return <section className="flow-panel surface-card"><StepHeader step="步骤 5 / 5" title="审核并确认文案">确认前，文案不会成为最终输出。</StepHeader><Gate icon={<FileText size={25} />} message="还没有生成文案" target="请先完成策略选择并生成文案。" /></section>
  const isCurrent = draft.version === project.currentDraft?.version
  return <section className="flow-panel review-panel surface-card">
    <StepHeader step="步骤 5 / 5" title="审核并确认文案">每次修改都会保留版本；确认后仍可在同一项目开始新一轮生成。</StepHeader>
    <div className="review-grid"><article className="draft-preview"><div className="draft-meta"><span>V{draft.version}</span><span>{formatTime(draft.createdAt)}</span>{draft.confirmed && <b><CheckCircle2 size={14} />已确认</b>}</div><h3>{draft.title}</h3><div>{draft.body.split('\n').map((line, index) => <p key={index}>{line || '\u00a0'}</p>)}</div><footer>{draft.hashtags.map((tag) => <span key={tag}>#{tag}</span>)}</footer></article><aside className="review-tools"><div><h3>版本记录</h3><div className="version-list">{[...project.drafts].reverse().map((item) => <button key={item.version} className={viewVersion === item.version ? 'active' : ''} onClick={() => setViewVersion(item.version)}><span>V{item.version}</span><small>{item.revisionRequest || (item.version === 1 ? '首次生成' : '重新生成')}</small>{item.confirmed && <CheckCircle2 size={14} />}</button>)}</div></div>{isCurrent && !draft.confirmed && <div className="revision-form"><label className="field"><span>修改要求</span><textarea rows={5} value={revision} onChange={(e) => setRevision(e.target.value)} placeholder="例如：标题更直接；删减第二段；语气再克制一点" /></label><button className="secondary full" onClick={revise} disabled={!revision.trim() || !!busy}>{busy === 'revise' ? <LoaderCircle className="spin" size={17} /> : <RefreshCw size={17} />}生成修改版本</button><button className="primary full" onClick={confirm} disabled={!!busy}><Check size={17} />确认当前版本</button></div>}{!isCurrent && <p className="history-note">正在查看历史版本。返回最新版本后可继续修改或确认。</p>}{draft.confirmed && <div className="confirmed-state"><CheckCircle2 size={23} /><b>本轮文案已确认</b><p>最终文件已保存到项目文件夹。</p><button className="primary full" onClick={newGeneration}><Plus size={17} />再生成一篇</button></div>}</aside></div>
  </section>
}

function GenerationHistory({ project, selected, onSelect, onNew, busy }: { project: ProjectData; selected: string; onSelect: (id: string) => void; onNew: () => void; busy: string }) {
  return <aside className="generation-history"><div className="section-title"><div><h2>生成记录</h2><p>同一项目的多轮内容</p></div><button className="icon-button" title="新建生成" onClick={onNew} disabled={!!busy}><Plus size={17} /></button></div><div className="history-list"><button className={selected === 'current' ? 'active' : ''} onClick={() => onSelect('current')}><span className="history-status current" /><span><b>{project.currentDraft?.title || '当前生成'}</b><small>{project.currentGeneration.id} · {project.currentDraft?.confirmed ? '已确认' : '进行中'}</small></span></button>{[...project.generationHistory].reverse().map((item) => <button key={item.id} className={selected === item.id ? 'active' : ''} onClick={() => onSelect(item.id)}><span className="history-status" /><span><b>{item.drafts.at(-1)?.title || '未完成的生成'}</b><small>{item.id} · {item.drafts.at(-1)?.confirmed ? '已确认' : '未完成'}</small></span></button>)}</div>{project.generationHistory.length === 0 && <p className="history-empty">完成当前文案后，可以继续创建下一轮。</p>}</aside>
}

function ArchivedGeneration({ record }: { record: GenerationRecord }) {
  const draft = [...record.drafts].reverse().find((item) => item.confirmed) || record.drafts.at(-1)
  return <section className="flow-panel surface-card"><StepHeader step={record.id} title="历史生成记录">该记录已归档，仅供查看，不会影响当前生成。</StepHeader>{draft ? <article className="draft-preview archived"><div className="draft-meta"><span>V{draft.version}</span><span>{formatTime(draft.createdAt)}</span>{draft.confirmed && <b><CheckCircle2 size={14} />已确认</b>}</div><h3>{draft.title}</h3><div>{draft.body.split('\n').map((line, index) => <p key={index}>{line || '\u00a0'}</p>)}</div><footer>{draft.hashtags.map((tag) => <span key={tag}>#{tag}</span>)}</footer></article> : <Gate icon={<Archive size={25} />} message="这轮生成没有产出文案" target="记录保留了当时的进度，但没有可预览的终稿。" />}</section>
}

function AssetsPage({ project, chooseFolder, importMaterial, busy, tab, setTab, openAsset, deleteAsset, goGenerate }: { project: ProjectData | null; chooseFolder: () => void; importMaterial: () => void; busy: string; tab: AssetKind; setTab: (tab: AssetKind) => void; openAsset: (kind: AssetKind, item?: Keyword | Rule | Reference) => void; deleteAsset: (kind: AssetKind, id: string) => void; goGenerate: () => void }) {
  const labels = { keywords: ['关键词', '关键词'], references: ['参考文案', '参考文案'], rules: ['合规准则', '准则'] }
  const items = project?.[tab] || []
  return <div className="page-content"><PageHeader title="素材管理" action={project && <button className="primary" onClick={goGenerate}><WandSparkles size={17} />前往文案生成</button>}>维护项目的原始素材、关键词、参考文案和合规要求，后续每轮生成都会读取最新版本。</PageHeader>{!project ? <ProjectEmpty recent={[]} openRecent={() => undefined} chooseFolder={chooseFolder} /> : <><section className={`material-card surface-card ${project.material.exists ? 'ready' : ''}`}><span className="large-icon"><FileText size={25} /></span><div><span>业务原始素材</span><h2>{project.material.exists ? '业务原始素材.md' : '尚未导入 Markdown 文件'}</h2><p>{project.material.exists ? `${project.material.content.length.toLocaleString()} 个字符 · 更新后可重新提取业务事实` : '请先将 PDF 和图片完整转换为 Markdown'}</p></div><button className="secondary" onClick={importMaterial} disabled={!!busy}>{busy === 'material' ? <LoaderCircle className="spin" size={17} /> : <FileText size={17} />}{project.material.exists ? '替换文件' : '导入文件'}</button></section><section className="asset-library surface-card"><div className="asset-tabs">{(Object.keys(labels) as AssetKind[]).map((key) => <button key={key} className={tab === key ? 'active' : ''} onClick={() => setTab(key)}>{labels[key][0]}<span>{project[key].length}</span></button>)}</div><div className="asset-toolbar"><div><h2>{labels[tab][0]}</h2><p>系统编号固定不变，删除后不会重新分配。</p></div><button className="primary compact" onClick={() => openAsset(tab)}><Plus size={16} />新增{labels[tab][1]}</button></div>{items.length === 0 ? <div className="compact-empty tall"><Archive size={25} /><b>还没有{labels[tab][0]}</b><span>这类资料可以暂时留空，不会阻断生成流程。</span></div> : <div className="asset-table"><div className="asset-table-head"><span>编号</span><span>内容</span><span>备注</span><span>操作</span></div>{items.map((item) => <AssetRow key={item.id} kind={tab} item={item} edit={() => openAsset(tab, item)} remove={() => deleteAsset(tab, item.id)} />)}</div>}</section></>}</div>
}

function AssetRow({ kind, item, edit, remove }: { kind: AssetKind; item: Keyword | Rule | Reference; edit: () => void; remove: () => void }) {
  const title = kind === 'keywords' ? (item as Keyword).value : kind === 'rules' ? (item as Rule).content : (item as Reference).title
  const detail = kind === 'references' ? (item as Reference).body : item.note
  const note = kind === 'references' ? ((item as Reference).author || (item as Reference).contentType || '—') : item.note || '—'
  return <div className="asset-row"><code>{item.id}</code><div><b>{title}</b>{detail && <small>{detail}</small>}</div><span>{note}</span><div><button className="icon-button" title="编辑" onClick={edit}><PenLine size={15} /></button><button className="icon-button danger" title="删除" onClick={remove}><Trash2 size={15} /></button></div></div>
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
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) close() }}><div className="modal" role="dialog" aria-modal="true" aria-label={title}><div className="modal-head"><div><span>{modal === 'project-init' ? '项目初始化' : form.id ? '编辑记录' : '新增记录'}</span><h2>{title}</h2></div><button className="icon-button" onClick={close} aria-label="关闭"><X size={19} /></button></div>{modal === 'project-init' && <><div className="modal-copy"><span className="large-icon"><FolderOpen size={23} /></span><p>系统将在这个文件夹中创建项目配置、素材数据和生成结果：</p><code>{pendingFolder}</code><small>一个项目建议只对应一个业务，后续可以反复生成多篇文案。</small></div><div className="modal-actions"><button className="secondary" onClick={close}>取消</button><button className="primary" onClick={initialize} disabled={!!busy}>{busy === 'initialize' && <LoaderCircle className="spin" size={17} />}确认创建</button></div></>}{(modal === 'keywords' || modal === 'rules' || modal === 'references') && <><div className="form-stack">{form.id && <div className="immutable-id"><span>系统编号</span><code>{form.id}</code></div>}{modal === 'keywords' && <><label className="field"><span>关键词</span><input autoFocus value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} placeholder="输入一个关键词" /></label><label className="field"><span>备注 <small>可选</small></span><textarea rows={3} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></label></>}{modal === 'rules' && <><label className="field"><span>准则内容</span><textarea autoFocus rows={5} value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} placeholder="一条完整、可执行的合规要求" /></label><label className="field"><span>备注 <small>可选</small></span><textarea rows={3} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></label></>}{modal === 'references' && <><label className="field"><span>标题</span><input autoFocus value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></label><label className="field"><span>完整正文</span><textarea rows={8} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} /></label><div className="form-grid"><label className="field"><span>作者 / 账号 <small>可选</small></span><input value={form.author} onChange={(e) => setForm({ ...form, author: e.target.value })} /></label><label className="field"><span>内容类型 <small>可选</small></span><input value={form.contentType} onChange={(e) => setForm({ ...form, contentType: e.target.value })} /></label><label className="field"><span>表现数据 <small>可选</small></span><input value={form.performance} onChange={(e) => setForm({ ...form, performance: e.target.value })} /></label><label className="field"><span>备注 <small>可选</small></span><input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></label></div></>}</div><div className="modal-actions"><button className="secondary" onClick={close}>取消</button><button className="primary" onClick={saveAsset} disabled={!!busy}>{form.id ? '保存修改' : '新增记录'}</button></div></>}{error && <p className="modal-error">{error}</p>}</div></div>
}

function Toast({ error, notice, clear }: { error: string; notice: string; clear: () => void }) {
  if (!error && !notice) return null
  return <button className={`toast ${error ? 'error' : ''}`} onClick={clear}>{error ? <X size={17} /> : <Check size={17} />}<span>{error || notice}</span></button>
}

function formatTime(value: string) { return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) }

export default App
