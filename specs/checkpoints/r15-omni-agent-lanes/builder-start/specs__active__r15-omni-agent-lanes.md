---
id: r15-omni-agent-lanes
status: locked
skill: bot-code
edit_mode: patch
allowed_files:
  - scripts/lib/lane-contract.mjs
  - scripts/lib/free-lanes.mjs
  - scripts/assert-lane-contract.mjs
  - tests/lane-contract.test.ts
  - tools/telegram-provider-router/src/freebuff-tg-lane.js
  - tools/telegram-provider-router/src/free-lane-table.vendor.mjs
  - tools/telegram-provider-router/src/index.js
  - plan/ROADMAP.md
frozen_files:
  - bots/registry.json
  - bots/capabilities.json
  - AGENTS.md
  - docs/agent/standing.json
  - scripts/journey-guard.mjs
  - src/App.tsx
  - src/components/LogChat.tsx
gate:
  - npx tsc --noEmit
  - npx vitest run tests/lane-contract.test.ts
  - node scripts/assert-lane-contract.mjs
  - (cd tools/telegram-provider-router && node --check src/index.js && node --test scripts/test-freebuff-model-sync.mjs)
  - node scripts/journey-guard.mjs r15-omni-agent-lanes
---

# Packet: R-15 — every agent usable across all bots (Freebuff lane first)

Agent fills this. Human replies: **go** | **stop** | one comment.

## Journey

Today the bot fleet has four real backend lanes (`opencode`, `cline`, `grok`, `agy`, plus API-only `gemini`) and the contract explicitly says bot ids are places and surfaces are interchangeable — but the **Freebuff surface (this platform) is not properly connected**: its TG lane is `EXPERIMENTAL, off by default` (`FREEBUFF_TG_LANE=1`), it works only by scraping a tmux TUI (no one-shot CLI, no session, no server), and it is exempted from the lane table's guarantees. "All agents across all bots" means: (a) every backend that *can* run a turn headlessly is first-class in the lane contract, (b) a backend that *cannot* (Freebuff CLI today) is declared honestly as a degraded terminal-only lane instead of a hidden special case, and (c) any of them can fill any role (specify/implement/verify) on any bot within its declared capabilities. This packet prepares that new roadmap item end-to-end without touching live bots.

## Findings (do not redo)

- **Contract shape (BOT-17, landed):** `scripts/lib/lane-contract.mjs` — `LANES` = opencode/cline/grok/agy/gemini/human with `degraded` capability lists; `FORBIDDEN_BOT_IDS` includes `grok`; `GRANDFATHERED_IDS=['opencode']` must never grow. The gate `scripts/assert-lane-contract.mjs` (27 checks) + `tests/lane-contract.test.ts` (12) enforce this.
- **Freebuff lane exists but is disabled by default:** `tools/telegram-provider-router/src/freebuff-tg-lane.js` — gated on `FREEBUFF_TG_LANE=1`, single-flight, yields to a live human CLI session, balance pre-check, turn boundary = TUI quiet-window scraping (best-effort, "NOT yet proven against the live vendor"). Router `index.js` imports it and declares a `freebuff` provider block; the Stop message explicitly says "Freebuff is not a TG lane" when it is disabled.
- **Upstream constraint verified today (this box):** `freebuff` CLI is **v0.0.197** and its help exposes only `login` + `--continue` + `--cwd` + `--trust-agents ("for CI")`. No `run`/one-shot, no `serve`, no ACP. (Contrast: CodeArts Agent CLI v26.9.7 — an OpenCode fork — has `run --format json`, `serve`, `acp`.) So Freebuff stays terminal/TUI-bound until its CLI grows a headless verb or an official API route (the in-repo note: `POST /api/v1/chat/completions` answers "No runId found").
- **Freebuff accounting corrected on main:** the spendable pool is `GET /api/v1/freebuff/session` (Freebucks pool), NOT `/api/v1/usage` (wallet); catalog sync `freebuff-model-sync.js` is upsert-only. The pool is shared/account-wide, single-instance per account — a second session takes over the first.
- **Frozen boundaries from plan/ROADMAP.md Current work:** BOT-1–23/25 landed libs are history; BOT-24 catalog work is parked behind R-14.1 with packets "do not start"; CB-6 superseded; no bot per role/project/place; dev is a transient process. R-14.1 cards are the current bot work — **this packet must not preempt them**; it is the preparation + design for the *next* roadmap item (working title R-15), executed only after R-14.1 closes or the human reorders.
- **This box ≠ deploy box:** VPS auto-deploy runs its own clone (`/home/ubuntu/deploy/Health-tracker`). Nothing here touches the live router or `~/.config`.

## Plan (procedural micro-node graph — executed only on go, after/parallel-to R-14.1 per human)

1. **Node 1 — lane contract: add `freebuff` as a first-class lane.**
   `scripts/lib/lane-contract.mjs`: `freebuff: { kind: 'cli', apiOnly: false, tools: true, session: false, degraded: ['resume', 'headless'], degradedReason: 'Freebuff CLI 0.0.19x is TUI/login only (no one-shot, no serve/ACP); TG lane is an opt-in tmux scrape (FREEBUFF_TG_LANE=1).', roles: [...ROLES] }`. Do NOT touch `GRANDFATHERED_IDS` or `FORBIDDEN_BOT_IDS` (add nothing there — bot ids stay places).
   Done when: `tests/lane-contract.test.ts` gains rows for the new lane + a pin that `GRANDFATHERED_IDS` is unchanged; `node scripts/assert-lane-contract.mjs` exits 0.
2. **Node 2 — capability probe helper (pure).**
   New exported helper in `scripts/lib/lane-contract.mjs` (or `free-lanes.mjs` if cleaner): `laneSupports(lane, capability)` used by callers instead of ad-hoc `degraded.includes` checks; a `headless` capability key becomes the formal probe ("can this backend take a one-shot prompt from a script today?"). Keep it pure — no env, no fs.
   Done when: unit tests cover supports/fails for every lane × capability; no caller regressions.
3. **Node 3 — Freebuff TG lane: promote from experimental to contract-honest.**
   In `tools/telegram-provider-router/src/index.js` + `freebuff-tg-lane.js`: keep default OFF (single-instance takeover is a real footgun) but (a) make the disabled-state message read the lane contract instead of hardcoding "Freebuff is not a TG lane", (b) surface `headless` as unsupported in `/allowance`/`/freemodel` rows for freebuff routes, (c) sync the vendor mirror `free-lane-table.vendor.mjs` (drift-gated copy of `free-lanes.mjs` helpers). No behavior change when `FREEBUFF_TG_LANE` is unset.
   Done when: router `node --check` + freebuff-model-sync test file green; disabled path text asserts from the contract table.
4. **Node 4 — R-15 charter into ROADMAP (docs-only node).**
   Append a `## R-15 — omni-agent lanes` section to `plan/ROADMAP.md` *behind* R-14.1 in execution order, containing: destination journey (bot-code), the three-part definition of done above (contract lane / honest degraded declaration / any lane fills any role within declared caps), the acceptance matrix (each lane × each role × evidence pointer), and explicit "do not" rows inherited from Current work (no registry rows for agents, no second bug pipeline, no new bot ids). Mark it `blocked on R-14.1 completion` — the human may reorder.
   Done when: ROADMAP section exists, ordering says R-14.1 first, and `journey-guard` passes with the new packet present.
5. **Node 5 — upstream watch (no code).**
   Record in the R-15 section: re-probe `freebuff --help` when the CLI bumps past 0.0.197 — if a `run`/`serve`/`acp` verb appears, Freebuff graduates from `headless`-degraded automatically (the Node-2 probe is the switch). Nothing to build now; the probe helper from Node 2 is what flips.
   Done when: the ROADMAP charter names the exact CLI capability that graduates the lane (no vendored version pin).

## Test plan

```text
npx tsc --noEmit
npx vitest run tests/lane-contract.test.ts
node scripts/assert-lane-contract.mjs
(cd tools/telegram-provider-router && node --check src/index.js && node --test scripts/test-freebuff-model-sync.mjs)
node scripts/journey-guard.mjs r15-omni-agent-lanes
```

No live Telegram, no bot restarts, no `freebuff` login/session spawn (hard rules: this box's Freebuff instance and `~/.config` are off-limits; single-instance takeover must never be triggered from here).

## Audit plan

1. Scope vs ROADMAP: R-15 is added *behind* R-14.1; no BOT-24 packet started; no registry/capabilities file touched (both Frozen here).
2. Class check: the change is `lane declaration + capability probe + honest status rendering` — not a new dispatcher, not a provider rewrite.
3. Honest residual named: Freebuff remains terminal-only until upstream ships a headless verb; the TG lane's TUI turn boundary stays best-effort and unproven against the live vendor.

## Blast radius

Allowed / Frozen are the YAML lists above.
Out of scope: `bots/registry.json`, `bots/capabilities.json`, bot-host runners, dispatch script, any `src/` app code, live VPS/phone/collab hosts, `~/.config/**`.

## Stop and come back

Two repairs fail · Frozen file in the diff · R-14.1 starts consuming this packet's files concurrently · upstream Freebuff CLI changes the help surface mid-packet.
