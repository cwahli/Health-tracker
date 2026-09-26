#!/usr/bin/env bash
# Attach the Telegram TUI to THIS chat's opencode session, in the chat's own
# checkout.
#
# Why this is a script and not a bare `opencode` in the ttyd command line:
#
# 1. The session id has to be resolved at ATTACH time, not when ttyd started.
#    The bot rewrites its session per chat (/root/.local/state/bot-host/
#    <bot>/sessions.json) and /new moves it, so a command line captured at boot
#    would pin a stale conversation within minutes.
# 2. `tmux new-session -A` ignores its command argument when the session
#    already exists. Left alone, the very first attach would keep the OLD
#    session (wrong directory, wrong conversation) forever, because the tmux
#    server is a daemon that outlives ttyd. So the id the session was created
#    with is recorded next to it and a mismatch kills the session first.
# 3. One writer at a time. The bot records a lease per chat while a turn runs
#    (leases.json). Attaching the same session while the bot is mid-turn means
#    two agents appending to one conversation, so refuse and say so instead.
set -u

BOT_ID="${TUI_BOT_ID:-mobile}"
STATE="/root/.local/state/bot-host/${BOT_ID}"
SESSIONS="${STATE}/sessions.json"
LEASES="${STATE}/leases.json"
WORKTREE="${TUI_WORKTREE:-/root/Health-tracker}"
TMUX_NAME="${TUI_TMUX_NAME:-opencode-tui}"
SID_MARK="/tmp/tui-session-id"
OPENCODE_BIN="${OPENCODE_BIN:-/root/.opencode/bin/opencode}"

# --- which session is the chat on? (one allowed chat, but read them all)
read -r -d '' NODESCRIPT <<'EOF' || true
const fs = require('fs');
const file = process.argv[1];
try {
  const map = JSON.parse(fs.readFileSync(file, 'utf8'));
  const ids = Object.values(map).map((v) => String(v || '').trim()).filter((v) => /^ses_/.test(v));
  process.stdout.write(ids[0] || '');
} catch { process.stdout.write(''); }
EOF
SID=$(node -e "$NODESCRIPT" "$SESSIONS" 2>/dev/null || true)

# --- is the bot already writing to it?
BUSY=0
if [ -f "$LEASES" ]; then
  BUSY=$(node -e '
    const fs = require("fs");
    try { const m = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); process.stdout.write(Object.keys(m || {}).length ? "1" : "0"); }
    catch { process.stdout.write("0"); }
  ' "$LEASES" 2>/dev/null || echo 0)
fi
if [ "$BUSY" = "1" ]; then
  echo "The Telegram bot is running a turn on this conversation right now."
  echo "Two agents writing one session is how a conversation gets corrupted,"
  echo "so this will not attach while it runs. Try again in a minute."
  sleep 25
  exit 0
fi

# --- reap a session that belongs to a different conversation
PREV=$(cat "$SID_MARK" 2>/dev/null || true)
if [ -n "$PREV" ] && [ "$PREV" != "$SID" ]; then
  tmux kill-session -t "$TMUX_NAME" 2>/dev/null || true
fi

if [ -z "$SID" ]; then
  echo "No chat session recorded yet — starting a fresh one in ${WORKTREE}."
  echo "Send a message to the bot first and this will pick it up on the next attach."
  echo
  cd "$WORKTREE" && exec tmux new-session -A -s "$TMUX_NAME" "$OPENCODE_BIN"
fi

echo "$SID" > "$SID_MARK"
echo "Attaching to this chat's session in ${WORKTREE}."
echo "Type here and you are typing to the same conversation the bot is in."
echo "Close the Mini App and reopen it any time — tmux keeps your place."
echo
cd "$WORKTREE" && exec tmux new-session -A -s "$TMUX_NAME" "$OPENCODE_BIN" --session "$SID"
