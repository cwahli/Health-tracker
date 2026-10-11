// Framed scroll probe: the REAL shell (Terminal tab) + REAL terminal page
// in an iframe, driven with trusted CDP wheel + touch. Counts keydowns
// inside the iframe document. No live session is touched (socket fails for
// the fake chat; xterm still mounts and the bridge still emits).
//
// Second half of the SCROLL GATE (see probe-tui-scroll.mjs): the top-level
// probe can be green while the SHELL breaks the chain (overlay trapping
// gestures, iframe mis-sandboxing, a stuck dropdown backdrop). Run both
// before landing terminal/shell changes.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const ROOT = '/home/ubuntu/dev/tui-scroll';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const GW_PORT = 18992;
const STATIC_PORT = 18991;
const CDP_PORT = 19292;

const prodEnv = {};
try {
  const txt = fs.readFileSync(path.join(os.homedir(), '.config', 'bot-host', 'tui-gateway.env'), 'utf8');
  for (const line of txt.split('\n')) {
    const m = line.match(/^([A-Za-z0-9_]+)=(.*)$/);
    if (m) prodEnv[m[1]] = m[2].trim();
  }
} catch {}

const statik = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const local = path.join(ROOT, 'dist', u.pathname.slice(1));
  if (fs.existsSync(local) && fs.statSync(local).isFile()) {
    const ext = path.extname(local);
    res.writeHead(200, { 'content-type': ext === '.html' ? 'text/html' : ext === '.js' ? 'text/javascript' : ext === '.css' ? 'text/css' : 'application/octet-stream' });
    fs.createReadStream(local).pipe(res);
    return;
  }
  res.writeHead(404); res.end('nope');
});
await new Promise((r) => statik.listen(STATIC_PORT, '127.0.0.1', r));

const gw = spawn('node', ['scripts/tui-gateway.mjs'], {
  cwd: ROOT,
  env: { ...process.env, TUI_GATEWAY_PORT: String(GW_PORT), TUI_GATEWAY_BIND: '127.0.0.1',
    TUI_GATEWAY_SECRET: 'probe-secret', TUI_BOT_TOKEN_VM: 'probe-token',
    TUI_TTYD_URL: 'http://127.0.0.1:8896', TUI_TTYD_CREDENTIAL: prodEnv.TUI_TTYD_CREDENTIAL || '',
    BUG_BOARD_UPSTREAM: `http://127.0.0.1:${STATIC_PORT}` },
  stdio: 'ignore',
});
const profile = fs.mkdtempSync('/tmp/opencode/framed-');
const chrome = spawn('/usr/bin/google-chrome', ['--headless=new', '--no-sandbox', '--disable-gpu',
  `--user-data-dir=${profile}`, `--remote-debugging-port=${CDP_PORT}`,
  '--window-size=560,950', 'about:blank'], { stdio: 'ignore' });

let failures = 0;
const check = (name, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${extra ? ` — ${extra}` : ''}`);
  if (!cond) failures += 1;
};
try {
  await sleep(2500);
  const gwMod = await import(path.join(ROOT, 'scripts', 'tui-gateway.mjs'));
  const token = gwMod.issueToken({ botId: 'web', chatId: 'firebase:probe', secret: 'probe-secret', ttlSec: 900 });
  const list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
  const ws = new WebSocket(list.find((t) => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const pending = new Map();
  ws.onmessage = (m) => { let d = null; try { d = JSON.parse(m.data); } catch { return; }
    if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } };
  const send = (method, params = {}) => new Promise((resolve) => { const cur = ++id;
    pending.set(cur, resolve); ws.send(JSON.stringify({ id: cur, method, params })); });
  const ev = (e) => send('Runtime.evaluate', { expression: e, returnByValue: true }).then((r) => r?.result?.result?.value);
  await send('Page.enable');
  await send('Page.navigate', { url: `http://127.0.0.1:${GW_PORT}/app/app?token=${encodeURIComponent(token)}&bot=web&tab=tui` });
  for (let i = 0; i < 40; i++) { await sleep(500);
    if (await ev(`!!document.querySelector('iframe')`)) break; }
  console.log('info shell has iframe:', await ev(`!!document.querySelector('iframe')`));
  // Wait for xterm inside the iframe.
  let mounted = false;
  for (let i = 0; i < 40; i++) { await sleep(500);
    mounted = await ev(`(()=>{const f=document.querySelector('iframe');try{return !!f.contentDocument.querySelector('.xterm-screen');}catch(e){return 'XORIGIN';}})()`);
    if (mounted === true) break; }
  console.log('info xterm in frame:', mounted);
  await sleep(1500);
  // Arm key counter INSIDE the frame.
  await ev(`(()=>{const f=document.querySelector('iframe');f.contentWindow.eval("window.__k=[];window.addEventListener('keydown',e=>{window.__k.push(e.key);},true);");})()`);
  const fkeys = () => ev(`(()=>{try{return document.querySelector('iframe').contentWindow.eval('window.__k.length');}catch(e){return -1;}})()`);

  // Wheel over the iframe (needs a positioned mouse first, per earlier finding).
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 280, y: 500 });
  await sleep(300);
  const b0 = await fkeys();
  await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 280, y: 500, deltaX: 0, deltaY: -320 });
  await sleep(800);
  const wkeys = (await fkeys()) - b0;
  check('framed wheel emits scroll keys in the frame', wkeys >= 1, `${wkeys} keys`);

  // Touch drag over the iframe.
  const touch = (type, points) => send('Input.dispatchTouchEvent', {
    type, touchPoints: points.map((p) => ({ x: p[0], y: p[1], id: 1 })) });
  const b1 = await fkeys();
  await touch('touchStart', [[280, 700]]);
  for (let y = 680; y >= 400; y -= 40) { await touch('touchMove', [[280, y]]); await sleep(30); }
  await touch('touchEnd', []);
  await sleep(800);
  const dkeys = (await fkeys()) - b1;
  check('framed touch drag emits scroll keys in the frame', dkeys >= 3, `${dkeys} keys`);
  ws.close();
} finally { chrome.kill('SIGKILL'); gw.kill('SIGKILL'); statik.close(); }
console.log(failures ? `FRAMED RED (${failures})` : 'FRAMED GREEN');
process.exit(failures ? 1 : 0);
