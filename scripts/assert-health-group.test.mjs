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
 * While the data gate is open the reply is the fix list. It must not name a
 * test or a condition.
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
check('three running clones own steward, analyst, and planner', [steward?.id, analyst?.id, planner?.id].join(',') === 'vm2,android,opencode', [steward?.id, analyst?.id, planner?.id].join(','));
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
check('thanks is not a council ask', isHealthAsk('thanks') === false);
const council = classifyHealthGroupTurn({ kind: 'group', addr: roomVm, text: roomQuery, projectId: 'health-tracker' });
const thanks = classifyHealthGroupTurn({ kind: 'group', addr: roomVm, text: 'thanks', projectId: 'health-tracker' });
const seat = classifyHealthGroupTurn({ kind: 'group', addr: forPlanner, text: forPlanner.cleanText, projectId: 'external-2' });
const otherProject = classifyHealthGroupTurn({ kind: 'group', addr: roomVm, text: roomQuery, projectId: 'external-2' });
check('a bare health question on the default project is a council turn', council?.mode === 'council');
check('an acknowledgement is skipped', thanks?.mode === 'skip');
check('a named seat is a seat turn even in another project', seat?.mode === 'seat' && seat.roleId === 'test_planner');
check('a bare question in another external project is not stolen', otherProject == null);

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
const order = ['One answer', 'Data Steward', 'Health Analyst', 'Test Planner', 'Research Lead', 'Safety Reviewer', 'Doctor'];
let cursor = -1;
let inOrder = true;
for (const label of order) {
  const at = councilReply.indexOf(label);
  if (at <= cursor) inOrder = false;
  cursor = at;
}
check('the council answer leads, then the seats run in order', inOrder, councilReply.slice(0, 200));
check('the council answer does not prescribe a test', !/hs-CRP|vitamin D|I recommend|order this/i.test(councilReply));
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
    check(`closed-gate prompt for ${roleId} carries the user question`, prompt.includes(roomQuery));
    if (roleId === 'consolidator') return 'The verified rows show nothing new to change this week.';
    return `${roleId} looked at the verified rows.`;
  },
});
check('a closed gate runs every seat, then one consolidation', calls.join(',') === [...HEALTH_SEAT_IDS, 'consolidator'].join(','), calls.join(','));
check('the closed-gate reply is one answer plus the seats', closed.text.startsWith('One answer') && closed.text.includes('1. Data Steward') && closed.text.includes('6. Doctor'));
check('the closed-gate reply used the model', closed.usedModel === true);

const openLive = await answerHealthGroup({
  mode: 'seat',
  roleId: 'test_planner',
  question: forPlanner.cleanText,
  artifact: openArtifact,
  runModel: async () => {
    throw new Error('the open gate must not call a model');
  },
});
check('an open gate does not call a model', openLive.usedModel === false && /data gate is open/.test(openLive.text));

const normalized = normalizeConfig(planner);
check('normalizeConfig keeps the health seat', normalized.agent.healthRole === 'test_planner');

const gateAt = HOST.indexOf("if (chatKind(message) === 'group' && !addr.addressed)");
const healthAt = HOST.indexOf('const healthTurn = classifyHealthGroupTurn');
check('the group gate still comes before the health reply', gateAt > 0 && healthAt > gateAt);
check('the handler passes the dedicated seat list', HOST.includes('dedicatedRoleIds'));
check('the handler answers with answerHealthGroup', HOST.includes('answerHealthGroup'));

console.log(`\n${passed} pass, ${failed} fail`);
process.exit(failed === 0 ? 0 : 1);
