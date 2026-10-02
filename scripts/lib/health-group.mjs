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
 * The data gate still bounds the answer. While it is open the model may talk
 * about the open repairs and must not name a disease, a drug, or a number
 * the repairs do not already contain. A lab test may be named only when the
 * repairs already name it (e.g. quoting H-7's HbA1c line). A reply that breaks
 * that rule, or a model that fails, falls back to a short line from the
 * verify artifact. Nothing here edits the app.
 */
import fs from 'node:fs';
import path from 'node:path';

import { gateFromArtifact } from './health/docs.mjs';
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

function gateSentence(gate) {
  return `The data gate is open (${gate.open.length}: ${gate.open.join(', ')}).`;
}

function askKind(question) {
  const t = plainQuestion(question);
  if (/\bhow\b|\bsteps\b|\bwhere do i\b|\bwhat do i\b/i.test(t)) return 'how';
  if (/\b(fix|clean|repair|correct|edit)\b/i.test(t)) return 'fix';
  if (/\b(list|every item|all items|show the items|what(?:'s| is) open)\b/i.test(t)) return 'list';
  return 'status';
}

function firstRepair(items) {
  const item = items[0];
  if (!item) return 'the first open item';
  const detail = clip(item.detail || '', DETAIL_CAP);
  return detail ? `${item.id} ${item.title}: ${detail}` : `${item.id} ${item.title}`;
}

function listText(items) {
  if (!items.length) return '- (the artifact lists no open item)';
  return items.map((item) => `- ${itemLine(item)}`).join('\n');
}

function seatName(roleId) {
  return HEALTH_SEAT_ORDER.find((seat) => seat.id === roleId)?.name || 'the health council';
}

/** Short safe line used when the model is missing, fails, or breaks the gate. */
function seatOpenText(roleId, artifact, question) {
  const gate = gateFromArtifact(artifact);
  const items = openItems(artifact);
  const kind = askKind(question);
  const first = firstRepair(items);
  const gateLine = gateSentence(gate);
  if (kind === 'list') return `${gateLine}\n\n${listText(items)}`;
  if (kind === 'fix') {
    return `No. I can't edit the app from this chat. ${gateLine} The sheet wins. Change ${first} in the app, then run /health verify.`;
  }
  if (kind === 'how') {
    return `In the app, do this first: ${first}. ${gateLine} I can't edit those rows from here. Run /health verify after it.`;
  }
  const lead = {
    data_steward: `The rows are not verified. ${gateLine} Next is ${first}.`,
    health_analyst: `No risk and no condition yet. ${gateLine} Analysis waits until those items are closed or waived.`,
    test_planner: `No test is worth naming. ${gateLine} The gap is ${first}, not a missing panel.`,
    research_lead: `No paper yet. ${gateLine} A citation would treat an unreconciled number as a finding.`,
    safety_reviewer: `No clinical claim while the gate is open. ${gateLine}`,
    doctor: `Nothing to check. ${gateLine} The analyst has not published a claim.`,
  }[roleId] || `${gateLine} Next is ${first}.`;
  return lead;
}

function councilOpenText(artifact, question) {
  const gate = gateFromArtifact(artifact);
  const items = openItems(artifact);
  const kind = askKind(question);
  const first = firstRepair(items);
  const gateLine = gateSentence(gate);
  if (kind === 'list') return `${gateLine}\n\n${listText(items)}`;
  if (kind === 'fix' || kind === 'how') {
    return `No. The record has to be fixed in the app, not from this chat. ${gateLine} Start with ${first}. Then run /health verify.`;
  }
  return `No health status yet. ${gateLine} Start with ${first}. Not a habit and not a new test. Ask again when /health verify says 0 open.`;
}

function missingText() {
  return "I can't see a verify artifact in the health workspace, so I won't guess at a gap, a risk, or a test. Send /health verify in this chat, then ask again.";
}

/** The safe reply with no model. `null` means the gate is closed and only a model may answer. */
export function formatHealthGroupReply({ mode, roleId, question, artifact } = {}) {
  if (!artifact) return missingText();
  const gate = gateFromArtifact(artifact);
  if (!gate.total) {
    return "The verify artifact has no fix-list items, so nothing proves the gate is closed. I won't guess at a gap or a test. Run /health verify and ask again.";
  }
  if (!gate.allowed) {
    return mode === 'council' ? councilOpenText(artifact, question) : seatOpenText(roleId, artifact, question);
  }
  return null;
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

/** One prompt. The seats collaborate in the text. One model call posts it. */
export function healthAnswerPrompt({ mode, roleId, question, artifact } = {}) {
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
      'You cannot edit the app from this chat. If they want something fixed, say the change is made in the app, name the first open repair, and tell them to run /health verify after.',
      'If the question cannot be answered until those repairs close, say that in a sentence that still responds to what they asked.',
      'Do not dump every open repair unless they asked for the list.',
    ];
  return [
    ...who,
    'Reply in plain sentences. Two to six sentences. No title, no "You asked", and no mention of tools or thinking.',
    ...rules,
    '',
    gate.allowed ? closedContext(artifact) : openContext(artifact),
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
 * a room question, or the seat id when that seat was named. The call answers
 * the question the user asked. While the gate is open, a reply that names a
 * disease, a drug, a test, or a new number is discarded and the short repair
 * line is sent instead. A failed call does the same. It never throws into the
 * website coder.
 */
export async function answerHealthGroup({ mode, roleId, question, workspace, artifact = undefined, runModel } = {}) {
  const loaded = artifact !== undefined ? artifact : readHealthVerify(workspace);
  const fallback = formatHealthGroupReply({ mode, roleId, question, artifact: loaded });
  const gate = loaded ? gateFromArtifact(loaded) : null;
  const canModel = Boolean(gate?.total) && typeof runModel === 'function';
  if (mode !== 'council' && !HEALTH_SEAT_IDS.includes(roleId)) {
    return { answered: false, usedModel: false, text: `No health seat matches ${roleId || mode}.` };
  }
  if (!canModel) {
    return {
      answered: true,
      usedModel: false,
      text: clipReply(fallback || 'The data gate is closed, and this turn has no model configured. Nothing was invented in its place.'),
    };
  }
  let raw = '';
  try {
    raw = String(await runModel({
      roleId: mode === 'council' ? 'council' : roleId,
      prompt: healthAnswerPrompt({ mode, roleId, question, artifact: loaded }),
    }) || '').trim();
  } catch {
    raw = '';
  }
  const verdict = acceptHealthReply(raw, { artifact: loaded, question });
  if (!verdict.ok) {
    const safe = fallback || 'The seats could not answer that without adding something the record does not say. Nothing was invented in its place.';
    return { answered: true, usedModel: false, text: clipReply(safe) };
  }
  return { answered: true, usedModel: true, text: clipReply(raw) };
}
