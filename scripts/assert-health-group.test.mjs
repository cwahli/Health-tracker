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
 * test, a condition, or a new number is dropped and the short repair line is
 * sent instead.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveGroupAddressing } from './lib/commands.mjs';
import { getProjectRoles } from './lib/project-registry.mjs';
import { loadRegistry, resolveRegistryPath, normalizeConfig } from './lib/registry.mjs';
import {
  HEALTH_SEAT_IDS,
  answerHealthGroup,
  classifyHealthGroupTurn,
  dedicatedHealthRoleIds,
  acceptHealthReply,
  formatHealthGroupReply,
  isHealthAsk,
} from './lib/health-group.mjs';

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
const plannerReply = formatHealthGroupReply({
  mode: 'seat',
  roleId: 'test_planner',
  question: forPlanner.cleanText,
  artifact: openArtifact,
});
check('the planner names the open gate', /data gate is open \(2: H-1, H-2\)/.test(plannerReply), plannerReply.slice(0, 240));
check('the planner names the first repair', /H-1/.test(plannerReply));
check('the planner does not prescribe a test', !/hs-CRP|vitamin D|I recommend|order this|you should test/i.test(plannerReply), plannerReply);
check('the planner does not name a condition', !/diabetes|cardiovascular|hypertension|prediabetes/i.test(plannerReply));

const councilReply = formatHealthGroupReply({ mode: 'council', question: roomQuery, artifact: openArtifact });
check('an open council answer is one short status', councilReply.startsWith('No health status yet') && /data gate is open \(2: H-1, H-2\)/.test(councilReply) && /H-1/.test(councilReply), councilReply.slice(0, 240));
check('an open council answer does not repeat every seat', !/Seats, in order|1\. Data Steward/.test(councilReply));
check('the council answer does not prescribe a test', !/hs-CRP|vitamin D|I recommend|order this/i.test(councilReply));
const fixReply = formatHealthGroupReply({ mode: 'seat', roleId: 'data_steward', question: '@VM2_19485_bot how to clean up the data', artifact: openArtifact });
check('a cleanup question says where to edit and does not echo the mention', /In the app, do this first: H-1/.test(fixReply) && !/@VM2_19485_bot|You asked:|Open fix list:/.test(fixReply), fixReply.slice(0, 240));
const cannot = formatHealthGroupReply({ mode: 'seat', roleId: 'data_steward', question: 'Can you fix the data', artifact: openArtifact });
check('a fix request is a no, without the full list', cannot.startsWith('No.') && !/Open fix list:|You asked:/.test(cannot), cannot.slice(0, 240));
check('a missing artifact refuses instead of guessing', /won't guess/.test(formatHealthGroupReply({ mode: 'seat', roleId: 'test_planner', question: 'gaps?', artifact: null })));

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

const rejected = await answerHealthGroup({
  mode: 'council',
  question: roomQuery,
  artifact: openArtifact,
  runModel: async () => 'You have prediabetes. I recommend a vitamin D test.',
});
check('a diagnosis or a named test is dropped', rejected.usedModel === false && /data gate is open/.test(rejected.text) && !/prediabetes|vitamin D/i.test(rejected.text));
check('the checker names why that reply is refused', acceptHealthReply('You have prediabetes. I recommend a vitamin D test.', { artifact: openArtifact, question: roomQuery }).reason === 'condition');

const invented = await answerHealthGroup({
  mode: 'council',
  question: roomQuery,
  artifact: openArtifact,
  runModel: async () => 'Your score is 42 and the gate is open on H-1.',
});
check('an invented number is dropped', invented.usedModel === false && !/\b42\b/.test(invented.text));

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
check('a model failure falls back without the error', thrown.usedModel === false && /data gate is open/.test(thrown.text) && !/lane down/.test(thrown.text));

const noModel = await answerHealthGroup({
  mode: 'seat',
  roleId: 'test_planner',
  question: forPlanner.cleanText,
  artifact: openArtifact,
});
check('an open gate without a model stays on the repair line', noModel.usedModel === false && /data gate is open/.test(noModel.text));

const normalized = normalizeConfig(planner);
check('normalizeConfig keeps the health seat', normalized.agent.healthRole === 'test_planner');

const gateAt = HOST.indexOf("if (chatKind(message) === 'group' && !addr.addressed)");
const healthAt = HOST.indexOf('const healthTurn = classifyHealthGroupTurn');
check('the group gate still comes before the health reply', gateAt > 0 && healthAt > gateAt);
check('the handler passes the dedicated seat list', HOST.includes('dedicatedRoleIds'));
check('the handler answers with answerHealthGroup', HOST.includes('answerHealthGroup'));

console.log(`\n${passed} pass, ${failed} fail`);
process.exit(failed === 0 ? 0 : 1);
