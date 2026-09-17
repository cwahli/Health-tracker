# WAVE J — Safe dump residuals + live re-soak prep (post Wave I)

Repo: `/workspace/biomarker-and-nutrient-tracker` (pull latest first; Wave I pushed `b212e9e`)
Model lock: Cline Free **Muse Spark 1.3 Contributor** (`cline-free/muse-spark-1.3-contributor`, thinking high).
DeepSeek V4.1 Flash daily free limit exhausted (~22h). Never deepseek-v4-flash / V4. Vertex OFF.
Restore-not-invent. Baseline: `bca0f80~1` / `c3e6cfd`.

## Context
- Wave I PASS: flag-issue id chrome restored+wired. Adjust portion stays leftover (no historical key — do NOT invent).
- Wave I deferred §7a residuals with product-call risk. This wave only touches **safe restore** items.

## Required work (restore-only)
1. Restore **both en and id** for `verdictLabel` from `bca0f80~1` byte-for-byte:
   - en `"Verdict:"` (current drifted `"Verdict"`)
   - id `"Penilaian:"` (current drifted `"Penilaian"`)
2. Value-only in `src/utils/translations.ts`. No key add/remove/rename.
3. If call sites use `t.verdictLabel || '…'` English fallbacks, remove the fallbacks (wire only).
4. Add a tiny sensor in `src/utils/i18n.test.ts` for the restored verdictLabel values.
5. Offline gates: `npx vitest run src/utils/i18n.test.ts` + `npx tsc --noEmit` if cheap.
6. Write `/workspace/gemini38-meal-review/tasks/bakeoff/WAVE_J_REPORT.md`.
7. Do **not** commit/push — leave dirty for overnight coordinator.

## Explicitly OUT of scope (do not touch)
- `genderLabel`, `agentFrontDeskWelcome` — deliberate product renames; do NOT revert.
- `printedPackagingLabel`, `nutritionCalculation`, `itemSubTotal` — wording/casing need product call; list only.
- Adjust portion / inventing new keys.
- BugTrackerModal i18n plumbing.
- Live Playwright soak (coordinator will run after push+Render).

## Done when
WAVE_J_REPORT.md with PASS/FAIL + keys/files + leftovers table for morning.
