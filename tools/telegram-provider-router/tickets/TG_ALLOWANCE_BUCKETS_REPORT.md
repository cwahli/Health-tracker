# TG-ALLOWANCE-BUCKETS — report

**Status: done.** Edited only `/home/box/.config/telegram-opencode/router/src/index.js`
(2937 → 3144 lines). One router poller restarted so the boot-loaded code is live
(see §5). No tokens printed anywhere. No Muse or Freebuff models were used.

## 1) `FREE_ALLOWANCE_BUCKETS` table + code pointers (+ line numbers)

File: `/home/box/.config/telegram-opencode/router/src/index.js`

| What | Lines |
|------|-------|
| `FREE_ALLOWANCE_BUCKETS` (5 buckets, `{id,scope,label,resetHint,members,match}`) | 475–535 |
| `resolveAllowanceBucket(provider, model)` | 537–544 |
| `bucketKey` / `bucketLive` / `bucketMemberShort` | 546–563 |
| `quotaRecordKey` (shared → bucket key, per-model → route key) | 569–573 |
| `parseDepletedUntil` (`try again in Xh Ym` / `until <iso>`) | 576–592 |
| `markDepleted` (bucket-aware, returns shared note) | 593–620 |
| `isDepleted` (bucket-aware) | 622–634 |
| `quotaLines` (now shows `hitBy`) | 636–645 |
| `allowanceBucketSection()` → `/allowance` "Buckets" block | 648–699 |
| dispatch failover shared-bucket note | 1617, 1624, 1666–1670, 1676–1680 |
| `allowanceText()` rewrite (Buckets + Active route / Failover family, CF block kept) | 2394–2511 |

Buckets implemented exactly as the ticket's table:

| id | scope | matches | resetHint |
|----|-------|---------|-----------|
| `opencode-zen-free` | shared | provider `opencode`, model not `tokenharbor/*`/`cloudflare/*`/`@cf/*`, and (ends `-free` OR keyword muse/mimo/ling/nemotron/space-bunny) | rolling / rate-limit |
| `tokenharbor-free` | shared | provider `tokenharbor` OR model `tokenharbor/*` OR `*:free` | rolling ~7-day value bar |
| `cloudflare-neurons` | shared | provider `cloudflare` OR `cloudflare/*` OR `@cf/*` (numbers reuse `state/cf-neurons.json`) | 00:00 UTC (10k/day) |
| `cline-free` | per-model | provider `cline` OR `cline-free/*` / `cline/*` | Cline UI daily |
| `freebuff-freebucks` | shared | provider `freebuff` | Freebuff UI daily |

`opencode-zen-free.members` includes `space-bunny-free` for the future, but Space
Bunny is **not** advertised on `/freemodel`: `probeOpenCodeFree` (unchanged) only
lists ids actually returned by `GET /provider → opencode.models`, and the running
server does not return it (verified: `space-bunny-free` absent from the live list).

## 2) Quota memory change

- Shared bucket → `state.quota["bucket:<id>"] = { depletedUntil, lastError, scope:"shared", bucket:<id>, hitBy:"provider/model" }` (one entry).
- Per-model (Cline) → `state.quota["cline/cline-free/<model>"]` exactly as before, `scope:"per-model"`.
- `markDepleted(provider, model, err)` resolves the bucket; parses `try again in Xh Ym` (and bare `h`/`m`/`s`) or `until <iso-8601>` → sets `depletedUntil`; otherwise keeps the old `QUOTA_TTL_MS` default.
- `isDepleted(provider, model)` → true when the route's **shared bucket** is depleted, or its **exact key** for per-model routes.
- Dispatch's existing failover skip (`routes = routes.filter(r => !isDepleted(r.provider, r.model))`, ~line 1610) now uses this, so a Muse-hit skips MiMo/Ling/Nemotron OpenCode-free in the same bucket.
- Optional-light behavior: a shared-bucket hit prepends a note to the next failover Telegram progress line (`lastSharedNote`, lines 1617/1624/1668/1678).

## 3) Example `/allowance` text (real render)

Captured by executing the *actual* `allowanceText()` from the edited source with a
stubbed network (OpenCode up, Token Harbor key OK, CF GraphQL unavailable). State:
OpenCode route = `opencode/muse-spark-1.3-contributor-free`, Muse hit the shared Zen
rate limit ("try again in 2h 15m"), Cline DeepSeek free hit its per-model cap.

```
Allowance (best-effort)

Buckets
· OpenCode Zen free [shared] — DEPLETED until <iso> (hit by opencode/muse-spark-1.3-contributor-free) · affects: muse-spark-1.3, muse-spark-1.2, mimo-v2.6-flash, ling-3.0-flash-fin, nemotron-3-ultra, nemotron-3.5-lightning, space-bunny
· Token Harbor free [shared] — unknown remaining (dashboard only) · OK
· Cloudflare neurons [shared 10k/UTC] — 42417/10000 · DAILY CAP HIT · reset 00:00 UTC (10k/day)
· Cline free [per-model] · reset Cline UI daily
    – muse-spark-1.3 : OK / unknown
    – deepseek-v4.1-flash : depleted until <iso>
    – glm-5.3-flash : OK / unknown
· Freebuff Freebucks [shared] — signed in · UI only / terminal · reset Freebuff UI daily

Active route: OpenCode · `opencode/muse-spark-1.3-contributor-free`
Failover family: muse-spark-1.3
· opencode: `opencode/muse-spark-1.3-contributor-free`
· cline: `cline-free/muse-spark-1.3-contributor`

OpenCode: up (1.1.x)
OpenCode←TokenHarbor models: 2
OpenCode←Cloudflare models: 1
Token Harbor: key OK · remaining free allowance = dashboard only (rolling ~7-day value bar)

Depleted routes (skipped until depletedUntil):
· bucket:opencode-zen-free (hit by opencode/muse-spark-1.3-contributor-free) depleted until <iso>
· cline/cline-free/deepseek-v4.1-flash depleted until <iso>
Cline: signed in · free caps are per-model/day in Cline UI (no local remaining counter)
Freebuff: signed in · Freebucks = Freebuff UI (25/day Indo tier; no local remaining counter)
Command Code: credit balance in Command Code billing UI (free-tagged still needs credits here)

Cloudflare Workers AI (10k neurons/day, resets 00:00 UTC):
· Live account total: unavailable (token needs Account Analytics Read for live total)
· Telegram/OpenCode estimate today: 42417 neurons across 1 CF calls
· Status: DAILY FREE CAP HIT — CF models unusable until 00:00 UTC. Switch to Muse / Token Harbor / Cline.
· Exact burn is `usage.neurons` per reply; GraphQL needs Account Analytics Read on the API token for the full account bar.

Tip: quota errors auto-try the next lane in the family above.
Dashboards: tokenharbor.ai · app.cline.bot · freebuff.ai · commandcode.ai · dash.cloudflare.com → AI → Workers AI
```

Unknown counts are always labelled `unknown` + a dashboard/reset hint (Token Harbor,
Cline per-model). Only Cloudflare shows numbers, reusing `cf-neurons.json` +
the existing live GraphQL block (kept unchanged).

## 4) Done-when proof (run against the real source)

`node --check src/index.js` → SYNTAX OK.

A harness extracts the real new functions verbatim from `src/index.js`
(`// ---- E) light quota memory` … `// ---- B) orphan-safe child teardown ----`) and
executes them with a stub `state`/`saveState`:

```
PASS  DONE: marking opencode/muse...free sets bucket key
PASS  DONE: isDepleted(opencode, mimo-v2.6-flash-free) === true
PASS  DONE: isDepleted(opencode, ling-3.0-flash-fin-free) === true
PASS  DONE: isDepleted(cline, cline-free/deepseek-v4.1-flash) === false
PASS  DONE: affected bucket scope shared + hitBy recorded
PASS  DONE: sharedNote present on markDepleted
PASS  parse: 'in 2h 30m' ~ 2.5h
PASS  parse: 'until <iso>'
PASS  parse: no hint -> 0
PASS  parse: 'in 45m' ~45min
PASS  per-model: cline muse depleted key is per-model
PASS  per-model: cline muse isDepleted true
PASS  per-model: cline deepseek unaffected (false)
PASS  th: shared bucket marked
PASS  th: chat-only TH route also depleted
PASS  cf: shared bucket marked
PASS  cf: cf glm route also depleted
... plus 12 bucket-resolution checks ...
RESULT: 29 passed, 0 failed
```

Explicit answer to the ticket's Done-when:

- `markDepleted("opencode","opencode/muse-spark-1.3-contributor-free", …)` writes
  `state.quota["bucket:opencode-zen-free"]` (`scope:"shared"`, `hitBy` = the Muse route).
- `isDepleted("opencode","opencode/mimo-v2.6-flash-free")` → **true** (same shared bucket).
- `isDepleted("cline","cline-free/deepseek-v4.1-flash")` → **false** (per-model, separate key).

## 5) Router restart (code loaded at boot)

The poller is a single long-running `node src/index.js`; it reads the source at
start, so a restart was required. The old poller (pid 1792790) was stopped and one
new poller started under an outer lock holder with `TG_ROUTER_LOCKED=1` (the pattern
this box used before; the router's self-managed `lockHeldByOther()` daemon-spawn path
does not return on this box, pre-existing behavior — not touched by this change):

- New poller: `node src/index.js` (pid **1813736**), outer holder `flock -n run/router.lock …` (pid 1813734).
- `run/router.pid` = 1813736; log: `single-poller lock ok: …` then `@{Grok_computer_bot} polling`.
- Exactly one poller; no new 409 conflicts.

## 6) Out of scope (unchanged)

- No whole-router rewrite.
- Freebuff Telegram restore not attempted (terminal/UI only).
- Space Bunny is not forced onto `/freemodel` while the server returns ProviderModelNotFoundError.
- No secrets/tokens printed; only `TELEGRAM_BOT_TOKEN`-style env var **names** were listed during investigation.

