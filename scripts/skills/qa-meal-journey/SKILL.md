---
name: qa-meal-journey
description: QA Journey testing agent for Health-tracker. Tests meal, biomarker, or onboarding user journeys against live production, delivers full-page verification screenshots, and triggers autonomous bug healing.
version: 1.1.0
---

## When to Use
- When the user asks in Telegram to test, audit, or check ANY user journey.
- Phrases: "test meal journey", "test biomarker journey", "test onboarding journey", "test <any> journey", "/test <journey>".

## Procedure
1. **Identify the Journey:**
   - Check the user's message for the target journey:
     - `meal` (default if unspecified, or if user mentions meal, food, nutrition, logging)
     - `biomarker` (if user mentions biomarker, lab, blood, vitals, medical)
     - `onboarding` (if user mentions onboarding, welcome, front desk, profile)
   - Assign `JOURNEY=<target>`

2. **Execute the Autonomous QA Loop:**
   ```bash
   cd /home/ubuntu/src/Health-tracker && node scripts/qa-auto-loop.mjs --journey=$JOURNEY
   ```

3. **What Happens Automatically:**
   - Headless Chromium navigates to `https://health-tracking.duckdns.org` and logs in via `#demo-login-btn` (`demo@healthcockpit.com`).
   - The test audits all journey tabs, lazy-loaded chunks, interactive elements, and error boundaries.
   - **On 0 Defects (Clean):**
     - Captures a full-page screenshot of the clean live application.
     - Automatically delivers the screenshot and clean verification report to this Telegram chat.
   - **On Defect Detected:**
     - Snaps a Before screenshot and delivers the diagnostic bug ticket to Telegram.
     - Hands off the bug ticket to the Orchestrator.
     - Orchestrator evaluates allowances and dispatches OpenCode, Cline CLI, or Grok Build.
     - Awaits GitHub webhook auto-deploy (~40s).
     - Re-tests live site, captures fresh After screenshot, and sends Before vs. After victory report.

4. **Reply to the User:**
   - Summarize the test outcome for the requested journey and confirm the screenshot delivery.
