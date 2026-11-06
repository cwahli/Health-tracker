---
id: job-upload-self-heal
status: draft
skill: sync-jobs
edit_mode: patch
allowed_files:
  - src/jobs/JobQueueRunner.ts
  - src/hooks/useJobRuntime.ts
  - src/jobs/jobUploadState.ts
  - src/components/TaskPlaceholderCard.tsx
  - src/jobs/__tests__/JobSession.contract.test.ts
  - src/jobs/__tests__/JobQueueRunner.test.ts
  - src/jobs/__tests__/jobUploadState.test.ts
frozen_files:
  - src/App.tsx
  - src/components/LogChat.tsx
  - server_vision_scout.ts
  - prototype/meallog/compare/scout_only_compare_instructions.ts
  - src/server/food/server_food_analyze_schema.ts
  - server_food_analyze_run.ts
  - server_food_analyze_run_scout.ts
  - src/server/food/server_food_scout_source.ts
  - AGENTS.md
  - docs/agent/standing.json
  - scripts/assert-standing.mjs
  - scripts/journey-guard.mjs
gate:
  - npx tsc --noEmit
  - npx vitest run src/jobs/__tests__/JobStore.test.ts src/jobs/__tests__/mergeFoodEditMessages.test.ts src/jobs/__tests__/JobSession.contract.test.ts src/jobs/__tests__/JobQueueRunner.test.ts src/jobs/__tests__/jobUploadState.test.ts
  - node scripts/assert-egress-bomb.mjs
  - node scripts/journey-guard.mjs job-upload-self-heal
---

# Packet: job-upload self-heal (stuck "Uploading to server… Keep this tab open")

Human replies: **go** | **stop** | one comment. Nothing below is applied yet.

## Journey

Better = a meal photo stuck at `Uploading to server… Keep this tab open` (screenshot: `1:12 elapsed`, `Attempt 1 of 3`, `1 running`) heals by itself: the client releases ownership after a bounded upload window, the background runner submits once from `ImageStore` and polls, and the card flips to `Uploaded • Safe to close` / `Analyzing on server...` with no manual Retry tap and no tab-close trick. Destination journey: **jobs** (submit + session + preview). Food log / compare math is untouched.

## Findings (do not redo — verified by reading, not guessing)

1. **Owner never releases.** `LogChat.tsx:2400,2419` sets `clientSubmitPending:true` + `Uploading to server… Keep this tab open`, then `getImagesAsBase64 + fetchSubmitWithRetry('/api/jobs/submit', 45s x4)` (`LogChat.tsx:2523,2606,2689`). Success flips to `Analyzing on server...` + `clientSubmitPending:false` (`LogChat.tsx:2723-2732`); failure flips to `Connection delayed; background runner retrying submit...` + `clientSubmitPending:false` (`LogChat.tsx:2736-2743`). At `1:12 elapsed` neither fired — the promise is still in-flight, so the job still reads `clientSubmitPending:true`.
2. **Runner defers to a hung owner.** `JobQueueRunner.ts:80-85` skips `clientSubmitPending` jobs younger than 20s. `useJobRuntime.ts:224-232` then treats the job as `clientOwnsSubmit` and sets `needsServerSubmit=false`, then `useJobRuntime.ts:366-373` waits up to 15s for `clientSubmitPending` to clear before polling a server job that was never created. That is the 72s+ stall in the screenshot.
3. **Images are already durable.** `LogChat.tsx:2095` does `ImageStore.putImages(currentJobId, finalImages)` before submit, and the runner resubmits from `ImageStore.getImages(job.id)` + `compressImage` (`useJobRuntime.ts:235-257`). A runner-side takeover therefore has the bytes; no `LogChat.tsx` edit is needed (ROADMAP Q-13 freezes `LogChat.tsx` — another agent owns it).
4. **UI already heals late, but manually.** `TaskPlaceholderCard.tsx:64` defines `elapsedIsLong >= 180s`; line 836 shows a manual `Retry` button that clears `clientSubmitPending:false` and wakes the runner. The user should not have to wait 3 min and tap.
5. **Safe-to-leave predicate is correct.** `jobUploadState.ts:11-16` returns false while `statusMessage` matches `/keep this tab/i`, so the amber `Uploading… Keep this tab open` banner (`TaskPlaceholderCard.tsx:639-643`) is the right signal to keep until `serverSubmittedAt` is confirmed by the runner path (`useJobRuntime.ts:357-363`).
6. **Rejected cache queried:** `specs/rejected/` holds `compare-learn-from-log`, `builder-ne-tester`, `allowance-hold`, `sheets-oauth`, `same-meal-package` — none burns a runner-takeover or upload-watchdog hypothesis. No pruned approach to avoid.

## Plan (procedural micro-node graph — execute in order, one node at a time)

### Node 1 — Bounded client ownership (runner-side watchdog; no LogChat edit)

- **File:** `src/jobs/JobQueueRunner.ts` (loop picker, ~lines 73-87).
- **Do:** before the 20s skip, compute upload age from `job.inFlightTurnAt || job.updatedAt`. If `clientSubmitPending` and age > 45s (one full submit timeout), `JobStore.apply({ type:'ServerStatus', id, clientSubmitPending:false, statusMessage:'Connection delayed; background runner retrying submit...' })` and let the normal runner path take the job on the next tick. Keep `inFlightTurnAt`, `currentTurn`, `attemptCount` untouched.
- **(Condition, Action, Pitfall):** (upload age > 45s AND still `clientSubmitPending`, release ownership, do NOT reset `inFlightTurnAt`/`currentTurn` or the turn looks like a new attempt and `STALE_TURN` guards misfire).
- **Gate:** new `JobSession.contract.test.ts` case: `clientSubmitPending:true` + `inFlightTurnAt = now-60s` → after watchdog tick, `clientSubmitPending:false`, `status` still `queued/running`, `currentTurn` unchanged.

### Node 2 — Single-owner runner submit (no double-POST)

- **File:** `src/hooks/useJobRuntime.ts` (executor submit preamble, ~lines 222-264).
- **Do:** keep the existing `clientOwnsSubmit` check, but after Node 1 it will be false for watchdog-released jobs, so `needsServerSubmit` becomes true exactly once. Add a guard: skip the submit if `serverSubmittedAt` is already set AND `statusMessage` no longer matches `/uploading|retrying submit|connection delayed/i` (prevents a second POST racing the in-flight LogChat promise that finally resolves).
- **(Condition, Action, Pitfall):** (watchdog released AND no `serverSubmittedAt`, submit once from ImageStore, do NOT reuse LogChat's base64 from memory — the tab may be throttled; ImageStore is the durable source. Standing `meal_image_unique` stays: dedupe stays in `foodImageSources`, no new URL scheme here).
- **Gate:** `JobQueueRunner.test.ts` case: released job with stubbed `ImageStore.getImages` submits once (mock fetch counts 1 POST), sets `serverSubmittedAt`, clears `resumeStage`.

### Node 3 — Card stops asking for tricks (auto-retry + honest banner)

- **File:** `src/components/TaskPlaceholderCard.tsx` (~lines 634-653, 836-856) + `src/jobs/jobUploadState.ts` (predicate only if needed).
- **Do:** when `elapsedIsLong` (>=180s) and job is still `queued/running` with an upload-flavoured `statusMessage`, auto-fire the same update the manual Retry button fires (`status:'queued'`, `attemptCount+1`, `clientSubmitPending:false`, `retryNotBefore:undefined`, `JobQueueRunner.wake()`) exactly once per attempt (guard on `attemptCount`/`maxAttempts=3`). Keep the manual button as fallback. Keep `isJobSafeToLeave` false until the runner confirms `serverSubmittedAt`.
- **(Condition, Action, Pitfall):** (elapsed >= 180s AND still upload-flavoured AND attempts < 3, auto-requeue once, do NOT auto-retry `awaiting_user`/`succeeded`/degraded-diet flows and do NOT bypass `retryNotBefore`. Standing `job_milestone_telemetry` stays: keep milestone `statusMessage` writes on the poll path. Standing `egress_conservation` stays: no new poll loop — reuse `JobQueueRunner.wake()`, poll only while `hasActiveJob`).
- **Gate:** `jobUploadState.test.ts` + contract test: 200s-old uploading job auto-requeues once, `awaiting_user` job never auto-retries; `assert-egress-bomb.mjs` still passes.

## Test plan

```text
npx tsc --noEmit
npx vitest run src/jobs/__tests__/JobStore.test.ts src/jobs/__tests__/mergeFoodEditMessages.test.ts src/jobs/__tests__/JobSession.contract.test.ts src/jobs/__tests__/JobQueueRunner.test.ts src/jobs/__tests__/jobUploadState.test.ts
node scripts/assert-egress-bomb.mjs
node scripts/journey-guard.mjs job-upload-self-heal
```

## Audit plan

1. Scope vs ROADMAP: jobs self-heal only. No food math, no scout/compare instruction, no `App.tsx`, no `LogChat.tsx`, no D1/Supabase schema, no new ROADMAP ID.
2. One frozen example: bottom card `Portion Choice Needed` (`awaiting_user`) still requires the human tap — auto-retry must never confirm a portion.
3. Honest residual: airplane-mode / 0-byte uploads still surface `Connection delayed` after 3 attempts; large-video payloads may still need Wi-Fi (name it, don't paint it).

## Blast radius

Allowed / Frozen are the YAML lists above. Out of scope: `LogChat.tsx` (ROADMAP Q-13 freeze), `App.tsx`, scout/compare instructions and schemas, `JobStore.ts` core merge laws, standing/guard scripts, any `server_*.ts` derive path.

## Stop and come back

Two repairs fail · Frozen file in the diff · New class appears (e.g. server 5xx storm vs client stall) · Live Gemini requested · `assert-egress-bomb` red.
