/// <reference types="vite/client" />

interface Window {
  workshop: {
    chooseProjectFolder(): Promise<ApiResult>
    initializeProject(folder: string): Promise<ApiResult>
    openRecentProject(folder: string): Promise<ApiResult>
    getRecentProjects(): Promise<string[]>
    importMaterial(): Promise<ApiResult>
    getProject(): Promise<ApiResult>
    saveAsset(kind: AssetKind, value: Record<string, string>): Promise<ApiResult>
    deleteAsset(kind: AssetKind, id: string): Promise<ApiResult>
    toggleAsset(kind: AssetKind, id: string, enabled: boolean): Promise<ApiResult>
    downloadAssetTemplate(kind: BatchAssetKind): Promise<ApiResult>
    importAssetBatch(kind: BatchAssetKind): Promise<ApiResult>
    getSettings(): Promise<ModelSettings>
    saveSettings(settings: ModelSettings): Promise<ApiResult>
    extractFacts(resolution: string | undefined, thinking: boolean): Promise<ApiResult>
    generateStrategies(thinking: boolean): Promise<ApiResult>
    selectStrategy(ids: string[], strategyAdvice: Record<string, string>): Promise<ApiResult>
    startNewGeneration(): Promise<ApiResult>
    generateDraft(thinking: boolean): Promise<ApiResult>
    reviseDraft(request: string, version: number, thinking: boolean): Promise<ApiResult>
    saveManualDraft(draft: { version: number; title: string; body: string; hashtags: string }): Promise<ApiResult>
    confirmDraft(version: number): Promise<ApiResult>
    onModelStream(callback: (payload: ModelStreamEvent) => void): () => void
  }
}

type AssetKind = 'keywords' | 'references' | 'rules'
type BatchAssetKind = 'keywords' | 'rules'
type ApiResult = { ok: boolean; data?: ProjectData; error?: string; folder?: string; initialized?: boolean; imported?: number; savedPath?: string }
type ModelSettings = { baseUrl: string; apiKey: string; model: string }
type ModelStreamEvent = { operation: string; kind?: 'content' | 'thinking'; chunk: string; reset?: boolean; done?: boolean }

type Keyword = {
  id: string; category: string; root: string; partOfSpeech: string; intentTag: string;
  suggestedUse: string; enabled: boolean; createdAt: string; updatedAt: string
}
type Rule = {
  id: string; prohibited: string; riskType: string; basis: string; handling: string;
  replacement: string; enabled: boolean; createdAt: string; updatedAt: string
}
type Reference = {
  id: string; title: string; body: string; hashtags: string[]; enabled: boolean; createdAt: string; updatedAt: string
}
type Conflict = { topic: string; versions: string[]; question: string }
type Facts = { confirmedFacts: { category: string; items: string[] }[]; promotionalExpressions: string[]; conflicts: Conflict[]; generatedAt: string }
type Strategy = { id: string; name: string; angle: string; materialPoints: string[]; route: string; referenceIds: string[]; bestFor: string }
type Draft = { version: number; title: string; body: string; hashtags: string[]; strategyId: string; referenceIds: string[]; revisionRequest: string; createdAt: string; confirmed: boolean }
type GenerationRecord = {
  id: string; createdAt: string; archivedAt: string; strategies: Strategy[];
  selectedStrategyIds?: string[]; selectedStrategyId: string; strategyAdvice?: Record<string, string>; advice: string; drafts: Draft[];
  material?: ProjectData['material']; keywords?: Keyword[]; references?: Reference[]; rules?: Rule[]; facts?: Facts | null
}
type ProjectData = {
  meta: { name: string; root: string; createdAt: string; updatedAt: string }
  material: { exists: boolean; name: string; content: string }
  keywords: Keyword[]; references: Reference[]; rules: Rule[]
  facts: Facts | null; strategies: Strategy[]; selectedStrategyIds: string[]; selectedStrategyId: string; strategyAdvice: Record<string, string>; advice: string
  drafts: Draft[]; currentDraft: Draft | null
  currentGeneration: { id: string; createdAt: string }
  generationHistory: GenerationRecord[]
}
