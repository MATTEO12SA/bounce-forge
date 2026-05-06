#!/usr/bin/env node
// Player-corridor regression test.
// Verifies the cleaned XEX corridor can be entered from a normal paddle launch,
// without injecting a ball directly into the corridor or setting custom velocity.

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
const userDataDir = `${root}/.edge-player-corridor-profile`;
const cdpPort = Number(process.env.BROWSER_TEST_CDP_PORT ?? 9225);
const screenshotPath = 'player-corridor-test.png';

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
      // Try the next known development port.
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
      ? 'Opening a visible browser window for the player corridor test.'
      : 'Running headless player corridor test.'
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

      const waitForScene = async () => {
        const start = Date.now();
        while (Date.now() - start < 3000) {
          if (scene.bricks && scene.bricks.getLength() > 0 && scene.paddle && scene.balls) {
            return true;
          }
          await new Promise((resolve) => setTimeout(resolve, 60));
        }
        return false;
      };

      if (!(await waitForScene())) {
        return { ok: false, reason: 'scene not ready' };
      }

      const allBricks = scene.bricks.getChildren().slice();
      const byCell = new Map();
      allBricks.forEach((brick) => {
        if (brick.spec) {
          byCell.set(brick.spec.row + ':' + brick.spec.col, brick);
        }
      });

      let runStart = -1;
      let runEnd = -1;
      let currentStart = -1;
      let currentLength = 0;

      for (let row = 0; row < 58; row += 1) {
        const left = byCell.get(row + ':16');
        const center = byCell.get(row + ':17');
        const right = byCell.get(row + ':18');
        const isXex =
          left?.spec?.kind === 'indestructible' &&
          center?.spec?.kind === 'explosive' &&
          right?.spec?.kind === 'indestructible';

        if (isXex) {
          if (currentStart < 0) {
            currentStart = row;
          }
          currentLength += 1;
          if (currentLength >= 5 && runStart < 0) {
            runStart = currentStart;
          }
          runEnd = row;
        } else {
          currentStart = -1;
          currentLength = 0;
        }
      }

      if (runStart < 0) {
        return { ok: false, reason: 'XEX corridor not found' };
      }

      const leftWall = byCell.get(runStart + ':16');
      const rightWall = byCell.get(runStart + ':18');
      const corridorX = (leftWall.x + rightWall.x) / 2;
      const topY = byCell.get(runStart + ':17').y;
      const bottomY = byCell.get(runEnd + ':17').y;

      // Simulate the corridor already cleaned by a player: remove only the
      // breakable center cells, keep all indestructible side walls active.
      const removed = [];
      for (let row = runStart; row <= runEnd + 1; row += 1) {
        const center = byCell.get(row + ':17');
        if (center?.spec?.kind !== 'indestructible') {
          scene.bricks.remove(center, true, true);
          removed.push({ row, col: 17, kind: center?.spec?.kind });
        }
      }

      const startBallY = scene.paddle.y - 56;
      const entryY = bottomY + 28;
      const baseAimX = corridorX - 0.28 * (startBallY - entryY);
      const attemptOffsets = [0, -8, 8, -16, 16, -24, 24, -32, 32, -44, 44];
      const attempts = [];
      scene.lives = 99;
      scene.ending = false;

      for (const offset of attemptOffsets) {
        if (!scene.scene.isActive()) {
          return {
            ok: false,
            reason: 'GameScene stopped during attempts',
            attempts
          };
        }

        const aimX = Math.round((baseAimX + offset) * 10) / 10;

        scene.getBalls().forEach((ball) => scene.balls.remove(ball, true, true));
        scene.respawning = false;
        scene.ending = false;
        scene.lives = 99;
        scene.paddle.setPosition(aimX, scene.paddle.y);
        scene.paddle.arcadeBody.updateFromGameObject();

        const ball = scene.createBall(true);
        ball.attachToPaddle(scene.paddle);
        scene.launchAttachedBalls();

        const samples = [];

        for (let index = 0; index < 34; index += 1) {
          await new Promise((resolve) => setTimeout(resolve, 70));
          const activeBall = scene.getBalls()[0];
          if (!activeBall) {
            samples.push({ t: index * 70, lost: true });
            break;
          }
          samples.push({
            t: index * 70,
            x: Math.round(activeBall.x * 10) / 10,
            y: Math.round(activeBall.y * 10) / 10,
            vx: Math.round(activeBall.arcadeBody.velocity.x),
            vy: Math.round(activeBall.arcadeBody.velocity.y)
          });
        }

        const corridorSamples = samples.filter(
          (sample) =>
            !sample.lost &&
            Math.abs(sample.x - corridorX) <= 16 &&
            sample.y <= bottomY + 42 &&
            sample.y >= topY - 34
        );
        const reachedTop = corridorSamples.some((sample) => sample.y <= topY + 20);
        const entered = corridorSamples.some((sample) => sample.y <= bottomY - 20);

        let stuckRun = 0;
        let currentStuckRun = 0;
        let yReversals = 0;
        for (let index = 1; index < corridorSamples.length; index += 1) {
          const previous = corridorSamples[index - 1];
          const current = corridorSamples[index];
          const movement = Math.abs(current.x - previous.x) + Math.abs(current.y - previous.y);

          if (movement < 3) {
            currentStuckRun += 1;
            stuckRun = Math.max(stuckRun, currentStuckRun);
          } else {
            currentStuckRun = 0;
          }

          if (current.y > previous.y + 2) {
            yReversals += 1;
          }
        }

        const yProgress =
          corridorSamples.length > 0
            ? Math.max(...corridorSamples.map((sample) => sample.y)) -
              Math.min(...corridorSamples.map((sample) => sample.y))
            : 0;
        const xDrift =
          corridorSamples.length > 0
            ? Math.max(...corridorSamples.map((sample) => sample.x)) -
              Math.min(...corridorSamples.map((sample) => sample.x))
            : 0;
        const success =
          entered &&
          reachedTop &&
          corridorSamples.length >= 4 &&
          stuckRun <= 2 &&
          yReversals <= 2 &&
          yProgress > 120 &&
          xDrift <= 18;

        attempts.push({
          aimX,
          success,
          entered,
          reachedTop,
          corridorSamples: corridorSamples.length,
          stuckRun,
          yReversals,
          yProgress: Math.round(yProgress * 10) / 10,
          xDrift: Math.round(xDrift * 10) / 10,
          samples: samples.slice(0, 18)
        });

        if (success) {
          return {
            ok: true,
            corridor: {
              x: Math.round(corridorX * 10) / 10,
              runStart,
              runEnd,
              topY,
              bottomY,
              removed
            },
            baseAimX: Math.round(baseAimX * 10) / 10,
            winner: attempts.at(-1),
            attempts
          };
        }
      }

      return {
        ok: false,
        reason: 'no normal paddle launch entered cleanly',
        corridor: {
          x: Math.round(corridorX * 10) / 10,
          runStart,
          runEnd,
          topY,
          bottomY,
          removed
        },
        baseAimX: Math.round(baseAimX * 10) / 10,
        attempts
      };
    })()`
  );

  console.log('--- Player Corridor Result ---');
  console.log(JSON.stringify(result, null, 2));

  const screenshot = await page.send('Page.captureScreenshot', { format: 'png' });
  await writeFile(screenshotPath, Buffer.from(screenshot.result.data, 'base64'));
  console.log(`Screenshot: ${screenshotPath}`);

  if (!result.ok) {
    console.error('FAIL: normal paddle launch did not enter the corridor cleanly.');
    process.exitCode = 1;
  } else {
    console.log('PASS: normal paddle launch can enter and climb the cleaned corridor.');
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
