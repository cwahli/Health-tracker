#!/bin/bash
# ttyd entry for the shared VM session viewer: attach the opencode TUI to the
# bare VM session the terminal picker was last pointed at. The gateway writes
# the target when the user taps View on a session row (POST /api/ttys/view);
# this script attaches to exactly that session, nothing else.
#
# Why a shared viewer instead of one terminal per session: a TUI agent holds
# ~150-1000MB while its tmux session lives, and bare sessions come and go all
# day. One viewer pane re-pointed per View keeps the Terminal tab TUI-only
# (the Web tab stays the opencode web UI) without a terminal per session.
# Killing this viewer never touches the session itself: detach/close only
# drops the viewer pane, and the next open re-attaches to the same target.
set -u

STATE_ROOT="${TUI_STATE_ROOT:-/home/ubuntu/.local/state/bot-host}"
TARGET_FILE="${VMSESSION_TARGET_FILE:-$STATE_ROOT/vmsession/target.json}"
TMUX_NAME="${TUI_TMUX_NAME:-VM-tui-vmsession}"
OPENCODE_BIN="${OPENCODE_BIN:-/home/ubuntu/.opencode/bin/opencode}"
OPCODE_DB="${VMSESSION_OPCODE_DB:-$HOME/.local/share/opencode/opencode.db}"
# Same stale-pane discipline as tui-attach.sh: the mark records which session
# the pane was created with, and a mismatch reaps it first — otherwise the
# first viewed session would keep showing forever (tmux new-session -A
# ignores its command when the session already exists).
SID_MARK="/tmp/tui-session-id-vmsession"

refuse() {
  echo "[viewer] $1"
  echo "Pick a live VM session in the terminal tab first — the next open re-attaches."
  sleep 5
  exit 0
}

[ -f "$TARGET_FILE" ] || refuse "no session selected yet."
SID="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("sessionId",""))' "$TARGET_FILE" 2>/dev/null || true)"
DIR="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("directory",""))' "$TARGET_FILE" 2>/dev/null || true)"

[[ "$SID" =~ ^ses_[A-Za-z0-9]+$ ]] || refuse "bad session id in viewer target."
[ -n "$DIR" ] && [ -d "$DIR" ] || refuse "session workspace is gone: ${DIR:-<empty>}."
# The session may have archived since View was tapped. Attaching anyway would
# make opencode CREATE a same-id session — refuse instead, like the
# sessionless-open refusal in tui-attach.sh.
if [ -f "$OPCODE_DB" ]; then
  LIVE="$(python3 -c 'import sqlite3,sys; con=sqlite3.connect(sys.argv[1]); print(con.execute("select count(*) from session_v2 where id=? and time_archived is null", (sys.argv[2],)).fetchone()[0])' "$OPCODE_DB" "$SID" 2>/dev/null || echo 0)"
  [ "$LIVE" = "1" ] || refuse "session $SID is gone (archived or deleted)."
fi

if [ "$(cat "$SID_MARK" 2>/dev/null || true)" != "opencode:$SID" ]; then
  tmux kill-session -t "$TMUX_NAME" 2>/dev/null || true
  printf 'opencode:%s' "$SID" > "$SID_MARK"
fi

exec tmux new-session -A -s "$TMUX_NAME" "cd '$DIR' && exec '$OPENCODE_BIN' --session '$SID'"
