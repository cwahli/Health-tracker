---
id: b7-5-silent-calibrator
status: locked
skill: biomarkers
edit_mode: patch
allowed_files:
  - src/App.tsx
  - scripts/assert-biomarker-lifecycle-m31.mjs
frozen_files:
  - src/utils/biomarkerLifecycle.ts
  - src/utils/biomarkers.ts
  - src/utils/dataSanitize.ts
  - src/components/HomeTab.tsx
  - src/components/LogChat.tsx
  - src/components/InsightsTab.tsx
  - src/components/MedicalHistoryTab.tsx
  - src/components/BiomarkerDictionaryModal.tsx
  - server_routes_sync.ts
  - docs/agent/standing.json
  - scripts/journey-guard.mjs
  - AGENTS.md
gate:
  - npx tsc --noEmit
  - npx vitest run src/utils/biomarkerLifecycle.test.ts src/utils/biomarkerIdentity.test.ts src/utils/biomarkerSanitize.test.ts src/utils/dataSanitize.test.ts tests/golden_biomarker.test.ts
  - node scripts/assert-biomarker-lifecycle-m31.mjs
  - node scripts/journey-guard.mjs b7-5-silent-calibrator
---

# Packet: B7.5 Silent Calibrator (product path)

Agent fills this. Human replies: go | stop | one comment.

## Journey

Track B B7.5 (`plan/ROADMAP.md:170`, class `CURRENCY`): the demographic overlay must re-run whenever the fingerprint (`ageBand|gender|ethnicity`) changes — on every product path that can change demographics, not just the Header edit form. Today only Header `onSaveProfile` and a near-dead Dictionary `onUpdateProfile` guard call `recalibrateProfileOverlays`; front-desk saves, sync merges, and conflict resolution silently keep overlays stamped for the old fingerprint.

## Findings (do not redo)

- Helper contract is stamp-only and tested: `recalibrateProfileOverlays` (`biomarkerLifecycle.ts:1209-1231`) stamps `overlayFingerprint` on `rangeVariesBy` keys whose stored fingerprint is stale; range recompute stays agent-side (`data_review`). Tests `:205-251, :533-555` assert this — do not change helper semantics.
- `overlayFingerprint` (`:1114-1122`): `ageBand|sex[0]|ethnicity.lower`; `unknown` band / `u` / `unspecified` fallbacks.
- Covered today: Header `onSaveProfile` (`App.tsx:6469-6486`, raw-field diff), MedicalHistory `onUpdateProfile` guard (`App.tsx:6712-6723`, never fires — Dictionary never sends demographics).
- Uncovered writers of full profiles that can carry new demographics: front-desk `onSaveProfile` ×3 (`App.tsx:7975,8070,8130`, agent-returned profiles), sync merge tail (`:3164` `setProfile(sanitizeProfile(mergedProfile))`, covers both merge branches), conflict resolve (`:4286` `setProfile(resolvedProfile)`), sanitize apply (`:6681-6700` `nextProfile`, zero-risk via guard).
- Skipped with justification: Insights `onUpdateProfile`/`onUpdateHistory` (InsightsTab displays demographics, never edits — `:1339-1349, :1616-1620`), `setProfile` prop wrapper (`:6443`, theme/direct sets without demographic intent — guarded helper would no-op anyway; left untouched to keep the diff reviewable).
- Standing `biomarker_lifestyle_exclusion` applies (recalibration must not approve/flag anything — stamp only).
- No `specs/rejected/` burns on calibrator/overlay.

## Plan

1. Module helper — `App.tsx` (next to `pushPendingObservation`): `maybeRecalibrateDemographicOverlays(prevProfile, nextProfile)`. Guards: null-safe; returns `nextProfile` untouched unless it carries all three demographic fields AND `overlayFingerprint` differs; returns copy with `customBiomarkers: updatedCustomBiomarkers` only when `recalibratedCount > 0`. Done when: helper present, tsc clean.
2. Replace the two existing raw-diff blocks with the helper — Header `onSaveProfile` (`:6469-6486`) and MedicalHistory `onUpdateProfile` (`:6712-6723`). Behavior note: trigger moves from raw-field diff to fingerprint diff (age 25→26 same band no longer restamps — spec-correct). Done when: no raw `profile?.age !== updatedProfile.age` diff remains in either block.
3. Cover front-desk saves — all three `onSaveProfile` (`:7975, :8070, :8130`): `const p = maybeRecalibrateDemographicOverlays(profile, updatedP)` before `setProfile`/`saveAndSync`. Done when: all three route through the helper.
4. Cover sync merge tail — before `:3162` cleanup: `mergedProfile = maybeRecalibrateDemographicOverlays(profile, mergedProfile)`. Covers merge + force-replace branches in one choke. Done when: tail routes through the helper.
5. Cover conflict resolve — before `:4286` `setProfile(resolvedProfile)`: `resolvedProfile = maybeRecalibrateDemographicOverlays(profile, resolvedProfile)` (check `const` vs `let` at declaration). Done when: resolve routes through the helper.
6. Cover sanitize apply — `:6681` block: `nextProfile` through the helper before `setProfile`. Done when: routed (guard makes it a no-op unless demographics shift).
7. Lock gate — M31 P4: `ok(app.includes('maybeRecalibrateDemographicOverlays'))` + occurrence count ≥ 7 (def + 6 call sites) + keep existing P4 lines. Done when: assert fails if a call site is dropped, passes on this tree.

## Test plan

```text
npx tsc --noEmit
npx vitest run src/utils/biomarkerLifecycle.test.ts src/utils/biomarkerIdentity.test.ts src/utils/biomarkerSanitize.test.ts src/utils/dataSanitize.test.ts tests/golden_biomarker.test.ts
node scripts/assert-biomarker-lifecycle-m31.mjs
node scripts/journey-guard.mjs b7-5-silent-calibrator
```

## Audit plan

1. Scope vs ROADMAP (B7.5 only — not B7.6, no helper-semantics change, no range recompute in TS).
2. One frozen example: profile age 25→55 via a front-desk save → HDL-class overlay restamped to the new fingerprint, sodium-class keys untouched, second save no-ops.
3. Honest residual named, not painted: stamp records currency; range VALUE recompute remains agent-side (`data_review`); no stale-overlay badge/scan UI.

## Blast radius

Allowed / Frozen are the YAML lists above.
Out of scope: helper semantics, range recompute, dedup merges (B7.6), sync protocol, LogChat/Insights/MedicalHistory edits.

## Stop and come back

Two repairs fail · Frozen file in the diff · New class appears · Live Gemini requested
