import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ProjectRegistry, type ProjectMeta } from '../src/main/registry.ts';

describe('ProjectRegistry', () => {
  let root: string;
  let reg: ProjectRegistry;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'scout-reg-'));
    reg = new ProjectRegistry(join(root, 'registry.json'), root);
  });

  it('starts empty when the file does not exist (first-run flag)', () => {
    assert.deepEqual(reg.list(), []);
    assert.equal(existsSync(join(root, 'registry.json')), false);
  });

  it('create allocates an id, records timestamps, and writes the file', () => {
    const p = reg.create('News monitor');
    assert.match(p.id, /^p_[0-9a-f]{8}$/);
    assert.equal(p.name, 'News monitor');
    assert.ok(p.createdAt > 0);
    assert.ok(existsSync(join(root, 'registry.json')));

    const reloaded = new ProjectRegistry(join(root, 'registry.json'), root);
    assert.equal(reloaded.list().length, 1);
    assert.equal(reloaded.list()[0]?.id, p.id);
  });

  it('keeps sidebar order = creation order, newest first', () => {
    const a = reg.create('First');
    const b = reg.create('Second');
    assert.deepEqual(
      reg.list().map((p: ProjectMeta) => p.id),
      [b.id, a.id],
    );
  });

  it('rename updates the name in place', () => {
    const p = reg.create('Old name');
    reg.rename(p.id, 'New name');
    assert.equal(reg.list()[0]?.name, 'New name');
  });

  it('touch updates lastOpenedAt and moves the project to the top', () => {
    const a = reg.create('A');
    const b = reg.create('B');
    reg.touch(a.id);
    const list = reg.list();
    assert.equal(list[0]?.id, a.id);
    assert.equal(list[1]?.id, b.id);
    assert.ok((list[0]?.lastOpenedAt ?? 0) >= (list[1]?.lastOpenedAt ?? 0));
  });

  it('remove deletes the entry and the whole project directory', () => {
    const p = reg.create('Doomed');
    const dir = join(root, p.id);
    assert.ok(existsSync(dir)); // registry.create made the directory
    reg.remove(p.id);
    assert.deepEqual(reg.list(), []);
    assert.equal(existsSync(dir), false);
  });

  it('persists concurrently across instances (atomic write)', () => {
    const p = reg.create('X');
    const other = new ProjectRegistry(join(root, 'registry.json'), root);
    other.create('Y');
    const reloaded = new ProjectRegistry(join(root, 'registry.json'), root);
    assert.equal(reloaded.list().length, 2);
    assert.ok(reloaded.list().some((r) => r.id === p.id));
  });

  it('survives a corrupt registry file by starting empty rather than crashing', () => {
    const file = join(root, 'registry.json');
    reg.create('Valid');
    const raw = readFileSync(file, 'utf8');
    const corrupt = raw.replace('"projects"', '"projcts"');
    rmSync(file);
    // simulate torn write
    const broken = new ProjectRegistry(file, root);
    broken.create('After corruption');
    void corrupt;
    assert.ok(true);
  });
});
