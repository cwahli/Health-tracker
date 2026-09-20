---
name: qa-telegram-journey
description: Runs end-to-end browser QA tests for meal, biomarker, or onboarding journeys, sends before/after screenshots to Telegram, and triggers orchestrator bug healing.
version: 1.0.0
---

## When to Use
- When the user asks in Telegram to test, audit, or check the meal journey, biomarker journey, or onboarding journey.
- Phrases: "test meal journey", "check biomarkers", "test onboarding", "run QA loop".

## Procedure
1. Run the autonomous QA auto-loop script:
   ```bash
   node /home/ubuntu/src/Health-tracker/scripts/qa-auto-loop.mjs --journey=<meal|biomarker|onboarding>
   ```
2. What happens automatically:
   - The script launches headless Chromium and tests the requested journey.
   - If clean: Sends a green confirmation directly into the Telegram chat/topic.
   - If a bug is detected:
     - Automatically sends the "Before" screenshot and bug diagnostic card to Telegram.
     - Hands off the bug to OpenCode (muse-spark-1.3, High Thinking) with Grok escalation fallback.
     - Once deployed, re-tests the live application.
     - Snaps a fresh "After" screenshot and sends the complete victory report with photos to Telegram!
3. Reply to the user in Telegram confirming the loop status.
