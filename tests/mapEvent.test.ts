import assert from 'node:assert/strict';
import { test } from 'node:test';

import { mapSessionEvent, summarizeToolResult } from '../src/main/mapEvent.ts';

test('maps the core pi stream to Scout events', () => {
  assert.deepEqual(mapSessionEvent({ type: 'agent_start' }), { type: 'agent_start' });

  assert.deepEqual(
    mapSessionEvent({
      type: 'message_update',
      message: {},
      assistantMessageEvent: { type: 'text_delta', delta: 'he' },
    }),
    { type: 'message_delta', text: 'he' },
  );

  assert.deepEqual(
    mapSessionEvent({
      type: 'message_end',
      message: { role: 'assistant', content: [{ type: 'text', text: 'done' }] },
    }),
    { type: 'message_end', role: 'assistant', text: 'done' },
  );

  assert.deepEqual(
    mapSessionEvent({ type: 'tool_execution_start', toolCallId: '1', toolName: 'fetch_content', args: { url: 'x' } }),
    { type: 'tool_call', name: 'fetch_content', args: { url: 'x' } },
  );

  assert.deepEqual(
    mapSessionEvent({ type: 'tool_execution_end', toolCallId: '1', toolName: 'fetch_content', result: 'ok', isError: false }),
    { type: 'tool_result', name: 'fetch_content', ok: true, summary: 'ok' },
  );
});

test('drops events Scout does not surface', () => {
  assert.equal(mapSessionEvent({ type: 'message_start', message: { role: 'user' } }), null);
  assert.equal(mapSessionEvent({ type: 'message_update', message: {}, assistantMessageEvent: { type: 'thinking_delta', delta: '…' } }), null);
  assert.equal(mapSessionEvent({ type: 'agent_end', messages: [], willRetry: true }), null);
  assert.equal(mapSessionEvent({ type: 'compaction_start' }), null);
});

test('summarizes tool results into one readable line', () => {
  assert.equal(summarizeToolResult(undefined), 'done');
  assert.equal(summarizeToolResult('plain string\nsecond line'), 'plain string');
  assert.equal(summarizeToolResult([1, 2, 3]), '3 item(s)');
  assert.equal(summarizeToolResult({ results: [1, 2] }), '2 result(s)');
  assert.equal(summarizeToolResult({ title: 'Exa', url: 'https://…' }), 'Exa');
  const long = summarizeToolResult({ output: 'x'.repeat(200) });
  assert.ok(long.length <= 120);
  assert.ok(long.endsWith('…'));
});
