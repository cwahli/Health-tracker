---
id: card-59
status: draft
class: APPLY_MISS
skill: debug-contract
edit_mode: patch
allowed_files:
  - scripts/bugctl.mjs
  - scripts/assert-bug-ticket-continuity.mjs
frozen_files:
  - scripts/bug-dispatch.mjs
  - scripts/run-coding-dispatch.sh
  - scripts/lib/bug-dispatch.mjs
  - bots/registry.json
  - AGENTS.md
gate:
  - node scripts/assert-bug-ticket-continuity.mjs
---

# card-59 — `bugctl create` returns a stub for a card that already exists

## Goal

`bugctl create --title <existing title_key> --json` reports that card's real
`public_n`, `state` and `queue`, matching `bugctl list`, so an idempotent
consumer can tell claimed from unclaimed from `create` alone.

## Understanding (what this bug is NOT)

- Mechanism: the existing branch of `create` returns a default-constructed
  work item instead of the stored one — `public_n 0`, `state "new"`,
  `queue "ready"` are the defaults, not this card's values.
- Not this: widening `dispatchGuard` or the store's dedupe. Deduping works
  correctly — it returned `existing: true` for the right card. The defect is
  purely in what the response *reports*.
- Not this: making the poller ask twice. A consumer that has to defend itself
  against a lying store is a consumer every future author will get wrong.
- Evidence: card #58 (queue `in_progress`, state `in_fix`) created again with
  its exact title_key returned `existing: true, public_n 0, state "new",
  queue "ready"` at top level **and** inside `work_item`. `bugctl list` for the
  same card reports `public_n: 58`. Measured 2026-10-14.
- Non-goal: do not change dedupe, the state machine, or the guard.

## Layer (pick ONE)

- Layer: data
- Frozen: display, calc — out of scope by construction

## Forbidden patch (named)

- No symptom-hide: printing the card's real number from `list` inside `create`
  is a lookup workaround, not a fix to the response contract.
- No new feature flag
- No second merge/write path
- Do not make `public_n: 0` mean "already exists" — that redefines the field.

## Two-sided fixture (prove structure, not symptom)

- Broken input → correct output: `create` for a title_key that exists returns
  the same `public_n`/`state`/`queue` that `list` reports for that card.
- Adjacent input → unchanged: `create` for a title_key that does NOT exist still
  creates exactly one card and still reports `existing: false`, with the same
  shape it has today.

## In scope

- The existing-path response of `scripts/bugctl.mjs` `create`.
- An assertion in `scripts/assert-bug-ticket-continuity.mjs` that the
  existing-path response equals the `list` row for the same card.

## Out of scope

- The store, `dispatchGuard`, `run-coding-dispatch.sh`, the bot registry.
- Any change to how cards are created or deduped.

## Invariants

- `existing: false` still means "this call created the card".
- A second `create` for the same title_key still creates nothing.
- The card's `state` and `queue` are the stored values, never defaults.

## Prior art (do not reimplement)

- `scripts/lib/bug-dispatch.mjs planFromPacket` — already trusts the packet's
  own `state`; it would have caught this if `create` were used as its source.

## Done when

1. The fixture above exists and passes.
2. `git diff --name-only` ⊆ allowed_files
3. `node scripts/assert-bug-ticket-continuity.mjs` exits 0