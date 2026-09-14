#!/usr/bin/env node
/**
 * Master scorecard debug dump.
 *
 * Runs the named inner gates (not `npm test`), writes a JSON tree + markdown
 * view next to MASTER_SCORECARD.md. Skip is not PASS. Collection crash is FAIL.
 *
 *   node scripts/assert-master-scorecard.mjs
 *
 * Exit 0 only when every named test is PASS and no required skip remains.
 */
import { execSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outJson = path.join(root, 'golden/journeys/MASTER_SCORECARD_DEBUG.json');
const outMd = path.join(root, 'golden/journeys/MASTER_SCORECARD_DEBUG.md');

const AREAS = {
  Localization: [
    'src/utils/i18n.test.ts',
    'agents/dietitianInstructions.i18n.test.ts',
    'src/utils/auditEngine.i18n.test.ts',
    'src/components/chat-cards/ReceptionistCard.i18n.test.tsx',
    'src/components/ui/AppModal.test.tsx',
  ],
  'Meal Log': [
    'server_portion_clarify.test.ts',
    'server_vision_scout.test.ts',
    'server_edit_patch_ledger.test.ts',
    'server_derivation.test.ts',
    'server_dish_finalize.test.ts',
    'src/utils/nutrients.test.ts',
    'src/utils/nutritionTargetStatus.test.ts',
    'src/components/NutrientPieChart.test.tsx',
    'tests/golden_meals.test.ts',
  ],
  Compare: [
    'src/utils/compareMealLogGuard.test.ts',
    'src/server/food/journeyFingerprints.test.ts',
    'src/server/food/server_food_scout_source.test.ts',
  ],
  Biomarkers: [
    'src/utils/biomarkerLifecycle.test.ts',
    'src/utils/biomarkerIdentity.test.ts',
    'src/utils/biomarkerSanitize.test.ts',
    'src/utils/clinicalCalculators.test.ts',
    'tests/bioProcess.golden.test.ts',
    'tests/golden_biomarker.test.ts',
  ],
  Receptionist: [
    'src/server/receptionist/handoffContract.test.ts',
    'src/server/receptionist/jsonSanitize.test.ts',
    'src/utils/frontDeskRouting.test.ts',
    'src/utils/handoffGuard.test.ts',
    'tests/deskProcess.golden.test.ts',
  ],
  Reliability: [
    'src/jobs/__tests__/JobStore.test.ts',
    'src/jobs/__tests__/JobSession.contract.test.ts',
    'src/jobs/__tests__/SupabaseJobSync.coalesce.test.ts',
    'src/utils/creditManager.test.ts',
    'src/utils/dumpContract.test.ts',
    'src/utils/debugPayload.test.ts',
    'src/utils/syncUtils.regression.test.ts',
    'src/utils/goldenScoreboard.test.ts',
    'src/utils/foodImageSources.test.ts',
    'server_auth.test.ts',
  ],
};

/** Skips in these files are contract FAILs (false-green class). */
const SKIP_IS_FAIL = new Set(['tests/golden_biomarker.test.ts']);

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

function runCmd(label, cmd, args) {
  const r = spawnSync(cmd, args, {
    cwd: root,
    encoding: 'utf8',
    timeout: 120000,
    env: { ...process.env, FORCE_COLOR: '0' },
  });
  const pass = (r.status ?? 1) === 0;
  const err = (r.stderr || r.stdout || '').trim().split('\n').slice(-12).join('\n');
  return {
    id: label,
    kind: 'command',
    file: `${cmd} ${args.join(' ')}`,
    area: label === 'tsc' ? 'Reliability' : label === 'journey-guard' ? 'Reliability' : 'Biomarkers',
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

function normStatus(row) {
  if (row.status === 'skipped' && SKIP_IS_FAIL.has(row.file)) return 'failed';
  return row.status;
}

function badge(s) {
  if (s === 'passed') return 'PASS';
  if (s === 'skipped') return 'SKIP';
  return 'FAIL';
}

function shortMessage(s) {
  const first = String(s || '')
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

const commands = [
  runCmd('tsc', 'npx', ['tsc', '--noEmit']),
  runCmd('journey-guard', 'node', ['scripts/journey-guard.mjs']),
  runCmd('biomarker-lifecycle-m31', 'node', ['scripts/assert-biomarker-lifecycle-m31.mjs']),
];

const rows = [...tests, ...commands].map((r) => {
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
  (r) => r.file === 'tests/golden_biomarker.test.ts' && r.status === 'skipped',
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
        ? 'no required-skip in golden_biomarker'
        : `${skipFalseGreen.length} G-B* tests skipped because tests/Golden_biomarker is missing`,
  },
  {
    law: 'collection_does_not_crash',
    layer: 'process',
    result: tests.some((t) => t.kind === 'file' && t.status === 'failed') ? 'FAIL' : 'PASS',
    actual: tests
      .filter((t) => t.kind === 'file' && t.status === 'failed')
      .map((t) => t.file)
      .join(', ') || 'all named files collected',
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
    host: 'local named gates',
    command: 'node scripts/assert-master-scorecard.mjs',
    vitestFiles,
  },
  counts: {
    pass: passed.length,
    fail: failed.length,
    skip: skipped.length,
    total: rows.length,
  },
  byArea,
  contract,
  tests: rows,
};

fs.mkdirSync(path.dirname(outJson), { recursive: true });
fs.writeFileSync(outJson, JSON.stringify(tree, null, 2));

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
  'Canonical JSON: [`MASTER_SCORECARD_DEBUG.json`](./MASTER_SCORECARD_DEBUG.json). Markdown is a view of that tree. **Skip is not PASS.** Do not cite this file as all-green unless Contract `overall_named_gates` is PASS.',
  '',
  `**When:** ${exportedAt}`,
  `**Commit:** \`${commit}\``,
  `**Command:** \`node scripts/assert-master-scorecard.mjs\``,
  `**Overall:** ${overallPass ? '**ALL GREEN**' : '**NOT ALL GREEN**'} — ${passed.length} pass / ${failed.length} fail / ${skipped.length} skip`,
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
  '- Named gates only. Playwright live specs are not in this dump (quota). See MASTER_SCORECARD §E2E.',
  '- `tests/golden_biomarker.test.ts` skips are scored FAIL (`skip_is_not_pass`).',
  '- Regenerating this file is the refresh for MASTER_SCORECARD automated evidence.',
  '',
].join('\n');

fs.writeFileSync(outMd, md);

console.log(`wrote ${rel(outMd)}`);
console.log(`wrote ${rel(outJson)}`);
console.log(
  `${overallPass ? 'ALL GREEN' : 'NOT ALL GREEN'} ${passed.length} pass / ${failed.length} fail / ${skipped.length} skip`,
);
for (const c of contract.filter((x) => x.result !== 'PASS')) {
  console.error(`FAIL ${c.law}: ${c.actual}`);
}
process.exit(overallPass ? 0 : 1);
