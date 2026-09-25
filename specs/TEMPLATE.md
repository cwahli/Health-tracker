---
id: <ROADMAP-ID or CLASS>
status: draft
class: <BIND_MISS | STALE_TURN | ALWAYS_SECOND_AGENT | APPLY_MISS | …>
skill: <food-calc | biomarkers | sync-jobs | debug-contract | specify | verify>
edit_mode: patch
allowed_files:
  - path/relative/to/repo.ts
frozen_files:
  - src/App.tsx
  - src/components/LogChat.tsx
  - src/jobs/JobStore.ts
  - server_meal_gate.ts
  - AGENTS.md
  - scripts/assert-f10-pr1.mjs
gate:
  - npx vitest run <named files from DOMAIN_REGRESSION_MAP.md>
  - node scripts/assert-spec-diff.mjs <id>
---

# <ID> — <one-line title>

## Goal
<one sentence; checkable>

## Understanding (what this bug is NOT) — V-30.4 anti-patch field
- Mechanism: <the actual cause, one sentence — not a restatement of the symptom>
- Not this: <the tempting wrong-thing fix(s), and why they are wrong>
- Evidence: <before.png key / run.log key / repro command from the card>
- Non-goal: <one explicit thing this change must NOT do>

## Layer (pick ONE; siblings are frozen) — V-30.4 anti-patch field
- Layer: <display | calc | data>
- Frozen: <the other two layers — out of scope by construction; cross-layer sprawl is a reject>

## Forbidden patch (named) — V-30.4 anti-patch field
- No symptom-hide: <name the cosmetic patch that would paint this green>
- No new feature flag
- No renamed locator (test ids like `#nav-tab-health` stay stable)
- No second merge/write path

## Two-sided fixture (prove structure, not symptom)
- Broken input → correct output: <fixture / test name>
- Adjacent input → unchanged: <regression guard that proves nothing else moved>

## In scope
- …

## Out of scope
- …

## Invariants
- `finalizeDishLedger` is the only kcal writer (food)
- Locked SI converts: `1.293` / `1.411` / `3.362` / `79.56` / `13.68` (biomarkers)
- Agent schema has no `calories`
- `shouldExpandMealAgent` stays TypeScript

## Prior art (do not reimplement)
- …

## Done when
1. <named fixture or behavior>
2. `git diff --name-only` ⊆ allowed_files
3. Gate commands exit 0
