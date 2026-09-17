# WAVE K — Live J-ID-01 I18N-A11Y re-soak (post Wave I+J)

Repo: `/workspace/biomarker-and-nutrient-tracker` @ `504d704` / bakeoff `71296b1`
Live: `https://health-tracker-backend-64gt.onrender.com/`
Worker: Playwright shell only (no Vertex; no invent copy). DeepSeek daily capped — soak is harness-only.

## Goal
Confirm live Indonesian chrome after Flag-issue (I) + verdictLabel (J) restores:
- Flag issue → Indonesian (Wave I)
- verdictLabel trailing colon wired (Wave J; may not show on this soak surface)
- Job-card E+F strings still green (Analisis selesai / Pratinjau Makanan / Hapus tugas)
- Note Adjust portion leftover (no historical key — expect still English)

## Steps
1. Wait until Render has deployed `504d704` or newer (at least `b212e9e`).
2. `npx playwright test prototype/tests/indo-j-id-01-e2e.live.spec.ts --list` exit 0.
3. Run with `PLAYWRIGHT_TEST_BASE_URL=https://health-tracker-backend-64gt.onrender.com` (long timeout).
4. Write `/workspace/gemini38-meal-review/tasks/bakeoff/WAVE_K_REPORT.md` with PASS/FAIL, a11y snippet evidence, wall time.
5. Do not invent i18n; harness-only fixes if soak infra breaks.

## Done when
WAVE_K_REPORT.md exists with clear PASS/FAIL + Flag issue / Adjust portion / job-card status.
