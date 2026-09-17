# WAVE F — restore English-filled job-card id residuals

Repo: `/workspace/biomarker-and-nutrient-tracker` (pull latest first; Wave E pushed `47390e6`)
Model lock: Cline Free **DeepSeek V4.1 Flash** only (`cline-free/deepseek-v4.1-flash`, thinking high). Never deepseek-v4-flash / V4.
Vertex OFF. Do not invent copy — restore from git `85ce58b`.

## Context
Wave E restored missing `status*` keys (PASS, `47390e6`). Same dump (`1c868ab`) left these keys **present but English-filled / mangled in `id`**. Gate regexes may not catch them, but the J-ID-01 analyzing card still shows English chrome for some (e.g. `Delete task`).

## Keys to restore (id + en must match `85ce58b` byte-for-byte)
| Key | current `id` (bad) | `85ce58b` `id` (good) |
|---|---|---|
| `updatingMeal` | `Updating meal...` | `Memperbarui makanan...` |
| `attemptOf` | `Attempt {current} of {max}` | `Upaya {current} dari {max}` |
| `attemptFailedTapRetry` | truncated dump value | full `85ce58b` string |
| `analysisFailed` | `Analysis failed` | `Analisis gagal` |
| `deleteTask` | `Delete task` | `Hapus tugas` |

Also scan `TaskPlaceholderCard.tsx` + `jobPreview.ts` for any other `d?.…` / `t.…` job-card chrome that is English-filled in `id` while correct in `85ce58b`; restore those too if clearly the same class (restore-only).

## Task
1. `git show 85ce58b:src/utils/translations.ts` — restore ONLY the listed keys (and same-class siblings you prove) in BOTH `en` and `id`. Touch only those values (+/− equal). No pack rewrite. No invented Indonesian.
2. Extend the Wave E sensor in `src/utils/i18n.test.ts` so each restored `id` value equals `85ce58b` and `id !== en` for these keys; keep existing status* tests green.
3. Offline verify: `npx vitest run src/utils/i18n.test.ts src/jobs/__tests__/JobSession.contract.test.ts` and `npx tsc --noEmit` if cheap.
4. Write report to `/workspace/gemini38-meal-review/tasks/bakeoff/WAVE_F_REPORT.md` with PASS/FAIL + key list + diffstat.
5. Do **not** commit or push — leave dirty for overnight coordinator.
6. No live Playwright / Vertex.

## Done when
Keys restored from 85ce58b; offline tests pass; WAVE_F_REPORT.md exists.
