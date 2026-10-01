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
# sessions.json / cline-sessions.json / prefs.json are NOT read here. The
# resolution step below owns those paths, because which map is correct depends
# on the lane: a cline id is `<epoch>_<rand>` and an opencode id is `ses_…`, and
# handing either to the other tool is exactly the defect this reshape fixes.
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
# The mark is `<surface>:<session>`, not just the session: the two tools name
# their sessions incompatibly, so a bare id cannot tell "same conversation" from
# "the other tool's conversation", and a lane switch has to reap the old pane or
# the terminal keeps showing the previous tool (measured 2026-09-29: a chat on
# cline:cline-free/deepseek-v4.1-flash still rendered "Build · MiMo-V2.6-Flash
# Free OpenCode" because this script launched $OPENCODE_BIN unconditionally).
SID_MARK="/tmp/tui-session-id-${BOT_ID}"
OPENCODE_BIN="${OPENCODE_BIN:-/root/.opencode/bin/opencode}"
# The ttyd units' PATH is .opencode/bin:.local/bin:/usr/local/bin:/usr/bin:/bin,
# which does NOT include ~/.npm-global/bin where the cline CLI lives, so a bare
# `cline` is not resolvable under the unit. The absolute path is the default; the
# units set it explicitly for the same reason they set OPENCODE_BIN.
CLINE_BIN="${CLINE_BIN:-$HOME/.npm-global/bin/cline}"
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

# --- which tool is the chat on, and which session is that tool's?
#
# The surface is resolved from the chat's LIVE prefs.json model, not from the
# bot's registry default and not only from the tui-open.json snapshot: a
# /freemodel switch after the button was sent has to be respected, and the
# snapshot alone would launch OpenCode for a chat that has since moved to Cline.
# The snapshot is the fallback when prefs.json has no row for this chat.
#
# Resolution order for the chat, because ttyd runs one static command per bot
# and cannot be told the chat any other way:
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
# --- which workspace?
#
# TUI_WORKTREE in the service file is a STATIC guess. It is right only while the
# chat stays in the bot's own project, and wrong the moment /project points the
# chat elsewhere - the pane then opens a different project's checkout, so the
# tool renders a conversation unrelated to the one the bot is answering in. That
# is not cosmetic: the bot's replies never appear, and the pane confidently shows
# the wrong conversation. (Seen 2026-09-29: a vm /tui showed a PIP Defense
# Council session while the bot answered from Health-tracker.)
#
# The chat's own workspace is the truth, so the bot records it in tui-open.json
# and this reads it back. TUI_WORKTREE stays the fallback for a cold attach with
# no tui-open row - a brand new chat, or before the first /tui.
SESSION_WORKSPACE=""
if [ -n "${TUI_SESSION_WORKSPACE:-}" ]; then
  SESSION_WORKSPACE="$TUI_SESSION_WORKSPACE"
elif [ -f "$STATE/tui-open.json" ]; then
  SESSION_WORKSPACE=$(node -e '
    const fs = require("fs");
    try {
      const m = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
      if (m && typeof m.workspace === "string") process.stdout.write(m.workspace);
    } catch { /* nothing recorded: fall through to the env */ }
  ' "$STATE/tui-open.json" 2>/dev/null || true)
fi
# A path that is not a directory makes the tool fail with FileSystem.access on
# attach, which is the 2026-09-27 reconnect loop. Caught here, where the message
# can say what is actually wrong instead of showing a dead terminal.
if [ -n "$SESSION_WORKSPACE" ] && [ ! -d "$SESSION_WORKSPACE" ]; then
  echo "This conversation belongs in ${SESSION_WORKSPACE}, which does not exist"
  echo "on this host, so I will not open a terminal in the wrong place instead."
  echo "Send /project to see which project this chat is on."
  echo
  SESSION_WORKSPACE=""
fi
[ -n "$SESSION_WORKSPACE" ] || SESSION_WORKSPACE="$WORKTREE"
WORKTREE="$SESSION_WORKSPACE"

# The launch decision lives in scripts/lib/tui-surface.mjs so the bot, this
# script and the sensors cannot disagree about it. One node step resolves AND
# labels, so the SOURCE line can never disagree with the SID line: explicit-hit
# and tui-open-hit mean the session belongs to that chat; legacy-first means the
# map did not contain it (the S1 failure mode).
TUI_SURFACE_MODULE="${TUI_SURFACE_MODULE:-$(cd "$(dirname "$0")/.." && pwd)/lib/tui-surface.mjs}"
RESOLVED=$(node --input-type=module -e '
  import { readFileSync } from "node:fs";
  import path from "node:path";
  import { pathToFileURL } from "node:url";
  const [stateDir, want, fromEnv, workspace, ocBin, clBin, modPath] = process.argv.slice(1);
  const tui = await import(pathToFileURL(modPath).href);
  const readJson = (p) => { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; } };
  const out = { SURFACE: "opencode", MODEL: "", SID: "", SOURCE: "legacy-first", CMD: "", NOTE: "", REASON: "" };
  const tuiOpen = readJson(path.join(stateDir, "tui-open.json")) || {};
  const prefs = readJson(path.join(stateDir, "prefs.json")) || {};
  const chatId = String(want || tuiOpen.chatId || "");
  const fromEnvHit = fromEnv === "1";
  // Live lane first, snapshot second. An unknown chat keeps the snapshot rather
  // than being pinned to the registry default behind the user back.
  const prefModel = String((prefs[chatId] || {}).model || "");
  const model = prefModel || String(tuiOpen.model || "");
  out.SURFACE = tui.normalizeSurface(model || tuiOpen.surface || "");
  out.MODEL = model;

  const isCline = out.SURFACE === "cline";
  const map = readJson(path.join(stateDir, isCline ? "cline-sessions.json" : "sessions.json")) || {};
  // sessions.json rows are workspace-scoped since #365 (`<workspace>\0<id>`);
  // older rows (and cline-sessions.json) are bare ids. The scope is split
  // here, never matched: matching the packed string against `^ses_` is how
  // vm3 TUI ended up on a fresh session while Telegram answered from the
  // chat real one (2026-10-01: SID empty, SOURCE legacy-first, live).
  const SEP = "\u0000";
  const unscope = (v) => {
    const s = String(v ?? "");
    const cut = s.indexOf(SEP);
    return cut === -1
      ? { workspace: "", sessionId: s.trim() }
      : { workspace: s.slice(0, cut), sessionId: s.slice(cut + 1).trim() };
  };
  // A row belongs to this attach when its session fits the lane AND it is
  // this workspace row (or a legacy bare row from before scoping, which
  // carries no workspace to check). Another workspace row is never
  // borrowed: that is the cross-project drift scoping was built to stop.
  const rowForThisAttach = (v) => {
    const { workspace: ws, sessionId } = unscope(v);
    if (!tui.sessionIdMatchesSurface(sessionId, out.SURFACE)) return "";
    if (!ws) return sessionId;
    return ws === String(workspace || "") ? sessionId : "";
  };
  const chatSid = chatId ? rowForThisAttach(map[chatId]) : "";
  if (chatSid) {
    out.SID = chatSid;
    out.SOURCE = fromEnvHit ? "explicit-hit" : "tui-open-hit";
  } else if (!isCline && chatId && String(tuiOpen.chatId || "") === chatId && tui.sessionIdMatchesSurface(tuiOpen.sessionId, out.SURFACE)) {
    // The map lost the chat row (a pre-scope restart, a wiped map) but /tui
    // recorded the session for THIS workspace seconds ago. The snapshot is the
    // chat own conversation, and only when this attach is for the chat that
    // opened it; another chat row (legacy-first) is not.
    out.SID = String(tuiOpen.sessionId).trim();
    out.SOURCE = "tui-open-snapshot";
  } else {
    out.SID = Object.values(map).map(rowForThisAttach).filter(Boolean)[0] || "";
  }
  // A Cline chat whose turn has not written its map yet still has a thread on
  // disk. Resuming the newest one for this checkout shows the conversation the
  // user last had instead of an empty prompt, and says where it came from.
  if (isCline && !out.SID) {
    out.SID = tui.latestClineSessionId({ workspace }) || "";
    if (out.SID) out.SOURCE = "latest-on-disk";
  }

  const clineModel = model.replace(/^cline:/i, "");
  const launch = tui.resolveTuiLaunch({
    surface: out.SURFACE,
    model: clineModel,
    sessionId: out.SID,
    workspace,
    opencodeBin: ocBin,
    clineBin: clBin,
  });
  out.NOTE = launch.note || "";
  out.REASON = launch.reason || "";
  out.CMD = tui.tuiLaunchCommand(launch);
  for (const [k, v] of Object.entries(out)) process.stdout.write(`${k}=${v}\n`);
  // argv as discrete words, so the shell hands tmux real arguments and a model
  // containing a space is not re-split. CMD above stays for the dry run.
  (launch.argv || []).forEach((word, i) => process.stdout.write(`ARG${i}=${word}\n`));
' "$STATE" "$CHAT_ID" "$FROM_ENV" "$WORKTREE" "$OPENCODE_BIN" "$CLINE_BIN" "$TUI_SURFACE_MODULE" 2>/dev/null)

SURFACE="opencode"
MODEL=""
SID=""
CHAT_SOURCE="legacy-first"
LAUNCH_CMD=""
LAUNCH_NOTE=""
LAUNCH_REASON=""
LAUNCH_ARGV=()
while IFS='=' read -r _key _value; do
  case "$_key" in
    SURFACE) SURFACE="$_value" ;;
    MODEL) MODEL="$_value" ;;
    SID) SID="$_value" ;;
    SOURCE) CHAT_SOURCE="$_value" ;;
    CMD) LAUNCH_CMD="$_value" ;;
    NOTE) LAUNCH_NOTE="$_value" ;;
    REASON) LAUNCH_REASON="$_value" ;;
    ARG*) LAUNCH_ARGV+=("$_value") ;;
  esac
done <<EOF
$RESOLVED
EOF

# Headless seam for the sensor: print what would be attached without touching
# tmux, leases, or the model. TUI_DRY_RUN=1 prints the lane, the model, the
# session and where the session came from.
if [ "${TUI_DRY_RUN:-0}" = "1" ]; then
  echo "SURFACE=$SURFACE SID=${SID} SOURCE=$CHAT_SOURCE"
  [ -n "$MODEL" ] && echo "MODEL=$MODEL"
  [ -n "$LAUNCH_CMD" ] && echo "CMD=$LAUNCH_CMD"
  [ -n "$LAUNCH_REASON" ] && echo "REASON=$LAUNCH_REASON"
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

# --- refuse rather than fall back. Two different refusals, and they must not be
# confused: a lane with NO terminal is a policy answer the user can act on
# (/freemodel), while an empty argv with no reason means the resolver itself
# failed and guessing OpenCode here would resurrect the exact bug this script
# was fixed for — silently, and with the old tool.
if [ "${#LAUNCH_ARGV[@]}" -eq 0 ]; then
  if [ -n "$LAUNCH_REASON" ]; then
    echo "No terminal for this chat — ${LAUNCH_REASON}."
    echo "Move the chat to a lane with a real terminal with /freemodel, or use"
    echo "/tx on for the live tool feed here."
  else
    echo "Could not work out which terminal this chat needs, so nothing was"
    echo "opened. A bare \`opencode\` here would be a guess, and a guess is how"
    echo "this ended up on the wrong tool in the first place."
    echo "Send /tui again, or check that the unit sets CLINE_BIN and"
    echo "OPENCODE_BIN and that scripts/lib/tui-surface.mjs is present."
  fi
  sleep 20
  exit 0
fi

# pane_mark_decision <prev-mark> <new-mark> -> keep|fresh|reap-legacy|reap-switch
#
# Pure: no tmux, no files, so the sensor sources this function and executes it
# (like lease_held). A mark with no `surface:` prefix is legacy (pre-#362 wrote
# the bare session id) or junk (seen 2026-09-29: /tmp/tui-session-id-vm held
# `ses_x`, a string no script in this tree writes). A bare mark can never equal
# a qualified one, so without the legacy branch every attach would kill a
# healthy pane and say nothing about why.
pane_mark_decision() {
  local prev="$1" mark="$2"
  if [ -z "$prev" ]; then echo fresh; return; fi
  if [ "$prev" = "$mark" ]; then echo keep; return; fi
  case "$prev" in
    *:*) echo reap-switch ;;
    *) echo reap-legacy ;;
  esac
}

# --- reap a tmux session left over from a different conversation OR a different
# tool. The mark is `<surface>:<session>`: the two tools name their sessions
# incompatibly, so a lane switch has to reap the pane or the terminal keeps
# showing the previous tool on screen — which is exactly the defect this block
# was extended for. A legacy bare mark (or junk like ses_x) reaps ONCE and then
# migrates to the qualified mark, so the next attach compares like with like
# instead of killing on every open.
MARK="${SURFACE}:${SID}"
PREV=$(cat "$SID_MARK" 2>/dev/null || true)
DECISION=$(pane_mark_decision "$PREV" "$MARK")
# One line per attach, per bot, so the next stale-pane report starts from what
# the attach SAW rather than a journal reconstruction: the lane, the session,
# where the session came from, the previous mark, and whether the pane was
# kept or reaped. The ses_x mark and vm2's missing session both had to be
# pieced together after the fact; this file would have answered directly.
ATTACH_LOG="${STATE}/tui-attach.log"
attach_log() {
  printf '%s bot=%s chat=%s surface=%s sid=%s source=%s prev=%s mark=%s %s\n' \
    "$(date -u +%FT%TZ)" "$BOT_ID" "${CHAT_ID:-unknown}" "$SURFACE" "$SID" \
    "$CHAT_SOURCE" "$PREV" "$MARK" "$1" >>"$ATTACH_LOG" 2>/dev/null || true
}
attach_log "decision=$DECISION"
case "$DECISION" in
  reap-legacy|reap-switch)
    tmux kill-session -t "$TMUX_NAME" 2>/dev/null || true
    # Verify the kill landed before the new-session -A below: -A ignores its
    # command argument while the session still exists, so an unverified kill is
    # how a stale tool survives an attach (the header note). A lingering
    # session is logged, never silently kept — the -A then re-attaches to it
    # rather than stacking a second tool beside it.
    TRIES=0
    while tmux has-session -t "$TMUX_NAME" 2>/dev/null && [ "$TRIES" -lt 5 ]; do
      sleep 0.2
      TRIES=$((TRIES + 1))
    done
    if tmux has-session -t "$TMUX_NAME" 2>/dev/null; then
      attach_log "decision=$DECISION reap-verdict=lingering"
    fi
    ;;
esac
echo "$MARK" > "$SID_MARK"

case "$SURFACE" in
  cline)
    if [ -n "$SID" ]; then
      echo "Cline, in ${WORKTREE} — ${LAUNCH_NOTE}."
      echo "This is the last Cline thread for this chat. Cline cannot resume a"
      echo "thread headlessly, so a new message I answer starts a fresh Cline"
      echo "thread and will NOT appear here. What you type here is yours."
    else
      echo "Cline, in ${WORKTREE} — a fresh thread, because this chat has no"
      echo "recorded Cline session yet. Send me a message first and the next"
      echo "attach resumes it."
    fi
    echo "Close the Mini App and reopen it any time — tmux keeps your place."
    echo
    ;;
  *)
    if [ -n "$SID" ]; then
      echo "OpenCode, in ${WORKTREE} — ${LAUNCH_NOTE}."
      echo "Type here and you are typing to the same thread I answer in."
    else
      echo "No chat session recorded yet — starting a fresh one in ${WORKTREE}."
      echo "Send a message to the bot first and this picks it up on the next attach."
    fi
    echo "Close the Mini App and reopen it any time — tmux keeps your place."
    echo "I keep answering while you are in here; one turn at a time, so a"
    echo "message from either side waits for the other's turn to finish."
    echo
    ;;
esac

cd "$WORKTREE" || exit 1

# How long the PANE has existed, as opposed to how long this process has. tmux
# sessions outlive their attacher by design (detach does not kill the pane), so
# `ps` on this script reports minutes while the terminal the user is looking at
# is a day old. Reporting the pane's real age is the whole point: it is what
# separates "warm and in use" from "abandoned", which are otherwise identical
# from the outside.
PANE_SINCE="$(tmux display-message -p -t "$TMUX_NAME" '#{session_created}' 2>/dev/null || echo 0)"

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
    const payload = {
      session: process.argv[2],
      pid: process.pid,
      heartbeat: Date.now(),
      pane: process.argv[3],
      bot: process.argv[4],
      // Announced on every heartbeat, not only at start, so a client that
      // attached later shows up without the bot guessing.
      clients: Number(process.argv[5] || 0),
      since: Number(process.argv[6] || 0),
    };
    fs.writeFileSync(process.argv[1], JSON.stringify(payload));
  ' "$TUI_LEASE" "$SID" "$TMUX_NAME" "$BOT_ID" "$(tmux list-clients -t "$TMUX_NAME" 2>/dev/null | wc -l | tr -d ' ')" "$PANE_SINCE" 2>/dev/null || true
}
announce
( while true; do sleep 15; announce; done ) &
HEARTBEAT_PID=$!

cleanup() {
  kill "$HEARTBEAT_PID" 2>/dev/null || true
  # Only clear the lease when nobody is left in the tmux session. ttyd spawns
  # ONE tui-attach.sh per browser client, so desktop + phone on the same
  # session means TWO holders: the first client to detach must not delete the
  # lease out from under the second, or the bot reports "none open" while the
  # phone is still looking at the terminal.
  if [ "$(tmux list-clients -t "$TMUX_NAME" 2>/dev/null | wc -l | tr -d ' ')" = "0" ]; then
    rm -f "$TUI_LEASE" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

# Ensure the session detached (needs no terminal), then attach in the
# foreground so the pty shows the conversation. A second open re-attaches to
# the same session; tmux keeps your place between opens. The tmux status bar
# stays off for these sessions: on a phone screen it is a wasted row and a
# visual frame, and the tool draws its own status line.
#
# aggressive-resize: with desktop + phone on the same session the pane would
# otherwise size to the SMALLEST client, shrinking the desktop to phone width.
# `aggressive-resize on` sizes the pane to the LARGEST client instead, so each
# screen keeps its own width (xterm reflows per client).
#
# The command is the argv from scripts/lib/tui-surface.mjs, not
# "$OPENCODE_BIN" "${SID_ARG[@]}": that hardcoded argv WAS the defect — it named
# OpenCode whatever lane the chat was actually on. It arrives as ARG0/ARG1/…
# lines rather than one string so tmux gets real argv words and a model with a
# space in it survives; no eval, no re-splitting.
tmux new-session -d -A -s "$TMUX_NAME" "${LAUNCH_ARGV[@]}"
tmux set-option -t "$TMUX_NAME" status off 2>/dev/null || true
tmux set-window-option -t "$TMUX_NAME" aggressive-resize on 2>/dev/null || true
tmux attach-session -t "$TMUX_NAME"
