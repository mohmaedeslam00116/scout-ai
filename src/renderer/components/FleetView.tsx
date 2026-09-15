import { useState } from 'react';

import { STATE_LABELS, type FleetRun, type RunState } from '../fleet.js';

const STATE_BADGE: Record<RunState, string> = {
  queued: 'badge-neutral',
  running: 'badge-review',
  done: 'badge-done',
  stopped: 'badge-neutral',
  error: 'badge-danger',
};

function RunCard({
  run,
  onOpenTranscript,
  onSteer,
  onStop,
}: {
  run: FleetRun;
  onOpenTranscript: (id: string) => void;
  onSteer: (id: string, text: string) => void;
  onStop: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const live = run.state === 'running' || run.state === 'queued';

  return (
    <div className="card overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left transition-colors duration-150 hover:bg-surface-3"
      >
        <span className={`size-2 shrink-0 rounded-full ${run.state === 'running' ? 'live-dot' : 'bg-surface-3'}`} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium text-ink">{run.agent}</span>
          <span className="block truncate text-[11px] text-ink-dim" title={run.task}>
            {run.task}
          </span>
        </span>
        <span className="shrink-0 font-mono text-[10px] text-ink-dim">
          {run.currentTool ? `${run.currentTool} · ` : ''}
          {run.tokens !== undefined ? `${run.tokens.toLocaleString()} tok · ` : ''}
          {run.durationMs !== undefined ? `${Math.round(run.durationMs / 1000)}s` : ''}
        </span>
        <span className={`badge ${STATE_BADGE[run.state]}`}>{STATE_LABELS[run.state]}</span>
      </button>

      {open && (
        <div className="border-t border-line px-3 py-2.5">
          <div className="well max-h-44 overflow-y-auto px-2.5 py-2" aria-live="polite">
            {run.transcript.length === 0 ? (
              <div className="text-ink-dim">no output yet…</div>
            ) : (
              run.transcript.map((line, i) => (
                <div key={i} className="text-ink-mid">
                  {line}
                </div>
              ))
            )}
          </div>

          {live && (
            <div className="mt-2 flex items-center gap-1.5">
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && draft.trim()) {
                    onSteer(run.id, draft.trim());
                    setDraft('');
                  }
                }}
                placeholder="Steer this agent…"
                aria-label="Steer agent"
                className="min-w-0 flex-1 rounded-full border border-line bg-surface-2 px-3 py-1.5 text-xs text-ink placeholder:text-ink-dim outline-none transition-colors duration-150 focus:border-line-strong"
              />
              <button onClick={() => onStop(run.id)} className="btn btn-danger">
                Stop
              </button>
            </div>
          )}
          {!live && (
            <button onClick={() => onOpenTranscript(run.id)} className="btn btn-ghost mt-2">
              Open full transcript
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function FleetView({
  runs,
  onOpenTranscript,
  onSteer,
  onStop,
}: {
  runs: FleetRun[];
  onOpenTranscript: (id: string) => void;
  onSteer: (id: string, text: string) => void;
  onStop: (id: string) => void;
}) {
  const active = runs.filter((r) => r.state === 'running' || r.state === 'queued').length;

  return (
    <section className="flex min-w-0 flex-1 flex-col overflow-y-auto bg-canvas">
      <header className="flex items-center justify-between border-b border-line px-5 py-2.5">
        <h1 className="text-[15px] font-semibold tracking-tight text-ink">Fleet</h1>
        {active > 0 && <span className="badge badge-review">{active} active</span>}
      </header>
      <div className="mx-auto w-full max-w-2xl p-4">
        {runs.length === 0 ? (
          <div className="card p-6 text-center text-sm text-ink-dim">
            <div className="mb-2 grid mx-auto size-10 place-items-center rounded-full border border-line-strong bg-surface-2 text-ink-mid">
              ⚡
            </div>
            No subagent runs yet. Scout delegates to researcher, evidence-auditor and reviewer
            children automatically when a task benefits from it.
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {runs.map((r) => (
              <li key={r.id}>
                <RunCard run={r} onOpenTranscript={onOpenTranscript} onSteer={onSteer} onStop={onStop} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
