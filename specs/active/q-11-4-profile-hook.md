---
id: q-11-4-profile-hook
status: locked
class: GOD_FILE_GROWTH
skill: specify
edit_mode: patch
who: any-agent
auto_go: false
allowed_files:
  - src/App.tsx
  - src/hooks/useAppProfile.ts
  - src/utils/appProfileUtils.ts
  - src/components/CATALOG.json
  - prototype/tests/auth-session.spec.ts
frozen_files:
  - src/types.ts
  - src/utils/storageUtils.ts
  - src/utils/firestoreUtils.ts
  - src/components/Header.tsx
  - src/components/AuthScreen.tsx
  - docs/agent/standing.json
  - scripts/journey-guard.mjs
  - scripts/assert-standing.mjs
  - scripts/assert-budgets.mjs
  - AGENTS.md
gate:
  - npx tsc --noEmit
  - node scripts/assert-parity.mjs
  - node scripts/assert-budgets.mjs
  - npx vitest run src/utils/appProfileUtils.test.ts
  - npx playwright test prototype/tests/auth-session.spec.ts
  - node scripts/journey-guard.mjs q-11-4-profile-hook
  - node scripts/assert-spec-diff.mjs q-11-4-profile-hook
  - node scripts/assert-shell-smoke.mjs
---

# Packet: Q-11.4 — profile state into a hook (milestone 4 of 9)

Umbrella laws apply (`specs/active/Q-11.md`). Promote `auto_go` after Q-11.3 is committed.

## Scope

`src/hooks/useAppProfile.ts` (new, ≤ 300 lines), moved — **not** re-invented:

- Profile load/save against the real sources the monolith uses (`getStorageKey(email)` per-email
  bundles, `last_active_email`, Firestore/Supabase cache), demographic overlay calibration, pending
  observations, `saveProfile`.
- **The storage contract is frozen.** Do not introduce a new localStorage key, do not rename
  `last_active_email`, and do not fall back to a demo profile when the stored profile is absent —
  the a14abea regression came precisely from a `user_profile` key nothing else writes plus a demo
  default whose email kept `isLoggedIn` true forever.
- Storage helpers stay in `src/utils/storageUtils.ts` and friends (`frozen_files`); this milestone
  only moves the React-facing orchestration.

## Done means

- `src/App.tsx` ≤ 8,000 lines; the header still shows the signed-in user's nickname/email/photo
  after a reload, and Sign Out still returns to the gate.
- `CATALOG.json` `src/App.tsx` ceiling lowered to the achieved count.
- `node scripts/assert-parity.mjs` green, in particular `profile_avatar` and `profile_modal_signout`.
