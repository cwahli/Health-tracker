# Wave-4 meal proof (2026-10-10) — Meal-36 (#20) + Meal-37 (#19) live PNG proof

Branch: `agent/wave4-mealproof`. No application-code change (both fixes already
on main); this turn is gates + live proof + sheet rows only.

## Shared live run (both tickets, one re-file)

Both cards are phantoms — absent from `bugctl list` (verified 10 oct; the
#19/#20 journal rows in `specs/bug-journal/` are the surviving record, nothing
invented). Original entry pictures+messages are unrecoverable, so the entry is
**reconstructed and labeled so** (allowed by the proof-presentation rules).

Re-filed live on this tree's dev server (`http://127.0.0.1:3101`, PORT=3101,
same code as origin/main — branch has zero diff to main):

- `job_1791658212211_v4rx3al2v` — **succeeded**, "Analysis complete", no clarify.
- Entry verbatim: `[PROOF bbox re-file Meal-36/Meal-37, reconstructed entry]
  Log this meal: beef soup bowl plus steak hotplate, both dishes with boxes.`
- Photos: `golden/meal/Meal_01/photo_02.jpg` (beef soup) +
  `golden/meal/Meal_04_log/09_restaurant_plates/photos/09_steak_fish_chips_1.jpg`.
- Result: 2 dishes (Beef Soup 274 kcal, Beef Steak Hotplate 398 kcal);
  `pendingFoodLog.itemsBreakdown` = 2 rows, **both carry boundingBox2D plus
  their own sourceImageIndex** — no null boxes. Scout (flash-lite) emitted
  full-frame `[0,0,1000,1000]` on this run; tight-box carry is proven by the
  gates below. The defect in both tickets was NULL boxes; boxes now exist
  end to end and the analysis view renders both dishes with nutrients.
- No bugctl PROOF card filed (shared queue left untouched); the meal text
  itself carries the PROOF label, and the job_id is the citation.

## TICKET 1 — Meal-36 (`card:tag_mupd6fhn_g62r4n`, sheet row 3)

Defect: `buildFallbackItemsBreakdown()` + `buildCreateSkipResponse()` dropped
every scout dish's `boundingBox2D` (journal `specs/bug-journal/20.jsonl`).

- Prior "gates 44/44 green" claim: **re-run by me, trust nothing** —
  `server_food_meal_assemble.test.ts` + `server_food_diet_dispatch.test.ts` =
  **44/44 green** on this tree 10 oct.
- Proof folder `card:tag_mupd6fhn_g62r4n`
  (`https://drive.google.com/drive/folders/1ZnLItFuL4ScHdsgXsPy4M_jbiH_XZvks`,
  created 10 oct): `meal36-entry-soup-steak-proof.png` (INPUT),
  `meal36-analysis-boxes-live.png` (OUTPUT), `meal36-app-context-live.png`
  (CONTEXT) + `meal36-proof-caption.txt`. Job cited on every strip.
- Sheet row 3: workDone appended (append-only), proof = folder link,
  Status **review**, last_activity UK shape. Review-app listing resolves 3 images.

## TICKET 2 — Meal-37 (`card:tag_muok1ay2_yl66tq`, sheet row 26)

Defect: scout detected Green Grapes as a dish; logged meal kept 1 item and
dropped its box (journal `specs/bug-journal/19.jsonl`, fix PR #441 =
commit `05e93cce` scoutGeometry, on main).

- **Missing gate, stated plainly: `src/utils/__tests__/scoutToLedgerDishDrop.test.ts`
  was NEVER landed — confirmed absent from the tree 10 oct. Not invented.**
  Provable instead: `scoutGeometry.test.ts` **8/8 green** (re-run by me 10 oct)
  + the shared live run (each dish keeps its own box end to end).
- Proof folder `card:tag_muok1ay2_yl66tq`
  (`https://drive.google.com/drive/folders/1qzBD8jHqU2i8H_hotvAq3HrgqFuqU4_s`,
  created 10 oct): `meal37-entry-soup-steak-proof.png` (INPUT),
  `meal37-analysis-boxes-live.png` (OUTPUT), `meal37-app-context-live.png`
  (CONTEXT) + `meal37-proof-caption.txt`. Job cited on every strip.
- Sheet row 26: workDone appended (append-only, missing-gate statement inside),
  proof = folder link, Status **review**, last_activity UK shape.
  Review-app listing resolves 3 images.

## Verification

- `assert-sheet-proof.mjs` (observer tree, read-only): **row 3 Meal-36 PASS,
  row 26 Meal-37 PASS**. The run's 2 FAILs are other owners' rows (Domain-01
  row 2, Auto-01 row 4 mislinks) — out of scope, untouched.
- Local copies + manifest: `qa-evidence/wave4-proof/` (gitignored, stays local).
- Dev server :3101 stopped after the run; no code touched, so no vitest/tsc
  beyond the named gates.

## For the human checking this (`/review`)

1. Open each folder's 3 PNGs — every strip cites
   `job_1791658212211_v4rx3al2v`; input shows the staged pictures + verbatim
   text, output shows the 2-dish analysis with nutrients.
2. Optional re-checks: `curl 127.0.0.1` no longer needed (server stopped);
   re-run `npx vitest run src/server/food/server_food_meal_assemble.test.ts
   src/server/food/server_food_diet_dispatch.test.ts` (44) and
   `src/server/food/scoutGeometry.test.ts` (8); confirm
   `src/utils/__tests__/scoutToLedgerDishDrop.test.ts` is still absent.
3. Verdict (review → Done/archive) is yours. I never set Done.
