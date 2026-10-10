# Wave2 meals batch (2026-10-10) — Meal-35/36/37, branch agent/wave2-meals

Three phantom cards (all absent from `bugctl list`, which holds 14 rows, none of
#19/#20/#35). Origin traced through `specs/bug-journal/` — no canonical records
invented. Sheet: `10oPI9AsHaKpb9xRR8XcTm6JyH1gYyykUFBNqeqg2SM0`, tab `current`.

## Meal-35 (row 8, card:tag_mur65c7d_ifb932) — review-ready, Status=review

Refusal holds, re-verified on this branch: `meal-audit-loop --bundle=.../
Meal-prawn-ham-01 --dry-run --no-dispatch` => exit 1, `ungrounded_no_cards`,
0 cards; `assert-meal-audit-ground-truth` 12/12. No code changed.

Job-citation gap closed WITHOUT inventing a job id: there is none. The bundle
is a prebuilt benchmark (`catalog_scaled`, text-only "Analyze this meal photo"
turn, `photos/` empty — grep finds no `job_` token anywhere in it), so no live
job was ever filed. Cited visibly instead: bundle identifier + exact run command
+ comparison identity (DIVERGED/turn_mismatch/24, comparedAt
2026-10-01T10:10:18Z, siteSha 150e36c4) in row-8 Work-done AND in a new caption
panel `meal35-redo-4-replay-target-caption.png` (7th image in per-key folder
`1Pwt3dS7Jht8aygPWwaaDwZ6Ia1r1znFk`, all 7 curated Meal-35, nothing deleted).
Observer `assert-sheet-proof.mjs`: 26 pass / 2 fail, row 8 green WITH review
status and the meal gate enforced (the 2 fails are rows 4–5, out of scope).

HONESTY FLAG for the human: `citesJob` (`/job[_-][0-9a-z_]+/i`) fires on the
denial phrase "no live job_id exists" present in the row text and panel title.
That wording predates the sensor check and states the truth, but the sensor
pass should be read as "replay target cited + explicit no-job statement", NOT
as "a filed job was named". If bundle-as-reference does not satisfy the
standing rule's intent, send row 8 back to Assigned — one cell, no other
changes needed.

## Meal-36 (row 30, card:tag_mupd6fhn_g62r4n) — reopened done->in_fix, NOT noise

`Pending`/`done` with zero proof images was invalid (sensor FAIL). Reopened to
`Assigned`/`in_fix` with reason on the row. Trace: card #20, filed 2026-10-01
via bugctl (pack: fallback paths drop `boundingBox2D`; journal `20.jsonl`
pack + verify-green); aged out server-side. Fix holds on current main:
`buildFallbackItemsBreakdown` carries the scout box, named gates
`server_food_meal_assemble` + `server_food_diet_dispatch` 44/44 green 10 oct
(`npm ci` was needed first — this worktree ships no `node_modules`).
Missing: live PNG proof, per-key Drive folder does not exist. Queued VM5
after Bug-3. Never done without PNGs.

## Meal-37 (row 29, card:tag_muok1ay2_yl66tq) — kept in_fix, NOT noise

Trace: card #19, filed 2026-10-01 (plan + 2 failed dispatches + block/unblock,
journal `19.jsonl`); PR #441 fix merged 1 oct, PR #452 journal landed,
`93fb6668` confirms both fixes on main; aged out server-side. Fix holds:
`src/server/food/scoutGeometry.ts` + test (`05e93cce`), 8/8 green 10 oct. Note:
the journal's planned gate `scoutToLedgerDishDrop.test.ts` was never landed
(file absent) — the live proof must cover that gap. Missing: live PNG proof,
no Drive folder. Queued VM5 after Bug-3.

## Method notes

- Phantom rule that worked: `bugctl list` absence + `specs/bug-journal/<n>.jsonl`
  presence + PR/commit archaeology = filed-then-aged-out, distinguishable from
  never-filed. Journals 19/20/35 were the surviving records in all three cases.
- `citesJob`-style regex sensors match denials ("no job_id") as well as
  citations. When no job exists, say so plainly AND flag the match mechanics
  to the reviewer — a green sensor on a denial substring deserves one sentence
  of disclosure, as above.
- `npx vitest` in a fresh worktree fails on missing `node_modules`
  (`@tailwindcss/vite` etc.) — `npm ci` first; it touches no tracked files.
