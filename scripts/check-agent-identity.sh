#!/bin/sh
# Mandatory agent identity on every non-merge commit.
#
# One trailer line, exactly:
#   Agent: <model and version> (<thinking level>)
# Examples:
#   Agent: Grok 4.7 (High)
#   Agent: opencode-go/space-bunny-free (max)
#
# The name is the model and version as the provider shows them. The
# parentheses are the thinking level. A name with no version, or a line
# with no thinking level, is rejected.
#
# Grandfather clause: the rule landed in c8cc6dc (2026-09-26T21:51:04Z). A
# commit authored before that cannot be judged by a rule it predates, so it is
# reported and skipped rather than failed. Without this, every branch that was
# already in flight when the rule shipped is unmergeable forever, and the
# pressure to fix that lands on rewriting someone else's history. Override the
# cutoff with --since <iso8601>; pass --no-grandfather to judge everything.
set -u

pattern='^Agent: [^ ].+ \([^)]+\)$'

# The moment this rule became real. Keep in step with the commit that added it.
RULE_LANDED_AT='2026-09-26T21:51:04Z'
since="$RULE_LANDED_AT"
grandfather=1

check_file() {
  file=$1
  if grep -Eq "$pattern" "$file"; then
    return 0
  fi
  echo "Commit rejected. Add one trailer line:" >&2
  echo "  Agent: <model and version> (<thinking level>)" >&2
  echo "Example: Agent: Grok 4.7 (High)" >&2
  echo "Set AGENT_IDENTITY to that text (without the 'Agent:' prefix) if a tool commits for you." >&2
  return 1
}

check_commit() {
  sha=$1
  # Merge commits are made by GitHub, not by an agent.
  if git rev-parse --verify -q "$sha^2" >/dev/null 2>&1; then
    return 0
  fi
  # Author date, not commit date: a rebase rewrites the commit date, and the
  # question is when the work was written, not when it was re-stamped.
  authored=$(git log -1 --format=%aI "$sha" 2>/dev/null || echo "")
  if [ "$grandfather" = "1" ] && [ -n "$authored" ] && [ "$authored" \< "$since" ]; then
    grandfathered=$((grandfathered + 1))
    return 0
  fi
  msg=$(git log -1 --format=%B "$sha")
  printf '%s\n' "$msg" | grep -Eq "$pattern" && return 0
  echo "Commit $sha has no agent identity." >&2
  echo "Required line: Agent: <model and version> (<thinking level>)" >&2
  printf '%s\n' "$msg" | head -n 8 >&2
  return 1
}

if [ "${1:-}" = "--message" ]; then
  check_file "$2"
  exit $?
fi

if [ "${1:-}" = "--range" ]; then
  shift
  # Flags and revs are collected separately. A caller can say
  #   --range <base>..HEAD --not origin/<base> --since <iso>
  # in any order, and the rev list is exactly the words that are not flags.
  # Parsing the revs off the end and passing the rest to rev-list is not safe:
  # a flag sitting between revs would either be read as a rev or, worse, leave
  # rev-list with nothing (which means ALL commits, not none).
  revs=""
  nrevs=0
  while [ $# -gt 0 ]; do
    case "$1" in
      --since)
        [ $# -ge 2 ] || { echo "check-agent-identity: --since needs a value" >&2; exit 2; }
        since=$2; shift 2 ;;
      --no-grandfather) grandfather=0; shift ;;
      --range) shift ;;
      *) revs="$revs $1"; nrevs=$((nrevs + 1)); shift ;;
    esac
  done
  if [ "$nrevs" -eq 0 ]; then
    echo "check-agent-identity: --range was given no rev to walk" >&2
    exit 2
  fi
  # Word splitting is intended here: revs is a list, not one argument.
  # shellcheck disable=SC2086
  if ! commits=$(git rev-list $revs); then
    echo "check-agent-identity: git rev-list failed for:$revs" >&2
    exit 1
  fi
  if [ -z "$commits" ]; then
    # Nothing this change adds is unvetted — e.g. a re-push of a branch whose
    # commits are already on the base. Distinct from the rev-list failure
    # above, which is a broken range and must not read as a pass.
    echo "check-agent-identity: no new commits in:$revs"
    exit 0
  fi
  fail=0
  grandfathered=0
  for sha in $commits; do
    check_commit "$sha" || fail=1
  done
  if [ "$grandfathered" -gt 0 ]; then
    echo "check-agent-identity: $grandfathered commit(s) authored before $since are grandfathered (the rule did not exist yet)."
  fi
  exit "$fail"
fi

echo "Usage: check-agent-identity.sh --message <file>" >&2
echo "       check-agent-identity.sh --range [<rev> ...] [--since <iso8601>] [--no-grandfather]" >&2
exit 2
