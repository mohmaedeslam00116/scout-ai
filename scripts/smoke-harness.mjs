/**
 * Headless harness smoke test — proves the embedded pi harness boots with
 * Scout's own agentDir and streams a real answer. Run: node scripts/smoke-harness.mjs
 * Uses esbuild-registered TS via tsx-free approach: bundles on the fly.
 */
import { build } from 'esbuild';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const tmp = mkdtempSync(join(tmpdir(), 'scout-smoke-'));
// Bundle inside the project so node resolves pi's node_modules at runtime.
const localTmp = mkdtempSync(join(resolve('.'), '.smoke-'));
const agentDir = join(tmp, 'agent');

// Inline the two imports we need from TS sources, bundled to one ESM file.
const entry = join(tmp, 'entry.ts');
writeFileSync(
  entry,
  `
import { bootstrapAgentDir } from ${JSON.stringify(resolve('src/main/bootstrap.ts'))};
import { AgentHost, piSessionFactory } from ${JSON.stringify(resolve('src/main/agentHost.ts'))};
export { bootstrapAgentDir, AgentHost, piSessionFactory };
`,
);

const bundle = join(localTmp, 'smoke.mjs');
await build({
  entryPoints: [entry],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: bundle,
  external: ['electron', '@earendil-works/pi-coding-agent', '@earendil-works/pi-agent-core', '@earendil-works/pi-ai'],
  sourcemap: false,
  logLevel: 'silent',
});

const { bootstrapAgentDir, AgentHost, piSessionFactory } = await import(pathToFileURL(bundle).href);

const boot = bootstrapAgentDir(agentDir);
console.log('[smoke] agentDir:', boot.agentDir);
console.log('[smoke] imported:', boot.imported.length > 0 ? boot.imported.join(', ') : '(none — fresh dir)');
console.log('[smoke] settings created:', boot.settingsCreated);
console.log('[smoke] packages:', JSON.parse(readFileSync(join(agentDir, 'settings.json'), 'utf8')).packages);

const events = [];
// pi picks the default model from settings/auth; per-provider failures (expired
// OAuth, 502s) surface as message_end with stop=error and pi auto-retries.
const host = new AgentHost({ emit: (_c, payload) => events.push(payload) }, piSessionFactory(agentDir));

let deltas = 0;
process.on('exit', () => {
  rmSync(tmp, { recursive: true, force: true });
  rmSync(localTmp, { recursive: true, force: true });
});

console.log('[smoke] sending real prompt (this contacts the configured provider)…');
try {
  // Subscribe by sending and watching events: prompt streams through the sink.
  const timer = setInterval(() => {
    deltas = events.filter((e) => e.type === 'message_delta').length;
    const tools = events.filter((e) => e.type === 'tool_call').map((e) => e.name);
    if (tools.length) process.stdout.write(`  tools: ${[...new Set(tools)].join(', ')}\r`);
  }, 500);
  await host.send('Reply with exactly: SCOUT HARNESS ONLINE');
  clearInterval(timer);
  const kinds = Object.groupBy(events, (e) => e.type);
  console.log('\n[smoke] event counts:', Object.fromEntries(Object.entries(kinds).map(([k, v]) => [k, v.length])));
  const finalText = kinds['message_end']?.at(-1)?.text ?? host.snapshot().messages.at(-1)?.text ?? '';
  console.log('[smoke] final answer:', JSON.stringify(finalText.slice(0, 120)));
  const ok = finalText && !finalText.startsWith('Error:');
  console.log(ok ? '[smoke] PASS' : '[smoke] FAIL: harness returned no real answer');
  process.exit(ok ? 0 : 1);
} catch (err) {
  console.error('[smoke] FAIL:', err.message);
  process.exit(1);
}
