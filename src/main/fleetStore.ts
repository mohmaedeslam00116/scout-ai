/**
 * FleetRunStore — append-only per-run JSONL transcripts (T05, decision #15 §5).
 *
 * One file per run at `<runsRoot>/<sessionId?>/<runId>.jsonl`. Records are the
 * three line shapes from the decision:
 *   { ts, type:'progress', runId, agent, status, task, currentTool, toolCount, tokens, durationMs, error? }
 *   { ts, type:'output',   runId, lines[] }
 *   { ts, type:'control',  runId, from, to, reason, message }
 *
 * `list()` folds each file into a FleetRunRecord (last progress wins; output
 * and control lines accumulate), so done/stopped cards hydrate from disk after
 * restart with zero in-memory state. Runs are keyed by runId
 * (`<agent>:<index>` from pi-subagents AgentProgress).
 *
 * Pure Node: no Electron, no pi.
 */

import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export const TERMINAL_STATUSES = new Set(['completed', 'failed', 'detached']);

export interface ProgressRecord {
  ts: number;
  type: 'progress';
  runId: string;
  agent: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'detached';
  task: string;
  currentTool?: string;
  currentToolArgs?: unknown;
  toolCount?: number;
  turnCount?: number;
  tokens?: number;
  durationMs?: number;
  error?: string;
}

export interface OutputRecord {
  ts: number;
  type: 'output';
  runId: string;
  lines: string[];
}

export interface ControlRecord {
  ts: number;
  type: 'control';
  runId: string;
  from: string;
  to: string;
  reason: string;
  message?: string;
}

export type FleetRunRecord = ProgressRecord | OutputRecord | ControlRecord;

/** Folded view of one run: the card model. */
export interface FleetRunSummary {
  runId: string;
  agent: string;
  status: ProgressRecord['status'];
  task: string;
  currentTool?: string;
  toolCount?: number;
  tokens?: number;
  durationMs?: number;
  error?: string;
  output: string[];
  controls: ControlRecord[];
  records: FleetRunRecord[];
  startedTs: number;
  lastTs: number;
}

const LIVE_STATUSES = new Set(['pending', 'running']);

export class FleetRunStore {
  private readonly root: string;
  private readonly sessionId?: string;

  constructor(root: string, sessionId?: string) {
    this.root = root;
    this.sessionId = sessionId;
  }

  /** One JSONL file per run, optionally grouped by pi session id. */
  fileFor(runId: string): string {
    // ':' is illegal in Windows filenames (ADS syntax) — sanitize it.
    const safeRunId = runId.replace(/[^a-zA-Z0-9_-]/g, '_');
    const dir = this.sessionId ? join(this.root, this.sessionId) : this.root;
    return join(dir, `${safeRunId}.jsonl`);
  }

  /** Append one record (any of the three shapes) to the run's file. */
  appendRecord(record: FleetRunRecord): void {
    const file = this.fileFor(record.runId);
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, `${JSON.stringify(record)}\n`, { flag: 'a' });
  }

  append(record: Omit<ProgressRecord, 'type'>): void {
    this.appendRecord({ ...record, type: 'progress' });
  }

  appendOutput(runId: string, lines: string[]): void {
    if (lines.length === 0) return;
    this.appendRecord({ ts: Date.now(), type: 'output', runId, lines });
  }

  appendControl(runId: string, control: Omit<ControlRecord, 'ts' | 'type' | 'runId'>): void {
    this.appendRecord({ ts: Date.now(), type: 'control', runId, ...control });
  }

  /**
   * Close a run with a terminal status (user Stop). Reuses the last progress
   * record's identity so the folded summary hydrates as terminal, not running.
   */
  markStopped(runId: string, status: 'completed' | 'failed' | 'detached' = 'detached', error?: string): void {
    const existing = this.fold(this.transcript(runId));
    if (!existing) return;
    this.append({
      ts: Date.now(),
      runId,
      agent: existing.agent,
      status,
      task: existing.task,
      ...(existing.tokens !== undefined ? { tokens: existing.tokens } : {}),
      ...(existing.durationMs !== undefined ? { durationMs: existing.durationMs } : {}),
      ...(error || existing.error ? { error: error ?? existing.error } : {}),
    });
  }

  /** Fold a run's file into its summary; [] when the run is unknown. */
  /** Public fold for callers that already hold the records (markStopped). */
  foldRun(runId: string): FleetRunSummary | null {
    return this.fold(this.transcript(runId));
  }

  private fold(records: FleetRunRecord[]): FleetRunSummary | null {
    const progress = records.filter((r): r is ProgressRecord => r.type === 'progress');
    if (progress.length === 0) return null;
    const last = progress[progress.length - 1]!;
    const output: string[] = [];
    const controls: ControlRecord[] = [];
    for (const record of records) {
      if (record.type === 'output') output.push(...record.lines);
      else if (record.type === 'control') controls.push(record);
    }
    return {
      runId: last.runId,
      agent: last.agent,
      status: last.status,
      task: last.task,
      ...(last.currentTool ? { currentTool: last.currentTool } : {}),
      ...(last.toolCount !== undefined ? { toolCount: last.toolCount } : {}),
      ...(last.tokens !== undefined ? { tokens: last.tokens } : {}),
      ...(last.durationMs !== undefined ? { durationMs: last.durationMs } : {}),
      ...(last.error ? { error: last.error } : {}),
      output,
      controls,
      records,
      startedTs: progress[0]!.ts,
      lastTs: last.ts,
    };
  }

  /** Whole transcript of one run, oldest first. */
  transcript(runId: string): FleetRunRecord[] {
    const file = this.fileFor(runId);
    if (!existsSync(file)) return [];
    return parseJsonl(readFileSync(file, 'utf8'));
  }

  /**
   * All runs under this root, newest activity first. Filters narrow the
   * result; live cards come from memory, terminal ones hydrate from disk.
   */
  list(filter: { live?: boolean; terminal?: boolean } = {}): FleetRunSummary[] {
    const base = this.sessionId ? join(this.root, this.sessionId) : this.root;
    if (!existsSync(base)) return [];
    const runs: FleetRunSummary[] = [];
    for (const name of readdirSync(base)) {
      if (!name.endsWith('.jsonl')) continue;
      const runId = name.slice(0, -'.jsonl'.length);
      const folded = this.fold(this.transcript(runId));
      if (folded) runs.push(folded);
    }
    runs.sort((a, b) => b.lastTs - a.lastTs);
    if (filter.live) return runs.filter((r) => LIVE_STATUSES.has(r.status));
    if (filter.terminal) return runs.filter((r) => TERMINAL_STATUSES.has(r.status));
    return runs;
  }
}

function parseJsonl(raw: string): FleetRunRecord[] {
  const out: FleetRunRecord[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      out.push(JSON.parse(trimmed) as FleetRunRecord);
    } catch {
      // Corrupt line: skip, never fatal (crash-only writes etc).
    }
  }
  return out;
}
