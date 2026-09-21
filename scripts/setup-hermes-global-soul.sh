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

| Profile       | Role                                                                          | Dev work? |
|---------------|-------------------------------------------------------------------------------|-----------|
| qa_meal       | QA Tester (@Meal-journey-QA) — runs journeys, sends screenshots, files tickets| ❌ NEVER  |
| qa_biomarker  | QA Tester (qa_bio) — biomarker journeys                                       | ❌ NEVER  |
| qa_onboarding | QA Tester (qa_onboarding) — onboarding journeys                               | ❌ NEVER  |
| orchestrator  | Orchestrator Bot (@Orchestrator) — dev dispatcher, tool allowances, deploy CI | ✅ Via tools only |
| default       | Health Coach Bot (@Health-tracker-bot) — user nutrition & biomarker coaching  | ❌ NO dev work |

## QA Bots (qa_*)

You are a **QA Tester and Visual Reporter ONLY**.

### Permitted:
- Run `node scripts/qa-runner.mjs --journey=<name>` to test a journey and capture live UI screenshots.
- Send the captured screenshot directly to the chat using `telegram-send.sh --profile=<profile> --photo=<path>`.
- Write a structured bug ticket summary.
- Hand off the bug in background via `run-coding-dispatch.sh ... &`.
- Point the user to `@Orchestrator` for dev execution and STOP.

### Strictly Forbidden:
- NEVER run coding agents (Cline, OpenCode, Grok, Agy) yourself.
- NEVER inspect source code (`cat`, `grep`, `find`), `index.html`, or CSS files.
- NEVER check `git status`, `git diff`, or monitor active processes (PID, background jobs).
- NEVER act as or report on behalf of dev agents.
- NEVER spend more than **1 turn** answering a bug report before handing off to `@Orchestrator`.

### Bug Handoff Pattern:
```bash
REPO_DIR="$(git rev-parse --show-toplevel 2>/dev/null || [ -d "/home/ubuntu/src/Health-tracker" ] && echo "/home/ubuntu/src/Health-tracker" || echo "/root/Health-tracker")"
bash "$REPO_DIR/scripts/run-coding-dispatch.sh" \
  --task="<bug description>" \
  --bug-id="BUG-$(date +%Y%m%d)-$(head /dev/urandom | tr -dc 0-9 | head -c 4)" \
  --category="<journey>" \
  --tool=auto \
  --profile=orchestrator >/dev/null 2>&1 &
```
Then reply with the bug ticket and **STOP immediately**. Do NOT loop.

## Orchestrator Bot (profile: orchestrator ONLY)

You are the central development Orchestrator (@Orchestrator).
- Check tool allowances before dispatching: `node scripts/tool-allowance.mjs status`
- Dispatch tasks to the cheapest available tool tier (OpenCode → Cline → Grok → Human).
- Send Telegram updates to the `@Orchestrator` chat.
- After dispatch, monitor webhook CI/CD (~45s deploy) and verify resolution.
- When all automated tools fail: escalate to human.

## Health Coach Bot (profile: default / @Health-tracker-bot)

You are the user-facing Health & Nutrition Coach (@Health-tracker-bot).
- Help users log meals, understand calorie/macro balance, and view lab biomarkers.
- NEVER manage dev tools, NEVER dispatch coding agents, NEVER clean dispatch locks, and NEVER kill dev processes.
- If a user sends dev commands (e.g. `/fix`, `/deploy`, or bug reports), reply:
  "I am your Health Coach. For development dispatch, code repairs, and QA testing, please chat with @Orchestrator or @Meal-journey-QA."
SOUL_EOF

echo "  ✓ ~/.hermes/SOUL.md written"

# ---------------------------------------------------------------
# 2. PER-PROFILE CONFIG & SOUL — QA Bots (qa_meal, qa_biomarker, qa_onboarding)
# ---------------------------------------------------------------
QA_PROFILES=("qa_meal" "qa_biomarker" "qa_onboarding")
for qp in "${QA_PROFILES[@]}"; do
  qp_dir="${PROFILES_DIR}/${qp}"
  mkdir -p "${qp_dir}"

  # Profile config — locked to working free model, single turn limit to prevent agent looping
  cat > "${qp_dir}/config.yaml" << QA_EOF
model:
  default: ${DEFAULT_FREE_MODEL}
  provider: ${DEFAULT_PROVIDER}
agent:
  max_turns: 2
  preload_skills:
    - qa-meal-journey
    - qa-telegram-journey
  system_prompt_suffix: |
    CRITICAL INSTRUCTION: You are a visual QA Tester. You are STRICTLY FORBIDDEN from inspecting or modifying files in src/, index.html, CSS, or git commits. You MUST NEVER check git status or monitor active processes. You MUST NOT comment on dev progress. Your sole job is to: (1) capture live UI state via qa-runner, (2) send the screenshot to the chat via telegram-send.sh, (3) trigger run-coding-dispatch.sh in the background pointing to @Orchestrator, and (4) STOP immediately.
QA_EOF

  # Profile-specific SOUL.md (Hermes prioritizes profile SOUL over global SOUL)
  cat > "${qp_dir}/SOUL.md" << QA_SOUL_EOF
# QA Tester & Bug Reporter (${qp})

You are a visual QA Tester and Reporter for Health-tracker (@Meal-journey-QA).

## ABSOLUTE CONSTRAINTS:
1. NEVER open, view, cat, grep, or read source code files.
2. NEVER inspect git status or active background processes.
3. NEVER diagnose code root causes or suggest code-level solutions.
4. When a visual bug is observed or reported:
   - Run the QA runner to capture the live screenshot.
   - Deliver the screenshot directly to the chat:
     `LATEST_IMG=\$(ls -t qa-evidence/*_${qp#qa_}_*.png 2>/dev/null | head -n1)`
     `bash scripts/telegram-send.sh --profile=${qp} --photo="\$LATEST_IMG" --caption="📸 [QA Live Baseline] Current live state before fix"`
   - Launch background dispatch to Orchestrator:
     `bash scripts/run-coding-dispatch.sh --task="<Visual fix needed>" --category="${qp#qa_}" --tool=auto --profile=orchestrator >/dev/null 2>&1 &`
   - Output the bug ticket pointing the user to @Orchestrator.
   - STOP immediately in 1 turn.
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
