---
name: scorecard
description: Run the Health-tracker master scorecard (six areas). Use when the user says scorecard, master scorecard, named gates dump, or asks if tests passed green.
---

# Scorecard

1. Read `golden/scorecard/instruction/README.md` then `WORKFLOW.md`.
2. Run `npm run scorecard:debug` from the repo root (`Health-tracker`). Never `npm test`.
3. Report from `golden/scorecard/current/MASTER_SCORECARD_DEBUG.md`. Contract table first. Skip is not PASS.
4. Cite **all green** only on process exit 0 and `result_summary/LATEST.json` (script-written). If current is red, do not write result_summary.
5. Do not edit `current/`, `result_summary/`, `instruction/i18n/REQUIRED_CHROME.json`, or `expected.json` to pass.
6. Localization: frozen required-chrome list + callsite scan. Parity-only is not a pass.

Adding a gate: grow `instruction/gates.json` + MASTER_SCORECARD row, then re-run (archives current → past).
