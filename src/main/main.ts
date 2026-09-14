import { app, BrowserWindow, ipcMain } from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { bootstrapAgentDir } from './bootstrap.ts';
import { AgentHost, piSessionFactory } from './agentHost.ts';
import { ProjectService } from './projectService.ts';
import { ArtifactStore } from './artifactStore.ts';
import { buildArtifactTool } from './agentHost.ts';
import type { ProceedController } from './proceedGate.ts';
import { scoutPaths } from './paths.ts';
import type { ScoutSendTarget } from '../types/shared.ts';

let win: BrowserWindow | null = null;
let host: AgentHost | null = null;
let projects: ProjectService | null = null;
let artifactStore: ArtifactStore | null = null;
/** Open Proceed gates by artifact id, resolved from the Approve IPC. */
const openGates = new Map<string, ProceedController>();

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

  artifactStore = new ArtifactStore({
    projectArtifacts: (id) => paths.projectArtifacts(id),
    scratchArtifacts: paths.scratchArtifacts,
  });

  /** Artifact tool deps per send target (decision #14 §tool). */
  const toolProvider = async (target: { cwd: string; sessionDir?: string }) => {
    if (!projects) return [];
    const isScratch = target.sessionDir === paths.scratchSessions;
    const settings = isScratch ? null : findProjectBySessionDir(target.sessionDir ?? '');
    const projectId = isScratch ? null : (settings?.id ?? null);
    const reviewPolicy = settings?.reviewPolicy ?? 'request-review';
    const tool = await buildArtifactTool({
      store: artifactStore!,
      projectId,
      reviewPolicy,
      emit: (event) => {
        if (win && !win.isDestroyed()) win.webContents.send('scout:event', event);
      },
      onGate: (controller) => openGates.set(controller.artifactId, controller),
      log: () => {},
    });
    return [tool];
  };

  function findProjectBySessionDir(sessionDir: string): { id: string; reviewPolicy: 'always-proceed' | 'agent-decides' | 'request-review' } | null {
    for (const view of projects?.list() ?? []) {
      if (paths.projectSessions(view.id) === sessionDir) {
        const policy = view.settings?.reviewPolicy ?? 'request-review';
        return {
          id: view.id,
          reviewPolicy: policy as 'always-proceed' | 'agent-decides' | 'request-review',
        };
      }
    }
    return null;
  }

  host = new AgentHost(
    {
      emit: (_channel, payload) => {
        // 'scout:event' is the literal event contract (see ipcContract test).
        if (win && !win.isDestroyed()) win.webContents.send('scout:event', payload);
      },
    },
    piSessionFactory(paths.agentDir, toolProvider),
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
  ipcMain.handle('scout:abort', () => {
    // Reject held Proceed gates so a stopped run cannot leave the
    // register_artifact continuation pending forever (decision #14).
    for (const [id, gate] of openGates) {
      gate.reject('run aborted by user');
      openGates.delete(id);
    }
    return host?.abort();
  });
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

  // Conversations (T02): restore, rename, archive, move.
  ipcMain.handle(
    'scout:conversations:restore',
    (_e, projectId: string | null, sessionPath: string) => projects?.restore(projectId, sessionPath),
  );
  ipcMain.handle('scout:conversations:rename', (_e, sessionPath: string, name: string) =>
    projects?.renameConversation(sessionPath, name),
  );
  ipcMain.handle(
    'scout:conversations:archive',
    (_e, projectId: string | null, sessionPath: string, archived: boolean) =>
      projects?.setArchived(projectId, sessionPath, archived),
  );
  ipcMain.handle('scout:conversations:move', (_e, sessionFileName: string, projectId: string) =>
    projects?.moveScratchToProject(sessionFileName, projectId),
  );

  // Artifacts (T03, decision #14): hydrate, approve (gate resolution), comment.
  ipcMain.handle('scout:artifacts:list', (_e, projectId: string | null) => artifactStore?.list(projectId));
  ipcMain.handle('scout:artifacts:hydrate', (_e, projectId: string | null, artifactId: string) =>
    artifactStore?.hydrate(projectId, artifactId),
  );
  ipcMain.handle('scout:artifacts:approve', (_e, artifactId: string, comment?: string) => {
    if (comment?.trim()) artifactStore?.addComment(artifactId, comment.trim());
    artifactStore?.approve(artifactId);
    openGates.get(artifactId)?.approve();
    openGates.delete(artifactId);
    if (win && !win.isDestroyed()) {
      win.webContents.send('scout:event', { type: 'artifact_updated', id: artifactId, version: 0, status: 'approved' });
    }
  });
  ipcMain.handle('scout:artifacts:comment', (_e, artifactId: string, text: string, steerText?: string) => {
    artifactStore?.addComment(artifactId, text);
    // Feedback reaches the agent mid-run via session steering (decision #14).
    if (steerText?.trim() && host) {
      void host.steer(steerText.trim());
    }
    if (win && !win.isDestroyed()) {
      win.webContents.send('scout:event', { type: 'artifact_updated', id: artifactId, version: 0, status: 'review' });
    }
  });
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
