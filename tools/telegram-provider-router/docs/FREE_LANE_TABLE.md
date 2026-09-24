# Free-lane table (preference + status + reset)

Updated: 2026-09-24T10:25:55.862525Z

Failover: **same-family first (skip depleted), then next available by pref #**

Columns: reset rule always; next reset always; cooldown only when depleted; **lastPingAt** when known.

| # | Lane | Status | Reset rule | Next reset | Cooldown | lastPingAt |
|---|------|--------|------------|------------|----------|------------|
| 1 | OpenCode Muse Spark 1.3 free | **available** | rolling / rate-limit (OpenCode Zen free shared pool) | unknown until a limit response (then countdown) | - | — (see note) |
| 2 | Cline Muse Spark 1.3 contributor free | **depleted** | per-model daily/rolling window; reset = depletedObservedAt + vendor countdown | 2026-09-25T09:38:00Z (~16:40 WIB / 10:40 London Fri) | 2026-09-25T09:38:00Z | — (see note) |
| 3 | OpenCode MiMo V2.6 Flash free | **available** | rolling / rate-limit (OpenCode Zen free shared pool) | unknown until a limit response (then countdown) | - | — (see note) |
| 4 | OpenCode Space Bunny free | **pending-expose** | rolling / rate-limit (OpenCode Zen free shared pool) | unknown until a limit response (then countdown) | - | — (see note) |
| 5 | OpenCode Token Harbor DeepSeek V4.1 Flash free | **available** | rolling ~7-day value bar (shared Token Harbor free) | dashboard only (no API clock) | - | — (see note) |
| 6 | Cline DeepSeek V4.1 Flash free | **available** | per-model daily (Cline UI) | Cline daily (exact clock from 429 / UI) | - | — (see note) |
| 7 | Token Harbor chat DeepSeek V4.1 Flash free | **available** | rolling ~7-day value bar (shared Token Harbor free) | dashboard only (no API clock) | - | — (see note) |
| 8 | OpenCode Token Harbor MiMo V2.6 Flash free | **available** | rolling ~7-day value bar (shared Token Harbor free) | dashboard only (no API clock) | - | — (see note) |
| 9 | Token Harbor chat MiMo V2.6 Flash free | **available** | rolling ~7-day value bar (shared Token Harbor free) | dashboard only (no API clock) | - | — (see note) |
| 10 | Cloudflare Qwen3.8 27B | **available** | 10k neurons/day shared, 00:00 UTC (validated day1 probe) | 00:00 UTC next day | - | 2026-09-24T00:32:54Z |
| 11 | Cloudflare GLM 4.7 Flash | **available** | 10k neurons/day shared, 00:00 UTC (validated day1 probe) | 00:00 UTC next day | - | 2026-09-24T00:32:54Z |
| 12 | OpenCode Muse Spark 1.2 free | **available** | rolling / rate-limit (OpenCode Zen free shared pool) | unknown until a limit response (then countdown) | - | — (see note) |
| 13 | OpenCode Token Harbor MiMo V2.5 free | **available** | rolling ~7-day value bar (shared Token Harbor free) | dashboard only (no API clock) | - | — (see note) |
| 14 | OpenCode Token Harbor Qwen3.8 Flash free | **available** | rolling ~7-day value bar (shared Token Harbor free) | dashboard only (no API clock) | - | — (see note) |
| 15 | Cline GLM 5.3 Flash free | **available** | per-model daily (Cline UI) | Cline daily (exact clock from 429 / UI) | - | — (see note) |
| 16 | OpenCode Token Harbor DeepSeek V4 Flash free | **available** | rolling ~7-day value bar (shared Token Harbor free) | dashboard only (no API clock) | - | — (see note) |
| 17 | Freebuff DeepSeek V4.1 Flash | **available** | shared daily Freebucks (Freebuff UI) | Freebuff UI daily | - | 2026-09-23T23:25:00Z |

## Ping policy
- **hourlyProbe**: ledger/state read at UTC :10 — not a burn ping each hour
- **liveBurnPing**: only when status uncertain / user asked; skip already-indicated depleted
- **rollingLabelMeans**: no fixed daily wall-clock yet; nextReset filled when a limit response gives Try again in Xh Ym (or ISO)

## Cline Muse (this hit)

- **Depleted observed**: 2026-09-24 17:23 WIB (= `2026-09-24T10:23:00Z`) — this is **when the limit hit**, not the reset.
- **Vendor countdown**: 23h 15m
- **Reset / cooldown until**: `2026-09-25T09:38:00Z`
- **Note**: REAL daily free limit (user UI). Observed ~17:23 WIB Thu (= depletion time, NOT reset). Reset ≈ observed + 23h15m → 2026-09-25 16:38 WIB Fri / 2026-09-25 10:38 BST. Replaces false 6h TTL mark from help-markdown.

## Reset hypotheses
- Preferred wording: CF: 00:00 UTC. Cline Muse: stamp depletedObservedAt + parse Try again in Xh Ym (this hit → ~09:40 UTC / 16:40 WIB Fri). Rolling Zen = wait for limit response.
- Still need: 23:10 UTC probe for CF day boundary; multi-day CF; wire failover; ensure markDepleted only on real limit text



## Grok Bot quota (not a free-lane)

- **Reset rule:** weekly
- **Local clock:** Thursday ~17:23 Asia/Jakarta (WIB)
- **Last reset:** 2026-09-24 17:23 WIB (Thursday)
- **Next reset:** 2026-10-01 17:23 WIB (Thursday) / 2026-10-01 11:23 BST (Thursday)
- **Note:** User-confirmed — this is Grok Bot, not Cline Muse.
