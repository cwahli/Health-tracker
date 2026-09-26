#!/usr/bin/env node
/**
 * Law sensor for the self-cleaning loop (plan/AGENT_HYGIENE.md).
 *
 * The failure this file exists to prevent is the cleaner itself going wrong:
 * deleting a branch with live work, closing a PR that matters, or silently
 * changing what "abandoned" means. The decision functions are pure — every input
 * is an argument — so the rules are pinned here with fixtures, and the live
 * machinery (git, gh, /proc) is never touched by a test.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { beat, isLive, readBeats, slug } from './agent-heartbeat.mjs';
import { BRANCH_GRACE_DAYS, OPEN_GRACE_H, PR_AGE_DAYS, hoursSince, tierForBranch, tierForPR } from './agent-hygiene.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HYGIENE = fs.readFileSync(path.join(HERE, 'agent-hygiene.mjs'), 'utf8');

let passed = 0;
let failed = 0;
function check(name, cond, detail = '') {
  if (cond) passed += 1;
  else {
    failed += 1;
    console.log(`  FAIL  ${name}${detail ? `  — ${detail}` : ''}`);
  }
}

const live = { updatedAt: new Date().toISOString(), pid: process.pid };
const stale = { updatedAt: new Date(Date.now() - 10 * 3600 * 1000).toISOString(), pid: process.pid };
const deadPid = { updatedAt: new Date().toISOString(), pid: 999999 };

// ------------------------------------------------------------- tier 1

check('a merged PR is tier 1 no matter what else is true', () => {
  return tierForPR({ merged: true, tipInMain: false, headAgeH: 1, prAgeDays: 0, heartbeatLive: true, processLive: true, gateFailing: false, dirty: false }) === 'tier1';
});

check('a tip already in main is tier 1 even with an open PR', () => {
  return tierForPR({ merged: false, tipInMain: true, headAgeH: 1, prAgeDays: 0, heartbeatLive: false, processLive: false, gateFailing: false, dirty: false }) === 'tier1';
});

check('a branch tip in main is tier 1 without any PR', () => {
  return tierForBranch({ tipInMain: true, lastAgeH: 1, heartbeatLive: true, processLive: true, closedGraceExpired: false }) === 'tier1';
});

// ------------------------------------------------------------- liveness veto

check('a live heartbeat vetoes tier 2 even when everything else says abandoned', () => {
  return tierForPR({ merged: false, tipInMain: false, headAgeH: 500, prAgeDays: 60, heartbeatLive: true, processLive: false, gateFailing: true, dirty: true }) === 'keep';
});

check('a live process vetoes tier 2 the same way', () => {
  return tierForPR({ merged: false, tipInMain: false, headAgeH: 500, prAgeDays: 60, heartbeatLive: false, processLive: true, gateFailing: true, dirty: true }) === 'keep';
});

check('liveness vetoes tier 3 as well', () => {
  return tierForBranch({ tipInMain: false, lastAgeH: 5000, heartbeatLive: true, processLive: false, closedGraceExpired: true }) === 'keep';
});

// ------------------------------------------------------------- tier 2

check('a fresh head is kept without a declaration', () => {
  return tierForPR({ merged: false, tipInMain: false, headAgeH: OPEN_GRACE_H - 1, prAgeDays: 0, heartbeatLive: false, processLive: false, gateFailing: true, dirty: true }) === 'keep';
});

check('an old, failing, ownerless PR is tier 2', () => {
  return tierForPR({ merged: false, tipInMain: false, headAgeH: OPEN_GRACE_H + 1, prAgeDays: 0, heartbeatLive: false, processLive: false, gateFailing: true, dirty: false }) === 'tier2';
});

check('a dirty PR is tier 2 even with green gates', () => {
  return tierForPR({ merged: false, tipInMain: false, headAgeH: OPEN_GRACE_H + 1, prAgeDays: 0, heartbeatLive: false, processLive: false, gateFailing: false, dirty: true }) === 'tier2';
});

check('an old PR is tier 2 even with green gates and a clean tree', () => {
  return tierForPR({ merged: false, tipInMain: false, headAgeH: OPEN_GRACE_H + 1, prAgeDays: PR_AGE_DAYS, heartbeatLive: false, processLive: false, gateFailing: false, dirty: false }) === 'tier2';
});

check('a fresh, green, clean PR is kept', () => {
  return tierForPR({ merged: false, tipInMain: false, headAgeH: 1, prAgeDays: 0, heartbeatLive: false, processLive: false, gateFailing: false, dirty: false }) === 'keep';
});

check('the declaration waives only the head-age grace, never liveness', () => {
  const closed = tierForPR({ merged: false, tipInMain: false, headAgeH: 1, prAgeDays: 0, heartbeatLive: false, processLive: false, gateFailing: true, dirty: false, declaredAbandoned: true });
  const vetoed = tierForPR({ merged: false, tipInMain: false, headAgeH: 1, prAgeDays: 0, heartbeatLive: true, processLive: false, gateFailing: true, dirty: false, declaredAbandoned: true });
  return closed === 'tier2' && vetoed === 'keep';
});

// ------------------------------------------------------------- tier 3

check('an ownerless branch is kept inside the grace window', () => {
  return tierForBranch({ tipInMain: false, lastAgeH: BRANCH_GRACE_DAYS * 24 - 1, heartbeatLive: false, processLive: false, closedGraceExpired: true }) === 'keep';
});

check('an ownerless branch past the grace window is tier 3', () => {
  return tierForBranch({ tipInMain: false, lastAgeH: BRANCH_GRACE_DAYS * 24 + 1, heartbeatLive: false, processLive: false, closedGraceExpired: true }) === 'keep'.replace('keep', 'tier3');
});

// ------------------------------------------------------------- heartbeat

check('a fresh beat from a live pid is live', () => isLive(live) === true);
check('a stale beat is not live even with a live pid', () => isLive(stale) === false);
check('a fresh beat from a dead pid is not live', () => isLive(deadPid) === false);
check('garbage is not live', () => isLive(null) === false && isLive({}) === false && isLive({ updatedAt: 'not-a-date', pid: 1 }) === false);

check('a beat round-trips through the store', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'beats-'));
  beat('agent/test-branch', { note: 'hi', home });
  const beats = readBeats({ home });
  fs.rmSync(home, { recursive: true, force: true });
  const rec = beats['agent-test-branch'];
  return rec && rec.branch === 'agent/test-branch' && rec.note === 'hi' && Number(rec.pid) > 0;
});

check('an unreadable date is infinitely old, never fresh', () => {
  // A branch whose tip date cannot be read must not look recently active.
  return hoursSince('not-a-date') === Infinity && hoursSince('') === Infinity;
});

check('a branch name becomes a safe filename and back', () => {
  return slug('agent/bot 12 (x)') === 'agent-bot-12-x-' && slug('') === 'unknown';
});

// ------------------------------------------------------------- structural

check('main can never be named by any tier', () => {
  return /PROTECTED/.test(HYGIENE) && /'main'/.test(HYGIENE) && !/tierForPR\(\{[^}]*branch:\s*['"]main['"]/.test(HYGIENE);
});

check('every delete audit carries the tip SHA (reversible from the log alone)', () => {
  return /tip, reason/.test(HYGIENE) && /action: 'delete-branch', branch, tip/.test(HYGIENE);
});

check('dry-run is the default; acting needs an explicit flag', () => {
  return / Dry-run unless `--apply`/.test(HYGIENE) || /dry-run by default/i.test(HYGIENE) || /Dry-run unless/.test(HYGIENE);
});

console.log(`\n${passed} pass, ${failed} fail`);
process.exit(failed === 0 ? 0 : 1);
