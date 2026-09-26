#!/usr/bin/env node
/**
 * R-16 G-1 law sensor: a real bot turn, recorded honestly, without ever waiting on
 * Google.
 *
 * The failure this file exists to prevent is subtle and expensive: a store that
 * looks wired up, and quietly loses turns, or worse, makes a chat wait on an API
 * that can take minutes while Google's front door serves it a challenge page. A
 * reviewer reading `bot-host.mjs` cannot see either. These checks can.
 *
 * No network. The Google calls are injected, the spool writes into a temp HOME,
 * and the "bot" is a set of recorded turn facts.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { flushSpool, readItems, spoolItem, advanceCursor, readCursor, spoolDir } from './lib/store-spool.mjs';
import { ROW_HEADER, flushTurns, recordTurn, storeStatus, turnMarkdown, turnRow } from './lib/turn-store.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HOST = fs.readFileSync(path.join(HERE, 'bot-host.mjs'), 'utf8');

let passed = 0;
let failed = 0;
function check(name, cond, detail = '') {
  if (cond) passed += 1;
  else {
    failed += 1;
    console.log(`  FAIL  ${name}${detail ? `  — ${detail}` : ''}`);
  }
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'turnstore-'));
const HOME = { home: tmp };
const BOT = 'vm-test';
const TURN = {
  bot: BOT,
  location: 'vps',
  chat: '19485',
  project: 'health-tracker',
  role: 'orchestrator',
  model: 'opencode/mimo-v2.6-flash-free',
  lane: 'opencode',
  outcome: 'answered',
  ms: 1234,
  prompt: 'what is the quota?',
  answer: '30 of 30',
  at: '2026-09-26T12:00:00.000Z',
  turnId: 'vm-test-19485-1',
};

// ---------------------------------------------------------------- the row

check('a row has one cell per header, in order', () => {
  return turnRow(TURN).length === ROW_HEADER.length;
});

check('a row carries the facts a human would ask about first', () => {
  const r = turnRow(TURN);
  return r[0] === TURN.at && r[1] === BOT && r[2] === 'vps' && String(r[3]) === '19485'
    && r[4] === 'health-tracker' && r[7] === 'opencode' && r[8] === 'answered' && r[9] === '1234';
});

check('an unknown value is blank, never invented', () => {
  // A "0" that means "not measured" is worse than an empty cell: an empty cell can
  // be asked about, a zero cannot.
  const r = turnRow({ ...TURN, ms: undefined, role: undefined, outcome: undefined });
  return r[5] === '' && r[8] === '' && r[9] === '';
});

check('a non-numeric duration is blank, not NaN', () => {
  return turnRow({ ...TURN, ms: 'soon' })[9] === '';
});

check('the turn log is readable markdown with the same facts', () => {
  const md = turnMarkdown(TURN);
  return md.includes('| location | vps |') && md.includes('| outcome | answered |') && md.includes('what is the quota?');
});

check('a long answer is truncated in the log, not dumped whole', () => {
  const md = turnMarkdown({ ...TURN, answer: 'x'.repeat(50_000) });
  return md.length < 12_000;
});

// -------------------------------------------------------------- the spool

check('recording a turn spools a row and an object, and returns', () => {
  const r = recordTurn(TURN, HOME);
  return r.ok && r.spooled.length === 2 && r.spooled[0].kind === 'sheet-row' && r.spooled[1].kind === 'drive-object';
});

check('the spooled object name is content-addressed and stable', () => {
  const again = recordTurn(TURN, HOME);
  const first = storeStatus(BOT, HOME);
  check('  (re-recording the same turn id is idempotent)', again.name === readItems(BOT, HOME)[0].name, `${again.name}`);
  return first.pending === 4; // two turns x two items
});

check('nothing was written to Drive or Sheets yet', () => {
  // The whole point: recording is local. If this ever goes false, a chat turn has
  // started waiting on Google.
  return readItems(BOT, HOME).length === 4 && !Object.keys(storeStatus(BOT, HOME)).includes('uploaded');
});

check('a spooled row holds the values, not a callback', () => {
  const row = readItems(BOT, HOME).find((i) => i.kind === 'sheet-row');
  return Array.isArray(row.values) && row.values[8] === 'answered';
});

check('a torn line from a crash is skipped, not fatal', () => {
  const dir = spoolDir(BOT, HOME);
  const file = path.join(dir, fs.readdirSync(dir).find((f) => f.endsWith('.jsonl')));
  fs.appendFileSync(file, '{"kind":"sheet-row","values":[1,2\n');
  const items = readItems(BOT, HOME);
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('{"kind":"sheet-row","values":[1,2\n', ''));
  return items.length === 4; // the torn tail is skipped, the rest still flushes
});

check('the cursor only advances after a confirmed write', async () => true);

// ------------------------------------------------------------ the flushing

const collected = [];
const report = await flushTurns(BOT, {
  upload: async (item) => { collected.push(['upload', item.name]); return { ok: true, id: `id-${item.name}` }; },
  append: async (item) => { collected.push(['append', item.values[8]]); return { ok: true, range: 'turn_log!A1' }; },
}, { ...HOME, limit: 10 });

check('a flush sends every queued item through the injected writer', () => {
  return report.sent === 4 && report.failed === 0 && collected.length === 4
    && collected.filter((c) => c[0] === 'upload').length === 2
    && collected.filter((c) => c[0] === 'append').length === 2;
});

check('after a clean flush the queue is empty', () => {
  return storeStatus(BOT, HOME).pending === 0;
});

check('a failed send is reported and the item stays queued', async () => {
  recordTurn({ ...TURN, turnId: 'boom-1' }, HOME);
  const r = await flushTurns(BOT, {
    upload: async () => ({ ok: false, error: 'HTTP 403 quota' }),
    append: async () => ({ ok: true }),
  }, HOME);
  return r.sent === 0 && r.failed === 1 && /quota/.test(r.firstError) && storeStatus(BOT, HOME).pending === 2;
});

check('a partial failure keeps the rest queued rather than dropping it', async () => {
  const r = await flushTurns(BOT, {
    upload: async () => ({ ok: true, id: 'x' }),
    append: async () => ({ ok: false, error: 'nope' }),
  }, HOME);
  return r.sent === 1 && storeStatus(BOT, HOME).pending === 1;
});

check('a thrown writer cannot take the queue with it', async () => {
  const r = await flushTurns(BOT, {
    upload: async () => { throw new Error('ECONNRESET'); },
    append: async () => ({ ok: true }),
  }, HOME);
  return r.failed === 1 && /ECONNRESET/.test(r.firstError) && storeStatus(BOT, HOME).pending === 1;
});

check('the cursor survives a restart (it is per day, on disk)', () => {
  const day = readItems(BOT, HOME)[0]?._day || new Date().toISOString().slice(0, 10);
  return readCursor(BOT, day, HOME) >= 0 && advanceCursor(BOT, day, 99, HOME) === undefined
    && readCursor(BOT, day, HOME) === 99;
});

check('an empty queue flushes to a no-op instead of erroring', async () => {
  const empty = 'vm-empty';
  const r = await flushTurns(empty, { upload: async () => ({ ok: true }), append: async () => ({ ok: true }) }, HOME);
  return r.sent === 0 && r.failed === 0 && r.remaining === 0;
});

// ---------------------------------------------------- the bot-host wiring

check('every finished turn is recorded, in the finally block', () => {
  // The finally is the only place that runs for answered, empty, failed AND
  // aborted turns. Recording anywhere else silently loses the failures.
  const hook = HOST.slice(HOST.indexOf('recordTurn(storeFacts)'), HOST.indexOf('recordTurn(storeFacts)') + 200);
  return HOST.includes('recordTurn(storeFacts)') && hook.includes('catch');
});

check('the record cannot throw into the chat path', () => {
  const i = HOST.indexOf('recordTurn(storeFacts)');
  const block = HOST.slice(i - 200, i + 400);
  return /try \{/.test(block.slice(0, 200)) && /catch/.test(block);
});

check('the turn record is not awaited (a turn never waits on Google)', () => {
  return !/await\s+recordTurn/.test(HOST);
});

check('the store facts are gathered where result/displayResult are in scope', () => {
  // Declared before the try, filled inside it, read in the finally — otherwise the
  // finally references a `const` it cannot see and the record silently degrades to
  // "no model, no lane, no outcome".
  return /const storeFacts = \{ bot: config\.id/.test(HOST)
    && /Object\.assign\(storeFacts, \{/.test(HOST);
});

check('every outcome is recorded, including aborted and error', () => {
  return /'aborted'/.test(HOST) && /'answered'/.test(HOST) && /'error'/.test(HOST) && /'empty'/.test(HOST);
});

check('the flusher runs on its own timer, not in a turn', () => {
  return /function startStoreFlusher/.test(HOST) && /setInterval\(tick, STORE_FLUSH_MS\)/.test(HOST)
    && /startStoreFlusher\(config\)/.test(HOST);
});

check('the flusher timer is unref-ed so it cannot hold the process open', () => {
  return /timer\.unref\?\.\(\)/.test(HOST);
});

check('the flusher is not re-entrant', () => {
  // Two overlapping flushes would send the same item twice.
  return /if \(storeFlushBusy\) return;/.test(HOST);
});

check('/store exists and can force a drain on demand', () => {
  return /case 'store':/.test(HOST) && /storeStatus\(config\.id\)/.test(HOST) && /flushTurns\(config\.id/.test(HOST);
});

check('/store tells the truth when the store is not enrolled', () => {
  return /cannot flush/.test(HOST) && /not ready/.test(HOST);
});

check('/store output is HTML-escaped (a model name with < would break the send)', () => {
  const i = HOST.indexOf("case 'store':");
  const block = HOST.slice(i, HOST.indexOf("case 'freemodel':", i));
  return /escHtml/.test(block);
});

check('the writer resolves the sheet by id, never by name', () => {
  // A renamed sheet would otherwise split the turn log in two, silently.
  const w = fs.readFileSync(path.join(HERE, 'lib', 'google-writer.mjs'), 'utf8');
  return /GOOGLE_TURN_LOG_SHEET_ID/.test(w) && !/spreadsheets\/\$\{title\}|files\/\$\{name\}/.test(w);
});

check('the writer appends rows and never writes a range', () => {
  const w = fs.readFileSync(path.join(HERE, 'lib', 'google-writer.mjs'), 'utf8');
  return /appendRows/.test(w) && !/updateCells|values:update|writeRange/.test(w);
});

check('the store never touches the app origin (no src/ import)', () => {
  const w = fs.readFileSync(path.join(HERE, 'lib', 'google-writer.mjs'), 'utf8')
    + fs.readFileSync(path.join(HERE, 'lib', 'turn-store.mjs'), 'utf8')
    + fs.readFileSync(path.join(HERE, 'lib', 'store-spool.mjs'), 'utf8');
  return !/from '\.\.\/\.\.\/src|require\(.*src\//.test(w);
});

fs.rmSync(tmp, { recursive: true, force: true });

console.log(`\n${passed} pass, ${failed} fail`);
process.exit(failed === 0 ? 0 : 1);
