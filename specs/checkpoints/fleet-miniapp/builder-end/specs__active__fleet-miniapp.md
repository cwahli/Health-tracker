---
id: fleet-miniapp
status: locked
skill: sync-jobs
edit_mode: patch
allowed_files:
  - scripts/tui-gateway.mjs
  - scripts/bot-host.mjs
  - scripts/lib/commands.mjs
  - src/miniapp/fleet.html
  - scripts/mac-fleet-beat.mjs
  - scripts/assert-fleet-miniapp.test.mjs
frozen_files:
  - src/App.tsx
  - src/components/LogChat.tsx
  - src/jobs/JobStore.ts
  - AGENTS.md
  - docs/agent/standing.json
  - scripts/journey-guard.mjs
  - bots/registry.json
  - vite.config.ts
gate:
  - node scripts/assert-fleet-miniapp.test.mjs
---

# Packet: Dynamic Fleet Mini-App (/fleet) + Multi-Location Telemetry

Human replies: go | stop | one comment.

## Journey

Transform the static snapshot in `fleet-tabs.html` into a live Telegram Mini-App (`/fleet`) that continuously mirrors the PM spreadsheet (`current` tab) and displays real-time agent/terminal states across 5 distributed locations (Mac, VM, Collab, Mobile, Grok VM) and 21 fleet bots.

Better means:
1. Zero manual regenerating/re-downloading: opening `/fleet` in Telegram renders current truth instantly.
2. Cross-device ground truth: Mac (Antigravity/Gemini), Mobile (Termux), Collab, and VMs report into one screen without SSH/VPN friction.
3. Zero-build simplicity: no Vite bundle bloat, zero changes to `vite.config.ts`, retaining the CSS sticky table layout from `table_template.py` (<100ms load time).

---

## Findings (do not redo)

- `scripts/tui-gateway.mjs` already handles Telegram `initData` validation (HMAC-SHA256) and issues `__Host-tui_session` cookies for `/tui`, `/bugs`, and `/forge`.
- `scripts/lib/google-store.mjs` already exports `readTab(sheetId, tab, token)`. Reading `current` tab with an in-memory 15s TTL cache stays well below Google's 300 req/min API ceiling.
- `scripts/bot-host.mjs` already tracks active turn models and concise progress sentences (capped at 220 chars).
- `fleet-tabs.html` proves that single-table CSS sticky headers (`thead th` sticky top, first column sticky left) and CSS radio tabs work without script breakage in Telegram WebViews.
- Telemetry must distinguish `working` from `idle`/`waiting_prompt` using a lease-based TTL (2m decay to `idle`, 10m to `offline`) to prevent ghost/zombie active states.
- Telegram WebView requires `Telegram.WebApp.expand()` and `overscroll-behavior-y: contain` to prevent table scrolling from accidentally triggering the native swipe-down dismiss gesture.

---

## Plan (Micro-Node Graph)

### Node 1 — Gateway Ingestion & Composite State Endpoints
- Target: `scripts/tui-gateway.mjs`
- Actions:
  - Mount `POST /fleet/api/heartbeat` behind a shared token/HMAC check to accept telemetry from distributed locations.
  - Implement an in-memory TTL store for location nodes (`Mac`, `VM`, `Grok VM`, `Mobile`, `Collab`):
    - Lease TTL: `< 2 min` = `working` (if phase is executing) or `waiting_prompt`.
    - `2 to 10 min` = `idle`.
    - `> 10 min` = `offline`.
  - Mount `GET /fleet/api/state` combining:
    1. PM sheet `current` tab (via `readTab()`, cached 15s in memory).
    2. Multi-location pane map.
    3. Bot states (from local `bot-host.mjs` active turns and `bots/registry.json`).
  - Mount `GET /fleet/api/events` (SSE stream) pushing updates to connected clients when state changes.
- Done when: `curl` to endpoints returns structured composite JSON; invalid auth is refused; 15s Sheets cache prevents duplicate upstream API hits.

### Node 2 — Mac & Distributed Node Heartbeat Reporter
- Target: `scripts/mac-fleet-beat.mjs`
- Actions:
  - Lightweight reporter for Mac sessions (e.g. Gemini 3.8 Flash High):
    - Pings `POST /fleet/api/heartbeat` with location (`Mac`), agent (`Gemini 3.8 Flash (High)`), phase (`working` vs `waiting_prompt`), task summary sentence, and active ticket key.
  - Wire VM turn execution in `scripts/bot-host.mjs` to auto-emit heartbeats into the gateway's in-memory store on turn start, progress update, and turn end.
- Done when: Mac reporter sends beat; `GET /fleet/api/state` reflects Mac with live model and task.

### Node 3 — Dynamic Reactive Mini-App (`src/miniapp/fleet.html`)
- Target: `src/miniapp/fleet.html`
- Actions:
  - Preserves structural CSS from `fleet-tabs.html`:
    - Sticky `thead` and sticky first column (`150px`, `#1e293b`).
    - CSS radio-based tab switcher (`ticket`, `term`, `bot`).
    - Dark theme palette (`#0f172a`, `#1e293b`, `#1d4ed8`).
  - Mobile WebView stabilization:
    - `Telegram.WebApp.ready()`, `Telegram.WebApp.expand()`.
    - CSS `overscroll-behavior-y: contain` on `.st-scroll`.
  - Dynamic client logic:
    - Tab 1 (Tickets): 8 columns (`Original request`, `Work done so far`, `What's left to do`, `Owner`, `Status`, `Completion proof`, `Completion gate`, `last_activity`).
    - Tab 2 (Terminals): Grouped by location (`Mac`, `VM`, `Grok VM`, `Mobile`, `Collab`), showing active model, status (`working` vs `idle`), concise task sentence, and click-to-filter link to the corresponding ticket row.
    - Tab 3 (Bots): 21 bots with live active/idle badge, model name, and concise progress sentence.
    - Connects via `EventSource('/fleet/api/events')` with fallback to 15s polling when hidden.
- Done when: Page loads standalone in browser/webview; updates in real-time when heartbeats arrive without page refresh; clicking a terminal row highlights the matching ticket.

### Node 4 — Telegram Bot `/fleet` Command Wiring
- Target: `scripts/bot-host.mjs`, `scripts/lib/commands.mjs`
- Actions:
  - Add `case 'fleet':` to `bot-host.mjs` mirroring the `/bugs` and `/forge` pattern:
    - Sends message with inline button: `{ text: '📋 Open Fleet Dashboard', web_app: { url: `${gatewayUrl}/fleet?bot=${config.id}` } }`.
  - Add `/fleet` to commands help registry in `scripts/lib/commands.mjs`.
- Done when: `/fleet` sent to bot returns the web_app inline button; button opens the gateway URL with valid `initData`.

### Node 5 — Sensor Test & Verification Gate
- Target: `scripts/assert-fleet-miniapp.test.mjs`
- Actions:
  - Automated contract checks:
    1. Validates HMAC `initData` door on `/fleet`.
    2. Validates 8-column ticket projection mapping.
    3. Validates heartbeat ingest and 2m TTL decay logic.
    4. Validates SSE event dispatch.
    5. Verifies zero raw markdown pipe tables emitted.
- Done when: `node scripts/assert-fleet-miniapp.test.mjs` exits 0 (100% pass).

---

## Test plan

```text
node scripts/assert-fleet-miniapp.test.mjs
node scripts/assert-pm-role.test.mjs
node scripts/assert-health-group.test.mjs
npx tsc --noEmit
```

## Audit plan

1. Scope: Strictly `/fleet` mini-app and telemetry ingest. No alterations to existing `/tui`, `/bugs`, or core food-calc pipelines.
2. Blast Radius: Zero edits to `vite.config.ts`, `App.tsx`, `JobStore.ts`, or `bots/registry.json`.
3. Quota Safety: Gateway cache pins Google Sheets requests to maximum 4 calls/minute regardless of viewer count.

## Blast radius

- Allowed: `scripts/tui-gateway.mjs`, `scripts/bot-host.mjs`, `scripts/lib/commands.mjs`, `src/miniapp/fleet.html`, `scripts/mac-fleet-beat.mjs`, `scripts/assert-fleet-miniapp.test.mjs`.
- Frozen: YAML list at top of packet.
