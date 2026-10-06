---
id: google-reroute-1
status: locked
skill: sync-jobs
edit_mode: patch
allowed_files:
  - scripts/bot-host.mjs
  - scripts/assert-google-reroute.mjs
frozen_files:
  - src/App.tsx
  - src/components/LogChat.tsx
  - src/jobs/JobStore.ts
  - server_meal_gate.ts
  - AGENTS.md
  - docs/agent/standing.json
  - scripts/assert-standing.mjs
  - scripts/journey-guard.mjs
  - scripts/lib/free-lanes.mjs
  - scripts/lib/freemodels.mjs
  - scripts/lib/agent-opencode.mjs
  - scripts/lib/agent-gemini.mjs
gate:
  - node scripts/assert-google-reroute.mjs
  - node scripts/assert-ping-failfast.mjs
  - node scripts/assert-model-failover.mjs
---

# Packet: google-reroute-1 — raw google/ never burns a turn

Agent fills this. Human replies: go | stop | one comment.

## Journey
A configured `google/<id>` ref must execute through the direct `gemini:`
runner (GEMINI_API_KEY answers; pinged PONG on vm3), never through the
OpenCode `google/` provider (unwired on the VPS; every attempt ends
`Model unavailable`). All other surfaces pass through byte-identical.

## Findings (do not redo)
- Stacked on `agent/ping-failfast` (PR #599 draft); base will be that branch.
  No other open PR touches these hunks (#596 agent-opencode lib only, #597
  free-lanes/tests/vendor, #593 docs).
- Live proof 2026-10-06 on vm3 deploy tree via SSH (read-only + 6 minimal
  PONG pings, quota authorized by operator's "ping them"):
  longcat `PONG` (primary healthy now — the `hi` failure was transient);
  `google/gemini-3.5-flash-lite`, `cloudflare/@cf/qwen3.8-27b`,
  `cloudflare/@cf/zai-org/glm-4.7-flash` all `Model unavailable`, and the cf
  id refused under 3 spellings (`cloudflare/@cf/…`, `@cf/…`,
  `opencode/cloudflare/@cf/…`) — vendor-side, not our formatting.
- Direct runner proof: `runGemini(model: gemini/gemini-3.5-flash-lite)` →
  `PONG` on vm3 with common.env key.
- `laneWalkRef`/`toModelRef` mishandle pre-prefixed `google/…` ids
  (double-prefix); left untouched (owned mirror files) — the new
  `execModelRef` strips first, is idempotent, and is the only mapping added.
- cf lanes: ledger says available, vendor refuses. Left as-is (transient
  possible); removal from pref is the operator's call, separate change.

## Plan
1. `execModelRef` in `scripts/bot-host.mjs` (exported, pure, idempotent).
   Done when: google/gemini surfaces → `gemini:` direct; all else identical.
2. Apply at the ledger first entry and the ping pair (the ledger-empty
   legacy pair stays raw — the protected BOT-9 sensor pins that call, so any
   change there needs your explicit before→after). Done when: no raw
   `google/` id reaches execution on the ledger or ping paths.
3. Sensor `scripts/assert-google-reroute.mjs` 9/0. Done when: green, no network.

## Test plan
```text
node scripts/assert-google-reroute.mjs
node scripts/assert-ping-failfast.mjs
node scripts/assert-model-failover.mjs
npx vitest run tests/bot-host.test.ts -t 'BOT-9'
node scripts/journey-guard.mjs google-reroute-1
```

## Audit plan
1. Scope vs ROADMAP (R-16/BOT-24 current; hub-adjacent bugfix, no ID taken).
2. Blast radius = 1 helper + 2 hunks + 1 new sensor. Ledger identity,
   groups, sticky comparisons stay on the configured ref.
3. Residual: cf lanes still walked on real turns until vendor recovers or
   pref is edited; tier-pin #596 + ping #599 still unmerged/undeployed.

## Blast radius
Allowed / Frozen are the YAML lists above.
Out of scope: lane projection, catalog mirror, cf pref rows, TUI rendering.

## Stop and come back
Two repairs fail · Frozen file in the diff · New class appears · Live Gemini requested
