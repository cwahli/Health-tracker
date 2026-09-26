#!/data/data/com.termux/files/usr/bin/bash
LOG="$HOME/mobile-opencode-bot.log"
exec 200>"$HOME/.mobile-opencode-bot.lock"
flock -n 200 || { echo "another wrapper holds the lock, exiting"; exit 0; }
echo "=== start $(date -u +%FT%TZ) ===" >> "$LOG"
# Restarting fast is how a transient Telegram 409 ("another poller is active")
# turns into a permanent one: each new instance registers before Telegram
# releases the last, collides, exits in seconds, and the 5s loop never lets the
# old poller lapse. So back off on failures that come quickly, and reset only
# after a run that actually lasted. A healthy bot logs nothing and never gets
# here.
BACKOFF_SECONDS=(5 15 45 120)
STREAK=0
while true; do
  STARTED=$(date +%s)
  proot-distro login ubuntu -- bash -c 'set -a; . /root/.config/opencode-bot/mobile.env; set +a; cd /root/Health-tracker && exec node scripts/bot-host.mjs --id=mobile' >> "$LOG" 2>&1
  ec=$?
  RAN=$(( $(date +%s) - STARTED ))
  if [ "$RAN" -gt 120 ]; then
    STREAK=0
  else
    STREAK=$(( STREAK + 1 ))
  fi
  INDEX=$(( STREAK - 1 ))
  [ "$INDEX" -ge "${#BACKOFF_SECONDS[@]}" ] && INDEX=$(( ${#BACKOFF_SECONDS[@]} - 1 ))
  [ "$INDEX" -lt 0 ] && INDEX=0
  SLEEP=${BACKOFF_SECONDS[$INDEX]}
  echo "=== exited $(date -u +%FT%TZ) code=$ec after ${RAN}s; streak=$STREAK restart in ${SLEEP}s ===" >> "$LOG"
  sleep "$SLEEP"
done
