#!/usr/bin/env bash
# scripts/telegram-send.sh
#
# Sends messages or photos with captions to Telegram chats and forum topics.
# Uses TELEGRAM_BOT_TOKEN and CHAT_ID from ~/.hermes/.env or environment variables.
#
# Usage:
#   ./scripts/telegram-send.sh --text="Test message" [--thread-id=123]
#   ./scripts/telegram-send.sh --photo="/path/to/img.png" --caption="Bug screenshot" [--thread-id=123]

set -e

TEXT=""
PHOTO=""
CAPTION=""
THREAD_ID=""
CHAT_ID=""
PROFILE=""
CLI_TOKEN=""

for arg in "$@"; do
  case $arg in
    --text=*)
      TEXT="${arg#*=}"
      shift
      ;;
    --photo=*)
      PHOTO="${arg#*=}"
      shift
      ;;
    --caption=*)
      CAPTION="${arg#*=}"
      shift
      ;;
    --thread-id=*)
      THREAD_ID="${arg#*=}"
      shift
      ;;
    --chat-id=*)
      CHAT_ID="${arg#*=}"
      shift
      ;;
    --profile=*)
      PROFILE="${arg#*=}"
      shift
      ;;
    --token=*)
      CLI_TOKEN="${arg#*=}"
      shift
      ;;
  esac
done

# Profile precedence: CLI flag -> HERMES_PROFILE env var
TARGET_PROFILE="${PROFILE:-${HERMES_PROFILE:-}}"

# Resolve Telegram Bot Token
if [ -n "$CLI_TOKEN" ]; then
  TELEGRAM_BOT_TOKEN="$CLI_TOKEN"
fi

if [ -z "$TELEGRAM_BOT_TOKEN" ]; then
  # 1. Check targeted profile .env if specified
  if [ -n "$TARGET_PROFILE" ] && [ -f "$HOME/.hermes/profiles/${TARGET_PROFILE}/.env" ]; then
    TOKEN=$(grep -E '^TELEGRAM_BOT_TOKEN=' "$HOME/.hermes/profiles/${TARGET_PROFILE}/.env" 2>/dev/null | head -n1 | cut -d '=' -f2- | tr -d '"' | tr -d "'" || true)
    if [ -n "$TOKEN" ]; then
      TELEGRAM_BOT_TOKEN="$TOKEN"
    fi
  fi

  # 2. Check global ~/.hermes/.env
  if [ -z "$TELEGRAM_BOT_TOKEN" ] && [ -f "$HOME/.hermes/.env" ]; then
    if [ -n "$TARGET_PROFILE" ]; then
      echo "[Telegram Send] ⚠️ WARNING: Profile '${TARGET_PROFILE}' has NO TELEGRAM_BOT_TOKEN in ~/.hermes/profiles/${TARGET_PROFILE}/.env! Falling back to global ~/.hermes/.env (@Health-tracker-bot)." >&2
    fi
    TOKEN=$(grep -E '^TELEGRAM_BOT_TOKEN=' "$HOME/.hermes/.env" 2>/dev/null | head -n1 | cut -d '=' -f2- | tr -d '"' | tr -d "'" || true)
    if [ -n "$TOKEN" ]; then
      TELEGRAM_BOT_TOKEN="$TOKEN"
    fi
  fi

  # 3. Fallback: search profile directories
  if [ -z "$TELEGRAM_BOT_TOKEN" ]; then
    for env_file in "$HOME/.hermes/profiles/"*"/".env; do
      if [ -f "$env_file" ]; then
        TOKEN=$(grep -E '^TELEGRAM_BOT_TOKEN=' "$env_file" 2>/dev/null | head -n1 | cut -d '=' -f2- | tr -d '"' | tr -d "'" || true)
        if [ -n "$TOKEN" ]; then
          TELEGRAM_BOT_TOKEN="$TOKEN"
          break
        fi
      fi
    done
  fi
fi

# Resolve Telegram Chat ID
if [ -z "$CHAT_ID" ]; then
  # 1. Check targeted profile .env
  if [ -n "$TARGET_PROFILE" ] && [ -f "$HOME/.hermes/profiles/${TARGET_PROFILE}/.env" ]; then
    CID=$(grep -E '^(TELEGRAM_CHAT_ID|TELEGRAM_USER_ID|TELEGRAM_ALLOWED_USERS)=' "$HOME/.hermes/profiles/${TARGET_PROFILE}/.env" 2>/dev/null | head -n1 | cut -d '=' -f2- | tr -d '"' | tr -d "'" | cut -d ',' -f1 || true)
    if [ -n "$CID" ]; then
      CHAT_ID="$CID"
    fi
  fi

  # 2. Check global ~/.hermes/.env or environment
  if [ -z "$CHAT_ID" ]; then
    CHAT_ID="${TELEGRAM_CHAT_ID:-}"
  fi

  if [ -z "$CHAT_ID" ] && [ -f "$HOME/.hermes/.env" ]; then
    CID=$(grep -E '^(TELEGRAM_CHAT_ID|TELEGRAM_USER_ID|TELEGRAM_ALLOWED_USERS)=' "$HOME/.hermes/.env" 2>/dev/null | head -n1 | cut -d '=' -f2- | tr -d '"' | tr -d "'" | cut -d ',' -f1 || true)
    if [ -n "$CID" ]; then
      CHAT_ID="$CID"
    fi
  fi

  # 3. Fallback: search profile directories
  if [ -z "$CHAT_ID" ]; then
    for env_file in "$HOME/.hermes/profiles/"*"/".env; do
      if [ -f "$env_file" ]; then
        CID=$(grep -E '^(TELEGRAM_CHAT_ID|TELEGRAM_USER_ID|TELEGRAM_ALLOWED_USERS)=' "$env_file" 2>/dev/null | head -n1 | cut -d '=' -f2- | tr -d '"' | tr -d "'" | cut -d ',' -f1 || true)
        if [ -n "$CID" ]; then
          CHAT_ID="$CID"
          break
        fi
      fi
    done
  fi
fi

if [ -z "$TELEGRAM_BOT_TOKEN" ]; then
  echo "Error: TELEGRAM_BOT_TOKEN not found in environment, --token, or ~/.hermes"
  exit 1
fi

if [ -z "$CHAT_ID" ]; then
  echo "Error: CHAT_ID not provided and TELEGRAM_CHAT_ID not found in ~/.hermes"
  exit 1
fi

API_URL="https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}"

# 1. Send Photo if specified
if [ -n "$PHOTO" ] && [ -f "$PHOTO" ]; then
  CURL_ARGS=(
    -s -X POST "${API_URL}/sendPhoto"
    -F "chat_id=${CHAT_ID}"
    -F "photo=@${PHOTO}"
  )
  if [ -n "$CAPTION" ]; then
    CURL_ARGS+=(-F "caption=${CAPTION}")
    CURL_ARGS+=(-F "parse_mode=Markdown")
  fi
  if [ -n "$THREAD_ID" ]; then
    CURL_ARGS+=(-F "message_thread_id=${THREAD_ID}")
  fi

  RAW_RESP=$(curl "${CURL_ARGS[@]}" 2>&1 || true)
  if echo "$RAW_RESP" | grep -q '"ok":true'; then
    echo "[Telegram Send] Photo delivered: $PHOTO"
  else
    if echo "$RAW_RESP" | grep -qi "can't parse entities"; then
      echo "[Telegram Send] Markdown parse failed for photo caption. Retrying with plain text..." >&2
      CURL_ARGS_PLAIN=(
        -s -X POST "${API_URL}/sendPhoto"
        -F "chat_id=${CHAT_ID}"
        -F "photo=@${PHOTO}"
      )
      if [ -n "$CAPTION" ]; then
        CURL_ARGS_PLAIN+=(-F "caption=${CAPTION}")
      fi
      if [ -n "$THREAD_ID" ]; then
        CURL_ARGS_PLAIN+=(-F "message_thread_id=${THREAD_ID}")
      fi
      RETRY_RESP=$(curl "${CURL_ARGS_PLAIN[@]}" 2>&1 || true)
      if echo "$RETRY_RESP" | grep -q '"ok":true'; then
        echo "[Telegram Send] Photo delivered (plain text fallback): $PHOTO"
      else
        echo "[Telegram Send] ERROR: Failed to deliver photo: $RETRY_RESP" >&2
      fi
    else
      echo "[Telegram Send] ERROR: Telegram API error sending photo: $RAW_RESP" >&2
    fi
  fi

# 2. Send Text message
elif [ -n "$TEXT" ]; then
  CURL_ARGS=(
    -s -X POST "${API_URL}/sendMessage"
    -d "chat_id=${CHAT_ID}"
    -d "text=${TEXT}"
    -d "parse_mode=Markdown"
  )
  if [ -n "$THREAD_ID" ]; then
    CURL_ARGS+=(-d "message_thread_id=${THREAD_ID}")
  fi

  RAW_RESP=$(curl "${CURL_ARGS[@]}" 2>&1 || true)
  if echo "$RAW_RESP" | grep -q '"ok":true'; then
    echo "[Telegram Send] Message delivered to chat $CHAT_ID"
  else
    if echo "$RAW_RESP" | grep -qi "can't parse entities"; then
      echo "[Telegram Send] Markdown parse failed for text message. Retrying with plain text..." >&2
      CURL_ARGS_PLAIN=(
        -s -X POST "${API_URL}/sendMessage"
        -d "chat_id=${CHAT_ID}"
        -d "text=${TEXT}"
      )
      if [ -n "$THREAD_ID" ]; then
        CURL_ARGS_PLAIN+=(-d "message_thread_id=${THREAD_ID}")
      fi
      RETRY_RESP=$(curl "${CURL_ARGS_PLAIN[@]}" 2>&1 || true)
      if echo "$RETRY_RESP" | grep -q '"ok":true'; then
        echo "[Telegram Send] Message delivered (plain text fallback) to chat $CHAT_ID"
      else
        echo "[Telegram Send] ERROR: Failed to deliver message: $RETRY_RESP" >&2
      fi
    else
      echo "[Telegram Send] ERROR: Telegram API error sending message: $RAW_RESP" >&2
    fi
  fi
else
  echo "Usage: $0 --text='...' OR --photo='/path/to/file' [--caption='...'] [--thread-id=...]"
  exit 1
fi
