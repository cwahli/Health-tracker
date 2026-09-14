# Master Scorecard — Health-tracker

**Purpose:** one PASS/FAIL board by product area, **plus a ratchet for bugs that took >3 fix iterations or came back after green.** Living document — do not delete a red or ratchet row to look green.

**As of:** 2026-09-14 (folder v4: `golden/scorecard/{instruction,current,past,result_summary}`).  
**How this v3 board was built:** review of ROADMAP / QUALITY / FOOD / standing / learnings / prototypes / `golden/meal` / GitHub PRs #1–#5 / git history of restores, wipes, and re-fixes. Named reds re-verified. Did **not** run `npm test`.

**Process:** [`README.md`](./README.md) · [`WORKFLOW.md`](./WORKFLOW.md) · [`gates.json`](./gates.json)  
**Sister files:** [`../../past/SCOREBOARD_LIVE_RESULTS.md`](../../past/SCOREBOARD_LIVE_RESULTS.md) · [`i18n/GATE_I18N_A11Y_TREE.md`](./i18n/GATE_I18N_A11Y_TREE.md) · [`../../../plan/ROADMAP.md`](../../../plan/ROADMAP.md) · [`../../../docs/agent/DOMAIN_REGRESSION_MAP.md`](../../../docs/agent/DOMAIN_REGRESSION_MAP.md) · [`../../../docs/agent/standing.json`](../../../docs/agent/standing.json)

**Live origin:** `https://health-tracker-backend-64gt.onrender.com` — `GET /api/scorecard/contract` must echo frozen inventories. Local green is not live green.

**This moment:** [`../../current/MASTER_SCORECARD_DEBUG.md`](../../current/MASTER_SCORECARD_DEBUG.md) · [`../../current/MASTER_SCORECARD_DEBUG.json`](../../current/MASTER_SCORECARD_DEBUG.json). Contract table first. Skip is not PASS. Cite **all green** only from [`../../result_summary/LATEST.md`](../../result_summary/LATEST.md) after exit 0.

Refresh:

```
npm run scorecard:debug
```

Until `6c25141`, `npm test` also executed Playwright specs and printed **18 fake FAIL files**. Fixed in `vite.config.ts` (`**/prototype/tests/**` excluded).

---

## OVERALL VERDICT: **NOT ALL GREEN**

Dump (`current/MASTER_SCORECARD_DEBUG.md`, as of `d105b0c` work): **666 pass / 1 fail**. Trust that dump over this table if they diverge. `result_summary/` empty until exit 0.

| Area | Inner | Live / E2E | Verdict |
|---|---|---|---|
| Localization | `closeDialog`/`modalDialog`/`analyzingMeal` in packs; **242 `t()` callsite keys** still missing | J-ID debug-contract LIVE PASS; Gate I18N-A11Y **never run** | ⚠️ INCOMPLETE + ratchet |
| Meal Log | portion, polarity, goldens, same-meal **PASS**; **`SINGLE_DISH_FLATTEN`** now gated (Mie Ayam unroll) | 3 Indo journeys happy-path; live `job_1789414917685` was 1 nested dish | ⚠️ inner green after unroll fix; live re-soak not done |
| Compare | named units PASS | J-ID-02 LIVE PASS (wrong fixtures); 6-case spec untracked | ⚠️ PARTIAL + ratchet |
| Biomarkers | G-B1–G-B9 fixtures restored; **0 skip** | zero Playwright; B0 Apply is Current work | ⚠️ units green; live Apply not done |
| Receptionist | 5 named files PASS | stub specs only | ⚠️ PARTIAL |
| Reliability | scorer + tsc + Guard + live contract **PASS**; `LOAD_HACK` ratchet | photo-sync untested; Render commit may lag HEAD | ⚠️ structural green; second-device untested |

---

## Recurrence table — >3 iterations **or** fixed-then-reappeared

Rule for this table: count **distinct fix commits / documented retries**, not chat turns. Conservative. **On scorecard?** = keep a permanent area row (even if currently green) so the class cannot vanish.

| Class | What it is | Iterations (evidence) | Reappeared after green? | Now | **On master scorecard?** |
|---|---|---|---|---|---|
| `TRANSLATION_DUMP` / `LEAK_KEY` / `LEAK_EN_CHROME` | `translations.ts` bulk overwrite drops keys; UI shows raw camelCase | **≥8 restores:** `bca0f80` wipe → `893d938` revert (S-7/8/9); `eeee07f` +263 keys; `fe61818` +10; `1bb0600` wipe → `2d6f78a` restore 277 **including `closeDialog`/`modalDialog`**; `d5a600e` gut (650-line delete + 4 `fix_translations*.cjs`) → `ff9d543` restore; `9848619` Home portal; `bfe5964` Food History overlay; `80c1911` auth placeholders; `f729298` quota copy (PR #3) | **Yes, repeatedly.** Every large “refactor/update translations” commit. `closeDialog` was restored in `2d6f78a` and is **gone again** in HEAD. | 🔴 AppModal still red; parity test cannot see keys that are absent from both locales | **YES — Localization #1.** Leftover-string list must include `closeDialog` / `modalDialog` so the next dump cannot hide them. |
| `PORTION_FUNNEL` | ask vs adopt (stated grams, half-pack, overflow) | **≥6:** Bug #9 visual-source `30d5b2c`; servings-not-whole-pack `f86acde`; WRONG_BASIS 1g **PR #1** `c3e6cfd`; S-10 funnel `6669d81` + live cases `c277817` (**ROADMAP marked COMPLETE 2026-09-12**); bulk-pack follow-up `158dc14` (edits `server_portion_clarify.ts` + `quantityText.ts`) | **Yes.** S-10 COMPLETE then 4 tests inverted (ask/adopt swapped) on 2026-09-14 re-run. Likely broken by `158dc14`. | 🔴 4 failing assertions | **YES — Meal Log product red.** Do not paint expects. |
| `SAME_MEAL_PACKAGE_PREPARED` | 3 photos of one oats meal → 2 dishes; “combine them” missed | Prior `merge_dishes` + closed regex; live `job_1789312118652` came back; TS collapse + standing `588154c` | **Yes.** User: “this bug was fixed before and reappeared.” Learner: no standing row, so the class returned. | ✅ standing `same_meal_package_prepared` | **YES — green ratchet.** Never drop the needles. |
| `NUTRIENT_POLARITY` / Home Top Targets | sat fat over target shown green; snake_case vs camelCase; Home `includes` of undefined | Unify `4eefd94`; rolling-average `429ebbb`; Home crash `4a9f129`; polarity `588154c`; restore core keys `ff9d543` (**5 commits**) | **Yes.** Unify shipped, then sat fat still green because lists used `saturatedFat` and coach sent `saturated_fat`. | ✅ `isLimitNutrient` centralized | **YES — Home / Meal Log ratchet.** Gate: `nutrients.test.ts`. |
| `CROSS_DEVICE_SYNC` / `DISPLAY_DUP` | photo placeholder; dup images; D1 sync_state | unique-by-key (Sync only) then Log `data:`+`/photos/` (`meal_image_unique` learning); R2 `cc6676d`; placeholder→URL **PR #2** `40dd6ca`; D1 push `bfea1f5`; sync_state `1527549` | **Yes.** First image fix tested on Sync, user still saw dups on Log. Photo still has **no second-device test**. | ⚠️ product claimed fixed; class untested | **YES — Reliability structural.** Highest-leverage new test. |
| `COMPARE_MODE_D` | empty-success shelf, narrator fabricating logs, groups not on poll path, i18n | **≥6:** `75e1492` empty-success; `22db946` groups + never fabricate logs; `4a519ea` no narrator; `93a49c1` grouping template; `99141d8` zoom/normalize; `1558901` copy + target cards | Series of the same Mode D path, not one-and-done | ⚠️ unit thin; 6-case spec untracked; J-ID-02 used Silverqueen not the 6-set | **YES — Compare.** Gate = 6-case spec + standing `food_compare`. |
| `GOLDEN_FIXTURE_ROT` | `bca0f80` (144 files) deleted golden assets; S-9 restored **only** translations | Deleted `tests/Golden_meal/{1–8}` expected/photos, **entire** `tests/Golden_biomarker/examples/G-B1…G-B9`, compare dirs. Manifest still lists G1–G9. | **Yes.** Suite was green, then collection crash / skip-pass. Never restored (blast-radius note in ROADMAP S-9). | 🔴 `golden_meals.test.ts` ENOENT; biomarker goldens **skip-pass** | **YES — both Meal Log and Biomarkers.** Restoring fixtures is a class, not a side quest. |
| `USDA_FDC_OVERWRITE` | live FDC ranked into Analyze | F-1/F-2 “fix USDA” abandoned after 50-meal audit; F-12.1–12.4 delete (`4cef1e5`, `89358ed`, `fc51180`) | Product direction reversed (keep → delete). Residual: `golden_meals` still asserts `expectFdcId`. | ✅ FDC HTTP gone; local staple table numbers only | **YES as do-not-reopen ratchet**, not an open bug. Do not restore FDC to make old locks pass. |
| `I18N_A11Y_UNRUN` | a11y-tree gate to catch leftover English chrome | Gate defined; specs wired `f372e85`; helper rewritten `b8f91d1` (Playwright 1.62 removed `page.accessibility`); repaired `d7f5216` — **3 commits in one day**, still no `_live_a11y/` | Helper **broke immediately** after rewrite (reappeared as a crash, not a chrome leak) | 🔴 never run live | **YES — Localization.** Journeys are not complete until checklist rows are PASS. |
| `GOLDEN_SCORER_DRIFT` | Golden inbox `scoreGoldenRun` / title / blob-split | Drift lands in `d5a600e` (same commit that gutted translations **and** edited `goldenScoreboard.ts`) | Unknown prior green; currently deterministic red | 🔴 3 tests | **YES — Reliability/Quality.** Not the Settings “Food & Venues % logs” tile (`Header.tsx` `sync_state`). |
| `VERDICT_CORRUPT` | `[object Object]` D1 verdicts; false default “Good” | `fe61818` false Good + 10 keys; `9ff1da2` D1 serialize/self-heal; `9252233` OCR sat-fat + preserve verdict | Related class hit more than once (default vs serialize vs OCR) | claimed fixed | **YES — Meal Log ratchet.** Named tests must keep a non-string verdict from rendering. |
| `STALE_TURN` / stuck job card | preview shows previous turn; contradictory card states | F-9.1–9.5 series + `c79a448` stuck card + `334befc` contradictory states | Recurring job-lifecycle class (`8742686` is the blast-radius FAIL example in AGENTS) | F-9.5 shipped; flags still exist as fallback | **YES — Reliability ratchet.** Gate: `JobSession.contract.test.ts`. Do not mix with food-calc. |
| `KCAL_ONE_WRITER` | agent-emitted calories vs `finalizeDishLedger` | F-8 whole track + F-10.2 Atwater; standing row | Architecture was rebuilt because the class kept returning | ✅ standing | **YES — Meal Log ratchet** (standing already). |
| `APPLY_MISS` / B0 converts | HDL 50→1.293 etc. not applied to Home | B0 is Current work; G-B1 fixtures **deleted** so the outer lock is skip-pass | N/A (never proven live) | ⚠️ Current work | **YES — Biomarkers.** Do not treat skip-pass as G-B1 green. |
| Credits / admin quota 0 | Admin `NaN`/0; quota copy `\n\n` | PR #3 + PR #4 (**2**, not >3) | No | ✅ `creditManager.test.ts` | **Thin yes** — keep the known-fixed row; not a ratchet driver. |
| Deploy git-hash in Settings | Docker has no `.git` | `0d40406` `7093718` `613aa03` `eebbdc8` `930f0aa` `f12b296` (**>3**) | Infra churn | ops | **NO** on the product scorecard. Not a patient-facing class. |
| Track L-2–L-5 leftovers | 1 serving / Preparation: / diagnostic logs | Parked 2026-09-02 | Parked, not a reappear | parked | **NO as open work.** Mention under Localization leftovers only. Do not unpark. |

GitHub PRs on `cwahli/Health-tracker` (all closed with merge timestamps): **#1** portion WRONG_BASIS · **#2** photo second-device · **#3** quota copy · **#4** admin quota · **#5** scorecard + vitest exclude.

---

## Classes currently red (work items)

| Class | Area | Kind | Named gate |
|---|---|---|---|
| `LEAK_KEY` | Localization | 242 `t()` callsites missing from packs (chrome keys `closeDialog`/`modalDialog` restored) | `npm run scorecard:debug` law `i18n_required_chrome` |
| `I18N_A11Y_UNRUN` | Localization | `current/a11y/` empty | live Playwright, quota |
| `CROSS_DEVICE_SYNC` | Reliability | no second-device test | none yet |
| `SINGLE_DISH_FLATTEN` | Meal Log | live Mie Ayam stayed 1 nested dish; inner unroll now gated | `npx vitest run server_vision_scout.test.ts` (J-ID-01 / G8 journey, not a new pack) |

---

## Ordered actions

Gemini Current work remains **B0**. Do **not** start F-11.2, Q-9, Track L-2–L-5, or USDA.

| # | Do | Why it is next | Done when |
|---|---|---|---|
| **1–5** | i18n chrome keys, portion restore, G-B fixtures, meal goldens, scorer | `d105b0c` | inner gates green in dump |
| **6** | `SINGLE_DISH_FLATTEN` (this change) | live Mie Ayam nested 4 foods in 1 dish | `server_vision_scout.test.ts` Mie Ayam case green; standing `single_dish_flatten` |
| **7** | Remaining 242 `t()` callsite keys | last Localization inner fail | `i18n_required_chrome` PASS |
| **8** | Run Gate I18N-A11Y live | 3 helper commits, still unsoaked | `current/a11y/` + checklist all PASS |
| **6** | Run Gate I18N-A11Y live; fill `_live_a11y/` | 3 helper commits, still unsoaked | SCOREBOARD_LIVE_RESULTS checklist all PASS |
| **7** | Second-device sync named test | Class that beat unique-by-key and PR #2 | fresh JobStore sees R2/`/photos/` URL |
| **8** | Record Meal_03 6-case + Meal_04 live specs | Compare/log benches exist and are untracked | PASS/FAIL + date in §E2E |
| **9** | B0 Apply smoke (Gemini) | Current work; locked converts | HDL 1.293 / TG 1.411 / LDL 3.362 / creat 79.56 / bili 13.68 on Home |

**Human ops:** deploy current `main`; confirm sat fat over target is red. Brand `status` migration `20260913_brand_menu_items_status.sql` is **cited in ROADMAP but not in the repo** (`supabase/` has no that file) — recover or apply by hand before claiming F-11.1 live.

---

## Prototype vs production (do not confuse the two)

| Surface | Role | Status |
|---|---|---|
| `prototype/biomarkers/` C1–C7 | Fill-template SoT. Keep green **before** more production modal wiring. | `AI_HANDOVER` claims 100%. Gate: `scripts/assert-biomarker-cases.mjs`. **Not** a substitute for deleted G-B1–G-B9. |
| `prototype/meallog/meal/` 11-case 1-vs-2 agent | Evidence that F-10 single Meal Agent (`diet`) + TS Atwater matched 2-agent. Fat residual on 1/4/9 is named, not 90%. | Production cutover F-10.7 shipped. Outer soak = Q-8.6 / F-10.8. |
| `prototype/meallog/compare/` 6 sets | Mode D scout-only compare harness + images + `perfect_output_setN.json`. | Production standing `food_compare`. Live J-ID-02 did **not** run this matrix. |
| `prototype/receptionist/` UC-01–10 | Front-desk use cases. | Unit `handoffContract` driven by UC JSON. Live specs are stub. Do not 10-case click-through. |
| `prototype/tests/*.spec.ts` | Playwright only. | Vitest must stay excluded. |

`golden/meal/` is the meal **source of truth** (Meal_01…04). Prototype is harness. Builder must not author and score the same live A/B (`builder_ne_tier3_ab_scorer`).

---

## Golden inventory (honest)

### Meal log — `golden/meal/Meal_04_log` (Mode A)

7 cases from prototype 01/02/06/08/09/10/11. Learning `golden-meal-suite-20260911.md`: stay **DRAFT** until a 32-key ledger exists (only 6–8 macros in prototype). Dual-GT conflict on case 11 stays on record.

| Case | Contract | Known residual (from `benchmark_result.md`) |
|---|---|---|
| 01 Yolk / 02 Lidl / 06 menu / 08 oats / 09 plates | contract PASS on 2026-09-10 soak | 31-key incomplete; brand bind not asserted |
| **10 barcode hotpot** | rerun contract PASS | **FAIL continuity** — live 1–2 dishes vs GT 5 |
| **11 seafood + oats** | contract PASS | **under-extract** — live 2 vs GT 6 |

### Compare — `golden/meal/Meal_03_compare` (Mode D)

2026-09-09 bench claims 6/6 evaluated, 243 dishes, 96.2% recall on 104-item menu. **Not** the same as J-ID-02 (Silverqueen). Specs `compare-mode-six-cases.spec.ts` + `meal03-compare-benchmark.spec.ts` are **UNTRACKED** on this board.

### Layer B — `tests/Golden_meal/`

Manifest lists G1–G9. On disk: dirs 1, 2, 4, 9 (only **9** has `expected.json`). 3/5/6/7/8 deleted in `bca0f80`. `golden_meals.test.ts` crashes at collection and still wants `expectFdcId` (stale vs F-12.4).

### Biomarkers — `tests/Golden_biomarker/`

**Directory missing.** `bca0f80` deleted G-B1…G-B9 examples. `tests/golden_biomarker.test.ts` does `if (!exists) it.skip('missing directory')` then the file **PASSES**. Convert locks in the remaining 4 tests still check `ANALYTE_CONVERSIONS` (good) but G-B class goldens are not running.

---

## 1. Localization

**Named gates**

```
npx vitest run src/utils/i18n.test.ts agents/dietitianInstructions.i18n.test.ts src/utils/auditEngine.i18n.test.ts src/components/chat-cards/ReceptionistCard.i18n.test.tsx src/components/ui/AppModal.test.tsx
```

| Check | Status | Evidence |
|---|---|---|
| Frozen leftover chrome | 🔴 independent of vitest skip | `instruction/i18n/REQUIRED_CHROME.json` parsed from `translations.ts` text. Missing `closeDialog`/`modalDialog`; `analyzingMeal` id is English-filled `"Analyzing Meal"`. |
| `t()` callsite keys | 🔴 244 keys used in `src/`/`agents/` missing from both packs (raw camelCase in UI) | `current/i18n_callsite_missing.json` — parity cannot see these |
| en/id key parity | PASS for keys that exist. Absent keys are invisible to parity — **not sufficient**. | `i18n.test.ts` |
| `AppModal` close | 🔴 `aria-label="closeDialog"` | `AppModal.test.tsx`; keys never in `localePacks` (`a3e8087` introduced the `t()` call) |
| J-ID-01/02/03 debug-contract | LIVE PASS | `SCOREBOARD_LIVE_RESULTS.md` |
| Gate I18N-A11Y | 🔴 NEVER RUN; helper rewritten then repaired | `_live_a11y/` missing |
| Persona | **P-ID-WL-01 F18 / 140 cm / 40 kg / 1350 kcal**. Consolidation 58kg/age42 is stale | live-results header |
| Planned Indo dish photos | never added; live used oats / Silverqueen | FIXTURE NOTE |
| Track L-2–L-5 | parked | ROADMAP |

Ratchet: `TRANSLATION_DUMP` (table above). Next: actions #1 then #6.

---

## 2. Meal Log

**Named gates**

```
npx vitest run server_portion_clarify.test.ts server_vision_scout.test.ts server_edit_patch_ledger.test.ts server_derivation.test.ts server_dish_finalize.test.ts src/utils/nutrients.test.ts src/utils/nutritionTargetStatus.test.ts src/components/NutrientPieChart.test.tsx
```

| Check | Status | Evidence |
|---|---|---|
| S-10 portion funnel | PASS after `d105b0c` restore | `quantityText.ts` + `server_portion_clarify.test.ts` |
| Home polarity | PASS + ratchet | `isLimitNutrient`; `nutrients.test.ts` |
| Same-meal package+prepared | PASS + standing | `588154c` |
| **Single-dish flatten** | INNER GATE (was live FAIL `job_1789414917685`) | `server_vision_scout.test.ts` Mie Ayam unroll; J-ID-01 + G8. Sole dish with `foods[]` must become top-level items + `boundingBox2D` for zoom |
| F-12 USDA | shipped / do-not-reopen | F-12.1–12.4 |
| F-10.7 expand | ⚠️ helper exists, **not on analyze hot path** | `shouldExpandMealAgent` is unit-tested and exported from `src/mealBuild/`; no import from `server_food_analyze_run*.ts`. Complex meals do not spawn workers yet. Do not copy prototype DELEGATE. |
| Layer B goldens | PASS collect | restored G1–G9; identity/lock fixtures, not 32-key ledgers |
| Meal_04 live 10/11 | under-extract / continuity fail | `golden/meal/Meal_04_log/benchmark_result.md` |
| Verdict serialize | claimed fixed | `9ff1da2` |
| kcal one writer | standing | `finalizeDishLedger` |

Ratchets: `PORTION_FUNNEL`, `SAME_MEAL_PACKAGE_PREPARED`, `SINGLE_DISH_FLATTEN`, `NUTRIENT_POLARITY`, `KCAL_ONE_WRITER`, `VERDICT_CORRUPT`, `GOLDEN_FIXTURE_ROT`.

---

## 3. Compare

**Named gates**

```
npx vitest run src/utils/compareMealLogGuard.test.ts src/server/food/journeyFingerprints.test.ts src/server/food/server_food_scout_source.test.ts
node scripts/journey-guard.mjs
```

| Check | Status | Evidence |
|---|---|---|
| compareMealLogGuard | PASS | named vitest |
| standing `food_compare` | protected | `allExtractedDishes`, EVALUATION ONLY |
| J-ID-02 | LIVE PASS happy path, wrong fixtures | Silverqueen not Meal_03 set3 menu |
| 6-case + benchmark specs | UNTRACKED | `prototype/tests/` |
| Mode D narrator / empty-success | claimed fixed after 6 commits | do not reintroduce narrator on compare |

Ratchet: `COMPARE_MODE_D`. Do not merge compare and log packs.

---

## 4. Biomarkers

**Named gates** (ROADMAP Current work)

```
npx tsc --noEmit
node scripts/assert-biomarker-lifecycle-m31.mjs
npx vitest run src/utils/biomarkerLifecycle.test.ts src/utils/biomarkerIdentity.test.ts src/utils/biomarkerSanitize.test.ts tests/bioProcess.golden.test.ts tests/golden_biomarker.test.ts
```

| Check | Status | Evidence |
|---|---|---|
| Lifecycle / identity / sanitize helpers | PASS | named vitest |
| `tests/golden_biomarker.test.ts` | ⚠️ **file PASS, 9 skipped** | dir missing; skip is not G-B1 green |
| Prototype C1–C7 | claimed 100% | `scripts/assert-biomarker-cases.mjs` |
| B0 Apply smoke | Current work | locked `1.293` / `1.411` / `3.362` / `79.56` / `13.68` |
| Live E2E | ZERO | no Playwright spec |
| B7.4 pending store | not started | after B0 |
| B8.1 convertViaTable only | shipped | Grok |

Ratchets: `GOLDEN_FIXTURE_ROT`, `APPLY_MISS`. Next for Gemini: B0, not a new journey. Next for scorecard honesty: action #3.

---

## 5. Receptionist

**Named gates**

```
npx vitest run src/server/receptionist/handoffContract.test.ts src/server/receptionist/jsonSanitize.test.ts src/utils/frontDeskRouting.test.ts src/utils/handoffGuard.test.ts tests/deskProcess.golden.test.ts
```

| Check | Status | Evidence |
|---|---|---|
| Named units | PASS | |
| UC specs | stub, not `.live.spec.ts` | |
| Desk turns on J-ID-01/03 | indirect, some `expect.soft` | |
| S-6 handoff i18n | landed | UC JSON |

No >3-iteration receptionist class found in recent history. Keep the area board; do not 10-case live UC.

---

## 6. Reliability

**Named gates**

```
npx vitest run src/jobs/__tests__/JobStore.test.ts src/jobs/__tests__/JobSession.contract.test.ts src/jobs/__tests__/SupabaseJobSync.coalesce.test.ts src/utils/creditManager.test.ts src/utils/dumpContract.test.ts src/utils/syncUtils.regression.test.ts src/utils/goldenScoreboard.test.ts src/utils/foodImageSources.test.ts server_auth.test.ts
node scripts/journey-guard.mjs
```

| Check | Status | Evidence |
|---|---|---|
| Vitest vs Playwright exclude | fixed `6c25141` | |
| golden scorer | 🔴 | `d5a600e` edited the engine |
| Job session / STALE_TURN | shipped + ratchet | `JobSession.contract.test.ts` |
| Credits | PASS | PR #4 |
| Debug / dump contract | PASS | |
| `storageUtils.test.ts` | **missing** (deleted `bca0f80`) | S-5/S-9 note |
| Cross-device | no test | PR #2 product-only |
| Guard / standing | must grow, never shrink | including `same_meal_package_prepared` |

Ratchets: `CROSS_DEVICE_SYNC`, `STALE_TURN`, `GOLDEN_SCORER_DRIFT`, `meal_image_unique`.

---

## E2E inventory (`prototype/tests/`)

`npx playwright test <spec>` only.

| Spec | Area | Scorecard |
|---|---|---|
| `indo-j-id-01-e2e.live.spec.ts` | Loc + Meal | LIVE PASS debug; I18N-A11Y NOT COVERED |
| `indo-j-id-02-e2e.live.spec.ts` | Loc + Compare | LIVE PASS debug; wrong fixtures; I18N-A11Y NOT COVERED |
| `indo-j-id-03-e2e.live.spec.ts` | Loc + Meal edit | LIVE PASS debug; I18N-A11Y NOT COVERED |
| `signup-onboard-wl.live.spec.ts` | Loc / auth | UNTRACKED |
| `meal01-golden.live.spec.ts` | Meal_01 | UNTRACKED |
| `multiturn-meal-edit.live.spec.ts` | Meal | UNTRACKED |
| `portion-clarify.live.spec.ts` / `portion-funnel.spec.ts` | Portion | UNTRACKED (inner vitest is the S-10 gate) |
| `armC-meal02.spec.ts` | Meal_02 | UNTRACKED |
| `compare-mode-six-cases.spec.ts` / `meal03-compare-benchmark.spec.ts` | Compare 6-set | UNTRACKED |
| `receptionist-*.spec.ts` | Receptionist | stub |
| `dialog-inventory.spec.ts` | Q-8.3 | S-7 green 2026-09-12 |
| `key-journeys.spec.ts` / `r3-smoke.spec.ts` | shell / leftover-English | untracked here |
| `example.spec.ts` | — | ignore |

---

## Standing rule

Hand-found bug:

1. Fix the **class**.
2. Named vitest (and standing needle if it reappeared or took >3 tries).
3. Row in the **recurrence table** if it reappeared or took >3 tries; row in the area board either way.
4. Grow `docs/agent/standing.json` via Learner / **promote**. Never drop a needle to pass Guard.

`bca0f80` is the canonical PROCESS_GAP: a 144-file “stability” commit that wiped translations, goldens, biomarker examples, and `storageUtils.test.ts`. S-7/8/9 restored chrome only. The rest of that blast is why this scorecard exists.
