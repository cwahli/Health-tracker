# Bot work — the only file to load

Read this, then stop. Do not load `plan/ROADMAP.md`, `plan/BOT_ROLES.md`, `plan/RELIABILITY.md`, `plan/BUG_TICKET_PIPELINE.md` past §6.2, or `AI_HANDOVER.md` past its first heading.

## Next code (no token)

**BOT-20 — pack, then reject.** `run-coding-dispatch.sh` calls the existing `scripts/lib/bug-pack.mjs` (`packCheck` / `splitMultiItemReport`). Input is a versioned `work_item` or the four fields `page`, `observed`, `expected`, `screenshot`. Several defects become one card plus a split list. Nothing that fails `packCheck` is passed through as `--task`. Do not write a second packer.

**BOT-18 is DONE 2026-09-24.** Lease `{chatId, messageId, startedAt, pid}` written on run start and updated on progress create; boot sweep edits orphaned messages to `restarted mid-run — send it again` and appends `crash-pending` row; Telegram 409 conflict exits `process.exit(1)`. Tests: 119/119 green.

## Human, in parallel

**V-30.2 operations.** Packer code is merged. It is not live until the P9 token, profile env, registry handle, and one Telegram reply exist. Runbook: `plan/BUG_TICKET_PIPELINE.md` §6.2. Do not start V-30.3 until that closure and an explicit human go.

## Then, in order

1. **BOT-21.** Log `(ticket, agent, tool, args-hash)`. The same hash twice on one ticket alerts. Two repro verdicts on one card must match or escalate.
3. **BOT-14.** The two missing `shared_skills` paths in `bots/registry.json` become links to `scripts/skills/common`.
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
