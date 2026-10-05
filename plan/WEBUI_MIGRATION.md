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
| grok (Grok Build CLI) | Headless prompts, no session resume (`lane-contract.mjs`); no TUI surface entry — `/tui` on a grok chat already opens an opencode terminal | **No.** No vendor web UI; nothing to point the Mini App at |
| freebuff | TUI/login only, no one-shot, no serve/ACP (`lane-contract.mjs`: TG lane is opt-in tmux scrape) | **No.** Terminal is its only driver; removal = retiring the lane |

## Phase 0 — prove session sharing (gate for everything below) — ✅ PASS 2026-10-04

- Started `opencode serve --hostname 127.0.0.1 --port 4101` (test instance,
  stopped afterwards); it held open the same `~/.local/share/opencode/opencode.db`
  the bot's `run` turns and the TUI use (verified via `/proc/<pid>/fd`).
- vm3's live chat session (`ses_ef7b4d…`, workspace
  `/home/ubuntu/src/Health-tracker`) exists in that db (`session_v2` +
  33 rows in `session_message`; 351 sessions total in the store).
- Bonus: the background service itself is `opencode serve --service`
  (same binary, same store) — a dedicated web `serve` is the same stack.
- Caveat: this build answers API paths with the SPA to unauthenticated curl
  (browser-cookie login is the evident path), so the gateway auth design
  (Phase 1) must handle login, not just forward Basic. Sharing itself is proven.

## Phase 1 — serve behind the gateway (TUI untouched)

- `opencode serve --hostname 127.0.0.1 --port 4096` as a user systemd unit
  (same pattern as `tui-ttyd-<id>.service`); `OPENCODE_SERVER_PASSWORD` set,
  held in gateway env like today's ttyd credential — browser never sees it.
- Gateway route + Caddy host (e.g. `web.health-tracking.duckdns.org` with
  `forward_auth` to the gateway, mirroring the `/tty/ws` block). Subdomain, not
  sub-path: the web UI is a SPA with absolute asset paths.
- Mini App gains a second button (`🌐 Web` next to `⌨️ Terminal`). Both live,
  same auth, same sessions (per Phase 0).

As-built 2026-10-05 (differs in two points — both forced by measurement):

- The JSON API lives under `/api/*` (page paths serve the SPA; basic auth is
  ignored everywhere else). Serve scopes `/api/session` by its cwd project —
  root the unit at `$HOME` so all workspaces' sessions are visible.
- Caddy does NOT proxy to serve directly: the gateway is the only thing that
  can exchange Telegram initData, so a direct proxy 401s with no way to log
  in. The gateway fronts the whole web host instead (same door, landing
  exchanges back to `/?token=`), injecting serve's Basic per request.

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
- grok: no vendor client exists and a grok chat's `/tui` already opens a
  mismatched opencode terminal — record whether grok chats use the TUI at all;
  if they don't, grok needs nothing from the gate.
- freebuff: explicit decision — terminal-only lane means TUI removal retires
  freebuff from Telegram. Owner signs that off, or the TUI stays for it.

## The universal question: one client for all five lanes?

There isn't one, vendor-side. opencode's web UI covers opencode; Cline,
Grok Build, and Freebuff ship TUIs-or-nothing; Gemini ships API-only. No
single screen spans all five, and no vendor is building it.

The universal surface already exists — it's the Telegram chat. bot-host's
runners (`runOpencode` / `runCline` / `runGemini` / TG lanes) already drive
every lane from chat; that path is lane-complete today and stays so
regardless of this migration. A *visual* universal client would mean building
a thin aggregator page on top of those same runners — one web UI, per-lane
adapters — which duplicates the chat without adding coverage. Recommendation:
universal = chat (keep), visual = opencode web for the opencode majority
(this roadmap), TUI retained while any lane in the table needs it.

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

## Status 2026-10-05

- Phase 0 PASS (session sharing proven at API level).
- Phase 1 host wiring live: `opencode-web.service` on 127.0.0.1:4096,
  `web.health-tracking.duckdns.org` issued and gated (401 without cookie).
- Blocker cleared: #549 (b2b-peer) merged 2026-10-05; stranded
  `agent/fleet-proof-shot` branch deleted (all its commits were already on
  main) and the fixes-landed ratchet is 0 fail.
- Left: merge this PR (#549 landed, main re-verified green), post-merge
  deploy (restart tui-gateway.service, flip the web. Caddy block to the
  gateway, restart bot-host@vm3 and drop the TEMP-TEST port in the r14
  tree), live phone test.
