---
id: q-11-12-header-residual
status: locked
class: GOD_FILE_GROWTH
skill: specify
edit_mode: extract
who: any-agent
# DONE 2026-09-18 — node 2 (`cdbf2cd`) moved `#db-interactions-overlay` to
# DbInteractionsOverlay.tsx; node 1 (`c92ec49`) moved the theme customizer to
# useThemeCustomizer.ts + ThemeCustomizerScreen.tsx; `2fb8d88` dropped the imports
# the extraction orphaned. Header.tsx 3,545 -> 690 lines / 28,791 B (<= 1,200 and
# < 200 KB targets met); every moved slice proved byte-identical; CATALOG Header
# ceiling ratcheted 3544 -> 708. Do not re-execute.
auto_go: false
allowed_files:
  - src/components/Header.tsx
  - src/components/ThemeCustomizerScreen.tsx
  - src/components/DbInteractionsOverlay.tsx
  - src/hooks/useThemeCustomizer.ts
  - src/components/CATALOG.json
  - scripts/parity-baseline.json
  - prototype/tests/header-chrome.spec.ts
  - scripts/assert-shell-smoke.mjs
frozen_files:
  - src/App.tsx
  - src/types.ts
  - src/components/AppShell.tsx
  - src/components/AppTabs.tsx
  - src/components/AppModals.tsx
  - src/components/ProfileModal.tsx
  - src/components/AuthScreen.tsx
  - src/components/BottomNav.tsx
  - src/components/LogChat.tsx
  - src/hooks/useAuthSession.ts
  - src/hooks/useAppProfile.ts
  - src/hooks/useAppSync.ts
  - src/hooks/useJobRuntime.ts
  - src/hooks/useAppShellState.ts
  - src/hooks/useFoodLogActions.ts
  - src/hooks/useBiomarkerActions.ts
  - src/hooks/useReportActions.ts
  - src/jobs/JobStore.ts
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
  - npx playwright test prototype/tests/auth-session.spec.ts prototype/tests/key-journeys.spec.ts prototype/tests/header-chrome.spec.ts
  - node scripts/journey-guard.mjs q-11-12-header-residual
  - node scripts/assert-spec-diff.mjs q-11-12-header-residual
  - node scripts/assert-shell-smoke.mjs
---

# Packet: Q-11.12 — Header residual (theme customizer / DB overlay / inspector)

Successor to `q-11-7-header-profile`. That packet's Node 1 (ProfileModal) landed
in `31aece2`; its `Header ≤ 1,200 lines / < 200 KB` target is **not** met and is
carried here with measured regions. Nothing from it is dropped.

## Why this packet exists

Q-11.7 asked for a 3,937-line / 231 KB `Header.tsx` to reach ≤ 1,200 lines and
< 200 KB by moving **only** the profile portal (343 lines / 21 KB). That is
arithmetically impossible: after the move the file was still 3,544 / 208 KB, and
`CATALOG.json` was ratcheted to the achieved count rather than to the target. An
agent that takes the ≤ 1,200 target literally and still wants green gates has to
stub — which is exactly `a14abea` / `7d94def`. This packet names the real mass
and its real owners so no invented scope is needed.

## Measured now (`main` @ `55b62f6`, 2026-09-18)

| File / region | Lines | Bytes |
|---|---|---|
| `src/components/Header.tsx` (whole) | 3,545 | 213,027 |
| theme-customizer portal, `Header.tsx` 1413–2742 | 1,330 | 98,292 |
| DB-interactions overlay portal, `Header.tsx` 2747–3492 | 746 | 50,751 |
| inspector portals (popup + highlight box), 1343–1412 | 70 | 3,958 |
| theme state + handlers inside the component body | ~700 | ~35 KB |

`#theme-customizer-screen` (1413 ff.), `#db-interactions-overlay` (2747 ff.) and
`#avatar-edit-btn` / `#user-nickname-text` (1073 ff.) are the stable handles.

## Goal

`src/components/Header.tsx` ≤ **1,200 lines** and < **200 KB**, with the theme
customizer, the DB overlay and the inspector owning their own files. Verbatim
moves only. Sign-out still lands on `#auth-card`.

## Amendment 2026-09-18 (node order + new coverage)

Node 2 (DB overlay) was executed **first** — it is one contiguous, brace-balanced
region (measured: 746 lines, 50,751 B, 38 Header-scope props) and it is the move
that takes Header under the 200 KB Studio ceiling in a single commit, so it
retires the standing blocker before the larger, interleaved theme-screen work.
Node 1 (theme customizer) and Node 3 (ratchet) are unchanged.

`prototype/tests/header-chrome.spec.ts` is **new and allowed**, and is wired into
`scripts/assert-shell-smoke.mjs` (both added to `allowed_files` above). Reason:
neither `#db-interactions-overlay` nor `#theme-customizer-screen` had any standing
coverage, so a verbatim move that failed to mount would have passed every gate.
Adding a spec to the smoke runner **strengthens** the gate; no threshold, ceiling
or existing check was weakened, and `scripts/assert-shell-smoke.mjs` stays
otherwise untouched.

## In scope

1. **Node 1 — theme customizer.** `src/hooks/useThemeCustomizer.ts` takes the
   theme state + handlers (`showThemeScreen`, `themePreviewMode`,
   `themeCompactMode`, `themeActiveSection`, `expandedColorKey`, `colorDraft`,
   `textPreviewOverride`, `justSavedKey`, `newPresetName`, `inspectedElement`,
   `inspectorPaused`, `inspectorProperty`, `inspectorVariable`, plus
   `saveOverride`, `handleRenameColor`, `handleDeleteColor`, `handleAddColor`,
   `handleRenameFont`, `applyPresetConfig`, `applyPreview`, `revertPreview`,
   `buildExportPayload`, `normalizeImportedPreset`, `colorsList`, `fontsList`,
   `initialThemeSnapshot`, `getThemeVariableChangesCount`, `isPresetActive` and
   friends). `src/components/ThemeCustomizerScreen.tsx` renders the portal
   verbatim, including the two inspector portals and the
   `#root` style block. Header keeps only the trigger + props pass-through.
   Header → ~2,000 lines / ~110 KB.
2. **Node 2 — DB interactions overlay.** `src/components/DbInteractionsOverlay.tsx`
   takes the `#db-interactions-overlay` portal verbatim (`dbOverlayViewMode`,
   `activeAdminTab`, `selectedSyncCategory`, `catalogSyncStatus`, `agentLogs`,
   `handleCopySyncFeed`, `handleClearAgentLogs`, `handleToggleAutoSync`,
   `handleToggleDebugMode`, `getSyncLabel`, the admin/user tab bodies).
   Header → ~1,250 lines / ~55 KB.
3. **Node 3 — ratchet.** `CATALOG.json` `src/components/Header.tsx` ceiling =
   achieved count (never a target, never a bump). Optional
   `node scripts/assert-parity.mjs --update` **only** if appLines / types / i18n
   improved, and say so in the commit.

## Out of scope

- `App.tsx`, `AppShell`, `AppTabs`, `AppModals`, `ProfileModal` (frozen)
- `LogChat.tsx` / `FoodCard.tsx` / `BiomarkerDictionaryModal.tsx` splits
- Auth, sync, kcal writers, `finalizeDishLedger`
- Re-styling the theme screen or "fixing" its behavior while moving it

## Invariants

- **Move, do not rewrite.** Diff a move with `git diff --stat`; expect
  near-equal add/remove counts and **zero** behavioral edits.
- Move the *existing* staleness too. The theme screen reads values captured at
  render; do not repair semantics in a move-only commit.
- `src/types.ts`, `src/App.tsx` and every hook outside this packet stay frozen.
- Every handle in `#theme-customizer-screen`, `#db-interactions-overlay`,
  `#avatar-edit-btn`, `#user-nickname-text`, `#profile-modal-bottom-signout-btn`
  survives. `assert-parity` `profile_avatar` + `profile_modal_signout` stay green.
- Do not raise a `CATALOG.json` ceiling.

## Plan

One node per commit. Stop after each node if a gate is red; do not chain nodes in
one working tree (ROADMAP law).

## Done when

1. `wc -l src/components/Header.tsx` ≤ 1,200 and `wc -c` < 200,000.
2. `ThemeCustomizerScreen.tsx`, `useThemeCustomizer.ts`,
   `DbInteractionsOverlay.tsx` exist; Header contains no
   `#theme-customizer-screen` / `#db-interactions-overlay` markup.
3. Live: sign in → demo shell → avatar → Sign Out → `#auth-card` (Playwright
   `auth-session.spec.ts`), and the theme screen still opens from the header.
4. `CATALOG.json` Header ceiling equals the achieved count.
5. `git diff --name-only` ⊆ allowed_files; gate commands exit 0.
