#!/usr/bin/env node
/**
 * scripts/assert-meal-audit-assist.mjs
 *
 * Ratchet for the corpus-population helper.
 *
 * The regression this prevents is the dangerous one: a helper that "fills in"
 * nutrients it does not have. A bundle is ground truth — a coder trusts it and a
 * verifier checks a fix against it. If this tool ever invented a number, the
 * loop would file confident bug cards against fabricated clinical data, and the
 * whole audit chain would be worthless while looking healthy.
 *
 * So the assertions here are mostly about refusing to guess:
 *   - an unknown catalog key FAILS LOUDLY, never becomes zeros
 *   - nutrients absent from a catalog entry become 0, not an estimate
 *   - calories are DERIVED from macros, so Atwater passes on real arithmetic
 *   - a dish without boundingBox2D is rejected when photos exist
 *   - the catalog is read without importing server_d1 (D1 bindings)
 *
 * Exit 0 = pass. Offline.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { scaleDish, buildDish } from './meal-audit-assist.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..');
const { NUTRIENT_KEYS } = await import(path.join(REPO_ROOT, 'scripts', 'generate-meal-result.mjs'));

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

console.log('assert-meal-audit-assist — refuse-to-guess ratchet\n');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'meal-assist-'));

// Catalog entries known to exist, read from the helper itself.
const catalogKeys = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'meal-audit-assist.mjs'), 'utf8')
  .includes('STANDARD_BASE_FOODS');
check('the helper reads STANDARD_BASE_FOODS without importing server_d1', () => {
  const r = spawnSync('node', [path.join(REPO_ROOT, 'scripts', 'meal-audit-assist.mjs'), '--list-catalog'],
    { encoding: 'utf8', timeout: 60000 });
  assert.equal(r.status, 0, `--list-catalog must run offline, exit ${r.status}\n${r.stderr}`);
  assert.doesNotMatch(r.stderr, /ERR_MODULE_NOT_FOUND/, 'must not pull D1 bindings');
  assert.match(r.stdout, /catalog entries/, 'must report the catalog');
});

check('an unknown catalog key THROWS rather than returning zeros', () => {
  // The single most important assertion: never fabricate.
  assert.throws(
    () => scaleDish({ catalogKey: 'definitely_not_a_food', weightGrams: 100 }),
    /unknown catalog key/,
    'an unknown key must fail loudly, not silently produce an empty dish'
  );
});

check('a known key scales per-100g values by weight', () => {
  const { nutrients, fdcId } = scaleDish({ catalogKey: 'ranch_dressing', weightGrams: 50 });
  // ranch_dressing is 430 kcal / 100 g, so 50 g is 215 kcal before derivation.
  assert.ok(fdcId, 'a scaled dish must stay traceable to an FDC id');
  assert.equal(nutrients.protein.toFixed(2), (1.5 * 0.5).toFixed(2));
  assert.equal(nutrients.totalFat.toFixed(2), (45.0 * 0.5).toFixed(2));
});

check('calories are DERIVED from macros, satisfying the Atwater gate', () => {
  const { nutrients } = scaleDish({ catalogKey: 'ranch_dressing', weightGrams: 30 });
  const atwater = 4 * nutrients.protein + 4 * nutrients.carbohydrates + 9 * nutrients.totalFat;
  assert.equal(nutrients.calories, atwater,
    'declared calories must equal the Atwater sum, not a separate guess');
});

check('every one of the 32 nutrient keys is present and finite', () => {
  const { nutrients } = scaleDish({ catalogKey: 'caesar_dressing', weightGrams: 20 });
  for (const k of NUTRIENT_KEYS) {
    assert.equal(typeof nutrients[k], 'number', `${k} must be a number`);
    assert.ok(Number.isFinite(nutrients[k]), `${k} must be finite`);
    assert.ok(nutrients[k] >= 0, `${k} must be non-negative`);
  }
  assert.equal(NUTRIENT_KEYS.length, 32);
});

check('a nutrient absent from the catalog entry becomes 0, not an estimate', () => {
  const { nutrients } = scaleDish({ catalogKey: 'ranch_dressing', weightGrams: 100 });
  // omega3 is not in the ranch_dressing entry; it must be 0 rather than guessed.
  assert.equal(nutrients.omega3, 0, 'absent nutrients must be an honest 0');
});

check('buildDish sums components and derives the dish total', () => {
  const d = buildDish({
    dishName: 'Salad with dressing',
    components: [
      { catalogKey: 'ranch_dressing', weightGrams: 20 },
      { catalogKey: 'caesar_dressing', weightGrams: 10 },
    ],
  });
  assert.equal(d.weightGrams, 30);
  assert.equal(d.ingredients.length, 2);
  const atwater = 4 * d.nutrients.protein + 4 * d.nutrients.carbohydrates + 9 * d.nutrients.totalFat;
  assert.equal(d.nutrients.calories, atwater);
  for (const ing of d.ingredients) assert.ok(ing.fdcId, 'every ingredient keeps its FDC trace');
});

check('a single-catalogKey dish is accepted (components optional)', () => {
  const d = buildDish({ dishName: 'Dressing', catalogKey: 'vinaigrette', weightGrams: 15 });
  assert.equal(d.weightGrams, 15);
  assert.equal(d.ingredients.length, 1);
});

check('a non-positive or missing weight is rejected', () => {
  assert.throws(() => buildDish({ dishName: 'X', catalogKey: 'vinaigrette', weightGrams: 0 }), /weightGrams/);
  assert.throws(() => buildDish({ dishName: 'X', catalogKey: 'vinaigrette', weightGrams: -5 }), /weightGrams/);
});

check('a dish without boundingBox2D is rejected by the CLI when photos exist', () => {
  const spec = path.join(tmp, 'no-bbox.json');
  fs.writeFileSync(spec, JSON.stringify({
    title: 'No bbox',
    dishes: [{ dishName: 'Dressing', catalogKey: 'vinaigrette', weightGrams: 10 }],
  }));
  const r = spawnSync('node', [path.join(REPO_ROOT, 'scripts', 'meal-audit-assist.mjs'),
    `--spec=${spec}`, '--bundle=Meal-NoBbox-01', `--output-dir=${tmp}/out`],
    { encoding: 'utf8', timeout: 60000 });
  assert.equal(r.status, 3, 'must exit 3, not emit an unusable payload');
  assert.match(r.stderr, /boundingBox2D/);
});

check('a well-formed spec produces a payload the real generator accepts', () => {
  const spec = path.join(tmp, 'good.json');
  fs.writeFileSync(spec, JSON.stringify({
    title: 'Dressing test',
    dishes: [{
      dishName: 'Ranch dressing', catalogKey: 'ranch_dressing', weightGrams: 20,
      boundingBox2D: [100, 100, 500, 500],
    }],
  }));
  const outDir = path.join(tmp, 'bundle');
  // ranch_dressing carries no transFat/omega3, so the completeness guard fires.
  // --allow-unsourced is the explicit acknowledgement that the gap is accepted.
  const r = spawnSync('node', [path.join(REPO_ROOT, 'scripts', 'meal-audit-assist.mjs'),
    `--spec=${spec}`, '--bundle=Meal-Dressing-01', `--output-dir=${outDir}`, '--allow-unsourced'],
    { encoding: 'utf8', timeout: 60000 });
  assert.equal(r.status, 0, `assist failed: ${r.stderr}`);

  const payloadPath = path.join(outDir, 'audit_payload.json');
  assert.ok(fs.existsSync(payloadPath), 'payload must be written');

  const gen = spawnSync('node', [path.join(REPO_ROOT, 'scripts', 'generate-meal-result.mjs'),
    `--input=${payloadPath}`, '--bundle-name=Meal-Dressing-01', `--output-dir=${outDir}/bundle`],
    { encoding: 'utf8', timeout: 120000 });
  assert.equal(gen.status, 0, `generator rejected the assist payload:\n${gen.stdout}\n${gen.stderr}`);
  assert.ok(fs.existsSync(path.join(outDir, 'bundle', 'meal_result.json')));
  assert.ok(fs.existsSync(path.join(outDir, 'bundle', 'expected.json')));
});

check('an INCOMPLETE audit is REFUSED by default, not silently emitted', () => {
  // The failure this prevents: an audit missing 18 micronutrients stores them as
  // 0, and the comparator scores 0-vs-real as 100% drift. The loop would then file
  // confident bug cards against the AUDIT rather than the product.
  const spec = path.join(tmp, 'gap.json');
  fs.writeFileSync(spec, JSON.stringify({
    title: 'Gap test',
    dishes: [{
      dishName: 'Ranch dressing', catalogKey: 'ranch_dressing', weightGrams: 20,
      boundingBox2D: [100, 100, 500, 500],
    }],
  }));
  const outDir = path.join(tmp, 'gapout');
  const r = spawnSync('node', [path.join(REPO_ROOT, 'scripts', 'meal-audit-assist.mjs'),
    `--spec=${spec}`, '--bundle=Meal-Gap-01', `--output-dir=${outDir}`],
    { encoding: 'utf8', timeout: 60000 });
  assert.equal(r.status, 4, `incomplete audit must exit 4, got ${r.status}`);
  assert.match(r.stderr, /INCOMPLETE AUDIT/);
  assert.match(r.stderr, /no catalog source/);
  assert.ok(!fs.existsSync(path.join(outDir, 'audit_payload.json')),
    'no payload may be written when the audit is knowingly incomplete');
});

check('unsourced nutrients are named on the dish, not hidden as zeros', () => {
  const d = buildDish({ dishName: 'Ranch dressing', catalogKey: 'ranch_dressing', weightGrams: 20 });
  assert.ok(Array.isArray(d.unsourcedNutrients), 'the gap must be recorded on the dish');
  assert.ok(d.unsourcedNutrients.includes('transFat'),
    `expected transFat in the gap, got ${JSON.stringify(d.unsourcedNutrients)}`);
  // The value is still 0 because the generator requires a finite number.
  assert.equal(d.nutrients.transFat, 0);
});

check('the catalog is small enough that hand-population is NOT viable', () => {
  // Documents WHY the corpus is blocked. If this ever goes false, the corpus can
  // be populated without a new endpoint and item 1 in the runbook is obsolete.
  const r = spawnSync('node', [path.join(REPO_ROOT, 'scripts', 'meal-audit-assist.mjs'), '--list-catalog'],
    { encoding: 'utf8', timeout: 60000 });
  const n = parseInt((r.stdout.match(/^(\d+) catalog entries/m) || [])[1] || '0', 10);
  assert.ok(n > 0, 'catalog must be non-empty');
  assert.ok(n < 40,
    `catalog has ${n} entries and is all dressings — the corpus blocker in ` +
    'plan/MEAL_QA_LOOP_STATE.md may be obsolete, re-check before adding a route');
});

fs.rmSync(tmp, { recursive: true, force: true });

console.log(`\n${pass} pass, ${fail} fail`);
if (fail > 0) {
  console.error('\nFailures:');
  for (const f of failures) console.error(`  - ${f.name}: ${f.message}`);
  process.exit(1);
}
process.exit(0);
