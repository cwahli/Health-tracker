# WAVE_A_REPORT — OpenCode Muse Spark 1.3 Contributor Free (HIGH)

Date: 2026-09-14 ~23:49–23:55 UTC (2026-09-15 ~06:49–06:55 WIB)
Model: `opencode/muse-spark-1.3-contributor-free` `--variant high`
Wall: ~6–7 min (restarted without `/usr/bin/time` after exit 127)
Tokens/$: not shown in raw log
Result: **PARTIAL FAIL** (gate still red) but **SUCCESS per brief** — non-empty a11y artifacts produced + clear next fix.

## What happened
1. First live soak hit Render free interstitial (cold start); a11y dump was wake page.
2. Patched harness selectors in `prototype/tests/indo-journey-helpers.ts` (auth mode switch union; raw-key false positive on emails).
3. Patched `prototype/tests/indo-j-id-01-e2e.live.spec.ts` (meal card `.last()` + poll for nasi/kalor content).
4. Later soaks reached real app chrome; Gate I18N-A11Y still fails on surface `analyzing-job-card`: forbidden English chrome verb **"Analysis completed"**.
5. Could not write this report path from OpenCode (`external_directory` auto-reject); coordinator wrote it from the log.

## Artifacts (non-empty)
- `golden/scorecard/current/a11y/J-ID-01-auth.txt`
- `…/J-ID-01-home-portal.txt`
- `…/J-ID-01-quick-actions.txt`
- `…/J-ID-01-food-chat-composer.txt`
- `…/J-ID-01-meal-analysis-chrome.txt`
- `…/J-ID-01-analyzing-job-card.txt` (evidence of English leak)
- debug: `golden/scorecard/current/debug/J-ID-01-job_*`

## Files touched
- `prototype/tests/indo-journey-helpers.ts`
- `prototype/tests/indo-j-id-01-e2e.live.spec.ts`
- a11y + debug dumps under `golden/scorecard/current/`

## Next fix (not a loop)
Restore Indonesian copy for analyzing/succeeded job-card chrome containing "Analysis completed" (restore-not-invent from known i18n commits). Do **not** invent strings. Re-soak J-ID-01 after restore.
