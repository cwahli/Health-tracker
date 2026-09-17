# Food — pipeline and meal document

**Pillar:** 2 — Food. **Start work from:** [ROADMAP.md](./ROADMAP.md).  
**Laws:** `docs/agent/domains/food-calc.md`  

**Coding:** read **Process** (this file through the module table). Stop. Execute IDs are on [ROADMAP.md](./ROADMAP.md). Part A/B below are catalog + durable-meal history — load only for F-3/F-4 identity, not for F-10.

Not a “lifecycle” in the biomarker sense: a meal is one-shot (Meal Agent → resolve/bind → finalize → durable meal; TypeScript expands the agent when the meal is complex). Two parts, nothing dropped:

- **Part A** — identity / curator / catalog (was `FOOD_RESOLVER_CURATOR_AND_1PASS_CATALOG_PLAN.md`)
- **Part B** — durable meal document (was `MEAL_BUILD_DURABLE_STATE.md`)

Remaining execute IDs on [ROADMAP.md](./ROADMAP.md): **B0** is Current work (not this file). Food leftovers: **F-3 / F-4 / F-6** (identity + FoodCard), **F-11.2 / F-11.3** (curator LLM, wait for **go**). F-10, F-8.10–8.13, F-9.5, F-11.1, F-12.1–12.4 shipped. Do **not** put a curator LLM back on Analyze. Do **not** reopen FDC.

---

## Process (binding — how a modal works)

One open food modal owns **one** document. That is true for **review (log a meal)** and **compare**.

**Agent model (F-10):** One **Meal Agent** role. Typical meals finish in **one** dispatch. TypeScript expands to parallel workers when the meal is complex. There is **not** a systematic Scout-then-Dietitian pair on every create. Same pattern as biomarkers (one Review for n=1–5; specialists only when the dispatcher expands). Evidence: `prototype/meallog/meal/` (1-agent vs always-two, elastic COMPLETE/DELEGATE).

```text
Open modal
  → empty slot (draft job). No meal yet.

First submit in this modal
  → CREATE that document (never a second one)
  → Meal Agent (photos and/or text) emits dishes / foods / P/C/F / OCR / draft verdict+message
       TS expand gate (dish count, image count, receipt/barcode) — the model does not pick COMPLETE/DELEGATE
         no  → one dispatch
         yes → lead solves anchors + locked OCR grams; workers finish remaining dishes (locked grams, no re-OCR)
  → finalizeDishLedger (calories, OCR/brand, Atwater; optional TS fat/Na from diningEnvironment × cookingMethod)
  → substitute ledger numbers into the draft message (no second LLM unless the message is empty)
  → evaluateMealGate

Later submits in the SAME modal
  → same meal id / same comparison id
  → no new meal card, even if the user attaches more photos (those MERGE as added dishes)
  → same Meal Agent:
       modificationCommand[] empty  → Q&A, card unchanged
       modificationCommand          → patch this meal, then finalize dirty rows
```

| | Review modal | Compare modal |
|---|---|---|
| First submit | 1 Meal | 1 ComparisonSet |
| Later submit | edit or Q&A on that meal | edit or Q&A on that set |
| New document | **open a new modal** | **open a new modal** |

Edit vs Q&A is the Meal Agent’s `modificationCommand` (empty = Q&A). Not a keyword regex, not a second “new_log”. The Dietitian instruction pack is this role’s **edit / Q&A / optional narrate** slice — not a required create stage. Internal ids may stay until a dedicated rename.

**Where numbers come from**

The agent estimates what vision/text can support. TypeScript **derives** anything that is a function of those estimates. Calories are the main case, not the only one.

| Event | Agent emits | TypeScript derives |
|---|---|---|
| First submit (photos and/or text) | Identity, grams, P, C, **total** fat, sat fat, added sugar, fibre, sodium; OCR **text**; draft verdict | kcal, unsaturated fat, salt; brand/OCR printed-kcal **lock** |
| **add/replace a food on edit** (no new photo) | Same `estimate` object (no kcal) | Same |
| Split / scale of food already on the meal | Saved row (scale). `estimate` only when a **new identity** is named | Re-derive on dirty rows |
| Q&A | — | Unchanged |

| Field | Owner | Must not |
|---|---|---|
| protein, carbohydrates, totalFat, saturatedFat, addedSugar, totalFibre, sodium | Meal Agent (or printed label / brand lock) | Back-solve **carbs from kcal** (phantom-carb class) |
| transFat | Agent if printed; else TS `0` | Invent industrial trans |
| **calories** | `finalizeDishLedger` Atwater `4P+4C+9F`, **unless** OCR/brand printed kcal is a hard lock | Agent `calories` in schema; elastic prototype kcal |
| unsaturatedFat | TS `totalFat − sat − trans` | Agent emit |
| salt | TS `(sodium_mg × 2.54) / 1000` | Agent emit |
| dish/meal micros | Agent, directional | Treat as 90% core |

The Meal Agent never invents kcal, unsaturated fat, or salt. Elastic prototype schema that emits `calories` is a **bug to strip** before production.

**User prompt** is almost all server-built (profile, time, one ledger, scout/meal lines). The human line is often empty or one sentence. Same skeleton for create and edit; do not paste the ledger twice.

**One writer per fact (reliability).** Dual calorie books are a known defect class (leftover path + reused flag). The analyze HTTP file is an **adapter**, not a second calculator. When a new path is 100% of traffic, the old host is **deleted** — not wrapped.

| Fact | Owner | Not allowed |
|---|---|---|
| Identity / P/C/F | Meal Agent (create or `estimate` if no photo of that food) | Generic profiles in the route |
| Calories / unsaturated / salt | `finalizeDishLedger` (+ `rebalanceNutrientProfile`) | LLM `calories`/`unsaturatedFat`/`salt` on create schema; First-Principles; `aggregateItemsNutrients` after finalize; receipt-as-math; inherit `cal=0`; carbs-from-kcal |
| Expand vs one dispatch | TypeScript gate (`shouldExpandMealAgent`) | Model `COMPLETE`/`DELEGATE`; systematic Dietitian pass on every create |
| Same meal vs new | Modal session | Mode Rewrite, review-pill `new_log` on an existing document |
| Edit vs Q&A | `modificationCommand` empty or not | Keyword regex, `itemsBreakdown` rebuild |
| Save or not | `evaluateMealGate` | Log grep |
| **What the preview shows** | Current job turn (`currentTurn` + `status`; `result` null while running) | Infer in-flight from `pendingFoodLog` / snapshot keys / `effectiveStatus`; four competing “current meals” |

Session leftover **F-9.5** (App poller emitters): [ROADMAP.md](./ROADMAP.md) Track F. Adaptive agent **F-10**. Do not mix F-10 with F-9.5 in one PR. Workers still publish through `currentTurn`.

| Module | Role | Size band |
|---|---|---|
| `server_routes_food_analyze.ts` | HTTP adapter: mount routes, return JSON | keep ≤700; never a second kcal writer |
| `server_food_analyze_run.ts` | Pipeline: Meal Agent → (optional workers) → finalize → number-substitute → gate | medium owner; not a second kcal writer |
| `server_dish_finalize.ts` | Calories (+ optional TS fat/Na critic) | keep ~400–600 |
| `server_meal_edit.ts` | Commands | keep ~400–600 |
| `server_meal_gate.ts` | Save/refuse | keep ~200–300 |
| `server_vision_scout.ts` | Meal Agent create dispatch (identity + P/C/F + OCR; no persisted kcal) | slim toward ~800 |
| `server_nutrient_aggregation.ts` | Off the hot path | do not call after finalize |

Detail, leftover F-8 IDs (**F-8.10–F-8.13**), F-10 execute IDs, and debug shape: [FOOD_SINGLE_PATH.md](./FOOD_SINGLE_PATH.md) + [ROADMAP.md](./ROADMAP.md) Track F. F-9.5 App/LogChat emitters shipped. Do not mix job-lifecycle files with food-calc.

---

## Part A — Catalog: no USDA; brand catalog self-cleans

**Pillar:** 2 — Food. Execute: [ROADMAP.md](./ROADMAP.md) **F-12** (delete USDA) then **F-11** (brand self-clean).  
**Laws:** `docs/agent/domains/food-calc.md` §1 truth hierarchy (rung 3 USDA line updates in F-12 with confirmation).  
**Updated:** 2026-09-13

Locked: live USDA/FDC is **out**. Meal Agent + OCR + brand catalog are enough (50-meal audit: loose FDC overwrite injected ~2.2k kcal of false friends; strict match still only moved ~0–20 kcal and did not add a 30-nutrient panel on current logs). Curator/resolver is **one** librarian for **brand_menu_items**, off Analyze.

---

### A.0 How it is called today (do not guess)

Default Analyze is dish-estimate (`isDishEstimateEnabled` returns **true**).

```text
Meal Agent (scout LLM)
  → precalc
       dish-estimate ON (default)
         → SKIP runDatabaseSearchStage
         → SKIP executeFoodResolverCurator
         → PackagedBind for OCR items
         → STILL fetch USDA if a component has suggestedFdcId   ← F-12 deletes this
       dish-estimate OFF (legacy flag)
         → USDA + OFF + food_items + curator   ← F-12 deletes this path
  → finalizeDishLedger
       Rung 1 OCR
       Rung 2 Brand menu (matchBrandMenu)
       Rung 3 Meal Agent P/C/F + Atwater
       Ghost component: lookupCanonicalBaseFood (local frozen table)
```

Brand **match** still runs. Brand **clean** (`selfCleanBrandDatabase`) is hung off the skipped resolver, so it never runs. That is F-11.

| Catalog | On Analyze? |
|---|---|
| `food_items` / aliases / dish_cache | **No** |
| `brand_menu_items` | **Yes, rung 2** |
| Live FDC / `searchUSDA` | **No — F-12 removes the leftover hooks** |

---

### A.1 Target (one librarian, brand only)

```text
Log Meal  — never waits on curator
  Meal Agent → finalize (OCR → brand HIT/MULTI/MISS → estimates)
  → Layer 1 TS clean (unofficial / exact dups) — always eligible, throttled
  → Layer 2 curator LLM — only if A.2.1 says yes
```

**One agent.** Today the same function is logged as `food_resolver`, debug `t1/resolver`, UI “Food Resolver”, comments “Curator”. Collapse to:

| Surface | Token |
|---|---|
| Wire / dispatch | `curator` (`t1/curator`, `agent: 'curator'`) |
| Log type | `curator_answer` / `curator_instruction` |
| UI | Curator |
| History | dual-accept `food_resolver` / `resolver` |

Not the Meal Agent. Different trigger, different schema (catalog actions, no dishes, no kcal). Do not invent a second “brand resolver” persona.

**Do not invoke the LLM** except as **A.2.1**. Unofficial clones are TypeScript (Layer 1), not the curator.

---

### A.2 Brand catalog self-clean (how it works)

The meal never waits. Clean is **after** `matchBrandMenu` (or admin). No USDA. No `food_items`.

**Code fact (do not ignore):** `matchBrandMenu` returns **HIT** if any candidate is an exact `normalizeDishKey` match **even when other rows exist**. MULTI is only “no exact key, and top score is not ≥2× second.” Same-key clones (`Big Mac` / `Big Mac®` → `big_mac`) are **Layer 1**, not the LLM. The LLM is for leftovers Layer 1 cannot collapse.

```text
matchBrandMenu(chain, dish)  →  HIT | MULTI | MISS | SKIPPED
finalize continues (MULTI does not lock brand kcal — already `matched: false`)
enqueueBrandClean({ chainKey, country, dishNameKey, bindStatus, usedRowId, candidateIds })
  Layer 1 TS  — this chain+country (throttle per chain, not global GB)
  Layer 2 LLM — only if A.2.1 says yes
```

**Layer 1 TypeScript** (default). Throttle: **per `chain_key` + `country_code`**, not one global 1h for the whole table (today’s `SELF_CLEAN_THROTTLE_MS` is global — F-11.1 changes that). Admin “Clean now” bypasses throttle.

1. Quarantine unofficial / composite titles (`isUnofficialOrCompositeDish`) — **soft** (`status=quarantined`), not hard delete, so a bad rule is reversible.
2. Same `chain+country+normalizeDishKey` → keep **one** row. Winner: `provenance=official` > `ocr` > `user` > unknown; then `capture_count`; then newest. Never keep unofficial over official.
3. Quarantine empty / 0-kcal / missing `chain_key`.
4. Rewrite `dish_name_key` via `normalizeDishKey` if stale.
5. **Do not** quarantine `usedRowId` from this meal’s HIT.

Country = profile/meal country (ID and GB both exist in this diary). Do not hardcode `'GB'`.

KPI: next Analyze for that chain+dish is HIT or honest MISS — never a pile of exact-key clones.

#### A.2.1 When the brand curator (LLM) is called

**Clock:** after finalize has kcal; job may return. Same `jobId`, async. This meal’s numbers do not change.

Layer 1 may run on compare / OCR / HIT. **The LLM does not.**

**All of G0–G4, then one of T1–T3.** Else do not call Gemini.

| Gate | Must be true | If false |
|---|---|---|
| **G0 Mode** | Create or identity-changing edit | Skip **LLM**. Layer 1 may still run |
| **G1 Brand attempt** | `matchBrandMenu` ran (HIT, MULTI, or MISS) | SKIPPED → skip **LLM**. Layer 1 may still run for that chain if a chainKey exists |
| **G2 Layer 1 first** | TS cleaner finished for this `chainKey+country` | Run Layer 1; no LLM yet |
| **G3 Still dirty** | After Layer 1: MULTI leftover, near-dup cluster, or basis conflict | Stop |
| **G4 Dedup** | No in-flight curator job and no success for this `chainKey+dish_name_key` in 24h | Skip LLM |

| Trigger | Meaning | LLM does |
|---|---|---|
| **T1 MULTI** | Bind was MULTI **or** HIT/MISS with ≥2 live non-quarantined rows still matching this query after Layer 1 | `pick_existing` or `merge_duplicates` |
| **T2 NEAR_DUP** | Same chain, **token Jaccard ≥ 0.85**, **kcal within 10%**, neither name is a strict superset with `meal`/`combo`/`large`/`share` (do not merge Big Mac vs Big Mac Meal) | `merge_duplicates` |
| **T3 BASIS_AMBIGUOUS** | Surviving rows disagree per_dish vs per_100g vs per_serving | `normalize_basis` |

**LLM actions are proposals.** TypeScript rejects a merge if kcal differs by >15% at the same basis, or if the loser is `provenance=official` and the winner is not. Quarantine only; no hard delete from Gemini.

**Never call the LLM when:** HIT with a single live row; MISS (do not invent a SKU); SKIPPED; OCR rung-1 lock (LLM not required; Layer 1 ok); unofficial/0-kcal (Layer 1); Q&A / weight-only; USDA/FDC.

**Batch:** one call, cap 12 cases, T1 then T3 then T2. Schema = brand actions only. No `chosenFdcId`.

**Admin:** “Clean brand catalog” = Layer 1 now. “Curate leftovers” = A.2.1 on the MULTI/NEAR_DUP/BASIS queue (no meal).

**Examples**

| Logged | Table | Bind | LLM? |
|---|---|---|---|
| McDonald’s **Big Mac**, no OCR | `Big Mac` 550 and `Big Mac®` 540. `normalizeDishKey` → both `big_mac` | **HIT** on exact key (code today) | **No.** Layer 1 merges same-key clones. Next meal HIT. |
| McDonald’s **Big Mac** | `Big Mac` vs `Big Mac Meal` (combo, +800 kcal) | MULTI or two keys | **No T2** (superset `meal`, kcal >10%). Leave both. |
| McDonald’s **Big Mac** | `Big Mac` vs `Big Mac sandwich` (same kcal, Jaccard ≥ 0.85) | leftover after Layer 1 | **Yes T2.** Merge. This meal already saved. |
| Tesco oats | one row per_100g 389, one per_pack tagged per_dish 156 | T3 | **Yes.** `normalize_basis`. |
| Nasi goreng, no chain | — | SKIPPED | **No.** Meal Agent. |
| Quaker oats, carton in frame | maybe a brand row | OCR lock | **No** LLM. Layer 1 may still quarantine junk oats rows. |
| McDonald’s Secret Menu xyz | zero rows | MISS | **No.** Do not invent. |
| “Make it 200 g” | — | weight-only | **No** LLM. |
| Homemade “McD style” | `provenance=user_prompt` | — | **No** LLM. Layer 1 quarantines. |

| Action | Who | Brand meaning |
|---|---|---|
| quarantine unofficial | TS | homemade/decomposed/0-kcal |
| merge same `dish_name_key` | TS | one row per chain+dish key |
| merge spelling variants | LLM if T2 | Jaccard + kcal gate; TS validates |
| normalize_basis | LLM if T3 | per_dish vs per_100g |
| pick_existing | LLM if T1 | this query is `brand_menu_<id>` |

**Do not** invent meal nutrients. **Do not** call FDC. **Do not** dual-write `food_items`. **Do not** hard-delete from Gemini.

#### A.2.2 What can go wrong (and the lock)

| Risk | What happens | Lock |
|---|---|---|
| Bind HIT while clones remain | LLM never sees MULTI; junk stays | Layer 1 always scans the chain after HIT/MULTI/MISS; same-key merge is TS |
| Global 1h throttle | 20 meals in an hour, only first chain cleaned | Throttle **per chain+country** |
| Merge Big Mac × Big Mac Meal | Combo destroyed | T2: Jaccard ≥ 0.85, kcal ±10%, no `meal`/`combo`/`large` superset |
| Merge official into user junk | Official SKU gone | Winner provenance official > ocr > user; TS rejects LLM if loser is official and winner is not |
| Gemini hard-deletes | Irreversible | Quarantine only; admin restore |
| Hardcoded `country_code=GB` | Indonesian Indomaret/Quaker rows never cleaned | Use meal/profile country |
| Curator writes kcal onto this meal | Second calorie book | Writes catalog only; `usedRowId` frozen for this job |
| LLM merge 550 vs 900 kcal | Wrong SKU | TS rejects if kcal differs >15% at same basis |
| In-flight overlap | Two curator jobs on one key | G4 + one writer per `chainKey+dish_name_key` |
| Compare skipped entirely | Shelf packs never cleaned | G0 skips **LLM** only; Layer 1 may run |
| MISS → curator invents a dish | False brand lock next time | MISS never calls LLM |
| Layer 1 too aggressive unofficial regex | Real SKU quarantined | Soft quarantine; official provenance immune |

---

### A.3 Remove USDA (F-12) — not parked, delete

Audit (50 meals, production ranker): loose overwrite injected false friends (tofu→mayo, coconut water→coconut milk). Strict head-lock avoided those but kcal moved ~0–20 per honest dish; current scout already writes ~20–23 of the 32 nutrient keys. Live FDC is not needed.

**Delete from Analyze (one ID, named sensors that the pipeline does not call these):**

| Code | Why |
|---|---|
| `searchUSDA` / `fetchUSDAFoodById` / `searchUSDAFood` / `searchUSDAWithTwoRounds` in `server.ts` | Live FDC HTTP |
| `collectFdcHintTasks` / `isFdcHintRelevant` / `verifiedFdcHintMap` | leftover hint fetch on default path |
| `runDatabaseSearchStage` USDA/OFF fan-out when used to inject meal macros | legacy flag path |
| `server_fdc_resolve.ts` as Analyze resolver | HIT_UNIQUE auto-alias to FDC ids |
| `executeFoodResolverCurator` parametric FDC / `searchUSDAFn` | curator must not look up FDC |
| `extractUSDANutrientsPer100g` call sites on Analyze | keep helper only if a test still needs a fixture; otherwise delete with callers |
| `getCachedUSDAFood` / `setCachedUSDAFood` | cache of the API |
| `dbSource: 'usda'` writes | historical rows stay; do not emit new |
| `suggestedFdcId` on scout schema/merge | stop emitting FDC ids |

**Keep (not USDA-the-API):** `lookupCanonicalBaseFood` / `CANONICAL_BASE_FOODS` as a **frozen local table** for ghost 0-macro components. Strip `fdcId` fields from that table in the same ID so nothing can fetch. No HTTP.

**Do not keep** F-1/F-2 as “reopen later.” They are **abandoned**.

Food catalog tables may remain in DB for history/admin. They are not a meal-path reader.

---

### A.4 Invariants

- `finalizeDishLedger` is the only kcal writer. Curator does not emit calories onto the meal.
- Brand HIT still wins over Meal Agent estimates (rung 2).
- Brand MULTI/MISS stays honest (`BIND_MISS`). Clean may fix the **next** meal; it does not paint this one.
- One writer per brand row (Rule 5).
- Analyze never calls `searchUSDA` / `fetchUSDAFoodById` / `collectFdcHintTasks` (single-path negative).
- M30 assert retargets to brand cleaner files with a confirmed before→after. Do not silently delete `assert-food-curator-m30.mjs`.
- `docs/agent/domains/food-calc.md` truth hierarchy drops “USDA Atomics as last-resort”; Database Curator paragraph becomes brand-only. Same change as F-12 / F-11 (protected — confirmation).

---

### A.6 Review recap (2026-09-13)

**Journey after F-12 + F-11**

```text
Meal Agent (P/C/F) → finalize
  OCR → brand HIT (lock) / MULTI (honest, no lock) / MISS / SKIPPED
  → Meal Agent estimates + Atwater
  → return job
  → Layer 1 TS clean (per chain+country)
  → Layer 2 curator LLM only if A.2.1
```

No live USDA. No food_items on Analyze. Local staple table for empty ghost components only (no `fdcId`).

**Execute (wait for go):** **F-12** delete FDC hooks → **F-11.1** TS cleaner actually runs → **F-11.2** LLM behind A.2.1 → **F-11.3** one name `curator`. Current work stays B0 until the human says go.

**Why USDA is gone:** 50-meal audit. Loose FDC overwrite was net-negative (tofu→mayo, coconut water→coconut milk). Strict match avoided disasters but only moved ~0–20 kcal; current scout already writes ~20–23 nutrient keys. Not worth a process.

**Why the curator is rare:** most brand mess is same-key clones or unofficial titles — TypeScript. Gemini only for leftover MULTI / spelling near-dup / basis fight, after TS, after Save.

**Open confirmation at lock:** `food-calc.md` rung 3 + Database Curator (protected). Soft-quarantine column if `status` is not already on `brand_menu_items` (check schema in F-11.1; if missing, add in that ID, not a sixth table).

---

### A.5 Historical M30 (food_items + USDA hot path) — do not execute

The 2026-08-12 text below is the **old** Analyze resolver (query set → FDC → curator → inject nutrients). Do not execute. **F-12** removes the leftover hooks; **F-11** is brand self-clean only.

**Status (historical):** Proposed architecture (implementation-ready)  
**Date:** 2026-08-12  
**Related:** `server_food_catalog.ts`, `server_fdc_resolve.ts`, `executeFoodResolverCurator`  
**Evidence job:** `debug-job_1786486910960_lj1iw1c3k`

---

## 1. Goal

Transition food identity resolution from an expensive, noisy, low-curation pipeline into:

1. **Fast deterministic path** for clean atomic base ingredients (filtered USDA/FDC + local aliases).
2. **Strong Food Resolver curator** when identity is ambiguous, multi-matched, cross-source, international, or catalog-dirty — **one LLM iteration**, high-power actions.
3. **Self-healing catalog** so Resolver designs itself out of the hot path: every good decision writes aliases / merges / normalizes basis so the next meal hits local DB.
4. **Preserve meal truth hierarchy:** OCR / brand printed nutrients remain hard locks; atomic foundation fills missing macros/micros; scout soft kcal only when no brand/OCR kcal.

**Non-goals**

- Replace budget → foundation → reconcile (keep it).
- Remove Food Resolver.
- Fork a parallel `basic_foods` schema (extend `food_items` / `dish_cache` / `food_aliases`).
- Claim sub-second end-to-end while Vision Scout still runs (claim **resolver+DB** warm-path latency + reduced LLM gap calls).

---

## 2. Product principles

| # | Principle |
|---|-----------|
| P1 | **OCR / brand truth wins** for keys that are printed or official menu. Scout `estimatedCalories` is **void** when brand/OCR kcal exists. |
| P2 | **Atomic foundation** builds shape (macros/micros) from base ingredients + sauces. Multi-component dishes search **components only**, not parent dish titles. |
| P3 | **Resolver is the catalog curator**, not a calorie estimator: pick identity, route brand vs generic, dedupe, normalize portion basis, reject garbage, write aliases. |
| P4 | **Self-heal is primary KPI:** after a successful resolve, the same query must not need Resolver again. |
| P5 | **One scale, no double fat:** hard_lock scale once; prep oil XOR component fat; never brand total + dishCore + full component sum as three competing truths. |
| P6 | **Scout queries are clinical English** (inverted USDA taxonomy); brand/local names stay in `originalName` / brand fields. |
| P7 | **Right row, right table:** brand product → brand-scoped food_item or brand_menu linkage; generic commodity → generic food_item; composed dish memory → dish_cache only when no safe atomic decomposition. |

---

## 3. Target end-to-end flow

```text
[User image + text]
        │
        ▼
[Meal Agent — create dispatch]
  - items + components (clinical searchQuery, mass% preferred)
  - originalName / chainName / rawNutritionLabel (printed only)
  - P/C/F per food; no persisted kcal
  - TS expand → workers on remaining dishes with locked OCR grams
  - soft estimatedCalories per item (ignored if brand/OCR kcal; finalize owns kcal)
        │
        ▼
[Query set builder]  ← NEW pure helper
  - unique atomics only (normalize + synonym collapse)
  - + brand/chain dish query only if chainName or brand identity
  - + single-component dishes (croissant = one atomic)
  - NEVER parent multi-component titles / "…ingredients" paraphrases
        │
        ▼
[Deterministic resolve each query]
  1. food_aliases / food_items / CANONICAL_BASE_FOODS / brand aliases
  2. Brand menu / OFF only if brand/barcode class
  3. Filtered FDC: Foundation | SR Legacy | Survey(FNDDS)
       top-N → matching_engine form/token filters → reject 0-kcal / Atwater fail
  4. Classify outcome:
       HIT_UNIQUE | MULTI_MATCH | MISS | INVALID_CANDIDATES | NEAR_DUP_CLUSTER
        │
        ├── HIT_UNIQUE → use nutrients; gated alias write (no LLM)
        │
        └── else → collect CuratorCase pack
        │
        ▼
[Food Resolver Curator — 1 iteration, batch of cases]
  Actions: pick_existing | create_from_external | merge_duplicates |
           alias_only | normalize_basis | quarantine | reformulate_pick |
           no_safe_match
  Server executes writes deterministically
        │
        ▼
[Assembly]
  foundation = Σ component mass × per_100g
  budget = OCR/brand hard > dish_cache > scout soft > category
  reconcile (single scale) + prep XOR oil components
        │
        ▼
[Self-heal metrics + observations]
```

---

## 4. Truth hierarchy (meal finalize — unchanged product rule)

Per **dish item** (not per component):

| Priority | Source | Effect |
|----------|--------|--------|
| 1 | Printed OCR / `rawNutritionLabel` keys | Hard lock (scaled by serving size if applicable) |
| 2 | Official brand menu match (`matchBrandMenu`) | Hard lock official basis nutrients; scaled by $R = \text{consumedWeight} / \text{nutrientBasisWeight}$ |
| 3 | Scout per-dish direct core nutrients (including carbs) | Dish estimate ledger for unlocked keys |
| Overlay | Atomic dictionary match (alias \| unique food_items \| FDC HIT_UNIQUE) | Populates unlocked macros & micros $\times \text{consumedWeight}/100$ |
| Derive | Pure TypeScript derivations (`server_derivation.ts`) | Unsaturated fat, salt from sodium, carbohydrate energy fallback |
| Prohibited | Category $\times$ weight, foundation $\Sigma$, resolver MISS fill, reality-check rescale | Never used to construct or mutate meal nutrients |

**Yolk burger with brand menu entry**

- `matchBrandMenu` locks official brand basis nutrients at 350g basis (760 kcal).
- Scout estimates 350g portion $\rightarrow$ single scaler $R = 350/350 = 1.0 \rightarrow 760$ kcal.
- In portion edits (e.g. 175g), single scaler $R = 175/350 = 0.5 \rightarrow 380$ kcal directly without re-querying or clamping.
- Dietitian coaches on the exact finalized ledger.

**Double-count bans**

| Ban | Rule |
|-----|------|
| Brand total as component row + budget | Brand is budget/truth only unless single-item brand product with no components |
| dishCore + multi-component assembly | Skip dishCore when `components.length >= 2` |
| Prep policy + oil/sauce components | XOR: if fat-bearing components present, `decidePrepAddition = 0` |
| Soft scout + hard brand | Soft voided when hard exists |
| Two scales | At most one reconcile scale factor per item |

---

## 5. Query hygiene (P0 — fixes current job fan-out)

### 5.1 Build unique query list

From Scout items:

```text
for each item:
  if components.length >= 2:
    emit each component.searchQuery (clinical)
    if chainName or brand product identity: emit brand dish query ONCE for budget lookup only
    do NOT emit item.keyword / originalName / queriesToSearch parent strings for USDA atomics
  else:
    emit clinical query for the single food (keyword or component[0])
```

Normalize:

- lower/trim, synonym map (`garlic mayo` → `mayonnaise` for catalog key if appropriate; keep brand if present)
- inverted clinical form where Scout failed to invert
- case-collapse (`Vegetarian wrap` vs `vegetarian wrap`)

### 5.2 Target for job `lj1iw1c3k`

| Today | Target |
|-------|--------|
| 22 searches (parents + ingredients + dups) | ≤ 13 unique atomics |
| 15 resolver gaps (cap 8) | 0 resolver if FDC/catalog clear; else ≤ 3 true curator cases |
| 67 raw DB matches noise | Ranked top-N per atomic only |

### 5.3 Scout prompt additions

1. **USDA Query Inversion:** `Noun, Descriptor, Preparation` (e.g. `Egg, whole, cooked, hard-boiled`).
2. **Clinical English only** for `searchQuery` / component queries.
3. **Brand fields separate:** `originalName` / `chainName` / optional `brandToken`; do not only mash brand into FDC string unless brand path.
4. **Preparation fat:** for deep-fried / heavy glaze, include oil/butter component with % (mass preferred).
5. Prefer **massPercentage** (or weightGrams) over pure volume%; if volume only, server applies density table later (P2).

---

## 6. Deterministic FDC / catalog path

### 6.1 Atomic search class vs brand class

| Class | When | Sources |
|-------|------|---------|
| **Atomic** | No brand/barcode context | FDC: `Foundation`, `SR Legacy`, `Survey (FNDDS)` only |
| **Brand product** | chainName, known brand token, barcode, explicit retail brand in query | Brand menu, OFF, FDC Branded (with quality gates) |
| **Hybrid** | “Sainsbury rolled oats” | Internal multi-hit + OFF brand + FDC commodity → **Resolver** if not unique |

### 6.2 Candidate ranking (no `foods[0]`)

Reuse `server_matching_engine.ts`:

1. Fetch top 10–25.
2. Drop kcal==0 (except whitelist: water, diet drinks).
3. Atwater validity on macros when present.
4. Form/token coverage + modifier inversion (bar vs bowl, dried vs cooked).
5. If exactly one survivor above score τ → **HIT_UNIQUE**.
6. If 2+ survivors → **MULTI_MATCH** (curator).
7. If zero → **MISS** (curator may reformulate once via server pre-search).

### 6.3 Gated write on deterministic HIT (no LLM)

Still write alias when:

- kcal > 0 (or whitelist)
- Atwater OK
- form-safe
- status starts as `candidate` if confidence medium; `active` if high + known canonical

Never write parent dish string → single component.

---

## 7. Food Resolver as curator (core of this plan)

### 7.1 Mission

Resolver is the **problem-solver and librarian**:

- Choose the correct **food_item** or **brand** entity among many partial matches (internal + USDA + OFF).
- Decide **reuse vs create**.
- **Merge / retire duplicates** and near-duplicates.
- Route **brand product vs generic commodity** into the correct catalog row and alias graph.
- **Normalize portion basis** (per 100g / per pack / per serving / portion+total weight country formats).
- **Quarantine** malformed or improbable entries so they never poison self-heal.
- Leave the catalog better so **next time Resolver is not needed**.

### 7.2 When to invoke (trigger router)

Invoke Resolver **only** if any query yields:

| Trigger | Example |
|---------|---------|
| `MULTI_MATCH` | Multiple Sainsbury rolled oats rows + OFF variants |
| `NEAR_DUP_CLUSTER` | Same fdc_id or high name sim + Atwater-close pair |
| `CROSS_SOURCE_CONFLICT` | Internal generic oats vs brand-specific OFF |
| `MISS` after filtered FDC | Regional food, odd clinical string |
| `INVALID_CANDIDATES` | All 0-kcal / wrong form (e.g. tuna salad for greens) |
| `BASIS_AMBIGUOUS` | Nutrients look like per-pack or per-portion but tagged per_100g (or reverse) |
| `IMPLAUSIBLE_ROW` | Existing catalog row 10k kcal/100g, 10kg “serving” |

**Do not invoke** for unambiguous atomic HIT_UNIQUE (target for the debug job’s basic components).

Batch all curator cases into **one** LLM call (1 iteration). Soft cap e.g. 12 cases; prioritize MULTI_MATCH and BASIS_AMBIGUOUS over low-value misses.

### 7.3 Input pack schema (server-built)

```ts
type CuratorCase = {
  query: string;                    // user/scout raw
  clinicalQuery: string;            // inverted English
  brandToken?: string | null;
  chainKey?: string | null;
  countryHint?: string | null;      // GB, ID, US…
  formHints: string[];              // cooked, loose, bar, liquid…
  context: 'atomic_component' | 'brand_product' | 'single_item_dish';

  internalCandidates: Array<{
    food_id: string;
    food_key: string;
    display_name: string;
    status: string;
    nutrients_per_100g: Record<string, number>;
    basis_meta?: BasisMeta;
    fdc_id?: string;
    provenance?: string;
    similarity: number;
  }>;

  externalCandidates: Array<{
    id: string;
    source: 'usda' | 'off' | 'brand_menu' | 'web';
    name: string;
    dataType?: string;
    nutrients: Record<string, number>; // as reported
    basis_raw?: BasisMeta;             // detected before LLM
    kcal: number | null;
  }>;

  nearDuplicates?: Array<{ a: string; b: string; reason: string }>;

  /** Existing row that may need basis fix or quarantine */
  suspectRows?: Array<{ food_id: string; issues: string[] }>;
};

type BasisMeta = {
  basisType: 'per_100g' | 'per_serving' | 'per_pack' | 'per_dish' | 'total' | 'unknown';
  servingGrams: number | null;
  packGrams?: number | null;
  portionsPerPack?: number | null;
  rawServingText?: string | null;
};
```

### 7.4 Output action schema (LLM)

```ts
type CuratorResolution = {
  query: string;
  action:
    | 'pick_existing'
    | 'create_from_external'
    | 'merge_duplicates'
    | 'alias_only'
    | 'normalize_basis'
    | 'quarantine'
    | 'reformulate_pick'   // server already ran reformulated search; pick from expanded list
    | 'no_safe_match';

  chosenFoodId?: string | null;
  chosenExternalId?: string | null;
  catalogTarget: 'generic_food_item' | 'brand_food_item' | 'dish_cache' | 'none';

  aliasesToWrite: string[];         // all normalized keys that should hit this entity next time

  merge?: { winnerId: string; loserIds: string[] };

  create?: {
    display_name: string;
    nutrients_per_100g: Record<string, number>; // MUST be per 100g after normalize
    form_tags: string[];
    provenance: string;
    brand_key?: string | null;
    fdc_id?: string | null;
  };

  basisCorrection?: {
    food_id: string;
    from: BasisMeta;
    to: BasisMeta;
    nutrients_per_100g: Record<string, number>; // rewritten
    reason: string;
  };

  quarantine?: {
    food_ids: string[];
    reason: string;
  };

  rejectExternalIds?: string[];
  confidence: 'high' | 'medium' | 'low';
  reason: string; // one line for logs
};
```

### 7.5 Server execution after LLM (deterministic)

| Action | Server work |
|--------|-------------|
| `pick_existing` | Use nutrients; `upsertFoodAlias` for all aliases; bump `capture_count` / `hit_count` |
| `create_from_external` | Validate gates → `upsertFoodItemCandidate` with correct brand/generic flags → aliases |
| `merge_duplicates` | `mergeFoodCatalogItems` winner/losers; redirect all loser aliases; status `merged` |
| `alias_only` | Aliases only; no new row |
| `normalize_basis` | Rewrite `nutrients_per_100g` + store basis meta; version++ |
| `quarantine` | status `quarantine`; remove from active resolve path; observation event |
| `reformulate_pick` | Same as pick/create from expanded candidates only |
| `no_safe_match` | Category floor for **this meal only**; observation; **no active alias** |

**Allowlist rule retained:** chosen external IDs must appear in the case pack (or reformulated expansion). Forged IDs discarded (existing test).

---

## 8. Catalog routing (right food → right database)

### 8.1 Entity types

| Entity | Table / store | When |
|--------|---------------|------|
| Generic commodity | `food_items` (`provenance` usda/canonical, no brand_key) | Egg, chicken breast, wheat tortilla |
| Brand product | `food_items` with `brand_key` + optional barcode **or** brand_menu id linkage | Sainsbury rolled oats, Co-op yogurt pot |
| Brand dish (restaurant) | Brand menu tables + `dish_aliases` / food_aliases → brand id | Yolk sandwich official kcal |
| Composed dish memory | `dish_cache` | Only when no reliable multi-component decomposition and we store dish-level core |
| Alias graph | `food_aliases` / `dish_aliases` | All successful identities |

**Extend schema (migration)** — prefer columns on existing tables:

```sql
-- food_items additions
ALTER TABLE public.food_items
  ADD COLUMN IF NOT EXISTS brand_key text NULL,
  ADD COLUMN IF NOT EXISTS barcode text NULL,
  ADD COLUMN IF NOT EXISTS basis_type text NOT NULL DEFAULT 'per_100g',
  ADD COLUMN IF NOT EXISTS serving_grams real NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS pack_grams real NULL,
  ADD COLUMN IF NOT EXISTS portions_per_pack real NULL,
  ADD COLUMN IF NOT EXISTS country text NULL,
  ADD COLUMN IF NOT EXISTS entity_kind text NOT NULL DEFAULT 'generic', -- generic | brand_product
  ADD COLUMN IF NOT EXISTS quality_flags text[] DEFAULT '{}';

-- food_aliases additions
ALTER TABLE public.food_aliases
  ADD COLUMN IF NOT EXISTS hit_count int NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS last_accessed_at timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS source text NULL, -- already exists; use: resolver|deterministic|brand|admin
  ADD COLUMN IF NOT EXISTS confidence real DEFAULT 0.8;

CREATE INDEX IF NOT EXISTS idx_food_items_brand_key ON public.food_items(brand_key);
CREATE INDEX IF NOT EXISTS idx_food_items_entity_kind ON public.food_items(entity_kind);
CREATE INDEX IF NOT EXISTS idx_food_aliases_food_id ON public.food_aliases(food_id);
```

Brand menu rows remain source of truth for chain dishes; aliases may point `alias_key` → `brand_menu:<id>` virtual food_id convention **or** mirrored food_item with `provenance=brand_menu`.

### 8.2 Routing rules for Resolver

| Signal | catalogTarget |
|--------|----------------|
| chainName / brand menu official | brand path (hard truth for meal) + alias |
| Retail brand in query + OFF barcode product | `brand_food_item` |
| Commodity clinical query only | `generic_food_item` |
| Multi-component parent without brand | do not create dish_cache if components resolved |
| Ambiguous “granola” without brand context | **generic** or reject brand_menu false-positive (Co-op pot) |

**Brand false-positive guard (server, pre-LLM):**

- Brand menu substring match on ultra-generic tokens (`granola`, `mayonnaise`, `chicken`, `salad`) requires **chain context** or high product-name token overlap.
- Log: `[BrandGuard] rejected generic token brand hit`.

---

## 9. Portion / basis curator (normalize to per_100g)

Canonical storage for `food_items.nutrients_per_100g` is **always per 100g** after curator/normalize. Meal assembly always uses per_100g × grams.

### 9.1 Country / label patterns to support

| Pattern | Regions | Detection | Normalize |
|---------|---------|-----------|-----------|
| Per 100g column | UK/EU, many packs | “per 100g”, “per 100 ml” | store as-is |
| Per serving + serving grams | US, UK | “per serving” + “30g” | `n * (100/serving_g)` |
| Per pack / whole pack | retail | “per pack”, “per pot” + pack weight | `n * (100/pack_g)` |
| Portion count + total pack weight (no per 100g) | **Indonesia common**, some SEA | “isi 4” / 4 portions + “netto 400g” + nutrients per portion | `portion_g = pack_g/portions`; then to per_100g |
| Per dish total (restaurant) | chains | brand menu whole item | meal basisType `total`/`per_dish` — **do not** write as food_items per_100g without weight; keep brand_menu / dish basis |
| kJ only | EU/AU | energy kJ | convert kcal = kJ/4.184 |

Reuse and extend `server_nutrient_basis.ts` (`NutrientBasisType`, detect/convert helpers).

### 9.2 Pure helper: `normalizeToPer100g`

```ts
function normalizeToPer100g(input: {
  nutrients: Record<string, number>;
  basis: BasisMeta;
}): { ok: true; nutrients_per_100g: Record<string, number>; basis: BasisMeta }
  | { ok: false; reason: string }
```

Rules:

- If `basisType === 'per_100g'` and values already density-like → pass through + plausibility check.
- If per_serving/per_pack/total with known grams → scale to 100g.
- If portions_per_pack + pack_grams → derive portion grams → scale.
- If grams unknown → `ok: false` → Resolver case `BASIS_AMBIGUOUS` or quarantine; **do not invent weight**.

### 9.3 Resolver basisCorrection

When deterministic detection is unsure but text + numbers allow a human-like read:

- LLM proposes `basisCorrection` with from/to + rewritten per_100g.
- Server **recomputes** scale itself from from/to grams (do not trust LLM arithmetic blindly); LLM only chooses interpretation of serving text.

---

## 10. Plausibility & quarantine (malformed data)

### 10.1 Hard reject / quarantine thresholds (server)

| Check | Threshold (defaults; tune in one config object) | Action |
|-------|--------------------------------------------------|--------|
| kcal per 100g | > 950 (above pure fat ~900) or < 0 | reject/quarantine |
| kcal absolute “serving” | > 4000 without multi-serve evidence | reject as meal total mis-tagged |
| serving_grams / pack_grams | > 5000g (e.g. 10kg lasagna as one serving) | quarantine |
| serving_grams | < 1g for solid food | quarantine |
| protein/carbs/fat g per 100g | any > 100 (or fat > 100) | quarantine |
| Atwater vs stated kcal | deviation > 35% (existing helper) | reject promote; optional rescale only for labels with hard printed kcal |
| sodium mg per 100g | > 20000 absurd | quarantine |
| 0 kcal + non-zero macros | inconsistent | reject |
| 0 kcal + zero macros on “food” | reject unless whitelist beverage water | |

Examples from product intent: **10k calorie item**, **10kg lasagna serving** → quarantine, not alias.

### 10.2 Status lifecycle

```text
candidate ──promote──► active
    │                    │
    │                    ├──merge──► merged (parent_id = winner)
    │                    │
    └──fail gates──► quarantine
```

Resolve path uses: `active` + high-quality `candidate` (existing confidence ≥ 0.65 + Atwater). Never `quarantine` / `merged`.

### 10.3 Background hygiene (optional P3)

- Periodic `quarantineAtwaterFailures` (exists) + new `scanImplausibleFoodItems`.
- Resolver can be run offline on `food_observations` deferred gaps (not in request path).

---

## 11. Self-healing alias policy

### 11.1 Always alias on success

Write **multiple** alias keys when safe:

- raw scout query
- clinical query
- brand+product variants
- common synonyms resolved this session

Include **brand products** (user request): e.g. `yolk_steak_chimi`, `coop_blueberry_granola_yogurt_pot`.

### 11.2 Never alias

- Parent multi-component dish → one component
- Quarantined / rejected externals
- `no_safe_match` category floor
- Generic token → random brand menu hit

### 11.3 Hit tracking

On alias hit: `hit_count++`, `last_accessed_at=now()`. Promote `candidate` → `active` when `hit_count >= N` (e.g. 3) and still gate-pass.

---

## 12. Prep fat XOR (anti double-count)

| Condition | Prep policy |
|-----------|-------------|
| Components include oil/butter/mayo/dressing with % > 0 | `decidePrepAddition` reason `fat_in_components` → 0 |
| Composite dish, no fat components, method fried | existing calculated prep OK |
| User explicit “fried in oil” | existing user-explicit path |
| Whole raw produce | 0 (existing) |

---

## 13. Module / file plan

| Module | Responsibility |
|--------|----------------|
| `server_query_set.ts` (new) | Build unique atomic + brand queries from scout; pure + tests |
| `server_clinical_query.ts` (new) | Light normalization / inversion helpers (not full LLM) |
| `server_fdc_resolve.ts` (new or extract) | Filtered search, rank, HIT/MULTI/MISS classification |
| `server_catalog_gates.ts` (new) | Plausibility, Atwater wrap, 0-kcal reject, promote rules |
| `server_basis_normalize.ts` (extend `server_nutrient_basis.ts`) | Country patterns → per_100g |
| `server_food_resolver_curator.ts` (new) | Build cases, prompt, parse actions, execute writes |
| `server_food_catalog.ts` | Schema fields, alias hit_count, brand_key, merge hooks |
| `server_vision_scout.ts` / scout prompt | Clinical English, inversion, mass%, oil component |
| `server.ts` | Wire: query set → resolve → curator → assembly; thin |
| `agents/foodResolverInstructions.ts` | Curator system instruction + JSON schema |
| Migration `supabase/migrations/20260812_food_catalog_curator.sql` | Columns above |

**Do not** grow `server.ts` with curator business logic — extract.

---

## 14. Phased delivery

### Phase 0 — Query hygiene + 0-kcal reject (no schema)

**Work**

- `buildFoodSearchQuerySet(scoutItems)` components-only.
- Reject 0-kcal FDC before match / before persist.
- BrandGuard on generic tokens.
- Log `[QuerySet] n=…` and list.

**Exit criteria (job lj1iw1c3k)**

- Search count ≤ 14 unique atomics.
- No parent `chicken avocado salad bowl` in USDA atomic list.
- Tortilla candidate without kcal cannot be chosen or persisted.

**Tests**

- `server_query_set.test.ts` with fixture from scout JSON in that job.
- Gate strings in assert script optional.

### Phase 1 — Filtered FDC + ranking + scout clinical prompt

**Work**

- Atomic dataTypes include FNDDS; Branded only brand class.
- Rank-N + matching_engine; HIT_UNIQUE auto-alias (gated).
- Scout prompt: inversion + clinical English + oil component rule.

**Exit criteria**

- `boiled egg` → hard-boiled style entry, not dried yolk powder.
- `mixed salad greens` → leafy greens, not tuna salad.
- Resolver not called when all atomics HIT_UNIQUE.

### Phase 2 — Curator Resolver v1 (pick / merge / alias / create)

**Work**

- Trigger router MULTI_MATCH | MISS | INVALID.
- New action schema + `server_food_resolver_curator.ts`.
- Execute merge + multi-alias + create gates.
- Replace “gap title spam” path; keep 1 iteration.

**Exit criteria**

- Sainsbury multi-oats style fixture: one winner, losers merged, ≥2 aliases.
- Duplicate food_items count decreases on fixture DB.
- Forged chosenFdcId still discarded (existing test + action schema tests).

### Phase 3 — Basis normalize + brand routing + plausibility

**Work**

- Migration columns; `normalizeToPer100g` for ID/UK/US patterns.
- Resolver actions `normalize_basis` + `quarantine`.
- Brand vs generic `entity_kind` / `brand_key`.
- Implausible thresholds config + quarantine scan.

**Exit criteria**

- Per-portion + pack weight (ID-style) → correct per_100g within 5% of hand calc.
- 10k kcal / 10kg serving fixtures → quarantine, not active alias.
- Brand product aliases resolve without re-search.

### Phase 4 — Density / mass assembly + prep XOR polish

**Work**

- massPercentage or density table for volume%.
- Prep XOR integration tests.
- Metrics: resolver_call_rate, alias_hit_rate, quarantine_count.

**Exit criteria**

- Chicken salad style foundation not 2× scout soft budget from bad matches.
- Warm re-run same meal: alias hits ≥ 80% of atomics, resolver_cases = 0.

### Phase 5 — Hardening

**Work**

- Golden meal suite (20–50): label-only, brand partial, home atomic, fried oil, ID label, UK label, multi-photo.
- Domain rulebook update (`food-calc.md` Resolver role).
- Admin: list quarantine, force merge (optional UI).

---

## 15. Resolver system prompt (summary for `foodResolverInstructions.ts`)

Replace gap-only librarian text with curator mandate:

1. You curate the **internal nutrition database** and resolve identity conflicts.
2. Prefer **reuse + alias** over new rows; **merge** near-duplicates.
3. Route **brand products** vs **generic commodities** correctly.
4. All stored densities are **per 100g**; interpret country serving formats; propose basis interpretation, server will recompute.
5. Quarantine impossible values (extreme kcal, absurd weights).
6. Choose only from provided candidates; never invent IDs.
7. Output strict JSON actions; one line reason each.
8. Success = next identical query needs **no** Resolver.

---

## 16. Logging & observability

| Log tag | Meaning |
|---------|---------|
| `[QuerySet]` | Final unique queries |
| `[ResolveClass]` | HIT_UNIQUE / MULTI_MATCH / MISS per query |
| `[BrandGuard]` | Rejected generic brand false positive |
| `[CuratorCase]` | Case built for Resolver |
| `[CuratorAction]` | action + chosen ids + aliases |
| `[BasisNormalize]` | from → to + factor |
| `[CatalogQuarantine]` | food_id + reason |
| `[AliasHit]` / `[AliasWrite]` | self-heal path |
| `[PrepXOR]` | fat_in_components vs calculated prep |
| `[Budget]` / `[Foundation]` / `[Reconcile]` | unchanged meal math |

Catalog sync status already exposes resolver_call_count / deferred gaps — add `alias_hit_count`, `curator_merge_count`, `quarantine_count` if easy.

---

## 17. Testing plan

### Unit

| File | Coverage |
|------|----------|
| `server_query_set.test.ts` | job lj1 fixture → atomic-only list |
| `server_basis_normalize.test.ts` | per 100g, per serving, per pack, ID portion+netto |
| `server_catalog_gates.test.ts` | 0-kcal, 10k kcal, 10kg serving, Atwater |
| `server_food_resolver_curator.test.ts` | parse actions, allowlist, merge execution mocks |
| existing `server_food_resolver.test.ts` | keep forged ID + cap behavior (update cap semantics if needed) |
| `server_budget_reconcile.test.ts` | hard brand + foundation scale unchanged |

### Integration / golden

| Scenario | Expect |
|----------|--------|
| Granola+wrap+salad+croissant job | No parent gaps; tortilla has kcal; greens not tuna; protein salad not 124g from bad egg |
| Yolk kcal-only | hard lock kcal; components shape macros; scout soft void |
| Sainsbury oats multi | one active row; aliases; duplicates merged |
| ID label portion×pack | per_100g correct |
| Malformed catalog row | quarantine |

### Regression gates

Update `docs/agent/DOMAIN_REGRESSION_MAP.md` Food-calc section:

- QuerySet components-only for multi-component.
- Curator not meal calorie inventor.
- Brand/OCR hard lock still wins.
- Mode A/D/Edit same finalize.

---

## 18. Risks & mitigations

| Risk | Mitigation |
|------|------------|
| Resolver over-called again | Strict trigger router; HIT_UNIQUE never calls LLM |
| LLM bad merge | Server-only merge with bar/loose guard; require winner in candidate set |
| LLM bad arithmetic on basis | Server recomputes from grams; LLM only chooses interpretation |
| Schema drift | Single migration; no parallel basic_foods table |
| Brand pollution | BrandGuard + entity_kind |
| Latency regression | 1 curator call batched; fewer USDA queries overall |
| Double fat / double scale | PrepXOR + single reconcile (tests) |

---

## 19. Success metrics

| Metric | Baseline (job lj1) | Target |
|--------|--------------------|--------|
| Unique DB queries / meal | 22 | ≤ 14 atomics first pass; ≪10 after warm |
| Resolver LLM calls | 1 heavy (8+ deferred) | 0 on basic atomics; 1 only on true curator cases |
| Wrong form matches (greens/egg/tortilla) | present | 0 on golden set |
| 0-kcal persist | yes (2758996) | 0 |
| Alias hit rate on repeat meal | low | ≥ 80% |
| Near-duplicate active pairs | high growth | decreasing |
| Brand false-positive on mayo/granola | yes | 0 without chain context |

---

## 20. Documentation updates (with implementation)

When phases land (protected-doc confirmation per `AGENTS.md`):

1. `docs/agent/domains/food-calc.md` — Resolver role → **catalog curator**; pipeline diagram add QuerySet + Curator.
2. `plan/README.md` — index this plan (see below).
3. `AI_HANDOVER.md` — WIP checkboxes per phase.
4. `agents/foodResolverInstructions.ts` — curator prompt.

---

## 21. Implementation checklist (quick)

- [x] P0 `buildFoodSearchQuerySet` + tests + wire server.ts
- [x] P0 0-kcal reject + BrandGuard
- [x] P1 FNDDS + rank-N + scout clinical prompt
- [x] P1 HIT_UNIQUE gated alias write
- [x] P2 CuratorCase builder + action schema + execute layer
- [x] P2 merge_duplicates + multi-alias
- [x] P3 migration basis/brand columns
- [x] P3 normalizeToPer100g + normalize_basis action
- [x] P3 quarantine implausible
- [x] P4 prep XOR + density/mass
- [x] P5 golden suite + domain doc

---

## 22. One-line north star

**Deterministic resolve serves the meal; the Resolver curates identity, basis, and brand routing so the catalog self-heals and the Resolver is not needed next time — while OCR/brand remain meal truth.**

---

## 23. Remaining work (honest — 2026-09-01)

Architecture / M30 assert is **green**. F-8.1–F-8.9 calorie single-path is **green**. Pipeline pieces above are **not** to be rebuilt. Live USDA/FDC on Analyze is a **last-resort gap filler**, not a remaining workstream.

Execute leftover IDs on [ROADMAP.md](./ROADMAP.md) Track F only:

| ID | Status | Do not |
|---|---|---|
| F-1 / F-2 | **Parked.** Do not start a USDA or catalog-first project. Reopen only as a named identity-class soak | Rebuild curator; ban USDA |
| F-3 / F-4 | Open class playbooks / alias hygiene | `POST /loop`; silent merge |
| F-5 | **Done** | Re-apply `fix_food_analyze_typeerror.md` |
| F-8.10–F-8.13 | Open (split analyze owner, soak, packaged bind, debug vs sample) | Second kcal writer |
| F-9.1–F-9.4 | **Shipped** (flag-delete residual with F-9.5) | New inFlight flags |
| F-9.5 | Partial — App.tsx poller still `updateJob` | God-file rewrite |

**Execute:** one **class** at a time (`FALSE_FRIEND`, `DISH_DROP`, `OPENING_WRONG`, `SILENT_REPAIR`, `STALE_TURN`). Inner = vitest. Outer = one golden example.

P5 checkbox above means “suite exists,” not “all goldens green.”

---

## Part B — Durable meal document

**Pillar:** 2 — Food. Map: `plan/README.md`.

**Status:** Architecture (durable). Live WIP → `AI_HANDOVER.md`.  
**Execute leftover:** [ROADMAP.md](./ROADMAP.md) F-8 / F-10. M21 pack is archived.  
**Updated:** 2026-08-09 (OCC, masks, stageKey, limits, migrate, history/debug, **deletions, stale narrative, 409 rebase, R2 TTL, chaos resilience matrix §12**)  
**Goal:** One durable meal document that agents fill over time; fail-local; multi-device; full Mode A / D / Edit data coverage; append-only audit without log bloat; **survive messy real-world use cases**.

---

## 0. Problem → solution

| Today | Target |
|-------|--------|
| Job / SSE blob owns partial state; failure wipes meal | **Meal** owns product state; job only advances stages |
| Scout checkpoint only | Full progressive template + resume any empty stage |
| Huge redundant logs, missing decisions | **stageLedger** + **historyLog** (append) + cold R2 (raw) |
| Image / history lost on refresh or device change | Early R2 `imageUrls` on meal; server meal is truth |
| “Group” overloads composition vs Mode D | **Component** ≠ **FoodItem** ≠ **Meal** ≠ **ComparisonSet** |
| Client edit races server stage write | **OCC** `version` + CAS / rebase |
| Agents re-read full pipeline noise | **Stage input masks** (context subtraction) |
| Retry duplicates items | **Stage idempotency keys** on ledger deltas |
| Infinite re-prompt / cost runaway | **StageLimits** circuit breakers |
| Offline cache shape drift | **schemaVersion** + `migrateMealSchema` |
| Deleted item restored by stage merge | **`deletedItemIds` tombstones** |
| Advice text after weight change | **`staleDietitianNarrative`** |
| Client stuck on 409 | **Standard JobStore rebase loop** |
| R2 debug forever growth | **Cold package lifecycle 14–30d** |

---

## 1. Glossary (binding — do not overload)

| Term | Meaning | Example |
|------|---------|---------|
| **Component** | Part *inside* one dish line | Bun, patty, cheese |
| **FoodItem** | One line on a meal (atomic or composite) | “Yolk burger”, “fries” |
| **Meal** | One loggable plate: items + totals + media + content | Today’s lunch |
| **ComparisonSet** | Mode D only: set of **Meals** (options) | Option A vs B vs C |
| **Partial item** | Item with incomplete data but usable truth | Label-only 700 kcal burger, components missing |
| **Calculator** | Pure finalize (budget/reconcile/aggregate) | Fills 31-nutrient slots — not stored as rival state |
| **stageLedger** | Append-only audit decisions | Not a second nutrient dump |
| **Job** | Work order that advances meal stages | Does not own the meal long-term |

```text
ComparisonSet  (Mode D only)
  └── Meal[]                 ← each option is a full meal
        └── FoodItem[]
              └── Component[]  ← composition (NOT another meal)

Mode A / Edit:
Meal
  └── FoodItem[]
        └── Component[]
```

---

## 2. No-gap field inventory (existing → template)

**Law:** Building / consolidating a Meal **must not drop** any field below.  
Consolidation merges by **stable keys** (`itemId` / `scoutIndex`); later stages fill empty slots; **never wipe** non-empty provenance with null/undefined unless user edit explicitly clears.

### 2.1 Nutrients (31) — `src/utils/nutrients.ts` `NUTRIENT_KEYS`

`calories`, `protein`, `totalFat`, `saturatedFat`, `transFat`, `unsaturatedFat`, `omega3`,  
`carbohydrates`, `addedSugar`, `totalFibre`, `solubleFibre`, `sodium`, `potassium`,  
`magnesium`, `calcium`, `iron`, `zinc`, `selenium`, `iodine`, `phosphorus`,  
`vitaminD`, `vitaminB12`, `folate`, `vitaminC`, `vitaminE`, `vitaminK`,  
`vitaminA`, `vitaminB6`, `thiamine`, `riboflavin`, `niacin`

Present on: **meal totals** + **each FoodItem** (sparse until calculated).

### 2.2 Meal envelope (Mode A / Edit / each Mode D option)

| Field | Source today | Required on Meal |
|-------|----------------|------------------|
| `id` | FoodLog.id / jobId | yes (mealBuildId) |
| `schemaVersion` | **new** (start at `1`) | yes — required for cache migrate |
| `version` | **new** monotonic OCC counter | yes — CAS / rebase |
| `lastUpdatedBy` | **new** e.g. `user_edit` \| `job_stage_resolver` | yes |
| `lastUserAction` | **new** slim last client action | debug + OCC context |
| `historyLog` | **new** append-only UI/debug trail | see §10 |
| `date` | foodData.date | yes |
| `name` | foodData.name | yes |
| `composition` | foodData.composition | yes |
| `weightGrams` | foodData / sum items | yes |
| `quantity` | foodData.quantity | yes |
| `basis_type` | parsedData | keep |
| `serving_grams` | parsedData | keep |
| `consumedAmount` | FoodLog | optional |
| `benefits` | foodData / dietitian | content layer |
| `risks` | foodData | content |
| `healthImpact` | foodData | content |
| `recommendation` | foodData | content |
| `verdict` `{label,level}` | rawParsed / foodData | content |
| `description` | foodData / rawParsed | content |
| `message` / narrative | dietitian message | content |
| `nutrients` (31) | aggregateItemsNutrients | yes after calc |
| `imageUrl` | photo / pending | prefer imageUrls[0] |
| `imageUrls[]` | multi photo | **R2 URLs only** on hot path |
| `itemsBreakdown[]` → `items[]` | pipeline | yes |
| `scoutItems[]` | scout checkpoint | keep until calc closed; then optional slim ref |
| `scoutContentType` | visual/text | envelope |
| `diningEnvironment` | **scout only** (never dietitian overwrite) | envelope |
| `cookingMethod` | scout / foodData | envelope + items |
| `scoutConfidenceRating` | scout | envelope |
| `scoutConfidenceComment` | scout | envelope |
| `receiptTable` | aggregate / meal compiler | after calc |
| `dangerBadges` | meal compiler / dietitian | content/meta |
| `biomarkerStatus` | meal compiler | content/meta |
| `chatTranscript` | FoodLog optional | optional / cold |
| `sync_state` / `updated_at` | FoodLog | on save |
| `photoUrl` / `debugUrl` | clean_result / R2 | envelope refs |
| `dietitianScratchpad` | rawParsed | **cold only**, not hot meal |
| `mode` | new_log / modify / evaluation | envelope |
| `apiCalls` | response meta | cold / ledger summary |
| `portionClarify` | B1 pause | stage payload when awaiting_user |
| `needsPortionClarify` | B1 | status |
| `activeMeal` inputs | edit | seed for edit meal |
| `remainingAllowance` / profile refs | request | not stored on meal body (job input) |

### 2.3 FoodItem (itemsBreakdown line) — must preserve

| Field | Notes |
|-------|--------|
| `itemId` | Mint durable if missing (`server_meal_compiler`) |
| `scoutIndex` | Binding key across scout → preCalc → dietitian |
| `name` / `canonicalDbName` / `originalName` / `originalLocalName` / `keyword` | identity |
| `weightGrams` | portion / scale |
| `estimatedWeightGrams` / `estimatedCalories` | scout soft (one soft kcal **per dish item**) |
| `calories` + full 31 in `nutrients` map | prefer `nutrients` map; scalar calories ok as mirror |
| `dbSource` / `dbId` | match provenance |
| `cookingMethod` | |
| `visualIngredients` | |
| `components` | composition sketch (array/object) |
| `componentsDetailList` | resolved component rows |
| `hasComponents` | |
| `primaryBase100g` / `primaryBaseMatchName` / `primaryBaseWeightG` | foundation |
| `labelNutrientsPerServing` | label path |
| `rawNutritionLabel` | **printed only** — never free invent |
| `lockedNutrientKeys` / `itemLockedKeys` | reconcile re-apply **only** these |
| `truthNutrients` | |
| `cookingAdded` | fat/sodium/kcal adhesion |
| `ingredientsList` | |
| `chainName` | brand/chain |
| `foodType` | |
| `warnings` | |
| `confidenceRating` / `confidenceComment` | |
| `physicalFormClassification` | |
| `matchReasonInfo` | |
| `diningEnvironment` | may copy on item |
| `saucesDetailList` | meal compiler |
| `labelServingGrams` / portion meta | B1 |
| `portionChoiceApplied` | after user choice |
| `compositionStatus` | `none` \| `partial` \| `resolved` (new explicit) |
| `nutrientStatus` | `empty` \| `partial` \| `calculated` |
| `fill` | `{ scout, resolved, calculated }` |

### 2.4 Component (inside FoodItem — composition only)

| Field | Notes |
|-------|--------|
| `name` / `searchQuery` | |
| `weightGrams` / `volumePercentage` | |
| `dbId` / `dbSource` | |
| nutrients if resolved | optional |
| **Not** a Meal; **not** a Mode D option | |

### 2.5 Mode D — ComparisonSet (not composition)

Today: `mode: "evaluation"`, `comparison.groups[]`, `preCalcByScoutIndex`, `scoutItems`, message.

| Field | Maps to |
|-------|---------|
| `comparison.groups[]` | each group → **one Meal option** (or Meal with items = group’s items) |
| `groupName` | meal.content.name / group title |
| group items / scoutItemIndices | FoodItems on that option meal |
| per-option nutrients | meal.nutrients (server preCalc only) |
| ranking / recommendation text | ComparisonSet.content + per-meal content |
| `isMenuScale` | ComparisonSet flag |
| `scoutItems` | shared intake; split onto option meals by indices |
| Dietitian compare prose | ComparisonSet.content.message |

**Law:** Mode D dietitian compares **server preCalc only** — no free macros.  
Same finalize/budget as Mode A (`[Budget] mode=D` logs).

### 2.6 Edit / modify inputs

| Input | Maps to |
|-------|---------|
| `activeMeal` | seed Meal (full prior itemsBreakdown + nutrients + images) |
| `userSelectedMode: edit` / modify intent | meal.mode path |
| Structural ops | meal compiler ops on same `meal.id` (D4 same jobId) |
| Weight-only / label-lock | D8 skip dietitian; recalculate only |
| Preserve on edit merge | dbId, primaryBase100g, componentsDetailList, locks, rawNutritionLabel, estimatedCalories, components |

### 2.7 Job / clean_result bridge (must still work)

| clean_result / job field | Meal link |
|--------------------------|-----------|
| `pendingFoodLog` | `toPendingFoodLog(meal)` — full parity |
| `scoutItems` | meal.scoutSnapshot or items scout fields |
| `message` / `text` | content.message |
| `dietitianScratchpad` | cold only |
| `photoUrl` / `debugUrl` | meal media + coldDebugUrl |
| `backendLogs` | **not** primary; ledger + optional cold |
| `portionClarify` | stage payload |
| `mode` | meal.mode |
| `checkpoint.scoutItems` | migrate → meal items fill |

### 2.8 Stage ledger (required for audit)

```ts
StageAuditRecord {
  stageKey: string                 // mealId|stage|attempt — idempotency
  stage: 'media'|'scout'|'portion'|'resolver'|'calculation'|'dietitian'|'user_edit'
  status: 'ok'|'degraded'|'failed'|'skipped'|'awaiting_user'|'circuit_open'
  at: string
  attempt: number                  // 1-based
  itemId?: string
  scoutIndex?: number
  expectedVersion?: number         // OCC: meal.version writer believed
  resultVersion?: number           // meal.version after apply
  decisions: { key: string; value: string|number|boolean; source: string; note?: string }[]
  errors?: { class: string; message: string; recovery?: string; code?: string }[]
}
```

### 2.9 Envelope process fields (required)

```ts
// On MealBuild root
schemaVersion: 1
version: number                    // monotonic; start 0 or 1
lastUpdatedBy: string              // 'user_edit' | 'job_stage_scout' | ...
lastUserAction?: {
  at: string
  action: string                   // e.g. 'portion_choice' | 'lock_weight' | 'retry_advice' | 'send_message'
  detail?: string                  // ≤200 chars
  clientId?: string
}
historyLog: HistoryLogEntry[]      // §10 — capped ring on hot path
stageLimits?: StageLimits          // copied from job or defaults
deletedItemIds: string[]           // §3.4 tombstones
staleDietitianNarrative: boolean   // §3.5
```

---

## 3. Consolidation rules (no gaps, no wipe)

1. **Merge function** `consolidateMeal(prev, patch, stage, opts?: { stageKey?, expectedVersion?, actor?, deletedItemIds? })`:
   - Deep-merge items by `itemId` else `scoutIndex` else name+weight key.
   - For each field: if `patch[field]` is `undefined`/`null` and `prev[field]` is set → **keep prev** (except explicit user clear).
   - Arrays of components: prefer longer resolved list; never replace resolved `componentsDetailList` with empty from dietitian.
   - **Apply `deletedItemIds` / `_deleted` last** so stages cannot restore zombies (§3.4).
2. **Label / soft scout dominance** (food-calc): preserve `rawNutritionLabel`, `estimatedCalories`, `estimatedWeightGrams`, `components` on merge.
3. **Reconcile:** re-apply **only** `lockedNutrientKeys` / `itemLockedKeys`.
4. **diningEnvironment:** scout wins forever on that meal.
5. **Partial item:** allowed; set `nutrientStatus=partial`, `compositionStatus=partial|none`; do not invent components to “complete.”
6. **Savable:** `true` when calculation stage has produced meal-level nutrients + ≥1 item with usable energy or label lock (policy in code + test). Delete-all → not savable food log.
7. **toPendingFoodLog / fromPendingFoodLog:** round-trip must keep inventory fields (assert coverage); run **`migrateMealSchema`** first on inbound JSON.
8. **OCC (required for user_edit vs job stages)** — see §3.1 + client **409 rebase** §3.1.1.
9. **Stage idempotency** — see §3.2.
10. **Stale dietitian narrative** — see §3.5.

### 3.1 Optimistic concurrency (user edit vs background stages)

**Gap fixed:** user locks weight on client while resolver/preCalc finishes; naive server write overwrites user edit.

```ts
// Writer always sends:
{ patch, expectedVersion: number, actor: 'user_edit' | 'job_stage_resolver' | ... }

// Server apply:
if (expectedVersion !== meal.version) {
  // 1) Rebase: re-apply patch against current meal (user fields win for user-owned keys)
  // 2) Or reject with 409 + current meal for client retry
}
meal.version += 1
meal.lastUpdatedBy = actor
```

**User-owned keys** (always win on conflict if both touch same item):  
`weightGrams` when user-locked, portion choices, explicit name renames, user `itemLockedKeys` adds.

**Stage-owned keys** (job wins if user did not touch):  
`dbId`, `dbSource`, `componentsDetailList` (unless user structural edit), calculated `nutrients` after user-only weight change → **recalc** rather than restore stale stage nutrients.

**Practical CAS storage:** Supabase/job row update with `version` check (or embed in meal JSON and reject stale writers). Client JobStore bumps `version` on local user_edit before sync.

#### 3.1.1 Client 409 rebase strategy (JobStore — binding)

When server returns **409 Version Conflict** (or body `{ conflict: true, meal: MealBuild }`):

```text
1. Load serverMeal = response.meal (authoritative body at V_server)
2. migrateMealSchema(serverMeal)
3. localUserPatch = extractUserOwnedKeys(pendingLocalEdit)
   // weightGrams (user-locked), deletedItemIds, renames, portionChoices, itemLockedKeys user adds
4. rebased = consolidateMeal(serverMeal, localUserPatch, 'user_edit', {
     expectedVersion: serverMeal.version,
     actor: 'user_edit',
     deletedItemIds: localUserPatch.deletedItemIds
   })
5. If rebased requires calc (weights/items changed): run local or request calculation-only
6. Re-submit with expectedVersion: serverMeal.version (or rebased.version if server applied)
7. Max 3 rebase attempts; then surface "Couldn't sync edit — tap Retry" + historyLog error
8. Never drop deletedItemIds during rebase
```

UI stays on optimistic meal; on final failure, show server meal + retry chip. Do **not** infinite 409 loop.

### 3.2 Stage replay idempotency

```text
stageKey = `${mealId}|${stageName}|${attemptNumber}`
```

- Every stage attempt records **one** `StageAuditRecord` with that `stageKey`.
- If `consolidateMeal` sees the same `stageKey` again (network retry of same attempt): **replace** that attempt’s delta (items produced under that key), do **not** append duplicate FoodItems.
- New retry → `attemptNumber+1` → new `stageKey` → new record; may supersede prior stage outcomes for stage-owned fields only.
- Item identity still keys on `itemId`/`scoutIndex` so supersede updates in place.

### 3.3 Schema version + offline migrate

```ts
function migrateMealSchema(json: unknown): MealBuild {
  // v missing → treat as 0, upgrade field renames, ensure nutrients keys exist as partial
  // v1 → current
  // unknown future → best-effort + ledger decision schema_migrate_unknown
}
```

Call on: JobStore load, Supabase pull, R2 cold restore, `fromPendingFoodLog`.

### 3.4 Explicit item deletions (no zombie items)

**Gap:** User deletes “Fries” while resolver stage still includes Fries → deep-merge **restores** the item.

**Binding:**

```ts
// Meal root
deletedItemIds: string[]   // durable tombstones for this meal lifetime (or until undo)

// Patch may carry:
patch.deletedItemIds?: string[]
// and/or per-item: { itemId, _deleted: true }
```

**consolidateMeal order:**

1. Union `deletedItemIds = prev.deletedItemIds ∪ patch.deletedItemIds ∪ items marked _deleted`  
2. Merge surviving items as usual  
3. **Drop** any item whose `itemId` (or stable key) is in `deletedItemIds`  
4. Stage patches **must not** re-add a deleted id (ignore or ledger `decision: zombie_blocked`)  
5. Recalc meal totals after drop  
6. Set `staleDietitianNarrative = true` if content.message exists and dietitian not re-run  
7. historyLog: `user_action` delete item  

**Undo (optional later):** remove id from `deletedItemIds` only via explicit user_undo — not via stage replay.

**Scout re-run:** new scout that “sees fries again” creates a **new itemId** (or requires user confirm re-add); never auto-clear tombstones from background stages.

### 3.5 Stale dietitian narrative (D8 / weight edits)

**Gap:** Weight 100g → 800g updates macros; advice still says “great light portion.”

```ts
staleDietitianNarrative: boolean  // default false
```

**Set `true` when** (and dietitian stage did not just complete ok):

- Any item weight changes by **>20%** relative, or  
- Item add/remove/rename/identity change, or  
- Portion choices applied, or  
- Recalc changes meal calories by >20%

**Set `false` when** dietitian stage completes successfully (new message/verdict written).

**UI:**

- Dim advice / amber badge: “Macros updated — coaching reflects a previous portion. [Refresh advice]”  
- Refresh advice = dietitian-only resume (meal stays savable)

**Skip-dietitian scale (D8):** still recalculate; always set stale flag if prior narrative exists.

---

## 3A. Context subtraction (stage input masks)

**Principle:** each stage may **write** only its allowlist (§5) and may **read** only its **input projection**. Downstream agents must not see raw images, full OCR dumps, FDC candidate lists, or prior agent prompts.

| Stage | May read (only) | Must not receive |
|-------|-----------------|------------------|
| **media** | upload blob / local file refs | — |
| **scout** | raw image URL or user text (+ mode flags) | dietitian history, FDC dumps |
| **portion** | scout items (name, soft weight, label serving fields), prior portionClarify | images optional; no dietitian |
| **resolver** | per item: labels/keywords, components sketch, diningEnvironment, weights | raw image tokens, dietitian prompts, full search candidate arrays in LLM context |
| **calculation** | resolved dbId/sources, weights, locks, label maps, componentsDetailList | **0 LLM** — pure code |
| **dietitian** | meal.name, composition summary, **macro/totals + locked preCalc**, userProfile (light), biomarker summary if needed | intermediate vector/DB candidate lists, raw OCR JSON walls, scout scratchpads, base64 |
| **user_edit** | current meal body | need not re-send cold logs |

Implement as pure projectors:

```ts
projectScoutInput(job)
projectResolverInput(meal)
projectCalculatorInput(meal)   // → existing budget/aggregate helpers
projectDietitianInput(meal, profile)
```

Handoff dilution is a **bug class**: if dietitian prompt includes full `databaseMatchesArray`, fix the projector — do not “just increase context.”

---

## 3B. StageLimits (circuit breakers)

Aligns with existing job `attemptByStep` + runner circuit breaker; make **per-meal / per-stage** explicit.

```ts
interface StageLimits {
  maxStageAttempts: number;    // default 2 (plus 1 initial = 3 total) per stage
  totalTokenBudget?: number;   // optional soft/hard across job; log when exceeded
  stageTimeoutMs: number;      // e.g. 60_000 scout, 30_000 dietitian — tune per stage
  maxHistoryHotEntries: number; // e.g. 80
  maxHistoryHotChars: number;   // e.g. 24_000
}
```

On trip:

1. Mark stage `status: 'circuit_open'` / `degraded`  
2. Ledger: `errors: [{ code: 'CircuitBreakerTripped', recovery: 'awaiting_user' | 'retry_advice' | 'manual_fill' }]`  
3. Prefer **awaiting_user** or savable+degraded over hang/loop  
4. Do not auto-re-scout past `maxStageAttempts`

---

## 4. Mode matrix

| Behavior | Mode A (`new_log`) | Mode D (`evaluation`) | Edit (`modify`) |
|----------|--------------------|------------------------|-----------------|
| Document | 1 Meal | 1 ComparisonSet + N Meals | 1 Meal (same id) |
| Scout | yes (if image/text intake) | yes per option items | only if new images / dirty |
| Portion clarify | yes | same helpers if ambiguous | if new pack items |
| Resolver / budget | yes `[Budget] mode=A` | per option `[Budget] mode=D` | dirty items `[Budget] mode=edit` |
| Calculator | yes | N times (one per option meal) | yes after ops |
| Dietitian | coach on preCalc | compare preCalcs only | optional; skip on pure scale (D8) |
| Save (D3) | explicit Save → FoodLog snapshot | user picks option meal → snapshot | update same log / new snapshot policy |
| Fail dietitian | meal still savable | options still show macros | meal still savable |

Mode A PASS ≠ Mode D PASS ≠ Edit PASS — gates must cover all three.

---

## 5. Stages (orchestrator)

```text
media → scout → (portion?) → resolver → calculation → dietitian
```

| Stage | Writes | On failure |
|-------|--------|------------|
| media | imageUrls (R2) | can retry upload; meal may exist without photo |
| scout | items identity, soft kcal/weight, components sketch | no savable meal; circuit → user text fill |
| portion | weights / choices; awaiting_user | pause, not fail |
| resolver | dbId, componentsDetailList, sources | category fallback + ledger degraded |
| calculation | 31 nutrients, receipt, savable | not savable |
| dietitian | content advice only | **degraded**; meal stays savable |

Each stage run:

1. Check StageLimits (attempts/timeout)  
2. Build **input projection** (§3A)  
3. Execute with `stageKey`  
4. `consolidateMeal` with OCC `expectedVersion`  
5. Append/replace ledger + **historyLog** entry  
6. On error: historyLog + ledger error; degrade or circuit — never silent drop  

Targeted resume: only empty/degraded stages; never re-vision if scout filled; same `stageKey` is idempotent.

---

## 6. Storage

| Store | Content |
|-------|---------|
| Supabase `agent_jobs` (or meal_builds later) | lean Meal / ComparisonSet JSON + ledger + **hot historyLog** (capped) |
| Client JobStore | cache mirror; migrate on read |
| R2 **photos** | user meal images (longer retention — product data) |
| R2 **cold debug** | forensic packages (§10.3) under e.g. `debug/` or `debug-packages/` |
| Food history | immutable snapshot on Save |

### 6.1 R2 cold debug lifecycle (binding)

| Prefix | Retention | Rationale |
|--------|-----------|-----------|
| `debug/` / `debug-packages/` | **14–30 days** auto-expire (bucket lifecycle rule) | Hot ledger + historyLog remain for long-term audit; raw dumps must not grow forever |
| Meal **photos** (`photos/` or existing key scheme) | Product policy (not auto-delete with debug) | User content ≠ forensic temp |

Document the lifecycle in infra notes when applying; code should tolerate missing coldDebugUrl (404 → “debug expired”).

**Hot path forbids:** base64 images, full system prompts, full FDC documents, dietitian scratchpad novels, unbounded console/network dumps.

---

## 7. Implementation phases (failure-point reduction order)

| Phase | Outcome |
|-------|---------|
| **0** | Types + inventory + consolidate (incl. **deletedItemIds**) + migrate + stageKey + version + history helpers |
| **1** | Savable-on-calc; dietitian degrade; UI Save + Retry advice; historyLog on degrade |
| **2** | Persist both paths; resume; idempotent stage; StageLimits |
| **3** | Early R2 media; multi-device; migrate on pull |
| **4** | Orchestrator + projectors + cold debug builder + B9b; **R2 debug TTL policy note** |
| **5** | Mode D ComparisonSet |
| **6** | Edit + OCC + **409 rebase** + **staleDietitianNarrative** UI + zombie-delete tests |

Do **not** big-bang rewrite `server.ts` nutrient math.

---

## 8. Anti-patterns

- Modeling Mode D options as `components[]` of one meal  
- Modeling burger components as separate Meals  
- Dropping `scoutIndex` / `dbId` / locks on dietitian rewrite  
- Dual meal schemas for client vs serverJobs  
- Primary audit = 200k `backendLogs` without ledger/history  
- Claiming COMPLETE on Mode A only  
- Inventing components to fill partial label items  
- Applying stage patch without `expectedVersion` when user_edit can race  
- Feeding dietitian full DB candidate lists / raw OCR walls  
- Retrying same stage without `stageKey` (duplicate items)  
- Infinite scout re-prompt without StageLimits  
- Putting full console/network capture on **hot** Supabase meal (belongs in cold R2, hot = capped summary)  
- Restoring items that are in **deletedItemIds** (“zombie fries”)  
- Showing fresh macros with unflagged old coaching prose  
- Infinite 409 rebase without max attempts  
- Deleting user **photos** on the same lifecycle as debug packages  

---

## 9. Literature / engineering alignment (2026)

| Pattern | M21 base | Refinement adopted |
|---------|----------|-------------------|
| Durable shared state / blackboard | Meal document | + OCC version |
| Context engineering | Hot strip base64 | + **stage input masks** |
| Checkpoint / resume | Stage fill | + **idempotent stageKey** |
| Saga forward recovery | Savable-on-calc | unchanged (correct for meals) |
| Circuit breaker | Job runner partial | + **StageLimits** on meal |
| Schema evolution | schemaVersion mentioned | + **migrateMealSchema** mandatory |
| Observability | thin ledger note | + **§10 history + cold debug package** |
| Tombstones / soft delete | — | + **deletedItemIds** |
| Stale derived views | — | + **staleDietitianNarrative** |
| Client sync | — | + **409 rebase loop** |
| Data lifecycle | — | + **R2 debug TTL** |

---

## 10. Debug package + log history (binding — first-class)

Previous drafts under-specified this. **Correct progressive meals without correct history/debug still fail multi-agent ops.**

### 10.1 Three channels (do not collapse into one blob)

| Channel | Purpose | Storage | Size |
|---------|---------|---------|------|
| **A. stageLedger** | Structured decisions / stage outcomes / recoveries | On meal (hot) | Small, complete for triage |
| **B. historyLog** | Time-ordered **human + system narrative** (what happened) | On meal (hot, **capped ring**) | Medium |
| **C. coldDebug** | Full forensic: backend log text, optional console/network slices, prompts | R2 JSON via `coldDebugUrl` | Large |

In-app job/chat “log history” reads **B** (and stage checkmarks from **A**).  
Download debug builds markdown from **A + B + meal body**, with link/embed summary of **C**.

### 10.2 historyLog entry shape (append-only)

```ts
type HistoryLogEntry = {
  id: string;                 // uuid or `${at}-${seq}`
  at: string;                 // ISO
  seq: number;                // monotonic per meal
  kind:
    | 'user_action'
    | 'stage_start' | 'stage_ok' | 'stage_degraded' | 'stage_failed' | 'stage_circuit'
    | 'system' | 'error'
    | 'network' | 'console';  // summaries only on hot path
  stage?: string;
  stageKey?: string;
  actor?: string;             // 'user' | 'orchestrator' | 'serverJobs' | 'client'
  message: string;            // ≤300 chars hot
  detail?: string;            // ≤500 chars hot; longer → cold only
  error?: { message: string; class?: string; code?: string; stackTop?: string };
  refs?: { itemId?: string; scoutIndex?: number; requestId?: string; statusCode?: number };
};
```

**Append rules:**

1. Every stage start/end → historyLog (+ ledger).  
2. Every **user action** that mutates meal or job (send, portion chip, save, retry advice, cancel, edit weight) → historyLog **and** update `lastUserAction`.  
3. Every **caught error** (stage throw, 429, JSON parse, network fail) → historyLog `kind: 'error'` with message/class/code; ledger `errors[]` if stage-scoped.  
4. **Do not** drop history on dietitian degrade or job status flip.  
5. Cap hot history: keep last `maxHistoryHotEntries` / `maxHistoryHotChars`; when trimming, **never delete** last error + last user_action + last stage_circuit (pin those). Overflow full text lives only in cold package.  
6. Same `stageKey` retry: update/replace stage_end history line for that key or append `attempt N` line — do not invent duplicate “item added” narratives.

### 10.3 Cold debug JSON package (R2)

Built at job terminal states (succeeded / degraded success / failed / awaiting_user snapshot optional):

```ts
ColdDebugPackage {
  schemaVersion: 1
  mealId, jobId, userId?, exportedAt
  meal: MealBuild              // after stripHeavyImages; may slim nutrients for size
  stageLedger: StageAuditRecord[]
  historyLog: HistoryLogEntry[]  // full untrimmed if available server-side
  lastUserAction
  version, schemaVersionMeal: meal.schemaVersion

  // Forensic (optional sections — include when captured)
  backendLogsText?: string     // capped e.g. 200k server-side already
  errors: { at, message, class?, code?, stage?, stageKey? }[]
  network?: {
    // summaries, not full HAR unless tiny
    entries: { at, method, urlHostAndPath, status, durationMs, error?: string }[]
  }
  console?: {
    entries: { at, level: 'log'|'warn'|'error', message: string }[]  // last N from client debug buffer
  }
  prompts?: { stage, model, charLen, hash? }[]   // not full prompt text unless flag debug_full
  environment?: { appVersion?, userAgent?, path? }
}
```

**Client capture (best-effort, privacy-aware):**

- Maintain a **ring buffer** (e.g. last 50 console errors/warns, last 30 food-api network rows) **only while a food job is active**.  
- On job end / bug snapshot / download debug: flush buffers into cold package (or bug domain pack), **not** into every Supabase meal write.  
- Redact tokens/Authorization headers; strip query secrets; never store base64 image bodies in network logs.

**Server capture:**

- Existing `addDebugLog` / stream logs → `backendLogsText` in cold package.  
- On each stage error: push structured error into cold `errors[]` **and** hot historyLog one-liner.

### 10.4 Download debug (B9b evolution)

`buildDebugMarkdownReport` order:

1. Header: jobId, mealId, status, **version**, savable, degradedStages, lastUserAction  
2. Meal summary + macros + items  
3. **Stage ledger table** (stage, status, attempt, key decisions, errors)  
4. **History log** (chronological, last 100)  
5. Receipt if any  
6. Appendix: backend log excerpt / “full: coldDebugUrl”

### 10.5 In-app log history UI

- Job card / LogChat progress stream = projection of historyLog kinds `stage_*` + `user_action` + `error`.  
- Survives refresh if meal/historyLog persisted on job row.  
- Multi-device: server meal historyLog is source of truth; client merges by `seq` / `id` (append only higher seq).

### 10.6 What “full debugging context” means (acceptance)

A triager with **only** hot meal + historyLog + ledger (no R2) can answer:

1. What was the **last user action**?  
2. Which **stage** failed or degraded?  
3. Is the meal **savable**?  
4. Which **item/scoutIndex** is implicated?  
5. What **recovery** is offered?

With **cold package** they can also answer:

6. Exact backend error text / HTTP status  
7. Recent console errors during the job  
8. Recent API network failures (status, path)  
9. Prompt sizes/hashes (full prompt only if debug_full)

Cold URL 404 after lifecycle expiry: UI shows “forensic package expired (kept N days); meal ledger still available.”

---

## 11. Architectural completeness checklist

| Layer | Status | Verification |
|-------|--------|--------------|
| Domain schema & taxonomy | Complete | Component ≠ FoodItem ≠ Meal ≠ ComparisonSet |
| Context management | Complete | Stage input masks; base64 stripped hot |
| Math integrity | Complete | 31 nutrients via deterministic calculator |
| Concurrency & sync | Complete | OCC version + CAS + **409 client rebase** |
| Deletion integrity | Complete | **deletedItemIds** tombstones |
| Derived narrative integrity | Complete | **staleDietitianNarrative** |
| Failure tolerance | Complete | Savable-on-calc, StageLimits, stageKey idempotency |
| Observability & triage | Complete | Ledger + historyLog + coldDebug |
| Storage lifecycle | Complete | Hot meal long-lived; **debug R2 14–30d** |
| Chaos / edge use cases | Complete | **§12 matrix** (must stay green as product evolves) |

---

## 12. Chaos & edge-case resilience matrix (bulletproofing)

**Principle:** every pathological case maps to one of:

1. **Progress** (stage ok / partial)  
2. **Pause** (`awaiting_user`)  
3. **Degrade** (savable or not, with recovery)  
4. **Fail closed** only when **no** usable meal can exist  

Never: hang, infinite loop, silent data loss, or zombie restore.

### 12.1 Intake extremes

| Use case | Required behavior |
|----------|-------------------|
| **0 images, empty text** | Reject submit early; no job burn; history optional |
| **1–N images (e.g. 10 photos)** | Cap concurrent vision (e.g. max 4–5 images processed or collage policy); extra images stored as `imageUrls` refs only; if over cap → process first K + historyLog `images_truncated`; still one Meal |
| **Huge image / base64** | Compress client-side; never persist data: URLs on meal; fail media stage with retry if upload fails |
| **Nonsense text** (“asdf jkl”) | Scout/intake → discussion **or** empty items + `awaiting_user` “describe what you ate”; **not** fake USDA match dump |
| **Direction only** (“what should I eat?”) | Route **discussion** mode — no Meal savable required; no fake food log |
| **Off-topic / abuse** | Discussion or polite refuse; circuit if repeated; no meal pollution |
| **Mixed photo + “ignore this”** | User text can cancel auto-items via edit/delete + tombstones |
| **Non-food photo** (receipt of furniture) | Scout low confidence → awaiting_user or discussion; category dump forbidden (food-calc fail-open is **form-safe candidate**, not mass junk) |

### 12.2 Time & attention

| Use case | Required behavior |
|----------|-------------------|
| **User silent 3 days mid portion_clarify** | Job stays `awaiting_user`; meal + scout preserved; no auto-fail spam; on return resume same meal id |
| **User silent mid running job** | Server/client: timeout stage → degrade/circuit; meal kept; retry later |
| **App killed mid-upload** | On relaunch: job draft/queued with partial media; resume upload; no double-charge if idempotent job id |
| **App killed after calc before save** | Meal savable on server/job row; UI shows Save on reload (D3 still explicit) |
| **Returns on another device** | Load meal by id; imageUrls from R2; historyLog from server; migrate schema |

### 12.3 Data / catalog gaps

| Use case | Required behavior |
|----------|-------------------|
| **Food not in USDA/OFF** | Resolver degraded → category_fallback or label-only partial item; **calc still runs**; ledger `source=category_fallback`; dietitian optional |
| **Label OCR partial (700 kcal only)** | Partial item; locks on known keys; no invented components; savable |
| **Incomplete multi-component (salad leaves only)** | Detect + repair or explicit incompleteAssembly degraded — not silent wrong total (food-calc L7) |
| **Ambiguous multi-serve pack** | portion_clarify pause — not guess grams |
| **Chain menu miss** | Component/USDA path; no fake absolute web inject when policy forbids |

### 12.4 Infrastructure faults

| Use case | Required behavior |
|----------|-------------------|
| **Supabase down / write fail** | Keep JobStore local truth; queue upsert; historyLog `sync_degraded`; user can still Save food to primary store if that path works |
| **Supabase read fail multi-device** | Show local meal; banner “cloud sync unavailable” |
| **R2 photo upload fail** | Retry media; analysis may proceed with local-only preview but flag `media_degraded`; other device may lack photo |
| **R2 debug upload fail** | Non-fatal (already pattern); meal success independent |
| **Gemini 429 / quota** | Stage retry with backoff within StageLimits; then degrade (dietitian) or circuit (scout) |
| **Gemini garbage JSON** | Parse fail → retry once → degrade/fail stage; never wipe prior calc |
| **DB search timeout** | Resolver degraded → fallback profile; calc continues |
| **Network flap mid-stream** | Idempotent stageKey on resume; client rebase if version moved |
| **Partial SSE (no final)** | serverJobs recover-if-final; else fail with logs; meal mid-state if checkpoints written |

### 12.5 Concurrency & edits

| Use case | Required behavior |
|----------|-------------------|
| **Delete item while resolver runs** | deletedItemIds tombstone; stage cannot restore |
| **Weight edit while calc runs** | OCC + user-owned weight; recalc after |
| **409 on edit** | Client rebase §3.1.1 max 3 |
| **Two devices edit same meal** | Last CAS wins with merge rules; historyLog both actions if both sync |
| **Delete all items** | Empty meal; not savable as food; offer cancel job |
| **Scale 100→800g D8** | Macros update; `staleDietitianNarrative=true`; badge + refresh advice |

### 12.6 Mode-specific

| Use case | Required behavior |
|----------|-------------------|
| **Mode D many options** | N Meals under ComparisonSet; each finalize independent; one dietitian compare on preCalcs only |
| **Mode D one edible choice** | Still comparison set or collapse policy documented — no invent macros |
| **Edit without activeMeal** | Fail closed with message; do not invent meal |
| **Discussion during active meal** | Does not destroy mealBuild; separate message path |

### 12.7 Limits & abuse of pipeline

| Use case | Required behavior |
|----------|-------------------|
| **Scout always ambiguous** | maxStageAttempts → circuit → manual name/weight UI |
| **User retries 50×** | Job-level credit/queue limits (maxQueued=5); StageLimits |
| **Token blowup** | Projectors + optional totalTokenBudget circuit |
| **maxQueued exceeded** | Reject new job clearly; existing meals intact |

### 12.8 Resilience test catalog (Studio / CI should cover samples)

Minimum automated:

1. Dietitian throw → savable meal + history error  
2. Delete item + resolver patch with same itemId → item stays gone  
3. stageKey double apply → no duplicate items  
4. expectedVersion mismatch → rebase keeps user weight  
5. 409 client loop max 3  
6. migrateMealSchema v0 → v1  
7. Weight +20% → staleDietitianNarrative  
8. Nonsense text → no crash; no mass category dump  
9. Round-trip pendingFoodLog critical fields  

Minimum manual chaos:

10. 5–10 photos one meal  
11. Leave portion_clarify overnight / 3 days  
12. Airplane mode after calc → Save locally / sync later  
13. Kill tab mid-job → reload  
14. Food not in DB  
15. Supabase offline simulation  

### 12.9 Honest limit

**Bulletproof** means: no silent corruption, no infinite loops, always a next action (save / edit / retry stage / discuss / cancel), and audit trail of what happened.  
It does **not** mean every meal is perfect nutrition science offline without user help — partial + awaiting_user is success for resilience.

---

## 13. Related

- Domain: `docs/agent/domains/food-calc.md`  
- Jobs: unified modal / `src/jobs/*`  
- Meal compiler: `server_meal_compiler.ts`  
- Nutrients: `src/utils/nutrients.ts`  
- Debug: `src/utils/debugPayload.ts`  
- Board: `AI_HANDOVER.md`  
- Execute: [ROADMAP.md](./ROADMAP.md) (no studio pack)
