import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ProjectStore } from '../src/main/projectStore.ts';

describe('ProjectStore', () => {
  let root: string;
  let store: ProjectStore;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'scout-store-'));
    store = new ProjectStore(root);
  });

  it('ensure writes project.json with the decided schema on first call', () => {
    store.ensure('p_ab12cd34', { name: 'News monitor', folders: [] });
    const file = join(root, 'p_ab12cd34', 'project.json');
    assert.ok(existsSync(file));
    const raw = JSON.parse(readFileSync(file, 'utf8'));
    assert.equal(raw.id, 'p_ab12cd34');
    assert.equal(raw.name, 'News monitor');
    assert.deepEqual(raw.folders, []);
    assert.equal(raw.reviewPolicy, 'request-review');
    assert.equal(raw.security.preset, 'default');
    assert.deepEqual(raw.security.allowDomains, []);
    assert.deepEqual(raw.security.denyDomains, []);
    assert.equal(raw.security.commandPolicy, 'ask');
    assert.deepEqual(raw.mcp.enabledServers, []);
    assert.ok(raw.createdAt > 0);
  });

  it('ensure is idempotent: second call does not reset settings', () => {
    store.ensure('p_x', { name: 'X', folders: [] });
    store.patch('p_x', { security: { preset: 'full-machine' } });
    store.ensure('p_x', { name: 'X', folders: ['D:\\new'] });
    const s = store.get('p_x');
    assert.equal(s?.security.preset, 'full-machine'); // not reset
    assert.deepEqual(s?.folders, ['D:\\new']); // but folders refreshed
  });

  it('read returns null when project.json does not exist', () => {
    assert.equal(store.get('p_missing'), null);
  });

  it('patch deep-merges: preset change keeps sibling security fields', () => {
    store.ensure('p_y', { name: 'Y', folders: [] });
    store.patch('p_y', {
      security: { preset: 'full-machine', allowDomains: ['example.com'] },
    });
    const s = store.get('p_y');
    assert.equal(s?.security.preset, 'full-machine');
    assert.deepEqual(s?.security.allowDomains, ['example.com']);
    assert.equal(s?.security.commandPolicy, 'ask'); // untouched default
    assert.equal(s?.reviewPolicy, 'request-review'); // untouched default
  });

  it('patch updates review policy and mcp allowlist', () => {
    store.ensure('p_z', { name: 'Z', folders: [] });
    store.patch('p_z', {
      reviewPolicy: 'always-proceed',
      mcp: { enabledServers: ['fetch'] },
    });
    const s = store.get('p_z');
    assert.equal(s?.reviewPolicy, 'always-proceed');
    assert.deepEqual(s?.mcp.enabledServers, ['fetch']);
  });
});
