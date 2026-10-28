const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('workshop', {
  chooseProjectFolder: () => ipcRenderer.invoke('project:choose'),
  initializeProject: (folder) => ipcRenderer.invoke('project:initialize', folder),
  openRecentProject: (folder) => ipcRenderer.invoke('project:open', folder),
  getRecentProjects: () => ipcRenderer.invoke('project:recent'),
  importMaterial: () => ipcRenderer.invoke('material:import'),
  exportMaterial: () => ipcRenderer.invoke('material:export'),
  getProject: () => ipcRenderer.invoke('project:get'),
  saveAsset: (kind, value) => ipcRenderer.invoke('asset:save', kind, value),
  deleteAsset: (kind, id) => ipcRenderer.invoke('asset:delete', kind, id),
  toggleAsset: (kind, id, enabled) => ipcRenderer.invoke('asset:toggle', kind, id, enabled),
  downloadAssetTemplate: (kind) => ipcRenderer.invoke('asset:template', kind),
  importAssetBatch: (kind) => ipcRenderer.invoke('asset:import', kind),
  exportAsset: (kind) => ipcRenderer.invoke('asset:export', kind),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (settings) => ipcRenderer.invoke('settings:save', settings),
  extractFacts: (resolution, thinking) => ipcRenderer.invoke('workflow:facts', resolution, thinking),
  generateStrategies: (thinking) => ipcRenderer.invoke('workflow:strategies', thinking),
  selectStrategy: (ids, strategyAdvice) => ipcRenderer.invoke('workflow:select', { ids, strategyAdvice }),
  startNewGeneration: () => ipcRenderer.invoke('workflow:new'),
  generateDraft: (thinking) => ipcRenderer.invoke('workflow:draft', thinking),
  reviseDraft: (request, version, thinking) => ipcRenderer.invoke('workflow:revise', request, version, thinking),
  saveManualDraft: (draft) => ipcRenderer.invoke('workflow:manual-save', draft),
  confirmDraft: (version) => ipcRenderer.invoke('workflow:confirm', version),
  onModelStream: (callback) => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('model:stream', listener)
    return () => ipcRenderer.removeListener('model:stream', listener)
  },
})
