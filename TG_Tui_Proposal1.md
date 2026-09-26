# TG TUI — proposal 1: ship a terminal you can trust, then build the gateway

**Status:** proposal / review of `Tui_proposal2b.md`, with the ordered plan
**Date:** 2026-09-26
**Replaces:** the previous `TG_Tui_Proposal1.md` (POC review by another reviewer)
**Companion:** `Tui_proposal2b.md` (VM-anchored gateway, hot-swap roaming, dual-mode)
**Removed:** `Tui_proposal2.md` — superseded by this document plus 2b. It stays in
git history at `25f993c` / `e264f74`, so nothing is lost; 2b's "Follows" line now
points at a file that no longer exists, and this is the replacement for it.

---

## 1. Verdict

**Agree with 2b's direction. Disagree with its sequencing.** 2b's best ideas are
correct and cheap; its headline feature is the riskiest and least proven, and it
is not what is currently broken.

The Mini App TUI has never yet been reliably usable. Every failure this week was
mundane: a tunnel hostname that rotted, a bot crash-looping on Telegram 409, a
lease guard pointing the wrong way, an HTML page corrupted by a gzip mistake. None
of that was about roaming between quota-limited locations. **Roaming should be
last, not first.**

---

## 2. What 2b gets right

1. **Stable URL via Caddy — and it is much cheaper than it looks.** Verified on
   the VPS: Caddy is already installed, already serving `health-tracking.duckdns.org`
   on :80/:443 with a valid certificate. A stable Mini App URL is a route plus a
   process, not new infrastructure. It also removes the quick-tunnel rot that has
   broken `/tui` repeatedly, where an old button opens a hostname that no longer
   resolves.
2. **`Telegram.WebApp.initData` auth instead of a password form + cookie.**
   Strictly better, and it retires a real wart: the POC had to send a credential
   into the chat transcript because a Mini App WebView cannot answer an HTTP Basic
   challenge. `initData` is per-chat bound and cryptographically verified.
3. **Multi-chat isolation.** 2b correctly catches a real bug in the POC:
   `scripts/mobile/tui-attach.sh` takes `Object.values(map)[0]` — *any* chat's
   session, not this chat's. One line to fix, and it should not wait for a gateway.
4. **Dual-mode viewer (PTY vs event feed) is the most valuable insight in 2b.**
   It matches what already exists: `/watch` *is* the event-feed mode. Cline, Gemini
   and other API lanes emit JSON, not a curses screen; forcing them into xterm.js
   produces exactly the blank screen 2b warns about elsewhere.
5. **Single-writer arbitration as a first-class protocol** rather than an
   afterthought. Correct: the chat and the TUI are the same agent session.
6. **Retiring the quick tunnel, the URL file, and `opencode web`** — all three are
   things the POC has already paid for and outgrown.

**Credit where due:** 2b's load-bearing assumption is *measured*, not asserted.
`plan/LOCATION_EXPERIMENT.md` exists, pattern B is 7/7, and it records that
`opencode export` → `import` preserves the session id and rebinds `directory` to
the target host's checkout. That is the hardest part of roaming, already proven.

---

## 3. Where this proposal disagrees with 2b

1. **"The client socket stays open" is oversold.** A live PTY cannot be re-bound
   across machines and keep its screen: tmux does not cross machines, which 2b
   itself states. What survives a roam is the **session** (export/import) — not the
   scrollback, the colours, or the cursor. A `tmux capture-pane` repaint is plain
   text. Write *"the session survives, the screen does not"* into the acceptance
   criteria, or the first commute test will fail on a cosmetic loss and the team
   will chase a bug that does not exist.
2. **Refuse `node-pty`.** ttyd is a single static binary that already runs on the
   phone. `node-pty` is a native build on ARM/Termux — the exact risk area this
   repo flags elsewhere. Speak **ttyd's protocol** over the relay instead.
3. **Freebuff in a PTY is a trap.** 2b argues that PTY-forcing a non-curses tool
   yields blank screens, then places Freebuff in the PTY with a
   `[TUI Only - Best Effort Scrape]` badge. A badge does not make a flaky scrape
   reliable, it makes it *look* reliable. Event feed, or an honest "unsupported".
4. **Gateway beside the relay, never inside it.** 2b §5 says "embedded in or
   running beside". Beside, unambiguously: the relay is what every lane depends on
   for job hand-off, and a gateway bug must not be able to take it down.
5. **Retire the shim's auth, not the shim.** 2b lists `miniapp-shim.mjs` wholesale
   for deletion. That file also holds the four hardest-won fixes in the whole POC:
   decode-then-restore compression for HTML (ttyd gzips 730 KB → 191 KB), **refuse**
   `permessage-deflate` on the socket, re-point `Origin` upstream so ttyd's
   `--check-origin` does not read it as cross-site, and restore `Connection`/`Upgrade`
   on the WebSocket upgrade after the hop-by-hop filter strips them. A raw-socket
   bridge that loses those paints a screen of replacement characters. The gateway
   must inherit them, and the commit history is the only record.
6. **Arbitration defaults.** 2b sets `MAX_FOLLOWUPS = 3`; keep 5 — while a human is
   in the TUI, that queue is the *only* path for chat input. And make takeover
   explicit rather than auto-unlocking, so the unlock is not a surprise.
7. **The gateway is a new public surface, and that is a real trade.** Pattern B
   ("the VM opens nothing inbound") is a genuine property of this repo. A public
   gateway URL gives it up for the TUI. `initData` is strong enough to justify it,
   but state it as a decision: the **relay stays loopback + SSH tunnel**; only
   `/tui/*` is public.
8. **Event feed should be the default, PTY the on-demand takeover.** This is a
   stronger form of 2b §3 than 2b states.

**One factual correction:** 2b's §4 describes read-only attach while the bot is
working, then unlock. The POC shipped the opposite — the TUI wins, the bot queues —
and that inversion was necessary, because refusing to attach dead-ends the user at
exactly the moment they open the terminal, which is while they are chatting. 2b's
behaviour is the better of the two; the correct answer is 2b's, plus an explicit
takeover button.

---

## 4. Failure modes already paid for (do not regress these)

Each of these cost real time. They are the regression suite for this work.

| failure | what actually happened | the rule |
| --- | --- | --- |
| Quick-tunnel rot | old `/tui` button opened a dead hostname | stable URL, or cache the last one |
| Duplicate poller | VPS ran `bot-host@mobile` with the phone's token → Telegram 409 loop; `/tui` looked "offline" while the tunnel was fine | one poller per token; a device-owned bot must not run on the VM |
| Restart storm | a transient 409 became permanent under a fixed 5s restart | back off 5/15/45/120s, reset after a healthy run |
| Injected-page corruption | gzip body edited as text and re-sent with `content-encoding: gzip` → 351 KB of replacement characters | decode upstream, inject, re-encode; never "fix" bytes you cannot read |
| Compression negotiation | relaying `permessage-deflate` fed the browser frames it could not decode | refuse it on the socket; honour it on the page |
| WebSocket 404 | hop-by-hop filter stripped `Connection`/`Upgrade` | put them back on the upgrade |
| `Origin` mismatch | browser Origin (tunnel) vs upstream Host → ttyd saw a cross-site socket | re-point `Origin` upstream |
| Lease pointing the wrong way | TUI refused while the bot was mid-turn — i.e. while the user was chatting | TUI takes the conversation; the bot defers and queues |
| Silent self-inflicted break | a cleanup removed a function; `node --check` still passed | exercise every route on the live process, not a syntax check |
| Blank `opencode web` | Basic auth a WebView cannot answer; project list in browser storage | surface removed; the TUI supersedes it |

---

## 5. Ordered plan

Steps 1–2 are independent of the entire gateway debate and should happen now.

### Step 1 — three small fixes, no architecture (≈30 min)
- `tui-attach.sh`: key the session by **this chat id**, not `ids[0]`.
- Injected chrome: add **⏹ stop** (abort the active turn) and a takeover hint.
- `/tui`: when the URL file is empty but this process handed out a URL recently,
  say the tunnel is *reconnecting* and offer the cached button instead of a dead end.

### Step 2 — stable URL + `initData` auth (cheapest high-value item in 2b)
- Caddy route `/tui/*` → gateway beside the relay.
- Gateway validates `initData` HMAC against the bot token, binds `chat_id`, checks
  `auth_date` freshness, compares in constant time.
- Result: one permanent Mini App URL per chat, no credentials in chat, no tunnel.
- Gate: a button sent yesterday still opens today.

### Step 3 — the router, explicitly *without* roaming
- `chatKey → owner location → pane`, reusing the per-chat
  `work-view:ws-<slug>-<digest>` naming **already implemented** in
  `scripts/lib/work-session.mjs` (`workViewTarget`, `tmuxWindowFor`).
- Gate: two chats, two panes, zero cross-talk; an offline owner holds and warns,
  and never silently runs the turn on the VM.

### Step 4 — PTY over the relay, `vps` only
- ttyd's protocol tunnelled over the worker's already-open outbound link.
- Gate: attach/detach repeatedly; the pane survives; one client at a time.

### Step 5 — roaming, as its own project and drill
- `export` on the departing owner, `import` on the arriving one, re-attach.
- Acceptance criteria say: **the session survives, the screen does not.**
- Repaint with `capture-pane` text; say so in the banner rather than implying
  continuity.

### Step 6 — the gate itself
Extend the 4-node roaming drill with the failure modes in §4 as mandatory cells:
stale URL, duplicate-poller 409, injected-page gzip corruption,
`permessage-deflate`, wrong-session attach, lease deadlock. **A roaming drill that
passes while those regress is not a gate.**

---

## 6. Open decisions

- Public gateway: accept losing "nothing inbound" for `/tui/*`, with `initData` as
  the lock? (Recommended: yes, and keep the relay strictly loopback.)
- Takeover semantics: auto-unlock when the bot's turn ends, or explicit button?
  (Recommended: explicit, with a banner.)
- Event feed as the default surface, PTY on demand? (Recommended: yes — it is what
  the API lanes need anyway.)

---

## 7. Verification discipline

Three rules this POC earned the hard way:

1. **A rendering screenshot is not a passing test.** Read the bytes back over the
   public tunnel and assert on them.
2. **`node --check` is not a smoke test.** It passed while a referenced function did
   not exist. Exercise every route on the live process.
3. **Never write guessed keys into client state.** If a storage format cannot be
   observed without a browser, say so instead of seeding a guess.
