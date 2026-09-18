---
id: q-11-11-wiring-ratchet
status: locked
class: GOD_FILE_GROWTH
skill: specify
edit_mode: extract
who: any-agent
# DONE 2026-09-18 — App.tsx 1,098 → 350 lines / 14,416 B via useAppShellState.ts;
# CATALOG App ceiling 350; parity re-recorded. Do not re-execute.
auto_go: false
blocked_by: q-11-10-app-handlers
allowed_files:
  - src/App.tsx
  - src/hooks/useAppShellState.ts
  - src/components/CATALOG.json
  - scripts/parity-baseline.json
  - AI_HANDOVER.md
frozen_files:
  - src/hooks/useAuthSession.ts
  - src/hooks/useAppProfile.ts
  - src/hooks/useAppSync.ts
  - src/hooks/useJobRuntime.ts
  - src/hooks/useFoodLogActions.ts
  - src/hooks/useBiomarkerActions.ts
  - src/hooks/useReportActions.ts
  - src/components/LogChat.tsx
  - src/components/Header.tsx
  - src/components/AuthScreen.tsx
  - src/jobs/JobStore.ts
  - src/types.ts
  - docs/agent/standing.json
  - scripts/journey-guard.mjs
  - scripts/assert-standing.mjs
  - scripts/assert-budgets.mjs
  - scripts/assert-parity.mjs
  - AGENTS.md
gate:
  - npx tsc --noEmit
  - node scripts/assert-parity.mjs
  - node scripts/assert-budgets.mjs
  - node scripts/assert-egress-bomb.mjs
  - npm run build:web
  - npx playwright test prototype/tests/auth-session.spec.ts
  - node scripts/journey-guard.mjs q-11-11-wiring-ratchet
  - node scripts/assert-spec-diff.mjs q-11-11-wiring-ratchet
  - node scripts/assert-shell-smoke.mjs
---

# Packet: Q-11.11 — App.tsx wiring ratchet (close the umbrella)

After Q-11.10, leftover state/effects still sit in App.tsx. This is the
last Q-11 milestone: App.tsx is only hooks-in / `<AppShell>`-out.

## Goal

`src/App.tsx` ≤ **350 lines** and < 30 KB. CATALOG + parity baseline
ratcheted to the achieved count. Record final sizes in `AI_HANDOVER.md`.

## In scope

1. Move leftover `useState` / `useEffect` that are not already in a hook
   into the hook that owns that domain (food / biomarker / report / sync).
   Prefer extending Q-11.10 hooks over new files.
   **Amendment 2026-09-18 (human-approved: new shell-state hook path):**
   all Q-11.10 hooks are frozen, so leftovers go into one new module
   `src/hooks/useAppShellState.ts` with two hooks: `useAppShellState()`
   (no params — owns every store, wrapper, ref-target-independent
   callback, and store-only effect) and `useAppShellEffects()` (late
   call — owns `isFoodChatOpen` derivation plus the effects that close
   over `profile` / `saveAndSync` / `activeJobId`). Bodies move verbatim;
   `useRef(profile)`-style first-render ref values stay in App.tsx.
2. App.tsx: imports, hook calls, `return <AppShell … />`. No `handle*`
   function bodies.
3. `CATALOG.json` `src/App.tsx` ceiling = achieved line count.
4. `node scripts/assert-parity.mjs --update` **only** if types/i18n/appLines
   improved vs `818808f` baseline, and say so in the commit.
5. One HANDOVER line: final `wc -l` / `wc -c` for App.tsx, Header,
   AppModals, the three action hooks.

## Out of scope

- LogChat / BiomarkerDictionaryModal / FoodCard splits (own packets)
- Auth redesign
- Raising any CATALOG ceiling

## Invariants

- Move-only. If an orphan cannot be placed, **stop and report**.
- `lastSyncTime` identifier remains in `src/App.tsx` (standing
  `egress_conservation`) even if the value lives in `useAppSync`.
- Auth gate: `!profile` → `AuthScreen`; never `createDefaultProfile()` as
  a logged-in shell.

## Plan

### Node 1 — park leftovers

List every App.tsx declaration still not from a hook. Put each in the
owning hook. Stop if any needs a fourth new file.

### Node 2 — ratchet

Ceilings + optional parity --update. `build:web`. Auth-session +
shell-smoke.

## Done when

1. `wc -l src/App.tsx` ≤ 350
2. `wc -c src/App.tsx` < 30000
3. CATALOG App.tsx ceiling equals achieved count
4. Gate commands exit 0
5. Live: sign-in → demo shell → Sign Out → gate (Playwright)
