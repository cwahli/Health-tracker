#!/usr/bin/env node
/**
 * scripts/assert-meal-audit-resolve.mjs
 *
 * Hashimoto ratchet for Phase 1 (scripts/meal-audit-resolve.mjs).
 *
 * The regression this prevents: saved meals that cannot be reproduced because the
 * resolver failed to map them onto surviving evidence. On the live D1 store only
 * ~11 of 50 recent food_logs carried a debug_url, so the naive path (job id from
 * debug_url alone) dead-ended on ~78% of the corpus. This gate pins the three
 * provenance tiers, and in particular pins that a photo_only bundle NEVER claims
 * edit-history observability — a silent overclaim would let the audit agent file
 * turn_mismatch / edit_not_applied findings it structurally cannot support.
 *
 * Exit 0 = pass. Offline: no network, no Playwright, no server.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// The generator is ESM; this file is ESM too, so import it directly and reuse
// its canonical 32-nutrient key set rather than duplicating the list.
const { NUTRIENT_KEYS } = await import('./generate-meal-result.mjs');

import {
  extractJobId,
  resolveMeal,
  buildPhotoOnlySkeleton,
  safeImageList,
  SCHEMA_VERSION,
} from './meal-audit-resolve.mjs';

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

console.log('assert-meal-audit-resolve — meal -> evidence resolution ratchet\n');

// --- job id extraction from the debug URL shape --------------------------------

check('extracts job id from a plain debug URL', () => {
  assert.equal(
    extractJobId('https://pub-x.r2.dev/debug/job_1790700418932_7ub9k50zj.json'),
    'job_1790700418932_7ub9k50zj'
  );
});

check('extracts job id when the debug URL has a prefix segment', () => {
  assert.equal(
    extractJobId('https://pub-x.r2.dev/debug/Pqc9RG33GRdEL/job_1790784359089_kvt6r0c0g.json'),
    'job_1790784359089_kvt6r0c0g'
  );
});

check('returns null for a missing or non-job debug URL (never invents an id)', () => {
  assert.equal(extractJobId(''), null);
  assert.equal(extractJobId(null), null);
  assert.equal(extractJobId(undefined), null);
  assert.equal(extractJobId('https://pub-x.r2.dev/debug/Pqc9RG33GRdEL/some-file.json'), null);
});

// --- image list parsing --------------------------------------------------------

check('parses image_urls stored as a JSON string (D1 column shape)', () => {
  const row = { image_urls: '["/photos/a.jpg","/photos/b.jpg"]' };
  assert.deepEqual(safeImageList(row), ['/photos/a.jpg', '/photos/b.jpg']);
});

check('tolerates malformed image_urls without throwing', () => {
  assert.deepEqual(safeImageList({ image_urls: 'not-json' }), []);
  assert.deepEqual(safeImageList({}), []);
  assert.deepEqual(safeImageList({ image_urls: null }), []);
});

// --- the three provenance tiers -----------------------------------------------

check('tier 1: debug_url present -> debug_payload, replayable, edit history observable', () => {
  const r = resolveMeal({
    id: 'meal_1',
    name: 'Steak Salad',
    debug_url: 'https://pub-x.r2.dev/debug/job_123_abc.json',
    image_urls: '["/photos/a.jpg"]',
  });
  assert.equal(r.provenance, 'debug_payload');
  assert.equal(r.jobId, 'job_123_abc');
  assert.equal(r.replayable, true);
  assert.equal(r.editHistoryObservable, true);
});

check('tier 2: no debug_url but photos -> photo_only, NOT replayable, edit history NOT observable', () => {
  const r = resolveMeal({ id: 'meal_2', name: 'Oatmeal', image_urls: '["/photos/a.jpg"]' });
  assert.equal(r.provenance, 'photo_only');
  assert.equal(r.jobId, null);
  assert.equal(r.replayable, false);
  // The overclaim guard: this is the assertion the naive resolver would fail.
  assert.equal(r.editHistoryObservable, false);
  assert.ok(r.photoCount > 0);
});

check('tier 3: no debug_url and no photo -> unreproducible, fails loud', () => {
  const r = resolveMeal({ id: 'meal_3', name: 'Ghost meal', image_urls: '[]' });
  assert.equal(r.provenance, 'unreproducible');
  assert.equal(r.photoCount, 0);
  assert.equal(r.replayable, false);
  assert.match(r.reason, /cannot reconstruct/i);
});

check('an empty string debug_url does NOT promote a row to debug_payload', () => {
  const r = resolveMeal({ id: 'meal_4', debug_url: '', image_urls: '["/photos/a.jpg"]' });
  assert.equal(r.provenance, 'photo_only');
});

// --- photo_only skeleton shape -------------------------------------------------

check('photo_only skeleton is single-turn and matches the fetcher shape', () => {
  const r = resolveMeal({ id: 'meal_5', name: 'Porridge', image_urls: '["/photos/a.jpg","/photos/b.jpg"]' });
  const s = buildPhotoOnlySkeleton(r);

  assert.equal(s.schemaVersion, SCHEMA_VERSION);
  assert.equal(s.mealId, 'meal_5');
  assert.equal(s.mode, 'photo_only_single_turn');
  assert.equal(s.passes.length, 1, 'photo_only must never fabricate multiple turns');
  assert.equal(s.passes[0].turnId, 'single-turn');
  assert.equal(s.passes[0].imageCount, 2);
  assert.equal(s.passes[0]._needsAudit, true);
  assert.deepEqual(s.passes[0].dishes, [], 'dishes stay empty for the audit agent to fill');
  assert.equal(s.retrievedFrom.provenance, 'photo_only');
  assert.equal(s.retrievedFrom.jobId, null);
});

check('photo_only skeleton carries the caveat barring edit-history findings', () => {
  const r = resolveMeal({ id: 'meal_6', image_urls: '["/photos/a.jpg"]' });
  const s = buildPhotoOnlySkeleton(r);
  const notes = s.notes.join(' ').toLowerCase();
  assert.match(notes, /photo_only provenance/);
  assert.match(notes, /do not file turn_mismatch or edit_not_applied/);
});

// --- the corpus regression this gate exists for --------------------------------

check('REGRESSION: a window of saved meals must resolve with zero dead ends', () => {
  // Mirrors the live D1 shape: 11 rows with a debug_url, 39 without but all with
  // photos. Before the resolver these 39 were unreachable.
  const rows = [];
  for (let i = 0; i < 11; i++) {
    rows.push({
      id: `meal_dbg_${i}`,
      debug_url: `https://pub-x.r2.dev/debug/job_17907000000${i}_aaaaaaaa.json`,
      image_urls: '["/photos/a.jpg"]',
    });
  }
  for (let i = 0; i < 39; i++) {
    rows.push({ id: `meal_photo_${i}`, debug_url: null, image_urls: '["/photos/a.jpg"]' });
  }

  const resolved = rows.map(resolveMeal);
  const deadEnds = resolved.filter((r) => r.provenance === 'unreproducible');

  assert.equal(deadEnds.length, 0, `expected 0 unreproducible, got ${deadEnds.length}`);
  assert.equal(resolved.filter((r) => r.provenance === 'debug_payload').length, 11);
  assert.equal(resolved.filter((r) => r.provenance === 'photo_only').length, 39);
  assert.equal(resolved.filter((r) => r.editHistoryObservable).length, 11,
    'only the 11 debug_payload rows may claim edit-history observability');
});

// --- generator contract: photo_only skeleton is accepted ------------------------
// This is the assertion that matters most: the resolver's skeleton must be
// consumable by the REAL generator. A shape-compatible-looking object that the
// generator rejects would leave Phase 1 decorative.

const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'meal-resolve-contract-'));

check('the real generate-meal-result.mjs accepts a filled photo_only skeleton', () => {
  const res = resolveMeal({
    id: 'meal_contract',
    name: 'Steak Sandwich',
    image_urls: '["/photos/contract.jpg"]',
  });
  const s = buildPhotoOnlySkeleton(res);
  // Fill exactly what the generator requires: bbox (photos present) + all 32 nutrients.
  const nutrients = Object.fromEntries(NUTRIENT_KEYS.map((k) => [k, 0]));
  Object.assign(nutrients, {
    calories: 520, protein: 32, carbohydrates: 38, totalFat: 24, saturatedFat: 9,
    unsaturatedFat: 13, sugar: 4, addedSugar: 2, totalFibre: 5, solubleFibre: 2,
    sodium: 640, potassium: 820, magnesium: 60, calcium: 90, iron: 4, zinc: 3,
    selenium: 20, iodine: 15, phosphorus: 300, vitaminD: 1, vitaminC: 12,
    vitaminA: 30, niacin: 4, riboflavin: 0.4, thiamine: 0.3, vitaminB6: 0.4,
    folate: 40, vitaminE: 3, vitaminK: 15, vitaminB12: 2, omega3: 1.2, transFat: 0,
  });
  s.passes[0].dishes = [{
    dishName: 'Steak Sandwich',
    canonicalDbName: 'Beef sandwich',
    weightGrams: 300,
    boundingBox2D: [100, 100, 700, 700],
    nutrients,
  }];

  const inputPath = path.join(outDir, 'skeleton.json');
  fs.writeFileSync(inputPath, JSON.stringify(s, null, 2), 'utf-8');

  const bundleDir = path.join(outDir, 'Meal-contract-01');
  const r = spawnSync('node', [
    path.join(REPO_ROOT, 'scripts', 'generate-meal-result.mjs'),
    `--input=${inputPath}`,
    '--bundle-name=Meal-contract-01',
    `--output-dir=${bundleDir}`,
  ], { encoding: 'utf8' });

  assert.equal(r.status, 0, `generator rejected the photo_only skeleton:\n${r.stdout}\n${r.stderr}`);
  for (const f of ['meal_result.json', 'meal_result.md', 'Instruction.md', 'expected.json']) {
    assert.ok(fs.existsSync(path.join(bundleDir, f)), `bundle missing ${f}`);
  }
  const result = JSON.parse(fs.readFileSync(path.join(bundleDir, 'meal_result.json'), 'utf8'));
  assert.ok(result.passes && result.passes.length === 1, 'bundle must carry exactly one pass');
});

check('the generator still REFUSES an unfilled photo_only skeleton (no placeholder ground truth)', () => {
  const res = resolveMeal({ id: 'meal_unfilled', image_urls: '["/photos/a.jpg"]' });
  const s = buildPhotoOnlySkeleton(res);
  const inputPath = path.join(outDir, 'skeleton_unfilled.json');
  fs.writeFileSync(inputPath, JSON.stringify(s, null, 2), 'utf-8');

  const r = spawnSync('node', [
    path.join(REPO_ROOT, 'scripts', 'generate-meal-result.mjs'),
    `--input=${inputPath}`,
    '--bundle-name=Meal-unfilled-01',
    `--output-dir=${path.join(outDir, 'Meal-unfilled-01')}`,
  ], { encoding: 'utf8' });

  assert.notEqual(r.status, 0, 'generator must reject a zero-dish payload');
  assert.match(`${r.stdout}${r.stderr}`, /zero dishes/i);
});

fs.rmSync(outDir, { recursive: true, force: true });

console.log(`\n${pass} pass, ${fail} fail`);
if (fail > 0) {
  console.error('\nFailures:');
  for (const f of failures) console.error(`  - ${f.name}: ${f.message}`);
  process.exit(1);
}
process.exit(0);
