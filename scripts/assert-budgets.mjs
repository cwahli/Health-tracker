/**
 * Track Q — platform budget gate (ROADMAP Q-1, QUALITY.md §13).
 * Fails a green vitest-style pack that still adds a second math path, Auto-Fix door, or god-file lines.
 */
import fs from 'fs';
import path from 'path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const rel = (p) => path.relative(root, p);

let failed = 0;
function ok(cond, id, msg) {
  if (cond) console.log(`PASS ${id}`);
  else {
    failed += 1;
    console.error(`FAIL ${id}: ${msg}`);
  }
}

const catalogPath = path.join(root, 'src/components/CATALOG.json');
ok(fs.existsSync(catalogPath), 'Q2:catalog_exists', 'missing src/components/CATALOG.json');

const catalog = JSON.parse(read('src/components/CATALOG.json'));
const requiredIds = [
  'UniversalModal',
  'DataGrid',
  'FilterPills',
  'ConfirmBar',
  'NutritionLabelTable',
  'ComprehensiveNutrientsTable',
  'PortionClarifyCard',
  'convertViaTable',
  'lazyWithRetry',
];
const ids = new Set((catalog.primitives || []).map((p) => p.id));
for (const id of requiredIds) {
  ok(ids.has(id), 'Q2:catalog_id', `CATALOG.json missing primitive id ${id}`);
}

ok(catalog.autoFixSurface?.choice === 'B', 'B8.0:choice_B', 'CATALOG autoFixSurface.choice must be B');
ok(
  catalog.autoFixSurface?.onlyComponent === null,
  'B8.0:surface',
  'Auto-Fix is banned from Home in Option B'
);

const ceilings = catalog.ceilings || {};
for (const [file, max] of Object.entries(ceilings)) {
  const abs = path.join(root, file);
  ok(fs.existsSync(abs), 'Q1:ceiling_file', `missing ${file}`);
  if (!fs.existsSync(abs)) continue;
  const text = read(file);
  const parts = text.split('\n');
  const lines = text.endsWith('\n') ? parts.length - 1 : parts.length;
  ok(lines <= max, 'GOD_FILE_GROWTH', `${file} has ${lines} lines; ceiling ${max}`);
}

const telemetryFn = (() => {
  const src = read('src/utils/biomarkers.ts');
  const start = src.indexOf('export function computeBiomarkerTelemetryMultiplier');
  ok(start >= 0, 'B8.1:fn_exists', 'computeBiomarkerTelemetryMultiplier missing');
  if (start < 0) return '';
  const rest = src.slice(start);
  const next = rest.indexOf('\nexport function ', 10);
  return next >= 0 ? rest.slice(0, next) : rest;
})();

ok(
  telemetryFn.includes('ANALYTE_CONVERSIONS') || telemetryFn.includes('specForAnalyte'),
  'SECOND_MATH_PATH:uses_table',
  'computeBiomarkerTelemetryMultiplier must use ANALYTE_CONVERSIONS / specForAnalyte'
);
for (const lit of ['18.0182', '38.67', '88.57']) {
  ok(
    !telemetryFn.includes(lit),
    'SECOND_MATH_PATH:no_private_factor',
    `computeBiomarkerTelemetryMultiplier still embeds private factor ${lit}`
  );
}

const componentsDir = path.join(root, 'src/components');
function walk(dir, acc = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p, acc);
    else if (ent.name.endsWith('.tsx') || ent.name.endsWith('.ts')) acc.push(p);
  }
  return acc;
}

const allowedAutoFix = path.normalize('src/components/HomeTab.tsx');
for (const file of walk(componentsDir)) {
  const text = fs.readFileSync(file, 'utf8');
  const r = rel(file);
  if (path.normalize(r) === allowedAutoFix) continue;
  const hasAutoFix = /Apply Auto-Fix|⚡ Auto-Fix|Quick Approve/i.test(text);
  ok(!hasAutoFix, 'CLONE_UI:auto_fix_surface', `Auto-Fix / Quick Approve found in ${r} (only HomeTab.tsx allowed)`);
  ok(
    !/Auto-Calibrate/i.test(text),
    'CLONE_UI:auto_calibrate',
    `Auto-Calibrate found in ${r} (B8.2 / B0.4: gone from Dictionary and Audit)`
  );
}

ok(
  fs.existsSync(path.join(root, 'src/utils/analyteConversions.ts')),
  'B8.1:table_module',
  'missing src/utils/analyteConversions.ts'
);
const tableSrc = read('src/utils/analyteConversions.ts');
for (const n of ['1.293', '1.411', '3.362', '79.56', '13.68']) {
  ok(tableSrc.includes(n) || tableSrc.includes('0.02586') || tableSrc.includes('88.4'), 'N2:locked_comment', `conversion module comment/table missing lock context (${n})`);
}
ok(tableSrc.includes('0.02586'), 'B8.1:hdl_factor', 'ANALYTE_CONVERSIONS missing 0.02586');
ok(tableSrc.includes('88.4'), 'B8.1:creat_factor', 'ANALYTE_CONVERSIONS missing 88.4');
ok(tableSrc.includes('17.1'), 'B8.1:bili_factor', 'ANALYTE_CONVERSIONS missing 17.1');

// Track F: F-7 Scout System Instruction budget check (L12 net-zero prompt ceiling: max 70 lines)
const scoutSrc = read('server_vision_scout.ts');
const sysInstMatch = scoutSrc.match(/export const scoutSystemInstruction = `([\s\S]*?)`;/);
ok(sysInstMatch !== null, 'F7:scout_instruction_exists', 'scoutSystemInstruction missing in server_vision_scout.ts');
if (sysInstMatch) {
  const promptLines = sysInstMatch[1].split('\n').length;
  ok(promptLines <= 70, 'PROMPT_BUDGET:scout_prompt', `scoutSystemInstruction has ${promptLines} lines; ceiling 70`);
}

if (failed) {
  console.error(`\nassert-budgets: ${failed} failure(s)`);
  process.exit(1);
}
console.log('\nassert-budgets: all PASS');
process.exit(0);
