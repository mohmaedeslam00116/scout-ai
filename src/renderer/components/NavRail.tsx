import type { ViewName } from '../App.js';

const ITEMS: { view: ViewName; label: string }[] = [
  { view: 'projects', label: 'Projects' },
  { view: 'conversations', label: 'Conversations' },
  { view: 'artifacts', label: 'Artifacts' },
  { view: 'fleet', label: 'Fleet' },
  { view: 'schedules', label: 'Schedules' },
  { view: 'settings', label: 'Settings' },
];

export function NavRail({
  active,
  onSelect,
  onNewConversation,
}: {
  active: ViewName;
  onSelect: (v: ViewName) => void;
  onNewConversation: () => void;
}) {
  return (
    <aside className="flex w-56 shrink-0 flex-col gap-4 border-r border-border bg-canvas p-3.5">
      <div className="flex items-center gap-2 px-2 py-1 text-[15px] font-semibold">
        <span className="text-accent">◈</span>
        <span>Scout AI</span>
      </div>
      <button
        onClick={onNewConversation}
        className="rounded-lg bg-accent px-3 py-2 text-center text-sm font-medium text-white hover:bg-accent/90 active:bg-accent/80"
      >
        ＋ New conversation
      </button>
      <nav className="flex flex-col gap-0.5">
        {ITEMS.map(({ view, label }) => (
          <button
            key={view}
            onClick={() => onSelect(view)}
            className={`rounded-lg px-2.5 py-2 text-left text-[13px] ${
              active === view ? 'bg-accent-soft text-accent' : 'text-ink hover:bg-surface'
            }`}
          >
            {label}
          </button>
        ))}
      </nav>
      <div className="mt-auto px-2 text-[11px] text-ink-dim">v0.1.0 — scaffold</div>
    </aside>
  );
}
