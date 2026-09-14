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
    <aside className="flex w-52 shrink-0 flex-col gap-4 border-r border-line bg-canvas p-3">
      <div className="flex items-center gap-2 px-2 py-1">
        <span className="grid size-6 place-items-center rounded-full bg-ink text-[13px] leading-none text-canvas">
          ◈
        </span>
        <span className="text-[15px] font-semibold tracking-tight text-ink">Scout AI</span>
      </div>

      <button
        onClick={onNewConversation}
        className="btn btn-primary w-full"
        title="Start a new research conversation (Ctrl+N)"
      >
        New conversation
      </button>

      <nav className="flex flex-col gap-0.5" aria-label="Sections">
        {ITEMS.map(({ view, label }) => (
          <button
            key={view}
            onClick={() => onSelect(view)}
            aria-current={active === view ? 'page' : undefined}
            className={`rounded-full px-3 py-1.5 text-left text-[13px] transition-colors duration-150 ${
              active === view
                ? 'bg-surface-3 font-medium text-ink'
                : 'text-ink-mid hover:bg-surface-2 hover:text-ink'
            }`}
          >
            {label}
          </button>
        ))}
      </nav>

      <div className="mt-auto px-2 text-[11px] text-ink-dim">v0.1.0</div>
    </aside>
  );
}
