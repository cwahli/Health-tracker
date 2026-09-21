#!/usr/bin/env bash
# Ephemeral per-area lock, backed by a `lock/<area>` branch on origin.
#
# Why a branch: GitHub's git server only accepts pushes to refs/heads and
# refs/tags, so `refs/locks/*` is not an option. A `lock/<area>` branch is a
# normal ref and the whole thing is pure git over SSH — no GitHub API, no PAT.
#
# Acquire is an atomic compare-and-swap: `--force-with-lease=<ref>:` requires
# the ref to NOT exist, so two agents racing for the same area cannot both win.
#
# Usage:
#   scripts/lock.sh acquire <area>
#   scripts/lock.sh release <area>
#   scripts/lock.sh list
#
# The open PR (see docs/agent/GITHUB_WORKFLOW.md) is the *merge* lock; this
# branch is the short-lived *edit* lock. Release it right after you commit.
set -euo pipefail

usage() { echo "usage: lock.sh acquire <area> | release <area> | list" >&2; exit 2; }

cmd="${1:-}"
area="${2:-}"
ref="refs/heads/lock/${area}"

case "$cmd" in
  acquire)
    [ -n "$area" ] || usage
    if git push --force-with-lease="${ref}:" origin "HEAD:${ref}" >/dev/null 2>&1; then
      echo "lock acquired: ${area}  (${ref} -> $(git rev-parse --short HEAD))"
    else
      echo "lock busy: ${area} is already held. Current locks:" >&2
      git ls-remote origin 'refs/heads/lock/*' >&2 || true
      exit 1
    fi
    ;;
  release)
    [ -n "$area" ] || usage
    git push origin ":${ref}"
    echo "lock released: ${area}"
    ;;
  list)
    git ls-remote origin 'refs/heads/lock/*' || true
    ;;
  *)
    usage
    ;;
esac
