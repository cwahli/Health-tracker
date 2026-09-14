# Master Scorecard — Health-tracker

**Purpose:** one PASS/FAIL board by product area so a real regression does not require re-testing the app by hand. Living document — **every bug found by hand becomes a permanent row here** (fix + named test + this row). Do not delete a red row to look green.

**As of:** 2026-09-14, `HEAD` `d7f5216` (scorecard v1 landed in `6c25141`; I18N-A11Y helper repaired in `b8f91d1` → `d7f5216`).  
**Re-verified this pass:** the four named failing vitest files below, plus `vite.config.ts` Playwright exclude. Did **not** run `npm test` (forbidden as the inner loop — `AGENTS.md` / `DOMAIN_REGRESSION_MAP.md`).

**Sister files:** live Indo journeys = [`SCOREBOARD_LIVE_RESULTS.md`](./SCOREBOARD_LIVE_RESULTS.md). Gate definition = [`_drafts/GATE_I18N_A11Y_TREE.md`](./_drafts/GATE_I18N_A11Y_TREE.md). Execute order = [`plan/ROADMAP.md`](../../plan/ROADMAP.md). Named commands = [`docs/agent/DOMAIN_REGRESSION_MAP.md`](../../docs/agent/DOMAIN_REGRESSION_MAP.md).

---

## How to use this file

| Who | Do |
|---|---|
| **Gemini / other agents** | Current work is still **B0** on the ROADMAP. Use this file to see which area is red; run that area’s **named** command, not `npm test`. |
| **After a hand-found bug** | Fix → named vitest → add a row here under the area (class + evidence + gate). Grow `standing.json` if it is a must-keep feature. |
| **Refresh numbers** | Re-run the **named gates in each section**. Do not cite a full-suite file count as proof. |

```text
# The only refresh this board needs (the four currently-red files):
npx vitest run server_portion_clarify.test.ts src/utils/goldenScoreboard.test.ts tests/golden_meals.test.ts src/components/ui/AppModal.test.tsx
```

Until `6c25141`, `npm test` also executed `prototype/tests/*.spec.ts` (Playwright-only). That produced **18 fake FAIL files every run**. Fixed: `vite.config.ts` now excludes `**/prototype/tests/**`. If an older log says “21 failed files,” 18 of those were never product.

---

## OVERALL VERDICT: **NOT ALL GREEN**

| Area | Inner (named vitest) | Live / E2E | Verdict |
|---|---|---|---|
| Localization | i18n packs **PASS**; shared `AppModal` **FAIL** (`closeDialog` raw key) | J-ID-01/02/03 debug-contract **LIVE PASS**; Gate I18N-A11Y **never run live** | ⚠️ INCOMPLETE |
| Meal Log | **FAIL** — portion-clarify inverted; golden fixture crash; Home polarity + same-meal merge **PASS** | 3 Indo journeys happy-path PASS; 5 meal specs untracked | 🔴 FAIL (1 product + 1 fixture-rot) |
| Compare | `compareMealLogGuard` PASS (thin) | J-ID-02 LIVE PASS; 2 specs untracked | ⚠️ PARTIAL |
| Biomarkers | 8 named files PASS | **zero** Playwright coverage; B0 Apply smoke is Current work | ⚠️ UNIT-ONLY |
| Receptionist | 5 named files PASS | 2 specs, demo/stub only | ⚠️ PARTIAL |
| Reliability | tooling exclude **fixed**; credits/jobs/debug PASS; golden scorer **FAIL**; cross-device **untested** | no second-device spec exists | 🔴 FAIL (scorer + structural gap) |

Do not read “N files pass” as “the feature works.” Several areas are green only where unit tests look. Detail below.

---

## Classes currently red (work items)

Work item = **class**, not a file count. Inner loop = the named command.

| Class | Area | What is actually wrong | Kind | Named gate |
|---|---|---|---|---|
| `PORTION_FUNNEL` | Meal Log | S-10 marked COMPLETE 2026-09-12; 4 assertions now inverted (ask vs adopt) | **product regression** | `npx vitest run server_portion_clarify.test.ts` |
| `LEAK_KEY` | Localization | `AppModal` close button `aria-label="closeDialog"` — key missing from `translations.ts` (`en` and `id`). `t()` falls back to the raw key. Same class as S-8. | **product, one-line keys** | `npx vitest run src/components/ui/AppModal.test.tsx src/utils/i18n.test.ts` |
| `GOLDEN_SCORER_DRIFT` | Reliability / Quality | `scoreGoldenRun` false-fails a matching Ham line; `deriveGoldenTitle` keeps `"50% Duroc Breed"`; `splitExtraIssueText` returns 13 not 3 | **QA scorer**, not the Settings sync tile | `npx vitest run src/utils/goldenScoreboard.test.ts` |
| `GOLDEN_FIXTURE_ROT` | Meal Log | `tests/golden_meals.test.ts` crashes at collection: `tests/Golden_meal/1. Multi-food log/expected.json` missing (deleted in `bca0f80`; ROADMAP S-9 already noted this) | **fixture**, not a live meal bug | `npx vitest run tests/golden_meals.test.ts` |
| `I18N_A11Y_UNRUN` | Localization | Gate wired in specs; `_live_a11y/` does not exist; helper rewritten twice today (`b8f91d1`, `d7f5216`) and still unsoaked | **never-run gate** | `npx playwright test prototype/tests/indo-j-id-01-e2e.live.spec.ts` (quota) |
| `CROSS_DEVICE_SYNC` | Reliability | Photo-sync bug was a second-device load. Nothing in unit or E2E simulates a fresh `JobStore` / second session | **structural gap** | no test yet — proposed below |

---

## Ordered actions (other agents)

Do **not** start F-11.2 / F-11.3, Q-9, Track L-2–L-5, or USDA. Gemini Current work remains **B0**.

| # | Do | Who | Done when | Do not |
|---|---|---|---|---|
| **1** | Add `closeDialog` + `modalDialog` to `localePacks.en` and `.id`; AppModal callers that already pass `language` keep working | any, small | `AppModal.test.tsx` + i18n parity green; Indonesian close label is not the raw key | Unpark L-2–L-5; hardcode English |
| **2** | Root-cause `PORTION_FUNNEL` invert (ask vs adopt). S-10 law still holds: user > label > visual; never silent-clamp past pack | Meal Log | `server_portion_clarify.test.ts` green, including lines 422 / 466 / 472 / 479 | Second LLM; paint the expects |
| **3** | Repair `goldenScoreboard` parser (false fail + title leak + blob split) | Quality | `goldenScoreboard.test.ts`  green | Treat this as the Settings “Food & Venues % logs” tile — that tile is `Header.tsx` sync_state, a different engine |
| **4** | Quarantine or restore `tests/Golden_meal/**/expected.json`. Manifest still lists G1–G6; dirs 3/5/6 are gone; G1 has no `expected.json` | Meal Log / Q-7 | `golden_meals.test.ts` collects; FDC lock assertions retargeted to local `id` (F-12.4) | Reopen USDA to make old `expectFdcId` pass |
| **5** | Run Gate I18N-A11Y live once; write `_live_a11y/J-ID-0X-<surface>.txt`; flip SCOREBOARD_LIVE_RESULTS checklist off `NOT COVERED` | human / quota | every checklist row PASS | Soft-assert; claim complete from debug-contract alone |
| **6** | Add `cross-device-sync` named test: persist job/message through the real sync path, load via a **fresh** store, assert photo URL + other synced fields | Reliability | second-device photo is an R2/`/photos/` URL, not `"Image reference preserved"` | Only re-test in one Playwright session |
| **7** | Record the untracked Playwright specs (table in §E2E) on next live pass | human / soak | each spec has PASS/FAIL + date here | Run all live specs in one agent turn |
| **8** | Biomarker live journey **after B0 Apply smoke** (same helper pattern as J-ID-01) | Gemini after B0 | upload → parse → review → Home numbers | Build the journey instead of B0 |

**Human ops (site, not this file):** deploy current `main`; run `supabase/migrations/20260913_brand_menu_items_status.sql`; confirm Home Top Targets (sat fat over target is red).

---

## 1. Localization

**Current live focus.** Detail: `SCOREBOARD_LIVE_RESULTS.md`. Track L-2–L-5 stay parked; leftover chrome is Track S / this board.

**Named inner gates**

```
npx vitest run src/utils/i18n.test.ts agents/dietitianInstructions.i18n.test.ts src/utils/auditEngine.i18n.test.ts src/components/chat-cards/ReceptionistCard.i18n.test.tsx src/components/ui/AppModal.test.tsx
```

| Check | Status | Evidence |
|---|---|---|
| en/id key parity (`i18n.test.ts`) | PASS (file; AppModal keys are **absent**, so parity does not see them) | named vitest |
| dietitian / audit / ReceptionistCard i18n | PASS | named vitest |
| `AppModal` close `aria-label` | 🔴 FAIL — `aria-label="closeDialog"` | `AppModal.test.tsx:53`. Keys `closeDialog` and `modalDialog` are **not** in `localePacks`. `t()` → `String(key)`. |
| J-ID-01/02/03 happy-path (auth, multi-turn, photo, debug contract) | LIVE PASS | `SCOREBOARD_LIVE_RESULTS.md` |
| Gate I18N-A11Y (a11y-tree chrome) | 🔴 NEVER RUN LIVE — `golden/journeys/_live_a11y/` missing | checklist still `NOT COVERED` |
| I18N-A11Y helper | wired; rewritten `b8f91d1` (ariaSnapshot) then repaired `d7f5216` | still unsoaked |
| Locked persona | **P-ID-WL-01 Sari F18 / 140 cm / 40 kg / 1350 kcal**. Consolidation draft 58kg/age42 is **stale** — ignore it | live-results header |
| Fixture photos | planned `nasi_padang_*` / `bubur_ayam_*` / `gado_gado_*` were never added; live runs used golden oats / Silverqueen / text. Honest residual, not a silent swap | `SCOREBOARD_LIVE_RESULTS.md` FIXTURE NOTE |
| Nutrient chrome `saturated_fat` → “Saturated Fat” | PASS | `displayNutrientName` + `src/utils/i18n.test.ts` |
| Track L leftover (1 serving, Preparation:, View Diagnostic Logs, receipt internals) | parked under S-1 | ROADMAP Track S |

**Class `LEAK_KEY` (this session, unit-red, live-unseen):** every dialog that uses `AppModal` with the default close button exposes a raw camelCase name to assistive tech. Gate I18N-A11Y would have caught this on any surface that opens a modal **if it had run**.

**Next:** action #1 (keys), then action #5 (live a11y soak). Do not unpark L-2–L-5.

---

## 2. Meal Log

Largest area. Two different reds: a **product** invert and a **fixture** crash. Do not lump them.

**Named inner gates** (union; do not run all on a chrome-only edit)

```
npx vitest run server_portion_clarify.test.ts server_vision_scout.test.ts server_edit_patch_ledger.test.ts server_derivation.test.ts server_dish_finalize.test.ts src/utils/nutrients.test.ts src/utils/nutritionTargetStatus.test.ts src/components/NutrientPieChart.test.tsx
```

| Check | Status | Evidence |
|---|---|---|
| `server_portion_clarify.test.ts` S-10 | 🔴 FAIL — 4 tests. Clarify vs adopt inverted | Re-run 2026-09-14: L422 stated-100g expected 0 clarify; L466 “half the oats” expected ask; L472 “half the kacang” + known pack expected adopt 90g; L479 “500g kacang” expected adopt + overflow. Got the opposite on the adopt cases (clarify length 1). |
| Home Top Targets polarity (limit vs goal) | PASS | `src/utils/nutrients.ts` `isLimitNutrient` / `isNutrientOverLimit`. Sat fat / sodium / calories red when over. Snake_case coach keys canonicalized. `nutrients.test.ts` + HomeTab/Trends/pie. |
| Same-meal package + prepared (3 photos → 1 dish; “It's only 1 meal. Just combine them”) | PASS + standing | `same_meal_package_prepared` in `docs/agent/standing.json`. Gates: `server_edit_patch_ledger.test.ts`, `server_vision_scout.test.ts`. |
| F-12 USDA/FDC on Analyze | shipped | F-12.1–12.4. Local staple table has numbers only. |
| `tests/golden_meals.test.ts` | 🔴 CRASH at collection | `ENOENT` `tests/Golden_meal/1. Multi-food log/expected.json`. Manifest still names G1–G6; several dirs deleted in `bca0f80`. Layer B still asserts `expectFdcId` — stale vs F-12.4. |
| Catalog schema warning | leftover | `server_food_catalog.test.ts` may warn that `20260805_food_catalog_schema.sql` is gone (D1). Not a meal-math fail. |
| Live J-ID-01 log / J-ID-03 edit | LIVE PASS happy path | debug-contract 0 fails. I18N-A11Y not run. |

**KNOWN LIVE BUGS**

| Bug | Status | Test? | Scorecard row |
|---|---|---|---|
| Chat photo does not survive a second device (`"Image reference preserved"` instead of R2 URL) | fixed PR #2 | **No second-device test** | Reliability `CROSS_DEVICE_SYNC` |
| Credit-quota message truncated / literal `\n\n` | fixed PR #3 | translations completeness still thin | Reliability |
| Portion funnel invert | **open** | yes, currently red | this section |
| Package+porridge split + failed combine | fixed + **promoted** standing | yes | `same_meal_package_prepared` |
| Sat fat over target shown green (`saturated_fat` vs `saturatedFat`) | fixed | `nutrients.test.ts` | polarity row above |

**Untracked live specs:** `meal01-golden.live.spec.ts`, `multiturn-meal-edit.live.spec.ts`, `portion-clarify.live.spec.ts`, `portion-funnel.spec.ts`, `armC-meal02.spec.ts`. `signup-onboard-wl.live.spec.ts` is Localization/auth, listed in §E2E.

**Next:** action #2 (portion), then #4 (fixture rot). Do not paint `expected.json`. Do not `POST /loop`.

---

## 3. Compare

Small dedicated unit surface; real logic sits in scout-only compare + resolver.

**Named inner gates**

```
npx vitest run src/utils/compareMealLogGuard.test.ts src/server/food/journeyFingerprints.test.ts src/server/food/server_food_scout_source.test.ts
node scripts/journey-guard.mjs
```

| Check | Status | Evidence |
|---|---|---|
| `compareMealLogGuard.test.ts` | PASS | named vitest |
| Standing journey `food_compare` (`allExtractedDishes`, EVALUATION ONLY) | protected | `docs/agent/standing.json` |
| J-ID-02 live | LIVE PASS happy path | `SCOREBOARD_LIVE_RESULTS.md` (used Silverqueen fixtures, not planned Indo dishes) |
| `compare-mode-six-cases.spec.ts`, `meal03-compare-benchmark.spec.ts` | 🔴 UNTRACKED | `prototype/tests/` |

**Next:** on a live soak, run the two untracked specs and paste PASS/FAIL here. Do not merge compare and log packs.

---

## 4. Biomarkers

**Named inner gates** (ROADMAP Current work)

```
npx tsc --noEmit
node scripts/assert-biomarker-lifecycle-m31.mjs
npx vitest run src/utils/biomarkerLifecycle.test.ts src/utils/biomarkerIdentity.test.ts src/utils/biomarkerSanitize.test.ts src/utils/clinicalCalculators.test.ts tests/bioProcess.golden.test.ts tests/golden_biomarker.test.ts
```

| Check | Status | Evidence |
|---|---|---|
| Named unit files (lifecycle, identity, sanitize, calculators, audit, status_labels, bioProcess, golden_biomarker) | PASS | Claude’s suite run; not re-soaked this pass |
| B0 Apply smoke (HDL 50→**1.293**, TG 125→**1.411**, LDL 130→**3.362**, creat 0.9→**79.56**, bili 0.8→**13.68**) | ⚠️ Current work — human Apply on `job_medical_1786666223594` | ROADMAP B0 |
| Fill-template C1–C7 | claimed complete in `AI_HANDOVER.md` | `scripts/assert-biomarker-cases.mjs` |
| Live E2E | 🔴 ZERO — no Playwright spec mentions biomarkers | `prototype/tests/*.spec.ts` |
| B7.4 pending store | not started | wait until B0 verified |
| B8.1 convertViaTable only | shipped | Grok |

**Next:** Gemini does B0, not a new journey. Action #8 only after Apply is proven.

---

## 5. Receptionist

**Named inner gates**

```
npx vitest run src/server/receptionist/handoffContract.test.ts src/server/receptionist/jsonSanitize.test.ts src/utils/frontDeskRouting.test.ts src/utils/handoffGuard.test.ts tests/deskProcess.golden.test.ts
```

| Check | Status | Evidence |
|---|---|---|
| Named unit files | PASS | Claude suite run |
| `receptionist-usecases.spec.ts`, `receptionist-and-meallog-usecases.spec.ts` | stub/demo — not `.live.spec.ts` | no live network |
| J-ID-01/03 Desk turns | indirect live evidence only | `expect.soft` length > 50 in places |
| S-6 handoff i18n | landed | `handoffContract.test.ts` driven by `prototype/receptionist/benchmark/UC-0x.json` |

**Next:** confirm whether a live Receptionist spec is wanted. Do not 10-case UC click-through (ROADMAP Q-8.5).

---

## 6. Reliability

Cross-cutting: sync, jobs, credits, debug, auth, Guard, and the test runner itself.

**Named inner gates**

```
npx vitest run src/jobs/__tests__/JobStore.test.ts src/jobs/__tests__/JobSession.contract.test.ts src/jobs/__tests__/SupabaseJobSync.coalesce.test.ts src/utils/creditManager.test.ts src/utils/dumpContract.test.ts src/utils/debugPayload.test.ts src/utils/syncUtils.regression.test.ts src/utils/goldenScoreboard.test.ts server_auth.test.ts
node scripts/journey-guard.mjs
```

| Check | Status | Evidence |
|---|---|---|
| Vitest vs Playwright exclude | **fixed** `6c25141` | `vite.config.ts` `exclude` includes `**/prototype/tests/**` |
| `AppModal.test.tsx` | counted under Localization (`LEAK_KEY`), not here | shared infra, i18n class |
| `goldenScoreboard.test.ts` | 🔴 FAIL — 3 tests | Re-run: `failCount` 1 not 0 (`:49`); title keeps `50% Duroc Breed` (`:184`); blob split 13 not 3 (`:217`). Engine for **Golden inbox / `scoreGoldenRun`**, **not** Header “Food & Venues 100% · N logs” (that is `sync_state` in `Header.tsx`). |
| Job sync / store / runner / ImageStore | PASS | Claude suite |
| Credits (`creditManager.test.ts`) | PASS | PR #4 admin quota-null → 0 regression |
| Debug / dump contract / bug queue | PASS | named files |
| Auth | PASS | `server_auth.test.ts` |
| Guard / standing | must stay | `same_meal_package_prepared` needles. Do not drop rows to pass. |
| `storageUtils.test.ts` (S-5) | missing | ROADMAP S-9 note; demo-wipe covered by `deskProcess.golden.test.ts` |
| Cross-device / second session | 🔴 no test | photo-sync class |

**KNOWN LIVE BUGS (Reliability)**

1. **Chat photo second-device.** Root: `LogChat` persisted `"Image reference preserved"` and never replaced with the R2 URL. Fixed PR #2. **No automated second-device step.** Highest-leverage new test (action #6).
2. **Quota-exceeded copy** truncated / double-escaped. Fixed PR #3.
3. **Admin quota defaults to 0/`NaN`** when `quotaAdmin` unset. Fixed PR #4 + `creditManager.test.ts`.
4. **`npm test` wall of red** from Playwright specs under vitest. Fixed `6c25141`.

**Next:** action #3 (scorer) and #6 (second-device). Do not start R-13 until `specs/active/R-13.md` is locked.

---

## E2E inventory (`prototype/tests/`)

Run under `npx playwright test <spec>`, never under vitest.

| Spec | Area | Mode | Scorecard |
|---|---|---|---|
| `indo-j-id-01-e2e.live.spec.ts` | Loc + Meal | live | LIVE PASS (debug). I18N-A11Y NOT COVERED |
| `indo-j-id-02-e2e.live.spec.ts` | Loc + Compare | live | LIVE PASS (debug). I18N-A11Y NOT COVERED |
| `indo-j-id-03-e2e.live.spec.ts` | Loc + Meal edit | live | LIVE PASS (debug). I18N-A11Y NOT COVERED |
| `signup-onboard-wl.live.spec.ts` | Loc / auth | live | UNTRACKED |
| `meal01-golden.live.spec.ts` | Meal | live | UNTRACKED |
| `multiturn-meal-edit.live.spec.ts` | Meal | live | UNTRACKED |
| `portion-clarify.live.spec.ts` | Meal | live | UNTRACKED |
| `portion-funnel.spec.ts` | Meal | stub/live mix | UNTRACKED (S-10 inner is vitest) |
| `armC-meal02.spec.ts` | Meal | live/arm | UNTRACKED |
| `compare-mode-six-cases.spec.ts` | Compare | ? | UNTRACKED |
| `meal03-compare-benchmark.spec.ts` | Compare | bench | UNTRACKED |
| `receptionist-usecases.spec.ts` | Receptionist | stub | exists, not live |
| `receptionist-and-meallog-usecases.spec.ts` | Receptionist + Meal | stub | exists, not live |
| `dialog-inventory.spec.ts` | Reliability / Q-8.3 | stub | S-7 green 2026-09-12 |
| `key-journeys.spec.ts` | Reliability / shell | stub | untracked here |
| `r3-smoke.spec.ts` | Reliability / R-3 | leftover-English | after S-1 list green |
| `example.spec.ts` | — | example | ignore |

---

## What v1 (`6c25141`) got right vs what this pass corrected

**Keep**

- Six areas the human asked for, including Reliability.
- Vitest/Playwright exclude — real reliability bug; 18 fake fails trained people to ignore red.
- Honest “I18N-A11Y never run” and “Biomarkers have zero E2E.”
- Standing rule: hand-found bug → test → row.
- Cross-device as a class gap, not one photo anecdote.

**Corrected here**

- **As-of was stale** (`f372e85`); HEAD is `d7f5216` with a rewritten then repaired a11y helper, still unsoaked.
- **“Maps all ~140 files”** was a count, not a map. This file maps **named gates + every Playwright spec**. File-count theater is how a fixture crash and a product invert look the same.
- **`npm test` as the regenerate command** contradicts `AGENTS.md`. Refresh = named files.
- **Settings “Food & Venues 100%, 53 logs”** is `Header.tsx` `sync_state`, **not** `goldenScoreboard`. The scorer is still red and still worth fixing; it is the Golden inbox engine.
- **Persona 58kg vs 40kg** is not an open conflict. Live-results header wins; consolidation is stale.
- **`golden_meals` crash** is fixture rot from `bca0f80` (already in ROADMAP S-9), not a shipped meal-log math bug. It still must not stay red forever.
- **AppModal** is a **missing translation key** (`LEAK_KEY`), not merely “untranslated camelCase in a passing dictionary.”
- **Missing shipped rows:** Home nutrient polarity, `same_meal_package_prepared`, F-12.4, Guard needles.
- **Missing specs:** `signup-onboard-wl`, `portion-funnel`, `key-journeys`, `r3-smoke`, `dialog-inventory`, `armC-meal02`.
- **AppModal was double-counted** as Reliability’s only unit fail and as Localization.

---

## Standing rule for this file

Every time a bug is found by hand instead of a gate:

1. Fix it (class, not the one meal).
2. Add a named regression test.
3. Add a row here under the area (same shape as the tables above).
4. If it is a must-keep live behavior, grow `docs/agent/standing.json` via Learner / **promote** — do not drop a needle to pass Guard.

This file is complete only when there are no `UNTRACKED`, `NEVER RUN`, or open `KNOWN` product rows. Fixture-rot and parked Track L leftovers may stay listed as honest residuals.
