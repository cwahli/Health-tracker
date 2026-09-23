#!/usr/bin/env bash
# Fixture test for sync-workbench-clean-ff.sh (no network, temp repos only).
# Cases: clean+behind => pulled | dirty+behind => skipped untouched |
# current => noop | diverged => skipped untouched.
set -u

HOOK="${HOOK:-/root/Health-tracker/scripts/sync-workbench-clean-ff.sh}"
T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT

export SYNC_LOCK_FILE="$T/lock"
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t

pass=0; fail=0
check() { # name, then a bash -c snippet evaluated with $T in env
  local name="$1"; shift
  if env T="$T" bash -c "$*" >/dev/null 2>&1; then pass=$((pass+1)); echo "PASS $name"; else fail=$((fail+1)); echo "FAIL $name"; fi
}

# Origin with main branch + proper HEAD; two clones behind it.
git init -q -b main --bare "$T/origin.git"
git clone -q "$T/origin.git" "$T/seed"
git -C "$T/seed" commit -q --allow-empty -m base && git -C "$T/seed" push -q -u origin main
git clone -q "$T/origin.git" "$T/clean"
git clone -q "$T/origin.git" "$T/dirty"
# Advance origin so both clones are behind by 1.
git -C "$T/seed" commit -q --allow-empty -m second && git -C "$T/seed" push -q origin main
# Dirty tree in one clone (uncommitted edit + untracked file).
echo edit >> "$T/dirty/file.txt"; echo new > "$T/dirty/untracked.txt"

WORKBENCH_ROOTS="$T/clean $T/dirty" bash "$HOOK" --log "$T/sync.log" >/dev/null

check "clean clone fast-forwarded" '[ "$(git -C "$T/clean" rev-list --count HEAD..origin/main)" = "0" ]'
check "clean clone has new commit" 'git -C "$T/clean" log --oneline | grep -q second'
check "dirty clone NOT moved" '[ "$(git -C "$T/dirty" rev-list --count HEAD..origin/main)" = "1" ]'
check "dirty edit preserved" 'grep -q edit "$T/dirty/file.txt"'
check "dirty untracked preserved" 'test -f "$T/dirty/untracked.txt"'
check "log records pull" 'grep -q "PULLED $T/clean" "$T/sync.log"'
check "log records dirty skip" 'grep -q "SKIP $T/dirty.*dirty" "$T/sync.log"'

# Second run: everything current => noop, exit 0.
WORKBENCH_ROOTS="$T/clean" bash "$HOOK" --log "$T/sync.log" >/dev/null
check "second run exit 0" 'true'
check "log records done line" 'tail -1 "$T/sync.log" | grep -q "pulled=0 current=1 skipped=0"'

# Diverged clone: local commit on top, origin moved again => must NOT merge.
git clone -q "$T/origin.git" "$T/div"
git -C "$T/div" commit -q --allow-empty -m local-only
git -C "$T/seed" commit -q --allow-empty -m third && git -C "$T/seed" push -q origin main
WORKBENCH_ROOTS="$T/div" bash "$HOOK" --log "$T/sync.log" >/dev/null
check "diverged keeps local commit" 'git -C "$T/div" log --oneline | grep -q local-only'
check "diverged has no merge commit" '[ "$(git -C "$T/div" log --oneline | wc -l)" = "3" ]'
check "diverged absent from origin" '[ "$(git -C "$T/seed" log --oneline | grep -c local-only)" = "0" ]'
check "log records diverged skip" 'grep -q "SKIP $T/div.*diverged" "$T/sync.log"'

# Linked worktree (".git" is a FILE, not a directory — the /home/ubuntu/dev/* layout).
# Regression: a `[ -d "$root/.git" ]` guard silently skipped every worktree.
git -C "$T/seed" worktree add -q -b wtmain "$T/wt" 2>/dev/null
git -C "$T/wt" branch -q --set-upstream-to=origin/main wtmain 2>/dev/null
git -C "$T/seed" commit -q --allow-empty -m fourth && git -C "$T/seed" push -q origin main
check "worktree .git is a file" 'test -f "$T/wt/.git"'
check "worktree was behind before sync" 'test "$(git -C "$T/wt" rev-list --count HEAD..origin/main)" = "1"'
WORKBENCH_ROOTS="$T/wt" bash "$HOOK" --log "$T/sync.log" >/dev/null
check "worktree fast-forwarded" '[ "$(git -C "$T/wt" rev-list --count HEAD..origin/main)" = "0" ]'
check "worktree has new commit" 'git -C "$T/wt" log --oneline | grep -q fourth'
check "log records worktree pull" 'grep -q "PULLED $T/wt" "$T/sync.log"'

echo "---"
echo "pass=$pass fail=$fail"
[ "$fail" = "0" ]
