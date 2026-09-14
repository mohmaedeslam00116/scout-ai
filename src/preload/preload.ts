import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('scout', {
  send: (text: string) => ipcRenderer.invoke('scout:send', text),
  abort: () => ipcRenderer.invoke('scout:abort'),
  state: () => ipcRenderer.invoke('scout:state'),
  onEvent: (cb: (payload: unknown) => void) => {
    const listener = (_e: unknown, payload: unknown) => cb(payload);
    ipcRenderer.on('scout:event', listener as never);
    return () => ipcRenderer.removeListener('scout:event', listener as never);
  },
});
