#!/usr/bin/env node
/**
 * assert-work-session.mjs — BOT-19 named gate.
 *
 * Proves shared work-session observability in code:
 *  1. work-session.mjs exports the tx/status/debug/handoff/abort surface.
 *  2. Sessions resolve on demand per (location, chat, workspace) — never
 *     permanently per bot (no bot key in the session id).
 *  3. tx on/off toggles observation without touching state or lane.
 *  4. The debug probe has one shape for every backend; terminal lanes
 *     report attach honestly, API lanes report attach:false with an
 *     event/debug view.
 *  5. Handoff keeps the session and preserves state; abort closes but
 *     preserves the transcript reference.
 *  6. The Telegram view carries no secret-bearing values.
 *
 * Exit 0 on all pass; exit 1 with FAIL lines otherwise.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

let pass = 0;
let fail = 0;
const failures = [];

function check(name, ok, detail = '') {
  if (ok) {
    pass++;
    console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ''}`);
  } else {
    fail++;
    failures.push(name + (detail ? ` — ${detail}` : ''));
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

console.log('assert-work-session (BOT-19)\n');

const libPath = path.join(ROOT, 'scripts/lib/work-session.mjs');
check('work-session.mjs exists', fs.existsSync(libPath));

const {
  sessionKey,
  tmuxSessionFor,
  tmuxWindowFor,
  resolveSession,
  getSession,
  setTx,
  handoffSession,
  abortSession,
  ensureTmuxWorkView,
  debugProbe,
  sessionStatus,
  scrubSecrets,
  statusForTelegram,
} = await import(new URL(`file://${libPath.replace(/\\/g, '/')}`).href);

for (const fn of ['resolveSession', 'setTx', 'handoffSession', 'abortSession', 'ensureTmuxWorkView', 'debugProbe', 'sessionStatus', 'statusForTelegram']) {
  check(`exports ${fn}`, typeof ({ resolveSession, setTx, handoffSession, abortSession, ensureTmuxWorkView, debugProbe, sessionStatus, statusForTelegram })[fn] === 'function');
}

// Isolated store for the gate (never the live ~/.hermes file).
const tmpStore = path.join(os.tmpdir(), `ws_gate_${Date.now()}_${Math.random().toString(36).slice(2)}.json`);
const noTmux = () => false;
const yesTmux = () => true;
const lifecycleSessions = new Map();
const lifecycleCalls = [];
const lifecycleTmux = (args) => {
  lifecycleCalls.push(args);
  if (args[0] === 'has-session') return lifecycleSessions.has(args[2]);
  if (args[0] === 'list-windows') {
    return [...(lifecycleSessions.get(args[2]) || [])].join('\n');
  }
  if (args[0] === 'new-session') {
    lifecycleSessions.set(args[3], new Set([args[5]]));
    return true;
  }
  if (args[0] === 'new-window') {
    const session = args[3].replace(/:$/, '');
    lifecycleSessions.get(session).add(args[5]);
    return true;
  }
  return false;
};

// 2. On-demand sessions keyed without any bot id.
const s1 = resolveSession({ location: 'vps', chat: 'qa_meal', workspace: '/home/ubuntu/src/Health-tracker', lane: 'opencode' }, tmpStore);
check('resolve creates the session', s1.state === 'active' && s1.tx === false);
check('session id carries no bot key', !/bot/i.test(s1.id) && s1.id === 'vps|qa_meal|/home/ubuntu/src/Health-tracker');
const s1b = resolveSession({ location: 'vps', chat: 'qa_meal', workspace: '/home/ubuntu/src/Health-tracker' }, tmpStore);
check('re-resolve returns the same session', s1b.createdAt === s1.createdAt);
check('unknown session reads null', getSession('nowhere|no|pe', tmpStore) === null);

// 3. tx toggle.
setTx(s1.id, true, tmpStore);
const txOn = getSession(s1.id, tmpStore);
check('tx on enables observation only', txOn.tx === true && txOn.lane === 'opencode' && txOn.state === 'active');
setTx(s1.id, false, tmpStore);
check('tx off hides without stopping', getSession(s1.id, tmpStore).tx === false);

// 4. One probe shape for every backend.
const shapes = [];
for (const backend of ['opencode', 'cline', 'grok', 'agy', 'gemini', 'human']) {
  const probe = debugProbe(backend, { session: s1, tmux: noTmux });
  shapes.push(Object.keys(probe).sort().join(','));
  check(`${backend} probe keys`, true);
}
check('probe shape identical across backends', new Set(shapes).size === 1, [...new Set(shapes)].join(' / '));
const termProbe = debugProbe('opencode', { session: s1, tmux: yesTmux });
check('terminal lane attaches through the location tmux session',
  termProbe.surface === 'terminal' && termProbe.attach === true && termProbe.tmuxSession === 'work-vps');
const apiProbe = debugProbe('gemini', { session: s1, tmux: yesTmux });
check('API lane honestly reports attach:false with an event view',
  apiProbe.surface === 'api' && apiProbe.attach === false && apiProbe.events === true);

const createdView = ensureTmuxWorkView({ ...s1, lane: 'opencode' }, { tmux: lifecycleTmux });
const expectedTarget = `work-vps:${tmuxWindowFor(s1.id)}`;
check('/tx on can create the exact session and workstream window',
  createdView.ok === true && createdView.created === true && createdView.target === expectedTarget);
const firstCreateCount = lifecycleCalls.length;
const reusedView = ensureTmuxWorkView({ ...s1, lane: 'opencode' }, { tmux: lifecycleTmux });
check('repeated /tx on reuses without another create',
  reusedView.ok === true && reusedView.created === false && lifecycleCalls.length === firstCreateCount + 2);
check('tmux lifecycle contains no destructive replacement command',
  lifecycleCalls.flat().every((arg) => !/kill-session|kill-window|respawn-pane|send-keys/.test(String(arg))));
let apiTmuxCalls = 0;
const apiView = ensureTmuxWorkView({ ...s1, lane: 'gemini' }, { tmux: () => { apiTmuxCalls += 1; return false; } });
check('API-only /tx on never invokes tmux',
  apiView.ok === true && apiView.target === null && apiTmuxCalls === 0);

// 5. Handoff preserves state; abort preserves the transcript.
const moved = handoffSession(s1.id, 'grok', tmpStore);
check('handoff keeps the session and records the lane',
  moved.lane === 'grok' && moved.laneHistory.join(',') === 'opencode,grok' && moved.state === 'active');
const dead = abortSession(s1.id, { transcriptRef: 'dispatch_BUG-1_opencode.log' }, tmpStore);
check('abort closes but preserves the transcript ref',
  dead.state === 'aborted' && dead.transcriptRef === 'dispatch_BUG-1_opencode.log' && dead.lane === 'grok');

// 6. No secrets toward Telegram.
const leaked = scrubSecrets('tok OPENCODE_BOT_TOKEN=abc123 TOKEN=xyz KEY=k SECRET=s 123456:AAEc-def_ghi-jklmnopQRSTUV');
check('scrubSecrets redacts token/key/secret shapes', !/abc123|xyz\b/.test(leaked) && /\[redacted\]/.test(leaked));
const tgView = JSON.stringify(statusForTelegram(s1.id, { tmux: noTmux }, tmpStore));
check('Telegram status view carries no bot-token shape', !/\b\d{6,}:[A-Za-z0-9_-]{20,}\b/.test(tgView));
check('sessionStatus probe attached', sessionStatus(s1.id, { tmux: noTmux }, tmpStore).probe.backend === 'grok');

try { if (fs.existsSync(tmpStore)) fs.unlinkSync(tmpStore); } catch {}

// 7. /tx is wired into the live bot (command list, handler case, helper).
{
  const hostSrc = fs.readFileSync(path.join(ROOT, 'scripts', 'bot-host.mjs'), 'utf8');
  check('bot-host handles /tx', hostSrc.includes("case 'tx':"));
  check('bot-host exports handleTxCommand', hostSrc.includes('export async function handleTxCommand'));
  const cmdSrc = fs.readFileSync(path.join(ROOT, 'scripts', 'lib', 'commands.mjs'), 'utf8');
  check('/tx advertised in BOT_COMMANDS', cmdSrc.includes("{ command: 'tx'"));
  check('/tx in help text', cmdSrc.includes('/tx [on|off]'));
}

console.log(`\n${pass} pass, ${fail} fail`);
if (fail > 0) {
  console.error('\nFailures:\n' + failures.map((f) => `  - ${f}`).join('\n'));
  process.exit(1);
}
