import assert from 'node:assert/strict';
import { test } from 'node:test';

import { AgentHost, type PiLikeSession, type ScoutAgentEvent } from '../src/main/agentHost.ts';

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
