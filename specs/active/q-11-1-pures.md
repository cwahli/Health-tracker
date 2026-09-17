---
id: q-11-1-pures
status: locked
class: GOD_FILE_GROWTH
skill: specify
edit_mode: patch
who: any-agent
auto_go: true
allowed_files:
  - src/App.tsx
  - src/utils/appProfileUtils.ts
  - src/utils/appProfileUtils.unit.test.ts
  - src/components/AppDynamicStyles.ts
  - src/components/CATALOG.json
  - scripts/assert-spec-diff.mjs
  - scripts/assert-spec-diff.test.mjs
  - scripts/assert-parity.mjs
  - scripts/parity-baseline.json
frozen_files:
  - src/types.ts
  - src/jobs/JobStore.ts
  - src/components/LogChat.tsx
  - src/components/Header.tsx
  - src/components/AuthScreen.tsx
  - src/utils/storageUtils.ts
  - docs/agent/standing.json
  - scripts/journey-guard.mjs
  - scripts/assert-standing.mjs
  - scripts/assert-budgets.mjs
  - AGENTS.md
gate:
  - npx tsc --noEmit
  - node scripts/assert-parity.mjs
  - node scripts/assert-budgets.mjs
  - npx vitest run src/utils/appProfileUtils.unit.test.ts src/utils/appProfileUtils.test.ts src/jobs/__tests__/JobSession.contract.test.ts
  - node scripts/journey-guard.mjs q-11-1-pures
  - node scripts/assert-spec-diff.mjs q-11-1-pures
  - node scripts/assert-shell-smoke.mjs
---

# Packet: Q-11.1 — pure helpers out of `App.tsx` (milestone 1 of 9)

Part of the umbrella `specs/active/Q-11.md`. Read its Laws first; they override anything here.

## Scope

1. **`src/utils/appProfileUtils.ts` (new, ≤ 200 lines)** — move these out of `src/App.tsx`, bodies
   unchanged: `sanitizeProfile`, `isDeepEqual`, `pushPendingObservation`, and any other pure profile
   helper that has no React/`JobStore`/network dependency. Pure only: no hooks, no `useState`, no
   `fetch`, no side effects at module scope.
2. **`src/utils/appProfileUtils.unit.test.ts` (new)** — idempotency of `sanitizeProfile` (sanitize
   twice = sanitize once), default profile round-trip, `isDeepEqual` edge cases (null/undefined/
   nested/order), `pushPendingObservation` immutability, `maybeRecalibrateDemographicOverlays` no-ops.
   Leave `src/utils/appProfileUtils.test.ts` alone: despite its name it holds the Q-9
   `getDynamicStyles` parity tests, and the first draft of this milestone overwrote it. The
   rewrite rule in `assert-spec-diff` caught that — do not repeat it.
3. **`src/components/AppDynamicStyles.ts`** — verify only (Q-9 already extracted it): pure, ≤ 350
   lines, no state. Fix nothing unless it is impure; if it is impure, stop and report instead.
4. **Wire `App.tsx`** to import the moved helpers; delete the local copies. No call-site changes.
5. **Guard fix (required, this milestone cannot pass without it):** `scripts/assert-spec-diff.mjs`
   counts a newly added file as ~100% churn and therefore fails every milestone that adds a module.
   Skip the rewrite check when the path does not exist at `HEAD` (a file that never existed cannot be
   a rewrite), and add `scripts/assert-spec-diff.test.mjs` proving the guard still fails a genuine
   in-place rewrite of an existing file. Do not weaken any other check.

## Done means

- `src/App.tsx` ≤ 8,950 lines and the removed lines ≈ the new module's lines.
- `CATALOG.json`: lower the `src/App.tsx` ceiling to the achieved line count in this commit.
- Nothing outside `allowed_files` changed; `node scripts/assert-parity.mjs` green.
