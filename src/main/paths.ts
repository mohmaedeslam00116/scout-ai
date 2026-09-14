/**
 * Scout on-disk layout (ADR-0003 + decision #16). All main-process code
 * resolves paths through this module so the layout stays single-sourced and
 * testable without Electron.
 *
 * <userData>/                  (Electron userData, e.g. %APPDATA%\scout-ai)
 * ├── agent/                   Scout's pi agentDir
 * ├── projects/
 * │   ├── registry.json        ordered project list (absence = first run)
 * │   └── <id>/                project.json + sessions/ + artifacts/ + runs/ + home/
 * └── scratch/                 same sub-layout as a project; no project.json
 */

import * as path from 'node:path';

export interface ScoutPaths {
  readonly dataRoot: string;
  readonly agentDir: string;
  readonly projectsDir: string;
  readonly registryFile: string;
  readonly scratchDir: string;
  readonly scratchSessions: string;
  readonly scratchArtifacts: string;
  readonly scratchRuns: string;
  readonly scratchHome: string;
  projectDir(projectId: string): string;
  projectFile(projectId: string): string;
  projectSessions(projectId: string): string;
  projectArtifacts(projectId: string): string;
  projectRuns(projectId: string): string;
  projectHome(projectId: string): string;
  /** Effective cwd for a project: first bound folder, else its auto home. */
  effectiveCwd(projectId: string, boundFolders: readonly string[]): string;
}

export function scoutPaths(userDataDir: string): ScoutPaths {
  const dataRoot = userDataDir;
  const projectsDir = path.join(dataRoot, 'projects');
  const scratchDir = path.join(dataRoot, 'scratch');
  return {
    dataRoot,
    agentDir: path.join(dataRoot, 'agent'),
    projectsDir,
    registryFile: path.join(projectsDir, 'registry.json'),
    scratchDir,
    scratchSessions: path.join(scratchDir, 'sessions'),
    scratchArtifacts: path.join(scratchDir, 'artifacts'),
    scratchRuns: path.join(scratchDir, 'runs'),
    scratchHome: path.join(scratchDir, 'home'),
    projectDir(projectId) {
      return path.join(projectsDir, projectId);
    },
    projectFile(projectId) {
      return path.join(projectsDir, projectId, 'project.json');
    },
    projectSessions(projectId) {
      return path.join(projectsDir, projectId, 'sessions');
    },
    projectArtifacts(projectId) {
      return path.join(projectsDir, projectId, 'artifacts');
    },
    projectRuns(projectId) {
      return path.join(projectsDir, projectId, 'runs');
    },
    projectHome(projectId) {
      return path.join(projectsDir, projectId, 'home');
    },
    effectiveCwd(projectId, boundFolders) {
      return boundFolders[0] ?? path.join(projectsDir, projectId, 'home');
    },
  };
}
