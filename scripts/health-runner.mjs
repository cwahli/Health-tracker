#!/usr/bin/env node
/**
 * health-runner.mjs — the Personal Health Coach project's data loop.
 *
 *   /health verify  re-read the app (read-only), diff it against the sheet the
 *                   Brief folder holds, and print the fix list closed/open
 *   /health ingest  pull the Brief folder's sheets and docs into the workspace
 *   /health status  what is still wrong, how fresh the data is, what is next
 *
 * WHY IT IS A RUNNER, NOT A COMMAND HANDLER
 * -----------------------------------------
 * `council-runner.mjs` set the shape for external projects: the bot-host command
 * stays thin (parse, call, format the reply) and the work lives in a script that
 * can also be run by hand. That matters here because the verify loop has to run
 * on a schedule the chat does not drive, and because the live proof of this
 * change is exactly the by-hand run against the real account.
 *
 * The verify path is read-only end to end: D1 through `lib/health/d1.mjs`, which
 * refuses anything but a SELECT, and the Brief folder through a listing plus a
 * text export. Results are written to the project workspace, never to the app and
 * never to Drive.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { KNOWN_PROJECTS } from './lib/project-registry.mjs';
import { loadD1Config, discoverAccountId, createD1Reader, QUERIES, resolveProfileUid, parseProfile } from './lib/health/d1.mjs';
import { newestSourceFile, readBankedSheet, ingestBriefFolder, briefCredential } from './lib/health/sheet.mjs';
import { extractAppState, reconcile, evaluateFixList, verdictsOf, unreviewedAppRows, markerLabel } from './lib/health/reconcile.mjs';

export const DEFAULT_PROJECT = 'external-health';
export const VERIFY_FILE = 'health-verify.json';
export const FIX_LIST_FILE = 'health-fix-list.md';

/** Where this project keeps its sources and its results. */
export function healthWorkspace(projectId = DEFAULT_PROJECT, { env = process.env } = {}) {
  const override = String(env.HEALTH_WORKSPACE || '').trim();
  if (override) return override;
  const project = KNOWN_PROJECTS[projectId];
  return project?.workspace || path.join(os.homedir(), 'projects', projectId);
}

export function healthPaths(projectId = DEFAULT_PROJECT, { env = process.env } = {}) {
  const workspace = healthWorkspace(projectId, { env });
  return { workspace, sources: path.join(workspace, 'sources'), result: path.join(workspace, 'result') };
}

const shortStamp = (iso) => String(iso || '').slice(0, 16).replace('T', ' ');

/**
 * Read the app, read the sheet, diff, evaluate.
 *
 * Every dependency is injectable (`fetchImpl`, `now`, `envFile`) so the sensor
 * can drive the whole path with fixtures and no network — a verify that can only
 * be tested against the live account is a verify nobody tests.
 */
export async function runHealthVerify({
  projectId = DEFAULT_PROJECT,
  uid = '',
  env = process.env,
  envFile = '',
  now = new Date(),
  fetchImpl = fetch,
  workspace = '',
} = {}) {
  const paths = workspace
    ? { workspace, sources: path.join(workspace, 'sources'), result: path.join(workspace, 'result') }
    : healthPaths(projectId, { env });

  const cfg = loadD1Config({ env, envFile, readFile: (f) => fs.readFileSync(f, 'utf8') });
  if (!cfg.ok) return { ok: false, stage: 'config', error: cfg.reason };

  let accountId = cfg.accountId;
  try {
    if (!accountId) accountId = await discoverAccountId({ token: cfg.token, fetchImpl });
  } catch (err) {
    return { ok: false, stage: 'account', error: err.message };
  }

  const reader = createD1Reader({ token: cfg.token, databaseId: cfg.databaseId, accountId, fetchImpl });
  let counts;
  let rows;
  let profileRow;
  let resolution;
  try {
    counts = await reader.query(QUERIES.profileCounts);
    resolution = resolveProfileUid({ counts, explicit: uid || env.HEALTH_PROFILE_UID || '' });
    if (!resolution.uid) return { ok: false, stage: 'profile', error: 'no profile with lab rows in this database' };
    rows = await reader.query(QUERIES.biomarkerRows, [resolution.uid]);
    profileRow = (await reader.query(QUERIES.profileRow, [resolution.uid]))[0] || null;
  } catch (err) {
    return { ok: false, stage: 'read', error: err.message };
  }

  const sourceFile = newestSourceFile(paths.sources, { readdir: fs.readdirSync, exists: fs.existsSync });
  if (!sourceFile) {
    return { ok: false, stage: 'sources', error: `no banked sheet in ${paths.sources} — run /health ingest first` };
  }
  let sheet;
  try {
    sheet = readBankedSheet(sourceFile, {}, fs);
  } catch (err) {
    return { ok: false, stage: 'sources', error: `cannot read ${sourceFile}: ${err.message}` };
  }

  const profile = parseProfile(profileRow?.data);
  const appState = extractAppState(rows);
  const report = reconcile({ sheetRows: sheet.rows, appState });
  report.sheet.tab = sheet.tab;
  const waived = Array.isArray(env.HEALTH_WAIVED_ITEMS)
    ? env.HEALTH_WAIVED_ITEMS.split(',')
    : String(env.HEALTH_WAIVED_ITEMS || '').split(',').map((s) => s.trim()).filter(Boolean);
  const evaluation = evaluateFixList({ report, profile, waived });

  const artifact = {
    at: now.toISOString(),
    projectId,
    workspace: paths.workspace,
    profile: {
      uid: resolution.uid,
      source: resolution.source,
      rows: resolution.rows,
      others: resolution.others.map((o) => ({ uid: o.uid, rows: o.rows })),
      fields: { age: profile.age ?? null, height: profile.height ?? null, weight: profile.weight ?? null },
    },
    sheet: {
      file: sourceFile,
      tab: sheet.tab,
      title: sheet.source?.title || '',
      fetchedAt: sheet.source?.fetchedAt || '',
      rows: report.sheet.rows,
      dates: report.sheet.dates,
      newestDate: report.sheet.newestDate,
      unmapped: report.sheet.unmapped,
    },
    app: {
      rows: appState.rowCount,
      dates: report.app.dates,
      newestDate: report.app.newestDate,
      newerThanSheet: report.app.newerThanSheet,
    },
    summary: report.summary,
    structural: report.structural,
    clusters: report.clusters,
    fixList: evaluation,
    missing: verdictsOf(report, 'MISSING').map((v) => ({ key: v.key, label: markerLabel(v.key), date: v.date, value: v.value, unit: v.unit, appNearest: v.appNearest })),
    appOnly: unreviewedAppRows(report).map((v) => ({ key: v.key, label: markerLabel(v.key), date: v.date, value: v.appValue, sourceDates: v.sourceDates })),
    gaps: verdictsOf(report, 'GAP').map((v) => ({ date: v.date, test: v.test })),
  };

  try {
    fs.mkdirSync(paths.result, { recursive: true });
    fs.writeFileSync(path.join(paths.result, VERIFY_FILE), JSON.stringify(artifact, null, 1));
    fs.writeFileSync(path.join(paths.result, FIX_LIST_FILE), renderFixListMarkdown(artifact));
  } catch (err) {
    artifact.writeError = err.message;
  }

  return { ok: true, artifact, report, evaluation };
}

/** Pull the Brief folder into the workspace's sources/. Read-only on Drive. */
export async function runHealthIngest({ projectId = DEFAULT_PROJECT, env = process.env, botId = '', now = new Date(), folderId = '', fetchImpl = fetch } = {}) {
  const paths = healthPaths(projectId, { env });
  const project = KNOWN_PROJECTS[projectId];
  const configured = String(folderId || env.HEALTH_BRIEF_FOLDER || '').trim();
  if (!configured) {
    return {
      ok: false,
      stage: 'config',
      error: `no Brief folder id — set HEALTH_BRIEF_FOLDER (the project folder is ${project?.gdriveFolder || '(unset)'})`,
    };
  }
  const cred = await briefCredential({ botId, env, home: undefined });
  if (!cred.ok) return { ok: false, stage: 'credential', error: cred.error };
  fs.mkdirSync(paths.sources, { recursive: true });
  const res = await ingestBriefFolder({
    folderId: configured,
    outDir: paths.sources,
    // A token that is not a string is a 401 waiting to happen, so it never
    // reaches the header: briefCredential returns the field, not the object.
    token: String(cred.token || ''),
    fetchImpl,
    now,
    writeFile: (file, content) => fs.writeFileSync(file, content),
    mkdir: (dir) => fs.mkdirSync(dir, { recursive: true }),
  });
  if (!res.ok) return { ok: false, stage: 'ingest', error: res.error, paths };
  return { ok: true, ...res, paths };
}

/** What the last verify said, plus what the workspace holds. No network. */
export function getHealthStatus({ projectId = DEFAULT_PROJECT, env = process.env, workspace = '' } = {}) {
  const paths = workspace ? { workspace, sources: path.join(workspace, 'sources'), result: path.join(workspace, 'result') } : healthPaths(projectId, { env });
  const project = KNOWN_PROJECTS[projectId];
  const status = {
    projectId,
    workspace: paths.workspace,
    gdriveFolder: project?.gdriveFolder || '',
    docs: {
      published: false,
      note: 'the four documents (Health Snapshot, Conditions & Actions, Test Plan, Medical Insights) publish after the data gate closes',
    },
    sources: [],
    verify: null,
  };
  try {
    status.sources = fs.readdirSync(paths.sources).filter((f) => /\.(json|csv|txt)$/i.test(f)).sort();
  } catch { status.sources = []; }
  try {
    status.verify = JSON.parse(fs.readFileSync(path.join(paths.result, VERIFY_FILE), 'utf8'));
  } catch { status.verify = null; }
  return status;
}

const escapeMd = (text) => String(text ?? '').replace(/([_*`[])/g, '\\$1');

/** The fix list a human works from, written next to the verify artifact. */
export function renderFixListMarkdown(artifact) {
  const L = [];
  const p = (s = '') => L.push(s);
  p('# Data fix list — the app vs the authoritative sheet');
  p();
  p(`Generated ${artifact.at} from the last \`/health verify\`.`);
  p(`Sheet: ${artifact.sheet.rows} rows across ${artifact.sheet.dates.length} dates (newest ${artifact.sheet.newestDate || 'n/a'}).`);
  p(`App: ${artifact.app.rows} rows (newest ${artifact.app.newestDate || 'n/a'}), profile \`${artifact.profile.uid}\`.`);
  p(`Exact matches ${artifact.summary.match} · values missing ${artifact.summary.missing} · app-only with no sheet line ${artifact.summary.appOnlyUnreviewed} · only in the sheet ${artifact.summary.gap}.`);
  if (artifact.sheet.unmapped?.length) {
    p(`Unmapped sheet test names (invisible to every number above): ${artifact.sheet.unmapped.map((u) => `${u.test} (${u.count})`).join(', ')}.`);
  }
  p();
  p('## Items');
  p();
  for (const item of artifact.fixList.items) {
    const mark = item.state === 'closed' ? '[x]' : item.state === 'waived' ? '[~]' : '[ ]';
    p(`- ${mark} **${item.id} — ${item.title}**`);
    p(`  - ${item.detail}`);
  }
  p();
  if (artifact.clusters && Object.keys(artifact.clusters).length) {
    p('## Rows filed under the wrong date');
    p();
    for (const c of Object.values(artifact.clusters)) {
      const groups = Object.entries(c.bySourceDate).sort()
        .map(([date, n]) => `${date} (${n} value${n === 1 ? '' : 's'})`).join(', ');
      p(`- \`${c.rowId}\` dated ${c.appDate} → ${groups}`);
    }
    p();
  }
  if (artifact.missing.length) {
    p('## Add — values the sheet has and the app does not');
    p();
    const byDate = {};
    for (const m of artifact.missing) (byDate[m.date] = byDate[m.date] || []).push(m);
    for (const [date, items] of Object.entries(byDate).sort()) {
      p(`- **${date}**: ${items.map((m) => `${m.label} ${m.value}${m.unit ? ` ${m.unit}` : ''}`).join(', ')}`);
    }
    p();
  }
  if (artifact.appOnly.length) {
    p('## Verify — app rows with no line in the sheet');
    p();
    for (const a of artifact.appOnly) {
      p(`- ${a.date}: ${a.label} ${JSON.stringify(a.value)}${a.sourceDates?.length ? ` — the sheet has that value on ${a.sourceDates.join(', ')}` : ''}`);
    }
    p();
  }
  if (artifact.gaps.length) {
    p('## In the sheet only (no app field for these)');
    p();
    for (const g of artifact.gaps) p(`- ${g.test} on ${g.date}`);
    p();
  }
  p('---');
  p();
  p(`Apply the fixes in the app, then run \`/health verify\` again — this list is regenerated and items close themselves.`);
  p();
  return L.join('\n');
}

/** The Telegram reply for a verify run. */
export function formatVerifyText(artifact) {
  const a = artifact;
  const lines = [];
  lines.push(`🩺 *Health verify — ${escapeMd(a.projectId)}*`);
  lines.push(`• profile \`${a.profile.uid}\` · ${a.profile.rows} lab rows (${a.profile.source})`);
  lines.push(`• sheet ${a.sheet.rows} rows / ${a.sheet.dates.length} dates · newest ${a.sheet.newestDate || 'n/a'} · banked ${shortStamp(a.sheet.fetchedAt) || 'n/a'}`);
  lines.push(`• app ${a.app.rows} rows · newest ${a.app.newestDate || 'n/a'}`);
  lines.push(`• matches ${a.summary.match} · missing ${a.summary.missing} · app-only with no sheet line ${a.summary.appOnlyUnreviewed} · sheet-only ${a.summary.gap}`);
  if (a.sheet.unmapped?.length) {
    // Not the user's problem, and saying nothing would understate the coverage.
    lines.push(`⚠ ${a.sheet.unmapped.length} sheet test name(s) in no mapping: ${a.sheet.unmapped.map((u) => `${u.test} (${u.count})`).join(', ')}`);
  }
  lines.push('');
  lines.push(`*Fix list: ${a.fixList.closed} closed · ${a.fixList.open} open${a.fixList.waived ? ` · ${a.fixList.waived} waived` : ''}*`);
  for (const item of a.fixList.items) {
    const mark = item.state === 'closed' ? '✅' : item.state === 'waived' ? '➖' : '❌';
    lines.push(`${mark} ${item.id} ${item.title}`);
    if (item.state !== 'closed') lines.push(`   ${item.detail}`);
  }
  lines.push('');
  if (a.fixList.nextAction) lines.push(`Next: ${a.fixList.nextAction.title} — fix it in the app, then \`/health verify\`.`);
  else lines.push('Every fix-list item is closed. The data gate is open for the analysis pass.');
  lines.push(`Artifacts: \`${a.workspace}/result/${VERIFY_FILE}\` and \`${FIX_LIST_FILE}\`.`);
  return lines.join('\n');
}

/** The Telegram reply for a status run. */
export function formatStatusText(status) {
  const lines = [];
  lines.push(`🩺 *Health status — ${escapeMd(status.projectId)}*`);
  lines.push(`• workspace \`${status.workspace}\``);
  lines.push(`• Drive folder \`${status.gdriveFolder || '(unset)'}\``);
  lines.push(`• sources banked: ${status.sources.length}${status.sources.length ? ` (newest \`${status.sources.slice(-1)[0]}\`)` : ''}`);
  if (!status.verify) {
    lines.push('• verify: never run — `/health ingest` then `/health verify`');
    lines.push('');
    lines.push(`Docs: ${status.docs.note}`);
    return lines.join('\n');
  }
  const a = status.verify;
  lines.push(`• app: ${a.app.rows} rows (newest ${a.app.newestDate || 'n/a'}) · profile \`${a.profile.uid}\``);
  lines.push(`• sheet: newest ${a.sheet.newestDate || 'n/a'} · banked ${shortStamp(a.sheet.fetchedAt) || 'n/a'}`);
  lines.push(`• last verify: ${shortStamp(a.at)} — ${a.fixList.closed} closed · ${a.fixList.open} open${a.fixList.waived ? ` · ${a.fixList.waived} waived` : ''}`);
  const open = a.fixList.items.filter((i) => i.state === 'open');
  if (open.length) {
    lines.push('');
    lines.push('*Still wrong:*');
    for (const item of open.slice(0, 5)) lines.push(`❌ ${item.id} ${item.title}`);
    if (open.length > 5) lines.push(`… and ${open.length - 5} more (see the fix list)`);
  }
  lines.push('');
  lines.push(a.fixList.nextAction ? `Next: ${a.fixList.nextAction.title}` : 'Next: data gate is open — start the analysis pass.');
  lines.push(`Docs: ${status.docs.note}`);
  return lines.join('\n');
}

// ---------------------------------------------------------------- CLI

function parseArgs(argv) {
  const args = { mode: '', project: DEFAULT_PROJECT, uid: '', envFile: '', json: false, folder: '' };
  for (const raw of argv) {
    if (raw === '--verify' || raw === '--status' || raw === '--ingest') { args.mode = raw.slice(2); continue; }
    if (raw === '--json') { args.json = true; continue; }
    const m = raw.match(/^--([a-z-]+)=(.*)$/);
    if (!m) continue;
    const value = m[2];
    if (m[1] === 'project') args.project = value;
    if (m[1] === 'uid') args.uid = value;
    if (m[1] === 'env-file') args.envFile = value;
    if (m[1] === 'brief-folder') args.folder = value;
  }
  return args;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const args = parseArgs(process.argv.slice(2));
  const mode = args.mode || 'status';
  const run = async () => {
    if (mode === 'verify') {
      const res = await runHealthVerify({ projectId: args.project, uid: args.uid, envFile: args.envFile });
      if (!res.ok) { console.error(`verify failed at ${res.stage}: ${res.error}`); process.exit(1); }
      console.log(args.json ? JSON.stringify(res.artifact, null, 1) : formatVerifyText(res.artifact));
      return;
    }
    if (mode === 'ingest') {
      const res = await runHealthIngest({ projectId: args.project, folderId: args.folder });
      if (!res.ok) { console.error(`ingest failed at ${res.stage}: ${res.error}`); process.exit(1); }
      const written = res.manifest.written.map((w) => `${w.file} (${w.kind}${w.tabs ? `, ${w.tabs} tabs` : ''})`);
      console.log(`ingested ${written.length} file(s) into ${res.paths.sources}`);
      for (const line of written) console.log(`- ${line}`);
      for (const s of res.manifest.skipped) console.log(`- skipped ${s.name}: ${s.reason}`);
      return;
    }
    const status = getHealthStatus({ projectId: args.project });
    console.log(args.json ? JSON.stringify(status, null, 1) : formatStatusText(status));
  };
  run().catch((err) => { console.error(`health runner failed: ${err.message}`); process.exit(1); });
}
