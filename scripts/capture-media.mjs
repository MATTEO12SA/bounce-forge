#!/usr/bin/env node
// Captures the README screenshots, the social card and a short gameplay GIF from the real build.
//
// Usage: npm run build && node scripts/capture-media.mjs
// Requires a Chromium-based browser; the GIF additionally needs `ffmpeg` on the PATH.

import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';

const root = process.cwd();
const basePath = process.env.VITE_BASE_PATH ?? '/bounce-forge/';
const port = 4327;
const cdpPort = 9247;
const shots = `${root}/docs/media`;
const frames = `${root}/.media-frames`;
const profile = `${root}/.media-browser-profile`;
const browserPath = [
  process.env.BROWSER_PATH,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium'
]
  .filter(Boolean)
  .find((candidate) => existsSync(candidate));

const get = (url, method = 'GET') =>
  new Promise((resolve, reject) => {
    const req = http.request(url, { method }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.end();
  });

async function waitHttp(url) {
  for (let i = 0; i < 80; i += 1) {
    try {
      return await get(url);
    } catch {
      await delay(250);
    }
  }
  throw new Error(`timeout ${url}`);
}

async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  });
  await new Promise((resolve) => ws.addEventListener('open', resolve));
  return {
    send(method, params = {}) {
      const callId = ++id;
      ws.send(JSON.stringify({ id: callId, method, params }));
      return new Promise((resolve, reject) =>
        pending.set(callId, (msg) =>
          msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result)
        )
      );
    },
    close: () => ws.close()
  };
}

const evaluate = async (page, expression) =>
  (await page.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }))
    .result.value;

async function waitFor(page, expression, timeout = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await evaluate(page, expression).catch(() => false)) return true;
    await delay(150);
  }
  throw new Error(`waitFor timed out: ${expression}`);
}

async function viewport(page, width, height, mobile = false) {
  await page.send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile
  });
  await delay(400);
}

async function shot(page, file, clip) {
  const { data } = await page.send('Page.captureScreenshot', {
    format: 'png',
    ...(clip ? { clip } : {})
  });
  await writeFile(file, Buffer.from(data, 'base64'));
}

const GAME = `window.__bounceForge.scene.getScene('GameScene')`;

let preview;
let browser;
try {
  if (!browserPath) throw new Error('No Chromium browser found (set BROWSER_PATH).');
  await mkdir(shots, { recursive: true });
  await rm(frames, { recursive: true, force: true });
  await mkdir(frames, { recursive: true });

  preview = spawn(
    process.execPath,
    [
      `${root}/node_modules/vite/bin/vite.js`,
      'preview',
      '--port',
      String(port),
      '--strictPort',
      '--host',
      '127.0.0.1'
    ],
    { cwd: root, stdio: 'ignore', env: { ...process.env, VITE_BASE_PATH: basePath } }
  );
  const url = `http://127.0.0.1:${port}${basePath}`;
  await waitHttp(url);

  browser = spawn(
    browserPath,
    [
      '--headless=new',
      '--mute-audio',
      '--ignore-gpu-blocklist',
      '--enable-gpu-rasterization',
      ...(process.platform === 'win32' ? ['--use-angle=d3d11'] : []),
      `--remote-debugging-port=${cdpPort}`,
      `--user-data-dir=${profile}`,
      'about:blank'
    ],
    { stdio: 'ignore' }
  );
  await waitHttp(`http://127.0.0.1:${cdpPort}/json/version`);
  const target = JSON.parse(await get(`http://127.0.0.1:${cdpPort}/json/new`, 'PUT'));
  const page = await connect(target.webSocketDebuggerUrl);
  await page.send('Page.enable');
  await page.send('Runtime.enable');

  // A believable profile: some progress and medals, tutorial already seen.
  await page.send('Page.navigate', { url });
  await waitFor(page, `document.querySelector('.home') !== null`);
  await evaluate(
    page,
    `localStorage.setItem('bounce-forge.save.v1', JSON.stringify({ version: 6, bestScore: 48210, unlockedLevel: 9, completedLevels: [0,1,2,3,4,5,6,7,8], levelMedals: {'0':'gold','1':'gold','2':'silver','3':'gold','4':'bronze','5':'silver','6':'gold','7':'silver','8':'bronze'}, preferences: { soundEnabled: true, themeId: 'forge', volumeSfx: 0.6, volumeMusic: 0.5, fxQuality: 'high', fullscreen: false, language: '${process.env.MEDIA_LANG ?? 'fr'}', reducedMotion: false }, creativeLevelSlots: {}, tutorialSeen: true, records: { endless: { bestScore: 61250, bestWave: 14 }, daily: {} } })); true`
  );
  await page.send('Page.reload', {});

  await viewport(page, 1440, 900);
  await waitFor(page, `document.querySelector('#app').classList.contains('engine-live')`, 40000);
  await delay(2500);
  await shot(page, `${shots}/home.png`);

  await viewport(page, 1200, 630);
  await delay(1200);
  await shot(page, `${root}/public/social-card.png`);

  await viewport(page, 1440, 900);
  await evaluate(page, `location.hash = '#/campaign'; true`);
  await delay(800);
  await shot(page, `${shots}/campaign.png`);

  await evaluate(page, `location.hash = '#/modes'; true`);
  await delay(600);
  await shot(page, `${shots}/modes.png`);

  // Gameplay: a lively multiball moment, autopiloted so the GIF shows real play.
  await evaluate(page, `location.hash = '#/play/campaign/4'; true`);
  await waitFor(page, `${GAME} && !${GAME}.isDemo() && ${GAME}.getSession().levelIndex === 3`);
  await delay(600);
  await evaluate(
    page,
    `(() => { const s = ${GAME}; s.setAutopilot(true); s.launchAttachedBalls(); return true; })()`
  );
  await delay(3500);
  await evaluate(
    page,
    `(() => { const s = ${GAME}; s.applyPowerUp('multiBall'); s.applyPowerUp('multiBall'); return true; })()`
  );
  await delay(5000);
  const rect = await evaluate(
    page,
    `(() => { const r = document.querySelector('.play-stage').getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; })()`
  );
  for (let index = 0; index < 72; index += 1) {
    const { data } = await page.send('Page.captureScreenshot', {
      format: 'jpeg',
      quality: 85,
      clip: { ...rect, scale: 0.5 }
    });
    await writeFile(
      `${frames}/f${String(index).padStart(3, '0')}.jpg`,
      Buffer.from(data, 'base64')
    );
    await delay(40);
  }
  await shot(page, `${shots}/gameplay.png`);

  await viewport(page, 390, 844, true);
  await evaluate(page, `location.hash = '#/play/campaign/7'; true`);
  await waitFor(page, `${GAME} && ${GAME}.getSession().levelIndex === 6`);
  await delay(800);
  await evaluate(
    page,
    `(() => { const s = ${GAME}; s.setAutopilot(true); s.launchAttachedBalls(); return true; })()`
  );
  await delay(6000);
  await shot(page, `${shots}/mobile.png`);
  page.close();

  const ffmpeg = spawnSync(
    'ffmpeg',
    [
      '-y',
      '-loglevel',
      'error',
      '-framerate',
      '14',
      '-i',
      `${frames}/f%03d.jpg`,
      '-vf',
      'scale=320:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=96[p];[b][p]paletteuse=dither=bayer:bayer_scale=4',
      '-loop',
      '0',
      `${shots}/gameplay.gif`
    ],
    { stdio: 'inherit' }
  );
  console.log(ffmpeg.status === 0 ? 'GIF written.' : 'ffmpeg unavailable: GIF skipped.');
  console.log(`Media written to ${shots} and public/social-card.png`);
} finally {
  browser?.kill();
  preview?.kill();
  await delay(800);
  await rm(frames, { recursive: true, force: true }).catch(() => undefined);
  await rm(profile, { recursive: true, force: true }).catch(() => undefined);
}
