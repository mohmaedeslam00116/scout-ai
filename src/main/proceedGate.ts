/**
 * ProceedGate — the artifact review pause (decision #14).
 *
 * When a `register_artifact` tool call arrives under a request-review policy,
 * the host creates the artifact on disk, emits `artifact_created` to the UI,
 * and resolves the tool's continuation only when the human approves over IPC.
 * The tool's own Promise is the hold: nothing returns to the model until
 * approval — that is the whole gate.
 *
 * The controller is injectable so tests run the full host with a fake session
 * and a manually-driven gate; production wiring resolves from the
 * scout:artifacts:approve IPC channel.
 */

export interface ProceedController {
  readonly artifactId: string;
  readonly artifactKind: string;
  readonly artifactTitle: string;
  /** Resolve the held continuation (Approve). */
  approve(): void;
  /** Reject the held continuation (Deny — surfaces an error to the model). */
  reject(reason: string): void;
  /** The promise the tool's execute() awaits. */
  readonly settled: Promise<'approved' | 'rejected'>;
}

export interface GateHooks {
  onCreated(controller: ProceedController): void;
}

export function createProceedGate(
  artifactId: string,
  artifactKind: string,
  artifactTitle: string,
): { controller: ProceedController; promise: Promise<'approved' | 'rejected'> } {
  let resolveOutcome!: (outcome: 'approved' | 'rejected') => void;
  const settled = new Promise<'approved' | 'rejected'>((resolve) => {
    resolveOutcome = resolve;
  });
  const controller: ProceedController = {
    artifactId,
    artifactKind,
    artifactTitle,
    approve: () => resolveOutcome('approved'),
    reject: (reason: string) => {
      void reason;
      resolveOutcome('rejected');
    },
    settled,
  };
  return { controller, promise: settled };
}
