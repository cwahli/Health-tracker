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

## The real fix: read nutrients from the app's own catalog

`food_items` in D1 is the authoritative source the product already resolves
against — `resolveInternalFood()` reads `nutrients_per_100g` from it. The gap is
that no **agent-facing** endpoint exposes it. There is exactly one audit-only
read route today, `/api/audit/food-search`, and it only covers `food_logs`.

Adding a sibling route (e.g. `GET /api/audit/food-nutrients?q=`) would give the
meal-audit agent a real, FDC-traceable nutrition source, and would make
`meal-audit-assist.mjs` able to serve real meals instead of dressings. That is a
small, well-scoped change and it is the honest unblocker.

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

1. **Add a food-nutrients audit route** over `food_items` (small change). This is
   the unblocker for a real corpus.
2. **Re-run the audit with a real nutrition source**, then let the loop file.
3. **Decide on `journey/bug-board-miniapp`** — a pre-existing 28 h branch that
   fails `TUI fixes-landed ratchet` and blocks this PR's merge. Land it, waive
   it, or say it is dead in `TUI_TG_AUTH_TRAIL.md`. Not mine to decide.
4. **Enable dispatch** (`MEAL_QA_ALLOW_DISPATCH=1`) and install the cron line —
   only after 1–2, so the loop has real evidence to close cards on.

Next: this file, §"The real fix"
