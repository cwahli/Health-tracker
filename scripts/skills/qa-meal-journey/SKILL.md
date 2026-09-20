---
name: qa-meal-journey
description: Dedicated QA agent skill for the Health-tracker Meal Journey. Tests meal logging, search, macro/micro breakdown, captures screenshots, and coordinates with Orchestrator for auto-healing.
version: 1.0.0
---

## When to Use
- When the user asks in Telegram to test, audit, or check the Meal Journey.
- Phrases: `/test_meal`, "test meal journey", "check meal logging", "audit meals", "run meal QA".

## Procedure
1. Execute the autonomous Meal QA loop:
   ```bash
   node /home/ubuntu/src/Health-tracker/scripts/qa-auto-loop.mjs --journey=meal
   ```
2. What happens automatically:
   - Headless Chromium navigates to the live website and logs in securely via the Demo Account (`demo@healthcockpit.com`).
   - The bot audits the Food History tab, search input, nutrition cards, and error boundaries.
   - **If Clean (0 defects):**
     - Sends a green confirmation directly into the Telegram chat/topic.
   - **If a Defect is Detected:**
     - Snaps a full-page **Before** screenshot and sends the defect ticket with repro steps to Telegram.
     - Hands off the bug ticket to the **Orchestrator**.
     - The Orchestrator inspects tool allowances and picks the optimal available coding agent (`OpenCode` -> `Cline CLI` -> `Grok Build`).
     - Once committed and auto-deployed via GitHub webhook (~40s), re-tests the live application.
     - Snaps a fresh **After** screenshot and posts the Before vs. After victory report to Telegram!
3. Reply to the user in Telegram confirming the loop execution status.
