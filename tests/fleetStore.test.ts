import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { FleetRunStore, type ProgressRecord } from '../src/main/fleetStore.ts';

function tmp(): string {
  return mkdtempSync(join(tmpdir(), 'scout-fleet-'));
}

function record(overrides: Partial<ProgressRecord> = {}): ProgressRecord {
  return {
    ts: 1000,
    type: 'progress',
    runId: 'researcher:0',
    agent: 'researcher',
    status: 'running',
    task: 'scan pi.dev',
    currentTool: 'web_search',
    toolCount: 2,
    tokens: 1200,
    durationMs: 4000,
    ...overrides,
  };
}

describe('FleetRunStore', () => {
  it('appends progress records per run and reads back the transcript', () => {
    const root = tmp();
    try {
      const store = new FleetRunStore(root);
      store.append(record());
      store.append(record({ ts: 2000, toolCount: 3, tokens: 1800 }));

      const runs = store.list();
      assert.equal(runs.length, 1);
      assert.equal(runs[0]?.runId, 'researcher:0');
      assert.equal(runs[0]?.status, 'running');
      assert.equal(runs[0]?.tokens, 1800); // last progress wins
      assert.equal(runs[0]?.records.length, 2);

      const full = store.transcript('researcher:0');
      assert.equal(full.length, 2);
      assert.equal((full[1] as ProgressRecord)?.tokens, 1800);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('separates runs by runId and orders list by last activity desc', () => {
    const root = tmp();
    try {
      const store = new FleetRunStore(root);
      store.append(record());
      store.append(record({ runId: 'evidence-auditor:1', agent: 'evidence-auditor', ts: 5000 }));
      store.append(record({ ts: 3000 }));

      const runs = store.list();
      assert.equal(runs.length, 2);
      assert.equal(runs[0]?.runId, 'evidence-auditor:1'); // newest first
      assert.equal(runs[1]?.runId, 'researcher:0');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('output and control lines ride the same file', () => {
    const root = tmp();
    try {
      const store = new FleetRunStore(root);
      store.append(record());
      store.appendOutput('researcher:0', ['searching: exa x3', 'fetched 5 sources']);
      store.appendControl('researcher:0', { from: 'scout', to: 'parent', reason: 'steer', message: 'focus on ADRs' });

      const full = store.transcript('researcher:0');
      assert.equal(full.length, 3);
      assert.deepEqual((full[1] as { lines?: string[] })?.lines, ['searching: exa x3', 'fetched 5 sources']);
      assert.equal((full[2] as { from?: string })?.from, 'scout');

      const runs = store.list();
      assert.equal(runs[0]?.output.length, 2);
      assert.equal(runs[0]?.controls.length, 1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('terminal status closes the run; list filters terminal vs live', () => {
    const root = tmp();
    try {
      const store = new FleetRunStore(root);
      store.append(record());
      store.append(record({ status: 'completed', ts: 2000 }));

      const runs = store.list();
      assert.equal(runs[0]?.status, 'completed');
      assert.ok(store.list({ live: true }).length === 0);
      assert.ok(store.list({ terminal: true }).length === 1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('hydrates from disk after restart (same content, no store state)', () => {
    const root = tmp();
    try {
      const first = new FleetRunStore(root);
      first.append(record({ status: 'completed', ts: 9000, tokens: 4321 }));

      const second = new FleetRunStore(root);
      const runs = second.list();
      assert.equal(runs.length, 1);
      assert.equal(runs[0]?.status, 'completed');
      assert.equal(runs[0]?.tokens, 4321);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('corrupt jsonl lines are skipped, not fatal', () => {
    const root = tmp();
    try {
      const store = new FleetRunStore(root);
      store.append(record());
      const file = (store as unknown as { fileFor(runId: string): string }).fileFor('researcher:0');
      const raw = readFileSync(file, 'utf8');
      const lines = raw.split('\n');
      lines.splice(1, 0, '{not json');
      lines.push('{"ts":');
      writeFileSync(file, lines.join('\n'));

      const second = new FleetRunStore(root);
      assert.equal(second.list().length, 1);
      assert.equal(second.transcript('researcher:0').length, 1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('run files land under <root>/<sessionId>/<runId>.jsonl when a sessionId is given', () => {
    const root = tmp();
    try {
      const store = new FleetRunStore(root, 'conv-123');
      store.append(record());
      const file = (store as unknown as { fileFor(runId: string): string }).fileFor('researcher:0');
      assert.ok(file.includes(join('conv-123', 'researcher_0.jsonl'))); // ':' sanitized (Windows ADS)
      assert.ok(existsSync(file));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('FleetRunStore.markStopped', () => {
  it('closes a running run as terminal so it hydrates as stopped', () => {
    const root = tmp();
    try {
      const store = new FleetRunStore(root);
      store.append(record());
      store.markStopped('researcher:0', 'detached', 'Stopped by user in Scout');

      const runs = store.list();
      assert.equal(runs[0]?.status, 'detached');
      assert.equal(runs[0]?.error, 'Stopped by user in Scout');
      assert.ok(store.list({ terminal: true }).length === 1);
      assert.ok(store.list({ live: true }).length === 0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('is a no-op for unknown runs', () => {
    const root = tmp();
    try {
      const store = new FleetRunStore(root);
      store.markStopped('ghost:9');
      assert.equal(store.list().length, 0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
