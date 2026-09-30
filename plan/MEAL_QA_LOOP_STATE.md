# Meal QA loop — current state

## What is done

Phases 1–4 of the loop are implemented, gated, and merged to PR #387. Runbook:
this file's sibling `MEAL_QA_LOOP.md` (in `plan/`). The loop is correct and runs
end to end; the blockers below are about **data and process**, not code.

## The honest blocker: the corpus cannot be hand-populated

The loop reports `needs_audit` for every freshly resolved meal. Populating the
corpus requires a dish list per meal — dishes, weights, bounding boxes, and 32
nutrients. I attempted this with vision and stopped, deliberately.

**What I checked.** Six of the latest saved meals, 8 photos downloaded, two read
in full. The audit needs per-100g nutrient data to scale by weighed grams, so I
looked for a nutrition source in the repo:

- `server_food_catalog.ts` → `STANDARD_BASE_FOODS` contains **6 entries**, all
  dressings and vinaigrette. No proteins, no carbohydrates, no fruit.
- The D1 `food_items` table has `nutrients_per_100g`, but it is only reachable
  through `server_d1.ts`, which imports D1 bindings and cannot be loaded outside
  the server process.

So for "cooked oats with green grapes and toasted nuts" there is no catalog row.
The alternatives were to hand-write plausible numbers, or to use USDA values from
memory. **Both would have been fabrication presented as clinical ground truth**,
and the whole point of the bundle is that a coder can trust it and a verifier can
check it. A made-up 70 g of oats is worse than an empty corpus, because the loop
would then file confident bug cards against invented numbers.

`scripts/meal-audit-assist.mjs` exists and is correct for the 6 catalog entries
it can honestly serve: it scales per-100g values to a declared weight, derives
calories via Atwater so the generator's own gate passes, requires `boundingBox2D`
when photos are present, and fails loudly on an unknown key rather than filling
zeros. It is a scaling helper, **not** an audit, and it does not pretend to be one.

## The real fix: read nutrients from the app's own catalog — DONE

`food_items` in D1 is the authoritative source the product already resolves
against — `resolveInternalFood()` reads `nutrients_per_100g` from it. The gap was
that no **agent-facing** endpoint exposed it.

**Shipped:** `GET /api/audit/food-nutrients?q=` (`server_routes_jobs.ts`), a
sibling to the existing audit route. Read-only, unauthenticated like the other
audit reads, clamped to 50 rows, `status = 'active'` only (a candidate row's
numbers are not ground truth), returning per-100g values **unscaled** plus
`fdc_id` and `standard_serving_g`. Verified live against the dev server:

```
q=oats    -> Rolled Oats (379 kcal/100g, std serving 100g), Sainsbury Rolled Oats
q=grapes  -> Grapes      q=steak -> Steak Sandwich, beef steak, sliced steak
q=pasta   -> Macaroni Pasta   q=milk -> Whole Cow Milk, milk, oat milk
```

`meal-audit-assist.mjs` now accepts `api:<query>` catalog keys, so a real meal is
auditable end to end. Proven on a live example — "cooked rolled oats with green
grapes", 60 g oats + 90 g grapes:

```
assist      -> 150 g, 298 kcal, Atwater balanced (0.0% difference)
generator   -> Meal-OatsGrapes-01 bundle written
compare     -> verdict FAIL, 6 core + 18 micro findings vs the app's logged values
```

## The limit of the catalog, and what it does to the loop

That live compare is also the reason the loop is still dry-run. **18 of the 24
findings were artifacts of my own audit, not product defects.** `food_items` rows
for oats and grapes carry macros and a few minerals but omit most micronutrients,
so they scaled to 0 — and the comparator scores 0-vs-real as 100% drift. Filing
those would have produced a wall of bug cards against the audit itself.

So `meal-audit-assist.mjs` now **refuses to emit a knowingly incomplete audit**
(exit 4, nothing written) and names every unsourced nutrient. `--allow-unsourced`
is the explicit acknowledgement. Unresolved keys are also recorded per dish as
`unsourcedNutrients` and in the payload, so a reader can see the gap instead of
inferring it from a suspicious zero.

The six *core* findings that remain are the trustworthy ones — `totalFibre`
−21.7%, `potassium` −58.9%, `sodium` −466.7% — and even those are only as good as
my declared 60 g + 90 g weighing, which is an estimate, not a measurement.

**So the honest position: the mechanism is complete and proven, and the corpus is
still not trustworthy enough to file from unattended.** The next real step is
micronutrient coverage in `food_items`, not more loop machinery.

## One real finding, recorded rather than filed

Reading the debug payloads of the two most recent meals turned up a structural
discrepancy that needs no nutrition data to establish. I checked it against a
second meal to find out whether it was systematic, and **it is not** — which is
what makes it interesting.

**Meal A** (`job_1790784359089_kvt6r0c0g`, "Sainsbury Oat and Fruit with Green Grapes"):

```
scout dishes   : 2
  "Sainsbury Oat and Fruit"   bbox [250,100,955,990]
  "Green Grapes"              bbox [390,110,875,880]
logged items   : 1   "Sainsbury Oat and Fruit with Green Grapes"
  weightGrams  : 70    calories: 313
  bbox         : [250,100,955,990]   <- dish 1's box, verbatim
```

**Meal B** (`job_1790784235900_ee9r7hg2i`, "Prawn and Penne Pasta Salad and Cooked Ham Slices"):

```
scout dishes   : 2      logged items : 2     <- both survive
  bbox [150,0,1000,1000] -> 350 g     bbox [350,0,950,980] -> 100 g
```

**Mechanism.** In Meal A the title is the composite phrase *"Sainsbury Oat and
Fruit **with** Green Grapes"*, and dish 1's label already contains dish 2's text.
The resolver matched that whole phrase to a single product row and kept only the
first bounding box. Meal B has two genuinely distinct labels, resolves each to its
own row, and keeps both. So the trigger is a **composite `"A with B"` name whose
parts are not independent products** — plausibly a compound-key or dedupe step,
not a general "second dish is dropped" bug. I have not traced the code path, so I
am naming the trigger, not the function.

**Consequence that follows regardless of cause:** the annotated SVG overlay and
the dish map are built from `itemsBreakdown`, so a detected dish with no
`itemsBreakdown` entry is invisible in the user-facing dish map. The Scout saw
the grapes; the product stopped showing them.

**What I am not claiming.** Meal A's `70 g` may well be correct — it is a branded
portioned oat product, so a standard-serving weight is defensible, and my
"looks like ~450 g" impression is an eyeball estimate, not a measurement. The
Atwater balance also passes (declared 313 vs computed 292.5, −6.5%, inside the
10% tolerance), so the macro arithmetic is internally consistent. Neither fact
touches the bounding-box defect, and I am not folding them into the same claim.

I have **not** filed this as a card. The structural half is falsifiable from the
payload above and is worth a human's eyes before a coder is pointed at it; the
weight half I cannot defend. Filing both would put an unweighable number into a
clinical ticket.


## What is left, in order

1. **Micronutrient coverage in `food_items`.** The blocker now. Oats and grapes
   carry macros but not vitamins, so any audit of them is incomplete and the
   assist tool (correctly) refuses to emit one. Until the catalog carries the full
   32, the loop cannot file from a photo-only audit without manufacturing findings.
2. **Weigh, don't estimate.** My 60 g + 90 g was an eyeball judgement. Core-nutrient
   verdicts are only as good as the declared weight, so a real audit wants a scale
   or the product's `standard_serving_g` — not a photo.
3. **Decide on `journey/bug-board-miniapp`** — a pre-existing 28 h branch that
   fails `TUI fixes-landed ratchet` and blocks this PR's merge. Land it, waive
   it, or declare it dead in `TUI_TG_AUTH_TRAIL.md`. Not mine to decide.
4. **Enable dispatch** (`MEAL_QA_ALLOW_DISPATCH=1`) and install the cron line —
   only after 1–2. The mechanism is proven; the evidence is not yet good enough to
   let it file unattended.

Next: this file, §"The limit of the catalog"
