# golden/ — benchmark harness

Three suites:

| Suite | Path | Canonical runner |
|---|---|---|
| Meal | `meal/` | New benchmark goldens (this folder). Computation use cases with photos + `expected.json`. |
| Biomarker | `biomarker/` | Pointer to `tests/Golden_biomarker/` (existing suite stays canonical). |
| Scorecard | `scorecard/` | Area PASS/FAIL board. Agent entry `scorecard/instruction/README.md`. Run `npm run scorecard:debug`. |

## meal/ contract (per `Meal_NN/` folder)

- Photos (≤200 KB each, named `NN_description.jpg`).
- `Instruction.md` — what the user logs + ground-truth dish table.
- `expected.json` — dishes with weights + full nutrient vectors in
  `NUTRIENT_KEYS` order, meal totals, `lockedLabelTruth` for packaged items,
  `verifyFlags` for values that need a re-scan to confirm.

Relation to `tests/Golden_meal/`: that suite stays the shipped regression
gate. Folders here graduate there once their vectors are confirmed against a
live F-10.8 soak (one example, not a loop).
