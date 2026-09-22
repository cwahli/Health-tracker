# Food — single-path add/edit + honest debug

**Pillar:** 2 — Food. **Start work from:** [ROADMAP.md](./ROADMAP.md) Track F **F-8**.  
**Laws:** `docs/agent/domains/food-calc.md` (update **with confirmation** when this ships).  
**Parent architecture:** [FOOD.md](./FOOD.md) Part B (durable meal) §5 stages + §10 debug channels.  
**Evidence job:** `job_1788115766430_v2z5q9hpz` (2026-08-30) + screenshot of 11 composition tiles.

**Status:** F-8.1–F-8.9 shipped. **Still to do:** F-8.10 (split `server_food_analyze_run.ts` as Meal Agent owners), F-8.12 (packaged facts), F-8.13 (debug download). **F-8.11 soak superseded by F-10.8.** Create is no longer Scout-then-Dietitian — see [FOOD.md](./FOOD.md) Process and ROADMAP **F-10**.  
**Date:** 2026-09-01  
**Class:** L (food-calc pipeline + debug). Not an X unless `docs/agent/**` is edited.

This document is **Part C** of the food architecture. It does not rebuild the curator (M30 stays). It does not replace Part A identity work (F-1…F-4). It collapses **duplicate calorie pipelines** and makes the debug file a 1:1 picture of the remaining process.

---

## 0. Problem

Add and edit already *have* a designed path:

```text
Meal Agent (P/C/F + OCR; TS expand if complex) → Finalize (OCR → brand → estimate, one scaler, Atwater) → number-substitute into draft verdict
```

What runs instead is that path, then **five more copies** of the same numbers, then a **second** edit executor that does not call finalize.

Evidence from `debug-job_1788115766430_v2z5q9hpz.md` (1,516 lines, 92 KB):

| Fact | Count |
|---|---:|
| Ice cream 253 kcal written | 9 |
| Protein 108.5 g (turn-1 total) | 10 |
| Protein 133.4 g (saved table) | 2 |
| `[Budget]` (finalize) | 14 (7 items × 2 turns) |
| First-Principles Injection | 7 (copies, no math) |
| `BACKEND PRE-CALCULATED` | 8 |
| Errors section | “No errors found” while 4 dishes have **0 kcal** |

User edit: *“The sempol ayam is 2 otak otak, the beef and chicken is 100g of beef steak and 100g of chicken steak, the tea is unsweetened and the sos bakar is fried chicken fillet.”*

Saved: 11 top-level cards, sauce promoted, sides 130→100 / 120→70 (few-shot grams), chicken/sauce/wedges/veg **cal=0**, three tiles showing the ice-cream photo, narrative still 108 g.

Root cause is not “scout is wrong.” Scout macros were fine. **Later stages forked.**

---

## 1. Goal

1. **One modal = one document.** First submit creates it. Every later submit in that modal is edit or Q&A on the **same** id (review meal or compare set). Opening a new modal is the only way to get a second meal.
2. **One calorie owner:** `finalizeDishLedger`.
3. **Scout-shaped estimates whenever there is no photo of that food** (text-only create, or edit `add_item` / identity change). Dietitian fills P/C/F; finalize still owns kcal.
4. **Q&A when `modificationCommand` is empty.** Card unchanged.
5. **Debug = that process, complete.** One instruction+reply per dispatch. No second “new_log” in an edit turn.

Non-goals:

- Rebuild curator / catalog (F-1…F-4, M30).
- Meal-green goldens / `POST /loop` / catalog paint (L14).
- Prompt-only math (L12).
- God-file rewrite of `server_routes_food_analyze.ts`. Extract helpers; thin call sites.

---

## 2. Key decisions

| # | Decision | Why |
|---|---|---|
| D1 | Meal Agent emits estimates only (P, C, total fat, sat fat, fibre, Na, added sugar, weights, crops, OCR **text**). TypeScript derives calories, unsaturated fat, and salt. | Create schema has no `calories` / `unsaturatedFat` / `salt` in `required[]`. Atwater + `rebalanceNutrientProfile` live in finalize. Elastic prototype `calories` fields are stripped before production. Never back-solve carbs from kcal. |
| D2 | `parseAndHealVisionScout` flattens dishes and splits extra fry-fat onto components. It does **not** Atwater. | Oil split is unique accuracy. Second Atwater is duplicate math. |
| D3 | First-Principles Injection is **deleted**. | It only copies finalize onto a dietitian-rebuilt list. Remove the rebuild, remove the copy. |
| D4 | `aggregateItemsNutrients` is **not** called after dish-estimate finalize. Sugar-split + prep-XOR move **into** finalize. | Two calculators produced this job’s inherit `cal=0`. |
| D5 | Receipt is a **view** of the ledger, not a seventh calculator. | This job re-summed 253 then logged it again. |
| D6 | First submit: Meal Agent emits a **draft** verdict/message; TypeScript substitutes finalize numbers. No second Dietitian create pass. Edit: same role emits `modificationCommand` only (or `[]` for Q&A). Never `itemsBreakdown`. | Dual schema made T2 look like a new meal. Systematic Dietitian-on-create is F-10’s `ALWAYS_SECOND_AGENT`. |
| D7 | Edit executor is TS. `add_item` / `replace_identity` **require** a scout-shaped `estimate` (P/C/F…) when scout did not see that identity. Then finalize. | Live `add_item` had only a name+grams, so inherit `cal=0` or a generic profile. |
| D12 | Follow-up in the same modal never `new_log`, including extra photos (merge dishes). Compare uses the same rule on the ComparisonSet. | T1 `review` pill forces `new_log`; new images isolate `activeMeal`. |
| D13 | Server user prompt = original log skeleton (profile, time, scout/meal lines, **one** pre-calc ledger, current input). Human text may be empty. | Today PRE-CALCULATED + SERVER BASELINE + meal JSON are the same 7 items three times. |
| D8 | Gate is computed (not `grep error`). Unsavable on fail. | This job’s Errors section was green. |
| D9 | Debug markdown is a **complete** forensic file of the process that ran: actions, gate errors, **full agent instructions and replies once per dispatch**, and every stage output. Logger must not paste the same blob twice. If a stage ran twice, both runs appear in full. | After F-8 the process is shorter, so the file is shorter — not because we hide prompts. Sample: `plan/samples/debug-job_1788115766430_v2z5q9hpz.after-f8.md`. |
| D10 | Photo `{sourceImageIndex, boundingBox2D}` is a field on FoodItem. Identity replace **copies** it. Composition tiles = FoodItems only. | Ice cream on Otak / Beef / Fillet was missing media on new rows. |
| D11 | Packaged `chainName` / barcode / can OCR **must bind** (do not `CuratorSkipped`). | Hemaviton C1000 → ~125 mg vitamin C instead of ~1000 mg. |

---

## 3. Does live code work like FOOD.md Process?

**No.** Spec `FOOD_CHAT_UNIFIED_EDIT_QA_SPEC` already said one meal per session. This job and the server still violate it.

| Required | Live (`job_1788115766430`) | Result |
|---|---|---|
| First submit creates one meal | T1 `review` pill → `[Mode Override] Forcing mode to new_log` | OK for first submit |
| Same modal, later submit = same meal | T2 `userSelectedMode=edit` + `activeMeal` received | Same job id, good |
| Dietitian must not rebuild the meal | T2 emitted a full 11-row `itemsBreakdown` + `foodData.name` | **Looks like a new meal** in the debug |
| Edit vs Q&A = empty vs non-empty commands | Also regex `had\|ate\|change\|…` and Mode Rewrite to `new_log` if `itemsBreakdown` present | Fork |
| Extra photos in same modal merge | New images → `[State Isolation] Isolating activeMeal` | Would mint a second meal |
| `add_item` / “X is Y” needs scout-shaped macros | Dietitian sent only `itemName` + `newWeightGrams`; backend inherit or generic 33-profile | **cal=0** / invented 80/100/70 |
| Compare follow-up | Same isolation + dual schema | Same class of bug |

The “another new meal” in the dump is T2’s rebuilt `itemsBreakdown`, the concatenated NEW FOOD LOGGING + EDIT instructions, and Mode Rewrite — not a second job id.

---

## 3b. Target session process

Canonical copy lives in [FOOD.md](./FOOD.md) **Process**. Here is the execute version.

```text
Open review or compare modal
    first submit  → CREATE (Meal Agent; TS expand if complex) → finalize → substitute numbers into draft message
    later submit  → same agent commands or []
                      []        → Q&A (no finalize)
                      commands  → patch + finalize dirty rows (same id)
    extra photos  → Meal Agent on NEW images only, MERGE dishes into the same document
```

### Create (first submit only)

One Meal Agent dispatch (photos and/or text) emits the estimate object below plus a draft verdict/message. TypeScript may spawn workers for remaining dishes. Finalize then **substitutes** ledger numbers into the message. Task name is not “NEW FOOD LOGGING rebuild” and is not a required second Dietitian call.

### Later submit: edit vs Q&A

Same agent schema. `modificationCommand: []` → answer only. Non-empty → executor.

```text
replace_identity  itemId newName  estimate?  keep weight, photo, box
set_count         itemId count
set_weight        itemId grams
set_modifier      itemId unsweetened|no salt|no oil
split_item        itemId into[{name, grams, role, estimate?}]
add_item          name, grams, estimate   ← required
remove_item       itemId
```

`estimate` (scout-shaped, **no calories**):

```json
{
  "protein": 11, "carbohydrates": 15, "totalFat": 4, "saturatedFat": 1.2,
  "sodium": 280, "addedSugar": 0, "totalFibre": 0.5,
  "cookingMethod": "grilled", "foodType": "protein"
}
```

| Command | Estimate required? | Why |
|---|---|---|
| `add_item` (no photo of that food) | **Yes** | Scout did not run. This is the only P/C/F source. Finalize → kcal. |
| `replace_identity` (sempol → otak, sosis → fillet) | **Yes** | New identity; old P/C/F belong to the wrong food. Photo/weight kept. |
| `split_item` into newly named foods (beef, chicken) | **Yes** on each new identity | Scout had one blended 250 g row. |
| Leftover components (wedges, veg, sauce) | No | Scale saved macros. |
| `set_weight` / `set_modifier` / `set_count` | No | Same food. |

Executor: never remove+add for “X is Y”; never invent grams for unmentioned sides; sauce stays a component; modifier once; finalize **only dirty rows**.

### User prompt (create and edit — same skeleton, no duplicates)

Taken from this job’s real user prompts, **one** ledger not three:

```text
USER DIETARY PROFILE & DEMOGRAPHICS:
- Age: 43 years old
- Gender: Male
- Weight: 60 kg
- Height: 163 cm
- Ethnicity: Chinese

CURRENT TIME CONTEXT: 2026-08-30 7:51:47 PM
CRITICAL INSTRUCTION: You MUST use "2026-08-29" in foodData.date unless the user gives another date.

=== VISUAL FOOD SCOUT IDENTIFIED ITEMS ===     ← create only; omit on edit
- Index: 0 | Scout Item: "Soft Serve Ice Cream Cone" | Weight: 120g | …

=== BACKEND PRE-CALCULATED AUTHORITATIVE MEAL TOTALS ===
Total Weight: 1635g | Calories: 1681 kcal | Protein: 108.5g | …

=== BACKEND PRE-CALCULATED ITEM NUTRIENTS ===
- "Soft Serve Ice Cream Cone" (120g):
  Calories: 253 kcal
  Protein: 4.5g
  Fat: 8.3g (Saturated: 5.5g)
  Carbs: 40g (Sugar: 18g, Added Sugar: 18g)
  Sodium: 90mg
  Constituent Ingredients Breakdown:
    * Vanilla Soft Serve Ice Cream (95g): 168 kcal, 3g protein, 7.5g fat, 22g carbs
    * Waffle Cone (25g): 85 kcal, 1.5g protein, 0.8g fat, 18g carbs
- … (one block per item, same shape as the original log)

Current User Input: "Analyze this meal photo."
                  or the edit sentence
                  or "" if the human sent nothing
```

**Drop from today:** second `SERVER BASELINE ESTIMATE` JSON, `CURRENT_ACTIVE_MEAL_STATE` repeating the same items, chat history that restates 108.5 g macros. Keep one assistant line of prior *message* if useful for Q&A.

On **edit**, replace the scout-identified list with the same item breakdown (it *is* the current meal). Do not also dump `activeMeal` JSON in the system prompt.

### Compare

Same session rule. First submit in a compare modal creates the ComparisonSet. Later messages edit an option or Q&A. Dietitian compare instruction on create; edit/Q&A instruction afterward. Extra photos add/replace options on the same set.

Delete from live path: Modify Math inherit (`cal=0`), Mode Rewrite to `new_log` because `itemsBreakdown` exists, dual unsweetened, steak-split few-shot 80/100/70, `review`+images isolating an existing `activeMeal`.

### 3.3 Gate (hard)

Save refused (`savable: false`, `gate.pass: false`) if any:

| Check | This job |
|---|---|
| `kcal === 0` && (protein+carbs+fat) > 0 | Chicken steak, sauce, wedges, veg |
| Atwater(item) off > 35% when calories not OCR/brand-locked | Same four rows |
| `sum(item.kcal) !== meal.kcal` | 1351 vs ~1640 |
| Narrative protein/kcal ≠ ledger (unless `staleDietitianNarrative`) | 108 vs 133.4 |
| FoodItem missing photo when meal has images | Otak, Beef, Fillet → image 0 |
| Unspecified field mutated vs previous meal | Wedges 130→100, veg 120→70 |
| Condiment protein density of steak | Sauce 13.4 g protein / 80 g |
| Component promoted to FoodItem without user saying so | Black Pepper Sauce tile |

Repair is **recompute in TS** (finalize), not another LLM loop. Honest residual (identity MISS) stays red; do not paint.

---

## 4. Keep / merge / drop (accuracy)

| Stage today | Verdict | Accuracy if removed |
|---|---|---|
| Vision Scout | **Keep** | Blind |
| Heal: flatten + fry-fat split | **Keep slim** | Under-fat fried food |
| Heal: Atwater kcal | **Merge into finalize** | None (done twice today) |
| `finalizeDishLedger` | **Keep — number owner** | No kcal, no label/brand lock |
| First-Principles Injection | **Drop** | None — it is a copy |
| `aggregateItemsNutrients` after dish-estimate | **Drop** (fold sugar/prep into finalize) | None if folded |
| Receipt as calculator | **Drop** (keep as print) | None |
| Nutrient Final Check | **Log line only** | None |
| Dietitian `itemsBreakdown` on add | **Drop** | Stops wipe/re-inject |
| Dietitian `itemsBreakdown` on edit | **Drop** | Stops fork + 0 kcal |
| Dietitian `correctedNutrients` + note | **Keep** | Occasional oil/Na under-estimate |
| `applyNutrientModifiers` | **Keep once** | Unsweetened forgotten |
| Re-finalize untouched on edit | **Drop** | None |
| `synchronizeNarrativeText` regex | **Replace with gate / template** | This job still showed 108 g (edit returned first) |
| Two prompt ledgers + chat macros | **One compact table** | Stale 108.5 citations |
| Catalog skip on `chainName` | **Bind packaged** | **Gains** Hemaviton vitamin C |
| Gate | **Add** | This job would not save |

---

## 5. Debug: complete file, 1:1 with the process

The download is a **full forensic log**, not a summary. If the process is long, the file is long. After F-8 the process has fewer stages, so the file is shorter because those stages **did not run** — not because the writer hid them.

### 5.1 Keep from today’s dump

| Section today | Keep? | How |
|---|---|---|
| Header (job, mode, photos) | Yes | Same |
| Last user action | Yes | Plus the actual prompt text (today omitted it on the action line) |
| Breadcrumbs | Yes | This job’s clicks/submit. Drop CSS-class button labels if we have `id` |
| Network / console | Yes | This job’s requests + real errors. Session-wide Firestore 2.5s from *other* minutes is appendix, not the Errors section |
| Saved nutrition table + 32 nutrients | Yes | Once (the saved book) |
| Dietitian narrative | Yes | Once, must match the table |
| **Agent instructions** | **Yes, full body** | **Once per dispatch that ran** (scout T1, dietitian T1, dietitian T2). Schema included. |
| Agent replies | Yes, full JSON | Once per dispatch |
| Backend process log | Yes | Every stage that **executed**, with its output |
| “Errors & Warnings: none” via grep | **No** | Errors = gate classes + thrown exceptions |

### 5.2 Do not keep (logger echo, not process)

Today the same scout system instruction appears in (1) extracted prompts, (2) `UnifiedLLM-Prompt:scout`, (3) backend log “full content omitted” then pasted again. That is **three copies of one dispatch**.

Writer rule: one dispatch → one instruction block + one reply block. Backend log **refers** to that block (`see § Agent dispatch scout T1`) instead of pasting it again.

If finalize **ran twice** (bug or leftover fork), the log shows **two** `[finalize]` blocks in full. That is a process duplicate and must be visible. After F-8, T2 does not re-finalize ice cream, so ice cream 253 appears once.

### 5.3 Section order (after F-8)

```text
1. Header
2. Last user action + breadcrumbs
3. Gate / errors  (computed; empty pass still listed)
4. Saved meal (items + 32 nutrients + narrative)
5. Agent dispatches — full instruction + full reply, once each, in time order
6. Process execution — T1 then T2, every stage that ran, full item ledgers
7. Network / console (this job)
```

Complete sample for this evidence job after F-8: [`plan/samples/debug-job_1788115766430_v2z5q9hpz.after-f8.md`](./samples/debug-job_1788115766430_v2z5q9hpz.after-f8.md).

---

## 6. Complete sample (this job, after F-8)

Full file (instructions, replies, both turns, gate, process):  
[`plan/samples/debug-job_1788115766430_v2z5q9hpz.after-f8.md`](./samples/debug-job_1788115766430_v2z5q9hpz.after-f8.md)

That file is the debug download. It is long because T1 scout + two dietitian dispatches + finalize ledgers are inlined **once**. Ice cream 253 kcal appears in T1 finalize and in the saved table (two books: computed, then saved) — not nine times.

---

## 7. Phased delivery (ROADMAP F-8)

Each phase is independently savable. Inner loop = named vitest, **no** `/loop`. Outer = this evidence job as one replay, not a green-paint.

### F-8.1 Save gate + trial-balance debug header  *(do first)*

**Done when:** a meal with `kcal=0` and protein>0 is `savable: false`; debug markdown **opens** with the trial-balance table + `GATE: FAIL` classes; Errors section is that gate, not “no errors found.”

**Files:** `server_meal_gate.ts` (new, pure), call site in `server_routes_food_analyze.ts` before return; `src/utils/debugPayload.ts` (header + books, still may append a short log excerpt).

**Tests:** `server_meal_gate.test.ts` — 0-kcal+protein fail; Atwater fail; narrative mismatch; unspecified side-weight mutation. Must fail on a **new** food of the class, not this meal’s names.

**Does not yet fix** inherit; it **refuses to save** it. Next dump of this job still contains full instructions, but Errors is the gate (4× cal=0), not “no errors found.”

### F-8.2 Meal items = finalize; delete First-Principles; skip post-finalize aggregate

**Done when:** add path has no `[First-Principles Injection]` log; ice cream 253 appears **once** in process lines; `aggregateItemsNutrients` not called when `isDishEstimateEnabled`.

**Move into finalize:** `deduceSugarBreakdown`, prep-XOR already implied by heal fat-split. Receipt becomes `formatReceipt(ledger)`.

**Files:** `server_dish_finalize.ts`, `server_routes_food_analyze.ts` (delete injection block ~6095–6204 and the post-dietitian aggregate on dish-estimate), `server_nutrient_aggregation.ts` remains for non-estimate / Mode D if still needed — **sibling path noted** if Mode D still uses it.

**Tests:** existing `server_dish_finalize.test.ts` + new “no second kcal book” (spy/log assert). Turn-1 macros of this job stay 1681 / 108.5.

### F-8.3 Edit executor through finalize

**Done when:** replace_identity / split / set_modifier / set_count exist; inherit `cal=0` path is gone; untouched items not re-budgeted; modifier once; unspecified sides frozen.

**Files:** `server_meal_edit.ts` (new), thin call in food_analyze modify branch; delete Modify Math inherit/add factor table for this path; `applyNutrientModifiers` called only from executor.

**Tests:** `server_meal_edit.test.ts`

- “X is Y” copies photo + weight, does not mint image 0  
- split 250 g sauced steak → 100+100 meat, sauce **component**, wedges 130 / veg 120 unchanged  
- “2 otak” sets `count=2`, does not invent 100 g  
- unsweetened twice → one apply  
- after patch, every FoodItem has kcal = Atwater(P,C,F)

**Few-shot:** delete Black Pepper Sauce 80 / Wedges 100 / Veg 70 from dietitian edit instruction. Generic example: “keep unmentioned components at saved grams; sauce stays a component.” Net-zero prompt lines (L12) — replace, don’t add.

### F-8.4 Dietitian contract slim

**Done when:** edit `responseSchema` has `modificationCommand` and **no** `foodData.itemsBreakdown`; add schema has no obligation to echo the 7 rows; one compact ledger table in the user prompt (drop `BACKEND PRE-CALCULATED` **or** `SERVER BASELINE`, keep one); `synchronizeNarrativeText` not used as the accuracy mechanism (gate + template).

**Files:** `agents/dietitianInstructions.ts`, food_analyze schema ~5124–5238, prompt assembly ~4847–5420.

**L12:** total instruction words ≤ current. Consolidate the duplicated ACTIVE TASK / CORE DIRECTIVES / JSON schema that appear twice in today’s dump.

### F-8.5 Debug renderer from ledger (finish §5)

**Done when:** download contains full instruction + reply **once per dispatch**; gate errors (not grep); backend process does not paste those instructions again; if finalize ran twice, both blocks are present. Sample shape: `plan/samples/debug-job_1788115766430_v2z5q9hpz.after-f8.md`.

**Files:** `src/utils/debugPayload.ts`, `src/mealBuild/coldDebug.ts`, jobs debug route.

**Tests:** `debugPayload.test.ts` — fixture with one scout dispatch: schema appears once; second paste of the same system instruction fails the test; gate classes present.

### F-8.6 Photo identity + composition tiles

**Done when:** identity replace copies media; composition maps **FoodItems** not flattened components; no round-robin when all `sourceImageIndex===0`; carousel is current items.

**Files:** edit executor (media copy), `FoodCard.tsx` `displayedScoutItems` (do not round-robin; do not extra-tile components). Stay under F-6 ceiling — prefer `NutritionLabelTable` / small helper over +100 lines in FoodCard.

**Tests:** unit on media copy; UI mapping: 7 tiles not 11 for the post-fix plate.

### F-8.7 Packaged bind (Hemaviton)

**Done when:** `chainName` or can OCR does not take `CuratorSkipped`; vitamin C / labelled kcal from brand or printed facts when present.

**Files:** skip condition around `[CuratorSkipped] Dish estimate pipeline`; finalize already has brand/OCR rungs — **call them**.

**Tests:** canned drink with `chainName` + no `rawNutritionLabel` still attempts brand; fixture not this FDC list (L14).

### F-8.8 Heal slim (Atwater only in finalize)

**Done when:** `parseAndHealVisionScout` no longer writes item kcal except as a throwaway display; finalize is the first persisted kcal. Fry-fat split remains.

**Depends on:** F-8.2 so nothing else needs heal-kcal.

### F-8.9 Delete the calorie host (reliability)

**Why:** Literature (Knight Capital leftover path; Fowler strangler — host must die; McCabe complexity; NASA Power of Ten simple control flow). A bypass that leaves 2,600 lines of the old writer is the same defect class as the evidence job.

**Done when:**

- `server_routes_food_analyze.ts` contains no `[First-Principles Injection]`, no post-finalize `aggregateItemsNutrients(`, no “5-Column Clean First-Principles Ledger” receipt loop, no Modify Math inherit/`standardItems` calorie factors.
- Create always maps from `finalizeDishLedger` (`buildMealFromFinalizeLedgers`).
- Edit always uses `applyMealEdits` (no `FOOD_DISH_ESTIMATE=0` twin).
- File line count drops by the deleted host; catalog ceiling records the new size so the host cannot grow back.

**Do not:** split finalize/edit/gate into dozens of 40-line files (Goldilocks: medium owners). Do not rewrite FoodCard/LogChat in the same change.

### Remaining after F-8.1–F-8.9 (ROADMAP F-8.10–F-8.13)

Execute IDs **F-8.1–F-8.9 are shipped**. These four are leftover reliability, not a new architecture.

| ID | Still to do | Done when | Do not |
|---|---|---|---|
| **F-8.10** | Split `server_food_analyze_run.ts` (~3772) into 400–600 owners: scout dispatch, DB search, prompt assembly. Delete unused `STANDARD_FOOD_FACTORS` if it is a leftover mock table. Keep `server_routes_food_analyze.ts` ≤700 | Catalog ceilings honest; no second kcal writer | 40-line shards; move math back into the HTTP file |
| **F-8.11** | One live Gemini soak of the evidence job (or a new 6-photo plate of the same class). Inner TS fixture already asserts 1635 g / 85 g count=2 / sauce remainder | Same meal id; 7–8 FoodItem tiles; no inherit `cal=0`; narrative = table | `POST /loop` / catalog paint / meal-green |
| **F-8.12** | Packaged drink facts when brand/OCR exist (Hemaviton-class). Bind-attempt + `BIND_MISS` already honest | Labelled kcal / vitamin C from brand or printed facts when present | Invent 1000 mg vitamin C |
| **F-8.13** | Real debug download vs [after-F-8 sample](./samples/debug-job_1788115766430_v2z5q9hpz.after-f8.md) **and** [RELIABILITY.md](./RELIABILITY.md) **§11 + §11.12 A–F** | JSON tree canonical; dialog inventory; jobId on lines; dispatch latency; handoff dropped keys; Contract first; I/O once; process dupes scored | Hash-only prompts; PNG as contract; LLM-judge |

**Also not F-8** (Track F, already on ROADMAP): F-1…F-4 identity/catalog; F-6 FoodCard ceiling; F-7 scout prompt net-zero. Q-1 is green so F-6/F-7 are unblocked.

---

## 8. Files (blast radius)

| Area | Touch |
|---|---|
| New | `server_meal_gate.ts`, `server_meal_edit.ts`, tests for both, `debugPayload` tests |
| Thin call sites | `server_routes_food_analyze.ts` (delete injection, modify branch, dual precalc string) |
| Number owner | `server_dish_finalize.ts` (sugar/prep in; receipt format out) |
| Heal | `server_vision_scout.ts` (stop persisted Atwater) |
| Prompts | `agents/dietitianInstructions.ts` (net-zero, delete 80/100/70 few-shot) |
| Debug | `src/utils/debugPayload.ts`, `src/mealBuild/coldDebug.ts` |
| UI | `FoodCard.tsx` mapping only (F-8.6), watch F-6 line ceiling |
| Docs | this file; [FOOD.md](./FOOD.md) Process; [ROADMAP.md](./ROADMAP.md) F-8.9; `food-calc.md` (confirmed this task: single writer, host deleted) |
| Do not | `food_aliases`, golden `expected.json`, `CANONICAL_BASE_FOODS` `includes()`, `POST /loop` |

---

## 9. Tests (named, class-first)

| Phase | File | Must fail on a *new* food of the class |
|---|---|---|
| F-8.1 | `server_meal_gate.test.ts` | any 0-kcal row with protein>0 |
| F-8.2 | `server_dish_finalize.test.ts` + log assert | second kcal book absent |
| F-8.3 | `server_meal_edit.test.ts` | identity replace; split keeps unmentioned sides; sauce component |
| F-8.4 | instruction/schema unit (string absent) | `itemsBreakdown` not in edit schema |
| F-8.5 | `debugPayload.test.ts` | no system-prompt dump; GATE from books |
| F-8.6 | media + tile count | new item without index does not steal image 0 when old item had a crop |
| F-8.7 | brand/OCR attempt | canned `chainName` not skipped |
| F-8.8 | heal + finalize | persisted kcal only after finalize |
| F-8.9 | `server_routes_food_analyze.ts` source assert | `First-Principles Injection` string absent; no second `aggregateItemsNutrients` after finalize |

Regression (after any code phase):  
`npx vitest run server_dish_finalize.test.ts server_vision_scout.test.ts server_portion_clarify.test.ts server_nutrient_aggregation.test.ts`  
`npx tsc --noEmit`  
`node scripts/assert-budgets.mjs`

Do **not** replay this meal until `all_green`. Outer check = one fixture derived from the job (commands + prior ledger), not live Gemini.

---

## 10. Documentation (when implementing)

| Doc | When |
|---|---|
| This file | now (architecture) |
| ROADMAP F-8 | now (execute IDs) |
| FOOD.md Part B §5 / §10 | pointer + “calculation is finalize only; debug from ledger” |
| `docs/agent/domains/food-calc.md` | **ask first** (§3 protected). Same change: “edit = patch + finalize”; “no First-Principles”; “debug = books”. |
| `AI_HANDOVER.md` | WIP row per phase |

---

## 11. Risks

| Risk | Mitigation |
|---|---|
| Mode D still needs `aggregateItemsNutrients` | Keep function; skip only on dish-estimate Mode A/Edit. Note sibling in handover if D not updated same PR. |
| Dietitian lite drops `modificationCommand` without itemsBreakdown | Schema `required: ["modificationCommand"]` on edit; TS fallback intent matcher for the four user patterns; two burns → `blocked_human`. |
| FoodCard line ceiling (F-6) | Tile mapping in a tiny helper, not +100 lines in FoodCard. |
| Hemaviton still no printed facts | Bind attempt is success; honest residual if brand MISS. Do not invent 1000 mg. |
| Removing injection before stopping dietitian rebuild | **Order: F-8.1 gate, then F-8.2 only if add path already uses finalize items** (it does on dish-estimate). Edit stays on commands (F-8.3) so injection is add-only dead code. |

---

## 12. Success (this evidence job)

Replay as **outer check** (not inner loop):

1. Debug is complete: breadcrumbs, gate, saved table, **full** scout + dietitian instructions once each, full replies, T1/T2 process. Same instruction not pasted three times. Ice cream 253 only in T1 finalize + saved table.
2. Turn 2: 7 FoodItems, not 11 tiles; sauce is a component; wedges 130 g; veg 120 g; otak count=2 on img2; fillet on img5.
3. No item with kcal=0 and macros>0.
4. Narrative protein = table protein.
5. Unsweetened applied once (tea ~0–2 kcal, −18 g added sugar vs T1).
6. Ice cream 253 kcal appears once in process lines.
7. `GATE: PASS` or an honest residual (`BIND_MISS` Hemaviton) — not a silent 0 kcal save.

---

## 13. One-line north star

**Scout sees. Finalize counts once. Edit is a patch. The debug file is those sentences.**
