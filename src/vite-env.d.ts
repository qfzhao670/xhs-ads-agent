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
    getSettings(): Promise<ModelSettings>
    saveSettings(settings: ModelSettings): Promise<ApiResult>
    extractFacts(resolution?: string): Promise<ApiResult>
    generateStrategies(): Promise<ApiResult>
    selectStrategy(id: string, advice: string): Promise<ApiResult>
    startNewGeneration(): Promise<ApiResult>
    generateDraft(): Promise<ApiResult>
    reviseDraft(request: string): Promise<ApiResult>
    confirmDraft(): Promise<ApiResult>
  }
}

type AssetKind = 'keywords' | 'references' | 'rules'
type ApiResult = { ok: boolean; data?: ProjectData; error?: string; folder?: string; initialized?: boolean }
type ModelSettings = { baseUrl: string; apiKey: string; model: string }

type Keyword = { id: string; value: string; note: string; createdAt: string; updatedAt: string }
type Rule = { id: string; content: string; note: string; createdAt: string; updatedAt: string }
type Reference = {
  id: string; title: string; body: string; author: string; contentType: string;
  performance: string; note: string; createdAt: string; updatedAt: string
}
type Conflict = { topic: string; versions: string[]; question: string }
type Facts = { confirmedFacts: { category: string; items: string[] }[]; promotionalExpressions: string[]; conflicts: Conflict[]; generatedAt: string }
type Strategy = { id: string; name: string; angle: string; materialPoints: string[]; route: string; referenceIds: string[]; bestFor: string }
type Draft = { version: number; title: string; body: string; hashtags: string[]; strategyId: string; referenceIds: string[]; revisionRequest: string; createdAt: string; confirmed: boolean }
type GenerationRecord = {
  id: string; createdAt: string; archivedAt: string; strategies: Strategy[];
  selectedStrategyId: string; advice: string; drafts: Draft[]
}
type ProjectData = {
  meta: { name: string; root: string; createdAt: string; updatedAt: string }
  material: { exists: boolean; name: string; content: string }
  keywords: Keyword[]; references: Reference[]; rules: Rule[]
  facts: Facts | null; strategies: Strategy[]; selectedStrategyId: string; advice: string
  drafts: Draft[]; currentDraft: Draft | null
  currentGeneration: { id: string; createdAt: string }
  generationHistory: GenerationRecord[]
}
