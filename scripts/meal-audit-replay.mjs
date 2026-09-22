#!/usr/bin/env node
// meal-audit-replay.mjs — P4.5 QA replay isolation
//
// Runs the live-site journey (or a proof harness) while guaranteeing the
// system under test never sees bundle expectation files:
//   expected.json, meal_result.json
//
// Physical hide: expectation files are moved to a private holdout for the
// duration of the run, then restored. Defense-in-depth: qa-runner.mjs also
// refuses to read those basenames when MEAL_AUDIT_ISOLATION=1.
//
// Usage:
//   # Hidden-bundle isolation proof (no network / no Playwright required)
//   node scripts/meal-audit-replay.mjs --prove
//
//   # Real isolated journey replay, then score against restored expectations
//   node scripts/meal-audit-replay.mjs --bundle=artifacts/meal_audits/Meal-X-01 \
//     [--url=https://…] [--skip-compare] [--actual=path/to/actual.json]
//
// Exit: 0=ok  1=journey/compare fail  3=usage/config  4=isolation violated

import fs from 'fs';
import path from 'path';
import os from 'os';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const FORBIDDEN_BASENAMES = new Set(['expected.json', 'meal_result.json']);

function parseArgs(argv) {
  const o = {
    prove: false,
    bundle: null,
    url: null,
    actual: null,
    skipCompare: false,
    skipJourney: false,
    help: false,
  };
  for (const arg of argv) {
    if (arg === '--prove') o.prove = true;
    else if (arg.startsWith('--bundle=')) o.bundle = arg.slice('--bundle='.length).trim();
    else if (arg.startsWith('--url=')) o.url = arg.slice('--url='.length).trim();
    else if (arg.startsWith('--actual=')) o.actual = arg.slice('--actual='.length).trim();
    else if (arg === '--skip-compare') o.skipCompare = true;
    else if (arg === '--skip-journey') o.skipJourney = true;
    else if (arg === '--help' || arg === '-h') o.help = true;
    else {
      console.error(`Unknown argument: ${arg}`);
      process.exit(3);
    }
  }
  return o;
}

function usage() {
  console.log(`Usage:
  node scripts/meal-audit-replay.mjs --prove
  node scripts/meal-audit-replay.mjs --bundle=artifacts/meal_audits/Meal-X-01 \\
    [--url=…] [--actual=…] [--skip-compare] [--skip-journey]

Isolation: expected.json + meal_result.json are hidden for the whole journey.
Exit: 0 ok, 1 journey/compare fail, 3 usage, 4 isolation violated`);
}

function listExpectationFiles(bundleDir) {
  const found = [];
  for (const name of FORBIDDEN_BASENAMES) {
    const p = path.join(bundleDir, name);
    if (fs.existsSync(p)) found.push(p);
  }
  return found;
}

function hideExpectations(bundleDir) {
  const holdRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'meal-audit-hold-'));
  const manifest = [];
  for (const file of listExpectationFiles(bundleDir)) {
    const base = path.basename(file);
    const dest = path.join(holdRoot, base);
    fs.renameSync(file, dest);
    manifest.push({ original: file, held: dest });
  }
  return { holdRoot, manifest };
}

function restoreExpectations(hold) {
  for (const entry of hold.manifest) {
    if (fs.existsSync(entry.held)) {
      fs.mkdirSync(path.dirname(entry.original), { recursive: true });
      fs.renameSync(entry.held, entry.original);
    }
  }
  try {
    fs.rmSync(hold.holdRoot, { recursive: true, force: true });
  } catch { /* best effort */ }
}

function expectationsReadable(bundleDir) {
  return listExpectationFiles(bundleDir);
}

function runChild(command, args, env) {
  const r = spawnSync(command, args, {
    stdio: 'inherit',
    env: { ...process.env, ...env },
    cwd: process.cwd(),
  });
  return r.status == null ? 1 : r.status;
}

function proveIsolation() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'meal-audit-prove-'));
  const bundleDir = path.join(root, 'Meal-Isolation-Proof-01');
  fs.mkdirSync(bundleDir, { recursive: true });

  const sentinelExpected = { id: 'SENTINEL-EXPECTED', secret: 'must-not-be-read' };
  const sentinelResult = { schemaVersion: '2.1.0', sentinel: 'must-not-be-read' };
  fs.writeFileSync(path.join(bundleDir, 'expected.json'), JSON.stringify(sentinelExpected));
  fs.writeFileSync(path.join(bundleDir, 'meal_result.json'), JSON.stringify(sentinelResult));
  // Non-expectation files stay visible (Instruction.md, photos refs, etc.)
  fs.writeFileSync(path.join(bundleDir, 'Instruction.md'), 'replay instructions only\n');

  console.log('[Isolation] Proof bundle:', bundleDir);
  const before = expectationsReadable(bundleDir);
  if (before.length !== 2) {
    console.error('[Isolation] FAIL: setup should expose 2 expectation files, got', before.length);
    process.exit(4);
  }

  const hold = hideExpectations(bundleDir);
  const during = expectationsReadable(bundleDir);
  if (during.length !== 0) {
    restoreExpectations(hold);
    console.error('[Isolation] FAIL: expectation files still readable during journey:', during);
    fs.rmSync(root, { recursive: true, force: true });
    process.exit(4);
  }
  console.log('[Isolation] Hidden-bundle: expected.json + meal_result.json unreadable');

  // Child process must also fail to read them (hidden bundle, no special FS hooks).
  const probe = spawnSync(process.execPath, ['-e', `
    const fs = require('fs');
    const dir = process.argv[1];
    let leaked = [];
    for (const name of ['expected.json', 'meal_result.json']) {
      try { fs.readFileSync(require('path').join(dir, name)); leaked.push(name); } catch {}
    }
    // Instruction.md remains available for pure replay prompts
    let instructionOk = false;
    try { fs.readFileSync(require('path').join(dir, 'Instruction.md'), 'utf8'); instructionOk = true; } catch {}
    if (leaked.length) { console.error('LEAKED', leaked.join(',')); process.exit(1); }
    if (!instructionOk) { console.error('Instruction.md should remain readable'); process.exit(2); }
    console.log('CHILD_OK no_expectation_reads');
  `, bundleDir], { encoding: 'utf8' });

  if (probe.status !== 0) {
    restoreExpectations(hold);
    console.error('[Isolation] FAIL: child read expectations during hidden run');
    console.error(probe.stderr || probe.stdout || '');
    fs.rmSync(root, { recursive: true, force: true });
    process.exit(4);
  }
  console.log('[Isolation] Child journey process confirmed blind to expectations');

  restoreExpectations(hold);
  const after = expectationsReadable(bundleDir);
  if (after.length !== 2) {
    console.error('[Isolation] FAIL: restore failed, readable after:', after);
    fs.rmSync(root, { recursive: true, force: true });
    process.exit(4);
  }
  const exp = JSON.parse(fs.readFileSync(path.join(bundleDir, 'expected.json'), 'utf8'));
  if (exp.secret !== sentinelExpected.secret) {
    console.error('[Isolation] FAIL: restored expected.json corrupted');
    fs.rmSync(root, { recursive: true, force: true });
    process.exit(4);
  }
  console.log('[Isolation] Restored expectations; post-run compare can score');

  fs.rmSync(root, { recursive: true, force: true });
  console.log('[Isolation] PROVE PASS — hidden-bundle run');
  process.exit(0);
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    usage();
    process.exit(0);
  }

  if (options.prove) {
    proveIsolation();
    return;
  }

  if (!options.bundle) {
    usage();
    process.exit(3);
  }

  const bundleDir = path.resolve(options.bundle);
  if (!fs.existsSync(bundleDir) || !fs.statSync(bundleDir).isDirectory()) {
    console.error(`Bundle not found: ${bundleDir}`);
    process.exit(3);
  }

  const expectedBefore = listExpectationFiles(bundleDir);
  if (expectedBefore.length === 0 && !options.skipCompare) {
    console.error(`Bundle has no expected.json/meal_result.json: ${bundleDir}`);
    process.exit(3);
  }

  // --- Hide expectations for the entire journey ---
  const hold = hideExpectations(bundleDir);
  console.log(`[Replay] Hid ${hold.manifest.length} expectation file(s) during journey`);
  if (expectationsReadable(bundleDir).length !== 0) {
    restoreExpectations(hold);
    console.error('[Replay] FAIL: expectations still visible after hide');
    process.exit(4);
  }

  const isolationEnv = {
    MEAL_AUDIT_ISOLATION: '1',
    MEAL_AUDIT_BUNDLE_DIR: bundleDir,
  };

  let journeyStatus = 0;
  try {
    if (!options.skipJourney) {
      const args = ['scripts/qa-runner.mjs', '--journey=meal'];
      if (options.url) args.push(`--url=${options.url}`);
      console.log('[Replay] Starting isolated journey:', args.join(' '));
      journeyStatus = runChild(process.execPath, args, isolationEnv);
      if (journeyStatus !== 0) {
        console.error(`[Replay] Journey exited ${journeyStatus}`);
      }
    } else {
      console.log('[Replay] --skip-journey (isolation hold only)');
    }

    // Re-assert isolation was intact for the whole child lifetime
    const during = expectationsReadable(bundleDir);
    if (during.length !== 0) {
      console.error('[Replay] FAIL: expectations appeared during journey:', during);
      process.exitCode = 4;
      return;
    }
  } finally {
    restoreExpectations(hold);
    console.log('[Replay] Expectations restored for scoring');
  }

  if (process.exitCode === 4) return;

  if (journeyStatus !== 0) {
    process.exitCode = 1;
    return;
  }

  if (options.skipCompare) {
    console.log('[Replay] Done (compare skipped)');
    process.exit(0);
  }

  // Score AFTER journey with restored expectations (compare.mjs is the only reader).
  const actualPath = options.actual ||
    path.join(process.cwd(), 'qa-evidence', 'actual_meal.json');
  if (!fs.existsSync(actualPath)) {
    console.error(`[Replay] Actual evidence not found: ${actualPath} (pass --actual= or capture during journey)`);
    process.exitCode = 1;
    return;
  }

  const cmp = runChild(process.execPath, [
    'scripts/meal-audit-compare.mjs',
    `--bundle=${bundleDir}`,
    `--actual=${actualPath}`,
    '--write',
  ], {});
  process.exit(cmp === 0 ? 0 : cmp === 2 ? 2 : 1);
}

const isDirectCli = Boolean(
  process.argv[1] &&
  (import.meta.url === `file://${process.argv[1]}` ||
    (() => {
      try {
        return fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
      } catch {
        return false;
      }
    })())
);

if (isDirectCli) {
  try {
    main();
  } catch (err) {
    console.error('[MealAuditReplay] Fatal:', err);
    process.exit(3);
  }
}

export { hideExpectations, restoreExpectations, listExpectationFiles, FORBIDDEN_BASENAMES };
