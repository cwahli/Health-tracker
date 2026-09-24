---
id: BOT-12
status: locked
skill: debug-contract
edit_mode: patch
auto_go: false
allowed_files:
  - scripts/lib/agent-cline.mjs
  - scripts/bot-host.mjs
  - tests/bot-host.test.ts
  - plan/ROADMAP.md
  - AI_HANDOVER.md
frozen_files:
  - src/App.tsx
  - src/components/LogChat.tsx
  - src/jobs/JobStore.ts
  - server_meal_gate.ts
  - AGENTS.md
  - docs/agent/standing.json
  - scripts/assert-standing.mjs
  - scripts/journey-guard.mjs
  - scripts/assert-*.mjs
  - bots/registry.json
  - bots/capabilities.json
  - package.json
  - package-lock.json
gate:
  - npx tsc --noEmit
  - npx vitest run tests/bot-host.test.ts
  - node --check scripts/bot-host.mjs
  - node --check scripts/lib/agent-cline.mjs
  - node scripts/journey-guard.mjs BOT-12
---

# Packet: BOT-12 Telegram history parity

Human replies: **go** | **stop** | one comment. Locked for the approved quote-parity node; Cline resume nodes remain blocked on the upstream CLI contract.

## Findings (do not redo)

1. `scripts/bot-host.mjs` already persists one `sessions.json` map per bot and chat. OpenCode reads `sessions.get(chatId)` and writes `result.sessionID`; `/new` and `/compact` own reset/compaction. The Cline branch does not currently read or write that map.
2. `scripts/lib/agent-cline.mjs` currently returns `sessionID: null`. `buildClineArgs` has no resume argument, and `mapClineEvent` drops hook metadata.
3. A live isolated probe against installed Cline `3.0.65` emitted `hook_event.taskId` as `conv_...`, but the resumable root value in the session manifest/history is `session_id` / `sessionId` (`179...`). The task/conversation ID must not be persisted as a `--id` resume value.
4. Upstream Cline `apps/cli/src/main.ts` explicitly sets `startupTarget = "chat"`, clears `args.prompt`, and forces `interactive: true` whenever `args.id` is present. It then rejects interactive + JSON output. Local probes confirmed: `cline --json --id <root-id> <prompt>` exits before provider/session validation with `JSON output mode requires a prompt argument or piped stdin (interactive mode is unsupported)`.
5. Therefore the current bot-host headless wrapper cannot execute Cline session resume. Adding `--id` to `buildClineArgs` would be a deterministic unit pass but a guaranteed live failure: a known-burned hypothesis, forbidden by the negative rejection rule.
6. Reply quoting is independently implementable for every bot-host lane. Telegram already delivers `message.reply_to_message`; the current prompt uses only `message.text || message.caption` and drops the quote. Quoted media bytes are out of scope; BOT-12 requires quoted text/caption context.
7. No BOT-12 rejected hypothesis existed before planning. This packet records the `--id` + headless hypothesis as blocked evidence, not as a completed implementation.

## Journey

A Telegram follow-up on any bot-host lane carries the quoted message it replies to, and a Cline-model conversation resumes the same per-chat Cline session instead of starting from an empty context. No raw transcript is replayed: Cline owns compaction/summary behavior.

## Execution status

- **Node 1 COMPLETE 2026-09-24:** shared quoted-text/caption prompt helper wired before media injection; four deterministic rows in `tests/bot-host.test.ts`.
- **Nodes 2–4 BLOCKED:** installed/upstream Cline 3.0.65 does not support non-interactive `--id` + new prompt + JSON output and does not expose the resumable root ID in the headless stream. Do not mark BOT-12 complete.


## Procedural graph

### Node 1 — Quoted-message prompt contract (executable)

Targets: `scripts/bot-host.mjs`, `tests/bot-host.test.ts`.

1. Add one small pure/exported prompt helper beside the existing message flow. It must read only direct `reply_to_message.text` or `.caption`, trim it, and prepend a clearly delimited quoted block to the new request.
2. Condition/pitfall: `(no direct reply quote, Action: return the original prompt, Pitfall: do not invent a quote)`; `(quoted caption + new text, Action: preserve both, Pitfall: do not lose the new request)`; `(quoted object has neither text nor caption, Action: ignore it, Pitfall: do not stringify the whole Telegram object)`.
3. Wire the helper once at the common prompt-construction boundary before media injection so OpenCode, Cline, and Gemini all inherit the same quote context.
4. Add deterministic unit rows for text quote, caption quote, no quote, and empty quoted media-only object.

Step gate: `npx vitest run tests/bot-host.test.ts` includes the four quote rows and all existing bot-host rows.

### Node 2 — Cline session ID extraction (blocked by CLI output contract)

Targets: `scripts/lib/agent-cline.mjs`, `tests/bot-host.test.ts`.

Prerequisite for resuming: Cline must expose the resumable root `sessionId` in machine-readable headless output **and** support a non-interactive follow-up that accepts both a new prompt and the existing session. The installed 3.0.65 stream exposes only `taskId=conv_...`; the root ID exists only in local history/manifest, and `--id` forces interactive mode incompatible with `--json`.

Done when a supported CLI emits a documented root ID in headless JSON and a second headless call with that ID + a new prompt resumes the first turn. Then capture the ID in `runCline`, pass it through a new `sessionId` input, and add `--id <root-id>` to `buildClineArgs` only after the installed CLI accepts that exact combination.

Do not persist `taskId`, scan `~/.cline` after every run, or add `--id` to the current 3.0.65 headless args.

### Node 3 — Per-chat persistence and reset parity (depends on Node 2)

Targets: `scripts/bot-host.mjs`, `tests/bot-host.test.ts`.

1. Pass the saved Cline root ID into `runCline` and save the returned root ID through the existing disk-persisted `sessions.json` contract.
2. Keep OpenCode and Cline IDs isolated if the shared map cannot represent both without corrupting an existing OpenCode resume.
3. Ensure `/new` clears both lane IDs for the chat; `/compact` follows the existing runner-specific behavior and must not silently retain a stale Cline ID.
4. Add source/contract rows proving the Cline branch reads before dispatch and writes only a valid returned root ID.

Step gate: named bot-host unit rows plus a live Cline two-turn probe.

### Node 4 — VM2 outer proof (depends on Nodes 1–3)

1. Deploy through the normal VPS path; never run the deploy from the dev worktree.
2. On `@VM2_19485_bot`, select a Cline model and ask a unique first-turn question.
3. Reply with a second question quoting or referencing the first answer.
4. Pass only if the second answer references the first turn and the bot state stores a root Cline `sessionId`, not a `conv_...` task ID.
5. If Cline authentication or upstream headless-resume support still blocks this, report the exact external prerequisite. Do not mark BOT-12 complete.

## Test plan

```text
npx tsc --noEmit
npx vitest run tests/bot-host.test.ts
node --check scripts/bot-host.mjs
node --check scripts/lib/agent-cline.mjs
node scripts/journey-guard.mjs BOT-12
# after upstream Cline supports headless resume:
# two-turn Cline CLI probe, then VM2 live follow-up
```

## Audit plan

1. Scope: BOT-12 only; no BOT-13 memory, BOT-14 skills, BOT-15 learning, BOT-16 soul, or router work.
2. One shared helper in `scripts/bot-host.mjs`; no per-bot patch.
3. Quote behavior is deterministic on all bot-host lanes. Cline resume stays blocked until the external CLI contract is executable, not painted green.
4. Research constraint preserved: use Cline's own resumed summary; never replay the full transcript.

## Blast radius

Allowed / Frozen are the YAML lists above. No product app, job lifecycle, bot registry, dependency, or protected Guard/standing changes.

## Stop and come back

- Cline 3.0.65 still rejects headless `--id` + prompt / JSON
- A run exposes only `conv_...` and no documented root `sessionId`
- Shared `sessions.json` cannot isolate OpenCode and Cline without a migration
- VM2 authentication/provider is unavailable
- Quoted text would require a second prompt-building path
- Two repairs fail, a frozen file changes, or a new class appears
