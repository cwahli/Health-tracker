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

## Where the daemon runs — and it is versioned now

`systemd/ht-allowance-watch.service` is the unit the box runs, and it lives in the
repo. It did not until 2026-10-07, and that is what made the Cline ❌
undiagnosable: the unit's `Environment=PATH` had no `~/.npm-global/bin`, so every
Cline probe answered `not installed` → uncertain, and the watcher re-stamped that
lane depleted every ~46 minutes on evidence that had lapsed eleven days earlier.

- `ExecStart` runs the **deploy clone** (`/home/ubuntu/deploy/Health-tracker`, which
  the deploy resets to main), never `/home/ubuntu/bot-host-r14` — a tree nothing
  deploys, where the watcher's code had to be copied by hand and the next hand-copy
  silently undid the fix.
- The wrapper does not depend on PATH for a provider CLI: `resolveCliBin` in
  `src/allowance-watch-core.cjs` tries absolute candidates first, the same list
  `scripts/lib/agent-cline.mjs` already used for the bot. PATH is kept correct in
  the unit too, but it is not load-bearing.
- `HT_LOG_DIR` is set because the wrapper's default log path is `/workspace/logs`,
  which does not exist on the box — the watcher's file log was dead from
  2026-09-25 to 2026-10-07 and only the journal recorded anything.

Install — as the box's administrator, and **after** the fix has merged and deployed,
because `ExecStart` runs the deploy clone's copy:

    install -m 644 systemd/ht-allowance-watch.service /etc/systemd/system/
    systemctl daemon-reload && systemctl restart ht-allowance-watch

Then confirm it rather than assume it:

    npm run verify:deployed --prefix tools/telegram-provider-router

It reads the installed unit, its `ExecStart`, the running wrapper's and core's
sha256, the last sweeps and the shared ledger off the box and compares them with the
repo. Exit 0 = the box runs what the repo ships; 1 = it does not, with the two
install lines printed; 3 = no route, so nothing was judged. `--self-test` runs the
same judging logic offline.

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
