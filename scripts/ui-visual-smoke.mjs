#!/usr/bin/env node
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
const userDataDir = `${root}/.edge-ui-smoke-profile`;
const cdpPort = Number(process.env.BROWSER_TEST_CDP_PORT ?? 9233);
const windowSize = process.env.BROWSER_TEST_WINDOW_SIZE ?? (visible ? '720,1280' : '390,600');
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
      consoleErrors.push({
        type: 'log',
        text: message.params.entry.text,
        source: message.params.entry.source
      });
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
  if (!child || child.exitCode !== null) {
    return;
  }

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
  if (!child || child.exitCode !== null) {
    return;
  }

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
      if (error?.code !== 'EBUSY' && error?.code !== 'EPERM') {
        throw error;
      }

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

    if (ready) {
      return;
    }

    await delay(150);
  }

  throw new Error('Timed out waiting for Phaser game');
}

async function waitForScene(page, sceneKey, timeoutMs = 5000) {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const active = await evaluate(
      page,
      `(() => {
        const game = window.__bounceForge;
        return Boolean(game?.scene?.getScene(${JSON.stringify(sceneKey)})?.sys?.isActive());
      })()`
    );

    if (active) {
      return;
    }

    await delay(150);
  }

  throw new Error(`Timed out waiting for ${sceneKey}`);
}

async function captureUiState(page, name, expectations) {
  await delay(650);
  const screenshot = await page.send('Page.captureScreenshot', { format: 'png' });
  const bytes = Buffer.from(screenshot.result.data, 'base64');
  await writeFile(`ui-smoke-${name}.png`, bytes);

  const state = await evaluate(
    page,
    `(() => {
      const game = window.__bounceForge;
      const activeScenes = game.scene.scenes.filter((scene) => scene.sys.isActive());
      const activeSceneKeys = activeScenes.map((scene) => scene.scene.key);
      const children = activeScenes.flatMap((scene) => scene.children.list);
      const texts = children
        .filter((child) => child.type === 'Text' && child.visible !== false)
        .map((child) => String(child.text ?? ''));
      const buttonCount = children.filter((child) => child.constructor?.name === 'Button').length;
      return {
        activeSceneKeys,
        textCount: texts.length,
        buttonCount,
        texts,
        hasCanvas: Boolean(document.querySelector('canvas')),
        canvasCount: document.querySelectorAll('canvas').length
      };
    })()`
  );

  const failures = [];
  if (!state.hasCanvas || state.canvasCount !== 1) failures.push('canvas missing');
  if (bytes.byteLength < 12000) failures.push(`screenshot too small (${bytes.byteLength})`);
  if (!state.activeSceneKeys.includes(expectations.scene))
    failures.push(`missing ${expectations.scene}`);
  if (state.textCount < expectations.minTexts)
    failures.push(`not enough text (${state.textCount})`);
  if (state.buttonCount < expectations.minButtons)
    failures.push(`not enough buttons (${state.buttonCount})`);
  if (
    expectations.requiredText &&
    !state.texts.some((text) => text.includes(expectations.requiredText))
  ) {
    failures.push(`missing text ${expectations.requiredText}`);
  }

  console.log(
    `${name}: ${JSON.stringify({
      activeSceneKeys: state.activeSceneKeys,
      textCount: state.textCount,
      buttonCount: state.buttonCount,
      screenshotBytes: bytes.byteLength
    })}`
  );

  if (failures.length > 0) {
    throw new Error(`${name} failed: ${failures.join(', ')}`);
  }
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
  await waitForScene(page, sceneKey);
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
    `--window-size=${windowSize}`,
    'about:blank'
  ];

  if (!visible) {
    browserArgs.unshift('--headless=new');
  }

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
  await startScene(page, 'MainMenuScene');

  await captureUiState(page, 'menu', {
    scene: 'MainMenuScene',
    minTexts: 3,
    minButtons: 5,
    requiredText: 'Bounce Forge'
  });

  await startScene(page, 'LevelSelectScene');
  await captureUiState(page, 'level-select', {
    scene: 'LevelSelectScene',
    minTexts: 2,
    minButtons: 7,
    requiredText: 'CAMPAIGN'
  });

  await startScene(page, 'LevelEditorScene', { mode: 'creative' });
  await captureUiState(page, 'editor', {
    scene: 'LevelEditorScene',
    minTexts: 3,
    minButtons: 16,
    requiredText: 'MODE CREATIF'
  });

  await startScene(page, 'GameScene', { levelIndex: 0 });
  await captureUiState(page, 'gameplay', {
    scene: 'GameScene',
    minTexts: 6,
    minButtons: 0,
    requiredText: 'SCORE'
  });

  await startScene(page, 'PauseScene', { levelIndex: 0 });
  await captureUiState(page, 'pause', {
    scene: 'PauseScene',
    minTexts: 1,
    minButtons: 3,
    requiredText: 'PAUSED'
  });

  await startScene(page, 'VictoryScene', { score: 42420, levelIndex: 0 });
  await captureUiState(page, 'victory', {
    scene: 'VictoryScene',
    minTexts: 2,
    minButtons: 3,
    requiredText: 'VICTORY'
  });

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
