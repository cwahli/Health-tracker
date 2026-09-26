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
set -u

pattern='^Agent: [^ ].+ \([^)]+\)$'

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
  # Every remaining word is a rev-list argument, so a caller can say
  #   --range <base>..HEAD --not origin/<base>
  # and the exclusion is real. A single quoted "<base>..HEAD --not origin/<base>"
  # string is NOT parsed as a rev list by git: it errors, and the loop below then
  # runs zero times — a silent pass on a gate that exists to catch a missing
  # trailer. So the arguments are passed through, and an unusable range is a
  # failure rather than an empty success.
  if ! commits=$(git rev-list "$@"); then
    echo "check-agent-identity: git rev-list failed for: $*" >&2
    exit 1
  fi
  if [ -z "$commits" ]; then
    # Nothing this change adds is unvetted — e.g. a re-push of a branch whose
    # commits are already on the base. Distinct from the rev-list failure
    # above, which is a broken range and must not read as a pass.
    echo "check-agent-identity: no new commits in: $*"
    exit 0
  fi
  fail=0
  for sha in $commits; do
    check_commit "$sha" || fail=1
  done
  exit "$fail"
fi

echo "Usage: check-agent-identity.sh --message <file> | --range <rev> [<rev> ...]" >&2
exit 2
