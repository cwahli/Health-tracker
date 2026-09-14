#!/usr/bin/env node
/**
 * Live origin probe. Not skippable. Render spin-up is waited, then FAIL if
 * the interstitial never becomes the app or GET /api/scorecard/contract
 * inventories differ from structure.json.
 *
 *   node scripts/assert-scorecard-live.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const structure = JSON.parse(
  fs.readFileSync(path.join(root, 'golden/scorecard/instruction/inventories/structure.json'), 'utf8'),
);
const live = structure.live;
const outDir = path.join(root, 'golden/scorecard/current/live');
fs.mkdirSync(outDir, { recursive: true });

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isSpinup(text) {
  const t = String(text || '');
  return (live.spinup_needles || []).some((n) => t.includes(n));
}

async function get(url, timeoutMs) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: ac.signal, redirect: 'follow' });
    const text = await r.text();
    return { status: r.status, text, type: r.headers.get('content-type') || '' };
  } finally {
    clearTimeout(timer);
  }
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function eq(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

const origin = live.origin.replace(/\/$/, '');
const probes = [];
let failed = 0;

function fail(id, msg) {
  failed += 1;
  probes.push({ id, result: 'FAIL', message: msg });
  console.error(`FAIL ${id}: ${msg}`);
}
function pass(id, msg) {
  probes.push({ id, result: 'PASS', message: msg || '' });
  console.log(`PASS ${id}${msg ? `: ${msg}` : ''}`);
}

let contract = null;

for (const route of live.routes) {
  const url = origin + route.path;
  let last = null;
  for (let i = 0; i < live.retries; i += 1) {
    try {
      last = await get(url, live.timeout_ms);
    } catch (e) {
      last = { status: 0, text: String(e && e.message ? e.message : e), type: '' };
    }
    if (last.status && last.status < 500 && !isSpinup(last.text)) break;
    if (i < live.retries - 1) await sleep(live.retry_delay_ms);
  }

  const rec = { path: route.path, status: last?.status || 0, spinup: isSpinup(last?.text) };
  fs.writeFileSync(
    path.join(outDir, `${route.id}.txt`),
    String(last?.text || '').slice(0, 8000),
  );

  if (!last || !last.status) {
    fail(route.id, `no response from ${url}: ${last?.text || 'empty'}`);
    continue;
  }
  if (isSpinup(last.text)) {
    fail(route.id, `still Render spin-up interstitial after retries (${url})`);
    continue;
  }
  if (last.status >= 400) {
    fail(route.id, `HTTP ${last.status} ${url}`);
    continue;
  }

  if (route.kind === 'html') {
    const missing = (route.must_contain || []).filter((n) => !last.text.includes(n));
    if (missing.length) fail(route.id, `HTML missing ${missing.join(', ')}`);
    else pass(route.id, `HTTP ${last.status}`);
  } else if (route.kind === 'json') {
    const body = parseJson(last.text);
    if (!body) {
      fail(route.id, 'response is not JSON');
      continue;
    }
    const mismatches = Object.entries(route.must || {}).filter(([k, v]) => body[k] !== v);
    if (mismatches.length) fail(route.id, mismatches.map(([k, v]) => `${k}≠${v}`).join(', '));
    else pass(route.id, `HTTP ${last.status}`);
  } else if (route.kind === 'contract') {
    contract = parseJson(last.text);
    if (!contract || contract.pack !== 'scorecard' || !contract.inventories) {
      fail(route.id, 'live contract missing pack/inventories (old deploy or 404 HTML)');
      continue;
    }
    fs.writeFileSync(path.join(outDir, 'contract.json'), JSON.stringify(contract, null, 2));
    const exp = structure.expected;
    const inv = contract.inventories;
    const checks = [
      ['top_targets.helper', inv.top_targets?.helper, exp.top_targets.helper],
      ['top_targets.fallback', inv.top_targets?.fallback, exp.top_targets.fallback],
      ['top_targets.exclude', inv.top_targets?.exclude, exp.top_targets.exclude],
      ['top_targets.limit_keys', inv.top_targets?.limit_keys, exp.top_targets.limit_keys],
      ['meal_ledger.kcal_writer', inv.meal_ledger?.kcal_writer, exp.meal_ledger.kcal_writer],
      ['biomarkers.multiply', inv.biomarkers?.multiply, exp.biomarkers.multiply],
      ['biomarkers.locked_apply', inv.biomarkers?.locked_apply, exp.biomarkers.locked_apply],
    ];
    const bad = [];
    for (const [name, actual, expect] of checks) {
      if (!eq(actual, expect)) bad.push(`${name} swapped/missing`);
    }
    const nKeys = inv.meal_ledger?.nutrient_keys;
    if (!Array.isArray(nKeys) || nKeys.length !== exp.meal_ledger.nutrient_key_count) {
      bad.push(`nutrient_keys length ${Array.isArray(nKeys) ? nKeys.length : 'missing'}≠${exp.meal_ledger.nutrient_key_count}`);
    }
    if (bad.length) fail(route.id, bad.join('; '));
    else pass(route.id, `commit ${contract.commit} (${contract.commitSource})`);
  }
  rec.result = probes[probes.length - 1]?.result;
}

fs.writeFileSync(
  path.join(outDir, 'probes.json'),
  JSON.stringify({ origin, exportedAt: new Date().toISOString(), failed, probes, contractCommit: contract?.commit || null }, null, 2),
);

if (failed) {
  console.error(`\nLIVE FAIL ${failed} probe(s). Local green is not live green.`);
  process.exit(1);
}
console.log('\nPASS live origin');
process.exit(0);
