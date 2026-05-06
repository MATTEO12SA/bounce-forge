#!/usr/bin/env node
// Long-running gameplay test to catch ball-sticking/tunneling bugs.
// Runs the game for a configurable duration and captures all console output.

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import http from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';

const root = process.cwd();
const args = new Set(process.argv.slice(2));
const visible = args.has('--visible') || args.has('--headed');
const durationSecs = Number(process.env.BUG_HUNT_DURATION ?? '40');
const edgeCandidates = [
  process.env.BROWSER_TEST_EDGE_PATH,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe'
].filter(Boolean);
const browserPath = edgeCandidates.find((c) => existsSync(c));
const userDataDir = `${root}/.edge-bughunt-test-profile`;
const cdpPort = Number(process.env.BROWSER_TEST_CDP_PORT ?? 9229);

if (!browserPath) {
  console.error('No browser found.');
  process.exit(1);
}

function requestText(url, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.setTimeout(1500, () => req.destroy(new Error(`timeout ${url}`)));
    req.end();
  });
}
async function requestJson(url, m = 'GET') {
  return JSON.parse(await requestText(url, m));
}
async function waitForHttp(url, ms = 12000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try {
      await requestText(url);
      return;
    } catch {
      await delay(250);
    }
  }
  throw new Error(`Timed out: ${url}`);
}

function createCdpClient(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  const consoleEvents = [];

  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m);
      pending.delete(m.id);
      return;
    }
    if (m.method === 'Runtime.exceptionThrown') {
      consoleEvents.push({
        type: 'exception',
        text: m.params.exceptionDetails?.text,
        description: m.params.exceptionDetails?.exception?.description,
        ts: Date.now()
      });
    }
    if (m.method === 'Runtime.consoleAPICalled') {
      const text = m.params.args?.map((a) => a.value ?? a.description).join(' ');
      consoleEvents.push({
        type: m.params.type,
        text,
        ts: Date.now()
      });
    }
  });

  return new Promise((resolve, reject) => {
    ws.addEventListener('open', () => {
      resolve({
        send(method, params = {}) {
          const callId = ++id;
          ws.send(JSON.stringify({ id: callId, method, params }));
          return new Promise((done, fail) => {
            const timer = setTimeout(() => {
              pending.delete(callId);
              fail(new Error(`CDP timeout ${method}`));
            }, 70000);
            pending.set(callId, (m) => {
              clearTimeout(timer);
              if (m.error) fail(new Error(`${method}: ${m.error.message}`));
              else done(m);
            });
          });
        },
        close() {
          ws.close();
        },
        consoleEvents
      });
    });
    ws.addEventListener('error', reject);
  });
}

async function evalInPage(page, expr) {
  const r = await page.send('Runtime.evaluate', {
    expression: expr,
    returnByValue: true,
    awaitPromise: true
  });
  if (r.result.exceptionDetails) {
    throw new Error(`Eval failed: ${r.result.exceptionDetails.text}`);
  }
  return r.result.result.value;
}

async function stopProcess(child) {
  if (!child || child.exitCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([
    new Promise((r) => child.once('exit', () => r())),
    delay(2500)
  ]);
  if (child.exitCode === null) {
    spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    await delay(500);
  }
}

async function removeProfile() {
  for (let i = 0; i < 6; i++) {
    try {
      await rm(userDataDir, { recursive: true, force: true });
      return;
    } catch (e) {
      if (e?.code !== 'EBUSY' && e?.code !== 'EPERM') throw e;
      await delay(400);
    }
  }
}

let server, browser, page;
try {
  await removeProfile();

  let targetUrl = null;
  try {
    const html = await requestText('http://localhost:5173/');
    if (html.includes('Bounce Forge')) targetUrl = 'http://localhost:5173/';
  } catch {
    /* no existing dev server */
  }

  if (!targetUrl) {
    server = spawn(process.execPath, ['scripts/start-dev.mjs'], {
      cwd: root,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PORT: '5173' }
    });
    server.stdout.on('data', (d) => process.stdout.write(d));
    server.stderr.on('data', (d) => process.stderr.write(d));
    targetUrl = 'http://localhost:5173/';
    await waitForHttp(targetUrl);
  }
  console.log(`Using ${targetUrl}`);

  browser = spawn(
    browserPath,
    [
      ...(visible ? [] : ['--headless=new']),
      '--disable-gpu',
      '--no-first-run',
      '--disable-extensions',
      '--mute-audio',
      `--remote-debugging-port=${cdpPort}`,
      `--user-data-dir=${userDataDir}`,
      '--window-size=720,1280',
      'about:blank'
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] }
  );

  await waitForHttp(`http://localhost:${cdpPort}/json/version`);
  const target = await requestJson(`http://localhost:${cdpPort}/json/new`, 'PUT');
  page = await createCdpClient(target.webSocketDebuggerUrl);
  await page.send('Runtime.enable');
  await page.send('Page.enable');
  await page.send('Page.navigate', { url: targetUrl });
  await delay(4500);

  await evalInPage(page, `localStorage.clear(); 'cleared';`);

  // Boot into GameScene
  const ready = await evalInPage(
    page,
    `(async () => {
      const start = Date.now();
      while (Date.now() - start < 8000) {
        const game = window.__bounceForge;
        const sm = game && game.scene;
        if (sm) {
          const list = sm.scenes.map((s) => s.scene.key);
          if (list.includes('GameScene')) {
            list.forEach((k) => sm.stop(k));
            sm.start('GameScene', { levelIndex: 0 });
            return { ok: true };
          }
        }
        await new Promise((r) => setTimeout(r, 100));
      }
      return { ok: false };
    })()`
  );
  if (!ready.ok) throw new Error('GameScene never ready');

  await delay(800);

  // Set up gameplay: launch ball, then nudge paddle randomly to keep ball in play.
  await evalInPage(
    page,
    `(() => {
      const game = window.__bounceForge;
      const scene = game.scene.getScene('GameScene');
      scene.audioSystem?.setEnabled(false);
      // Force-launch attached balls
      scene.launchAttachedBalls?.();
      // Each frame, move paddle toward the lowest active ball X
      window.__autoplay = true;
      const tick = () => {
        if (!window.__autoplay) return;
        try {
          const balls = scene.getBalls?.() ?? [];
          if (balls.length === 0) {
            // Respawn if all balls lost
            scene.lives = 99;
            scene.respawning = false;
            scene.createBall?.(true);
            scene.launchAttachedBalls?.();
          } else {
            // Track the lowest ball with the paddle
            const lowest = balls.reduce((acc, b) => (b.y > acc.y ? b : acc), balls[0]);
            scene.paddle?.setCenterX?.(lowest.x);
          }
        } catch (e) { console.error('autoplay tick error: ' + e.message); }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      return true;
    })()`
  );

  console.log(`Playing for ${durationSecs}s, watching for bug logs…`);
  await delay(durationSecs * 1000);

  // Snapshot final state
  const finalState = await evalInPage(
    page,
    `(() => {
      window.__autoplay = false;
      const game = window.__bounceForge;
      const scene = game.scene.getScene('GameScene');
      const balls = scene.getBalls?.() ?? [];
      return {
        ballCount: balls.length,
        ballPositions: balls.map(b => ({ x: Math.round(b.x), y: Math.round(b.y), vx: Math.round(b.arcadeBody.velocity.x), vy: Math.round(b.arcadeBody.velocity.y) })),
        bricks: scene.getBricks?.()?.length ?? 0,
        lives: scene.lives,
        score: scene.scoreSystem?.snapshot?.()?.score ?? 0
      };
    })()`
  );

  // Filter and group console events
  const events = page.consoleEvents;
  const ourLogs = events.filter((e) => /^\[(BALL|GAME)/.test(e.text || ''));
  const errors = events.filter((e) => e.type === 'error' || e.type === 'exception');
  const warnings = events.filter((e) => e.type === 'warning' || e.type === 'warn');

  const stickingEvents = ourLogs.filter((e) => e.text?.includes('STICKING'));
  const oscillatingEvents = ourLogs.filter((e) => e.text?.includes('OSCILLATING'));
  const stuckEvents = ourLogs.filter((e) => e.text?.includes('STUCK'));
  const tunnelEvents = ourLogs.filter((e) => e.text?.includes('TUNNELED'));

  console.log('\n=== BUG HUNT REPORT ===');
  console.log(`Final state: ${JSON.stringify(finalState, null, 2)}`);
  console.log(`Total console events captured: ${events.length}`);
  console.log(`Stickup detections: ${stickingEvents.length}`);
  console.log(`Oscillating detections: ${oscillatingEvents.length}`);
  console.log(`Stuck-and-kicked: ${stuckEvents.length}`);
  console.log(`Tunneled-through-wall: ${tunnelEvents.length}`);
  console.log(`Total errors: ${errors.length}, warnings: ${warnings.length}`);

  if (tunnelEvents.length > 0) {
    console.log('\n--- TUNNEL EVENTS (first 5) ---');
    tunnelEvents.slice(0, 5).forEach((e) => console.log(e.text));
  }
  if (stuckEvents.length > 0) {
    console.log('\n--- STUCK KICKS (first 5) ---');
    stuckEvents.slice(0, 5).forEach((e) => console.log(e.text));
  }
  if (oscillatingEvents.length > 0) {
    console.log('\n--- OSCILLATING (first 5) ---');
    oscillatingEvents.slice(0, 5).forEach((e) => console.log(e.text));
  }
  if (errors.length > 0) {
    console.log('\n--- OTHER ERRORS (first 5) ---');
    errors.slice(0, 5).forEach((e) => console.log(JSON.stringify(e)));
  }

  if (tunnelEvents.length > 0 || (oscillatingEvents.length > 0 && stuckEvents.length === 0)) {
    console.log('\n[VERDICT] BUG DETECTED — fixes did NOT fully resolve the issue.');
    process.exitCode = 1;
  } else if (stuckEvents.length > 0) {
    console.log('\n[VERDICT] Ball got pinned occasionally but escape kicked it free. Acceptable.');
  } else {
    console.log('\n[VERDICT] No sticking or tunneling events detected during gameplay.');
  }
} finally {
  page?.close?.();
  await stopProcess(browser);
  if (server) await stopProcess(server);
  await removeProfile();
}
