import { app, BrowserWindow, ipcMain } from 'electron';
import * as path from 'node:path';
import { AgentHost } from './agentHost.ts';

let win: BrowserWindow | null = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    backgroundColor: '#ffffff',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(import.meta.dirname, '../preload/preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  win.loadFile(path.join(import.meta.dirname, '../renderer/index.html'));
}

function createHost() {
  return new AgentHost({
    emit: (channel, payload) => {
      if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
    },
  });
}

app.whenReady().then(() => {
  const host = createHost();
  ipcMain.handle('scout:send', (_e, text: string) => host.send(text));
  ipcMain.handle('scout:abort', () => host.abort());
  ipcMain.handle('scout:state', () => host.snapshot());

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
