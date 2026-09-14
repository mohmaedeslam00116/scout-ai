import { contextBridge, ipcRenderer } from 'electron';

export type ScoutState = {
  busy: boolean;
  messages: { role: string; text: string }[];
  activity: { kind: string; text: string; ts: number }[];
};

contextBridge.exposeInMainWorld('scout', {
  send: (text: string) => ipcRenderer.invoke('scout:send', text),
  abort: () => ipcRenderer.invoke('scout:abort'),
  state: (): Promise<ScoutState> => ipcRenderer.invoke('scout:state'),
  onEvent: (cb: (payload: unknown) => void) => {
    const listener = (_e: unknown, payload: unknown) => cb(payload);
    ipcRenderer.on('scout:event', listener as never);
    return () => ipcRenderer.removeListener('scout:event', listener as never);
  },
});
