/**
 * Event mapping: pi AgentSessionEvent → ScoutAgentEvent.
 * Pure and exported so tests can verify the mapping without loading pi.
 *
 * pi event surface (verified against @earendil-works/pi-agent-core types):
 *   agent_start, message_start/update/end, tool_execution_start/update/end,
 *   agent_end, agent_settled, queue_update, compaction_*, auto_retry_*, …
 * Scout consumes the subset below.
 */

import type { ScoutAgentEvent } from '../types/shared.ts';

/** Minimal structural types — the real pi types are structurally compatible. */
export interface PiAgentMessage {
  role?: string;
  content?:
    | string
    | Array<{ type: string; text?: string }>;
  stopReason?: string;
}

export type PiSessionEvent =
  | { type: 'agent_start' }
  | { type: 'agent_end'; messages: PiAgentMessage[]; willRetry: boolean }
  | { type: 'message_start'; message: PiAgentMessage }
  | {
      type: 'message_update';
      message: PiAgentMessage;
      assistantMessageEvent: { type: string; delta?: string };
    }
  | { type: 'message_end'; message: PiAgentMessage }
  | { type: 'tool_execution_start'; toolCallId: string; toolName: string; args: unknown }
  | { type: 'tool_execution_update'; toolCallId: string; toolName: string; partialResult: unknown }
  | { type: 'tool_execution_end'; toolCallId: string; toolName: string; result: unknown; isError: boolean }
  | { type: Exclude<string, 'agent_start' | 'agent_end' | 'message_start' | 'message_update' | 'message_end' | 'tool_execution_start' | 'tool_execution_end'> };

function messageText(message: PiAgentMessage | undefined): string {
  if (!message) return '';
  if (typeof message.content === 'string') return message.content;
  if (Array.isArray(message.content)) {
    return message.content
      .filter((block) => block.type === 'text' && typeof block.text === 'string')
      .map((block) => block.text)
      .join('');
  }
  return '';
}

export function mapSessionEvent(raw: unknown): ScoutAgentEvent | null {
  const event = raw as PiSessionEvent;
  switch (event.type) {
    case 'agent_start':
      return { type: 'agent_start' };
    case 'message_start':
      return 'message' in event && event.message?.role === 'assistant'
        ? { type: 'message_start', role: 'assistant' }
        : null;
    case 'message_update': {
      if (!('assistantMessageEvent' in event)) return null;
      const delta = event.assistantMessageEvent;
      if (
        delta &&
        typeof delta === 'object' &&
        'type' in delta &&
        delta.type === 'text_delta' &&
        typeof delta.delta === 'string' &&
        delta.delta
      ) {
        return { type: 'message_delta', text: delta.delta };
      }
      return null;
    }
    case 'message_end':
      return 'message' in event && event.message?.role === 'assistant'
        ? { type: 'message_end', role: 'assistant', text: messageText(event.message) }
        : null;
    case 'tool_execution_start':
      return 'toolName' in event
        ? { type: 'tool_call', name: event.toolName, args: event.args }
        : null;
    case 'tool_execution_end': {
      if (!('toolName' in event && 'isError' in event)) return null;
      const summary = summarizeToolResult(event.result);
      return { type: 'tool_result', name: event.toolName, ok: !event.isError, summary };
    }
    case 'agent_end':
      return 'willRetry' in event && !event.willRetry ? { type: 'agent_end' } : null;
    default:
      return null;
  }
}

/** One-line, human-readable summary of a tool result for the activity strip. */
export function summarizeToolResult(result: unknown): string {
  if (result == null) return 'done';
  if (typeof result === 'string') return firstLine(result);
  if (Array.isArray(result)) return `${result.length} item(s)`;
  if (typeof result === 'object') {
    const record = result as Record<string, unknown>;
    for (const key of ['summary', 'output', 'content', 'text', 'title']) {
      const value = record[key];
      if (typeof value === 'string' && value.trim()) return firstLine(value);
    }
    if (Array.isArray(record['results'])) return `${record['results'].length} result(s)`;
    const keys = Object.keys(record);
    if (keys.length > 0) return `${keys.slice(0, 3).join(', ')}${keys.length > 3 ? ', …' : ''}`;
  }
  return 'done';
}

function firstLine(text: string): string {
  const line = text.trim().split('\n')[0] ?? '';
  return line.length > 120 ? `${line.slice(0, 117)}…` : line;
}
