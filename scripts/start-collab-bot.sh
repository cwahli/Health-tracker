#!/usr/bin/env bash
# scripts/start-collab-bot.sh
# Starts Colab Bot daemon inside proot environment

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

ENV_FILE="${HOME}/.config/opencode-bot/collab.env"
if [ -f "$ENV_FILE" ]; then
  echo "[start-collab-bot] Sourcing environment from $ENV_FILE"
  set -a
  source "$ENV_FILE"
  set +a
fi

echo "=========================================================="
echo " Starting Colab Bot Daemon (@Collab_bot)"
echo " Workspace: $REPO_ROOT"
echo "=========================================================="

exec node scripts/collab-bot.mjs --id=collab
