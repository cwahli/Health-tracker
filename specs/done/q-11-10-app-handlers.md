---
id: q-11-10-app-handlers
status: locked
class: GOD_FILE_GROWTH
skill: specify
edit_mode: extract
who: any-agent
# DONE 2026-09-18 (`e2ab233`) — App.tsx 3,114 → 1,098 via useFoodLogActions /
# useBiomarkerActions / useReportActions. Do not re-execute.
auto_go: false
blocked_by: q-11-7-header-profile
allowed_files:
  - src/App.tsx
  - src/hooks/useFoodLogActions.ts
  - src/hooks/useBiomarkerActions.ts
  - src/hooks/useReportActions.ts
  - src/components/AppViewProps.ts
  - src/components/CATALOG.json
frozen_files:
  - src/hooks/useAuthSession.ts
  - src/hooks/useAppProfile.ts
  - src/hooks/useAppSync.ts
  - src/hooks/useJobRuntime.ts
  - src/components/LogChat.tsx
  - src/components/Header.tsx
  - src/components/AuthScreen.tsx
  - src/jobs/JobStore.ts
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
  - node scripts/assert-egress-bomb.mjs
  - npx vitest run src/jobs/__tests__/JobSession.contract.test.ts
  - node scripts/journey-guard.mjs q-11-10-app-handlers
  - node scripts/assert-spec-diff.mjs q-11-10-app-handlers
  - node scripts/assert-shell-smoke.mjs
---

# Packet: Q-11.10 — move remaining App.tsx handlers into hooks

`App.tsx` is already a Studio-sized file (3,114 lines / 135 KB) but it still
owns ~31 `handle*` functions (food CRUD, biomarker mutations, reports).
Q-11.9's ≤ 1,200-line wiring target is this extract, not another rewrite.

## Goal

`src/App.tsx` ≤ 1,200 lines. Handlers move verbatim into three hooks. No
behavior change. No localStorage-only stubs.

## Measured now (`main` @ `4acc632`)

`App.tsx` 3,114 lines. Remaining bodies (approx):

| Hook (new) | Handlers to move |
|---|---|
| `useFoodLogActions.ts` | `handleLogFood`, `handleUpdateFoodLog`, `handleDeleteFoodLog`, `handleResolveConflict`, `handleRestoreSnapshot`, `handleFetchMoreFoods` (if still in App) |
| `useBiomarkerActions.ts` | `handleLogMedical` through `handleApplyCalculation` (the biomarker batch/edit/combine set) |
| `useReportActions.ts` | `handleAcceptReport`, `handleRejectReport`, `handleGenerateReport`, `handleAgentAnalysisSaved`, `handleDeleteAnalysis` |

## In scope

- Verbatim move of those functions. App.tsx calls the hooks and passes
  results into `AppViewProps`.
- `AppViewProps.ts` only if a type must follow a moved setter.
- Ratchet `CATALOG.json` `src/App.tsx` ceiling from 7,685 to the achieved
  count (must be ≤ 1,200).

## Out of scope

- Header/ProfileModal (Q-11.7, do first)
- Shrinking App.tsx below 350 lines (Q-11.11)
- LogChat split
- Changing sync, auth, or kcal writers

## Invariants

- Move-only. Two failed rewrites (`a14abea`, `7d94def`) — do not stub
  `saveAndSync` / `loadUserData`.
- `lastSyncTime` / `forcePull \|\| forceReplaceLocal` stay reachable from
  `src/App.tsx` (egress standing).
- `finalizeDishLedger` untouched.

## Plan

### Node 1 — food log actions

Move food CRUD + conflict + snapshot. App.tsx ≤ ~2,600. `tsc` + egress-bomb.

### Node 2 — biomarker actions

Move the biomarker handler block. App.tsx ≤ ~1,600. `tsc`.

### Node 3 — report actions + ratchet

Move report/analysis handlers. App.tsx ≤ 1,200. Lower CATALOG ceiling.
Shell-smoke.

## Done when

1. `wc -l src/App.tsx` ≤ 1,200
2. All three hooks exist; App.tsx contains no `handleLogMedical` /
   `handleLogFood` / `handleGenerateReport` function bodies
3. Gate commands exit 0
