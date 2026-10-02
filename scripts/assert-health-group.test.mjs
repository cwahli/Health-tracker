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
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveGroupAddressing, HELP_USAGE } from './lib/commands.mjs';
import { getProjectRoles } from './lib/project-registry.mjs';
import { loadRegistry, resolveRegistryPath, normalizeConfig } from './lib/registry.mjs';
import {
  HEALTH_SEAT_IDS,
  answerHealthGroup,
  classifyHealthGroupTurn,
  dedicatedHealthRoleIds,
  acceptHealthReply,
  formatHealthGroupReply,
  healthAnswerPrompt,
  isHealthAsk,
} from './lib/health-group.mjs';
import { formatRefreshText } from './health-runner.mjs';
import { answerBriefAsk } from './bot-host.mjs';

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

console.log(`\n${passed} pass, ${failed} fail`);
process.exit(failed === 0 ? 0 : 1);
