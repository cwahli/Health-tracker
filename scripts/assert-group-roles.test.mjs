#!/usr/bin/env node
/**
 * Law sensor for Group Chat Role Mentioning & Council Collaboration.
 *
 * Verifies the two core Telegram supergroup collaboration scenarios:
 * Scenario 1: Targeted mention without slash commands (e.g. "@test planner is there any gap...")
 *             -> The matching role bot takes the turn, while other bots stay quiet.
 * Scenario 2: Unaddressed / broadcast queries (e.g. "is there anything I need to improve?")
 *             -> Master / Council Coordinator provides the consolidated answer,
 *                while dedicated role bots defer to the coordinator.
 */

import {
  extractRoleMention,
  extractAllRoleMentions,
  resolveGroupAddressing,
  isAddressedToUs,
  chatKind,
  recordActiveThread,
  getActiveThread,
  clearActiveThread,
  clearAllActiveThreads,
  ACTIVE_THREAD_WINDOW_MS,
} from './lib/commands.mjs';
import {
  KNOWN_PROJECTS,
  composeExternalPrompt,
} from './lib/project-registry.mjs';

let passed = 0;
let failed = 0;

function check(name, cond, detail = '') {
  if (cond) {
    console.log(`  PASS  ${name}`);
    passed += 1;
  } else {
    failed += 1;
    console.error(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

console.log('assert-group-roles:');

const groupMsg = (text) => ({
  chat: { type: 'supergroup', id: -100123456789 },
  text,
});

// Bots in the supergroup
const MASTER_BOT = { id: 100, username: 'Health_Orchestrator_bot', isMaster: true };
const TEST_PLANNER_BOT = { id: 101, username: 'Health_TestPlanner_bot', role: 'test_planner', name: 'Test Planner' };
const HEALTH_ANALYST_BOT = { id: 102, username: 'Health_Analyst_bot', role: 'health_analyst', name: 'Health Analyst' };
const DOCTOR_BOT = { id: 103, username: 'Health_Doctor_bot', role: 'doctor', name: 'Doctor' };
const DATA_STEWARD_BOT = { id: 104, username: 'Health_DataSteward_bot', role: 'data_steward', name: 'Data Steward' };

// -------------------------------------------------------------------------
// Scenario 1: Targeted Query to a Specific Bot Without Slash Command
// -------------------------------------------------------------------------

// Test 1: @test planner mention extraction
const tpQuery = '@test planner is there any gap in my biomarker data that\'s worth testing?';
const tpExtracted = extractRoleMention(tpQuery);
check('extracts test_planner role mention', tpExtracted?.roleId === 'test_planner');
check('cleans user prompt text', tpExtracted?.cleanText === 'is there any gap in my biomarker data that\'s worth testing?');

// Test 2: Test Planner bot is addressed, others stay quiet
const tpMsg = groupMsg(tpQuery);
const tpForPlanner = resolveGroupAddressing(tpMsg, TEST_PLANNER_BOT, { role: 'test_planner', name: 'Test Planner' });
const tpForAnalyst = resolveGroupAddressing(tpMsg, HEALTH_ANALYST_BOT, { role: 'health_analyst', name: 'Health Analyst' });
const tpForDoctor = resolveGroupAddressing(tpMsg, DOCTOR_BOT, { role: 'doctor', name: 'Doctor' });

check('Test Planner bot is addressed', tpForPlanner.addressed === true && tpForPlanner.roleId === 'test_planner');
check('Health Analyst bot stays quiet for @test planner', tpForAnalyst.addressed === false);
check('Doctor bot stays quiet for @test planner', tpForDoctor.addressed === false);

// Test 3: @health analyst targeted mention
const haQuery = '@health analyst what are my high risk markers?';
const haMsg = groupMsg(haQuery);
const haForAnalyst = resolveGroupAddressing(haMsg, HEALTH_ANALYST_BOT, { role: 'health_analyst', name: 'Health Analyst' });
const haForPlanner = resolveGroupAddressing(haMsg, TEST_PLANNER_BOT, { role: 'test_planner', name: 'Test Planner' });
check('Health Analyst bot is addressed for @health analyst', haForAnalyst.addressed === true && haForAnalyst.roleId === 'health_analyst');
check('Test Planner bot stays quiet for @health analyst', haForPlanner.addressed === false);

// Test 4: @doctor targeted mention
const docQuery = '@doctor review recent findings and audit the claims';
const docMsg = groupMsg(docQuery);
const docForDoctor = resolveGroupAddressing(docMsg, DOCTOR_BOT, { role: 'doctor', name: 'Doctor' });
const docForAnalyst = resolveGroupAddressing(docMsg, HEALTH_ANALYST_BOT, { role: 'health_analyst', name: 'Health Analyst' });
check('Doctor bot is addressed for @doctor', docForDoctor.addressed === true && docForDoctor.roleId === 'doctor');
check('Health Analyst stays quiet for @doctor', docForAnalyst.addressed === false);

// Test 5: Single/master bot fallback when no dedicated role bot exists
const tpForMaster = resolveGroupAddressing(tpMsg, MASTER_BOT, { isMaster: true, hasDedicatedRoleBots: false });
check('Single master bot adopts requested role when no dedicated bot exists', tpForMaster.addressed === true && tpForMaster.roleId === 'test_planner');

// -------------------------------------------------------------------------
// Scenario 2: Unaddressed / Broadcast Query to All Bots
// -------------------------------------------------------------------------

// Test 6: "is there anything I need to improve?" (No @mention)
const broadQuery = 'is there anything I need to improve?';
const broadMsg = groupMsg(broadQuery);

const broadForMaster = resolveGroupAddressing(broadMsg, MASTER_BOT, { isMaster: true, allowGroupBroadcast: true });
const broadForPlanner = resolveGroupAddressing(broadMsg, TEST_PLANNER_BOT, { role: 'test_planner', isMaster: false });
const broadForAnalyst = resolveGroupAddressing(broadMsg, HEALTH_ANALYST_BOT, { role: 'health_analyst', isMaster: false });

check('Master bot takes broad question as Council Coordinator', broadForMaster.addressed === true && broadForMaster.isBroadcast === true);
check('Test Planner bot stays silent on unaddressed group question', broadForPlanner.addressed === false);
check('Health Analyst bot stays silent on unaddressed group question', broadForAnalyst.addressed === false);

// Test 7: "@all is there anything I need to improve?"
const allQuery = '@all is there anything I need to improve?';
const allMsg = groupMsg(allQuery);
const allForMaster = resolveGroupAddressing(allMsg, MASTER_BOT, { isMaster: true, allowGroupBroadcast: true });
const allForDoctor = resolveGroupAddressing(allMsg, DOCTOR_BOT, { role: 'doctor', isMaster: false });
check('Master bot takes @all as Council Coordinator', allForMaster.addressed === true && allForMaster.isBroadcast === true);
check('Doctor bot stays silent on @all', allForDoctor.addressed === false);

// -------------------------------------------------------------------------
// Prompt Composition Alignment
// -------------------------------------------------------------------------

// Test 8: Council mode prompt composition for external-health carries consolidated instructions
const councilPrompt = composeExternalPrompt({
  chatId: 'council_chat_test',
  prompt: 'is there anything I need to improve?',
  activeProject: KNOWN_PROJECTS['external-health'],
  activeRole: null, // Council mode
});
check('council prompt carries Health Council Consolidated Mode header', councilPrompt.includes('COUNCIL CONSOLIDATED MODE'));
check('council prompt names all specialist domains', councilPrompt.includes('Data Steward') && councilPrompt.includes('Test Planner') && councilPrompt.includes('Doctor'));
check('council prompt contains the user request', councilPrompt.endsWith('is there anything I need to improve?'));

// Test 9: Role prompt composition for test_planner carries Test Planner instructions
const plannerPrompt = composeExternalPrompt({
  chatId: 'planner_chat_test',
  prompt: 'is there any gap in my biomarker data that\'s worth testing?',
  activeProject: KNOWN_PROJECTS['external-health'],
  activeRole: 'test_planner',
});
check('test planner prompt carries ACTIVE ROLE: test_planner', plannerPrompt.includes('ACTIVE ROLE: test_planner'));
check('test planner prompt includes Test Plan instructions', plannerPrompt.includes('Test Planner') && plannerPrompt.includes('confirm or renew'));
check('test planner prompt ends with clean user request', plannerPrompt.endsWith('is there any gap in my biomarker data that\'s worth testing?'));

// -------------------------------------------------------------------------
// Topology P2: Multi-Turn via Quoted Reply (reply_to_message)
// -------------------------------------------------------------------------
clearAllActiveThreads();
const replyMsgToPlanner = {
  chat: { type: 'supergroup', id: -100123456789 },
  text: 'What about ApoB targets?',
  reply_to_message: { from: { id: TEST_PLANNER_BOT.id } },
};
const p2ForPlanner = resolveGroupAddressing(replyMsgToPlanner, TEST_PLANNER_BOT, { role: 'test_planner' });
const p2ForDoctor = resolveGroupAddressing(replyMsgToPlanner, DOCTOR_BOT, { role: 'doctor' });
check('P2: Quoted reply to Test Planner addresses Test Planner', p2ForPlanner.addressed === true && p2ForPlanner.roleId === 'test_planner');
check('P2: Quoted reply to Test Planner leaves Doctor quiet', p2ForDoctor.addressed === false);

// -------------------------------------------------------------------------
// Topology P3: 1 Agent Continuous Dialogue (Active Thread Window / TTL)
// -------------------------------------------------------------------------
const threadChatId = -100987654321;
const t0 = 1000000;
recordActiveThread(threadChatId, { roleId: 'test_planner', botId: TEST_PLANNER_BOT.id, timestamp: t0 });

// 30 seconds later (within 120s TTL):
const p3Msg = {
  chat: { type: 'supergroup', id: threadChatId },
  text: 'Can you elaborate on the ApoB target range?',
};
const p3ForPlanner = resolveGroupAddressing(p3Msg, TEST_PLANNER_BOT, { role: 'test_planner', now: t0 + 30000 });
const p3ForDoctor = resolveGroupAddressing(p3Msg, DOCTOR_BOT, { role: 'doctor', now: t0 + 30000 });
const p3ForMaster = resolveGroupAddressing(p3Msg, MASTER_BOT, { isMaster: true, now: t0 + 30000 });

check('P3: Continuous follow-up within 120s addresses active Test Planner without tag', p3ForPlanner.addressed === true && p3ForPlanner.isContinuous === true && p3ForPlanner.roleId === 'test_planner');
check('P3: Other bots (Doctor) stay silent in active thread', p3ForDoctor.addressed === false);
check('P3: Master bot stays silent in active specialist thread', p3ForMaster.addressed === false);

// -------------------------------------------------------------------------
// Topology P4: Mid-Thread Switch (Explicit mention overrides active thread / reply)
// -------------------------------------------------------------------------
// User is in Test Planner thread, but types: "@doctor do you agree with this?"
const p4Msg = {
  chat: { type: 'supergroup', id: threadChatId },
  text: '@doctor do you agree with this?',
  reply_to_message: { from: { id: TEST_PLANNER_BOT.id } },
};
const p4ForDoctor = resolveGroupAddressing(p4Msg, DOCTOR_BOT, { role: 'doctor', now: t0 + 40000 });
const p4ForPlanner = resolveGroupAddressing(p4Msg, TEST_PLANNER_BOT, { role: 'test_planner', now: t0 + 40000 });

check('P4: Explicit @doctor mention overrides Test Planner active thread and reply', p4ForDoctor.addressed === true && p4ForDoctor.roleId === 'doctor');
check('P4: Overridden Test Planner stays silent when @doctor is tagged', p4ForPlanner.addressed === false);

// -------------------------------------------------------------------------
// Topology P5: 2 Agents Joint Query (@analyst @doctor ...)
// -------------------------------------------------------------------------
const p5Query = '@health analyst @doctor can you both check my lipids?';
const p5Extracted = extractAllRoleMentions(p5Query);
check('P5: extractAllRoleMentions extracts both roles', p5Extracted.roles.length === 2 && p5Extracted.roles[0].roleId === 'health_analyst' && p5Extracted.roles[1].roleId === 'doctor');
check('P5: extractAllRoleMentions cleans prompt text', p5Extracted.cleanText === 'can you both check my lipids?');

const p5Msg = groupMsg(p5Query);
const p5ForAnalyst = resolveGroupAddressing(p5Msg, HEALTH_ANALYST_BOT, { role: 'health_analyst' });
const p5ForDoctor = resolveGroupAddressing(p5Msg, DOCTOR_BOT, { role: 'doctor' });
const p5ForPlanner = resolveGroupAddressing(p5Msg, TEST_PLANNER_BOT, { role: 'test_planner' });

check('P5: Health Analyst is addressed with turnOrder 0 and delayMs 0', p5ForAnalyst.addressed === true && p5ForAnalyst.turnOrder === 0 && p5ForAnalyst.delayMs === 0);
check('P5: Doctor is addressed with turnOrder 1 and delayMs 2500 for staggered delivery', p5ForDoctor.addressed === true && p5ForDoctor.turnOrder === 1 && p5ForDoctor.delayMs === 2500);
check('P5: Unmentioned Test Planner stays quiet on joint query', p5ForPlanner.addressed === false);

// -------------------------------------------------------------------------
// Topology P6: Cross-Agent Handoff / Reference
// -------------------------------------------------------------------------
const p6Msg = {
  chat: { type: 'supergroup', id: -100555 },
  text: '@doctor what is the clinical risk of these numbers?',
  reply_to_message: { from: { id: HEALTH_ANALYST_BOT.id } },
};
const p6ForDoctor = resolveGroupAddressing(p6Msg, DOCTOR_BOT, { role: 'doctor' });
const p6ForAnalyst = resolveGroupAddressing(p6Msg, HEALTH_ANALYST_BOT, { role: 'health_analyst' });
check('P6: Cross-agent handoff addresses Doctor despite quoting Analyst', p6ForDoctor.addressed === true && p6ForDoctor.roleId === 'doctor');
check('P6: Quoted Analyst stays quiet during handoff', p6ForAnalyst.addressed === false);

// -------------------------------------------------------------------------
// Topology P8: Council Multi-Turn Follow-Up
// -------------------------------------------------------------------------
const councilChatId = -100777;
const tc0 = 2000000;
recordActiveThread(councilChatId, { isCouncil: true, botId: MASTER_BOT.id, timestamp: tc0 });

const p8Msg = {
  chat: { type: 'supergroup', id: councilChatId },
  text: 'How long would this dietary protocol take to show results?',
};
const p8ForMaster = resolveGroupAddressing(p8Msg, MASTER_BOT, { isMaster: true, now: tc0 + 45000 });
const p8ForDoctor = resolveGroupAddressing(p8Msg, DOCTOR_BOT, { role: 'doctor', now: tc0 + 45000 });

check('P8: Follow-up on Council turn addresses Master as Council Coordinator', p8ForMaster.addressed === true && p8ForMaster.isBroadcast === true && p8ForMaster.isContinuous === true);
check('P8: Specialists stay silent on Council multi-turn follow-up', p8ForDoctor.addressed === false);

// -------------------------------------------------------------------------
// Topology P9 & P10: Thread TTL Expiry and Reset
// -------------------------------------------------------------------------
// 121s after last activity (> 120s TTL)
const expiredMsg = {
  chat: { type: 'supergroup', id: threadChatId },
  text: 'Thanks everyone for the help!',
};
const expForPlanner = resolveGroupAddressing(expiredMsg, TEST_PLANNER_BOT, { role: 'test_planner', now: t0 + 121000 });
const expForDoctor = resolveGroupAddressing(expiredMsg, DOCTOR_BOT, { role: 'doctor', now: t0 + 121000 });
check('P9: Active thread expires after 120s TTL (Test Planner silent)', expForPlanner.addressed === false);
check('P9: Active thread expires after 120s TTL (Doctor silent)', expForDoctor.addressed === false);

// Reset via clearActiveThread
recordActiveThread(threadChatId, { roleId: 'test_planner', botId: TEST_PLANNER_BOT.id, timestamp: t0 });
clearActiveThread(threadChatId);
const resetPlanner = resolveGroupAddressing(p3Msg, TEST_PLANNER_BOT, { role: 'test_planner', now: t0 + 5000 });
check('P10: Clear active thread ensures bot stays silent on reset', resetPlanner.addressed === false);

console.log(`\n${passed} pass, ${failed} fail`);
process.exit(failed === 0 ? 0 : 1);
