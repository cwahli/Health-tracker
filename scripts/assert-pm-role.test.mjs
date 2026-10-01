/**
 * assert-pm-role.test.mjs — the sensor for PM-1 (`/role pm`).
 *
 * A gate nobody has seen fire proves nothing, so this file does two things and
 * neither of them is "read the source and check for a string":
 *
 *  1. It drives the REAL bot-host surface. Each case spawns
 *     `node scripts/bot-host.mjs --simulate="/role pm …" --id=vm` with a fixture
 *     HOME, so the command parser, the `/role` dispatch, `handleCommand` and the
 *     reply path are the production ones — and the three runs are three separate
 *     processes, which is the only way to prove the ladder's counters survive a
 *     host restart rather than living in a map.
 *
 *  2. It drives the rules directly, against a fixture fleet, including the two
 *     the ladder must NOT fire on: a lane that failed seconds ago, and a lane
 *     that failed long ago but has a live heartbeat.
 *
 * The one thing stubbed is the network: a loopback HTTP server answers
 * `GET /api/bugs/list` for the real `bugctl list --json` the PM shells out to,
 * and the Google/userbot halves are the same `send`/`recipient` seams the
 * production spool and writer already take. Nothing else is mocked.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  DEFAULT_STALL_MS,
  bugItems,
  humanAge,
  laneItems,
  listTmuxSessions,
  mdSafe,
  pmPaths,
  projectFleet,
  readSpecDir,
  renderFleet,
  specItem,
  worktreeFor,
} from './lib/pm-fleet.mjs';
import {
  RUNGS,
  forgetCounters,
  ladderFile,
  nextRung,
  readLadder,
  recordAttempt,
  recordAttempts,
  rungMessage,
} from './lib/pm-ladder.mjs';
import {
  ITEM_COLUMNS,
  buildFleetTableHtml,
  fenceTable,
  fleetTableModel,
  itemRows,
  renderFleetTableCaption,
  renderRollupTable,
  rollupRows,
} from './lib/pm-table.mjs';
import {
  PM_TAB,
  SHEET_COLUMNS,
  flushSheet,
  headerMarkerPath,
  markerColumns,
  pmSheetId,
  renderFlush,
  sheetReadiness,
  sheetRow,
  sheetSend,
  spoolFleetRows,
} from './lib/pm-sheet.mjs';
import { adoptedRoleLine, deliverNudge, pmHelpText, renderCycle, runCycle, runPmCommand, runStatus } from './lib/pm-run.mjs';
import { checkRoleDetails } from './lib/project-registry.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const BOT_HOST = path.join(ROOT, 'scripts', 'bot-host.mjs');
const HOUR = 3600 * 1000;

const scratch = () => fs.mkdtempSync(path.join(os.tmpdir(), 'pm-role-'));

/** A fixture fleet on disk: packets, ledger, heartbeats — the three file sources. */
function makeFleetHome({ laneFailedMsAgo = 4 * HOUR } = {}) {
  const home = scratch();
  const specsDir = path.join(home, 'specs', 'active');
  fs.mkdirSync(specsDir, { recursive: true });
  fs.writeFileSync(
    path.join(specsDir, 'FIXTURE-A.md'),
    ['---', 'id: FIXTURE-A', 'status: locked', 'class: fixture', 'gate:', '  - true', '---', '', '# FIXTURE-A', '', '## Goal', 'hold the projection steady', ''].join('\n'),
  );

  fs.mkdirSync(path.join(home, '.hermes'), { recursive: true });
  const rows = [
    // The stalled lane: a terminal failure, hours old, nobody alive on it.
    { at: new Date(Date.now() - laneFailedMsAgo).toISOString(), ticket: '#901', surface: 'vm', provider: 'opencode', model: 'opencode/one', defectClass: 'ui', tokens: 1200, wallClockMs: 600000, outcome: 'escalated' },
    // A healthy lane: newest row says ok.
    { at: new Date(Date.now() - 60_000).toISOString(), ticket: '#902', surface: 'mobile', provider: 'opencode', model: 'opencode/one', defectClass: 'ui', tokens: 900, wallClockMs: 30000, outcome: 'ok' },
  ];
  fs.writeFileSync(path.join(home, '.hermes', 'run-ledger.jsonl'), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');

  const beats = path.join(home, '.local', 'state', 'bot-host', 'agent-heartbeat');
  fs.mkdirSync(beats, { recursive: true });
  fs.writeFileSync(
    path.join(beats, 'agent-pm-role.json'),
    JSON.stringify({ pid: process.pid, branch: 'agent/pm-role', updatedAt: new Date().toISOString(), note: 'pm sensor' }) + '\n',
    { mode: 0o600 },
  );
  return {
    home,
    specsDir,
    beats,
    ledger: path.join(home, '.hermes', 'run-ledger.jsonl'),
    spoolDir: path.join(home, '.local', 'state', 'bot-host', 'vm', 'google-spool'),
    cleanup: () => fs.rmSync(home, { recursive: true, force: true }),
  };
}

/** The ticket rows the loopback API answers with: one blocked card, one healthy. */
function ticketRows() {
  return [
    { tag_id: 'BUG-901', public_n: 901, state: 'packed', title: 'Portion picker loses the selected serving', assignee: '', flags: { blocked_reason: 'waiting on R2 credentials' }, updated_at: new Date(Date.now() - 2 * 24 * HOUR).toISOString() },
    { tag_id: 'BUG-902', public_n: 902, state: 'in_fix', title: 'Omega-3 text renders seven digits', assignee: 'vm', flags: {}, updated_at: new Date(Date.now() - HOUR).toISOString() },
  ];
}

/** The real `bugctl` HTTP contract, answered on loopback. */
function startFakeBugApi(rows) {
  const seen = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    seen.push(url.pathname);
    if (url.pathname !== '/api/bugs/list') {
      res.writeHead(404, { 'content-type': 'application/json' });
      return res.end('{"error":"not found"}');
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ source: 'api', count: rows.length, generated_at: new Date().toISOString(), rows }));
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({
        port: server.address().port,
        seen,
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
  });
}

/**
 * One real bot-host process. Async on purpose: `spawnSync` would block the event
 * loop, and the fake ticket API lives in this process — the child would then wait
 * on a server that cannot answer. That is the same trap the forge sensor hit.
 */
function simulate(command, { home, specsDir, port, extraEnv = {} }) {
  const env = { ...process.env };
  delete env.RUN_LEDGER;
  delete env.PM_SKIP_BUGCTL;
  delete env.PM_SPECS_DIR;
  delete env.GOOGLE_PM_SHEET_ID;
  delete env.GOOGLE_USER_CREDENTIALS_JSON;
  delete env.GOOGLE_SERVICE_ACCOUNT_JSON;
  delete env.TELEGRAM_API_ID;
  delete env.TELEGRAM_API_HASH;
  delete env.TELEGRAM_USER_SESSION;
  Object.assign(env, {
    HOME: home,
    PM_SPECS_DIR: specsDir,
    BUG_API_BASE: `http://127.0.0.1:${port}`,
    BUGCTL_QUEUE: path.join(home, '.bugctl-queue.jsonl'),
    ...extraEnv,
  });
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [BOT_HOST, `--simulate=${command}`, '--id=vm'], { env, cwd: ROOT });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += String(d); });
    child.stderr.on('data', (d) => { stderr += String(d); });
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

/** Every value row the spool holds, in order. */
function spooledValues(home) {
  const dir = path.join(home, '.local', 'state', 'bot-host', 'vm', 'google-spool');
  let lines = [];
  try {
    lines = fs.readdirSync(dir).sort().flatMap((f) => fs.readFileSync(path.join(dir, f), 'utf8').split('\n'));
  } catch {
    return [];
  }
  return lines
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean)
    .map((item) => item.values);
}

// ---------------------------------------------------------------------------
// The projection — every rule, driven directly.
// ---------------------------------------------------------------------------

test('the projection reads a packet through the one frontmatter parser', () => {
  const item = specItem('---\nid: PM-9\nstatus: locked\ngoal: keep the fleet honest\n---\n', { fileName: 'PM-9.md', mtime: '2026-01-01T00:00:00.000Z' });
  assert.equal(item.key, 'spec:PM-9');
  assert.equal(item.state, 'locked');
  assert.equal(item.blocked, false);
  assert.equal(item.title, 'keep the fleet honest');
  assert.equal(item.source, 'specs/active');

  const blocked = specItem('---\nid: PM-8\nstatus: blocked\n---\n', { fileName: 'PM-8.md' });
  assert.equal(blocked.blocked, true);
  assert.match(blocked.blockedReason, /blocked/);
});

test('readSpecDir reports a missing directory instead of an empty fleet', () => {
  const missing = readSpecDir(path.join(scratch(), 'nope'));
  assert.equal(missing.ok, false);
  assert.match(missing.reason, /no packet directory/);
});

test('a card is stalled only when it says why it is blocked', () => {
  const items = bugItems(ticketRows());
  assert.equal(items.length, 2);
  const blocked = items.find((i) => i.id === '#901');
  const healthy = items.find((i) => i.id === '#902');
  assert.equal(blocked.blocked, true);
  assert.equal(blocked.blockedReason, 'waiting on R2 credentials');
  assert.equal(healthy.blocked, false);
});

test('the ladder does NOT fire on a fresh failure', () => {
  const lanes = laneItems([
    { at: new Date(Date.now() - 5000).toISOString(), surface: 'vm', outcome: 'escalated' },
  ]);
  const fleet = projectFleet({ lanes, now: Date.now() });
  assert.equal(fleet.counts.stalled, 0, 'a five-second-old failure is a retry, not a stall');
  assert.equal(fleet.items[0].stallReason, '');
});

test('the ladder does NOT fire on a stale failure whose agent is still alive', () => {
  const lanes = laneItems([{ at: new Date(Date.now() - 4 * HOUR).toISOString(), surface: 'gpu', outcome: 'escalated' }]);
  const beats = { 'agent-gpu-1': { pid: process.pid, branch: 'agent/gpu-1', updatedAt: new Date().toISOString() } };
  const fleet = projectFleet({ lanes, beats, now: Date.now() });
  assert.equal(fleet.items[0].live, true, 'the heartbeat links to the lane by its id appearing in the branch');
  assert.equal(fleet.counts.stalled, 0, 'a live agent on a stale failure is not a stall');
});

test('the ladder fires on a stale failure with nobody alive on it', () => {
  const lanes = laneItems([{ at: new Date(Date.now() - 4 * HOUR).toISOString(), surface: 'vm', outcome: 'escalated' }]);
  const fleet = projectFleet({ lanes, now: Date.now() });
  assert.equal(fleet.items[0].live, null, 'no heartbeat means "not linked", never "dead"');
  assert.equal(fleet.counts.stalled, 1);
  assert.match(fleet.items[0].stallReason, /no live agent/);
});

test('a dead pid does not count as a live agent', () => {
  const lanes = laneItems([{ at: new Date(Date.now() - 4 * HOUR).toISOString(), surface: 'vm', outcome: 'unresolved' }]);
  // A pid that cannot exist: `isLive` must reject it, so the lane stalls.
  const beats = { vm: { pid: 999999999, branch: 'agent/vm-1', updatedAt: new Date().toISOString() } };
  const fleet = projectFleet({ lanes, beats, now: Date.now() });
  assert.equal(fleet.items[0].live, false);
  assert.equal(fleet.counts.stalled, 1);
});

test('every source follows the pinned home, so a fixture cannot read the real one', () => {
  const fx = makeFleetHome();
  try {
    const p = pmPaths({ PM_SPECS_DIR: fx.specsDir }, { home: fx.home });
    assert.equal(p.specsDir, fx.specsDir);
    assert.equal(p.ledgerPath, fx.ledger, 'the ledger follows the pinned home, not the real one');
    assert.equal(p.heartbeatDir, fx.beats);
    assert.equal(pmPaths({ RUN_LEDGER: '0' }, { home: fx.home }).ledgerPath, '', 'RUN_LEDGER=0 still disables the ledger');
    assert.equal(pmPaths({ RUN_LEDGER: '/elsewhere.jsonl' }, { home: fx.home }).ledgerPath, '/elsewhere.jsonl');
  } finally {
    fx.cleanup();
  }
});

// ---------------------------------------------------------------------------
// The ladder — rungs, counters, and the restart property.
// ---------------------------------------------------------------------------

test('the rungs advance one step per attempt and escalate sticks', () => {
  assert.deepEqual(RUNGS, ['retry', 'another-way', 'escalate']);
  assert.equal(nextRung(0), 'retry');
  assert.equal(nextRung(1), 'another-way');
  assert.equal(nextRung(2), 'escalate');
  assert.equal(nextRung(9), 'escalate', 'once the human is asked, the ladder does not drop back');
});

test('a rung is sayable: the message names the item and the reason', () => {
  const item = { id: '#901', stallReason: 'waiting on R2 credentials' };
  assert.match(rungMessage('retry', item), /#901/);
  assert.match(rungMessage('another-way', item), /find another way/);
  assert.match(rungMessage('escalate', item), /Decision needed/);
});

test('the counter round-trips through disk, atomically, mode 600', () => {
  const home = scratch();
  try {
    const file = ladderFile('vm', { home });
    const first = recordAttempt(file, { key: 'lane:vm', at: '2026-01-01T00:00:00.000Z' });
    assert.equal(first.rung, 'retry');
    assert.equal(first.attempts, 1);
    const after = readLadder(file);
    assert.equal(after.counters['lane:vm'].attempts, 1);
    assert.equal(after.counters['lane:vm'].firstAt, '2026-01-01T00:00:00.000Z');
    assert.equal(fs.readFileSync(file, 'utf8').includes('lane:vm'), true);
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    assert.equal(fs.readdirSync(path.dirname(file)).some((f) => f.endsWith('.tmp')), false, 'no temp file is left behind');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('recordAttempts records several items in one write and forgetCounters drops the rest', () => {
  const home = scratch();
  try {
    const file = ladderFile('vm', { home });
    const recs = recordAttempts(file, [{ key: 'lane:vm' }, { key: 'card:BUG-901' }]);
    assert.equal(recs.length, 2);
    assert.deepEqual(recs.map((r) => r.rung), ['retry', 'retry']);
    assert.equal(forgetCounters(file, ['lane:vm']), 1);
    const after = readLadder(file);
    assert.deepEqual(Object.keys(after.counters), ['lane:vm']);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// The sheet — through the governed writer's own seams.
// ---------------------------------------------------------------------------

test('a row is the declared column layout, and dynamic text cannot break Markdown', () => {
  const row = sheetRow({ key: 'lane:vm', kind: 'lane', id: 'vm', state: 'escalated', blocked: false, stallReason: 'x', owner: 'vm', source: 'run-ledger' }, { at: 'T', rung: 'retry', attempts: 1 });
  assert.equal(row.length, SHEET_COLUMNS.length);
  assert.equal(row[SHEET_COLUMNS.indexOf('rung')], 'retry');
  assert.equal(row[SHEET_COLUMNS.indexOf('attempts')], '1');
  assert.equal(mdSafe('a_b*c`d[e]'), 'abcde');
});

test('a heartbeat note rides the projection into the sheet row', () => {
  assert.equal(worktreeFor('agent/f-13'), '~/dev/f-13');
  assert.equal(worktreeFor('bot-host-vm'), '', 'a free-form branch implies no worktree, never a guessed path');
  assert.equal(worktreeFor(''), '');
  const lanes = laneItems([{ at: new Date(Date.now() - 4 * HOUR).toISOString(), surface: 'f-13', outcome: 'unresolved' }]);
  const beats = { 'agent-f-13': { pid: process.pid, branch: 'agent/f-13', updatedAt: new Date().toISOString(), note: 'probing Vite preview' } };
  const fleet = projectFleet({ lanes, beats, now: Date.now() });
  const item = fleet.items[0];
  assert.equal(item.branch, 'agent/f-13');
  assert.equal(item.note, 'probing Vite preview');
  assert.equal(item.worktree, '~/dev/f-13');
  const row = sheetRow(item, { at: 'T', rung: '', attempts: 0 });
  assert.equal(row.length, SHEET_COLUMNS.length);
  assert.equal(row[SHEET_COLUMNS.indexOf('agent_branch')], 'agent/f-13');
  assert.equal(row[SHEET_COLUMNS.indexOf('agent_note')], 'probing Vite preview');
  assert.equal(row[SHEET_COLUMNS.indexOf('worktree')], '~/dev/f-13');
  assert.equal(row[SHEET_COLUMNS.indexOf('live')], 'live');
  const quiet = sheetRow({ key: 'k', kind: 'card', id: '#1', state: 'new' }, { at: 'T' });
  assert.equal(quiet[SHEET_COLUMNS.indexOf('agent_branch')], '', 'no heartbeat means blank agent cells, never "dead"');
  assert.equal(quiet[SHEET_COLUMNS.indexOf('live')], '');
});

test('the beat cwd (where the agent runs) beats the branch convention', () => {
  const old = laneItems([{ at: new Date(Date.now() - 4 * HOUR).toISOString(), surface: 'card-8', outcome: 'unresolved' }]);
  // A dispatch companion beats from inside the tree: cwd is ground truth,
  // even when the branch follows no convention (e.g. a SHEPHERD journey fork).
  const withCwd = projectFleet({
    lanes: old,
    beats: { 'journey-x': { pid: process.pid, branch: 'journey/card-8', updatedAt: new Date().toISOString(), note: 'dispatch #8', cwd: '/home/ubuntu/dev/dispatch-8' } },
    now: Date.now(),
  }).items[0];
  assert.equal(withCwd.worktree, '/home/ubuntu/dev/dispatch-8');
  // No cwd (an old beat, a hand beat from elsewhere): the convention answers.
  const conventional = laneItems([{ at: new Date(Date.now() - 4 * HOUR).toISOString(), surface: 'f-13', outcome: 'unresolved' }]);
  const noCwd = projectFleet({
    lanes: conventional,
    beats: { 'agent-f-13': { pid: process.pid, branch: 'agent/f-13', updatedAt: new Date().toISOString(), note: 'n' } },
    now: Date.now(),
  }).items[0];
  assert.equal(noCwd.worktree, '~/dev/f-13');
});

test('the sheet is found by id, and an unset id is named, not guessed', () => {
  assert.equal(pmSheetId({ GOOGLE_PM_SHEET_ID: ' "sheet-123" ' }), 'sheet-123');
  assert.equal(pmSheetId({}), '');
  const readiness = sheetReadiness({});
  assert.equal(readiness.ready, false);
  assert.match(readiness.reason, /no Google identity|GOOGLE_PM_SHEET_ID/);
  assert.ok(readiness.hostCommands.some((c) => /google-authorize/.test(c)), 'the consent command is printed, not attempted');
});

test('the send appends to the configured sheet id, and refuses without one', async () => {
  const calls = [];
  const append = async (sheetId, tab, rows, token) => { calls.push({ sheetId, tab, rows, token }); return { ok: true }; };
  const send = sheetSend({ token: 'tok' }, { GOOGLE_PM_SHEET_ID: 'sheet-123' }, { appendRows: append });
  const res = await send({ kind: 'pm-project-row', tab: PM_TAB, values: ['a', 'b'] });
  assert.equal(res.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].sheetId, 'sheet-123', 'the sheet is found by id, never by name');
  assert.equal(calls[0].tab, PM_TAB);
  assert.deepEqual(calls[0].rows, [['a', 'b']]);

  const noId = await sheetSend({ token: 'tok' }, {}, { appendRows: append })({ values: ['a'] });
  assert.equal(noId.ok, false);
  assert.match(noId.error, /GOOGLE_PM_SHEET_ID/);
});

test('flushing moves the spool cursor only for rows Google confirmed', async () => {
  const home = makeFleetHome();
  try {
    const fleet = projectFleet({ lanes: laneItems([{ at: new Date(Date.now() - 4 * HOUR).toISOString(), surface: 'vm', outcome: 'escalated' }]), now: Date.now() });
    const spool = spoolFleetRows('vm', fleet, { home: home.home, at: Date.now() });
    assert.equal(spool.header, true, 'the first cycle seeds the header');
    assert.equal(spool.spooled, 1);
    assert.ok(fs.existsSync(headerMarkerPath('vm', { home: home.home })));

    const sent = [];
    const flush = await flushSheet('vm', {
      env: {},
      home: home.home,
      writer: { ok: true, token: 'tok', kind: 'service_account', account: 'x@y' },
      recipient: async (item) => { sent.push(item.values); return { ok: true }; },
    });
    assert.equal(flush.sent, 2, 'header + row');
    assert.equal(flush.queued, 0, 'the cursor advanced, so nothing is re-sent');
    assert.equal(sent.length, 2);
  } finally {
    home.cleanup();
  }
});

test('a host with no credential keeps the rows and prints what only the operator can do', async () => {
  const home = makeFleetHome();
  try {
    const fleet = projectFleet({ lanes: laneItems([{ at: new Date(Date.now() - 4 * HOUR).toISOString(), surface: 'vm', outcome: 'escalated' }]), now: Date.now() });
    spoolFleetRows('vm', fleet, { home: home.home, at: Date.now() });
    const flush = await flushSheet('vm', { env: {}, home: home.home });
    assert.equal(flush.ok, false);
    assert.ok(flush.queued >= 1, 'the row is durable, so a later cycle sends it instead of losing it');
    const text = renderFlush(flush);
    assert.match(text, /nothing sent/);
    assert.match(text, /Only you can do this/);
    assert.match(text, /google-authorize/);
  } finally {
    home.cleanup();
  }
});

// ---------------------------------------------------------------------------
// The cycle — the composition.
// ---------------------------------------------------------------------------

test('a cycle nudges through the session and reports delivery honestly', async () => {
  const home = makeFleetHome();
  try {
    const sent = [];
    const common = {
      botId: 'vm',
      operatorChatId: '555',
      home: home.home,
      env: {},
      reader: () => ({
        specs: [],
        bugs: bugItems(ticketRows()),
        lanes: laneItems([{ at: new Date(Date.now() - 4 * HOUR).toISOString(), surface: 'vm', outcome: 'escalated' }]),
        beats: {},
        sources: { specsDir: home.specsDir, specsOk: true, specsReason: '', ledger: home.ledger, ledgerRows: 2, heartbeatDir: home.beats, beats: 0, tickets: 'api', ticketsError: '', ticketsCount: 2 },
      }),
    };
    // A delivered nudge goes to the operator chat, as the operator.
    const one = await runCycle({ ...common, send: async (chatId, text) => { sent.push({ chatId, text }); return { ok: true }; } });
    assert.equal(one.decisions.length, 2, 'the blocked card and the stalled lane');
    assert.equal(sent.length, 2, 'one real message per stalled item');
    assert.equal(sent[0].chatId, '555', 'the nudge goes to the operator chat as the operator');
    assert.match(sent[0].text, /stalled/);
    assert.equal(one.decisions.every((d) => d.delivered), true);
    assert.match(renderCycle(one), /delivered/);

    // The same cycle on a host whose userbot cannot run: refused, named, not faked.
    // No `send` is injected, so the real refusal path answers — and its wording
    // depends on this host (missing library, missing api_id, missing session), so
    // the assertion is on the facts that hold everywhere.
    const two = await runCycle(common);
    assert.equal(two.decisions.length, 2);
    assert.equal(two.decisions.every((d) => d.delivered === false), true);
    assert.ok(two.decisions[0].deliveryReason.length > 0, 'a refusal always carries a reason');
    const text = renderCycle(two);
    assert.match(text, /not delivered/);
    assert.match(text, /userbot-login/, 'the exact host-only login command is printed');
    assert.equal(two.decisions[0].attempt, 2, 'the counter advanced on the same durable file, not a fresh one');
    assert.equal(two.decisions[0].rung, 'another-way', 'the rung is a decision about the work, recorded either way');
  } finally {
    home.cleanup();
  }
});

test('deliverNudge refuses loudly instead of pretending', async () => {
  const noChat = await deliverNudge({ chatId: '', text: 'x' });
  assert.equal(noChat.ok, false);
  assert.match(noChat.reason, /no operator chat/);
  const refused = await deliverNudge({ chatId: '1', text: 'x', send: async () => ({ ok: false, reason: 'no session' }) });
  assert.equal(refused.ok, false);
  assert.equal(refused.reason, 'no session');
});

test('the PM subcommands answer on the bot-host surface contract', async () => {
  const home = makeFleetHome();
  try {
    const sources = {
      specs: [], bugs: bugItems(ticketRows()),
      lanes: laneItems([{ at: new Date(Date.now() - 4 * HOUR).toISOString(), surface: 'vm', outcome: 'escalated' }]),
      beats: {}, sources: { specsDir: home.specsDir, specsOk: true, specsReason: '', ledger: home.ledger, ledgerRows: 1, heartbeatDir: home.beats, beats: 0, tickets: 'api', ticketsError: '', ticketsCount: 2 },
    };
    const reader = () => sources;
    const bare = await runPmCommand({ sub: '', botId: 'vm', env: {}, home: home.home, reader });
    assert.match(bare.text, /Role: Project Manager/);
    assert.match(bare.text, /#901/, 'the blocked card is in the projection');
    assert.match(bare.text, /\/role pm run/);
    assert.equal(bare.resetRole, false);

    const reset = await runPmCommand({ sub: 'reset', botId: 'vm', env: {}, home: home.home, reader });
    assert.equal(reset.resetRole, true);
    assert.match(reset.text, /counters stay on disk/);

    assert.match(pmHelpText(), /\/role pm run/);
    assert.match(renderFleet(projectFleet({ lanes: sources.lanes, now: Date.now() })), /Stalled:/);
  } finally {
    home.cleanup();
  }
});

// ---------------------------------------------------------------------------
// The real bot-host surface: three processes, one fixture fleet.
// ---------------------------------------------------------------------------

test('E2E: `/role pm run` climbs retry -> another way -> escalate across three real bot-host processes', async () => {
  const fake = await startFakeBugApi(ticketRows());
  const home = makeFleetHome();
  try {
    const args = { home: home.home, specsDir: home.specsDir, port: fake.port };
    const first = await simulate('/role pm run', args);
    const second = await simulate('/role pm run', args);
    const third = await simulate('/role pm run', args);

    assert.equal(first.code, 0, `bot-host exited 0 (stderr: ${first.stderr.slice(0, 400)})`);
    assert.match(first.stdout, /\[reply\]/, 'the reply went through the real /role dispatch');
    assert.match(first.stdout, /PM cycle/);
    assert.match(first.stdout, /rung 1\/3 \*retry\*/);
    assert.match(second.stdout, /find another way/, 'the second run is a different rung, not another retry');
    assert.match(third.stdout, /escalate/, 'the third run escalates to the operator');

    // The bug source really was the real bugctl talking to a real socket.
    assert.ok(fake.seen.includes('/api/bugs/list'), 'bugctl asked the list endpoint');

    // Honest degradation, not a claim: no session, no consent on this host.
    assert.match(third.stdout, /not delivered/);
    assert.match(third.stdout, /node scripts\/bot-forge\.mjs userbot-login/);
    assert.match(third.stdout, /google-authorize/);

    // The counter survived three processes: that is the restart property.
    const state = readLadder(path.join(home.home, '.local', 'state', 'bot-host', 'vm', 'pm-ladder.json'));
    const lane = state.counters['lane:vm'];
    const card = state.counters['card:BUG-901'];
    assert.equal(lane.attempts, 3);
    assert.equal(lane.rung, 'escalate');
    assert.equal(card.attempts, 3, 'the blocked card climbed the same ladder');
    assert.equal(fs.statSync(path.join(home.home, '.local', 'state', 'bot-host', 'vm', 'pm-ladder.json')).mode & 0o777, 0o600);

    // The sheet reflects it, on the tab it belongs to, header first.
    const values = spooledValues(home.home);
    assert.deepEqual(values[0], SHEET_COLUMNS, 'the header is the first row on the sheet');
    const laneRows = values.filter((v) => v[SHEET_COLUMNS.indexOf('key')] === 'lane:vm');
    assert.equal(laneRows.length, 3);
    const last = laneRows[laneRows.length - 1];
    assert.equal(last[SHEET_COLUMNS.indexOf('rung')], 'escalate');
    assert.equal(last[SHEET_COLUMNS.indexOf('attempts')], '3');
    const cardRows = values.filter((v) => v[SHEET_COLUMNS.indexOf('key')] === 'card:BUG-901');
    assert.equal(cardRows[cardRows.length - 1][SHEET_COLUMNS.indexOf('rung')], 'escalate');
  } finally {
    home.cleanup();
    await fake.close();
  }
});

test('E2E: bare `/role pm` projects the fleet and writes nothing', async () => {
  const fake = await startFakeBugApi(ticketRows());
  const home = makeFleetHome();
  try {
    const before = fs.existsSync(path.join(home.home, '.local', 'state', 'bot-host', 'vm'));
    const run = await simulate('/role pm', { home: home.home, specsDir: home.specsDir, port: fake.port });
    assert.equal(run.code, 0, `bot-host exited 0 (stderr: ${run.stderr.slice(0, 400)})`);
    assert.match(run.stdout, /Role: Project Manager/);
    assert.match(run.stdout, /Stalled:/);
    assert.match(run.stdout, /#901/);
    assert.match(run.stdout, /last dispatch escalated/);
    const after = fs.existsSync(path.join(home.home, '.local', 'state', 'bot-host', 'vm'));
    assert.equal(before, false);
    assert.equal(after, false, 'a status projection writes no state at all');
  } finally {
    home.cleanup();
    await fake.close();
  }
});

test('the projection is not rattled by a ticket queue that cannot be read', async () => {
  // No server: the real bugctl is pointed at a closed port and must fail loud.
  const home = makeFleetHome();
  try {
    const run = await simulate('/role pm', { home: home.home, specsDir: home.specsDir, port: 1 });
    assert.equal(run.code, 0, `bot-host exited 0 (stderr: ${run.stderr.slice(0, 400)})`);
    assert.match(run.stdout, /Role: Project Manager/, 'the packet and ledger sources still answer');
    assert.match(run.stdout, /tickets: error/);
  } finally {
    home.cleanup();
  }
});

test('stallMs is a knob, not a constant baked into a report', () => {
  const lanes = laneItems([{ at: new Date(Date.now() - 5 * 60 * 1000).toISOString(), surface: 'vm', outcome: 'no-changes' }]);
  assert.equal(projectFleet({ lanes, now: Date.now() }).counts.stalled, 0);
  assert.equal(projectFleet({ lanes, now: Date.now(), stallMs: 60 * 1000 }).counts.stalled, 1);
  assert.equal(DEFAULT_STALL_MS, 30 * 60 * 1000);
  assert.equal(humanAge(4 * HOUR), '4h');
});

test('unknown PM subcommand errors with the valid list, never bare status', async () => {
  const nope = await runPmCommand({ sub: 'frobnicate', botId: 'vm', env: {}, home: os.tmpdir() });
  assert.equal(nope.ok, false);
  assert.match(nope.text, /Unknown PM subcommand/);
  assert.match(nope.text, /\/role pm run/);
});

test('an empty nudge result is not delivery', async () => {
  const res = await deliverNudge({ chatId: '1', text: 'x', send: async () => undefined });
  assert.equal(res.ok, false);
  assert.match(res.reason, /empty nudge result/);
});

test('a recovered fleet prunes the ladder and a chatless bot warns', async () => {
  const home = makeFleetHome();
  try {
    const stalledReader = () => ({
      specs: [], bugs: [],
      lanes: laneItems([{ at: new Date(Date.now() - 4 * HOUR).toISOString(), surface: 'vm', outcome: 'escalated' }]),
      beats: {},
      sources: { specsDir: home.specsDir, specsOk: true, specsReason: '', ledger: home.ledger, ledgerRows: 1, heartbeatDir: home.beats, beats: 0, tickets: 'api', ticketsError: '', ticketsCount: 0 },
    });
    const send = async () => ({ ok: false, reason: 'no session' });
    const one = await runCycle({ botId: 'vm', operatorChatId: '', home: home.home, env: {}, reader: stalledReader, send });
    assert.match(renderCycle(one), /No operator chat is configured/);
    const ladder = ladderFile('vm', { home: home.home });
    assert.ok(readLadder(ladder).counters['lane:vm'], 'stalled work keeps its counter');
    const healthyReader = () => ({
      specs: [], bugs: [],
      lanes: laneItems([{ at: new Date().toISOString(), surface: 'vm', outcome: 'ok' }]),
      beats: {},
      sources: { specsDir: home.specsDir, specsOk: true, specsReason: '', ledger: home.ledger, ledgerRows: 1, heartbeatDir: home.beats, beats: 0, tickets: 'api', ticketsError: '', ticketsCount: 0 },
    });
    await runCycle({ botId: 'vm', operatorChatId: '', home: home.home, env: {}, reader: healthyReader, send });
    assert.deepEqual(readLadder(ladder).counters, {}, 'recovered work is pruned so the file cannot grow forever');
  } finally {
    home.cleanup();
  }
});

test('a throwing cycle reports honestly instead of escaping to the poller', async () => {
  const res = await runPmCommand({ sub: 'run', botId: 'vm', env: {}, home: os.tmpdir(), reader: () => { throw new Error('ENOSPC simulated'); } });
  assert.equal(res.ok, false);
  assert.match(res.text, /failed before it could report honestly/);
});

// ---------------------------------------------------------------------------
// The PM seat on any bot-host bot (vm3 included): take it, see it, leave it.
// ---------------------------------------------------------------------------

test('E2E: `/role pm take` adopts the persona and `/role pm status` shows it', async () => {
  const fake = await startFakeBugApi(ticketRows());
  const home = makeFleetHome();
  try {
    const args = { home: home.home, specsDir: home.specsDir, port: fake.port };
    const take = await simulate('/role pm take', args);
    assert.equal(take.code, 0, `bot-host exited 0 (stderr: ${take.stderr.slice(0, 400)})`);
    assert.match(take.stdout, /seat taken/);
    assert.match(take.stdout, /Project Manager/);

    // The adoption is a persisted chat role, not a reply string: later turns in
    // this chat run under the PM mandate through the production path.
    const state = JSON.parse(fs.readFileSync(path.join(home.home, '.hermes', 'projects_state.json'), 'utf8'));
    assert.equal(state.chats.sim.roleId, 'pm');

    const status = await simulate('/role pm status', args);
    assert.equal(status.code, 0, `bot-host exited 0 (stderr: ${status.stderr.slice(0, 400)})`);
    assert.match(status.stdout, /runs as: \*Project Manager\*/);

    const reset = await simulate('/role pm reset', args);
    assert.match(reset.stdout, /Back to general/);
    const after = JSON.parse(fs.readFileSync(path.join(home.home, '.hermes', 'projects_state.json'), 'utf8'));
    assert.ok(!after.chats.sim.roleId, 'reset leaves the seat');
  } finally {
    home.cleanup();
    await fake.close();
  }
});

test('the adopted-role line never guesses', () => {
  assert.equal(adoptedRoleLine(''), '• this chat runs as: general mode — take the PM seat with `/role pm take`');
});

// ---------------------------------------------------------------------------
// source_brief: the original ask travels to the sheet.
// ---------------------------------------------------------------------------

test('every row carries the original ask as its last cell', () => {
  const spec = specItem('---\nid: PM-9\nstatus: locked\ngoal: keep the fleet honest\n---\n', { fileName: 'PM-9.md' });
  const card = bugItems([{ tag_id: 'BUG-1', public_n: 1, title: 'Fix the thing', state: 'open', flags: {} }])[0];
  const lane = laneItems([{ at: new Date().toISOString(), surface: 'vm', outcome: 'ok', ticket: '#1' }])[0];
  assert.ok(SHEET_COLUMNS.includes('source_brief'), 'the column exists');
  assert.equal(SHEET_COLUMNS[SHEET_COLUMNS.length - 1], 'source_brief', 'appended last, so existing indexes hold');
  assert.equal(sheetRow(spec).at(-1), 'keep the fleet honest', 'packet goal, not the id');
  assert.equal(sheetRow(card).at(-1), 'Fix the thing', 'ticket title');
  assert.match(sheetRow(lane).at(-1), /vm/, 'lane summary names the surface');
  for (const row of [sheetRow(spec), sheetRow(card), sheetRow(lane)]) {
    assert.equal(row.length, SHEET_COLUMNS.length);
  }
});

test('a column change re-seeds the header instead of misaligning rows', () => {
  const home = makeFleetHome();
  try {
    const fleet = projectFleet({ lanes: [], now: Date.now() });
    const first = spoolFleetRows('vm', fleet, { home: home.home, at: Date.now() });
    assert.equal(first.header, true);
    const second = spoolFleetRows('vm', fleet, { home: home.home, at: Date.now() });
    assert.equal(second.header, false, 'same columns, no duplicate header');
    // A marker from before versioning vouches for nothing: the header goes out
    // again so new 17-cell rows line up under a 17-cell header.
    const marker = headerMarkerPath('vm', { home: home.home });
    fs.writeFileSync(marker, JSON.stringify({ writtenAt: new Date().toISOString() }) + '\n');
    assert.equal(markerColumns(marker), '');
    const third = spoolFleetRows('vm', fleet, { home: home.home, at: Date.now() });
    assert.equal(third.header, true, 'unknown columns, header re-seeded');
    assert.equal(markerColumns(marker), SHEET_COLUMNS.join(','));
    const fourth = spoolFleetRows('vm', fleet, { home: home.home, at: Date.now() });
    assert.equal(fourth.header, false);
  } finally {
    home.cleanup();
  }
});

// ---------------------------------------------------------------------------
// tmux: deployed sessions next to live agents.
// ---------------------------------------------------------------------------

const TMUX_LS = ['VM-tui\t1790811000\t1', 'VM-tui-vm3\t1790812000\t0'].join('\n');

test('tmux sessions parse to name, age and attached — never throw', () => {
  const res = listTmuxSessions({ runner: () => TMUX_LS, now: 1790813000 * 1000 });
  assert.equal(res.ok, true);
  assert.equal(res.sessions.length, 2);
  assert.equal(res.sessions[0].name, 'VM-tui');
  assert.equal(res.sessions[0].attached, true);
  assert.equal(res.sessions[1].name, 'VM-tui-vm3');
  assert.equal(res.sessions[1].attached, false);
  assert.match(res.sessions[1].age, /16m|17m/);
  assert.deepEqual(listTmuxSessions({ runner: () => '' }).sessions, [], 'empty server output is zero sessions, not an error');
  const down = listTmuxSessions({ runner: () => { throw new Error('ENOENT'); } });
  assert.equal(down.ok, false);
  assert.deepEqual(down.sessions, []);
});

test('the fleet render names deployed terminals and flags viewer-less ones', () => {
  const fleet = projectFleet({ lanes: [], now: Date.now() });
  const plain = renderFleet(fleet, {});
  assert.ok(!plain.includes('deployed (tmux)'), 'no tmux read, no section');
  const tmux = listTmuxSessions({ runner: () => TMUX_LS, now: 1790813000 * 1000 });
  const withTmux = renderFleet(fleet, { tmux });
  assert.match(withTmux, /deployed \(tmux\): 2 session\(s\)/);
  assert.match(withTmux, /VM-tui-vm3/);
  assert.match(withTmux, /no viewer attached/);
  const off = renderFleet(fleet, { tmux: { ok: false, error: 'no tmux server', sessions: [] } });
  assert.match(off, /deployed \(tmux\): unavailable/);
});

test('runStatus carries tmux and the adopted role without touching state', async () => {
  const home = makeFleetHome();
  try {
    const reader = () => ({ specs: [], bugs: [], lanes: [], beats: {}, sources: {} });
    const st = await runStatus({ env: {}, home: home.home, now: Date.now(), reader, chatId: '', tmuxRunner: () => TMUX_LS });
    assert.equal(st.tmux.ok, true);
    assert.equal(st.tmux.sessions.length, 2);
    assert.equal(st.adoptedRole, '');
    assert.match(pmHelpText(), /\/role pm take/);
  } finally {
    home.cleanup();
  }
});

test('E2E: bare `/role` explains the whole surface, including the PM seat', async () => {
  const fake = await startFakeBugApi(ticketRows());
  const home = makeFleetHome();
  try {
    const args = { home: home.home, specsDir: home.specsDir, port: fake.port };
    const plain = await simulate('/role', args);
    assert.equal(plain.code, 0, `bot-host exited 0 (stderr: ${plain.stderr.slice(0, 400)})`);
    assert.match(plain.stdout, /Active Project Roles/);
    assert.match(plain.stdout, /runs as:.*general mode/, 'no seat taken yet, and it says so');
    assert.match(plain.stdout, /\/role pm take/, 'the seat is discoverable');
    assert.match(plain.stdout, /\/role pm run/);
    assert.match(plain.stdout, /\/role pm status/);
    assert.match(plain.stdout, /\/role pm sheet/);
    assert.match(plain.stdout, /\/role reset/);

    await simulate('/role pm take', args);
    const seated = await simulate('/role', args);
    assert.match(seated.stdout, /runs as:.*Project Manager/, 'the listing reflects the adopted seat');
  } finally {
    home.cleanup();
    await fake.close();
  }
});

// ---------------------------------------------------------------------------
// The table path: `show the progress so far as a table` must come back as a
// table Telegram can actually render. The seat hand-wrote pipe tables (live
// 2026-10-01 on vm3), which arrive unaligned on every client.
// ---------------------------------------------------------------------------

const TABLE_FLEET = {
  counts: { total: 3, specs: 1, cards: 1, lanes: 1, stalled: 1 },
  items: [
    { id: 'PM-1', kind: 'spec', state: 'locked', title: 'pm role', goal: 'role pm on VM bot', stallReason: null, branch: '', live: null },
    { id: '#901', kind: 'card', state: 'in_fix', title: 'Fix the thing', stallReason: 'queueblocked', branch: 'agent/f-13', live: true },
    { id: 'lane:vm', kind: 'lane', state: 'unresolved', title: 'vm lane', stallReason: 'dispatch failed', branch: 'agent/x', live: false },
  ],
};

test('the narrow path pads every column to the same width', () => {
  const { fenced, wide } = fenceTable(['a', 'b'], [['x', 'y'], ['longer', 'z']]);
  assert.equal(wide, false);
  const lines = fenced.split('\n');
  assert.equal(lines[0], '```text');
  assert.equal(lines[lines.length - 1], '```');
  const widths = lines.slice(1, -1).map((l) => l.length);
  assert.equal(widths[1], widths[2], `rows align: ${JSON.stringify(lines)}`);
});

test('a table the skill says is wide is refused by the fence, not squeezed', () => {
  // 6 columns of real fleet data is the wide case; a fence would never align it.
  const { wide } = fenceTable(ITEM_COLUMNS, itemRows(TABLE_FLEET));
  assert.equal(wide, true, 'the per-item table takes the HTML path');
  const narrow = fenceTable(['stream', 'count'], rollupRows(TABLE_FLEET));
  assert.equal(narrow.wide, false, 'the rollup fits a phone fence');
});

test('the rollup answers the rollup and never invents a count', () => {
  const text = renderRollupTable(TABLE_FLEET);
  assert.match(text, /stream\s+count\s+status/);
  assert.match(text, /packets\s+1\s+1 locked/);
  assert.match(text, /total\s+3\s+1 stalled/);
  assert.ok(!text.includes('|'), 'no raw pipes — the skill forbids them outside the builder');
});

test('a live agent is named, a stale one is marked, an unlinked one is blank', () => {
  const rows = itemRows(TABLE_FLEET);
  const agent = ITEM_COLUMNS.indexOf('agent');
  assert.equal(rows[0][agent], '', 'no heartbeat means blank, never "dead"');
  assert.match(rows[1][agent], /agent\/f-13 \(live\)/);
  assert.match(rows[2][agent], /agent\/x \(stale\)/);
});

test('the wide model carries every column and a goal, not an id', () => {
  const model = fleetTableModel(TABLE_FLEET, {
    sources: { specsOk: true, specsDir: '/x/specs', tickets: 'canonical', ticketsCount: 2, ledgerRows: 1, beats: 1 },
    tmux: { ok: true, sessions: [{ name: 'VM-tui-vm3', attached: true }] },
  });
  const items = model.tables.find((t) => t.heading.startsWith('Items'));
  assert.deepEqual(items.columns, ITEM_COLUMNS);
  for (const row of items.rows) assert.equal(row.length, ITEM_COLUMNS.length, 'every row matches its columns, or the builder throws');
  assert.match(items.rows[0][ITEM_COLUMNS.indexOf('goal')], /role pm on VM bot/);
  assert.ok(model.notes.some((n) => /VM-tui-vm3/.test(n)), 'tmux is in the notes');
});

test('dropped columns are declared, never dropped quietly', () => {
  const model = fleetTableModel(TABLE_FLEET, { droppedColumns: ['worktree'] });
  assert.ok(model.notes.some((n) => /columns dropped to fit: worktree/.test(n)));
});

test('the build writes a real HTML grid and names its renderer', () => {
  const home = makeFleetHome();
  const dir = path.join(home.home, 'tables');
  try {
    const model = fleetTableModel(TABLE_FLEET, {});
    const out = buildFleetTableHtml(model, { outDir: dir, label: 'sensor' });
    assert.ok(fs.existsSync(out.jsonPath), 'the model is on disk, so the build is inspectable');
    assert.ok(fs.existsSync(out.htmlPath));
    const html = fs.readFileSync(out.htmlPath, 'utf8');
    assert.match(html, /<table/i, 'a grid, not a markdown pipe table');
    assert.match(html, /PM-1/, 'the fleet is in the grid');
    assert.ok(out.renderer, 'the renderer is always named, fallback included');
    const caption = renderFleetTableCaption({ htmlPath: out.htmlPath, renderer: out.renderer, itemCount: 3 });
    assert.match(caption, new RegExp(`MEDIA:${out.htmlPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  } finally {
    home.cleanup();
  }
});

test('`/role pm table` returns a fence AND a MEDIA file, never hand-written pipes', async () => {
  const home = makeFleetHome();
  try {
    const sources = {
      specs: [], bugs: bugItems(ticketRows()),
      lanes: laneItems([{ at: new Date(Date.now() - 4 * HOUR).toISOString(), surface: 'vm', outcome: 'escalated' }]),
      beats: {}, sources: { specsDir: home.specsDir, specsOk: true, specsReason: '', ledger: home.ledger, ledgerRows: 1, heartbeatDir: home.beats, beats: 0, tickets: 'api', ticketsError: '', ticketsCount: 2 },
    };
    const res = await runPmCommand({ sub: 'table', botId: 'vm', env: {}, home: home.home, reader: () => sources });
    assert.equal(res.ok, true);
    assert.match(res.text, /Fleet rollup/);
    assert.match(res.text, /```text/);
    assert.match(res.text, /MEDIA:\//, 'the wide table ships as a file the send path extracts');
    const body = res.text.replace(/MEDIA:.*$/m, '').replace(/```text[\s\S]*?```/g, '');
    assert.ok(!/^\s*\|/m.test(body), 'no raw pipe rows in the prose either');
    assert.match(pmHelpText(), /\/role pm table/);
  } finally {
    home.cleanup();
  }
});

test('the PM mandate points at the table skill', async () => {
  const details = checkRoleDetails('health-tracker', 'pm');
  assert.match(details.instructions, /telegram-tables/, 'the seat is told which skill, not just "use tables"');
  assert.match(details.instructions, /build-table\.py/);
  assert.match(details.instructions, /Never emit raw `\| col \|` rows|raw `\| col \|`/);
});
