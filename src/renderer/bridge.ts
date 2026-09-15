import type { ScoutAgentEvent, ScoutState, ScoutSendTarget } from '../types/shared.js';

/** Project view as the main process returns it (registry + settings merged). */
export interface ProjectView {
  id: string;
  name: string;
  createdAt: number;
  lastOpenedAt: number;
  settings: {
    id: string;
    name: string;
    folders: string[];
    reviewPolicy: string;
    security: { preset: string; allowDomains: string[]; denyDomains: string[]; commandPolicy: string };
    mcp: { enabledServers: string[] };
  } | null;
}

/** One stored conversation (from pi session files, newest first). */
export interface ConversationSummary {
  path: string;
  id: string;
  name?: string;
  created: number;
  modified: number;
  messageCount: number;
  firstMessage: string;
}

/**
 * The `window.scout` bridge injected by the Electron preload. In a plain
 * browser (Vite dev / preview) it is absent and demo mode drives the UI with
 * a scripted research run instead.
 */
export interface ScoutBridge {
  send(text: string, target?: ScoutSendTarget): Promise<void>;
  abort(): Promise<void>;
  state(): Promise<ScoutState>;
  onEvent(cb: (event: ScoutAgentEvent) => void): () => void;
  projectsList?(): Promise<ProjectView[]>;
  projectsCreate?(name: string, folders: string[]): Promise<ProjectView>;
  projectsOpen?(projectId: string): Promise<{ settings: ProjectView['settings']; conversations: ConversationSummary[] }>;
  projectsPatch?(projectId: string, patch: Record<string, unknown>): Promise<unknown>;
  projectsDelete?(projectId: string): Promise<void>;
  projectConversations?(projectId: string): Promise<ConversationSummary[]>;
  scratchConversations?(): Promise<ConversationSummary[]>;
  restoreConversation?(projectId: string | null, sessionPath: string): Promise<{ ok: boolean; error?: string }>;
  renameConversation?(sessionPath: string, name: string): Promise<void>;
  archiveConversation?(projectId: string | null, sessionPath: string, archived: boolean): Promise<void>;
  moveConversation?(sessionFileName: string, projectId: string): Promise<void>;
  artifactsList?(projectId: string | null): Promise<unknown[]>;
  artifactsHydrate?(projectId: string | null, artifactId: string): Promise<unknown>;
  artifactsApprove?(artifactId: string, comment?: string): Promise<void>;
  artifactsComment?(artifactId: string, text: string, steerText?: string): Promise<void>;
  resolvePermission?(id: string, verdict: 'allow' | 'deny'): Promise<void>;
  widenPermissionScope?(target: unknown, action: unknown, scope: 'domain' | 'wildcard' | 'server'): Promise<unknown>;
  fleetRuns?(projectId: string | null): Promise<unknown[]>;
  fleetTranscript?(projectId: string | null, runId: string): Promise<unknown[]>;
  fleetAction?(runId: string, action: 'steer' | 'stop', message?: string): Promise<void>;
  artifactsRegister?(args: { kind: string; title: string; body: string }, projectId: string | null, policy: string): Promise<unknown>;
}

export function getBridge(): ScoutBridge | null {
  const candidate = (window as { scout?: ScoutBridge }).scout;
  return typeof candidate === 'object' && candidate !== null ? candidate : null;
}

export type { ScoutAgentEvent, ScoutState, ScoutSendTarget };
