---
id: MAIN-VERIFY-1
status: locked
class: FAIL_OPEN_MERGE
edit_mode: patch
skill: debug-contract
auto_go: false
allowed_files:
  - scripts/lib/main-verify.mjs
  - scripts/lib/fake-github.mjs
  - scripts/assert-main-verify.test.mjs
  - scripts/auto-merge.mjs
  - scripts/assert-auto-merge.test.mjs
  - .github/workflows/main-verify.yml
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
  - node scripts/assert-main-verify.test.mjs
  - node scripts/assert-auto-merge.test.mjs
  - node scripts/assert-agent-hygiene.test.mjs
---

# MAIN-VERIFY-1 — `main` gets a CI run after every merge

## Goal

Every commit that lands on `main` gets a real CI run — the same gate suite from
the same definition — despite the fact that a `GITHUB_TOKEN` push triggers no
workflow at all, and a merge whose verification could not be requested is not
reported as a success.

## Understanding (what this bug is NOT)

- Mechanism: `ci.yml` triggers on `push: branches: [main]`, and the comment over
  that trigger says the path exists to re-check the landed squash commit. **It has
  never fired.** Every commit on `main` is a squash merge written by
  `merge-agent-pr` with the repository's `GITHUB_TOKEN`, and GitHub documents that
  token-driven events do not create workflow runs — "with the exception of
  `workflow_dispatch` and `repository_dispatch`". Measured rather than inferred:
  the last eight commits on `main` report no workflow run whatsoever.
- Not this: a longer wait, a retry, an `if: always()` re-run, or a `workflow_run`
  chain on the merge job. Each depends on a trigger that is either the suppressed
  kind or a chain that has to be taken on faith; the dispatch is the documented
  exception instead.
- Not this either: requiring a PAT or a GitHub App token so the push fires. That
  makes `main` get verified only once a human has provisioned a second credential
  — the one thing this must not depend on.
- Not this either: giving `main` its own copy of the gate list. Two lists drift,
  and the copy would be the one nothing exercises.
- Evidence: `gh run list --commit <sha>` is empty for all of `f4e10be`,
  `76104b4`, `7888bee`, `a67b71a`, `998ae0a`, `ed087b4`, `96423fc`, `c08eb74`.
- Non-goal: changing what the gates are, or who may merge.

## Layer (pick ONE; siblings are frozen)

- Layer: process (scripts + workflows). No product code.
- Frozen: `src/**`, `server*.ts`, `bots/registry.json`, the gate list itself, and
  the required-check set — this change adds a *consumer* of the suite, not a
  second suite.

## Forbidden patch (named)

- No second gate list: `main-verify.yml` calls `ci.yml` through `workflow_call`.
- No push-only trigger for the verification (that is the bug, restated).
- No silent no-op: a dispatch nobody listens for is a merge that must not be
  reported as a success, so the wiring is validated before the merge, not after.
- No fabricated state: a merge with no reported commit omits the `sha` rather than
  inventing one.
- No host-only credential in the path.

## Two-sided fixture (prove structure, not symptom)

- Broken input → correct output: the real driver, run out of a scratch tree whose
  `ci.yml` has no `workflow_call:`, exits 2, names the reason, and makes **no**
  merge call and **no** check poll. The same for a `push`-only `main-verify.yml`.
- Adjacent input → unchanged: the same tree with intact wiring merges once and
  dispatches once; a red required check still refuses and dispatches nothing;
  `--evaluate` still writes nothing.
- Added after that fixture found it: the driver still merges when invoked through
  a **symlinked path**, because `realpath`-less entry-point detection makes the
  process exit 0 having done nothing — and exit 0 is this driver's signal for
  "merged".

## In scope

- `scripts/lib/main-verify.mjs` — the dispatch body, the outcome line, and the
  wiring check (the workflow exists, listens on the exempt trigger with the right
  type, and reuses `ci.yml`).
- `scripts/auto-merge.mjs` — dispatch after a merge, and the startup guard.
- `.github/workflows/main-verify.yml`, and `workflow_call:` on `ci.yml`.
- `scripts/lib/fake-github.mjs` — the shared fake, so both sensors drive one
  endpoint surface rather than two copies of it.

## Out of scope

- **Acting on a red `main`.** This lands the signal; nothing yet refuses to merge
  onto a broken `main` or opens a ticket when the verification goes red.
- The trailer check on the landed squash commit. The dead `push: [main]` branch
  was written for it, and this change deliberately does not revive it — a new red
  condition on a schedule nobody has watched is not a gate, it is noise.
- Branch protection, and the other ~20 scripts with the same entry-point
  comparison (named in Residual, not fixed here).

## Done when

1. `node scripts/assert-main-verify.test.mjs` is green, including the scratch-tree
   run of the real driver.
2. The wiring check fails on a `push`-only verification workflow and on an
   unreusable `ci.yml` — the two shapes that would look correct and reproduce the
   bug.
3. This change's own merge produces a `main-verify` run attached to its merge
   commit, which is the first CI run on a `main` commit in this repository.
4. `git diff --name-only` ⊆ allowed_files; the gate commands exit 0.

## Residual (honest)

- **The signal has no reader yet.** A `main-verify` run that fails is visible on
  `main`'s commit and nowhere else. Nothing refuses the next merge, and nobody is
  paged. That is the deliberate next step, not an oversight — but until it exists,
  "main is verified" means "main is verified, and someone would have to look".
- `push: branches: [main]` is left on `ci.yml` on purpose: a human pushing to
  `main` does fire it, and removing it would delete the only path that covers
  that case. Two mechanisms now cover `main`, one per actor, and which one ran is
  visible in the run's event.
- The dispatch is proven against the fake API and by the scratch tree; the first
  *live* dispatch is this change's own merge, so the repository is its own
  evidence rather than a fixture.
- The symlink failure mode found here is present in about twenty other scripts
  that compare `process.argv[1]` to `import.meta.url`. Each of those is the same
  silent no-op with a success exit code. Reported, not swept.
