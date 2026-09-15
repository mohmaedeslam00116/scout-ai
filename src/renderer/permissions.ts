import type { ScoutPermissionAction } from '../types/shared.js';

/**
 * Permission card state (T04). A request row lives until the human resolves
 * it; a resolved row flips to the verdict and stays in the log for the run.
 */
export type PermissionStatus = 'pending' | 'allow' | 'deny';

export interface PermissionRequest {
  id: string;
  /** Pi tool name that triggered the request. */
  tool: string;
  action: ScoutPermissionAction;
  status: PermissionStatus;
  /** Offered scope-widening choices for the card's editor. */
  scopes: { key: 'domain' | 'wildcard' | 'server'; label: string }[];
}

/** Human phrasing for an action resource, e.g. "Fetch example.com". */
export function describePermissionAction(action: ScoutPermissionAction): string {
  switch (action.kind) {
    case 'fetch':
      return action.domain ? `Fetch ${action.domain}` : 'Fetch a page';
    case 'read_url':
      return action.domain ? `Read ${action.domain}` : 'Read a URL';
    case 'subagent':
      return `Run ${action.agent} subagent`;
    case 'command':
      return action.wildcard ? `Run shell (${action.prefix} …)` : `Run ${action.prefix}`;
    case 'mcp':
      return action.tool ? `MCP ${action.server}/${action.tool}` : `MCP server ${action.server}`;
    case 'scout-owned':
      return 'Scout tool';
    default:
      return 'Unknown action';
  }
}

/** The action's kind glyph, matching the artifact icon language. */
export const ACTION_ICONS: Record<ScoutPermissionAction['kind'], string> = {
  fetch: '↧',
  read_url: '⇩',
  subagent: '◈',
  command: '❯',
  mcp: '⛁',
  'scout-owned': '◆',
  other: '•',
};

/** Scope-widening choices the card offers for this action. */
export function scopesFor(action: ScoutPermissionAction): { key: 'domain' | 'wildcard' | 'server'; label: string }[] {
  switch (action.kind) {
    case 'fetch':
    case 'read_url': {
      if (!action.domain) return [];
      const parent = registrable(action.domain);
      return parent !== action.domain
        ? [
            { key: 'domain', label: `Always allow ${parent}` },
          ]
        : [];
    }
    case 'command':
      return [{ key: 'wildcard', label: 'Always allow shell commands' }];
    case 'mcp':
      return [{ key: 'server', label: `Always allow ${action.server}` }];
    default:
      return [];
  }
}

function registrable(host: string): string {
  const parts = host.split('.').filter(Boolean);
  if (parts.length <= 2) return host;
  const twoLevelTlds = new Set(['co.uk', 'com.au', 'co.jp', 'org.uk', 'com.br']);
  const last2 = parts.slice(-2).join('.');
  return twoLevelTlds.has(last2) ? parts.slice(-3).join('.') : last2;
}
