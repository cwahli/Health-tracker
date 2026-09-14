# Scorecard workflow (agent)

Maker ≠ checker. The checker is `scripts/assert-master-scorecard.mjs`, not you.

**skip is not PASS.** Never edit current/, `result_summary/`, or `REQUIRED_CHROME.json` to look green.

```text
 you: run the scorecard / add a gate / fix a red class
        │
        ▼
 [Read]     instruction/README.md + MASTER_SCORECARD.md + gates.json
        │
        ▼
 [Run]      npm run scorecard:debug
        │  writes golden/scorecard/current/ only
        │
        ├── instruction hash changed (new test added)
        │     previous current/ → past/runs/<stamp>-<commit>/
        │
        ├── NOT ALL GREEN (exit 1)
        │     stay in current/. Fix the CLASS in src/. Re-run.
        │     Forbidden: paint expects, skip, delete REQUIRED_CHROME keys,
        │     edit current JSON, write result_summary by hand.
        │
        ▼
 COMPLETE   exit 0 AND contract overall_named_gates PASS
        │     script copies sealed dump → result_summary/LATEST.{json,md}
        ▼
 cite green only from result_summary/LATEST.md (seal matches JSON)
```

## Pass / fail (named gates)

| Result | Means |
|---|---|
| PASS | Assertion ran and matched. |
| FAIL | Assertion ran and missed, file missing, collection crash, or required skip. |
| SKIP | Not PASS. **Any** area skip is FAIL, including `golden_biomarker`. |

`npm test` is not a scorecard run. Playwright journey soaks (I18N-A11Y / J-ID) are quota and stay NOT COVERED until run; they do not flip an area green. The **live origin probe** (`GET` Render `/api/scorecard/contract`) is required every scorecard run and cannot be skipped.

## Localization pass (all must hold)

1. Frozen `REQUIRED_CHROME.json` keys exist in **en and id**.
2. id ≠ en (except `loanwords_id_may_equal_en`).
3. id ≠ key, en ≠ key (no raw camelCase in the pack).
4. id ≠ Title-Case humanization of the key (`analyzingMeal` must not be `"Analyzing Meal"` in id).
5. Every `t(lang, 'key')` in `src/` and `agents/` (non-test) exists in both packs.
6. Incident strings in `FORBIDDEN_EN_CHROME.json` are not Indonesian values of required keys and are not hardcoded in `src/components` (non-test).
7. AppModal close control is translated copy, not `closeDialog`.
8. Gate I18N-A11Y live snapshots (when quota allows) land in `current/a11y/`. Journeys are not complete while those rows are NOT COVERED — do not call Localization all-green from parity alone.

## New scorecard test

When you add a named gate:

1. Grow `instruction/gates.json` and the matching MASTER_SCORECARD area.
2. Grow `REQUIRED_CHROME.json` if the class is leftover chrome.
3. Run the script. It moves the previous current dump to `past/`.
4. Old `result_summary/LATEST` is kept only if its `instructionHash` still matches. A new gate invalidates a previous green until the new run is all green.

## Live (Render)

Origin: `https://health-tracker-backend-64gt.onrender.com`. Evidence: `current/live/`. A local helper change that is not on Render is FAIL (`live_origin`). Inventories on the live JSON must equal `instruction/inventories/structure.json` (missing / extra / swapped = FAIL).

**Agent instructions:** this process does not edit scout / diet / receptionist prompts. If a class cannot be gated in TypeScript, RFC (net-zero or human approval). Do not add instruction tokens to pass.

## Seal (cannot fake result_summary)

`result_summary/LATEST.json` includes `seal` = SHA-256 of the canonical tree **without** the `seal` field. The script writes that folder only when `overallPass === true`. If `overallPass` is false, it does not write `result_summary`. Re-running overwrites `current/` from live vitest + file parses; editing the markdown cannot change the next run.
