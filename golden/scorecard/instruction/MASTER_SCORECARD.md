# Master Scorecard — Health-tracker

**Purpose:** one PASS/FAIL board by product area, **plus a ratchet for bugs that took >3 fix iterations or came back after green.** Living document — do not delete a red or ratchet row to look green.

**As of:** 2026-09-15 (folder v4: `golden/scorecard/{instruction,current,past,result_summary}`). Sealed ALL GREEN 705/0/0 at `3ff047d` — see `../result_summary/LATEST.md`.  
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

## OVERALL VERDICT: **ALL GREEN**

Dump (`current/MASTER_SCORECARD_DEBUG.md`, sealed 2026-09-15): **707 pass / 0 fail / 0 skip**. Sealed copy: `../result_summary/LATEST.md` (exit 0). Trust that dump over this table if they diverge.

| Area | Inner | Live / E2E | Verdict |
|---|---|---|---|
| Localization | `closeDialog`/`modalDialog`/`analyzingMeal` in packs; L-2/L-4 callsite packs restored | J-ID debug-contract LIVE PASS; Wave K J-ID-01 I18N-A11Y soak evidence archived (`current/a11y/`) | ✅ PASS (sealed) + ratchet |
| Meal Log | portion, polarity, goldens, same-meal, single-dish-flatten **PASS** | 3 Indo journeys happy-path; J-ID-01 live PASS | ✅ PASS (sealed) |
| Compare | named units PASS | J-ID-02 LIVE PASS (wrong fixtures); 6-case spec untracked (residual) | ✅ PASS (sealed) + ratchet |
| Biomarkers | G-B1–G-B9 fixtures restored; **0 skip** | B0 Apply CLOSED 2026-09-14; zero Playwright (residual) | ✅ PASS (sealed) |
| Receptionist | 5 named files PASS | stub specs only (residual) | ✅ PASS (sealed) |
| Reliability | scorer + tsc + Guard + live contract + CROSS_DEVICE_SYNC **PASS**; `LOAD_HACK` ratchet | live contract PASS sealed; second-device sync tested in JobStore.test.ts; Render commit now matches HEAD seal | ✅ PASS (sealed) |

---

## Recurrence table — >3 iterations **or** fixed-then-reappeared

Rule for this table: count **distinct fix commits / documented retries**, not chat turns. Conservative. **On scorecard?** = keep a permanent area row (even if currently green) so the class cannot vanish.

| Class | What it is | Iterations (evidence) | Reappeared after green? | Now | **On master scorecard?** |
|---|---|---|---|---|---|
| `TRANSLATION_DUMP` / `LEAK_KEY` / `LEAK_EN_CHROME` | `translations.ts` bulk overwrite drops keys; UI shows raw camelCase | **≥8 restores:** `bca0f80` wipe → `893d938` revert (S-7/8/9); `eeee07f` +263 keys; `fe61818` +10; `1bb0600` wipe → `2d6f78a` restore 277 **including `closeDialog`/`modalDialog`**; `d5a600e` gut (650-line delete + 4 `fix_translations*.cjs`) → `ff9d543` restore; `9848619` Home portal; `bfe5964` Food History overlay; `80c1911` auth placeholders; `f729298` quota copy (PR #3) | **Yes, repeatedly.** Every large “refactor/update translations” commit. `closeDialog` was restored in `2d6f78a`, gone again at that HEAD, and restored again — sealed PASS 2026-09-15. | ✅ chrome keys sealed green (`i18n_required_chrome` PASS); ratchet stays | **YES — Localization #1.** Leftover-string list must include `closeDialog` / `modalDialog` so the next dump cannot hide them. |
| `PORTION_FUNNEL` | ask vs adopt (stated grams, half-pack, overflow) | **≥6:** Bug #9 visual-source `30d5b2c`; servings-not-whole-pack `f86acde`; WRONG_BASIS 1g **PR #1** `c3e6cfd`; S-10 funnel `6669d81` + live cases `c277817` (**ROADMAP marked COMPLETE 2026-09-12**); bulk-pack follow-up `158dc14` (edits `server_portion_clarify.ts` + `quantityText.ts`) | **Yes.** S-10 COMPLETE then 4 tests inverted (ask/adopt swapped) on 2026-09-14 re-run. Likely broken by `158dc14`; restored in `d105b0c`. | ✅ PASS sealed (705 green 2026-09-15) | **YES — Meal Log product red.** Do not paint expects. |
| `SAME_MEAL_PACKAGE_PREPARED` | 3 photos of one oats meal → 2 dishes; “combine them” missed | Prior `merge_dishes` + closed regex; live `job_1789312118652` came back; TS collapse + standing `588154c` | **Yes.** User: “this bug was fixed before and reappeared.” Learner: no standing row, so the class returned. | ✅ standing `same_meal_package_prepared` | **YES — green ratchet.** Never drop the needles. |
| `NUTRIENT_POLARITY` / Home Top Targets | sat fat over target shown green; snake_case vs camelCase; Home `includes` of undefined | Unify `4eefd94`; rolling-average `429ebbb`; Home crash `4a9f129`; polarity `588154c`; restore core keys `ff9d543` (**5 commits**) | **Yes.** Unify shipped, then sat fat still green because lists used `saturatedFat` and coach sent `saturated_fat`. | ✅ `isLimitNutrient` centralized | **YES — Home / Meal Log ratchet.** Gate: `nutrients.test.ts`. |
| `CROSS_DEVICE_SYNC` / `DISPLAY_DUP` | photo placeholder; dup images; D1 sync_state | unique-by-key (Sync only) then Log `data:`+`/photos/` (`meal_image_unique` learning); R2 `cc6676d`; placeholder→URL **PR #2** `40dd6ca`; D1 push `bfea1f5`; sync_state `1527549` | **Yes.** First image fix tested on Sync, user still saw dups on Log. Photo still has **no second-device test**. | ⚠️ product claimed fixed; class untested | **YES — Reliability structural.** Highest-leverage new test. |
| `COMPARE_MODE_D` | empty-success shelf, narrator fabricating logs, groups not on poll path, i18n | **≥6:** `75e1492` empty-success; `22db946` groups + never fabricate logs; `4a519ea` no narrator; `93a49c1` grouping template; `99141d8` zoom/normalize; `1558901` copy + target cards | Series of the same Mode D path, not one-and-done | ⚠️ unit thin; 6-case spec untracked; J-ID-02 used Silverqueen not the 6-set | **YES — Compare.** Gate = 6-case spec + standing `food_compare`. |
| `GOLDEN_FIXTURE_ROT` | `bca0f80` (144 files) deleted golden assets; S-9 restored **only** translations | Deleted `tests/Golden_meal/{1–8}` expected/photos, **entire** `tests/Golden_biomarker/examples/G-B1…G-B9`, compare dirs. Manifest still lists G1–G9. | **Yes.** Suite was green, then collection crash / skip-pass. Restored 2026-09-14/15 (blast-radius note in ROADMAP S-9 stands as history). | ✅ fixtures restored; sealed 0 skip, collection PASS | **YES — both Meal Log and Biomarkers.** Restoring fixtures is a class, not a side quest. |
| `USDA_FDC_OVERWRITE` | live FDC ranked into Analyze | F-1/F-2 “fix USDA” abandoned after 50-meal audit; F-12.1–12.4 delete (`4cef1e5`, `89358ed`, `fc51180`) | Product direction reversed (keep → delete). Residual: `golden_meals` still asserts `expectFdcId`. | ✅ FDC HTTP gone; local staple table numbers only | **YES as do-not-reopen ratchet**, not an open bug. Do not restore FDC to make old locks pass. |
| `I18N_A11Y_UNRUN` | a11y-tree gate to catch leftover English chrome | Gate defined; specs wired `f372e85`; helper rewritten `b8f91d1` (Playwright 1.62 removed `page.accessibility`); repaired `d7f5216` — **3 commits in one day**; Wave K J-ID-01 soak evidence archived 2026-09-15 | Helper **broke immediately** after rewrite, then repaired; full checklist still partial | 🟡 Wave K J-ID-01 evidence in `current/a11y/` | **YES — Localization.** Journeys are not complete until checklist rows are PASS. |
| `GOLDEN_SCORER_DRIFT` | Golden inbox `scoreGoldenRun` / title / blob-split | Drift lands in `d5a600e` (same commit that gutted translations **and** edited `goldenScoreboard.ts`); engine restored 2026-09-14 | Unknown prior green; was deterministic red, now sealed green | ✅ PASS sealed | **YES — Reliability/Quality.** Not the Settings “Food & Venues % logs” tile (`Header.tsx` `sync_state`). |
| `VERDICT_CORRUPT` | `[object Object]` D1 verdicts; false default “Good” | `fe61818` false Good + 10 keys; `9ff1da2` D1 serialize/self-heal; `9252233` OCR sat-fat + preserve verdict | Related class hit more than once (default vs serialize vs OCR) | claimed fixed | **YES — Meal Log ratchet.** Named tests must keep a non-string verdict from rendering. |
| `STALE_TURN` / stuck job card | preview shows previous turn; contradictory card states | F-9.1–9.5 series + `c79a448` stuck card + `334befc` contradictory states | Recurring job-lifecycle class (`8742686` is the blast-radius FAIL example in AGENTS) | F-9.5 shipped; flags still exist as fallback | **YES — Reliability ratchet.** Gate: `JobSession.contract.test.ts`. Do not mix with food-calc. |
| `KCAL_ONE_WRITER` | agent-emitted calories vs `finalizeDishLedger` | F-8 whole track + F-10.2 Atwater; standing row | Architecture was rebuilt because the class kept returning | ✅ standing | **YES — Meal Log ratchet** (standing already). |
| `APPLY_MISS` / B0 converts | HDL 50→1.293 etc. not applied to Home | B0 was Current work; G-B1 fixtures were deleted so the outer lock was skip-pass — both resolved 2026-09-14 | Proven live 2026-09-14, then sealed | ✅ B0 CLOSED 2026-09-14 | **YES — Biomarkers.** Do not treat skip-pass as G-B1 green. |
| Credits / admin quota 0 | Admin `NaN`/0; quota copy `\n\n` | PR #3 + PR #4 (**2**, not >3) | No | ✅ `creditManager.test.ts` | **Thin yes** — keep the known-fixed row; not a ratchet driver. |
| Deploy git-hash in Settings | Docker has no `.git` | `0d40406` `7093718` `613aa03` `eebbdc8` `930f0aa` `f12b296` (**>3**) | Infra churn | ops | **NO** on the product scorecard. Not a patient-facing class. |
| Track L-2–L-5 leftovers | seed/outlier/admin chrome + catalog + live meal id | Unparked 2026-09-15 | Active Track L | active | Restore from `85ce58b`/`95c5640`; L-5 waits named locale. |

GitHub PRs on `cwahli/Health-tracker` (all closed with merge timestamps): **#1** portion WRONG_BASIS · **#2** photo second-device · **#3** quota copy · **#4** admin quota · **#5** scorecard + vitest exclude · **#6** `48a87ee` stuck-pending `dbInteractions` entry (swallowed `Promise.resolve() //` comment ate a `completeInteraction()` call on demo-signup dashboard write) — kept the header's amber attention badge blinking forever on a new profile, unrelated to `CROSS_DEVICE_SYNC` above; not yet regression-tested (`App.tsx` has no test harness) and not yet confirmed as a class (only one instance found via `grep "Promise.resolve() //"`, but worth a repo-wide check for other silently-truncated `//` comments eating code if this pattern recurs).

---

## Classes currently red (work items)

| Class | Area | Kind | Named gate |
|---|---|---|---|
| `LEAK_KEY` | Localization | 242 `t()` callsites missing from packs (chrome keys `closeDialog`/`modalDialog` restored) | `npm run scorecard:debug` law `i18n_required_chrome` |
| `I18N_A11Y_UNRUN` | Localization | `current/a11y/` empty | live Playwright, quota |
| `CROSS_DEVICE_SYNC` | Reliability | second-device test added (`JobStore.test.ts`) | `src/jobs/__tests__/JobStore.test.ts` |
| `SINGLE_DISH_FLATTEN` | Meal Log | live Mie Ayam stayed 1 nested dish; inner unroll now gated | `npx vitest run server_vision_scout.test.ts` (J-ID-01 / G8 journey, not a new pack) |
| `PHOTO_EDIT_SINGLE_DISH` | Meal Log | photo clarification replaces only one dish + appends photo to the list | `tests/golden_meals.test.ts` (G10) + `server_meal_edit.test.ts` + `npx playwright test prototype/tests/photo-edit-replace-dish.spec.ts` |
| `DEBUG_TURN_TIMELINE` | Reliability | multi-turn export dropped the edit turn + per-turn photos | `npx vitest run src/utils/debugRunTree.test.ts src/utils/debugPayload.test.ts` |

---

## Ordered actions

Any-agent Current work is **Q-4** then **Q-10** (`specs/active/`). Do **not** start USDA or a Q-9 rewrite. Track L-1…L-4 landed; L-5 waits a locale.

| # | Do | Why it is next | Done when |
|---|---|---|---|
| **1–5** | ✅ DONE — i18n chrome keys, portion restore, G-B fixtures, meal goldens, scorer | sealed 705/0/0 at `3ff047d` | inner gates green in dump |
| **6** | ✅ DONE — `SINGLE_DISH_FLATTEN` | live Mie Ayam nested 4 foods in 1 dish | `server_vision_scout.test.ts` Mie Ayam case green; standing `single_dish_flatten` |
| **7** | ✅ DONE — Track L callsite keys (L-2 seed/outlier, L-4 dict/table/batch/img/del/backup/sanitize/audit) | restored from `85ce58b` (no invent) | `i18n_required_chrome` PASS sealed |
| **8** | 🟡 PARTIAL — Gate I18N-A11Y Wave K J-ID-01 evidence archived | 3 helper commits, then J-ID-01 soak | `current/a11y/` present; checklist in SCOREBOARD_LIVE_RESULTS |
| **9** | ✅ DONE — Second-device sync named test | Class that beat unique-by-key and PR #2 | fresh JobStore sees R2/`/photos/` URL in `JobStore.test.ts` (707 green) |
| **10** | OPEN — Record Meal_03 6-case + Meal_04 live specs | Compare/log benches exist and are untracked | PASS/FAIL + date in §E2E |
| **11** | ✅ DONE — B0 Apply smoke CLOSED 2026-09-14 | locked converts | HDL 1.293 / TG 1.411 / LDL 3.362 / creat 79.56 / bili 13.68 on Home |

**Human ops DONE 2026-09-14:** Render serves current `main` (`live_origin` PASS sealed); sat fat over target confirmed red. Brand `status` migration `20260913_brand_menu_items_status.sql` is in the repo (`supabase/migrations/`) and applied to live Supabase by hand.

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

8 cases: 7 from prototype 01/02/06/08/09/10/11 + app-chat case 12. Learning `golden-meal-suite-20260911.md`: stay **DRAFT** until a 32-key ledger exists (only 6–8 macros in prototype). Dual-GT conflict on case 11 stays on record. Case 12 is **FINAL** (live 32-key ledger).

| Case | Contract | Known residual (from `benchmark_result.md`) |
|---|---|---|
| 01 Yolk / 02 Lidl / 06 menu / 08 oats / 09 plates | contract PASS on 2026-09-10 soak | 31-key incomplete; brand bind not asserted |
| **10 barcode hotpot** | rerun contract PASS | **FAIL continuity** — live 1–2 dishes vs GT 5 |
| **11 seafood + oats** | contract PASS | **under-extract** — live 2 vs GT 6 |
| **12 chat saved-meal** | LIVE PASS T0/T1 2026-09-17; T2 API-perfect, UI-blocked | must-succeed: brand chip + saved chip + tray edit + note → 3 dishes; edit (+oats −coconut) exact sums. OPEN: no UI add/remove edit path (sheet closes, fresh thread → review); review-mode tag+text double-count; per-100g lock partial merge |

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
| Frozen leftover chrome | ✅ PASS sealed | 27 frozen keys present, not leak, id≠en (`i18n_required_chrome` law) |
| `t()` callsite keys | ✅ PASS sealed | L-2/L-4 restores landed; no missing-keys fail in sealed dump |
| `AppModal` close | ✅ PASS sealed | `closeDialog`/`modalDialog` in packs; `AppModal.test.tsx` green in sealed run |
| J-ID-01/02/03 debug-contract | LIVE PASS | `SCOREBOARD_LIVE_RESULTS.md` |
| Gate I18N-A11Y | 🟡 Wave K J-ID-01 evidence archived | helper repaired; `current/a11y/` present; full checklist partial |
| Persona | **P-ID-WL-01 F18 / 140 cm / 40 kg / 1350 kcal**. Consolidation 58kg/age42 is stale | live-results header |
| Planned Indo dish photos | never added; live used oats / Silverqueen | FIXTURE NOTE |
| Track L-2–L-5 | **active** (unparked 2026-09-15) | ROADMAP |

Ratchet: `TRANSLATION_DUMP` (table above). Next: actions #1 then #6.

---

## 2. Meal Log

**Named gates**

```
npx vitest run server_portion_clarify.test.ts server_vision_scout.test.ts server_edit_patch_ledger.test.ts server_derivation.test.ts server_dish_finalize.test.ts src/utils/nutrients.test.ts src/utils/nutritionTargetStatus.test.ts src/components/NutrientPieChart.test.tsx src/components/NutrientTargetRow.test.tsx tests/golden_meals.test.ts tests/golden_meal12_chat_saved_meal.test.ts tests/food_autocomplete_composition.contract.test.ts
npx playwright test prototype/tests/photo-edit-replace-dish.spec.ts
```

| Check | Status | Evidence |
|---|---|---|
| S-10 portion funnel | PASS after `d105b0c` restore | `quantityText.ts` + `server_portion_clarify.test.ts` |
| Home polarity | PASS + ratchet | `isLimitNutrient`; `nutrients.test.ts` |
| Same-meal package+prepared | PASS + standing | `588154c` |
| **Single-dish flatten** | ✅ PASS sealed (was live FAIL `job_1789414917685`) | `server_vision_scout.test.ts` Mie Ayam unroll; J-ID-01 + G8; standing `single_dish_flatten` |
| Food Autocomplete & Composite Logging | ✅ PASS (11 tests) | Autocomplete query isolation, multi-item staging, bracket portion sync, photo deduplication, admin meal overwrite, composite calculation |
| **G10 photo-edit clarifies ONE dish** | ✅ PASS (new) | Golden `tests/Golden_meal/10. Photo edit clarifies one dish/` + `tests/golden_meals.test.ts` + `server_meal_edit.test.ts` (replace in place, peanuts scaled, dishes preserved) + `prototype/tests/photo-edit-replace-dish.spec.ts` (2-photo create → 1-photo clarification, same job, photo appended) |
| F-12 USDA | shipped / do-not-reopen | F-12.1–12.4 |
| F-10.7 expand | ⚠️ helper exists, **not on analyze hot path** | `shouldExpandMealAgent` is unit-tested and exported from `src/mealBuild/`; no import from `server_food_analyze_run*.ts`. Complex meals do not spawn workers yet. Do not copy prototype DELEGATE. |
| Layer B goldens | PASS collect | restored G1–G9 + new G10; identity/lock fixtures, not 32-key ledgers |
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

**Ratchet `PHOTO_EDIT_SINGLE_DISH`:** a follow-up clarification photo must replace exactly ONE dish (in place — net dish count stable), scale only the named blank, keep the other rows, and be APPENDED to the meal image list (initial photos retained). Locked by G10 golden + `server_meal_edit.test.ts` + `prototype/tests/photo-edit-replace-dish.spec.ts`. Debug side: `DEBUG_TURN_TIMELINE` — the export shows every turn's prompt, its own photos, and its own answer.

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
| `tests/golden_biomarker.test.ts` | ✅ PASS sealed, 0 skip | fixtures restored; collection PASS |
| Prototype C1–C7 | claimed 100% | `scripts/assert-biomarker-cases.mjs` |
| B0 Apply smoke | ✅ CLOSED 2026-09-14 | locked `1.293` / `1.411` / `3.362` / `79.56` / `13.68` on Home |
| Live E2E | ZERO | no Playwright spec |
| B7.4 pending store | ✅ shipped (`74e29bc`) | packet `specs/done/b7-4-pending-store.md` |
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
npx vitest run src/jobs/__tests__/JobStore.test.ts src/jobs/__tests__/JobSession.contract.test.ts src/jobs/__tests__/SupabaseJobSync.coalesce.test.ts src/utils/creditManager.test.ts src/utils/dumpContract.test.ts src/utils/debugPayload.test.ts src/utils/debugRunTree.test.ts src/utils/syncUtils.regression.test.ts src/utils/goldenScoreboard.test.ts src/utils/foodImageSources.test.ts server_auth.test.ts
node scripts/journey-guard.mjs
```

| Check | Status | Evidence |
|---|---|---|
| Vitest vs Playwright exclude | fixed `6c25141` | |
| golden scorer | ✅ PASS sealed | engine restored; `goldenScoreboard.test.ts` green in sealed run |
| Job session / STALE_TURN | shipped + ratchet | `JobSession.contract.test.ts` |
| Credits | PASS | PR #4 |
| Debug / dump contract | PASS | |
| **Debug multi-turn photo-edit completeness** | ✅ PASS (new) | `debugRunTree.test.ts` `buildTurnTimeline` (per-turn prompt + own photos + own answer; per-dispatch `received.photoUrls`) + `debugPayload.test.ts` Turn Timeline render + continuation marker preserved; route unions `photoUrls` and picks the richest dispatch list (`server_routes_jobs.ts`) |
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
| `photo-edit-replace-dish.spec.ts` | G10 Meal photo-edit | shell stub PASS; live (`LIVE_G10_PHOTO_EDIT=1`) PASS 2026-09-20 (2-photo create → 1-photo clarification, same job, debug Turn Timeline `photos:2`/`photos:1`) |
| `meal12-chat-saved-meal.live.spec.ts` | Meal_04 case 12 | LIVE T0/T1 PASS 2026-09-17; T2 RED (no UI edit path — must-succeed on fix) |
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
