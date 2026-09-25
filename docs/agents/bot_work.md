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

**Next code: none open.** BOT-19 is DONE 2026-09-24 — live acceptance passed after fixing the real-tmux quoted `pane_start_command` matcher defect (`unquoteTmuxValue` + sensors); observer binding is proven end to end on the VPS (see ROADMAP BOT-19 pickup). BOT-15/16/17/18/20/21/22/23 are DONE. Residuals: BOT-9 propagation/smoke + Grok mirror, BOT-11 T-matrix rows. V-30.5 needs an explicit human go.

**BOT-18 is DONE 2026-09-24.** Lease `{chatId, messageId, startedAt, pid}` written on run start and updated on progress create; boot sweep edits orphaned messages to `restarted mid-run — send it again` and appends `crash-pending` row; Telegram 409 conflict exits `process.exit(1)`. Tests: 119/119 green.

## Human, in parallel

**V-30.2 operations.** Packer code is merged. It is not live until the P9 token, profile env, registry handle, and one Telegram reply exist. Runbook: `plan/BUG_TICKET_PIPELINE.md` §6.2. Do not start V-30.3 until that closure and an explicit human go.

## Then, in order

1. **BOT-15.** One outcome row per dispatch: ticket, surface, provider/model, defect class, tokens, wall-clock, outcome. The pre-action gate reads it in code, beside the file locks, before the edit. The second identical signature writes one test or rule the same day.
4. **BOT-13.** Stores: `decisions/`, `dead-ends/`, `facts/`, plus shared `USER.md` (caps 1,375 / 2,200). Retrieve on a build, investigate, or decide turn only. Do not inject a whole memory file. Do not append a `/compact` summary. Missing, over-cap, or stale → a receipt. Count false-fires.
5. **BOT-15.** One outcome row per dispatch: ticket, surface, provider/model, defect class, tokens, wall-clock, outcome. The pre-action gate reads it in code, beside the file locks. The second identical signature writes one test or rule the same day.
6. **BOT-16.** Composed soul, line budgets. The three laws below live in that soul, because the Hermes gateway cwd is `~/.hermes` and a Telegram turn does not load `AGENTS.md`.
7. **BOT-22.** The Grok Telegram router uses one session for every chat. Split it per chat. Not before BOT-16.

## Laws

- A bot is a place. The runner is a surface. A model is a backend. There is no Cline agent. The Cline CLI adapter is degraded for session resume (3.0.65). Do not start there.
- One checkout, one coder, `dispatch_lock`. On insufficient funds, one retry with `opencode/deepseek-v4.1-flash` on the same surface, then stop and post the real error.
- One defect per card. The script starts the coder. The Orchestrator profile only posts status.
- The card closes when `verify.method` is `named_test` or `manual` and `verify.result` is `green`. A green journey stays `verifying`. `bugState` enforces this (`JOURNEY_GREEN_DOES_NOT_CLOSE`).
- Do not push the coder's commit onto `origin/main`. Open a PR from `agent/<area>`.
- BOT-1 through BOT-8 are history.

## Do not

Do not dual-poll a token. Do not restart `hermes-gateway`. Do not run `bot-host@android` on the VPS. Do not add a bot per vendor. Do not autonomous-commit.
