import { useState } from 'react';

import type { ProjectView } from '../bridge.js';

/** Minimal project management surface (T01): create, rename, open, delete. */
export function ProjectsPane({
  projects,
  onCreate,
  onDelete,
  onOpen,
  onRename,
}: {
  projects: ProjectView[];
  onCreate: (name: string) => void;
  onDelete: (id: string) => void;
  onOpen: (id: string) => void;
  onRename: (id: string, name: string) => void;
}) {
  const [name, setName] = useState('');
  const [renaming, setRenaming] = useState<{ id: string; value: string } | null>(null);

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onCreate(trimmed);
    setName('');
  };

  const commitRename = () => {
    if (!renaming) return;
    const trimmed = renaming.value.trim();
    if (trimmed) onRename(renaming.id, trimmed);
    setRenaming(null);
  };

  return (
    <section className="flex w-64 shrink-0 flex-col border-r border-line bg-surface">
      <div className="flex flex-col gap-2.5 p-3">
        <h2 className="pane-header px-1">Projects</h2>
        <div className="flex gap-1.5">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit();
            }}
            placeholder="New project name"
            aria-label="New project name"
            className="w-full rounded-full border border-line bg-surface-2 px-3 py-1.5 text-[13px] text-ink placeholder:text-ink-dim outline-none transition-colors duration-150 focus:border-line-strong"
          />
          <button onClick={submit} className="btn btn-primary shrink-0">
            Create
          </button>
        </div>
      </div>

      <ul className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-2 pb-3">
        {projects.map((p) =>
          renaming?.id === p.id ? (
            <li key={p.id}>
              <input
                autoFocus
                value={renaming.value}
                onChange={(e) => setRenaming({ id: p.id, value: e.target.value })}
                onBlur={commitRename}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitRename();
                  if (e.key === 'Escape') setRenaming(null);
                }}
                aria-label="Project name"
                className="w-full rounded-lg border border-line-strong bg-surface-2 px-2 py-1.5 text-[13px] text-ink outline-none"
              />
            </li>
          ) : (
            <li key={p.id} className="group">
              <div className="flex items-center gap-1 rounded-lg px-2 py-1.5 hover:bg-surface-2">
                <button
                  onClick={() => onOpen(p.id)}
                  className="min-w-0 flex-1 truncate text-left text-[13px] text-ink-mid transition-colors duration-150 hover:text-ink"
                  title={p.name}
                >
                  {p.name}
                </button>
                <button
                  onClick={() => setRenaming({ id: p.id, value: p.name })}
                  aria-label={`Rename project ${p.name}`}
                  className="shrink-0 rounded-full px-1.5 text-[12px] text-ink-dim opacity-0 transition-opacity duration-150 hover:text-ink group-hover:opacity-100"
                >
                  ✎
                </button>
                <button
                  onClick={() => {
                    if (window.confirm(`Delete project “${p.name}” and everything in it?`)) onDelete(p.id);
                  }}
                  aria-label={`Delete project ${p.name}`}
                  className="shrink-0 rounded-full px-1.5 text-[12px] text-ink-dim opacity-0 transition-opacity duration-150 hover:text-danger group-hover:opacity-100"
                >
                  ✕
                </button>
              </div>
            </li>
          ),
        )}
        {projects.length === 0 && (
          <li className="px-3 py-2 text-[13px] text-ink-dim">No projects yet.</li>
        )}
      </ul>
    </section>
  );
}
