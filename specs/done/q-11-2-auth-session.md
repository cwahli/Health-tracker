---
id: q-11-2-auth-session
status: locked
class: GOD_FILE_GROWTH
skill: specify
edit_mode: patch
who: any-agent
auto_go: false
allowed_files:
  - src/App.tsx
  - src/hooks/useAuthSession.ts
  - src/components/CATALOG.json
  - prototype/tests/auth-session.spec.ts
frozen_files:
  - src/types.ts
  - src/components/AuthScreen.tsx
  - src/components/Header.tsx
  - src/utils/storageUtils.ts
  - src/jobs/JobStore.ts
  - src/firebase.ts
  - docs/agent/standing.json
  - scripts/journey-guard.mjs
  - scripts/assert-standing.mjs
  - scripts/assert-budgets.mjs
  - AGENTS.md
gate:
  - npx tsc --noEmit
  - node scripts/assert-parity.mjs
  - node scripts/assert-budgets.mjs
  - npx playwright test prototype/tests/auth-session.spec.ts
  - node scripts/journey-guard.mjs q-11-2-auth-session
  - node scripts/assert-spec-diff.mjs q-11-2-auth-session
  - node scripts/assert-shell-smoke.mjs
---

# Packet: Q-11.2 — auth & session into a hook (milestone 2 of 9)

> **LANDED** (`dc19a18` is the parent; see the progress log in `specs/active/Q-11.md`).
> `src/hooks/useAuthSession.ts` 283 lines, `App.tsx` 9,004 → 8,803, CATALOG ceiling 9,010 → 8,810.
> Kept in `specs/active/` so its gates stay runnable; `auto_go` off.

Umbrella laws apply (`specs/active/Q-11.md`). Promote `auto_go` only after Q-11.1 is committed.

## Scope

`src/hooks/useAuthSession.ts` (new, 250–450 lines) owning exactly what the monolith already does —
move, do not redesign:

- `onAuthStateChanged(auth, …)` subscription, session restore, `isAuthChecking` flag.
- `handleLogin` / demo entry (`loginAsDemo`), profile hydration from `auth.currentUser`
  (`uid`, `email`, `displayName`/`nickname`, `photoURL`) and `getEffectiveUser()`-style resolution.
- `handleSignOut`: `fbSignOut(auth)`, clear React state, remove `last_active_email` /
  `demo_profile_type` / `demo_fresh_login`, `sessionStorage.clear()`, `clearCachedAppData(email)`,
  `JobStore.resetAllJobs()`, then land on the sign-in gate.
- The hook returns the same names `App.tsx` uses today so the diff stays a move.

`prototype/tests/auth-session.spec.ts` already covers the two user-visible outcomes; extend it only
if the hook introduces a new state worth asserting. Do not weaken its assertions.

## Done means

- `src/App.tsx` ≤ 8,600 lines; ≈ (8,950 − new module lines) removed.
- Sign-in → demo shell → Sign Out → sign-in gate still works live, with no page errors.
- `CATALOG.json` `src/App.tsx` ceiling lowered to the achieved count.
- The three `assert-parity` capability checks that name auth (`auth_state_listener`, `auth_signout_call`,
  `session_cache_clear`, `jobstore_reset`) stay green — they will point at this new file.
