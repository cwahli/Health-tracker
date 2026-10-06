---
id: ping-notice-1
status: locked
skill: sync-jobs
edit_mode: patch
allowed_files:
  - scripts/bot-host.mjs
  - scripts/assert-ping-failfast.mjs
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
  - node scripts/assert-ping-failfast.mjs
  - node scripts/assert-model-failover.mjs
---

# Packet: ping-notice-1 — no stale stays-on notice on ping turns

Agent fills this. Human replies: go | stop | one comment.

## Journey
On a connectivity ping the displaced stays-on-X notice must not post: the
ping answers on its own single lane, sticky follows the answer, and the ping
reply itself names where it ran. The pre-computed ledger claim is stale by
the time the answer lands.

## Findings (do not redo)
- Live vm3 2026-10-06: `hi` ping posted "gemini-3.5-flash-lite depleted,
  ran on qwen instead, stays on qwen" AND "answered live on gemini-3.5".
  Ledger truth (opencode google/ route dead) vs execution truth (direct
  gemini: runner alive after #601). Prefs prove sticky followed the answer
  (autoSwitched to direct ref 23:48 UTC) — the notice was false.
- Same guard already applied surgically to the vm3 serving tree
  (bot-host-r14, backup bot-host.mjs.pre-pingfix-20261007 + displaced guard,
  vm3 restarted 23:51 UTC). This packet is the durable main-repo version.
- WIP check: no open PR touches this hunk (#596 agent-opencode lib only).

## Plan
1. Guard the displaced block with `!isPingTurn`. Done when: one-line change.
2. Extend `assert-ping-failfast` source check (8 checks). Done when: green.
3. Push + draft PR. Done when: CI green.

## Test plan
```text
node scripts/assert-ping-failfast.mjs
node scripts/assert-model-failover.mjs
npx vitest run tests/bot-host.test.ts -t 'BOT-9'
node scripts/journey-guard.mjs ping-notice-1
```

## Audit plan
1. Scope vs ROADMAP (hub-adjacent bugfix, no ID taken).
2. Blast radius = 1 condition + 1 sensor check. Walk, ledger, sticky untouched.
3. Residual: ledger google/ keys still read dead while direct runs alive —
   ledger/execution truth split remains for /allowance display; cf lanes
   still vendor-dead.

## Blast radius
Allowed / Frozen are the YAML lists above.
Out of scope: ledger projection, sticky logic, cf pref rows.

## Stop and come back
Two repairs fail · Frozen file in the diff · New class appears · Live Gemini requested
