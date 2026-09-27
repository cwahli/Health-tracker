#!/usr/bin/env bash
#
# VPS side of the phone screenshot bridge: pull the newest phone screenshot.
# This is one half of the bridge; the phone half is start-phone-shot-tunnel.sh
# (the reverse SSH tunnel) plus shot-server.mjs (the little /list.tsv + /file
# server the phone runs over its own screenshots directory).
#
# Usage:
#   pull_shot.sh                  # newest screenshot -> prints local path
#   pull_shot.sh --since 1758000  # everything newer than that unix timestamp
#   pull_shot.sh --index 2        # 3rd newest screenshot
#   pull_shot.sh --list           # just list what the phone has
#   pull_shot.sh --probe          # bridge health only: prints ok | auth | down
#   pull_shot.sh --json           # machine-readable output
#
# Environment:
#   SHOT_URL      bridge base url     (default: http://127.0.0.1:7777)
#   SHOT_DIR      download directory  (default: $HOME/shots)
#   SHOT_TIMEOUT  seconds             (default: 30)
#   SHOT_TOKEN    bearer token, sent as 'Authorization: Bearer ...' when set
#   SHOT_MAX_MB   refuse a payload larger than this MiB (default: 64)
#
# Cache:  $SHOT_DIR/shot-<stamp>.<ext>, indexed by phone-name + mtime in
# $SHOT_DIR/.index. One run holds $SHOT_DIR/.lock for its whole life.
#
# Exit codes:
#   0  ok                2  bridge/tunnel unreachable
#   3  no new shots      4  transfer failed, or the payload is not an image
#   5  phone rejected the token (401/403)
#   6  another pull_shot holds the cache lock

set -euo pipefail
umask 077

BASE="${SHOT_URL:-http://127.0.0.1:7777}"
DEST="${SHOT_DIR:-$HOME/shots}"
TIMEOUT="${SHOT_TIMEOUT:-30}"
TOKEN="${SHOT_TOKEN:-}"
MAX_MB="${SHOT_MAX_MB:-64}"
INDEX_OFFSET=0
SINCE=""
MODE="newest"
JSON=0
FORCE=0

die() { printf 'pull_shot: %s\n' "$1" >&2; exit "${2:-1}"; }

usage() {
  awk 'NR > 1 && /^#/ { sub(/^# ?/, ""); print; next } NR > 1 { exit }' "$0"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --since)   SINCE="${2:?--since needs a unix timestamp}"; MODE="since"; shift 2 ;;
    --index)   INDEX_OFFSET="${2:?--index needs a number}"; shift 2 ;;
    --list)    MODE="list"; shift ;;
    --probe)   MODE="probe"; shift ;;
    --json)    JSON=1; shift ;;
    --force)   FORCE=1; shift ;;
    --dest)    DEST="${2:?--dest needs a directory}"; shift 2 ;;
    --url)     BASE="${2:?--url needs a base url}"; shift 2 ;;
    --token)   TOKEN="${2:?--token needs a value}"; shift 2 ;;
    --timeout) TIMEOUT="${2:?--timeout needs seconds}"; shift 2 ;;
    --max-mb)  MAX_MB="${2:?--max-mb needs MiB}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *)         die "unknown option: $1 (try --help)" ;;
  esac
done

command -v curl >/dev/null 2>&1 || die "curl is required"
[[ "$MAX_MB" =~ ^[0-9]+$ ]] && (( MAX_MB > 0 )) || die "SHOT_MAX_MB must be a positive integer"
MAX_BYTES=$(( MAX_MB * 1024 * 1024 ))

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# http_get <url> <outfile>  -> prints the HTTP code; dies 2 on transport loss
# and 5 when the phone rejects the token, so a missing token never reads as
# "there are no screenshots".
http_get() {
  local url="$1" out="$2" code status
  local -a auth=()
  [[ -n "$TOKEN" ]] && auth=(-H "Authorization: Bearer $TOKEN")
  code="$(curl -sS --max-time "$TIMEOUT" --max-filesize "$MAX_BYTES" \
            ${auth[@]+"${auth[@]}"} -D "$TMP/hdr" -o "$out" -w '%{http_code}' "$url" 2>"$TMP/err")" || {
    status=$?
    case "$status" in
      7)  die "bridge unreachable at $BASE - is the phone tunnel up? (curl exit 7, run --probe)" 2 ;;
      28) die "bridge timed out after ${TIMEOUT}s at $BASE" 2 ;;
      63) die "payload exceeded the ${MAX_MB} MiB cap (--max-mb / SHOT_MAX_MB)" 4 ;;
      *)  cat "$TMP/err" >&2; die "request to $url failed (curl exit $status)" 2 ;;
    esac
  }
  case "$code" in
    401|403) die "phone rejected the token (HTTP $code) - set SHOT_TOKEN/--token to what shot-server.mjs expects" 5 ;;
  esac
  printf '%s' "$code"
}

hdr_value() {
  awk -v key="$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')" '
    tolower($1) == key ":" { gsub(/\r/, "", $2); print $2 }
  ' "$TMP/hdr" | tail -1
}

stamp_of() {
  date -d "@$1" +%Y%m%d-%H%M%S 2>/dev/null || date +%Y%m%d-%H%M%S
}

# looks_like_image <file> -- a 200 with Content-Type: image/png is not proof:
# a tunnel that half-died can serve an error page or a truncated body, and both
# used to land in the cache and stay there forever because the cache is keyed
# on the phone's mtime and never rechecked the bytes.
looks_like_image() {
  local magic
  magic="$(od -An -tx1 -N4 "$1" 2>/dev/null | tr -d ' \n')" || return 1
  case "$magic" in
    89504e47|ffd8ff*|47494638|52494646|424d*) return 0 ;;
    *) return 1 ;;
  esac
}


# The cache key is phone name + mtime, not mtime alone. Two screenshots the
# phone made of the same frame (a " (1)" copy of one capture) can share an
# mtime, and an mtime-only key then serves one file for two distinct shots.
index_lookup() { # <name> <mtime> -> cached path, or nothing
  [[ -s "$DEST/.index" ]] || return 1
  awk -F'\t' -v n="$1" -v m="$2" '
    $1 == m && $2 == n && $3 != "" { p = $3 }
    END { if (p != "") print p }
  ' "$DEST/.index"
}

# Replace-by-key, whole-file, atomic mv. A plain append would leave a stale row
# for a refetched shot: two rows for one key, and which one won the lookup then
# depended on file order.
index_add() { # <name> <mtime> <path>
  local tmp
  tmp="$(mktemp "$DEST/.index.XXXXXX")"
  { if [[ -s "$DEST/.index" ]]; then
      awk -F'\t' -v m="$2" -v n="$1" '!($1 == m && $2 == n)' "$DEST/.index"
    fi
    printf '%s\t%s\t%s\n' "$2" "$1" "$3"; } > "$tmp"
  mv "$tmp" "$DEST/.index"
  chmod 600 "$DEST/.index"
}

# One download per cache entry, and the row is written only once the bytes are
# on disk *and* verified. The old order was mv-then-index with nothing holding
# the two together, so two agents asking for the same fresh screenshot both
# missed the lookup and produced shot-X.png plus a byte-identical shot-X-2.png.
acquire_lock() {
  exec 8>"$DEST/.lock" || die "cannot open $DEST/.lock" 1
  # Wait, do not fail: a caller that arrived while another pull was running
  # wants the file, not an error. Bounded so a wedged pull cannot wedge the
  # next one forever. (No trap here -- EXIT already cleans $TMP, and a second
  # trap would replace it and leak the temp dir.)
  flock -w "${SHOT_LOCK_WAIT:-60}" 8 || die "another pull_shot still holds the cache lock after ${SHOT_LOCK_WAIT:-60}s" 6
}

http_code() { # like http_get but never dies on 401/403, so --probe can tell
  local url="$1" out="$2" code status
  local -a auth=()
  [[ -n "$TOKEN" ]] && auth=(-H "Authorization: Bearer $TOKEN")
  code="$(curl -sS --max-time "$TIMEOUT" ${auth[@]+"${auth[@]}"} \
            -o "$out" -w '%{http_code}' "$url" 2>/dev/null)" || status=$?
  printf '%s' "${code:-000}"
}

fetch_tsv() {
  local query="?limit=200" code
  [[ -n "$SINCE" ]] && query="?since=$SINCE&limit=200"
  code="$(http_get "$BASE/list.tsv$query" "$TMP/list.tsv")"
  if [[ "$code" == "404" ]]; then
    [[ "$MODE" == "list" ]] && return 0
    die "phone has no screenshots newer than ${SINCE:-0}" 3
  fi
  [[ "$code" == "200" ]] || die "bridge returned HTTP $code for /list.tsv" 4
  [[ -s "$TMP/list.tsv" ]] || die "bridge returned an empty listing" 3
}

download() {
  local name="$1" mtime="$2" stamp="$3"
  [[ -n "$stamp" ]] || stamp="$(stamp_of "$mtime")"
  local ext="${name##*.}"
  [[ "$ext" == "$name" ]] && ext="png"
  ext="${ext,,}"
  ext="${ext/jpeg/jpg}"

  # Look the entry up even with --force: --force means "refetch", not "lose
  # track of where this shot already lives", and the answer decides which path
  # the new bytes land on.
  local existing
  existing="$(index_lookup "$name" "$mtime" || true)"
  if (( FORCE == 0 )); then
    if [[ -n "$existing" && -s "$existing" ]] && looks_like_image "$existing"; then
      printf '%s\n' "$existing"
      printf 'pull_shot: already pulled %s (use --force to refetch)\n' "$name" >&2
      return 0
    elif [[ -n "$existing" ]]; then
      printf 'pull_shot: cached %s is missing or is not an image, refetching\n' "$existing" >&2
    fi
  fi

  local encoded="${name// /%20}"
  local code
  code="$(http_get "$BASE/file/$encoded" "$TMP/payload")"
  [[ "$code" == "200" ]] || die "bridge returned HTTP $code for $name" 4
  [[ -s "$TMP/payload" ]] || die "empty payload for $name" 4

  local ctype
  ctype="$(hdr_value Content-Type)"
  [[ "$ctype" == image/* ]] || die "unexpected content type '${ctype:-none}' for $name" 4
  looks_like_image "$TMP/payload" || die "body of $name is not a recognised image (magic mismatch)" 4

  # A refetch lands on the path the index already points at. Writing a fresh
  # name instead would leave the unusable shot-X.png sitting next to the new
  # shot-X-2.png -- the duplicate pile this cache exists to prevent. The suffix
  # loop is only for a genuinely different shot that shares a timestamp.
  local out n=2
  if [[ -n "$existing" ]]; then
    out="$existing"
  else
    out="$DEST/shot-$stamp.$ext"
    while [[ -e "$out" ]]; do
      out="$DEST/shot-$stamp-$n.$ext"
      n=$((n + 1))
    done
  fi
  mv "$TMP/payload" "$out"
  chmod 600 "$out"
  index_add "$name" "$mtime" "$out"
  printf '%s\n' "$out"
}

mkdir -p "$DEST"
chmod 700 "$DEST" 2>/dev/null || true

if [[ "$MODE" == "probe" ]]; then
  pcode="$(http_code "$BASE/list.tsv?limit=1" "$TMP/probe")"
  case "$pcode" in
    200|404) printf 'ok %s\n' "$BASE"; exit 0 ;;
    401|403) printf 'auth %s (HTTP %s)\n' "$BASE" "$pcode"; exit 5 ;;
    000)     printf 'down %s (no listener - is the phone tunnel up?)\n' "$BASE"; exit 2 ;;
    *)       printf 'down %s (HTTP %s)\n' "$BASE" "$pcode"; exit 4 ;;
  esac
fi

acquire_lock

if [[ "$MODE" == "list" ]]; then
  fetch_tsv
  cat "$TMP/list.tsv"
  exit 0
fi

fetch_tsv

selected=()
if [[ "$MODE" == "since" ]]; then
  while IFS=$'\t' read -r name mtime stamp; do
    if [[ -n "$name" ]]; then selected+=("$name" "$mtime" "$stamp"); fi
  done <"$TMP/list.tsv"
else
  idx=0
  while IFS=$'\t' read -r name mtime stamp; do
    [[ -n "$name" ]] || continue
    if (( idx == INDEX_OFFSET )); then
      selected+=("$name" "$mtime" "$stamp")
      break
    fi
    idx=$((idx + 1))
  done <"$TMP/list.tsv"
fi

if (( ${#selected[@]} == 0 )); then
  if [[ "$MODE" == "since" ]]; then die "no new screenshots since ${SINCE:-0}" 3; fi
  die "no screenshots on the phone" 3
fi

paths=()
for (( i = 0; i < ${#selected[@]}; i += 3 )); do
  paths+=("$(download "${selected[i]}" "${selected[i + 1]}" "${selected[i + 2]}")")
done

if (( JSON )); then
  printf '{"paths": ['
  for i in "${!paths[@]}"; do
    (( i )) && printf ', '
    printf '"%s"' "${paths[i]}"
  done
  printf '], "source": "%s"}\n' "$BASE"
else
  printf '%s\n' "${paths[@]}"
fi
