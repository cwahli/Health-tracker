#!/data/data/com.termux/files/usr/bin/bash
LOG="$HOME/mobile-opencode-bot.log"
exec 200>"$HOME/.mobile-opencode-bot.lock"
flock -n 200 || { echo "another wrapper holds the lock, exiting"; exit 0; }
echo "=== start $(date -u +%FT%TZ) ===" >> "$LOG"
while true; do
  proot-distro login ubuntu -- bash -c 'set -a; . /root/.config/opencode-bot/mobile.env; set +a; cd /root/Health-tracker && exec node scripts/bot-host.mjs --id=mobile' >> "$LOG" 2>&1
  ec=$?
  echo "=== exited $(date -u +%FT%TZ) code=$ec restart in 5s ===" >> "$LOG"
  sleep 5
done
