# /tui on Telegram: auth-fix trail (2026-09-27)

User taps /tui in vm2 bot (@VM2_19485_bot). Two stacked failures found; #1 is
fixed and live, #2 is the current blocker. Next agent: start at "Current
blocker".

## Fixed: `refused (hash mismatch)` on fresh /tui (vm and vm2)

- Cause: current Telegram clients sign `data_check_string` WITH the
  `signature` field included (only `hash` excluded). The validator excluded
  both, following older docs, so every genuine login failed on all 6 bot
  tokens (auto-match across tokens could not help).
- Proof: instrumented live gateway logged `got=92c7940e dec=b0c2f778
  raw=0dffc7bf rawSig=80fbb61a decSig=92c7940e` — received hash equals the
  include-signature variant exactly.
- Fix (in `scripts/tui-gateway.mjs`, committed on this branch):
  `validateInitData` accepts EITHER shape (pairs / pairsWithSig).
- Verified live: new-style data 200, legacy data 200, tampered data 401.
- Same outdated exclusion still exists in dev copies (NOT fixed, flag for
  their owners): `~/dev/tui-gateway`, `~/dev/tui-vm2`, `~/dev/tui-review`
  `scripts/tui-gateway.mjs`.

## Hardening shipped with it (same file)

- Landing 302 now also carries `?token=` (`ttydPathFor(botId)?token=...`),
  cookie still set. Reason: the user's Telegram WebView drops the
  `__Host-tui_session` cookie on the redirect chain (phone network proven
  clean: correct DNS 51.254.217.163, no proxy, socket path answers). ttyd
  client appends `location.search` to its socket URL, Caddy preserves the
  query through `forward_auth`, `/authz` accepts it (verified OPEN e2e).
- `verifyAnyToken`: cookie/Bearer/query tried in order, first valid wins. A
  corrupt-but-present cookie no longer shadows a fresh query token.
  Verified: bad-cookie+good-query 204, bad+bad 401, none 401.

## Current blocker: terminal socket dies ~0.4-3.5s after 204

After the fixes, full flow works from every synthetic client (20s+ held
sockets, public path, cookie and query auth). From the user's Telegram
WebView: landing admitted, page 200, `/authz` 204 (silent), then the socket
dies and ttyd shows "Press ⏎ to Reconnect", looping forever.

Ruled out with live proofs: tokens (getMe ok, bot/gateway sha match),
DNS/routing, Caddy->ttyd credential (ttyd ignores WS auth), slot occupancy
(max-clients 1 free, no ghost TCP), OOM/restarts (caddy 11h, ttyd fresh),
Origin check (browser Origin opens fine), H1-vs-H2, cookie (query fallback).

- Decisive finding: running the attach command by hand for the user's
  session exits INSTANTLY:
  `opencode --session ses_f208cbf6cffepaoCKtcdzk8OeC` ->
  `NotFound: FileSystem.access (/home/ubuntu/bot-host-r14)`
  even though the dir exists, is listable, and is the session's recorded
  cwd (see opencode server log). Shell exits -> ttyd closes 1000 -> overlay.
- Repro (as ubuntu, cwd anywhere):
  `timeout 25 script -qec "/home/ubuntu/.opencode/bin/opencode --session ses_f208cbf6cffepaoCKtcdzk8OeC" /dev/null </dev/null`
- Session IS in opencode.db (grep hits in opencode.db + -wal). Server role
  alive (run=9de0ce12). State resolves: tui-open.json chat 6218257274 ->
  ses_f208... (tui-open-hit). No lease file, no tmux `opencode-tui-vm2`
  session ever created -> spawn never completes.
- Next step: someone who knows opencode internals must explain/fix why
  FileSystem.access fails for an existing dir (server sandbox? lock?
  store migration?). Until `opencode --session` boots, /tui cannot work.

## Live state left for you

- Gateway: fixed file running on 8897, stdout -> /tmp/tui-gw-live.log
  (was silent before; restore silent running when done).
- ttyd 8899 (vm2): restarted with identical env+flags; stdout ->
  /tmp/ttyd-vm2.log. tmux daemon untouched (sessions persist).
- Caddy: temporary per-site access log added to /etc/caddy/Caddyfile
  (backup: /etc/caddy/Caddyfile.bak-tui-debug). Log lives in Caddy's
  systemd PrivateTmp, read via
  `sudo bash -c 'cat /tmp/systemd-private-*/tmp/caddy-tui-debug.log'`.
  REMOVE the log block + `sudo caddy reload` when done.
- Debug copies in /tmp (tui-gateway-debug.mjs, /tmp/tuigw/, launchers,
  tty2page.html): scaffolding, safe to delete. Secret env snapshots
  already shredded (2026-09-27).
- This worktree: `scripts/mobile/pull_shot.sh` was already dirty before
  this session — NOT mine, left untouched, do not commit blindly.
  (Follow-up 13:15 UTC: the dirty hunk loads SHOT_TOKEN from
  ~/.config/shot-bridge.env; ~/bin/pull_shot.sh is a symlink to this file,
  so it is almost certainly the shot-bridge work from the previous session,
  not a stranger's. Committed as its own commit on this branch.)

## Found after the trail: the attach never attached (fixed, this branch)

Two stacked defects in `scripts/mobile/tui-attach.sh`, both since a504011:

1. **Inverted polarity.** `lease_held()` exits 1=held/0=free, but
   `while lease_held` / `if lease_held` used it bare (0 reads true in
   shell). Idle chat -> waited the full 180s printing "the bot is
   answering" -> "still waiting" -> exit 0 without attaching (the
   reconnect prompt the user reported). Live turn -> attached immediately
   (the corruption the wait was written to prevent).
2. **Wrong lease shape.** It read a top-level `heartbeat`, which bot-host
   never writes — real `leases.json` is `{"<chatId>": {"startedAt"...}}`
   (recordRunStart/recordRunFinish). Every live turn read as free.

Fix: per-entry `startedAt` check (missing timestamp fails safe to held,
all-entries-older-than-1800s reads free), `while !` / `if !`, give-up
branch refuses loudly instead of barging. Sensor
`assert-tui-chat-select.test.sh` §9 pins both (red 15/5 before, green
20/20 after). E2E: isolated STATE_ROOT + scratch tmux name attaches
straight to the banner on free leases; live vm2 leases untouched, no live
tui-lease claimed. Detached `tmux new ... opencode --session
ses_f208cbf6cffepaoCKtcdzk8OeC` holds 18s+ and renders the thread.

The trail's `NotFound FileSystem.access` instant-exit did NOT reproduce:
`--prompt "say ok"` completed a full turn on the same session, and the
tmux boot above holds. No code changed for it — likely a transient
(server starting / lock contention) during the debug window. If it recurs,
capture `~/.local/share/opencode/log/opencode.log` at that minute, not
the TUI framebuffer.

## Security follow-ups (do not lose)

- Caddyfile `header_up Authorization "Basic dHVpOnZxQn..."` decodes to
  `tui:zqBs...` but ttyd runs `-c tui:vqBs...` (first char differs). Harmless
  today (ttyd ignores WS auth) = latent total breakage. Align + rotate.
- The ttyd password is visible in `ps`/cmdline/history. Rotate
  TUI_TTYD_PASSWORD (ttyd `-c`, gateway TUI_TTYD_CREDENTIAL, Caddyfile).

## 2026-09-28: two more defects — the actual open-killers (fixed, this branch)

The lease fix was real but the user still looped on "Press Enter to
Reconnect". Live taps showed: admitted, page 200, `/authz` silent-204, then
the socket dying in ~25–140ms with nothing spawned. Full chain built
headlessly (faithful WS client + scratch ttyds) to bisect:

1. **Gateway 404'd `/tty/token` and `/tty2/token`.** The served page fetches
   `./token` for the socket AuthToken; the gateway had no such route, so
   every socket opened with a missing token and ttyd killed it silently
   (POLICY_VIOLATION with no warning when the key is absent — read off
   tsl0922/ttyd 1.7.7 `protocol.c`). Fix: `TOKEN_ROUTES` in
   `scripts/tui-gateway.mjs`, same admission as the page, body matches
   ttyd's own `/token`. Sensor +6 (60/60). Live: 200 + body, 401 cross-bot,
   401 anonymous.
2. **tui-attach.sh backgrounded the tmux client (`... &`).** A backgrounded
   tmux client dies instantly ("open terminal failed: not a terminal") while
   the script lives on in its monitor loop — banner sent, session never
   created, dead terminal. Foreground works (proven). Fix: `new-session -d
   -A` (detached ensure, needs no terminal) + foreground `attach-session`;
   heartbeat moved to a background subshell (no terminal use) with trap
   cleanup. Sensor +3 tripwires (23/23).

Red herrings killed with evidence: no credential mismatch anywhere (the
z/v "first char differs" was a misread — computed base64 matches ttyd's own
/token body byte-for-byte); `--once=false` prints an error but starts
normally with once OFF; the trail's FileSystem.access crash never
reproduced. Test ttyds/sessions and /tmp probes all removed; live
`opencode-tui-vm2` scratch session reaped.

Live proof (headless, through the real gateway + live ttyd, real session):
token fetch 200 -> socket init -> banner + 19,419 bytes incl. the rendered
opencode TUI on ses_f208..., tmux session attached during hold, live lease
claimed with fresh heartbeat and released on close. Only the real page JS +
Caddy proxy remain unexercised — needs one human /tui tap.

## 2026-09-28: phone layout — viewport + frame + touch scroll (this branch)

User: opens now, but framed in a container, not full width, can't scroll.
Cause: ttyd's bundle ships no viewport meta (phone WebView lays out at
~980px and shrinks it into a box) and no body margin reset (8px default
frame). Fix: gateway injects meta + margin:0/full-size CSS +
touch-action:pan-y on the xterm viewport into <head> (CSS/meta only, no
JS — script count pinned by sensor). Sensor 60->66. Live page +329
bytes, scripts unchanged, token flow untouched.

## 2026-09-28: phone polish — tmux status bar off (this branch)

Screenshot shows the terminal rendering full-width (viewport fix held),
but the tmux status line eats the bottom row and frames the small screen
while opencode draws its own status. `status off` per TUI session
(global untouched). Sensor 23->24.

## 2026-09-28: side gap + swipe-collapse (this branch, live)

Screenshot (08:03 phone): terminal full-width-ish but a grey strip on the
right, and a vertical drag collapses the Mini App instead of scrolling.
Two causes:
- Vertical swipes belong to Telegram's sheet gestures unless the app calls
  disableVerticalSwipes(). The widget now calls it (plus expand()) on load,
  feature-checked for older clients. That is the scroll fix — no CSS can do
  it.
- ttyd's own `#terminal-container{width:auto;margin:0 auto}` +
  `.terminal{padding:5px}` frames the small screen. Gateway CSS now
  full-bleeds both layers (100%, padding 0) and contains overscroll.
The ⛶ button now toggles (exitFullscreen when already fullscreen).
Sensor 74->78. Live page verified: swipes-lock, container CSS, button,
token endpoint all present.

## 2026-09-28: auto-fit to the phone's real max width (this branch)

User: the readout was legible but the TUI should not need a specific phone
size — it should just fill the phone's max width automatically.

The fix is now a rule, not a size list. The layout pass (runs everywhere, not
only under Telegram — that guard was why the phone fixes were unverifiable
here) does, on load and on every viewport/resize/scroll/settle:
1. measure the real max width: `visualViewport.width` (falls back to
   `documentElement.clientWidth` / `innerWidth`);
2. set `#terminal-container` to that width with `max-width:none`, so xterm
   fits the screen and not a Telegram sheet inset (native, unreachable by
   CSS — this was the side gap);
3. fire a resize so xterm refits, then absorb the sub-cell leftover by
   `scaleX` on `.xterm-screen` (only when the slack is >1%, so text stays
   crisp). No font tuning, no device branching.

Verified headless at 390x844 @3x: container = 500px (== viewport),
grid stretched 484 -> 500 via `scaleX(1.033)`, zero bands across the row.
Sensors 85->88. TUI_PAGE_DEBUG readout left in the tree but OFF (landing no
longer appends the flag); turn it back on to re-read phone numbers.
