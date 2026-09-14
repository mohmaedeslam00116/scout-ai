/**
 * ProjectRegistry — the ordered project list (decision #16 §1).
 *
 * Owns `<projectsDir>/registry.json`: create / rename / touch / remove, with
 * sidebar order = array order (newest first) and `lastOpenedAt` driving the
 * "sort by last prompt" behavior. Writes are atomic (write-temp + rename) and
 * create the project directory on `create` so a project always has its home.
 * A missing file means "first run" (empty registry); a corrupt one degrades to
 * empty rather than crashing the app.
 *
 * Pure Node: no Electron, no pi — unit-testable over a temp dir.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import * as path from 'node:path';

export interface ProjectMeta {
  id: string;
  name: string;
  createdAt: number;
  lastOpenedAt: number;
}

interface RegistryFile {
  version: 1;
  projects: ProjectMeta[];
}

const ID_ALPHABET = '0123456789abcdef';

function newProjectId(): string {
  let id = 'p_';
  for (let i = 0; i < 8; i++) {
    id += ID_ALPHABET[Math.floor(Math.random() * ID_ALPHABET.length)];
  }
  return id;
}

export class ProjectRegistry {
  private readonly file: string;
  private readonly projectsDir: string;
  private readonly cache = new Map<string, ProjectMeta>();
  /** Preserved insertion (creation) order, newest last; list() reverses it. */
  private readonly order: string[] = [];
  private loaded = false;

  constructor(file: string, projectsDir: string) {
    this.file = file;
    this.projectsDir = projectsDir;
  }

  private load(): void {
    if (this.loaded) return;
    this.loaded = true;
    if (!existsSync(this.file)) return; // first run: empty registry
    try {
      const parsed = JSON.parse(readFileSync(this.file, 'utf8')) as RegistryFile;
      for (const p of parsed.projects ?? []) {
        if (typeof p?.id === 'string' && typeof p?.name === 'string') {
          this.cache.set(p.id, {
            id: p.id,
            name: p.name,
            createdAt: p.createdAt ?? 0,
            lastOpenedAt: p.lastOpenedAt ?? 0,
          });
          this.order.push(p.id);
        }
      }
    } catch {
      // Corrupt registry: degrade to empty rather than crashing the app.
    }
  }

  private persist(): void {
    const body: RegistryFile = {
      version: 1,
      projects: this.order.map((id) => this.cache.get(id)!),
    };
    mkdirSync(this.projectsDir, { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(body, null, 2), 'utf8');
    renameSync(tmp, this.file);
  }

  list(): ProjectMeta[] {
    this.load();
    return this.order
      .map((id) => this.cache.get(id)!)
      .reverse()
      .map((p) => ({ ...p }));
  }

  get(id: string): ProjectMeta | undefined {
    this.load();
    const found = this.cache.get(id);
    return found ? { ...found } : undefined;
  }

  create(name: string): ProjectMeta {
    this.load();
    const meta: ProjectMeta = {
      id: newProjectId(),
      name: name.trim() || 'Untitled project',
      createdAt: Date.now(),
      lastOpenedAt: Date.now(),
    };
    this.cache.set(meta.id, meta);
    this.order.push(meta.id);
    mkdirSync(path.join(this.projectsDir, meta.id), { recursive: true });
    this.persist();
    return { ...meta };
  }

  rename(id: string, name: string): void {
    this.load();
    const meta = this.cache.get(id);
    if (!meta) throw new Error(`Unknown project: ${id}`);
    meta.name = name.trim() || meta.name;
    this.persist();
  }

  /** Record an open/visit; moves the project to the top of the sidebar. */
  touch(id: string): void {
    this.load();
    const meta = this.cache.get(id);
    if (!meta) return;
    meta.lastOpenedAt = Date.now();
    const at = this.order.indexOf(id);
    if (at >= 0) this.order.splice(at, 1);
    this.order.push(id);
    this.persist();
  }

  /** Remove the entry and the entire project directory (decision #16 §4). */
  remove(id: string): void {
    this.load();
    if (!this.cache.has(id)) return;
    this.cache.delete(id);
    const at = this.order.indexOf(id);
    if (at >= 0) this.order.splice(at, 1);
    this.persist();
    rmSync(path.join(this.projectsDir, id), { recursive: true, force: true });
  }
}
