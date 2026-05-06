#!/usr/bin/env node
import { createReadStream, existsSync } from 'node:fs';
import http from 'node:http';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AdminAuth } from './adminAuth.mjs';
import { CampaignOverrideStore } from './campaignOverrideStore.mjs';
import { loadDotEnv } from './env.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
loadDotEnv(root);
const defaultDataFile = resolve(root, 'data', 'campaign-level-overrides.json');
const defaultDistDir = resolve(root, 'dist');

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

function sendJson(res, status, payload, headers = {}) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    ...headers
  });
  res.end(JSON.stringify(payload));
}

async function readJsonBody(req) {
  let raw = '';

  for await (const chunk of req) {
    raw += chunk;

    if (raw.length > 1_000_000) {
      throw new Error('Request body too large.');
    }
  }

  return raw ? JSON.parse(raw) : {};
}

function serveStatic(req, res, distDir) {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const pathname = decodeURIComponent(url.pathname);
  const safePath = pathname === '/' ? '/index.html' : pathname;
  const filePath = resolve(join(distDir, safePath));
  const fallback = resolve(join(distDir, 'index.html'));
  const target = filePath.startsWith(distDir) && existsSync(filePath) ? filePath : fallback;

  if (!existsSync(target)) {
    sendJson(res, 404, { message: 'Build output not found. Run npm run build first.' });
    return;
  }

  res.writeHead(200, {
    'Content-Type': CONTENT_TYPES[extname(target)] ?? 'application/octet-stream'
  });
  createReadStream(target).pipe(res);
}

export function createAdminServer({
  adminPassword = process.env.ADMIN_PASSWORD,
  dataFile = process.env.CAMPAIGN_OVERRIDES_FILE ?? defaultDataFile,
  distDir = defaultDistDir,
  apiOnly = process.env.ADMIN_API_ONLY === '1'
} = {}) {
  const auth = new AdminAuth(adminPassword);
  const store = new CampaignOverrideStore(dataFile);

  return http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');

    try {
      if (url.pathname === '/api/admin/session' && req.method === 'GET') {
        sendJson(res, 200, { authenticated: auth.isRequestAuthenticated(req) });
        return;
      }

      if (url.pathname === '/api/admin/login' && req.method === 'POST') {
        if (!auth.isConfigured()) {
          sendJson(res, 503, {
            authenticated: false,
            message: 'ADMIN_PASSWORD is not configured on the server.'
          });
          return;
        }

        const body = await readJsonBody(req);
        const token = auth.login(body.password);

        if (!token) {
          sendJson(res, 401, { authenticated: false, message: 'Invalid admin password.' });
          return;
        }

        sendJson(res, 200, { authenticated: true }, { 'Set-Cookie': auth.createCookie(token) });
        return;
      }

      if (url.pathname === '/api/admin/logout' && req.method === 'POST') {
        auth.logout(req);
        sendJson(res, 200, { authenticated: false }, { 'Set-Cookie': auth.clearCookie() });
        return;
      }

      if (url.pathname === '/api/admin/campaign-levels' && req.method === 'GET') {
        sendJson(res, 200, { overrides: await store.list() });
        return;
      }

      const levelMatch = url.pathname.match(/^\/api\/admin\/campaign-levels\/(\d+)$/);
      if (levelMatch && req.method === 'PUT') {
        if (!auth.isRequestAuthenticated(req)) {
          sendJson(res, 401, { message: 'Admin session required.' });
          return;
        }

        const body = await readJsonBody(req);
        const override = await store.save(Number(levelMatch[1]), body.rows, body.name);
        sendJson(res, 200, override);
        return;
      }

      if (url.pathname.startsWith('/api/')) {
        sendJson(res, 404, { message: 'API route not found.' });
        return;
      }

      if (apiOnly) {
        sendJson(res, 404, { message: 'Static serving disabled.' });
        return;
      }

      serveStatic(req, res, distDir);
    } catch (error) {
      sendJson(res, 500, { message: error instanceof Error ? error.message : 'Server error.' });
    }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.API_PORT ?? process.env.PORT ?? 8787);
  const server = createAdminServer();
  server.listen(port, '0.0.0.0', () => {
    console.log(`Bounce Forge server listening on http://localhost:${port}`);
  });
}
