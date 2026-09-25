# Bot work — the only file to load

Read this, then stop. Do not load `plan/ROADMAP.md`, `plan/BOT_ROLES.md`, `plan/RELIABILITY.md`, `plan/BUG_TICKET_PIPELINE.md` past §6.2, or `AI_HANDOVER.md` past its first heading.

## Ticket flow (roles, not bots)

**packer** (`bug_ticket`, Solar-free, card only: `queue --json` → `create` → `pack --check` → reply → STOP; never specs, never dispatch, never `src/`)
→ **QA** reproduces (`qa-runner.mjs --ticket`, posts `repro{status,command,run_log,before.png}`; never fixes)
→ **orchestrator** specifies (strong model with packet + repro on the card; writes `specs/active/<card>.md` from `specs/TEMPLATE.md` with Understanding + Layer + Forbidden patch + two fixtures)
→ **you** lock (`go`)
→ **script** dispatches one healthy backend (`run-coding-dispatch.sh --ticket`; dev is a transient process, never a bot)
→ **verifier** (didn't author it) closes on `named_test` green.
Reference transcript: stuck meal-analysis card (`STALE_TURN`, `jobPreview.ts` turn plumbing) in `plan/ROADMAP.md` Track V Phase 10, V-30.4 row.

## Next code (no token)

**BOT-20 is DONE 2026-09-24.** `run-coding-dispatch.sh` calls `scripts/lib/bug-pack.mjs` (`packForDispatch` calling `packCheck` / `splitMultiItemReport`). Input is a versioned `work_item` or the four fields (`page`, `observed`, `expected`, `screenshot`). Multi-item reports are split to 1 card + split list. Any payload failing `packCheck` is rejected with exit code 1 and never passed through as `--task`. Tests: `src/utils/bugPackFixtures.test.ts` (17/17 green), `scripts/assert-bug-pack.mjs` (31/31 green).

**BOT-21 is DONE 2026-09-24.** Log `(ticket, agent, tool, args-hash)` in `scripts/lib/coordination-tax.mjs` and `run-coding-dispatch.sh`. The same hash twice on one ticket alerts (`REPEAT_ARGS_HASH`). Two repro verdicts on one card must match or escalate (`repro_verdict_conflict`, `assignee=orchestrator`, `queue=blocked`). Tests: vitest 123/123 + 35/35, assert-coordination-tax 29/29.

**BOT-23 is DONE 2026-09-24.** Journey investigation & pre-dispatch regression gate. Investigated recent broken meal/portion journey; added `scripts/lib/dev-regression.mjs` and `scripts/assert-dev-regression.mjs` (17/17 tests passing); wired pre-dispatch dev regression & blast radius verification into `scripts/run-coding-dispatch.sh` `check_git_and_tsc()`. Rule L1 blast-radius violations reject uncommitted edits immediately; UI edits require `node scripts/assert-shell-smoke.mjs` (Playwright) to pass before commit/push.

**Next code is R-14.1, one card at a time, in `plan/R14_1_AGENT_PLAN.md`.** BOT-13, BOT-15, BOT-16, BOT-17, BOT-18, BOT-19, BOT-20, BOT-21, BOT-22, and BOT-23 are DONE. Do not start them again. V-30.1–V-30.5 are DONE. Do not reopen them. Residuals that are not this work: BOT-9 propagation/smoke, BOT-11 T-matrix rows. They wait until the R-14.1 live cards are closed.

**BOT-18 is DONE 2026-09-24.** Lease `{chatId, messageId, startedAt, pid}` written on run start and updated on progress create; boot sweep edits orphaned messages to `restarted mid-run — send it again` and appends `crash-pending` row; Telegram 409 conflict exits `process.exit(1)`. Tests: 119/119 green.

## Laws

- The poller is a place and owns one token. `/location` chooses a connected worker for the next turn. Setting `BOT_LOCATION` on the VM is not that choice. Do not move the poller. Do not add a bot per role, per project, or per vendor. Antigravity is not a location. Do not reopen BOT-17 to restate this.
- `/freemodel` and `/allowance` belong to the worker that is running the turn. Each host sees only its own tools and quota. A depleted lane takes the next equivalent lane on that same worker. Location changes only when that list is empty. Freebuff is terminal-only. Gemini is not a new picker. The Cline CLI adapter stays degraded for session resume. Do not start there.
- Website coding stays one checkout, one coder, `dispatch_lock`. On insufficient funds inside that dispatch, one retry with `opencode/deepseek-v4.1-flash` on the same surface, then stop and post the real error. That retry is not `/location`. Do not rebuild the dispatch path for external projects.
- One defect per card. The script starts the coder. The Orchestrator profile only posts status.
- The card closes when `verify.method` is `named_test` or `manual` and `verify.result` is `green`. A green journey stays `verifying`. `bugState` enforces this (`JOURNEY_GREEN_DOES_NOT_CLOSE`).
- Do not push the coder's commit onto `origin/main`. Open a PR from `agent/<area>`.
- BOT-1 through BOT-23 are history. V-30.1 through V-30.5 are history. CB-6 as written (push to `origin/main`) is superseded. Do not resume CB-7 or CB-8.

## Do not

Do not dual-poll a token. Do not restart `hermes-gateway`. Do not run `bot-host@android` on the VPS. Do not add a bot per vendor, role, or project. Do not autonomous-commit. Do not blank `bots/soul.md`. Do not mark R-14.1 done from `assert-external-projects.test.mjs`. Do not implement the Antigravity install or the silent cloud fallback in `plan/LOCATION_AGNOSTIC_PROJECT_COUNCIL.md`.
