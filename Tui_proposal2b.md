# TUI Proposal 2b — VM-Anchored Gateway with Hot-Swap Roaming & Dual-Mode TUI

**Status:** proposal / architecture specification (no code changed)  
**Date:** 2026-09-26  
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
VM TUI Gateway (:8895 beside Relay :8890)
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

---

## 2. Hot-Swap Roaming Across Location Jumps (Commute Safety)

**The Primary Use Case:** A user interacts on mobile Telegram, opens the TUI, and compute switches across locations (`mobile` → `VM` → `collab` → `grok`) due to quota exhaustion or manual `/location` commands, **without losing the conversation history and without the TUI disconnect freezing**.

### 2.1 In-Band Stream Retargeting (No Dropped Viewers)
When the active worker for a chat changes:
* **The Client Socket Stays Open:** The browser's WebSocket to the VM Gateway does *not* close.
* **Control Frame Interception:** The Gateway sends an in-band control frame to the client:
  ```json
  { "type": "location_handover", "from": "collab", "to": "vps", "status": "migrating" }
  ```
* **Visual Status Overlay:** xterm.js displays an inline banner:  
  `[Quota exhausted on Collab. Migrating session to VPS... Ready]`
* **Upstream Re-binding:** The Gateway detaches from the old worker's relay socket and re-attaches to the new worker's PTY stream, flushing the latest terminal screen buffer (`tmux capture-pane`) immediately.

### 2.2 State Preservation (Proven Pattern B)
Per `plan/LOCATION_EXPERIMENT.md` (which measured B at 7/7 pass):
1. **Export on Failover:** The departing worker runs `opencode export --session <id>` (4 KB – 4 MB JSON payload) and posts it to `POST /sessions/<id>/export` on the relay.
2. **Import on Target:** The arriving worker pulls `GET /sessions/<id>/export` and runs `opencode import`.
3. **Session ID Invariance:** OpenCode import maintains the exact same `session_id` and automatically re-binds working directories to the target host's repository path. The TUI re-attaches to the identical thread without missing a message.

### 2.3 Presence & Lease Handshake
* **Worker Heartbeats:** Workers maintain an active lease with a 60s TTL. If a phone goes to sleep or drops network, its presence is immediately flagged as `offline`.
* **Honest Degradation:** If a target location is offline, the gateway displays:  
  `[Location 'mobile' unreachable — holding turn. Use /location vps to resume.]`  
  It **never** silently executes turns on the VM while claiming to run on mobile.

---

## 3. Dual-Mode Viewer Abstraction: Beyond Raw PTY

A critical design flaw in Proposal 1 & 2 was assuming every tool can be exposed as a raw curses terminal (`opencode`, `cline`, `freebuff`, `grok`). **Cline and LLM APIs do not have terminal TUIs; they emit JSON events.** Forcing them into a PTY leads to blank screens or brittle terminal screen-scraping.

The Mini App implements a **Dual-Mode Adapter**:

```
┌───────────────────────────────────────────────────────────┐
│ [OpenCode ▾]  [⛶ Fullscreen] [⌨ Keyboard] [● Live: collab]│
├───────────────────────────────────────────────────────────┤
│                                                           │
│  [ Mode 1: Interactive PTY ]    [ Mode 2: Event Feed ]    │
│  - Active for: OpenCode, tmux,  - Active for: Cline, API  │
│    bash, Grok build               lanes, background tasks │
│  - Engine: xterm.js + WebGL     - Engine: Virtualized DOM │
│  - Bi-directional raw I/O       - Structured diffs, steps │
│                                                           │
└───────────────────────────────────────────────────────────┘
```

### Tool Dispatch Matrix
| Tool | Execution Engine | Mini App Mode | Notes |
|---|---|---|---|
| **OpenCode** | Headless `opencode serve` + `opencode attach` | **Interactive PTY** | Full bidirectional curses TUI; session attached dynamically. |
| **Grok Build / Bash** | Direct tmux pane (`work-view:<chatKey>`) | **Interactive PTY** | Standard terminal session inside target worktree. |
| **Cline** | Headless extension runner / JSON stream | **Event Feed** | Displays structured steps, tool calls, and diff cards. |
| **Freebuff** | Degraded CLI scraper | **Interactive PTY** | Explicitly badged: `[TUI Only - Best Effort Scrape]`. |
| **Gemini / Direct API** | Raw bot-host dispatch | **Event Feed** | Live transcript stream populated from `/watch` SSE. |

---

## 4. Single-Writer Arbitration Protocol

Because the Telegram chat and the Mini App TUI talk to the *same* agent session, race conditions will corrupt conversation state unless strictly arbitrated:

1. **Bot Turn in Progress:**
   * If the user taps "Open TUI" while the bot is answering in chat:
   * The TUI displays: `[Agent is currently answering a message. Attaching read-only... Interactive mode available when turn completes.]`
   * Once the bot's turn finishes, the PTY unlocks for human typing.
2. **Human Typing in TUI:**
   * When an interactive TUI session connects, the gateway claims `tui-lease.json` with a 15s heartbeat.
   * If the user sends a Telegram chat message while the TUI is active, the bot replies:  
     `⌨️ TUI session active — queuing your message behind current terminal input.`
   * Chat messages are held in a FIFO queue (`MAX_FOLLOWUPS = 3`) and executed when the TUI is closed or idle.
3. **Emergency Takeover / Abort:**
   * A prominent top-bar button (`[⏹ Stop Agent]`) triggers `POST /abort`, sending `SIGINT` / `SIGKILL` to the active child process and immediately releasing the write lease.

---

## 5. Architectural Delta & Implementation Path

### Components Retired:
* ❌ Cloudflared quick tunnels (`start-phone-miniapp-tunnel.sh`).
* ❌ Local storage of URLs (`$HOME/.phone-miniapp-url`).
* ❌ Global `ids[0]` session grabbing in `tui-attach.sh`.
* ❌ Static passwords and form cookies (`miniapp-shim.mjs`).

### Components Introduced:
* ✅ **VM TUI Gateway (`scripts/tui-gateway.mjs`)**: Embedded in or running beside `worker-relay.mjs` on port `:8895`, reverse-proxied by Caddy with trusted TLS.
* ✅ **Worker PTY Streamer (`scripts/lib/tui-worker-stream.mjs`)**: Runs on workers (phone, collab, VM); connects to relay and pipes local node-pty/ttyd frames over the outbound connection.
* ✅ **Unified WebApp Client (`miniapp/dist`)**: Lightweight pre-built bundle serving xterm.js + event viewer with Telegram WebApp SDK integration.

---

## 6. Live Verification Gate (Card 6c Extended)

Before marking this operational, execute the deterministic 4-node handoff drill:

```bash
# Verify complete roaming cycle without dropped sessions or frozen screens:
node scripts/assert-tui-roaming.test.mjs
```

1. **Node 1 (VPS):** Start turn on VPS → verify TUI attaches to VPS `work-view` pane.
2. **Node 2 (Mobile):** Trigger `/location mobile` → verify export/import, verify Gateway retargets stream to mobile outbound link, verify `[Connected to mobile]` banner.
3. **Node 3 (Colab):** Simulate mobile quota depletion → verify auto-failover to Colab, session ID preserved, no client WebSocket disconnection.
4. **Node 4 (Arbitration):** Type in TUI while sending a message via Telegram API → verify single-writer lock, queueing, and clean release.
