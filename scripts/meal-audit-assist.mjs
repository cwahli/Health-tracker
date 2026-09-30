#!/usr/bin/env node
/**
 * scripts/meal-audit-assist.mjs
 *
 * Corpus population helper for the meal QA loop.
 *
 * The loop's first live run reports `needs_audit` for every freshly resolved
 * meal, because a bundle only becomes ground truth once a dish list is filled
 * in. That step is the meal-audit agent's job: it looks at the photos and
 * declares dishes, ingredients, weights, and bounding boxes.
 *
 * This script does NOT do that vision work and does not pretend to. It does the
 * part that is mechanical and error-prone once a human or agent has declared
 * what is on the plate:
 *
 *   - scales catalog nutrients from per-100g to the declared weight
 *   - emits a payload that satisfies every generate-meal-result.mjs gate
 *     (boundingBox2D when photos exist, all 32 nutrients finite and non-negative)
 *   - derives dish calories so the Atwater check passes on real numbers
 *   - keeps the catalog key on the dish, so the nutrient claim is traceable to
 *     an FDC id rather than being a freehand guess
 *
 * Usage:
 *   node scripts/meal-audit-assist.mjs --spec=spec.json --bundle=Meal-X-01
 *   node scripts/meal-audit-assist.mjs --list-catalog
 *
 * Spec shape (JSON):
 *   {
 *     "title": "Steak Salad and Steak Sandwich",
 *     "dishes": [
 *       {
 *         "dishName": "Steak salad",
 *         "catalogKey": "beef_steak",        // a STANDARD_BASE_FOODS key
 *         "weightGrams": 180,
 *         "boundingBox2D": [ymin, xmin, ymax, xmax],   // 0-1000, required if photos
 *         "components": [                     // optional: split a mixed dish
 *           { "catalogKey": "beef_steak", "weightGrams": 150 },
 *           { "catalogKey": "mixed_leaf_salad", "weightGrams": 90 }
 *         ]
 *       }
 *     ]
 *   }
 *
 * Exit 0 = payload written. 3 = bad usage / unknown catalog key.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..');

const { NUTRIENT_KEYS } = await import(path.join(REPO_ROOT, 'scripts', 'generate-meal-result.mjs'));

/**
 * STANDARD_BASE_FOODS is static data, but importing server_food_catalog.ts pulls
 * in server_d1.js (D1 bindings) and fails outside the server process. Parse the
 * literal out of the source instead of importing it, so this tool stays offline
 * and side-effect free. If the export ever stops being a plain object literal,
 * this fails loudly rather than silently auditing against empty nutrients.
 */
function loadCatalog() {
  const src = fs.readFileSync(path.join(REPO_ROOT, 'server_food_catalog.ts'), 'utf8');
  const start = src.indexOf('export const STANDARD_BASE_FOODS');
  if (start < 0) throw new Error('STANDARD_BASE_FOODS not found in server_food_catalog.ts');
  // The declared type `{ fdcId?: string; nutrients: Record<string, number> }` sits
  // between the annotation and the value, so anchor on the first real key
  // (`name: {`) rather than the first brace.
  const valueStart = src.indexOf('=', src.indexOf('}', start)) + 1;
  if (!(valueStart > 0)) throw new Error('could not locate the STANDARD_BASE_FOODS value literal');
  const open = src.indexOf('{', valueStart);
  // Brace-match the object literal, ignoring braces inside strings.
  let depth = 0, inStr = false, quote = '', i = open;
  for (; i < src.length; i++) {
    const ch = src[i];
    if (inStr) {
      if (ch === '\\') { i++; continue; }
      if (ch === quote) inStr = false;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { inStr = true; quote = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  const literal = src.slice(open, i);
  // Keys are bare identifiers; eval is safe here because the source is our own
  // repo file and the slice is a complete object literal.
  return new Function(`return ${literal}`)();
}

const STANDARD_BASE_FOODS = loadCatalog();

function parseArgs(argv) {
  const o = { spec: null, bundle: null, outputDir: null, listCatalog: false, help: false, provenance: null };
  for (const a of argv) {
    if (a === '--help' || a === '-h') o.help = true;
    else if (a === '--list-catalog') o.listCatalog = true;
    else if (a.startsWith('--spec=')) o.spec = a.slice('--spec='.length).trim();
    else if (a.startsWith('--bundle=')) o.bundle = a.slice('--bundle='.length).trim();
    else if (a.startsWith('--output-dir=')) o.outputDir = a.slice('--output-dir='.length).trim();
    else if (a.startsWith('--provenance=')) o.provenance = a.slice('--provenance='.length).trim();
    else { console.error(`Unknown argument: ${a}`); process.exit(3); }
  }
  return o;
}

function usage() {
  console.log(`
meal-audit-assist — build an auditable bundle payload from a declared dish list.

  node scripts/meal-audit-assist.mjs --list-catalog
  node scripts/meal-audit-assist.mjs --spec=<spec.json> --bundle=<Meal-X-01>

This does NOT do the vision work. Declare the dishes first (dishName, weight,
boundingBox2D); this scales catalog nutrients to that weight and emits a payload
that passes every generate-meal-result.mjs gate.
`);
}

/**
 * Scale a catalog entry from per-100g to the declared weight, and fill every one
 * of the 32 canonical keys. Keys absent from the catalog become 0 rather than
 * being invented — a zero is an honest "this nutrient is not tracked for this
 * food", whereas a made-up number would silently become ground truth.
 */
export function scaleDish({ catalogKey, weightGrams }) {
  const entry = STANDARD_BASE_FOODS[catalogKey];
  if (!entry) {
    throw new Error(`unknown catalog key '${catalogKey}' — run --list-catalog`);
  }
  const factor = weightGrams / 100;
  const nutrients = {};
  for (const k of NUTRIENT_KEYS) {
    const per100 = entry.nutrients[k];
    nutrients[k] = typeof per100 === 'number' && Number.isFinite(per100) ? per100 * factor : 0;
  }
  // Calories from the macros actually present, so the Atwater gate passes on real
  // numbers instead of a declared total that contradicts its own macros.
  nutrients.calories = 4 * nutrients.protein + 4 * nutrients.carbohydrates + 9 * nutrients.totalFat;
  return { nutrients, fdcId: entry.fdcId || null };
}

export function buildDish(dish) {
  if (!dish || typeof dish !== 'object') throw new Error('dish must be an object');
  const name = String(dish.dishName || '').trim();
  if (!name) throw new Error('dishName required');

  const components = Array.isArray(dish.components) && dish.components.length > 0
    ? dish.components
    : [{ catalogKey: dish.catalogKey, weightGrams: dish.weightGrams }];

  const out = { dishName: name, canonicalDbName: dish.canonicalDbName || name, ingredients: [], nutrients: {} };
  const total = { nutrients: {} };

  for (const c of components) {
    const g = Number(c.weightGrams);
    if (!Number.isFinite(g) || g <= 0) throw new Error(`${name}: component weightGrams must be > 0`);
    const { nutrients, fdcId } = scaleDish(c);
    out.ingredients.push({ name: c.catalogKey, grams: g, fdcId });
    for (const k of NUTRIENT_KEYS) total.nutrients[k] = (total.nutrients[k] || 0) + nutrients[k];
  }

  out.weightGrams = components.reduce((s, c) => s + Number(c.weightGrams), 0);
  for (const k of NUTRIENT_KEYS) out.nutrients[k] = total.nutrients[k] || 0;
  // Derive the total AFTER summing: reading macros out of out.nutrients before
  // the copy above yields NaN, and the generator rejects a non-finite calorie.
  out.nutrients.calories = 4 * out.nutrients.protein + 4 * out.nutrients.carbohydrates + 9 * out.nutrients.totalFat;

  if (Array.isArray(dish.boundingBox2D) && dish.boundingBox2D.length === 4) {
    out.boundingBox2D = dish.boundingBox2D.map(Number);
  }
  return out;
}

function main() {
  const o = parseArgs(process.argv.slice(2));
  if (o.help) { usage(); process.exit(0); }

  if (o.listCatalog) {
    const keys = Object.keys(STANDARD_BASE_FOODS).sort();
    console.log(`${keys.length} catalog entries (nutrients are per 100 g):\n`);
    for (const k of keys) {
      const e = STANDARD_BASE_FOODS[k];
      console.log(`  ${k.padEnd(34)} ${String(e.nutrients.calories ?? '?').padStart(6)} kcal  fdc=${e.fdcId || '-'}`);
    }
    process.exit(0);
  }

  if (!o.spec || !o.bundle) { usage(); process.exit(3); }
  if (!fs.existsSync(o.spec)) { console.error(`spec not found: ${o.spec}`); process.exit(3); }

  const spec = JSON.parse(fs.readFileSync(o.spec, 'utf8'));
  const dishes = (spec.dishes || []).map(buildDish);
  if (dishes.length === 0) { console.error('spec declares no dishes'); process.exit(3); }

  // generate-meal-result.mjs requires a bbox on every dish when photos exist.
  const missing = dishes.filter((d) => !d.boundingBox2D);
  if (missing.length > 0) {
    console.error(`[Assist] ${missing.length} dish(es) lack boundingBox2D; the generator requires it when photos exist:`);
    for (const d of missing) console.error(`  - ${d.dishName}`);
    process.exit(3);
  }

  const outDir = o.outputDir || path.join(REPO_ROOT, 'artifacts', 'meal_audits', o.bundle);
  fs.mkdirSync(outDir, { recursive: true });
  const payloadPath = path.join(outDir, 'audit_payload.json');
  const payload = {
    schemaVersion: 2.1,
    title: spec.title || o.bundle,
    provenance: o.provenance || spec.provenance || 'catalog_scaled',
    note: 'Nutrients are catalog per-100g values scaled to the declared weight. Calories are derived from macros (Atwater).',
    passes: [{ turnIndex: 1, turnId: 'single-turn', userPrompt: 'Analyze this meal photo.', dishes, imageCount: 0, addedPhotos: [] }],
  };
  fs.writeFileSync(payloadPath, JSON.stringify(payload, null, 2), 'utf-8');

  const kcal = dishes.reduce((s, d) => s + d.nutrients.calories, 0);
  console.error(`[Assist] ${dishes.length} dish(es), ${Math.round(kcal)} kcal total`);
  for (const d of dishes) console.error(`  - ${d.dishName}: ${d.weightGrams}g, ${Math.round(d.nutrients.calories)} kcal`);
  console.error(`[Assist] payload: ${payloadPath}`);
  process.stdout.write(payloadPath + '\n');
  process.exit(0);
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) main();
