#!/usr/bin/env node
/**
 * health-runner.mjs — the Personal Health Coach project's data loop.
 *
 *   /health verify  re-read the app (read-only), diff it against the sheet the
 *                   Brief folder holds, and print the fix list closed/open
 *   /health ingest  pull the Brief folder's sheets and docs into the workspace
 *   /health refresh verify, then publish the four documents from the templates
 *                   into the project folder — idempotent by doc id
 *   /health analyze the analysis producer: one seat turn, judged before it
 *                   lands, writing result/health-analysis.json — the payload
 *                   the four documents are published from. Refuses while the
 *                   data gate is open; a payload the publisher would refuse is
 *                   never saved under a weaker name
 *   /health readiness  can a seat run at all: workspace, brief, gate, artifact
 *                   age, context bytes, model credential, role drift
 *   /health doctor  the seat that checks the other seats: re-read the analyst's
 *                   claims, trace each to a receipt, strike what does not hold,
 *                   and write result/doctor-report.md — refused, having written
 *                   nothing, unless the report passes the checker
 *   /health research the literature lane's reach: search through the declared
 *                   provider chain, fetch every hit for real, and record it in
 *                   result/health-research.json — the only links document 4 may
 *                   cite. No credential is a named refusal, never an empty result
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
import { loadD1Config, discoverAccountId, createD1Reader, QUERIES, resolveProfileUid, parseProfile, parseEnvFile } from './lib/health/d1.mjs';
import { newestSourceFile, readBankedSheet, ingestBriefFolder, briefCredential } from './lib/health/sheet.mjs';
import { extractAppState, reconcile, evaluateFixList, verdictsOf, unreviewedAppRows, markerLabel } from './lib/health/reconcile.mjs';
import {
  DOC_SPECS, SECTION_SOURCES, DOCS_FILE, REFRESH_FILE, REFRESH_LOG, DOCTOR_ARTIFACT,
  gateFromArtifact, sectionPlan, planPublish, publishDocs, googleDocsStore,
  loadDocsRegistry, applyReceipts, adoptFromListing,
  validateAnalysisSections, ANALYSIS_SECTIONS, STALE_AFTER_DAYS,
} from './lib/health/docs.mjs';
import { foldersFromEnv } from './lib/google-store.mjs';
import { checkHealthReadiness, formatReadinessText, CONTEXT_ENV_FILE } from './lib/health/readiness.mjs';
import { buildHealthContext, renderContextBlock } from './lib/health/context.mjs';
import { validateDoctorReport, renderDoctorReport } from './lib/health/doctor.mjs';
import {
  MAX_HITS_PER_QUERY, RESEARCH_LOG, applyResearch, fetchHit, loadResearchLog, searchAvailability, webSearch,
  CITATION_SOURCES, validateInsightCitations,
} from './lib/health/research.mjs';
import { geminiKeyIn } from './lib/agent-gemini.mjs';
import { executeRoleTurn } from './council-runner.mjs';

export const DEFAULT_PROJECT = 'external-health';
export const VERIFY_FILE = 'health-verify.json';
export const FIX_LIST_FILE = 'health-fix-list.md';
/** The Doctor's own output. */
export const DOCTOR_FILE = 'doctor-report.md';
/**
 * The Doctor's receipt (`health-doctor.json`) is named in the publisher's module
 * now — `/health refresh` reads it and `/health readiness` reports on it — so the
 * name is one constant, not two literals that can drift. Re-exported from here
 * because this module's callers (and the sensor) already read it from here.
 */
export { DOCTOR_ARTIFACT };
/** The one payload the four documents are published from (payload + receipt). */
export const ANALYSIS_FILE = 'health-analysis.json';
/** The literature lane's ledger: every fetched url, and every one that refused. */
export { RESEARCH_LOG };

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
    // Exact matches are a list, not just a count: the documents are built from
    // them ("what is trusted"), and a count cannot be published as a value.
    matches: verdictsOf(report, 'MATCH').map((v) => ({ key: v.key, label: markerLabel(v.key), date: v.date, value: v.value, unit: v.unit })),
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

// ------------------------------------------------------------- the four documents

/**
 * Where the four documents live: the project folder in Drive.
 *
 * `HEALTH_DOCS_FOLDER` is this project's name for it; `GOOGLE_FOLDER_EXTERNAL_HEALTH`
 * is the store's per-project map (upper-underscore, because systemd silently drops
 * a variable name with a hyphen in it). The project folder is
 * `External-Personal-Health-Coach` and the Brief folder is a subfolder of it, so
 * the documents land beside `Brief`, never inside it.
 */
export function docsFolder({ env = process.env, folderId = '' } = {}) {
  const explicit = String(folderId || env.HEALTH_DOCS_FOLDER || '').trim();
  if (explicit) return explicit;
  return String(foldersFromEnv(env)['external-health'] || '').trim();
}

/** The committed templates, by document key. A missing template is an error, not an empty doc. */
export function loadHealthTemplates({ projectId = DEFAULT_PROJECT, readFile = (f) => fs.readFileSync(f, 'utf8') } = {}) {
  const project = KNOWN_PROJECTS[projectId];
  const dir = path.join(project?.templateDir || '', 'templates');
  const templates = {};
  const missing = [];
  for (const spec of DOC_SPECS) {
    try {
      templates[spec.key] = readFile(path.join(dir, spec.template));
    } catch {
      templates[spec.key] = '';
      missing.push(spec.template);
    }
  }
  return { templates, missing, dir };
}

/**
 * The analysis payload the analysis pass leaves behind, or the one named by
 * --analysis.
 *
 * Parsing is not enough: a payload can be valid JSON and still be a malformed
 * claim (an object where a list of lines belongs), and it is about to be
 * published into a document a person reads as advice. `validateAnalysisSections`
 * refuses those before the plan is built, so the run stops at `stage: 'analysis'`
 * having written nothing — the same fail-closed shape as a template that will
 * not render.
 */
export function loadAnalysisFile(file, { readFile = (f) => fs.readFileSync(f, 'utf8') } = {}) {
  if (!file) return { ok: true, sections: {}, file: '' };
  let parsed;
  try {
    parsed = JSON.parse(readFile(file, 'utf8'));
  } catch (err) {
    return { ok: false, error: `analysis file does not read: ${err.message}`, file };
  }
  const checked = validateAnalysisSections(parsed?.sections);
  if (!checked.ok) return { ok: false, error: `analysis payload refused: ${checked.error}`, file };
  return { ok: true, sections: checked.sections, file, at: parsed?.at || '' };
}

/**
 * `/health refresh` — verify, then publish the four documents.
 *
 * Order matters: the documents are built from the verify artifact, so a refresh
 * on stale data is impossible; a failed verify stops the run before any write.
 * Every dependency is injectable (`store`, `token`, `templates`, `fetchImpl`) so
 * the sensor proves create/update/skip and the gate refusal with no credential
 * and no network.
 */
export async function runHealthRefresh({
  projectId = DEFAULT_PROJECT,
  uid = '',
  env = process.env,
  envFile = '',
  now = new Date(),
  fetchImpl = fetch,
  workspace = '',
  folderId = '',
  store = null,
  token = '',
  botId = '',
  templates = null,
  analysis = null,
  citations: citationLog = null,
  only = [],
  force = false,
  dryRun = false,
} = {}) {
  const paths = workspace
    ? { workspace, sources: path.join(workspace, 'sources'), result: path.join(workspace, 'result') }
    : healthPaths(projectId, { env });

  const verify = await runHealthVerify({ projectId, uid, env, envFile, now, fetchImpl, workspace: paths.workspace });
  if (!verify.ok) return { ok: false, stage: `verify/${verify.stage}`, error: verify.error };

  const folder = docsFolder({ env, folderId });
  if (!folder) {
    return {
      ok: false,
      stage: 'config',
      error: 'no documents folder — set HEALTH_DOCS_FOLDER (or GOOGLE_FOLDER_EXTERNAL_HEALTH); the project folder is External-Personal-Health-Coach',
      verify: verify.artifact,
    };
  }

  let useToken = String(token || '');
  if (!useToken) {
    const cred = await briefCredential({ botId, env, home: undefined });
    if (!cred.ok) return { ok: false, stage: 'credential', error: cred.error, verify: verify.artifact };
    useToken = String(cred.token || '');
  }

  const registryFile = path.join(paths.result, DOCS_FILE);
  const registry = loadDocsRegistry(registryFile);
  const loaded = templates ? { templates, missing: [], dir: '' } : loadHealthTemplates({ projectId });
  if (loaded.missing.length) {
    return { ok: false, stage: 'templates', error: `template(s) missing: ${loaded.missing.join(', ')} in ${loaded.dir}`, verify: verify.artifact };
  }
  // A named analysis file that does not read is a refusal; the *default* file
  // simply not existing yet is normal — the analysis pass has not run.
  const explicitAnalysis = String(analysis || '').trim();
  const analysisFile = explicitAnalysis || path.join(paths.result, ANALYSIS_FILE);
  let loadedAnalysis = { ok: true, sections: {}, file: '' };
  if (explicitAnalysis || fs.existsSync(analysisFile)) {
    loadedAnalysis = loadAnalysisFile(analysisFile);
    if (!loadedAnalysis.ok) return { ok: false, stage: 'analysis', error: loadedAnalysis.error, verify: verify.artifact };
  }

  // The literature lane's fetch log is the only place a citable link can come
  // from — document 4's sections are checked against it at render time. A log
  // that is not there yet is normal (the lane has not run here): the refusal
  // then belongs to the section, and the document says so.
  const citations = citationLog ?? loadResearchLog(path.join(paths.result, RESEARCH_LOG));

  // The Doctor's receipt is evidence about the payload, and the publisher reads
  // it the way it reads the gate: any STRIKE withholds every analysis section,
  // naming the struck claims. The review not having run is a boundary (nothing
  // changes); a receipt that exists but cannot be read is not "no strike" — it
  // is a review that cannot be shown to be clean, so it blocks the same way.
  const doctorFile = path.join(paths.result, DOCTOR_ARTIFACT);
  let doctor = null;
  if (fs.existsSync(doctorFile)) {
    try {
      doctor = JSON.parse(fs.readFileSync(doctorFile, 'utf8'));
    } catch (err) {
      doctor = { unreadable: `the receipt does not parse: ${err.message}` };
    }
  }

  const plan = planPublish({
    artifact: verify.artifact,
    analysis: loadedAnalysis.sections,
    templates: loaded.templates,
    registry,
    now,
    citations,
    doctor,
    only,
    force,
  });

  // A template that cannot render is a stop, not a partial publish: three
  // documents out of four would leave the fourth silently stale.
  const broken = plan.items.filter((i) => i.action === 'error');
  if (broken.length) return { ok: false, stage: 'template', error: broken.map((b) => b.error).join('; '), verify: verify.artifact };

  const useStore = store || googleDocsStore();
  // A registry that lost its ids (a fresh checkout, a wiped result/) must adopt
  // the docs that are already in the folder instead of creating twins of them.
  if (useStore.list && plan.items.some((i) => i.action === 'create')) {
    const listing = await useStore.list(folder, useToken);
    if (listing.ok) {
      const adopted = adoptFromListing(listing.files);
      for (const item of plan.items) {
        if (item.action === 'create' && adopted[item.key]) {
          item.docId = adopted[item.key];
          item.action = 'update';
          item.adopted = true;
        }
      }
    } else {
      plan.adoptWarning = listing.error || 'could not list the folder to adopt existing docs';
    }
  }

  const executed = dryRun
    ? { receipts: plan.items.map((i) => ({ ...i, text: undefined, note: 'dry run' })), created: 0, updated: 0, skipped: plan.items.filter((i) => i.action === 'skip').length, failed: 0, dryRun: true }
    : await publishDocs({ items: plan.items, token: useToken, folderId: folder, store: useStore });

  const nextRegistry = applyReceipts(registry, executed.receipts, { now, folderId: folder, projectId });
  const gate = plan.gate;
  const artifact = {
    at: (now instanceof Date ? now : new Date(now)).toISOString(),
    projectId,
    folderId: folder,
    mode: plan.mode,
    dryRun: Boolean(dryRun),
    gate,
    refused: [...new Set(plan.items.flatMap((i) => i.refused || []))],
    citationRefusals: plan.items.flatMap((i) => (i.citationRefused || []).map((c) => ({ key: i.key, heading: c.heading, reason: c.reason }))),
    citedLinks: Object.values(citations.hits || {}).filter((h) => h?.ok).length,
    analysisFile: loadedAnalysis.file || '',
    counts: { created: executed.created, updated: executed.updated, skipped: executed.skipped, failed: executed.failed },
    receipts: executed.receipts.map((r) => ({
      key: r.key,
      title: r.title,
      action: r.action,
      docId: r.docId || '',
      modifiedTime: r.modifiedTime || '',
      error: r.error || '',
      note: r.note || '',
      refused: (r.refused || []).length,
    })),
    verify: { at: verify.artifact.at, summary: verify.artifact.summary, sheet: verify.artifact.sheet?.file || '', fixList: { closed: verify.artifact.fixList.closed, open: verify.artifact.fixList.open, waived: verify.artifact.fixList.waived } },
  };

  try {
    fs.mkdirSync(paths.result, { recursive: true });
    fs.writeFileSync(path.join(paths.result, REFRESH_FILE), JSON.stringify(artifact, null, 1));
    fs.writeFileSync(path.join(paths.result, REFRESH_LOG), renderRefreshLog(artifact));
    if (!dryRun) fs.writeFileSync(registryFile, JSON.stringify(nextRegistry, null, 1));
  } catch (err) {
    artifact.writeError = err.message;
  }

  return { ok: true, artifact, plan, registry: nextRegistry, receipts: executed.receipts, paths, verify: verify.artifact };
}

/**
 * `/health analyze` — the analysis entry point.
 *
 * It does not analyse anything: it answers whether analysis may start, and when
 * it may, names the inputs the pass needs and where the payload goes. That is the
 * whole point — a command that "runs the analysis" while the gate is open would
 * be the failure this project exists to prevent.
 */
/**
 * What the analyst seat is asked for: the payload, in the payload's own shape.
 *
 * The mandate names every key, because a misspelt one is refused rather than
 * silently ignored, and it names the citation rule for the four document-4
 * sections: the seat may cite only links the literature lane has already
 * fetched, because the publisher withholds a section that cites anything else.
 */
const ANALYST_MANDATE = [
  'Write the analysis payload the four documents are published from. The verified data, the app context and the banked sheet are in the workspace context above; the data gate is closed, so the analysis is allowed.',
  'Answer with one JSON object and nothing else — no prose before or after it:',
  '{"sections": {"analysis.conditions": ["one claim per line"], …}}',
  'Use exactly these keys, each an array of strings: analysis.conditions, analysis.set_aside, analysis.order, analysis.escalation, analysis.renewals, analysis.never_measured, analysis.app_actions, analysis.profile, analysis.by_marker, analysis.contradictions, analysis.not_settled.',
  'Every line follows your own rules of evidence: marker → value (date) → the threshold or guideline it crosses → the candidate condition → the action → how sure this is and why. A line you cannot fill in from the context is a line you leave out, not a line you guess.',
  'The four document-4 keys (analysis.profile, analysis.by_marker, analysis.contradictions, analysis.not_settled) are under the citation contract: every one of their lines carries a link from the research section of the context — a link the literature lane has already fetched and recorded — and a year. A section citing a link nobody fetched is withheld from the published document, so cite only what the lane recorded.',
].join('\n');

/**
 * Pull the payload object out of the seat's answer.
 *
 * The seat writes prose as well as JSON, so the answer is read as: the contents
 * of the first fenced block when there is one, else the whole answer; then the
 * outermost object in it. `sections` is the documented shape, but a bare map of
 * `analysis.*` keys is accepted too — `validateAnalysisSections` is the judge of
 * what is actually a payload, and finding the object is all this does.
 */
export function extractAnalysisPayload(text) {
  const raw = String(text || '');
  const fenced = raw.match(/```(?:json)?\s*\n?([\s\S]*?)```/i);
  const haystack = fenced ? fenced[1] : raw;
  const start = haystack.indexOf('{');
  const end = haystack.lastIndexOf('}');
  if (start === -1 || end <= start) {
    return { ok: false, error: 'the seat answered without a JSON object — expected {"sections": {"analysis.…": ["…"]}}' };
  }
  let parsed;
  try {
    parsed = JSON.parse(haystack.slice(start, end + 1));
  } catch (err) {
    return { ok: false, error: `the seat's JSON does not parse: ${err.message}` };
  }
  const sections = parsed && typeof parsed === 'object' && !Array.isArray(parsed) && parsed.sections !== undefined ? parsed.sections : parsed;
  return { ok: true, sections };
}

const payloadCounts = (sections) => ({
  sections: Object.keys(sections || {}).length,
  lines: Object.values(sections || {}).reduce((n, lines) => n + (Array.isArray(lines) ? lines.length : 0), 0),
});

/**
 * `/health analyze` — the analysis producer.
 *
 * The seat turns the verified workspace into the one payload the four documents
 * are published from: the eleven `analysis.*` sections, written to
 * `result/health-analysis.json`. The seat answers in JSON, and the payload is
 * judged before it lands —
 *
 *   - the shape, because the publisher reads it as *claims*: a section value that
 *     is an object stringifies to `[object Object]` and a number reads as a bare
 *     measurement, neither of which a reader can tell from a real one;
 *   - the citation contract, because document 4's lines may cite only links the
 *     literature lane fetched and recorded in `result/health-research.json`.
 *
 * A refusal writes nothing: the gate open, a workspace the context pack refuses,
 * no model credential, a model call that failed, an answer that is not a
 * payload, a write that fails. A payload whose document-4 lines cannot be cited
 * is still written — the publisher refuses those *sections* by name at render
 * time, the payload records the reason, and the reply says which ones and why.
 * Dropping them instead would leave an empty section, which renders as "awaiting
 * the analysis pass": a quiet withholding, and that is the failure this module
 * exists to refuse.
 */
export async function runHealthAnalyze({
  projectId = DEFAULT_PROJECT,
  env = process.env,
  workspace = '',
  paths = null,
  runGemini = null,
  now = new Date(),
} = {}) {
  const dirs = paths || (workspace
    ? { workspace, sources: path.join(workspace, 'sources'), result: path.join(workspace, 'result') }
    : healthPaths(projectId, { env }));

  // The gate is the policy, and it is answered before any model call: analysis
  // on unverified data is how a wrong date becomes a wrong risk score.
  let artifact = null;
  try {
    artifact = JSON.parse(fs.readFileSync(path.join(dirs.result, VERIFY_FILE), 'utf8'));
  } catch { artifact = null; }
  if (!artifact) {
    return { ok: false, stage: 'verify', error: `no verify artifact in ${dirs.result} — run /health verify first`, paths: dirs };
  }
  const gate = gateFromArtifact(artifact);
  if (!gate.allowed) {
    return {
      ok: false,
      stage: 'gate',
      error: `the data gate is open: ${gate.open.length} item(s) — ${gate.open.join(', ')}`,
      gate,
      openItems: (artifact.fixList?.items || []).filter((i) => i.state === 'open').map((i) => ({ id: i.id, title: i.title, detail: i.detail })),
      nextAction: artifact.fixList?.nextAction || null,
      paths: dirs,
    };
  }

  // The pack is the seat's whole world: a pack that refuses (no workspace, no
  // brief) is a refusal, not an empty prompt.
  const context = buildHealthContext(dirs.workspace);
  if (!context.ok) {
    return { ok: false, stage: 'context', error: `the seat context refuses: ${context.refuses.join('; ')}`, paths: dirs };
  }

  // The credential is answered here, not discovered by the call: a payload has
  // to come from a model turn, and "no key" is the operator's to fix.
  if (!runGemini && !geminiKeyIn(env)) {
    return {
      ok: false,
      stage: 'credential',
      error: `no model credential on this host — set GEMINI_API_KEY in ${CONTEXT_ENV_FILE} (all bots on a host); an analysis payload has to come from a model call, and nothing has been written`,
      paths: dirs,
    };
  }

  let text = '';
  try {
    text = await executeRoleTurn({
      projectId,
      roleId: 'health_analyst',
      prompt: ANALYST_MANDATE,
      contextText: renderContextBlock(context),
      runGemini: runGemini || undefined,
    });
  } catch (err) {
    return { ok: false, stage: 'model', error: err.message, paths: dirs };
  }

  const extracted = extractAnalysisPayload(text);
  if (!extracted.ok) return { ok: false, stage: 'payload', error: extracted.error, paths: dirs };
  const checked = validateAnalysisSections(extracted.sections);
  if (!checked.ok) return { ok: false, stage: 'payload', error: `the seat's payload was refused: ${checked.error}`, paths: dirs };

  // The citation contract, applied as a receipt: document 4's sections may cite
  // only what the literature lane fetched. Nothing is dropped — the publisher
  // refuses an uncitable section by name, and the payload says which and why.
  const log = loadResearchLog(path.join(dirs.result, RESEARCH_LOG));
  const withheld = [];
  for (const source of CITATION_SOURCES) {
    const lines = checked.sections[source];
    if (!Array.isArray(lines) || !lines.length) continue;
    const verdict = validateInsightCitations(lines, { log });
    if (!verdict.ok) {
      withheld.push({
        source,
        reason: verdict.reason,
        detail: verdict.unverified?.length ? `${verdict.unverified.length} link(s) are not in the fetch log` : '',
      });
    }
  }

  const at = (now instanceof Date ? now : new Date(now)).toISOString();
  const payload = {
    at,
    projectId,
    workspace: dirs.workspace,
    role: 'health_analyst',
    gate: { allowed: gate.allowed, closed: gate.closed.length, waived: gate.waived.length, total: gate.total, asOf: gate.asOf },
    citations: {
      log: Boolean(log && Object.keys(log.hits || {}).length),
      fetched: log ? Object.keys(log.hits || {}).filter((url) => log.hits[url]?.ok).length : 0,
      withheld,
    },
    counts: payloadCounts(checked.sections),
    sections: checked.sections,
  };
  try {
    fs.mkdirSync(dirs.result, { recursive: true });
    fs.writeFileSync(path.join(dirs.result, ANALYSIS_FILE), `${JSON.stringify(payload, null, 1)}\n`);
  } catch (err) {
    return { ok: false, stage: 'write', error: err.message, paths: dirs };
  }

  const receipt = {
    at,
    file: path.join(dirs.result, ANALYSIS_FILE),
    role: 'health_analyst',
    sections: payload.counts.sections,
    lines: payload.counts.lines,
    gate: payload.gate,
    citations: payload.citations,
  };
  return { ok: true, artifact: receipt, payload, withheld, gate, paths: dirs };
}

/**
 * `/health research` — the literature lane.
 *
 * One query in, a recorded list of fetched hits out. It never writes a claim:
 * it searches through the declared provider chain, fetches every hit over the
 * network, and records status, size and sha256 in `result/health-research.json`.
 * The Research Lead then cites from that file, and the publisher checks the
 * citations against the same file — so "verified" has exactly one meaning.
 *
 * Refusals are answers here: no credential names the variables to set and
 * records nothing (never an empty result the seat could mistake for "no
 * literature"), and a provider that answers with an error falls through the
 * chain, with every attempt reported.
 *
 * Everything network-facing is injectable (`search`, `fetchImpl`) so the lane
 * runs end to end in a sensor with no credential and no network.
 *
 * The credential is read the way D1 config is read — `envFile`, else
 * `HEALTH_ENV_FILE`, else the process env alone, process env winning over the
 * file — because that file is the one `readiness` names when it reports the
 * credential missing.
 */
export async function runHealthResearch({
  projectId = DEFAULT_PROJECT,
  env = process.env,
  envFile = '',
  paths = null,
  workspace = '',
  queries = [],
  fetchImpl = fetch,
  search = webSearch,
  now = new Date(),
} = {}) {
  const dirs = paths || (workspace
    ? { workspace, sources: path.join(workspace, 'sources'), result: path.join(workspace, 'result') }
    : healthPaths(projectId, { env }));
  const at = (now instanceof Date ? now : new Date(now)).toISOString();
  const list = (Array.isArray(queries) ? queries : [queries]).map((q) => String(q || '').trim()).filter(Boolean);
  const file = String(envFile || env.HEALTH_ENV_FILE || '').trim();
  let fileEnv = {};
  if (file) {
    try {
      fileEnv = parseEnvFile(fs.readFileSync(file, 'utf8'));
    } catch {
      // A credential file that does not read is not a credential: the search
      // check below reports what is missing rather than inventing a provider.
    }
  }
  const credentialEnv = { ...fileEnv, ...env };
  const availability = searchAvailability(credentialEnv);

  if (!list.length) {
    return { ok: false, stage: 'query', error: 'no query — `/health research "<what to look up>"`', availability, paths: dirs };
  }
  if (!availability.ok) {
    return {
      ok: false,
      stage: 'credential',
      error: `no search credential on this host — set one of ${availability.missing.join(', ')} in ${CONTEXT_ENV_FILE}; nothing was searched and no empty result was recorded`,
      availability,
      paths: dirs,
    };
  }

  const logFile = path.join(dirs.result, RESEARCH_LOG);
  const log = loadResearchLog(logFile);
  const queriesRun = [];
  const records = [];
  const failures = [];
  for (const query of list) {
    const found = await search({ query, env: credentialEnv, fetchImpl, limit: MAX_HITS_PER_QUERY });
    if (!found.ok) {
      failures.push({ query, reason: found.reason, error: found.error });
      continue;
    }
    let fetched = 0;
    let refused = 0;
    for (const hit of found.hits) {
      const record = await fetchHit({ ...hit, query }, { fetchImpl, now });
      records.push(record);
      if (record.ok) fetched += 1;
      else refused += 1;
    }
    queriesRun.push({ query, provider: found.provider, returned: found.hits.length, fetched, refused, attempts: found.attempts });
  }

  if (!queriesRun.length) {
    return {
      ok: false,
      stage: 'search',
      error: failures.map((f) => `"${f.query}": ${f.error}`).join('; ') || 'the declared chain returned nothing usable',
      availability,
      failures,
      paths: dirs,
    };
  }

  const next = applyResearch(log, { queries: queriesRun, records, now });
  const artifact = {
    at,
    projectId,
    workspace: dirs.workspace,
    file: logFile,
    provider: queriesRun[0].provider,
    queries: queriesRun.map((q) => ({ query: q.query, provider: q.provider, returned: q.returned, fetched: q.fetched, refused: q.refused })),
    fetched: records.filter((r) => r.ok).length,
    refusedHits: records.filter((r) => !r.ok).map((r) => ({ url: r.url, error: r.error })),
    recorded: Object.keys(next.hits).length,
    hits: records.filter((r) => r.ok).map((r) => ({ url: r.url, title: r.title, bytes: r.bytes, sha256: r.sha256, fetchedAt: r.fetchedAt })),
    failedQueries: failures.map((f) => ({ query: f.query, error: f.error })),
  };
  try {
    fs.mkdirSync(dirs.result, { recursive: true });
    fs.writeFileSync(logFile, JSON.stringify(next, null, 1));
  } catch (err) {
    return { ok: false, stage: 'write', error: err.message, paths: dirs };
  }
  return { ok: true, artifact, log: next, paths: dirs };
}

/** The Telegram reply for a research run: what was fetched, what refused, and the one rule. */
export function formatResearchText(result) {
  if (!result.ok) {
    const lines = [`🔎 *The research lane did not run (${escapeMd(result.stage)})*`];
    lines.push(escapeMd(result.error));
    if (result.stage === 'credential') {
      lines.push('');
      lines.push('Nothing was searched and nothing was recorded. A seat cannot cite a link this lane has not fetched.');
    }
    return lines.join('\n');
  }
  const a = result.artifact;
  const lines = [`🔎 *Research — ${a.fetched} hit(s) fetched and recorded*`];
  for (const q of a.queries) {
    lines.push(`• "${escapeMd(q.query)}" via ${escapeMd(q.provider)} — ${q.returned} returned · ${q.fetched} fetched · ${q.refused} refused`);
  }
  for (const h of a.refusedHits.slice(0, 5)) lines.push(`❌ ${escapeMd(h.url)} — ${escapeMd(h.error)} _(not citable)_`);
  if (a.failedQueries.length) {
    for (const f of a.failedQueries) lines.push(`⛔ "${escapeMd(f.query)}" — ${escapeMd(f.error)}`);
  }
  lines.push(`• log: \`${a.file}\` (${a.recorded} url(s) recorded)`);
  lines.push('');
  lines.push('Document 4 may cite only the urls this log recorded as fetched — the publisher refuses the rest.');
  return lines.join('\n');
}

/** The human log written next to the refresh artifact. */
export function renderRefreshLog(artifact) {
  const a = artifact;
  const L = [];
  L.push('# Document refresh — the four living documents');
  L.push('');
  L.push(`Generated ${a.at}${a.dryRun ? ' (dry run — nothing written to Drive)' : ''}.`);
  L.push(`Folder \`${a.folderId}\` · mode **${a.mode}** · gate ${a.gate.allowed ? 'closed' : `open (${a.gate.open.join(', ')})`}.`);
  L.push(`Created ${a.counts.created} · updated ${a.counts.updated} · skipped ${a.counts.skipped} · failed ${a.counts.failed}.`);
  if (a.gate?.doctor?.read) L.push(`Doctor's review: ${a.gate.doctor.counts.reviewed} claim(s) — ${a.gate.doctor.counts.pass} PASS · ${a.gate.doctor.counts.strike} STRIKE · ${a.gate.doctor.counts.unproven} UNPROVEN${a.gate.doctor.at ? ` (${a.gate.doctor.at})` : ''}.`);
  if (a.gate?.doctor?.blocked) L.push(a.gate.doctor.unreadable
    ? `Analysis withheld: the Doctor's receipt does not read (${a.gate.doctor.unreadable}).`
    : `Analysis withheld: the Doctor's report strikes ${a.gate.doctor.strikes.length} claim(s) — the analyst rewrites, the Doctor re-checks, then refresh again.`);
  if (a.refused.length) L.push(`Analysis sections withheld: ${a.refused.length} (§${a.refused.join('; §')}).`);
  L.push('');
  L.push('| Document | Action | Doc id | Analysis sections |');
  L.push('|---|---|---|---|');
  for (const r of a.receipts) {
    L.push(`| ${r.title} | ${r.action}${r.error ? ` — ${r.error}` : ''} | \`${r.docId || '—'}\` | ${r.refused ? `${r.refused} withheld` : 'rendered'} |`);
  }
  L.push('');
  L.push(`Sheet snapshot: \`${path.basename(a.verify.sheet)}\` · fix list ${a.verify.fixList.closed} closed · ${a.verify.fixList.open} open · ${a.verify.fixList.waived} waived.`);
  L.push('');
  return L.join('\n');
}

/** The Telegram reply for a refresh run. */
export function formatRefreshText(result) {
  const a = result.artifact;
  const lines = [];
  lines.push(`🩺 *Health refresh — ${escapeMd(a.projectId)}*`);
  const dr = a.gate?.doctor || {};
  lines.push(dr.blocked
    ? `⚠ the Doctor's report blocks the analysis (${dr.unreadable ? 'the receipt does not read' : `${dr.strikes.length} STRIKE(s)`}) — drafts published, analysis withheld`
    : a.gate.allowed
      ? `✅ data gate closed — publishing the analysis`
      : `⚠ data gate open (${a.gate.open.length}: ${a.gate.open.join(', ')}) — drafts published, analysis withheld`);
  lines.push(`• folder \`${a.folderId}\``);
  lines.push(`• created ${a.counts.created} · updated ${a.counts.updated} · skipped ${a.counts.skipped} · failed ${a.counts.failed}${a.dryRun ? ' _(dry run)_' : ''}`);
  for (const r of a.receipts) {
    const mark = r.action === 'failed' ? '❌' : r.action === 'skip' ? '➖' : r.action === 'update' || r.action === 'recreate' ? '♻️' : '🆕';
    lines.push(`${mark} ${escapeMd(r.title)} — ${r.action}${r.docId ? ` \`${r.docId}\`` : ''}`);
  }
  // Four different reasons a section can be withheld now, and the reply must not
  // confuse them: an open gate, a stale snapshot, the Doctor's strike, an
  // uncitable citation.
  if (a.refused.length && !a.gate.allowed) {
    lines.push('');
    lines.push(`*Withheld while the gate is open:* ${a.refused.map((h) => escapeMd(h)).join('; ')}`);
    lines.push('Fix the open items in the app, then `/health refresh` — the documents update in place.');
  } else if (a.refused.length && a.gate.stale) {
    lines.push('');
    lines.push(`*Withheld on a stale snapshot:* ${a.refused.map((h) => escapeMd(h)).join('; ')}`);
    lines.push(`The verify artifact is past the ${STALE_AFTER_DAYS}-day renewal window — run \`/health verify\`, then \`/health refresh\`.`);
  } else if (a.refused.length && a.gate?.doctor?.blocked) {
    lines.push('');
    lines.push(a.gate.doctor.unreadable
      ? `*Withheld — the Doctor's receipt does not read:* ${escapeMd(a.gate.doctor.unreadable)}`
      : `*Withheld — the Doctor's report strikes ${a.gate.doctor.strikes.length} claim(s):* ${a.gate.doctor.strikes.map((s) => escapeMd(`${s.title || s.claim || `claim ${s.index}`}${s.item ? ` (${s.item})` : ''}`)).join('; ')}`);
    lines.push('A struck claim is rewritten by the analyst (`/health analyze`), re-checked by the Doctor (`/health doctor`), and only then published — the documents update in place.');
  }
  if (a.citationRefusals?.length) {
    lines.push('');
    lines.push(`*Document 4 refused uncitable claims:* ${a.citationRefusals.map((c) => `${escapeMd(c.heading)} (${escapeMd(c.reason)})`).join('; ')}`);
    lines.push('A link may enter document 4 only after `/health research` fetched and recorded it — an unverified link is a refusal, not a link.');
  }
  lines.push(`Artifacts: \`${result.paths.result}/${REFRESH_FILE}\`, \`${REFRESH_LOG}\`, \`${DOCS_FILE}\`.`);
  return lines.join('\n');
}

/** The Telegram reply for the analysis entry point. */
export function formatAnalyzeText(result) {
  if (!result.ok) {
    if (result.stage === 'gate') {
      const lines = ['🛑 *Analysis cannot start — the data gate is open*'];
      const items = result.openItems || [];
      for (const item of items) lines.push(`❌ ${item.id} ${escapeMd(item.title)}`);
      if (!items.length) for (const id of result.gate.open) lines.push(`❌ ${id}`);
      lines.push('');
      lines.push(`Fix them in the app, then \`/health verify\` and \`/health analyze\` again. Run \`/health refresh\` to update the drafts with the current provenance.`);
      return lines.join('\n');
    }
    const lines = [`❌ *The analysis producer could not write a payload (${escapeMd(result.stage)})*`];
    lines.push(escapeMd(result.error));
    if (result.stage !== 'verify') {
      lines.push('');
      lines.push('Nothing was written — a payload the publisher would refuse is not saved under a weaker name. Fix the cause and run `/health analyze` again.');
    }
    return lines.join('\n');
  }
  const a = result.artifact;
  const lines = ['✅ *Analysis payload written — the four documents have their producer*'];
  lines.push(`• payload: \`${a.file}\` · ${a.sections} section(s), ${a.lines} line(s) · ${shortStamp(a.at)}`);
  lines.push(`• written by: \`${a.role}\``);
  lines.push(`• gate: closed (${a.gate.closed} of ${a.gate.total}${a.gate.waived ? `, ${a.gate.waived} waived` : ''})`);
  lines.push(`• literature: ${a.citations.fetched} fetched link(s) in the research log`);
  if (a.citations.withheld.length) {
    lines.push(`• withheld from document 4 by the citation contract: ${a.citations.withheld.map((w) => `\`${w.source}\` (${w.reason})`).join(', ')}`);
    lines.push('   The sections are not dropped — the published document carries the refusal instead of the claim. Run `/health research` for the links and `/health analyze` again.');
  }
  lines.push('');
  lines.push('Run `/health refresh` to publish the four documents.');
  return lines.join('\n');
}

/**
 * `/health doctor` — the seat that checks the other seats.
 *
 * The Doctor reads the same context pack every seat reads, then writes one
 * report: every claim the analyst made, traced to a receipt, with a verdict of
 * PASS, STRIKE or UNPROVEN. `validateDoctorReport` judges that report before it
 * lands — a report with no coverage header, a finding with no receipt, or a PASS
 * resting on an absence is refused and **nothing is written**, because a
 * malformed report on disk is indistinguishable from a good one to the next
 * reader (and would read back as "stage complete").
 *
 * It writes `result/doctor-report.md` and nothing else except its own receipt
 * (`result/health-doctor.json`). It never edits the payload — the analyst
 * rewrites, the Doctor re-checks — and it never touches the four published
 * documents.
 *
 * Every dependency is injectable (`runGemini`, `paths`) so the sensor and the
 * live proof drive the whole path without a credential and without a network.
 */
export async function runHealthDoctor({
  projectId = DEFAULT_PROJECT,
  env = process.env,
  paths = null,
  workspace = '',
  runGemini = null,
  now = new Date(),
} = {}) {
  const dirs = paths || (workspace
    ? { workspace, sources: path.join(workspace, 'sources'), result: path.join(workspace, 'result') }
    : healthPaths(projectId, { env }));

  // The pack is the seat's whole world: if it refuses (no workspace, no brief)
  // there is no turn to take. Missing artifacts are findings inside the pack,
  // not refusals — a seat reports what it could not see.
  const context = buildHealthContext(dirs.workspace);
  if (!context.ok) {
    return { ok: false, stage: 'context', error: `the seat context refuses: ${context.refuses.join('; ')}`, paths: dirs };
  }

  // The credential is answered here, not discovered by the model call: "no key"
  // and "the model failed" are different answers, and only one is the
  // operator's to fix. A report must come from a model call — this runner will
  // not synthesise one.
  if (!runGemini && !geminiKeyIn(env)) {
    return {
      ok: false,
      stage: 'credential',
      error: `no model credential on this host — set GEMINI_API_KEY in ${CONTEXT_ENV_FILE} (all bots on a host); a doctor report has to come from a model call, and nothing has been written`,
      paths: dirs,
    };
  }

  // The facts the checker judges with, read from the workspace the seat reads:
  // what state the payload under review is in, and which items are still open.
  let artifact = null;
  try {
    artifact = JSON.parse(fs.readFileSync(path.join(dirs.result, VERIFY_FILE), 'utf8'));
  } catch { artifact = null; }
  const gate = artifact ? gateFromArtifact(artifact) : { allowed: true, open: [], unknown: true };
  const analysisSection = context.sections.find((s) => s.key === 'analysis');
  const analysis = !analysisSection ? 'absent' : /shape: REFUSED/.test(analysisSection.text) ? 'refused' : 'accepted';

  const prompt = analysis === 'accepted'
    ? 'Re-check the analysis payload in the workspace context and write the doctor\'s report: one numbered block per claim, in the order the claims appear, with all six labels and the receipt each verdict rests on. STRIKE what does not hold; a claim whose receipt you cannot find is UNPROVEN, never PASS.'
    : analysis === 'refused'
      ? 'The analysis payload is present but the publisher refuses its shape, so no claim in it can be published yet. Write the doctor\'s report for that fact: coverage 0 claim(s) reviewed, the sections you could see, and the payload named under `Not seen:` with the shape refusal as the receipt-less finding. Review no claims.'
      : 'The workspace holds no analysis payload, so there are no claims to review. Write the doctor\'s report for what you could see: coverage 0 claim(s) reviewed, the sections you read, and the missing payload named under `Not seen:` — review no claims, and do not supply any of your own.';

  let text = '';
  try {
    text = await executeRoleTurn({
      projectId,
      roleId: 'doctor',
      prompt,
      contextText: renderContextBlock(context),
      runGemini: runGemini || undefined,
    });
  } catch (err) {
    return { ok: false, stage: 'model', error: err.message, paths: dirs };
  }

  const checked = validateDoctorReport(text, { analysis, gate });
  if (!checked.ok) {
    return { ok: false, stage: 'report', error: checked.error, paths: dirs };
  }

  const at = (now instanceof Date ? now : new Date(now)).toISOString();
  const report = renderDoctorReport(text);
  const receipt = {
    at,
    projectId,
    workspace: dirs.workspace,
    reportFile: path.join(dirs.result, DOCTOR_FILE),
    bytes: Buffer.byteLength(report),
    analysis: {
      state: analysis,
      file: path.join(dirs.result, ANALYSIS_FILE),
      at: analysisSection?.date || '',
      sections: context.sections.length,
    },
    gate: { allowed: gate.allowed, open: gate.open, read: !gate.unknown },
    coverage: checked.report.coverage,
    counts: checked.report.counts,
    claims: checked.report.claims,
  };
  try {
    fs.mkdirSync(dirs.result, { recursive: true });
    fs.writeFileSync(path.join(dirs.result, DOCTOR_FILE), report);
    fs.writeFileSync(path.join(dirs.result, DOCTOR_ARTIFACT), JSON.stringify(receipt, null, 1));
  } catch (err) {
    return { ok: false, stage: 'write', error: err.message, paths: dirs, report: checked.report };
  }

  return { ok: true, artifact: receipt, report: checked.report, text: report, paths: dirs };
}

/**
 * The Telegram reply for a doctor run.
 *
 * The gate being open is the normal case, so the reply says what the numbers
 * mean instead of dressing them as a failure: UNPROVEN is the honest verdict
 * for a claim resting on an open item, and naming that item is the whole job.
 */
export function formatDoctorText(result) {
  if (!result.ok) {
    const lines = [`🩺 *The Doctor could not write a report (${escapeMd(result.stage)})*`];
    lines.push(escapeMd(result.error));
    if (result.stage === 'report' || result.stage === 'model' || result.stage === 'write') {
      lines.push('');
      lines.push('Nothing was written — a report the checker refuses is not saved under a weaker name. Fix the cause and run `/health doctor` again.');
    }
    return lines.join('\n');
  }
  const a = result.artifact;
  const lines = ["🩺 *Doctor's report — the claims were re-checked*", ''];
  lines.push(`• coverage: ${a.coverage.reviewed} claim(s) reviewed · payload ${escapeMd(a.analysis.state)}`);
  lines.push(`• verdicts: ${a.counts.pass} PASS · ${a.counts.strike} STRIKE · ${a.counts.unproven} UNPROVEN`);
  lines.push(`• gate: ${a.gate.allowed ? 'CLOSED' : `OPEN (${a.gate.open.join(', ')})`}`);
  if (a.counts.unproven) {
    lines.push('   UNPROVEN is the honest verdict while an item is open — the item id in the block is what closes it.');
  }
  if (a.counts.strike) {
    lines.push(`   ${a.counts.strike} claim(s) struck: the owning seat rewrites them, the report does not.`);
  }
  lines.push(`• report: \`${a.reportFile}\``);
  lines.push('');
  lines.push('The four published documents were not touched — the Doctor only reads them.');
  return lines.join('\n');
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
      folderId: docsFolder({ env }),
      ids: {},
      lastRefresh: '',
      mode: '',
      note: 'the four documents (Health Snapshot, Conditions & Actions, Test Plan, Medical Insights) are published by /health refresh; while the data gate is open they are drafts and their analysis sections are withheld',
    },
    sources: [],
    verify: null,
    refresh: null,
  };
  try {
    status.sources = fs.readdirSync(paths.sources).filter((f) => /\.(json|csv|txt)$/i.test(f)).sort();
  } catch { status.sources = []; }
  try {
    status.verify = JSON.parse(fs.readFileSync(path.join(paths.result, VERIFY_FILE), 'utf8'));
  } catch { status.verify = null; }
  try {
    status.refresh = JSON.parse(fs.readFileSync(path.join(paths.result, REFRESH_FILE), 'utf8'));
  } catch { status.refresh = null; }
  const registry = loadDocsRegistry(path.join(paths.result, DOCS_FILE));
  const ids = Object.fromEntries(Object.entries(registry.docs || {}).filter(([, v]) => v?.id).map(([k, v]) => [k, v.id]));
  status.docs.published = Object.keys(ids).length > 0;
  status.docs.ids = ids;
  status.docs.lastRefresh = registry.updatedAt || status.refresh?.at || '';
  status.docs.mode = status.refresh?.mode || (status.docs.published ? 'draft' : '');
  return status;
}

/** The one or two lines every status reply carries about the documents. */
function docsStatusLines(status) {
  if (!status.docs.published) return ['Docs: not published yet — `/health refresh` creates them (drafts while the gate is open)'];
  const count = Object.keys(status.docs.ids).length;
  const lines = [
    `Docs: ${count} published${status.docs.lastRefresh ? ` (last refresh ${shortStamp(status.docs.lastRefresh)})` : ''}${status.docs.mode === 'draft' ? ' — drafts: data gate open, analysis withheld' : ''}`,
  ];
  lines.push(`      ${Object.entries(status.docs.ids).map(([key, id]) => `${key} \`${id}\``).join(' · ')}`);
  return lines;
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
    lines.push(...docsStatusLines(status));
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
  lines.push(a.fixList.nextAction ? `Next: ${a.fixList.nextAction.title}` : 'Next: gate closed — `/health analyze` is open.');
  lines.push(...docsStatusLines(status));
  return lines.join('\n');
}

// ---------------------------------------------------------------- CLI

function parseArgs(argv) {
  const args = { mode: '', project: DEFAULT_PROJECT, uid: '', envFile: '', json: false, folder: '', docsFolder: '', analysis: '', query: '', docs: [], force: false, dryRun: false };
  for (const raw of argv) {
    if (raw === '--verify' || raw === '--status' || raw === '--ingest' || raw === '--refresh' || raw === '--analyze' || raw === '--readiness' || raw === '--doctor' || raw === '--research') { args.mode = raw.slice(2); continue; }
    if (raw === '--json') { args.json = true; continue; }
    if (raw === '--force') { args.force = true; continue; }
    if (raw === '--dry-run') { args.dryRun = true; continue; }
    const m = raw.match(/^--([a-z-]+)=(.*)$/);
    if (!m) continue;
    const value = m[2];
    if (m[1] === 'project') args.project = value;
    if (m[1] === 'query') args.query = value;
    if (m[1] === 'uid') args.uid = value;
    if (m[1] === 'env-file') args.envFile = value;
    if (m[1] === 'brief-folder') args.folder = value;
    if (m[1] === 'docs-folder') args.docsFolder = value;
    if (m[1] === 'analysis') args.analysis = value;
    if (m[1] === 'docs') args.docs = value.split(',').map((s) => s.trim()).filter(Boolean);
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
    if (mode === 'refresh') {
      const res = await runHealthRefresh({
        projectId: args.project,
        uid: args.uid,
        envFile: args.envFile,
        folderId: args.docsFolder,
        analysis: args.analysis || null,
        only: args.docs,
        force: args.force,
        dryRun: args.dryRun,
      });
      if (!res.ok) { console.error(`refresh failed at ${res.stage}: ${res.error}`); process.exit(1); }
      console.log(args.json ? JSON.stringify(res.artifact, null, 1) : formatRefreshText(res));
      return;
    }
    if (mode === 'readiness') {
      // Exit 3 when a seat could not run — the same "refused on purpose" code
      // --analyze uses, so a caller can tell "not ready" from "crashed".
      // The model probe is awaited here, not inside the check, so the check
      // stays synchronous for its 15 other call sites. This is the surface the
      // operator reads, so it gets the honest answer: what the host can run.
      //
      // `HEALTH_SEAT_MODEL_CATALOG=''` makes the probe resolve to "no lanes"
      // without asking anything, which is how the sensor drives the refusing
      // case without depending on whether the machine running the suite has an
      // OpenCode CLI. Unset means the real host, which is the point.
      const { seatModelReach } = await import('./lib/health/seat-model.mjs');
      const forcedCatalog = Object.prototype.hasOwnProperty.call(process.env, 'HEALTH_SEAT_MODEL_CATALOG')
        ? String(process.env.HEALTH_SEAT_MODEL_CATALOG || '').split(',').map((s) => s.trim()).filter(Boolean)
        : null;
      const modelReach = await seatModelReach({ models: forcedCatalog });
      const res = checkHealthReadiness({ projectId: args.project, paths: healthPaths(args.project), modelReach });
      console.log(args.json ? JSON.stringify(res, null, 1) : formatReadinessText(res));
      process.exit(res.exit);
    }
    if (mode === 'research') {
      // A refusal is the answer here too: no query, no search credential, or a
      // provider that answered nothing are all exit 3 — the same "refused on
      // purpose" code --readiness, --doctor and --analyze use — never a silent
      // success with an empty result.
      const res = await runHealthResearch({
        projectId: args.project,
        envFile: args.envFile,
        queries: args.query ? [args.query] : [],
      });
      if (!res.ok) {
        console.log(args.json ? JSON.stringify(res, null, 1) : formatResearchText(res));
        process.exit(3);
      }
      console.log(args.json ? JSON.stringify(res.artifact, null, 1) : formatResearchText(res));
      return;
    }
    if (mode === 'doctor') {
      const res = await runHealthDoctor({ projectId: args.project });
      if (!res.ok) {
        // The refusal is the answer, not a crash — it goes to stdout where a
        // caller asked for it, and exits 3, the same "refused on purpose" code
        // --readiness uses.
        console.log(args.json ? JSON.stringify(res, null, 1) : formatDoctorText(res));
        process.exit(3);
      }
      console.log(args.json ? JSON.stringify(res.artifact, null, 1) : formatDoctorText(res));
      return;
    }
    if (mode === 'analyze') {
      const res = await runHealthAnalyze({ projectId: args.project });
      if (!res.ok) {
        // Every refusal here is an answer, not a crash — the gate is open, the
        // credential is missing, the model call failed, the answer was not a
        // payload. Exit 3 is the repo's "refused on purpose" code (--readiness,
        // --doctor and --research use it too) and the reply says what was
        // refused, on stdout where a --json caller can read it.
        console.log(args.json ? JSON.stringify(res, null, 1) : formatAnalyzeText(res));
        process.exit(3);
      }
      console.log(args.json ? JSON.stringify(res, null, 1) : formatAnalyzeText(res));
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
