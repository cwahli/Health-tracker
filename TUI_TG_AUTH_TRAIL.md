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

## 2026-09-28: touch drag -> the app's own scroll keys (this branch)

Full screen solved; last complaint is that dragging does nothing. Chain
measured end to end before writing the fix:

1. Drag is inert: opencode runs with mouse tracking on and xterm's touch
   handlers bail while mouse is active (`if(!areMouseEventsActive) return`),
   and ttyd 1.7.7 ships no touch-to-wheel bridge.
2. Wheel is NOT the answer: sending ESC[65 / ESC[66 (SGR wheel) straight to
   the real opencode in tmux (`tmux send-keys -H`) left the view unchanged;
   PageUp/PageDown moved it. So a wheel-emitting bridge would have been a
   placebo — measured, not assumed.
3. xterm encodes keyCode 33/34 to ESC[5~/ESC[6~ and binds keydown on its own
   `.xterm-helper-textarea` with no isTrusted check, so a synthetic press is
   indistinguishable from a real one on the wire.

The bridge therefore pages: one PageUp/PageDown per third of the screen
dragged, `preventDefault` only once a drag is really scrolling (a tap still
types), multi-touch left alone for pinch-zoom, one extra page on a fast
flick, and the accumulator resets per gesture (a leftover remainder used to
carry into the next drag). Sensor 88->99.

## 2026-09-28: the drag bridge never attached (root cause, this branch)

Symptom: keyboard scrolls, dragging does nothing at all. Not a direction or
threshold problem — the listeners were never installed.

Measured: `__tuiAtLoad=false`. These scripts are injected at the end of
<body>, but ttyd mounts xterm AFTER its bundle boots, so
`document.querySelector('.xterm-screen')` was null at that moment and the
bridge bound its touch handlers to nothing, once, with no retry. The layout
pass had the same trap and only survived because its timed refits re-ran.

Second bug found while fixing it: these JS arrays were `.join('')`-ed, so
every `//` comment swallowed the code that followed it on the joined string
(the "Widen the container" block never ran in that form). All injected scripts
now `.join('\n')`.

Fixes: poll until `.xterm-screen` exists then bind (re-binds if xterm is
re-created), focus the textarea before synthesising a key, arm the
ResizeObserver lazily once the container exists. Sensors pin the load-order
trap explicitly: a document without the terminal must get NO listeners, and
the same bridge must bind once it appears. 99->100.

## 2026-09-28: paging granularity measured, lag fixed (this branch)

User: it scrolls, but so slowly it looks stuck. Two wrong tests of my own
first (hashing the whole pane caught a footer repaint; and paging DOWN from
the bottom is correctly a no-op). Corrected measurements, full-pane diffs,
read-only:

- PageUp MOVES the view (32 lines differ).
- A 3-key PageUp BURST registers — no coalescing, so keys can be dense.
- `ctrl+alt+y` (line scroll) does NOTHING — pages are the only granularity the
  installed opencode offers.

So the lag was my threshold, not the mechanism: a page fired only after a
third of the screen (~280px). Now a page fires per EIGHTH (~87px), at most 3
keys per touchmove so a fast drag is never throttled, first response inside a
short flick. Sensors 100->102.

## 2026-09-28: one line per line of drag — natural scrolling (this branch)

User: still laggy, wants it natural. The quantum was the problem, not the
mechanism, so I measured the whole ladder instead of guessing. Each row =
exact bytes sent to the real opencode in tmux, rows moved = pane diff:

| key | bytes | rows moved | browser-reachable? |
| --- | --- | --- | --- |
| alt+ArrowUp / alt+ArrowDown | ESC[1;5A / ESC[1;5B | 2 (= 1 line) | YES, verified on the wire |
| ctrl+alt+u / ctrl+alt+d | ESC 0x15 / ESC 0x04 | 16 (= half page) | yes |
| ctrl+alt+b, PageUp | ESC 0x02 / ESC[5~ | 30 (= page) | yes |
| ctrl+alt+y (documented line UP) | — | 1 line in tmux | **NO: xterm never sends it** |
| ctrl+alt+k/t/p/z/r, ctrl+alt+ArrowUp | — | no movement | yes, but dead |

So one line is both the finest step the app has and the finest pair a browser
can deliver. The bridge now emits one alt+Arrow* per line-height of drag
(step = viewport/48, no baked font or screen size), max 6 per touchmove, plus
a decaying fling capped at 12 lines.

Verified on the LIVE page with real touch events and CDP frame capture: a
300px drag puts 33 one-line commands on the wire, `ESC[1;5B` on drag up and
`ESC[1;5A` on drag down. Sensor 102->103.

Also learned: a 401 on the page's own `/tty2/token` is the cookie, not the
query token — headless checks that skip the landing 302 get a refused socket
and send nothing, which is why the first live probe read "no bytes".

## 2026-09-28: it stopped scrolling because I picked a key that fires once

Symptom: "not scrolling again", right after the change that made it finer.
The obvious suspect was my own rate, so I measured REPEATABILITY instead of
guessing: fire 4 keys at 300ms into the real opencode, count what lands.

| key | moves | applied of 4 |
| --- | --- | --- |
| alt+ArrowUp / alt+ArrowDown | 1 line | **1 of 4** — fires once, then dead |
| ctrl+alt+y (documented line up) | 1 line | n/a: xterm never sends it |
| ctrl+alt+e | 1 line | **4 of 4**, at any rate |
| ctrl+alt+u / ctrl+alt+d | half page | 4 of 4 at 300ms |
| ctrl+alt+b, PageUp | full page | 3 of 4 |
| 45 line keys flat out | — | moved ~1 line in total |

So the "1 line each way" build was sending keys the app honours exactly once
per view. That is why scrolling looked dead, and it is the opposite of the
previous complaint (half pages, which scroll fine but feel steppy) — the two
symptoms had two different causes.

Fix: down = ctrl+alt+e, one line per step, unpaced (it never drops). Up =
ctrl+alt+u, one half page per step, paced to 300ms (that is the rate at which
it lands 4-for-4). No page-key nudge: repeats say a half page is enough, and a
page nudge would jump 30 lines.

Live proof: a 300px drag up puts 22 `ESC 0x05` frames on the wire; the same
drag down puts exactly 1 `ESC 0x15` (paced). Sensor 103->104.

Honest limit: this is the finest scrolling this app can do from a browser —
one line down, one line up only if the key repeats (it does not), so up is a
half page. A truly 1:1 scroll in both directions would need the app to accept
a repeatable line-up key, which is an opencode change, not a gateway change.

## 2026-09-28: "Done (exit 1), but the model returned no text output" (unrelated to TUI)

The user typed "hi" and got that message. Not a TUI fault and not corruption:
the opencode server log shows the bot's own run dying at spawn.

    cli process failed cause="Fail(~effect/cli/CliError/ShowHelp: Help requested)"
    args=["run","--format","json","--print-logs","--log-level","ERROR",
          "--thinking","--variant","xhigh","-m","opencode/space-bunny-free", ...]

Two argv defects against the installed CLI (2.0.18), each fatal on its own:

1. `--variant` no longer exists. The variant is part of the model string
   (`provider/model#variant`). An unknown flag makes the CLI print help and
   exit 1.
2. `--log-level ERROR` is the wrong case. The enum is
   all|trace|debug|info|warn|warning|error|fatal|none, so "ERROR" is an
   InvalidValue -> help -> exit 1.

Either one alone gives exit 1 with zero stdout, and the bot's only honest
report is "no text output". The old unit test pinned the broken argv, so the
bug was locked in; it now pins the correct contract, and
`assert-model-failover` gained a live guard so the class is gated even in a
worktree with no vitest (node_modules is empty here, so tests/bot-host.test.ts
could not be executed — the assert-* sensors could).

Proven with the real CLI: same command, exit 0 and real text output ("ok"),
before exit 1 and nothing. bot-host@vm2 restarted on the fix.

Separately, the attach script's wait banner said "...or the conversation gets
corrupted", which the user read as the TUI being corrupt. Reworded: it says a
bot turn is running, the terminal attaches when it finishes, and that is why
it waits rather than typing over the top.

---

## 2026-09-29: all of the above came back. Here is why, and what stops it.

The user hit the same bugs again, one after another, in one afternoon:
`hash mismatch` on a fresh /tui, then "press enter to reconnect", then a TUI
that was not scrollable and not fullscreen. Every one of them had already been
fixed and sensor-green. The cause was not any single defect — it was **where
the fixes lived**.

### The class: an unlanded fix reads as a done fix

`fix/tui-telegram-auth` carried 16 commits (PR #315, handover commit
`5434923`, marked "open failure fixed"), with 60+ sensor cases green and a
detailed trail right here. It was never merged. Main kept serving the broken
page, and on 2026-09-29 all of it had to be re-fixed by hand against a phone:

| Symptom | Cause | Where it was fixed before |
|---|---|---|
| `hash mismatch`, fresh /tui | validator excluded `signature` from the check string; current clients include it | `9ce3990` (branch) |
| "press enter to reconnect" | gateway 404'd `/tty/token` / `/tty2/token`, so ttyd killed every socket with a missing AuthToken | `976c48d` (branch) |
| reconnect loop, banner but no terminal | `tui-attach.sh` backgrounded the tmux client, which dies with "not a terminal" | `976c48d` (branch) |
| "the bot is answering" on an idle chat | `lease_held` exits 1 while held; the wait loop used it un-negated, and the reader looked for a heartbeat bot-host never writes | `dec3e28` (branch) |
| not scrollable, not fullscreen | no phone viewport, Telegram ate one-finger pans, no fullscreen widget, tmux status row | `c26d538` `db95cc8` `0604e5e` `bbe7b0e` … (branch) |

A useful tell: on 2026-09-29 `grep` for the word "signature" in the repo found
nothing in the TUI code. The fix existed, in a file the service never ran.
**Sensors prove what main contains. Nothing here proved what main had.** That
is the gap the ratchet below closes.

### The lock, in three parts

1. **The TUI sensors run in CI.** `scripts/assert-tui-gateway.test.mjs` (114
   cases) and `scripts/assert-tui-chat-select.test.sh` (24) were local-only.
   They are now named gates in `.github/workflows/ci.yml`, so dropping the
   fullscreen widget, the token routes, the lease polarity or the signature
   shape turns CI red instead of turning the user's phone broken.
2. **`scripts/assert-tui-fixes-landed.mjs` — the unlanded-fix ratchet.** For
   every remote branch it lists commits the base does not have, limited to the
   TUI files, and fails on any older than `--max-age-hours` (default 24). A
   commit whose file content is already in the base counts as landed-by-
   another-route, so cherry-picks do not cry wolf. Fresh work in flight is not
   a failure; that is the whole difference between a ratchet and a nag. Run it
   in CI on the same event as the sensors.
3. **This file.** The measurements live here: drag pages a line per line of
   drag, one eighth of the screen per page, keys that actually repeat, the
   `disableVerticalSwipes()` call (no CSS can fix Telegram's sheet gesture),
   the geometry readout behind `tui_measure=1`. Re-deriving those costs a
   phone and an afternoon.

### Rules that follow

- A fix on a branch is **not** a fix. It is a fix once it is in the base, or
  the branch is deleted and its work re-derived on the base.
- A sensor that is not in CI is a local note, not a gate. Every new TUI case
  goes into the two files CI runs, not into a scratch script.
- When a /tui bug is reported, grep this file first, then
  `git log --all --oneline -- <tui file>` before measuring anything. Both
  times on 2026-09-29 the answer was already written down.
- Landed on main as `9641a2e` (TUI files from the branch, plus the refusal
  logging from `a75c75e`, minus the branch's older `serverJobs`/router work
  which would have reverted `59cc9d0`).

### Still unlanded on that branch (not TUI, not fixed by that commit)

- `2bf613a` "the run argv is rejected by the opencode CLI, so every turn
  failed" — **CONFIRMED REAL and landed 2026-09-29** (see below). It was not
  a TUI bug at all; it only surfaced while chasing them.
- `6d5952f` pull_shot reads `SHOT_TOKEN` from `~/.config/shot-bridge.env` —
  landed 2026-09-29.
- `5434923` the handover note, superseded by this section.

## 2026-09-29: `2bf613a` verified — every turn really was dying at spawn

Landed as `fix(bot): the run argv was rejected by the CLI, so every turn
failed`. Confirmed against the installed CLI (opencode 2.0.18) on this box,
not taken on the branch's word:

| argv | result |
|---|---|
| `--log-level ERROR` | `InvalidValue: Expected "all" \| "trace" \| … \| "error" \| "none"`, exit 1, **no stdout** |
| `--variant high` | prints help, exit 1, no stdout |
| `--log-level error -m provider/model#high` | exit 0, real text output |

Both failures look identical from the bot's side: `Done (exit 1), but the
model returned no text output`. The live prefs had `variant: xhigh` set, so
the `--variant` half was live on the running bot — every turn would have hit
it. Main had both bugs; the branch's fix is now on main.

One extra defect found while verifying, not on the branch: `extractLogError()`
matched `/level=ERROR/`, but the log level is now requested in lowercase (the
enum's own case), so the CLI writes `level=error` and the pattern would have
matched nothing — the user loses the reason a turn failed at the exact moment
they most want it. Now case-insensitive, with a test for the lowercase
spelling.

The lesson is the same one as the rest of this file: a claim on a branch is
not evidence. `2bf613a` sat unlanded for 25 hours with "every turn failed" in
its subject line, and the thing that proved it was running the installed
binary, not reading the commit.

## 2026-09-30: lane-shared page-key scroll + multi-client TUI (branch `fix/tui-scroll-multiclient`, commit `3d105884`)

Two user-facing defects, one branch:

1. **Mobile scroll dead on the VM bot, fine on VM2.** Root cause: the
   terminal is per-lane (opencode OR cline, chosen at attach time in
   `scripts/lib/tui-surface.mjs`) and the lanes scroll on DIFFERENT keys —
   opencode `ctrl+alt+b/f/u/d/y/e` (docs: https://opencode.ai/docs/nb/keybinds/),
   cline `ctrl+meta+b/f/u/d` + `ctrl+g` (`TRANSCRIPT_KEYBINDS` in
   `sdk/apps/cli/src/tui/hooks/transcript-keybinds.ts`). The old
   `TOUCH_SCROLL_JS` bridge sent only `ctrl+alt+e/u`: opencode scrolled, a
   cline lane felt dead. Same gateway, same phone — the lane in front
   differed. Fix: the bridge sends bare PageUp/PageDown, the one binding
   both lanes share (no modifiers for xterm to swallow), paced to 300ms,
   max 3 per touchmove, fling capped at 6. Sensors rewritten to pin the
   shared-key contract (`assert-tui-gateway` 121/0).
2. **Second device stuck on "tap Enter to reconnect".** Root cause: both
   ttyd units ran `--max-clients 1`. ttyd spawns one `tui-attach.sh` per
   browser client and both attach to the SAME tmux session — so the desktop
   held the only slot and the phone got no PTY, overlay forever. Fix
   (multi-open, not kick-the-other): `--max-clients 0` on both units;
   `cleanup()` only clears the lease when `tmux list-clients` is 0;
   `aggressive-resize on` so the pane sizes to the largest client. Sensors
   10b–10d in `assert-tui-chat-select` (50/0).

### For the next agent: NOT done — verify before merging

- [ ] **Deploy first, then prove.** `sudo cp scripts/tui-ttyd-vm.service
      scripts/tui-ttyd-vm2.service /etc/systemd/system/ && sudo systemctl
      daemon-reload && sudo systemctl restart tui-ttyd-vm tui-ttyd-vm2
      tui-gateway`. The VM still runs the old units until this happens.
- [ ] **Live phone proof, both lanes.** Desktop `/tui`, then mobile `/tui`
      (both share the session — task 2). Drag-scroll on an opencode chat
      AND a cline chat (task 1). `/tui status` correct while both attached
      and after the first detaches.
- [ ] **Known gaps, in priority order:**
  1. Scroll is now page-granularity, not line-granularity — the price of
     the only key both lanes share. Follow-up: lane-aware bridge (gateway
     reads the chat's `tui-open.json` surface, serves ctrl+alt for opencode
     / ctrl+meta for cline).
  2. tmux session is per-bot (`VM-tui`, `VM-tui-vm2`), not per-chat. Two
     different chats on one bot share a terminal — multi-device works,
     multi-chat collides. Per-chat sessions would fix it but change the
     attach/lease contract.
  3. PageUp/PageDown pass-through is assumed from docs + xterm behaviour,
     not measured by firing bytes into the installed cline binary (the way
     the old opencode numbers were). The live test above is the proof; if
     cline's opentui build swallows them, go lane-aware (gap 1).
  4. Confirm the `assert-tui-chat-select` CI job runs on the PR — the new
     10b–10d cases only gate if the script runs.

## 2026-10-07: `origin/agent/status-all` was superseded, not stranded — deleted

The unlanded-fix ratchet flagged this branch (`0c07f6ff`, 25h old) and it blocked
**every** agent PR: `tsc + named gates` fails on the base, so `merge-agent-pr`
refuses each one. Someone had to judge it. Measured, rather than assumed:

- **The branch's namesake work is on main verbatim.** `d87805dc` (autocomplete +
  parsing) and `9dd90299` (the scope-matrix row) added `status_all` in three
  places; main carries all three byte-for-byte — `scripts/lib/commands.mjs`
  `BOT_COMMANDS`, `HELP_USAGE` and the `parseCommand` special case, plus
  `bots/capabilities.json` — and `scripts/bot-host.mjs` has the `case
  'status_all'` arm those commits shaded in.
- **Its other half was re-derived, not lost.** `662b36ce` fixed the /freemodel
  depleted-tap reply (one verdict, one "Next up"): the same defect #587 landed a
  day later by another route, where the reply calls the table's own picker
  (`nextUsableLane`) — that is *why* the two agree. Main carries it.
- **What was left, and why it was dropped.** `meta.nextUp` (redundant with
  `nextUsableLane`), `let resetIn = null` (main's `resetInBit` already words an
  unknown reset), the Freebuff line's copy, and 60 test lines covering the meta
  channel. One deserves naming: the union verdict
  `Boolean(verdict?.depleted) || isFreemodelEntryDepleted(...)` marks a lane
  depleted when a stamp exists under **another spelling of the route** — and two
  spellings of one model are not always one pool (the paid Go plan's bunny vs the
  free one). Projection-first is the deliberate choice on main; re-litigating it
  here would re-open a class that was closed the same day.
- **Reverse-apply check:** `git diff origin/main...origin/agent/status-all |
  git apply --check --reverse` does **not** apply, so the branch's diff is not
  simply main's — the difference is the four items above, each either already on
  main by another route or a competing implementation, not missing behaviour.

Deleted 2026-10-07 (tip `0c07f6ff`; commits `d87805dc`, `9dd90299`, `662b36ce`,
`0e21a30d`). No waiver line was added, deliberately: `scripts/tui-stranded-
exceptions.txt` says a branch that no longer exists cannot strand work and a
waiver for it is just debt. If the Freebuff wording is wanted back, it belongs in
`formatCompactAllowanceChat` as a fresh change driven by the projection's
`terminalOnly` verdict, not by a hardcoded promo duration.
