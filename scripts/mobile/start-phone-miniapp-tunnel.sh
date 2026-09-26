#!/data/data/com.termux/files/usr/bin/bash
# Cloudflared quick tunnel: public https -> phone-local opencode web UI.
# The public URL changes on every reconnect; the current one is extracted to
# $HOME/.phone-miniapp-url for the bot's /web button. Nothing secret here —
# the opencode UI itself is password-gated (miniapp.env).
LOG="$HOME/phone-miniapp-tunnel.log"
URL_FILE="$HOME/.phone-miniapp-url"
exec 200>"$HOME/.phone-miniapp-tunnel.lock"
flock -n 200 || { echo "another tunnel holds the lock, exiting"; exit 0; }
echo "=== tunnel start $(date -u +%FT%TZ) ===" >> "$LOG"
while true; do
  rm -f "$URL_FILE"
  # Only a hostname THIS run printed counts. A quick tunnel gets a fresh
  # hostname every reconnect, and the previous one is already in the log — so
  # grepping the whole log republished the dead one on restart and /web handed
  # the phone a URL that no longer resolves.
  MARK=$(wc -c < "$LOG")
  # Point at the auth shim (8895), not at opencode (8894): opencode answers with
  # an HTTP Basic challenge that a Telegram WebView cannot pass, so the tunnel
  # must publish the shim's login form + cookie instead.
  cloudflared tunnel --no-autoupdate --url http://127.0.0.1:8895 >> "$LOG" 2>&1 &
  TUN_PID=$!
  # Wait up to 60s for the public URL, then publish it for /web.
  for _ in $(seq 1 60); do
    URL=$(tail -c "+$((MARK + 1))" "$LOG" | grep -oE 'https://[A-Za-z0-9.-]+\.trycloudflare\.com' | tail -n 1)
    if [ -n "$URL" ]; then
      echo "$URL" > "$URL_FILE"
      echo "=== public url $URL $(date -u +%FT%TZ) ===" >> "$LOG"
      break
    fi
    sleep 1
  done
  wait $TUN_PID
  ec=$?
  echo "=== tunnel exited $(date -u +%FT%TZ) code=$ec restart in 5s ===" >> "$LOG"
  sleep 5
done
