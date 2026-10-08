---
id: tier-pin-1
status: locked
skill: sync-jobs
edit_mode: patch
allowed_files:
  - scripts/lib/agent-opencode.mjs
  - scripts/lib/health/seat-model.mjs
  - scripts/assert-tier-pin.mjs
frozen_files:
  - src/App.tsx
  - src/components/LogChat.tsx
  - src/jobs/JobStore.ts
  - server_meal_gate.ts
  - AGENTS.md
  - docs/agent/standing.json
  - scripts/assert-standing.mjs
  - scripts/journey-guard.mjs
  - scripts/bot-host.mjs
  - scripts/lib/free-lanes.mjs
  - scripts/lib/freemodels.mjs
gate:
  - node scripts/assert-tier-pin.mjs
  - node scripts/assert-model-failover.mjs
---

# Packet: tier-pin-1 — no silent high → light failover

Agent fills this. Human replies: go | stop | one comment.

## Journey
A `high` (coding-agent-capable) turn that hits a transport failure
(`Endpoint is unavailable`, 502/503/504) must fail closed on the high tier —
never silently continue on a `light` (docs/inventory) lane. Light only on
explicit opt-in (`allowTierDowngrade: true`, i.e. user tap).

## Findings (do not redo)
- WIP check 2026-10-06: open PR #595 (`agent/freemodel-verdict-and-labels-v2`)
  plus local `agent/routable-walk-refs` own `free-lanes.mjs` / `bot-host.mjs` /
  `freemodels.mjs`. This packet touches NONE of those (claim-guard).
- `free-catalogs.mjs` orders high(0) → unlisted(1) → light(2); the old
  `runWithModelFailover` walked whatever it was given, so high → light was
  automatic. Fixed at the dispatch layer (`agent-opencode.mjs`), which #595
  does not touch.
- TUI inline-image rendering (ttyd/xterm alt-screen) and the opencode-TUI
  `\"` echo are upstream display issues, out of scope for this packet.
  `bot-host.mjs` ping line (JSON.stringify) left untouched — owned WIP.

## Plan
1. `pinTierModels` + `isTransportFailure` + `tierOfModel` in
   `scripts/lib/agent-opencode.mjs`. Done when: high primary drops light
   fallback, high→high survives, light/unknown chains untouched. 
2. `runWithModelFailover` accepts `allowTierDowngrade` / `tierOf`, returns
   `{ dropped, tierPinned }`, emits no switch line on a pinned chain. Done
   when: existing `assert-model-failover` still 19/0 (stub tiers unknown).
3. New sensor `scripts/assert-tier-pin.mjs` 15/0. Done when: green, no network.

## Test plan
```text
node scripts/assert-tier-pin.mjs
node scripts/assert-model-failover.mjs
node scripts/journey-guard.mjs tier-pin-1
```

## Audit plan
1. Scope vs ROADMAP (R-16/BOT-24 current; this is a hub-adjacent bugfix, no ID taken).
2. Blast radius = 1 lib + 1 new sensor. No hub projection touched.
3. Residual: bot-host still passes full chain including light when the ledger
   offers it — callers opt in explicitly in a follow-up once #595 merges.

## Blast radius
Allowed / Frozen are the YAML lists above.
Out of scope: free-lanes projection, bot-host message path, TUI rendering.

Seat turns opt in (`allowTierDowngrade: true` in `runSeatModel`). Their chain is the chat model, then the bot's configured default, and `assert-seat-model` requires that default to run even when the catalog calls it light. The pin still applies to every other caller.

## Stop and come back
Two repairs fail · Frozen file in the diff · New class appears · Live Gemini requested
