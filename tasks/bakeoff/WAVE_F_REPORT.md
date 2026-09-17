# WAVE_F_REPORT — restore English-filled `id` job-card chrome residuals

**Date:** 2026-09-15 ~00:55–01:10 UTC (2026-09-15 ~07:55–08:10 WIB)
**Repo:** `/workspace/biomarker-and-nutrient-tracker` @ `main` = `47390e6` (working tree = the fix below, **not committed / not pushed**, left dirty for the overnight coordinator)
**Task:** restore-not-invent the 5 keys named in `WAVE_F_JOB_CARD_RESIDUALS.md` **plus every same-class sibling I could prove**, in both `en` and `id`, byte-for-byte from `85ce58b`; extend the Wave E sensor; offline gates only.
**Model:** Cline Free **DeepSeek V4.1 Flash** (`cline-free/deepseek-v4.1-flash`, thinking high) per the wave-card lock — `deepseek-v4-flash` / V4 were never used. Vertex **OFF**: no live Gemini/Vertex call, no live Playwright soak.
**Model caveat (honesty):** the model id is not introspectable from inside the session; this states only that no other model/endpoint was invoked by the work below.

---

## VERDICT: **PASS** (offline) — 32 values restored byte-for-byte from `85ce58b`, class locked by sensor

| Requirement | Result |
|---|---|
| 5 named keys restored (`updatingMeal`, `attemptOf`, `attemptFailedTapRetry`, `analysisFailed`, `deleteTask`) | ✅ **PASS** — id values byte-identical to `85ce58b` (§2, §3) |
| Same-class siblings restored (restore-only, proven not invented) | ✅ **PASS** — 22 further `id` keys + 4 further `en` keys; **27 id + 5 en = 32 values** |
| Touch only those values (+/− equal, no key churn) | ✅ PASS — `src/utils/translations.ts` diff is exactly **+32 / −32**; all 64 changed lines are key-value lines; every changed key name is identical on both sides (0 key add/remove/rename) |
| `id !== en` for every restored `id` key | ✅ PASS — 27/27 (`§3 D`) |
| Sensor locking the class | ✅ PASS — 6 new tests in `src/utils/i18n.test.ts` (127 added lines, 0 removed); existing 44 tests stay green |
| Falsification of the sensor (does it actually catch the bug?) | ✅ PASS — mutating `id.updatingMeal` back to English fails **3** sensor tests (§3 G) |
| Offline gates | ✅ vitest `src/utils/i18n.test.ts` + `src/jobs/__tests__/JobSession.contract.test.ts` → **2 files / 50 tests passed**; `npx tsc --noEmit` → **exit 0** |
| Live Playwright vs Render | ⏭ **not run** (per lock: offline only; the stored `golden/scorecard/current/a11y/` artifact is pre-fix, §1) |
| Commit / push | ⏭ **not done** (deliberate) |

---

## 1. The class (proven, not assumed)

`1c868ab` (i18n "dump" sweep — the same commit Wave C documented and Wave E partially repaired) regenerated `src/utils/translations.ts` as an alphabetized **dump**: `85ce58b` has `1160` keys per locale with **bare** keys (`updatingMeal:`), HEAD has `1977` per locale with **quoted** keys (`"updatingMeal":`). Where a dump value could not be recovered, the key was left **present but carrying the ENGLISH copy in `id`** — i.e. `id === en` while `85ce58b` has a distinct Indonesian string. That class does **not** trip the i18n parity test (keys exist in both packs) and largely does not trip the a11y verb regexes either, so it survived Wave E.

Product evidence — the captured pre-fix id-locale UI tree still leaks English chrome from exactly this class:

```text
golden/scorecard/current/a11y/J-ID-01-analyzing-job-card.txt:16
  - img "Meal Preview"                 <-- mealPreview  (id should be "Pratinjau Makanan")
golden/scorecard/current/a11y/J-ID-01-analyzing-job-card.txt:22
  - button "Delete task"               <-- deleteTask   (id should be "Hapus tugas")
```

Render path (files/lines re-verified this session):

```text
src/components/TaskPlaceholderCard.tsx:40    const t = translations[profileLanguage || 'en'] || translations.en;
src/components/TaskPlaceholderCard.tsx:428   getStatusLabel() -> previewStatusLabel(job, {... dict: t})
src/components/TaskPlaceholderCard.tsx:591   (t.attemptOf || 'Attempt {current} of {max}').replace(...)
src/components/TaskPlaceholderCard.tsx:853   title={t.deleteTask || "Delete task"}
src/jobs/jobPreview.ts                        d?.updatingMeal / d?.attemptOf / d?.attemptFailedTapRetry ...
```

**Scan basis (same as Wave E):** every key read as `t.…` in `src/components/TaskPlaceholderCard.tsx` and every `d?.…` in `src/jobs/jobPreview.ts`. Classification of each candidate key:
- **in class** ⇔ `HEAD.id[k] === HEAD.en[k]` (English filled into `id`) **and** `85ce58b.id[k] !== 85ce58b.en[k]` (a real Indonesian value existed to restore).
- Result: **27 `id` keys in class**, all restored. Plus **5 `en` keys** whose dumped `en` value was mangled/truncated (details in §2).

One mangling signature worth recording: for `attemptFailedTapRetry` the dump **truncated the string at the embedded escaped quote** — HEAD `en`/`id` were `"Attempt {n} of {m} failed • Tap "` / `"Upaya {n} dari {m} gagal • Ketuk "`. That is why the wave card saw a "truncated dump value"; the residual `"` is the smoking gun of a naive dumper, not a translation decision.

---

## 2. Change set (what was edited, exactly)

```text
$ git diff --stat -- src/utils/translations.ts src/utils/i18n.test.ts
 src/utils/i18n.test.ts    | 127 ++++++++++++++++++++++++++++++++++++++++++++++
 src/utils/translations.ts |  64 +++++++++++------------
 2 files changed, 159 insertions(+), 32 deletions(-)
```

`src/utils/translations.ts` = **+32 / −32** (value-only). `src/utils/i18n.test.ts` = **+127 / −0** (append-only sensor).

### 2a. `id` block — 27 values restored (★ = one of the 5 keys named in the wave card)

| key | HEAD `id` (bad: English filled in) | restored `id` (**= `85ce58b`**) |
|---|---|---|
| `analysisFailed` ★ | `Analysis failed` | `Analisis gagal` |
| `analyzingMedicalData` | `Analyzing medical data...` | `Menganalisis data medis...` |
| `analyzingYourMeal` | `Analyzing your meal...` | `Menganalisis makanan Anda...` |
| `attemptFailedTapRetry` ★ | `Attempt {n} of {m} failed • Tap ` *(truncated at the quote)* | `Upaya {n} dari {m} gagal • Ketuk "Coba Lagi" untuk mencoba lagi` |
| `attemptOf` ★ | `Attempt {current} of {max}` | `Upaya {current} dari {max}` |
| `calculating` | `Calculating...` | `Menghitung...` |
| `chattingEllipsis` | `Chatting...` | `Mengobrol...` |
| `confirmPortionToFinish` | `Please confirm portion size to finish logging your meal.` | `Harap konfirmasi ukuran porsi untuk menyelesaikan pencatatan makanan Anda.` |
| `deleteTask` ★ | `Delete task` | `Hapus tugas` |
| `healthPreparationChat` | `Health Preparation Chat` | `Obrolan Persiapan Kesehatan` |
| `macrosUpdatedRetryAdvice` | `Macros updated — coaching may reflect a previous portion. Use Retry Advice to refresh.` | `Makronutrisi diperbarui — panduan mungkin mencerminkan porsi sebelumnya. Gunakan Coba Lagi Saran untuk memperbarui.` |
| `mealComparisonRequest` | `Meal Comparison Request` | `Permintaan Perbandingan Makanan` |
| `mealPreview` | `Meal Preview` | `Pratinjau Makanan` |
| `medicalDataRequest` | `Medical Data Request` | `Permintaan Data Medis` |
| `noImage` | `No Image` | `Tidak Ada Gambar` |
| `optionN` | `Option N` | `Opsi {n}` |
| `pickPortion` | `Pick Portion` | `Pilih Porsi` |
| `portionChoiceNeeded` | `Portion Choice Needed` | `Perlu Pilihan Porsi` |
| `portionSelectionNeeded` | `Portion Selection Needed` | `{name} — Perlu Pemilihan Porsi` |
| `retry` | `Retry` | `Coba Lagi` |
| `retryAdvice` | `Retry Advice` | `Coba Lagi Saran` |
| `retryingAiAdvice` | `Retrying Ai Advice` | `Mencoba lagi saran AI (Upaya {n})...` |
| `retryingAnalysisAttempt` | `Retrying Analysis Attempt` | `Mencoba lagi analisis (Upaya {n})...` |
| `selectPortion` | `Select Portion` | `Pilih Porsi` |
| `updatingMeal` ★ | `Updating meal...` | `Memperbarui makanan...` |
| `uploadedSafeToClose` | `Uploaded to server • Safe to close browser & check back later` | `Diunggah ke server • Aman untuk menutup peramban & cek kembali nanti` |
| `uploadingKeepTabOpen` | `Uploading to server… Keep this tab open` | `Mengunggah ke server… Tetap buka tab ini` |

Timing chrome `attemptOf` and `attemptFailedTapRetry` are the two the J-ID-01 card sits on for minutes ("Attempt 1 of 3" → "Upaya 1 dari 3").

### 2b. `en` block — 5 values restored (the dump had mangled `en` on the same-class siblings)

| key | HEAD `en` (bad) | restored `en` (**= `85ce58b`**) |
|---|---|---|
| `attemptFailedTapRetry` ★ | `Attempt {n} of {m} failed • Tap ` *(truncated)* | `Attempt {n} of {m} failed • Tap "Retry" to try again` |
| `optionN` | `Option N` | `Option {n}` |
| `portionSelectionNeeded` | `Portion Selection Needed` | `{name} — Portion Selection Needed` |
| `retryingAiAdvice` | `Retrying Ai Advice` | `Retrying AI advice (Attempt {n})...` |
| `retryingAnalysisAttempt` | `Retrying Analysis Attempt` | `Retrying analysis (Attempt {n})...` |

Note `optionN`/`portionSelectionNeeded`/`retrying*` were **the same class on the `en` side** (the dump dropped the `{n}`/`{name}` placeholder or left the Title-Case key name), and `en` is the source of truth for the app's English chrome and for the `|| fallback` literals in `TaskPlaceholderCard.tsx` — so they were restored too. The four other named keys (`updatingMeal`, `attemptOf`, `analysisFailed`, `deleteTask`) needed **no** `en` change: their HEAD `en` was already identical to `85ce58b` (verified, §3 C).

### 2c. Sample hunk (proves the shape: value-only, quoted keys untouched)

```diff
   "attemptCount": "Attempt Count",
-  "attemptFailedTapRetry": "Attempt {n} of {m} failed • Tap ",
+  "attemptFailedTapRetry": "Attempt {n} of {m} failed • Tap \"Retry\" to try again",
   "attemptOf": "Attempt {current} of {max}",
   "attempts": "Attempts",
```
```diff
   "updatedProfile": "Updated Profile",
-  "updatingMeal": "Updating meal...",
+  "updatingMeal": "Memperbarui makanan...",
   "updatingMealAnalysis": "Updating Meal Analysis",
```

---

## 3. Proofs (each claim → the check that was actually run)

Baseline in all checks is `git show 85ce58b:src/utils/translations.ts` (`git cat-file -t 85ce58b` → `commit`). HEAD is `47390e6`. Values were compared as **decoded runtime strings** (a unified parser handles `85ce58b`'s bare keys and HEAD's quoted keys, and `JSON.parse('"' + body + '"')` undoes source escaping), never as raw source text — raw-text comparison is exactly what produced the `\"` / `\\"` confusion while building the sensor.

**A. Restore fidelity — every restored value == `85ce58b` == live pack**
```text
tables rebuilt: id=27 en=5; verified table==pack==85ce58b; failures=0
applied changes: current==85ce58b AND was drifted at HEAD -> true (32 changes checked)
counts  baseline en/id: 1160/1160   HEAD: 1977/1977   current: 1977/1977
id keys english-filled at HEAD (id===en): 27 of 27
id keys distinct from en at baseline: 27
en keys restored (were drifted/mangled): 5
```

**B. Named keys, one by one** (`true` = assertion holds):

| key | block | HEAD == `85ce58b`? | current == `85ce58b`? | changed in this wave | `id === en` @HEAD | `id !== en` @current |
|---|---|---|---|---|---|---|
| `updatingMeal` | id | false | **true** | yes | true | true |
| `updatingMeal` | en | true | true | no (already correct) | — | — |
| `attemptOf` | id | false | **true** | yes | true | true |
| `attemptOf` | en | true | true | no | — | — |
| `attemptFailedTapRetry` | id | false | **true** | yes | true | true |
| `attemptFailedTapRetry` | en | false | **true** | yes (truncation repaired) | — | — |
| `analysisFailed` | id | false | **true** | yes | true | true |
| `analysisFailed` | en | true | true | no | — | — |
| `deleteTask` | id | false | **true** | yes | true | true |
| `deleteTask` | en | true | true | no | — | — |

**C. Diff shape — value-only, no key churn**
```text
changed lines: 32 deletions / 32 insertions   (git diff -U0 | grep -c '^-[^-]' / '^+[^+]')
lines that begin a key entry (^[-+] *"key":): 64  == 32 + 32
```
Every changed line is a key-value line and the key name is byte-identical on both sides ⇒ no key added, removed or renamed. (The 22 sibling keys already existed; they simply carried English `id` copy.)

**D. `id !== en` for all 27** — asserted inside the sensor (`expect(id[key]).not.toBe(en[key])`, 27 keys) and independently by check A's classification.

**E. End-to-end render (not just the pack)** — a `tsx` harness drives the *real* `previewStatusLabel`/dict lookups exactly as the card does:
```text
status chip: running (edit)          id: Memperbarui makanan...        en: Updating meal...
status chip: running attempt 1/3     id: Upaya 1 dari 3                en: Attempt 1 of 3
failed footer att {n}/{m}            id: Upaya 2 dari 3 gagal • Ketuk "Coba Lagi" untuk mencoba lagi
                                     en: Attempt 2 of 3 failed • Tap "Retry" to try again
delete button title                  id: Hapus tugas                   en: Delete task
awaiting_user hint                   id: Harap konfirmasi ukuran porsi untuk menyelesaikan pencatatan makanan Anda.
queued footer                        id: Diunggah ke server • Aman untuk menutup peramban & cek kembali nanti
comparison option chip               id: Opsi 2                        en: Option 2
retry advice                         id: Mencoba lagi saran AI (Upaya 2)...    en: Retrying AI advice (Attempt 2)...
stale macros banner                  id: Makronutrisi diperbarui — panduan mungkin mencerminkan porsi sebelumnya...
```
`deleteTask id.endsWith english? false` · `updatingMeal id english? false` — the two strings visible in the pre-fix J-ID-01 tree (§1) are gone.

**F. Sensor content** — new `describe('job-card chrome i18n (English-filled id residuals — Wave F)')` in `src/utils/i18n.test.ts` (+127/−0, 6 tests):
1. `restores every scanned job-card key byte-for-byte from 85ce58b and id !== en` — loops the 27-key table.
2. `restores the five keys named in the Wave F card` — the wave card's 5 keys pinned literally.
3. `restores the en side the dump mangled on the same-class siblings` — the 5-key `en` table.
4. `keeps the placeholders the job card interpolates (no silent no-op replace)` — `{n}`/`{m}`/`{name}`/`{current}`/`{max}` for `optionN`, `retryingAnalysisAttempt`, `portionSelectionNeeded`, `attemptFailedTapRetry`.
5. `renders the edit/retry running job card in Indonesian` — end-to-end through `previewStatusLabel` (`Memperbarui makanan...`, `Upaya 1 dari 3`, plus the untouched `Mencoba lagi (percobaan 2/3)...`).
6. `never regresses a scanned key back to the Title-Case humanization of its key` — the `TRANSLATION_DUMP` rule from `REQUIRED_CHROME.json`'s law text, applied to the scanned keys.

Every table value was emitted with `JSON.stringify(runtimeValue)` from the live pack, so the `attemptFailedTapRetry` literal is escaped correctly (`… Ketuk \"Coba Lagi\" …` → codepoints `75 101 116 117 107 32 92 34` = `Ketuk \"`) and the table is re-parsed by the test at run time (an unescaped row would fail as a syntax error, not silently pass).

**G. Falsification — the sensor must fail on the bug it locks.** Temporarily setting `"updatingMeal": "Updating meal..."` back in `id` made **3** tests fail:
```text
× restores every scanned job-card key byte-for-byte from 85ce58b and id !== en
× restores the five keys named in the Wave F card
× renders the edit/retry running job card in Indonesian
AssertionError: id.updatingMeal drifts from 85ce58b: expected 'Updating meal...' to be 'Memperbarui makanan...'
Test Files 1 failed (1) | Tests 3 failed | 37 passed (40)
```
Then the file was restored and `md5sum` matched the pre-mutation file exactly (`5ec43c9f…`), diffstat back to `32 32`. The sensor is not vacuous.

**H. No collateral pins of the old (bad) values.** Grep over `src/ prototype/ scripts/ golden/scorecard/instruction/` for the old strings returns only (i) the intended English `en`-block values in `translations.ts`, (ii) the `|| 'Attempt {current} of {max}'`-style **English fallback literals** in `TaskPlaceholderCard.tsx` (left untouched — they are unreachable in `id` now that the keys exist, and they are what `en` renders anyway), and (iii) the new sensor's `en` expectations. Hits in `.aider.chat.history.md` are a chat transcript, not a test or fixture.

**I. Ratchet moved the right way.** `TRANSLATION_DUMP` leftovers over camelCase keys went `969 → 956` (max allowed `969`); `id`/`en` parity unchanged at `1977/1977`; and none of the 32 touched keys appears in the frozen `golden/scorecard/instruction/i18n/REQUIRED_CHROME.json` list (intersection = `[]`), so that gate is untouched by construction and still enforced by `src/utils/i18n.test.ts` (green).

---

## 4. Offline gates run

```text
$ npx vitest run src/utils/i18n.test.ts src/jobs/__tests__/JobSession.contract.test.ts
 Test Files  2 passed (2)
      Tests  50 passed (50)          <- Wave E left this pair at 44; +6 new Wave F tests
   Duration  408ms

$ npx tsc --noEmit
tsc exit=0
```

`JobSession.contract.test.ts` was included even though no job-lifecycle file was touched (`L1` blast radius respected — only `translations.ts` plus the test file changed), because it is the standing guard for the job-card surface this chrome lives on. The Wave E `status*` tests remain green.

Deliberately **not** run: `npm test` (~97 files, L11), the live Playwright/`id` soak (Vertex OFF per the wave card), and `npm run scorecard:*` (it writes `golden/scorecard/current/`, which must not be touched).

---

## 5. Documented exclusions and harness notes (honesty section)

### 5a. The two keys the scan flags but this wave did **not** change

| key | why not restored |
|---|---|
| `retryingAttemptNofM` | **No `85ce58b` baseline** — the key does not exist in the baseline pack (checked: `in 85ce58b? false`). HEAD/current `en` = `Retrying (attempt {n}/{max})...`, `id` = `Mencoba lagi (percobaan {n}/{max})...`. It is *not* English-filled (`id !== en`) and carries the right placeholders, so there is nothing to restore and nothing invented. |
| `stuckFor` | Exists in the baseline and its `en` already matches (`Stuck for {time} — this is longer than normal`), but its `id` differs in wording: baseline `Tertahan selama {time} — ini lebih lama dari biasanya` vs HEAD/current `Tertahan selama {time} — lebih lama dari biasanya` (baseline is more formal: "ini lebih lama" vs "lebih lama"). The `id` is **already Indonesian**, so it is not in this class; the wording drift is a judgement call left for the coordinator rather than a silent rewrite. |

Post-restore drift re-scan of the scanned keys: **`total drift 2`** — exactly those two, both non-English, both intentional, both explained above. Everything else in the scan basis now matches the baseline.

### 5b. Harness coupling to watch (live-only, no offline gate is red)

The restored strings make an `id`-locale card *more* Indonesian, which the a11y verb regexes reward, but three live-harness helpers search for the old English wording. **None of them is an offline gate, and none was edited** (editing them would change what "pass" means without a live run to validate — out of scope per the wave card):

1. `prototype/tests/indo-journey-helpers.ts:605` — `page.getByText(/Attempt \d of \d|Retrying|Memulai ulang/i)` (the retry-banner wait). An `id` card now says `Upaya 1 dari 3` / `Mencoba lagi (percobaan 2/3)...`, so this optional branch simply will not engage. **Non-fatal by construction:** it is guarded by `if (await retryBanner.isVisible({ timeout: 2000 }).catch(() => false))`, and the hard "not in progress" wait at line 602 (`/Starting cloud|Menganalisis|Analyzing|Updating|Memperbarui/i`) still matches `Memperbarui makanan...` → `Memperbarui`. Suggested one-line follow-up for the harness owner: add `|Upaya \d dari \d|Mencoba lagi` to that regex.
2. `prototype/tests/indo-journey-helpers.ts:627,718` — `'button:has-text("Select Portion")'` still resolves in `id` because the very same `first([...])` list also contains `'button:has-text("Pilih Porsi")'`. **Safe as-is.**
3. `prototype/tests/portion-clarify.live.spec.ts:166` — `getByText(/Portion Selection Needed|Serving size check|How much of|Pick Portion/i)` has no Indonesian alternative; line 212 does (`…|portion|porsi`, which matches `{name} — Perlu Pemilihan Porsi`). The spec drives the UI with English prompts and has no explicit locale switch, so a normal `en` run still matches the restored `en` value `{name} — Portion Selection Needed` (the phrase is a substring). Only an explicit `id`-locale run of line 166 would need `|Perlu Pemilihan Porsi` added.

Everything else that pinned English for these keys was already tolerant: `REQUIRED_CHROME.json` does not list any of the 32 keys.

---

## 6. Blast radius — what was and was not touched

**Modified (2 files, both mine):**
```text
M src/utils/translations.ts    +32 / -32   (value-only, 27 id + 5 en)
M src/utils/i18n.test.ts       +127 / -0   (Wave F sensor, append-only)
```

**Not touched (verified by `git status --short`):** `src/components/TaskPlaceholderCard.tsx`, `src/jobs/jobPreview.ts`, every job-lifecycle file (`JobStore.ts`, `SupabaseJobSync.ts`, `JobQueueRunner.ts`, `App.tsx`, `LogChat.tsx`, `TaskPlaceholderCard*` logic), `scratch_keys.json` (tracked, unmodified, mtime `Sep 13 22:00` — i.e. before this wave), `AGENTS.md`, `docs/agent/**`, `scripts/assert-*.mjs`, `plan/**`, `specs/**`, and both frozen lists (`REQUIRED_CHROME.json`, `FORBIDDEN_EN_CHROME.json`). No key was added, removed or renamed; no pack was regenerated.

`git status --short` also shows these **pre-existing** dirt entries, which were already dirty when this wave started and were **not** produced by it (they belong to earlier scorecard runs; the overnight coordinator expects the tree dirty):
```text
 M golden/scorecard/current/MASTER_SCORECARD_DEBUG.json        M golden/scorecard/result_summary/LATEST.json
 M golden/scorecard/current/MASTER_SCORECARD_DEBUG.md          M golden/scorecard/result_summary/LATEST.md
 M golden/scorecard/current/RUN.json                           ?? golden/scorecard/current/debug/L-1-dump.json
 M golden/scorecard/current/live/{biomarker_health,contract,food_health,origin_shell,probes,scorecard_contract}.*
                                                               ?? golden/scorecard/result_summary/aa0aaec/
                                                               ?? tasks/
```

**No commit, no push** — the tree is intentionally left dirty for the overnight coordinator, exactly as the wave card requires.

---

## 7. Reproduce (all offline)

```bash
cd /workspace/biomarker-and-nutrient-tracker
git show 85ce58b:src/utils/translations.ts > /tmp/t_85ce58b.ts     # baseline
git show HEAD:src/utils/translations.ts  > /tmp/t_head.ts          # .. and 47390e6 is HEAD

# fidelity: every restored value == 85ce58b == live pack (decoded runtime strings)
npx tsx -e "import {localePacks} from './src/utils/translations';
            console.log(JSON.stringify({id:localePacks.id,en:localePacks.en}))" > /tmp/packs.json
node /tmp/verify_final.mjs      # -> applied changes: current==85ce58b AND was drifted at HEAD -> true (32)
node /tmp/cmp.mjs               # -> total drift 2 (the two documented exclusions, §5a)

# gates
npx vitest run src/utils/i18n.test.ts src/jobs/__tests__/JobSession.contract.test.ts   # 50 passed
npx tsc --noEmit                                                                      # exit 0

# end-to-end card chrome (id vs en) through the real helpers
npx tsx /tmp/card_chrome.ts
```

Scratch scripts live in `/tmp` (`t_85ce58b.ts`, `t_head.ts`, `packs.json`, `applied.json`, `fix_tables.mjs`, `verify_final.mjs`, `verify_vals.mjs`, `cmp.mjs`, `gen_report_table.mjs`, `card_chrome.ts`) — they are **not** part of the repo.

---

## 8. Follow-ups (for the coordinator, not done here)

1. **Live J-ID-01 soak** to regenerate `golden/scorecard/current/a11y/J-ID-01-analyzing-job-card.txt` — the stored artifact is pre-fix and still shows `img "Meal Preview"` (line 16) and `button "Delete task"` (line 22).
2. **Harness regex alternatives** for the three live-only call sites in §5b (one-line each; only the first can actually skip a step, and it is already non-fatal).
3. **`stuckFor` wording** — decide whether the `id` should return to the baseline's `… — ini lebih lama dari biasanya` (§5a). It is Indonesian either way, so no chrome leak.
4. **Remaining `TRANSLATION_DUMP` leftovers** — 956 Title-Case humanizations (e.g. `"attemptCount": "Attempt Count"`, `"attempts": "Attempts"`, `"updatingMealAnalysis": "Updating Meal Analysis"`) are still in the pack. They are outside this wave's scan basis (not read by `TaskPlaceholderCard.tsx`/`jobPreview.ts`), outside `REQUIRED_CHROME.json`, and were deliberately not touched: this wave is restore-only, and inventing Indonesian for 956 keys is exactly what the wave card forbids.

---

**Bottom line:** PASS offline. 32 values restored byte-for-byte from `85ce58b` (`+32/−32`, value-only, no key churn), a 6-test sensor added and falsified, **zero** English-filled `id` chrome left in the scanned job-card surface (`drift 2`, both documented and non-English), vitest 50/50 and `tsc` clean, tree left dirty with no commit.
