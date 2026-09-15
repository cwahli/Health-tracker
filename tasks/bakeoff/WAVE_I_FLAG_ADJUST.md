# WAVE I — Flag issue / Adjust portion (Wave G gate leftovers)

Repo: `/workspace/biomarker-and-nutrient-tracker` (pull latest first; Wave H pushed `bf0211d`)
Model lock: Cline Free **Muse Spark 1.3 Contributor** (`cline-free/muse-spark-1.3-contributor`, thinking high).
DeepSeek V4.1 Flash daily free limit is exhausted (~22h). Never deepseek-v4-flash / V4. Vertex OFF.
Restore/wire-not-invent. Baseline for flag keys: `bca0f80~1` (same method as Wave H; these keys exist there).

## Gate evidence (Wave G FAIL)
Live a11y `meal-analysis-chrome` still shows English:
1. button `"Flag issue with this response"` — `LogChat.tsx` title uses `t.flagIssueWithThisResponse || "Flag issue with this response"`; **id values drifted to English**.
2. button `"… ✏️ Adjust portion"` — hardcoded in `FoodCard.tsx` (~2499). **No `adjustPortion` key ever existed in translations** (git history). Do **not** invent Indonesian or add a new key unless you find a byte-identical historical value somewhere in the repo (unlikely). If no restore source: list as leftover in the report with reason.

## Required work
1. Restore **id** (and only if drifted, en) for these keys from `bca0f80~1` byte-for-byte:
   - `flagIssueWithThisResponse` → id `"Laporkan masalah pada respons ini"`
   - `flagIssueWithAgentResponse` → id `"Laporkan masalah dengan respons {agent}"`
   - `flagAnother` → id `"Laporkan lainnya"`
   - `flagFoodAnalysisIssue` → id `"Laporkan masalah analisis makanan"`
   (`flagIssue` id is already `"Laporkan masalah"` — leave unless drifted.)
2. Wire call sites (remove English `|| '…'` / hardcoded titles where keys exist):
   - `LogChat.tsx` `flagIssueWithThisResponse` title fallback
   - `FoodCard.tsx` `t.flagIssue || 'Flag issue'` / `flagAnother`
   - `BugTrackerModal.tsx` `title="Flag issue"` if `t` is in scope; otherwise list leftover
3. `Adjust portion` / `Adjust Total Portion` / `Click to adjust…`: only wire if a restoreable key exists; else leftover.
4. Value-only translation edits; add a tiny sensor in `i18n.test.ts` for the restored flag keys + call sites.
5. Offline gates: `npx vitest run src/utils/i18n.test.ts` + `npx tsc --noEmit` if cheap. No live Playwright soak.
6. Write `/workspace/gemini38-meal-review/tasks/bakeoff/WAVE_I_REPORT.md`.
7. Do **not** commit/push — leave dirty for overnight coordinator.

## Optional same-class (only if cheap after #1–3)
Wave H §7a listed 11 DUMP_ARTIFACT residuals (`itemSubTotal`, `verdictLabel`, `nutritionCalculation`, `genderLabel`, `printedPackagingLabel`, `agentFrontDeskWelcome`). Restore from `bca0f80~1` if time remains; otherwise list for Wave J.

## Done when
WAVE_I_REPORT.md with PASS/FAIL + keys/files touched + Adjust-portion decision.
