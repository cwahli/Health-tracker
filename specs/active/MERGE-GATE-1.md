---
id: MERGE-GATE-1
status: locked
class: FAIL_OPEN_MERGE
edit_mode: rewrite
skill: debug-contract
auto_go: false
allowed_files:
  - scripts/lib/merge-gate.mjs
  - scripts/auto-merge.mjs
  - scripts/assert-auto-merge.test.mjs
  - .github/workflows/auto-merge.yml
  - .github/workflows/ci.yml
  - package.json
  - vite.config.ts
frozen_files:
  - src/App.tsx
  - src/components/LogChat.tsx
  - src/jobs/JobStore.ts
  - server_meal_gate.ts
  - AGENTS.md
  - docs/agent/standing.json
  - scripts/assert-standing.mjs
  - scripts/journey-guard.mjs
  - bots/registry.json
gate:
  - npx tsc --noEmit
  - node scripts/assert-auto-merge.test.mjs
  - node scripts/assert-agent-hygiene.test.mjs
  - npx vitest run tests/registry-inherit.test.ts
---

# MERGE-GATE-1 — make the auto-merge fail closed

## Goal

`auto-merge` may merge an `agent/**` PR only when every required check has
concluded `success`; a required check that is failing, still running, or not
reported yet holds the merge instead.

## Understanding (what this bug is NOT)

- Mechanism: the old step waited for checks to stop being **pending**, then
  merged. Two facts fell out of that and both were live:
  1. a check that already **failed** is not pending — PR #346 merged with
     `tsc + named gates` concluded `failure` in **both** of its runs (the commit
     lacked the mandatory author trailer);
  2. a check that does **not exist yet** is not pending either — PR #340 merged
     at 19:25:46Z while `tsc + named gates` was still running and concluded
     `failure` 66s later.
  Absence of a red light was read as a green light. It is not a race that was
  lost twice by luck; it is a decision that was never made.
- Not this: "wait longer", a bigger `sleep`, a `gh pr checks` retry loop, or
  turning branch protection on. All four leave the decision in the same
  unauditable place, and (3) is an owner-only UI setting this repo has **off** —
  which is *why* the workflow is the enforcement.
- Not this either: making `ci` blockier, adding checks, or touching what `ci`
  runs. The gate reads the check runs that already exist.
- Evidence: PR #340 (merged 19:25:46Z, gate red at 19:26:52Z) and PR #346 (merged
  19:56:57Z, head `05feb59` carrying two red `tsc + named gates` runs). Both
  verifiable from the Checks API and the PR timeline.
- Non-goal: redesigning CI, or deciding *what* should be required.

## Layer (pick ONE; siblings are frozen)

- Layer: process (scripts + the merge workflow). No product code.
- Frozen: `src/**`, `server*.ts`, `bots/registry.json` (a bot does not merge a
  PR), and the *content* of the required set — this change fixes the decision
  procedure, and the required set stays the pair
  `docs/agent/GITHUB_WORKFLOW.md` §3a already names.

## Forbidden patch (named)

- No symptom-hide: a longer `sleep`, or `return` before merging whenever
  `pending.length !== 0` — the two bugs above are both compatible with that.
- No "merge anyway after N minutes" fallback. A timeout is a refusal.
- No new required checks and no new workflow. The change is the merge path.
- No `if: always()` / `continue-on-error` on the merge step.
- No second merge path: `scripts/auto-merge.mjs` is the only thing that PUTs a
  merge, and every early exit from it is "did not merge".
- No hand-maintained list that can silently drift into a permanent stall: the
  required names are re-derived from the workflow files at run time and a
  rename fails the run instead of waiting forever.

## Two-sided fixture (prove structure, not symptom)

- Broken input → correct output: `scripts/assert-auto-merge.test.mjs` spawns the
  real driver against a fake GitHub API on a loopback port and asserts on what
  the fake was **asked** to do — a red required check produces **no** merge call
  and a comment naming it; a head with no check runs yet that turns green later
  is polled, not merged, and merges only after; a wait that is exhausted refuses.
- Adjacent input → unchanged: a green head still merges **exactly once** and
  deletes the branch; a non-required failure (`open-pr`, a worker build) never
  blocks and never merges on its own; `--evaluate` decides and writes nothing;
  no open PR is a no-op rather than an error.

## In scope

- `scripts/lib/merge-gate.mjs` — the pure decision (`merge` / `wait` / `refuse`),
  worst-run-wins, absence on the `wait` side, and the workflow cross-check.
- `scripts/auto-merge.mjs` — the I/O driver, with `filter=all` on the check-run
  read so a red run can never hide behind a greener one of the same name.
- `.github/workflows/auto-merge.yml` — a thin shell over the driver.
- The sensor in CI, `package.json`, `vite.config.ts`.

## Out of scope

- Branch protection / rulesets. They are owner-only, and this gate must hold
  without them — but if they are ever enabled the merge PUT is rejected and the
  reason is posted as a comment.
- `docs/agent/GITHUB_WORKFLOW.md`. It already names the required pair and is a
  protected process doc; the rule is implemented in code and stated here rather
  than edited there.
- The claim lock, auto-pr, and every other workflow.

## Done when

1. `node scripts/assert-auto-merge.test.mjs` is green, including the E2E that a
   red required check never produces a merge call.
2. The required names are proven to be the ones GitHub really reports (checked
   against the live Checks API, not assumed from the YAML), and a rename fails
   the run.
3. The new behaviour is observed on this change's own PR: the merge is held
   while the required checks run, and no merge happens before they conclude.
4. `git diff --name-only` ⊆ allowed_files; the gate commands exit 0.

## Residual (honest)

- `edit_mode: rewrite` is deliberate: `auto-merge.yml` is 88 lines of inline
  `actions/github-script` at HEAD and becomes a 50-line shell, so the diff is
  ~200% churn and the `patch` rule would reject it. The deleted body is the bug;
  keeping it to satisfy a line rule would keep the untestable decision.
- The gate is only as strong as the required set, and that set is still a
  hand-written pair. It is now *checked against the workflows* (a rename fails
  loudly), but nothing forces a newly added check to become required. Deriving
  the required set from branch protection is the honest fix and is out of scope
  while protection is off.
- A required check that concludes `cancelled` on the head SHA (possible via
  `ci`'s `cancel-in-progress`) refuses and does not self-heal — the PR needs one
  more push. That is fail-closed on purpose, and it is a stall to report rather
  than a reason to merge.
- No live red-check demonstration was produced *in this repo by breaking a
  check*; the refusal is exercised against the fake API and the two historical
  red PRs are cited as evidence. The clean path is exercised on this change's own
  PR end to end.
