import { createReadStream, existsSync } from 'node:fs';
import http from 'node:http';
import { extname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AdminAuth } from './adminAuth.mjs';
import { CampaignOverrideStore, ValidationError } from './campaignOverrideStore.mjs';
import { loadDotEnv } from './env.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
loadDotEnv(root);
const defaultDataFile = resolve(root, 'data', 'campaign-level-overrides.json');
const defaultDistDir = resolve(root, 'dist');
const LOGIN_WINDOW_MS = 5 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 8;
const BODY_READ_TIMEOUT_MS = 10_000;
const MAX_PASSWORD_LENGTH = 256;
const MAX_LEVEL_NAME_LENGTH = 120;
const STATIC_ASSET_MAX_AGE = 3600;

const SECURITY_HEADERS = {
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
  'Referrer-Policy': 'no-referrer',
  'Strict-Transport-Security': 'max-age=15552000; includeSubDomains',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY'
};

class BadRequestError extends Error {
  constructor(message) {
    super(message);
    this.name = 'BadRequestError';
  }
}

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
    ...SECURITY_HEADERS,
    'Content-Type': 'application/json; charset=utf-8',
    ...headers
  });
  res.end(JSON.stringify(payload));
}

async function readJsonBody(req) {
  req.setTimeout(BODY_READ_TIMEOUT_MS, () => {
    req.destroy();
  });

  let raw = '';

  for await (const chunk of req) {
    raw += chunk;

    if (raw.length > 1_000_000) {
      throw new BadRequestError('Request body too large.');
    }
  }

  if (!raw) {
    return {};
  }

  try {
    return JSON.parse(raw);
  } catch {
    throw new BadRequestError('Malformed JSON body.');
  }
}

function assertObjectBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new BadRequestError('Invalid request body.');
  }

  return body;
}

function getClientKey(req) {
  const forwardedFor = req.headers['x-forwarded-for'];
  const forwardedAddress = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor;
  return String(forwardedAddress ?? req.socket.remoteAddress ?? 'unknown')
    .split(',')[0]
    .trim();
}

function isLoginLimited(attempts, key) {
  const entry = attempts.get(key);

  if (!entry || entry.resetAt <= Date.now()) {
    attempts.delete(key);
    return false;
  }

  return entry.count >= LOGIN_MAX_ATTEMPTS;
}

function registerLoginFailure(attempts, key) {
  const now = Date.now();
  const current = attempts.get(key);
  const entry =
    current && current.resetAt > now
      ? current
      : {
          count: 0,
          resetAt: now + LOGIN_WINDOW_MS
        };

  entry.count += 1;
  attempts.set(key, entry);
}

function isSecureRequest(req) {
  const forwardedProto = req.headers['x-forwarded-proto'];
  const proto = Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto;
  return (
    Boolean(req.socket.encrypted) || proto === 'https' || process.env.ADMIN_COOKIE_SECURE === '1'
  );
}

function isLoopbackHostname(hostname) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

function isTrustedOrigin(req) {
  const origin = req.headers.origin;

  if (!origin) {
    return true;
  }

  try {
    const configuredOrigins = String(process.env.ADMIN_ALLOWED_ORIGINS ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
    const originValue = Array.isArray(origin) ? origin[0] : origin;

    if (configuredOrigins.includes(originValue)) {
      return true;
    }

    const requestHost = req.headers['x-forwarded-host'] ?? req.headers.host;
    const originUrl = new URL(originValue);
    const expectedHost = Array.isArray(requestHost) ? requestHost[0] : requestHost;

    if (originUrl.host === expectedHost) {
      return true;
    }

    const expectedUrl = new URL(`http://${expectedHost}`);
    return isLoopbackHostname(originUrl.hostname) && isLoopbackHostname(expectedUrl.hostname);
  } catch {
    return false;
  }
}

function rejectUntrustedOrigin(req, res) {
  if (isTrustedOrigin(req)) {
    return false;
  }

  sendJson(res, 403, { message: 'Untrusted request origin.' });
  return true;
}

function isPathInside(parentDir, childPath) {
  const relativePath = relative(parentDir, childPath);
  return Boolean(relativePath) && !relativePath.startsWith('..') && !isAbsolute(relativePath);
}

function serveStatic(req, res, distDir) {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const pathname = decodeURIComponent(url.pathname);
  const resolvedDistDir = resolve(distDir);
  const safePath = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const filePath = resolve(resolvedDistDir, safePath);
  const fallback = resolve(resolvedDistDir, 'index.html');
  const target =
    isPathInside(resolvedDistDir, filePath) && existsSync(filePath) ? filePath : fallback;

  if (!existsSync(target)) {
    sendJson(res, 404, { message: 'Build output not found. Run npm run build first.' });
    return;
  }

  const ext = extname(target);
  const cacheControl = ext === '.html' ? 'no-cache' : `public, max-age=${STATIC_ASSET_MAX_AGE}`;

  res.writeHead(200, {
    ...SECURITY_HEADERS,
    'Content-Type': CONTENT_TYPES[ext] ?? 'application/octet-stream',
    'Cache-Control': cacheControl
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
  const loginAttempts = new Map();

  return http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');

    try {
      if (url.pathname === '/api/admin/session' && req.method === 'GET') {
        sendJson(res, 200, { authenticated: auth.isRequestAuthenticated(req) });
        return;
      }

      if (url.pathname === '/api/admin/login' && req.method === 'POST') {
        if (rejectUntrustedOrigin(req, res)) {
          return;
        }

        const clientKey = getClientKey(req);

        if (isLoginLimited(loginAttempts, clientKey)) {
          sendJson(res, 429, {
            authenticated: false,
            message: 'Too many failed login attempts. Try again later.'
          });
          return;
        }

        if (!auth.isConfigured()) {
          sendJson(res, 503, {
            authenticated: false,
            message: 'ADMIN_PASSWORD is not configured on the server.'
          });
          return;
        }

        const body = assertObjectBody(await readJsonBody(req));

        if (typeof body.password !== 'string' || body.password.length > MAX_PASSWORD_LENGTH) {
          registerLoginFailure(loginAttempts, clientKey);
          sendJson(res, 400, { authenticated: false, message: 'Invalid request.' });
          return;
        }

        const token = auth.login(body.password);

        if (!token) {
          registerLoginFailure(loginAttempts, clientKey);
          sendJson(res, 401, { authenticated: false, message: 'Invalid admin password.' });
          return;
        }

        loginAttempts.delete(clientKey);
        sendJson(
          res,
          200,
          { authenticated: true },
          { 'Set-Cookie': auth.createCookie(token, { secure: isSecureRequest(req) }) }
        );
        return;
      }

      if (url.pathname === '/api/admin/logout' && req.method === 'POST') {
        if (rejectUntrustedOrigin(req, res)) {
          return;
        }

        auth.logout(req);
        sendJson(
          res,
          200,
          { authenticated: false },
          { 'Set-Cookie': auth.clearCookie({ secure: isSecureRequest(req) }) }
        );
        return;
      }

      if (url.pathname === '/api/admin/campaign-levels' && req.method === 'GET') {
        sendJson(res, 200, { overrides: await store.list() });
        return;
      }

      const levelMatch = url.pathname.match(/^\/api\/admin\/campaign-levels\/(\d+)$/);
      if (levelMatch && req.method === 'PUT') {
        if (rejectUntrustedOrigin(req, res)) {
          return;
        }

        if (!auth.isRequestAuthenticated(req)) {
          sendJson(res, 401, { message: 'Admin session required.' });
          return;
        }

        const body = assertObjectBody(await readJsonBody(req));

        if (body.name !== undefined && body.name !== null) {
          if (typeof body.name !== 'string' || body.name.length > MAX_LEVEL_NAME_LENGTH) {
            sendJson(res, 400, { message: 'Invalid level name.' });
            return;
          }
        }

        const override = await store.save(Number(levelMatch[1]), body.rows, body.name);
        sendJson(res, 200, override);
        return;
      }

      if (levelMatch && req.method === 'DELETE') {
        if (rejectUntrustedOrigin(req, res)) {
          return;
        }

        if (!auth.isRequestAuthenticated(req)) {
          sendJson(res, 401, { message: 'Admin session required.' });
          return;
        }

        const result = await store.remove(Number(levelMatch[1]));
        sendJson(res, 200, result);
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
      if (error instanceof BadRequestError || error instanceof ValidationError) {
        sendJson(res, 400, { message: error.message });
        return;
      }

      console.error('Admin server error:', error);
      sendJson(res, 500, { message: 'Internal server error.' });
    }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.on('unhandledRejection', (reason) => {
    console.error('Unhandled promise rejection:', reason);
  });
  process.on('uncaughtException', (error) => {
    console.error('Uncaught exception:', error);
  });

  const port = Number(process.env.API_PORT ?? process.env.PORT ?? 8787);
  const server = createAdminServer();
  server.listen(port, '0.0.0.0', () => {
    console.log(`Bounce Forge server listening on http://localhost:${port}`);
  });
}
