# Wave L Report — S-1 remaining `oneServingDefault` hardcodes (post bakeoff A–K)

**Verdict: PASS**
**Model:** Cline Free Muse Spark 1.3 Contributor (thinking high)
**Date (UTC):** 2026-09-15
**Repo tip:** `5d8fad6` (Wave K scorecard commit present) + dirty Wave L working tree (uncommitted, per instructions)
**Scope:** Wire-not-invent only. No Adjust-portion, no §7a residuals, no ROADMAP.md edits, no commit/push.

## Files touched (file:line, post-edit)
1. `src/components/NutritionDataBrowserModal.tsx:67-74`
   - `toScoutItem(item)` → `toScoutItem(item, language?)`; local `t = translations[language || 'en'] || translations.en` (matches the file's existing component-level `t` pattern at line ~156); `servingSize: t.oneServingDefault`. No call sites existed for `toScoutItem` (dead helper kept signature-compatible via optional param, not deleted per blast-radius rules).
   - `translations` import already existed (line 25) — no new plumbing invented.
2. `src/components/AllAnalysesModal.tsx:18,260-267`
   - Added `import { translations } from '../utils/translations';`
   - `quantity: pendingLog?.quantity || '1 serving'` → `quantity: pendingLog?.quantity || dict.oneServingDefault` where `dict = translations[profile?.language || 'en'] || translations.en` (profile.language is the file's existing locale source; `language={profile.language}` already passed at line ~599).
3. `src/utils/syncUtils.ts:4,93,163,172`
   - Added `import { translations } from './translations';` (leaf import; `translations.ts` has no imports → no cycle; `i18n.ts` not imported to avoid `nutrition.ts` chain).
   - `supabaseRowToFoodLog(row)` → `supabaseRowToFoodLog(row, language?)`; `quantity: row.quantity || dict.oneServingDefault` with `dict = translations[language || 'en'] || translations.en`. Existing callers (lines ~258, ~298) unchanged — optional param, L2-safe.
4. `src/server/food/server_food_meal_assemble.ts:142`
   - `sanitizeString(rawFoodData.quantity, "1 serving")` → `sanitizeString(rawFoodData.quantity, t(language, 'oneServingDefault'))`. Server already had `t`/`language` scope (import line 11, `language` in `ParsedMealHeaderArgs` + used at lines 161-180) — wired, not invented. Yields `"1 serving"` for en, `"1 porsi"` for id.
5. `src/utils/i18n.test.ts:280-304`
   - Extended the existing `renders the S-1 chrome from keys only` sensor (Wave H style) with a Wave L block: asserts the three client files contain `t.oneServingDefault` / `dict.oneServingDefault` and no longer contain the bare `'1 serving'` fallback; asserts the server file uses `t(language, 'oneServingDefault')`; guards the `NutritionLabelTable` `=== '1 serving'` data matcher as intentionally exempt.

## Gates (offline, no live Playwright)
- `npx vitest run src/utils/i18n.test.ts` → **PASS** (45/45).
- `npx tsc --noEmit` → **PASS** (exit 0).
- Extra: `npx vitest run src/server/food/server_food_meal_assemble.test.ts` → **PASS** (24/24; combined 69/69 with i18n). No test needed updating (fixture passes explicit `quantity: '1 serving'`, which `sanitizeString` preserves).

## Leftovers (intentionally untouched)
- `src/components/chat-cards/NutritionLabelTable.tsx:1103` — `=== '1 serving'` string-equality data matcher against stored label values. Per instructions §5 these are data matchers, not UI chrome. Now explicitly guarded in the sensor so future sweeps don't "fix" them.
- Test/expected fixtures containing the literal (`server_food_meal_assemble.test.ts:70`, `server_food_responses.test.ts`, golden `expected.json`, debug logs): stored-data assertions/frozen evidence, not UI fallbacks — out of scope.
- `toCatalogScoutItem` `servingSize: '100g'` (NutritionDataBrowserModal.tsx:97): a unit string, not a localizable serving-default — untouched.
- No bare `'1 serving'` / `"1 serving"` UI fallback remains in the four wired source files (verified by grep; only sensor regexes/expectations mentioning the literal remain in `i18n.test.ts`).

## Commit state
Dirty working tree left for the overnight coordinator — **not committed, not pushed**, per instructions.
