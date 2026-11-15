# Photo URL rewrite — proposal (NOT EXECUTED)

**Status:** awaiting owner approval. Nothing in this file has been run against
production data.
**Prepared:** 2026-11-16
**Related:** PR #899 (`agent/photo-failfast`) — code fix that makes the current
stored URLs load again through the same-origin proxy.

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

## 3. The migration (proposal only)

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

Guardrails, if approved:

1. Take a snapshot first:
   `pg_dump` of `food_logs`, or `COPY (SELECT id, image_urls FROM food_logs) TO …`.
2. Run the `SELECT` above and confirm it lists **252** rows.
3. Run **one** `UPDATE`, then re-run the same `SELECT` and confirm **0** rows.
4. Re-check 437/437 keys through `/photos/{key}`.
5. Writes are only needed once: the client rewrite means the app is already
   correct, so this is hygiene, not a fix.

**Not proposed:** touching the D1 mirror or the exported backups. Those carry
`/photos/` paths already (339 refs) and are not affected.

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
