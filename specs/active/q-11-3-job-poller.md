---
id: q-11-3-job-poller
status: locked
class: GOD_FILE_GROWTH
skill: specify
edit_mode: patch
who: any-agent
auto_go: true # promoted 2026-09-17 after Q-11.2 landed
allowed_files:
  - src/App.tsx
  - src/hooks/useJobPoller.ts
  - src/components/CATALOG.json
frozen_files:
  - src/jobs/JobStore.ts
  - src/jobs/__tests__/JobSession.contract.test.ts
  - src/components/LogChat.tsx
  - src/components/AgentResultTable.tsx
  - src/types.ts
  - docs/agent/standing.json
  - scripts/journey-guard.mjs
  - scripts/assert-standing.mjs
  - scripts/assert-budgets.mjs
  - AGENTS.md
gate:
  - npx tsc --noEmit
  - node scripts/assert-parity.mjs
  - node scripts/assert-budgets.mjs
  - npx vitest run src/jobs/__tests__/JobSession.contract.test.ts
  - node scripts/journey-guard.mjs q-11-3-job-poller
  - node scripts/assert-spec-diff.mjs q-11-3-job-poller
  - node scripts/assert-shell-smoke.mjs
---

# Packet: Q-11.3 — job polling into a hook (milestone 3 of 9)

Umbrella laws apply (`specs/active/Q-11.md`). Promote `auto_go` after Q-11.2 is committed.

## Scope

`src/hooks/useJobPoller.ts` (new, ≤ 250 lines) takes the polling loop out of `App.tsx`:

- `JobStore.subscribe` wiring, the status poll loop (interval, abort on unmount, `document.hidden`
  handling if present today), `activeJobId` / `setActiveJobId`, in-flight turn tracking.
- No contract changes: `JobStore.createJob`, `currentTurn` semantics, job status vocabulary and the
  `/api/jobs/status` payload shape stay exactly as they are. `JobSession.contract.test.ts` is frozen
  and is the proof.

If the loop turns out to be entangled with sync or chat state, stop and report — that entanglement is
a finding worth a re-scope rather than a refactor invented inside a move-only packet.

## Done means

- `src/App.tsx` ≤ 8,300 lines; `JobSession.contract.test.ts` green (10/10 at baseline).
- `CATALOG.json` `src/App.tsx` ceiling lowered to the achieved count.
- Polling behaviour visibly unchanged: a queued job still drives the header badge and the chat card.
