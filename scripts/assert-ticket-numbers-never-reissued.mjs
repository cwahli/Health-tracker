#!/usr/bin/env node
/**
 * assert-ticket-numbers-never-reissued — a number belongs to one card, forever.
 *
 * This is the hole I shipped in #391 and then walked into myself. The docstring
 * in bugNumberParity.ts said "numbers are never reused: a freed number stays
 * retired". The implementation was `max(numbers present) + 1`, so deleting the
 * highest-numbered card dropped the maximum and freed the number.
 *
 * Measured 2026-09-30: I created a scratch card for a live proof. It took #18.
 * I deleted it. Four minutes later the meal-audit bot filed a real defect and
 * it was given #18 — so a number I had cited in a note now pointed at a
 * completely different bug. The same ambiguity #391 was opened to remove, and
 * the duplicate-pair repair never touches it because that path only runs when a
 * number is currently held twice.
 *
 * The fix is a durable floor: `retired_ticket_numbers`. A number is inserted
 * there BEFORE its row is deleted, and the numbering pass takes
 * max(live, retired) + 1.
 *
 * EXECUTED, not grepped: part 1 drives the real planner over fixture rows; part 2
 * drives the real express delete route against a fake D1 that stores, then asks
 * the real numbering pass for the next number.
 *
 * Run: node scripts/assert-ticket-numbers-never-reissued.mjs
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dir = mkdtempSync(join(ROOT, '.ticket-retire-'));

let passed = 0;
let failed = 0;
const check = (name, ok, detail = '') => {
  if (ok) { passed += 1; console.log(`  PASS  ${name}`); }
  else { failed += 1; console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`); }
};

const runProbe = (file) => {
  const tsx = join(ROOT, 'node_modules', '.bin', 'tsx');
  if (!existsSync(tsx)) return { code: 127, out: 'tsx not installed in this checkout' };
  try {
    return { code: 0, out: execFileSync(tsx, [file], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) };
  } catch (err) {
    return { code: err.status ?? 1, out: `${err.stdout || ''}${err.stderr || ''}` };
  }
};
const lastJson = (out) => {
  try { return JSON.parse(String(out).trim().split('\n').pop() || '{}'); } catch { return {}; }
};

console.log('assert-ticket-numbers-never-reissued:');

// ---------------------------------------------------------------------------
// Part 1 — the planner's floor.
// ---------------------------------------------------------------------------

const planner = `
import { planAssignments, planRenumber, publicNOf } from '${ROOT}/src/utils/bugNumberParity.ts';

const card = (id, n, created = '2026-09-29') => ({ id, created_at: created, work_item: { public_n: n } });

// The live incident, exactly: cards 1..17 exist, #18's card is deleted, and a
// new card arrives. Without the retired floor it is handed #18 again.
const afterDelete = [card('a', 17), card('b', 1)];
const fresh = card('new', 0, '2026-09-30');
const withoutFloor = planAssignments([...afterDelete, fresh]);
const withFloor = planAssignments([...afterDelete, fresh], [], [18]);

// A retired number in the middle of the range must not be handed out either.
const midRetired = planAssignments([card('x', 1), card('y', 0, '2026-09-30')], [], [7]);

// A repair must not hand a retired number to the card being moved.
const dupes = [card('p', 5, '2026-01-01'), card('q', 5, '2026-02-01')];
const repairNoFloor = planRenumber(dupes);
const repairWithFloor = planRenumber(dupes, [6]);

console.log(JSON.stringify({
  withoutFloor: withoutFloor.map((x) => x.to),
  withFloor: withFloor.map((x) => x.to),
  midRetired: midRetired.map((x) => x.to),
  repairNoFloor: repairNoFloor.moves.map((m) => m.to),
  repairWithFloor: repairWithFloor.moves.map((m) => m.to),
  retiredIsNotReissued: !withFloor.some((x) => x.to === 18),
}));
`;
writeFileSync(join(dir, 'planner.mts'), planner);
{
  const r = runProbe(join(dir, 'planner.mts'));
  if (r.code !== 0) {
    check('the planner probe executes', false, r.out.slice(0, 400));
  } else {
    check('the planner probe executes', true);
    const d = lastJson(r.out);
    check('the shipped behaviour DID reissue #18 (the incident, reproduced)',
      (d.withoutFloor || []).includes(18), `gave ${JSON.stringify(d.withoutFloor)}`);
    check('the retired floor stops it', d.retiredIsNotReissued === true, `gave ${JSON.stringify(d.withFloor)}`);
    check('a retired number in the middle of the range is skipped too',
      !(d.midRetired || []).includes(7), `gave ${JSON.stringify(d.midRetired)}`);
    check('a repair never hands out a retired number',
      !(d.repairWithFloor || []).includes(6), `gave ${JSON.stringify(d.repairWithFloor)}`);
  }
}

// ---------------------------------------------------------------------------
// Part 2 — the delete route retires, and the next card skips the number.
// ---------------------------------------------------------------------------

const route = `
process.env.CLOUDFLARE_ACCOUNT_ID = 'acct';
process.env.CLOUDFLARE_D1_DATABASE_ID = 'db';
process.env.CLOUDFLARE_API_TOKEN = 'tok';

const tags = new Map();
const retired = new Set();
const add = (id, n, status = 'to_fix') => tags.set(id, {
  id, title: 'card ' + n, title_key: 'card-' + n, category: 'foodcart', status,
  created_at: '2026-09-29', updated_at: '2026-09-29', resolved_at: null,
  resolution_note: '', whats_still_open: '', comments: '[]',
  work_item: JSON.stringify({ public_n: n, queue: status === 'fixed' ? 'done' : 'ready', commits: [], burns: [] }),
});
add('tag_low', 1);
add('tag_high', 18, 'fixed');

const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  if (!String(url).includes('api.cloudflare.com')) return realFetch(url, init);
  const { sql, params = [] } = JSON.parse(init.body);
  const u = sql.toUpperCase();
  let results = [];
  if (/INSERT OR IGNORE INTO RETIRED_TICKET_NUMBERS/i.test(sql)) retired.add(Number(params[0]));
  else if (/SELECT PUBLIC_N FROM RETIRED_TICKET_NUMBERS/i.test(sql)) results = [...retired].map((n) => ({ public_n: n }));
  else if (/DELETE FROM ISSUE_TAGS WHERE ID/i.test(sql)) tags.delete(params[0]);
  else if (/DELETE FROM ISSUE_TAGS WHERE ID IN/i.test(sql)) for (const id of params) tags.delete(id);
  else if (/DELETE FROM ISSUE_TAG_LINKS/i.test(sql)) results = [];
  else if (/FROM ISSUE_TAGS/i.test(sql)) {
    results = [...tags.values()];
    // Honour WHERE id = ?. A stub that ignores it returns the wrong card for
    // every single-card lookup, which made the fixture retire #1 instead of
    // #18 and look exactly like a bug in the retirement code.
    const one = sql.match(/WHERE ID = \\?/i);
    if (one && params.length) results = results.filter((r) => String(r.id) === String(params[0]));
    const eq = sql.match(/status\\s*=\\s*'([^']+)'/i);
    if (eq) results = results.filter((r) => String(r.status) === eq[1]);
    const inList = sql.match(/status\\s+IN\\s*\\(([^)]*)\\)/i);
    if (inList) {
      const allowed = inList[1].split(',').map((x) => x.trim().replace(/^'|'$/g, ''));
      results = results.filter((r) => allowed.includes(String(r.status)));
    }
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

// Delete the card that holds the highest number — the exact incident.
const del = await (await fetch(base + '/api/bugs/tag_high', { method: 'DELETE' })).json();
const retiredAfterDelete = [...retired];

// A brand new card arrives, as the meal-audit bot's did.
add('tag_newcomer', 0);
const report = await claimPublicNumbers();
const issued = (report.claimed || []).find((c) => c.id === 'tag_newcomer');

console.log(JSON.stringify({
  deleted: !!del.success,
  retiredAfterDelete,
  issuedToNewcomer: issued ? issued.to : null,
  reissued: issued ? issued.to === 18 : null,
}));
server.close();
`;
writeFileSync(join(dir, 'route.mts'), route);
{
  const r = runProbe(join(dir, 'route.mts'));
  if (r.code !== 0) {
    check('the delete-route probe executes', false, r.out.slice(0, 500));
  } else {
    check('the delete-route probe executes', true);
    const d = lastJson(r.out);
    check('deleting the card succeeds', d.deleted === true, JSON.stringify(d));
    check('the number is retired by the delete', (d.retiredAfterDelete || []).includes(18),
      `retired: ${JSON.stringify(d.retiredAfterDelete)}`);
    check('the next card is NOT given the retired number', d.reissued === false,
      `issued #${d.issuedToNewcomer}`);
    check('and it gets a number above the retired floor', Number(d.issuedToNewcomer) > 18,
      `issued #${d.issuedToNewcomer}`);
  }
}

// ---------------------------------------------------------------------------
// Part 3 — the table exists and every delete path retires.
// ---------------------------------------------------------------------------
{
  const schema = execFileSync('cat', [join(ROOT, 'server_d1_schema.ts')], { encoding: 'utf8' });
  check('the schema declares retired_ticket_numbers', /CREATE TABLE IF NOT EXISTS retired_ticket_numbers/.test(schema));
  check('the table is keyed by the number itself', /public_n INTEGER PRIMARY KEY/.test(schema));
  const backlog = execFileSync('cat', [join(ROOT, 'serverIssueBacklog.ts')], { encoding: 'utf8' });
  const delSites = (backlog.match(/DELETE FROM issue_tags/g) || []).length;
  const retireCalls = (backlog.match(/retireTicketNumber/g) || []).length;
  check('every DELETE FROM issue_tags has a retirement alongside it',
    retireCalls >= delSites, `${delSites} delete site(s), ${retireCalls} retirement call(s)`);
  const numbers = execFileSync('cat', [join(ROOT, 'serverBugNumbers.ts')], { encoding: 'utf8' });
  check('the numbering pass reads the retired set',
    /planAssignments\(rows, \[\], retired\)/.test(numbers) && /loadRetiredNumbers/.test(numbers));
  check('a repair also respects the retired set', /planRenumber\(rows, retired\)/.test(numbers));
  check('an unreadable retired table degrades instead of 500-ing every read',
    /retired numbers unreadable/.test(numbers));
}

rmSync(dir, { recursive: true, force: true });
console.log('');
console.log(
  failed === 0
    ? `assert-ticket-numbers-never-reissued: ${passed} pass, 0 fail`
    : `assert-ticket-numbers-never-reissued: ${passed} pass, ${failed} FAIL`,
);
process.exit(failed === 0 ? 0 : 1);
