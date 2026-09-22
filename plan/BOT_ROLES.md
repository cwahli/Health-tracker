# Bot roles and dev agents — V-28 execute contract

**Status:** OPEN. The agent who picks up V-28 executes this file. Do not redo V-19…V-26. Do not execute V-27 in the same turn (that is the phone path).

**Updated:** 2026-09-22

One person talks to a few bots. One script runs the coders. The coders do not talk, except through that script.

Practices this follows (Nous docs, HermesWatcher, HermesAgentTips, Loic Berthelot, Corey Ganim): soul is identity, a skill is the procedure, memory is a few true facts, a lasting role gets its own profile, a one-off coding job is a silent process. Do not put the operating manual in `SOUL.md`. Do not let the agent rewrite the soul or the skill. Do not add a shared memory server.

## 0. Measured facts (do not rediscover)

- Live site: `https://health-tracking.duckdns.org`. Push to `main` rebuilds it via the webhook. Dev checkout the script edits: `/home/ubuntu/src/Health-tracker`.
- Hermes home: `/home/ubuntu/.hermes`. Gateway cwd is `~/.hermes`, so the repo `AGENTS.md` is not injected into Telegram turns. Leave that cwd alone.
- Profiles do not inherit memory. Missing `memories/USER.md` or `memories/MEMORY.md` means that agent has a blank user and a blank notebook.
- Caps: `USER.md` 1,375 characters. `MEMORY.md` 2,200 characters. A save is on disk immediately and enters the prompt on the next session.
- Default `~/.hermes/memories/MEMORY.md` **still** over cap / stale (Render, “no Orchestrator bot”) as of 2026-09-22 — **BOT-7 open**. Replace, do not append.
- `qa_meal` memory exists and is partly stale (git-config requirement, exit 124). Orchestrator, `qa_biomarker`, and `qa_onboarding` memory directories are empty.
- Global `~/.hermes/SOUL.md` / QA souls / `system_prompt_suffix` placeholders — **BOT-7 open** (V-28 leftovers). Skill is the only procedure; delete placeholder commands from soul + suffix.
- `qa_biomarker` and `qa_onboarding` preload `qa-meal-journey` and `qa-telegram-journey`. They have no Telegram token. Do not wake them.
- `scripts/sync-hermes-skills.sh` symlinks every repo skill into profiles; it **excludes** `orchestrator-dispatcher` from `qa_*` and `meal_audit` (unlink on run). OpenCode master shares the same `scripts/skills/` via registry `sharedSkills` and runs meal-audit itself (model A) — it does not message @Meal_audit_bot.
- Dispatch script `scripts/run-coding-dispatch.sh` (commit `28486b1`) already detaches, calls `opencode run --auto -m opencode/muse-spark-1.3`, reverts only files that attempt changed, and on a meal/biomarker/onboarding push runs `qa-runner` and posts to that QA profile, with one extra OpenCode attempt if validation fails.
- 2026-09-22 run of `BUG-20260921-8449`: OpenCode returned `Insufficient account funds` on `muse-spark-1.3`. Cline thought 8 minutes and aborted with no diff. `grok -p` wrote two sentences and hit the 10-minute limit with no diff. Antigravity returned `User location is not supported`. Audit row: escalated_human, 1,249 seconds. The tree stayed clean. Do not re-file 8449 as a meal bug. The Food History tab bar was compared with the Home tab bar. The Home screen already shows Home, Trends, Food, Progress. The real on-screen defect is the Omega-3 text `7.700000000000001g`.
- Android OpenCode bot: `@Android_opencode_bot` (registry id `android`, env `ANDROID_OPENCODE_BOT_TOKEN`). Separate token from `@Opencode_135_bot` and `@Meal_audit_bot`. One `getUpdates` per token.
- Interactive doors, not QA coders: `@Opencode_135_bot` (`scripts/opencode-bot.mjs`, lock line `pid:opencode-chat`) and the human Grok session in tmux `dev`. The script waits up to 180 seconds if that lock is held, then exits 1. It must not delete a lock it does not own.
- Commit identity is not in git config on every checkout. The dispatch script already passes `GIT_AUTHOR_*` / `GIT_COMMITTER_*` (`cwahli` / `cwahli@users.noreply.github.com`) when `user.email` is unset. Do not run `git config`.

## 1. Who exists after this ID

### Bots (Hermes profiles)

| Profile | Talks as | Job | Does not |
|---|---|---|---|
| default | @Health_tracker_159bot | Answer health and app questions | Dispatch bugs or edit the repo |
| qa_meal | @Meal_journey_QA_bot | Describe the meal screen, start the script, stop | Read `src/`, pick a coder, wait |
| qa_biomarker | no bot until it has its own token | Dark | Preload the meal skill |
| qa_onboarding | no bot until it has its own token | Dark | Preload the meal skill |
| orchestrator | @Orchestrator_health_tracker_bot | Status log. The script posts here | Run OpenCode itself, or message @Opencode_135_bot |
| meal_audit | @Meal_audit_bot (LIVE 2026-09-22; Hermes gateway owns the token) | Audit meals, write artifacts/meal_audits/ | Read src/, dispatch coders, touch golden/meal/; **not** in opencode-bot registry |

### OpenCode ↔ meal_audit (model A)

OpenCode master **self-serves** meal-audit via shared skill `meal-audit-engine` (entry commands in that SKILL). Outbound-only as the meal_audit voice: `telegram-send.sh --profile=meal_audit`. Never put `meal_audit` in `bots/registry.json` (would dual-poll the Hermes token). Coders still do not talk except through `run-coding-dispatch.sh`.

### The worker

`scripts/run-coding-dispatch.sh` is the only starter of a coder for a QA bug. Callers do not pass `--foreground` except `scripts/qa-auto-loop.mjs`, which already does.

### Dev agents (silent, one at a time)

| Agent | Invocation | Stop condition already seen |
|---|---|---|
| OpenCode CLI | `opencode run --auto --dir "$REPO_DIR" -m opencode/<model> "<task>"` | `muse-spark-1.3`: insufficient funds. Next model, once: `opencode/deepseek-v4.1-flash` (the model in `bots/registry.json`). Do not retry Muse in the same bug. |
| Cline CLI | `cline --auto-approve true --thinking high "<task>"` | No new files means failure. Do not treat a long think as a fix. |
| Grok Build CLI | headless grok with the task as the prompt | No new files means failure. |
| Antigravity `agy` | do not call | `User location is not supported`. Set allowance status so `pick-tool` skips it. |

No parallel fan-out. One checkout, one coder. A failed attempt reverts only paths that appeared after `snapshot_workspace`.

### Interactive doors (not in the QA loop)

`@Opencode_135_bot` and the tmux `dev` Grok pane. Do not point the script at either. Do not `git clean` the src checkout.

## 2. One bug, after this ID

1. The person messages the matching QA bot.
2. That bot writes four lines (page, observed, expected, screenshot path), starts `run-coding-dispatch.sh` without `--foreground`, and stops.
3. The script takes `~/.hermes/dispatch_lock` or waits 180 seconds.
4. OpenCode with Muse, then once with `opencode/deepseek-v4.1-flash` if Muse says insufficient funds. Then Cline. Then Grok. Skip Antigravity.
5. Done for a coder means new porcelain lines since the snapshot and `npx tsc --noEmit` exit 0. Then commit those paths and `git push origin main`.
6. Sleep 45 seconds. Run `node scripts/qa-runner.mjs --journey=<category>`. Post the screenshot to that QA profile.
7. On failure, one more OpenCode attempt with the QA failure text, push, validate once more, stop.
8. If nobody wrote a diff, post one Orchestrator message naming the agent and the real error. Do not ask QA to validate a push that did not happen.

## 3. Files the executing agent writes

Do not edit `src/`. Do not restart `hermes-gateway`. Do not print or change tokens.

### 3a. Souls — replace each file entirely

`/home/ubuntu/.hermes/SOUL.md`

```markdown
# Health-tracker default bot

You are the health and app assistant for https://health-tracking.duckdns.org.
Reply in short sentences a phone can read. Match the user's language.
Answer questions about the person's logs and how to use the app.
If they ask to fix a bug, tell them to send it to the Meal, Biomarker, or Onboarding QA bot. Do not dispatch.
```

`/home/ubuntu/.hermes/profiles/qa_meal/SOUL.md`

```markdown
# Meal QA

You look at the meal journey and report what is on screen.
Write four lines: page, observed, expected, screenshot path.
Start scripts/run-coding-dispatch.sh once, in the background, with the user's actual words and --category=meal.
Then stop. Do not read source. Do not pick a coder. Do not wait for the result.
The Orchestrator posts the result back into this chat.
```

`/home/ubuntu/.hermes/profiles/orchestrator/SOUL.md`

```markdown
# Orchestrator

You are the status log for coding runs.
Do not edit the repo. Do not start OpenCode, Cline, Grok, or Antigravity yourself.
Do not message the OpenCode Telegram bot.
When asked to fix a bug, start scripts/run-coding-dispatch.sh once and stop when it prints "Background pid".
The script posts progress here and sends validation to the QA bot.
```

`qa_biomarker` and `qa_onboarding` souls: same shape as meal, with that journey name, plus “This bot has no Telegram token yet. Do not send messages.”

### 3b. User and memory

Write this `USER.md` to the default memories dir and to `profiles/{qa_meal,orchestrator,qa_biomarker,qa_onboarding}/memories/USER.md`:

```markdown
Cwah Li. Short replies. Screenshots belong in the chat, not as a file path.
```

Replace default and `qa_meal` `MEMORY.md` with:

```markdown
Live site is https://health-tracking.duckdns.org. Dev checkout is /home/ubuntu/src/Health-tracker.
OpenCode model opencode/muse-spark-1.3 returned insufficient funds on 2026-09-22. Antigravity is blocked in this region.
A QA bug is fixed only by scripts/run-coding-dispatch.sh. The OpenCode Telegram bot is a separate interactive door.
```

Leave orchestrator, biomarker, and onboarding `MEMORY.md` absent.

### 3c. Config

Delete `system_prompt_suffix` from the three QA `config.yaml` files.

Preload: `qa_meal` only `qa-meal-journey`. `orchestrator` only `orchestrator-dispatcher`. Biomarker and onboarding preload nothing until they have their own token.

### 3d. Skills

`scripts/sync-hermes-skills.sh` must not link `orchestrator-dispatcher` into `profiles/qa_meal`, `qa_biomarker`, or `qa_onboarding`. Unlink any existing symlink. Run the script. Do not restart the gateway.

Confirm `qa-meal-journey` dispatches the user's actual report, category meal, no `--foreground`, and does not use the navy-theme sentence as the task.

### 3e. Dispatch

Keep the `28486b1` behavior (detach, own the lock, snapshot revert, QA hand-back).

Add: on `Insufficient account funds`, one OpenCode retry with `-m opencode/deepseek-v4.1-flash`, then Cline, then Grok. Skip `agy` when `~/.hermes/tool_allowances.json` says `unavailable`. Set that status in `scripts/tool-allowance.mjs` defaults because Antigravity is location-blocked. A coder with no new files is a failed attempt; the Telegram line must include the real error (funds, abort, or location), not only “0 code changes.”

### 3f. Orchestrator Health Probing, Investigation Mode & Dual-Sync Memory

To prevent 36-minute stall ladders (where broken tools loop or timeout before touching code):

1. **Autonomous Model Health Analysis (Pre-Flight Canary)**:
   - `scripts/tool-allowance.mjs` tracks granular model status per tool.
   - When a model returns `Insufficient account funds`, mark that model permanently `depleted` in `~/.hermes/tool_allowances.json` (do not clear it on the 15-minute cooldown timer).
   - Fast fail-over: switch `opencode` active model to `opencode/deepseek-v4.1-flash` without burning 8 minutes.

2. **Investigation Mode on Stagnation / Abort**:
   - If a coder makes 0 code changes after 4 minutes or outputs an explicit abort:
     - Scan the log signature for root cause:
       - **Credit/Quota Failure**: mark depleted, switch model in registry, and retry once.
       - **Invariant / Architectural Conflict**: if the coder aborts because a requested change breaks a protected contract in `AGENTS.md` (e.g. renaming `#nav-tab-health` breaks Playwright tests), scrub the forbidden request from the task prompt and retry only the legitimate defects (e.g. float formatting).
       - **Prompt Bloat / Over-Analysis**: if a model times out reading a 6-part task, split into atomic single-concern micro-tasks and dispatch sequentially.
       - **Geo-block / Environment Failure**: immediately mark tool `unavailable` and escalate to next healthy tool in pool.

3. **Dual-Sync Storage (JSON + MEMORY.md)**:
   - **Machine State**: `~/.hermes/tool_allowances.json` remains the deterministic, typed source of truth parsed by `tool-allowance.mjs` and `run-coding-dispatch.sh`.
   - **Cognitive Context**: When a tool status changes (e.g. model depleted, region blocked), `tool-allowance.mjs` syncs a concise 2-line note into `~/.hermes/memories/MEMORY.md` so the LLM Orchestrator system prompt is aware of environment realities without running shell commands.


## 4. Done when

- `bash -n scripts/run-coding-dispatch.sh` exits 0.
- `--print-plan --task=float --bug-id=BUG-PLAN --category=meal` prints `opencode run` and `qa_profile=qa_meal` and starts no process.
- The five souls contain no shell pipeline and no “no Orchestrator bot.”
- The three previously empty profiles have the short `USER.md`. Default `MEMORY.md` is under 2,200 characters and names the live URL.
- `profiles/qa_meal/skills/orchestrator-dispatcher` is not a symlink. Meal preloads only `qa-meal-journey`.
- No `src/` diff. No token printed. Gateway not restarted.
- This plan file is on `main` as `plan/BOT_ROLES.md`, with the ROADMAP V-28 row and the handover bullet.

A live bug run is not required to close V-28.

## 5. Do not

- Do not edit `src/`, restart Hermes, or change any `.env` token.
- Do not re-dispatch `BUG-20260921-8449`.
- Do not run `@Opencode_135_bot` as the QA coder.
- Do not `git clean` or `git reset --hard`.
- Do not add Mem0, Honcho, or OpenViking.
- Do not execute V-27 in the V-28 turn.
- Do not let an agent rewrite `SOUL.md` or a skill as part of learning.

## 6. Atomic Bug Dispatch & Coder Efficiency Improvements (V-29)

### 6a. QA Bots: The Single Verifiable Defect Rule
- **Atomic Dispatch**: When testing a journey, if multiple visual discrepancies are detected, the QA bot must NEVER bundle them into a single monolithic bug ticket. Bundling 6 issues into one task (as occurred in `BUG-20260921-8449`) causes coder stalls, timeouts, and poisons legitimate fixes with invalid requests.
- **Ticket Format**: Exactly ONE issue per ticket:
  1. **Component/Area**: Single screen element (e.g. `Weekly Target Card`).
  2. **Observed**: Exactly one defect (e.g. `Omega-3 shows 7.700000000000001g`).
  3. **Expected**: Exactly one desired state (e.g. `Omega-3 shows 7.7g`).
  4. **Verification Criteria**: What single check proves it fixed.
- **Pre-flight Invariant Protection**: QA bots must never file tickets requesting deletion of active features (`Health status`, `Clinical Actions`, `Daily Benefits`) or renaming protected test IDs (`#nav-tab-health`).

### 6b. Orchestrator: Task Decomposition & Early Circuit Breakers
- **Prompt Decomposition Engine**: If a bug ticket with multiple enumerated issues arrives, the Orchestrator splits it into atomic sub-tasks (`BUG-XXXX-1`, `BUG-XXXX-2`) and runs them sequentially in priority order.
- **Early Stagnation Circuit Breaker**: If a coder produces 0 git porcelain changes within 3 minutes, check the log tail. If the coder is stuck overthinking or aborted, cancel early rather than burning 8–18 minutes.
- **Target File Hints**: Automatically attach known component paths based on the defect category (e.g. nutrition card $\to$ `src/components/`, styling $\to$ `src/index.css`) so coders don't crawl 90+ files.

### 6c. Coders: Scoped Prompts & Dynamic Thinking
- **OpenCode**: Primary model `opencode/deepseek-v4.1-flash`; fallback to DeepSeek Chat. Pass `--dir "$REPO_DIR"` with scoped component targets.
- **Cline**: Use `--thinking=low` for atomic UI/text fixes (fast 30s execution); reserve `--thinking=high` only for multi-file architectural refactors. Append invariant guard: *"Never modify elements protected by Playwright tests in prototype/ or AGENTS.md."*
- **Grok**: Reduce execution timeout to 6 minutes max. Do not attach screenshot images for pure text/formatting tickets to prevent visual over-analysis loops.

### 6d. Action-Aware Heartbeats & Structured Failure Diagnostics
- **Contextual Heartbeat (What the agent is doing)**:
  - The heartbeat loop in `scripts/run-coding-dispatch.sh` must not emit blind elapsed timers (`Agent 'Grok' still working... (12m elapsed)`).
  - Every 2 minutes, the heartbeat parses the latest non-empty activity from the coder's log (active file read, test execution, or current thought line) and reports concrete progress to Telegram:
    `⏳ [Orchestrator] Grok is investigating <target file/action> (4m elapsed)`
- **Structured Outcome & Failure Summaries**:
  - When an agent finishes with 0 code changes or errors, the Orchestrator must never dump raw 6-line unformatted log chunks or a bare "0 code changes".
  - It must parse the log and emit a structured Telegram summary:
    - **What Was Investigated**: (e.g. `Inspected home dashboard layout & Playwright test locators`).
    - **Code Modified**: `0 files` (or changed file paths).
    - **Root Cause Diagnosis**: Concrete reason why it halted:
      - `Credit Depletion`: "Account funds exhausted ($0 balance on muse-spark-1.3)."
      - `Test / Invariant Conflict`: "Aborted: changing #nav-tab-health breaks existing Playwright tests in prototype/."
      - `Stall / Timeout`: "Halted: overthinking loop after 6m without generating code changes."
      - `Typecheck Failure`: "npx tsc failed on TS2322 in src/..."
    - **Action Taken**: Next step executed by the Orchestrator (e.g. `Failing over to Cline with scoped atomic prompt`).


