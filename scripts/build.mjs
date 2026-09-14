import { build } from 'esbuild';
import { cpSync, mkdirSync } from 'node:fs';

// Main process: ESM (package "type": "module", Electron >= 28 supports ESM main).
await build({
  entryPoints: ['src/main/main.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  sourcemap: true,
  external: ['electron'],
  outfile: 'dist/main/main.js',
});

// Preload scripts must be CommonJS in Electron → .cjs extension.
await build({
  entryPoints: ['src/preload/preload.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  sourcemap: true,
  external: ['electron'],
  outfile: 'dist/preload/preload.cjs',
});

console.log('main+preload build ok');
