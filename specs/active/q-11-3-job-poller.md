---
id: q-11-3-job-poller
status: locked
class: GOD_FILE_GROWTH
skill: specify
edit_mode: patch
who: any-agent
auto_go: false # re-scoped 2026-09-17 — see "Re-scope" below; needs 3a + 3b first
blocked_by: 3a-state-declarations, 3b-persist-injection
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

Umbrella laws apply (`specs/active/Q-11.md`). **Re-scoped 2026-09-17 before any code moved** —
the packet's own escape hatch applies: the loop is entangled with sync and chat state, so this is
a finding, not a refactor invented inside a move-only packet. Concrete measurements, all against
`src/App.tsx` at `818808f` (8,803 lines):

1. **There is no self-contained poll loop to lift.** The `/api/jobs/status` polling lives in
   `JobQueueRunner` (`src/jobs/`) and in the job-status effect, not in a `useJobPoller`-shaped block.
   What *is* in the shell is a mount effect (≈1400–1530) that mixes four responsibilities:
   `JobQueueRunner.start()`/`stop()`, the golden-ingest idle watcher, the `JobStore.subscribe`
   **credit settlement** subscriber, and the `window.JobStore` / `window.setActiveJobId` globals.
   The subscriber is not polling — it calls
   `saveAndSync(newProfile, foodLogsRef.current, …, { type: 'profile' })`.
2. **`saveAndSync` cannot be handed to a hook at that point.** It is declared at line **3283**,
   after the effect; passing it to a hook call at ≈1475 is a temporal-dead-zone error at render
   time. A ref-injected callback is required (or the persistence layer moves first, which is Q-11.5).
3. **`activeJobId` is consumed before any later hook site.** It is declared at **624**, derived into
   `isFoodChatOpen` at **1519–1525**, and `isFoodChatOpen` appears in a `useEffect` dependency array
   at **1701–1710** — evaluated *during render*. So a hook returning it must be called before ≈1519,
   which is exactly where `saveAndSync` (3283) is unavailable. Hence 3a + 3b.
4. **`handleOpenJob` needs setters declared after the hook site** — `setIsMedicalChatOpen` (1534),
   `setIsFrontDeskOpen` (1563), `setActiveAgentType` (1564), `setActiveReviewBiomarkerKey` (1565).

## Re-scope

`q-11-3` splits into two small, verifiable prerequisites and then the real move. Each is its own
commit; do not run them together with the milestone itself.

- **3a `state-declarations`** (prep, no behaviour change): hoist those four `useState` declarations
  into the top state block (≈620) and move the `activeJobId`-derived `isFoodChatOpen` / the effect
  whose dependency array reads it so they sit *after* the future hook. A pure declaration move:
  hook order stays stable across renders, and `tsc` rejects any use-before-declaration.
- **3b `persist-injection`** (prep, no behaviour change): give the job runtime a
  `persistProfile` callback through a ref assigned immediately after `saveAndSync` is declared, so
  the subscriber can call it post-mount without capturing a TDZ binding. Document why in the hook.
- **3c the move itself**: `src/hooks/useJobRuntime.ts` owns the mount effect above
  (`JobQueueRunner` lifecycle, golden-ingest watcher, credit settlement, window globals),
  `activeJobId`, and `handleOpenJob`. Retarget: `src/App.tsx` ≤ 8,550 (the effect is ≈130 lines plus
  the derived handlers, *not* the 200+ the original forecast assumed).

Everything else in this packet still holds: `JobStore` contracts, job-status vocabulary and the
`/api/jobs/status` payload stay frozen, and `JobSession.contract.test.ts` remains the proof.

## Done means

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

- `src/App.tsx` ≤ 8,550 lines; `JobSession.contract.test.ts` green (10/10 at baseline).
- `CATALOG.json` `src/App.tsx` ceiling lowered to the achieved count.
- Polling behaviour visibly unchanged: a queued job still drives the header badge and the chat card.
