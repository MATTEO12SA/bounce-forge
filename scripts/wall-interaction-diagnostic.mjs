#!/usr/bin/env node
// Compares native playfield wall bounces with placeable indestructible X wall bounces.
// The script runs controlled browser scenarios and reports wrong-axis velocity flips.

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';

const root = process.cwd();
const visible = process.argv.includes('--visible');
const edgeCandidates = [
  process.env.BROWSER_TEST_EDGE_PATH,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe'
].filter(Boolean);
const browserPath = edgeCandidates.find((candidate) => existsSync(candidate));
const userDataDir = `${root}/.edge-wall-diagnostic-profile`;
const cdpPort = Number(process.env.BROWSER_TEST_CDP_PORT ?? 9227);

if (!browserPath) {
  console.error('No supported browser found.');
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
      /* ignore */
    }
  }
  return null;
}

function createCdpClient(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  const consoleLogs = [];
  const consoleErrors = [];

  ws.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      pending.get(message.id)(message);
      pending.delete(message.id);
      return;
    }
    if (message.method === 'Runtime.exceptionThrown') {
      consoleErrors.push(message.params.exceptionDetails?.text);
    }
    if (message.method === 'Runtime.consoleAPICalled') {
      const text = message.params.args?.map((arg) => arg.value ?? arg.description).join(' ');
      consoleLogs.push({ level: message.params.type, text });
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
              if (message.error) fail(new Error(`${method}: ${message.error.message}`));
              else done(message);
            });
          });
        },
        close() {
          ws.close();
        },
        consoleLogs,
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

async function stopBrowser(child) {
  if (!child || child.exitCode !== null) return;
  child.kill('SIGTERM');
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
      if (error?.code !== 'EBUSY' && error?.code !== 'EPERM') throw error;
      await delay(400);
    }
  }
}

let server;
let browser;
let page;

try {
  await removeTempProfile();

  const existing = await detectRunningDevServer();
  let resolvedUrl;
  if (existing) {
    resolvedUrl = existing;
    console.log(`Using existing dev server: ${existing}`);
  } else {
    server = spawn(process.execPath, ['scripts/start-dev.mjs'], {
      cwd: root,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PORT: '5173' }
    });
    server.stdout.on('data', (data) => process.stdout.write(data));
    server.stderr.on('data', (data) => process.stderr.write(data));
    resolvedUrl = 'http://localhost:5173/';
    await waitForHttp(resolvedUrl);
  }

  browser = spawn(
    browserPath,
    [
      visible ? '' : '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--disable-extensions',
      `--remote-debugging-port=${cdpPort}`,
      `--user-data-dir=${userDataDir}`,
      '--window-size=420,720',
      'about:blank'
    ].filter(Boolean),
    { stdio: ['ignore', 'pipe', 'pipe'] }
  );

  await waitForHttp(`http://localhost:${cdpPort}/json/version`);
  const target = await requestJson(`http://localhost:${cdpPort}/json/new`, 'PUT');
  page = await createCdpClient(target.webSocketDebuggerUrl);
  await page.send('Runtime.enable');
  await page.send('Page.enable');
  await page.send('Page.navigate', { url: resolvedUrl });
  await delay(4000);

  for (let i = 0; i < 40; i += 1) {
    const hasCanvas = await evalInPage(page, `Boolean(document.querySelector('canvas'))`);
    if (hasCanvas) break;
    await delay(250);
  }

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
            return { ok: true, scenes: sceneList };
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

  await delay(800);
  const report = await evalInPage(
    page,
    `(async () => {
      const constants = {
        playfieldLeft: 112,
        playfieldRight: 968,
        playfieldTop: 38,
        ballRadius: 8,
        brickSize: 19,
        brickGap: 3,
        step: 22
      };
      const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const game = window.__bounceForge;
      const scene = game.scene.getScene('GameScene');
      scene.audioSystem?.setEnabled(false);
      await wait(300);

      const initialBrick = scene.getBricks()[0];
      const Brick = initialBrick.constructor;
      const sampleSpec = { ...initialBrick.spec };
      const originalHandleBallBrick = scene.handleBallBrick.bind(scene);
      const allCollisionEvents = [];

      function clearBalls() {
        scene.getBalls().forEach((ball) => scene.balls.remove(ball, true, true));
      }

      function clearBricks() {
        scene.getBricks().forEach((brick) => scene.bricks.remove(brick, true, true));
      }

      function parkPaddle() {
        scene.paddle.x = -2000;
        scene.paddle.y = 2200;
        scene.paddle.arcadeBody?.updateFromGameObject?.();
      }

      function makeBall(x, y, vx, vy) {
        clearBalls();
        const ball = scene.createBall(false);
        ball.x = x;
        ball.y = y;
        ball.attached = false;
        ball.arcadeBody.updateFromGameObject();
        ball.arcadeBody.setVelocity(vx, vy);
        scene.rememberBallPhysics?.(ball);
        return ball;
      }

      function addWallBrick(row, col, x, y) {
        const brick = new Brick(scene, {
          ...sampleSpec,
          id: 'diag-wall-' + row + '-' + col,
          row,
          col,
          x,
          y,
          width: constants.brickSize,
          height: constants.brickSize,
          kind: 'indestructible',
          hitPoints: 0,
          maxHitPoints: 0,
          score: 0,
          color: 0x5f5f5f,
          powerUpChance: 0
        });
        scene.bricks.add(brick);
        return brick;
      }

      function makeVerticalWall(col, rowStart, rowCount, x, yStart) {
        for (let index = 0; index < rowCount; index += 1) {
          addWallBrick(rowStart + index, col, x, yStart + index * constants.step);
        }
      }

      function makeHorizontalWall(row, colStart, colCount, xStart, y) {
        for (let index = 0; index < colCount; index += 1) {
          addWallBrick(row, colStart + index, xStart + index * constants.step, y);
        }
      }

      function analyzeSamples(samples, expectedAxis) {
        const liveSamples = samples.filter((sample) => !sample.lost);
        let xFlips = 0;
        let yFlips = 0;
        let stuckRun = 0;
        let currentStuck = 0;
        const anomalies = [];

        for (let index = 1; index < liveSamples.length; index += 1) {
          const previous = liveSamples[index - 1];
          const current = liveSamples[index];
          const xFlip =
            Math.abs(previous.vx) > 40 && Math.abs(current.vx) > 40 && previous.vx * current.vx < 0;
          const yFlip =
            Math.abs(previous.vy) > 40 && Math.abs(current.vy) > 40 && previous.vy * current.vy < 0;

          if (xFlip) xFlips += 1;
          if (yFlip) yFlips += 1;

          if ((expectedAxis === 'x' && yFlip) || (expectedAxis === 'y' && xFlip)) {
            anomalies.push({
              t: current.t,
              previous: { x: previous.x, y: previous.y, vx: previous.vx, vy: previous.vy },
              current: { x: current.x, y: current.y, vx: current.vx, vy: current.vy }
            });
          }

          const movement = Math.abs(current.x - previous.x) + Math.abs(current.y - previous.y);
          if (movement < 2.5) {
            currentStuck += 1;
            stuckRun = Math.max(stuckRun, currentStuck);
          } else {
            currentStuck = 0;
          }
        }

        const xValues = liveSamples.map((sample) => sample.x);
        const yValues = liveSamples.map((sample) => sample.y);
        const wrongAxisFlips = expectedAxis === 'x' ? yFlips : xFlips;

        return {
          expectedAxis,
          liveSamples: liveSamples.length,
          xFlips,
          yFlips,
          expectedAxisFlips: expectedAxis === 'x' ? xFlips : yFlips,
          wrongAxisFlips,
          stuckRun,
          xRange: xValues.length
            ? Math.round((Math.max(...xValues) - Math.min(...xValues)) * 10) / 10
            : 0,
          yRange: yValues.length
            ? Math.round((Math.max(...yValues) - Math.min(...yValues)) * 10) / 10
            : 0,
          anomalies: anomalies.slice(0, 6)
        };
      }

      async function runScenario({ name, type, expectedAxis, setup, frames = 90 }) {
        clearBalls();
        clearBricks();
        parkPaddle();
        const collisionEvents = [];
        scene.handleBallBrick = (ball, brick) => {
          const event = {
            t: performance.now(),
            brick: {
              row: brick.spec.row,
              col: brick.spec.col,
              width: Math.round(brick.arcadeBody.width * 10) / 10,
              height: Math.round(brick.arcadeBody.height * 10) / 10,
              offsetX: Math.round(brick.arcadeBody.offset.x * 10) / 10,
              offsetY: Math.round(brick.arcadeBody.offset.y * 10) / 10
            },
            ball: {
              x: Math.round(ball.x * 10) / 10,
              y: Math.round(ball.y * 10) / 10,
              vx: Math.round(ball.arcadeBody.velocity.x),
              vy: Math.round(ball.arcadeBody.velocity.y)
            }
          };
          collisionEvents.push(event);
          allCollisionEvents.push({ scenario: name, ...event });
          originalHandleBallBrick(ball, brick);
        };

        const ball = setup();
        const samples = [];
        const initialBody = ball.arcadeBody ?? ball.body;
        if (initialBody) {
          samples.push({
            t: -16,
            x: Math.round(ball.x * 10) / 10,
            y: Math.round(ball.y * 10) / 10,
            vx: Math.round(initialBody.velocity.x),
            vy: Math.round(initialBody.velocity.y)
          });
        }
        for (let frame = 0; frame < frames; frame += 1) {
          await wait(16);
          const liveBall = scene.getBalls()[0] ?? ball;
          const body = liveBall.arcadeBody ?? liveBall.body;
          if (!body) {
            samples.push({ t: frame * 16, lost: true });
            break;
          }
          samples.push({
            t: frame * 16,
            x: Math.round(liveBall.x * 10) / 10,
            y: Math.round(liveBall.y * 10) / 10,
            vx: Math.round(body.velocity.x),
            vy: Math.round(body.velocity.y)
          });
        }

        return {
          name,
          type,
          collisions: collisionEvents.length,
          analysis: analyzeSamples(samples, expectedAxis),
          firstSamples: samples.slice(0, 8),
          lastSamples: samples.slice(-8),
          collisionEvents: collisionEvents.slice(0, 8)
        };
      }

      const scenarios = [];

      scenarios.push(
        await runScenario({
          name: 'native-left-wall',
          type: 'native',
          expectedAxis: 'x',
          frames: 35,
          setup: () =>
            makeBall(
              constants.playfieldLeft + constants.ballRadius + 2,
              620,
              -420,
              170
            )
        })
      );

      scenarios.push(
        await runScenario({
          name: 'native-right-wall',
          type: 'native',
          expectedAxis: 'x',
          frames: 35,
          setup: () =>
            makeBall(
              constants.playfieldRight - constants.ballRadius - 2,
              620,
              420,
              170
            )
        })
      );

      scenarios.push(
        await runScenario({
          name: 'native-top-wall',
          type: 'native',
          expectedAxis: 'y',
          frames: 20,
          setup: () =>
            makeBall(
              520,
              constants.playfieldTop + constants.ballRadius + 2,
              180,
              -420
            )
        })
      );

      scenarios.push(
        await runScenario({
          name: 'placed-vertical-wall-side',
          type: 'placeable',
          expectedAxis: 'x',
          frames: 45,
          setup: () => {
            makeVerticalWall(10, 10, 24, 540, 460);
            scene.mergeWallRuns();
            return makeBall(540 - constants.brickSize / 2 - constants.ballRadius - 2, 700, 420, 170);
          }
        })
      );

      scenarios.push(
        await runScenario({
          name: 'placed-horizontal-wall-face',
          type: 'placeable',
          expectedAxis: 'y',
          frames: 25,
          setup: () => {
            makeHorizontalWall(10, 4, 26, 260, 760);
            scene.mergeWallRuns();
            return makeBall(540, 760 - constants.brickSize / 2 - constants.ballRadius - 2, 180, 420);
          }
        })
      );

      scenarios.push(
        await runScenario({
          name: 'placed-xex-one-cell-corridor',
          type: 'placeable',
          expectedAxis: 'x',
          frames: 35,
          setup: () => {
            makeVerticalWall(10, 10, 36, 500, 430);
            makeVerticalWall(12, 10, 36, 544, 430);
            scene.mergeWallRuns();
            return makeBall(522, 520, 260, 420);
          }
        })
      );

      scenarios.push(
        await runScenario({
          name: 'placed-frame-top-corners',
          type: 'placeable',
          expectedAxis: 'y',
          frames: 18,
          setup: () => {
            makeVerticalWall(0, 0, 18, 342, 420);
            makeVerticalWall(35, 0, 18, 342 + 35 * constants.step, 420);
            makeHorizontalWall(0, 0, 36, 342, 420);
            scene.mergeWallRuns();
            return makeBall(526, 420 + constants.brickSize / 2 + constants.ballRadius + 2, 230, -420);
          }
        })
      );

      scene.handleBallBrick = originalHandleBallBrick;
      const nativeWrong = scenarios
        .filter((scenario) => scenario.type === 'native')
        .reduce((total, scenario) => total + scenario.analysis.wrongAxisFlips, 0);
      const placeableScenarios = scenarios.filter((scenario) => scenario.type === 'placeable');
      const placeableWrong = placeableScenarios.reduce(
        (total, scenario) => total + scenario.analysis.wrongAxisFlips,
        0
      );
      const placeableMissingExpectedBounces = placeableScenarios.filter(
        (scenario) => scenario.analysis.expectedAxisFlips === 0
      ).length;

      return {
        ok: placeableWrong === 0 && placeableMissingExpectedBounces === 0,
        summary: {
          nativeWrongAxisFlips: nativeWrong,
          placeableWrongAxisFlips: placeableWrong,
          placeableMissingExpectedBounces,
          collisionEvents: allCollisionEvents.length
        },
        scenarios
      };
    })()`
  );

  console.log('--- Wall Interaction Diagnostic ---');
  console.log(JSON.stringify(report, null, 2));

  const screenshot = await page.send('Page.captureScreenshot', { format: 'png' });
  await writeFile('wall-interaction-diagnostic.png', Buffer.from(screenshot.result.data, 'base64'));
  console.log('Screenshot: wall-interaction-diagnostic.png');

  if (page.consoleErrors.length > 0) {
    console.error('Console errors:', JSON.stringify(page.consoleErrors, null, 2));
    process.exitCode = 1;
  }

  if (!report.ok) {
    process.exitCode = 1;
  }
} finally {
  page?.close?.();
  await stopBrowser(browser);
  if (server) {
    server.kill('SIGINT');
    await delay(800);
  }
  await removeTempProfile();
}
