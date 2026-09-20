#!/usr/bin/env bash
# scripts/run-coding-dispatch.sh
# 
# Multi-Tier Autonomous Coding Agent Dispatcher for Health-tracker.
# Executes bug resolution with OpenCode -> Unstick Nudge -> Grok Build -> Human Escalation.
#
# Usage:
#   ./scripts/run-coding-dispatch.sh --task="Fix X" --bug-id="BUG-123" --category="meal"

set -eo pipefail

# Argument parsing
TASK=""
BUG_ID="BUG-UNKNOWN"
CATEGORY="general"
PREFERRED_MODEL="muse-spark-1.3"

for arg in "$@"; do
  case $arg in
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
    --model=*)
      PREFERRED_MODEL="${arg#*=}"
      shift
      ;;
    *)
      # Positional fallback
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

HERMES_DIR="${HOME}/.hermes"
AUDIT_LOG="${HERMES_DIR}/dispatch_audit.log"
LEARNING_POD="${HERMES_DIR}/learning_pod.json"

mkdir -p "$HERMES_DIR"
[ -f "$LEARNING_POD" ] || echo '{"models": {}, "history": []}' > "$LEARNING_POD"

# Find executables
OPENCODE_BIN=$(which opencode || echo "${HOME}/.opencode/bin/opencode")
GROK_BIN=$(which grok || echo "${HOME}/.grok/bin/grok")

echo "=========================================================="
echo " [Coding Dispatcher] Task: $BUG_ID ($CATEGORY)"
echo " Description: $TASK"
echo " Repo: $REPO_DIR"
echo "=========================================================="

START_TIME=$(date +%s)

# Helper function to record audit trail
record_audit() {
  local agent="$1"
  local model="$2"
  local tier="$3"
  local status="$4"
  local end_time
  end_time=$(date +%s)
  local duration=$((end_time - START_TIME))

  local entry="{\"timestamp\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\", \"bug_id\": \"$BUG_ID\", \"category\": \"$CATEGORY\", \"agent\": \"$agent\", \"model\": \"$model\", \"tier\": \"$tier\", \"duration_seconds\": $duration, \"status\": \"$status\"}"
  echo "$entry" >> "$AUDIT_LOG"
  echo "[Dispatcher Audit] Recorded: $entry"
}

# --- Tier 1: OpenCode with Selected Model ---
echo "[Dispatcher] ---> Tier 1: Invoking OpenCode CLI (Model: $PREFERRED_MODEL)..."
TIER1_SUCCESS=0

if [ -x "$OPENCODE_BIN" ]; then
  timeout 8m "$OPENCODE_BIN" -p "Task for $BUG_ID ($CATEGORY): $TASK. Think deeply (High Thinking) before modifying files. Strictly verify your changes with npx tsc --noEmit and named vitest before finishing." || TIER1_SUCCESS=1
else
  echo "[Dispatcher] OpenCode binary not found at $OPENCODE_BIN, skipping to Tier 3..."
  TIER1_SUCCESS=1
fi

# --- Tier 2: OpenCode Diagnostic & Unstick Nudge (if Tier 1 had errors) ---
if [ $TIER1_SUCCESS -ne 0 ] && [ -x "$OPENCODE_BIN" ]; then
  echo "[Dispatcher] ---> Tier 2: Probing OpenCode agent to diagnose and unstick..."
  timeout 5m "$OPENCODE_BIN" -p "The previous attempt for $BUG_ID failed or timed out. Inspect git diff and test failures. Analyze the error and complete the fix now." || true
fi

# Check if OpenCode applied a clean, type-safe fix
if npx tsc --noEmit > /dev/null 2>&1; then
  DIFF_COUNT=$(git status --porcelain | wc -l | tr -d ' ')
  if [ "$DIFF_COUNT" -gt 0 ]; then
    echo "[Dispatcher] ✓ OpenCode fix succeeded with clean tsc exit 0! Committing..."
    git add .
    git commit -m "fix($CATEGORY): $BUG_ID via OpenCode ($PREFERRED_MODEL)" || true
    git push origin main
    record_audit "opencode" "$PREFERRED_MODEL" "tier1_2" "deployed_pending_qa"
    echo "[Dispatcher] Changes pushed. Awaiting webhook auto-deploy and QA verification."
    exit 0
  fi
fi

# --- Tier 3: Escalate to Grok Build CLI ---
echo "[Dispatcher] ⚠️ Tier 1 & 2 failed. Escalating to Tier 3: Grok Build CLI..."
# Reset uncommitted broken state before Grok begins
git checkout .
git clean -fd

if [ -x "$GROK_BIN" ]; then
  timeout 10m "$GROK_BIN" -p "Task for $BUG_ID ($CATEGORY): $TASK. Note: A lighter model was unable to resolve this. Analyze the architecture deeply, fix the issue, and ensure npx tsc --noEmit exits 0." || true

  if npx tsc --noEmit > /dev/null 2>&1; then
    DIFF_COUNT=$(git status --porcelain | wc -l | tr -d ' ')
    if [ "$DIFF_COUNT" -gt 0 ]; then
      echo "[Dispatcher] ✓ Grok Build fix succeeded with clean tsc exit 0! Committing..."
      git add .
      git commit -m "fix($CATEGORY): $BUG_ID via Grok Build CLI" || true
      git push origin main
      record_audit "grok" "grok-build" "tier3" "deployed_pending_qa"
      echo "[Dispatcher] Changes pushed. Awaiting webhook auto-deploy and QA verification."
      exit 0
    fi
  fi
fi

# --- Tier 4: Human Escalation ---
echo "[Dispatcher] 🚨 Tier 4: Both OpenCode and Grok Build were unable to resolve $BUG_ID. Escalating to human."
record_audit "none" "none" "tier4" "escalated_human"
exit 1
