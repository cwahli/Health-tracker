# Phone-side services (`scripts/mobile/`)

Everything the Android phone runs to expose a terminal inside Telegram. These
files used to live only in `$HOME` on one device, which meant they were
unversioned, unreviewable and lost on reinstall. They are here now; the running
copies in `$HOME` are what the wrappers execute, so keep the two in step or copy
from here after a reinstall.

## Topology

```
Telegram Mini App (WebView)
   │  https           ← cloudflared quick tunnel; hostname changes on reconnect
   ▼
miniapp-shim.mjs        127.0.0.1:8895   login form + cookie, /tui proxy
   │  http + WebSocket, cookie in hand
   ▼
ttyd                   127.0.0.1:8896   a real PTY, mounted at /tui
   │  tmux new-session -A
   ▼
tui-attach.sh          resolves THIS chat's session id, refuses to double-write
   │
   ▼
opencode               in /root/Health-tracker, in the proot ubuntu
```

One tunnel, one password, one surface. The bot's `/tui` reads the published URL
from `$HOME/.phone-miniapp-url`; if that file is empty the tunnel is down and the
bot says so instead of sending a dead button.

## The wrappers

| file | what it keeps alive |
| --- | --- |
| `start-phone-miniapp-shim.sh` | the shim (reads the password from the ubuntu env file; refuses to start without one) |
| `start-phone-tui-ttyd.sh` | ttyd, running `tui-attach.sh` as its command |
| `start-phone-miniapp-tunnel.sh` | the cloudflared quick tunnel, and publishes its URL for the bot |
| `tui-attach.sh` | run *inside* the PTY: picks the session, guards the lease, reaps a stale tmux session |
| `start-mobile-opencode-bot.sh` | the phone's bot-host |
| `start-mobile-worker.sh` | the phone's worker-agent (dials the VM relay over SSH) |
| `start-vm-relay-tunnel.sh` | `ssh -L 8890` to the VM relay, so no inbound connection to the phone |
| `start-phone-miniapp-web.sh` | **not running** — that was the `opencode web` surface, now removed |

Each wrapper takes a `flock`, logs to `$HOME/<name>.log`, and restarts its
service in a loop. Start them with `setsid ./<name>.sh &` from Termux; they must
survive the shell that launched them.

## What each piece is for, and what it cost to learn

- **The shim exists because a WebView cannot answer HTTP Basic auth.** ttyd
  cannot ask for a password in a way Telegram's WebView can answer, so the lock
  is an HTML form and an `HttpOnly` cookie, and ttyd is told to trust a header
  (`--auth-header`) rather than authenticate itself.
- **It injects three buttons** (fullscreen / keyboard / close). Those are
  `Telegram.WebApp` JavaScript APIs — no chat command can reach them, and ttyd
  knows nothing about Telegram.
- **It refuses `permessage-deflate` on the socket** and honours-then-restores
  compression on the page. A raw-socket bridge that half-relays a compression
  negotiation hands the browser frames it cannot decode; a page that is edited
  without decoding it first is a screen of replacement characters.
- **It re-points `Origin` upstream** and puts `Connection`/`Upgrade` back on,
  because ttyd's `--check-origin` and its WebSocket handshake both depend on
  seeing values that agree with the socket they arrive on.
- **`tui-attach.sh` resolves the session per attach**, because the bot rewrites
  its session per chat and `/new` moves it. It also kills a tmux session left
  over from a different one — `new-session -A` ignores its command when the
  session exists, and the tmux server outlives ttyd, so without that the first
  attach is stuck on whatever it was born with.
- **One writer at a time, in both directions, because the TUI *is* the chat's
  session.** The first cut refused to attach while the bot held a turn's lease,
  which dead-ended the user at exactly the moment they open the terminal: while
  chatting. It is now the other way round:
  - *bot turn in flight* → the TUI prints "attaching as soon as it finishes",
    polls, and attaches when the lease clears (up to `TUI_WAIT_SECONDS`).
  - *terminal attached* → `tui-attach.sh` publishes `tui-lease.json` with a
    15s heartbeat, and the bot **queues** chat messages instead of racing it,
    then drains the queue when the terminal lets go.
  - The heartbeat is what makes this recoverable: a lease older than 90s reads
    as free, so a phone that dies holding one cannot block the chat for good.


## Reinstalling on a new phone

1. Copy `scripts/mobile/` to `$HOME` and `chmod +x` the `.sh` files.
2. `npm i -g` nothing; the shim needs only Node (Termux) and `ttyd` in the
   proot ubuntu (`apt-get install ttyd`).
3. Start, in this order: shim → ttyd → tunnel. The bot and worker wrappers are
   the phone's own services and are independent.
4. The password comes from the ubuntu env file the shim wrapper reads
   (`/root/.config/opencode-bot/miniapp.env`, `OPENCODE_SERVER_PASSWORD`).
