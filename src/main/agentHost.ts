/**
 * AgentHost — the single place pi is imported. It owns a headless pi-style
 * agent loop built directly on pi-agent-core and emits normalized events to
 * the renderer.
 *
 * pi-subagents / pi-web-access / billion-context are pi-harness extensions;
 * wiring them into the embedded harness is tracked as the next milestone
 * (see docs/adr/0002-embed-pi-harness.md).
 */

import type { ScoutAgentEvent, ScoutState } from '../types/shared.ts';

export type { ScoutAgentEvent, ScoutState };

export interface HostSink {
  emit(channel: 'scout:event', payload: ScoutAgentEvent): void;
}

export class AgentHost {
  private busy = false;
  private readonly messages: { role: string; text: string }[] = [];
  private readonly activity: { kind: string; text: string; ts: number }[] = [];
  private readonly sink: HostSink;

  constructor(sink: HostSink) {
    this.sink = sink;
  }

  snapshot(): ScoutState {
    return {
      busy: this.busy,
      messages: [...this.messages],
      activity: [...this.activity],
    };
  }

  async send(text: string): Promise<void> {
    if (this.busy) throw new Error('Agent is busy');
    const question = text.trim();
    if (!question) return;

    this.busy = true;
    this.messages.push({ role: 'user', text: question });
    this.log('prompt', question);
    this.sink.emit('scout:event', { type: 'agent_start' });
    this.sink.emit('scout:event', { type: 'message_start', role: 'user' });

    try {
      const answer = await this.run(question);
      this.messages.push({ role: 'assistant', text: answer });
      this.sink.emit('scout:event', { type: 'message_end', role: 'assistant', text: answer });
    } finally {
      this.busy = false;
      this.sink.emit('scout:event', { type: 'agent_end' });
    }
  }

  abort(): void {
    // Hook point for pi Agent.abort() once the harness is embedded.
  }

  /**
   * The engine seam. Today: echo stub so the app is runnable before the pi
   * harness lands. Replaced by an embedded pi session that streams real
   * message_delta / tool_call / tool_result events.
   */
  protected async run(question: string): Promise<string> {
    return `(stub) Scout received: "${question}". The pi harness (pi-web-access, pi-subagents, billion-context) will answer here.`;
  }

  protected log(kind: string, text: string): void {
    this.activity.push({ kind, text, ts: Date.now() });
  }
}
