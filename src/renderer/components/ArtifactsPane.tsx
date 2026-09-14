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
    <div className="card overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-2.5 py-2 text-left transition-colors duration-150 hover:bg-surface-3"
      >
        <span className="text-accent-bright">{KIND_ICONS[artifact.kind]}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] text-ink" title={artifact.title}>
            {artifact.title}
          </span>
          <span className="block text-[11px] text-ink-dim">
            {KIND_LABELS[artifact.kind]} · v{latest?.version ?? 0} · {formatWhen(latest?.createdAt ?? Date.now())}
          </span>
        </span>
        {artifact.status === 'review' && <span className="badge badge-review">Review</span>}
        {artifact.status === 'approved' && <span className="badge badge-done">✓ Approved</span>}
      </button>

      {open && (
        <div className="border-t border-line px-3 py-2.5">
          <div className="well max-h-44 overflow-y-auto px-2.5 py-2 whitespace-pre-wrap text-ink-mid">
            {latest?.body}
          </div>

          {artifact.status === 'review' && (
            <div className="mt-2.5 flex flex-col gap-1.5">
              {artifact.comments.length > 0 && (
                <ul className="flex flex-col gap-1">
                  {artifact.comments.map((c) => (
                    <li key={c.id} className="rounded-[8px] bg-surface-3 px-2 py-1.5 text-[11px] leading-relaxed text-ink-mid">
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
                aria-label="Artifact feedback"
                className="resize-none rounded-[8px] border border-line bg-surface-2 px-2 py-1.5 text-xs text-ink placeholder:text-ink-dim outline-none transition-colors duration-150 focus:border-line-strong"
              />
              <div className="flex items-center justify-between gap-2">
                <button
                  onClick={() => {
                    const text = draft.trim();
                    if (!text) return;
                    setDraft('');
                    onComment(artifact.id, text);
                  }}
                  className="btn btn-primary"
                >
                  Send feedback
                </button>
                <button onClick={() => onApprove(artifact.id)} className="btn btn-ghost">
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
    <aside className="flex w-72 shrink-0 flex-col border-l border-line bg-surface">
      <div className="flex items-center justify-between px-3 pt-3 pb-2.5">
        <h2 className="pane-header px-1">Artifacts</h2>
        {reviewCount > 0 && (
          <span className="badge badge-review">{reviewCount} awaiting review</span>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-3 pb-3">
        {artifacts.length === 0 ? (
          <div className="card p-3 text-xs leading-relaxed text-ink-dim">
            <div className="mb-2 flex flex-col gap-1.5">
              {(Object.keys(KIND_LABELS) as ArtifactKind[]).map((kind) => (
                <div key={kind} className="flex items-center gap-2 rounded-[8px] bg-surface-2 px-2.5 py-2 text-ink-mid">
                  <span className="text-accent-bright">{KIND_ICONS[kind]}</span> {KIND_LABELS[kind]}
                </div>
              ))}
            </div>
            Scout creates these as it researches — or ask with{' '}
            <span className="font-mono text-ink-mid">/brief</span>,{' '}
            <span className="font-mono text-ink-mid">/sources</span>,{' '}
            <span className="font-mono text-ink-mid">/evidence</span>.
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {artifacts.map((a) => (
              <li key={a.id}>
                <ArtifactCard artifact={a} onApprove={onApprove} onComment={onComment} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}
