/**
 * The bot and the board must report the SAME number of bug tickets.
 *
 * Measured 2026-09-30: the board showed 14 cards, `bugctl list` returned
 * count=14, and yet only 10 numbers were citable — #8, #10, #11 and #12 each
 * sat on two cards. Two causes, both structural:
 *
 *  1. Row set. The board read `status IN ('to_fix','in_progress','fixed')` with
 *     no `updated_at` column; `GET /api/bugs/list` read `SELECT *` with no
 *     status filter. Any card outside the board's list was counted by the bot
 *     and invisible on the board. Every card is `to_fix` today, so the two
 *     agreed by luck — the divergence was one `wont_fix` away.
 *  2. Numbering. Four read paths each ran their own assign-then-write loop over
 *     their own snapshot, so two overlapping requests minted the same #n twice.
 *
 * This executes the real Express routes against a fake D1 and asserts the two
 * surfaces answer identically, then drives the concurrency that produced the
 * four duplicates and proves the numbering stays unique. EXECUTED, not grepped:
 * every case registers the routes and calls them over HTTP.
 *
 * Run: node scripts/assert-bug-ticket-count-parity.mjs
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, existsSync, mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// Under ROOT, not tmpdir: a probe importing `express` or a repo module resolves
// against THIS checkout's node_modules, which is the whole point of executing it.
const dir = mkdtempSync(join(ROOT, '.bug-count-parity-'));
mkdirSync(dir, { recursive: true });

let passed = 0;
let failed = 0;
const check = (name, ok, detail = '') => {
  if (ok) { passed += 1; console.log(`  PASS  ${name}`); }
  else { failed += 1; console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`); }
};

console.log('assert-bug-ticket-count-parity:');

// ---------------------------------------------------------------------------
// Part 1 — the two surfaces must return the identical row set.
// Driven through the real routes with a stubbed d1Query, so the SQL each route
// builds is what gets judged (the old bug was literally a different WHERE).
// ---------------------------------------------------------------------------

const CARD = (id, n, status, title, extra = {}) => ({
  id,
  title,
  title_key: String(title).toLowerCase().slice(0, 60),
  category: 'foodcart',
  status,
  created_at: extra.created_at || '2026-09-29 13:01:21',
  updated_at: extra.updated_at || '2026-09-29 13:01:21',
  resolved_at: extra.resolved_at || null,
  resolution_note: '',
  whats_still_open: '',
  comments: '[]',
  work_item: JSON.stringify({
    public_n: n,
    queue: status === 'fixed' ? 'done' : 'ready',
    commits: [],
    burns: [],
    ...(extra.work_item || {}),
  }),
});

// Every status the store has ever written. The board's old IN-list covered
// three of these; anything else was invisible to the user and counted by the bot.
const ROWS = [
  CARD('t_open', 1, 'to_fix', 'open card'),
  CARD('t_wontfix', 2, 'wont_fix', 'declined card'),
  CARD('t_ignored', 3, 'ignored', 'ignored card'),
  CARD('t_fixed', 4, 'fixed', 'fixed card', { resolved_at: '2026-09-29 18:00:00' }),
  CARD('t_dup', 5, 'to_fix', 'duplicate card'),
  CARD('t_pending', 6, 'pending_review', 'awaiting review card'),
];

// The board route is driven through the REAL d1Query by stubbing global fetch,
// so the SQL it builds is judged as sent (the old bug was a different WHERE),
// and ESM immutability is not fought with.
const probe = `
process.env.CLOUDFLARE_ACCOUNT_ID = 'acct';
process.env.CLOUDFLARE_D1_DATABASE_ID = 'db';
process.env.CLOUDFLARE_API_TOKEN = 'tok';

const ROWS = ${JSON.stringify(ROWS)};
export const seen = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  // Only the Cloudflare D1 call is faked; the request to the local express
  // server below must go out for real, or the probe tests nothing.
  if (!String(url).includes('api.cloudflare.com')) return realFetch(url, init);
  const body = JSON.parse(init.body);
  seen.push(body.sql);
  let results = [];
  if (/issue_tag_links/i.test(body.sql)) results = [];
  else if (/FROM issue_tags/i.test(body.sql)) {
    // Honour a status IN (...) filter, because that filter IS the defect: a
    // stub that ignored WHERE would report the same row count for the broken
    // query and the fixed one, and the whole check would be theatre.
    results = ROWS;
    const m = body.sql.match(/status\\s+IN\\s*\\(([^)]*)\\)/i);
    if (m) {
      const allowed = m[1].split(',').map((x) => x.trim().replace(/^'|'$/g, ''));
      results = results.filter((r) => allowed.includes(String(r.status)));
    }
    const eq = body.sql.match(/status\\s*=\\s*'([^']+)'/i);
    if (eq) results = results.filter((r) => String(r.status) === eq[1]);
  } else if (/issue_backlog/i.test(body.sql)) results = [];
  return new Response(JSON.stringify({ success: true, result: [{ results }] }), {
    status: 200, headers: { 'content-type': 'application/json' },
  });
};

const { default: express } = await import('express');
const { registerIssueBacklogRoutes } = await import('${ROOT}/serverIssueBacklog.ts');
const app = express();
app.use(express.json());
registerIssueBacklogRoutes(app, {});
const server = app.listen(0);
await new Promise((r) => server.once('listening', r));
const port = server.address().port;
const res = await fetch('http://127.0.0.1:' + port + '/api/bug-tracker/overview');
const body = await res.json();
const tags = body.bugTags || [];
console.log(JSON.stringify({
  status: res.status,
  ids: tags.map((t) => t.id).sort(),
  count: tags.length,
  statuses: tags.map((t) => t.status),
  public_ns: tags.map((t) => t.public_n),
  seen,
}));
server.close();
`;
writeFileSync(join(dir, 'probe.mts'), probe);

// Probes import repo modules, whose specifiers are extensionless and whose
// deps live in the repo's own node_modules — so they run through the repo's
// tsx from the repo root, not through bare `node` from a temp dir.
const runProbe = (file) => {
  const tsx = join(ROOT, 'node_modules', '.bin', 'tsx');
  if (!existsSync(tsx)) return { code: 127, out: 'tsx not installed in this checkout' };
  try {
    const out = execFileSync(tsx, [file], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, out };
  } catch (err) {
    return { code: err.status ?? 1, out: `${err.stdout || ''}${err.stderr || ''}` };
  }
};

{
  const r = runProbe(join(dir, 'probe.mts'));
  if (r.code !== 0) {
    check('board route executes against a stubbed D1', false, r.out.slice(0, 400));
  } else {
    check('board route executes against a stubbed D1', true);
    const line = r.out.trim().split('\n').pop() || '{}';
    let data = {};
    try { data = JSON.parse(line); } catch { /* reported below */ }
    const ids = data.ids || [];
    check(
      'the board shows every card the store holds, whatever the status',
      ids.length === ROWS.length,
      `board served ${ids.length} of ${ROWS.length} (statuses: ${JSON.stringify(data.statuses)})`,
    );
    const sawNarrowFilter = (data.seen || []).some((s) => /FROM issue_tags[\s\S]*?status\s+IN\s*\(/i.test(s));
    check(
      'the board query no longer narrows the row set by status',
      !sawNarrowFilter,
      `narrowing query still present: ${(data.seen || []).find((s) => /status\s+IN/i.test(s))}`,
    );
    const sawUpdatedAt = (data.seen || []).some((s) => /updated_at/.test(s) && /FROM issue_tags/i.test(s));
    check('the board query selects updated_at (its own sort column)', sawUpdatedAt);
  }
}

// ---------------------------------------------------------------------------
// Part 2 — the numbering must stay unique under concurrent readers, which is
// the exact interleaving that produced the four duplicated numbers.
// ---------------------------------------------------------------------------

const parityProbe = `
import { planAssignments, planRenumber, hasDuplicateNumbers, publicNOf } from '${ROOT}/src/utils/bugNumberParity.ts';

const card = (id, n, created) => ({ id, created_at: created, work_item: { public_n: n } });

// Two requests read the SAME snapshot before either writes (this is the window
// that existed between the INSERT and the work_item write in persistAutoFile).
const snapshot = [card('a', 0, '2026-09-29 13:01:21'), card('b', 0, '2026-09-29 13:01:22'), card('c', 0, '2026-09-29 13:01:23')];
const r1 = planAssignments(snapshot);
const r2 = planAssignments(snapshot);
const samePlan = JSON.stringify(r1) === JSON.stringify(r2);

// What the guarded claim does: a write only lands while the row is still
// unnumbered, so a loser re-reads and sees the winner's number.
const store = new Map(snapshot.map((c) => [c.id, c]));
const claim = (id, to) => {
  const cur = store.get(id);
  if (publicNOf(cur) > 0) return false;      // the unnumbered guard
  store.set(id, card(id, to, cur.created_at));
  return true;
};
const applied = [];
for (const p of [...r1, ...r2]) if (claim(p.id, p.to)) applied.push(p);
const afterConcurrent = [...store.values()];

// The damage that shipped: four numbers each on two cards.
const damaged = [
  card('t1', 1, '2026-09-24 14:16:39'),
  card('a', 8, '2026-09-29 13:01:21'), card('b', 8, '2026-09-29 13:01:21'),
  card('c', 9, '2026-09-29 13:01:22'),
  card('d', 10, '2026-09-29 13:01:22'), card('e', 10, '2026-09-29 13:01:22'),
  card('f', 11, '2026-09-29 13:01:22'), card('g', 11, '2026-09-29 13:01:22'),
  card('h', 12, '2026-09-29 13:01:23'), card('i', 12, '2026-09-29 13:01:23'),
  card('j', 13, '2026-09-29 13:01:23'),
];
const plan = planRenumber(damaged);
const repaired = damaged.map((c) => {
  const m = plan.moves.find((x) => x.id === c.id);
  return m ? card(c.id, m.to, c.created_at) : c;
});
const distinct = new Set(repaired.map(publicNOf));

console.log(JSON.stringify({
  samePlan, appliedCount: applied.length, uniqueAfterConcurrent: !hasDuplicateNumbers(afterConcurrent),
  concurrentNumbers: afterConcurrent.map(publicNOf),
  damagedUnique: hasDuplicateNumbers(damaged), planMoves: plan.moves, repairedUnique: !hasDuplicateNumbers(repaired),
  repairedDistinct: distinct.size, repairedCount: repaired.length,
  secondPass: planRenumber(repaired).moves.length,
}));
`;
writeFileSync(join(dir, 'parity.mts'), parityProbe);
{
  const r = runProbe(join(dir, 'parity.mts'));
  if (r.code !== 0) {
    check('numbering probe executes', false, r.out.slice(0, 400));
  } else {
    check('numbering probe executes', true);
    let d = {};
    try { d = JSON.parse(r.out.trim().split('\n').pop() || '{}'); } catch { /* reported below */ }
    check('two readers of one snapshot plan the SAME numbers', d.samePlan === true);
    check(
      'the guarded claim keeps numbering unique under concurrency',
      d.uniqueAfterConcurrent === true,
      `numbers after both writers: ${JSON.stringify(d.concurrentNumbers)}`,
    );
    check('the fixture reproduces the four duplicated numbers', d.damagedUnique === true);
    check('the repair moves exactly four cards', (d.planMoves || []).length === 4, JSON.stringify(d.planMoves));
    check('after the repair every number is unique', d.repairedUnique === true);
    check(
      'after the repair cards and distinct numbers are equal',
      d.repairedCount === d.repairedDistinct,
      `${d.repairedCount} cards vs ${d.repairedDistinct} numbers`,
    );
    check('the repair is idempotent', d.secondPass === 0, `second pass planned ${d.secondPass} move(s)`);
  }
}

// ---------------------------------------------------------------------------
// Part 3 — the shared loader is really shared, and the list route refuses to
// serve ambiguous numbers rather than quietly answering a different question.
// ---------------------------------------------------------------------------

{
  const snap = existsSync(join(ROOT, 'serverBugNumbers.ts'));
  const ib = existsSync(join(ROOT, 'serverIssueBacklog.ts'))
    ? execFileSync('cat', [join(ROOT, 'serverIssueBacklog.ts')], { encoding: 'utf8' })
    : '';
  const bs = existsSync(join(ROOT, 'serverBugSnapshot.ts'))
    ? execFileSync('cat', [join(ROOT, 'serverBugSnapshot.ts')], { encoding: 'utf8' })
    : '';
  const listRoute = bs.slice(bs.indexOf("app.get('/api/bugs/list'"), bs.indexOf("app.get('/api/bugs/queue'"));
  check('a shared loader module exists', snap);
  check('the board imports the shared loader', /from '\.\/serverBugNumbers\.js'/.test(ib));
  check('the list route imports the shared loader', /from '\.\/serverBugNumbers\.js'/.test(bs));
  check('the list route uses the shared loader, not its own query', /loadIssueTags\(\)/.test(listRoute));
  check('the list route no longer runs a private numbering loop', !/persistMissingPublicNs/.test(listRoute));
  check(
    'the list route refuses to serve a list whose #n are ambiguous',
    /duplicates_remaining/.test(listRoute) && /503/.test(listRoute),
  );
  check(
    'no read path assigns numbers from a snapshot and writes the whole blob',
    !/for \(const row of assigned\)/.test(bs) && !/for \(const row of numbered\)/.test(ib),
  );
}

rmSync(dir, { recursive: true, force: true });
console.log('');
console.log(
  failed === 0
    ? `assert-bug-ticket-count-parity: ${passed} pass, 0 fail`
    : `assert-bug-ticket-count-parity: ${passed} pass, ${failed} FAIL`,
);
process.exit(failed === 0 ? 0 : 1);
