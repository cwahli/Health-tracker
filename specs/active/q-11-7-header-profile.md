---
id: q-11-7-header-profile
status: locked
class: GOD_FILE_GROWTH
skill: specify
edit_mode: extract
who: any-agent
auto_go: true
allowed_files:
  - src/components/Header.tsx
  - src/components/ProfileModal.tsx
  - src/components/AppShell.tsx
  - src/components/CATALOG.json
frozen_files:
  - src/components/AuthScreen.tsx
  - src/components/BottomNav.tsx
  - src/components/LogChat.tsx
  - src/components/HomeTab.tsx
  - src/hooks/useAuthSession.ts
  - src/hooks/useAppProfile.ts
  - src/utils/storageUtils.ts
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
  - npx playwright test prototype/tests/auth-session.spec.ts prototype/tests/key-journeys.spec.ts
  - node scripts/journey-guard.mjs q-11-7-header-profile
  - node scripts/assert-spec-diff.mjs q-11-7-header-profile
  - node scripts/assert-shell-smoke.mjs
---

# Packet: Q-11.7 — Header / ProfileModal extract (finish the leftover)

Measured on `main` @ `4acc632` (2026-09-18). App shell is already split;
`Header.tsx` is the remaining Studio-blocking chrome file.

## Goal

Move the profile-edit portal out of `Header.tsx` into `ProfileModal.tsx`.
Header keeps identity chrome. Sign-out still returns to `#auth-card`.

## Measured now

| File | Lines | Bytes |
|---|---|---|
| `src/components/Header.tsx` | 3,937 | 231 KB |
| `src/App.tsx` | 3,114 | 135 KB (already under Studio ~200 KB) |
| `src/components/AppShell.tsx` | 383 | 13 KB |

## In scope

1. **`src/components/ProfileModal.tsx` (new, ≤ 800 lines / 200 KB)** — the
   profile portal currently inside Header: form state, save, and
   `#profile-modal-bottom-signout-btn`.
2. **`Header.tsx` ≤ 1,200 lines and < 200 KB** after the move (800 if it
   fits without rewriting). Keep `#avatar-edit-btn`, `#user-nickname-text`,
   `#profile-modal-bottom-signout-btn`.
3. `AppShell` only changes if it must pass an `onOpenProfile` / render
   `ProfileModal`. No auth rewrite.
4. Ratchet `CATALOG.json` ceilings for Header (add if missing) to the
   achieved count.

## Out of scope

- `App.tsx` handler extract (Q-11.10)
- `LogChat.tsx` split
- AuthScreen restyle
- Stubs, `@ts-nocheck`, deleting sign-out

## Invariants

- Move, do not rewrite. Bodies stay verbatim.
- `useAuthSession.handleSignOut` stays the sign-out implementation.
- `assert-parity` `profile_modal_signout` + `profile_avatar` stay green.

## Plan

### Node 1 — extract ProfileModal

- Cut the profile portal from Header into `ProfileModal.tsx`.
- Header opens it via existing avatar click (`#avatar-edit-btn`).
- Pitfall: dropping the sign-out button id.

### Node 2 — ratchet + prove

- `wc -l` / `wc -c` Header < 200 KB.
- Playwright `auth-session.spec.ts`: demo login → avatar → sign out → gate.

## Done when

1. Header < 200 KB and ≤ 1,200 lines.
2. Sign-out from the profile modal still lands on `#auth-card`.
3. Gate commands exit 0.
4. `git diff --name-only` ⊆ allowed_files.
