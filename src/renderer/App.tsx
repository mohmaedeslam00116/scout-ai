import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { getBridge, type ScoutAgentEvent } from './bridge.js';
import { NavRail } from './components/NavRail.js';
import { ConversationsPane } from './components/ConversationsPane.js';
import { ChatPane } from './components/ChatPane.js';
import { ArtifactsPane } from './components/ArtifactsPane.js';

export type ViewName = 'projects' | 'conversations' | 'artifacts' | 'fleet' | 'schedules' | 'settings';

export interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
  streaming?: boolean;
}

export interface ActivityItem {
  kind: string;
  text: string;
}

export interface Conversation {
  id: string;
  title: string;
}

let idCounter = 0;
const nextId = () => `c${++idCounter}`;

export default function App() {
  const bridge = useMemo(getBridge, []);
  const [view, setView] = useState<ViewName>('conversations');
  const [conversations, setConversations] = useState<Conversation[]>([
    { id: nextId(), title: 'New conversation' },
  ]);
  const [activeId, setActiveId] = useState<string>(() => conversations[0]?.id ?? '');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [model, setModel] = useState('gpt-5.2');
  const activityRef = useRef<HTMLDivElement | null>(null);

  const handleEvent = useCallback((event: ScoutAgentEvent) => {
    switch (event.type) {
      case 'agent_start':
        setBusy(true);
        break;
      case 'message_start':
        if (event.role === 'assistant') {
          setMessages((prev) => [...prev, { role: 'assistant', text: '', streaming: true }]);
        }
        break;
      case 'message_delta':
        setMessages((prev) => {
          const next = [...prev];
          const last = next.at(-1);
          if (last?.role === 'assistant') next[next.length - 1] = { ...last, text: last.text + event.text };
          return next;
        });
        break;
      case 'message_end':
        setMessages((prev) => {
          const next = [...prev];
          const last = next.at(-1);
          if (last?.role === 'assistant') next[next.length - 1] = { ...last, text: event.text, streaming: false };
          return next;
        });
        break;
      case 'tool_call':
        setActivity((prev) => [...prev, { kind: 'tool', text: `${event.name} ${JSON.stringify(event.args).slice(0, 100)}` }]);
        break;
      case 'tool_result':
        setActivity((prev) => [...prev, { kind: event.ok ? 'done' : 'error', text: `${event.name}: ${event.summary}` }]);
        break;
      case 'agent_end':
        setBusy(false);
        break;
    }
  }, []);

  useEffect(() => bridge?.onEvent(handleEvent), [bridge, handleEvent]);

  useEffect(() => {
    activityRef.current?.scrollTo({ top: activityRef.current.scrollHeight });
  }, [activity]);

  const send = useCallback(
    async (text: string) => {
      setMessages((prev) => [...prev, { role: 'user', text }]);
      if (!bridge) {
        // Demo mode (no Electron bridge): simulate a streamed research answer.
        setBusy(true);
        const answer = `(demo) Scout would research: “${text}” — wire the pi harness to see real answers with sources.`;
        setMessages((prev) => [...prev, { role: 'assistant', text: answer, streaming: true }]);
        for (const [kind, label] of [
          ['tool', 'web_search ×3'],
          ['done', 'fetch_content: 5 sources'],
          ['done', 'evidence-auditor: claims verified'],
        ] as const) {
          setTimeout(() => setActivity((prev) => [...prev, { kind, text: label }]), 350);
        }
        let shown = '';
        for (const chunk of answer.match(/.{1,3}/gs) ?? []) {
          shown += chunk;
          await new Promise((r) => setTimeout(r, 8));
          setMessages((prev) => {
            const next = [...prev];
            const last = next.at(-1);
            if (last?.role === 'assistant') next[next.length - 1] = { ...last, text: shown };
            return next;
          });
        }
        setMessages((prev) => {
          const next = [...prev];
          const last = next.at(-1);
          if (last?.role === 'assistant') next[next.length - 1] = { ...last, streaming: false };
          return next;
        });
        setBusy(false);
        return;
      }
      try {
        await bridge.send(text);
      } catch (err) {
        setMessages((prev) => [...prev, { role: 'assistant', text: `Error: ${(err as Error).message}` }]);
        setBusy(false);
      }
    },
    [bridge],
  );

  const newConversation = useCallback(() => {
    const conv = { id: nextId(), title: 'New conversation' };
    setConversations((prev) => [conv, ...prev]);
    setActiveId(conv.id);
    setMessages([]);
    setActivity([]);
  }, []);

  const active = conversations.find((c) => c.id === activeId);

  return (
    <div className="flex h-full">
      <NavRail active={view} onSelect={setView} onNewConversation={newConversation} />
      <ConversationsPane
        conversations={conversations}
        activeId={activeId}
        onSelect={setActiveId}
      />
      <ChatPane
        title={active?.title ?? 'New conversation'}
        messages={messages}
        activity={activity}
        busy={busy}
        model={model}
        onModelChange={setModel}
        onSend={send}
        onStop={() => void bridge?.abort()}
      />
      <ArtifactsPane />
    </div>
  );
}
