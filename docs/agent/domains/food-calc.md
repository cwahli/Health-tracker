# Domain rulebook: Food-calc

**Load when:** calories, scout, budget, reconcile, receipt, portion, catalog/resolver, Mode A/D/Edit food analyze.  
**F-10:** read **§1–1e only**. Do not load the rest of this file, and do not load `plan/FOOD.md` Part A/B.  
**Do not load** for pure biomarker UI, questions about prototype logs, or unrelated CSS.

**Plans (architecture):** `plan/FOOD.md` Process + `plan/FOOD_SINGLE_PATH.md` · execute `plan/ROADMAP.md` Track F  
**WIP status:** `AI_HANDOVER.md`  
**Gates:** `docs/agent/DOMAIN_REGRESSION_MAP.md` → Food-calc section.

### Before → after (2026-09-01, F-10)

| Before | After |
|---|---|
| Create always: Vision Scout → finalize → Dietitian NARRATE | One **Meal Agent** role; TypeScript expands to workers when complex |
| Dietitian is a required create stage | Dietitian pack = edit / Q&A / optional empty-message narrate. Not a systematic second pass |
| Model may emit kcal (elastic prototype) | `finalizeDishLedger` only. Schema has no `calories` |
| Expand = model COMPLETE/DELEGATE | `shouldExpandMealAgent` in TypeScript (dish/image/receipt/barcode) |

**How to use this book:** Default path that stops regressions. **Not a freeze** on product change.  
If you intentionally change pipeline/modes/fields: get confirmation for protected-doc edit (`AGENTS.md` §3), show before→after, update this file + tests in the same task. Do not invent a silent side pipeline for one bug.

---

## 1. Pipeline (Dish-Level Inverted Pipeline — default)

```text
Meal Agent (P/C/F, weight, crops, printed OCR text, draft verdict — does not persist kcal)
  → optional workers (TS expand gate; locked OCR grams; dish crop only)
  → Finalize Engine (OCR → Brand Menu → estimate; R = W_consumed / W_basis; Atwater kcal;
                     optional TS fat/Na from diningEnvironment × cookingMethod)
  → substitute ledger numbers into draft message (second LLM only if message empty)
  → Gate (evaluateMealGate) — refuse 0-kcal-with-macros, sum mismatch, side mutation
Edit later: same Meal Agent emits modificationCommand or [] → applyMealEdits → finalize dirty rows
```

| Role | Rule |
|------|------|
| Meal Agent | Identifies whole dishes, assigns realistic gram weight & direct physical macros (P, C, F) per dish, transcribes printed labels verbatim, emits plain ingredients and a draft verdict/message. **Does not own calories.** Create is one dispatch unless TS expands. |
| Expand | TypeScript `shouldExpandMealAgent` (dish count, image count, receipt/barcode). Model does **not** pick COMPLETE/DELEGATE. Workers get locked grams + crop, not a second full-meal vision pass. |
| `rawNutritionLabel` | **Printed label only** — never invented |
| Truth Hierarchy | Rung 1 (OCR) → Rung 2 (Brand Menu) → Rung 3 (Meal Agent estimate + USDA Atomics as last-resort gap filler) |
| Scaler | **Single scaler across entire system:** $R = \text{consumedWeight} / \text{nutrientBasisWeight}$. Never double-scale or clamp brand lock basis |
| Calories | **`finalizeDishLedger` is the only writer.** Forbidden: LLM `calories` on agent schema, First-Principles Injection, `aggregateItemsNutrients` after finalize, receipt-as-calculator, Modify Math inherit. |
| Edit / Q&A | Same role: `modificationCommand` or `[]` (Q&A). Never rebuild `itemsBreakdown`. New identities need scout-shaped `estimate` (P/C/F, no kcal). Dietitian instruction pack is this slice, not a required create stage. |
| Edit apply | `applyMealEdits` then finalize dirty rows. Same meal id in the same modal. |
| Gate | `evaluateMealGate` — unsavable on fail. Not a log grep. `kcal/g > 9.2` at any consumed weight is unsavable (not only ≥100g). |
| Modes | Same finalize math for **Mode A, Mode D, and Edit** |
| HTTP adapter | `server_routes_food_analyze.ts` orders stages and returns JSON. It is not a second calculator. When the new path is 100%, the old host is **deleted**. |

---

## 1b. LLM Structured Output & Schema Invariants (Grammar Enforcement)

To guarantee that the Meal Agent reliably emits core fields (e.g., `nutrients`, `ingredients`):

1. **Multi-Level `required` Arrays in `responseSchema`:**
   - In Gemini Structured Outputs (`responseMimeType: "application/json"`), defining a field in `properties` is only *permissive*.
   - To make it mandatory, the field MUST be included in the enclosing object's `required` list at **every level**:
     - Level 1 (`items.required`): `["keyword", "originalName", "estimatedWeightGrams", "nutrients", "ingredients", "boundingBox2D", "sourceImageIndex"]`
     - Level 2 (`nutrients.required`): `["protein", "totalFat", "carbohydrates", "sodium", "saturatedFat"]` — **not** `calories`
   - *Failure to add to `required` causes lite models (`gemini-3.5-flash-lite`) to drop nested objects.*

2. **Concrete Numeric Values in Prompt Schema Templates:**
   - System instruction schema examples must use concrete numbers (e.g. `"protein": 22, "totalFat": 18`) instead of type string placeholders (`"protein": "number"`). Lite models pattern-match directly on the template. Do **not** put `"calories": 480` in the create schema.

3. **Explicit `propertyOrdering`:**
   - Place critical estimation fields (`estimatedWeightGrams`, `ingredients`, `nutrients`) early in `propertyOrdering` before bulky fields like bounding boxes or label OCR strings.

4. **Aggregator is off the hot path:**
   - `aggregateItemsNutrients` must **not** run after `finalizeDishLedger` on create/edit.
   - If a leftover call site still exists for a non-estimate experiment, it must not write a second kcal book onto a finalized meal.

5. **Reality-Check Immunity for Dish Estimates & Brand Truth:**
   - `applyNutrientRealityChecks` must skip heuristic category rewrites when `syntheticBase100g`, `isDishEstimate`, or `dbSource === "brand_official"` is present.

---

## 1c. Nutrient Precision Hierarchy (31 Nutrients)

**Emit vs derive (F-10).** The Meal Agent does **not** fill every nutrient. Required schema = estimates only. TypeScript fills identities of those estimates.

| | Agent emits (estimate or OCR text) | TypeScript derives |
|---|---|---|
| Always | protein, carbohydrates, totalFat, saturatedFat, addedSugar, totalFibre, sodium | **calories** `4P+4C+9F` (unless printed-kcal hard lock), **unsaturatedFat** `totalFat−sat−trans`, **salt** `(Na_mg×2.54)/1000` |
| If visible | transFat (else TS `0`), `rawNutritionLabel` strings | Printed kcal/Na/P/C/F become **locks**, not Atwater |
| Directional | dish micros, meal summary micros | Rollup sums only |

**Forbidden:** agent `calories` / `unsaturatedFat` / `salt` in create `required[]`. **Forbidden:** back-solve carbohydrates from calories — that is the phantom-carb class (old top-down scout). `deriveCarbohydratesFromEnergy` is leftover for missing-C repair only, not the hot path.

### 1. Core Nutrients (High Precision ~90–100%)
*Reason: Narrow safety windows, non-negotiable physiological floors, and hard upper limits where estimation errors cause acute metabolic disruption, cardiovascular risk, or rapid dietary drift within 24–48 hours.*
- **Calories** (derived, or printed lock)
- **Protein** (agent)
- **Saturated Fat** (agent)
- **Trans Fat** (printed or 0)
- **Added Sugar** (agent)
- **Total Fibre** (agent)
- **Sodium** (agent)
- **Carbohydrates** (agent — **not** derived from kcal)

### 2. Key Nutrients (Moderate Precision ~70%)
*Reason: Wide biological buffers and flexible metabolic ranges where day-to-day fluctuations are regulated by homeostatic reserves; medium-term weekly averages matter far more than single-meal precision.*
- **Total Fat** (agent)
- **Total Sugar** (agent, dish)
- **Potassium**
- **Omega-3**
- **Calcium**
- **Iron**
- **Magnesium**
- **Vitamin D**
- **Unsaturated Fat** (derived)
- **Salt** (derived)

### 3. Extended Nutrients (Directional Precision <50%)
*Reason: Deep internal storage pools (liver, bone, adipose tissue) that buffer deficiencies over weeks to years, or ubiquitous dietary abundance where day-to-day tracking errors carry negligible clinical risk.*
- **Soluble Fibre**
- **Vitamin A**
- **Thiamine (B1)**
- **Riboflavin (B2)**
- **Niacin (B3)**
- **Vitamin B6**
- **Folate (B9)**
- **Vitamin B12**
- **Vitamin C**
- **Vitamin E**
- **Vitamin K**
- **Zinc**
- **Selenium**
- **Iodine**
- **Phosphorus**

---

## 1d. Restaurant fat / sodium (TS first, not a second agent)

Create does **not** run a Dietitian audit LLM. Hidden commercial fat and sodium are a known 1-agent residual (`prototype/meallog/meal/BENCHMARK_PERFORMANCE_SUMMARY.md` Cases 1, 4, 5, 6, 9). Default fix is **TypeScript** in finalize (F-10.6):

1. **TS critic:** `diningEnvironment` × `cookingMethod` multipliers (e.g. deep-fried restaurant oil absorption, commercial seasoning Na). Applied after Atwater on unlocked items. Honest residual if still under 90% — do not paint goldens.
2. **No default critic LLM.** A Commercial Cooking Critic agent is parked until TS multipliers fail a named soak.
3. **Edit corrections:** On a later submit the Meal Agent may emit `correctedNutrients` with a clinical note. Then `rebalanceNutrientProfile` recomputes kcal = 4P+4C+9F. Create path does not.
4. **Parity:** Saved table and message numbers both come from the finalize ledger after TS critic / edit rebalance.

---

## 1e. Single Source of Truth: Top Targets Synchronization

**Rule:** The user's Top Targets across the entire application MUST be unified from a single source of truth helper (`getTopTargetNutrientKeys(report, profile)`).

1. **Definition & Prioritization:**
   - Top targets are strictly the prioritized core nutrients indicated on the Home tab (excluding physical activity metrics such as `steps`; nutrients only).
   - Priority rank order:
     1. `report.topNutrientTargets`
     2. `report.healthBaselineCategories` / `report.riskCategories` (`priorityNutrientTargets` or `nutrientTargets`)
     3. `profile.topNutrientsToMonitor`
     4. Fallback to `PRIMARY_NUTRIENTS` (`calories`, `saturatedFat`, `sodium`)
   - Strict core filter: `isCoreNutrient(key) && key.toLowerCase() !== 'steps'`.

2. **Parity Across All Surfaces:**
   - **Scout Analysis Prompt (`=== NUTRITIONAL TARGET STATUS ===`):** Evaluates rolling averages for the exact same top target keys, and `pickExplicitTargets` parses explicit target limits for all top target keys so over/under percentages are included.
   - **Meal History Card (`FoodHistoryTab`):** Displays the complete list of top target nutrients for the meal via the shared component (not a truncated subset).
   - **Agent Modal (`FoodCard` - Compare & Single Meal):** Displays the exact same top target nutrients via the shared component (not an arbitrary expanded 8–10 macro list).
   - **Shared Reusable Component (`NutrientTargetRow`):** A shared, callable UI component rendered across both `FoodHistoryTab` and `FoodCard` (and any other meal views) ensuring visual styling parity (`NutrientPieChart` + bold colored text with display name, value, and unit) and numerical consistency.

3. **Rolling Average Calculation & Non-Dilution Invariant:**
   - Rolling averages over $N$ days (e.g. 7-day rolling) MUST divide by the count of active logged days ($activeDaysCount > 0 ? total / activeDaysCount : 0$), never calendar days. Empty days without logs must never dilute intake.
   - Top Targets on the Home screen must clearly display the rolling average, match normalized dates via `toYYYYMMDD`, and support quick switching between Today and Rolling Average view without hidden modal settings.

---

## 2. Mode matrix (all modes share finalize math)

| Behavior | Mode A (`new_log`) | Mode D (evaluation) | Edit / modify |
|----------|--------------------|---------------------|---------------|
| Finalize ledger | `finalizeDishLedger` | `finalizeDishLedger` (`mode=D`) | `finalizeDishLedger` (`mode=edit`) |
| Portion scale | $R = W_1 / W_0$ | $R = W_1 / W_0$ | $R = W_1 / W_0$ |

- Mode A PASS ≠ Mode D/Edit PASS.  
- Prefer **one shared helper** + call sites in each mode over copy-paste math.  
- Unique log substrings for gates (e.g. `[Budget] mode=D`).

---

## 3. Second-order invariants (always if relevant)

| Topic | Must |
|-------|------|
| Merge | Preserve `rawNutritionLabel`, `estimatedCalories`, `estimatedWeightGrams`, `components` |
| Reconcile | Soft result not wiped; re-apply **only** `itemLockedKeys` |
| Scale | Item total scale ⇒ **component rows** scale |
| Multi-turn Portion | Turn 1 carries forward `resolvedDbCandidates` to Turn 2 (`skipScout=true`) to bypass redundant DB re-scans |
| Log Stitching | Preserve `turn1Logs` across portion pauses; stitch Turn 1 + Turn 2 logs for complete R2 debug trace |
| UI Portion Card | Map `needsPortionClarify` & `portionClarify` into `msg.data` so portion selection card renders immediately |
| Stale Narrative | Weight/portion change without a new message-substitute sets `staleDietitianNarrative=true` (D8 / edit scale). D8 still skips the LLM on label-lock scale. |
| Invariant | Detect **and REPAIR the class** (not log-only FAIL). Do **not** “repair” by scaling/aliasing to hide imbalance (L14) |
| Match priority | Real USDA/OFF/catalog **beats** `category_fallback` |
| Fail-open | Agent error → top form-safe candidate, not mass category dump |
| Import | Call site on **each** required branch |

**Classic regressions to refuse:**

- Spreading LLM over vision and dropping `estimatedCalories`  
- Reconcile then re-applying full “truth” map  
- Import `portionAndReconcile` without Mode D/Edit call site  
- Re-running entire vision scout / DB search on Turn 2 portion confirmation  
- Dropping `portionClarify` metadata in client streaming message handlers  
- Overwriting Turn 1 vision logs in R2 upon Turn 2 completion  

---

## 3b. Durable pipeline contract (long-term, no catalog paint)

Success is **not** “this meal’s FDC IDs match a spreadsheet.”  
Success is: **Scout names the food → Resolver resolves *that query* → Backend keeps that bind.** The next unknown food uses the same path.

```text
Scout (vision)     → dishes + component searchQuery + scoutIndex + boxes
Resolver (1 LLM)   → for each query: HIT / MULTI / MISS on *that* query’s candidates
Backend bind       → component may only use rows tagged searchQuery === this query
Honest residual    → MISS is done. Do not steal a sibling row. Do not invent an alias.

Meal trial balance (golden detector — does not solve):
  scout_est → foundation → reconcile → dietitian_payload → saved_table → narrative
  Adjacent books must agree. A backend or dietitian *correction* is a red
  (SILENT_REPAIR / DISH_DROP), not a way to paint green.
```

| Layer | May do | Must not do |
|---|---|---|
| Scout | Extract names, components, weights, printed labels | Guess FDC IDs; invent `rawNutritionLabel` |
| Resolver | Pick / quarantine / MISS among **this query’s** USDA/OFF hits | Write `food_aliases` from HIT_UNIQUE; bind chicken using the onions row |
| Backend | Query-scoped bind; index/name identity; no 2.000 silent scale | `includes()` catalog; `expectFdcId` paint; meal-wide `databaseMatchesArray` steal |

**Patches that look green and fail on the next food (forbidden):**

- `CANONICAL_BASE_FOODS` / `lookupCanonicalBaseFood` `includes()`
- `expectResolve` exact FDC as the test reward
- `POST /loop` until picnic `all_green`
- Extra negative regex for one ID (171327, 172522, …) as the *only* fix

**Debug flow (Studio, no babysit, no loop):**

1. Classify the tape (one class). List other reds as out of session.
2. Hypothesis: which **layer** broke the contract (scout opening / resolver MISS vs steal / backend steal / silent repair).
3. Predicted test: a **generic** fixture (not “G8 sugar”), e.g. pool with two sibling queries — bind must not cross.
4. Patch that layer only. Two burned hypotheses → `blocked_human` (only then ping the human).
5. Outer: one replay of the example meal. Do not `/loop`.

| Class | Inbox / tape examples | Layer that should learn |
|---|---|---|
| Query-scope steal | wrap chicken→onion powder; flour→tortilla; salt→butter | Backend bind (`searchQuery`) |
| False friend in-query | sugar→Popsicle; berries→Powerade; ham→salt pork | Resolver ranker refuse |
| Dish drop / index | croissant phantom 4106; ham gone; quinoa gone | Backend identity + scout merge |
| Opening wrong | lassi 1000g | Scout weight-anchor; one NEW Analyze |
| Silent repair | receipt 2.000 | Backend: stay red, `itemCal := rowSum` |
| Transport | inbox quota job | Not food-calc |

**Golden compiler + journey UI:** inbox shows scout→…→narrative books. `all_green` / Promote is blocked while the compiler is `unbalanced`. Catalog replay cannot promote.

**Many jobs, no loop:** run independent classes in one turn. Inner loop = named vitest. `POST /loop` is forbidden. Two burned hypotheses → `blocked_human` on that job (only then ping the human), then start the next class.

---

## 4. Hot files (prefer extract + test)

| Area | Prefer |
|------|--------|
| Budget / reconcile | `server_budget_reconcile.ts` + tests |
| Catalog / DB / resolver | `server_food_*.ts` |
| Pure helpers | `server_pure_helpers.ts`, aggregation/basis modules |
| Client jobs | `src/jobs/FoodAgentExecutor.ts`, modal/job tests |
| Calories / edit / gate | `server_dish_finalize.ts`, `server_meal_edit.ts`, `server_meal_gate.ts` |
| HTTP adapter | `server_routes_food_analyze.ts` — stage order only; no second kcal writer |
| God files | Thin patches only in `server.ts` / large UI — no end-to-end rewrite. Delete leftover calorie hosts; do not wrap them. |

---

## 5. Anti-patterns

- “Implement budget properly” without call sites + mode logs  
- Grep theater (symbol exists ≠ invoked on path)  
- Claiming COMPLETE after Mode A only  
- Weakening assert scripts to green  

---

## 6. Behavioral tests (required)

```bash
npx vitest run server_budget_reconcile.test.ts server_vision_scout.test.ts server_nutrient_aggregation.test.ts server_portion_clarify.test.ts
# + relevant assert scripts from DOMAIN_REGRESSION_MAP.md
```

| Invariant | Covered by |
|-----------|------------|
| Label / brand / dish_cache / scout / category budget priority | `server_budget_reconcile.test.ts` |
| `parseLabelCalories` | same |
| incompleteAssembly reject_scale | same |
| Post-reconcile locks & density correction (`applyPostReconcileTruthLocks`) | same |
| Vision soft kcal + weight + components survive LLM merge | `server_vision_scout.test.ts` (`mergeScoutItems`) |
| Aggregation preserves `rawNutritionLabel` / `components` + locks | `server_nutrient_aggregation.test.ts` |
| Portion choice scales `estimatedCalories`, keeps label | `server_portion_clarify.test.ts` |

### Invariants & Gates

1. Post-reconcile `applyPostReconcileTruthLocks` pure helper + tests extracted from `server.ts`.  
2. Mode A/D/Edit call-site remains gate-asserted (string/log); do not drop mode tags.

### Database Curator (Food Resolver)
The Food Resolver agent now operates as a **Catalog Curator**. 
- It uses a strict `FoodCuratorActionSchema` with actions like `pick_existing`, `merge_duplicates`, `normalize_basis`, and `quarantine`.
- It is triggered by `MULTI_MATCH` or `MISS` classifications from the FDC Resolve layer.
- `HIT_UNIQUE` queries bypass the LLM and are automatically aliased in the database.
- It never invents meal macros or acts as a meal math calculator; its sole purpose is to resolve item identities to standard `food_items` rows.
