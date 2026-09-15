# Master Scorecard Debug

Canonical JSON: [`MASTER_SCORECARD_DEBUG.json`](./MASTER_SCORECARD_DEBUG.json). Markdown is a view of that tree. **Skip is not PASS.** Do not cite this file as all-green unless Contract `overall_named_gates` is PASS **and** process exit 0. `result_summary/` is written only then.

**When:** 2026-09-15T00:10:37.494Z
**Commit:** `aa0aaec`
**Instruction hash:** `bd4c673081a1`
**Seal:** `e6a2e04d17b9fc6f5b8d326f2762e41aa92e024fcbedcaa267ea9e80fefaea58`
**Command:** `node scripts/assert-master-scorecard.mjs`
**Overall:** **ALL GREEN** — 677 pass / 0 fail / 0 skip

## Contract

| Law | Result | Actual |
|---|---|---|
| `overall_named_gates` | PASS | 677 pass / 0 fail / 0 skip of 677 |
| `skip_is_not_pass` | PASS | no required-skip scored as pass |
| `collection_does_not_crash` | PASS | all named files collected |
| `i18n_required_chrome` | PASS | 27 frozen keys present, not leak, id≠en |
| `structure_inventories` | PASS | helpers present; fallback/polarity/converts not swapped |
| `load_hack_forbidden` | PASS | no @ts-nocheck; named gates on disk; Top Targets helper intact; contract not painted |
| `live_origin` | PASS | live origin https://health-tracker-backend-64gt.onrender.com |
| `result_summary_sealed` | PASS | will write result_summary (overallPass) |
| `area_localization` | PASS | 51 pass / 0 fail / 0 skip |
| `area_meal_log` | PASS | 191 pass / 0 fail / 0 skip |
| `area_compare` | PASS | 47 pass / 0 fail / 0 skip |
| `area_biomarkers` | PASS | 148 pass / 0 fail / 0 skip |
| `area_receptionist` | PASS | 43 pass / 0 fail / 0 skip |
| `area_reliability` | PASS | 197 pass / 0 fail / 0 skip |
| `tsc` | PASS | exit 0 |
| `journey-guard` | PASS | exit 0 |
| `biomarker-lifecycle-m31` | PASS | exit 0 |
| `scorecard-live` | PASS | exit 0 |

## Area rollup

| Area | Result | Pass | Fail | Skip | Total |
|---|---|---:|---:|---:|---:|
| Localization | PASS | 51 | 0 | 0 | 51 |
| Meal Log | PASS | 191 | 0 | 0 | 191 |
| Compare | PASS | 47 | 0 | 0 | 47 |
| Biomarkers | PASS | 148 | 0 | 0 | 148 |
| Receptionist | PASS | 43 | 0 | 0 | 43 |
| Reliability | PASS | 197 | 0 | 0 | 197 |

## All failed (red)

_none_

## All skipped (not green)

_none_

## All passed (green)

### Reliability (197)

| Status | File | Test |
|---|---|---|
| PASS | `server_auth.test.ts` | server_auth: Password and Session Token Security hashes passwords deterministically with given salt |
| PASS | `server_auth.test.ts` | server_auth: Password and Session Token Security different salts produce different hashes for same password |
| PASS | `server_auth.test.ts` | server_auth: Password and Session Token Security signs and verifies session tokens correctly |
| PASS | `server_auth.test.ts` | server_auth: Password and Session Token Security rejects tampered or expired tokens |
| PASS | `server_auth.test.ts` | server_auth: Admin Account Pre-configuration authenticates admin cwah.liu@gmail.com with exact UID and role |
| PASS | `server_auth.test.ts` | server_auth: Admin Account Pre-configuration rejects admin login with incorrect password |
| PASS | `server_auth.test.ts` | server_auth: Admin Account Pre-configuration prevents registering duplicate over admin account |
| PASS | `server_auth.test.ts` | server_auth: Standard User Registration and Login registers a new user and authenticates successfully |
| PASS | `server_auth.test.ts` | server_auth: verifyFirebaseIdToken bearer resolution resolves signed session token in verifyFirebaseIdToken |
| PASS | `src/utils/creditManager.test.ts` | getAvailableCredits - quota fallback gives an Admin the DEFAULT_DAILY_QUOTA.Admin amount when no admin settings have ever been saved on this device |
| PASS | `src/utils/creditManager.test.ts` | getAvailableCredits - quota fallback falls back to DEFAULT_DAILY_QUOTA.Admin even if a device has an explicit null/blank quotaAdmin saved (regression: this used to resolve to 0 credits) |
| PASS | `src/utils/creditManager.test.ts` | getAvailableCredits - quota fallback uses a properly configured quotaAdmin value when one has been saved |
| PASS | `src/utils/creditManager.test.ts` | getAvailableCredits - quota fallback gives Standard and Demo users their respective DEFAULT_DAILY_QUOTA amounts when unconfigured |
| PASS | `src/utils/creditManager.test.ts` | DEFAULT_AGENT_COSTS / DEFAULT_DAILY_QUOTA sanity are non-zero, so a missing settings value can never make every request free or every quota 0 |
| PASS | `src/utils/debugPayload.test.ts` | debugPayload buildDebugMarkdownReport includes a Split Turn section when a portion question is pending |
| PASS | `src/utils/debugPayload.test.ts` | debugPayload buildDebugMarkdownReport includes Identity heading |
| PASS | `src/utils/debugPayload.test.ts` | debugPayload buildDebugMarkdownReport includes a Dispatches or similar heading when dispatches provided |
| PASS | `src/utils/debugPayload.test.ts` | debugPayload passes through nullish and primitive values without throwing |
| PASS | `src/utils/debugPayload.test.ts` | debugPayload strips base64 images and keeps https urls |
| PASS | `src/utils/debugPayload.test.ts` | debugPayload stripHeavyImages on shallow object with imageBase64 long string redacts it; sibling keys preserved |
| PASS | `src/utils/debugPayload.test.ts` | debugPayload leaves non-image strings and numbers untouched |
| PASS | `src/utils/debugPayload.test.ts` | debugPayload handles Buffer-like non-image objects without throwing |
| PASS | `src/utils/debugPayload.test.ts` | debugPayload recurses into arrays, omits base64 photoUrl, and keeps https photoUrl |
| PASS | `src/utils/debugPayload.test.ts` | debugPayload builds markdown report with macros and logs, no base64 |
| PASS | `src/utils/debugPayload.test.ts` | debugPayload cold key is user-scoped |
| PASS | `src/utils/debugPayload.test.ts` | debugPayload coldDebugR2Key includes both jobId and userId when provided, and jobId when userId is omitted |
| PASS | `src/utils/debugPayload.test.ts` | debugPayload coldDebugR2Key locks debug prefix, jobId inclusion, and stable null/undefined userId |
| PASS | `src/utils/debugPayload.test.ts` | debugPayload coldDebugR2Key returns a stable unknown jobId key for empty jobId |
| PASS | `src/utils/debugPayload.test.ts` | debugPayload coldDebugR2Key sanitizes weird characters in jobId/userId to underscore-safe path segments |
| PASS | `src/utils/debugPayload.test.ts` | debugPayload coldDebugR2Key never returns a leading slash, never doubles slashes, and always ends in .json |
| PASS | `src/utils/debugPayload.test.ts` | debugPayload markdown dispatch heading matches canonical tree.dispatches length after enrichment |
| PASS | `src/utils/debugPayload.test.ts` | debugPayload renders exactly one per-dispatch heading for each of 3 prior dispatches |
| PASS | `src/utils/debugPayload.test.ts` | debugPayload locks cold debug JSON path triple parity for three dispatches |
| PASS | `src/utils/debugPayload.test.ts` | debugPayload uses tree.dispatches.length for heading when empty prior dispatches and logs invent scout only |
| PASS | `src/utils/debugPayload.test.ts` | debugPayload renders vision scout internal reasoning, bounding boxes, and sticker labels |
| PASS | `src/utils/debugPayload.test.ts` | debugPayload gate failures are the Errors section — not a "no errors found" grep |
| PASS | `src/utils/debugPayload.test.ts` | debugPayload does not paste the same system instruction twice |
| PASS | `src/utils/debugPayload.test.ts` | debugPayload shows scout schema once per dispatch and keeps a second distinct dispatch |
| PASS | `src/utils/debugPayload.test.ts` | debugPayload shows each agent reply once and keeps a second distinct reply |
| PASS | `src/utils/debugPayload.test.ts` | debugPayload renders Contract Table first immediately after report header |
| PASS | `src/utils/debugPayload.test.ts` | debugPayload renders Modal Snapshot (Dialog Inventory) when present in input |
| PASS | `src/utils/debugPayload.test.ts` | debugPayload carries rawScout and dialogInventory from job result into the report input |
| PASS | `src/utils/debugPayload.test.ts` | debugPayload renders complete Scout received payload (System Instruction, User Prompt, Received) and emitted Raw Emission in markdown |
| PASS | `src/utils/debugPayload.test.ts` | debugPayload does not invent food scout dispatches for receptionist pack |
| PASS | `src/utils/debugPayload.test.ts` | debugPayload uses a medical dispatch heading for medical pack instead of scout |
| PASS | `src/utils/debugPayload.test.ts` | debugPayload maps minimal job-like input into markdown DebugReportInput fields |
| PASS | `src/utils/debugPayload.test.ts` | debugPayload debugReportFromJobMsg returns jobId j1 for succeeded job with msg stub |
| PASS | `src/utils/debugPayload.test.ts` | debugPayload includes jobId in markdown for minimal DebugReportInput |
| PASS | `src/utils/debugPayload.test.ts` | debugPayload renders identity/jobId heading with zero dispatches and empty food without crashing |
| PASS | `src/utils/debugPayload.test.ts` | debugPayload includes Contract table section heading when canonical run tree produces contract evals |
| PASS | `src/utils/debugPayload.test.ts` | debugPayload recursively strips nested heavy image fields while preserving non-image data |
| PASS | `src/utils/debugPayload.test.ts` | debugPayload extractDispatches empty => [] |
| PASS | `src/utils/debugPayload.test.ts` | debugPayload renders all sections and derivations matching Golden Meal specifications for meal logs |
| PASS | `src/utils/debugPayload.test.ts` | debugPayload renders Mode D comparison sections matching Golden Meal 03 specifications |
| PASS | `src/utils/debugPayload.test.ts` | debugPayload allowance table stops |
| PASS | `src/utils/dumpContract.test.ts` | dumpContract — display lag and complete-once flags happy-path with kcal but no session succeeded |
| PASS | `src/utils/dumpContract.test.ts` | dumpContract — display lag and complete-once flags 90s scout stall that failed the job without a 3.1 hop |
| PASS | `src/utils/dumpContract.test.ts` | dumpContract — display lag and complete-once does not flag a stall that already hopped to 3.1 on the same job |
| PASS | `src/utils/dumpContract.test.ts` | dumpContract — display lag and complete-once flags AnalyzeFinished more than once |
| PASS | `src/utils/dumpContract.test.ts` | dumpContract — Soto capture classifies without Gemini reads job still running after ledger + diet 503 |
| PASS | `src/utils/dumpContract.test.ts` | dumpContract — Soto capture classifies without Gemini flags matrix standby, duplicate crumbs, DIAG5 |
| PASS | `src/utils/dumpContract.test.ts` | code probes — inner loop (must be green without a new live run) food composer never runs Front Desk auto-send |
| PASS | `src/utils/dumpContract.test.ts` | code probes — inner loop (must be green without a new live run) debug markdown marks calc connected when logs have Finalized ledger even without pendingFoodLog |
| PASS | `src/utils/dumpContract.test.ts` | code probes — inner loop (must be green without a new live run) debug markdown drops duplicate breadcrumb rows |
| PASS | `src/utils/dumpContract.test.ts` | code probes — inner loop (must be green without a new live run) buildDebugMarkdownReport contains Job |
| PASS | `src/utils/dumpContract.test.ts` | code probes — inner loop (must be green without a new live run) serverJobs hops to 3.1 on stall instead of failing the job |
| PASS | `src/utils/dumpContract.test.ts` | code probes — inner loop (must be green without a new live run) publishResultReady marks succeeded before R2 |
| PASS | `src/utils/dumpContract.test.ts` | code probes — inner loop (must be green without a new live run) SSE wrap still emits salvage as final+result |
| PASS | `src/utils/dumpContract.test.ts` | Canonical JSON Run Tree & Contract Scorer (Q-8 / F-8.13) evaluates all 18 contract laws directly on CanonicalRunTree |
| PASS | `src/utils/dumpContract.test.ts` | Canonical JSON Run Tree & Contract Scorer (Q-8 / F-8.13) food pack AnalyzeFinished count = 1 PASSes when succeeded with a single AnalyzeFinished |
| PASS | `src/utils/dumpContract.test.ts` | Canonical JSON Run Tree & Contract Scorer (Q-8 / F-8.13) flags stall/503 without a 3.1 hop as MISSING on food pack |
| PASS | `src/utils/dumpContract.test.ts` | Canonical JSON Run Tree & Contract Scorer (Q-8 / F-8.13) detects dialog on_card kcal mismatch with ledger |
| PASS | `src/utils/dumpContract.test.ts` | Canonical JSON Run Tree & Contract Scorer (Q-8 / F-8.13) detects Retry button visible when job succeeded |
| PASS | `src/utils/dumpContract.test.ts` | Canonical JSON Run Tree & Contract Scorer (Q-8 / F-8.13) detects duplicate composer controls in dialog inventory |
| PASS | `src/utils/dumpContract.test.ts` | Canonical JSON Run Tree & Contract Scorer (Q-8 / F-8.13) composer count law PASSes malformed non-count fields (RELIABILITY §11 malformed/pass) |
| PASS | `src/utils/dumpContract.test.ts` | Canonical JSON Run Tree & Contract Scorer (Q-8 / F-8.13) flags missing composer control as MISSING (RELIABILITY §11 WRONG_COUNT) |
| PASS | `src/utils/dumpContract.test.ts` | Canonical JSON Run Tree & Contract Scorer (Q-8 / F-8.13) detects dispatch missing model or latency telemetry |
| PASS | `src/utils/dumpContract.test.ts` | Canonical JSON Run Tree & Contract Scorer (Q-8 / F-8.13) evaluates handoff contract and verifies matching jobId |
| PASS | `src/utils/dumpContract.test.ts` | Canonical JSON Run Tree & Contract Scorer (Q-8 / F-8.13) food pack without handoffChain marks handoff law n/a (not FAIL) |
| PASS | `src/utils/dumpContract.test.ts` | Canonical JSON Run Tree & Contract Scorer (Q-8 / F-8.13) detects QUEUE_LIE when submit reports queued instead of running |
| PASS | `src/utils/dumpContract.test.ts` | Canonical JSON Run Tree & Contract Scorer (Q-8 / F-8.13) passes Submit JSON running when submit reports status=running |
| PASS | `src/utils/dumpContract.test.ts` | Canonical JSON Run Tree & Contract Scorer (Q-8 / F-8.13) receptionist pack marks food ledger/scout laws n/a (Q-8.5) |
| PASS | `src/utils/dumpContract.test.ts` | Canonical JSON Run Tree & Contract Scorer (Q-8 / F-8.13) medical pack flags meal scout tape as WRONG_PLACE (Q-8.5) |
| PASS | `src/utils/dumpContract.test.ts` | Canonical JSON Run Tree & Contract Scorer (Q-8 / F-8.13) medical pack without scout tape marks Meal scout tape off non-food pack PASS (Q-8.5 contrast) |
| PASS | `src/utils/dumpContract.test.ts` | Canonical JSON Run Tree & Contract Scorer (Q-8 / F-8.13) multi-dispatch telemetry golden (RELIABILITY §11) |
| PASS | `src/utils/dumpContract.test.ts` | Canonical JSON Run Tree & Contract Scorer (Q-8 / F-8.13) food pack with finalized ledger passes Matrix calc matches ledger |
| PASS | `src/utils/dumpContract.test.ts` | Canonical JSON Run Tree & Contract Scorer (Q-8 / F-8.13) food pack pendingFoodLog + succeeded keeps pendingFoodLog -> succeeded before R2 non-FAIL without R2 evidence |
| PASS | `src/utils/dumpContract.test.ts` | Canonical JSON Run Tree & Contract Scorer (Q-8 / F-8.13) evaluateContracts returns |
| PASS | `src/utils/dumpContract.test.ts` | Canonical JSON Run Tree & Contract Scorer (Q-8 / F-8.13) classifyDump returns empty fails for a clean succeeded food tree with dispatch telemetry |
| PASS | `src/utils/dumpContract.test.ts` | Canonical JSON Run Tree & Contract Scorer (Q-8 / F-8.13) classifyDump on a clean succeeded food CanonicalRunTree-like fixture returns fails array without throw |
| PASS | `src/utils/dumpContract.test.ts` | Agent-output verification rows (15-19) fails nutrients on missing keys, passes full ledgers (zeros legal) |
| PASS | `src/utils/dumpContract.test.ts` | Agent-output verification rows (15-19) fails verdict+advice when out of band, passes in-band personalised advice |
| PASS | `src/utils/dumpContract.test.ts` | Agent-output verification rows (15-19) requires |
| PASS | `src/utils/dumpContract.test.ts` | Agent-output verification rows (15-19) fails awaiting_user with no question payload, passes shown splits |
| PASS | `src/utils/dumpContract.test.ts` | Agent-output verification rows (15-19) verifies the Mode D chunk on evaluation runs and scout chunk otherwise |
| PASS | `src/utils/dumpContract.test.ts` | Agent-output verification rows (15-19) finds the edit-patch chunk in the user prompt when system stays generic |
| PASS | `src/utils/dumpContract.test.ts` | Agent-output verification rows (15-19) fails a bare clarify turn even when a later turn is covered (per-turn law) |
| PASS | `src/utils/dumpContract.test.ts` | Agent-output verification rows (15-19) passes when scout row covers verdict+advice (single meal agent) |
| PASS | `src/utils/dumpContract.test.ts` | Agent-output verification rows (15-19) passes verdict+advice on weight-only edits carrying both in one emission |
| PASS | `src/utils/dumpContract.test.ts` | Agent-output verification rows (15-19) DEBUG_MODE_INSTRUCTION_MARKERS covers Mode D and stays extensible |
| PASS | `src/utils/dumpContract.test.ts` | Agent-output verification rows (15-19) fails unlinked forwarded legs and passes resolved chains |
| PASS | `src/utils/dumpContract.test.ts` | Agent-output verification rows (15-19) scores biomarker lab panel and report on medical pack only |
| PASS | `src/utils/dumpContract.test.ts` | parseDebugMarkdown — identity jobId extraction extracts jobId from a minimal Identity markdown fixture |
| PASS | `src/utils/dumpContract.test.ts` | parseDebugMarkdown — identity jobId extraction extracts jobId from Identity section when present as jobId: xyz |
| PASS | `src/utils/dumpContract.test.ts` | parseDebugMarkdown — identity jobId extraction extracts status from **Status:** `succeeded` Identity bullet |
| PASS | `src/utils/dumpContract.test.ts` | parseDebugMarkdown — identity jobId extraction extracts **Status:** `failed` into facts.status |
| PASS | `src/utils/dumpContract.test.ts` | parseDebugMarkdown — identity jobId extraction parseDebugMarkdown **Pack:** food |
| PASS | `src/utils/dumpContract.test.ts` | dumpContract — empty facts classifyDump on empty facts object returns an array (possibly with misses) and does not throw |
| PASS | `src/utils/dumpContract.test.ts` | dumpContract — empty facts classifyDump does not throw on {jobId:null,status:null} empty DumpFacts-like object |
| PASS | `src/utils/dumpContract.test.ts` | dumpContract — empty facts formatOracleFails([]) is an empty or whitespace-only string |
| PASS | `src/utils/dumpContract.test.ts` | dumpContract — empty facts formatOracleFails includes the fail id for a single fail |
| PASS | `src/utils/dumpContract.test.ts` | dumpContract — empty facts Edit patch: components & nutrients preserved law evaluates to n/a on single-turn create run |
| PASS | `src/utils/dumpContract.test.ts` | dumpContract — empty facts Edit patch: components & nutrients preserved law evaluates to PASS when edit preserves components and populates nutrients |
| PASS | `src/utils/dumpContract.test.ts` | dumpContract — empty facts Edit patch: components & nutrients preserved law evaluates to FAIL and flags EDIT_COMPONENT_PRESERVED when hotpot components are wiped out |
| PASS | `src/utils/dumpContract.test.ts` | dumpContract — empty facts Edit patch: components & nutrients preserved law evaluates to FAIL when edited dish has missing/NaN nutrients |
| PASS | `src/utils/foodImageSources.test.ts` | foodImageSources B11d rewrites r2.dev public URLs to same-origin proxy |
| PASS | `src/utils/foodImageSources.test.ts` | foodImageSources B11d keeps /photos/ proxy paths |
| PASS | `src/utils/foodImageSources.test.ts` | foodImageSources B11d photoKeyFromUrl extracts key |
| PASS | `src/utils/foodImageSources.test.ts` | foodImageSources B11d nextPhotoFallbackUrl tries proxy after public URL fails |
| PASS | `src/utils/foodImageSources.test.ts` | foodImageSources B11d rejects placeholders |
| PASS | `src/utils/foodImageSources.test.ts` | foodImageSources B11d uniqueMealImageUrls collapses r2.dev and /photos/ for the same key |
| PASS | `src/utils/foodImageSources.test.ts` | foodImageSources B11d drops data: copies once the same captures exist on /photos/ |
| PASS | `src/utils/foodImageSources.test.ts` | foodImageSources B11d keeps local data: URLs when nothing has been uploaded yet |
| PASS | `src/utils/foodImageSources.test.ts` | foodImageSources B11d dedupes an all-dead list to zero (orphaned hero-slider root cause) |
| PASS | `src/utils/goldenScoreboard.test.ts` | goldenScoreboard parser scoreGoldenRun scores expected meal lines against a new pipeline foodLog |
| PASS | `src/utils/goldenScoreboard.test.ts` | goldenScoreboard parser does not keep leftover category-fallback as a fail when identity ended on labels |
| PASS | `src/utils/goldenScoreboard.test.ts` | goldenScoreboard parser captures declared never-match and log events |
| PASS | `src/utils/goldenScoreboard.test.ts` | goldenScoreboard parser surfaces scale / receipt tensions for investigation |
| PASS | `src/utils/goldenScoreboard.test.ts` | goldenScoreboard parser treats a scored dish with no kcal as presence-only and does not match generic Ham to Serrano |
| PASS | `src/utils/goldenScoreboard.test.ts` | goldenScoreboard parser presence-only Ham matches Reformed Ham label, not Serrano |
| PASS | `src/utils/goldenScoreboard.test.ts` | goldenScoreboard parser does not pass meal totals when one line is under and another over |
| PASS | `src/utils/goldenScoreboard.test.ts` | goldenScoreboard parser log replay flips never-match to pass when signature is gone |
| PASS | `src/utils/goldenScoreboard.test.ts` | goldenScoreboard parser does not collapse four labeled dishes into the meal title |
| PASS | `src/utils/goldenScoreboard.test.ts` | goldenScoreboard parser extracts meal lines from itemsBreakdown |
| PASS | `src/utils/goldenScoreboard.test.ts` | goldenScoreboard parser counts label-locked journey rows when the log has no Component Resolution Diagnostic |
| PASS | `src/utils/goldenScoreboard.test.ts` | goldenScoreboard parser names a golden from the dishes, not the job id |
| PASS | `src/utils/goldenScoreboard.test.ts` | goldenScoreboard parser keeps a previously red check as passed instead of deleting it |
| PASS | `src/utils/goldenScoreboard.test.ts` | goldenScoreboard parser user extra issues land as custom outcomes |
| PASS | `src/utils/goldenScoreboard.test.ts` | goldenScoreboard parser splits a mashed Gemini blob and does not keep weight/compare/brand extras on top of the auto overwrite |
| PASS | `src/utils/goldenScoreboard.test.ts` | goldenScoreboard parser treats the auto-filled stall block as leftover draft, not a user note |
| PASS | `src/utils/goldenScoreboard.test.ts` | goldenScoreboard parser does not prefill stall when the meal finished, even if error fields still say stalled |
| PASS | `src/utils/goldenScoreboard.test.ts` | goldenScoreboard parser does not surface leftover stall on a succeeded job whose log never stalled |
| PASS | `src/utils/goldenScoreboard.test.ts` | goldenScoreboard parser keeps stall when the job actually failed with a stall in the log |
| PASS | `src/utils/scorecardContract.test.ts` | scorecard live contract (cannot swap inventories) echoes frozen Top Targets fallback and polarity lists |
| PASS | `src/utils/scorecardContract.test.ts` | scorecard live contract (cannot swap inventories) keeps the 32-key meal ledger and kcal writer name |
| PASS | `src/utils/scorecardContract.test.ts` | scorecard live contract (cannot swap inventories) locks B0 convert multipliers and apply outputs |
| PASS | `src/utils/syncUtils.regression.test.ts` | pushLogsToServer returns error immediately when uid is missing |
| PASS | `src/utils/syncUtils.regression.test.ts` | pushLogsToServer POSTs to /api/sync/supabase-push with correct body |
| PASS | `src/utils/syncUtils.regression.test.ts` | pushLogsToServer omits Authorization header when idToken is absent |
| PASS | `src/utils/syncUtils.regression.test.ts` | pushLogsToServer returns success:false and does not throw on HTTP error |
| PASS | `src/utils/syncUtils.regression.test.ts` | pushLogsToServer returns success:false and does not throw on network failure |
| PASS | `src/utils/syncUtils.regression.test.ts` | upsertProfileToSupabase is a no-op and does not throw when uid is missing |
| PASS | `src/utils/syncUtils.regression.test.ts` | upsertProfileToSupabase calls /api/sync/supabase-push with the profile when uid provided |
| PASS | `src/utils/syncUtils.regression.test.ts` | mergeByRecency prefers the newer item by updated_at |
| PASS | `src/utils/syncUtils.regression.test.ts` | mergeByRecency unions local-only and server-only items |
| PASS | `src/utils/syncUtils.regression.test.ts` | mergeByRecency local-only items survive server absence (no implicit delete) |
| PASS | `src/utils/syncUtils.regression.test.ts` | mergeDeleteMaps takes the higher timestamp for the same id |
| PASS | `src/utils/syncUtils.regression.test.ts` | mergeDeleteMaps never drops tombstones from either side |
| PASS | `src/jobs/__tests__/JobSession.contract.test.ts` | JobSession contract (STALE_TURN) edit submit shows Updating meal while the prior meal is still on the job |
| PASS | `src/jobs/__tests__/JobSession.contract.test.ts` | JobSession contract (STALE_TURN) same-meal succeeded echo does not complete the turn |
| PASS | `src/jobs/__tests__/JobSession.contract.test.ts` | JobSession contract (STALE_TURN) new Unsweetened snapshot completes to Analysis completed |
| PASS | `src/jobs/__tests__/JobSession.contract.test.ts` | JobSession contract (STALE_TURN) keeps one food card on merge |
| PASS | `src/jobs/__tests__/JobSession.contract.test.ts` | JobSession contract (STALE_TURN) prevents duplicate assistant messages when multiple completion events arrive for same job |
| PASS | `src/jobs/__tests__/JobSession.contract.test.ts` | JobSession contract (STALE_TURN) F-9.5 SubmitStarted writes queued + inFlight without updateJob |
| PASS | `src/jobs/__tests__/JobSession.contract.test.ts` | JobSession contract (STALE_TURN) F-9.5 PollerPayload progress does not require currentTurn and does not clobber turn |
| PASS | `src/jobs/__tests__/JobSession.contract.test.ts` | JobSession contract (STALE_TURN) F-9.5 AnalyzeFinished from poller completes with result |
| PASS | `src/jobs/__tests__/JobSession.contract.test.ts` | JobSession contract (STALE_TURN) duplicate completions route through the coalesced scheduler, never direct upserts (DIAG4 storm guard) |
| PASS | `src/jobs/__tests__/JobSession.contract.test.ts` | JobSession contract (STALE_TURN) compare completion preserves mode=evaluation + comparison through the store (group render boundary) |
| PASS | `src/jobs/__tests__/JobStore.test.ts` | JobStore resetAllJobs clears threads but keeps subscribers notified |
| PASS | `src/jobs/__tests__/JobStore.test.ts` | JobStore creates, updates and deletes a job |
| PASS | `src/jobs/__tests__/JobStore.test.ts` | JobStore maintains FIFO order in getQueue |
| PASS | `src/jobs/__tests__/JobStore.test.ts` | JobStore rejects queued job if maxQueued=5 is reached |
| PASS | `src/jobs/__tests__/JobStore.test.ts` | JobStore draft auto-delete works in store tests |
| PASS | `src/jobs/__tests__/JobStore.test.ts` | JobStore subscribers are notified |
| PASS | `src/jobs/__tests__/JobStore.test.ts` | JobStore correctly detects blank jobs vs valid jobs |
| PASS | `src/jobs/__tests__/JobStore.test.ts` | JobStore re-queues a succeeded meal for an edit turn and then allows running |
| PASS | `src/jobs/__tests__/JobStore.test.ts` | JobStore keeps a running new job in the queue until a meal result lands |
| PASS | `src/jobs/__tests__/JobStore.test.ts` | JobStore accepts succeeded on a new in-flight job that has no prior meal |
| PASS | `src/jobs/__tests__/JobStore.test.ts` | JobStore does not let a late submit callback downgrade running back to queued |
| PASS | `src/jobs/__tests__/JobStore.test.ts` | JobStore does not let stale sync downgrade a finished job to queued |
| PASS | `src/jobs/__tests__/JobStore.test.ts` | JobStore allows retry of a succeeded job when attemptCount increases |
| PASS | `src/jobs/__tests__/JobStore.test.ts` | JobStore keeps Updating state when a succeeded echo still has the prior meal |
| PASS | `src/jobs/__tests__/JobStore.test.ts` | JobStore keeps an in-flight edit turn even if a status-only succeeded echo arrives |
| PASS | `src/jobs/__tests__/JobStore.test.ts` | JobStore detects stale prior-turn succeeded rows while an edit is in flight |
| PASS | `src/jobs/__tests__/JobStore.test.ts` | JobStore drops succeeded echoes from a lower currentTurn |
| PASS | `src/jobs/__tests__/JobStore.test.ts` | JobStore does not let a stale realtime failed echo clobber an in-flight retry |
| PASS | `src/jobs/__tests__/SupabaseJobSync.coalesce.test.ts` | scheduleCoalescedJobUpsert collapses a burst of schedules into active + trailing with the latest snapshot |
| PASS | `src/jobs/__tests__/SupabaseJobSync.coalesce.test.ts` | scheduleCoalescedJobUpsert runs a lone schedule exactly once |
| PASS | `npx tsc --noEmit` | tsc |
| PASS | `node scripts/journey-guard.mjs` | journey-guard |
| PASS | `node scripts/assert-scorecard-live.mjs` | scorecard-live |
| PASS | `golden/scorecard/instruction/inventories/structure.json` | structure_callsites_isSoleEligibleDish |
| PASS | `golden/scorecard/instruction/gates.json` | load_hack_ts_nocheck |
| PASS | `golden/scorecard/instruction/gates.json` | named_gate_files_exist |
| PASS | `golden/scorecard/instruction/gates.json` | load_hack_top_targets_helper |
| PASS | `golden/scorecard/instruction/gates.json` | load_hack_contract_not_painted |
| PASS | `golden/scorecard/instruction/gates.json` | load_hack_no_slice_scripts |

### Meal Log (191)

| Status | File | Test |
|---|---|---|
| PASS | `server_derivation.test.ts` | server_derivation computeCaloriesFromMacros computes exact bottom-up calories using 4P + 4C + 9F |
| PASS | `server_derivation.test.ts` | server_derivation computeCaloriesFromMacros handles null/undefined gracefully |
| PASS | `server_derivation.test.ts` | server_derivation computeUnsaturatedFat correctly computes unsaturated fat from total, sat, and trans |
| PASS | `server_derivation.test.ts` | server_derivation computeUnsaturatedFat clamps negative values to 0 |
| PASS | `server_derivation.test.ts` | server_derivation computeUnsaturatedFat handles null/undefined gracefully |
| PASS | `server_derivation.test.ts` | server_derivation computeSaltFromSodium correctly converts sodium mg to salt g (mg * 2.54 / 1000) |
| PASS | `server_derivation.test.ts` | server_derivation computeSaltFromSodium handles null/undefined gracefully |
| PASS | `server_derivation.test.ts` | server_derivation computeSolubleFibre returns 0 for zero or negative total fiber |
| PASS | `server_derivation.test.ts` | server_derivation computeSolubleFibre returns 0 for pure animal products |
| PASS | `server_derivation.test.ts` | server_derivation computeSolubleFibre derives high soluble fiber (~38%) for oats, legumes, apples, berries, chia |
| PASS | `server_derivation.test.ts` | server_derivation computeSolubleFibre derives standard botanical soluble fiber (~28%) for cooked vegetables and mixed dishes |
| PASS | `server_derivation.test.ts` | server_derivation deriveCarbohydratesFromEnergy derives carbs using (kcal - 4P - 9F) / 4 |
| PASS | `server_derivation.test.ts` | server_derivation deriveCarbohydratesFromEnergy clamps negative carbs to 0 |
| PASS | `server_derivation.test.ts` | server_derivation calculateDerivedNutrients calculates bottom-up calories and preserves explicit carbs |
| PASS | `server_derivation.test.ts` | server_derivation calculateDerivedNutrients ignores agent-emitted calories when protein, carbs, and fat are present (F-10.2 Atwater law) |
| PASS | `server_derivation.test.ts` | server_derivation calculateDerivedNutrients handles zero carbs explicitly without triggering energy fallback |
| PASS | `server_derivation.test.ts` | server_derivation calculateDerivedNutrients derives carbohydrates if omitted or null |
| PASS | `server_derivation.test.ts` | server_derivation calculateDerivedNutrients ignores agent calories when P/C/F are present (F-10.2) |
| PASS | `server_derivation.test.ts` | server_derivation rebalanceNutrientProfile recalculates calories and dependent metrics when macros are updated |
| PASS | `server_derivation.test.ts` | server_derivation rebalanceNutrientProfile clamps excessive carbs to physical density maximum if weight is provided |
| PASS | `server_derivation.test.ts` | server_derivation decomposeSaucedEntree decomposes sauced protein dishes and bounds protein to biological meat capacity |
| PASS | `server_derivation.test.ts` | server_derivation decomposeSaucedEntree passes through non-sauced or normal protein dishes without adjustment |
| PASS | `server_derivation.test.ts` | server_derivation applyNutrientModifiers zeros sugar, carbs, and calories for sweet tea when user says unsweetened |
| PASS | `server_derivation.test.ts` | server_derivation applyNutrientModifiers does NOT modify Water Spinach or vegetables when user says the tea is unsweetened |
| PASS | `server_derivation.test.ts` | server_derivation applyNutrientModifiers does NOT treat watercress or watermelon as beverages |
| PASS | `server_derivation.test.ts` | ignores agent calories when P/C/F are present (F-10.2) |
| PASS | `server_derivation.test.ts` | ignores agent calories when P/C/F are present (F-10.2) |
| PASS | `server_dish_finalize.test.ts` | server_dish_finalize scales scout baseline nutrients proportionally by R (consumedWeight / nutrientBasisWeight) |
| PASS | `server_dish_finalize.test.ts` | server_dish_finalize handles standalone condiment cap: scales nutrients once based on post-cap weight |
| PASS | `server_dish_finalize.test.ts` | server_dish_finalize locks OCR label nutrition when rawNutritionLabel is present |
| PASS | `server_dish_finalize.test.ts` | server_dish_finalize recognizes Gemini totalCarbohydrate alias in OCR label and scales correctly for user portion edit |
| PASS | `server_dish_finalize.test.ts` | server_dish_finalize scales stored brand lock correctly on portion edit (D8) without re-fetching whole dish |
| PASS | `server_dish_finalize.test.ts` | server_dish_finalize computes bottom-up calories on estimated dishes and flags Atwater on OCR labels with discrepancy > 35% |
| PASS | `server_dish_finalize.test.ts` | server_dish_finalize derives carbohydrates from energy without flagging Atwater if C is missing |
| PASS | `server_dish_finalize.test.ts` | server_dish_finalize proportionally scales unprovided micronutrients by brand calorie adjustment ratio |
| PASS | `server_dish_finalize.test.ts` | server_dish_finalize canned drink with chainName and no OCR still attempts brand (honest BIND_MISS, no invented vitamin C) |
| PASS | `server_dish_finalize.test.ts` | server_dish_finalize scales OCR label correctly when serving size is given in ml (e.g. 65 ml per serving, 325g consumed) |
| PASS | `server_dish_finalize.test.ts` | server_dish_finalize preserves Scout nutrient estimates (e.g. addedSugar, potassium) when omitted on printed OCR label |
| PASS | `server_dish_finalize.test.ts` | server_dish_finalize parses Indonesian % AKG labels and preserves exact 0g total and saturated fat |
| PASS | `server_dish_finalize.test.ts` | server_dish_finalize F-8.12 locks printed vitamin C from the can label (absolute mg, not the 1000 mg name) |
| PASS | `server_dish_finalize.test.ts` | server_dish_finalize F-8.12 locks printed vitamin C from % AKG without inventing the can-name dose |
| PASS | `server_dish_finalize.test.ts` | server_dish_finalize F-8.12 carries brand-lock vitamin C micros into the ledger (scaled, not invented) |
| PASS | `server_dish_finalize.test.ts` | server_dish_finalize adds more fat/Na for fast_food_chain deep_fried than home_cooked and re-derives Atwater (F-10.6) |
| PASS | `server_dish_finalize.test.ts` | server_dish_finalize skips TS prep when OCR/brand locks labelled kcal/fat (F-10.6 locked_truth) |
| PASS | `server_dish_finalize.test.ts` | server_dish_finalize F-10.8 inner: 11 prototype cases keep restaurant fat/Na residual named (no Gemini, not 90% painted) |
| PASS | `server_dish_finalize.test.ts` | server_dish_finalize never zeroes out parent dish nutrients when subcomponents are missing macros |
| PASS | `server_dish_finalize.test.ts` | server_dish_finalize does not treat unit-count "1 serving (70g)" as 1 gram (Pia 100 Nanas) |
| PASS | `server_dish_finalize.test.ts` | server_dish_finalize does not treat "1 pcs" or "1 porsi" as 1 gram |
| PASS | `server_dish_finalize.test.ts` | server_dish_finalize finalizes a 70g labeled serving |
| PASS | `server_edit_patch_ledger.test.ts` | edit patch ledger diffs identity + weight into structural commands |
| PASS | `server_edit_patch_ledger.test.ts` | edit patch ledger enforces identity locks against scout regression |
| PASS | `server_edit_patch_ledger.test.ts` | edit patch ledger invalidates stale manis sibling metadata on identity change |
| PASS | `server_edit_patch_ledger.test.ts` | edit patch ledger merges locks from applied commands |
| PASS | `server_edit_patch_ledger.test.ts` | edit patch ledger builds expert dispatch with full I/O fields |
| PASS | `server_edit_patch_ledger.test.ts` | edit patch ledger carries verdict alongside the advice message for contract parity |
| PASS | `server_edit_patch_ledger.test.ts` | edit patch ledger preserves prior identity locks when a later turn only sets weight |
| PASS | `server_edit_patch_ledger.test.ts` | edit patch ledger reaggregates parent weight from components |
| PASS | `server_edit_patch_ledger.test.ts` | edit patch ledger diffs portion update with empty scout emission via arrow syntax in userMessage |
| PASS | `server_edit_patch_ledger.test.ts` | edit patch ledger diffs portion update with empty scout emission via portionChoices |
| PASS | `server_edit_patch_ledger.test.ts` | edit patch ledger aligns scout partial dish update to correct item in multi-dish meal without deleting others |
| PASS | `server_edit_patch_ledger.test.ts` | edit patch ledger correctly substitutes sweet tea for unsweetened tea and updates fish identity without duplication |
| PASS | `server_edit_patch_ledger.test.ts` | edit patch ledger Agent Explicit Edit Contract (replacesDish, targetDishIndex, action) contract: honors explicit replacesDish property from agent scout emission |
| PASS | `server_edit_patch_ledger.test.ts` | edit patch ledger Agent Explicit Edit Contract (replacesDish, targetDishIndex, action) contract: honors explicit targetDishIndex (1-based from prompt) from agent scout emission |
| PASS | `server_edit_patch_ledger.test.ts` | edit patch ledger Agent Explicit Edit Contract (replacesDish, targetDishIndex, action) contract: honors explicit action="add" and does NOT substitute existing items even if names share keywords |
| PASS | `server_edit_patch_ledger.test.ts` | edit patch ledger Agent Explicit Edit Contract (replacesDish, targetDishIndex, action) contract: honors explicit action="delete" to remove a main dish by targetDishIndex or replacesDish |
| PASS | `server_edit_patch_ledger.test.ts` | edit patch ledger Agent Explicit Edit Contract (replacesDish, targetDishIndex, action) contract: preserves sourceImageIndex and full nutrients when replacing a dish |
| PASS | `server_edit_patch_ledger.test.ts` | edit patch ledger Agent Explicit Edit Contract (replacesDish, targetDishIndex, action) contract: honors subitem actions (replace, add, delete) within a dish |
| PASS | `server_edit_patch_ledger.test.ts` | edit patch ledger Agent Explicit Edit Contract (replacesDish, targetDishIndex, action) contract: when scout marks dish action="replace" but provides foods with action="add", dispatches subitem action rather than wiping c |
| PASS | `server_edit_patch_ledger.test.ts` | edit patch ledger Agent Explicit Edit Contract (replacesDish, targetDishIndex, action) contract: same-meal package vs cooked bowl emits merge_dishes, not a leftover sibling |
| PASS | `server_edit_patch_ledger.test.ts` | edit patch ledger Agent Explicit Edit Contract (replacesDish, targetDishIndex, action) emits merge_dishes preserving label truth and user selected weight when user says only had 1 dish |
| PASS | `server_edit_patch_ledger.test.ts` | edit patch ledger Agent Explicit Edit Contract (replacesDish, targetDishIndex, action) job_1789312118652: "It's only 1 meal. Just combine them" merges even when scout replaces the package and leaves the porridge |
| PASS | `server_portion_clarify.test.ts` | detectPortionAmbiguity & buildPortionClarifyPayload parses Indonesian serving counts ("23 sajian per Kemasan") as servings, not countable units |
| PASS | `server_portion_clarify.test.ts` | detectPortionAmbiguity & buildPortionClarifyPayload keeps whole-pack choice for small packs (brownies 2 servings of 15g) |
| PASS | `server_portion_clarify.test.ts` | detectPortionAmbiguity & buildPortionClarifyPayload drops absurd whole/half/quarter pack options for bulk packs on the general path |
| PASS | `server_portion_clarify.test.ts` | detectPortionAmbiguity & buildPortionClarifyPayload triggers portion clarify for bulk 800g oats bag when servingsPerContainer is missing |
| PASS | `server_portion_clarify.test.ts` | detectPortionAmbiguity & buildPortionClarifyPayload detects multipack cereal bar box as portion ambiguous |
| PASS | `server_portion_clarify.test.ts` | detectPortionAmbiguity & buildPortionClarifyPayload correctly labels Whole pack as actual pack weight (85g) when label is per 100g and portion is 50g |
| PASS | `server_portion_clarify.test.ts` | detectPortionAmbiguity & buildPortionClarifyPayload does NOT trigger portionClarify when packGrams equals estimatedWeightGrams |
| PASS | `server_portion_clarify.test.ts` | detectPortionAmbiguity & buildPortionClarifyPayload triggers portionClarify when packGrams (440g) differs from estimated portion (150g) |
| PASS | `server_portion_clarify.test.ts` | detectPortionAmbiguity & buildPortionClarifyPayload builds generic multi-item clarification payload when multiple foods have ambiguous portions |
| PASS | `server_portion_clarify.test.ts` | detectPortionAmbiguity & buildPortionClarifyPayload triggers portion clarify for composite subcomponents with packGrams discrepancy |
| PASS | `server_portion_clarify.test.ts` | Bug #9 — visual-source portion-clarify guard does NOT trigger portionClarify for a visual-source single wrap (no explicit unit count) |
| PASS | `server_portion_clarify.test.ts` | Bug #9 — visual-source portion-clarify guard does NOT trigger portionClarify for visual single-serve ice cream cone |
| PASS | `server_portion_clarify.test.ts` | Bug #9 — visual-source portion-clarify guard uses leading digit from name for "2 butter croissants" (never the biscuit-default of 6) |
| PASS | `server_portion_clarify.test.ts` | applyPortionChoices updates estimatedWeightGrams and sets nutrientBasisWeight while preserving rawNutritionLabel |
| PASS | `server_portion_clarify.test.ts` | applyPortionChoices scales legacy estimatedCalories when FOOD_DISH_ESTIMATE is 0 |
| PASS | `server_portion_clarify.test.ts` | applyPortionChoices no-ops when choices empty |
| PASS | `server_portion_clarify.test.ts` | applyPortionChoices does not keep a 1g WRONG_BASIS when the user picks a real serving |
| PASS | `server_portion_clarify.test.ts` | parseServingGramsFromLabel requires a g/ml unit so "1 serving (70g)" is 70, not 1 |
| PASS | `server_portion_clarify.test.ts` | detectPortionAmbiguity brand names does not treat a brand name number as pack unit count (Pia 100 Nanas) |
| PASS | `server_portion_clarify.test.ts` | S-10 PORTION_FUNNEL quantity resolution statedMatchesEstimate uses one named kitchen-rounding tolerance |
| PASS | `server_portion_clarify.test.ts` | S-10 PORTION_FUNNEL quantity resolution case-2 shape: stated 100g matching est suppresses the picker |
| PASS | `server_portion_clarify.test.ts` | S-10 PORTION_FUNNEL quantity resolution case-1 shape: 28g est on 180g pack with no statement still asks (half/quarter are real options) |
| PASS | `server_portion_clarify.test.ts` | S-10 PORTION_FUNNEL quantity resolution parses Indonesian pack prints into packGrams (boundary data, not logic) |
| PASS | `server_portion_clarify.test.ts` | S-10 PORTION_FUNNEL quantity resolution bare grams across dishes injects "You said" options instead of dying silently |
| PASS | `server_portion_clarify.test.ts` | S-10 PORTION_FUNNEL quantity resolution fraction without pack basis forces the question when options exist |
| PASS | `server_portion_clarify.test.ts` | S-10 PORTION_FUNNEL quantity resolution fraction with known pack adopts without asking |
| PASS | `server_portion_clarify.test.ts` | S-10 PORTION_FUNNEL quantity resolution diverged statement is adopted with overflow noted, never silently clamped |
| PASS | `server_portion_clarify.test.ts` | S-10 PORTION_FUNNEL quantity resolution questions and past references yield zero candidates (behavior unchanged) |
| PASS | `server_portion_clarify.test.ts` | S-10 PORTION_FUNNEL quantity resolution ambiguous match across two items synthesizes disambiguation (no silent adopt) |
| PASS | `server_vision_scout.test.ts` | server_vision_scout heals unterminated string JSON from a truncated scout reply |
| PASS | `server_vision_scout.test.ts` | server_vision_scout heals extra long internalReasoning instead of throwing Vision Scout Corrupted |
| PASS | `server_vision_scout.test.ts` | server_vision_scout checkScoutSanity strips item internalReasoning rather than failing |
| PASS | `server_vision_scout.test.ts` | server_vision_scout userSafeScoutFailureMessage does not leak Vision Scout Corrupted to the caller |
| PASS | `server_vision_scout.test.ts` | server_vision_scout parseAndHeal never throws and never returns Vision Scout Corrupted for unrecoverable JSON |
| PASS | `server_vision_scout.test.ts` | server_vision_scout heals overlong packageLabelText from barcode OCR instead of throwing Corrupted |
| PASS | `server_vision_scout.test.ts` | server_vision_scout DISH_DROP via genericEnglishName DISH_DROP: should map a local food component to a generic english searchQuery |
| PASS | `server_vision_scout.test.ts` | server_vision_scout mergeScoutItems should return visionItems if llmItems are empty |
| PASS | `server_vision_scout.test.ts` | server_vision_scout mergeScoutItems should return llmItems if visionItems are empty |
| PASS | `server_vision_scout.test.ts` | server_vision_scout mergeScoutItems should correctly merge properties preserving rich vision metadata |
| PASS | `server_vision_scout.test.ts` | server_vision_scout mergeScoutItems preserves vision estimatedCalories, weight, components, and rawNutritionLabel over LLM overwrite |
| PASS | `server_vision_scout.test.ts` | server_vision_scout mergeScoutItems falls back to LLM estimatedCalories when vision soft cal is null/undefined |
| PASS | `server_vision_scout.test.ts` | server_vision_scout parseAndHealVisionScout parses standard scout output correctly |
| PASS | `server_vision_scout.test.ts` | server_vision_scout parseAndHealVisionScout splits fry-fat onto components without writing Atwater kcal (finalize owns persisted calories) |
| PASS | `server_vision_scout.test.ts` | server_vision_scout parseAndHealVisionScout applies the fat overflow correction to raw nutrition label |
| PASS | `server_vision_scout.test.ts` | server_vision_scout parseAndHealVisionScout applies the algebraic healer to compute missing carbohydrates when discrepancy is within 20% |
| PASS | `server_vision_scout.test.ts` | server_vision_scout parseAndHealVisionScout preserves explicitly declared 0g totalFat on label without injecting non-zero fat |
| PASS | `server_vision_scout.test.ts` | server_vision_scout parseAndHealVisionScout explodes list formatted items with commas into multiple items if not bearing printed macros |
| PASS | `server_vision_scout.test.ts` | server_vision_scout parseAndHealVisionScout successfully parses compact spreadsheet formats into standalone items |
| PASS | `server_vision_scout.test.ts` | server_vision_scout parseAndHealVisionScout does not throw Vision Scout Corrupted for overlong strings; returns a partial scout |
| PASS | `server_vision_scout.test.ts` | server_vision_scout parseAndHealVisionScout does not throw Vision Scout Corrupted for visualIngredients JSON heuristics |
| PASS | `server_vision_scout.test.ts` | server_vision_scout parseAndHealVisionScout merges separate standalone label item into primary packaged food item and clears visualIngredients |
| PASS | `server_vision_scout.test.ts` | server_vision_scout explicit user weights on two drinks does not apply 1L to the lassi after 500ml was already claimed |
| PASS | `server_vision_scout.test.ts` | server_vision_scout canMergeScoutLabelIntoFood does not glue a reformed-ham label onto Serrano |
| PASS | `server_vision_scout.test.ts` | server_vision_scout canMergeScoutLabelIntoFood still merges a milk label onto the matching milk carton |
| PASS | `server_vision_scout.test.ts` | server_vision_scout canMergeScoutLabelIntoFood merges a same-named ham label onto that ham |
| PASS | `server_vision_scout.test.ts` | server_vision_scout cross-photo deduplication guards collapses a labeled oats package and the cooked porridge from another photo into one dish |
| PASS | `server_vision_scout.test.ts` | server_vision_scout cross-photo deduplication guards does not merge two distinct items sharing flavor words when printed calories or labels differ |
| PASS | `server_vision_scout.test.ts` | server_vision_scout reconcileIngredientsToComponents allocates non-zero volume percentage for detected ranch dressing in ingredients list |
| PASS | `server_vision_scout.test.ts` | server_vision_scout reconcileIngredientsToComponents does not duplicate condiment if already present in components |
| PASS | `server_vision_scout.test.ts` | server_vision_scout canMergeScoutLabelIntoFood & spatial clustering does not merge sweet chilli mini fillets label |
| PASS | `server_vision_scout.test.ts` | server_vision_scout canMergeScoutLabelIntoFood & spatial clustering uses Scout Dedupe for True Friends |
| PASS | `server_vision_scout.test.ts` | server_vision_scout canMergeScoutLabelIntoFood & spatial clustering preserves parenthetical comma lists without exploding and keeps direct nutrients intact |
| PASS | `server_vision_scout.test.ts` | server_vision_scout canMergeScoutLabelIntoFood & spatial clustering re-anchors nutrientBasisWeight and merges nutrients in clusterSpatialCompositeDishes |
| PASS | `server_vision_scout.test.ts` | server_vision_scout canMergeScoutLabelIntoFood & spatial clustering combines weights and nutrients for duplicate visual items across separate photos |
| PASS | `server_vision_scout.test.ts` | server_vision_scout canMergeScoutLabelIntoFood & spatial clustering does not merge separate plates or distinct dishes with their own components |
| PASS | `server_vision_scout.test.ts` | server_vision_scout canMergeScoutLabelIntoFood & spatial clustering consolidates duplicate scout items with identical names from the same image even with default boxes |
| PASS | `server_vision_scout.test.ts` | server_vision_scout bracketed content handling should parse bracketed food items with name and weight |
| PASS | `server_vision_scout.test.ts` | server_vision_scout bracketed content handling should filter out scout dishes matching bracketed items in parseAndHealVisionScout |
| PASS | `server_vision_scout.test.ts` | server_vision_scout bracketed content handling should filter out hallucinated/placeholder dishes like 'Empty Context' or 'None' |
| PASS | `server_vision_scout.test.ts` | server_vision_scout bracketed content handling applies unsweetened modifier correctly to Indonesian iced tea (Es Manis / Es Tawar) |
| PASS | `server_vision_scout.test.ts` | server_vision_scout bracketed content handling reconcileIngredientsToComponents gives injected ingredients valid non-zero nutrients and prevents duplicates |
| PASS | `server_vision_scout.test.ts` | server_vision_scout bracketed content handling unrolls a single dish containing multiple distinct food components into separate top-level items without subitems |
| PASS | `server_vision_scout.test.ts` | server_vision_scout bracketed content handling unrolls a sole Mie Ayam bowl (job_1789414917685) even when the dish name does not contain the food names |
| PASS | `server_vision_scout.test.ts` | server_vision_scout bracketed content handling keeps diet-agent per-food boundingBox2D on unrolled top-level previews |
| PASS | `server_vision_scout.test.ts` | server_vision_scout bracketed content handling slices a parent crop by weight when the diet agent omits per-food boxes |
| PASS | `tests/golden_meals.test.ts` | Golden meals — fixture set registers exactly the official goldens |
| PASS | `tests/golden_meals.test.ts` | Golden meals — fixture set each golden has Instruction.md, expected.json, and every listed photo |
| PASS | `tests/golden_meals.test.ts` | Golden meals — Layer B resolve locks & USDA never-match dictionary locks resolve to the pinned local canonical id |
| PASS | `tests/golden_meals.test.ts` | Golden meals — Layer B resolve locks & USDA never-match documented catalog gaps do not silently resolve today |
| PASS | `tests/golden_meals.test.ts` | Golden meals — Layer B resolve locks & USDA never-match never-match table rejects the known USDA / brand false friends |
| PASS | `tests/golden_meals.test.ts` | Golden meals — Layer B resolve locks & USDA never-match category gate still blocks water for a yogurt query |
| PASS | `tests/golden_meals.test.ts` | Golden meals — G1 picnic query hygiene + edit searches wrap/salad components, not the parent dish title |
| PASS | `tests/golden_meals.test.ts` | Golden meals — G1 picnic query hygiene + edit "I ate this croissant" is an item edit, not a half/pack refine |
| PASS | `tests/golden_meals.test.ts` | Golden meals — G2 Sainsbury oats brand math normalizes Sainsbury to chain_key sainsbury |
| PASS | `tests/golden_meals.test.ts` | Golden meals — G2 Sainsbury oats brand math scales official per-100g oats to the user 60g |
| PASS | `tests/golden_meals.test.ts` | Golden meals — G2 Sainsbury oats brand math local brand catalog contains the Scottish rolled oats row |
| PASS | `tests/golden_meals.test.ts` | Golden meals — G3 Yolk refine half-of-the-potatoes is a refine of potatoes only |
| PASS | `tests/golden_meals.test.ts` | Golden meals — G3 Yolk refine does not treat the only local Yolk row as a match for the steak bowl |
| PASS | `tests/golden_meals.test.ts` | Golden meals — G5 printed labels parses visible kcal from the labelled packs |
| PASS | `tests/golden_meals.test.ts` | Golden meals — G5 printed labels parses serving grams from the Indonesian labels |
| PASS | `tests/golden_meals.test.ts` | Golden meals — G5 printed labels pins the three calorie-labelled servings in expected.json |
| PASS | `tests/golden_meals.test.ts` | Golden meals — G4 / G6 / G7 mode contracts G4 first pass is portion_clarify; G6/G7 are compare, not portion |
| PASS | `tests/golden_meals.test.ts` | Golden meals — F-3 Multi-component regional dish decomposition decomposes a dim sum set into distinct searchable item queries without parent pollution |
| PASS | `tests/golden_meals.test.ts` | Golden meals — F-3 Multi-component regional dish decomposition decomposes a Japanese bento box into protein, carb, sides, and soup components |
| PASS | `src/components/NutrientPieChart.test.tsx` | NutrientPieChart polarity wrap wraps sat-fat overage in rose, protein overage in emerald |
| PASS | `src/components/NutrientTargetRow.test.tsx` | NutrientTargetRow renders all top target nutrients matching Home derivation |
| PASS | `src/utils/nutrients.test.ts` | getTopTargetNutrientKeys never uses Object.keys(dailyNutrientTargets).slice(0, 5) |
| PASS | `src/utils/nutrients.test.ts` | getTopTargetNutrientKeys uses report.topNutrientTargets with core filter |
| PASS | `src/utils/nutrients.test.ts` | getTopTargetNutrientKeys falls through healthBaselineCategories then profile.topNutrientsToMonitor |
| PASS | `src/utils/nutrients.test.ts` | getTopTargetNutrientKeys canonicalizes snake_case coach keys so saturated_fat is not a duplicate of saturatedFat |
| PASS | `src/utils/nutrients.test.ts` | nutrient polarity (limit vs goal) treats sat fat / sodium / calories / added sugar as limits regardless of key shape |
| PASS | `src/utils/nutrients.test.ts` | nutrient polarity (limit vs goal) treats protein / fibre / unsaturated fat / micronutrients / steps as goals |
| PASS | `src/utils/nutrients.test.ts` | nutrient polarity (limit vs goal) colors overage as harm only for limit nutrients (Home sat-fat +102% case) |
| PASS | `src/utils/nutrients.test.ts` | nutrient polarity (limit vs goal) canonicalNutrientKey maps coach wire names onto catalog codes |
| PASS | `src/utils/nutrients.test.ts` | nutrient polarity (limit vs goal) lookupByNutrientKey reads snake_case or camelCase bags |
| PASS | `src/utils/nutritionTargetStatus.test.ts` | buildNutritionTargetStatus (adaptive rolling average) matches the spec shape on 7 full days |
| PASS | `src/utils/nutritionTargetStatus.test.ts` | buildNutritionTargetStatus (adaptive rolling average) restart after a gap yields a 1-day average (empty days never dilute) |
| PASS | `src/utils/nutritionTargetStatus.test.ts` | buildNutritionTargetStatus (adaptive rolling average) two logged days yield a 2-day average |
| PASS | `src/utils/nutritionTargetStatus.test.ts` | buildNutritionTargetStatus (adaptive rolling average) under-target and on-target wording; no percent without a target |
| PASS | `src/utils/nutritionTargetStatus.test.ts` | buildNutritionTargetStatus (adaptive rolling average) returns empty with no usable days |
| PASS | `src/utils/nutritionTargetStatus.test.ts` | buildNutritionTargetStatus (adaptive rolling average) pickExplicitTargets keeps only finite positive target keys |
| PASS | `golden/scorecard/instruction/inventories/structure.json` | structure_callsites_getTopTargetNutrientKeys |
| PASS | `golden/scorecard/instruction/inventories/structure.json` | structure_callsites_isLimitNutrient |
| PASS | `golden/scorecard/instruction/inventories/structure.json` | structure_callsites_NutrientTargetRow |
| PASS | `golden/scorecard/instruction/inventories/structure.json` | structure_callsites_finalizeDishLedger |
| PASS | `golden/scorecard/instruction/inventories/structure.json` | structure_forbidden_top_targets_slice5 |
| PASS | `golden/scorecard/instruction/inventories/structure.json` | structure_forbidden_top_targets_slice5_row |
| PASS | `golden/scorecard/instruction/inventories/structure.json` | structure_forbidden_polarity_includes_satfat |
| PASS | `golden/scorecard/instruction/inventories/structure.json` | structure_top_targets_fallback |
| PASS | `golden/scorecard/instruction/inventories/structure.json` | structure_limit_keys_present |

### Localization (51)

| Status | File | Test |
|---|---|---|
| PASS | `agents/dietitianInstructions.i18n.test.ts` | agent output language dietitian instruction names Bahasa Indonesia for id profiles |
| PASS | `agents/dietitianInstructions.i18n.test.ts` | agent output language receptionist instruction follows ui language |
| PASS | `agents/dietitianInstructions.i18n.test.ts` | agent output language health coach instruction follows ui language and keeps schema keys English |
| PASS | `agents/dietitianInstructions.i18n.test.ts` | agent output language medical fill-template insight copy follows ui language |
| PASS | `agents/dietitianInstructions.i18n.test.ts` | agent output language scout keeps food identity untranslated |
| PASS | `src/utils/auditEngine.i18n.test.ts` | runGeneralizedBiomarkerAudit language keeps English fallback titles by default |
| PASS | `src/utils/auditEngine.i18n.test.ts` | runGeneralizedBiomarkerAudit language writes fallback titles in Indonesian for id |
| PASS | `src/utils/i18n.test.ts` | i18n locales lists the supported locale codes |
| PASS | `src/utils/i18n.test.ts` | i18n locales requires English and Indonesian raw packs to have the same keys as en (not English-filled) |
| PASS | `src/utils/i18n.test.ts` | i18n locales falls back to English for a missing French/Chinese key |
| PASS | `src/utils/i18n.test.ts` | normalizeLocale maps common aliases |
| PASS | `src/utils/i18n.test.ts` | dictionaryFor returns Indonesian copy for id |
| PASS | `src/utils/i18n.test.ts` | dictionaryFor uses Indonesian Front Desk welcome, not the English Health Preparation Agent string |
| PASS | `src/utils/i18n.test.ts` | dictionaryFor translates leftover meal-10 chrome in Indonesian |
| PASS | `src/utils/i18n.test.ts` | agentOutputLanguageBlock names Bahasa Indonesia and keeps JSON keys in English |
| PASS | `src/utils/i18n.test.ts` | agentOutputLanguageBlock does not tell English users to avoid English |
| PASS | `src/utils/i18n.test.ts` | agentOutputLanguageBlock prepends the block onto an instruction |
| PASS | `src/utils/i18n.test.ts` | display chrome helpers translates flagged and optimal status badges in Indonesian |
| PASS | `src/utils/i18n.test.ts` | display chrome helpers leaves custom lab bracket names untranslated |
| PASS | `src/utils/i18n.test.ts` | display chrome helpers translates health category headings and keeps unknown groups |
| PASS | `src/utils/i18n.test.ts` | display chrome helpers translates ethnicity option labels but keeps stored values |
| PASS | `src/utils/i18n.test.ts` | display chrome helpers uses Indonesian nutrient chrome names including Sat Fat short form |
| PASS | `src/utils/i18n.test.ts` | display chrome helpers interpolates chart chrome placeholders |
| PASS | `src/utils/i18n.test.ts` | display chrome helpers interpolates insights extraction blurbs in Indonesian |
| PASS | `src/utils/i18n.test.ts` | display chrome helpers translates BMI normal-weight and medium risk chrome |
| PASS | `src/utils/i18n.test.ts` | display chrome helpers translates job Ready badge and demo credits chrome |
| PASS | `src/utils/i18n.test.ts` | display chrome helpers translates clinical TYPE/TIMING chrome and issue-card prefixes |
| PASS | `src/utils/i18n.test.ts` | display chrome helpers translates catalog biomarker names and keeps stored keys |
| PASS | `src/utils/i18n.test.ts` | display chrome helpers translates medical condition names and passes unknown strings through |
| PASS | `src/utils/i18n.test.ts` | display chrome helpers localizes meal fallback and widget chrome in Indonesian |
| PASS | `src/utils/i18n.test.ts` | S-1 leftover chrome (LEAK_EN_CHROME) keys the S-1 button/card chrome in en and id with differing copy |
| PASS | `src/utils/i18n.test.ts` | S-1 leftover chrome (LEAK_EN_CHROME) documents parked S-1 residuals without keying them yet |
| PASS | `src/utils/i18n.test.ts` | scorecard REQUIRED_CHROME (cannot cheat via parity-only) does not drop leak-class keys from the frozen list |
| PASS | `src/utils/i18n.test.ts` | scorecard REQUIRED_CHROME (cannot cheat via parity-only) keeps every frozen leftover-chrome key in en and id |
| PASS | `src/utils/i18n.test.ts` | scorecard REQUIRED_CHROME (cannot cheat via parity-only) does not leak raw keys or English-fill Indonesian chrome |
| PASS | `src/utils/i18n.test.ts` | L-2 seeded/demo chrome (Insights step cards + outlier preciseCause) keeps the Insights step cards in real EN + ID copy (no key-name leftovers) |
| PASS | `src/utils/i18n.test.ts` | L-2 seeded/demo chrome (Insights step cards + outlier preciseCause) follows profile.language in the outlier preciseCause (id / en / unset) |
| PASS | `src/utils/i18n.test.ts` | L-2 seeded/demo chrome (Insights step cards + outlier preciseCause) ratchets TRANSLATION_DUMP leftovers so the class can only shrink |
| PASS | `src/components/ui/AppModal.test.tsx` | AppModal UI Primitive does not render markup when isOpen is false |
| PASS | `src/components/ui/AppModal.test.tsx` | AppModal UI Primitive renders title, subtitle, content, and actions when isOpen is true |
| PASS | `src/components/ui/AppModal.test.tsx` | AppModal UI Primitive renders with custom size classes and close button |
| PASS | `src/components/chat-cards/ReceptionistCard.i18n.test.tsx` | ReceptionistCard i18n renders English handoff chrome by default |
| PASS | `src/components/chat-cards/ReceptionistCard.i18n.test.tsx` | ReceptionistCard i18n renders Indonesian handoff chrome for id |
| PASS | `src/components/chat-cards/ReceptionistCard.i18n.test.tsx` | ReceptionistCard i18n renders Indonesian form and panel chrome for id |
| PASS | `golden/scorecard/instruction/i18n/REQUIRED_CHROME.json` | i18n_required_chrome_present |
| PASS | `golden/scorecard/instruction/i18n/REQUIRED_CHROME.json` | i18n_required_chrome_not_leak_key |
| PASS | `golden/scorecard/instruction/i18n/REQUIRED_CHROME.json` | i18n_required_chrome_id_not_en |
| PASS | `golden/scorecard/instruction/i18n/REQUIRED_CHROME.json` | i18n_required_chrome_id_not_humanized_key |
| PASS | `golden/scorecard/instruction/i18n/REQUIRED_CHROME.json` | i18n_callsite_keys_in_packs |
| PASS | `golden/scorecard/instruction/i18n/REQUIRED_CHROME.json` | i18n_id_not_incident_string |
| PASS | `golden/scorecard/instruction/i18n/REQUIRED_CHROME.json` | i18n_components_not_hardcoded_incident |

### Biomarkers (148)

| Status | File | Test |
|---|---|---|
| PASS | `tests/bioProcess.golden.test.ts` | Q-8.4 biomarker process board — §1.3.1 bio exits audits every QUALITY.md §1.3.1 biomarker process exit |
| PASS | `tests/bioProcess.golden.test.ts` | Q-8.4 biomarker process board — §1.3.1 bio exits Medical SSE wrap emits {final,result} for a medical-shaped payload |
| PASS | `tests/bioProcess.golden.test.ts` | Q-8.4 biomarker process board — §1.3.1 bio exits salvage terminal: extract + agent dead + succeeded is not DEGRADE_NOT_TERMINAL; running after extract is |
| PASS | `tests/bioProcess.golden.test.ts` | Q-8.4 biomarker process board — §1.3.1 bio exits publishResultReady terminals a medical dummy once extractedData exists |
| PASS | `tests/bioProcess.golden.test.ts` | Q-8.4 biomarker process board — §1.3.1 bio exits APPLY_MISS: convertViaTable locks + enrichReviewModificationCommands keep observationMeta raw |
| PASS | `tests/bioProcess.golden.test.ts` | Q-8.4 biomarker process board — §1.3.1 bio exits table abort when 0 high-confidence names; leftover does not send Parser a high-confidence name |
| PASS | `tests/bioProcess.golden.test.ts` | Q-8.4 biomarker process board — §1.3.1 bio exits DIAG5 auto-send does not fire on a lab chat |
| PASS | `tests/bioProcess.golden.test.ts` | Q-8.4 biomarker process board — §1.3.1 bio exits shared stall hop still hops on 503 for a medical dummy tree |
| PASS | `tests/bioProcess.golden.test.ts` | Q-8.4 in-memory medical publish isolation does not treat empty medical dummy as food ledger |
| PASS | `tests/golden_biomarker.test.ts` | Golden Biomarker — backoffice extract converts via the single table (no second math path) converts the five G-B1 locks exactly (triglycerides must NOT use the cholesterol factor) |
| PASS | `tests/golden_biomarker.test.ts` | Golden Biomarker — backoffice extract converts via the single table (no second math path) leaves incomparable pairs unconverted instead of guessing |
| PASS | `tests/golden_biomarker.test.ts` | Golden Biomarker — backoffice extract converts via the single table (no second math path) keeps the legacy HbA1c % branch verbatim (shared table has no hba1c row) |
| PASS | `tests/golden_biomarker.test.ts` | Golden Biomarker — G-B1 & Class Verification verifies G-B1 case metadata and class bindings |
| PASS | `tests/golden_biomarker.test.ts` | Golden Biomarker — G-B1 & Class Verification verifies G-B1 five locked unit conversions match expected.json |
| PASS | `tests/golden_biomarker.test.ts` | Golden Biomarker — G-B1 & Class Verification verifies G-B1 review modification synthesis converts only non-SI row |
| PASS | `tests/golden_biomarker.test.ts` | Golden Biomarker — G-B1 & Class Verification verifies B0.1-0.3 / G-B1 applyModificationCommands writes history and retains observationMeta raw while leaving older SI untouched |
| PASS | `tests/golden_biomarker.test.ts` | Golden Biomarker — G-B1 & Class Verification verifies IngestTrace type contract and ClassId enums |
| PASS | `tests/golden_biomarker.test.ts` | Golden Biomarker — G-B4 False Friend Guard verifies false friends do not cross-map |
| PASS | `tests/golden_biomarker.test.ts` | Golden Biomarker — G-B2 EMIS / NHS Table Outer Regression verifies G-B2 assertions run lexTable and buildIngestBatch for class counts |
| PASS | `tests/golden_biomarker.test.ts` | Golden Biomarker — G-B2 EMIS / NHS Table Outer Regression splits a single-line quoted EMIS paste into records (production shape) |
| PASS | `tests/golden_biomarker.test.ts` | Golden Biomarker — G-B3 Lexer Shape & Panel Skip (CONFORMANCE_SHAPE) verifies G-B3 shape conformance, UK unit exponential handling, and panel skips |
| PASS | `tests/golden_biomarker.test.ts` | Golden Biomarker — G-B5 Food in Medical (WRONG_DOOR) verifies G-B5 class bindings and executes destination routing |
| PASS | `tests/golden_biomarker.test.ts` | Golden Biomarker — G-B6 Symptom Diary (WRONG_DOOR) verifies G-B6 symptom diary classification and executes routing helper |
| PASS | `tests/golden_biomarker.test.ts` | Golden Biomarker — G-B7 Incomplete Reading (COMPLETENESS) verifies G-B7 incomplete reading detection via lexTable and buildIngestBatch |
| PASS | `tests/golden_biomarker.test.ts` | Golden Biomarker — G-B8 Repaste Identity (UPSERT_IDENTITY) verifies G-B8 identity upsert class and verifies report deduplication match |
| PASS | `tests/golden_biomarker.test.ts` | Golden Biomarker — Telemetry Multiplier & Auto-Fix Proposals correctly computes deterministic conversion proposals strictly for US <-> SI unit differences |
| PASS | `tests/golden_biomarker.test.ts` | Golden Biomarker — Telemetry Multiplier & Auto-Fix Proposals detects flagged telemetry errors and correctly separates auto-fixable US/SI units from AI review cases |
| PASS | `tests/golden_biomarker.test.ts` | Golden Biomarker — G-B9 Vision N/A (CONFORMANCE_SHAPE) verifies G-B9 vision N/A image handling via shouldAbortTablePath helper |
| PASS | `tests/golden_biomarker.test.ts` | Golden Biomarker — Multi-Panel Ingestion & Plausibility Validation Architecture resolves multi-panel NHS / UK laboratory print names correctly without alias collision |
| PASS | `tests/golden_biomarker.test.ts` | Golden Biomarker — Multi-Panel Ingestion & Plausibility Validation Architecture verifies unit conversions in ANALYTE_CONVERSIONS for hematology and metabolic panels |
| PASS | `src/utils/biomarkerIdentity.test.ts` | getMappedBiomarkerKey — identity maps empty to empty |
| PASS | `src/utils/biomarkerIdentity.test.ts` | getMappedBiomarkerKey — identity resolves built-in keys case-insensitively |
| PASS | `src/utils/biomarkerIdentity.test.ts` | getMappedBiomarkerKey — identity maps unit-suffixed lab aliases to canonical keys (no duplicate identity) |
| PASS | `src/utils/biomarkerIdentity.test.ts` | getMappedBiomarkerKey — identity maps symptom aliases that share one score key (dedupe pressure) |
| PASS | `src/utils/biomarkerIdentity.test.ts` | getMappedBiomarkerKey — identity strips punctuation but keeps unknown keys as cleaned raw (no silent invent) |
| PASS | `src/utils/biomarkerIdentity.test.ts` | getMappedBiomarkerKey — identity built-in definitions do not share the same key twice |
| PASS | `src/utils/biomarkerIdentity.test.ts` | getCustomBiomarkerDef — alias fallback returns def under core key |
| PASS | `src/utils/biomarkerIdentity.test.ts` | getCustomBiomarkerDef — alias fallback falls back to custom stored under alias when core key missing |
| PASS | `src/utils/biomarkerIdentity.test.ts` | getMergedBiomarkerDef — field priority prefers custom name/unit/range over built-in when set |
| PASS | `src/utils/biomarkerIdentity.test.ts` | getMergedBiomarkerDef — field priority does not drop built-in when custom is partial |
| PASS | `src/utils/biomarkerIdentity.test.ts` | getMergedBiomarkerDef — field priority pulls unit/range from item logs when custom/built-in empty |
| PASS | `src/utils/biomarkerIdentity.test.ts` | approval / missing range gates built-in hba1c is approved without a custom def |
| PASS | `src/utils/biomarkerIdentity.test.ts` | approval / missing range gates needsApproval on custom blocks isBiomarkerApproved |
| PASS | `src/utils/biomarkerIdentity.test.ts` | approval / missing range gates isBiomarkerMissingRange true for empty/unknown range |
| PASS | `src/utils/biomarkerIdentity.test.ts` | approval / missing range gates built-in hba1c is not missing range |
| PASS | `src/utils/biomarkerIdentity.test.ts` | approval / missing range gates stale needsApproval on a built-in does not hide it from live use |
| PASS | `src/utils/biomarkerIdentity.test.ts` | approval / missing range gates pending is explicit needsApproval only — missing fields are not pending |
| PASS | `src/utils/biomarkerIdentity.test.ts` | approval / missing range gates extract does not stamp pending on catalog keys or already-approved defs |
| PASS | `src/utils/biomarkerIdentity.test.ts` | dedupe pressure — alias fan-in hemoglobin family collapses to one canonical key |
| PASS | `src/utils/biomarkerIdentity.test.ts` | dedupe pressure — alias fan-in albumin family collapses |
| PASS | `src/utils/biomarkerIdentity.test.ts` | dedupe pressure — alias fan-in egfr family collapses to one canonical key across lab unit suffixes |
| PASS | `src/utils/biomarkerIdentity.test.ts` | dedupe pressure — alias fan-in egfr collapses across plain-English and specimen-prefixed name variants (dedup engine review) |
| PASS | `src/utils/biomarkerIdentity.test.ts` | dedupe pressure — alias fan-in bmi collapses across full-name and unit-suffixed key variants (dedup engine review) |
| PASS | `src/utils/biomarkerIdentity.test.ts` | isBiomarkerDuplicateCandidate — false-friend guards (dedup engine review) does NOT merge plain Hemoglobin with Mean Corpuscular Hemoglobin (different analytes/units) |
| PASS | `src/utils/biomarkerIdentity.test.ts` | isBiomarkerDuplicateCandidate — false-friend guards (dedup engine review) does NOT merge Hemoglobin with Hemoglobin A1c (glycated Hb is a distinct test) |
| PASS | `src/utils/biomarkerIdentity.test.ts` | isBiomarkerDuplicateCandidate — false-friend guards (dedup engine review) does NOT merge Testosterone with Free Testosterone (distinct clinical values) |
| PASS | `src/utils/biomarkerIdentity.test.ts` | isBiomarkerDuplicateCandidate — false-friend guards (dedup engine review) does NOT merge blood Creatinine with Urine Creatinine (different specimen types) |
| PASS | `src/utils/biomarkerIdentity.test.ts` | isBiomarkerDuplicateCandidate — false-friend guards (dedup engine review) DOES merge Mean Corpuscular Hemoglobin with its unit-suffixed lab variant |
| PASS | `src/utils/biomarkerIdentity.test.ts` | isBiomarkerDuplicateCandidate — false-friend guards (dedup engine review) DOES merge eGFR with an unrecognized creatinine-suffixed key via canonical mapped-key match |
| PASS | `src/utils/biomarkerIdentity.test.ts` | isBiomarkerDuplicateCandidate — false-friend guards (dedup engine review) STRUCTURAL: does NOT merge Direct Bilirubin with Indirect Bilirubin — never explicitly coded, proves the discriminator list generalizes |
| PASS | `src/utils/biomarkerIdentity.test.ts` | isBiomarkerDuplicateCandidate — false-friend guards (dedup engine review) STRUCTURAL: does NOT merge Calcium with Ionized Calcium — never explicitly coded, proves the discriminator list generalizes |
| PASS | `src/utils/biomarkerIdentity.test.ts` | isBiomarkerDuplicateCandidate — false-friend guards (dedup engine review) STRUCTURAL: does NOT merge PSA with Free PSA — never explicitly coded, proves the discriminator list generalizes |
| PASS | `src/utils/biomarkerIdentity.test.ts` | isBiomarkerDuplicateCandidate — false-friend guards (dedup engine review) REGRESSION: does NOT merge Cortisol with Cortisol Peak — caught a dead-code wiring defect where CLINICAL_DISCRIMINATOR_TERMS was declared but neve |
| PASS | `src/utils/biomarkerIdentity.test.ts` | isBiomarkerDuplicateCandidate — false-friend guards (dedup engine review) REGRESSION: does NOT merge Creatinine with Fecal Creatinine — specimen guard must cover fecal/faecal, not just urine/csf/saliva/stool |
| PASS | `src/utils/biomarkerIdentity.test.ts` | selfHealCustomBiomarkerDefinitions — structural self-healing automatically infers units, reference ranges, and physiological categories for new biomarkers |
| PASS | `src/utils/biomarkerIdentity.test.ts` | selfHealCustomBiomarkerDefinitions — structural self-healing preserves existing custom ranges while filling in missing structural metadata |
| PASS | `src/utils/biomarkerIdentity.test.ts` | getBiomarkerEffectiveRisk — tag-aligned category scoring (score = -5..+5 severity magnitude, not a 0-4 bucket) returns At risk tag and a positive severity magnitude for non-hdl cholesterol with at-risk structured range |
| PASS | `src/utils/biomarkerIdentity.test.ts` | getBiomarkerEffectiveRisk — tag-aligned category scoring (score = -5..+5 severity magnitude, not a 0-4 bucket) caps the uncalibrated fallback magnitude |
| PASS | `src/utils/biomarkerIdentity.test.ts` | getBiomarkerEffectiveRisk — tag-aligned category scoring (score = -5..+5 severity magnitude, not a 0-4 bucket) uses the clinician-calibrated severity number directly when rangeBrackets are present, up to magnitude 5 |
| PASS | `src/utils/biomarkerIdentity.test.ts` | getBiomarkerEffectiveRisk — tag-aligned category scoring (score = -5..+5 severity magnitude, not a 0-4 bucket) returns Normal with score 0 and severity 0 for within-range values |
| PASS | `src/utils/biomarkerIdentity.test.ts` | getBiomarkerEffectiveRisk — tag-aligned category scoring (score = -5..+5 severity magnitude, not a 0-4 bucket) returns No Data with score -Infinity (sorts below every real severity, including Normal's 0) for empty or mis |
| PASS | `src/utils/biomarkerIdentity.test.ts` | getBiomarkerEffectiveRisk — tag-aligned category scoring (score = -5..+5 severity magnitude, not a 0-4 bucket) ranks a flagged (implausible-value) entry |
| PASS | `src/utils/biomarkerIdentity.test.ts` | getBiomarkerSeverityScore — universal -5..+5 severity for ranking returns null (not 0) when there is no usable range |
| PASS | `src/utils/biomarkerIdentity.test.ts` | getBiomarkerSeverityScore — universal -5..+5 severity for ranking returns 0 for a value inside a plain min-max normalRange |
| PASS | `src/utils/biomarkerIdentity.test.ts` | getBiomarkerSeverityScore — universal -5..+5 severity for ranking scales magnitude with severity for a one-sided low-is-bad range (e.g. Steps), never exceeding the fallback cap |
| PASS | `src/utils/biomarkerIdentity.test.ts` | getBiomarkerSeverityScore — universal -5..+5 severity for ranking prefers a clinician-calibrated rangeBrackets severity over the fallback formula |
| PASS | `src/utils/biomarkerIdentity.test.ts` | Clinical Diagnostic Scale & Non-Critical Chronic Labels maps LDL 4.3 mmol/L to high with Very High label (never critical) |
| PASS | `src/utils/biomarkerIdentity.test.ts` | Clinical Diagnostic Scale & Non-Critical Chronic Labels maps eGFR 45 mL/min to low with Decreased (CKD G3) label (never critical) |
| PASS | `src/utils/biomarkerIdentity.test.ts` | Clinical Diagnostic Scale & Non-Critical Chronic Labels maps eGFR 80 to low with Mildly Decreased (CKD G2), not Low |
| PASS | `src/utils/biomarkerIdentity.test.ts` | Clinical Diagnostic Scale & Non-Critical Chronic Labels maps total cholesterol 6.5 mmol/L to high with Very High (never critical) |
| PASS | `src/utils/biomarkerIdentity.test.ts` | Clinical Diagnostic Scale & Non-Critical Chronic Labels maps raw status enums away from critical/high/normal |
| PASS | `src/utils/biomarkerIdentity.test.ts` | Clinical Diagnostic Scale & Non-Critical Chronic Labels scores Very High / Decreased display tags from calibrated severity, not unknown |
| PASS | `src/utils/biomarkerIdentity.test.ts` | Clinical Diagnostic Scale & Non-Critical Chronic Labels maps hs-CRP 3.5 mg/L to high with High risk label (never critical) |
| PASS | `src/utils/biomarkerIdentity.test.ts` | Clinical Diagnostic Scale & Non-Critical Chronic Labels maps Vitamin D 15 ng/mL to low with Severe deficiency label (never critical) |
| PASS | `src/utils/biomarkerIdentity.test.ts` | Clinical Diagnostic Scale & Non-Critical Chronic Labels correctly maps -5 to +5 integer severity scale in rangeBrackets |
| PASS | `src/utils/biomarkerIdentity.test.ts` | Clinical Diagnostic Scale & Non-Critical Chronic Labels ensures dynamic clinical labels generated by the agent take precedence over static catalog labels |
| PASS | `src/utils/biomarkerLifecycle.test.ts` | convertViaTable converts HDL mg/dL → mmol/L |
| PASS | `src/utils/biomarkerLifecycle.test.ts` | convertViaTable refuses unknown analyte |
| PASS | `src/utils/biomarkerLifecycle.test.ts` | convertViaTable refuses incomparable units |
| PASS | `src/utils/biomarkerLifecycle.test.ts` | convertViaTable SECOND_MATH_PATH: a new table row converts; a key without a row does not |
| PASS | `src/utils/biomarkerLifecycle.test.ts` | buildReviewCommandsFromHistory synthesizes SI convert commands when Review omits modificationCommand |
| PASS | `src/utils/biomarkerLifecycle.test.ts` | buildReviewCommandsFromHistory does not invent commands when history is already one scale |
| PASS | `src/utils/biomarkerLifecycle.test.ts` | handleUnitChange (P6) relabels unit in profile/custom without modifying history values |
| PASS | `src/utils/biomarkerLifecycle.test.ts` | handleUnitChange (P6) converts history values with convertViaTable and populates observationMeta |
| PASS | `src/utils/biomarkerLifecycle.test.ts` | applyModificationCommands fills omitted newValue via convert table (HDL 50 mg/dL → mmol/L) |
| PASS | `src/utils/biomarkerLifecycle.test.ts` | applyModificationCommands updates a DD-MM-YYYY row from ISO command date |
| PASS | `src/utils/biomarkerLifecycle.test.ts` | applyModificationCommands applies the five convert commands onto 14-08-2026 while older SI rows remain unchanged |
| PASS | `src/utils/biomarkerLifecycle.test.ts` | overlay fingerprint / calibrator gate bands age |
| PASS | `src/utils/biomarkerLifecycle.test.ts` | overlay fingerprint / calibrator gate skips sodium (no rangeVariesBy) |
| PASS | `src/utils/biomarkerLifecycle.test.ts` | overlay fingerprint / calibrator gate runs HDL when overlay fingerprint missing |
| PASS | `src/utils/biomarkerLifecycle.test.ts` | overlay fingerprint / calibrator gate skips HDL when fingerprint matches |
| PASS | `src/utils/biomarkerLifecycle.test.ts` | overlay fingerprint / calibrator gate runs calibrator for 25-yo female, skips on rerun with stored overlay, runs again when age changes to 55 |
| PASS | `src/utils/biomarkerLifecycle.test.ts` | overlay fingerprint / calibrator gate recalibrates profile overlays when demographic fingerprint shifts |
| PASS | `src/utils/biomarkerLifecycle.test.ts` | overlay fingerprint / calibrator gate correctly attributes reference range sources (catalog, lab report, demographic, custom) |
| PASS | `src/utils/biomarkerLifecycle.test.ts` | filter live for use drops pending custom keys from history |
| PASS | `src/utils/biomarkerLifecycle.test.ts` | filter live for use drops 195 cholesterol from dietitian prompt context when flagged in history |
| PASS | `src/utils/biomarkerLifecycle.test.ts` | attachObservationMeta stores raw unit on the log |
| PASS | `src/utils/biomarkerLifecycle.test.ts` | resolveAgentDestination folds retired agents onto owners |
| PASS | `src/utils/biomarkerLifecycle.test.ts` | resolveAgentDestination routes data_accuracy to comparison modal payload |
| PASS | `src/utils/biomarkerLifecycle.test.ts` | resolveAgentDestination routes biomarker_review with proposal.range to customRanges proposal (NOT silent write) |
| PASS | `src/utils/biomarkerLifecycle.test.ts` | resolveAgentDestination routes name_consolidation to remap proposal |
| PASS | `src/utils/biomarkerLifecycle.test.ts` | isValEmpty treats 0 and 0.0 as real values |
| PASS | `src/utils/biomarkerLifecycle.test.ts` | isValEmpty treats blank, null, undefined, and NaN as empty |
| PASS | `src/utils/biomarkerLifecycle.test.ts` | sanitizeReviewReply & review command enrichment corrects hallucinated newValue (16 -> 13.68) and bad reason for bilirubin 0.8 |
| PASS | `src/utils/biomarkerLifecycle.test.ts` | sanitizeReviewReply & review command enrichment sanitizes reply text containing hallucinated 0.8 -> 16 and decimal placement shift phrases |
| PASS | `src/utils/biomarkerLifecycle.test.ts` | sanitizeBiomarkerHistoryOnLoad — flag only does not rewrite 195 cholesterol |
| PASS | `src/utils/biomarkerLifecycle.test.ts` | cleanupInventedBiomarkerCatalog (7.1 Profile Data Cleanup) remaps alias slugs, drops metric_N with no history, and strips negative < 0 ranges |
| PASS | `src/utils/biomarkerLifecycle.test.ts` | cleanupInventedBiomarkerCatalog (7.1 Profile Data Cleanup) B7.6 Name Deduper: remaps metric_N with recognized analyte name, tombstones old key, and migrates history in-place |
| PASS | `src/utils/biomarkerLifecycle.test.ts` | Pending Store Isolation (7.4 Home Dashboard / Coach Query Guard) prevents pending observations from being live for use on Home or prompts |
| PASS | `src/utils/biomarkerLifecycle.test.ts` | attachObservationMeta (7.3 Historical observationMeta backfill) backfills rawValue from biomarkers[key] when rawValue is omitted in meta |
| PASS | `src/utils/biomarkerLifecycle.test.ts` | recalibrateProfileOverlays (7.5 Silent Calibrator) updates overlayFingerprint when demographic profile changes |
| PASS | `src/utils/biomarkerLifecycle.test.ts` | Layer-1 EMIS / NHS table ingest splits concatenated quoted EMIS records that have no newlines |
| PASS | `src/utils/biomarkerLifecycle.test.ts` | Layer-1 EMIS / NHS table ingest stages known SI rows and leaves unknown / qualitative names unmatched |
| PASS | `src/utils/biomarkerLifecycle.test.ts` | Layer-1 EMIS / NHS table ingest mergeStagedExtract prepends Layer-1 rows so the parser table is not empty |
| PASS | `src/utils/biomarkerLifecycle.test.ts` | Layer-1 EMIS / NHS table ingest parse helpers |
| PASS | `src/utils/biomarkerLifecycle.test.ts` | Layer-1 double-escaped EMIS table ingest (spreadsheet round-trip) splits and un-escapes double-quoted EMIS records with no newlines |
| PASS | `src/utils/biomarkerLifecycle.test.ts` | Layer-1 double-escaped EMIS table ingest (spreadsheet round-trip) stages known SI rows from the double-escaped format same as the single-escaped format |
| PASS | `src/utils/biomarkerLifecycle.test.ts` | B7.4 Real Pending Store: unknown printed names never become catalog keys routeExtractedObservations routes unknown printed names to pendingObservations, not approvedObservations |
| PASS | `src/utils/biomarkerLifecycle.test.ts` | B7.4 Real Pending Store: unknown printed names never become catalog keys routeExtractedObservations accepts approved custom biomarkers into approvedObservations |
| PASS | `src/utils/biomarkerLifecycle.test.ts` | B7.4 Real Pending Store: unknown printed names never become catalog keys cleanupInventedBiomarkerCatalog purges needsApproval from customBiomarkers bag and moves unapproved to pendingObservations |
| PASS | `src/utils/biomarkerLifecycle.test.ts` | B7.4 Real Pending Store: unknown printed names never become catalog keys approvePendingObservation promotes pending item to customBiomarkers with catalogApproved=true and writes to history |
| PASS | `src/utils/biomarkerLifecycle.test.ts` | B7.4 Real Pending Store: unknown printed names never become catalog keys dismissPendingObservation discards observation from pending store |
| PASS | `src/utils/biomarkerSanitize.test.ts` | parseNormalRangeBounds parses Aim under 5.0 |
| PASS | `src/utils/biomarkerSanitize.test.ts` | isBiomarkerValueImprobable flags 195 mmol/L total cholesterol |
| PASS | `src/utils/biomarkerSanitize.test.ts` | isBiomarkerValueImprobable flags 42.1 hematocrit as % |
| PASS | `src/utils/biomarkerSanitize.test.ts` | isBiomarkerValueImprobable flags 14.5 hemoglobin as g/dL when unit is g/L |
| PASS | `src/utils/biomarkerSanitize.test.ts` | isBiomarkerValueImprobable does not flag everyday step counts as improbable |
| PASS | `src/utils/biomarkerSanitize.test.ts` | sanitizeBiomarkerHistoryOnLoad flags 195 cholesterol but does not rewrite it |
| PASS | `src/utils/biomarkerSanitize.test.ts` | sanitizeBiomarkerHistoryOnLoad flags hematocrit 42.1 but leaves the stored value |
| PASS | `src/utils/clinicalCalculators.test.ts` | Clinical Calculator Engine calculateMifflinStJeor calculates exact energy target for baseline Asian profile |
| PASS | `src/utils/clinicalCalculators.test.ts` | Clinical Calculator Engine calculateMifflinStJeor calculates dynamic target calories for non-baseline female profile |
| PASS | `src/utils/clinicalCalculators.test.ts` | Clinical Calculator Engine calculateTgHdlRatio calculates optimal atherogenic ratio correctly in mg/dL |
| PASS | `src/utils/clinicalCalculators.test.ts` | Clinical Calculator Engine calculateTgHdlRatio calculates elevated ratio correctly in mmol/L |
| PASS | `src/utils/clinicalCalculators.test.ts` | Clinical Calculator Engine calculateCkdEpi2021 calculates normal filtration for healthy adult female |
| PASS | `src/utils/clinicalCalculators.test.ts` | Clinical Calculator Engine calculateCkdEpi2021 calculates decreased filtration for elevated creatinine |
| PASS | `src/utils/clinicalCalculators.test.ts` | Clinical Calculator Engine CLINICAL_CALCULATOR_REGISTRY contains all core calculator definitions |
| PASS | `node scripts/assert-biomarker-lifecycle-m31.mjs` | biomarker-lifecycle-m31 |
| PASS | `golden/scorecard/instruction/inventories/structure.json` | structure_biomarker_multipliers |

### Receptionist (43)

| Status | File | Test |
|---|---|---|
| PASS | `tests/deskProcess.golden.test.ts` | Q-8.5 receptionist process board — §1.3.1 desk exits audits every QUALITY.md §1.3.1 receptionist process exit |
| PASS | `tests/deskProcess.golden.test.ts` | Q-8.5 receptionist process board — §1.3.1 desk exits empty-demo wipe (CHAT_STALE): resetAllJobs + clearChatMemoryKeys |
| PASS | `tests/deskProcess.golden.test.ts` | Q-8.5 receptionist process board — §1.3.1 desk exits UC-02 handoff reaches the specialist; incomplete stays needs_info with no specialist job |
| PASS | `tests/deskProcess.golden.test.ts` | Q-8.5 receptionist process board — §1.3.1 desk exits handoff record from/to + dropped keys PASS; missing specialist is MISSING |
| PASS | `tests/deskProcess.golden.test.ts` | Q-8.5 receptionist process board — §1.3.1 desk exits after handoff, food pack still scores food laws; medical pack flags meal scout tape WRONG_PLACE |
| PASS | `tests/deskProcess.golden.test.ts` | Q-8.5 receptionist process board — §1.3.1 desk exits Front Desk is not a second meal analyzer — fd/front_desk, food ledger laws n/a |
| PASS | `tests/deskProcess.golden.test.ts` | Q-8.5 JobStore isolation resetAllJobs is idempotent on an empty store |
| PASS | `src/utils/frontDeskRouting.test.ts` | isUnderspecifiedUtterance treats stubs as underspecified |
| PASS | `src/utils/frontDeskRouting.test.ts` | isUnderspecifiedUtterance does not treat specialist jobs as stubs |
| PASS | `src/utils/frontDeskRouting.test.ts` | isRoutableSpecialistIntent rejects receptionist / vague intents |
| PASS | `src/utils/frontDeskRouting.test.ts` | isRoutableSpecialistIntent accepts named specialist jobs |
| PASS | `src/utils/frontDeskRouting.test.ts` | mapFrontDeskSpecialist maps coach / medical / food / nutritionist |
| PASS | `src/utils/frontDeskRouting.test.ts` | mapFrontDeskSpecialist does not map receptionist |
| PASS | `src/utils/handoffGuard.test.ts` | decideFrontDeskHandoff (HANDOFF_LOOP) fires for a genuine front_desk ready response with payload |
| PASS | `src/utils/handoffGuard.test.ts` | decideFrontDeskHandoff (HANDOFF_LOOP) routes medical payloads to the medical agent |
| PASS | `src/utils/handoffGuard.test.ts` | decideFrontDeskHandoff (HANDOFF_LOOP) does NOT fire for downstream echo responses carrying a payload |
| PASS | `src/utils/handoffGuard.test.ts` | decideFrontDeskHandoff (HANDOFF_LOOP) does NOT fire when the payload is missing or empty (blind handoff) |
| PASS | `src/utils/handoffGuard.test.ts` | decideFrontDeskHandoff (HANDOFF_LOOP) does NOT fire on handoff-continuation turns |
| PASS | `src/utils/handoffGuard.test.ts` | decideFrontDeskHandoff (HANDOFF_LOOP) fires for agentType-less ready responses (back-compat) |
| PASS | `src/utils/handoffGuard.test.ts` | decideFrontDeskHandoff (HANDOFF_LOOP) does NOT fire for general_receptionist even with a payload |
| PASS | `src/utils/handoffGuard.test.ts` | decideFrontDeskHandoff (HANDOFF_LOOP) does NOT fire on needs_info (payload alone is not enough) |
| PASS | `src/utils/handoffGuard.test.ts` | decideFrontDeskHandoff (HANDOFF_LOOP) routes meal_logging to food and nutritionist to food_idea |
| PASS | `src/utils/handoffGuard.test.ts` | isUsableHandoffPayload rejects null/empty/payload-less shapes |
| PASS | `src/utils/handoffGuard.test.ts` | buildHandoffPrompt falls back to the generic prompt only when summary and insights are absent |
| PASS | `src/server/receptionist/handoffContract.test.ts` | enforceReadyHandoffContract downgrades to needs_info when model emits ready_for_handoff without demographics |
| PASS | `src/server/receptionist/handoffContract.test.ts` | enforceReadyHandoffContract synthesizes handoffPayload when demographics are complete |
| PASS | `src/server/receptionist/handoffContract.test.ts` | enforceReadyHandoffContract leaves non-ready outputs untouched |
| PASS | `src/server/receptionist/handoffContract.test.ts` | maybePromoteHandoff + contract (U0 / C1 / C5) U0: 'i want' with a complete profile stays |
| PASS | `src/server/receptionist/handoffContract.test.ts` | maybePromoteHandoff + contract (U0 / C1 / C5) C1 empty profile: weight loss stays needs_info |
| PASS | `src/server/receptionist/handoffContract.test.ts` | maybePromoteHandoff + contract (U0 / C1 / C5) C1b: weight_loss + complete demographics promotes to health_coach |
| PASS | `src/server/receptionist/handoffContract.test.ts` | maybePromoteHandoff + contract (U0 / C1 / C5) Existing user with complete profile sending bare 'I want to loose weight' stays |
| PASS | `src/server/receptionist/handoffContract.test.ts` | maybePromoteHandoff + contract (U0 / C1 / C5) C5: disambiguation is not auto-promoted even with complete demographics |
| PASS | `src/server/receptionist/handoffContract.test.ts` | maybePromoteHandoff + contract (U0 / C1 / C5) does not rewrite general_receptionist to health_coach just because demographics exist |
| PASS | `src/server/receptionist/handoffContract.test.ts` | formatReceptionistInput & Context Anchors formats system_anchors, active_biomarkers, foodLogs, and attached images cleanly |
| PASS | `src/server/receptionist/handoffContract.test.ts` | compactUserMemory & Active Consolidation caps keyInsights |
| PASS | `src/server/receptionist/handoffContract.test.ts` | compactUserMemory & Active Consolidation caps workHistoryLog |
| PASS | `src/server/receptionist/handoffContract.test.ts` | S-6 HANDOFF_I18N — UC-02 vitality turns drive the contract UC-02 turn 1 (vague wellness ask, new user) stays needs_info with demographic gaps |
| PASS | `src/server/receptionist/handoffContract.test.ts` | S-6 HANDOFF_I18N — UC-02 vitality turns drive the contract UC-02 turn 2 (complete vitality snapshot) hands off to health_coach |
| PASS | `src/server/receptionist/handoffContract.test.ts` | S-6 HANDOFF_I18N — UC-02 vitality turns drive the contract coach handoff ack follows profile language (en vs id) |
| PASS | `src/server/receptionist/handoffContract.test.ts` | S-6 HANDOFF_I18N — UC-02 vitality turns drive the contract meal-photo and lab-report acks follow profile language |
| PASS | `src/server/receptionist/jsonSanitize.test.ts` | sanitizeReceptionistJson repairs runaway weightKg decimals so JSON.parse succeeds |
| PASS | `src/server/receptionist/jsonSanitize.test.ts` | sanitizeReceptionistJson repairs truncated JSON cut off inside a string literal |
| PASS | `src/server/receptionist/jsonSanitize.test.ts` | sanitizeReceptionistJson repairs truncated JSON cut off |

### Compare (47)

| Status | File | Test |
|---|---|---|
| PASS | `src/utils/compareMealLogGuard.test.ts` | isCompareOnlyResult (Mode D meal boundary) flags evaluation+comparison results as never-a-meal |
| PASS | `src/utils/compareMealLogGuard.test.ts` | isCompareOnlyResult (Mode D meal boundary) passes meal modes through (new_log / modify / portion_clarify) |
| PASS | `src/utils/compareMealLogGuard.test.ts` | isCompareOnlyResult (Mode D meal boundary) requires BOTH evaluation mode and a comparison object |
| PASS | `src/server/food/journeyFingerprints.test.ts` | journey fingerprints (log vs compare; nutrition targets) standing.json Guard script exits 0 |
| PASS | `src/server/food/journeyFingerprints.test.ts` | journey fingerprints (log vs compare; nutrition targets) compare instruction is not the meal-log instruction |
| PASS | `src/server/food/journeyFingerprints.test.ts` | journey fingerprints (log vs compare; nutrition targets) compare schema is not the meal-log schema |
| PASS | `src/server/food/journeyFingerprints.test.ts` | journey fingerprints (log vs compare; nutrition targets) diet router keeps compare on PRODUCT EVALUATION |
| PASS | `src/server/food/journeyFingerprints.test.ts` | journey fingerprints (log vs compare; nutrition targets) live scout call for compare does not silently use the log pack |
| PASS | `src/server/food/journeyFingerprints.test.ts` | journey fingerprints (log vs compare; nutrition targets) production run files pass assembled instruction (targets) into runScoutRetryLoop |
| PASS | `src/server/food/server_food_scout_source.test.ts` | F-8.10 shard 9 — scout item sourcing inherits finalized items from the active meal for edits |
| PASS | `src/server/food/server_food_scout_source.test.ts` | F-8.10 shard 9 — scout item sourcing passes through when not a modify session or nothing to inherit |
| PASS | `src/server/food/server_food_scout_source.test.ts` | F-8.10 shard 9 — scout item sourcing maps compare names to scout rows |
| PASS | `src/server/food/server_food_scout_source.test.ts` | F-8.10 shard 9 — scout item sourcing resolves prior scout across body, meal, and history fallbacks |
| PASS | `src/server/food/server_food_scout_source.test.ts` | F-8.10 shard 9 — scout schema invariants requires identity, weight, method, box, foods, and dish nutrients |
| PASS | `src/server/food/server_food_scout_source.test.ts` | F-8.10 shard 10 — scout-prep seams purges OCR duplicates of bracket items and stamps fallback nutrients |
| PASS | `src/server/food/server_food_scout_source.test.ts` | F-8.10 shard 10 — scout-prep seams injects catalog tags once and infers packaged chains |
| PASS | `src/server/food/server_food_scout_source.test.ts` | F-8.10 shard 10 — scout-prep seams maps text queries with cooking-method sniffing |
| PASS | `src/server/food/server_food_scout_source.test.ts` | F-8.10 shard 11 — scout result handling classifies dead scout runs into quota/503/corrupt/generic errors |
| PASS | `src/server/food/server_food_scout_source.test.ts` | F-8.10 shard 11 — scout result handling applies scout state with source defaulting and mode overrides |
| PASS | `src/server/food/server_food_scout_source.test.ts` | F-8.10 shard 11 — scout result handling merges fresh dishes behind existing meal items with index offset |
| PASS | `src/server/food/server_food_scout_source.test.ts` | F-8.10 shard 11 — scout result handling logs per-item summaries with label and flag chrome |
| PASS | `src/server/food/server_food_scout_source.test.ts` | F-8.10 shard 11 — scout result handling summarizes model perImage rows and flags zero-coverage images |
| PASS | `src/server/food/server_food_scout_source.test.ts` | F-8.10 shard 11 — scout result handling derives coverage from dishes when the model omits perImage |
| PASS | `src/server/food/server_food_scout_source.test.ts` | F-8.10 shard 11 — scout result handling logs no WARN when every image is grounded |
| PASS | `src/server/food/server_food_scout_source.test.ts` | F-8.10 shard 11 — scout result handling flags perImage names that match no emitted dish (looked-and-declined) |
| PASS | `src/server/food/server_food_scout_source.test.ts` | F-8.10 shard 11 — scout result handling matches variant names to dishes without noise |
| PASS | `src/server/food/server_food_scout_source.test.ts` | F-8.10 shard 11 — scout result handling stays silent when the index anchors the row despite wobbling names |
| PASS | `src/server/food/server_food_scout_source.test.ts` | F-8.10 shard 16 — shortcut chain seams reuses prior scout with portion choices or refine grams |
| PASS | `src/server/food/server_food_scout_source.test.ts` | F-8.10 shard 16 — shortcut chain seams restores turn-1 candidates into the match stores |
| PASS | `src/server/food/server_food_scout_source.test.ts` | F-8.10 shard 16 — shortcut chain seams backs off longer on 503/UNAVAILABLE than other failures |
| PASS | `src/server/food/server_food_scout_source.test.ts` | F-8.10 shard 17 — skipScout shortcut inherits prior scout with portion choices and dining env |
| PASS | `src/server/food/server_food_scout_source.test.ts` | F-8.10 shard 17 — skipScout shortcut falls back to prior-scout dining when the body has none |
| PASS | `src/server/food/server_food_scout_source.test.ts` | F-8.10 shard 20 — resumed-turn predicate detects continued image turns across payload shapes |
| PASS | `src/server/food/server_food_scout_source.test.ts` | F-8.10 shard 22 — text-query branch and menu-scale rule seeds scout items for food text, stays quiet in edit flows |
| PASS | `src/server/food/server_food_scout_source.test.ts` | F-8.10 shard 22 — text-query branch and menu-scale rule skips search only for true browse mode, never for new_log dishes |
| PASS | `src/server/food/server_food_scout_source.test.ts` | F-8.10 shard 25 — scout call args pins flash-lite defaults with the scout language block and schema |
| PASS | `src/server/food/server_food_scout_source.test.ts` | F-8.10 shard 25 — scout call args compare uses the compare pack and schema, not the meal-log pack |
| PASS | `src/server/food/server_food_scout_source.test.ts` | F-8.10 shard 25 — scout call args passes assembled nutrition targets into the live LLM call, not only debug |
| PASS | `src/server/food/server_food_scout_source.test.ts` | F-8.10 shard 29 — scout retry loop (stubbed LLM) succeeds first try without sleeping |
| PASS | `src/server/food/server_food_scout_source.test.ts` | F-8.10 shard 29 — scout retry loop (stubbed LLM) retries once on failure, then succeeds |
| PASS | `src/server/food/server_food_scout_source.test.ts` | F-8.10 shard 29 — scout retry loop (stubbed LLM) backs off longer on 503 and aborts early on quota errors |
| PASS | `src/server/food/server_food_scout_source.test.ts` | F-8.10 shard 29 — scout retry loop (stubbed LLM) passes the stream hook through to the LLM call |
| PASS | `src/server/food/server_food_scout_source.test.ts` | Turn 2 Portion Selection — multi-dish preservation preserves non-selected items when user chooses portion for one dish |
| PASS | `src/server/food/server_food_scout_source.test.ts` | Turn 2 Portion Selection — multi-dish preservation restores Turn 1 candidates into databaseMatchesArray and dbMatchMap |
| PASS | `src/server/food/server_food_scout_source.test.ts` | Turn 2 Portion Selection — multi-dish preservation countCompareExtracted totals zero only when every compare evidence list is empty |
| PASS | `src/server/food/server_food_scout_source.test.ts` | Turn 2 Portion Selection — multi-dish preservation applyScoutResultState promotes allExtractedDishes when compare items is empty (Mode D heal) |
| PASS | `src/server/food/server_food_scout_source.test.ts` | Turn 2 Portion Selection — multi-dish preservation applyScoutResultState leaves populated compare items untouched (heal is empty-only) |

## i18n t() keys missing from packs (complete)

_none_
## Notes

- Named gates only. Playwright live specs are not in this dump (quota).
- Localization uses frozen `instruction/i18n/REQUIRED_CHROME.json` parsed from `translations.ts` text. Parity-only cannot pass.
- `tests/golden_biomarker.test.ts` skips and any Localization skip are scored FAIL.
- Regenerating this file is the only refresh. Do not edit it to look green.
