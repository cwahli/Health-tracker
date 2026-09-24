/**
 * Retrieved memory stores for BOT-13.
 *
 * Memory is retrieved, not dumped. Three lexical stores live under the
 * Hermes home, plus the shared USER.md under its existing cap:
 *
 *   <home>/.hermes/memories/stores/decisions.jsonl
 *   <home>/.hermes/memories/stores/dead-ends.jsonl
 *   <home>/.hermes/memories/stores/facts.jsonl
 *
 * Row: { id, ticket, text, createdAt }. One JSON object per line.
 *
 * Retrieval rules (BOT-13):
 * - Only a build, investigate, or decide turn may retrieve. Any other turn
 *   gets zero rows (gated), never a whole-file injection.
 * - Lexical retrieve-by-ticket/query only. No vector service in this ID.
 * - Missing, over-cap, or stale memory produces a receipt, not a silent pass.
 * - Retrieval misses the caller did not use are counted as false-fires.
 *
 * Caps (from plan/BOT_ROLES.md §0, do not change here):
 *   USER.md 1,375 chars · MEMORY.md 2,200 chars · store row 500 chars.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const USER_CAP = 1375;
export const MEMORY_CAP = 2200;
export const ROW_TEXT_CAP = 500;
export const STORES = ['decisions', 'dead-ends', 'facts'];
export const RETRIEVE_TURNS = new Set(['build', 'investigate', 'decide']);
export const STALE_DAYS = 30;

export function hermesHome(home = os.homedir()) {
  return path.join(home, '.hermes');
}

export function memoriesDir(home = os.homedir()) {
  return path.join(hermesHome(home), 'memories');
}

export function storesDir(home = os.homedir()) {
  return path.join(memoriesDir(home), 'stores');
}

function storePath(store, home = os.homedir()) {
  return path.join(storesDir(home), `${store}.jsonl`);
}

/** Validate a store name; throw on unknown. */
export function checkStore(store) {
  if (!STORES.includes(store)) {
    throw new Error(`unknown memory store "${store}" (want one of ${STORES.join(', ')})`);
  }
  return store;
}

function readRows(store, home) {
  checkStore(store);
  let lines = [];
  try {
    lines = fs.readFileSync(storePath(store, home), 'utf8').split('\n');
  } catch {
    return [];
  }
  const rows = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    try {
      const row = JSON.parse(t);
      if (row && typeof row.text === 'string') rows.push(row);
    } catch { /* skip corrupt line, keep the rest */ }
  }
  return rows;
}

/**
 * Append one row to a store. Returns the stored row.
 * Throws when the store is unknown or the text is empty/over-cap.
 */
export function appendRow(store, { ticket = '', text = '' } = {}, { home = os.homedir(), now = Date.now() } = {}) {
  checkStore(store);
  const clean = String(text ?? '').trim();
  if (!clean) throw new Error(`memory-stores: empty text for store "${store}"`);
  if (clean.length > ROW_TEXT_CAP) {
    throw new Error(`memory-stores: row text ${clean.length} chars exceeds ${ROW_TEXT_CAP} cap`);
  }
  fs.mkdirSync(storesDir(home), { recursive: true });
  const row = {
    id: `m${now.toString(36)}${Math.floor(Math.random() * 0xffff).toString(16)}`,
    ticket: String(ticket ?? ''),
    text: clean,
    createdAt: new Date(now).toISOString(),
  };
  fs.appendFileSync(storePath(store, home), `${JSON.stringify(row)}\n`);
  return row;
}

function tokens(s) {
  return String(s ?? '').toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 1);
}

/**
 * Lexical retrieve. Returns { rows, gated }.
 * Non build/investigate/decide turns are gated: zero rows, gated true.
 * Scoring is token overlap between the query and ticket+text; score 0 rows
 * are dropped. Cap the injection with limit (default 5).
 */
export function retrieve(query, { turn = '', stores = STORES, limit = 5, home = os.homedir() } = {}) {
  if (!RETRIEVE_TURNS.has(String(turn))) return { rows: [], gated: true };
  const q = new Set(tokens(query));
  if (!q.size) return { rows: [], gated: false };
  const hits = [];
  for (const store of stores || []) {
    checkStore(store);
    for (const row of readRows(store, home)) {
      const hay = new Set([...tokens(row.ticket), ...tokens(row.text)]);
      let score = 0;
      for (const t of q) if (hay.has(t)) score += 1;
      if (score > 0) hits.push({ ...row, store, score });
    }
  }
  hits.sort((a, b) => b.score - a.score || a.createdAt.localeCompare(b.createdAt));
  return { rows: hits.slice(0, Math.max(0, limit)), gated: false };
}

function falseFirePath(home = os.homedir()) {
  return path.join(storesDir(home), 'false-fires.json');
}

/** Record retrieval rows the caller did not use. Returns updated totals. */
export function noteFalseFire(store, { count = 1, home = os.homedir() } = {}) {
  checkStore(store);
  fs.mkdirSync(storesDir(home), { recursive: true });
  let cur = { total: 0, byStore: {} };
  try {
    cur = { ...cur, ...JSON.parse(fs.readFileSync(falseFirePath(home), 'utf8')) };
  } catch { /* start fresh */ }
  const n = Math.max(1, Number(count) || 1);
  cur.total = (Number(cur.total) || 0) + n;
  cur.byStore = cur.byStore && typeof cur.byStore === 'object' ? cur.byStore : {};
  cur.byStore[store] = (Number(cur.byStore[store]) || 0) + n;
  fs.writeFileSync(falseFirePath(home), `${JSON.stringify(cur, null, 2)}\n`);
  return cur;
}

/** Read false-fire totals without writing. */
export function falseFireCounts({ home = os.homedir() } = {}) {
  try {
    const cur = JSON.parse(fs.readFileSync(falseFirePath(home), 'utf8'));
    return { total: Number(cur.total) || 0, byStore: cur.byStore || {} };
  } catch {
    return { total: 0, byStore: {} };
  }
}

function receiptPath(home = os.homedir()) {
  return path.join(storesDir(home), 'health-receipts.jsonl');
}

/**
 * Boot health gate. Returns { ok, receipts } where each receipt is
 * { kind: 'missing'|'over-cap'|'stale', path, detail, at }.
 * Missing default USER.md/MEMORY.md, over-cap files, a MEMORY.md older
 * than STALE_DAYS, or absent store files each produce one receipt.
 */
export function healthCheck({ home = os.homedir(), now = Date.now() } = {}) {
  const receipts = [];
  const at = new Date(now).toISOString();
  const mem = memoriesDir(home);

  for (const [name, cap] of [['USER.md', USER_CAP], ['MEMORY.md', MEMORY_CAP]]) {
    const p = path.join(mem, name);
    let content = null;
    try {
      content = fs.readFileSync(p, 'utf8');
    } catch {
      receipts.push({ kind: 'missing', path: p, detail: `${name} absent`, at });
      continue;
    }
    if (content.length > cap) {
      receipts.push({ kind: 'over-cap', path: p, detail: `${content.length} chars exceeds ${cap} cap`, at });
    }
    if (name === 'MEMORY.md') {
      try {
        const ageDays = (now - fs.statSync(p).mtimeMs) / 86400000;
        if (ageDays > STALE_DAYS) {
          receipts.push({ kind: 'stale', path: p, detail: `untouched for ${Math.floor(ageDays)} days`, at });
        }
      } catch { /* unreadable stat counts as missing above */ }
    }
  }

  for (const store of STORES) {
    const p = storePath(store, home);
    if (!fs.existsSync(p)) {
      receipts.push({ kind: 'missing', path: p, detail: `store "${store}" absent`, at });
    }
  }

  if (receipts.length) {
    try {
      fs.mkdirSync(storesDir(home), { recursive: true });
      fs.appendFileSync(receiptPath(home), receipts.map((r) => JSON.stringify(r)).join('\n') + '\n');
    } catch { /* receipt write is best-effort */ }
  }
  return { ok: receipts.length === 0, receipts };
}

function printUsage() {
  console.log('usage: memory-stores.mjs <append|retrieve|false-fire|check> [options]');
  console.log('  append --store=<s> --ticket=<t> --text=<text>');
  console.log('  retrieve --turn=<build|investigate|decide|other> --query=<q> [--limit=5]');
  console.log('  false-fire --store=<s> [--count=1]');
  console.log('  check');
}

async function cli(argv) {
  const [cmd, ...rest] = argv;
  const opts = {};
  for (const a of rest) {
    const m = a.match(/^--([^=]+)=(.*)$/s);
    if (m) opts[m[1]] = m[2];
    else if (a.startsWith('--')) opts[a.slice(2)] = '1';
  }
  switch (cmd) {
    case 'append':
      console.log(JSON.stringify(appendRow(opts.store, { ticket: opts.ticket, text: opts.text })));
      break;
    case 'retrieve': {
      const { rows, gated } = retrieve(opts.query || '', {
        turn: opts.turn, limit: opts.limit === undefined ? 5 : Number(opts.limit),
      });
      console.log(JSON.stringify({ gated, rows }, null, 2));
      break;
    }
    case 'false-fire':
      console.log(JSON.stringify(noteFalseFire(opts.store, { count: opts.count })));
      break;
    case 'check': {
      const { ok, receipts } = healthCheck();
      console.log(JSON.stringify({ ok, receipts }, null, 2));
      process.exitCode = ok ? 0 : 1;
      break;
    }
    default:
      printUsage();
      process.exitCode = 2;
  }
}

const invokedAs = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedAs === fileURLToPath(import.meta.url)) {
  cli(process.argv.slice(2)).catch((err) => {
    console.error(`memory-stores: ${err.message}`);
    process.exit(1);
  });
}
