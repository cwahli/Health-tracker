#!/usr/bin/env node
/**
 * The two group scenarios the health seats have to answer without a slash.
 *
 * 1. "@test planner …" is answered by the bot that owns that seat. The
 *    coordinator stays quiet when a seat is owned, and adopts the seat when
 *    nobody owns it.
 * 2. "is there anything I need to improve?" is the coordinator's turn. It runs
 *    the seats in order and the reply is one consolidated answer. The other
 *    bots are not addressed.
 *
 * Any real question is answered in one reply. The seats work it out together
 * inside that reply. While the data gate is open, a model answer that names a
 * test, a condition, or a new number goes back to the model once with the
 * checker's reason; only a second refusal falls back to one short line that
 * names the reason. The host logs that reason.
 *
 * A brief ask — "work on the brief", "update the documents" — is its own
 * kind: it runs the publisher under the same busy guard the seats use, and the
 * room gets the refresh reply (drafts publish, analysis withheld). Questions
 * about the brief see its state as facts in the model context.
 *
 * The lane under the room retries a transient provider refusal (503-class
 * "UNAVAILABLE / high demand") exactly once after a short wait — the live
 * site's own withGeminiRetry rule. A 429 is never retried; a second 503 keeps
 * the provider's error so the room's fallback line can name it.
 *
 * The transcript's own asks are pinned as classification/answer-contract
 * cases: the three data questions are council asks, "can you work on the
 * brief?" is the brief ask, and the typo'd /heath verify is the router's own
 * line, never a health turn. Each is answered — no fallback line — so the
 * room's canned paragraph stays reserved for a genuine refusal.
 *
 * When the chosen engine stalls or stays unavailable, the lane fails the
 * model, not the job: one hop to the live site's own default engine
 * (nextGeminiFallbackEngine's rule). Measured live 2026-10-02: the room's
 * prompt hung past 120s on gemini-3.7-flash while 3.5-flash-lite answered in
 * 958 ms.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { resolveGroupAddressing, HELP_USAGE, parseCommand } from './lib/commands.mjs';
import { getProjectRoles } from './lib/project-registry.mjs';
import { loadRegistry, resolveRegistryPath, normalizeConfig } from './lib/registry.mjs';
import {
  HEALTH_SEAT_IDS,
  answerHealthGroup,
  classifyHealthGroupTurn,
  dedicatedHealthRoleIds,
  acceptHealthReply,
  formatDocLinks,
  formatHealthGroupReply,
  healthAnswerPrompt,
  isHealthAsk,
  isLinkAsk,
} from './lib/health-group.mjs';
import { formatRefreshText } from './health-runner.mjs';
import { answerBriefAsk } from './bot-host.mjs';
import { runGemini } from './lib/agent-gemini.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HOST = fs.readFileSync(path.join(HERE, 'bot-host.mjs'), 'utf8');

let passed = 0;
let failed = 0;
function check(name, cond, detail = '') {
  if (cond) passed += 1;
  else {
    failed += 1;
    console.log(`  FAIL  ${name}${detail ? `  — ${detail}` : ''}`);
  }
}

const group = (text) => ({ chat: { type: 'supergroup', id: -100123 }, text });
const plannerQuery = "@test planner is there any gap in my biomarker data that's worth testing?";
const roomQuery = 'is there anything I need to improve?';

const reg = loadRegistry(resolveRegistryPath(null, path.resolve(HERE, '..')));
const dedicated = dedicatedHealthRoleIds(reg.bots);
const seatOpts = (bot) => ({
  role: bot.agent?.healthRole || '',
  name: bot.name,
  isMaster: bot.id === reg.master,
  allowGroupBroadcast: true,
  hasDedicatedRoleBots: dedicated.length > 0,
  dedicatedRoleIds: dedicated,
});
const vm = reg.bots.find((b) => b.id === 'vm');
const planner = reg.bots.find((b) => b.agent?.healthRole === 'test_planner');
const analyst = reg.bots.find((b) => b.agent?.healthRole === 'health_analyst');
const steward = reg.bots.find((b) => b.agent?.healthRole === 'data_steward');

check('the six seats stay in the project order', HEALTH_SEAT_IDS.join(',') === getProjectRoles('external-health').map((r) => r.id).join(','));
check('the health-coach bots own steward, analyst, and planner', [steward?.id, analyst?.id, planner?.id].join(',') === 'vm2,vm4,vm5', [steward?.id, analyst?.id, planner?.id].join(','));
check('the coordinator itself owns no seat', !vm.agent?.healthRole);

const plannerMsg = group(plannerQuery);
const forPlanner = resolveGroupAddressing(plannerMsg, { id: 11, username: 'opencode_bot' }, seatOpts(planner));
const forVm = resolveGroupAddressing(plannerMsg, { id: 10, username: 'VM_19485_bot' }, seatOpts(vm));
const forAnalyst = resolveGroupAddressing(plannerMsg, { id: 12, username: 'android_bot' }, seatOpts(analyst));
check('scenario 1 addresses the test planner bot', forPlanner.addressed === true && forPlanner.roleId === 'test_planner');
check('scenario 1 leaves the question without the mention', forPlanner.cleanText === "is there any gap in my biomarker data that's worth testing?");
check('scenario 1 leaves the coordinator quiet', forVm.addressed === false);
check('scenario 1 leaves the analyst quiet', forAnalyst.addressed === false);

const doctorMsg = group('@doctor what should I do about these numbers?');
const doctorForVm = resolveGroupAddressing(doctorMsg, { id: 10, username: 'VM_19485_bot' }, seatOpts(vm));
const doctorForPlanner = resolveGroupAddressing(doctorMsg, { id: 11, username: 'opencode_bot' }, seatOpts(planner));
check('an unowned seat is adopted by the coordinator', doctorForVm.addressed === true && doctorForVm.roleId === 'doctor');
check('the planner bot stays quiet for @doctor', doctorForPlanner.addressed === false);

const room = group(roomQuery);
const roomVm = resolveGroupAddressing(room, { id: 10, username: 'VM_19485_bot' }, seatOpts(vm));
const roomPlanner = resolveGroupAddressing(room, { id: 11, username: 'opencode_bot' }, seatOpts(planner));
const roomSteward = resolveGroupAddressing(room, { id: 13, username: 'vm2_bot' }, seatOpts(steward));
check('scenario 2 addresses only the coordinator', roomVm.addressed === true && roomVm.isBroadcast === true);
check('scenario 2 leaves the planner quiet', roomPlanner.addressed === false);
check('scenario 2 leaves the steward quiet', roomSteward.addressed === false);

const single = resolveGroupAddressing(plannerMsg, { id: 10, username: 'VM_19485_bot' }, {
  isMaster: true,
  hasDedicatedRoleBots: false,
});
check('a coordinator with no seat bots still adopts @test planner', single.addressed === true && single.roleId === 'test_planner');

check('the room question is a council ask', isHealthAsk(roomQuery) === true);
check('a short question is still a council ask', isHealthAsk('status') === true && isHealthAsk('what next') === true);
check('thanks is not a council ask', isHealthAsk('thanks') === false);
check('a greeting is not a council ask', isHealthAsk('good morning') === false && isHealthAsk('ok') === false);
const council = classifyHealthGroupTurn({ kind: 'group', addr: roomVm, text: roomQuery, projectId: 'health-tracker' });
const statusTurn = classifyHealthGroupTurn({ kind: 'group', addr: roomVm, text: 'status', projectId: 'health-tracker' });
const thanks = classifyHealthGroupTurn({ kind: 'group', addr: roomVm, text: 'thanks', projectId: 'health-tracker' });
const seat = classifyHealthGroupTurn({ kind: 'group', addr: forPlanner, text: forPlanner.cleanText, projectId: 'external-2' });
const seatThanks = classifyHealthGroupTurn({ kind: 'group', addr: forPlanner, text: 'thanks', projectId: 'health-tracker' });
const otherProject = classifyHealthGroupTurn({ kind: 'group', addr: roomVm, text: roomQuery, projectId: 'external-2' });
const taxRoom = classifyHealthGroupTurn({ kind: 'group', addr: roomVm, text: roomQuery, projectId: 'chiwah-tax', taxChat: true });
check('a bare health question on the default project is a council turn', council?.mode === 'council');
check('a one-word question in the health room is a council turn', statusTurn?.mode === 'council');
check('an acknowledgement is skipped', thanks?.mode === 'skip');
check('thanks to a named seat is skipped', seatThanks?.mode === 'skip');
check('a named seat is a seat turn even in another project', seat?.mode === 'seat' && seat.roleId === 'test_planner');
check('a bare question in another external project is not stolen', otherProject == null);
check('a tax room is not answered as the health council', taxRoom == null);

// Plan item 3: an explicit brief ask is its own turn kind. A question that
// merely mentions the documents stays a council ask.
const briefAsk = classifyHealthGroupTurn({ kind: 'group', addr: roomVm, text: 'can you work on the brief?', projectId: 'health-tracker' });
const briefRefresh = classifyHealthGroupTurn({ kind: 'group', addr: roomVm, text: 'please refresh the docs when you can', projectId: 'health-tracker' });
const briefUpdate = classifyHealthGroupTurn({ kind: 'group', addr: roomVm, text: 'update the documents', projectId: 'external-health' });
const docsQuestion = classifyHealthGroupTurn({ kind: 'group', addr: roomVm, text: 'what do the documents say about my test plan?', projectId: 'health-tracker' });
const briefTax = classifyHealthGroupTurn({ kind: 'group', addr: roomVm, text: 'update the documents', projectId: 'chiwah-tax', taxChat: true });
check('a brief ask is its own kind', briefAsk?.mode === 'brief' && briefAsk.roleId === null && /work on the brief/.test(briefAsk.question));
check('refresh the docs is a brief ask', briefRefresh?.mode === 'brief');
check('update the documents is a brief ask', briefUpdate?.mode === 'brief');
check('a question about the documents stays a council ask', docsQuestion?.mode === 'council');
check('a tax room does not get a brief turn', briefTax == null);

const openArtifact = {
  at: '2026-10-01T00:00:00Z',
  fixList: {
    items: [
      { id: 'H-1', title: 'Profile demographics match the sheet', state: 'open', detail: 'height does not match the sheet' },
      { id: 'H-2', title: 'One app row per date', state: 'open', detail: 'two rows on one date' },
      { id: 'H-6', title: 'Every sheet value is present in the app', state: 'closed', detail: 'present' },
    ],
  },
};
const noModelFallback = formatHealthGroupReply({ artifact: openArtifact });
check('a model-less fallback is one short line that names the reason', /no council model is wired to answer/.test(noModelFallback) && noModelFallback.length < 220 && !noModelFallback.includes('\n'), noModelFallback.slice(0, 240));
check('the old canned paragraphs are gone', !/no health status yet|not a habit|ask again when|open fix list:|you asked:|in the app, do this first/i.test(noModelFallback), noModelFallback.slice(0, 240));
check('the fallback does not prescribe a test', !/hs-CRP|vitamin D|I recommend|order this|you should test/i.test(noModelFallback), noModelFallback);
check('the fallback does not name a condition', !/diabetes|cardiovascular|hypertension|prediabetes/i.test(noModelFallback));
const refusedFallback = formatHealthGroupReply({ artifact: openArtifact, reason: 'condition' });
check('a refused draft falls back to the short line, not a status paragraph', /couldn't put that answer together/.test(refusedFallback) && /condition the record does not state/.test(refusedFallback) && !/H-1|data gate is open/i.test(refusedFallback), refusedFallback.slice(0, 240));
check('a missing artifact refuses instead of guessing', /won't guess/.test(formatHealthGroupReply({ artifact: null })));

// Plan item 4: the surviving guidance names only commands the /health handler
// serves and the help line lists, and the retired wording is gone.
const guidanceTexts = [
  formatHealthGroupReply({ artifact: null }),
  formatHealthGroupReply({ artifact: { fixList: { items: [] } } }),
  noModelFallback,
  refusedFallback,
  healthAnswerPrompt({ mode: 'council', roleId: null, question: roomQuery, artifact: openArtifact }),
];
check('no health-room reply carries the retired guidance', guidanceTexts.every((t) => !/0 open|not a habit|not a new test|ask again/i.test(t)), guidanceTexts.map((t) => t.slice(0, 100)).join(' || '));
const namedCommands = [...new Set(guidanceTexts.flatMap((t) => [...t.matchAll(/\/health ([a-z-]+)/g)].map((m) => m[1])))];
check('the guidance names the lane commands', ['verify', 'refresh', 'triage', 'dashboard'].every((c) => namedCommands.includes(c)), namedCommands.join(', '));
check('every command the guidance names is handled by /health', namedCommands.every((c) => new RegExp(`sub === '${c}'|sub\\.startsWith\\('${c}'`).test(HOST)), namedCommands.join(', '));
check('every command the guidance names is in the help line', namedCommands.every((c) => HELP_USAGE.health.text.includes(c)), namedCommands.join(', '));
check('the help line lists triage and dashboard', /triage/.test(HELP_USAGE.health.text) && /dashboard/.test(HELP_USAGE.health.text), HELP_USAGE.health.text);

const calls = [];
const closedArtifact = {
  at: '2026-10-01T00:00:00Z',
  fixList: { items: [{ id: 'H-1', title: 'Profile', state: 'closed', detail: 'matches' }] },
  summary: { match: 1, missing: 0, appOnlyUnreviewed: 0, gap: 0 },
};
const closed = await answerHealthGroup({
  mode: 'council',
  question: roomQuery,
  artifact: closedArtifact,
  runModel: async ({ roleId, prompt }) => {
    calls.push(roleId);
    check('the joint prompt carries the user question', prompt.includes(roomQuery));
    check('the joint prompt tells the seats to answer together', /shared answer/i.test(prompt) && /work the question out together/i.test(prompt));
    return 'The verified rows show nothing new to change this week.';
  },
});
check('a closed gate is one joint call', calls.join(',') === 'council', calls.join(','));
check('the closed-gate reply is the joint answer', closed.text === 'The verified rows show nothing new to change this week.');
check('the closed-gate reply does not paste every seat', !/Seats, in order|1\. Data Steward/.test(closed.text));
check('the closed-gate reply used the model', closed.usedModel === true);

const openCalls = [];
const openLive = await answerHealthGroup({
  mode: 'seat',
  roleId: 'test_planner',
  question: forPlanner.cleanText,
  artifact: openArtifact,
  runModel: async ({ roleId, prompt }) => {
    openCalls.push(roleId);
    check('an open-gate prompt carries the question and the repair', prompt.includes(forPlanner.cleanText) && /H-1/.test(prompt));
    check('an open-gate prompt forbids a disease and a named test', /do not name a disease/i.test(prompt) && /lab test/i.test(prompt));
    return 'The rows do not support a gap worth acting on yet. H-1 is still open, so nothing further can be said.';
  },
});
check('an open gate asks the model once', openCalls.join(',') === 'test_planner', openCalls.join(','));
check('an open gate uses a safe answer to the question', openLive.usedModel === true && /H-1 is still open/.test(openLive.text));

const odd = await answerHealthGroup({
  mode: 'council',
  question: 'why is the height row wrong?',
  artifact: openArtifact,
  runModel: async ({ prompt }) => {
    check('an unusual question is passed through whole', prompt.includes('why is the height row wrong?'));
    return 'The height row is the open repair H-1: height does not match the sheet. That is a data mismatch, and it has to be changed in the app.';
  },
});
check('any question is answered from the repairs', odd.usedModel === true && /height does not match the sheet/.test(odd.text));

const retryCalls = [];
const retried = await answerHealthGroup({
  mode: 'council',
  question: roomQuery,
  artifact: openArtifact,
  runModel: async ({ prompt }) => {
    retryCalls.push(prompt);
    return retryCalls.length === 1
      ? 'You have prediabetes. I recommend a vitamin D test.'
      : 'The height row is the open repair H-1: height does not match the sheet. Fix it in the app, then run /health verify.';
  },
});
check('a refused first draft is retried, not dropped', retryCalls.length === 2, `model calls: ${retryCalls.length}`);
const retryPrompt = retryCalls[1] || '';
check('the retry carries the same question and the checker\'s reason', retryPrompt.includes(roomQuery) && /previous draft was refused/i.test(retryPrompt) && /condition the record does not state/i.test(retryPrompt));
check('the rewritten draft answers the question', retried.usedModel === true && /H-1/.test(retried.text));
check('a recovered reply carries no fallback reason', !retried.fallbackReason);
check('the checker names why that reply is refused', acceptHealthReply('You have prediabetes. I recommend a vitamin D test.', { artifact: openArtifact, question: roomQuery }).reason === 'condition');

const rejectedCalls = [];
const rejected = await answerHealthGroup({
  mode: 'council',
  question: roomQuery,
  artifact: openArtifact,
  runModel: async () => {
    rejectedCalls.push(1);
    return 'You have prediabetes. I recommend a vitamin D test.';
  },
});
check('a second refusal falls back to one short line', rejected.usedModel === false && /couldn't put that answer together/.test(rejected.text) && !/prediabetes|vitamin D/i.test(rejected.text));
check('the fallback reason is the checker\'s own', rejected.fallbackReason === 'condition' && rejectedCalls.length === 2, `reason: ${rejected.fallbackReason}, calls: ${rejectedCalls.length}`);

const invented = await answerHealthGroup({
  mode: 'council',
  question: roomQuery,
  artifact: openArtifact,
  runModel: async () => 'Your score is 42 and the gate is open on H-1.',
});
check('an invented number is dropped from the text', invented.usedModel === false && !/\b42\b/.test(invented.text));
check('the invented number survives only in the fallback reason', invented.fallbackReason === 'number 42', invented.fallbackReason);

const quoted = await answerHealthGroup({
  mode: 'seat',
  roleId: 'data_steward',
  question: 'why is the height row wrong?',
  artifact: openArtifact,
  runModel: async () => 'The height row is the open repair H-1: height does not match the sheet. Fix that row in the app, then run /health verify.',
});
check('a reply quoting the repair is kept', quoted.usedModel === true && /H-1/.test(quoted.text));
check('the checker keeps a quoted repair', acceptHealthReply('The height row is the open repair H-1: height does not match the sheet.', { artifact: openArtifact, question: 'why is the height row wrong?' }).ok === true);
const h7Artifact = { fixList: { items: [{ id: 'H-7', title: 'No unexplained app rows', state: 'open', detail: 'HbA1c 40 on 2026-07-08 has no sheet counterpart' }] } };
check('a test named in the repair is quotable', acceptHealthReply('H-7 is still open: HbA1c 40 on 2026-07-08 has no sheet counterpart.', { artifact: h7Artifact, question: 'what is H-7?' }).ok === true);
check('a new test not in the repairs is still refused', acceptHealthReply('I recommend a vitamin D test.', { artifact: openArtifact, question: roomQuery }).reason === 'test');
check('a diagnosis not in the repairs is still refused', acceptHealthReply('You have prediabetes.', { artifact: openArtifact, question: roomQuery }).reason === 'condition');

const thrown = await answerHealthGroup({
  mode: 'council',
  question: 'why is the height row wrong?',
  artifact: openArtifact,
  runModel: async () => {
    throw new Error('lane down');
  },
});
check('a model failure falls back without leaking the error', thrown.usedModel === false && /couldn't put that answer together/.test(thrown.text) && /model call failed/.test(thrown.text) && !/lane down/.test(thrown.text));
check('the thrown error is surfaced for the log', thrown.fallbackReason === 'model failed: lane down', thrown.fallbackReason);

const noModel = await answerHealthGroup({
  mode: 'seat',
  roleId: 'test_planner',
  question: forPlanner.cleanText,
  artifact: openArtifact,
});
check('an open gate without a model names that reason', noModel.usedModel === false && /no council model is wired to answer/.test(noModel.text) && noModel.fallbackReason === 'no council model');

// A brief ask runs the publisher and returns its reply — this is the function
// the bot-host health turn calls. The fixture is the refresh result's shape.
const briefRuns = [];
const briefResult = {
  ok: true,
  paths: { result: '/workspace/result' },
  artifact: {
    at: '2026-10-02T10:00:00Z',
    projectId: 'external-health',
    folderId: 'folder-real',
    mode: 'draft',
    dryRun: false,
    gate: { allowed: false, open: ['H-1', 'H-4'], stale: false },
    refused: ['Candidate conditions', 'Order of business'],
    citationRefusals: [],
    counts: { created: 0, updated: 4, skipped: 0, failed: 0 },
    receipts: [
      { key: 'snapshot', title: 'Health Snapshot', action: 'update', docId: 'doc-1', refused: 0 },
      { key: 'conditions', title: 'Conditions & Actions', action: 'update', docId: 'doc-2', refused: 0 },
      { key: 'test_plan', title: 'Test Plan', action: 'update', docId: 'doc-3', refused: 0 },
      { key: 'insights', title: 'Medical Insights', action: 'update', docId: 'doc-4', refused: 0 },
    ],
    verify: { at: '2026-10-02T10:00:00Z', sheet: 'sheet.xlsx', fixList: { closed: 0, open: 8, waived: 0 } },
  },
};
const briefReply = await answerBriefAsk({
  refresh: async () => { briefRuns.push(1); return briefResult; },
});
check('the brief turn runs the publisher once', briefRuns.length === 1, `runs: ${briefRuns.length}`);
check('the brief reply is the real refresh text', briefReply.text === formatRefreshText(briefResult) && /drafts published, analysis withheld/.test(briefReply.text));
check('the brief turn does not run the seats', briefReply.usedModel === false && briefReply.answered === true);
const briefRefused = await answerBriefAsk({ refresh: async () => ({ ok: false, stage: 'config', error: 'no documents folder — set HEALTH_DOCS_FOLDER' }) });
check('a refused refresh keeps its stage and never a fallback line', /could not be worked \(config\)/.test(briefRefused.text) && !/couldn't put that answer together/.test(briefRefused.text) && briefRefused.fallbackReason === 'brief refused: config');

// The brief's own state reaches the model context as facts, so a question
// about the brief is answered from the workspace, not from memory.
const briefDir = fs.mkdtempSync(path.join(os.tmpdir(), 'health-brief-state-'));
fs.mkdirSync(path.join(briefDir, 'result'), { recursive: true });
fs.writeFileSync(path.join(briefDir, 'result', 'health-refresh.json'), JSON.stringify({
  at: '2026-10-02T09:30:00Z',
  mode: 'draft',
  counts: { created: 0, updated: 4, skipped: 0, failed: 0 },
  gate: { allowed: false, open: ['H-1', 'H-4'], stale: false },
  refused: ['Candidate conditions', 'Order of business'],
}));
fs.writeFileSync(path.join(briefDir, 'result', 'health-docs.json'), JSON.stringify({
  updatedAt: '2026-10-02T09:30:00Z',
  docs: {
    snapshot: { id: 'd1', title: 'Health Snapshot', at: '2026-10-02T09:30:00Z', open: 8 },
    conditions: { id: 'd2', title: 'Conditions & Actions', at: '2026-10-02T09:30:00Z', open: 8 },
    test_plan: { id: 'd3', title: 'Test Plan', at: '2026-10-02T09:30:00Z', open: 8 },
    insights: { id: 'd4', title: 'Medical Insights', at: '2026-10-02T09:30:00Z', open: 8 },
  },
}));
const briefPrompts = [];
await answerHealthGroup({
  mode: 'council',
  question: 'what does the brief say right now?',
  artifact: openArtifact,
  workspace: briefDir,
  runModel: async ({ prompt }) => { briefPrompts.push(prompt); return 'The brief facts are in the context above.'; },
});
check('the model context carries the last refresh time', /2026-10-02T09:30:00Z/.test(briefPrompts[0] || ''));
check('the model context names all four documents', ['Health Snapshot', 'Conditions & Actions', 'Test Plan', 'Medical Insights'].every((t) => (briefPrompts[0] || '').includes(t)));
check('the model context names a withheld section', /Candidate conditions/.test(briefPrompts[0] || ''));
fs.rmSync(briefDir, { recursive: true, force: true });

// Mission item 6: the transcript's own questions, the ones the user says drew
// canned, irrelevant replies. Each is driven through the same turn the host
// runs for a health-room message — classification, then the seats or the
// publisher — and each is a real turn: none is skipped, and a plausible answer
// to each is posted with no fallback reason, so the room's fallback line stays
// reserved for a refusal instead of being the ordinary ask's answer.
const TRANSCRIPT_ASKS = [
  { text: 'how to clean up the data', mode: 'council' },
  { text: 'can you fix the data', mode: 'council' },
  { text: 'What about accurate data for this project. Can you build that out?', mode: 'council' },
  { text: 'Can you work on the brief?', mode: 'brief' },
];
const transcriptTurns = TRANSCRIPT_ASKS.map(({ text }) => classifyHealthGroupTurn({ kind: 'group', addr: roomVm, text, projectId: 'external-health' }));
check('all four transcript asks are answered, none skipped', transcriptTurns.every((turn) => turn && turn.mode !== 'skip'), transcriptTurns.map((t) => t?.mode).join(','));
check('the three data questions are council asks', transcriptTurns.slice(0, 3).every((turn) => turn.mode === 'council' && turn.roleId === null));
check('"can you work on the brief?" is the brief ask, not a seat question', transcriptTurns[3]?.mode === 'brief' && /work on the brief/i.test(transcriptTurns[3].question));
check('the transcript asks are not stolen by another external project', TRANSCRIPT_ASKS.every(({ text }) => classifyHealthGroupTurn({ kind: 'group', addr: roomVm, text, projectId: 'external-2' }) == null));

// The answer contract for those asks: the question reaches the model whole and
// the answer is posted. The stub answers have the shape the live replies took
// on 2026-10-02 — they quote the open repair and point at /health triage or
// /health dashboard — so a fallback here would mean the room got a line that
// does not answer, which is exactly the bug the transcript reported.
const transcriptReplies = [
  'Start with the first open repair, H-1 — the height row does not match the sheet. Open /health triage for the steps, then re-run /health verify.',
  'I can fix the data with you, not for you: H-1 and H-2 are still open, and each one has to be corrected in the app. /health triage lists them in order.',
  'The data is only as accurate as the open repairs allow. H-1 is the first one; closing it is what makes the numbers trustworthy, and /health dashboard has the full list.',
];
let transcriptIdx = 0;
for (const ask of TRANSCRIPT_ASKS.slice(0, 3)) {
  const seenPrompts = [];
  const reply = await answerHealthGroup({
    mode: 'council',
    question: ask.text,
    artifact: openArtifact,
    runModel: async ({ prompt }) => {
      seenPrompts.push(prompt);
      return transcriptReplies[transcriptIdx];
    },
  });
  transcriptIdx += 1;
  check(`the transcript ask is carried whole: "${ask.text}"`, seenPrompts.length === 1 && seenPrompts[0].includes(ask.text), `calls: ${seenPrompts.length}`);
  check(`the transcript ask is answered, not fallen back: "${ask.text}"`, reply.answered === true && reply.usedModel === true && reply.fallbackReason === '' && /H-1/.test(reply.text), `usedModel=${reply.usedModel} reason=${reply.fallbackReason}`);
}
const transcriptBrief = await answerBriefAsk({ refresh: async () => { briefRuns.push(1); return briefResult; } });
check('the brief ask runs the publisher instead of the seats', transcriptBrief.text === formatRefreshText(briefResult) && transcriptBrief.usedModel === false && !/couldn't put that answer together/.test(transcriptBrief.text));

// The second transcript, 2026-10-04: the room asked twice for a document link.
// "Give link to document" was answered by the council model with a paragraph
// that described the four documents and contained no URL; "Give the link here"
// was answered with `health group council fell back: model failed: timed out
// after 120000ms`. A URL is a lookup in the workspace's own registry, so both
// asks are pinned here as a `link` turn that calls no model and cannot time
// out — and the clinical question that merely *mentions* a link stays a
// council ask, so the loose match cannot swallow real questions.
const LINK_ASKS = ['Give link to document', 'Give the link here', 'send me the link to the test plan', "what's the docs url", 'where are the documents'];
for (const ask of LINK_ASKS) {
  check(`"${ask}" is a link turn`, isLinkAsk(ask) === true);
  const turn = classifyHealthGroupTurn({ kind: 'group', addr: roomVm, text: ask, projectId: 'external-health' });
  check(`"${ask}" is answered as a link, not by the seats`, turn?.mode === 'link' && turn.roleId === null, turn?.mode);
}
check('a link ask is not stolen by another external project', LINK_ASKS.every((ask) => classifyHealthGroupTurn({ kind: 'group', addr: roomVm, text: ask, projectId: 'external-2' }) == null));
// The false-positive sweep, held as cases. Each of these names a link or a
// document and is still a real question, so the seats answer it. A link path
// loose enough to swallow these would replace a timeout with a wrong answer,
// which is not better.
const NOT_LINK_ASKS = [
  'is there a link between low vitamin D and low energy?',
  'what is the link between my sheet and the app?',
  'the link between HbA1c and fasting glucose',
  'does that link still hold',
  'is my biomarker data linked to any diagnosis?',
  'what do the documents say',
  'where are the gaps in my data?',
];
for (const ask of NOT_LINK_ASKS) {
  check(`"${ask}" is not a link turn`, isLinkAsk(ask) === false && classifyHealthGroupTurn({ kind: 'group', addr: roomVm, text: ask, projectId: 'external-health' })?.mode === 'council');
}
check('a link ask never steals the brief ask', classifyHealthGroupTurn({ kind: 'group', addr: roomVm, text: 'Can you work on the brief?', projectId: 'external-health' })?.mode === 'brief');
check('a link word in the brief is still a link, not a publish', classifyHealthGroupTurn({ kind: 'group', addr: roomVm, text: 'give me the link to the brief', projectId: 'external-health' })?.mode === 'link');

// The answer contract: the recorded ids, no model call, no fallback line. The
// lane is a landmine here on purpose — if a link ask ever reaches it again,
// this turn throws instead of quietly spending another 120s.
const linkDir = fs.mkdtempSync(path.join(os.tmpdir(), 'health-doc-links-'));
fs.mkdirSync(path.join(linkDir, 'result'), { recursive: true });
fs.writeFileSync(path.join(linkDir, 'result', 'health-docs.json'), JSON.stringify({
  folderId: 'FOLDER1',
  docs: {
    snapshot: { id: 'DOC_SNAPSHOT', title: 'Health Snapshot', at: '2026-10-01T21:16:39.996Z', open: 8 },
    conditions: { id: 'DOC_CONDITIONS', title: 'Conditions & Actions', at: '2026-10-01T21:16:39.996Z', open: 8 },
    test_plan: { id: '', title: 'Test Plan', at: undefined, open: 8 },
    insights: { id: 'DOC_INSIGHTS', title: 'Medical Insights', at: '2026-10-01T21:16:39.996Z', open: 8 },
  },
}));
fs.writeFileSync(path.join(linkDir, 'result', 'health-refresh.json'), JSON.stringify({
  at: '2026-10-01T21:16:39.996Z',
  mode: 'draft',
  counts: { created: 0, updated: 4, skipped: 0, failed: 0 },
  gate: { allowed: false, open: ['H-1'], stale: false },
  refused: ['Candidate conditions'],
}));
const linkReply = await answerHealthGroup({
  mode: 'link',
  roleId: null,
  question: 'Give the link here',
  workspace: linkDir,
  artifact: null,
  runModel: async () => { throw new Error('a link ask must never reach a model'); },
});
check('a link ask posts the recorded url for each written document', ['DOC_SNAPSHOT', 'DOC_CONDITIONS', 'DOC_INSIGHTS'].every((id) => linkReply.text.includes(`https://docs.google.com/document/d/${id}/edit`)), linkReply.text);
check('a link ask calls no model and has no fallback reason', linkReply.answered === true && linkReply.usedModel === false && linkReply.fallbackReason === '' && !/couldn't put that answer together/.test(linkReply.text));
check('a link ask needs no verify artifact', !/verify artifact/.test(linkReply.text), linkReply.text);
check('a document with no recorded id is named, not linked', /Not written yet: Test Plan/.test(linkReply.text) && !/document\/d\/\/edit/.test(linkReply.text), linkReply.text);
check('a link answer says the documents are drafts while repairs are open', /drafts/i.test(linkReply.text) && /repair item/.test(linkReply.text), linkReply.text);
check('a link answer carries the written date, not the day it was asked', /2026-10-01/.test(linkReply.text), linkReply.text);
check('a link ask naming one written document leads with that document', formatDocLinks({ workspace: linkDir, question: 'give me the link to the health snapshot' }).startsWith('Health Snapshot'));
// The words people actually type. Measured live: `/health link insights` came
// back with all four documents, because the match wanted the whole title.
check('a short name picks the right document: insights', formatDocLinks({ workspace: linkDir, question: 'insights' }).startsWith('Medical Insights'), formatDocLinks({ workspace: linkDir, question: 'insights' }).slice(0, 80));
check('a short name picks the right document: snapshot', formatDocLinks({ workspace: linkDir, question: 'snapshot' }).startsWith('Health Snapshot'));
check('a short name picks the right document: conditions', formatDocLinks({ workspace: linkDir, question: 'conditions' }).startsWith('Conditions & Actions'));
check('a word that names no document still gets all four', /^The 3 health documents/.test(formatDocLinks({ workspace: linkDir, question: 'document' })), formatDocLinks({ workspace: linkDir, question: 'document' }).slice(0, 80));
check('a link ask naming an unwritten document gets no url for it', /Not written yet: Test Plan/.test(formatDocLinks({ workspace: linkDir, question: 'send me the link to the test plan' })));

const emptyLinkDir = fs.mkdtempSync(path.join(os.tmpdir(), 'health-doc-links-empty-'));
fs.mkdirSync(path.join(emptyLinkDir, 'result'), { recursive: true });
const emptyLinkReply = await answerHealthGroup({ mode: 'link', roleId: null, question: 'Give link to document', workspace: emptyLinkDir });
check('a workspace with no registry names no url at all', !/https:\/\//.test(emptyLinkReply.text) && /\/health refresh/.test(emptyLinkReply.text) && emptyLinkReply.usedModel === false, emptyLinkReply.text);

// A registry with ids but no refresh receipt is a real state (the receipt is
// written by the same run, and a half-copied workspace has one without the
// other). It must print the links and stay silent about what was withheld —
// "nothing has been published" would be a claim, and a false one.
const noReceiptDir = fs.mkdtempSync(path.join(os.tmpdir(), 'health-doc-links-noreceipt-'));
fs.mkdirSync(path.join(noReceiptDir, 'result'), { recursive: true });
fs.copyFileSync(path.join(linkDir, 'result', 'health-docs.json'), path.join(noReceiptDir, 'result', 'health-docs.json'));
const noReceiptReply = await answerHealthGroup({ mode: 'link', roleId: null, question: 'Give the link here', workspace: noReceiptDir });
check('a missing refresh receipt silences the withheld line, it does not invent one', /DOC_SNAPSHOT/.test(noReceiptReply.text) && !/nothing has been published|drafts/i.test(noReceiptReply.text), noReceiptReply.text);
fs.rmSync(linkDir, { recursive: true, force: true });
fs.rmSync(emptyLinkDir, { recursive: true, force: true });
fs.rmSync(noReceiptDir, { recursive: true, force: true });

// The typo'd command the user actually typed. A message that starts with "/"
// is a command to the host before it is ever a health turn — so the seats must
// never see it, and the room gets the router's own line (which names the real
// commands) rather than an invented health answer.
const typoCmd = parseCommand('/heath verify');
check('a typo\'d slash command parses as its own name, not as /health', typoCmd?.name === 'heath' && typoCmd?.args === 'verify', JSON.stringify(typoCmd));
check('the router\'s unknown-command line names the command it did not serve', HOST.includes('Unknown command: /${cmd.name}'));
const routerAt = HOST.indexOf('const cmd = text ? parseCommand(text) : null;');
const seatAt = HOST.indexOf('const healthTurn = classifyHealthGroupTurn');
check('the command router runs before the health turn', routerAt > 0 && seatAt > routerAt);

// End-to-end on the real surface: the host's own --simulate route runs the
// same handleCommand a live command message runs, so this is the typo the
// user actually typed, through the router, not a string match on the source.
const typoRun = spawnSync(process.execPath, [path.join(HERE, 'bot-host.mjs'), '--simulate=/heath verify', '--id=vm'], { encoding: 'utf8', timeout: 30000 });
const typoOut = `${typoRun.stdout || ''}${typoRun.stderr || ''}`;
check('the typo\'d command reaches the router end-to-end', typoRun.status === 0 && /Unknown command: \/heath\b/.test(typoOut), typoOut.slice(0, 200));
check('the typo reply is the router\'s, not a health answer', !/couldn't put that answer together|health council|data gate/i.test(typoOut), typoOut.slice(0, 200));
check('the typo reply shows the real command surface', /\/health\b/.test(typoOut), typoOut.slice(0, 300));

// The room's model lane retries a transient provider refusal once. Live on
// 2026-10-02 the health room's prompt drew a 503 ("high demand") from
// gemini-3.7-flash and the second try answered — without this the room gets
// only the fallback line. Parity: server_gemini_retry.ts withGeminiRetry
// ("503: at most one extra try after a short wait"; 429 never retried).
const gemOk = (text) => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: text } }], usage: { total_tokens: 7 } }) });
const gemErr = (status, message, statusLabel = 'UNAVAILABLE') => ({ ok: false, status, json: async () => ({ error: { code: status, message, status: statusLabel } }) });
const highDemand = 'This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later.';

const transientModels = [];
const transientRetried = await runGemini({
  prompt: 'how do I clean up the data?',
  model: 'gemini/gemini-3.7-flash',
  env: { GEMINI_API_KEY: 'k' },
  retryDelayMs: 1,
  fetchImpl: async (url, init) => {
    transientModels.push(JSON.parse(init.body).model);
    return transientModels.length === 1 ? gemErr(503, highDemand) : gemOk('the retry answered');
  },
});
check('a 503 answers on the one allowed retry', transientRetried.finalText === 'the retry answered' && transientRetried.lastError === null, JSON.stringify({ text: transientRetried.finalText, err: transientRetried.lastError }));
check('the retry asks the same model exactly twice', transientModels.length === 2 && transientModels.every((m) => m === 'gemini-3.7-flash'), JSON.stringify(transientModels));

// A second 503 on the primary is not retried a third time there — but the
// live site's nextGeminiFallbackEngine rule then fails the *model*, not the
// job: exactly one hop to the lite engine. Both engines 503 here, so the
// error the room sees is the provider's own and no third call happened on
// either model.
const doubleModels = [];
const double503 = await runGemini({
  prompt: 'q',
  model: 'gemini/gemini-3.7-flash',
  env: { GEMINI_API_KEY: 'k' },
  retryDelayMs: 1,
  fetchImpl: async (url, init) => { doubleModels.push(JSON.parse(init.body).model); return gemErr(503, highDemand); },
});
check('a second 503 is not retried a third time on the primary', doubleModels.filter((m) => m === 'gemini-3.7-flash').length === 2, JSON.stringify(doubleModels));
check('a doubly-503 primary makes exactly one hop to the lite engine', doubleModels.length === 4 && doubleModels.slice(2).every((m) => m === 'gemini-3.5-flash-lite'), JSON.stringify(doubleModels));
check('both engines unavailable keeps the provider error, not a silent line', /unavailable|high demand|provider error/i.test(double503.lastError || ''), double503.lastError);

// The stall hop. Measured live on the VPS 2026-10-02: the room's prompt hung
// past 120s on gemini-3.7-flash while 3.5-flash-lite answered in 958 ms. A
// transport stall is the failure the room actually hit, so it must hop too.
let stallCalls = 0;
const stallHop = await runGemini({
  prompt: 'how to clean up the data',
  model: 'gemini/gemini-3.7-flash',
  env: { GEMINI_API_KEY: 'k' },
  retryDelayMs: 1,
  timeoutMs: 1,
  fetchImpl: async () => {
    stallCalls += 1;
    if (stallCalls === 1) {
      const err = new Error('The operation was aborted due to timeout');
      err.name = 'TimeoutError';
      throw err;
    }
    return gemOk('the lite engine answered');
  },
});
check('a stalled primary hops once and the answer is the hop\'s', stallHop.finalText === 'the lite engine answered' && stallHop.lastError === null, JSON.stringify({ text: stallHop.finalText, err: stallHop.lastError }));
check('the stall hop is recorded so the host log names the engine that answered', stallHop.stderr === 'fallback:gemini-3.5-flash-lite', stallHop.stderr);

// An out-of-quota primary that is answered by the lite engine is a real
// answer, and the host log names the engine that served it.
const quotaHopModels = [];
const quotaHop = await runGemini({
  prompt: 'q',
  model: 'gemini/gemini-3.7-flash',
  env: { GEMINI_API_KEY: 'k' },
  retryDelayMs: 1,
  fetchImpl: async (url, init) => {
    const m = JSON.parse(init.body).model;
    quotaHopModels.push(m);
    return m === 'gemini-3.7-flash' ? gemErr(429, 'Resource has been exhausted (e.g. check quota).') : gemOk('the lite engine answered');
  },
});
check('the lite engine answering after a quota-dead primary is a real answer', quotaHop.finalText === 'the lite engine answered' && quotaHop.lastError === null, JSON.stringify({ text: quotaHop.finalText, err: quotaHop.lastError }));
check('the quota hop is recorded for the host log', quotaHop.stderr === 'fallback:gemini-3.5-flash-lite', quotaHop.stderr);

// A caller already on the lite engine does not hop to itself.
let liteCalls = 0;
await runGemini({
  prompt: 'q',
  model: 'gemini/gemini-3.5-flash-lite',
  env: { GEMINI_API_KEY: 'k' },
  retryDelayMs: 1,
  fetchImpl: async () => { liteCalls += 1; return gemErr(503, highDemand); },
});
check('the fallback engine does not hop to itself', liteCalls === 2, `${liteCalls} calls`);

// The hop target is the live site's own default engine, and the hop is
// injectable so a caller can disable it.
check('the stall fallback is the live site\'s default engine', /GEMINI_STALL_FALLBACK_MODEL = 'gemini\/gemini-3\.5-flash-lite'/.test(fs.readFileSync(path.join(HERE, 'lib', 'agent-gemini.mjs'), 'utf8')));
let disabledCalls = 0;
const hopDisabled = await runGemini({
  prompt: 'q',
  model: 'gemini/gemini-3.7-flash',
  env: { GEMINI_API_KEY: 'k' },
  retryDelayMs: 1,
  fallbackModel: '',
  fetchImpl: async () => { disabledCalls += 1; return gemErr(503, highDemand); },
});
check('an empty fallbackModel disables the hop', disabledCalls === 2 && /unavailable|high demand|provider error/i.test(hopDisabled.lastError || ''), `${disabledCalls} calls`);

// Quota: never a second call on the SAME model (it burns the same bucket) —
// but each engine has its own bucket, so the live site's own doctrine is to
// fail the model, not the job. The primary is asked once, then the lite
// engine once. Measured live on the VPS 2026-10-02: the room's default
// gemini-3.7-flash was quota-dead (429, twice) while 3.5-flash-lite answered
// the same prompt in 920 ms.
const quotaModels = [];
const quotaRefusal = await runGemini({
  prompt: 'q',
  model: 'gemini/gemini-3.7-flash',
  env: { GEMINI_API_KEY: 'k' },
  retryDelayMs: 1,
  fetchImpl: async (url, init) => { quotaModels.push(JSON.parse(init.body).model); return gemErr(429, 'Resource has been exhausted (e.g. check quota).'); },
});
check('a 429 is never retried on the same model', quotaModels.filter((m) => m === 'gemini-3.7-flash').length === 1, JSON.stringify(quotaModels));
check('an out-of-quota primary makes exactly one hop to the lite engine', quotaModels.length === 2 && quotaModels[1] === 'gemini-3.5-flash-lite', JSON.stringify(quotaModels));
check('both engines out of quota keeps the provider quota error', /quota|rate limit/i.test(quotaRefusal.lastError || ''), quotaRefusal.lastError);

const hopModels = [];
const hop = await runGemini({
  prompt: 'q',
  model: 'gemini/gemini-3.7-flash',
  env: { GEMINI_API_KEY: 'k' },
  retryDelayMs: 1,
  fetchImpl: async (url, init) => {
    hopModels.push(JSON.parse(init.body).model);
    return hopModels.length === 1 ? gemErr(404, 'model not found', 'NOT_FOUND') : gemOk('fallback answered');
  },
});
check('the 404 hop still lands on gemini-2.5-flash, once', hopModels.length === 2 && hopModels[1] === 'gemini-2.5-flash' && hop.finalText === 'fallback answered', JSON.stringify(hopModels));
check('the default retry wait is the live site\'s two seconds', /GEMINI_RETRY_DELAY_MS = 2000/.test(fs.readFileSync(path.join(HERE, 'lib', 'agent-gemini.mjs'), 'utf8')));

const normalized = normalizeConfig(planner);
check('normalizeConfig keeps the health seat', normalized.agent.healthRole === 'test_planner');

const gateAt = HOST.indexOf("if (chatKind(message) === 'group' && !addr.addressed)");
const healthAt = HOST.indexOf('const healthTurn = classifyHealthGroupTurn');
check('the group gate still comes before the health reply', gateAt > 0 && healthAt > gateAt);
check('the handler passes the dedicated seat list', HOST.includes('dedicatedRoleIds'));
check('the handler answers with answerHealthGroup', HOST.includes('answerHealthGroup'));
check('the handler logs the fallback reason', HOST.includes('fallbackReason'));
const busyAt = HOST.indexOf('if (busy.has(chatId))', healthAt);
const briefAt = HOST.indexOf("healthTurn.mode === 'brief'", healthAt);
const releaseAt = HOST.indexOf('busy.delete(chatId)', briefAt);
check('the brief branch sits under the same busy guard as the seats', healthAt > 0 && busyAt > healthAt && briefAt > busyAt);
check('the brief turn runs the publisher and releases the guard', HOST.includes('answerBriefAsk({ projectId') && releaseAt > briefAt);
check('the brief reply goes out as markdown', HOST.includes("reply.markdown ? { parse_mode: 'Markdown' }"));

// `/health link` is the same lookup with the ambiguity taken out: the room does
// not have to phrase an ask for the command to find the documents. Judged on
// the source, because the dispatcher is a switch no test seam reaches.
const COMMANDS = fs.readFileSync(path.join(HERE, 'lib', 'commands.mjs'), 'utf8');
check('the health command advertises the link subcommand', /readiness \| link \["which document"\] \| research/.test(COMMANDS), 'commands.mjs description needs `link`');
const linkBranch = HOST.slice(HOST.indexOf("sub === 'link' || sub.startsWith('link ')"), HOST.indexOf("if (sub === 'doctor')"));
check('/health link is a lookup, not a guarded job', /answerHealthGroup\(\{ mode: 'link'/.test(linkBranch) && !/running\.get\(chatId\)/.test(linkBranch), linkBranch.slice(0, 240));
check('/health link is the same turn as the room ask, one registry reader', /answerHealthGroup/.test(linkBranch) && /mode: 'link'/.test(linkBranch));

console.log(`\n${passed} pass, ${failed} fail`);
process.exit(failed === 0 ? 0 : 1);
