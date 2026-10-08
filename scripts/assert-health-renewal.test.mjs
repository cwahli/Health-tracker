#!/usr/bin/env node
/**
 * The monthly renewal runner: when a renewal is due, when it honestly is not,
 * and that the one run it makes is the one publisher that already exists.
 *
 * The charter promises the four documents renew on a monthly cadence; nothing
 * scheduled it. The runner decides — a **current** snapshot (inside the
 * publisher's renewal window) that the last refresh receipt did not already
 * publish — and calls `runHealthRefresh`, which keeps its own idempotence.
 *
 * Proved here through the real surface: the runner is driven with the real
 * publisher and only the network seams injected (fixtures, a fake store), so
 * "refreshes exactly once" is judged on the store calls the publisher actually
 * made, not on a stub. A run outside the window calls the publisher zero times
 * and leaves the workspace byte-identical — no document, no receipt.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

import { runHealthRenewal, renewalDecision, formatRenewalText, RENEWAL_PROJECT } from './health-renewal.mjs';
import { runHealthRefresh } from './health-runner.mjs';
import { DOC_SPECS, REFRESH_FILE, STALE_AFTER_DAYS } from './lib/health/docs.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const DAY = 86400000;
const NOW = new Date('2026-10-02T09:00:00Z');

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

console.log('assert-health-renewal:');

// ---------------------------------------------------------------- fixtures
const SHEET_ROWS = [
  ['"05-Jun-2026","HbA1c levl - IFCC standardised","40 mmol/mol","20 - 41 mmol/mol",""'],
  ['"05-Jun-2026","Serum creatinine","100 umol/L","64 - 104 umol/L",""'],
  ['"05-Jun-2026","Haemoglobin estimation","166 g/L","130 - 180 g/L",""'],
  ['"25-Jun-2025","Serum cholesterol","5.7 mmol/L","< 5.2 mmol/L",""'],
  ['"23-Oct-2024","Body weight","62 kg","",""'],
  ['"27-Mar-2024","Blood Pressure","109 / 53 mmHg","",""'],
];
const APP_ROWS = [
  { id: 'row_ok', firebase_uid: 'real', date: '2026-06-05', biomarkers: JSON.stringify({ hba1c: 40, creatinine: 100, hemoglobin: 166 }), note: '' },
  { id: 'row_lipids', firebase_uid: 'real', date: '2025-06-25', biomarkers: JSON.stringify({ total_cholesterol: 5.7 }), note: '' },
  { id: 'row_w', firebase_uid: 'real', date: '2024-10-23', biomarkers: JSON.stringify({ weight: 62 }), note: '' },
  { id: 'row_bp', firebase_uid: 'real', date: '2024-03-27', biomarkers: JSON.stringify({ blood_pressure: '109 / 53 mmHg' }), note: '' },
];
const d1Fetch = async (url, init = {}) => {
  const json = (body) => ({ ok: true, status: 200, json: async () => body });
  if (String(url).includes('/accounts?per_page=1')) return json({ success: true, result: [{ id: 'acct' }] });
  const payload = JSON.parse(init.body || '{}');
  if (/from biomarker_logs group by firebase_uid/.test(payload.sql)) return json({ success: true, result: [{ results: [{ firebase_uid: 'real', rows: APP_ROWS.length }] }] });
  if (/from profiles/.test(payload.sql)) return json({ success: true, result: [{ results: [{ id: 'p', firebase_uid: 'real', data: JSON.stringify({ profile: { age: 28, height: 178, weight: 74 } }) }] }] });
  if (/from biomarker_logs/.test(payload.sql)) return json({ success: true, result: [{ results: APP_ROWS }] });
  return json({ success: false, errors: [{ message: `unexpected sql: ${payload.sql}` }] });
};
const TEMPLATES = Object.fromEntries(DOC_SPECS.map((s) => [s.key, fs.readFileSync(path.join(ROOT, 'projects', 'external-health', 'templates', s.template), 'utf8')]));
const ENV = { CLOUDFLARE_API_TOKEN: 'tok', CLOUDFLARE_D1_DATABASE_ID: 'dbb', HEALTH_PROFILE_UID: 'real', HEALTH_DOCS_FOLDER: 'folder1' };

function fakeStore() {
  const calls = [];
  const files = {};
  let seq = 0;
  return {
    calls,
    files,
    async create(folderId, title, text, token) {
      seq += 1;
      const id = `doc_${seq}`;
      calls.push({ op: 'create', folderId, title, token, id });
      files[id] = text;
      return { ok: true, id, title, modifiedTime: `2026-10-02T09:0${seq}:00.000Z` };
    },
    async replace(docId, text, token) {
      calls.push({ op: 'replace', docId, token });
      files[docId] = text;
      return { ok: true, id: docId, modifiedTime: '2026-10-02T10:00:00.000Z' };
    },
    async stat(docId) {
      calls.push({ op: 'stat', docId });
      return { ok: true, file: { id: docId } };
    },
    async read(docId) {
      calls.push({ op: 'read', docId });
      return files[docId] === undefined ? { ok: false, error: 'File not found' } : { ok: true, bytes: Buffer.from(files[docId]) };
    },
    async list() {
      calls.push({ op: 'list' });
      return { ok: true, files: [] };
    },
  };
}

/** A workspace with a banked sheet and a verify artifact dated `at`. */
function makeWorkspace({ at = '2026-10-01T21:16:39.996Z', receipt = null } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'health-renewal-'));
  fs.mkdirSync(path.join(dir, 'sources'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'result'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'sources', 'sheet_2026-09-30.json'), JSON.stringify({
    source: { title: 'Medical Test Results - Chiwah', fetchedAt: '2026-09-30T18:33:28.031Z' },
    data: { 'Medical Test Results - Chiwah': SHEET_ROWS.map((r) => [r[0]]) },
  }));
  fs.writeFileSync(path.join(dir, 'result', 'health-verify.json'), JSON.stringify({
    at,
    projectId: RENEWAL_PROJECT,
    profile: { uid: 'real', rows: 41, source: 'most-lab-rows', fields: { age: 28, height: 178, weight: 74 } },
    sheet: {
      file: path.join(dir, 'sources', 'sheet_2026-09-30.json'),
      title: 'Medical Test Results - Chiwah',
      tab: 'Medical Test Results - Chiwah',
      fetchedAt: '2026-09-30T18:33:28.031Z',
      rows: SHEET_ROWS.length,
      dates: ['2026-06-05', '2025-06-25', '2024-10-23', '2024-03-27'],
      newestDate: '2026-06-05',
      unmapped: [],
    },
    app: { rows: APP_ROWS.length, newestDate: '2026-06-05', newerThanSheet: [] },
    matches: [
      { key: 'hba1c', label: 'HbA1c', value: 40, unit: 'mmol/mol', date: '2026-06-05' },
      { key: 'creatinine', label: 'Creatinine', value: 100, unit: 'umol/L', date: '2026-06-05' },
    ],
    missing: [],
    appOnly: [],
    gaps: [],
    fixList: {
      closed: 0,
      open: 8,
      waived: 0,
      items: ['H-1', 'H-2', 'H-3', 'H-4', 'H-5', 'H-6', 'H-7', 'H-8'].map((id) => ({ id, title: `${id} title`, state: 'open', detail: `${id} — one detail line` })),
      nextAction: { id: 'H-1', title: 'H-1 title' },
    },
  }));
  if (receipt) fs.writeFileSync(path.join(dir, 'result', REFRESH_FILE), JSON.stringify(receipt));
  return dir;
}

/** Every file in a tree with its bytes — the "nothing was written" judge. */
function treeSnapshot(dir) {
  const out = {};
  const walk = (d) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else out[path.relative(dir, full)] = fs.readFileSync(full, 'utf8');
    }
  };
  if (fs.existsSync(dir)) walk(dir);
  return out;
}

const storeCallsOf = (store) => store.calls.filter((c) => c.op === 'create' || c.op === 'replace' || c.op === 'recreate');

// ---------------------------------------------------------------- 1. the decision, pure
{
  const artifact = { at: '2026-10-01T21:16:39.996Z' };
  const fresh = renewalDecision({ artifact, receipt: null, now: NOW });
  check('an unpublished current snapshot is due', fresh.due === true && fresh.action === 'renew', JSON.stringify(fresh));
  const published = renewalDecision({ artifact, receipt: { verify: { at: artifact.at } }, now: NOW });
  check('the same snapshot, already published, is not due', published.due === false && /nothing changed/.test(published.reason), JSON.stringify(published));
  const newer = renewalDecision({ artifact, receipt: { verify: { at: '2026-09-01T00:00:00Z' } }, now: NOW });
  check('a newer snapshot than the receipt is due', newer.due === true, JSON.stringify(newer));
  const dry = renewalDecision({ artifact, receipt: { dryRun: true, verify: { at: artifact.at } }, now: NOW });
  check('a dry run is not evidence of a renewal', dry.due === true, JSON.stringify(dry));
  const boundary = renewalDecision({ artifact: { at: new Date(NOW.getTime() - STALE_AFTER_DAYS * DAY).toISOString() }, receipt: null, now: NOW });
  check(`the window boundary (${STALE_AFTER_DAYS} days) is still inside`, boundary.due === true && boundary.ageDays === STALE_AFTER_DAYS, JSON.stringify(boundary));
  const stale = renewalDecision({ artifact: { at: new Date(NOW.getTime() - (STALE_AFTER_DAYS + 1) * DAY).toISOString() }, receipt: null, now: NOW });
  check('one day past the window is not renewed', stale.due === false && /health verify/.test(stale.reason), JSON.stringify(stale));
  const none = renewalDecision({ artifact: null, receipt: null, now: NOW });
  check('no snapshot is not renewed, and names /health verify', none.due === false && /health verify/.test(none.reason), JSON.stringify(none));
  check('the window is the publisher\'s own constant', STALE_AFTER_DAYS === 31);
}

// ---------------------------------------------------------------- 2. inside the window: exactly one renewal
{
  const dir = makeWorkspace();
  const store = fakeStore();
  let refreshCalls = 0;
  const refresh = () => {
    refreshCalls += 1;
    return runHealthRefresh({ workspace: dir, env: ENV, fetchImpl: d1Fetch, now: NOW, token: 't', store, templates: TEMPLATES });
  };

  const first = await runHealthRenewal({ workspace: dir, now: NOW, refresh });
  eq('a current unpublished snapshot renews', first.action, 'renewed');
  eq('the publisher was called exactly once', refreshCalls, 1);
  eq('the four documents are created exactly once', storeCallsOf(store).filter((c) => c.op === 'create').length, 4);
  const receipt = JSON.parse(fs.readFileSync(path.join(dir, 'result', REFRESH_FILE), 'utf8'));
  const artifact = JSON.parse(fs.readFileSync(path.join(dir, 'result', 'health-verify.json'), 'utf8'));
  eq('the run records the usual receipt, pinned to the snapshot it published', receipt.verify.at, artifact.at);
  check('the receipt is a real run, not a dry run', receipt.dryRun === false, JSON.stringify({ dryRun: receipt.dryRun }));
  check('the human log is written beside it', fs.existsSync(path.join(dir, 'result', 'health-refresh.md')));
  check('the renewed reply names the counts and the receipt', /created 4/.test(formatRenewalText(first)) && formatRenewalText(first).includes(`receipt: result/${REFRESH_FILE}`), formatRenewalText(first));

  // The quiet day: same snapshot, receipt already says it was published.
  const before = treeSnapshot(path.join(dir, 'result'));
  const callsBefore = store.calls.length;
  const second = await runHealthRenewal({ workspace: dir, now: new Date(NOW.getTime() + 3600000), refresh });
  eq('a second run over the same snapshot is a no-change skip', second.action, 'skipped');
  eq('the publisher is not called again', refreshCalls, 1);
  eq('no document was written by the no-change run', store.calls.length, callsBefore);
  eq('no receipt was written by the no-change run', treeSnapshot(path.join(dir, 'result')), before);
  check('the skip says nothing changed', /nothing changed/.test(formatRenewalText(second)), formatRenewalText(second));

  // The publisher's own idempotence, driven through the runner: force a second
  // refresh over the same day (receipt removed, so the snapshot reads as
  // unpublished) — every document plans a skip, so no document is written.
  fs.rmSync(path.join(dir, 'result', REFRESH_FILE));
  const callsBeforeForced = store.calls.length;
  const forced = await runHealthRenewal({ workspace: dir, now: new Date(NOW.getTime() + 7200000), refresh });
  eq('the forced run refreshes again', forced.action, 'renewed');
  eq('a same-day refresh writes no document', store.calls.length, callsBeforeForced);
  eq('it still plans four skips', [forced.result.artifact.counts.created, forced.result.artifact.counts.skipped], [0, 4]);
  fs.rmSync(dir, { recursive: true, force: true });
}

// ---------------------------------------------------------------- 3. outside the window: not at all
{
  const staleAt = new Date(NOW.getTime() - (STALE_AFTER_DAYS + 5) * DAY).toISOString();
  const dir = makeWorkspace({ at: staleAt });
  const before = treeSnapshot(path.join(dir, 'result'));
  let refreshCalls = 0;
  const stale = await runHealthRenewal({ workspace: dir, now: NOW, refresh: () => { refreshCalls += 1; return { ok: true }; } });
  eq('a snapshot past the renewal window does not renew', stale.action, 'skipped');
  eq('the publisher is never called', refreshCalls, 0);
  eq('nothing is written — no document, no receipt', treeSnapshot(path.join(dir, 'result')), before);
  check('the skip names the honest next step (/health verify)', /health verify/.test(stale.decision.reason), stale.decision.reason);

  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'health-renewal-none-'));
  const noSnapshot = await runHealthRenewal({ workspace: bare, now: NOW, refresh: () => { refreshCalls += 1; return { ok: true }; } });
  eq('a workspace with no snapshot does not renew', noSnapshot.action, 'skipped');
  eq('still no publisher call', refreshCalls, 0);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(bare, { recursive: true, force: true });
}

// ---------------------------------------------------------------- 4. a refusal is honest
{
  const dir = makeWorkspace();
  const before = treeSnapshot(path.join(dir, 'result'));
  const refused = await runHealthRenewal({ workspace: dir, now: NOW, refresh: async () => ({ ok: false, stage: 'credential', error: 'no Google credential' }) });
  eq('a refused publisher is reported, not swallowed', [refused.ok, refused.action, refused.stage], [false, 'refused', 'credential']);
  check('the refusal names the stage and the reason', /refused at credential: no Google credential/.test(formatRenewalText(refused)), formatRenewalText(refused));
  eq('the refusal wrote nothing', treeSnapshot(path.join(dir, 'result')), before);
  fs.rmSync(dir, { recursive: true, force: true });
}

// ---------------------------------------------------------------- 5. the CLI and the units
{
  // The CLI against a due workspace with no credential at all: the refusal is
  // exit 3 (the repo's "refused on purpose" code), names the stage, writes
  // nothing, and never reaches the network.
  const dir = makeWorkspace();
  const before = treeSnapshot(path.join(dir, 'result'));
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'health-renewal-cli-'));
  let code = 0;
  let stdout = '';
  try {
    stdout = execFileSync(process.execPath, [path.join(HERE, 'health-renewal.mjs'), `--workspace=${dir}`], {
      env: { HOME: sandbox, PATH: process.env.PATH },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    code = err.status ?? 1;
    stdout = String(err.stdout || '');
  }
  eq('the CLI exits 3 on a refused renewal', code, 3);
  check('the CLI prints the refusal with its stage', /refused at verify\/config/.test(stdout), stdout.trim().slice(0, 160));
  eq('the refused CLI run writes nothing', treeSnapshot(path.join(dir, 'result')), before);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(sandbox, { recursive: true, force: true });

  // The runner is a scheduler, not a second publisher.
  const src = fs.readFileSync(path.join(HERE, 'health-renewal.mjs'), 'utf8');
  check('the runner calls the one refresh path', /runHealthRefresh\(/.test(src) && /from '\.\/health-runner\.mjs'/.test(src));
  check('the runner never imports a second publisher', !/publishDocs|planPublish|applyReceipts|googleDocsStore/.test(src));
  check('the runner reads the receipt the refresh writes', new RegExp(`REFRESH_FILE`).test(src));

  const service = fs.readFileSync(path.join(ROOT, 'systemd', 'health-renewal@.service'), 'utf8');
  check('the unit is a oneshot running the runner', /Type=oneshot/.test(service) && /ExecStart=\/usr\/bin\/node \/home\/ubuntu\/deploy\/Health-tracker\/scripts\/health-renewal\.mjs/.test(service));
  check('the unit carries the host env files like its siblings', /EnvironmentFile=-\/home\/ubuntu\/\.config\/bot-host\/common\.env/.test(service) && /EnvironmentFile=-\/home\/ubuntu\/\.config\/bot-host\/%i\.env/.test(service));
  check('the unit names the D1 env file the verify path reads', /Environment=HEALTH_ENV_FILE=\/home\/ubuntu\/deploy\/Health-tracker\/\.env/.test(service));
  check('the unit drops privileges like its siblings', /NoNewPrivileges=true/.test(service));

  const timer = fs.readFileSync(path.join(ROOT, 'systemd', 'health-renewal@.timer'), 'utf8');
  check('the timer is the charter\'s monthly cadence', /OnCalendar=monthly/.test(timer));
  check('a fire missed while the box was down happens once at boot', /Persistent=true/.test(timer));
  check('the timer activates the service', /Unit=health-renewal@%i\.service/.test(timer) && /WantedBy=timers\.target/.test(timer));
  check('both units document the packet', /specs\/active\/HEALTH-RENEWAL-1\.md/.test(service) && /specs\/active\/HEALTH-RENEWAL-1\.md/.test(timer) && fs.existsSync(path.join(ROOT, 'specs', 'active', 'HEALTH-RENEWAL-1.md')));
}

console.log(`\n${passed} pass, ${failed} fail`);
process.exit(failed === 0 ? 0 : 1);
