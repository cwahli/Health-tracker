/**
 * main-verify.mjs — getting `main` a CI run it can no longer get by itself.
 *
 * WHY THIS EXISTS
 * ---------------
 * `ci.yml` triggers on `push: branches: [main]`, and the comment above that
 * trigger says the path exists to re-check the landed squash commit — the
 * trailer gate's main-push branch was written for the seven trailer-less commits
 * that landed on 2026-09-27.
 *
 * It has never run. Every commit on `main` is a squash merge performed by
 * `merge-agent-pr` with the repository's `GITHUB_TOKEN`, and GitHub suppresses
 * workflow triggers for token-driven pushes:
 *
 *   "When you use the repository's GITHUB_TOKEN to perform tasks, events
 *    triggered by the GITHUB_TOKEN, with the exception of workflow_dispatch and
 *    repository_dispatch, will not create a new workflow run."
 *
 * Measured, not assumed: the last eight commits on `main` report no workflow run
 * at all. So the PR head is the only commit CI has ever seen — and the
 * *composition* of two separately-green PRs is never verified, which is the one
 * failure mode a per-PR gate structurally cannot see.
 *
 * THE FIX IS THE EXCEPTION, NOT A WORKAROUND
 * ------------------------------------------
 * `repository_dispatch` is explicitly exempt from that suppression, so the merge
 * driver asks for the verification instead of hoping a trigger fires: after a
 * successful merge it dispatches `main-verify`, and
 * `.github/workflows/main-verify.yml` reuses `ci.yml`'s gate job through
 * `workflow_call`. One suite, one definition, no second list to drift.
 *
 * A `workflow_run` chain on the merge job was the other candidate and was
 * rejected: this file's whole reason for existing is that the trigger it would
 * depend on is the suppressed kind, and the dispatch is the documented exception
 * rather than a chain that has to be trusted.
 *
 * Everything here is pure — it builds the request body and checks the wiring of
 * the workflows it depends on. The network call is in `scripts/auto-merge.mjs`.
 */

/** The dispatch event type. The workflow's `types:` must match this exactly. */
export const MAIN_VERIFY_EVENT = 'main-verify';

export const MAIN_VERIFY_WORKFLOW = '.github/workflows/main-verify.yml';
export const CI_WORKFLOW = '.github/workflows/ci.yml';

/** The reusable workflow the verify job calls. */
export const CI_REUSE = './.github/workflows/ci.yml';

/** The dispatch endpoint for a repo. Exported so the sensor asserts the same path. */
export function dispatchEndpoint(owner, repo) {
  return `/repos/${owner}/${repo}/dispatches`;
}

/**
 * Build the `POST /dispatches` body for a merge commit.
 *
 * The `sha` matters: a `repository_dispatch` verifies whatever the default
 * branch points at when the event is created, and stating the commit that landed
 * is what makes the run provably about *that* merge rather than about main in
 * general. A missing sha is not an error (the workflow falls back to the branch
 * head and says so in its run name), but it is worth knowing, so it is omitted
 * rather than invented.
 */
export function buildDispatch(sha, { eventType = MAIN_VERIFY_EVENT } = {}) {
  const clean = typeof sha === 'string' && sha.trim() !== '' ? sha.trim() : null;
  return { event_type: eventType, client_payload: clean ? { sha: clean } : {} };
}

/** One line for the run log and the PR comment. */
export function describeDispatch(outcome) {
  if (!outcome || typeof outcome !== 'object') return 'main verification: no attempt was made';
  if (outcome.ok) {
    return `main verification dispatched (\`${MAIN_VERIFY_EVENT}\`${outcome.sha ? ` on \`${outcome.sha.slice(0, 7)}\`` : ''})`;
  }
  return `main verification NOT dispatched: ${outcome.detail || 'unknown error'}`;
}

/**
 * Check that the dispatch has somewhere to land.
 *
 * A dispatched event with no workflow listening for it is a silent no-op — the
 * merge succeeds, the driver reports success, and `main` is unverified, which is
 * exactly the state this change exists to end. So the wiring is checked instead
 * of trusted, and every problem is returned rather than the first.
 */
export function validateMainVerifyWiring({ readWorkflow } = {}) {
  const problems = [];
  if (typeof readWorkflow !== 'function') return { ok: false, problems: ['no workflow reader was provided'] };

  const read = (rel) => {
    try {
      return readWorkflow(rel) || '';
    } catch {
      return null;
    }
  };

  const verify = read(MAIN_VERIFY_WORKFLOW);
  if (verify === null) {
    problems.push(`${MAIN_VERIFY_WORKFLOW} is missing (a dispatched "${MAIN_VERIFY_EVENT}" would land nowhere)`);
  } else {
    if (!/^name:\s*\S/m.test(verify)) problems.push(`${MAIN_VERIFY_WORKFLOW} has no top-level name`);
    // The suppressed trigger is `push`. If this workflow only listened on `push`
    // it would reproduce the bug: a token merge fires no push event at all.
    if (!/^ {2}repository_dispatch:\s*$/m.test(verify)) {
      problems.push(`${MAIN_VERIFY_WORKFLOW} does not listen on repository_dispatch (the suppression-exempt trigger)`);
    }
    const types = new RegExp(`^ {4}types:\\s*\\[\\s*${MAIN_VERIFY_EVENT.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\]\\s*$`, 'm');
    if (!types.test(verify)) {
      problems.push(`${MAIN_VERIFY_WORKFLOW} does not declare types: [${MAIN_VERIFY_EVENT}]`);
    }
    if (!/^\s+uses:\s*\.\/\.github\/workflows\/ci\.yml\s*$/m.test(verify)) {
      problems.push(`${MAIN_VERIFY_WORKFLOW} does not call ${CI_REUSE} (a second gate list would drift)`);
    }
  }

  const ci = read(CI_WORKFLOW);
  if (ci === null) {
    problems.push(`${CI_WORKFLOW} is missing`);
  } else if (!/^ {2}workflow_call:\s*(\{\s*\})?\s*$/m.test(ci)) {
    problems.push(`${CI_WORKFLOW} does not declare \`workflow_call:\` (it cannot be reused as the main gate)`);
  }

  return { ok: problems.length === 0, problems };
}
