// R-14.1 card 1 sensor: the turn path in scripts/bot-host.mjs must compose the
// prompt for EVERY project, so an assigned role on project 1 reaches the model.
// assert-external-projects.test.mjs calls composeExternalPrompt directly, so it
// stayed green while bot-host skipped it for non-external projects.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  KNOWN_PROJECTS,
  composeExternalPrompt,
  getChatRole,
  resetChatRole,
  switchChatProject,
  switchChatRole,
} from './lib/project-registry.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BOT_HOST = path.join(HERE, 'bot-host.mjs');
const testChatId = 'test_chat_role_wiring';

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

console.log('assert-bot-role-wiring:');

const src = fs.readFileSync(BOT_HOST, 'utf8');

// 1. Wiring: the runner composes the prompt for every project type.
const composeCalls = src.match(/composeExternalPrompt\(\{/g) || [];
check('bot-host composes the prompt on the turn path', composeCalls.length >= 1);
check(
  'the composed prompt is not gated on project type',
  !/finalPrompt\s*=\s*activeProject\.type\s*===/.test(src),
);
check(
  'no project-type ternary bypasses the compose call',
  !/activeProject\.type\s*===\s*'external'\s*\n?\s*\?\s*composeExternalPrompt/.test(src),
);

// 2. Every consumer of the composed prompt uses the composed value. The compose
// call itself reads promptWithMedia, so it is removed before counting.
const outsideCompose = src.replace(/composeExternalPrompt\(\{[^}]*\}\)/g, '');
const promptConsumers = (outsideCompose.match(/prompt:\s*promptWithMedia/g) || []).length;
check('the runner is never handed the uncomposed prompt', promptConsumers === 0);
check('the composed prompt reaches every runner call site', (src.match(/prompt:\s*finalPrompt/g) || []).length >= 4);

// 3. Behavior on project 1: one role file, switching replaces it.
const firstLine = (file) => file.split('\n').map((l) => l.trim()).find((l) => l.length > 0);

switchChatProject(testChatId, 'health-tracker');
switchChatRole(testChatId, 'ui');
check('project 1 role resolves', getChatRole(testChatId) === 'frontend_ui');

const uiPrompt = composeExternalPrompt({
  chatId: testChatId,
  prompt: 'Reply with only the first line of your role instructions.',
  activeProject: KNOWN_PROJECTS['health-tracker'],
  activeRole: getChatRole(testChatId),
});
const uiFirstLine = firstLine(KNOWN_PROJECTS['health-tracker'].roles.find((r) => r.id === 'frontend_ui').instructions);
check('project 1 prompt carries the role first line', uiPrompt.includes(uiFirstLine));
check('project 1 prompt keeps the user request last', uiPrompt.trimEnd().endsWith('Reply with only the first line of your role instructions.'));

switchChatRole(testChatId, 'ops');
check('switching role replaces the role', getChatRole(testChatId) === 'reliability_ops');
const opsPrompt = composeExternalPrompt({
  chatId: testChatId,
  prompt: 'ping',
  activeProject: KNOWN_PROJECTS['health-tracker'],
  activeRole: getChatRole(testChatId),
});
const opsFirstLine = firstLine(KNOWN_PROJECTS['health-tracker'].roles.find((r) => r.id === 'reliability_ops').instructions);
check('project 1 prompt carries only the new role', opsPrompt.includes(opsFirstLine) && !opsPrompt.includes(uiFirstLine));

// 4. No role means the prompt is untouched, so project 1 without /role is unchanged.
resetChatRole(testChatId);
const plain = composeExternalPrompt({
  chatId: testChatId,
  prompt: 'ping',
  activeProject: KNOWN_PROJECTS['health-tracker'],
  activeRole: null,
});
check('no role leaves the prompt untouched', plain === 'ping');

console.log(`\n${passed} pass, ${failed} fail`);
process.exit(failed === 0 ? 0 : 1);
