import { app, BrowserWindow, ipcMain } from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { bootstrapAgentDir } from './bootstrap.ts';
import { AgentHost, piSessionFactory } from './agentHost.ts';
import { ProjectService } from './projectService.ts';
import { scoutPaths } from './paths.ts';
import type { ScoutSendTarget } from '../types/shared.ts';

let win: BrowserWindow | null = null;
let host: AgentHost | null = null;
let projects: ProjectService | null = null;

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

app.whenReady().then(async () => {
  // ADR-0003: Scout keeps its own pi agentDir under userData; one-time auth
  // import reuses the user's existing provider logins, then stays decoupled.
  const paths = scoutPaths(app.getPath('userData'));
  const boot = bootstrapAgentDir(paths.agentDir);
  if (boot.imported.length > 0) {
    console.log(`[scout] imported ${boot.imported.join(', ')} from global pi`);
  }

  host = new AgentHost(
    {
      emit: (_channel, payload) => {
        // 'scout:event' is the literal event contract (see ipcContract test).
        if (win && !win.isDestroyed()) win.webContents.send('scout:event', payload);
      },
    },
    piSessionFactory(paths.agentDir),
    {
      // Scratch-first (decision #16 §7): sends without a target land in the
      // scratch conversation context.
      scratch: { cwd: paths.scratchHome, sessionDir: paths.scratchSessions },
    },
  );
  projects = new ProjectService(paths, host);

  // Scratch layout exists from first launch (decision #16 §3).
  for (const dir of [paths.scratchSessions, paths.scratchArtifacts, paths.scratchRuns, paths.scratchHome]) {
    fs.mkdirSync(dir, { recursive: true });
  }

  ipcMain.handle('scout:send', (_e, text: string, target?: ScoutSendTarget) => {
    if (!host || !projects) return;
    const resolved = resolveTarget(target);
    return host.send(text, resolved);
  });
  ipcMain.handle('scout:abort', () => host?.abort());
  ipcMain.handle('scout:state', () => host?.snapshot());

  ipcMain.handle('scout:projects:list', () => projects?.list());
  ipcMain.handle('scout:projects:create', (_e, name: string, folders: string[]) =>
    projects?.create(name, folders ?? []),
  );
  ipcMain.handle('scout:projects:open', (_e, projectId: string) => projects?.open(projectId));
  ipcMain.handle('scout:projects:patch', (_e, projectId: string, patch: unknown) =>
    projects?.patchSettings(projectId, patch as Parameters<ProjectService['patchSettings']>[1]),
  );
  ipcMain.handle('scout:projects:delete', (_e, projectId: string) => projects?.remove(projectId));
  ipcMain.handle('scout:projects:conversations', (_e, projectId: string) =>
    projects?.conversations(projectId),
  );
  ipcMain.handle('scout:scratch:conversations', () => projects?.scratchConversations());

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

/** Map a renderer target hint to a concrete send target. */
function resolveTarget(target?: ScoutSendTarget): { cwd: string; sessionDir?: string; fresh?: boolean } | undefined {
  if (!target || !projects) return undefined;
  const base =
    target.kind === 'scratch'
      ? projects.scratchTarget()
      : projects.sendTargetFor(target.projectId);
  return { ...base, ...(target.fresh ? { fresh: true } : {}) };
}

app.on('window-all-closed', () => {
  host?.dispose();
  if (process.platform !== 'darwin') app.quit();
});
