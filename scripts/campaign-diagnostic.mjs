#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
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
const userDataDir = `${root}/.edge-campaign-diagnostic-profile`;
const cdpPort = Number(process.env.BROWSER_TEST_CDP_PORT ?? 9243);
const devServerUrl = 'http://localhost:5173/';
const targetUrl = `${devServerUrl}?menu=1`;
const consoleErrors = [];

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
    req.setTimeout(1200, () => req.destroy(new Error(`timeout ${url}`)));
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

function createCdpClient(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();

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

    if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error') {
      consoleErrors.push({ type: 'log', text: message.params.entry.text });
    }

    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
      consoleErrors.push({
        type: 'console',
        text: message.params.args?.map((arg) => arg.value ?? arg.description ?? arg.type).join(' ')
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
            }, 5000);

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
        }
      });
    });
    ws.addEventListener('error', reject);
  });
}

async function stopProcessTree(child) {
  if (!child || child.exitCode !== null) return;
  child.kill('SIGINT');
  const exited = await Promise.race([
    new Promise((resolve) => child.once('exit', () => resolve(true))),
    delay(2500).then(() => false)
  ]);
  if (!exited && child.exitCode === null) {
    spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  }
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

async function evaluate(page, expression) {
  const result = await page.send('Runtime.evaluate', {
    expression,
    returnByValue: true
  });
  return result.result.result.value;
}

async function waitForGame(page, timeoutMs = 8000) {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const ready = await evaluate(
      page,
      `(() => Boolean(window.__bounceForge?.scene?.scenes?.length && document.querySelector('canvas')))()`
    );
    if (ready) return;
    await delay(150);
  }

  throw new Error('Timed out waiting for Phaser game');
}

async function startScene(page, sceneKey, data = {}) {
  await evaluate(
    page,
    `(() => {
      const game = window.__bounceForge;
      game.scene.scenes.forEach((scene) => {
        if (scene.scene.key !== ${JSON.stringify(sceneKey)} && scene.sys.isActive()) {
          game.scene.stop(scene.scene.key);
        }
      });
      game.scene.start(${JSON.stringify(sceneKey)}, ${JSON.stringify(data)});
      return true;
    })()`
  );
  await delay(220);
}

let server;
let browser;
let page;

try {
  await removeTempProfile();

  try {
    await waitForHttp(devServerUrl, 1200);
    console.log(`Using existing dev server on ${devServerUrl}`);
  } catch {
    server = spawn(process.execPath, ['scripts/start-dev.mjs'], {
      cwd: root,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    server.stdout.on('data', (data) => process.stdout.write(data));
    server.stderr.on('data', (data) => process.stderr.write(data));
    await waitForHttp(devServerUrl);
  }

  const browserArgs = [
    '--disable-gpu',
    '--no-first-run',
    '--disable-extensions',
    `--remote-debugging-port=${cdpPort}`,
    `--user-data-dir=${userDataDir}`,
    '--window-size=390,600',
    'about:blank'
  ];
  if (!visible) browserArgs.unshift('--headless=new');

  browser = spawn(browserPath, browserArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
  await waitForHttp(`http://localhost:${cdpPort}/json/version`);
  const target = await requestJson(
    `http://localhost:${cdpPort}/json/new?${encodeURIComponent(targetUrl)}`,
    'PUT'
  );
  page = await createCdpClient(target.webSocketDebuggerUrl);
  await page.send('Runtime.enable');
  await page.send('Log.enable');
  await page.send('Page.enable');
  await waitForGame(page);

  const campaignSummary = [];
  for (let index = 0; index < 24; index += 1) {
    await startScene(page, 'GameScene', { levelIndex: index });
    const state = await evaluate(
      page,
      `(() => {
        const scene = window.__bounceForge.scene.getScene('GameScene');
        const bricks = scene.bricks.getChildren().filter((brick) => brick.active);
        const balls = scene.balls.getChildren().filter((ball) => ball.active);
        const breakable = bricks.filter((brick) => brick.isBreakable);
        const kinds = Object.fromEntries(
          [...new Set(bricks.map((brick) => brick.spec.kind))].map((kind) => [
            kind,
            bricks.filter((brick) => brick.spec.kind === kind).length
          ])
        );
        return {
          levelIndex: scene.level.index,
          name: scene.level.name,
          chapter: scene.level.chapter,
          objective: scene.level.objective.label,
          bricks: bricks.length,
          breakable: breakable.length,
          balls: balls.length,
          ballAttached: balls.some((ball) => ball.isAttached),
          kinds
        };
      })()`
    );

    campaignSummary.push(state);

    if (state.levelIndex !== index) throw new Error(`Loaded wrong level ${index}`);
    if (state.breakable <= 0) throw new Error(`Level ${index + 1} has no breakable bricks`);
    if (state.balls !== 1 || !state.ballAttached) {
      throw new Error(`Level ${index + 1} has invalid spawn ball state`);
    }
  }

  await startScene(page, 'LevelEditorScene', { slotIndex: 0 });
  const editorState = await evaluate(
    page,
    `(() => {
      const scene = window.__bounceForge.scene.getScene('LevelEditorScene');
      scene.rows = ['BS..................................', ...scene.rows.slice(1)];
      scene.saveCurrentSlot();
      window.__bounceForge.scene.start('GameScene', { levelIndex: 0 });
      const campaignScene = window.__bounceForge.scene.getScene('GameScene');
      const campaignName = campaignScene.level.name;
      window.__bounceForge.scene.start('GameScene', { levelIndex: 0, source: 'custom' });
      const customScene = window.__bounceForge.scene.getScene('GameScene');
      const kinds = customScene.bricks.getChildren().map((brick) => brick.spec.kind);
      return {
        campaignName,
        customName: customScene.level.name,
        hasBonus: kinds.includes('bonus'),
        hasShield: kinds.includes('shield')
      };
    })()`
  );

  if (editorState.campaignName !== campaignSummary[0].name) {
    throw new Error('Campaign level changed after saving an editor slot');
  }

  if (!editorState.hasBonus || !editorState.hasShield || editorState.customName !== 'Custom 1') {
    throw new Error('Explicit custom play path did not create bonus and shield bricks');
  }

  const chapters = [...new Set(campaignSummary.map((level) => level.chapter))];
  console.log(
    JSON.stringify(
      {
        ok: true,
        levels: campaignSummary.length,
        chapters,
        first: campaignSummary[0],
        last: campaignSummary.at(-1),
        editorState
      },
      null,
      2
    )
  );

  if (consoleErrors.length > 0) {
    console.error('Console errors captured:');
    console.error(JSON.stringify(consoleErrors, null, 2));
    process.exitCode = 1;
  } else {
    console.log('Console errors captured: 0');
  }
} finally {
  page?.close?.();
  await stopBrowser(browser);
  await stopProcessTree(server);
  await removeTempProfile();
}
