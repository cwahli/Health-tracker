#!/usr/bin/env node
/**
 * Master scorecard runner (not `npm test`).
 *
 * Reads frozen instruction/, writes current/, archives to past/ when the
 * instruction hash changes, writes result_summary/ only on all-green.
 * Skip is not PASS. Localization cannot pass on parity-only.
 *
 *   node scripts/assert-master-scorecard.mjs
 */
import { execSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCORECARD = path.join(root, 'golden/scorecard');
const INSTRUCTION = path.join(SCORECARD, 'instruction');
const CURRENT = path.join(SCORECARD, 'current');
const PAST_RUNS = path.join(SCORECARD, 'past/runs');
const RESULT = path.join(SCORECARD, 'result_summary');
const GATES_PATH = path.join(INSTRUCTION, 'gates.json');
const REQUIRED_CHROME_PATH = path.join(INSTRUCTION, 'i18n/REQUIRED_CHROME.json');
const FORBIDDEN_CHROME_PATH = path.join(INSTRUCTION, 'i18n/FORBIDDEN_EN_CHROME.json');
const STRUCTURE_PATH = path.join(INSTRUCTION, 'inventories/structure.json');
const TRANSLATIONS_PATH = path.join(root, 'src/utils/translations.ts');

const gates = JSON.parse(fs.readFileSync(GATES_PATH, 'utf8'));
const AREAS = gates.areas;
const SKIP_IS_FAIL = new Set(gates.skip_is_fail_files || []);
const SKIP_IS_FAIL_AREAS = new Set(gates.skip_is_fail_areas || []);

function git(cmd) {
  try {
    return execSync(cmd, { cwd: root, encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}

function rel(p) {
  return p.replace(/\\/g, '/').replace(root + '/', '').replace(/^\.\//, '');
}

function sha256(s) {
  return createHash('sha256').update(s).digest('hex');
}

function hashFiles(relPaths) {
  const h = createHash('sha256');
  for (const rp of relPaths) {
    const abs = path.join(root, rp);
    h.update(rp);
    h.update('\0');
    h.update(fs.existsSync(abs) ? fs.readFileSync(abs) : Buffer.from('MISSING'));
    h.update('\0');
  }
  return h.digest('hex');
}

function areaFor(file) {
  const n = rel(file);
  for (const [area, files] of Object.entries(AREAS)) {
    if (files.includes(n) || files.some((f) => n.endsWith(f))) return area;
  }
  return 'Unmapped';
}

function runVitest(files) {
  const tmp = path.join(os.tmpdir(), `scorecard-vitest-${Date.now()}.json`);
  const r = spawnSync(
    'npx',
    ['vitest', 'run', '--reporter=json', `--outputFile=${tmp}`, ...files],
    { cwd: root, encoding: 'utf8', timeout: 180000, env: { ...process.env, FORCE_COLOR: '0' } },
  );
  let report = null;
  if (fs.existsSync(tmp)) {
    try {
      report = JSON.parse(fs.readFileSync(tmp, 'utf8'));
    } catch {
      report = null;
    }
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* ignore */
    }
  }
  if (!report && r.stdout) {
    const start = r.stdout.indexOf('{');
    const end = r.stdout.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        report = JSON.parse(r.stdout.slice(start, end + 1));
      } catch {
        report = null;
      }
    }
  }
  return { status: r.status ?? 1, stderr: r.stderr || '', stdout: r.stdout || '', report };
}

function runCmd(label, cmd, args, area, timeoutMs) {
  const r = spawnSync(cmd, args, {
    cwd: root,
    encoding: 'utf8',
    timeout: timeoutMs || 120000,
    env: { ...process.env, FORCE_COLOR: '0' },
  });
  const pass = (r.status ?? 1) === 0;
  const err = (r.stderr || r.stdout || '').trim().split('\n').slice(-12).join('\n');
  return {
    id: label,
    kind: 'command',
    file: `${cmd} ${args.join(' ')}`,
    area,
    status: pass ? 'passed' : 'failed',
    durationMs: 0,
    message: pass ? '' : err.slice(0, 1200),
  };
}

function collectTests(report) {
  const rows = [];
  if (!report) return rows;
  const suites = report.testResults || [];
  for (const suite of suites) {
    const file = rel(suite.name || suite.assertionResults?.[0]?.location?.file || 'unknown');
    const assertions = suite.assertionResults || [];
    if (assertions.length === 0) {
      const msg = (suite.message || suite.failureMessage || '').slice(0, 1200);
      rows.push({
        id: file,
        kind: 'file',
        file,
        area: areaFor(file),
        status: suite.status === 'passed' ? 'passed' : 'failed',
        durationMs: suite.endTime && suite.startTime ? suite.endTime - suite.startTime : 0,
        message: shortMessage(msg),
        title: '(file collected)',
      });
      continue;
    }
    for (const a of assertions) {
      const status = a.status === 'pending' ? 'skipped' : a.status;
      rows.push({
        id: a.fullName || a.title || file,
        kind: 'test',
        file,
        area: areaFor(file),
        status,
        durationMs: a.duration || 0,
        message: shortMessage((a.failureMessages || []).join('\n')),
        title: a.title || a.fullName,
      });
    }
  }
  return rows;
}

function shortMessage(s) {
  const first =
    String(s || '')
      .split('\n')
      .map((l) => l.trim())
      .find((l) => l && !l.startsWith('at ') && !l.includes('node_modules')) || '';
  return first
    .replace(/file:\/\/\/[^\s)]+/g, '')
    .replace(/\/Users\/[^\s)]+Health-tracker\//g, '')
    .replace(/\s+at\s+\S.*$/, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, 220);
}

function mdEscape(s) {
  return shortMessage(s).replace(/\|/g, '\\|');
}

function badge(s) {
  if (s === 'passed') return 'PASS';
  if (s === 'skipped') return 'SKIP';
  return 'FAIL';
}

function humanizeKey(key) {
  return key
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/^./, (c) => c.toUpperCase());
}

function extractPack(src, locale) {
  const re = new RegExp(`\\b${locale}:\\s*\\{`);
  const m = re.exec(src);
  if (!m) return {};
  let depth = 1;
  let i = m.index + m[0].length;
  while (i < src.length && depth > 0) {
    const c = src[i];
    if (c === '"') {
      i += 1;
      while (i < src.length && src[i] !== '"') {
        if (src[i] === '\\') i += 1;
        i += 1;
      }
    } else if (c === '{') depth += 1;
    else if (c === '}') depth -= 1;
    i += 1;
  }
  const body = src.slice(m.index + m[0].length, i - 1);
  const pack = {};
  const pair = /"([^"]+)":\s*"((?:\\.|[^"\\])*)"/g;
  let pm;
  while ((pm = pair.exec(body))) {
    pack[pm[1]] = pm[2].replace(/\\n/g, '\n').replace(/\\"/g, '"');
  }
  return pack;
}

function walkFiles(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name === 'node_modules' || ent.name === 'dist' || ent.name.startsWith('.')) continue;
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walkFiles(p, acc);
    else if (/\.(ts|tsx|js|jsx)$/.test(ent.name)) acc.push(p);
  }
  return acc;
}

function collectCallsiteKeys() {
  const keys = new Map();
  const re = /\bt\(\s*[^,()]+,\s*['"]([A-Za-z_][A-Za-z0-9_]*)['"]/g;
  for (const file of [...walkFiles(path.join(root, 'src')), ...walkFiles(path.join(root, 'agents'))]) {
    if (/\.test\.|\.spec\./.test(file)) continue;
    const text = fs.readFileSync(file, 'utf8');
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text))) {
      const k = m[1];
      if (!keys.has(k)) keys.set(k, []);
      const list = keys.get(k);
      const r = rel(file);
      if (!list.includes(r)) list.push(r);
    }
  }
  return keys;
}

function i18nRows() {
  const rows = [];
  const required = JSON.parse(fs.readFileSync(REQUIRED_CHROME_PATH, 'utf8'));
  const forbidden = JSON.parse(fs.readFileSync(FORBIDDEN_CHROME_PATH, 'utf8'));
  const src = fs.existsSync(TRANSLATIONS_PATH) ? fs.readFileSync(TRANSLATIONS_PATH, 'utf8') : '';
  const en = extractPack(src, 'en');
  const id = extractPack(src, 'id');
  const loan = new Set(required.loanwords_id_may_equal_en || []);
  const missing = [];
  const leak = [];
  const englishFilled = [];
  const dumpLeftover = [];

  for (const key of required.keys) {
    const ev = en[key];
    const iv = id[key];
    if (ev == null || ev === '' || iv == null || iv === '') {
      missing.push(key);
      continue;
    }
    if (ev === key || iv === key) leak.push(key);
    const human = humanizeKey(key);
    if (iv === human) dumpLeftover.push(key);
    if (iv === ev && !loan.has(key)) englishFilled.push(key);
  }

  const callsites = collectCallsiteKeys();
  const callsiteMissing = [];
  for (const [key, files] of callsites) {
    if (!en[key] || !id[key]) callsiteMissing.push(`${key} (${files[0]})`);
  }

  const incidentInId = [];
  for (const key of required.keys) {
    const iv = id[key];
    if (!iv) continue;
    for (const s of forbidden.incident_strings || []) {
      if (iv === s) incidentInId.push(`${key}=${s}`);
    }
  }

  const hardcoded = [];
  for (const rootRel of forbidden.scan_roots || []) {
    for (const file of walkFiles(path.join(root, rootRel))) {
      if ((forbidden.exclude_name_substrings || []).some((x) => file.includes(x))) continue;
      const text = fs.readFileSync(file, 'utf8');
      for (const s of forbidden.incident_strings || []) {
        if (text.includes(`"${s}"`) || text.includes(`'${s}'`)) {
          hardcoded.push(`${rel(file)}:${s}`);
        }
      }
    }
  }

  function push(id, pass, message) {
    rows.push({
      id,
      kind: 'i18n-contract',
      file: 'golden/scorecard/instruction/i18n/REQUIRED_CHROME.json',
      area: 'Localization',
      status: pass ? 'passed' : 'failed',
      durationMs: 0,
      message: pass ? '' : message,
      title: id,
    });
  }

  push(
    'i18n_required_chrome_present',
    missing.length === 0,
    missing.length ? `missing en+id: ${missing.join(', ')}` : '',
  );
  push(
    'i18n_required_chrome_not_leak_key',
    leak.length === 0,
    leak.length ? `value equals key: ${leak.join(', ')}` : '',
  );
  push(
    'i18n_required_chrome_id_not_en',
    englishFilled.length === 0,
    englishFilled.length ? `id copy equals en: ${englishFilled.join(', ')}` : '',
  );
  push(
    'i18n_required_chrome_id_not_humanized_key',
    dumpLeftover.length === 0,
    dumpLeftover.length ? `id is Title-Case leftover of key: ${dumpLeftover.join(', ')}` : '',
  );
  push(
    'i18n_callsite_keys_in_packs',
    callsiteMissing.length === 0,
    callsiteMissing.length
      ? `${callsiteMissing.length} t() keys missing from packs (full list in current/i18n_callsite_missing.json)`
      : '',
  );
  push(
    'i18n_id_not_incident_string',
    incidentInId.length === 0,
    incidentInId.length ? incidentInId.join(', ') : '',
  );
  push(
    'i18n_components_not_hardcoded_incident',
    hardcoded.length === 0,
    hardcoded.length ? hardcoded.slice(0, 8).join(', ') : '',
  );

  return {
    rows,
    stats: {
      requiredKeys: required.keys.length,
      missing,
      leak,
      englishFilled,
      dumpLeftover,
      callsiteCount: callsites.size,
      callsiteMissingCount: callsiteMissing.length,
      callsiteMissing,
    },
  };
}

function structureRows() {
  const spec = JSON.parse(fs.readFileSync(STRUCTURE_PATH, 'utf8'));
  const rows = [];
  function push(id, area, pass, message) {
    rows.push({
      id,
      kind: 'structure-contract',
      file: 'golden/scorecard/instruction/inventories/structure.json',
      area,
      status: pass ? 'passed' : 'failed',
      durationMs: 0,
      message: pass ? '' : message,
      title: id,
    });
  }

  for (const [helper, files] of Object.entries(spec.call_sites || {})) {
    const missing = [];
    for (const f of files) {
      const abs = path.join(root, f);
      if (!fs.existsSync(abs) || !fs.readFileSync(abs, 'utf8').includes(helper)) missing.push(f);
    }
    const area =
      helper === 'NutrientTargetRow' || helper === 'getTopTargetNutrientKeys' || helper === 'isLimitNutrient'
        ? 'Meal Log'
        : helper === 'finalizeDishLedger'
          ? 'Meal Log'
          : 'Reliability';
    push(
      `structure_callsites_${helper}`,
      area,
      missing.length === 0,
      missing.length ? `${helper} missing from ${missing.join(', ')}` : '',
    );
  }

  for (const ban of spec.forbidden || []) {
    const abs = path.join(root, ban.file);
    const text = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : '';
    const hit = text.includes(ban.needle);
    push(`structure_forbidden_${ban.id}`, ban.area || 'Reliability', !hit, hit ? `forbidden needle present: ${ban.needle}` : '');
  }

  const expected = spec.expected || {};
  const nutrientsPath = path.join(root, 'src/utils/nutrients.ts');
  const nutrients = fs.existsSync(nutrientsPath) ? fs.readFileSync(nutrientsPath, 'utf8') : '';
  const fallback = (expected.top_targets?.fallback || []).map((k) => `"${k}"`).join(', ');
  const fallbackNeedle = `PRIMARY_NUTRIENTS = [${fallback}]`;
  push(
    'structure_top_targets_fallback',
    'Meal Log',
    nutrients.includes(fallbackNeedle),
    `PRIMARY_NUTRIENTS assignment missing or swapped (want ${fallbackNeedle})`,
  );
  for (const k of expected.top_targets?.limit_keys || []) {
    if (!nutrients.includes(`"${k}"`)) {
      push(`structure_limit_key_${k}`, 'Meal Log', false, `LIMIT_NUTRIENT_KEYS missing ${k}`);
    }
  }
  const hasAllLimits = (expected.top_targets?.limit_keys || []).every((k) => nutrients.includes(`"${k}"`));
  if (hasAllLimits) {
    push('structure_limit_keys_present', 'Meal Log', true, '');
  }

  const convertSrc = fs.existsSync(path.join(root, 'src/utils/analyteConversions.ts'))
    ? fs.readFileSync(path.join(root, 'src/utils/analyteConversions.ts'), 'utf8')
    : '';
  const mul = expected.biomarkers?.multiply || {};
  const mulOk =
    convertSrc.includes(String(mul.hdl)) &&
    convertSrc.includes(String(mul.triglycerides)) &&
    convertSrc.includes(String(mul.creatinine)) &&
    convertSrc.includes(String(mul.total_bilirubin));
  push(
    'structure_biomarker_multipliers',
    'Biomarkers',
    mulOk,
    mulOk ? '' : 'ANALYTE_CONVERSIONS multipliers swapped vs frozen locked_apply table',
  );

  return { rows, origin: spec.live?.origin };
}

function loadHackRows() {
  const rows = [];
  function push(id, pass, message) {
    rows.push({
      id,
      kind: 'load-hack',
      file: 'golden/scorecard/instruction/gates.json',
      area: 'Reliability',
      status: pass ? 'passed' : 'failed',
      durationMs: 0,
      message: pass ? '' : message,
      title: id,
    });
  }

  const nocheck = [];
  for (const file of [
    ...walkFiles(path.join(root, 'src')),
    ...fs.readdirSync(root)
      .filter((n) => /^server.*\.(ts|tsx)$/.test(n))
      .map((n) => path.join(root, n)),
  ]) {
    if (file.includes('.generated.') || /\.test\.|\.spec\./.test(file)) continue;
    const text = fs.readFileSync(file, 'utf8');
    if (text.includes('@ts-nocheck')) nocheck.push(rel(file));
  }
  push(
    'load_hack_ts_nocheck',
    nocheck.length === 0,
    nocheck.length ? `@ts-nocheck in ${nocheck.slice(0, 8).join(', ')}` : '',
  );

  const missingGates = vitestFiles.filter((f) => !fs.existsSync(path.join(root, f)));
  push(
    'named_gate_files_exist',
    missingGates.length === 0,
    missingGates.length ? `deleted named gates: ${missingGates.join(', ')}` : '',
  );

  const nutrients = fs.existsSync(TRANSLATIONS_PATH.replace('translations.ts', 'nutrients.ts'))
    ? fs.readFileSync(path.join(root, 'src/utils/nutrients.ts'), 'utf8')
    : '';
  const helperOk =
    nutrients.includes('export function getTopTargetNutrientKeys') &&
    nutrients.includes('isCoreNutrient') &&
    nutrients.includes('canonicalNutrientKey') &&
    nutrients.includes('steps') &&
    !nutrients.includes('profile?.topTargetNutrientKeys');
  push(
    'load_hack_top_targets_helper',
    helperOk,
    helperOk ? '' : 'getTopTargetNutrientKeys gutted (core/steps/canonical missing or swapped to raw profile list)',
  );

  const contractSrc = fs.existsSync(path.join(root, 'src/utils/scorecardContract.ts'))
    ? fs.readFileSync(path.join(root, 'src/utils/scorecardContract.ts'), 'utf8')
    : '';
  const painted = /locked_apply:\s*\{[^}]*hdl:\s*1\.293/.test(contractSrc);
  const computed = contractSrc.includes('50 * hdlMul') && contractSrc.includes('ANALYTE_CONVERSIONS');
  push(
    'load_hack_contract_not_painted',
    computed && !painted,
    painted || !computed ? 'scorecardContract locked_apply is hardcoded; must compute from ANALYTE_CONVERSIONS' : '',
  );

  const junk = ['fix-slice-all.cjs', 'fix-slice-home.cjs', 'fix-slice-logchat.cjs', 'fix-slice.cjs', 'fix-slice.js', 'schema_dump.ts']
    .filter((f) => fs.existsSync(path.join(root, f)));
  push(
    'load_hack_no_slice_scripts',
    junk.length === 0,
    junk.length ? `LOAD_HACK leftovers: ${junk.join(', ')}` : '',
  );

  return { rows };
}

function archiveCurrentIfInstructionChanged(instructionHash) {
  const runPath = path.join(CURRENT, 'RUN.json');
  if (!fs.existsSync(runPath)) return null;
  let prev;
  try {
    prev = JSON.parse(fs.readFileSync(runPath, 'utf8'));
  } catch {
    return null;
  }
  if (!prev.instructionHash || prev.instructionHash === instructionHash) return null;
  const stamp = `${(prev.exportedAt || new Date().toISOString()).replace(/[:.]/g, '-')}-${prev.commit || 'unknown'}`;
  const dest = path.join(PAST_RUNS, stamp);
  fs.mkdirSync(dest, { recursive: true });
  for (const name of ['RUN.json', 'MASTER_SCORECARD_DEBUG.json', 'MASTER_SCORECARD_DEBUG.md']) {
    const from = path.join(CURRENT, name);
    if (fs.existsSync(from)) fs.renameSync(from, path.join(dest, name));
  }
  return rel(dest);
}

function sealTree(tree) {
  const copy = { ...tree };
  delete copy.seal;
  return sha256(JSON.stringify(copy));
}

const instructionHash = hashFiles([
  'golden/scorecard/instruction/gates.json',
  'golden/scorecard/instruction/MASTER_SCORECARD.md',
  'golden/scorecard/instruction/i18n/REQUIRED_CHROME.json',
  'golden/scorecard/instruction/i18n/FORBIDDEN_EN_CHROME.json',
  'golden/scorecard/instruction/inventories/structure.json',
]);

fs.mkdirSync(CURRENT, { recursive: true });
fs.mkdirSync(PAST_RUNS, { recursive: true });
fs.mkdirSync(RESULT, { recursive: true });
const archivedTo = archiveCurrentIfInstructionChanged(instructionHash);

const commit = git('git rev-parse --short HEAD');
const commitFull = git('git rev-parse HEAD');
const exportedAt = new Date().toISOString();

const vitestFiles = [...new Set(Object.values(AREAS).flat())];
const missingFiles = vitestFiles.filter((f) => !fs.existsSync(path.join(root, f)));

const vitest = runVitest(vitestFiles.filter((f) => fs.existsSync(path.join(root, f))));
const tests = collectTests(vitest.report);

for (const f of missingFiles) {
  tests.push({
    id: f,
    kind: 'file',
    file: f,
    area: areaFor(f),
    status: 'failed',
    durationMs: 0,
    message: 'named gate file missing on disk',
    title: '(missing file)',
  });
}

for (const f of vitestFiles.filter((x) => !missingFiles.includes(x))) {
  const has = tests.some((t) => t.file === f || t.file.endsWith(f));
  if (!has) {
    tests.push({
      id: f,
      kind: 'file',
      file: f,
      area: areaFor(f),
      status: 'failed',
      durationMs: 0,
      message: 'named gate produced 0 tests (cannot pass by collecting nothing)',
      title: '(empty collection)',
    });
  }
}

if (!vitest.report) {
  tests.push({
    id: 'vitest-json',
    kind: 'command',
    file: 'vitest --reporter=json',
    area: 'Reliability',
    status: 'failed',
    durationMs: 0,
    message: (vitest.stderr || vitest.stdout || 'no json report').slice(0, 1200),
    title: 'vitest json reporter',
  });
}

const commands = (gates.commands || []).map((c) =>
  runCmd(c.id, c.cmd, c.args, c.area, c.timeout_ms),
);
const i18n = i18nRows();
const structure = structureRows();
const loadHack = loadHackRows();

function normStatus(row) {
  if (row.status === 'skipped' && (SKIP_IS_FAIL.has(row.file) || SKIP_IS_FAIL_AREAS.has(row.area))) {
    return 'failed';
  }
  return row.status;
}

const rows = [...tests, ...commands, ...i18n.rows, ...structure.rows, ...loadHack.rows].map((r) => {
  const contractStatus = normStatus(r);
  const message = r.message ? shortMessage(r.message) : '';
  const out = { ...r, contractStatus, message };
  if (!out.message) delete out.message;
  return out;
});

const passed = rows.filter((r) => r.contractStatus === 'passed');
const failed = rows.filter((r) => r.contractStatus === 'failed');
const skipped = rows.filter((r) => r.contractStatus === 'skipped');

const byArea = {};
for (const area of [...Object.keys(AREAS), 'Unmapped']) {
  const subset = rows.filter((r) => r.area === area);
  if (!subset.length) continue;
  const f = subset.filter((r) => r.contractStatus === 'failed').length;
  const s = subset.filter((r) => r.contractStatus === 'skipped').length;
  const p = subset.filter((r) => r.contractStatus === 'passed').length;
  byArea[area] = {
    pass: p,
    fail: f,
    skip: s,
    total: subset.length,
    result: f === 0 && s === 0 ? 'PASS' : f ? 'FAIL' : 'SKIP',
  };
}

const skipFalseGreen = tests.filter(
  (r) =>
    (SKIP_IS_FAIL.has(r.file) || SKIP_IS_FAIL_AREAS.has(r.area)) && r.status === 'skipped',
);
const overallPass = failed.length === 0 && skipped.length === 0 && skipFalseGreen.length === 0;

const contract = [
  {
    law: 'overall_named_gates',
    layer: 'process',
    result: overallPass ? 'PASS' : 'FAIL',
    actual: `${passed.length} pass / ${failed.length} fail / ${skipped.length} skip of ${rows.length}`,
  },
  {
    law: 'skip_is_not_pass',
    layer: 'process',
    result: skipFalseGreen.length === 0 ? 'PASS' : 'FAIL',
    actual:
      skipFalseGreen.length === 0
        ? 'no required-skip scored as pass'
        : `${skipFalseGreen.length} required skips scored FAIL (Localization or golden_biomarker)`,
  },
  {
    law: 'collection_does_not_crash',
    layer: 'process',
    result: tests.some((t) => t.kind === 'file' && t.status === 'failed') ? 'FAIL' : 'PASS',
    actual:
      tests
        .filter((t) => t.kind === 'file' && t.status === 'failed')
        .map((t) => t.file)
        .join(', ') || 'all named files collected',
  },
  {
    law: 'i18n_required_chrome',
    layer: 'localization',
    result: i18n.rows.filter((r) => r.status !== 'passed').length === 0 ? 'PASS' : 'FAIL',
    actual:
      i18n.rows.filter((r) => r.status !== 'passed').length === 0
        ? `${i18n.stats.requiredKeys} frozen keys present, not leak, id≠en`
        : i18n.rows
            .filter((r) => r.status !== 'passed')
            .map((r) => r.message)
            .join('; '),
  },
  {
    law: 'structure_inventories',
    layer: 'process',
    result: structure.rows.some((r) => r.status !== 'passed') ? 'FAIL' : 'PASS',
    actual: structure.rows.some((r) => r.status !== 'passed')
      ? structure.rows
          .filter((r) => r.status !== 'passed')
          .map((r) => r.message)
          .join('; ')
      : 'helpers present; fallback/polarity/converts not swapped',
  },
  {
    law: 'load_hack_forbidden',
    layer: 'process',
    result: loadHack.rows.some((r) => r.status !== 'passed') ? 'FAIL' : 'PASS',
    actual: loadHack.rows.some((r) => r.status !== 'passed')
      ? loadHack.rows
          .filter((r) => r.status !== 'passed')
          .map((r) => r.message)
          .join('; ')
      : 'no @ts-nocheck; named gates on disk; Top Targets helper intact; contract not painted',
  },
  {
    law: 'live_origin',
    layer: 'process',
    result: commands.some((c) => c.id === 'scorecard-live' && c.status !== 'passed') ? 'FAIL' : 'PASS',
    actual: commands.some((c) => c.id === 'scorecard-live' && c.status !== 'passed')
      ? 'live Render probe failed (see current/live/)'
      : `live origin ${structure.origin}`,
  },
  {
    law: 'result_summary_sealed',
    layer: 'process',
    result: 'PASS',
    actual: overallPass
      ? 'will write result_summary (overallPass)'
      : 'will not write result_summary (not all green)',
  },
  ...Object.entries(byArea).map(([area, s]) => ({
    law: `area_${area.toLowerCase().replace(/\s+/g, '_')}`,
    layer: 'area',
    result: s.result,
    actual: `${s.pass} pass / ${s.fail} fail / ${s.skip} skip`,
  })),
  ...commands.map((c) => ({
    law: c.id,
    layer: 'command',
    result: c.status === 'passed' ? 'PASS' : 'FAIL',
    actual: c.message ? c.message.split('\n')[0] : 'exit 0',
  })),
];

const tree = {
  pack: 'scorecard',
  status: overallPass ? 'succeeded' : 'failed',
  exportedAt,
  identity: {
    commit,
    commitFull,
    instructionHash,
    host: 'local named gates',
    command: 'node scripts/assert-master-scorecard.mjs',
    vitestFiles,
    archivedTo,
  },
  counts: {
    pass: passed.length,
    fail: failed.length,
    skip: skipped.length,
    total: rows.length,
  },
  byArea,
  i18n: i18n.stats,
  contract,
  tests: rows,
};

tree.seal = sealTree(tree);

const outJson = path.join(CURRENT, 'MASTER_SCORECARD_DEBUG.json');
const outMd = path.join(CURRENT, 'MASTER_SCORECARD_DEBUG.md');
const runJson = path.join(CURRENT, 'RUN.json');

function sectionList(title, list, extra) {
  const lines = [`## ${title}`, ''];
  if (!list.length) {
    lines.push('_none_', '');
    return lines;
  }
  const areas = [...new Set(list.map((r) => r.area))];
  for (const area of areas) {
    const subset = list.filter((r) => r.area === area);
    lines.push(`### ${area} (${subset.length})`, '');
    lines.push('| Status | File | Test |');
    lines.push('|---|---|---|');
    for (const r of subset) {
      const note = extra ? extra(r) : '';
      lines.push(
        `| ${badge(r.contractStatus)} | \`${r.file}\` | ${mdEscape(r.id)}${note ? ` — ${mdEscape(note)}` : ''} |`,
      );
    }
    lines.push('');
  }
  return lines;
}

const md = [
  '# Master Scorecard Debug',
  '',
  'Canonical JSON: [`MASTER_SCORECARD_DEBUG.json`](./MASTER_SCORECARD_DEBUG.json). Markdown is a view of that tree. **Skip is not PASS.** Do not cite this file as all-green unless Contract `overall_named_gates` is PASS **and** process exit 0. `result_summary/` is written only then.',
  '',
  `**When:** ${exportedAt}`,
  `**Commit:** \`${commit}\``,
  `**Instruction hash:** \`${instructionHash.slice(0, 12)}\``,
  `**Seal:** \`${tree.seal}\``,
  `**Command:** \`node scripts/assert-master-scorecard.mjs\``,
  `**Overall:** ${overallPass ? '**ALL GREEN**' : '**NOT ALL GREEN**'} — ${passed.length} pass / ${failed.length} fail / ${skipped.length} skip`,
  archivedTo ? `**Archived previous current →** \`${archivedTo}\`` : '',
  '',
  '## Contract',
  '',
  '| Law | Result | Actual |',
  '|---|---|---|',
  ...contract.map((c) => `| \`${c.law}\` | ${c.result} | ${mdEscape(c.actual)} |`),
  '',
  '## Area rollup',
  '',
  '| Area | Result | Pass | Fail | Skip | Total |',
  '|---|---|---:|---:|---:|---:|',
  ...Object.entries(byArea).map(
    ([area, s]) => `| ${area} | ${s.result} | ${s.pass} | ${s.fail} | ${s.skip} | ${s.total} |`,
  ),
  '',
  ...sectionList('All failed (red)', failed, (r) => r.message),
  ...sectionList('All skipped (not green)', skipped),
  ...sectionList('All passed (green)', passed),
  '## Notes',
  '',
  '- Named gates only. Playwright live specs are not in this dump (quota).',
  '- Localization uses frozen `instruction/i18n/REQUIRED_CHROME.json` parsed from `translations.ts` text. Parity-only cannot pass.',
  '- `tests/golden_biomarker.test.ts` skips and any Localization skip are scored FAIL.',
  '- Regenerating this file is the only refresh. Do not edit it to look green.',
  '',
].filter((line, i, arr) => !(line === '' && arr[i - 1] === '')).join('\n');

fs.writeFileSync(outJson, JSON.stringify(tree, null, 2));
fs.writeFileSync(
  path.join(CURRENT, 'i18n_callsite_missing.json'),
  JSON.stringify(
    {
      law: 'Every t(lang, \'key\') in src/ and agents/ (non-test) must exist in localePacks.en and localePacks.id. Missing keys render as raw camelCase (LEAK_KEY).',
      count: i18n.stats.callsiteMissingCount,
      keys: i18n.stats.callsiteMissing,
    },
    null,
    2,
  ),
);
const i18nMissingMd = [
  '## i18n t() keys missing from packs (complete)',
  '',
  i18n.stats.callsiteMissingCount
    ? i18n.stats.callsiteMissing.map((k) => `- \`${k}\``).join('\n')
    : '_none_',
  '',
].join('\n');
fs.writeFileSync(outMd, md.replace('## Notes', `${i18nMissingMd}## Notes`));
fs.writeFileSync(
  runJson,
  JSON.stringify(
    {
      exportedAt,
      commit,
      commitFull,
      instructionHash,
      overallPass,
      seal: tree.seal,
      counts: tree.counts,
    },
    null,
    2,
  ),
);

if (overallPass) {
  const latestJson = path.join(RESULT, 'LATEST.json');
  const latestMd = path.join(RESULT, 'LATEST.md');
  fs.writeFileSync(latestJson, JSON.stringify(tree, null, 2));
  fs.writeFileSync(
    latestMd,
    md.replace(
      'Canonical JSON: [`MASTER_SCORECARD_DEBUG.json`](./MASTER_SCORECARD_DEBUG.json).',
      'Canonical JSON: [`LATEST.json`](./LATEST.json). Sealed all-green copy of current/.',
    ),
  );
  const stamped = path.join(RESULT, commit || exportedAt.replace(/[:.]/g, '-'));
  fs.mkdirSync(stamped, { recursive: true });
  fs.copyFileSync(latestJson, path.join(stamped, 'MASTER_SCORECARD_DEBUG.json'));
  fs.copyFileSync(latestMd, path.join(stamped, 'MASTER_SCORECARD_DEBUG.md'));
} else if (!overallPass) {
  const latestJson = path.join(RESULT, 'LATEST.json');
  if (fs.existsSync(latestJson)) {
    try {
      const prev = JSON.parse(fs.readFileSync(latestJson, 'utf8'));
      if (prev.identity?.instructionHash !== instructionHash || prev.status !== 'succeeded') {
        /* stale green for a different instruction, or a hand-written file — leave README as source of truth */
      }
    } catch {
      /* ignore */
    }
  }
}

console.log(`wrote ${rel(outMd)}`);
console.log(`wrote ${rel(outJson)}`);
if (archivedTo) console.log(`archived previous current → ${archivedTo}`);
console.log(
  `${overallPass ? 'ALL GREEN' : 'NOT ALL GREEN'} ${passed.length} pass / ${failed.length} fail / ${skipped.length} skip`,
);
if (overallPass) console.log(`wrote ${rel(path.join(RESULT, 'LATEST.md'))}`);
else console.log('result_summary not updated (not all green)');
for (const c of contract.filter((x) => x.result !== 'PASS')) {
  console.error(`FAIL ${c.law}: ${c.actual}`);
}
process.exit(overallPass ? 0 : 1);
