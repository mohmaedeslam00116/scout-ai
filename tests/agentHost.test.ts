import assert from 'node:assert/strict';
import { test } from 'node:test';

import { AgentHost, type PiLikeSession, type ScoutAgentEvent } from '../src/main/agentHost.ts';
import type { ProceedController } from '../src/main/proceedGate.ts';
import { DEFAULT_GRANT, type ProjectRules } from '../src/main/permissionEngine.ts';

/** Fake pi session exposing the mutable `agent.beforeToolCall` hook (T04). */
function fakeSessionWithAgent(script: (emit: (e: unknown) => void) => Promise<void>): PiLikeSession {
  const base = fakeSession(script) as PiLikeSession & { agent?: { beforeToolCall?: unknown } };
  const agent: { beforeToolCall?: (ctx: unknown, signal?: AbortSignal) => Promise<unknown> } = {};
  (base as { agent?: unknown }).agent = agent;
  return base;
}

/** Fake pi session: replays a scripted event stream when prompted. */
function fakeSession(script: (emit: (e: unknown) => void) => Promise<void>): PiLikeSession {
  const listeners = new Set<(e: unknown) => void>();
  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async prompt() {
      await script((event) => listeners.forEach((l) => l(event)));
    },
    async abort() {},
    get isStreaming() {
      return false;
    },
  };
}

function makeHost(session: PiLikeSession) {
  const events: ScoutAgentEvent[] = [];
  const host = new AgentHost({ emit: (_c, payload) => events.push(payload) }, async () => session);
  return { host, events };
}

test('streams mapped pi events and settles idle', async () => {
  const session = fakeSession(async (emit) => {
    emit({ type: 'agent_start' });
    emit({ type: 'message_start', message: { role: 'assistant', content: [] } });
    emit({ type: 'message_update', message: {}, assistantMessageEvent: { type: 'text_delta', delta: 'Hello ' } });
    emit({ type: 'message_update', message: {}, assistantMessageEvent: { type: 'text_delta', delta: 'world' } });
    emit({ type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: 'Hello world' }] } });
    emit({ type: 'agent_end', messages: [], willRetry: false });
  });
  const { host, events } = makeHost(session);

  await host.send('hi');
  const snap = host.snapshot();

  assert.equal(snap.busy, false);
  assert.equal(events[0]?.type, 'agent_start');
  assert.deepEqual(
    events.filter((e) => e.type === 'message_delta').map((e) => (e as { text: string }).text),
    ['Hello ', 'world'],
  );
  assert.equal(events.at(-1)?.type, 'agent_end');
  assert.equal(snap.messages.at(-1)?.text, 'Hello world');
});

test('tool events land in the activity log with summaries', async () => {
  const session = fakeSession(async (emit) => {
    emit({ type: 'tool_execution_start', toolCallId: '1', toolName: 'web_search', args: { query: 'pi' } });
    emit({
      type: 'tool_execution_end',
      toolCallId: '1',
      toolName: 'web_search',
      result: { results: [{}, {}, {}] },
      isError: false,
    });
    emit({ type: 'agent_end', messages: [], willRetry: false });
  });
  const { host } = makeHost(session);

  await host.send('research pi');
  const activity = host.snapshot().activity;

  assert.ok(activity.some((a) => a.kind === 'tool' && a.text.includes('web_search')));
  assert.ok(activity.some((a) => a.kind === 'done' && a.text.includes('3 result(s)')));
});

test('rejects concurrent sends and reports prompt errors without throwing', async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const slow = fakeSession(async () => {
    await gate;
  });
  const first = makeHost(slow);
  const running = first.host.send('one');
  await assert.rejects(() => first.host.send('two'), /busy/);
  release();
  await running;

  const failing = fakeSession(async () => {
    throw new Error('no provider');
  });
  const { host, events } = makeHost(failing);
  await host.send('boom');
  assert.ok(host.snapshot().messages.at(-1)?.text.includes('no provider'));
  assert.equal(events.at(-1)?.type, 'agent_end');
});

test('creates one session per cwd and reuses it', async () => {
  let created = 0;
  const host = new AgentHost(
    { emit: () => {} },
    async () => {
      created++;
      return fakeSession(async () => {});
    },
  );
  await host.send('a', { cwd: '/proj/one' });
  await host.send('b', { cwd: '/proj/one' });
  await host.send('c', { cwd: '/proj/two' });
  assert.equal(created, 2);
});

test('scratch target is the default send destination', async () => {
  const requests: { cwd: string; sessionDir?: string; fresh?: boolean }[] = [];
  const host = new AgentHost(
    { emit: () => {} },
    async (req) => {
      requests.push(req);
      return fakeSession(async () => {});
    },
    { scratch: { cwd: 'C:\\ud\\scratch\\home', sessionDir: 'C:\\ud\\scratch\\sessions' } },
  );
  await host.send('hello');
  assert.deepEqual(requests, [{ cwd: 'C:\\ud\\scratch\\home', sessionDir: 'C:\\ud\\scratch\\sessions' }]);
});

test('target options: per-sessionDir reuse and fresh recreation', async () => {
  let created = 0;
  const host = new AgentHost(
    { emit: () => {} },
    async () => {
      created++;
      return fakeSession(async () => {});
    },
  );
  const target = { cwd: 'C:\\proj', sessionDir: 'C:\\proj\\sessions' };
  await host.send('a', target);
  await host.send('b', target);
  assert.equal(created, 1); // same target reuses the session
  await host.send('c', { ...target, fresh: true });
  assert.equal(created, 2); // fresh forces a new session
  await host.send('d', { cwd: 'C:\\proj2', sessionDir: 'C:\\proj\\sessions' });
  assert.equal(created, 3); // different cwd = different session
});

test('restore replays transcript messages into the stream and resumes that target', async () => {
  // The fake "pi session" for the restored target replays stored transcript
  // messages upon prompt (simulating pi's resume context) then streams live.
  const restored = fakeSession(async (emit) => {
    emit({ type: 'agent_start' });
    emit({ type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: 'restored answer' }] } });
    emit({ type: 'agent_end', messages: [], willRetry: false });
  });
  const requests: { cwd: string; sessionDir?: string; resume?: string }[] = [];
  const host2 = new AgentHost(
    { emit: (_c, e) => replayed.push(e) },
    async (req) => {
      requests.push(req);
      return req.resume ? restored : fakeSession(async () => {});
    },
    {
      reader: async (path) =>
        path === 'C:\\proj\\sessions\\abc.jsonl'
          ? [
              { role: 'user' as const, text: 'earlier question' },
              { role: 'assistant' as const, text: 'earlier answer' },
            ]
          : [],
    },
  );
  const replayed: ScoutAgentEvent[] = [];

  const result = await host2.restore('C:\\proj', 'C:\\proj\\sessions', 'C:\\proj\\sessions\\abc.jsonl');

  assert.equal(result.ok, true);
  const texts = replayed.filter((e) => e.type === 'message_end').map((e) => (e as { text: string }).text);
  assert.deepEqual(texts, ['earlier question', 'earlier answer']);
  // The next plain send to that target resumes the restored session file
  // (any previously live session on the target was dropped by restore).
  await host2.send('continue', { cwd: 'C:\\proj', sessionDir: 'C:\\proj\\sessions' });
  assert.equal(requests.at(-1)?.resume, 'C:\\proj\\sessions\\abc.jsonl');
});

test('proceed gate unit: holds, approves, rejects', async () => {
  const { createProceedGate } = await import('../src/main/proceedGate.ts');
  const { controller, promise } = createProceedGate('a_1', 'research-brief', 'T');
  let settled = false;
  promise.then((outcome) => {
    settled = true;
    void outcome;
  });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(settled, false); // holds
  controller.approve();
  assert.equal(await promise, 'approved');
});

test('restore while busy refuses cleanly', async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const slow = fakeSession(async () => {
    await gate;
  });
  const { host } = (() => {
    const h = new AgentHost({ emit: () => {} }, async () => slow);
    return { host: h };
  })();
  const running = host.send('long run');
  const result = await host.restore('C', 'S', 'X.jsonl');
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /busy/);
  release();
  await running;
});

test('restore failure surfaces a clean error', async () => {
  const host = new AgentHost(
    { emit: () => {} },
    async () => fakeSession(async () => {}),
    {
      reader: async () => {
        throw new Error('bad session file');
      },
    },
  );
  const result = await host.restore('S', 'S', 'X.jsonl');
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /bad session file/);
});

async function renameHarness() {
  const renamed: { file: string; name: string }[] = [];
  const host = new AgentHost(
    { emit: () => {} },
    async () => fakeSession(async () => {}),
    {
      renamer: async (file, name) => {
        renamed.push({ file, name });
      },
    },
  );
  return { host, renamed };
}

test('renameConversation delegates to the injected renamer', async () => {
  const { host, renamed } = await renameHarness();
  await host.renameConversation('a.jsonl', 'Weekly digest');
  assert.deepEqual(renamed, [{ file: 'a.jsonl', name: 'Weekly digest' }]);
});

test('listConversations sorts by modified desc and maps to summaries', async () => {
  const host = new AgentHost(
    { emit: () => {} },
    async () => fakeSession(async () => {}),
    {
      lister: async (sessionDir) =>
        sessionDir === 'S'
          ? [
              { path: 'a.jsonl', id: 'a', created: 1, modified: 100, messageCount: 2, firstMessage: 'old' },
              { path: 'b.jsonl', id: 'b', name: 'Named', created: 2, modified: 200, messageCount: 5, firstMessage: 'new' },
            ]
          : [],
    },
  );
  const convos = await host.listConversations('S');
  assert.equal(convos[0]?.id, 'b'); // newest first
  assert.equal(convos[0]?.name, 'Named');
  assert.equal(convos[1]?.firstMessage, 'old');
});

import { describe, it } from 'node:test';
import type { ProjectRules as RulesForGate } from '../src/main/permissionEngine.ts';

describe('permission gate (T04, decision #13)', () => {
  /** Fake pi session whose prompt() invokes agent.beforeToolCall like pi does. */
  function gateSession(): PiLikeSession {
    const listeners = new Set<(e: unknown) => void>();
    const agent: { beforeToolCall?: (ctx: unknown) => Promise<unknown> } = {};
    return {
      subscribe(listener: (e: unknown) => void) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      async prompt() {
        // Mimic pi: before executing a tool, call the host's beforeToolCall.
        const result = await agent.beforeToolCall?.({
          toolCall: { id: 't1', name: 'fetch_content' },
          args: { url: 'https://example.com/docs' },
        });
        listeners.forEach((l) =>
          l({
            type: 'tool_execution_start',
            toolCallId: 't1',
            toolName: 'fetch_content',
            args: { url: 'https://example.com/docs' },
          }),
        );
        if (result && typeof result === 'object' && (result as { block?: boolean }).block) {
          listeners.forEach((l) =>
            l({
              type: 'tool_execution_end',
              toolCallId: 't1',
              toolName: 'fetch_content',
              result: { blocked: true },
              isError: true,
            }),
          );
        } else {
          listeners.forEach((l) =>
            l({
              type: 'tool_execution_end',
              toolCallId: 't1',
              toolName: 'fetch_content',
              result: { results: [1] },
              isError: false,
            }),
          );
        }
        listeners.forEach((l) => l({ type: 'agent_end', messages: [], willRetry: false }));
      },
      async abort() {},
      get isStreaming() {
        return false;
      },
      agent,
    } as unknown as PiLikeSession;
  }
  function makeRules(rules: RulesForGate) {
    const events: ScoutAgentEvent[] = [];
    const host = new AgentHost(
      { emit: (_c, e) => events.push(e) },
      async () => gateSession(),
      { scratch: { cwd: 'C', sessionDir: 'S' }, permissionRules: () => rules },
    );
    return { host, events };
  }

  function waitForEvent(events: ScoutAgentEvent[], type: string): Promise<void> {
    return new Promise((resolve) => {
      const timer = setInterval(() => {
        if (events.some((e) => e.type === type)) {
          clearInterval(timer);
          resolve();
        }
      }, 5);
    });
  }

  it('ask holds the tool call until approved, then the run proceeds', async () => {
    const { host, events } = makeRules(DEFAULT_GRANT); // default preset: fetch asks
    const running = host.send('fetch the docs');
    await waitForEvent(events, 'permission_request');

    // The tool call must be held: still busy, second send rejected.
    assert.equal(host.snapshot().busy, true);
    await assert.rejects(() => host.send('another'), /busy/);

    const request = events.find((e) => e.type === 'permission_request') as Extract<
      ScoutAgentEvent,
      { type: 'permission_request' }
    >;
    assert.equal(request.tool, 'fetch_content');
    assert.deepEqual(request.action, { kind: 'fetch', domain: 'example.com' });

    // Approve through the host's resolution surface.
    const pending = (host as unknown as { pendingPermissions?: Map<string, { resolve: (v: 'allow' | 'deny') => void }> }).pendingPermissions;
    assert.ok(pending && pending.size === 1, 'one pending permission');
    for (const [, p] of pending) p.resolve('allow');

    await running;
    assert.equal(host.snapshot().busy, false);
    assert.ok(events.some((e) => e.type === 'permission_resolved' && e.verdict === 'allow'));
  });

  it('deny blocks the tool without a request and reports Rejected', async () => {
    const { host, events } = makeRules({ ...DEFAULT_GRANT, denyDomains: ['example.com'] });
    await host.send('fetch denied');
    assert.ok(!events.some((e) => e.type === 'permission_request'));
    assert.ok(events.some((e) => e.type === 'permission_resolved' && e.verdict === 'deny'));
    assert.equal(host.snapshot().busy, false);
  });

  it('abort rejects held permission gates', async () => {
    const { host, events } = makeRules(DEFAULT_GRANT);
    const running = host.send('fetch then nothing');
    await waitForEvent(events, 'permission_request');

    await host.abort();
    await running;
    assert.equal(host.snapshot().busy, false);
    const resolved = events.filter((e) => e.type === 'permission_resolved');
    assert.ok(resolved.some((e) => e.verdict === 'deny'));
  });

  it('allow-verdict tools run without any request', async () => {
    const { host, events } = makeRules({ ...DEFAULT_GRANT, allowDomains: ['example.com'] });
    await host.send('fetch allowed');
    assert.ok(!events.some((e) => e.type === 'permission_request'));
    // Auto-allows are silent (no permission_resolved) — the tool just ran.
    const ran = events.find((e) => e.type === 'tool_result') as { ok?: boolean } | undefined;
    assert.ok(ran && ran.ok, 'allowed tool executed');
  });
});

describe('fleet mapping (T05, decision #15)', () => {
  /**
   * Harness whose fake session replays a raw-event script once prompt() is
   * called (mirroring the real subscription timing), then holds until release.
   */
  function fleetHarness(script: (emit: (e: unknown) => void) => void = () => {}) {
    const listeners: ((e: unknown) => void)[] = [];
    let releasePrompt: (() => void) | null = null;
    let streaming = false;
    const steered: string[] = [];
    const session: PiLikeSession = {
      subscribe(listener: (e: unknown) => void) {
        listeners.push(listener);
        return () => {
          const i = listeners.indexOf(listener);
          if (i >= 0) listeners.splice(i, 1);
        };
      },
      async prompt() {
        streaming = true;
        script((raw) => listeners.forEach((l) => l(raw)));
        await new Promise<void>((resolve) => {
          releasePrompt = resolve;
        });
        streaming = false;
      },
      async abort() {},
      get isStreaming() {
        return streaming;
      },
      steer: (text: string) => {
        steered.push(text);
      },
    } as unknown as PiLikeSession;
    const events: ScoutAgentEvent[] = [];
    const host = new AgentHost(
      { emit: (_c, e) => events.push(e) },
      async () => session,
      { scratch: { cwd: 'C', sessionDir: 'S' } },
    );
    const emit = (raw: unknown) => listeners.forEach((l) => l(raw));
    const release = () => releasePrompt?.();
    return { host, events, emit, steered, release };
  }

  function waitForEvent(events: ScoutAgentEvent[], type: string): Promise<void> {
    return new Promise((resolve) => {
      const timer = setInterval(() => {
        if (events.some((e) => e.type === type)) {
          clearInterval(timer);
          resolve();
        }
      }, 5);
    });
  }

  const progressDetails = (status: string, extra: Record<string, unknown> = {}) => ({
    mode: 'foreground',
    results: [],
    progress: [
      {
        index: 0,
        agent: 'researcher',
        status,
        task: 'scan pi.dev',
        currentTool: 'web_search',
        recentOutput: ['searching: exa x3'],
        toolCount: 2,
        tokens: 1200,
        durationMs: 4000,
        ...extra,
      },
    ],
  });

  it('maps subagent tool_execution_update details into fleet_run_update', async () => {
    let emit!: (e: unknown) => void;
    const { host, events, release } = fleetHarness((e) => (emit = e));
    const running = host.send('delegate research');
    await new Promise((r) => setTimeout(r, 20)); // let prompt() start
    // Prompt has the session now; emit the live progress like pi-subagents.
    emit({
      type: 'tool_execution_update',
      toolCallId: 't1',
      toolName: 'subagent',
      args: {},
      partialResult: { details: progressDetails('running') },
    });
    await waitForEvent(events, 'fleet_run_update');

    const update = events.find((e) => e.type === 'fleet_run_update') as Extract<ScoutAgentEvent, { type: 'fleet_run_update' }>;
    assert.equal(update.runs.length, 1);
    const run = update.runs[0]!;
    assert.equal(run.runId, 'researcher:0');
    assert.equal(run.agent, 'researcher');
    assert.equal(run.status, 'running');
    assert.equal(run.currentTool, 'web_search');
    assert.deepEqual(run.output, ['searching: exa x3']);

    // Progress continues: upsert semantics are the renderer's job; the host
    // just mirrors the AgentProgress array each time.
    emit({
      type: 'tool_execution_update',
      toolCallId: 't1',
      toolName: 'subagent',
      args: {},
      partialResult: { details: progressDetails('completed', { tokens: 2400 }) },
    });
    const last = events.filter((e) => e.type === 'fleet_run_update').at(-1) as Extract<ScoutAgentEvent, { type: 'fleet_run_update' }>;
    assert.equal(last.runs[0]?.status, 'done');

    release();
    await running;
  });

  it('ignores updates from tools that are not subagent', async () => {
    const { host, events, emit, release } = fleetHarness();
    const running = host.send('plain tool');
    emit({ type: 'tool_execution_update', toolCallId: 't2', toolName: 'web_search', args: {}, partialResult: { details: progressDetails('running') } });
    (host as unknown as { sessions: Map<string, PiLikeSession> }).sessions.set('C\u0000S', {
      subscribe: () => () => {},
      prompt: async () => {},
      abort: async () => {},
      isStreaming: false,
    } as unknown as PiLikeSession);
    // Give the event loop a tick to observe no emission.
    await new Promise((r) => setTimeout(r, 30));
    assert.ok(!events.some((e) => e.type === 'fleet_run_update'));
    release();
    await running;
  });

  it('steer sends a parent-mediated message labeled via Scout', async () => {
    let emit!: (e: unknown) => void;
    const { host, events, steered, release } = fleetHarness((e) => (emit = e));
    const running = host.send('delegate');
    await new Promise((r) => setTimeout(r, 20)); // let prompt() start
    emit({ type: 'tool_execution_update', toolCallId: 't1', toolName: 'subagent', args: {}, partialResult: { details: progressDetails('running') } });
    await waitForEvent(events, 'fleet_run_update');
    host.steerRun('researcher:0', 'focus on ADRs');
    assert.equal(steered.length, 1);
    assert.match(steered[0]!, /researcher:0/);
    assert.match(steered[0]!, /focus on ADRs/);
    release();
    await running;
  });

  it('stopRun injects the interrupt steering message', async () => {
    let emit!: (e: unknown) => void;
    const { host, events, steered, release } = fleetHarness((e) => (emit = e));
    const running = host.send('delegate');
    await new Promise((r) => setTimeout(r, 20)); // let prompt() start
    emit({ type: 'tool_execution_update', toolCallId: 't1', toolName: 'subagent', args: {}, partialResult: { details: progressDetails('running') } });
    await waitForEvent(events, 'fleet_run_update');
    host.stopRun('researcher:0');
    assert.equal(steered.length, 1);
    assert.match(steered[0]!, /interrupt/i);
    assert.match(steered[0]!, /researcher:0/);
    release();
    await running;
  });
});
