---
id: MERGE-GATE-1
status: locked
class: FAIL_OPEN_MERGE
edit_mode: rewrite
skill: debug-contract
auto_go: false
allowed_files:
  - scripts/lib/merge-gate.mjs
  - scripts/lib/premerge-undo.mjs
  - scripts/auto-merge.mjs
  - scripts/assert-auto-merge.test.mjs
  # The driver's import graph grew, and this fixture copies it file by file —
  # without the two new modules the scratch tree dies with
  # ERR_MODULE_NOT_FOUND and every E2E in that file fails for the wrong reason.
  # (Shared with MAIN-VERIFY-1, which already lists auto-merge.mjs too.)
  - scripts/assert-main-verify.test.mjs
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

## Extension (2026-09-30) — the second thing this gate must refuse

Added while closing out the health work, because it is the same defect class and
it cost this repo an hour.

**What was missing.** The landed-work rule ("a change may extend landed work and
may not silently erase it") had no pre-merge home for this repo's PRs. Push-event
`ci` deliberately skips the step — its event carries no PR body, so judging
commit messages there fails work the body already declares — and auto-pr's
`GITHUB_TOKEN`-opened PRs run **zero jobs**, because GitHub does not run
workflows in response to its own token's events. The rule therefore ran *only*
post-merge, against the squash message. `d18568f6` landed three rewritten lines
with no `Reverts:` that way and turned `main` red, which fail-closed every agent
PR behind it (issue #401). The queue stalled on a violation that had not been
judged, not on one that was judged and ignored.

**What changed.** `scripts/lib/premerge-undo.mjs` (pure, and the only new file)
plus a call in `auto-merge.mjs` before it waits on checks — `auto-merge` is the
one job that already runs on the same push, already waits for the PR to be
opened (`findOpenPr`), and already holds the PR body, which is the declaration
source that actually exists. The judgement itself is **`checkRange` from
`lib/no-undo.mjs`** — the same code the CI step and the post-merge verification
run — so the rule has one implementation and three call sites rather than one
implementation and three opinions. `.github/workflows/auto-merge.yml` gains
`fetch-depth: 0`: at the default depth 1 there is no `origin/main`, no fork point
and no owning commits, so the gate would degrade to "could not judge" on every PR
— indistinguishable from a gate nobody enabled.

**Three decisions, and why the third does not block.** `merge` (judged clean),
`refuse` (judged, and it erases landed work undeclared — a hard stop, never
waivable, and deliberately **not** waived by `allow_red_main`, which exists to
land a fix onto a red main and says nothing about this branch's own diff), and
`unknown` (could not judge). `unknown` logs loudly and does **not** comment on the
PR: a gate that deadlocks the queue on infrastructure noise gets switched off,
and a signal that fires on noise destroys the signal it shares a channel with.
The post-merge check remains the backstop.

**Gate additions.** Eleven tests in `assert-auto-merge.test.mjs`, driven against
**real git** (`mkdir` + `git init` + commits), not a stub: an add-only branch
merges; an undeclared rewrite refuses and names the owning commit; the same
branch merges once the body declares it; **declaring a different commit does not
wave it through**; a deleted landed file refuses; a missing head SHA and an
unresolvable base are `unknown`, never a silent pass; the refusal names the owner
and both valid moves; and the workflow pins `fetch-depth: 0`.

**Proven red, three ways.** Removing `fetch-depth: 0` fails the workflow test;
dropping the PR body from the judgement fails the declaration test; reverting
the loader-style wiring in the driver fails the ordering test. The scratch-repo
fixture caught its own bug first — a fixture that commits "the change" onto
`main` makes the landed ref and the head the same commit, so the gate finds
nothing and looks exactly like a working one.

**Still out of scope.** `ci.yml` is untouched: it is claimed by another lane
(#405), and the one-file-one-owner rule holds. The `pull_request` run that never
fires is *not* repaired here — auto-merge is used as the pre-merge venue instead,
which needs no workflow-trigger change and cannot be starved by the
token-event rule.

### The body re-read, and why it is part of this change

A declaration is only as good as the body that carries it, so the gate re-reads
the PR before it judges. That re-read was proposed separately (#417, measured
from #414) and **did not land**: `11d79b3f`, whose squash title reads *"the merge
driver re-reads the PR body; the canary sensor follows the bind"*, contains **only
`scripts/assert-swap-guards.test.mjs`**. `grep fresh scripts/auto-merge.mjs` on
main returns nothing, and `assert-auto-merge.test.mjs` on main carries no test for
it. The auto-merge half was dropped before the merge — the PR's final file list is
one file — leaving the root cause of the #416 stall unfixed behind a title that
says otherwise.

That matters here rather than being someone else's cleanup, because a stale body
breaks this gate in both directions: a declared rewrite reads as undeclared (a
refusal for nothing, which is what `d18568f6`'s cousin did to #414), and an
undeclared rewrite that later declares is let through on a skeleton. So the
declaration source is re-read, and the judgement runs twice:

- **early**, before the check wait, so a refusal arrives as a comment on the PR
  instead of after several minutes of polling;
- **immediately before the merge PUT**, which is the decision — only there is the
  body known to be the body that will be squashed.

`refreshPr` takes only strings, so a `null` body cannot erase a declaration, and a
failed read keeps the body in hand rather than failing the merge. Both moments
call the same judgement, so there is still one implementation.

**Gate additions.** Four E2E in `assert-auto-merge.test.mjs`, run against a real
scratch repo and the real driver with only GitHub faked: a declaration added
during the wait is seen and the PR merges (a stale read would refuse it); a
declaration *removed* before the merge is still caught and nothing merges; an
undeclared rewrite is refused before the checks are even polled; and a re-read
that fails or returns `null` cannot throw or wipe the body. Proven red both ways:
neutering the re-read fails the first, removing the final judgement fails the
second.

**Residual.** The re-read costs two extra `GET /pulls/:n` per merge. The early
judgement can still be superseded by the final one, which is the point — it is
feedback, not the decision.
