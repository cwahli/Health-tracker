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
check "explicit chat resolves its own session" "$out" "SID=ses_A111 SOURCE=explicit-hit"

# 2. tui-open.json (what /tui writes) selects without any env.
echo '{"chatId":"222","sessionId":"ses_B222","at":"2026-09-27T07:00:00.000Z"}' > "$STATE/tui-open.json"
out=$(TUI_STATE_ROOT="$ROOT/state/bot-host" TUI_BOT_ID=vm TUI_DRY_RUN=1 bash "$ATTACH")
check "tui-open selects the opening chat" "$out" "SID=ses_B222 SOURCE=tui-open-hit"

# 3. Explicit beats a stale tui-open from another chat.
out=$(TUI_STATE_ROOT="$ROOT/state/bot-host" TUI_BOT_ID=vm TUI_CHAT_ID=111 TUI_DRY_RUN=1 bash "$ATTACH")
check "explicit beats stale tui-open" "$out" "SID=ses_A111 SOURCE=explicit-hit"

# 4. A chat with no session falls back loudly, not silently to another chat.
# NOTE: {"222","111"} iterates as 111,222 — integer-like keys sort numerically
# in JS objects regardless of insertion order, which is precisely why ids[0]
# is an arbitrary pick and must always be labelled legacy-first.
rm "$STATE/tui-open.json"
out=$(TUI_STATE_ROOT="$ROOT/state/bot-host" TUI_BOT_ID=vm TUI_CHAT_ID=999 TUI_DRY_RUN=1 bash "$ATTACH")
check "unknown chat falls back loudly" "$out" "SID=ses_A111 SOURCE=legacy-first"

# 5. A missing map resolves empty, never a garbage session.
rm "$STATE/sessions.json"
out=$(TUI_STATE_ROOT="$ROOT/state/bot-host" TUI_BOT_ID=vm TUI_CHAT_ID=111 TUI_DRY_RUN=1 bash "$ATTACH")
check "missing map resolves empty" "$out" "SID= SOURCE=legacy-first"

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
grep -q 'set-option -t "$TMUX_NAME" status off' "$ATTACH" \
  && { echo "  PASS  the tmux frame stays off the phone screen"; PASS=$((PASS + 1)); } \
  || { echo "  FAIL  the tmux frame stays off the phone screen"; FAIL=$((FAIL + 1)); }
rm -rf "$LEASE_FIX" "$ROOT"
echo
echo "$PASS pass, $FAIL fail"
[ "$FAIL" -eq 0 ]
