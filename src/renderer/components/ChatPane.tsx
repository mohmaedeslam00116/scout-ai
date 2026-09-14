import { useEffect, useRef, useState } from 'react';

import type { ActivityItem, ChatMessage } from '../App.js';

const MODELS = ['gpt-5.2', 'claude-sonnet-4.6', 'gemini-3.6-pro', 'nemotron-3-ultra-free'];

export function ChatPane({
  title,
  messages,
  activity,
  busy,
  model,
  onModelChange,
  onSend,
  onStop,
}: {
  title: string;
  messages: ChatMessage[];
  activity: ActivityItem[];
  busy: boolean;
  model: string;
  onModelChange: (m: string) => void;
  onSend: (text: string) => void;
  onStop: () => void;
}) {
  const [draft, setDraft] = useState('');
  const threadRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight });
  }, [messages]);

  const submit = () => {
    const text = draft.trim();
    if (!text || busy) return;
    setDraft('');
    onSend(text);
  };

  return (
    <main className="flex min-w-0 flex-1 flex-col">
      <header className="flex items-center justify-between border-b border-border px-4.5 py-2.5">
        <h1 className="text-sm font-semibold">{title}</h1>
        <select
          value={model}
          onChange={(e) => onModelChange(e.target.value)}
          className="cursor-pointer rounded-full border border-border bg-canvas px-3 py-1.5 text-xs text-ink outline-none focus:border-accent"
          aria-label="Model"
        >
          {MODELS.map((m) => (
            <option key={m} value={m}>
              model: {m}
            </option>
          ))}
        </select>
      </header>

      <div ref={threadRef} className="flex flex-1 flex-col gap-3.5 overflow-y-auto px-6.5 py-5">
        {messages.length === 0 && (
          <div className="m-auto max-w-md text-center text-sm text-ink-dim">
            <div className="mb-2 text-3xl">◈</div>
            Research anything. Ask a question, or type <kbd className="rounded border border-border bg-surface px-1">/</kbd> for
            commands.
          </div>
        )}
        {messages.map((m, i) => (
          <div
            key={i}
            className={`max-w-[76ch] text-sm leading-relaxed whitespace-pre-wrap ${
              m.role === 'user'
                ? 'self-end rounded-xl bg-accent-soft px-3.5 py-2.5'
                : `self-start ${m.streaming ? "after:content-'▍' after:opacity-60" : ''}`
            }`}
          >
            {m.text}
          </div>
        ))}
      </div>

      {activity.length > 0 && (
        <div className="mx-4.5 border-t border-dashed border-border py-2 text-xs text-ink-dim" aria-label="Agent activity">
          {activity.slice(-6).map((a, i) => (
            <div key={i} className="flex gap-2 py-0.5">
              <span className={`min-w-14 font-semibold ${a.kind === 'error' ? 'text-danger' : 'text-accent'}`}>{a.kind}</span>
              <span className="truncate">{a.text}</span>
            </div>
          ))}
        </div>
      )}

      <footer className="flex items-end gap-2.5 px-4.5 pt-3.5 pb-4.5">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          rows={1}
          placeholder="Research anything… ( / for commands, @ for sources, + for context )"
          className="max-h-40 flex-1 resize-none rounded-2xl border border-border px-3.5 py-3 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent-soft"
        />
        {busy ? (
          <button
            onClick={onStop}
            title="Stop"
            className="grid size-10 shrink-0 cursor-pointer place-items-center rounded-full bg-danger-soft text-danger hover:bg-danger/10"
          >
            ■
          </button>
        ) : (
          <button
            onClick={submit}
            title="Send"
            disabled={!draft.trim()}
            className="grid size-10 shrink-0 place-items-center rounded-full bg-accent text-white hover:bg-accent/90 disabled:opacity-40"
          >
            ↑
          </button>
        )}
      </footer>
    </main>
  );
}
