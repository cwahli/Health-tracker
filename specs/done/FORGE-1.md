---
id: FORGE-1
status: done
class: new-bot-needs-five-surfaces
# `bots/TOKENS.md`'s "Add a bot" procedure is restructured around the forge (~34%
# line churn), which is a rewrite of that section rather than a patch to it.
edit_mode: rewrite
skill: debug-contract
auto_go: false
allowed_files:
  - scripts/bot-forge.mjs
  - scripts/lib/bot-forge-core.mjs
  - scripts/lib/bot-forge-server.mjs
  - scripts/lib/tg-userbot.mjs
  - scripts/assert-bot-forge.test.mjs
  - scripts/add-bot.mjs
  - scripts/add-bot.test.mjs
  - scripts/assert-bot-clone.mjs
  - scripts/assert-bot-clone.test.mjs
  - scripts/lib/registry.mjs
  - tests/registry-inherit.test.ts
  - bots/registry.json
  - bots/TOKENS.md
  - package.json
  - package-lock.json
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
gate:
  - npx tsc --noEmit
  - node scripts/assert-bot-clone.mjs
  - node scripts/assert-bot-clone.test.mjs
  - node scripts/add-bot.test.mjs
  - node scripts/assert-bot-forge.test.mjs
  - npx vitest run tests/registry-inherit.test.ts
---

# FORGE-1 — one-click bot forge

## Goal

Type a name, get a working bot: the token obtained, the thin registry row
written, the token line added, the runtime env files synced, supervision
generated and checked, and the command menu published — with a receipt that names
the step that stopped if any of it fails.

## Understanding

- Mechanism: creating a bot spans five surfaces (registry, master token file,
  per-runtime env file, systemd unit, Telegram API). Any one of them alone leaves
  a bot that does not run, and each one alone *looks* finished. The fix is not a
  faster script; it is one ordered path with a receipt.
- Not this: not a per-surface helper that the operator runs in order (that is the
  old `bots/TOKENS.md` procedure, which is exactly how a half-created bot
  happens), and not a second creation path behind the Mini App. The HTTP surface
  injects the same `runForge`.
- Evidence: `scripts/assert-bot-forge.test.mjs` drives the paste path end to end
  as a child process against a scratch tree and a fake Bot API.
- Non-goal: the project-manager role (PM-1). Nothing here reads project status.

## Layer

- Layer: data/config (scripts + registry + docs). No product UI change: the Mini
  App page is served by the forge itself, so `src/` is untouched.
- Frozen: `src/**`, `server*.ts` (the app and its API are out of scope by
  construction).

## Forbidden patch (named)

- No second creation path: the Mini App must call `runForge`, never re-implement
  the steps.
- No hand-written systemd unit: the user-scope unit is a transform of
  `systemd/bot-host@.service`, so the live unit and the generated one cannot
  drift.
- No "usable" claim without `getMe`: `enabled: true` is written only after the
  token answered, which is what makes the word honest.
- No anonymous create endpoint: initData HMAC (the gateway's existing
  `validateInitData`) or loopback.

## Two-sided fixture

- Broken input → correct output: a token that is already another bot's value, a
  name with no letters, and an unreachable Telegram each stop the run, name the
  step, and leave the registry unchanged except for the artifact that step
  legitimately wrote (`enabled: false`).
- Adjacent input → unchanged: `scripts/assert-bot-clone.mjs` and
  `tests/registry-inherit.test.ts` still pass, so a forged bot is a thin clone
  and the inheritance contract still holds on the scratch registry the E2E run
  produced.

## In scope

- The pipeline, its refusals, its receipt, and the CLI (`--create`, `--serve`,
  `--state`, `userbot-login`).
- The Mini App page and its door (initData or loopback) — the button on the front.
- The userbot: BotFather negotiation, the one-time login, and its clean refusal
  when the session is missing.
- `add-bot.mjs` gains `--registry=` and `--enable=` so the forge has exactly one
  registry writer.

## Out of scope

- Live host steps: `api_id`/`api_hash`, the phone login, `loginctl
  enable-linger`, and starting `bot-host@<id>` on the VPS. The forge prints these
  as `hostCommands`; it never pretends to have run them.
- Doing the BotFather automation against a real account (needs a session).
- PM-1.

## Done when

1. `node scripts/assert-bot-forge.test.mjs` is green, including the end-to-end
   paste run against a scratch tree and a scratch registry.
2. The token-duplication and bad-name refusals still hold, with nothing written.
3. The unit is generated and its `EnvironmentFile` is checked against the file
   the sync wrote (provable on a laptop: no VPS).
4. The userbot path refuses with the reason and the exact host commands.
5. `git diff --name-only` ⊆ allowed_files; the gate commands exit 0.

## Residual (honest)

- The userbot's *network* path is unexercised: `teleproto` is declared in
  `package.json` but this checkout has no session and no account, so only its
  negotiation logic (fixtures) and its refusal (live) are proven.
- The Mini App page is exercised through its script against a stubbed DOM, not in
  a browser. Nobody has tapped it in Telegram yet.
- `node scripts/assert-spec-diff.mjs FORGE-1` reports `extra_file` for
  `server_*`/`src/mealBuild/*`/`src/utils/portionUtils.ts` while this share of the
  checkout carries another agent's uncommitted portion-selection work. Those paths
  are not in this packet's diff and are not in this packet's allowed_files on
  purpose: licensing them here would let unrelated edits ride on FORGE-1.
- Supervision is proven as generated-and-wired, not as running: no `systemd
  --user` on a Mac, and the VPS was not touched.

<!-- closed 2026-10-02: gate assert-bot-forge 51/51 plus bot-clone and add-bot green; vm3 was forged through this path and is connected -->
