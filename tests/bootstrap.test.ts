import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { bootstrapAgentDir, SCOUT_PACKAGES } from '../src/main/bootstrap.ts';

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'scout-test-'));
}

test('imports auth files from the global pi dir once, then stays decoupled', () => {
  const globalDir = tmpDir();
  const agentDir = path.join(tmpDir(), 'agent');
  fs.writeFileSync(path.join(globalDir, 'auth.json'), '{"google":"tok"}');

  const first = bootstrapAgentDir(agentDir, globalDir);
  assert.deepEqual(first.imported, ['auth.json']);
  assert.equal(fs.readFileSync(path.join(agentDir, 'auth.json'), 'utf8'), '{"google":"tok"}');

  // User re-authenticates globally later; Scout must NOT pick it up again.
  fs.writeFileSync(path.join(globalDir, 'auth.json'), '{"rotated":"tok"}');
  const second = bootstrapAgentDir(agentDir, globalDir);
  assert.deepEqual(second.imported, []);
  assert.equal(fs.readFileSync(path.join(agentDir, 'auth.json'), 'utf8'), '{"google":"tok"}');
});

test('creates settings.json with the pinned research packages on first run only', () => {
  const agentDir = path.join(tmpDir(), 'agent');

  const result = bootstrapAgentDir(agentDir, tmpDir());
  assert.equal(result.settingsCreated, true);
  const settings = JSON.parse(fs.readFileSync(path.join(agentDir, 'settings.json'), 'utf8'));
  assert.deepEqual(settings.packages, [...SCOUT_PACKAGES]);

  // User edits settings afterwards: bootstrap must not clobber.
  fs.writeFileSync(path.join(agentDir, 'settings.json'), '{"packages":["npm:something-else"]}');
  const again = bootstrapAgentDir(agentDir, tmpDir());
  assert.equal(again.settingsCreated, false);
  const kept = JSON.parse(fs.readFileSync(path.join(agentDir, 'settings.json'), 'utf8'));
  assert.deepEqual(kept.packages, ['npm:something-else']);
});

test('is idempotent and creates the agentDir when missing', () => {
  const agentDir = path.join(tmpDir(), 'nested', 'agent');
  const a = bootstrapAgentDir(agentDir, tmpDir());
  const b = bootstrapAgentDir(agentDir, tmpDir());
  assert.equal(a.settingsCreated, true);
  assert.equal(b.settingsCreated, false);
  assert.deepEqual(b.imported, []);
  assert.ok(fs.existsSync(path.join(agentDir, 'settings.json')));
});
