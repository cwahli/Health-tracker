---
id: Q-11
status: draft
class: GOD_FILE_GROWTH
skill: specify
edit_mode: patch
target_file_budget:
  root_app: "< 350 lines"
  submodules: "< 400 lines each"
allowed_files:
  - src/App.tsx
  - src/components/AppShell.tsx
  - src/components/AppTabs.tsx
  - src/components/AppModals.tsx
  - src/components/AppDynamicStyles.ts
  - src/hooks/useJobPoller.ts
  - src/hooks/useAppSync.ts
  - src/hooks/useAppProfile.ts
  - src/utils/appProfileUtils.ts
  - src/main.tsx
  - server.ts
  - plan/APP_SHELL_DECOUPLING_PLAN.md
frozen_files:
  - server_meal_gate.ts
  - server_vision_scout.ts
  - server_food_analyze_run.ts
  - src/jobs/JobStore.ts
  - src/components/LogChat.tsx
  - src/components/HomeTab.tsx
  - src/components/MedicalHistoryTab.tsx
  - AGENTS.md
  - docs/agent/standing.json
gate:
  - npx tsc --noEmit
  - npx vitest run src/jobs/__tests__/JobSession.contract.test.ts
  - node scripts/assert-shell-smoke.mjs
  - npm run build:web
---

# Q-11 Plan — Modular App Shell Decoupling & Multi-Environment Parity

## 1. Context & Executive Summary

### Problem
`src/App.tsx` historically grew into a 9,370-line "god file" containing the entire application state, sync engines, long-polling loops, profile migration logic, dynamic CSS generators, and modal orchestration. Although task **Q-9** initiated an extract-only reduction (extracting `AppDynamicStyles.ts` to bring `App.tsx` to 9,045 lines), the file remained a single ~350 KB monolith.

When transferring the repository into cloud sandbox environments like Google AI Studio:
1. **Sync / Transfer Drop**: Monolithic files over 300 KB or uncommitted changes frequently get omitted or truncated during environment cloning and zip extraction.
2. **AI Studio Dev Server Failure**: AI Studio runs `NODE_ENV !== "production"` where `server.ts` mounts Vite in middleware mode. When `src/App.tsx` is missing or exceeds parser limits, Vite throws `Could not resolve "./App" from "src/main.tsx"`, leaving `<div id="root"></div>` completely unrendered.
3. **Live Site Divergence**: Live production environments (Render / Cloud Run) serve pre-compiled static assets from `dist/` and never parse `.tsx` files on the fly. As a result, production appears to run while development environments fail to boot.
4. **LLM Context Bottleneck**: No coding agent in AI Studio can safely read, modify, or maintain a 9,000-line single file in a single turn without hitting token output limits or truncation errors.

### Goal
Decouple `src/App.tsx` into clean, modular sub-components and hooks with a **strict file size ceiling (<350 lines for `App.tsx`, <400 lines for any extracted sub-module)**. Ensure seamless compatibility across both AI Studio (Vite dev middleware) and Live Production (Render / Cloud Run `dist/` build).

---

## 2. File Size & Architectural Budget

| Module | Target Path | Responsibility | Size Ceiling |
|---|---|---|---|
| **Root Entry** | `src/App.tsx` | Global providers, context wrappers, root state coordinator | **≤ 350 lines** |
| **Shell Frame** | `src/components/AppShell.tsx` | Header bar, bottom navigation pills/tabs, toast/banner zone | **≤ 300 lines** |
| **Tab Switcher** | `src/components/AppTabs.tsx` | Routing between Home, Medical History, Food Chat, Insights, Trends | **≤ 250 lines** |
| **Modal Host** | `src/components/AppModals.tsx` | Declarative mounting of `UniversalModal`, `SyncDiagnostics`, `Catalog` | **≤ 300 lines** |
| **Job Poller Hook** | `src/hooks/useJobPoller.ts` | Polling `JobStore`, background status updates, active turn tracking | **≤ 250 lines** |
| **Sync Hook** | `src/hooks/useAppSync.ts` | Supabase / Firestore cloud sync merge and offline queueing | **≤ 300 lines** |
| **Profile Hook** | `src/hooks/useAppProfile.ts` | Demographic overlay calibration, pending observations, profile state | **≤ 250 lines** |
| **Style Pure** | `src/components/AppDynamicStyles.ts` | Theme computation and CSS-in-JS style object generation | **≤ 350 lines** |
| **Profile Pures** | `src/utils/appProfileUtils.ts` | `sanitizeProfile`, `isDeepEqual`, `pushPendingObservation` | **≤ 200 lines** |

**Total architectural budget:** Zero single files exceed 400 lines. The entire shell is fully auditable and editable by AI coding agents within standard token budgets.

---

## 3. Dual-Environment Parity Strategy (AI Studio + Live)

### A. Development Mode (AI Studio)
- In `server.ts`, Vite dev server operates via `server: { middlewareMode: true }`.
- Every TypeScript file in `src/` must export strictly typed interfaces and use named imports.
- No dynamic imports that break Vite pre-bundling.
- `src/main.tsx` cleanly mounts `<App />` with strict error-boundary reporting.

### B. Production Mode (Render / Cloud Run)
- Production executes `npm run build` (`vite build && esbuild server.ts ...`).
- Build artifacts are emitted cleanly into `dist/`.
- `server.ts` statically serves `dist/` when `NODE_ENV === "production"`.
- Dev-mode resilience: If Vite middleware encounters an unrecoverable bundling fault in dev mode, `server.ts` gracefully checks if `dist/index.html` exists and can serve the pre-built fallback while logging diagnostics.

---

## 4. Phased Implementation Plan for Agents

### Phase 1: Pures & Utilities Extraction (Class M — Non-breaking)
1. **Restore / Verify `src/components/AppDynamicStyles.ts`**:
   - Contains `getDynamicStyles(theme, isMobile, ...)` returning style objects for the app shell.
   - Zero dependencies on React component state.
2. **Restore / Verify `src/utils/appProfileUtils.ts`**:
   - Houses pure functions: `sanitizeProfile()`, `isDeepEqual()`, `pushPendingObservation()`, `maybeRecalibrateDemographicOverlays()`.
   - Add unit test: `src/utils/appProfileUtils.test.ts` verifying idempotency.

### Phase 2: State Hooks Extraction (Class M — Logic decoupling)
1. **Create `src/hooks/useJobPoller.ts`**:
   - Encapsulates `JobStore.subscribe`, polling loop, and turn state.
   - Exposes: `{ activeJob, activeJobId, setActiveJobId, isJobPolling, jobError }`.
   - **Invariant**: Do not modify `JobStore.ts` or `src/jobs/__tests__/JobSession.contract.test.ts`.
2. **Create `src/hooks/useAppSync.ts`**:
   - Encapsulates cloud synchronization (Supabase / Firestore), conflict detection, and online/offline status.
   - Exposes: `{ syncStatus, lastSyncTime, triggerSync, forcePull }`.
3. **Create `src/hooks/useAppProfile.ts`**:
   - Manages user profile loading, biometric demographic storage, and pending observations.
   - Exposes: `{ profile, updateProfile, pendingObservations, routeObservation }`.

### Phase 3: Presentation Decomposition (Class S/M — UI Shell)
1. **Create `src/components/AppTabs.tsx`**:
   - Props: `{ currentTab, onSelectTab, profile, onUpdateProfile, activeJobId, ... }`.
   - Renders active tab: `HomeTab`, `MedicalHistoryTab`, `LogChat`, `InsightsTab`, `TrendsTab`.
   - Uses `lazyWithRetry` where appropriate to optimize bundle chunking.
2. **Create `src/components/AppModals.tsx`**:
   - Declarative container rendering open dialogs: `UniversalModal`, `SyncDiagnosticsModal`, `NutritionDataBrowserModal`, `PhotoStorageAdminTab`, `UserManagementTab`.
   - Controlled via clean modal state dictionary (`activeModal: string | null`).
3. **Create `src/components/AppShell.tsx`**:
   - Renders root container frame, `Header`, tab bar, offline banner, and error boundary.

### Phase 4: Root `App.tsx` Assembly (Class L — Assembly)
1. **Assemble `src/App.tsx`**:
   - Hooks up `useAppState`, `useAppProfile`, `useJobPoller`, and `useAppSync`.
   - Passes clean props down to `<AppShell>`, `<AppTabs>`, and `<AppModals>`.
   - Target line count: **~150–250 lines**.

---

## 5. Invariants & Guardrails (DO NOT BREAK)

1. **L1 Blast Radius**: Do not modify food calculation engines (`server_food_analyze_run.ts`, `server_vision_scout.ts`, `server_meal_gate.ts`).
2. **L2 Contracts**: Do not break existing component prop signatures (`Header`, `HomeTab`, `LogChat`, `MedicalHistoryTab`).
3. **L4 No Stubs**: All tab switches and buttons must bind to real actions; no placeholder handlers.
4. **L7 / L14 No Paint**: Do not alter test expectations or golden results to pass gates.
5. **Job Lifecycle**: Do not alter `JobStore.createJob` or `currentTurn` semantics.

---

## 6. Verification Gates

Before declaring completion, an executing agent MUST run and pass:
1. `npx tsc --noEmit` (Zero type errors).
2. `npx vitest run src/jobs/__tests__/JobSession.contract.test.ts` (Ensures job poller contracts remain 100% intact).
3. `npm run build:web` (Ensures Vite production build succeeds and generates `dist/`).
4. `node scripts/assert-budgets.mjs` (Verifies line count ceilings are respected).
5. Live Preview Verification (Verifies `http://localhost:3000` renders without blank screen or console errors).
