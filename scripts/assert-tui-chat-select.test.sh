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

rm -rf "$ROOT"
echo
echo "$PASS pass, $FAIL fail"
[ "$FAIL" -eq 0 ]
