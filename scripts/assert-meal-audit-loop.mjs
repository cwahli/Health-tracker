#!/usr/bin/env node
/**
 * scripts/assert-meal-audit-loop.mjs
 *
 * Hashimoto ratchet for Phase 3 (scripts/meal-audit-loop.mjs).
 *
 * The regression this prevents: an unbounded self-healing loop. The failure
 * modes are specific and expensive, so each gets its own assertion:
 *
 *   1. UNBOUNDED RETRY. A loop that retries forever burns the free-model quota
 *      and leaves a dirty worktree. MAX_ATTEMPTS must be enforced BEFORE another
 *      attempt is spent, not after.
 *   2. SELF-VERIFICATION. A loop that verifies its own fix is marking its own
 *      homework. The re-verify must be a distinct stage from the dispatch, and a
 *      cap-exhausted card must never re-dispatch.
 *   3. STATE LOSS. artifacts/ is gitignored, so loop state kept there would reset
 *      the attempt cap on every deploy — turning the cap into a suggestion. This
 *      is why state lives under specs/.
 *   4. BUNDLED DEFECTS. One card per finding, never a bundle.
 *   5. COUNTING NON-DEFECTS. A meal with no ground truth or no live capture is
 *      not a failed attempt; counting it would let the cap retire a card that
 *      was never really tried.
 *
 * Exit 0 = pass. Offline: no network, no dispatch, no sleeps.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  MAX_ATTEMPTS,
  ESCALATION_LADDER,
  emptyState,
  recordAttempt,
  attemptsFor,
  isCapped,
  rungFor,
  runComparison,
  postPlan,
  auditIsDispatchable,
} from './meal-audit-loop.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..');

let pass = 0;
let fail = 0;
const failures = [];

function check(name, fn) {
  try {
    fn();
    pass++;
    console.log(`  ok  ${name}`);
  } catch (e) {
    fail++;
    failures.push({ name, message: e?.message || String(e) });
    console.log(`  FAIL ${name}\n       ${e?.message || e}`);
  }
}

console.log('assert-meal-audit-loop — bounded, resumable, author != verifier ratchet\n');

const K = 'meal-audit|Meal-X-01|core_nutrient_drift|protein';

/** The gate postPlan would record, without touching the store. */
function postPlanDry() {
  const r = postPlan(1, {
    bundleDir: '/tmp/meal-loop-gate/Meal-X-01',
    actualPath: '/tmp/meal-loop-gate/actual.json',
    taxonomy: 'core_nutrient_drift',
    key: 'protein',
    dryRun: true,
  });
  return r.gate || '';
}

// --- 1. the attempt cap -------------------------------------------------------

// --- the gate must be the comparator, not a generic vitest --------------------
// This is the defect the first end-to-end run exposed. The card's `criteria`
// text does reach the coder prompt, but the dispatcher resolves TICKET_GATES
// from plan.gates — and with no plan it silently falls back to
// `npx vitest run src/utils/bug*.test.ts`. A meal-audit card closed on that gate
// would be "verified" by a bug-utils test that never reads the 32-nutrient
// ledger: the loop would close cards on evidence that proves nothing.

check('postPlan makes the comparator the card gate, not a generic vitest', () => {
  const gate = postPlanDry();
  assert.match(gate, /meal-audit-compare\.mjs/,
    'the gate must be the meal comparator');
  assert.ok(!/vitest/.test(gate), 'a generic vitest gate proves nothing about meals');
});

check('the gate uses an ABSOLUTE bundle path (the coder runs in another worktree)', () => {
  const gate = postPlanDry();
  const m = gate.match(/--bundle="([^"]+)"/);
  assert.ok(m, 'gate must quote the bundle path');
  assert.ok(path.isAbsolute(m[1]), `gate path must be absolute, got ${m[1]}`);
});

check('the gate carries the actual path when one is known', () => {
  const gate = postPlanDry();
  assert.match(gate, /--actual="[^"]+"/, 'gate must name the live capture to compare against');
});

check('a plan failure blocks dispatch rather than shipping an unverifiable card', () => {
  const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'meal-audit-loop.mjs'), 'utf8');
  const planIdx = src.indexOf('postPlan(');
  const dispatchIdx = src.indexOf('dispatchCard(primary.publicN');
  assert.ok(planIdx > -1 && dispatchIdx > -1, 'both stages must exist');
  assert.ok(planIdx < dispatchIdx, 'the plan must be posted BEFORE dispatch');
  assert.match(src, /if \(!planned\.ok\)[\s\S]{0,400}?continue;/,
    'a failed plan must abort the pass instead of dispatching anyway');
});

check('verify posts the SAME gate the plan recorded', () => {
  const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'meal-audit-loop.mjs'), 'utf8');
  assert.match(src, /--command=\$\{planned\.gate\}/,
    'verify must close on the evidence the card was opened with');
});

check('MAX_ATTEMPTS is a small finite number (not unbounded)', () => {
  assert.ok(Number.isFinite(MAX_ATTEMPTS), 'MAX_ATTEMPTS must be finite');
  assert.ok(MAX_ATTEMPTS >= 1 && MAX_ATTEMPTS <= 5,
    `cap must be 1..5 to bound quota burn, got ${MAX_ATTEMPTS}`);
});

check('a fresh card is not capped', () => {
  const s = emptyState();
  assert.equal(isCapped(s, K), false);
  assert.equal(attemptsFor(s, K), 0);
});

check('the cap trips exactly at MAX_ATTEMPTS, not one attempt later', () => {
  const s = emptyState();
  for (let i = 1; i <= MAX_ATTEMPTS; i++) {
    assert.equal(isCapped(s, K), false, `must not be capped at attempt ${i}`);
    recordAttempt(s, K, { attempt: i });
  }
  assert.equal(attemptsFor(s, K), MAX_ATTEMPTS);
  assert.equal(isCapped(s, K), true, `must be capped after ${MAX_ATTEMPTS} attempts`);
});

check('the cap is per-card, not global (one bad card must not freeze the loop)', () => {
  const s = emptyState();
  for (let i = 0; i < MAX_ATTEMPTS + 2; i++) recordAttempt(s, K, { attempt: i });
  const other = 'meal-audit|Meal-Y-01|name_mismatch|dish_1';
  assert.equal(isCapped(s, K), true);
  assert.equal(isCapped(s, other), false, 'a different card must remain dispatchable');
});

check('isCapped honours a lowered cap argument', () => {
  const s = emptyState();
  recordAttempt(s, K, { attempt: 1 });
  assert.equal(isCapped(s, K, 1), true, 'an explicit cap of 1 must be honoured');
  assert.equal(isCapped(s, K, 3), false);
});

// --- 2. escalation ladder -----------------------------------------------------

check('the escalation ladder never exceeds the finite ladder length', () => {
  assert.ok(ESCALATION_LADDER.length >= 1);
  assert.equal(rungFor(1), ESCALATION_LADDER[0]);
  assert.equal(rungFor(999), ESCALATION_LADDER[ESCALATION_LADDER.length - 1],
    'an absurd attempt number must clamp, never index out of bounds');
  assert.equal(rungFor(0), ESCALATION_LADDER[0], 'attempt 0 must clamp to the first rung');
});

check('the ladder uses only free models (paid balance is depleted on this box)', () => {
  for (const rung of ESCALATION_LADDER) {
    assert.match(rung.model, /free$/, `model ${rung.model} is not a free model`);
  }
});

check('the ladder escalates reasoning depth or model across attempts', () => {
  const first = JSON.stringify(rungFor(1));
  const last = JSON.stringify(rungFor(ESCALATION_LADDER.length));
  assert.notEqual(first, last, 'the ladder must actually change rung across attempts');
});

// --- 3. state durability ------------------------------------------------------

check('loop state lives under specs/ (committed), NOT artifacts/ (gitignored)', () => {
  const statePath = path.join(REPO_ROOT, 'specs', 'meal-qa-loop', 'state.json');
  assert.ok(!statePath.includes(`${path.sep}artifacts${path.sep}`),
    'state under artifacts/ would reset the attempt cap on every deploy');
  // Confirm artifacts/ really is ignored, so this is a real constraint.
  const ignored = spawnSync('git', ['check-ignore', '-q', 'artifacts/meal_audits/x.json'],
    { cwd: REPO_ROOT, encoding: 'utf8' });
  assert.equal(ignored.status, 0, 'expected artifacts/ to be gitignored in this repo');
});

check('attempt history is append-only and survives a state round-trip', () => {
  const s = emptyState();
  recordAttempt(s, K, { attempt: 1, outcome: 'dispatched' });
  recordAttempt(s, K, { attempt: 2, outcome: 'still_failing' });
  const round = JSON.parse(JSON.stringify(s));
  assert.equal(round.cards[K].attempts, 2);
  assert.equal(round.cards[K].history.length, 2);
  assert.equal(round.cards[K].history[0].outcome, 'dispatched');
  assert.equal(round.cards[K].history[1].outcome, 'still_failing',
    'burned hypotheses must be recorded, not lost to scrollback');
});

// --- 4. non-defects must not consume the budget -------------------------------

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'meal-loop-'));

check('a bundle with no ground truth reports NO_GROUND_TRUTH, not a failure', () => {
  const d = path.join(tmp, 'no-ground-truth');
  fs.mkdirSync(d, { recursive: true });
  const r = runComparison(d, { actualPath: null, skip: false });
  assert.equal(r.verdict, 'NO_GROUND_TRUTH',
    'an unaudited bundle is not a defect and must not be scored as one');
  assert.equal((r.failures || []).length, 0);
});

check('a bundle with no live actual reports NO_ACTUAL, not a failure', () => {
  const d = path.join(tmp, 'with-ground-truth');
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'meal_result.json'), JSON.stringify({ mode: 'multi_turn_flow', passes: [{}] }));
  const r = runComparison(d, { actualPath: path.join(tmp, 'missing.json'), skip: false });
  assert.equal(r.verdict, 'NO_ACTUAL');
  assert.equal((r.failures || []).length, 0);
});

check('a bundle with a skeleton but no comparison reports NO_GROUND_TRUTH in dry-run', () => {
  // This is the exact bug the first cron run surfaced: a fetched-but-unaudited
  // bundle reported UNKNOWN, fell through to the ticket stage, and tried to file
  // a bug for a meal nobody had analysed yet.
  const d = path.join(tmp, 'skeleton-only');
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'flow_skeleton.json'), JSON.stringify({ passes: [{ _needsAudit: true }] }));
  const r = runComparison(d, { actualPath: null, skip: true });
  assert.equal(r.verdict, 'NO_GROUND_TRUTH', `expected NO_GROUND_TRUTH, got ${r.verdict}`);
  assert.equal((r.failures || []).length, 0);
});

check('an audited but uncomparred bundle reports NOT_COMPARED, never UNKNOWN', () => {
  const d = path.join(tmp, 'audited-uncompared');
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'meal_result.json'), JSON.stringify({ mode: 'multi_turn_flow', passes: [{}] }));
  const r = runComparison(d, { actualPath: null, skip: true });
  assert.equal(r.verdict, 'NOT_COMPARED', `expected NOT_COMPARED, got ${r.verdict}`);
});

check('a stale comparison.json is still honoured in dry-run', () => {
  const d = path.join(tmp, 'has-comparison');
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'meal_result.json'), JSON.stringify({ passes: [{}] }));
  fs.writeFileSync(path.join(d, 'comparison.json'),
    JSON.stringify({ verdict: 'DIVERGED', failures: [{ taxonomy: 'core_nutrient_drift', key: 'protein' }] }));
  const r = runComparison(d, { actualPath: null, skip: true });
  assert.equal(r.verdict, 'DIVERGED');
  assert.equal(r.failures.length, 1);
});

check('every non-defect verdict is routed away from the ticket stage', () => {
  const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'meal-audit-loop.mjs'), 'utf8');
  assert.match(src, /'NO_GROUND_TRUTH',\s*'NO_ACTUAL',\s*'NOT_COMPARED'/,
    'all three non-defect verdicts must be handled together before the ticket stage');
  assert.match(src, /needs_audit/);
  assert.match(src, /needs_compare/);
  // UNKNOWN must never be a verdict the loop acts on.
  assert.ok(!/verdict === 'UNKNOWN'/.test(src), "UNKNOWN must not be an actionable verdict");
});

check('NO_GROUND_TRUTH and NO_ACTUAL are distinct outcomes', () => {
  const a = path.join(tmp, 'a'); fs.mkdirSync(a, { recursive: true });
  const b = path.join(tmp, 'b'); fs.mkdirSync(b, { recursive: true });
  fs.writeFileSync(path.join(b, 'meal_result.json'), JSON.stringify({ passes: [{}] }));
  const ra = runComparison(a, { actualPath: null, skip: false }).verdict;
  const rb = runComparison(b, { actualPath: path.join(tmp, 'nope.json'), skip: false }).verdict;
  assert.notEqual(ra, rb, 'these are different pipeline stalls and must stay distinguishable');
});

// --- 5. the re-verify is a genuinely separate stage ---------------------------

check('source separates the AUTHOR (dispatch) from the VERIFIER (re-verify)', () => {
  const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'meal-audit-loop.mjs'), 'utf8');
  assert.match(src, /The AUTHOR/i, 'dispatch stage must be labelled as the author');
  assert.match(src, /RE-VERIFY/i, 'the re-verify stage must be explicit');
  assert.match(src, /never authored the fix|never the same actor|author != verifier/i,
    'the author!=verifier invariant must be stated in the code that depends on it');
});

check('source never posts verify on behalf of the coder', () => {
  const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'meal-audit-loop.mjs'), 'utf8');
  // The only verify post must be gated behind a successful independent re-compare.
  const verifyPosts = src.match(/'verify'/g) || [];
  assert.ok(verifyPosts.length >= 1, 'the loop must be able to close a card');
  assert.match(src, /'--by=qa_meal'/, 'the verify must be attributed to the QA lane, not the coder');
});

check('dispatch is skipped in dry-run and behind --no-dispatch', () => {
  const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'meal-audit-loop.mjs'), 'utf8');
  assert.match(src, /if \(o\.noDispatch \|\| o\.dryRun\)/,
    'dry-run must short-circuit before any dispatch');
});

check('the cap check happens BEFORE the dispatch decision', () => {
  const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'meal-audit-loop.mjs'), 'utf8');
  const capIdx = src.indexOf('used >= o.maxAttempts');
  const dispatchIdx = src.indexOf('const primary = dispatchable[0]');
  assert.ok(capIdx > -1 && dispatchIdx > -1, 'both stages must exist');
  assert.ok(capIdx < dispatchIdx, 'capping must be evaluated before dispatching');
});

fs.rmSync(tmp, { recursive: true, force: true });

// --- CLI smoke ----------------------------------------------------------------

check('CLI --status exits 0 and reports the state file', () => {
  const r = spawnSync('node', [path.join(REPO_ROOT, 'scripts', 'meal-audit-loop.mjs'), '--status'],
    { encoding: 'utf8', timeout: 60000 });
  assert.equal(r.status, 0, `--status must exit 0, got ${r.status}`);
  const j = JSON.parse(r.stdout);
  assert.match(j.stateFile, /specs[\\/]meal-qa-loop/);
});

check('CLI with no selection args exits 3 (usage)', () => {
  const r = spawnSync('node', [path.join(REPO_ROOT, 'scripts', 'meal-audit-loop.mjs')],
    { encoding: 'utf8', timeout: 60000 });
  assert.equal(r.status, 3);
});

check('CLI rejects a non-numeric --max-attempts', () => {
  const r = spawnSync('node', [path.join(REPO_ROOT, 'scripts', 'meal-audit-loop.mjs'),
    '--latest=1', '--max-attempts=zero', '--dry-run'], { encoding: 'utf8', timeout: 60000 });
  assert.equal(r.status, 3, `expected usage exit 3, got ${r.status}`);
});

// An audit may be partial — refusing to guess a weight is the whole point — but a
// partial audit must never start a coder. Driving meal_1790784308630 produced 14
// "failures" that were mostly the audit's own incompleteness (the salad had no
// sourceable weight, so it was omitted), and the loop was about to hand them to a
// coder as product defects. Re-verify could never go green against ground truth
// missing the keys it is scored on, so the attempt cap would burn on cards the
// audit invented itself.
check('an audit missing a CORE nutrient refuses dispatch', () => {
  const dir = path.join(tmp, 'incomplete-bundle');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'audit_payload.json'), JSON.stringify({
    schemaVersion: 2.1,
    unsourcedNutrients: ['addedSugar'],
    passes: [{ dishes: [{ dishName: 'Ham', unsourcedNutrients: ['addedSugar', 'zinc'] }] }],
  }), 'utf8');

  const j = auditIsDispatchable(dir);
  assert.equal(j.ok, false, 'a core gap must block dispatch');
  assert.ok(j.coreGaps.includes('addedSugar'), `coreGaps should name addedSugar, got ${JSON.stringify(j.coreGaps)}`);
  assert.match(j.reason, /incomplete/i);
});

check('micronutrient gaps alone do NOT block dispatch', () => {
  // The catalog is thin; a missing vitamin is normal and must not stop the loop.
  // Only the keys the comparator actually scores as core are required, or the
  // guard would refuse every bundle ever built and dispatch would be dead code.
  const dir = path.join(tmp, 'micro-gap-bundle');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'audit_payload.json'), JSON.stringify({
    schemaVersion: 2.1,
    unsourcedNutrients: ['zinc', 'selenium', 'vitaminC'],
    passes: [{ dishes: [{ dishName: 'Salad', unsourcedNutrients: ['zinc'] }] }],
  }), 'utf8');

  const j = auditIsDispatchable(dir);
  assert.equal(j.ok, true, `micronutrient gaps must not block dispatch, got ${j.reason}`);
});

check('a bundle with no audit payload at all refuses dispatch', () => {
  const dir = path.join(tmp, 'empty-bundle');
  fs.mkdirSync(dir, { recursive: true });
  const j = auditIsDispatchable(dir);
  assert.equal(j.ok, false, 'nothing to judge means nothing may be dispatched');
  assert.match(j.reason, /no audit_payload|unreadable|no bundle/i);
});

console.log(`\n${pass} pass, ${fail} fail`);
if (fail > 0) {
  console.error('\nFailures:');
  for (const f of failures) console.error(`  - ${f.name}: ${f.message}`);
  process.exit(1);
}
process.exit(0);
