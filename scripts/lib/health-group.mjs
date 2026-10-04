/**
 * Health council turns inside a Telegram group.
 *
 * Two ways in, neither of them a slash command:
 *   @test planner <question>  — only the bot that owns that seat answers.
 *   <question to the room>    — the coordinator posts one joint answer.
 *                               The other bots stay quiet.
 *
 * Any real question is answered. The seats work it out together inside that
 * one reply. A room question is one shared answer. A named seat answers from
 * its own chair with what the council would agree. Acknowledgements stay quiet.
 *
 * A brief ask — "work on the brief", "update the documents" — is neither: it
 * runs the publisher and the room gets the refresh reply. A question that just
 * mentions the brief is a normal answer, and the brief's own state (last
 * refresh, the four documents, what is withheld) rides along as facts.
 *
 * A link ask — "give me the link", "where are the documents" — is neither of
 * those either, and it is not a model turn at all. The four document ids live
 * in the workspace's own registry, so a URL is a lookup, not a claim: asking
 * for one costs no model call, cannot time out, and is answered the same way
 * whether the data gate is open or closed. The live room answered two link
 * asks with two 120s model calls — the first describing the documents without
 * posting a single URL, the second falling back to "the model call failed"
 * (journal: `health group council fell back: model failed: timed out after
 * 120000ms`). A registry with no id is named as missing, never guessed.
 *
 * The data gate still bounds the answer. While it is open the model may talk
 * about the open repairs and must not name a disease, a drug, or a number
 * the repairs do not already contain. A lab test may be named only when the
 * repairs already name it (e.g. quoting H-7's HbA1c line). A reply that breaks
 * that rule goes back to the model once with the checker's own reason and is
 * rewritten; only a second refusal — or a call that fails — falls back to one
 * short line naming the reason, so the room never gets a canned paragraph.
 * Nothing here edits the app.
 */
import fs from 'node:fs';
import path from 'node:path';

import { DOC_SPECS, DOCS_FILE, REFRESH_FILE, gateFromArtifact, loadDocsRegistry } from './health/docs.mjs';
import { digestVerify } from './health/context.mjs';

export const HEALTH_SEAT_ORDER = [
  { id: 'data_steward', name: 'Data Steward' },
  { id: 'health_analyst', name: 'Health Analyst' },
  { id: 'test_planner', name: 'Test Planner' },
  { id: 'research_lead', name: 'Research Lead' },
  { id: 'safety_reviewer', name: 'Safety Reviewer' },
  { id: 'doctor', name: 'Doctor' },
];

export const HEALTH_SEAT_IDS = HEALTH_SEAT_ORDER.map((s) => s.id);

const VERIFY_NAME = 'health-verify.json';
const DETAIL_CAP = 180;
const REPLY_CAP = 3900;

const SOCIAL = /^(thanks|thank you|thx|ty|ok|okay|k|kk|hi|hello|hey|yo|yes|yeah|yep|no|nope|cool|nice|great|cheers|good morning|good night|good evening|gm|gn|lol|lmao|haha|hahaha|👋|👍|🙏)[.!\s]*$/i;

const CONDITIONS = /\b(diabetes|pre-?diabetes|hypertension|high blood pressure|cardiovascular|heart disease|cancer|hypothyroidism|hyperthyroidism|anemia|anaemia|obesity|obese|metabolic syndrome|insulin resistance|kidney disease|liver disease)\b/i;
const DRUGS = /\b(metformin|statin|aspirin|ibuprofen|levothyroxine|ozempic|semaglutide|insulin)\b/i;
const TEST_NAMES = /\b(hs-crp|hscrp|crp|vitamin d|vitamin b12|vitamin b|hba1c|a1c|ldl|hdl|triglycerides|triglyceride|cholesterol|tsh|ferritin|haemoglobin|hemoglobin|glucose|homa)\b/i;

export function healthRoleOf(bot) {
  return String(bot?.agent?.healthRole || bot?.healthRole || '').trim();
}

/** Health seats owned by an enabled bot. The coordinator adopts any seat not in this list. */
export function dedicatedHealthRoleIds(bots) {
  const ids = [];
  for (const bot of bots || []) {
    if (bot?.enabled === false) continue;
    const role = healthRoleOf(bot);
    if (HEALTH_SEAT_IDS.includes(role) && !ids.includes(role)) ids.push(role);
  }
  return ids;
}

export function readHealthVerify(workspace) {
  const file = path.join(String(workspace || ''), 'result', VERIFY_NAME);
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function plainQuestion(question) {
  return String(question || '')
    .replace(/(^|\s)@[A-Za-z0-9_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * A bare group message is a council ask when it is a real question.
 * Acknowledgements stay quiet. A short question with no keyword still counts:
 * the room is the health group, and the seats answer whatever was asked.
 */
export function isHealthAsk(text) {
  const t = plainQuestion(text);
  if (!t || SOCIAL.test(t)) return false;
  if (t.length < 2 || !/[\p{L}\p{N}]/u.test(t)) return false;
  return true;
}

/**
 * An explicit ask to work the brief itself — "work on the brief", "update the
 * documents", "refresh the docs". A brief ask is not a question for the seats:
 * it runs the publisher, so it gets its own turn kind. A question that merely
 * mentions the documents ("what do the documents say") stays a council ask.
 */
const BRIEF_ASK = /\b(?:work on|update|refresh|renew|redo|bring)\b(?!\s+me\b)[\s\w-]{0,24}?\b(?:brief|documents|docs|document)\b/i;

export function isBriefAsk(text) {
  return BRIEF_ASK.test(plainQuestion(text));
}

/**
 * An ask for a document's URL — "give me the link", "give the link here",
 * "send me the link to the test plan", "what's the docs url", "where are the
 * documents".
 *
 * Three shapes, and the two exclusions matter more than the shapes. A link noun
 * plus a give/show verb is the ordinary case. A document noun plus a locating
 * verb catches "where are the documents", which never says "link". What is *not*
 * a link ask is the relational question — "what is the link between my sheet and
 * the app", "is there a link between vitamin D and fatigue" — which names a
 * link and asks about a relationship. That is a council ask and the seats
 * answer it, so the relational reading is checked first and wins over both.
 */
const LINK_NOUN = /\b(?:link|url|href)\b/i;
const LINK_VERB = /\b(?:give|send|share|show|open|get|have|paste|post|drop|forward|resend|need|want|please|where|whats|what)\b/i;
const DOC_NOUN = /\b(?:document|documents|doc|docs)\b/i;
const LOCATE_VERB = /\b(?:where|find|locate)\b/i;
const RELATIONAL = /\b(?:link|links|relationship|relationships|connection|connections|correlation)\s+(?:between|of)\b/i;

export function isLinkAsk(text) {
  const t = plainQuestion(text);
  if (RELATIONAL.test(t)) return false;
  if (LINK_NOUN.test(t) && LINK_VERB.test(t)) return true;
  return DOC_NOUN.test(t) && LOCATE_VERB.test(t);
}

/**
 * What this group message should do, after addressing has already picked a bot.
 * `null` means the normal turn. `skip` means this bot was addressed and the
 * text is not a question.
 */
export function classifyHealthGroupTurn({ kind, addr, text, projectId, taxChat } = {}) {
  if (kind !== 'group' || !addr?.addressed) return null;
  const question = String(text || '').trim();
  const seat = HEALTH_SEAT_IDS.includes(addr.roleId) ? addr.roleId : null;
  if (seat && !addr.isBroadcast) {
    if (!isHealthAsk(question)) return { mode: 'skip' };
    return { mode: 'seat', roleId: seat, question };
  }
  // A supergroup bound to the tax books is not the health room. A named
  // health seat above still answers if someone mentions it.
  if (taxChat && addr.isBroadcast) return null;
  const healthChat = !projectId || projectId === 'health-tracker' || projectId === 'external-health';
  if (addr.isBroadcast && healthChat && projectId !== 'chiwah-tax') {
    if (!isHealthAsk(question)) return { mode: 'skip' };
    // A link ask is answered from the registry, so it is checked before the
    // brief ask: "give me the link to the brief" wants a URL, and must never
    // be read as a request to re-publish the four documents.
    if (isLinkAsk(question)) return { mode: 'link', roleId: null, question };
    if (isBriefAsk(question)) return { mode: 'brief', roleId: null, question };
    return { mode: 'council', roleId: null, question };
  }
  return null;
}

function clip(text, max) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

function openItems(artifact) {
  const items = Array.isArray(artifact?.fixList?.items) ? artifact.fixList.items : [];
  return items.filter((item) => item?.state === 'open');
}

function itemLine(item) {
  const detail = clip(item?.detail || '', DETAIL_CAP);
  return detail ? `${item.id} ${item.title}: ${detail}` : `${item.id} ${item.title}`;
}

function seatName(roleId) {
  return HEALTH_SEAT_ORDER.find((seat) => seat.id === roleId)?.name || 'the health council';
}

/**
 * How a refusal reads. The retry tells the model which value or rule to drop;
 * the fallback tells the room why no answer came. A refused number is never
 * repeated in the fallback text — only in the reason the caller logs.
 */
function refusalNote(reason) {
  const r = String(reason || '');
  const number = /^number\s+(\S+)$/.exec(r);
  if (number) return `the number ${number[1]} is not in the record or the question`;
  const notes = {
    empty: 'it was empty',
    noise: 'it carried tool or thinking noise',
    uid: 'it repeated a profile uid',
    dump: 'it was a seat-by-seat dump, not one answer',
    condition: 'it named a condition the record does not state',
    drug: 'it named a drug the record does not state',
    test: 'it named a lab test the repairs do not state',
    advice: 'it advised a test or a prescription',
    unsupported: 'it named something the record does not state',
  };
  return notes[r] || `it broke the record rule (${r})`;
}

function refusalPhrase(reason) {
  const r = String(reason || '');
  if (/^model failed:/.test(r)) return 'the model call failed';
  if (/^number\s+\S+$/.test(r)) return 'a draft used a number the record does not state';
  const phrases = {
    empty: 'a draft was empty',
    noise: 'a draft carried tool or thinking noise',
    uid: 'a draft repeated a profile uid',
    dump: 'a draft was a seat dump, not one answer',
    condition: 'a draft named a condition the record does not state',
    drug: 'a draft named a drug the record does not state',
    test: 'a draft named a lab test the repairs do not state',
    advice: 'a draft advised a test or a prescription',
    unsupported: 'a draft named something the record does not state',
    'no council model': 'no council model is wired to answer',
  };
  return phrases[r] || 'the record check refused the draft';
}

/** The one short line the room gets when no answer survived the record check. */
function fallbackLine(reason) {
  return `I couldn't put that answer together just now — ${refusalPhrase(reason)}. Nothing was invented in its place.`;
}

function missingText() {
  return "I can't see a verify artifact in the health workspace, so I won't guess at a gap, a risk, or a test. Run /health verify in this chat — then /health refresh publishes the documents as drafts, and the analysis sections open when the fix list closes.";
}

/**
 * The fallback with no model, or after both drafts are refused. It names the
 * reason in one short line: an open gate is not a status paragraph, and a
 * refused draft is not an answer.
 */
export function formatHealthGroupReply({ artifact, reason = 'no council model' } = {}) {
  if (!artifact) return missingText();
  const gate = gateFromArtifact(artifact);
  if (!gate.total) {
    return "The verify artifact has no fix-list items, so nothing proves the gate is closed. I won't guess at a gap or a test. Run /health verify again — /health refresh publishes the documents as drafts, and the analysis sections open when the fix list closes.";
  }
  return fallbackLine(reason);
}

function closedContext(artifact) {
  return digestVerify(artifact).replace(/uid [^\n·]+ · /g, '');
}

function openContext(artifact) {
  const gate = gateFromArtifact(artifact);
  const items = openItems(artifact);
  return [
    `Data gate: OPEN (${gate.open.length}: ${gate.open.join(', ')}).`,
    'Open repairs. These are the only facts you may use:',
    items.map((item) => `- ${itemLine(item)}`).join('\n') || '- (none)',
  ].join('\n');
}

/**
 * The brief's own state, as facts for the model context: when the documents
 * were last refreshed, what the four documents are, and which sections the
 * publisher is holding back. Facts only — the seats still do the talking — so
 * questions ABOUT the brief can be answered without guessing.
 */
export function readBriefState(workspace) {
  const result = path.join(String(workspace || ''), 'result');
  const state = { refresh: null, registry: null };
  try {
    state.refresh = JSON.parse(fs.readFileSync(path.join(result, REFRESH_FILE), 'utf8'));
  } catch { state.refresh = null; }
  try {
    state.registry = loadDocsRegistry(path.join(result, DOCS_FILE));
  } catch { state.registry = null; }
  return state;
}

function briefContext(brief) {
  if (!brief) return '';
  const r = brief.refresh;
  const registry = brief.registry || {};
  const lines = ['Brief state. Facts from the workspace — quote them, do not rewrite them:'];
  if (r) {
    lines.push(`- last refresh: ${r.at || 'unknown'} (${r.mode || 'unknown'} mode) — created ${r.counts?.created ?? '?'} · updated ${r.counts?.updated ?? '?'} · skipped ${r.counts?.skipped ?? '?'} · failed ${r.counts?.failed ?? '?'}`);
  } else {
    lines.push('- last refresh: none recorded in this workspace');
  }
  lines.push(`- documents: ${DOC_SPECS.map((spec) => {
    const doc = registry.docs?.[spec.key];
    if (!doc) return `${spec.title} — no write recorded`;
    return `${spec.title} — written ${doc.at || 'unknown'}${Number.isFinite(doc.open) ? `, ${doc.open} open at the write` : ''}`;
  }).join('; ')}`);
  if (r) {
    const refused = Array.isArray(r.refused) ? r.refused : [];
    lines.push(refused.length ? `- analysis withheld: ${refused.join('; ')}` : '- analysis withheld: none');
    const why = [];
    if (r.gate && r.gate.allowed === false) why.push(`the data gate is open (${(r.gate.open || []).join(', ') || 'open items'})`);
    if (r.gate?.stale) why.push('the verify snapshot is past its renewal window');
    if (r.gate?.doctor?.blocked) why.push("the Doctor's report blocks the analysis");
    if (r.gate?.doctor?.unreadable) why.push("the Doctor's receipt does not read");
    if (r.citationRefusals?.length) why.push(`${r.citationRefusals.length} citation(s) were refused in document 4`);
    if (why.length) lines.push(`- why: ${why.join('; ')}`);
  } else {
    lines.push('- analysis withheld: nothing has been published from this workspace yet');
  }
  return lines.join('\n');
}

/* ------------------------------------------------------------------ the links */

/** The Drive URL for one published document id. */
function docUrl(id) {
  return `https://docs.google.com/document/d/${encodeURIComponent(id)}/edit`;
}

/** The document this ask names, if it names one ("the link to the test plan"). */
function askedDoc(question) {
  const t = plainQuestion(question).toLowerCase();
  return DOC_SPECS.find((spec) => t.includes(spec.title.toLowerCase())) || null;
}

function writtenDay(doc) {
  const at = String(doc?.at || doc?.modifiedTime || '');
  return /^\d{4}-\d{2}-\d{2}/.test(at) ? at.slice(0, 10) : 'an unknown date';
}

/**
 * What is still held back, as one honest line — or nothing at all.
 *
 * Everything here is read out of the refresh receipt. A missing receipt says
 * nothing: it does not mean "nothing was published", so it prints nothing
 * rather than a sentence about the documents that would itself be a claim.
 */
function withheldLine(refresh) {
  if (!refresh) return '';
  const refused = Array.isArray(refresh.refused) ? refresh.refused : [];
  const open = Number(refresh.gate?.open?.length) || 0;
  const parts = [];
  if (open) parts.push(`${open} repair item${open === 1 ? '' : 's'} still open`);
  if (refused.length) parts.push(`${refused.length} analysis section${refused.length === 1 ? '' : 's'} withheld`);
  if (!parts.length) return '';
  const label = refresh.mode === 'published' ? 'As of that write:' : 'These are drafts:';
  return `${label} ${parts.join(', ')}. /health refresh rewrites them in place.`;
}

/**
 * The document links, read from the workspace's own registry.
 *
 * A URL is a location, not a claim, so this never touches the data gate and
 * never calls a model: what it prints is exactly what the publisher recorded.
 * A document the registry has no id for is named as unwritten rather than
 * given a URL built from a title, and a workspace with no registry says so
 * instead of inventing one. No date, count or id here is computed — each is
 * copied out of the registry or the refresh receipt, or not printed at all.
 */
export function formatDocLinks({ workspace, question = '' } = {}) {
  const { registry, refresh } = readBriefState(workspace);
  const docs = registry?.docs || {};
  const written = DOC_SPECS.filter((spec) => docs[spec.key]?.id);
  if (!written.length) {
    return 'No document ids are recorded in the health workspace, so I have no link to give and will not guess one. /health refresh publishes the four documents and records their ids here.';
  }
  const folder = registry?.folderId ? `https://drive.google.com/drive/folders/${encodeURIComponent(registry.folderId)}` : '';
  const one = askedDoc(question);
  const line = (spec) => {
    const doc = docs[spec.key] || {};
    return `${spec.title} — written ${writtenDay(doc)}${Number.isFinite(doc.open) ? `, ${doc.open} repair item${doc.open === 1 ? '' : 's'} open at the write` : ''}\n${docUrl(doc.id)}`;
  };
  if (one && docs[one.key]?.id) {
    const rest = written.filter((spec) => spec.key !== one.key);
    return [
      line(one),
      // No full stop after a URL — it reads as part of the address.
      rest.length
        ? `The other ${rest.length} (${rest.map((s) => s.title).join(', ')}) ${rest.length === 1 ? 'is' : 'are'} in the same folder${folder ? `:\n${folder}` : ''}`
        : (folder ? `Whole folder:\n${folder}` : ''),
      withheldLine(refresh),
    ].filter(Boolean).join('\n\n');
  }
  const unwritten = DOC_SPECS.filter((spec) => !docs[spec.key]?.id).map((spec) => spec.title);
  return [
    written.length === DOC_SPECS.length
      ? 'The four health documents:'
      : `The ${written.length} health document${written.length === 1 ? '' : 's'} written so far:`,
    ...written.map((spec) => line(spec)),
    // An unwritten document is named, not counted: "1 not written yet" leaves
    // the room guessing which one, and the id it has no URL for is the whole
    // reason the ask could not be answered.
    unwritten.length
      ? `Not written yet: ${unwritten.join(', ')}. /health refresh publishes ${unwritten.length === 1 ? 'it' : 'them'} and records the id here.`
      : '',
    folder ? `All of them in one folder:\n${folder}` : '',
    withheldLine(refresh),
  ].filter(Boolean).join('\n\n');
}

/** One prompt. The seats collaborate in the text. One model call posts it. */
export function healthAnswerPrompt({ mode, roleId, question, artifact, refusal = '', brief = null } = {}) {
  const gate = gateFromArtifact(artifact);
  const asked = plainQuestion(question);
  const who = mode === 'council'
    ? [
      'You are the health council posting one shared answer.',
      'The seats work the question out together before you speak: Data Steward (do the rows support this), Health Analyst (what can be said), Test Planner (is any test even discussable), Research Lead (would a paper be honest), Safety Reviewer (is a claim allowed), Doctor (is there anything to check).',
      'Write one answer in a single voice. Do not name the seats, do not number them, and do not give each seat its own paragraph.',
    ]
    : [
      `You are ${seatName(roleId)}, answering in the health group.`,
      'The other seats stay quiet in the chat. Answer with what the council would agree, from your seat, in one voice.',
      'Do not write a paragraph per seat.',
    ];
  const rules = gate.allowed
    ? [
      'The data gate is closed. Answer the question from the workspace context.',
      'Do not add a lab value, a diagnosis, a drug, or a test that the context does not already state.',
      'Do not repeat a profile uid.',
    ]
    : [
      'The data gate is open. Answer the question they actually asked, using only the open repairs below.',
      'Do not name a disease, a drug, or a risk score. Name a lab test only when it is already written in the repairs below — quoting a repair is allowed, introducing a new test is not.',
      'Do not invent a number. Quote a figure only when it is already written in the repairs or the question. Do not subtract or round one.',
      'You cannot change the app or the sheet from this chat. For the repair steps, name the first open repair and point at /health triage; /health dashboard has the full list. The documents refresh as drafts now — the analysis sections open when the fix list closes.',
      'If the question cannot be answered until those repairs close, say that in a sentence that still responds to what they asked.',
      'Do not dump every open repair unless they asked for the list.',
    ];
  if (refusal) {
    rules.push(`Your previous draft was refused: ${refusalNote(refusal)} — rewrite the same answer without it, keep answering the question, and add no new claim.`);
  }
  return [
    ...who,
    'Reply in plain sentences. Two to six sentences. No title, no "You asked", and no mention of tools or thinking.',
    ...rules,
    '',
    gate.allowed ? closedContext(artifact) : openContext(artifact),
    ...(brief ? ['', briefContext(brief)] : []),
    '',
    `Question: ${asked}`,
  ].join('\n');
}

function sourceNumbers(artifact, question) {
  const gate = gateFromArtifact(artifact);
  const blob = `${JSON.stringify(artifact ?? {})}\n${question ?? ''}`;
  const allowed = new Set(['0']);
  for (const match of blob.matchAll(/\d+(?:\.\d+)?/g)) allowed.add(match[0]);
  for (const count of [gate.open.length, gate.closed.length, gate.waived.length, gate.total]) {
    allowed.add(String(count));
  }
  for (const id of [...gate.open, ...gate.closed, ...gate.waived]) {
    const match = String(id).match(/\d+/);
    if (match) allowed.add(match[0]);
  }
  return allowed;
}

function recommendsTest(text) {
  if (/\bi recommend\b/i.test(text)) return true;
  if (/\bprescribe\b/i.test(text)) return true;
  if (/\byou should (get |order |book |take )\b/i.test(text)) return true;
  if (/\bworth testing\b/i.test(text) && !/\b(not|never|n't) worth testing\b/i.test(text)) return true;
  return false;
}

/**
 * Whether a model reply may be posted.
 * An open gate refuses a disease, a drug, and any number the artifact and
 * the question do not already contain. A lab test is refused only when the
 * repairs do not already name it, so quoting H-7's HbA1c line is kept while
 * introducing a new panel is dropped. Advice to test or prescribe is always
 * refused while the gate is open.
 */
export function acceptHealthReply(text, { artifact, question } = {}) {
  const t = String(text || '').trim();
  if (t.length < 2 || !/[\p{L}\p{N}]/u.test(t)) return { ok: false, reason: 'empty' };
  if (/```|\bthinking\s*:|\btool\s*:|\bas an ai\b|\blanguage model\b/i.test(t)) {
    return { ok: false, reason: 'noise' };
  }
  if (/\bprofile uid\b|\buid\s+[a-f0-9]{8,}\b/i.test(t)) return { ok: false, reason: 'uid' };
  if (/seats, in order/i.test(t)) return { ok: false, reason: 'dump' };
  const namedSeats = HEALTH_SEAT_ORDER.filter((seat) => t.includes(seat.name)).length;
  if (namedSeats >= 4) return { ok: false, reason: 'dump' };
  const gate = gateFromArtifact(artifact);
  const inSource = (pattern) => {
    const match = t.match(pattern);
    if (!match) return false;
    const blob = `${JSON.stringify(artifact ?? {})}\n${question ?? ''}`.toLowerCase();
    return blob.includes(match[0].toLowerCase());
  };
  if (!gate.allowed) {
    if (CONDITIONS.test(t) && !inSource(CONDITIONS)) return { ok: false, reason: 'condition' };
    if (DRUGS.test(t) && !inSource(DRUGS)) return { ok: false, reason: 'drug' };
    if (TEST_NAMES.test(t) && !inSource(TEST_NAMES)) return { ok: false, reason: 'test' };
    if (recommendsTest(t)) return { ok: false, reason: 'advice' };
  } else if ((CONDITIONS.test(t) && !inSource(CONDITIONS)) || (DRUGS.test(t) && !inSource(DRUGS)) || (TEST_NAMES.test(t) && !inSource(TEST_NAMES))) {
    return { ok: false, reason: 'unsupported' };
  }
  const invented = [...t.matchAll(/\d+(?:\.\d+)?/g)].find((match) => !sourceNumbers(artifact, question).has(match[0]));
  if (invented) return { ok: false, reason: `number ${invented[0]}` };
  return { ok: true, reason: '' };
}

function clipReply(text) {
  const t = String(text || '').trim();
  if (t.length <= REPLY_CAP) return t;
  return `${t.slice(0, REPLY_CAP - 1)}…`;
}

/**
 * One group reply. `runModel({ roleId, prompt })` is one call: `council` for
 * a room question, or the seat id when that seat was named. A reply the record
 * check refuses is not dropped: it goes back to the model once, with the
 * checker's own reason, to be rewritten. Only a second refusal — or a call
 * that fails — falls back to one short line naming the reason, and
 * `fallbackReason` carries that reason (or the thrown error) so the host can
 * log it. It never throws into the website coder.
 *
 * A `link` turn returns before any of that: it reads the registry, prints the
 * recorded ids, and reports `usedModel: false` with no fallback reason. There
 * is no failure mode to fall back from, which is the point.
 */
export async function answerHealthGroup({ mode, roleId, question, workspace, artifact = undefined, runModel } = {}) {
  // A link is a registry lookup. It is answered before the artifact is read and
  // before `runModel` is looked at, so it cannot be turned into a model call by
  // a slow or dead lane — which is the whole point: the room asked twice for a
  // URL and got two 120s waits and no URL.
  if (mode === 'link') {
    return { answered: true, usedModel: false, text: clipReply(formatDocLinks({ workspace, question })), fallbackReason: '' };
  }
  const loaded = artifact !== undefined ? artifact : readHealthVerify(workspace);
  const brief = workspace ? readBriefState(workspace) : null;
  const gate = loaded ? gateFromArtifact(loaded) : null;
  const canModel = Boolean(gate?.total) && typeof runModel === 'function';
  if (mode !== 'council' && !HEALTH_SEAT_IDS.includes(roleId)) {
    return { answered: false, usedModel: false, text: `No health seat matches ${roleId || mode}.` };
  }
  if (!canModel) {
    const reason = !loaded ? 'no verify artifact' : !gate?.total ? 'no fix-list items' : 'no council model';
    return { answered: true, usedModel: false, text: clipReply(formatHealthGroupReply({ artifact: loaded, reason })), fallbackReason: reason };
  }
  const ask = async (prompt) => String(await runModel({
    roleId: mode === 'council' ? 'council' : roleId,
    prompt,
  }) || '').trim();

  let raw = '';
  try {
    raw = await ask(healthAnswerPrompt({ mode, roleId, question, artifact: loaded, brief }));
  } catch (err) {
    const reason = `model failed: ${err.message}`;
    return { answered: true, usedModel: false, text: clipReply(fallbackLine(reason)), fallbackReason: reason };
  }
  let verdict = acceptHealthReply(raw, { artifact: loaded, question });
  if (verdict.ok) return { answered: true, usedModel: true, text: clipReply(raw), fallbackReason: '' };

  // One recoverable retry: the same question and context, plus the checker's
  // own reason, so the model can rewrite instead of the room getting a canned
  // paragraph that never answers.
  try {
    raw = await ask(healthAnswerPrompt({ mode, roleId, question, artifact: loaded, refusal: verdict.reason, brief }));
  } catch (err) {
    const reason = `model failed: ${err.message}`;
    return { answered: true, usedModel: false, text: clipReply(fallbackLine(reason)), fallbackReason: reason };
  }
  verdict = acceptHealthReply(raw, { artifact: loaded, question });
  if (verdict.ok) return { answered: true, usedModel: true, text: clipReply(raw), fallbackReason: '' };
  return { answered: true, usedModel: false, text: clipReply(fallbackLine(verdict.reason)), fallbackReason: verdict.reason };
}
