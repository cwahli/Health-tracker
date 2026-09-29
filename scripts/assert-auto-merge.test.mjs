/**
 * assert-auto-merge.test.mjs — the sensor for the fail-closed merge gate.
 *
 * A merge gate that has never been seen to refuse is a gate nobody should
 * trust, and this one has already failed open twice. So the sensor does not
 * assert the gate's source; it runs it:
 *
 *  1. The decision is driven directly through every case that matters, including
 *     the two real shapes of the bug: a red run alongside a green run of the
 *     SAME name (worst wins), and a head SHA with no check runs at all yet
 *     (absence is not permission).
 *  2. `scripts/auto-merge.mjs` is spawned as a child process against a FAKE
 *     GitHub API on a loopback port (shared with the main-verify sensor), and the
 *     assertions are about what the fake server was actually asked to do: the red
 *     case must never POST a merge, and the green case must PUT exactly one.
 *
 * The race is reproduced literally: the fake API answers the first poll with no
 * check runs, the way the runner does in the seconds after a push, and only then
 * reports green (or red).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  HEAD_SHA,
  MAIN_GREEN,
  MAIN_SHA,
  MAIN_VERIFICATION_NAME,
  MERGE_SHA,
  mainRun,
  runDriver,
  startFakeGitHub,
} from './lib/fake-github.mjs';
import {
  DECISIONS,
  NON_BLOCKING_CHECKS,
  REQUIRED_CHECKS,
  describeDecision,
  evaluateChecks,
  evaluateMainHealth,
  evaluatePrState,
  isGreen,
  isMainVerification,
  requiredNames,
  validateRequiredAgainstWorkflows,
} from './lib/merge-gate.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

const [CI_CHECK, GUARD_CHECK] = requiredNames();

/** A check run as the Checks API reports it. */
const run = (name, conclusion, status = 'completed') => ({ name, status, conclusion });

const green = () => [run(CI_CHECK, 'success'), run(GUARD_CHECK, 'success')];

// ---------------------------------------------------------------------------
// 1. The decision.
// ---------------------------------------------------------------------------

test('the required set is the pair the workflow doc names', () => {
  assert.deepEqual(requiredNames(), ['tsc + named gates', 'no-overlap']);
  assert.equal(REQUIRED_CHECKS.length, 2);
  assert.ok(NON_BLOCKING_CHECKS.has('merge-agent-pr'), 'this job cannot wait on its own check');
  assert.deepEqual(DECISIONS, ['merge', 'wait', 'refuse']);
  assert.equal(isGreen('success'), true);
  assert.equal(isGreen('failure'), false);
  assert.equal(isGreen(''), false);
});

test('all required checks green is the only merge', () => {
  const ok = evaluateChecks({ checkRuns: green() });
  assert.equal(ok.decision, 'merge');
  assert.match(ok.reason, /concluded success/);
});

test('a red required check refuses', () => {
  const res = evaluateChecks({ checkRuns: [run(CI_CHECK, 'failure'), run(GUARD_CHECK, 'success')] });
  assert.equal(res.decision, 'refuse');
  assert.deepEqual(res.failed, [`${CI_CHECK} concluded failure`]);
  assert.match(res.reason, /not green/);
});

test('worst wins: a red run blocks even beside a green run of the same name', () => {
  // This is PR #344/#346 exactly: the push-event run and the pull_request-event
  // run share the job name, and the second one also checks the PR body.
  const res = evaluateChecks({
    checkRuns: [run(CI_CHECK, 'success'), run(CI_CHECK, 'failure'), run(GUARD_CHECK, 'success')],
  });
  assert.equal(res.decision, 'refuse');
  assert.equal(res.counts.failed, 1);
});

test('a head with no check runs at all WAITS — absence is not permission', () => {
  // PR #340 merged here. An empty list must never read as green.
  const res = evaluateChecks({ checkRuns: [] });
  assert.equal(res.decision, 'wait');
  assert.deepEqual(res.missing, [CI_CHECK, GUARD_CHECK]);
  assert.match(res.reason, /not reported yet/);
});

test('a still-running required check waits', () => {
  const res = evaluateChecks({ checkRuns: [run(CI_CHECK, 'success'), run(GUARD_CHECK, null, 'in_progress')] });
  assert.equal(res.decision, 'wait');
  assert.deepEqual(res.pending, [`${GUARD_CHECK} (in_progress)`]);
});

test('refusal outranks waiting when both are present', () => {
  const res = evaluateChecks({
    checkRuns: [run(CI_CHECK, 'failure'), run(GUARD_CHECK, null, 'in_progress')],
  });
  assert.equal(res.decision, 'refuse', 'a known failure is not excused by another check still running');
  assert.equal(res.pending.length, 1);
  assert.equal(res.failed.length, 1);
});

test('a non-required failure never blocks and never merges on its own', () => {
  const res = evaluateChecks({
    checkRuns: [...green(), run('open-pr', 'failure'), run('merge-agent-pr', null, 'in_progress'), run('workers-build', 'failure')],
  });
  assert.equal(res.decision, 'merge', 'only the declared required set can block');
  assert.equal(res.counts.runs, 4, 'the self check is dropped before it can look pending');
});

test('an unnamed or malformed run is ignored, not counted as a required name', () => {
  const res = evaluateChecks({ checkRuns: [...green(), { status: 'completed', conclusion: 'failure' }] });
  assert.equal(res.decision, 'merge');
});

test('a custom required set is honoured (the gate is not hardcoded to two)', () => {
  const res = evaluateChecks({ checkRuns: [run('only-me', 'success')], required: [{ name: 'only-me' }] });
  assert.equal(res.decision, 'merge');
  const red = evaluateChecks({ checkRuns: [run('only-me', 'failure')], required: [{ name: 'only-me' }] });
  assert.equal(red.decision, 'refuse');
});

test('the PR state is judged separately from the checks', () => {
  assert.equal(evaluatePrState({ state: 'open', draft: false }).decision, 'merge');
  assert.equal(evaluatePrState({ state: 'open', draft: true }).decision, 'refuse');
  assert.equal(evaluatePrState({ state: 'open', draft: false, merged_at: '2026-01-01' }).decision, 'refuse');
  assert.equal(evaluatePrState({ state: 'closed', draft: false }).decision, 'refuse');
  assert.equal(evaluatePrState(null).decision, 'refuse');
  assert.match(describeDecision({ decision: 'refuse', reason: 'x' }), /NOT merging/);
});

// ---------------------------------------------------------------------------
// 1b. Whether `main` itself is safe to land on.
//
// A green PR is not a green repository: two PRs can each pass their own gates and
// still break main together, which is the whole reason `main-verify` exists. Its
// result is consumed here, and the three-valued classification is the part worth
// pinning — getting it wrong in either direction is a real failure (a deadlocked
// merge queue, or a merge onto a tree that is already known broken).
// ---------------------------------------------------------------------------

test('a failed post-merge verification of main is red, and blocks', () => {
  const res = evaluateMainHealth({ checkRuns: [mainRun('failure')], mainSha: MAIN_SHA });
  assert.equal(res.health, 'red');
  assert.equal(res.blocked, true);
  assert.match(res.reason, /main itself is red/);
  assert.match(res.reason, /concluded `failure`/);
  assert.equal(res.failed.length, 1);
  for (const conclusion of ['timed_out', 'startup_failure']) {
    assert.equal(evaluateMainHealth({ checkRuns: [mainRun(conclusion)] }).blocked, true, conclusion);
  }
});

test('a green verification of main passes', () => {
  const res = evaluateMainHealth({ checkRuns: MAIN_GREEN, mainSha: MAIN_SHA });
  assert.equal(res.health, 'green');
  assert.equal(res.blocked, false);
  assert.match(res.reason, /verified green/);
});

test('a superseded (cancelled) verification is UNKNOWN, not red', () => {
  // Live, this is the normal state of a commit that a second merge overtook: the
  // concurrency group cancels the older run. Reading that as red would deadlock
  // every merge behind a run that will never fire again — and waiting on it would
  // deadlock for the same reason, so it is neither red nor runnable.
  const res = evaluateMainHealth({ checkRuns: [mainRun('cancelled')], mainSha: MAIN_SHA });
  assert.equal(res.health, 'unknown');
  assert.equal(res.blocked, false);
  assert.equal(res.waiting, false, 'a run that cannot conclude is not something to hold on');
  assert.match(res.reason, /not treated as a failure/);
});

test('main with no verification at all is UNKNOWN, and does not block', () => {
  const res = evaluateMainHealth({ checkRuns: [], mainSha: MAIN_SHA });
  assert.equal(res.health, 'unknown');
  assert.equal(res.blocked, false);
  assert.equal(res.waiting, false, 'nothing to wait for is not the same as something running');
  assert.match(res.reason, /no post-merge verification/);
  assert.equal(evaluateMainHealth({}).blocked, false);
  assert.equal(evaluateMainHealth({ checkRuns: null }).health, 'unknown');
});

test('main is only red if MAIN VERIFICATION failed — another red check is not main being broken', () => {
  const res = evaluateMainHealth({ checkRuns: [run('no-overlap', 'failure'), run('open-pr', 'failure')], mainSha: MAIN_SHA });
  assert.equal(res.health, 'unknown');
  assert.equal(res.blocked, false);
});

// The in-progress window. `main` is verified AFTER a merge, so by the time the
// next PR's checks conclude, the verification of the merge before it is usually
// still running. The gate used to read that as "unknown, does not block" and
// merge through the one check that had not finished — the window a break slips
// through. It is a HOLD now, and these cases pin every way it must not drift
// back into permission.

test('a still-running verification of main is a WAIT, not a pass', () => {
  const res = evaluateMainHealth({ checkRuns: [mainRun(null, 'in_progress')], mainSha: MAIN_SHA });
  assert.equal(res.health, 'running');
  assert.equal(res.blocked, false, 'mid-verification is not a failure');
  assert.equal(res.waiting, true, 'and it is not permission either');
  assert.match(res.reason, /has not concluded yet/);
  assert.equal(res.pending.length, 1);
});

test('every non-concluded status holds — only `completed` concludes anything', () => {
  // An allow-list of "running" statuses would be one GitHub rename away from
  // silently passing again, so the default is the hold.
  for (const status of ['queued', 'pending', 'requested', 'waiting', 'in_progress', '']) {
    const res = evaluateMainHealth({ checkRuns: [mainRun(null, status)] });
    assert.equal(res.waiting, true, `status ${JSON.stringify(status)}`);
    assert.equal(res.blocked, false, `status ${JSON.stringify(status)}`);
  }
});

test('only a concluded state ends the hold — green passes, red refuses, cancelled does not wedge', () => {
  assert.equal(evaluateMainHealth({ checkRuns: MAIN_GREEN }).waiting, false);
  assert.equal(evaluateMainHealth({ checkRuns: MAIN_GREEN }).health, 'green');
  assert.equal(evaluateMainHealth({ checkRuns: [mainRun('failure')] }).waiting, false);
  assert.equal(evaluateMainHealth({ checkRuns: [mainRun('failure')] }).blocked, true);
  assert.equal(evaluateMainHealth({ checkRuns: [mainRun('cancelled')] }).waiting, false);
  assert.equal(evaluateMainHealth({ checkRuns: [] }).waiting, false);
});

test('a green run outranks a redundant running one; a red one outranks both', () => {
  assert.equal(
    evaluateMainHealth({ checkRuns: [...MAIN_GREEN, mainRun(null, 'in_progress')] }).health,
    'green',
    'a second, redundant run of a gate that already passed is not a reason to wait',
  );
  const red = evaluateMainHealth({ checkRuns: [mainRun('failure'), mainRun(null, 'in_progress')] });
  assert.equal(red.health, 'red', 'worst wins: a concluded failure is not excused by a sibling still running');
  assert.equal(red.blocked, true);
  assert.equal(red.waiting, false);
});

test("main's verification is recognised under both names it really reports as", () => {
  // `main-verify.yml` calls `ci.yml` through `workflow_call`, so GitHub prefixes
  // the check with the calling job; a human pushing straight to main runs ci.yml
  // directly. Both are the same gate and both were observed on real commits.
  assert.equal(MAIN_VERIFICATION_NAME, 'gates / tsc + named gates');
  assert.equal(isMainVerification('gates / tsc + named gates'), true);
  assert.equal(isMainVerification('tsc + named gates'), true);
  assert.equal(isMainVerification('no-overlap'), false);
  assert.equal(isMainVerification('gates / tsc + named gates (v2)'), false);
  assert.equal(isMainVerification(undefined), false);
});

// ---------------------------------------------------------------------------
// 2. The required set must match the workflows that emit it.
// ---------------------------------------------------------------------------

test('every required check is really emitted by a real workflow job', () => {
  const readWorkflow = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
  const res = validateRequiredAgainstWorkflows({ required: REQUIRED_CHECKS, readWorkflow });
  assert.deepEqual(res.problems, []);
  assert.equal(res.ok, true);
});

test('a renamed job or a renamed display name is caught, not silently awaited', () => {
  const real = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
  const renamedJob = validateRequiredAgainstWorkflows({
    required: [{ workflow: 'ci', job: 'gates-renamed', name: CI_CHECK }],
    readWorkflow: real,
  });
  assert.equal(renamedJob.ok, false);
  assert.ok(renamedJob.problems.some((p) => /has no job/.test(p)));

  const renamedDisplay = validateRequiredAgainstWorkflows({
    required: [{ workflow: 'ci', job: 'gates', name: 'tsc + renamed gates' }],
    readWorkflow: real,
  });
  assert.equal(renamedDisplay.ok, false);
  assert.ok(renamedDisplay.problems.some((p) => /no longer reports as/.test(p)));

  const missingFile = validateRequiredAgainstWorkflows({
    required: [{ workflow: 'nope', job: 'x', name: 'y' }],
    readWorkflow: real,
  });
  assert.ok(missingFile.problems.some((p) => /is missing/.test(p)));
});

// ---------------------------------------------------------------------------
// 3. The driver, end to end, against a fake GitHub API.
// ---------------------------------------------------------------------------

// The fake GitHub API and the child-process driver runner live in
// `scripts/lib/fake-github.mjs`, shared with `assert-main-verify.test.mjs` so
// both sensors drive one endpoint surface instead of two copies of it.

test('E2E: a green head merges exactly once, and the branch is deleted', async () => {
  const fake = await startFakeGitHub({ checkPlans: [green()] });
  try {
    const res = await runDriver(fake.port);
    assert.equal(res.code, 0, `driver exited 0 (stderr: ${res.stderr})`);
    assert.equal(fake.calls.merge.length, 1, 'exactly one merge call');
    assert.deepEqual(fake.calls.merge[0], { merge_method: 'squash' });
    assert.equal(fake.calls.deleted.length, 1);
    assert.match(res.stdout, /merge/);
    assert.equal(fake.calls.comments.length, 1, 'the merge result is posted on the PR');
    assert.deepEqual(
      [...new Set(fake.calls.checkQueries)],
      ['all'],
      'every poll asks for all check runs, never the collapsing `latest` default',
    );
  } finally {
    await fake.close();
  }
});

test('E2E: a merge dispatches the post-merge verification of main, naming the commit', async () => {
  const fake = await startFakeGitHub({ checkPlans: [green()] });
  try {
    const res = await runDriver(fake.port);
    assert.equal(res.code, 0, `driver exited 0 (stderr: ${res.stderr})`);
    assert.equal(fake.calls.dispatches.length, 1, 'exactly one dispatch');
    assert.equal(fake.calls.dispatches[0].event_type, 'main-verify');
    assert.equal(
      fake.calls.dispatches[0].client_payload.sha,
      MERGE_SHA,
      'the commit that landed is named, so the run is provably about that merge',
    );
    assert.match(fake.calls.comments[0], /main verification dispatched/);
  } finally {
    await fake.close();
  }
});

test('E2E: a merge whose verification cannot be dispatched is not reported as a success', async () => {
  // The merge has happened, so this cannot be undone — but it must not be silent,
  // and the run must not claim success for a main nobody will verify.
  const fake = await startFakeGitHub({ checkPlans: [green()], dispatchFails: true });
  try {
    const res = await runDriver(fake.port);
    assert.equal(fake.calls.merge.length, 1, 'the merge itself still happened');
    assert.equal(res.code, 1, 'merged, but not a success');
    assert.match(res.stdout, /main verification NOT dispatched/);
    assert.match(fake.calls.comments[0], /NOT dispatched/);
  } finally {
    await fake.close();
  }
});

test('E2E: a red required check NEVER merges, and says which one', async () => {
  const fake = await startFakeGitHub({
    checkPlans: [[run(CI_CHECK, 'failure'), run(GUARD_CHECK, 'success')]],
  });
  try {
    const res = await runDriver(fake.port);
    assert.equal(res.code, 1, 'a refusal is a non-zero exit');
    assert.equal(fake.calls.merge.length, 0, 'THE ASSERTION: no merge call was ever made');
    assert.equal(fake.calls.deleted.length, 0);
    assert.equal(fake.calls.dispatches.length, 0, 'nothing is verified because nothing landed');
    assert.equal(fake.calls.comments.length, 1);
    assert.match(fake.calls.comments[0], /NOT merging/);
    assert.match(fake.calls.comments[0], /concluded failure/);
  } finally {
    await fake.close();
  }
});

test('E2E: the #340 race — nothing reported yet, then green — waits instead of merging', async () => {
  const fake = await startFakeGitHub({ checkPlans: [[], [], green()] });
  try {
    const res = await runDriver(fake.port);
    assert.equal(res.code, 0, `driver exited 0 (stderr: ${res.stderr})`);
    assert.ok(fake.calls.checkPolls >= 3, `polled until the checks appeared (saw ${fake.calls.checkPolls})`);
    assert.equal(fake.calls.merge.length, 1, 'it merged, but only after the checks were reported green');
    assert.match(res.stdout, /not reported yet/);
  } finally {
    await fake.close();
  }
});

test('E2E: the same race with a late failure refuses and never merges', async () => {
  const fake = await startFakeGitHub({
    checkPlans: [[], [run(CI_CHECK, null, 'in_progress')], [run(CI_CHECK, 'failure'), run(GUARD_CHECK, 'success')]],
  });
  try {
    const res = await runDriver(fake.port);
    assert.equal(res.code, 1);
    assert.equal(fake.calls.merge.length, 0);
    assert.match(fake.calls.comments[0], /concluded failure/);
  } finally {
    await fake.close();
  }
});

test('E2E: a check that never concludes times out into a refusal, not a merge', async () => {
  const fake = await startFakeGitHub({ checkPlans: [[], [run(CI_CHECK, null, 'queued')]] });
  try {
    const res = await runDriver(fake.port, ['--wait=0']);
    assert.equal(res.code, 1, 'the wait budget is exhausted, so the PR stays open');
    assert.equal(fake.calls.merge.length, 0, 'exhausting the wait must NEVER merge');
    assert.match(fake.calls.comments[0], /timed out/);
    assert.match(fake.calls.comments[0], /Never reported|Still running/);
  } finally {
    await fake.close();
  }
});

test('E2E: no open PR is a no-op, not an error and not a merge', async () => {    const fake = await startFakeGitHub({ checkPlans: [green()], prs: [] });
  try {
    const res = await runDriver(fake.port, ['--wait=0']);
    assert.equal(res.code, 0);
    assert.equal(fake.calls.merge.length, 0);
    assert.equal(fake.calls.checkPolls, 0, 'it never even looked at checks');
  } finally {
    await fake.close();
  }
});

test('E2E: --evaluate decides without writing anything', async () => {
  const fake = await startFakeGitHub({ checkPlans: [green()] });
  try {
    const res = await runDriver(fake.port, ['--evaluate']);
    assert.equal(res.code, 0);
    assert.match(res.stdout, /\[evaluate\] would merge/);
    assert.equal(fake.calls.merge.length, 0, 'evaluate never merges');
    assert.equal(fake.calls.comments.length, 0, 'evaluate never comments');
    assert.equal(fake.calls.deleted.length, 0);
    assert.equal(fake.calls.dispatches.length, 0, 'evaluate never dispatches');
  } finally {
    await fake.close();
  }
});

test('E2E: --evaluate on a red head reports the refusal and still writes nothing', async () => {
  const fake = await startFakeGitHub({ checkPlans: [[run(CI_CHECK, 'failure'), run(GUARD_CHECK, 'success')]] });
  try {
    const res = await runDriver(fake.port, ['--evaluate']);
    assert.equal(res.code, 1);
    assert.match(res.stdout, /\[evaluate\] would comment/);
    assert.equal(fake.calls.merge.length, 0);
    assert.equal(fake.calls.comments.length, 0);
  } finally {
    await fake.close();
  }
});

test('E2E: a green PR does NOT merge while main itself is red', async () => {
  const fake = await startFakeGitHub({ checkPlans: [green()], mainChecks: [mainRun('failure')] });
  try {
    const res = await runDriver(fake.port);
    assert.equal(res.code, 1, 'a red main is a refusal, not a merge');
    assert.equal(fake.calls.merge.length, 0, 'THE ASSERTION: it did not land on a tree that is already failing');
    assert.equal(fake.calls.dispatches.length, 0);
    assert.equal(fake.calls.mainCheckReads, 1, 'it looked at main before deciding');
    assert.equal(fake.calls.comments.length, 1);
    assert.match(fake.calls.comments[0], /main itself is red/);
    assert.match(fake.calls.comments[0], /does not need a new commit/, 'the PR is not what has to change');
    assert.doesNotMatch(fake.calls.comments[0], /Required: /, 'the required list is not the reason, so it is not printed as one');
  } finally {
    await fake.close();
  }
});

test('E2E: the operator can land the fix on a red main, and it is recorded as an override', async () => {
  // Without this there is no way out of a red main: the only way to change main is
  // to merge, and every merge is refused. The override is opt-in and loud, so the
  // failure stays closed by default and recoverable on purpose.
  const fake = await startFakeGitHub({ checkPlans: [green()], mainChecks: [mainRun('failure')] });
  try {
    // `--pr=7` as well: that is how the operator reaches this, through the
    // workflow_dispatch entry point, and it must judge the PR they named rather
    // than whichever PR happens to be on the current branch.
    const res = await runDriver(fake.port, ['--pr=7', '--allow-red-main']);
    assert.equal(fake.calls.merge.length, 1, 'the override merges');
    assert.equal(res.code, 0);
    assert.equal(fake.calls.prListReads, 0, 'it used the PR it was given, not a branch lookup');
    assert.match(res.stdout, /OVERRIDING a red main/);
    assert.match(fake.calls.comments[0], /Merged over a red `main`/);
    assert.equal(fake.calls.dispatches.length, 1, 'and main is re-verifiable right after');
  } finally {
    await fake.close();
  }
});

test('E2E: without the override the same red main still refuses', async () => {
  // The pair of tests above and here is the point: the escape hatch is a decision,
  // not a default.
  const fake = await startFakeGitHub({ checkPlans: [green()], mainChecks: [mainRun('failure')] });
  try {
    const res = await runDriver(fake.port);
    assert.equal(res.code, 1);
    assert.equal(fake.calls.merge.length, 0);
  } finally {
    await fake.close();
  }
});

test('E2E: a superseded verification of main does not wedge the merge queue', async () => {
  const fake = await startFakeGitHub({ checkPlans: [green()], mainChecks: [mainRun('cancelled')] });
  try {
    const res = await runDriver(fake.port);
    assert.equal(fake.calls.merge.length, 1, 'unknown main must not stop a green PR forever');
    assert.equal(res.code, 0);
    assert.match(res.stdout, /main: unknown/);
  } finally {
    await fake.close();
  }
});

test('E2E: main with no verification yet merges, and says that is unknown rather than green', async () => {
  const fake = await startFakeGitHub({ checkPlans: [green()], mainChecks: [] });
  try {
    const res = await runDriver(fake.port);
    assert.equal(fake.calls.merge.length, 1);
    assert.match(res.stdout, /no post-merge verification/);
  } finally {
    await fake.close();
  }
});

test('E2E: a green PR HOLDS while main is mid-verification, then merges on its result', async () => {
  // The in-progress window, end to end. The fake answers the first read of main's
  // checks with a verification still running and the second with its conclusion,
  // so the driver has to hold and re-read instead of deciding on one look.
  const fake = await startFakeGitHub({
    checkPlans: [green()],
    mainCheckPlans: [[mainRun(null, 'in_progress')], [mainRun('success')]],
  });
  try {
    const res = await runDriver(fake.port);
    assert.equal(res.code, 0, `driver exited 0 (stderr: ${res.stderr})`);
    assert.ok(fake.calls.mainCheckReads >= 2, `it re-read main after holding (saw ${fake.calls.mainCheckReads})`);
    assert.equal(fake.calls.merge.length, 1, 'THE ASSERTION: it merged, but only once the verification concluded');
    assert.equal(fake.calls.dispatches.length, 1);
    assert.match(res.stdout, /has not concluded yet/);
  } finally {
    await fake.close();
  }
});

test('E2E: it does NOT merge through an unfinished verification of main', async () => {
  // The sharpest open hole before this change: main is often mid-verification when
  // the next merge arrives, so the gate read `unknown` and proceeded. Absence of a
  // red light is not a green light here either — the merge waits, and a
  // verification that never concludes runs the budget out into a refusal.
  const fake = await startFakeGitHub({
    checkPlans: [green()],
    mainCheckPlans: [[mainRun(null, 'in_progress')]],
  });
  try {
    const res = await runDriver(fake.port, ['--wait=0']);
    assert.equal(res.code, 1, 'the wait budget ran out, so the PR stays open');
    assert.equal(fake.calls.merge.length, 0, 'THE ASSERTION: no merge was landed through the window');
    assert.equal(fake.calls.dispatches.length, 0);
    assert.equal(fake.calls.comments.length, 1);
    assert.match(fake.calls.comments[0], /held while `main` finished its post-merge verification/);
    assert.match(fake.calls.comments[0], /Still running/);
  } finally {
    await fake.close();
  }
});

test('E2E: a verification that goes RED while the merge is held refuses it', async () => {
  // The hold has to be able to end the other way too: this is the break the window
  // was letting through, so the driver must catch it rather than ride past it.
  const fake = await startFakeGitHub({
    checkPlans: [green()],
    mainCheckPlans: [[mainRun(null, 'in_progress')], [mainRun('failure')]],
  });
  try {
    const res = await runDriver(fake.port);
    assert.equal(res.code, 1);
    assert.equal(fake.calls.merge.length, 0, 'THE ASSERTION: it did not land on the tree it had just watched fail');
    assert.equal(fake.calls.dispatches.length, 0);
    assert.match(fake.calls.comments[0], /main itself is red/);
  } finally {
    await fake.close();
  }
});

test('E2E: a red PR is refused without even reading main', async () => {
  const fake = await startFakeGitHub({
    checkPlans: [[run(CI_CHECK, 'failure'), run(GUARD_CHECK, 'success')]],
    mainChecks: MAIN_GREEN,
  });
  try {
    const res = await runDriver(fake.port);
    assert.equal(res.code, 1);
    assert.equal(fake.calls.mainCheckReads, 0, 'the PR has to be mergeable before main matters');
  } finally {
    await fake.close();
  }
});

test('E2E: a draft PR is refused before any check is even read', async () => {
  const fake = await startFakeGitHub({
    checkPlans: [green()],
    prs: [{ number: 7, state: 'open', draft: true, head: { sha: HEAD_SHA } }],
  });
  try {
    const res = await runDriver(fake.port);
    assert.equal(res.code, 1);
    assert.equal(fake.calls.merge.length, 0);
    assert.equal(fake.calls.checkPolls, 0);
    assert.match(fake.calls.comments[0], /draft/);
  } finally {
    await fake.close();
  }
});

test('E2E: a missing token refuses to run rather than guessing', async () => {
  const fake = await startFakeGitHub({ checkPlans: [green()] });
  try {
    const res = await runDriver(fake.port, [], { token: null });
    assert.equal(res.code, 2);
    assert.match(res.stderr, /GH_TOKEN is not set/);
    assert.equal(fake.calls.merge.length, 0);
    assert.equal(fake.calls.checkPolls, 0);
  } finally {
    await fake.close();
  }
});
