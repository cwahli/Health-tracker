# TG TUI — final proposal

**Status:** the proposal to implement. Order and acceptance live in `plan/TUI_IMPLEMENTATION.md`.
**Date:** 2026-09-26
**Supersedes:** the sequencing in `Tui_proposal2b.md`. That file stays as history. Do not implement it in its own order. `Tui_proposal2.md` is deleted. Its text is in git history at `25f993c`.

## Decision

Ship a terminal that still opens tomorrow, then attach it to the tool that is actually running. Roaming across machines is last.

The Mini App URL stays on the VM, on its **own hostname**, not on `health-tracking.duckdns.org`. The relay stays on loopback. Workers dial out. The phone and Colab open nothing inbound. Pixels for a remote turn are a live relay of that worker's screen over the connection it already holds. The process does not move into the VM's tmux.

**Corrected 2026-09-29.** This paragraph used to read "OpenCode is the only tool with a curses screen. Cline, Gemini, and other API lanes are an event feed." Cline 3.0.65 has `cline -i`, and `cline -i --id <session>` resumes a thread — verified in tmux against a real bot turn. So the terminal follows the chat's lane: a Cline chat gets the Cline screen, an API-only lane (Gemini) still gets an event feed and an honest "no terminal for this chat", and a scraped PTY with a badge is still not a terminal. The rest of this paragraph stands: the event feed is what you see when you open `/tui`, and the PTY opens only after you press **Stop and type**.

One asymmetry is real and must not be papered over. OpenCode has a background server that serialises turns, so the bot and the terminal are two clients of **one** session and a turn shows up in both. Cline has no headless resume — measured on 3.0.65, `cline --id <id> --json` answers *"JSON output mode requires a prompt argument or piped stdin (interactive mode is unsupported)"* and `cline --id <id>` without a TTY answers *"interactive mode requires a TTY"*. So a Cline terminal resumes the **last** Cline thread and nothing after it, and the chat must never be told a turn is visible in it. The screen matches the tool; the thread does not, and both facts are said out loud. `scripts/lib/tui-surface.mjs` is the one place that decision is made, for the bot, the attach script and the sensors.

`initData` is a one-time ticket. The server checks the HMAC, the `auth_date` window (five minutes, plus 60 seconds of future skew), and the bot token of the bot that opened the app. It then issues its own session token, bound to that bot and that chat. The signed string is not sent again, not logged, and `initDataUnsafe` is never trusted. A captured `initData` must fail after the window. This is a shell, so the window is minutes, not the 24 hours used for ordinary Mini Apps.

A quota failure does not roam. It stamps the lane and takes the next selectable lane on the same worker. A location change happens only when that worker's list is empty. The pack is built from disk. The lane that just failed is not asked to summarize. OpenCode `export` / `import` is the roam step, and it is OpenCode-only. The session id survives. The screen does not. The banner says so. The pane is then a `capture-pane` repaint plus a new attach.

## What already failed, and must not regress

| Failure | Rule |
| --- | --- |
| Old `/tui` button opened a dead tunnel hostname | One stable URL on the TUI hostname. A button from yesterday still opens. |
| VPS polled the phone's token and Telegram returned 409 | One poller per token. A device-owned bot does not run on the VM. |
| A 409 restarted every 5 seconds forever | Back off 5 / 15 / 45 / 120 seconds. Reset only after a healthy run. |
| Gzip body edited as text | Decode, inject, re-encode. Never edit bytes you cannot read. |
| `permessage-deflate` relayed to the browser | Refuse it on the socket. Honour compression on the page. |
| `Connection` / `Upgrade` stripped | Put them back on the WebSocket upgrade. |
| ttyd rejected the browser `Origin` | Re-point `Origin` at the upstream ttyd. |
| TUI refused to attach during a bot turn | Opening the TUI shows the event feed. **Stop and type** aborts and takes the keyboard. |
| `node --check` passed after a function was deleted | Every route is exercised on the live process. |
| `tui-attach.sh` uses `ids[0]` | The session is this chat's id, not any chat's. |
| Password posted into the chat | No password form. No Basic-auth challenge. No credential in the transcript. |

The four ttyd fixes live in `scripts/mobile/miniapp-shim.mjs`. Retire its password auth. Keep the decode, deflate, Origin, and Upgrade behaviour inside the gateway. A raw socket that drops them paints replacement characters.

## Shape

```text
Telegram
  HTTPS  tui.<host>/tui/<bot>/<chat>     own hostname, Caddy, existing certificate pattern
       │
       ▼
VM gateway, beside the relay, not inside it
  initData once → session token
  event feed by default (the /watch stream)
  PTY only after Stop and type
       │
       ├── this host: ttyd on the work-view window for this chat
       └── other host: ttyd frames over that worker's outbound link
```

`work-view` and `workViewTarget()` in `scripts/lib/work-session.mjs` are the pane names. The live proof is `tmux capture-pane -t work-view` showing the tool's TUI after a project change and, after a location change, the relay of the tool on the other machine. A constant in the source is not that proof.

ttyd is the PTY server. Do not compile `node-pty` on the phone. Do not put ttyd's own password in front of the gateway.

## Order

The steps and the scorecard are in `plan/TUI_IMPLEMENTATION.md`. Steps 1 and 2 ship before any gateway feature that roams. Step 5 does not start until the allowance walk on the VM bot selects the next lane after a 429.

## Verification

A rendering screenshot is not a pass. `node --check` is not a pass. `assert-tui-roaming.test.mjs`, if it is added, is not a pass. The scorecard in the implementation plan is the pass, and only a second person, who did not write the patch, may mark a row green.
