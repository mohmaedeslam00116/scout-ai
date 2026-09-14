import type { Conversation } from '../App.js';

export function ConversationsPane({
  conversations,
  activeId,
  onSelect,
}: {
  conversations: Conversation[];
  activeId: string;
  onSelect: (id: string) => void;
}) {
  return (
    <section className="flex w-60 shrink-0 flex-col overflow-y-auto border-r border-border bg-surface p-3">
      <h2 className="px-1.5 pb-2.5 text-[11px] font-semibold tracking-wider text-ink-dim uppercase">
        Conversations
      </h2>
      <ul className="flex flex-col gap-0.5">
        {conversations.map((c) => (
          <li key={c.id}>
            <button
              onClick={() => onSelect(c.id)}
              className={`w-full truncate rounded-lg px-2.5 py-2 text-left text-[13px] ${
                c.id === activeId ? 'bg-accent-soft text-accent' : 'text-ink hover:bg-surface-2'
              }`}
              title={c.title}
            >
              {c.title}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
