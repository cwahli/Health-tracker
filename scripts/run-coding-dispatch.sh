#!/usr/bin/env bash
# scripts/run-coding-dispatch.sh
# 
# Multi-Tool Autonomous Coding Agent Dispatcher for Health-tracker.
# Integrates dynamic tool selection, allowance tracking, and graceful fallback:
# OpenCode -> Cline CLI -> Grok Build CLI -> Antigravity CLI -> Human Escalation.
#
# Features:
#  - Telegram status updates at every step (never silent)
#  - Screenshot/image path forwarded in task description  
#  - Thinking level control per tool
#  - Heartbeat while agent is running (stuck detection)
#  - Summary sent to QA bot on completion
#
# Usage:
#   ./scripts/run-coding-dispatch.sh --task="Fix X" --bug-id="BUG-123" --category="meal" \
#     [--tool=auto|cline|opencode|grok] [--screenshot="/path/to/bug.png"] [--thinking=high|low|none]

set -eo pipefail

TASK=""
BUG_ID="BUG-UNKNOWN"
CATEGORY="general"
REQUESTED_TOOL="auto"
PREFERRED_MODEL="muse-spark-1.3"
THINKING="high"
SCREENSHOT=""

for arg in "$@"; do
  case $arg in
    --help|-h)
      echo "Usage: $0 --task='description' [--bug-id='...'] [--category='...'] [--tool=auto|cline|opencode|grok] [--screenshot='/path/to/img.png'] [--thinking=high|low|none]"
      exit 0
      ;;
    --task=*)    TASK="${arg#*=}" ;;
    --bug-id=*)  BUG_ID="${arg#*=}" ;;
    --category=*) CATEGORY="${arg#*=}" ;;
    --tool=*)    REQUESTED_TOOL="${arg#*=}" ;;
    --model=*)   PREFERRED_MODEL="${arg#*=}" ;;
    --thinking=*) THINKING="${arg#*=}" ;;
    --screenshot=*) SCREENSHOT="${arg#*=}" ;;
    *)
      if [ -z "$TASK" ]; then TASK="$arg"; fi
      ;;
  esac
done

if [ -z "$TASK" ]; then
  echo "Error: No task provided. Usage: $0 --task='description' [--bug-id='...'] [--category='...']"
  exit 1
fi

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.."; pwd)"
cd "$REPO_DIR"

HERMES_DIR="${HOME}/.hermes"
AUDIT_LOG="${HERMES_DIR}/dispatch_audit.log"
TELEGRAM_SCRIPT="${REPO_DIR}/scripts/telegram-send.sh"
mkdir -p "$HERMES_DIR"

# Executable search paths
OPENCODE_BIN=$(which opencode 2>/dev/null || echo "${HOME}/.opencode/bin/opencode")
CLINE_BIN=$(which cline 2>/dev/null || echo "${HOME}/.local/bin/cline")
GROK_BIN=$(which grok 2>/dev/null || echo "${HOME}/.grok/bin/grok")
AGY_BIN=$(which agy 2>/dev/null || echo "${HOME}/.local/bin/agy")

START_TIME=$(date +%s)

# ---------------------------------------------------------------
# Telegram helper — always non-blocking, never fails the dispatch
# ---------------------------------------------------------------
tg_msg() {
  local text="$1"
  local photo="${2:-}"
  if [ -n "$photo" ] && [ -f "$photo" ]; then
    bash "$TELEGRAM_SCRIPT" --photo="$photo" --caption="$text" 2>/dev/null || true
  else
    bash "$TELEGRAM_SCRIPT" --text="$text" 2>/dev/null || true
  fi
}

# ---------------------------------------------------------------
# Cross-platform timeout
# ---------------------------------------------------------------
run_with_timeout() {
  local duration="$1"; shift
  if command -v timeout >/dev/null 2>&1; then
    timeout "$duration" "$@"
  elif command -v gtimeout >/dev/null 2>&1; then
    gtimeout "$duration" "$@"
  else
    "$@"
  fi
}

# ---------------------------------------------------------------
# Heartbeat — sends a Telegram ping every N minutes while running
# ---------------------------------------------------------------
start_heartbeat() {
  local tool_name="$1"
  local interval_secs="${2:-120}"   # 2 min default
  (
    while true; do
      sleep "$interval_secs"
      tg_msg "⏳ *[Orchestrator]* Agent '$tool_name' still working on \`$BUG_ID\`... ($(( ($(date +%s) - START_TIME) / 60 ))m elapsed)"
    done
  ) &
  HEARTBEAT_PID=$!
}

stop_heartbeat() {
  if [ -n "${HEARTBEAT_PID:-}" ]; then
    kill "$HEARTBEAT_PID" 2>/dev/null || true
    HEARTBEAT_PID=""
  fi
}

# ---------------------------------------------------------------
# Audit
# ---------------------------------------------------------------
record_audit() {
  local agent="$1" model="$2" tier="$3" status="$4"
  local duration=$(( $(date +%s) - START_TIME ))
  local entry="{\"timestamp\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\", \"bug_id\": \"$BUG_ID\", \"category\": \"$CATEGORY\", \"agent\": \"$agent\", \"model\": \"$model\", \"tier\": \"$tier\", \"duration_seconds\": $duration, \"status\": \"$status\"}"
  echo "$entry" >> "$AUDIT_LOG"
}

# ---------------------------------------------------------------
# tsc + git commit check
# ---------------------------------------------------------------
check_git_and_tsc() {
  local tool_name="$1" model_desc="$2"
  echo "[Dispatcher] Verifying $tool_name changes with tsc..."
  if npx tsc --noEmit >/dev/null 2>&1; then
    DIFF_COUNT=$(git status --porcelain | wc -l | tr -d ' ')
    if [ "$DIFF_COUNT" -gt 0 ]; then
      echo "[Dispatcher] tsc clean — committing..."
      git add .
      git commit -m "fix($CATEGORY): $BUG_ID via $tool_name ($model_desc)" || true
      git push origin main
      node scripts/tool-allowance.mjs report-result --tool="$tool_name" --status="success" --bug-id="$BUG_ID" --category="$CATEGORY" --duration=$(( $(date +%s) - START_TIME )) || true
      record_audit "$tool_name" "$model_desc" "resolved" "deployed_pending_qa"
      return 0
    else
      echo "[Dispatcher] No file changes produced by $tool_name."
      return 1
    fi
  else
    echo "[Dispatcher] tsc failed after $tool_name."
    return 1
  fi
}

clean_workspace() {
  git checkout . >/dev/null 2>&1 || true
  git clean -fd >/dev/null 2>&1 || true
}

# ---------------------------------------------------------------
# Build full task prompt including screenshot reference
# ---------------------------------------------------------------
build_prompt() {
  local base_prompt="Task for $BUG_ID ($CATEGORY): $TASK"
  if [ -n "$SCREENSHOT" ] && [ -f "$SCREENSHOT" ]; then
    base_prompt="${base_prompt} The bug screenshot is at: ${SCREENSHOT} — use it to understand the visual defect."
  fi
  base_prompt="${base_prompt} Think deeply before modifying files. Verify with npx tsc --noEmit before finishing."
  echo "$base_prompt"
}

# ---------------------------------------------------------------
# TOOL FUNCTIONS
# ---------------------------------------------------------------

try_opencode() {
  local model="$1"
  echo "[Dispatcher] --> OpenCode (Model: $model)"
  if [ ! -x "$OPENCODE_BIN" ]; then
    echo "[Dispatcher] OpenCode not executable at $OPENCODE_BIN, skipping."
    return 1
  fi

  tg_msg "🤖 *[Orchestrator]* Dispatching to *OpenCode* ($model) for \`$BUG_ID\`..."
  start_heartbeat "OpenCode"

  local prompt; prompt="$(build_prompt)"
  local output
  output=$(run_with_timeout 8m "$OPENCODE_BIN" -p "$prompt" 2>&1) || true
  stop_heartbeat

  if echo "$output" | grep -qiE "rate limit|quota exceeded|insufficient credits|429|allowance"; then
    tg_msg "⚠️ *[Orchestrator]* OpenCode hit rate limit for \`$BUG_ID\`. Trying next tool..."
    node scripts/tool-allowance.mjs report-result --tool="opencode" --status="rate_limited" --bug-id="$BUG_ID" --reason="Rate limit" || true
    clean_workspace
    return 2
  fi

  if check_git_and_tsc "opencode" "$model"; then return 0; fi

  # One nudge attempt
  tg_msg "🔄 *[Orchestrator]* OpenCode nudged to retry \`$BUG_ID\`..."
  run_with_timeout 4m "$OPENCODE_BIN" -p "Previous attempt for $BUG_ID had errors. Inspect git status, analyse errors, and complete the fix now." 2>&1 || true
  if check_git_and_tsc "opencode" "$model"; then return 0; fi

  tg_msg "❌ *[Orchestrator]* OpenCode could not resolve \`$BUG_ID\`. Escalating to Cline..."
  clean_workspace
  node scripts/tool-allowance.mjs report-result --tool="opencode" --status="failed" --bug-id="$BUG_ID" || true
  return 1
}

try_cline() {
  local thinking="${THINKING:-high}"
  echo "[Dispatcher] --> Cline CLI (Thinking: $thinking)"
  if [ ! -x "$CLINE_BIN" ]; then
    echo "[Dispatcher] Cline not executable at $CLINE_BIN, skipping."
    return 1
  fi

  tg_msg "🤖 *[Orchestrator]* Dispatching to *Cline CLI* (thinking=$thinking) for \`$BUG_ID\`..."
  start_heartbeat "Cline"

  local prompt; prompt="$(build_prompt)"
  local output
  output=$(run_with_timeout 8m "$CLINE_BIN" --auto-approve true --thinking "$thinking" "$prompt" 2>&1) || true
  stop_heartbeat

  if echo "$output" | grep -qiE "rate limit|quota exceeded|insufficient credits|429|exhausted|allowance"; then
    tg_msg "⚠️ *[Orchestrator]* Cline hit rate limit for \`$BUG_ID\`. Trying next tool..."
    node scripts/tool-allowance.mjs report-result --tool="cline" --status="rate_limited" --bug-id="$BUG_ID" --reason="Rate limit" || true
    clean_workspace
    return 2
  fi

  if check_git_and_tsc "cline" "DeepSeek/thinking=$thinking"; then return 0; fi

  tg_msg "❌ *[Orchestrator]* Cline could not resolve \`$BUG_ID\`. Escalating to Grok..."
  clean_workspace
  node scripts/tool-allowance.mjs report-result --tool="cline" --status="failed" --bug-id="$BUG_ID" || true
  return 1
}

try_grok() {
  echo "[Dispatcher] --> Grok Build CLI"
  if [ ! -x "$GROK_BIN" ]; then
    echo "[Dispatcher] Grok not executable at $GROK_BIN, skipping."
    return 1
  fi

  tg_msg "🤖 *[Orchestrator]* Dispatching to *Grok Build* (deep architecture reasoning) for \`$BUG_ID\`..."
  start_heartbeat "Grok"

  local prompt; prompt="$(build_prompt) A lighter model was unable to resolve this — analyse the architecture deeply."
  local output
  output=$(run_with_timeout 10m "$GROK_BIN" -p "$prompt" 2>&1) || true
  stop_heartbeat

  if echo "$output" | grep -qiE "rate limit|quota exceeded|429"; then
    tg_msg "⚠️ *[Orchestrator]* Grok hit rate limit for \`$BUG_ID\`. Trying Agy..."
    node scripts/tool-allowance.mjs report-result --tool="grok" --status="rate_limited" --bug-id="$BUG_ID" || true
    clean_workspace
    return 2
  fi

  if check_git_and_tsc "grok" "grok-build"; then return 0; fi

  tg_msg "❌ *[Orchestrator]* Grok could not resolve \`$BUG_ID\`. Trying Agy..."
  clean_workspace
  node scripts/tool-allowance.mjs report-result --tool="grok" --status="failed" --bug-id="$BUG_ID" || true
  return 1
}

try_agy() {
  echo "[Dispatcher] --> Antigravity CLI"
  if [ ! -x "$AGY_BIN" ]; then return 1; fi

  tg_msg "🤖 *[Orchestrator]* Dispatching to *Antigravity CLI* for \`$BUG_ID\`..."
  start_heartbeat "Agy"

  local prompt; prompt="$(build_prompt)"
  run_with_timeout 8m "$AGY_BIN" -p "$prompt" 2>&1 || true
  stop_heartbeat

  if check_git_and_tsc "agy" "antigravity"; then return 0; fi

  tg_msg "❌ *[Orchestrator]* Agy could not resolve \`$BUG_ID\`."
  clean_workspace
  return 1
}

# ---------------------------------------------------------------
# MAIN — tool cascade
# ---------------------------------------------------------------
echo "=========================================================="
echo " [Coding Dispatcher] $BUG_ID ($CATEGORY)"
echo " Task: $TASK"
echo " Tool: $REQUESTED_TOOL | Thinking: $THINKING"
echo " Screenshot: ${SCREENSHOT:-none}"
echo "=========================================================="

# Announce to Telegram with tool list
AGENT_LIST="$(node scripts/tool-allowance.mjs status 2>/dev/null | grep '^-' | sed 's/^- /• /' | head -4 || echo '• OpenCode • Cline • Grok • Agy')"
tg_msg "📋 *[Orchestrator]* Bug \`$BUG_ID\` received.

*Task:* $TASK
*Journey:* $CATEGORY

Checking agent pool availability..."

# Send screenshot to Telegram so orchestrator channel has it
if [ -n "$SCREENSHOT" ] && [ -f "$SCREENSHOT" ]; then
  tg_msg "📸 *[Orchestrator]* Bug evidence attached for \`$BUG_ID\`" "$SCREENSHOT"
fi

# Show agent availability in Telegram
tg_msg "🔧 *[Orchestrator]* Available agents:
$AGENT_LIST

Selecting best available tool and dispatching..."

# Build tool sequence
TOOL_SEQUENCE=()
if [ "$REQUESTED_TOOL" != "auto" ]; then
  TOOL_SEQUENCE+=("$REQUESTED_TOOL")
fi

BEST_TOOL=$(node scripts/tool-allowance.mjs pick-tool --category="$CATEGORY" 2>/dev/null | grep '"tool":' | head -n1 | cut -d '"' -f4)
if [ "$BEST_TOOL" != "none" ] && [[ ! " ${TOOL_SEQUENCE[*]} " =~ " ${BEST_TOOL} " ]]; then
  TOOL_SEQUENCE+=("$BEST_TOOL")
fi
for fallback in "opencode" "cline" "grok" "agy"; do
  if [[ ! " ${TOOL_SEQUENCE[*]} " =~ " ${fallback} " ]]; then
    TOOL_SEQUENCE+=("$fallback")
  fi
done

echo "[Dispatcher] Execution sequence: ${TOOL_SEQUENCE[*]}"

for tool in "${TOOL_SEQUENCE[@]}"; do
  case $tool in
    opencode)
      if try_opencode "$PREFERRED_MODEL"; then
        tg_msg "✅ *[Orchestrator]* \`$BUG_ID\` resolved by *OpenCode*!

Fix pushed to main. Awaiting CI/CD deploy (~45s).
QA bot will re-verify and send confirmation screenshot."
        exit 0
      fi ;;
    cline)
      if try_cline; then
        tg_msg "✅ *[Orchestrator]* \`$BUG_ID\` resolved by *Cline CLI*!

Fix pushed to main. Awaiting CI/CD deploy (~45s).
QA bot will re-verify and send confirmation screenshot."
        exit 0
      fi ;;
    grok)
      if try_grok; then
        tg_msg "✅ *[Orchestrator]* \`$BUG_ID\` resolved by *Grok Build*!

Fix pushed to main. Awaiting CI/CD deploy (~45s).
QA bot will re-verify and send confirmation screenshot."
        exit 0
      fi ;;
    agy)
      if try_agy; then
        tg_msg "✅ *[Orchestrator]* \`$BUG_ID\` resolved by *Antigravity*!

Fix pushed to main. Awaiting CI/CD deploy (~45s).
QA bot will re-verify and send confirmation screenshot."
        exit 0
      fi ;;
    *) echo "[Dispatcher] Unknown tool: $tool, skipping." ;;
  esac
done

# All tools exhausted
record_audit "none" "none" "human" "escalated_human"
tg_msg "🚨 *[Orchestrator]* All automated agents exhausted for \`$BUG_ID\`.

*Agents tried:* ${TOOL_SEQUENCE[*]}
*Bug:* $TASK

Human intervention required. Please review the bug and assign manually."
exit 1
