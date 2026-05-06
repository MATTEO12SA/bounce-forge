#!/usr/bin/env node
// Power-up balance diagnostic.
// Measures real roll distribution and forced pickup accumulation in a browser GameScene.

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';

const root = process.cwd();
const args = new Set(process.argv.slice(2));
const visible = args.has('--visible') || args.has('--headed');
const edgeCandidates = [
  process.env.BROWSER_TEST_EDGE_PATH,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe'
].filter(Boolean);
const browserPath = edgeCandidates.find((candidate) => existsSync(candidate));
const userDataDir = `${root}/.edge-powerup-diagnostic-profile`;
const cdpPort = Number(process.env.BROWSER_TEST_CDP_PORT ?? 9228);
const screenshotPath = 'powerup-diagnostic.png';

if (!browserPath) {
  console.error('No supported browser found. Install Edge/Chrome or set BROWSER_TEST_EDGE_PATH.');
  process.exit(1);
}

function requestText(url, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method }, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.setTimeout(1500, () => req.destroy(new Error(`timeout ${url}`)));
    req.end();
  });
}

async function requestJson(url, method = 'GET') {
  return JSON.parse(await requestText(url, method));
}

async function waitForHttp(url, timeoutMs = 12000) {
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

async function detectRunningDevServer() {
  for (const port of ['5173', '4173']) {
    const url = `http://localhost:${port}/`;

    try {
      const html = await requestText(url);

      if (html.includes('Bounce Forge') || html.includes('game-root')) {
        return url;
      }
    } catch {
      // Keep looking.
    }
  }

  return null;
}

function createCdpClient(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  const consoleErrors = [];

  ws.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);

    if (message.id && pending.has(message.id)) {
      pending.get(message.id)(message);
      pending.delete(message.id);
      return;
    }

    if (message.method === 'Runtime.exceptionThrown') {
      consoleErrors.push({
        type: 'exception',
        text: message.params.exceptionDetails?.text,
        description: message.params.exceptionDetails?.exception?.description
      });
    }

    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
      consoleErrors.push({
        type: 'console',
        text: message.params.args?.map((arg) => arg.value ?? arg.description).join(' ')
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
              fail(new Error(`CDP timeout: ${method}`));
            }, 70000);

            pending.set(callId, (message) => {
              clearTimeout(timer);

              if (message.error) {
                fail(new Error(`${method}: ${message.error.message}`));
              } else {
                done(message);
              }
            });
          });
        },
        close() {
          ws.close();
        },
        consoleErrors
      });
    });
    ws.addEventListener('error', reject);
  });
}

async function evalInPage(page, expression) {
  const result = await page.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true
  });

  if (result.result.exceptionDetails) {
    throw new Error(
      `Eval failed: ${result.result.exceptionDetails.text} ${
        result.result.exceptionDetails.exception?.description ?? ''
      }`
    );
  }

  return result.result.result.value;
}

async function stopProcessTree(child, signal) {
  if (!child || child.exitCode !== null) {
    return;
  }

  child.kill(signal);
  const exited = await Promise.race([
    new Promise((resolve) => child.once('exit', () => resolve(true))),
    delay(2500).then(() => false)
  ]);

  if (!exited && child.exitCode === null) {
    spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    await delay(800);
  }
}

async function removeTempProfile() {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      await rm(userDataDir, { recursive: true, force: true });
      return;
    } catch (error) {
      if (error?.code !== 'EBUSY' && error?.code !== 'EPERM') {
        throw error;
      }

      await delay(400);
    }
  }
}

let server;
let browser;
let page;

try {
  await removeTempProfile();

  let targetUrl = await detectRunningDevServer();

  if (targetUrl) {
    console.log(`Using existing dev server: ${targetUrl}`);
  } else {
    server = spawn(process.execPath, ['scripts/start-dev.mjs'], {
      cwd: root,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    server.stdout.on('data', (data) => process.stdout.write(data));
    server.stderr.on('data', (data) => process.stderr.write(data));
    targetUrl = 'http://localhost:5173/';
    await waitForHttp(targetUrl);
  }

  browser = spawn(
    browserPath,
    [
      ...(visible ? [] : ['--headless=new']),
      '--disable-gpu',
      '--no-first-run',
      '--disable-extensions',
      `--remote-debugging-port=${cdpPort}`,
      `--user-data-dir=${userDataDir}`,
      '--window-size=720,1280',
      'about:blank'
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] }
  );

  console.log(
    visible
      ? 'Opening a visible browser window for the power-up diagnostic.'
      : 'Running headless power-up diagnostic.'
  );

  await waitForHttp(`http://localhost:${cdpPort}/json/version`);
  const target = await requestJson(`http://localhost:${cdpPort}/json/new`, 'PUT');
  page = await createCdpClient(target.webSocketDebuggerUrl);
  await page.send('Runtime.enable');
  await page.send('Page.enable');
  await page.send('Page.navigate', { url: targetUrl });
  await delay(4500);

  await evalInPage(page, `localStorage.clear(); 'cleared';`);

  const ready = await evalInPage(
    page,
    `(async () => {
      const start = Date.now();
      while (Date.now() - start < 8000) {
        const game = window.__bounceForge;
        const sceneManager = game && game.scene;
        if (sceneManager) {
          const sceneList = sceneManager.scenes.map((scene) => scene.scene.key);
          if (sceneList.includes('GameScene')) {
            sceneList.forEach((key) => sceneManager.stop(key));
            sceneManager.start('GameScene', { levelIndex: 0 });
            return { ok: true, sceneList };
          }
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      return { ok: false };
    })()`
  );

  if (!ready.ok) {
    throw new Error(`GameScene never appeared: ${JSON.stringify(ready)}`);
  }

  await delay(900);

  const result = await evalInPage(
    page,
    `(async () => {
      const game = window.__bounceForge;
      const scene = game.scene.getScene('GameScene');
      scene.audioSystem?.setEnabled(false);
      const failures = [];
      const tests = [];

      const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const activeChildren = (group) => group.getChildren().filter((child) => child.active);
      const clearGroup = (group) => {
        group.getChildren().slice().forEach((child) => group.remove(child, true, true));
      };
      const round = (value) => Math.round(value * 1000) / 1000;

      const resetScene = () => {
        scene.activeTimers.forEach((timer) => timer.remove(false));
        scene.activeTimers.clear();
        scene.respawning = false;
        scene.ending = false;
        scene.lives = 3;
        clearGroup(scene.powerUps);
        clearGroup(scene.balls);
        clearGroup(scene.bricks);
        scene.paddle.resetWidth();
        scene.paddle.setCenterX(540);
        scene.hud.update(scene.buildHudState());
      };

      const createLaunchedBall = () => {
        const ball = scene.createBall(false);
        ball.x = scene.paddle.x;
        ball.y = scene.paddle.y - 90;
        ball.attached = false;
        ball.arcadeBody.updateFromGameObject();
        ball.arcadeBody.setVelocity(180, -420);
        scene.rememberBallPhysics?.(ball);
        return ball;
      };

      const createSingleBall = () => {
        clearGroup(scene.balls);
        scene.paddle.setCenterX(540);
        return createLaunchedBall();
      };

      const record = (name, passed, details) => {
        tests.push({ name, passed, details });
        if (!passed) {
          failures.push({ name, details });
        }
      };

      const snapshot = () => ({
        balls: scene.getBalls().length,
        paddleWidth: Math.round(scene.paddle.activeWidth * 10) / 10,
        powerUps: activeChildren(scene.powerUps).length,
        lives: scene.lives
      });

      const makeSeededRandom = (seed) => {
        let state = seed >>> 0;
        return () => {
          state += 0x6d2b79f5;
          let value = state;
          value = Math.imul(value ^ (value >>> 15), value | 1);
          value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
          return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
        };
      };

      const originalRandom = Math.random;
      Math.random = makeSeededRandom(0x51f15e);
      const counts = { multiBall: 0, splitBall: 0, widePaddle: 0, extraLife: 0, null: 0 };
      const rollCount = 20000;
      for (let index = 0; index < rollCount; index += 1) {
        const type = scene.powerUpSystem.roll(1) ?? 'null';
        counts[type] += 1;
      }
      Math.random = originalRandom;

      const ballBonusShare = round((counts.multiBall + counts.splitBall) / rollCount);
      const widePaddleShare = round(counts.widePaddle / rollCount);
      record('weighted rolls heavily favor ball bonuses', ballBonusShare >= 0.85 && ballBonusShare <= 0.92, {
        counts,
        ballBonusShare
      });
      record('widePaddle remains rare', widePaddleShare > 0 && widePaddleShare <= 0.06, {
        counts,
        widePaddleShare
      });

      resetScene();
      createSingleBall();
      const multiCounts = [scene.getBalls().length];
      for (let index = 0; index < 30; index += 1) {
        scene.applyPowerUp('multiBall');
        multiCounts.push(scene.getBalls().length);
      }
      const maxBallsReached = Math.max(...multiCounts);
      record('repeated multiBall reaches 40 without exceeding cap', scene.getBalls().length === 40 && maxBallsReached === 40, {
        maxBallsReached,
        final: snapshot(),
        multiCounts
      });

      resetScene();
      createSingleBall();
      const splitCounts = [scene.getBalls().length];
      for (let index = 0; index < 45; index += 1) {
        scene.applyPowerUp('splitBall');
        splitCounts.push(scene.getBalls().length);
      }
      record('repeated splitBall reaches 40 without exceeding cap', scene.getBalls().length === 40 && Math.max(...splitCounts) === 40, {
        maxBallsReached: Math.max(...splitCounts),
        final: snapshot(),
        splitCounts: splitCounts.slice(0, 12).concat(splitCounts.slice(-6))
      });

      resetScene();
      const source = createSingleBall();
      for (let index = 0; index < 4; index += 1) {
        createLaunchedBall();
      }
      const beforeSourceOnly = snapshot();
      scene.applyPowerUp('multiBall', source);
      record('multiBall clones only its source ball', beforeSourceOnly.balls === 5 && scene.getBalls().length === 7, {
        before: beforeSourceOnly,
        after: snapshot()
      });

      resetScene();
      createSingleBall();
      for (let index = 0; index < 25; index += 1) {
        scene.applyPowerUp('multiBall');
      }
      scene.applyPowerUp('multiBall');
      record('multiBall cap never exceeds 40', scene.getBalls().length === 40, {
        after: snapshot()
      });

      resetScene();
      createSingleBall();
      scene.applyPowerUp('widePaddle');
      await wait(60);
      const wideActive = Math.abs(scene.paddle.activeWidth - 317.4) <= 2;
      scene.activeTimers.get('widePaddle')?.remove(false);
      scene.activeTimers.delete('widePaddle');
      scene.refreshPaddleWidth();
      record('widePaddle still works and expires', wideActive && Math.abs(scene.paddle.activeWidth - 230) <= 1, {
        after: snapshot()
      });

      return {
        ok: failures.length === 0,
        summary: {
          ballBonusShare,
          widePaddleShare,
          maxBallsReached
        },
        tests,
        failures,
        final: snapshot()
      };
    })()`
  );

  console.log('--- Power-up Diagnostic Result ---');
  console.log(JSON.stringify(result, null, 2));

  const screenshot = await page.send('Page.captureScreenshot', { format: 'png' });
  await writeFile(screenshotPath, Buffer.from(screenshot.result.data, 'base64'));
  console.log(`Screenshot: ${screenshotPath}`);

  if (!result.ok) {
    console.error('FAIL: power-up diagnostic detected a balance or behavior regression.');
    process.exitCode = 1;
  } else {
    console.log('PASS: power-up balance and accumulation match the target behavior.');
  }

  if (page.consoleErrors.length > 0) {
    console.error('Console errors:', JSON.stringify(page.consoleErrors, null, 2));
    process.exitCode = 1;
  }
} finally {
  page?.close?.();
  await stopProcessTree(browser, 'SIGTERM');
  await stopProcessTree(server, 'SIGINT');
  await removeTempProfile();
}
