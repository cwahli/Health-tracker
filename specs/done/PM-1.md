---
id: PM-1
status: done
class: fleet-has-no-project-manager
edit_mode: patch
skill: debug-contract
auto_go: false
allowed_files:
  - scripts/lib/pm-fleet.mjs
  - scripts/lib/pm-ladder.mjs
  - scripts/lib/pm-sheet.mjs
  - scripts/lib/pm-run.mjs
  - scripts/assert-pm-role.test.mjs
  - scripts/lib/project-registry.mjs
  - scripts/bot-host.mjs
  - package.json
  - vite.config.ts
  - .github/workflows/ci.yml
frozen_files:
  - src/App.tsx
  - src/components/LogChat.tsx
  - src/jobs/JobStore.ts
  - server_meal_gate.ts
  - AGENTS.md
  - docs/agent/standing.json
  - scripts/assert-standing.mjs
  - scripts/journey-guard.mjs
  - bots/registry.json
gate:
  - npx tsc --noEmit
  - node scripts/assert-pm-role.test.mjs
  - npx vitest run tests/bot-host.test.ts
  - node scripts/assert-bot-role-wiring.test.mjs
  - node scripts/assert-external-projects.test.mjs
  - node scripts/assert-project-registry-parity.mjs
  - node scripts/check-capability-propagation.mjs
---

# PM-1 — the project-manager role

## Goal

`/role pm` on the existing VM bot, from one entry point: project the fleet from
records that already exist, climb `retry → find another way → escalate` for
anything stalled with attempt counters that survive a restart, and keep the
ongoing-projects sheet current through the governed writer — printing the
host-only steps instead of pretending to run them.

## Understanding

- Mechanism: the fleet already records everything a PM needs (locked-packet
  frontmatter, the ticket queue, the dispatch ledger, live heartbeats), but in
  four stores nobody reads together, so "what is stuck" is answered by a human
  opening files. A PM that kept its own board would be a fifth write and the
  first to go stale.
- Not this: **not a new bot and not a new token.** `plan/ROADMAP.md` forbids a
  bot per role, per project, or per place, so this is a role on `vm` — the same
  token, the same poller, a `/role` branch.
- Not this either: a second message bus. The nudge is a real message from the
  session `scripts/lib/tg-userbot.mjs` already manages (`sendAsUser`), the same
  path the forge uses for @BotFather.
- Evidence: `scripts/assert-pm-role.test.mjs` spawns the real bot-host three
  times against a fixture fleet.
- Non-goal: the one-click forge (FORGE-1). Nothing here creates a bot.

## Layer

- Layer: data/process (scripts). No product UI: the surface is a Telegram
  command on the existing bot, so `src/**` and `server*.ts` are untouched.
- Frozen: `src/**`, `server*.ts`, `bots/registry.json` (adding the role must not
  need a registry change — that is what "no new bot" means in code).

## Forbidden patch (named)

- No new bot, no new token, no second poller.
- No second tracker: the projection writes nothing. If a fact is not in one of
  the four existing stores, it does not go in the report.
- No in-memory ladder: a counter that a restart resets is the bug this change
  exists to prevent.
- No second Google client and no "create the sheet if missing": the sheet is
  found by configured id, appended to, and lives outside the project folders.
- No pretending: a rung that could not be delivered says `not delivered` and
  prints the exact commands only the operator can run.
- No second `bugctl` client: the ticket source is the real `bugctl list --json`.

## Two-sided fixture

- Broken input → correct output: a lane whose last dispatch failed hours ago with
  no live heartbeat, and a card with `flags.blocked_reason`, both climb
  `retry → another-way → escalate` across three separate bot-host processes, and
  the sheet row for the third run carries `rung=escalate`, `attempts=3`.
- Adjacent input → unchanged: a lane that failed **seconds** ago and a lane that
  failed hours ago but **has a live heartbeat** are both *not* stalled, so the
  ladder cannot fire on work that is merely failing; and a host with no userbot
  session and no Google consent sends nothing and says so.

## In scope

- The projection, its four sources, and the honest handling of a source that
  cannot be read (`tickets: error`, never "the queue is empty").
- The ladder, its rungs, the persisted counters, and the per-rung message.
- The ongoing-projects sheet: rows, the header, the spool, the flush, and the
  readiness answer with the operator's commands.
- `/role pm`, `/role pm run`, `/role pm sheet`, `/role pm status`,
  `/role pm reset` on the bot-host surface, and the `pm` role in the registry.

## Out of scope

- Host-only steps: Google consent (`scripts/google-authorize.mjs`), the userbot
  login (`userbot-login` + `api_id`/`api_hash`), and setting `GOOGLE_PM_SHEET_ID`
  in `~/.config/bot-host/common.env`. These are printed; they are never run here.
- Auto-dispatch: the ladder decides and nudges. It does not start a coder, which
  is `run-coding-dispatch.sh`'s job and stays its job.
- Rebuilding the bug board or the site's queue view.

## Done when

1. `node scripts/assert-pm-role.test.mjs` is green, including the three-process
   end-to-end run against a fixture fleet.
2. The ladder's counters survive a process boundary (proven by reading the file
   after three runs) and are mode 600.
3. The two not-stalled cases stay green, so the ladder is not "fire on any
   failure".
4. The sheet rows are spooled with the rung and the attempt count, and a host
   without credentials prints the exact operator commands and loses nothing.
5. `git diff --name-only` ⊆ allowed_files; the gate commands exit 0.

## Residual (honest)

- The nudge's *network* path is unexercised here: this host has no userbot session
  and no `api_id`/`api_hash`, so delivery is proven through the injected `send`
  seam (`negotiateBotToken`/`deliverNudge` took a transport from the start) and
  the refusal is the live path. Nobody has watched an agent receive a nudge.
- The sheet's Google half is unexercised for the same reason: the rows are
  spooled (that is the durable fact, and the sensor reads them back), and the
  append is proven with the writer's own `send` seam against a fake `appendRows`.
  No credential exists on this machine, so no real spreadsheet was written.
- Per-agent chat routing is not modelled. The nudge target is the operator chat
  from the registry (`telegram.allowedUserIds`), which is where a direct-chat bot
  answers; an agent that lives in a *different* chat would need its own id, and
  the report names the stalled item so a human can route it.
- "Stalled" on the live fleet is not proven from live data — the fixture drives
  the rules. The real ledger/queue/heartbeat shapes were read but not coupled to
  a real stall event.
- `npm install` has not been run in this checkout, so `teleproto` is absent and
  `userbotState()` reports "the module is not installed" here while CI (which
  runs `npm ci`) would report the missing `api_id`. The sensor asserts on the
  facts that hold on both hosts.

<!-- closed 2026-10-02: gate assert-pm-role 47/47 green on main; the PM seat was taken and answered live on @ht_vm3_bot and @VM_19485_bot (2026-10-02) -->
