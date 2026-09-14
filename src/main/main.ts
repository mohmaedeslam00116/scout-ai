import { app, BrowserWindow, ipcMain } from 'electron';
import * as path from 'node:path';
import { bootstrapAgentDir } from './bootstrap.ts';
import { AgentHost, piSessionFactory } from './agentHost.ts';
import { scoutPaths } from './paths.ts';

let win: BrowserWindow | null = null;
let host: AgentHost | null = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    backgroundColor: '#000000',
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

app.whenReady().then(() => {
  // ADR-0003: Scout keeps its own pi agentDir under userData; one-time auth
  // import reuses the user's existing provider logins, then stays decoupled.
  const paths = scoutPaths(app.getPath('userData'));
  const boot = bootstrapAgentDir(paths.agentDir);
  if (boot.imported.length > 0) {
    console.log(`[scout] imported ${boot.imported.join(', ')} from global pi`);
  }

  host = new AgentHost(
    {
      emit: (channel, payload) => {
        if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
      },
    },
    piSessionFactory(paths.agentDir),
  );

  ipcMain.handle('scout:send', (_e, text: string) => host?.send(text));
  ipcMain.handle('scout:abort', () => host?.abort());
  ipcMain.handle('scout:state', () => host?.snapshot());

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  host?.dispose();
  if (process.platform !== 'darwin') app.quit();
});
