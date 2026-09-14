import { useMemo, useState } from 'react';

import type { Conversation, ProjectGroup } from '../App.js';

export function ConversationsPane({
  groups,
  activeId,
  onSelect,
  onRename,
  onArchive,
  onMove,
  moveTargets,
}: {
  /** Ordered groups: projects, then scratch. */
  groups: ProjectGroup[];
  activeId: string;
  onSelect: (groupId: string, id: string) => void;
  onRename: (groupId: string, convo: Conversation, name: string) => void;
  onArchive: (groupId: string, convo: Conversation, archived: boolean) => void;
  /** Move a scratch conversation into a project (scratch group only). */
  onMove: (convo: Conversation, projectId: string) => void;
  /** Projects available as move targets (id + name). */
  moveTargets: { id: string; name: string }[];
}) {
  const [query, setQuery] = useState('');
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ key: string; value: string } | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  const filtered = useMemo(
    () =>
      groups.map((g) => ({
        ...g,
        conversations: g.conversations.filter(
          (c) =>
            c.title.toLowerCase().includes(query.toLowerCase()) &&
            (showArchived || !c.archived),
        ),
      })),
    [groups, query, showArchived],
  );

  return (
    <section className="flex w-64 shrink-0 flex-col border-r border-line bg-surface">
      <div className="flex flex-col gap-2.5 p-3">
        <div className="flex items-center justify-between px-1">
          <h2 className="pane-header">Conversations</h2>
          <button
            onClick={() => setShowArchived((v) => !v)}
            className={`rounded-full px-2 py-0.5 text-[11px] transition-colors duration-150 ${
              showArchived ? 'bg-surface-3 text-ink' : 'text-ink-dim hover:text-ink'
            }`}
            aria-pressed={showArchived}
          >
            Archived
          </button>
        </div>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search"
          aria-label="Search conversations"
          className="w-full rounded-full border border-line bg-surface-2 px-3 py-1.5 text-[13px] text-ink placeholder:text-ink-dim outline-none transition-colors duration-150 focus:border-line-strong"
        />
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-3">
        {filtered.map((group) => (
          <div key={group.id} className="mb-2">
            <div className="px-3 py-1 text-[11px] font-medium uppercase tracking-wide text-ink-dim">
              {group.name}
            </div>
            <ul className="flex flex-col gap-0.5">
              {group.conversations.map((c) => {
                const key = `${group.id}:${c.id}`;
                return (
                  <li key={key} className="group relative">
                    {renaming?.key === key ? (
                      <input
                        autoFocus
                        value={renaming.value}
                        onChange={(e) => setRenaming({ key, value: e.target.value })}
                        onBlur={() => {
                          const trimmed = renaming.value.trim();
                          if (trimmed && trimmed !== c.title) onRename(group.id, c, trimmed);
                          setRenaming(null);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                          if (e.key === 'Escape') setRenaming(null);
                        }}
                        aria-label="Conversation name"
                        className="w-full rounded-full border border-line-strong bg-surface-2 px-3 py-1.5 text-[13px] text-ink outline-none"
                      />
                    ) : (
                      <div className="flex items-center">
                        <button
                          onClick={() => onSelect(group.id, c.id)}
                          aria-current={c.id === activeId ? 'true' : undefined}
                          className={`min-w-0 flex-1 truncate rounded-full px-3 py-1.5 text-left text-[13px] transition-colors duration-150 ${
                            c.id === activeId
                              ? 'bg-surface-3 font-medium text-ink'
                              : 'text-ink-mid hover:bg-surface-2 hover:text-ink'
                          }`}
                          title={c.title}
                        >
                          {c.archived ? '🗄 ' : ''}
                          {c.title}
                        </button>
                        <button
                          onClick={() => setMenuFor(menuFor === key ? null : key)}
                          aria-label={`Conversation options for ${c.title}`}
                          className="shrink-0 rounded-full px-1.5 text-[12px] text-ink-dim opacity-0 transition-opacity duration-150 hover:text-ink group-hover:opacity-100"
                        >
                          ⋯
                        </button>
                      </div>
                    )}
                    {menuFor === key && (
                      <div className="absolute right-1 z-20 mt-1 w-44 rounded-lg border border-line bg-surface p-1 shadow-lg">
                        <button
                          onClick={() => {
                            setRenaming({ key, value: c.title });
                            setMenuFor(null);
                          }}
                          className="w-full rounded-md px-2.5 py-1.5 text-left text-[13px] text-ink-mid hover:bg-surface-2 hover:text-ink"
                        >
                          Rename
                        </button>
                        <button
                          onClick={() => {
                            onArchive(group.id, c, !c.archived);
                            setMenuFor(null);
                          }}
                          className="w-full rounded-md px-2.5 py-1.5 text-left text-[13px] text-ink-mid hover:bg-surface-2 hover:text-ink"
                        >
                          {c.archived ? 'Unarchive' : 'Archive'}
                        </button>
                        {group.id === 'scratch' && moveTargets.length > 0 && (
                          <>
                            <div className="mt-1 border-t border-line pt-1" />
                            <div className="px-2.5 py-1 text-[11px] text-ink-dim">Move to project</div>
                            {moveTargets.map((t) => (
                              <button
                                key={t.id}
                                onClick={() => {
                                  onMove(c, t.id);
                                  setMenuFor(null);
                                }}
                                className="w-full truncate rounded-md px-2.5 py-1.5 text-left text-[13px] text-ink-mid hover:bg-surface-2 hover:text-ink"
                                title={t.name}
                              >
                                {t.name}
                              </button>
                            ))}
                          </>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
              {group.conversations.length === 0 && (
                <li className="px-3 py-1.5 text-[13px] text-ink-dim">No conversations yet.</li>
              )}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

export type { Conversation };
