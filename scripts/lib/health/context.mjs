/**
 * context.mjs — what a seat is allowed to see.
 *
 * The council reader (`readWorkspaceContext` in scripts/council-runner.mjs) was
 * written for the case/ layout: root `*.md` plus `case/` and `working/`. Run
 * against the Personal Health Coach's workspace it returned exactly one file —
 * `BRIEF.md`, 1906 bytes — so a seat reasoned from the brief and none of the
 * verified data: not the verify artifact, not the fix list, not the published
 * documents, not the banked sheet. Five seats that cannot see the numbers are
 * five opinions about a brief.
 *
 * This module is the health project's context provider. It reads the workspace
 * as a *data* workspace and renders a bounded digest a seat can cite:
 *
 *   - every section carries its path and its date, so a claim can be traced back
 *     to the bytes it came from;
 *   - every candidate source is either present as a section or listed under
 *     `not present:`, so a missing artifact is a finding, never a silent hole
 *     (soul law 4 — what is missing is a finding);
 *   - each section has its own byte budget and marks its own truncation inline,
 *     because the old blind 1000-character slice cut the fix list mid-item and
 *     said nothing about it.
 *
 * Read-only: this module reads files and returns text. It writes nothing, and it
 * never reaches the app, the sheet, or Drive.
 *
 * A missing *artifact* is a finding, not a refusal — a seat may run with an empty
 * workspace and report that nothing is there. A missing *brief* is a refusal,
 * because a seat that cannot see the brief must not run at all.
 */
import fs from 'node:fs';
import path from 'node:path';

import { KNOWN_PROJECTS } from '../project-registry.mjs';
import { DOCS_FILE, gateFromArtifact, loadDocsRegistry, validateAnalysisSections } from './docs.mjs';
import { RESEARCH_LOG } from './research.mjs';

export const VERIFY_FILE = 'health-verify.json';
export const FIX_LIST_FILE = 'health-fix-list.md';
export const ANALYSIS_FILE = 'health-analysis.json';
export const REFRESH_FILE = 'health-refresh.json';

/** The brief, in the order the workspace may hold it. */
export const BRIEF_FILES = ['BRIEF.md', 'brief.md', 'charter.md', 'CHARTER.md'];

/**
 * Per-section byte budgets.
 *
 * Sized by what the section is for: the brief and the analysis payload are read
 * whole (they are the mandate and the object under review), while the verify
 * artifact and the document registry are digests because their value is in the
 * gate and the counts, not the raw arrays.
 */
export const CONTEXT_BUDGET = {
  brief: 8000,
  verify: 3000,
  fix_list: 6000,
  analysis: 12000,
  docs: 1500,
  refresh: 1500,
  research: 3000,
  sources: 2500,
};

/**
 * Every source the pack looks for, in the order a seat should read them.
 *
 * The pack's one structural invariant is that each of these keys ends up either
 * as a section or in `absent` — never dropped. A source that silently vanishes
 * is how a seat ends up reasoning about data it never saw, and the sensor pins
 * the invariant (see assert-external-health.test.mjs).
 */
export const CONTEXT_CANDIDATES = [
  { key: 'brief', label: 'The brief', rel: 'BRIEF.md' },
  { key: 'verify', label: 'The verify artifact (what the app said vs what the sheet says)', rel: `result/${VERIFY_FILE}` },
  { key: 'fix_list', label: 'The fix list (what the user must repair in the app)', rel: `result/${FIX_LIST_FILE}` },
  { key: 'analysis', label: 'The analysis payload under review', rel: `result/${ANALYSIS_FILE}` },
  { key: 'docs', label: 'The published documents registry', rel: `result/${DOCS_FILE}` },
  { key: 'refresh', label: 'The last refresh receipt', rel: `result/${REFRESH_FILE}` },
  // The literature lane's ledger: every url it fetched, with the hash of what
  // came back. The Research Lead cites from here, and the publisher checks the
  // citations against the same file — so the seat and the gate read one source.
  { key: 'research', label: 'The recorded research hits (the only citable links)', rel: `result/${RESEARCH_LOG}` },
  { key: 'sources', label: 'The banked sources', rel: 'sources/' },
];

/**
 * A character prefix whose UTF-8 length fits the budget.
 *
 * Budgets are bytes, so the cut cannot be a plain `slice(0, n)`: one `→` in a
 * marker trend line is three bytes, and slicing by code units would either
 * overshoot the budget or split a character. Iterating code points keeps both
 * ends honest.
 */
function bytePrefix(text, budget) {
  let bytes = 0;
  let cut = 0;
  for (const ch of text) {
    const b = Buffer.byteLength(ch);
    if (bytes + b > budget) break;
    bytes += b;
    cut += ch.length;
  }
  return cut;
}

/** Clip to a byte budget, marking the withheld bytes in the text itself. */
export function clipToBudget(text, budget) {
  const raw = String(text ?? '');
  const total = Buffer.byteLength(raw);
  if (total <= budget) return { text: raw, bytes: total, truncatedBytes: 0 };
  const kept = raw.slice(0, bytePrefix(raw, budget));
  const truncatedBytes = total - Buffer.byteLength(kept);
  return { text: `${kept}\n… [truncated: ${truncatedBytes} bytes withheld]`, bytes: total, truncatedBytes };
}

const stamp = (iso) => String(iso || '').slice(0, 16).replace('T', ' ');
const base = (p) => path.basename(String(p || '')) || '(none)';
const count = (v) => (Array.isArray(v) ? v.length : 0);

/** The verify artifact as a seat needs it: the gate first, then the numbers. */
export function digestVerify(artifact) {
  const a = artifact || {};
  const gate = gateFromArtifact(a);
  const fix = a.fixList || {};
  const items = Array.isArray(fix.items) ? fix.items : [];
  const L = [];
  L.push(`generated: ${a.at || 'unknown'}`);
  L.push(gate.allowed
    ? (items.length
        ? 'data gate: CLOSED — every fix-list item is closed or waived, so analysis may publish'
        : 'data gate: unreadable — the artifact carries no fix-list items at all, so nothing here proves the gate is closed')
    : `data gate: OPEN (${gate.open.length}: ${gate.open.join(', ')}) — analysis is refused, and any claim that rests on an open item is unproven until it closes`);
  L.push(`fix list: ${fix.closed ?? '?'} closed · ${fix.open ?? '?'} open · ${fix.waived ?? '?'} waived`);
  for (const item of items) {
    const mark = item.state === 'closed' ? '✅' : item.state === 'waived' ? '☑' : '❌';
    L.push(`  ${mark} ${item.id} — ${item.title}${item.state === 'open' && item.detail ? `: ${item.detail}` : ''}`);
  }
  if (!items.length) L.push('  (the artifact carries no fix-list items)');
  if (fix.nextAction) L.push(`next action: ${fix.nextAction.id} ${fix.nextAction.title}`);
  const p = a.profile || {};
  const f = p.fields || {};
  const fields = ['age', 'height', 'weight'].map((k) => `${k} ${f[k] ?? '—'}`).join(' · ');
  L.push(`profile: uid ${p.uid || '(none)'} · ${p.rows ?? '?'} lab rows (${p.source || 'source n/a'}) · ${fields}`);
  const s = a.sheet || {};
  L.push(`sheet (the source of truth): ${base(s.file)} · ${s.rows ?? '?'} rows / ${count(s.dates)} dates · newest ${s.newestDate || 'n/a'} · banked ${s.fetchedAt || 'n/a'}`);
  const app = a.app || {};
  L.push(`app (the copy): ${app.rows ?? '?'} rows · newest ${app.newestDate || 'n/a'}${count(app.newerThanSheet) ? ` · dates newer than the sheet: ${app.newerThanSheet.join(', ')}` : ''}`);
  L.push(a.summary
    ? `coverage: ${a.summary.match} exact matches · ${a.summary.missing} values the sheet has and the app does not · ${a.summary.appOnlyUnreviewed} app rows with no sheet line · ${a.summary.gap} sheet-only tests`
    : 'coverage: the artifact carries no summary block');
  if (count(s.unmapped)) L.push(`unmapped sheet test names (invisible to every count above): ${s.unmapped.map((u) => `${u.test} (${u.count})`).join(', ')}`);
  if (count(a.structural)) L.push(`structural findings: ${a.structural.length}`);
  if (a.clusters && Object.keys(a.clusters).length) L.push(`rows filed under the wrong date: ${Object.keys(a.clusters).length}`);
  return L.join('\n');
}

/**
 * The research log as a citable list — fetched urls with their receipts, and
 * the ones that were tried and refused so "we looked" is visible too.
 */
export function digestResearch(log) {
  const hits = Object.values(log?.hits || {});
  const fetched = hits.filter((h) => h.ok === true);
  const refused = hits.filter((h) => h.ok !== true);
  const L = [];
  L.push(`recorded: ${hits.length} url(s) · fetched ${fetched.length} · refused ${refused.length}`);
  const queries = log?.queries || [];
  if (queries.length) {
    L.push(`queries run: ${queries.slice(-3).map((q) => `"${q.query}" via ${q.provider}${q.fetched != null ? ` (${q.fetched} fetched)` : ''}`).join('; ')}`);
  }
  for (const h of fetched.sort((a, b) => String(b.fetchedAt || '').localeCompare(String(a.fetchedAt || ''))).slice(0, 20)) {
    L.push(`  ok ${h.url} · ${h.title || '(no title)'} · fetched ${h.fetchedAt || '?'} · ${h.bytes ?? '?'} bytes · sha ${String(h.sha256 || '').slice(0, 12)}`);
  }
  for (const h of refused) L.push(`  refused ${h.url} — ${h.error || 'fetch failed'} (not citable)`);
  L.push('Cite only a url listed as ok here; the publisher refuses a link this log does not hold.');
  return L.join('\n');
}

/** The banked sources as an inventory — names, sizes and dates, never bodies. */
export function renderSourcesInventory(dir, entries) {
  const L = [`${entries.length} banked file(s) in ${base(dir)}/`];
  for (const e of entries) {
    L.push(`  ${e.name} · ${e.bytes} bytes · ${stamp(e.mtime)}`);
  }
  return L.join('\n');
}

/**
 * Build the pack.
 *
 * Returns `{ ok, workspace, at, refuses, sections, absent, bytes }`.
 * `ok:false` only when the workspace itself cannot seat a turn (no such folder,
 * or no brief/charter in it); missing artifacts land in `absent` instead, because
 * they are findings the seat should report, not reasons to stay silent.
 */
/**
 * Where the brief actually lives.
 *
 * This workspace is a *data* workspace: it holds `result/` and `sources/` and
 * nothing else, and the brief is committed with the pack in the repo. Roles
 * already resolve that way — the registry prefers the repo copy of `roles/` and
 * treats a workspace copy as a mirror it only checks for drift — so the brief
 * follows the same rule. Looking only in the workspace refused every seat on a
 * workspace that never had a copy to begin with, which is most of them.
 *
 * The fallback is deliberately narrow. It applies only when the workspace *is*
 * the project's own registered workspace, so the project's charter can only ever
 * reach the project's own seats; pointing the lane at some other directory still
 * refuses, because borrowing a mandate from an unrelated pack is the exact
 * failure this reader exists to prevent. Within the workspace, a local copy
 * still wins: if an operator put one there, that is the one they mean.
 */
function resolveBrief(ws, projectId, registry) {
  const project = registry?.[projectId];
  const own = project && project.workspace && path.resolve(project.workspace) === path.resolve(ws);
  const dirs = [ws];
  if (own && project.templateDir) dirs.push(project.templateDir);
  for (const dir of dirs) {
    for (const name of BRIEF_FILES) {
      const abs = path.join(dir, name);
      try {
        if (!fs.statSync(abs).isFile()) continue;
      } catch {
        continue;
      }
      return { file: abs, inWorkspace: dir === ws };
    }
  }
  return null;
}

/**
 * Exported for the gate. `registry` is injectable so the rule can be proved
 * against fixtures rather than against whichever home directory the run has.
 */
export const __briefResolver = resolveBrief;

export function buildHealthContext(workspace, { now = new Date(), projectId = 'external-health', registry = KNOWN_PROJECTS } = {}) {
  const at = now.toISOString();
  const ws = String(workspace || '');
  const sections = [];
  const absent = [];
  const refuses = [];

  const add = (key, label, rel, date, text) => {
    const budget = CONTEXT_BUDGET[key] ?? 4000;
    const clipped = clipToBudget(text, budget);
    sections.push({ key, label, path: rel, date: date || '', text: clipped.text, bytes: clipped.bytes, truncatedBytes: clipped.truncatedBytes });
  };
  const miss = (key, rel, why) => {
    const candidate = CONTEXT_CANDIDATES.find((c) => c.key === key);
    absent.push({ key, label: candidate?.label || key, path: rel, why });
  };

  if (!ws || !fs.existsSync(ws) || !fs.statSync(ws).isDirectory()) {
    const why = `workspace ${ws || '(unset)'} is not a directory`;
    for (const c of CONTEXT_CANDIDATES) miss(c.key, c.rel, why);
    return { ok: false, workspace: ws, at, refuses: [why], sections, absent, bytes: 0 };
  }

  // --- the brief: the seats' mandate, and the only refusal that stops a turn.
  const brief = resolveBrief(ws, projectId, registry);
  if (brief) {
    const st = fs.statSync(brief.file);
    add(
      'brief',
      brief.inWorkspace ? 'The brief' : 'The brief (the pack in the repo — this workspace holds the data)',
      brief.inWorkspace ? path.basename(brief.file) : brief.file,
      st.mtime.toISOString(),
      fs.readFileSync(brief.file, 'utf8'),
    );
  } else {
    const why = `no brief or charter in ${ws} (looked for ${BRIEF_FILES.join(', ')}) — a seat that cannot see the brief must not run`;
    refuses.push(why);
    miss('brief', BRIEF_FILES[0], why);
  }

  // --- the verify artifact: the gate, the fix list, the coverage numbers.
  const verifyPath = path.join(ws, 'result', VERIFY_FILE);
  let artifact = null;
  try {
    artifact = JSON.parse(fs.readFileSync(verifyPath, 'utf8'));
  } catch (err) {
    miss('verify', `result/${VERIFY_FILE}`, fs.existsSync(verifyPath)
      ? `unreadable: ${err.message}`
      : 'not present — /health verify has not run in this workspace, so nothing here is verified');
  }
  if (artifact) add('verify', 'The verify artifact (what the app said vs what the sheet says)', `result/${VERIFY_FILE}`, artifact.at, digestVerify(artifact));

  // --- the fix list, verbatim: it is the user's work queue.
  const fixPath = path.join(ws, 'result', FIX_LIST_FILE);
  if (fs.existsSync(fixPath)) {
    const st = fs.statSync(fixPath);
    add('fix_list', 'The fix list (what the user must repair in the app)', `result/${FIX_LIST_FILE}`, st.mtime.toISOString(), fs.readFileSync(fixPath, 'utf8'));
  } else {
    miss('fix_list', `result/${FIX_LIST_FILE}`, 'not present — written by /health verify, so its absence means no verify has run');
  }

  // --- the analysis payload: the object under review, plus its shape verdict.
  const analysisPath = path.join(ws, 'result', ANALYSIS_FILE);
  if (fs.existsSync(analysisPath)) {
    const raw = fs.readFileSync(analysisPath, 'utf8');
    let parsed = null;
    let parseError = '';
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      parseError = err.message;
    }
    const shape = parsed
      ? validateAnalysisSections(parsed.sections)
      : { ok: false, error: `does not parse: ${parseError}` };
    const head = [
      `payload date: ${parsed?.at || 'unknown'}`,
      shape.ok
        ? `shape: accepted — ${Object.keys(shape.sections).length} analysis section(s)`
        : `shape: REFUSED — ${shape.error} (the publisher will refuse this file until it is fixed)`,
      '',
      '--- raw payload ---',
    ].join('\n');
    add('analysis', 'The analysis payload under review', `result/${ANALYSIS_FILE}`, parsed?.at, `${head}\n${raw}`);
  } else {
    miss('analysis', `result/${ANALYSIS_FILE}`, 'not present — the analysis pass has not written a payload, so every analysis section is unproven');
  }

  // --- the published documents: ids only. Their text is a Drop-2 concern.
  const docsPath = path.join(ws, 'result', DOCS_FILE);
  if (fs.existsSync(docsPath)) {
    const registry = loadDocsRegistry(docsPath);
    const L = [];
    L.push(`registry updated: ${registry.updatedAt || 'unknown'}`);
    const docs = registry.docs || {};
    const keys = Object.keys(docs);
    L.push(keys.length ? `${keys.length} document(s):` : 'no documents in the registry');
    for (const key of keys) {
      const d = docs[key] || {};
      L.push(`  ${key} → ${d.id || '(no id)'}${d.at ? ` · written ${d.at}` : ''}${d.hash ? ` · hash ${String(d.hash).slice(0, 12)}` : ''}`);
    }
    if (registry.renewals && Object.keys(registry.renewals).length) {
      L.push(`renewals logged: ${Object.entries(registry.renewals).map(([k, v]) => `${k} (${Object.keys(v || {}).length} date(s))`).join(', ')}`);
    }
    add('docs', 'The published documents registry', `result/${DOCS_FILE}`, registry.updatedAt, L.join('\n'));
  } else {
    miss('docs', `result/${DOCS_FILE}`, 'not present — no document has been published from this workspace yet');
  }

  // --- the last refresh: what was written to Drive, and what was withheld.
  const refreshPath = path.join(ws, 'result', REFRESH_FILE);
  if (fs.existsSync(refreshPath)) {
    let a = null;
    try {
      a = JSON.parse(fs.readFileSync(refreshPath, 'utf8'));
    } catch (err) {
      miss('refresh', `result/${REFRESH_FILE}`, `unreadable: ${err.message}`);
    }
    if (a) {
      const L = [];
      L.push(`at: ${a.at || 'unknown'}${a.dryRun ? ' (dry run — nothing written to Drive)' : ''}`);
      L.push(`mode: ${a.mode || 'unknown'} · folder ${a.folderId || '(none)'}`);
      L.push(`counts: created ${a.counts?.created ?? '?'} · updated ${a.counts?.updated ?? '?'} · skipped ${a.counts?.skipped ?? '?'} · failed ${a.counts?.failed ?? '?'}`);
      if (count(a.refused)) L.push(`analysis sections withheld: ${a.refused.join('; ')}`);
      for (const r of Array.isArray(a.receipts) ? a.receipts : []) L.push(`  ${r.title} — ${r.action}${r.docId ? ` (${r.docId})` : ''}${r.error ? ` — ${r.error}` : ''}`);
      add('refresh', 'The last refresh receipt', `result/${REFRESH_FILE}`, a.at, L.join('\n'));
    }
  } else {
    miss('refresh', `result/${REFRESH_FILE}`, 'not present — the four documents have never been published from this workspace');
  }

  // --- the research log: the citable links, and the ones that were refused.
  const researchPath = path.join(ws, 'result', RESEARCH_LOG);
  if (fs.existsSync(researchPath)) {
    let log = null;
    try {
      log = JSON.parse(fs.readFileSync(researchPath, 'utf8'));
    } catch (err) {
      miss('research', `result/${RESEARCH_LOG}`, `unreadable: ${err.message}`);
    }
    if (log) add('research', 'The recorded research hits (the only citable links)', `result/${RESEARCH_LOG}`, log.updatedAt, digestResearch(log));
  } else {
    miss('research', `result/${RESEARCH_LOG}`, 'not present — the literature lane has not run here, so no link can be cited in document 4 yet');
  }

  // --- the banked sources: the sheet dumps and doc exports the data came from.
  const sourcesDir = path.join(ws, 'sources');
  let entries = [];
  try {
    entries = fs.readdirSync(sourcesDir)
      .map((name) => {
        try {
          const st = fs.statSync(path.join(sourcesDir, name));
          return st.isFile() ? { name, bytes: st.size, mtime: st.mtime.toISOString() } : null;
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    entries = [];
  }
  if (entries.length) {
    const newest = entries.map((e) => e.mtime).sort().at(-1);
    add('sources', 'The banked sources', 'sources/', newest, renderSourcesInventory(sourcesDir, entries));
  } else {
    miss('sources', 'sources/', 'empty or absent — nothing has been banked by /health ingest, so the sheet on disk is not the one the verify compared against');
  }

  const bytes = sections.reduce((n, s) => n + s.bytes, 0);
  return { ok: refuses.length === 0, workspace: ws, at, refuses, sections, absent, bytes };
}

/**
 * The pack as one prompt block.
 *
 * Absences are printed last and as claims ("not present:") rather than omitted,
 * so a seat can say what it could not see — the safety reviewer's own rule, and
 * the reason a fresh workspace yields a report about missing data instead of a
 * confident paragraph about nothing.
 */
export function renderContextBlock(context) {
  const ctx = context || {};
  if (!ctx.ok) return '';
  const L = [];
  L.push(`## Workspace context — ${ctx.workspace}`);
  L.push(`Snapshot ${ctx.at} · read-only · ${ctx.sections.length} source(s) present`);
  L.push('');
  for (const s of ctx.sections) {
    L.push(`### ${s.label} — ${s.path}${s.date ? ` (${s.date})` : ''}`);
    L.push(s.text);
    L.push('');
  }
  if (ctx.absent?.length) {
    L.push('### not present — a finding, not a hole to fill');
    for (const a of ctx.absent) L.push(`- not present: ${a.path} — ${a.why}`);
    L.push('');
  }
  return L.join('\n');
}
