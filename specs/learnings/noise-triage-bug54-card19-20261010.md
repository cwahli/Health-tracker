# Noise triage: Bug-54 LIVE-GREEN, Card-19 LIVE-RED (2026-10-10)

Branch `agent/t10d-specs`. Report-only: no application code changed.
Sheet rows touched: Bug-54 + Card-19 Work-done cells only (+Status/proof on Bug-54).

## Bug-54 (spec:bbox-fallback-passthrough) — LIVE-GREEN → Status review

- Packet `specs/done/bbox-fallback-passthrough.md`, `status: done` (moved by
  `170d9915`). Row `source` cell still says `specs/active` — stale, flagged on
  the row, not touched (out of scope: Work-done cells only).
- Gate re-run verbatim on this tree @ `adfeb83b`, exit 0:
  `npx vitest run src/server/food/server_food_meal_assemble.test.ts src/server/food/server_food_diet_dispatch.test.ts`
  → 2 files / 44 tests passed.
- First attempt burned on infra (`@tailwindcss/vite` missing — fresh worktree
  had no `node_modules`); `npm ci` fixed the environment, second run was
  conclusive. `node_modules/` is git-ignored; tracked tree clean.
- Fix lines live: `server_food_meal_assemble.ts:79`,
  `server_food_diet_dispatch.ts:322`.
- Captioned PNG proof (`bug54-gate-44of44-20261010.png`, command + 44/44 +
  commit stamp) filed in Drive Work done → new per-key folder
  `spec:bbox-fallback-passthrough`
  (`https://drive.google.com/drive/folders/1YiChtdYdfOOVFlxtlppqEqFTMRLXxlja`),
  linked as the row's Completion proof.
- Human check before Done: row todo still asks for a live e2e meal proof;
  the gate PNG proves the unit gate only, not an on-device meal run.

## Card-19 (spec:card-19) — LIVE-RED → left Assigned, fix queued

- Packet `specs/done/card-19.md`, `status: done` (moved by `170d9915`).
  PR #452 verified MERGED 2026-10-01. Fix lines live
  (`scoutGeometry.ts:325,359`); test file carries the per-component box
  assertions.
- Gate leg 1 verbatim: `npx vitest run src/server/food/scoutGeometry.test.ts`
  → 8/8 passed, exit 0.
- Gate leg 2 verbatim: `node scripts/assert-spec-diff.mjs card-19` → exit 1,
  `FAIL spec_missing: specs/active/card-19.md not found`. The script resolves
  only `specs/active/<ID>.md`, so every packet already moved to `specs/done/`
  fails this leg by construction. (Note: `170d9915`'s close evidence cited
  only the 8/8 vitest leg, never the assert leg.)
- Queued fix (not applied — code changes forbidden this run): either retarget
  Card-19's Completion gate to drop/replace the `assert-spec-diff` leg, or
  teach `assert-spec-diff.mjs` to resolve `specs/done/` for `status: done`
  packets. Same staleness likely affects every other done packet whose gate
  still names `assert-spec-diff` — worth a sweep, not this row's scope.
- Neither row is NOISE: both describe real merged work with live fix lines
  and (mostly) green gates; both rows stay for audit.

## Process notes

- `sheet_row.rb --note` replaces the Work-done cell: existing text was
  re-passed byte-intact with the new bracketed annotation appended.
- `--status review` enforces Ref shape + linked proof + non-empty Drive
  folder; all three held for Bug-54.
- Heartbeat beaten on `agent/t10d-specs` throughout the run.
