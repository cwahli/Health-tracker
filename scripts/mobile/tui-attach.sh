#!/usr/bin/env bash
# Attach the Telegram TUI to THIS chat's opencode session, in the chat's own
# checkout — and hold it while a terminal client is connected.
#
# Why this is a script and not a bare `opencode` in the ttyd command line:
#
# 1. The session id has to be resolved at ATTACH time, not when ttyd started.
#    The bot rewrites its session per chat (/root/.local/state/bot-host/
#    <bot>/sessions.json) and /new moves it, so a command line captured at boot
#    would pin a stale conversation within minutes.
# 2. `tmux new-session -A` ignores its command argument when the session
#    already exists. Left alone, the first attach would keep the OLD session
#    (wrong directory, wrong conversation) forever, because the tmux server is
#    a daemon that outlives ttyd. So the id the session was created with is
#    recorded next to it and a mismatch kills the session first.
#
# One writer at a time, in BOTH directions, because this is the same
# conversation the bot is in:
#
# - A bot turn in flight -> wait for it to finish, then attach. Refusing (as
#   this did at first) dead-ends the user at exactly the moment they are most
#   likely to open the terminal: while chatting.
# - A terminal client attached -> publish a lease with a heartbeat, so the bot
#   defers instead of opening a second writer. The lease is released when this
#   process exits, which is when ttyd has torn the client down.
set -u

BOT_ID="${TUI_BOT_ID:-mobile}"
# The state root is the phone's by default and the VM's when this runs beside
# the relay. Hardcoding /root meant the script could only ever be right on the
# phone, and the VM's copy silently read a state directory that does not exist.
STATE_ROOT="${TUI_STATE_ROOT:-/root/.local/state/bot-host}"
STATE="${STATE_ROOT}/${BOT_ID}"
SESSIONS="${STATE}/sessions.json"
LEASES="${STATE}/leases.json"
TUI_LEASE="${STATE}/tui-lease.json"
WORKTREE="${TUI_WORKTREE:-/root/Health-tracker}"
TMUX_NAME="${TUI_TMUX_NAME:-opencode-tui}"
# Per-bot: two ttyd instances (vm, vm2) share this host, and a shared mark file
# would make each instance reap the other's tmux session on every attach.
SID_MARK="/tmp/tui-session-id-${BOT_ID}"
OPENCODE_BIN="${OPENCODE_BIN:-/root/.opencode/bin/opencode}"
WAIT_SECONDS="${TUI_WAIT_SECONDS:-180}"

read_json() {
  node -e '
    const fs = require("fs");
    try { process.stdout.write(fs.readFileSync(process.argv[1], "utf8")); } catch { process.stdout.write("{}"); }
  ' "$1" 2>/dev/null || echo "{}"
}

# A lease is "held" if its object has any key. Stale leases are the failure
# mode that would block the user forever, so every holder stamps a heartbeat
# and readers treat an old heartbeat as free.
lease_held() {
  local file="$1" max_age_s="${2:-120}"
  node -e '
    const fs = require("fs");
    let m = {};
    try { m = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); } catch { process.exit(0); }
    const keys = Object.keys(m || {});
    if (!keys.length) process.exit(0);
    const hb = Number(m.heartbeat || m.startedAt || 0);
    const age = (Date.now() - hb) / 1000;
    process.exit(age > Number(process.argv[2]) ? 0 : 1);
  ' "$file" "$max_age_s" 2>/dev/null
}

cleanup() {
  rm -f "$TUI_LEASE" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

# --- which session is the chat on?
#
# Resolution order, because ttyd runs one static command per bot and cannot be
# told the chat any other way:
#   1. TUI_CHAT_ID — explicit wins (ops overrides, deterministic tests).
#   2. tui-open.json — written by bot-host on every /tui: the chat that opened
#      the Mini App most recently, with the session it was on then.
#   3. ids[0] — legacy fallback: the first session in the map. Wrong whenever
#      two chats share the bot, which is exactly the S1 failure this replaces.
CHAT_ID="${TUI_CHAT_ID:-}"
FROM_ENV=0
if [ -n "$CHAT_ID" ]; then FROM_ENV=1; else
  CHAT_ID=$(node -e '
    const fs = require("fs");
    try {
      const m = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
      if (m && m.chatId) process.stdout.write(String(m.chatId));
    } catch { /* no tui-open yet: fall through to the legacy pick */ }
  ' "$STATE/tui-open.json" 2>/dev/null || true)
fi
# One node step resolves AND labels, so the SOURCE line can never disagree with
# the SID line: explicit-hit and tui-open-hit mean the session belongs to that
# chat; legacy-first means the map did not contain it (the S1 failure mode).
RESOLVED=$(node -e '
  const fs = require("fs");
  const want = String(process.argv[2] || "");
  const fromEnv = process.argv[3] === "1";
  const hit = (sid, how) => process.stdout.write(`${sid}|${how}`);
  try {
    const map = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    if (want && map[want] && /^ses_/.test(String(map[want]))) {
      hit(String(map[want]), fromEnv ? "explicit-hit" : "tui-open-hit");
    } else {
      const ids = Object.values(map).map((v) => String(v || "").trim()).filter((v) => /^ses_/.test(v));
      hit(ids[0] || "", "legacy-first");
    }
  } catch { process.stdout.write("|legacy-first"); }
' "$SESSIONS" "$CHAT_ID" "$FROM_ENV" 2>/dev/null || echo "|legacy-first")
SID="${RESOLVED%%|*}"
CHAT_SOURCE="${RESOLVED##*|}"

# Headless seam for the sensor: print what would be attached without touching
# tmux, leases, or the model. TUI_DRY_RUN=1 prints SID=<id> SOURCE=<where>.
if [ "${TUI_DRY_RUN:-0}" = "1" ]; then
  echo "SID=${SID} SOURCE=${CHAT_SOURCE}"
  exit 0
fi

# --- wait out a turn that is already running rather than refusing to attach
WAITED=0
while lease_held "$LEASES" 300 && [ "$WAITED" -lt "$WAIT_SECONDS" ]; do
  if [ "$WAITED" -eq 0 ]; then
    echo "The bot is answering a message in this conversation right now."
    echo "Attaching as soon as it finishes — one writer at a time, or the"
    echo "conversation gets corrupted. This is not an error; it takes a moment."
    echo
  fi
  sleep 3
  WAITED=$((WAITED + 3))
done
if lease_held "$LEASES" 300; then
  echo "Still waiting on the bot after ${WAIT_SECONDS}s."
  echo "Close this and try again, or send /abort in the chat to stop the turn."
  sleep 20
  exit 0
fi

# --- reap a tmux session left over from a different conversation
PREV=$(cat "$SID_MARK" 2>/dev/null || true)
if [ -n "$PREV" ] && [ "$PREV" != "$SID" ]; then
  tmux kill-session -t "$TMUX_NAME" 2>/dev/null || true
fi

if [ -z "$SID" ]; then
  echo "No chat session recorded yet — starting a fresh one in ${WORKTREE}."
  echo "Send a message to the bot first and this picks it up on the next attach."
  echo
  SID_ARG=()
else
  echo "$SID" > "$SID_MARK"
  echo "This conversation, in ${WORKTREE}."
  echo "Type here and you are typing to the same thread the bot answers in."
  echo "Close the Mini App and reopen it any time — tmux keeps your place."
  echo "The bot defers new messages while you are in here."
  echo
  SID_ARG=(--session "$SID")
fi

cd "$WORKTREE" || exit 1

# Claim the conversation for as long as a client is attached. The heartbeat is
# what makes a crashed holder recoverable: without it a killed phone would
# leave a lease that blocks the chat forever.
claim() {
  node -e '
    const fs = require("fs");
    const payload = { session: process.argv[2], pid: process.pid, heartbeat: Date.now() };
    fs.writeFileSync(process.argv[1], JSON.stringify(payload));
  ' "$TUI_LEASE" "$SID" 2>/dev/null || true
}
claim

# tmux as a child, not exec: the loop below is what releases the lease when the
# terminal client goes away, which is the whole point of claiming it.
tmux new-session -A -s "$TMUX_NAME" "$OPENCODE_BIN" "${SID_ARG[@]}" &
TMUX_PID=$!

while kill -0 "$TMUX_PID" 2>/dev/null; do
  claim
  sleep 15
done
