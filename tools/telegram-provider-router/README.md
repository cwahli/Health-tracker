# Telegram provider router (`tg-provider-router`)

Single Telegram bot that routes to **OpenCode / Cline / Token Harbor / Cloudflare Workers AI / Freebuff**, with shared vs per-model free-allowance memory, Busy self-heal, and one-poller locking.

> **Runtime on the Grok box today:** `~/.config/telegram-opencode/router/` (live `.env`, `state/`, `logs/`).  
> **This folder** is the shareable source of truth for other agents. Deploy by copying here → that path (or symlink `src`), then `npm i && npm start`. **Never commit `.env`, `state/`, or `logs/`.**

Related (older, still in-repo): `scripts/bot-host.mjs`, `bots/registry.json`, `docs/agents/telegram_work.md` — multi-bot host / typing standards. This router is the **unified multi-provider** path we actually run for free-lane coding from Telegram.

---

## Why this exists

We hit the same classes of failure repeatedly:

1. **Two pollers on one bot token** → Telegram `409 Conflict`, sticky Busy, dropped messages.
2. **Free quota** treated as per-model when the vendor uses a **shared bucket** (or the reverse) → false “still available” estimates and bad failover.
3. **Hung OpenCode / orphan Cline children** after restart or timeout → Busy forever, leftover typing pulse.
4. **Failover that greets instead of replaying the user prompt** → wasted quota and confusion.

This package encodes the fixes. Read `docs/` and `tickets/*_REPORT.md` before changing behavior.

---

## Platforms (how each is managed)

| Provider | How Telegram drives it | Free allowance shape | Notes |
|----------|------------------------|----------------------|-------|
| **OpenCode** | HTTP to `OPENCODE_SERVER_URL` (`serve` on :4096) | **Shared Zen free bucket** for Muse / MiMo / Ling / Nemotron / Space Bunny when catalogued | Tools + files. `/freemodel` only lists models the **live** `GET /provider` returns. |
| **Cline** | CLI (`cline -m cline-free/…`) | **Per-model** daily free caps | Track child PID; default timeout ≥20 min; SIGTERM→SIGKILL on unlock/timeout. `/think` wired. |
| **Token Harbor** | OpenAI-compatible API *or* OpenCode `tokenharbor/<model>` | **Shared** rolling ~7-day free value bar | `/freemodel` Token Harbor taps → OpenCode+tools; `/switch tokenharbor` stays chat-only. |
| **Cloudflare** | OpenCode `@cf/…` / Workers AI | **Shared** 10k neurons/day (UTC) | `/allowance` uses per-reply neuron estimates; live GraphQL needs Analytics Read on the token. |
| **Freebuff** | CLI / session Freebucks | **Shared** daily Freebucks (region-based) | Terminal-only by default (TUI/`login` only, one session per account). EXPERIMENTAL Telegram lane exists behind `FREEBUFF_TG_LANE=1` (`src/freebuff-tg-lane.js`, stub-tested): yields to a live terminal session, single-flight, balance pre-check, always cleans up. Needs funded balance + idle account — not yet proven live. |

Commands (high level): `/switch`, `/model`, `/freemodel`, `/allowance`, `/allowance table` (same free-lane ledger as an HTML grid, delivered with `MEDIA:<abs-path.html>`), `/status`, `/think`, `/compact`, `/unlock`, Cancel & unlock on Busy replies.

`/freemodel` is **buttons-only**: a short header plus one inline button per free lane (no per-model text dump). Token Harbor chat and OpenCode `tokenharbor/…` are the same free bar, so they render as **one** button (the OpenCode tools path wins). Freebuff gets a button whenever the box is signed in; tapping it replies with terminal-only instructions (run `freebuff` in a tmux on the host) and does **not** switch the Telegram route. Labels are right-padded with spaces because Telegram's `InlineKeyboardButton` has no `align` (see `tmp/ht-freemodel-buttons-only/REPORT.md`).

---

## Quota memory (`FREE_ALLOWANCE_BUCKETS`)

Defined in `src/index.js` as `FREE_ALLOWANCE_BUCKETS` + `markDepleted` / `isDepleted` / `allowanceBucketSection`.

| Bucket id | Scope | Members / match |
|-----------|-------|-----------------|
| `opencode-zen-free` | **shared** | OpenCode free lane (muse/mimo/ling/nemotron/space-bunny / `*-free`), not tokenharbor/cloudflare |
| `tokenharbor-free` | **shared** | Token Harbor / `*:free` |
| `cloudflare-neurons` | **shared** | `@cf/*` / cloudflare — 10k/day UTC |
| `cline-free` | **per-model** | Each `cline-free/<model>` tracked separately |
| `freebuff-freebucks` | **shared** | Freebuff UI daily |

On a free-limit / rate-limit error:

- Parse `try again in Xh Ym` or `until <iso>` → `depletedUntil`.
- **Shared:** one `state.quota["bucket:<id>"]` entry; failover skips **all** members.
- **Per-model:** key stays `cline/…`; siblings stay available.
- `/allowance` shows **Buckets** (Depleted vs Still available) + active route + CF neuron block.

Space Bunny may be listed in the Zen bucket membership for future failover honesty, but must **not** appear on `/freemodel` until the live OpenCode server catalogs it (CLI-only ids → `Model not found`, not a clean quota miss).

---

## Hang / Busy / single-poller self-heal

| Problem | Mechanism |
|---------|-----------|
| Two `getUpdates` consumers | `run/router.lock` + `run/router.pid` flock; second start exits `another router owns the token` |
| Endless 409 spin | Exit after `ROUTER_MAX_409` (default 3) |
| Sticky Busy after restart | Startup aborts leftover work and clears Busy lock |
| Busy but nothing running | ~30s watchdog unlocks after ~45s idle; wedged waiter if OpenCode idle but TG Busy |
| Orphan Busy on next message | Cleared; Busy replies expose Cancel & unlock / Status / New session |
| `/unlock` | Cancels stuck work + reaps Cline PID tree |
| OpenCode long run | Wait for session idle (~60s progress); abort after 15m inactivity or 2h ceiling; **work-so-far report** on stop (not bare timeout) |
| Typing pulse | Refreshed while working; cleared on Idle/unlock (no leftover dots from duplicate pollers) |
| Failover | Re-dispatch the **same** user prompt; banner `⚡ Auto-switched…`; skip depleted buckets |

**Operator rule:** exactly **one** `node src/index.js` (or `npm start`) per bot token.

---

## Quick start (another agent / another host)

```bash
cd tools/telegram-provider-router
cp .env.example .env   # fill tokens; never commit
npm install
# Ensure OpenCode serve (if using that lane) is up on OPENCODE_SERVER_URL
npm start
```

Deploy to the Grok box runtime (example):

```bash
rsync -a --exclude node_modules --exclude .env --exclude state --exclude run --exclude logs \
  tools/telegram-provider-router/ ~/.config/telegram-opencode/router/
# keep existing .env / state on the box
cd ~/.config/telegram-opencode/router && npm i && npm start
```

Verify single poller: `pgrep -af 'node src/index.js'` → one process; second start should exit cleanly.

---

## Docs & tickets in this folder

| Path | What |
|------|------|
| `docs/BEST_PRACTICE.md` | One token → one poller; architecture; phone/OpenCode patterns |
| `docs/MORNING_CHECKLIST.md` | Daily connect checklist |
| `docs/OVERNIGHT_TG_CONNECT.md` | Provider readiness matrix |
| `tickets/TG-ROUTER-SELFHEAL.md` + `TG_ROUTER_SELFHEAL_REPORT.md` | Lock, Cline orphans, failover prompt, light quota |
| `tickets/TG-ALLOWANCE-BUCKETS.md` + `TG_ALLOWANCE_BUCKETS_REPORT.md` | Shared vs per-model `/allowance` |
| `tickets/TG-CLINE-THINK.md` + report | Cline `/think` |
| `tickets/TG-CLINE-FREEBUFF-LONGTERM.md` | Still open: durable TG Cline harden + Freebuff restore |
| `tickets/TG-ROUTER-MODEL-SYNC.md` | Sticky session model labels vs `/status` |

---

## What is intentionally *not* here

- Live `.env`, Cloudflare secret files, `state/session.json`, logs
- `index.js.bak-*` scratch copies
- Hermes / multi-bot `bot-host` registry (see repo root `bots/`, `scripts/bot-host.mjs`)

When you change quota or self-heal behavior, update this README and add a short ticket/report under `tickets/` so the next agent does not rediscover the same outage.

---

## Cross-agent shared pack (this computer)

Canonical location for **all** Grok agents (not only Health-tracker):

`/home/box/agent-data/shared/telegram-capabilities/`

See [SHARED_ROOT.md](./SHARED_ROOT.md). Skill: `telegram-shared-capabilities`.
Planned shared adds: capability matrix table, inbound photo inbox.
