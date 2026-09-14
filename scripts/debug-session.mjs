/**
 * Debug probe: real pi session with full event visibility. Not shipped.
 * Run: node scripts/debug-session.mjs
 */
import { build } from 'esbuild';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const tmp = mkdtempSync(join(tmpdir(), 'scout-dbg-'));
const localTmp = mkdtempSync(join(resolve('.'), '.smoke-'));
const agentDir = join(tmp, 'agent');
const entry = join(localTmp, 'entry.ts');
writeFileSync(
  entry,
  `
import { bootstrapAgentDir } from ${JSON.stringify(resolve('src/main/bootstrap.ts'))};
import { piSessionFactory } from ${JSON.stringify(resolve('src/main/agentHost.ts'))};
export { bootstrapAgentDir, piSessionFactory };
`,
);
const bundle = join(localTmp, 'dbg.mjs');
await build({
  entryPoints: [entry],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: bundle,
  external: ['electron', '@earendil-works/pi-coding-agent', '@earendil-works/pi-agent-core', '@earendil-works/pi-ai'],
  logLevel: 'silent',
});
const mod = await import('file://' + bundle.replace(/\\/g, '/'));
mod.bootstrapAgentDir(agentDir);
console.log('[dbg] agentDir ready:', agentDir);

const session = await mod.piSessionFactory(agentDir)(process.cwd());
console.log('[dbg] session created. model:', session.model?.provider ?? '?', session.model?.id ?? '');

// Optional model override: node scripts/debug-session.mjs provider/model-id
const override = process.argv[2];
if (override) {
  const [provider, modelId] = override.split('/');
  const model = session.modelRuntime.getModel(provider, modelId);
  if (model) {
    await session.setModel(model);
    console.log('[dbg] override model →', provider, modelId);
  } else {
    const all = session.modelRuntime.getModels().map((m) => `${m.provider}/${m.id}`);
    console.log('[dbg] override not found:', override, '— examples:', all.slice(0, 8).join(', '), '…');
  }
}

const unsub = session.subscribe((e) => {
  const m = e.message ?? {};
  const desc = m.role === 'assistant' ? `assistant stop=${m.stopReason} err=${m.errorMessage ?? '-'}` : '';
  const delta = e.assistantMessageEvent?.type === 'text_delta' ? JSON.stringify(e.assistantMessageEvent.delta).slice(0, 60) : '';
  console.log('EVT', e.type, delta, desc);
});

try {
  await session.prompt('Reply with exactly: SCOUT HARNESS ONLINE');
} catch (err) {
  console.log('PROMPT THREW:', err.message);
}
unsub();
rmSync(tmp, { recursive: true, force: true });
rmSync(localTmp, { recursive: true, force: true });
process.exit(0);
