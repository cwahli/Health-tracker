import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { assertReadOnlySql, parseEnvFile, loadD1Config, createD1Reader, resolveProfileUid, parseBiomarkers, parseProfile, QUERIES } from './lib/health/d1.mjs';
import { parseCsvLine, isoDate, mapSheetTest, parseSheetCsv, parseSheetDump, sheetRecord, MARKER_LABELS } from './lib/health/sheet.mjs';
import { extractAppState, reconcile, evaluateFixList, unreviewedAppRows, valuesEqual, FIX_LIST } from './lib/health/reconcile.mjs';
import { KNOWN_PROJECTS, resolveProjectId, resolveRoleId, getProjectRoles, getRoleInstructions, getProjectSoul, seedProjectWorkspace } from './lib/project-registry.mjs';
import { runHealthVerify, getHealthStatus, renderFixListMarkdown, formatVerifyText, formatStatusText, healthPaths } from './health-runner.mjs';

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

console.log(`\n${passed} pass, ${failed} fail\n`);
if (failed > 0) process.exit(1);
