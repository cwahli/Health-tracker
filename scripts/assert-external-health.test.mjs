import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { assertReadOnlySql, parseEnvFile, loadD1Config, createD1Reader, resolveProfileUid, parseBiomarkers, parseProfile, QUERIES } from './lib/health/d1.mjs';
import { parseCsvLine, isoDate, mapSheetTest, parseSheetCsv, parseSheetDump, sheetRecord, MARKER_LABELS } from './lib/health/sheet.mjs';
import { extractAppState, reconcile, evaluateFixList, unreviewedAppRows, valuesEqual, FIX_LIST } from './lib/health/reconcile.mjs';
import { KNOWN_PROJECTS, resolveProjectId, resolveRoleId, getProjectRoles, getRoleInstructions, getProjectSoul, seedProjectWorkspace } from './lib/project-registry.mjs';
import { runHealthVerify, runHealthRefresh, runHealthAnalyze, getHealthStatus, renderFixListMarkdown, formatVerifyText, formatStatusText, formatRefreshText, formatAnalyzeText, healthPaths, docsFolder, loadHealthTemplates, loadAnalysisFile, runHealthDoctor, formatDoctorText, runHealthResearch, formatResearchText, RESEARCH_LOG, DOCTOR_FILE, DOCTOR_ARTIFACT, ANALYSIS_FILE, extractAnalysisPayload } from './health-runner.mjs';
import { loadSearchFixture, recordedFetch, vendorCalls, providerOf, FIXTURE_FILE } from './fixtures/search-providers.mjs';
import { DOC_SPECS, SECTION_SOURCES, gateFromArtifact, sectionPlan, unknownSections, renderDoc, renderSection, refusalText, staleRefusalText, contentHash, planPublish, publishDocs, applyReceipts, loadDocsRegistry, adoptFromListing, exportDocText, readDocText, googleDocsStore, validateAnalysisSections, ANALYSIS_SECTIONS } from './lib/health/docs.mjs';
import { searchAvailability, webSearch, fetchHit, validateInsightCitations, citationRefusalText, loadResearchLog, CITATION_SOURCES, SEARCH_PROVIDERS, MAX_HITS_PER_QUERY } from './lib/health/research.mjs';
import { buildHealthContext, renderContextBlock, clipToBudget, CONTEXT_CANDIDATES, CONTEXT_BUDGET } from './lib/health/context.mjs';
import { readWorkspaceContext, contextProviderFor, runCouncilStage, getCouncilStatus, getCouncilPhases, resolveCouncilStage, isCaseProject, LEGACY_CHECKPOINTS } from './council-runner.mjs';
import { validateDoctorReport } from './lib/health/doctor.mjs';
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
  eq('the six seats are loadable from the committed roles dir', roles, ['data_steward', 'doctor', 'health_analyst', 'research_lead', 'safety_reviewer', 'test_planner']);
  for (const [alias, id] of [['steward', 'data_steward'], ['analyst', 'health_analyst'], ['planner', 'test_planner'], ['research', 'research_lead'], ['safety', 'safety_reviewer'], ['doctor', 'doctor']]) {
    eq(`/role ${alias} resolves`, resolveRoleId(alias, 'external-health'), id);
  }
  // The declared order is the running order, not the directory's: the Doctor
  // runs last because it checks the seats that ran before it, and the seats a
  // chat already numbers keep their numbers.
  eq('the seats run in their declared order, the doctor last', getProjectRoles('external-health').map((r) => r.id), ['data_steward', 'health_analyst', 'test_planner', 'research_lead', 'safety_reviewer', 'doctor']);
  const doctorRole = getProjectRoles('external-health').find((r) => r.id === 'doctor');
  eq('the doctor declares the artifact it owns and its checker', [doctorRole?.outputFile, doctorRole?.validator], [DOCTOR_FILE, 'doctor']);
  check('the doctor seat names the pass-on-absence rule', /PASS/.test(getRoleInstructions('external-health', 'doctor') || '') && /absence/i.test(getRoleInstructions('external-health', 'doctor') || ''), 'the seat file no longer names its own failure mode');
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
/** The one link the fixtures fetch and record; `cite` puts it on the doc-4 lines. */
const CITATION = 'https://example.test/khor-2024';
const analysisPayload = ({ cite = '' } = {}) => Object.fromEntries(
  Object.values(SECTION_SOURCES)
    .filter((s) => s.startsWith('analysis.'))
    .map((s) => [s, [`- ${ANALYSIS_MARKER}: HbA1c 39 (2026-03-04) → 40 (2026-06-05), +1 mmol/mol.${cite && CITATION_SOURCES.includes(s) ? ` Cited: Khor 2024, 2024, ${cite}` : ''}`]]),
);

/** A fetch log in the shape `/health research` writes: one receipt per url. */
function researchLog({ fetched = [], refused = [] } = {}) {
  const hits = {};
  for (const url of fetched) hits[url] = { url, ok: true, status: 200, bytes: 4096, sha256: 'b'.repeat(64), fetchedAt: '2026-10-01T07:00:00.000Z', title: 'Khor 2024', query: 'HbA1c', snippet: '' };
  for (const url of refused) hits[url] = { url, ok: false, status: 403, bytes: 0, sha256: '', fetchedAt: '2026-10-01T07:00:00.000Z', error: 'HTTP 403' };
  return { version: 1, updatedAt: '2026-10-01T07:00:00.000Z', queries: [], hits };
}

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
  // The citation the analysis carries has to be in the lane's own log: the
  // publisher checks the rendered lines against `result/health-research.json`.
  fs.writeFileSync(path.join(closedDir, 'result', 'health-analysis.json'), JSON.stringify({ at: '2026-10-01T08:00:00Z', sections: analysisPayload({ cite: CITATION }) }));
  fs.writeFileSync(path.join(closedDir, 'result', 'health-research.json'), JSON.stringify(researchLog({ fetched: [CITATION] })));
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
    eq('every citation in document 4 rests on a hit the lane recorded', closedRun.artifact.citationRefusals, []);
    eq('the run reports the citable links the log holds', closedRun.artifact.citedLinks, 1);
    const closedInsights = closedRun.plan.items.find((i) => i.key === 'insights').text;
    check('document 4 publishes the recorded link', closedInsights.includes(CITATION), closedInsights.slice(0, 300));
    check('the other three documents never carry it', closedRun.plan.items.filter((i) => i.key !== 'insights').every((i) => !i.text.includes(CITATION)));
  }

  // The rule the lane exists for: the same closed gate and the same analysis,
  // but no fetch log — so document 4 carries the refusal instead of the links,
  // and the three documents that are not the cited digest are untouched.
  const uncitedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'health-refresh-uncited-'));
  fs.cpSync(path.join(dir, 'sources'), path.join(uncitedDir, 'sources'), { recursive: true });
  fs.mkdirSync(path.join(uncitedDir, 'result'), { recursive: true });
  fs.writeFileSync(path.join(uncitedDir, 'result', 'health-analysis.json'), JSON.stringify({ at: '2026-10-01T08:00:00Z', sections: analysisPayload({ cite: CITATION }) }));
  const uncitedRun = await runHealthRefresh({
    workspace: uncitedDir,
    env,
    fetchImpl: makeFetch({ age: 43, height: 163, weight: 62, dateOfBirth: '1983-06-15' }, fullFixture),
    now: new Date('2026-10-01T09:00:00Z'),
    token: 't',
    store: fakeStore(),
    templates: readTemplates(),
  });
  check('a cited claim with no fetch log refuses rather than publishing', uncitedRun.ok === true, uncitedRun.error || '');
  if (uncitedRun.ok) {
    eq('the four document-4 sections are refused as unverified', uncitedRun.artifact.citationRefusals.map((c) => `${c.heading}=${c.reason}`), ['For this profile=unverified', 'By marker=unverified', 'Contradictory or unsettled evidence=unverified', 'What is not settled by the literature=unverified']);
    const uncitedInsights = uncitedRun.plan.items.find((i) => i.key === 'insights').text;
    check('the refusal sentence is what document 4 carries', uncitedInsights.includes('an unverified link is not a link'), uncitedInsights.slice(0, 400));
    check('no uncited claim reaches document 4', !uncitedInsights.includes(ANALYSIS_MARKER), uncitedInsights.slice(0, 400));
    check('documents 1\u20133 are unaffected by the citation contract', uncitedRun.plan.items.filter((i) => i.key !== 'insights').every((i) => i.citationRefused.length === 0), 'the contract leaked past document 4');
    check('and an analysis section still publishes outside document 4', uncitedRun.plan.items.find((i) => i.key === 'conditions').text.includes(ANALYSIS_MARKER));
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
  const refused = await runHealthAnalyze({ workspace: dir, env });
  check('analyze refuses while the gate is open', refused.ok === false && refused.stage === 'gate', JSON.stringify(refused));
  eq('the refusal names every open item', (refused.openItems || []).map((i) => i.id), ['H-1', 'H-6']);
  check('the refusal carries each item title', (refused.openItems || []).every((i) => i.title === FIX_TITLES[i.id]), JSON.stringify(refused.openItems));
  check('the refusal reply names the items', /H-1 Profile demographics match the sheet/.test(formatAnalyzeText(refused)), formatAnalyzeText(refused));
  const never = await runHealthAnalyze({ workspace: fs.mkdtempSync(path.join(os.tmpdir(), 'health-no-verify-')), env });
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
  // With the gate closed the producer runs; this workspace holds no brief, so
  // the refusal is the pack's, not the gate's — and it still writes nothing.
  const ready = await runHealthAnalyze({ workspace: analyzeDir, env });
  check('with the gate closed the producer runs and refuses on the pack, not the gate', ready.ok === false && ready.stage === 'context', JSON.stringify(ready).slice(0, 200));
  eq('that refusal wrote nothing', fs.readdirSync(path.join(analyzeDir, 'result')), ['health-verify.json']);
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
  eq('every artifact that is missing is named', ctx.absent.map((a) => a.key).sort(), ['docs', 'refresh', 'research']);
  const block = renderContextBlock(ctx);
  check('the rendered block names the absent artifacts as findings', /not present: result\/health-docs\.json/.test(block) && /not present: result\/health-refresh\.json/.test(block), block.slice(-400));
  check('and the missing literature log says no link may be cited yet', /no link can be cited in document 4 yet/.test(block), block.slice(-500));
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
  // The Doctor's report is checked before it is written, so the fake model has
  // to answer in the shape the seat promises. This workspace holds no analysis
  // payload, so the honest report reviews no claims and says so.
  const SENSOR_DOCTOR_REPORT = [
    "# Doctor's report — 2026-10-01",
    '',
    'Coverage: 0 claim(s) reviewed · sections seen: verify, fix_list',
    'Not seen: result/health-analysis.json — the analysis pass has not written a payload',
    'Gate: OPEN (H-1, H-2, H-3, H-4, H-5, H-6, H-7, H-8)',
    'Payload: not present',
  ].join('\n');
  const fakeModel = async ({ prompt }) => {
    captured.push(prompt);
    const isDoctor = /the seat that checks the other seats/.test(prompt);
    return { code: 0, finalText: isDoctor ? SENSOR_DOCTOR_REPORT : 'SEAT OUTPUT FOR THE SENSOR', lastError: null, sessionID: null, stderr: '', usage: { cost: 0, tokens: null } };
  };

  // Resolution is pure, so it is judged before any model is involved.
  const byId = resolveCouncilStage('data_steward', 'external-health');
  eq('a stage resolves by its seat id', [byId.ok, byId.phases.map((p) => p.id)], [true, ['data_steward']]);
  eq('a stage resolves through a role alias', resolveCouncilStage('steward', 'external-health').phases.map((p) => p.id), ['data_steward']);
  eq('a stage resolves by its number', resolveCouncilStage('2', 'external-health').phases.map((p) => p.id), ['health_analyst']);
  eq('all six seats are a stage', resolveCouncilStage('all', 'external-health').phases.length, 6);
  eq('the doctor is the last stage, by name and by number', [resolveCouncilStage('doctor', 'external-health').phases.map((p) => p.id), resolveCouncilStage('6', 'external-health').phases.map((p) => p.id)], [['doctor'], ['doctor']]);
  eq('the doctor stage writes its own report file and declares its checker', [resolveCouncilStage('doctor', 'external-health').phases[0].file, resolveCouncilStage('doctor', 'external-health').phases[0].validator], [DOCTOR_FILE, 'doctor']);
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
    eq('the project reports its own deliverables', status.deliverables.length, 6);
    check('the doctor report is one of them', status.deliverables.includes(DOCTOR_FILE), status.deliverables.join(','));
    check('the external-2 trio is never this project\'s deliverable', status.deliverables.every((d) => !d.startsWith('A_') && !d.startsWith('B_') && !d.startsWith('C_')), status.deliverables.join(','));
    eq('deliverables are not ready after one seat', status.deliverablesReady, false);
    eq('the status reply names the project pipeline', status.pipeline, 'roles');

    const all = await runCouncilStage('all', 'external-health', () => {}, { runGemini: fakeModel });
    // Seats run in the declared order — the manifest's, not the directory
    // listing's — which is also the order `/council status` numbers them.
    eq('all runs every seat in order', all.phases.map((p) => p.id), ['data_steward', 'health_analyst', 'test_planner', 'research_lead', 'safety_reviewer', 'doctor']);
    eq('the doctor runs last and its file is its own report', all.phases.at(-1), { id: 'doctor', file: DOCTOR_FILE, path: path.join(healthWs, 'result', DOCTOR_FILE) });
    eq('every deliverable exists after all', getCouncilStatus('external-health').deliverablesReady, true);
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
  // The literature lane's credential: a finding that names the variables, never a
  // blocker — the other seats run without it; document 4 is what stays uncited.
  const searchCheck = bare.checks.find((c) => c.key === 'search');
  eq('no search credential is a finding, not a blocker', [searchCheck.level, bare.blockers.includes('search')], ['finding', false]);
  check('the search finding carries the variables verbatim', /BRAVE_SEARCH_API_KEY/.test(searchCheck.detail) && /TAVILY_API_KEY/.test(searchCheck.detail) && /common\.env/.test(searchCheck.detail), searchCheck.detail);
  check('and says the lane refuses instead of recording an empty result', /never records an empty result/.test(searchCheck.detail), searchCheck.detail);
  eq('one search key of either Brave name turns it into an ok', [checkHealthReadiness({ paths, env: { BRAVE_API_KEY: 'x' }, now }).checks.find((c) => c.key === 'search').level, checkHealthReadiness({ paths, env: { BRAVE_SEARCH_API_KEY: 'x' }, now }).checks.find((c) => c.key === 'search').level], ['ok', 'ok']);
  check('the readiness reply is renderable', formatReadinessText(bare).includes('Not ready for bots'), formatReadinessText(bare).slice(0, 120));

  const withKey = checkHealthReadiness({ paths, env: { GEMINI_API_KEY: 'x', HEALTH_DOCS_FOLDER: 'folder', HEALTH_ENV_FILE: '/tmp/.env' }, now });
  eq('with a credential and host config it is ready', [withKey.ready, withKey.exit, withKey.blockers], [true, 0, []]);
  check('ready still reports the findings it has', withKey.findings.includes('verify') && withKey.findings.includes('analysis'), JSON.stringify(withKey.findings));
  check('a host with no search credential is still ready — a finding, not a blocker', withKey.findings.includes('search'), JSON.stringify(withKey.findings));
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

// ------------------------------------------------- 13. the Doctor seat and its checker
{
  // The checker first, on literal reports: every refusal names itself without a
  // model in the loop, so a regression cannot hide behind one.
  console.log('\n  — the doctor report checker —');
  const OPEN = { allowed: false, open: ['H-4'] };
  const report = ({ receipt = 'Receipt: ldl 2.1 mmol/L (2026-06-03) — result/health-analysis.json, analysis.conditions', status = 'Status: PASS' } = {}, {
    date = '2026-10-01',
    coverage = '1 claim(s) reviewed · sections seen: analysis.conditions',
    notSeen = 'none',
    gate = 'OPEN (H-4)',
    payload = '2026-10-01T08:00:00Z',
  } = {}) => [
    `# Doctor's report — ${date}`,
    '',
    `Coverage: ${coverage}`,
    `Not seen: ${notSeen}`,
    `Gate: ${gate}`,
    `Payload: ${payload}`,
    '',
    '## 1. The LDL fall',
    'Claim: "LDL fell to 2.1 mmol/L on 2026-06-03."',
    receipt,
    status,
    'Changes: the claim stands as written.',
    'Recommendation: nothing',
    'Who: health_analyst',
  ].join('\n');
  const checkRefusal = (name, text, opts, pattern) => {
    const res = validateDoctorReport(text, opts);
    check(name, res.ok === false && pattern.test(res.error || ''), res.ok ? 'accepted' : res.error);
  };
  const accepted = { analysis: 'accepted', gate: OPEN };
  const good = validateDoctorReport(report(), accepted);
  check('a well-formed report passes the checker', good.ok === true, good.error);
  eq('the checker reads the verdict and the count', [good.report.counts.pass, good.report.coverage.reviewed], [1, 1]);
  check('the checker keeps the receipt with the verdict', /ldl 2\.1 mmol\/L \(2026-06-03\)/.test(good.report.claims[0]?.receipt || ''), JSON.stringify(good.report.claims[0]));
  checkRefusal('a report with no heading is refused', report().replace("# Doctor's report — 2026-10-01\n\n", ''), accepted, /heading/);
  checkRefusal('a report with no coverage header is refused', report({}, { coverage: '' }), accepted, /coverage header/);
  checkRefusal('a coverage line with no count is refused', report({}, { coverage: 'reviewed everything' }), accepted, /count/);
  checkRefusal('a header without the gate line is refused', report({}, { gate: '' }), accepted, /Gate/);
  checkRefusal('a header without the payload line is refused', report({}, { payload: '' }), accepted, /Payload/);
  checkRefusal('a finding with no receipt is refused', report({ receipt: 'Changes: hidden by the rewrite' }), accepted, /Receipt/);
  checkRefusal('a block missing any of the six labels is refused', report({ status: 'Recommendation: nothing' }), accepted, /Status/);
  checkRefusal('a PASS on an absence is refused', report({ receipt: 'Receipt: not measured — nothing contradicted it' }), accepted, /absence/);
  checkRefusal('a PASS with no date is refused', report({ receipt: 'Receipt: ldl 2.1 mmol/L — the sheet agrees' }), accepted, /date/);
  checkRefusal('a PASS on an open item is refused', report({ status: 'Status: PASS (H-4)' }), accepted, /open item H-4/);
  checkRefusal('a verdict that is not PASS/STRIKE/UNPROVEN is refused', report({ status: 'Status: MAYBE' }), accepted, /no verdict/);
  checkRefusal('a report claiming claims with no payload is refused', report(), { analysis: 'absent', gate: OPEN }, /no readable payload/);
  checkRefusal('a report over a present payload that reviews nothing is refused', report({}, { coverage: '0 claim(s) reviewed · sections seen: analysis.conditions' }), accepted, /checks nothing/);
  checkRefusal('the count must match the blocks', report({}, { coverage: '2 claim(s) reviewed · sections seen: analysis.conditions' }), accepted, /2 claim\(s\) reviewed but the report carries 1 block/);
  const zeroReport = (notSeen) => [
    "# Doctor's report — 2026-10-01",
    '',
    'Coverage: 0 claim(s) reviewed · sections seen: verify, fix_list',
    `Not seen: ${notSeen}`,
    'Gate: OPEN (H-4)',
    'Payload: not present',
  ].join('\n');
  checkRefusal('a 0-claim report must name the payload it could not read', zeroReport('none'), { analysis: 'absent', gate: OPEN }, /Not seen/);
  checkRefusal('a 0-claim report with a claim block is refused', report({}, { coverage: '0 claim(s) reviewed · sections seen: verify' }), { analysis: 'absent', gate: OPEN }, /nothing to check/);
  const empty = validateDoctorReport('', { analysis: 'absent' });
  check('an empty report is refused', empty.ok === false && /empty/.test(empty.error), JSON.stringify(empty));
  const honest = validateDoctorReport(report({ receipt: 'Receipt: not measured — the sheet has no weight since 2024-10-23', status: 'Status: UNPROVEN (H-4)' }), accepted);
  check('the same absence is accepted as UNPROVEN', honest.ok === true && honest.report.counts.unproven === 1, honest.error);
  const zero = validateDoctorReport(zeroReport('result/health-analysis.json — no payload has been written'), { analysis: 'absent', gate: OPEN });
  check('the honest 0-claim report is accepted when there is no payload', zero.ok === true && zero.report.coverage.reviewed === 0, zero.error);

  // The runner, on a copy of a real workspace: the report lands, the receipts
  // land, and every other byte — the Docs registry included — is untouched.
  console.log('\n  — the doctor run, end to end —');
  const ACCEPTED_REPORT = [
    "# Doctor's report — 2026-10-01",
    '',
    'Coverage: 3 claim(s) reviewed · sections seen: analysis.conditions, analysis.trends',
    'Not seen: none',
    'Gate: OPEN (H-4, H-6)',
    'Payload: 2026-10-01T08:00:00Z',
    '',
    '## 1. The LDL fall',
    'Claim: "LDL fell to 2.1 mmol/L on 2026-06-03."',
    'Receipt: ldl 2.1 mmol/L (2026-06-03) — result/health-analysis.json, analysis.conditions',
    'Status: PASS',
    'Changes: the claim stands as written.',
    'Recommendation: nothing',
    'Who: health_analyst',
    '',
    '## 2. The HbA1c trend',
    'Claim: "HbA1c is rising across 2025."',
    'Receipt: hba1c 40 mmol/mol (2026-06-05) — one dated point in the sheet, and the payload names no earlier value',
    'Status: STRIKE',
    'Changes: a trend needs two dated points; the claim is struck until an earlier value is named.',
    'Recommendation: take it to a GP with these numbers',
    'Who: health_analyst',
    '',
    '## 3. The weight change since March',
    'Claim: "Weight is unchanged since March 2025."',
    'Receipt: not measured — the sheet holds body weight on 2024-10-23 only, and no 2025 value exists',
    'Status: UNPROVEN (H-4)',
    'Changes: the row is an open fix-list item; until it closes the claim cannot pass.',
    'Recommendation: fix it in the app',
    'Who: data_steward',
  ].join('\n');
  const makeWorkspace = ({ payload = true } = {}) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'health-doctor-'));
    fs.mkdirSync(path.join(dir, 'result'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'BRIEF.md'), '# Brief\n\nFour living documents.\n');
    fs.writeFileSync(path.join(dir, 'result', 'health-verify.json'), JSON.stringify({ ...fixtureArtifact('open'), summary: { match: 2, missing: 1, appOnlyUnreviewed: 1, gap: 1 } }));
    fs.writeFileSync(path.join(dir, 'result', 'health-fix-list.md'), '# Data fix list\n\n- [ ] **H-1 — mis-filed rows**\n');
    fs.writeFileSync(path.join(dir, 'result', 'health-docs.json'), JSON.stringify({ updatedAt: '2026-10-01T00:00:00Z', docs: { snapshot: { id: 'doc_snapshot', at: '2026-10-01T00:00:00Z' } }, history: [] }, null, 1));
    if (payload) fs.writeFileSync(path.join(dir, 'result', 'health-analysis.json'), JSON.stringify({ at: '2026-10-01T08:00:00Z', sections: analysisPayload() }));
    return dir;
  };
  const pathsFor = (dir) => ({ workspace: dir, sources: path.join(dir, 'sources'), result: path.join(dir, 'result') });
  const tree = (dir) => {
    const out = {};
    const walk = (rel) => {
      for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
        const r = rel === '.' ? e.name : path.join(rel, e.name);
        if (e.isDirectory()) walk(r);
        else out[r] = contentHash(fs.readFileSync(path.join(dir, r), 'utf8'));
      }
    };
    walk('.');
    return out;
  };
  const scratch = [];

  // No credential: the refusal comes before the model, and it is actionable.
  const noKeyDir = makeWorkspace();
  scratch.push(noKeyDir);
  const noKey = await runHealthDoctor({ paths: pathsFor(noKeyDir), env: {} });
  check('with no credential the doctor refuses before the model', noKey.ok === false && noKey.stage === 'credential', JSON.stringify(noKey).slice(0, 200));
  check('the refusal names the key and the file it goes in', /GEMINI_API_KEY/.test(noKey.error) && /common\.env/.test(noKey.error), noKey.error);
  eq('a refused run writes nothing', Object.keys(tree(noKeyDir)).sort(), ['BRIEF.md', 'result/health-analysis.json', 'result/health-docs.json', 'result/health-fix-list.md', 'result/health-verify.json']);

  const dir = noKeyDir;
  const before = tree(dir);
  const prompts = [];
  const doctorModel = async ({ prompt }) => { prompts.push(prompt); return { finalText: ACCEPTED_REPORT, code: 0, lastError: null }; };
  const run = await runHealthDoctor({ paths: pathsFor(dir), env: {}, runGemini: doctorModel });
  check('the doctor run succeeds with the model seam', run.ok === true, run.error || '');
  if (run.ok) {
    eq('it counts the verdicts it read', run.artifact.counts, { pass: 1, strike: 1, unproven: 1 });
    eq('it records the payload state and the open gate', [run.artifact.analysis.state, run.artifact.gate.open.length], ['accepted', 8]);
    check('the report lands on the declared path', fs.existsSync(path.join(dir, 'result', DOCTOR_FILE)), fs.readdirSync(path.join(dir, 'result')).join(','));
    check('the machine-readable receipt holds the claims', Array.isArray(run.artifact.claims) && run.artifact.claims.length === 3, JSON.stringify(run.artifact.claims).slice(0, 120));
    const reply = formatDoctorText(run);
    check('the reply names the verdicts, the gate and the report', /1 PASS/.test(reply) && /OPEN \(H-1/.test(reply) && reply.includes(DOCTOR_FILE), reply);
    check('the reply says the documents were not touched', /not touched/.test(reply), reply);
    check('the seat was handed the payload it reviews', /The analysis payload under review/.test(prompts.at(-1) || '') && /shape: accepted/.test(prompts.at(-1) || ''), (prompts.at(-1) || '').slice(0, 160));
    check('the seat was told what to do with the claims', /STRIKE what does not hold/.test(prompts.at(-1) || ''), 'the mandate never reached the prompt');
    const after = tree(dir);
    const added = Object.keys(after).filter((f) => !(f in before)).sort();
    eq('exactly two files were added, both the doctor\u2019s own', added, [`result/${DOCTOR_FILE}`, `result/${DOCTOR_ARTIFACT}`]);
    check('every pre-existing byte is unchanged (the Docs registry included)', Object.keys(before).every((f) => after[f] === before[f]), Object.keys(before).filter((f) => after[f] !== before[f]).join(','));
    check('the report on disk carries the coverage header the checker read', /^Coverage: 3 claim\(s\) reviewed/m.test(fs.readFileSync(path.join(dir, 'result', DOCTOR_FILE), 'utf8')), 'the report header is missing');
  }

  // A model that answers in the wrong shape writes nothing at all — the whole
  // point of the checker is that a confident non-report cannot land.
  const badDir = makeWorkspace();
  scratch.push(badDir);
  const badBefore = tree(badDir);
  const bad = await runHealthDoctor({ paths: pathsFor(badDir), env: {}, runGemini: async () => ({ finalText: 'I reviewed the claims and they look fine to me.', code: 0, lastError: null }) });
  check('a report the checker refuses is a refusal, not a write', bad.ok === false && bad.stage === 'report', JSON.stringify({ stage: bad.stage, error: bad.error }));
  check('the refusal says which rule it broke', /heading/.test(bad.error || ''), bad.error);
  eq('the refused run wrote nothing', Object.keys(tree(badDir)).sort(), Object.keys(badBefore).sort());
  const modelFail = await runHealthDoctor({ paths: pathsFor(badDir), env: {}, runGemini: async () => { throw new Error('no lane'); } });
  check('a failed model call writes nothing', modelFail.ok === false && modelFail.stage === 'model' && /model call failed/.test(modelFail.error), JSON.stringify(modelFail).slice(0, 200));

  // No brief: the pack refuses, so there is no seat turn at all.
  const bareDir = fs.mkdtempSync(path.join(os.tmpdir(), 'health-doctor-bare-'));
  scratch.push(bareDir);
  const bare = await runHealthDoctor({ paths: pathsFor(bareDir), env: {}, runGemini: doctorModel });
  check('a workspace with no brief is refused before the model', bare.ok === false && bare.stage === 'context', JSON.stringify(bare).slice(0, 200));
  eq('the context refusal wrote nothing', fs.readdirSync(bareDir), []);

  // The CLI door: a refusal is an answer, so it exits 3 with the JSON saying why.
  const runner = path.join(ROOT, 'scripts', 'health-runner.mjs');
  const cliDir = makeWorkspace({ payload: false });
  scratch.push(cliDir);
  const cliEnv = { ...process.env, HEALTH_WORKSPACE: cliDir, GEMINI_API_KEY: '', GOOGLE_API_KEY: '', API_KEY: '', GEMINI_API_KEYS: '' };
  let cliCode = 0;
  let cliOut = '';
  try {
    cliOut = execFileSync(process.execPath, [runner, '--doctor', '--json'], { env: cliEnv, encoding: 'utf8' });
  } catch (err) {
    cliCode = err.status;
    cliOut = err.stdout || '';
  }
  const cliJson = JSON.parse(cliOut || '{}');
  eq('the CLI exits 3 when the doctor cannot run', cliCode, 3);
  eq('and its JSON says why', cliJson.stage, 'credential');

  // The other door: `/council doctor` runs the same seat and the same checker,
  // and the file it writes is the one the status reader reads.
  console.log('\n  — the doctor through the council stage door —');
  const health = KNOWN_PROJECTS['external-health'];
  const originalWs = health.workspace;
  const ws = makeWorkspace();
  scratch.push(ws);
  health.workspace = ws;
  try {
    const staged = await runCouncilStage('doctor', 'external-health', () => {}, { runGemini: async () => ({ finalText: ACCEPTED_REPORT, code: 0, lastError: null }) });
    const written = path.join(ws, 'result', DOCTOR_FILE);
    check('the stage door writes the declared report, not a numbered transcript', fs.existsSync(written) && !fs.existsSync(path.join(ws, 'result', '06_doctor.md')), fs.readdirSync(path.join(ws, 'result')).join(','));
    eq('the stage result names that file as its deliverable', staged.deliverables, [written]);
    const status = getCouncilStatus('external-health');
    eq('the doctor is the last phase and its report reads back as complete', [status.phases.at(-1).phase, status.phases.at(-1).completed, status.phases.at(-1).outputFile], ['doctor', true, written]);
    eq('the project now reports six deliverables', status.deliverables.length, 6);
    check('the doctor report is one of the deliverables', status.deliverables.includes(DOCTOR_FILE), status.deliverables.join(','));
    eq('the phases are numbered in the declared order, doctor last', getCouncilPhases('external-health').map((p) => p.file), ['01_data_steward.md', '02_health_analyst.md', '03_test_planner.md', '04_research_lead.md', '05_safety_reviewer.md', DOCTOR_FILE]);
    let refusedStage = '';
    try {
      await runCouncilStage('doctor', 'external-health', () => {}, { runGemini: async () => ({ finalText: 'looks good to me', code: 0, lastError: null }) });
    } catch (err) { refusedStage = err.message; }
    check('the stage door refuses a malformed report too', /checker refuses/.test(refusedStage), refusedStage);
    check('and the refused re-run left the checked report in place', fs.readFileSync(written, 'utf8').includes('# Doctor'), 'the good report was overwritten');
  } finally {
    health.workspace = originalWs;
  }
  for (const d of scratch) fs.rmSync(d, { recursive: true, force: true });
}

// ------------------------------------------------- 14. the literature lane
{
  console.log('\n  — the literature lane —');
  const scratch = [];
  const templates = readTemplates();
  const lanePaths = (dir) => ({ workspace: dir, sources: path.join(dir, 'sources'), result: path.join(dir, 'result') });
  const logPath = (dir) => path.join(dir, 'result', 'health-research.json');
  const PAGE = '<title>D and strength</title><p>body</p>';
  const pageFetch = async () => ({ ok: true, status: 200, text: async () => PAGE });
  const stubSearch = (hits) => async ({ query }) => ({ ok: true, provider: 'brave', query, hits, attempts: [] });
  const CLEARED_SEARCH = { BRAVE_SEARCH_API_KEY: '', BRAVE_API_KEY: '', TAVILY_API_KEY: '', GOOGLE_SEARCH_API_KEY: '', GOOGLE_SEARCH_CX: '' };
  const treeOf = (dir) => {
    const out = {};
    const walk = (rel) => {
      for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
        const r = rel === '.' ? e.name : path.join(rel, e.name);
        if (e.isDirectory()) walk(r);
        else out[r] = contentHash(fs.readFileSync(path.join(dir, r), 'utf8'));
      }
    };
    walk('.');
    return out;
  };

  // The contract's scope is the document-4 template's own analysis sections, so
  // a template edit that adds a section cannot quietly fall out of the contract.
  eq('every document-4 analysis section is under the citation contract', sectionPlan(templates.insights).filter((s) => (s.source || '').startsWith('analysis.')).map((s) => s.source), CITATION_SOURCES);

  // Who can search at all: every declared provider reports its own variables, so
  // a missing credential is a named finding rather than an empty result.
  const none = searchAvailability({});
  check('a host with no search credential reports the chain as unusable', none.ok === false && none.ready.length === 0);
  eq('and names every variable that would fix it, in declared order', none.missing, ['BRAVE_SEARCH_API_KEY', 'BRAVE_API_KEY', 'TAVILY_API_KEY', 'GOOGLE_SEARCH_API_KEY', 'GOOGLE_SEARCH_CX']);
  check('one Brave key under either name is enough', searchAvailability({ BRAVE_API_KEY: 'k' }).ready.includes('brave') && searchAvailability({ BRAVE_SEARCH_API_KEY: 'k' }).ok === true);
  check('a provider that needs two variables is not ready on one', searchAvailability({ GOOGLE_SEARCH_API_KEY: 'k' }).ready.includes('google-cse') === false);

  // The provider chain: a provider that fails falls through, and a provider that
  // answered nothing is a failure rather than a silent empty result.
  const chainFetch = async (url) => {
    if (String(url).includes('brave')) return { ok: false, status: 429, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => ({ results: [{ title: 'Vitamin D and strength', url: 'https://example.test/d-2024', description: 's' }] }) };
  };
  const chained = await webSearch({ query: 'vitamin D and strength', env: { BRAVE_SEARCH_API_KEY: 'b', TAVILY_API_KEY: 't' }, fetchImpl: chainFetch });
  check('a provider that fails falls through to the next declared one', chained.ok === true && chained.provider === 'tavily' && chained.hits.length === 1, JSON.stringify(chained).slice(0, 200));
  eq('and the failed attempt is reported, not hidden', chained.attempts, [{ provider: 'brave', error: 'HTTP 429' }]);
  const nothing = await webSearch({ query: 'q', env: { BRAVE_SEARCH_API_KEY: 'b' }, fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ results: [] }) }) });
  check('a provider that answered nothing is a failure, not an empty result', nothing.ok === false && nothing.reason === 'failed' && /no results/.test(nothing.error), nothing.error);
  const noCred = await webSearch({ query: 'q', env: {} });
  check('no credential is refused before any request is made', noCred.ok === false && noCred.reason === 'no-credential' && /BRAVE_SEARCH_API_KEY/.test(noCred.error));

  // fetchHit: the receipt a citation rests on.
  const kept = await fetchHit({ url: 'https://example.test/d-2024', title: '', query: 'vitamin D and strength' }, { fetchImpl: pageFetch, now: new Date('2026-10-01T07:00:00Z') });
  check('a fetched hit is recorded with its status, size, title and hash', kept.ok === true && kept.status === 200 && kept.bytes === Buffer.byteLength(PAGE) && /^[0-9a-f]{64}$/.test(kept.sha256) && kept.title === 'D and strength' && kept.fetchedAt === '2026-10-01T07:00:00.000Z', JSON.stringify(kept).slice(0, 200));
  const gone = await fetchHit({ url: 'https://example.test/gone' }, { fetchImpl: async () => ({ ok: false, status: 404, text: async () => '' }) });
  check('a 404 is a refusal, not a citation', gone.ok === false && gone.status === 404 && gone.sha256 === '', JSON.stringify(gone).slice(0, 160));
  const blank = await fetchHit({ url: 'https://example.test/blank' }, { fetchImpl: async () => ({ ok: true, status: 200, text: async () => '' }) });
  check('an empty body is a refusal too — there is nothing to hash', blank.ok === false && /empty body/.test(blank.error), blank.error);
  const notHttp = await fetchHit({ url: 'javascript:alert(1)' }, { fetchImpl: async () => { throw new Error('the network was called for a non-http url'); } });
  check('a non-http url never reaches the network', notHttp.ok === false && notHttp.status === 0, JSON.stringify(notHttp));

  // The document-4 citation contract, on literal lines.
  const liveLog = researchLog({ fetched: [CITATION], refused: ['https://example.test/refused-2024'] });
  check('a line with a fetched, dated link passes', validateInsightCitations([`- HbA1c 40 — Khor 2024, 2024, ${CITATION}`], { log: liveLog }).ok === true);
  const uncitedLine = validateInsightCitations(['- HbA1c is rising across 2025.'], { log: liveLog });
  check('a line with no link is refused as uncited', uncitedLine.ok === false && uncitedLine.reason === 'uncited', JSON.stringify(uncitedLine).slice(0, 200));
  const unverifiedLine = validateInsightCitations(['- HbA1c 40 — Khor 2024, 2024, https://example.test/never-fetched'], { log: liveLog });
  check('a link the lane never fetched is refused as unverified', unverifiedLine.ok === false && unverifiedLine.reason === 'unverified' && unverifiedLine.unverified.includes('https://example.test/never-fetched'));
  check('a link the lane fetched and refused is not citable either', validateInsightCitations(['- HbA1c 40 — Khor 2024, 2024, https://example.test/refused-2024'], { log: liveLog }).reason === 'unverified');
  check('with no log at all, every link is unverifiable', validateInsightCitations([`- HbA1c 40 — Khor 2024, 2024, ${CITATION}`], { log: null }).reason === 'unverified');
  check('a cited line with no year is refused as undated', validateInsightCitations([`- HbA1c 40 — see ${CITATION}`], { log: liveLog }).reason === 'undated');
  check('a year inside the url is not the citation\u2019s own year', validateInsightCitations([`- HbA1c 40 — the study at ${CITATION}`], { log: liveLog }).reason === 'undated');
  check('an empty section is the honest state, not a refusal', validateInsightCitations([], { log: liveLog }).ok === true);
  check('the refusal says an unverified link is not a link', /unverified link is not a link/.test(citationRefusalText(unverifiedLine)));

  // The lane itself: a refusal records nothing, a success writes the log.
  const laneDir = fs.mkdtempSync(path.join(os.tmpdir(), 'health-research-lane-'));
  scratch.push(laneDir);
  const refusedRun = await runHealthResearch({ paths: lanePaths(laneDir), env: {}, queries: ['vitamin D and strength'] });
  check('the lane refuses when no provider can run', refusedRun.ok === false && refusedRun.stage === 'credential', JSON.stringify(refusedRun).slice(0, 200));
  check('the refusal names the file the credential belongs in', /~\/\.config\/bot-host\/common\.env/.test(refusedRun.error), refusedRun.error);
  eq('and records nothing at all', fs.readdirSync(laneDir), []);
  check('the reply says nothing was searched and nothing recorded', /Nothing was searched and nothing was recorded/.test(formatResearchText(refusedRun)), formatResearchText(refusedRun).slice(0, 200));
  check('a lane run with no query refuses too', (await runHealthResearch({ paths: lanePaths(laneDir), env: { BRAVE_API_KEY: 'k' } })).stage === 'query');

  // The credential may sit in the file readiness names, not in the process env.
  const laneEnvFile = path.join(laneDir, 'common.env');
  fs.writeFileSync(laneEnvFile, 'BRAVE_API_KEY=from-the-file\n');
  const laneRun = await runHealthResearch({
    paths: lanePaths(laneDir),
    env: {},
    envFile: laneEnvFile,
    queries: ['vitamin D and strength'],
    search: stubSearch([{ title: 'Vitamin D and strength', url: 'https://example.test/d-2024', snippet: 's' }]),
    fetchImpl: pageFetch,
    now: new Date('2026-10-01T07:00:00Z'),
  });
  check('the lane runs on the credential in the file readiness names', laneRun.ok === true && laneRun.artifact.fetched === 1, laneRun.error || '');
  const laneLog = JSON.parse(fs.readFileSync(logPath(laneDir), 'utf8'));
  check('the log records the hit with the same hash fetchHit computed', laneLog.hits['https://example.test/d-2024'].sha256 === kept.sha256 && laneLog.hits['https://example.test/d-2024'].firstFetchedAt === '2026-10-01T07:00:00.000Z', JSON.stringify(laneLog.hits['https://example.test/d-2024']).slice(0, 200));
  eq('the log keeps the query that produced it', laneLog.queries.map((q) => q.query), ['vitamin D and strength']);
  check('the artifact names the provider and the file it wrote', laneRun.artifact.provider === 'brave' && laneRun.artifact.file === logPath(laneDir));

  // A re-run is the union of the runs: a hit that now refuses is recorded as
  // refused, and the citable hit keeps its first receipt.
  const rerun = await runHealthResearch({
    paths: lanePaths(laneDir),
    env: {},
    envFile: laneEnvFile,
    queries: ['vitamin D and strength'],
    search: stubSearch([{ title: 'Vitamin D and strength', url: 'https://example.test/d-2024', snippet: 's' }, { title: 'Gone', url: 'https://example.test/gone', snippet: '' }]),
    fetchImpl: async (url) => (String(url).includes('gone') ? { ok: false, status: 500, text: async () => '' } : pageFetch(url)),
    now: new Date('2026-11-02T07:00:00Z'),
  });
  const laneLog2 = JSON.parse(fs.readFileSync(logPath(laneDir), 'utf8'));
  check('a hit that refused on the re-run is in the log, marked not citable', laneLog2.hits['https://example.test/gone'].ok === false);
  check('the citable hit keeps its first receipt and gains a newer fetch', laneLog2.hits['https://example.test/d-2024'].firstFetchedAt === '2026-10-01T07:00:00.000Z' && laneLog2.hits['https://example.test/d-2024'].fetchedAt === '2026-11-02T07:00:00.000Z', JSON.stringify(laneLog2.hits['https://example.test/d-2024']).slice(0, 200));
  check('the artifact reports what was fetched and what refused', rerun.artifact.fetched === 1 && rerun.artifact.refusedHits.length === 1 && rerun.artifact.recorded === 2, JSON.stringify({ fetched: rerun.artifact.fetched, refused: rerun.artifact.refusedHits.length }));
  check('and the reply says which of the two cannot be cited', /not citable/.test(formatResearchText(rerun)), formatResearchText(rerun).slice(0, 300));

  // A query no provider could answer is a refusal with nothing written.
  const deadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'health-research-dead-'));
  scratch.push(deadDir);
  const dead = await runHealthResearch({ paths: lanePaths(deadDir), env: { BRAVE_API_KEY: 'k' }, queries: ['q'], search: async ({ query }) => ({ ok: false, reason: 'failed', error: 'every declared provider refused the query', query, hits: [], attempts: [] }) });
  check('a query no provider could answer is a refusal, not an empty log', dead.ok === false && dead.stage === 'search', JSON.stringify(dead).slice(0, 200));
  eq('and it wrote nothing', fs.readdirSync(deadDir), []);

  // The publisher's own clock: a snapshot past the renewal window may not carry
  // a claim about now, and the header says which of the two reasons withheld it.
  const freshArtifact = fixtureArtifact('closed');
  const atNow = new Date(freshArtifact.at);
  const freshGate = gateFromArtifact(freshArtifact, { now: new Date(atNow.getTime() + 5 * 86400000) });
  check('a snapshot inside the renewal window is current', freshGate.stale === false && freshGate.ageDays === 5 && freshGate.analysisAllowed === true, JSON.stringify(freshGate).slice(0, 200));
  const staleArtifact = { ...fixtureArtifact('closed'), at: new Date(atNow.getTime() - (STALE_AFTER_DAYS + 30) * 86400000).toISOString() };
  const staleGate = gateFromArtifact(staleArtifact, { now: atNow });
  check('a snapshot past the renewal window is stale', staleGate.stale === true && staleGate.ageDays === STALE_AFTER_DAYS + 30 && staleGate.allowed === true && staleGate.analysisAllowed === false, JSON.stringify(staleGate).slice(0, 200));
  const staleDoc = renderDoc({ spec: DOC_SPECS[1], templateText: templates.conditions, artifact: staleArtifact, analysis: analysisPayload({ cite: CITATION }), registry: {}, now: atNow });
  check('a stale document says STALE in its header and names the window', /STALE SNAPSHOT/.test(staleDoc.text) && /renewal window 31/.test(staleDoc.text), staleDoc.text.split('\n').slice(0, 4).join(' | '));
  check('every analysis section carries the stale refusal', staleDoc.refused.length === 4 && staleDoc.text.includes(staleRefusalText(staleGate)), JSON.stringify(staleDoc.refused));
  check('and no analysis line reaches a stale document', !staleDoc.text.includes(ANALYSIS_MARKER), 'the analysis leaked into a stale snapshot');
  eq('a stale run is a draft, not an analysis', planPublish({ artifact: staleArtifact, analysis: analysisPayload({ cite: CITATION }), templates, registry: {}, now: atNow }).mode, 'draft');
  check('an undated artifact cannot claim to be current', gateFromArtifact({ fixList: { items: [] } }, { now: atNow }).stale === true);
  check('without a clock the gate does not invent an age', gateFromArtifact(staleArtifact).stale === false && gateFromArtifact(staleArtifact).ageDays === null);

  // The contract is document 4 only: the same uncited payload is refused there
  // and published everywhere else.
  const uncitedDoc = renderDoc({ spec: DOC_SPECS[3], templateText: templates.insights, artifact: freshArtifact, analysis: analysisPayload(), registry: {}, now: atNow });
  eq('document 4 refuses a payload whose lines carry no link', [uncitedDoc.refused.length, uncitedDoc.citationRefused.map((c) => c.reason)], [4, ['uncited', 'uncited', 'uncited', 'uncited']]);
  check('and the published bytes carry the contract\u2019s own sentence', uncitedDoc.text.includes('unverified link is not a link'));
  check('no uncited claim reaches document 4', !uncitedDoc.text.includes(ANALYSIS_MARKER));
  eq('documents 1\u20133 are not subject to the citation contract', renderDoc({ spec: DOC_SPECS[1], templateText: templates.conditions, artifact: freshArtifact, analysis: analysisPayload(), registry: {}, now: atNow }).citationRefused, []);
  const citedDoc = renderDoc({ spec: DOC_SPECS[3], templateText: templates.insights, artifact: freshArtifact, analysis: analysisPayload({ cite: CITATION }), citations: liveLog, registry: {}, now: atNow });
  check('the same document publishes when the log holds the link', citedDoc.refused.length === 0 && citedDoc.text.includes(CITATION), JSON.stringify(citedDoc.refused));
  check('a link the log never recorded is still refused', renderDoc({ spec: DOC_SPECS[3], templateText: templates.insights, artifact: freshArtifact, analysis: analysisPayload({ cite: 'https://example.test/elsewhere' }), citations: liveLog, registry: {}, now: atNow }).citationRefused.every((c) => c.reason === 'unverified'));

  // The real command surface: the CLI door exits 3 with the stage in its JSON.
  const laneCliEnv = { ...process.env, HEALTH_WORKSPACE: laneDir, ...CLEARED_SEARCH, GEMINI_API_KEY: '', GOOGLE_API_KEY: '', API_KEY: '', GEMINI_API_KEYS: '' };
  let laneCode = 0;
  let laneOut = '';
  try {
    laneOut = execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'health-runner.mjs'), '--research', '--query=vitamin D and strength', '--json'], { env: laneCliEnv, encoding: 'utf8' });
  } catch (err) {
    laneCode = err.status;
    laneOut = err.stdout || '';
  }
  eq('the CLI exits 3 when no provider can run', laneCode, 3);
  eq('and its JSON names the stage that refused', JSON.parse(laneOut || '{}').stage, 'credential');

  // The real workspace, copied: the lane runs there, a seat's pack lists the
  // links it may cite, and every byte of the user's own folder is unchanged.
  const REAL = KNOWN_PROJECTS['external-health'].workspace;
  if (fs.existsSync(REAL)) {
    const before = treeOf(REAL);
    const copy = fs.mkdtempSync(path.join(os.tmpdir(), 'health-research-live-'));
    scratch.push(copy);
    fs.cpSync(REAL, copy, { recursive: true });
    const LIVE_LINK = 'https://example.test/hba1c-cvd-2025';
    const live = await runHealthResearch({
      paths: lanePaths(copy),
      env: { BRAVE_API_KEY: 'seam' },
      queries: ['HbA1c and cardiovascular risk'],
      search: stubSearch([{ title: 'HbA1c and CVD', url: LIVE_LINK, snippet: 's' }, { title: 'Gone', url: 'https://example.test/gone', snippet: '' }]),
      fetchImpl: async (url) => (String(url).includes('gone') ? { ok: false, status: 500, text: async () => '' } : { ok: true, status: 200, text: async () => '<title>HbA1c and CVD</title>body' }),
      now: atNow,
    });
    check('the lane runs against a copy of the real workspace', live.ok === true && live.artifact.fetched === 1 && live.artifact.refusedHits.length === 1, live.error || '');
    eq('and the user\u2019s own folder is byte-identical afterwards', treeOf(REAL), before);
    const liveCtx = buildHealthContext(copy);
    const researchSection = liveCtx.sections.find((s) => s.key === 'research');
    check('the pack a seat is handed lists the recorded link', Boolean(researchSection) && researchSection.text.includes(LIVE_LINK), (researchSection?.text || '').slice(0, 300));
    check('and marks the refused hit as not citable', /\(not citable\)/.test(researchSection?.text || ''), 'a refused hit was presented as citable');
    check('the pack states the citation rule', /Cite only a url listed as ok/.test(researchSection?.text || ''));
    const copyLog = loadResearchLog(logPath(copy));
    check('the copy\u2019s own log accepts a citation of what it fetched', validateInsightCitations([`- HbA1c and CVD risk — Author 2025, 2025, ${LIVE_LINK}`], { log: copyLog }).ok === true);
    check('and still refuses a link it never fetched', validateInsightCitations(['- HbA1c and CVD risk — Author 2025, 2025, https://example.test/elsewhere'], { log: copyLog }).reason === 'unverified');
    check('document 4 publishes the live link and refuses the foreign one', renderDoc({ spec: DOC_SPECS[3], templateText: templates.insights, artifact: freshArtifact, analysis: { 'analysis.by_marker': [`- HbA1c and CVD risk — Author 2025, 2025, ${LIVE_LINK}`] }, citations: copyLog, registry: {}, now: atNow }).refused.length === 0);
  }

  for (const d of scratch) fs.rmSync(d, { recursive: true, force: true });
}

// ------------------------------------------------- 15. the vendor contracts
{
  console.log('\n  — the vendor contracts —');
  // The three search APIs are vendor contracts: endpoint, method, where the
  // credential goes, which response field carries a hit. This section drives the
  // lane's real entry point against recorded responses for each of them — the
  // documented envelope and the answers a real API gives when it says no.
  const scratch = [];
  const spec = loadSearchFixture(FIXTURE_FILE);
  const SHIM_FILE = path.join(ROOT, 'scripts', 'fixtures', 'search-provider-shim.mjs');
  const lanePaths = (dir) => ({ workspace: dir, sources: path.join(dir, 'sources'), result: path.join(dir, 'result') });
  const laneDir = (tag) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), `health-vendor-${tag}-`));
    scratch.push(dir);
    return dir;
  };
  const readLog = (dir) => JSON.parse(fs.readFileSync(path.join(dir, 'result', RESEARCH_LOG), 'utf8'));
  const CLEARED_SEARCH = { BRAVE_SEARCH_API_KEY: '', BRAVE_API_KEY: '', TAVILY_API_KEY: '', GOOGLE_SEARCH_API_KEY: '', GOOGLE_SEARCH_CX: '' };
  const laneRun = async (dir, env, cases = {}) => {
    const calls = [];
    const res = await runHealthResearch({
      paths: lanePaths(dir),
      env,
      queries: [spec.query],
      fetchImpl: recordedFetch(spec, { cases, onCall: (c) => calls.push(c) }),
    });
    return { res, calls };
  };
  const sha256 = (text) => crypto.createHash('sha256').update(text).digest('hex');
  const pageOf = (url) => spec.pages.find((p) => p.url === url);

  // 1. Each provider, alone: the request it must send, and the field its hits
  //    actually live in. A wrong endpoint, a credential in the wrong place, or a
  //    renamed field all show up here rather than on the user's host.
  for (const provider of spec.providers) {
    const dir = laneDir(provider.id);
    const { res, calls } = await laneRun(dir, provider.env);
    check(`[${provider.id}] the lane answers on this provider alone`, res.ok === true && res.artifact.provider === provider.id, res.error || '');
    const sent = vendorCalls(calls, spec)[0] || {};
    eq(`[${provider.id}] the request is the recorded contract, url and all`, { method: sent.method, url: sent.url, body: String(sent.body) }, { method: provider.request.method, url: provider.request.url, body: provider.request.body });
    check(`[${provider.id}] the credential goes where the vendor documents it`, Object.entries(provider.request.headers).every(([name, value]) => String(sent.headers?.[name] || '').includes(value)), JSON.stringify(sent.headers));
    check(`[${provider.id}] no credential travels in the request body`, Object.values(provider.env).every((v) => !String(sent.body).includes(v)) && !/"api_key"/.test(String(sent.body)), String(sent.body));
    eq(`[${provider.id}] one request went out, and only to this provider`, vendorCalls(calls, spec).map((c) => providerOf(c, spec)), [provider.id]);

    const log = readLog(dir);
    const kept = provider.expectedHits[0];
    const gone = provider.expectedHits[1];
    eq(`[${provider.id}] the documented field becomes the hit's title`, log.hits[kept.url]?.title, kept.title);
    eq(`[${provider.id}] the documented field becomes the snippet`, log.hits[kept.url]?.snippet, kept.snippet);
    check(`[${provider.id}] the recorded page is what was hashed`, log.hits[kept.url]?.bytes === Buffer.byteLength(pageOf(kept.url).raw) && log.hits[kept.url]?.sha256 === sha256(pageOf(kept.url).raw), JSON.stringify({ bytes: log.hits[kept.url]?.bytes }));
    check(`[${provider.id}] the second hit was fetched too and refused as a 404`, log.hits[gone.url]?.ok === false && /404/.test(log.hits[gone.url]?.error || ''), JSON.stringify(log.hits[gone.url]));
    eq(`[${provider.id}] the query record counts what came back and what survived`, [log.queries.at(-1).provider, log.queries.at(-1).returned, log.queries.at(-1).fetched, log.queries.at(-1).refused], [provider.id, 2, 1, 1]);
    eq(`[${provider.id}] the artifact counts the same`, [res.artifact.provider, res.artifact.fetched, res.artifact.refusedHits.length], [provider.id, 1, 1]);
  }

  // 2. Every way a provider can say no, and the fall-through that must follow: a
  //    real API answers with a non-200, a bot check served as 200 HTML, a quietly
  //    renamed field, or an empty result set — none of them may end the search.
  const ATTEMPT = {
    http: (p) => p.expectedHttpError,
    // The verbatim rejection each vendor returned to the declared request sent unauthenticated (section 16).
    rejected: (p) => 'HTTP ' + p.rejected.status,
    html: () => 'the provider answered with a body that is not JSON (a bot check, or a redirect)',
    wrongShape: () => 'the provider answered with a body that is not the documented shape',
    zero: () => 'the provider answered with no results',
    offline: (p) => p.offline.throws,
  };
  const chainCases = [
    ['http', 0, 1],
    ['rejected', 0, 1],
    ['html', 0, 1],
    ['wrongShape', 0, 1],
    ['zero', 0, 1],
    ['offline', 0, 1],
    ['http', 1, 2],
    ['html', 1, 2],
    ['zero', 1, 2],
    ['rejected', 1, 2],
    ['offline', 1, 2],
    ['rejected', 2, null],
    ['wrongShape', 2, null],
  ];
  for (const [caseName, firstIndex, secondIndex] of chainCases) {
    const first = spec.providers[firstIndex];
    const second = secondIndex === null ? null : spec.providers[secondIndex];
    const dir = laneDir(`${first.id}-${caseName}`);
    const { res, calls } = await laneRun(dir, { ...first.env, ...(second?.env || {}) }, { [first.id]: caseName });
    const named = `${first.id}: ${ATTEMPT[caseName](first)}`;
    if (second) {
      eq(`[${first.id} ${caseName}] the chain falls through to the next declared provider`, [res.ok, res.artifact.provider], [true, second.id]);
      eq(`[${first.id} ${caseName}] and a request went out to each of them, in order`, vendorCalls(calls, spec).map((c) => providerOf(c, spec)), [first.id, second.id]);
      eq(`[${first.id} ${caseName}] the hits are the second provider's, parsed from its own field`, readLog(dir).hits[second.expectedHits[0].url]?.title, second.expectedHits[0].title);
      eq(`[${first.id} ${caseName}] the attempt is recorded against the provider that made it, in the vendor's terms`, readLog(dir).queries.at(-1).attempts.map((a) => `${a.provider}: ${a.error}`), [named]);
    } else {
      check(`[${first.id} ${caseName}] the lane refuses when the last provider cannot answer`, res.ok === false && res.stage === 'search', JSON.stringify({ stage: res.stage }).slice(0, 120));
      check(`[${first.id} ${caseName}] and the refusal names the provider and the reason`, String(res.error).includes(named), res.error);
      eq(`[${first.id} ${caseName}] and writes nothing at all`, fs.readdirSync(dir), []);
    }
  }

  // 3. The whole chain: two failures, then the provider that answers — and every
  //    failed attempt still visible, in order, next to the query it belongs to.
  const deepDir = laneDir('deep-chain');
  const { res: deep, calls: deepCalls } = await laneRun(deepDir, { ...spec.providers[0].env, ...spec.providers[1].env, ...spec.providers[2].env }, { brave: 'html', tavily: 'http' });
  check('the chain walks past two failures to the provider that answers', deep.ok === true && deep.artifact.provider === 'google-cse', deep.error || '');
  eq('a request went to each provider in the declared order', vendorCalls(deepCalls, spec).map((c) => providerOf(c, spec)), ['brave', 'tavily', 'google-cse']);
  eq('both failures are recorded, named, in the order they happened', readLog(deepDir).queries.at(-1).attempts.map((a) => `${a.provider}: ${a.error}`), [
    'brave: the provider answered with a body that is not JSON (a bot check, or a redirect)',
    'tavily: HTTP 401',
  ]);

  // 3b. And the chain stops where it should: with every provider ready, the first
  //     one that answers ends the search — a working lane does not spend the other
  //     two vendors' quota.
  const stopDir = laneDir('stops-early');
  const { res: stopped, calls: stopCalls } = await laneRun(stopDir, { ...spec.providers[0].env, ...spec.providers[1].env, ...spec.providers[2].env }, {});
  check('with every provider ready the first one answers', stopped.ok === true && stopped.artifact.provider === 'brave', stopped.error || '');
  eq('and no request goes to the providers behind it', vendorCalls(stopCalls, spec).map((c) => providerOf(c, spec)), ['brave']);

  // 4. The refusal a user reads: the vendor's terms, never the parser's — a raw
  //    JavaScript internal or a fragment of the page is not an answer.
  for (const provider of spec.providers) {
    const offlineDir = laneDir(`${provider.id}-naked`);
    const { res: naked } = await laneRun(offlineDir, provider.env, { [provider.id]: 'offline' });
    check(`[${provider.id}] a host with no egress refuses rather than reporting nothing found`, naked.ok === false && naked.stage === 'search' && String(naked.error).includes(provider.offline.throws.slice(0, 20)), JSON.stringify(naked).slice(0, 160));
    const dir = laneDir(`${provider.id}-dead`);
    const { res } = await laneRun(dir, provider.env, { [provider.id]: 'wrongShape' });
    check(`[${provider.id}] the lane refuses when its only provider cannot answer`, res.ok === false && res.stage === 'search', JSON.stringify(res).slice(0, 160));
    eq(`[${provider.id}] and that refusal wrote nothing`, fs.readdirSync(dir), []);
    const text = formatResearchText(res);
    check(`[${provider.id}] the refusal names the provider and the reason`, text.includes(provider.id) && /not the documented shape/.test(text), text.slice(0, 200));
    check(`[${provider.id}] no parser internal and no page content reaches the reply`, !/TypeError|is not a function|Unexpected token|doctype|Enable JavaScript/i.test(text), text.slice(0, 200));
  }

  // 5. The command surface, in its own process. `--import` swaps the global fetch
  //    for the recording, so the CLI — the same code path `/health research` runs —
  //    is driven for real: no module call, no credential, no network.
  const cliDir = laneDir('cli');
  const callsFile = path.join(cliDir, 'calls.jsonl');
  const cliEnv = {
    ...process.env,
    HEALTH_WORKSPACE: cliDir,
    HEALTH_ENV_FILE: '',
    ...CLEARED_SEARCH,
    ...spec.providers[0].env,
    SEARCH_FIXTURE: FIXTURE_FILE,
    SEARCH_CALLS: callsFile,
    SEARCH_CASES: '{}',
    GEMINI_API_KEY: '', GOOGLE_API_KEY: '', API_KEY: '', GEMINI_API_KEYS: '',
  };
  const runCli = (env, query) => {
    let code = 0;
    let out = '';
    try {
      out = execFileSync(process.execPath, ['--import', SHIM_FILE, path.join(ROOT, 'scripts', 'health-runner.mjs'), '--research', `--query=${query}`, '--json'], { env, encoding: 'utf8' });
    } catch (err) {
      code = err.status;
      out = err.stdout || '';
    }
    return { code, json: JSON.parse(out || '{}') };
  };
  const cli = runCli(cliEnv, spec.query);
  eq('the CLI runs the lane against the recorded vendor and exits 0', [cli.code, cli.json.provider, cli.json.fetched, cli.json.refusedHits.length], [0, 'brave', 1, 1]);
  const cliCalls = fs.readFileSync(callsFile, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const cliSent = vendorCalls(cliCalls, spec)[0] || {};
  eq('the request the command sent is the pinned contract', { method: cliSent.method, url: cliSent.url }, { method: spec.providers[0].request.method, url: spec.providers[0].request.url });
  check('and the credential header it sent is the vendor\u2019s', String(cliSent.headers?.['X-Subscription-Token'] || '').includes(spec.providers[0].env.BRAVE_SEARCH_API_KEY), JSON.stringify(cliSent.headers));
  eq('the log the command wrote holds the vendor field as the hit title', readLog(cliDir).hits[spec.providers[0].expectedHits[0].url]?.title, spec.providers[0].expectedHits[0].title);

  const barrenDir = laneDir('cli-nocred');
  const callsBefore = fs.readFileSync(callsFile, 'utf8');
  const barren = runCli({ ...cliEnv, HEALTH_WORKSPACE: barrenDir, ...CLEARED_SEARCH }, spec.query);
  eq('with no search credential the same command refuses and exits 3', [barren.code, barren.json.stage], [3, 'credential']);
  eq('and that refusal records nothing at all', fs.readdirSync(barrenDir), []);
  eq('and made no request to any vendor', fs.readFileSync(callsFile, 'utf8') === callsBefore, true);

  for (const d of scratch) fs.rmSync(d, { recursive: true, force: true });
}

// ------------------------------- 16. the probe behind the vendor contracts
{
  console.log('\n  — the probe behind the vendor contracts —');
  // `search-provider-probe.json` is evidence, not a sensor. It records one
  // unauthenticated observation of each declared endpoint, taken by hand on the
  // date it carries; no test in this suite ever replays it over the network.
  // What this section checks, offline, is that the evidence still describes the
  // request the lane builds today — change a `build` without re-probing and the
  // record goes stale, and stale evidence about a vendor contract is worse than
  // none.
  const probeSpec = loadSearchFixture(FIXTURE_FILE);
  const probeFile = path.join(ROOT, 'scripts', 'fixtures', 'search-provider-probe.json');
  const probe = JSON.parse(fs.readFileSync(probeFile, 'utf8'));
  check('the observation is dated', typeof probe.observedAt === 'string' && !Number.isNaN(Date.parse(probe.observedAt)), String(probe.observedAt));
  check('it says in words what it is, and what it is not', /unauthenticated observation, not a captured successful response/i.test(probe.statement || ''), String(probe.statement || '').slice(0, 140));
  check('the credential it used is declared as not being one', /not a credential/.test(probe.credentialNote || ''), String(probe.credentialNote));
  eq('the evidence covers exactly the declared providers, by id', probe.providers.map((p) => p.id).sort(), probeSpec.providers.map((p) => p.id).sort());
  const gateImports = fs
    .readFileSync(fileURLToPath(import.meta.url), 'utf8')
    .split('\n')
    .filter((line) => /^\s*import\b/.test(line))
    .join('\n');
  check('the probe tool is a hand-run tool, imported by nothing in this gate', !/search-provider-probe/.test(gateImports), gateImports.slice(0, 120));

  for (const provider of probeSpec.providers) {
    const evidence = probe.providers.find((p) => p.id === provider.id);
    const declared = evidence.probes.find((x) => x.sentBy === 'SEARCH_PROVIDERS.build');
    check(`[${provider.id}] the evidence was built by the lane's own request builder`, Boolean(declared), JSON.stringify(evidence.probes.map((x) => x.sentBy)));
    // The drift sensor: this is the request the lane would send today, and the
    // evidence has to be exactly that request — same url, same headers, same body.
    const { url, init } = SEARCH_PROVIDERS.find((p) => p.id === provider.id).build({ key: probe.credential, cx: probe.credential, query: probeSpec.query, limit: MAX_HITS_PER_QUERY });
    eq(`[${provider.id}] the request on record is the one the lane builds today`, declared.request, { method: init.method || 'GET', url, headers: init.headers, body: String(init.body ?? '') });
    check(`[${provider.id}] what came back is a refusal, not a search result`, declared.response.status >= 400, String(declared.response.status));
    check(`[${provider.id}] the evidence says what it proves`, Array.isArray(evidence.proves) && evidence.proves.length > 0, JSON.stringify(evidence.proves));
    check(`[${provider.id}] and it says what it does not prove`, Array.isArray(evidence.doesNotProve) && evidence.doesNotProve.length > 0, JSON.stringify(evidence.doesNotProve));
    eq(`[${provider.id}] the fixture's rejected case is that observed reply, verbatim`, provider.rejected.raw, declared.response.body);
    eq(`[${provider.id}] with the status the vendor returned`, provider.rejected.status, declared.response.status);
  }

  // The one thing the probe could not settle is written down rather than
  // smoothed over: Brave checks auth before routing, so its wrong-path control
  // answers exactly like the declared path does.
  const braveEvidence = probe.providers.find((p) => p.id === 'brave');
  check('the unknown the probe could not settle stays on the record', braveEvidence.doesNotProve.some((line) => /routed path/.test(line)), JSON.stringify(braveEvidence.doesNotProve));
}

// ------------------------------- 17. the analysis producer
{
  console.log('\n  — the analysis producer —');
  // `/health analyze` used to name the inputs and stop there: nothing wrote the
  // payload the publisher reads, so the citation contract and the Doctor's
  // checker had no live input. This section drives the producer end to end with
  // no credential and no network — the gate, the pack, the model seam, the
  // answers it refuses — and then, through the publisher's own loader,
  // `planPublish`, the seat pack and readiness, what the payload it writes
  // actually does downstream.
  const scratch = [];
  const analysisWorkspace = ({ state = 'closed', brief = true, payload = false, log = null } = {}) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'health-analyst-'));
    scratch.push(dir);
    fs.mkdirSync(path.join(dir, 'result'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'sources'), { recursive: true });
    if (brief) fs.writeFileSync(path.join(dir, 'BRIEF.md'), '# Brief\n\nFour living documents.\n');
    fs.writeFileSync(path.join(dir, 'result', 'health-verify.json'), JSON.stringify({ ...fixtureArtifact(state), summary: { match: 2, missing: 1, appOnlyUnreviewed: 1, gap: 1 } }));
    if (payload) fs.writeFileSync(path.join(dir, 'result', ANALYSIS_FILE), JSON.stringify({ at: '2026-10-01T08:00:00Z', sections: analysisPayload() }));
    if (log) fs.writeFileSync(path.join(dir, 'result', RESEARCH_LOG), JSON.stringify(log));
    return dir;
  };
  const pathsIn = (dir) => ({ workspace: dir, sources: path.join(dir, 'sources'), result: path.join(dir, 'result') });
  const tree = (dir) => {
    const out = {};
    const walk = (rel) => {
      for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
        const r = rel === '.' ? e.name : path.join(rel, e.name);
        if (e.isDirectory()) walk(r);
        else out[r] = contentHash(fs.readFileSync(path.join(dir, r), 'utf8'));
      }
    };
    walk('.');
    return out;
  };

  // The gate first, with the shape the command surface already reports.
  const openDir = analysisWorkspace({ state: 'open' });
  const openBefore = tree(openDir);
  const openRun = await runHealthAnalyze({ paths: pathsIn(openDir), env: {} });
  check('with the gate open the producer is refused before the model', openRun.ok === false && openRun.stage === 'gate', JSON.stringify(openRun).slice(0, 160));
  eq('and it names all eight open items, with their titles', [openRun.openItems.length, Boolean(openRun.openItems[0].title)], [8, true]);
  eq('the gate refusal wrote nothing', Object.keys(tree(openDir)).sort(), Object.keys(openBefore).sort());

  // No brief: the pack refuses, so there is no seat turn at all.
  const bareDir = analysisWorkspace({ brief: false });
  const bareBefore = tree(bareDir);
  const bareRun = await runHealthAnalyze({ paths: pathsIn(bareDir), env: {} });
  check('a workspace with no brief is refused before the model', bareRun.ok === false && bareRun.stage === 'context', JSON.stringify(bareRun).slice(0, 160));
  eq('the context refusal wrote nothing', Object.keys(tree(bareDir)).sort(), Object.keys(bareBefore).sort());

  // No credential: the refusal comes before the model call and names the file.
  const dir = analysisWorkspace();
  const before = tree(dir);
  const noKey = await runHealthAnalyze({ paths: pathsIn(dir), env: {} });
  check('with no credential the producer refuses before the model', noKey.ok === false && noKey.stage === 'credential', JSON.stringify(noKey).slice(0, 200));
  check('the refusal names the key and the file it goes in', /GEMINI_API_KEY/.test(noKey.error) && /common\.env/.test(noKey.error), noKey.error);
  eq('the credential refusal wrote nothing', Object.keys(tree(dir)).sort(), Object.keys(before).sort());

  // The payload itself: a fenced JSON answer with prose around it, and every
  // document-4 line citing a link the literature lane never fetched.
  const prompts = [];
  const analyst = async ({ prompt }) => {
    prompts.push(prompt);
    return {
      finalText: [
        'Here is the payload, one claim per row, and every document-4 line cites the lane.',
        '```json',
        JSON.stringify({ sections: analysisPayload({ cite: CITATION }) }),
        '```',
      ].join('\n'),
      code: 0,
      lastError: null,
    };
  };
  const run = await runHealthAnalyze({ paths: pathsIn(dir), env: {}, runGemini: analyst, now: new Date('2026-10-01T11:00:00Z') });
  check('the producer writes the payload with the model seam', run.ok === true, run.error || '');
  if (run.ok) {
    eq('the receipt counts the sections and the lines', [run.artifact.sections, run.artifact.lines], [11, 11]);
    eq('the receipt names the seat that wrote it', run.artifact.role, 'health_analyst');
    check('the payload lands on the declared path', fs.existsSync(path.join(dir, 'result', ANALYSIS_FILE)), fs.readdirSync(path.join(dir, 'result')).join(','));
    // The publisher's own loader is the door the payload has to pass.
    const loaded = loadAnalysisFile(path.join(dir, 'result', ANALYSIS_FILE));
    check('the payload passes the publisher\u2019s loader', loaded.ok === true && Object.keys(loaded.sections).length === 11, JSON.stringify(loaded).slice(0, 200));
    eq('the loader carries the payload date through', loaded.at, '2026-10-01T11:00:00.000Z');
    eq('the payload records the closed gate it was written under', [run.payload.gate.allowed, run.payload.gate.closed, run.payload.gate.total], [true, 8, 8]);
    // The citation contract: the lines cite a link nobody fetched, so the
    // withholding is recorded and the sections are not dropped.
    eq('the citation contract withholds the four document-4 sections', run.withheld.map((w) => w.source), ['analysis.profile', 'analysis.by_marker', 'analysis.contradictions', 'analysis.not_settled']);
    check('and names the reason in the contract\u2019s own terms', run.withheld.every((w) => w.reason === 'unverified'), JSON.stringify(run.withheld));
    check('the payload carries the withholding too', run.payload.citations.withheld.length === 4 && run.payload.citations.fetched === 0, JSON.stringify(run.payload.citations));
    const reply = formatAnalyzeText(run);
    check('the reply says the payload was written, with its counts', /Analysis payload written/.test(reply) && /11 section\(s\)/.test(reply), reply.slice(0, 200));
    check('the reply says which sections document 4 will withhold', /analysis\.by_marker/.test(reply) && /withheld/.test(reply), reply.slice(0, 300));
    check('the reply points at the publisher', /health refresh/.test(reply), reply.slice(0, 200));
    check('the seat was handed the mandate and the pack', /one JSON object/.test(prompts.at(-1) || '') && /analysis\.not_settled/.test(prompts.at(-1) || '') && /data gate: CLOSED/.test(prompts.at(-1) || ''), (prompts.at(-1) || '').slice(0, 200));
    const after = tree(dir);
    eq('exactly one file was added, the payload', Object.keys(after).filter((f) => !(f in before)).sort(), [`result/${ANALYSIS_FILE}`]);
    check('every pre-existing byte is unchanged', Object.keys(before).every((f) => after[f] === before[f]), Object.keys(before).filter((f) => after[f] !== before[f]).join(','));

    // Downstream, on the very payload the producer wrote. The publisher refuses
    // document 4's sections by name and publishes the rest; with the link in the
    // fetch log, the same payload publishes it.
    const templates = readTemplates();
    const planDraft = planPublish({ artifact: fixtureArtifact('closed'), analysis: loaded.sections, templates, registry: {}, now: new Date('2026-10-01T11:00:00Z') });
    const insights = planDraft.items.find((i) => i.key === 'insights');
    eq('the publisher withholds the four uncitable sections', insights.citationRefused.map((c) => c.reason), ['unverified', 'unverified', 'unverified', 'unverified']);
    check('and publishes the documents that need no literature', planDraft.items.filter((i) => i.key === 'conditions' || i.key === 'test_plan').every((i) => i.refused.length === 0 && i.citationRefused.length === 0), JSON.stringify(planDraft.items.map((i) => [i.key, i.refused.length, i.citationRefused.length])));
    const planCited = planPublish({ artifact: fixtureArtifact('closed'), analysis: loaded.sections, templates, registry: {}, now: new Date('2026-10-01T11:00:00Z'), citations: researchLog({ fetched: [CITATION] }) });
    const insightsCited = planCited.items.find((i) => i.key === 'insights');
    eq('with the link fetched and recorded the same payload publishes', insightsCited.citationRefused.length, 0);
    check('and the published bytes carry the link', insightsCited.text.includes(CITATION), 'the link is missing from document 4');

    // The payload is live for the other two consumers: the seat pack the Doctor
    // reads shows it as accepted, and readiness stops calling it missing.
    const pack = buildHealthContext(dir);
    const analysisSection = pack.sections.find((s) => s.key === 'analysis');
    check('the seat pack shows the payload as accepted, not refused', /shape: accepted/.test(analysisSection?.text || ''), (analysisSection?.text || '').slice(0, 140));
    const readiness = checkHealthReadiness({ projectId: 'external-health', paths: pathsIn(dir), now: new Date('2026-10-01T11:00:00Z') });
    const analysisCheck = readiness.checks.find((c) => c.key === 'analysis');
    check('readiness reports the payload present and well-shaped, not missing', analysisCheck?.level === 'ok', JSON.stringify(analysisCheck));
  }

  // A model that does not answer with a payload writes nothing at all.
  const answers = [
    ['prose alone', 'I reviewed the markers and they look fine to me.', /without a JSON object/],
    ['broken JSON', '```json\n{ "sections": { "analysis.conditions": [ "x" }\n```', /does not parse/],
    ['a misspelt key', JSON.stringify({ sections: { 'analysis.condition': ['x'] } }), /unknown analysis key/],
    ['a claim that is not a string', JSON.stringify({ sections: { 'analysis.conditions': [{ marker: 'LDL' }] } }), /must be a string/],
  ];
  for (const [label, answer, wanted] of answers) {
    const badDir = analysisWorkspace();
    const badBefore = tree(badDir);
    const res = await runHealthAnalyze({ paths: pathsIn(badDir), env: {}, runGemini: async () => ({ finalText: answer, code: 0, lastError: null }) });
    check(`[${label}] the producer refuses an answer that is not a payload`, res.ok === false && res.stage === 'payload', JSON.stringify({ stage: res.stage, error: res.error }).slice(0, 200));
    check(`[${label}] the refusal says which rule broke`, wanted.test(res.error || ''), res.error);
    eq(`[${label}] the refused run wrote nothing`, Object.keys(tree(badDir)).sort(), Object.keys(badBefore).sort());
  }
  const modelFail = await runHealthAnalyze({ paths: pathsIn(dir), env: {}, runGemini: async () => { throw new Error('no lane'); } });
  check('a failed model call writes nothing', modelFail.ok === false && modelFail.stage === 'model' && /model call failed/.test(modelFail.error), JSON.stringify(modelFail).slice(0, 200));

  // The extractor's own contract, small and explicit.
  eq('a bare map of analysis keys is accepted', extractAnalysisPayload('{"analysis.conditions": ["x"]}').ok, true);
  eq('prose around the object is ignored', extractAnalysisPayload('notes: {"sections": {"analysis.conditions": ["x"]}} end').sections['analysis.conditions'], ['x']);
  eq('an answer with no object at all is refused', extractAnalysisPayload('no payload here').ok, false);
  check('the refusal quotes the shape it wanted', /expected \{"sections"/.test(extractAnalysisPayload('nope').error), extractAnalysisPayload('nope').error);

  // The CLI door: a refusal is an answer, so it exits 3 with the JSON saying why.
  const runner = path.join(ROOT, 'scripts', 'health-runner.mjs');
  const cliDir = analysisWorkspace();
  const cliEnv = { ...process.env, HEALTH_WORKSPACE: cliDir, GEMINI_API_KEY: '', GOOGLE_API_KEY: '', API_KEY: '', GEMINI_API_KEYS: '' };
  let cliCode = 0;
  let cliOut = '';
  try {
    cliOut = execFileSync(process.execPath, [runner, '--analyze', '--json'], { env: cliEnv, encoding: 'utf8' });
  } catch (err) {
    cliCode = err.status;
    cliOut = err.stdout || '';
  }
  const cliJson = JSON.parse(cliOut || '{}');
  eq('the CLI refuses without a credential and exits 3', [cliCode, cliJson.stage], [3, 'credential']);
  eq('and the CLI refusal wrote nothing', Object.keys(tree(cliDir)).sort(), ['BRIEF.md', 'result/health-verify.json']);

  for (const d of scratch) fs.rmSync(d, { recursive: true, force: true });
}

console.log(`\n${passed} pass, ${failed} fail\n`);
if (failed > 0) process.exit(1);
