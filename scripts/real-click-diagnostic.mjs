#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
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
const browserPath = edgeCandidates.find((c) => existsSync(c));
if (!browserPath) {
  console.error('No browser found.');
  process.exit(1);
}
const userDataDir = `${root}/.edge-real-click-profile`;
const cdpPort = 9244;
const targetUrl = 'http://localhost:5173/?menu=1';

function request(path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : '';
    const req = http.request(
      {
        hostname: 'localhost',
        port: cdpPort,
        path,
        method: body ? 'POST' : 'GET',
        headers: body
          ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
          : {}
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString() || '{}'));
          } catch (err) {
            reject(err);
          }
        });
      }
    );
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

const browser = spawn(
  browserPath,
  [
    `--remote-debugging-port=${cdpPort}`,
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--window-size=720,1280',
    visible ? '' : '--headless=new',
    '--disable-gpu',
    targetUrl
  ].filter(Boolean),
  { stdio: 'ignore', detached: false }
);

let exitCode = 1;
try {
  await delay(2500);
  let tabs = [];
  for (let i = 0; i < 30; i += 1) {
    try {
      tabs = await request('/json/list');
      if (tabs.find((t) => /localhost:5173/.test(t.url))) break;
    } catch {
      // Browser can take a moment to expose the debugging target.
    }
    await delay(500);
  }
  const tab = tabs.find((t) => /localhost:5173/.test(t.url));
  if (!tab) throw new Error('No tab on localhost:5173');

  const ws = await import('ws').then((m) => m.default).catch(() => null);
  if (!ws) throw new Error('install ws or use a built-in CDP client');

  const sock = new ws(tab.webSocketDebuggerUrl);
  let id = 1;
  const pending = new Map();
  await new Promise((res) => sock.on('open', res));
  sock.on('message', (msg) => {
    const data = JSON.parse(msg.toString());
    if (data.id && pending.has(data.id)) {
      pending.get(data.id)(data);
      pending.delete(data.id);
    }
  });
  function send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const cur = id++;
      pending.set(cur, (m) => (m.error ? reject(new Error(m.error.message)) : resolve(m.result)));
      sock.send(JSON.stringify({ id: cur, method, params }));
    });
  }
  async function evalExpr(expression) {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true });
    return r.result.value;
  }

  // wait for game ready
  for (let i = 0; i < 60; i += 1) {
    const ready = await evalExpr(
      "(() => Boolean(window.__bounceForge?.scene?.scenes?.length && document.querySelector('canvas')))()"
    );
    if (ready) break;
    await delay(250);
  }

  // navigate to OptionsScene by stopping every active scene first then starting Options
  await evalExpr(`
    (() => {
      const game = window.__bounceForge;
      const active = game.scene.getScenes(true);
      active.forEach(s => { if (s.scene.key !== 'OptionsScene') game.scene.stop(s.scene.key); });
      if (!game.scene.isActive('OptionsScene')) game.scene.start('OptionsScene', { returnTo: 'MainMenuScene' });
      return active.map(s => s.scene.key);
    })();
  `);
  await delay(1500);

  // verify we're on OptionsScene
  const activeScenes = await evalExpr(
    `window.__bounceForge.scene.getScenes(true).map(s => s.scene.key)`
  );
  console.log('Active scenes after switch:', activeScenes);

  // dump viewport / canvas info
  const viewport = await evalExpr(`
    (() => {
      const canvas = document.querySelector('canvas');
      const rect = canvas?.getBoundingClientRect();
      return {
        innerW: window.innerWidth, innerH: window.innerHeight,
        scrollX: window.scrollX, scrollY: window.scrollY,
        canvasRect: rect ? { x: rect.left, y: rect.top, w: rect.width, h: rect.height, bottom: rect.bottom } : null,
        bodyRect: document.body.getBoundingClientRect(),
        documentH: document.documentElement.scrollHeight
      };
    })();
  `);
  console.log('Viewport info:', JSON.stringify(viewport, null, 2));

  // collect button info — including nested ones
  const info = await evalExpr(`
    (() => {
      const game = window.__bounceForge;
      const scene = game.scene.getScene('OptionsScene');
      if (!scene) return { error: 'no scene' };
      const canvas = document.querySelector('canvas');
      const rect = canvas.getBoundingClientRect();
      const scaleX = rect.width / scene.scale.gameSize.width;
      const scaleY = rect.height / scene.scale.gameSize.height;

      function getWorldPos(go) {
        let wx = go.x ?? 0, wy = go.y ?? 0;
        let p = go.parentContainer;
        while (p) {
          wx = wx + (p.x ?? 0);
          wy = wy + (p.y ?? 0);
          p = p.parentContainer;
        }
        return { wx, wy };
      }

      const interactives = [];
      function visit(node, depth = 0) {
        if (!node || depth > 6) return;
        if (node.input && node.input.enabled) {
          const { wx, wy } = getWorldPos(node);
          const lbl = (node.list || []).find(p => p.type === 'Text')?.text;
          interactives.push({
            kind: node.constructor?.name,
            label: lbl,
            worldX: wx, worldY: wy,
            screenX: rect.left + wx * scaleX,
            screenY: rect.top + wy * scaleY,
            hitArea: node.input.hitArea ? { x: node.input.hitArea.x, y: node.input.hitArea.y, w: node.input.hitArea.width, h: node.input.hitArea.height } : null,
            cursor: node.input.cursor
          });
        }
        if (Array.isArray(node.list)) {
          node.list.forEach(child => visit(child, depth + 1));
        }
      }
      scene.children.list.forEach(c => visit(c));

      return {
        sceneKey: scene.scene.key,
        canvasRect: { x: rect.left, y: rect.top, w: rect.width, h: rect.height },
        gameSize: { w: scene.scale.gameSize.width, h: scene.scale.gameSize.height },
        interactives
      };
    })();
  `);

  console.log(JSON.stringify(info, null, 2));
  if (!info?.interactives?.length) throw new Error('no interactives found in OptionsScene');

  // install click instrumentation on every interactive
  await evalExpr(`
    (() => {
      const game = window.__bounceForge;
      const scene = game.scene.getScene('OptionsScene');
      window.__clickLog = [];
      function visit(node, depth = 0) {
        if (!node || depth > 6) return;
        if (node.input && node.input.enabled) {
          const lbl = (node.list || []).find(p => p.type === 'Text')?.text ?? node.constructor?.name;
          ['pointerdown', 'pointerover'].forEach(evt => {
            node.on(evt, () => window.__clickLog.push({ tag: lbl, kind: node.constructor?.name, evt, t: Date.now() }));
          });
        }
        if (Array.isArray(node.list)) {
          node.list.forEach(child => visit(child, depth + 1));
        }
      }
      scene.children.list.forEach(c => visit(c));
    })();
  `);

  // test each interactive: dispatch real click at its screen center, see what registers
  // SKIP FULLSCREEN toggle (the first one) since clicking it might affect canvas state
  const orderedInteractives = info.interactives.filter(
    (it) => !(it.kind === 'ToggleSwitch' && it.label === 'OFF')
  );
  const results = [];
  for (const it of orderedInteractives) {
    if (!Number.isFinite(it.screenX) || !Number.isFinite(it.screenY)) continue;
    await evalExpr('window.__clickLog = [];');
    await send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: it.screenX,
      y: it.screenY,
      button: 'none'
    });
    await delay(120);
    await send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: it.screenX,
      y: it.screenY,
      button: 'left',
      clickCount: 1
    });
    await delay(40);
    await send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: it.screenX,
      y: it.screenY,
      button: 'left',
      clickCount: 1
    });
    await delay(180);
    const log = await evalExpr('window.__clickLog');
    results.push({
      target: `${it.kind}/${it.label ?? '-'} @ (${Math.round(it.screenX)},${Math.round(it.screenY)})`,
      events: (log || []).map((e) => `${e.kind}/${e.tag}:${e.evt}`)
    });
  }

  // Dump scene's full input list (what Phaser actually thinks is interactive)
  const inputList = await evalExpr(`
    (() => {
      const game = window.__bounceForge;
      const scene = game.scene.getScene('OptionsScene');
      // scene.input._list is private; try public alternatives
      const list = (scene.input._list || []).map(go => ({
        kind: go.constructor?.name,
        x: go.x, y: go.y,
        depth: go.depth,
        enabled: go.input?.enabled,
        hit: go.input?.hitArea ? { x: go.input.hitArea.x, y: go.input.hitArea.y, w: go.input.hitArea.width, h: go.input.hitArea.height } : null
      }));
      const children = scene.children.list.map(c => ({ kind: c.constructor?.name, x: c.x, y: c.y, depth: c.depth }));
      return { inputListLen: list.length, inputList: list, sceneChildren: children };
    })();
  `);
  console.log('\nScene input list:', JSON.stringify(inputList, null, 2));

  console.log('\n=== Per-interactive click results ===');
  results.forEach((r) =>
    console.log(`${r.target}\n   -> ${r.events.length ? r.events.join(', ') : 'NO EVENT'}`)
  );

  // For each FAILING click, ask Phaser what it found at that pointer position
  const failing = info.interactives.filter((it, i) => results[i] && results[i].events.length === 0);
  if (failing.length) {
    console.log('\n=== Probing failing positions ===');
    for (const it of failing) {
      // Use Phaser's actual hit test
      const hitTest = await evalExpr(`
        (() => {
          const game = window.__bounceForge;
          const scene = game.scene.getScene('OptionsScene');
          const wx = ${it.worldX};
          const wy = ${it.worldY};
          const pointer = scene.input.activePointer;
          // Manually create a fake pointer for hit testing
          const fakePointer = { worldX: wx, worldY: wy, x: wx, y: wy };
          const cam = scene.cameras.main;
          fakePointer.camera = cam;
          let hits = null;
          try {
            hits = scene.input.hitTestPointer(fakePointer);
          } catch (e) {
            return { error: String(e) };
          }
          return {
            hitCount: (hits || []).length,
            hits: (hits || []).map(g => ({ kind: g.constructor?.name, x: g.x, y: g.y, depth: g.depth }))
          };
        })();
      `);
      console.log(
        `Phaser hit test for ${it.kind}/${it.label} at world (${it.worldX}, ${it.worldY}):`,
        JSON.stringify(hitTest)
      );

      const probe = await evalExpr(`
        (() => {
          const game = window.__bounceForge;
          const scene = game.scene.getScene('OptionsScene');
          const inputPlugin = scene.input;
          const canvas = document.querySelector('canvas');
          const rect = canvas.getBoundingClientRect();
          // synthesize a fake pointer position at the screen coords
          const screenX = ${it.screenX};
          const screenY = ${it.screenY};
          // ask what's underneath via the DOM
          const elFromPoint = document.elementFromPoint(screenX, screenY);
          // ask Phaser what interactives are hit at that world pos
          const worldX = ${it.worldX};
          const worldY = ${it.worldY};
          const hits = [];
          function visit(node, depth = 0) {
            if (!node || depth > 6) return;
            if (node.input && node.input.enabled) {
              const lbl = (node.list || []).find(p => p.type === 'Text')?.text;
              const wx = (function() { let x=node.x??0,y=node.y??0,p=node.parentContainer; while(p){x+=p.x??0;y+=p.y??0;p=p.parentContainer}return {x,y}; })();
              const ha = node.input.hitArea;
              const lx = worldX - wx.x;
              const ly = worldY - wx.y;
              const inside = ha && lx >= ha.x && lx < ha.x + ha.width && ly >= ha.y && ly < ha.y + ha.height;
              if (inside) hits.push({ kind: node.constructor?.name, label: lbl, depth: node.depth ?? '-' });
            }
            if (Array.isArray(node.list)) node.list.forEach(c => visit(c, depth + 1));
          }
          scene.children.list.forEach(c => visit(c));
          return {
            target: '${it.kind}/${it.label ?? '-'} at (' + screenX + ',' + screenY + ')',
            domEl: elFromPoint ? elFromPoint.tagName + (elFromPoint.id ? '#' + elFromPoint.id : '') : null,
            phaserInteractivesAtWorld: hits
          };
        })();
      `);
      console.log(JSON.stringify(probe, null, 2));
    }
  }

  exitCode = 0;

  sock.close();
} catch (err) {
  console.error(err);
} finally {
  browser.kill();
  process.exit(exitCode);
}
