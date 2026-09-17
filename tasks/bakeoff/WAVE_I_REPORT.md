# WAVE I — Flag issue / Adjust portion (Wave G gate leftovers) — REPORT

Model: Cline Free Muse Spark 1.3 Contributor · Baseline: `c3e6cfd` (= `bca0f80~1`)
Repo: `/workspace/biomarker-and-nutrient-tracker` @ `bf0211d` (already up to date on pull)
Date: 2026-09-15 · **No commit, no push — tree left dirty for overnight coordinator.**

## Verdict: PASS (offline) with documented leftovers

- `npx vitest run src/utils/i18n.test.ts` → **44/44 passed** (42 pre-existing + 2 new Wave I sensors)
- `npx tsc --noEmit` → **exit 0**
- No live Playwright soak (per card §5).

## 1. Restored keys (id only; en verified byte-identical to baseline, untouched)

`src/utils/translations.ts`, id block only (`-4/+4`, value-only, zero key churn):

| key | en (verified = baseline, NOT edited) | id before → after (after = baseline byte-for-byte) |
|---|---|---|
| `flagIssueWithThisResponse` | `Flag issue with this response` | `Flag issue with this response` → `Laporkan masalah pada respons ini` |
| `flagIssueWithAgentResponse` | `Flag issue with {agent} response` | `Flag issue with {agent} response` → `Laporkan masalah dengan respons {agent}` |
| `flagAnother` | `Flag another` | `Flag another` → `Laporkan lainnya` |
| `flagFoodAnalysisIssue` | `Flag food analysis issue` | `Flag food analysis issue` → `Laporkan masalah analisis makanan` |
| `flagIssue` | `Flag issue` | already `Laporkan masalah` — **left untouched**, sensor-guarded |

Baseline check: `git show c3e6cfd:src/utils/translations.ts` lines 2414/2452/2474/2555-2556 match the restored values byte-for-byte (verified via `sed -n` + `grep`).

## 2. Wired call sites (4 English fallbacks removed)

- `src/components/LogChat.tsx:6185` — `title={t.flagIssueWithThisResponse || "Flag issue with this response"}` → `title={t.flagIssueWithThisResponse}` (the exact Wave G gate item #1)
- `src/components/LogChat.tsx:7262` — `title={(t.flagIssueWithAgentResponse || 'Flag issue with {agent} response').replace(...)}` → `title={t.flagIssueWithAgentResponse.replace(...)}`
- `src/components/chat-cards/FoodCard.tsx:3314` — `{flaggedId ? (t.flagAnother || 'Flag another') : (t.flagIssue || 'Flag issue')}` → `{flaggedId ? t.flagAnother : t.flagIssue}`
- `src/components/chat-cards/FoodCard.tsx:3320` — `title={t.flagFoodAnalysisIssue || "Flag food analysis issue"}` → `title={t.flagFoodAnalysisIssue}`
- `src/components/BugTrackerModal.tsx:1115` — `title="Flag issue"`: **leftover, NOT wired.** Reason: no `t`/dictionary in scope — all 12 `\bt\.` hits in that file are lambda params (`bugTags.find((t) => ...)`, `t.category`, `t.includes(...)`), zero i18n plumbing. Wiring it would need a new `translations[language]` import + prop, i.e. a contract change, out of blast radius for a value-only wave.

## 3. Adjust-portion decision: LEFTOVER (no key invented)

- `git log --all -S "adjustPortion"` on `src/utils/translations.ts` → **empty**: no `adjustPortion` key ever existed.
- `FoodCard.tsx:2495/2499/2510` stay as-is: `title="Click to adjust total meal portion size"`, `✏️ Adjust portion`, `Adjust Total Portion (Baseline: {baseWeight}g)`.
- Reason per card: inventing an Indonesian value (or adding a new key) would violate restore-not-invent; there is no byte-identical historical value anywhere in the repo to restore from.
- Suggested Wave J path: key it then (e.g. `adjustPortion` / `adjustTotalPortion` / `clickToAdjustPortion`) with proper `id` copy via the normal product/i18n route, not a restore wave.

## 4. Sensor (`src/utils/i18n.test.ts`, +39 lines, inside S-1 suite)

- `restores Wave I flag-issue id chrome byte-for-byte from c3e6cfd` — asserts the 4 restored id values, `id !== en`, and `id.flagIssue` unchanged.
- `renders Wave I flag-issue chrome from keys only (no English fallback left)` — asserts the 4 wired call sites contain the keyed form and no `|| 'English'` fallback remains.

## 5. Optional §7a residuals: NOT restored — listed for Wave J

Time-box hit after #1–4; investigation shows these are **not** all simple dump drift, so bulk-restore would be wrong. Evidence (`bca0f80~1` = baseline, `bca0f80` = the reverted dump commit, `c3e6cfd` = baseline content):

| key | baseline `bca0f80~1` en / id | current en / id | assessment |
|---|---|---|---|
| `verdictLabel` | `Verdict:` / `Penilaian:` | `Verdict` / `Penilaian` | colon dropped — looks like genuine drift, cheap Wave J restore |
| `printedPackagingLabel` id | `Label Kemasan Cetak` | `Label Kemasan Tercetak` | wording change, needs product call |
| `nutritionCalculation` | `Nutrition calculation` / `Perhitungan nutrisi` | `Nutrition Calculation` / `Perhitungan Nutrisi` | casing change on both sides |
| `itemSubTotal` | `Item Sub-Total` / `Sub-Total Item` | `Subtotal` / `Subtotal Item` | wording change on both sides |
| `genderLabel` | `Gender` / `Jenis Kelamin` | `Biological Sex / Gender` / `Jenis Kelamin Biologis` | deliberate rename (matches current inclusive UI), **do NOT revert blindly** |
| `agentFrontDeskWelcome` | long 3-sentence welcome (en+id) | short 1-sentence greeting | deliberate product shorten, **do NOT revert blindly** |

Note: `bca0f80` (the dump) contains **none** of these keys at all (`grep $k:` → empty) — it was reverted by `893d938`, so the residuals predate/are independent of the dump. Each needs a before→after product decision, not a byte-restore. Recommend Wave J handle them individually with call-site context.

## Files touched (Wave I only; scorecard `current/`/`result_summary/` dirt is pre-existing)

```text
 src/components/LogChat.tsx             | 4 ++--   # 2 fallbacks removed
 src/components/chat-cards/FoodCard.tsx | 4 ++--   # 2 fallbacks removed
 src/utils/i18n.test.ts                 | 39 ++++  # 2 sensor tests
 src/utils/translations.ts              | 8 ++---- # 4 id values, value-only
 4 files changed, 45 insertions(+), 8 deletions(-)
```

`translations.ts` = value-only (0 lines outside `"key": "value",`). No key added/removed/renamed. Nothing committed or pushed.
