---
slug: same-meal-package-prepared
date: 2026-09-13
class: PROCESS_GAP
node: Builder
status: promoted
---

# Learning: package + prepared views of one meal must collapse in TypeScript

## What happened
Live job `job_1789312118652_j8t9nsbxz`: 3 photos of the same oats meal (package, label, cooked pot) logged as 2 dishes (400g / 543 kcal). User said "It's only 1 meal. Just combine them". Scout emitted a 1-dish `replace` of the package; TypeScript mapped that to `replace_identity` and left "Boiled Rolled Oats Porridge" in the ledger.

Prior fix (merge_dishes + `applySameMealClarification`) only fired on empty scout output and a closed regex (`same meal` / `1 dish`). "combine them" / "1 meal" missed it. Scout's combined replace marked the package `usedPrior`, so the leftover sibling could not be merged. No standing row existed, so the class could return.

Create path had the same hole: `resolvePackageAndContextItems` refuses different `sourceImageIndex` unless the name is an explicit "label panel", and bulk-package detection requires ≥500g — a 40g serving + 200g porridge never collapsed.

## What the user asked
Review `/Users/chiwah/Downloads/debug-job_1789312118652_j8t9nsbxz.md` and fix: all 3 pictures are the same meal; diet should have merged; merge edit failed. Review why the previous fix resurfaced. Use the learner / observer ratchet so it cannot return.

## Keep
- `merge_dishes` must preserve OCR `rawNutritionLabel` and the user-selected package serving (never dry+wet sum).
- Two distinctly labeled products with different printed calories must stay separate (sweet-chilli wrap vs mini fillets).
- Prompt-only "do not duplicate across cooking prep" is not a sensor.

## Propose standing (add only)
```json
{
  "id": "same_meal_package_prepared",
  "label": "Package + prepared views of the same food collapse to one dish; combine-language edits emit merge_dishes",
  "asked": "repeated",
  "files_must_contain": {
    "server_edit_patch_ledger.ts": [
      "isSameMealMergeRequest",
      "collapsePackagePreparedScoutItems",
      "findPackagePreparedPair"
    ],
    "server_edit_patch_ledger.test.ts": [
      "It's only 1 meal. Just combine them"
    ],
    "server_vision_scout.ts": [
      "collapsePackagePreparedScoutItems"
    ],
    "server_vision_scout.test.ts": [
      "collapses a labeled oats package and the cooked porridge"
    ]
  }
}
```

## Propose skill delta (≤5 lines each, additive)
- planner: Recurring meal-split bugs need a TypeScript sensor + standing needle, not another prompt sentence.
- builder: Same-meal package vs prepared is `merge_dishes` (label + serving weight). Do not treat scout `replace` of one of two rows as a completed merge.
- guard: New standing row `same_meal_package_prepared` — files_must_contain only; do not weaken existing cross-photo distinct-label tests.

## Do not
- Delete standing rows
- Merge journey packs
- Edit Guard scripts in this file’s promote
- Add more English to `scoutSystemInstruction` (L12 net-zero; math stays in TS)
