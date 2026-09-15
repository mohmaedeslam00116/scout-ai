/**
 * PermissionEngine — pure evaluation of action(target) resources (T04,
 * decision #13 checklist C1–C3).
 *
 * Resources are `action(target)`: read_url(domain), fetch(domain),
 * subagent(agent), command(prefix), mcp(server/tool). Evaluation is
 * Deny > Ask > Allow: explicit denyDomains always win, then explicit
 * allowDomains, then the preset default. Subdomain wildcards: a grant on
 * `example.com` covers `docs.example.com` and `example.com` itself.
 *
 * Scope widening (the permission card's editor, C3): one domain grant widens
 * to its registrable domain (covers subdomains), a command widens to its
 * prefix, an MCP call widens to its server. Widening only ever adds allows —
 * denies stay denied.
 *
 * Pure data-in/data-out: no Node, no Electron, no pi.
 */

export type PermissionVerdict = 'allow' | 'ask' | 'deny';

export type PermissionAction =
  | { kind: 'fetch'; domain: string | null }
  | { kind: 'read_url'; domain: string | null }
  | { kind: 'subagent'; agent: string }
  | { kind: 'command'; prefix: string; wildcard: boolean }
  | { kind: 'mcp'; server: string; tool?: string }
  | { kind: 'scout-owned' }
  | { kind: 'other' };

/** Project rules derived from project.json's security block + mcp allowlist. */
export interface ProjectRules {
  preset: 'default' | 'full-machine' | 'unrestricted';
  allowDomains: string[];
  denyDomains: string[];
  commandPolicy: 'ask' | 'allow';
  mcpAllow: string[];
}

/** Fresh rules for a scratch conversation / new project (default preset). */
export const DEFAULT_GRANT: ProjectRules = {
  preset: 'default',
  allowDomains: [],
  denyDomains: [],
  commandPolicy: 'ask',
  mcpAllow: [],
};

const FETCH_TOOLS = new Set(['fetch_content', 'web_fetch', 'read_url', 'open_url', 'browser_open']);
const COMMAND_TOOLS = new Set(['bash', 'run_command', 'execute', 'shell']);

/** Map a pi tool name + validated args to an action(target) resource. */
export function classifyAction(toolName: string, args: unknown): PermissionAction {
  const a = (args ?? {}) as Record<string, unknown>;

  // Scout's own artifact tool has its own review gate (T03); never double-ask.
  if (toolName === 'register_artifact') return { kind: 'scout-owned' };
  if (toolName === 'read_url' || toolName === 'open_url' || toolName === 'browser_open') {
    return { kind: 'read_url', domain: domainOf(a.url) };
  }
  if (FETCH_TOOLS.has(toolName)) {
    return { kind: 'fetch', domain: domainOf(a.url) };
  }
  if (COMMAND_TOOLS.has(toolName)) {
    const raw = typeof a.command === 'string' ? a.command : '';
    const prefix = raw.trim().split(/\s+/)[0] ?? '';
    return { kind: 'command', prefix, wildcard: prefix ? /(&&|\|\||;|\|)/.test(raw) : true };
  }
  if (toolName === 'subagent' || toolName.startsWith('subagent')) {
    return { kind: 'subagent', agent: typeof a.agent === 'string' ? a.agent : toolName };
  }
  // MCP tools conventionally arrive as server.tool or with {server, tool} args.
  if (typeof a.server === 'string') {
    return { kind: 'mcp', server: a.server, tool: typeof a.tool === 'string' ? a.tool : undefined };
  }
  if (toolName.startsWith('mcp__')) {
    const [, server, tool] = toolName.split('__');
    return { kind: 'mcp', server: server ?? toolName, tool };
  }
  return { kind: 'other' };
}

/** Deny > Ask > Allow. */
export function evaluatePermission(action: PermissionAction, rules: ProjectRules): PermissionVerdict {
  if (rules.preset === 'unrestricted') return 'allow';

  switch (action.kind) {
    case 'fetch':
    case 'read_url': {
      // Deny (explicit, with wildcard) beats everything…
      if (action.domain && matchesAny(action.domain, rules.denyDomains)) return 'deny';
      // …then explicit allow…
      if (action.domain && matchesAny(action.domain, rules.allowDomains)) return 'allow';
      // …then the preset default (default: ask; full-machine: auto-allow).
      if (rules.preset === 'full-machine') return 'allow';
      return 'ask';
    }
    case 'command': {
      if (rules.commandPolicy === 'allow') return 'allow';
      if (rules.preset === 'full-machine') return 'ask'; // full machine still asks on commands
      return 'ask';
    }
    case 'mcp': {
      if (rules.mcpAllow.includes(action.server)) return 'allow';
      return rules.preset === 'full-machine' ? 'allow' : 'ask';
    }
    case 'subagent':
      // Scout's own child agents are not a network/machine escalation.
      return 'allow';
    case 'scout-owned':
      // register_artifact pauses through the Proceed gate (T03), not here.
      return 'allow';
    case 'other':
      // Unknown Scout-side tools are harmless; anything genuinely new is
      // classified before it reaches here.
      return rules.preset === 'default' ? 'ask' : 'allow';
  }
}

/**
 * Widen the grant so this exact action is allowed broadly (C3's editable
 * scope). Returns NEW rules; never touches denies.
 */
export function widenScope(
  rules: ProjectRules,
  action: PermissionAction,
  scope: 'domain' | 'wildcard' | 'server',
): ProjectRules {
  switch (action.kind) {
    case 'fetch':
    case 'read_url': {
      if (!action.domain) return rules;
      const domain = scope === 'domain' ? registrableDomain(action.domain) : action.domain;
      if (!domain || rules.allowDomains.includes(domain)) return rules;
      return { ...rules, allowDomains: [...rules.allowDomains, domain] };
    }
    case 'command':
      return { ...rules, commandPolicy: 'allow' };
    case 'mcp':
      return rules.mcpAllow.includes(action.server)
        ? rules
        : { ...rules, mcpAllow: [...rules.mcpAllow, action.server] };
    default:
      return rules;
  }
}

/** `docs.example.com` matches a grant on `example.com` or itself. */
function matchesAny(host: string, grants: string[]): boolean {
  for (const grant of grants) {
    if (host === grant) return true;
    if (host.endsWith(`.${grant}`)) return true;
  }
  return false;
}

/** Longest public-suffix-free parent: `docs.pi.dev` → `pi.dev` (coarse heuristic). */
function registrableDomain(host: string): string {
  const parts = host.split('.').filter(Boolean);
  if (parts.length <= 2) return host;
  const twoLevelTlds = new Set(['co.uk', 'com.au', 'co.jp', 'org.uk', 'com.br']);
  const last2 = parts.slice(-2).join('.');
  return twoLevelTlds.has(last2) ? parts.slice(-3).join('.') : last2;
}

/** Hostname of a URL string, or null when absent/unparseable. */
function domainOf(url: unknown): string | null {
  if (typeof url !== 'string' || !url.trim()) return null;
  try {
    const parsed = new URL(url);
    return parsed.hostname || null;
  } catch {
    return null;
  }
}
