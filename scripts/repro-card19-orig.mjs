#!/usr/bin/env node
/**
 * scripts/repro-card19-orig.mjs — Card-19 repro on the ORIGINAL failing meal.
 *
 * Input: the real debug bundle of job_1790784359089_kvt6r0c0g
 * ("I had 70g of Sainsbury oat + fruit" + entry photo), committed beside the
 * defect record at specs/card19-orig/.
 *
 * Modes:
 *   --before            assert the box-survival invariant against the STORED
 *                       (pre-fix) bundle's pendingFoodLog -> must FAIL (exit 1).
 *                       This is the original failure, replayed from real bytes.
 *   (default)           feed the bundle's REAL rawScout.dishes through the
 *                       CURRENT clusterSpatialCompositeDishes and assert the
 *                       invariant -> must PASS (exit 0) once fixed.
 *   --sg=<path>         use another scoutGeometry implementation (e.g. the
 *                       pre-fix file materialized from git) for the live run.
 *   --debug-json=<path> override the bundle path.
 *
 * Exit: 0 = invariant holds, 1 = defect reproduced (invariant violated),
 *       3 = usage/config.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');
const EVID = process.env.CARD19_EVID || path.join(REPO, 'specs', 'card19-orig');

const arg = (n, fb = '') => {
  const h = process.argv.find((a) => a.startsWith(`--${n}=`));
  return h ? h.split('=').slice(1).join('=') : fb;
};
const flag = (n) => process.argv.includes(`--${n}`);

const OATS = [250, 100, 955, 990];
const GRAPES = [390, 110, 875, 880];
const eqBox = (a, b) =>
  Array.isArray(a) && Array.isArray(b) && a.length === 4 && b.length === 4 &&
  a.every((v, i) => Number(v) === Number(b[i]));

function loadBundle(p) {
  if (!fs.existsSync(p)) {
    console.error(`[repro-card19] debug bundle not found: ${p}\n  pass --debug-json=<path>`);
    process.exit(3);
  }
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function checkStoredBefore(bundle) {
  // The invariant, evaluated on the failing run's own ledger bytes.
  const rows = bundle?.result?.pendingFoodLog?.itemsBreakdown || [];
  const fails = [];
  if (rows.length !== 1) fails.push(`expected the 1-row collapsed ledger, saw ${rows.length}`);
  for (const r of rows) {
    for (const c of r.components || []) {
      if (!Array.isArray(c.boundingBox2D)) {
        fails.push(`component ${JSON.stringify(c.name)} carries no boundingBox2D`);
      }
    }
  }
  console.log('[repro-card19] --before: stored failing run job_1790784359089_kvt6r0c0g');
  console.log(`[repro-card19] scout=${(bundle?.result?.rawScout?.dishes || []).length} ledger=${rows.length}`);
  if (fails.length) {
    for (const f of fails) console.log(`[repro-card19] DEFECT: ${f}`);
    console.log('[repro-card19] verdict=REPRODUCED exit=1');
    return 1;
  }
  console.log('[repro-card19] verdict=NOT_REPRODUCED exit=0');
  return 0;
}

async function checkLive(bundle, sgPath) {
  const mod = await import(pathToFileURL(path.resolve(sgPath)).href);
  const cluster = mod.clusterSpatialCompositeDishes;
  if (typeof cluster !== 'function') {
    console.error(`[repro-card19] no clusterSpatialCompositeDishes in ${sgPath}`);
    process.exit(3);
  }
  const dishes = bundle?.result?.rawScout?.dishes || [];
  if (dishes.length !== 2) {
    console.error(`[repro-card19] expected the original 2 scout dishes, saw ${dishes.length}`);
    process.exit(3);
  }
  // Pipeline shape: visionScoutItems carry originalName/keyword (server_vision_scout.ts).
  const items = dishes.map((d) => ({
    ...d,
    originalName: d.dishName || d.originalName,
    keyword: d.dishName || d.keyword,
    name: d.dishName || d.name,
    weightGrams: d.estimatedWeightGrams,
  }));
  const logs = [];
  const out = cluster(items, (m) => logs.push(String(m)), false);
  const fails = [];
  if (!Array.isArray(out) || out.length !== 1) {
    fails.push(`expected 1 composite, saw ${Array.isArray(out) ? out.length : typeof out}`);
  } else {
    const comps = out[0].compositeSiblings || out[0].components || [];
    const by = new Map(comps.map((c) => [String(c.name), c]));
    if (comps.length !== 2) fails.push(`expected 2 components, saw ${comps.length}`);
    if (!eqBox(by.get('Sainsbury Oat and Fruit')?.boundingBox2D, OATS)) {
      fails.push(`oats comp box=${JSON.stringify(by.get('Sainsbury Oat and Fruit')?.boundingBox2D)} want ${JSON.stringify(OATS)}`);
    }
    if (!eqBox(by.get('Green Grapes')?.boundingBox2D, GRAPES)) {
      fails.push(`grapes comp box=${JSON.stringify(by.get('Green Grapes')?.boundingBox2D)} want ${JSON.stringify(GRAPES)}`);
    }
    if (!eqBox(out[0].boundingBox2D, OATS)) {
      fails.push(`composite box=${JSON.stringify(out[0].boundingBox2D)} want union ${JSON.stringify(OATS)}`);
    }
  }
  console.log(`[repro-card19] live: impl=${path.relative(REPO, path.resolve(sgPath))} dishes=2`);
  if (fails.length) {
    for (const f of fails) console.log(`[repro-card19] DEFECT: ${f}`);
    console.log('[repro-card19] verdict=REPRODUCED exit=1');
    return 1;
  }
  console.log('[repro-card19] oats comp box=[250,100,955,990] grapes comp box=[390,110,875,880] composite=union');
  console.log('[repro-card19] verdict=FIXED exit=0');
  return 0;
}

const bundle = loadBundle(arg('debug-json', path.join(EVID, 'job_1790784359089_kvt6r0c0g.json')));
if (bundle.jobId !== 'job_1790784359089_kvt6r0c0g') {
  console.error(`[repro-card19] refusing: jobId is ${bundle.jobId}, not the original failing meal`);
  process.exit(3);
}
let code = 0;
if (flag('before')) code = checkStoredBefore(bundle);
else code = await checkLive(bundle, arg('sg', path.join(REPO, 'src/server/food/scoutGeometry.ts')));
process.exit(code);
