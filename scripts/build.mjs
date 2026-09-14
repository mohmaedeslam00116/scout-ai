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

// Renderer: classic IIFE script.
await build({
  entryPoints: ['src/renderer/app.ts'],
  bundle: true,
  format: 'iife',
  sourcemap: true,
  outfile: 'dist/renderer/app.js',
});

mkdirSync('dist/renderer', { recursive: true });
cpSync('src/renderer/index.html', 'dist/renderer/index.html');
cpSync('src/renderer/styles.css', 'dist/renderer/styles.css');

console.log('build ok');
