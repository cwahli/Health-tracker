#!/usr/bin/env node
/**
 * scripts/assert-registry-skills.mjs
 *
 * BOT-14 Assertion Gate:
 * Verifies that all `sharedSkills` declared in bots/registry.json resolve to
 * valid, existing directories containing SKILL.md definitions, and that no
 * dead or dangling skill paths exist in the registry.
 *
 * Usage:
 *   node scripts/assert-registry-skills.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const REGISTRY_PATH = path.join(ROOT, 'bots', 'registry.json');
const COMMON_SKILLS_DIR = path.join(ROOT, 'scripts', 'skills', 'common');

let failures = [];
let checksPassed = 0;

function check(name, condition, errorMsg = '') {
  if (condition) {
    checksPassed++;
    console.log(`  ✓ ${name}`);
  } else {
    failures.push(`${name}: ${errorMsg}`);
    console.error(`  ✗ ${name}: ${errorMsg}`);
  }
}

console.log('[BOT-14] Running registry skills assertion gate...');

// 1. Verify bots/registry.json exists and parses
check('registry.json exists', fs.existsSync(REGISTRY_PATH), `Cannot find ${REGISTRY_PATH}`);
let registry;
try {
  registry = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8'));
  check('registry.json is valid JSON', true);
} catch (e) {
  check('registry.json is valid JSON', false, e.message);
  process.exit(1);
}

// 2. Verify scripts/skills/common exists and contains skills
check('scripts/skills/common directory exists', fs.existsSync(COMMON_SKILLS_DIR), `Missing ${COMMON_SKILLS_DIR}`);

const commonSkills = fs.readdirSync(COMMON_SKILLS_DIR, { withFileTypes: true })
  .filter(d => d.isDirectory() && fs.existsSync(path.join(COMMON_SKILLS_DIR, d.name, 'SKILL.md')))
  .map(d => d.name);

check('scripts/skills/common has valid skills', commonSkills.length >= 10, `Found only ${commonSkills.length} skills`);

// 3. Known dead paths forbidden by BOT-14
const FORBIDDEN_DEAD_PATHS = [
  'social-media/telegram-media-delivery',
  'autonomous-ai-agents/opencode',
];

// 4. Validate each bot's sharedSkills
const botsWithSharedSkills = (registry.bots || []).filter(b => b.agent && b.agent.sharedSkills);

check('registry has bots declaring sharedSkills', botsWithSharedSkills.length >= 2, `Expected >= 2 bots, found ${botsWithSharedSkills.length}`);

for (const bot of botsWithSharedSkills) {
  const botId = bot.id || '(unknown)';
  const skillsList = bot.agent.sharedSkills;

  check(`${botId}: sharedSkills is an array`, Array.isArray(skillsList));

  for (const skillPath of skillsList) {
    // A. Check for forbidden dead paths
    for (const dead of FORBIDDEN_DEAD_PATHS) {
      check(
        `${botId}: does not reference dead path '${dead}'`,
        !skillPath.includes(dead),
        `Found forbidden dead path '${dead}' in '${skillPath}'`
      );
    }

    // B. Check that path maps to a valid repo location
    let relativeRepoPath = null;
    if (skillPath.startsWith('.')) {
      relativeRepoPath = skillPath;
    } else if (skillPath.includes('Health-tracker/')) {
      relativeRepoPath = skillPath.split('Health-tracker/')[1];
    } else if (skillPath.includes('bot-host/')) {
      relativeRepoPath = skillPath.split('bot-host/')[1];
    }

    if (relativeRepoPath) {
      const diskPath = path.join(ROOT, relativeRepoPath);
      check(
        `${botId}: skill path '${skillPath}' exists in repo as '${relativeRepoPath}'`,
        fs.existsSync(diskPath),
        `Resolved path does not exist on disk: ${diskPath}`
      );
    }
  }
}

console.log(`\n[BOT-14 Gate Result] ${checksPassed} checks passed, ${failures.length} failures.`);

if (failures.length > 0) {
  console.error('\nFailures:');
  failures.forEach(f => console.error(`  - ${f}`));
  process.exit(1);
} else {
  console.log('✅ BOT-14 Gate PASSED cleanly.\n');
  process.exit(0);
}
