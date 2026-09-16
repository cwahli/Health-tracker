---
id: q-9-website-consolidation
status: draft
skill: sync-jobs
edit_mode: patch
allowed_files:
  - src/App.tsx
  - src/components/LogChat.tsx
  - server_vision_scout.ts
  - src/utils/appProfileUtils.ts
  - src/components/AppDynamicStyles.ts
  - src/utils/logChatOffline.ts
  - src/server/food/scoutGeometry.ts
  - src/utils/appProfileUtils.test.ts
  - src/utils/logChatOffline.test.ts
  - src/server/food/scoutGeometry.test.ts
frozen_files:
  - src/jobs/JobStore.ts
  - src/jobs/SupabaseJobSync.ts
  - src/jobs/JobQueueRunner.ts
  - src/components/LogChat.tsx submit / loadJobMessages
  - docs/agent/standing.json
  - scripts/journey-guard.mjs
  - scripts/assert-standing.mjs
  - scripts/assert-budgets.mjs
  - AGENTS.md
  - server_vision_scout.ts scoutSystemInstruction
  - src/server/food/server_food_analyze_schema.ts
  - prototype/meallog/compare/scout_only_compare_instructions.ts
gate:
  - node scripts/assert-budgets.mjs
  - npx tsc --noEmit
  - node scripts/journey-guard.mjs q-9-website-consolidation
  - npx vitest run server_vision_scout.test.ts
  - npx vitest run src/jobs/__tests__/JobSession.contract.test.ts src/jobs/__tests__/JobStore.test.ts
  - node scripts/assert-shell-smoke.mjs
  - node scripts/assert-egress-bomb.mjs
---

# Packet: Q-9 website consolidation (GOD_FILE_GROWTH extract-only)

Agent fills this. Human replies: go | stop | one comment.

## Journey

Q-9 closes the 3 pre-existing `GOD_FILE_GROWTH` fails (F-6 residual) by pure
extract — move verbatim pure helpers out of the god files into owned modules
with thin call sites. No behavior change, no rewrite binge, no prompt/math
change. Reward = `assert-budgets.mjs` green, not "page still works".

## Findings (do not redo)

- `node scripts/assert-budgets.mjs` FAILs (2026-09-16): `src/App.tsx` 9370/9200
  (+170), `src/components/LogChat.tsx` 7255/7000 (+255),
  `server_vision_scout.ts` 2148/1800 (+348). F-6 packet
  (`specs/done/f-6-net-zero-verify.md`) records these as pre-existing,
  Q-9-class split work.
- Q-8.2 green (process boards shipped), Q-1 red on exactly these 3 files —
  QUALITY.md §13.1 / ROADMAP Q-9 open conditions met. User gave go on Q-9.
- L8 forbids drive-by god-file splits; this packet is the named-gate
  exception (extract only, deletions ≥ additions per file).
- No `patch_*.mjs` / `fix_*.mjs` at root (deleted in F-9 review) — nothing to
  fold there.
- `specs/rejected/`: no q-9 entry (b0, builder-ne-tier3, same-meal only).
- Standing siblings `food_log` / `food_compare` + features `nutrition_targets`,
  `kcal_one_writer`, `egress_conservation` apply — extracts must keep live
  call wiring (`resolvedScoutSystemInstruction`, `finalizeDishLedger`,
  `hasActiveJob`) intact.

## Plan (procedural micro-node graph, extract-only)

### Node 1 — App.tsx: extract styles + profile pures (target −320)

- Target: `getDynamicStyles` (App.tsx ~193–517, ~325 lines) → new
  `src/components/AppDynamicStyles.ts` (verbatim move, export
  `getDynamicStyles`). Thin call site: `import { getDynamicStyles } from
  './components/AppDynamicStyles'` (1 line).
- Plus if needed for margin: `sanitizeProfile` (~536–580),
  `isDeepEqual` (~518–535), `pushPendingObservation` (~145–166) →
  `src/utils/appProfileUtils.ts` (verbatim, named exports). Keep signatures.
- Guidance: verbatim move only. No style value changes, no prop renames.
  `App.tsx` default export + poller (`JobStore.apply`, `currentTurn`) untouched.
- Pitfalls: (Style drift, keep exact object, visual snapshot is shell-smoke not
  eyeball) · (Import cycle, new modules import only types/utils, never App) ·
  (L1 blast radius, App.tsx is allowed here by IMPACT + JobSession contract in
  gate).
- Done when: `wc -l src/App.tsx` ≤ 9200; `git diff --stat` shows deletions ≥
  additions for App.tsx.
- Step gate: `npx tsc --noEmit` ·
  `npx vitest run src/utils/appProfileUtils.test.ts`
  (new: round-trip `sanitizeProfile` + `isDeepEqual` + `pushPendingObservation`
  parity) · `node scripts/assert-shell-smoke.mjs`.

### Node 2 — LogChat.tsx: extract offline/detect pures (target −390)

- Target: top-of-file pures `isValidFoodLog`, `resolvePendingFoodLog`,
  `isValidValue`, `formatNutrientValue`, `safeJSONStringify`,
  `parseJsonOffline`, `getOfflineCategorization`, `performOfflineDataAssembly`,
  `extractBiomarkerKeysFromJson`,
  `extractBiomarkerKeysFromPrioritizedConditions`, `detectBiomarkersInText`
  (LogChat.tsx ~49–456, ~400 lines) → new `src/utils/logChatOffline.ts`
  (verbatim, keep `export function safeJSONStringify`). Thin call site: single
  import line; intra-file calls unchanged.
- Guidance: verbatim. Do NOT touch submit / `loadJobMessages` / poller logic,
  job combine, or `LogChat` props. `safeJSONStringify` stays exported (other
  importers).
- Pitfalls: (Submit path, pures only — any `useState`/`useRef` reference aborts
  the move) · (Export surface, keep `safeJSONStringify` name) · (i18n, no copy
  changes — S-8 residual).
- Done when: `wc -l src/components/LogChat.tsx` ≤ 7000; deletions ≥ additions.
- Step gate: `npx tsc --noEmit` ·
  `npx vitest run src/utils/logChatOffline.test.ts`
  (new: `parseJsonOffline` + `detectBiomarkersInText` + `safeJSONStringify`
  parity) ·
  `npx vitest run src/jobs/__tests__/JobSession.contract.test.ts src/jobs/__tests__/JobStore.test.ts`.

### Node 3 — server_vision_scout.ts: extract geometry pures (target −360)

- Target: `tokenizeScoutName`, `canMergeScoutLabelIntoFood`,
  `validateOrFallback`, `isUsableBoundingBox`, `isDummyFullFrameBox`,
  `sliceParentBoxByWeights`, `boxForUnrolledFood` (+ `clusterSpatialCompositeDishes`
  if needed for margin) → new `src/server/food/scoutGeometry.ts` (verbatim,
  keep exports used by `server_vision_scout.test.ts`: `boxForUnrolledFood`,
  `Mie Kuning` fixtures). `server_vision_scout.ts` re-exports or imports thin.
- Guidance: verbatim. `scoutSystemInstruction` text untouched (PROMPT_BUDGET /
  L12 net-zero). No kcal/math change (`finalizeDishLedger` sole writer).
- Pitfalls: (Prompt net-zero, instruction string byte-identical) ·
  (Unroll contract, `boundingBox2D` copy/slice behavior covered by existing
  sole-dish tests) · (Schema, `visionScoutResponseSchema` untouched).
- Done when: `wc -l server_vision_scout.ts` ≤ 1800; deletions ≥ additions.
- Step gate: `npx tsc --noEmit` ·
  `npx vitest run server_vision_scout.test.ts` ·
  `npx vitest run src/server/food/scoutGeometry.test.ts` (new: thin re-export
  parity — box slice + merge-label).

## Test plan

```text
npx tsc --noEmit
node scripts/assert-budgets.mjs
node scripts/journey-guard.mjs q-9-website-consolidation
npx vitest run server_vision_scout.test.ts
npx vitest run src/jobs/__tests__/JobSession.contract.test.ts src/jobs/__tests__/JobStore.test.ts
node scripts/assert-shell-smoke.mjs
node scripts/assert-egress-bomb.mjs
```

DOMAIN_REGRESSION_MAP rows: `src/components/**` / `App.tsx` / chrome /
composer → shell-smoke; Sync/jobs/`App.tsx` pull → egress-bomb (+ free-tier
only if sync semantics touched — they are not); scout merge → vision test.
`npm test` forbidden. Live Gemini forbidden (budget-1 inner loop only).

## Audit plan

1. Scope vs ROADMAP: Q-9 only. No Q-10 dep removals, no R-13, no L-5, no
   F-10/USDA/curator changes in the same diff.
2. Debug contract: no pipeline change → no new dispatches; `debugRunTree`
   untouched.
3. Honest residual: any file still over ceiling after verbatim extract is
   reported as residual with exact overage (do not paint ceilings, do not
   `@ts-nocheck`, do not delete gate files — LOAD_HACK).

## Blast radius

Allowed / Frozen are the YAML lists above.
Out of scope: `src/jobs/*` logic, `src/App.tsx` poller semantics,
`LogChat.tsx` submit/`loadJobMessages`, prompts/schemas, `CATALOG.json`
ceilings + primitives, `standing.json`, guard/assert scripts, `current/` +
`result_summary/`, any live/R2/Supabase wiring.
IMPACT (L1): `src/App.tsx` poller + `LogChat` submit/job-combine are
job-lifecycle surfaces — this packet touches only surrounding pure helpers;
`JobSession.contract.test.ts` + `JobStore.test.ts` + `assert-egress-bomb.mjs`
ride in the same commit as the L1 sensor.

## Stop and come back

Two repairs fail · Frozen file in the diff · New class appears · Live Gemini
requested · Any ceiling raised to pass · Behavior diff beyond import lines.
