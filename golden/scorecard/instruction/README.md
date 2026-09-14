# Master scorecard — agent entry

Read this file, then [`WORKFLOW.md`](./WORKFLOW.md), then [`MASTER_SCORECARD.md`](./MASTER_SCORECARD.md). Do not run `npm test`.

## Layout

| Folder | What it is | Who writes it |
|---|---|---|
| `golden/scorecard/instruction/` | Frozen contract: pass/fail laws, named gates, journey imagery pointers, leftover-chrome list | Human / Planner adding a **new** gate. Not the Builder scoring a run. |
| `golden/scorecard/current/` | This moment’s run (JSON tree + markdown view) | **Only** `node scripts/assert-master-scorecard.mjs` |
| `golden/scorecard/past/` | Previous instruction generation + its last current, when a new scorecard test is added | The same script, on instruction-hash change |
| `golden/scorecard/result_summary/` | Full green dump | The same script, **only** when every named gate is PASS |

## Run

```
npm run scorecard:debug
```

Exit 0 = all green. Exit 1 = not all green. Cite **all green** only on exit 0 **and** Contract `overall_named_gates` PASS in `current/MASTER_SCORECARD_DEBUG.json`.

Live origin is `https://health-tracker-backend-64gt.onrender.com/`. Local named-gate green is **not** a pass. `scorecard-live` must hit that host; Render spin-up is waited, then FAIL. Skip is FAIL in every area.

## You must not

- Edit `current/`, `result_summary/`, or `instruction/i18n/REQUIRED_CHROME.json` to look green.
- Skip a test, `it.skip` a missing fixture, or paint `expected.json`.
- Claim Localization PASS because en/id key **parity** passed. Parity cannot see keys missing from **both** packs (`closeDialog`).
- Fill Indonesian with English Title-Case leftovers (`analyzingMeal: "Analyzing Meal"`).
- Hand-write `result_summary/LATEST.md`.
- Treat a local vitest pass as live. Inventories (Top Targets, polarity, 32-key ledger, B0 converts) must match on Render `GET /api/scorecard/contract`.
- Swap or drop a frozen list to make a surface look new (Top Targets, nutrient keys, biomarker multipliers).
- Grow agent instruction files. Prompt edits stay net-zero (AGENTS L12). If a scorecard class needs more instruction tokens, stop and RFC.

- Call journeys **complete** while Gate I18N-A11Y checklist has NOT COVERED/FAIL, or while `playwright --list` fails.
- Use `page.accessibility.snapshot` (removed in Playwright 1.62+). Use `locator.ariaSnapshot()` per `i18n/GATE_I18N_A11Y_TREE.md`.
- Invent Indonesian chrome strings. Restore from known-good git (`i18n-en-id`, `4cd66d1`, …) and grow `REQUIRED_CHROME.json`.
- Let failure-path agents rewrite `indo-journey-helpers.ts` mid-soak without a green `--list` gate.

## All areas (cannot cheat)

Frozen file: `instruction/inventories/structure.json`.

| Cheat | How it is blocked |
|---|---|
| Skip / missing fixture | Skip in any area is FAIL |
| Paint expects | Inner loop is named vitest + file parse, not expected.json |
| Local-only green | Live probe required; `result_summary` only if live also PASS |
| Swap Top Targets | `getTopTargetNutrientKeys` must stay on Home, NutrientTargetRow, LogChat, scout. Fallback locked to calories/saturatedFat/sodium. Forbidden `Object.keys(dailyNutrientTargets).slice` |
| Swap polarity | `isLimitNutrient` on Home / pie / trends; LIMIT list frozen |
| Drop ledger fields | 32 `NUTRIENT_KEYS`; kcal writer `finalizeDishLedger` |
| Swap biomarker math | Locked multipliers + apply outputs (1.293 / 1.411 / 3.362 / 79.56 / 13.68) on live contract |
| Parity-only i18n | `REQUIRED_CHROME.json` + `t()` callsite scan |

## Localization (cannot cheat)

Independent of vitest, the runner:

1. Reads frozen `instruction/i18n/REQUIRED_CHROME.json`.
2. Parses `src/utils/translations.ts` as text (not a mocked import).
3. Scans `src/` + `agents/` for `t(..., 'key')` call sites; every key must exist in en **and** id.
4. Fails skip in the Localization area.
5. Fails English-filled id (id === en, unless loanword) and LEAK_KEY (value === key name).

Evidence photos of prior leaks: `instruction/i18n/evidence/`.

## Adding a new scorecard test

1. Add the named vitest (or command) to `instruction/gates.json` **and** a row on `MASTER_SCORECARD.md`.
2. If it is leftover chrome, add the key to `REQUIRED_CHROME.json` (grow only).
3. Run `npm run scorecard:debug`. The script archives `current/` → `past/runs/<stamp>/` because the instruction hash changed.
4. Do not copy an old debug dump into `result_summary/`.
