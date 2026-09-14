import assert from 'node:assert/strict';
import { test } from 'node:test';

import { AgentHost, type ScoutAgentEvent } from '../src/main/agentHost.ts';

function makeHost() {
  const events: ScoutAgentEvent[] = [];
  const host = new AgentHost({
    emit: (_channel, payload) => events.push(payload),
  });
  return { host, events };
}

test('AgentHost streams a stub answer and settles idle', async () => {
  const { host, events } = makeHost();

  await host.send('What is pi?');
  const snap = host.snapshot();

  assert.equal(snap.busy, false);
  assert.equal(snap.messages.length, 2);
  assert.equal(snap.messages[0]?.role, 'user');
  assert.equal(snap.messages[1]?.role, 'assistant');
  assert.equal(events[0]?.type, 'agent_start');
  assert.equal(events.at(-1)?.type, 'agent_end');
  assert.ok(snap.messages[1]?.text.includes('pi harness'));
});

test('AgentHost rejects concurrent sends', async () => {
  const { host } = makeHost();
  const first = host.send('slow question');
  await assert.rejects(() => host.send('second question'), /busy/);
  await first;
});
