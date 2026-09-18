---
id: q-11-restore-auth-profile
status: locked
class: REWRITE_NOT_MOVE
skill: specify
edit_mode: restore
who: any-agent
auto_go: false
restore_from: ce20b19
allowed_files:
  - AI_HANDOVER.md
  - src/App.tsx
  - src/components/AgentResultTable.tsx
  - src/components/AgentResultViews.tsx
  - src/components/AllAnalysesModal.tsx
  - src/components/ApiCallTrackerModal.tsx
  - src/components/AppDynamicStyles.ts
  - src/components/AppModals.tsx
  - src/components/AppShell.tsx
  - src/components/AppTabs.tsx
  - src/components/AuthScreen.tsx
  - src/components/BackgroundTasksStatus.tsx
  - src/components/BackupRestoreTab.tsx
  - src/components/BatchNavigator.tsx
  - src/components/BiomarkerAuditModal.tsx
  - src/components/BiomarkerCalculationPanel.tsx
  - src/components/BiomarkerDictionaryModal.tsx
  - src/components/BiomarkerExpandedSection.tsx
  - src/components/BiomarkerRangeBuilder.tsx
  - src/components/BottomNav.tsx
  - src/components/BugSnapshotFab.tsx
  - src/components/BugTrackerModal.tsx
  - src/components/CATALOG.json
  - src/components/chat-cards/FoodCard.tsx
  - src/components/CombineBiomarkersModal.tsx
  - src/components/ConflictResolutionModal.tsx
  - src/components/DataSanitizeApprovalModal.tsx
  - src/components/DedupeBiomarkerLogsModal.tsx
  - src/components/ErrorBoundary.tsx
  - src/components/FlagIssueModal.tsx
  - src/components/FloatingActionSheet.tsx
  - src/components/FoodCatalogAdminTab.tsx
  - src/components/FoodHistoryTab.tsx
  - src/components/FullScreenInstructionViewer.tsx
  - src/components/FullScreenLogViewer.tsx
  - src/components/GoldenInboxPanel.tsx
  - src/components/ImageSlider.tsx
  - src/components/InsightsTab.tsx
  - src/components/LogChat.tsx
  - src/components/MedicalHistoryTab.tsx
  - src/components/NutritionDataBrowserModal.tsx
  - src/components/PhotoStorageAdminTab.tsx
  - src/components/PreviousMealThumbnail.tsx
  - src/components/TaskPlaceholderCard.tsx
  - src/components/ui/AppModal.tsx
  - src/components/ui/FilterPills.test.tsx
  - src/components/ui/FilterPills.tsx
  - src/components/ui/PositionedTooltip.tsx
  - src/components/ui/RichChatInput.tsx
  - src/firebase.ts
  - src/git-version.generated.ts
  - src/hooks/useAppProfile.ts
  - src/hooks/useAppSync.ts
  - src/hooks/useAuthSession.ts
  - src/hooks/useJob.ts
  - src/hooks/useJobPoller.ts
  - src/hooks/useJobRuntime.ts
  - src/hooks/useJobs.ts
  - src/index.css
  - src/jobs/__tests__/FoodAgentExecutor.test.ts
  - src/jobs/__tests__/ImageStore.test.ts
  - src/jobs/__tests__/JobQueueRunner.test.ts
  - src/jobs/__tests__/JobSession.contract.test.ts
  - src/jobs/__tests__/JobStore.test.ts
  - src/jobs/__tests__/jobUploadState.test.ts
  - src/jobs/__tests__/mergeFoodEditMessages.test.ts
  - src/jobs/__tests__/ModeDAndEdit.test.ts
  - src/jobs/__tests__/ServerJobRecovery.test.ts
  - src/jobs/__tests__/sessionLog.test.ts
  - src/jobs/__tests__/SupabaseJobSync.coalesce.test.ts
  - src/jobs/credits.ts
  - src/jobs/FoodAgentExecutor.ts
  - src/jobs/ImageStore.ts
  - src/jobs/jobEvents.ts
  - src/jobs/jobPreview.ts
  - src/jobs/JobQueueRunner.ts
  - src/jobs/JobStore.ts
  - src/jobs/jobUploadState.ts
  - src/jobs/MedicalAgentExecutor.ts
  - src/jobs/mergeFoodEditMessages.test.ts
  - src/jobs/mergeFoodEditMessages.ts
  - src/jobs/progress.ts
  - src/jobs/sessionLog.ts
  - src/jobs/SupabaseJobSync.ts
  - src/jobs/types.ts
  - src/logger.ts
  - src/main.tsx
  - src/mealBuild/__tests__/adapters.roundtrip.test.ts
  - src/mealBuild/__tests__/consolidate.test.ts
  - src/mealBuild/__tests__/m21_1_completion.test.ts
  - src/mealBuild/__tests__/m22_completion.test.ts
  - src/mealBuild/__tests__/narration.test.ts
  - src/mealBuild/__tests__/projectors.test.ts
  - src/mealBuild/__tests__/rebase.test.ts
  - src/mealBuild/__tests__/reflection.test.ts
  - src/mealBuild/__tests__/workerMerge.test.ts
  - src/mealBuild/coldDebug.ts
  - src/mealBuild/index.ts
  - src/mealBuild/nutrientKeys.ts
  - src/mealBuild/projectors.ts
  - src/mealBuild/reflection.ts
  - src/mealBuild/shouldExpandMealAgent.ts
  - src/mealBuild/stageLifecycle.ts
  - src/mealBuild/types.ts
  - src/mealBuild/workerMerge.ts
  - src/server/biomarkers/backoffice.ts
  - src/server/biomarkers/schema.ts
  - src/server/food/brandCurator.test.ts
  - src/server/food/brandCurator.ts
  - src/server/food/journeyFingerprints.test.ts
  - src/server/food/scoutGeometry.test.ts
  - src/server/food/scoutGeometry.ts
  - src/server/food/server_brand_image_linking.contract.test.ts
  - src/server/food/server_food_analyze_helpers.test.ts
  - src/server/food/server_food_analyze_schema.ts
  - src/server/food/server_food_db_search.test.ts
  - src/server/food/server_food_db_search.ts
  - src/server/food/server_food_diet_dispatch.test.ts
  - src/server/food/server_food_diet_dispatch.ts
  - src/server/food/server_food_dietitian_dispatch.test.ts
  - src/server/food/server_food_dietitian_dispatch.ts
  - src/server/food/server_food_meal_assemble.test.ts
  - src/server/food/server_food_meal_assemble.ts
  - src/server/food/server_food_mode_routing.test.ts
  - src/server/food/server_food_multi_composition.test.ts
  - src/server/food/server_food_precalc.test.ts
  - src/server/food/server_food_prompt_context.test.ts
  - src/server/food/server_food_prompt_context.ts
  - src/server/food/server_food_responses.test.ts
  - src/server/food/server_food_scout_source.test.ts
  - src/server/food/server_food_scout_source.ts
  - src/server/food/server_food_session_setup.test.ts
  - src/server/receptionist/call_agent.ts
  - src/server/receptionist/handoffContract.test.ts
  - src/server/receptionist/index.ts
  - src/server/receptionist/jsonSanitize.test.ts
  - src/server/receptionist/schema.ts
  - src/services/SyncService.ts
  - src/types.ts
  - src/utils/actionUtils.ts
  - src/utils/agentCalibration.ts
  - src/utils/agentConfig.ts
  - src/utils/agentLogsTracker.ts
  - src/utils/agentResultMissingKeys.test.ts
  - src/utils/agentResultMissingKeys.ts
  - src/utils/agentResultParse.test.ts
  - src/utils/agentResultParse.ts
  - src/utils/agentResultRows.test.ts
  - src/utils/agentResultRows.ts
  - src/utils/agentResultRowsBatch.test.ts
  - src/utils/agentResultRowsBatch.ts
  - src/utils/agentResultRowsFallback.test.ts
  - src/utils/agentResultRowsFallback.ts
  - src/utils/agentResultRowsStages.test.ts
  - src/utils/agentResultRowsStages.ts
  - src/utils/apiTracker.ts
  - src/utils/appProfileUtils.test.ts
  - src/utils/appProfileUtils.ts
  - src/utils/appProfileUtils.unit.test.ts
  - src/utils/auditEngine.i18n.test.ts
  - src/utils/biomarkerAuditEngine.test.ts
  - src/utils/biomarkerAuditEngine.ts
  - src/utils/biomarkerIdentity.test.ts
  - src/utils/biomarkerInsights.ts
  - src/utils/biomarkerLifecycle.test.ts
  - src/utils/biomarkerLifecycle.ts
  - src/utils/biomarkers.ts
  - src/utils/biomarkerSanitize.test.ts
  - src/utils/biomarkerStore.ts
  - src/utils/bracketPortionParser.test.ts
  - src/utils/bracketPortionParser.ts
  - src/utils/compositeFoodCalculation.test.ts
  - src/utils/compositeFoodCalculation.ts
  - src/utils/dataSanitize.test.ts
  - src/utils/dataSanitize.ts
  - src/utils/debugPayload.test.ts
  - src/utils/debugPayload.ts
  - src/utils/debugRunTree.test.ts
  - src/utils/debugRunTree.ts
  - src/utils/foodFollowUpEdit.test.ts
  - src/utils/foodFollowUpEdit.ts
  - src/utils/foodImageSources.test.ts
  - src/utils/foodImageSources.ts
  - src/utils/foodLogDedupe.ts
  - src/utils/goldenJourney.ts
  - src/utils/goldenScoreboard.ts
  - src/utils/i18n.test.ts
  - src/utils/imageResolver.contract.test.ts
  - src/utils/imageResolver.ts
  - src/utils/logChatDebugDownload.ts
  - src/utils/logChatOffline.test.ts
  - src/utils/logChatOffline.ts
  - src/utils/migrationTask.ts
  - src/utils/nutrients.test.ts
  - src/utils/nutrients.ts
  - src/utils/nutrition.ts
  - src/utils/nutritionD1Fallback.contract.test.ts
  - src/utils/quantityText.test.ts
  - src/utils/quantityText.ts
  - src/utils/scorecardContract.test.ts
  - src/utils/scorecardContract.ts
  - src/utils/syncUtils.regression.test.ts
  - src/utils/syncUtils.ts
  - src/utils/translations.test.ts
  - src/utils/translations.ts
  - src/utils/translations/en.ts
  - src/utils/translations/fr.ts
  - src/utils/translations/id.ts
  - src/utils/translations/zh.ts
  - src/utils/verdictUtils.test.ts
  - src/utils/verdictUtils.ts
  - supabase/migrations/20260913_brand_menu_items_status.sql
  - supabase/migrations/20260917_brand_menu_items_image_url.sql
  - specs/done/Q-11.md
  - specs/done/q-11-5-sync-hook.md
  - specs/done/q-11-6-tabs-modals.md
  - specs/done/q-11-7-shell-header.md
  - specs/done/q-11-9-assembly.md
frozen_files:
  - src/components/Header.tsx
  - src/components/HomeTab.tsx
  - src/utils/storageUtils.ts
  - src/utils/demoData.ts
  - src/utils/firestoreUtils.ts
  - src/utils/supabaseClient.ts
  - server_meal_gate.ts
  - server_vision_scout.ts
  - server_food_analyze_run.ts
  - prototype/meallog/compare/scout_only_compare_instructions.ts
  - AGENTS.md
  - docs/agent/standing.json
  - scripts/journey-guard.mjs
  - scripts/assert-standing.mjs
  - scripts/assert-budgets.mjs
  - scripts/assert-parity.mjs
  - scripts/assert-egress-bomb.mjs
  - scripts/assert-spec-diff.mjs
gate:
  - npx tsc --noEmit
  - node scripts/assert-parity.mjs
  - node scripts/assert-egress-bomb.mjs
  - npx playwright test prototype/tests/auth-session.spec.ts
  - node scripts/assert-shell-smoke.mjs
  - node scripts/journey-guard.mjs q-11-restore-auth-profile
  - node scripts/assert-spec-diff.mjs q-11-restore-auth-profile
---

# Packet: Q-11 restore — working product + AI Studio-sized files

Agent fills this. Human replies: **go** | **stop** | one comment.

Human comment that rewrote this packet: keep the **working** GitHub product
from before the rewrite, keep **small files** so AI Studio can open them, and
**do not throw away** the Q-11 extracts / food / i18n / tests that already
landed.

`edit_mode: restore`. Legal product edit is `git checkout ce20b19 -- <path>`
or a **verbatim move** out of the restored `App.tsx` into an existing module.
Illegal: invent a third AuthScreen; keep the localStorage `useAppSync` stub;
leave `App.tsx` at 373 KB; delete tests to make `tsc` green.

## Journey

Destination: **app shell / auth session / profile load / cloud sync**.
Siblings `food_log` and `food_compare` stay Frozen. This is `REWRITE_NOT_MOVE`
(same class as `a14abea`).

## Why both constraints exist

| Constraint | Number | Why |
|---|---|---|
| AI Studio transfer | `ce20b19` `src/App.tsx` is **373 KB / 7,684 lines** | Studio drops or fails to parse files ≳ 300 KB. That is why Q-11 exists. |
| Working product | `ce20b19` on GitHub (`origin/main` parent of the rewrite) | Firebase+Supabase session, `loadUserData` per-email bundle, `checkForDbChanges` (1,320 lines), `saveAndSync` (489 lines), `AuthScreen onLogin(profile)`, `FoodHistoryTab`. |
| HEAD today | `f518ac5` | `App.tsx` **5.5 KB / 192 lines** — small enough for Studio, and hollow. Login/logout rewritten; profile not connected to data. |

The 400-line-per-module budget in `plan/APP_SHELL_DECOUPLING_PLAN.md` is what
forced both `a14abea` and `7d94def` to stub. **This packet uses a size budget
AI Studio actually needs: no restored/extracted file over ~200 KB.** Line
ceilings in CATALOG still ratchet; they are not an excuse to stub.

## Findings — what GitHub had, what HEAD lost, what to keep

**Last good GitHub commit:** `ce20b19` `refactor(q-11.4): move profile state…`
(2026-09-17). Already on `origin/main`. Q-11.1–11.4 and Q-11.8 are in that
commit. Closed PRs #1–#9 are older and already merged before it. There is no
open PR with a better Q-11 split.

**What `ce20b19` already contains (must not be lost):**

- Q-11.1 `appProfileUtils.ts`, Q-11.2 `useAuthSession.ts` (283, real
  `onAuthStateChanged` + Supabase restore + `handleLogin`/`handleSignOut`),
  Q-11.3c `useJobRuntime.ts` (1,086), Q-11.4 `useAppProfile.ts` (300,
  `loadUserData` + per-email `getStorageKey(email)`).
- Q-11.8 i18n packs `src/utils/translations/{en,id,fr,zh}.ts`.
- `FoodHistoryTab.tsx` (2,295, on-demand pagination).
- `AuthScreen.tsx` (996) `onLogin(profile)` → the hook chain.
- Job tests, mealBuild tests, `syncUtils.fetchFoodLogsPage`,
  `SupabaseJobSync.ts` (813), `firebase.ts` (full), `types.ts` (558 / 0 `any`).
- Supabase migrations `20260913_brand_menu_items_status.sql` and
  `20260917_brand_menu_items_image_url.sql`.

**What `7d94def` + `45fc668` + `f518ac5` did (do not keep as product):**

- Commit message `build: add dependencies…` while deleting ~65k lines of
  `src/` (96 files gone, 77 of them tests/utils/mealBuild/jobs).
- `App.tsx` 7,684 → 188; new stubs `AppShell`/`AppTabs`/`AppModals`/
  `useAppSync`/`useJobPoller`. `useAppSync.cloudSync` sets `synced` and
  returns. Q-11.5 already named that stub a failed milestone.
- `45fc668` moved Q-11.5–11.9 to `specs/done/` without landing them.
- `f518ac5` invented a new AuthScreen (`onLoginSuccess` / demo fallback) and
  a new `useAuthSession` that **`App.tsx` never imports**. Failed
  `/api/auth/login` falls through to demo. Bypass-verify writes a blank
  30/60/165 profile.

**HEAD layout we KEEP (filenames + role, not the stub bodies):**

- `src/App.tsx` as a **wiring** layer (Studio-sized).
- `src/components/AppShell.tsx` / `AppTabs.tsx` / `AppModals.tsx` as the
  split Q-11.6/11.7 wanted.
- `src/hooks/useAppSync.ts` as the **real** Q-11.5 home for
  `checkForDbChanges` + `saveAndSync` (measured 67 KB + 25 KB at `ce20b19` —
  well under 200 KB; the 300–600 line forecast was wrong, same class of
  error as the 400-line table).

**Do not revert:** `package-lock.json` / `bun.lock`, golden debug dumps,
`specs/done/R-13.md`, `wrangler.jsonc` if present, bakeoff `tasks/`. Those
are not the auth/profile regression.

`specs/rejected/` was deleted in `7d94def`. Burned hypotheses:

1. Rewrite the shell to hit a 350/400-line table (`a14abea`, `7d94def`).
2. Invent a new AuthScreen instead of restoring `onLogin(profile)` (`f518ac5`).
3. localStorage `useAppSync` that reports `synced` (Q-11.5 forbid).
4. **New (this comment):** dump `App.tsx` back to 373 KB and call Studio
   done. That solves login and **re-breaks AI Studio**.

## Standing features that apply

Journeys `food_log`, `food_compare`. Features: `nutrition_targets`,
`kcal_one_writer`, `egress_conservation` (`lastSyncTime` must return to
`App.tsx` or the sync hook it calls into — standing currently fingerprints
`src/App.tsx`, so keep a `lastSyncTime` identifier there even if the state
lives in `useAppSync`), `meal_image_unique`,
`biomarker_lifestyle_exclusion`, `job_milestone_telemetry`,
`builder_ne_tier3_ab_scorer`, `kcal_density_cap`, `scorecard_unfakeable`,
`scorecard_live_structure`, `load_hack_forbidden`, `single_dish_flatten`,
`same_meal_package_prepared`, `i18n_a11y_soak_hygiene`.

### Sensitive transitions — `(Condition, Action, Pitfall)`

1. **Sign-in**
   - Condition: email / Google / `#demo-login-btn`.
   - Action: `AuthScreen onLogin(profile)` → `useAuthSession.handleLogin` →
     `useAppProfile.loadUserData` → per-email bundle →
     `checkForDbChangesRef`.
   - Pitfall: HEAD `onLoginSuccess` + demo fallback; `createDefaultProfile()`
     as the signed-in user.

2. **Reload**
   - Condition: Firebase/Supabase session or `last_active_email`.
   - Action: same `loadUserData` path. Header `#user-nickname-text` is that
     user. Food/biomarkers come from `getStorageKey(email)` + pull.
   - Pitfall: generic `health_food_logs` key; synthesizing `{email,name}`
     when the bundle is missing.

3. **Sign-out**
   - Condition: `#profile-modal-bottom-signout-btn` (still in Frozen
     `Header.tsx`).
   - Action: `fbSignOut` + `supabase.auth.signOut` + clear
     `last_active_email` / demo flags + `sessionStorage.clear` +
     `clearCachedAppData` + `JobStore.resetAllJobs` + `profile=null` →
     `#auth-card`.
   - Pitfall: `setProfile(null)` only; `profile || createDefaultProfile()`
     keeping the shell up.

4. **Studio open**
   - Condition: AI Studio clones the repo and Vite resolves `./App`.
   - Action: every `src/**/*.tsx?` file the Studio parser opens is **< 200 KB**.
   - Pitfall: restoring `App.tsx` at 373 KB and stopping.

## Plan (procedural micro-node graph)

### Node 1 — Restore the GitHub product (`ce20b19` bytes), except keep the split files

- Target: `git checkout ce20b19 -- src/ supabase/`
  then **immediately** put back the HEAD filenames that did not exist at
  `ce20b19` (`AppShell.tsx`, `AppTabs.tsx`, `AppModals.tsx`, `useAppSync.ts`,
  `useJobPoller.ts`) — do not delete them. They will be filled in Node 2–3,
  not left as stubs.
- This restores AuthScreen, both real hooks, FoodHistoryTab, i18n packs,
  job/mealBuild tests, `firebase.ts`, `syncUtils.ts`, `SupabaseJobSync.ts`,
  `types.ts`, gutted LogChat/modals, and the two brand-menu migrations.
- `App.tsx` will briefly be 373 KB. That is a **checkpoint**, not COMPLETE.
- Pitfalls: (Checking out the whole repo and wiping `wrangler.jsonc` /
  lockfiles — only `src/` + `supabase/`) · (`LOAD_HACK` `@ts-nocheck` to
  compile a mix of HEAD stubs and restored types) · (Stopping here).
- Done when: `git diff ce20b19 -- src/hooks/useAuthSession.ts
  src/hooks/useAppProfile.ts src/hooks/useJobRuntime.ts
  src/components/AuthScreen.tsx src/components/FoodHistoryTab.tsx
  src/firebase.ts src/utils/syncUtils.ts src/jobs/SupabaseJobSync.ts
  src/utils/translations/en.ts` is empty.
- Step gate: files exist; do not run Playwright yet (`App.tsx` still 373 KB).
  Save checkpoint `node scripts/journey-checkpoint.mjs save
  q-11-restore-auth-profile node-1-restored`.

### Node 2 — Move sync out of `App.tsx` into `useAppSync.ts` (real Q-11.5)

- Target: `src/hooks/useAppSync.ts` receives, **verbatim** from the restored
  `App.tsx`: food/biomarker/actions/benefits/report state, `syncState`,
  `lastSyncTime`, `checkForDbChanges` (lines 784–2104, 67 KB), `saveAndSync`
  (2165–2654, 25 KB), `forcePull` and the other sync entry points the
  Header already calls.
- If the file would exceed **200 KB**, split `checkForDbChanges` into
  `src/hooks/useAppSyncPull.ts` (Allowed via `src/hooks/useAppSync.ts`'s
  sibling — **stop and add the path to allowed_files before writing it**,
  by rewriting this packet; do not sneak a new path). Prefer one file if
  it stays under 200 KB.
- Keep a `lastSyncTime` identifier reachable from `src/App.tsx` (standing
  `egress_conservation` fingerprints that path).
- The localStorage-only HEAD `useAppSync` is discarded, not merged.
- `useAppProfile` at `ce20b19` already takes `checkForDbChangesRef` and the
  setters — wire those from this hook. `useJobRuntime` already takes a
  persist ref — point it at `saveAndSync`.
- Pitfalls: (Stub `setSyncState('synced'); return`) · (Changing merge
  rules in `syncUtils.ts` — Frozen transport is restored, not redesigned) ·
  (Direct client Supabase — `isDirectClientSupabaseDisabled` stays true).
- Done when: `useAppSync.ts` (and optional pull file) < 200 KB; `App.tsx`
  no longer contains the 1,320-line `checkForDbChanges` body.
- Step gate: `npx tsc --noEmit` · `node scripts/assert-egress-bomb.mjs`.

### Node 3 — Move chrome into AppShell / AppTabs / AppModals (real Q-11.6/11.7)

- Target, verbatim from restored `App.tsx` JSX (~4747–end, 152 KB total):
  - `AppShell.tsx`: Header + BottomNav + error boundary + FAB/quick actions
    if they were in the monolith. `!isLoggedIn` renders
    `<AuthScreen onLogin={handleLogin} />`. Never
    `createDefaultProfile()` as a logged-in shell.
  - `AppTabs.tsx`: the real tab switch (`HomeTab`, `FoodHistoryTab`,
    `MedicalHistoryTab`, `InsightsTab`, `TrendsTab`) with the 97
    App-scope props. **No stub meal list.** Food tab is `FoodHistoryTab`.
  - `AppModals.tsx`: the dialog host + `LogChat` mounts.
- Header.tsx / HomeTab.tsx are Frozen (byte-identical to `ce20b19` already).
  Sign-out button stays in Header.
- Typed props interfaces may make AppTabs/AppModals > 300 lines. That is
  expected (Q-11.6 already measured this). They must stay < 200 KB.
- Discard HEAD stub bodies. Keep HEAD `#nav-tab-*` ids if the restored
  BottomNav already has them; do not invent new ids.
- Pitfalls: (Placeholder cards, empty `onEditBiomarkerLog={() => {}}`) ·
  (Leaving `AppTabs` food branch as the HEAD inline list) · (Rewriting
  Header to extract ProfileModal — that is Q-11.7 leftover, out of this
  packet).
- Done when: `App.tsx` is wiring only (hooks in, three children out),
  **< 200 KB** and ideally ≤ 1,200 lines (Q-11.9 forecast).
- Step gate: `npx tsc --noEmit` · `node scripts/assert-parity.mjs`.

### Node 4 — Wire `App.tsx` and drop dead stubs

- Target: `src/App.tsx` imports `useAuthSession`, `useAppProfile`,
  `useJobRuntime`, `useAppSync` (real), passes `loadUserData` as
  `onUser`, `handleLogin` into AuthScreen via AppShell, `handleSignOut`
  into Header. `isLoggedIn` is the `ce20b19` condition (effective user /
  profile), **not** `Boolean(profile && profile.email)` after a default
  profile.
- `useJobPoller.ts`: only keep if `useJobRuntime` does not already cover
  the poll. At `ce20b19` the poll lives in `JobQueueRunner` +
  `useJobRuntime`. Prefer one owner. If `useJobPoller` has zero importers,
  leave it unused (do not spend this packet deleting).
- Pitfalls: (Importing HEAD `loginAsDemo`/`signOut` from the stub
  `useAppProfile`) · (Not calling `useAuthSession` — current HEAD bug).
- Done when: `grep -n useAuthSession src/App.tsx` hits; `grep lastSyncTime
  src/App.tsx` hits; `wc -c src/App.tsx` < 200000.
- Step gate: `node scripts/assert-parity.mjs` (auth_* + login_gate +
  profile_modal_signout + profile_avatar + demo_login_btn + bottom_nav).

### Node 5 — Docs: Q-11.5–11.9 are not COMPLETE

- Move `specs/done/q-11-5-sync-hook.md`, `q-11-6-tabs-modals.md`,
  `q-11-7-shell-header.md`, `q-11-9-assembly.md` back to `specs/active/`
  **or** leave them in `done/` with a HANDOVER line that this packet did
  the restore+move those milestones faked. Prefer HANDOVER-only if moving
  them would trip `spec_ambiguous` with `F-13` + `R-13`. Always run Guard
  with this spec id.
- Q-11.1–11.4 stay in `done/` (they did land at `ce20b19`).
- One HANDOVER line: restored from `ce20b19`; App.tsx bytes after Node 3;
  which endpoints `checkForDbChanges` actually hit in this environment.

### Node 6 — Prove it works

Walkthrough (name what you opened):

1. Cold load → `#auth-card` or a shell with non-empty `#user-nickname-text`.
   Never neither.
2. `#demo-login-btn` → `#nav-tab-home` + `#avatar-edit-btn`.
3. Food tab is `FoodHistoryTab` (pagination), not an empty stub list.
4. Sign out → `#auth-card`, identity hidden, `#nav-tab-home` count 0.
5. Every `src/App.tsx` / new hook / AppShell / AppTabs / AppModals file
   is < 200 KB (`wc -c`).

## Test plan

```text
npx tsc --noEmit
node scripts/assert-parity.mjs
node scripts/assert-egress-bomb.mjs
npx playwright test prototype/tests/auth-session.spec.ts
node scripts/assert-shell-smoke.mjs
node scripts/journey-guard.mjs q-11-restore-auth-profile
node scripts/assert-spec-diff.mjs q-11-restore-auth-profile
```

DOMAIN_REGRESSION_MAP: chrome/`App.tsx` → shell-smoke + auth-session;
sync/`App.tsx` pull → egress-bomb. `npm test` forbidden. Live Gemini
forbidden.

Byte sensors:

```text
git diff ce20b19 -- src/hooks/useAuthSession.ts src/hooks/useAppProfile.ts src/hooks/useJobRuntime.ts src/components/AuthScreen.tsx src/components/FoodHistoryTab.tsx src/firebase.ts src/utils/syncUtils.ts src/jobs/SupabaseJobSync.ts
wc -c src/App.tsx src/hooks/useAppSync.ts src/components/AppShell.tsx src/components/AppTabs.tsx src/components/AppModals.tsx
```

First command: empty (restored files). Second: each < 200000.

## Audit plan

1. Scope: restore + move. No R-13.1 cloud creds, no L-5, no USDA, no
   Header/ProfileModal split (Q-11.7 leftover).
2. Debug contract: no pipeline change.
3. Honest residual: any `7d94def` deletion **not** restored because it was
   outside `src/` + `supabase/` (e.g. `specs/rejected/`, `specs/packets/TEMPLATE.md`)
   is named in HANDOVER. Re-adding those is a docs packet, not this one.
4. `LOAD_HACK`: no `@ts-nocheck`, no gate delete, no
   `assert-parity --update` unless types/i18n are back to the `818808f`
   baseline (558 types / 0 any / 3,960 keys) and the packet says so.

## Blast radius

Allowed = the `git diff --name-only ce20b19 HEAD -- src/ supabase/` set plus
HANDOVER / Q-11 docs. Frozen = Header, HomeTab, storage/demo/firestore/
supabaseClient, food-calc instruction/schema/run, standing, Guard scripts.

Out of scope: redesigning login UI; keeping the f518ac5 AuthScreen look
(restyle later, same `onLogin(profile)` contract); implementing a *new*
Q-11.9 350-line App.tsx after this (this packet already does the
Studio-sized wiring).

## Done when

1. Demo login → identity → Sign Out → `#auth-card` (Playwright
   `auth-session.spec.ts` green).
2. `loadUserData` + `checkForDbChanges` are the profile/data path.
   Generic `health_food_logs` is not.
3. `useAuthSession` is imported by `App.tsx`.
4. `src/App.tsx` < 200 KB. Each extracted module < 200 KB.
5. Q-11.1–11.4 / Q-11.8 code from `ce20b19` is present (i18n packs,
   real hooks, FoodHistoryTab).
6. Gate commands exit 0.
