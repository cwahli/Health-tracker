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

# Source token and chat ID from active profile or ~/.hermes/.env if not in environment
if [ -z "$TELEGRAM_BOT_TOKEN" ]; then
  for env_file in "$HOME/.hermes/profiles/"*"/".env "$HOME/.hermes/.env"; do
    if [ -f "$env_file" ]; then
      TOKEN=$(grep -E '^TELEGRAM_BOT_TOKEN=' "$env_file" 2>/dev/null | head -n1 | cut -d '=' -f2- | tr -d '"' | tr -d "'" || true)
      if [ -n "$TOKEN" ]; then
        TELEGRAM_BOT_TOKEN="$TOKEN"
        break
      fi
    fi
  done
fi

if [ -z "$TELEGRAM_CHAT_ID" ]; then
  for env_file in "$HOME/.hermes/profiles/"*"/".env "$HOME/.hermes/.env"; do
    if [ -f "$env_file" ]; then
      CID=$(grep -E '^(TELEGRAM_CHAT_ID|TELEGRAM_USER_ID|TELEGRAM_ALLOWED_USERS)=' "$env_file" 2>/dev/null | head -n1 | cut -d '=' -f2- | tr -d '"' | tr -d "'" | cut -d ',' -f1 || true)
      if [ -n "$CID" ]; then
        TELEGRAM_CHAT_ID="$CID"
        break
      fi
    fi
  done
fi

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
  esac
done

CHAT_ID="${CHAT_ID:-$TELEGRAM_CHAT_ID}"

if [ -z "$TELEGRAM_BOT_TOKEN" ]; then
  echo "Error: TELEGRAM_BOT_TOKEN not found in environment or ~/.hermes/.env"
  exit 1
fi

if [ -z "$CHAT_ID" ]; then
  echo "Error: CHAT_ID not provided and TELEGRAM_CHAT_ID not found in ~/.hermes/.env"
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

  curl "${CURL_ARGS[@]}" > /dev/null
  echo "[Telegram Send] Photo delivered: $PHOTO"

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

  curl "${CURL_ARGS[@]}" > /dev/null 2>&1
  echo "[Telegram Send] Message delivered to chat $CHAT_ID"
else
  echo "Usage: $0 --text='...' OR --photo='/path/to/file' [--caption='...'] [--thread-id=...]"
  exit 1
fi
