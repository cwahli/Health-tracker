# Web-UI-first Mini App — roadmap (TUI removal only on full replacement)

**Goal:** Mini App becomes `opencode web` (DOM: native scroll, real text) instead of
ttyd canvas (frame-by-frame). **The TUI is removed only if the web UI fully replaces
it — per lane, proven, not assumed.** No Tailscale anywhere: same public-gateway
model as today (Caddy → gateway with Telegram-initData gate → localhost-only
upstream, credentials held server-side).

**Why:** canvas TTYD streaming is the most resource-hungry phone surface we have
(bitmap repaint per frame, no native scroll, no selectable text). Industry practice
is DOM/native clients; opencode itself ships one (`opencode web` / `serve`).

## Lane coverage (the removal gate depends on this table)

| Lane | Today | Web UI covers it? |
|------|-------|-------------------|
| opencode (all free models) | TUI + bot turns via `run` on background service | **Yes, if** `serve` shares the background-service sessions (Phase 0 proves it) |
| cline | Own TUI (`cline -i`), no headless resume (`tui-surface.mjs`: `sharedSession: false`) | **No.** Needs its own client or a lane-retirement decision |
| gemini | API-only, single-shot, no terminal at all | **No terminal to replace** — the Telegram chat itself is already its surface |
| freebuff | TUI/login only, no one-shot, no serve/ACP (`lane-contract.mjs`: TG lane is opt-in tmux scrape) | **No.** Terminal is its only driver; removal = retiring the lane |

## Phase 0 — prove session sharing (gate for everything below)

- Start `opencode serve` on a test localhost port; compare its session list
  against the bot's known `ses_*` (bot `run` path + TUI sessions).
- PASS = web UI shows the same conversations the TUI shows. FAIL = stop here;
  web UI becomes a second inbox, not a replacement, and the roadmap changes.

## Phase 1 — serve behind the gateway (TUI untouched)

- `opencode serve --hostname 127.0.0.1 --port <P>` as a user systemd unit
  (same pattern as `tui-ttyd-<id>.service`); `OPENCODE_SERVER_PASSWORD` set,
  held in gateway env like today's ttyd credential — browser never sees it.
- Gateway route + Caddy host (e.g. `web.health-tracking.duckdns.org` with
  `forward_auth` to the gateway, mirroring the `/tty/ws` block). Subdomain, not
  sub-path: the web UI is a SPA with absolute asset paths.
- Mini App gains a second button (`🌐 Web` next to `⌨️ Terminal`). Both live,
  same auth, same sessions (per Phase 0).

## Phase 2 — web UI primary, TUI fallback

- Reorder/emphasise: Web button first; TUI stays one tap away.
- Collect the gap list from real use: approvals UX, diffs, MCP/tool visibility,
  anything the TUI does that web doesn't. Each gap is a line item, not a vibe.
- Retune-or-freeze decision on `TOUCH_SCROLL_JS`: if web is primary, the bridge
  only needs to be tolerable, not delightful — timebox it.

## Phase 3 — per-lane replacement analysis (feeds the gate)

- opencode: done by Phase 1+2 if no open gaps.
- cline: either a Cline-compatible client appears, or chats on cline lanes keep
  a terminal — document which.
- gemini: no action (chat is the surface); confirm nothing in the TUI flow
  depends on a gemini terminal (there is none: `terminal: false`).
- freebuff: explicit decision — terminal-only lane means TUI removal retires
  freebuff from Telegram. Owner signs that off, or the TUI stays for it.

## Phase 4 — TUI removal gate (all must hold)

1. Phase 0 PASS (shared sessions, still true after updates).
2. Zero open Phase-2 gaps, or each waived in writing.
3. Cline chats have a client or a retirement note.
4. Freebuff decision recorded (kept → TUI stays for that lane; retired → lane
   contract + `/freemodel` updated in the same change).
5. Sensors updated: `assert-tui-gateway*` expectations, gateway route tests,
   Caddy/gateway docs; ttyd units disabled, ports closed, credentials rotated.

Until all five hold, **ttyd stays**. Partial removal (some bots, some lanes) is
allowed only if the gate table says which lane keeps it and why.

## Rollback

Every phase is reversible: Phase 1 adds without removing; Phase 2 is button
order; Phase 4 disabling is a unit stop + Caddy comment-out, reverted the same
way. No data migration at any step (sessions live in the opencode service).
