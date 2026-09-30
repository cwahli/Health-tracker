#!/bin/bash
# scripts/meal-audit-cron.sh — the scheduled sweep for the meal QA loop.
#
# Deliberately conservative. Only free models are usable on this box (the Zen
# balance is depleted, `agy` is geo-blocked), so an aggressive schedule would
# burn quota without converging. Hourly, small selection, and DRY-RUN BY DEFAULT.
#
# The dry-run default is the important part: this installs the machinery and the
# observability without letting an unattended loop start dispatching coders on
# day one. Flip MEAL_QA_ALLOW_DISPATCH=1 only after the audit half has run
# cleanly for a while and the ticket bridge has survived a few real fixes.
#
# Env:
#   MEAL_QA_LATEST=3            meals per sweep (default 3)
#   MEAL_QA_ALLOW_DISPATCH=1    permit dispatch + verify (default: dry-run)
#   MEAL_QA_STATE_DIR           override the log dir (default ~/.hermes/logs)
#
# Install:
#   crontab -e
#   7 * * * * /home/ubuntu/src/Health-tracker/scripts/meal-audit-cron.sh >> ~/.hermes/logs/meal-qa-loop.log 2>&1
#
# The wrapper deliberately runs from the dev base checkout, not /home/ubuntu/deploy
# (the auto-deploy clone, which may be `git reset --hard` at any time).

set -uo pipefail

REPO_DIR="${MEAL_QA_REPO:-/home/ubuntu/src/Health-tracker}"
LOG_DIR="${MEAL_QA_STATE_DIR:-$HOME/.hermes/logs}"
LATEST="${MEAL_QA_LATEST:-3}"
ALLOW_DISPATCH="${MEAL_QA_ALLOW_DISPATCH:-0}"

mkdir -p "$LOG_DIR"
LOCK="$LOG_DIR/meal-audit-loop.lock"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
RUN_LOG="$LOG_DIR/meal-qa-loop-$STAMP.json"

log() { echo "[meal-qa-cron $STAMP] $*"; }

if [ ! -f "$REPO_DIR/scripts/meal-audit-loop.mjs" ]; then
  log "FATAL: loop script missing under $REPO_DIR"
  exit 1
fi

# Single-flight: a slow sweep must not overlap the next hour's tick.
exec 9>"$LOCK"
if ! flock -n 9; then
  log "SKIP: another sweep is still running (lock held)."
  exit 0
fi

cd "$REPO_DIR" || { log "FATAL: cannot cd $REPO_DIR"; exit 1; }

# The server must be up; otherwise the resolver returns nothing and the sweep
# would look "green" while having audited nothing.
if ! curl -fsS -m 5 "http://127.0.0.1:${PORT:-3000}/api/audit/food-search?limit=1" >/dev/null 2>&1; then
  log "SKIP: server not answering on 127.0.0.1:${PORT:-3000} — nothing to audit."
  exit 1
fi

ARGS=(--latest="$LATEST")
if [ "$ALLOW_DISPATCH" = "1" ]; then
  log "mode: LIVE (dispatch enabled)"
else
  ARGS+=(--dry-run)
  log "mode: DRY-RUN (set MEAL_QA_ALLOW_DISPATCH=1 to enable dispatch)"
fi

log "sweeping latest=$LATEST"
node scripts/meal-audit-loop.mjs "${ARGS[@]}" >"$RUN_LOG" 2>>"$LOG_DIR/meal-audit-loop.err"
STATUS=$?

# 0 = completed, 2 = dry-run found divergences (expected while corpus is fresh).
if [ "$STATUS" -eq 0 ] || [ "$STATUS" -eq 2 ]; then
  log "sweep completed (exit $STATUS). summary: $RUN_LOG"
  # Keep the JSON body from growing unbounded.
  find "$LOG_DIR" -name 'meal-audit-loop-*.json' -mtime +14 -delete 2>/dev/null || true
  exit 0
fi

log "sweep FAILED (exit $STATUS). summary: $RUN_LOG ; stderr: $LOG_DIR/meal-audit-loop.err"
exit "$STATUS"
