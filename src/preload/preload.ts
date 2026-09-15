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

  // Conversations (T02)
  restoreConversation: (projectId: string | null, sessionPath: string) =>
    ipcRenderer.invoke('scout:conversations:restore', projectId, sessionPath),
  renameConversation: (sessionPath: string, name: string) =>
    ipcRenderer.invoke('scout:conversations:rename', sessionPath, name),
  archiveConversation: (projectId: string | null, sessionPath: string, archived: boolean) =>
    ipcRenderer.invoke('scout:conversations:archive', projectId, sessionPath, archived),
  moveConversation: (sessionFileName: string, projectId: string) =>
    ipcRenderer.invoke('scout:conversations:move', sessionFileName, projectId),

  // Artifacts (T03)
  artifactsList: (projectId: string | null) => ipcRenderer.invoke('scout:artifacts:list', projectId),
  artifactsHydrate: (projectId: string | null, artifactId: string) =>
    ipcRenderer.invoke('scout:artifacts:hydrate', projectId, artifactId),
  artifactsApprove: (artifactId: string, comment?: string) =>
    ipcRenderer.invoke('scout:artifacts:approve', artifactId, comment),
  artifactsComment: (artifactId: string, text: string, steerText?: string) =>
    ipcRenderer.invoke('scout:artifacts:comment', artifactId, text, steerText),

  // Permissions (T04)
  resolvePermission: (id: string, verdict: 'allow' | 'deny') =>
    ipcRenderer.invoke('scout:permissions:resolve', id, verdict),
  widenPermissionScope: (target: unknown, action: unknown, scope: 'domain' | 'wildcard' | 'server') =>
    ipcRenderer.invoke('scout:permissions:scope', target, action, scope),
});
