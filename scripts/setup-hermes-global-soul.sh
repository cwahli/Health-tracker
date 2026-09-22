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
# 1. GLOBAL SOUL & PROFILE SOULS (BOT_ROLES.md §3a)
# ---------------------------------------------------------------
cat > "${HERMES_DIR}/SOUL.md" << 'SOUL_EOF'
# Health-tracker default bot

You are the health and app assistant for https://health-tracking.duckdns.org.
Reply in short sentences a phone can read. Match the user's language.
Answer questions about the person's logs and how to use the app.
If they ask to fix a bug, tell them to send it to the Meal, Biomarker, or Onboarding QA bot. Do not dispatch.
SOUL_EOF
echo "  ✓ ~/.hermes/SOUL.md written"

mkdir -p "${PROFILES_DIR}/qa_meal" "${PROFILES_DIR}/orchestrator" "${PROFILES_DIR}/qa_biomarker" "${PROFILES_DIR}/qa_onboarding"

cat > "${PROFILES_DIR}/qa_meal/SOUL.md" << 'QA_MEAL_EOF'
# Meal QA

You look at the meal journey and report what is on screen.
Write four lines: page, observed, expected, screenshot path.
Start scripts/run-coding-dispatch.sh once, in the background, with the user's actual words and --category=meal.
Then stop. Do not read source. Do not pick a coder. Do not wait for the result.
The Orchestrator posts the result back into this chat.
QA_MEAL_EOF
echo "  ✓ ~/.hermes/profiles/qa_meal/SOUL.md written"

cat > "${PROFILES_DIR}/orchestrator/SOUL.md" << 'ORCH_SOUL_EOF'
# Orchestrator

You are the intelligent coordinator and status manager for Health-tracker coding runs.
Do not edit the repository directly. Use run-coding-dispatch.sh for all actions.
- When asked about progress, what an agent is doing, or "what are you waiting for?", run:
  run-coding-dispatch.sh status
- When asked to stop, cancel, or halt, run:
  run-coding-dispatch.sh stop
- When asked for models or agents, run:
  run-coding-dispatch.sh list-models
- When asked to fix or assign a bug, select the best tool/model and dispatch via run-coding-dispatch.sh.
- Never guess, hallucinate, or deny messages. Always run run-coding-dispatch.sh status to check reality.
ORCH_SOUL_EOF
echo "  ✓ ~/.hermes/profiles/orchestrator/SOUL.md written"

cat > "${PROFILES_DIR}/qa_biomarker/SOUL.md" << 'QA_BIO_EOF'
# Biomarker QA

You look at the biomarker journey and report what is on screen.
Write four lines: page, observed, expected, screenshot path.
Start scripts/run-coding-dispatch.sh once, in the background, with the user's actual words and --category=biomarker.
Then stop. Do not read source. Do not pick a coder. Do not wait for the result.
The Orchestrator posts the result back into this chat.
This bot has no Telegram token yet. Do not send messages.
QA_BIO_EOF
echo "  ✓ ~/.hermes/profiles/qa_biomarker/SOUL.md written"

cat > "${PROFILES_DIR}/qa_onboarding/SOUL.md" << 'QA_ONBOARD_EOF'
# Onboarding QA

You look at the onboarding journey and report what is on screen.
Write four lines: page, observed, expected, screenshot path.
Start scripts/run-coding-dispatch.sh once, in the background, with the user's actual words and --category=onboarding.
Then stop. Do not read source. Do not pick a coder. Do not wait for the result.
The Orchestrator posts the result back into this chat.
This bot has no Telegram token yet. Do not send messages.
QA_ONBOARD_EOF
echo "  ✓ ~/.hermes/profiles/qa_onboarding/SOUL.md written"

# ---------------------------------------------------------------
# 2. USER & MEMORY FILES (BOT_ROLES.md §3b)
# ---------------------------------------------------------------
USER_CONTENT="Cwah Li. Short replies. Screenshots belong in the chat, not as a file path."
MEMORY_CONTENT="Live site is https://health-tracking.duckdns.org. Dev checkout is /home/ubuntu/src/Health-tracker.
OpenCode model opencode/muse-spark-1.3 returned insufficient funds on 2026-09-22. Antigravity is blocked in this region.
A QA bug is fixed only by scripts/run-coding-dispatch.sh. The OpenCode Telegram bot is a separate interactive door."

mkdir -p "${HERMES_DIR}/memories"
echo "$USER_CONTENT" > "${HERMES_DIR}/memories/USER.md"
echo "$MEMORY_CONTENT" > "${HERMES_DIR}/memories/MEMORY.md"

for prof in qa_meal orchestrator qa_biomarker qa_onboarding; do
  mkdir -p "${PROFILES_DIR}/${prof}/memories"
  echo "$USER_CONTENT" > "${PROFILES_DIR}/${prof}/memories/USER.md"
done

cat > "${PROFILES_DIR}/qa_meal/memories/MEMORY.md" << 'QA_MEM_EOF'
Live site is https://health-tracking.duckdns.org. Dev checkout is /home/ubuntu/src/Health-tracker.
OpenCode model opencode/muse-spark-1.3 returned insufficient funds on 2026-09-22. Antigravity is blocked in this region.
A QA bug is fixed only by run-coding-dispatch.sh. The OpenCode Telegram bot is a separate interactive door.
QA_MEM_EOF

cat > "${PROFILES_DIR}/orchestrator/memories/MEMORY.md" << 'ORCH_MEM_EOF'
Live site is https://health-tracking.duckdns.org. Dev checkout is /home/ubuntu/src/Health-tracker.
The dispatch harness is installed in PATH at run-coding-dispatch.sh and tool-allowance.mjs.
Available commands:
- run-coding-dispatch.sh status — shows active agent PID, elapsed time, current agent activity.
- run-coding-dispatch.sh stop — cleanly stops running coding agent, releases lock, resets workspace.
- run-coding-dispatch.sh list-models — available tools, healthy models, quotas.
- run-coding-dispatch.sh --tool=opencode --model=opencode-go/deepseek-v4.1-flash --thinking=high --task="..." — granular dispatch.
Available coding tools: OpenCode (active model: opencode-go/deepseek-v4.1-flash; muse-spark-1.3 is depleted), Grok Build CLI, Antigravity CLI. Cline CLI is not installed.
ORCH_MEM_EOF
rm -f "${PROFILES_DIR}/qa_biomarker/memories/MEMORY.md"
rm -f "${PROFILES_DIR}/qa_onboarding/memories/MEMORY.md"
echo "  ✓ USER.md and MEMORY.md synced across profiles"

# ---------------------------------------------------------------
# 3. PER-PROFILE CONFIG (BOT_ROLES.md §3c)
# ---------------------------------------------------------------
cat > "${PROFILES_DIR}/qa_meal/config.yaml" << QA_MEAL_CFG
model:
  default: ${DEFAULT_FREE_MODEL}
  provider: ${DEFAULT_PROVIDER}
agent:
  max_turns: 2
  preload_skills:
    - qa-meal-journey
QA_MEAL_CFG

for dark_qa in qa_biomarker qa_onboarding; do
  cat > "${PROFILES_DIR}/${dark_qa}/config.yaml" << DARK_QA_CFG
model:
  default: ${DEFAULT_FREE_MODEL}
  provider: ${DEFAULT_PROVIDER}
agent:
  max_turns: 2
  preload_skills: []
DARK_QA_CFG
done

cat > "${PROFILES_DIR}/orchestrator/config.yaml" << ORCH_CFG
model:
  default: ${DEFAULT_FREE_MODEL}
  provider: ${DEFAULT_PROVIDER}
agent:
  preload_skills:
    - orchestrator-dispatcher
ORCH_CFG
echo "  ✓ Profile config.yaml files updated (preloads and max_turns)"

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

  # Validate dedicated profile tokens
  echo ""
  echo " Profile Telegram Bot Token Status:"
  for prof_name in "orchestrator" "qa_meal"; do
    prof_env="${PROFILES_DIR}/${prof_name}/.env"
    if [ -f "$prof_env" ] && grep -q '^TELEGRAM_BOT_TOKEN=' "$prof_env"; then
      echo "  ✓ Profile '${prof_name}' has dedicated TELEGRAM_BOT_TOKEN"
    else
      echo "  ⚠️ [ACTION REQUIRED] Profile '${prof_name}' is MISSING dedicated TELEGRAM_BOT_TOKEN in ${prof_env}!"
      echo "     Without this token, messages will fall back to default bot (@Health-tracker-bot)."
      echo "     To set it up:"
      echo "       echo \"TELEGRAM_BOT_TOKEN=<your-${prof_name}-token>\" >> ${prof_env}"
    fi
  done
fi

# ---------------------------------------------------------------
# 6. SUMMARY & GATEWAY RESTART FOR ALL PROFILES
# ---------------------------------------------------------------
echo ""
echo "=========================================================="
echo " Setup complete. Next: sync skills and restart all gateways."
echo ""
echo "   bash scripts/sync-hermes-skills.sh"
echo "   hermes gateway restart --all"
echo "   hermes gateway list"
echo ""
echo " To verify profiles & active model:"
echo "   cat ~/.hermes/SOUL.md"
echo "   cat ~/.hermes/profiles/orchestrator/config.yaml"
echo "   cat ~/.hermes/profiles/qa_meal/config.yaml"
echo "   cat ~/.hermes/.env | grep -E '(HERMES_INFERENCE_MODEL|PLAYWRIGHT_TEST_BASE_URL)'"
echo "=========================================================="
