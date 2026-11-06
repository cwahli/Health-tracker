---
id: food-history-r2-result-route
status: locked
skill: sync-jobs
edit_mode: patch
allowed_files:
  - server_routes_r2.ts
  - serverJobs.ts
  - src/hooks/useJobRuntime.ts
  - src/utils/r2Storage.ts
  - src/utils/r2Storage.test.ts
frozen_files:
  - src/App.tsx
  - src/components/LogChat.tsx
  - src/jobs/JobStore.ts
  - src/components/TaskPlaceholderCard.tsx
  - src/components/FoodHistoryTab.tsx
  - AGENTS.md
  - docs/agent/standing.json
  - scripts/journey-guard.mjs
gate:
  - "npx vitest run src/utils/r2Storage.test.ts"
  - "npx vitest run src/jobs/__tests__/JobSession.contract.test.ts"
  - "npx tsc --noEmit"
---

# Packet: Food History hollow portion card (missing GET /api/r2/job-result)

Agent fills this. Human replies: go | stop | one comment.

## Journey
Carter's Food History shows a "Portion Choice Needed" card with NO IMAGE,
fallback title, and an empty Select Portion dialog, plus an "Analysis failed"
card — while the full results sit unreachable in R2. Better means: R2-pointered
job results resolve through a real route, and a still-unresolved pointer never
wipes the inline portion question/photo off the card.

## Findings (do not redo)
- `fetchJobResultFromR2` (src/utils/r2Storage.ts) GETs `/api/r2/job-result?jobId=`.
  No route serves it (grep: only the caller references that path). Server-side
  transparent resolve in `/api/jobs/status` (memJob + D1) always no-ops.
- Client direct fallback fetches the raw `r2_url` (public R2 URL, private bucket
  per B11d) → 401/403 → after 5 retries useJobRuntime replaces the stub — which
  for portion jobs inlines portionClarify/scoutItems/message — with a hollow
  `{scoutItems: [], pendingFoodLog: {name: 'Meal', zeros}}`. Card renders NO
  IMAGE + fallback "Portion Choice Needed" + dead Select Portion. Matches the
  screenshot exactly (fallback title, no names, Attempt 1 of 3, Retry via
  elapsed>3min).
- Portion-clarify `d1UpdateJob` omits `photo_url` (succeeded path includes it),
  so D1-served portion cards have no server photo at all.

## Plan
1. server_routes_r2.ts: add `fetchJobResultFromR2Direct(jobId)` (GetObject
   `jobs/<safeId>_result.json`, mirrors fetchDebugPayloadFromR2Direct) +
   `GET /api/r2/job-result?jobId=` returning the JSON (404 when missing).
   Done when: status poll `full=true` resolves an is_r2 pointer.
2. src/utils/r2Storage.ts: pure `preserveR2StubInlineFields(stub, statusMessage)`
   that keeps portionClarify/needsPortionClarify/scoutItems/message/text/photoUrl/
   debugUrl from an unresolvable stub and only fills truly-missing pieces.
   src/hooks/useJobRuntime.ts: hollow fallback uses it instead of fabrication.
   Done when: unresolved pointer keeps its question + names.
3. serverJobs.ts: portion-clarify d1UpdateJob includes `photo_url` when truthy
   (mirrors succeeded path; d1UpdateJob only sets present keys).
   Done when: D1 row for awaiting_user carries the server photo.
4. Sensor: extend src/utils/r2Storage.test.ts (route path + parse + null paths;
   stub preservation incl. portionClarify). Done when: suite green incl. new cases.
5. Live proof: dev server + live backends, real meal to awaiting_user/succeeded
   via is_r2 pointer, card screenshot loaded-with-data + job_id cited.

## Test plan
```text
npx tsc --noEmit
npx vitest run src/utils/r2Storage.test.ts
npx vitest run src/jobs/__tests__/JobSession.contract.test.ts
node scripts/journey-guard.mjs food-history-r2-result-route
```

## Audit plan
1. Scope: result-delivery only. No food-calc, no instruction/schema edits.
2. IMPACT: server_routes_r2.ts (hub, no overlapping open PR — verified) +
   useJobRuntime poller fallback; no JobStore/queue semantics changed.
3. Honest residual: card-1 "Analysis failed" raw server error needs its debug
   bundle; transient quota/503 remains Retry-by-design.

## Blast radius
Allowed: the YAML list above. Frozen respected (no card component edits).
Out of scope: food-calc, scout/compare instructions, FoodHistoryTab combine,
TaskPlaceholderCard rendering.

## Stop and come back
Two repairs fail · Frozen file in the diff · New class appears · Live Gemini requested
