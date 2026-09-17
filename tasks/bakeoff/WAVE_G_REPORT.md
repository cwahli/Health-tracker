# WAVE G REPORT — Live J-ID-01 I18N-A11Y re-soak (post E+F)

**When (UTC):** 2026-09-15 ~01:35–01:36
**Worker:** Playwright shell (`indo-j-id-01-e2e.live.spec.ts`)
**Base:** `307d96f` @ `https://health-tracker-backend-64gt.onrender.com/`
**Result:** **FAIL** (gate I18N-A11Y on `meal-analysis-chrome`)

## E+F job-card targets — VERIFIED GREEN
Artifact `golden/scorecard/current/a11y/J-ID-01-analyzing-job-card.txt` shows:
- `Analisis selesai` (not "Analysis completed")
- img `"Pratinjau Makanan"` (not "Meal Preview")
- button `"Hapus tugas"` (not "Delete task")
- Also present: `Lihat Analisis`, `Simpan Catatan`, `Coba Lagi`

Wave E+F restores are live on Render for the analyzing job card.

## Gate failure (new surface, not E+F scope)
Surface `meal-analysis-chrome` still has forbidden English chrome:
1. button `"Flag issue with this response"` — matches `/\bFlag issue\b/`
2. button `"400g (1 serving) ✏️ Adjust portion"` — matches `/\bAdjust portion\b/`

Evidence: `golden/scorecard/current/a11y/J-ID-01-meal-analysis-chrome.txt` lines ~40 and ~53.

## Other English still in job-card snapshot (out of E+F list)
Banner/nav leftovers in the same soak (not asserted by this gate’s named E+F strings): e.g. "User Profile Alt", "Click To Manually Sync", "Edit Food Log", "Delete Entry", "Home", "Health", "Open Quick Actions", "Trends".

## Wall time
~1–2 minutes (single live test; failed at meal-analysis-chrome after Gate 4 photo upload).

## Next
- Do **not** re-soak for E+F — those strings are fixed.
- Queue a follow-up wave for `Flag issue` / `Adjust portion` (+ optional nav chrome) restore/wire from `85ce58b` if keys exist.
- Wave H (S-1 leftovers) was in flight in parallel; its `1 serving` work may overlap the Adjust-portion button text.
