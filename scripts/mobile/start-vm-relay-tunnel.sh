#!/data/data/com.termux/files/usr/bin/bash
# Persistent SSH tunnel: phone-local 127.0.0.1:8890 -> VM worker-relay.
# Lets worker-agent.mjs on this phone claim jobs from the VM relay without
# exposing the relay publicly. The VM opens nothing inbound to the phone:
# this side dials out, same direction as the worker itself.
LOG="$HOME/vm-relay-tunnel.log"
exec 200>"$HOME/.vm-relay-tunnel.lock"
flock -n 200 || { echo "another tunnel holds the lock, exiting"; exit 0; }
echo "=== tunnel start $(date -u +%FT%TZ) ===" >> "$LOG"
while true; do
  ssh -N -L 8890:localhost:8890 \
    -o ServerAliveInterval=30 -o ServerAliveCountMax=3 \
    -o ExitOnForwardFailure=yes -o BatchMode=yes \
    -o ConnectTimeout=15 \
    -i "$HOME/.ssh/moshi_vps" \
    ubuntu@health-tracking.duckdns.org >>"$LOG" 2>&1
  echo "=== tunnel exited code=$? $(date -u +%FT%TZ) restart in 10s ===" >> "$LOG"
  sleep 10
done
