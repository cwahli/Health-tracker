#!/usr/bin/env bash
# Live proof for the TUI gateway (plan/TUI_IMPLEMENTATION.md step 2, rows S3/S4).
#
# Everything here goes over real TLS to the public hostname. A unit test proves
# the HMAC maths; this proves the deployed path, which is the thing a user hits.
#
# The initData is signed with the real bot token read from the gateway's own
# env file. That is the same secret the gateway checks, so a PASS here means the
# deployed gateway accepts what Telegram would send and nothing else.
set -uo pipefail

BASE="${TUI_BASE:-https://tui.health-tracking.duckdns.org}"
ENV_FILE="${TUI_GATEWAY_ENV:-/home/ubuntu/.config/bot-host/tui-gateway.env}"
BOT_ID="${TUI_BOT_ID:-vm}"
CHAT_ID="${TUI_CHAT_ID:-6218257274}"

# The env key is the bot id UPPER-CASED with punctuation folded to "_", which is
# what the gateway's tokenFor() does. Building it any other way finds nothing
# and the proof exits as "no token" instead of testing the auth.
TOKEN_KEY="TUI_BOT_TOKEN_$(printf '%s' "$BOT_ID" | tr '[:lower:]-' '[:upper:]_')"
# Strip whitespace/CR: a padded line in the env file signs a different HMAC and
# every case fails as "hash mismatch". The gateway trims on read; so must we.
TOKEN=$(grep -E "^${TOKEN_KEY}=" "$ENV_FILE" | cut -d= -f2- | tr -d '[:space:]')
if [ -z "$TOKEN" ]; then echo "no ${TOKEN_KEY} in $ENV_FILE — cannot sign"; exit 2; fi

sign() { # sign <auth_date_epoch> [user_id] -> initData query string
  local auth_date="$1" user_id="${2:-$CHAT_ID}" dcs hmac secret
  # Telegram sorts the DECODED pairs by key: auth_date, query_id, user.
  dcs="auth_date=${auth_date}"$'\n'"query_id=AAFliveproof"$'\n'"user={\"id\":${user_id},\"first_name\":\"Cwah\"}"
  # secret_key = HMAC_SHA256(key="WebAppData", data=bot_token). openssl's
  # -hmac argument is the KEY, so the token is the piped DATA, not the flag.
  # Reversed, the signature is wrong and every case fails as "hash mismatch",
  # including the ones that are supposed to fail for being stale.
  secret=$(printf '%s' "$TOKEN" | openssl dgst -sha256 -hmac 'WebAppData' -hex 2>/dev/null | sed 's/.*= //')
  hmac=$(printf '%s' "$dcs" | openssl dgst -sha256 -mac HMAC -macopt "hexkey:${secret}" -hex | sed 's/.*= //')
  printf 'auth_date=%s&query_id=AAFliveproof&user=%%7B%%22id%%22%%3A%s%%2C%%22first_name%%22%%3A%%22Cwah%%22%%7D&hash=%s' \
    "$auth_date" "$user_id" "$hmac"
}

# initData is itself a query string. Embedded in the gateway's URL it must be
# percent-encoded, or its own "&" separators are read as the OUTER query's and
# the hash arrives as a separate parameter — which the gateway correctly
# refuses as "no hash in initData".
enc() { printf '%s' "$1" | sed -e 's/&/%26/g' -e 's/=/%3D/g'; }

hit() { # hit <label> <expect_status> <query>
  local label="$1" expect="$2" query="$3" out code body
  out=$(curl -s -w '\n%{http_code}' --max-time 15 "${BASE}/auth?bot=${BOT_ID}&${query}")
  code=$(printf '%s' "$out" | tail -n1)
  body=$(printf '%s' "$out" | sed '$d')
  # The verdict goes to stderr and only the body to stdout, so a caller can
  # capture the body with $(...) without swallowing the PASS/FAIL line — which
  # is how the cross-chat assertion below printed nothing at all.
  if [ "$code" = "$expect" ]; then
    printf '  PASS  %-46s HTTP %s\n' "$label" "$code" >&2
  else
    printf '  FAIL  %-46s HTTP %s (expected %s) %s\n' "$label" "$code" "$expect" "$body" >&2
  fi
  printf '%s' "$body"
}

echo "assert-tui-gateway-live: $BASE"
now=$(date +%s)

echo
echo "--- admitted"
VALID=$(hit "valid initData, this bot" 200 "initData=$(enc "$(sign "$now")")")
printf '        body: %s\n' "$(printf '%s' "$VALID" | head -c 160)"

TOKEN_OUT=$(printf '%s' "$VALID" | grep -o '"token":"[^"]*"' | cut -d'"' -f4)
if [ -n "$TOKEN_OUT" ]; then
  printf '  PASS  %-46s\n' "a session token was issued"
else
  printf '  FAIL  %-46s\n' "a session token was issued"
fi

# Another real user's valid initData is ADMITTED — 200 is correct. It sat under
# "refused" before, so a green run printed PASS under a heading that said the
# opposite. The cross-chat claim is asserted on the binding below, not here.
OTHER=$(hit "another user's valid initData is admitted" 200 "initData=$(enc "$(sign "$now" 9999999999)")")
# chat is a STRING in the body, so the quote after the colon has to be optional.
OTHER_CHAT=$(printf '%s' "$OTHER" | grep -o '"chat":"\{0,1\}-*[0-9]*' | tr -dc '0-9-')
if [ -n "$OTHER_CHAT" ] && [ "$OTHER_CHAT" != "$CHAT_ID" ]; then
  printf '  PASS  %-46s the token is bound to the caller, not to us\n' "cross-chat binding"
else
  printf '  FAIL  %-46s got chat=%s expected !=%s\n' "cross-chat binding" "${OTHER_CHAT:-none}" "$CHAT_ID"
fi

echo
echo "--- refused"
hit "forged hash" 401 "initData=auth_date=${now}%26user%3D%7B%22id%22%3A1%7D%26hash=deadbeef"
hit "an hour-old initData (replay)" 401 "initData=$(enc "$(sign $((now - 3600)))")"
hit "auth_date ten minutes ahead" 401 "initData=$(enc "$(sign $((now + 600)))")"
hit "no initData at all" 401 "initData="
hit "another bot id with no token" 401 "initData=x&bot=nosuchbot"

echo
echo "--- the terminal itself"
if [ -n "$TOKEN_OUT" ]; then
  code=$(curl -s -o /tmp/tui-body.html -w '%{http_code}' --max-time 15 \
    -H "Authorization: Bearer ${TOKEN_OUT}" "${BASE}/tty/")
  if [ "$code" = "200" ]; then
    printf '  PASS  %-46s HTTP %s\n' "ttyd reached with a session token" "$code"
    printf '        bytes read back: %s\n' "$(head -c 60 /tmp/tui-body.html | tr -d '\n')"
  else
    printf '  FAIL  %-46s HTTP %s\n' "ttyd reached with a session token" "$code"
  fi
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "${BASE}/tty/")
  [ "$code" = "401" ] \
    && printf '  PASS  %-46s HTTP %s\n' "ttyd refused without a token" "$code" \
    || printf '  FAIL  %-46s HTTP %s\n' "ttyd refused without a token" "$code"
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 \
    -H "Authorization: Bearer ${TOKEN_OUT}x" "${BASE}/tty/")
  [ "$code" = "401" ] \
    && printf '  PASS  %-46s HTTP %s\n' "ttyd refused a tampered token" "$code" \
    || printf '  FAIL  %-46s HTTP %s\n' "ttyd refused a tampered token" "$code"
fi

echo
echo "--- the websocket upgrade itself (the review was right that nothing proved this)"
TOKEN_JAR=$(mktemp)
FRESH_RAW=$(sign "$(date +%s)")
FRESH_ENC=$(enc "$FRESH_RAW")
curl -s -c "$TOKEN_JAR" -o /dev/null --max-time 15 "${BASE}/?bot=${BOT_ID}&initData=${FRESH_ENC}"
ws_code=$(curl -s --http1.1 -o /dev/null -w '%{http_code}' --max-time 10 -b "$TOKEN_JAR" \
  -H 'Connection: Upgrade' -H 'Upgrade: websocket' -H 'Sec-WebSocket-Version: 13' \
  -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' -H 'Sec-WebSocket-Protocol: tty' \
  -H "Origin: ${BASE}" "${BASE}/tty/ws" 2>/dev/null)
[ "$ws_code" = "101" ] \
  && printf '  PASS  %-46s HTTP %s\n' "the socket upgrades with a cookie" "$ws_code" \
  || printf '  FAIL  %-46s HTTP %s (expected 101)\n' "the socket upgrades with a cookie" "$ws_code"
ws_none=$(curl -s --http1.1 -o /dev/null -w '%{http_code}' --max-time 10 \
  -H 'Connection: Upgrade' -H 'Upgrade: websocket' -H 'Sec-WebSocket-Version: 13' \
  -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' -H 'Sec-WebSocket-Protocol: tty' \
  "${BASE}/tty/ws" 2>/dev/null)
[ "$ws_none" = "401" ] \
  && printf '  PASS  %-46s HTTP %s\n' "the socket is refused without one" "$ws_none" \
  || printf '  FAIL  %-46s HTTP %s (expected 401)\n' "the socket is refused without one" "$ws_none"
rm -f "$TOKEN_JAR"

echo
echo "--- the website hostname must not serve this"
code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "https://health-tracking.duckdns.org/health")
[ "$code" = "200" ] && printf '  PASS  %-46s HTTP %s (the site, not the gateway)\n' "site /health is the website" "$code" \
                    || printf '  FAIL  %-46s HTTP %s\n' "site /health is the website" "$code"
