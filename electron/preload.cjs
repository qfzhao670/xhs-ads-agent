const { contextBridge, ipcRenderer, webUtils } = require('electron')

contextBridge.exposeInMainWorld('workshop', {
  showWindow: () => ipcRenderer.send('window:show'),
  chooseProjectFolder: () => ipcRenderer.invoke('project:choose'),
  initializeProject: (folder) => ipcRenderer.invoke('project:initialize', folder),
  openRecentProject: (folder) => ipcRenderer.invoke('project:open', folder),
  getRecentProjects: () => ipcRenderer.invoke('project:recent'),
  importMaterial: () => ipcRenderer.invoke('material:import'),
  selectMaterialFiles: () => ipcRenderer.invoke('material:select'),
  getPathForFile: (file) => webUtils.getPathForFile(file),
  extractMaterial: (filePaths) => ipcRenderer.invoke('material:extract', filePaths),
  exportMaterial: () => ipcRenderer.invoke('material:export'),
  getProject: () => ipcRenderer.invoke('project:get'),
  saveAsset: (kind, value) => ipcRenderer.invoke('asset:save', kind, value),
  deleteAsset: (kind, id) => ipcRenderer.invoke('asset:delete', kind, id),
  toggleAsset: (kind, id, enabled) => ipcRenderer.invoke('asset:toggle', kind, id, enabled),
  downloadAssetTemplate: (kind) => ipcRenderer.invoke('asset:template', kind),
  importAssetBatch: (kind) => ipcRenderer.invoke('asset:import', kind),
  exportAsset: (kind) => ipcRenderer.invoke('asset:export', kind),
  uploadImageReferences: (isCover) => ipcRenderer.invoke('image-reference:upload', isCover),
  importImageReferencePackage: () => ipcRenderer.invoke('image-reference:import-package'),
  exportImageReferencePackage: () => ipcRenderer.invoke('image-reference:export-package'),
  retagImageReference: (id) => ipcRenderer.invoke('image-reference:retag', id),
  setImageReferenceRole: (id, isCover) => ipcRenderer.invoke('image-reference:set-role', id, isCover),
  toggleImageReference: (id, enabled) => ipcRenderer.invoke('image-reference:toggle', id, enabled),
  deleteImageReference: (id) => ipcRenderer.invoke('image-reference:delete', id),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  readClipboardText: () => ipcRenderer.invoke('clipboard:read-text'),
  saveSettings: (settings) => ipcRenderer.invoke('settings:save', settings),
  extractFacts: (resolution, thinking) => ipcRenderer.invoke('workflow:facts', resolution, thinking),
  configureGeneration: (mode, userBriefRaw) => ipcRenderer.invoke('workflow:configure', { mode, userBriefRaw }),
  generateStrategies: (thinking) => ipcRenderer.invoke('workflow:strategies', thinking),
  selectStrategy: (ids, strategyAdvice) => ipcRenderer.invoke('workflow:select', { ids, strategyAdvice }),
  startNewGeneration: () => ipcRenderer.invoke('workflow:new'),
  deleteGeneration: (id) => ipcRenderer.invoke('generation:delete', id),
  generateDraft: (thinking) => ipcRenderer.invoke('workflow:draft', thinking),
  reviseDraft: (request, version, thinking) => ipcRenderer.invoke('workflow:revise', request, version, thinking),
  saveManualDraft: (draft) => ipcRenderer.invoke('workflow:manual-save', draft),
  confirmDraft: (version) => ipcRenderer.invoke('workflow:confirm', version),
  archiveFinal: (version, force) => ipcRenderer.invoke('workflow:archive-final', version, force),
  removeFinalContent: (id) => ipcRenderer.invoke('final-content:remove', id),
  createImageSet: (version) => ipcRenderer.invoke('image:create-set', version),
  regenerateImagePage: (taskId, pageId, feedback) => ipcRenderer.invoke('image:regenerate-page', taskId, pageId, feedback),
  readGeneratedImage: (relativePath) => ipcRenderer.invoke('image:read', relativePath),
  exportGeneratedImage: (taskId, imageId) => ipcRenderer.invoke('image:export', taskId, imageId),
  exportImageSet: (taskId) => ipcRenderer.invoke('image:export-set', taskId),
  onImageProgress: (callback) => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('image:progress', listener)
    return () => ipcRenderer.removeListener('image:progress', listener)
  },
  onImageReferenceProgress: (callback) => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('image-reference:progress', listener)
    return () => ipcRenderer.removeListener('image-reference:progress', listener)
  },
  onModelStream: (callback) => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('model:stream', listener)
    return () => ipcRenderer.removeListener('model:stream', listener)
  },
})
