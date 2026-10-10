---
slug: google-store-put-gate-20261010
date: 2026-10-10
class: SENSOR_VS_FEATURE
node: Builder
status: draft
---

# Learning: `assert-google-store`'s blanket no-PUT vs #510's review-queue `updateValues` PUT

## Question (sheet row Health-10, key `spec:external-health-publish`)
The gate `assert-google-store` forbids PUT, but merged PR #510 added one. Which side is right?

## Side 1 — the assertion (with history)
- Text (`scripts/assert-google-store.test.mjs:330-333`): `check('nothing is ever
  replaced: no PUT, and no upload onto an existing file id', ...)` — `puts === 0`
  plus no `files/${...}/upload` onto an existing id.
- History: born 2026-09-26 in #235 as "the module never issues a PUT or PATCH
  (nothing is overwritten)". Same day it was relaxed to allow exactly one PATCH
  (rename, `{ name }` only); later commits grew the allowance to exactly four
  named, bounded PATCH shapes (rename label-only, Doc replacement Docs-MIME-only,
  move, mirror `updateFileContent`), each with caller quarantines. PUT was never
  allowed — the blanket ban is the original G-0 law, narrowed for PATCH but never
  for PUT.
- Class it guards: append-only fleet ledgers — `plan/GOOGLE_WORKSPACE_PLAN.md`
  §§1–2: Sheets rows append-only (`values:append` + INSERT_ROWS; "No cell is ever
  edited — corrections are new rows"), Drive objects write-once under
  content-addressed names ("nothing is ever edited in place").
- What breaks if PUT is allowed unbounded: any caller could overwrite
  `turn_log` / `quota_events` / `errors` ledger cells in place, silently
  destroying the audit trail the fleet argues from. The "corrections are new
  rows" invariant would die without a failing check.

## Side 2 — PR #510's PUT (merged 2026-10-03, `1923fcc6`)
- Diff: +41 lines in `scripts/lib/google-store.mjs` — `updateValues` (PUT
  `spreadsheets.values.update`, `google-store.mjs:898-905`) and `deleteSheetRows`
  (POST `batchUpdate` + `deleteDimension`). #510 did NOT touch
  `assert-google-store.test.mjs`, so the gate went red at merge time.
- Why: the human review queue is a state machine, not a ledger — approve moves a
  row to `archive_done` then deletes it from `current`; 💬 appends stamped
  feedback to one row's Status / Original-request / What's-left cells. Append
  cannot express "approved" or "amended cell". The PUT lives in the one Google
  client so the governed write path stays single.
- What breaks if it is removed: `scripts/lib/review-status.mjs` calls
  `updateValues` at lines 320, 323, 410, 419 and `deleteSheetRows` at 285 —
  approve, comment, and answer all die. `assert-review-miniapp` (15/15) stubs
  both functions; the whole merged, live-door-proven /review feature regresses.

## Live behavior on this worktree (verbatim, no changes)
- `node scripts/assert-google-store.test.mjs` → `FAIL  nothing is ever replaced:
  no PUT, and no upload onto an existing file id` / `76 pass, 1 fail`, exit 1.
  Exactly one `method: 'PUT'` in the lib (`google-store.mjs:901`); the
  no-upload-onto-existing-id half still passes.
- PUT path exercised read-only (stubbed fetch, no live call): `updateValues(
  'sheet123', 'current!F42', [['review done']])` issues `PUT
  https://sheets.googleapis.com/v4/spreadsheets/sheet123/values/current!F42?valueInputOption=RAW&includeValuesInResponse=false`
  with body `{"values":[["review done"]]}` — a single-cell in-place overwrite,
  exactly the shape the assertion bans.

## Recommendation: assertion-stale in its blanket form (NOT code-regressed)
Precedent is on the code's side in structure — every PATCH exception was granted
by naming and bounding it, never by blanket removal — but the PUT as written is
unbounded (any sheet, any range), so the ledger class it guards is genuinely
less protected than the gate claims. Recommend narrowing, not deleting: pin PUT
to one `values.update` inside `updateValues`, pin callers to `review-status.mjs`,
and keep the no-upload-onto-existing-id half as is.

## Proposed before → after (PROTECTED — needs human confirmation first, NOT applied)
- Before (`assert-google-store.test.mjs:330-333`): `puts === 0 && !/files\/\$\{
  [^}]+\}\/upload/`.
- After (sketch): `puts === 1`, the single PUT inside `export async function
  updateValues`, plus a caller quarantine (`updateValues` referenced only by
  `scripts/lib/review-status.mjs` + its sensor) mirroring the existing
  `updateFileContent` quarantine at lines 308-315; keep the upload half verbatim.
- Do not change what "pass" means until the human confirms this exact text.

## Do not
- Edit `assert-google-store.test.mjs`, `google-store.mjs`, or any other gate/sensor
- Touch sibling rows or files (Health-10 row 20 only)
- Merge anything; report only
