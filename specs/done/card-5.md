---
id: FREE-MODEL-proof
status: locked
class: SCRATCH_CLEANUP
skill: specify
edit_mode: patch
allowed_files:
  - v305-free-model-proof.md
frozen_files:
  - AGENTS.md
  - docs/agent
  - plan/ROADMAP.md
gate:
  - node scripts/assert-bug-dispatch.mjs
---

# card-5 — Remove stray v305-free-model-proof.md from repository root

## Goal
Delete the single stray file `v305-free-model-proof.md` at the repository root; change nothing else.

## Understanding (what this bug is NOT) — V-30.4 anti-patch field
- Mechanism: a temporary proof fixture was committed to the repository root; the fix is its removal.
- Not this: do not gitignore it, do not move it to another directory, do not rename it.
- Evidence: `git ls-files v305-free-model-proof.md` lists exactly one root-level file.
- Non-goal: this change must not modify any source, test, script, or documentation file.

## Layer (pick ONE; siblings are frozen) — V-30.4 anti-patch field
- Layer: data (repository tree only).
- Frozen: display and calc — no `src/` edits at all.

## Forbidden patch (named) — V-30.4 anti-patch field
- No symptom-hide: adding it to `.gitignore` is not a fix.
- No new feature flag
- No renamed locator
- No second merge/write path

## Two-sided fixture (prove structure, not symptom)
- Broken input → correct output: after the commit, `git ls-files v305-free-model-proof.md` is empty.
- Adjacent input → unchanged: `git diff --name-only HEAD~1` contains only `v305-free-model-proof.md`.

## In scope
- Delete `v305-free-model-proof.md`.

## Out of scope
- Everything else in the repository.

## Done when
1. `git ls-files v305-free-model-proof.md` exits empty on the branch.
2. `git diff --name-only` of the commit is exactly `v305-free-model-proof.md`.
3. Gate `node scripts/assert-bug-dispatch.mjs` exits 0.
