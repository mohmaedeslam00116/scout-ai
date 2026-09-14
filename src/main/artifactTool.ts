/**
 * register_artifact — Scout's custom tool (decision #14).
 *
 * Shipped via `customTools` at createAgentSession time; no separate extension
 * package, pi stays confined to src/main. The factory is the ONLY pi-typed
 * code here: tests exercise the pure `runRegisterArtifact` below with fake
 * deps, and the tool factory adapts it to pi's ToolDefinition (the dynamic
 * 'typebox' import keeps typecheck and tests free of pi/typebox loading).
 *
 * Gate semantics: under request-review policy the tool writes the artifact,
 * emits artifact_created, then AWAITS the ProceedController before returning
 * — the tool's pending Promise is the pause. Approve resolves it; the model
 * learns the artifact was accepted and continues. A comment accompanying the
 * approve action rides session steering (handled by the IPC layer, not here).
 */

import { createProceedGate, type ProceedController } from './proceedGate.ts';
import type { ArtifactStore } from './artifactStore.ts';

export type ArtifactToolDeps = {
  store: ArtifactStore;
  /** Target: null = scratch. */
  projectId: string | null;
  /** reviewPolicy from the target's project.json (default request-review). */
  reviewPolicy: 'always-proceed' | 'agent-decides' | 'request-review';
  emit(event: unknown): void;
  /** Called with each gate so the IPC layer can resolve it later. */
  onGate(controller: ProceedController): void;
  log(kind: string, text: string): void;
};

export interface RegisterArtifactArgs {
  kind: 'research-brief' | 'source-dossier' | 'evidence-table';
  title: string;
  body: string;
}

/**
 * Pure core of the tool: writes to disk, emits to the UI, holds the gate.
 * Returns what the tool should tell the model. `awaitApproval=false`
 * (always-proceed / agent-decides) resolves immediately.
 */
export async function runRegisterArtifact(
  args: RegisterArtifactArgs,
  deps: ArtifactToolDeps,
  awaitApproval: boolean,
): Promise<{ artifactId: string; approved: boolean }> {
  // Revision detection (decision #14): a call matching kind+title of an
  // existing artifact in the same target appends a version instead of
  // duplicating — and never re-pauses, even under request-review.
  const existing = deps.store.findByTitleKind(deps.projectId, args.kind, args.title);
  if (existing) {
    const version = deps.store.addRevision(existing.id, args.body);
    deps.emit({ type: 'artifact_updated', id: existing.id, version, status: existing.status });
    deps.log('artifact', `register_artifact: ${args.kind} “${args.title}” v${version}`);
    return { artifactId: existing.id, approved: true };
  }

  const created = deps.store.create(deps.projectId, {
    kind: args.kind,
    title: args.title,
    body: args.body,
    // Under always-proceed / agent-decides the artifact flows freely: record
    // it approved so it never shows a stale Review badge.
    status: awaitApproval ? 'review' : 'approved',
  });
  deps.emit({
    type: 'artifact_created',
    id: created.id,
    kind: created.kind,
    title: created.title,
    status: created.status,
  });
  deps.log('artifact', `register_artifact: ${args.kind} “${args.title}”`);

  if (!awaitApproval) {
    return { artifactId: created.id, approved: true };
  }

  const { controller, promise } = createProceedGate(created.id, created.kind, created.title);
  deps.onGate(controller);
  const outcome = await promise; // the continuation hold
  if (outcome === 'rejected') {
    throw new Error(`Artifact “${args.title}” was rejected by the user. Ask how to revise it.`);
  }
  return { artifactId: created.id, approved: true };
}

/** Production policy resolution: only request-review pauses. */
export function shouldAwaitApproval(reviewPolicy: ArtifactToolDeps['reviewPolicy']): boolean {
  return reviewPolicy === 'request-review';
}
