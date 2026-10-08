#!/usr/bin/env node
/**
 * scripts/assert-meal-audit-ground-truth.mjs
 *
 * Hashimoto ratchet for the ground truth a meal-audit card is measured against.
 *
 * The regression this prevents: the loop filing nutrient-drift cards off a
 * comparison whose own numbers cannot be true. Meal-prawn-ham-01 did exactly
 * that on 2026-10-01 and produced 13 dispatchable cards (#22-#34).
 *
 *   expected.json / meal_result.json declared estimatedWeightGrams: 0 while
 *   declaring calories: 13.2 — energy over zero mass. Not imprecise: undefined.
 *   expectedDishCount: 1 while the bundle's own title named two items.
 *   photos/ empty, so the truth could not be re-derived from the bundle.
 *   comparison.json verdict DIVERGED, primaryCode turn_mismatch.
 *
 * Every one of those cards said "the product computed the wrong nutrient", and
 * all 13 sat `packed` / `queue: ready`. An agent picking one up would have been
 * asked to make the Nutrient Compiler reproduce a 0 g meal worth 13.2 kcal.
 *
 * So the rule is: refuse before filing, and never repair. A ground truth that
 * has to be invented to make a card pass would be baked into product code, and
 * an unsourced weight is refused here rather than guessed — the same rule the
 * rest of this repo applies to ground truth it cannot cite.
 *
 * Exit 0 = pass. Offline: fixtures are written to a temp dir, nothing is
 * dispatched, no network, no sleeps.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { auditGrounding } from './meal-audit-loop.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

let pass = 0;
let fail = 0;
const failures = [];

function check(name, fn) {
  try {
    fn();
    pass += 1;
    console.log(`  ok  ${name}`);
  } catch (err) {
    fail += 1;
    failures.push(`${name}: ${err.message}`);
    console.log(`  FAIL ${name} — ${err.message}`);
  }
}

/** Build a bundle dir on disk. Only the fields the rule reads are written. */
function bundle({ expected, photos = [], comparison = null }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'meal-gt-'));
  if (expected !== undefined) {
    fs.writeFileSync(path.join(dir, 'expected.json'), JSON.stringify(expected, null, 2));
  }
  const photosDir = path.join(dir, 'photos');
  fs.mkdirSync(photosDir, { recursive: true });
  for (const p of photos) fs.writeFileSync(path.join(photosDir, p), 'x');
  if (comparison !== null) {
    fs.writeFileSync(path.join(dir, 'comparison.json'), JSON.stringify(comparison, null, 2));
  }
  return dir;
}

const dirs = [];
const mk = (o) => { const d = bundle(o); dirs.push(d); return d; };

// A well-formed ground truth: real mass, one item, a photo to back the box.
const GOOD = {
  expectedItems: [
    { dishName: 'Cooked ham slices', estimatedWeightGrams: 14, boundingBox2D: [280, 0, 880, 1000], nutrients: { calories: 13.2 } },
  ],
  passes: [{ expectedDishCount: 1 }],
  finalMealTotals: { weight: 14, calories: 13.2, protein: 2.5 },
};

// ---------------------------------------------------------------------------
// 1. Energy over zero mass
// ---------------------------------------------------------------------------
console.log('\nweight 0 with non-zero totals');

// The exact shape from Meal-prawn-ham-01, reproduced field for field.
check('refuses declared weight 0 alongside non-zero calories', () => {
  const dir = mk({
    expected: {
      expectedItems: [{ dishName: 'Cooked ham slices', estimatedWeightGrams: 0, boundingBox2D: [280, 0, 880, 1000], nutrients: { calories: 13.2 } }],
      passes: [{ expectedDishCount: 1 }],
      finalMealTotals: { weight: 0, calories: 13.2, protein: 2.5, sugar: 0.1 },
    },
    photos: ['meal.jpg'],
  });
  const r = auditGrounding(dir, { primaryCode: null });
  assert.equal(r.refuse, true, 'must refuse');
  assert.match(r.reasons.join(' '), /weight is 0 g/, `reasons were: ${r.reasons.join('; ')}`);
});

// 0 g is only suspicious when something else is non-zero. An empty meal is fine.
check('allows a genuinely empty meal (0 g and nothing else)', () => {
  const dir = mk({
    expected: {
      expectedItems: [{ dishName: 'Nothing', estimatedWeightGrams: 0, nutrients: {} }],
      passes: [{ expectedDishCount: 1 }],
      finalMealTotals: { weight: 0, calories: 0 },
    },
  });
  assert.equal(auditGrounding(dir, { primaryCode: null }).refuse, false);
});

check('allows a normal meal', () => {
  const dir = mk({ expected: GOOD, photos: ['meal.jpg'] });
  assert.equal(auditGrounding(dir, { primaryCode: null }).refuse, false);
});

// ---------------------------------------------------------------------------
// 2. The bundle disagreeing with itself
// ---------------------------------------------------------------------------
console.log('\nself-inconsistent bundle');

check('refuses expectedDishCount that disagrees with expectedItems.length', () => {
  const dir = mk({
    expected: {
      // Title names two items; the bundle claims one and holds one, but the
      // pass says the meal had 1 while the items list is empty of a match.
      expectedItems: [{ dishName: 'Cooked ham slices', estimatedWeightGrams: 14, nutrients: { calories: 13.2 } }],
      passes: [{ expectedDishCount: 2 }],
      finalMealTotals: { weight: 14, calories: 13.2 },
    },
    photos: ['meal.jpg'],
  });
  const r = auditGrounding(dir, { primaryCode: null });
  assert.equal(r.refuse, true, 'must refuse');
  assert.match(r.reasons.join(' '), /expectedDishCount 2 disagrees with expectedItems\.length 1/);
});

check('refuses a bundle whose boundingBox2D cannot be checked (photos/ empty)', () => {
  const dir = mk({ expected: GOOD, photos: [] });
  const r = auditGrounding(dir, { primaryCode: null });
  assert.equal(r.refuse, true, 'must refuse');
  assert.match(r.reasons.join(' '), /photos\/ is empty/);
});

// ---------------------------------------------------------------------------
// 3. The comparator's own primary failure
// ---------------------------------------------------------------------------
console.log('\ncomparison primaryCode');

check('refuses turn_mismatch — the deltas measure the wrong meal', () => {
  const dir = mk({ expected: GOOD, photos: ['meal.jpg'] });
  const r = auditGrounding(dir, { primaryCode: 'turn_mismatch' });
  assert.equal(r.refuse, true, 'must refuse');
  assert.match(r.reasons.join(' '), /primaryCode is turn_mismatch/);
});

check('does not refuse an ordinary nutrient drift', () => {
  const dir = mk({ expected: GOOD, photos: ['meal.jpg'] });
  assert.equal(auditGrounding(dir, { primaryCode: 'core_nutrient_drift' }).refuse, false);
});

check('a turn_mismatch is refused even when the ground truth itself looks fine', () => {
  // The two failures are independent. A clean fixture does not launder a
  // comparison that ran the wrong turn.
  const dir = mk({ expected: GOOD, photos: ['meal.jpg'] });
  const r = auditGrounding(dir, { primaryCode: 'turn_mismatch' });
  assert.equal(r.refuse, true);
  assert.equal(r.reasons.length, 1, `expected only the turn reason, got: ${r.reasons.join('; ')}`);
});

// ---------------------------------------------------------------------------
// 4. Missing ground truth is a refusal, never a silent pass
// ---------------------------------------------------------------------------
console.log('\nunreadable ground truth');

check('refuses when expected.json is unreadable', () => {
  const dir = mk({ expected: undefined });
  const r = auditGrounding(dir, { primaryCode: null });
  assert.equal(r.refuse, true, 'must refuse');
  assert.match(r.reasons.join(' '), /ground truth unreadable/);
});

check('refuses when expected.json is malformed JSON', () => {
  const dir = mk({ expected: undefined });
  fs.writeFileSync(path.join(dir, 'expected.json'), '{ not json');
  const r = auditGrounding(dir, { primaryCode: null });
  assert.equal(r.refuse, true);
  assert.match(r.reasons.join(' '), /ground truth unreadable/);
});

// ---------------------------------------------------------------------------
// 5. The real bundle on disk
// ---------------------------------------------------------------------------
console.log('\nthe bundle that actually caused this');

check('refuses the real Meal-prawn-ham-01 bundle if it is present', () => {
  const real = '/home/ubuntu/dev/meal-qa-remaining/artifacts/meal_audits/Meal-prawn-ham-01';
  if (!fs.existsSync(path.join(real, 'expected.json'))) {
    console.log('       (skipped: bundle not on this host)');
    return;
  }
  const cmpPath = path.join(real, 'comparison.json');
  const cmp = fs.existsSync(cmpPath) ? JSON.parse(fs.readFileSync(cmpPath, 'utf8')) : { primaryCode: null };
  const r = auditGrounding(real, cmp);
  assert.equal(r.refuse, true, 'the bundle that produced 13 cards must still be refused');
  assert.ok(r.reasons.length >= 2, `expected several independent reasons, got: ${r.reasons.join('; ')}`);
});

// ---------------------------------------------------------------------------
// 6. End to end: the loop must not FILE a card from a degenerate bundle
// ---------------------------------------------------------------------------
//
// The unit assertions above prove the rule. This one proves the rule is
// actually WIRED IN, which is the part that regressed: the old loop called
// fileTickets unconditionally on DIVERGED/FAIL. It runs the real CLI against a
// fixture reproducing Meal-prawn-ham-01 and asserts zero cards come out.
//
// `--dry-run` is used deliberately: the old loop would otherwise POST 13 real
// cards to the board, and a sensor must not have that side effect.
console.log('\nend to end — the loop files nothing');

check('the loop files zero cards from a degenerate bundle', () => {
  const dir = mk({
    expected: {
      title: 'Prawn and Penne Pasta Salad and Cooked Ham Slices',
      expectedItems: [{ dishName: 'Cooked ham slices', estimatedWeightGrams: 0, boundingBox2D: [280, 0, 880, 1000], nutrients: { calories: 13.2, sugar: 0.1 } }],
      passes: [{ expectedDishCount: 1, photos: [] }],
      finalMealTotals: { weight: 0, calories: 13.2, protein: 2.5, sugar: 0.1 },
    },
    photos: [],
  });
  // The comparison the comparator itself would have written: DIVERGED, and the
  // primary failure is that the turn did not match.
  fs.writeFileSync(path.join(dir, 'comparison.json'), JSON.stringify({
    verdict: 'DIVERGED',
    primaryCode: 'turn_mismatch',
    failureCount: 24,
    failures: [
      { taxonomy: 'turn_mismatch', key: 'dishCount', expected: 1, actual: 2, deltaPct: null, tolerance: 0 },
      { taxonomy: 'core_nutrient_drift', key: 'calories', expected: 13.2, actual: 473, deltaPct: 3483.3, tolerance: 10, level: 'meal' },
      { taxonomy: 'micro_nutrient_drift', key: 'sugar', expected: 0.1, actual: 0.7, deltaPct: 600, tolerance: 30, level: 'dish', dish: 'cooked_ham_slices' },
    ],
  }, null, 2));

  const r = spawnSync(process.execPath, [path.join(HERE, 'meal-audit-loop.mjs'), `--bundle=${dir}`, '--dry-run', '--no-dispatch'], {
    encoding: 'utf8', timeout: 120000, cwd: path.join(HERE, '..'),
  });
  const out = `${r.stdout || ''}${r.stderr || ''}`;

  // The bundle must be refused by name, whatever the exit code.
  assert.match(out, /ungrounded comparison, no cards filed/i,
    `the loop did not refuse the bundle; output was:\n${out.slice(-1200)}`);

  // And nothing may have been planned for posting. A card id or public number
  // appearing in the output means a card was created.
  const posted = /public_?n(?:umber)?\D{0,4}\d+|posted\D{0,4}\d+/i.exec(out);
  assert.equal(posted, null,
    `the loop still posted cards (${posted && posted[0]}); output tail:\n${out.slice(-1200)}`);
});

for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });

console.log(`\nassert-meal-audit-ground-truth: ${pass} pass, ${fail} fail`);
if (fail > 0) {
  console.log('FAILURES:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
process.exit(0);
