# Wave A — OpenCode Muse Spark 1.3 Contributor Free (HIGH thinking)

Repo: `/workspace/biomarker-and-nutrient-tracker` (main @ HEAD)
Live: `https://health-tracker-backend-64gt.onrender.com/`

## Goal
Unblock **Gate I18N-A11Y** live soak so `golden/scorecard/current/a11y/` gets real artifacts and journey coverage checklists can flip.

## Constraints
- High thinking (`--variant high` or max available).
- Restore-not-invent for any i18n copy.
- Standing soak hygiene: `playwright --list` exit 0 first; `locator.ariaSnapshot()`; no mid-soak helper self-edit; SyntaxError = FAIL.
- Do **not** invent translation strings.

## Steps
1. `npx playwright test prototype/tests/indo-j-id-01-e2e.live.spec.ts --list` (and 02/03) must exit 0.
2. Run live against `PLAYWRIGHT_TEST_BASE_URL=https://health-tracker-backend-64gt.onrender.com` for J-ID-01 first (timeout long).
3. Ensure a11y dumps land under `golden/scorecard/current/a11y/`.
4. If soak fails: fix **harness/selectors only** or restore known-good copy from git — minimal diff.
5. Write `/workspace/gemini38-meal-review/tasks/bakeoff/WAVE_A_REPORT.md` with: PASS/FAIL, wall time, model, thinking, tokens/$ if shown, what broke, files touched.

## Success
At least one journey produces non-empty a11y artifact(s) OR a clear FAIL report with next fix (not a loop).
