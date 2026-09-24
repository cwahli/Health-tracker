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
  disableTmuxObserver,
  observerLogPath,
  createObserver,
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
const observerRoot = path.join(os.tmpdir(), `ws_observer_gate_${Date.now()}_${Math.random().toString(36).slice(2)}`);
const oldObserverRoot = process.env.WORK_OBSERVERS;
process.env.WORK_OBSERVERS = observerRoot;
const noTmux = () => false;
const lifecycleSessions = new Map();
const lifecyclePanes = new Map();
const lifecycleCalls = [];
let lifecyclePaneId = 0;
const lifecycleTarget = (target) => String(target).replace(/:$/, '');
const addLifecyclePane = (target, command) => {
  const id = `%${++lifecyclePaneId}`;
  lifecyclePanes.set(`${lifecycleTarget(target)}\t${id}`, { target: lifecycleTarget(target), id, command });
  return id;
};
const lifecycleTmux = (args) => {
  lifecycleCalls.push(args);
  if (args[0] === 'has-session') return lifecycleSessions.has(args[2]);
  if (args[0] === 'list-windows') return [...(lifecycleSessions.get(args[2]) || [])].join('\n');
  if (args[0] === 'new-session') {
    const session = args[3];
    lifecycleSessions.set(session, new Set([args[5]]));
    addLifecyclePane(`${session}:${args[5]}`, args.at(-1));
    return true;
  }
  if (args[0] === 'new-window') {
    const session = args[3].replace(/:$/, '');
    const windows = lifecycleSessions.get(session) || new Set();
    windows.add(args[5]);
    lifecycleSessions.set(session, windows);
    addLifecyclePane(`${session}:${args[5]}`, args.at(-1));
    return true;
  }
  if (args[0] === 'list-panes') {
    return [...lifecyclePanes.values()].filter((pane) => pane.target === lifecycleTarget(args[2])).map((pane) => `${pane.id}\t"${pane.command}"`).join('\n');
  }
  if (args[0] === 'split-window') return addLifecyclePane(args[3], args.at(-1));
  if (args[0] === 'select-pane' || args[0] === 'kill-pane') {
    if (args[0] === 'kill-pane') {
      const entry = [...lifecyclePanes.entries()].find(([, pane]) => pane.id === args[2]);
      if (entry) lifecyclePanes.delete(entry[0]);
    }
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
const apiProbe = debugProbe('gemini', { session: s1, tmux: noTmux });
check('API lane honestly reports attach:false with an event view',
  apiProbe.surface === 'api' && apiProbe.attach === false && apiProbe.events === true && apiProbe.observerLive === false);

const createdView = ensureTmuxWorkView({ ...s1, lane: 'opencode' }, { tmux: lifecycleTmux });
const expectedTarget = `work-vps:${tmuxWindowFor(s1.id)}`;
check('/tx on can create the exact session and workstream window',
  createdView.ok === true && createdView.created === true && createdView.target === expectedTarget && createdView.observerPane);
const firstCreateCount = lifecycleCalls.length;
const reusedView = ensureTmuxWorkView({ ...s1, lane: 'opencode' }, { tmux: lifecycleTmux });
check('repeated /tx on reuses the exact observer pane',
  reusedView.ok === true && reusedView.created === false && reusedView.observerPane === createdView.observerPane && lifecycleCalls.length > firstCreateCount);
check('tmux lifecycle contains no destructive replacement command',
  lifecycleCalls.flat().every((arg) => !/kill-session|kill-window|respawn-pane|send-keys/.test(String(arg))));
const termProbe = debugProbe('opencode', { session: s1, tmux: lifecycleTmux });
check('terminal lane reports verified observer liveness',
  termProbe.surface === 'terminal' && termProbe.attach === true && termProbe.observerLive === true && termProbe.tmuxSession === 'work-vps');
const migrationSession = { ...s1, id: 'vps|qa_meal|/home/ubuntu/src/Health-tracker-migrate' };
const migrationWindow = tmuxWindowFor(migrationSession.id);
lifecycleSessions.get('work-vps').add(migrationWindow);
addLifecyclePane(`work-vps:${migrationWindow}`, 'bash');
const migratedView = ensureTmuxWorkView(migrationSession, { tmux: lifecycleTmux });
check('legacy blank window migrates non-destructively',
  migratedView.ok === true && migratedView.migrated === true && lifecycleCalls.some((args) => args[0] === 'split-window'));
const observer = createObserver(s1, { root: observerRoot, now: () => '2026-09-24T00:00:00.000Z' });
observer.onEvent({ kind: 'reasoning', text: 'private reasoning' });
observer.onEvent({ kind: 'tool', tool: 'read', status: 'done', input: 'private input', output: 'private output' });
const observerBody = fs.readFileSync(observer.path, 'utf8');
check('observer path is private and hashed', !observer.path.includes(s1.id) && (fs.statSync(observerRoot).mode & 0o777) === 0o700 && (fs.statSync(observer.path).mode & 0o777) === 0o600);
check('observer projection excludes prompts, reasoning, payloads, and errors', !/private reasoning|private input|private output/.test(observerBody) && observerBody.includes('"kind":"thinking"'));
const stopped = disableTmuxObserver(s1, { tmux: lifecycleTmux });
check('/tx off stops only the exact observer pane', stopped.ok === true && stopped.stopped === true && lifecycleCalls.some((args) => args[0] === 'kill-pane' && args[2] === createdView.observerPane));
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
try { fs.rmSync(observerRoot, { recursive: true, force: true }); } catch {}
if (oldObserverRoot === undefined) delete process.env.WORK_OBSERVERS;
else process.env.WORK_OBSERVERS = oldObserverRoot;

// 7. /tx is wired into the live bot (command list, handler case, helper).
{
  const hostSrc = fs.readFileSync(path.join(ROOT, 'scripts', 'bot-host.mjs'), 'utf8');
  check('bot-host handles /tx', hostSrc.includes("case 'tx':"));
  check('bot-host exports handleTxCommand', hostSrc.includes('export async function handleTxCommand'));
  const cmdSrc = fs.readFileSync(path.join(ROOT, 'scripts', 'lib', 'commands.mjs'), 'utf8');
  check('/tx advertised in BOT_COMMANDS', cmdSrc.includes("{ command: 'tx'"));
  check('/debug and /handoff advertised in BOT_COMMANDS', cmdSrc.includes("{ command: 'debug'") && cmdSrc.includes("{ command: 'handoff'"));
  check('/tx vocabulary in help text', cmdSrc.includes('/tx [on|off|status|debug]'));
}

console.log(`\n${pass} pass, ${fail} fail`);
if (fail > 0) {
  console.error('\nFailures:\n' + failures.map((f) => `  - ${f}`).join('\n'));
  process.exit(1);
}
