import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { assertReadOnlySql, parseEnvFile, loadD1Config, createD1Reader, resolveProfileUid, parseBiomarkers, parseProfile, QUERIES } from './lib/health/d1.mjs';
import { parseCsvLine, isoDate, mapSheetTest, parseSheetCsv, parseSheetDump, sheetRecord, MARKER_LABELS } from './lib/health/sheet.mjs';
import { extractAppState, reconcile, evaluateFixList, unreviewedAppRows, valuesEqual, FIX_LIST } from './lib/health/reconcile.mjs';
import { KNOWN_PROJECTS, resolveProjectId, resolveRoleId, getProjectRoles, getRoleInstructions, getProjectSoul, seedProjectWorkspace } from './lib/project-registry.mjs';
import { runHealthVerify, runHealthRefresh, runHealthAnalyze, getHealthStatus, renderFixListMarkdown, formatVerifyText, formatStatusText, formatRefreshText, formatAnalyzeText, healthPaths, docsFolder, loadHealthTemplates, loadAnalysisFile } from './health-runner.mjs';
import { DOC_SPECS, SECTION_SOURCES, gateFromArtifact, sectionPlan, unknownSections, renderDoc, renderSection, refusalText, contentHash, planPublish, publishDocs, applyReceipts, loadDocsRegistry, adoptFromListing, exportDocText, readDocText, googleDocsStore, validateAnalysisSections, ANALYSIS_SECTIONS } from './lib/health/docs.mjs';
import { buildHealthContext, renderContextBlock, clipToBudget, CONTEXT_CANDIDATES, CONTEXT_BUDGET } from './lib/health/context.mjs';
import { readWorkspaceContext, contextProviderFor, runCouncilStage, getCouncilStatus, resolveCouncilStage, isCaseProject, LEGACY_CHECKPOINTS } from './council-runner.mjs';
import { checkHealthReadiness, formatReadinessText, STALE_AFTER_DAYS } from './lib/health/readiness.mjs';
import { execFileSync } from 'node:child_process';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
let passed = 0;
let failed = 0;

function check(name, cond, extra = '') {
  if (cond) {
    console.log(`  PASS  ${name}`);
    passed += 1;
  } else {
    console.error(`  FAIL  ${name}${extra ? ` — ${extra}` : ''}`);
    failed += 1;
  }
}
const eq = (name, got, want) => check(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

console.log('assert-external-health:');

// ---------------------------------------------------------------- 1. read-only D1
// The guarantee is that a mutating statement is refused BEFORE any request goes
// out, so the reader is driven with a fetch that records every call.
{
  const refused = [
    ['update biomarker_logs set biomarkers = ?', 'UPDATE'],
    ['delete from biomarker_logs where id = ?', 'DELETE'],
    ['insert into profiles (id) values (?)', 'INSERT'],
    // A SELECT with a second statement hiding behind it is the sneaky one.
    ['select * from profiles; drop table profiles', 'multi'],
    ['pragma table_info(biomarker_logs)', 'PRAGMA'],
    ['', 'empty'],
    ['   ', 'blank'],
    ['-- select nothing', 'comment only'],
  ];
  for (const [sql, name] of refused) {
    const verdict = assertReadOnlySql(sql);
    check(`read-only refuses ${name}`, verdict.ok === false, JSON.stringify(verdict));
  }
  for (const sql of Object.values(QUERIES)) {
    check(`read-only allows the shipped query (${sql.slice(0, 24)}…)`, assertReadOnlySql(sql).ok === true);
  }
  check('every shipped query is a SELECT', Object.values(QUERIES).every((q) => /^select\b/i.test(q.trim())));

  // The reader must not even reach the network for a write.
  let calls = 0;
  const reader = createD1Reader({
    token: 't', databaseId: 'db', accountId: 'acct',
    fetchImpl: async () => { calls += 1; return { ok: true, json: async () => ({ success: true, result: [{ results: [] }] }) }; },
  });
  let refusedError = '';
  try { await reader.query('delete from biomarker_logs'); } catch (err) { refusedError = err.message; }
  check('a write never reaches the network', calls === 0 && /refused non-read query/.test(refusedError), `calls=${calls} error=${refusedError}`);
  await reader.query(QUERIES.profileCounts);
  check('a read does reach the network', calls === 1);

  // The module's own source must contain no mutating SQL literal: a second
  // hand-written query is exactly how a read-only tool grows a write path.
  const d1Source = fs.readFileSync(path.join(ROOT, 'scripts/lib/health/d1.mjs'), 'utf8');
  // A quoted statement that STARTS with a mutating verb is a second, hand-written
  // query — the shape that would quietly grow a write path.
  const mutatingLiterals = [...d1Source.matchAll(/['"`]\s*((?:insert|update|delete|replace|create|drop|alter|attach|pragma|vacuum)\b[^'"`]*)/gi)].map((m) => m[1]);
  check('no mutating SQL literal in d1.mjs', mutatingLiterals.length === 0, mutatingLiterals.join(' | '));
  const sqlLiterals = [...d1Source.matchAll(/['"`]\s*(select\b[^'"`]*)/gi)].map((m) => m[1]);
  check('every SQL literal in d1.mjs is a read', sqlLiterals.length >= 3 && sqlLiterals.every((s) => assertReadOnlySql(s).ok), sqlLiterals.join(' | '));
}

// ---------------------------------------------------------------- 2. profile/uid resolution
{
  const counts = [
    { firebase_uid: 'real', rows: 41 },
    { firebase_uid: 'legacy_a', rows: 8 },
    { firebase_uid: 'legacy_b', rows: 2 },
    { firebase_uid: 'empty', rows: 0 },
  ];
  const picked = resolveProfileUid({ counts });
  eq('uid resolution picks the profile with lab rows', [picked.uid, picked.source, picked.rows], ['real', 'most-lab-rows', 41]);
  eq('uid resolution names the ids it did not pick', picked.others.map((o) => o.uid), ['legacy_a', 'legacy_b']);
  eq('explicit uid wins', resolveProfileUid({ counts, explicit: 'legacy_a' }).uid, 'legacy_a');
  eq('no rows means no uid', resolveProfileUid({ counts: [] }).uid, '');
  eq('biomarkers blob parses, junk reads as empty', [parseBiomarkers('{"a":1}'), parseBiomarkers('nope')], [{ a: 1 }, {}]);
  eq('profile parses out of the data column', parseProfile('{"profile":{"height":163}}').height, 163);
}

// ---------------------------------------------------------------- 3. sheet parsing
{
  eq('csv line unwraps doubled quotes', parseCsvLine('"a","b ""q""",""'), ['a', 'b "q"', '']);
  eq('isoDate converts a lab date', isoDate('09-Jun-2026'), '2026-06-09');
  eq('isoDate rejects junk', isoDate('2026-06-09'), '');
  eq('marker map translates a lab name', mapSheetTest('Haemoglobin estimation').key, 'hemoglobin');
  eq('marker map marks panel headers to skip', mapSheetTest('Renal profile').skip, true);
  eq('marker map marks GPPAQ as a gap', mapSheetTest('GPPAQ usual level of walking pace - fast').key, 'gppaq_activity');
  eq('marker map marks an unknown test', mapSheetTest('Made up test').unknown, true);

  // The sheet's real shape: a quoted CSV line inside the first cell.
  const csv = [
    '"\"05-Jun-2026\",\"HbA1c levl - IFCC standardised\",\"40 mmol/mol\",\"20 - 41 mmol/mol\",\"(M.Tahir) - Normal\""',
    '"\"05-Jun-2026\",\"Serum creatinine\",\"100 umol/L\",\"64 - 104 umol/L\",\"\"",""',
    '"\"05-Jun-2026\",\"Renal profile\",\"\",\"\",\"\""',
    '"\"Date\",\"Test Name\",\"Result\",\"Normal Range\",\"Comment\""',
  ].join('\n');
  const parsed = parseSheetCsv(csv);
  eq('sheet csv keeps the rows and marks the panel header', [parsed.length, parsed[2].map.skip === true], [3, true]);
  eq('sheet csv maps hba1c', [parsed[0].key ?? parsed[0].map.key, parsed[0].value, parsed[0].date], ['hba1c', 40, '2026-06-05']);
  eq('sheet csv keeps units', parsed[1].unit, 'umol/L');

  const dump = parseSheetDump(JSON.stringify({
    source: { title: 'Medical Test Results - Chiwah', fetchedAt: '2026-09-30T18:33:28.031Z' },
    data: { 'Medical Test Results - Chiwah': [['"05-Jun-2026","Body weight","62.4 kg","",""']], 'Feuille 1': [['x']] },
  }));
  eq('dump picks the results tab by name', dump.tab, 'Medical Test Results - Chiwah');
  eq('dump parses its one row', [dump.rows.length, dump.rows[0].map.key, dump.rows[0].value], [1, 'weight', 62.4]);
  eq('a qualitative row keeps its word', sheetRecord(['03-Apr-2024', 'HUB HIV-1 AND 2 ANTIBODY / ANTIGEN', '', '', 'NEGATIVE']).value, 'NEGATIVE');
}

// ---------------------------------------------------------------- 4. the diff
const sheetRows = parseSheetCsv([
  '"\"05-Jun-2026\",\"HbA1c levl - IFCC standardised\",\"40 mmol/mol\",\"20 - 41 mmol/mol\",\"\"",""',
  '"\"05-Jun-2026\",\"Serum creatinine\",\"100 umol/L\",\"64 - 104 umol/L\",\"\"",""',
  '"\"05-Jun-2026\",\"Haemoglobin estimation\",\"166 g/L\",\"130 - 180 g/L\",\"\"",""',
  '"\"25-Jun-2025\",\"Serum cholesterol\",\"5.7 mmol/L\",\"< 5.2 mmol/L\",\"\"",""',
  '"\"23-Oct-2024\",\"Body weight\",\"62 kg\",\"\",\"\"",""',
  '"\"27-Mar-2024\",\"Blood Pressure\",\"109 / 53 mmHg\",\"\",\"\"",""',
].join('\n'));

const brokenRows = [
  { id: 'row_ok', date: '2026-06-05', biomarkers: JSON.stringify({ hba1c: 40, creatinine: 100 }) },
  { id: 'row_misfiled', date: '2026-05-05', biomarkers: JSON.stringify({ hemoglobin: 166, total_cholesterol: 5.7 }) },
  { id: 'row_dup_a', date: '2024-10-23', biomarkers: JSON.stringify({ weight: 62 }) },
  { id: 'row_dup_b', date: '2024-10-23', biomarkers: JSON.stringify({ weight: 62 }) },
  { id: 'row_empty', date: '2026-07-30', biomarkers: '{}' },
  // A value the sheet never mentions, on a date after the sheet ends: the one
  // class the fix list cannot resolve from the data, only from the user.
  { id: 'row_unexplained', date: '2026-07-08', biomarkers: JSON.stringify({ qrisk2: 1.2 }) },
];

{
  const appState = extractAppState(brokenRows);
  const report = reconcile({ sheetRows, appState });
  eq('diff finds the exact matches', report.summary.match, 3);
  eq('diff sees the mis-filed row as a date mismatch', report.summary.dateMismatch, 2);
  eq('diff sees the missing sheet value', report.summary.missing, 1);
  eq('diff finds both duplicate dates', report.structural.duplicateDates.map((d) => d.date), ['2024-10-23']);
  eq('diff finds the empty row', report.structural.emptyRows.map((r) => r.id), ['row_empty']);
  eq('duplicate groups name the identical copies', report.structural.duplicateGroups[0].groups.find((g) => g.ids.length > 1).ids, ['row_dup_a', 'row_dup_b']);
  eq('the mis-filed app row is clustered', Object.keys(report.clusters), ['row_misfiled']);
  eq('the cluster names both sheet dates', Object.keys(report.clusters.row_misfiled.bySourceDate).sort(), ['2025-06-25', '2026-06-05']);
  eq('unexplained app rows are the ones with no sheet line', unreviewedAppRows(report).map((v) => v.key), ['qrisk2']);
  check('composite values compare by their numbers', valuesEqual('109/53', '109 / 53 mmHg') && !valuesEqual('109/53', '120/80'));
  check('the app row newer than the sheet is visible', report.app.newerThanSheet.includes('2026-07-08'), JSON.stringify(report.app.newerThanSheet));
  // A test name the map does not know must be counted, not dropped: the lab
  // adding a test is normal, and a silent skip understates the whole diff.
  const withUnknown = reconcile({
    sheetRows: [...sheetRows, sheetRecord(['02-Feb-2026', 'Brand new assay', '5 units', '', ''])],
    appState: extractAppState(brokenRows),
  });
  eq('an unmapped test is reported, not dropped', withUnknown.sheet.unmapped, [{ test: 'Brand new assay', count: 1 }]);
  eq('the sheet keeps the GPPAQ gap visible', mapSheetTest('GPPAQ hours in last week spent cycling - none').gap, true);

  const evaluation = evaluateFixList({ report, profile: { age: 28, height: 178, weight: 74 } });
  eq('every fix-list id is present', evaluation.items.map((i) => i.id), FIX_LIST.map((i) => i.id));
  // Seven of the eight fire on the real defect set; H-5 is the one the demo data
  // does not contain, which is itself the check that the items are not all wired
  // to the same predicate.
  eq('the demo data leaves seven items open', [evaluation.open, evaluation.closed], [7, 1]);
  eq('the one closed item is the same-date conflict check', evaluation.items.find((i) => i.state === 'closed').id, 'H-5');
  eq('the next action is the first open item', evaluation.nextAction.id, 'H-1');
  const byId = Object.fromEntries(evaluation.items.map((i) => [i.id, i]));
  eq('H-1 catches the placeholder demographics', byId['H-1'].state, 'open');
  check('H-1 names the sheet value it disagrees with', byId['H-1'].detail.includes('62'), byId['H-1'].detail);
  eq('H-4 names the mis-filed row', byId['H-4'].state, 'open');
  check('H-4 detail names the wrong date', byId['H-4'].detail.includes('2026-05-05'), byId['H-4'].detail);
  eq('H-3 sees the empty row', byId['H-3'].state, 'open');
  eq('H-8 sees the app row newer than the sheet', byId['H-8'].state, 'open');

  // ---- the same data, fixed: every item must flip. A predicate that cannot
  // flip is the bug this sensor exists for.
  const fixedRows = [
    { id: 'row_ok', date: '2026-06-05', biomarkers: JSON.stringify({ hba1c: 40, creatinine: 100, hemoglobin: 166 }) },
    { id: 'row_lipids', date: '2025-06-25', biomarkers: JSON.stringify({ total_cholesterol: 5.7 }) },
    { id: 'row_w', date: '2024-10-23', biomarkers: JSON.stringify({ weight: 62 }) },
    // The app's own spelling of a composite value, against the lab report's.
    { id: 'row_bp', date: '2024-03-27', biomarkers: JSON.stringify({ blood_pressure: '109/53' }) },
  ];
  const fixedProfile = { age: 43, height: 163, weight: 62, dateOfBirth: '1983-06-15' };
  const fixedReport = reconcile({ sheetRows, appState: extractAppState(fixedRows) });
  const fixedEval = evaluateFixList({ report: fixedReport, profile: fixedProfile });
  eq('the fixed data closes every item', fixedEval.open, 0);
  eq('the fixed data has no unexplained rows', unreviewedAppRows(fixedReport).length, 0);
  eq('the fixed data matches every sheet value', [fixedReport.summary.match, fixedReport.summary.missing], [6, 0]);
  check('the fixed data has no open fix-list detail left', fixedEval.items.every((i) => i.state === 'closed'));
  const waived = evaluateFixList({ report: fixedReport, profile: fixedProfile, waived: ['H-8'] });
  eq('a waived item stays visible as waived', waived.items.find((i) => i.id === 'H-8').state, 'waived');
  eq('a waiver is not counted as closed', [waived.closed, waived.waived], [7, 1]);
}

// ---------------------------------------------------------------- 5. the verify run, end to end
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'health-verify-'));
  fs.mkdirSync(path.join(dir, 'sources'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'sources', 'sheet_2026-09-30.json'), JSON.stringify({
    source: { title: 'Medical Test Results - Chiwah', fetchedAt: '2026-09-30T18:33:28.031Z' },
    data: { 'Medical Test Results - Chiwah': sheetRows.map((r) => [`"${r.dateRaw}","${r.test}","${r.resultRaw}","${r.range}","${r.comment}"`]) },
  }));
  fs.writeFileSync(path.join(dir, '.env'), 'CLOUDFLARE_API_TOKEN=tok\nCLOUDFLARE_D1_DATABASE_ID=dbb\n');

  const env = { CLOUDFLARE_API_TOKEN: 'tok', CLOUDFLARE_D1_DATABASE_ID: 'dbb', HEALTH_PROFILE_UID: 'real' };
  const fetchImpl = async (url, init = {}) => {
    const json = (body) => ({ ok: true, status: 200, json: async () => body });
    if (String(url).includes('/accounts?per_page=1')) return json({ success: true, result: [{ id: 'acct' }] });
    const payload = JSON.parse(init.body || '{}');
    if (/from biomarker_logs group by firebase_uid/.test(payload.sql)) {
      return json({ success: true, result: [{ results: [{ firebase_uid: 'real', rows: 3 }] }] });
    }
    if (/from profiles/.test(payload.sql)) {
      return json({ success: true, result: [{ results: [{ id: 'p', firebase_uid: 'real', data: JSON.stringify({ profile: { age: 28, height: 178, weight: 74 } }) }] }] });
    }
    if (/from biomarker_logs/.test(payload.sql)) {
      return json({ success: true, result: [{ results: fixedRows0() }] });
    }
    return json({ success: false, errors: [{ message: `unexpected sql: ${payload.sql}` }] });
  };
  function fixedRows0() {
    return [
      { id: 'row_ok', firebase_uid: 'real', date: '2026-06-05', biomarkers: JSON.stringify({ hba1c: 40, creatinine: 100, hemoglobin: 166 }), note: '' },
      { id: 'row_lipids', firebase_uid: 'real', date: '2025-06-25', biomarkers: JSON.stringify({ total_cholesterol: 5.7 }), note: '' },
      { id: 'row_w', firebase_uid: 'real', date: '2024-10-23', biomarkers: JSON.stringify({ weight: 62 }), note: '' },
      { id: 'row_bp', firebase_uid: 'real', date: '2024-03-27', biomarkers: JSON.stringify({ blood_pressure: '109 / 53 mmHg' }), note: '' },
    ];
  }

  const res = await runHealthVerify({ workspace: dir, env, fetchImpl, now: new Date('2026-10-01T09:00:00Z') });
  check('verify runs end to end with fixtures', res.ok === true, res.error || '');
  if (res.ok) {
    eq('verify resolves the profile from the data', res.artifact.profile.uid, 'real');
    eq('verify keeps the one open item', [res.artifact.fixList.open, res.artifact.fixList.items.find((i) => i.id === 'H-1').state], [1, 'open']);
    eq('the verify run keeps every sheet value matched', [res.artifact.summary.match, res.artifact.summary.missing], [6, 0]);
    eq('verify reads the banked sheet', res.artifact.sheet.rows, 6);
    check('verify writes its artifacts into the workspace', fs.existsSync(path.join(dir, 'result', 'health-verify.json')) && fs.existsSync(path.join(dir, 'result', 'health-fix-list.md')));
    const md = renderFixListMarkdown(res.artifact);
    check('the fix list markdown is the same verdict', md.includes('[ ] **H-1') && md.includes('[x] **H-6'), md.slice(0, 200));
    const text = formatVerifyText(res.artifact);
    check('the bot reply carries the profile and the item count', text.includes('real') && /Fix list: \d+ closed/.test(text), text.slice(0, 160));
    const status = getHealthStatus({ workspace: dir, env });
    check('status reads the last verify', status.verify?.profile?.uid === 'real');
    check('status says the docs are not published', status.docs.published === false);
    check('status reply names the next action', formatStatusText(status).includes('Next:'));
  }

  // Failures must be honest, not a silent empty report.
  const noSheet = await runHealthVerify({ workspace: fs.mkdtempSync(path.join(os.tmpdir(), 'health-nosrc-')), env, fetchImpl });
  check('verify fails closed when no sheet is banked', noSheet.ok === false && noSheet.stage === 'sources', JSON.stringify(noSheet));
  const noCred = await runHealthVerify({ workspace: dir, env: {}, fetchImpl });
  check('verify fails closed without a token', noCred.ok === false && noCred.stage === 'config', JSON.stringify(noCred));

  // A refused write at the runner's own boundary, driven through the same guard.
  eq('env files are parsed like the server parses them', parseEnvFile('export A=1\nB="two"\n# c\n').B, 'two');
  eq('loadD1Config reads a missing token as a refusal', loadD1Config({ env: {}, envFile: '/nope/.env', readFile: () => { throw new Error('ENOENT'); } }).ok, false);
  fs.rmSync(dir, { recursive: true, force: true });
}

// ---------------------------------------------------------------- 6. the project is wired
{
  const project = KNOWN_PROJECTS['external-health'];
  check('external-health is a registered project', Boolean(project), 'missing from KNOWN_PROJECTS');
  eq('it is an external project', project?.type, 'external');
  eq('it can never touch the website repo', project?.allowGit, false);
  eq('its template dir is committed', path.relative(ROOT, project?.templateDir || ''), 'projects/external-health');
  check('its workspace is the brief project folder', /projects\/external-health-coach$/.test(project?.workspace || ''), project?.workspace);
  eq('its Drive folder is named', project?.gdriveFolder, 'External-Personal-Health-Coach');
  eq('it declares its seat context provider', project?.contextProvider, 'health');

  for (const alias of ['health', 'health coach', 'personal health', 'external health', 'external-health', 'coach']) {
    eq(`/project ${alias} resolves`, resolveProjectId(alias), 'external-health');
  }
  eq('the website aliases still mean the website', [resolveProjectId('ht'), resolveProjectId('1')], ['health-tracker', 'health-tracker']);
  eq('python/junk still rejected', resolveProjectId('banana'), null);

  const roles = getProjectRoles('external-health').map((r) => r.id).sort();
  eq('the five seats are loadable from the committed roles dir', roles, ['data_steward', 'health_analyst', 'research_lead', 'safety_reviewer', 'test_planner']);
  for (const [alias, id] of [['steward', 'data_steward'], ['analyst', 'health_analyst'], ['planner', 'test_planner'], ['research', 'research_lead'], ['safety', 'safety_reviewer']]) {
    eq(`/role ${alias} resolves`, resolveRoleId(alias, 'external-health'), id);
  }
  const inst = getRoleInstructions('external-health', 'safety_reviewer') || '';
  check('the safety seat carries its mandate', /strike|no diagnosis/i.test(inst), inst.slice(0, 80));
  check('the analyst seat respects the data gate', /data gate|fix-list item is open/i.test(getRoleInstructions('external-health', 'health_analyst') || ''));
  const soul = getProjectSoul('external-health') || '';
  check('the shared soul states the source of truth', /source of truth/i.test(soul));
  check('the shared soul forbids writing the data', /read-only|Nothing here writes/i.test(soul));
  check('the charter names the four documents', ['Health Snapshot', 'Conditions & Actions', 'Test Plan', 'Medical Insights'].every((d) => (fs.readFileSync(path.join(project.templateDir, 'charter.md'), 'utf8') + fs.readdirSync(path.join(project.templateDir, 'templates')).join(' ')).includes(d.split(' ')[0])));
  check('every role file exists', getProjectRoles('external-health').every((r) => fs.existsSync(path.join(project.templateDir, 'roles', r.file))));

  // Seeding must not overwrite a workspace that already holds sources.
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'health-seed-'));
  const original = project.workspace;
  project.workspace = scratch;
  fs.mkdirSync(path.join(scratch, 'sources'), { recursive: true });
  fs.writeFileSync(path.join(scratch, 'sources', 'keep.json'), '{"keep":true}');
  seedProjectWorkspace('external-health');
  check('seeding leaves existing sources alone', fs.readFileSync(path.join(scratch, 'sources', 'keep.json'), 'utf8') === '{"keep":true}');
  check('seeding copies the deliverable templates', fs.existsSync(path.join(scratch, '01_Health_Snapshot.md')) || fs.existsSync(path.join(scratch, 'templates')), fs.readdirSync(scratch).join(','));
  project.workspace = original;
  fs.rmSync(scratch, { recursive: true, force: true });

  const paths = healthPaths('external-health', { env: {} });
  check('paths point at the workspace, not at the repo', !paths.workspace.startsWith(ROOT), paths.workspace);
  check('every marker label is human-readable', Object.values(MARKER_LABELS).every((v) => typeof v === 'string' && v.length > 0));
}

// ---------------------------------------------------------------- 7. the four documents
const TEMPLATE_DIR = path.join(ROOT, 'projects/external-health/templates');
const readTemplates = () => Object.fromEntries(DOC_SPECS.map((s) => [s.key, fs.readFileSync(path.join(TEMPLATE_DIR, s.template), 'utf8')]));

const FIX_TITLES = {
  'H-1': 'Profile demographics match the sheet',
  'H-2': 'One app row per date (no duplicate rows)',
  'H-3': 'No empty app rows',
  'H-4': 'No app row carries another date’s results',
  'H-5': 'No value disagrees with the sheet on the same date',
  'H-6': 'Every sheet value is present in the app',
  'H-7': 'No unexplained app rows',
  'H-8': 'No app results newer than the sheet',
};
const fixtureArtifact = (state = 'open') => ({
  at: '2026-10-01T09:00:00.000Z',
  projectId: 'external-health',
  profile: { uid: 'real', rows: 41, source: 'most-lab-rows', fields: { age: 28, height: 178, weight: 74 } },
  sheet: {
    file: '/tmp/sources/medical-test-results-chiwah_2026-09-30_19-32-41.json',
    title: 'Medical Test Results - Chiwah',
    tab: 'Medical Test Results - Chiwah',
    fetchedAt: '2026-09-30T19:32:41.000Z',
    rows: 140,
    dates: Array.from({ length: 14 }, (_, i) => `2026-06-${String(i + 1).padStart(2, '0')}`),
    newestDate: '2026-06-09',
    unmapped: [{ test: 'Brand new assay', count: 1 }],
  },
  app: { rows: 41, newestDate: '2026-09-06', newerThanSheet: ['2026-07-08', '2026-09-06'] },
  matches: [
    { key: 'hba1c', label: 'HbA1c', value: 40, unit: 'mmol/mol', date: '2026-06-05' },
    { key: 'creatinine', label: 'Creatinine', value: 100, unit: 'umol/L', date: '2026-06-05' },
  ],
  missing: [{ key: 'ldl', label: 'LDL', value: 2.1, unit: 'mmol/L', date: '2026-06-03' }],
  appOnly: [{ key: 'hba1c', label: 'HbA1c', value: 40, date: '2026-07-08' }],
  gaps: [{ date: '2026-06-05', test: 'GPPAQ usual level of walking pace - fast' }],
  fixList: {
    closed: state === 'open' ? 0 : 8,
    open: state === 'open' ? 8 : 0,
    waived: 0,
    items: Object.entries(FIX_TITLES).map(([id, title]) => ({ id, title, state: state === 'open' ? 'open' : 'closed', detail: state === 'open' ? `${title} — one detail line` : '' })),
    nextAction: state === 'open' ? { id: 'H-1', title: FIX_TITLES['H-1'] } : null,
  },
});

const ANALYSIS_MARKER = 'HBA1C-TREND-CLAIM-MARKER';
const analysisPayload = () => Object.fromEntries(
  Object.values(SECTION_SOURCES).filter((s) => s.startsWith('analysis.')).map((s) => [s, [`- ${ANALYSIS_MARKER}: HbA1c 39 (2026-03-04) → 40 (2026-06-05), +1 mmol/mol.`]]),
);

/** A fake store: records every call, so create/update/skip is judged on what was asked. */
function fakeStore({ missing = new Set(), listing = [], preloaded = {}, idPrefix = 'doc_' } = {}) {
  const calls = [];
  const files = { ...preloaded };
  let seq = 0;
  return {
    calls,
    files,
    async create(folderId, title, text, token) {
      seq += 1;
      const id = `${idPrefix}${seq}`;
      calls.push({ op: 'create', folderId, title, text, token, id });
      files[id] = text;
      return { ok: true, id, title, modifiedTime: `2026-10-01T09:0${seq}:00.000Z` };
    },
    async replace(docId, text, token) {
      calls.push({ op: 'replace', docId, text, token });
      files[docId] = text;
      return { ok: true, id: docId, modifiedTime: '2026-10-01T10:00:00.000Z' };
    },
    async stat(docId) {
      calls.push({ op: 'stat', docId });
      return missing.has(docId) ? { ok: false, missing: true, status: 404, error: 'File not found' } : { ok: true, file: { id: docId } };
    },
    async read(docId) {
      calls.push({ op: 'read', docId });
      return files[docId] === undefined ? { ok: false, error: 'File not found' } : { ok: true, bytes: Buffer.from(files[docId]) };
    },
    async list() {
      calls.push({ op: 'list' });
      return { ok: true, files: listing };
    },
  };
}

{
  const templates = readTemplates();
  // Every template heading must have a renderer, or a template edit silently
  // drops a section from the published document.
  for (const spec of DOC_SPECS) {
    eq(`${spec.title}: every template section has a source`, unknownSections(templates[spec.key]), []);
    check(`${spec.title}: the template declares sections`, sectionPlan(templates[spec.key]).length >= 3, String(sectionPlan(templates[spec.key]).length));
  }
  eq('an unknown template section is refused', renderDoc({ spec: DOC_SPECS[0], templateText: '# t\n\n## A section nobody mapped\n', artifact: fixtureArtifact(), registry: {} }).ok, false);

  const open = fixtureArtifact('open');
  const openGate = gateFromArtifact(open);
  check('the gate is closed only when nothing is open', openGate.allowed === false && openGate.open.length === 8, JSON.stringify(openGate));
  check('a waived item is not an open item', gateFromArtifact({ fixList: { items: [{ id: 'H-1', state: 'waived' }, { id: 'H-2', state: 'closed' }] } }).allowed === true);

  const snapshot = renderDoc({ spec: DOC_SPECS[0], templateText: templates.snapshot, artifact: open, analysis: analysisPayload(), registry: {}, now: new Date('2026-10-01T09:00:00Z') });
  check('the snapshot renders', snapshot.ok === true, snapshot.error || '');
  check('the header carries the pending-gate banner', /DRAFT — the data gate is OPEN \(8 items: H-1/.test(snapshot.text), snapshot.text.split('\n').slice(0, 3).join(' | '));
  check('the header carries dated provenance', snapshot.text.includes('medical-test-results-chiwah_2026-09-30_19-32-41.json') && snapshot.text.includes('real') && snapshot.text.includes('2026-10-01'), 'provenance missing');
  check('the header names the open items', snapshot.text.includes('(H-1, H-2, H-3, H-4, H-5, H-6, H-7, H-8)'), 'item list missing');
  check('data sections still render the verified facts', snapshot.text.includes('HbA1c 40 mmol/mol — 2026-06-05') && snapshot.text.includes('LDL: the sheet has 1 value'), 'data sections missing');
  eq('the snapshot has no analysis section to refuse (it is the data document)', snapshot.refused, []);

  // Conditions & Actions is where the refusal has to be visible.
  const conditionsOpen = renderDoc({ spec: DOC_SPECS[1], templateText: templates.conditions, artifact: open, analysis: analysisPayload(), registry: {}, now: new Date('2026-10-01T09:00:00Z') });
  eq('every analysis section of the conclusions document is refused', conditionsOpen.refused.length, 4);
  check('the refusal names the open items', conditionsOpen.text.includes(refusalText(openGate)), 'refusal text missing');
  check('no analysis content reaches an open-gate document', !conditionsOpen.text.includes(ANALYSIS_MARKER), 'the payload leaked into a draft');
  check('the refusal is in the published bytes, not just in the metadata', conditionsOpen.text.split('\n').filter((l) => l.includes('Not published while the data gate is open')).length === 4, 'refusal sentence count wrong');

  // The read-back is the proof path, and alt=media is refused for Docs files
  // (live 403). It must go through the export endpoint.
  const exported = await exportDocText('doc_1', 't', { fetchImpl: async (url) => ({ ok: true, status: 200, text: async () => `read from ${url}` }) });
  check('the read-back exports a Doc instead of using alt=media', exported.ok && exported.bytes.toString('utf8').includes('/export?mimeType=text%2Fplain'), exported.bytes?.toString('utf8'));
  const refusedExport = await exportDocText('doc_1', 't', { fetchImpl: async () => ({ ok: false, status: 403, text: async () => 'nope' }) });
  check('a refused export is reported, not thrown', refusedExport.ok === false && refusedExport.status === 403, JSON.stringify(refusedExport));
  check('the real store reads through that export path', googleDocsStore().read === exportDocText);
  eq('readDocText hands back the document text', (await readDocText('doc_1', { token: 't', store: fakeStore({ preloaded: { doc_1: 'the bytes' } }) })).text, 'the bytes');

  const insights = renderDoc({ spec: DOC_SPECS[3], templateText: templates.insights, artifact: open, analysis: analysisPayload(), registry: {}, now: new Date('2026-10-01T09:00:00Z') });
  check('the renewal log is dated history, not analysis', /\| 2026-10-01 \| documents published — 8 fix-list item\(s\) open at the time \|/.test(insights.text), insights.text.slice(-240));
  check('a reappearance of the same day does not change the log', renderDoc({ spec: DOC_SPECS[3], templateText: templates.insights, artifact: open, analysis: analysisPayload(), registry: { renewals: { insights: { '2026-10-01': { open: 8 } } } }, now: new Date('2026-10-01T18:00:00Z') }).hash === insights.hash, 'renewal log is not stable within a day');

  // The same payload with the gate closed: the refusal lifts, the analysis renders.
  const closed = fixtureArtifact('closed');
  const closedDoc = renderDoc({ spec: DOC_SPECS[1], templateText: templates.conditions, artifact: closed, analysis: analysisPayload(), registry: {}, now: new Date('2026-10-01T09:00:00Z') });
  check('a closed gate publishes the analysis', closedDoc.ok && closedDoc.text.includes(ANALYSIS_MARKER) && closedDoc.refused.length === 0, JSON.stringify(closedDoc.refused || []));
  check('a closed gate says so in the header', /Data gate closed/.test(closedDoc.text), closedDoc.text.split('\n')[2]);
  check('the same inputs give the same hash', contentHash(snapshot.text) === contentHash(snapshot.text) && snapshot.hash.length === 16);
}

// ---------------------------------------------------------------- 8. idempotent publishing
{
  const templates = readTemplates();
  const artifact = fixtureArtifact('open');
  const at = new Date('2026-10-01T09:00:00Z');

  const first = planPublish({ artifact, analysis: analysisPayload(), templates, registry: { docs: {}, history: [] }, now: at });
  eq('a fresh registry plans four creates', first.items.map((i) => i.action), ['create', 'create', 'create', 'create']);
  eq('the run is a draft while the gate is open', first.mode, 'draft');

  const store = fakeStore();
  const run1 = await publishDocs({ items: first.items, token: 't', folderId: 'folder1', store });
  eq('the first publish creates four documents', [run1.created, run1.updated, run1.skipped, run1.failed], [4, 0, 0, 0]);
  eq('the fake store saw four creates', store.calls.filter((c) => c.op === 'create').length, 4);
  const registry1 = applyReceipts({ docs: {}, history: [] }, run1.receipts, { now: at, folderId: 'folder1', projectId: 'external-health' });
  eq('the registry holds one id per document', Object.keys(registry1.docs).sort(), ['conditions', 'insights', 'snapshot', 'test_plan']);
  check('every id came back from the store', Object.values(registry1.docs).every((d) => /^doc_\d+$/.test(d.id)), JSON.stringify(registry1.docs));
  eq('the renewal log grew four entries', registry1.history.length, 4);
  check('the published bytes carry the refusal, not the analysis', !store.files[registry1.docs.snapshot.id].includes(ANALYSIS_MARKER) && store.files[registry1.docs.snapshot.id].includes('DRAFT — the data gate is OPEN'), 'published bytes wrong');

  // Second run, same inputs: nothing is written and no second file appears.
  const beforeCalls = store.calls.length;
  const second = planPublish({ artifact, analysis: analysisPayload(), templates, registry: registry1, now: new Date('2026-10-01T11:30:00Z') });
  eq('a same-day rerun plans four skips', second.items.map((i) => i.action), ['skip', 'skip', 'skip', 'skip']);
  const run2 = await publishDocs({ items: second.items, token: 't', folderId: 'folder1', store });
  eq('a rerun writes nothing', [run2.created, run2.updated, run2.skipped], [0, 0, 4]);
  eq('a rerun asks the store for nothing', store.calls.length, beforeCalls);
  const idsOf = (reg) => Object.values(reg.docs).map((d) => d.id).sort();
  eq('a rerun keeps the same doc ids', idsOf(registry1), idsOf(applyReceipts(registry1, run2.receipts, { now: at, folderId: 'folder1' })));

  // A real input change (one item waived) must update in place, never duplicate.
  const waivedArtifact = { ...artifact, fixList: { ...artifact.fixList, waived: 1, items: artifact.fixList.items.map((i) => (i.id === 'H-3' ? { ...i, state: 'waived' } : i)) } };
  const third = planPublish({ artifact: waivedArtifact, analysis: analysisPayload(), templates, registry: registry1, now: at });
  eq('a changed fix list plans four updates', third.items.map((i) => i.action), ['update', 'update', 'update', 'update']);
  const run3 = await publishDocs({ items: third.items, token: 't', folderId: 'folder1', store });
  eq('the update is in place, not a second file', [run3.created, run3.updated], [0, 4]);
  eq('the replace calls name the ids the registry already had', store.calls.filter((c) => c.op === 'replace').map((c) => c.docId).sort(), Object.values(registry1.docs).map((d) => d.id).sort());
  const registry3 = applyReceipts(registry1, run3.receipts, { now: at, folderId: 'folder1' });
  eq('the ids are unchanged after an update', Object.entries(registry3.docs).map(([k, v]) => [k, v.id]), Object.entries(registry1.docs).map(([k, v]) => [k, v.id]));
  check('the waived item shows in the updated bytes', store.files[registry3.docs.snapshot.id].includes('H-3'), 'waiver not reflected');

  // A doc the human deleted is recreated, not patched into a 404.
  const gone = fakeStore({ missing: new Set([registry1.docs.snapshot.id]), idPrefix: 'new_' });
  const fourth = planPublish({ artifact: waivedArtifact, analysis: analysisPayload(), templates, registry: registry1, now: new Date('2026-10-02T09:00:00Z') });
  const run4 = await publishDocs({ items: fourth.items, token: 't', folderId: 'folder1', store: gone });
  eq('a deleted document is recreated', run4.receipts.find((r) => r.key === 'snapshot').action, 'recreate');
  check('the recreated document got a new id', run4.receipts.find((r) => r.key === 'snapshot').docId !== registry1.docs.snapshot.id);

  // Adoption: a registry that lost its ids must not mint twins of docs that exist.
  const listing = [{ id: 'existing_snapshot', name: 'Health Snapshot', mimeType: 'application/vnd.google-apps.document' }];
  const adopted = adoptFromListing(listing);
  eq('adoption finds a document by title', adopted, { snapshot: 'existing_snapshot' });
  const adoptStore = fakeStore({ listing, preloaded: { existing_snapshot: 'old bytes' } });
  const fifth = planPublish({ artifact, analysis: analysisPayload(), templates, registry: { docs: {}, history: [] }, now: at });
  for (const item of fifth.items) if (adopted[item.key]) { item.docId = adopted[item.key]; item.action = 'update'; }
  const run5 = await publishDocs({ items: fifth.items, token: 't', folderId: 'folder1', store: adoptStore });
  eq('an adopted document is updated, not created twice', run5.receipts.find((r) => r.key === 'snapshot').action, 'update');
  eq('adoption still creates the three the folder did not have', [run5.created, run5.updated], [3, 1]);
}

// ---------------------------------------------------------------- 9. refresh and analyze, end to end
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'health-refresh-'));
  fs.mkdirSync(path.join(dir, 'sources'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'sources', 'sheet_2026-09-30.json'), JSON.stringify({
    source: { title: 'Medical Test Results - Chiwah', fetchedAt: '2026-09-30T18:33:28.031Z' },
    data: { 'Medical Test Results - Chiwah': sheetRows.map((r) => [`"${r.dateRaw}","${r.test}","${r.resultRaw}","${r.range}","${r.comment}"`]) },
  }));
  const env = { CLOUDFLARE_API_TOKEN: 'tok', CLOUDFLARE_D1_DATABASE_ID: 'dbb', HEALTH_PROFILE_UID: 'real', HEALTH_DOCS_FOLDER: 'folder1' };
  const sheetFixture = () => [
    { id: 'row_ok', firebase_uid: 'real', date: '2026-06-05', biomarkers: JSON.stringify({ hba1c: 40, creatinine: 100 }), note: '' },
    { id: 'row_bp', firebase_uid: 'real', date: '2024-03-27', biomarkers: JSON.stringify({ blood_pressure: '109 / 53 mmHg' }), note: '' },
  ];
  // The whole sheet, so a closed gate is reachable; the two-row subset leaves
  // H-6 open, which is the fixture the draft path is judged on.
  const fullFixture = () => [
    { id: 'row_ok', firebase_uid: 'real', date: '2026-06-05', biomarkers: JSON.stringify({ hba1c: 40, creatinine: 100, hemoglobin: 166 }), note: '' },
    { id: 'row_lipids', firebase_uid: 'real', date: '2025-06-25', biomarkers: JSON.stringify({ total_cholesterol: 5.7 }), note: '' },
    { id: 'row_w', firebase_uid: 'real', date: '2024-10-23', biomarkers: JSON.stringify({ weight: 62 }), note: '' },
    { id: 'row_bp', firebase_uid: 'real', date: '2024-03-27', biomarkers: JSON.stringify({ blood_pressure: '109 / 53 mmHg' }), note: '' },
  ];
  const makeFetch = (profile, rows = sheetFixture) => async (url, init = {}) => {
    const json = (body) => ({ ok: true, status: 200, json: async () => body });
    if (String(url).includes('/accounts?per_page=1')) return json({ success: true, result: [{ id: 'acct' }] });
    const payload = JSON.parse(init.body || '{}');
    if (/from biomarker_logs group by firebase_uid/.test(payload.sql)) return json({ success: true, result: [{ results: [{ firebase_uid: 'real', rows: rows().length }] }] });
    if (/from profiles/.test(payload.sql)) return json({ success: true, result: [{ results: [{ id: 'p', firebase_uid: 'real', data: JSON.stringify({ profile }) }] }] });
    if (/from biomarker_logs/.test(payload.sql)) return json({ success: true, result: [{ results: rows() }] });
    return json({ success: false, errors: [{ message: `unexpected sql: ${payload.sql}` }] });
  };

  const store = fakeStore();
  const first = await runHealthRefresh({
    workspace: dir,
    env,
    fetchImpl: makeFetch({ age: 28, height: 178, weight: 74 }),
    now: new Date('2026-10-01T09:00:00Z'),
    token: 't',
    store,
    templates: readTemplates(),
  });
  check('refresh runs end to end with fixtures', first.ok === true, first.error || '');
  if (first.ok) {
    eq('refresh publishes four drafts while the gate is open', [first.artifact.mode, first.artifact.counts.created, first.artifact.counts.updated], ['draft', 4, 0]);
    check('refresh reports the withheld analysis sections', first.artifact.refused.length > 0, JSON.stringify(first.artifact.refused));
    check('refresh writes its artifacts', ['health-refresh.json', 'health-refresh.md', 'health-docs.json'].every((f) => fs.existsSync(path.join(dir, 'result', f))));

    // The seat context pack, read from the workspace the real run just wrote:
    // the reader must find what the writer wrote, in the same paths. The brief
    // is the user's, so it is not written by any command — the pack refuses
    // without it, which section 10 pins; here it stands in for the real folder.
    fs.writeFileSync(path.join(dir, 'BRIEF.md'), '# Brief\n\nThe four living documents, renewed monthly.\n');
    const ctx = buildHealthContext(dir);
    check('the context pack accepts a workspace a real run produced', ctx.ok === true, ctx.refuses.join('; '));
    const verifySection = ctx.sections.find((s) => s.key === 'verify')?.text || '';
    check('the context pack reads the verify artifact the run wrote', Boolean(verifySection) && !ctx.absent.some((a) => a.key === 'verify'), ctx.sections.map((s) => s.key).join(','));
    const onDisk = JSON.parse(fs.readFileSync(path.join(dir, 'result', 'health-verify.json'), 'utf8'));
    const openIds = (onDisk.fixList?.items || []).filter((i) => i.state === 'open').map((i) => i.id);
    check('the pack states the gate the artifact states', openIds.length
      ? verifySection.includes(`data gate: OPEN (${openIds.length}: ${openIds.join(', ')})`)
      : verifySection.includes('data gate: CLOSED'), verifySection.split('\n')[1]);
    check('the context pack sees the fix list the run wrote', ctx.sections.some((s) => s.key === 'fix_list'));
    check('the context pack sees the banked sources', ctx.sections.some((s) => s.key === 'sources') && ctx.sections.find((s) => s.key === 'sources').text.includes('sheet_2026-09-30.json'));
    check('the pack names the analysis payload as absent', ctx.absent.some((a) => a.key === 'analysis'), JSON.stringify(ctx.absent.map((a) => a.key)));
    const ctxBlock = renderContextBlock(ctx);
    check('the rendered block carries the not-present line', /not present: result\/health-analysis\.json/.test(ctxBlock), ctxBlock.slice(-300));
    check('the rendered block names the sheet it was built from', ctxBlock.includes('sheet (the source of truth): sheet_2026-09-30.json'), ctxBlock.slice(0, 600));
    const registry = loadDocsRegistry(path.join(dir, 'result', 'health-docs.json'));
    eq('the registry on disk names the four documents', Object.keys(registry.docs).sort(), ['conditions', 'insights', 'snapshot', 'test_plan']);
    const text = store.files[registry.docs.conditions.id];
    check('the published Conditions document carries the banner', /DRAFT — the data gate is OPEN/.test(text), text.slice(0, 120));
    check('the published Conditions document carries the refusal', /Not published while the data gate is open/.test(text), 'refusal missing from the published bytes');
    check('the published Conditions document has no analysis', !text.includes(ANALYSIS_MARKER), 'analysis leaked');
    const status = getHealthStatus({ workspace: dir, env });
    eq('status reports the documents as published', [status.docs.published, Object.keys(status.docs.ids).length], [true, 4]);
    check('the status reply names the documents', /Docs: 4 published/.test(formatStatusText(status)), formatStatusText(status).split('\n').slice(-2).join(' | '));
    check('the refresh reply carries the counts and the folder', /created 4/.test(formatRefreshText(first)) && formatRefreshText(first).includes('folder1'), formatRefreshText(first).slice(0, 160));

    // Rerun: same day, same inputs — skips, no new ids, no writes.
    const before = store.calls.length;
    const again = await runHealthRefresh({
      workspace: dir, env, fetchImpl: makeFetch({ age: 28, height: 178, weight: 74 }),
      now: new Date('2026-10-01T15:00:00Z'), token: 't', store, templates: readTemplates(),
    });
    eq('a same-day rerun skips every document', [again.artifact.counts.created, again.artifact.counts.skipped], [0, 4]);
    check('a same-day rerun touches Drive only to list or stat', store.calls.slice(before).every((c) => ['list', 'stat'].includes(c.op)), store.calls.slice(before).map((c) => c.op).join(','));
    const registry2 = loadDocsRegistry(path.join(dir, 'result', 'health-docs.json'));
    eq('the ids are the same after the rerun', Object.entries(registry2.docs).map(([k, v]) => [k, v.id]), Object.entries(registry.docs).map(([k, v]) => [k, v.id]));
  }

  // A closed gate: the very same payload that was refused above renders into
  // the published bytes — through the runner, with the analysis file on disk.
  const closedStore = fakeStore();
  const closedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'health-refresh-closed-'));
  fs.cpSync(path.join(dir, 'sources'), path.join(closedDir, 'sources'), { recursive: true });
  fs.mkdirSync(path.join(closedDir, 'result'), { recursive: true });
  fs.writeFileSync(path.join(closedDir, 'result', 'health-analysis.json'), JSON.stringify({ at: '2026-10-01T08:00:00Z', sections: analysisPayload() }));
  const closedRun = await runHealthRefresh({
    workspace: closedDir,
    env,
    fetchImpl: makeFetch({ age: 43, height: 163, weight: 62, dateOfBirth: '1983-06-15' }, fullFixture),
    now: new Date('2026-10-01T09:00:00Z'),
    token: 't',
    store: closedStore,
    templates: readTemplates(),
  });
  check('a closed gate publishes the analysis, not a refusal', closedRun.ok === true, closedRun.error || '');
  if (closedRun.ok) {
    eq('the closed run is in analysis mode', closedRun.artifact.mode, 'analysis');
    eq('nothing is withheld once the gate is closed', closedRun.artifact.refused, []);
    const closedText = closedStore.files[closedRun.registry.docs.conditions.id];
    check('the published bytes carry the analysis payload', closedText.includes(ANALYSIS_MARKER), closedText.slice(0, 200));
    check('the published bytes carry no refusal', !/Not published while the data gate is open/.test(closedText), 'refusal text left in a closed-gate document');
  }

  // A malformed payload is the same shape of failure as a template that will not
  // render: publishing three good documents while silently substituting
  // "awaiting the analysis pass" for a broken claim is the silent-drop this
  // module exists to refuse — so the run stops having written nothing.
  const badRunDir = fs.mkdtempSync(path.join(os.tmpdir(), 'health-refresh-badpayload-'));
  fs.cpSync(path.join(dir, 'sources'), path.join(badRunDir, 'sources'), { recursive: true });
  fs.mkdirSync(path.join(badRunDir, 'result'), { recursive: true });
  fs.writeFileSync(path.join(badRunDir, 'result', 'health-analysis.json'), JSON.stringify({ at: '2026-10-01T08:00:00Z', sections: { 'analysis.conditions': { marker: 'LDL', value: 4.3 } } }));
  const badStore = fakeStore();
  const badRun = await runHealthRefresh({
    workspace: badRunDir,
    env,
    fetchImpl: makeFetch({ age: 43, height: 163, weight: 62, dateOfBirth: '1983-06-15' }, fullFixture),
    now: new Date('2026-10-01T09:00:00Z'),
    token: 't',
    store: badStore,
    templates: readTemplates(),
  });
  check('refresh fails closed on a malformed analysis payload', badRun.ok === false && badRun.stage === 'analysis', JSON.stringify({ stage: badRun.stage, error: badRun.error }));
  eq('a refused payload writes nothing at all', badStore.calls.length, 0);
  check('the refusal names the offending key', /analysis\.conditions/.test(badRun.error || ''), badRun.error);
  check('the refusal never quotes the malformed value', !/4\.3/.test(badRun.error || ''), 'the malformed claim leaked into the refusal');

  // Fail closed: no folder configured, no template on disk.
  const noFolder = await runHealthRefresh({ workspace: dir, env: { ...env, HEALTH_DOCS_FOLDER: '' }, fetchImpl: makeFetch({}), token: 't', store: fakeStore(), templates: readTemplates() });
  check('refresh fails closed with no documents folder', noFolder.ok === false && noFolder.stage === 'config', JSON.stringify({ stage: noFolder.stage, error: noFolder.error }));
  eq('the folder can also come from the store env map', docsFolder({ env: { GOOGLE_FOLDER_EXTERNAL_HEALTH: 'folderFromMap' } }), 'folderFromMap');
  const noTemplate = await runHealthRefresh({ workspace: dir, env, fetchImpl: makeFetch({}), token: 't', store: fakeStore(), templates: { ...readTemplates(), insights: '' } });
  check('refresh fails closed on a template that cannot render', noTemplate.ok === false && noTemplate.stage === 'template', JSON.stringify({ stage: noTemplate.stage, error: noTemplate.error }));

  // Analyze: the entry point refuses while the gate is open and names the inputs when it closes.
  const refused = runHealthAnalyze({ workspace: dir, env });
  check('analyze refuses while the gate is open', refused.ok === false && refused.stage === 'gate', JSON.stringify(refused));
  eq('the refusal names every open item', (refused.openItems || []).map((i) => i.id), ['H-1', 'H-6']);
  check('the refusal carries each item title', (refused.openItems || []).every((i) => i.title === FIX_TITLES[i.id]), JSON.stringify(refused.openItems));
  check('the refusal reply names the items', /H-1 Profile demographics match the sheet/.test(formatAnalyzeText(refused)), formatAnalyzeText(refused));
  const never = runHealthAnalyze({ workspace: fs.mkdtempSync(path.join(os.tmpdir(), 'health-no-verify-')), env });
  check('analyze refuses when nothing was verified yet', never.ok === false && never.stage === 'verify', JSON.stringify(never));
  eq('analyze could not read a broken analysis file', loadAnalysisFile(path.join(dir, 'nope.json')).ok, false);

  // ── The payload boundary ──────────────────────────────────────────────────
  // A payload is written by the analyst seat and read by the publisher, and it
  // arrives holding health claims. Unchecked it does not fail loudly — it fails
  // quietly INTO the document: an object stringifies to `[object Object]`, a
  // number becomes a bare `42` that reads as a measurement, and a nested array
  // is spliced in raw. Each is indistinguishable from a real claim to the reader.
  console.log('\n  — analysis payload shape —');
  eq('there are eleven analysis keys', ANALYSIS_SECTIONS.length, 11);
  check('every analysis key is a real analysis source', ANALYSIS_SECTIONS.every((k) => k.startsWith('analysis.')), ANALYSIS_SECTIONS.join(' '));
  check('an absent payload is not an error', validateAnalysisSections(undefined).ok === true, 'the default file simply not existing yet must stay normal');
  check('an empty payload is not an error', validateAnalysisSections({}).ok === true, JSON.stringify(validateAnalysisSections({})));
  const goodPayload = validateAnalysisSections({ 'analysis.conditions': ['- LDL 4.3 mmol/L (2026-06-03).'] });
  check('a well-formed payload passes through', goodPayload.ok === true && goodPayload.sections['analysis.conditions'].length === 1, JSON.stringify(goodPayload));
  check('an empty array is a legitimate empty answer', validateAnalysisSections({ 'analysis.conditions': [] }).ok === true, 'an empty list must render as awaiting, not refuse');
  for (const [label, sections] of [
    ['sections as an array', []],
    ['sections as a string', 'conditions'],
    ['an object where lines belong', { 'analysis.conditions': { marker: 'LDL' } }],
    ['a bare number', { 'analysis.conditions': 42 }],
    ['null', { 'analysis.conditions': null }],
    ['a non-string line', { 'analysis.conditions': ['ok', 7] }],
  ]) {
    const r = validateAnalysisSections(sections);
    check(`refuses ${label}`, r.ok === false, JSON.stringify(r));
  }
  const typo = validateAnalysisSections({ 'analysis.condition': ['x'] });
  check('refuses a misspelt key rather than silently withholding its section', typo.ok === false && /analysis\.condition"/.test(typo.error), JSON.stringify(typo));
  check('names the keys it accepts so the analyst can correct it', /expected one of analysis\.conditions/.test(typo.error || ''), typo.error);
  check('refuses a data key smuggled into the payload', validateAnalysisSections({ 'data.trusted': ['x'] }).ok === false, 'an analysis file has no business claiming a data section');

  // The loader is the real door: valid JSON with a malformed claim must refuse.
  const badDir = fs.mkdtempSync(path.join(os.tmpdir(), 'health-analysis-shape-'));
  const writePayload = (obj) => {
    const f = path.join(badDir, 'health-analysis.json');
    fs.writeFileSync(f, JSON.stringify(obj));
    return f;
  };
  const badPayload = loadAnalysisFile(writePayload({ at: '2026-10-01T08:00:00Z', sections: { 'analysis.conditions': { marker: 'LDL' } } }));
  check('the loader refuses valid JSON with a malformed claim', badPayload.ok === false, JSON.stringify(badPayload));
  check('the refusal is attributed to the payload, not to parsing', /analysis payload refused/.test(badPayload.error || ''), badPayload.error);
  const typoPayload = loadAnalysisFile(writePayload({ sections: { 'analysis.conditionss': ['x'] } }));
  check('the loader refuses a misspelt key', typoPayload.ok === false, JSON.stringify(typoPayload));
  const okPayload = loadAnalysisFile(writePayload({ at: '2026-10-01T08:00:00Z', sections: analysisPayload() }));
  check('the loader still accepts the well-formed payload', okPayload.ok === true && Object.keys(okPayload.sections).length === 11, JSON.stringify(okPayload).slice(0, 200));
  eq('the loader carries the payload date through', okPayload.at, '2026-10-01T08:00:00Z');

  // Defence in depth: rendering straight from an unvalidated object must not be
  // able to publish `[object Object]` either.
  const rawSection = (value) => renderSection({ heading: 'Candidate conditions', source: 'analysis.conditions', artifact: fixtureArtifact('open'), gate: { allowed: true }, analysis: { 'analysis.conditions': value }, registry: {}, spec: DOC_SPECS[1], now: new Date('2026-10-01T09:00:00Z') });
  check('an object section is refused, not stringified', rawSection({ marker: 'LDL' }).refused === true, JSON.stringify(rawSection({ marker: 'LDL' })));
  check('the refusal never prints the value', !JSON.stringify(rawSection({ marker: 'LDL' })).includes('[object Object]'), '[object Object] reached the renderer');
  check('a number section is refused, not read as a measurement', rawSection(42).refused === true, JSON.stringify(rawSection(42)));
  check('a missing section still renders the awaiting placeholder', rawSection(undefined).refused === false && /Awaiting the analysis pass/.test(rawSection(undefined).body.join('\n')), JSON.stringify(rawSection(undefined)));

  const closedArtifact = { ...fixtureArtifact('closed') };
  const analyzeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'health-analyze-closed-'));
  fs.mkdirSync(path.join(analyzeDir, 'result'), { recursive: true });
  fs.writeFileSync(path.join(analyzeDir, 'result', 'health-verify.json'), JSON.stringify(closedArtifact));
  const ready = runHealthAnalyze({ workspace: analyzeDir, env });
  check('analyze opens when the gate is closed', ready.ok === true, JSON.stringify(ready));
  if (ready.ok) {
    eq('the entry point names the analyst role', ready.ready.role, 'health_analyst');
    eq('the entry point names every analysis section', ready.ready.sections.length, Object.values(SECTION_SOURCES).filter((s) => s.startsWith('analysis.')).length);
    eq('the entry point names the four documents', ready.ready.documents.length, 4);
    check('the entry point names the payload file', /health-analysis\.json$/.test(ready.ready.analysisFile), ready.ready.analysisFile);
    check('the ready reply names the payload', /Data gate closed/.test(formatAnalyzeText(ready)), formatAnalyzeText(ready).slice(0, 120));
  }
  fs.rmSync(dir, { recursive: true, force: true });
}

// ---------------------------------------------------------------- 10. the seat context pack
{
  // Refusals first: a workspace with no brief must not seat a turn at all.
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'health-bare-'));
  const refused = buildHealthContext(bare);
  check('a workspace with no brief is refused', refused.ok === false && /no brief or charter/.test(refused.refuses.join(' ')), JSON.stringify(refused.refuses));
  check('a refused pack renders nothing into the prompt', renderContextBlock(refused) === '', renderContextBlock(refused).slice(0, 80));
  eq('a refused pack still accounts for every source', [refused.sections.length, refused.absent.length], [0, CONTEXT_CANDIDATES.length]);
  const noSuch = buildHealthContext(path.join(bare, 'nope'));
  check('a workspace that does not exist is refused', noSuch.ok === false && /is not a directory/.test(noSuch.refuses.join(' ')), JSON.stringify(noSuch.refuses));
  fs.rmSync(bare, { recursive: true, force: true });

  // The budget is bytes, not code units: a multi-byte arrow must never be sliced in half.
  const arrows = '→'.repeat(10);
  const clipped = clipToBudget(arrows, 5);
  eq('a byte budget keeps whole characters', [Buffer.byteLength(clipped.text.split('\n')[0]), clipped.truncatedBytes], [3, 27]);
  check('the truncation marker names the withheld bytes', /\[truncated: 27 bytes withheld\]/.test(clipped.text), clipped.text);
  const untouched = clipToBudget('short', 5);
  eq('a section inside its budget is not marked', [untouched.text, untouched.truncatedBytes], ['short', 0]);

  // A full workspace: every candidate is either a section or an explicit absence.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'health-context-'));
  fs.mkdirSync(path.join(dir, 'result'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'sources'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'BRIEF.md'), '# Brief\n\nThe four documents, renewed monthly.\n');
  fs.writeFileSync(path.join(dir, 'sources', 'sheet_2026-09-30.json'), JSON.stringify({ data: {} }));
  fs.writeFileSync(path.join(dir, 'result', 'health-verify.json'), JSON.stringify({ ...fixtureArtifact('open'), summary: { match: 2, missing: 1, appOnlyUnreviewed: 1, gap: 1 } }));
  fs.writeFileSync(path.join(dir, 'result', 'health-fix-list.md'), '# Data fix list\n\n- [ ] **H-1 — mis-filed rows**\n');
  fs.writeFileSync(path.join(dir, 'result', 'health-analysis.json'), JSON.stringify({ at: '2026-10-01T08:00:00Z', sections: analysisPayload() }));

  const ctx = buildHealthContext(dir);
  check('the pack accepts a workspace with a brief', ctx.ok === true, ctx.refuses.join('; '));
  {
    const keys = [...ctx.sections.map((s) => s.key), ...ctx.absent.map((a) => a.key)];
    const candidates = CONTEXT_CANDIDATES.map((c) => c.key);
    eq('every candidate is a section or an absence, exactly once', keys.slice().sort(), candidates.slice().sort());
    eq('no candidate is dropped', new Set(keys).size, candidates.length);
  }
  const brief = ctx.sections.find((s) => s.key === 'brief');
  check('the brief is read from its file', brief?.path === 'BRIEF.md' && brief.text.includes('renewed monthly'), JSON.stringify(brief).slice(0, 160));
  const verify = ctx.sections.find((s) => s.key === 'verify')?.text || '';
  check('the verify digest states the open gate', /data gate: OPEN \(8: H-1, H-2/.test(verify), verify.split('\n')[1]);
  check('the verify digest lists every open item by id', Object.keys(FIX_TITLES).every((id) => verify.includes(id)), verify.slice(0, 300));
  check('the verify digest names the newest sheet date', verify.includes('newest 2026-06-09'), verify);
  check('the verify digest carries the coverage counts', /coverage: 2 exact matches/.test(verify), verify);
  // An artifact with no summary block is reported as such, not as a zero.
  fs.writeFileSync(path.join(dir, 'result', 'health-verify.json'), JSON.stringify(fixtureArtifact('open')));
  check('an artifact with no summary block says so', /coverage: the artifact carries no summary block/.test(buildHealthContext(dir).sections.find((s) => s.key === 'verify')?.text || ''), 'the digest invented coverage numbers');
  fs.writeFileSync(path.join(dir, 'result', 'health-verify.json'), JSON.stringify({ ...fixtureArtifact('open'), summary: { match: 2, missing: 1, appOnlyUnreviewed: 1, gap: 1 } }));
  const analysis = ctx.sections.find((s) => s.key === 'analysis')?.text || '';
  check('the analysis payload is shown with its shape verdict', /shape: accepted — 11 analysis section\(s\)/.test(analysis) && analysis.includes(ANALYSIS_MARKER), analysis.slice(0, 200));
  eq('every artifact that is missing is named', ctx.absent.map((a) => a.key).sort(), ['docs', 'refresh']);
  const block = renderContextBlock(ctx);
  check('the rendered block names the absent artifacts as findings', /not present: result\/health-docs\.json/.test(block) && /not present: result\/health-refresh\.json/.test(block), block.slice(-400));
  check('the rendered block carries every section with its path and date', ctx.sections.every((s) => block.includes(`### ${s.label} — ${s.path}${s.date ? ` (${s.date})` : ''}`)), block.split('\n').filter((l) => l.startsWith('### ')).join(' | '));

  // A malformed payload is the object under review, so it is shown AND flagged.
  fs.writeFileSync(path.join(dir, 'result', 'health-analysis.json'), JSON.stringify({ at: '2026-10-01T08:00:00Z', sections: { 'analysis.conditions': { marker: 'LDL' } } }));
  const bad = buildHealthContext(dir).sections.find((s) => s.key === 'analysis')?.text || '';
  check('a refused payload is flagged and still visible', /shape: REFUSED —/.test(bad) && bad.includes('"marker":"LDL"'), bad.slice(0, 300));
  fs.writeFileSync(path.join(dir, 'result', 'health-analysis.json'), '{ not json');
  const unparseable = buildHealthContext(dir).sections.find((s) => s.key === 'analysis')?.text || '';
  check('an unparseable payload is flagged, not dropped', /shape: REFUSED — does not parse/.test(unparseable), unparseable.slice(0, 200));

  // Truncation is declared, with the size of what was withheld.
  const big = `- [ ] **H-9 — a very long item**\n${'x'.repeat(CONTEXT_BUDGET.fix_list * 2)}\n`;
  fs.writeFileSync(path.join(dir, 'result', 'health-fix-list.md'), big);
  const fixSection = buildHealthContext(dir).sections.find((s) => s.key === 'fix_list');
  eq('an over-budget section reports the bytes it withheld', fixSection?.truncatedBytes, Buffer.byteLength(big) - CONTEXT_BUDGET.fix_list);
  check('the over-budget section says so inline', /\[truncated: \d+ bytes withheld\]/.test(fixSection?.text || ''), (fixSection?.text || '').slice(-80));

  // The council path: the health project is served by the provider, and the
  // case/ projects keep exactly the reader they had.
  const seat = readWorkspaceContext(dir, { projectId: 'external-health' });
  eq('the council reader uses the health provider', seat.provider, 'health');
  check('the council text is the rendered pack', seat.text === renderContextBlock(seat.context) && seat.text.includes('## Workspace context'), seat.text.slice(0, 120));
  const refusedSeat = readWorkspaceContext(fs.mkdtempSync(path.join(os.tmpdir(), 'health-none-')), { projectId: 'external-health' });
  check('a refused workspace refuses the council turn', refusedSeat.ok === false && refusedSeat.text === '' && refusedSeat.refuses.length > 0, JSON.stringify(refusedSeat.refuses));
  eq('the provider is declared per project, not guessed from the path', contextProviderFor(KNOWN_PROJECTS['external-health'].workspace), 'health');

  const caseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'council-case-'));
  fs.mkdirSync(path.join(caseDir, 'case'), { recursive: true });
  fs.mkdirSync(path.join(caseDir, 'working'), { recursive: true });
  fs.writeFileSync(path.join(caseDir, '01_Case_Facts.md'), 'AAA');
  fs.writeFileSync(path.join(caseDir, 'notes.txt'), 'not markdown, not context');
  fs.writeFileSync(path.join(caseDir, 'case', '02_Ledger.md'), 'BBB');
  fs.writeFileSync(path.join(caseDir, 'working', 'A_Talking_Points.md'), 'C'.repeat(1200));
  const legacy = readWorkspaceContext(caseDir, { projectId: 'external-1' });
  eq('a case/ project keeps the legacy reader', legacy.provider, 'legacy');
  eq('the legacy reader keeps its file map', Object.keys(legacy.context).sort(), ['01_Case_Facts.md', 'case/02_Ledger.md', 'working/A_Talking_Points.md']);
  check('the legacy text keeps its ### File: shape', /^### File: 01_Case_Facts\.md\nAAA\.\.\.\n/.test(legacy.text), legacy.text.slice(0, 80));
  check('the legacy text still slices at 1000 characters', legacy.text.includes(`${'C'.repeat(1000)}...`), legacy.text.slice(-40));
  check('the legacy reader ignores non-markdown files', !legacy.text.includes('not markdown'), legacy.text.slice(0, 200));
  eq('a legacy project is never served health context', contextProviderFor(caseDir), '');
  fs.rmSync(caseDir, { recursive: true, force: true });
  fs.rmSync(dir, { recursive: true, force: true });
}

// ------------------------------------------------- 11. council stages resolve from the project's own seats
{
  const captured = [];
  const fakeModel = async ({ prompt }) => {
    captured.push(prompt);
    return { code: 0, finalText: 'SEAT OUTPUT FOR THE SENSOR', lastError: null, sessionID: null, stderr: '', usage: { cost: 0, tokens: null } };
  };

  // Resolution is pure, so it is judged before any model is involved.
  const byId = resolveCouncilStage('data_steward', 'external-health');
  eq('a stage resolves by its seat id', [byId.ok, byId.phases.map((p) => p.id)], [true, ['data_steward']]);
  eq('a stage resolves through a role alias', resolveCouncilStage('steward', 'external-health').phases.map((p) => p.id), ['data_steward']);
  eq('a stage resolves by its number', resolveCouncilStage('2', 'external-health').phases.map((p) => p.id), ['health_analyst']);
  eq('all five seats are a stage', resolveCouncilStage('all', 'external-health').phases.length, 5);
  const refusedStage = resolveCouncilStage('banana', 'external-health');
  check('an unknown stage is refused, not run as the whole council', refusedStage.ok === false && /Unknown stage/.test(refusedStage.error), JSON.stringify(refusedStage).slice(0, 160));
  check('the refusal names the real stages', /data_steward/.test(refusedStage.error) && /safety_reviewer/.test(refusedStage.error), refusedStage.error);
  eq('external-health is not a case project', isCaseProject('external-health'), false);
  eq('external-1 is a case project', isCaseProject('external-1'), true);

  // The case checkpoints keep their exact phase sets and messages.
  for (const [token, ids] of [['audit', ['accuracy_review']], ['defense', ['case_review', 'manager_simulation']], ['finalize', ['legal_policy', 'arbitrator', 'final_case_builder']]]) {
    const r = resolveCouncilStage(token, 'external-1');
    eq(`the ${token} checkpoint keeps its phases`, r.phases.map((p) => p.id), ids);
    eq(`the ${token} checkpoint keeps its message`, r.nextStepMsg, LEGACY_CHECKPOINTS[token].nextStepMsg);
    check(`the ${token} checkpoint says it is the legacy path`, r.legacy === true);
  }

  // A real stage run against a workspace, with the model faked: the file lands
  // where the status reader looks, and the seat is handed the health context.
  const health = KNOWN_PROJECTS['external-health'];
  const originalHealth = health.workspace;
  const healthWs = fs.mkdtempSync(path.join(os.tmpdir(), 'council-health-'));
  fs.writeFileSync(path.join(healthWs, 'BRIEF.md'), '# Brief\n\nFour living documents.\n');
  fs.mkdirSync(path.join(healthWs, 'result'), { recursive: true });
  fs.writeFileSync(path.join(healthWs, 'result', 'health-verify.json'), JSON.stringify({ ...fixtureArtifact('open'), summary: { match: 2, missing: 1, appOnlyUnreviewed: 1, gap: 1 } }));
  fs.writeFileSync(path.join(healthWs, 'result', 'health-fix-list.md'), '# Data fix list\n\n- [ ] **H-1 — mis-filed rows**\n');
  health.workspace = healthWs;
  try {
    const one = await runCouncilStage('data_steward', 'external-health', () => {}, { runGemini: fakeModel });
    const written = path.join(healthWs, 'result', '01_data_steward.md');
    eq('a stage writes into result/, the directory the status reader reads', [fs.existsSync(written), one.outDir], [true, path.join(healthWs, 'result')]);
    check('the seat was handed the verified data, not just the brief', /data gate: OPEN \(8: H-1/.test(captured.at(-1) || '') && /The fix list/.test(captured.at(-1) || ''), (captured.at(-1) || '').slice(0, 200));
    check('the prompt carries the not-present finding', /not present: result\/health-analysis\.json/.test(captured.at(-1) || ''), 'the absence never reached the prompt');
    check('nothing was written into output/', !fs.existsSync(path.join(healthWs, 'output')), 'a stage still writes to output/');
    const status = getCouncilStatus('external-health');
    eq('the stage the writer ran reads back as completed', status.phases.find((p) => p.phase === 'data_steward')?.completed, true);
    eq('the project reports its own deliverables', status.deliverables.length, 5);
    check('the external-2 trio is never this project\'s deliverable', status.deliverables.every((d) => !d.startsWith('A_') && !d.startsWith('B_') && !d.startsWith('C_')), status.deliverables.join(','));
    eq('deliverables are not ready after one seat', status.deliverablesReady, false);
    eq('the status reply names the project pipeline', status.pipeline, 'roles');

    const all = await runCouncilStage('all', 'external-health', () => {}, { runGemini: fakeModel });
    // Seats run in the loader's order (role file name), which is also the order
    // `/council status` numbers them.
    eq('all runs every seat in order', all.phases.map((p) => p.id), ['data_steward', 'health_analyst', 'research_lead', 'safety_reviewer', 'test_planner']);
    eq('five files exist after all', getCouncilStatus('external-health').deliverablesReady, true);
    check('every deliverable points at a real file', all.deliverables.every((d) => fs.existsSync(d)), all.deliverables.join(','));

    let threw = '';
    try {
      await runCouncilStage('banana', 'external-health', () => {}, { runGemini: fakeModel });
    } catch (err) {
      threw = err.message;
    }
    check('the command surface refuses an unknown stage', /Unknown stage/.test(threw) && /health_analyst/.test(threw), threw);

    // The case pipeline, on the same code path, unchanged.
    const caseOne = KNOWN_PROJECTS['external-1'];
    const originalCase = caseOne.workspace;
    const caseWs = fs.mkdtempSync(path.join(os.tmpdir(), 'council-case-'));
    caseOne.workspace = caseWs;
    try {
      const audit = await runCouncilStage('audit', 'external-1', () => {}, { runGemini: fakeModel });
      eq('the case checkpoint still writes to output/ (its reader)', [fs.existsSync(path.join(caseWs, 'output', '01_accuracy_audit.md')), audit.outDir], [true, path.join(caseWs, 'output')]);
      eq('the case checkpoint still returns its own message', audit.nextStepMsg, LEGACY_CHECKPOINTS.audit.nextStepMsg);
      const caseStatus = getCouncilStatus('external-1');
      eq('the case project still reports the A/B/C trio', caseStatus.deliverables.length, 3);
      check('the case deliverables are the executive documents', caseStatus.deliverables.every((d) => /_[A-Z]/.test(d) || /^[ABC]_/.test(d)), caseStatus.deliverables.join(','));
      eq('the case project says so', caseStatus.pipeline, 'case');
    } finally {
      caseOne.workspace = originalCase;
      fs.rmSync(caseWs, { recursive: true, force: true });
    }
  } finally {
    health.workspace = originalHealth;
    fs.rmSync(healthWs, { recursive: true, force: true });
  }
}

// ------------------------------------------------- 12. the readiness self-check
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'health-ready-'));
  fs.mkdirSync(path.join(dir, 'result'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'BRIEF.md'), '# Brief\n\nFour living documents.\n');
  const paths = { workspace: dir, sources: path.join(dir, 'sources'), result: path.join(dir, 'result') };
  const now = new Date('2026-10-01T09:00:00Z');

  // No key, no host config: not ready, and the blocker says exactly what to add where.
  const bare = checkHealthReadiness({ paths, env: {}, now });
  eq('with no model credential the check is not ready', [bare.ready, bare.exit, bare.blockers], [false, 3, ['model']]);
  const bareText = formatReadinessText(bare);
  // The reply is Telegram Markdown, so an env var name arrives escaped — the
  // literal name is asserted on the check itself, the escaped one on the reply.
  check('the blocker names the key and the file it goes in', /GEMINI.{0,2}API.{0,2}KEY/.test(bareText) && /common\.env/.test(bareText), bareText.slice(0, 200));
  check('the blocker carries the key verbatim', /GEMINI_API_KEY/.test(bare.checks.find((c) => c.key === 'model').detail), bare.checks.find((c) => c.key === 'model').detail);
  check('the host env findings are reported, not skipped', bare.findings.includes('docs_folder') && bare.findings.includes('health_env_file'), JSON.stringify(bare.findings));
  check('the missing env var finding says where to put it', /HEALTH_DOCS_FOLDER/.test(JSON.stringify(bare.checks)) && /HEALTH_ENV_FILE/.test(JSON.stringify(bare.checks)), JSON.stringify(bare.checks.map((c) => c.key)));
  const contextCheck = bare.checks.find((c) => c.key === 'context');
  eq('the context check reports the bytes a seat would see', [contextCheck.level, contextCheck.title.includes('bytes')], ['ok', true]);
  check('the readiness reply is renderable', formatReadinessText(bare).includes('Not ready for bots'), formatReadinessText(bare).slice(0, 120));

  const withKey = checkHealthReadiness({ paths, env: { GEMINI_API_KEY: 'x', HEALTH_DOCS_FOLDER: 'folder', HEALTH_ENV_FILE: '/tmp/.env' }, now });
  eq('with a credential and host config it is ready', [withKey.ready, withKey.exit, withKey.blockers], [true, 0, []]);
  check('ready still reports the findings it has', withKey.findings.includes('verify') && withKey.findings.includes('analysis'), JSON.stringify(withKey.findings));
  check('the ready reply says so', /Ready for bots/.test(formatReadinessText(withKey)));

  // A stale artifact is a finding that says how old; a fresh one is fine.
  const staleAt = new Date(now.getTime() - (STALE_AFTER_DAYS + 10) * 86400000).toISOString();
  fs.writeFileSync(path.join(dir, 'result', 'health-verify.json'), JSON.stringify({ ...fixtureArtifact('open'), at: staleAt }));
  const stale = checkHealthReadiness({ paths, env: {}, now });
  check('a stale verify artifact is a finding naming its age', stale.findings.includes('verify') && /days old/.test(stale.checks.find((c) => c.key === 'verify').title), stale.checks.find((c) => c.key === 'verify').title);
  check('the open gate is reported with its item ids', /H-1/.test(stale.checks.find((c) => c.key === 'gate').title), stale.checks.find((c) => c.key === 'gate').title);
  fs.writeFileSync(path.join(dir, 'result', 'health-verify.json'), JSON.stringify(fixtureArtifact('closed')));
  const closed = checkHealthReadiness({ paths, env: {}, now });
  eq('a closed gate reports ok', closed.checks.find((c) => c.key === 'gate').level, 'ok');

  // Role drift between the repo's seats and a workspace mirror.
  fs.mkdirSync(path.join(dir, 'roles'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'roles', 'data_steward.md'), '# Data Steward\n\nA workspace copy that has drifted.\n');
  const drifted = checkHealthReadiness({ paths, env: {}, now });
  eq('role drift is a finding', drifted.checks.find((c) => c.key === 'seats').level, 'finding');
  check('the drift finding names the file', /data_steward\.md/.test(drifted.checks.find((c) => c.key === 'seats').detail), drifted.checks.find((c) => c.key === 'seats').detail);
  fs.rmSync(path.join(dir, 'roles'), { recursive: true, force: true });
  eq('no mirror is not drift', checkHealthReadiness({ paths, env: {}, now }).checks.find((c) => c.key === 'seats').level, 'ok');

  // The real command surface: exit 3 when a seat could not run, 0 when it could.
  const runner = path.join(ROOT, 'scripts', 'health-runner.mjs');
  const noKeyEnv = { ...process.env, HEALTH_WORKSPACE: dir, GEMINI_API_KEY: '', GOOGLE_API_KEY: '', API_KEY: '', GEMINI_API_KEYS: '' };
  let noKeyCode = 0;
  let noKeyOut = '';
  try {
    noKeyOut = execFileSync(process.execPath, [runner, '--readiness', '--json'], { env: noKeyEnv, encoding: 'utf8' });
  } catch (err) {
    noKeyCode = err.status;
    noKeyOut = err.stdout || '';
  }
  const parsed = JSON.parse(noKeyOut || '{}');
  eq('the CLI exits 3 when the bot half cannot run', noKeyCode, 3);
  eq('and its JSON says why', parsed.blockers, ['model']);
  const keyOut = execFileSync(process.execPath, [runner, '--readiness', '--json'], { env: { ...noKeyEnv, GEMINI_API_KEY: 'x' }, encoding: 'utf8' });
  eq('the CLI exits 0 when it can', JSON.parse(keyOut).exit, 0);
  eq('and reports the workspace it read', JSON.parse(keyOut).workspace, dir);
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log(`\n${passed} pass, ${failed} fail\n`);
if (failed > 0) process.exit(1);
