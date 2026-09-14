import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { scoutPaths } from '../src/main/paths.ts';
import { ConversationStore } from '../src/main/conversationStore.ts';

describe('ConversationStore', () => {
  let root: string;
  let paths: ReturnType<typeof scoutPaths>;
  let store: ConversationStore;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'scout-conv-'));
    paths = scoutPaths(root);
    store = new ConversationStore(paths);
  });

  it('archive writes a flag file and isArchived reads it back; unarchive clears it', () => {
    const sessionPath = 'C:\\any\\session.jsonl';
    assert.equal(store.isArchived(sessionPath), false);
    store.archive(sessionPath);
    assert.equal(store.isArchived(sessionPath), true);
    store.unarchive(sessionPath);
    assert.equal(store.isArchived(sessionPath), false);
  });

  it('archive is scoped per project: a path under a project dir writes into its meta dir', () => {
    const sessionPath = join(paths.projectSessions('p_x'), 'abc.jsonl');
    store.archive(sessionPath);
    assert.ok(existsSync(join(paths.projectMeta('p_x'), 'abc.jsonl.archived')));
  });

  it('scratch conversations archive into the scratch meta dir', () => {
    const sessionPath = join(paths.scratchSessions, 'xyz.jsonl');
    store.archive(sessionPath);
    assert.ok(existsSync(join(paths.scratchMeta, 'xyz.jsonl.archived')));
  });

  it('moveScratchToProject relocates session, artifacts, and runs, and carries the archive flag', () => {
    // Seed a scratch conversation with sidecar content.
    mkdirSync(paths.scratchSessions, { recursive: true });
    const sessionFile = join(paths.scratchSessions, 'conv1.jsonl');
    writeFileSync(sessionFile, '{}', 'utf8');
    mkdirSync(paths.scratchArtifacts, { recursive: true });
    writeFileSync(join(paths.scratchArtifacts, 'conv1-art1.md'), '# brief', 'utf8');
    mkdirSync(join(paths.scratchRuns, 'conv1'), { recursive: true });
    writeFileSync(join(paths.scratchRuns, 'conv1', 'r1.jsonl'), '{}', 'utf8');
    store.archive(sessionFile);

    store.moveScratchToProject('conv1.jsonl', 'p_new');

    assert.equal(existsSync(sessionFile), false);
    assert.ok(existsSync(join(paths.projectSessions('p_new'), 'conv1.jsonl')));
    assert.ok(existsSync(join(paths.projectArtifacts('p_new'), 'conv1-art1.md')));
    assert.ok(existsSync(join(paths.projectRuns('p_new'), 'conv1', 'r1.jsonl')));
    // The archive flag moved too and still reads as archived.
    assert.equal(store.isArchived(join(paths.projectSessions('p_new'), 'conv1.jsonl')), true);
    assert.equal(existsSync(join(paths.scratchMeta, 'conv1.jsonl.archived')), false);
  });

  it('move is atomic enough: a failed move leaves the source intact', () => {
    mkdirSync(paths.scratchSessions, { recursive: true });
    const sessionFile = join(paths.scratchSessions, 'conv2.jsonl');
    writeFileSync(sessionFile, '{}', 'utf8');
    // Force failure: target project dir is a file, rename must throw.
    mkdirSync(paths.projectsDir, { recursive: true });
    writeFileSync(join(paths.projectsDir, 'p_bad'), 'not a dir', 'utf8');
    assert.throws(() => store.moveScratchToProject('conv2.jsonl', 'p_bad'));
    assert.ok(existsSync(sessionFile)); // source untouched
  });
});
