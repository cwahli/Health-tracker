# Bug-3 full resolution: label-gate tolerance let a ledger-flagged gap through (2026-10-10)

Card #3 (`tag_muwyto87_lb78bc`), defect OPENING_DRIFT (packed 10 Oct AM).
The human's second verdict ("a pack-only review is not a resolution — try
again") ordered the full pipeline to Bug-2's complete standard. One
hypothesis was tested, confirmed, and fixed. Zero hypotheses burned.

## Repro (confirmed, posted)

`npx vitest run server_opening_drift_label_gate.test.ts` → exit 1 pre-fix,
3/3 failed, recorded as the card's confirmed repro (command + exit + run log).
The sensor mirrors the card's meal: 260 g Sainsbury oat with milk (brand
panel 110 kcal/100g → 286 derived) carrying a printed OCR panel stating
300 kcal for the serving, scout opening 300. Pre-fix the item saved 286 and
the ledger fired the card's exact remaining line
("Scout Opening (300 kcal) != Saved Table (286 kcal)"; production rounded the
table to 287).

## Mechanism (H1, confirmed — not burned)

The Label Energy Gate (`server_nutrient_aggregation.ts`, rule in
`src/utils/labelEnergy.ts`) overruled derived figures only above a 15%
relative tolerance. A label-backed 13 kcal gap (300 printed vs ~286 derived,
4.3%) sailed through — while the ledger flags any scout-vs-saved gap above
±5 kcal. A gap the ledger flags could never be reconciled by the gate: the
two tolerances disagreed. Verified by direct runs before touching code
(E1/E2/E3 probe: gate silent, saved 286, imbalance fires).

## Fix

`src/utils/labelEnergy.ts`: `shouldPreferLabelEnergy` now fires when the gap
exceeds BOTH an absolute floor (`LABEL_ENERGY_MIN_GAP_KCAL = 5`, the ledger's
trial-balance tolerance — two checks, one tolerance) and a relative floor
(`LABEL_ENERGY_MIN_GAP_RATIO = 0.02`, against macro-rounding churn on large
meals). Post-fix the scenario saves 300 = scout = label truth: books agree,
zero imbalances. The 88-vs-238 beer-scale case still fires; ≤5 kcal dust
never churns. One existing test expectation updated with documented
justification (230-vs-238 "no churn" blessed an 8 kcal gap the ledger
flags — that was the bug, not coverage): threshold engineering, not
painting. Blast radius kept off PR #686 (`server_food_db.ts` untouched).

## Gates (all run by implementer; verify NOT posted — parent verifies)

- `server_opening_drift_label_gate.test.ts` (new sensor): 3/3 green.
- `src/utils/labelEnergy.test.ts`: 11/11 green.
- Companions 154/154: server_nutrient_aggregation, bugAutoSpot.food,
  goldenLedger, goldenJourney, bugTapeReview, server_derivation,
  server_dish_finalize, server_budget_reconcile.
- `npx tsc --noEmit`: clean.
- `bugctl repro` (confirmed) + `bugctl plan` posted. No `verify` by
  implementer, per pipeline separation.

## Live meal proof (standing rules, no exceptions)

- PROOF card #55 (`tag_mv2jeaei_2kfw90`, G2 mug photo attached) created, then
  the G2 meal re-filed LIVE on a fixed-code server (worktree build, port
  3100, box backend keys, killed after): both G2 photos + verbatim prompt
  `I added 60g of Sainsbury oat in my late + fruits` → live Gemini chain →
  job `job_1791645702245_4y7x4a1gi`, 629 kcal (oat 218 / milk 103 / banana
  117 / fruit bowl 191, chips sum to total), debug bundle on R2.
- Drive `card:tag_muwyto87_lb78bc` now holds 6 files, all #3's, NOTHING
  deleted: pack-check + packet-after (pack slice, still current),
  `bug3-live-entry-composer.png` (INPUT: both photos attached + verbatim
  prompt, pre-submit), `bug3-live-refile-foodhistory.png` (OUTPUT: filed
  meal, decomposition, photo, as the user sees it),
  `bug3-before-drift-job.png` / `bug3-after-drift-job.png` (before/after
  panels from REAL pipeline runs — pre-fix 286 + imbalance vs post-fix
  300 + zero imbalances — job cited on both).
- #55 evidence-annotated (live job + debug URL + photo) and
  duplicate-folded into #3 (`duplicate_of` set; #3 occurrences still 1,
  state packed) — Bug-2's #54 pattern.
- Honest scope note: the live G2 meal carries no printed OCR panel, so the
  fixed gate is inert there BY DESIGN (verified: vision emitted no
  estimatedCalories and no rawNutritionLabel on any of the 4 scout items).
  The fix is proven by sensor + before/after panels; the live meal proves
  input→output reality on the card's meal class. A full nutrient-breakdown
  shot was deliberately skipped: on this branch (without #686's unmerged
  micros fix) it would display Bug-2's open defect as if mine.
- Demo store is session-scoped: the filed meal vanished with the browser
  session (confirmed absent from food-search) — zero app residue. Own dev
  server stopped; deploy :3000 untouched (200 throughout).

## Sheet (Ref Bug-3, row 43)

Both human stamps preserved byte-for-byte; Work-done/What's-left appended
after them. Status review. `[state]` kept at canonical `packed`
(`bugctl state`; queue in_progress, legacy to_fix) — implementer never sets
Done. Completion gate rewritten to the full meal-proof contract (job cited,
input→output, curated folder, parent verifies). last_activity refreshed to
UK shape. Open tension for the parent: the brief asked for sheet state
"in_fix while open", but canonical derives `packed`; mirroring canonical was
chosen over writing a non-canonical value.

## Rules for next time

- When a ledger tolerance (±5 kcal) and a gate tolerance (15%) disagree,
  label-backed gaps fall in the dead zone forever. Align them with a
  documented basis (two checks, one tolerance) + an anti-churn floor.
- `pkill -f` matches its own command line — it killed the invoking shell
  along with the dev server. Use exact PIDs for server cleanup.
- The `bugctl` shim resolves REPO_ROOT to the deploy clone, so pack/repro/
  plan journal rows land there, not the worktree (Bug-2 noted the same).
  Canonical store is unaffected; never commit in the deploy clone.
- A live meal without an OCR panel cannot exercise the label gate — check
  the debug bundle's scout items for `rawNutritionLabel` before claiming
  live coverage of a label fix; say plainly what the live run does and does
  not prove.
