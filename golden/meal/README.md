# golden/meal — meal benchmark goldens

Each `Meal_NN/` folder is one computation use case: photos + `Instruction.md`
+ `expected.json` + `ideal_debug_turnNN.md` (canonical diagnostic reports).

## Official goldens

| ID | Turns | Contract | Gates |
|----|-------|----------|-------|
| Meal_01 | 3 (log → portion patch → correction patch) | edit = verdict/advice patch + full `dishUpdates` with coordinates, never regeneration | `tests/golden_meal01.test.ts` (parity, no LLM) + `prototype/tests/meal01-golden.live.spec.ts` (demo always; live soak behind `LIVE_MEAL01=1`) |
| Meal_02 | 1 (auto-split 5+4 parallel workers) | 19 refIds across 9 photos (barcodes, grocery receipts, prepared foods); merge by refId | `prototype/tests/armC-meal02.spec.ts` (Arm C Playwright fixture & live soak) |
| Meal_03_compare | 1–2 (pre-meal evaluate → optional log) | 6 retail & dining sets (menus, labels, shelves); 10-nutrient allowance vectors (serving & 100g); <=10% macro variance grouping; OCR lock; bounding box quadrants; intra-group health sorting | `tests/golden_meal03.test.ts` (parity, non-LLM) + `prototype/tests/compare-mode-six-cases.spec.ts` (Playwright E2E 6/6 cases) |
| Meal_04_log | 1–2 (log; portion-clarify/edit on 08/11; chat chips + post-log add/remove on 12) | Mode A matrix from prototype 01/02/06/08/09/10/11 plus app-chat case 12: nutrition label, brand pack, barcode, menu-as-log, restaurant plates, receipt+brackets, brand/saved-meal autocomplete chips, photo note, in-tray portion edit | Fill `benchmark_result.md` per case via Vertex flash-lite; runner harness `npm run test:benchmark:food` |

## Bench entrypoint

- Offline deterministic check (no server, no LLM): `npm run test:benchmark:meal-golden` → `scripts/meal-golden-bench.mjs` (validates `expected.json` macros/photos/status + `correct_results.md` DRAFT-vs-FINAL + sources for all 7 `Meal_04_log` cases).
- Live run (needs `:3000` + Vertex key): existing runners per case docs, e.g. `npm run test:benchmark:food`.

## Adding or Transposing Golden Meals

1. Add photos (≤200 KB each, `NN_description.jpg` or `setN_description.jpg`).
2. Copy canonical `expected.json` shape:
   - For **Mode A (Logging)**: dishes with `weightGrams`, 32 nutrients in `NUTRIENT_KEYS` order, `source` (`label_lock` | `estimate`), `lockedLabelTruth` for packaged items, meal `totals` that equal column sums.
   - For **Mode D (Compare & Evaluation)**: `items` (extracted dishes/labels), `groups` with `<=10%` macro variance, complete 10-nutrient profile allowance vectors (`averageNutrients` per serving & `averageNutrientsPer100g`), normalized `boundingBox2D` quadrant coordinates, intra-group health sorting, clinical verdict sentence, and recommendation narrative.
3. Write `Instruction.md`: photo→dish map + consumed-amount or evaluation assumptions.
4. Flag anything not directly legible in `verifyFlags`.



## Model (canonical)

**gemini-3.5-flash-lite** is the required scout/compare model for golden meal benches (successful Meal_03 + meal-log Vertex runs). Prototype harnesses must match or point here.

## Prototype ↔ golden

| Surface | Role |
|---|---|
| `golden/meal/**` | Source of truth: correct_results, expected, benchmark_result, debug |
| `prototype/meallog/**` | Live harness only — see `prototype/meallog/README.md` |

Builder must not author and score the same live A/B (standing `builder_ne_tier3_ab_scorer`).

### Live scorecards
- Mode A log suite: [`Meal_04_log/benchmark_result.md`](./Meal_04_log/benchmark_result.md)
- Mode D compare: [`Meal_03_compare/benchmark_result.md`](./Meal_03_compare/benchmark_result.md)
