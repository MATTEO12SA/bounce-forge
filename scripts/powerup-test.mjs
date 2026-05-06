#!/usr/bin/env node
// Power-up regression test.
// Runs inside a real Phaser GameScene and collects each pickup through the
// PowerUp -> Paddle overlap path, then asserts the resulting gameplay state.

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
const userDataDir = `${root}/.edge-powerup-test-profile`;
const cdpPort = Number(process.env.BROWSER_TEST_CDP_PORT ?? 9226);
const screenshotPath = 'powerup-test.png';

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
  const candidates = ['5173', '4173'];

  for (const port of candidates) {
    const url = `http://localhost:${port}/`;

    try {
      const html = await requestText(url);

      if (html.includes('Bounce Forge') || html.includes('game-root')) {
        return url;
      }
    } catch {
      // Keep looking for a running local server.
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
      ? 'Opening a visible browser window for the power-up regression test.'
      : 'Running headless power-up regression test.'
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
      const round = (value) => Math.round(value * 10) / 10;
      const close = (actual, expected, tolerance) => Math.abs(actual - expected) <= tolerance;

      const activeChildren = (group) =>
        group.getChildren().filter((child) => child.active);

      const clearGroup = (group) => {
        group.getChildren().slice().forEach((child) => group.remove(child, true, true));
      };

      const resetScene = () => {
        scene.activeTimers.forEach((timer) => timer.remove(false));
        scene.activeTimers.clear();
        scene.respawning = false;
        scene.ending = false;
        scene.ballExpansionBlocked = false;
        scene.activeBallLimit = 40;
        scene.ballLimitStressFrames = 0;
        scene.pendingBallBonusClones = 0;
        scene.lives = 3;
        clearGroup(scene.powerUps);
        clearGroup(scene.balls);
        clearGroup(scene.bricks);
        scene.paddle.resetWidth();
        scene.paddle.setCenterX(540);
        scene.hud.update(scene.buildHudState());
      };

      const createNormalBall = () => {
        clearGroup(scene.balls);
        scene.paddle.setCenterX(540);
        const ball = scene.createBall(true);
        ball.attachToPaddle(scene.paddle);
        scene.launchAttachedBalls();
        return scene.getBalls()[0];
      };

      const snapshot = () => ({
        balls: scene.getBalls().length,
        paddleWidth: round(scene.paddle.activeWidth),
        powerUps: activeChildren(scene.powerUps).length,
        lives: scene.lives
      });

      const collect = async (type) => {
        scene.powerUpSystem.roll = () => type;
        scene.spawnPowerUp(scene.paddle.x, scene.paddle.y, 1, undefined);
        const start = Date.now();
        while (Date.now() - start < 2200) {
          await wait(40);
          const activePowerUps = activeChildren(scene.powerUps);
          activePowerUps.forEach((powerUp) => {
            powerUp.setPosition(scene.paddle.x, scene.paddle.y);
            powerUp.arcadeBody.updateFromGameObject();
          });

          if (activePowerUps.length === 0) {
            return true;
          }
        }
        return activeChildren(scene.powerUps).length === 0;
      };

      const record = (name, passed, details) => {
        tests.push({ name, passed, details });
        if (!passed) {
          failures.push({ name, details });
        }
      };

      const expire = (type) => {
        scene.activeTimers.get(type)?.remove(false);
        scene.activeTimers.delete(type);
        if (type === 'widePaddle') {
          scene.refreshPaddleWidth();
        }
      };

      resetScene();
      createNormalBall();
      const multiCollected = await collect('multiBall');
      await wait(120);
      record('multiBall triples ball count', multiCollected && scene.getBalls().length === 3, {
        after: snapshot()
      });

      resetScene();
      createNormalBall();
      const splitCollected = await collect('splitBall');
      await wait(120);
      record('splitBall doubles ball count', splitCollected && scene.getBalls().length === 2, {
        after: snapshot()
      });

      resetScene();
      createNormalBall();
      const wideCollected = await collect('widePaddle');
      await wait(80);
      record('widePaddle widens paddle', wideCollected && close(scene.paddle.activeWidth, 317.4, 2), {
        after: snapshot()
      });
      expire('widePaddle');
      record('widePaddle expiry restores normal width', close(scene.paddle.activeWidth, 230, 1), {
        after: snapshot()
      });

      resetScene();
      const stickyBall = createNormalBall();
      const stickyCollected = await collect('stickyPaddle');
      await wait(80);
      stickyBall.setPosition(scene.paddle.x, scene.paddle.y - 44);
      stickyBall.arcadeBody.updateFromGameObject();
      stickyBall.arcadeBody.setVelocity(120, 380);
      scene.handleBallPaddle(stickyBall);
      const stickyAttached = stickyBall.isAttached;
      scene.launchAttachedBalls();
      const stickyRelaunched = !stickyBall.isAttached && stickyBall.arcadeBody.velocity.y < 0;
      record(
        'stickyPaddle catches and relaunches a paddle hit',
        stickyCollected &&
          scene.activeTimers.has('stickyPaddle') &&
          stickyAttached &&
          stickyRelaunched,
        {
          stickyAttached,
          stickyRelaunched,
          effectActive: scene.activeTimers.has('stickyPaddle'),
          after: snapshot()
        }
      );
      expire('stickyPaddle');

      resetScene();
      createNormalBall();
      scene.lives = 4;
      const extraCollected = await collect('extraLife');
      await wait(80);
      const firstLifeResult = scene.lives;
      const extraCollectedAgain = await collect('extraLife');
      await wait(80);
      record(
        'extraLife caps at MAX_LIVES',
        extraCollected && extraCollectedAgain && firstLifeResult === 5 && scene.lives === 5,
        {
          firstLifeResult,
          after: snapshot()
        }
      );

      return {
        ok: failures.length === 0,
        tests,
        failures,
        final: snapshot()
      };
    })()`
  );

  console.log('--- Power-up Result ---');
  console.log(JSON.stringify(result, null, 2));

  const screenshot = await page.send('Page.captureScreenshot', { format: 'png' });
  await writeFile(screenshotPath, Buffer.from(screenshot.result.data, 'base64'));
  console.log(`Screenshot: ${screenshotPath}`);

  if (!result.ok) {
    console.error('FAIL: one or more power-ups did not behave correctly.');
    process.exitCode = 1;
  } else {
    console.log('PASS: every power-up behaved correctly through the pickup path.');
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
