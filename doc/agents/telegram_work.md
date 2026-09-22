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
