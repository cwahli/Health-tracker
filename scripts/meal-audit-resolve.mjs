#!/usr/bin/env node
/**
 * scripts/meal-audit-resolve.mjs
 *
 * Phase 1 of the meal QA loop — the MISSING LINK between a saved meal and an
 * auditable bundle.
 *
 * `meal-audit-fetch.mjs` can only rebuild a multi-turn flow from a debug payload,
 * which it reaches via `debug_url` -> `job_<id>`. Measured on the live D1 store,
 * only ~11 of the last 50 saved meals carry a `debug_url`; the other ~39 never had
 * one written (they were not pruned — retention never had anything to clear).
 * So "reproduce any of the latest N saved meals" dead-ends on ~78% of the corpus.
 *
 * Every one of those 39 rows does still carry `image_urls`. This resolver maps a
 * saved meal onto the best evidence that actually exists, in strict preference
 * order, and emits either a real job id (full multi-turn replay) or a photo-only
 * single-turn skeleton (provenance `photo_only`).
 *
 * Provenance tiers (mirrors meal-audit-engine SKILL "Provenance"):
 *   debug_payload   full multi-turn ground truth. edit history IS observable.
 *   photo_only      single turn from saved photos. Dish/weight claims are
 *                    auditable; "the 2nd edit was not applied" is NOT, and this
 *                    resolver refuses to pretend otherwise (see asserts below).
 *   unreproducible  no photo, no job. Fails loud, never silently.
 *
 * This script NEVER writes to food_logs, NEVER mutates retention, and NEVER
 * fabricates a job id. It is a read-only projection.
 *
 * Exit codes:
 *   0  at least one meal resolved (emits JSON on stdout)
 *   2  zero resolvable meals (emits the reason + per-meal diagnostics)
 *   3  usage / config error
 *
 * Usage:
 *   node scripts/meal-audit-resolve.mjs --latest=10
 *   node scripts/meal-audit-resolve.mjs --latest=10 --emit-skeletons --output-dir=artifacts/meal_audits/pending_review
 *   node scripts/meal-audit-resolve.mjs --meal-id=meal_1790708305973
 *   node scripts/meal-audit-resolve.mjs --list --latest=50          # diagnostics only
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..');
const BASE_URL = (process.env.API_BASE_URL || 'http://127.0.0.1:3000').replace(/\/+$/, '');

export const SCHEMA_VERSION = '2.1.0';

export function parseArgs(argv) {
  const o = {
    latest: null,
    mealId: null,
    uid: null,
    list: false,
    emitSkeletons: false,
    outputDir: path.join(REPO_ROOT, 'artifacts', 'meal_audits', 'pending_review'),
    help: false,
  };
  for (const a of argv) {
    if (a === '--help' || a === '-h') o.help = true;
    else if (a === '--list') o.list = true;
    else if (a === '--emit-skeletons') o.emitSkeletons = true;
    else if (a.startsWith('--latest=')) o.latest = parseInt(a.slice('--latest='.length), 10);
    else if (a.startsWith('--meal-id=')) o.mealId = a.slice('--meal-id='.length).trim();
    else if (a.startsWith('--uid=')) o.uid = a.slice('--uid='.length).trim();
    else if (a.startsWith('--output-dir=')) o.outputDir = a.slice('--output-dir='.length).trim();
    else {
      console.error(`Unknown argument: ${a}`);
      process.exit(3);
    }
  }
  return o;
}

function usage() {
  console.log(`
Meal Audit Resolver — map saved meals onto reproducible evidence.

Usage:
  node scripts/meal-audit-resolve.mjs --latest=10
  node scripts/meal-audit-resolve.mjs --latest=10 --emit-skeletons --output-dir=<dir>
  node scripts/meal-audit-resolve.mjs --meal-id=meal_1790708305973
  node scripts/meal-audit-resolve.mjs --latest=50 --list

Notes:
  - Read-only. Never writes food_logs, never mutates retention, never invents a job id.
  - Preference order: debug_url -> job_<id>  (multi-turn)
                      image_urls only        (single-turn, provenance photo_only)
                      neither                (unreproducible — fails loud)
  - Exits 2 when nothing resolves, so a cron caller can alert instead of idling green.
`);
}

/**
 * The debug URL shape is https://<bucket>.r2.dev/debug/<job_id>.json, optionally
 * with an extra path segment: debug/<prefix>/<job_id>.json.
 */
export function extractJobId(debugUrl) {
  const m = String(debugUrl || '').match(/debug\/(?:[^\/]+\/)?(job_[0-9a-zA-Z_\-]+)\.json/i);
  return m ? m[1] : null;
}

export function safeImageList(row) {
  let imgs = [];
  try {
    imgs = Array.isArray(row.image_urls) ? row.image_urls : JSON.parse(row.image_urls || '[]');
  } catch {
    imgs = [];
  }
  return Array.isArray(imgs) ? imgs.filter((u) => typeof u === 'string' && u.trim()) : [];
}

/**
 * Resolve one saved meal row onto the best evidence tier available.
 * Pure function — takes a plain row, returns a plain record. No I/O.
 */
export function resolveMeal(row) {
  const photos = safeImageList(row);
  const jobId = extractJobId(row.debug_url);
  const mealId = String(row.id || '');

  if (jobId) {
    return {
      mealId,
      name: row.name || 'Unnamed meal',
      date: row.date || null,
      updatedAt: row.updated_at || null,
      provenance: 'debug_payload',
      jobId,
      debugUrl: row.debug_url,
      photoCount: photos.length,
      photos,
      replayable: true,
      // Full turn history is observable; edit-applied defects are in scope.
      editHistoryObservable: true,
      reason: 'debug_url resolves to a job payload',
    };
  }

  if (photos.length > 0) {
    return {
      mealId,
      name: row.name || 'Unnamed meal',
      date: row.date || null,
      updatedAt: row.updated_at || null,
      // No job link and no debug payload: single-turn ground truth only.
      provenance: 'photo_only',
      jobId: null,
      debugUrl: null,
      photoCount: photos.length,
      photos,
      replayable: false,
      // Stated explicitly so the audit agent cannot claim edit-history coverage
      // it structurally cannot have (see meal-audit-engine SKILL Provenance).
      editHistoryObservable: false,
      reason: photos.length === 1
        ? 'no debug payload; single saved photo -> single-turn audit'
        : `no debug payload; ${photos.length} saved photos -> single-turn audit (images ordered as stored)`,
    };
  }

  return {
    mealId,
    name: row.name || 'Unnamed meal',
    date: row.date || null,
    updatedAt: row.updated_at || null,
    provenance: 'unreproducible',
    jobId: null,
    debugUrl: null,
    photoCount: 0,
    photos: [],
    replayable: false,
    editHistoryObservable: false,
    reason: 'no debug payload and no saved photo — cannot reconstruct evidence',
  };
}

async function fetchJson(url) {
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  const text = await res.text();
  let body;
  try { body = text ? JSON.parse(text) : null; } catch { body = { raw: text }; }
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}: ${text.slice(0, 200)}`);
  return body;
}

async function fetchSavedMeals({ limit = 10, mealId = null, uid = null } = {}) {
  const params = new URLSearchParams();
  params.set('limit', String(Math.min(Math.max(Number(limit) || 10, 1), 50)));
  if (mealId) params.set('q', String(mealId));
  if (uid) params.set('uid', String(uid));
  const body = await fetchJson(`${BASE_URL}/api/audit/food-search?${params.toString()}`);
  const foods = Array.isArray(body && body.foods) ? body.foods : [];
  if (mealId) {
    // The route does token-AND on `name`, so a meal id may not match by name.
    // Fall back to an unfiltered page and select by id client-side.
    if (!foods.some((f) => String(f.id) === String(mealId))) {
      const wide = new URLSearchParams();
      wide.set('limit', '50');
      if (uid) wide.set('uid', String(uid));
      const all = await fetchJson(`${BASE_URL}/api/audit/food-search?${wide.toString()}`);
      const hit = (Array.isArray(all && all.foods) ? all.foods : []).find((f) => String(f.id) === String(mealId));
      if (!hit) throw new Error(`meal-id not found in Food History: ${mealId}`);
      return [hit];
    }
    return foods.filter((f) => String(f.id) === String(mealId));
  }
  return foods;
}

/**
 * Build a single-turn flow_skeleton.json from a photo_only resolution.
 * Shape-compatible with meal-audit-fetch.mjs output so generate-meal-result.mjs
 * and meal-audit-compare.mjs consume both tiers unchanged.
 */
export function buildPhotoOnlySkeleton(res) {
  return {
    schemaVersion: SCHEMA_VERSION,
    mealId: res.mealId,
    bundleName: null, // caller assigns the canonical Meal-[slug]-NN name
    timestamp: res.updatedAt || new Date().toISOString(),
    title: res.name,
    mode: 'photo_only_single_turn',
    retrievedFrom: {
      jobId: null,
      apiBase: BASE_URL,
      debugUrl: null,
      fetchedAt: new Date().toISOString(),
      photoCount: res.photoCount,
      sourcePhotos: res.photos,
      provenance: 'photo_only',
    },
    passes: [
      {
        turnIndex: 1,
        turnId: 'single-turn',
        userPrompt: 'Analyze this saved meal photo.',
        addedPhotos: res.photos,
        imageCount: res.photoCount,
        dishes: [],
        _needsAudit: true,
      },
    ],
    notes: [
      'PHOTO_ONLY PROVENANCE: this meal has no debug payload, so its saved photos are',
      'the only surviving evidence. Dishes, weights, and the 32-nutrient ledger are',
      'auditable from these images. The multi-turn edit history is NOT recoverable —',
      'do not file turn_mismatch or edit_not_applied findings against this bundle.',
    ],
  };
}

function slugify(s) {
  return String(s || 'meal')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'meal';
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  if (o.help) { usage(); process.exit(0); }
  if (o.latest == null && !o.mealId) { usage(); process.exit(3); }
  if (!Number.isFinite(o.latest) && !o.mealId) {
    console.error(`[Resolve] --latest must be a number (got "${o.latest}").`);
    process.exit(3);
  }

  let rows;
  try {
    rows = await fetchSavedMeals({ limit: o.latest || 10, mealId: o.mealId, uid: o.uid });
  } catch (err) {
    console.error(`[Resolve] Cannot reach ${BASE_URL}/api/audit/food-search: ${err.message}`);
    console.error('[Resolve] Is the server running? (API_BASE_URL=' + BASE_URL + ')');
    process.exit(2);
  }

  const resolved = rows.map(resolveMeal);
  const counts = resolved.reduce((acc, r) => {
    acc[r.provenance] = (acc[r.provenance] || 0) + 1;
    return acc;
  }, {});

  // --list is diagnostics only: no skeletons written, always exit 0 when the
  // store answered, so it is safe to run against a large window.
  if (o.list) {
    console.log(JSON.stringify({ mode: 'list', requested: o.latest, counts, meals: resolved }, null, 2));
    process.exit(0);
  }

  const emitted = [];
  if (o.emitSkeletons) {
    for (const res of resolved) {
      if (res.provenance === 'unreproducible') {
        console.error(`[Resolve] SKIP ${res.mealId}: ${res.reason}`);
        continue;
      }
      if (res.provenance === 'debug_payload') {
        // Hand off to the existing fetcher — it owns debug-payload retrieval,
        // photo download, and multi-turn reconstruction. Do not duplicate it.
        const dir = path.join(o.outputDir, `${slugify(res.name)}-${res.mealId}`);
        emitted.push({
          mealId: res.mealId,
          provenance: res.provenance,
          skeleton: null,
          next: `node scripts/meal-audit-fetch.mjs --job-id="${res.jobId}" --output-dir="${dir}"`,
        });
        continue;
      }
      const dir = path.join(o.outputDir, `${slugify(res.name)}-${res.mealId}`);
      fs.mkdirSync(dir, { recursive: true });
      const skel = buildPhotoOnlySkeleton(res);
      const skelPath = path.join(dir, 'flow_skeleton.json');
      fs.writeFileSync(skelPath, JSON.stringify(skel, null, 2), 'utf-8');
      emitted.push({
        mealId: res.mealId,
        provenance: res.provenance,
        skeleton: skelPath,
        next: `node scripts/generate-meal-result.mjs --input="${skelPath}" --bundle-name="${path.basename(dir)}" --output-dir="${dir}"`,
      });
    }
  }

  const result = {
    generatedAt: new Date().toISOString(),
    apiBase: BASE_URL,
    requested: o.latest || 1,
    counts,
    resolvable: resolved.filter((r) => r.provenance !== 'unreproducible').length,
    unreproducible: resolved.filter((r) => r.provenance === 'unreproducible').map((r) => r.mealId),
    emitted,
    meals: resolved,
  };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);

  if (result.resolvable === 0) {
    console.error('[Resolve] Zero resolvable meals — nothing auditable in this window.');
    process.exit(2);
  }
  process.exit(0);
}

// Only run as a CLI; exported pure functions are unit-tested directly.
const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) {
  main().catch((e) => { console.error('[Resolve] fatal:', e?.message || e); process.exit(3); });
}
