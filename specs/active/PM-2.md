---
id: PM-2
status: draft
class: pm-role-never-ran-live
edit_mode: patch
skill: debug-contract
auto_go: false
allowed_files:
  - bots/registry.json
  - systemd/pm-sweep@.service
  - systemd/pm-sweep@.timer
  - scripts/lib/pm-fleet.mjs
  - scripts/lib/pm-ladder.mjs
  - scripts/lib/pm-sheet.mjs
  - scripts/lib/pm-run.mjs
  - scripts/assert-pm-role.test.mjs
  - scripts/bot-forge.mjs
  - scripts/lib/bot-forge-core.mjs
  - scripts/sync-bot-tokens.mjs
  - scripts/lib/project-registry.mjs
  - scripts/bot-host.mjs
  - package.json
  - .github/workflows/ci.yml
  - docs/agents/bot_work.md
frozen_files:
  - src/App.tsx
  - src/components/LogChat.tsx
  - src/jobs/JobStore.ts
  - server_meal_gate.ts
  - AGENTS.md
  - docs/agent/standing.json
  - scripts/assert-standing.mjs
  - scripts/journey-guard.mjs
  - specs/active/PM-1.md
gate:
  - npx tsc --noEmit
  - node scripts/assert-pm-role.test.mjs
  - node scripts/assert-bot-clone.mjs
  - node scripts/check-capability-propagation.mjs
  - live: timer fires a real sweep, ladder file advances, sheet rows land, /role pm status reads them back
---

# PM-2 — PM bot: thin clone, schedule, sheet, forge token fix

## Goal
One sentence, checkable: a dedicated project-manager bot (thin `vm` clone, zero feature loss by contract) runs the PM sweep on a schedule, keeps the ongoing-projects sheet current, and nudges stuck agents — proven live, not just sensor-green.

## Audit (what deepseek built, what is still missing)

Delivered and merged (all `Author: deepseek-v4-flash (max) Mac` unless noted):
- #336 thin clones — every bot inherits the registry master; `extends:vm` rows carry the full VM surface by contract (`assert-bot-clone`).
- #340 one-click bot forge (`scripts/bot-forge.mjs`) — name to running bot, the easy-add process requested.
- #344 `/role pm` (`specs/active/PM-1.md`, `scripts/lib/pm-{fleet,ladder,run,sheet}.mjs`, `assert-pm-role.test.mjs` — 24 tests incl. 3-process E2E, real code, no stubs) plus CI fixes (#347, #349, #354).

Verified missing (live state 2026-09-29, code audit vs PM-1):
1. No PM bot exists — PM-1 built a `/role` on `vm` and forbids a new bot/token/poller (§73-85). A dedicated bot needs an explicit override of that clause (this packet, once locked).
2. PM never ran live — no `pm-ladder.json` on disk, no `GOOGLE_PM_SHEET_ID` configured, no timer, nudge network unexercised (no teleproto session), sheet Google-half unexercised.
3. Forge skips door tokens — `bot-forge.mjs`/`sync-bot-tokens.mjs` never write `TUI_BOT_TOKEN_<ID>`; every forged bot ships a board button that 401s (proven live on bug_ticket 2026-09-29, fixed by hand). The forge must register the token or warn.
4. Ten code deviations, all minor, none blocking (full list in audit): `forgetCounters` never wired (ladder grows forever); whole-fleet spooling every run (50-row flush backlog); unknown `/role pm <x>` falls through to bare instead of erroring; `runCycle` drops `chatId`; `deliverNudge` counts `undefined` as delivered; dead `liveFn` param; `heartbeatFor` substring over-match; no ladder lock/fsync; disk-full throws escape `handleCommand`; ledger/heartbeat read failures silent-empty vs tickets-error-honest.

## Understanding (what this is NOT)
- Mechanism: the PM machinery is complete but inert — no identity, no schedule, no sheet, no first run.
- Not this: a second tracker or second Google client (PM-1 forbids both; `pm-fleet` stays a read-only projection, `pm-sheet` reuses `writerFor`/`appendRows`); rewriting PM-1 (it stays frozen, this packet supersedes only the no-new-bot clause); a bot per project (one PM bot, fleet-wide).
- Evidence: `ls ~/.local/state/bot-host/*/pm-ladder.json` empty; `GOOGLE_PM_SHEET_ID` absent from `~/.config/bot-host/*.env`; `systemctl --user list-timers` has no PM entry; forge source has no `TUI_BOT_TOKEN` reference.
- Non-goal: changing what the sweep decides (fleet/ladder logic untouched except the ten listed fixes).

## In scope
- Thin PM row in `bots/registry.json` (`extends:vm`, own token/soul note), forged or hand-added per `bots/TOKENS.md`, `assert-bot-clone` green.
- `TUI_BOT_TOKEN_PM` in `tui-gateway.env` + forge/sync support so the PM bot's board button validates (fix #3 for all future bots, not just PM).
- `systemd/pm-sweep@.timer` + service invoking the existing `pm-run` cycle on a schedule (repo-native cron; Hermes cron is Mac-host and out of scope).
- `GOOGLE_PM_SHEET_ID` configured; first live sweep observed: ladder file advances, sheet rows land, `/role pm status` reads them back.
- The ten audit deviations fixed in place (same files, no new surfaces).

## Out of scope
- Fleet/ladder decision logic redesign; new tracker; second Google client; PM-1 rewrite; per-project bots.

## Forbidden patch (named)
- No symptom-hide: enabling the timer without the sheet ID (sweeps that spool-and-never-flush look busy while proving nothing).
- No new feature flag; no second merge/write path for sheets or nudges.
- No renaming the PM role or forking `/role pm` (one entry point stays).

## Done-when
- Sensor green (`assert-pm-role.test.mjs`, `assert-bot-clone`, propagation, `tsc`).
- Live: timer fired at least one real sweep; `pm-ladder.json` exists with advancing attempts; `ongoing_projects` tab has rows with rung+attempts; a stalled fixture (not prod) produced a `not delivered`-honest or delivered nudge.
- Forge creates a test-clone row with `TUI_BOT_TOKEN_<ID>` registered (dry-run or docs proof, no stray bot left running).

## Residual / risks
- Nudge delivery needs a teleproto session + API creds (operator step, like `google-authorize`); until then nudges report `not delivered` honestly.
- One PM bot is an explicit exception to the no-bot-per-role law — record the justification here when locking, or shrink scope to timer-only.
