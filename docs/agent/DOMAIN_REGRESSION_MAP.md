# Domain regression map

**Rule:** After changing files in a row, run that row’s commands. Exit 0 required for COMPLETE.  
**Do not** only run 1 happy-path test the agent invented unless the map has no entry (then add a test).  
**Do not** run `npm test` (~97 files) as the inner loop. Soak is optional. See `plan/QUALITY.md` §1.4.

Prefer **named** suites that **exist**. Do not recreate missing `scripts/assert-*.mjs` names.

Ghost (not in `scripts/`, do not cite): `assert-budget-reconcile`, `assert-label-truth-locks`, `assert-false-hard-lock`, `assert-receipt-dup-rows`, `assert-food-calc-exact`, `assert-food-calc-final`, `assert-backlog-b1-portion-clarify`, `assert-food-log-identity`, `assert-unified-modal-*`, `assert-biomarker-flow`.

---

## How to use

1. Diff the files you touched.  
2. Match the **most specific** row(s) below.  
3. Run **union** of matching commands.  
4. Paste results into GATE LOG (`TEMPLATES.md`).

If you touch a hot path and **no** row fits: add a unit/fixture test in the same task, then run it.

---

## Food-calc / meal pipeline

| If you touch… | Run |
|---------------|-----|
| `server_dish_finalize.ts` / `server_brand_match.ts` / `server_derivation.ts` / `server_dish_classify.ts` | `npx vitest run server_derivation.test.ts server_dish_classify.test.ts server_brand_match.test.ts server_dish_finalize.test.ts` |
| `server_budget_reconcile.ts` / budget / reconcile | `npx vitest run server_budget_reconcile.test.ts` |
| `server_vision_scout.ts` / mergeScoutItems | `npx vitest run server_vision_scout.test.ts` (components preserve; no agent kcal) |
| Scout/compare instructions or schemas / nutrition targets | `node scripts/journey-guard.mjs` · `npx vitest run src/server/food/journeyFingerprints.test.ts src/server/food/server_food_scout_source.test.ts src/server/food/server_food_prompt_context.test.ts src/utils/nutritionTargetStatus.test.ts` |
| `src/components/**` / `App.tsx` / chrome / composer | `node scripts/assert-shell-smoke.mjs` (key-journeys + R-3 + dialog-inventory). No live Gemini. |
| Sync / jobs / `App.tsx` pull / Supabase / D1 | `node scripts/assert-egress-bomb.mjs` · `node scripts/assert-free-tier-complete.mjs` (M23–M28). Class `EGRESS_BOMB`. |
| F-10 expand gate / Meal Agent create | `npx vitest run src/mealBuild/__tests__/shouldExpandMealAgent.test.ts server_derivation.test.ts` · `node scripts/assert-f10-pr1.mjs`. Not prototype log runners |
| Food catalog / DB / resolver | `npx vitest run server_food_catalog.test.ts server_food_db.test.ts server_food_resolver.test.ts` |
| Golden meals (`tests/Golden_meal/**`) | `npx vitest run tests/golden_meals.test.ts` only. Not `golden_g1.test.ts` and not `golden:inbox` on every edit (Q-7) |
| Golden scoreboard / tape parser | `npx vitest run src/utils/goldenScoreboard.test.ts` when you touch scoreboard/journey |
| Master scorecard (`golden/scorecard/**`, `scripts/assert-master-scorecard.mjs`) | `npm run scorecard:debug` only. Never `npm test`. Never edit `current/` or `result_summary/` to pass. |
| Nutrient aggregation / basis / prep | `npx vitest run server_nutrient_aggregation.test.ts server_nutrient_basis.test.ts server_prep_policy.test.ts` |
| Portion clarify / refine / weight | `npx vitest run server_portion_clarify.test.ts` |
| Food log identity / history | `npx vitest run src/utils/foodLogDedupe.test.ts` |
| Mode A / D / Edit executor / modal jobs | `npx vitest run src/jobs/__tests__/ModeDAndEdit.test.ts src/jobs/__tests__/FoodAgentExecutor.test.ts` |
| `server.ts` food finalize paths | finalize/derivation + vision merge + portion clarify |

**Invariant reminder:** Mode A PASS ≠ Mode D/Edit PASS. See `domains/food-calc.md`.

**Food-calc smoke (only when the PR actually changes finalize / scout merge / mode math — not every food file):**

```bash
npx vitest run server_derivation.test.ts server_dish_classify.test.ts server_brand_match.test.ts server_dish_finalize.test.ts server_vision_scout.test.ts server_portion_clarify.test.ts src/jobs/__tests__/ModeDAndEdit.test.ts
```


**M30 Curator Invariants:**
- QuerySet components-only for multi-component.
- Curator is not a meal calorie inventor (only curates catalog).
- Brand/OCR hard lock still wins.
- Mode A/D/Edit same finalize logic.

---

## Biomarkers

| If you touch… | Run |
|---------------|-----|
| Biomarker flow / review / apply | `node scripts/assert-biomarker-lifecycle-m31.mjs` + `npx vitest run src/utils/biomarkerLifecycle.test.ts` |
| Key identity / aliases / merged def / approval | `npx vitest run src/utils/biomarkerIdentity.test.ts` |
| Sanitize / data clean | `npx vitest run src/utils/biomarkerSanitize.test.ts src/utils/dataSanitize.test.ts` |
| Dictionary / combine / tombstones on profile | Identity + sync regression suites; see `domains/biomarkers.md` write map |
| Ingest lexer / door | `node scripts/assert-biomarker-ingest.mjs` |
| Medical executor / history filter | Prefer `filterLogsByTombstone` / `deletedBiomarkerLogIds` semantics |

**Biomarker smoke:**

```bash
npx vitest run src/utils/biomarkerIdentity.test.ts src/utils/biomarkerSanitize.test.ts src/utils/dataSanitize.test.ts src/utils/biomarkerLifecycle.test.ts
node scripts/assert-biomarker-lifecycle-m31.mjs
```

**Still TODO:** [ROADMAP.md](../../plan/ROADMAP.md) Track B remaining rows + fill-template C1–C7. Do not add more “approved = has 5 fields” inferrers. Do not run Parser+Review+Calibrator on a 1–5 key chat.

**M31 remaining-work gate:**

```bash
node scripts/assert-biomarker-lifecycle-m31.mjs
npx vitest run src/utils/biomarkerLifecycle.test.ts src/utils/biomarkerIdentity.test.ts src/utils/biomarkerSanitize.test.ts src/utils/dataSanitize.test.ts src/utils/syncUtils.regression.test.ts
```

**Design:** `plan/BIOMARKER_LIFECYCLE.md` · **Laws:** `domains/biomarkers.md`.  
**Order:** `plan/ROADMAP.md` Track B. When touching extract / matcher / leftover Parser:

```bash
node scripts/assert-biomarker-lifecycle-m31.mjs
node scripts/assert-biomarker-ingest.mjs
npx vitest run src/utils/biomarkerLifecycle.test.ts src/utils/biomarkerIdentity.test.ts src/utils/biomarkerIngest.test.ts tests/golden_biomarkers.test.ts
```

Goldens live in `tests/Golden_biomarker/` (not `Golden_meal/`). Group by **class** (`IDENTITY_FALSE_FRIEND`, `SILENT_REWRITE`, …), not by job id. Replay must not call Gemini. G-B1 convert locks stay `1.293` / `1.411` / `3.362` / `79.56` / `13.68`. Work item is the class — do not “make G-B2 all-green.”

---

## Sync / multi-device / storage

| If you touch… | Run |
|---------------|-----|
| `syncUtils.ts` / merge / tombstones / profiles | `npx vitest run src/utils/syncUtils.regression.test.ts` |
| `SyncService.ts` / firestore sanitize / storage keys | `npx vitest run src/utils/firestoreUtils.test.ts src/utils/storageUtils.test.ts` |
| Food log dedupe | `npx vitest run src/utils/foodLogDedupe.test.ts` |
| Image sync / R2 / backlog B11 | `npx vitest run src/utils/firestoreUtils.test.ts` (or relevant tests) |
| Jobs / Supabase job sync | `npx vitest run src/jobs/__tests__/JobStore.test.ts src/jobs/__tests__/mergeFoodEditMessages.test.ts` |
| Job session / preview / edit-in-flight (`STALE_TURN`) | `npx vitest run src/jobs/__tests__/JobStore.test.ts src/jobs/__tests__/mergeFoodEditMessages.test.ts src/jobs/__tests__/JobSession.contract.test.ts` · `node scripts/assert-dev-serves-vite.mjs` |
| Job **process** golden / debug contract (Q-8, F-8.13) | Law: `docs/agent/domains/debug-contract.md`. `npx vitest run tests/foodProcess.golden.test.ts tests/bioProcess.golden.test.ts tests/deskProcess.golden.test.ts src/utils/dumpContract.test.ts src/utils/debugPayload.test.ts server_gemini_retry.test.ts serverJobs_publish.test.ts src/jobs/__tests__/JobStore.test.ts src/jobs/__tests__/JobQueueRunner.test.ts src/jobs/__tests__/JobSession.contract.test.ts server_sse_json.test.ts` · `npx tsx scripts/test-from-debug.ts` on the capture if one exists |
| Login / identity | Relevant tests for login/identity |

**Sync smoke:**

```bash
npx vitest run src/utils/syncUtils.regression.test.ts src/utils/foodLogDedupe.test.ts src/utils/firestoreUtils.test.ts
```

Treat silent changes to tombstone / merge semantics as **class X**.

---

## Agent process / governance

| If you touch… | Run |
|---------------|-----|
| `AGENTS.md` / `docs/agent/**` (only with confirmation) | `node scripts/assert-agent-governance.mjs` |
| Sync/biomarker/food regression foundation files | Same smoke suites as domain sections above |
| Bot memory stores (`scripts/lib/memory-stores.mjs`, `scripts/assert-memory-stores.mjs`) | `node scripts/assert-memory-stores.mjs` · `npx vitest run tests/memory-stores.test.ts` |
| Bot run ledger (`scripts/lib/run-ledger.mjs`, `scripts/assert-run-ledger.mjs`, `run-coding-dispatch.sh` ledger hooks) | `node scripts/assert-run-ledger.mjs` · `npx vitest run tests/run-ledger.test.ts` |
| Bot souls (`bots/soul*.md`, `scripts/lib/soul-compose.mjs`, `scripts/assert-soul-compose.mjs`) | `node scripts/assert-soul-compose.mjs` · `npx vitest run tests/soul-compose.test.ts` |
| Bot lane contract (`scripts/lib/lane-contract.mjs`, `scripts/assert-lane-contract.mjs`) | `node scripts/assert-lane-contract.mjs` · `npx vitest run tests/lane-contract.test.ts` |

## Bugs / triage tooling

| If you touch… | Run |
|---------------|-----|
| Bug snapshot / domain packs | `npx vitest run src/utils/bug*.test.ts` (or relevant tests) |

---

## Always when TypeScript sources change

```bash
npx tsc --noEmit
```

Skip only for pure markdown/docs edits (state reason in GATE LOG).

---

## Adding a new map row

When you stabilize a domain with new tests, **add a row here in the same PR**.  
Gate growth is how rulebooks stay real; prose alone is not enough.
