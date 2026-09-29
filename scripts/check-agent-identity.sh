#!/bin/sh
# Mandatory author identity on every non-merge commit.
#
# One trailer line, exactly:
#   Author: <model and version> (<thinking level>) <location>
# Examples:
#   Author: Grok 4.7 (High) VM
#   Author: opencode-go/space-bunny-free (max) VM
#
# The location is where the work ran (VM, vignette hostname, device). A name
# with no version, a line with no thinking level, or a line with no location
# is rejected.
#
# The legacy `Agent:` prefix is still accepted (branches in flight carry it),
# but new commits must use `Author:`.
#
# Grandfather clause: the rule landed in c8cc6dc (2026-09-26T21:51:04Z). A
# commit authored before that cannot be judged by a rule it predates, so it is
# reported and skipped rather than failed. Without this, every branch that was
# already in flight when the rule shipped is unmergeable forever, and the
# pressure to fix that lands on rewriting someone else's history. Override the
# cutoff with --since <iso8601>; pass --no-grandfather to judge everything.
set -u

# A thinking level is a WORD: a letter, then letters/digits/dot/underscore/dash.
# This rejects `n/a`, which is a placeholder rather than a level — and it is
# indistinguishable from an agent that had not bothered to look one up. A model
# that genuinely offers no levels should say `none`, which is a word and still
# tells the reader the truth.
LEVEL='\([A-Za-z][A-Za-z0-9._-]*\)'
# A location token: no spaces, so the shape stays unambiguous.
LOCATION='[A-Za-z0-9][A-Za-z0-9._-]*'

# Shape, with the prefix left open on purpose. The `Author:` rename is a rule
# with a date (PREFIX_SINCE below), not a rewrite of the shape, so the two are
# checked independently: a trailer can have the right shape and the wrong era.
pattern="^(Agent|Author): [^ ].+ ${LEVEL}\$"
new_pattern="^(Agent|Author): [^ ].+ ${LEVEL} ${LOCATION}\$"
# The shape a PR body must have. Bodies are written at the moment of the PR, so
# there is no "older work" to excuse: `Author:`, a word for the thinking level,
# and a location. This is also the shape every tool that commits for an agent
# must produce (see AUTHOR_IDENTITY below).
author_pattern="^Author: [^ ].+ ${LEVEL} ${LOCATION}\$"

# An empty range is a pass only when the caller says so. See the check below.
allow_empty=0

# Commits authored before this timestamp keep the old shape (no location).
# Anything authored after must name its location. In-flight work rebased
# after this keeps its original author dates, so it is judged as written.
LOCATION_SINCE='2026-09-29T16:20:00Z'

# Commits authored before this timestamp may use the legacy `Agent:` prefix.
# After it, `Author:` is required. The prefix rename (#325) shipped as guidance
# and was never a gate — 16 of the last 60 commits still said `Agent:`, because
# the regex accepted either prefix unconditionally. This makes the rename real
# while leaving branches already in flight mergeable: grandfathering is by
# AUTHOR date, so a commit written before the rule keeps its exemption however
# late it is rebased or merged.
PREFIX_SINCE='2026-09-29T21:55:00Z'

# The moment this rule became real. Keep in step with the commit that added it.
RULE_LANDED_AT='2026-09-26T21:51:04Z'
since="$RULE_LANDED_AT"
grandfather=1

check_file() {
  file=$1
  # A PR body is written at the moment the PR is opened, so there is no older
  # work to grandfather: the strict Author/location shape is the only one that
  # passes. This is also the shape every tool that commits for an agent has to
  # produce, which is why AUTHOR_IDENTITY and AGENT_IDENTITY both go through
  # here rather than only through check_commit.
  if grep -Eq "$author_pattern" "$file"; then
    return 0
  fi
  echo "Rejected. Add one trailer line, with a real thinking level and a location:" >&2
  echo "  Author: <model and version> (<thinking level>) <location>" >&2
  echo "Example: Author: Grok 4.7 (High) VM" >&2
  echo "  A model with no thinking levels should write (none). 'n/a' is rejected:" >&2
  echo "  it reads as 'nobody looked', not as an answer." >&2
  echo "Set AUTHOR_IDENTITY to that text (without the 'Author:' prefix) if a tool commits for you." >&2
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
  # A location-shape trailer satisfies the rule no matter when the commit was
  # authored (it carries everything the old shape has, plus location); the
  # cutoff only excuses a *missing* location on older work.
  if printf '%s\n' "$msg" | grep -Eq "$new_pattern"; then
    # The shape is right, but a commit written after the prefix rename must say
    # `Author:`. `Agent:` is a shape-valid spelling of a retired convention, so
    # without this second check the rename stays a suggestion.
    if [ -n "$authored" ] && [ ! "$authored" \< "$PREFIX_SINCE" ]; then
      printf '%s\n' "$msg" | grep -Eq '^Author: ' || {
        echo "Commit $sha uses the legacy 'Agent:' prefix." >&2
        echo "Renamed to 'Author:' (#325). Required for commits authored after $PREFIX_SINCE." >&2
        echo "Older commits keep 'Agent:' — the cutoff is by author date, so in-flight" >&2
        echo "work still lands. Amend the commit message, or set the trailer by hand." >&2
        return 1
      }
    fi
    return 0
  fi
  if [ -n "$authored" ] && [ "$authored" \< "$LOCATION_SINCE" ]; then
    printf '%s\n' "$msg" | grep -Eq "$pattern" && return 0
  fi
  echo "Commit $sha has no author identity." >&2
  echo "Required line: Author: <model and version> (<thinking level>) <location>" >&2
  echo "  (thinking level must be a word — (none) for a model that has none; n/a is rejected)" >&2
  echo "  (legacy Agent: accepted before $PREFIX_SINCE; legacy no-location shape accepted before $LOCATION_SINCE)" >&2
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
      --allow-empty) allow_empty=1; shift ;;
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
    # An empty range means the commits are ALREADY on the base, which is
    # genuinely nothing to judge — so exit 0, but only when the caller said the
    # range may legitimately be empty.
    #
    # `--allow-empty` is required. Without it an empty range silently passed,
    # and the one caller that could not tell an empty range from a broken one
    # was ci.yml on a post-merge run: a repository_dispatch has no `before`, the
    # fallback resolved to origin/main == HEAD, and every squash landed on main
    # unverified for author identity (2026-09-29). A gate that cannot tell
    # "nothing new" from "I looked at the wrong range" must not be allowed to
    # answer both with 0.
    if [ "$allow_empty" = "1" ]; then
      echo "check-agent-identity: no new commits in:$revs (allowed)"
      exit 0
    fi
    echo "check-agent-identity: refusing to pass an empty range in:$revs" >&2
    echo "  An empty range means the commits are already on the base, OR that" >&2
    echo "  the range resolved to nothing (e.g. a post-merge run with no 'before')." >&2
    echo "  Pass --allow-empty only when an empty range really is 'nothing to do'." >&2
    exit 1
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
echo "       check-agent-identity.sh --range [<rev> ...] [--since <iso8601>] [--no-grandfather] [--allow-empty]" >&2
exit 2
