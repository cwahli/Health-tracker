#!/usr/bin/env bash
# Attach the router's /tui terminal to THIS chat's ACTIVE provider conversation.
#
# WHY THIS SCRIPT EXISTS
# ----------------------
# ttyd runs ONE static command per bot, so the chat/provider must be resolved at
# ATTACH time from the record `/tui` wrote (`state/tui-open.json`) and the
# router's per-chat session maps. The first version always ran
# `opencode attach …`; when the chat's provider was Cline that opened a
# different model and a different conversation (live bug 2026-09-30).
#
# The provider -> attach mapping here mirrors src/tui-provider.js
# (`buildAttachArgv`), which is unit tested:
#   opencode -> opencode attach <url> --dir <ws> -s <ses_…>
#   cline    -> cline -i --id <task> -m <model> -c <ws>   (resumes the task)
# Providers with no terminal never reach here: the router answers honestly
# instead of handing out a button.
#
# `opencode` is the box's v1 CLI (~/.local/bin/opencode): the router's chats
# live on the v1 server on port 4096, and the v2 CLI refuses it. The Cline CLI
# supports `--id <session>` to resume a task in its interactive TUI.
set -u

ROUTER_DIR="${TUI_ROUTER_DIR:-$HOME/.config/telegram-opencode/router}"
STATE="$ROUTER_DIR/state"
WORKSPACE="${TUI_WORKSPACE:-/workspace/biomarker-and-nutrient-tracker}"
OPENCODE_BIN="${OPENCODE_BIN:-$HOME/.local/bin/opencode}"
OPENCODE_SERVER="${TUI_OPENCODE_SERVER:-http://127.0.0.1:4096}"
CLINE_BIN="${CLINE_BIN:-$HOME/.local/bin/cline}"
TMUX_NAME="${TUI_TMUX_NAME:-ROUTER-tui}"
SID_MARK="/tmp/tui-session-id-grok-router"

# Resolve provider + the chat's session/task id + the model label the Telegram
# reply signs with. tui-open.json first (written on every /tui), then the
# provider's per-chat map in session.json, then the legacy global.
RESOLVED=$(node -e '
  const fs = require("fs");
  const dir = process.argv[1];
  const read = (p) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; } };
  const open = read(dir + "/tui-open.json") || {};
  const state = read(dir + "/session.json") || {};
  const s = state.sessions || {};
  const chatId = String(open.chatId || "");
  const provider = String(open.provider || state.provider || "opencode");
  const isSes = (v) => /^ses_/.test(String(v || ""));
  const nonEmpty = (v) => typeof v === "string" && v ? v : "";
  let session = "";
  if (provider === "opencode") {
    session = nonEmpty(open.sessionId);
    if (!isSes(session)) session = "";
    if (!session && chatId && s.chats && s.chats[chatId]) session = String(s.chats[chatId]);
    if (!session && s.opencode) session = String(s.opencode);
  } else if (provider === "cline") {
    session = nonEmpty(open.sessionId);
    if (!session && chatId && s.clineChats && s.clineChats[chatId]) session = String(s.clineChats[chatId]);
    if (!session && s.cline) session = String(s.cline);
  } else {
    session = nonEmpty(open.sessionId);
  }
  const model = nonEmpty(open.model) || nonEmpty(state.models && state.models[provider]);
  const modelLabel = nonEmpty(open.modelLabel);
  process.stdout.write([provider, session, model, modelLabel].join("\t"));
' "$STATE" 2>/dev/null || true)

IFS=$'\t' read -r PROVIDER SESSION MODEL MODEL_LABEL <<<"$RESOLVED"
PROVIDER="${PROVIDER:-opencode}"

case "$PROVIDER" in
  cline)
    if [ -z "$SESSION" ]; then
      echo "No Cline task recorded for this chat yet."
      echo "Send the bot a message first, then reopen /tui — the terminal resumes that exact task."
      exit 0
    fi
    MARK="cline:$SESSION"
    ;;
  opencode)
    if [ -n "$SESSION" ]; then MARK="opencode:$SESSION"; else MARK="opencode:fresh"; fi
    ;;
  *)
    echo "Provider '$PROVIDER' has no attachable terminal — the router should have said so."
    echo "Switch to opencode or cline with /switch, then /tui again."
    exit 0
    ;;
esac

# tmux `new-session -A` ignores its command when the session already exists, so a
# session left from a different chat/provider is killed first or the pane would
# show the wrong conversation forever.
PREV=$(cat "$SID_MARK" 2>/dev/null || true)
if [ "$PREV" != "$MARK" ]; then
  tmux kill-session -t "$TMUX_NAME" 2>/dev/null || true
fi
echo "$MARK" >"$SID_MARK" 2>/dev/null || true

echo "Grok TG router terminal — the same conversation your Telegram chat is in."
echo "Provider: $PROVIDER${MODEL_LABEL:+ · model: $MODEL_LABEL}"
if [ -n "$SESSION" ]; then
  echo "Task/session: $SESSION"
else
  echo "No chat session recorded yet — starting a fresh OpenCode session."
  echo "Send the bot a message first and reopen this to land on that conversation."
fi
echo "It runs under tmux, so closing the Mini App keeps your place."
echo

cd "$WORKSPACE" || exit 1

case "$PROVIDER" in
  cline)
    ARGS=("$CLINE_BIN" -i --id "$SESSION")
    [ -n "$MODEL" ] && ARGS+=(-m "$MODEL")
    ARGS+=(-c "$WORKSPACE")
    ;;
  *)
    ARGS=("$OPENCODE_BIN" attach "$OPENCODE_SERVER" --dir "$WORKSPACE")
    [ -n "$SESSION" ] && ARGS+=(-s "$SESSION")
    ;;
esac

tmux new-session -d -A -s "$TMUX_NAME" "${ARGS[@]}"
tmux set-option -t "$TMUX_NAME" status off 2>/dev/null || true
tmux attach-session -t "$TMUX_NAME"
