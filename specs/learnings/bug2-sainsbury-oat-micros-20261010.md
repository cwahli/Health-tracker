# Bug-2: micro-poor canonical fed the oat-micros wall (2026-10-10)

Card #2 (`tag_muwyto2i_lv3uyw`, "Incorrect nutrition labdl") carried two
remaining lines; this slice fixed exactly ONE defect (single-defect law):

- Fixed: `Sainsbury oat with milk: 16 micro keys at 0` (class OPENING_WRONG,
  surface food).
- Untouched: `Trial balance drifted: Scout Opening (300 kcal) != Saved Table
  (287 kcal)` — needs its own defect/threshold call on a follow-up card.

## Mechanism

Every `lookupCanonicalBaseFood("Sainsbury oat …")` query resolves to
`CANONICAL_BASE_FOODS.sainsbury_rolled_oats` (`server_food_db.ts`), which
carried macros + sodium/potassium/fibre only — no calcium, magnesium, iron,
zinc, no vitamins. STEP 2.2 imputation in `aggregateItemsNutrients` therefore
had no authentic DB minerals to publish; on the filed job this rendered as 16
micro keys at exactly 0. On current code the foodtype_estimate trace backstop
masks the wall (4 zeros left: D/B12/C/A), but every Ca/Mg/Fe/Zn value was
generic-grain filler, never DB truth (`nutrientSourceMap = foodtype_estimate`).

## Fix

`server_food_db.ts`: `sainsbury_rolled_oats` inherits grain minerals from the
sibling `rolled_oats` row, scaled by the energy ratio 370/379
(Ca 50.8, Mg 134.7, Fe 4.15, Zn 3.55 per 100 g). No invented numbers — every
digit derives from in-repo data; the comment on the row says so. Post-fix the
same 260 g brand-locked item publishes Ca 132.1 / Mg 350.2 / Fe 10.8 /
Zn 9.23 with provenance `brand_label_data` (was: 39 / 72.8 / 2.08 / 2.6 via
`foodtype_estimate`).

## Sensor (L17)

`server_sainsbury_oat_micros.test.ts` (named gate:
`npx vitest run server_sainsbury_oat_micros.test.ts`): asserts the canonical
lookup carries Ca/Mg/Fe/Zn > 0 AND the aggregated brand-locked item keeps
fewer than 8 zero micro keys with no MICROS_ZERO hit. Fails pre-fix (exit 1,
recorded as the card's confirmed repro), green post-fix (2/2). Companion
gates green: `server_nutrient_aggregation` + `server_food_db` +
`bugAutoSpot.food` (54/54), `tests/golden_meals` incl. G2 Sainsbury contract
(23/23), `tsc --noEmit` clean.

## Known remainder (not this card)

- Trial-balance line untouched (saved kcal unchanged by a micros-only fix).
- Vitamins D/B12/C/A still 0 for with-milk items: grain trace profile holds
  them at 0 and UK geofencing forces D=0; B12/A would need dairy-merge logic.
  Below the MICROS_ZERO ≥8 threshold — follow-up material, not a second
  defect here.
- Exact-meal live re-file impossible: the job's `photo_urls` are empty since
  intake. Proof delivered: chromium before/after nutrient panels (real
  pipeline numbers) + live-app food-history frame, all in Drive
  `Work done/card:tag_muwyto2i_lv3uyw`; Bug-53 strays moved to
  `card:tag_muxcn960_px5wm4`.

## Rework 10 Oct (human verdict): live proof with job number + analysis view

Proof-only rework — NO code changed, no canonical card artifacts touched
(#2 stays parent-verified done; no attempt row, no re-verify by implementer).

1. **Job cited.** `job_1786701466257_np41t5gpa` (card current_evidence +
   commits) now heads both panels visibly:
   `bug2-before-micros-job.png`, `bug2-after-micros-job.png`.
2. **Exact meal re-filed live** (meal-live-proof step-2 fallback — card
   photo_urls empty since intake). PROOF card #54
   (`tag_mv23u9zz_0ggxi7`, G2 mug photo attached) created, then the G2 meal
   filed through the live app UI: both G2 photos
   (`PXL_20260810_090417151.jpg`, `PXL_20260810_105056448.jpg`) + verbatim
   prompt `I added 60g of Sainsbury oat in my late + fruits` → live Gemini
   chain analyzed it: `Oatmeal with Milk 261 kcal` (Sainsbury Oat 60g 174 +
   Milk 160g 87, separate lines — G2-correct) + `Mixed Fresh Fruits 248` =
   509 kcal grand total.
3. **Analysis-view shots** (as the user sees it), all in Drive
   `Work done/card:tag_muwyto2i_lv3uyw` (12 files, all Bug-2):
   `bug2-live-refile-foodhistory.png` (filed meal live),
   `bug2-live-analysis-decomposition.png` (oats/milk/fruit lines),
   `bug2-live-analysis-mg-ca.png` (Mg 65.1 mg, Ca 169.6 mg),
   `bug2-live-analysis-fe-zn.png` (Ca 169.5 mg, Fe 2 mg, Zn 1 mg,
   Se 4.1 mcg, I 25.8 mcg),
   `bug2-live-analysis-bvitamins.png` (A, B6 0.3, B1 0.2, B2 0.3, B3 2.1).
   Note: these are the live meal's own weights/values, NOT the 260 g
   sensor-scenario figures (Ca 132.1 etc.) in the before/after panels —
   provenance `brand_label_data` is asserted by the sensor + after-json,
   not displayed in-app.
4. **Cleanup.** Demo store is session-scoped: fresh session shows no
   oatmeal row and food-search has no 10-10 meal — zero app residue, nothing
   to delete. PROOF #54 annotated (evidence op) and duplicate-folded into
   #2 (`duplicate_of` set, journal 54.jsonl create+duplicate); #2
   occurrences still 1, state still done.
5. **Tool note.** `bugctl` (shim → deploy checkout) pack/repro/plan/verify
   round-trips succeed server-side but do not append to the worktree's
   `specs/bug-journal/2.jsonl` (stale, older card) — journal mirror gap,
   store remains canonical. Left for the pipeline owners, not this turn.
