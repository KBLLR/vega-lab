// vite.config.js
import { defineConfig } from 'vite';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { executeVegaAction, listVegaActionRuns } from './src/server/action-bridge.js';

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

async function readRequestJson(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  return raw ? JSON.parse(raw) : {};
}

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(`${JSON.stringify(payload, null, 2)}\n`);
}

function vegaActionBridgePlugin() {
  function installActionMiddlewares(middlewares) {
    middlewares.use('/api/vega/actions/run', async (req, res) => {
      if (req.method !== 'POST') {
        sendJson(res, 405, { error: { code: 'method_not_allowed', message: 'Use POST.' } });
        return;
      }
      try {
        const body = await readRequestJson(req);
        const result = await executeVegaAction(__dirname, body);
        sendJson(res, result.status === 'failed' ? 400 : 200, result);
      } catch (error) {
        sendJson(res, 500, {
          error: {
            code: 'vega_action_bridge_failed',
            message: error instanceof Error ? error.message : String(error),
          },
        });
      }
    });

    middlewares.use('/api/vega/actions/runs', async (req, res) => {
      if (req.method !== 'GET') {
        sendJson(res, 405, { error: { code: 'method_not_allowed', message: 'Use GET.' } });
        return;
      }
      try {
        const runs = await listVegaActionRuns(__dirname, { limit: 50 });
        sendJson(res, 200, { runs });
      } catch (error) {
        sendJson(res, 500, {
          error: {
            code: 'vega_action_runs_failed',
            message: error instanceof Error ? error.message : String(error),
          },
        });
      }
    });
  }

  return {
    name: 'vega-action-bridge',
    configureServer(server) {
      installActionMiddlewares(server.middlewares);
    },
    configurePreviewServer(server) {
      installActionMiddlewares(server.middlewares);
    },
  };
}

export default defineConfig({
  root: rootDir,
  plugins: [vegaActionBridgePlugin()],
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
