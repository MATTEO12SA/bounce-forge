#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readdir, rm, writeFile } from 'node:fs/promises';
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
const worldWidth = 1080;
const worldHeight = 1920;
const screenshotPatterns = [
  /^ui-smoke-.+\.png$/,
  /^browser-test\.png$/,
  /^wall-seam-test\.png$/,
  /^player-corridor-test\.png$/,
  /^powerup-test\.png$/,
  /^powerup-diagnostic\.png$/,
  /^wall-interaction-diagnostic\.png$/,
  /^top-corner-test\.png$/,
  /^top-right-gutter-test\.png$/
];

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

  await delay(800);
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

async function removeTempScreenshots() {
  const entries = await readdir(root, { withFileTypes: true });
  await Promise.all(
    entries
      .filter(
        (entry) => entry.isFile() && screenshotPatterns.some((pattern) => pattern.test(entry.name))
      )
      .map((entry) => rm(`${root}/${entry.name}`, { force: true }))
  );
}

async function evaluate(page, expression) {
  const result = await page.send('Runtime.evaluate', {
    expression,
    returnByValue: true
  });
  return result.result.result.value;
}

async function waitForGame(page, timeoutMs = 25000) {
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

  const state = await evaluate(
    page,
    `(() => ({
      href: window.location.href,
      readyState: document.readyState,
      hasRoot: Boolean(document.querySelector('#game-root')),
      hasCanvas: Boolean(document.querySelector('canvas')),
      text: document.body?.innerText?.slice(0, 240) ?? ''
    }))()`
  );

  throw new Error(`Timed out waiting for Phaser game: ${JSON.stringify(state)}`);
}

async function waitForScene(page, sceneKey, timeoutMs = 12000) {
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

  const state = await evaluate(
    page,
    `(() => {
      const game = window.__bounceForge;
      return {
        href: window.location.href,
        hasCanvas: Boolean(document.querySelector('canvas')),
        activeSceneKeys: game?.scene?.scenes
          ?.filter((scene) => scene.sys.isActive())
          .map((scene) => scene.scene.key) ?? [],
        sceneKeys: game?.scene?.scenes?.map((scene) => scene.scene.key) ?? []
      };
    })()`
  );

  throw new Error(`Timed out waiting for ${sceneKey}: ${JSON.stringify(state)}`);
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
      const flatten = (children) => children.flatMap((child) => [
        child,
        ...(Array.isArray(child.list) ? flatten(child.list) : [])
      ]);
      const children = activeScenes.flatMap((scene) => flatten(scene.children.list));
      const texts = children
        .filter((child) => child.type === 'Text' && child.visible !== false)
        .map((child) => String(child.text ?? ''));
      const controlNames = new Set(['Button', 'IconButton', 'Slider', 'ToggleSwitch', 'SegmentedControl', 'TabBar']);
      const buttonCount = children.filter((child) => controlNames.has(child.constructor?.name)).length;
      const icons = children
        .map((child) => child.icon)
        .filter((icon) => typeof icon === 'string');
      const buttonBounds = children
        .filter((child) => controlNames.has(child.constructor?.name) && child.visible !== false)
        .map((child) => {
          const bounds = typeof child.getBounds === 'function' ? child.getBounds() : null;
          const width = Number(bounds?.width ?? child.input?.hitArea?.width ?? child.width ?? 0);
          const height = Number(bounds?.height ?? child.input?.hitArea?.height ?? child.height ?? 0);
          const x = Number(bounds ? bounds.centerX : child.x);
          const y = Number(bounds ? bounds.centerY : child.y);
          return {
            x,
            y,
            left: x - width / 2,
            right: x + width / 2,
            top: y - height / 2,
            bottom: y + height / 2
          };
        });
      return {
        activeSceneKeys,
        textCount: texts.length,
        buttonCount,
        buttonBounds,
        icons,
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
  const outOfBoundsButtons = state.buttonBounds.filter(
    (bounds) =>
      bounds.left < -2 ||
      bounds.right > worldWidth + 2 ||
      bounds.top < -2 ||
      bounds.bottom > worldHeight + 2
  );
  if (outOfBoundsButtons.length > 0) {
    failures.push(`button bounds outside world (${JSON.stringify(outOfBoundsButtons[0])})`);
  }
  if (
    expectations.requiredText &&
    !state.texts.some((text) => text.includes(expectations.requiredText))
  ) {
    failures.push(`missing text ${expectations.requiredText}`);
  }
  if (
    expectations.forbiddenText &&
    state.texts.some((text) => text.includes(expectations.forbiddenText))
  ) {
    failures.push(`unexpected text ${expectations.forbiddenText}`);
  }
  if (expectations.requiredIcons) {
    const missingIcons = expectations.requiredIcons.filter((icon) => !state.icons.includes(icon));
    if (missingIcons.length > 0) {
      failures.push(`missing icons ${missingIcons.join(', ')}`);
    }
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

async function startPausedGame(page, data = { levelIndex: 0 }) {
  await startScene(page, 'GameScene', data);
  await evaluate(
    page,
    `(() => {
      const game = window.__bounceForge;
      game.scene.getScene('GameScene').pauseGame();
      return true;
    })()`
  );
  await waitForScene(page, 'PauseScene');
}

async function pressSceneButton(page, sceneKey, label) {
  const pressed = await evaluate(
    page,
    `(() => {
      const game = window.__bounceForge;
      const scene = game.scene.getScene(${JSON.stringify(sceneKey)});
      const button = scene.children.list.find((child) =>
        child.constructor?.name === 'Button' &&
        child.list?.some((part) => part.type === 'Text' && String(part.text ?? '') === ${JSON.stringify(label)})
      );
      if (!button) return false;
      button.emit('pointerdown', {});
      return true;
    })()`
  );

  if (!pressed) {
    throw new Error(`Button ${label} not found in ${sceneKey}`);
  }
}

let server;
let browser;
let page;

try {
  await removeTempProfile();
  await removeTempScreenshots();

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
  const target = await requestJson(`http://localhost:${cdpPort}/json/new`, 'PUT');
  page = await createCdpClient(target.webSocketDebuggerUrl);
  await page.send('Runtime.enable');
  await page.send('Log.enable');
  await page.send('Page.enable');
  await page.send('Page.navigate', { url: targetUrl });
  await waitForGame(page);
  await waitForScene(page, 'MainMenuScene');
  await startScene(page, 'MainMenuScene');

  await captureUiState(page, 'menu', {
    scene: 'MainMenuScene',
    minTexts: 3,
    minButtons: 5,
    requiredText: 'Bounce Forge',
    requiredIcons: ['player-play', 'settings', 'book', 'palette']
  });

  await startScene(page, 'OptionsScene', { returnTo: 'MainMenuScene' });
  await captureUiState(page, 'options', {
    scene: 'OptionsScene',
    minTexts: 5,
    minButtons: 8,
    requiredText: 'OPTIONS',
    forbiddenText: 'MUSIC VOLUME',
    requiredIcons: ['trash', 'arrow-left']
  });

  await startScene(page, 'LevelSelectScene');
  await captureUiState(page, 'level-select', {
    scene: 'LevelSelectScene',
    minTexts: 2,
    minButtons: 7,
    requiredText: 'CAMPAIGN'
  });

  await startScene(page, 'GuideScene');
  await captureUiState(page, 'guide', {
    scene: 'GuideScene',
    minTexts: 6,
    minButtons: 1,
    requiredText: 'GUIDE'
  });

  await startScene(page, 'LevelEditorScene', { mode: 'creative' });
  await captureUiState(page, 'editor', {
    scene: 'LevelEditorScene',
    minTexts: 3,
    minButtons: 16,
    requiredText: 'MODE CREATIF',
    requiredIcons: ['check', 'player-play', 'upload', 'download', 'copy', 'trash', 'arrow-left']
  });

  await startScene(page, 'GameScene', { levelIndex: 0 });
  await captureUiState(page, 'gameplay', {
    scene: 'GameScene',
    minTexts: 6,
    minButtons: 0,
    requiredText: 'SCORE'
  });

  await startPausedGame(page, { levelIndex: 0 });
  await captureUiState(page, 'pause', {
    scene: 'PauseScene',
    minTexts: 1,
    minButtons: 3,
    requiredText: 'PAUSED',
    requiredIcons: ['player-play', 'rotate-clockwise', 'settings', 'home']
  });

  await pressSceneButton(page, 'PauseScene', 'OPTIONS');
  await waitForScene(page, 'OptionsScene');
  await captureUiState(page, 'options-from-pause', {
    scene: 'OptionsScene',
    minTexts: 5,
    minButtons: 8,
    requiredText: 'OPTIONS',
    forbiddenText: 'MUSIC VOLUME',
    requiredIcons: ['trash', 'arrow-left']
  });

  const gamePausedDuringOptions = await evaluate(
    page,
    `(() => window.__bounceForge.scene.isPaused('GameScene'))()`
  );
  if (!gamePausedDuringOptions) {
    throw new Error('GameScene was not preserved while OptionsScene was open from pause');
  }

  await pressSceneButton(page, 'OptionsScene', 'BACK');
  await waitForScene(page, 'PauseScene');
  const gamePausedAfterBack = await evaluate(
    page,
    `(() => window.__bounceForge.scene.isPaused('GameScene'))()`
  );
  if (!gamePausedAfterBack) {
    throw new Error('GameScene was not still paused after returning from options');
  }

  await pressSceneButton(page, 'PauseScene', 'RESUME');
  await waitForScene(page, 'GameScene');
  const gameResumed = await evaluate(
    page,
    `(() => window.__bounceForge.scene.getScene('GameScene')?.sys?.isActive() && !window.__bounceForge.scene.isPaused('GameScene'))()`
  );
  if (!gameResumed) {
    throw new Error('Resume did not restore the paused GameScene');
  }

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
  if (!process.env.KEEP_UI_SMOKE_SCREENSHOTS) {
    await removeTempScreenshots();
  }
  await removeTempProfile();
}
