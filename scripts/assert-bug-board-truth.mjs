#!/usr/bin/env node
/**
 * assert-bug-board-truth — the board's own numbers must be true.
 *
 * Two defects, both measured on 2026-09-30, both the same shape: a second
 * surface with its own idea of the truth.
 *
 *  1. A card with `status = 'ignored'` was counted as DONE by the KPI tiles
 *     (`doneAll: 2`) while its own row badge rendered the word "fixed". A card
 *     nobody fixed, presented as fixed work. `tagIsFixed` folded 'ignored' into
 *     done; the badge re-derived "done" inline and did not. Then PR #391 made
 *     the board serve every status, so these cards became visible.
 *  2. `/api/bug-tracker/overview` cached for 20s and was busted only by three
 *     hand-placed nulls in serverIssueBacklog.ts. Every write from
 *     serverBugSnapshot.ts — attempts, verify, curation, auto-file — left a
 *     stale COUNT on screen.
 *
 * EXECUTED, not grepped: part 1 drives the real KPI function and the real
 * classification over rows carrying each status; part 2 registers the real
 * express routes, writes a card through a second module's route, and reads the
 * board again to prove the count moved.
 *
 * Run: node scripts/assert-bug-board-truth.mjs
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dir = mkdtempSync(join(ROOT, '.bug-board-truth-'));

let passed = 0;
let failed = 0;
const check = (name, ok, detail = '') => {
  if (ok) { passed += 1; console.log(`  PASS  ${name}`); }
  else { failed += 1; console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`); }
};

console.log('assert-bug-board-truth:');

// ---------------------------------------------------------------------------
// Part 1 — the classification, and the two numbers derived from it.
// ---------------------------------------------------------------------------

const CARD = (id, status, work_item = {}) => ({
  id,
  title: `card ${id}`,
  title_key: id,
  category: 'foodcart',
  status,
  created_at: '2026-09-29 13:01:21',
  updated_at: '2026-09-29 13:01:21',
  resolved_at: null,
  resolution_note: '',
  whats_still_open: '',
  comments: '[]',
  work_item: JSON.stringify({ public_n: 1, queue: 'ready', commits: [], burns: [], ...work_item }),
});

const statusProbe = `
import { queueKpis, tagIsFixed, tagIsGenuinelyFixed, isDoneThisWeek } from '${ROOT}/src/utils/bugQueueKpis.ts';
import { cardDiscipline, dispositionLabel } from '${ROOT}/src/utils/bugCardDisposition.ts';

const card = (id, status, work_item = {}) => ({
  id, status,
  work_item: { public_n: 1, queue: 'ready', commits: [], burns: [], ...work_item },
});

const out = {};
for (const s of ['to_fix', 'fixed', 'ignored', 'wont_fix', 'pending_review', 'something_new']) {
  const t = card('c', s);
  out[s] = {
    disposition: cardDiscipline(t).disposition,
    label: dispositionLabel(cardDiscipline(t).disposition),
    isFixed: tagIsFixed(t),
    genuinelyFixed: tagIsGenuinelyFixed(t),
    open: cardDiscipline(t).open,
    done: cardDiscipline(t).done,
    doneThisWeek: isDoneThisWeek(t, new Date('2026-09-30T12:00:00Z')),
  };
}

// The board's four tiles + dropdown counts, over a realistic mixed board.
const board = [
  card('open1', 'to_fix'),
  card('open2', 'to_fix', { queue: 'blocked' }),
  card('done1', 'fixed', { queue: 'done' }),
  card('decl1', 'ignored'),
  card('decl2', 'wont_fix'),
];
const k = queueKpis(board, new Date('2026-09-30T12:00:00Z'));
const counts = {};
for (const t of board) { const d = cardDiscipline(t).disposition; counts[d] = (counts[d]||0)+1; }

console.log(JSON.stringify({ out, kpis: k, counts, total: board.length }));
`;
writeFileSync(join(dir, 'status.mts'), statusProbe);

const runProbe = (file) => {
  const tsx = join(ROOT, 'node_modules', '.bin', 'tsx');
  if (!existsSync(tsx)) return { code: 127, out: 'tsx not installed in this checkout' };
  try {
    return { code: 0, out: execFileSync(tsx, [file], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) };
  } catch (err) {
    return { code: err.status ?? 1, out: `${err.stdout || ''}${err.stderr || ''}` };
  }
};

{
  const r = runProbe(join(dir, 'status.mts'));
  if (r.code !== 0) {
    check('the classification probe executes', false, r.out.slice(0, 400));
  } else {
    check('the classification probe executes', true);
    let d = {};
    try { d = JSON.parse(r.out.trim().split('\n').pop() || '{}'); } catch { /* reported below */ }
    const o = d.out || {};

    check('an ignored card reads "declined", never "fixed"',
      o.ignored?.label === 'declined' && o.ignored?.label !== 'fixed', JSON.stringify(o.ignored));
    check('an ignored card is not a completion',
      o.ignored?.genuinelyFixed === false && o.ignored?.doneThisWeek === false, JSON.stringify(o.ignored));
    check('an ignored card is not open work either', o.ignored?.open === false, JSON.stringify(o.ignored));
    check('a green-ticked card still reads "fixed" and IS done',
      o.fixed?.label === 'fixed' && o.fixed?.genuinelyFixed === true, JSON.stringify(o.fixed));
    check('an unknown status is shown as open work, so a new status cannot vanish',
      o.something_new?.open === true && o.something_new?.done === false, JSON.stringify(o.something_new));
    // Several statuses may share a disposition on purpose — `wont_fix` and
    // `ignored` both mean "decided not to be work", and the board should say
    // one word for one decision. The invariant is per DISPOSITION.
    const byDisposition = {};
    for (const [status, v] of Object.entries(o)) (byDisposition[v.disposition] ||= new Set()).add(v.label);
    check('every disposition gets exactly one word',
      Object.values(byDisposition).every((set) => set.size === 1),
      JSON.stringify(Object.fromEntries(Object.entries(byDisposition).map(([d, set]) => [d, [...set]]))));
    check('no two dispositions share a word',
      new Set(Object.values(byDisposition).map((set) => [...set][0])).size === Object.keys(byDisposition).length,
      JSON.stringify(Object.fromEntries(Object.entries(byDisposition).map(([d, set]) => [d, [...set]]))));
    check('the two not-work statuses share the declined disposition and word',
      o.ignored?.disposition === 'declined' && o.wont_fix?.disposition === 'declined'
      && o.ignored?.label === o.wont_fix?.label);

    const k = d.kpis || {};
    check('the tiles split every card exactly once',
      (k.open || 0) + (k.doneAll || 0) + (k.declined || 0) === d.total,
      `open=${k.open} done=${k.doneAll} declined=${k.declined} of ${d.total}`);
    check('declined cards are counted as declined, not as done or backlog',
      k.declined === 2 && k.doneAll === 1 && k.open === 2, JSON.stringify(k));
    check('the dropdown counts agree with the tiles',
      d.counts?.declined === k.declined && d.counts?.fixed === k.doneAll, JSON.stringify(d.counts));
  }
}

// ---------------------------------------------------------------------------
// Part 2 — a write through the OTHER module must bust the board's cache.
// Driven through the real routes against a fake D1 that actually stores.
// ---------------------------------------------------------------------------

const cacheProbe = `
process.env.CLOUDFLARE_ACCOUNT_ID = 'acct';
process.env.CLOUDFLARE_D1_DATABASE_ID = 'db';
process.env.CLOUDFLARE_API_TOKEN = 'tok';

const store = new Map();
const seed = (status) => ({
  id: 'tag_seed', title: 'seed card', title_key: 'seed-card', category: 'foodcart',
  status, created_at: '2026-09-29 13:01:21', updated_at: '2026-09-29 13:01:21',
  resolved_at: null, resolution_note: '', whats_still_open: '', comments: '[]',
  work_item: JSON.stringify({ public_n: 1, queue: 'ready', commits: [], burns: [] }),
});
store.set('tag_seed', seed('to_fix'));

const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  if (!String(url).includes('api.cloudflare.com')) return realFetch(url, init);
  const { sql, params = [] } = JSON.parse(init.body);
  const s = sql.toUpperCase();
  let results = [];
  if (/INSERT INTO ISSUE_TAGS/i.test(sql)) {
    const row = { id: params[0], title: params[1], title_key: params[2], category: params[3],
      status: 'to_fix', created_at: '2026-09-30', updated_at: '2026-09-30', resolved_at: null,
      resolution_note: '', whats_still_open: '', comments: '[]',
      work_item: JSON.stringify({ public_n: 0, queue: 'ready', commits: [], burns: [] }) };
    store.set(row.id, row);
    results = [];
  } else if (/UPDATE ISSUE_TAGS SET WORK_ITEM/i.test(sql)) {
    const row = store.get(params[1]);
    if (row) { row.work_item = params[0]; row.updated_at = '2026-09-30'; }
    results = [];
  } else if (/FROM ISSUE_TAGS/i.test(sql)) {
    const m = sql.match(/status\\s+IN\\s*\\(([^)]*)\\)/i);
    results = [...store.values()];
    if (m) {
      const allowed = m[1].split(',').map((x) => x.trim().replace(/^'|'$/g, ''));
      results = results.filter((r) => allowed.includes(String(r.status)));
    }
    const eq = sql.match(/status\\s*=\\s*'([^']+)'/i);
    if (eq) results = results.filter((r) => String(r.status) === eq[1]);
  }
  return new Response(JSON.stringify({ success: true, result: [{ results }] }),
    { status: 200, headers: { 'content-type': 'application/json' } });
};

const { default: express } = await import('express');
const { registerIssueBacklogRoutes } = await import('${ROOT}/serverIssueBacklog.ts');
const { claimPublicNumbers } = await import('${ROOT}/serverBugNumbers.ts');

const app = express();
app.use(express.json());
registerIssueBacklogRoutes(app, {});
const server = app.listen(0);
await new Promise((r) => server.once('listening', r));
const base = 'http://127.0.0.1:' + server.address().port;
const get = async (p) => (await fetch(base + p)).json();

const first = await get('/api/bug-tracker/overview');
const cached = await get('/api/bug-tracker/overview');   // served from the 20s cache

// A write from the OTHER module — the shape of every agent action
// (attempt/verify/curate/auto-file) that the old hand-placed nulls missed.
store.set('tag_new', { ...seed('to_fix'), id: 'tag_new', title: 'minted by the agent', title_key: 'minted' });
const viaNumbers = await claimPublicNumbers();            // routes through d1Query
const after = await get('/api/bug-tracker/overview');

console.log(JSON.stringify({
  first: (first.bugTags || []).length,
  cached: (cached.bugTags || []).length,
  after: (after.bugTags || []).length,
  claimed: viaNumbers.claimed.length,
}));
server.close();
`;
writeFileSync(join(dir, 'cache.mts'), cacheProbe);
{
  const r = runProbe(join(dir, 'cache.mts'));
  if (r.code !== 0) {
    check('the cache probe executes', false, r.out.slice(0, 500));
  } else {
    check('the cache probe executes', true);
    let d = {};
    try { d = JSON.parse(r.out.trim().split('\n').pop() || '{}'); } catch { /* reported below */ }
    check('the board cache really does serve a second read', d.first === d.cached, JSON.stringify(d));
    check(
      'a write through serverBugNumbers/d1Query busts the board cache',
      d.after === d.cached + 1,
      `before=${d.cached} after=${d.after} — a stale board count is exactly this`,
    );
  }
}

rmSync(dir, { recursive: true, force: true });
console.log('');
console.log(
  failed === 0
    ? `assert-bug-board-truth: ${passed} pass, 0 fail`
    : `assert-bug-board-truth: ${passed} pass, ${failed} FAIL`,
);
process.exit(failed === 0 ? 0 : 1);
