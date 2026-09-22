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
#
# The process detaches itself so a short Hermes tool timeout cannot kill the coder.
# Pass --foreground when the caller must wait (qa-auto-loop). --print-plan prints the
# OpenCode command and QA profile without starting a job.

set -eo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.."; pwd)"
cd "$REPO_DIR"

HERMES_DIR="${HERMES_DIR:-${HOME}/.hermes}"
AUDIT_LOG="${HERMES_DIR}/dispatch_audit.log"
TELEGRAM_SCRIPT="${REPO_DIR}/scripts/telegram-send.sh"
DISPATCH_LOCK="${HERMES_DIR}/dispatch_lock"
DISPATCH_ACTIVE="${HERMES_DIR}/dispatch_active.json"
mkdir -p "$HERMES_DIR" "${HERMES_DIR}/logs"

# ---------------------------------------------------------------
# Subcommands: status, stop, cancel, list-models, list-agents
# ---------------------------------------------------------------
SUBCOMMAND="${1:-}"

status_cmd() {
  echo "=== Health-tracker Coding Dispatch Status ==="
  local pid="" bug_id="" category="" tool="" model="" thinking="" start_time="" log_file="" task=""

  if [ -f "$DISPATCH_ACTIVE" ]; then
    pid=$(python3 -c 'import json, sys; d=json.load(open(sys.argv[1])); print(d.get("pid",""))' "$DISPATCH_ACTIVE" 2>/dev/null || true)
    bug_id=$(python3 -c 'import json, sys; d=json.load(open(sys.argv[1])); print(d.get("bug_id",""))' "$DISPATCH_ACTIVE" 2>/dev/null || true)
    category=$(python3 -c 'import json, sys; d=json.load(open(sys.argv[1])); print(d.get("category",""))' "$DISPATCH_ACTIVE" 2>/dev/null || true)
    tool=$(python3 -c 'import json, sys; d=json.load(open(sys.argv[1])); print(d.get("tool",""))' "$DISPATCH_ACTIVE" 2>/dev/null || true)
    model=$(python3 -c 'import json, sys; d=json.load(open(sys.argv[1])); print(d.get("model",""))' "$DISPATCH_ACTIVE" 2>/dev/null || true)
    thinking=$(python3 -c 'import json, sys; d=json.load(open(sys.argv[1])); print(d.get("thinking",""))' "$DISPATCH_ACTIVE" 2>/dev/null || true)
    start_time=$(python3 -c 'import json, sys; d=json.load(open(sys.argv[1])); print(d.get("start_time",""))' "$DISPATCH_ACTIVE" 2>/dev/null || true)
    log_file=$(python3 -c 'import json, sys; d=json.load(open(sys.argv[1])); print(d.get("log_file",""))' "$DISPATCH_ACTIVE" 2>/dev/null || true)
    task=$(python3 -c 'import json, sys; d=json.load(open(sys.argv[1])); print(d.get("task",""))' "$DISPATCH_ACTIVE" 2>/dev/null || true)
  fi

  if [ -z "$pid" ] && [ -f "$DISPATCH_LOCK" ]; then
    IFS=: read -r pid bug_id tool model thinking start_time log_file < "$DISPATCH_LOCK" || true
  fi

  if [ -n "$pid" ]; then
    if kill -0 "$pid" 2>/dev/null; then
      local now; now=$(date +%s)
      local elapsed=$(( now - ${start_time:-$now} ))
      local mins=$(( elapsed / 60 ))
      local secs=$(( elapsed % 60 ))

      local current_activity="Investigating codebase..."
      local last_clean_lines=""
      if [ -n "$log_file" ] && [ -f "$log_file" ]; then
        last_clean_lines=$(sed -r 's/\x1B\[[0-9;]*[a-zA-Z]//g' "$log_file" 2>/dev/null | tr -d '\r' | grep -vE '^[[:space:]]*$' | tail -n 8 || true)
        local candidate
        candidate=$(printf '%s\n' "$last_clean_lines" | tail -n 1 | cut -c1-140)
        if [ -n "$candidate" ]; then
          current_activity="$candidate"
        fi
      fi

      echo "State: ACTIVE_RUNNING"
      echo "Agent: ${tool:-unknown} (Model: ${model:-default}, Thinking: ${thinking:-auto})"
      echo "Bug ID: ${bug_id:-N/A} (Category: ${category:-general})"
      echo "PID: $pid (Elapsed: ${mins}m ${secs}s)"
      echo "Log: ${log_file:-none}"
      echo "Task: ${task:-none}"
      echo "Current Activity: $current_activity"
      echo ""
      echo "Recent Log Tail:"
      printf '%s\n' "$last_clean_lines" | tail -n 5
      return 0
    else
      echo "State: STALE_LOCK"
      echo "Process PID $pid is not alive. Lock was held for $bug_id ($tool)."
      echo "Run '$0 stop' to release the lock."
      return 0
    fi
  fi

  echo "State: IDLE"
  echo "No coding agent is currently running."
  if [ -f "$AUDIT_LOG" ]; then
    local last_audit; last_audit=$(tail -n 1 "$AUDIT_LOG" 2>/dev/null || true)
    if [ -n "$last_audit" ]; then
      echo "Last Audit Entry: $last_audit"
    fi
  fi
}

stop_cmd() {
  echo "[Dispatcher] Processing stop request..."
  local pid="" bug_id="" tool="" log_file=""

  if [ -f "$DISPATCH_ACTIVE" ]; then
    pid=$(python3 -c 'import json, sys; d=json.load(open(sys.argv[1])); print(d.get("pid",""))' "$DISPATCH_ACTIVE" 2>/dev/null || true)
    bug_id=$(python3 -c 'import json, sys; d=json.load(open(sys.argv[1])); print(d.get("bug_id",""))' "$DISPATCH_ACTIVE" 2>/dev/null || true)
    tool=$(python3 -c 'import json, sys; d=json.load(open(sys.argv[1])); print(d.get("tool",""))' "$DISPATCH_ACTIVE" 2>/dev/null || true)
  fi

  if [ -z "$pid" ] && [ -f "$DISPATCH_LOCK" ]; then
    IFS=: read -r pid bug_id tool _ < "$DISPATCH_LOCK" || true
  fi

  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
    echo "[Dispatcher] Terminating agent '$tool' (PID $pid) for $bug_id..."
    kill -TERM -"$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true
    pkill -P "$pid" 2>/dev/null || true
    sleep 1.5

    if kill -0 "$pid" 2>/dev/null; then
      echo "[Dispatcher] Process $pid did not exit after SIGTERM, sending SIGKILL..."
      kill -KILL -"$pid" 2>/dev/null || kill -KILL "$pid" 2>/dev/null || true
      pkill -9 -P "$pid" 2>/dev/null || true
    fi
  fi

  # Terminate common background tools if lingering
  pkill -f "opencode run" 2>/dev/null || true
  pkill -f "cline --auto-approve" 2>/dev/null || true
  pkill -f "grok -p" 2>/dev/null || true

  # Remove lock files
  local had_lock=0
  if [ -f "$DISPATCH_LOCK" ] || [ -f "$DISPATCH_ACTIVE" ]; then
    had_lock=1
  fi
  rm -f "$DISPATCH_LOCK" "$DISPATCH_ACTIVE" 2>/dev/null || true

  # Revert source changes if an active coder was running
  if [ "$had_lock" -eq 1 ] && [ -n "$pid" ]; then
    cd "$REPO_DIR"
    git checkout -- src/ 2>/dev/null || true
  fi

  # Notify Telegram
  if [ -n "$tool" ] && [ -n "$bug_id" ]; then
    bash "$TELEGRAM_SCRIPT" --profile="${HERMES_PROFILE:-orchestrator}" \
      --text="🛑 *[Orchestrator]* Stopped agent '*$tool*' on \`$bug_id\`.
• Process terminated (PID $pid).
• Workspace uncommitted source changes reverted to clean \`main\`.
• No further fallback agent will be started." 2>/dev/null || true
  fi

  echo "[Dispatcher] Stopped successfully. Lock released."
}

case "$SUBCOMMAND" in
  status)
    status_cmd
    exit 0
    ;;
  stop|cancel)
    stop_cmd
    exit 0
    ;;
  list-models|models)
    shift
    node "${REPO_DIR}/scripts/tool-allowance.mjs" list-models "$@"
    exit 0
    ;;
  list-agents|agents)
    shift
    node "${REPO_DIR}/scripts/tool-allowance.mjs" list-agents "$@"
    exit 0
    ;;
esac

# ---------------------------------------------------------------
# Argument Parsing for Dispatch
# ---------------------------------------------------------------
TASK=""
BUG_ID="BUG-UNKNOWN"
CATEGORY="general"
REQUESTED_TOOL="auto"
PREFERRED_MODEL="deepseek-v4.1-flash"
THINKING="auto"
SCREENSHOT=""
DISPATCH_PROFILE="${HERMES_PROFILE:-orchestrator}"
CASCADE=0

PREFER_VERIFY="auto"
FOREGROUND=0
PRINT_PLAN=0

for arg in "$@"; do
  case $arg in
    --help|-h)
      echo "Usage: $0 --task='description' [--bug-id='...'] [--category='...'] [--tool=auto|opencode|cline|grok|agy] [--model=...] [--thinking=high|low|none|auto] [--cascade] [--screenshot='/path/to/img.png'] [--verify=true|false|auto] [--profile=orchestrator] [--foreground] [--print-plan]"
      echo ""
      echo "Subcommands:"
      echo "  $0 status                     Check live running agent activity"
      echo "  $0 stop                       Cleanly stop running agent and release lock"
      echo "  $0 list-models                List available tools, models, and thinking modes"
      echo "  $0 list-agents                List agent pool status"
      exit 0
      ;;
    --task=*)       TASK="${arg#*=}" ;;
    --bug-id=*)     BUG_ID="${arg#*=}" ;;
    --category=*)   CATEGORY="${arg#*=}" ;;
    --tool=*)       REQUESTED_TOOL="${arg#*=}" ;;
    --model=*)      PREFERRED_MODEL="${arg#*=}" ;;
    --thinking=*)   THINKING="${arg#*=}" ;;
    --screenshot=*) SCREENSHOT="${arg#*=}" ;;
    --cascade)      CASCADE=1 ;;
    --verify=*)     PREFER_VERIFY="${arg#*=}" ;;
    --profile=*)    DISPATCH_PROFILE="${arg#*=}" ;;
    --foreground)   FOREGROUND=1 ;;
    --print-plan)   PRINT_PLAN=1 ;;
    *)
      if [ -z "$TASK" ]; then TASK="$arg"; fi
      ;;
  esac
done

if [ -z "$TASK" ]; then
  echo "Error: No task provided. Usage: $0 --task='description' [--bug-id='...'] [--category='...']"
  exit 1
fi

# Dynamic Thinking Tuning (V-29): atomic UI/text fixes use low thinking to avoid overthinking loops
if [ "$THINKING" = "auto" ] || [ -z "$THINKING" ]; then
  if echo "$TASK" | grep -qiE "format|round|float|toFixed|typo|color|css|style|text|spacing|padding|margin|label"; then
    THINKING="low"
  else
    THINKING="high"
  fi
fi

opencode_model_id() {
  local model="$1"
  case "$model" in
    */*) printf '%s\n' "$model" ;;
    *) printf 'opencode/%s\n' "$model" ;;
  esac
}

qa_profile_for_category() {
  case "$CATEGORY" in
    biomarker) printf 'qa_biomarker\n' ;;
    onboarding) printf 'qa_onboarding\n' ;;
    *) printf 'qa_meal\n' ;;
  esac
}

if [ "$PRINT_PLAN" = "1" ]; then
  echo "tool=${REQUESTED_TOOL}"
  echo "model=${PREFERRED_MODEL}"
  echo "thinking=${THINKING}"
  echo "cascade=${CASCADE}"
  echo "qa_profile=$(qa_profile_for_category)"
  if [ "$REQUESTED_TOOL" = "opencode" ] || [ "$REQUESTED_TOOL" = "auto" ]; then
    echo "opencode_argv=opencode run --auto --dir ${REPO_DIR} -m $(opencode_model_id "$PREFERRED_MODEL") <prompt>"
  fi
  exit 0
fi

# Leave the Hermes tool call immediately. A 30s tool timeout used to kill the coder
# mid-typecheck. setsid starts a new session so that kill does not reach the child.
if [ "$FOREGROUND" != "1" ] && [ "${DISPATCH_FOREGROUND:-}" != "1" ]; then
  child_log="${HERMES_DIR}/logs/dispatch_${BUG_ID}_${REQUESTED_TOOL}.log"
  echo "[Dispatcher] Detaching ${BUG_ID} (${REQUESTED_TOOL}/${PREFERRED_MODEL}) to ${child_log}"
  env DISPATCH_FOREGROUND=1 setsid nohup bash "$0" "$@" </dev/null >>"$child_log" 2>&1 &
  CHILD_PID=$!
  echo "[Dispatcher] Background pid ${CHILD_PID} — agent ${REQUESTED_TOOL} working on ${BUG_ID}."
  exit 0
fi

# ---------------------------------------------------------------
# Heartbeat & Lock Cleanup Trap (V-23, V-24)
# ---------------------------------------------------------------
stop_heartbeat() {
  if [ -n "${HEARTBEAT_PID:-}" ]; then
    kill "$HEARTBEAT_PID" 2>/dev/null || true
    wait "$HEARTBEAT_PID" 2>/dev/null || true
    HEARTBEAT_PID=""
  fi
}

WE_OWN_LOCK=0
cleanup_dispatch() {
  stop_heartbeat
  if [ "$WE_OWN_LOCK" != "1" ]; then
    return 0
  fi
  local info=""
  info=$(cat "$DISPATCH_LOCK" 2>/dev/null || true)
  case "$info" in
    "$$:"*)
      rm -f "$DISPATCH_LOCK" "$DISPATCH_ACTIVE" 2>/dev/null || true
      ;;
  esac
}
trap cleanup_dispatch EXIT INT TERM

lock_holder_alive() {
  local info pid
  info=$(cat "$DISPATCH_LOCK" 2>/dev/null || true)
  pid=$(printf '%s\n' "$info" | cut -d: -f1)
  [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null
}

waited=0
while lock_holder_alive; do
  LOCKED_INFO=$(cat "$DISPATCH_LOCK" 2>/dev/null || true)
  LOCKED_PID=$(printf '%s\n' "$LOCKED_INFO" | cut -d: -f1)
  LOCKED_BUG=$(printf '%s\n' "$LOCKED_INFO" | cut -d: -f2)
  if [ "$waited" -eq 0 ]; then
    echo "[Dispatcher] Concurrency lock: PID $LOCKED_PID is active on $LOCKED_BUG. Waiting."
    bash "$TELEGRAM_SCRIPT" --profile="$DISPATCH_PROFILE" --text="⚠️ *[Orchestrator]* \`$BUG_ID\` is waiting. \`$LOCKED_BUG\` (PID \`$LOCKED_PID\`) still has the repo." 2>/dev/null || true
  fi
  if [ "$waited" -ge 180 ]; then
    echo "[Dispatcher] Lock still held after 180s."
    bash "$TELEGRAM_SCRIPT" --profile="$DISPATCH_PROFILE" --text="⚠️ *[Orchestrator]* \`$BUG_ID\` did not start. \`$LOCKED_BUG\` (PID \`$LOCKED_PID\`) still has the repo." 2>/dev/null || true
    exit 1
  fi
  sleep 10
  waited=$((waited + 10))
done

START_TIME=$(date +%s)
CURRENT_LOG="${HERMES_DIR}/logs/dispatch_${BUG_ID}_${REQUESTED_TOOL}.log"

echo "$$:${BUG_ID}:${REQUESTED_TOOL}:${PREFERRED_MODEL}:${THINKING}:${START_TIME}:${CURRENT_LOG}" > "$DISPATCH_LOCK"
cat <<JSON > "$DISPATCH_ACTIVE"
{
  "pid": $$,
  "bug_id": "${BUG_ID}",
  "category": "${CATEGORY}",
  "tool": "${REQUESTED_TOOL}",
  "model": "${PREFERRED_MODEL}",
  "thinking": "${THINKING}",
  "start_time": ${START_TIME},
  "log_file": "${CURRENT_LOG}",
  "task": $(python3 -c 'import json, sys; print(json.dumps(sys.argv[1]))' "$TASK")
}
JSON
WE_OWN_LOCK=1

# Executable search paths
OPENCODE_BIN=$(which opencode 2>/dev/null || echo "${HOME}/.opencode/bin/opencode")
CLINE_BIN=$(which cline 2>/dev/null || echo "${HOME}/.local/bin/cline")
GROK_BIN=$(which grok 2>/dev/null || echo "${HOME}/.grok/bin/grok")
AGY_BIN=$(which agy 2>/dev/null || echo "${HOME}/.local/bin/agy")

# ---------------------------------------------------------------
# Telegram helper — always non-blocking, never fails the dispatch
# ---------------------------------------------------------------
tg_msg() {
  local text="$1"
  local photo="${2:-}"
  if [ -n "$photo" ] && [ -f "$photo" ]; then
    bash "$TELEGRAM_SCRIPT" --profile="$DISPATCH_PROFILE" --photo="$photo" --caption="$text" 2>/dev/null || true
  else
    bash "$TELEGRAM_SCRIPT" --profile="$DISPATCH_PROFILE" --text="$text" 2>/dev/null || true
  fi
}

tg_qa() {
  local text="$1"
  local photo="${2:-}"
  local prof
  prof=$(qa_profile_for_category)
  if [ -n "$photo" ] && [ -f "$photo" ]; then
    bash "$TELEGRAM_SCRIPT" --profile="$prof" --photo="$photo" --caption="$text" 2>/dev/null || true
  else
    bash "$TELEGRAM_SCRIPT" --profile="$prof" --text="$text" 2>/dev/null || true
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
  local log_file="${2:-}"
  local interval_secs="${3:-120}"   # 2 min default
  (
    # Continuous typing action loop in background to display 3 loading dots in Telegram chat header
    (
      while true; do
        bash "$TELEGRAM_SCRIPT" --profile="$DISPATCH_PROFILE" --action="typing" >/dev/null 2>&1 || true
        sleep 4
      done
    ) &
    local TYPING_PID=$!
    trap "kill $TYPING_PID 2>/dev/null || true" EXIT INT TERM

    while true; do
      sleep "$interval_secs"
      local current_activity="analyzing codebase..."
      if [ -n "$log_file" ] && [ -f "$log_file" ]; then
        local last_line
        last_line=$(grep -vE '^[[:space:]]*$' "$log_file" 2>/dev/null | tr -d '\r`' | tail -n 1 | cut -c1-120 || true)
        if [ -n "$last_line" ]; then
          current_activity="$last_line"
        fi
      fi
      tg_msg "⏳ *[Orchestrator]* Agent '$tool_name' working on \`$BUG_ID\`... ($(( ($(date +%s) - START_TIME) / 60 ))m elapsed)
• *Status:* \`$current_activity\`"
    done
  ) &
  HEARTBEAT_PID=$!
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
SNAP_FILE=""
snapshot_workspace() {
  rm -f "${SNAP_FILE:-}"
  SNAP_FILE=$(mktemp)
  git status --porcelain | grep -v 'src/git-version.generated.ts' > "$SNAP_FILE" || true
}

# Lines that appeared after snapshot_workspace. Pre-existing dirt does not count.
new_changes() {
  local now
  now=$(mktemp)
  git status --porcelain | grep -v 'src/git-version.generated.ts' > "$now" || true
  if [ -n "$SNAP_FILE" ] && [ -f "$SNAP_FILE" ]; then
    comm -13 <(sort "$SNAP_FILE") <(sort "$now") || true
  else
    cat "$now" || true
  fi
  rm -f "$now"
}

commit_fix() {
  local msg="$1"
  if git config user.email >/dev/null 2>&1; then
    git commit -m "$msg"
  else
    GIT_AUTHOR_NAME="${GIT_AUTHOR_NAME:-cwahli}" \
    GIT_AUTHOR_EMAIL="${GIT_AUTHOR_EMAIL:-cwahli@users.noreply.github.com}" \
    GIT_COMMITTER_NAME="${GIT_COMMITTER_NAME:-cwahli}" \
    GIT_COMMITTER_EMAIL="${GIT_COMMITTER_EMAIL:-cwahli@users.noreply.github.com}" \
    git commit -m "$msg"
  fi
}

check_git_and_tsc() {
  local tool_name="$1" model_desc="$2" log_file="${3:-}"
  echo "[Dispatcher] Verifying $tool_name changes with tsc..."

  local diff_files diff_count
  diff_files=$(new_changes)
  diff_count=$(printf '%s\n' "$diff_files" | grep -c '[^[:space:]]' || true)

  if [ "$diff_count" -eq 0 ]; then
    echo "[Dispatcher] No code changes produced by $tool_name."
    local tail_output=""
    local reason="Halted with 0 code changes"
    if [ -n "$log_file" ] && [ -f "$log_file" ]; then
      if grep -qiE "insufficient account funds|insufficient funds|out of credits" "$log_file"; then
        reason="Account funds exhausted ($0 balance)"
      elif grep -qiE "user location is not supported|location is not supported" "$log_file"; then
        reason="Location blocked (Gemini API unavailable in VPS datacenter region)"
      elif grep -qiE "abort|aborted" "$log_file"; then
        reason="Agent aborted execution (detected conflict with tests or invariants)"
      elif grep -qiE "timed out|timeout" "$log_file"; then
        reason="Execution timed out without making file edits"
      fi
      tail_output=$(tail -n 6 "$log_file" | tr -d '`' | cut -c1-300)
    fi
    tg_msg "⚠️ *[Orchestrator]* *$tool_name* produced *0 code changes*.
• *Root Cause:* $reason
*Agent output tail:*
\`\`\`
${tail_output:-No output logged}
\`\`\`"
    return 1
  fi

  tg_msg "📝 *[Orchestrator]* Code modified by *$tool_name*:
\`\`\`
$(printf '%s\n' "$diff_files" | head -10)
\`\`\`
Running TypeScript build check ('npx tsc --noEmit')..."

  local tsc_output
  if tsc_output=$(npx tsc --noEmit 2>&1); then
    echo "[Dispatcher] tsc clean — committing real changes..."
    local line path
    while IFS= read -r line; do
      [ -z "$line" ] && continue
      path="${line:3}"
      [ -n "$path" ] && git add -- "$path" || true
    done <<< "$diff_files"
    if ! commit_fix "fix($CATEGORY): $BUG_ID via $tool_name ($model_desc)"; then
      echo "[Dispatcher] git commit failed."
      tg_msg "⚠️ *[Orchestrator]* *$tool_name* edited files for \`$BUG_ID\`, but \`git commit\` failed."
      return 1
    fi
    if ! git push origin main; then
      echo "[Dispatcher] Error: git push origin main failed."
      tg_msg "⚠️ *[Orchestrator]* Fix coded by *$tool_name*, but \`git push origin main\` failed. Check GitHub credentials on VPS (SSH key or PAT)."
      return 1
    fi
    local commit_hash
    commit_hash=$(git rev-parse --short HEAD)
    tg_msg "🚀 *[Orchestrator]* Fix committed and pushed to \`main\` (\`$commit_hash\`)."
    node scripts/tool-allowance.mjs report-result --tool="$tool_name" --status="success" --bug-id="$BUG_ID" --category="$CATEGORY" --duration=$(( $(date +%s) - START_TIME )) || true
    record_audit "$tool_name" "$model_desc" "resolved" "deployed_pending_qa"
    snapshot_workspace
    return 0
  else
    echo "[Dispatcher] tsc failed after $tool_name."
    local tsc_tail
    tsc_tail=$(printf '%s\n' "$tsc_output" | head -n 6 | tr -d '`' | cut -c1-300)
    tg_msg "❌ *[Orchestrator]* TypeScript compilation failed after *$tool_name*:
\`\`\`
${tsc_tail:-no compiler output}
\`\`\`
Reverting this attempt's uncommitted changes..."
    clean_workspace
    return 1
  fi
}

clean_workspace() {
  local line path
  while IFS= read -r line; do
    [ -z "$line" ] && continue
    path="${line:3}"
    [ -z "$path" ] && continue
    case "$line" in
      \?\?*) rm -rf -- "$path" ;;
      *) git checkout -- "$path" >/dev/null 2>&1 || true ;;
    esac
  done < <(new_changes)
  snapshot_workspace
}

# ---------------------------------------------------------------
# Build full task prompt including screenshot reference & hints
# ---------------------------------------------------------------
build_prompt() {
  local base_prompt="Task for $BUG_ID ($CATEGORY): $TASK"

  # Filter screenshot for pure text/numeric formatting tasks to prevent visual over-analysis loops
  local is_text_or_format=0
  if echo "$TASK" | grep -qiE "format|round|float|toFixed|typo|number|decimal|unit|omega"; then
    is_text_or_format=1
  fi

  if [ -n "$SCREENSHOT" ] && [ -f "$SCREENSHOT" ] && [ "$is_text_or_format" -eq 0 ]; then
    base_prompt="${base_prompt}. The bug screenshot is at: ${SCREENSHOT} — inspect it to understand the visual defect."
  fi

  # Invariant Guard (prevents test breakage and coder abort loops)
  base_prompt="${base_prompt}

[CRITICAL CODEBASE INVARIANTS]:
- Never delete or disable active features ('Health status', 'Clinical Actions', 'Daily Benefits').
- Never rename or delete navigation locators (e.g. '#nav-tab-health', '#nav-tab-food', '#nav-tab-home') which are required by Playwright tests.
- Scope changes strictly to the single defect described. Do not rewrite unrelated components."

  # Target File Hints
  if echo "$TASK" | grep -qiE "theme|dark|navy|#0f172a|#f8fafc|background|color"; then
    base_prompt="${base_prompt}
[TARGET FILE HINTS]:
- Root CSS variables & theme classes: 'src/index.css' (check --app-bg definition and dark class).
- Dynamic styles injector: 'src/components/AppDynamicStyles.ts' (check root theme palette injection).
- Shell / container: 'src/components/AppShell.tsx' (check root element background styling).
Ensure the root page background renders the dark theme navy (#0f172a) properly for demo / dark mode users."
  elif echo "$TASK" | grep -qiE "omega|omega-3|nutrition|target|card|macro|gram|float|format|decimal"; then
    base_prompt="${base_prompt}
[TARGET FILE HINTS]:
- Weekly nutrition target card: 'src/components/WeeklyNutritionCard.tsx' or 'src/components/NutritionTargetCard.tsx'.
- Macro summary & formatting: 'src/components/MacroSummary.tsx'.
- Format numeric targets using .toFixed(1) or Math.round to eliminate floating-point precision artifacts (e.g. 7.700000000000001g -> 7.7g)."
  fi

  if [ "$THINKING" = "low" ]; then
    base_prompt="${base_prompt}
Make a minimal, single-file atomic change. Verify with npx tsc --noEmit before finishing."
  else
    base_prompt="${base_prompt}
Think carefully before modifying files. Verify with npx tsc --noEmit before finishing."
  fi

  echo "$base_prompt"
}

# ---------------------------------------------------------------
# TOOL FUNCTIONS
# ---------------------------------------------------------------

run_opencode_agent() {
  local prompt="$1" log_file="$2" duration="$3" model="$4"
  local model_id
  model_id=$(opencode_model_id "$model")
  snapshot_workspace
  echo "[Dispatcher] opencode run --auto --dir ${REPO_DIR} -m ${model_id}"
  run_with_timeout "$duration" "$OPENCODE_BIN" run --auto --dir "$REPO_DIR" -m "$model_id" "$prompt" 2>&1 | tee "$log_file" || true
}

try_opencode() {
  local model="${1:-$PREFERRED_MODEL}"
  echo "[Dispatcher] --> OpenCode (Model: $model)"
  if [ ! -x "$OPENCODE_BIN" ]; then
    echo "[Dispatcher] OpenCode not executable at $OPENCODE_BIN, skipping."
    tg_msg "⚠️ *[Orchestrator]* OpenCode binary not found or not executable."
    return 1
  fi

  local prompt; prompt="$(build_prompt)"
  local log_dir="${HERMES_DIR}/logs"
  mkdir -p "$log_dir"
  local log_file="${log_dir}/dispatch_${BUG_ID}_opencode.log"
  local prompt_preview
  prompt_preview=$(echo "$prompt" | head -n 8 | tr -d '`' | cut -c1-350)

  tg_msg "🤖 *[Orchestrator]* Dispatching to *OpenCode* ($model) for \`$BUG_ID\`...
⏳ *Status:* Waiting for response from Agent OpenCode...

📋 *Task:* $TASK
📁 *Log:* \`$log_file\`

💡 *Instruction Prompt:*
\`\`\`
$prompt_preview
\`\`\`"

  start_heartbeat "OpenCode" "$log_file"
  run_opencode_agent "$prompt" "$log_file" 8m "$model"
  stop_heartbeat

  local output; output=$(cat "$log_file" 2>/dev/null || true)

  if echo "$output" | grep -qiE "insufficient account funds|insufficient funds|out of credits"; then
    node scripts/tool-allowance.mjs report-result --tool="opencode" --status="depleted" --bug-id="$BUG_ID" --reason="Insufficient account funds" || true
    clean_workspace
    if [ "$model" != "deepseek-v4.1-flash" ]; then
      tg_msg "⚠️ *[Orchestrator]* OpenCode hit insufficient funds on \`$model\`. Retrying once with \`opencode/deepseek-v4.1-flash\`..."
      local alt_model="deepseek-v4.1-flash"
      local alt_log="${log_dir}/dispatch_${BUG_ID}_opencode_deepseek.log"
      start_heartbeat "OpenCode (deepseek)" "$alt_log"
      run_opencode_agent "$prompt" "$alt_log" 8m "$alt_model"
      stop_heartbeat
      if check_git_and_tsc "opencode" "$alt_model" "$alt_log"; then return 0; fi
    fi
    if [ "$CASCADE" -eq 1 ]; then
      tg_msg "❌ *[Orchestrator]* OpenCode could not resolve \`$BUG_ID\` (funds depleted). Escalating to Cline..."
    else
      tg_msg "❌ *[Orchestrator]* OpenCode could not resolve \`$BUG_ID\` (funds depleted)."
    fi
    clean_workspace
    node scripts/tool-allowance.mjs report-result --tool="opencode" --status="failed" --bug-id="$BUG_ID" || true
    return 1
  fi

  if echo "$output" | grep -qiE "rate limit|quota exceeded|insufficient credits|429|allowance"; then
    tg_msg "⚠️ *[Orchestrator]* OpenCode hit rate limit for \`$BUG_ID\`."
    node scripts/tool-allowance.mjs report-result --tool="opencode" --status="rate_limited" --bug-id="$BUG_ID" --reason="Rate limit" || true
    clean_workspace
    return 2
  fi

  if check_git_and_tsc "opencode" "$model" "$log_file"; then return 0; fi

  # One nudge attempt
  tg_msg "🔄 *[Orchestrator]* OpenCode nudged to retry \`$BUG_ID\`..."
  local nudge_log="${log_dir}/dispatch_${BUG_ID}_opencode_nudge.log"
  start_heartbeat "OpenCode (nudge)" "$nudge_log"
  run_opencode_agent "Previous attempt for $BUG_ID had errors or no changes. Inspect git status, analyze errors, and complete the fix now." "$nudge_log" 4m "$model"
  stop_heartbeat
  if check_git_and_tsc "opencode" "$model" "$nudge_log"; then return 0; fi

  if [ "$CASCADE" -eq 1 ]; then
    tg_msg "❌ *[Orchestrator]* OpenCode could not resolve \`$BUG_ID\`. Escalating to Cline..."
  else
    tg_msg "❌ *[Orchestrator]* OpenCode could not resolve \`$BUG_ID\`."
  fi
  clean_workspace
  node scripts/tool-allowance.mjs report-result --tool="opencode" --status="failed" --bug-id="$BUG_ID" || true
  return 1
}

try_cline() {
  local thinking="${THINKING:-high}"
  echo "[Dispatcher] --> Cline CLI (Thinking: $thinking)"
  if [ ! -x "$CLINE_BIN" ]; then
    echo "[Dispatcher] Cline not executable at $CLINE_BIN, skipping."
    tg_msg "⚠️ *[Orchestrator]* Cline CLI is not installed on this system."
    return 1
  fi

  local prompt; prompt="$(build_prompt)"
  local log_dir="${HERMES_DIR}/logs"
  mkdir -p "$log_dir"
  local log_file="${log_dir}/dispatch_${BUG_ID}_cline.log"
  local prompt_preview
  prompt_preview=$(echo "$prompt" | head -n 8 | tr -d '`' | cut -c1-350)

  tg_msg "🤖 *[Orchestrator]* Dispatching to *Cline CLI* (thinking=$thinking) for \`$BUG_ID\`...
⏳ *Status:* Waiting for response from Agent Cline...

📋 *Task:* $TASK
📁 *Log:* \`$log_file\`

💡 *Instruction Prompt:*
\`\`\`
$prompt_preview
\`\`\`"

  snapshot_workspace
  start_heartbeat "Cline" "$log_file"
  run_with_timeout 8m "$CLINE_BIN" --auto-approve true --thinking "$thinking" "$prompt" 2>&1 | tee "$log_file" || true
  stop_heartbeat

  local output; output=$(cat "$log_file" 2>/dev/null || true)

  if echo "$output" | grep -qiE "rate limit|quota exceeded|insufficient credits|429|exhausted|allowance"; then
    tg_msg "⚠️ *[Orchestrator]* Cline hit rate limit for \`$BUG_ID\`."
    node scripts/tool-allowance.mjs report-result --tool="cline" --status="rate_limited" --bug-id="$BUG_ID" --reason="Rate limit" || true
    clean_workspace
    return 2
  fi

  if check_git_and_tsc "cline" "DeepSeek/thinking=$thinking" "$log_file"; then return 0; fi

  if [ "$CASCADE" -eq 1 ]; then
    tg_msg "❌ *[Orchestrator]* Cline could not resolve \`$BUG_ID\`. Escalating to Grok..."
  else
    tg_msg "❌ *[Orchestrator]* Cline could not resolve \`$BUG_ID\`."
  fi
  clean_workspace
  node scripts/tool-allowance.mjs report-result --tool="cline" --status="failed" --bug-id="$BUG_ID" || true
  return 1
}

try_grok() {
  echo "[Dispatcher] --> Grok Build CLI"
  if [ ! -x "$GROK_BIN" ]; then
    echo "[Dispatcher] Grok not executable at $GROK_BIN, skipping."
    tg_msg "⚠️ *[Orchestrator]* Grok Build CLI is not installed on this system."
    return 1
  fi

  local prompt; prompt="$(build_prompt)"
  local log_dir="${HERMES_DIR}/logs"
  mkdir -p "$log_dir"
  local log_file="${log_dir}/dispatch_${BUG_ID}_grok.log"
  local prompt_preview
  prompt_preview=$(echo "$prompt" | head -n 8 | tr -d '`' | cut -c1-350)

  tg_msg "🤖 *[Orchestrator]* Dispatching to *Grok Build* for \`$BUG_ID\`...
⏳ *Status:* Waiting for response from Agent Grok...

📋 *Task:* $TASK
📁 *Log:* \`$log_file\`

💡 *Instruction Prompt:*
\`\`\`
$prompt_preview
\`\`\`"

  snapshot_workspace
  start_heartbeat "Grok" "$log_file"
  run_with_timeout 6m "$GROK_BIN" -p "$prompt" 2>&1 | tee "$log_file" || true
  stop_heartbeat

  local output; output=$(cat "$log_file" 2>/dev/null || true)

  if echo "$output" | grep -qiE "rate limit|quota exceeded|429"; then
    if [ "$CASCADE" -eq 1 ]; then
      tg_msg "⚠️ *[Orchestrator]* Grok hit rate limit for \`$BUG_ID\`. Trying Agy..."
    else
      tg_msg "⚠️ *[Orchestrator]* Grok hit rate limit for \`$BUG_ID\`."
    fi
    node scripts/tool-allowance.mjs report-result --tool="grok" --status="rate_limited" --bug-id="$BUG_ID" || true
    clean_workspace
    return 2
  fi

  if check_git_and_tsc "grok" "grok-build" "$log_file"; then return 0; fi

  if [ "$CASCADE" -eq 1 ]; then
    tg_msg "❌ *[Orchestrator]* Grok could not resolve \`$BUG_ID\`. Trying Agy..."
  else
    tg_msg "❌ *[Orchestrator]* Grok could not resolve \`$BUG_ID\`."
  fi
  clean_workspace
  node scripts/tool-allowance.mjs report-result --tool="grok" --status="failed" --bug-id="$BUG_ID" || true
  return 1
}

try_agy() {
  echo "[Dispatcher] --> Antigravity CLI"
  if [ ! -x "$AGY_BIN" ]; then
    echo "[Dispatcher] Antigravity CLI not executable at $AGY_BIN, skipping."
    tg_msg "⚠️ *[Orchestrator]* Antigravity CLI not found or executable."
    return 1
  fi

  if node scripts/tool-allowance.mjs status 2>/dev/null | grep -i 'Antigravity' | grep -qi 'unavailable'; then
    echo "[Dispatcher] Antigravity CLI is marked unavailable on VPS. Skipping."
    tg_msg "⏭️ *[Orchestrator]* Skipping *Antigravity CLI* (marked unavailable on VPS datacenter IP)."
    return 1
  fi

  local prompt; prompt="$(build_prompt)"
  local log_dir="${HERMES_DIR}/logs"
  mkdir -p "$log_dir"
  local log_file="${log_dir}/dispatch_${BUG_ID}_agy.log"
  local prompt_preview
  prompt_preview=$(echo "$prompt" | head -n 8 | tr -d '`' | cut -c1-350)

  tg_msg "🤖 *[Orchestrator]* Dispatching to *Antigravity CLI* for \`$BUG_ID\`...
⏳ *Status:* Waiting for response from Agent Antigravity...

📋 *Task:* $TASK
📁 *Log:* \`$log_file\`

💡 *Instruction Prompt:*
\`\`\`
$prompt_preview
\`\`\`"

  snapshot_workspace
  start_heartbeat "Agy" "$log_file"
  run_with_timeout 8m "$AGY_BIN" -p "$prompt" 2>&1 | tee "$log_file" || true
  stop_heartbeat

  local output; output=$(cat "$log_file" 2>/dev/null || true)

  if check_git_and_tsc "agy" "antigravity" "$log_file"; then return 0; fi

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
if [ "$CASCADE" -eq 1 ]; then
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
else
  # Granular Single-Tool Execution Mode (Default)
  if [ "$REQUESTED_TOOL" = "auto" ]; then
    BEST_TOOL=$(node scripts/tool-allowance.mjs pick-tool --category="$CATEGORY" 2>/dev/null | grep '"tool":' | head -n1 | cut -d '"' -f4)
    if [ "$BEST_TOOL" = "none" ]; then
      tg_msg "🚨 *[Orchestrator]* No available tools in agent pool for \`$BUG_ID\`."
      exit 1
    fi
    TOOL_SEQUENCE+=("$BEST_TOOL")
  else
    TOOL_SEQUENCE+=("$REQUESTED_TOOL")
  fi
fi

echo "[Dispatcher] Execution sequence: ${TOOL_SEQUENCE[*]}"

qa_failure_summary() {
  local report
  report=$(ls -t "${REPO_DIR}/qa-evidence/bug_${CATEGORY}_"*.json 2>/dev/null | head -n1 || true)
  if [ -z "$report" ] || [ ! -f "$report" ]; then
    printf 'QA runner failed without a bug report.\n'
    return 0
  fi
  python3 - "$report" <<'PY'
import json, sys
data = json.load(open(sys.argv[1]))
title = str(data.get("title") or "QA failed").replace("`", "")
fix = str(data.get("suggested_fix") or "").replace("`", "")
print(f"{title}. {fix}".strip())
PY
}

verify_live_resolution() {
  local tool_resolved="$1"
  local should_verify=false

  if [ "$PREFER_VERIFY" = "true" ]; then
    should_verify=true
  elif [ "$PREFER_VERIFY" = "auto" ]; then
    case "$CATEGORY" in
      meal|biomarker|onboarding) should_verify=true ;;
      *) should_verify=false ;;
    esac
  fi

  if [ "$should_verify" != "true" ] || [ ! -f "${REPO_DIR}/scripts/qa-runner.mjs" ]; then
    tg_msg "✅ *[Orchestrator]* \`$BUG_ID\` resolved by *$tool_resolved*!

Fix pushed to main. Awaiting CI/CD deploy (~45s)."
    return 0
  fi

  local qa_prof round failure_text clean_img bug_img
  qa_prof=$(qa_profile_for_category)
  round=0
  while [ "$round" -lt 2 ]; do
    tg_msg "✅ *[Orchestrator]* \`$BUG_ID\` is on \`main\` via *$tool_resolved*.
⏳ *Status:* Waiting ~45s for production rebuild & deploy... then ${qa_prof} will validate."
    tg_qa "⏳ *[${qa_prof}]* \`$BUG_ID\` was fixed by the Orchestrator. Waiting for live rebuild to complete before re-testing..."

    # Pulse Telegram typing indicator during deploy wait so 3 dots are shown
    (
      for i in $(seq 1 11); do
        bash "$TELEGRAM_SCRIPT" --profile="$DISPATCH_PROFILE" --action="typing" >/dev/null 2>&1 || true
        sleep 4
      done
    ) &
    local DEPLOY_WAIT_PID=$!
    sleep 45
    kill "$DEPLOY_WAIT_PID" 2>/dev/null || true

    tg_msg "🔎 *[Orchestrator]* Rebuild complete. Waiting for QA validation result from \`@${qa_prof}\`..."
    echo "[Dispatcher] QA validation round $((round + 1)) via ${qa_prof}"
    if node "${REPO_DIR}/scripts/qa-runner.mjs" --journey="${CATEGORY}"; then
      clean_img=$(ls -t "${REPO_DIR}/qa-evidence/clean_${CATEGORY}_"*.png 2>/dev/null | head -n1 || true)
      tg_msg "🎉 *[Orchestrator]* \`$BUG_ID\` passed ${qa_prof} validation."
      if [ -n "$clean_img" ] && [ -f "$clean_img" ]; then
        tg_qa "✅ *[${qa_prof}]* \`$BUG_ID\` passed the \`${CATEGORY}\` journey. No further fix." "$clean_img"
      else
        tg_qa "✅ *[${qa_prof}]* \`$BUG_ID\` passed the \`${CATEGORY}\` journey. No further fix."
      fi
      return 0
    fi

    failure_text=$(qa_failure_summary)
    bug_img=$(ls -t "${REPO_DIR}/qa-evidence/bug_${CATEGORY}_"*.png 2>/dev/null | head -n1 || true)
    round=$((round + 1))
    if [ "$round" -ge 2 ]; then
      tg_msg "⚠️ *[Orchestrator]* \`$BUG_ID\` still fails ${qa_prof} after a second fix.

${failure_text}"
      if [ -n "$bug_img" ] && [ -f "$bug_img" ]; then
        tg_qa "⚠️ *[${qa_prof}]* \`$BUG_ID\` still fails the \`${CATEGORY}\` journey after one additional fix. ${failure_text}" "$bug_img"
      else
        tg_qa "⚠️ *[${qa_prof}]* \`$BUG_ID\` still fails the \`${CATEGORY}\` journey after one additional fix. ${failure_text}"
      fi
      return 0
    fi

    tg_msg "🔄 *[Orchestrator]* ${qa_prof} rejected \`$BUG_ID\`. Applying one more fix.

${failure_text}"
    if [ -n "$bug_img" ] && [ -f "$bug_img" ]; then
      tg_qa "⚠️ *[${qa_prof}]* \`$BUG_ID\` failed validation. The Orchestrator is applying one more fix. ${failure_text}" "$bug_img"
    else
      tg_qa "⚠️ *[${qa_prof}]* \`$BUG_ID\` failed validation. The Orchestrator is applying one more fix. ${failure_text}"
    fi
    TASK="${TASK}

QA validation failed after deploy. Remaining failure: ${failure_text}. Fix that remaining defect and leave the rest of the app alone."
    if ! try_opencode "$PREFERRED_MODEL"; then
      tg_msg "❌ *[Orchestrator]* The additional fix for \`$BUG_ID\` did not land. ${qa_prof} still has the failure above."
      tg_qa "❌ *[${qa_prof}]* The Orchestrator could not land an additional fix for \`$BUG_ID\`. ${failure_text}"
      return 0
    fi
  done
}

for tool in "${TOOL_SEQUENCE[@]}"; do
  case $tool in
    opencode)
      if try_opencode "$PREFERRED_MODEL"; then
        verify_live_resolution "OpenCode"
        exit 0
      fi ;;
    cline)
      if try_cline; then
        verify_live_resolution "Cline CLI"
        exit 0
      fi ;;
    grok)
      if try_grok; then
        verify_live_resolution "Grok Build"
        exit 0
      fi ;;
    agy)
      if try_agy; then
        verify_live_resolution "Antigravity"
        exit 0
      fi ;;
    *) echo "[Dispatcher] Unknown tool: $tool, skipping." ;;
  esac
done

# Result handling
if [ "$CASCADE" -eq 1 ]; then
  record_audit "none" "none" "human" "escalated_human"
  tg_msg "🚨 *[Orchestrator]* All automated cascade agents exhausted for \`$BUG_ID\`.
*Agents tried:* ${TOOL_SEQUENCE[*]}
*Bug:* $TASK

Human intervention required. Please review the bug and assign manually."
  exit 1
else
  tg_msg "⚠️ *[Orchestrator]* Agent *${TOOL_SEQUENCE[0]}* did not resolve \`$BUG_ID\`.
Orchestrator awaiting next action or alternate model selection."
  exit 1
fi
