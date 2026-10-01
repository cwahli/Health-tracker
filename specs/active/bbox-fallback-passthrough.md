---
id: bbox-fallback-passthrough
status: locked
class: APPLY_MISS
skill: food-calc
edit_mode: patch
allowed_files:
  - src/server/food/server_food_meal_assemble.ts
  - src/server/food/server_food_meal_assemble.test.ts
  - src/server/food/server_food_diet_dispatch.ts
  - src/server/food/server_food_diet_dispatch.test.ts
frozen_files:
  - src/App.tsx
  - src/components/LogChat.tsx
  - src/jobs/JobStore.ts
  - server_meal_gate.ts
  - AGENTS.md
gate:
  - npx vitest run src/server/food/server_food_meal_assemble.test.ts src/server/food/server_food_diet_dispatch.test.ts
---

# bbox-fallback-passthrough — a fallback-built dish keeps its own bounding box

## Goal
`buildFallbackItemsBreakdown()` and `buildCreateSkipResponse()` must carry each
scout item's own `boundingBox2D` onto the `itemsBreakdown` row they build.

## Understanding (what this bug is NOT) — V-30.4 anti-patch field
- Mechanism: when the meal agent's own `itemsBreakdown` is truncated or absent,
  both fallback paths reconstruct a row from the scout item but never copy
  `boundingBox2D` across, so the box is lost. The non-fallback path keeps it, so
  the same dish is annotated or not depending purely on which route ran.
- Not this: widening card-19's fix. Card #19 was a different site — clustering in
  `scoutGeometry.ts` destroys a *component's* box when dishes are merged. This is
  the *fallback rebuild* losing the box for every dish, unmerged. Same class of
  mistake, different function, and the two must not be conflated: fixing one does
  not fix the other.
- Not this: inventing a box where the scout had none. If `item.boundingBox2D` is
  absent the field must stay null, not default to the full frame — a fabricated
  annotation is worse than a missing one.
- Evidence: `buildFallbackItemsBreakdown` returns an object literal ending
  `foodType: 'unknown'` with no box; `buildCreateSkipResponse` maps scout items to
  rows ending `labelNutrientsPerServing` with no box.
- Non-goal: do not change which items become rows, the row count, weights, or any
  nutrient. One field is being carried that was previously dropped.

## Layer (pick ONE; siblings are frozen) — V-30.4 anti-patch field
- Layer: data
- Frozen: display, calc — the ledger row shape and the nutrient arithmetic are
  untouched by construction.

## Forbidden patch (named) — V-30.4 anti-patch field
- No symptom-hide: filling the box with `[0, 0, 1000, 1000]` when the scout has none
- No new feature flag
- No renamed locator
- No second merge/write path

## Two-sided fixture (prove structure, not symptom)
- Broken input → correct output: a scout item with a 4-number `boundingBox2D`
  yields a fallback row whose `boundingBox2D` is that same array, through BOTH
  functions — they are separate code paths and a fixture covering one proves
  nothing about the other.
- Adjacent input → unchanged: a scout item with NO `boundingBox2D` yields a row
  whose `boundingBox2D` is null, not the full frame. The existing row assertions
  (weight, dbSource, foodType, nutrients) must be untouched.

## In scope
- The two fallback row literals.
- Fixtures in the two existing test files that already cover these functions (L16 —
  no new test file).

## Out of scope
- `scoutGeometry.ts` clustering (card #19, already merged).
- Any change to the fallback's item selection or weight logic.
- Photo-only bundles and their `turn_mismatch` / `edit_not_applied` bars.

## Invariants
- `finalizeDishLedger` is the only kcal writer (food)
- Agent schema has no `calories`
- A photo-only bundle still bars `turn_mismatch` / `edit_not_applied`

## Prior art (do not reimplement)
- `src/server/food/scoutGeometry.test.ts` carries card-19's per-component box
  assertions. Same class, different site.

## Done when
1. Both test files assert the box is carried when present and null when absent.
2. `git diff --name-only` ⊆ allowed_files
3. The named gate exits 0.