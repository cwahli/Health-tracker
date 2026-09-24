#!/usr/bin/env node
/**
 * scripts/assert-dev-regression.mjs
 *
 * Named assertion gate for BOT-23 pre-dispatch regression test and blast-radius rules.
 *
 * Usage:
 *   node scripts/assert-dev-regression.mjs
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  classifyModifiedFiles,
  JOB_LIFECYCLE_FILES,
  CONTRACT_TEST_REQUIRED
} from './lib/dev-regression.mjs';

console.log('── assert-dev-regression (BOT-23) ──');
let testsPassed = 0;

// Test 1: Every job-lifecycle file without contract test produces a Rule L1 blast radius violation
for (const file of JOB_LIFECYCLE_FILES) {
  const result = classifyModifiedFiles([file]);
  assert.equal(
    result.violations.length,
    1,
    `Expected Rule L1 violation for modifying job lifecycle file ${file} alone`
  );
  assert.match(
    result.violations[0],
    /Rule L1 \(Blast Radius\) violation/,
    `Expected Rule L1 mention for ${file}`
  );
  testsPassed++;
}

// Test 2: Job-lifecycle file WITH contract test passes blast radius check
{
  const result = classifyModifiedFiles([
    'src/components/LogChat.tsx',
    CONTRACT_TEST_REQUIRED
  ]);
  assert.equal(
    result.violations.length,
    0,
    'Expected 0 violations when JobSession.contract.test.ts is included'
  );
  testsPassed++;
}

// Test 3: UI component edit requires Playwright shell smoke
{
  const result = classifyModifiedFiles(['src/components/WeeklyNutritionCard.tsx']);
  const suiteIds = result.suites.map(s => s.id);
  assert.ok(
    suiteIds.includes('shell-smoke'),
    'Expected shell-smoke suite for src/components/ file'
  );
  testsPassed++;
}

// Test 4: AppTabs / AppShell / index.css edits require Playwright shell smoke
{
  const result = classifyModifiedFiles(['src/AppTabs.tsx', 'src/index.css']);
  const suiteIds = result.suites.map(s => s.id);
  assert.ok(
    suiteIds.includes('shell-smoke'),
    'Expected shell-smoke suite for AppTabs and index.css'
  );
  testsPassed++;
}

// Test 5: Food derivation edit requires food-calc suite, NOT shell smoke
{
  const result = classifyModifiedFiles(['server_dish_finalize.ts', 'server_derivation.ts']);
  const suiteIds = result.suites.map(s => s.id);
  assert.ok(
    suiteIds.includes('food-calc'),
    'Expected food-calc suite for server_dish_finalize.ts'
  );
  assert.ok(
    !suiteIds.includes('shell-smoke'),
    'Expected food-calc alone NOT to trigger shell-smoke'
  );
  testsPassed++;
}

// Test 6: Biomarker edits require biomarker suite
{
  const result = classifyModifiedFiles(['src/utils/biomarkerIdentity.ts', 'src/utils/dataSanitize.ts']);
  const suiteIds = result.suites.map(s => s.id);
  assert.ok(
    suiteIds.includes('biomarkers'),
    'Expected biomarkers suite for biomarkerIdentity'
  );
  testsPassed++;
}

// Test 7: Sync files require sync-regression suite
{
  const result = classifyModifiedFiles(['src/utils/syncUtils.ts']);
  const suiteIds = result.suites.map(s => s.id);
  assert.ok(
    suiteIds.includes('sync-regression'),
    'Expected sync-regression suite for syncUtils.ts'
  );
  testsPassed++;
}

// Test 8: Pure documentation / plan edits require 0 suites and have 0 violations
{
  const result = classifyModifiedFiles(['plan/ROADMAP.md', 'AI_HANDOVER.md', 'docs/agents/bot_work.md']);
  assert.equal(result.violations.length, 0);
  assert.equal(result.suites.length, 0);
  testsPassed++;
}

// Test 9: CLI invocation with --plan returns structured JSON and exits 0 on valid files
{
  const proc = spawnSync('node', ['scripts/lib/dev-regression.mjs', '--files=src/components/WeeklyNutritionCard.tsx', '--plan'], {
    encoding: 'utf-8'
  });
  assert.equal(proc.status, 0, 'Expected exit 0 for --plan on valid file');
  const parsed = JSON.parse(proc.stdout);
  assert.equal(parsed.violations.length, 0);
  assert.ok(parsed.suites.some(s => s.id === 'shell-smoke'));
  testsPassed++;
}

// Test 10: CLI invocation with --plan exits 1 when Rule L1 is violated
{
  const proc = spawnSync('node', ['scripts/lib/dev-regression.mjs', '--files=src/components/LogChat.tsx', '--plan'], {
    encoding: 'utf-8'
  });
  assert.equal(proc.status, 1, 'Expected exit 1 for --plan on Rule L1 violation');
  const parsed = JSON.parse(proc.stdout);
  assert.equal(parsed.violations.length, 1);
  assert.match(parsed.violations[0], /Rule L1/);
  testsPassed++;
}

console.log(`PASS assert-dev-regression: ${testsPassed}/${testsPassed} tests passed`);
process.exit(0);
