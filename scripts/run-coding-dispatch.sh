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

SCRIPT_PATH="$(readlink -f "${BASH_SOURCE[0]}")"
REPO_DIR="$(cd "$(dirname "$SCRIPT_PATH")/.."; pwd)"
cd "$REPO_DIR"

HERMES_DIR="${HERMES_DIR:-${HOME}/.hermes}"
AUDIT_LOG="${HERMES_DIR}/dispatch_audit.log"
TELEGRAM_SCRIPT="${REPO_DIR}/scripts/telegram-send.sh"
DISPATCH_LOCK_DIR="${HERMES_DIR}/dispatch_locks"
DISPATCH_ACTIVE_DIR="${HERMES_DIR}/dispatch_active"
# Legacy single-file lock (pre-parallel). Kept as read-only fallback so an
# old bot process that still holds it is visible in `status` instead of
# silently ignored.
LEGACY_DISPATCH_LOCK="${HERMES_DIR}/dispatch_lock"
LEGACY_DISPATCH_ACTIVE="${HERMES_DIR}/dispatch_active.json"
FILE_LOCKS_CLI="${REPO_DIR}/scripts/lib/file-locks.mjs"
mkdir -p "$HERMES_DIR" "${HERMES_DIR}/logs" "$DISPATCH_LOCK_DIR" "$DISPATCH_ACTIVE_DIR"

# ---------------------------------------------------------------
# Subcommands: status, stop, cancel, list-models, list-agents
# ---------------------------------------------------------------
SUBCOMMAND="${1:-}"

# One lock JSON per bug id: ${DISPATCH_LOCK_DIR}/<BUG_ID>.json
#   pid:bug_id:tool:model:thinking:start_time:log_file (+ area, worktree rows)
# Parallel by design: every active bug id gets its own record. `stop` targets
# one bug (`stop --bug-id=X`) and only touches that process/files.
lock_file_for() { printf '%s/%s.json' "$DISPATCH_LOCK_DIR" "$1"; }
active_file_for() { printf '%s/%s.json' "$DISPATCH_ACTIVE_DIR" "$1"; }

active_pids() {
  local f pid
  for f in "$DISPATCH_LOCK_DIR"/*.json; do
    [ -f "$f" ] || continue
    pid=$(python3 -c 'import json, sys; print(json.load(open(sys.argv[1])).get("pid",""))' "$f" 2>/dev/null || true)
    [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null && printf '%s:%s\n' "$pid" "$f"
  done
}

status_cmd() {
  echo "=== Health-tracker Coding Dispatch Status ==="
  local count=0
  local f pid bug_id category tool model thinking start_time log_file task area worktree lock_files
  local legacy_shown=0
  for f in "$DISPATCH_LOCK_DIR"/*.json "$DISPATCH_ACTIVE_DIR"/*.json; do
    [ -f "$f" ] || continue
    pid=""; bug_id=""; category=""; tool=""; model=""; thinking=""; start_time=""; log_file=""; task=""; area=""; worktree=""; lock_files=""

    pid=$(python3 -c 'import json, sys; d=json.load(open(sys.argv[1])); print(d.get("pid",""))' "$f" 2>/dev/null || true)
    bug_id=$(python3 -c 'import json, sys; d=json.load(open(sys.argv[1])); print(d.get("bug_id",""))' "$f" 2>/dev/null || true)
    category=$(python3 -c 'import json, sys; d=json.load(open(sys.argv[1])); print(d.get("category",""))' "$f" 2>/dev/null || true)
    tool=$(python3 -c 'import json, sys; d=json.load(open(sys.argv[1])); print(d.get("tool",""))' "$f" 2>/dev/null || true)
    model=$(python3 -c 'import json, sys; d=json.load(open(sys.argv[1])); print(d.get("model",""))' "$f" 2>/dev/null || true)
    thinking=$(python3 -c 'import json, sys; d=json.load(open(sys.argv[1])); print(d.get("thinking",""))' "$f" 2>/dev/null || true)
    start_time=$(python3 -c 'import json, sys; d=json.load(open(sys.argv[1])); print(d.get("start_time",""))' "$f" 2>/dev/null || true)
    log_file=$(python3 -c 'import json, sys; d=json.load(open(sys.argv[1])); print(d.get("log_file",""))' "$f" 2>/dev/null || true)
    task=$(python3 -c 'import json, sys; d=json.load(open(sys.argv[1])); print(d.get("task",""))' "$f" 2>/dev/null || true)
    area=$(python3 -c 'import json, sys; d=json.load(open(sys.argv[1])); print(d.get("area",""))' "$f" 2>/dev/null || true)
    worktree=$(python3 -c 'import json, sys; d=json.load(open(sys.argv[1])); print(d.get("worktree",""))' "$f" 2>/dev/null || true)
    lock_files=$(python3 -c 'import json, sys; d=json.load(open(sys.argv[1])); print(",".join(d.get("lock_files",[]) or []))' "$f" 2>/dev/null || true)
    [ -n "$pid" ] || continue
    if ! kill -0 "$pid" 2>/dev/null; then
      echo "---"
      echo "State: STALE (bug ${bug_id:-?}, pid $pid dead; run '$0 stop --bug-id=${bug_id:-?}' to clean)"
      continue
    fi
    count=$((count + 1))
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
    echo "---"
    echo "Bug: ${bug_id:-N/A} (Category: ${category:-general})"
    echo "Agent: ${tool:-unknown} (Model: ${model:-default}, Thinking: ${thinking:-auto})"
    echo "PID: $pid (Elapsed: ${mins}m ${secs}s)"
    [ -n "$area" ] && echo "Area: $area  Worktree: ${worktree:-$REPO_DIR}"
    [ -n "$lock_files" ] && echo "Claimed files: $lock_files"
    echo "Log: ${log_file:-none}"
    echo "Task: ${task:-none}"
    echo "Current Activity: $current_activity"
  done
  # Legacy single lock: visible for old processes, never blocks new work.
  if [ -f "$LEGACY_DISPATCH_LOCK" ]; then
    local info; info=$(cat "$LEGACY_DISPATCH_LOCK" 2>/dev/null || true)
    local lpid; lpid=$(printf '%s' "$info" | cut -d: -f1)
    if [ -n "$lpid" ] && kill -0 "$lpid" 2>/dev/null; then
      legacy_shown=1
      echo "---"
      echo "Legacy lock (pre-parallel): $info — informational only, does not block new dispatches."
    else
      rm -f "$LEGACY_DISPATCH_LOCK" 2>/dev/null || true
    fi
  fi
  if [ -f "$LEGACY_DISPATCH_ACTIVE" ] && [ "$legacy_shown" = "0" ]; then
    rm -f "$LEGACY_DISPATCH_ACTIVE" 2>/dev/null || true
  fi
  if [ "$count" -eq 0 ] && [ "$legacy_shown" = "0" ]; then
    echo "State: IDLE"
    echo "No coding agent is currently running."
    if [ -f "$AUDIT_LOG" ]; then
      local last_audit; last_audit=$(tail -n 1 "$AUDIT_LOG" 2>/dev/null || true)
      if [ -n "$last_audit" ]; then
        echo "Last Audit Entry: $last_audit"
      fi
    fi
  else
    echo "---"
    echo "Active runs: $count. File claims: run '$0 locks'."
  fi
}

locks_cmd() {
  if [ -f "$FILE_LOCKS_CLI" ]; then
    node "$FILE_LOCKS_CLI" list 2>/dev/null || echo "[]"
  else
    echo "file-locks helper missing: $FILE_LOCKS_CLI"
  fi
}

stop_cmd() {
  echo "[Dispatcher] Processing stop request..."
  local STOP_BUG=""
  local STOP_ALL=0
  for a in "$@"; do
    case "$a" in
      --bug-id=*|--bug=*) STOP_BUG="${a#*=}" ;;
      --all) STOP_ALL=1 ;;
    esac
  done
  local stopped=0
  local f pid bug_id tool worktree ticket
  for f in "$DISPATCH_LOCK_DIR"/*.json "$DISPATCH_ACTIVE_DIR"/*.json; do
    [ -f "$f" ] || continue
    bug_id=$(python3 -c 'import json, sys; print(json.load(open(sys.argv[1])).get("bug_id",""))' "$f" 2>/dev/null || true)
    if [ "$STOP_ALL" != "1" ] && [ -n "$STOP_BUG" ] && [ "$bug_id" != "$STOP_BUG" ]; then
      continue
    fi
    pid=$(python3 -c 'import json, sys; print(json.load(open(sys.argv[1])).get("pid",""))' "$f" 2>/dev/null || true)
    tool=$(python3 -c 'import json, sys; print(json.load(open(sys.argv[1])).get("tool",""))' "$f" 2>/dev/null || true)
    worktree=$(python3 -c 'import json, sys; print(json.load(open(sys.argv[1])).get("worktree",""))' "$f" 2>/dev/null || true)
    ticket=$(python3 -c 'import json, sys; print(json.load(open(sys.argv[1])).get("ticket",""))' "$f" 2>/dev/null || true)
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
      echo "[Dispatcher] Terminating agent '${tool:-?}' (PID $pid) for ${bug_id:-?}..."
      kill -TERM -"$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true
      pkill -P "$pid" 2>/dev/null || true
      # Give the cleanup trap time to close an open ticket attempt (failed
      # row + block) before SIGKILL. The old fixed `sleep 1.5` raced the trap
      # mid-bugctl-call and left a silent in_fix zombie.
      local g=0
      while kill -0 "$pid" 2>/dev/null && [ "$g" -lt 12 ]; do
        sleep 0.5
        g=$((g + 1))
      done
      if kill -0 "$pid" 2>/dev/null; then
        kill -KILL -"$pid" 2>/dev/null || kill -KILL "$pid" 2>/dev/null || true
        pkill -9 -P "$pid" 2>/dev/null || true
      fi
    fi
    # Scoped revert: only this run's worktree, only files this run changed.
    if [ -n "$worktree" ] && [ -d "$worktree" ]; then
      ( cd "$worktree" && git checkout -- src/ 2>/dev/null ) || true
    fi
    node "$FILE_LOCKS_CLI" release-bug "--bug-id=${bug_id:-?}" >/dev/null 2>&1 || true
    rm -f "$f" 2>/dev/null || true
    stopped=$((stopped + 1))
    # V-30.4 zombie guarantee: the cleanup trap may have been SIGKILLed
    # mid-bugctl-call (or never ran). If a ticket run's card is still
    # in_fix (queue in_progress) after the process is dead, close the
    # attempt and block here so no silent in_fix zombie survives `stop`.
    if [ -n "${ticket:-}" ]; then
      local bugctl_local="${REPO_DIR}/scripts/bugctl.mjs"
      local zqueue=""
      zqueue=$(node "$bugctl_local" packet --id "$ticket" --json 2>/dev/null | python3 -c 'import json,sys
try: print(json.load(sys.stdin).get("queue") or "")
except Exception: print("")' 2>/dev/null || true)
      if [ "$zqueue" = "in_progress" ]; then
        node "$bugctl_local" attempt --id "$ticket" --actor orchestrator \
          --hyp "stopped" --file "" --test "" \
          --result "failed: stopped by operator" \
          --note "stop closed the attempt (cleanup trap was killed or raced)" \
          --burned=false --json >/dev/null 2>&1 || true
        node "$bugctl_local" block --id "$ticket" --reason "dispatch stopped by operator" --json >/dev/null 2>&1 || \
          echo "[Dispatcher] WARN: stop could not post block for $ticket" >&2
        echo "[Dispatcher] ticket $ticket: stop closed the open attempt and blocked the card."
      fi
    fi
    if [ -n "$tool" ] && [ -n "$bug_id" ]; then
      bash "$TELEGRAM_SCRIPT" --profile="${HERMES_PROFILE:-orchestrator}" \
        --text="🛑 *[Orchestrator]* Stopped agent '*$tool*' on \`$bug_id\`.
• Process terminated (PID ${pid:-?}).
• That run's worktree reverted; other agents keep working.
• No further fallback agent will be started." 2>/dev/null || true
    fi
  done
  if [ "$stopped" -eq 0 ]; then
    echo "[Dispatcher] Nothing to stop (no matching active run). Use 'status' to list runs."
  else
    echo "[Dispatcher] Stopped $stopped run(s). Other agents untouched."
  fi
  # Legacy cleanup only when nothing modern is active and --all was asked.
  if [ "$STOP_ALL" = "1" ]; then
    rm -f "$LEGACY_DISPATCH_LOCK" "$LEGACY_DISPATCH_ACTIVE" 2>/dev/null || true
  fi
}

case "$SUBCOMMAND" in
  status)
    status_cmd
    exit 0
    ;;
  stop|cancel)
    shift
    stop_cmd "$@"
    exit 0
    ;;
  locks|claims|files)
    locks_cmd
    exit 0
    ;;
  prune-locks)
    node "$FILE_LOCKS_CLI" prune 2>/dev/null || true
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

WORK_ITEM=""
PAGE=""
COMPONENT=""
OBSERVED=""
EXPECTED=""
CRITERIA=""
CLASS=""
SURFACE=""

# V-30.4 packet-driven dispatch: --ticket=#n (empty = legacy --task= path).
TICKET=""
TICKET_ATTEMPT_OPEN=0

for arg in "$@"; do
  case $arg in
    --help|-h)
      echo "Usage: $0 [--work-item=JSON|FILE] [--ticket=#n] [--page=...] [--observed=...] [--expected=...] [--screenshot=...] [--criteria=...] [--bug-id='...'] [--category='...'] [--tool=auto|opencode|cline|grok|agy] [--model=...] [--thinking=high|low|none|auto] [--cascade] [--verify=true|false|auto] [--profile=orchestrator] [--area=name] [--files=a,b] [--foreground] [--print-plan]"
      echo ""
      echo "  --ticket=#n   V-30.4 packet-driven dispatch: the packed card packet is the"
      echo "                prompt source (plan posted first, attempt rows at start/end,"
      echo "                failure -> bugctl block). Legacy --task= stays unchanged."
      echo ""
      echo "Subcommands:"
      echo "  $0 status                     List all running agents (parallel-safe)"
      echo "  $0 stop [--bug-id=X|--all]    Stop one run (default: all active) without touching others"
      echo "  $0 locks                      Show live per-file claims"
      echo "  $0 prune-locks                Drop stale per-file claims"
      exit 0
      ;;
    --work-item=*|--work_item=*) WORK_ITEM="${arg#*=}" ;;
    --page=*)                    PAGE="${arg#*=}" ;;
    --component=*)               COMPONENT="${arg#*=}" ;;
    --observed=*)                OBSERVED="${arg#*=}" ;;
    --expected=*)                EXPECTED="${arg#*=}" ;;
    --criteria=*)                CRITERIA="${arg#*=}" ;;
    --class=*)                   CLASS="${arg#*=}" ;;
    --surface=*)                 SURFACE="${arg#*=}" ;;
    --task=*)                    TASK="${arg#*=}" ;;
    --ticket=*)                  TICKET="${arg#*=}" ;; # V-30.4: packed card packet drives the dispatch
    --bug-id=*)                  BUG_ID="${arg#*=}" ;;
    --category=*)                CATEGORY="${arg#*=}" ;;
    --tool=*)                    REQUESTED_TOOL="${arg#*=}" ;;
    --model=*)                   PREFERRED_MODEL="${arg#*=}" ;;
    --thinking=*)                THINKING="${arg#*=}" ;;
    --screenshot=*)              SCREENSHOT="${arg#*=}" ;;
    --cascade)                   CASCADE=1 ;;
    --verify=*)                  PREFER_VERIFY="${arg#*=}" ;;
    --profile=*)                 DISPATCH_PROFILE="${arg#*=}" ;;
    --area=*)                    DISPATCH_AREA="${arg#*=}" ;;
    --files=*)                   DISPATCH_FILES="${arg#*=}" ;;
    --worktree=*)                DISPATCH_WORKTREE="${arg#*=}" ;; # advanced: reuse an existing checkout
    --foreground)                FOREGROUND=1 ;;
    --print-plan)                PRINT_PLAN=1 ;;
    *)
      if [ -z "$TASK" ]; then TASK="$arg"; fi
      ;;
  esac
done

# ---------------------------------------------------------------
# BOT-20: Pack, then reject via scripts/lib/bug-pack.mjs
# Input is a versioned work_item or the four fields (page, observed, expected, screenshot).
# Several defects become one card plus a split list.
# Nothing that fails packCheck is passed through as --task.
#
# V-30.4: --ticket=#n skips re-packing (the card is already packed) and loads
# the full packet via `bugctl packet` — the packet, not chat history, is the
# coder prompt (§6.2 audit note option B: ticket consumers read bugctl packet;
# buildNow()/buildContinueJob() stay legacy and are never read here).
# ---------------------------------------------------------------
PACK_HELPER="${REPO_DIR}/scripts/lib/bug-pack.mjs"
DISPATCH_HELPER="${REPO_DIR}/scripts/lib/bug-dispatch.mjs"
BUGCTL="${REPO_DIR}/scripts/bugctl.mjs"
PACK_RAW=""
TAG_ID=""
PUBLIC_N=""
TITLE=""
TICKET_HYP=""
TICKET_FILES=""
TICKET_GATES=""
TICKET_STATE=""
TICKET_ASSIGNEE=""
SPEC_PATH=""
SPEC_TEXT=""
REPRO_TEXT=""

if [ -z "$TICKET" ]; then

PACK_RAW=$(node "$PACK_HELPER" dispatch "$@" 2>&1) || {
  echo "[Dispatcher] Rejected: inbound defect report failed packCheck:" >&2
  echo "$PACK_RAW" >&2
  if [ -f "$TELEGRAM_SCRIPT" ]; then
    bash "$TELEGRAM_SCRIPT" --profile="$DISPATCH_PROFILE" \
      --text="❌ *[Orchestrator]* Dispatch rejected for \`$BUG_ID\`: payload failed packCheck:
\`\`\`
$(echo "$PACK_RAW" | head -n 6)
\`\`\`" 2>/dev/null || true
  fi
  exit 1
}

PACKED_COMPONENT=$(python3 -c 'import json,sys; print(json.loads(sys.argv[1]).get("card",{}).get("component",""))' "$PACK_RAW")
PACKED_OBSERVED=$(python3 -c 'import json,sys; print(json.loads(sys.argv[1]).get("card",{}).get("observed",""))' "$PACK_RAW")
PACKED_EXPECTED=$(python3 -c 'import json,sys; print(json.loads(sys.argv[1]).get("card",{}).get("expected",""))' "$PACK_RAW")
PACKED_CRITERIA=$(python3 -c 'import json,sys; print(json.loads(sys.argv[1]).get("card",{}).get("criteria",""))' "$PACK_RAW")
PACKED_FINGERPRINT=$(python3 -c 'import json,sys; print(json.loads(sys.argv[1]).get("card",{}).get("fingerprint",""))' "$PACK_RAW")
PACKED_SCREENSHOT=$(python3 -c 'import json,sys; print(json.loads(sys.argv[1]).get("screenshot",""))' "$PACK_RAW")
SPLIT_COUNT=$(python3 -c 'import json,sys; print(len(json.loads(sys.argv[1]).get("split",[])))' "$PACK_RAW")
SPLIT_LIST_TEXT=""
if [ "$SPLIT_COUNT" -gt 0 ]; then
  SPLIT_LIST_TEXT=$(python3 -c '
import json, sys
data = json.loads(sys.argv[1]).get("split", [])
print("\n".join("- #" + str(it.get("n", "?")) + ": " + str(it.get("issue") or it.get("observed")) for it in data))
' "$PACK_RAW")
fi

if [ -n "$PACKED_SCREENSHOT" ] && [ -z "$SCREENSHOT" ]; then
  SCREENSHOT="$PACKED_SCREENSHOT"
fi

TASK="Fix ${PACKED_COMPONENT}: ${PACKED_OBSERVED} -> expected ${PACKED_EXPECTED} (${PACKED_CRITERIA})"

else
  # ---------------------------------------------------------------
  # V-30.4 ticket mode. Order: packet read -> idempotency guard -> field
  # extraction -> locked spec -> plan artifact posted BEFORE dispatch.
  # Writes go through bugctl (BUG_API_BASE/BUG_API_TOKEN; withFallback queues
  # the write offline). A packet READ cannot be queued — fail fast (exit 2).
  # ---------------------------------------------------------------
  TICKET="${TICKET#\#}"
  PACKET_FILE=$(mktemp "${TMPDIR:-/tmp}/dispatch_packet_${TICKET}.XXXXXX")
  if ! node "$BUGCTL" packet --id "$TICKET" --json >"$PACKET_FILE" 2>/dev/null; then
    echo "[Dispatcher] ticket #$TICKET: packet read failed (ticket mode needs a live API read; the offline queue only replays writes). Use --task= for the legacy path." >&2
    rm -f "$PACKET_FILE"
    exit 2
  fi
  if ! node -e 'const p=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); process.exit(p && p.state && p.tag_id ? 0 : 1)' "$PACKET_FILE"; then
    echo "[Dispatcher] ticket #$TICKET: unusable packet payload (offline/error response?)." >&2
    rm -f "$PACKET_FILE"
    exit 2
  fi

  # Idempotency: refuse a second dispatch unless the live per-bug lock proves
  # it is the same run (lock check below also refuses an alive duplicate PID).
  if ! GUARD_OUT=$(node "$DISPATCH_HELPER" guard --packet-file="$PACKET_FILE" --self-pid="$$" 2>&1); then
    echo "[Dispatcher] Dispatch refused for ticket #$TICKET: $GUARD_OUT" >&2
    bash "$TELEGRAM_SCRIPT" --profile="$DISPATCH_PROFILE" --text="🚫 *[Orchestrator]* Dispatch refused for \`#$TICKET\`: ${GUARD_OUT#refused: }" 2>/dev/null || true
    rm -f "$PACKET_FILE"
    exit 3
  fi

  TAG_ID=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("tag_id",""))' "$PACKET_FILE")
  PUBLIC_N=$(python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); print(d.get("public_n") or "")' "$PACKET_FILE")
  TITLE=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("title") or "")' "$PACKET_FILE")
  TICKET_STATE=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("state") or "")' "$PACKET_FILE")
  TICKET_ASSIGNEE=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("assignee") or "")' "$PACKET_FILE")
  PKT_SURFACE=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("surface") or "")' "$PACKET_FILE")
  PACKED_COMPONENT=$(python3 -c 'import json,sys; d=json.load(open(sys.argv[1])).get("defect") or {}; print(d.get("component",""))' "$PACKET_FILE")
  PACKED_OBSERVED=$(python3 -c 'import json,sys; d=json.load(open(sys.argv[1])).get("defect") or {}; print(d.get("observed",""))' "$PACKET_FILE")
  PACKED_EXPECTED=$(python3 -c 'import json,sys; d=json.load(open(sys.argv[1])).get("defect") or {}; print(d.get("expected",""))' "$PACKET_FILE")
  PACKED_CRITERIA=$(python3 -c 'import json,sys; d=json.load(open(sys.argv[1])).get("defect") or {}; print(d.get("criteria",""))' "$PACKET_FILE")
  PACKED_FINGERPRINT=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("fingerprint") or "")' "$PACKET_FILE")

  BUG_ID="#${PUBLIC_N:-$TICKET}"
  [ -n "$SURFACE" ] || SURFACE="$PKT_SURFACE"
  CATEGORY=$(node "$DISPATCH_HELPER" category --surface="$SURFACE")
  SPLIT_COUNT=0
  SPLIT_LIST_TEXT=""
  TASK="Fix ${BUG_ID}: ${TITLE:-$PACKED_OBSERVED}"

  # Repro lane verdict (V-30.3) rides along in the prompt.
  REPRO_STATUS=$(python3 -c 'import json,sys; d=json.load(open(sys.argv[1])).get("repro") or {}; print(d.get("status",""))' "$PACKET_FILE")
  if [ -n "$REPRO_STATUS" ]; then
    REPRO_COMMAND=$(python3 -c 'import json,sys; d=json.load(open(sys.argv[1])).get("repro") or {}; print(d.get("command") or "")' "$PACKET_FILE")
    REPRO_EXIT=$(python3 -c 'import json,sys; d=json.load(open(sys.argv[1])).get("repro") or {}; print(d.get("exit_code") if d.get("exit_code") is not None else "")' "$PACKET_FILE")
    REPRO_TEXT="

[REPRO (${REPRO_STATUS})]:
- Command: ${REPRO_COMMAND:-—}
- Exit code: ${REPRO_EXIT:-—}
- Status '${REPRO_STATUS}' comes from the QA repro lane; reproduce the defect before changing code."
  fi

  # Locked spec from the specify role (specs/active/card-<n>.md from TEMPLATE).
  SPEC_PATH=$(node "$DISPATCH_HELPER" spec-path --dir="${REPO_DIR}/specs/active" --n="${PUBLIC_N}" --tag="${TAG_ID}" 2>/dev/null || true)
  if [ -n "$SPEC_PATH" ] && [ -f "$SPEC_PATH" ]; then
    SPEC_TEXT=$(cat "$SPEC_PATH")
  else
    SPEC_PATH=""
  fi

  # Plan artifact BEFORE dispatch (posted here, in the parent, fail-fast).
  HAS_PLAN=$(python3 -c 'import json,sys; print(1 if json.load(open(sys.argv[1])).get("plan") else 0)' "$PACKET_FILE")
  if [ "$HAS_PLAN" = "1" ]; then
    TICKET_HYP=$(python3 -c 'import json,sys; print((json.load(open(sys.argv[1])).get("plan") or {}).get("hypothesis") or "")' "$PACKET_FILE")
    TICKET_FILES=$(python3 -c 'import json,sys; print(",".join((json.load(open(sys.argv[1])).get("plan") or {}).get("files") or []))' "$PACKET_FILE")
    TICKET_GATES=$(python3 -c 'import json,sys; print(",".join((json.load(open(sys.argv[1])).get("plan") or {}).get("gates") or []))' "$PACKET_FILE")
  else
    PLAN_ARGS=$(node "$DISPATCH_HELPER" plan-args --packet-file="$PACKET_FILE" ${SPEC_PATH:+--spec="$SPEC_PATH"} 2>/dev/null || true)
    TICKET_HYP=$(printf '%s' "$PLAN_ARGS" | python3 -c 'import json,sys; print(json.loads(sys.stdin.read() or "{}").get("hypothesis") or "")' 2>/dev/null || true)
    TICKET_FILES=$(printf '%s' "$PLAN_ARGS" | python3 -c 'import json,sys; print(",".join(json.loads(sys.stdin.read() or "{}").get("files") or []))' 2>/dev/null || true)
    TICKET_GATES=$(printf '%s' "$PLAN_ARGS" | python3 -c 'import json,sys; print(",".join(json.loads(sys.stdin.read() or "{}").get("gates") or []))' 2>/dev/null || true)
    PLAN_REASON=$(printf '%s' "$PLAN_ARGS" | python3 -c 'import json,sys; print(json.loads(sys.stdin.read() or "{}").get("reason") or "")' 2>/dev/null || true)
    if [ -z "$TICKET_FILES" ]; then
      # No locked spec yet — fall back to the defect component's real file.
      GUESS_FILE=$(python3 - "$PACKED_COMPONENT" "$REPO_DIR" <<'PY' 2>/dev/null || true
import os, re, sys
toks = re.findall(r"[A-Za-z0-9_]+", sys.argv[1] or "")
for t in toks:
    for c in (f"src/components/{t}.tsx", f"src/components/{t}.ts", f"src/utils/{t}.ts", f"src/{t}.tsx", f"src/jobs/{t}.ts"):
        if os.path.isfile(os.path.join(sys.argv[2], c)):
            print(c)
            raise SystemExit
PY
)
      [ -n "$GUESS_FILE" ] && TICKET_FILES="$GUESS_FILE"
    fi
    if [ -n "$TICKET_FILES" ]; then
      if ! node "$BUGCTL" plan --id "$TICKET" --hyp "$TICKET_HYP" --files "$TICKET_FILES" --gates "$TICKET_GATES" --by orchestrator --json >/dev/null 2>&1; then
        echo "[Dispatcher] WARN: plan artifact for #$TICKET not recorded (API write failed — bugctl queues it offline)." >&2
      fi
    else
      echo "[Dispatcher] WARN: no plan artifact for #$TICKET: ${PLAN_REASON:-no plan files} (specify role: write specs/active/card-${PUBLIC_N}.md from specs/TEMPLATE.md)." >&2
    fi
  fi

  rm -f "$PACKET_FILE"
  echo "[Dispatcher] ticket #$TICKET loaded: state=$TICKET_STATE surface=${SURFACE:-—} spec=${SPEC_PATH:-none} gates=${TICKET_GATES:-—}"
fi

# Dynamic Thinking Tuning (V-29): atomic UI/text fixes use low thinking to avoid overthinking loops
if [ "$THINKING" = "auto" ] || [ -z "$THINKING" ]; then
  if echo "$TASK" | grep -qiE "format|round|float|toFixed|typo|color|css|style|text|spacing|padding|margin|label"; then
    THINKING="low"
  else
    THINKING="high"
  fi
fi

# ---------------------------------------------------------------
# BOT-21: Coordination tax logging & repeat args-hash alert
# Log (ticket, agent, tool, args-hash).
# Same hash twice on one ticket alerts (REPEAT_ARGS_HASH).
# ---------------------------------------------------------------
TAX_HELPER="${REPO_DIR}/scripts/lib/coordination-tax.mjs"
record_coordination_tax() {
  local tool_name="$1"
  local extra_info="${2:-}"
  if [ -f "$TAX_HELPER" ]; then
    local payload="{\"task\": \"$TASK\", \"model\": \"${PREFERRED_MODEL:-default}\", \"thinking\": \"${THINKING:-auto}\", \"extra\": \"$extra_info\"}"
    local tax_res=""
    set +e
    tax_res=$(node "$TAX_HELPER" record --ticket="$BUG_ID" --agent="${DISPATCH_PROFILE:-orchestrator}" --tool="$tool_name" --args="$payload" 2>&1)
    local tax_status=$?
    set -e
    if [ "$tax_status" -eq 2 ] || echo "$tax_res" | grep -q '"alert": true'; then
      local count
      count=$(echo "$tax_res" | python3 -c 'import json,sys; print(json.loads(sys.stdin.read()).get("count","2"))' 2>/dev/null || echo "2")
      local alert_hash
      alert_hash=$(echo "$tax_res" | python3 -c 'import json,sys; print(json.loads(sys.stdin.read()).get("entry",{}).get("args_hash",""))' 2>/dev/null || echo "")
      echo "[Dispatcher] WARNING: Coordination tax alert on $BUG_ID (REPEAT_ARGS_HASH): tool=$tool_name hash=$alert_hash count=$count" >&2
      tg_msg "⚠️ *[CoordinationTax]* Repeated tool invocation detected on \`$BUG_ID\` (tool: \`$tool_name\`, hash: \`$alert_hash\`, count: $count). Potential spinning loop."
    fi
  fi
}

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
    meal_audit) printf 'meal_audit\n' ;;
    *) printf 'qa_meal\n' ;;
  esac
}

# ---------------------------------------------------------------
# BOT-13: Retrieved memory on the build turn. Fetches up to 3 lexical rows
# for this bug/task (decisions/dead-ends/facts) and exposes them as
# MEMORY_CONTEXT for build_prompt below. Empty stores = empty context = no
# prompt change. Other turns never retrieve.
# ---------------------------------------------------------------
MEMORY_HELPER="${REPO_DIR}/scripts/lib/memory-stores.mjs"
MEMORY_CONTEXT=""
fetch_build_memory() {
  [ -f "$MEMORY_HELPER" ] || return 0
  local mem_json=""
  set +e
  mem_json=$(node "$MEMORY_HELPER" retrieve --turn=build --query="$BUG_ID $TASK" --limit=3 2>/dev/null)
  set -e
  [ -n "$mem_json" ] || return 0
  MEMORY_CONTEXT=$(printf '%s' "$mem_json" | python3 -c 'import json,sys; d=json.load(sys.stdin); print("\n".join(f"- [{r.get(\"store\",\"?\")}] {r.get(\"text\",\"\")}" + (f" ({r.get(\"ticket\")})" if r.get("ticket") else "") for r in d.get("rows",[])))' 2>/dev/null || true)
  if [ -n "$MEMORY_CONTEXT" ]; then
    echo "[Dispatcher] Retrieved memory rows for $BUG_ID:" >&2
    printf '%s\n' "$MEMORY_CONTEXT" | head -n 3 | while IFS= read -r line; do echo "[Dispatcher]   memory: $line" >&2; done
  fi
}
fetch_build_memory

if [ "$PRINT_PLAN" = "1" ]; then
  echo "tool=${REQUESTED_TOOL}"
  echo "model=${PREFERRED_MODEL}"
  echo "thinking=${THINKING}"
  echo "cascade=${CASCADE}"
  echo "qa_profile=$(qa_profile_for_category)"
  echo "defect_component=${PACKED_COMPONENT}"
  echo "defect_fingerprint=${PACKED_FINGERPRINT}"
  echo "split_count=${SPLIT_COUNT}"
  echo "memory_rows=$(printf '%s' "${MEMORY_CONTEXT:-}" | grep -c '^-' || true)"
  if [ -n "$TICKET" ]; then
    echo "ticket=${TICKET}"
    echo "ticket_state=${TICKET_STATE}"
    echo "tag_id=${TAG_ID}"
    echo "spec=${SPEC_PATH:-none}"
    echo "plan_gates=${TICKET_GATES:-none}"
  fi
  if [ "$REQUESTED_TOOL" = "opencode" ] || [ "$REQUESTED_TOOL" = "auto" ]; then
    echo "opencode_argv=opencode run --auto --dir ${REPO_DIR} -m $(opencode_model_id "$PREFERRED_MODEL") <prompt>"
  fi
  exit 0
fi

# ---------------------------------------------------------------
# V-30.4 ticket rows: attempt start/end + block — same attempt schema as the
# web lane (bugctl POST /attempts | PATCH blocked_reason). --burned=false is
# mandatory: the server defaults non-green attempts to burned=true, which
# would eat the burn budget on every bookkeeping row.
# The dispatcher NEVER posts verify (author ≠ verifier): closure is a QA
# action with method=named_test after the named gate is green.
# ---------------------------------------------------------------
ticket_attempt_row() {
  [ -n "${TICKET:-}" ] || return 0
  local result="$1" note="$2" applied="${3:-}"
  local applied_flag=""
  [ "$applied" = "true" ] && applied_flag="--applied"
  node "$BUGCTL" attempt --id "$TICKET" --actor orchestrator \
    --hyp "${TICKET_HYP:-dispatch}" --file "${TICKET_FILES%%,*}" --test "${TICKET_GATES%%,*}" \
    --result "$result" --note "$note" --burned=false --json $applied_flag >/dev/null 2>&1 \
    || echo "[Dispatcher] WARN: attempt row ($result) not recorded for #$TICKET" >&2
}

ticket_block() {
  [ -n "${TICKET:-}" ] || return 0
  node "$BUGCTL" block --id "$TICKET" --reason "$1" --json >/dev/null 2>&1 \
    || echo "[Dispatcher] WARN: block for #$TICKET not recorded" >&2
}

# Terminal failure: end-row first (attempt history), then preserve the reason
# as blocked_reason instead of only writing escalated_human to the audit.
ticket_fail_and_block() {
  [ -n "${TICKET:-}" ] || return 0
  if [ "${TICKET_ATTEMPT_OPEN:-0}" = "1" ]; then
    TICKET_ATTEMPT_OPEN=0
    ticket_attempt_row "failed: $1" "$1"
  fi
  ticket_block "$1"
}

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
# Parallel run setup: per-bug lock record + per-run worktree + file claims.
# Nothing here blocks on other agents. Two runs may proceed at once; the
# only shared gate is claim-guard on the open PRs at merge time.
# ---------------------------------------------------------------
stop_heartbeat() {
  if [ -n "${HEARTBEAT_PID:-}" ]; then
    kill "$HEARTBEAT_PID" 2>/dev/null || true
    # Bounded wait: never hang the dispatch if the heartbeat ignores TERM.
    local hb_i=0
    while kill -0 "$HEARTBEAT_PID" 2>/dev/null && [ "$hb_i" -lt 6 ]; do
      sleep 0.5
      hb_i=$((hb_i + 1))
    done
    kill -9 "$HEARTBEAT_PID" 2>/dev/null || true
    wait "$HEARTBEAT_PID" 2>/dev/null || true
    HEARTBEAT_PID=""
  fi
}

RUN_LOCK_FILE="$(lock_file_for "$BUG_ID")"
RUN_ACTIVE_FILE="$(active_file_for "$BUG_ID")"
WE_OWN_LOCK=0
cleanup_dispatch() {
  stop_heartbeat
  # V-30.4: an open ticket attempt must always end in a row + blocked_reason,
  # even on signal/early exit (e.g. no tools available) — never a silent
  # in_fix zombie. Normal success/failure paths close the attempt first.
  if [ "${TICKET_ATTEMPT_OPEN:-0}" = "1" ] && [ -n "${TICKET:-}" ]; then
    TICKET_ATTEMPT_OPEN=0
    ticket_fail_and_block "dispatch aborted (signal or early exit)"
  fi
  if [ "$WE_OWN_LOCK" != "1" ]; then
    return 0
  fi
  # Refresh dies with us; claims expire by TTL so a crash cannot wedge files.
  rm -f "$RUN_LOCK_FILE" "$RUN_ACTIVE_FILE" 2>/dev/null || true
}
trap cleanup_dispatch EXIT INT TERM

# Same bug id re-dispatched while alive: refuse only that duplicate, never
# other bugs. (Chat itself is never gated — this is run-start only.)
if [ -f "$RUN_LOCK_FILE" ]; then
  dup_pid=$(python3 -c 'import json, sys; print(json.load(open(sys.argv[1])).get("pid",""))' "$RUN_LOCK_FILE" 2>/dev/null || true)
  if [ -n "$dup_pid" ] && kill -0 "$dup_pid" 2>/dev/null; then
    echo "[Dispatcher] $BUG_ID is already running (PID $dup_pid). Use a new --bug-id for parallel work."
    bash "$TELEGRAM_SCRIPT" --profile="$DISPATCH_PROFILE" --text="ℹ️ *[Orchestrator]* \`$BUG_ID\` is already running (PID \`$dup_pid\`). Send a new bug id to run in parallel." 2>/dev/null || true
    exit 1
  fi
  rm -f "$RUN_LOCK_FILE" "$RUN_ACTIVE_FILE" 2>/dev/null || true
fi

# Area/worktree: one checkout per run so coders never share an index.
slugify() { printf '%s' "$1" | tr '[:upper:]' '[:lower:]' | tr -cs 'a-z0-9' '-' | sed 's/^-*//;s/-*$//' | cut -c1-48; }
if [ -z "${DISPATCH_AREA:-}" ]; then
  DISPATCH_AREA="$(slugify "$BUG_ID")"
  [ -n "$DISPATCH_AREA" ] || DISPATCH_AREA="run-$(date +%s)"
fi
WORKTREE_BASE="${DISPATCH_WORKTREE:-}"
if [ -z "$WORKTREE_BASE" ]; then
  WORKTREE_BASE="/home/ubuntu/dev/dispatch-${DISPATCH_AREA}"
  if [ ! -e "$WORKTREE_BASE/.git" ] && [ ! -f "$WORKTREE_BASE/.git" ]; then
    ( cd "$REPO_DIR" && git fetch origin main >/dev/null 2>&1 ) || true
    branch="agent/dispatch-${DISPATCH_AREA}"
    if git -C "$REPO_DIR" show-ref --verify --quiet "refs/heads/$branch"; then
      git -C "$REPO_DIR" worktree add "$WORKTREE_BASE" "$branch" >/dev/null 2>&1 || true
    else
      git -C "$REPO_DIR" worktree add -b "$branch" "$WORKTREE_BASE" origin/main >/dev/null 2>&1 || WORKTREE_BASE="$REPO_DIR"
    fi
  fi
  [ -d "$WORKTREE_BASE" ] || WORKTREE_BASE="$REPO_DIR"
  if [ -f "$REPO_DIR/.env" ] && [ ! -f "$WORKTREE_BASE/.env" ]; then cp "$REPO_DIR/.env" "$WORKTREE_BASE/.env" 2>/dev/null || true; fi
fi
CODER_DIR="$WORKTREE_BASE"

# File claims: explicit --files plus paths scraped from the task. Advisory
# only — conflicts warn and steer the prompt, they never block the run.
TASK_FILES="$(python3 - "$TASK" "${DISPATCH_FILES:-}" <<'PY' 2>/dev/null || true
import json, re, sys
text = sys.argv[1] + "\n" + sys.argv[2].replace(",", "\n")
seen = []
for m in re.finditer(r'(?:^|[\s("\'`\[])([A-Za-z0-9_][A-Za-z0-9_./-]*\.[A-Za-z0-9]{1,5})(?=[\s)",;:\'\].]|$)', text):
    p = m.group(1).lstrip('./').rstrip(':;,)"\']')
    if p and '..' not in p and len(p) <= 256 and p not in seen:
        seen.append(p)
print(",".join(seen[:25]))
PY
)"
LOCKED_FILES_JSON=""
if [ -n "$TASK_FILES" ]; then
  LOCKED_FILES_JSON=$(node "$FILE_LOCKS_CLI" claim "--bug-id=$BUG_ID" "--tool=$REQUESTED_TOOL" "--pid=$$" "--area=$DISPATCH_AREA" "--worktree=$CODER_DIR" "--files=$TASK_FILES" 2>/dev/null || echo "")
fi
LOCK_CONFLICTS=""
LOCKED_FILES=""
if [ -n "$LOCKED_FILES_JSON" ]; then
  LOCKED_FILES=$(python3 -c 'import json,sys; print(",".join(json.loads(sys.argv[1]).get("claimed",[])))' "$LOCKED_FILES_JSON" 2>/dev/null || true)
  LOCK_CONFLICTS=$(python3 -c 'import json,sys; print("\n".join(f"{c[\"file\"]} (held by {c[\"holder\"].get(\"bugId\",\"?\")} / {c[\"holder\"].get(\"tool\",\"?\")})" for c in json.loads(sys.argv[1]).get("conflicts",[])))' "$LOCKED_FILES_JSON" 2>/dev/null || true)
fi
if [ -n "$LOCK_CONFLICTS" ]; then
  echo "[Dispatcher] File overlap (advisory): $BUG_ID routes around live claims:"
  printf '%s\n' "$LOCK_CONFLICTS" | while IFS= read -r line; do echo "[Dispatcher]   locked: $line"; done
fi

START_TIME=$(date +%s)
CURRENT_LOG="${HERMES_DIR}/logs/dispatch_${BUG_ID}_${REQUESTED_TOOL}.log"

LOCKED_FILES_ARR=$(python3 -c 'import json,sys; print(json.dumps([s for s in sys.argv[1].split(",") if s]))' "${LOCKED_FILES:-}" 2>/dev/null || echo "[]")
cat <<JSON > "$RUN_LOCK_FILE"
{
  "pid": $$,
  "bug_id": "${BUG_ID}",
  "ticket": $(python3 -c 'import json, sys; print(json.dumps(sys.argv[1]))' "${TICKET:-}"),
  "category": "${CATEGORY}",
  "tool": "${REQUESTED_TOOL}",
  "model": "${PREFERRED_MODEL}",
  "thinking": "${THINKING}",
  "start_time": ${START_TIME},
  "log_file": "${CURRENT_LOG}",
  "area": "${DISPATCH_AREA}",
  "worktree": "${CODER_DIR}",
  "defect_component": $(python3 -c 'import json, sys; print(json.dumps(sys.argv[1]))' "$PACKED_COMPONENT"),
  "defect_fingerprint": $(python3 -c 'import json, sys; print(json.dumps(sys.argv[1]))' "$PACKED_FINGERPRINT"),
  "lock_files": ${LOCKED_FILES_ARR},
  "task": $(python3 -c 'import json, sys; print(json.dumps(sys.argv[1]))' "$TASK")
}
JSON
cp "$RUN_LOCK_FILE" "$RUN_ACTIVE_FILE" 2>/dev/null || true
WE_OWN_LOCK=1
if [ -n "$TICKET" ]; then
  # V-30.4 attempt START row: puts the card in_fix (queue in_progress) and
  # marks this run as the fixer author (verifier must be someone else).
  ticket_attempt_row "start" "dispatch start tool=$REQUESTED_TOOL model=$PREFERRED_MODEL thinking=$THINKING"
  TICKET_ATTEMPT_OPEN=1
fi
if [ -n "$LOCK_CONFLICTS" ]; then
  bash "$TELEGRAM_SCRIPT" --profile="$DISPATCH_PROFILE" --text="⚠️ *[Orchestrator]* \`$BUG_ID\` starts in parallel — routing around live file claims:
$(printf '%s' "$LOCK_CONFLICTS" | head -n 8)" 2>/dev/null || true
fi

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
# BOT-15: Outcome-ledger pre-action gate + outcome recording.
# The gate reads the run ledger in code, beside the file locks, before any
# edit (a prompt footer is not the gate). A repeated signature never blocks
# the run — it warns that the repeat must yield one test or rule that day.
# One outcome row per dispatch is recorded at the terminal points below.
# ---------------------------------------------------------------
LEDGER_HELPER="${REPO_DIR}/scripts/lib/run-ledger.mjs"
LEDGER_DEFECT_CLASS="${PACKED_FINGERPRINT:-$CATEGORY}"
check_run_ledger() {
  [ -f "$LEDGER_HELPER" ] || return 0
  local ledger_res="" ledger_status=0
  set +e
  ledger_res=$(node "$LEDGER_HELPER" check --ticket="$BUG_ID" --surface="${DISPATCH_PROFILE:-orchestrator}" --provider="$REQUESTED_TOOL" --model="${PREFERRED_MODEL:-default}" --defect-class="$LEDGER_DEFECT_CLASS" 2>&1)
  ledger_status=$?
  set -e
  if [ "$ledger_status" -eq 2 ] || printf '%s' "$ledger_res" | grep -q '"duplicate": *true'; then
    local ledger_sig
    ledger_sig=$(printf '%s' "$ledger_res" | python3 -c 'import json,sys; print(json.loads(sys.stdin.read()).get("signature",""))' 2>/dev/null || echo "")
    echo "[Dispatcher] WARNING: BOT-15 duplicate dispatch signature on $BUG_ID (sig=$ledger_sig). This repeat must yield one test or rule today." >&2
    tg_msg "⚠️ *[RunLedger]* Second identical dispatch signature on \`$BUG_ID\` (sig \`$ledger_sig\`). This repeat must produce one test or rule today — not a third debug." || true
  fi
}
record_run_outcome() {
  local outcome="$1" provider="${2:-$REQUESTED_TOOL}" model="${3:-${PREFERRED_MODEL:-default}}"
  [ -f "$LEDGER_HELPER" ] || return 0
  node "$LEDGER_HELPER" record \
    --ticket="$BUG_ID" \
    --surface="${DISPATCH_PROFILE:-orchestrator}" \
    --provider="$provider" \
    --model="$model" \
    --defect-class="$LEDGER_DEFECT_CLASS" \
    --wall-clock=$(( ($(date +%s) - START_TIME) * 1000 )) \
    --outcome="$outcome" >/dev/null 2>&1 || true
}
check_run_ledger

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
      # EXIT cleans the typing loop; INT/TERM must EXIT this subshell — the
      # old handler only killed typing and kept looping, so stop_heartbeat's
      # `wait` never returned and the dispatch stalled after every run.
      trap "kill $TYPING_PID 2>/dev/null || true" EXIT
      trap "exit 0" INT TERM

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
  git -C "$CODER_DIR" status --porcelain | grep -v 'src/git-version.generated.ts' > "$SNAP_FILE" || true
}

# Lines that appeared after snapshot_workspace. Pre-existing dirt does not count.
new_changes() {
  local now
  now=$(mktemp)
  git -C "$CODER_DIR" status --porcelain | grep -v 'src/git-version.generated.ts' > "$now" || true
  if [ -n "$SNAP_FILE" ] && [ -f "$SNAP_FILE" ]; then
    comm -13 <(sort "$SNAP_FILE") <(sort "$now") || true
  else
    cat "$now" || true
  fi
  rm -f "$now"
}

commit_fix() {
  local msg="$1"
  if git -C "$CODER_DIR" config user.email >/dev/null 2>&1; then
    git -C "$CODER_DIR" commit -m "$msg"
  else
    GIT_AUTHOR_NAME="${GIT_AUTHOR_NAME:-cwahli}" \
    GIT_AUTHOR_EMAIL="${GIT_AUTHOR_EMAIL:-cwahli@users.noreply.github.com}" \
    GIT_COMMITTER_NAME="${GIT_COMMITTER_NAME:-cwahli}" \
    GIT_COMMITTER_EMAIL="${GIT_COMMITTER_EMAIL:-cwahli@users.noreply.github.com}" \
    git -C "$CODER_DIR" commit -m "$msg"
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

  tg_msg "📝 *[Orchestrator]* Code modified by *$tool_name* (\`$BUG_ID\`, worktree \`$CODER_DIR\`):
\`\`\`
$(printf '%s\n' "$diff_files" | head -10)
\`\`\`
Running TypeScript build check ('npx tsc --noEmit')..."

  local tsc_output
  if tsc_output=$(git -C "$CODER_DIR" rev-parse --show-toplevel >/dev/null 2>&1 && (cd "$CODER_DIR" && npx tsc --noEmit 2>&1)); then
    echo "[Dispatcher] tsc clean."

    # BOT-23: Pre-dispatch dev regression & blast radius verification
    echo "[Dispatcher] Running pre-dispatch dev regression & blast radius check (BOT-23)..."
    local reg_output reg_status=0
    local REG_HELPER="${REPO_DIR}/scripts/lib/dev-regression.mjs"
    if [ -f "$REG_HELPER" ]; then
      set +e
      reg_output=$(node "$REG_HELPER" --dir="$CODER_DIR" 2>&1)
      reg_status=$?
      set -e
      if [ "$reg_status" -ne 0 ]; then
        echo "[Dispatcher] Pre-dispatch regression check failed (exit $reg_status):"
        echo "$reg_output"
        local reg_tail
        reg_tail=$(printf '%s\n' "$reg_output" | tail -n 8 | tr -d '`' | cut -c1-350)
        tg_msg "❌ *[Orchestrator]* Pre-dispatch regression check failed after *$tool_name* (\`$BUG_ID\`):
\`\`\`
${reg_tail:-Regression test or Rule L1 blast radius failure}
\`\`\`
Reverting this attempt's uncommitted changes..."
        clean_workspace
        return 1
      fi
      echo "[Dispatcher] Dev regression passed cleanly."
    fi

    echo "[Dispatcher] All pre-commit checks green — committing real changes..."
    local line path
    while IFS= read -r line; do
      [ -z "$line" ] && continue
      path="${line:3}"
      [ -n "$path" ] && git -C "$CODER_DIR" add -- "$path" || true
    done <<< "$diff_files"
    if ! commit_fix "fix($CATEGORY): $BUG_ID via $tool_name ($model_desc)"; then
      echo "[Dispatcher] git commit failed."
      tg_msg "⚠️ *[Orchestrator]* *$tool_name* edited files for \`$BUG_ID\`, but \`git commit\` failed."
      return 1
    fi
    # Push the per-run branch (never main directly). Parallel runs land on
    # agent/dispatch-* branches; claim-guard blocks same-file overlap at PR.
    run_branch=$(git -C "$CODER_DIR" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")
    if [ "$run_branch" = "main" ] || [ -z "$run_branch" ]; then
      run_branch="agent/dispatch-${DISPATCH_AREA}"
      git -C "$CODER_DIR" checkout -b "$run_branch" 2>/dev/null || true
    fi
    if ! git -C "$CODER_DIR" push -u origin "$run_branch"; then
      echo "[Dispatcher] Error: git push $run_branch failed."
      tg_msg "⚠️ *[Orchestrator]* Fix coded by *$tool_name* on \`$run_branch\`, but \`git push\` failed. Check GitHub credentials on VPS (SSH key or PAT)."
      return 1
    fi
    local commit_hash
    commit_hash=$(git -C "$CODER_DIR" rev-parse --short HEAD)
    tg_msg "🚀 *[Orchestrator]* Fix committed and pushed to \`$run_branch\` (\`$commit_hash\`). Merges sequentially; claim-guard blocks same-file overlap."
    node "${REPO_DIR}/scripts/tool-allowance.mjs" report-result --tool="$tool_name" --status="success" --bug-id="$BUG_ID" --category="$CATEGORY" --duration=$(( $(date +%s) - START_TIME )) || true
    record_audit "$tool_name" "$model_desc" "resolved" "deployed_pending_qa"
    record_run_outcome "committed" "$tool_name" "$model_desc"
    if [ -n "$TICKET" ]; then
      # V-30.4 attempt END row: applied=true moves the card to verifying —
      # a journey green alone never closes it; only a named_test by a
      # verifier who did not author this fix does.
      ticket_attempt_row "committed" "pushed $run_branch ($commit_hash); awaiting non-author verifier" "true"
      TICKET_ATTEMPT_OPEN=0
    fi
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
  # Scoped to THIS run's worktree + THIS attempt's snapshot. Never touches
  # the shared checkout, so other parallel agents keep their edits.
  local line path
  while IFS= read -r line; do
    [ -z "$line" ] && continue
    path="${line:3}"
    [ -z "$path" ] && continue
    case "$line" in
      \?\?*) rm -rf -- "$CODER_DIR/$path" ;;
      *) git -C "$CODER_DIR" checkout -- "$path" >/dev/null 2>&1 || true ;;
    esac
  done < <(new_changes)
  snapshot_workspace
}

# ---------------------------------------------------------------
# Build full task prompt including screenshot reference & hints
# ---------------------------------------------------------------
build_prompt() {
  local base_prompt="Task for $BUG_ID ($CATEGORY): $TASK

[DEFECT CARD (V-30.2 single defect)]:
- Component: $PACKED_COMPONENT
- Observed: $PACKED_OBSERVED
- Expected: $PACKED_EXPECTED
- Acceptance Criteria: $PACKED_CRITERIA
- Fingerprint: $PACKED_FINGERPRINT"

  if [ -n "${TICKET:-}" ]; then
    base_prompt="${base_prompt}

[TICKET PACKET (V-30.4 — the packet, not chat history, is your instruction)]:
- Card: ${TICKET} (tag ${TAG_ID}) · state=${TICKET_STATE} · surface=${SURFACE:-—} · assignee=${TICKET_ASSIGNEE:-—}
- Title: ${TITLE:-—}${REPRO_TEXT}

[PLAN (posted before this dispatch)]:
- Hypothesis: ${TICKET_HYP:-—}
- Files: ${TICKET_FILES:-—}
- Gates: ${TICKET_GATES:-—}"
    if [ -n "$SPEC_TEXT" ]; then
      base_prompt="${base_prompt}

[LOCKED SPEC — Understanding / Layer / Forbidden patch bind this run; edit_mode + allowed_files are hard limits]:
${SPEC_TEXT}"
    fi
    base_prompt="${base_prompt}

[VERIFICATION CONTRACT — author ≠ verifier]:
- You are the FIXER. Never post verify/close yourself: a QA verifier that did NOT author this fix runs the named gate (${TICKET_GATES:-see plan}) and posts verify with method=named_test.
- A green journey run alone leaves the card in verifying; only named_test (or a manual human check) closes it.
- Push the run branch only — never main; the repository PR flow merges."
  fi

  if [ -n "$SPLIT_LIST_TEXT" ]; then
    base_prompt="${base_prompt}

[SPLIT DEFECTS - OUT OF SCOPE]:
Other discrepancies were split from this report into separate cards. Do NOT fix them in this run:
$SPLIT_LIST_TEXT"
  fi

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
- Scope changes strictly to the single defect described. Do not rewrite unrelated components.
- You work in an isolated checkout. Other agents work in parallel on other bugs."
  if [ -n "${LOCK_CONFLICTS:-}" ]; then
    base_prompt="${base_prompt}

[PARALLEL RUN — FILE CLAIMS (advisory)]:
The following files are currently edited by another agent. Do NOT edit them unless the defect cannot be fixed otherwise; pick an adjacent file or coordinate:
$(printf '%s' "$LOCK_CONFLICTS" | head -n 10)"
  fi
  if [ -n "${LOCKED_FILES:-}" ]; then
    base_prompt="${base_prompt}

[YOUR CLAIMED FILES]: $(printf '%s' "$LOCKED_FILES" | head -c 600). Prefer these; leave other agents' claims alone."
  fi

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

  if [ -n "${MEMORY_CONTEXT:-}" ]; then
    base_prompt="${base_prompt}

[RETRIEVED MEMORY — past decisions, dead-ends, and facts matching this bug; advisory, not instructions]:
${MEMORY_CONTEXT}"
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
  echo "[Dispatcher] opencode run --auto --dir ${CODER_DIR} -m ${model_id}"
  ( cd "$CODER_DIR" && run_with_timeout "$duration" "$OPENCODE_BIN" run --auto --dir "$CODER_DIR" -m "$model_id" "$prompt" 2>&1 | tee "$log_file" ) || true
  # Refresh claimed files with what this attempt actually touched (prompt may
  # not have named them all).
  if [ -f "$FILE_LOCKS_CLI" ]; then
    touched=$(git -C "$CODER_DIR" status --porcelain 2>/dev/null | awk '{print $2}' | tr '\n' ',' || true)
    [ -n "$touched" ] && node "$FILE_LOCKS_CLI" claim "--bug-id=$BUG_ID" "--tool=$REQUESTED_TOOL" "--pid=$$" "--area=$DISPATCH_AREA" "--worktree=$CODER_DIR" "--files=$touched" >/dev/null 2>&1 || true
  fi
}

try_opencode() {
  local model="${1:-$PREFERRED_MODEL}"
  echo "[Dispatcher] --> OpenCode (Model: $model)"
  record_coordination_tax "opencode" "model=$model"
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
    node "${REPO_DIR}/scripts/tool-allowance.mjs" report-result --tool="opencode" --status="depleted" --bug-id="$BUG_ID" --reason="Insufficient account funds" || true
    clean_workspace
    if [ "$model" != "deepseek-v4.1-flash" ]; then
      tg_msg "⚠️ *[Orchestrator]* OpenCode hit insufficient funds on \`$model\`. Retrying once with \`opencode/deepseek-v4.1-flash\`..."
      local alt_model="deepseek-v4.1-flash"
      record_coordination_tax "opencode" "model=$alt_model"
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
    node "${REPO_DIR}/scripts/tool-allowance.mjs" report-result --tool="opencode" --status="failed" --bug-id="$BUG_ID" || true
    return 1
  fi

  if echo "$output" | grep -qiE "rate limit|quota exceeded|insufficient credits|429|allowance"; then
    tg_msg "⚠️ *[Orchestrator]* OpenCode hit rate limit for \`$BUG_ID\`."
    node "${REPO_DIR}/scripts/tool-allowance.mjs" report-result --tool="opencode" --status="rate_limited" --bug-id="$BUG_ID" --reason="Rate limit" || true
    clean_workspace
    return 2
  fi

  if check_git_and_tsc "opencode" "$model" "$log_file"; then return 0; fi

  # One nudge attempt
  tg_msg "🔄 *[Orchestrator]* OpenCode nudged to retry \`$BUG_ID\`..."
  record_coordination_tax "opencode_nudge" "model=$model"
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
  node "${REPO_DIR}/scripts/tool-allowance.mjs" report-result --tool="opencode" --status="failed" --bug-id="$BUG_ID" || true
  return 1
}

try_cline() {
  local thinking="${THINKING:-high}"
  echo "[Dispatcher] --> Cline CLI (Thinking: $thinking)"
  record_coordination_tax "cline" "thinking=$thinking"
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
  ( cd "$CODER_DIR" && run_with_timeout 8m "$CLINE_BIN" --auto-approve true --thinking "$thinking" "$prompt" 2>&1 | tee "$log_file" ) || true
  stop_heartbeat

  local output; output=$(cat "$log_file" 2>/dev/null || true)

  if echo "$output" | grep -qiE "rate limit|quota exceeded|insufficient credits|429|exhausted|allowance"; then
    tg_msg "⚠️ *[Orchestrator]* Cline hit rate limit for \`$BUG_ID\`."
    node "${REPO_DIR}/scripts/tool-allowance.mjs" report-result --tool="cline" --status="rate_limited" --bug-id="$BUG_ID" --reason="Rate limit" || true
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
  node "${REPO_DIR}/scripts/tool-allowance.mjs" report-result --tool="cline" --status="failed" --bug-id="$BUG_ID" || true
  return 1
}

try_grok() {
  echo "[Dispatcher] --> Grok Build CLI"
  record_coordination_tax "grok" "default"
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
  ( cd "$CODER_DIR" && run_with_timeout 6m "$GROK_BIN" -p "$prompt" 2>&1 | tee "$log_file" ) || true
  stop_heartbeat

  local output; output=$(cat "$log_file" 2>/dev/null || true)

  if echo "$output" | grep -qiE "rate limit|quota exceeded|429"; then
    if [ "$CASCADE" -eq 1 ]; then
      tg_msg "⚠️ *[Orchestrator]* Grok hit rate limit for \`$BUG_ID\`. Trying Agy..."
    else
      tg_msg "⚠️ *[Orchestrator]* Grok hit rate limit for \`$BUG_ID\`."
    fi
    node "${REPO_DIR}/scripts/tool-allowance.mjs" report-result --tool="grok" --status="rate_limited" --bug-id="$BUG_ID" || true
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
  node "${REPO_DIR}/scripts/tool-allowance.mjs" report-result --tool="grok" --status="failed" --bug-id="$BUG_ID" || true
  return 1
}

try_agy() {
  echo "[Dispatcher] --> Antigravity CLI"
  record_coordination_tax "antigravity" "default"
  if [ ! -x "$AGY_BIN" ]; then
    echo "[Dispatcher] Antigravity CLI not executable at $AGY_BIN, skipping."
    tg_msg "⚠️ *[Orchestrator]* Antigravity CLI not found or executable."
    return 1
  fi

  if node "${REPO_DIR}/scripts/tool-allowance.mjs" status 2>/dev/null | grep -i 'Antigravity' | grep -qi 'unavailable'; then
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
  ( cd "$CODER_DIR" && run_with_timeout 8m "$AGY_BIN" -p "$prompt" 2>&1 | tee "$log_file" ) || true
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
AGENT_LIST="$(node "${REPO_DIR}/scripts/tool-allowance.mjs" status 2>/dev/null | grep '^-' | sed 's/^- /• /' | head -4 || echo '• OpenCode • Cline • Grok • Agy')"
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
  BEST_TOOL=$(node "${REPO_DIR}/scripts/tool-allowance.mjs" pick-tool --category="$CATEGORY" 2>/dev/null | grep '"tool":' | head -n1 | cut -d '"' -f4)
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
    BEST_TOOL=$(node "${REPO_DIR}/scripts/tool-allowance.mjs" pick-tool --category="$CATEGORY" 2>/dev/null | grep '"tool":' | head -n1 | cut -d '"' -f4)
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
  record_run_outcome "escalated" "none" "none"
  ticket_fail_and_block "dispatch failed: all cascade agents exhausted (${TOOL_SEQUENCE[*]})"
  tg_msg "🚨 *[Orchestrator]* All automated cascade agents exhausted for \`$BUG_ID\`.
*Agents tried:* ${TOOL_SEQUENCE[*]}
*Bug:* $TASK

Human intervention required. Please review the bug and assign manually."
  exit 1
else
  record_run_outcome "unresolved" "${TOOL_SEQUENCE[0]}" "${PREFERRED_MODEL:-default}"
  ticket_fail_and_block "dispatch failed: ${TOOL_SEQUENCE[0]} did not resolve (no fix committed)"
  tg_msg "⚠️ *[Orchestrator]* Agent *${TOOL_SEQUENCE[0]}* did not resolve \`$BUG_ID\`.
Orchestrator awaiting next action or alternate model selection."
  exit 1
fi
