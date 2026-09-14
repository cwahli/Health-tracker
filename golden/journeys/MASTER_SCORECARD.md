# Master Scorecard — Health-tracker

**Purpose:** one place to check PASS/FAIL status by product area, so a real regression doesn't require re-testing the app by hand to discover. This file is a living document — **every bug found by manual testing must be added here as a permanent tracked row**, not just fixed and forgotten, or this scorecard degrades back into "looked fine at the time."

**As of:** 2026-09-14, commit `f372e85` (`main`). Regenerate the "Automated evidence" numbers by running `npm test` — see the Reliability section for why that command was untrustworthy until today.

---

## OVERALL VERDICT: **NOT ALL GREEN**

| Area | Unit tests | Live E2E coverage | Verdict |
|---|---|---|---|
| Localization | 4/4 files pass | 3 journeys tracked, **flagship gate never run live** | ⚠️ INCOMPLETE |
| Meal Log | **75/78 files pass** (2 real regressions + 1 crash) | 5 of 6 relevant specs untracked | 🔴 FAIL (known regressions) |
| Compare | 1/1 files pass | 1 journey tracked (PASS), 2 specs untracked | ⚠️ PARTIAL |
| Biomarkers | 8/8 files pass | **zero E2E coverage exists** | ⚠️ UNIT-ONLY |
| Receptionist | 5/5 files pass | 2 specs exist, demo/stub mode only (no live network) | ⚠️ PARTIAL |
| Reliability | 44/45 files pass (1 real regression) | test tooling itself was broken until today | 🔴 FAIL (now fixed) |

Don't read "N/N files pass" as "feature works" — several areas have real functional gaps unit tests can't see (see each section). Detail and evidence below.

---

## How to regenerate this file's numbers

```
npm test                        # vitest — unit/integration, ~1500 tests, ~50s
npx playwright test <spec>      # E2E — one spec at a time, real backend calls, costs quota
```

Until today, `npm test` also tried to execute every `prototype/tests/*.spec.ts` file (Playwright-only, uses `@playwright/test`), producing **18 fake "FAIL" results on every single run** on top of any real failures. See Reliability §1. That's fixed now (`vite.config.ts` excludes `prototype/tests/**` from vitest), but note it for context if you're comparing against an older run and see "21 failed files" — 18 of those were never real.

---

## 1. Localization

**Current focus.** Full detail already lives in `SCOREBOARD_LIVE_RESULTS.md`, `SCOREBOARD_CONSOLIDATION_REPORT.md`, and the gate definition `_drafts/GATE_I18N_A11Y_TREE.md` — this section is the short version plus what's new since that review.

| Check | Status | Evidence |
|---|---|---|
| Unit tests (i18n.test.ts, auditEngine.i18n, dietitianInstructions.i18n, ReceptionistCard.i18n) | **PASS** (4/4 files) | `npm test` |
| 3 Indonesian journeys (J-ID-01/02/03) — happy-path gates (auth, multi-turn, photo, debug contract) | **LIVE PASS** | `SCOREBOARD_LIVE_RESULTS.md` |
| Gate I18N-A11Y (the accessibility-tree scan, built specifically to catch chrome-text leaks) | 🔴 **NEVER RUN** — `golden/journeys/_live_a11y/` doesn't exist | Coverage checklist in `SCOREBOARD_LIVE_RESULTS.md`: every row `NOT COVERED` |
| Persona parameters | ⚠️ Inconsistent between the two governing docs (58kg/age42 vs 40kg/age18 — same "locked" persona, different numbers) | Compare `SCOREBOARD_CONSOLIDATION_REPORT.md` §Executive Summary vs `SCOREBOARD_LIVE_RESULTS.md` header |
| Fixture photos | ⚠️ Planned fixtures (Nasi Padang/Bubur Ayam/Gado-Gado) don't exist in repo; actual runs used unrelated substitutes (oats, chocolate bar) with no note explaining the swap | `find . -iname "nasi_padang*"` → nothing |

**KNOWN LIVE BUG (found this session, not caught by any gate above):** `src/components/ui/AppModal.test.tsx` currently fails — the shared modal's close button renders `aria-label="closeDialog"` (a raw, untranslated camelCase key) instead of the localized "Close dialog." This is the exact class of bug Gate I18N-A11Y exists to catch, and it's sitting red in the unit suite right now, undetected by the (never-run) live gate. **AppModal is used broadly across the app** (any dialog/sheet), so this isn't scoped to one surface.

**Next action:** run Gate I18N-A11Y live at least once (infra is ready, `assertIdChromeA11yTree` is implemented and looks correct) before calling any journey complete, and fix the AppModal aria-label regression.

---

## 2. Meal Log

The largest area by test count, and where real regressions currently exist.

| Check | Status | Evidence |
|---|---|---|
| Unit tests | 🔴 **75/78 files pass** — 3 files have real failures | `npm test` |
| `server_portion_clarify.test.ts` — S-10 PORTION_FUNNEL quantity resolution | 🔴 **FAIL — 4 assertions**, clarify-vs-adopt decisions inverted (cases expecting 0 clarify items get 1, and vice versa) | Run output, `server_portion_clarify.test.ts:422,466,472,479` |
| `src/utils/goldenScoreboard.test.ts` — scoring/title-generation | 🔴 **FAIL — 3 assertions**: (a) a golden run that should score 0 failures scores 1; (b) title generation now leaks an extra "50% Duroc Breed" fragment into a dish title; (c) a Gemini-blob-splitting test expects 3 items, gets 13 | Run output, `goldenScoreboard.test.ts:49,184,217` — **this is the same engine behind the "Food & Venues 100%, 53 logs" panel** in the app's own debug Settings view, so its own scoring logic being wrong is worth treating seriously |
| `tests/golden_meals.test.ts` | 🔴 **CRASHES** — missing fixture `tests/Golden_meal/1. Multi-food log/expected.json` | ENOENT at test collection time |
| `server_food_catalog.test.ts` | ⚠️ Passes, but with a swallowed warning: migration file `supabase/migrations/20260805_food_catalog_schema.sql` doesn't exist, so schema-load correctness isn't actually being verified — a leftover from the Supabase→D1 transition | stderr in run output |
| Live E2E: `meal01-golden.live.spec.ts`, `multiturn-meal-edit.live.spec.ts`, `portion-clarify.live.spec.ts` | 🔴 **UNTRACKED** — real specs exist, no scoreboard/pass-fail summary anywhere | `prototype/tests/` |
| Live E2E: J-ID-01 (meal log via Desk), J-ID-03 (meal edit) | LIVE PASS (happy path only, per Localization caveats above) | `SCOREBOARD_LIVE_RESULTS.md` |

**KNOWN LIVE BUGS (found this session, none caught by any test above):**
- Chat message photo doesn't sync cross-device — fixed in `fix(sync): replace stripped image placeholder with real R2 URL after submit` (PR #2, merged). **No regression test exists for the cross-device scenario itself** — `creditManager.test.ts` doesn't apply here; this needs a dedicated test (see Reliability §3).
- Credit-quota-exceeded message was truncated/double-escaped — fixed in PR #3. Caught by no automated test before the fix; `translations.ts` has no test coverage for string completeness.

**Next action:** the `server_portion_clarify.test.ts` and `goldenScoreboard.test.ts` regressions look like real, currently-shipped bugs, not flaky tests (deterministic, specific wrong values) — worth root-causing before anything else in this file, since they affect core logging/scoring logic.

---

## 3. Compare

Smallest dedicated area — most of its real logic is exercised indirectly through Meal Log's resolver pipeline.

| Check | Status | Evidence |
|---|---|---|
| `src/utils/compareMealLogGuard.test.ts` | PASS | `npm test` |
| Live E2E: J-ID-02 (`indo_compare`) | **LIVE PASS** (happy path; I18N-A11Y gate for this journey also never run — see Localization) | `SCOREBOARD_LIVE_RESULTS.md` |
| Live E2E: `compare-mode-six-cases.spec.ts`, `meal03-compare-benchmark.spec.ts` | 🔴 **UNTRACKED** — real 6-case and benchmark specs exist, no pass/fail summary | `prototype/tests/` |

**Next action:** the two untracked Compare specs look like the most thorough coverage that actually exists for this area (6 cases + a benchmark) — worth running and recording status here rather than leaving the only tracked evidence to a single happy-path journey.

---

## 4. Biomarkers

| Check | Status | Evidence |
|---|---|---|
| Unit tests (biomarkerAuditEngine, biomarkerIdentity, biomarkerLifecycle, biomarkerSanitize, clinicalCalculators, status_labels, bioProcess.golden, golden_biomarker) | PASS (8/8 files) | `npm test` |
| Live E2E | 🔴 **ZERO COVERAGE** — no Playwright spec anywhere mentions biomarkers | `grep -rl biomarker prototype/tests/*.spec.ts` → nothing |

**This is the area with the least real-world verification of any of the six** — unit tests check calculation/classification logic in isolation, but nothing exercises the actual upload → parse → review → dashboard flow a user experiences.

**Next action:** this is the natural next area to build a live journey for, following the same pattern as J-ID-01/02/03, once the Localization gate work is stable enough to reuse its helpers.

---

## 5. Receptionist

| Check | Status | Evidence |
|---|---|---|
| Unit tests (handoffContract, jsonSanitize, frontDeskRouting, handoffGuard, deskProcess.golden) | PASS (5/5 files) | `npm test` |
| Live E2E: `receptionist-usecases.spec.ts`, `receptionist-and-meallog-usecases.spec.ts` | ⚠️ Specs exist but are **not** `.live.spec.ts` — demo/stub mode, no real backend calls, so they don't verify the actual Receptionist agent's live behavior | Filename convention (`.live.spec.ts` = real network calls elsewhere in this repo) |

**Next action:** confirm whether a live-mode Receptionist spec is planned; right now this area's only real-backend evidence is indirect, via J-ID-01's Desk consultation turns.

---

## 6. Reliability

Cross-cutting infrastructure: sync, jobs, credits, debug/bug-tracking, auth, and the test tooling itself. Called out separately because it's the source of several bugs that don't belong to any one feature area.

| Check | Status | Evidence |
|---|---|---|
| Unit tests | 🔴 44/45 files pass — 1 real failure (`AppModal.test.tsx`, see Localization §1 — it's an i18n bug living in shared infra) | `npm test` |
| **Test tooling itself** | 🔴 **was broken, now fixed this session** — `vite.config.ts` didn't exclude `prototype/tests/**` from vitest, so every `npm test` run produced 18 fake failures alongside any real ones. Fixed in this PR. | `vite.config.ts` diff |
| Job sync (`SupabaseJobSync.coalesce`, `JobStore`, `JobQueueRunner`, `ImageStore`, `jobUploadState`, `ServerJobRecovery`, `sessionLog`) | PASS | `npm test` |
| Credit/quota system (`creditManager.test.ts`) | PASS — **new this session**, added as a direct regression test for the admin-quota-defaults-to-0 bug (PR #4) | `src/utils/creditManager.test.ts` |
| Debug/bug-tracking infra (`bugAutoFile`, `bugAutoSpot.*`, `bugBatchParser`, `bugDomainPacks`, `bugInboxMigrate`, `bugQueueKpis`, `bugSnapshot`, `bugTapeReplay`, `bugTapeReview`, `bugWorkItem`, `debugPayload`, `debugRunTree`, `debugLogRetention`, `dumpContract`) | PASS | `npm test` |
| Auth (`server_auth.test.ts`) | PASS | `npm test` |

**KNOWN LIVE BUGS FIXED THIS SESSION (all now have regression tests except the first):**
1. **Chat message photo doesn't sync cross-device.** Root cause: `LogChat.tsx` stripped a message's base64 image to the placeholder string `"Image reference preserved"` before persisting, and never replaced it with the real R2 URL once uploaded. Fixed in PR #2. **Gap: no automated test covers this scenario** — everything above runs in one continuous session; there's no "load as a second device" step anywhere in the test suite. **This is a structural blind spot, not just a missed test case** — see next action below.
2. **Credit-quota-exceeded message was truncated and double-escaped**, showing literal `\n\n` text instead of the actual required/available/reset numbers. Fixed in PR #3.
3. **Admin account could be blocked by its own quota system** — `quotaAdmin`/`quotaStandard`/`quotaDemo`/cost settings lived only in per-device `localStorage` with no defined defaults, so an unconfigured device resolved credits to `NaN`/`0`. Fixed in PR #4, now covered by `creditManager.test.ts` (5 tests, including the exact "null quotaAdmin" regression scenario).

**Next action — the structural gap, not just today's bugs:** nothing in this entire test suite (unit or E2E) simulates loading synced state as a different device/session. That's exactly how bug #1 above went undetected, and it's a blind spot that could hide the same failure mode in other synced fields (not just photos) in the future. Proposed: a `cross-device-sync.test.ts` that persists a job/message via the real sync path, then loads it via a **fresh** `JobStore`/client state (simulating a second device) and asserts every field renders correctly — not just the photo. This is the single highest-leverage new test to add, since it protects against a whole class of bug rather than one instance.

---

## Standing rule for this file

Every time a bug is found by manual testing (by Chiwah or otherwise) instead of being caught by an existing gate:
1. Fix it.
2. Add a regression test.
3. Add a row to this file under the relevant area, in the same format as the "KNOWN LIVE BUGS" entries above — don't just fix and move on.

If this file is ever fully green with no "UNTRACKED," "NEVER RUN," or "KNOWN LIVE BUG" entries, that's the point where manual re-testing after a change should no longer be necessary.
