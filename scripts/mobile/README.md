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
| `start-phone-shot-tunnel.sh` | the reverse tunnel that puts the phone's screenshots on the VPS's `127.0.0.1:7777` (see below) |
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


## Screenshot bridge (`shot-server.mjs` → tunnel → `pull_shot.sh`)

The box reads the phone's own screenshots: something takes a screenshot on the
phone, the agent pulls it over to the VPS, and reads it. Three files, one hop
each. `pull_shot.sh` lives here rather than in `$HOME/bin` so both halves of the
bridge are reviewed together — it is the half that runs on the VPS.

| runs on | file | job |
| --- | --- | --- |
| phone | `shot-server.mjs` | `GET /list.tsv` (name, mtime, size, stamp) and `GET /file/<name>`, on `127.0.0.1:7788` |
| phone | `start-phone-shot-tunnel.sh` | `ssh -R 127.0.0.1:7777:localhost:7788`, retried forever |
| VPS | `pull_shot.sh` | picks a shot, downloads it, verifies it, caches it in `~/shots` |

Nothing listens on the phone and nothing is published on the VPS: the phone dials
out, and `7777` is loopback on both ends.

- **Token.** `SHOT_TOKEN` must be the same on both ends or every pull is a 401;
  `openssl rand -hex 24` and put it in the env file each side already reads (or
  pass `--token`). `shot-server.mjs` *refuses* to start without one unless
  `--allow-anonymous` is passed explicitly, because an anonymous bridge serves
  every screenshot the phone holds — including whichever 2FA code is on screen at
  that moment.
- **Both ends have to notice a dead peer, and this was the actual outage.** The
  phone dropped off LTE without a FIN, so its ssh session stayed half-alive on the
  VPS and kept holding `127.0.0.1:7777`; the phone reconnected and was *refused*
  the forward; and because the VPS shipped `ClientAliveInterval 0`, that corpse
  was never reaped. The bridge read as "phone has no screenshots" until someone
  bounced sshd. So the tunnel sets `ServerAliveInterval=20`,
  `ServerAliveCountMax=3`, and **`ExitOnForwardFailure=yes`** — without that last
  one ssh runs a perfectly healthy-looking session in which the forward was
  refused, and never retries. The VPS side is `sshd-shot-bridge.conf`; its header
  has the two commands to install it and why it is a `reload` and not a `restart`.
- **`pull_shot.sh --probe`** is the one-line answer — `ok` / `auth` / `down`,
  exit 0/5/2. Ask it before concluding the phone is empty.
- **The cache is why `pull_shot.sh` is not just a `curl`.** Two agents asking for
  the newest screenshot at the same moment used to both miss the index lookup and
  write `shot-X.png` plus a byte-identical `shot-X-2.png`; `~/shots` had the
  evidence in it. Now one `flock` spans lookup → download → verify → index, the
  index is keyed on phone-name **+** mtime (two captures of one frame can share an
  mtime), and a refetch replaces the file it replaced instead of starting a second
  one. A body that is not really an image — what a half-died tunnel hands you —
  exits 4 rather than being cached and OCR'd an hour later, and an index entry
  whose bytes no longer validate is refetched instead of trusted.
- **Exit codes are the API** (0 ok, 2 bridge down, 3 nothing new, 4 transfer or
  payload bad, 5 token rejected, 6 cache lock busy): a caller can tell "the
  tunnel is dead" from "there is nothing new" from "I was not allowed to look",
  which the old `curl | head` answer could not.

```
bash scripts/mobile/test-pull-shot.sh    # 28 checks, no phone and no tunnel needed
```

It runs the real client against a real server on a loopback port in a throwaway
cache, and it does keep the failure honest: pointed at the previous
`$HOME/bin/pull_shot.sh` it reports 12 failures, the duplicate-pair regression
being the first one.

## Reinstalling on a new phone

1. Copy `scripts/mobile/` to `$HOME` and `chmod +x` the `.sh` files.
2. `npm i -g` nothing; the shim needs only Node (Termux) and `ttyd` in the
   proot ubuntu (`apt-get install ttyd`).
3. Start, in this order: shim → ttyd → tunnel. The bot and worker wrappers are
   the phone's own services and are independent.
4. The password comes from the ubuntu env file the shim wrapper reads
   (`/root/.config/opencode-bot/miniapp.env`, `OPENCODE_SERVER_PASSWORD`).
