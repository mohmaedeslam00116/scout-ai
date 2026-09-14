/**
 * ProjectStore — per-project settings (project.json), decision #16 §2.
 *
 * Schema is the one locked on the ticket: id, name, folders (0..n bound
 * folders), reviewPolicy (from #14), security (preset + allow/deny domains +
 * commandPolicy, from #13/#18), mcp.enabledServers (from #18), createdAt.
 * `ensure` creates the file with defaults if absent and refreshes name/folders
 * without resetting user settings; `patch` deep-merges partial updates.
 *
 * Pure Node: no Electron, no pi — unit-testable over a temp dir.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';

export type ReviewPolicy = 'always-proceed' | 'agent-decides' | 'request-review';
export type SecurityPreset = 'default' | 'full-machine' | 'unrestricted';
export type CommandPolicy = 'ask' | 'allow';

export interface ProjectSecurity {
  preset: SecurityPreset;
  allowDomains: string[];
  denyDomains: string[];
  commandPolicy: CommandPolicy;
}

export interface ProjectSettings {
  id: string;
  name: string;
  folders: string[];
  reviewPolicy: ReviewPolicy;
  security: ProjectSecurity;
  mcp: { enabledServers: string[] };
  createdAt: number;
}

export interface ProjectPatch {
  name?: string;
  folders?: string[];
  reviewPolicy?: ReviewPolicy;
  security?: Partial<ProjectSecurity>;
  mcp?: { enabledServers?: string[] };
}

const DEFAULT_SECURITY: ProjectSecurity = {
  preset: 'default',
  allowDomains: [],
  denyDomains: [],
  commandPolicy: 'ask',
};

export class ProjectStore {
  private readonly projectsDir: string;
  private readonly cache = new Map<string, ProjectSettings>();

  constructor(projectsDir: string) {
    this.projectsDir = projectsDir;
  }

  private fileFor(projectId: string): string {
    return path.join(this.projectsDir, projectId, 'project.json');
  }

  /** Create project.json with defaults if absent; refresh name/folders only. */
  ensure(projectId: string, seed: { name: string; folders: string[] }): void {
    const existing = this.readFresh(projectId);
    if (!existing) {
      const fresh: ProjectSettings = {
        id: projectId,
        name: seed.name,
        folders: [...seed.folders],
        reviewPolicy: 'request-review',
        security: { ...DEFAULT_SECURITY, allowDomains: [], denyDomains: [] },
        mcp: { enabledServers: [] },
        createdAt: Date.now(),
      };
      this.write(projectId, fresh);
      return;
    }
    // Refresh identity fields; never reset user settings.
    if (existing.name !== seed.name || JSON.stringify(existing.folders) !== JSON.stringify(seed.folders)) {
      existing.name = seed.name;
      existing.folders = [...seed.folders];
      this.write(projectId, existing);
    }
  }

  /** Cached read for hot paths; null when the project has no settings file. */
  get(projectId: string): ProjectSettings | null {
    if (this.cache.has(projectId)) return this.cache.get(projectId)!;
    return this.readFresh(projectId);
  }

  private readFresh(projectId: string): ProjectSettings | null {
    const file = this.fileFor(projectId);
    if (!existsSync(file)) return null;
    try {
      const parsed = JSON.parse(readFileSync(file, 'utf8')) as ProjectSettings;
      // Fill defaults for forward compatibility.
      const merged: ProjectSettings = {
        ...parsed,
        security: { ...DEFAULT_SECURITY, ...parsed.security },
        mcp: { ...parsed.mcp, enabledServers: parsed.mcp?.enabledServers ?? [] },
      };
      this.cache.set(projectId, merged);
      return merged;
    } catch {
      return null; // corrupt settings degrade to defaults on next ensure
    }
  }

  /** Deep-merge a partial update and persist atomically. */
  patch(projectId: string, patch: ProjectPatch): ProjectSettings {
    const current = this.get(projectId);
    if (!current) throw new Error(`Unknown project settings: ${projectId}`);
    const next: ProjectSettings = {
      ...current,
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.folders !== undefined ? { folders: [...patch.folders] } : {}),
      ...(patch.reviewPolicy !== undefined ? { reviewPolicy: patch.reviewPolicy } : {}),
      ...(patch.security !== undefined
        ? { security: { ...current.security, ...patch.security } }
        : {}),
      ...(patch.mcp !== undefined ? { mcp: { ...current.mcp, ...patch.mcp } } : {}),
    };
    this.write(projectId, next);
    return next;
  }

  private write(projectId: string, settings: ProjectSettings): void {
    mkdirSync(path.join(this.projectsDir, projectId), { recursive: true });
    const file = this.fileFor(projectId);
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, JSON.stringify(settings, null, 2), 'utf8');
    renameSync(tmp, file);
    this.cache.set(projectId, settings);
  }
}
