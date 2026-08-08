import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  getApiPort: (): Promise<number> => ipcRenderer.invoke('get-api-port'),
})
