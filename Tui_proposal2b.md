# TUI Proposal 2b — VM-Anchored Gateway with Hot-Swap Roaming & Dual-Mode TUI

**Status:** proposal / architecture specification (no code changed)  
**Date:** 2026-09-26 (revised with review feedback)  
**Follows:** `TG_Tui_Proposal1.md` (POC review) & `Tui_proposal2.md` (VM-anchored core)  
**Resolves:** Seamless location roaming across quota limits, persistent mobile Mini App view, and multi-tool support (OpenCode, Cline, Grok, Freebuff).

---

## 1. Core Architecture: VM-Anchored Gateway

The fundamental principle established in Proposal 2 remains the non-negotiable anchor:
> **The Mini App URL lives on the VM. The pixels and events follow the turn owner.**

```
Telegram Client (Mobile Phone)
   │  HTTPS / WSS (Stable Domain via Caddy, e.g. https://hub.domain.com/tui/<chatKey>)
   ▼
VM TUI Gateway (/tui/* routes INSIDE worker-relay.mjs, port :8890)
   ├── Auth: Telegram initData HMAC validation (zero passwords, zero expiring cookie prompts)
   ├── Router: Resolves (chatId, projectId) -> active owner location (vps | mobile | collab | grok)
   ├── State: Manages single-writer lease arbitration (Human in TUI vs Bot in Chat)
   │
   ├── If Owner == VPS:
   │      └── Local PTY attach to `work-view` tmux window
   │
   └── If Owner == Remote Worker (mobile | collab | grok):
          └── Reverse proxy over worker's ALREADY-ESTABLISHED outbound WebSocket link
                 (No inbound ports to phone, no dynamic tunnels, no NAT traversal issues)
```

### Why this fixes the mobile POC flaws:
1. **Zero Quick-Tunnel Rot:** The Mini App URL registered in Telegram `@BotFather` is permanent. No more dead buttons on tunnel reconnects.
2. **Workers Dial Outward (Pattern B):** Termux on Android, Colab, and cloud VMs connect outward to the VM relay over WebSocket/SSH. No inbound public tunnels run on battery-constrained phones.
3. **Multi-Chat Isolation:** Replaces the `ids[0]` flaw from `tui-attach.sh` with exact `(chatId, projectId)` session isolation.
4. **Frictionless Auth:** Replaces the custom HTML password form and 30-day cookie with Telegram's cryptographic `Telegram.WebApp.initData` validation verified directly against the bot's secret token.

### Gateway placement decision (resolved):

The TUI gateway runs **inside** `worker-relay.mjs` as `/tui/*` routes, not as a separate process. Rationale:

- The relay already has the **worker connection map** (which worker owns which chat) — duplicating that in a sibling process means synchronizing state across two processes on the same host.
- The relay already has the **auth infrastructure** (`WORKER_RELAY_TOKEN`, per-caller boundaries) — reuse it rather than building a parallel auth stack.
- One fewer process to manage, monitor, and restart.
- The handler code lives in a separate file (`server_routes_tui.mjs`) imported by the relay, so it stays cleanly separated in code even though it runs in the same process.

---

## 2. Hot-Swap Roaming Across Location Jumps (Commute Safety)

**The Primary Use Case:** A user interacts on mobile Telegram, opens the TUI, and compute switches across locations (`mobile` → `VM` → `collab` → `grok`) due to quota exhaustion or manual `/location` commands, **without losing the conversation history and without the TUI disconnect freezing**.

### 2.1 Turn-Complete Gate (Finish Turn First)

`opencode export` preserves message history and session metadata, but pending tool approvals and in-flight tool state are process-local — they live in the running agent, not the session store. Mid-tool serialization is fragile and untestable.

**Rule:** Location handover requires a **turn-complete gate**. The gateway already knows if a lease is held (bot mid-turn). `/location` during a turn → queue the move, finish the turn, then export/import/rebind. This is the same discipline as the single-writer lease — don't move the session while someone is writing to it.

The `location_handover` control frame shows status:
```json
{ "type": "location_handover", "status": "waiting_for_turn", "message": "Finishing current turn before migrating..." }
```
Once the turn completes:
```json
{ "type": "location_handover", "from": "collab", "to": "vps", "status": "migrating" }
```

### 2.2 In-Band Stream Retargeting (No Dropped Viewers)
When the active worker for a chat changes (after the turn-complete gate clears):
* **The Client Socket Stays Open:** The browser's WebSocket to the VM Gateway does *not* close.
* **Visual Status Overlay:** xterm.js displays an inline banner:  
  `[Quota exhausted on Collab. Migrating session to VPS... Ready]`
* **Upstream Re-binding:** The Gateway detaches from the old worker's relay socket and re-attaches to the new worker's PTY stream, flushing the latest terminal screen buffer (`tmux capture-pane`) immediately.

### 2.3 State Preservation (Proven Pattern B)
Per `plan/LOCATION_EXPERIMENT.md` (which measured B at 7/7 pass):
1. **Export on Failover:** The departing worker runs `opencode export --session <id>` (4 KB – 4 MB JSON payload) and posts it to `POST /sessions/<id>/export` on the relay.
2. **Import on Target:** The arriving worker pulls `GET /sessions/<id>/export` and runs `opencode import`.
3. **Session ID Invariance:** OpenCode import maintains the exact same `session_id` and automatically re-binds working directories to the target host's repository path. The TUI re-attaches to the identical thread without missing a message.

### 2.4 Presence & Lease Handshake
* **Worker Heartbeats:** Workers maintain an active lease with a 60s TTL. If a phone goes to sleep or drops network, its presence is immediately flagged as `offline`.
* **Honest Degradation:** If a target location is offline, the gateway displays:  
  `[Location 'mobile' unreachable — holding turn. Use /location vps to resume.]`  
  It **never** silently executes turns on the VM while claiming to run on mobile.

### 2.5 View Name Decision (resolved):

Use the **fixed `work-view` name** for the tmux session (scoped per chat as `work-view-<chatKey>`). A `viewLocation` field is extra state that the gateway already has (it knows the owner). Don't duplicate it.

---

## 3. Dual-Mode Viewer Abstraction: Beyond Raw PTY

A critical design flaw in Proposal 1 & 2 was assuming every tool can be exposed as a raw curses terminal (`opencode`, `cline`, `freebuff`, `grok`). **Cline and LLM APIs do not have terminal TUIs; they emit JSON events.** Forcing them into a PTY leads to blank screens or brittle terminal screen-scraping.

The Mini App implements a **Tri-Mode Adapter**:

```
+-------------------------------------------------------------------+
| [OpenCode v]  [Fullscreen] [Keyboard] [Live: collab]              |
+-------------------------------------------------------------------+
|                                                                   |
| [ Mode 1: Interactive PTY ]  [ Mode 2: Event Feed ]              |
| - Active for: bash, grok     - Active for: Cline, API            |
|   build, freebuff (flagged)    lanes, background tasks            |
| - Engine: xterm.js + WebGL   - Engine: Virtualized DOM            |
| - Bi-directional raw I/O     - Structured diffs, steps           |
|                                                                   |
| [ Mode 3: Hybrid (OpenCode default) ]                             |
| - Top: Structured event feed (diffs, tool calls, approvals)      |
| - Bottom: Compact interactive PTY for direct input                |
| - Engine: Split pane — DOM events + xterm.js                      |
|                                                                   |
+-------------------------------------------------------------------+
```

### Tool Dispatch Matrix
| Tool | Execution Engine | Mini App Mode | Notes |
|---|---|---|---|
| **OpenCode** | Headless `opencode serve` + `opencode attach` | **Hybrid** (event feed + compact PTY) | Structured diffs and tool calls in the event pane; direct typing in the PTY pane. Interactive prompts render as inline buttons (CCBot pattern). |
| **Grok Build / Bash** | Direct tmux pane (`work-view:<chatKey>`) | **Interactive PTY** | Standard terminal session inside target worktree. |
| **Cline** | Headless extension runner / JSON stream | **Event Feed** | Displays structured steps, tool calls, and diff cards. |
| **Freebuff** | Degraded CLI scraper | **Interactive PTY** | Permanently badged: `[TUI Only - Best Effort Scrape]`. No graduation planned — if freebuff ships an API, adding Event Feed is a one-line dispatch change. |
| **Gemini / Direct API** | Raw bot-host dispatch | **Event Feed** | Live transcript stream populated from `/watch` SSE. |

### Freebuff decision (resolved):

Freebuff stays `[Best Effort Scrape]` permanently. The `laneSupports({ headless: false })` flag gates it. Building a headless API wrapper is their problem, not ours. Honest labelling is the right call (L7: detect the class, don't paint it green).

---

## 4. Single-Writer Arbitration Protocol

Because the Telegram chat and the Mini App TUI talk to the *same* agent session, race conditions will corrupt conversation state unless strictly arbitrated.

### Model: Single-user, single-writer

Multi-user viewing is not expected. One human, one bot, one session. No read-only viewer mode, no viewer counting, no broadcast. If multi-user ever becomes needed, the gateway has the right shape — add `mode: 'readonly'` to the WebSocket handshake and skip lease acquisition.

### Arbitration rules:

1. **Bot Turn in Progress:**
   * If the user taps "Open TUI" while the bot is answering in chat:
   * The TUI displays: `[Agent is currently answering a message. Attaching read-only... Interactive mode available when turn completes.]`
   * Once the bot's turn finishes, the PTY unlocks for human typing.
2. **Human Typing in TUI:**
   * When an interactive TUI session connects, the gateway claims `tui-lease.json` with a 15s heartbeat.
   * If the user sends a Telegram chat message while the TUI is active, the bot replies:  
     `⌨️ TUI session active — queuing your message behind current terminal input.`
   * Chat messages are held in a FIFO queue (`MAX_FOLLOWUPS = 3`) and executed when the TUI is closed or idle.
   * **On the 4th message:** the bot replies `⌨️ TUI active, 3 messages queued. Close TUI or type there.` No silent drops — the cap is a rate-limit signal.
3. **Emergency Takeover / Abort:**
   * A prominent top-bar button (`[⏹ Stop Agent]`) triggers `POST /abort`, sending `SIGINT` / `SIGKILL` to the active child process and immediately releasing the write lease.

---

## 5. Security

| Layer | Implementation |
|---|---|
| **Auth** | Telegram `initData` HMAC validated against bot secret token. Per-chat, short-lived Bearer tokens (relay model). Zero static passwords. |
| **Transport** | ttyd on loopback behind the gateway; never exposed directly. All external traffic over Caddy TLS. |
| **Rate limiting** | Rate-limit on gateway `attach` attempts (not just login). Reuse the shim's constant-time compare for token validation. |
| **Headers** | CSP headers on the xterm.js page to prevent injection. `X-Frame-Options: DENY` for non-Telegram contexts. |
| **Scope** | Per-chat `work-view-<chatKey>` tmux windows. No global session. Owner-only access until multi-user is needed. |
| **Audit** | Log and rate-limit attach attempts. Ledger every lease takeover. |

---

## 6. Architectural Delta & Implementation Path

### Components Retired:
* ❌ Cloudflared quick tunnels (`start-phone-miniapp-tunnel.sh`).
* ❌ Local storage of URLs (`$HOME/.phone-miniapp-url`).
* ❌ Global `ids[0]` session grabbing in `tui-attach.sh`.
* ❌ Static passwords and form cookies (`miniapp-shim.mjs`).
* ❌ Separate gateway process (`:8895`) — absorbed into relay.

### Components Introduced:
* ✅ **TUI routes in relay (`server_routes_tui.mjs`)**: `/tui/*` routes inside `worker-relay.mjs` on port `:8890`, reverse-proxied by Caddy with trusted TLS. Reuses the relay's worker connection map and auth infrastructure.
* ✅ **Worker PTY Streamer (`scripts/lib/tui-worker-stream.mjs`)**: Runs on workers (phone, collab, VM); connects to relay and pipes local node-pty/ttyd frames over the outbound connection.
* ✅ **Unified WebApp Client (`miniapp/dist`)**: Lightweight pre-built bundle serving xterm.js + event viewer with Telegram WebApp SDK integration. Supports all three modes (PTY, Event Feed, Hybrid).

### Implementation Priority:
| Priority | Item | Why |
|---|---|---|
| **P0** | Stable domain (named tunnel or Caddy) | Dead buttons make everything else untestable |
| **P0** | `initData` HMAC auth replacing password form | Security prerequisite before widening access |
| **P1** | Multi-chat scoping (`CHAT_KEY` → per-chat tmux name) | Current `ids[0]` collision is a correctness bug |
| **P1** | Fixed `work-view-<chatKey>` name | Blocks the view-location-split wiring |
| **P2** | `/tui/*` routes in relay (resolve owner, proxy to worker) | Enables location roaming |
| **P2** | Tri-mode viewer (PTY + Event Feed + Hybrid) | Enables multi-tool |
| **P3** | Hot-swap with in-band control frames | Polish; manual `/location` + reopen works first |

---

## 7. Live Verification Gate (Card 6c Extended)

Before marking this operational, execute the deterministic 4-node handoff drill:

```bash
# Verify complete roaming cycle without dropped sessions or frozen screens:
node scripts/assert-tui-roaming.test.mjs
```

1. **Node 1 (VPS):** Start turn on VPS → verify TUI attaches to VPS `work-view-<chatKey>` pane.
2. **Node 2 (Mobile):** Trigger `/location mobile` → verify turn-complete gate holds if mid-turn → verify export/import → verify Gateway retargets stream to mobile outbound link → verify `[Connected to mobile]` banner.
3. **Node 3 (Colab):** Simulate mobile quota depletion → verify auto-failover to Colab, session ID preserved, no client WebSocket disconnection.
4. **Node 4 (Arbitration):** Type in TUI while sending a message via Telegram API → verify single-writer lock, queueing, `MAX_FOLLOWUPS` overflow message on 4th, and clean release.
