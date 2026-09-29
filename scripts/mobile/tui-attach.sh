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
# One turn at a time, in BOTH directions, because this is the same conversation
# the bot is in — but the terminal stays open the whole time:
#
# - A bot turn in flight -> wait for it to finish, then attach. Refusing (as
#   this did at first) dead-ends the user at exactly the moment they are most
#   likely to open the terminal: while chatting.
# - While attached, publish PRESENCE, not ownership. This used to be a claim:
#   the bot read it and queued every message instead of answering, so opening
#   the terminal stopped all tool execution until the Mini App was closed. That
#   contradicted what /tui promises and was never necessary — the terminal and
#   the bot are two clients of the same opencode service driving the same
#   session, and the server serialises the turns (verified 2026-09-29: a TUI
#   client attached for the duration of a `run` turn, survived it, and the
#   session history stayed one coherent user -> assistant -> idle triple).
#   The heartbeat still matters: it is how the bot knows a TUI is open at all,
#   and an expired one must not leave that mark behind.
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
# The session name says WHERE it is, because that is what a tmux session list
# is read for: "opencode-tui" on a box with two of them gave no way to tell
# which was which. <LOCATION>-tui is the name; a second bot at the same
# location appends its bot id (VM-tui, VM-tui-vm2) so the two conversations
# stay separate — one shared session would put two chats on one terminal.
# TUI_TMUX_NAME still wins, so an operator can name a session anything.
TMUX_NAME="${TUI_TMUX_NAME:-${TUI_LOCATION:-local}-tui}"
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

# A lease is "held" while any entry looks like a live turn. bot-host writes
# leases.json as {"<chatId>": {"startedAt": ms, ...}} on turn start and deletes
# the entry when the turn ends — there is no top-level heartbeat, so the check
# is per-entry startedAt against max_age_s. An entry with no usable timestamp
# fails safe to HELD (a corrupt lease must delay, never corrupt); only when
# EVERY entry is older than max_age_s does it read free, because a crashed
# turn has no other clearing path until the bot restarts and sweeps it.
# Callers pass a generous bound (turns can run many minutes); WAIT_SECONDS
# still caps each attempt, and the give-up branch refuses rather than barging.
lease_held() {
  local file="$1" max_age_s="${2:-120}"
  node -e '
    const fs = require("fs");
    let m = {};
    try { m = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); } catch { process.exit(0); }
    const vals = Object.values(m || {});
    if (!vals.length) process.exit(0);
    const maxAgeMs = Number(process.argv[2]) * 1000;
    const now = Date.now();
    for (const v of vals) {
      const ts = Number(v && (v.startedAt || v.heartbeat));
      if (!Number.isFinite(ts) || ts <= 0) process.exit(1);
      if (now - ts <= maxAgeMs) process.exit(1);
    }
    process.exit(0);
  ' "$file" "$max_age_s" 2>/dev/null
}

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

# --- wait out a turn that is already running rather than refusing to attach.
# lease_held exits 1 while held, so the loop needs the negation: without it
# the script waited on an idle chat and barged into a live turn (2026-09-27).
WAITED=0
while ! lease_held "$LEASES" 1800 && [ "$WAITED" -lt "$WAIT_SECONDS" ]; do
  if [ "$WAITED" -eq 0 ]; then
    echo "A bot turn is running in this chat right now."
    echo "The terminal attaches the moment that turn finishes, so nothing you"
    echo "type is lost — it just takes a moment. It waits rather than typing"
    echo "over the top, because two writers on one conversation is what"
    echo "breaks it."
    echo
  fi
  sleep 3
  WAITED=$((WAITED + 3))
done
if ! lease_held "$LEASES" 1800; then
  echo "Still waiting on the bot after ${WAIT_SECONDS}s — not attaching, two"
  echo "writers would corrupt the conversation."
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
  echo "The bot keeps answering while you are in here; one turn at a time,"
  echo "so a message from either side waits for the other's turn to finish."
  echo
  SID_ARG=(--session "$SID")
fi

cd "$WORKTREE" || exit 1

# Claim the conversation for as long as a client is attached. The heartbeat is
# what makes a crashed holder recoverable: without it a killed phone would
# leave a lease that blocks the chat forever. The heartbeat runs in a
# background subshell (no terminal use, so backgrounding is safe); tmux itself
# stays in the FOREGROUND — a backgrounded tmux client dies instantly with
# "open terminal failed: not a terminal" (2026-09-28), which was the reconnect
# loop: banner printed, session never created, overlay forever.
#
# announce, not claim: this records that a TUI is open so the bot can say so,
# and nothing more. The bot runs turns while this file is live.
announce() {
  node -e '
    const fs = require("fs");
    const payload = { session: process.argv[2], pid: process.pid, heartbeat: Date.now() };
    fs.writeFileSync(process.argv[1], JSON.stringify(payload));
  ' "$TUI_LEASE" "$SID" 2>/dev/null || true
}
announce
( while true; do sleep 15; announce; done ) &
HEARTBEAT_PID=$!

cleanup() {
  kill "$HEARTBEAT_PID" 2>/dev/null || true
  rm -f "$TUI_LEASE" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

# Ensure the session detached (needs no terminal), then attach in the
# foreground so the pty shows the conversation. A second open re-attaches to
# the same session; tmux keeps your place between opens. The tmux status bar
# stays off for these sessions: on a phone screen it is a wasted row and a
# visual frame, and opencode draws its own status line.
tmux new-session -d -A -s "$TMUX_NAME" "$OPENCODE_BIN" "${SID_ARG[@]}"
tmux set-option -t "$TMUX_NAME" status off 2>/dev/null || true
tmux attach-session -t "$TMUX_NAME"
