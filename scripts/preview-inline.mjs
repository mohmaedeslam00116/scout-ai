/**
 * Build dist/renderer/preview-inline.html — a single self-contained HTML file
 * with the Vite JS/CSS inlined, used for the thread Preview tab (which serves
 * one file only). Not shipped; regenerate with `npm run preview:inline`.
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const dir = 'dist/renderer';
let css = '';
let js = '';
for (const name of readdirSync(join(dir, 'assets'))) {
  if (name.endsWith('.css')) css += readFileSync(join(dir, 'assets', name), 'utf8');
  if (name.endsWith('.js')) js += readFileSync(join(dir, 'assets', name), 'utf8');
}

// Prevent premature script-tag termination when inlining the bundle.
js = js.replaceAll('</script', '<\\/script');

const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Scout AI</title>
    <style>${css}</style>
  </head>
  <body>
    <div id="root"></div>
    <script type="module">${js}</script>
  </body>
</html>
`;

writeFileSync(join(dir, 'preview-inline.html'), html);
console.log('preview-inline.html written:', html.length, 'bytes');
