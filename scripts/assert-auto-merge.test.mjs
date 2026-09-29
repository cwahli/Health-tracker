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

import { HEAD_SHA, MERGE_SHA, runDriver, startFakeGitHub } from './lib/fake-github.mjs';
import {
  DECISIONS,
  NON_BLOCKING_CHECKS,
  REQUIRED_CHECKS,
  describeDecision,
  evaluateChecks,
  evaluatePrState,
  isGreen,
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
