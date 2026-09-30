#!/usr/bin/env node
/**
 * scripts/assert-meal-audit-ticket.mjs
 *
 * Hashimoto ratchet for Phase 2 (scripts/meal-audit-ticket.mjs).
 *
 * The regression this prevents: an audit divergence that is detected and scored
 * but never becomes a bug card, so the closed loop silently never iterates.
 * `meal-audit-compare.mjs --ledger` has always written issue_ledger.jsonl and
 * nothing consumed it — that is exactly the gap this bridge fills, and these
 * assertions are what stop it reopening.
 *
 * The assertions that matter most are the DISCIPLINE ones, because a bridge that
 * files bundled or unfounded tickets is worse than no bridge at all:
 *   - one defect per card (V-29), never a bundle
 *   - every card's criteria is a mechanical gate that can actually exit 0
 *   - photo_only provenance never files edit-history findings it cannot observe
 *   - re-running is idempotent, so a failed fix reuses the card
 *
 * Exit 0 = pass. Offline: no network, no server, no Playwright.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  planCards,
  failureToCard,
  orderFailures,
  bundleProvenance,
  EDIT_HISTORY_CODES,
  CODE_ORDER,
  TAXONOMY_COMPONENT,
  FALLBACK_COMPONENT,
} from './meal-audit-ticket.mjs';
import { packCheck } from './lib/bug-pack.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..');

let pass = 0;
let fail = 0;
const failures = [];

function check(name, fn) {
  try {
    fn();
    pass++;
    console.log(`  ok  ${name}`);
  } catch (e) {
    fail++;
    failures.push({ name, message: e?.message || String(e) });
    console.log(`  FAIL ${name}\n       ${e?.message || e}`);
  }
}

console.log('assert-meal-audit-ticket — audit finding -> bug card ratchet\n');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'meal-ticket-'));

function makeBundle(name, comparison, mealResult) {
  const dir = path.join(tmp, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'comparison.json'), JSON.stringify(comparison, null, 2));
  fs.writeFileSync(path.join(dir, 'meal_result.json'), JSON.stringify(mealResult, null, 2));
  return dir;
}

const FAILURES = [
  { taxonomy: 'core_nutrient_drift', key: 'protein', expected: 46.5, actual: 38.1, deltaPct: 18.1, tolerance: 10 },
  { taxonomy: 'micro_nutrient_drift', key: 'vitaminC', expected: 40, actual: 12, deltaPct: 70, tolerance: 30 },
  { taxonomy: 'name_mismatch', key: 'dish_1', expected: 'Grilled Chicken Breast', actual: 'Chicken Nuggets', deltaPct: null, tolerance: 0 },
];

const multiTurn = makeBundle(
  'Meal-Multi-01',
  { harness: { bundleName: 'Meal-Multi-01' }, verdict: 'FAIL', failures: FAILURES },
  { mode: 'multi_turn_flow', passes: [{}, {}] }
);

// --- provenance ---------------------------------------------------------------

check('provenance: multi_turn_flow bundle reads as multi_turn', () => {
  assert.equal(bundleProvenance(multiTurn), 'multi_turn');
});

check('provenance: photo_only bundle reads as photo_only', () => {
  const d = makeBundle('Meal-Photo-01', { harness: { bundleName: 'Meal-Photo-01' }, verdict: 'FAIL', failures: [] },
    { mode: 'photo_only_single_turn', passes: [{}] });
  assert.equal(bundleProvenance(d), 'photo_only');
});

// --- the core gap: findings must become cards --------------------------------

check('FAIL comparison produces one card per finding (the missing bridge)', () => {
  const plan = planCards(
    { harness: { bundleName: 'Meal-Multi-01' }, verdict: 'FAIL', failures: FAILURES },
    { bundleDir: multiTurn, provenance: 'multi_turn', actualPath: null }
  );
  assert.equal(plan.cards.length, 3, 'expected 3 cards for 3 findings');
  assert.equal(plan.cards.filter((c) => c.class === 'core_nutrient_drift').length, 1);
  assert.equal(plan.cards.filter((c) => c.class === 'micro_nutrient_drift').length, 1);
  assert.equal(plan.cards.filter((c) => c.class === 'name_mismatch').length, 1);
});

check('PASS comparison produces no cards', () => {
  const plan = planCards({ harness: { bundleName: 'X' }, verdict: 'PASS', failures: [] },
    { bundleDir: multiTurn, provenance: 'multi_turn', actualPath: null });
  assert.equal(plan.cards.length, 0);
});

// --- V-29: one defect per card ------------------------------------------------

check('V-29: every generated card passes packCheck (single-defect rule enforced upstream)', () => {
  const plan = planCards(
    { harness: { bundleName: 'Meal-Multi-01' }, verdict: 'FAIL', failures: FAILURES },
    { bundleDir: multiTurn, provenance: 'multi_turn', actualPath: null }
  );
  for (const c of plan.cards) {
    const chk = packCheck(c);
    assert.ok(chk.ok, `card rejected by packCheck: ${chk.error}\n${c.observed}`);
  }
});

check('V-29: a single failure yields exactly one card, never a bundle', () => {
  const plan = planCards(
    { harness: { bundleName: 'One' }, verdict: 'FAIL', failures: [FAILURES[0]] },
    { bundleDir: multiTurn, provenance: 'multi_turn', actualPath: null }
  );
  assert.equal(plan.cards.length, 1);
});

// --- criteria must be a mechanical gate --------------------------------------

check('criteria names the real comparator invocation and is idempotent-safe', () => {
  const plan = planCards(
    { harness: { bundleName: 'Meal-Multi-01' }, verdict: 'FAIL', failures: [FAILURES[0]] },
    { bundleDir: multiTurn, provenance: 'multi_turn', actualPath: 'qa-evidence/actual_meal.json' }
  );
  const c = plan.cards[0];
  assert.match(c.criteria, /meal-audit-compare\.mjs/);
  assert.match(c.criteria, /--bundle=/);
  assert.match(c.criteria, /--actual=/, 'criteria must carry the actual path when known');
  assert.match(c.criteria, /exits 0/, 'criteria must state the exit condition');
});

check('criteria references only a bundle path that actually exists on disk', () => {
  const plan = planCards(
    { harness: { bundleName: 'Meal-Multi-01' }, verdict: 'FAIL', failures: [FAILURES[0]] },
    { bundleDir: multiTurn, provenance: 'multi_turn', actualPath: null }
  );
  const m = plan.cards[0].criteria.match(/--bundle="([^"]+)"/);
  assert.ok(m, 'criteria must quote the bundle path');
  assert.ok(fs.existsSync(m[1]), `criteria points at a non-existent bundle: ${m[1]}`);
});

// --- photo_only must not file unobservable findings --------------------------

check('photo_only suppresses turn_mismatch and edit_not_applied', () => {
  const plan = planCards(
    {
      harness: { bundleName: 'Meal-PhotoOnly-01' }, verdict: 'FAIL',
      failures: [
        { taxonomy: 'turn_mismatch', key: 'turnCount', expected: 3, actual: 1, deltaPct: null, tolerance: 0 },
        { taxonomy: 'edit_not_applied', key: 'turn_2', expected: 'applied', actual: 'ignored', deltaPct: null, tolerance: 0 },
        { taxonomy: 'core_nutrient_drift', key: 'calories', expected: 500, actual: 700, deltaPct: 40, tolerance: 10 },
      ],
    },
    { bundleDir: multiTurn, provenance: 'photo_only', actualPath: null }
  );
  assert.equal(plan.cards.length, 1, 'only the observable nutrient drift may be filed');
  assert.equal(plan.cards[0].class, 'core_nutrient_drift');
  assert.equal(plan.suppressed.length, 2);
  for (const s of plan.suppressed) assert.ok(EDIT_HISTORY_CODES.has(s.taxonomy));
});

check('photo_only DOES still file observable findings', () => {
  const plan = planCards(
    {
      harness: { bundleName: 'Meal-PhotoOnly-01' }, verdict: 'FAIL',
      failures: [
        { taxonomy: 'core_nutrient_drift', key: 'calories', expected: 500, actual: 700, deltaPct: 40, tolerance: 10 },
        { taxonomy: 'portion_bias', key: 'weightGrams', expected: 300, actual: 480, deltaPct: 60, tolerance: 10 },
      ],
    },
    { bundleDir: multiTurn, provenance: 'photo_only', actualPath: null }
  );
  assert.equal(plan.cards.length, 2);
  assert.equal(plan.suppressed.length, 0);
});

// --- idempotency: a re-run after a failed fix must not spam ------------------

check('idempotency: the same finding yields a stable idem_key and fingerprint', () => {
  const args = { bundleDir: multiTurn, bundleName: 'Meal-Multi-01', provenance: 'multi_turn', actualPath: null };
  const a = failureToCard(FAILURES[0], args);
  const b = failureToCard(FAILURES[0], args);
  assert.equal(a.idemKey, b.idemKey);
  assert.equal(a.fingerprint, b.fingerprint);
  assert.match(a.idemKey, /^meal-audit\|Meal-Multi-01\|core_nutrient_drift\|protein$/);
});

check('idempotency: different keys on the same taxonomy get distinct idem_keys', () => {
  const args = { bundleDir: multiTurn, bundleName: 'Meal-Multi-01', provenance: 'multi_turn', actualPath: null };
  const a = failureToCard(FAILURES[0], args);
  const b = failureToCard({ ...FAILURES[0], key: 'calories' }, args);
  assert.notEqual(a.idemKey, b.idemKey);
});

// --- ordering: most structural first ----------------------------------------

check('ordering: the first card is the most structural finding', () => {
  const plan = planCards(
    {
      harness: { bundleName: 'Meal-Multi-01' }, verdict: 'FAIL',
      failures: [
        FAILURES[0], FAILURES[1], FAILURES[2],
        { taxonomy: 'turn_mismatch', key: 'turnCount', expected: 3, actual: 1, deltaPct: null, tolerance: 0 },
      ],
    },
    { bundleDir: multiTurn, provenance: 'multi_turn', actualPath: null }
  );
  assert.equal(plan.cards[0].class, 'turn_mismatch', 'turn_mismatch must be the primary card');
  assert.ok(
    plan.cards.map((c) => c.class).every((c) => CODE_ORDER.indexOf(c) !== -1),
    'every emitted class must be a known taxonomy code'
  );
});

check('every taxonomy code maps to a real component area', () => {
  for (const code of CODE_ORDER) {
    assert.ok(TAXONOMY_COMPONENT[code], `no component mapped for ${code}`);
  }
});

// --- taxonomy coverage -------------------------------------------------------

check('all 8 comparator taxonomy codes are handled', () => {
  assert.equal(CODE_ORDER.length, 8);
  for (const code of CODE_ORDER) {
    const plan = planCards(
      { harness: { bundleName: 'B' }, verdict: 'FAIL', failures: [{ taxonomy: code, key: 'k', expected: 1, actual: 2, deltaPct: 50, tolerance: 10 }] },
      { bundleDir: multiTurn, provenance: 'multi_turn', actualPath: null }
    );
    assert.equal(plan.cards.length, 1, `${code} produced no card`);
    assert.equal(plan.cards[0].class, code);
  }
});

check('an unknown taxonomy code still yields a card rather than being dropped', () => {
  const plan = planCards(
    { harness: { bundleName: 'B' }, verdict: 'FAIL', failures: [{ taxonomy: 'brand_new_code', key: 'k', expected: 1, actual: 2, deltaPct: 50, tolerance: 10 }] },
    { bundleDir: multiTurn, provenance: 'multi_turn', actualPath: null }
  );
  assert.equal(plan.cards.length, 1, 'unknown codes must not silently vanish');
  assert.equal(plan.cards[0].component, FALLBACK_COMPONENT,
    'an unmapped taxonomy must still route to a real component area for triage');
});

// --- CLI behaviour ------------------------------------------------------------

check('CLI --dry-run on a FAIL bundle exits 0 and plans without posting', () => {
  const r = spawnSync('node', [path.join(REPO_ROOT, 'scripts', 'meal-audit-ticket.mjs'),
    `--bundle=${multiTurn}`, '--dry-run', '--json'], { encoding: 'utf8' });
  assert.equal(r.status, 0, `expected exit 0, got ${r.status}: ${r.stderr}`);
  const j = JSON.parse(r.stdout);
  assert.equal(j.cards.length, 3);
  assert.equal(j.dryRun, true);
});

check('CLI on a PASS bundle exits 2 (nothing to file — not an error)', () => {
  const passBundle = makeBundle('Meal-Pass-01',
    { harness: { bundleName: 'Meal-Pass-01' }, verdict: 'PASS', failures: [] },
    { mode: 'multi_turn_flow', passes: [{}] });
  const r = spawnSync('node', [path.join(REPO_ROOT, 'scripts', 'meal-audit-ticket.mjs'),
    `--bundle=${passBundle}`, '--dry-run'], { encoding: 'utf8' });
  assert.equal(r.status, 2, `PASS must exit 2, got ${r.status}`);
});

check('CLI rejects a bundle with no comparison.json (fails loud, exit 3)', () => {
  const empty = path.join(tmp, 'Meal-Empty-01');
  fs.mkdirSync(empty, { recursive: true });
  const r = spawnSync('node', [path.join(REPO_ROOT, 'scripts', 'meal-audit-ticket.mjs'),
    `--bundle=${empty}`, '--dry-run'], { encoding: 'utf8' });
  assert.equal(r.status, 3);
  assert.match(r.stderr, /comparison\.json not found/);
});

fs.rmSync(tmp, { recursive: true, force: true });

console.log(`\n${pass} pass, ${fail} fail`);
if (fail > 0) {
  console.error('\nFailures:');
  for (const f of failures) console.error(`  - ${f.name}: ${f.message}`);
  process.exit(1);
}
process.exit(0);
