import { useEffect, useMemo, useState } from 'react'
import {
  Archive, ArrowRight, BookOpenText, Check, CheckCircle2, ChevronRight, Circle,
  FileText, FolderOpen, KeyRound, LoaderCircle, Menu, PenLine, Plus, RefreshCw,
  Scale, Settings, Sparkles, Trash2, WandSparkles, X,
} from 'lucide-react'

const stages = [
  ['01', '创建项目', '选择并初始化本地文件夹'],
  ['02', '管理资料', '素材与项目资产'],
  ['03', '形成事实', '提取并确认业务事实'],
  ['04', '策略候选', '生成 3–5 个方向'],
  ['05', '选择策略', '单选并补充建议'],
  ['06', '生成终稿', '按选定策略写作'],
  ['07', '人工确认', '修改或确认输出'],
] as const

const emptyForms = {
  keywords: { id: '', value: '', note: '' },
  rules: { id: '', content: '', note: '' },
  references: { id: '', title: '', body: '', author: '', contentType: '', performance: '', note: '' },
}

type Modal = 'settings' | 'project-init' | AssetKind | null

function App() {
  const [project, setProject] = useState<ProjectData | null>(null)
  const [recent, setRecent] = useState<string[]>([])
  const [stage, setStage] = useState(1)
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

  const complete = useMemo(() => ({
    1: !!project,
    2: !!project?.material.exists,
    3: !!project?.facts && project.facts.conflicts.length === 0,
    4: (project?.strategies.length || 0) >= 3,
    5: !!project?.selectedStrategyId,
    6: !!project?.currentDraft,
    7: !!project?.currentDraft?.confirmed,
  }), [project])

  function showError(message?: string) {
    if (message) setError(message)
  }
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
      setProject(result.data); setStage(1); setRecent(await window.workshop.getRecentProjects())
    } else if (result.folder) {
      setPendingFolder(result.folder); setModal('project-init')
    }
  }
  async function initialize() {
    const ok = await run('initialize', () => window.workshop.initializeProject(pendingFolder), '项目已初始化')
    if (ok) { setModal(null); setStage(2); setRecent(await window.workshop.getRecentProjects()) }
  }
  async function openRecent(folder: string) {
    const ok = await run('open', () => window.workshop.openRecentProject(folder))
    if (ok) setStage(1)
  }
  async function importMaterial() {
    await run('material', () => window.workshop.importMaterial(), '业务原始素材已保存到项目')
  }
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
    const ok = await run('settings', () => window.workshop.saveSettings(settings), '模型设置已保存')
    if (ok) setModal(null)
  }

  if (!project) return (
    <div className="welcome-shell">
      <div className="drag-region" />
      <main className="welcome">
        <div className="welcome-brand"><span className="brand-stamp">小</span><span>小红书运营自动化工坊</span></div>
        <div className="welcome-copy">
          <p className="kicker">本地项目 · 七步成稿</p>
          <h1>把散落的业务资料，<br />变成一篇有依据的文案。</h1>
          <p>每个业务一个文件夹。素材、事实、策略和每次修改都保存在你自己的电脑里。</p>
          <button className="primary large" onClick={chooseFolder}><FolderOpen size={19} />选择项目文件夹</button>
        </div>
        <div className="process-ruler" aria-label="七步流程">
          {stages.map(([number, name]) => <div key={number}><span>{number}</span><b>{name}</b></div>)}
        </div>
        {recent.length > 0 && <section className="recent-projects">
          <h2>最近项目</h2>
          {recent.map((folder) => <button key={folder} onClick={() => openRecent(folder)}><FolderOpen size={16} /><span><b>{folder.split('/').pop()}</b><small>{folder}</small></span><ChevronRight size={17} /></button>)}
        </section>}
        <button className="icon-button welcome-settings" title="模型设置" onClick={() => setModal('settings')}><Settings size={19} /></button>
      </main>
      <Overlays {...{ modal, setModal, pendingFolder, initialize, busy, settings, setSettings, saveSettings, error, setError, assetTab, form, setForm, saveAsset }} />
      <Toast error={error} notice={notice} clear={() => setError('')} />
    </div>
  )

  const viewedDraft = project.drafts.find((item) => item.version === viewVersion) || project.currentDraft
  const selectedStrategy = project.strategies.find((item) => item.id === project.selectedStrategyId)

  return (
    <div className="app-shell">
      <div className="drag-region" />
      <aside className="sidebar">
        <div className="brand"><span className="brand-stamp">小</span><div><b>运营自动化工坊</b><small>LOCAL WORKSPACE</small></div></div>
        <button className="project-switcher" onClick={chooseFolder} title="切换项目">
          <FolderOpen size={16} /><span><b>{project.meta.name}</b><small>{project.meta.root}</small></span><ChevronRight size={16} />
        </button>
        <nav>
          {stages.map(([number, name, description], index) => {
            const n = index + 1
            return <button key={number} className={stage === n ? 'active' : ''} onClick={() => setStage(n)}>
              <span className={`step-mark ${complete[n as keyof typeof complete] ? 'done' : ''}`}>{complete[n as keyof typeof complete] ? <Check size={13} /> : number}</span>
              <span><b>{name}</b><small>{description}</small></span>
            </button>
          })}
        </nav>
        <div className="sidebar-bottom">
          <button onClick={() => setModal('settings')}><Settings size={17} />模型设置</button>
          <span>所有项目数据保存在本地</span>
        </div>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div><span>节点 {String(stage).padStart(2, '0')}</span><strong>{stages[stage - 1][1]}</strong></div>
          <div className="status-pill"><span className={complete[stage as keyof typeof complete] ? 'ok-dot' : ''} />{complete[stage as keyof typeof complete] ? '已完成' : '进行中'}</div>
        </header>
        <div className="content">
          {stage === 1 && <ProjectStage project={project} chooseFolder={chooseFolder} next={() => setStage(2)} />}
          {stage === 2 && <AssetsStage project={project} tab={assetTab} setTab={setAssetTab} importMaterial={importMaterial} busy={busy} openAsset={openAsset} deleteAsset={deleteAsset} next={() => setStage(3)} />}
          {stage === 3 && <FactsStage project={project} busy={busy} resolution={resolution} setResolution={setResolution} generate={async () => {
            const ok = await run('facts', () => window.workshop.extractFacts(resolution), resolution ? '业务事实已重新生成' : '业务事实已提取')
            if (ok) setResolution('')
          }} next={() => setStage(4)} />}
          {stage === 4 && <StrategiesStage project={project} busy={busy} generate={() => run('strategies', () => window.workshop.generateStrategies(), '策略候选已生成')} next={() => setStage(5)} />}
          {stage === 5 && <SelectStage project={project} choice={choice} setChoice={setChoice} advice={advice} setAdvice={setAdvice} busy={busy} save={async () => {
            if (!choice) { setError('请先选择一个策略'); return }
            const ok = await run('select', () => window.workshop.selectStrategy(choice, advice), '策略与补充建议已保存')
            if (ok) setStage(6)
          }} />}
          {stage === 6 && <DraftStage project={project} strategy={selectedStrategy} busy={busy} generate={async () => {
            const ok = await run('draft', () => window.workshop.generateDraft(), '终稿已生成')
            if (ok) setStage(7)
          }} />}
          {stage === 7 && <ReviewStage project={project} draft={viewedDraft} viewVersion={viewVersion} setViewVersion={setViewVersion} revision={revision} setRevision={setRevision} busy={busy} revise={async () => {
            const ok = await run('revise', () => window.workshop.reviseDraft(revision), '新版本已生成')
            if (ok) setRevision('')
          }} confirm={() => run('confirm', () => window.workshop.confirmDraft(), '已确认并生成最终输出.md')} />}
        </div>
      </main>
      <Overlays {...{ modal, setModal, pendingFolder, initialize, busy, settings, setSettings, saveSettings, error, setError, assetTab, form, setForm, saveAsset }} />
      <Toast error={error} notice={notice} clear={() => setError('')} />
    </div>
  )
}

function PageIntro({ eyebrow, title, children, action }: { eyebrow: string; title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return <div className="page-intro"><div><span>{eyebrow}</span><h1>{title}</h1><p>{children}</p></div>{action}</div>
}
function NextButton({ children, onClick, disabled = false }: { children: React.ReactNode; onClick: () => void; disabled?: boolean }) {
  return <button className="primary" disabled={disabled} onClick={onClick}>{children}<ArrowRight size={17} /></button>
}
function ProjectStage({ project, chooseFolder, next }: { project: ProjectData; chooseFolder: () => void; next: () => void }) {
  return <>
    <PageIntro eyebrow="项目容器" title="这个业务有了自己的工作台">不同业务的数据彼此隔离。你可以随时从同一个文件夹继续。</PageIntro>
    <section className="project-ticket">
      <div className="ticket-number">01</div>
      <div><span>项目名称</span><h2>{project.meta.name}</h2><code>{project.meta.root}</code></div>
      <dl><div><dt>创建时间</dt><dd>{formatTime(project.meta.createdAt)}</dd></div><div><dt>存储方式</dt><dd>本地文件夹</dd></div><div><dt>状态</dt><dd><CheckCircle2 size={15} />可读写</dd></div></dl>
    </section>
    <div className="action-row"><button className="secondary" onClick={chooseFolder}><FolderOpen size={17} />切换项目</button><NextButton onClick={next}>管理输入资料</NextButton></div>
  </>
}

function AssetsStage({ project, tab, setTab, importMaterial, busy, openAsset, deleteAsset, next }: {
  project: ProjectData; tab: AssetKind; setTab: (v: AssetKind) => void; importMaterial: () => void; busy: string;
  openAsset: (kind: AssetKind, item?: Keyword | Rule | Reference) => void; deleteAsset: (kind: AssetKind, id: string) => void; next: () => void
}) {
  const items = project[tab]
  const labels = { keywords: ['关键词库', '关键词'], references: ['高表现参考文案', '参考文案'], rules: ['合规性准则', '准则'] }
  return <>
    <PageIntro eyebrow="项目资产" title="把生成依据整理在这里">原始素材是必需输入；其余三类资产可逐条积累，没有记录也不会阻断后续流程。</PageIntro>
    <section className={`material-drop ${project.material.exists ? 'loaded' : ''}`}>
      <div className="file-icon"><FileText size={25} /></div>
      <div>{project.material.exists ? <><h3>业务原始素材.md</h3><p>{project.material.content.length.toLocaleString()} 个字符 · 已保存到当前项目</p></> : <><h3>导入业务原始素材.md</h3><p>请先将 PDF 和图片完整转换成 Markdown</p></>}</div>
      <button className="secondary" onClick={importMaterial} disabled={!!busy}>{busy === 'material' ? <LoaderCircle className="spin" size={17} /> : <FileText size={17} />}{project.material.exists ? '重新导入' : '选择文件'}</button>
    </section>
    <section className="asset-panel">
      <div className="asset-tabs">
        {(Object.keys(labels) as AssetKind[]).map((key) => <button key={key} className={tab === key ? 'active' : ''} onClick={() => setTab(key)}>{labels[key][0]}<span>{project[key].length}</span></button>)}
      </div>
      <div className="asset-toolbar"><p>{labels[tab][0]}保存在项目中，系统编号不会因修改或排序变化。</p><button className="primary small" onClick={() => openAsset(tab)}><Plus size={16} />新增{labels[tab][1]}</button></div>
      {items.length === 0 ? <div className="empty-state"><Archive size={28} /><h3>还没有{labels[tab][0]}</h3><p>可以暂时留空，后续生成时将不使用这类增强内容。</p></div> : <div className="asset-list">
        {items.map((item) => <AssetRow key={item.id} kind={tab} item={item} edit={() => openAsset(tab, item)} remove={() => deleteAsset(tab, item.id)} />)}
      </div>}
    </section>
    <div className="action-row right"><NextButton onClick={next} disabled={!project.material.exists}>提取业务事实</NextButton></div>
  </>
}

function AssetRow({ kind, item, edit, remove }: { kind: AssetKind; item: Keyword | Rule | Reference; edit: () => void; remove: () => void }) {
  const title = kind === 'keywords' ? (item as Keyword).value : kind === 'rules' ? (item as Rule).content : (item as Reference).title
  const subtitle = kind === 'references' ? (item as Reference).body : item.note
  return <div className="asset-row"><code>{item.id}</code><div><b>{title}</b>{subtitle && <p>{subtitle}</p>}</div><button title="编辑" onClick={edit}><PenLine size={16} /></button><button title="删除" onClick={remove}><Trash2 size={16} /></button></div>
}

function FactsStage({ project, busy, resolution, setResolution, generate, next }: { project: ProjectData; busy: string; resolution: string; setResolution: (v: string) => void; generate: () => void; next: () => void }) {
  const conflicts = project.facts?.conflicts || []
  return <>
    <PageIntro eyebrow="第一阶段模型调用" title="先让事实站稳，再开始写">模型只提取素材实际包含的内容，不会用固定字段制造“信息缺失”。</PageIntro>
    {!project.facts && <section className="call-card"><div className="call-visual"><BookOpenText size={31} /></div><div><h2>从原始素材提取业务事实</h2><p>归类、去重，并区分可确认事实、宣传性表达和冲突口径。</p></div><button className="primary" onClick={generate} disabled={!!busy}>{busy === 'facts' ? <LoaderCircle className="spin" size={17} /> : <WandSparkles size={17} />}开始提取</button></section>}
    {project.facts && conflicts.length > 0 && <section className="conflict-box"><div className="conflict-title"><Scale size={21} /><div><h2>发现 {conflicts.length} 处口径冲突</h2><p>后续流程已暂停。请确认以哪个口径为准。</p></div></div>{conflicts.map((item, i) => <div className="conflict-item" key={`${item.topic}-${i}`}><span>{item.topic}</span><h3>{item.question}</h3><ul>{item.versions.map((version) => <li key={version}>{version}</li>)}</ul></div>)}<label className="field"><span>你的统一口径</span><textarea value={resolution} onChange={(e) => setResolution(e.target.value)} placeholder="逐条说明应采用的标准口径…" rows={5} /></label><button className="primary" onClick={generate} disabled={!resolution.trim() || !!busy}>{busy === 'facts' ? <LoaderCircle className="spin" size={17} /> : <RefreshCw size={17} />}按确认口径重新生成</button></section>}
    {project.facts && conflicts.length === 0 && <><section className="facts-board"><div className="board-head"><div><CheckCircle2 size={20} /><h2>完整业务事实</h2></div><button className="text-button" onClick={generate} disabled={!!busy}><RefreshCw size={15} />重新提取</button></div><div className="fact-groups">{project.facts.confirmedFacts.map((group, index) => <article key={`${group.category}-${index}`}><span>{group.category}</span><ul>{group.items.map((item) => <li key={item}>{item}</li>)}</ul></article>)}</div>{project.facts.promotionalExpressions.length > 0 && <div className="promo-lines"><span>宣传性表达（不作为事实）</span>{project.facts.promotionalExpressions.map((item) => <p key={item}>{item}</p>)}</div>}</section><div className="action-row right"><NextButton onClick={next}>生成策略候选</NextButton></div></>}
  </>
}

function StrategiesStage({ project, busy, generate, next }: { project: ProjectData; busy: string; generate: () => void; next: () => void }) {
  return <>
    <PageIntro eyebrow="第二阶段模型调用" title="用同一份事实，找不同的写法">一次读取现有项目资产，给出 3–5 个彼此明显不同的简要策略。</PageIntro>
    {project.strategies.length === 0 ? <section className="call-card"><div className="call-visual red"><Sparkles size={31} /></div><div><h2>生成策略候选</h2><p>关键词 {project.keywords.length} 条 · 参考文案 {project.references.length} 篇 · 合规准则 {project.rules.length} 条</p></div><button className="primary" onClick={generate} disabled={!!busy}>{busy === 'strategies' ? <LoaderCircle className="spin" size={17} /> : <WandSparkles size={17} />}生成候选</button></section> : <><div className="strategy-heading"><p>共 {project.strategies.length} 个候选方向</p><button className="text-button" onClick={generate} disabled={!!busy}><RefreshCw size={15} />重新生成</button></div><div className="strategy-grid">{project.strategies.map((strategy) => <StrategyCard key={strategy.id} strategy={strategy} project={project} />)}</div><div className="action-row right"><NextButton onClick={next}>选择一个策略</NextButton></div></>}
  </>
}

function StrategyCard({ strategy, project, selectable, selected, onSelect }: { strategy: Strategy; project: ProjectData; selectable?: boolean; selected?: boolean; onSelect?: () => void }) {
  const refs = strategy.referenceIds.map((id) => project.references.find((r) => r.id === id)).filter(Boolean) as Reference[]
  return <article className={`strategy-card ${selectable ? 'selectable' : ''} ${selected ? 'selected' : ''}`} onClick={onSelect}>
    <div className="strategy-top"><code>{strategy.id}</code>{selectable && <span className="radio">{selected ? <Check size={13} /> : null}</span>}</div>
    <h2>{strategy.name}</h2><p className="angle">{strategy.angle}</p>
    <dl><div><dt>素材点</dt><dd>{strategy.materialPoints.join(' / ') || '—'}</dd></div><div><dt>写作路线</dt><dd>{strategy.route}</dd></div><div><dt>参考文案</dt><dd>{refs.length ? refs.map((r) => `${r.id} ${r.title}`).join('；') : '无指定参考文案'}</dd></div><div><dt>最适合</dt><dd>{strategy.bestFor}</dd></div></dl>
  </article>
}

function SelectStage({ project, choice, setChoice, advice, setAdvice, busy, save }: { project: ProjectData; choice: string; setChoice: (v: string) => void; advice: string; setAdvice: (v: string) => void; busy: string; save: () => void }) {
  return <>
    <PageIntro eyebrow="人工决策" title="只选一条清晰的内容主线">策略不自动合并。额外建议会在不破坏主线的前提下带入终稿。</PageIntro>
    {project.strategies.length === 0 ? <Gate message="还没有策略候选" target="请返回节点 04 生成策略。" /> : <><div className="strategy-grid select-grid">{project.strategies.map((strategy) => <StrategyCard key={strategy.id} strategy={strategy} project={project} selectable selected={choice === strategy.id} onSelect={() => setChoice(strategy.id)} />)}</div><section className="advice-box"><label className="field"><span>补充建议 <small>可选</small></span><textarea rows={5} value={advice} onChange={(e) => setAdvice(e.target.value)} placeholder="例如：更关注新手人群；语气克制；必须写明预约方式；不要提低价…" /></label></section><div className="action-row right"><button className="primary" onClick={save} disabled={!choice || !!busy}>{busy === 'select' ? <LoaderCircle className="spin" size={17} /> : <Check size={17} />}确认这个策略</button></div></>}
  </>
}

function DraftStage({ project, strategy, busy, generate }: { project: ProjectData; strategy?: Strategy; busy: string; generate: () => void }) {
  return <>
    <PageIntro eyebrow="第三阶段模型调用" title="按选定策略，直接生成终稿">只读取策略指定的参考文案，并严格使用已确认的业务事实。</PageIntro>
    {!strategy ? <Gate message="尚未选定策略" target="请在节点 05 单选一个策略并确认。" /> : <section className="generation-sheet"><div className="sheet-label">本次生成单</div><h2>{strategy.name}</h2><p>{strategy.angle}</p><div className="generation-inputs"><div><span>业务事实</span><b>{project.facts?.confirmedFacts.reduce((sum, group) => sum + group.items.length, 0) || 0} 条</b></div><div><span>关键词</span><b>{project.keywords.length} 条</b></div><div><span>合规准则</span><b>{project.rules.length} 条</b></div><div><span>指定参考</span><b>{strategy.referenceIds.length} 篇</b></div></div>{project.advice && <blockquote><span>补充建议</span>{project.advice}</blockquote>}<button className="primary large" onClick={generate} disabled={!!busy}>{busy === 'draft' ? <LoaderCircle className="spin" size={18} /> : <WandSparkles size={18} />}{project.currentDraft ? '重新生成新版本' : '生成标题、正文和话题标签'}</button></section>}
  </>
}

function ReviewStage({ project, draft, viewVersion, setViewVersion, revision, setRevision, busy, revise, confirm }: { project: ProjectData; draft: Draft | null; viewVersion: number | null; setViewVersion: (v: number) => void; revision: string; setRevision: (v: string) => void; busy: string; revise: () => void; confirm: () => void }) {
  if (!draft) return <><PageIntro eyebrow="人工确认" title="确认之前，文案不会成为最终输出">你可以提出新的文本要求，每次修改都会保留一个版本。</PageIntro><Gate message="还没有生成终稿" target="请先在节点 06 生成。" /></>
  const isCurrent = draft.version === project.currentDraft?.version
  return <>
    <PageIntro eyebrow="人工确认" title="最后决定权留给你">检查标题、正文和话题标签；确认后会在项目文件夹生成“最终输出.md”。</PageIntro>
    <div className="review-layout">
      <section className="draft-paper">
        <div className="draft-meta"><span>版本 V{draft.version}</span><span>{formatTime(draft.createdAt)}</span>{draft.confirmed && <b><CheckCircle2 size={14} />已确认</b>}</div>
        <h1>{draft.title}</h1><div className="draft-body">{draft.body.split('\n').map((line, i) => <p key={i}>{line || '\u00a0'}</p>)}</div><div className="hashtags">{draft.hashtags.map((tag) => <span key={tag}>#{tag}</span>)}</div>
      </section>
      <aside className="revision-panel">
        <div><h3>版本记录</h3><div className="version-list">{[...project.drafts].reverse().map((item) => <button key={item.version} className={viewVersion === item.version ? 'active' : ''} onClick={() => setViewVersion(item.version)}><span>V{item.version}</span><small>{item.revisionRequest || (item.version === 1 ? '首次生成' : '重新生成')}</small>{item.confirmed && <CheckCircle2 size={14} />}</button>)}</div></div>
        {isCurrent && !draft.confirmed && <div className="revision-form"><label className="field"><span>提出修改要求</span><textarea rows={6} value={revision} onChange={(e) => setRevision(e.target.value)} placeholder="例如：标题更直接；删掉第二段；语气再克制一点…" /></label><button className="secondary full" onClick={revise} disabled={!revision.trim() || !!busy}>{busy === 'revise' ? <LoaderCircle className="spin" size={17} /> : <RefreshCw size={17} />}生成修改版本</button><button className="primary full" onClick={confirm} disabled={!!busy}><Check size={17} />确认当前版本</button></div>}
        {!isCurrent && <p className="history-note">正在查看历史版本。返回最新版本后可以继续修改或确认。</p>}
        {draft.confirmed && <div className="confirmed-note"><CheckCircle2 size={22} /><b>最终输出已保存</b><p>文件位于项目的“生成结果”文件夹。</p></div>}
      </aside>
    </div>
  </>
}

function Gate({ message, target }: { message: string; target: string }) { return <div className="gate"><Circle size={24} /><h2>{message}</h2><p>{target}</p></div> }

function Overlays({ modal, setModal, pendingFolder, initialize, busy, settings, setSettings, saveSettings, error, setError, assetTab, form, setForm, saveAsset }: {
  modal: Modal; setModal: (m: Modal) => void; pendingFolder: string; initialize: () => void; busy: string;
  settings: ModelSettings; setSettings: (s: ModelSettings) => void; saveSettings: () => void; error: string; setError: (v: string) => void;
  assetTab: AssetKind; form: Record<string, string>; setForm: (v: Record<string, string>) => void; saveAsset: () => void
}) {
  if (!modal) return null
  const close = () => { setModal(null); setError('') }
  return <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) close() }}><div className="modal">
    <div className="modal-head"><div><span>{modal === 'settings' ? '连接配置' : modal === 'project-init' ? '新项目' : form.id ? '编辑记录' : '新增记录'}</span><h2>{modal === 'settings' ? '模型设置' : modal === 'project-init' ? '初始化项目文件夹' : assetTab === 'keywords' ? '关键词' : assetTab === 'rules' ? '合规准则' : '高表现参考文案'}</h2></div><button onClick={close}><X size={20} /></button></div>
    {modal === 'project-init' && <><div className="modal-copy"><FolderOpen size={24} /><p>系统将在这个文件夹内创建项目配置、数据文件和生成结果：</p><code>{pendingFolder}</code><small>请确认该文件夹用于当前这一个业务。</small></div><div className="modal-actions"><button className="secondary" onClick={close}>取消</button><button className="primary" onClick={initialize} disabled={!!busy}>{busy === 'initialize' && <LoaderCircle className="spin" size={17} />}确认并初始化</button></div></>}
    {modal === 'settings' && <><div className="form-stack"><label className="field"><span>OpenAI 兼容接口地址</span><input value={settings.baseUrl} onChange={(e) => setSettings({ ...settings, baseUrl: e.target.value })} placeholder="https://api.openai.com/v1" /></label><label className="field"><span>API Key</span><input type="password" value={settings.apiKey} onChange={(e) => setSettings({ ...settings, apiKey: e.target.value })} placeholder="sk-…" /></label><label className="field"><span>模型名称</span><input value={settings.model} onChange={(e) => setSettings({ ...settings, model: e.target.value })} placeholder="例如 gpt-5-mini" /></label><p className="form-hint"><KeyRound size={15} />配置保存在本机应用数据中，不写入业务项目文件夹。</p></div><div className="modal-actions"><button className="secondary" onClick={close}>取消</button><button className="primary" onClick={saveSettings} disabled={!!busy}>保存设置</button></div></>}
    {(modal === 'keywords' || modal === 'rules' || modal === 'references') && <><div className="form-stack">{form.id && <div className="immutable-id"><span>系统编号</span><code>{form.id}</code></div>}{modal === 'keywords' && <><label className="field"><span>关键词</span><input autoFocus value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} placeholder="输入一个关键词" /></label><label className="field"><span>备注 <small>可选</small></span><textarea rows={3} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></label></>}{modal === 'rules' && <><label className="field"><span>准则内容</span><textarea autoFocus rows={5} value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} placeholder="一条完整、可执行的合规要求" /></label><label className="field"><span>备注 <small>可选</small></span><textarea rows={3} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></label></>}{modal === 'references' && <><label className="field"><span>标题</span><input autoFocus value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></label><label className="field"><span>完整正文</span><textarea rows={8} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} /></label><div className="form-grid"><label className="field"><span>作者 / 账号 <small>可选</small></span><input value={form.author} onChange={(e) => setForm({ ...form, author: e.target.value })} /></label><label className="field"><span>内容类型 <small>可选</small></span><input value={form.contentType} onChange={(e) => setForm({ ...form, contentType: e.target.value })} /></label><label className="field"><span>表现数据 <small>可选</small></span><input value={form.performance} onChange={(e) => setForm({ ...form, performance: e.target.value })} /></label><label className="field"><span>备注 <small>可选</small></span><input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></label></div></>}</div><div className="modal-actions"><button className="secondary" onClick={close}>取消</button><button className="primary" onClick={saveAsset} disabled={!!busy}>{form.id ? '保存修改' : '新增记录'}</button></div></>}
    {error && <p className="modal-error">{error}</p>}
  </div></div>
}

function Toast({ error, notice, clear }: { error: string; notice: string; clear: () => void }) {
  if (!error && !notice) return null
  return <div className={`toast ${error ? 'error' : ''}`} onClick={clear}>{error ? <X size={17} /> : <Check size={17} />}<span>{error || notice}</span></div>
}
function formatTime(value: string) { return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) }

export default App
