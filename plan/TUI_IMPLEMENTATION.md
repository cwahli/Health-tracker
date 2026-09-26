# TUI implementation plan

**Proposal:** `TG_Tui_Proposal1.md` (final). Do not implement `Tui_proposal2b.md` in its own order.
**Done:** the scorecard at the bottom is complete. Every row is green on a live run. A skip is not a pass. The author of a patch does not mark its row.

This is not the website master scorecard (`npm run scorecard:debug`). Do not edit `golden/scorecard/` to make this green, and do not call the website scorecard a substitute.

## Rules

1. One step at a time. The scorecard row for that step is green before the next step starts.
2. Restart the process under test from the commit you are proving. Record `MainPID` and `ActiveEnterTimestamp`.
3. Send commands through Telegram to the live bot. A unit test may stay. It cannot close a row.
4. Paste this on every row. A missing line leaves the row open.

```text
UTC:
Process and MainPID:
Command or URL:
Raw reply or bytes read back:
Side-effect command:
Side-effect output:
Negative check:
Negative-check output:
```

5. Read bytes back over the public URL. A screenshot is not the bytes.
6. Do not dual-poll a token. Do not deploy the website. Do not push the coder's commit to `origin/main`. Do not spend the real free-model allowance to prove a 429. Use a ledger copy. Do not compile `node-pty` on the phone.

## Already true

- `scripts/mobile/tui-attach.sh` prints `ids[0]`, the first session in the map, not this chat's session.
- `scripts/mobile/miniapp-shim.mjs` holds the gzip, `permessage-deflate`, `Origin`, and `Upgrade` fixes, and also the password form. Keep the four fixes. Remove the password.
- `scripts/lib/work-session.mjs` names the stable view `work-view` and `workViewTarget(sessionId)`.
- `stampDepleted` and `trackRunQuota` already record a quota error. Bot-host does not yet walk to the next lane. The 2026-09-25 12:29Z Muse `429` was pasted into the chat as raw JSON.
- Caddy already serves `health-tracking.duckdns.org`. The TUI does not go on that hostname.

## Step 1 — this chat, and a button that still means something

**Change.** `tui-attach.sh` selects the session stored for the chat id it was given. Add **Stop and type** to the injected page. It aborts the active turn. `/tui` with an empty URL file offers the last URL this process handed out and says the tunnel is reconnecting, until step 2 deletes the tunnel.

**Row S1.** Two chats. Each `/tui` attach shows its own `ses_` id. The other chat's id is absent from `ps` and from the ttyd command line.
**Row S2.** Press Stop during a live turn. The turn's child exits. The event feed remains. The keyboard is not yet the PTY.

## Step 2 — stable URL and a one-time ticket

**Change.** A new hostname on the existing Caddy, for example `tui.<the duckdns name>`. It proxies only to the gateway. The gateway runs beside the relay, not inside it. First request carries `initData`. The gateway checks HMAC with **that bot's** token, constant-time compare, `auth_date` within five minutes, skew of 60 seconds into the future allowed. It returns a session token bound to `(bot, chat)` with a short life. Later sockets send only that token. Wrong bot token, stale `auth_date`, and a replay after the window are rejected. The raw `initData` is not logged. The website origin does not serve this route.

**Row S3.** A button sent yesterday still opens today. Bytes read back from the public URL contain the event feed, not a password form and not a dead tunnel host.
**Row S4.** A forged or two-hour-old `initData` gets a refusal. A second socket that resends the original `initData` after the window is refused. A session token from bot A does not open bot B's chat.

## Step 3 — event feed by default, one pane per chat

**Change.** Opening `/tui` shows the event feed for this chat (the same facts `/watch` already has). It does not open a PTY. Two chats resolve to two `work-view` windows. An owner that is offline holds and says so. The turn is not run on the VM.

**Row S5.** Chat A and chat B are open. `tmux list-windows -t work-view` shows two windows. Typing a marker in A's feed never appears in B.
**Row S6.** `/location mobile` with the phone disconnected. The page says unreachable. No new `opencode` or `cline` process is parented by the VM bot. The VM ledger mtime is unchanged.

## Step 4 — PTY on the VM only, after Stop and type

**Change.** Stop and type aborts the turn, then attaches ttyd to this chat's `work-view` window. Protocol is ttyd's, over the local socket. Inherit the four shim fixes and prove each one with bytes, not a comment. One client at a time. Detach does not kill the pane.

**Row S7.** After Stop and type, `tmux capture-pane -t work-view:<this chat's window>` shows the OpenCode TUI, or the Cline screen if that surface was selected. Detach and attach again. The same pane is still there. A gzipped page read back is valid UTF-8, not replacement characters. A socket that offers `permessage-deflate` is refused.
**Row S8.** On a phone, with the keyboard open, the last line of the TUI is visible. `100vh` must not cover it. This is a byte or a DOM measurement from the page, not a photograph alone.

## Step 5 — quota walk, then roam

Do not start this step until phase 1 (R-14.1) and rows S1–S8 are green. This step is the R-16 exam in `plan/ROADMAP.md`, not a second roam. S9–S11 are rows of that same pass.

**Change.** A quota or rate-limit error writes `depletedUntil` through the existing `trackRunQuota` / `stampDepleted` path and the chat selects the next selectable lane on that same worker. The raw `INFERENCE_CAP_ERROR` JSON is not the reply. An `ended` promotion is never offered. A connection failure gets one retry, then a cooldown. Only an empty selectable list changes location. The pack is the files on disk. If another lane still has allowance it may write the short summary. If none do, the disk pack is sent and the reply says the summary was not written. The dead lane is not called.

Roaming, after that, is OpenCode only: `export` on the way out, `import` on the way in, same session id, directory rebound to the target checkout. The gateway may keep the browser socket open. The screen is a `capture-pane` repaint and the banner says the session survived and the screen did not. Cline and Grok stay on the event feed. They do not pretend to export an OpenCode session.

**Row S9.** On a ledger copy, a quota-shaped error on lane 1. `/allowance` shows it depleted with the vendor retry time. The next message names lane 2 and stays on the same host. The real user ledger mtime is unchanged. Repeat until the list is empty. The following reply names the next connected host or says no location has quota.
**Row S10.** With every lane on the current host empty, the pack exists on disk and the reply says whether a summary was written. The failed model was not invoked. `ps` shows no new call on that model.
**Row S11.** `/location` to a connected host while the Mini App is open. The socket stays up. The banner says the session survived and the screen did not. After the repaint, capture-pane on the VM `work-view` shows the tool now running on that host. The OpenCode session id matches the id from before the move. A Cline turn during the same drill stays on the event feed and does not call `opencode export`.

## Step 6 — scorecard

The second pass runs every row below on one restarted gateway and one restarted `bot-host@vm`, in order, and fills the evidence block. The author of any step does not run this pass.

| Row | What green means |
| --- | --- |
| S1 | This chat's session only |
| S2 | Stop aborts the turn. The feed stays |
| S3 | Yesterday's button opens. Bytes are the event feed |
| S4 | Stale, forged, and cross-bot `initData` are refused |
| S5 | Two chats, two windows, no cross-talk |
| S6 | Down host warns. The VM does not run the turn |
| S7 | PTY capture is the tool's TUI. Deflate refused. Gzip decodes |
| S8 | Phone keyboard does not cover the last line |
| S9 | 429 stamps and the next lane is on the same host. No raw JSON |
| S10 | Empty host sends the disk pack. The dead lane is not called |
| S11 | OpenCode session id survives. The screen is a stated repaint. Cline does not export |

Rows S1–S11 are checkpoints. They are not a second scorecard. Paste the evidence into `plan/ROADMAP.md` R-16, rows QS-1–QS-15. That table is the only done gate. The website master scorecard is a different gate and is not moved by these rows.
