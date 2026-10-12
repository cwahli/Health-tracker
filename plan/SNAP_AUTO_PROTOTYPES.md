# Snap auto-ingest prototypes — UNDECIDED (not in Current work)

Status: **potential prototype work, undecided. Do not execute without a human go.**
This file is **not** a pillar, **not** a track, carries **no ID**, and is **not**
part of `ROADMAP.md` Current work. Locked `specs/active/` packets stay the only
pre-approved go. No agent starts anything below on `continue` / `work on the roadmap`.

Setting assumed (2026-10-12): single Android daily driver, Google Photos backup
ON, Yandex Disk auto-upload ON, high shutter volume, most photos NOT food.
Load-bearing requirement is **triage**: only food candidates may reach the
server vision path (`POST /api/jobs/submit` -> scout `gemini-3.5-flash-lite` ->
R2 CAS). Server vision on every photo = cost + latency + noise. Dedupe by
content hash (existing R2 `photos/sha256_<hash>.jpg` pattern).

Why Google cannot be the auto source: Library API is app-created-only since
2026-03-31 (`photoslibrary.readonly` / `photoslibrary` / `photoslibrary.sharing`
removed). Full-library auto-pull returns 403. Picker API is per-meal tap only.
Yandex Disk REST API still lists + downloads Camera Uploads via OAuth (polling,
no webhook) — usable as cloud auto source.

Two-stage triage assumed everywhere below: stage 1 food-vs-not (cheap, ideally
on-device), stage 2 dish/portion/nutrients on server. Pending tray with
confirm/discard + tap-to-correct boxes on top.

## Ranked most convenient long-term day-to-day -> least (this setting)

### P1 — Micro bridge app with on-device triage (best day-to-day)
`MediaStore` observer watches DCIM regardless of Google/Yandex backup. Tiny
on-device food-vs-not gate, uploads only candidates to site ingest with user
token. Offline queue, push "lunch logged".
Day-to-day: shoot normally, food appears as pending. Minimal noise, minimal
server cost, fastest review.
Cost: new native binary + Play photo-access review + maintenance. Upfront heavy,
daily lightest.

### P2 — Yandex Disk folder poll + server triage (best no-new-app)
Server polls Yandex Camera Uploads on a cursor (OAuth, polling loop), downloads
new files, runs cheap food gate first, feeds candidates to existing analyze
path. Poll Yandex only (not Google too) to avoid doubles.
Day-to-day: zero new app, fits existing Yandex auto-upload. Delayed minutes,
all photos transit Yandex -> server, server pays triage on every shot.
Fallback if user refuses any install. Google stays manual-pick source only.

### P2b — Drive inbox poll + server triage (SETUP PLAN, still undecided)
Goal: every phone shot lands in Drive `Meals-inbox` via FolderSync; server
polls that one folder, triages, and only food candidates reach the analyze
path. Photos backup stays ON for memories — it is not the ingest source.
Non-goals: no Photos<->Drive mirroring (double quota, no native sync), no
two-way sync, no whole-library scan.

Phone (one-time, ~15 min):
1. Install FolderSync, add Google Drive account (same account with the large
   storage).
2. New folder-pair: left = DCIM/Camera on device, right = Drive
   `/Meals-inbox`. Type one-way left-to-right, deletion OFF, overwrite on
   conflict by newer modified-time. Spike filters: `*.jpg *.jpeg *.png *.webp`
   only — NO heic, NO video for the spike (HEIC convert is Phase 4). Skip
   screenshots/DCIM subfolders if noisy.
3. Schedule: on Wi-Fi + charging for spike (later: every 2 h). Allow
   background, disable battery optimization for FolderSync. Keep Photos backup
   ON unchanged.
4. Test: take 2 photos, force sync once, confirm both appear in Drive
   `/Meals-inbox` within minutes.

Drive (one-time):
1. Create `/Meals-inbox` only. Do NOT enable any Photos sync into Drive, do
   NOT copy Photos library into it. One source only or hashes double up.
2. Quota gate BEFORE enabling the pair: Google One manager — Photos + Drive +
   Gmail share one pool. Full-DCIM rollout requires 5 GB free to start; stop
   rule: pause the pair below 2 GB free (over-quota blocks uploads AND Photos
   backup together). The 30-image test-folder spike needs ~100 MB.
3. Backlog guard: record setup timestamp T0 BEFORE enabling the pair. A full
   DCIM pair bulk-uploads years of camera history — server ignores every
   file with `createdTime` < T0. Spike cap (agreed 2026-10-12): 30-image
   test-folder-first — the pair points at a folder holding 30 mixed shots
   (needs ~100 MB, not GB); full-DCIM rollout stays gated behind spike pass. Inbox holds originals only until triaged; spike does NOT
   delete (read-only scope) — purge is Phase 4 with elevated scope.

Server spike (no app code yet, script-level, DRY-RUN: log-only, no real
`POST /api/jobs/submit` jobs until Phase 3 packet):
1. OAuth client (web), scope `drive.readonly` only. Store per-user refresh
   token. Record `startPageToken` AND T0 at connect time.
2. Poll loop every 5 min: `changes.list` from saved token (persist newest
   token per user), else `files.list q="<inbox-id> in parents and
   trashed=false and createdTime > T0" fields="files(id,name,mimeType,createdTime,modifiedTime,md5Checksum,size),nextPageToken"`.
   Skip non-image `mimeType`; skip entries with no `md5Checksum`.
3. Dedupe: `md5Checksum` is a pre-filter only — it never matches R2
   `photos/sha256_<hash>.jpg` directly. Download bytes, compute SHA-256
   locally, keep a driveId->sha256 map; skip hashes already in CAS.
   Never re-analyze a hash.
4. Triage stage 1 (cheap, before scout): downscale thumb -> food-vs-not gate;
   mark non-food as processed in the map, leave the Drive file alone
   (read-only cannot delete/trash/move — purge needs restricted `drive` scope
   + verification, deferred to Phase 4). Only candidates proceed to a scout
   DRY-RUN log (no job creation in the spike).
5. Surface (spike): write candidate list + thumbs to a local report, no
   pending tray yet (tray is Phase 3 packet work). Non-food never reaches
   scout even in dry-run.
6. Privacy: inbox OAuth is read-only in the spike; full bytes downloaded only
   for dedupe+gate, thumbs kept for the report, all purged at spike end.
   State it in-app before connect. Quota monitor runs during the spike (free
   GB logged each poll), not deferred.

Spike gates (30 test-folder shots, mostly non-food; timing measured Drive-arrival
-> report, NOT shutter -> report — FolderSync scheduling is coarse and
battery-gated, so shutter-to-inbox is excluded): median arrival-to-report
<10 min on Wi-Fi with a manual "Sync now" for the test; non-food leak to
scout dry-run <30%; zero missed real meals in the 20; vision cost per 100
shots projected; quota never breached. Kill: misses meals, or leak/cost
above line — then P1 bridge wins and P2b stops.
Failure modes to log: FolderSync killed by battery saver (dontkillmyapp
steps), modified-time conflicts, token expiry, over-quota stall, missing
md5 entries skipped.

Spike evidence 2026-10-12 (30 real images, Drive inbox `Meals-inbox`):
seeded 16 golden meal JPEGs + 13 phone screenshots + 1 PXL camera photo via
server-side copy (zero bytes moved); polled via Drive search (= `files.list`
path), downloaded 30/30 with 0 errors (21.5 MB); harness ingested 30/30 with
sha256 recorded, 0 duplicates (distinct seeds; dedupe proven separately on
fixtures: 33 in -> 30 stored + 3 duplicates caught). Contact-sheet viewed and
labeled 30/30: 17 meal (incl. the PXL, an oatmeal pot) / 13 not-food. Leak
and miss vs the food-gate stay unmeasured — gate is still a stub; that is the
P1 decision input, not a pass. Remaining unreal legs: FolderSync phone leg
(human-only) and scout submit (Phase 3 packet).

### P3 — Source-separated Snap capture (pure web, sidesteps triage)
Site camera (`accept="image/*" capture="environment"`, existing
`LogChat.tsx` inputs) used for meals only; stock camera for everything else.
Meals never mix with the roll, so no triage needed.
Day-to-day: zero permissions/cloud, but requires habit change. Fails silently
when user forgets and uses stock camera. Cheap to build, medium convenience at
volume.

### P4 — FolderSync / Tasker automation -> ingest + server triage
Existing sync app mirrors DCIM to server/R2/webhook; server triages as in P2.
Day-to-day: no custom native code, but fragile setup, battery/background
kicks, per-device debugging, still full server-triage cost. Interim only.
Phone-agent variant (2026-10-12, no Play install): rclone upload leg driven
by mobile opencode from this repo — runbook `phone/PHONE_SETUP.md`, script
`phone/sync-photos.sh`, schedule via cron + Termux:Boot. Human taps reduced
to Termux install + one rclone OAuth consent + battery exemption.

### P5 — Manual share / curate (human triages)
Share Target / chat-bot forward of food shots only. Perfect precision, cheapest,
zero false positives.
Day-to-day: 1 tap per meal, tedious at volume. Accurate but least automatic.

### P6 — Pure-web background read (do not attempt)
No silent gallery enumeration exists: pickers need user gesture + secure
context, File Handling is desktop-only, Share Target is per-meal + no iOS
(and this user is Android-only anyway). Ranked last: impossible, will break.

## P2b roadmap — Drive as main cloud (phases, still UNDECIDED)
Rule: phases 0-2 are human + script-spike, no app code. Phase 3 touches the
job path (`LogChat.tsx` submit / App poller are L1 job-lifecycle files) so it
needs a normal locked packet with IMPACT + `JobSession` contract test — never
as a prototype shortcut. No phase starts without human go.

Phase 0 — prereqs (human, ~30 min): confirm the big-storage Drive account,
run Google One manager cleanup, require 5 GB free (stop below 2 GB). Yandex
camera upload OFF for the spike (single source rule). Photos backup stays ON,
Storage Saver if tight. Create Drive `/Meals-inbox` + `/Meals-kept` empty.
Record T0 before enabling any sync (backlog guard).

Phase 1 — phone live (human, ~15 min): FolderSync + Drive account, one-way
DCIM/Camera -> `/Meals-inbox`, deletion OFF, newer-wins, image filters, skip
video/screenshots for spike. Schedule Wi-Fi+charging, background allowed,
battery optimization off. Gate: 2 test photos appear in inbox within minutes.

Phase 2 — server spike (script-level, DRY-RUN, read-only, no app code): OAuth
`drive.readonly`, per-user refresh token, saved page token + T0 filter. 5-min
poll, new post-T0 IDs only, sha256-on-download dedupe, thumb food-gate first,
scout dry-run log only (no real jobs). Quota monitor runs in the spike.
Gate on 30 test-folder shots: arrival-to-report <10 min median, leak <30%, zero
missed meals, cost/100 projected. Kill line: miss meals or breach leak/cost —
P1 bridge wins, P2b stops. Purge/HEIC-convert need elevated scope + build —
Phase 4, never the spike.

Phase 3 — product wiring: Drive meals auto-added + analyzed in the user
account (locked packet only, NOT prototype shortcut). One pipeline only (L9):
every step below reuses the manual path, no second pipeline.
1. Ingest event: poller emits `{driveFileId, sha256, md5, createdTime}` for
   triage-passed candidates ONLY. Non-food never leaves the processed-map.
2. Auto-submit under user identity: server submits through the same path as
   `LogChat.tsx:2598-2676` (`POST /api/jobs/submit` with `{jobId, text,
   images:[base64], imageDates, engine:'gemini-3.5-flash-lite'}`), acting as
   the linked user (Drive OAuth linkage maps to app UID), tagged
   `source:"drive-inbox"` + driveFileId for traceability. No anonymous jobs.
3. Analyze: `server_food_analyze_run.ts` phases unchanged (scout -> precalc ->
   compose -> finalize); `server_vision_scout.ts` schema yields
   dishes/foods/nutrients; `buildNewLogResponse` yields `pendingFoodLog`.
4. Deliver to account: job result surfaces exactly like a manual log — chat
   thread message carrying `pendingFoodLog` (cf. `LogChat.tsx:958-1000`
   pending detection, R2 URL patch-up `LogChat.tsx:2690`) + pending tray
   entry with confirm/discard + tap-to-correct (`boundingBox2D`).
5. Save rule (default): confirm-to-save. Confirm writes the food log to the
   user's Firestore history, same as manual. Zero-tap auto-save is a
   per-user opt-in AFTER spike gates pass — never the default.
6. Idempotency: driveId->sha256->jobId map. Same hash re-synced (FolderSync
   re-upload, Yandex overlap) links to the existing job, never re-analyzes.
7. Failures: scout 429/503 uses the existing retry/fallback chain; poller
   errors back off + stale-sync watchdog; over-quota pauses the poller with
   notice, never silent drops.
L1/IMPACT: touches submit callers, JobStore/poller, LogChat pending display,
FoodHistoryTab save — locked packet + `JobSession.contract.test.ts` in the
same commit + named vitest + `tsc` (L10/L11). Plus TTL purge, in-app privacy
copy before OAuth connect.

Phase 4 — harden IF picked: 2-hour schedule + stale-sync watchdog alert,
failure log (battery kills, token expiry, over-quota stops everything),
quota monitor permanent, HEIC convert path, inbox purge via restricted
`drive` scope + verification (security assessment if server-stored), Yandex
stays cold backup or resumes only as backup-never-ingest.

## Suggested prototype order IF human says go (not a promise)
1. Spike P2 on 20 mixed photos: Yandex poll latency, triage precision, vision
   cost per 100 shots. Kill criteria: >5 min median or >30% non-food leak.
2. Spike P1 food gate on-device (small classifier, mid Android): precision /
   recall on same 20 + battery. Kill criteria: misses real meals.
3. Only then pick P1 vs P2 for build. P3 snap-mode can ship independently as
   baseline regardless.

Receipt: filed 2026-10-12 per user request. No code touched, no gates run.
2026-10-12: P2b expanded end-to-end (auto-submit under user identity ->
analyze -> pending tray -> confirm-to-save, auto-save opt-in only) on
branch `agent/snap-drive`, draft PR for review. Phases 0-2 still need human
go; Phase 3 still needs a locked packet.
