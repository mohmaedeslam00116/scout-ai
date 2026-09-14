import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { getBridge, type ScoutAgentEvent, type ScoutSendTarget, type ProjectView, type ConversationSummary } from './bridge.js';
import type { Artifact } from './artifacts.js';
import type { FleetRun } from './fleet.js';
import { NavRail } from './components/NavRail.js';
import { ConversationsPane } from './components/ConversationsPane.js';
import { ProjectsPane } from './components/ProjectsPane.js';
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
  /** Path of the stored session jsonl (real mode), empty in demo mode. */
  path?: string;
}

/** A sidebar group: one per project, plus the scratch group. */
export interface ProjectGroup {
  id: string; // group id: 'scratch' or the project id
  name: string;
  conversations: Conversation[];
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

function titleFor(convo: ConversationSummary): string {
  return convo.name ?? (convo.firstMessage || 'Conversation').slice(0, 60);
}

export default function App() {
  const bridge = useMemo(getBridge, []);
  const [view, setView] = useState<ViewName>('conversations');
  const [projects, setProjects] = useState<ProjectView[]>([]);
  // Scratch-first (decision #16 §7): the app opens into scratch, projects are opt-in.
  const [activeGroup, setActiveGroup] = useState<string>('scratch');
  const [scratchConversations, setScratchConversations] = useState<Conversation[]>([]);
  const [projectConversations, setProjectConversations] = useState<Record<string, Conversation[]>>({});
  const [activeId, setActiveId] = useState<string>('');
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

  // Load projects (real mode) once.
  useEffect(() => {
    if (!bridge?.projectsList) return;
    bridge
      .projectsList()
      .then(setProjects)
      .catch(() => setProjects([]));
  }, [bridge]);

  // Load scratch conversations (real mode) once.
  useEffect(() => {
    if (!bridge?.scratchConversations) return;
    bridge
      .scratchConversations()
      .then((list) =>
        setScratchConversations(
          list.map((c) => ({ id: c.path, path: c.path, title: titleFor(c) })),
        ),
      )
      .catch(() => setScratchConversations([]));
  }, [bridge]);

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
        const target: ScoutSendTarget =
          activeGroup === 'scratch' ? { kind: 'scratch' } : { kind: 'project', projectId: activeGroup };
        await bridge.send(text, target);
        // Refresh the conversation list of the active group (new session file).
        if (activeGroup === 'scratch' && bridge.scratchConversations) {
          const list = await bridge.scratchConversations();
          setScratchConversations(list.map((c) => ({ id: c.path, path: c.path, title: titleFor(c) })));
        } else if (bridge.projectConversations) {
          const list = await bridge.projectConversations(activeGroup);
          setProjectConversations((prev) => ({
            ...prev,
            [activeGroup]: list.map((c) => ({ id: c.path, path: c.path, title: titleFor(c) })),
          }));
        }
      } catch (err) {
        setMessages((prev) => [...prev, { role: 'assistant', text: `Error: ${(err as Error).message}` }]);
        setBusy(false);
      }
    },
    [bridge, activeGroup],
  );

  const newConversation = useCallback(() => {
    // Starts fresh: the next send in this group creates a new conversation.
    setMessages([]);
    setActivity([]);
    setActiveId('');
  }, []);

  const createProject = useCallback(
    (name: string) => {
      if (!bridge?.projectsCreate) {
        // Demo mode: keep a local pseudo project so the flow is reviewable.
        const id = `demo-${Date.now()}`;
        setProjects((prev) => [
          { id, name, createdAt: Date.now(), lastOpenedAt: Date.now(), settings: null },
          ...prev,
        ]);
        return;
      }
      bridge.projectsCreate(name, []).then((created) => {
        setProjects((prev) => [created, ...prev]);
      });
    },
    [bridge],
  );

  const deleteProject = useCallback(
    (id: string) => {
      if (!bridge?.projectsDelete) {
        setProjects((prev) => prev.filter((p) => p.id !== id));
      } else {
        bridge.projectsDelete(id).then(() => {
          setProjects((prev) => prev.filter((p) => p.id !== id));
        });
      }
      if (activeGroup === id) {
        setActiveGroup('scratch');
        setView('conversations');
      }
      setProjectConversations((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    },
    [bridge, activeGroup],
  );

  const renameProject = useCallback(
    (id: string, name: string) => {
      if (!bridge?.projectsPatch) {
        setProjects((prev) => prev.map((p) => (p.id === id ? { ...p, name } : p)));
        return;
      }
      bridge.projectsPatch(id, { name }).then(() => {
        setProjects((prev) => prev.map((p) => (p.id === id ? { ...p, name } : p)));
      });
    },
    [bridge],
  );

  const openProject = useCallback(
    (id: string) => {
      setActiveGroup(id);
      setView('conversations');
      if (!bridge?.projectsOpen) return; // demo mode: group stays empty
      bridge
        .projectsOpen(id)
        .then(({ conversations }) => {
          setProjectConversations((prev) => ({
            ...prev,
            [id]: conversations.map((c) => ({ id: c.path, path: c.path, title: titleFor(c) })),
          }));
        })
        .catch(() => setProjectConversations((prev) => ({ ...prev, [id]: [] })));
    },
    [bridge],
  );

  const groups: ProjectGroup[] = useMemo(() => {
    const result: ProjectGroup[] = projects.map((p) => ({
      id: p.id,
      name: p.name,
      conversations: projectConversations[p.id] ?? [],
    }));
    result.push({ id: 'scratch', name: 'Scratch', conversations: scratchConversations });
    return result;
  }, [projects, projectConversations, scratchConversations]);

  const allConversations = useMemo(
    () => groups.flatMap((g) => g.conversations),
    [groups],
  );
  const active = allConversations.find((c) => c.id === activeId);
  const activeGroupName = groups.find((g) => g.id === activeGroup)?.name ?? 'Scratch';

  const selectConversation = useCallback((groupId: string, id: string) => {
    setActiveGroup(groupId);
    setActiveId(id);
    setMessages([]);
    setActivity([]);
    // T02 will restore the transcript here; T01 selects and clears.
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

  const openRunFromChat = useCallback(() => {
    setView('fleet');
  }, []);

  return (
    <div className="flex h-full">
      <NavRail active={view} onSelect={setView} onNewConversation={newConversation} />
      {view === 'projects' ? (
        <ProjectsPane
          projects={projects}
          onCreate={createProject}
          onDelete={deleteProject}
          onOpen={openProject}
          onRename={renameProject}
        />
      ) : (
        <ConversationsPane groups={groups} activeId={activeId} onSelect={selectConversation} />
      )}
      {view === 'fleet' ? (
        <FleetView runs={runs} onOpenTranscript={openTranscript} onSteer={steerRun} onStop={stopRun} />
      ) : (
        <ChatPane
          title={active?.title ?? activeGroupName}
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
