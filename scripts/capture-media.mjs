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
    } else if (msg.method === 'Runtime.exceptionThrown') {
      // Surface page errors: a broken level would otherwise just look empty.
      const details = msg.params.exceptionDetails;
      console.error('[page error]', details.exception?.description ?? details.text);
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
  if (!clip) {
    await page.send('Runtime.evaluate', { expression: 'window.scrollTo(0, 0)' });
    await delay(150);
  }
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
  // Headless tabs can report themselves hidden, which auto-pauses the game mid-capture.
  await page.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `Object.defineProperty(document, 'hidden', { get: () => false });
      Object.defineProperty(document, 'visibilityState', { get: () => 'visible' });
      document.addEventListener('visibilitychange', (e) => e.stopImmediatePropagation(), true);`
  });
  await page.send('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => undefined);

  // A believable profile: some progress and medals, tutorial already seen.
  await page.send('Page.navigate', { url });
  await waitFor(page, `document.querySelector('.home') !== null`);
  await evaluate(
    page,
    `localStorage.setItem('bounce-forge.save.v1', JSON.stringify({ version: 8, bestScore: 48210, unlockedLevel: ${process.env.CAPTURE_LEVELS ? 35 : 9}, completedLevels: [0,1,2,3,4,5,6,7,8], levelMedals: {'0':'gold','1':'gold','2':'silver','3':'gold','4':'bronze','5':'silver','6':'gold','7':'silver','8':'bronze'}, preferences: { soundEnabled: true, themeId: 'forge', volumeSfx: 0.6, volumeMusic: 0.5, fxQuality: 'high', fullscreen: false, language: '${process.env.MEDIA_LANG ?? 'fr'}', reducedMotion: ${process.env.CAPTURE_LEVELS ? 'true' : 'false'} }, creativeLevelSlots: {}, tutorialSeen: true, records: { endless: { bestScore: 61250, bestWave: 14 }, daily: {} }, levelMedals: {'0':'diamond','1':'gold','2':'silver','3':'diamond','4':'bronze','5':'silver','6':'gold','7':'silver','8':'bronze'}, levelChallenges: {'0':['objective','score','flawless'],'1':['objective','score'],'2':['flawless'],'3':['objective','score','flawless'],'5':['score'],'6':['objective','flawless'],'7':['score']}, achievements: {'first-clear': 1794500000000, 'chapter-1': 1794600000000, 'first-gold': 1794500000000, 'first-diamond': 1794550000000, 'combo-50': 1794560000000, 'endless-10': 1794570000000, 'balls-30': 1794580000000}, stats: { riskCaught: 6, capsulesCaught: 214, bricksBroken: 8420, livesLost: 17, bestCombo: 87, bestBalls: 41 } })); true`
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
  // CAPTURE_LEVELS=<dir>: one screenshot of every campaign level, for design review.
  if (process.env.CAPTURE_LEVELS) {
    await mkdir(process.env.CAPTURE_LEVELS, { recursive: true });
    for (let level = 1; level <= 36; level += 1) {
      await evaluate(page, `location.hash = '#/play/campaign/${level}'; true`);
      await waitFor(
        page,
        `${GAME} && !${GAME}.isDemo() && ${GAME}.getSession().levelIndex === ${level - 1}`
      );
      await delay(1200);
      await delay(600);
      const stage = await evaluate(
        page,
        `(() => { const r = document.querySelector('.play-stage').getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, scale: 0.6 }; })()`
      );
      await shot(
        page,
        `${process.env.CAPTURE_LEVELS}/level-${String(level).padStart(2, '0')}.png`,
        stage
      );
    }
  }

  await evaluate(page, `location.hash = '#/campaign'; true`);
  await delay(800);
  await shot(page, `${shots}/campaign.png`);

  await evaluate(page, `location.hash = '#/modes'; true`);
  await delay(600);
  await shot(page, `${shots}/modes.png`);

  await evaluate(page, `location.hash = '#/trophies'; true`);
  await delay(700);
  await shot(page, `${shots}/trophies.png`);

  // CAPTURE_SKINS=<dir>: the Appearance panel, then a game with unlocked skins equipped.
  if (process.env.CAPTURE_SKINS) {
    const dir = process.env.CAPTURE_SKINS;
    await mkdir(dir, { recursive: true });
    await evaluate(page, `document.querySelector('.skins-panel').scrollIntoView(); true`);
    await delay(300);
    const panel = await evaluate(
      page,
      `(() => { const r = document.querySelector('.skins-panel').getBoundingClientRect(); return { x: r.x, y: Math.max(0, r.y), width: r.width, height: Math.min(r.height, innerHeight - Math.max(0, r.y)), scale: 1 }; })()`
    );
    await shot(page, `${dir}/skins-panel.png`, panel);
    await evaluate(
      page,
      `(() => { const pick = (name) => [...document.querySelectorAll('.skin-card')].find((b) => b.textContent.includes(name))?.click(); pick('Néon'); pick('Plasma'); return true; })()`
    );
    await delay(300);
    await shot(page, `${dir}/skins-panel-equipped.png`, panel);
    await evaluate(page, `location.hash = '#/play/campaign/2'; true`);
    await waitFor(page, `${GAME} && !${GAME}.isDemo() && ${GAME}.getSession().levelIndex === 1`);
    await delay(800);
    await evaluate(page, `(() => { ${GAME}.setAutopilot(true); return true; })()`);
    await delay(2500);
    const stage = await evaluate(
      page,
      `(() => { const r = document.querySelector('.play-stage').getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, scale: 0.7 }; })()`
    );
    await shot(page, `${dir}/skins-game.png`, stage);
    // Back to the default look for the other captures.
    await evaluate(
      page,
      `(() => { const save = JSON.parse(localStorage.getItem('bounce-forge.save.v1')); save.preferences.skins = { paddle: 'forge', ball: 'ember', trail: 'ember' }; localStorage.setItem('bounce-forge.save.v1', JSON.stringify(save)); return true; })()`
    );
    await evaluate(page, `location.hash = '#/'; true`);
    await page.send('Page.reload', {});
    await waitFor(page, `document.querySelector('#app').classList.contains('engine-live')`, 40000);
    await delay(1000);
  }

  // The Workshop and the editor, opened on a "Surprise!" level.
  await evaluate(page, `location.hash = '#/create'; true`);
  await delay(800);
  await shot(page, `${shots}/workshop.png`);
  await evaluate(page, `document.querySelector('.start-card').click(); true`);
  await waitFor(page, `document.querySelector('.editor-canvas') !== null`);
  await delay(900);
  await shot(page, `${shots}/editor.png`);
  if (process.env.CAPTURE_EDITOR_MOBILE) {
    await viewport(page, 390, 844, true);
    await delay(900);
    await shot(page, `${process.env.CAPTURE_EDITOR_MOBILE}`);
    await viewport(page, 1440, 900);
  }
  // CAPTURE_COMMUNITY=1: publish the surprise level through the real interface, capture the
  // library and the creation page, play it, then delete it again from "My publications".
  if (process.env.CAPTURE_COMMUNITY) {
    const button = (text, scope = 'document') =>
      `[...${scope}.querySelectorAll('button')].find((b) => b.textContent.trim().includes(${JSON.stringify(text)}))`;
    await evaluate(
      page,
      `${button('Enregistrer', "document.querySelector('.editor-bar')")}.click(); true`
    );
    await delay(400);
    await evaluate(
      page,
      `${button('Publier', "document.querySelector('.editor-bar')")}.click(); true`
    );
    await waitFor(
      page,
      `document.querySelector('.dialog input[placeholder="Pseudo"]') !== null`,
      20000
    );
    await evaluate(
      page,
      `(() => { const nick = document.querySelector('.dialog input[placeholder="Pseudo"]'); nick.value = 'Forgeron ' + Math.random().toString(36).slice(2, 6); const title = document.querySelector('.dialog input[aria-label="Titre"]'); title.value = 'Tempête de cristal'; document.querySelector('.dialog textarea').value = 'Un niveau surprise forgé pour tester la bibliothèque.'; ${button('Publier', "document.querySelector('.dialog')")}.click(); return true; })()`
    );
    const published = await waitFor(
      page,
      `location.hash.startsWith('#/community/') && document.querySelector('.community-hero') !== null`,
      20000
    );
    console.log(
      published ? 'Community: published through the interface.' : 'Community: publishing FAILED'
    );
    await delay(900);
    await shot(page, `${process.env.CAPTURE_COMMUNITY}/community-detail.png`);
    await evaluate(page, `location.hash = '#/community'; true`);
    const listed = await waitFor(
      page,
      `document.querySelectorAll('.community-card').length > 0`,
      20000
    );
    console.log(listed ? 'Community: listed in the library.' : 'Community: library listing FAILED');
    await delay(900);
    await shot(page, `${process.env.CAPTURE_COMMUNITY}/community.png`);
    await evaluate(page, `document.querySelector('.community-card').click(); true`);
    await waitFor(page, `document.querySelector('.community-hero') !== null`, 20000);
    await evaluate(
      page,
      `${button('Jouer', "document.querySelector('.community-actions')")}.click(); true`
    );
    const playing = await waitFor(
      page,
      `${GAME} && ${GAME}.getSession().community !== undefined && !${GAME}.isDemo()`,
      20000
    );
    console.log(playing ? 'Community: the creation is playable.' : 'Community: playing FAILED');
    await delay(1200);
    await shot(page, `${process.env.CAPTURE_COMMUNITY}/community-play.png`);
    await evaluate(page, `location.hash = '#/create'; true`);
    await waitFor(page, `document.querySelector('.my-publication') !== null`, 20000);
    await shot(page, `${process.env.CAPTURE_COMMUNITY}/community-mine.png`);
    await evaluate(
      page,
      `document.querySelector('.my-publication .icon-button-danger').click(); true`
    );
    await waitFor(page, `document.querySelector('.dialog .button-danger') !== null`, 5000);
    await evaluate(page, `document.querySelector('.dialog .button-danger').click(); true`);
    const deleted = await waitFor(
      page,
      `document.querySelectorAll('.my-publication').length === 0`,
      20000
    );
    console.log(deleted ? 'Community: deleted from My publications.' : 'Community: delete FAILED');
  }
  await evaluate(
    page,
    `localStorage.removeItem('bounce-forge.editor-draft.v1.0'); location.hash = '#/'; true`
  );
  await delay(600);

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
    `(() => { const s = ${GAME}; s.applyPowerUp('multiBall'); s.applyPowerUp('multiBall'); s.applyPowerUp('fireBall'); s.applyPowerUp('shield'); s.applyPowerUp('explosiveBall'); return true; })()`
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
  // Show a first pickup in the bonus card for the screenshot.
  await evaluate(
    page,
    `(() => { const s = ${GAME}; s.powerUps.forEach((p) => p.disable()); s.setAutopilot(false); s.spawnSpecificPowerUp(540, 900, 'laserPaddle'); s.collectPowerUp(s.powerUps.find((p) => p.active)); s.setAutopilot(true); return true; })()`
  );
  await delay(500);
  await shot(page, `${shots}/gameplay.png`);

  await viewport(page, 390, 844, true);
  await evaluate(page, `location.hash = '#/play/campaign/7'; true`);
  await waitFor(page, `${GAME} && ${GAME}.getSession().levelIndex === 6`);
  await delay(800);
  await evaluate(
    page,
    `(() => { const s = ${GAME}; s.setAutopilot(true); s.launchAttachedBalls(); return true; })()`
  );
  await delay(5000);
  await evaluate(
    page,
    `(() => { const s = ${GAME}; s.powerUps.forEach((p) => p.disable()); s.applyPowerUp('slowMotion'); s.setAutopilot(false); s.spawnSpecificPowerUp(540, 900, 'magnet'); s.collectPowerUp(s.powerUps.find((p) => p.active)); s.setAutopilot(true); return true; })()`
  );
  await delay(600);
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
  for (const child of [browser, preview]) {
    if (!child) continue;
    if (process.platform === 'win32') {
      // Kill the whole tree: Chromium helpers otherwise keep the profile locked.
      spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
      spawnSync(
        'powershell.exe',
        [
          '-NoProfile',
          '-Command',
          `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*media-browser-profile*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`
        ],
        { stdio: 'ignore' }
      );
    } else {
      child.kill();
    }
  }
  await delay(800);
  await rm(frames, { recursive: true, force: true }).catch(() => undefined);
  await rm(profile, { recursive: true, force: true }).catch(() => undefined);
}
