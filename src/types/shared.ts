/** Types shared between main, preload and renderer. Mirrors AgentHost events. */

export type ScoutArtifactKind = 'research-brief' | 'source-dossier' | 'evidence-table';

export type ScoutAgentEvent =
  | { type: 'agent_start' }
  | { type: 'message_start'; role: 'user' | 'assistant' }
  | { type: 'message_delta'; text: string }
  | { type: 'message_end'; role: 'user' | 'assistant'; text: string }
  | { type: 'tool_call'; name: string; args: unknown }
  | { type: 'tool_result'; name: string; ok: boolean; summary: string }
  | { type: 'artifact_created'; id: string; kind: ScoutArtifactKind; title: string; status: 'draft' | 'review' | 'approved' }
  | { type: 'artifact_updated'; id: string; version: number; status: 'draft' | 'review' | 'approved' }
  | { type: 'agent_end'; reason?: string };

export type ScoutState = {
  busy: boolean;
  messages: { role: string; text: string }[];
  activity: { kind: string; text: string; ts: number }[];
};

/** Which conversation context a send (or listing) addresses (decision #16). */
export type ScoutSendTarget =
  | { kind: 'scratch'; fresh?: boolean }
  | { kind: 'project'; projectId: string; fresh?: boolean };
