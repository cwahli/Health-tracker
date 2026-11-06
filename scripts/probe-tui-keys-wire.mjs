// Wire gate: WHICH synthesized keys become PTY bytes in this ttyd/xterm.
//
// The key-counting probes (probe-tui-scroll*.mjs) assert keys are DISPATCHED.
// They stay green while the real chain is broken one layer down: dispatched
// keys that xterm never turns into bytes. That exact hole stranded VM4 live
// (2026-10-11, cline lane): forty dispatched keys per drag, zero PTY bytes,
// zero movement — because Ctrl+Meta+letter produces nothing in ttyd 1.7.7's
// xterm, trusted or synthetic.
//
// This probe is hermetic (own lab ttyd + byte-echo, no live sessions) and
// asserts at the byte layer: the keys the touch path depends on MUST produce
// bytes, and the known-dead combo MUST still be dead (if a ttyd upgrade ever
// fixes Ctrl+Meta, this goes red on purpose — re-evaluate the bridge then).
//
// WIRE GATE: run this with probe-tui-scroll*.mjs before landing ANY change
// to the terminal page, the shell terminal tab, or the injected bridge.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TTYD_PORT = 9914;
const CDP_PORT = 19295;

// Byte echo: prints repr() of every stdin byte, flushed. No shell quoting:
// argv goes straight to execvp.
const ECHO_PY = 'import sys\nprint("READY",flush=True)\nwhile True:\n b=sys.stdin.buffer.read(1)\n if not b: break\n print(repr(b),flush=True)\n';

const ttyd = spawn('/usr/bin/ttyd', ['--port', String(TTYD_PORT), '--interface', '127.0.0.1',
  '--writable', '--max-clients', '0', '--base-path', '/wire',
  '--client-option', 'rendererType=dom',
  '--terminal-type', 'xterm-256color',
  'python3', '-c', ECHO_PY], { stdio: 'ignore' });
await sleep(1200);

const profile = fs.mkdtempSync(`${fs.realpathSync(os.tmpdir())}/wireprof-`);
const chrome = spawn('/usr/bin/google-chrome', ['--headless=new', '--no-sandbox', '--disable-gpu',
  `--user-data-dir=${profile}`, `--remote-debugging-port=${CDP_PORT}`,
  '--window-size=800,600', 'about:blank'], { stdio: 'ignore' });

let failures = 0;
const check = (name, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${extra ? ` — ${extra}` : ''}`);
  if (!cond) failures += 1;
};
try {
  await sleep(2500);
  const list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
  const ws = new WebSocket(list.find((t) => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const pending = new Map();
  ws.onmessage = (m) => { let d = null; try { d = JSON.parse(m.data); } catch { return; }
    if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } };
  const send = (method, params = {}) => new Promise((resolve) => { const cur = ++id;
    pending.set(cur, resolve); ws.send(JSON.stringify({ id: cur, method, params })); });
  const evA = (e) => send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }).then((r) => r?.result?.result?.value);
  await send('Page.enable');
  await send('Page.navigate', { url: `http://127.0.0.1:${TTYD_PORT}/wire/` });
  let ready = false;
  for (let i = 0; i < 30; i++) { await sleep(500);
    if (await evA(`document.body.innerText.includes('READY')`)) { ready = true; break; } }
  check('lab pty is up', ready);
  const screen = () => evA(`document.body.innerText`);
  const synth = (key, code, kc, mods) => evA(`(() => {
    const el = document.querySelector('.xterm-helper-textarea'); el.focus();
    const o = { bubbles: true, cancelable: true, keyCode: ${kc}, which: ${kc},
      key: '${key}', code: '${code}', ctrlKey: ${mods.ctrl ? 'true' : 'false'},
      altKey: ${mods.alt ? 'true' : 'false'}, metaKey: ${mods.meta ? 'true' : 'false'}, shiftKey: false };
    el.dispatchEvent(new KeyboardEvent('keydown', o));
    el.dispatchEvent(new KeyboardEvent('keyup', o)); return 'fired'; })()`);
  // The touch path's key (bare PageDown, keyCode 34) must survive xterm.
  let s0 = await screen();
  await synth('PageDown', 'PageDown', 34, {});
  await sleep(800);
  check('synthetic bare PageDown produces PTY bytes (touch path lives)',
    (await screen()).length > s0.length);
  // The wheel fine path's key (ctrl+alt+e) must survive xterm.
  s0 = await screen();
  await synth('e', 'KeyE', 69, { ctrl: true, alt: true });
  await sleep(800);
  check('synthetic ctrl+alt+e produces PTY bytes (wheel fine path lives)',
    (await screen()).length > s0.length);
  // The retired combo must still be dead. If this flips to BYTES, a ttyd
  // upgrade fixed Ctrl+Meta — do NOT just delete this check; re-evaluate
  // whether the touch path can use fine keys again.
  s0 = await screen();
  await synth('d', 'KeyD', 68, { ctrl: true, meta: true });
  await sleep(800);
  check('synthetic ctrl+meta+d still produces no bytes (xterm limitation stands)',
    (await screen()).length === s0.length);
  ws.close();
} finally { chrome.kill('SIGKILL'); try { ttyd.kill('SIGKILL'); } catch {} }
console.log(failures ? `WIRE GATE RED (${failures})` : 'WIRE GATE GREEN');
process.exit(failures ? 1 : 0);
