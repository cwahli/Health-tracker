# Storage audit: D1 vs Supabase vs R2

**Date:** 2026-09-20 (UTC). **Auditor:** Muse Spark via OpenCode (read-only queries only). Commits `10a7061`, `6e5e5b4`. Companion list: [R2_DELETE_CANDIDATES.json](./R2_DELETE_CANDIDATES.json) — **do not execute**.
**Indexed on:** [DATA_PLANE.md](./DATA_PLANE.md) Track D (**D-1** unpaid recovery, **D-9** stop regrowth, **D-10** deletes after D-1) and [ROADMAP.md](./ROADMAP.md).
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
- Open risk (Track D **D-1**, unpaid): any rows written **only** to Supabase
  (pre-D1 era?) stay locked behind the 402 until the quota likely resets
  **~2026-09-24**. Probe REST then; dump + diff vs D1; insert missing only.
  **Do not pay to unpause.** If still 402, park and retry later. Drain leftover
  *code* in D-2; **keep the remote project** until D-1.

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

## 4. Duplicate photos (content-hash dedup)

Method: listed all 2,590 `photos/` objects with ETags (all plain MD5, no
multipart) and grouped byte-identical content. No bytes were downloaded —
equality is by matching MD5, then joined against the D1 reference set from §3.

- **Duplicate groups: 325, covering 2,063 objects (~80% of `photos/`).**
- **Wasted (all-but-one per group): ~440 MB** — 415.6 MB in all-orphan
  groups, 23.9 MB in mixed/referenced groups.
- Mix: 289 groups all-orphan, 25 mixed (referenced + orphan twins),
  11 all-referenced. Group sizes range 2–69 (histogram peak at 2–3, long
  tail to 69).
- 589 objects inside duplicate groups end in `_0.jpg` — the uploader writes
  a base key **and** a `_0` twin of identical bytes on many uploads.

Notable specimens (keys abbreviated, see re-run procedure to reproduce):

- **69 identical copies** of one 359 KB capture under
  `photos/job_1788161968468_m02tuufgq{,_0}.jpg`,
  `photos/job_1788163890334_h982qishx{,_0}.jpg`, … — every analysis job
  re-uploads the same bytes under a fresh key, twice. None referenced.
  This is systematic uploader behavior, not user action.
- **Mixed:** `photos/food_1783028362424.jpg` ≡
  `photos/food_1783069285969.jpg` (67 KB), only the latter referenced —
  merge by deleting the former after §1 clears.
- **All-referenced:** twelve 307-byte files shared across twelve logs —
  smells like 1px placeholder/test pixels persisted as real meal photos.
  Worth a look (list with `size < 1024` grouped by ETag).

### Merge list procedure (do NOT execute before §1 resolves)

For each group keep ONE canonical key — prefer a currently-referenced key,
else the oldest — then: (a) `UPDATE food_logs image_urls` JSON rewriting
dropped keys to the canonical one (mixed/ref groups only); (b) delete the
rest; (c) re-run this audit to confirm zero groups. All-orphan groups need
only (b), still gated on the Supabase comparison.

### Stop the regrowth (root fix, code)

1. Content-hash check on the R2 PUT path (`server_routes_r2.ts`): hash bytes,
   reuse the existing key on ETag match instead of minting
   `job_<ts>_<rand>.jpg` per analysis.
2. Stop the base + `_0` double-write (589 twins and counting).
3. Delete-cascade (or tombstone sweeper) for meal photos — see §3 orphans.

## 5. Deletion candidacy (refined with job + golden references)

`agent_jobs` (26 rows) and `golden_cases` (5 rows) were scanned for
`photos/` references too. Result: **31 distinct keys from agent jobs**
(all `job_*`), **0 from golden cases**. This reclassified 29 keys the §3
pass had called orphans, and surfaced **2 referenced-but-missing keys**
(broken job-history photos):

- `photos/job_1789380364033_dwz71zixb.jpg` (absent)
- `photos/job_1789382054849_jd1irnqy7.jpg\` (absent — note the trailing
  backslash: a stored-URL escaping artifact worth fixing at write time)

Machine-readable merge list: **`plan/R2_DELETE_CANDIDATES.json`**
(per-key bytes, canonical keeps, generated 2026-09-20 by MD5-ETag groups
joined with D1 `food_logs` + `agent_jobs` refs).

| Tier | Meaning | Keys | Bytes | Rule |
|---|---|---|---|---|
| KEEP | Referenced in D1 (food 197 + jobs 31) | 226 in R2 | — | Never delete |
| MISSING | Referenced but absent | 2 | — | Re-upload or drop the reference, don't delete |
| TIER 1 | Byte-dup of a KEEP key | 96 | 23 MB | Safe delete (reference survives on the twin) |
| TIER 2 | All-unreferenced dup groups, keep 1 of 287 | 1,593 delete | 411 MB | Delete all but canonical after §1 clears |
| TIER 3 | Unique, unreferenced | 388 | 35 MB | Delete only post-Supabase + 30d grace |

TIER 1 + TIER 2 together: **1,689 keys, ~435 MB** — the true cleanup set.
TIER 3 needs the Supabase comparison first (a Supabase-only row could name
any of them). The 307-byte shared placeholders stay (referenced; data-quality
issue, not storage).

Execution order when §1 clears: TIER 1 → rewrite D1 references to canonicals
(mixed groups) → TIER 2 deletes → 30d → TIER 3 → re-run this audit to
confirm zero groups. Root fixes from §4 (upload hash check, `_0` twin,
delete-cascade) stop regrowth in parallel.

## 6. Recommendations (mapped to Track D — do not execute from this file)
1. **D-1:** When REST is no longer 402 (~24 Sep, unpaid) → rerun §1 → backfill D1 gaps (if any). Keep the project until then.
2. **D-9:** Stop photo regrowth (content-hash reuse on PUT; no base+`_0` twin). No deletes.
3. **D-10 (after D-1):** delete-cascade / tombstone sweeper; retention on `debug/` + `logs/` + `jobs/` + `bugs/`; then the candidate JSON.
4. Re-run procedure: `wrangler d1 execute health-tracker --remote` for counts;
   S3 `ListObjectsV2` via the R2 credentials in `.env`
   (`CLOUDFLARE_R2_*`) for inventory; parse D1 `image_urls`, normalize to
   `photos/<key>`, diff the sets. Never print credentials or meal contents.
5. Keep `source_meal_id` migration file until D-1 then delete it with the D-2 code paths.
