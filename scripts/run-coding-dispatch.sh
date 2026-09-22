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

TASK=""
BUG_ID="BUG-UNKNOWN"
CATEGORY="general"
REQUESTED_TOOL="auto"
PREFERRED_MODEL="muse-spark-1.3"
THINKING="high"
SCREENSHOT=""
DISPATCH_PROFILE="${HERMES_PROFILE:-orchestrator}"

PREFER_VERIFY="auto"
FOREGROUND=0
PRINT_PLAN=0

for arg in "$@"; do
  case $arg in
    --help|-h)
      echo "Usage: $0 --task='description' [--bug-id='...'] [--category='...'] [--tool=auto|cline|opencode|grok] [--screenshot='/path/to/img.png'] [--thinking=high|low|none] [--verify=true|false|auto] [--profile=orchestrator] [--foreground] [--print-plan]"
      exit 0
      ;;
    --task=*)    TASK="${arg#*=}" ;;
    --bug-id=*)  BUG_ID="${arg#*=}" ;;
    --category=*) CATEGORY="${arg#*=}" ;;
    --tool=*)    REQUESTED_TOOL="${arg#*=}" ;;
    --model=*)   PREFERRED_MODEL="${arg#*=}" ;;
    --thinking=*) THINKING="${arg#*=}" ;;
    --screenshot=*) SCREENSHOT="${arg#*=}" ;;
    --verify=*)  PREFER_VERIFY="${arg#*=}" ;;
    --profile=*) DISPATCH_PROFILE="${arg#*=}" ;;
    --foreground) FOREGROUND=1 ;;
    --print-plan) PRINT_PLAN=1 ;;
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
DISPATCH_LOCK="${HERMES_DIR}/dispatch_lock"
mkdir -p "$HERMES_DIR" "${HERMES_DIR}/logs"

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
  echo "opencode_model=$(opencode_model_id "$PREFERRED_MODEL")"
  echo "qa_profile=$(qa_profile_for_category)"
  echo "opencode_argv=opencode run --auto --dir ${REPO_DIR} -m $(opencode_model_id "$PREFERRED_MODEL") <prompt>"
  exit 0
fi

# Leave the Hermes tool call immediately. A 30s tool timeout used to kill the coder
# mid-typecheck. setsid starts a new session so that kill does not reach the child.
if [ "$FOREGROUND" != "1" ] && [ "${DISPATCH_FOREGROUND:-}" != "1" ]; then
  child_log="${HERMES_DIR}/logs/dispatch_${BUG_ID}.log"
  echo "[Dispatcher] Detaching ${BUG_ID} to ${child_log}"
  env DISPATCH_FOREGROUND=1 setsid nohup bash "$0" "$@" </dev/null >>"$child_log" 2>&1 &
  echo "[Dispatcher] Background pid $! — result returns to $(qa_profile_for_category) after the fix."
  exit 0
fi

# ---------------------------------------------------------------
# Heartbeat & Lock Cleanup Trap (V-23, V-24)
# Defined before the trap. An early exit used to call stop_heartbeat
# before this function existed, and the trap also deleted another process's lock.
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
    "$$:"*) rm -f "$DISPATCH_LOCK" 2>/dev/null || true ;;
  esac
}
trap cleanup_dispatch EXIT INT TERM

lock_holder_alive() {
  local info pid
  info=$(cat "$DISPATCH_LOCK" 2>/dev/null || true)
  pid=$(printf '%s\n' "$info" | cut -d: -f1)
  [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null
}

# The OpenCode chat bot holds this lock for one chat turn. Wait, then give up
# without deleting that lock.
waited=0
while lock_holder_alive; do
  LOCKED_INFO=$(cat "$DISPATCH_LOCK" 2>/dev/null || true)
  LOCKED_PID=$(printf '%s\n' "$LOCKED_INFO" | cut -d: -f1)
  LOCKED_BUG=$(printf '%s\n' "$LOCKED_INFO" | cut -d: -f2-)
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
echo "$$:${BUG_ID}" > "$DISPATCH_LOCK"
WE_OWN_LOCK=1

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
  local interval_secs="${2:-120}"   # 2 min default
  (
    while true; do
      sleep "$interval_secs"
      tg_msg "⏳ *[Orchestrator]* Agent '$tool_name' still working on \`$BUG_ID\`... ($(( ($(date +%s) - START_TIME) / 60 ))m elapsed)"
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
    if [ -n "$log_file" ] && [ -f "$log_file" ]; then
      tail_output=$(tail -n 6 "$log_file" | tr -d '`' | cut -c1-300)
    fi
    tg_msg "⚠️ *[Orchestrator]* *$tool_name* made *0 code changes*.
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
  if [ -n "$SCREENSHOT" ] && [ -f "$SCREENSHOT" ]; then
    base_prompt="${base_prompt}. The bug screenshot is at: ${SCREENSHOT} — inspect it to understand the visual defect."
  fi

  if echo "$TASK" | grep -qiE "theme|dark|navy|#0f172a|#f8fafc|background|color"; then
    base_prompt="${base_prompt}.
[TARGET FILE HINTS]:
- Root CSS variables & theme classes: 'src/index.css' (check --app-bg definition and dark class).
- Dynamic styles injector: 'src/components/AppDynamicStyles.ts' (check root theme palette injection).
- Shell / container: 'src/components/AppShell.tsx' (check root element background styling).
Ensure the root page background renders the dark theme navy (#0f172a) properly for demo / dark mode users."
  fi

  base_prompt="${base_prompt}. Think deeply before modifying files. Verify with npx tsc --noEmit before finishing."
  echo "$base_prompt"
}

# ---------------------------------------------------------------
# TOOL FUNCTIONS
# ---------------------------------------------------------------

run_opencode_agent() {
  local prompt="$1" log_file="$2" duration="$3"
  local model_id
  model_id=$(opencode_model_id "$PREFERRED_MODEL")
  snapshot_workspace
  echo "[Dispatcher] opencode run --auto --dir ${REPO_DIR} -m ${model_id}"
  run_with_timeout "$duration" "$OPENCODE_BIN" run --auto --dir "$REPO_DIR" -m "$model_id" "$prompt" 2>&1 | tee "$log_file" || true
}

try_opencode() {
  local model="$1"
  echo "[Dispatcher] --> OpenCode (Model: $model)"
  if [ ! -x "$OPENCODE_BIN" ]; then
    echo "[Dispatcher] OpenCode not executable at $OPENCODE_BIN, skipping."
    return 1
  fi

  local prompt; prompt="$(build_prompt)"
  local log_dir="${HERMES_DIR}/logs"
  mkdir -p "$log_dir"
  local log_file="${log_dir}/dispatch_${BUG_ID}_opencode.log"
  local prompt_preview
  prompt_preview=$(echo "$prompt" | head -n 8 | tr -d '`' | cut -c1-350)

  tg_msg "🤖 *[Orchestrator]* Dispatching to *OpenCode* ($model) for \`$BUG_ID\`

📋 *Task:* $TASK
📁 *Log:* \`$log_file\`

💡 *Instruction Prompt:*
\`\`\`
$prompt_preview
\`\`\`"

  start_heartbeat "OpenCode"
  run_opencode_agent "$prompt" "$log_file" 8m
  stop_heartbeat

  local output; output=$(cat "$log_file" 2>/dev/null || true)

  if echo "$output" | grep -qiE "rate limit|quota exceeded|insufficient credits|429|allowance"; then
    tg_msg "⚠️ *[Orchestrator]* OpenCode hit rate limit for \`$BUG_ID\`. Trying next tool..."
    node scripts/tool-allowance.mjs report-result --tool="opencode" --status="rate_limited" --bug-id="$BUG_ID" --reason="Rate limit" || true
    clean_workspace
    return 2
  fi

  if check_git_and_tsc "opencode" "$model" "$log_file"; then return 0; fi

  # One nudge attempt
  tg_msg "🔄 *[Orchestrator]* OpenCode nudged to retry \`$BUG_ID\`..."
  local nudge_log="${log_dir}/dispatch_${BUG_ID}_opencode_nudge.log"
  run_opencode_agent "Previous attempt for $BUG_ID had errors or no changes. Inspect git status, analyze errors, and complete the fix now." "$nudge_log" 4m
  if check_git_and_tsc "opencode" "$model" "$nudge_log"; then return 0; fi

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

  local prompt; prompt="$(build_prompt)"
  local log_dir="${HERMES_DIR}/logs"
  mkdir -p "$log_dir"
  local log_file="${log_dir}/dispatch_${BUG_ID}_cline.log"
  local prompt_preview
  prompt_preview=$(echo "$prompt" | head -n 8 | tr -d '`' | cut -c1-350)

  tg_msg "🤖 *[Orchestrator]* Dispatching to *Cline CLI* (thinking=$thinking) for \`$BUG_ID\`

📋 *Task:* $TASK
📁 *Log:* \`$log_file\`

💡 *Instruction Prompt:*
\`\`\`
$prompt_preview
\`\`\`"

  snapshot_workspace
  start_heartbeat "Cline"
  run_with_timeout 8m "$CLINE_BIN" --auto-approve true --thinking "$thinking" "$prompt" 2>&1 | tee "$log_file" || true
  stop_heartbeat

  local output; output=$(cat "$log_file" 2>/dev/null || true)

  if echo "$output" | grep -qiE "rate limit|quota exceeded|insufficient credits|429|exhausted|allowance"; then
    tg_msg "⚠️ *[Orchestrator]* Cline hit rate limit for \`$BUG_ID\`. Trying next tool..."
    node scripts/tool-allowance.mjs report-result --tool="cline" --status="rate_limited" --bug-id="$BUG_ID" --reason="Rate limit" || true
    clean_workspace
    return 2
  fi

  if check_git_and_tsc "cline" "DeepSeek/thinking=$thinking" "$log_file"; then return 0; fi

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

  local prompt; prompt="$(build_prompt) A lighter model was unable to resolve this — analyse the architecture deeply."
  local log_dir="${HERMES_DIR}/logs"
  mkdir -p "$log_dir"
  local log_file="${log_dir}/dispatch_${BUG_ID}_grok.log"
  local prompt_preview
  prompt_preview=$(echo "$prompt" | head -n 8 | tr -d '`' | cut -c1-350)

  tg_msg "🤖 *[Orchestrator]* Dispatching to *Grok Build* for \`$BUG_ID\`

📋 *Task:* $TASK
📁 *Log:* \`$log_file\`

💡 *Instruction Prompt:*
\`\`\`
$prompt_preview
\`\`\`"

  snapshot_workspace
  start_heartbeat "Grok"
  run_with_timeout 10m "$GROK_BIN" -p "$prompt" 2>&1 | tee "$log_file" || true
  stop_heartbeat

  local output; output=$(cat "$log_file" 2>/dev/null || true)

  if echo "$output" | grep -qiE "rate limit|quota exceeded|429"; then
    tg_msg "⚠️ *[Orchestrator]* Grok hit rate limit for \`$BUG_ID\`. Trying Agy..."
    node scripts/tool-allowance.mjs report-result --tool="grok" --status="rate_limited" --bug-id="$BUG_ID" || true
    clean_workspace
    return 2
  fi

  if check_git_and_tsc "grok" "grok-build" "$log_file"; then return 0; fi

  tg_msg "❌ *[Orchestrator]* Grok could not resolve \`$BUG_ID\`. Trying Agy..."
  clean_workspace
  node scripts/tool-allowance.mjs report-result --tool="grok" --status="failed" --bug-id="$BUG_ID" || true
  return 1
}

try_agy() {
  echo "[Dispatcher] --> Antigravity CLI"
  if [ ! -x "$AGY_BIN" ]; then return 1; fi

  local prompt; prompt="$(build_prompt)"
  local log_dir="${HERMES_DIR}/logs"
  mkdir -p "$log_dir"
  local log_file="${log_dir}/dispatch_${BUG_ID}_agy.log"
  local prompt_preview
  prompt_preview=$(echo "$prompt" | head -n 8 | tr -d '`' | cut -c1-350)

  tg_msg "🤖 *[Orchestrator]* Dispatching to *Antigravity CLI* for \`$BUG_ID\`

📋 *Task:* $TASK
📁 *Log:* \`$log_file\`

💡 *Instruction Prompt:*
\`\`\`
$prompt_preview
\`\`\`"

  snapshot_workspace
  start_heartbeat "Agy"
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

Waiting ~45s for the live rebuild, then ${qa_prof} validates it."
    tg_qa "🔎 *[${qa_prof}]* \`$BUG_ID\` was fixed by the Orchestrator. I will re-test the \`${CATEGORY}\` journey when the live site finishes rebuilding."
    sleep 45

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

# All tools exhausted
record_audit "none" "none" "human" "escalated_human"
tg_msg "🚨 *[Orchestrator]* All automated agents exhausted for \`$BUG_ID\`.

*Agents tried:* ${TOOL_SEQUENCE[*]}
*Bug:* $TASK

Human intervention required. Please review the bug and assign manually."
exit 1
