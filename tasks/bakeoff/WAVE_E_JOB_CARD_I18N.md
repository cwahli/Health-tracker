# WAVE E — restore job-card chrome i18n (Analysis completed)

Repo: `/workspace/biomarker-and-nutrient-tracker`
Model lock: Cline Free **DeepSeek V4.1 Flash** only (`cline-free/deepseek-v4.1-flash`, thinking high). Never deepseek-v4-flash / V4.
Vertex OFF. Do not invent copy — restore from git.

## Bug
Gate I18N-A11Y J-ID-01 fails: analyzing-job-card shows English **"Analysis completed"** while UI lang is `id`.
Evidence: `golden/scorecard/current/a11y/J-ID-01-analyzing-job-card.txt` line with `text: Analysis completed`.
Code path: `src/jobs/jobPreview.ts` `previewStatusLabel` → `d?.statusAnalysisCompleted || 'Analysis completed'`.
Caller: `TaskPlaceholderCard.tsx` passes `dict: t`.
**Root cause:** `statusAnalysisCompleted` (and sibling `status*` job chrome keys) are **missing** from current `src/utils/translations.ts` (destroyed by dump commit `1c868ab`). Present in known-good `85ce58b`.

## Task (restore-not-invent)
1. From `git show 85ce58b:src/utils/translations.ts`, restore into BOTH `en` and `id` in current `src/utils/translations.ts` at least:
   - `statusAnalysisCompleted` (id must be **"Analisis selesai"** per 85ce58b)
   - `statusAnalysisFailed`, `statusAnalysisCancelled`, `statusActionRequired`, `statusProcessing`
   - Any other keys that `jobPreview.ts` reads via `d?.…` fallbacks for job chrome (scan jobPreview.ts).
2. Touch ONLY those missing keys (+/− equal). Do not rewrite the whole pack. Do not invent Indonesian.
3. Add/extend a small sensor in `src/utils/i18n.test.ts` (or JobSession contract) so `id.statusAnalysisCompleted === 'Analisis selesai'` and `en !== id`, and `previewStatusLabel(succeededJob, { dict: translations.id })` returns Indonesian — lock the class.
4. Verify offline: `npx vitest run src/utils/i18n.test.ts src/jobs/__tests__/JobSession.contract.test.ts` and `npx tsc --noEmit` if cheap.
5. Write report to **`/workspace/gemini38-meal-review/tasks/bakeoff/WAVE_E_REPORT.md`** (if external_directory blocked, write `tasks/bakeoff/WAVE_E_REPORT.md` inside the repo and note it).
6. Do **not** commit or push — leave the working tree for the overnight coordinator.
7. Do **not** run live Playwright against Render unless already green offline and cheap; prefer offline gates.

## Done when
- Keys restored from 85ce58b; offline tests pass; WAVE_E_REPORT.md exists with PASS/FAIL + key list.
