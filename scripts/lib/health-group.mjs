/**
 * Health council turns inside a Telegram group.
 *
 * Two ways in, neither of them a slash command:
 *   @test planner <question>  — only the bot that owns that seat answers.
 *   <question to the room>    — the coordinator runs every seat in order and
 *                               posts one consolidated answer. The other bots
 *                               stay quiet, so the group does not get six replies.
 *
 * While the data gate is open the answer is built from the verify artifact.
 * A model is not asked to invent a test or a condition on rows the sheet and
 * the app still disagree about. A closed gate is the one path that calls a model,
 * still one seat at a time, still one message.
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
const SEAT_CAP = 700;
const REPLY_CAP = 3900;

const ACK = /^(thanks|thank you|thx|ty|ok|okay|k|hi|hello|hey|yo|yes|yeah|no|nope|cool|nice|great|cheers)[.!\s]*$/i;

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

/**
 * A bare group message is a council ask when it is a real question.
 * Acknowledgements stay quiet: the coordinator is addressed, and answering
 * "thanks" with a six-seat review would be the spam the gate exists to stop.
 */
export function isHealthAsk(text) {
  const t = String(text || '').trim();
  if (!t || ACK.test(t)) return false;
  if (t.includes('?')) return true;
  if (/\b(improve|gap|gaps|test|testing|biomarker|health|risk|lab|labs|marker|diet|sleep|plan|wrong|missing)\b/i.test(t)) return true;
  return t.split(/\s+/).filter(Boolean).length >= 6;
}

/**
 * What this group message should do, after addressing has already picked a bot.
 * `null` means the normal turn. `skip` means this bot was addressed only as the
 * coordinator and the text is not a question.
 */
export function classifyHealthGroupTurn({ kind, addr, text, projectId, taxChat } = {}) {
  if (kind !== 'group' || !addr?.addressed) return null;
  const question = String(text || '').trim();
  const seat = HEALTH_SEAT_IDS.includes(addr.roleId) ? addr.roleId : null;
  if (seat && !addr.isBroadcast) return { mode: 'seat', roleId: seat, question };
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

function seatOpenText(roleId, artifact, question) {
  const gate = gateFromArtifact(artifact);
  const items = openItems(artifact);
  const lines = items.map(itemLine);
  const first = lines[0] || 'the first open fix-list item';
  const list = lines.length ? lines.map((line) => `- ${line}`).join('\n') : '- (the artifact lists no open item)';
  const asked = question ? `You asked: ${clip(question, 240)}\n\n` : '';
  const seat = HEALTH_SEAT_ORDER.find((s) => s.id === roleId) || { id: roleId, name: roleId };
  const lead = {
    data_steward: `I am not treating any row as verified. ${gateSentence(gate)} The sheet wins every disagreement, and these items are still open. Next repair: ${first}`,
    health_analyst: `I am not naming a risk or a condition. Analysis stays withheld while the gate is open, because a wrong date becomes a wrong risk. ${gateSentence(gate)}`,
    test_planner: `I can't say a test is worth running yet. A new panel aimed at rows the sheet and the app still disagree on is how a wrong date becomes a wasted needle. ${gateSentence(gate)} The gap to close first is the fix list, not a new test. Next repair: ${first}`,
    research_lead: `I am not citing a paper onto an open gate. A citation on an unreconciled row would treat the wrong number as a finding. ${gateSentence(gate)}`,
    safety_reviewer: `I am refusing any clinical claim while the gate is open. ${gateSentence(gate)}`,
    doctor: `There is no analysis for me to check. The analyst does not publish claims while the gate is open. ${gateSentence(gate)}`,
  }[roleId] || `${gateSentence(gate)} I will not go past the open fix list.`;
  return [
    seat.name,
    '',
    asked + lead,
    '',
    'Open fix list:',
    list,
    '',
    'Nothing here is a diagnosis or a test order. Close these in the app, run /health verify, and ask again when it reports 0 open.',
  ].join('\n');
}

function councilOpenText(artifact, question) {
  const gate = gateFromArtifact(artifact);
  const items = openItems(artifact);
  const lines = items.map(itemLine);
  const first = lines[0] || 'the first open fix-list item';
  const asked = question ? `You asked: ${clip(question, 240)}\n\n` : '';
  const blurbs = {
    data_steward: `The rows are not verified. ${gateSentence(gate)}\n${lines.map((line) => `- ${line}`).join('\n')}`,
    health_analyst: 'No risk and no condition. Analysis waits until every item above is closed or waived.',
    test_planner: 'No test is worth naming yet. The gap is the open fix list, not a missing panel.',
    research_lead: 'No literature. A paper would launder an unreconciled number.',
    safety_reviewer: 'Any clinical claim is refused while those items are open.',
    doctor: 'Nothing to strike. The analyst has not published a claim.',
  };
  const seats = HEALTH_SEAT_ORDER.map((seat, i) => `${i + 1}. ${seat.name}\n${blurbs[seat.id]}`);
  return [
    'One answer',
    '',
    `${asked}The thing to improve first is the health record, not a habit and not a new test. ${gateSentence(gate)} Start with ${first}. When /health verify says 0 open, ask again and the same seats will answer from the verified rows.`,
    '',
    'Seats, in order:',
    '',
    seats.join('\n\n'),
  ].join('\n');
}

function missingText(question) {
  const asked = question ? `You asked: ${clip(question, 240)}\n\n` : '';
  return `${asked}I can't see a verify artifact in the health workspace, so I won't guess at a gap, a risk, or a test. Send /health verify in this chat, then ask again.`;
}

/** The reply when no model is allowed to speak. `null` means the gate is closed and a model may run. */
export function formatHealthGroupReply({ mode, roleId, question, artifact } = {}) {
  if (!artifact) return missingText(question);
  const gate = gateFromArtifact(artifact);
  if (!gate.total) {
    const asked = question ? `You asked: ${clip(question, 240)}\n\n` : '';
    return `${asked}The verify artifact has no fix-list items, so nothing proves the gate is closed. I won't guess at a gap or a test. Run /health verify and ask again.`;
  }
  if (!gate.allowed) {
    return mode === 'council' ? councilOpenText(artifact, question) : seatOpenText(roleId, artifact, question);
  }
  return null;
}

function seatPrompt({ seat, question, contextText, prior }) {
  return [
    `You are the ${seat.name} (${seat.id}) on the personal health council.`,
    'Answer the user in plain sentences for a group chat.',
    'Use only the workspace context below. Do not invent a lab value, a diagnosis, a drug, or a test the context does not support.',
    'Do not repeat the profile uid.',
    'If the data gate is open, say so and stop. Do not name a condition and do not recommend a test.',
    '',
    'Workspace context:',
    contextText,
    '',
    prior ? `Earlier seats this turn, already in order:\n${prior}` : '',
    '',
    `User: ${question}`,
  ].filter(Boolean).join('\n');
}

function clipReply(text) {
  const t = String(text || '').trim();
  if (t.length <= REPLY_CAP) return t;
  return `${t.slice(0, REPLY_CAP - 1)}…`;
}

/**
 * One group reply. `runModel({ roleId, prompt })` is required only when the
 * gate is closed. It is called once per seat, in HEALTH_SEAT_ORDER, then once
 * more to consolidate. A failed seat fails the turn: a partial clinical answer
 * is worse than an error.
 */
export async function answerHealthGroup({ mode, roleId, question, workspace, artifact = undefined, runModel } = {}) {
  const loaded = artifact !== undefined ? artifact : readHealthVerify(workspace);
  const ready = formatHealthGroupReply({ mode, roleId, question, artifact: loaded });
  if (ready != null) return { answered: true, usedModel: false, text: clipReply(ready) };

  if (typeof runModel !== 'function') {
    return {
      answered: true,
      usedModel: false,
      text: 'The data gate is closed, and this turn has no model configured to run the seats. Nothing was invented in its place.',
    };
  }
  const contextText = digestVerify(loaded);
  const seats = mode === 'council'
    ? HEALTH_SEAT_ORDER
    : HEALTH_SEAT_ORDER.filter((seat) => seat.id === roleId);
  if (!seats.length) {
    return { answered: false, usedModel: false, text: `No health seat matches ${roleId || mode}.` };
  }
  const parts = [];
  for (const seat of seats) {
    const prior = parts.join('\n\n');
    const text = String(await runModel({
      roleId: seat.id,
      prompt: seatPrompt({ seat, question, contextText, prior }),
    }) || '').trim();
    if (!text) throw new Error(`the ${seat.name} seat returned no text`);
    parts.push(`${seat.name}: ${clip(text, SEAT_CAP)}`);
  }
  if (mode !== 'council') {
    return { answered: true, usedModel: true, text: clipReply(parts[0]) };
  }
  const consolidated = String(await runModel({
    roleId: 'consolidator',
    prompt: [
      'Combine the seat answers below into one short answer for the user.',
      'Do not add a fact, a test, a diagnosis, or a number that is not already in the seat answers.',
      'Start with the answer itself.',
      '',
      parts.join('\n\n'),
      '',
      `User: ${question}`,
    ].join('\n'),
  }) || '').trim();
  if (!consolidated) throw new Error('the consolidated answer returned no text');
  const body = [
    'One answer',
    '',
    clip(consolidated, 1200),
    '',
    'Seats, in order:',
    '',
    parts.map((part, i) => `${i + 1}. ${part}`).join('\n\n'),
  ].join('\n');
  return { answered: true, usedModel: true, text: clipReply(body) };
}
