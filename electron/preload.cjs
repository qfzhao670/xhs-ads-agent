const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('workshop', {
  chooseProjectFolder: () => ipcRenderer.invoke('project:choose'),
  initializeProject: (folder) => ipcRenderer.invoke('project:initialize', folder),
  openRecentProject: (folder) => ipcRenderer.invoke('project:open', folder),
  getRecentProjects: () => ipcRenderer.invoke('project:recent'),
  importMaterial: () => ipcRenderer.invoke('material:import'),
  getProject: () => ipcRenderer.invoke('project:get'),
  saveAsset: (kind, value) => ipcRenderer.invoke('asset:save', kind, value),
  deleteAsset: (kind, id) => ipcRenderer.invoke('asset:delete', kind, id),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (settings) => ipcRenderer.invoke('settings:save', settings),
  extractFacts: (resolution) => ipcRenderer.invoke('workflow:facts', resolution),
  generateStrategies: () => ipcRenderer.invoke('workflow:strategies'),
  selectStrategy: (id, advice) => ipcRenderer.invoke('workflow:select', { id, advice }),
  startNewGeneration: () => ipcRenderer.invoke('workflow:new'),
  generateDraft: () => ipcRenderer.invoke('workflow:draft'),
  reviseDraft: (request) => ipcRenderer.invoke('workflow:revise', request),
  confirmDraft: () => ipcRenderer.invoke('workflow:confirm'),
})
