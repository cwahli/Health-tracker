# Card-19 original-meal wave (2026-10-11) — the real failing meal through the real pipeline

Branch: `agent/card19-fix`. No application-code change (fix = PR #452, on main);
this wave is retrieve + repro + live proof + sheet honesty.

## 1. Original meal: FOUND (not unavailable)

The Green Grapes meal is fully recoverable from the packet's own repro curl
(`specs/done/card-19.md`): debug bundle
`job_1790784359089_kvt6r0c0g` (fetched 11 oct, 148846 bytes, jobId match) +
entry photo `sha256_0aa49da2…` (188699 bytes: bowl of oats topped with green
grapes, laptop behind — matches the scout output). Verbatim text:
"I had 70g of Sainsbury oat + fruit". Stored ledger shows the defect exactly:
scout 2 dishes -> 1 row "…with Green Grapes", both components boxless.
Also found: meal-qa request `meal_1790784386905` (same photo hash, 01 oct) whose
audit bundle was never produced — the step the human says was skipped.
Committed: `specs/card19-orig/` (defect.json, bundle, photo, repro outputs,
two live ledger JSONs, captioned shots).

## 2. Defect + repro (real bytes, both directions)

Defect `DISH_DROP:oat_grapes_composite:2026-W40` (class DISH_DROP, surface food):
both `compositeComponents.push` sites in `clusterSpatialCompositeDishes`
dropped `boundingBox2D`; composite kept the union, grapes lost its box and row.
`scripts/repro-card19-orig.mjs` (committed): `--before` on the stored bundle
exit 1 (REPRODUCED); live on pre-fix `05e93cce^` exit 1 (fingerprint match);
live on current code with the same 2 real dishes exit 0 (FIXED).
Named gate re-run: `scoutGeometry.test.ts` 8/8 green. Burn budget untouched
(0 hypotheses burned — the merged fix verified as-is; nothing reimplemented).

## 3. Live proof (two re-files, same picture + verbatim text)

Dev server on this tree (:3101, zero app-code diff to main), engine
gemini-3.5-flash-lite, live backends:
- A `job_1791738758388_card19orig` (API, byte-identical photo): scout 2 dishes
  -> 1 composite + 2 siblings EACH WITH ITS OWN BOX (oats [450,230,890,770],
  grapes [390,110,880,880]); 307 kcal; "Analysis complete".
- B `job_1791739000037_tqizyvrgw` (in-app composer: photo attached, verbatim
  text typed, sent): scout drew 1 dish this run -> ledger 2 ROWS each boxed
  (oats [250,0,950,1000], grapes [380,110,880,880]); 332 kcal; "succeeded".
  (Composer re-encodes the photo; same picture, different bytes — stated, not hidden.)
Both paths keep the grapes box+row end to end. Shots (job cited on strip,
loaded-with-data): 01 input-composer, 02 input-sent, 03 output-history,
04 output-nutrients + caption txt — Drive `spec:card-19`
(`https://drive.google.com/drive/folders/1sGuyRONr40gRVe32ZYbxpvg3k7WXwjKN`),
top-level holds only this ticket's 5 files; `card-19-gate.png` (terminal-only)
moved to `superseded/`, nothing deleted.

## 4. For the human checking this (/review)

1. Open the 4 PNGs: 01/02 show the entry as entered (photo + verbatim text,
   in-app); 03 shows both re-files "Analysis completed"; 04 shows the grapes
   component row (77 kcal) in the analysis table.
2. Re-check bytes: `live-status-<job>.json` in `specs/card19-orig/` (comps/rows
   boxed); re-run `npx vitest run src/server/food/scoutGeometry.test.ts` and
   `./node_modules/.bin/tsx scripts/repro-card19-orig.mjs` (+ `--before`).
3. Honest scope note: the merged fix preserves per-component boxes inside one
   composite row (what PR #452 + the unit tests pin) — it does not force 2
   ledger rows; run B shows the 2-row path also keeps boxes. No Done claimed;
   Status stays review.
