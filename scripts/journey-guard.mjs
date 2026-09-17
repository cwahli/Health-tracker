#!/usr/bin/env node
/**
 * Guard node. Not an LLM. Run after Planner (packet) and after Builder.
 *
 *   node scripts/journey-guard.mjs
 *   node scripts/journey-guard.mjs F-8.12
 *
 * interrupt_before Builder: application diffs while packet is still draft → FAIL.
 */
import { spawnSync, execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const id = process.argv[2] || null;
let failed = 0;

function run(label, args) {
  console.log(`\n── ${label} ──`);
  const r = spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit' });
  if (r.status !== 0) failed += 1;
}

function packetStatus(slug) {
  const p = path.join(root, 'specs', 'active', `${slug}.md`);
  if (!fs.existsSync(p)) return null;
  const t = fs.readFileSync(p, 'utf8');
  const m = t.match(/^status:\s*(\S+)/m);
  return m ? m[1] : null;
}

function changedFiles() {
  try {
    const out = execSync(
      'git diff --name-only HEAD && git diff --name-only --cached && git ls-files --others --exclude-standard',
      { cwd: root, encoding: 'utf8' },
    );
    return [...new Set(out.split(/\r?\n/).filter(Boolean))];
  } catch {
    return [];
  }
}

function isAppPath(f) {
  return (
    f.startsWith('src/') ||
    /^server[^/]*\.ts$/.test(f) ||
    f.startsWith('agents/') ||
    f.startsWith('prototype/meallog/')
  );
}

function isUiPath(f) {
  return (
    f.startsWith('src/components/') ||
    f === 'src/App.tsx' ||
    f === 'src/main.tsx' ||
    // Q-11.8: the i18n packs now live in src/utils/translations/<lang>.ts behind the thin
    // aggregator; both the aggregator and the packs stay classified as UI copy.
    f.startsWith('src/utils/translations') ||
    f.startsWith('src/index.css')
  );
}

function isCalcPath(f) {
  return /derivation|meal_gate|nutritionTarget|biomarkerIdentity|convertViaTable|shouldExpandMealAgent/.test(f);
}

function isSyncPath(f) {
  return (
    f.includes('syncUtils') ||
    f.includes('SupabaseJobSync') ||
    f.includes('server_routes_sync') ||
    f.includes('firestoreUtils') ||
    f.includes('d1') ||
    f === 'src/App.tsx'
  );
}

function isImagePath(f) {
  return (
    f.includes('foodImageSources') ||
    f.includes('foodLogDedupe') ||
    f.includes('ImageSlider')
  );
}

function isBiomarkerPath(f) {
  return (
    f.includes('biomarker') ||
    f.includes('Biomarker') ||
    f.startsWith('src/server/biomarkers/')
  );
}

run('standing', [path.join(root, 'scripts/assert-standing.mjs')]);
run('spec-diff', [path.join(root, 'scripts/assert-spec-diff.mjs'), ...(id ? [id] : [])]);

const changed = changedFiles();
if (changed.some(isCalcPath) || process.env.GUARD_CALC === '1') {
  console.log('\n── calc (named vitest, no Gemini) ──');
  const calc = spawnSync(
    'npx',
    ['vitest', 'run', 'server_derivation.test.ts', 'src/utils/nutritionTargetStatus.test.ts', 'src/mealBuild/__tests__/shouldExpandMealAgent.test.ts'],
    { cwd: root, stdio: 'inherit' },
  );
  if (calc.status !== 0) failed += 1;
}

if (changed.some(isBiomarkerPath) || process.env.GUARD_BIOMARKER === '1') {
  console.log('\n── biomarker (named vitest, no Gemini) ──');
  const bio = spawnSync(
    'npx',
    ['vitest', 'run', 'src/utils/biomarkerSanitize.test.ts', 'src/utils/__tests__/biomarkerIdentity.test.ts'],
    { cwd: root, stdio: 'inherit' },
  );
  if (bio.status !== 0) failed += 1;
}

if (changed.some(isSyncPath) || process.env.GUARD_EGRESS === '1') {
  run('egress-bomb', [path.join(root, 'scripts/assert-egress-bomb.mjs')]);
}

if (changed.some(isImagePath) || process.env.GUARD_IMAGE === '1') {
  console.log('\n── image dedupe (named vitest, no Gemini) ──');
  const img = spawnSync(
    'npx',
    ['vitest', 'run', 'src/utils/foodImageSources.test.ts', 'src/utils/foodLogDedupe.test.ts'],
    { cwd: root, stdio: 'inherit' },
  );
  if (img.status !== 0) failed += 1;
}

if (changed.some(isUiPath) || process.env.GUARD_SMOKE === '1') {
  const smoke = spawnSync(process.execPath, [path.join(root, 'scripts/assert-shell-smoke.mjs')], {
    cwd: root,
    stdio: 'inherit',
  });
  if (smoke.status !== 0) failed += 1;
}

const slug = id || null;
const st = slug ? packetStatus(slug) : null;
if (st === 'draft') {
  const appChanges = changedFiles().filter(isAppPath);
  if (appChanges.length) {
    console.error('\n── interrupt_before builder ──');
    console.error(`FAIL interrupt: packet ${slug} is draft but application files changed:`);
    for (const f of appChanges.slice(0, 20)) console.error(`  ${f}`);
    console.error('Wait for human **go** (status: locked). Time travel: node scripts/journey-checkpoint.mjs restore <slug> planner');
    failed += 1;
  } else {
    console.log('\nPASS interrupt (draft packet, no application diffs)');
  }
}

if (failed) {
  console.error('\nGUARD FAIL — Builder must not COMPLETE.');
  console.error('SHEPHERD [revert]: Do not patch on top of broken code. Snap back to clean checkpoint:');
  console.error('  node scripts/journey-checkpoint.mjs restore <slug> <node>');
  console.error('SHEPHERD [fork]: Branch a clean second hypothesis from pristine state:');
  console.error('  node scripts/journey-checkpoint.mjs fork <slug> <from_node> <new_node>');
  process.exit(1);
}
console.log('\nGUARD PASS');
process.exit(0);
