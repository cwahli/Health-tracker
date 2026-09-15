---
id: f-4-alias-hit-rate
status: locked
skill: food-scout
edit_mode: patch
allowed_files:
  - server_scout_reconcile.ts
  - server_scout_reconcile.test.ts
frozen_files:
  - server.ts
  - src/App.tsx
  - docs/agent/standing.json
  - scripts/journey-guard.mjs
  - AGENTS.md
gate:
  - npx tsc --noEmit
  - npx vitest run server_scout_reconcile.test.ts
---
# F-4 — measured alias hit rate; dups gated, not silently merged — PACKET (locked)

## Goal
ROADMAP F-4. The dup-gating half is covered (`namesReferToSameFood` reject tests). The missing half is measurement: a fixed ID/EN alias probe list with a reported hit rate, plus negation/dangerous-single merge gates.

## Law
- Inner loop = named vitest only. No `POST /loop`, no DB, no live Gemini.
- Threshold is 1.0 over the probe list: any miss is a finding — fix the mapping (`DISCRIMINATOR_CANONICAL` / negation set in `server_scout_reconcile.ts`) or justify the probe out in the test comment. Do not weaken the probe to pass.

## Mechanism
- New test `measures ID/EN alias hit rate over the probe list` in `server_scout_reconcile.test.ts`: 12 (alias, canonical) pairs, hits/total computed and asserted `rate === 1`, misses listed in the failure message.
- New test `gates negation and dangerous-single merges`: sweetened/unsweetened condensed milk, salted/unsalted butter, diet/regular cola, whole/skim milk, peanut butter/butter — all `false`.
- Prod change only if a legitimate alias misses (mapping addition, net-zero style, same file).

## Sensor
- The two new tests are the sensor. No new assert script.

## Gates
`npx tsc --noEmit` · `npx vitest run server_scout_reconcile.test.ts` · `node scripts/journey-guard.mjs f-4-alias-hit-rate`.

## Status: LOCKED
