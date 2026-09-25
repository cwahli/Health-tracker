---
name: telegram-allowance-watch
description: Use when free-lane quota needs watching without spending agent quota, when a worker session needs launching/watching/failover, or when /allowance looks stale. Points at the ht-* operator scripts and the shared free-lane ledger; implementation lives in the provider router.
---

# Allowance watch + free-worker scripts (pointer skill)

Thin discoverability pointer. The implementation lives in
`tools/telegram-provider-router` (`bin/ht-allowance-watch`, `bin/ht-run`,
`bin/ht-watch`, `bin/ht-ship`, `src/allowance-watch-core.cjs`,
`scripts/test-allowance-watch.mjs`); the free-lane ledger is
`state/free-lane-table.json` + `state/session.json` quota records under the
router dir. Same vocabulary as `telegram-allowance`; this skill adds the
zero-quota watcher/launcher layer on top.

## The one ledger path

Every script and the router read/write the same ledger through
`HT_ROUTER_DIR` (default `~/.config/telegram-opencode/router`):

- `state/free-lane-table.json` — lanes (pref/provider/model/bucket/status/
  nextResetAt/cooldownUntil) + shared buckets.
- `state/session.json` — live `quota` records (`bucket:<id>` or
  `<provider>/<model>` keys, `depletedUntil` epoch-ms).
- Writes are atomic tmp+rename and never reorder lane pref. There is no
  cross-process flock on the ledger yet — one poller + one watcher daemon
  is the supported topology (BOT-5 one-poller law still applies).

## What to tell the user

- `ht-allowance-watch --once` probes depleted lanes whose reset is due and
  re-stamps the ledger so `/allowance` + `/freemodel` stay honest; `--daemon`
  loops (soonest reset +60s; 30 min poll when none known). One Telegram ping
  per lane per reset on flip-to-available. Never starts a second poller.
- `ht-run <tool> <session> <prompt-file> [model]` launches freebuff/opencode/
  cline in tmux; omitting the model auto-picks the best available lane
  (exit 3 = all depleted, no vendor burn).
- `ht-watch <session> <report-file> [max-hours] [--auto-failover]` stays silent
  while healthy and exits only on DONE/DIED/IDLE/STALLED/QUOTA/TIMEOUT/
  SESSION_LOST/CONTINUE_CAP. QUOTA detection reads tool status lines/logs
  only — `429`/quota words inside source files being read never match
  (guarded by unit test).
- `ht-ship <ticket-dir>` is the only script that restarts the poller
  (npm-test gate → sync src+scripts+bin → exactly one locked restart →
  verify one poller + no 409).
- Re-stamp policy (one place, `depletionUntilFromText`): Cloudflare 4006
  daily neurons → next 00:00 UTC; vendor countdown honoured; plain
  rate-limit → 45 m; unknown → 6 h.
- Never start a second real freebuff instance to test (one CLI per account);
  use stubs or `--dry-run`. Never edit a running script in place (tmp+mv).
