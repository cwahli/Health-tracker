#!/usr/bin/env node
/**
 * scripts/meal-audit-suite.mjs
 *
 * P6 tooling for the Meal-Audit Bot:
 *  - report   : coverage matrix + cross-meal bias over comparison.json / bundles
 *  - issues   : query artifacts/meal_audits/issue_ledger.jsonl (Telegram /issues)
 *  - calibrate: score audits by generatedBy.model against tolerance outcomes
 *
 * Usage:
 *   node scripts/meal-audit-suite.mjs report [--dir=artifacts/meal_audits] [--out=…]
 *   node scripts/meal-audit-suite.mjs issues [--status=open] [--bundle=Meal-X-01] [--limit=50]
 *   node scripts/meal-audit-suite.mjs calibrate [--dir=artifacts/meal_audits] [--min-n=1]
 *
 * Exit: 0=ok  1=report found failures but suite ran  3=usage/empty
 */

import fs from 'node:fs';
import path from 'node:path';

const TAXONOMIES = [
  'name_mismatch', 'portion_bias', 'core_nutrient_drift', 'micro_nutrient_drift',
  'bbox_drift', 'edit_not_applied', 'turn_mismatch', 'ocr_error',
];

function parseArgs(argv) {
  const opts = { mode: null, dir: 'artifacts/meal_audits', out: null, status: 'open', bundle: null, limit: 50, minN: 1 };
  for (const a of argv) {
    if (a === 'report' || a === 'issues' || a === 'calibrate') opts.mode = a;
    else if (a.startsWith('--dir=')) opts.dir = a.slice(6);
    else if (a.startsWith('--out=')) opts.out = a.slice(6);
    else if (a.startsWith('--status=')) opts.status = a.slice(9);
    else if (a.startsWith('--bundle=')) opts.bundle = a.slice(9);
    else if (a.startsWith('--limit=')) opts.limit = parseInt(a.slice(8), 10);
    else if (a.startsWith('--min-n=')) opts.minN = parseInt(a.slice(8), 10);
    else if (a === '--help' || a === '-h') opts.help = true;
  }
  return opts;
}

function listBundleDirs(root) {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true })
    .filter(d => d.isDirectory() && d.name !== 'holdout' && d.name.startsWith('Meal-'))
    .map(d => path.join(root, d.name))
    .sort();
}

function readJsonSafe(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf-8')); } catch { return null; }
}

function loadComparison(bundleDir) {
  const p = path.join(bundleDir, 'comparison.json');
  return fs.existsSync(p) ? readJsonSafe(p) : null;
}

function loadHarness(bundleDir) {
  const mr = path.join(bundleDir, 'meal_result.json');
  const raw = fs.existsSync(mr) ? readJsonSafe(mr) : null;
  if (!raw) return null;
  return {
    bundle: path.basename(bundleDir),
    generatedBy: raw.generatedBy || null,
    model: (raw.generatedBy && raw.generatedBy.model) || 'unknown',
    promptVersion: (raw.generatedBy && raw.generatedBy.promptVersion) || null,
    dishes: (raw.dishes && raw.dishes.length) ? raw.dishes.length
      : (Array.isArray(raw.passes) ? raw.passes.reduce((n, p) => n + (p.dishes ? p.dishes.length : 0), 0) : 0),
    hasPhotos: Array.isArray(raw.photos) && raw.photos.length > 0,
    passes: Array.isArray(raw.passes) ? raw.passes.length : (raw.dishes ? 1 : 0),
  };
}

function collectFailures(comparison) {
  if (!comparison || !Array.isArray(comparison.failures)) return [];
  return comparison.failures;
}

function pctError(expected, actual) {
  const e = Number(expected);
  const a = Number(actual);
  if (!Number.isFinite(e) || !Number.isFinite(a)) return null;
  if (e === 0) return a === 0 ? 0 : 100;
  return Math.abs(a - e) / Math.abs(e) * 100;
}

function runReport(opts) {
  const bundles = listBundleDirs(opts.dir);
  if (bundles.length === 0) {
    console.error(`No Meal-* bundles under ${opts.dir}`);
    process.exit(3);
  }

  const rows = [];
  const taxonomyCounts = Object.fromEntries(TAXONOMIES.map(t => [t, 0]));
  const keyDeltas = new Map(); // key -> number[] of signed pct (actual vs expected where possible)
  const keyFailCounts = new Map(); // key -> failure count
  let pass = 0, fail = 0, diverged = 0, noComparison = 0;

  for (const dir of bundles) {
    const h = loadHarness(dir);
    const c = loadComparison(dir);
    if (!c) { noComparison += 1; rows.push({ bundle: path.basename(dir), verdict: 'NO_COMPARISON', model: h ? h.model : 'unknown', failures: null }); continue; }
    const v = c.verdict || 'UNKNOWN';
    if (v === 'PASS') pass += 1; else if (v === 'DIVERGED') diverged += 1; else fail += 1;
    const fails = collectFailures(c);
    for (const f of fails) {
      if (f.taxonomy && taxonomyCounts[f.taxonomy] !== undefined) taxonomyCounts[f.taxonomy] += 1;
      if (f.key) {
        keyFailCounts.set(f.key, (keyFailCounts.get(f.key) || 0) + 1);
        if (typeof f.deltaPct === 'number' && Number.isFinite(f.deltaPct)) {
          if (!keyDeltas.has(f.key)) keyDeltas.set(f.key, []);
          // signed: actual - expected encoded via deltaPct sign convention from compare
          keyDeltas.get(f.key).push(f.deltaPct);
        }
      }
    }
    rows.push({
      bundle: path.basename(dir),
      verdict: v,
      model: (c.harness && c.harness.scoutModel) || (h && h.model) || 'unknown',
      failures: fails.length,
      primary: c.primaryCode || null,
    });
  }

  // Coverage matrix: nutrient keys observed across meal_result vs failed keys
  const coveredKeys = new Set(keyFailCounts.keys());
  // Also pull keys present in any meal_result totals
  for (const dir of bundles) {
    const h = loadHarness(dir);
    if (!h) continue;
    // covered nutrients counted from presence in comparison harness tolerances or dishes — best-effort from failures only
  }

  const bias = [];
  for (const [key, arr] of [...keyDeltas.entries()].sort()) {
    const mean = arr.reduce((s, x) => s + x, 0) / arr.length;
    bias.push({ key, n: arr.length, meanDeltaPct: Math.round(mean * 100) / 100, failures: keyFailCounts.get(key) || arr.length });
  }

  const report = {
    generatedAt: new Date().toISOString(),
    dir: opts.dir,
    totals: { bundles: bundles.length, pass, fail, diverged, noComparison },
    verdicts: rows,
    taxonomyCounts,
    coverage: { failedKeys: [...coveredKeys].sort() },
    crossMealBias: bias,
  };

  const outPath = opts.out || path.join(opts.dir, 'suite_report.json');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf-8');

  console.log('=== Meal-Audit Suite Report ===');
  console.log(`Bundles: ${bundles.length}  PASS=${pass} FAIL=${fail} DIVERGED=${diverged} NO_COMPARISON=${noComparison}`);
  console.log('Taxonomy counts:');
  for (const [t, n] of Object.entries(taxonomyCounts)) if (n > 0) console.log(`  ${t}: ${n}`);
  if (bias.length) {
    console.log('Cross-meal bias (mean |Δ%| among failures, positive = actual over expected when signed):');
    for (const b of bias.slice(0, 20)) console.log(`  ${b.key}: mean=${b.meanDeltaPct}% n=${b.n} fails=${b.failures}`);
  }
  console.log(`Wrote ${outPath}`);

  // exit 1 if any FAIL/DIVERGED so CI can gate; suite still "generated"
  if (fail + diverged > 0) process.exit(1);
  process.exit(0);
}

function runIssues(opts) {
  const ledgerPath = path.join(opts.dir, 'issue_ledger.jsonl');
  if (!fs.existsSync(ledgerPath)) {
    console.log('No open issues. (ledger empty at ' + ledgerPath + ')');
    process.exit(0);
  }
  const lines = fs.readFileSync(ledgerPath, 'utf-8').split('\n').filter(Boolean);
  const all = [];
  for (const line of lines) {
    try { all.push(JSON.parse(line)); } catch { /* skip */ }
  }
  let filtered = all;
  if (opts.status && opts.status !== 'all') filtered = filtered.filter(r => r.status === opts.status);
  if (opts.bundle) filtered = filtered.filter(r => r.bundle === opts.bundle);
  const shown = filtered.slice(-Math.max(1, opts.limit));

  console.log(`=== /issues (status=${opts.status}${opts.bundle ? ' bundle=' + opts.bundle : ''}) ===`);
  console.log(`Total matching: ${filtered.length}`);
  if (shown.length === 0) {
    console.log('No matching issues.');
    process.exit(0);
  }
  for (const r of shown) {
    const delta = r.deltaPct != null ? ` Δ${r.deltaPct}%` : '';
    console.log(`  [${r.id}] ${r.status} ${r.taxonomy} ${r.key || ''} @${r.bundle}${r.turn ? ' @' + r.turn : ''}: expected=${JSON.stringify(r.expected)} actual=${JSON.stringify(r.actual)}${delta}${r.bugId ? ' bug=' + r.bugId : ''}`);
  }
  process.exit(0);
}

function runCalibrate(opts) {
  const bundles = listBundleDirs(opts.dir);
  if (bundles.length === 0) {
    console.error(`No Meal-* bundles under ${opts.dir}`);
    process.exit(3);
  }

  const byModel = new Map();
  for (const dir of bundles) {
    const h = loadHarness(dir);
    const c = loadComparison(dir);
    const model = (c && c.harness && c.harness.scoutModel) || (h && h.model) || 'unknown';
    if (!byModel.has(model)) byModel.set(model, { model, bundles: 0, compared: 0, pass: 0, fail: 0, diverged: 0, coreFail: 0, microFail: 0, bboxFail: 0, nameFail: 0, totalFailures: 0 });
    const s = byModel.get(model);
    s.bundles += 1;
    if (!c) continue;
    s.compared += 1;
    const v = c.verdict || 'UNKNOWN';
    if (v === 'PASS') s.pass += 1; else if (v === 'DIVERGED') s.diverged += 1; else s.fail += 1;
    for (const f of collectFailures(c)) {
      s.totalFailures += 1;
      if (f.taxonomy === 'core_nutrient_drift') s.coreFail += 1;
      else if (f.taxonomy === 'micro_nutrient_drift') s.microFail += 1;
      else if (f.taxonomy === 'bbox_drift') s.bboxFail += 1;
      else if (f.taxonomy === 'name_mismatch' || f.taxonomy === 'ocr_error') s.nameFail += 1;
    }
  }

  const scores = [];
  for (const s of byModel.values()) {
    const coreBundleRate = s.compared > 0 ? Math.round(((s.compared - (s.coreFail > 0 ? 1 : 0)) / s.compared) * 1000) / 10 : null;
    // numeric accuracy score: 0–100, weighted PASS rate with penalties
    const passRate = s.compared > 0 ? s.pass / s.compared : 0;
    const score = s.compared >= opts.minN
      ? Math.round((passRate * 70 + (s.compared > 0 ? Math.max(0, 30 - s.totalFailures * 2) : 0)) * 10) / 10
      : null;
    scores.push({ ...s, coreNutrientPassRatePct: coreBundleRate, score });
  }
  scores.sort((a, b) => (b.score ?? -1) - (a.score ?? -1));

  const out = {
    generatedAt: new Date().toISOString(),
    dir: opts.dir,
    minN: opts.minN,
    models: scores,
    recommendation: null,
  };
  const eligible = scores.filter(s => s.score != null);
  if (eligible.length > 0) {
    out.recommendation = {
      bestModel: eligible[0].model,
      bestScore: eligible[0].score,
      note: eligible[0].score >= 70
        ? 'Keep current model; core pass rate acceptable.'
        : 'Score below 70 — consider switching meal_audit profile model and re-calibrating.',
    };
  }

  const outPath = path.join(opts.dir, 'model_calibration.json');
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf-8');

  console.log('=== Meal-Audit Model Calibration ===');
  for (const s of scores) {
    console.log(`  model=${s.model} bundles=${s.bundles} compared=${s.compared} PASS=${s.pass} FAIL=${s.fail} DIVERGED=${s.diverged} failures=${s.totalFailures} score=${s.score ?? 'n/a (minN=' + opts.minN + ')'}`);
  }
  if (out.recommendation) console.log(`Recommendation: ${out.recommendation.bestModel} (${out.recommendation.bestScore}) — ${out.recommendation.note}`);
  console.log(`Wrote ${outPath}`);
  process.exit(0);
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help || !opts.mode) {
    console.log(`Usage:
  node scripts/meal-audit-suite.mjs report [--dir=…] [--out=…]
  node scripts/meal-audit-suite.mjs issues [--status=open|all] [--bundle=…] [--limit=N]
  node scripts/meal-audit-suite.mjs calibrate [--dir=…] [--min-n=N]

Exit: 0=ok  1=report had FAIL/DIVERGED  3=usage`);
    process.exit(opts.help ? 0 : 3);
  }
  if (opts.mode === 'report') runReport(opts);
  if (opts.mode === 'issues') runIssues(opts);
  if (opts.mode === 'calibrate') runCalibrate(opts);
}

main();
