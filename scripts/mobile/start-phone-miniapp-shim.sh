#!/data/data/com.termux/files/usr/bin/bash
# Cookie login shim for the opencode web UI (Telegram Mini App).
# opencode's own HTTP Basic auth cannot be answered inside Telegram's WebView,
# so this sits in front of it, owns the lock with a real login form + cookie,
# and proxies with the Basic header added. The cloudflared tunnel points here
# (8895) instead of at opencode (8894), so the Basic challenge is never public.
LOG="$HOME/phone-miniapp-shim.log"
ENV_FILE="/data/data/com.termux/files/usr/var/lib/proot-distro/containers/ubuntu/rootfs/root/.config/opencode-bot/miniapp.env"
exec 200>"$HOME/.phone-miniapp-shim.lock"
flock -n 200 || { echo "another shim holds the lock, exiting"; exit 0; }
echo "=== shim start $(date -u +%FT%TZ) ===" >> "$LOG"
while true; do
  MINIAPP_PASSWORD=$(sed -n 's/^OPENCODE_SERVER_PASSWORD=//p' "$ENV_FILE" | tail -n 1)
  MINIAPP_PASSWORD=${MINIAPP_PASSWORD%\"}; MINIAPP_PASSWORD=${MINIAPP_PASSWORD#\"}
  if [ -z "$MINIAPP_PASSWORD" ]; then
    echo "=== no password in $ENV_FILE — refusing to serve opencode unauthenticated ===" >> "$LOG"
    sleep 30
    continue
  fi
  MINIAPP_SHIM_PORT="${MINIAPP_SHIM_PORT:-8895}" \

  MINIAPP_PASSWORD="$MINIAPP_PASSWORD" \
    node "$HOME/miniapp-shim.mjs" >> "$LOG" 2>&1
  ec=$?
  echo "=== shim exited $(date -u +%FT%TZ) code=$ec restart in 5s ===" >> "$LOG"
  sleep 5
done
