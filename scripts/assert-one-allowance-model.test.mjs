// One allowance model. /allowance, /freemodel and the turn's lane choice must
// not be able to disagree about the same lane, which is what the two bots'
// /allowance output showed: a route marked unavailable on one surface and
// offered on another.
//
// The lane CATALOG is shared. Quota is per worker: each bot passes its own
// session, so two bots may honestly disagree about what is depleted right now.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { projectLanes, annotateFreemodelEntries, buildAllowanceTextForBots, ensureBotLedger, stampDepleted } from './lib/free-lanes.mjs';
import { selectTurnLanes } from './bot-host.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
let passed = 0;
let failed = 0;
function check(name, cond) {
  if (cond) { console.log(`  PASS  ${name}`); passed++; } else { console.error(`  FAIL  ${name}`); failed++; }
}

console.log('assert-one-allowance-model:');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'allowance-model-'));
const oldHome = process.env.HOME;
const oldOverride = process.env.FREE_LANES_DIR;
process.env.HOME = home;

const table = {
  lanes: [
    { provider: 'opencode', model: 'opencode/zen-a', pref: 1, status: 'available', tg: true, label: 'Zen A' },
    { provider: 'cline', model: 'cline-free/deep-b', pref: 2, status: 'available', tg: true, label: 'Deep B' },
    { provider: 'opencode', model: 'opencode/zen-c', pref: 3, status: 'available', tg: true, label: 'Zen C', bucket: 'zen-free' },
    { provider: 'tokenharbor', model: 'th/d', pref: 4, status: 'available', tg: true, label: 'TH D' },
    { provider: 'freebuff', model: 'fb/terminal', pref: 5, status: 'available', tg: false, label: 'FB' },
    { provider: 'opencode', model: 'opencode/promo', pref: 6, status: 'ended', tg: true, label: 'Old Promo' },
  ],
};

try {
  // 1. The projection gives one verdict per lane, and it is explicit.
  const clean = projectLanes(table, {});
  check('every lane is projected', clean.length === 6);
  check('an available Telegram lane is selectable', clean.find((r) => r.label === 'Zen A')?.selectable === true);
  check('a terminal-only lane is never selectable', clean.find((r) => r.label === 'FB')?.selectable === false);
  check('a terminal-only lane says why', /terminal only/.test(clean.find((r) => r.label === 'FB')?.reason || ''));
  check('an ended lane is never selectable', clean.find((r) => r.label === 'Old Promo')?.selectable === false);
  check('an ended lane says why', /never offered again/.test(clean.find((r) => r.label === 'Old Promo')?.reason || ''));
  check('each row carries a plan code', clean.every((r) => typeof r.plan === 'string' && r.plan.length >= 2));

  // 2. Quota marks a lane, and only for the worker whose session says so.
  const now = Date.now();
  const vmSession = { quota: { 'opencode/opencode/zen-a': { depletedUntil: now + 45 * 60 * 1000, countdownHint: '45m' } } };
  const vmView = projectLanes(table, vmSession, { now });
  const otherView = projectLanes(table, {}, { now });
  check('a stamped lane is not selectable for that worker', vmView.find((r) => r.label === 'Zen A')?.selectable === false);
  check('and it carries the vendor countdown', /45m/.test(vmView.find((r) => r.label === 'Zen A')?.resetLabel || ''));
  check('another worker sees the same lane as available', otherView.find((r) => r.label === 'Zen A')?.selectable === true);
  check('the catalog is identical for both', vmView.map((r) => r.ref).join() === otherView.map((r) => r.ref).join());

  // 3. A shared bucket takes the sibling with it, on every surface.
  const bucketSession = { quota: { 'bucket:zen-free': { depletedUntil: now + 3600 * 1000 } } };
  const bucketView = projectLanes(table, bucketSession, { now });
  check('the bucket sibling is out too', bucketView.find((r) => r.label === 'Zen C')?.selectable === false);

  // 4. /freemodel and /allowance cannot disagree, row for row.
  const catalog = [
    { ref: 'opencode/zen-a', label: 'Zen A' },
    { ref: 'cline:cline-free/deep-b', label: 'Deep B' },
    { ref: 'fb/terminal', label: 'FB' },
    { ref: 'opencode/promo', label: 'Old Promo' },
  ];
  const annotated = annotateFreemodelEntries(catalog, table, vmSession, { now });
  const byLabel = (label) => annotated.find((a) => a.label === label);
  check('/freemodel marks the stamped lane depleted', byLabel('Zen A')?.depleted === true);
  check('/freemodel agrees it is not selectable', byLabel('Zen A')?.selectable === false);
  check('/freemodel agrees the terminal lane is not selectable', byLabel('FB')?.selectable === false);
  check('/freemodel agrees the ended lane is not selectable', byLabel('Old Promo')?.selectable === false);
  check('/freemodel keeps a healthy lane selectable', byLabel('Deep B')?.selectable === true);
  check('a catalog model with no lane row is flagged, not silently offered', annotateFreemodelEntries([{ ref: 'opencode/ghost', label: 'Ghost' }], table, vmSession, { now })[0].inLedger === false);

  // for every row the two surfaces must produce the same verdict
  const rows = projectLanes(table, vmSession, { now });
  for (const row of rows) {
    const a = annotated.find((x) => x.label === row.label);
    if (!a) continue;
    check(`same verdict on both surfaces: ${row.label}`, a.selectable === row.selectable && a.depleted === row.depleted);
  }

  // 5. The turn's walk offers exactly the selectable rows.
  const { dir } = ensureBotLedger('vm');
  fs.writeFileSync(path.join(dir, 'free-lane-table.json'), JSON.stringify(table, null, 2));
  fs.writeFileSync(path.join(dir, 'session.json'), JSON.stringify(vmSession, null, 2));
  const walked = selectTurnLanes({ botId: 'vm', model: 'cline:cline-free/deep-b', fallback: 'opencode/zen-a', now });
  const selectableRefs = rows.filter((r) => r.selectable).map((r) => r.ref);
  for (const ref of walked.models) {
    check(`the walk offers only selectable rows: ${ref}`, selectableRefs.includes(ref) || ref === 'cline:cline-free/deep-b');
  }
  check('the walk never offers the terminal lane', !walked.models.some((m) => /fb\//.test(m)));
  check('the walk never offers the ended lane', !walked.models.some((m) => /promo/.test(m)));

  // 6. /allowance renders the same rows from the same ledger.
  const text = buildAllowanceTextForBots({ stateDir: dir, now });
  check('/allowance lists the healthy lane', /Deep B/.test(text));
  // An ended lane stays visible with its verdict: a model the user remembers
  // must not simply vanish, and /freemodel needs a row to point at.
  check('/allowance shows the ended lane as not usable', /Old Promo/.test(text) && /ended/.test(text));
  check('/allowance shows the reset for the stamped lane', /Zen A/.test(text));
  check('/allowance never marks a blocked lane as available', !/✅ (Old Promo|FB)/.test(text));
  check('/allowance names the next usable lane', /Next up: Deep B/.test(text));
} finally {
  if (oldHome === undefined) delete process.env.HOME; else process.env.HOME = oldHome;
  if (oldOverride === undefined) delete process.env.FREE_LANES_DIR; else process.env.FREE_LANES_DIR = oldOverride;
  fs.rmSync(home, { recursive: true, force: true });
}

console.log(`\n${passed} pass, ${failed} fail`);
process.exit(failed === 0 ? 0 : 1);
