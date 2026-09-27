#!/usr/bin/env bash
# Verification for the screenshot bridge: runs the real pull_shot.sh against a
# real shot-server.mjs over a loopback port, in a throwaway cache. No phone, no
# tunnel, no network needed, so CI can run it.
#
#   bash scripts/mobile/test-pull-shot.sh          # -> "ok (N checks)" or fails
#
# It deliberately covers the three things that broke in the field: two pulls
# racing into one duplicate file, a token the client forgets to send reading as
# "no screenshots", and a cached body that is not actually an image.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
PULL="$HERE/pull_shot.sh"
SERVER="$HERE/shot-server.mjs"
TOKEN='test-token-4f3d'
pass=0 fail=0

ok()   { pass=$((pass + 1)); printf 'ok   %s\n' "$1"; }
bad()  { fail=$((fail + 1)); printf 'FAIL %s\n' "$1"; }
chk()  { if [[ "$2" == "$3" ]]; then ok "$1"; else bad "$1 (want '$3' got '$2')"; fi; }

WORK="$(mktemp -d)"
CACHE="$WORK/cache"
PHONE="$WORK/phone"
mkdir -p "$PHONE"
cleanup() { [[ -n "${SRV:-}" ]] && kill "$SRV" 2>/dev/null; rm -rf "$WORK"; }
trap cleanup EXIT

# Fixture mtimes, and the cache names derived from them the same way the client
# derives them (the server sends a local-time stamp column). Hard-coded names
# here once asserted `shot-20260927-*` while the fixtures sat at a 2027 epoch.
E0=1790400000; E1=1790400300; E2=1790400600
st() { date -d "@$1" +%Y%m%d-%H%M%S; }
NEWEST="shot-$(st "$E2").png"
SECOND="shot-$(st "$E1").png"

# Three real PNGs with distinct mtimes (a 1x1 PNG, so the magic-byte check has
# genuine PNG bytes to accept rather than a stub).
EPOCH0="$E0" node - "$PHONE" <<'NODE'
const fs = require('fs'), path = require('path');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const dir = process.argv[2];
const base = Number(process.env.EPOCH0);
const names = ['Screenshot_20260927-100000.png', 'Screenshot_20260927-100500.png', 'Screenshot_20260927-101000.png'];
names.forEach((n, i) => {
  const p = path.join(dir, n);
  fs.writeFileSync(p, png);
  const t = base + i * 300;
  fs.utimesSync(p, new Date(t * 1000), new Date(t * 1000));
});
NODE

start_server() { # <token-or-empty> -> sets URL
  [[ -n "${SRV:-}" ]] && { kill "$SRV" 2>/dev/null; wait "$SRV" 2>/dev/null; }
  local log="$WORK/srv${1:-anon}.log"
  if [[ -n "$1" ]]; then
    SHOT_TOKEN="$1" node "$SERVER" --dir="$PHONE" --port=0 >"$log" 2>&1 &
  else
    node "$SERVER" --dir="$PHONE" --port=0 --allow-anonymous >"$log" 2>&1 &
  fi
  SRV=$!
  for _ in $(seq 1 60); do
    if grep -q 'shot-server:' "$log" 2>/dev/null; then break; fi
    sleep 0.2
  done
  URL="$(grep -o 'http://127.0.0.1:[0-9]*' "$log" | head -1)"
  URL="${URL:-http://127.0.0.1:1}"
}

P() { SHOT_DIR="$CACHE" SHOT_URL="$URL" bash "$PULL" "$@"; }
count_files() { find "$CACHE" -maxdepth 1 -name 'shot-*.png' | wc -l | tr -d ' '; }

start_server ""

# --- health ------------------------------------------------------------------
P --probe >"$WORK/probe.out" 2>&1; chk 'probe exits 0 on a live bridge' "$?" '0'
chk 'probe says ok' "$(cat "$WORK/probe.out")" "ok $URL"

# --- the happy path ----------------------------------------------------------
out="$(P --json 2>/dev/null)"; chk 'newest pull exits 0' "$?" '0'
chk '--json names the newest shot' \
  "$(node -e 'console.log(JSON.parse(process.argv[1]).paths[0].replace(/^.*\//,""))' "$out")" \
  "$NEWEST"
newest="$CACHE/$NEWEST"
chk 'cache file is non-empty' "$([[ -s "$newest" ]] && echo y)" 'y'
chk 'cached bytes really are PNG' "$(od -An -tx1 -N4 "$newest" | tr -d ' \n')" '89504e47'

before="$(count_files)"
P >/dev/null 2>&1
chk 'a repeat pull adds no second file' "$(count_files)" "$before"

# --- THE regression ----------------------------------------------------------
# Two agents ask for the same fresh screenshot at the same moment. The old
# order (mv, then index) let both miss the lookup, so this used to leave
# shot-X.png and a byte-identical shot-X-2.png -- exactly the pair sitting in
# $HOME/shots/.index on the host.
rm -f "$CACHE/.index"; mv "$newest" "$WORK/away.png"; before="$(count_files)"
( P >/dev/null 2>&1 & P >/dev/null 2>&1 & wait )
chk 'concurrent pulls make exactly one file' "$(count_files)" "$((before + 1))"
chk 'no -2 collision file' "$(find "$CACHE" -name 'shot-*-2.png' | wc -l | tr -d ' ')" '0'
chk 'one index row for that shot' "$(grep -c 'Screenshot_20260927-101000.png' "$CACHE/.index")" '1'

# A cached body that stopped being an image (truncated download, a tunnel that
# half-died and served junk) must be refetched, not trusted forever.
printf 'x' > "$newest"
P >/dev/null 2>&1
chk 'corrupt cache entry is refetched' "$(od -An -tx1 -N4 "$newest" | tr -d ' \n')" '89504e47'

# --force means "refetch", not "start a second copy of this shot".
before="$(count_files)"
P --force >/dev/null 2>&1
chk '--force adds no second file' "$(count_files)" "$before"
chk '--force still has one index row' \
  "$(awk -F'\t' -v p="$newest" '$3 == p' "$CACHE/.index" | wc -l | tr -d ' ')" '1'

# --- selection ---------------------------------------------------------------
chk '--index 1 takes the 2nd newest' "$(basename "$(P --index 1)")" "$SECOND"
chk '--list shows all three' "$(P --list | wc -l | tr -d ' ')" '3'
P --since 4000000000 >/dev/null 2>&1; chk '--since past the end exits 3' "$?" '3'

# --- a body that is not an image, served as image/png ------------------------
POISON="$PHONE/Screenshot_20260927-110000.png"
printf 'print("hi")' > "$POISON"
touch -d "@$(( E2 + 300 ))" "$POISON"
P >/dev/null 2>&1; chk 'non-image body rejected with exit 4' "$?" '4'
chk 'rejected body never entered the cache' "$(find "$CACHE" -name '*110000*' | wc -l | tr -d ' ')" '0'
# Take it off the phone again: it is still the newest shot, and leaving it there
# made the auth section below download it, correctly exit 4, and look like a
# token failure.
rm -f "$POISON"

# --- auth --------------------------------------------------------------------
# The bug this prevents: a 401 used to fall through to "the phone has no
# screenshots", so a missing token looked like an empty phone.
start_server "$TOKEN"
P --probe >/dev/null 2>&1; chk 'probe exits 5 with no token' "$?" '5'
chk 'probe says auth, not down' "$(P --probe 2>&1 | cut -d' ' -f1)" 'auth'
P >/dev/null 2>&1; chk 'pull exits 5 with no token' "$?" '5'
out="$(P --token "$TOKEN" --json 2>/dev/null)"
chk 'the token unlocks the bridge' "$(node -e 'console.log(JSON.parse(process.argv[1]).paths.length)' "$out")" '1'

# --- containment -------------------------------------------------------------
# Names arrive percent-decoded from a phone directory that is not ours to police,
# so the worst case must be "404", never "here is ~/.ssh".
trav() { curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $TOKEN" --path-as-is "$URL/$1"; }
chk 'encoded traversal is a 404' "$(trav 'file/%2e%2e%2f%2e%2e%2f%2e%2e%2fetc%2Fpasswd')" '404'
chk 'raw traversal is a 404' "$(trav 'file/../../../etc/passwd')" '404'
chk 'a non-image name is a 404' "$(trav 'file/id_ed25519')" '404'
chk 'no route is a 404' "$(trav 'nope')" '404'

# --- secrecy of the cache ----------------------------------------------------
chk 'cache dir is 700' "$(stat -c '%a' "$CACHE")" '700'
chk 'index file is 600' "$(stat -c '%a' "$CACHE/.index")" '600'

printf '\n%s\n' "$([[ "$fail" -eq 0 ]] && echo "ok ($pass checks)" || echo "$fail FAILED / $pass passed")"
exit "$(( fail > 0 ? 1 : 0 ))"
