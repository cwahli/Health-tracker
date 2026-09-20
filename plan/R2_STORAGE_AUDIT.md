# Storage audit: D1 vs Supabase vs R2

**Date:** 2026-09-20 (UTC). **Auditor:** opencode agent (read-only queries only).
**Purpose:** Pre-cutover baseline for the VPS move. Is anything exclusively in
Supabase? Is R2 healthy? What can be deleted, and what must never be?

## 1. Database comparison

| Table | D1 `health-tracker` | Supabase | Notes |
|---|---|---|---|
| food_logs | 176 rows, latest 2026-09-19 | **unreachable (HTTP 402)** | D1 uids clean: 175× `hiJun2hTdDTk2igwerun2LKvwb42`, 1× other |
| biomarker_logs | 40 rows, latest 2026-09-17 | 402 | — |
| profiles | 27 rows, latest 2026-09-19 | 402 | 27 profile rows looks like per-login duplication; harmless, flagged |
| agent_jobs | 26 rows, latest 2026-09-20 | 402 | — |

- Supabase returns **402 even with the service-role key** → project-level
  pause/billing block, not RLS. Nothing can be read, migrated, or have
  migrations applied there until it is unpaused in the dashboard.
- Consequence: **all live traffic is already D1-only** (every Supabase branch
  errors out today). The cutover happened by accident; the code just still
  maintains both paths.
- `source_meal_id` column **present** in D1 (auto-migration on backend boot
  works). The Supabase migration file
  (`supabase/migrations/20260919_food_logs_source_meal_id.sql`) is committed
  but **cannot be applied while paused**.
- Open risk: any rows written **only** to Supabase (pre-D1 era?) are locked
  behind the pause. Unpause → compare → backfill → then delete code paths.
  Do NOT delete the Supabase project before that comparison.

## 2. R2 inventory (`health-tracker-photos`, 2026-09-20)

| Prefix | Objects | Size |
|---|---|---|
| photos/ | 2,590 | 540 MB |
| debug/ | 1,085 | 228 MB |
| jobs/ | 786 | 132 MB |
| bugs/ | 820 | 122 MB |
| logs/ | 1,015 | 35 MB |
| backlogs/ | 19 | 17 MB |
| golden/ | 160 | 10 MB |
| **Total** | **6,475** | **~1.09 GB** |

Range: oldest 2026-08-07, newest 2026-09-20 (still being written).

## 3. Cross-check: R2 `photos/` vs D1 `food_logs.image_urls`

Method: all 176 D1 rows' `image_urls` parsed; `/photos/<key>` and
`*.r2.dev/photos/<key>` normalized to `photos/<key>` (`data:`/`blob:` and
placeholder tokens excluded — they are not R2 references; proxy guesses are
synthesized at read time and never stored, so they cannot dangle).

- **Distinct keys referenced by D1: 197.**
- **Orphans (in R2, referenced nowhere): 2,393 objects, ~525 MB.**
  Age buckets: 733 older than 30d, 1,531 between 7–30d, 108 under 7d.
  Accumulation is continuous, not a one-time event. Typical keys look like
  `photos/food_1782995012758.jpg` (per-log captures).
- **Missing (referenced by D1, absent in R2): 0.** No dangling photo links.

Interpretation: orphans come from deleted meals (no delete-cascade exists),
superseded re-analysis uploads, and duplicate captures. ~97% of `photos/`
by object count is dead weight (~$0.01/mo at R2 rates — cost is negligible,
hygiene/backup size is the actual concern).

**Do NOT bulk-delete orphans yet:** the Supabase comparison is still pending
(paused), and a Supabase-only row could legitimately reference some of these
keys. Delete only after §1 is resolved, and then only keys unreferenced in
**both** stores plus a 30-day grace re-check.

## 4. Recommendations for the VPS agent

1. Unpause Supabase → rerun §1 → backfill D1 gaps (if any) → then cut code.
2. Add a delete-cascade (or tombstone sweeper) for meal photos; orphans grow daily.
3. Put a retention policy on `debug/` + `logs/` + `jobs/` + `bugs/` (60% of
   objects, ~500 MB of pure diagnostics).
4. Re-run procedure: `wrangler d1 execute health-tracker --remote` for counts;
   S3 `ListObjectsV2` via the R2 credentials in `.env`
   (`CLOUDFLARE_R2_*`) for inventory; parse D1 `image_urls`, normalize to
   `photos/<key>`, diff the sets. Never print credentials or meal contents.
5. Keep `source_meal_id` migration file until Supabase is either migrated or
   decommissioned — then delete it with the Supabase code paths.
