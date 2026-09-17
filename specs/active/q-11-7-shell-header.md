---
id: q-11-7-shell-header
status: locked
class: GOD_FILE_GROWTH
skill: specify
edit_mode: patch
who: any-agent
auto_go: false
allowed_files:
  - src/App.tsx
  - src/components/AppShell.tsx
  - src/components/Header.tsx
  - src/components/ProfileModal.tsx
  - src/components/CATALOG.json
frozen_files:
  - src/components/AuthScreen.tsx
  - src/components/BottomNav.tsx
  - src/components/LogChat.tsx
  - src/components/HomeTab.tsx
  - src/components/MedicalHistoryTab.tsx
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
  - node scripts/journey-guard.mjs q-11-7-shell-header
  - node scripts/assert-spec-diff.mjs q-11-7-shell-header
  - node scripts/assert-shell-smoke.mjs
---

# Packet: Q-11.7 — shell frame + Header/ProfileModal split (milestone 7 of 9)

Umbrella laws apply (`specs/active/Q-11.md`). Promote `auto_go` after Q-11.6 is committed.

## Scope

1. **`src/components/AppShell.tsx` (new, ≤ 300 lines)** — layout frame: `Header`, `BottomNav`, the
   offline/sync banner and the error boundary. Chrome only; no business logic.
2. **`src/components/ProfileModal.tsx` (new, ≤ 600 lines)** — the profile edit dialog currently
   living inside `Header.tsx` (3,937 lines): the portal block, its local form state, and the
   `profile-modal-bottom-signout-btn` sign-out action.
3. **`src/components/Header.tsx` ≤ 800 lines** afterwards — identity row, admin/job badges, and a
   single `onOpenProfile` prop into `ProfileModal`. Keep every existing element id that tests and
   `assert-parity` rely on (`avatar-edit-btn`, `user-nickname-text`, `profile-modal-bottom-signout-btn`).
4. The `!isLoggedIn` branch must keep rendering `AuthScreen`; the shell must never become reachable
   without a session (that was the a14abea failure).

## Done means

- `src/App.tsx` ≤ 6,200 lines; `auth-session`, `key-journeys`, `assert-shell-smoke` green.
- Sign Out from the modal inside the new `ProfileModal` still clears the session and returns to the
  sign-in gate, with the header gone.
- `CATALOG.json` ceilings lowered for `src/App.tsx` **and** `src/components/Header.tsx`.
