/**
 * Scout agent-dir bootstrap (ADR-0003 + wayfinder decisions #3/#6/#8).
 *
 * Pure Node: no Electron, no pi imports — fully unit-testable. On first run
 * Scout's own pi agentDir is provisioned with:
 *  - a one-time copy of auth.json / models.json from the user's global
 *    `~/.pi/agent` (reuse existing provider logins, then stay decoupled),
 *  - a settings.json preloading the three research packages (pinned per the
 *    packages-loading research) unless the user already customized them.
 *
 * The pi harness (createAgentSession) picks the rest up via its own loader.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

/** Pinned in the packages-loading research ticket (#6). Unscoped npm names. */
export const SCOUT_PACKAGES = [
  'npm:pi-web-access@0.29.0',
  'npm:pi-subagents@0.67.0',
  'npm:billion-context@0.1.111',
] as const;

/** Files copied once from the user's global pi agentDir, if present. */
const AUTH_FILES = ['auth.json', 'models.json'] as const;

export interface BootstrapResult {
  agentDir: string;
  /** Files copied from the global pi dir ("auth.json", "models.json"). */
  imported: string[];
  /** True when settings.json was created by Scout (not touched if user-edited). */
  settingsCreated: boolean;
}

function copyIfMissing(src: string, dest: string): boolean {
  if (!fs.existsSync(src) || fs.existsSync(dest)) return false;
  fs.copyFileSync(src, dest);
  return true;
}

/**
 * Provision Scout's pi agentDir. Idempotent: safe to call on every startup.
 *
 * @param agentDir   Scout's own agentDir (from scoutPaths, never ~/.pi/agent)
 * @param globalDir  the user's global pi agentDir (default ~/.pi/agent)
 */
export function bootstrapAgentDir(
  agentDir: string,
  globalDir = path.join(process.env['HOME'] ?? process.env['USERPROFILE'] ?? '', '.pi', 'agent'),
): BootstrapResult {
  fs.mkdirSync(agentDir, { recursive: true });

  // 1. One-time auth import: copy only files Scout does not have yet, so the
  //    user's logins carry over but the two installs stay decoupled after that.
  const imported: string[] = [];
  for (const file of AUTH_FILES) {
    if (copyIfMissing(path.join(globalDir, file), path.join(agentDir, file))) {
      imported.push(file);
    }
  }

  // 2. Packages settings: only on first creation. If the user edits
  //    settings.json afterwards, we never overwrite it.
  const settingsFile = path.join(agentDir, 'settings.json');
  let settingsCreated = false;
  if (!fs.existsSync(settingsFile)) {
    fs.writeFileSync(
      settingsFile,
      `${JSON.stringify({ packages: [...SCOUT_PACKAGES] }, null, 2)}\n`,
    );
    settingsCreated = true;
  }

  return { agentDir, imported, settingsCreated };
}
