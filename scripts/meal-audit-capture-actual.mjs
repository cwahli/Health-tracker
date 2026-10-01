#!/usr/bin/env node
/**
 * scripts/meal-audit-capture-actual.mjs
 *
 * Capture the LIVE "actual" ledger — what the app itself computed — so
 * meal-audit-compare.mjs can score it without a human assembling the file.
 *
 * ## Why this exists
 *
 * `meal-audit-compare.mjs` needs an actual payload: the app's own per-dish
 * nutrients and weights. Until now nothing produced one. `qa-runner.mjs` has no
 * actual-capture at all, so `meal-audit-replay.mjs` ended every isolated run with
 *
 *   [Replay] Actual evidence not found: .../actual_meal.json
 *            (pass --actual= or capture during journey)
 *
 * and the last mile of compare could only be walked by hand. On 2026-10-01 that
 * meant fetching a saved meal's debug payload off R2 and assembling the payload
 * in an ad-hoc script — real data, but not reproducible, and not something an
 * unattended sweep can do.
 *
 * ## Where the numbers come from
 *
 * The saved meal row carries a `debug_url`; that payload's `result.mealBuild` is
 * what the app computed — `items[]` with per-dish nutrients, weight and bbox, plus
 * the meal totals. This reads that and reshapes it into the `{ dishes: [...] }`
 * form `normalizeActualAudit()` already accepts. Nothing is computed, estimated or
 * invented here: if `mealBuild` is missing the script fails rather than emitting a
 * half-empty payload that would compare as "everything drifted".
 *
 * ## Usage
 *
 *   node scripts/meal-audit-capture-actual.mjs --meal-id=meal_123 [--out=path] [--api-base=http://127.0.0.1:3000]
 *   cat meal_1790784308630 | node scripts/meal-audit-capture-actual.mjs --stdin
 *
 * Prints the path it wrote. Exit 0 = captured, 1 = no actual could be read,
 * 3 = bad usage.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..');

function usage(msg) {
  if (msg) console.error(`[capture] ${msg}`);
  console.log(`meal-audit-capture-actual — read the app's own ledger for a saved meal

  node scripts/meal-audit-capture-actual.mjs --meal-id=meal_123 [--out=actual.json]
  node scripts/meal-audit-capture-actual.mjs --stdin < debug-payload.json

  --api-base   default http://127.0.0.1:3000 (or API_BASE_URL)
  --out        where to write; default qa-evidence/actual_<mealId>.json`);
  process.exit(msg ? 3 : 0);
}

function parseArgs(argv) {
  const o = { mealId: '', out: '', apiBase: process.env.API_BASE_URL || 'http://127.0.0.1:3000', stdin: false };
  for (const a of argv) {
    if (a === '--help' || a === '-h') usage();
    else if (a.startsWith('--meal-id=')) o.mealId = a.slice('--meal-id='.length).trim();
    else if (a.startsWith('--out=')) o.out = a.slice('--out='.length).trim();
    else if (a.startsWith('--api-base=')) o.apiBase = a.slice('--api-base='.length).trim();
    else if (a === '--stdin') o.stdin = true;
    else usage(`unknown argument: ${a}`);
  }
  return o;
}

/** Find the saved meal's public debug payload URL from the live store. */
async function debugUrlForMeal(mealId, apiBase) {
  const base = String(apiBase).replace(/\/+$/, '');
  const url = `${base}/api/audit/food-search?limit=50`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`food-search ${res.status}`);
  const json = await res.json();
  const meal = (json.foods || []).find((f) => f && f.id === mealId);
  if (!meal) throw new Error(`no saved meal ${mealId} in the store`);
  if (!meal.debug_url) throw new Error(`${mealId} has no debug_url — nothing to capture`);
  return { debugUrl: meal.debug_url, name: meal.name };
}

/**
 * Reshape the app's mealBuild into the `{ dishes }` form the comparator reads.
 * Fails loudly rather than emitting a partial payload: a dish with no nutrients
 * compares as 100% drift on every key, which files cards against the audit rather
 * than the product — the exact failure this tool exists to prevent.
 */
export function actualFromMealBuild(payload, meta = {}) {
  const mealBuild = payload?.result?.mealBuild;
  if (!mealBuild || !Array.isArray(mealBuild.items) || mealBuild.items.length === 0) {
    throw new Error('payload has no result.mealBuild.items — the app computed nothing to capture');
  }
  const dishes = mealBuild.items.map((it, i) => {
    const nutrients = it.nutrients && typeof it.nutrients === 'object' ? it.nutrients : null;
    if (!nutrients || Object.keys(nutrients).length === 0) {
      throw new Error(`dish ${i} ("${it.name || it.dishName || '?'}") carries no nutrients — `
        + 'capturing it would score every key as 100% drift against the audit');
    }
    return {
      dishName: it.name || it.dishName || `dish-${i}`,
      canonicalDbName: it.canonicalDbName || undefined,
      estimatedWeightGrams: Number(it.weightGrams) || null,
      boundingBox2D: Array.isArray(it.boundingBox2D) ? it.boundingBox2D : null,
      nutrients,
    };
  });
  return {
    schemaVersion: 'actual/1',
    source: 'app mealBuild — the app computed this, not the audit',
    jobId: payload.jobId || meta.jobId || null,
    title: mealBuild.title || meta.name || null,
    weightGrams: mealBuild.weightGrams ?? null,
    quantity: mealBuild.quantity ?? null,
    dishes,
    mealTotals: mealBuild.nutrients || null,
    capturedAt: new Date().toISOString(),
  };
}

async function readStdin() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw.trim()) throw new Error('--stdin given but nothing arrived');
  return JSON.parse(raw);
}

async function main() {
  const o = parseArgs(process.argv.slice(2));

  let payload;
  let meta = {};
  if (o.stdin) {
    payload = await readStdin();
    meta = { jobId: payload.jobId, name: payload.result?.mealBuild?.title };
  } else {
    if (!o.mealId) usage('--meal-id is required (or use --stdin)');
    const found = await debugUrlForMeal(o.mealId, o.apiBase);
    meta = { name: found.name };
    const res = await fetch(found.debugUrl);
    if (!res.ok) throw new Error(`debug payload ${res.status} from ${found.debugUrl}`);
    payload = await res.json();
  }

  const actual = actualFromMealBuild(payload, meta);
  const out = o.out
    ? path.resolve(o.out)
    : path.join(REPO_ROOT, 'qa-evidence', `actual_${o.mealId || payload.jobId || 'meal'}.json`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(actual, null, 2), 'utf8');

  console.log(`[capture] ${actual.dishes.length} dish(es) from ${actual.jobId || 'payload'} — ${actual.title || 'untitled'}`);
  for (const d of actual.dishes) {
    console.log(`[capture]   ${d.dishName} @ ${d.estimatedWeightGrams}g — ${d.nutrients.calories} kcal`);
  }
  console.log(out);
  process.exit(0);
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) {
  main().catch((e) => {
    console.error(`[capture] ${e?.message || e}`);
    process.exit(1);
  });
}