export type RunState = 'queued' | 'running' | 'done' | 'stopped' | 'error';

export interface FleetRun {
  id: string;
  /** pi-subagents agent name: researcher, evidence-auditor, reviewer, … */
  agent: string;
  task: string;
  state: RunState;
  /** Transcript lines streamed from the child session. */
  transcript: string[];
}

export const STATE_STYLES: Record<RunState, string> = {
  queued: 'bg-surface-2 text-ink-dim',
  running: 'bg-accent-soft text-accent',
  done: 'bg-surface-2 text-ink-dim',
  stopped: 'bg-surface-2 text-ink-dim',
  error: 'bg-danger-soft text-danger',
};

export const STATE_LABELS: Record<RunState, string> = {
  queued: 'queued',
  running: 'running',
  done: 'done',
  stopped: 'stopped',
  error: 'error',
};
