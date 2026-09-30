/**
 * assert-main-verify.test.mjs — the sensor for "main gets a CI run".
 *
 * Three things are checked, and they are different kinds of claim:
 *
 *  1. The dispatch body is right, including the sha that makes the run provably
 *     about the commit that landed.
 *  2. The wiring is complete in the real repository — the workflow exists, it
 *     listens on the suppression-exempt event with the right type, and it reuses
 *     `ci.yml` instead of keeping a second gate list that would drift. This is
 *     the check that would have caught the original bug, because a
 *     `push`-only trigger *looks* correct and is exactly what is suppressed.
 *  3. The driver refuses to merge while that wiring is broken. Asserted here by
 *     running the real driver out of a scratch tree with a broken workflow, so
 *     the claim "the guard reads the files it says it reads" is exercised rather
 *     than trusted.
 *  4. Verifying `main` is not enough on its own: a red `main` also REFUSES every
 *     merge, and until now it did so silently — a stalled queue with no issue and
 *     no line anywhere. The `notice` job, the permissions it needs, and the fact
 *     that it runs when the gate FAILED (the only case it exists for) are pinned
 *     here, and the notice script itself is run against the fake API.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { MERGE_SHA, runDriver, startFakeGitHub } from './lib/fake-github.mjs';
import {
  CI_WORKFLOW,
  MAIN_VERIFY_EVENT,
  MAIN_VERIFY_WORKFLOW,
  buildDispatch,
  describeDispatch,
  dispatchEndpoint,
  validateMainVerifyWiring,
} from './lib/main-verify.mjs';
import {
  AUTO_MERGE_WORKFLOW,
  MAIN_RED_ISSUE_TITLE,
  validateNoticeWiring,
} from './lib/red-main-notice.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const readWorkflow = read;

const run = (name, conclusion, status = 'completed') => ({ name, status, conclusion });
const green = () => [run('tsc + named gates', 'success'), run('no-overlap', 'success')];

// ---------------------------------------------------------------------------
// 1. The dispatch body.
// ---------------------------------------------------------------------------

test('a dispatch names the event and the commit that landed', () => {
  const sha = 'c'.repeat(40);
  assert.deepEqual(buildDispatch(sha), { event_type: MAIN_VERIFY_EVENT, client_payload: { sha } });
  assert.equal(MAIN_VERIFY_EVENT, 'main-verify');
  assert.equal(dispatchEndpoint('o', 'r'), '/repos/o/r/dispatches');
});

test('a missing or blank sha is omitted rather than invented', () => {
  // The workflow falls back to the default-branch head and says so in its run
  // name, so this is not an error — but a fabricated sha would be a lie.
  for (const bad of [null, undefined, '', '   ', 42, {}]) {
    const body = buildDispatch(bad);
    assert.equal(body.event_type, MAIN_VERIFY_EVENT);
    assert.deepEqual(body.client_payload, {});
  }
  assert.deepEqual(buildDispatch('  abc  ').client_payload, { sha: 'abc' });
});

test('the outcome line distinguishes dispatched from not, and says why', () => {
  assert.match(describeDispatch({ ok: true, sha: 'deadbeef00' }), /dispatched/);
  assert.match(describeDispatch({ ok: true, sha: 'deadbeef00' }), /deadbee/);
  assert.match(describeDispatch({ ok: false, detail: 'HTTP 403 nope' }), /NOT dispatched: HTTP 403 nope/);
  assert.match(describeDispatch(null), /no attempt/);
});

// ---------------------------------------------------------------------------
// 2. The wiring, in this repository, right now.
// ---------------------------------------------------------------------------

test('main-verify is wired to the one trigger a token merge cannot suppress', () => {
  const res = validateMainVerifyWiring({ readWorkflow });
  assert.deepEqual(res.problems, [], `wiring problems: ${res.problems.join('; ')}`);
  assert.equal(res.ok, true);
});

test('a push-only main-verify is caught — that is the bug, not a variant of it', () => {
  const pushOnly = read(MAIN_VERIFY_WORKFLOW).replace(/^ {2}repository_dispatch:\s*$/m, '  push:');
  const res = validateMainVerifyWiring({ readWorkflow: (rel) => (rel === MAIN_VERIFY_WORKFLOW ? pushOnly : readWorkflow(rel)) });
  assert.equal(res.ok, false);
  assert.ok(res.problems.some((p) => /does not listen on repository_dispatch/.test(p)));
});

test('a workflow with a second gate list is refused, and so is an unreusable ci', () => {
  const noCall = read(MAIN_VERIFY_WORKFLOW).replace(/^\s+uses:\s*\.\/\.github\/workflows\/ci\.yml\s*$/m, '');
  const missing = validateMainVerifyWiring({ readWorkflow: (rel) => (rel === MAIN_VERIFY_WORKFLOW ? noCall : readWorkflow(rel)) });
  assert.ok(missing.problems.some((p) => /does not call \.\/\.github\/workflows\/ci\.yml/.test(p)));

  const wrongType = read(MAIN_VERIFY_WORKFLOW).replace(/\btypes:\s*\[main-verify\]/, 'types: [something-else]');
  const typed = validateMainVerifyWiring({ readWorkflow: (rel) => (rel === MAIN_VERIFY_WORKFLOW ? wrongType : readWorkflow(rel)) });
  assert.ok(typed.problems.some((p) => /does not declare types: \[main-verify\]/.test(p)));

  const noHook = read(CI_WORKFLOW).replace(/^ {2}workflow_call:\s*$/m, '');
  const hooked = validateMainVerifyWiring({ readWorkflow: (rel) => (rel === CI_WORKFLOW ? noHook : readWorkflow(rel)) });
  assert.ok(hooked.problems.some((p) => /does not declare `workflow_call:`/.test(p)));

  const gone = validateMainVerifyWiring({ readWorkflow: () => { throw new Error('ENOENT'); } });
  assert.equal(gone.ok, false);
  assert.equal(gone.problems.length, 2, 'both files are reported, not just the first');
});

test('a missing reader is refused instead of passing vacuously', () => {
  const res = validateMainVerifyWiring({});
  assert.equal(res.ok, false);
  assert.match(res.problems[0], /no workflow reader/);
});

// ---------------------------------------------------------------------------
// 3. The guard, exercised: the real driver, in a scratch tree.
// ---------------------------------------------------------------------------

/** A copy of the real driver and workflows, with named files overridden. */
function scratchTree(overrides = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'main-verify-'));
  fs.cpSync(path.join(ROOT, '.github', 'workflows'), path.join(dir, '.github', 'workflows'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'scripts', 'lib'), { recursive: true });
  for (const rel of [
    'auto-merge.mjs',
    'notify-main-red.mjs',
    'lib/merge-gate.mjs',
    'lib/main-verify.mjs',
    'lib/github-rest.mjs',
    'lib/red-main-notice.mjs',
    // The driver judges landed work before merging (MERGE-GATE-1 extension).
    // This fixture copies the driver's real import graph, so the graph growing
    // is a change here too — otherwise the scratch tree crashes with
    // ERR_MODULE_NOT_FOUND and every E2E in this file fails for the wrong
    // reason.
    'lib/no-undo.mjs',
    'lib/premerge-undo.mjs',
  ]) {
    fs.copyFileSync(path.join(ROOT, 'scripts', rel), path.join(dir, 'scripts', rel));
  }
  for (const [rel, text] of Object.entries(overrides)) {
    fs.writeFileSync(path.join(dir, rel), text);
  }
  return { dir, driver: path.join(dir, 'scripts', 'auto-merge.mjs') };
}

test('E2E: the driver refuses to merge while main could not be verified', async () => {
  const fake = await startFakeGitHub({ checkPlans: [green()] });
  const tree = scratchTree({ [CI_WORKFLOW]: read(CI_WORKFLOW).replace(/^ {2}workflow_call:\s*$/m, '') });
  try {
    const res = await runDriver(fake.port, [], { driver: tree.driver, cwd: tree.dir });
    assert.equal(res.code, 2, `driver refused (stderr: ${res.stderr})`);
    assert.match(res.stderr, /nowhere to run/);
    assert.match(res.stderr, /workflow_call/);
    assert.equal(fake.calls.merge.length, 0, 'THE ASSERTION: a merge with no verification behind it does not happen');
    assert.equal(fake.calls.checkPolls, 0, 'it refuses before it even looks at the checks');
  } finally {
    await fake.close();
    fs.rmSync(tree.dir, { recursive: true, force: true });
  }
});

test('E2E: the same tree with intact wiring merges and dispatches', async () => {
  const fake = await startFakeGitHub({ checkPlans: [green()] });
  const tree = scratchTree();
  try {
    const res = await runDriver(fake.port, [], { driver: tree.driver, cwd: tree.dir });
    assert.equal(res.code, 0, `driver merged (stderr: ${res.stderr})`);
    assert.equal(fake.calls.merge.length, 1);
    assert.equal(fake.calls.dispatches.length, 1);
  } finally {
    await fake.close();
    fs.rmSync(tree.dir, { recursive: true, force: true });
  }
});

const NOTICE_DRIVER = path.join(ROOT, 'scripts', 'notify-main-red.mjs');

/** Run the notice entry point the way `main-verify.yml`'s `notice` job does. */
const runNotice = (port, extraArgs, opts) =>
  runDriver(port, extraArgs, { driver: NOTICE_DRIVER, defaultArgs: [], ...opts });

// ---------------------------------------------------------------------------
// 4. The notice. Verifying `main` is not enough on its own, because a red `main`
// also refuses every merge — and that refusal used to be silent, which made a
// stalled queue read like a slow runner or an agent that walked away.
// ---------------------------------------------------------------------------

test('the notice is wired in this repository, right now', () => {
  const res = validateNoticeWiring({ readWorkflow });
  assert.deepEqual(res.problems, [], `notice wiring problems: ${res.problems.join('; ')}`);
  assert.equal(res.ok, true);
});

test('a notice job that would be skipped exactly when main is red is caught', () => {
  // `if: always()` is load bearing: without it the job is skipped the moment the
  // gate fails, i.e. in the only case it exists for. It looks like a harmless
  // default and is the whole bug.
  const skipped = read(MAIN_VERIFY_WORKFLOW).replace(/^ {4}if: always\(\)\s*$/m, '    if: success()');
  const res = validateNoticeWiring({ readWorkflow: (rel) => (rel === MAIN_VERIFY_WORKFLOW ? skipped : readWorkflow(rel)) });
  assert.equal(res.ok, false);
  assert.ok(res.problems.some((p) => /if: always\(\)/.test(p)), res.problems.join('; '));
});

test('a notice with no permission, no needs, or no script is caught before it becomes a 403', () => {
  const withOverride = (rel, text) => (r) => (r === rel ? text : readWorkflow(r));

  const noPermission = read(MAIN_VERIFY_WORKFLOW).replace(/^ {2}issues: write\s*$/m, '');
  assert.ok(
    validateNoticeWiring({ readWorkflow: withOverride(MAIN_VERIFY_WORKFLOW, noPermission) }).problems.some((p) =>
      /issues: write/.test(p),
    ),
    'a missing issues:write is a 403 at the worst possible moment',
  );

  const noNeeds = read(MAIN_VERIFY_WORKFLOW).replace(/^ {4}needs: gates\s*$/m, '');
  assert.ok(
    validateNoticeWiring({ readWorkflow: withOverride(MAIN_VERIFY_WORKFLOW, noNeeds) }).problems.some((p) =>
      /needs: gates/.test(p),
    ),
  );

  const noScript = read(MAIN_VERIFY_WORKFLOW).replace(/notify-main-red\.mjs/g, 'something-else.mjs');
  assert.ok(
    validateNoticeWiring({ readWorkflow: withOverride(MAIN_VERIFY_WORKFLOW, noScript) }).problems.some((p) =>
      /does not run/.test(p),
    ),
  );

  const mergeNoPermission = read(AUTO_MERGE_WORKFLOW).replace(/^ {2}issues: write\s*$/m, '');
  assert.ok(
    validateNoticeWiring({ readWorkflow: withOverride(AUTO_MERGE_WORKFLOW, mergeNoPermission) }).problems.some((p) =>
      /could not say why/.test(p),
    ),
    'the merge driver runs the same module, so its permission matters too',
  );
});

test('a deleted notice job and a missing file are both named', () => {
  const renamed = read(MAIN_VERIFY_WORKFLOW).replace(/^ {2}notice:$/m, '  notice-renamed:');
  const res = validateNoticeWiring({ readWorkflow: (rel) => (rel === MAIN_VERIFY_WORKFLOW ? renamed : readWorkflow(rel)) });
  assert.ok(res.problems.some((p) => /has no "notice" job/.test(p)), res.problems.join('; '));

  const gone = validateNoticeWiring({ readWorkflow: () => { throw new Error('ENOENT'); } });
  assert.equal(gone.ok, false);
  assert.equal(gone.problems.length, 2, 'both files are reported, not just the first');

  assert.equal(validateNoticeWiring({}).ok, false, 'a missing reader must not pass vacuously');
});

test('E2E: a failed verification files the standing issue, and a pass closes it', async () => {
  const red = await startFakeGitHub({ openIssues: [] });
  try {
    const res = await runNotice(red.port, ['--result=failure', `--sha=${MERGE_SHA}`], {
      env: { GITHUB_ACTIONS: 'true' },
    });
    assert.equal(res.code, 0, `the notice ran (stderr: ${res.stderr})`);
    assert.equal(red.calls.issuesCreated.length, 1, 'THE ASSERTION: the outage has a record');
    assert.equal(red.calls.issuesCreated[0].title, MAIN_RED_ISSUE_TITLE);
    assert.ok(red.calls.issuesCreated[0].body.includes(MERGE_SHA.slice(0, 7)), 'it names the commit that failed');
    assert.match(res.stdout, /::error::/, 'and it is an annotation, not a line in a log nobody opens');
    assert.match(res.stderr, /MAIN IS RED/);
  } finally {
    await red.close();
  }

  const green = await startFakeGitHub({ openIssues: [{ number: 100, title: MAIN_RED_ISSUE_TITLE, state: 'open' }] });
  try {
    const res = await runNotice(green.port, ['--result=success', `--sha=${MERGE_SHA}`], {});
    assert.equal(res.code, 0, `the notice ran (stderr: ${res.stderr})`);
    assert.deepEqual(green.calls.issuesClosed, [100], 'THE ASSERTION: the notice does not outlive the outage');
    assert.match(green.calls.issueComments[0], /unblocked/);
  } finally {
    await green.close();
  }

  const quiet = await startFakeGitHub({ openIssues: [] });
  try {
    const res = await runNotice(quiet.port, ['--result=success'], {});
    assert.equal(res.code, 0);
    assert.equal(quiet.calls.issueComments.length, 0, 'a green main with no notice open touches nothing');
    assert.equal(quiet.calls.issuesClosed.length, 0);
  } finally {
    await quiet.close();
  }
});

test('E2E: cancelled and skipped are NOT announced as a broken main', async () => {
  // A superseded verification is the normal state of this workflow's concurrency
  // group. Announcing an outage for it would raise one on every second merge.
  for (const result of ['cancelled', 'skipped']) {
    const fake = await startFakeGitHub({ openIssues: [] });
    try {
      const res = await runNotice(fake.port, [`--result=${result}`, `--sha=${MERGE_SHA}`], {});
      assert.equal(res.code, 0, result);
      assert.equal(fake.calls.issuesCreated.length, 0, `an issue was filed for ${result}`);
      assert.equal(fake.calls.issueListReads, 0, `it looked for a notice to file for ${result}`);
      assert.doesNotMatch(res.stderr, /MAIN IS RED/, result);
    } finally {
      await fake.close();
    }
  }
});

test('E2E: the notice refuses to run when it has nowhere to file', async () => {
  // A notifier that cannot notify IS the silent no-op being removed, so it must
  // refuse rather than report "nothing to report" while main is red. Run out of
  // a scratch tree with the permission stripped, so the guard is exercised
  // against the files it actually reads.
  const fake = await startFakeGitHub({ openIssues: [] });
  const tree = scratchTree({
    [MAIN_VERIFY_WORKFLOW]: read(MAIN_VERIFY_WORKFLOW).replace(/^ {2}issues: write\s*$/m, ''),
  });
  try {
    const res = await runDriver(fake.port, ['--result=failure'], {
      driver: path.join(tree.dir, 'scripts', 'notify-main-red.mjs'),
      cwd: tree.dir,
      defaultArgs: [],
    });
    assert.equal(res.code, 2, 'the entry point refused');
    assert.match(res.stderr, /issues: write/);
    assert.match(res.stderr, /nowhere to land/);
    assert.equal(fake.calls.issuesCreated.length, 0, 'THE ASSERTION: it did not pretend there was nothing to report');
  } finally {
    await fake.close();
    fs.rmSync(tree.dir, { recursive: true, force: true });
  }
});

test('E2E: the driver still merges when its own path goes through a symlink', async () => {
  // Found by the test above, which failed with exit 0 and no merge on macOS: a
  // symlinked path component made the entry-point check miss, so main() never ran
  // and the process exited 0 — this driver's signal for "merged". A no-op that
  // reports success is the fail-open shape this whole change is about, so it is
  // pinned here rather than left to the platform that happens to reproduce it.
  const fake = await startFakeGitHub({ checkPlans: [green()] });
  const tree = scratchTree();
  const link = `${tree.dir}-link`;
  fs.symlinkSync(tree.dir, link, 'dir');
  try {
    const res = await runDriver(fake.port, [], {
      driver: path.join(link, 'scripts', 'auto-merge.mjs'),
      cwd: tree.dir,
    });
    assert.equal(fake.calls.merge.length, 1, 'THE ASSERTION: it merged instead of exiting 0 having done nothing');
    assert.equal(res.code, 0, `driver exited 0 (stderr: ${res.stderr})`);
    assert.equal(fake.calls.dispatches.length, 1);
  } finally {
    await fake.close();
    fs.rmSync(link, { force: true });
    fs.rmSync(tree.dir, { recursive: true, force: true });
  }
});
