# WAVE_E_REPORT — restore job-card chrome i18n ("Analysis completed" on an `id` analyzing card)

**Date:** 2026-09-15 ~00:47–00:58 UTC (2026-09-15 ~07:47–07:58 WIB)
**Repo:** `/workspace/biomarker-and-nutrient-tracker` @ `main` = `abf7825` (working tree = fix below, **not committed**, left for the overnight coordinator)
**Task:** restore-not-invent the missing `status*` job-card chrome keys from `85ce58b`; lock the class with a sensor; offline gates only.
**Model:** Cline Free **DeepSeek V4.1 Flash** (`cline-free/deepseek-v4.1-flash`, thinking high) per the wave card lock — V4 / `deepseek-v4-flash` were never used. Vertex **OFF**: no live Gemini/Vertex call, no live Playwright soak in this wave.
**Model caveat (honesty):** the model id is not introspectable from inside the session; this says only that no other model/endpoint was invoked by the work below.

---

## VERDICT: **PASS** (offline) — 9 keys restored byte-for-byte from `85ce58b`, class locked

| Requirement | Result |
|---|---|
| `statusAnalysisCompleted` + siblings restored in **en** and **id** | ✅ **PASS** — 9 keys, values identical to `85ce58b` (verified programmatically, §3) |
| `id.statusAnalysisCompleted === 'Analisis selesai'` | ✅ PASS |
| Touch only the missing keys (+/− equal) | ✅ PASS — `src/utils/translations.ts` diff is exactly **+18 / −0** (9 keys × 2 locales) |
| Sensor locking the class | ✅ PASS — 3 new tests in `src/utils/i18n.test.ts` (incl. `previewStatusLabel` end-to-end) |
| Offline gates | ✅ vitest `src/utils/i18n.test.ts` + `src/jobs/__tests__/JobSession.contract.test.ts` → **2 files / 44 tests passed**; `npx tsc --noEmit` → **exit 0** |
| Live Playwright vs Render | ⏭ **not run** (per lock: offline first; stored `a11y/` artifact is pre-fix, §7) |
| Commit / push | ⏭ **not done** (left dirty on purpose) |

---

## 1. Root cause (proven, not assumed)

`1c868ab` (i18n "dump" sweep, same class Wave C documented) rewrote `src/utils/translations.ts` into an alphabetized key dump and **dropped the whole `status*` job-card family**; several neighbouring keys were left **English-filled** instead. The a11y gate then saw the English fallback in the card:

```
golden/scorecard/current/a11y/J-ID-01-analyzing-job-card.txt:17
  - text: Analysis completed          <-- id-locale UI, English chrome
```

Render path (every file:line verified this session):

```
src/components/TaskPlaceholderCard.tsx:40   const t = translations[profileLanguage || 'en'] || translations.en;
src/components/TaskPlaceholderCard.tsx:428  const getStatusLabel = () => { ... return previewStatusLabel(job, { queuedAhead: ahead, lastMsgContent, dict: t }); };
src/components/TaskPlaceholderCard.tsx:587  {getStatusLabel()}   // <span> text node = the a11y "text:" line above
src/jobs/jobPreview.ts:96                   return d?.statusAnalysisCompleted || 'Analysis completed';   // <-- leak point
```

Gate definition (why it hard-fails): `golden/scorecard/instruction/i18n/GATE_I18N_A11Y_TREE.md` §PASS 3 lists `Analysis completed` as a forbidden English chrome verb; the live implementation of that list is
`prototype/tests/indo-journey-helpers.ts:55  /\bAnalysis completed\b/i` (hard fail; soft asserts are banned).
`FORBIDDEN_EN_CHROME.json` (15 incident strings) does **not** contain it — the verb regexes do.

**Falsification check (proves the missing key, not the test, was the bug):**

```
$ npx tsx /tmp/wavee-check.ts        # jobPreview + translations, { dict: {} } = pre-fix pack shape
pre-fix pack (empty dict): "Analysis completed"     # the shipped FAIL
post-fix id:               "Analisis selesai"
post-fix en:               "Analysis completed"
```

---

## 2. Keys restored (the complete `d?.…` job-chrome set read by `jobPreview.ts`)

Scanned `src/jobs/jobPreview.ts` for every `d?.…` job-chrome fallback; 9 were **missing from the pack entirely** and were restored. All are byte-identical to `85ce58b` (both `en` and `id`), placed in the pack's existing alphabetical order.

| Key | en (85ce58b = current) | id (85ce58b = current) | Reachable when |
|---|---|---|---|
| `statusAnalysisCompleted` | `Analysis completed` | **`Analisis selesai`** | job `succeeded` (jobPreview.ts:96) |
| `statusAnalysisFailed` | `Analysis failed` | `Analisis gagal` | job failed / timed-out (jobPreview.ts:63, 89) |
| `statusAnalysisCancelled` | `Analysis cancelled` | `Analisis dibatalkan` | `cancelled` / `cancel_requested` (jobPreview.ts:92; the failed branch precedes the switch) |
| `statusActionRequired` | `Action required` | `Tindakan diperlukan` | `awaiting_user` (jobPreview.ts:94) |
| `statusProcessing` | `Processing...` | `Memproses...` | unknown / `draft` status default (jobPreview.ts:98) |
| `statusAiAdvicePending` | `AI advice pending` | `Menunggu saran AI` | `succeeded` with `degradedStages` diet/dietitian (jobPreview.ts:60) |
| `statusUpdatingMealQueued` | `Updating meal • Queued` | `Memperbarui makanan • Diantrekan` | edit job queued (jobPreview.ts:68) |
| `statusUploadedQueued` | `Uploaded • Queued on server` | `Diunggah • Diantrekan di server` | queued, `queuedAhead = 0` (jobPreview.ts:75) |
| `statusWaitingAhead` | `Waiting — {count} ahead` | `Menunggu — {count} di depan` | queued behind others (jobPreview.ts:71) |

Non-missing fallbacks read by the same function were left untouched: `analysisFailed`, `updatingMeal`, `retryingAttemptNofM`, `attemptOf` (see §8 residuals).

---

## 3. Verification of the restore (mechanical, both locales)

```
python3 (regex-extract every value per key: 85ce58b vs working tree)
statusActionRequired     GOOD ['Action required','Tindakan diperlukan']                          MATCH
statusAiAdvicePending    GOOD ['AI advice pending','Menunggu saran AI']                          MATCH
statusAnalysisCancelled  GOOD ['Analysis cancelled','Analisis dibatalkan']                       MATCH
statusAnalysisCompleted  GOOD ['Analysis completed','Analisis selesai']                          MATCH
statusAnalysisFailed     GOOD ['Analysis failed','Analisis gagal']                               MATCH
statusProcessing         GOOD ['Processing...','Memproses...']                                   MATCH
statusUpdatingMealQueued GOOD ['Updating meal • Queued','Memperbarui makanan • Diantrekan']      MATCH
statusUploadedQueued     GOOD ['Uploaded • Queued on server','Diunggah • Diantrekan di server']  MATCH
statusWaitingAhead       GOOD ['Waiting — {count} ahead','Menunggu — {count} di depan']          MATCH
```

Each key now occurs exactly once in `en` and once in `id` (the parity test in `i18n.test.ts` fails otherwise). No key was invented; no Indonesian copy was authored by the model.
---

## 4. Diff scope (blast radius = 2 files, src only)

```
$ git diff --stat -- src
 src/utils/i18n.test.ts    | 72 ++++++++++++++++++++++++++++
 src/utils/translations.ts | 18 ++++++++++
 2 files changed, 90 insertions(+)
```

`src/utils/translations.ts` changes are **purely additive, alphabetically placed** (excerpt of `git diff -U1`):

```
   "status": "unknown",
+  "statusActionRequired": "Tindakan diperlukan",
+  "statusAiAdvicePending": "Menunggu saran AI",
+  "statusAnalysisCancelled": "Analisis dibatalkan",
+  "statusAnalysisCompleted": "Analisis selesai",
+  "statusAnalysisFailed": "Analisis gagal",
   "statusAtRisk": "Beresiko",
...
   "statusOverweight": "Kelebihan Berat Badan",
+  "statusProcessing": "Memproses...",
...
   "statusUnderweight": "Berat Badan Kurang",
+  "statusUpdatingMealQueued": "Memperbarui makanan • Diantrekan",
+  "statusUploadedQueued": "Diunggah • Diantrekan di server",
```

No component, no `jobPreview.ts`, no server, no script, no debug-contract file, no instruction/`gates.json` / `REQUIRED_CHROME.json` / `FORBIDDEN_EN_CHROME.json` file was touched.
(`golden/scorecard/current/**` + `result_summary/**` were **already** modified in the tree **before** this wave — a prior soak run, confirmed by `git status` taken before the first edit here.)

---

## 5. Sensor added (locks the class)

`src/utils/i18n.test.ts` → new `describe('job-card chrome i18n (jobPreview status labels)')`, 3 tests:

1. `keeps every jobPreview status key in en and id (no silent drop)` — all 9 keys exist in both locales, `id !== en`, and `id.statusAnalysisCompleted === 'Analisis selesai'`.
2. `shows the completed analyzing card in Indonesian` — `previewStatusLabel(succeededJob, { dict: translations.id }) === 'Analisis selesai'`; `en` → `Analysis completed`; no-dict → English default (so `JobSession.contract` line 118 does not regress).
3. `shows the other terminal and streaming job cards in Indonesian` — `awaiting_user` / `failed` / `queued` / `draft` / degraded-`succeeded` must return the `id` value and **must not** equal the English value; plus `queuedAhead: 2` → `Menunggu — 2 di depan` (placeholder interpolation).

Consolidated into the **existing** i18n suite (L16: no new one-off suite, no duplicated golden/debug wiring). Debug observability: the status chip is UI chrome only — it is not a `debugRunTree.ts` / `dumpContract.ts` field, so no debug-tree change is required by this fix.

```
$ npx vitest run src/utils/i18n.test.ts -t 'job-card chrome i18n' --reporter=verbose
✓ keeps every jobPreview status key in en and id (no silent drop)  2ms
✓ shows the completed analyzing card in Indonesian                 0ms
✓ shows the other terminal and streaming job cards in Indonesian   0ms
Tests  3 passed | 31 skipped (34)
```
---

## 6. Offline gate transcript

```
$ npx vitest run src/utils/i18n.test.ts src/jobs/__tests__/JobSession.contract.test.ts
 Test Files  2 passed (2)
      Tests  44 passed (44)
   Duration  399ms

$ npx tsc --noEmit
(no output)  exit 0
```

Ratchet side-effects: the `L-2` `DUMP_RATCHET_MAX = 969` leftovers assertion still passes (restored values are real copy, not Title-Case humanizations, so the leftover count did not grow); `REQUIRED_CHROME.json` (27 frozen keys) untouched and still green; `JobSession.contract` “Analysis completed” no-dict assertion still green.

---

## 7. Live evidence is still PRE-FIX (deliberate)

`golden/scorecard/current/a11y/J-ID-01-analyzing-job-card.txt:17` still reads `text: Analysis completed` — that artifact was captured **before** this fix and was **not** hand-edited (no artifact painting / no `expected.json` touch). The gate is closed at the render source (`jobPreview.ts:96` + the restored `id` pack value) and proven by the falsification in §1. The next live `id` soak (J-ID-01) regenerates that artifact; expected: `text: Analisis selesai`, and no `/Analysis completed/i` hit on the analyzing-card surface.

---

## 8. Out-of-scope residuals found in the SAME job card (NOT touched — the lock said “only the missing keys”)

These job-card chrome keys exist in the pack but are **English-filled / mangled in `id`** (i.e. *not missing*). Each has a 1-line restore available from `85ce58b`; changing them here would have broken the “touch only those missing keys” lock, so they are listed for the coordinator to queue as a follow-up wave.

| Key | current `id` | `85ce58b` `id` | Card reachability | In the gate's forbidden verb regex? |
|---|---|---|---|---|
| `updatingMeal` | `Updating meal...` | `Memperbarui makanan...` | **Reachable** — edit job `running`/`processing` (jobPreview.ts:79), rendered by `TaskPlaceholderCard` in `id` | no |
| `attemptOf` | `Attempt {current} of {max}` | `Upaya {current} dari {max}` | **Reachable** — running-card chip `TaskPlaceholderCard.tsx:592` | no |
| `attemptFailedTapRetry` | `Attempt {n} of {m} failed • Tap ` **(value truncated by the dump)** | `Attempt {n} of {m} failed • Tap "Retry" to try again` | **Reachable** — failed card `TaskPlaceholderCard.tsx:668` | no |
| `analysisFailed` | `Analysis failed` | `Analisis gagal` | now shadowed by `statusAnalysisFailed` in `jobPreview` (lines 63 / 89) | no |
| `deleteTask` | `Delete task` | `Hapus tugas` | **Visible in the same J-ID-01 artifact, line 22** (`button "Delete task"`) | no |

The J-ID-01 FAIL itself is fixed by §1–§5; the five rows above are cosmetic job-card English leaks the current gate regexes do not catch. Recommend a Wave F “job-card English-filled id residuals” (restore-only, values above) if the coordinator wants the card 100% Indonesian.

---

## 9. Working-tree state left for the coordinator

```
M  src/utils/translations.ts     (+18: 9 keys × en/id, restored from 85ce58b)
M  src/utils/i18n.test.ts        (+72: job-card chrome sensor, 3 tests)
M  golden/scorecard/current/**   (pre-existing before this wave — prior soak)
M  golden/scorecard/result_summary/**
?? golden/scorecard/current/debug/L-1-dump.json   ?? golden/scorecard/result_summary/aa0aaec/   ?? tasks/
```

`golden/scorecard/current/a11y/**` is **tracked and clean** (verified with `git status --porcelain`) — the pre-fix J-ID-01 evidence was neither edited nor re-captured.

**Not committed, not pushed** (per instruction). No `AGENTS.md` / `docs/agent/**` / `scripts/assert-*.mjs` / `specs/` edits were made, so Guard verdicts and standing rows are unchanged.
