# WAVE H — S-1 leftover English fallbacks (wire existing keys)

Repo: `/workspace/biomarker-and-nutrient-tracker`
Model lock: Cline Free **DeepSeek V4.1 Flash** only (`cline-free/deepseek-v4.1-flash`, thinking high). Never deepseek-v4-flash / V4.
Vertex OFF. Restore/wire-not-invent.

## Inventory (from WAVE_D_REPORT)
1. `FoodHistoryTab.tsx` hardcodes `1 serving` — prefer `t.oneServingDefault` if key exists in translations.
2. `FoodCard.tsx` `t.preparationLabel || 'Preparation:'` — ensure `id` preparationLabel is Indonesian from `85ce58b` if drifted; wire only.
3. `LogChat.tsx` `t.viewDiagnosticLogs || 'View Diagnostic Logs'` (+ title) — restore `id` from `85ce58b` if English-filled; do not invent.
4. Other Wave D sites (`NutritionDataBrowserModal`, `AllAnalysesModal`, `syncUtils`, assemble sanitize default) — only if same class and cheap; otherwise list leftover in report.

## Rules
- Touch minimal files; value-only translation restores from `85ce58b` when needed.
- Add a tiny sensor if a restore happened.
- Offline gates: targeted vitest if present + `npx tsc --noEmit` if cheap.
- Write `/workspace/gemini38-meal-review/tasks/bakeoff/WAVE_H_REPORT.md`.
- Do **not** commit/push — leave dirty for overnight coordinator.

## Done when
WAVE_H_REPORT.md with PASS/FAIL + files/keys touched.
