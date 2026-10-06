---
id: ping-failfast-1
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
gate:
  - node scripts/assert-ping-failfast.mjs
  - node scripts/assert-model-failover.mjs
---

# Packet: ping-failfast-1 — pings check one lane

Agent fills this. Human replies: go | stop | one comment.

## Journey
A connectivity ping (`hi` → PONG) must exercise the real turn path on the
chat's own lane only. A dead primary on a ping surfaces one honest error, not
a ledger-wide walk across lanes the user never chose. Real prompts keep the
full walk untouched.

## Findings (do not redo)
- WIP check 2026-10-06: open PRs #596 (tier-pin, agent-opencode), #597
  (freebuff line: free-lanes/tests/vendor), #593 (docs). None touches the
  `bot-host.mjs` turn-path hunk; local `agent/walk-refs-suite` is clean and
  does not touch `bot-host.mjs`. New branch `agent/ping-failfast`.
- Live vm3 2026-10-06: `hi` walked longcat → gemini → qwen → glm → longcat,
  every lane hard-model-failure (`Model unavailable`, vendor-side, pre-quota
  per `isHardModelFailure` in `free-lanes.mjs:154-160`). Correct per-lane
  behavior, wrong turn scope for a ping.
- Mac cannot authoritatively ping vm3 lanes (no live ledger, no CF/Gemini
  creds, zero-burn probe only). No quota burned here. vm3 root cause (keys vs
  route ids vs CLI) still needs the 3 vm3-side checks from the diagnosis.

## Plan
1. `pingOnlyModels` in `scripts/bot-host.mjs` (exported, pure). Done when:
   ping → single chat model; no chat model → bot default; non-ping → null.
2. Turn path prefers `pingModels` over `laneChoice` walk. Done when: one-line
   preference, no other turn behavior changed.
3. Sensor `scripts/assert-ping-failfast.mjs` 7/0. Done when: green, no network.

## Test plan
```text
node scripts/assert-ping-failfast.mjs
node scripts/assert-model-failover.mjs
npx vitest run tests/bot-host.test.ts -t 'BOT-9'
node scripts/journey-guard.mjs ping-failfast-1
```

## Audit plan
1. Scope vs ROADMAP (R-16/BOT-24 current; hub-adjacent bugfix, no ID taken).
2. Blast radius = 1 hunk + 1 helper + 1 new sensor. Walk, ledger, ping text untouched.
3. Residual: vm3 all-lanes-down root cause still open (keys/ids/CLI); ping now
   reports it in one line instead of four.

## Blast radius
Allowed / Frozen are the YAML lists above.
Out of scope: ledger projection, failover chain, ping wording, TUI rendering.

## Stop and come back
Two repairs fail · Frozen file in the diff · New class appears · Live Gemini requested
