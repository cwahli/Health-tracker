# WAVE_H_REPORT — S-1 leftover English fallbacks (wire existing keys, restore dump-drifted values)

**Date:** 2026-09-15 ~01:38–01:52 UTC (2026-09-15 ~08:38–08:52 WIB)
**Repo:** `/workspace/biomarker-and-nutrient-tracker` @ `main` = `307d96f` (working tree = the fix below, **not committed / not pushed**, left dirty for the overnight coordinator)
**Task:** `WAVE_H_S1_LEFTOVERS.md` — restore-not-invent the S-1 leftover chrome (translations + call sites), touch minimal files, add a sensor if a restore happened, offline gates, write this report.
**Model:** per the wave-card lock `cline-free/deepseek-v4.1-flash` (thinking high) — the process table confirms the session command line; `deepseek-v4-flash` / V4 were never used. Vertex **OFF**: no live Gemini/Vertex call. The Playwright shell-smoke run is **stub-only, no Gemini** (`scripts/assert-shell-smoke.mjs`).

---

## VERDICT: **PASS** — 10 drifted values restored byte-for-byte, 9 hardcoded English literals wired to keys, class locked by a falsified sensor

| Requirement | Result |
|---|---|
| Item 1 — `FoodHistoryTab.tsx` hardcodes `1 serving` | ✅ **PASS** — 3 sites wired to `t.oneServingDefault` (`:220`, `:873`, `:891`) |
| Item 2 — `FoodCard.tsx` `t.preparationLabel \|\| 'Preparation:'` | ⚠️→✅ **PASS (with a correction)** — the key *was* drifted (`en`/`id`), so BOTH value and call site were fixed: `en "Preparation:"`, `id "Persiapan:"` restored, literal removed |
| Item 3 — `LogChat.tsx` `viewDiagnosticLogs` (+ title) fallbacks | ⚠️→✅ **PASS (with a correction)** — the two *labels* were never drifted; the two **titles had drifted**, and all 4 call-site literals were the actual defect. Titles restored, 4 literals removed |
| Item 4 — other Wave D sites (same class & cheap?) | ✅ 1 fixed (`NutritionDataBrowserModal.tsx:292`, §3.4) · 5 listed as leftovers with reasons (§6) |
| Value-only, minimal files | ✅ PASS — `src/utils/translations.ts` diff = exactly **+10 / −10**; all 20 changed lines are `"key": "value",` lines, **0** non-value lines, 0 key add/remove/rename (§2) |
| Restored values byte-identical to the pre-dump baseline | ✅ PASS — drift scan: **named-surface drifted (en+id) = 0** (§2, §5) |
| No inventing | ✅ PASS — every restored string exists in `bca0f80~1`; nothing was translated or composed by this wave |
| Sensor for the class | ✅ PASS — 2 new tests in `src/utils/i18n.test.ts` (+53 lines, 0 removed); file goes 40 → 42 tests |
| Falsification (does the sensor actually catch the bug?) | ✅ PASS — re-introducing the value drift fails test A; re-introducing the literal fails test B; both reverted green (§4) |
| Offline gates | ✅ vitest `src/utils/i18n.test.ts` + `src/jobs/__tests__/JobSession.contract.test.ts` → **2 files / 52 tests passed**; `npx tsc --noEmit` → **exit 0** |
| Component gate (unplanned, free) | ✅ `node scripts/assert-shell-smoke.mjs` → **9 passed**, `PASS shell-smoke`, twice (before/after the last edit), against the live Vite dev server (§5) |
| Commit / push | ⏭ **not done** (deliberate, wave card) |

### Correction to the wave card (provenance)

The card says “restore from `85ce58b`” / “if drifted”. **These keys do not exist in `85ce58b`** — they were introduced later (`74ac4cf` Sep 5, `afefa53` Sep 6) and only then mangled by the Sep 12 dump commit `bca0f80`. The authoritative **and self-contained** restore source is therefore **`bca0f80~1`** (immediately pre-dump). Wave F used `85ce58b` because *its* keys did exist there; this wave's keys do not. Using `bca0f80~1` is the same *method* (restore-not-invent) with the correct *source*.

## 1. The class (proven, not assumed)

`bca0f80` (the Sep 12 `TRANSLATION_DUMP`-style sweep) regenerated the pack as an alphabetized dump: where a value could not be recovered it was replaced by a **humanized key name** (`"Nutrition calculation"` → `"Nutrition Calculation"`, `"Verdict:"` → `"Verdict"`) or, in `id`, by the English string. That class does not trip key parity and mostly does not trip the a11y regexes, so it survives earlier waves.

Three-way evidence per key (`base` = `bca0f80~1`, `dump` = `bca0f80`, `head` = `307d96f` = pre-edit HEAD, `live` = this wave's result). Raw output: `/tmp/waveh/keys_classify.txt`.

| key | en: base → head (dump) | id: base → head (dump) | class |
|---|---|---|---|
| `preparationLabel` | `"Preparation:"` → `"Preparation"` | `"Persiapan:"` → `"Persiapan"` | DUMP_ARTIFACT / UNTOUCHED_AFTER_DUMP |
| `oneServingDefault` | `"1 serving"` → `"1 serving (default)"` | `"1 porsi"` → `"1 porsi (standar)"` | DUMP_ARTIFACT / UNTOUCHED_AFTER_DUMP |
| `viewDiagnosticLogsTitle` | `"View full system and agent logs in unified modal"` → `"View step-by-step diagnostic and execution trace"` | `"Lihat log sistem dan agen lengkap dalam modal terpadu"` → `"Lihat jejak eksekusi dan diagnostik langkah demi langkah"` | DUMP_ARTIFACT / UNTOUCHED_AFTER_DUMP |
| `downloadDebugLogsTitle` | `"Download complete raw debug logs and diagnostics"` → `"Download comprehensive diagnostic session log JSON"` | `"Unduh log debug mentah lengkap dan diagnostik"` → `"Unduh JSON log diagnostik sesi lengkap"` | DUMP_ARTIFACT / UNTOUCHED_AFTER_DUMP |
| `viewDiagnosticLogs` | `"View Diagnostic Logs"` (no drift) | `"Lihat Log Diagnostik"` (no drift) | NO_DRIFT_AT_DUMP → the defect was the *literal* |
| `downloadDebugLogs` | `"Download Debug Logs"` (no drift) | `"Unduh Log Debug"` (no drift) | NO_DRIFT_AT_DUMP → the defect was the *literal* |
| `downloadDebugLog` | `"Download Debug Log"` → dump `"Download Debug Logs"` → head `"Download Debug Log"` | `"Unduh Log Debug"` → head `"Unduh Log Debug"` | POST_DUMP revert (head == base) → **left untouched** |
| `browserServingDefaulted` *(found this wave, §3.4)* | `"Defaulted serving size to {label}"` → `"Browser Serving Defaulted"` (placeholder **lost**) | `"Ukuran saji default ke {label}"` → `"Browser Serving Defaulted"` (**`id === en` leak**) | DUMP_ARTIFACT / UNTOUCHED_AFTER_DUMP |

Hypothesis (labelled as such, not acted on): `oneServingDefault`'s dump value `"1 serving (default)"` is byte-identical to the hardcoded default label in `src/utils/servingSizeDefaults.ts:17`, suggesting the dump sourced some values from code literals rather than from the pack.

`id === en` was checked explicitly (`/tmp/waveh/placeholder_audit.ts`): the dump left **716** `id` values equal to their English string, and **109** values (en=55, id=54) that **lost their `{placeholder}` tokens** — `browserServingDefaulted` is one of those 109. Both are follow-up fuel, not this wave's scope.

---

## 2. Values restored (10 lines, value-only)

Source: `git show bca0f80~1:src/utils/translations.ts`. All restored values are **byte-identical** to that baseline:

| key | en restored | id restored |
|---|---|---|
| `preparationLabel` | `Preparation:` | `Persiapan:` |
| `oneServingDefault` | `1 serving` | `1 porsi` |
| `viewDiagnosticLogsTitle` | `View full system and agent logs in unified modal` | `Lihat log sistem dan agen lengkap dalam modal terpadu` |
| `downloadDebugLogsTitle` | `Download complete raw debug logs and diagnostics` | `Unduh log debug mentah lengkap dan diagnostik` |
| `browserServingDefaulted` | `Defaulted serving size to {label}` | `Ukuran saji default ke {label}` |

`viewDiagnosticLogs` / `downloadDebugLogs` needed **no value change** (never drifted) — see §3.3.

Proof of minimality (`git diff -U0 src/utils/translations.ts`, counted):

```text
non key:value diff lines = 0        # every changed line matches ^[+-]\s*"[A-Za-z0-9_]+": ".*",?$
src/utils/translations.ts | 20 +++++------   # 10 insertions / 10 deletions = 5 key pairs
```

Runtime read-back through the real helpers (`npx tsx /tmp/waveh/chrome.ts`), `fr`/`zh` shown as fallback checks:

```text
--- en ---
  manual-log quantity  : "1 serving"
  preparation line     : "🔥 Preparation: Pan-seared (grilled)"
  debug buttons        : {"download":"Download Debug Logs","downloadTitle":"Download complete raw debug logs and diagnostics","viewLogs":"View Diagnostic Logs","viewLogsTitle":"View full system and agent logs in unified modal"}
  serving-default banner: "Defaulted serving size to 1 serving (restaurant prepared)"
--- id ---
  manual-log quantity  : "1 porsi"
  preparation line     : "🔥 Persiapan: Pan-seared (grilled)"
  debug buttons        : {"download":"Unduh Log Debug","downloadTitle":"Unduh log debug mentah lengkap dan diagnostik","viewLogs":"Lihat Log Diagnostik","viewLogsTitle":"Lihat log sistem dan agen lengkap dalam modal terpadu"}
  serving-default banner: "Ukuran saji default ke 1 serving (restaurant prepared)"
--- fr / zh ---  (fall back to en values, no undefined, no key leak)
  manual-log quantity  : "1 serving"
  preparation line     : "🔥 Preparation: Pan-seared (grilled)"
```

---

## 3. Call sites wired (9 hardcoded English literals removed, 4 files)

### 3.1 `src/components/FoodHistoryTab.tsx` — 3 sites (item 1)

```diff
-    quantity: '1 serving',                                   // :220  (new manual-log default state)
+    quantity: t.oneServingDefault,
-        quantity: manualLog.quantity || '1 serving',         // :873  (save path)
+        quantity: manualLog.quantity || t.oneServingDefault,
-      quantity: '1 serving',                                 // :891  (quick-log default)
+      quantity: t.oneServingDefault,
```

`t` already existed in this component (`const t = translations[...]`), so this is a pure value swap.

### 3.2 `src/components/chat-cards/FoodCard.tsx` — 1 site (item 2)

```diff
-🔥 {t.preparationLabel || 'Preparation:'} {msg.data?.pendingFoodLog.cookingMethod}
+🔥 {t.preparationLabel} {msg.data?.pendingFoodLog.cookingMethod}
```

The literal was byte-identical to the restored `en` value, so `en` rendering is unchanged; `id` now renders `🔥 Persiapan: …` instead of `🔥 Preparation: …`.

### 3.3 `src/components/LogChat.tsx` — 4 sites (item 3)

```diff
-  title={t.downloadDebugLogsTitle || 'Download complete raw debug logs and diagnostics'}
+  title={t.downloadDebugLogsTitle}
-  <span>{t.downloadDebugLogs || t.downloadDebugLog || 'Download Debug Logs'}</span>
+  <span>{t.downloadDebugLogs || t.downloadDebugLog}</span>
-  title={t.viewDiagnosticLogsTitle || 'View full system and agent logs in unified modal'}
+  title={t.viewDiagnosticLogsTitle}
-  <span>{t.viewDiagnosticLogs || 'View Diagnostic Logs'}</span>
+  <span>{t.viewDiagnosticLogs}</span>
```

Only the **literals** were removed. `t.downloadDebugLog` was deliberately **kept** — it is a real key (`en "Download Debug Log"` / `id "Unduh Log Debug"`, un-drifted), not dead code, so removing it would have been structural churn beyond "wire-not-invent".

### 3.4 `src/components/NutritionDataBrowserModal.tsx` — 1 site (item 4, the cheap same-class find)

Inside the component `t` is already in scope (`:156`) and `interpolate` is already imported (`:26`); the sibling branch at `:1842` already used the key. The literal at `:292` is a **fossil of the pre-dump value** of `browserServingDefaulted`:

```diff
-        setSyncBanner(`Defaulted serving size to ${def.label}`);
+        setSyncBanner(interpolate(t.browserServingDefaulted, { label: def.label }));
```

Why it is in scope: (a) same class — hardcoded English in user-visible chrome (`syncBanner` renders at `:751`); (b) cheap — 1 line, no new imports; (c) provable — the baseline value is `Defaulted serving size to {label}` and the dump had destroyed the placeholder, so `:1842` was silently rendering a label-less English banner **in both locales** (it now renders the label again). No test/golden/prototype referenced either string (checked before editing: `grep -rn 'Browser Serving Defaulted\|Defaulted serving size to' prototype golden tests` → no hits).

Not fixed here (see §6): `def.label` itself is still English (`servingSizeDefaults.ts`), so the `id` banner is now correctly Indonesian *template* + English *label*. Localizing that label needs a language parameter (contract change) — inventing Indonesian strings for it is forbidden.

---

## 4. Sensor + falsification (`src/utils/i18n.test.ts`, inside the existing S-1 describe)

Two new tests (+53 lines, −0), reusing the file's existing `localePacks` / `readFileSync` / `fileURLToPath` imports:

1. **`keeps the S-1 call-site keys byte-identical to their pre-dump copy`** — table-driven over `S1_RESTORED_VALUES` (the 5 key pairs in §2), asserting `en` and `id` byte-for-byte.
2. **`renders the S-1 chrome from keys only (no hardcoded English fallback left)`** — reads the 4 components and asserts the wired call site is present and the old literal is absent (`FoodHistoryTab` `t.oneServingDefault` + no `quantity: '1 serving'`; `FoodCard` `{t.preparationLabel}` + no `|| 'Preparation:'`; `LogChat` `{t.viewDiagnosticLogs}` + no `|| 'View Diagnostic Logs'` and no `downloadDebugLogsTitle || '…'`; `NutritionDataBrowserModal` the `interpolate(...)` call + no backtick literal).

Falsification (both mutations performed on the real files, then reverted from byte-exact backups; helper `python3 /tmp/waveh/falsify.py`):

```text
=== FALSIFY A: id.browserServingDefaulted -> "Browser Serving Defaulted" (dump artifact) ===
  × keeps the S-1 call-site keys byte-identical to their pre-dump copy
  AssertionError: id.browserServingDefaulted: expected 'Browser Serving Defaulted' to be 'Ukuran saji default ke {label}'
  Tests  1 failed | 41 passed (42)
=== FALSIFY B: NutritionDataBrowserModal:292 -> `Defaulted serving size to ${def.label}` ===
  × renders the S-1 chrome from keys only (no hardcoded English fallback left)
  Tests  1 failed | 41 passed (42)
=== RESTORED ===
  Test Files  1 passed (1)      Tests  42 passed (42)
```

This falsification also **caught a real harness incident**: three of my edits (the 2 `browserServingDefaulted` values and the `:292` wire) were silently dropped when issued in the same response as a shell command. The sensor failed on exactly those three gaps, which is how they were found and re-applied (then re-verified by `grep`). No unverified edit survived.

---

## 5. Gates

| Gate | Command | Result |
|---|---|---|
| Targeted unit (i18n + job contract) | `npx vitest run src/utils/i18n.test.ts src/jobs/__tests__/JobSession.contract.test.ts` | ✅ **2 files / 52 tests passed** (i18n alone: 42 = 40 pre-existing + 2 new) |
| Types | `npx tsc --noEmit` | ✅ **exit 0** |
| Drift scan vs pre-dump baseline | `npx tsx /tmp/waveh/scan.ts` | ✅ **named-surface drifted (en+id) = 0** · frozen `REQUIRED_CHROME` list: 17 residual, all classified (§7) |
| Runtime chrome read-back | `npx tsx /tmp/waveh/chrome.ts` | ✅ §2 output (en/id correct, fr/zh fall back) |
| Component / shell gate | `node scripts/assert-shell-smoke.mjs` | ✅ **9 passed (38.7s) → `PASS shell-smoke`** — re-run *after* the final edit (first run: 9 passed / 39.7s) |

Notes for honesty:

* The shell-smoke run needed no live Gemini (stubs) and **reused the already-running dev server** on `:3000` (`tsx server.ts`, started **Sun Sep 13 22:04** — 1d3h old, *not* started by this wave; it was left untouched). Since the server was launched via tsx, `server.ts` forces Vite (`/tmp/waveh/root.html` contains `/@vite/client` + `src/main.tsx`), so the run really did serve the live edited `src/` (not a stale `dist/` bundle).
* `r3-smoke.spec.ts` is deliberately **thin** (`prototype/tests/r3-smoke.spec.ts:26`): it asserts the Front Desk chat shell opens with an empty input, no `analysis failed|server error|unexpected|crash` text, `pageErrors == []`, plus *soft* Indonesian-crawl checks (`Home`/`Food`/`Medical` not raw English) **only if** the Indonesian nav is detected. `dialog-inventory.spec.ts` exercises the job-debug contract APIs. So the smoke result is a **regression guard that nothing broke** — the *proof* of the restored strings is §2's runtime read-back + §4's sensor, not the smoke run. No spec covers the manual-log form, the `FoodCard` preparation line, the debug buttons or the browser banner.
* Per the wave card the live a11y soak (`golden/scorecard/current/a11y/J-ID-01-*.txt`) was **not** regenerated; the stored artifacts remain pre-fix (same caveat Wave F reported).

---

## 6. Leftovers (deliberately NOT changed, with reasons)

All are the same visual symptom (`1 serving` / English chrome shown to `id` users) but are **not cheap**, so they are listed instead of touched:

| # | Site | Why it was not wired |
|---|---|---|
| 1 | `src/components/AllAnalysesModal.tsx:265` — `quantity: pendingLog?.quantity \|\| '1 serving'` | The file has **no dictionary at all** (`grep 'const t = translations\|translations\['` → 0 hits); it receives `language` only to pass down to children (`:599`). Wiring means adding locale plumbing to a new file → beyond minimal |
| 2 | `src/utils/syncUtils.ts:170` — `quantity: row.quantity \|\| '1 serving'` | Module-level row mapper (sync/DB shape), called from non-React code with **no locale in scope**. Fixing requires a contract change (new `lang` parameter + every call site) → L2 blast radius |
| 3 | `src/components/NutritionDataBrowserModal.tsx:73` — `toScoutItem()` `servingSize: '1 serving'` | The mapper is **module-level** (`:67`, above the component at `:156`), and its output is a payload for the scout/catalog API rather than screen chrome. Threading a label through is a signature change |
| 4 | `src/server/food/server_food_meal_assemble.ts:142` — `sanitizeString(rawFoodData.quantity, "1 serving")` | **Server-side persisted default**: it is written into stored meal rows, so changing the string changes stored data, not chrome (L6). Locale-less by construction. Note: the wave card's path `server_food_meal_assemble.ts` is stale — the live file is under `src/server/food/` |
| 5 | `src/utils/servingSizeDefaults.ts:10/13/15/17` — labels `'1 serving (restaurant prepared)'`, `'100g reference amount'`, `'1 package / container'`, `'1 serving (default)'` | Now interpolated into the localized banner (§3.4) at `:292`/`:1842`, so `id` sees an Indonesian template with an English label. Making the label locale-aware needs a `language` parameter (contract change); **inventing** Indonesian here is exactly what "restore-not-invent" forbids |

---

## 7. Follow-ups for the coordinator (quantified, not done here)

**7a. `REQUIRED_CHROME` residuals — the 17 remaining drifts, classified** (`/tmp/waveh/classify.ts` over the frozen 27-key list; `dump` vs `head`):

* **11 × `DUMP_ARTIFACT` → restorable in a Wave I (same method, restore-only):**
  `en/itemSubTotal` (`"Item Sub-Total"` → `"Subtotal"`), `id/itemSubTotal` (`"Sub-Total Item"` → `"Subtotal Item"`), `id/printedPackagingLabel` (`"Label Kemasan Cetak"` → `"Label Kemasan Tercetak"`), `en/genderLabel` (`"Gender"` → `"Biological Sex / Gender"`), `id/genderLabel` (`"Jenis Kelamin"` → `"Jenis Kelamin Biologis"`), `en/nutritionCalculation` (`"Nutrition calculation"` → `"Nutrition Calculation"`), `id/nutritionCalculation` (`"Perhitungan nutrisi"` → `"Perhitungan Nutrisi"`), `en/verdictLabel` (`"Verdict:"` → `"Verdict"`), `id/verdictLabel` (`"Penilaian:"` → `"Penilaian"`), `en/agentFrontDeskWelcome` + `id/agentFrontDeskWelcome` (the long welcome paragraph was truncated to one sentence: `"Hello! I am your Health Preparation Agent. How can I help you today?"` / `"Halo! Saya Agen Persiapan Kesehatan Anda. Ada yang bisa saya bantu hari ini?"`).
* **4 × `POST_DUMP_CHANGE` → deliberate product copy, do NOT revert:** `en/signUp` (`"Sign Up"` → `"Sign up"`), `en/emailLabel` (`"Email Label"` → `"Email"`), `id/emailLabel` (`"Email Label"` → `"Email"`), `id/passwordLabel` (`"Password Label"` → `"Kata sandi"`).
* **2 × `KEY_ADDED_POST_DUMP` → not a dump artifact at all:** `en/modalDialog`, `id/modalDialog` (absent at dump time, added later).

**7b. The real size of the dump damage** (`/tmp/waveh/placeholder_audit.ts`, `bca0f80~1` vs `307d96f`):

```text
placeholder lost: en=55 id=54          # values whose {token} was destroyed (breaks interpolation)
id === en (English-filled id values) at HEAD: 716
```

Examples of the placeholder-loss sub-class: `en.abnormalValueMsg` (`"Received abnormal value of {item.originalCalories} kcal …"` → `"Abnormal Value Msg"`), `en.creditQuotaExceededBody` (lost `{cost},{selectedModelId},{total},{daily},{nextResetStr}`), `en.retryAnalysisWith` (lost `{model}`), `en.issuesCount` / `en.viewPastDiscussion` / `en.percentOfPack` / `en.noWebImagesFor`. `browserServingDefaulted` (§3.4) was one of these; restoring the remaining 108 is a mechanically similar, evidence-backed wave.

**7c. Live a11y artifact** — `golden/scorecard/current/a11y/J-ID-01-*.txt` is still the pre-wave capture; regenerate before claiming id-chrome cleanliness on the scorecard.

**7d. Harness reliability** — three edits issued in the same response as a shell command were silently dropped (see §4). Any agent working this repo should verify each edit landed (`grep`) or rely on a sensor that fails loudly; this wave's sensor did fail loudly, which is the only reason the gap was caught.

---

## 8. Reproduce (all offline)

```bash
cd /workspace/biomarker-and-nutrient-tracker
git show bca0f80~1:src/utils/translations.ts > /tmp/waveh/baseline.ts   # pre-dump baseline (has the keys)
git show bca0f80:src/utils/translations.ts   > /tmp/waveh/dump.ts       # dump commit
git show HEAD:src/utils/translations.ts      > /tmp/waveh/head_commit.ts

npx tsx /tmp/waveh/keys_classify.ts       # 3-way class per key (base/dump/head/live)
npx tsx /tmp/waveh/scan.ts                # named-surface drift / frozen-list drift
npx tsx /tmp/waveh/placeholder_audit.ts   # 109 placeholder losses + 716 id==en
npx tsx /tmp/waveh/chrome.ts              # end-to-end chrome strings per locale

npx vitest run src/utils/i18n.test.ts src/jobs/__tests__/JobSession.contract.test.ts   # 52 passed
npx tsc --noEmit                                                                      # exit 0
node scripts/assert-shell-smoke.mjs                                                   # 9 passed

python3 /tmp/waveh/falsify.py backup && python3 /tmp/waveh/falsify.py mutate-value
npx vitest run src/utils/i18n.test.ts   # expect FAIL
python3 /tmp/waveh/falsify.py restore
python3 /tmp/waveh/falsify.py mutate-callsite
npx vitest run src/utils/i18n.test.ts   # expect FAIL
python3 /tmp/waveh/falsify.py restore
```

---

## 9. Repo hygiene

`git diff --stat src/` (final, verified after the falsification round was reverted):

```text
 src/components/FoodHistoryTab.tsx            |  6 ++--      # 3 literals -> 3 keys
 src/components/LogChat.tsx                   |  8 ++---     # 4 literals removed
 src/components/NutritionDataBrowserModal.tsx |  2 +-        # 1 literal -> 1 key
 src/components/chat-cards/FoodCard.tsx       |  2 +-        # 1 literal removed
 src/utils/i18n.test.ts                       | 53 +++++++…  # 2 new sensor tests, 0 removed
 src/utils/translations.ts                    | 20 +++++---  # 10 value pairs, value-only
 6 files changed, 72 insertions(+), 19 deletions(-)
```

* `src/utils/translations.ts` is **value-only**: 0 diff lines outside `"key": "value",` (checked by counting, §2), no key added, removed or renamed.
* Untracked scratch was kept out of the repo: all new scripts live in `/tmp/waveh/`.
* **No commit, no push** — the tree is intentionally left dirty for the overnight coordinator.
* Pre-existing dirt (already dirty when this wave started — verified by mtime, e.g. `golden/scorecard/current/RUN.json` = 00:11:54, `.../debug/L-1-dump.json` = 20:33, `tasks/` = 23:55, i.e. **before** this session's first command at ~01:38; **not** produced by this wave):

```text
 M golden/scorecard/current/MASTER_SCORECARD_DEBUG.json      M golden/scorecard/result_summary/LATEST.json
 M golden/scorecard/current/MASTER_SCORECARD_DEBUG.md        M golden/scorecard/result_summary/LATEST.md
 M golden/scorecard/current/RUN.json                         ?? golden/scorecard/current/debug/L-1-dump.json
 M golden/scorecard/current/a11y/J-ID-01-*.txt               ?? golden/scorecard/result_summary/aa0aaec/
 M golden/scorecard/current/live/{biomarker_health,contract,food_health,origin_shell,probes,scorecard_contract}.*   ?? tasks/
```

* No file under `golden/scorecard/current/` or `golden/scorecard/result_summary/` was read as input or written by this wave (`current/` and `result_summary/` are read-only per `AGENTS.md` §1).
* The dev server on `:3000` is pre-existing (started Sep 13 22:04) and was **not** started, restarted or killed by this wave.

---

## Bottom line

**PASS (offline + free component gate).** The S-1 leftover chrome is now rendered entirely from translations: 5 key pairs (**10 values**) restored byte-for-byte from the correct pre-dump baseline `bca0f80~1` (`translations.ts` = `+10/−10`, value-only, zero key churn), **9 hardcoded English literals** removed across 4 components (3 in `FoodHistoryTab`, 4 in `LogChat`, 1 each in `FoodCard` and `NutritionDataBrowserModal`), one bonus same-class dump casualty found and repaired (`browserServingDefaulted`, whose `id` value was literally English and whose `{label}` placeholder had been destroyed). A 2-test sensor locks both the values and the call sites and was falsified in **both** directions (value drift → FAIL, literal restored → FAIL; both reverted green). Gates: vitest **52/52**, `tsc` **exit 0**, drift scan **named-surface 0** (frozen list left at 17, every entry classified into restore / do-not-revert), `assert-shell-smoke` **9 passed / PASS** against the live Vite `src/`. Four call sites that are the same *symptom* but need contract or locale plumbing changes are documented as leftovers, not silently touched. Nothing was invented, committed or pushed.
