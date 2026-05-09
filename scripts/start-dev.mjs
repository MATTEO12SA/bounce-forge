#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const viteBin = resolve(root, 'node_modules', 'vite', 'bin', 'vite.js');
const port = process.env.PORT ?? '5173';
const apiPort = process.env.API_PORT ?? '8787';
const host =
  process.env.HOST ?? (process.env.EXPOSE_NETWORK === '1' ? '0.0.0.0' : 'localhost');
const appUrl = `http://localhost:${port}`;
const apiUrl = `http://localhost:${apiPort}`;
const appProbeUrls = [appUrl, `http://127.0.0.1:${port}`];
const apiProbeUrls = [`${apiUrl}/api/admin/session`, `http://127.0.0.1:${apiPort}/api/admin/session`];
const localHosts = ['localhost', '127.0.0.1', '::1'];
const startupStartedAt = Date.now();

if (!existsSync(viteBin)) {
  console.error('Dependencies are missing. Run `npm install` once, then `npm start`.');
  process.exit(1);
}

function delay(ms) {
  return new Promise((resolveDelay) => {
    setTimeout(resolveDelay, ms);
  });
}

function canReachHttp(url, timeoutMs = 650) {
  return new Promise((resolveReach) => {
    let settled = false;
    const finish = (value) => {
      if (settled) {
        return;
      }

      settled = true;
      resolveReach(value);
    };

    const request = http.request(url, { method: 'GET', timeout: timeoutMs }, (response) => {
      response.resume();
      finish(true);
    });

    request.on('timeout', () => {
      request.destroy();
      finish(false);
    });
    request.on('error', () => finish(false));
    request.end();
  });
}

function canConnectTcp(hostname, targetPort, timeoutMs = 300) {
  return new Promise((resolveConnect) => {
    let settled = false;
    const finish = (value) => {
      if (settled) {
        return;
      }

      settled = true;
      resolveConnect(value);
    };
    const socket = net.connect({ host: hostname, port: Number(targetPort) });

    socket.setTimeout(timeoutMs);
    socket.on('connect', () => {
      socket.destroy();
      finish(true);
    });
    socket.on('timeout', () => {
      socket.destroy();
      finish(false);
    });
    socket.on('error', () => finish(false));
  });
}

async function canReachAnyHttp(urls) {
  const results = await Promise.all(urls.map((url) => canReachHttp(url)));
  return results.some(Boolean);
}

async function canConnectAnyLocal(targetPort) {
  const results = await Promise.all(localHosts.map((hostname) => canConnectTcp(hostname, targetPort)));
  return results.some(Boolean);
}

async function waitForAnyHttp(urls, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const results = await Promise.all(urls.map((url) => canReachHttp(url, 500)));
    if (results.some(Boolean)) {
      return true;
    }

    await delay(100);
  }

  return false;
}

const [appHttpReady, apiHttpReady, appPortBusy, apiPortBusy] = await Promise.all([
  canReachAnyHttp(appProbeUrls),
  canReachAnyHttp(apiProbeUrls),
  canConnectAnyLocal(port),
  canConnectAnyLocal(apiPort)
]);
const appAlreadyRunning = appHttpReady || appPortBusy;
const apiAlreadyRunning = apiHttpReady || apiPortBusy;

if (appAlreadyRunning && apiAlreadyRunning) {
  console.log(
    appHttpReady
      ? `Bounce Forge is already running: ${appUrl}`
      : `Port ${port} is already in use; not starting another Vite server.`
  );
  console.log(
    apiHttpReady
      ? `Admin API is already running: ${apiUrl}`
      : `Port ${apiPort} is already in use; not starting another admin API.`
  );
  process.exit(0);
}

console.log(`Starting Bounce Forge on ${appUrl}`);
console.log(`Starting admin API on ${apiUrl}`);
if (host === '0.0.0.0') {
  console.log('Network exposure enabled through HOST=0.0.0.0 or EXPOSE_NETWORK=1.');
}
console.log('Press Ctrl+C to stop the dev server cleanly.\n');

const children = [];
let shuttingDown = false;

function spawnChild(name, command, args, options) {
  const child = spawn(command, args, options);
  children.push(child);

  child.on('error', (error) => {
    console.error(`${name} failed to start: ${error.message}`);
    process.exit(1);
  });

  child.on('exit', (code, signal) => {
    if (shuttingDown) {
      if (children.every((runningChild) => runningChild.exitCode !== null || runningChild.killed)) {
        console.log('Bounce Forge dev server stopped.');
        process.exit(0);
      }
      return;
    }

    if (signal) {
      process.exit(0);
    }

    console.error(`${name} stopped unexpectedly with exit code ${code ?? 0}.`);
    stop('SIGTERM');
    process.exit(code ?? 1);
  });

  return child;
}

if (apiAlreadyRunning) {
  console.log(
    apiHttpReady
      ? `Reusing existing admin API on ${apiUrl}.`
      : `Port ${apiPort} is already in use; not starting another admin API.`
  );
} else {
  spawnChild('Admin API', process.execPath, ['server/index.mjs'], {
    cwd: root,
    env: {
      ...process.env,
      ADMIN_API_ONLY: '1',
      API_HOST: host,
      API_PORT: apiPort,
      ADMIN_ALLOWED_ORIGINS: [
        process.env.ADMIN_ALLOWED_ORIGINS,
        `http://localhost:${port}`,
        `http://127.0.0.1:${port}`
      ]
        .filter(Boolean)
        .join(',')
    },
    stdio: 'inherit'
  });
}

if (appAlreadyRunning) {
  console.log(
    appHttpReady
      ? `Reusing existing Vite server on ${appUrl}.`
      : `Port ${port} is already in use; not starting another Vite server.`
  );
} else {
  spawnChild(
    'Vite',
    process.execPath,
    [viteBin, '--host', host, '--port', port, '--strictPort', '--clearScreen', 'false'],
    {
      cwd: root,
      env: {
        ...process.env,
        API_PORT: apiPort,
        FORCE_COLOR: process.env.FORCE_COLOR ?? '1'
      },
      stdio: 'inherit'
    }
  );
}

function stop(signal) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  console.log(`\nStopping Bounce Forge dev server...`);

  for (const child of children) {
    if (child.exitCode === null && !child.killed) {
      child.kill(signal);
    }
  }

  const forceExit = setTimeout(() => {
    for (const child of children) {
      if (child.exitCode === null && !child.killed) {
        child.kill('SIGTERM');
      }
    }
  }, 2500);

  forceExit.unref();
}

process.on('SIGINT', () => stop('SIGINT'));
process.on('SIGTERM', () => stop('SIGTERM'));

if (!appAlreadyRunning) {
  void waitForAnyHttp(appProbeUrls).then((ready) => {
    if (!ready) {
      console.warn(`Bounce Forge did not answer on ${appUrl} within 15s.`);
      return;
    }

    console.log(`Bounce Forge ready in ${Date.now() - startupStartedAt}ms: ${appUrl}`);
  });
}
