#!/usr/bin/env node
// Portable end-to-end smoke test for Bounce Forge.
//
// Serves the production build (`dist/`) with `vite preview` under the same base path as GitHub
// Pages, drives a headless Chromium through the Chrome DevTools Protocol and checks the real
// player journeys: home, menus at three viewport sizes, campaign play, pause, victory, defeat,
// endless waves, the daily challenge, level sharing with Unicode names, old-save migration, stress
// (96 balls, 20 restarts) and the absence of admin `/api` traffic. Screenshots are written to
// `artifacts/smoke/` so a failing CI run can be inspected.
//
// Usage: npm run build && npm run test:smoke   (options: --visible, --url=http://host/base/)

import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';

const root = process.cwd();
const visible = process.argv.includes('--visible');
const urlArg = process.argv.find((arg) => arg.startsWith('--url='))?.slice('--url='.length);
const basePath = process.env.VITE_BASE_PATH ?? '/bounce-forge/';
const previewPort = Number(process.env.SMOKE_PORT ?? 4319);
const cdpPort = Number(process.env.BROWSER_TEST_CDP_PORT ?? 9241);
const outDir = `${root}/artifacts/smoke`;
const userDataDir = `${root}/.smoke-browser-profile/${process.pid}`;
const browserPath = [
  process.env.BROWSER_PATH,
  process.env.BROWSER_TEST_EDGE_PATH,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
]
  .filter(Boolean)
  .find((candidate) => existsSync(candidate));

// SMOKE_SHARD runs one part of the journey so CI can run the parts in parallel:
// layout (every screen on 3 sizes), ui (campaign, modes, stress, trophies), levels-a / levels-b
// (the 30 campaign levels, half each) and gameplay (power-ups, mechanisms, workshop, community,
// sharing). Default: everything.
const SHARD = process.env.SMOKE_SHARD ?? 'all';
const runs = (name) => SHARD === 'all' || SHARD === name;

const results = [];
const failures = [];

function check(name, condition, details = undefined) {
  results.push({ name, ok: Boolean(condition), details });
  if (!condition) {
    failures.push(name);
    console.error(`  ✗ ${name}${details === undefined ? '' : ` — ${JSON.stringify(details)}`}`);
  } else {
    console.log(`  ✓ ${name}`);
  }
}

function requestText(url, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method }, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.setTimeout(2000, () => req.destroy(new Error(`timeout ${url}`)));
    req.end();
  });
}

async function waitForHttp(url, timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      await requestText(url);
      return;
    } catch {
      await delay(250);
    }
  }
  throw new Error(`Timed out waiting for ${url}`);
}

function createCdpClient(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  const listeners = new Map();
  const exceptions = [];
  const consoleErrors = [];

  ws.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      pending.get(message.id)(message);
      pending.delete(message.id);
      return;
    }
    if (message.method === 'Runtime.exceptionThrown') {
      const details = message.params.exceptionDetails;
      exceptions.push(details?.exception?.description ?? details?.text);
    }
    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
      consoleErrors.push(message.params.args?.map((arg) => arg.value ?? arg.description).join(' '));
    }
    listeners.get(message.method)?.forEach((listener) => listener(message.params));
  });

  return new Promise((resolve, reject) => {
    ws.addEventListener('open', () =>
      resolve({
        send(method, params = {}) {
          const callId = ++id;
          ws.send(JSON.stringify({ id: callId, method, params }));
          return new Promise((done, fail) => {
            const timer = setTimeout(() => {
              pending.delete(callId);
              fail(new Error(`CDP timeout: ${method}`));
            }, 60000);
            pending.set(callId, (message) => {
              clearTimeout(timer);
              if (message.error) fail(new Error(`${method}: ${message.error.message}`));
              else done(message.result);
            });
          });
        },
        on(method, listener) {
          if (!listeners.has(method)) listeners.set(method, new Set());
          listeners.get(method).add(listener);
        },
        close: () => ws.close(),
        exceptions,
        consoleErrors
      })
    );
    ws.addEventListener('error', reject);
  });
}

async function evaluate(page, expression) {
  const result = await page.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true
  });
  if (result.exceptionDetails) {
    throw new Error(
      `Eval failed: ${result.exceptionDetails.exception?.description ?? result.exceptionDetails.text}`
    );
  }
  return result.result.value;
}

async function waitFor(page, expression, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const value = await evaluate(page, expression);
      if (value) return value;
    } catch {
      /* page may be navigating */
    }
    await delay(120);
  }
  return null;
}

async function setViewport(page, width, height) {
  await page.send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: width < 600
  });
  await delay(300);
}

async function screenshot(page, name) {
  const { data } = await page.send('Page.captureScreenshot', { format: 'png' });
  await writeFile(`${outDir}/${name}.png`, Buffer.from(data, 'base64'));
}

async function goto(page, baseUrl, hash) {
  await evaluate(page, `window.location.hash = ${JSON.stringify(hash)}; true`);
  await delay(350);
}

async function key(page, keyName, code, keyCode) {
  for (const type of ['keyDown', 'keyUp']) {
    await page.send('Input.dispatchKeyEvent', {
      type,
      key: keyName,
      code,
      windowsVirtualKeyCode: keyCode,
      nativeVirtualKeyCode: keyCode
    });
  }
}

const GAME = `window.__bounceForge.scene.getScene('GameScene')`;

function encodeBf2(payload) {
  return `BF2:${Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')}`;
}

function oneBrickRows() {
  const rows = Array.from({ length: 40 }, () => '.'.repeat(36));
  rows[3] = `.....${'1'.repeat(26)}.....`;
  return rows;
}

async function stopProcess(child) {
  if (!child) return;
  if (process.platform === 'win32') {
    // Chromium spawns helper processes that survive the parent on Windows and keep the
    // profile locked: always kill the whole tree.
    spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    // Edge may relaunch itself outside that tree: also stop anything using our test profile.
    spawnSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-Command',
        `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*${userDataDir.replace(/\//g, '\\')}*' -or $_.CommandLine -like '*${userDataDir}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`
      ],
      { stdio: 'ignore' }
    );
    await delay(600);
    return;
  }
  if (child.exitCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([
    new Promise((resolve) => child.once('exit', () => resolve(true))),
    delay(2500).then(() => false)
  ]);
  if (child.exitCode === null) child.kill('SIGKILL');
}

let preview;
let browser;
let page;

try {
  if (!browserPath) {
    throw new Error('No Chromium-based browser found. Set BROWSER_PATH.');
  }
  await mkdir(outDir, { recursive: true });
  await rm(userDataDir, { recursive: true, force: true }).catch(() => undefined);

  let baseUrl = urlArg;
  if (!baseUrl) {
    if (!existsSync(`${root}/dist/index.html`)) {
      throw new Error('dist/ is missing. Run `npm run build` first.');
    }
    preview = spawn(
      process.execPath,
      [
        `${root}/node_modules/vite/bin/vite.js`,
        'preview',
        '--port',
        String(previewPort),
        '--strictPort',
        '--host',
        '127.0.0.1'
      ],
      {
        cwd: root,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, VITE_BASE_PATH: basePath }
      }
    );
    preview.stderr.on('data', (data) => process.stderr.write(data));
    baseUrl = `http://127.0.0.1:${previewPort}${basePath}`;
    await waitForHttp(baseUrl);
  }
  console.log(`Smoke testing ${baseUrl} with ${browserPath}`);

  browser = spawn(
    browserPath,
    [
      visible ? '' : '--headless=new',
      '--no-first-run',
      '--disable-extensions',
      '--mute-audio',
      '--autoplay-policy=no-user-gesture-required',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      `--remote-debugging-port=${cdpPort}`,
      `--user-data-dir=${userDataDir}`,
      '--window-size=1440,900',
      'about:blank'
    ].filter(Boolean),
    { stdio: ['ignore', 'pipe', 'pipe'] }
  );
  // Cold CI runners can take a while to start the browser.
  await waitForHttp(`http://127.0.0.1:${cdpPort}/json/version`, 60000);
  const target = JSON.parse(await requestText(`http://127.0.0.1:${cdpPort}/json/new`, 'PUT'));
  page = await createCdpClient(target.webSocketDebuggerUrl);

  const requests = [];
  const failedRequests = [];
  page.on('Network.requestWillBeSent', (params) => requests.push(params.request.url));
  page.on('Network.responseReceived', (params) => {
    // Only the site's own files count: the community API reports its errors in the interface.
    if (params.response.status >= 400 && !params.response.url.includes('.supabase.co'))
      failedRequests.push(`${params.response.status} ${params.response.url}`);
  });
  page.on('Network.loadingFailed', (params) => {
    if (!params.canceled) failedRequests.push(`failed ${params.errorText}`);
  });
  await page.send('Runtime.enable');
  await page.send('Page.enable');
  await page.send('Network.enable');
  await setViewport(page, 1440, 900);

  // ---------------------------------------------------------------- legacy save migration
  console.log('Save migration');
  await page.send('Page.navigate', { url: baseUrl });
  await waitFor(page, `document.querySelector('.home') !== null`);
  await evaluate(
    page,
    `localStorage.setItem('bounce-forge.save.v1', JSON.stringify({
      version: 5, bestScore: 4321, unlockedLevel: 3, completedLevels: [0,1,2],
      levelMedals: {'0':'gold','1':'silver','2':'bronze'},
      preferences: { soundEnabled: true, themeId: 'forge', volumeSfx: 0.6, volumeMusic: 0.5, fxQuality: 'med', fullscreen: false },
      creativeLevelSlots: {}
    })); localStorage.setItem('bounce-forge.save.v1.lang-probe', '1'); true`
  );
  await page.send('Page.reload', { ignoreCache: true });
  await waitFor(page, `document.querySelector('.home-stats') !== null`);
  const migrated = await evaluate(page, `JSON.parse(localStorage.getItem('bounce-forge.save.v1'))`);
  check(
    'v5 save migrates to v6 and keeps progress',
    migrated?.version === 8 && migrated.bestScore === 4321 && migrated.unlockedLevel === 3,
    migrated?.version
  );
  // Start the rest from a French, tutorial-free profile for stable screenshots.
  await evaluate(
    page,
    `(() => { const s = JSON.parse(localStorage.getItem('bounce-forge.save.v1')); s.preferences.language = 'fr'; s.tutorialSeen = true; localStorage.setItem('bounce-forge.save.v1', JSON.stringify(s)); return true; })()`
  );
  await page.send('Page.reload', { ignoreCache: true });

  // ---------------------------------------------------------------- home + menus, 3 viewports
  const viewports = [
    [1440, 900, 'desktop'],
    [768, 1024, 'tablet'],
    [360, 800, 'phone']
  ];
  const live = await waitFor(
    page,
    `document.querySelector('#app').classList.contains('engine-live')`,
    60000
  );
  check('engine loads lazily and the home preview runs', live);
  const demo = await waitFor(
    page,
    `window.__bounceForge?.scene.isActive('GameScene') && ${GAME}.isDemo()`
  );
  check('home preview is a live attract-mode game', demo);

  if (runs('layout')) {
    for (const [width, height, label] of viewports) {
      console.log(`Viewport ${label} ${width}x${height}`);
      await setViewport(page, width, height);
      for (const [hash, name] of [
        ['#/', 'home'],
        ['#/campaign', 'campaign'],
        ['#/modes', 'modes'],
        ['#/create', 'create'],
        ['#/settings', 'settings'],
        ['#/help', 'help']
      ]) {
        await goto(page, baseUrl, hash);
        await delay(name === 'home' ? 900 : 250);
        const layout = await evaluate(
          page,
          `(() => {
            const overflow = document.documentElement.scrollWidth - window.innerWidth;
            const small = [...document.querySelectorAll('a.button, button, a.pill, .icon-button, label.switch, .segmented span')]
              .filter((el) => el.offsetParent !== null)
              .map((el) => el.getBoundingClientRect())
              .filter((r) => r.width > 0 && (r.height < 40 || r.width < 40));
            return { overflow, smallTargets: small.length };
          })()`
        );
        check(`${label} ${name}: no horizontal scroll`, layout.overflow <= 1, layout);
        check(`${label} ${name}: touch targets ≥ 40px`, layout.smallTargets === 0, layout);
        await screenshot(page, `${label}-${name}`);
      }
    }
    await setViewport(page, 1440, 900);
  }

  if (runs('ui')) {
    // ---------------------------------------------------------------- campaign play
    console.log('Campaign');
    await goto(page, baseUrl, '#/play/campaign/1');
    const playing = await waitFor(
      page,
      `${GAME} && !${GAME}.isDemo() && document.querySelector('.hud-score') !== null`
    );
    check('campaign level starts from the URL', playing);
    await delay(600);
    const waiting = await evaluate(page, `!document.querySelector('.launch-hint').hidden`);
    check('launch hint shows before the first launch', waiting);
    await evaluate(page, `document.querySelector('.play-stage').focus(); true`);
    await key(page, ' ', 'Space', 32);
    const launched = await waitFor(page, `document.querySelector('.launch-hint').hidden`, 4000);
    check('Space launches the ball', launched);
    await screenshot(page, 'desktop-play');

    await key(page, 'Escape', 'Escape', 27);
    const pausedDialog = await waitFor(
      page,
      `document.querySelector('.dialog') !== null && window.__bounceForge.scene.isPaused('GameScene')`,
      4000
    );
    check('Escape pauses the game and opens the pause menu', pausedDialog);
    await screenshot(page, 'desktop-pause');
    await key(page, 'Escape', 'Escape', 27);
    const resumed = await waitFor(
      page,
      `document.querySelector('.dialog') === null && window.__bounceForge.scene.isActive('GameScene')`,
      4000
    );
    check('Escape resumes', resumed);

    // A lost life costs score before the level is cleared.
    const penalty = await evaluate(
      page,
      `(() => { const s = ${GAME}; s.scoreSystem.addBonus(5000); const before = s.scoreSystem.snapshot().score; s.loseLife(); return { before, after: s.scoreSystem.snapshot().score, lost: s.livesLost }; })()`
    );
    check(
      'losing a life costs a tenth of the score',
      penalty.after === penalty.before - 500 && penalty.lost === 1,
      penalty
    );
    await delay(800);
    await evaluate(
      page,
      `(() => { const s = ${GAME}; s.bricks.getChildren().filter((b) => b.active && b.isBreakable).forEach((b) => s.damageBrick(b, 99, 0)); return true; })()`
    );
    const victory = await waitFor(
      page,
      `document.querySelector('.dialog.is-victory')?.textContent`,
      30000
    );
    check('clearing the level shows the victory screen', victory);
    await screenshot(page, 'desktop-victory');
    const unlocked = await evaluate(
      page,
      `JSON.parse(localStorage.getItem('bounce-forge.save.v1')).levelMedals['0'] !== undefined`
    );
    check('victory is saved', unlocked);
    const resultInfo = await evaluate(
      page,
      `({ medal: Boolean(document.querySelector('.dialog .result-medal .medal')), challenges: document.querySelectorAll('.dialog .result-challenges .challenge-row').length, breakdown: document.querySelectorAll('.dialog .result-breakdown dl > div').length, penalties: document.querySelector('.dialog .result-breakdown .is-negative') !== null, flawless: document.querySelector('.dialog .result-challenges .pip-flawless')?.classList.contains('is-done') })`
    );
    check(
      'the result shows the medal, the 3 challenges and the score breakdown',
      resultInfo.medal &&
        resultInfo.challenges === 3 &&
        resultInfo.breakdown >= 2 &&
        resultInfo.penalties &&
        resultInfo.flawless === false,
      resultInfo
    );

    // Defeat on the phone layout.
    await setViewport(page, 360, 800);
    await goto(page, baseUrl, '#/play/campaign/2');
    await waitFor(page, `${GAME} && !${GAME}.isDemo() && ${GAME}.getSession().levelIndex === 1`);
    await delay(500);
    await screenshot(page, 'phone-play');
    await evaluate(
      page,
      `(() => { const s = ${GAME}; s.lives = 1; s.loseLife(); return true; })()`
    );
    const defeat = await waitFor(
      page,
      `document.querySelector('.dialog.is-defeat')?.textContent`,
      30000
    );
    check('losing the last life shows the defeat screen', defeat);
    await screenshot(page, 'phone-defeat');
    await setViewport(page, 1440, 900);

    // ---------------------------------------------------------------- endless
    console.log('Endless');
    await goto(page, baseUrl, '#/play/endless');
    await waitFor(page, `${GAME} && ${GAME}.getSession().mode === 'endless'`);
    for (let wave = 1; wave <= 3; wave += 1) {
      await waitFor(
        page,
        `${GAME}.getSession().wave === ${wave} && ${GAME}.bricks.getChildren().length > 0`,
        30000
      );
      await evaluate(
        page,
        `(() => { const s = ${GAME}; s.bricks.getChildren().filter((b) => b.active && b.isBreakable).forEach((b) => s.damageBrick(b, 99, 0)); return true; })()`
      );
    }
    const wave4 = await waitFor(
      page,
      `${GAME}.getSession().wave === 4 && ${GAME}.getSession().carry?.score > 0`,
      30000
    );
    check('endless chains waves and carries the score', wave4);
    await evaluate(
      page,
      `(() => { const s = ${GAME}; s.lives = 1; s.loseLife(); return true; })()`
    );
    await waitFor(page, `document.querySelector('.dialog.is-defeat')`, 30000);
    const endlessRecord = await evaluate(
      page,
      `JSON.parse(localStorage.getItem('bounce-forge.save.v1')).records.endless`
    );
    check(
      'endless record saved separately',
      endlessRecord?.bestWave === 3 && endlessRecord.bestScore > 0,
      endlessRecord
    );

    // ---------------------------------------------------------------- daily
    console.log('Daily');
    const dailyLayout = async () => {
      await goto(page, baseUrl, '#/');
      await goto(page, baseUrl, '#/play/daily');
      await waitFor(
        page,
        `${GAME} && ${GAME}.getSession().mode === 'daily' && ${GAME}.bricks.getChildren().length > 0`
      );
      return evaluate(
        page,
        `${GAME}.bricks.getChildren().map((b) => b.spec.id + b.spec.kind).join('|')`
      );
    };
    const first = await dailyLayout();
    const second = await dailyLayout();
    check('daily challenge is reproducible', first && first === second);
    const dailyKey = await evaluate(page, `${GAME}.getSession().dateKey`);
    check(
      'daily challenge uses the UTC date',
      dailyKey === new Date().toISOString().slice(0, 10),
      dailyKey
    );

    // ---------------------------------------------------------------- stress
    console.log('Stress');
    await goto(page, baseUrl, '#/play/campaign/1');
    await waitFor(page, `${GAME} && !${GAME}.isDemo()`);
    await evaluate(
      page,
      `(() => { const s = ${GAME}; s.launchAttachedBalls(); for (let i = 0; i < 120; i += 1) s.createBall(false); return true; })()`
    );
    await delay(2500);
    const balls = await evaluate(page, `${GAME}.ballManager.getStats().activeCount`);
    check('96-ball cap holds under stress', balls > 0 && balls <= 96, balls);
    for (let i = 0; i < 20; i += 1) {
      await evaluate(
        page,
        `${GAME}.scene.restart({ mode: 'campaign', levelIndex: ${i % 3} }); true`
      );
      await delay(120);
    }
    await delay(800);
    const afterRestarts = await evaluate(
      page,
      `({ canvases: document.querySelectorAll('canvas:not([data-level])').length, children: ${GAME}.children.list.length, active: window.__bounceForge.scene.isActive('GameScene') })`
    );
    check(
      '20 restarts keep a single canvas and a running scene',
      afterRestarts.canvases === 1 && afterRestarts.active,
      afterRestarts
    );
    // Measure on the same level as the follow-up restarts: levels have different brick counts.
    await evaluate(page, `${GAME}.scene.restart({ mode: 'campaign', levelIndex: 0 }); true`);
    await delay(800);
    const childrenBaseline = await evaluate(page, `${GAME}.children.list.length`);
    for (let i = 0; i < 5; i += 1) {
      await evaluate(page, `${GAME}.scene.restart({ mode: 'campaign', levelIndex: 0 }); true`);
      await delay(200);
    }
    await delay(600);
    const childrenAfter = await evaluate(page, `${GAME}.children.list.length`);
    check(
      'restarts do not accumulate display objects',
      Math.abs(childrenAfter - childrenBaseline) < 50,
      { childrenBaseline, childrenAfter }
    );
  }
  // ---------------------------------------------------------------- sharing with Unicode
  if (runs('levels-a') || runs('levels-b')) {
    // ---------------------------------------------------------------- whole campaign
    console.log('Campaign levels');
    const stuck = [];
    const firstLevel = SHARD === 'levels-b' ? 15 : 0;
    const lastLevel = SHARD === 'levels-a' ? 15 : 30;
    for (let index = firstLevel; index < lastLevel; index += 1) {
      // Let any restart still pending from a previous step finish before starting a new one.
      await waitFor(
        page,
        `${GAME} && window.__bounceForge.scene.isActive('GameScene') && ${GAME}.gameTime > 150`,
        10000
      );
      await evaluate(
        page,
        `(() => { window.__smokeBricks = ${GAME}.bricks; ${GAME}.scene.restart({ mode: 'campaign', levelIndex: ${index} }); return true; })()`
      );
      // Slow CI runners: measure only once the requested level is really running.
      await waitFor(
        page,
        `${GAME} && ${GAME}.bricks !== window.__smokeBricks && ${GAME}.getSession().levelIndex === ${index} && ${GAME}.getBricks().length > 0 && window.__bounceForge.scene.isActive('GameScene')`,
        10000
      );
      await delay(100);
      const before = await evaluate(
        page,
        `(() => { const s = ${GAME}; s.setAutopilot(true); s.launchAttachedBalls(); for (let i = 0; i < 12; i += 1) s.createBall(false); const low = s.getBricks().reduce((max, b) => Math.max(max, b.box.bottom), 0); s.ballManager.getActiveBalls().forEach((b, i) => { b.y = Math.min(1500, low + 40); b.x = 180 + ((i * 61) % 720); b.vx = (i % 2 ? 1 : -1) * 120; b.vy = -620; b.speed = 632; }); window.__smokeStart = s.gameTime; return s.getBricks().reduce((sum, b) => sum + b.remainingHitPoints, 0); })()`
      );
      // Give every level the same amount of game time, whatever the runner's frame rate.
      // Balls start just under the bricks, so a short slice of game time is enough.
      await waitFor(page, `${GAME}.gameTime > window.__smokeStart + 1400`, 15000);
      const after = await evaluate(
        page,
        `({ left: ${GAME}.getBricks().reduce((sum, b) => sum + b.remainingHitPoints, 0), active: window.__bounceForge.scene.isActive('GameScene'), level: ${GAME}.getSession().levelIndex })`
      );
      if (!after.active || after.level !== index || !(after.left < before)) {
        stuck.push({ ...after, level: index + 1, before });
      }
    }
    check(
      `campaign levels ${firstLevel + 1}-${lastLevel} load, play and make progress`,
      stuck.length === 0,
      stuck
    );
  }
  if (runs('gameplay')) {
    // ---------------------------------------------------------------- power-ups
    console.log('Power-ups');
    await goto(page, baseUrl, '#/play/campaign/2');
    await waitFor(page, `${GAME} && !${GAME}.isDemo() && ${GAME}.getSession().levelIndex === 1`);
    const allPowerUps = [
      'multiBall',
      'splitBall',
      'widePaddle',
      'stickyPaddle',
      'extraLife',
      'fireBall',
      'explosiveBall',
      'bigBall',
      'laserPaddle',
      'magnet',
      'shield',
      'slowMotion',
      'fever',
      'turbo',
      'shrinkPaddle'
    ];
    await evaluate(
      page,
      `(() => { const s = ${GAME}; s.launchAttachedBalls(); ${JSON.stringify(allPowerUps)}.forEach((type) => s.applyPowerUp(type)); s.launchAttachedBalls(); return true; })()`
    );
    await delay(2500);
    const powered = await evaluate(
      page,
      `({ rows: document.querySelectorAll('.bonus-list .bonus-row').length, balls: ${GAME}.ballManager.getStats().activeCount, active: window.__bounceForge.scene.isActive('GameScene') })`
    );
    check(
      'every power-up applies without error and shows in the bonus panel',
      powered.rows >= 8 && powered.balls >= 1 && powered.active,
      powered
    );
    const pickup = await evaluate(
      page,
      `(() => new Promise((resolve) => { const s = ${GAME}; document.querySelectorAll('.toast').forEach((t) => t.remove()); s.spawnSpecificPowerUp(540, 900, 'magnet'); s.collectPowerUp(s.powerUps.find((p) => p.active)); setTimeout(() => { const card = document.querySelector('.hud-right .bonus-card'); resolve({ visible: card && !card.hidden, title: card?.querySelector('.bonus-card-title')?.textContent ?? '', toasts: document.querySelectorAll('.toast').length }); }, 200); }))()`
    );
    check(
      'catching a capsule shows a card in the bonus panel, not a toast',
      pickup.visible && pickup.title.length > 0 && pickup.toasts === 0,
      pickup
    );
    const hovered = await evaluate(
      page,
      `(() => { const row = document.querySelector('.bonus-list .bonus-row[data-effect="fireBall"]'); row.dispatchEvent(new MouseEvent('mouseenter')); const card = document.querySelector('.hud-right .bonus-card'); return { visible: !card.hidden, text: card.querySelector('.bonus-card-text')?.textContent ?? '' }; })()`
    );
    check(
      'hovering a power-up explains it in the bonus panel',
      hovered.visible && hovered.text.length > 20,
      hovered
    );

    // ---------------------------------------------------------------- mechanisms
    console.log('Mechanisms');
    const mechRows = Array.from({ length: 58 }, () => '.'.repeat(36));
    const put = (row, col, text) => {
      mechRows[row] = (
        mechRows[row].slice(0, col) +
        text +
        mechRows[row].slice(col + text.length)
      ).slice(0, 36);
    };
    put(4, 2, 'T');
    put(4, 30, 'T');
    put(8, 10, 'K.GGG');
    put(10, 5, 'C.R.I');
    put(10, 15, 'M');
    put(10, 20, 'O');
    put(10, 24, 'FFFF');
    put(12, 0, '1'.repeat(36));
    await evaluate(
      page,
      `(() => { window.__bounceForge.scene.getScene('GameScene').scene.restart({ mode: 'creative', levelIndex: 0, draft: { name: 'Mech', rows: ${JSON.stringify(mechRows)} } }); return true; })()`
    );
    await delay(900);
    const B = `${GAME}.getBricks()`;
    const kinds = await evaluate(page, `[...new Set(${B}.map((b) => b.kind))].sort()`);
    check(
      'all nine mechanisms load',
      [
        'bumper',
        'crystal',
        'fuse',
        'gate',
        'invisible',
        'key',
        'mover',
        'phoenix',
        'teleporter'
      ].every((k) => kinds.includes(k)),
      kinds
    );
    const ghost = await evaluate(
      page,
      `(() => { const s = ${GAME}; const g = s.getBricks().find((b) => b.kind === 'invisible'); const before = g.alpha; s.damageBrick(g, 1); return { before, active: g.active, after: g.alpha }; })()`
    );
    check(
      'ghost brick is hidden, then revealed by the first hit',
      ghost.before < 0.2 && ghost.active && ghost.after === 1,
      ghost
    );
    await evaluate(
      page,
      `(() => { const s = ${GAME}; s.damageBrick(s.getBricks().find((b) => b.kind === 'key'), 1); return true; })()`
    );
    await waitFor(page, `${B}.filter((b) => b.kind === 'gate').length === 0`, 8000);
    const gatesLeft = await evaluate(page, `${B}.filter((b) => b.kind === 'gate').length`);
    check('breaking the last key opens every gate', gatesLeft === 0, gatesLeft);
    await evaluate(
      page,
      `(() => { const s = ${GAME}; s.damageBrick(s.getBricks().find((b) => b.kind === 'fuse'), 99); return true; })()`
    );
    await waitFor(
      page,
      `${B}.filter((b) => b.kind === 'fuse').length === 0 && ${GAME}.explosionsTriggered >= 1`,
      10000
    );
    const fuses = await evaluate(
      page,
      `({ left: ${B}.filter((b) => b.kind === 'fuse').length, explosions: ${GAME}.explosionsTriggered })`
    );
    check(
      'a fuse burns down the whole line and explodes',
      fuses.left === 0 && fuses.explosions >= 1,
      fuses
    );
    await evaluate(
      page,
      `(() => { const s = ${GAME}; s.damageBrick(s.getBricks().find((b) => b.kind === 'phoenix'), 1); s.gameTime += 9000; return true; })()`
    );
    await waitFor(page, `${B}.filter((b) => b.kind === 'phoenix').length === 1`, 8000);
    const phoenix = await evaluate(page, `${B}.filter((b) => b.kind === 'phoenix').length`);
    check('a phoenix brick comes back', phoenix === 1, phoenix);
    const moverCols = await evaluate(
      page,
      `new Promise((resolve) => { const seen = new Set(); const started = Date.now(); const id = setInterval(() => { const m = ${B}.find((b) => b.kind === 'mover'); if (m) seen.add(m.col); if (seen.size >= 2 || Date.now() - started > 8000) { clearInterval(id); resolve([...seen]); } }, 100); })`
    );
    check('a moving brick slides along its row', moverCols.length >= 2, moverCols);
    const teleported = await evaluate(
      page,
      `(() => new Promise((resolve) => { const s = ${GAME}; s.launchAttachedBalls(); const [a, b] = s.getBricks().filter((x) => x.kind === 'teleporter').sort((p, q) => p.col - q.col); const ball = s.ballManager.getActiveBalls()[0]; ball.setPosition(a.x, a.y + 70); ball.vx = 0; ball.vy = -700; ball.speed = 700; const started = Date.now(); const id = setInterval(() => { if (Math.abs(ball.x - b.x) < 60 || Date.now() - started > 4000) { clearInterval(id); resolve({ x: ball.x, exitX: b.x, entryX: a.x }); } }, 50); }))()`
    );
    check(
      'a teleporter sends the ball out of its twin',
      Math.abs(teleported.x - teleported.exitX) < 60,
      teleported
    );
  }
  if (runs('ui') || runs('gameplay')) {
    if (runs('gameplay')) {
      // ---------------------------------------------------------------- workshop & editor
      console.log('Workshop');
      await goto(page, baseUrl, '#/create');
      await waitFor(page, `document.querySelectorAll('.start-card').length === 3`);
      await evaluate(page, `document.querySelector('.start-card').click(); true`);
      const editorOpen = await waitFor(
        page,
        `document.querySelector('.editor-canvas') !== null`,
        6000
      );
      check('Surprise opens the editor on a generated level', editorOpen);
      const surprise = await evaluate(
        page,
        `({ dirty: document.querySelector('.editor-status').classList.contains('is-dirty'), name: document.querySelector('.editor-name').value, hash: location.hash, stats: document.querySelector('.editor-stats').textContent })`
      );
      check(
        'surprise level is a playable unsaved draft',
        surprise.dirty &&
          /^#\/create\/edit\/\d+$/.test(surprise.hash) &&
          !/^0 /.test(surprise.stats),
        surprise
      );
      const slotIndex = Number(surprise.hash.split('/').pop());
      const painted = await evaluate(
        page,
        `(() => {
        const canvas = document.querySelector('.editor-canvas');
        const rect = canvas.getBoundingClientRect();
        const x = rect.left + rect.width * (1.5 / 36);
        const y = rect.top + rect.height * ((40.5 * 22) / (58 * 22 + 96));
        const before = document.querySelector('.editor-stats').textContent;
        const opts = { bubbles: true, pointerId: 7, button: 0, buttons: 1, clientX: x, clientY: y, pointerType: 'mouse' };
        canvas.dispatchEvent(new PointerEvent('pointerdown', opts));
        canvas.dispatchEvent(new PointerEvent('pointerup', { ...opts, buttons: 0 }));
        return new Promise((resolve) => requestAnimationFrame(() => resolve({ before, after: document.querySelector('.editor-stats').textContent, undo: !document.querySelector('[aria-label^="${'Annuler'}"]').disabled })));
      })()`
      );
      check(
        'painting adds bricks and can be undone',
        painted.before !== painted.after && painted.undo,
        painted
      );
      await evaluate(
        page,
        `(() => { [...document.querySelectorAll('.editor-side .button')].find((b) => b.textContent.includes('Réglages du niveau')).click(); const toggles = document.querySelectorAll('.settings-toggle input'); toggles[toggles.length - 1].click(); document.querySelector('.dialog .button-primary').click(); return true; })()`
      );
      await delay(500);
      const settingsDraft = await evaluate(
        page,
        `JSON.parse(localStorage.getItem('bounce-forge.editor-draft.v1.${slotIndex}') || '{}').options`
      );
      check('level settings land in the draft', settingsDraft?.storm === true, settingsDraft);
      await evaluate(
        page,
        `[...document.querySelectorAll('.editor-bar .button')].find((b) => b.textContent.includes('Tester')).click(); true`
      );
      const testing = await waitFor(
        page,
        `${GAME} && !${GAME}.isDemo() && ${GAME}.getSession().mode === 'creative' && ${GAME}.getSession().draft?.options?.storm === true`,
        10000
      );
      const slotUntouched = await evaluate(
        page,
        `!JSON.parse(localStorage.getItem('bounce-forge.save.v1')).creativeLevelSlots['${slotIndex}']`
      );
      check('Test plays the draft without saving it', testing && slotUntouched, {
        testing,
        slotUntouched
      });
      await goto(page, baseUrl, `#/create/edit/${slotIndex}`);
      await waitFor(page, `document.querySelector('.editor-canvas') !== null`);
      const restored = await evaluate(
        page,
        `({ dirty: document.querySelector('.editor-status').classList.contains('is-dirty'), stats: document.querySelector('.editor-stats').textContent })`
      );
      check(
        'returning to the editor restores the draft',
        restored.dirty && restored.stats === painted.after,
        restored
      );
      await evaluate(
        page,
        `[...document.querySelectorAll('.editor-bar .button')].find((b) => b.textContent.includes('Enregistrer')).click(); true`
      );
      const saved = await waitFor(
        page,
        `Boolean(JSON.parse(localStorage.getItem('bounce-forge.save.v1')).creativeLevelSlots['${slotIndex}']) && !document.querySelector('.editor-status').classList.contains('is-dirty') && localStorage.getItem('bounce-forge.editor-draft.v1.${slotIndex}') === null`,
        4000
      );
      check('Save stores the level and clears the draft', saved);
      await goto(page, baseUrl, '#/create');
      const listed = await waitFor(
        page,
        `document.querySelectorAll('.creation-card:not(.is-draft)').length === 1`,
        4000
      );
      check('saved level appears in the workshop', listed);

      console.log('Community');
      await goto(page, baseUrl, '#/community');
      const library = await waitFor(
        page,
        `(() => { const status = document.querySelector('.community .community-status'); const cards = document.querySelectorAll('.community-card').length; if (!status) return false; const text = status.textContent; return (cards > 0 || (text && !text.endsWith('…'))) ? { cards, text } : false; })()`,
        15000
      );
      check('the community library loads (or explains why not)', Boolean(library), library);
    }
    if (runs('ui')) {
      console.log('Trophies');
      await goto(page, baseUrl, '#/trophies');
      const trophyRoom = await waitFor(
        page,
        `document.querySelectorAll('.trophy-grid .trophy').length >= 25 && document.querySelectorAll('.trophy.is-unlocked').length >= 1`,
        6000
      );
      check('the trophy room lists every trophy and the ones already earned', trophyRoom);
    }
    if (runs('gameplay')) {
      console.log('Sharing');
      const name = 'Forgé à chaud 🔥 ñ';
      await goto(page, baseUrl, '#/create');
      await waitFor(page, `document.querySelector('#import-code')`);
      await evaluate(
        page,
        `(() => { const area = document.querySelector('#import-code'); area.value = ${JSON.stringify(encodeBf2({ v: 2, name, rows: oneBrickRows() }))}; area.form.requestSubmit(); return true; })()`
      );
      const imported = await waitFor(
        page,
        `[...document.querySelectorAll('.creation-card .card-title')].some((n) => n.textContent === ${JSON.stringify(name)})`,
        4000
      );
      check('BF2 import keeps accents and emoji', imported);
      await evaluate(
        page,
        `(() => { const area = document.querySelector('#import-code'); area.value = 'BF1:' + btoa(JSON.stringify({ v: 1, name: 'Legacy', rows: ${JSON.stringify(oneBrickRows())} })); area.form.requestSubmit(); return true; })()`
      );
      const legacy = await waitFor(
        page,
        `[...document.querySelectorAll('.creation-card .card-title')].some((n) => n.textContent === 'Legacy')`,
        4000
      );
      check('BF1 legacy codes still import', legacy);
      await evaluate(
        page,
        `(() => { const area = document.querySelector('#import-code'); area.value = 'nope'; area.form.requestSubmit(); return true; })()`
      );
      const errorText = await waitFor(
        page,
        `document.querySelector('.form-status.is-error')?.textContent`,
        3000
      );
      check('invalid codes show a readable message', errorText && errorText.length > 10, errorText);
      await screenshot(page, 'desktop-create');
    }
  }
  // ---------------------------------------------------------------- network hygiene
  const apiCalls = requests.filter((url) => url.includes('/api/'));
  check('public build makes no admin /api request', apiCalls.length === 0, apiCalls);
  check('no missing asset (4xx/5xx)', failedRequests.length === 0, failedRequests);
  check('no uncaught exception', page.exceptions.length === 0, page.exceptions.slice(0, 5));
  check('no console error', page.consoleErrors.length === 0, page.consoleErrors.slice(0, 5));
} catch (error) {
  failures.push(String(error?.stack ?? error));
  console.error(error);
} finally {
  page?.close();
  await stopProcess(browser);
  await stopProcess(preview);
  await rm(userDataDir, { recursive: true, force: true }).catch(() => undefined);
  await mkdir(outDir, { recursive: true });
  await writeFile(`${outDir}/report.json`, JSON.stringify({ results, failures }, null, 2));
}

console.log(`\n${results.filter((r) => r.ok).length}/${results.length} checks passed.`);
if (failures.length > 0) {
  console.error(`FAILED: ${failures.length} check(s). Screenshots in artifacts/smoke/.`);
  process.exit(1);
}
