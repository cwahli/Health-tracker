# Case 12 — chat-modal meal with brand pick + saved-meal pick + photo note + edit

- **Suite:** `Meal_04_log` (Mode A, meal log) · **Case:** `12_chat_saved_meal`
- **Model:** gemini-3.5-flash-lite · **Engine:** `food_log` jobs on local server (`:3000`)
- **Photos:** `photos/12_cup_white_coffee.jpg` (13 KB; cropped cup region of
  `prototype/meallog/images/05_cafe_waffles_coffee.jpg`, rect
  left=1100 top=20 w=420 h=490 @1600×1204 — user framing a cup only;
  crop recorded here so a re-shooter can swap the file 1:1)
- **Setup fixture:** `setup/prior_coconut_log.json` (yesterday's saved
  "Coconut Juice" 250 ml log — the autocomplete `previous_meal` source)

## What this proves

Chat-modal composite logging end to end: one new photo + one brand-catalog
chip + one saved-meal chip + an in-tray portion edit + a photo note, then a
post-log edit (add item, remove item) with exact ledger math. Three dishes in,
three dishes out, coconut correctly gone.

## Setup (precondition, not a turn)

The user has ONE prior food log (yesterday): **Coconut Juice, 250 ml**
(46 kcal · P 0.7 · C 9 · F 0.8 · Na 25 — analyzed live, see
`debug_runs/debug-job_g12_turn0_coconut.md`). Typing `coconut` (≥3 chars)
surfaces it under autocomplete as a `previous_meal` candidate. Fixture copy:
`setup/prior_coconut_log.json`.

Brand catalog precondition: **McDonald's Big Mac** present
(`brand_menu_bmi_1789651515861_3hjkx`, McDonald's UK published 508 kcal /
215 g serving). Typing `big mac` returns exactly 1 autocomplete hit.

## Turn 1 — log (new meal)

1. Attach `12_cup_white_coffee.jpg`.
2. Type `big mac` → tap **Add** on the single brand hit → chip
   `[Big Mac] [215g]` (1 serving, unedited).
3. Type `coconut` → tap **Add** on the `previous_meal` hit
   (Coconut Juice 250 ml) → chip `[Coconut Juice] [250g]` → edit the tray
   weight to **200** → text updates to `[Coconut Juice] [200g]`.
4. Type the note: `unsweetened white coffee, small cup`
5. Final composer text (brackets auto-inserted by the chips):
   `[Big Mac] [215g] [Coconut Juice] [200g] unsweetened white coffee, small cup`
6. Submit (`food_log`, mode `new`, engine `gemini-3.5-flash-lite`).

Expected turn-1 ledger (live `job_g12_turn1_meal`, 8 s):
`White Coffee 200 g / 43 kcal` (vision estimate, unsweetened honored) +
`Big Mac 215 g / 508 kcal` (`brand_official` lock, full `valuesAtBasis`) +
`Coconut Juice 200 g / 46 kcal` (saved-meal tag). Meal 597 kcal / 615 g.
Debug: `debug_runs/debug-job_g12_turn1_meal.md`.

## Turn 2 — edit (add + remove)

1. On the logged meal, remove the coconut chip (tray ✕ also strips its bracket).
2. Type `rolled oats` → tap **Add** on the brand hit
   (Mr Oat Rolled Oats) → chip `[Mr Oat Rolled Oats] [40g]`.
3. Type: `add oats, drop the coconut`
4. Final edit text: `[Mr Oat Rolled Oats] [40g] add oats, drop the coconut`
5. Submit (`food_log`, mode `edit`, `activeMeal` = turn-1 log).

Expected turn-2 ledger (live `job_g12_turn2_edit`, 8 s):
`White Coffee 200 g / 43` + `Big Mac 215 g / 508` (both retained verbatim) +
`Mr Oat Rolled Oats 40 g / 130 kcal` (estimated). Coconut gone.
Meal **681 kcal · P 33 · C 73 · F 27.7 · Na 952 · 455 g** — column sums equal
meal totals exactly. Debug: `debug_runs/debug-job_g12_turn2_edit.md`.

## Consumed-amount assumptions

- Big Mac 215 g = 1 serving label lock (McDonald's UK published).
- Coconut tag weight edited 250 → 200 g in-tray (recorded weight 200 g;
  saved-log nutrients carried verbatim — see `correct_results.md` flag).
- Coffee 200 ml cup from text + vision (estimate bands in `expected.json`).
- Oats 40 g dry-weight tag (estimate; dry-vs-cooked basis flagged).

## Replay

Backend payloads mirror `LogChat` `submitPayload`
(`kind/mode/text/images/explicitFoodTags/foodLogs/activeMeal/engine`);
see `correct_results.md` § Payload shapes. Live rerun needs `:3000` +
`GEMINI_API_KEY`; reruns must stay inside the bands in `expected.json`
(estimates jitter — e.g. coffee weighed 200 g then 240 g across runs).
