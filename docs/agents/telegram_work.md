# Telegram Agent Observability & Multi-Bot Workflow Standard

This document defines the communication, pending-state, and active-progress observability standards for autonomous agents running on Telegram within Health-tracker, as well as the complete end-to-end multi-bot workflow.

---

## 1. The Three Loading Dots ("...") Standard

Users and operators looking at Telegram must never wonder whether a bot has crashed, completed, or is actively working. Whenever an agent is running a task, it must visibly indicate progress.

### A. Telegram Native Typing Action (`sendChatAction: typing`)
- Telegram displays an animated three-dot indicator (`...`) in the chat header with the status text: `[Bot] is typing...`.
- A single call to `sendChatAction` with `action="typing"` remains visible in Telegram for approximately 5 seconds (or until the bot posts a message).
- **Standard Rule:** Any background process or agent execution loop lasting longer than 3 seconds MUST maintain a continuous typing pulse every 4 seconds.
- **Implementation:**
  ```bash
  # In scripts/telegram-send.sh:
  bash scripts/telegram-send.sh --profile=<profile> --action="typing"
  ```
  In [`scripts/run-coding-dispatch.sh`](../../scripts/run-coding-dispatch.sh), the `start_heartbeat` function spawns a dedicated subshell that pulses `sendChatAction: typing` every 4 seconds throughout the coder's execution, ensuring the three animated loading dots never disappear from Telegram while an agent is thinking or editing code.

### B. Message Ellipsis Standard
- In-flight text messages and progress lines must always conclude with an ellipsis `...` to signify active continuation:
  ```text
  ⏳ [Orchestrator] Agent 'OpenCode' working on BUG-20260922-01... (2m elapsed)
  • Status: analyzing WeeklyNutritionCard.tsx...
  ```
- Terminal outcome messages (completion or failure) do NOT end with an ellipsis.

---

## 2. Explicit Pending & Inter-Agent Waiting State Standard

Agents must NEVER remain silently idle or post ambiguous status lines without specifying **what** or **who** they are waiting for.

### The "Waiting For" Rule
Whenever an agent yields execution or awaits a response from another agent, background build, or testing subsystem, it must explicitly name the pending entity in the chat.

| Context | Required Telegram Announcement |
|---|---|
| **Orchestrator $\to$ Coding Agent** | `⏳ [Orchestrator] Dispatching to <Tool> for <BUG-ID>...`<br>`⏳ Status: Waiting for response from Agent <Tool>...` |
| **Orchestrator $\to$ Deploy Webhook** | `✅ [Orchestrator] <BUG-ID> is on main via <Tool>.`<br>`⏳ Status: Waiting ~45s for production rebuild & deploy... then <qa_prof> will validate.` *(Pulsing typing action during the 45s wait)* |
| **Orchestrator $\to$ QA Bot** | `🔎 [Orchestrator] Rebuild complete. Waiting for QA validation result from @<qa_prof>...` |
| **QA Bot $\to$ Orchestrator** | `📋 Bug Logged & Handed to Orchestrator`<br>`⏳ Status: Waiting for @Orchestrator to fix, deploy, and report validation result back...` |
| **QA Bot $\to$ Headless Runner** | `⏳ [QA Meal] Running end-to-end journey test and capturing live UI state...` |

---

## 3. End-to-End Autonomous Workflow

The diagram below illustrates the full lifecycle from visual defect detection to automated live deployment and QA verification:

```
[User / Cron / QA]
       │
       ▼
1. @Meal_journey_QA
   • Runs headless Chromium: node scripts/qa-runner.mjs --journey=meal
   • Captures live screenshot -> Sends to chat
   • Enforces Single Verifiable Defect Rule (1 defect per ticket)
   • Dispatches to Orchestrator via run-coding-dispatch.sh
   • Posts: "⏳ Status: Waiting for @Orchestrator..." -> STOPS in 1 turn
       │
       ▼
2. @Orchestrator
   • Evaluates tool allowances: node scripts/tool-allowance.mjs status & probe
   • Fallback Hierarchy: OpenCode (deepseek) -> Cline CLI -> Grok Build -> Agy (skipped on VPS)
   • Dynamic Thinking: --thinking=low for atomic UI/text fixes (<60s)
   • Starts Action-Aware Heartbeat + 4s Typing Pulse ("...")
   • Posts: "⏳ Status: Waiting for response from Agent <Tool>..."
       │
       ▼
3. Coding Agent (OpenCode / Cline / Grok)
   • Modifies code within strict invariant guards (never delete active sections or rename test IDs)
   • Heartbeat parses log every 2m: "• Status: <active activity>..."
   • Verifies with npx tsc --noEmit
   • If failed: Orchestrator emits structured failure diagnostics and escalates to next tool
       │
       ▼
4. Git Commit & Webhook Deploy
   • Orchestrator commits and pushes to origin/main
   • Posts: "⏳ Status: Waiting ~45s for production rebuild & deploy..." (Typing dots active)
   • Live VPS Caddy webhook auto-rebuilds and restarts health-tracker.service
       │
       ▼
5. Automated QA Re-Verification
   • Orchestrator posts: "🔎 Waiting for QA validation result from @Meal_journey_QA..."
   • Invokes node scripts/qa-runner.mjs --journey=meal
   • QA verifies clean UI, captures before/after screenshot, posts to chat
   • Orchestrator marks bug resolved
```

---

## 4. Key Rules & Invariant Safeguards

1. **The Single Verifiable Defect Rule (V-29):**
   - QA bots must never bundle multiple discrepancies into one ticket. Exactly ONE issue per ticket.
   - Format: `Component`, `Observed`, `Expected`, `Verification Criteria`.
2. **Pre-flight Invariant Protection:**
   - QA bots and coding agents must NEVER delete active dashboard sections (`Health status`, `Clinical Actions`, `Daily Benefits`) or rename protected test IDs (`#nav-tab-health`, `#nav-tab-food`, `#nav-tab-home`).
3. **Early Stagnation Circuit Breaker:**
   - If a coder produces 0 code changes after 3 minutes or logs an explicit invariant abort, the dispatcher cancels immediately and falls back rather than stalling for 8–18 minutes.
4. **Zero Silent Stalls:**
   - Continuous typing dots (`sendChatAction: typing` every 4s) during coder execution, build wait, and test runs.
   - Action-aware heartbeats every 2m reporting the coder's actual parsed log line.
5. **Structured Failure Diagnostics:**
   - When a coder fails with 0 code changes, the Orchestrator identifies the exact root cause (`Credit Depletion`, `Test/Invariant Conflict`, `Timeout / Overthinking Loop`, `Geo-blocked Location`) and announces the corrective failover action.

---

## 5. Technical Scripts & Components

- [`scripts/telegram-send.sh`](../../scripts/telegram-send.sh):
  - Sends text, markdown, photos, captions, and chat actions (`--action="typing"`).
  - Profile-aware: resolves dedicated bot tokens for `qa_meal`, `orchestrator`, or global default.
- [`scripts/run-coding-dispatch.sh`](../../scripts/run-coding-dispatch.sh):
  - Central detached execution engine. Manages heartbeats, typing loops, invariant guards, target file hints, thinking levels, tool fallbacks, git commits, deploy wait, and QA handback.
- [`scripts/tool-allowance.mjs`](../../scripts/tool-allowance.mjs):
  - Machine state tracker (`tool_allowances.json`). Tracks `available`, `depleted`, `unavailable`, and `rate_limited` cooldowns.
  - Provides pre-flight canary health probing (`node scripts/tool-allowance.mjs probe`).
  - Dual-syncs concise tool status notes into `~/.hermes/memories/MEMORY.md`.
- [`scripts/qa-runner.mjs`](../../scripts/qa-runner.mjs):
  - Headless Playwright runner executing authenticated journey tests against the live production URL. Captures before and after visual evidence (`qa-evidence/*.png`).

---

## 6. Incident Analysis (`BUG-20260921-8449`) & The Granular Orchestrator Architecture

### A. What Went Wrong in the `BUG-20260921-8449` Incident
During the dispatch run of `BUG-20260921-8449`, a severe breakdown occurred across agent communication, tool management, and user interaction:
1. **Split-Brain Visibility & Gaslighting:**
   - `run-coding-dispatch.sh` was executing detached in the background posting as `[Orchestrator]`.
   - When the user asked the interactive Hermes bot "What is cline working on?", Hermes had zero inter-process visibility into the lockfile or log files.
   - Hermes ran shell commands in a restricted local sandbox, found no trace of `cline` or project files, and hallucinated that the whole project didn't exist.
   - When the background script posted a heartbeat ("Agent 'Cline' still working..."), Hermes actively denied having sent the message and argued with the user ("I never said 'agent cline is still working'...").
2. **Monolithic Script Usurping Orchestrator Control:**
   - The bash script was an autonomous state machine that dictated a hardcoded cascade: `OpenCode -> Cline -> Grok -> Agy`.
   - The LLM Orchestrator was reduced to a passive onlooker. It could not pick specific models, inspect state, or intervene when things went wrong.
3. **Runaway Cascade Fighting User `/stop`:**
   - When OpenCode failed with insufficient funds and Cline's API stream died, the bash trap proceeded to spawn Grok, then attempted Agy.
   - When the user requested to stop work, killing a single process merely caused the bash script to escalate to the next tier, fighting the user's intent.
4. **Nudging Dead Models:**
   - When OpenCode failed with "Insufficient account funds ($0 balance)", the script blindly nudged the same depleted model (`muse-spark-1.3`), failing twice and wasting minutes before escalating.

---

### B. The Granular Orchestrator-Empowered Architecture
To permanently eliminate these failure modes, the monolithic bash cascade was redesigned into an **interactive toolset operated by the Orchestrator LLM**:

1. **Tool Mode, Not State-Machine Cascade:**
   - By default, `./scripts/run-coding-dispatch.sh` runs **strictly one tool** (`--tool=opencode|cline|grok|agy`).
   - It does NOT automatically cascade to other tools unless explicitly invoked with `--cascade`.
   - When a tool finishes or fails, control immediately returns to the Orchestrator LLM. The Orchestrator reports the exact root cause to the user and intelligently decides the next action.

2. **Subcommands for Complete Visibility & Control:**
   - **`status` (`./scripts/run-coding-dispatch.sh status`):**
     - Reads `${HERMES_DIR}/dispatch_lock` and `${HERMES_DIR}/dispatch_active.json`.
     - Checks if the process PID is alive.
     - Strips ANSI escape sequences and extracts the current activity line from the active log.
     - Returns grounded state: active agent, model, thinking mode, elapsed time, current action, and recent log tail.
     - Enables the Orchestrator to answer "What is X doing?" with 100% precision.
   - **`stop` (`./scripts/run-coding-dispatch.sh stop`):**
     - Immediately sends SIGTERM/SIGKILL to the active process group and child processes (`opencode`, `cline`, `grok`).
     - Releases concurrency lock files.
     - Automatically runs `git checkout -- .` and `git clean -fd` to revert partial edits to clean `main`.
     - Halts all execution without spawning fallback agents.
   - **`list-models` (`./scripts/run-coding-dispatch.sh list-models`):**
     - Lists all supported tools, models, current status, quotas, and supported thinking modes:
       - OpenCode: `deepseek-v4.1-flash` (Active, free, fast), `muse-spark-1.3` (depleted).
       - Cline CLI: `deepseek` (API integration, thinking: `high|low|none`).
       - Grok Build: `grok-build` (Free quota, 6m limit).
       - Antigravity: `gemini-flash` (Geo-blocked on VPS).

3. **Clean Output & Error Diagnostics:**
   - All log output forwarded to Telegram is sanitized of ANSI escape sequences (no raw ` [0m [91m` terminal debris).
   - Structured diagnostic summaries explain what was attempted, what files were inspected, and why the run failed (funds depleted, stream disconnected, compiler error).

