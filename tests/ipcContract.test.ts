import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/**
 * IPC contract (test seam #1): every channel the preload invokes must have a
 * handler in main, and every handler main registers must be offered by the
 * preload. Scans the literals on both sides — no Electron needed.
 */

const preloadSrc = readFileSync(new URL('../src/preload/preload.ts', import.meta.url), 'utf8');
const mainSrc = readFileSync(new URL('../src/main/main.ts', import.meta.url), 'utf8');

function channelsOf(src: string, pattern: RegExp): Set<string> {
  const set = new Set<string>();
  for (const match of src.matchAll(pattern)) {
    if (match[1]) set.add(match[1]);
  }
  return set;
}

/** Every scout channel literal mentioned in a file (multiline-safe). */
function scoutChannels(src: string): Set<string> {
  return channelsOf(src, /'(scout:[^']+)'/g);
}

describe('scout IPC contract', () => {
  const invoked = scoutChannels(preloadSrc);
  const handled = scoutChannels(mainSrc);
  const sent = channelsOf(mainSrc, /webContents\.send\('([^']+)'/g);
  const listened = channelsOf(preloadSrc, /ipcRenderer\.on\('([^']+)'/g);

  it('preload invokes are all handled in main', () => {
    const missing = [...invoked].filter((c) => !handled.has(c));
    assert.deepEqual(missing, []);
  });

  it('main handlers are all offered by the preload', () => {
    const extra = [...handled].filter((c) => !invoked.has(c));
    assert.deepEqual(extra, []);
  });

  it('event streams match (main send ↔ preload listen)', () => {
    assert.deepEqual([...sent].filter((c) => !listened.has(c)), []);
    assert.deepEqual([...listened].filter((c) => !sent.has(c)), []);
  });

  it('projects channels exist (decision #16 §4 surface)', () => {
    for (const channel of [
      'scout:projects:list',
      'scout:projects:create',
      'scout:projects:open',
      'scout:projects:patch',
      'scout:projects:delete',
      'scout:projects:conversations',
      'scout:scratch:conversations',
    ]) {
      assert.ok(invoked.has(channel), `preload missing ${channel}`);
      assert.ok(handled.has(channel), `main missing ${channel}`);
    }
  });
});
