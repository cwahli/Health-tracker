---
id: card-19
status: locked
class: DISH_DROP
skill: food-calc
edit_mode: patch
allowed_files:
  - src/server/food/scoutGeometry.ts
  - src/server/food/scoutGeometry.test.ts
frozen_files:
  - src/App.tsx
  - src/components/LogChat.tsx
  - src/jobs/JobStore.ts
  - server_meal_gate.ts
  - AGENTS.md
  - scripts/assert-f10-pr1.mjs
gate:
  - npx vitest run src/server/food/scoutGeometry.test.ts
  - node scripts/assert-spec-diff.mjs card-19
---

# card-19 — every scout dish must get its own ledger entry, with its own box

## Goal
Every entry in a composite dish's `components` must carry its own
`boundingBox2D`, so a component's box survives clustering and can still be told
apart downstream.

## Understanding (what this bug is NOT) — V-30.4 anti-patch field
- Mechanism: `clusterSpatialCompositeDishes` in `src/server/food/scoutGeometry.ts`
  merges co-located scout dishes into one composite `primary` and builds a
  `compositeComponents` array alongside it. Both `compositeComponents.push({...})`
  sites construct each component from `c`/`it` but never copy `boundingBox2D`, so
  a component's own box is destroyed at clustering time. `primary.boundingBox2D`
  is then set to the UNION of the cluster, which is correct for the composite — but
  by the time anything reaches `itemsBreakdown` the union is the only box left, and
  no component box survives.
- Not this: writing the second dish back into the *title* string, or padding
  `itemsBreakdown` with a row carrying no `boundingBox2D`. A composite label that
  is not backed by ledger rows still loses the box and the weight, and it would
  make the card look fixed while the data is still wrong.
- Not this: special-casing this one job id. The mechanism is in the assembly, and
  a job-id allowlist is the second write path the forbidden list rules out.
- Evidence — verified against the live debug payload for
  `job_1790784359089_kvt6r0c0g`:
  - `result.rawScout.dishes` = **2**
    - `[0]` "Sainsbury Oat and Fruit", 220 g, `boundingBox2D = [250,100,955,990]`
    - `[1]` "Green Grapes", 100 g, `boundingBox2D = [390,110,875,880]`
  - `result.pendingFoodLog.itemsBreakdown` = **1**
    - "Sainsbury Oat and Fruit **with Green Grapes**",
      `boundingBox2D = [250,100,955,990]`
  - `[250,100,955,990]` is exactly the **union** of the two dish boxes, so the
    composite's own box is correct and must not change. The loss is that the
    `compositeSiblings` entry for "Green Grapes" carries no `boundingBox2D` at
    all, so nothing downstream can say which part of that union was the grapes.
- Repro:
  ```
  curl -s https://pub-2ae421ce82904986ae87c8bc27552cff.r2.dev/debug/Pqc9RG33GRdELpXvkqI4EJhHyQ53/job_1790784359089_kvt6r0c0g.json \
    | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);console.log('scout',j.result.rawScout.dishes.length,'ledger',j.result.pendingFoodLog.itemsBreakdown.length)})"
  # scout 2 ledger 1
  ```
- Non-goal: do not change how weights or nutrients are computed. Only the
  one-row-per-scout-dish assembly and the box that travels with it.

## Layer (pick ONE; siblings are frozen) — V-30.4 anti-patch field
- Layer: data
- Frozen: display, calc — the ledger row shape and the nutrient arithmetic are out
  of scope by construction.

## Forbidden patch (named) — V-30.4 anti-patch field
- No symptom-hide: appending a synthetic second `itemsBreakdown` row with a
  null or zero box so `length === 2` passes.
- No new feature flag
- No renamed locator
- No second merge/write path — extend the existing assembly, do not add a
  post-hoc repair step after `itemsBreakdown` is built.

## Two-sided fixture (prove structure, not symptom)
- Broken input → correct output: two co-located scout dishes cluster into one
  composite whose two `compositeSiblings` entries each keep their OWN
  `boundingBox2D` — oats `[250,100,955,990]`, grapes `[390,110,875,880]` — while
  the composite's own box stays the union. Covers BOTH `compositeComponents.push`
  sites: a plain dish, and a parent that already carries sub-components (whose
  components inherit the parent's box, the only honest annotation available).
- Adjacent input → unchanged: a single dish is returned as the same object it
  went in as, with no `compositeSiblings` invented. Clustering returns early for
  `<= 1` item, so a fix that touched that path would start fabricating components
  on ordinary single-dish meals.
- Assertions live in `src/server/food/scoutGeometry.test.ts`, which already covers
  `clusterSpatialCompositeDishes`. No new test file (L16).

## In scope
- The reduction from `rawScout.dishes` to `itemsBreakdown`.
- Carrying each dish's `boundingBox2D` and `estimatedWeightGrams` through.
- The named fixture file above.

## Out of scope
- Photo-only bundles and their `turn_mismatch` / `edit_not_applied` bars.
- Nutrition maths, catalog lookup, and the `mealBuild` nutrition totals.
- Any change to `server.ts` or a new route.

## Invariants
- `finalizeDishLedger` is the only kcal writer (food)
- Agent schema has no `calories`
- `shouldExpandMealAgent` stays TypeScript
- A photo-only bundle still bars `turn_mismatch` / `edit_not_applied`

## Prior art (do not reimplement)
- `job_1790784235900_ee9r7hg2i` already keeps 2 scout dishes as 2 ledger entries
  with distinct boxes. Read it first: it is the counter-example that proves the
  collapse is not universal, so the differing code path is the clue.

## Done when
1. `scoutToLedgerDishDrop.test.ts` asserts 2 scout dishes → 2 rows with matching
   per-row boxes, and 1 scout dish → 1 unchanged row.
2. `git diff --name-only` ⊆ allowed_files
3. Both gate commands exit 0.