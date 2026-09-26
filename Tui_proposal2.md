# TUI Proposal 2 — VM-anchored gateway, location-routed TUI

**Status:** proposal / review (no code changed)
**Date:** 2026-09-26
**Branch:** `agent/tg-tui-proposal`
**Follows:** Proposal 1 (mobile PoC review)
**Question answered:** (1) VM vs location-specific, (2) safe across N swaps.

## 1. Decision: VM-anchored URL, location-routed content

The Mini App URL lives on the VM. The pixels follow the turn owner.
Not one tunnel per device, not VM-only execution.

Telegram Mini App -> https://<stable-vm>/tui/<chatKey> (Caddy, stable)
  gateway: initData check, per-chat token, chat|project -> owner lookup
  vps -> local work-view pane
  mobile/collab/grok -> PTY over that worker OUTBOUND link (no inbound)

Why not per-location URLs: quick trycloudflare hostname rots each
reconnect (bot warns old /tui button dead), N devices = N rotting URLs,
wrong direction (proven B pattern is workers dial out, VM opens nothing
inbound), single opencode-tui collides across chats (ids[0]), hardcoded
OPENCODE_BIN, and tmux cannot cross machines (measured).

Why not VM-only: turns must spend worker own ledger, /location mobile
offline must warn not silently VM-run (R-14.1 fail class), per-host
binaries differ (phone opencode-only, no Cline ARM), TUI must show tool
actually running on owner.

## 2. Multi-swap review (commute vps-mobile-collab-grok-vps)

2.1 Stable URL: /tui/<chatKey> never changes on /location. Gateway
re-resolves owner per attach. No phone tunnel URL to Telegram.
Viewer reopen attaches to current owner. tmux new-session -A keeps
worker pane alive across viewer disconnects.

2.2 Owner = presence not variable: workerStatus fresh + TTL 2min +
machine/standin labels. Reuse preflight presence-relay-workspace-session
stop-first-fail. Presence fail -> hold + warn, never blank pane or silent
VM run. Flapping (phone tunnel, collab 12h idle): stale owner shows last
transcript + reconnecting banner, not frozen xterm.

2.3 View follows idempotently: B-path rebuild viewCommand on
opencodeSessionId change (known FAIL cell). A-path retire old pane,
export-import (same id, rebuild serverUrl only, never copy viewCommand),
ensureTmuxWorkView. Retire orphan each swap; after vps-mobile-vps exactly
one live pane. Settle fixed work-view vs viewLocation before wiring
(recommend fixed name).

2.4 Single writer: Mini App is second writer. Bot via
POST session/message + event SSE; human via PTY same session id. Gateway
atomic lease per session: bot active -> keystrokes queue (MAX_FOLLOWUPS)
or explicit takeover pauses bot; human typing -> bot holds + banner.
Ledger every takeover. /abort flags job row, worker SIGKILLs child.

2.5 Honest degraded: offline -> hold+warn. Depleted -> same-host failover
first then roam, handoff not transcript replay. No-TUI lane (Cline ARM,
gemini api-only) -> events/transcript + attach:false label, never blank.
freebuff stays TUI-only flag-gated via laneSupports headless=false,
quiet-window scrape labelled best-effort.

2.6 Project orthogonal: /project reuses window new workspace (no
kill-session). chat|project key isolates external-2 vs 3. Gateway resolves
(chat,project)->owner->pane.

2.7 Auth per chat: validate WebApp initData HMAC bot token, bind chat_id,
short TTL, per-chat Bearer (relay model). Per-chat work-view window, never
global opencode-tui. ttyd loopback behind owner, proxied outbound. Scrub
protects TG messages not PTY pixels: owner-only until redaction story.

## 3. Architecture delta

Caddy /tui/* -> gateway beside relay :8890 (atomic token rollout like
/relay). Worker WS /tui-attach host+token carries PTY frames (ttyd-proto
or xterm+node-pty). Gateway router presence->owner->proxy; owner change
re-proxy + banner, no second session. Lane dispatcher replaces OPENCODE_BIN:
opencode attach url dir session; cline/grok/agy where installed;
freebuff scrape; api-only events view. Keep /watch events + /tx observer
tail as default; full PTY on-demand takeover. Retire quick tunnel,
phone-miniapp-url file, ids[0], opencode web.

## 4. Prior art / multi-agent

ccbot (TG-tmux Claude): 1 topic=1 window=1 session, JSONL source of truth
pixels fallback, per-user queue. Take: per-chat isolation, transcript
first, queue+ratelimit.

opencode serve/attach: TUI=client, serve headless + OPENCODE_SERVER_PASSWORD,
attach url dir session for remote backend, /tui/* drive API. Use message
API + event SSE for data, PTY for human.

Anthropic research: orchestrator+parallel helps breadth work, final-state
eval, fs artifacts not traces. Cognition: parallel writers conflict;
single-thread writes, agents add intelligence; map-reduce-manage not swarm.
Repo laws: one writer, staged council, notes-not-truth pack, side-effect
done gate, dispatch_lock, run-ledger, second-signature rule. TUI ledger
takeovers same as writes.

## 5. Live gate N swaps

Extend Card 6c: tx on vps capture shows A; /location mobile same work-view
shows phone relay (or honest offline, no silent VM); /location collab
repoint + ghost audit one pane; /project ext2 same window new ws; back vps
repoint current ses no stale; mid-turn attach queue/takeover banner +
ledger, one sessionID. Blank/stale/ghost/friendly-wrong = fail. Author
does not run pass. Order vps-mobile-collab-grok, atomic relay-auth first.
Open: work-view vs viewLocation; PTY transport; gateway in vs beside relay;
freebuff graduation on run/serve/acp verb.




