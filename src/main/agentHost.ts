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
import type { ScoutAgentEvent, ScoutState } from '../types/shared.ts';

export type { ScoutAgentEvent, ScoutState };

export interface HostSink {
  emit(channel: 'scout:event', payload: ScoutAgentEvent): void;
}

/** Structural subset of the pi AgentSession the host touches. */
export interface PiLikeSession {
  subscribe(listener: (event: unknown) => void): () => void;
  prompt(text: string): Promise<void>;
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

export interface HostOptions {
  /** Default destination when a send names no target (scratch-first, #16 §7). */
  scratch?: { cwd: string; sessionDir: string };
  lister?: SessionLister;
}

export type SessionFactory = (target: { cwd: string; sessionDir?: string }) => Promise<PiLikeSession>;

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
  private sessionPromise: Promise<PiLikeSession> | null = null;

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

  private async sessionFor(target: SendTarget): Promise<PiLikeSession> {
    const key = AgentHost.keyOf(target);
    if (target.fresh) {
      // New conversation: drop the target's live session (if any) and make one.
      await this.dropSession(key);
    } else {
      const existing = this.sessions.get(key);
      if (existing) return existing;
    }
    if (this.sessionPromise) return this.sessionPromise;

    this.sessionPromise = (async () => {
      const session = await this.createSession(target);
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
    const mapped = mapSessionEvent(raw);
    if (!mapped) return [];
    if (mapped.type === 'message_end' && mapped.role === 'assistant') {
      this.messages.push({ role: 'assistant', text: mapped.text });
    } else if (mapped.type === 'tool_call') {
      this.log('tool', `${mapped.name} ${safeArgs(mapped.args)}`);
    } else if (mapped.type === 'tool_result') {
      this.log(mapped.ok ? 'done' : 'error', `${mapped.name}: ${mapped.summary}`);
    }
    return [mapped];
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

  async abort(): Promise<void> {
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

  protected log(kind: string, text: string): void {
    this.activity.push({ kind, text, ts: Date.now() });
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
 * project. Dynamic import keeps tests and typecheck free of pi side effects.
 */
export function piSessionFactory(agentDir: string): SessionFactory {
  return async (target) => {
    const { createAgentSession } = await import('@earendil-works/pi-coding-agent');
    const { SessionManager } = await import('@earendil-works/pi-coding-agent');
    const sessionManager = target.sessionDir
      ? SessionManager.create(target.cwd, target.sessionDir)
      : SessionManager.create(target.cwd);
    const { session } = await createAgentSession({
      cwd: target.cwd,
      agentDir,
      sessionManager,
    });
    return session as unknown as PiLikeSession;
  };
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
