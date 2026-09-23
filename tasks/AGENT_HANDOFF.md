# Agent handoff — 2026-09-24

Context from Telegram consolidation session (OpenCode Muse depleted mid-thread; Cline took over).

## Already done / closed
- **PR #46** — close/obsolete (targeted deleted `opencode-bot.mjs`; global dispatch lock removed by #47).
- **PR #42** — superseded on `main` (rename/token-sync already landed).
- **PR #51** — open: humanize raw `900000ms` timeout copy in `scripts/bot-host.mjs` + `agent-opencode.mjs` + tests. Local tsc/tests green; CI reds are **pre-existing on main**, not introduced by #51.

## Open for next agent

### 1. PR #51 CI (Track F)
- Gate `server_brand_match` **F-8.12** (Hemaviton vitamin C) fails on CI push runs since ~17:42, **passes locally** (Node 22, full suite).
- Suspect: CI-env / lockfile divergence.
- Also: Workers Builds reds known from session.
- Goal: make #51 mergeable by fixing **main’s** CI-only F-8.12 (or documenting skip if truly infra).

### 2. PR #39 (R-13.2 SSE ping)
- Still open; files disjoint from #51 (`server.ts` / SSE). Merge when CI settles.

### 3. Capability matrix (this branch)
- `public/capability-matrix.html` + `GET /capability-matrix` in `server.ts`.
- Do **not** fold into #51 (already stripped from that PR).
- Image intake + `/` autocomplete **did** land on main — refresh matrix rows if stale.

### 4. Roadmap wrap (user ask)
Turn the consolidation summary into a **ROADMAP open item** for another agent:
- Do not re-introduce the global `~/.hermes/dispatch_lock`.
- Prefer per-file locks (`file-locks.mjs`) / no-op `acquireDispatchLock`.
- Track: #51 CI unblock → merge; #39 merge; capability-matrix PR; D-2 as already tracked in specs.

## Repo
`cwahli/Health-tracker-2`. Working copy: `/workspace/biomarker-and-nutrient-tracker`.

## Telegram router (separate; not in this git tree)
`/home/box/.config/telegram-opencode/router` — self-heal gaps (single poller/409, Cline 240s orphan timeout, quota ledger) still need a ticket; not part of this push.
