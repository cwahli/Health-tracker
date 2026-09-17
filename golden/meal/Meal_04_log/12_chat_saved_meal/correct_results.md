# Correct results — chat-modal meal: brand chip + saved-meal chip + photo note + edit

## Status
**FINAL** — live `food_log` jobs on local `:3000` with
`gemini-3.5-flash-lite` (2026-09-17): setup `job_g12_turn0_coconut`,
turn 1 `job_g12_turn1_meal` (8 s), turn 2 `job_g12_turn2_edit` (8 s).
Code baseline `main@430fb93` (single-path foodcard + chat brackets +
multi-item compose); rerun criteria in `Instruction.md`.
Turn-2 ledger is a complete 32-key (`NUTRIENT_KEYS`) ledger whose column
sums equal the meal totals exactly. Debug captures in `debug_runs/`.

Do not invent macros: every number below is copied from the live captures
(`expected.json` turns + `debug_runs/`).

## Turn 1 — log (mode `new`)

Text: `[Big Mac] [215g] [Coconut Juice] [200g] unsweetened white coffee, small cup`
+ 1 photo (`12_cup_white_coffee.jpg`).

| Dish | Weight | kcal | P | C | F | Na | Source |
|---|---|---|---|---|---|---|---|
| White Coffee | 200 g | 43 | 2 | 3 | 2.5 | 30 | vision estimate (unsweetened honored; reply confirms no added sugar) |
| Big Mac | 215 g | 508 | 26 | 43 | 25 | 920 | `brand_official` lock, full `valuesAtBasis` |
| Coconut Juice | 200 g | 46 | 0.7 | 9 | 0.8 | 25 | saved-meal tag (`previous_meal`, setup log) |
| **Meal** | **615 g** | **597** | 28.7 | 55 | 28.3 | 975 | sums exact |

## Turn 2 — edit (mode `edit`, `activeMeal` = turn-1 log)

Text: `[Mr Oat Rolled Oats] [40g] add oats, drop the coconut`. No new photo.

| Dish | Weight | kcal | P | C | F | Na | Source |
|---|---|---|---|---|---|---|---|
| White Coffee | 200 g | 43 | 2 | 3 | 2.5 | 30 | retained verbatim |
| Big Mac | 215 g | 508 | 26 | 43 | 25 | 920 | retained verbatim, lock intact |
| Mr Oat Rolled Oats | 40 g | 130 | 5 | 27 | 0.2 | 2 | estimated (no brand lock — local tag id) |
| Coconut Juice | — | — | — | — | — | — | **correctly removed** |
| **Meal** | **455 g** | **681** | 33 | 73 | 27.7 | 952 | **column sums = totals exactly** |

Full 32-key ledger in `expected.json` turn 2 dishes (+ `salt`).

## Best available analysis notes

- Big Mac lock: McDonald's UK published 508 kcal / 215 g serving
  (protein 26, carbs 43, fat 25, sat 9.5, sugar 9, fibre 3.6, salt 2.3),
  seeded via `POST /api/brand-menu-items/import` (chain `mcdonalds`, D1).
  Autocomplete `big mac` returns exactly 1 hit (list shows at 1–3).
- Saved meal: turn-0 live analysis of `coconut juice 250ml`
  (46 kcal · P 0.7 · C 9 · F 0.8 · Na 25, full 32-key nutrients) frozen as
  `setup/prior_coconut_log.json`; client-side `matchingPreviousLogs`
  (name substring, ≥3 chars) surfaces it; submitted as `previous_meal` tag.
- Coffee: vision portion jitter is real (200 g/43 kcal then 240 g/47 kcal
  across runs) — pinned by bands in `expected.json`, not by exacts.
- Oats: `Mr Oat Rolled Oats` brand item exists locally; its `brand_menu_local_*`
  tag id does not resolve in `getBrandMenuItemById` (matches D1 `id` /
  `dish_name_key` only), so the row is estimated. Label-implied 40 g dry =
  160 kcal vs recorded 130 kcal; dry-vs-cooked basis ambiguous (see flags).

### Math note
- `meal_nutrient_calculator.ts` derives calories (4/4/9), unsaturatedFat,
  salt (Na×2.5/1000) in TS. Agent emits estimates; TS owns kcal.
- Turn-2 totals verified: 43+508+130=681; P 2+26+5=33; C 3+43+27=73;
  F 2.5+25+0.2=27.7; Na 30+920+2=952; weight 200+215+40=455.

## Must-pass gates
- Model: gemini-3.5-flash-lite
- Identity: exactly the 3 dishes per turn above, no phantoms, coconut absent turn 2
- Big Mac 508 kcal @215 g exact (label lock)
- Turn-2 column sums equal meal totals exactly
- Estimates inside `expected.json` bands; reruns must not chase exacts

## Known product gaps (recorded, not fixed by this golden)
1. `previous_meal` tag nutrients are carried verbatim at tag weight
   (turn-1 coconut: 200 g recorded with 250 ml macros 46 kcal) — no portion
   rescale in the tag path. Weight IS honored; math is not.
2. Same for label locks (probed off-record: 150 g burger carries 508 kcal).
   Kept exact portions in this journey so the FINAL ledger is fully correct.
3. Local-file brand items (`brand_menu_local_*` ids) never resolve in
   `getBrandMenuItemById` → estimated rows (oats here).
4. UI-live 2026-09-17 (`meal12-chat-saved-meal.live.spec.ts`): the compose
   sheet closes on submit and reopening starts a FRESH thread, so follow-up
   sends go out as mode `review` — there is NO UI path to the add/remove
   edit (turn 2 here runs via API `mode:edit` + `activeMeal`). In review
   mode the same T2 text double-processes: a phantom `Oats Porridge`
   estimate row PLUS the lock row (double count), and the per-100g lock
   merges partially (400 kcal @40 g with inconsistently scaled macros;
   Atwater flag wrong). T0/T1 are green live; T2 pends a UI edit
   affordance (or same-thread follow-up) + the lock-merge fix.

## Sources
- Live captures: `debug_runs/debug-job_g12_turn{0_coconut,1_meal,2_edit}.{md,json}`
- Payload shapes mirror `LogChat` `submitPayload` (`src/components/LogChat.tsx`)
- Tag contract: `src/server/food/server_food_db_search.ts` (explicit-tag injection)
- Chip mechanics: staged tray (`explicitFoodTags`), bracket format
  `src/utils/bracketPortionParser.ts`, autocomplete `/api/food/search` +
  `matchingPreviousLogs`
- Photo source: `prototype/meallog/images/05_cafe_waffles_coffee.jpg`
  (crop rect documented in `Instruction.md`)
- Big Mac nutrition: McDonald's UK published via CalorieKing GB
  (508 kcal, P 26, C 43, F 25, sat 9.5, sugar 9, fibre 3.6, salt 2.3 / serving)
