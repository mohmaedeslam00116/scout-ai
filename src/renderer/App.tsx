import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { getBridge, type ScoutAgentEvent, type ScoutSendTarget, type ProjectView, type ConversationSummary } from './bridge.js';
import type { Artifact } from './artifacts.js';
import type { FleetRun } from './fleet.js';
import { NavRail } from './components/NavRail.js';
import { ConversationsPane } from './components/ConversationsPane.js';
import { ProjectsPane } from './components/ProjectsPane.js';
import { ChatPane } from './components/ChatPane.js';
import { ArtifactsPane } from './components/ArtifactsPane.js';
import { PermissionsSection } from './components/PermissionCard.js';
import { scopesFor, type PermissionRequest } from './permissions.js';
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
  /** Scout-side archive flag (T02). */
  archived?: boolean;
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
  const [permissionRequests, setPermissionRequests] = useState<PermissionRequest[]>([]);
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
          if (event.role === 'user') {
            // Replay-only: restored user messages append directly.
            return [...prev, { role: 'user', text: event.text }];
          }
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
      case 'artifact_created':
        setArtifacts((prev) => [
          ...prev,
          {
            id: event.id,
            kind: event.kind,
            title: event.title,
            status: event.status === 'approved' ? ('approved' as const) : ('review' as const),
            versions: [], // body hydrates on expand (real mode)
            comments: [],
          },
        ]);
        break;
      case 'artifact_updated':
        setArtifacts((prev) =>
          prev.map((a) =>
            a.id === event.id
              ? {
                  ...a,
                  ...(event.status === 'approved' ? { status: 'approved' as const } : {}),
                  ...(event.version > 0
                    ? { versions: [...a.versions, { version: event.version, body: '', createdAt: Date.now() }] }
                    : {}),
                }
              : a,
          ),
        );
        break;
      case 'fleet_run_update':
        // Upsert by runId (decision #15 §2): live cards mirror AgentProgress.
        setRuns((prev) => {
          const next = [...prev];
          for (const run of event.runs) {
            const i = next.findIndex((r) => r.id === run.runId);
            const card = {
              id: run.runId,
              agent: run.agent,
              task: run.task,
              state: run.status,
              transcript: run.output,
              ...(run.currentTool ? { currentTool: run.currentTool } : {}),
              ...(run.tokens !== undefined ? { tokens: run.tokens } : {}),
              ...(run.durationMs !== undefined ? { durationMs: run.durationMs } : {}),
              ...(run.error ? { error: run.error } : {}),
            };
            if (i >= 0) next[i] = { ...next[i]!, ...card };
            else next.unshift(card);
          }
          return next;
        });
        break;
      case 'agent_end':
        setBusy(false);
        break;
      case 'permission_request':
        setPermissionRequests((prev) =>
          prev.some((r) => r.id === event.id)
            ? prev
            : [...prev, { id: event.id, tool: event.tool, action: event.action, status: 'pending' as const, scopes: scopesFor(event.action) }],
        );
        break;
      case 'permission_resolved':
        // Resolved rows stay as the run's audit trail (Rejected included).
        // Unknown ids still log — e.g. a deny that beat the request to the wire.
        setPermissionRequests((prev) => {
          const known = prev.some((r) => r.id === event.id);
          const resolved = event.verdict === 'allow' ? ('allow' as const) : ('deny' as const);
          if (known) return prev.map((r) => (r.id === event.id ? { ...r, status: resolved } : r));
          return [...prev, { id: event.id, tool: 'blocked by policy', action: { kind: 'other' } as const, status: resolved, scopes: [] }];
        });
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
        const convId = `demo-${Date.now()}`;
        setScratchConversations((prev) => [
          { id: convId, title: text.slice(0, 60), archived: false },
          ...prev,
        ]);
        setActiveId(convId);
        setBusy(true);
        setTimeout(() => setArtifacts((prev) => [...prev, demoArtifact()]), 600);
        // Demo permission request (T04 parity): a fetch that needs approval.
        setTimeout(
          () =>
            setPermissionRequests((prev) =>
              prev.some((r) => r.id === 'demo-perm')
                ? prev
                : [
                    ...prev,
                    {
                      id: 'demo-perm',
                      tool: 'fetch_content',
                      action: { kind: 'fetch' as const, domain: 'pi.dev' },
                      status: 'pending' as const,
                      scopes: scopesFor({ kind: 'fetch' as const, domain: 'pi.dev' }),
                    },
                  ],
            ),
          900,
        );
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

  const selectConversation = useCallback(
    (groupId: string, id: string) => {
      setActiveGroup(groupId);
      setActiveId(id);
      setMessages([]);
      setActivity([]);
      const convo = groups.flatMap((g) => g.conversations).find((c) => c.id === id);
      if (!bridge?.restoreConversation || !convo?.path) return; // demo mode / T01-only selection
      bridge
        .restoreConversation(groupId === 'scratch' ? null : groupId, convo.path)
        .then((result) => {
          if (result && 'ok' in result && !result.ok) {
            setMessages([{ role: 'assistant', text: `Could not restore conversation: ${result.error}` }]);
          }
        })
        .catch((err: Error) => setMessages([{ role: 'assistant', text: `Could not restore: ${err.message}` }]));
    },
    [bridge, groups],
  );

  const retagGroup = (
    groupId: string,
    convoId: string,
    tag: (c: Conversation) => Conversation,
  ) => {
    if (groupId === 'scratch') setScratchConversations((prev) => prev.map((c) => (c.id === convoId ? tag(c) : c)));
    else
      setProjectConversations((prev) => ({
        ...prev,
        [groupId]: (prev[groupId] ?? []).map((c) => (c.id === convoId ? tag(c) : c)),
      }));
  };

  const renameConversation = useCallback(
    (groupId: string, convo: Conversation, name: string) => {
      if (bridge?.renameConversation && convo.path) {
        bridge.renameConversation(convo.path, name).catch(() => {});
      }
      // Optimistic everywhere (demo mode included): the title updates locally.
      retagGroup(groupId, convo.id, (c) => ({ ...c, title: name }));
    },
    [bridge],
  );

  const archiveConversation = useCallback(
    (groupId: string, convo: Conversation, archived: boolean) => {
      if (bridge?.archiveConversation && convo.path) {
        bridge.archiveConversation(groupId === 'scratch' ? null : groupId, convo.path, archived).catch(() => {});
      }
      retagGroup(groupId, convo.id, (c) => ({ ...c, archived }));
    },
    [bridge],
  );

  const moveConversation = useCallback(
    (convo: Conversation, projectId: string) => {
      if (bridge?.moveConversation && convo.path) {
        const fileName = convo.path.split(/[\\/]/).pop() ?? convo.path;
        bridge.moveConversation(fileName, projectId).catch(() => {});
      }
      // Optimistic: leave scratch list, appear in the target project group.
      setScratchConversations((prev) => prev.filter((c) => c.id !== convo.id));
      setProjectConversations((prev) => ({
        ...prev,
        [projectId]: [{ ...convo }, ...(prev[projectId] ?? [])],
      }));
      if (bridge?.projectConversations) {
        bridge.projectConversations(projectId).then((list) => {
          setProjectConversations((prev) => ({
            ...prev,
            [projectId]: list.map((c) => ({ id: c.path, path: c.path, title: titleFor(c) })),
          }));
        });
      }
    },
    [bridge],
  );

  const approveArtifact = useCallback(
    (id: string) => {
      if (bridge?.artifactsApprove) {
        bridge.artifactsApprove(id).catch(() => {});
      }
      setArtifacts((prev) => prev.map((a) => (a.id === id ? { ...a, status: 'approved' as const } : a)));
    },
    [bridge],
  );

  const commentArtifact = useCallback(
    (id: string, text: string) => {
      if (bridge?.artifactsComment) {
        // Real mode: comment lands on disk; the revision rides session steering.
        const steer = `Artifact feedback for ${id}: ${text}. Please revise it and register a new version.`;
        bridge.artifactsComment(id, text, steer).catch(() => {});
      } else {
        // Demo of the revise-in-place loop: feedback produces the next version.
        setArtifacts((prev) =>
          prev.map((a) =>
            a.id === id
              ? {
                  ...a,
                  comments: [...a.comments, { id: `k${Date.now()}`, text, ts: Date.now() }],
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
        return;
      }
      setArtifacts((prev) =>
        prev.map((a) => (a.id === id ? { ...a, comments: [...a.comments, { id: `k${Date.now()}`, text, ts: Date.now() }] } : a)),
      );
    },
    [bridge],
  );

  // Hydrate a real artifact's versions when its card expands (real mode only).
  const expandArtifact = useCallback(
    (id: string) => {
      if (!bridge?.artifactsHydrate) return;
      bridge.artifactsHydrate(activeGroup === 'scratch' ? null : activeGroup, id).then((raw) => {
        const full = raw as { versions?: { version: number; body: string; createdAt: number }[] } | null;
        if (!full?.versions?.length) return;
        setArtifacts((prev) =>
          prev.map((a) => (a.id === id ? { ...a, versions: full.versions! } : a)),
        );
      });
    },
    [bridge, activeGroup],
  );

  /** Resolve a held permission card (real IPC; demo flips the row locally). */
  const resolvePermission = useCallback(
    (id: string, verdict: 'allow' | 'deny') => {
      if (bridge?.resolvePermission) {
        bridge.resolvePermission(id, verdict).catch(() => {});
      }
      // Optimistic flip; host echoes permission_resolved either way.
      setPermissionRequests((prev) =>
        prev.map((r) => (r.id === id ? { ...r, status: verdict === 'allow' ? ('allow' as const) : ('deny' as const) } : r)),
      );
    },
    [bridge],
  );

  /** Scope widening from the card: persist (project) or mutate (scratch/demo). */
  const widenPermission = useCallback(
    (request: PermissionRequest, scope: 'domain' | 'wildcard' | 'server') => {
      const target = activeGroup === 'scratch' ? { kind: 'scratch' as const } : { kind: 'project' as const, projectId: activeGroup };
      if (bridge?.widenPermissionScope) {
        bridge
          .widenPermissionScope(target, request.action, scope)
          .then(() => resolvePermission(request.id, 'allow'))
          .catch(() => {});
        return;
      }
      // Demo mode: widening just allows (no rules store to mutate).
      resolvePermission(request.id, 'allow');
    },
    [bridge, activeGroup, resolvePermission],
  );

  const openTranscript = useCallback(
    (id: string) => {
      const run = runs.find((r) => r.id === id);
      if (!run) return;
      const show = (body: string) => {
        setMessages((prev) => [...prev, { role: 'user', text: `Transcript of ${run.agent} (${run.state}):\n${body || '(empty)'}` }]);
        setView('conversations');
      };
      // Real mode: the whole persisted JSONL (decision #15 §5), not pi's
      // 50-line recentOutput window. Demo: what the card streamed.
      if (bridge?.fleetTranscript) {
        bridge
          .fleetTranscript(activeGroup === 'scratch' ? null : activeGroup, id)
          .then((raw) => {
            const records = raw as { type: string; lines?: string[]; status?: string; error?: string }[];
            const lines = records.flatMap((r) => {
              if (r.type === 'output') return r.lines ?? [];
              if (r.type === 'control') return [`[control] ${r.type}`];
              return [`[${r.status ?? 'progress'}]`];
            });
            show(lines.join('\n'));
          })
          .catch(() => show(run.transcript.join('\n')));
        return;
      }
      show(run.transcript.join('\n'));
    },
    [runs, bridge, activeGroup],
  );

  /** Steer a child run (T05): real IPC parent-mediated; demo appends locally. */
  const steerRun = useCallback(
    (id: string, text: string) => {
      if (bridge?.fleetAction) {
        bridge.fleetAction(id, 'steer', text).catch(() => {});
      }
      setRuns((prev) => prev.map((r) => (r.id === id ? { ...r, transcript: [...r.transcript, `↳ Steer (via Scout): ${text}`] } : r)));
    },
    [bridge],
  );

  /** Stop one child run: real interrupt via the parent; demo flips the card. */
  const stopRun = useCallback(
    (id: string) => {
      if (bridge?.fleetAction) {
        bridge.fleetAction(id, 'stop').catch(() => {});
      }
      setRuns((prev) => prev.map((r) => (r.id === id && r.state === 'running' ? { ...r, state: 'stopped' as const } : r)));
    },
    [bridge],
  );

  // Hydrate done/stopped runs from disk on Fleet view mount (decision #15 §5).
  useEffect(() => {
    if (view !== 'fleet' || !bridge?.fleetRuns) return;
    bridge
      .fleetRuns(activeGroup === 'scratch' ? null : activeGroup)
      .then((raw) => {
        const stored = raw as {
          runId: string;
          agent: string;
          task: string;
          status: string;
          output?: string[];
          tokens?: number;
          durationMs?: number;
          error?: string;
        }[];
        setRuns((prev) => {
          const next = [...prev];
          for (const run of stored) {
            const state =
              run.status === 'completed' ? ('done' as const) : run.status === 'failed' ? ('error' as const) : run.status === 'detached' ? ('stopped' as const) : ('running' as const);
            const card = {
              id: run.runId,
              agent: run.agent,
              task: run.task,
              state,
              transcript: run.output ?? [],
              ...(run.tokens !== undefined ? { tokens: run.tokens } : {}),
              ...(run.durationMs !== undefined ? { durationMs: run.durationMs } : {}),
              ...(run.error ? { error: run.error } : {}),
            };
            const i = next.findIndex((r) => r.id === run.runId);
            if (i >= 0) next[i] = { ...next[i]!, ...card };
            else next.push(card);
          }
          return next;
        });
      })
      .catch(() => {});
  }, [view, bridge, activeGroup]);

  const openRunFromChat = useCallback(() => {
    setView('fleet');
  }, []);

  return (
    <div className="flex h-full">
      <NavRail active={view} onSelect={setView} onNewConversation={newConversation} />
      <PermissionsSection requests={permissionRequests} onResolve={resolvePermission} onWiden={widenPermission} />
      {view === 'projects' ? (
        <ProjectsPane
          projects={projects}
          onCreate={createProject}
          onDelete={deleteProject}
          onOpen={openProject}
          onRename={renameProject}
        />
      ) : (
        <ConversationsPane
          groups={groups}
          activeId={activeId}
          onSelect={selectConversation}
          onRename={renameConversation}
          onArchive={archiveConversation}
          onMove={moveConversation}
          moveTargets={projects.map((p) => ({ id: p.id, name: p.name }))}
        />
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
      <ArtifactsPane
        artifacts={artifacts}
        onApprove={approveArtifact}
        onComment={commentArtifact}
        onExpand={expandArtifact}
      />
    </div>
  );
}
