import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { scoutPaths } from '../src/main/paths.ts';
import { ProjectService } from '../src/main/projectService.ts';
import type { AgentHost, ConversationSummary } from '../src/main/agentHost.ts';

function fakeHost(listed: ConversationSummary[]): AgentHost {
  return { listConversations: async () => listed } as unknown as AgentHost;
}

describe('ProjectService', () => {
  let root: string;
  let paths: ReturnType<typeof scoutPaths>;
  let svc: ProjectService;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'scout-svc-'));
    paths = scoutPaths(root);
    svc = new ProjectService(paths, fakeHost([
      { path: 's1.jsonl', id: 's1', created: 1, modified: 10, messageCount: 2, firstMessage: 'hi' },
    ]));
  });

  it('create makes the full directory tree and default settings', () => {
    const view = svc.create('News monitor');
    assert.ok(existsSync(join(paths.projectDir(view.id), 'project.json')));
    assert.ok(existsSync(paths.projectHome(view.id)));
    assert.ok(existsSync(paths.projectSessions(view.id)));
    assert.ok(existsSync(paths.projectArtifacts(view.id)));
    assert.ok(existsSync(paths.projectRuns(view.id)));
    assert.equal(view.settings?.reviewPolicy, 'request-review');
  });

  it('open refreshes the registry order and returns conversations', async () => {
    const a = svc.create('A');
    const b = svc.create('B');
    const opened = await svc.open(a.id);
    assert.equal(opened.settings?.id, a.id);
    assert.equal(opened.conversations[0]?.id, 's1');
    const list = svc.list();
    assert.equal(list[0]?.id, a.id); // touched to top
    void b;
  });

  it('sendTargetFor honors bound folders vs auto home', () => {
    const p1 = svc.create('Web only');
    assert.equal(svc.sendTargetFor(p1.id).cwd, paths.projectHome(p1.id));
    assert.equal(svc.sendTargetFor(p1.id).sessionDir, paths.projectSessions(p1.id));

    const p2 = svc.create('Bound', ['D:\\research\\feeds']);
    assert.equal(svc.sendTargetFor(p2.id).cwd, 'D:\\research\\feeds');
  });

  it('scratchTarget uses the scratch layout', () => {
    const t = svc.scratchTarget();
    assert.equal(t.cwd, paths.scratchHome);
    assert.equal(t.sessionDir, paths.scratchSessions);
  });

  it('delete removes the project directory entirely', () => {
    const p = svc.create('Doomed');
    svc.remove(p.id);
    assert.equal(existsSync(paths.projectDir(p.id)), false);
    assert.equal(svc.list().length, 0);
  });

  it('patchSettings writes through to project.json', () => {
    const p = svc.create('P');
    svc.patchSettings(p.id, { reviewPolicy: 'always-proceed' });
    assert.equal(svc.list()[0]?.settings?.reviewPolicy, 'always-proceed');
  });
});

// Cleanup helper so tmp dirs do not accumulate across runs.
process.on('exit', () => {
  try {
    rmSync(join(tmpdir(), 'scout-svc-'), { recursive: true, force: true });
  } catch {
    /* best effort */
  }
});
