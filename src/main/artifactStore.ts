/**
 * ArtifactStore — on-disk artifacts per decision #14.
 *
 * Layout: `<artifactsDir>/<artifactId>/artifact.json` + append-only
 * `v1.md, v2.md…`. Plain markdown stays diffable; versions are never mutated,
 * only appended. A new artifact starts in `review` (the Proceed gate pauses
 * the run under request-review policy); post-approval revisions keep the
 * approved status — the gate re-fires only on genuinely new briefs.
 *
 * Pure Node: no Electron, no pi — unit-testable over a temp dir.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';

export type ArtifactKind = 'research-brief' | 'source-dossier' | 'evidence-table';
export type ArtifactStatus = 'draft' | 'review' | 'approved';

export interface StoredComment {
  id: string;
  text: string;
  ts: number;
}

export interface ArtifactRecord {
  id: string;
  kind: ArtifactKind;
  title: string;
  status: ArtifactStatus;
  /** Versions are derived from the v*.md files on hydrate (count only here). */
  versionCount: number;
  comments: StoredComment[];
  createdAt: number;
}

export interface CreateInput {
  kind: ArtifactKind;
  title: string;
  body: string;
  /** Override the default 'review' start (always-proceed records approved). */
  status?: ArtifactStatus;
}

const ID_ALPHABET = '0123456789abcdef';

function newArtifactId(): string {
  let id = 'a_';
  for (let i = 0; i < 8; i++) id += ID_ALPHABET[Math.floor(Math.random() * ID_ALPHABET.length)];
  return id;
}

export class ArtifactStore {
  private readonly index = new Map<string, { record: ArtifactRecord; dir: string }>();
  private readonly dirs: {
    projectArtifacts: (projectId: string) => string;
    scratchArtifacts: string;
  };

  constructor(dirs: {
    projectArtifacts: (projectId: string) => string;
    scratchArtifacts: string;
  }) {
    this.dirs = dirs;
  }

  private artifactsDir(projectId: string | null): string {
    return projectId === null ? this.dirs.scratchArtifacts : this.dirs.projectArtifacts(projectId);
  }

  create(projectId: string | null, input: CreateInput) {
    const id = newArtifactId();
    const dir = path.join(this.artifactsDir(projectId), id);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'v1.md'), input.body, 'utf8');
    const record: ArtifactRecord = {
      id,
      kind: input.kind,
      title: input.title,
      status: input.status ?? 'review',
      versionCount: 1,
      comments: [],
      createdAt: Date.now(),
    };
    this.writeRecord(dir, record);
    const entry = { record, dir };
    this.index.set(id, entry);
    return { ...record, dir, versions: [{ version: 1, body: input.body, createdAt: record.createdAt }] };
  }

  private writeRecord(dir: string, record: ArtifactRecord): void {
    const tmp = path.join(dir, 'artifact.json.tmp');
    writeFileSync(tmp, JSON.stringify(record, null, 2), 'utf8');
    renameSync(tmp, path.join(dir, 'artifact.json'));
  }

  private readRecord(dir: string): ArtifactRecord | null {
    const file = path.join(dir, 'artifact.json');
    if (!existsSync(file)) return null;
    try {
      return JSON.parse(readFileSync(file, 'utf8')) as ArtifactRecord;
    } catch {
      return null;
    }
  }

  /** Rebuild the full artifact (record + version bodies) from disk. */
  hydrate(projectId: string | null, artifactId: string): (Omit<ArtifactRecord, 'versionCount'> & { dir: string; versions: { version: number; body: string; createdAt: number }[] }) | null {
    const entry = this.index.get(artifactId);
    const dir = entry?.dir ?? this.findDir(projectId, artifactId);
    if (!dir) return null;
    const record = entry?.record ?? this.readRecord(dir);
    if (!record) return null;

    const versions: { version: number; body: string; createdAt: number }[] = [];
    for (const name of readdirSync(dir)) {
      const match = /^v(\d+)\.md$/.exec(name);
      if (!match) continue;
      const version = Number(match[1]);
      versions.push({
        version,
        body: readFileSync(path.join(dir, name), 'utf8'),
        createdAt: record.createdAt, // v1 stamp; revisions stamp below via mtime
      });
    }
    versions.sort((a, b) => a.version - b.version);
    const { versionCount: _drop, ...rest } = record;
    return { ...rest, dir, versions };
  }

  private findDir(projectId: string | null, artifactId: string): string | null {
    const root = this.artifactsDir(projectId);
    const candidate = path.join(root, artifactId);
    return existsSync(candidate) ? candidate : null;
  }

  /**
   * Match an existing artifact by kind+title in one target's directory — the
   * revision-detection rule (decision #14): a register_artifact call for an
   * artifact that already exists appends a version instead of duplicating.
   * Scans records on disk so matches survive process restarts.
   */
  findByTitleKind(projectId: string | null, kind: ArtifactKind, title: string): ArtifactRecord | null {
    const root = this.artifactsDir(projectId);
    if (!existsSync(root)) return null;
    for (const name of readdirSync(root)) {
      if (!name.startsWith('a_')) continue;
      const record = this.readRecord(path.join(root, name));
      if (record && record.kind === kind && record.title === title) return record;
    }
    return null;
  }

  /** Append the next version; never mutates earlier files. */
  addRevision(artifactId: string, body: string): number {
    let entry = this.index.get(artifactId);
    let dir = entry?.dir ?? null;
    let record = entry?.record ?? (dir ? this.readRecord(dir) : null);
    if (!record) {
      dir = this.findDir(null, artifactId);
      record = dir ? this.readRecord(dir) : null;
    }
    if (!record || !dir) throw new Error(`Unknown artifact: ${artifactId}`);
    const next = record.versionCount + 1;
    writeFileSync(path.join(dir, `v${next}.md`), body, 'utf8');
    record.versionCount = next;
    this.writeRecord(dir, record);
    if (entry) entry.record = record;
    return next;
  }

  approve(artifactId: string): void {
    const entry = this.index.get(artifactId);
    if (!entry) throw new Error(`Unknown artifact: ${artifactId}`);
    entry.record.status = 'approved';
    this.writeRecord(entry.dir, entry.record);
  }

  addComment(artifactId: string, text: string): void {
    const entry = this.index.get(artifactId);
    if (!entry) throw new Error(`Unknown artifact: ${artifactId}`);
    entry.record.comments.push({ id: `c_${Date.now().toString(36)}`, text, ts: Date.now() });
    this.writeRecord(entry.dir, entry.record);
  }

  list(projectId: string | null): (ReturnType<ArtifactStore['hydrate']> & {})[] {
    const root = this.artifactsDir(projectId);
    if (!existsSync(root)) return [];
    const out = [];
    for (const name of readdirSync(root)) {
      if (!name.startsWith('a_')) continue;
      const hydrated = this.hydrate(projectId, name);
      if (hydrated) out.push(hydrated);
    }
    return out;
  }
}
