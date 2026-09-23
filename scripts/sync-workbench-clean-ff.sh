#!/usr/bin/env bash
# scripts/sync-workbench-clean-ff.sh
#
# Keeps VPS workbench checkouts (dev/base + per-agent worktrees) close to
# origin WITHOUT ever touching in-flight work.
#
# Rule: fast-forward a workbench ONLY when its tree is fully clean
# (`git status --porcelain` empty). Dirty tree (uncommitted edits, untracked
# files, staged changes) => skip with a log line, never stash/reset/merge.
#
# Safe to run from cron every few minutes. Overlaps with itself are locked out.
#
# Usage:
#   scripts/sync-workbench-clean-ff.sh [--roots "dir1 dir2"] [--log file]
#
# Env overrides:
#   WORKBENCH_ROOTS  space-separated checkout dirs (default: the VPS dev base
#                    plus every worktree under /home/ubuntu/dev)
#   SYNC_LOG         log file (default ~/.hermes/sync-workbench.log)
#
# Exit 0 always unless the lock cannot be taken (exit 3) — a skipped dirty
# tree is a normal outcome, not a failure.

set -u

LOCK_FILE="${SYNC_LOCK_FILE:-/tmp/sync-workbench-clean-ff.lock}"
LOG_FILE="${SYNC_LOG:-$HOME/.hermes/sync-workbench.log}"
ROOTS="${WORKBENCH_ROOTS:-}"

if [ $# -gt 0 ]; then
  while [ $# -gt 0 ]; do
    case "$1" in
      --roots)
        ROOTS="$2"; shift 2 ;;
      --roots=*)
        ROOTS="${1#*=}"; shift ;;
      --log)
        LOG_FILE="$2"; shift 2 ;;
      --log=*)
        LOG_FILE="${1#*=}"; shift ;;
      *)
        echo "Usage: $0 [--roots \"dir1 dir2\"] [--log file]" >&2
        exit 2 ;;
    esac
  done
fi

if [ -z "$ROOTS" ]; then
  ROOTS="/home/ubuntu/src/Health-tracker"
  for d in /home/ubuntu/dev/*/; do
    [ -d "$d" ] && ROOTS="$ROOTS $d"
  done
fi

log() {
  local line="[$(date -u +%FT%TZ)] $*"
  echo "$line"
  mkdir -p "$(dirname "$LOG_FILE")" 2>/dev/null || true
  echo "$line" >> "$LOG_FILE" 2>/dev/null || true
}

# Single-flight: a second cron tick while one runs must exit, not stack.
exec 9>"$LOCK_FILE" 2>/dev/null || exit 3
if ! flock -n 9 2>/dev/null; then
  log "SKIP another sync run holds the lock"
  exit 3
fi

pulled=0
current=0
skipped=0

for root in $ROOTS; do
  [ -d "$root/.git" ] || continue
  branch="$(git -C "$root" rev-parse --abbrev-ref HEAD 2>/dev/null || echo '?')"
  [ "$branch" = "HEAD" ] && { log "SKIP $root: detached HEAD"; skipped=$((skipped+1)); continue; }

  if ! git -C "$root" fetch origin --quiet 2>/dev/null; then
    log "SKIP $root: fetch failed (offline?)"
    skipped=$((skipped+1))
    continue
  fi

  upstream="$(git -C "$root" rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null || true)"
  if [ -z "$upstream" ]; then
    log "SKIP $root [$branch]: no upstream"
    skipped=$((skipped+1))
    continue
  fi

  behind="$(git -C "$root" rev-list --count "HEAD..$upstream" 2>/dev/null || echo 0)"
  if [ "$behind" = "0" ]; then
    current=$((current+1))
    continue
  fi

  # THE guard: anything uncommitted/untracked/staged => hands off.
  if [ -n "$(git -C "$root" status --porcelain 2>/dev/null)" ]; then
    log "SKIP $root [$branch]: behind by $behind but tree is dirty — left untouched"
    skipped=$((skipped+1))
    continue
  fi

  if git -C "$root" merge --ff-only "$upstream" --quiet 2>/dev/null; then
    log "PULLED $root [$branch]: fast-forwarded $behind commit(s)"
    pulled=$((pulled+1))
  else
    log "SKIP $root [$branch]: behind by $behind but not fast-forwardable (diverged) — left untouched"
    skipped=$((skipped+1))
  fi
done

log "done: pulled=$pulled current=$current skipped=$skipped"
