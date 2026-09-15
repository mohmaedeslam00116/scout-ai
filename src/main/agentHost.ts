/**
 * AgentHost — the single place pi is imported (AGENTS.md rule).
 *
 * Owns a real pi AgentSession per send target (created lazily through
 * `createAgentSession`, ADR-0002) and translates its event stream into the
 * typed ScoutAgentEvent channel the renderer consumes. The renderer never
 * imports pi.
 *
 * A target is where a conversation lives: a cwd plus (per decision #16) an
 * explicit sessionDir — the project's `sessions/` directory — so pi session
 * storage co-locates with the project. The scratch target is the default
 * destination. `fresh: true` forces a brand-new conversation instead of
 * continuing the target's live one (the scheduler relies on this later).
 *
 * The pi import lives behind `SessionFactory` so tests run the whole host
 * with a fake session and zero pi loading. `piSessionFactory` is the
 * production wiring.
 */

import { mapSessionEvent } from './mapEvent.ts';
import { runRegisterArtifact, shouldAwaitApproval } from './artifactTool.ts';
import type { ArtifactToolDeps, RegisterArtifactArgs } from './artifactTool.ts';
import {
  classifyAction,
  evaluatePermission,
  DEFAULT_GRANT,
  type ProjectRules,
} from './permissionEngine.ts';
import { FleetRunStore } from './fleetStore.ts';
import type { ScoutAgentEvent, ScoutPermissionAction, ScoutState, FleetRunState, FleetRunStatus } from '../types/shared.ts';
// (shared types imported above together with the permission engine)

export type { ScoutAgentEvent, ScoutState };

export interface HostSink {
  emit(channel: 'scout:event', payload: ScoutAgentEvent): void;
}

/** Structural subset of the pi AgentSession the host touches. */
export interface PiLikeSession {
  subscribe(listener: (event: unknown) => void): () => void;
  prompt(text: string): Promise<void>;
  /** Queue a mid-run steering message (verified pi primitive, decision #14). */
  steer?(text: string): void;
  abort(): Promise<void>;
  isStreaming: boolean;
}

/** Where a conversation lives (decision #16). */
export interface SendTarget {
  cwd: string;
  /** Explicit pi sessionDir — the project's sessions/ directory. */
  sessionDir?: string;
  /** Force a brand-new conversation instead of continuing the target's one. */
  fresh?: boolean;
  /** Resume a specific stored session file (transcript restore, T02). */
  resume?: string;
}

/** One conversation as the renderer sees it (from pi SessionInfo). */
export interface ConversationSummary {
  path: string;
  id: string;
  name?: string;
  created: number;
  modified: number;
  messageCount: number;
  firstMessage: string;
}

/** Injectable read path over pi SessionManager.listAll (tests stay pi-free). */
export type SessionLister = (sessionDir: string) => Promise<ConversationSummary[]>;

/** Injectable transcript reader over pi SessionManager.open().getEntries(). */
export type TranscriptReader = (
  sessionPath: string,
) => Promise<{ role: 'user' | 'assistant'; text: string }[]>;

/** Injectable rename over pi SessionManager.open().appendSessionInfo(). */
export type SessionRenamer = (sessionPath: string, name: string) => Promise<void>;

export interface HostOptions {
  /** Default destination when a send names no target (scratch-first, #16 §7). */
  scratch?: { cwd: string; sessionDir: string };
  lister?: SessionLister;
  reader?: TranscriptReader;
  renamer?: SessionRenamer;
  /** Production only: extra pi tools per target (register_artifact). */
  tools?: ToolProvider;
  /** Rules for the target being sent to (T04); scratch gets DEFAULT_GRANT. */
  permissionRules?: (target: SendTarget) => ProjectRules;
  /** Runs root for the target (T05 persistence). Null/absent = no persistence. */
  fleetRootFor?: (target: SendTarget) => string | null;
}

export type SessionFactory = (target: SendTarget) => Promise<PiLikeSession>;

/** Extra tools (pi ToolDefinitions) handed to sessions for a target. */
export type ToolProvider = (target: SendTarget) => Promise<unknown[]>;

export class AgentHost {
  private busy = false;
  private readonly messages: { role: string; text: string }[] = [];
  private readonly activity: { kind: string; text: string; ts: number }[] = [];
  private readonly sink: HostSink;
  private readonly createSession: SessionFactory;
  private readonly options: HostOptions;
  /** One pi session per target key (cwd + sessionDir; projects anchor both). */
  private readonly sessions = new Map<string, PiLikeSession>();
  /** Unsubscribe per session, so replaced sessions don't leak listeners. */
  private readonly unsubscribers = new Map<string, () => void>();
  /** Resume file per target, set by restore() and consumed by sessionFor(). */
  private readonly resumeByTarget = new Map<string, string>();
  private sessionPromise: Promise<PiLikeSession> | null = null;
  /** Pending permission requests (T04): id → resolution surface. */
  private readonly pendingPermissions = new Map<string, { resolve: (verdict: 'allow' | 'deny') => void; request: PermissionRequestPayload }>();
  /** Per-root Fleet transcript stores (T05). */
  private readonly fleetStores = new Map<string, FleetRunStore>();
  /** Runs root of the run in flight (Fleet persistence attribution). */
  private activeFleetRoot: string | null = null;
  /** Lines of rolling recentOutput already persisted, per runId. */
  private readonly fleetOutputSeen = new Map<string, number>();

  constructor(sink: HostSink, createSession: SessionFactory, options: HostOptions = {}) {
    this.sink = sink;
    this.createSession = createSession;
    this.options = options;
  }

  snapshot(): ScoutState {
    return {
      busy: this.busy,
      messages: [...this.messages],
      activity: [...this.activity],
    };
  }

  /** Default cwd for v1 (single-project MVP): the process working directory. */
  defaultCwd(): string {
    return process.cwd();
  }

  private static keyOf(target: SendTarget): string {
    return `${target.cwd}\u0000${target.sessionDir ?? ''}`;
  }

  /**
   * Transcript restore (T02): open the stored session, replay its messages to
   * the renderer, and pin the target so subsequent sends resume that file.
   */
  async restore(cwd: string, sessionDir: string, sessionPath: string): Promise<{ ok: true } | { ok: false; error: string }> {
    if (this.busy) return { ok: false, error: 'Agent is busy' };
    try {
      const reader = this.options.reader;
      const messages = reader ? await reader(sessionPath) : await piReadTranscript(sessionPath);
      this.sink.emit('scout:event', { type: 'agent_start' });
      for (const m of messages) {
        this.messages.push(m);
        this.sink.emit('scout:event', {
          type: 'message_end',
          role: m.role,
          text: m.text,
        });
      }
      this.sink.emit('scout:event', { type: 'agent_end' });
      const key = AgentHost.keyOf({ cwd, sessionDir });
      this.resumeByTarget.set(key, sessionPath);
      // Drop any live session on this target so the next send creates one on
      // the resumed file instead of continuing the previous conversation.
      await this.dropSession(key);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  /** Rename a stored conversation via pi's session_info entry. */
  async renameConversation(sessionPath: string, name: string): Promise<void> {
    const renamer = this.options.renamer;
    if (renamer) return renamer(sessionPath, name);
    return piRenameSession(sessionPath, name);
  }

  private async sessionFor(target: SendTarget): Promise<PiLikeSession> {
    const key = AgentHost.keyOf(target);
    if (target.fresh) {
      // New conversation: drop the target's live session (if any) and make one.
      this.resumeByTarget.delete(key);
      await this.dropSession(key);
    } else {
      const existing = this.sessions.get(key);
      if (existing) return existing;
    }
    if (this.sessionPromise) return this.sessionPromise;

    this.sessionPromise = (async () => {
      const resume = target.resume ?? this.resumeByTarget.get(key);
      const session = await this.createSession(resume ? { ...target, resume } : target);
      this.installPermissionGate(session, target);
      const unsubscribe = session.subscribe((raw) => {
        for (const mapped of this.mapAndLog(raw)) this.sink.emit('scout:event', mapped);
      });
      this.sessions.set(key, session);
      this.unsubscribers.set(key, unsubscribe);
      return session;
    })();

    try {
      return await this.sessionPromise;
    } finally {
      this.sessionPromise = null;
    }
  }

  private async dropSession(key: string): Promise<void> {
    if (this.sessionPromise) {
      try {
        await this.sessionPromise;
      } catch {
        // creation failed; nothing to drop
      }
    }
    const unsub = this.unsubscribers.get(key);
    if (unsub) unsub();
    this.unsubscribers.delete(key);
    this.sessions.delete(key);
  }

  private mapAndLog(raw: unknown): ScoutAgentEvent[] {
    // Fleet mapping first (T05, decision #15 §2): pi-subagents streams child
    // state through the subagent tool's onUpdate → tool_execution_update,
    // which mapSessionEvent maps to null — the raw event is the carrier.
    const fleet = this.mapFleetUpdate(raw);
    const mapped = mapSessionEvent(raw);
    if (!mapped) return fleet ? [fleet] : [];
    if (mapped.type === 'message_end' && mapped.role === 'assistant') {
      this.messages.push({ role: 'assistant', text: mapped.text });
    } else if (mapped.type === 'tool_call') {
      this.log('tool', `${mapped.name} ${safeArgs(mapped.args)}`);
    } else if (mapped.type === 'tool_result') {
      this.log(mapped.ok ? 'done' : 'error', `${mapped.name}: ${mapped.summary}`);
    }
    return fleet ? [mapped, fleet] : [mapped];
  }

  /** FleetRunStore for the run in flight; null outside sends or without a root. */
  private fleetStore(): FleetRunStore | null {
    const root = this.activeFleetRoot;
    if (!root) return null;
    let store = this.fleetStores.get(root);
    if (!store) {
      store = new FleetRunStore(root);
      this.fleetStores.set(root, store);
    }
    return store;
  }

  /**
   * Map a pi tool_execution_update for the subagent tool into a
   * fleet_run_update event, persisting each AgentProgress entry. Returns null
   * for anything that is not live subagent progress.
   */
  private mapFleetUpdate(raw: unknown): ScoutAgentEvent | null {
    const event = raw as { type?: string; toolName?: string; partialResult?: { details?: unknown } };
    if (event?.type !== 'tool_execution_update' || event.toolName !== 'subagent') return null;
    const details = event.partialResult?.details as { progress?: unknown[] } | undefined;
    const progress = details?.progress;
    if (!Array.isArray(progress)) return null;
    const runs: FleetRunState[] = [];
    const store = this.fleetStore();
    for (const entry of progress) {
      const p = entry as {
        index?: number;
        agent?: string;
        status?: string;
        task?: string;
        currentTool?: string;
        recentOutput?: unknown;
        toolCount?: number;
        tokens?: number;
        durationMs?: number;
        error?: string;
      };
      if (typeof p.agent !== 'string' || typeof p.index !== 'number') continue;
      const status = mapRunStatus(p.status);
      if (!status) continue;
      const output = Array.isArray(p.recentOutput) ? p.recentOutput.map(String) : [];
      const run: FleetRunState = {
        runId: `${p.agent}:${p.index}`,
        agent: p.agent,
        task: typeof p.task === 'string' ? p.task : '',
        status,
        ...(p.currentTool ? { currentTool: p.currentTool } : {}),
        ...(p.toolCount !== undefined ? { toolCount: p.toolCount } : {}),
        ...(p.tokens !== undefined ? { tokens: p.tokens } : {}),
        ...(p.durationMs !== undefined ? { durationMs: p.durationMs } : {}),
        ...(p.error ? { error: p.error } : {}),
        output,
      };
      runs.push(run);
      store?.append({
        ts: Date.now(),
        runId: run.runId,
        agent: run.agent,
        status: mapStoreStatus(p.status),
        task: run.task,
        ...(p.currentTool ? { currentTool: p.currentTool } : {}),
        ...(p.toolCount !== undefined ? { toolCount: p.toolCount } : {}),
        ...(p.tokens !== undefined ? { tokens: p.tokens } : {}),
        ...(p.durationMs !== undefined ? { durationMs: p.durationMs } : {}),
        ...(p.error ? { error: p.error } : {}),
      });
      // recentOutput is a rolling window: persist only the lines newer than
      // what's already on disk, or the transcript fills with duplicates.
      if (output.length > 0) {
        const seen = this.fleetOutputSeen.get(run.runId) ?? 0;
        const fresh = output.length > seen ? output.slice(seen) : [];
        this.fleetOutputSeen.set(run.runId, Math.max(seen, output.length));
        if (fresh.length > 0) store?.appendOutput(run.runId, fresh);
      }
    }
    if (runs.length === 0) return null;
    return { type: 'fleet_run_update', runs };
  }

  /**
   * Steer a child run (T05, decision #15 §4): parent-mediated. A steering
   * message to the parent session, labeled honestly as via Scout; the parent
   * delivers it to the child per its own judgment.
   */
  steerRun(runId: string, message: string): void {
    const text = `Fleet steer for ${runId} (via Scout): ${message}`;
    this.recordControl(runId, 'scout', 'parent', 'steer', message);
    this.log('steer', text);
    this.steerActive(text);
  }

  /**
   * Stop one child run (T05, decision #15 §3): the parent injects the
   * interrupt as a management action on its next turn boundary (pi-subagents
   * executes `subagent action=interrupt id=<runId>`). The composer's Stop
   * aborts the parent outright (abort()).
   */
  stopRun(runId: string): void {
    const text = `Interrupt subagent run ${runId} now (subagent action=interrupt id=${runId}).`;
    this.recordControl(runId, 'scout', 'parent', 'interrupt');
    this.log('stop', text);
    // The user ended this child: mark the run terminal on disk so it hydrates
    // as stopped after restart instead of running forever.
    this.fleetStore()?.markStopped(runId, 'detached', 'Stopped by user in Scout');
    this.steerActive(text);
  }

  private recordControl(runId: string, from: string, to: string, reason: string, message?: string): void {
    const store = this.fleetStore();
    if (!store) return;
    store.appendControl(runId, { from, to, reason, ...(message ? { message } : {}) });
  }

  /** Queue a steering message on every streaming session (shared by steer/stop). */
  private steerActive(text: string): void {
    for (const session of this.sessions.values()) {
      if (session.isStreaming) session.steer?.(text);
    }
  }

  async send(text: string, target?: SendTarget): Promise<void> {
    if (this.busy) throw new Error('Agent is busy');
    const question = text.trim();
    if (!question) return;

    const resolved: SendTarget =
      target ??
      (this.options.scratch
        ? { cwd: this.options.scratch.cwd, sessionDir: this.options.scratch.sessionDir }
        : { cwd: this.defaultCwd() });

    this.busy = true;
    this.activeFleetRoot = this.options.fleetRootFor?.(resolved) ?? null;
    this.messages.push({ role: 'user', text: question });
    this.log('prompt', question);
    this.sink.emit('scout:event', { type: 'agent_start' });

    try {
      const session = await this.sessionFor(resolved);
      // prompt() resolves when the run settles; mapped events streamed above.
      await session.prompt(question);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.messages.push({ role: 'assistant', text: `Error: ${message}` });
      this.sink.emit('scout:event', { type: 'message_end', role: 'assistant', text: `Error: ${message}` });
    } finally {
      this.busy = false;
      this.activeFleetRoot = null;
      this.fleetOutputSeen.clear();
      this.sink.emit('scout:event', { type: 'agent_end' });
    }
  }

  /** List a sessionDir's conversations, newest first. */
  async listConversations(sessionDir: string): Promise<ConversationSummary[]> {
    const lister = this.options.lister;
    const raw = lister
      ? await lister(sessionDir)
      : await piSessionList(sessionDir);
    return [...raw].sort((a, b) => b.modified - a.modified);
  }

  /**
   * Steer the active run (artifact inline comments ride this, decision #14).
   * No-op when idle — steering only makes sense mid-run.
   */
  steer(text: string): void {
    for (const session of this.sessions.values()) {
      if (session.isStreaming) session.steer?.(text);
    }
  }

  async abort(): Promise<void> {
    this.rejectPendingPermissions();
    if (this.sessionPromise) return; // still creating; nothing to abort yet
    for (const session of this.sessions.values()) {
      if (session.isStreaming) await session.abort();
    }
  }

  /** Dispose everything (app quit). */
  dispose(): void {
    for (const unsubscribe of this.unsubscribers.values()) unsubscribe();
    this.unsubscribers.clear();
    this.sessions.clear();
  }

  /**
   * Permission gate (T04, decision #13): install pi's beforeToolCall hook so
   * every tool call is classified and evaluated before it runs. 'ask' holds
   * the awaited promise (the same continuation-hold as the artifact Proceed
   * gate) until resolvePermission() speaks; 'deny' blocks with a reason. The
   * hook lives on the session's public agent — one choke point covering pi's
   * built-ins, extension tools, and Scout's own custom tools alike.
   */
  private installPermissionGate(session: PiLikeSession, target: SendTarget): void {
    const agent = (session as { agent?: { beforeToolCall?: PermissionHook } }).agent;
    if (!agent) return; // fake/test sessions without an agent surface
    agent.beforeToolCall = async (ctx) => {
      // Re-read rules per call: scope widening (and project settings edits)
      // must reach the long-lived session's gate immediately.
      const rules = this.options.permissionRules?.(target) ?? DEFAULT_GRANT;
      const toolName = ctx.toolCall?.name ?? 'unknown';
      const action = classifyAction(toolName, ctx.args);
      const verdict = evaluatePermission(action, rules);
      const id = `perm-${permissionSeq++}`;
      if (verdict === 'allow') return undefined; // no request, no row
      if (verdict === 'deny') {
        this.sink.emit('scout:event', { type: 'permission_resolved', id, verdict: 'deny' });
        return { block: true, reason: `Blocked by project security policy: ${describeAction(toolName, action)}` };
      }
      // 'ask' — hold the tool call until the human resolves it.
      this.sink.emit('scout:event', {
        type: 'permission_request',
        id,
        tool: toolName,
        action,
      });
      const verdict2 = await new Promise<'allow' | 'deny'>((resolve) => {
        this.pendingPermissions.set(id, { resolve, request: { id, tool: toolName, action } });
      });
      this.pendingPermissions.delete(id);
      if (verdict2 === 'allow') {
        this.sink.emit('scout:event', { type: 'permission_resolved', id, verdict: 'allow' });
        return undefined; // proceed with the original args
      }
      this.sink.emit('scout:event', { type: 'permission_resolved', id, verdict: 'deny' });
      return { block: true, reason: 'The user denied this action in Scout.' };
    };
  }

  /**
   * Resolve a pending permission request (scout:permissions:resolve IPC).
   * Unknown ids resolve to deny — never silently allow.
   */
  resolvePermission(id: string, verdict: 'allow' | 'deny'): void {
    const pending = this.pendingPermissions.get(id);
    if (pending) {
      pending.resolve(verdict);
    } else {
      this.sink.emit('scout:event', { type: 'permission_resolved', id, verdict: 'deny' });
    }
  }

  /** Reject all held gates (Stop / abort) so no tool call hangs forever. */
  private rejectPendingPermissions(): void {
    for (const [id, pending] of this.pendingPermissions) {
      pending.resolve('deny');
      this.pendingPermissions.delete(id);
    }
  }

  protected log(kind: string, text: string): void {
    this.activity.push({ kind, text, ts: Date.now() });
  }
}

/**
 * Permission gate types (T04). The hook mirrors pi's beforeToolCall contract:
 * return undefined to proceed, { block, reason } to block.
 */
interface PermissionRequestPayload {
  id: string;
  tool: string;
  action: ScoutPermissionAction;
}

type PermissionHook = (
  ctx: { toolCall?: { name?: string; id?: string }; args?: unknown },
  signal?: AbortSignal,
) => Promise<{ block?: boolean; reason?: string } | undefined>;

let permissionSeq = 0;

/** AgentProgress.status → Scout card status (decision #15 §2). */
function mapRunStatus(status: string | undefined): FleetRunStatus | null {
  switch (status) {
    case 'pending':
      return 'queued';
    case 'running':
      return 'running';
    case 'completed':
      return 'done';
    case 'failed':
      return 'error';
    case 'detached':
      return 'stopped';
    default:
      return null; // unknown statuses are skipped, not guessed
  }
}

/** AgentProgress.status → store record status (same vocabulary). */
function mapStoreStatus(status: string | undefined): 'pending' | 'running' | 'completed' | 'failed' | 'detached' {
  return status === 'pending' || status === 'running' || status === 'completed' || status === 'failed' || status === 'detached'
    ? status
    : 'running';
}

function describeAction(toolName: string, action: ScoutPermissionAction): string {
  switch (action.kind) {
    case 'fetch':
    case 'read_url':
      return action.domain ? `${toolName} on ${action.domain}` : toolName;
    case 'command':
      return action.wildcard ? `command with ${action.prefix} …` : `command ${action.prefix}`;
    case 'mcp':
      return action.tool ? `${action.server}/${action.tool}` : action.server;
    case 'subagent':
      return `subagent ${action.agent}`;
    default:
      return toolName;
  }
}

function safeArgs(args: unknown): string {
  try {
    return JSON.stringify(args)?.slice(0, 100) ?? '';
  } catch {
    return '';
  }
}

/**
 * Production SessionFactory: embeds the pi harness (ADR-0002, decision #2).
 * When a target carries an explicit sessionDir, the session is created around
 * a SessionManager rooted there (decision #16): session files land beside the
 * project. A `resume` path opens that stored session instead (transcript
 * restore, T02). Dynamic import keeps tests free of pi side effects.
 */
export function piSessionFactory(agentDir: string, tools?: ToolProvider): SessionFactory {
  return async (target) => {
    const { createAgentSession, SessionManager } = await import('@earendil-works/pi-coding-agent');
    const sessionManager = target.resume
      ? SessionManager.open(target.resume, target.sessionDir, target.cwd)
      : SessionManager.create(target.cwd, target.sessionDir);
    const customTools = tools ? await tools(target) : undefined;
    const { session } = await createAgentSession({
      cwd: target.cwd,
      agentDir,
      sessionManager,
      ...(customTools && customTools.length > 0 ? { customTools: customTools as never[] } : {}),
    });
    return session as unknown as PiLikeSession;
  };
}

/**
 * Build the pi ToolDefinition for register_artifact (decision #14) and adapt
 * it to pi's tool shape. Lives here so every pi import stays in this file
 * (AGENTS.md); tests exercise the pure `runRegisterArtifact` instead.
 */
export async function buildArtifactTool(deps: ArtifactToolDeps): Promise<unknown> {
  const [{ defineTool }, { Type }] = await Promise.all([
    import('@earendil-works/pi-coding-agent'),
    import('typebox'),
  ]);
  return defineTool({
    name: 'register_artifact',
    label: 'Register artifact',
    description:
      'Register a research artifact for human review: kind=research-brief|source-dossier|evidence-table, a title, and the full markdown body. ' +
      'The user reviews briefs before the research proceeds when the project asks for review.',
    parameters: Type.Object({
      kind: Type.Union([Type.Literal('research-brief'), Type.Literal('source-dossier'), Type.Literal('evidence-table')]),
      title: Type.String({ description: 'Short human-readable title' }),
      body: Type.String({ description: 'Full markdown body of the artifact' }),
    }),
    async execute(_id, params) {
      const result = await runRegisterArtifact(
        params as RegisterArtifactArgs,
        deps,
        shouldAwaitApproval(deps.reviewPolicy),
      );
      return {
        content: [
          {
            type: 'text',
            text: result.approved
              ? `Artifact registered and approved by the user: ${result.artifactId}. Continue.`
              : `Artifact registered: ${result.artifactId}.`,
          },
        ],
        details: result,
      };
    },
  });
}

/** Production read path over pi SessionManager.listAll (imported lazily). */
export async function piSessionList(sessionDir: string): Promise<ConversationSummary[]> {
  const { SessionManager } = await import('@earendil-works/pi-coding-agent');
  const infos = await SessionManager.listAll(sessionDir);
  return infos.map((info) => ({
    path: info.path,
    id: info.id,
    ...(info.name ? { name: info.name } : {}),
    created: info.created instanceof Date ? info.created.getTime() : Number(info.created) || 0,
    modified: info.modified instanceof Date ? info.modified.getTime() : Number(info.modified) || 0,
    messageCount: info.messageCount,
    firstMessage: info.firstMessage,
  }));
}

/** Production transcript reader: pi SessionManager.open().getEntries(). */
export async function piReadTranscript(
  sessionPath: string,
): Promise<{ role: 'user' | 'assistant'; text: string }[]> {
  const { SessionManager } = await import('@earendil-works/pi-coding-agent');
  const manager = SessionManager.open(sessionPath);
  const out: { role: 'user' | 'assistant'; text: string }[] = [];
  for (const entry of manager.getEntries()) {
    if (entry.type !== 'message') continue;
    const message = entry.message as { role?: string; content?: unknown };
    const role = message.role === 'assistant' ? 'assistant' : 'user';
    const content = message.content;
    const text =
      typeof content === 'string'
        ? content
        : Array.isArray(content)
          ? content
              .map((block) => (block && typeof block === 'object' && 'text' in block ? String((block as { text: unknown }).text) : ''))
              .join('')
          : '';
    if (text.trim()) out.push({ role, text });
  }
  return out;
}

/** Production rename: pi SessionManager.open().appendSessionInfo(name). */
export async function piRenameSession(sessionPath: string, name: string): Promise<void> {
  const { SessionManager } = await import('@earendil-works/pi-coding-agent');
  SessionManager.open(sessionPath).appendSessionInfo(name);
}
