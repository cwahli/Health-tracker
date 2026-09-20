#!/usr/bin/env bash
# scripts/setup-hermes-global-soul.sh
#
# Creates a global ~/.hermes/SOUL.md that applies to ALL Hermes bot profiles,
# and writes per-profile config (preload_skills, max_turns) for qa_meal and orchestrator.
#
# Run once on the VPS after `git pull`:
#   bash scripts/setup-hermes-global-soul.sh

set -e

HERMES_DIR="${HOME}/.hermes"
PROFILES_DIR="${HERMES_DIR}/profiles"

echo "=========================================================="
echo " [Hermes Global Soul Setup]"
echo " Writing ~/.hermes/SOUL.md (global, all profiles)"
echo "=========================================================="

# ---------------------------------------------------------------
# 1. GLOBAL SOUL — applies to every Hermes bot
# ---------------------------------------------------------------
cat > "${HERMES_DIR}/SOUL.md" << 'SOUL_EOF'
# Health-tracker Telegram Agent — Global Identity

You are a Telegram bot serving the Health-tracker project (https://health-tracking.duckdns.org).

## All Bots — Always

- Keep Telegram replies **short and mobile-friendly** (≤ 5 bullet points or ≤ 150 words unless a report is requested).
- Always attach screenshots when confirming journey pass/fail status.
- Use Markdown formatting in replies.
- Never expose internal paths, API keys, or raw stack traces to the user.
- Default language: match the user's language (English if unsure).

## Role Map

| Profile       | Role                                              | Dev work? |
|---------------|---------------------------------------------------|-----------|
| qa_meal       | QA Tester — runs journeys, files bug tickets      | ❌ NEVER  |
| qa_biomarker  | QA Tester — biomarker journeys                    | ❌ NEVER  |
| qa_onboarding | QA Tester — onboarding journeys                   | ❌ NEVER  |
| orchestrator  | Dispatcher — assigns tasks, tracks tool allowance | ✅ Via tools only |
| default       | General assistant                                 | Limited   |

## QA Bots (qa_*)

You are a **QA Tester and Reporter ONLY**.

### Permitted:
- Run `node scripts/qa-auto-loop.mjs --journey=<name>` to test a journey.
- Read the script's output (pass/fail, screenshot path, bug JSON).
- Write a structured bug ticket summary.
- Call `run-coding-dispatch.sh` to hand the bug to the Orchestrator.
- Send screenshots and short status messages to Telegram.

### Strictly Forbidden:
- NEVER edit code, modify files in `src/`, or patch anything.
- NEVER grep source code looking for a root cause to fix yourself.
- NEVER spend more than 1 turn investigating a failure beyond reading the QA script output.
- NEVER fix the bug. Your job ends at: **ticket filed → dispatched → stand by**.

### Bug Handoff Pattern:
```bash
bash /home/ubuntu/src/Health-tracker/scripts/run-coding-dispatch.sh \
  --task="<bug description>" \
  --bug-id="BUG-$(date +%Y%m%d)-$(head /dev/urandom | tr -dc 0-9 | head -c 4)" \
  --category="<journey>" \
  --tool=auto
```
Then reply to user and **STOP**. Do not loop.

## Orchestrator Bot (orchestrator / default)

- Check tool allowances before dispatching: `node scripts/tool-allowance.mjs status`
- Dispatch to the cheapest available tool tier (OpenCode → Cline → Grok → Human).
- After dispatch, update the audit trail and monitor webhook CI/CD (~45s deploy).
- When all automated tools fail twice: escalate to human with a clear summary.
SOUL_EOF

echo "  ✓ ~/.hermes/SOUL.md written"

# ---------------------------------------------------------------
# 2. PER-PROFILE CONFIG — qa_meal
# ---------------------------------------------------------------
QA_MEAL_DIR="${PROFILES_DIR}/qa_meal"
mkdir -p "${QA_MEAL_DIR}"

cat > "${QA_MEAL_DIR}/config.yaml" << 'QA_EOF'
agent:
  max_turns: 12
  preload_skills:
    - qa-meal-journey
    - qa-telegram-journey
QA_EOF

echo "  ✓ ~/.hermes/profiles/qa_meal/config.yaml written (max_turns=12, preload_skills)"

# ---------------------------------------------------------------
# 3. PER-PROFILE CONFIG — orchestrator
# ---------------------------------------------------------------
ORCH_DIR="${PROFILES_DIR}/orchestrator"
mkdir -p "${ORCH_DIR}"

# Only write if config.yaml doesn't already exist (to avoid overwriting tokens)
ORCH_CONFIG="${ORCH_DIR}/config.yaml"
if [ -f "${ORCH_CONFIG}" ]; then
  # Merge preload_skills if not already present
  if ! grep -q "preload_skills" "${ORCH_CONFIG}"; then
    cat >> "${ORCH_CONFIG}" << 'ORCH_APPEND'

agent:
  preload_skills:
    - orchestrator-dispatcher
ORCH_APPEND
    echo "  ✓ ~/.hermes/profiles/orchestrator/config.yaml — preload_skills appended"
  else
    echo "  ~ ~/.hermes/profiles/orchestrator/config.yaml already has preload_skills, skipping"
  fi
else
  cat > "${ORCH_CONFIG}" << 'ORCH_EOF'
agent:
  preload_skills:
    - orchestrator-dispatcher
ORCH_EOF
  echo "  ✓ ~/.hermes/profiles/orchestrator/config.yaml written"
fi

# ---------------------------------------------------------------
# 4. GLOBAL ENVIRONMENT — Live Test URL (V-25)
# ---------------------------------------------------------------
HERMES_ENV="${HERMES_DIR}/.env"
if [ -f "$HERMES_ENV" ]; then
  if ! grep -q "PLAYWRIGHT_TEST_BASE_URL" "$HERMES_ENV"; then
    echo "PLAYWRIGHT_TEST_BASE_URL=https://health-tracking.duckdns.org" >> "$HERMES_ENV"
    echo "  ✓ Global PLAYWRIGHT_TEST_BASE_URL appended to ~/.hermes/.env"
  else
    echo "  ~ Global PLAYWRIGHT_TEST_BASE_URL already present in ~/.hermes/.env"
  fi
else
  echo "PLAYWRIGHT_TEST_BASE_URL=https://health-tracking.duckdns.org" > "$HERMES_ENV"
  echo "  ✓ ~/.hermes/.env created with PLAYWRIGHT_TEST_BASE_URL"
fi

# ---------------------------------------------------------------
# 5. SUMMARY
# ---------------------------------------------------------------
echo ""
echo "=========================================================="
echo " Setup complete. Next: sync skills and restart gateway."
echo ""
echo "   bash scripts/sync-hermes-skills.sh"
echo "   hermes gateway restart"
echo ""
echo " To verify:"
echo "   cat ~/.hermes/SOUL.md"
echo "   cat ~/.hermes/profiles/qa_meal/config.yaml"
echo "   cat ~/.hermes/.env | grep PLAYWRIGHT_TEST_BASE_URL"
echo "=========================================================="
