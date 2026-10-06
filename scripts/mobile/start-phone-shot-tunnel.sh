#!/data/data/com.termux/files/usr/bin/bash
# Persistent REVERSE tunnel: VPS 127.0.0.1:7777 -> this phone's shot-server.
# Lets the box read the phone's screenshots while the phone keeps dialing out,
# same direction as start-vm-relay-tunnel.sh -- nothing ever connects inbound to
# the phone. Serve the files first (shot-server.mjs), then this.
#
# The two options that are not decoration:
#   ServerAliveInterval/CountMax -- a phone that loses LTE does not find out for
#     minutes; it just stops answering. These notice it in ~60s.
#   ExitOnForwardFailure=yes -- without it, ssh happily runs a session in which
#     the forward was REFUSED (the old zombie session still holds :7777) and
#     never retries. That is the difference between a 60s blip and "TUI is
#     offline" printed three times in a row while the tunnel stays dead until
#     someone restarts the phone. With it, this loop retries every SHOT_RETRY.
# Both sides matter: the VPS must also reclaim a dead session quickly
# (ClientAliveInterval -- see scripts/mobile/sshd-shot-bridge.conf).
LOG="$HOME/phone-shot-tunnel.log"
exec 200>"$HOME/.phone-shot-tunnel.lock"
flock -n 200 || { echo "another tunnel holds the lock, exiting"; exit 0; }

KEY="${SHOT_SSH_KEY:-$HOME/.ssh/moshi_vps}"
SSH_USER="${SHOT_SSH_USER:-ubuntu}"
SSH_HOST="${SHOT_SSH_HOST:-health-tracker.co.uk}"
SSH_PORT="${SHOT_SSH_PORT:-22}"
REMOTE_PORT="${SHOT_TUNNEL_PORT:-7777}"   # the port pull_shot.sh dials on the VPS
LOCAL_PORT="${SHOT_SERVER_PORT:-7788}"    # shot-server.mjs on this phone
RETRY="${SHOT_RETRY:-5}"

echo "=== shot tunnel start $(date -u +%FT%TZ) ===" >> "$LOG"
while true; do
  ssh -N -R "127.0.0.1:${REMOTE_PORT}:localhost:${LOCAL_PORT}" \
    -o ServerAliveInterval=20 -o ServerAliveCountMax=3 \
    -o ExitOnForwardFailure=yes -o BatchMode=yes \
    -o ConnectTimeout=15 \
    -p "$SSH_PORT" -i "$KEY" \
    "$SSH_USER@$SSH_HOST" >>"$LOG" 2>&1
  echo "=== shot tunnel exited code=$? $(date -u +%FT%TZ) restart in ${RETRY}s ===" >> "$LOG"
  sleep "$RETRY"
done
