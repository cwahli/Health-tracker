#!/usr/bin/env bash
# S1 sensor: the attach resolves THIS chat's session, not ids[0].
# Run: bash scripts/assert-tui-chat-select.test.sh
#
# tui-attach.sh historically printed ids[0] — the first session in the map —
# so every chat attached to whichever conversation happened to be first. The
# resolution order is now: TUI_CHAT_ID env, then tui-open.json (written by
# bot-host on every /tui), then the legacy first-session fallback. TUI_DRY_RUN
# prints the decision without touching tmux, leases, or the model.
set -u
PASS=0
FAIL=0
HERE="$(cd "$(dirname "$0")" && pwd)"
ATTACH="$HERE/mobile/tui-attach.sh"

check() { # check <name> <got> <want>
  if [ "$2" = "$3" ]; then echo "  PASS  $1"; PASS=$((PASS + 1));
  else echo "  FAIL  $1 (got [$2], want [$3])"; FAIL=$((FAIL + 1)); fi
}

# The dry run prints the decision line first (SURFACE/SID/SOURCE) and then the
# argv as CMD. Selection cases read the decision line only; the lane cases in
# section 13 assert on CMD, so a selection regression and a lane regression fail
# as different things.
first() { printf '%s\n' "$1" | head -1; }

echo "assert-tui-chat-select:"
ROOT="$(mktemp -d)"
STATE="$ROOT/state/bot-host/vm"
mkdir -p "$STATE"
# Two chats share one bot. The map order puts chat B first on purpose: the old
# ids[0] code would attach chat A to chat B's session.
cat > "$STATE/sessions.json" <<'JSON'
{"222": "ses_B222", "111": "ses_A111"}
JSON

# 1. Explicit chat wins, even when it is not first in the map.
out=$(TUI_STATE_ROOT="$ROOT/state/bot-host" TUI_BOT_ID=vm TUI_CHAT_ID=111 TUI_DRY_RUN=1 bash "$ATTACH")
check "explicit chat resolves its own session" "$(first "$out")" "SURFACE=opencode SID=ses_A111 SOURCE=explicit-hit"

# 2. tui-open.json (what /tui writes) selects without any env.
echo '{"chatId":"222","sessionId":"ses_B222","at":"2026-09-27T07:00:00.000Z"}' > "$STATE/tui-open.json"
out=$(TUI_STATE_ROOT="$ROOT/state/bot-host" TUI_BOT_ID=vm TUI_DRY_RUN=1 bash "$ATTACH")
check "tui-open selects the opening chat" "$(first "$out")" "SURFACE=opencode SID=ses_B222 SOURCE=tui-open-hit"

# 3. Explicit beats a stale tui-open from another chat.
out=$(TUI_STATE_ROOT="$ROOT/state/bot-host" TUI_BOT_ID=vm TUI_CHAT_ID=111 TUI_DRY_RUN=1 bash "$ATTACH")
check "explicit beats stale tui-open" "$(first "$out")" "SURFACE=opencode SID=ses_A111 SOURCE=explicit-hit"

# 4. A chat with no session falls back loudly, not silently to another chat.
# NOTE: {"222","111"} iterates as 111,222 — integer-like keys sort numerically
# in JS objects regardless of insertion order, which is precisely why ids[0]
# is an arbitrary pick and must always be labelled legacy-first.
rm "$STATE/tui-open.json"
out=$(TUI_STATE_ROOT="$ROOT/state/bot-host" TUI_BOT_ID=vm TUI_CHAT_ID=999 TUI_DRY_RUN=1 bash "$ATTACH")
check "unknown chat falls back loudly" "$(first "$out")" "SURFACE=opencode SID=ses_A111 SOURCE=legacy-first"

# 5. A missing map resolves empty, never a garbage session.
rm "$STATE/sessions.json"
out=$(TUI_STATE_ROOT="$ROOT/state/bot-host" TUI_BOT_ID=vm TUI_CHAT_ID=111 TUI_DRY_RUN=1 bash "$ATTACH")
check "missing map resolves empty" "$(first "$out")" "SURFACE=opencode SID= SOURCE=legacy-first"

# 6. The bot-host /tui handler records the opening chat (static check on the
#    live contract: tui-open.json written on the gateway path, never fatal).
SRC="$(grep -c "tui-open.json" "$HERE/bot-host.mjs")"
check "bot-host mentions tui-open on /tui ($SRC site(s))" "$([ "$SRC" -ge 1 ] && echo yes || echo no)" "yes"
grep -q "writeJson(path.join(stateDir(config.id), 'tui-open.json')" "$HERE/bot-host.mjs" \
  && { echo "  PASS  the write targets this bot's state dir"; PASS=$((PASS + 1)); } \
  || { echo "  FAIL  the write targets this bot's state dir"; FAIL=$((FAIL + 1)); }

# 7. Session continuity survives a restart: the Map key type must match the
#    disk round-trip. Turns used to write the raw Telegram id (a number) while
#    saveMap/loadMap stringify keys, so every restart forgot every session
#    until that chat's next turn. Both entry points now normalize once.
node -e '
  const m = new Map();
  m.set(String(6218257274), "ses_X");
  const roundTripped = new Map(Object.entries(Object.fromEntries(m)));
  if (roundTripped.get(String(6218257274)) !== "ses_X") process.exit(1);
' && { echo "  PASS  string keys survive a disk round-trip"; PASS=$((PASS + 1)); } \
  || { echo "  FAIL  string keys survive a disk round-trip"; FAIL=$((FAIL + 1)); }
grep -q "const chatId = String(message.chat.id);" "$HERE/bot-host.mjs" \
  && { echo "  PASS  handleMessage normalizes chatId once"; PASS=$((PASS + 1)); } \
  || { echo "  FAIL  handleMessage normalizes chatId once"; FAIL=$((FAIL + 1)); }
grep -q "const chatId = String(query.message?.chat?.id ?? '');" "$HERE/bot-host.mjs" \
  && { echo "  PASS  handleCallback normalizes chatId once"; PASS=$((PASS + 1)); } \
  || { echo "  FAIL  handleCallback normalizes chatId once"; FAIL=$((FAIL + 1)); }

# 8. A remote result that lands after /abort is buried, not delivered. On
#    2026-09-27 a 2000-word essay arrived 26s after the abort ack because the
#    remote delivery path (runRemoteTurn) had no aborted check while the local
#    path did. Static tripwire: both delivery sites must consult the flag.
grep -q "if (running.get(chatId)?.aborted) {" "$HERE/bot-host.mjs" \
  && { echo "  PASS  an aborted check exists on a delivery path"; PASS=$((PASS + 1)); } \
  || { echo "  FAIL  an aborted check exists on a delivery path"; FAIL=$((FAIL + 1)); }
REMOTE_ABORTS="$(grep -c "renderer.status = 'aborted'" "$HERE/bot-host.mjs")"
check "both delivery paths bury post-abort results ($REMOTE_ABORTS sites)" "$REMOTE_ABORTS" "2"

# 9. The attach must wait while a turn runs and barge never. On 2026-09-27
# /tui showed "the bot is answering" on an idle chat and then dropped to the
# reconnect prompt: lease_held() returned 0=free/1=held but the while/if used
# it bare (0 reads true in shell), and it read a top-level heartbeat that
# bot-host never writes (real leases are per-chat startedAt entries). Both
# halves are pinned here: semantics by execution, wiring by tripwire.
LEASE_FIX="$(mktemp -d)"
eval "$(sed -n '/^lease_held() {/,/^}/p' "$ATTACH")"
NOW_MS="$(node -e 'process.stdout.write(String(Date.now()))')"
FRESH=$((NOW_MS - 5000))
STALE=$((NOW_MS - 2000000))
echo '{"other-chat":{"chatId":"other-chat","startedAt":'"$FRESH"',"pid":123}}' > "$LEASE_FIX/held.json"
echo '{"other-chat":{"chatId":"other-chat","startedAt":'"$STALE"',"pid":123}}' > "$LEASE_FIX/stale.json"
echo '{"other-chat":{"chatId":"other-chat","pid":123}}' > "$LEASE_FIX/nots.json"
echo '{}' > "$LEASE_FIX/empty.json"
lease_held "$LEASE_FIX/missing.json" 1800; check "missing leases file reads free" "$?" "0"
lease_held "$LEASE_FIX/empty.json" 1800; check "empty leases read free" "$?" "0"
lease_held "$LEASE_FIX/held.json" 1800; check "fresh turn lease reads held" "$?" "1"
lease_held "$LEASE_FIX/stale.json" 1800; check "orphaned (>max age) lease reads free" "$?" "0"
lease_held "$LEASE_FIX/nots.json" 1800; check "timestamp-less entry fails safe to held" "$?" "1"
grep -q "while ! lease_held" "$ATTACH" \
  && { echo "  PASS  the wait loop runs while held, not while free"; PASS=$((PASS + 1)); } \
  || { echo "  FAIL  the wait loop runs while held, not while free"; FAIL=$((FAIL + 1)); }
grep -q "if ! lease_held" "$ATTACH" \
  && { echo "  PASS  the give-up branch fires while still held"; PASS=$((PASS + 1)); } \
  || { echo "  FAIL  the give-up branch fires while still held"; FAIL=$((FAIL + 1)); }
if grep -qE "(while|if) lease_held" "$ATTACH"; then
  echo "  FAIL  bare while/if lease_held (inverted polarity) still present"; FAIL=$((FAIL + 1))
else
  echo "  PASS  no bare while/if lease_held remains"; PASS=$((PASS + 1))
fi
# 10. tmux must not be backgrounded: a backgrounded tmux client dies instantly
# ("open terminal failed: not a terminal") while the script lives on — banner
# sent, session never created, reconnect overlay forever (2026-09-28). The
# session is ensured detached; only the attach holds the pty, in front.
grep -q 'tmux attach-session -t' "$ATTACH" \
  && { echo "  PASS  the attach holds the pty in front"; PASS=$((PASS + 1)); } \
  || { echo "  FAIL  the attach holds the pty in front"; FAIL=$((FAIL + 1)); }
if grep -vE "^\s*#" "$ATTACH" | grep -E "tmux new-session -A" | grep -qv "\-d -A"; then
  echo "  FAIL  a foreground-needing tmux runs backgrounded"; FAIL=$((FAIL + 1))
else
  echo "  PASS  no backgrounded tmux client remains"; PASS=$((PASS + 1))
fi
grep -q 'HEARTBEAT_PID' "$ATTACH" \
  && { echo "  PASS  the lease heartbeat survives the reshape"; PASS=$((PASS + 1)); } \
  || { echo "  FAIL  the lease heartbeat survives the reshape"; FAIL=$((FAIL + 1)); }
# 10b. Desktop + phone share one tmux session (ttyd spawns one tui-attach.sh
#      per browser client), so the first client to detach must not clear the
#      lease out from under the second — only a detach with no clients left
#      may remove it, or the bot reports "none open" while the phone is still
#      looking at the terminal.
grep -q 'list-clients -t "$TMUX_NAME"' "$ATTACH" \
  && { echo "  PASS  the lease survives while a second client is attached"; PASS=$((PASS + 1)); } \
  || { echo "  FAIL  the lease is cleared on first detach even with clients left"; FAIL=$((FAIL + 1)); }
# 10c. With two clients on one session tmux would otherwise size the pane to
#      the smallest (the phone), shrinking the desktop. aggressive-resize
#      sizes to the largest instead.
grep -q 'aggressive-resize on' "$ATTACH" \
  && { echo "  PASS  the pane keeps the largest client size"; PASS=$((PASS + 1)); } \
  || { echo "  FAIL  the pane shrinks to the smallest client"; FAIL=$((FAIL + 1)); }
# 10d. Every shipped unit must allow several browser clients on the one shell:
#      --max-clients 1 is the "tap Enter, never reconnects" loop (the desktop
#      holds the only slot, the phone gets no PTY, ttyd shows its overlay
#      forever). 0 = no cap.
#
#      vm3 is in this list because it was NOT, and that is how vm3 shipped with
#      --max-clients 1 while its two siblings read 0 — the loop this check
#      exists for was live on the newest unit and nothing looked at it. A gate
#      that names two of three units is not a gate; it is a sample.
for unit in tui-ttyd-vm tui-ttyd-vm2 tui-ttyd-vm3; do
  if grep -q -- '--max-clients 0' "$HERE/$unit.service" 2>/dev/null; then
    echo "  PASS  $unit allows several clients on one shell"; PASS=$((PASS + 1))
  else
    echo "  FAIL  $unit caps clients (second device gets the reconnect loop)"; FAIL=$((FAIL + 1))
  fi
done
# 10e. The renderer decides whether the TUI is usable on a phone at all.
#      ttyd's page hardcodes rendererType:"webgl" — a canvas, repainted whole
#      per frame, with no native scroll and no selectable text. That is the
#      "slow screenshot terminal" complaint, and it is a DEFAULT, not a property
#      of ttyd: 1.7.7's own page accepts canvas|webgl|dom.
#
#      vm3 carries the flag today; vm/vm2 still default to webgl. That is a
#      deliberate, measured rollout (one unit, phone-tested before the rest), so
#      this check asserts the units that claim dom DO claim it — it does not
#      force every unit to switch at once, which would be the untested thing
#      this gate exists to prevent.
grep -q -- '--client-option rendererType=dom' "$HERE/tui-ttyd-vm3.service" 2>/dev/null \
  && { echo "  PASS  vm3 paints text as elements (rendererType=dom), not a canvas"; PASS=$((PASS + 1)); } \
  || { echo "  FAIL  vm3 is back on the canvas renderer (no rendererType=dom)"; FAIL=$((FAIL + 1)); }
# And the pairing that makes it work: TOUCH_SCROLL_JS bridges a finger drag to
# PageUp/PageDown ONLY because a canvas cannot scroll natively. On a
# DOM-rendered terminal the browser scrolls for real, and the bridge's
# preventDefault would BREAK that scroll. scripts/assert-tui-gateway.test.mjs
# drives that stand-down; here we only pin that the shim and the flag live in
# the same change, so a later revert of one is visible in the diff.
grep -q 'function isDomRenderer' "$HERE/tui-gateway.mjs" \
  && { echo "  PASS  the drag bridge knows when to stand down"; PASS=$((PASS + 1)); } \
  || { echo "  FAIL  the drag bridge still binds over native scrolling"; FAIL=$((FAIL + 1)); }
grep -q 'set-option -t "$TMUX_NAME" status off' "$ATTACH" \
  && { echo "  PASS  the tmux frame stays off the phone screen"; PASS=$((PASS + 1)); } \
  || { echo "  FAIL  the tmux frame stays off the phone screen"; FAIL=$((FAIL + 1)); }

# 12. A tmux session list is read to answer "which location is this on?". The
#     name used to be "opencode-tui", which on a box running two of them said
#     neither location nor bot (2026-09-29). The default now comes from
#     TUI_LOCATION, and the shipped units name themselves by location.
grep -q 'TUI_LOCATION:-local}-tui' "$ATTACH" \
  && { echo "  PASS  the session name carries the location"; PASS=$((PASS + 1)); } \
  || { echo "  FAIL  the session name carries the location"; FAIL=$((FAIL + 1)); }
for unit in tui-ttyd-vm tui-ttyd-vm2; do
  name=$(grep -o 'TUI_TMUX_NAME=.*' "$HERE/$unit.service" 2>/dev/null | head -1 | cut -d= -f2)
  case "$name" in
    VM-tui*) echo "  PASS  $unit names its session for the location ($name)"; PASS=$((PASS + 1)) ;;
    *) echo "  FAIL  $unit session name says no location (got '${name:-none}')"; FAIL=$((FAIL + 1)) ;;
  esac
done
# Bots on one host must not share a session: that would put two chats on one
# terminal, which is the isolation vm2's and vm3's units exist to protect.
VM_NAME=$(grep -o 'TUI_TMUX_NAME=.*' "$HERE/tui-ttyd-vm.service" | cut -d= -f2)
VM2_NAME=$(grep -o 'TUI_TMUX_NAME=.*' "$HERE/tui-ttyd-vm2.service" | cut -d= -f2)
VM3_NAME=$(grep -o 'TUI_TMUX_NAME=.*' "$HERE/tui-ttyd-vm3.service" | cut -d= -f2)
[ -n "$VM_NAME" ] && [ -n "$VM2_NAME" ] && [ -n "$VM3_NAME" ] \
  && [ "$VM_NAME" != "$VM2_NAME" ] && [ "$VM_NAME" != "$VM3_NAME" ] && [ "$VM2_NAME" != "$VM3_NAME" ] \
  && { echo "  PASS  the three bots keep separate sessions ($VM_NAME / $VM2_NAME / $VM3_NAME)"; PASS=$((PASS + 1)); } \
  || { echo "  FAIL  bots share one session ($VM_NAME / $VM2_NAME / $VM3_NAME)"; FAIL=$((FAIL + 1)); }

# The phone-vs-VM tell must be the platform, not the URL file's path: that path
# defaults to a Termux location on every host, so a VM bot with no gateway URL
# was told its "phone tunnel" was down (vm3, live 2026-09-30). The markers are
# the ones freemodels.mjs already uses for the mobile lane.
TELL=$(grep -c 'const onPhone = Boolean(process.env.TERMUX_VERSION || process.env.ANDROID_ROOT);' "$HERE/bot-host.mjs" || true)
[ "$TELL" = "2" ] \
  && { echo "  PASS  the phone-vs-VM tell is the platform, not the URL path"; PASS=$((PASS + 1)); } \
  || { echo "  FAIL  the phone-vs-VM tell is the platform, not the URL path (found $TELL of 2)"; FAIL=$((FAIL + 1)); }

# 13. The terminal launches the tool the CHAT is on, not the bot's default.
#     This is the class that shipped: the attach hardcoded $OPENCODE_BIN, so a
#     chat on cline:cline-free/deepseek-v4.1-flash opened an OpenCode TUI on a
#     stale opencode session id — a different agent on a different thread (live
#     2026-09-29, prefs said cline, the pane read "Build · MiMo-V2.6-Flash Free
#     OpenCode"). Pinned per lane, from the chat's own prefs row.
LANE="$ROOT/lane"
# TUI_STATE_ROOT is the PARENT of the bot dir; the attach builds
# $TUI_STATE_ROOT/$TUI_BOT_ID itself, so the files live one level down.
mkdir -p "$LANE/vm/cline-sessions"
run_lane() { # run_lane <chat> -> dry-run output
  TUI_STATE_ROOT="$LANE" TUI_BOT_ID=vm TUI_CHAT_ID="$1" TUI_WORKTREE=/w \
    OPENCODE_BIN=/oc CLINE_BIN=/cl CLINE_SESSIONS_DIR="$LANE/vm/cline-sessions" \
    TUI_DRY_RUN=1 bash "$ATTACH" 2>/dev/null
}
printf '{"111":"ses_open111"}\n' > "$LANE/vm/sessions.json"
printf '{"111":"1790_abc111"}\n' > "$LANE/vm/cline-sessions.json"

printf '{"111":{"model":"cline:cline-free/deepseek-v4.1-flash"}}\n' > "$LANE/vm/prefs.json"
out=$(run_lane 111)
check "a cline chat launches cline" "$(first "$out")" "SURFACE=cline SID=1790_abc111 SOURCE=explicit-hit"
printf '%s\n' "$out" | grep -q -- "-i" \
  && { echo "  PASS  the cline launch asks for the interactive TUI (-i)"; PASS=$((PASS + 1)); } \
  || { echo "  FAIL  the cline launch is missing -i: $out"; FAIL=$((FAIL + 1)); }
printf '%s\n' "$out" | grep -q "'--id' '1790_abc111'" \
  && { echo "  PASS  the cline launch resumes the chat's own cline session"; PASS=$((PASS + 1)); } \
  || { echo "  FAIL  the cline launch does not resume its session: $out"; FAIL=$((FAIL + 1)); }
if printf '%s\n' "$out" | grep -q "/oc"; then
  echo "  FAIL  a cline chat still launches the opencode binary"; FAIL=$((FAIL + 1))
else
  echo "  PASS  a cline chat never launches the opencode binary"; PASS=$((PASS + 1))
fi
if printf '%s\n' "$out" | grep -q "ses_open111"; then
  echo "  FAIL  a cline chat was handed the opencode session id"; FAIL=$((FAIL + 1))
else
  echo "  PASS  a cline chat is never handed the opencode session id"; PASS=$((PASS + 1))
fi

printf '{"111":{"model":"opencode/space-bunny-free"}}\n' > "$LANE/vm/prefs.json"
out=$(run_lane 111)
check "an opencode chat is unchanged" "$(first "$out")" "SURFACE=opencode SID=ses_open111 SOURCE=explicit-hit"
check "the opencode argv is byte-for-byte the old one" \
  "$(printf '%s\n' "$out" | grep '^CMD=')" "CMD='/oc' '--session' 'ses_open111'"

# An API-only lane has no screen. It must refuse, not silently fall back to
# opencode — a fallback IS the defect, wearing a different hat.
printf '{"111":{"model":"gemini:gemini-2.5-pro"}}\n' > "$LANE/vm/prefs.json"
out=$(run_lane 111)
check "a gemini chat has no terminal" "$(first "$out")" "SURFACE=gemini SID=ses_open111 SOURCE=explicit-hit"
if printf '%s\n' "$out" | grep -q '^CMD='; then
  echo "  FAIL  a gemini chat was given a launch command anyway"; FAIL=$((FAIL + 1))
else
  echo "  PASS  a gemini chat is given no launch command"; PASS=$((PASS + 1))
fi
# The refusal must name the REASON it refused, so the two refusals stay
# distinguishable: a lane with no terminal is actionable (/freemodel), and a
# failed resolver is a bug to look at. Collapsing them would report a broken
# resolver as "this chat has no terminal".
printf '%s\n' "$out" | grep -q '^REASON=.*no terminal' \
  && { echo "  PASS  the refusal names the lane reason"; PASS=$((PASS + 1)); } \
  || { echo "  FAIL  the refusal does not carry a reason: $out"; FAIL=$((FAIL + 1)); }
grep -q 'Could not work out which terminal' "$ATTACH" \
  && { echo "  PASS  a failed resolver is reported apart from a lane refusal"; PASS=$((PASS + 1)); } \
  || { echo "  FAIL  a failed resolver would be reported as a lane refusal"; FAIL=$((FAIL + 1)); }

# The live lane wins over the tui-open snapshot: a /freemodel switch after the
# button was sent must not keep launching the old tool.
printf '{"111":{"model":"cline:cline-free/deepseek-v4.1-flash"}}\n' > "$LANE/vm/prefs.json"
echo '{"chatId":"111","surface":"opencode","model":"opencode/space-bunny-free","sessionId":"ses_open111"}' > "$LANE/vm/tui-open.json"
out=$(run_lane 111)
check "the live lane beats a stale tui-open surface" "$(first "$out")" "SURFACE=cline SID=1790_abc111 SOURCE=explicit-hit"

# The pane mark carries the surface, so a lane switch reaps the previous tool's
# pane instead of leaving the old screen up.
grep -q 'MARK="${SURFACE}:${SID}"' "$ATTACH" \
  && { echo "  PASS  the pane mark is surface-qualified, so a lane switch reaps"; PASS=$((PASS + 1)); } \
  || { echo "  FAIL  the pane mark does not carry the surface"; FAIL=$((FAIL + 1)); }

# The cline CLI is not on the ttyd units' PATH, so each unit must name it.
for unit in tui-ttyd-vm tui-ttyd-vm2; do
  grep -q 'Environment=CLINE_BIN=' "$HERE/$unit.service" 2>/dev/null \
    && { echo "  PASS  $unit names CLINE_BIN"; PASS=$((PASS + 1)); } \
    || { echo "  FAIL  $unit does not name CLINE_BIN (cline is off its PATH)"; FAIL=$((FAIL + 1)); }
done

# The decision lives in one module the bot, the shell and these cases share, so
# a fix cannot land in one of the three and miss the others.
[ -f "$HERE/lib/tui-surface.mjs" ] \
  && { echo "  PASS  the lane decision lives in scripts/lib/tui-surface.mjs"; PASS=$((PASS + 1)); } \
  || { echo "  FAIL  scripts/lib/tui-surface.mjs is missing"; FAIL=$((FAIL + 1)); }
grep -q "lib/tui-surface.mjs" "$ATTACH" \
  && { echo "  PASS  the attach resolves the surface from that module"; PASS=$((PASS + 1)); } \
  || { echo "  FAIL  the attach does not read the shared surface module"; FAIL=$((FAIL + 1)); }
# And the attach must not name the opencode binary as its launch any more.
if grep -vE "^\s*#" "$ATTACH" | grep -q 'new-session.*"\$OPENCODE_BIN"'; then
  echo "  FAIL  the attach still launches \$OPENCODE_BIN unconditionally"; FAIL=$((FAIL + 1))
else
  echo "  PASS  the attach no longer launches \$OPENCODE_BIN unconditionally"; PASS=$((PASS + 1))
fi

# 14. A legacy or junk pane mark migrates instead of flapping. On 2026-09-29
#     /tmp/tui-session-id-vm held `ses_x` — a bare string with no `surface:`
#     prefix and no writer anywhere in this tree. A bare mark can never equal a
#     qualified `<surface>:<session>` mark, so the old compare killed the pane
#     on EVERY attach without saying why. The decision is a pure function now
#     (executed here like lease_held): junk reaps once, migrates, and logs.
eval "$(sed -n '/^pane_mark_decision() {/,/^}/p' "$ATTACH")"
check "no mark yet means a fresh pane" "$(pane_mark_decision '' 'cline:1790_x')" "fresh"
check "the same surface and session keeps the pane" \
  "$(pane_mark_decision 'cline:1790_x' 'cline:1790_x')" "keep"
check "a lane switch reaps the old tool's pane" \
  "$(pane_mark_decision 'opencode:ses_old' 'cline:1790_x')" "reap-switch"
check "a bare legacy session id reaps and migrates" \
  "$(pane_mark_decision 'ses_f227779acffeXj1OcLC4RXXWTW' 'cline:1790_x')" "reap-legacy"
check "writer-less junk (ses_x) reaps and migrates, never flaps silently" \
  "$(pane_mark_decision 'ses_x' 'cline:1790_x')" "reap-legacy"
# The migration must be observable after the fact: every attach logs its
# surface, session, source and decision to a per-bot log, and the reap
# verifies the kill landed before new-session -A (which ignores its command
# while the session still exists — the stale-tool survival path).
grep -q 'tui-attach.log' "$ATTACH" \
  && { echo "  PASS  every attach logs surface/sid/source/decision per bot"; PASS=$((PASS + 1)); } \
  || { echo "  FAIL  no per-bot attach log in the attach"; FAIL=$((FAIL + 1)); }
grep -q 'reap-verdict=lingering' "$ATTACH" \
  && { echo "  PASS  a lingering session is logged, never silently kept"; PASS=$((PASS + 1)); } \
  || { echo "  FAIL  no lingering-session verdict in the attach"; FAIL=$((FAIL + 1)); }
grep -q 'has-session -t "$TMUX_NAME"' "$ATTACH" \
  && { echo "  PASS  the reap verifies the kill before new-session -A"; PASS=$((PASS + 1)); } \
  || { echo "  FAIL  the reap does not verify the kill before new-session -A"; FAIL=$((FAIL + 1)); }

# The bot's turn path must compute its workspace-scoped session id only after
# the work session exists. #365 (2026-09-30) assigned it above the `let
# workSession`, so every plain message on every bot died with "Cannot access
# 'workSession' before initialization" while every command kept working — only
# a live turn found it. This pins the order.
BOT="$HERE/bot-host.mjs"
ws_line=$(grep -n 'let workSession = resolveSession(' "$BOT" | head -1 | cut -d: -f1)
ts_line=$(grep -n 'turnSessionId = sessionForWorkspace(' "$BOT" | head -1 | cut -d: -f1)
if [ -n "$ws_line" ] && [ -n "$ts_line" ] && [ "$ws_line" -lt "$ts_line" ]; then
  echo "  PASS  the turn session id is computed after the work session exists"; PASS=$((PASS + 1));
else
  echo "  FAIL  the turn session id is computed after the work session exists (workSession@${ws_line:-missing}, turnSessionId@${ts_line:-missing})"; FAIL=$((FAIL + 1));
fi

# 15. Workspace-scoped rows (bot-host #365 writes `<workspace>\\u0000<id>`).
#     The resolver must split the scope, never match the packed string: live
#     2026-10-01 vm3 TUI opened a fresh session (SID empty, legacy-first)
#     while Telegram answered from the chat real session.
SCOPED="$ROOT/scoped"
mkdir -p "$SCOPED/vm3" "$SCOPED/w"
WS="$SCOPED/w"
scoped_run() { # scoped_run outputs the dry-run decision line
  TUI_STATE_ROOT="$SCOPED" TUI_BOT_ID=vm3 TUI_WORKTREE="$WS" \
    OPENCODE_BIN=/oc CLINE_BIN=/cl \
    TUI_DRY_RUN=1 bash "$ATTACH" 2>/dev/null | grep '^SURFACE='
}
printf '{"6218257274": "%s\\u0000ses_live123"}' "$WS" > "$SCOPED/vm3/sessions.json"
printf '{"chatId":"6218257274","surface":"opencode","model":"opencode/nemotron-3.5-lightning-free","sessionId":"ses_live123","workspace":"%s"}' "$WS" > "$SCOPED/vm3/tui-open.json"
check "a scoped row resolves through tui-open" "$(scoped_run)" "SURFACE=opencode SID=ses_live123 SOURCE=tui-open-hit"
check "a scoped row resolves explicit" "$(TUI_CHAT_ID=6218257274 scoped_run)" "SURFACE=opencode SID=ses_live123 SOURCE=explicit-hit"
# Another workspace row is never borrowed: the cross-project drift scoping
# was built to stop.
printf '{"6218257274": "/other/proj\\u0000ses_other999"}' > "$SCOPED/vm3/sessions.json"
rm "$SCOPED/vm3/tui-open.json"
check "a foreign-workspace row is refused, not attached" "$(TUI_CHAT_ID=6218257274 scoped_run)" "SURFACE=opencode SID= SOURCE=legacy-first"
# The map lost the row but /tui recorded this workspace session seconds ago.
printf '{}' > "$SCOPED/vm3/sessions.json"
printf '{"chatId":"6218257274","surface":"opencode","model":"opencode/nemotron-3.5-lightning-free","sessionId":"ses_snap999","workspace":"%s"}' "$WS" > "$SCOPED/vm3/tui-open.json"
check "a lost map row falls back to the opening-chat snapshot" "$(TUI_CHAT_ID=6218257274 scoped_run)" "SURFACE=opencode SID=ses_snap999 SOURCE=tui-open-snapshot"
# ...but the snapshot never serves a different explicit chat.
printf '{"111": "ses_A111"}' > "$SCOPED/vm3/sessions.json"
check "the snapshot does not hijack another chat" "$(TUI_CHAT_ID=111 scoped_run)" "SURFACE=opencode SID=ses_A111 SOURCE=explicit-hit"

rm -rf "$SCOPED"
rm -rf "$LEASE_FIX" "$ROOT" "$LANE"
echo
echo "$PASS pass, $FAIL fail"
[ "$FAIL" -eq 0 ]
