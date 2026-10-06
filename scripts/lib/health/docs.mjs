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
 *     **The staleness rule is the same rule, on the clock.** A verify artifact
 *     older than the renewal window (`STALE_AFTER_DAYS`, the monthly cadence the
 *     charter names) is a snapshot of a person who has moved on a month or more;
 *     analysis rendered on it reads as current when it is not. So the analysis
 *     sections are withheld with a refusal that names the age, the header says
 *     STALE, and the data sections — dated facts with provenance — still publish
 *     as a draft. Not one derived claim leaves a stale snapshot.
 *
 *     **And so is the reviewer's veto.** While `result/health-doctor.json`
 *     carries a `STRIKE`, the claim it names was found not to hold — publishing
 *     it is publishing something known wrong. Every analysis section is withheld
 *     with the struck claims named, and the data sections still publish as a
 *     draft, exactly as they do while the gate is open.
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
 *  4. **An unverified link is not a link.** Document 4 is the cited digest, and
 *     its sections are checked against the research lane's fetch log before they
 *     render: every line carries a citation, every link was fetched and hashed,
 *     and every citation line carries a year. A section that fails is withheld
 *     with the offending links named — never published with a citation nobody
 *     opened.
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
import { CITATION_SOURCES, citationRefusalText, validateInsightCitations } from './research.mjs';

export const DOCS_FILE = 'health-docs.json';
export const REFRESH_FILE = 'health-refresh.json';
export const REFRESH_LOG = 'health-refresh.md';

/**
 * The Doctor's receipt, `result/health-doctor.json`, written by `/health doctor`.
 *
 * It lives in the publisher's module because it is now a publisher input: its
 * verdicts decide whether the analysis may publish, and both the refresh path
 * and `/health readiness` read it through `doctorReview` below. One reader, one
 * meaning of a strike.
 */
export const DOCTOR_ARTIFACT = 'health-doctor.json';

/**
 * The renewal window the charter names, plus a day of slack.
 *
 * It is the publisher's number: an artifact older than this may not carry
 * analysis into a document. `readiness.mjs` re-exports it so the self-check and
 * the publisher cannot disagree about what "stale" means.
 */
export const STALE_AFTER_DAYS = 31;

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
  'Latest on the sheet': 'data.latest',
  'What is trusted': 'data.trusted',
  'What is a placeholder, not data': 'data.placeholders',
  'What the fix list still says': 'data.fixlist',
  'What disagrees': 'data.conflicts',
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

/** The keys the analysis pass owns: every `analysis.*` source, and nothing else. */
export const ANALYSIS_SECTIONS = Object.values(SECTION_SOURCES).filter(isAnalysisSource);

/**
 * The analysis payload's shape, enforced before a single line is published.
 *
 * The payload is written by the analyst seat and read by the publisher, and it
 * arrives holding *health claims*. Left unchecked it does not fail loudly — it
 * fails quietly into the document: a section value that is an object stringifies
 * to `[object Object]`, a number becomes a bare `42` reading as a measurement,
 * and a nested array is spliced in raw. All three are health claims the reader
 * cannot tell from a real one, which is the one thing this system exists to
 * prevent.
 *
 * So the check is closed, not permissive:
 *   - `sections` must be a plain object (an array or a string is not a map);
 *   - every key must be a real `analysis.*` source — an unknown key is nearly
 *     always a typo (`analysis.condition`), and ignoring it would render that
 *     section as "awaiting the analysis pass", quietly withholding a section
 *     the analyst believes they wrote;
 *   - every value must be an array of strings. An empty array is legitimate and
 *     renders as the awaiting placeholder; anything else is a malformed claim.
 *
 * Claim *wording* is not judged here. Striking a diagnosis or a dose is the
 * safety reviewer's seat, and a blocklist that guessed would block honest prose
 * ("what is not settled by the literature") as surely as it blocked "you have".
 */
export function validateAnalysisSections(sections) {
  if (sections === undefined || sections === null) return { ok: true, sections: {} };
  if (typeof sections !== 'object' || Array.isArray(sections)) {
    return { ok: false, error: `"sections" must be an object of analysis keys, got ${Array.isArray(sections) ? 'an array' : typeof sections}` };
  }
  const out = {};
  for (const [key, value] of Object.entries(sections)) {
    if (!ANALYSIS_SECTIONS.includes(key)) {
      return { ok: false, error: `unknown analysis key "${key}" — expected one of ${ANALYSIS_SECTIONS.join(', ')}` };
    }
    if (!Array.isArray(value)) {
      return { ok: false, error: `analysis key "${key}" must be an array of lines, got ${value === null ? 'null' : typeof value}` };
    }
    for (let i = 0; i < value.length; i += 1) {
      if (typeof value[i] !== 'string') {
        return { ok: false, error: `analysis key "${key}" line ${i + 1} must be a string, got ${value[i] === null ? 'null' : typeof value[i]}` };
      }
    }
    out[key] = value;
  }
  return { ok: true, sections: out };
}

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
 * The data gate and the clock, as the documents must speak about both.
 *
 * `allowed` is true only when nothing is open: waived items are the user saying
 * "I know, publish anyway", and they stay visible in the header. `stale` is the
 * publisher's staleness rule — the artifact is older than the renewal window —
 * and `analysisAllowed` is the one question `renderSection` and `planPublish`
 * actually ask, so "may analysis publish?" has a single answer.
 *
 * An artifact with no readable date is treated as stale when a clock is supplied
 * (an undated snapshot cannot be shown to be current); a caller that passes no
 * `now` keeps the old behaviour, because context and readiness compute the age
 * themselves.
 */
export function gateFromArtifact(artifact, { now = null, staleAfterDays = STALE_AFTER_DAYS } = {}) {
  const items = artifact?.fixList?.items || [];
  const open = items.filter((i) => i.state === 'open').map((i) => i.id);
  const waived = items.filter((i) => i.state === 'waived').map((i) => i.id);
  const closed = items.filter((i) => i.state === 'closed').map((i) => i.id);
  const allowed = open.length === 0;
  const asOf = artifact?.at || '';
  let ageDays = null;
  let stale = false;
  if (now) {
    const at = Date.parse(asOf);
    ageDays = Number.isFinite(at) ? Math.floor(((now instanceof Date ? now : new Date(now)).getTime() - at) / 86400000) : null;
    stale = ageDays === null || ageDays > staleAfterDays;
  }
  return {
    allowed,
    open,
    waived,
    closed,
    total: items.length,
    asOf,
    ageDays,
    stale,
    staleAfterDays,
    analysisAllowed: allowed && !stale,
  };
}

/**
 * The Doctor's receipt, read the way the publisher must read it.
 *
 * A `STRIKE` is a claim the reviewer could not let stand, and the publisher does
 * not weigh it: one is enough to withhold every analysis section and name the
 * claims, the same way an open gate or a stale snapshot withholds them. Three
 * states, and they are three different answers:
 *
 *   - **no receipt** — the review has not run. That is a boundary, not a strike:
 *     nothing changes from before this gate existed, and the packet says so.
 *   - **a receipt that reads** — any strike blocks; zero strikes does not. An
 *     `UNPROVEN` verdict is the honest answer for a claim resting on a missing
 *     receipt, not a veto, so it does not block publishing on its own.
 *   - **a receipt that cannot be read** — fail closed, because a review that
 *     cannot be shown to be clean is not a clean review; the refusal names the
 *     parse failure instead of pretending the receipt is absent.
 */
export function doctorReview(report) {
  const unreadable = (why) => ({ read: false, at: '', strikes: [], counts: null, blocked: true, unreadable: why });
  if (report === undefined || report === null) return { read: false, at: '', strikes: [], counts: null, blocked: false, unreadable: '' };
  if (typeof report !== 'object' || Array.isArray(report)) return unreadable('the receipt is not an object');
  if (typeof report.unreadable === 'string' && report.unreadable) return unreadable(report.unreadable);
  if (!Array.isArray(report.claims)) return unreadable('the receipt carries no claims list');
  const claims = report.claims.filter((c) => c && typeof c === 'object');
  const status = (c) => String(c.status || '').toUpperCase();
  const strikes = claims.filter((c) => status(c) === 'STRIKE')
    .map((c) => ({ index: c.index, title: String(c.title || ''), claim: String(c.claim || ''), item: String(c.item || '') }));
  return {
    read: true,
    at: String(report.at || ''),
    strikes,
    counts: {
      reviewed: claims.length,
      pass: claims.filter((c) => status(c) === 'PASS').length,
      strike: strikes.length,
      unproven: claims.filter((c) => status(c) === 'UNPROVEN').length,
    },
    blocked: strikes.length > 0,
    unreadable: '',
  };
}

/** The names a refusal and a banner use for the struck claims. */
function strikeNames(review) {
  return review.strikes.map((s) => `claim ${s.index}${s.title ? ` (${s.title})` : ''}`).join(', ');
}

/**
 * The gate plus the reviewer's veto, as one object.
 *
 * `analysisAllowed` stays the single answer to "may analysis publish?", now with
 * the Doctor's strike in it, so the header, the sections and the plan's mode
 * cannot disagree about the same payload.
 */
function withDoctor(gate, doctor) {
  const review = doctorReview(doctor);
  return { ...gate, doctor: review, analysisAllowed: gate.analysisAllowed && !review.blocked };
}

/** The sentence an analysis section carries while the Doctor's receipt blocks. */
export function doctorRefusalText(review) {
  if (review.unreadable) {
    return `_Not published — the Doctor's receipt cannot be read (${review.unreadable}), so no review can be shown to stand behind these claims. Run \`/health doctor\`, then \`/health refresh\`._`;
  }
  return `_Not published while the Doctor's report carries ${review.strikes.length} STRIKE(s): ${strikeNames(review)}. A struck claim is one the review could not let stand — the analyst rewrites it (\`/health analyze\`), the Doctor re-checks (\`/health doctor\`), and only then does \`/health refresh\` publish._`;
}

/** The header every document carries: banner first, then provenance. */
export function renderHeader({ spec, artifact, gate, now, action }) {
  const L = [];
  const date = (now || new Date()).toISOString().slice(0, 10);
  L.push(`# ${spec.title} — ${date}`);
  L.push('');
  if (gate.stale) {
    L.push(`⚠ **STALE SNAPSHOT — the verify artifact is ${gate.ageDays === null ? 'undated' : `${gate.ageDays} day(s) old`} (renewal window ${gate.staleAfterDays}).**`);
    L.push('The sections below are dated facts from that snapshot; the analysis sections are withheld until `/health verify` runs again, because a claim about now cannot rest on a month-old snapshot.');
  } else if (!gate.allowed) {
    L.push(`⚠ **DRAFT — the data gate is OPEN (${gate.open.length} item${gate.open.length === 1 ? '' : 's'}: ${gate.open.join(', ')}).**`);
    L.push('Nothing below is a current analysis. The analysis sections say so in place — the refusal is deliberate, not missing.');
  } else if (gate.doctor?.blocked) {
    if (gate.doctor.unreadable) {
      L.push("⚠ **DRAFT — the Doctor's receipt does not read, so no review can be shown to stand behind the analysis.**");
      L.push(`The analysis sections are withheld in place until \`/health doctor\` writes a receipt the publisher can read (${gate.doctor.unreadable}).`);
    } else {
      L.push(`⚠ **DRAFT — the Doctor's report carries ${gate.doctor.strikes.length} STRIKE(s): ${strikeNames(gate.doctor)}.**`);
      L.push('The analysis sections are withheld in place: a struck claim is rewritten by the analyst (`/health analyze`), re-checked by the Doctor (`/health doctor`), and only then published.');
    }
  } else {
    L.push(`✅ **Data gate closed** — every fix-list item is closed or waived${gate.waived.length ? ` (waived: ${gate.waived.join(', ')})` : ''}. Analysis current as of ${shortStamp(artifact?.at) || date}.`);
  }
  L.push('');
  L.push('| Provenance | |');
  L.push('|---|---|');
  L.push(`| Sheet snapshot | \`${path.basename(artifact?.sheet?.file || '') || 'n/a'}\` (banked ${shortStamp(artifact?.sheet?.fetchedAt) || 'n/a'}) |`);
  L.push(`| Sheet | ${artifact?.sheet?.title || 'n/a'} · tab ${artifact?.sheet?.tab || 'n/a'} · ${artifact?.sheet?.rows ?? 0} rows across ${artifact?.sheet?.dates?.length ?? 0} dates, newest ${artifact?.sheet?.newestDate || 'n/a'} |`);
  L.push(`| Profile | \`${artifact?.profile?.uid || 'n/a'}\` · ${artifact?.profile?.rows ?? 0} lab rows in the app copy |`);
  L.push(`| App copy read | newest row ${artifact?.app?.newestDate || 'n/a'} |`);
  L.push(`| Fix list | ${gate.closed.length} closed · ${gate.open.length} open · ${gate.waived.length} waived of ${gate.total}${gate.open.length || gate.waived.length ? ` (${[...gate.open, ...gate.waived].join(', ')})` : ''} |`);
  if (gate.doctor?.read) {
    L.push(`| Doctor's review | ${gate.doctor.counts.reviewed} claim(s): ${gate.doctor.counts.pass} PASS · ${gate.doctor.counts.strike} STRIKE · ${gate.doctor.counts.unproven} UNPROVEN${gate.doctor.at ? ` (reviewed ${shortStamp(gate.doctor.at)})` : ''} |`);
  }
  L.push(`| Generated | ${date} by \`/health refresh\`${action ? ` (${action})` : ''} |`);
  L.push('');
  return L;
}

/* ------------------------------------------------------------------ data sections */

function factLine(row) {
  return `- ${row.label} ${row.value}${row.unit ? ` ${row.unit}` : ''} — ${row.date}`;
}

function renderLatest(artifact) {
  if (!artifact || !Object.prototype.hasOwnProperty.call(artifact, 'latest')) {
    return ['_No latest-sheet list in this snapshot. Run `/health verify`, then `/health refresh`._'];
  }
  const rows = artifact.latest || [];
  if (!rows.length) return ['_The sheet snapshot has no valued rows._'];
  const L = rows.slice(0, 60).map(factLine);
  if (rows.length > 60) L.push(`- … and ${rows.length - 60} more markers.`);
  return L;
}

function renderTrusted(artifact) {
  const rows = artifact?.matches || [];
  if (!rows.length) return ['_No marker in the app copy matches this sheet snapshot exactly._'];
  const L = rows.slice(0, 40).map(factLine);
  if (rows.length > 40) L.push(`- … and ${rows.length - 40} more exact matches.`);
  return L;
}

function renderFixList(artifact) {
  const items = artifact?.fixList?.items || [];
  if (!items.length) return ['_No fix list in this snapshot. Run `/health verify`._'];
  const pending = items.filter((item) => item.state !== 'closed');
  if (!pending.length) return ['_Every fix-list item is closed._'];
  return pending.map((item) => `- **${item.id}** (${item.state}) — ${item.title}. ${item.detail || ''}`.trim());
}

function renderConflicts(artifact) {
  if (!artifact || !Object.prototype.hasOwnProperty.call(artifact, 'conflicts')) {
    return ['_This snapshot has no disagreement list. Run `/health verify`, then `/health refresh`._'];
  }
  const rows = artifact.conflicts || [];
  if (!rows.length) return ['_No sheet value disagrees with the app on the value or the date._'];
  const L = rows.slice(0, 40).map((row) => {
    if (row.kind === 'date') {
      return `- ${row.label} ${row.value}${row.unit ? ` ${row.unit}` : ''} is on the sheet at ${row.date}; the app has ${JSON.stringify(row.appValue)} on ${row.appDate}`;
    }
    return `- ${row.label} on ${row.date}: app ${JSON.stringify(row.appValue)} vs sheet ${JSON.stringify(row.value)}`;
  });
  if (rows.length > 40) L.push(`- … and ${rows.length - 40} more disagreements.`);
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

/** The sentence an analysis section carries when the snapshot is past the renewal window. */
export function staleRefusalText(gate) {
  return `_Not published on a stale snapshot: the verify artifact is ${gate.ageDays === null ? 'undated' : `${gate.ageDays} day(s) old`} and the renewal window is ${gate.staleAfterDays}. A claim about now cannot rest on a month-old snapshot — run \`/health verify\`, then \`/health refresh\`._`;
}

/**
 * One section's body.
 *
 * `analysis` is the analysis pass's payload, keyed by source (`analysis.conditions`
 * etc.). Passing it while the gate is open, on a stale snapshot, or while the
 * Doctor's receipt carries a strike, is a refusal, not a silent drop: the section
 * comes back marked `refused` so `/health refresh` can say how many were held
 * back, and the document carries the reason.
 *
 * Document 4's sections are additionally checked against the research lane's
 * fetch log (`citations`) — that is the citation contract, and it is applied to
 * the rendered lines rather than to the payload, so it cannot be skipped by
 * handing the publisher a payload of another shape.
 */
export function renderSection({ heading, source, artifact, gate, analysis = {}, registry, spec, now, citations = null }) {
  if (isAnalysisSource(source)) {
    if (!gate.allowed) return { heading, refused: true, body: [refusalText(gate)] };
    if (gate.stale) return { heading, refused: true, body: [staleRefusalText(gate)] };
    if (gate.doctor?.blocked) return { heading, refused: true, body: [doctorRefusalText(gate.doctor)] };
    const text = analysis?.[source];
    // Defence in depth: `loadAnalysisFile` already refuses a malformed payload,
    // but a caller that renders straight from an unvalidated object must not be
    // able to publish `[object Object]` either. Refuse, never coerce.
    let body;
    if (Array.isArray(text)) body = text;
    else if (typeof text === 'string') body = text.split('\n').filter((l) => l.trim() !== '');
    else if (text === undefined || text === null) body = [];
    else return { heading, refused: true, body: [`_Malformed analysis payload for this section (${typeof text}) — nothing was published._`] };
    if (body.length && spec?.key === 'insights' && CITATION_SOURCES.includes(source)) {
      const verdict = validateInsightCitations(body, { log: citations });
      if (!verdict.ok) return { heading, refused: true, body: [citationRefusalText(verdict)], citationRefused: verdict.reason };
    }
    return {
      heading,
      refused: false,
      body: body.length ? body : ['_Awaiting the analysis pass — run `/health analyze` when the gate is closed._'],
    };
  }
  if (source === 'data.latest') return { heading, refused: false, body: renderLatest(artifact) };
  if (source === 'data.trusted') return { heading, refused: false, body: renderTrusted(artifact) };
  if (source === 'data.placeholders') return { heading, refused: false, body: renderPlaceholders(artifact) };
  if (source === 'data.fixlist') return { heading, refused: false, body: renderFixList(artifact) };
  if (source === 'data.conflicts') return { heading, refused: false, body: renderConflicts(artifact) };
  if (source === 'data.missing') return { heading, refused: false, body: renderMissing(artifact) };
  if (source === 'data.limits') return { heading, refused: false, body: renderLimits(artifact) };
  if (source === 'renewal_log') return { heading, refused: false, body: renderRenewalLog({ registry, spec, now, gate }) };
  return { heading, refused: false, body: ['_No renderer for this section._'] };
}

/** One document's whole body: header, then every template section in order. */
export function renderDoc({ spec, templateText, artifact, analysis, registry, now, action = '', citations = null, doctor = null }) {
  const gate = withDoctor(gateFromArtifact(artifact, { now }), doctor);
  const unknown = unknownSections(templateText);
  if (unknown.length) return { ok: false, error: `template ${spec.template} has sections with no source: ${unknown.join(', ')}` };
  // A template with no sections at all would publish a header-only document:
  // that is the silent-drop failure this module exists to refuse.
  if (sectionPlan(templateText).length === 0) return { ok: false, error: `template ${spec.template} declares no sections` };
  const L = renderHeader({ spec, artifact, gate, now, action });
  const sections = [];
  for (const section of sectionPlan(templateText)) {
    const rendered = renderSection({ ...section, artifact, gate, analysis, registry, spec, now, citations });
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
    citationRefused: sections.filter((s) => s.citationRefused).map((s) => ({ heading: s.heading, reason: s.citationRefused })),
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
export function planPublish({ artifact, analysis, templates, registry, now = new Date(), only = [], force = false, citations = null, doctor = null }) {
  const gate = withDoctor(gateFromArtifact(artifact, { now }), doctor);
  const wanted = only.length ? DOC_SPECS.filter((s) => only.includes(s.key) || only.includes(s.title)) : DOC_SPECS;
  const items = [];
  for (const spec of wanted) {
    const rendered = renderDoc({ spec, templateText: templates[spec.key] || '', artifact, analysis, registry, now, citations, doctor });
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
      citationRefused: rendered.citationRefused || [],
      gate,
    });
  }
  return { items, gate, mode: gate.analysisAllowed ? 'analysis' : 'draft' };
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
