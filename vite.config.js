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
const actionBridgeHost = process.env.VEGA_ACTION_BRIDGE_HOST || 'localhost';
const maxActionBodyBytes = Number.parseInt(process.env.VEGA_ACTION_MAX_BODY_BYTES || '65536', 10);
const allowedActionOrigins = new Set(
  String(process.env.VEGA_ACTION_ALLOWED_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
);

function bridgeError(code, message, statusCode = 400) {
  return Object.assign(new Error(message), {
    code,
    statusCode,
  });
}

function isLocalHostname(hostname) {
  return ['localhost', '127.0.0.1', '::1', '[::1]'].includes(String(hostname || '').toLowerCase());
}

function hostnameFromHostHeader(hostHeader = '') {
  const host = String(hostHeader || '').trim();
  if (!host) return '';
  if (host.startsWith('[')) return host.slice(1, host.indexOf(']'));
  return host.split(':')[0];
}

function assertActionRequestAllowed(req, { requireJson = false } = {}) {
  const host = hostnameFromHostHeader(req.headers.host);
  if (!isLocalHostname(host)) {
    throw bridgeError('forbidden_host', 'Vega actions are available only from a local development host.', 403);
  }

  const origin = req.headers.origin;
  if (origin) {
    const allowedByEnv = allowedActionOrigins.has(origin);
    let originHost = '';
    try {
      originHost = new URL(origin).hostname;
    } catch {
      throw bridgeError('forbidden_origin', 'Invalid Origin header.', 403);
    }
    if (!allowedByEnv && !isLocalHostname(originHost)) {
      throw bridgeError('forbidden_origin', 'Cross-origin Vega action requests are blocked.', 403);
    }
  }

  if (requireJson) {
    const contentType = String(req.headers['content-type'] || '').toLowerCase();
    if (!contentType.includes('application/json')) {
      throw bridgeError('unsupported_media_type', 'Use application/json for Vega action requests.', 415);
    }
    if (String(req.headers['x-vega-action-origin'] || '') !== 'vega-lab-ui') {
      throw bridgeError('missing_action_origin', 'Missing Vega UI action origin header.', 403);
    }
  }
}

async function readRequestJson(req) {
  const chunks = [];
  let received = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    received += buffer.length;
    if (received > maxActionBodyBytes) {
      throw bridgeError('payload_too_large', 'Vega action request body is too large.', 413);
    }
    chunks.push(buffer);
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw bridgeError('invalid_json', 'Request body must be valid JSON.', 400);
  }
}

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(`${JSON.stringify(payload, null, 2)}\n`);
}

function vegaActionBridgePlugin() {
  // This bridge is Vite dev/preview middleware only. Static deployments have no local action executor.
  function sendBridgeError(res, error, fallbackCode) {
    const statusCode = error?.statusCode || fallbackCode;
    sendJson(res, statusCode, {
      error: {
        code: error?.code || 'vega_action_bridge_failed',
        message: error instanceof Error ? error.message : String(error),
      },
    });
  }

  function installActionMiddlewares(middlewares) {
    middlewares.use('/api/vega/actions/run', async (req, res) => {
      if (req.method === 'OPTIONS') {
        sendJson(res, 403, { error: { code: 'forbidden_preflight', message: 'Cross-origin Vega action preflight is blocked.' } });
        return;
      }
      if (req.method !== 'POST') {
        sendJson(res, 405, { error: { code: 'method_not_allowed', message: 'Use POST.' } });
        return;
      }
      try {
        assertActionRequestAllowed(req, { requireJson: true });
        const body = await readRequestJson(req);
        const result = await executeVegaAction(__dirname, body);
        sendJson(res, 200, result);
      } catch (error) {
        sendBridgeError(res, error, 500);
      }
    });

    middlewares.use('/api/vega/actions/runs', async (req, res) => {
      if (req.method !== 'GET') {
        sendJson(res, 405, { error: { code: 'method_not_allowed', message: 'Use GET.' } });
        return;
      }
      try {
        assertActionRequestAllowed(req);
        const runs = await listVegaActionRuns(__dirname, { limit: 50 });
        sendJson(res, 200, { runs });
      } catch (error) {
        sendBridgeError(res, error, 500);
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
    host: actionBridgeHost,
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
  preview: {
    host: actionBridgeHost,
  },
  resolve: {
    alias: {
      '@': rootDir,
      '@agent-events': resolve(__dirname, 'src/lib/agent-events.ts'),
    },
  },
});
