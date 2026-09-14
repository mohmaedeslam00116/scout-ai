/**
 * Scout on-disk layout (ADR-0003). All main-process code resolves paths through
 * this module so the layout stays single-sourced and testable without Electron.
 *
 * <userData>/                  (Electron userData, e.g. %APPDATA%\scout-ai)
 * ├── agent/                   Scout's pi agentDir
 * ├── projects/<id>/           project.json + home/ (effective cwd fallback)
 * └── registry.json            ordered project list
 */

import * as path from 'node:path';

export interface ScoutPaths {
  readonly dataRoot: string;
  readonly agentDir: string;
  readonly projectsDir: string;
  readonly registryFile: string;
  projectDir(projectId: string): string;
  projectFile(projectId: string): string;
  /** Effective cwd for a project: first bound folder, else its auto home. */
  effectiveCwd(projectId: string, boundFolders: readonly string[]): string;
}

export function scoutPaths(userDataDir: string): ScoutPaths {
  const dataRoot = userDataDir;
  const agentDir = path.join(dataRoot, 'agent');
  const projectsDir = path.join(dataRoot, 'projects');
  return {
    dataRoot,
    agentDir,
    projectsDir,
    registryFile: path.join(dataRoot, 'registry.json'),
    projectDir(projectId) {
      return path.join(projectsDir, projectId);
    },
    projectFile(projectId) {
      return path.join(projectsDir, projectId, 'project.json');
    },
    effectiveCwd(projectId, boundFolders) {
      return boundFolders[0] ?? path.join(projectsDir, projectId, 'home');
    },
  };
}
