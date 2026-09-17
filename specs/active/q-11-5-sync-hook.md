---
id: q-11-5-sync-hook
status: locked
class: GOD_FILE_GROWTH
skill: specify
edit_mode: patch
who: any-agent
auto_go: false
allowed_files:
  - src/App.tsx
  - src/hooks/useAppSync.ts
  - src/components/CATALOG.json
frozen_files:
  - src/utils/syncUtils.ts
  - src/utils/supabaseJobSync.ts
  - src/utils/firestoreUtils.ts
  - server_routes_sync.ts
  - src/types.ts
  - src/jobs/JobStore.ts
  - docs/agent/standing.json
  - scripts/journey-guard.mjs
  - scripts/assert-standing.mjs
  - scripts/assert-budgets.mjs
  - scripts/assert-egress-bomb.mjs
  - AGENTS.md
gate:
  - npx tsc --noEmit
  - node scripts/assert-parity.mjs
  - node scripts/assert-budgets.mjs
  - npm run test:sync
  - node scripts/assert-egress-bomb.mjs
  - node scripts/journey-guard.mjs q-11-5-sync-hook
  - node scripts/assert-spec-diff.mjs q-11-5-sync-hook
  - node scripts/assert-shell-smoke.mjs
---

# Packet: Q-11.5 — cloud sync into a hook (milestone 5 of 9)

Umbrella laws apply (`specs/active/Q-11.md`). Promote `auto_go` after Q-11.4 is committed.
**Human go is recommended for this one even when promoted:** it is the milestone that once silently
became a localStorage-only stub (`useAppSync` in `a14abea`), which is how cloud sync disappeared
while the UI kept claiming a sync state.

## Scope

`src/hooks/useAppSync.ts` (new, 300–600 lines) moving the real sync orchestration out of `App.tsx`:

- Supabase / Firestore merge, conflict detection (`syncState`: synced / syncing / local / conflict),
  offline queueing, `cloudSync` / `forcePush` / `forcePushWithFoods` / `forcePull` entry points.
- The existing sync utilities and the server sync route are **frozen** — this milestone relocates
  their call sites, it does not change transport, payloads or conflict rules.
- A localStorage-only implementation is a **failed milestone**, not a smaller one. If the real
  client cannot be initialised in this environment, stop and report instead of shipping a stub.

## Done means

- `src/App.tsx` ≤ 7,300 lines; `npm run test:sync` green; `assert-egress-bomb` green.
- `CATALOG.json` `src/App.tsx` ceiling lowered to the achieved count.
- Written evidence in the packet or handover: which credentials/endpoints were exercised, and which
  were not, so the gap is visible rather than hidden behind a green sync badge.
