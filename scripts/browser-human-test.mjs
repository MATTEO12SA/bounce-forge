#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';

const root = process.cwd();
const rawArgs = process.argv.slice(2);
const args = new Set(rawArgs);
const visible = args.has('--visible') || args.has('--headed');
const editorSmoke = args.has('--editor-smoke');
const getArgValue = (name) => {
  const inlineValue = rawArgs.find((arg) => arg.startsWith(`${name}=`));

  if (inlineValue) {
    return inlineValue.slice(name.length + 1);
  }

  const index = rawArgs.indexOf(name);
  return index >= 0 ? rawArgs[index + 1] : undefined;
};
const edgeCandidates = [
  process.env.BROWSER_TEST_EDGE_PATH,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe'
].filter(Boolean);
const browserPath = edgeCandidates.find((candidate) => existsSync(candidate));
const userDataDir = `${root}/.edge-human-test-profile`;
const cdpPort = Number(process.env.BROWSER_TEST_CDP_PORT ?? 9223);
const playTimeMs = Number(process.env.BROWSER_TEST_PLAY_TIME_MS ?? 18000);
const windowSize = process.env.BROWSER_TEST_WINDOW_SIZE ?? (visible ? '720,1280' : '390,600');
const devServerUrl = 'http://localhost:5173/';
const targetUrlObject = new URL(
  getArgValue('--url') ?? process.env.BROWSER_TEST_URL ?? devServerUrl
);

if (editorSmoke && !targetUrlObject.searchParams.has('menu')) {
  targetUrlObject.searchParams.set('menu', '1');
}

const targetUrl = targetUrlObject.toString();
const consoleErrors = [];
const consoleLogs = [];

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
        description: message.params.exceptionDetails?.exception?.description,
        url: message.params.exceptionDetails?.url,
        lineNumber: message.params.exceptionDetails?.lineNumber,
        columnNumber: message.params.exceptionDetails?.columnNumber
      });
    }

    if (message.method === 'Log.entryAdded') {
      const entry = message.params.entry;
      consoleLogs.push({
        level: entry.level,
        source: entry.source,
        text: entry.text,
        url: entry.url
      });

      if (entry.level === 'error') {
        consoleErrors.push({
          type: 'log',
          level: entry.level,
          source: entry.source,
          text: entry.text,
          url: entry.url
        });
      }
    }

    if (message.method === 'Runtime.consoleAPICalled') {
      const params = message.params;
      const text = params.args?.map((arg) => arg.value ?? arg.description ?? arg.type).join(' ');
      consoleLogs.push({ level: params.type, source: 'console', text });

      if (params.type === 'error') {
        consoleErrors.push({ type: 'console', text });
      }
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

async function dispatchKey(page, code, key, windowsVirtualKeyCode, holdMs = 110) {
  await page.send('Input.dispatchKeyEvent', {
    type: 'keyDown',
    code,
    key,
    windowsVirtualKeyCode
  });
  await delay(holdMs);
  await page.send('Input.dispatchKeyEvent', {
    type: 'keyUp',
    code,
    key,
    windowsVirtualKeyCode
  });
}

function worldToScreen(rect, x, y) {
  return {
    x: rect.x + (x / 1080) * rect.width,
    y: rect.y + (y / 1920) * rect.height
  };
}

async function clickWorld(page, rect, x, y) {
  const point = worldToScreen(rect, x, y);
  await page.send('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: point.x,
    y: point.y
  });
  await page.send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: point.x,
    y: point.y,
    button: 'left',
    clickCount: 1
  });
  await page.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: point.x,
    y: point.y,
    button: 'left',
    clickCount: 1
  });
}

async function dragWorld(page, rect, points) {
  const [start, ...rest] = points.map((point) => worldToScreen(rect, point.x, point.y));

  await page.send('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: start.x,
    y: start.y
  });
  await page.send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: start.x,
    y: start.y,
    button: 'left',
    clickCount: 1
  });

  for (const point of rest) {
    await page.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: point.x,
      y: point.y,
      button: 'left'
    });
    await delay(60);
  }

  const end = rest.at(-1) ?? start;
  await page.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: end.x,
    y: end.y,
    button: 'left',
    clickCount: 1
  });
}

async function runEditorSmoke(page, rect) {
  const gridLeft = (1080 - (36 * 19 + 35 * 3)) / 2;
  const gridTop = 260;
  const cellStep = 22;
  const centerOfCell = (row, col) => ({
    x: gridLeft + col * cellStep + 9.5,
    y: gridTop + row * cellStep + 9.5
  });

  await page.send('Runtime.evaluate', {
    expression: `(() => {
      const game = window.__bounceForge;
      game.scene.stop('MainMenuScene');
      game.scene.start('LevelEditorScene', { slotIndex: 0, mode: 'creative' });
      return true;
    })()`,
    returnByValue: true
  });
  await delay(700);
  await clickWorld(page, rect, 666, 1664);
  await delay(200);
  await dragWorld(page, rect, [
    centerOfCell(0, 0),
    centerOfCell(0, 1),
    centerOfCell(0, 2),
    centerOfCell(1, 2),
    centerOfCell(2, 2)
  ]);
  await clickWorld(page, rect, 234, 1664);
  await delay(250);
  await clickWorld(page, rect, 450, 1664);
  await delay(1000);
}

async function runHumanInput(page, rect) {
  const centerX = rect.x + rect.width / 2;
  const paddleY = rect.y + rect.height * 0.9;

  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: centerX, y: paddleY });
  await page.send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: centerX,
    y: paddleY,
    button: 'left',
    clickCount: 1
  });
  await page.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: centerX,
    y: paddleY,
    button: 'left',
    clickCount: 1
  });
  await dispatchKey(page, 'Space', ' ', 32, 60);

  const started = Date.now();
  let step = 0;

  while (Date.now() - started < playTimeMs) {
    const targetRatio = [0.28, 0.72, 0.42, 0.58][step % 4];
    const startX = rect.x + rect.width * (step % 2 === 0 ? 0.48 : 0.52);
    const targetX = rect.x + rect.width * targetRatio;

    for (let index = 0; index < 8; index += 1) {
      const amount = index / 7;
      await page.send('Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x: startX + (targetX - startX) * amount,
        y: paddleY
      });
      await delay(55);
    }

    if (step % 4 === 0) {
      await dispatchKey(page, 'ArrowLeft', 'ArrowLeft', 37, 120);
    }

    if (step % 4 === 1) {
      await dispatchKey(page, 'ArrowRight', 'ArrowRight', 39, 120);
    }

    step += 1;
  }
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

  await waitForHttp(targetUrl);
  console.log(`Browser target: ${targetUrl}`);

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

  console.log(
    editorSmoke
      ? visible
        ? 'Opening a visible browser window for the editor smoke test.'
        : 'Running headless editor smoke test.'
      : visible
        ? `Opening a visible browser window for ${Math.round(playTimeMs / 1000)}s of play testing.`
        : `Running headless browser play test for ${Math.round(playTimeMs / 1000)}s.`
  );

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
  await delay(2500);

  const rectResult = await page.send('Runtime.evaluate', {
    expression: `(() => {
      const canvas = document.querySelector('canvas');
      if (!canvas) return null;
      const rect = canvas.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    })()`,
    returnByValue: true
  });
  const rect = rectResult.result.result.value;

  if (!rect) {
    throw new Error('Canvas not found');
  }

  console.log(`Browser canvas: ${JSON.stringify(rect)}`);

  await page.send('Runtime.evaluate', {
    expression: `(() => {
      const game = window.__bounceForge;
      if (!game) return false;
      game.scene.scenes.forEach((scene) => {
        if (scene.audioSystem?.setEnabled) scene.audioSystem.setEnabled(false);
      });
      return true;
    })()`,
    returnByValue: true
  });

  if (editorSmoke) {
    await runEditorSmoke(page, rect);
  } else {
    await runHumanInput(page, rect);
  }

  const screenshot = await page.send('Page.captureScreenshot', { format: 'png' });
  await writeFile('browser-test.png', Buffer.from(screenshot.result.data, 'base64'));

  const stateResult = await page.send('Runtime.evaluate', {
    expression: `(() => ({
      title: document.title,
      url: location.href,
      hasCanvas: Boolean(document.querySelector('canvas')),
      canvasCount: document.querySelectorAll('canvas').length
    }))()`,
    returnByValue: true
  });

  console.log(`Browser state: ${JSON.stringify(stateResult.result.result.value)}`);

  if (editorSmoke) {
    const editorStateResult = await page.send('Runtime.evaluate', {
      expression: `(() => {
        const raw = localStorage.getItem('bounce-forge.save.v1');
        const data = raw ? JSON.parse(raw) : null;
        const override = data?.creativeLevelSlots?.['0'];
        return {
          version: data?.version,
          hasOverride: Boolean(override),
          firstRow: override?.rows?.[0],
          name: override?.name
        };
      })()`,
      returnByValue: true
    });
    const editorState = editorStateResult.result.result.value;
    console.log(`Editor state: ${JSON.stringify(editorState)}`);

    if (!editorState?.hasOverride || editorState.version < 2) {
      console.error('Editor smoke test failed: slot override was not saved.');
      process.exitCode = 1;
    }
  }

  console.log(`Console log entries captured: ${consoleLogs.length}`);

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
