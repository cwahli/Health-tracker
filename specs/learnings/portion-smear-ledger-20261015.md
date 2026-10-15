# Portion-smear: the message meal total is never a dish weight

**Date:** 2026-10-15
**Class:** cross-dish weight contamination in the server edit pipeline
**Live case:** job_1791997001237_ywvfn9jzz (porridge meal, 1030g → 5882g, +471%)

## What happened

Adjusting Berry Smoothie wrote the client-computed meal total into untouched
dishes — Porridge 150g→1407g and Smoothie 250g→1407g from the message clause
"total meal now 1407g" — then `mergeLocksFromCommands` locked the corruption
and `applyUserLockedSlots` enforced it, so two more edits ratcheted it to
2536g and 5882g. The t1 scout was sane (9 dishes, 1030g); all damage came from
edit turns. Same confusion in `gramMention`: the first "Ng" in the message is
the total, misread as "user set Ng".

## Fix (PR #795, `server_edit_patch_ledger.ts` + `server_meal_edit.ts`)

- `sanitizeWeightEditCommands`, applied in `applyMealEdits` for every command
  origin: on portion-adjust turns weight writes may only touch user-targeted
  dishes; any dish weight equal to the message meal total is dropped
  (single-dish meals excepted).
- `mergeLocksFromCommands` never mints a weight lock for the message total.
- `gramMention` ignores the "(total meal now Ng)" clause.
- Sensor: PORTION-SMEAR block in `server_edit_patch_ledger.test.ts` replays
  the porridge ledger. Live proof: rebuilt porridge scenario on prod —
  eggs 120g→240g moved the total 990g→1110g (the eggs delta alone), all six
  other dishes bit-identical, no total-valued lock.

## Adjacent findings (not fixed here)

- Advice-path turns overwrite the job row's `pendingFoodLog` with `{}` —
  persistent meal loss from a context-less chat turn (hit two anonymous test
  meals; verify against real meals before dismissing).
- Per-dish portion UI vanishes when `packGrams === currentWeight`
  (`PackPortionRow` returns null) and the fallback only renders in wired
  instances — settled pack meals have no single-dish control at all.
- Edit-turn scout nutrient re-estimates can wobble per-100g rates
  (eggs 120g/144kcal → 240g/112kcal); weights (this bug) are exact.

## Process notes

- Real meals live in Cloudflare D1 `agent_jobs`, never in scratch demo
  sessions — confirm the exact target meal first (see global AGENTS.md).
- `gh pr edit` is broken on this box (GraphQL `projectCards` NOT_FOUND
  aborts before the PATCH); update PR bodies via REST
  `PATCH /repos/.../pulls/<n>`.
- `gh run rerun --failed` replays the frozen event payload (stale PR body);
  force a fresh `synchronize` (amend + push) to re-evaluate body gates.
