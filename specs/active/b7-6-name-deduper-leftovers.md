---
id: b7-6-name-deduper-leftovers
status: locked
skill: biomarkers
edit_mode: patch
allowed_files:
  - src/utils/biomarkerAuditEngine.ts
  - src/utils/biomarkerAuditEngine.test.ts
  - src/App.tsx
  - scripts/assert-biomarker-lifecycle-m31.mjs
frozen_files:
  - src/utils/biomarkerLifecycle.ts
  - src/utils/biomarkers.ts
  - src/utils/dataSanitize.ts
  - src/utils/syncUtils.ts
  - docs/agent/standing.json
  - scripts/journey-guard.mjs
  - AGENTS.md
gate:
  - npx tsc --noEmit
  - npx vitest run src/utils/biomarkerAuditEngine.test.ts src/utils/biomarkerLifecycle.test.ts src/utils/biomarkerIdentity.test.ts src/utils/dataSanitize.test.ts tests/golden_biomarker.test.ts
  - node scripts/assert-biomarker-lifecycle-m31.mjs
---
# B7.6 — Name Deduper leftovers — PACKET (locked)

## Goal
Parallel keys from aliases / `metric_N` still in live profiles are merged or tombstoned (Track B row; class `IDENTITY_PARALLEL_KEY`; `QUALITY.md:82` — `serumsodium` must not sit beside `serum_sodium`).

## Law
- Merge moves keys only. Ranges/numbers untouched (relabel cannot rewrite numbers).
- Tombstone every loser in `deletedCustomBiomarkerKeys`; computed loops already skip tombstoned keys (`App.tsx:3190`).
- Never auto-merge across different units (lowercase-trim compare; missing unit passes). Unit conflicts stay for manual Dictionary combine.
- Empty losers (no logs): tombstone only, no value moves.

## Mechanism (new helper, no helper rebuild)
- New `mergeParallelAliasGroups(profile, history)` in `src/utils/biomarkerAuditEngine.ts` (detection home; `biomarkerLifecycle.ts` untouched):
  - `groups = getDuplicateAliasGroups(customs, history, currentBag, deleted)`; master = `suggestedMasterKey`; losers = `candidateAliases` minus already-tombstoned.
  - Populated loser per log: master absent → move value; both present → keep master, drop loser; move `observationMeta[loser]`→master when master lacks it; remap `tests[].key`.
  - Rewrite `customBiomarkers`, `customRanges`, current bag; tombstone loser; return `{ profile, history, merged: [{from,to,logsMoved}] }`.
- Wire at both cleanup sites (L5 siblings), immediately after `cleanupInventedBiomarkerCatalog`:
  - `App.tsx:2390` (auth load; `mergedBioHistory` is `const` → change to `let`, reassign from helper).
  - `App.tsx:3176` (sync merge; reassign `mergedBioHistory` before `setBiomarkerHistory`/`computedBiomarkers`).

## Sensor
- Extend `src/utils/biomarkerAuditEngine.test.ts`: `hdl` + `hdl_c_mgdl` each with logs → single master key in history, loser tombstoned, `observationMeta` moved, `merged` reports counts; unit-mismatch pair (`mg/dL` vs `mmol/L`) skipped untouched.
- M31 P2 lock: helper exported + wired at both sites:
  `ok(audit.includes('export function mergeParallelAliasGroups'), ...)` (add `const audit = read('src/utils/biomarkerAuditEngine.ts')`),
  `ok((app.match(/mergeParallelAliasGroups\(/g) || []).length >= 2, ...)`.
  Script edit only adds asserts (pass-meaning unchanged except the new B7.6 lock).

## Allowed files
`src/utils/biomarkerAuditEngine.ts`, `src/utils/biomarkerAuditEngine.test.ts`, `src/App.tsx` (2 call sites + 1 const→let only), `scripts/assert-biomarker-lifecycle-m31.mjs` (P2 lines only), this packet.

## Do not touch
`src/utils/biomarkerLifecycle.ts`, `src/utils/biomarkers.ts`, `src/utils/dataSanitize.ts`, `src/utils/syncUtils.ts`, Dictionary UI files, `docs/agent/standing.json`, other gate scripts.

## Gates
`npx tsc --noEmit` · named vitest (`biomarkerAuditEngine`, `biomarkerLifecycle`, `biomarkerIdentity`, `dataSanitize`, `golden_biomarker`) · `node scripts/assert-biomarker-lifecycle-m31.mjs` · `node scripts/journey-guard.mjs b7-6-name-deduper-leftovers`.

## Status: LOCKED
