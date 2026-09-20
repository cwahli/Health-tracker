#!/usr/bin/env bash
# scripts/run-coding-dispatch.sh
# 
# Multi-Tool Autonomous Coding Agent Dispatcher for Health-tracker.
# Integrates dynamic tool selection, allowance tracking, and graceful fallback:
# OpenCode -> Cline CLI -> Grok Build CLI -> Antigravity CLI -> Human Escalation.
#
# Usage:
#   ./scripts/run-coding-dispatch.sh --task="Fix X" --bug-id="BUG-123" --category="meal" [--tool=auto|cline|opencode|grok]

set -eo pipefail

TASK=""
BUG_ID="BUG-UNKNOWN"
CATEGORY="general"
REQUESTED_TOOL="auto"
PREFERRED_MODEL="muse-spark-1.3"
THINKING="high"

for arg in "$@"; do
  case $arg in
    --help|-h)
      echo "Usage: $0 --task='description' [--bug-id='...'] [--category='...'] [--tool=auto|cline|opencode|grok] [--model='...'] [--thinking=high]"
      exit 0
      ;;
    --task=*)
      TASK="${arg#*=}"
      shift
      ;;
    --bug-id=*)
      BUG_ID="${arg#*=}"
      shift
      ;;
    --category=*)
      CATEGORY="${arg#*=}"
      shift
      ;;
    --tool=*)
      REQUESTED_TOOL="${arg#*=}"
      shift
      ;;
    --model=*)
      PREFERRED_MODEL="${arg#*=}"
      shift
      ;;
    --thinking=*)
      THINKING="${arg#*=}"
      shift
      ;;
    *)
      if [ -z "$TASK" ]; then
        TASK="$arg"
      fi
      ;;
  esac
done

if [ -z "$TASK" ]; then
  echo "Error: No task provided. Usage: $0 --task='description' [--bug-id='...'] [--category='...']"
  exit 1
fi

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_DIR"

# Cross-platform timeout runner
run_with_timeout() {
  local duration="$1"
  shift
  if command -v timeout >/dev/null 2>&1; then
    timeout "$duration" "$@"
  elif command -v gtimeout >/dev/null 2>&1; then
    gtimeout "$duration" "$@"
  else
    "$@"
  fi
}

HERMES_DIR="${HOME}/.hermes"
AUDIT_LOG="${HERMES_DIR}/dispatch_audit.log"
mkdir -p "$HERMES_DIR"

# Executable search paths
OPENCODE_BIN=$(which opencode || echo "${HOME}/.opencode/bin/opencode")
CLINE_BIN=$(which cline || echo "${HOME}/.local/bin/cline")
GROK_BIN=$(which grok || echo "${HOME}/.grok/bin/grok")
AGY_BIN=$(which agy || echo "${HOME}/.local/bin/agy")

echo "=========================================================="
echo " [Coding Dispatcher] Task: $BUG_ID ($CATEGORY)"
echo " Description: $TASK"
echo " Requested Tool: $REQUESTED_TOOL"
echo " Repo: $REPO_DIR"
echo "=========================================================="

START_TIME=$(date +%s)

record_audit() {
  local agent="$1"
  local model="$2"
  local tier="$3"
  local status="$4"
  local duration=$(( $(date +%s) - START_TIME ))

  local entry="{\"timestamp\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\", \"bug_id\": \"$BUG_ID\", \"category\": \"$CATEGORY\", \"agent\": \"$agent\", \"model\": \"$model\", \"tier\": \"$tier\", \"duration_seconds\": $duration, \"status\": \"$status\"}"
  echo "$entry" >> "$AUDIT_LOG"
  echo "[Dispatcher Audit] Recorded: $entry"
}

check_git_and_tsc() {
  local tool_name="$1"
  local model_desc="$2"

  echo "[Dispatcher] Verifying changes made by $tool_name with tsc..."
  if npx tsc --noEmit > /dev/null 2>&1; then
    DIFF_COUNT=$(git status --porcelain | wc -l | tr -d ' ')
    if [ "$DIFF_COUNT" -gt 0 ]; then
      echo "[Dispatcher] ✓ $tool_name fix succeeded with clean tsc exit 0! Committing..."
      git add .
      git commit -m "fix($CATEGORY): $BUG_ID via $tool_name ($model_desc)" || true
      git push origin main
      node scripts/tool-allowance.mjs report-result --tool="$tool_name" --status="success" --bug-id="$BUG_ID" --category="$CATEGORY" --duration=$(( $(date +%s) - START_TIME )) || true
      record_audit "$tool_name" "$model_desc" "resolved" "deployed_pending_qa"
      echo "[Dispatcher] Changes pushed to main. Awaiting webhook auto-deploy and QA re-verification."
      return 0
    else
      echo "[Dispatcher] Notice: $tool_name produced no modified files."
      return 1
    fi
  else
    echo "[Dispatcher] ✗ tsc failed after changes by $tool_name."
    return 1
  fi
}

clean_workspace() {
  echo "[Dispatcher] Reverting uncommitted broken changes..."
  git checkout . >/dev/null 2>&1 || true
  git clean -fd >/dev/null 2>&1 || true
}

# --- Tool Execution Functions ---

try_opencode() {
  local model="$1"
  echo "[Dispatcher] ---> Invoking OpenCode CLI (Model: $model)..."
  if [ ! -x "$OPENCODE_BIN" ]; then
    echo "[Dispatcher] OpenCode binary not executable at $OPENCODE_BIN, skipping..."
    return 1
  fi

  local output
  output=$(run_with_timeout 8m "$OPENCODE_BIN" -p "Task for $BUG_ID ($CATEGORY): $TASK. Think deeply (High Thinking) before modifying files. Strictly verify your changes with npx tsc --noEmit before finishing." 2>&1) || true

  # Check for rate-limiting or quota exhaustion
  if echo "$output" | grep -qiE "rate limit|quota exceeded|insufficient credits|429|allowance"; then
    echo "[Dispatcher] ⚠️ OpenCode hit rate limit or quota exhaustion."
    node scripts/tool-allowance.mjs report-result --tool="opencode" --status="rate_limited" --bug-id="$BUG_ID" --reason="Rate limit / quota exceeded" || true
    clean_workspace
    return 2
  fi

  if check_git_and_tsc "opencode" "$model"; then
    return 0
  fi

  # Attempt unstick nudge
  echo "[Dispatcher] Probing OpenCode agent to diagnose and unstick..."
  run_with_timeout 4m "$OPENCODE_BIN" -p "The previous attempt for $BUG_ID had errors. Inspect git status, analyze errors, and complete the fix now." || true

  if check_git_and_tsc "opencode" "$model"; then
    return 0
  fi

  clean_workspace
  node scripts/tool-allowance.mjs report-result --tool="opencode" --status="failed" --bug-id="$BUG_ID" || true
  return 1
}

try_cline() {
  echo "[Dispatcher] ---> Invoking Cline CLI (Thinking: $THINKING, Auto-Approve: true)..."
  if [ ! -x "$CLINE_BIN" ]; then
    echo "[Dispatcher] Cline binary not executable at $CLINE_BIN, skipping..."
    return 1
  fi

  local output
  output=$(run_with_timeout 8m "$CLINE_BIN" --auto-approve true --thinking "$THINKING" "Task for $BUG_ID ($CATEGORY): $TASK. Inspect the repository, implement the necessary code changes, and verify that npx tsc --noEmit succeeds cleanly." 2>&1) || true

  # Check for rate-limiting or quota exhaustion
  if echo "$output" | grep -qiE "rate limit|quota exceeded|insufficient credits|429|exhausted|allowance"; then
    echo "[Dispatcher] ⚠️ Cline hit rate limit or low allowance."
    node scripts/tool-allowance.mjs report-result --tool="cline" --status="rate_limited" --bug-id="$BUG_ID" --reason="Rate limit / quota exceeded" || true
    clean_workspace
    return 2
  fi

  if check_git_and_tsc "cline" "DeepSeek-Flash/auto-approve"; then
    return 0
  fi

  clean_workspace
  node scripts/tool-allowance.mjs report-result --tool="cline" --status="failed" --bug-id="$BUG_ID" || true
  return 1
}

try_grok() {
  echo "[Dispatcher] ---> Invoking Grok Build CLI (Deep Architecture Reasoning)..."
  if [ ! -x "$GROK_BIN" ]; then
    echo "[Dispatcher] Grok binary not executable at $GROK_BIN, skipping..."
    return 1
  fi

  local output
  output=$(run_with_timeout 10m "$GROK_BIN" -p "Task for $BUG_ID ($CATEGORY): $TASK. A lighter model was unable to resolve this. Analyze the architecture deeply, fix the issue, and ensure npx tsc --noEmit exits 0." 2>&1) || true

  if echo "$output" | grep -qiE "rate limit|quota exceeded|429"; then
    echo "[Dispatcher] ⚠️ Grok Build CLI hit rate limit."
    node scripts/tool-allowance.mjs report-result --tool="grok" --status="rate_limited" --bug-id="$BUG_ID" || true
    clean_workspace
    return 2
  fi

  if check_git_and_tsc "grok" "grok-build"; then
    return 0
  fi

  clean_workspace
  node scripts/tool-allowance.mjs report-result --tool="grok" --status="failed" --bug-id="$BUG_ID" || true
  return 1
}

try_agy() {
  echo "[Dispatcher] ---> Invoking Antigravity CLI..."
  if [ ! -x "$AGY_BIN" ]; then
    return 1
  fi

  run_with_timeout 8m "$AGY_BIN" -p "Task for $BUG_ID ($CATEGORY): $TASK. Fix the issue and verify tsc --noEmit." 2>&1 || true

  if check_git_and_tsc "agy" "antigravity"; then
    return 0
  fi

  clean_workspace
  return 1
}

# --- Tool Cascading Loop ---

echo "[Dispatcher] Determining optimal coding tool sequence via Tool Allowance Tracker..."

# Define tool sequence based on request or allowance
TOOL_SEQUENCE=()

if [ "$REQUESTED_TOOL" != "auto" ]; then
  # Put explicitly requested tool first
  TOOL_SEQUENCE+=("$REQUESTED_TOOL")
fi

# Fetch best candidates from allowance manager
BEST_TOOL=$(node scripts/tool-allowance.mjs pick-tool --category="$CATEGORY" | grep '"tool":' | head -n1 | cut -d '"' -f4)

if [ "$BEST_TOOL" != "none" ] && [[ ! " ${TOOL_SEQUENCE[*]} " =~ " ${BEST_TOOL} " ]]; then
  TOOL_SEQUENCE+=("$BEST_TOOL")
fi

# Fill in standard cascade order if not already included
for fallback in "opencode" "cline" "grok" "agy"; do
  if [[ ! " ${TOOL_SEQUENCE[*]} " =~ " ${fallback} " ]]; then
    TOOL_SEQUENCE+=("$fallback")
  fi
done

echo "[Dispatcher] Active execution sequence: ${TOOL_SEQUENCE[*]}"

for tool in "${TOOL_SEQUENCE[@]}"; do
  echo "----------------------------------------------------------"
  echo "[Dispatcher] Attempting resolution with tool: $tool"
  echo "----------------------------------------------------------"

  case $tool in
    opencode)
      if try_opencode "$PREFERRED_MODEL"; then
        echo "[Dispatcher] Task $BUG_ID successfully resolved by OpenCode."
        exit 0
      fi
      ;;
    cline)
      if try_cline; then
        echo "[Dispatcher] Task $BUG_ID successfully resolved by Cline."
        exit 0
      fi
      ;;
    grok)
      if try_grok; then
        echo "[Dispatcher] Task $BUG_ID successfully resolved by Grok Build."
        exit 0
      fi
      ;;
    agy)
      if try_agy; then
        echo "[Dispatcher] Task $BUG_ID successfully resolved by Agy."
        exit 0
      fi
      ;;
    *)
      echo "[Dispatcher] Unknown tool: $tool, skipping..."
      ;;
  esac

  echo "[Dispatcher] Tool '$tool' did not resolve the issue or encountered allowance limits. Escalating..."
done

# --- Final Escalation: Human ---
echo "=========================================================="
echo "[Dispatcher] 🚨 All automated tools (OpenCode, Cline, Grok, Agy) were unable to resolve $BUG_ID."
echo "[Dispatcher] Escalating to human with full audit log and error diagnostics."
echo "=========================================================="
record_audit "none" "none" "human" "escalated_human"
exit 1
