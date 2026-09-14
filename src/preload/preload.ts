import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('scout', {
  send: (text: string, target?: unknown) => ipcRenderer.invoke('scout:send', text, target),
  abort: () => ipcRenderer.invoke('scout:abort'),
  state: () => ipcRenderer.invoke('scout:state'),
  onEvent: (cb: (payload: unknown) => void) => {
    const listener = (_e: unknown, payload: unknown) => cb(payload);
    ipcRenderer.on('scout:event', listener as never);
    return () => ipcRenderer.removeListener('scout:event', listener as never);
  },

  // Projects (decision #16 §4)
  projectsList: () => ipcRenderer.invoke('scout:projects:list'),
  projectsCreate: (name: string, folders: string[]) =>
    ipcRenderer.invoke('scout:projects:create', name, folders),
  projectsOpen: (projectId: string) => ipcRenderer.invoke('scout:projects:open', projectId),
  projectsPatch: (projectId: string, patch: unknown) =>
    ipcRenderer.invoke('scout:projects:patch', projectId, patch),
  projectsDelete: (projectId: string) => ipcRenderer.invoke('scout:projects:delete', projectId),
  projectConversations: (projectId: string) =>
    ipcRenderer.invoke('scout:projects:conversations', projectId),
  scratchConversations: () => ipcRenderer.invoke('scout:scratch:conversations'),
});
