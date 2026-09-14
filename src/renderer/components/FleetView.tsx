import { useState } from 'react';

import { STATE_LABELS, STATE_STYLES, type FleetRun } from '../fleet.js';

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
    <div className="rounded-xl border border-border bg-canvas">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left hover:bg-surface"
      >
        <span className={`size-2 shrink-0 rounded-full ${run.state === 'running' ? 'animate-pulse bg-accent' : 'bg-surface-2'}`} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium text-ink">{run.agent}</span>
          <span className="block truncate text-[11px] text-ink-dim" title={run.task}>
            {run.task}
          </span>
        </span>
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${STATE_STYLES[run.state]}`}>
          {STATE_LABELS[run.state]}
        </span>
      </button>

      {open && (
        <div className="border-t border-border px-3 py-2.5">
          <div className="max-h-44 overflow-y-auto rounded-lg bg-surface px-2.5 py-2 font-mono text-[11px] leading-relaxed text-ink">
            {run.transcript.length === 0 ? <div className="text-ink-dim">no output yet…</div> : run.transcript.map((line, i) => <div key={i}>{line}</div>)}
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
                className="min-w-0 flex-1 rounded-lg border border-border px-2 py-1.5 text-xs outline-none focus:border-accent"
              />
              <button
                onClick={() => onStop(run.id)}
                className="rounded-lg bg-danger-soft px-2.5 py-1.5 text-xs font-medium text-danger hover:bg-danger/10"
              >
                Stop
              </button>
            </div>
          )}
          {!live && (
            <button
              onClick={() => onOpenTranscript(run.id)}
              className="mt-2 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-ink hover:bg-surface"
            >
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
      <header className="flex items-center justify-between border-b border-border px-4.5 py-2.5">
        <h1 className="text-sm font-semibold">Fleet</h1>
        {active > 0 && (
          <span className="rounded-full bg-accent-soft px-2.5 py-0.5 text-[11px] font-semibold text-accent">
            {active} active
          </span>
        )}
      </header>
      <div className="mx-auto w-full max-w-2xl p-4">
        {runs.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-surface p-6 text-center text-sm text-ink-dim">
            <div className="mb-1 text-2xl">⚡</div>
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
