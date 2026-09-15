# WAVE B Next Actions — Scorecard #8–#10 (shell commands only)

Source: `golden/scorecard/instruction/MASTER_SCORECARD.md` ordered-actions table.

## #8 — Run Gate I18N-A11Y live
```sh
npx playwright test prototype/tests/indo-j-id-01-e2e.live.spec.ts --list
npx playwright test prototype/tests/indo-j-id-02-e2e.live.spec.ts --list
npx playwright test prototype/tests/indo-j-id-03-e2e.live.spec.ts --list
npm run scorecard:debug
ls golden/scorecard/current/a11y/
```

## #9 — Second-device sync named test
```sh
npx vitest run src/jobs/__tests__/JobStore.test.ts src/jobs/__tests__/JobSession.contract.test.ts
npx vitest run src/utils/syncUtils.regression.test.ts src/utils/foodLogDedupe.test.ts src/utils/firestoreUtils.test.ts
```

## #10 — Record Meal_03 6-case + Meal_04 live specs
```sh
npx playwright test prototype/tests/compare-mode-six-cases.spec.ts --list
npx playwright test prototype/tests/meal03-compare-benchmark.spec.ts --list
npx playwright test prototype/tests/meal01-golden.live.spec.ts --list
ls golden/meal/Meal_03_compare/
ls golden/meal/Meal_04_log/
```
