# Meal Build — Durable progressive meal template

**Pillar:** 2 — Food. Map: `plan/README.md`.

**Status:** Architecture (durable). Live WIP → `AI_HANDOVER.md`.  
**Studio pack:** `studio/M21_MEAL_BUILD_DURABLE_STATE.md`  
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
| **Calculator** | Pure finalize (budget/reconcile/aggregate) | Fills 32-nutrient slots — not stored as rival state |
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
| calculation | 32 nutrients, receipt, savable | not savable |
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
| Math integrity | Complete | 32 nutrients via deterministic calculator |
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
- Pack: `studio/M21_MEAL_BUILD_DURABLE_STATE.md`
