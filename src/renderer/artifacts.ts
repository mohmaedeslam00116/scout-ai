export type ArtifactKind = 'research-brief' | 'source-dossier' | 'evidence-table';

export interface ArtifactVersion {
  version: number;
  body: string;
  createdAt: number;
}

export interface Artifact {
  id: string;
  kind: ArtifactKind;
  title: string;
  versions: ArtifactVersion[];
  /** Draft awaiting review — the agent is paused until approved. */
  status: 'draft' | 'review' | 'approved';
  comments: { id: string; text: string; ts: number }[];
}

export const KIND_LABELS: Record<ArtifactKind, string> = {
  'research-brief': 'Research Brief',
  'source-dossier': 'Source Dossier',
  'evidence-table': 'Evidence Table',
};

export const KIND_ICONS: Record<ArtifactKind, string> = {
  'research-brief': '◆',
  'source-dossier': '◇',
  'evidence-table': '▦',
};
