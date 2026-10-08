# Data plane — one SQL, Firebase Auth, R2 blobs

**Status:** D-0, D-1, D-2, and D-9 are done. **Decision 2026-10-09: keep D1.** D-3, the D-4 VPS re-run, and D-5…D-8 are cleared. D-10 (R2 orphan delete) waits for an explicit go. Muse storage audit stays input: [R2_STORAGE_AUDIT.md](./R2_STORAGE_AUDIT.md) + [R2_DELETE_CANDIDATES.json](./R2_DELETE_CANDIDATES.json).  
**Execute index:** [ROADMAP.md](./ROADMAP.md) **Track D**. Supersedes parked **R-5** (“investigate D1 as primary”).  
**Do not:** dual-write D1 + disk SQLite; install SQLite; buy Workers Paid for this app; revive Postgres/Supabase for identity; drop Firebase Auth; put photos in SQLite; mix a D-10 delete with F-13; **pay to unpause Supabase**; **run `R2_DELETE_CANDIDATES.json` without an explicit go**.

---

## Destination (keep D1, 2026-10-09)

One identity, one object store, **one** SQL. Not three databases.

```text
Browser ── Google Sign-In ──► Firebase Auth     (identity only; firebase_uid on rows)
       └── SPA + local cache (IndexedDB / localStorage)

Node origin (OVH VPS-2, https://health-tracker.co.uk)
       ├── Gemini              meal / medical vision
       ├── Cloudflare R2       photos, debug JSON, job blobs
       └── D1 via HTTP         ← source of truth. SQLite branch cleared 2026-10-09.
```

| Layer | Keep | Drop / do not add |
|---|---|---|
| Identity | Firebase Auth (Google popup, `verifyIdToken`) | Supabase Auth, D1 passwords, a second OAuth stack |
| Blobs | R2 (`photos/…`, job JSON) | Base64 in SQL; `r2.dev` as the long-term public CDN |
| SQL | **D1 today** (`food_logs`, `biomarker_logs`, `profiles`, `agent_jobs`, …) | Live Supabase Postgres; Firestore app rows; a second live SQL |
| Jobs | In-memory maps on **one** Node process; thin D1 status | Durable Objects / Workers analyze; two Node workers sharing Maps |

Live facts (read-only, 2026-09-20, before D-1): D1 held 176 `food_logs`, 40 `biomarker_logs`, 27 `profiles`, 26 `agent_jobs`, 127 `food_items`. Browser `isSupabaseConfigured = false`. Firestore app writes already off (M23/M24). **D1 is the live writer.** D-1 completed 2026-09-25 (see the recovery log). Do not probe Supabase again to finish D-1.

---

## Why SQLite is not on the execute path

**Cleared 2026-10-09.** The decision is keep D1. The Mac numbers below are history. Do not re-run them from the VPS and do not start a SQLite benchmark.

Mac → live D1 (WEUR / LHR) on 2026-09-20:

| Call | Wall p50 | Wall p90 | SQL `meta.duration` |
|---|---|---|---|
| `SELECT 1` / `COUNT` / 20-row list / job write | **270–300 ms** | **340–460 ms** | **0.2–1 ms** |
| 50-row list (`nutrients` + `image_urls`) | **338 ms** | **888 ms** | ~1–2 ms |
| 5 queries **sequential** | **1531 ms** | 2146 ms | — |
| 5 queries **parallel** (`d1PullSync` already does this) | **327 ms** | 607 ms | — |

The 200 ms figure was the right order of magnitude and slightly optimistic from SEA. SQL is not the wait; HTTP to London is.

**Decision (D-6), 2026-10-09: keep D1.** The old VPS timing rule is retired with D-5. Meal analyze (~8 s Gemini) is not a reason to reopen SQLite.

---

## Phases and milestones

### Phase 0 — Record the truth (no app rewrite)

| ID | What | Done when | Do not |
|---|---|---|---|
| **D-0** | This file + Track D on [ROADMAP.md](./ROADMAP.md). SoT = Firebase Auth + D1 + R2. R-5 marked superseded (D1 is already primary). Muse audit indexed (below). | Agents read this file instead of “stay on Supabase” / “D1 parked”. | Treating Muse “backfill from Supabase first” as runnable **while REST is still 402** |
| **D-1** | **Unpaid recovery window.** Human expects the 402 to lift around **2026-09-24** (quota/egress reset, **no extra bill**). Probe REST. If 200: dump IDs (`food_logs`, `biomarker_logs`, `profiles`, `agent_jobs`, `food_items`, …), diff vs D1, **insert missing rows only**, store the dump under R2 `backlogs/supabase-recovery-YYYY-MM-DD/`. If still 402: park and retry later — recovery stays open. | Dated note in this file: unlock date, gap counts (0 is a valid result), dump key. Or “still 402, retry after DATE”. | Paying to unpause; dual-writing new rows to Postgres; deleting the Supabase **project**; running [R2_DELETE_CANDIDATES.json](./R2_DELETE_CANDIDATES.json) |

### Phase 1 — One live SQL (still D1)

Do **not** mix with Track V Phase 4 or F-13.

| ID | What | Done when | Do not |
|---|---|---|---|
| **D-2** | Drain dead Supabase **code** (`supabaseAdmin`, `SupabaseJobSync`, `/api/sync/supabase-*` names that already hit D1, env copy as SoT). Locked packet, extract-only. **Keep the remote project** until D-1 PASS or human abandon-recovery. | `isD1Configured()` is the only SQL path in production; no 402 calls; named gates green; Supabase dashboard project still exists. | New Postgres; swapping Auth to cut vendor count; editing `src/types.ts`; deleting the project; treating code drain as “recovery done” |
| **D-3** | **CLEARED 2026-10-09.** Workers Paid is not a roadmap item. | — | Buying Workers Paid for this app |
| **D-4** | Mac timing row stands (below). The required VPS re-run is **CLEARED 2026-10-09.** | The 2026-09-20 Mac row. | A new VPS latency project |

**Mac baseline (D-4, 2026-09-20):** D1 `served_by_region=WEUR` colo LHR; SQL 0.2–1 ms; wall p50 ~270–300 ms from this Mac; fat 50-row p90 888 ms. Probe row `_d1_latency_probe` deleted.

### Muse storage audit (2026-09-20) — accepted input, not execute

Source: [R2_STORAGE_AUDIT.md](./R2_STORAGE_AUDIT.md) (`10a7061`, `6e5e5b4`; Muse Spark via OpenCode, read-only) and companion [R2_DELETE_CANDIDATES.json](./R2_DELETE_CANDIDATES.json) (unexecuted list). Do not treat the JSON as a delete job.

| Finding | Number | Plan consequence |
|---|---|---|
| Live SQL | D1 only. The 2026-09-20 Supabase 402 is history | D-1 DONE 2026-09-25. D-2 DONE. Do not reopen either |
| D1 rows | 176 food_logs, 40 biomarker_logs, 27 profiles, 26 agent_jobs | 27 profiles flagged as per-login dupes — hygiene later, not D-1 |
| `source_meal_id` | Present in D1; Supabase migration file cannot apply while 402 | Keep the migration file until D-1 then delete it with D-2 leftovers |
| R2 bucket | 6,475 objects, **~1.09 GB** (`photos/` 540 MB) | Cost is tiny; size/hygiene is the issue |
| Photos vs D1 | 197 distinct keys referenced; **0** dangling food_log links; **2,393 orphans (~525 MB)** | Do **not** bulk-delete until D-1 (a Supabase-only row could still point at an “orphan”) |
| Duplicate photos | 325 MD5 groups, 2,063 objects (~80% of `photos/`); ~440 MB wasted; 589 `_0.jpg` twins | Uploader re-PUTs the same bytes per job, twice. Stop the leak (D-9) before sweeping (D-10) |
| JSON vs prose | JSON `missing_referenced_absent` lists 2 `photos/job_…` keys (one string has a stray backslash) | Re-check those two at D-10; do not delete from a broken list |
| Delete list | `tier1_delete` 96, `tier2_groups` 287, `tier3_hold` 388 | Execute only as **D-10** after D-1 |

Audit recommendations mapped:

1. Compare Supabase when it is readable → **D-1** (unpaid).
2. Stop photo regrowth (content-hash reuse on PUT; no base+`_0` twin) → **D-9**.
3. Delete-cascade / tombstone sweeper + retention on `debug/` `logs/` `jobs/` `bugs/` + apply the candidate list → **D-10**, after D-1.

### Phase 1b — R2 hygiene (from the Muse audit)

Do **not** mix with F-13. D-9 is code-only. D-10 is deletes.

| ID | What | Done when | Do not |
|---|---|---|---|
| **D-9** | Stop R2 photo **regrowth**: content-hash check on the PUT path (`server_routes_r2.ts`) reuse existing key on ETag/MD5 match; stop writing `key` **and** `key_0` twins. Locked packet. **No object deletes.** | **DONE** (`cf19075`) — CAS bypasses killed, deduplicated logging active, 7/7 contract tests green. | Applying [R2_DELETE_CANDIDATES.json](./R2_DELETE_CANDIDATES.json); rewriting historical `image_urls` |
| **D-10** | D-1 is done. Still off the execute list until an explicit go: re-run the audit; fix the two `missing_referenced_absent` keys; then (a) apply the candidate list with a 30-day grace for remaining orphans, (b) meal-photo delete-cascade or tombstone sweeper, (c) retention on `debug/` + `logs/` + `jobs/` + `bugs/`. | Audit re-run: duplicate groups → 0 or residual named; dump in R2. | Deleting without an explicit go; deleting keys still referenced by D1 or the recovered dump; emptying `golden/` |

### Phase 2 and Phase 3 — cleared 2026-10-09

D-5, D-6, D-7, and D-8 are not work. The decision is keep D1. Do not install `better-sqlite3`. Do not add Litestream. Do not freeze D1.

---

## Scale notes

100 registered users is still D1 + VPS-2 while Gemini is billed and agents are not compiling at lunch. 1000 users fails on **Gemini 429 / spend**, **photo proxy through Node**, **D1 Client API 1200/5 min**, and **mixing a compiler with `sharp`**. Workers Paid and a SQLite move are not the answer on this roadmap.

**D1 does not serve the SPA if the VPS is down.**

---

## Invariants

1. **One SQL writer.** Dual-write is how Firestore + Supabase + D1 already split. Do not add a fourth.
2. **Firebase Auth stays** until a dedicated identity packet. `firebase_uid` is the row key.
3. **R2 stays** for blobs. SQL holds URLs and thin JSON.
4. **Track V copies D1 env onto the VM.** Supabase env is leftover, not a cutover safety net after D-2. The **project** stays until D-1.
5. **Do not install SQLite.** D-5…D-8 were cleared on 2026-10-09. A labeled probe that is deleted (as `_d1_latency_probe` was) is the only kind of extra write this file allows.
6. Same working-tree rule as Track V: not with F-13 / Q-11 leftovers.
7. **D-1 is recovery, not a paid dump.** Probe around 2026-09-24; if 402, retry later. Do not pay. Do not declare D1 “complete” until that probe (or a later retry) has a dated result.
8. **Do not execute the Muse delete list until D-10.** D-9 may only stop new duplicates.

---

## D-1 recovery log (empty until the 402 lifts)

```text
Date probed: 2026-09-20 10:50 UTC
REST status: HTTP 402 Payment Required (exceed_egress_quota)
Gap food_logs / biomarker_logs / profiles / agent_jobs / food_items: [unreachable]
Dump R2 key: none
Follow-up: retry ~2026-09-24 when quota reset window opens
```

```text
Date probed: 2026-09-24 (agent probe from VPS, food_logs + profiles)
REST status: HTTP 402 Payment Required — still locked
Gap food_logs / biomarker_logs / profiles / agent_jobs / food_items: [unreachable]
Dump R2 key: none
Follow-up: D-1 stays parked; retry on next quota window. Do not pay.
```

```text
Date probed: 2026-09-25 (VPS-2, scripts/d1-supabase-recovery.mjs — the D-1 runner)
REST status: HTTP 200 — 402 LIFTED (quota reset; no payment made)
Diffs (Supabase → D1, by PK): food_logs 316→193 (missing 172) · biomarker_logs 28→40 (missing 13) ·
  profiles 8→30 (missing 5) · agent_jobs 7→35 (missing 7) · food_items 453→127 (missing 453, inserted 422)
Inserted (missing-only, INSERT OR IGNORE, idempotent): 197 rows · verified stillMissing/unaccounted = 0 on re-run
By-design key skips: 31 food_items whose food_key already exists in D1 under canonical_* ids (D1 dedup) —
  skipped is CORRECT: all 453 Supabase food_items rows have nutrients_per_100g = "[object Object]" (legacy
  writer bug) and 409/453 lowercase display_name; D1's canonical rows carry real JSON macros. No data lost.
Dump R2 key: backlogs/supabase-recovery-2026-09-25/{food_logs,biomarker_logs,profiles,agent_jobs,food_items,summary}.json
Follow-up: D-1 recovery COMPLETE (insert-missing-only per packet; no payments, no updates/deletes, project kept).
  Sensor: scripts/d1-supabase-recovery.test.mjs (8 tests). Non-diffable dump-only cols: food_items.parent_id/locked.
```

## Decision

```text
Date: 2026-10-09
Choice: keep D1
Cleared with this choice: D-3, D-4 VPS re-run, D-5, D-6, D-7, D-8
```
