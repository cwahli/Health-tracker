#!/usr/bin/env node
/**
 * scripts/meal-audit-fetch.mjs
 *
 * Meal Flow & Debug Retrieval Helper for Meal-Audit Bot.
 * Locates meal logs and debug traces by:
 *  - Job ID (--job-id="job_1787301189340_b7oux316g" or "golden_...")
 *  - Exact or partial timestamp (--timestamp="2026-09-22 08:21" or "08:21")
 *  - Meal name query (--name="hotpot" or "salmon")
 *
 * Reconstructs the multi-turn session transcript, downloads/extracts associated photos,
 * and emits `flow_skeleton.json` for the Meal-Audit Bot to review and benchmark.
 *
 * Usage:
 *   node scripts/meal-audit-fetch.mjs --job-id="job_123" [--output-dir="artifacts/fetched_meal"]
 *   node scripts/meal-audit-fetch.mjs --timestamp="Sept 22 08:21"
 *   node scripts/meal-audit-fetch.mjs --name="Chicken Hotpot"
 */

import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';
import { fileURLToPath } from 'node:url';

const BASE_URL = process.env.API_BASE_URL || 'http://127.0.0.1:3000';

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    jobId: null,
    timestamp: null,
    name: null,
    outputDir: null,
  };

  for (const arg of args) {
    if (arg.startsWith('--job-id=')) {
      options.jobId = arg.slice('--job-id='.length).trim();
    } else if (arg.startsWith('--timestamp=')) {
      options.timestamp = arg.slice('--timestamp='.length).trim();
    } else if (arg.startsWith('--name=')) {
      options.name = arg.slice('--name='.length).trim();
    } else if (arg.startsWith('--output-dir=')) {
      options.outputDir = arg.slice('--output-dir='.length).trim();
    }
  }

  return options;
}

async function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const isHttps = url.startsWith('https:');
    const client = isHttps ? https : http;

    client.get(url, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(JSON.parse(data));
          } else {
            resolve({ error: `HTTP ${res.statusCode}`, raw: data });
          }
        } catch (e) {
          resolve({ error: e.message, raw: data });
        }
      });
    }).on('error', reject);
  });
}

async function searchMealLogs(query, timestamp = null) {
  const searchUrl = `${BASE_URL}/api/food/search?q=${encodeURIComponent(query || '')}`;
  try {
    const res = await fetchJson(searchUrl);
    if (res && Array.isArray(res.results)) {
      return res.results;
    }
  } catch (err) {
    console.warn('[Fetch] Local search endpoint failed, checking fallback:', err.message);
  }
  return [];
}

async function fetchJobDebug(jobId) {
  const debugUrl = `${BASE_URL}/api/jobs/debug?jobId=${encodeURIComponent(jobId)}`;
  try {
    const res = await fetchJson(debugUrl);
    if (res && !res.error) {
      return res;
    }
  } catch (err) {
    console.warn(`[Fetch] Failed to fetch debug payload for ${jobId}:`, err.message);
  }
  return null;
}

function parseTurnsFromEvents(events = [], rawResult = null) {
  const turns = [];

  if (!Array.isArray(events) || events.length === 0) {
    // Single turn fallback from rawResult
    return [{
      turnIndex: 1,
      turnId: 'turn_1_initial',
      userPrompt: '',
      addedPhotos: [],
      recordedDishes: rawResult?.dishes || rawResult?.items || [],
      recordedTotals: rawResult?.mealTotals || rawResult?.nutrients || {},
    }];
  }

  let currentTurn = {
    turnIndex: 1,
    turnId: 'turn_1_initial',
    userPrompt: '',
    addedPhotos: [],
    recordedDishes: [],
    recordedTotals: {},
  };

  events.forEach((ev) => {
    if (ev.type === 'user_message' || ev.event === 'user_input' || ev.type === 'edit_request') {
      if (currentTurn.userPrompt || currentTurn.addedPhotos.length > 0) {
        turns.push(currentTurn);
        currentTurn = {
          turnIndex: turns.length + 1,
          turnId: `turn_${turns.length + 1}_edit`,
          userPrompt: ev.text || ev.prompt || '',
          addedPhotos: ev.photos || ev.imageUrls || [],
          recordedDishes: [],
          recordedTotals: {},
        };
      } else {
        currentTurn.userPrompt = ev.text || ev.prompt || '';
        if (Array.isArray(ev.photos)) currentTurn.addedPhotos.push(...ev.photos);
      }
    } else if (ev.type === 'meal_result' || ev.event === 'vision_scout' || ev.type === 'dietitian_complete') {
      if (ev.result?.dishes) currentTurn.recordedDishes = ev.result.dishes;
      if (ev.result?.mealTotals) currentTurn.recordedTotals = ev.result.mealTotals;
    }
  });

  turns.push(currentTurn);
  return turns;
}

async function main() {
  const options = parseArgs();

  if (!options.jobId && !options.timestamp && !options.name) {
    console.log(`
Meal Audit Fetcher — Locates meal records and session event traces.

Usage:
  node scripts/meal-audit-fetch.mjs --job-id="job_..." [--output-dir="artifacts/meal_flow"]
  node scripts/meal-audit-fetch.mjs --timestamp="2026-09-22 08:21"
  node scripts/meal-audit-fetch.mjs --name="Chicken Hotpot"
`);
    process.exit(1);
  }

  console.log('🔍 Locating meal record...');
  let targetJobId = options.jobId;
  let mealTitle = options.name || 'Audited Meal';
  let mealTimestamp = options.timestamp || new Date().toISOString();

  // If no direct jobId, search by name or timestamp
  if (!targetJobId && (options.name || options.timestamp)) {
    const q = options.name || '';
    const results = await searchMealLogs(q, options.timestamp);
    if (results.length > 0) {
      const match = results[0];
      targetJobId = match.food_id || match.id || match.source_meal_id;
      mealTitle = match.dish_name || match.name || mealTitle;
      console.log(`  ✓ Found matching meal: "${mealTitle}" (ID: ${targetJobId})`);
    } else {
      console.log(`  ⚠️ No exact match found via search for query "${q}". Using synthetic identifier.`);
      targetJobId = `job_${Date.now()}`;
    }
  }

  // Fetch debug payload
  console.log(`📥 Fetching session debug trace for: ${targetJobId}...`);
  const debugPayload = await fetchJobDebug(targetJobId);

  const sessionEvents = debugPayload?.sessionEvents || debugPayload?.chatTranscript || [];
  const rawResult = debugPayload?.result || {};
  const photos = debugPayload?.photos || rawResult?.photos || [];

  const reconstructedTurns = parseTurnsFromEvents(sessionEvents, rawResult);

  // Target output directory
  const bundleSlug = mealTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'meal';
  const outDir = options.outputDir || path.join(process.cwd(), 'artifacts', 'meal_audits', `Meal-${bundleSlug}-flow`);
  fs.mkdirSync(outDir, { recursive: true });

  const skeleton = {
    schemaVersion: '2.0.0',
    mealId: targetJobId,
    bundleName: `Meal-${bundleSlug}-01`,
    timestamp: mealTimestamp,
    title: mealTitle,
    mode: reconstructedTurns.length > 1 ? 'multi_turn_flow' : 'single_audit',
    retrievedFrom: {
      jobId: targetJobId,
      debugUrl: debugPayload?.debugUrl || null,
      sourcePhotos: photos,
    },
    passes: reconstructedTurns.map((t, idx) => ({
      turnIndex: t.turnIndex || idx + 1,
      turnId: t.turnId || `turn_${idx + 1}`,
      userPrompt: t.userPrompt || '',
      addedPhotos: t.addedPhotos || [],
      dishes: t.recordedDishes.length > 0 ? t.recordedDishes : [
        {
          dishIndex: 1,
          dishName: mealTitle,
          genericEnglishName: mealTitle,
          boundingBox2D: [100, 100, 900, 900],
          estimatedWeightGrams: 300,
          cookingMethod: 'standard',
          foods: [],
          dishNutrients: {},
        }
      ],
    })),
  };

  const skeletonPath = path.join(outDir, 'flow_skeleton.json');
  fs.writeFileSync(skeletonPath, JSON.stringify(skeleton, null, 2), 'utf-8');

  console.log(`\n✅ Meal Flow Successfully Retrieved!`);
  console.log(`📁 Skeleton written to: ${skeletonPath}`);
  console.log(`📊 Reconstructed ${reconstructedTurns.length} turn(s).`);
  console.log(`\nNext step for Meal-Audit Agent:`);
  console.log(`  Review and verify the dishes/nutrients in flow_skeleton.json, then run:`);
  console.log(`  generate-meal-result.mjs --input="${skeletonPath}" --output-dir="${outDir}"\n`);
}

main().catch(err => {
  console.error('[MealAuditFetch] Fatal error:', err);
  process.exit(1);
});
