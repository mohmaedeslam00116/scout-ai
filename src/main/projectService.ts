/**
 * ProjectService — main-process façade over the registry, settings store, and
 * paths module (decision #16 §4 IPC surface). Every project mutation also
 * keeps the per-project settings file coherent (ensure on create/open, patch
 * on settings change). Pure Node besides the injected host listing, so the
 * wiring is unit-testable without Electron.
 */

import { mkdirSync } from 'node:fs';

import { AgentHost, type ConversationSummary } from './agentHost.ts';
import { ConversationStore } from './conversationStore.ts';
import { ProjectRegistry, type ProjectMeta } from './registry.ts';
import { ProjectStore, type ProjectPatch, type ProjectSettings } from './projectStore.ts';
import type { ScoutPaths } from './paths.ts';

export interface ProjectView extends ProjectMeta {
  settings: ProjectSettings | null;
}

export class ProjectService {
  readonly registry: ProjectRegistry;
  private readonly convStore: ConversationStore;
  private readonly store: ProjectStore;
  private readonly paths: ScoutPaths;
  private readonly host: AgentHost;

  constructor(paths: ScoutPaths, host: AgentHost) {
    this.paths = paths;
    this.host = host;
    this.registry = new ProjectRegistry(paths.registryFile, paths.projectsDir);
    this.store = new ProjectStore(paths.projectsDir);
    this.convStore = new ConversationStore(paths);
  }

  /** Registry view merged with each project's settings. */
  list(): ProjectView[] {
    return this.registry.list().map((meta) => ({
      ...meta,
      settings: this.store.get(meta.id),
    }));
  }

  create(name: string, folders: string[] = []): ProjectView {
    const meta = this.registry.create(name);
    mkdirSync(this.paths.projectHome(meta.id), { recursive: true });
    mkdirSync(this.paths.projectSessions(meta.id), { recursive: true });
    mkdirSync(this.paths.projectArtifacts(meta.id), { recursive: true });
    mkdirSync(this.paths.projectRuns(meta.id), { recursive: true });
    this.store.ensure(meta.id, { name: meta.name, folders });
    return { ...meta, settings: this.store.get(meta.id) };
  }

  patchSettings(projectId: string, patch: ProjectPatch): ProjectSettings {
    return this.store.patch(projectId, patch);
  }

  async open(projectId: string): Promise<{ settings: ProjectSettings | null; conversations: ConversationSummary[] }> {
    const meta = this.registry.get(projectId);
    if (!meta) throw new Error(`Unknown project: ${projectId}`);
    this.registry.touch(projectId);
    this.store.ensure(projectId, { name: meta.name, folders: this.store.get(projectId)?.folders ?? [] });
    return {
      settings: this.store.get(projectId),
      conversations: await this.conversations(projectId),
    };
  }

  remove(projectId: string): void {
    this.registry.remove(projectId); // deletes the whole project directory
  }

  /** Conversations under a project (its sessionDir), newest first. */
  async conversations(projectId: string): Promise<ConversationSummary[]> {
    return this.host.listConversations(this.paths.projectSessions(projectId));
  }

  /** Scratch conversations (scratch sessionDir), newest first. */
  async scratchConversations(): Promise<ConversationSummary[]> {
    return this.host.listConversations(this.paths.scratchSessions);
  }

  /** Transcript restore (T02): replay a stored conversation into the UI. */
  restore(
    projectId: string | null,
    sessionPath: string,
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    const target =
      projectId === null ? this.scratchTarget() : this.sendTargetFor(projectId);
    return this.host.restore(target.cwd, target.sessionDir, sessionPath);
  }

  /** Rename via pi's session_info entry. */
  renameConversation(sessionPath: string, name: string): Promise<void> {
    return this.host.renameConversation(sessionPath, name);
  }

  /** Archive flags (Scout-side markers; pi has no archive concept). */
  setArchived(_projectId: string | null, sessionPath: string, archived: boolean): void {
    if (archived) this.convStore.archive(sessionPath);
    else this.convStore.unarchive(sessionPath);
  }

  isArchived(_projectId: string | null, sessionPath: string): boolean {
    return this.convStore.isArchived(sessionPath);
  }

  /** Move a scratch conversation (by file name) into a project. */
  moveScratchToProject(sessionFileName: string, projectId: string): void {
    this.convStore.moveScratchToProject(sessionFileName, projectId);
  }

  /** Where sends for this project land (effective cwd + per-project sessionDir). */
  sendTargetFor(projectId: string): { cwd: string; sessionDir: string } {
    const settings = this.store.get(projectId);
    const folders = settings?.folders ?? [];
    return { cwd: this.paths.effectiveCwd(projectId, folders), sessionDir: this.paths.projectSessions(projectId) };
  }

  scratchTarget(): { cwd: string; sessionDir: string } {
    return { cwd: this.paths.scratchHome, sessionDir: this.paths.scratchSessions };
  }
}
