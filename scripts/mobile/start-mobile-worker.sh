#!/data/data/com.termux/files/usr/bin/bash
# Phone-side worker: claims /location-routed turns from the VM relay and runs
# them here, on the phone's own allowance and ledger. Requires the SSH tunnel
# (start-vm-relay-tunnel.sh) so 127.0.0.1:8890 reaches the VM relay.
LOG="$HOME/mobile-worker.log"
exec 200>"$HOME/.mobile-worker.lock"
flock -n 200 || { echo "another worker holds the lock, exiting"; exit 0; }
echo "=== worker start $(date -u +%FT%TZ) ===" >> "$LOG"
while true; do
  proot-distro login ubuntu -- bash -c 'set -a; . /root/.config/opencode-bot/mobile.env; set +a; cd /root/Health-tracker && OPENCODE_BIN=/root/.opencode/bin/opencode exec node scripts/worker-agent.mjs --host=mobile --relay=http://127.0.0.1:8890 --no-pid' >> "$LOG" 2>&1
  ec=$?
  echo "=== worker exited $(date -u +%FT%TZ) code=$ec restart in 5s ===" >> "$LOG"
  sleep 5
done
