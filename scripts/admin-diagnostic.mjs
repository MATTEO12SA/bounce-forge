#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';

const root = process.cwd();
const edgeCandidates = [
  process.env.BROWSER_TEST_EDGE_PATH,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe'
].filter(Boolean);
const browserPath = edgeCandidates.find((candidate) => existsSync(candidate));
const cdpPort = Number(process.env.BROWSER_TEST_CDP_PORT ?? 9231);
const appPort = Number(process.env.BROWSER_TEST_APP_PORT ?? 5174);
const apiPort = Number(process.env.BROWSER_TEST_API_PORT ?? 8788);
const userDataDir = `${root}/.edge-admin-test-profile`;
const targetUrl = `http://localhost:${appPort}/?menu=1`;
const adminPassword = 'admin-test-password';
const tempDir = await mkdtemp(join(tmpdir(), 'bounce-forge-admin-browser-'));
const overrideFile = join(tempDir, 'campaign-level-overrides.json');

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

async function waitForHttp(url, timeoutMs = 15000) {
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
            }, 15000);
            pending.set(callId, (message) => {
              clearTimeout(timer);
              if (message.error) {
                fail(new Error(message.error.message));
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
    ws.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.id && pending.has(message.id)) {
        pending.get(message.id)(message);
        pending.delete(message.id);
      }
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

let server;
let browser;
let page;

try {
  await rm(userDataDir, { recursive: true, force: true });
  await writeFile(overrideFile, '{"overrides":[]}\n', 'utf8');

  server = spawn(process.execPath, ['scripts/start-dev.mjs'], {
    cwd: root,
    env: {
      ...process.env,
      ADMIN_PASSWORD: adminPassword,
      CAMPAIGN_OVERRIDES_FILE: overrideFile,
      PORT: String(appPort),
      API_PORT: String(apiPort)
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  server.stdout.on('data', (data) => process.stdout.write(data));
  server.stderr.on('data', (data) => process.stderr.write(data));
  await waitForHttp(targetUrl);

  browser = spawn(browserPath, [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--disable-extensions',
    `--remote-debugging-port=${cdpPort}`,
    `--user-data-dir=${userDataDir}`,
    '--window-size=390,600',
    'about:blank'
  ]);
  await waitForHttp(`http://localhost:${cdpPort}/json/version`);
  const target = await requestJson(
    `http://localhost:${cdpPort}/json/new?${encodeURIComponent(targetUrl)}`,
    'PUT'
  );
  page = await createCdpClient(target.webSocketDebuggerUrl);
  await page.send('Runtime.enable');
  await page.send('Page.enable');
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const ready = await page.send('Runtime.evaluate', {
      expression: `Boolean(window.__bounceForge?.scene?.isActive('MainMenuScene'))`,
      returnByValue: true
    });
    if (ready.result.result.value) {
      break;
    }
    await delay(250);
  }

  const state = await page.send('Runtime.evaluate', {
    expression: `(async () => {
      const game = window.__bounceForge;
      const collectTexts = (items) => items.flatMap((child) => [
        ...(child.type === 'Text' ? [child.text] : []),
        ...(Array.isArray(child.list) ? collectTexts(child.list) : [])
      ]);
      const sceneTexts = () => game.scene.scenes
        .filter((scene) => scene.scene.isActive())
        .flatMap((scene) => collectTexts(scene.children?.list ?? []));
      const stopActiveScenes = () => game.scene.scenes.forEach((scene) => {
        if (scene.scene.isActive()) scene.scene.stop();
      });
      const readButtonLabel = (button) => collectTexts(button.list ?? []).join('');
      const readEditorSlotPage = async (editor, slotIndex) => {
        editor.loadSlot(slotIndex, 'Diagnostic slots.');
        await new Promise((resolve) => setTimeout(resolve, 100));
        return editor.slotButtons
          .map((button) => ({
            label: readButtonLabel(button),
            x: button.x,
            y: button.y
          }))
          .filter((button) => /^\\d+\\*?$/.test(button.label));
      };
      const startMainMenuAndReadTexts = async () => {
        stopActiveScenes();
        game.scene.start('MainMenuScene');
        await new Promise((resolve) => setTimeout(resolve, 550));
        return sceneTexts();
      };

      const menuTexts = sceneTexts();
      const menuHasGuide = menuTexts.includes('GUIDE');
      stopActiveScenes();
      game.scene.start('GameScene', { levelIndex: 0 });
      await new Promise((resolve) => setTimeout(resolve, 250));
      const gameplayTexts = sceneTexts();

      stopActiveScenes();
      game.scene.start('LevelEditorScene', { mode: 'creative', slotIndex: 0 });
      await new Promise((resolve) => setTimeout(resolve, 250));
      const creative = game.scene.getScene('LevelEditorScene');
      creative.rows = ['BS..................................', ...creative.rows.slice(1)];
      await creative.saveCurrentSlot();
      stopActiveScenes();
      game.scene.start('GameScene', { levelIndex: 0 });
      await new Promise((resolve) => setTimeout(resolve, 250));
      const campaignNameAfterCreativeSave = game.scene.getScene('GameScene').level.name;

      const login = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: '${adminPassword}' })
      });

      stopActiveScenes();
      game.scene.start('AdminMenuScene');
      await new Promise((resolve) => setTimeout(resolve, 250));
      const adminMenuTexts = sceneTexts();
      const adminMenu = game.scene.getScene('AdminMenuScene');
      adminMenu.input.keyboard.emit('keydown-ESC');
      await new Promise((resolve) => setTimeout(resolve, 550));
      const menuTextsAfterEsc = sceneTexts();
      const sessionAfterEsc = await fetch('/api/admin/session').then((response) => response.json());

      stopActiveScenes();
      game.scene.start('LevelEditorScene', { mode: 'admin', slotIndex: 0 });
      await new Promise((resolve) => setTimeout(resolve, 250));
      const adminEditorTexts = sceneTexts();
      const adminEditor = game.scene.getScene('LevelEditorScene');
      adminEditor.rows = Array.from({ length: 58 }, (_, row) =>
        row === 0 ? '1' + '.'.repeat(35) : '.'.repeat(36)
      );
      const adminEditorSaved = await adminEditor.saveCurrentSlot();
      adminEditor.saveSystem.removeCreativeLevelSlot(0);
      adminEditor.copyToCreativeSlot();
      const copiedCreativeName = adminEditor.saveSystem.getCreativeLevelSlot(0)?.name;
      const adminSlotPageTwo = await readEditorSlotPage(adminEditor, 6);
      const adminSlotPageFour = await readEditorSlotPage(adminEditor, 18);

      stopActiveScenes();
      game.scene.start('GameScene', { levelIndex: 0 });
      await new Promise((resolve) => setTimeout(resolve, 250));
      const adminCampaignScene = game.scene.getScene('GameScene');
      const adminCampaignBreakable = adminCampaignScene.bricks
        .getChildren()
        .filter((brick) => brick.isBreakable).length;

      const overrides = await fetch('/api/admin/campaign-levels').then((response) => response.json());
      const resetResult = await fetch('/api/admin/campaign-levels/0', { method: 'DELETE' }).then((response) => response.json());
      const overridesAfterReset = await fetch('/api/admin/campaign-levels').then((response) => response.json());
      return {
        menuHasAdmin: menuTexts.includes('ADMIN'),
        menuHasCreative: menuTexts.includes('MODE CREATIF'),
        menuHasGuide,
        gameplayHasAdmin: gameplayTexts.includes('ADMIN'),
        campaignNameAfterCreativeSave,
        loginStatus: login.status,
        adminMenuHasEditor: adminMenuTexts.includes('CAMPAIGN EDITOR'),
        adminMenuHasPreview: adminMenuTexts.includes('LEVEL SELECT'),
        adminMenuHasRefresh: adminMenuTexts.includes('REFRESH DATA'),
        adminEditorHasUndo: adminEditorTexts.includes('UNDO'),
        adminEditorHasImport: adminEditorTexts.includes('IMPORT CODE'),
        adminEditorHasCopyLocal: adminEditorTexts.includes('COPY LOCAL'),
        menuAfterEscHasAdminEditor: menuTextsAfterEsc.includes('ADMIN EDITOR'),
        sessionAfterEscAuthenticated: sessionAfterEsc.authenticated,
        adminEditorSaved,
        copiedCreativeName,
        adminCampaignBreakable,
        savedOverrideName: overrides.overrides?.[0]?.name,
        resetRemoved: resetResult.removed,
        overridesAfterResetCount: overridesAfterReset.overrides?.length,
        adminSlotPageTwo,
        adminSlotPageFour
      };
    })()`,
    returnByValue: true,
    awaitPromise: true
  });

  const result = state.result.result.value;
  console.log(JSON.stringify(result, null, 2));

  if (!result.menuHasAdmin || !result.menuHasCreative) {
    throw new Error('Main menu does not expose ADMIN and MODE CREATIF.');
  }
  if (!result.menuHasGuide) {
    throw new Error('Main menu does not expose GUIDE.');
  }
  if (result.gameplayHasAdmin) {
    throw new Error('ADMIN button leaked into gameplay.');
  }
  if (result.campaignNameAfterCreativeSave !== 'Warm Ignition') {
    throw new Error('Creative save modified the campaign.');
  }
  if (result.loginStatus !== 200 || !result.adminEditorSaved) {
    throw new Error('Admin login or editor save failed.');
  }
  if (!result.adminMenuHasEditor || !result.adminMenuHasPreview || !result.adminMenuHasRefresh) {
    throw new Error('Admin menu is missing required admin actions.');
  }
  if (
    !result.adminEditorHasUndo ||
    !result.adminEditorHasImport ||
    !result.adminEditorHasCopyLocal
  ) {
    throw new Error('Admin editor is missing editor/admin utility actions.');
  }
  if (!result.sessionAfterEscAuthenticated || !result.menuAfterEscHasAdminEditor) {
    throw new Error('Admin session did not persist back to the main menu after Escape.');
  }
  if (result.copiedCreativeName !== 'Creative 1') {
    throw new Error('Admin editor did not duplicate the campaign grid to a creative slot.');
  }
  if (result.adminCampaignBreakable !== 1) {
    throw new Error('Admin campaign override did not replace the campaign level in gameplay.');
  }
  if (result.savedOverrideName !== 'Warm Ignition') {
    throw new Error('Admin override was not saved through the API.');
  }
  if (!result.resetRemoved || result.overridesAfterResetCount !== 0) {
    throw new Error('Admin override reset did not remove the saved override.');
  }
  const pageTwoLabels = result.adminSlotPageTwo.map((button) => button.label);
  const pageFourLabels = result.adminSlotPageFour.map((button) => button.label);
  if (pageTwoLabels.join(',') !== '7,8,9,10,11,12') {
    throw new Error(`Admin editor page 2 labels are wrong: ${pageTwoLabels.join(',')}`);
  }
  if (pageFourLabels.join(',') !== '19,20,21,22,23,24') {
    throw new Error(`Admin editor page 4 labels are wrong: ${pageFourLabels.join(',')}`);
  }
  const visibleSlotButtons = [...result.adminSlotPageTwo, ...result.adminSlotPageFour];
  if (visibleSlotButtons.some((button) => button.x < 0 || button.x > 1080)) {
    throw new Error('Admin editor paged slot buttons are outside the world bounds.');
  }
} finally {
  page?.close?.();
  await stopProcessTree(browser);
  await stopProcessTree(server);
  await rm(userDataDir, { recursive: true, force: true });
  await rm(tempDir, { recursive: true, force: true });
}
