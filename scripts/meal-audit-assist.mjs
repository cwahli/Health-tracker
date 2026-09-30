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
  const o = { spec: null, bundle: null, outputDir: null, listCatalog: false, help: false, provenance: null, apiBase: null, allowUnsourced: false };
  for (const a of argv) {
    if (a === '--help' || a === '-h') o.help = true;
    else if (a === '--list-catalog') o.listCatalog = true;
    else if (a.startsWith('--spec=')) o.spec = a.slice('--spec='.length).trim();
    else if (a.startsWith('--bundle=')) o.bundle = a.slice('--bundle='.length).trim();
    else if (a.startsWith('--output-dir=')) o.outputDir = a.slice('--output-dir='.length).trim();
    else if (a.startsWith('--provenance=')) o.provenance = a.slice('--provenance='.length).trim();
    else if (a === '--allow-unsourced') o.allowUnsourced = true;
    else if (a.startsWith('--api-base=')) o.apiBase = a.slice('--api-base='.length).trim();
    else { console.error(`Unknown argument: ${a}`); process.exit(3); }
  }
  return o;
}

/**
 * Look up per-100g nutrients from the product's own catalog via the audit route.
 * This is the path that makes a REAL meal auditable: STANDARD_BASE_FOODS only
 * holds 6 dressing entries, while food_items holds oats, grapes, steak, milk.
 *
 * A catalogKey of `api:<query>` resolves through here. An unknown query is an
 * error, never a zero-filled guess.
 */
async function lookupViaApi(query, apiBase) {
  const base = (apiBase || process.env.API_BASE_URL || 'http://127.0.0.1:3000').replace(/\/+$/, '');
  const url = `${base}/api/audit/food-nutrients?q=${encodeURIComponent(query)}&limit=1`;
  let body;
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    body = await res.json();
  } catch (e) {
    throw new Error(`cannot reach ${url}: ${e.message}`);
  }
  const item = Array.isArray(body?.items) ? body.items[0] : null;
  if (!item || !item.nutrientsPer100g || Object.keys(item.nutrientsPer100g).length === 0) {
    throw new Error(`catalog lookup found no active food for '${query}' (${url})`);
  }
  return { nutrients: item.nutrientsPer100g, fdcId: item.fdcId || null, displayName: item.displayName || query, standardServingG: item.standardServingG ?? null };
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
export function scaleDish({ catalogKey, weightGrams }, { apiBase = null } = {}) {
  const g = Number(weightGrams);
  if (!Number.isFinite(g) || g <= 0) throw new Error('weightGrams must be a positive number');

  // `api:<query>` resolves against the product's own catalog (food_items).
  // Everything else must be a key we can serve from STANDARD_BASE_FOODS.
  if (String(catalogKey).startsWith('api:')) {
    const found = lookupSyncCache(String(catalogKey).slice(4).trim(), apiBase);
    return scaleFromPer100(found.nutrients, g, found.fdcId);
  }

  const entry = STANDARD_BASE_FOODS[catalogKey];
  if (!entry) {
    throw new Error(
      `unknown catalog key '${catalogKey}' — run --list-catalog, or use "api:<query>" ` +
      'to look it up in the product catalog (e.g. api:oats)'
    );
  }
  return scaleFromPer100(entry.nutrients, g, entry.fdcId || null);
}

function scaleFromPer100(per100Map, weightGrams, fdcId) {
  const factor = weightGrams / 100;
  const nutrients = {};
  // Nutrients the catalog does not carry stay null, NOT 0. The generator
  // requires a finite non-negative number, so null is resolved to 0 for the
  // bundle — but the set of unresolved keys is reported so the caller knows the
  // audit is incomplete. A missing micronutrient must never be scored as a real
  // 0, or every comparison reports it as 100% drift against a real value.
  const unresolved = [];
  for (const k of NUTRIENT_KEYS) {
    const per100 = per100Map[k];
    if (typeof per100 === 'number' && Number.isFinite(per100)) {
      nutrients[k] = per100 * factor;
    } else {
      nutrients[k] = 0;
      unresolved.push(k);
    }
  }
  // Calories from the macros actually present, so the Atwater gate passes on real
  // numbers instead of a declared total that contradicts its own macros.
  nutrients.calories = 4 * nutrients.protein + 4 * nutrients.carbohydrates + 9 * nutrients.totalFat;
  return { nutrients, fdcId: fdcId || null, unresolved };
}

/**
 * Resolve a nutrient the catalog did not carry, from an explicit declared value
 * plus a citable source. This is the difference between an unsourced number and
 * a sourced one: the catalog stores macros and a few minerals, so a real meal
 * cannot be audited from it alone — but a micronutrient with a named reference
 * (a USDA FDC id, a product label) is a real datum, not a guess.
 *
 * A declared value with NO source is rejected, because that is precisely the
 * fabrication this whole tool exists to refuse. `--allow-unsourced` remains the
 * deliberate, named escape hatch and does not go through here.
 */
export function resolveDeclared(key, declared, factor) {
  if (!declared || typeof declared !== 'object') return null;
  const entry = declared[key];
  if (entry === null || entry === undefined) return null;
  const value = typeof entry === 'number' ? entry : (entry.value ?? entry.per100g ?? entry.amount);
  const source = typeof entry === 'object' ? (entry.source || entry.ref || entry.fdcId || null) : null;
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  if (!source) {
    throw new Error(
      `declared '${key}' has no source. A nutrient value without a citable ` +
      'reference is a guess; add "source" (e.g. a USDA FDC id) or omit it so the ' +
      'tool reports the audit as incomplete.'
    );
  }
  // per100g and amount are both accepted: a per-100 g reference is the same
  // shape the catalog uses, and a whole-portion amount is already final.
  const scaled = (entry.per100g !== undefined || entry.value === undefined && typeof entry === 'object' && entry.amount === undefined)
    ? value * factor
    : (typeof entry === 'number' ? value * factor : value);
  return { value: scaled, source: String(source) };
}

// The API lookup is async, but scaleDish is used synchronously inside buildDish.
// Populate this cache once via primeCatalog() before scaling api: keys.
const API_CACHE = new Map();
function lookupSyncCache(query, apiBase) {
  const hit = API_CACHE.get(query);
  if (!hit) {
    throw new Error(
      `catalog key 'api:${query}' was not primed. Run primeCatalog([...]) first ` +
      '(the CLI does this automatically from a spec\'s "lookups" array).'
    );
  }
  return hit;
}

/** Fetch and cache every `api:<query>` a spec needs, in one pass. */
export async function primeCatalog(queries, apiBase) {
  for (const q of queries) {
    if (API_CACHE.has(q)) continue;
    API_CACHE.set(q, await lookupViaApi(q, apiBase));
  }
  return API_CACHE;
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
  const unresolved = new Set();
  const missingIn = new Set();
  const declaredSources = {};

  for (const c of components) {
    const g = Number(c.weightGrams);
    if (!Number.isFinite(g) || g <= 0) throw new Error(`${name}: component weightGrams must be > 0`);
    const scaled = scaleDish(c);
    out.ingredients.push({ name: c.catalogKey, grams: g, fdcId: scaled.fdcId });
    for (const k of NUTRIENT_KEYS) total.nutrients[k] = (total.nutrients[k] || 0) + scaled.nutrients[k];
    // Track which components lacked a key, but only a key that NO component
    // supplied is genuinely unsourced. Flagging per-component made oats' missing
    // vitaminC hide the plum that had it, so a real audit was reported incomplete.
    for (const k of (scaled.unresolved || [])) missingIn.add(k);
  }
  for (const k of NUTRIENT_KEYS) {
    if (missingIn.has(k) && !(total.nutrients[k] > 0)) unresolved.add(k);
  }

  // Second pass: fill what the catalog could not, from a citable declared value.
  // Done after the components so a dish-level declaration is compared against the
  // summed total and only the genuine remainder is overridden.
  const declared = dish.declaredNutrients;
  for (const k of [...unresolved]) {
    const fix = resolveDeclared(k, declared, 1);
    if (fix) {
      // The dish total already holds the component sum; the declared value is the
      // authoritative figure for the whole dish, so it REPLACES rather than adds.
      total.nutrients[k] = fix.value;
      declaredSources[k] = fix.source;
      unresolved.delete(k);
    }
  }
  // Recorded on the dish so a reader can see which nutrients are unsourced and
  // which came from a named reference rather than the catalog.
  out.unsourcedNutrients = [...unresolved].sort();
  out.declaredSources = declaredSources;

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

async function main() {
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

  // Prime any `api:<query>` catalog keys from the product catalog first.
  const apiQueries = new Set();
  for (const d of spec.dishes || []) {
    for (const c of (Array.isArray(d.components) && d.components.length ? d.components : [d])) {
      if (c && typeof c.catalogKey === 'string' && c.catalogKey.startsWith('api:')) {
        apiQueries.add(c.catalogKey.slice(4).trim());
      }
    }
  }
  if (apiQueries.size > 0) {
    try {
      await primeCatalog([...apiQueries], o.apiBase);
      console.error(`[Assist] catalog lookups: ${[...apiQueries].join(', ')}`);
    } catch (e) {
      console.error(`[Assist] catalog lookup failed: ${e.message}`);
      process.exit(3);
    }
  }

  const dishes = (spec.dishes || []).map(buildDish);
  if (dishes.length === 0) { console.error('spec declares no dishes'); process.exit(3); }

  // generate-meal-result.mjs requires a bbox on every dish when photos exist.
  const missing = dishes.filter((d) => !d.boundingBox2D);
  if (missing.length > 0) {
    console.error(`[Assist] ${missing.length} dish(es) lack boundingBox2D; the generator requires it when photos exist:`);
    for (const d of missing) console.error(`  - ${d.dishName}`);
    process.exit(3);
  }

  const kcal = dishes.reduce((s, d) => s + d.nutrients.calories, 0);
  console.error(`[Assist] ${dishes.length} dish(es), ${Math.round(kcal)} kcal total`);
  for (const d of dishes) console.error(`  - ${d.dishName}: ${d.weightGrams}g, ${Math.round(d.nutrients.calories)} kcal`);

  // A nutrient the catalog does not carry becomes 0 in the bundle, and the
  // comparator scores 0-vs-real as 100% drift. That is a defect in the AUDIT,
  // not in the product, so refuse to emit a bundle that will manufacture
  // findings unless the caller explicitly accepts the gap.
  //
  // This check runs BEFORE the payload is written, so a refused audit leaves no
  // file behind for a later stage to pick up by accident.
  const unsourced = [...new Set(dishes.flatMap((d) => d.unsourcedNutrients || []))].sort();
  if (unsourced.length > 0 && !o.allowUnsourced) {
    console.error(`\n[Assist] INCOMPLETE AUDIT: ${unsourced.length} nutrient(s) have no catalog source:`);
    console.error(`  ${unsourced.join(', ')}`);
    console.error('[Assist] These would be stored as 0, which the comparator scores as 100% drift');
    console.error('[Assist] against any real value. That would file bug cards against the audit,');
    console.error('[Assist] not the product. Nothing was written. Re-run with --allow-unsourced');
    console.error('[Assist] to emit anyway and accept that those nutrients are unverified.');
    process.exit(4);
  }
  if (unsourced.length > 0) {
    console.error(`[Assist] WARNING: emitting with ${unsourced.length} unsourced nutrient(s) (--allow-unsourced).`);
  }

  const outDir = o.outputDir || path.join(REPO_ROOT, 'artifacts', 'meal_audits', o.bundle);
  fs.mkdirSync(outDir, { recursive: true });
  const payloadPath = path.join(outDir, 'audit_payload.json');
  const payload = {
    schemaVersion: 2.1,
    title: spec.title || o.bundle,
    provenance: o.provenance || spec.provenance || 'catalog_scaled',
    note: 'Nutrients are catalog per-100g values scaled to the declared weight, plus any declaredNutrients that carry a citable source. Calories are derived from macros (Atwater).',
    unsourcedNutrients: unsourced,
    passes: [{ turnIndex: 1, turnId: 'single-turn', userPrompt: 'Analyze this meal photo.', dishes, imageCount: 0, addedPhotos: [] }],
  };
  fs.writeFileSync(payloadPath, JSON.stringify(payload, null, 2), 'utf-8');

  console.error(`[Assist] payload: ${payloadPath}`);
  process.stdout.write(payloadPath + '\n');
  process.exit(0);
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) main().catch((e) => { console.error('[Assist] fatal:', e?.message || e); process.exit(3); });
