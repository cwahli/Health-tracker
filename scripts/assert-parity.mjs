#!/usr/bin/env node
/**
 * Q-11 parity guard — a god-file split may move code, never shrink behaviour.
 *
 * Born from the a14abea regression: a "decoupling" commit passed tsc + vitest +
 * vite build while stubbing src/types.ts to `any`, truncating translations.ts,
 * deleting src/components/AuthScreen.tsx and dropping the Firebase session
 * wiring entirely. Nothing in the gate list noticed, because every gate asked
 * "does it compile" instead of "is the product still whole".
 *
 *   node scripts/assert-parity.mjs            # verify against the baseline
 *   node scripts/assert-parity.mjs --update   # re-record the baseline (review the diff!)
 *
 * Raising a CATALOG.json ceiling or lowering any baseline metric is a deliberate
 * act: run --update, justify it in the packet, and expect a reviewer to look.
 */
import fs from 'fs';
import path from 'path';

const root = process.cwd();
const baselinePath = path.join(root, 'scripts/parity-baseline.json');
const update = process.argv.includes('--update');

const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const exists = (rel) => fs.existsSync(path.join(root, rel));
function lineCount(text) {
  const parts = text.split('\n');
  return text.endsWith('\n') ? parts.length - 1 : parts.length;
}

/** Files that must keep existing: deleting one of these is the regression, not the fix. */
const REQUIRED_FILES = [
  'src/App.tsx',
  'src/main.tsx',
  'src/types.ts',
  'src/firebase.ts',
  'src/utils/translations.ts',
  'src/utils/storageUtils.ts',
  'src/components/AuthScreen.tsx',
  'src/components/BottomNav.tsx',
  'src/components/Header.tsx',
  'src/components/HomeTab.tsx',
  'src/components/LogChat.tsx',
  'src/components/MedicalHistoryTab.tsx',
  'src/jobs/JobStore.ts',
  'src/components/CATALOG.json',
];

/** Capabilities that must stay reachable from src/, wherever the refactor moves them. */
const REQUIRED_PATTERNS = [
  { id: 'auth_provider', re: /from ['"]firebase\/auth['"]/, why: 'Firebase auth import chain' },
  { id: 'auth_state_listener', re: /onAuthStateChanged/, why: 'session restore on load' },
  { id: 'auth_signout_call', re: /signOut\s*\(/, why: 'real Firebase sign-out call' },
  { id: 'session_cache_clear', re: /clearCachedAppData/, why: 'cached app data cleared on sign-out' },
  { id: 'jobstore_reset', re: /resetAllJobs/, why: 'job store reset on sign-out' },
  { id: 'login_gate', re: /AuthScreen/, why: 'the sign-in screen must still mount' },
  { id: 'profile_modal_signout', re: /profile-modal-bottom-signout-btn/, why: 'the sign-out button the user clicks' },
  { id: 'profile_avatar', re: /avatar-edit-btn/, why: 'header identity / profile entry point' },
  { id: 'demo_login_btn', re: /demo-login-btn/, why: 'the Playwright smoke specs enter through it' },
  { id: 'bottom_nav', re: /nav-tab-/, why: 'shell chrome the smoke specs assert (#nav-tab-home)' },
];

function walkSrc(dir = 'src', acc = []) {
  for (const ent of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const rel = path.join(dir, ent.name);
    if (ent.isDirectory()) walkSrc(rel, acc);
    else if (/\.(ts|tsx)$/.test(ent.name)) acc.push(rel.split(path.sep).join('/'));
  }
  return acc;
}

function measure() {
  const typesSrc = read('src/types.ts');
  const declarations = [...typesSrc.matchAll(/^export\s+(?:type|interface)\s+(\w+)/gm)].map((m) => m[1]);
  const anyAliases = [
    ...typesSrc.matchAll(/^export\s+(?:type|interface)\s+(\w+)[^\n]*?=\s*any\s*;?/gm),
  ].map((m) => m[1]);
  const i18nKeys = (read('src/utils/translations.ts').match(/^\s+"[A-Za-z0-9_]+":/gm) || []).length;
  const catalog = JSON.parse(read('src/components/CATALOG.json'));
  const tsNoCheckFiles = walkSrc().filter((f) => read(f).includes('@ts-nocheck'));

  return {
    types: { lines: lineCount(typesSrc), declarations: declarations.length, anyAliases: anyAliases.length },
    i18nKeys,
    appLines: lineCount(read('src/App.tsx')),
    ceilings: catalog.ceilings || {},
    tsNoCheckFiles: tsNoCheckFiles.length,
    godFiles: Object.fromEntries(
      walkSrc()
        .map((f) => [f, lineCount(read(f))])
        .filter(([, n]) => n > 1000)
        .sort((a, b) => b[1] - a[1]),
    ),
  };
}

const current = measure();

if (update) {
  const record = {
    note: 'Q-11 parity baseline. Regenerated only with --update; falling metrics are a regression.',
    capturedFromCommit: process.env.PARITY_BASELINE_COMMIT || null,
    ...current,
  };
  fs.writeFileSync(baselinePath, `${JSON.stringify(record, null, 2)}\n`);
  console.log(`updated ${path.relative(root, baselinePath)}`);
  console.log(
    `  types: ${current.types.lines} lines / ${current.types.declarations} declarations / ${current.types.anyAliases} any-aliases\n` +
      `  i18n keys: ${current.i18nKeys}\n` +
      `  App.tsx: ${current.appLines} lines\n` +
      `  god files >1000 lines: ${Object.keys(current.godFiles).length}\n` +
      `  @ts-nocheck files: ${current.tsNoCheckFiles}`,
  );
  process.exit(0);
}

if (!fs.existsSync(baselinePath)) {
  console.error('FAIL PARITY:baseline_missing — run node scripts/assert-parity.mjs --update');
  process.exit(1);
}
const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));

let failed = 0;
function ok(cond, id, msg) {
  if (cond) console.log(`PASS ${id}`);
  else {
    failed += 1;
    console.error(`FAIL ${id}: ${msg}`);
  }
}

for (const file of REQUIRED_FILES) {
  ok(exists(file), 'Q11:file_exists', `required file deleted or missing: ${file}`);
}

const srcBlob = walkSrc()
  .map((f) => read(f))
  .join('\n');
for (const { id, re, why } of REQUIRED_PATTERNS) {
  ok(re.test(srcBlob), `Q11:reachable:${id}`, `${why} — pattern ${re} not found anywhere under src/`);
}

ok(
  current.types.declarations >= baseline.types.declarations,
  'NO_STUBS:types_declarations',
  `src/types.ts now declares ${current.types.declarations} exports, baseline ${baseline.types.declarations} — types are being erased`,
);
ok(
  current.types.anyAliases <= baseline.types.anyAliases,
  'NO_STUBS:types_any_alias',
  `src/types.ts has ${current.types.anyAliases} \`export type X = any\` aliases, baseline ${baseline.types.anyAliases} — this is the LOAD_HACK stub`,
);
ok(
  current.types.lines >= Math.floor(baseline.types.lines * 0.5),
  'NO_STUBS:types_truncated',
  `src/types.ts is ${current.types.lines} lines, baseline ${baseline.types.lines} — file looks truncated`,
);
ok(
  current.i18nKeys >= baseline.i18nKeys,
  'NO_STUBS:i18n_keys',
  `src/utils/translations.ts has ${current.i18nKeys} keys, baseline ${baseline.i18nKeys} — UI copy is being dropped`,
);
ok(
  current.tsNoCheckFiles <= baseline.tsNoCheckFiles,
  'NO_STUBS:ts_nocheck',
  `${current.tsNoCheckFiles} src files carry @ts-nocheck, baseline ${baseline.tsNoCheckFiles}`,
);

ok(
  current.appLines <= baseline.appLines,
  'GOD_FILE_GROWTH:app_tsx',
  `src/App.tsx grew to ${current.appLines} lines, baseline ${baseline.appLines} — Q-11 may only shrink it`,
);

for (const [file, ceiling] of Object.entries(current.ceilings)) {
  const base = baseline.ceilings[file];
  if (base === undefined) continue; // new ceiling: a new primitive/split, allowed
  ok(
    ceiling <= base,
    'GOD_FILE_GROWTH:ceiling_raised',
    `CATALOG ceiling for ${file} raised ${base} -> ${ceiling}; ceilings are a ratchet`,
  );
}

for (const [file, base] of Object.entries(baseline.ceilings)) {
  ok(
    current.ceilings[file] !== undefined,
    'GOD_FILE_GROWTH:ceiling_removed',
    `CATALOG ceiling for ${file} was dropped from ceilings{} — do not delete budgets to pass`,
  );
}

const grew = Object.entries(baseline.godFiles).filter(
  ([file, base]) => (current.godFiles[file] ?? 0) > base + 25,
);
if (grew.length) {
  for (const [file, base] of grew) {
    console.warn(`warn PARITY:god_file_growth — ${file} ${base} -> ${current.godFiles[file]} lines`);
  }
}

if (failed) {
  console.error(`\nassert-parity: ${failed} failure(s)`);
  process.exit(1);
}
console.log('\nassert-parity: all PASS');
process.exit(0);
