---
id: q-11-6-tabs-modals
status: locked
class: GOD_FILE_GROWTH
skill: specify
edit_mode: patch
who: any-agent
auto_go: false
allowed_files:
  - src/App.tsx
  - src/components/AppTabs.tsx
  - src/components/AppModals.tsx
  - src/components/CATALOG.json
frozen_files:
  - src/components/LogChat.tsx
  - src/components/HomeTab.tsx
  - src/components/MedicalHistoryTab.tsx
  - src/components/InsightsTab.tsx
  - src/components/Header.tsx
  - src/components/BottomNav.tsx
  - src/components/UniversalModal.tsx
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
  - npx playwright test prototype/tests/dialog-inventory.spec.ts prototype/tests/key-journeys.spec.ts
  - node scripts/journey-guard.mjs q-11-6-tabs-modals
  - node scripts/assert-spec-diff.mjs q-11-6-tabs-modals
  - node scripts/assert-shell-smoke.mjs
---

# Packet: Q-11.6 — tab switcher & modal host (milestone 6 of 9)

Umbrella laws apply (`specs/active/Q-11.md`). Promote `auto_go` after Q-11.5 is committed.

## Scope

1. **`src/components/AppTabs.tsx` (new, ≤ 300 lines)** — declarative routing between the existing
   tab components (`HomeTab`, `MedicalHistoryTab`, `LogChat`, `InsightsTab`, `TrendsTab`), props
   passed through unchanged. Tab components themselves are **frozen**: this is a switch statement
   moving house, not a rewrite of any tab.
2. **`src/components/AppModals.tsx` (new, ≤ 300 lines)** — the open-dialog set the monolith renders
   (`UniversalModal`, `SyncDiagnosticsModal`, `NutritionDataBrowserModal`, `UserManagementTab`,
   `AllAnalysesModal`, …), driven by the same state the monolith already keeps.
3. **No placeholder handlers (L4).** Every modal and tab must be reachable and bound to the real
   action it has today. The a14abea attempt shipped placeholder cards on Home; that is a failed
   milestone even with green gates.

## Done means

- `src/App.tsx` ≤ 6,600 lines; `dialog-inventory` and `key-journeys` green.
- Every modal that opens today still opens, verified live (name the ones you actually opened in the
  handover line — "all of them" is not evidence).
- `CATALOG.json` `src/App.tsx` ceiling lowered to the achieved count.
