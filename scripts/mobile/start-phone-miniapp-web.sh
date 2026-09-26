#!/data/data/com.termux/files/usr/bin/bash
# Phone-hosted opencode web UI for the Telegram Mini App test.
# Binds loopback only; the cloudflared wrapper exposes it publicly.
LOG="$HOME/phone-miniapp-web.log"
exec 200>"$HOME/.phone-miniapp-web.lock"
flock -n 200 || { echo "another web UI holds the lock, exiting"; exit 0; }
echo "=== web start $(date -u +%FT%TZ) ===" >> "$LOG"
while true; do
  proot-distro login ubuntu -- bash -c 'set -a; . /root/.config/opencode-bot/miniapp.env; set +a; cd /root/Health-tracker && exec /root/.opencode/bin/opencode web --port "${MINIAPP_PORT:-8894}" --hostname 127.0.0.1' >> "$LOG" 2>&1
  ec=$?
  echo "=== web exited $(date -u +%FT%TZ) code=$ec restart in 5s ===" >> "$LOG"
  sleep 5
done
