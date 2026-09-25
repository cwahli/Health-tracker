import fs from 'node:fs';
import path from 'node:path';
import {
  KNOWN_PROJECTS,
  resolveProjectId,
  resolveRoleId,
  switchChatProject,
  getChatProject,
  switchChatRole,
  getChatRole,
  resetChatRole,
  getProjectSoul,
  getRoleInstructions,
  checkRoleDetails,
  composeExternalPrompt,
  getProjectRoles,
  addProjectRole,
  removeProjectRole,
} from './lib/project-registry.mjs';
import { getCouncilStatus } from './council-runner.mjs';
import { generateSyncManifest, getSyncStatus } from './lib/gdrive-bridge.mjs';

let passed = 0;
let failed = 0;

function check(name, cond) {
  if (cond) {
    console.log(`  PASS  ${name}`);
    passed++;
  } else {
    console.error(`  FAIL  ${name}`);
    failed++;
  }
}

console.log('assert-external-projects:');

// 1. Project Resolution
check('resolves "external 1"', resolveProjectId('external 1') === 'external-1');
check('resolves "1"', resolveProjectId('1') === 'health-tracker');
check('resolves "project 1"', resolveProjectId('project 1') === 'health-tracker');
check('resolves "external 2"', resolveProjectId('external 2') === 'external-2');
check('resolves "2"', resolveProjectId('2') === 'external-2');
check('resolves "pip"', resolveProjectId('pip') === 'external-2');
check('resolves "health-tracker"', resolveProjectId('health-tracker') === 'health-tracker');
check('unknown project returns null', resolveProjectId('unknown-xyz') === null);

// 2. Role Resolution (Universal Across Projects)
check('resolves role "legal"', resolveRoleId('legal') === 'legal_policy');
check('resolves role "accuracy"', resolveRoleId('accuracy') === 'accuracy_review');
check('resolves role "sim"', resolveRoleId('sim') === 'manager_simulation');
check('resolves role "case"', resolveRoleId('case') === 'case_review');
check('resolves role "arb"', resolveRoleId('arb') === 'arbitrator');
check('resolves role "builder"', resolveRoleId('builder') === 'final_case_builder');
check('resolves role "arch"', resolveRoleId('arch', 'health-tracker') === 'lead_architect');
check('resolves role "ui"', resolveRoleId('ui', 'health-tracker') === 'frontend_ui');
check('resolves role "backend"', resolveRoleId('backend', 'health-tracker') === 'data_backend');
check('resolves role "qa"', resolveRoleId('qa', 'health-tracker') === 'qa_audit');
check('resolves role "ops"', resolveRoleId('ops', 'health-tracker') === 'reliability_ops');

// 3. Role Inspection & Checking (Instruction Assignment)
const uiDetails = checkRoleDetails('health-tracker', 'ui');
check('checkRoleDetails finds UI role', uiDetails && uiDetails.roleId === 'frontend_ui');
check('checkRoleDetails assigns UI instructions', uiDetails && uiDetails.instructions.includes('React 19 UI'));
const legalDetails = checkRoleDetails('external-2', 'legal');
check('checkRoleDetails finds Legal role', legalDetails && legalDetails.roleId === 'legal_policy');
check('checkRoleDetails assigns Legal instructions', legalDetails && legalDetails.instructions.includes('Legal & Policy Agent'));

// 4. Project Switching for Chat
const testChatId = 'test_chat_9999';
const switched = switchChatProject(testChatId, 'external 1');
check('switchChatProject sets external-1', switched.id === 'external-1');
check('getChatProject returns external-1', getChatProject(testChatId).id === 'external-1');
check('workspace directory exists', fs.existsSync(switched.workspace));

// 5. Role Switching & Resetting in External Project
const role = switchChatRole(testChatId, 'legal');
check('switchChatRole returns legal_policy', role.id === 'legal_policy');
check('getChatRole returns legal_policy', getChatRole(testChatId) === 'legal_policy');
resetChatRole(testChatId);
check('resetChatRole clears active role', getChatRole(testChatId) === null);

// 5. Soul & Role Instructions
const soul = getProjectSoul('external-1');
check('external soul loads', soul && soul.includes('PIP Defense Council'));
check('external soul contains laws', soul && soul.includes('Receipts over rhetoric'));
const legalInst = getRoleInstructions('external-1', 'legal_policy');
check('legal role instructions load', legalInst && legalInst.includes('Legal & Policy Agent'));

// 6. External Prompt Composition
const composed = composeExternalPrompt({
  chatId: testChatId,
  prompt: 'Here is my review document',
  activeProject: KNOWN_PROJECTS['external-1'],
  activeRole: 'legal_policy',
});
check('composed prompt contains project name', composed.includes('PIP Defense'));
check('composed prompt contains sandbox rule', composed.includes('Modifying files in /root/Health-tracker or git committing to website is STRICTLY PROHIBITED'));
check('composed prompt contains active role', composed.includes('ACTIVE ROLE: legal_policy'));
check('composed prompt contains user request', composed.includes('Here is my review document'));

// 7. Council Status
const status = getCouncilStatus('external-1');
check('council status reads project', status.projectId === 'external-1');
check('council status has 6 phases', status.phases.length === 6);
check('deliverables ready', status.deliverablesReady === true);

// 8. Google Drive Bridge
const manifest = generateSyncManifest(switched.workspace);
check('sync manifest generated', Array.isArray(manifest.files) && manifest.files.length > 0);
const syncStatus = getSyncStatus(switched.workspace);
check('sync status reports folder', syncStatus.googleDriveFolder === '[External-1-PIP-Defense]');
check('sync status tracks files', syncStatus.trackedFilesCount > 0);

// 9. Universal Role Switching in Project 1 (Health-tracker)
switchChatProject(testChatId, 'health-tracker');
check('restored project to health-tracker', getChatProject(testChatId).id === 'health-tracker');
const coreRole = switchChatRole(testChatId, 'frontend');
check('switchChatRole in Project 1 returns frontend_ui', coreRole.id === 'frontend_ui');
check('getChatRole in Project 1 returns frontend_ui', getChatRole(testChatId) === 'frontend_ui');
const coreComposed = composeExternalPrompt({
  chatId: testChatId,
  prompt: 'Build the new biomarker chart component',
  activeProject: KNOWN_PROJECTS['health-tracker'],
  activeRole: 'frontend_ui',
});
check('Project 1 prompt contains active role', coreComposed.includes('ACTIVE ROLE: Frontend UI/UX Specialist'));
check('Project 1 prompt contains role instructions', coreComposed.includes('React 19 UI'));
resetChatRole(testChatId);
check('resetChatRole clears role in Project 1', getChatRole(testChatId) === null);

// 10. Dynamic Role Addition, Council Phase Scaling, and Role Removal
const addedRole = addProjectRole('external-2', {
  id: 'hr_witness',
  name: 'HR Witness & Policy Auditor',
  instructions: 'Audit compliance against employee handbook section 4.2 notice rules.',
});
check('addProjectRole adds dynamic role', addedRole.id === 'hr_witness');
const updatedRoles = getProjectRoles('external-2');
check('getProjectRoles reflects added role', updatedRoles.some((r) => r.id === 'hr_witness'));
const updatedStatus = getCouncilStatus('external-2');
check('council status phases scale dynamically to 7', updatedStatus.phases.length === 7);
const dynamicRoleDetails = checkRoleDetails('external-2', 'hr_witness');
check('checkRoleDetails finds newly added dynamic role', dynamicRoleDetails && dynamicRoleDetails.instructions.includes('section 4.2'));

// Dynamic Role Removal
const removed = removeProjectRole('external-2', 'hr_witness');
check('removeProjectRole removes dynamic role file', removed === true);
const restoredRoles = getProjectRoles('external-2');
check('getProjectRoles reflects removal', !restoredRoles.some((r) => r.id === 'hr_witness'));
const restoredStatus = getCouncilStatus('external-2');
check('council status phases scale back down to 6', restoredStatus.phases.length === 6);

console.log(`\n${passed} pass, ${failed} fail\n`);
if (failed > 0) process.exit(1);
