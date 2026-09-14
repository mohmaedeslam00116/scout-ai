import { useState } from 'react';

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
  const [query, setQuery] = useState('');
  const shown = conversations.filter((c) => c.title.toLowerCase().includes(query.toLowerCase()));

  return (
    <section className="flex w-64 shrink-0 flex-col border-r border-line bg-surface">
      <div className="flex flex-col gap-2.5 p-3">
        <h2 className="pane-header px-1">Conversations</h2>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search"
          aria-label="Search conversations"
          className="w-full rounded-full border border-line bg-surface-2 px-3 py-1.5 text-[13px] text-ink placeholder:text-ink-dim outline-none transition-colors duration-150 focus:border-line-strong"
        />
      </div>

      <ul className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-2 pb-3">
        {shown.map((c) => (
          <li key={c.id}>
            <button
              onClick={() => onSelect(c.id)}
              aria-current={c.id === activeId ? 'true' : undefined}
              className={`w-full truncate rounded-full px-3 py-1.5 text-left text-[13px] transition-colors duration-150 ${
                c.id === activeId
                  ? 'bg-surface-3 font-medium text-ink'
                  : 'text-ink-mid hover:bg-surface-2 hover:text-ink'
              }`}
              title={c.title}
            >
              {c.title}
            </button>
          </li>
        ))}
        {shown.length === 0 && (
          <li className="px-3 py-2 text-[13px] text-ink-dim">No matches.</li>
        )}
      </ul>
    </section>
  );
}
