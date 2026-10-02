---
id: RED-MAIN-1
status: done
class: FAIL_OPEN_MERGE
edit_mode: patch
skill: debug-contract
auto_go: false
allowed_files:
  - scripts/lib/merge-gate.mjs
  - scripts/auto-merge.mjs
  - scripts/assert-auto-merge.test.mjs
  - scripts/lib/fake-github.mjs
  - .github/workflows/auto-merge.yml
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
  - node scripts/assert-main-verify.test.mjs
  - node scripts/assert-agent-hygiene.test.mjs
---

# RED-MAIN-1 — a red `main` refuses the next merge

## Goal

A `main` whose post-merge verification concluded `failure` blocks the next merge,
and the operator has one explicit, recorded way to land the fix anyway.

## Understanding (what this bug is NOT)

- Mechanism: `main-verify` (MAIN-VERIFY-1) produces the signal and **nothing
  consumed it**. The gate read only the PR head — the right question for a PR and
  the wrong one for a repository. Two PRs can each pass their own gates and still
  break `main` together, which is the one failure mode a per-PR gate structurally
  cannot see; landing a second change on a tree that is already failing makes the
  breakage harder to attribute and doubles what has to be untangled.
- Not this: blocking on an *unknown* verdict. A `cancelled` verification is the
  live normal state of a commit a second merge overtook (measured: `111daac` is
  `cancelled` because `6a8cb0d` superseded it). Reading that as red would deadlock
  every merge behind a run that never re-fires. Unknown is not a claim of health —
  the next verification re-covers the whole tree, so the breakage still surfaces.
- Not this either: blocking on an in-progress verification. That serializes every
  clustered merge behind a ~3 minute run and turns a slow runner into a stopped
  queue, for a state that resolves itself.
- Not this either: a longer wait, or a "merge anyway after N minutes" fallback.
  The first does not answer "is main broken", and the second is the fail-open
  behaviour this whole sequence removes.
- Evidence: `main-verify` on `e97ba45` and `6a8cb0d` are `success`, `111daac` is
  `cancelled`, and the check is named `gates / tsc + named gates` on every commit
  on main — read live, not inferred.

## Layer (pick ONE; siblings are frozen)

- Layer: process (scripts + the merge workflow).
- Frozen: `src/**`, `server*.ts`, `bots/registry.json`; the **required set** (this
  adds a question about `main`, it does not change what a PR must pass); and
  `.github/workflows/ci.yml`, which another agent's open PR owns right now — the
  claim lock is doing its job, and the sensor did not need a new CI step because
  the existing merge-gate sensor already has one.

## Forbidden patch (named)

- No symptom-hide: no timeout that proceeds, and no silently treating `failure` as
  unknown.
- No deadlock: a hard block would also refuse the PR that fixes `main`, because
  the only way to change `main` is to merge. The escape is an explicit operator
  override (`--allow-red-main`, `ALLOW_RED_MAIN=1`, or the `workflow_dispatch`
  input) that names the reason in the run log and on the PR. It is never reached
  by a timeout or by the driver's own judgement.
- No new workflow, no new required check, no second read of the PR's own checks.
- No widening of what counts as "main is broken": only the verification of main
  counts. A red `open-pr` on main is not main being broken.

## Two-sided fixture (prove structure, not symptom)

- Broken input → correct output: a fully green PR on a red `main` produces **zero**
  merge calls, zero dispatches, and a comment that says `main` is at fault and the
  PR does not need a new commit.
- Adjacent input → unchanged: a green PR on a green `main` merges once; on a
  `cancelled` main it still merges and logs `unknown` rather than wedging; on a
  `main` with no verification it merges and says so; a red PR refuses **without
  even reading main**; and the same red main with `--allow-red-main --pr=7` merges,
  records the override, and re-dispatches the verification.

## In scope

- `scripts/lib/merge-gate.mjs` — the three-valued classification of main, and the
  name it is read under.
- `scripts/auto-merge.mjs` — reading main's head before merging, and the override.
- The dispatch input that makes the override reachable without a local checkout.

## Out of scope

- **Telling a human.** A red main now blocks merges, which is a real consequence,
  but nobody is notified; the failure is still visible only on the commit and in
  the merge log. That is the next reader to write.
- Branch protection, so a direct push to `main` still bypasses all of this.
- The read is the head only: a `main` that was red two commits ago and green since
  is green, which is the intended reading.

## Done when

1. `node scripts/assert-auto-merge.test.mjs` is green, including that a green PR
   does not merge while main is red and that the override does land it.
2. The classification is pinned in both directions: `failure`/`timed_out` red,
   `success` green, `cancelled`/absent/in-progress unknown and not blocking.
3. The read is exercised against the live API, not only the fake.
4. `git diff --name-only` ⊆ allowed_files; the gate commands exit 0.

## Residual (honest)

- Detection is **post-hoc by construction**: the merge that breaks `main` still
  lands, and the block only stops the *next* one. That is what a post-merge
  verification can do, and it is stated rather than glossed.
- A red `main` now means a stopped queue. The fix has to arrive either through the
  explicit override or by the operator pushing to `main` directly. That is a
  deliberate, documented consequence, not a bug — but it is a new way for the
  fleet to stall, so it is named here.
- `--pr=` is the operator's entry point and is exercised through the fake, not
  live: reaching it for real means a human clicking "Run workflow".
- Only `main`'s head is read. A red verification that a later merge superseded is
  invisible by design — `cancelled` cannot be distinguished from "we stopped
  caring", so it is treated as unknown.

<!-- closed 2026-10-02: gates assert-auto-merge 89/89 and assert-main-verify 17/17 green; the override path was exercised on #422 -->
