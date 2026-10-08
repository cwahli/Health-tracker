#!/usr/bin/env bash
# assert-dispatch-lifecycle — the dispatcher must not outlive its own work.
#
# Two defects, both found by looking at running processes rather than at code.
#
# 1. Every dispatch leaked a Telegram typing loop.
#    `start_heartbeat` spawns `( while true; do telegram-send --action=typing;
#    sleep 4; done ) &` and relies on the heartbeat subshell's own
#    `trap "kill $TYPING_PID" EXIT` to reap it. That trap cannot fire in time:
#    the heartbeat is asleep in `sleep $interval_secs` (120s default), bash defers
#    a trap until the running foreground command returns, and `stop_heartbeat`
#    escalates to `kill -9` after 3s. SIGKILL runs no traps, so the typing loop
#    survived — reparented to init, still calling the Telegram API every 4s.
#    Measured orphans on this box: 6.8 days and two at 29 hours old, each pinning
#    the chat header on "working" long after its dispatch finished.
#
# 2. A card closed mid-flight kept being retried.
#    The launch guard reads one snapshot taken before any agent runs. Nothing
#    re-checked it, so a nudge could spend another agent on a card someone had
#    already closed, then report "could not resolve" and charge a tool-allowance
#    failure for work nobody wanted. Card #19 sat that way for 29 hours.
#
# These assertions exercise the REAL functions, extracted from the script by
# name, against stubbed telegram/bugctl/guard binaries. No network, no dispatch.
#
# Exit 0 = pass. Offline.

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$HERE/.." && pwd)"
DISPATCH="$REPO_ROOT/scripts/run-coding-dispatch.sh"

pass=0; fail=0
failures=()

ok()  { pass=$((pass+1)); printf '  ok  %s\n' "$1"; }
bad() { fail=$((fail+1)); failures+=("$1: $2"); printf '  FAIL %s — %s\n' "$1" "$2"; }

if [ ! -f "$DISPATCH" ]; then
  echo "[assert] $DISPATCH not found" >&2
  exit 1
fi

# --- extract the real functions -------------------------------------------
# start_heartbeat/stop_heartbeat must exist or the script changed shape.
# card_still_dispatchable is treated differently on purpose: on the pre-fix code it
# is absent, and aborting there would hide the heartbeat leak — the older and
# worse of the two bugs. Its assertions are marked failed instead, so running this
# against the old dispatcher shows BOTH regressions rather than stopping at the
# first thing it cannot find.
LIB="$(mktemp)"
for fn in start_heartbeat stop_heartbeat; do
  if ! grep -q "^${fn}() {" "$DISPATCH"; then
    echo "[assert] $DISPATCH has no ${fn}() — the dispatcher changed shape" >&2
    rm -f "$LIB"
    exit 1
  fi
  awk -v want="$fn" '
    $0 ~ "^" want "\\(\\) \\{" { inside=1 }
    inside { print }
    inside && /^}/ { exit }
  ' "$DISPATCH" >> "$LIB"
done

HAS_RECHECK=0
if grep -q "^card_still_dispatchable() {" "$DISPATCH"; then
  HAS_RECHECK=1
  awk '
    /^card_still_dispatchable\(\) \{/ { inside=1 }
    inside { print }
    inside && /^}/ { exit }
  ' "$DISPATCH" >> "$LIB"
else
  echo "[assert] $DISPATCH has no card_still_dispatchable() — a card closed mid-flight is never re-checked" >&2
fi

# shellcheck disable=SC1090
. "$LIB"

TMP="$(mktemp -d)"
# Self-cleaning, and deliberately so. Against the unfixed dispatcher this script
# leaks the very loop it is testing for: the orphan keeps the inherited stdout
# open, so `... | tail` never reaches EOF and the gate HANGS instead of failing.
# A gate that hangs is worse than no gate — it burns a runner and reports nothing.
# So the exit trap reaps the loop first, and the assertions above still record the
# failure on the way out.
cleanup() {
  pkill -KILL -f "$TELEGRAM_SCRIPT" 2>/dev/null || true
  rm -rf "$TMP" "$LIB"
}
trap cleanup EXIT INT TERM

# --- stubs -----------------------------------------------------------------
# The typing loop calls this with --action=typing. It appends a line per call so
# the test can prove the loop stopped, and it carries MARKER in its cmdline so the
# test can prove no process survived.
MARKER="dispatch-lifecycle-stub-$$"
TELEGRAM_SCRIPT="$TMP/telegram.sh"
cat > "$TELEGRAM_SCRIPT" <<EOF
#!/usr/bin/env bash
echo "call" >> "$TMP/calls"
sleep 0.2
EOF
chmod +x "$TELEGRAM_SCRIPT"

DISPATCH_PROFILE="assert"
BUG_ID="#ASSERT"
START_TIME=$(( $(date +%s) - 60 ))
tg_msg() { :; }                       # the heartbeat's Telegram ping
clean_workspace() { :; }
export TELEGRAM_SCRIPT DISPATCH_PROFILE BUG_ID START_TIME

# =====================================================================
# 1. stop_heartbeat must leave no typing loop behind
# =====================================================================
# The interval must exceed stop_heartbeat's 3s grace window, or this test passes
# for the wrong reason. With a short interval the heartbeat's `sleep` returns
# inside the window, the EXIT trap fires, and the typing loop is reaped — so the
# old code looks clean. The bug only exists in the production ratio: the heartbeat
# sleeps 120s, the grace window is 3s, so the trap is always still pending when
# SIGKILL lands. 30s keeps the same ordering and keeps the gate quick.
start_heartbeat "assert-tool" "" 30
sleep 5                                   # the typing loop calls every 4s
if [ "$(wc -l < "$TMP/calls" 2>/dev/null || echo 0)" -lt 1 ]; then
  bad "the typing loop runs while the heartbeat is up" "it never called telegram-send in 5s"
else
  ok "the typing loop runs while the heartbeat is up"
fi

stop_heartbeat

# The decisive check, and it is deliberately the same shape as the real symptom.
# A leaked typing loop is a `bash` process that inherited this script's argv and,
# once its heartbeat parent is SIGKILLed, is REPARENTED TO INIT. That is exactly
# what was found on the live box:
#
#   pid=808952 ppid=1 age=104632s  cmd=bash scripts/run-coding-dispatch.sh --ticket=#19 ...
#
# Note it is NOT found by pgrep-ing the telegram stub: that process only exists
# while a call is in flight, so it is visible for ~0.2s out of every 4.2s cycle
# and a pgrep races it. The orphan itself is the permanent evidence, so match on
# that: this script's own argv, parented to pid 1. `pgrep -f` would also match this
# test process, so compare against our own pid.
sleep 1
orphans="$(ps -eo pid=,ppid=,args= 2>/dev/null \
  | grep -F "$0" | grep -v grep \
  | awk -v me="$$" '$2 == 1 && $1 != me { print $1 }' | wc -l)"
if [ "$orphans" -eq 0 ]; then
  ok "stop_heartbeat leaves no typing-loop process reparented to init"
else
  bad "stop_heartbeat leaves no typing-loop process reparented to init" \
      "$orphans orphan(s) with ppid=1 — SIGKILL on the heartbeat cannot run its EXIT trap, so the loop survives forever"
fi

# And it must stay dead: a leaked loop calls again every 4s, forever.
before="$(wc -l < "$TMP/calls" 2>/dev/null || echo 0)"
sleep 10
after="$(wc -l < "$TMP/calls" 2>/dev/null || echo 0)"
if [ "$after" -eq "$before" ]; then
  ok "no further Telegram calls after stop_heartbeat (10s, >2 cycles)"
else
  bad "no further Telegram calls after stop_heartbeat (10s, >2 cycles)" \
      "calls went $before -> $after; the loop outlived its dispatch"
fi

if [ -z "${TYPING_PID_FILE:-}" ] || [ ! -f "$TYPING_PID_FILE" ]; then
  ok "the typing-pid handoff file is cleaned up"
else
  bad "the typing-pid handoff file is cleaned up" "left behind at $TYPING_PID_FILE"
fi

# =====================================================================
# 2. a card closed mid-flight must stop the dispatch
# =====================================================================
# Fake bugctl: emits a packet. Fake guard: refuses, exactly as it does for a
# card that is already done. Both are invoked as `node <script>`, so they must be
# JavaScript — a bash stub would fail to parse and the read would "fail", which
# would make these assertions pass or fail for the wrong reason.
BUGCTL="$TMP/bugctl-ok.mjs"
cat > "$BUGCTL" <<'EOF'
console.log(JSON.stringify({
  tag_id: 'tag_x', public_n: 19, state: 'done', queue: 'done', title: 't',
  defect: { component: 'c', observed: 'o', expected: 'e', criteria: 'g' },
}));
EOF

# The read-failure stub must be a separate file: the test asserts that a failed
# read PROCEEDS, and pointing BUGCTL at a script that refuses would otherwise be
# indistinguishable from a refusal.
BUGCTL_FAIL="$TMP/bugctl-fail.mjs"
printf 'process.exit(1);\n' > "$BUGCTL_FAIL"

DISPATCH_HELPER="$TMP/guard-refuse.mjs"
cat > "$DISPATCH_HELPER" <<'EOF'
console.log('refused: card is already done');
process.exit(1);
EOF

export DISPATCH_HELPER
TICKET="19"

if [ "$HAS_RECHECK" -eq 0 ]; then
  bad "a closed card is refused on re-check (no second agent is spent)" \
      "card_still_dispatchable() does not exist; the launch guard reads one snapshot and nothing re-checks it"
  bad "the re-check latches CARD_CLOSED so the tool loop stops" \
      "card_still_dispatchable() does not exist; the tool loop always falls through and escalates"
  # Still exercise the read-failure and legacy-path cases against the old code so
  # the report is complete rather than short-circuited.
  bad "a failed re-read proceeds rather than inventing a refusal" "no re-check exists to test"
  bad "the legacy --task path (no card) is not blocked by the re-check" "no re-check exists to test"
  echo
  echo "assert-dispatch-lifecycle: $pass pass, $fail fail"
  printf 'FAILURES:\n'
  for f in "${failures[@]}"; do printf '  - %s\n' "$f"; done
  exit 1
fi

CARD_CLOSED=0
rc=0
BUGCTL="$TMP/bugctl-ok.mjs" card_still_dispatchable >/dev/null 2>&1 || rc=$?
if [ "$rc" -ne 0 ]; then
  ok "a closed card is refused on re-check (no second agent is spent)"
else
  bad "a closed card is refused on re-check (no second agent is spent)" \
      "returned 0 — the nudge would run against a card that is already done"
fi

if [ "${CARD_CLOSED:-0}" = "1" ]; then
  ok "the re-check latches CARD_CLOSED so the tool loop stops"
else
  bad "the re-check latches CARD_CLOSED so the tool loop stops" \
      "CARD_CLOSED=${CARD_CLOSED:-unset}; the loop falls through to the next tool and then escalates"
fi

# A read failure must NOT become a refusal. Inventing a refusal from a failed
# read is the fabrication this repo refuses elsewhere, and it would silently
# abandon live work on a transient API blip.
CARD_CLOSED=0
rc=0
BUGCTL="$BUGCTL_FAIL" card_still_dispatchable >/dev/null 2>&1 || rc=$?
if [ "$rc" -eq 0 ] && [ "${CARD_CLOSED:-0}" = "0" ]; then
  ok "a failed re-read proceeds rather than inventing a refusal"
else
  bad "a failed re-read proceeds rather than inventing a refusal" \
      "rc=$rc CARD_CLOSED=${CARD_CLOSED:-unset} — a transient API failure would abandon the run"
fi

# The legacy --task path has no card to re-read and must not be blocked.
TICKET=""
CARD_CLOSED=0
rc=0
card_still_dispatchable >/dev/null 2>&1 || rc=$?
if [ "$rc" -eq 0 ]; then
  ok "the legacy --task path (no card) is not blocked by the re-check"
else
  bad "the legacy --task path (no card) is not blocked by the re-check" "returned $rc"
fi

echo
echo "assert-dispatch-lifecycle: $pass pass, $fail fail"
if [ "$fail" -gt 0 ]; then
  printf 'FAILURES:\n'
  for f in "${failures[@]}"; do printf '  - %s\n' "$f"; done
  exit 1
fi
exit 0