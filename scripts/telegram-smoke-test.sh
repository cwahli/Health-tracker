#!/usr/bin/env bash
# scripts/telegram-smoke-test.sh
#
# Grounded Telegram delivery checks. Prints PASS/FAIL per case.
# Does not claim Instant View (needs public URL + template).
#
# Usage:
#   bash scripts/telegram-smoke-test.sh [--profile=orchestrator] [--photo=/abs/x.png] [--doc=/abs/x.html]
#   bash scripts/telegram-smoke-test.sh --profile=qa_meal --url=https://health-tracking.duckdns.org/nutrient-table --marker=Baked

set -uo pipefail

PROFILE="orchestrator"
PHOTO=""
DOC=""
URL=""
MARKER=""
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SEND="${SCRIPT_DIR}/telegram-send.sh"
PASS=0
FAIL=0

for arg in "$@"; do
  case $arg in
    --profile=*) PROFILE="${arg#*=}" ;;
    --photo=*) PHOTO="${arg#*=}" ;;
    --doc=*) DOC="${arg#*=}" ;;
    --url=*) URL="${arg#*=}" ;;
    --marker=*) MARKER="${arg#*=}" ;;
    --help|-h)
      sed -n '2,10p' "$0"
      exit 0
      ;;
  esac
done

ok()   { echo "PASS: $1"; PASS=$((PASS+1)); }
bad()  { echo "FAIL: $1"; FAIL=$((FAIL+1)); }
note() { echo "INFO: $1"; }

if [ ! -x "$SEND" ] && [ ! -f "$SEND" ]; then
  bad "telegram-send.sh missing at $SEND"
  echo "RESULT: ${PASS} pass, ${FAIL} fail"
  exit 1
fi

note "profile=${PROFILE}"

# --- 1) typing action ---
OUT=$(bash "$SEND" --profile="$PROFILE" --action=typing 2>&1)
if echo "$OUT" | grep -q "Action 'typing' sent"; then
  ok "sendChatAction typing"
else
  bad "sendChatAction typing :: $OUT"
fi

# --- 2) plain text ---
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
OUT=$(bash "$SEND" --profile="$PROFILE" --text="TG-SMOKE plain ${STAMP}" 2>&1)
if echo "$OUT" | grep -q "Message delivered"; then
  if echo "$OUT" | grep -qi "plain text fallback"; then
    bad "plain text used Markdown fallback (parse fragile) :: $OUT"
  else
    ok "sendMessage text"
  fi
else
  bad "sendMessage text :: $OUT"
fi

# --- 3) markdown (bold) ---
OUT=$(bash "$SEND" --profile="$PROFILE" --text="TG-SMOKE *bold-ok* ${STAMP}" 2>&1)
if echo "$OUT" | grep -q "Message delivered" && ! echo "$OUT" | grep -qi "plain text fallback"; then
  ok "sendMessage Markdown"
else
  bad "sendMessage Markdown :: $OUT"
fi

# --- 4) photo ---
if [ -n "$PHOTO" ]; then
  if [ ! -s "$PHOTO" ]; then
    bad "photo missing or empty: $PHOTO"
  else
    OUT=$(bash "$SEND" --profile="$PROFILE" --photo="$PHOTO" --caption="TG-SMOKE photo ${STAMP}" 2>&1)
    if echo "$OUT" | grep -q "Photo delivered"; then
      ok "sendPhoto"
    else
      bad "sendPhoto :: $OUT"
    fi
  fi
else
  note "skip photo (pass --photo=/abs/file.png)"
fi

# --- 5) document / HTML via raw API is bot MEDIA: path; here validate file only + optional sendDocument ---
if [ -n "$DOC" ]; then
  if [ ! -s "$DOC" ]; then
    bad "doc missing or empty: $DOC"
  else
    note "doc exists: $DOC ($(wc -c <"$DOC") bytes)."
    note "Deliver in chat with MEDIA:${DOC} on its own line (bot sendDocument)."
    note "Telegram will NOT Instant-View a raw .html upload — download or host URL."
    ok "document file ready for MEDIA:"
  fi
else
  note "skip doc (pass --doc=/abs/file.html)"
fi

# --- 6) public URL body check (not just HTTP status) ---
if [ -n "$URL" ]; then
  if [ -z "$MARKER" ]; then
    bad "URL given without --marker=<unique string from page>"
  else
    BODY=$(curl -sS --max-time 10 "$URL" 2>&1 || true)
    if [ -z "$BODY" ]; then
      bad "URL empty/unreachable: $URL"
    elif echo "$BODY" | grep -Fq "$MARKER"; then
      ok "URL body contains marker '${MARKER}'"
      if echo "$BODY" | grep -Fq "<title>Biomarker and Nutrient Tracker</title>"; then
        note "URL also matches SPA title — confirm marker is not generic SPA text"
      fi
    elif echo "$BODY" | grep -Fq "<title>Biomarker and Nutrient Tracker</title>"; then
      bad "URL returned SPA shell, not target page: $URL"
    else
      bad "URL body missing marker '${MARKER}': $URL"
    fi
    case "$URL" in
      http://127.*|http://localhost*|http://0.0.0.0*)
        bad "URL is localhost — unusable from phone Telegram / Instant View"
        ;;
    esac
    case "$URL" in
      https://*)
        note "HTTPS OK. Instant View still needs IV template or t.me/iv rhash — not proven by this test."
        ;;
      http://*)
        note "Non-HTTPS URL — Instant View / mixed content may fail."
        ;;
    esac
  fi
else
  note "skip URL (pass --url=https://... --marker=UniqueString)"
fi

echo "RESULT: ${PASS} pass, ${FAIL} fail"
if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
exit 0
