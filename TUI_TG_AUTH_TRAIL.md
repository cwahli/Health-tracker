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

## Security follow-ups (do not lose)

- Caddyfile `header_up Authorization "Basic dHVpOnZxQn..."` decodes to
  `tui:zqBs...` but ttyd runs `-c tui:vqBs...` (first char differs). Harmless
  today (ttyd ignores WS auth) = latent total breakage. Align + rotate.
- The ttyd password is visible in `ps`/cmdline/history. Rotate
  TUI_TTYD_PASSWORD (ttyd `-c`, gateway TUI_TTYD_CREDENTIAL, Caddyfile).
