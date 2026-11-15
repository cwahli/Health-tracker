# Photo URL rewrite — applied 2026-11-16 (owner-approved)

**Status:** **APPLIED** to production `food_logs` on 2026-11-16T19:03Z, with owner
approval. 252 rows / 437 refs rewritten; re-verified 0 dead refs and 472/472
photo keys rendering `200 image/jpeg`.
**Snapshot:** `/home/agentuser/.opencode-work/food_logs_image_urls_snapshot_20261115T190321Z.json`
(316 rows, chmod 600) — full pre-migration `id` + `image_urls`.
**Prepared:** 2026-11-16
**Related:** PR #899 — code fix that made the stored URLs load again; this
migration removes the dead host from stored data so nothing depends on the
client rewrite.

---

## 1. What is wrong in the data

`food_logs.image_urls` still names the **revoked** R2 public host
`pub-d17eecca64f82625d29dc38b14f46c14.r2.dev` (401
`You are not authorized to view this bucket`).

Measured on 2026-11-16 against Supabase (`food_logs`, 316 rows):

| Measure | Count |
|---|---|
| Rows holding at least one dead ref | **252 / 316** |
| Dead refs to `pub-d17eecca…` | **437** |
| Refs already on the live host `pub-2ae421…` | 35 |
| `ref:` pointers / other | 25 |

Every one of those 437 keys **does** exist and returns **200 image/jpeg** on the
live host `pub-2ae421ce82904986ae87c8bc27552cff.r2.dev` — checked key by key,
437/437 OK. So this is a **hostname** problem, not lost bytes.

## 2. Why it is now invisible to the user

`src/utils/foodImageSources.ts` already rewrites any `*.r2.dev/photos/{key}` to
same-origin `/photos/{key}` at render time, and `/photos/{key}` serves the object
from the private bucket. Verified: all 437 keys render through
`https://health-tracker.co.uk/photos/{key}` (437/437 `200 image/jpeg`, 0
failures). **No data migration is required to make the app work again.**

## 3. The migration (APPLIED 2026-11-16)

Preferred shape — canonicalise to the proxy path the client already prefers,
which removes the public host from stored data entirely:

```sql
-- 437 refs across 252 rows. Preview first: no write until the SELECT is approved.
SELECT id, image_urls
FROM food_logs
WHERE image_urls @> '["https://pub-d17eecca64f82625d29dc38b14f46c14.r2.dev"]'::jsonb
   OR EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(image_urls) u
        WHERE u LIKE '%pub-d17eecca64f82625d29dc38b14f46c14.r2.dev%'
      );
```

Alternative (smaller diff, keeps absolute URLs): rewrite the host only —

```sql
UPDATE food_logs
SET image_urls = (
      SELECT jsonb_agg(
               to_jsonb(replace(u, 'pub-d17eecca64f82625d29dc38b14f46c14.r2.dev',
                                   'pub-2ae421ce82904986ae87c8bc27552cff.r2.dev'))
             ORDER BY ord)
      FROM jsonb_array_elements_text(image_urls) WITH ORDINALITY AS t(u, ord)
    )
WHERE EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(image_urls) u
        WHERE u LIKE '%pub-d17eecca64f82625d29dc38b14f46c14.r2.dev%'
      );
```

### What was run (2026-11-16)

Host-only rewrite was chosen (smaller diff, keeps absolute URLs resolvable by
anything that reads the row directly, not just this app).

1. **Snapshot:** all 316 rows' `id` + `image_urls` written to
   `food_logs_image_urls_snapshot_20261115T190321Z.json` before any write.
2. **Preview:** read back 316 rows; confirmed **252** rows hold **437** refs to
   `pub-d17eecca….r2.dev`. Predicate matched the documented SQL exactly
   (`EXISTS (... LIKE '%pub-d17eecca….r2.dev%')`).
3. **Apply:** 252 row-level `PATCH`es (`image_urls` array per row, replaced array
   wholesale from the snapshot, host substituted). **252 applied, 0 failed.**
4. **Verify:** re-read all 316 rows → **0** dead refs, **472** refs on the live
   host `pub-2ae421….r2.dev` (437 migrated + 35 that were already live).
5. **Re-check:** **472/472** unique photo keys render `200 image/jpeg` through
   `https://health-tracker.co.uk/photos/{key}` (one flaky `000` on the first
   sweep re-ran clean three times; final sweep 472/472, 0 failures).

Rollback: every pre-migration array is in the snapshot file, keyed by row `id`;
re-`PATCH` `food_logs?id=eq.<id>` with `{"image_urls": <snapshot array>}`.

**Not touched:** the D1 mirror and exported backups. They already carry
`/photos/` paths (339 refs) and were never affected.

## 4. Item 1 (apex DNS re-point) — WITHDRAWN as unnecessary

The earlier plan was to move `health-tracker.co.uk` off tunnel `d9f81831-…`
because it measured 6.09s average TTFB with 524s on `/photos/*`.

That was not the DNS record. It was a **restart storm** on the origin box: the
disabled-in-spirit `cloudflared.service` had no config file, so systemd restarted
it every 5 seconds for **53,148** cycles, and `ht-services-watchdog` kept
"helping" by starting it again. That churn is what made the origin slow and
what made pages fail to load at all.

After stopping and disabling that unit and re-pointing the watchdog at
`cloudflared-id-vps` (2026-11-16), the same domain on the same tunnel measures:

| Probe (n=15, uncached) | Before | After |
|---|---|---|
| `GET /` TTFB | 6.09s avg, 9/15 empty at 8s | **0.13s avg, 0.19s max** |
| `GET /photos/{key}` | 10/10 timeout, 524 at 125s | **0.38s avg, 200 image/jpeg** |
| `GET /api/health` | — | 0.13s avg |
| Caddy slow (>5s) requests, last 30 min | 379 in the 13:00–17:00 window | **0 / 699 requests** |

So **no DNS change is needed**. Leaving the record as-is is the lower-risk
outcome; re-pointing it would now only move traffic onto a different origin
without fixing anything.

## 5. Also retired the same day (no approval needed, already applied)

* **App box:** `cloudflared-proto.service` — user unit pointing at
  `~/.cloudflared/prod-config.yml`, which named deleted tunnel
  `85b56df3-…`; it logged `Tunnel not found` continuously. Stopped and
  disabled; the unit file and the stale config are left in place for rollback.
* **Origin box:** `cloudflared.service` — stopped, disabled, restart counter
  reset to 0; `ht-services-watchdog.sh` now watches `cloudflared-id-vps`
  (backup at `/usr/local/bin/ht-services-watchdog.sh.bak-20261116`).
* **Gateway:** `/photos/{key}` now proxied to the app upstream in
  `scripts/tui-gateway.mjs` (deployed on this box and restarted;
  `app.health-tracker.co.uk` photo requests went 404 → 200 image/jpeg).
