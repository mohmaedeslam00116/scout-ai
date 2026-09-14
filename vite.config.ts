import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Renderer build. Electron loads dist/renderer/index.html in production;
// `vite dev` serves the same app with HMR during development.
export default defineConfig({
  root: 'src/renderer',
  plugins: [react(), tailwindcss()],
  build: {
    outDir: '../../dist/renderer',
    emptyOutDir: true,
  },
});
