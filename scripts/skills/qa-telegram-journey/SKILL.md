---
name: qa-telegram-journey
description: Runs end-to-end browser QA tests for meal, biomarker, or onboarding journeys, sends clean or before/after screenshots to Telegram, and triggers orchestrator bug healing.
version: 1.1.0
---

## When to Use
- When the user asks in Telegram to test, audit, or check any user journey (meal, biomarker, onboarding).
- Phrases: "test meal journey", "check biomarkers", "test onboarding", "test <any> journey", "run QA loop".

## Procedure
1. Identify the requested journey (`meal`, `biomarker`, or `onboarding`). Default to `meal`.
2. Run the autonomous QA auto-loop script:
   ```bash
   cd /home/ubuntu/src/Health-tracker && node scripts/qa-auto-loop.mjs --journey=<meal|biomarker|onboarding>
   ```
3. What happens automatically:
   - The script launches headless Chromium and tests the requested journey against live production.
   - **If clean (PASS):**
     - Automatically snaps a live full-page screenshot of the clean UI and sends it directly to Telegram with a verified checklist.
   - **If a bug is detected:**
     - Automatically sends the "Before" screenshot and bug diagnostic card to Telegram.
     - Hands off the bug to OpenCode, Cline CLI, or Grok Build.
     - Once deployed, re-tests the live application.
     - Snaps a fresh "After" screenshot and sends the complete victory report with photos to Telegram!
4. Reply to the user in Telegram confirming the loop status and screenshot delivery.
