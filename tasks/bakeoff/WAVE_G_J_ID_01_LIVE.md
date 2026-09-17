# WAVE G — Live J-ID-01 I18N-A11Y re-soak (post Wave E+F)

Repo: `/workspace/biomarker-and-nutrient-tracker` @ `307d96f` (Wave F pushed)
Live: `https://health-tracker-backend-64gt.onrender.com/`
Worker: Playwright shell only (no Vertex; no invent copy).

## Goal
Regenerate `golden/scorecard/current/a11y/J-ID-01-analyzing-job-card.txt` and confirm English chrome is gone for:
- Analysis completed → Analisis selesai
- Meal Preview → Pratinjau Makanan
- Delete task → Hapus tugas
- Attempt N of M → Upaya …

## Steps
1. Wait until Render has deployed `307d96f` (or newer) if needed.
2. `npx playwright test prototype/tests/indo-j-id-01-e2e.live.spec.ts --list` exit 0.
3. Run with `PLAYWRIGHT_TEST_BASE_URL=https://health-tracker-backend-64gt.onrender.com` (long timeout).
4. Write `/workspace/gemini38-meal-review/tasks/bakeoff/WAVE_G_REPORT.md` with PASS/FAIL, a11y snippet evidence, wall time.
5. Do not invent i18n; harness-only fixes if soak infra breaks.

## Done when
WAVE_G_REPORT.md exists with clear PASS/FAIL + whether analyzing-job-card still shows English leftovers.
