# TG TUI Proposal 1 — a terminal in the Telegram Mini App, for every bot and location

**Status:** proposal / review (no code changed)
**Scope reviewed:** `scripts/mobile/*`, the `/tui` command in `scripts/bot-host.mjs`,
`plan/LOCATION_EXPERIMENT.md`, `plan/LOCATION_AGNOSTIC_AGENTS.md`
**Date:** 2026-09-26

The goal behind this document: one TUI surface available to **all bots**
(grok, mobile, VM, collab), reachable from **any location**, that can drive
**multiple tools** (opencode, cline, grok build, freebuff), where the user sees
what was sent to the bot and what the tool answered — and can type into the
same conversation directly.

---

## 1. What exists today (the mobile POC)

```
Telegram Mini App (WebView)
   │  https  ← cloudflared QUICK tunnel (hostname changes on reconnect)
   ▼
miniapp-shim.mjs        127.0.0.1:8895   login form + HttpOnly cookie, /tui proxy
   │  http + WebSocket, cookie in hand, x-tui-auth header injected
   ▼
ttyd                    127.0.0.1:8896   a real PTY, mounted at /tui
   │  tmux new-session -A
   ▼
tui-attach.sh           resolves THIS chat's session id, refuses to double-write
   │
   ▼
opencode                in /root/Health-tracker, inside the proot ubuntu
```

The bot's `/tui` reads the published URL from `$HOME/.phone-miniapp-url`; if the
file is empty the tunnel is down and the bot says so instead of sending a dead
button.

### 1.1 What is genuinely good

- **The shim exists for the right reason.** A Telegram WebView cannot answer an
  HTTP Basic challenge, so a login form + `HttpOnly` cookie in front of ttyd is
  the correct shape. The `--auth-header` / `--check-origin` handling, the
  `Origin` re-point upstream, and the split of "honour-then-restore compression
  for HTML, refuse `permessage-deflate` for the socket" are all correct and
  clearly learned by debugging a screen of replacement characters.
- **`tmux new-session -A`** is the right call: the PTY survives the WebView
  closing, so reopening keeps your place.
- **The lease guard** ("refuse to attach while the bot is mid-turn") is the
  single most important correctness rule for a shared agent session, and it is
  present.
- **The session id is resolved per attach**, not baked into the ttyd command
  line, and the `SID_MARK` reap of a stale tmux session fixes a subtle bug
  (`new-session -A` ignores its command when the session already exists).

The phone-specific prototype is solid. The gap is that it solves **one** case —
one tool, one bot, one location, one chat — and the goal is "all bots, all
locations, multi-tool."

### 1.2 Where it does not yet meet the goal

Every axis is currently hardcoded:

| Goal | Today |
|---|---|
| all tools (opencode, cline, grok build, freebuff) | `OPENCODE_BIN` only; no tool selector |
| all bots (grok, mobile, VM, collab) | `TUI_BOT_ID=mobile`; the bot reads its URL from a **phone-local file**, tunnel runs **on the phone** |
| multiple chats | `tui-attach.sh` reads `ids[0]` from a global `sessions.json` → effectively single-chat |
| any location | tunnel + ttyd live on one device; nothing follows a `/location` change |

Three concrete issues:

1. **Not multi-chat safe.** `tui-attach.sh` takes the *first* session id in the
   whole map, and its busy-check treats *any* lease anywhere as busy
   (`Object.keys(m).length ? 1`), not this chat's lease. Two chats would collide
   on one TUI; an unrelated turn blocks an attach.
2. **Quick-tunnel hostname rotation is a design flaw, not a footnote.** The bot
   itself warns "any earlier `/tui` button is dead." A `*.trycloudflare.com`
   quick tunnel gets a new hostname on every reconnect; that is why the button
   must be re-sent.
3. **Security surface.** A public tunnel to a writable PTY guarded by one shared
   static password, a 30-day cookie, and no per-user scoping. The relay already
   has a `Bearer` token model (`WORKER_RELAY_TOKEN`) and a per-caller boundary —
   that is the pattern to reuse, plus a stable domain (Telegram prefers a
   configured Web App domain for `web_app` buttons).

---

## 2. The location question — the repo has already measured the answer

`plan/LOCATION_EXPERIMENT.md` measured three approaches:

- **A — move the poller.** Chat, state and token move to the other machine.
- **B — move only the compute.** Poller stays; the turn is handed to a worker
  over the relay and runs there.
- **C — share the state store.** Nothing moves; both hosts read one store.

Scores: **B > A > C.** And the crucially relevant VIEW finding:

> "With VIEW measured, none of the three shows its chat's TUI after a move
> today — the fix is the same for all of them (split the view location from the
> chat location)."

Measured recipe (from the experiment):

- **B (recommended):** state never moves. Only `reconcileWorkViewForLane` must
  rebuild `viewCommand` when `opencodeSessionId` changes — currently it
  early-returns whenever the pane looks live.
- **A (fallback, host with no relay):** retire the old pane
  (`disableTmuxObserver`) → `opencode export → import` on the new host (this
  preserves the session id, so the TUI re-binds directly) → rebuild
  `viewCommand` against the new host's server → `ensureTmuxWorkView`.
- **C:** only needs the view location split; it moves nothing.

The landed library half (`WORK_VIEW_SESSION`, `workViewTarget`,
`repointWorkView`, `sessionName` override) exists. The product wiring is still
open, and the mechanism decision (fixed `work-view` name vs a `viewLocation`
field) is unresolved — pick one before wiring, or the two fight.

**Best answer to "make the TUI work when the bot changes location":** stop the
view from being location-scoped. One stable view name/endpoint per chat
(`work-view`, as `LOCATION_AGNOSTIC_AGENTS.md` prescribes), retarget the pane at
the host that owns the turn, and perform the full swap only for A.

---

## 3. Proposed architecture

### 3.1 One gateway, not one tunnel per device

The VM relay already exists with outbound worker connections and
`/sessions/…`, `/jobs/…` routes. Put the Mini App gateway in front of **that**,
so a chat's TUI URL is stable (`/tui/<chatKey>`) regardless of where compute
runs. The gateway resolves the owning worker and proxies the attach stream over
the worker's existing outbound connection — no inbound to the phone, no
per-device tunnel, no stale hostname.

```
Telegram Mini App
   │  https  ← ONE stable entrypoint (named tunnel / Caddy)
   ▼
tui-gateway            chat-scoped auth, /tui/<chatKey>, per-chat token
   │  resolve owner of this chat's session
   ▼
worker (VM | phone | collab)  ← over the worker's existing outbound relay link
   └─ PTY attach (opencode)  or  structured event projection (others)
```

### 3.2 Stable entrypoint instead of a quick tunnel

Replace the `*.trycloudflare.com` quick tunnel with a **named Cloudflare
tunnel** (stable hostname) or the existing Caddy site. This alone removes the
"re-send the button on every reconnect" behavior and makes deep links survive.

### 3.3 A viewer abstraction, not a raw PTY per tool

- **opencode** has a server-backed session — use `opencode attach <server>
  --session <id>` (BOT-19 already establishes this).
- **Tools with structured events** (Cline JSON, opencode `--format json`) render
  an event/transcript view.
- **TUI-only tools** (freebuff is explicitly declared "degraded, TUI-only") get
  a PTY attach *and* are honestly labelled. Do not claim a live TUI where there
  is not one — BOT-19 already states that rule.

### 3.4 Serialize input, share observation

Keep the single-writer lease (already the `tx` model), but scope it **per
session** and enforce it **at the gateway** so a viewer cannot bypass it.

### 3.5 Security

- Per-chat, short-lived tokens; reuse the relay `Bearer` model.
- Log and rate-limit attach attempts (the shim already rate-limits logins and
  uses a constant-time compare — keep that).
- Keep ttyd on loopback behind the gateway; never expose it directly.

---

## 4. Prior art and multi-agent development practices

People are doing exactly this, and the converging consensus matches this repo:

- **tmux is the de-facto substrate for multi-agent dev.** The persistent
  workspace pattern (survives drops, isolates each agent's output, lets a human
  step in) is now a genre — e.g. *"Tmux is the Missing Operating System for AI
  Coding Agents"* (2026), and Claude/Codex "agent teams" running in tmux and
  iTerm split panes. Our `tmux new -A` + lease design is this pattern, applied
  through Telegram.
- **DIY multi-agent = tmux + git worktrees + one agent per pane.** This is the
  same discipline as `AGENTS.md §0.9` worktree isolation and one-writer-per-area.
- **State travels, not the process.** The `sessionKey` fix to `chat|project` is
  the standard move: one stable identity, location accepted-and-ignored.
- **Do not screen-scrape as source of truth.** Prefer structured events; the
  freebuff lane's TUI-quiet-window scraping is the known weak spot.
- **Observability beats pixels.** A canonical event stream (`debugRunTree`,
  observer log, `/watch`) is more robust than reading a terminal buffer, and it
  is what you can actually test.

---

## 5. Recommendation

The mobile prototype is a high-quality single-node POC and a good pilot. To make
it real for **all bots / all locations / multi-tool**, the two changes that
matter most are:

1. **Move the view out of the location** — the card-6c fix the experiment
   already specifies (fixed `work-view`, view location split from chat location,
   re-bind on session change, full swap only for A).
2. **Front the existing relay with one stable gateway** instead of per-device
   quick tunnels, with the viewer/tool abstraction and a per-chat token on top.

Everything else (multi-chat scoping in `tui-attach.sh`, named tunnel, tool
selector) follows from those two.
