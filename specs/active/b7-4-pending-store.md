---
id: b7-4-pending-store
status: locked
skill: biomarkers
edit_mode: patch
allowed_files:
  - src/components/InsightsTab.tsx
  - src/components/LogChat.tsx
  - src/App.tsx
  - src/components/BiomarkerDictionaryModal.tsx
  - server_routes_sync.ts
  - scripts/assert-biomarker-lifecycle-m31.mjs
  - src/utils/biomarkerLifecycle.test.ts
frozen_files:
  - src/utils/biomarkerLifecycle.ts
  - src/utils/biomarkers.ts
  - src/utils/dataSanitize.ts
  - src/components/HomeTab.tsx
  - src/utils/biomarkerStore.ts
  - docs/agent/standing.json
  - scripts/journey-guard.mjs
  - AGENTS.md
gate:
  - npx tsc --noEmit
  - npx vitest run src/utils/biomarkerLifecycle.test.ts src/utils/biomarkerIdentity.test.ts src/utils/biomarkerSanitize.test.ts src/utils/dataSanitize.test.ts tests/golden_biomarker.test.ts
  - node scripts/assert-biomarker-lifecycle-m31.mjs
  - node scripts/journey-guard.mjs b7-4-pending-store
---

# Packet: B7.4 Real Pending store

Agent fills this. Human replies: go | stop | one comment.

## Journey

Track B B7.4 (`plan/ROADMAP.md:169`): unknown biomarker names never become catalog keys; pending lives in its own store (`profile.pendingObservations`), not as `needsApproval` flags on the `customBiomarkers` bag. Better = extract stamps route to the pending store; Dictionary approves from it via the already-tested `approvePendingObservation` / `dismissPendingObservation` helpers; sync merges it explicitly; legacy bag flags keep working through the existing cleanup migrator, never re-stamped.

## Findings (do not redo)

- New extract path already correct: `App.tsx:4836 routeExtractedObservations` pushes `pendingObservations`, self-heals unknown keys (`:4929-4937`). `server_routes_medical_gemini.ts:132-143` builds `pendingObservations` from `writeTarget==='pending'`.
- Legacy stamps still write the bag: `InsightsTab.tsx:963-971`, `LogChat.tsx:4567-4588`, `App.tsx:7490-7502 + 8787-8797`, `BiomarkerDictionaryModal.tsx:5939-5951`. These 4 are the cut.
- `approvePendingObservation` (`biomarkerLifecycle.ts:1689-1765`) + `dismissPendingObservation` (`:1767-1773`) exist, tested (`biomarkerLifecycle.test.ts:743-791`), zero UI callers.
- Home/coach already pending-aware (`isBiomarkerApproved`, `isLiveForUse`, `filterHistoryForUse` read both stores) — no touch.
- `enrichReviewModificationCommands` / `applyModificationCommands` are history-only — no touch.
- Sync `server_routes_sync.ts:979-1046` merges customs/tombs but has no `pendingObservations` branch (falls to generic deep-merge, no dedup).
- Standing `biomarker_lifestyle_exclusion` (approved + unflagged only for use) applies throughout.
- No `specs/rejected/` burns on pending.

## Plan

1. Cut stamp 1 — `InsightsTab.tsx:963-971`: push `{printedName, suggestedKey, date, rawValue, rawUnit}` to `profile.pendingObservations` (same dedup `printedName+date+rawValue` as `App.tsx:4921`) instead of `customBiomarkers[k] = {…needsApproval:true}`. Done when: no `needsApproval:true` literal in the file; existing tests green.
2. Cut stamp 2 — `LogChat.tsx:4567-4588` (preserve `:4566` read). Same swap. Done when: no `needsApproval:true` literal in the file.
3. Cut stamp 3 — `App.tsx:7490-7502 + 8787-8797` legacy extract (keep `:7269-7270` approved-variant, keep `:4836+` new path). Same swap. Done when: both legacy sites route to pending store.
4. Cut stamp 4 — `BiomarkerDictionaryModal.tsx:5939-5951` Create New Biomarker. Same swap (created key enters via approve flow, not pre-approved bag). Done when: no `needsApproval:true` literal in the file.
5. Dictionary approve from store — `BiomarkerDictionaryModal.tsx:1490-1494 toApproveKeys` = union legacy `needsApproval` keys + `pendingObservations`; approve calls `approvePendingObservation`, reject calls `dismissPendingObservation`. Keep existing `catalogApproved:true` write path. Done when: pending row approvable/rejectable from UI code path; legacy keys still approvable.
6. Sync explicit merge — `server_routes_sync.ts:979-1046`: add `pendingObservations` union by `id`, dedup `printedName+date+rawValue`, include in `mergedProfile`; customs/tombs logic untouched. Done when: pending survives a sync round-trip without duplication.
7. Lock gate — `assert-biomarker-lifecycle-m31.mjs`: fail on `needsApproval:true` assignments outside `biomarkerLifecycle.ts, dataSanitize.ts, *.test.ts`. Done when: assert exits non-zero on a reintroduced stamp, zero on this tree.

## Test plan

```text
npx tsc --noEmit
npx vitest run src/utils/biomarkerLifecycle.test.ts src/utils/biomarkerIdentity.test.ts src/utils/biomarkerSanitize.test.ts src/utils/dataSanitize.test.ts tests/golden_biomarker.test.ts
node scripts/assert-biomarker-lifecycle-m31.mjs
node scripts/journey-guard.mjs b7-4-pending-store
```

## Audit plan

1. Scope vs ROADMAP (B7.4 only — not B7.5/B7.6, not dictionary-store removal).
2. One frozen example: unknown printed name end-to-end (extract → pending store → Dictionary approve → history + `catalogApproved:true`, never a catalog key before approve).
3. Honest residual named, not painted (legacy bag flags in old profiles migrate via `cleanupInventedBiomarkerCatalog`, not rewritten).

## Blast radius

Allowed / Frozen are the YAML lists above.
Out of scope: Home/coach gates, Review enrich/apply, `biomarker_dictionary_store` removal, overlay/calibration (B7.5), dedup merges (B7.6).

## Stop and come back

Two repairs fail · Frozen file in the diff · New class appears · Live Gemini requested
