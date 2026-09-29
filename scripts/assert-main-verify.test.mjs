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
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runDriver, startFakeGitHub } from './lib/fake-github.mjs';
import {
  CI_WORKFLOW,
  MAIN_VERIFY_EVENT,
  MAIN_VERIFY_WORKFLOW,
  buildDispatch,
  describeDispatch,
  dispatchEndpoint,
  validateMainVerifyWiring,
} from './lib/main-verify.mjs';

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
  for (const rel of ['auto-merge.mjs', 'lib/merge-gate.mjs', 'lib/main-verify.mjs']) {
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
