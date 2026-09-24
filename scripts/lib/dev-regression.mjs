#!/usr/bin/env node
/**
 * scripts/lib/dev-regression.mjs
 *
 * Pre-dispatch / pre-commit regression test runner and blast-radius gate.
 * Implements AGENTS.md Rule L1 (Blast Radius) and Rule 0.3 (Named domain regression suites).
 *
 * Prevents coding bots and developers from pushing broken journeys or untested
 * modifications to main.
 *
 * Usage:
 *   node scripts/lib/dev-regression.mjs [--dir=/path/to/worktree] [--files=a,b,c] [--plan] [--skip-smoke]
 */

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';

export const JOB_LIFECYCLE_FILES = [
  'src/jobs/JobStore.ts',
  'src/jobs/SupabaseJobSync.ts',
  'src/jobs/BackendJobSync.ts',
  'src/jobs/JobQueueRunner.ts',
  'src/App.tsx',
  'src/components/LogChat.tsx',
  'src/components/TaskPlaceholderCard.tsx',
  'src/components/FoodHistoryTab.tsx',
];

export const CONTRACT_TEST_REQUIRED = 'src/jobs/__tests__/JobSession.contract.test.ts';

/**
 * Classifies modified files and determines:
 * 1. Any blast-radius rule violations (AGENTS.md Rule L1).
 * 2. Which named regression suites must be executed (AGENTS.md Rule 0.3 / DOMAIN_REGRESSION_MAP.md).
 *
 * @param {string[]} files List of file paths relative to repository root.
 * @returns {{ violations: string[], suites: Array<{ id: string, name: string, command: string, args: string[] }> }}
 */
export function classifyModifiedFiles(files) {
  const normFiles = files.map(f => f.trim().replace(/^\.\//, '')).filter(Boolean);
  const violations = [];
  const suitesMap = new Map();

  // 1. Blast Radius Check (Rule L1)
  const touchedJobLifecycle = normFiles.filter(f => JOB_LIFECYCLE_FILES.includes(f));
  const hasContractTest = normFiles.includes(CONTRACT_TEST_REQUIRED);

  if (touchedJobLifecycle.length > 0 && !hasContractTest) {
    violations.push(
      `Rule L1 (Blast Radius) violation: Job-lifecycle file(s) [${touchedJobLifecycle.join(', ')}] modified without accompanying '${CONTRACT_TEST_REQUIRED}' in the same change.`
    );
  }

  // 2. UI & Component Shell Smoke (Playwright)
  const touchesUI = normFiles.some(f =>
    f.startsWith('src/components/') ||
    f === 'src/App.tsx' ||
    f === 'src/AppShell.tsx' ||
    f === 'src/AppTabs.tsx' ||
    f === 'src/index.css' ||
    f.startsWith('prototype/tests/')
  );
  if (touchesUI) {
    suitesMap.set('shell-smoke', {
      id: 'shell-smoke',
      name: 'Playwright Shell Smoke (key-journeys, dialogs, auth, staged tray, lineage)',
      command: 'node',
      args: ['scripts/assert-shell-smoke.mjs']
    });
  }

  // 3. Job Session & Sync Regression
  const touchesSyncOrJobs = normFiles.some(f =>
    f.startsWith('src/jobs/') ||
    f === 'src/utils/syncUtils.ts' ||
    f === 'src/utils/firestoreUtils.ts' ||
    f === 'src/utils/foodLogDedupe.ts' ||
    f === 'src/utils/storageUtils.ts'
  );
  if (touchesSyncOrJobs) {
    suitesMap.set('sync-regression', {
      id: 'sync-regression',
      name: 'Sync & Job Session Regression',
      command: 'npx',
      args: [
        'vitest',
        'run',
        'src/jobs/__tests__/JobSession.contract.test.ts',
        'src/jobs/__tests__/JobStore.test.ts',
        'src/utils/syncUtils.regression.test.ts',
        'src/utils/foodLogDedupe.test.ts'
      ]
    });
  }

  // 4. Food Calculation & Pipeline
  const touchesFoodCalc = normFiles.some(f =>
    f.includes('server_dish_finalize.ts') ||
    f.includes('server_brand_match.ts') ||
    f.includes('server_derivation.ts') ||
    f.includes('server_dish_classify.ts') ||
    f.includes('server_vision_scout.ts') ||
    f.includes('server_portion_clarify.ts') ||
    f.startsWith('src/server/food/') ||
    f.startsWith('src/mealBuild/')
  );
  if (touchesFoodCalc) {
    suitesMap.set('food-calc', {
      id: 'food-calc',
      name: 'Food Calc & Pipeline Suite',
      command: 'npx',
      args: [
        'vitest',
        'run',
        'server_derivation.test.ts',
        'server_dish_classify.test.ts',
        'server_brand_match.test.ts',
        'server_dish_finalize.test.ts',
        'server_vision_scout.test.ts',
        'server_portion_clarify.test.ts'
      ]
    });
  }

  // 5. Biomarkers
  const touchesBiomarkers = normFiles.some(f =>
    f.includes('biomarker') ||
    f === 'src/utils/dataSanitize.ts' ||
    f.startsWith('tests/Golden_biomarker/')
  );
  if (touchesBiomarkers) {
    suitesMap.set('biomarkers', {
      id: 'biomarkers',
      name: 'Biomarkers Lifecycle & Sanitization Suite',
      command: 'npx',
      args: [
        'vitest',
        'run',
        'src/utils/biomarkerIdentity.test.ts',
        'src/utils/biomarkerSanitize.test.ts',
        'src/utils/dataSanitize.test.ts',
        'src/utils/biomarkerLifecycle.test.ts'
      ]
    });
  }

  // 6. Receptionist
  const touchesReceptionist = normFiles.some(f =>
    f.startsWith('src/server/receptionist/') ||
    f.includes('ReceptionistCard')
  );
  if (touchesReceptionist) {
    suitesMap.set('receptionist', {
      id: 'receptionist',
      name: 'Receptionist Handoff Contract Suite',
      command: 'npx',
      args: [
        'vitest',
        'run',
        'src/server/receptionist/handoffContract.test.ts',
        'src/components/chat-cards/ReceptionistCard.i18n.test.tsx'
      ]
    });
  }

  return {
    violations,
    suites: Array.from(suitesMap.values())
  };
}

/**
 * Gets modified files in a directory using git status --porcelain.
 * @param {string} cwd
 * @returns {string[]}
 */
export function getGitModifiedFiles(cwd) {
  try {
    const res = spawnSync('git', ['status', '--porcelain'], { cwd, encoding: 'utf-8' });
    if (res.status !== 0 || !res.stdout) return [];
    return res.stdout
      .split('\n')
      .map(line => line.trim())
      .filter(line => line && !line.includes('src/git-version.generated.ts'))
      .map(line => {
        // Line format: " M path/to/file" or "?? path/to/file" or "M  path/to/file"
        const parts = line.split(/\s+/);
        return parts.slice(1).join(' ');
      })
      .filter(Boolean);
  } catch (err) {
    return [];
  }
}

/**
 * Executes the regression gate.
 * @param {object} options
 * @param {string} [options.cwd]
 * @param {string[]} [options.files]
 * @param {boolean} [options.skipSmoke]
 * @returns {{ success: boolean, violations: string[], results: Array<{ id: string, name: string, status: 'pass'|'fail', output?: string }> }}
 */
export function runDevRegression({ cwd = process.cwd(), files, skipSmoke = false } = {}) {
  const targetFiles = files && files.length > 0 ? files : getGitModifiedFiles(cwd);

  const { violations, suites } = classifyModifiedFiles(targetFiles);

  if (violations.length > 0) {
    return {
      success: false,
      violations,
      results: []
    };
  }

  const results = [];
  let allSuccess = true;

  for (const suite of suites) {
    if (skipSmoke && suite.id === 'shell-smoke') {
      results.push({ id: suite.id, name: suite.name, status: 'pass', output: 'Skipped via --skip-smoke' });
      continue;
    }

    console.log(`[DevRegression] Running ${suite.name}...`);
    const proc = spawnSync(suite.command, suite.args, {
      cwd,
      stdio: 'pipe',
      encoding: 'utf-8',
      env: { ...process.env }
    });

    if (proc.status !== 0) {
      allSuccess = false;
      const combinedOutput = `${proc.stdout || ''}\n${proc.stderr || ''}`.trim();
      results.push({
        id: suite.id,
        name: suite.name,
        status: 'fail',
        output: combinedOutput
      });
      break; // Stop at first failed regression suite
    } else {
      results.push({
        id: suite.id,
        name: suite.name,
        status: 'pass'
      });
    }
  }

  return {
    success: allSuccess,
    violations: [],
    results
  };
}

// CLI Execution
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  let cwd = process.cwd();
  let filesArg = null;
  let isPlan = false;
  let skipSmoke = false;

  for (const arg of args) {
    if (arg.startsWith('--dir=')) {
      cwd = path.resolve(arg.slice(6));
    } else if (arg.startsWith('--files=')) {
      filesArg = arg.slice(8).split(',').map(s => s.trim()).filter(Boolean);
    } else if (arg === '--plan') {
      isPlan = true;
    } else if (arg === '--skip-smoke') {
      skipSmoke = true;
    }
  }

  const filesToCheck = filesArg || getGitModifiedFiles(cwd);

  if (isPlan) {
    const classification = classifyModifiedFiles(filesToCheck);
    console.log(JSON.stringify({
      cwd,
      files: filesToCheck,
      violations: classification.violations,
      suites: classification.suites
    }, null, 2));
    process.exit(classification.violations.length > 0 ? 1 : 0);
  }

  if (filesToCheck.length === 0) {
    console.log('[DevRegression] No modified files detected. 0 regression suites required.');
    process.exit(0);
  }

  console.log(`[DevRegression] Evaluating ${filesToCheck.length} modified file(s)...`);
  const outcome = runDevRegression({ cwd, files: filesToCheck, skipSmoke });

  if (outcome.violations.length > 0) {
    console.error('❌ [DevRegression] BLAST RADIUS VIOLATION:');
    for (const v of outcome.violations) {
      console.error(`  • ${v}`);
    }
    process.exit(1);
  }

  for (const r of outcome.results) {
    if (r.status === 'pass') {
      console.log(`✅ [DevRegression] PASS: ${r.name}`);
    } else {
      console.error(`❌ [DevRegression] FAIL: ${r.name}`);
      if (r.output) {
        console.error(r.output);
      }
    }
  }

  if (!outcome.success) {
    console.error('[DevRegression] Regression tests failed. Do not commit or push.');
    process.exit(1);
  }

  console.log('[DevRegression] All required regression suites passed cleanly.');
  process.exit(0);
}
