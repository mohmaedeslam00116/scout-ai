import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ArtifactStore } from '../src/main/artifactStore.ts';
import { runRegisterArtifact, shouldAwaitApproval } from '../src/main/artifactTool.ts';
import type { ProceedController } from '../src/main/proceedGate.ts';

function makeDeps(policy: 'always-proceed' | 'agent-decides' | 'request-review') {
  const root = mkdtempSync(join(tmpdir(), 'scout-tool-'));
  const store = new ArtifactStore({
    projectArtifacts: (id: string) => join(root, 'projects', id, 'artifacts'),
    scratchArtifacts: join(root, 'scratch', 'artifacts'),
  });
  const emitted: unknown[] = [];
  const gates: ProceedController[] = [];
  return {
    store,
    emitted,
    gates,
    deps: {
      store,
      projectId: 'p_x',
      reviewPolicy: policy,
      emit: (e: unknown) => emitted.push(e),
      onGate: (c: ProceedController) => gates.push(c),
      log: () => {},
    },
  };
}

describe('runRegisterArtifact', () => {
  it('creates the artifact on disk and emits artifact_created', async () => {
    const { deps, emitted, store } = makeDeps('always-proceed');
    const result = await runRegisterArtifact(
      { kind: 'research-brief', title: 'Scan', body: '# body' },
      deps,
      shouldAwaitApproval('always-proceed'),
    );
    assert.match(result.artifactId, /^a_[0-9a-f]{8}$/);
    assert.equal(emitted[0] && (emitted[0] as { type: string }).type, 'artifact_created');
    const hydrated = store.hydrate('p_x', result.artifactId);
    assert.equal(hydrated?.versions[0]?.body, '# body');
  });

  it('holds the continuation under request-review until approved', async () => {
    const { deps, gates } = makeDeps('request-review');
    const pending = runRegisterArtifact(
      { kind: 'research-brief', title: 'Gate me', body: 'x' },
      deps,
      shouldAwaitApproval('request-review'),
    );
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(gates.length, 1); // gate registered, tool still pending
    let done = false;
    pending.then(() => (done = true));
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(done, false); // the hold is real
    gates[0]?.approve();
    const result = await pending;
    assert.equal(result.approved, true);
  });

  it('reject surfaces a model-visible error', async () => {
    const { deps, gates } = makeDeps('request-review');
    const pending = runRegisterArtifact(
      { kind: 'research-brief', title: 'Nope', body: 'x' },
      deps,
      true,
    );
    await new Promise((r) => setTimeout(r, 20));
    gates[0]?.reject('wrong direction');
    await assert.rejects(() => pending, /rejected by the user/);
  });

  it('always-proceed and agent-decides never pause', async () => {
    assert.equal(shouldAwaitApproval('always-proceed'), false);
    assert.equal(shouldAwaitApproval('agent-decides'), false);
    assert.equal(shouldAwaitApproval('request-review'), true);
    const a = makeDeps('always-proceed');
    const t0 = Date.now();
    await runRegisterArtifact({ kind: 'evidence-table', title: 'F', body: 'x' }, a.deps, false);
    assert.ok(Date.now() - t0 < 100); // no hold
  });

  it('always-proceed records the artifact as approved, not stuck in review', async () => {
    const { deps, store } = makeDeps('always-proceed');
    const result = await runRegisterArtifact(
      { kind: 'research-brief', title: 'Flow', body: 'x' },
      deps,
      false,
    );
    assert.equal(store.hydrate('p_x', result.artifactId)?.status, 'approved');
  });

  it('a call matching title+kind of an existing artifact appends a revision instead of duplicating', async () => {
    const { deps, store, emitted } = makeDeps('always-proceed');
    const first = await runRegisterArtifact(
      { kind: 'research-brief', title: 'Scan', body: 'v1 body' },
      deps,
      false,
    );
    const second = await runRegisterArtifact(
      { kind: 'research-brief', title: 'Scan', body: 'v2 body — feedback addressed' },
      deps,
      false,
    );
    assert.equal(second.artifactId, first.artifactId); // same artifact, new version
    const hydrated = store.hydrate('p_x', first.artifactId);
    assert.equal(hydrated?.versions.length, 2);
    assert.equal(hydrated?.versions[0]?.body, 'v1 body'); // append-only held
    const last = emitted.at(-1) as { type: string; version: number };
    assert.equal(last.type, 'artifact_updated');
    assert.equal(last.version, 2);
  });

  it('a revision of an approved artifact does not re-pause under request-review', async () => {
    const { deps, store, gates } = makeDeps('request-review');
    const first = runRegisterArtifact(
      { kind: 'research-brief', title: 'Scan', body: 'v1' },
      deps,
      true,
    );
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(gates.length, 1);
    gates[0]?.approve();
    const created = await first;
    store.approve(created.artifactId);

    const second = await runRegisterArtifact(
      { kind: 'research-brief', title: 'Scan', body: 'v2' },
      deps,
      true,
    );
    assert.equal(gates.length, 1); // no second gate — revisions flow freely
    assert.equal(second.artifactId, created.artifactId);
  });

  it('a genuinely new brief still pauses under request-review', async () => {
    const { deps, gates } = makeDeps('request-review');
    const pending = runRegisterArtifact(
      { kind: 'source-dossier', title: 'Different thing entirely', body: 'x' },
      deps,
      true,
    );
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(gates.length, 1);
    gates[0]?.approve();
    await pending;
  });
});
