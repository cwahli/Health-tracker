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
DEFAULT_FREE_MODEL="${HERMES_DEFAULT_MODEL:-upstage/solar-pro4:free}"
DEFAULT_PROVIDER="${HERMES_DEFAULT_PROVIDER:-nous}"

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
# 2. PER-PROFILE CONFIG & SOUL — QA Bots (qa_meal, qa_biomarker, qa_onboarding)
# ---------------------------------------------------------------
QA_PROFILES=("qa_meal" "qa_biomarker" "qa_onboarding")
for qp in "${QA_PROFILES[@]}"; do
  qp_dir="${PROFILES_DIR}/${qp}"
  mkdir -p "${qp_dir}"

  # Profile config — locked to working free model so gateway restarts never revert to glm-5.2
  cat > "${qp_dir}/config.yaml" << QA_EOF
model:
  default: ${DEFAULT_FREE_MODEL}
  provider: ${DEFAULT_PROVIDER}
agent:
  max_turns: 8
  preload_skills:
    - qa-meal-journey
    - qa-telegram-journey
  system_prompt_suffix: |
    CRITICAL INSTRUCTION: You are a QA Tester. You are STRICTLY FORBIDDEN from inspecting, catting, grepping, or reading any source code in src/ or elsewhere. DO NOT diagnose root causes. DO NOT find where bugs originate in code. Your sole job is to report what is visually wrong from screenshots/test output, run run-coding-dispatch.sh to pass it to the Orchestrator, reply with the bug ticket, and STOP.
QA_EOF

  # Profile-specific SOUL.md (Hermes prioritizes profile SOUL over global SOUL)
  cat > "${qp_dir}/SOUL.md" << QA_SOUL_EOF
# QA Tester & Bug Reporter (${qp})

You are a visual QA Tester and Reporter for Health-tracker.

## ABSOLUTE CONSTRAINTS:
1. NEVER open, view, cat, grep, or read source code files.
2. NEVER diagnose code root causes or suggest code-level solutions.
3. NEVER spend multiple turns analyzing.
4. When a visual bug is observed or reported:
   - Identify the UI element and visual discrepancy (actual vs expected).
   - Execute the dispatch script:
     bash /home/ubuntu/src/Health-tracker/scripts/run-coding-dispatch.sh --task="<Visual fix needed>" --category="${qp#qa_}" --tool=auto --verify=true
   - Output the bug ticket and status in Telegram.
   - STOP immediately. Let the dev agent on the VM investigate and fix the code.
QA_SOUL_EOF

  echo "  ✓ ${qp_dir}/config.yaml & SOUL.md written"
done

# ---------------------------------------------------------------
# 3. PER-PROFILE CONFIG — orchestrator
# ---------------------------------------------------------------
ORCH_DIR="${PROFILES_DIR}/orchestrator"
mkdir -p "${ORCH_DIR}"

ORCH_CONFIG="${ORCH_DIR}/config.yaml"
cat > "${ORCH_CONFIG}" << ORCH_EOF
model:
  default: ${DEFAULT_FREE_MODEL}
  provider: ${DEFAULT_PROVIDER}
agent:
  preload_skills:
    - orchestrator-dispatcher
ORCH_EOF
echo "  ✓ ~/.hermes/profiles/orchestrator/config.yaml written"

cat > "${ORCH_DIR}/SOUL.md" << 'ORCH_SOUL_EOF'
# Orchestrator Dispatcher (orchestrator)

You are the central Orchestrator for Health-tracker development and repair tasks.

## Responsibilities:
1. Receive bug reports from QA bots or user.
2. Check tool allowance: node scripts/tool-allowance.mjs status
3. Inspect available tools: node scripts/tool-allowance.mjs list-agents
4. Dispatch tasks via run-coding-dispatch.sh
5. Keep Telegram updated with concise progress notifications.
6. Verify resolution post-deploy and report back to the QA bot and user.
ORCH_SOUL_EOF

echo "  ✓ ~/.hermes/profiles/orchestrator/SOUL.md written"

# ---------------------------------------------------------------
# 4. GLOBAL DEFAULT MODEL (Ensures global config never reverts to paid glm-5.2)
# ---------------------------------------------------------------
PYTHON_BIN="${HERMES_DIR}/hermes-agent/venv/bin/python"
if [ ! -x "$PYTHON_BIN" ]; then
  PYTHON_BIN="python3"
fi

if [ -f "${HERMES_DIR}/config.yaml" ]; then
  $PYTHON_BIN -c "
import yaml
path = '${HERMES_DIR}/config.yaml'
try:
    with open(path, 'r') as f:
        cfg = yaml.safe_load(f) or {}
    if not isinstance(cfg, dict):
        cfg = {}
    if 'model' not in cfg or not isinstance(cfg['model'], dict):
        cfg['model'] = {}
    cfg['model']['default'] = '${DEFAULT_FREE_MODEL}'
    cfg['model']['provider'] = '${DEFAULT_PROVIDER}'
    with open(path, 'w') as f:
        yaml.dump(cfg, f, default_flow_style=False)
    print('  ✓ Global ~/.hermes/config.yaml model set to ${DEFAULT_FREE_MODEL}')
except Exception as e:
    print('  ~ Warning: could not update ~/.hermes/config.yaml:', e)
" 2>/dev/null || true
fi

# ---------------------------------------------------------------
# 5. ENVIRONMENT VARIABLES (Model overrides & Live Test URL)
# ---------------------------------------------------------------
set_or_replace_env() {
  local env_file="$1"
  local key="$2"
  local val="$3"
  if [ -f "$env_file" ]; then
    if grep -q "^${key}=" "$env_file"; then
      sed -i "s|^${key}=.*|${key}=${val}|" "$env_file" 2>/dev/null || sed -i '' "s|^${key}=.*|${key}=${val}|" "$env_file"
    else
      echo "${key}=${val}" >> "$env_file"
    fi
  else
    echo "${key}=${val}" > "$env_file"
  fi
}

set_or_replace_env "${HERMES_DIR}/.env" "HERMES_INFERENCE_MODEL" "${DEFAULT_FREE_MODEL}"
set_or_replace_env "${HERMES_DIR}/.env" "HERMES_PROVIDER" "${DEFAULT_PROVIDER}"
set_or_replace_env "${HERMES_DIR}/.env" "PLAYWRIGHT_TEST_BASE_URL" "https://health-tracking.duckdns.org"
echo "  ✓ Global ~/.hermes/.env configured with model=${DEFAULT_FREE_MODEL} and duckdns origin"

# Propagate credentials and user ID to all profile .envs
GLOBAL_ALLOWED=$(grep -E '^(TELEGRAM_ALLOWED_USERS|TELEGRAM_USER_ID)=' "${HERMES_DIR}/.env" 2>/dev/null | head -n1 | cut -d '=' -f2- || true)

if [ -d "${PROFILES_DIR}" ]; then
  for prof in "${PROFILES_DIR}"/*; do
    if [ -d "$prof" ]; then
      set_or_replace_env "$prof/.env" "HERMES_INFERENCE_MODEL" "${DEFAULT_FREE_MODEL}"
      set_or_replace_env "$prof/.env" "HERMES_PROVIDER" "${DEFAULT_PROVIDER}"
      if [ -n "$GLOBAL_ALLOWED" ]; then
        if ! grep -q "TELEGRAM_ALLOWED_USERS=" "$prof/.env" 2>/dev/null; then
          echo "TELEGRAM_ALLOWED_USERS=${GLOBAL_ALLOWED}" >> "$prof/.env"
        fi
      fi
    fi
  done
  echo "  ✓ All profile .env files configured with model=${DEFAULT_FREE_MODEL} and allowed users"
fi

# ---------------------------------------------------------------
# 6. SUMMARY
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
echo "   cat ~/.hermes/.env | grep -E '(HERMES_INFERENCE_MODEL|PLAYWRIGHT_TEST_BASE_URL)'"
echo "=========================================================="
