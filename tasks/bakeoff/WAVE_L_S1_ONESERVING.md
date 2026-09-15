# WAVE L — S-1 remaining `oneServingDefault` hardcodes (post bakeoff A–K)

Repo: `/workspace/biomarker-and-nutrient-tracker` (pull latest first; tip should include Wave K scorecard commit)
Model lock: Cline Free **Muse Spark 1.3 Contributor** (`cline-free/muse-spark-1.3-contributor`, thinking high).
DeepSeek V4.1 Flash daily free limit still exhausted. Never deepseek-v4-flash / V4. Vertex OFF.
Restore/wire-not-invent. Key already exists: `oneServingDefault` en `"1 serving"` / id `"1 porsi"` (gated in `i18n.test.ts`).

## Context
Bakeoff waves A–K complete. Wave H wired FoodHistoryTab / preparationLabel / viewDiagnosticLogs.
Wave D inventory leftovers still hardcoded in:
1. `src/components/NutritionDataBrowserModal.tsx:73` — `servingSize: '1 serving'`
2. `src/components/AllAnalysesModal.tsx:265` — `quantity: pendingLog?.quantity || '1 serving'`
3. `src/utils/syncUtils.ts:170` — `quantity: row.quantity || '1 serving'`
4. Optional only if already in i18n scope and cheap: `src/server/food/server_food_meal_assemble.ts:142` sanitize default `"1 serving"` — wire only if server already has `t`/locale; otherwise list leftover (do not invent server i18n plumbing).
5. Do **not** change `NutritionLabelTable.tsx` string-equality checks against stored label values (`=== '1 serving'`) — those are data matchers, not UI chrome.
6. Do **not** invent Adjust portion / product-call §7a residuals / ROADMAP.md edits.

## Required work
1. Wire sites 1–3 to use `t.oneServingDefault` (or existing i18n accessor already used in that file). Import/`t` must already exist or match local pattern from FoodHistoryTab.
2. Add/extend a tiny sensor in `src/utils/i18n.test.ts` so those three files no longer contain the bare `'1 serving'` / `"1 serving"` fallback (mirror FoodHistoryTab sensor style). Keep NutritionLabelTable matcher exempt.
3. Offline gates: `npx vitest run src/utils/i18n.test.ts` + `npx tsc --noEmit` if cheap. No live Playwright.
4. Write `/workspace/gemini38-meal-review/tasks/bakeoff/WAVE_L_REPORT.md` with PASS/FAIL, files touched, leftovers.
5. Do **not** commit/push — leave dirty for overnight coordinator.

## Done when
WAVE_L_REPORT.md exists with PASS/FAIL + file:line list.
