---
name: orchestrator-dispatcher
description: Orchestrator agent skill for Health-tracker. Triages defects, tracks tool allowances across OpenCode, Cline CLI, and Grok Build, dispatches coding agents, and oversees webhook deployment.
version: 1.0.0
---

## When to Use
- When the user asks the Orchestrator to check tool allowances, fix a bug, or dispatch a coding agent.
- Phrases: `/tool_status`, "check allowances", "fix bug <ID>", "dispatch agent", "tool allowance status".

## Commands
1. Check Tool Allowance & Availability Status:
   ```bash
   node /home/ubuntu/src/Health-tracker/scripts/tool-allowance.mjs status
   ```

2. Dispatch Bug Resolution:
   ```bash
   bash /home/ubuntu/src/Health-tracker/scripts/run-coding-dispatch.sh --task="<description>" --bug-id="<ID>" --category="<category>" [--tool=auto|cline|opencode|grok]
   ```

3. Dynamic Tool Hierarchy:
   - **Tier 1 (OpenCode):** Free/fast tier models (`muse-spark-1.3`, `deepseek-flash-4.1`) for standard UI/logic bugfixes.
   - **Tier 2 (Cline CLI):** High-thinking autonomous tool runner (`cline --auto-approve true --thinking high`) when OpenCode allowance is low or task requires deep multi-step tools.
   - **Tier 3 (Grok Build CLI):** Deep architectural reasoning and complex cross-file debugging.
   - **Tier 4 (Human):** Escalation if all automated tools encounter errors or rate limits.
