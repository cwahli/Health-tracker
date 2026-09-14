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
7. Live Render `https://health-tracker-backend-64gt.onrender.com` is required. Local green is not live green. Inventories (Top Targets, polarity, 32-key ledger, B0 converts) must match `GET /api/scorecard/contract`.
8. Do not edit agent instruction files to pass. Prompt net-zero; RFC if not possible.

Adding a gate: grow `instruction/gates.json` + MASTER_SCORECARD row, then re-run (archives current → past).

9. I18N-A11Y / journeys: read `golden/scorecard/instruction/i18n/GATE_I18N_A11Y_TREE.md`. Capture via `ariaSnapshot` only; `--list` before soak; restore i18n from known-good git (never invent); artifacts in `current/a11y/`; incomplete checklist = not complete.
10. Do not parallel-edit helpers/specs across soaks; rebase before push.
