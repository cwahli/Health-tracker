#!/data/data/com.termux/files/usr/bin/bash
# A real typeable TUI inside the Telegram Mini App.
#
# ttyd serves a PTY with its own xterm.js client, so this is the thing the user
# actually asked for: the opencode TUI, in a phone-sized terminal, driven by
# touch.
#
# The command is tui-attach.sh, NOT a hard-coded `opencode`: the TUI has to be
# the *same conversation* the Telegram chat is on, and that session id changes
# (/new, a fresh chat). The script resolves it per attach, refuses to attach
# while the bot is mid-turn on that session, and reaps a tmux session left over
# from a different conversation — `new-session -A` ignores its command when the
# session already exists, so without that the first attach would be stuck on
# whatever it was created with.
#
# Two details that are not obvious:
# - `tmux new-session -A` so the TUI SURVIVES the WebView closing. A bare ttyd
#   spawns the process per client, so every disconnect would kill the session
#   and its context; attaching to a named tmux session means you can close the
#   Mini App, reopen it, and carry on.
# - `-H` hands authentication to the reverse proxy, so the shim's cookie is the
#   only lock in front of it and ttyd never needs its own credential.
LOG="$HOME/phone-tui-ttyd.log"
WT="${TUI_WORKTREE:-/root/Health-tracker}"
exec 200>"$HOME/.phone-tui-ttyd.lock"
flock -n 200 || { echo "another ttyd holds the lock, exiting"; exit 0; }
echo "=== ttyd start $(date -u +%FT%TZ) ===" >> "$LOG"
while true; do
  proot-distro login ubuntu -- bash -c "
    cd '$WT' && exec /usr/bin/ttyd \
      --port 8896 --interface 127.0.0.1 \
      --base-path /tui \
      --writable \
      --max-clients 4 \
      --auth-header x-tui-auth \
      --check-origin \
      --terminal-type xterm-256color \
      --client-option 'fontSize=13' \
      --client-option 'theme={\"background\":\"#0d0d0f\",\"foreground\":\"#e8e8ea\"}' \
      --ping-interval 20 \
      /root/Health-tracker/scripts/mobile/tui-attach.sh
  " >> "$LOG" 2>&1
  ec=$?
  echo "=== ttyd exited $(date -u +%FT%TZ) code=$ec restart in 5s ===" >> "$LOG"
  sleep 5
done
