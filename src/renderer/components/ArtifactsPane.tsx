export function ArtifactsPane() {
  return (
    <aside className="flex w-70 shrink-0 flex-col overflow-y-auto border-l border-border bg-surface p-3">
      <h2 className="px-1.5 pb-2.5 text-[11px] font-semibold tracking-wider text-ink-dim uppercase">Artifacts</h2>
      <div className="rounded-xl border border-dashed border-border bg-canvas p-3 text-xs leading-relaxed text-ink-dim">
        <div className="mb-2 flex flex-col gap-1.5">
          {['Research Briefs', 'Source Dossiers', 'Evidence Tables'].map((kind) => (
            <div key={kind} className="flex items-center gap-2 rounded-lg bg-surface px-2.5 py-2 text-ink">
              <span className="text-accent">◇</span> {kind}
            </div>
          ))}
        </div>
        Artifacts the agent produces land here for review — give inline feedback before Scout acts on them.
      </div>
    </aside>
  );
}
