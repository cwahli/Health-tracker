# Location-Agnostic Bot Architecture, Universal Role System & Web Dev Pipeline

**Status:** REVISED & UNIFIED (2026-09-25)  
**Applies to:** ALL Agents across the fleet — Hermes Profiles (`~/.hermes/profiles/`), Telegram Bot Fleet (`bot-host.mjs`), Antigravity CLI (`agy`), OpenCode, Cline, Grok, Mobile Termux & Cloud VPS  
**Index:** [plan/ROADMAP.md](./ROADMAP.md) **Track P / R-14.1** (Location-Agnostic Role & Project Council)  
**Parent Invariants:** [plan/BUG_TICKET_PIPELINE.md](./BUG_TICKET_PIPELINE.md) (V-30.1–V-30.5) & [plan/BOT_ROLES.md](./BOT_ROLES.md)  
**Test Suite:** `scripts/assert-external-projects.test.mjs` (48/48 passing)

---

## 1. Executive Summary: Agnostic Workers & The Two-Tier Architecture

In legacy agent setups, bots were locked into physical machines, static Telegram tokens, and rigid prompts:
- Mobile Termux was restricted to lightweight phone helpers.
- The Cloud VPS was locked to website deploys and git commits.
- Agents had fixed monolithic prompts, leading to prompt dilution and lack of flexibility.

### The Unified Standard
1. **Agnostic Compute Workers:** Any node (Cloud VPS, Mobile Termux, Colab GPU tunnels, or local machines) is a stateless execution host.
2. **Instant Worker Bootstrapping:** Fresh nodes or bare VMs can be provisioned into instant agent workers with standard CLI tooling:
   ```bash
   curl -fsSL https://antigravity.google/cli/install.sh | bash
   ```
   Runtimes are interchangeable across **Antigravity CLI (`agy`), OpenCode (`opencode`), Cline (`cline`), and Grok**.
3. **Applies Universally Across All Fleet Agents:** This applies equally to standalone CLI coders and **all Hermes profiles** (`default`, `qa_meal`, `orchestrator`, `bug_ticket`, `vm`).
4. **The Golden Separation:**
   - **For Everyday Web Development (Health-Tracker Core):** Keep the battle-tested, high-velocity **4-Stage Pipeline** (Ticket Creator $\to$ Orchestrator $\to$ Full-Stack Dev $\to$ QA Verifier).
   - **For Domain Specialization (Micro-Focus):** Dev can adopt on-demand **Role Lenses** (`/role ui`, `/role ops`, `/role backend`).
   - **For Complex Non-Code Deliberation (External Projects):** Switch via `/project 2` to the **Multi-Agent Debate Council** (PIP Defense: Accuracy $\to$ Case $\to$ Sim $\to$ Legal $\to$ Arb $\to$ Builder).

---

## 2. Core Web Development Pipeline (The 4-Stage Assembly Line)

Web development touches full vertical slices (Database $\leftrightarrow$ API $\leftrightarrow$ UI). Splitting a coder into 5 micro-subagents creates contract drift and the "telephone game." 

Therefore, web development adheres to the **Evaluator-Optimizer Assembly Line** locked in `plan/BUG_TICKET_PIPELINE.md`:

```text
┌────────────────────────────────────────────────────────┐
│ 1. TICKET CREATOR & INGEST (@Bug_ticket_bot)           │
│    • Ingestion: Captures user bug, logs, screenshot   │
│    • Repro Gate: Verifies reproduction (repro --check) │
│    • Artifact: Packs immutable Bug Card packet        │
└───────────────────────────┬────────────────────────────┘
                            │ (Dispatches Card #n)
                            ▼
┌────────────────────────────────────────────────────────┐
│ 2. PROCESS ORCHESTRATOR (run-coding-dispatch.sh)      │
│    • Lock Manager: Enforces "one checkout, one coder"  │
│    • Quota Router: Selects lane & handles failover    │
│    • Status Logger: Posts events to @Orchestrator_bot  │
└───────────────────────────┬────────────────────────────┘
                            │ (Silent Background Execution)
                            ▼
┌────────────────────────────────────────────────────────┐
│ 3. DEV WORKER (Generalist Full-Stack Builder)          │
│    • Single Coder: OpenCode / Cline / agy on branch    │
│    • Vertical Slice: DB schemas ↔ server.cjs ↔ UI      │
│    • On-Demand Lens: /role ui | /role ops if scoped    │
└───────────────────────────┬────────────────────────────┘
                            │ (Proposed diff & build pass)
                            ▼
┌────────────────────────────────────────────────────────┐
│ 4. QA AUDITOR & VERIFIER (qa-runner.mjs)               │
│    • Independent Verifier: Non-author verification    │
│    • Journey Proof: Runs e2e suite & repro checks      │
│    • Merge Gate: Only creates PR/merges if 100% green  │
└────────────────────────────────────────────────────────┘
```

---

## 3. Universal Role Catalogs Across Projects

Roles operate as **pluggable instruction bundles** loaded on demand via `/role <name>` or checked via `/role check <name>`.

### A. Project 1: Health-Tracker Core Engineering Roles (Dev Lenses)

| Role ID | Trigger Alias | Role Name | Assigned Instruction Focus | Tool Gates |
|---|---|---|---|---|
| `lead_architect` | `arch`, `lead` | Lead System Architect | Architecture invariants, schema boundaries, PR review, data plane separation | Read, grep, git status, review |
| `frontend_ui` | `ui`, `frontend` | Frontend UI/UX Specialist | React 19 UI components, Lucide icons, responsive layout, CSS, mobile viewport | Read, write code, build, lint |
| `data_backend` | `backend`, `data` | Data & Cloud Backend Engineer | Cloudflare D1 SQL, Supabase sync, R2 photo buckets, Node server routes (`dist/server.cjs`) | Read, write code, db query, build |
| `qa_audit` | `qa`, `test` | QA & Forensic Regression Auditor | Automated smoke tests, journey test suites (`scripts/qa-runner.mjs`), regression verification | Read, run tests, qa runner |
| `reliability_ops` | `ops`, `infra` | Reliability & Infrastructure Ops | Caddy reverse proxy, systemd services (`health-tracker.service`), fail2ban, watchdog scripts | Read, systemctl, caddy reload, netstat |

### B. Project 2: PIP Defense & Rating Review Council Roles (Adversarial Debate)

| Role ID | Trigger Alias | Role Name | Assigned Instruction Focus | Target Deliverable |
|---|---|---|---|---|
| `accuracy_review` | `accuracy`, `audit` | Accuracy Review (Forensic Auditor) | Audits claims against timestamps, git/Slack logs, flags missing receipts | `01_accuracy_audit.md` |
| `case_review` | `case`, `defense` | Case Review (Defense Strategist) | Frames objective technical delivery, contextualizes external blockers/PTO | `02_defense_rebuttal.md` |
| `manager_simulation` | `sim`, `manager` | Manager Representative (Red Team) | Adversarial vulnerability scoring, simulates manager counter-attacks | `03_manager_critique.md` |
| `legal_policy` | `legal`, `policy` | Legal & Policy (Procedural Compliance) | Procedural fairness audit, SMART goals violations, severance & settlement leverage | `04_legal_leverage.md` |
| `arbitrator` | `arb`, `judge` | Arbitrator (Strategic Judge) | Weighs options, resolves debates, issues binding tactical directive | `05_arbitration_directive.md` |
| `final_case_builder` | `builder`, `final` | Final Case Builder (Executive Publisher) | Compiles executive 1-on-1 talking points, formal HR rebuttal, 30-60-90 plan | `06_final_dossier.md` + 3 Dossiers |

---

## 4. Hermes Fleet & Profile Integration

The architecture encompasses all Hermes profiles running on the Mac gateway, Cloud VPS, or Mobile:

```text
                                 [TELEGRAM FLEET GATEWAY]
                                            │
        ┌───────────────────────────────────┼───────────────────────────────────┐
        ▼                                   ▼                                   ▼
[@Health_tracker_159bot]           [@Bug_ticket_bot]              [@Orchestrator_bot]
(Profile: default)                 (Profile: bug_ticket)          (Profile: orchestrator)
• User-facing companion            • Ingests bug reports          • Live status ledger
• App & nutrition inquiries        • Runs qa-reproduce check      • Monitors coder timeouts
• Read-only, no git access         • Emits packed Bug Cards       • Broadcasts PR proofs
        │                                   │                                   │
        └───────────────────────────────────┼───────────────────────────────────┘
                                            │
                                            ▼
                           [DISPATCH WORKER / DEPLOY POOL]
                                            │
        ┌───────────────────────────────────┴───────────────────────────────────┐
        ▼                                                                       ▼
[@VM_19485_bot / Mobile bot]                                           [Silent Coding Worker]
(Profile: vm / mobile)                                                 (run-coding-dispatch.sh)
• Interactive developer door                                           • Headless OpenCode / Cline / agy
• Direct command execution                                             • Bound to active Project & Role
• Supports /role, /project, /location                                  • Reverts cleanly on failure
```

### Shared Infrastructure across All Hermes Profiles:
1. **Common Skills:** Canonical skills live in `scripts/skills/common/` and auto-sync to `~/.hermes/profiles/*/skills/` via `sync-hermes-skills.sh`.
2. **Unified Commands:** `/project`, `/location`, `/role`, `/council`, and `/allowance` are supported across all bot doors.
3. **Centralized Memory & User Model:** Profile memories adhere to strict caps (`USER.md` 1,375 chars, `MEMORY.md` 2,200 chars) to prevent context bloat.
4. **Single-Checkout Lock:** No Hermes bot may bypass `run-coding-dispatch.sh` to edit files directly on `main`.

---

## 5. Pluggable Council Roles & Dynamic Role Management

Project council roles are **file-driven, agnostic, and dynamically managed**. Roles are never hardcoded; the engine automatically discovers role markdown files under `projects/<id>/roles/*.md` and dynamically scales the council review pipeline to match.

### Dynamic Role Commands:
* `/role` &mdash; Lists all currently active roles for the project (discovered from files & registry).
* `/role check <name>` *(or `/role inspect <name>`)* &mdash; **Audits and displays the assigned instructions**, description, and tool permissions for that role.
* `/role add <id> <name> : <instructions>` &mdash; **Creates and registers a new dynamic role on the fly**, persisting it to `roles/<id>.md` and immediately enabling `/role <id>`.
* `/role remove <id>` *(or `/role delete <id>`)* &mdash; **Removes a role** from the project and unlinks its markdown contract.
* `/role <name>` *(e.g. `/role ui` or `/role legal`)* &mdash; **Assigns the role** to the active agent, injecting its instructions into subsequent prompt turns.
* `/role reset` &mdash; Clears the active specialized role and returns the agent to general collaborative mode.

### Automatic Council Phase Scaling:
* When a role is added (e.g. `hr_witness`), `scripts/council-runner.mjs` automatically scales up the council phases from 6 to 7.
* When a role is removed, the council stages automatically scale down without code changes.

---

## 6. Quota Resilience & Cross-Location Handoff

1. **Continuous Quota Monitoring:** Tracks provider HTTP headers (`X-RateLimit-Remaining`, 429 status, or CLI token balance).
2. **State & Role Serialization:** When quota is exhausted:
   - The active project ID, active role ID, and uncommitted diffs are serialized.
3. **Automated Pool Failover:**
   - `/location vps` $\leftrightarrow$ `/location mobile` routes work to an alternate node with healthy quota.
   - The target agent receives the exact serialized role bundle and resumes execution seamlessly.
4. **Offline Host Resilience:**
   - If an agent requests `/location mobile` but the mobile node is offline, the router issues a clear diagnostic warning and falls back to available cloud lanes (OpenCode Zen Free, Cloudflare Workers AI, Gemini 2.0 Flash).

---

## 7. Verification & Live Test Matrix

All 55 assertions in `scripts/assert-external-projects.test.mjs` pass cleanly:

| Test Scenario | Verification Method | Result |
|---|---|---|
| **Project 1 & 2 Resolution** | `resolveProjectId('1')`, `resolveProjectId('2')`, `resolveProjectId('pip')` | ✅ PASS |
| **Universal Role Resolution** | Resolves `arch`, `ui`, `backend`, `qa`, `ops`, `legal`, `accuracy`, `sim`, `arb`, `builder` | ✅ PASS |
| **Role Inspection (`checkRoleDetails`)** | Verifies UI role instructions ('React 19 UI') and Legal role instructions | ✅ PASS |
| **Project 1 Role Switching** | `switchChatRole('test_chat', 'frontend')` returns `frontend_ui` | ✅ PASS |
| **Project 1 Prompt Injection** | `composeExternalPrompt` injects `[ACTIVE ROLE: Frontend UI/UX Specialist]` and instructions | ✅ PASS |
| **External Council 6 Phases** | `getCouncilStatus('external-1')` verifies 6 review phases & ready deliverables | ✅ PASS |
| **Google Drive Manifest Bridge** | `generateSyncManifest()` and `getSyncStatus()` track local mirror | ✅ PASS |
| **Dynamic Role Addition (`addProjectRole`)** | Adds `hr_witness` role file; council scales dynamically to 7 phases | ✅ PASS |
| **Dynamic Role Removal (`removeProjectRole`)** | Unlinks `hr_witness` role file; council scales back down to 6 phases | ✅ PASS |
| **Role Reset & Project Restore** | `resetChatRole()` restores general mode; restored to `health-tracker` | ✅ PASS |
