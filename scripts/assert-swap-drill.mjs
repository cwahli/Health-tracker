#!/usr/bin/env node
/**
 * assert-swap-drill.mjs — 10 sequential location swaps, for real.
 *
 * A real worker relay (child process), two fake workers (drill-a/drill-b),
 * and the REAL turn path from scripts/bot-host.mjs (`runOnWorker` with
 * preflight + canary + pack), decided exactly the way the live turn decides
 * (validate → confirm / rollback). One real opencode conversation, created
 * once, must survive all 10 swaps; one injected wrong-ledger turn must roll
 * the route back without touching the conversation row.
 *
 * Fully isolated: a fresh HOME, its own relay port, its own tmux-free
 * sandbox. Zero model calls (fake workers answer), zero Telegram messages.
 *
 * One honest split: the canary decision is `settleCanary` straight out of
 * scripts/bot-host.mjs — the very function the live turn path calls — so what
 * this drill proves is what happens on Telegram, not a copy of it.
 *
 * Exit 0 on all pass; exit 1 with FAIL lines otherwise.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

// ---- isolated HOME before any homedir-dependent module loads
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'swap-drill-'));
process.env.HOME = HOME;

const { runOnWorker, settleCanary } = await import(path.join(HERE, 'bot-host.mjs'));
const { armRoute, routeState, needsCanary } =
  await import(path.join(HERE, 'lib', 'worker-routing.mjs'));
const { recordWorkerConnected } = await import(path.join(HERE, 'lib', 'worker-presence.mjs'));
const { repointWorkView } = await import(path.join(HERE, 'lib', 'work-session.mjs'));

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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

console.log('assert-swap-drill\n');
console.log(`sandbox HOME: ${HOME}\n`);

const HOSTS = ['drill-a', 'drill-b'];
const SESSION_ID = 'ses_drillSwap01';
const PORT = 8910 + Math.floor(Math.random() * 60);
const RELAY = `http://127.0.0.1:${PORT}`;
const WS = path.join(HOME, 'ws');
fs.mkdirSync(WS, { recursive: true });

const relay = spawn(process.execPath, [path.join(HERE, 'worker-relay.mjs'), `--port=${PORT}`], {
  env: { ...process.env, HOME },
  stdio: 'ignore',
});
function cleanup() {
  try { relay.kill('SIGKILL'); } catch {}
  try { fs.rmSync(HOME, { recursive: true, force: true }); } catch {}
}
process.on('exit', cleanup);
process.on('SIGINT', () => { cleanup(); process.exit(2); });

try {
  // relay up?
  let up = false;
  for (let i = 0; i < 60 && !up; i++) {
    try { up = (await fetch(`${RELAY}/health`)).ok; } catch { await sleep(200); }
  }
  check('the drill relay listens', up);
  if (!up) throw new Error('relay did not start');

  // one real conversation, created once in the sandbox HOME
  const fixturePath = path.join(HOME, 'session-fixture.json');
  fs.writeFileSync(fixturePath, `${JSON.stringify({
    info: {
      id: SESSION_ID, slug: 'swap-drill', projectID: 'global', directory: WS, path: WS,
      title: 'conversation under test', agent: 'build',
      model: { id: 'mock-free', providerID: 'opencode', variant: 'default' },
      version: '1.18.32', summary: { additions: 0, deletions: 0, files: 0 },
      cost: 0, tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      time: { created: Date.now(), updated: Date.now() },
    },
    messages: [],
  }, null, 2)}\n`);
  const imp = spawnSync('opencode', ['import', fixturePath], { encoding: 'utf8', env: { ...process.env, HOME } });
  check('the drill conversation exists once', imp.status === 0, (imp.stdout + imp.stderr).replace(/\s+/g, ' ').slice(0, 120));

  // workspace with one dirty file, so guard 9 has something to carry
  execFileSync('git', ['init', '-q', WS]);
  execFileSync('git', ['-C', WS, 'config', 'user.email', 'drill@localhost']);
  execFileSync('git', ['-C', WS, 'config', 'user.name', 'drill']);
  fs.writeFileSync(path.join(WS, 'midway.txt'), 'point 1 drafted\n');
  execFileSync('git', ['-C', WS, 'add', '.']);
  execFileSync('git', ['-C', WS, 'commit', '-qm', 'base']);
  fs.writeFileSync(path.join(WS, 'midway.txt'), 'point 1 drafted — metric receipt still missing\n');

  // presence the drill side can see (same HOME), refreshed as the drill runs.
  // It carries a machine like a real worker's heartbeat, so the canary's
  // identity check has something true to match.
  const DRILL_MACHINE = { hostname: os.hostname(), platform: os.platform(), arch: os.arch() };
  const beat = () => {
    for (const h of HOSTS) recordWorkerConnected({ host: h, pid: process.pid, detail: 'swap drill', machine: DRILL_MACHINE, home: HOME });
  };
  beat();

  // fake workers: claim jobs from the relay, answer like worker-agent would
  const evilOnce = { n: -1 };
  async function fakeWorker(host, turns) {
    for (let n = 0; n < turns; n++) {
      let job = null;
      try {
        const res = await fetch(`${RELAY}/jobs/next?host=${encodeURIComponent(host)}&wait=15000`);
        if (res.status === 204) continue;
        ({ job } = await res.json());
      } catch { continue; }
      if (!job) continue;
      const evil = evilOnce.n === 0;
      if (evil) evilOnce.n = -1;
      let packApplied = 0;
      if (job.packId) {
        try {
          const pack = await (await fetch(`${RELAY}/packs/${encodeURIComponent(job.packId)}`)).json();
          packApplied = Array.isArray(pack?.files) ? pack.files.length : 0;
        } catch { /* pack unreachable: answer anyway, canary decides */ }
      }
      await fetch(`${RELAY}/jobs/result`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          jobId: job.id,
          text: `swap turn answered on ${host}`,
          code: 0, model: job.model, error: '',
          ledger: evil ? `${HOME}/.hermes/ledger/worker-evil` : `${HOME}/.hermes/ledger/worker-${host}`,
          machine: DRILL_MACHINE,
          sessionID: job.sessionId,
          resumedFrom: 'local',
          workspace: WS,
          packApplied,
        }),
      });
    }
  }
  const workers = [fakeWorker('drill-a', 12), fakeWorker('drill-b', 12)];

  // the conversation row, mirroring the live turn: only a passed canary moves it
  let sessionRow = SESSION_ID;
  let continuity = 0;
  const order = Array.from({ length: 11 }, (_, i) => HOSTS[i % HOSTS.length]);
  const FAIL_AT = 6;
  let rolledBack = 0;
  let rearmed = 0;

  for (let i = 1; i < order.length; i++) {
    const host = order[i];
    const other = order[i - 1];
    if (i % 3 === 0) beat();
    const wantCanary = needsCanary(host, { home: HOME });
    if (wantCanary) armRoute(host, { previous: other, home: HOME });
    if (i === FAIL_AT) evilOnce.n = 0;
    const t0 = Date.now();
    const handed = await runOnWorker({
      host, prompt: `swap ${i} of 10 via ${host}`, model: 'opencode/mock-free',
      project: 'health-tracker', role: '', workspace: 'health-tracker',
      sessionId: sessionRow, envMode: 'project', relay: RELAY,
      canary: wantCanary, preflightFull: wantCanary, packRoot: WS,
      timeoutMs: 30000, attempts: 2,
    });
    const ms = Date.now() - t0;
    const before = sessionRow;
    // The live turn's canary decision — the same function, not a copy of it.
    const settled = settleCanary({ host, result: handed || {}, sessionId: before, jobId: handed?.jobId || '', home: HOME });
    if (!settled.ok) {
      rolledBack++;
      check(`swap ${i}: wrong-ledger turn rolls back, row untouched`,
        routeState(host, { home: HOME }) === 'failed' && sessionRow === before && sessionRow === SESSION_ID,
        `${settled.reason} (${ms}ms)`);
      check(`swap ${i}: rollback names the job`, String(settled.route?.canary?.jobId || '') === String(handed?.jobId || '') && settled.route?.canary?.jobId !== '');
      // re-arm like a fresh /location would: the next swap must succeed
      armRoute(host, { previous: other, home: HOME });
      rearmed++;
      continue;
    }
    if (handed?.sessionID) sessionRow = handed.sessionID;
    const ok = handed?.code === 0 && handed?.text && sessionRow === SESSION_ID
      && routeState(host, { home: HOME }) === 'active';
    if (ok) continuity++;
    check(`swap ${i}: ${other} -> ${host} keeps the conversation`,
      Boolean(ok), `${String(handed?.text || handed?.error || '').slice(0, 80)} (${ms}ms)`);
  }
  await Promise.all(workers);

  check('all 9 honest swaps kept the same conversation', continuity === 9, `${continuity}/9`);
  check('exactly one rollback happened, then the route re-armed', rolledBack === 1 && rearmed === 1);
  check('the conversation row never forked', sessionRow === SESSION_ID, sessionRow);

  // the view follows the swap: same stable target, re-pointed in place on a
  // REAL isolated tmux server (not the fake runner the unit sensor uses).
  const hasTmux = spawnSync('tmux', ['-V'], { encoding: 'utf8' }).status === 0;
  if (!hasTmux) {
    console.log('NOTE  no tmux on this machine — view section skipped, conversation proof above stands');
  } else {
    const SOCK = 'swapdrill';
    const tmux = (...args) => spawnSync('tmux', ['-L', SOCK, ...args], { encoding: 'utf8' });
    tmux('kill-server');
    const target = 'work-view:ws-drill';
    const created = tmux('new-session', '-d', '-s', 'work-view', '-n', 'ws-drill',
      'bash', '-c', 'echo OLD-TOOL-MARKER; sleep 120');
    check('the pre-swap view exists with the old tool on screen', created.status === 0);
    const moved = repointWorkView({
      target,
      command: `bash -c 'echo NEW-TOOL-MARKER; sleep 120'`,
      expect: 'NEW-TOOL-MARKER',
      tmux: (args) => {
        const r = tmux(...args);
        return args[0] === 'list-panes' || args[0] === 'capture-pane' ? r.stdout : r.status === 0;
      },
    });
    check('repoint moves the real view to the current tool',
      moved.ok === true && moved.verified === true && moved.method === 'respawn-pane', moved.method || '');
    const screen = tmux('capture-pane', '-t', target, '-p').stdout || '';
    check('the stable target now shows the current tool', screen.includes('NEW-TOOL-MARKER'));
    tmux('kill-server');
  }
} finally {
  cleanup();
}

console.log(`\n${pass} pass, ${fail} fail`);
if (fail > 0) {
  console.error('\nFailures:\n' + failures.map((f) => `  - ${f}`).join('\n'));
  process.exit(1);
}
