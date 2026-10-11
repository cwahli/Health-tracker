// Live scroll probe: real ttyd page + gateway injections in real Chromium.
// Dispatches REAL wheel (CDP mouseWheel) and REAL touch sequences (CDP
// dispatchTouchEvent) and counts keydowns that reach the document.
//
// SCROLL GATE: run this (and probe-tui-scroll-framed.mjs) before landing ANY
// change to the terminal page, the shell terminal tab, or the injected
// bridge. The unit sensor (assert-tui-gateway 12a6/12a7) runs the bridge
// against stubs — it stays green while the real chain is broken (wrong
// element, dead listener, swallowed gesture). These probes drive the real
// chain: real ttyd bundle, real xterm DOM, real Chromium input. A red probe
// blocks the change, whatever the unit sensor says.
// Run: node scripts/probe-tui-scroll.mjs [--keep]
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const GW_PORT = 18998;
const CDP_PORT = 19299;

function loadSecretEnv() {
  const out = {};
  try {
    const txt = fs.readFileSync(path.join(os.homedir(), '.config', 'bot-host', 'tui-gateway.env'), 'utf8');
    for (const line of txt.split('\n')) {
      const m = line.match(/^([A-Za-z0-9_]+)=(.*)$/);
      if (m) out[m[1]] = m[2].trim();
    }
  } catch { /* no prod env — caller must supply */ }
  return out;
}

const prodEnv = loadSecretEnv();
const ttydCred = prodEnv.TUI_TTYD_CREDENTIAL || '';
const ttydUrl = 'http://127.0.0.1:8896';

const gw = spawn('node', ['scripts/tui-gateway.mjs'], {
  cwd: ROOT,
  env: {
    ...process.env,
    TUI_GATEWAY_PORT: String(GW_PORT),
    TUI_GATEWAY_BIND: '127.0.0.1',
    TUI_GATEWAY_SECRET: 'probe-secret',
    TUI_BOT_TOKEN_VM: 'probe-token',
    TUI_TTYD_URL: ttydUrl,
    TUI_TTYD_CREDENTIAL: ttydCred,
    BUG_BOARD_UPSTREAM: 'http://127.0.0.1:9',
  },
  stdio: 'ignore',
});

const profile = fs.mkdtempSync('/tmp/opencode/scroll-prof-');
const chrome = spawn('/usr/bin/google-chrome', [
  '--headless=new', '--no-sandbox', '--disable-gpu',
  `--user-data-dir=${profile}`,
  `--remote-debugging-port=${CDP_PORT}`,
  '--window-size=560,950', 'about:blank',
], { stdio: 'ignore' });

let failures = 0;
const check = (name, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${extra ? ` — ${extra}` : ''}`);
  if (!cond) failures += 1;
};

try {
  await sleep(2500);
  const gwMod = await import(path.join(ROOT, 'scripts', 'tui-gateway.mjs'));
  const token = gwMod.issueToken({ botId: 'vm', chatId: 'probe', secret: 'probe-secret', ttlSec: 900 });

  // Gateway up?
  let up = false;
  for (let i = 0; i < 30; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${GW_PORT}/tty/?token=${encodeURIComponent(token)}`);
      if (r.status === 200) { up = true; break; }
    } catch {}
    await sleep(500);
  }
  check('gateway serves the injected terminal page', up);
  if (!up) process.exit(2);

  const list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
  const page = list.find((t) => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (m) => {
    let d = null;
    try { d = JSON.parse(m.data); } catch { return; }
    if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); }
  };
  const send = (method, params = {}) => new Promise((resolve) => {
    const cur = ++id;
    pending.set(cur, resolve);
    ws.send(JSON.stringify({ id: cur, method, params }));
  });
  const ev = (e) => send('Runtime.evaluate', { expression: e, returnByValue: true }).then((r) => r?.result?.result?.value);

  await send('Page.enable');
  await send('Page.navigate', { url: `http://127.0.0.1:${GW_PORT}/tty/?token=${encodeURIComponent(token)}` });
  // Wait for xterm to mount (real bundle boot + failed-socket retries).
  let mounted = false;
  for (let i = 0; i < 40; i++) {
    await sleep(500);
    if (await ev(`!!document.querySelector('.xterm-screen')`)) { mounted = true; break; }
  }
  check('xterm mounts in the served page', mounted);
  console.log('info helper-textarea:', await ev(`!!document.querySelector('.xterm-helper-textarea')`));
  console.log('info bridge present:', await ev(`document.documentElement.innerHTML.includes('emitFine')`));

  // Capture every keydown at the document (capture phase) with its modifiers.
  await ev(`window.__keys=[];window.addEventListener('keydown',e=>{window.__keys.push(e.key+'|'+(e.ctrlKey?1:0)+(e.altKey?1:0)+(e.metaKey?1:0));},true);`);
  const keyCount = () => ev(`window.__keys.length`);
  const keys = () => ev(`window.__keys.join(',')`);

  // 1. REAL wheel over the terminal: CDP mouseWheel at the viewport centre.
  // Position the mouse first: headless CDP drops a wheel that has no prior
  // mouse position (it never reaches the DOM at all — a harness quirk, not
  // a product signal; a blank-page control proves delivery works).
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 280, y: 475 });
  await sleep(300);
  const before = await keyCount();
  await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 280, y: 475, deltaX: 0, deltaY: -320 });
  await sleep(800);
  const wheelKeys = (await keyCount()) - before;
  console.log('info wheel keys:', await keys());
  check('wheel over an alt-screen terminal emits scroll keys', wheelKeys >= 1, `${wheelKeys} keys`);

  // 2. REAL touch drag: touchStart → touchMove ×N → touchEnd.
  await ev(`window.__keys=[]`);
  const touch = (type, points) => send('Input.dispatchTouchEvent', {
    type, touchPoints: points.map((p) => ({ x: p[0], y: p[1], id: 1 })),
  });
  await touch('touchStart', [[280, 700]]);
  for (let y = 680; y >= 400; y -= 40) { await touch('touchMove', [[280, y]]); await sleep(30); }
  await touch('touchEnd', []);
  await sleep(800);
  const dragKeys = await keyCount();
  console.log('info drag keys:', (await keys()).slice(0, 300));
  check('touch drag over the terminal emits scroll keys', dragKeys >= 3, `${dragKeys} keys`);

  // 3. A tap (sub-line nudge) must NOT scroll.
  await ev(`window.__keys=[]`);
  await touch('touchStart', [[280, 700]]);
  await touch('touchMove', [[280, 696]]);
  await touch('touchEnd', []);
  await sleep(500);
  check('a tap does not scroll', (await keyCount()) === 0, `${await keyCount()} keys`);

  ws.close();
} finally {
  chrome.kill('SIGKILL');
  gw.kill('SIGKILL');
  if (!process.argv.includes('--keep')) {
    // Best-effort: Chrome may still hold profile files for a moment after
    // SIGKILL; a failed rm must not fail the probe (nor litter beyond /tmp).
    try { await sleep(500); fs.rmSync(profile, { recursive: true, force: true }); } catch { /* /tmp cleans itself */ }
  }
}
console.log(failures ? `PROBE RED (${failures})` : 'PROBE GREEN');
process.exit(failures ? 1 : 0);
