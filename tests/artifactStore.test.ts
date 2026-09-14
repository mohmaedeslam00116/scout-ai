import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ArtifactStore } from '../src/main/artifactStore.ts';

function seededStore() {
  const root = mkdtempSync(join(tmpdir(), 'scout-art-'));
  const paths = {
    projectArtifacts: (id: string) => join(root, 'projects', id, 'artifacts'),
    scratchArtifacts: join(root, 'scratch', 'artifacts'),
  };
  return { root, paths, store: new ArtifactStore(paths as never) };
}

describe('ArtifactStore', () => {
  it('create writes artifact.json + v1.md and returns the record', () => {
    const { store } = seededStore();
    const a = store.create('p_x', {
      kind: 'research-brief',
      title: 'News scan',
      body: '## Brief\n1. First draft',
    });
    assert.match(a.id, /^a_[0-9a-f]{8}$/);
    assert.equal(a.kind, 'research-brief');
    assert.equal(a.status, 'review'); // new brief pauses for review by default
    assert.equal(a.versions.length, 1);
    assert.equal(a.versions[0]?.version, 1);

    const dir = a.dir;
    const record = JSON.parse(readFileSync(join(dir, 'artifact.json'), 'utf8'));
    assert.equal(record.id, a.id);
    assert.equal(readFileSync(join(dir, 'v1.md'), 'utf8'), '## Brief\n1. First draft');
  });

  it('addVersion appends v2.md and never mutates v1', () => {
    const { store } = seededStore();
    const a = store.create('p_x', { kind: 'research-brief', title: 'T', body: 'v1 body' });
    store.addRevision(a.id, 'v2 body — feedback addressed');
    const hydrated = store.hydrate('p_x', a.id);
    assert.equal(hydrated?.versions.length, 2);
    assert.equal(hydrated?.versions[0]?.body, 'v1 body'); // untouched
    assert.equal(hydrated?.versions[1]?.body, 'v2 body — feedback addressed');
    assert.ok(existsSync(join(a.dir, 'v1.md')));
  });

  it('status transitions: approve sets approved; reopen a new brief re-pauses', () => {
    const { store } = seededStore();
    const a = store.create('p_x', { kind: 'research-brief', title: 'T', body: 'x' });
    assert.equal(a.status, 'review');
    store.approve(a.id);
    assert.equal(store.hydrate('p_x', a.id)?.status, 'approved');
    store.addRevision(a.id, 'post-approval tweak');
    assert.equal(store.hydrate('p_x', a.id)?.status, 'approved'); // revision flows freely
  });

  it('findByTitleKind matches a live artifact by kind+title in the same target', () => {
    const { store } = seededStore();
    const a = store.create('p_x', { kind: 'research-brief', title: 'Scan', body: 'x' });
    store.create('p_x', { kind: 'source-dossier', title: 'Scan', body: 'x' }); // other kind
    store.create('p_y', { kind: 'research-brief', title: 'Scan', body: 'x' }); // other target
    assert.equal(store.findByTitleKind('p_x', 'research-brief', 'Scan')?.id, a.id);
    assert.equal(store.findByTitleKind('p_x', 'research-brief', 'Nope'), null);
  });

  it('create accepts an explicit initial status (always-proceed records approved)', () => {
    const { store } = seededStore();
    const a = store.create('p_x', { kind: 'evidence-table', title: 'F', body: 'x', status: 'approved' });
    assert.equal(store.hydrate('p_x', a.id)?.status, 'approved');
  });

  it('comments append to the record', () => {
    const { store } = seededStore();
    const a = store.create('p_x', { kind: 'evidence-table', title: 'T', body: 'x' });
    store.addComment(a.id, 'cite the second source');
    const hydrated = store.hydrate('p_x', a.id);
    assert.equal(hydrated?.comments.length, 1);
    assert.equal(hydrated?.comments[0]?.text, 'cite the second source');
  });

  it('list hydrates every artifact under a project', () => {
    const { store } = seededStore();
    store.create('p_x', { kind: 'research-brief', title: 'A', body: 'a' });
    store.create('p_x', { kind: 'source-dossier', title: 'B', body: 'b' });
    const all = store.list('p_x');
    assert.equal(all.length, 2);
    assert.deepEqual(
      all.map((x) => x.title).sort(),
      ['A', 'B'],
    );
  });

  it('scratch artifacts live in the scratch dir', () => {
    const { paths, store } = seededStore();
    const a = store.create(null, { kind: 'research-brief', title: 'S', body: 's' });
    assert.ok(a.dir.startsWith(paths.scratchArtifacts));
    assert.equal(store.list(null).length, 1);
  });
});
