# HT free-worker scripts (repo copies: `tools/telegram-provider-router/bin/`)

Free-tool launchers + watchers. Goal (ticket
`tmp/ht-allowance-watch/TICKET.md`): the PM never spends quota polling —
scripts check allowance and probe lanes themselves.

Live runtime keeps its copies at `$HT_BIN_DIR` (default `/home/box/bin/`,
deployed by `ht-ship`); the repo copies here are the source of truth.
All logs land in `$HT_LOG_DIR` (default `/workspace/logs/`). The free-lane
ledger lives at `$HT_ROUTER_DIR/state/free-lane-table.json` (default
`~/.config/telegram-opencode/router/state/`, plus `session.json`
quota records). Never commit `.env` or print keys.

Env overrides (same on every script; tests use the sandbox values):

| Var | Default | Meaning |
|---|---|---|
| `HT_WORKSPACE` | `/workspace/biomarker-and-nutrient-tracker` | repo checkout (core path, CLI cwd) |
| `HT_BIN_DIR` | `/home/box/bin` | sibling scripts (`ht-show`, `ht-run`) |
| `HT_ROUTER_DIR` | `~/.config/telegram-opencode/router` | live ledger + `.env` |
| `HT_LOG_DIR` / `HT_AC_LOGS_DIR` | `/workspace/logs` | sidecars + logs |
| `HT_CORE_PATH` | repo core, then live copy | `allowance-watch-core.cjs` override |
| `HT_REPO` | `/workspace/biomarker-and-nutrient-tracker` | repo root for `ht-ship` |

## ht-allowance-watch — free-lane allowance watcher (zero Grok)

```bash
ht-allowance-watch --once      # probe everything due now, print summary, exit
ht-allowance-watch --daemon    # loop forever (sleeps until soonest reset +60s; 30 min poll if none known)
ht-allowance-watch --daemon --exit-on-available   # exit 0 printing "AVAILABLE: <lane>" when a lane opens (wakes the PM)
```

- Reads the ledger, probes depleted lanes cheaply when their reset/cooldown is
  due (OpenCode `opencode run`, Cline `cline -m`, Token Harbor / Cloudflare HTTP
  from router `.env` keys — keys are never printed). Freebuff is terminal-only:
  skipped.
- Re-stamps the ledger in the router's own JSON shape (`session.json` quota +
  `free-lane-table.json` lanes/buckets) so `/allowance` and `/freemodel` stay
  honest. One re-stamp policy via the shared core (`depletionUntilFromText`):
  Cloudflare 4006 ("used up your daily free allocation of 10,000 neurons") →
  **next 00:00 UTC** (not the old 45 m re-stamp — fixed 2026-09-25); vendor
  countdown honoured; plain rate-limit → 45 m; unknown → 6 h.
- ONE Telegram ping per lane per reset window on flip-to-available (Bot API
  `sendMessage` only — never a second poller).
- Log: `<logs>/ht-allowance-watch.log`.

## ht-run — launch any free tool in a visible tmux window

```bash
ht-run <tool> <session> <prompt-file> [model]     # tool = freebuff | opencode | cline
```

- Always creates tmux session `<session>` (200×50) and opens a visible desktop
  terminal attached (`ht-show`). Panes are logged to `<logs>/<session>.log`.
- `freebuff`: current `ht-freebuff` flow (default model, waits for
  "Enter a coding task", types the prompt, Enter).
- `opencode`: `opencode run -m <model> "<prompt>"` (non-interactive).
- `cline`: `cline -m <model> -c <workspace> "<prompt>"` (non-interactive, auto-approve).
- `[model]` omitted → best available lane for that tool from the ledger
  (skip depleted / live-quota'd lanes, lowest pref # first). None available →
  exit 3 with a clear message.
- Writes `<logs>/<session>.meta` (tool/model/prompt file) which
  `ht-watch` reads for per-tool detection.

## ht-watch — watch a worker session; wake the PM only on real events

```bash
ht-watch <session> <report-file> [max-hours] [--auto-failover] [--then "<cmd>"] [--detach]
```

Silent while healthy. Exits with a one-line verdict on: `DONE` (report written),
`DIED` (session gone, process exited without report), `IDLE` (freebuff not
"working" for 5 min, no report), `STALLED` (screen blank or unchanged 30 min),
`QUOTA`, `TIMEOUT`, `SESSION_LOST` (freebuff continue failed 3× in a row, or
another freebuff instance took over the account — never auto-continued),
`CONTINUE_CAP` (12 freebuff auto-continues used for this job).

- **Every** terminal exit also writes `<logs>/<session>.wake` and sends
  ONE Telegram message (`sendMessage` via the router `.env`'s
  `TELEGRAM_BOT_TOKEN` + `TELEGRAM_ALLOWED_USER_ID`; keys are never printed).
  Auto-continue successes are silent: one line in `<session>.log`, no exit.
- `--detach`: re-execs itself via `setsid` (survives the launching shell — the
  PM's watcher shells died with the PM session on 2026-09-25). A PID file
  (`<session>.watch-pid`) prevents a second watcher for the same session.
- `--then "<cmd>"`: run `<cmd>` after `DONE` (chain the next job).
- Freebuff auto-continue: when the pane shows the session-ended box, waits for
  "Press Enter to continue" ("wrapping up" variant gets a 10 min grace), presses
  Enter, opens the model picker when Freebucks are 0 and picks GLM 5.3 Flash
  (0/hr), waits for "Enter a coding task", then types the resume prompt
  (re-read `<ticket>/TICKET.md`, resume from `<ticket>/PROGRESS.md`, REPORT.md
  with `VERIFIED: yes/no`). Ticket dir = the prompt file's dir from the `.meta`
  sidecar. Count + fail-streak survive restarts in `<session>.cont`.
- Per-tool QUOTA detection (status lines/logs only — never arbitrary pane text,
  so `429` inside source files cannot false-positive):
  - **opencode**: `Rate limit exceeded` in `~/.local/share/opencode/log/opencode.log`
    for the current run with no later step for 90 s. OpenCode Zen lanes
    (Muse/MiMo/Space Bunny) hang SILENTLY on rate limit: no output for 3 min
    = rate-limited → the `opencode-zen-free` bucket is stamped and failover
    happens (fixed 2026-09-25; the ledger used to keep saying "available").
  - **cline**: 429 / quota text in this run's pane/log output (`429` must
    co-occur with quota words on the same line).
  - **freebuff**: out of Freebucks = QUOTA; `working...` / `Thinking` = alive.
    The session-end box is auto-continued, not QUOTA.
- On QUOTA it stamps the lane depleted in the ledger (same shape as the router's
  auto-capture: vendor countdown if present, else default TTL) and prints the lane.
- `--auto-failover`: on QUOTA (or DIED/STALLED), relaunch the same prompt on the
  next available lane via `ht-run` — same family first, then next by pref,
  Freebuff last resort — and keep watching. Exits only on DONE, all lanes
  depleted (`FAILOVER_EXHAUSTED`), or TIMEOUT.

## ht-freebuff / ht-show / ht-worker

`ht-freebuff <session> <prompt-file>` (Freebuff only; writes the same `.meta`
sidecar as ht-run so ht-watch can auto-continue),
`ht-show [session]` (re-attach worker windows to the desktop),
`ht-worker <name> <cmd…>` (generic tmux wrapper).
Box-only helpers, not vendored here — see the live `$HT_BIN_DIR`.

`ht-keeper` (stopgap detached watcher from the 2026-09-25 night) is RETIRED —
its features (Telegram-on-exit, `.wake` file, auto-Enter + resume, blank-pane
stall detection, `--then` chaining) are folded into `ht-watch --detach`.

## ht-ship — ship repo router changes to the live router (one poller)

```bash
ht-ship <ticket-dir>    # see that script; runs npm test, syncs src+scripts+bin,
                        # restarts the poller EXACTLY ONCE via the locked path,
                        # verifies one process + no 409, appends SHIPPED.txt
```

## Conventions

- `ht-run`/`ht-watch` session names should start with `ht-` so `ht-show` finds them.
- Ledger writes are atomic (tmp+rename) and never reorder lane pref.
- Probe/stamp budget: one probe per lane per reset window
  (`state/allowance-watch-pings.json`).
