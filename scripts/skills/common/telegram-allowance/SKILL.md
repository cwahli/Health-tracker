---
name: telegram-allowance
description: Use when the user asks about quota, allowance, rate limits, why a model stopped answering, or when you see provider billing/quota errors in logs. Explains free-lane quota state and failover; implementation lives in the provider router.
---

# Telegram allowance & quota failover (pointer skill)

Thin discoverability pointer. The implementation lives in
`tools/telegram-provider-router` (`FREE_ALLOWANCE_BUCKETS`, `markDepleted` /
`isDepleted`, `nextFailoverRoutes`, `parseDepletedUntil`); the same vocabulary
is mirrored in `scripts/lib/agent-opencode.mjs` (`isQuotaOrLimitError`,
`parseRetryAfter`, `runWithModelFailover`) so both runtimes classify a lane
failure the same way.

## What to tell the user

- A lane (model) can be **depleted**: free allowance spent, account unfunded,
  throttled, or at capacity. This is per-lane, not per-bot.
- Failover re-runs the **same prompt on the next lane** instead of dead-ending.
  Never auto-retry timeouts/aborts — re-running would just wait again.
- When the provider gives a retry hint (`try again in 3h 20m`, ISO reset stamp),
  surface it verbatim: `Retry in ~3h 20m.` When it gives none, say so.
- Key wordings that mean "lane unavailable": `rate limit exceeded`,
  `insufficient account funds`, `out of credits`, `no payment method`,
  `free_tier_limit`, `quota / capacity / exhausted`, HTTP `429` / `402`.

## Hang detection (all classes)

- OpenCode CLI can print a provider error to stderr and then **idle instead of
  exiting**. Any runner must treat a matching stderr error as fatal immediately
  (fail fast, ~10s) rather than waiting out the full timeout (~15m).
- Cosmetic `small=true` title-agent errors are **not** fatal — a run can still
  answer normally after one. Only `small=false` (or unlabelled) errors count.

## Scope limits

- **Grok TG / free-lane bots:** full behaviour (`/allowance`, buckets, failover) from the box ledger (`TG_ROUTER_STATE_DIR`).
- **VPS / Mobile coding bots:** same `/allowance` table + `/freemodel` depletion filter via the shared `scripts/lib/free-lanes.mjs` against each bot's OWN ledger (`~/.local/state/bot-host/<botId>/free-lanes`, auto-stamped on quota failures). Per-account quotas mean bot A never reads bot B's stamps.
- **Collab:** excluded — its quota is Colab compute units, documented in CB-*
  docs, not here.
