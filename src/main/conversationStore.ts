/**
 * ConversationStore — Scout-side conversation metadata + moves (decision #16).
 *
 * pi has no archive concept, so archived/pinned flags live as marker files in
 * a `conversation-meta/` dir beside the sessions they describe (keyed by the
 * session file name + `.archived`). Moving a scratch conversation into a
 * project relocates the session jsonl plus its associated artifacts and runs
 * (T01's layout keeps them name-adjacent / run-dir-keyed by conversation) via
 * write-temp + rename semantics; on any failure the source is left intact.
 *
 * Pure Node: no Electron, no pi — unit-testable over a temp dir.
 */

import { existsSync, mkdirSync, readdirSync, renameSync, writeFileSync, rmSync } from 'node:fs';
import * as path from 'node:path';

import type { ScoutPaths } from './paths.ts';

export class ConversationStore {
  private readonly paths: ScoutPaths;

  constructor(paths: ScoutPaths) {
    this.paths = paths;
  }

  private baseName(sessionPath: string): string {
    return path.basename(sessionPath);
  }

  /** <sessions>/<name>.jsonl → <conversation-meta>/<name>.json.archived */
  private flagPath(sessionPath: string): { dir: string; flag: string } {
    const name = this.baseName(sessionPath);
    // Scratch sessions live under the scratch sessions dir; anything else is
    // treated as project-scoped and must name its project by path position.
    const normalized = sessionPath.replaceAll('\\', '/');
    const marker = `${this.paths.scratchSessions.replaceAll('\\', '/')}/`;
    if (normalized.startsWith(marker)) {
      return { dir: this.paths.scratchMeta, flag: `${name}.archived` };
    }
    // Project session: <projects>/<projectId>/sessions/<name>.jsonl
    const projectsRoot = this.paths.projectsDir.replaceAll('\\', '/');
    const rest = normalized.slice(projectsRoot.length + 1); // <projectId>/sessions/<name>
    const projectId = rest.split('/')[0] ?? '';
    return { dir: this.paths.projectMeta(projectId), flag: `${name}.archived` };
  }

  isArchived(sessionPath: string): boolean {
    const { dir, flag } = this.flagPath(sessionPath);
    return existsSync(path.join(dir, flag));
  }

  archive(sessionPath: string): void {
    const { dir, flag } = this.flagPath(sessionPath);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, flag), '', 'utf8');
  }

  unarchive(sessionPath: string): void {
    const { dir, flag } = this.flagPath(sessionPath);
    rmSync(path.join(dir, flag), { force: true });
  }

  /**
   * Move a scratch conversation (by session file name) into a project:
   * session jsonl, its artifacts (`<convId>-*.md`), and its runs dir
   * (`<convId>/`). Rename-based; the source stays intact on failure.
   */
  moveScratchToProject(sessionFileName: string, projectId: string): void {
    const fromSession = path.join(this.paths.scratchSessions, sessionFileName);
    if (!existsSync(fromSession)) throw new Error(`Unknown scratch session: ${sessionFileName}`);

    const toSessions = this.paths.projectSessions(projectId);
    mkdirSync(toSessions, { recursive: true });
    mkdirSync(this.paths.projectArtifacts(projectId), { recursive: true });
    mkdirSync(this.paths.projectRuns(projectId), { recursive: true });

    // 1. Move the session file first; artifacts/runs follow (rename is atomic
    //    per file; a failure here leaves everything else in place).
    const toSession = path.join(toSessions, sessionFileName);
    renameSync(fromSession, toSession);

    try {
      const convId = sessionFileName.replace(/\.jsonl$/i, '');
      // Artifacts named `<convId>-*` belong to this conversation (T01 layout).
      if (existsSync(this.paths.scratchArtifacts)) {
        for (const entry of readdirSync(this.paths.scratchArtifacts)) {
          if (entry.startsWith(`${convId}-`)) {
            renameSync(
              path.join(this.paths.scratchArtifacts, entry),
              path.join(this.paths.projectArtifacts(projectId), entry),
            );
          }
        }
      }
      // Runs dir keyed by conversation id.
      const fromRuns = path.join(this.paths.scratchRuns, convId);
      if (existsSync(fromRuns)) {
        renameSync(fromRuns, path.join(this.paths.projectRuns(projectId), convId));
      }
      // 2. Archive flag (if any) moves to the project's meta dir.
      const { dir: fromMeta, flag } = this.flagPath(fromSession);
      const fromFlag = path.join(fromMeta, flag);
      if (existsSync(fromFlag)) {
        const toMeta = this.paths.projectMeta(projectId);
        mkdirSync(toMeta, { recursive: true });
        renameSync(fromFlag, path.join(toMeta, flag));
      }
    } catch (err) {
      // Roll the session back so the source state survives a partial move.
      try {
        renameSync(toSession, fromSession);
      } catch {
        /* best effort */
      }
      throw err;
    }
  }
}
