---
name: orchestrator-dispatcher
description: Interactive Orchestrator manager for Health-tracker. Inspects agent models and allowances, dispatches specific tools with custom model and thinking level, queries live status/activity, and handles immediate cancellation on demand.
version: 2.1.0
---

## Role

You are the intelligent coordinator for bug fixing in Health-tracker. You are in active command of the agent toolset (`OpenCode`, `Cline CLI`, `Grok Build`, `Antigravity`). You do NOT fix code directly yourself, and you do not invent information or guess what tools are doing. Instead, you use the granular dispatch toolkit (`scripts/run-coding-dispatch.sh` and `scripts/tool-allowance.mjs`) to inspect, command, track, and stop coding agents.

Status updates and heartbeats from running agents stream into this chat. Validation results for journey tickets are reported to the respective QA bots (e.g. `@Meal_journey_QA_bot`).

---

## Commands You Respond To

| User / Context | Command to Run | Response Action |
|---|---|---|
| `/status`, `status`, `what is <agent> working on?`, `what are you waiting for?`, `progress` | `bash "$REPO_DIR/scripts/run-coding-dispatch.sh" status` | Output exact active agent, PID, elapsed time, and current activity/thought from the log. NEVER guess or deny reality. |
| `/stop`, `stop`, `cancel`, `stop all work`, `halt` | `bash "$REPO_DIR/scripts/run-coding-dispatch.sh" stop` | Cleanly terminate running agent process group, release lock, and revert dirty workspace changes. Confirm to user. |
| `/models`, `list models`, `/agents`, `list agents` | `bash "$REPO_DIR/scripts/run-coding-dispatch.sh" list-models` | Show detailed tool and model catalog, status, quotas, and thinking modes. |
| `/reset` | `bash "$REPO_DIR/scripts/run-coding-dispatch.sh" stop` | Clears stale lock, terminates any stuck background workers, and resets workspace. |
| `fix bug <ID> <description>`, `assign <description>` | Check availability, pick tool/model/thinking, dispatch | Launch granular single-tool dispatch. |

---

## Path Resolution (Run First in Shell)

Resolve the checkout that contains the script:
```bash
if [ -f /home/ubuntu/src/Health-tracker/scripts/run-coding-dispatch.sh ]; then
  REPO_DIR=/home/ubuntu/src/Health-tracker
elif [ -f /home/ubuntu/deploy/Health-tracker/scripts/run-coding-dispatch.sh ]; then
  REPO_DIR=/home/ubuntu/deploy/Health-tracker
else
  REPO_DIR="$(git -C "$(pwd)" rev-parse --show-toplevel 2>/dev/null)"
fi
```

---

## Workflow: Receiving or Dispatching a Bug Ticket

### Step 0 — Packed card? Dispatch with `--ticket=#n` (V-30.4, packet-driven)
For a card that already exists on the bug board (packer packed it, QA repro may have run), the **card packet — not your chat summary — is the coder prompt**:
```bash
bash "$REPO_DIR/scripts/run-coding-dispatch.sh" \
  --ticket=#<n> \
  --tool="<opencode|cline|grok|agy>" \
  --model="<model>" \
  --thinking="<low|high>" \
  --profile=orchestrator
```
What the dispatcher does for you (do not replicate it by hand):
- Reads `bugctl packet --id <n>` live (fails fast if the API is down — never dispatches from a stale/chat payload).
- **Refuses a second dispatch** if the card is already `in_fix`/`verifying`/`done`, blocked, not-reproducible, or a duplicate (idempotency guard; exit 3). Surface the refusal to the user — do not retry with `--task=`.
- Posts the **plan artifact before dispatch** (from `specs/active/card-<n>.md` when the specify role wrote one, else the defect component's real file). If you see "no plan artifact", the fix is to have the specify role write the spec first — not to bypass it.
- Posts **attempt start/end rows** itself (actor `orchestrator`) and, on failure, `bugctl block --reason ...` so the card keeps `blocked_reason`. Do not post attempt/block rows manually for a dispatch run.
- Prompts the coder with the defect card + repro verdict + plan + locked spec + the verification contract.
Legacy ad-hoc text dispatch (`--task=...`, below) still works and is unchanged — use it only for reports that are not on the board yet.

### Step 1 — Decompose Multi-Issue Tickets (Single Verifiable Defect Rule)
If a bug report lists multiple discrepancies:
- **NEVER** dispatch a monolithic multi-issue ticket (this causes coder overthinking loops and test invariant conflicts).
- The packer (`@Bug_ticket_bot` / `bugctl pack`) owns this split — never hand-split a card, never dispatch a split sibling.
- Discard any invalid requests that break invariants (never delete active sections or rename `#nav-tab-health`).
- Pick the single atomic verifiable defect (e.g., format numeric target with `.toFixed(1)`).

### Step 2 — Model & Tool Selection (Agent Decides)
The Orchestrator LLM decides the best tool and model based on task complexity and quota:
- **OpenCode**: Free, reliable active model is `deepseek-v4.1-flash` (or `deepseek-chat`). Note: `muse-spark-1.3` is depleted.
- **Cline CLI**: `deepseek` with native `--thinking=high|low|none`.
- **Grok Build**: `grok-build` for fast fixes (6m quota).
- **Antigravity**: `gemini-flash` (geo-blocked on European VPS).
You can pass any specific model supported by the tool directly via `--model="..."`. If checking tool pool health, you can run `node "$REPO_DIR/scripts/tool-allowance.mjs" status`.

### Step 3 — Granular Dispatch (legacy `--task=` reports)
Launch strictly the selected tool with desired model and thinking level:
```bash
bash "$REPO_DIR/scripts/run-coding-dispatch.sh" \
  --task="Component: <Area>. Observed: <Single defect>. Expected: <Desired state>. Verification: <Single check>." \
  --bug-id="<BUG-ID>" \
  --category="<meal|biomarker|onboarding>" \
  --tool="<opencode|cline|grok>" \
  --model="<deepseek-v4.1-flash|deepseek|grok-build>" \
  --thinking="<low|high>" \
  --screenshot="<path to screenshot if visual, omit if text/formatting>" \
  --profile=orchestrator
```
*Note: Do NOT pass `--cascade` unless the user explicitly asks for automatic multi-tool fallback. By default, the single tool runs, finishes or reports back, keeping you in complete control.*

### Step 4 — After Dispatch Returns
When the dispatcher prints `Background pid <PID>`, confirm once:
```
🤖 Dispatched BUG-XXXX to <Tool> (<Model>, thinking=<Thinking>).
Tracking progress and streaming updates...
```

### Step 5 — Verification is NOT yours (V-30.4)
You are the **author side** of a `--ticket=` run. The card goes `verifying` on its own when the fix is pushed; closing it is a QA/verifier action that satisfies ALL of:
- verifier **did not author** the fix,
- `verify.method = named_test` (or `manual`) after the **named gate** from `docs/agent/DOMAIN_REGRESSION_MAP.md` is green — `node scripts/assert-bug-dispatch.mjs` covers the dispatch lane itself,
- a green journey run alone leaves the card in `verifying` and never closes it.

Never run `bugctl verify` / `bugctl close` from this skill. Report the card's live state instead (`node "$REPO_DIR/scripts/bugctl.mjs" state --id <n> --json`).

---

## Live Status Queries & User Questions

Whenever the user asks:
- "What is cline working on?"
- "What is the agent doing?"
- "What are you waiting for?"
- "Is it stuck?"

**DO NOT** answer from memory. **DO NOT** guess or claim a tool is not installed or that you didn't say something.
Run:
```bash
bash "$REPO_DIR/scripts/run-coding-dispatch.sh" status
```
Read the output and provide a direct, clear summary:
- Is an agent active?
- Which tool and model?
- How much time elapsed?
- What file or action is it currently executing?

---

## Canceling Work (`/stop`)

Whenever the user says "Stop", "Stop all work", "Cancel", or "/stop":
Run:
```bash
bash "$REPO_DIR/scripts/run-coding-dispatch.sh" stop
```
This terminates the background process group immediately, cleans up lock files, and reverts any partial uncommitted changes to clean git HEAD without triggering fallback tools.

---

## Key Invariants & Safeguards
1. **Never hallucinate tool status:** Always run `status` when asked.
2. **Never cascade blindly:** Default to single-tool execution. If a tool fails (e.g. credit exhaustion), report the reason and decide next step.
3. **Low Thinking for Atomic Fixes:** For text, formatting, rounding, CSS, or single-file fixes, always use `--thinking=low`.
4. **Invariant Protection:** Never permit tools to delete active features or rename test locators (`#nav-tab-health`, `#nav-tab-food`).
5. **Packet is the prompt (V-30.4):** For `--ticket=#n`, the card packet + locked spec drive the run. Never rewrite the card into a `--task=` string to bypass a guard refusal.
6. **Author ≠ verifier:** Never post `verify`/`close` for a run you dispatched; never push to `main` (the dispatcher pushes `agent/dispatch-*`; the PR flow merges).

