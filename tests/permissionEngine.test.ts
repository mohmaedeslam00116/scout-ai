import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  classifyAction,
  evaluatePermission,
  widenScope,
  DEFAULT_GRANT,
  type PermissionAction,
  type ProjectRules,
} from '../src/main/permissionEngine.ts';

function rules(over: Partial<ProjectRules> = {}): ProjectRules {
  return {
    preset: 'default',
    allowDomains: [],
    denyDomains: [],
    commandPolicy: 'ask',
    mcpAllow: [],
    ...over,
  };
}

describe('classifyAction', () => {
  it('classifies fetch/read_url by domain', () => {
    assert.deepEqual(classifyAction('fetch_content', { url: 'https://docs.pi.dev/guide' }), {
      kind: 'fetch',
      domain: 'docs.pi.dev',
    });
    assert.deepEqual(classifyAction('web_fetch', { url: 'http://news.example.com/a/b' }), {
      kind: 'fetch',
      domain: 'news.example.com',
    });
    assert.deepEqual(classifyAction('read_url', { url: 'https://deep.sub.example.org' }), {
      kind: 'read_url',
      domain: 'deep.sub.example.org',
    });
  });

  it('classifies commands by first prefix word and flags wildcards', () => {
    assert.deepEqual(classifyAction('bash', { command: 'git status && npm test' }), {
      kind: 'command',
      prefix: 'git',
      wildcard: true,
    });
    assert.deepEqual(classifyAction('bash', { command: 'ls -la' }), {
      kind: 'command',
      prefix: 'ls',
      wildcard: false,
    });
  });

  it('classifies subagents, MCP server/tool calls, and unknown names', () => {
    assert.deepEqual(classifyAction('subagent_researcher', {}), { kind: 'subagent', agent: 'subagent_researcher' });
    assert.deepEqual(classifyAction('mcp', { server: 'github', tool: 'create_issue' }), {
      kind: 'mcp',
      server: 'github',
      tool: 'create_issue',
    });
    assert.deepEqual(classifyAction('totally_unknown_tool', {}), { kind: 'other' });
  });

  it('treats a missing or unparseable URL as a fetch needing review', () => {
    assert.deepEqual(classifyAction('fetch_content', {}), { kind: 'fetch', domain: null });
    assert.deepEqual(classifyAction('fetch_content', { url: '::::' }), { kind: 'fetch', domain: null });
  });
});

describe('evaluatePermission — Deny > Ask > Allow', () => {
  const fetchAction: PermissionAction = { kind: 'fetch', domain: 'example.com' };

  it('default preset: never-seen domain asks', () => {
    assert.equal(evaluatePermission(fetchAction, rules()), 'ask');
  });

  it('deny beats allow beats ask', () => {
    assert.equal(evaluatePermission(fetchAction, rules({ denyDomains: ['example.com'], allowDomains: ['example.com'] })), 'deny');
    assert.equal(evaluatePermission(fetchAction, rules({ allowDomains: ['example.com'] })), 'allow');
    assert.equal(evaluatePermission(fetchAction, rules({ denyDomains: ['example.com'] })), 'deny');
  });

  it('subdomain wildcards match the domain and its children; other domains do not', () => {
    const r = rules({ allowDomains: ['example.com'], denyDomains: ['tracker.example.com'] });
    assert.equal(evaluatePermission({ kind: 'fetch', domain: 'docs.example.com' }, r), 'allow');
    assert.equal(evaluatePermission({ kind: 'fetch', domain: 'tracker.example.com' }, r), 'deny');
    assert.equal(evaluatePermission({ kind: 'fetch', domain: 'example.org' }, r), 'ask');
  });

  it('full-machine: web and MCP auto-allow, commands still ask', () => {
    const r = rules({ preset: 'full-machine' });
    assert.equal(evaluatePermission(fetchAction, r), 'allow');
    assert.equal(evaluatePermission({ kind: 'read_url', domain: 'anywhere.net' }, r), 'allow');
    assert.equal(evaluatePermission({ kind: 'mcp', server: 'github' }, r), 'allow');
    assert.equal(evaluatePermission({ kind: 'command', prefix: 'rm', wildcard: true }, r), 'ask');
    assert.equal(evaluatePermission({ kind: 'subagent', agent: 'x' }, r), 'allow');
  });

  it('unrestricted: everything allowed without prompting', () => {
    const r = rules({ preset: 'unrestricted' });
    assert.equal(evaluatePermission({ kind: 'command', prefix: 'rm', wildcard: false }, r), 'allow');
    assert.equal(evaluatePermission(fetchAction, r), 'allow');
    assert.equal(evaluatePermission({ kind: 'other' }, r), 'allow');
  });

  it('commandPolicy drives commands; mcpAllow allowlists servers; subagents auto-allow', () => {
    assert.equal(evaluatePermission({ kind: 'command', prefix: 'git', wildcard: false }, rules({ commandPolicy: 'allow' })), 'allow');
    assert.equal(
      evaluatePermission({ kind: 'mcp', server: 'github', tool: 'x' }, rules({ mcpAllow: ['github'] })),
      'allow',
    );
    assert.equal(evaluatePermission({ kind: 'mcp', server: 'linear' }, rules({ mcpAllow: ['github'] })), 'ask');
    assert.equal(evaluatePermission({ kind: 'subagent', agent: 'researcher' }, rules()), 'allow');
  });

  it('explicit overrides stack on top of a preset', () => {
    const r = rules({ preset: 'full-machine', denyDomains: ['scary.example.com'] });
    assert.equal(evaluatePermission({ kind: 'fetch', domain: 'scary.example.com' }, r), 'deny');
    assert.equal(evaluatePermission({ kind: 'fetch', domain: 'fine.example.com' }, r), 'allow');
  });
});

describe('scope widening (#24, checklist C3)', () => {
  const fetchAction: PermissionAction = { kind: 'fetch', domain: 'example.com' };

  it('widens one domain to a wildcard and persists it in rules', () => {
    const r = rules();
    const widened = widenScope(r, fetchAction, 'domain');
    assert.equal(evaluatePermission({ kind: 'fetch', domain: 'anything.example.com' }, widened), 'allow');
    assert.equal(evaluatePermission({ kind: 'fetch', domain: 'other.org' }, widened), 'ask');
  });

  it('widening writes the registrable domain, not just the host subdomain', () => {
    const widened = widenScope(rules(), { kind: 'fetch', domain: 'docs.pi.dev' }, 'domain');
    assert.deepEqual(widened.allowDomains, ['pi.dev']);
    assert.ok(evaluatePermission({ kind: 'fetch', domain: 'api.pi.dev' }, widened), 'allow');
  });

  it('widening a command promotes its prefix to always-allow', () => {
    const widened = widenScope(rules(), { kind: 'command', prefix: 'git', wildcard: true }, 'wildcard');
    assert.deepEqual(widened.commandPolicy, 'allow');
  });

  it('widening an MCP call adds the server to the allowlist', () => {
    const widened = widenScope(rules(), { kind: 'mcp', server: 'github', tool: 'x' }, 'server');
    assert.deepEqual(widened.mcpAllow, ['github']);
  });

  it('widening never touches the deny list — denies stay denied', () => {
    const widened = widenScope(rules({ denyDomains: ['example.com'] }), fetchAction, 'domain');
    assert.equal(evaluatePermission(fetchAction, widened), 'deny');
  });
});

describe('Scout-owned tools', () => {
  it('register_artifact always allows — it has its own review gate (T03)', () => {
    assert.equal(evaluatePermission(classifyAction('register_artifact', {}), rules({})), 'allow');
    assert.equal(evaluatePermission(classifyAction('register_artifact', {}), rules({ preset: 'full-machine' })), 'allow');
  });
});
