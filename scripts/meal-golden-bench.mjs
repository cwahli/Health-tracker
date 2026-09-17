#!/usr/bin/env node
/**
 * Meal_04_log golden bench — offline deterministic check.
 * Docs (source of truth): golden/meal/README.md + golden/meal/Meal_04_log/README.md
 * Live harnesses (require server + Vertex key, NOT run here):
 *   npm run test:benchmark:food   (prototype/meallog/runner.ts --case 08)
 *   tsx prototype/meallog/compare/run_meal03_six_vertex_gt.ts  (Meal_03 Mode D)
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const SUITE = path.join(ROOT, 'golden', 'meal', 'Meal_04_log');
const SLUGS = [
  '01_branded_plate',
  '02_lidl_packaged',
  '06_menu_receipt_log',
  '08_oats_label',
  '09_restaurant_plates',
  '10_barcode_hotpot',
  '11_seafood_oats',
  '12_chat_saved_meal',
];
const MACROS = ['weight', 'calories', 'protein', 'carbs', 'fat', 'satFat', 'fibre', 'sodium'];

let fail = 0;
const rows = [];
for (const slug of SLUGS) {
  const dir = path.join(SUITE, slug);
  const errs = [];
  let expected = null;
  try {
    expected = JSON.parse(fs.readFileSync(path.join(dir, 'expected.json'), 'utf8'));
  } catch (e) {
    errs.push('expected.json unparsable: ' + String(e.message || e));
  }
  if (expected) {
    for (const k of MACROS) {
      const v = expected?.mealTotals?.[k];
      if (typeof v !== 'number' || !Number.isFinite(v)) errs.push(`mealTotals.${k} not a finite number (no invented macros; fix from prototype GT)`);
    }
    for (const p of expected?.photos || []) {
      if (!fs.existsSync(path.join(dir, 'photos', p))) errs.push('missing photo: ' + p);
    }
    if (expected.status !== 'DRAFT' && expected.status !== 'FINAL') errs.push('status must be DRAFT or FINAL');
    if (expected.status === 'FINAL' && expected.fullNutrientsAvailable !== true) errs.push('FINAL requires fullNutrientsAvailable:true + 32-key ledger');
  }
  for (const f of ['correct_results.md', 'benchmark_result.md', 'Instruction.md', 'MODEL.md']) {
    if (!fs.existsSync(path.join(dir, f))) errs.push('missing ' + f);
  }
  try {
    const md = fs.readFileSync(path.join(dir, 'correct_results.md'), 'utf8');
    if (!/\*\*DRAFT[^*]*\*\*|\*\*FINAL[^*]*\*\*/.test(md)) errs.push('correct_results.md must mark DRAFT vs FINAL honestly');
    if (!/## Sources|## Provenance/.test(md)) errs.push('correct_results.md must cite prototype sources');
  } catch { errs.push('correct_results.md unreadable'); }
  const ok = errs.length === 0;
  if (!ok) fail += 1;
  rows.push({ slug, ok, status: expected?.status || '?', errs });
}

console.log('# Meal_04_log golden bench (offline) — docs: golden/meal/README.md');
for (const r of rows) {
  console.log(`${r.ok ? 'PASS' : 'FAIL'} ${r.slug} [${r.status}]${r.ok ? '' : ' :: ' + r.errs.join('; ')}`);
}
console.log(`\n${rows.length - fail}/${rows.length} cases pass. Live: npm run test:benchmark:food (needs :3000 + Vertex key).`);
process.exit(fail ? 1 : 0);
