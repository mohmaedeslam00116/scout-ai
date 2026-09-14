/**
 * AgentHost — the single place pi is imported (AGENTS.md rule).
 *
 * Owns a real pi AgentSession per working directory (created lazily through
 * `createAgentSession`, ADR-0002) and translates its event stream into the
 * typed ScoutAgentEvent channel the renderer consumes. The renderer never
 * imports pi.
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

export type SessionFactory = (cwd: string) => Promise<PiLikeSession>;

export class AgentHost {
  private busy = false;
  private readonly messages: { role: string; text: string }[] = [];
  private readonly activity: { kind: string; text: string; ts: number }[] = [];
  private readonly sink: HostSink;
  private readonly createSession: SessionFactory;
  /** One pi session per effective cwd (projects anchor their own cwd). */
  private readonly sessions = new Map<string, PiLikeSession>();
  /** Unsubscribe per session, so replaced sessions don't leak listeners. */
  private readonly unsubscribers = new Map<string, () => void>();
  private sessionPromise: Promise<PiLikeSession> | null = null;

  constructor(sink: HostSink, createSession: SessionFactory) {
    this.sink = sink;
    this.createSession = createSession;
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

  private async sessionFor(cwd: string): Promise<PiLikeSession> {
    const existing = this.sessions.get(cwd);
    if (existing) return existing;
    if (this.sessionPromise) return this.sessionPromise;

    this.sessionPromise = (async () => {
      const session = await this.createSession(cwd);
      const unsubscribe = session.subscribe((raw) => {
        for (const mapped of this.mapAndLog(raw)) this.sink.emit('scout:event', mapped);
      });
      this.sessions.set(cwd, session);
      this.unsubscribers.set(cwd, unsubscribe);
      return session;
    })();

    try {
      return await this.sessionPromise;
    } finally {
      this.sessionPromise = null;
    }
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

  async send(text: string, cwd = this.defaultCwd()): Promise<void> {
    if (this.busy) throw new Error('Agent is busy');
    const question = text.trim();
    if (!question) return;

    this.busy = true;
    this.messages.push({ role: 'user', text: question });
    this.log('prompt', question);
    this.sink.emit('scout:event', { type: 'agent_start' });

    try {
      const session = await this.sessionFor(cwd);
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
 * Dynamic import keeps tests and typecheck free of pi side effects; the
 * settings file written by bootstrapAgentDir loads the three research
 * packages through pi's own package pipeline.
 */
export function piSessionFactory(agentDir: string): SessionFactory {
  return async (cwd) => {
    const { createAgentSession } = await import('@earendil-works/pi-coding-agent');
    const { session } = await createAgentSession({ cwd, agentDir });
    return session as unknown as PiLikeSession;
  };
}
