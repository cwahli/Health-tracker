/**
 * merge-gate.mjs — the ONE place that decides whether an `agent/**` PR may merge.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * `auto-merge.yml` merged PRs whose required checks had FAILED. Not a near miss:
 *
 *   - PR #340 merged at 19:25:46Z while `tsc + named gates` was still running,
 *     and it concluded `failure` 66s later.
 *   - PR #346 merged with `tsc + named gates` already concluded `failure` in
 *     BOTH of its runs (the commit lacked the mandatory author trailer).
 *
 * The old step waited for checks to stop being *pending* and then merged. Two
 * things fell out of that: a check that had already FAILED is not pending, so it
 * merged anyway; and a check that did not EXIST yet is not pending either, so on
 * a fast push the loop saw an empty list and merged before CI had even started.
 * Absence of a red light was read as a green light.
 *
 * So the question "may this merge?" is answered here, as a pure function of the
 * check runs GitHub reports for the PR head, and the answer has exactly three
 * values — `merge`, `wait`, `refuse` — with absence on the `wait` side:
 *
 *   - a required check with NO run yet          -> wait   (not permission)
 *   - a required check still running            -> wait
 *   - any run of a required name not `success`  -> refuse
 *   - every run of every required name success  -> merge
 *
 * WORST WINS. One red run of a required name blocks even if another run of the
 * same name is green, because a PR really does have two runs of `tsc + named
 * gates`: one on the `push` event and one on the `pull_request` event, and they
 * run different steps (the `pull_request` one also checks the PR body). Taking the
 * best of the two is exactly how a red `pull_request` run got merged into main.
 *
 * THE REQUIRED SET IS REVIEWED, NOT DERIVED. It is the pair
 * docs/agent/GITHUB_WORKFLOW.md §3a already names for branch protection. That
 * setting cannot be committed (it is owner-only UI, and this repo has it off —
 * `main` is currently unprotected), so this list is the enforcement.
 *
 * AND IT READS MAIN, NOT ONLY THE PR.
 *
 * A green PR is not a green repository. Two PRs can each pass their own gates and
 * still break `main` together — the one failure mode a per-PR gate structurally
 * cannot see — which is why `main-verify` exists at all. Its result is consumed
 * here: a `main` whose post-merge verification *failed* refuses the next merge,
 * because landing on a known-broken main is how one break becomes two.
 *
 * What is read is deliberately three-valued, because conflating these would
 * either stall the queue or lie about it:
 *
 *   - `failure` / `timed_out` / `startup_failure` -> RED, and it blocks.
 *   - a `success` run                             -> GREEN, and it passes.
 *   - `cancelled`, still running, or absent       -> UNKNOWN, and it does not
 *     block. A `cancelled` verification means a newer merge superseded it, not
 *     that main is broken; treating it as red would deadlock every merge behind
 *     a run that will never re-fire. Unknown is not a claim of health — the next
 *     verification re-covers the whole tree, so the breakage still surfaces.
 *
 * Everything here is pure: no network, no `gh`, no clock of its own. The driver
 * (`scripts/auto-merge.mjs`) does the I/O; the sensor drives this directly.
 */

/**
 * The checks that must have concluded `success` before an `agent/**` PR merges.
 *
 * `workflow`/`job` are the source-of-truth locators inside this repo; `name` is
 * what the Checks API reports and therefore what is matched at runtime. The
 * sensor re-derives `name` from the workflow files, so a job rename cannot
 * silently turn this list into a permanent stall — the gate fails instead.
 */
export const REQUIRED_CHECKS = [
  { workflow: 'ci', job: 'gates', name: 'tsc + named gates' },
  { workflow: 'claim-guard', job: 'no-overlap', name: 'no-overlap' },
];

/**
 * Check names that are never required and never block.
 *
 * `merge-agent-pr` is this job's own check: it cannot complete while it is
 * deciding, so treating it as pending would deadlock the gate.
 */
export const NON_BLOCKING_CHECKS = new Set(['merge-agent-pr']);

export const DECISIONS = ['merge', 'wait', 'refuse'];

/** The check names that must be green. */
export function requiredNames(required = REQUIRED_CHECKS) {
  return (required || []).map((r) => String(r.name || r));
}

/** True when a conclusion counts as a pass. */
export function isGreen(conclusion) {
  return String(conclusion || '') === 'success';
}

/**
 * Decide from the check runs GitHub reports for one commit.
 *
 * @param {object}   opts
 * @param {object[]} opts.checkRuns  raw Checks API runs (`{name,status,conclusion}`)
 * @param {object[]} opts.required   the required set (defaults to REQUIRED_CHECKS)
 * @param {Iterable} opts.nonBlocking names that are ignored entirely
 */
export function evaluateChecks({ checkRuns = [], required = REQUIRED_CHECKS, nonBlocking = NON_BLOCKING_CHECKS } = {}) {
  const ignore = new Set(nonBlocking || []);
  const runs = (Array.isArray(checkRuns) ? checkRuns : []).filter((c) => c && !ignore.has(String(c.name || '')));

  const byName = new Map();
  for (const run of runs) {
    const name = String(run.name || '');
    if (!name) continue;
    if (!byName.has(name)) byName.set(name, []);
    byName.get(name).push(run);
  }

  const missing = [];
  const pending = [];
  const failed = [];

  for (const entry of required || []) {
    const name = String(entry.name || entry);
    const list = byName.get(name) || [];
    if (list.length === 0) {
      // Not reported yet. On a fresh push this is the normal state for a few
      // seconds, which is why it must WAIT rather than be read as permission.
      missing.push(name);
      continue;
    }
    for (const run of list) {
      if (String(run.status || '') !== 'completed') {
        pending.push(`${name} (${run.status || 'unknown'})`);
        continue;
      }
      if (!isGreen(run.conclusion)) {
        failed.push(`${name} concluded ${String(run.conclusion || 'unknown')}`);
      }
    }
  }

  const summary = {
    required: requiredNames(required),
    counts: { runs: runs.length, missing: missing.length, pending: pending.length, failed: failed.length },
    missing,
    pending,
    failed,
  };

  if (failed.length) {
    return { decision: 'refuse', reason: `required check(s) are not green: ${failed.join('; ')}`, ...summary };
  }
  if (missing.length || pending.length) {
    const parts = [];
    if (missing.length) parts.push(`not reported yet: ${missing.join(', ')}`);
    if (pending.length) parts.push(`still running: ${pending.join(', ')}`);
    return { decision: 'wait', reason: parts.join('; '), ...summary };
  }
  return {
    decision: 'merge',
    reason: `all ${summary.required.length} required check(s) concluded success: ${summary.required.join(', ')}`,
    ...summary,
  };
}

/**
 * The decision for a PR that exists but is not ready to be merged at all.
 * Kept separate from the check logic so a refusal names one reason, not two.
 */
export function evaluatePrState(pr) {
  if (!pr) return { decision: 'refuse', reason: 'no open PR for this branch' };
  if (pr.draft) return { decision: 'refuse', reason: 'the PR is a draft' };
  if (String(pr.state || 'open') !== 'open') return { decision: 'refuse', reason: `the PR is ${pr.state}` };
  if (pr.merged_at) return { decision: 'refuse', reason: 'the PR is already merged' };
  return { decision: 'merge', reason: 'the PR is open' };
}

/** One line a human can read in a PR comment or a run log. */
export function describeDecision(result, { head = '' } = {}) {
  const where = head ? ` on \`${String(head).slice(0, 7)}\`` : '';
  const head7 = {
    merge: `✅ merge${where}: ${result.reason}`,
    wait: `⏳ waiting${where}: ${result.reason}`,
    refuse: `⛔ NOT merging${where}: ${result.reason}`,
  };
  return head7[result.decision] || `? unknown decision: ${JSON.stringify(result.decision)}`;
}

/**
 * Re-derive the required check NAMES from the workflow files that produce them.
 *
 * A required check that no workflow emits is a permanent stall: the gate would
 * wait forever for a name that can never appear. That failure mode is silent and
 * total, so it is checked against the real YAML text instead of trusted. Returns
 * every problem rather than the first, so one run names all of them.
 */
/**
 * The check a post-merge verification of `main` reports as.
 *
 * `main-verify.yml` calls `ci.yml` through `workflow_call`, so GitHub names the
 * check `<caller job> / <called job name>` — observed live as
 * `gates / tsc + named gates` on every commit on main. A human pushing straight
 * to main runs `ci.yml` directly and the same job reports as plain
 * `tsc + named gates`. Both are the same gate, so the suffix is what is matched
 * and a rename of the caller's job cannot silently stop this from firing.
 */
export const MAIN_VERIFICATION_CHECK = /^.*(?:^|\/ )tsc \+ named gates$/;

/** Conclusions that mean main is known broken. */
export const MAIN_BROKEN_CONCLUSIONS = new Set(['failure', 'timed_out', 'startup_failure']);

/** True when a check name is a verification of main rather than of a PR head. */
export function isMainVerification(name) {
  return MAIN_VERIFICATION_CHECK.test(String(name || ''));
}

const shortSha = (sha) => (sha ? `\`${String(sha).slice(0, 7)}\`` : 'main');

/**
 * Classify `main` from the check runs on its head commit.
 *
 * @param {object}   opts
 * @param {object[]} opts.checkRuns raw Checks API runs for main's head
 * @param {string}   opts.mainSha   that commit, for the message
 */
export function evaluateMainHealth({ checkRuns = [], mainSha = '' } = {}) {
  const runs = (Array.isArray(checkRuns) ? checkRuns : []).filter((c) => c && isMainVerification(c.name));
  const at = shortSha(mainSha);
  const completed = (c) => String(c.status || '') === 'completed';

  const broken = runs.filter((c) => completed(c) && MAIN_BROKEN_CONCLUSIONS.has(String(c.conclusion || '')));
  if (broken.length) {
    return {
      health: 'red',
      blocked: true,
      runs: runs.length,
      failed: broken.map((c) => `main ${c.name} concluded ${c.conclusion}`),
      reason: `main itself is red on ${at}: ${broken.map((c) => `\`${c.name}\` concluded \`${c.conclusion}\``).join('; ')}`,
    };
  }

  const green = runs.filter((c) => completed(c) && String(c.conclusion || '') === 'success');
  if (green.length) {
    return { health: 'green', blocked: false, runs: runs.length, reason: `main is verified green on ${at}` };
  }

  const states = runs.map((c) => `${c.status || 'unknown'}${c.conclusion ? `/${c.conclusion}` : ''}`).join(', ');
  return {
    health: 'unknown',
    blocked: false,
    runs: runs.length,
    reason: runs.length
      ? `main's verification on ${at} has not concluded successfully (${states}) — not treated as a failure`
      : `no post-merge verification has been recorded for ${at}, so this merge neither blocks nor is excused`,
  };
}

export function validateRequiredAgainstWorkflows({ required = REQUIRED_CHECKS, readWorkflow } = {}) {
  const problems = [];
  if (typeof readWorkflow !== 'function') return { ok: false, problems: ['no workflow reader was provided'] };
  for (const entry of required || []) {
    const file = `.github/workflows/${entry.workflow}.yml`;
    let text = '';
    try {
      text = readWorkflow(file) || '';
    } catch {
      problems.push(`${file} is missing (required check "${entry.name}" would never be reported)`);
      continue;
    }
    if (!/^name:\s*\S/m.test(text)) problems.push(`${file} has no top-level name`);
    // The job id (2-space indent, bare key) and its display `name:` are two
    // separate renames; check both so either one is caught.
    const jobId = new RegExp(`^ {2}${String(entry.job).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:\\s*$`, 'm');
    if (!jobId.test(text)) problems.push(`${file} has no job "${entry.job}" (required check "${entry.name}")`);
    const jobName = new RegExp(`^ {4}name:\\s*${String(entry.name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'm');
    if (!jobName.test(text)) problems.push(`${file} job "${entry.job}" no longer reports as "${entry.name}"`);
  }
  return { ok: problems.length === 0, problems };
}
