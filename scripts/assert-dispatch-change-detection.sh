#!/usr/bin/env bash
# assert-dispatch-change-detection — the dispatcher must see an agent's work.
#
# run-coding-dispatch.sh decides whether a coder produced a fix by diffing the
# worktree against a snapshot taken before the agent started. It used to diff
# `git status --porcelain` LINES, which record path and status letter but not the
# file's contents — so an agent editing a file that was already modified produced
# a byte-identical line and the change was invisible.
#
# That is not a corner case: a reused dispatch worktree carries dirt from an
# earlier aborted attempt, so card #19's coder produced a real fix and the
# dispatcher reported "No code changes produced", blocked the card, and charged a
# tool-allowance failure against the agent for work it had actually done.
#
# These assertions exercise the REAL functions, extracted from the script by name,
# against throwaway repos. Four cases: a clean file edited, an already-dirty file
# edited further (the regression), untouched pre-existing dirt (must still not
# count), and a brand-new untracked file.
#
# Exit 0 = pass. Offline.

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$HERE/.." && pwd)"
DISPATCH="$REPO_ROOT/scripts/run-coding-dispatch.sh"

pass=0; fail=0
failures=()

ok()   { pass=$((pass+1)); printf '  ok  %s\n' "$1"; }
bad()  { fail=$((fail+1)); failures+=("$1: $2"); printf '  FAIL %s — %s\n' "$1" "$2"; }

# --- extract the real functions -------------------------------------------
LIB="$(mktemp)"
for fn in workspace_fingerprint snapshot_workspace new_changes; do
  if ! awk -v want="$fn" '
    $0 ~ "^"want"\\(\\) \\{" { inside=1 }
    inside { print }
    inside && /^}/ { exit }
  ' "$DISPATCH" >> "$LIB"; then
    echo "[assert] could not extract $fn from $DISPATCH" >&2
    exit 1
  fi
done
if ! grep -q 'workspace_fingerprint' "$LIB" || ! grep -q 'new_changes' "$LIB"; then
  cat >&2 <<'MSG'
[assert] run-coding-dispatch.sh has no content-aware workspace_fingerprint().
[assert] Without it the dispatcher diffs `git status --porcelain` LINES, which record
[assert] path and status letter but not the file's contents. An agent editing a file
[assert] that was already modified then produces a byte-identical line and the change
[assert] is invisible — which is how card #19's real fix was reported as
[assert] "No code changes produced", blocking the card and charging a tool-allowance
[assert] failure against an agent that had done the work.
MSG
  rm -f "$LIB"
  exit 1
fi
# shellcheck disable=SC1090
. "$LIB"

# --- helpers ---------------------------------------------------------------
new_repo() {
  CODER_DIR="$(mktemp -d)"
  git -C "$CODER_DIR" init -q .
  git -C "$CODER_DIR" config user.email t@t
  git -C "$CODER_DIR" config user.name t
  printf 'one\n' > "$CODER_DIR/tracked.txt"
  git -C "$CODER_DIR" add -A
  git -C "$CODER_DIR" commit -qm base
}
contains() { grep -qxF "$1" <<<"$2"; }

# --- 1. a clean file the agent edits --------------------------------------
new_repo
snapshot_workspace
printf 'edited\n' > "$CODER_DIR/tracked.txt"
out="$(new_changes)"
if contains tracked.txt "$out"; then
  ok "an edit to a clean tracked file is detected"
else
  bad "an edit to a clean tracked file is detected" "got: $(echo "$out" | tr '\n' ' ')"
fi

# --- 2. THE REGRESSION: an already-dirty file edited further --------------
new_repo
printf 'dirty before the agent\n' > "$CODER_DIR/tracked.txt"   # pre-existing dirt
snapshot_workspace
printf 'dirty AFTER the agent\n' > "$CODER_DIR/tracked.txt"   # agent's real work
out="$(new_changes)"
if contains tracked.txt "$out"; then
  ok "an edit to an ALREADY-DIRTY file is detected (the card-19 regression)"
else
  bad "an edit to an ALREADY-DIRTY file is detected (the card-19 regression)" \
      "got: $(echo "$out" | tr '\n' ' ') — porcelain status is unchanged by an edit"
fi

# --- 3. untouched pre-existing dirt still does not count ------------------
new_repo
printf 'dirty, never touched\n' > "$CODER_DIR/tracked.txt"
printf 'stray\n' > "$CODER_DIR/stray.txt"
snapshot_workspace
out="$(new_changes)"
if [ -z "$out" ]; then
  ok "pre-existing dirt the agent never touched is not counted"
else
  bad "pre-existing dirt the agent never touched is not counted" "got: $(echo "$out" | tr '\n' ' ')"
fi

# --- 4. a brand-new untracked file ---------------------------------------
new_repo
snapshot_workspace
printf 'new\n' > "$CODER_DIR/fresh.ts"
out="$(new_changes)"
if contains fresh.ts "$out"; then
  ok "a new untracked file is detected"
else
  bad "a new untracked file is detected" "got: $(echo "$out" | tr '\n' ' ')"
fi

# --- 5. and with no snapshot, everything dirty is reported ---------------
rm -f "${SNAP_FILE:-}"
out="$(new_changes)"
if [ -n "$out" ]; then
  ok "with no snapshot the dirty set is reported (never silently empty)"
else
  bad "with no snapshot the dirty set is reported (never silently empty)" "got nothing"
fi

rm -f "$LIB"
echo
echo "assert-dispatch-change-detection: $pass pass, $fail fail"
if [ "$fail" -gt 0 ]; then
  printf 'FAILURES:\n'
  for f in "${failures[@]}"; do printf '  - %s\n' "$f"; done
  exit 1
fi
exit 0