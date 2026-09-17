# WAVE C Report — L-2 confirm (Insights literature + outlier `preciseCause` i18n)

**Model used:** Cline Free **DeepSeek V4.1 Flash** — model id `cline-free/deepseek-v4.1-flash`, thinking **high**.
(Never V4 / `deepseek-v4-flash` / `opencode/deepseek-v4-*`: the FORBIDDEN ids were not used. This run is **V4.1**.)
**Tool:** Cline CLI (headless), free tier → **$0**.
**Repo:** `/workspace/biomarker-and-nutrient-tracker` @ `main` = `aa0aaec` (working tree has the fix below).
**Date:** 2026-09-15 ~00:08–00:16 UTC.

---

## VERDICT: **PASS** — with one real bug found and repaired

Task: *confirm that the Insights literature chrome + the outlier `preciseCause` follow `profile.language`; restore from git if missing — no invent.*

| Half of L-2 | Claim | Verdict |
|---|---|---|
| Outlier `preciseCause` / badges | follow `profile.language` | ✅ **PASS as-shipped** (family already landed + healthy; now **locked** by a test) |
| Insights literature step chrome | follow `profile.language` | ⚠️ **FAILED at start → repaired** (copy was a key-name dump), now ✅ PASS + **locked** |

**Net:** L-2 holds today, but only after restoring 43 destroyed Indonesian/English values from git. The pack still contains **969** keys of the same dump class that are **out of scope** for L-2 (see Boundary).

---

## 1. Why the Insights half was broken (root cause, proven)

Commit **`1c868ab`** ("chore(i18n-a11y)"-style sweep) added `scratch_keys.json` (2098 lines) and rewrote `src/utils/translations.ts` (**+3413 / −3127**), replacing real copy with the **Title-Case humanization of each key** in **both** locales — including scraper junk such as `"useMemo": "Use Memo"`, `"ReactNode": "React Node"`, and JS template literals (`"suggestedKey": "custom_${Date.now()}..."`).

The L-2 `step*` family was hit: `id.stepAddHealthDataTitle` was `"Step Add Health Data Title"`, `id.stepLiteratureTitle` was `"Step Literature Title"`, etc.

**Why the scorecard stayed green:** `golden/scorecard/instruction/i18n/REQUIRED_CHROME.json` freezes only **27** keys, none of them `step*`. Baseline scorecard was **ALL GREEN 674 / 0** *with the bug live* → confirmed gate hole.

## 2. How L-2 is actually wired (code evidence, not assumption)

```
src/components/InsightsTab.tsx:110   const t = translations[profile.language] || translations.en;
src/components/InsightsTab.tsx:1363–1401  t.stepAddHealthDataTitle / Desc / Value … t.stepLiteratureTitle / Desc / Value
src/components/InsightsTab.tsx:1813  {completedCount} {t.of} {steps.length} {t.stepsCompleted}
src/utils/biomarkers.ts:2077         diagnoseTelemetryIssue(key, name, val, unit, rangeStr?, historyEntries?, lang?)
src/utils/biomarkers.ts:2122,2124    preciseCause: interpolate(t(lang,'outlierRatioPctCause'), …) / badgeLabel: t(lang,'outlierBadgeRatioPct')
```
So both halves are `profile.language`-driven **by construction**. The bug was never the plumbing — it was the **data**.

## 3. Repair (restore, never invent)

Source of truth: **`85ce58b`** (last known-good pack), extracted with `git show`, applied only to the broken family.

- **43 values rewritten** = **21 `en` + 22 `id`**, **all `step*`** keys → `git diff --stat src/utils/translations.ts` = **+43 / −43** (no other key touched).
- Examples: `stepLiteratureTitle` `"Step Literature Title"` → `"Literatur Ilmiah"`; `stepsCompleted` `"Steps Completed"` → `"Langkah Selesai"`; `stepDone`/`stepPending`/`stepToDo`/`stepToReview` restored.
- `id` values are real Indonesian, `en` real English, `id ≠ en` everywhere in the family.
- **One deliberate exception:** `en.stepsCompleted = "Steps Completed"` is *legit* copy (it renders as "`2 of 5 Steps Completed`" at `InsightsTab.tsx:1813`) and is exactly what `85ce58b` shipped → kept as-is and documented in the test allowlist rather than "invented" into something else.

## 4. Sensors added (L-17 ratchet) — `src/utils/i18n.test.ts` (+75 lines, 3 tests)

New `describe`: **`L-2 seeded/demo chrome (Insights step cards + outlier preciseCause)`**.

1. **`keeps the Insights step cards in real EN + ID copy (no key-name leftovers)`** — for all **24** `step*` keys asserts: present, `en !== humanizeKey(key)`, `id !== humanizeKey(key)`, `id !== en`; pins `en.stepLiteratureTitle === 'Literature'`, `id.stepLiteratureTitle === 'Literatur Ilmiah'`, `id.stepsCompleted === 'Langkah Selesai'`.
2. **`follows profile.language in the outlier preciseCause (id / en / unset)`** — end-to-end through `diagnoseTelemetryIssue` with a deterministic branch trigger (`hematocrit`, 48, `'0.40 - 0.52'` → ratio-pct branch): `lang='id'` ⇒ contains **`persentase`**; `lang='en'` ⇒ contains **`percentage`**; **unset `profile.language` ⇒ exactly the English string** (fallback locked); `badgeLabel === t('id','outlierBadgeRatioPct')`.
3. **`ratchets TRANSLATION_DUMP leftovers so the class can only shrink`** — counts keys where **both** locales equal the key's Title-Case form and pins `≤ 969` (`DUMP_RATCHET_MAX`, commented as shrink-only).

### Negative control (proves the sensors catch the class, on the pre-fix pack)

Measured with the **same predicate as the test** against `git show HEAD:src/utils/translations.ts` (HEAD = pre-fix):

| Sensor | PRE-FIX (`HEAD` = `aa0aaec`) | POST-FIX (working tree) |
|---|---|---|
| Step family, `id === humanizeKey` | **22 / 24 → FAIL** (e.g. `id.stepLiteratureTitle` = `"Step Literature Title"`) | 0 / 24 → PASS |
| Step family, `en === humanizeKey` (minus allowlist) | **21 → FAIL** | 0 → PASS |
| Pinned `id` copy | `"Step Literature Title"` / `"Steps Completed"` → FAIL | `"Literatur Ilmiah"` / `"Langkah Selesai"` → PASS |
| Dump ratchet count | **991 > 969 → FAIL** | 969 ≤ 969 → PASS |
| Outlier `preciseCause` (id/en/unset) | **already PASS** (family landed healthy in both locales) | PASS (now **locked**) |

Honest scoping: sensors #1 and #3 are **new catches**; the outlier assertions were **already green** and are a **regression lock**, not a new find.

## 5. Verification (all offline, no live Gemini, $0)

| Gate | Command | Result |
|---|---|---|
| Named gate | `npx vitest run src/utils/i18n.test.ts` | **31 passed** (was 28; +3) |
| Types | `npx tsc --noEmit` (`npm run lint`) | **exit 0** |
| Master scorecard | `npm run scorecard:debug` | **ALL GREEN 677 pass / 0 fail / 0 skip** (was 674 — the 3 sensors are now scored, listed `PASS` at `MASTER_SCORECARD_DEBUG.md:493–495`, area `Localization … 51`) |
| Chrome regression row (map: `chrome`) | `node scripts/assert-shell-smoke.mjs` | **PASS 9/9** (dialog-inventory, key-journeys 1–4, R-3 smoke) |
| Journey Guard | `node scripts/journey-guard.mjs` | **GUARD PASS** (biomarker 7/7 + shell-smoke) |

Note: `docs/agent/DOMAIN_REGRESSION_MAP.md` has **no i18n/localization row** (its rule: "if no row fits, add a unit test in the same task, then run it" → done). A row is **proposed** in §7; editing `docs/agent/**` needs human confirmation (AGENTS §3), so it was **not** touched.

## 6. Files touched

| File | Change |
|---|---|
| `src/utils/translations.ts` | **+43 / −43** — restored 21 `en` + 22 `id` `step*` values from `85ce58b` (restore-not-invent) |
| `src/utils/i18n.test.ts` | **+75** — 3 L-2 sensors (§4) |
| `golden/scorecard/current/**` + `result_summary/LATEST.{md,json}` | regenerated by `npm run scorecard:debug` (677) — tool output, not hand-edited |
| `golden/scorecard/current/FREE_MODEL_BAKEOFF.md` | Wave C row appended (OVERNIGHT.md step 3; hand-maintained log — no script regenerates it) |

**Uncommitted on purpose** (concurrent multi-wave workspace; OVERNIGHT.md step 4 keeps landing under human control):
```bash
git add src/utils/translations.ts src/utils/i18n.test.ts golden/scorecard/current golden/scorecard/result_summary/LATEST.json golden/scorecard/result_summary/LATEST.md
git commit -m "fix(i18n): restore L-2 Insights step chrome from 85ce58b + TRANSLATION_DUMP sensors"
```
Untracked and **not** mine (left alone): `tasks/`, `golden/scorecard/result_summary/aa0aaec/`, `golden/scorecard/current/debug/L-1-dump.json`; scratch dir `.tmpwave/` is deleted after the run.

## 7. Boundary / out of scope (do not read this as fixed)

- **969** pack keys are still the same `en === id === Title-Case-of-key` dump (e.g. `"useMemo": "Use Memo"`, `"ReactNode": "React Node"`, `"suggestedKey": "custom_${…}"`). L-2 needed only `step*`; the ratchet now forbids growth. A full sweep is a separate, larger work item (per-key restore from `85ce58b`, never `expected.json` painting / `npm test`).
- **Wave A's** job-card `"Analysis completed"` English leftover is a **different class**: that string does **not exist in `translations.ts`** at all → hardcoded chrome / missing call site, not `TRANSLATION_DUMP`. Not touched here.
- **Proposed `standing.json` row (needs human confirmation, AGENTS §3 — not edited):**
  `{"class":"TRANSLATION_DUMP","needle":"pack value equals the humanized key in BOTH locales","gate":"npx vitest run src/utils/i18n.test.ts","evidence":"1c868ab; 991→969; WAVE_C_REPORT.md"}` — plus a proposed `DOMAIN_REGRESSION_MAP.md` row: `src/utils/translations.ts` → `npx vitest run src/utils/i18n.test.ts` · `node scripts/assert-shell-smoke.mjs`.
- No commit/push made; no `docs/agent/**` or `scripts/assert-*.mjs` edited; no scorecard result painted; no live Gemini call.

**Model compliance:** Cline Free **DeepSeek V4.1 Flash** (`cline-free/deepseek-v4.1-flash`), thinking high, `$0` — **not** V4 / `deepseek-v4-flash`.