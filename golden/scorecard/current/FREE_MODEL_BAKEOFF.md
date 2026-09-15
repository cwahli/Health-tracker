# Free model bake-off (OpenCode + Cline)

Vertex promo ended 2026-09-15. Workers: OpenCode + Cline free tiers. Prefer high thinking.

## Questions
1. Can Muse Spark run on OpenCode and Cline **at the same time**, and are free allowances **independent**?
2. How do other free models (DeepSeek 4.1 / GLM / …) compare to Muse on the same task?

## Method
- Same prompt per wave; high/max thinking when available.
- Record PASS/FAIL, wall time, tokens/$ , notes.

## Results

| When (UTC) | Tool | Model | Thinking | Task | Result | Tokens / $ | Notes |
|---|---|---|---|---|---|---|---|

| 2026-09-14 23:49–23:55 | opencode | muse-spark-1.3-contributor-free | high | Wave A Gate I18N-A11Y J-ID-01 live | PARTIAL FAIL (a11y artifacts yes; gate red on "Analysis completed") | n/a / $0 | Harness selectors fixed; OpenCode blocked writing outside repo; concurrent with Wave B |
| 2026-09-14 23:53–23:55 | cline | cline-free/muse-spark-1.3-contributor | high | Wave B dual-wallet + actions #8–#10 shell list | PASS | n/a headless / $0 | Concurrent with OpenCode Muse → **independent wallets YES** |
| 2026-09-15 00:08–00:16 | cline | cline-free/deepseek-v4.1-flash | high | Wave C L-2 confirm (Insights literature + outlier `preciseCause` i18n) | **PASS** (43 `step*` values restored from `85ce58b`; +3 sensors; scorecard 677 ALL GREEN; Guard PASS) | n/a headless / $0 | Found `TRANSLATION_DUMP` from `1c868ab`; pack leftovers **991→969**; fix left uncommitted for the coordinator |
| 2026-09-15 00:18–00:30 | cline | poolside/laguna-s-2.1:free (GLM free promo ended) | high | Wave D ROADMAP draft + S-1 leftover inventory | PASS inventory; ROADMAP draft-only | n/a / $0 | cline-free/glm-5.3-flash promo ended; OpenCode GLM needs payment |
| 2026-09-15 00:47–00:53 | cline | cline-free/deepseek-v4.1-flash | high | Wave E restore job-card status* chrome (Analysis completed) | **PASS** (9 keys from 85ce58b; +3 sensors; vitest 44 + tsc 0) | n/a headless / $0 | Root cause of Wave A gate; commit left for coordinator; Wave F residuals listed |
| 2026-09-15 00:55–01:08 | cline | cline-free/deepseek-v4.1-flash | high | Wave F restore English-filled job-card id residuals (updatingMeal/attemptOf/…) | **PASS** (32 values from 85ce58b; +6 sensors; vitest 50 + tsc 0) | n/a headless / $0 | Same TRANSLATION_DUMP class as Wave E; commit left for coordinator; live a11y soak still needed |
| 2026-09-15 01:35–01:36 | playwright | n/a (live soak) | n/a | Wave G J-ID-01 I18N-A11Y re-soak post E+F | **FAIL** gate on meal-analysis-chrome; job-card E+F strings GREEN | n/a / $0 | Flag issue + Adjust portion English; Analisis selesai / Pratinjau Makanan / Hapus tugas OK |
| 2026-09-15 01:38–01:52 | cline | cline-free/deepseek-v4.1-flash | high | Wave H S-1 leftover English fallbacks (wire+restore) | **PASS** (10 values from bca0f80~1; 9 literals wired; +2 sensors; vitest 52 + tsc 0 + shell-smoke 9) | n/a headless / $0 | Commit left for coordinator; DeepSeek daily free limit hit after run (~22h); 11 dump residuals queued Wave I |
