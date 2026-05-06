#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const viteBin = resolve(root, 'node_modules', 'vite', 'bin', 'vite.js');
const port = process.env.PORT ?? '5173';
const apiPort = process.env.API_PORT ?? '8787';

if (!existsSync(viteBin)) {
  console.error('Dependencies are missing. Run `npm install` once, then `npm start`.');
  process.exit(1);
}

console.log(`Starting Bounce Forge on http://localhost:${port}`);
console.log(`Starting admin API on http://localhost:${apiPort}`);
console.log('Press Ctrl+C to stop the dev server cleanly.\n');

const api = spawn(process.execPath, ['server/index.mjs'], {
  cwd: root,
  env: {
    ...process.env,
    ADMIN_API_ONLY: '1',
    API_PORT: apiPort
  },
  stdio: 'inherit'
});

const vite = spawn(
  process.execPath,
  [viteBin, '--host', '0.0.0.0', '--port', port, '--strictPort', '--clearScreen', 'false'],
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

let shuttingDown = false;

function stop(signal) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  console.log(`\nStopping Bounce Forge dev server...`);

  if (vite.exitCode === null && !vite.killed) {
    vite.kill(signal);
  }

  if (api.exitCode === null && !api.killed) {
    api.kill(signal);
  }

  const forceExit = setTimeout(() => {
    if (vite.exitCode === null && !vite.killed) {
      vite.kill('SIGTERM');
    }
    if (api.exitCode === null && !api.killed) {
      api.kill('SIGTERM');
    }
  }, 2500);

  forceExit.unref();
}

process.on('SIGINT', () => stop('SIGINT'));
process.on('SIGTERM', () => stop('SIGTERM'));

api.on('error', (error) => {
  console.error(error.message);
  process.exit(1);
});

vite.on('error', (error) => {
  console.error(error.message);
  process.exit(1);
});

vite.on('exit', (code, signal) => {
  if (shuttingDown) {
    console.log('Bounce Forge dev server stopped.');
    process.exit(0);
  }

  if (signal) {
    process.exit(0);
  }

  process.exit(code ?? 0);
});
