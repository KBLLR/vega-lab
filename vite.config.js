// vite.config.js
import { defineConfig } from 'vite';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

// Recreate __dirname in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const rootDir = resolve(__dirname, 'src');
const openResponsesTarget = process.env.VITE_EVENT_BUS_PROXY_TARGET
  || process.env.VITE_LOCAL_OPENRESPONSES_URL
  || 'http://127.0.0.1:8090';
const eventBusTarget = process.env.VITE_EVENT_BUS_SSE_PROXY_TARGET
  || process.env.VITE_LOCAL_EVENT_BUS_URL
  || 'http://127.0.0.1:8085';

export default defineConfig({
  root: rootDir,
  // Use './' for local dev, Vercel, Netlify, etc.
  // If deploying to GitHub Pages under /vega-lab/, change to base: '/vega-lab/'
  base: './',
  publicDir: resolve(__dirname, 'public'),
  build: {
    outDir: resolve(__dirname, 'dist'),
    assetsDir: 'assets',
    sourcemap: true,
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'src/index.html'),
      },
    },
  },
  server: {
    hmr: { overlay: true },
    open: true,
    proxy: {
      '/bus/events': {
        target: eventBusTarget,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/bus/, ''),
      },
      '/bus': {
        target: openResponsesTarget,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/bus/, ''),
      },
    },
  },
  resolve: {
    alias: {
      '@': rootDir,
      '@agent-events': resolve(__dirname, 'src/lib/agent-events.ts'),
    },
  },
});
