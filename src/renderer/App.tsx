import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { getBridge, type ScoutAgentEvent } from './bridge.js';
import type { Artifact } from './artifacts.js';
import type { FleetRun } from './fleet.js';
import { NavRail } from './components/NavRail.js';
import { ConversationsPane } from './components/ConversationsPane.js';
import { ChatPane } from './components/ChatPane.js';
import { ArtifactsPane } from './components/ArtifactsPane.js';
import { FleetView } from './components/FleetView.js';

export type ViewName = 'projects' | 'conversations' | 'artifacts' | 'fleet' | 'schedules' | 'settings';

export interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
  streaming?: boolean;
  /** Fleet run ids this assistant turn delegated to (renders inline chips). */
  runIds?: string[];
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

let artifactCounter = 0;
const nextArtifactId = () => `a${++artifactCounter}`;

let runCounter = 0;
const nextRunId = () => `r${++runCounter}`;

function demoArtifact(): Artifact {
  return {
    id: nextArtifactId(),
    kind: 'research-brief',
    title: 'pi agent harness — overview',
    status: 'review',
    versions: [
      {
        version: 1,
        createdAt: Date.now(),
        body: '## Draft Research Brief\n\n1. pi is an agent harness by Earendil Works…\n2. Key packages: pi-agent-core, pi-ai…\n3. Sources: pi.dev, github.com/earendil-works/pi',
      },
    ],
    comments: [],
  };
}

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
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [runs, setRuns] = useState<FleetRun[]>([]);
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
        // Demo mode (no Electron bridge): simulate a streamed research answer
        // with a Fleet delegation so the UI is reviewable without the harness.
        setBusy(true);
        setTimeout(() => setArtifacts((prev) => [...prev, demoArtifact()]), 600);
        const runId = nextRunId();
        setRuns((prev) => [
          ...prev,
          { id: runId, agent: 'researcher', task: `Research: ${text.slice(0, 60)}`, state: 'running', transcript: [] },
        ]);
        const lines = ['searching: exa ×3', 'fetched 5 sources', 'extracting evidence…', 'draft complete'];
        lines.forEach((line, i) =>
          setTimeout(() => {
            setRuns((prev) =>
              prev.map((r) =>
                r.id === runId
                  ? { ...r, transcript: [...r.transcript, line], state: i === lines.length - 1 ? ('done' as const) : r.state }
                  : r,
              ),
            );
          }, 500 + i * 700),
        );
        setMessages((prev) => [
          ...prev,
          { role: 'assistant', text: '', streaming: true, runIds: [runId] },
        ]);
        const answer = `(demo) Scout would research: “${text}” — wire the pi harness to see real answers with sources.`;
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

  const approveArtifact = useCallback((id: string) => {
    setArtifacts((prev) => prev.map((a) => (a.id === id ? { ...a, status: 'approved' as const } : a)));
  }, []);

  const commentArtifact = useCallback((id: string, text: string) => {
    setArtifacts((prev) =>
      prev.map((a) =>
        a.id === id
          ? {
              ...a,
              comments: [...a.comments, { id: `k${Date.now()}`, text, ts: Date.now() }],
              // Demo of the revise-in-place loop: feedback produces the next version.
              versions: [
                ...a.versions,
                {
                  version: a.versions.length + 1,
                  createdAt: Date.now(),
                  body: `${a.versions.at(-1)?.body ?? ''}\n\n## Revision (after feedback)\n- Addressed: “${text}”`,
                },
              ],
            }
          : a,
      ),
    );
  }, []);

  const openTranscript = useCallback(
    (id: string) => {
      const run = runs.find((r) => r.id === id);
      if (run) {
        setMessages((prev) => [
          ...prev,
          {
            role: 'user',
            text: `Transcript of ${run.agent} (${run.state}):\n${run.transcript.join('\n') || '(empty)'}`,
          },
        ]);
        setView('conversations');
      }
    },
    [runs],
  );

  const steerRun = useCallback((id: string, text: string) => {
    setRuns((prev) => prev.map((r) => (r.id === id ? { ...r, transcript: [...r.transcript, `↳ steered: ${text}`] } : r)));
  }, []);

  const stopRun = useCallback((id: string) => {
    setRuns((prev) => prev.map((r) => (r.id === id && r.state === 'running' ? { ...r, state: 'stopped' as const } : r)));
  }, []);

  const openRunFromChat = useCallback((id: string) => {
    setView('fleet');
  }, []);

  const active = conversations.find((c) => c.id === activeId);

  return (
    <div className="flex h-full">
      <NavRail active={view} onSelect={setView} onNewConversation={newConversation} />
      <ConversationsPane conversations={conversations} activeId={activeId} onSelect={setActiveId} />
      {view === 'fleet' ? (
        <FleetView runs={runs} onOpenTranscript={openTranscript} onSteer={steerRun} onStop={stopRun} />
      ) : (
        <ChatPane
          title={active?.title ?? 'New conversation'}
          messages={messages}
          activity={activity}
          busy={busy}
          model={model}
          runs={runs}
          onModelChange={setModel}
          onSend={send}
          onStop={() => void bridge?.abort()}
          onOpenRun={openRunFromChat}
        />
      )}
      <ArtifactsPane artifacts={artifacts} onApprove={approveArtifact} onComment={commentArtifact} />
    </div>
  );
}
