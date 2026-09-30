/**
 * premerge-undo — judge a branch's diff for undeclared landed-line rewrites
 * BEFORE it merges.
 *
 * Why this exists. The landed-work rule ("a change may extend landed work and
 * may not silently erase it") was only ever enforced at two moments:
 *
 *   - on `pull_request` runs — which never fire for this repo's PRs, because
 *     auto-pr opens them with GITHUB_TOKEN and GitHub does not run workflows in
 *     response to its own token's events. Those runs land in `action_required`
 *     with ZERO jobs. The rule has never once executed here.
 *   - post-merge, on `main-verify` — where it runs against the squash message.
 *     Correct, and far too late.
 *
 * Push-event `ci` deliberately skips the step (its event carries no PR body, so
 * judging commit messages there fails work the body already declares). So for
 * every agent PR the rule was judged *only after* the merge. That is not a
 * warning: it is how `d18568f6` landed three rewritten lines with no
 * `Reverts:` and turned `main` red, which fail-closed every agent PR behind it
 * for an hour.
 *
 * The fix is placement, not a new rule. `auto-merge` is the one job that runs on
 * the same push, already waits for the PR to be opened (`findOpenPr`), and
 * already holds the PR body — so it can judge the branch with the declaration
 * source that actually exists, and refuse with a comment on the PR instead of
 * discovering the problem on `main`.
 *
 * Decisions, and why there are three:
 *
 *   - `merge`   — judged, and clean. The ordinary path.
 *   - `refuse`  — judged, and it rewrites landed work without declaring it. Hard
 *     stop, never waivable — not even by `allow_red_main`, which exists to land
 *     a fix onto a red main and says nothing about this branch's own diff.
 *   - `unknown` — the judgment could not be made (no history in the checkout, no
 *     merge-base). This does NOT block, and it does NOT comment on the PR. A
 *     merge gate that deadlocks the queue on infrastructure noise gets switched
 *     off, and an alert that fires on noise destroys the alert: a comment on
 *     every PR in a degraded environment is how people learn to ignore the one
 *     comment that matters. It is logged loudly in the run log — where an
 *     operator debugging a stall is already looking — and the post-merge check
 *     remains the backstop.
 */

export const PREMERGE_DECISIONS = Object.freeze({
  MERGE: 'merge',
  REFUSE: 'refuse',
  UNKNOWN: 'unknown',
});

/**
 * @param {{violations?: Array, error?: string, prNumber?: number, baseBranch?: string}} input
 * @returns {{decision: string, violations: Array, reason: string}}
 */
export function decideBranchUndo({ violations = [], error = '', prNumber, baseBranch = 'main' } = {}) {
  const found = Array.isArray(violations) ? violations.filter(Boolean) : [];

  if (error) {
    return {
      decision: PREMERGE_DECISIONS.UNKNOWN,
      violations: found,
      reason: `\`${baseBranch}\` could not be resolved for judging — ${error}`,
    };
  }
  if (found.length === 0) {
    return {
      decision: PREMERGE_DECISIONS.MERGE,
      violations: [],
      reason: `no undeclared rewrite of landed work in this branch`,
    };
  }
  return {
    decision: PREMERGE_DECISIONS.REFUSE,
    violations: found,
    reason:
      `rewrites ${found.length} line${found.length === 1 ? '' : 's'} of landed work ` +
      `without declaring it in the PR body`,
  };
}

/** One line per violation, shaped so the owner and the two valid moves are visible. */
export function formatViolations(violations = []) {
  return violations.map((v) => {
    const where = [v.file, v.line == null ? null : `line ${v.line}`].filter(Boolean).join(':');
    const owner = v.owner ? ` — owned by \`${String(v.owner).slice(0, 8)}\`` : '';
    const text = typeof v === 'string' ? v : `${where}${owner}`;
    return `- ${text}`;
  });
}

/** The comment posted on a refusal: what was found, and the two ways out. */
export function describePremergeRefusal({ decision, violations = [], reason = '', prNumber, baseBranch = 'main' } = {}) {
  if (decision !== PREMERGE_DECISIONS.REFUSE) return '';
  return [
    `🛑 **Merge refused — landed work would be silently erased.**`,
    ``,
    `This branch ${reason}. The landed-work rule is judged here, before the merge, ` +
      `so it is a comment on the PR rather than a red \`${baseBranch}\`.`.trim(),
    ``,
    formatViolations(violations).join('\n'),
    ``,
    `**Two valid ways out — pick one:**`,
    `1. **Extend, don't erase.** Restore the landed line and keep the new work.`,
    `2. **Declare it.** Add a line to this PR body naming the commit you rewrite:`,
    `   \`Reverts: <sha> — why this is a deliberate change to landed work\``,
    ``,
    `The declaration is recorded on the squash, so the history says why rather than ` +
      `looking like an accident. \`Resurrects: <path> — why\` is the same move for a ` +
      `file a later PR deleted.`,
    ``,
    // Without this the refusal is a dead end: the gate runs on PUSH, and
    // editing a PR body is not a push, so nothing re-runs it. A gate that
    // refuses and does not say how to proceed is a stall, and this repo treats
    // a stall as a bug to report rather than a reason to give up.
    prNumber
      ? `Then re-run the merge: \`gh workflow run auto-merge.yml -f pr=${prNumber}\` ` +
        `(or push any commit — the judgement re-runs on every push to this branch).`
      : `Then re-run the merge job, or push any commit — the judgement re-runs on every push.`,
  ].join('\n');
}

/**
 * The run-log line for a judgment that could not be made.
 *
 * A comment on the PR is deliberately NOT posted here. See the module header:
 * a signal that fires on infrastructure noise is a signal people stop reading,
 * and this one shares a channel with the refusal that must be read. The run log
 * is where a degraded environment is diagnosed, and it is not read once and
 * skimmed.
 */
export function describePremergeUnknown({ reason = '', baseBranch = 'main' } = {}) {
  return `⚠ landed-work check did not run — not blocking. ${reason} ` +
    `The rule is still enforced post-merge on \`${baseBranch}\`.`;
}