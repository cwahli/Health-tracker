#!/bin/bash
# Production deploy for the Health-tracker web service (VPS).
# Installed at /home/ubuntu/deploy.sh; webhook calls it on every push to main.
#
# Deploy target is a DEDICATED clone, not the dev checkout.
# Agents work in /home/ubuntu/dev/<area> worktrees of /home/ubuntu/src/Health-tracker.
# This script may freely `git reset --hard` its own clone; it must never touch a
# developer/agent working tree.
#
# Concurrency: rapid pushes fire several webhook deploys at once, which fight
# over git/npm/build. Serialize with flock; a queued run re-fetches origin/main
# so the LAST push always wins. Stale queued runs whose HEAD is already deployed
# exit early (no-op) instead of redoing npm ci + build + service restart —
# this is what calms deploy storms (e.g. 8 deploys in 40 min) into ~1 real deploy.
set -e
exec 9>/home/ubuntu/.deploy.lock
flock -w 900 9
DEPLOY_DIR=/home/ubuntu/deploy/Health-tracker
DEPLOY_LOG=/home/ubuntu/deploy.log
cd "$DEPLOY_DIR"
git checkout main 2>/dev/null || git checkout -B main origin/main
git fetch origin main
LOCAL_HEAD=$(git rev-parse HEAD)
REMOTE_HEAD=$(git rev-parse origin/main)
if [ "$LOCAL_HEAD" = "$REMOTE_HEAD" ]; then
  echo "=== Deploy skipped at $(date): already at $REMOTE_HEAD ===" >> "$DEPLOY_LOG"
  exit 0
fi
echo "=== Deploy started at $(date) ($LOCAL_HEAD -> $REMOTE_HEAD) ===" >> "$DEPLOY_LOG"
git reset --hard origin/main
npm ci --prefer-offline
npm run build
sudo systemctl restart health-tracker
echo "=== Deploy completed at $(date) ===" >> "$DEPLOY_LOG"
bash "$DEPLOY_DIR/scripts/sync-hermes-skills.sh"
