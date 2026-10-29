/// <reference types="vite/client" />

interface Window {
  workshop: {
    showWindow(): void
    chooseProjectFolder(): Promise<ApiResult>
    initializeProject(folder: string): Promise<ApiResult>
    openRecentProject(folder: string): Promise<ApiResult>
    getRecentProjects(): Promise<string[]>
    importMaterial(): Promise<ApiResult>
    exportMaterial(): Promise<ApiResult>
    getProject(): Promise<ApiResult>
    saveAsset(kind: AssetKind, value: Record<string, string>): Promise<ApiResult>
    deleteAsset(kind: AssetKind, id: string): Promise<ApiResult>
    toggleAsset(kind: AssetKind, id: string, enabled: boolean): Promise<ApiResult>
    downloadAssetTemplate(kind: BatchAssetKind): Promise<ApiResult>
    importAssetBatch(kind: BatchAssetKind): Promise<ApiResult>
    exportAsset(kind: AssetKind): Promise<ApiResult>
    uploadImageReferences(isCover: boolean): Promise<ApiResult>
    importImageReferencePackage(): Promise<ApiResult>
    exportImageReferencePackage(): Promise<ApiResult>
    retagImageReference(id: string): Promise<ApiResult>
    setImageReferenceRole(id: string, isCover: boolean): Promise<ApiResult>
    toggleImageReference(id: string, enabled: boolean): Promise<ApiResult>
    deleteImageReference(id: string): Promise<ApiResult>
    getSettings(): Promise<ModelSettings>
    readClipboardText(): Promise<string>
    saveSettings(settings: ModelSettings): Promise<ApiResult>
    extractFacts(resolution: string | undefined, thinking: boolean): Promise<ApiResult>
    generateStrategies(thinking: boolean): Promise<ApiResult>
    selectStrategy(ids: string[], strategyAdvice: Record<string, string>): Promise<ApiResult>
    startNewGeneration(): Promise<ApiResult>
    generateDraft(thinking: boolean): Promise<ApiResult>
    reviseDraft(request: string, version: number, thinking: boolean): Promise<ApiResult>
    saveManualDraft(draft: { version: number; title: string; body: string; hashtags: string }): Promise<ApiResult>
    confirmDraft(version: number): Promise<ApiResult>
    createImageSet(version: number): Promise<ApiResult>
    regenerateImagePage(taskId: string, pageId: string, feedback: string): Promise<ApiResult>
    readGeneratedImage(relativePath: string): Promise<ApiResult>
    exportGeneratedImage(taskId: string, imageId: string): Promise<ApiResult>
    exportImageSet(taskId: string): Promise<ApiResult>
    onImageProgress(callback: (payload: ImageProgressEvent) => void): () => void
    onImageReferenceProgress(callback: (payload: ImageReferenceProgressEvent) => void): () => void
    onModelStream(callback: (payload: ModelStreamEvent) => void): () => void
  }
}

type AssetKind = 'keywords' | 'references' | 'rules'
type BatchAssetKind = AssetKind
type ApiResult = { ok: boolean; data?: ProjectData; error?: string; folder?: string; initialized?: boolean; imported?: number; exported?: number; skipped?: number; failed?: number; savedPath?: string; imageUrl?: string }
type ImageModelSettings = {
  enabled: boolean; protocol: 'dashscope' | 'openai'; baseUrl: string; apiKey: string; model: string; size: string; count: number;
  promptExtendMode: 'agent' | 'direct'; enableThinking: boolean; watermark: boolean
}
type ModelSettings = { baseUrl: string; apiKey: string; model: string; visionModel: string; image: ImageModelSettings }
type ModelStreamEvent = { operation: string; kind?: 'content' | 'thinking'; chunk: string; reset?: boolean; done?: boolean }
type ImageProgressEvent = {
  version: number; pageId?: string; phase: 'planning' | 'rewriting' | 'generating' | 'page-done' | 'done';
  current: number; total: number; label: string; task?: ImageTask
}
type ImageReferenceProgressEvent = {
  phase: 'added' | 'tagging' | 'item-done' | 'done'; current: number; total: number; label: string;
  references?: ImageReference[]; reference?: ImageReference
}

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
type ImageReferenceTags = {
  summary: string; visualMedium: 'photo' | 'mixed' | 'graphic'; sceneType: string; photographicElements: string[];
  useCases: string[]; visualStyle: string; composition: string; textLayout: string;
  colorPalette: string[]; keyElements: string[]; keywords: string[]; avoidCopying: string[]
}
type ImageReference = {
  id: string; originalName: string; relativePath: string; width: number; height: number; isCover: boolean;
  enabled: boolean; taggingStatus: 'pending' | 'ready' | 'failed'; taggingError: string; tags: ImageReferenceTags;
  createdAt: string; updatedAt: string
}
type Conflict = { topic: string; versions: string[]; question: string }
type Facts = { confirmedFacts: { category: string; items: string[] }[]; promotionalExpressions: string[]; conflicts: Conflict[]; generatedAt: string }
type Strategy = { id: string; name: string; angle: string; materialPoints: string[]; route: string; referenceIds: string[]; bestFor: string }
type Draft = { version: number; title: string; body: string; hashtags: string[]; strategyId: string; referenceIds: string[]; revisionRequest: string; createdAt: string; confirmed: boolean }
type ImageBrief = {
  purpose: string; coverTitle: string; subtitle: string; style: 'lifestyle' | 'event' | 'product' | 'guide' | 'editorial';
  visualMode: 'photoreal' | 'mixed' | 'graphic';
  subject: string; scene: string; composition: string; palette: string[]; mood: string;
  mustShow: string[]; mustAvoid: string[]; extraNotes: string;
  pageRole: 'cover' | 'content' | 'summary'; pageLabel: string; visualContinuity: string
}
type GeneratedImage = {
  id: string; relativePath: string; createdAt: string; model: string; size: string; seed: number;
  requestId: string; prompt: string; negativePrompt: string; pageId: string; revision: number; feedback: string; referenceImageIds: string[]
}
type ImagePlanPage = { id: string; role: 'cover' | 'content' | 'summary'; label: string; purpose: string; title: string; referenceImageIds: string[]; brief: ImageBrief }
type ImagePlan = { version: number; concept: string; visualContinuity: string; pages: ImagePlanPage[] }
type ImageTask = {
  id: string; generationId: string; strategyId: string; draftVersion: number; brief: ImageBrief;
  prompt: string; negativePrompt: string; artifactDir: string; images: GeneratedImage[];
  selectedImageId: string; currentImageIds: Record<string, string>; plan: ImagePlan; createdAt: string; updatedAt: string
}
type GenerationRecord = {
  id: string; createdAt: string; archivedAt: string; strategies: Strategy[];
  selectedStrategyIds?: string[]; selectedStrategyId: string; strategyAdvice?: Record<string, string>; advice: string; drafts: Draft[];
  material?: ProjectData['material']; keywords?: Keyword[]; references?: Reference[]; rules?: Rule[]; facts?: Facts | null
  imageTasks?: ImageTask[]
}
type ProjectData = {
  meta: { name: string; root: string; createdAt: string; updatedAt: string }
  material: { exists: boolean; name: string; content: string }
  keywords: Keyword[]; references: Reference[]; rules: Rule[]; imageReferences: ImageReference[]
  facts: Facts | null; strategies: Strategy[]; selectedStrategyIds: string[]; selectedStrategyId: string; strategyAdvice: Record<string, string>; advice: string
  drafts: Draft[]; currentDraft: Draft | null; imageTasks: ImageTask[]
  currentGeneration: { id: string; createdAt: string }
  generationHistory: GenerationRecord[]
}
