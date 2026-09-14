import { useState } from 'react';

import { KIND_ICONS, KIND_LABELS, type Artifact, type ArtifactKind } from '../artifacts.js';

function formatWhen(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function ArtifactCard({
  artifact,
  onApprove,
  onComment,
}: {
  artifact: Artifact;
  onApprove: (id: string) => void;
  onComment: (id: string, text: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const latest = artifact.versions.at(-1);

  return (
    <div className="rounded-xl border border-border bg-canvas">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left hover:bg-surface"
      >
        <span className="text-accent">{KIND_ICONS[artifact.kind]}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] text-ink" title={artifact.title}>
            {artifact.title}
          </span>
          <span className="block text-[11px] text-ink-dim">
            {KIND_LABELS[artifact.kind]} · v{latest?.version ?? 0} · {formatWhen(latest?.createdAt ?? Date.now())}
          </span>
        </span>
        {artifact.status === 'review' && (
          <span className="rounded-full bg-danger-soft px-2 py-0.5 text-[10px] font-semibold text-danger">
            REVIEW
          </span>
        )}
        {artifact.status === 'approved' && (
          <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[10px] font-semibold text-accent">
            ✓
          </span>
        )}
      </button>

      {open && (
        <div className="border-t border-border px-3 py-2.5">
          <div className="max-h-40 overflow-y-auto text-xs leading-relaxed whitespace-pre-wrap text-ink">
            {latest?.body}
          </div>

          {artifact.status === 'review' && (
            <div className="mt-2.5 flex flex-col gap-1.5">
              {artifact.comments.length > 0 && (
                <ul className="flex flex-col gap-1">
                  {artifact.comments.map((c) => (
                    <li key={c.id} className="rounded-lg bg-surface px-2 py-1.5 text-[11px] text-ink">
                      {c.text}
                    </li>
                  ))}
                </ul>
              )}
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={2}
                placeholder="Inline feedback — the agent revises and re-requests review…"
                className="resize-none rounded-lg border border-border px-2 py-1.5 text-xs outline-none focus:border-accent"
              />
              <div className="flex items-center justify-between gap-2">
                <button
                  onClick={() => {
                    const text = draft.trim();
                    if (!text) return;
                    setDraft('');
                    onComment(artifact.id, text);
                  }}
                  className="rounded-lg bg-accent px-2.5 py-1.5 text-xs font-medium text-white hover:bg-accent/90"
                >
                  Send feedback
                </button>
                <button
                  onClick={() => onApprove(artifact.id)}
                  className="rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-ink hover:bg-surface"
                >
                  Approve ▸
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function ArtifactsPane({
  artifacts,
  onApprove,
  onComment,
}: {
  artifacts: Artifact[];
  onApprove: (id: string) => void;
  onComment: (id: string, text: string) => void;
}) {
  const reviewCount = artifacts.filter((a) => a.status === 'review').length;

  return (
    <aside className="flex w-70 shrink-0 flex-col overflow-y-auto border-l border-border bg-surface p-3">
      <div className="flex items-center justify-between px-1.5 pb-2.5">
        <h2 className="text-[11px] font-semibold tracking-wider text-ink-dim uppercase">Artifacts</h2>
        {reviewCount > 0 && (
          <span className="rounded-full bg-danger-soft px-2 py-0.5 text-[10px] font-semibold text-danger">
            {reviewCount} awaiting review
          </span>
        )}
      </div>

      {artifacts.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-canvas p-3 text-xs leading-relaxed text-ink-dim">
          <div className="mb-2 flex flex-col gap-1.5">
            {(Object.keys(KIND_LABELS) as ArtifactKind[]).map((kind) => (
              <div key={kind} className="flex items-center gap-2 rounded-lg bg-surface px-2.5 py-2 text-ink">
                <span className="text-accent">{KIND_ICONS[kind]}</span> {KIND_LABELS[kind]}
              </div>
            ))}
          </div>
          Scout creates these as it researches — or ask with <span className="font-mono">/brief</span>,{' '}
          <span className="font-mono">/sources</span>, <span className="font-mono">/evidence</span>.
        </div>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {artifacts.map((a) => (
            <li key={a.id}>
              <ArtifactCard artifact={a} onApprove={onApprove} onComment={onComment} />
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
