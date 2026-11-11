# HOLLOW_RESULT — Food History portion card with NO IMAGE (2026-11-06)

## Class
**HOLLOW_RESULT**: an R2-pointered job result (`{is_r2: true, r2_url}`) that can
never resolve, so the client fabricates an empty result and the card loses its
photo, portion question, and dish names. Distinct from STALE_TURN (card stale vs
fresh debug): here the full result exists in R2 and NOTHING can fetch it.

## User-visible symptom (Carter, Food History, screenshot 2026-11-06)
- Card "Portion Choice Needed — confirm portion size" with NO IMAGE placeholder,
  fallback title (no detected dish names), "Attempt 1 of 3", Select Portion
  opening an empty question, Retry appearing after 3 min via elapsed>3min.
- Sibling card "Analysis failed — Attempt 1 of 3 failed, Tap Retry" (soup photo
  present): server-originated failure, needs its own debug bundle — NOT this class.

## Evidence chain (all verified live)
1. Only reader `fetchJobResultFromR2` asked for `GET /api/r2/job-result?jobId=`.
   No route served it — grep finds only the caller. The SPA fallback answered
   `200 text/html`, so `res.json()` threw, was caught, and returned null.
   Confirmed on prod (`health-tracker.co.uk`, content-type text/html) and local.
2. Therefore `/api/jobs/status` transparent resolve (memJob + D1, both call it)
   always no-ops, and the `?full=true` poll returns the stub forever.
3. The client's direct fallback fetched the raw `r2_url` (public URL on a
   private bucket per B11d) → 401/403 → after 5 retries useJobRuntime REPLACED
   the informative portion stub (which inlines portionClarify/scoutItems/message)
   with `{scoutItems: [], pendingFoodLog: {name: 'Meal', zeros}}` → exact screenshot.
4. Portion-clarify `d1UpdateJob` omitted `photo_url` (succeeded path includes it),
   so D1-served portion cards had no server photo at all.

## Fix (branch agent/food-history-fix)
- `server_routes_r2.ts`: `fetchJobResultFromR2Direct(jobId)` (GetObject
  `jobs/<safeId>_result.json`, mirrors fetchDebugPayloadFromR2Direct) +
  `GET /api/r2/job-result?jobId=` (400/404/500 shaped like `/api/r2/logs`).
- `src/utils/r2Storage.ts`: pure `preserveR2StubInlineFields(stub, statusMessage)`
  — keeps inline fields, drops dead pointer, fills only missing pieces.
- `src/hooks/useJobRuntime.ts`: R2-exhausted fallback uses it (no more hollow
  fabrication); direct fetch tries same-origin `/api/r2/job-result` first.
- `serverJobs.ts`: portion-clarify D1 write includes `photo_url` when truthy.
- Sensor: `src/utils/r2Storage.test.ts` +6 (route path/parse/nulls, preservation).

## Proof (live, agent account agent-probe-hollow-001, job_proof_hollow_001)
- API: photo (G4 picnic bytes) → live R2; payload → route → GET byte-match TRUE;
  `status?full=true` returns resolved portionClarify + 2 scoutItems, row photo_url set.
- UI (headless Chromium, phone viewport, real login): card WITH photo +
  "baguette, cherry tomatoes — Portion Selection Needed"; Select Portion dialog
  populated (options, estimates, reasons). Shots in /tmp/proof-hollow-shots/.
- Proof D1 row deleted after (`/api/jobs/delete` → status now 404s). R2 objects
  remain under the traceable agent key.

## Guard record
- First Builder guard: FAIL `rewrite` (sensor addition was 47% of test file).
  Honest repair, no re-interpretation: compressed the addition to pure
  assertions (40 churn lines), re-ran → PASS. No SHEPHERD revert needed (tests
  only, no dirty src).
- Note: during proof, a malformed hand-made seed (portion items without
  `options`) crashed PortionClarifyCard (`it.options.find` of undefined) behind
  its error boundary. Real server shape always carries `options`
  (server_portion_clarify.ts `buildPortionClarify`), so this was a seed artifact,
  not a product bug. Left deliberately unpatched (blast radius).

## Proposed standing row (for human promote — not applied, docs/agent protected)
```json
{ "id": "r2_pointer_resolvable",
  "rule": "Every is_r2 pointer the server writes must be readable through a real route; no reader may fabricate an empty result over unresolved inline fields." }
```

## Residual (honest, not painted)
- Card 1 ("Analysis failed" with photo): raw server error unknown without the
  job's debug bundle. If Retry also fails, pull `debug_url`/backendLogs for that
  job_id and file as its own card (crash/INFRA vs quality per QUALITY §14).
- The client's direct raw-`r2_url` fetch remains as last-resort fallback; it
  still 401s on private buckets, but the server now resolves first.
