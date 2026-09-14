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
  await host.send('a', '/proj/one');
  await host.send('b', '/proj/one');
  await host.send('c', '/proj/two');
  assert.equal(created, 2);
});
