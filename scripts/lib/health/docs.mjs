/**
 * docs.mjs — the delivery half: the four documents, rendered and published.
 *
 * The gate pass built the data loop; this is the half that puts a document in
 * the project folder. Three laws decide its shape, and all three are enforced in
 * code rather than in a role file:
 *
 *  1. **Where the gate is, the analysis stops.** While `/health verify` reports
 *     an open fix-list item, every analysis section renders a refusal that names
 *     the items, and `renderSection` refuses to accept analysis content at all.
 *     A draft may exist — the header says DRAFT and names the open items — but no
 *     derived claim is ever presented as current.
 *
 *  2. **Idempotent by doc id, not by name.** The registry in
 *     `result/health-docs.json` holds one Drive id per document. A refresh
 *     updates that id in place (`replaceDocContent`); it never creates a second
 *     file. When the registry is missing, an existing doc is *adopted* by title
 *     instead of duplicated, and a doc the human deleted is recreated.
 *
 *  3. **Provenance is in the header.** Every document says which banked sheet
 *     snapshot it came from, when it was generated, which profile it describes,
 *     and which fix-list items were open at the time. A document cannot go stale
 *     quietly: the header carries the date.
 *
 * The section skeleton comes from the committed templates under
 * `projects/external-health/templates/`. `sectionPlan` reads their headings and
 * `renderDoc` fails closed on a heading this module does not know, so a template
 * edit cannot silently drop a section from the published document.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { createDocWithContent, replaceDocContent, getFile, listChildren, USER_AGENT } from '../google-store.mjs';

export const DOCS_FILE = 'health-docs.json';
export const REFRESH_FILE = 'health-refresh.json';
export const REFRESH_LOG = 'health-refresh.md';

/** The four documents, in the order the charter lists them. */
export const DOC_SPECS = [
  { key: 'snapshot', title: 'Health Snapshot', template: '01_Health_Snapshot.md' },
  { key: 'conditions', title: 'Conditions & Actions', template: '02_Conditions_and_Actions.md' },
  { key: 'test_plan', title: 'Test Plan', template: '03_Test_Plan.md' },
  { key: 'insights', title: 'Medical Insights', template: '04_Medical_Insights.md' },
];

/**
 * Heading -> where its body comes from.
 *
 * `data` sources are computed from the verify artifact (dated facts about the
 * sheet and the app copy). `analysis` sources are the analyst's or the planner's
 * output: they are refused while the gate is open and only render from an
 * analysis payload when it is closed. `renewal_log` is generated from this
 * project's own registry, so it is history, not analysis.
 */
export const SECTION_SOURCES = {
  // 01 Health Snapshot
  'What is trusted': 'data.trusted',
  'What is a placeholder, not data': 'data.placeholders',
  'What is missing': 'data.missing',
  'Where this is not enough': 'data.limits',
  // 02 Conditions & Actions
  'Candidate conditions': 'analysis.conditions',
  'What was considered and set aside': 'analysis.set_aside',
  'Order of business': 'analysis.order',
  Escalation: 'analysis.escalation',
  // 03 Test Plan
  'Renewals (normal last time, shelf life expiring)': 'analysis.renewals',
  'Never measured, and it matters': 'analysis.never_measured',
  "Reconciled with the app's pending actions": 'analysis.app_actions',
  // 04 Medical Insights
  'For this profile': 'analysis.profile',
  'By marker': 'analysis.by_marker',
  'Contradictory or unsettled evidence': 'analysis.contradictions',
  'What is not settled by the literature': 'analysis.not_settled',
  'Renewal log': 'renewal_log',
};

export const isAnalysisSource = (source) => String(source || '').startsWith('analysis.');

/**
 * Which sections a template declares, in order.
 *
 * Only `##` starts a section: the Insights template uses `### [Marker] — value,
 * date` as a repeatable sub-heading *inside* "By marker", and the analysis
 * payload supplies one block per marker. Treating a sub-heading as a section
 * would refuse the whole document for having a skeleton it does not own.
 */
export function sectionPlan(templateText) {
  const out = [];
  for (const raw of String(templateText || '').split('\n')) {
    const m = raw.match(/^##(?!#)\s+(.+?)\s*$/);
    if (!m) continue;
    out.push({ heading: m[1].replace(/\s+#+\s*$/, ''), source: SECTION_SOURCES[m[1]] || null });
  }
  return out;
}

/** Unknown headings are a refusal, not a shrug: a template edit must not drop a section. */
export function unknownSections(templateText) {
  return sectionPlan(templateText).filter((s) => !s.source).map((s) => s.heading);
}

const shortStamp = (iso) => String(iso || '').slice(0, 16).replace('T', ' ');

/**
 * The data gate, as the documents must speak about it.
 *
 * `allowed` is true only when nothing is open: waived items are the user saying
 * "I know, publish anyway", and they stay visible in the header.
 */
export function gateFromArtifact(artifact) {
  const items = artifact?.fixList?.items || [];
  const open = items.filter((i) => i.state === 'open').map((i) => i.id);
  const waived = items.filter((i) => i.state === 'waived').map((i) => i.id);
  const closed = items.filter((i) => i.state === 'closed').map((i) => i.id);
  return {
    allowed: open.length === 0,
    open,
    waived,
    closed,
    total: items.length,
    asOf: artifact?.at || '',
  };
}

/** The header every document carries: banner first, then provenance. */
export function renderHeader({ spec, artifact, gate, now, action }) {
  const L = [];
  const date = (now || new Date()).toISOString().slice(0, 10);
  L.push(`# ${spec.title} — ${date}`);
  L.push('');
  if (gate.allowed) {
    L.push(`✅ **Data gate closed** — every fix-list item is closed or waived${gate.waived.length ? ` (waived: ${gate.waived.join(', ')})` : ''}. Analysis current as of ${shortStamp(artifact?.at) || date}.`);
  } else {
    L.push(`⚠ **DRAFT — the data gate is OPEN (${gate.open.length} item${gate.open.length === 1 ? '' : 's'}: ${gate.open.join(', ')}).**`);
    L.push('Nothing below is a current analysis. The analysis sections say so in place — the refusal is deliberate, not missing.');
  }
  L.push('');
  L.push('| Provenance | |');
  L.push('|---|---|');
  L.push(`| Sheet snapshot | \`${path.basename(artifact?.sheet?.file || '') || 'n/a'}\` (banked ${shortStamp(artifact?.sheet?.fetchedAt) || 'n/a'}) |`);
  L.push(`| Sheet | ${artifact?.sheet?.title || 'n/a'} · tab ${artifact?.sheet?.tab || 'n/a'} · ${artifact?.sheet?.rows ?? 0} rows across ${artifact?.sheet?.dates?.length ?? 0} dates, newest ${artifact?.sheet?.newestDate || 'n/a'} |`);
  L.push(`| Profile | \`${artifact?.profile?.uid || 'n/a'}\` · ${artifact?.profile?.rows ?? 0} lab rows in the app copy |`);
  L.push(`| App copy read | newest row ${artifact?.app?.newestDate || 'n/a'} |`);
  L.push(`| Fix list | ${gate.closed.length} closed · ${gate.open.length} open · ${gate.waived.length} waived of ${gate.total}${gate.open.length || gate.waived.length ? ` (${[...gate.open, ...gate.waived].join(', ')})` : ''} |`);
  L.push(`| Generated | ${date} by \`/health refresh\`${action ? ` (${action})` : ''} |`);
  L.push('');
  return L;
}

/* ------------------------------------------------------------------ data sections */

function renderTrusted(artifact) {
  const rows = artifact?.matches || [];
  if (!rows.length) return ['_No marker in the app copy matches this sheet snapshot exactly._'];
  const L = rows.slice(0, 40).map((m) => `- ${m.label} ${m.value}${m.unit ? ` ${m.unit}` : ''} — ${m.date}`);
  if (rows.length > 40) L.push(`- … and ${rows.length - 40} more exact matches.`);
  return L;
}

function renderPlaceholders(artifact) {
  const items = artifact?.fixList?.items || [];
  const L = [];
  for (const id of ['H-1', 'H-3']) {
    const item = items.find((i) => i.id === id);
    if (item && item.state !== 'closed') L.push(`- ${item.detail}`);
  }
  if (!L.length) return ['_Nothing here came from an application default, and no row is empty._'];
  return L;
}

function renderMissing(artifact) {
  const L = [];
  const missing = artifact?.missing || [];
  if (missing.length) {
    const byMarker = {};
    for (const m of missing) (byMarker[m.label] = byMarker[m.label] || []).push(m.date);
    for (const [label, dates] of Object.entries(byMarker).sort()) {
      L.push(`- ${label}: the sheet has ${dates.length} value${dates.length === 1 ? '' : 's'} the app does not (${dates.sort().join(', ')})`);
    }
  }
  const gaps = artifact?.gaps || [];
  if (gaps.length) {
    const names = [...new Set(gaps.map((g) => g.test.replace(/\s+-\s+.*$/, '')))];
    L.push(`- No app field exists for: ${names.join(', ')} (${gaps.length} sheet row${gaps.length === 1 ? '' : 's'}, mostly the GPPAQ activity questions)`);
  }
  const unexplained = artifact?.appOnly || [];
  if (unexplained.length) {
    L.push(`- In the app with no line in the sheet: ${unexplained.map((a) => `${a.label} ${JSON.stringify(a.value)} on ${a.date}`).join('; ')}`);
  }
  if (!L.length) return ['_No gaps found against this sheet snapshot._'];
  return L;
}

/** The honest limits of this snapshot, all of them counted, none of them asserted. */
function renderLimits(artifact) {
  const L = [];
  const dates = {};
  for (const m of artifact?.matches || []) (dates[m.label] = dates[m.label] || new Set()).add(m.date);
  const single = Object.entries(dates).filter(([, d]) => d.size === 1).map(([label]) => label);
  if (single.length) L.push(`- Measured once in this snapshot (a single value is not a trend): ${single.slice(0, 12).join(', ')}${single.length > 12 ? `, +${single.length - 12} more` : ''}`);
  const newer = artifact?.app?.newerThanSheet || [];
  if (newer.length) L.push(`- The app holds results after the sheet's newest date (${artifact?.sheet?.newestDate || 'n/a'}): ${newer.join(', ')} — not covered by this snapshot.`);
  const unmapped = artifact?.sheet?.unmapped || [];
  if (unmapped.length) L.push(`- ${unmapped.length} sheet test name(s) have no mapping yet (${unmapped.map((u) => `${u.test} (${u.count})`).join(', ')}) — invisible to the coverage numbers above.`);
  if (!L.length) return ['_No structural limit was found in this snapshot._'];
  return L;
}

/**
 * The renewal log: one immutable row per day the document was written.
 *
 * It is deliberately *not* built from the run history. A log that changes on
 * every refresh would rewrite every document on every refresh — the monthly
 * renewal would churn daily, and "skip when nothing changed" would be a lie. A
 * day's row is set once (the first write that day) and never edited, so a later
 * run on the same day renders byte-identical text and the document is left
 * alone. Today's row is projected before it is stored, so the first write of the
 * day already contains it.
 */
function renderRenewalLog({ registry, spec, now, gate }) {
  const renewals = { ...(registry?.renewals?.[spec.key] || {}) };
  const today = (now instanceof Date ? now : new Date(now)).toISOString().slice(0, 10);
  if (!renewals[today]) renewals[today] = { open: gate?.open?.length ?? 0 };
  const days = Object.keys(renewals).sort().slice(-12).reverse();
  const L = ['| Date | What changed since the last renewal |', '|---|---|'];
  for (const day of days) L.push(`| ${day} | documents published — ${renewals[day].open ?? 0} fix-list item(s) open at the time |`);
  return L;
}

/* ------------------------------------------------------------------ refusal */

/** The one sentence an analysis section carries while the gate is open. */
export function refusalText(gate) {
  return `_Not published while the data gate is open: ${gate.open.join(', ')}. Analysis on unverified rows is how a wrong date becomes a wrong risk score — fix the items in the app, then run \`/health refresh\`._`;
}

/**
 * One section's body.
 *
 * `analysis` is the analysis pass's payload, keyed by source (`analysis.conditions`
 * etc.). Passing it while the gate is open is a refusal, not a silent drop: the
 * section comes back marked `refused` so `/health refresh` can say how many were
 * held back, and the document carries the reason.
 */
export function renderSection({ heading, source, artifact, gate, analysis = {}, registry, spec, now }) {
  if (isAnalysisSource(source)) {
    if (!gate.allowed) return { heading, refused: true, body: [refusalText(gate)] };
    const text = analysis?.[source];
    const body = Array.isArray(text) ? text : String(text || '').split('\n').filter((l) => l.trim() !== '');
    return {
      heading,
      refused: false,
      body: body.length ? body : ['_Awaiting the analysis pass — run `/health analyze` when the gate is closed._'],
    };
  }
  if (source === 'data.trusted') return { heading, refused: false, body: renderTrusted(artifact) };
  if (source === 'data.placeholders') return { heading, refused: false, body: renderPlaceholders(artifact) };
  if (source === 'data.missing') return { heading, refused: false, body: renderMissing(artifact) };
  if (source === 'data.limits') return { heading, refused: false, body: renderLimits(artifact) };
  if (source === 'renewal_log') return { heading, refused: false, body: renderRenewalLog({ registry, spec, now, gate }) };
  return { heading, refused: false, body: ['_No renderer for this section._'] };
}

/** One document's whole body: header, then every template section in order. */
export function renderDoc({ spec, templateText, artifact, analysis, registry, now, action = '' }) {
  const gate = gateFromArtifact(artifact);
  const unknown = unknownSections(templateText);
  if (unknown.length) return { ok: false, error: `template ${spec.template} has sections with no source: ${unknown.join(', ')}` };
  // A template with no sections at all would publish a header-only document:
  // that is the silent-drop failure this module exists to refuse.
  if (sectionPlan(templateText).length === 0) return { ok: false, error: `template ${spec.template} declares no sections` };
  const L = renderHeader({ spec, artifact, gate, now, action });
  const sections = [];
  for (const section of sectionPlan(templateText)) {
    const rendered = renderSection({ ...section, artifact, gate, analysis, registry, spec, now });
    sections.push(rendered);
    L.push(`## ${rendered.heading}`);
    L.push('');
    L.push(...rendered.body);
    L.push('');
  }
  const text = L.join('\n').replace(/\n{3,}/g, '\n\n');
  return {
    ok: true,
    key: spec.key,
    title: spec.title,
    text,
    gate,
    refused: sections.filter((s) => s.refused).map((s) => s.heading),
    hash: contentHash(text),
  };
}

/** Short content hash: what the registry compares to decide skip vs update. */
export function contentHash(text) {
  return crypto.createHash('sha256').update(String(text || '')).digest('hex').slice(0, 16);
}

/* ------------------------------------------------------------------ the plan */

/**
 * Decide, for every document, what the next refresh must do.
 *
 * Pure: registry + rendered content in, `create` / `update` / `skip` out. The
 * Drive calls happen in `publishDocs`, so the decision is testable with no
 * credential and no network.
 */
export function planPublish({ artifact, analysis, templates, registry, now = new Date(), only = [], force = false }) {
  const gate = gateFromArtifact(artifact);
  const wanted = only.length ? DOC_SPECS.filter((s) => only.includes(s.key) || only.includes(s.title)) : DOC_SPECS;
  const items = [];
  for (const spec of wanted) {
    const rendered = renderDoc({ spec, templateText: templates[spec.key] || '', artifact, analysis, registry, now });
    if (!rendered.ok) {
      items.push({ key: spec.key, title: spec.title, action: 'error', error: rendered.error, gate });
      continue;
    }
    const known = registry?.docs?.[spec.key] || null;
    const action = !known?.id ? 'create' : force || known.hash !== rendered.hash ? 'update' : 'skip';
    items.push({
      key: spec.key,
      title: spec.title,
      action,
      docId: known?.id || '',
      hash: rendered.hash,
      text: rendered.text,
      refused: rendered.refused,
      gate,
    });
  }
  return { items, gate, mode: gate.allowed ? 'analysis' : 'draft' };
}

/* ------------------------------------------------------------------ the store */

/**
 * Execute a plan through the Google store.
 *
 * `store` is injectable so the sensor can prove create/update/skip with a fake
 * that records every call, and so the live run can be driven by hand. A doc the
 * registry knows but Drive reports as gone is recreated rather than failing the
 * whole refresh — the id is a cache, not the document.
 */
export async function publishDocs({ items, token, folderId, store }) {
  const receipts = [];
  for (const item of items) {
    if (item.action === 'skip') { receipts.push({ ...item, text: undefined, note: 'content unchanged' }); continue; }
    if (item.action === 'error') { receipts.push({ ...item, text: undefined }); continue; }
    if (item.action === 'create') {
      const made = await store.create(folderId, item.title, item.text, token);
      if (!made.ok) { receipts.push({ ...item, text: undefined, action: 'failed', error: made.error || `HTTP ${made.status}` }); continue; }
      receipts.push({ ...item, text: undefined, action: 'create', docId: made.id, modifiedTime: made.modifiedTime || '' });
      continue;
    }
    // update: prove the target still exists first — a deleted doc must be
    // recreated, not patched into a 404.
    const stat = await store.stat(item.docId, token);
    if (!stat.ok) {
      const made = await store.create(folderId, item.title, item.text, token);
      if (!made.ok) { receipts.push({ ...item, text: undefined, action: 'failed', error: made.error || `HTTP ${made.status}` }); continue; }
      receipts.push({ ...item, text: undefined, action: 'recreate', docId: made.id, modifiedTime: made.modifiedTime || '', note: 'the recorded doc was gone' });
      continue;
    }
    const wrote = await store.replace(item.docId, item.text, token);
    if (!wrote.ok) { receipts.push({ ...item, text: undefined, action: 'failed', error: wrote.error || `HTTP ${wrote.status}` }); continue; }
    receipts.push({ ...item, text: undefined, action: 'update', docId: wrote.id || item.docId, modifiedTime: wrote.modifiedTime || '' });
  }
  return {
    receipts,
    created: receipts.filter((r) => r.action === 'create').length,
    updated: receipts.filter((r) => r.action === 'update' || r.action === 'recreate').length,
    skipped: receipts.filter((r) => r.action === 'skip').length,
    failed: receipts.filter((r) => r.action === 'failed' || r.action === 'error').length,
  };
}

/* ------------------------------------------------------------------ the registry */

/**
 * The doc-id registry: `result/health-docs.json`.
 *
 * It is the only thing that makes a refresh idempotent across machines, so it is
 * written after every run and read before the next one. `history` is capped — the
 * renewal log only needs the recent past, and an unbounded file in a synced
 * project folder is how a small feature becomes a slow one.
 */
export function loadDocsRegistry(file, { readFile = fs.readFileSync } = {}) {
  try {
    const parsed = JSON.parse(readFile(file, 'utf8'));
    if (parsed && typeof parsed === 'object') return { version: 1, docs: {}, history: [], ...parsed };
  } catch { /* no registry yet */ }
  return { version: 1, folderId: '', docs: {}, history: [] };
}

/**
 * Fold this run's receipts into the registry: ids, hashes, and the renewal log.
 *
 * A skip records nothing — that is what makes a no-op refresh a true no-op —
 * and a write fixes the day's renewal row only if that day has no row yet.
 */
export function applyReceipts(registry, receipts, { now = new Date(), folderId = '', projectId = '' } = {}) {
  const at = (now instanceof Date ? now : new Date(now)).toISOString();
  const day = at.slice(0, 10);
  const next = {
    version: 1,
    ...registry,
    projectId: projectId || registry.projectId || '',
    folderId: folderId || registry.folderId || '',
    docs: { ...(registry.docs || {}) },
    renewals: { ...(registry.renewals || {}) },
    history: [...(registry.history || [])],
  };
  for (const r of receipts) {
    const previous = next.docs[r.key] || {};
    const wrote = ['create', 'update', 'recreate'].includes(r.action);
    if (r.action === 'failed' || r.action === 'error') continue;
    if (wrote) {
      next.docs[r.key] = {
        id: r.docId || previous.id || '',
        title: r.title,
        hash: r.hash,
        at,
        modifiedTime: r.modifiedTime || previous.modifiedTime || '',
        open: r.gate?.open?.length ?? previous.open ?? 0,
      };
      next.renewals[r.key] = { ...(next.renewals[r.key] || {}) };
      if (!next.renewals[r.key][day]) next.renewals[r.key][day] = { open: r.gate?.open?.length ?? 0 };
    }
    next.history.push({ at, doc: r.key, action: r.action, id: next.docs[r.key].id || previous.id || '', open: previous.open ?? 0, refused: (r.refused || []).length });
  }
  next.updatedAt = at;
  next.history = next.history.slice(-60);
  return next;
}

/** Find a doc to adopt when the registry has no id: same title, in the folder. */
export function adoptFromListing(files, specs = DOC_SPECS) {
  const found = {};
  for (const file of files || []) {
    if (file.mimeType !== 'application/vnd.google-apps.document') continue;
    const name = String(file.name || '').replace(/\s+—.*$/, '').trim();
    const spec = specs.find((s) => name === s.title);
    if (spec) found[spec.key] = file.id;
  }
  return found;
}

/**
 * Drive: read a Google Doc's text back.
 *
 * Not `alt=media`: for a Docs editors file Google answers 403 "Only files with
 * binary content can be downloaded. Use Export with Docs Editors files." — the
 * live run found that, and it is why the read-back goes through the export
 * endpoint the Brief-folder ingest already uses for docs. The read-back is the
 * only proof that a publish landed, so it has to be a path that works.
 */
export async function exportDocText(docId, token, { fetchImpl = fetch } = {}) {
  const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(docId)}/export?mimeType=${encodeURIComponent('text/plain')}`;
  const res = await fetchImpl(url, { headers: { Authorization: `Bearer ${token}`, 'User-Agent': USER_AGENT } });
  if (!res.ok) return { ok: false, status: res.status, error: `HTTP ${res.status}` };
  return { ok: true, bytes: Buffer.from(await res.text()) };
}

/** Re-read what is actually in the document — the only proof that a publish landed. */
export async function readDocText(docId, { token, store }) {
  const res = await store.read(docId, token);
  if (!res.ok) return { ok: false, error: res.error || 'read failed' };
  return { ok: true, text: Buffer.isBuffer(res.bytes) ? res.bytes.toString('utf8') : String(res.bytes || '') };
}

/** The default store: the proven fleet paths, nothing new. */
export function googleDocsStore() {
  return { create: createDocWithContent, replace: replaceDocContent, read: exportDocText, stat: getFile, list: listChildren };
}
