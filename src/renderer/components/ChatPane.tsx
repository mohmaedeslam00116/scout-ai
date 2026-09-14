import { useEffect, useRef, useState } from 'react';

import type { ActivityItem, ChatMessage } from '../App.js';
import type { FleetRun } from '../fleet.js';

const MODELS = ['nemotron-3-ultra-free', 'gpt-5.2', 'claude-sonnet-4.6', 'gemini-3.6-pro'];

function activityTone(kind: string): string {
  if (kind === 'error') return 'text-danger';
  if (kind === 'tool') return 'text-accent-bright';
  return 'text-success';
}

export function ChatPane({
  title,
  messages,
  activity,
  busy,
  model,
  runs,
  onModelChange,
  onSend,
  onStop,
  onOpenRun,
}: {
  title: string;
  messages: ChatMessage[];
  activity: ActivityItem[];
  busy: boolean;
  model: string;
  runs: FleetRun[];
  onModelChange: (m: string) => void;
  onSend: (text: string) => void;
  onStop: () => void;
  onOpenRun: (id: string) => void;
}) {
  const [draft, setDraft] = useState('');
  const threadRef = useRef<HTMLDivElement | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);

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
    <main className="flex min-w-0 flex-1 flex-col bg-canvas">
      <header className="flex items-center justify-between border-b border-line px-5 py-2.5">
        <h1 className="text-[15px] font-semibold tracking-tight text-ink">{title}</h1>
        <select
          value={model}
          onChange={(e) => onModelChange(e.target.value)}
          className="cursor-pointer rounded-full border border-line bg-surface-2 px-3 py-1.5 text-xs text-ink-mid outline-none transition-colors duration-150 hover:border-line-strong hover:text-ink focus:border-accent"
          aria-label="Model"
        >
          {MODELS.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </header>

      <div ref={threadRef} className="flex flex-1 flex-col gap-4 overflow-y-auto px-7 py-6">
        {messages.length === 0 && (
          <div className="m-auto flex max-w-md flex-col items-center gap-3 text-center">
            <div className="grid size-12 place-items-center rounded-full border border-line-strong bg-surface-2 text-xl text-ink-mid">
              ◈
            </div>
            <div className="text-[15px] font-medium text-ink">Research anything</div>
            <div className="text-[13px] leading-relaxed text-ink-dim">
              Ask a question, or type{' '}
              <kbd className="rounded-full border border-line bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-ink-mid">/</kbd>{' '}
              for commands,{' '}
              <kbd className="rounded-full border border-line bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-ink-mid">@</kbd>{' '}
              for sources,{' '}
              <kbd className="rounded-full border border-line bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-ink-mid">+</kbd>{' '}
              for context.
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} className={`flex max-w-[76ch] flex-col gap-1.5 msg-enter`}>
            {m.role === 'user' ? (
              <div className="self-end rounded-[16px] rounded-br-[6px] bg-surface-2 px-4 py-2.5 text-sm leading-relaxed text-ink">
                {m.text}
              </div>
            ) : (
              <>
                <div
                  className={`self-start text-sm leading-relaxed whitespace-pre-wrap text-ink ${
                    m.streaming ? 'caret' : ''
                  }`}
                >
                  {m.text}
                </div>
                {m.runIds && m.runIds.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 self-start">
                    {m.runIds.map((runId) => {
                      const run = runs.find((r) => r.id === runId);
                      if (!run) return null;
                      return (
                        <button
                          key={runId}
                          onClick={() => onOpenRun(runId)}
                          className="badge badge-neutral gap-1.5 !py-0.5 !text-[11px] !normal-case hover:bg-surface-3 hover:text-ink"
                          title={`${run.task} — open in Fleet`}
                        >
                          <span
                            className={`size-1.5 rounded-full ${
                              run.state === 'running' ? 'live-dot' : 'bg-ink-dim'
                            }`}
                          />
                          {run.agent}
                          <span className="font-normal opacity-70">· {run.state}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </>
            )}
          </div>
        ))}
      </div>

      {activity.length > 0 && (
        <div
          className="well mx-5 mb-1 max-h-24 overflow-y-auto px-3 py-2 !text-[11px]"
          aria-label="Agent activity"
        >
          {activity.slice(-6).map((a, i) => (
            <div key={i} className="flex gap-2 py-0.5">
              <span className={`min-w-14 shrink-0 font-semibold ${activityTone(a.kind)}`}>{a.kind}</span>
              <span className="truncate text-ink-mid">{a.text}</span>
            </div>
          ))}
        </div>
      )}

      <footer className="px-5 pt-2 pb-5">
        <div className="flex items-end gap-2.5 rounded-[16px] border border-line bg-surface-2 p-2 transition-colors duration-150 focus-within:border-line-strong">
          <textarea
            ref={composerRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            rows={1}
            placeholder="Research anything…"
            aria-label="Message Scout"
            className="max-h-40 flex-1 resize-none bg-transparent px-2.5 py-2 text-sm text-ink placeholder:text-ink-dim outline-none"
          />
          {busy ? (
            <button onClick={onStop} title="Stop the agent" className="btn-icon btn-icon-stop" aria-label="Stop the agent">
              <span className="block size-3 rounded-[2px] bg-current" />
            </button>
          ) : (
            <button
              onClick={submit}
              title="Send"
              disabled={!draft.trim()}
              className="btn-icon btn-icon-send"
              aria-label="Send"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="M8 13V3M8 3L3.5 7.5M8 3l4.5 4.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          )}
        </div>
        <div className="mt-1.5 px-2 text-[11px] text-ink-dim">
          Enter to send · Shift+Enter for a new line
        </div>
      </footer>
    </main>
  );
}
