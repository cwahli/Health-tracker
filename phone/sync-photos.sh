#!/bin/bash
# Phone-side upload leg: DCIM -> Drive Meals-inbox via rclone.
# Idempotent: --ignore-existing skips already-uploaded files.
# Usage: source phone/env.sh && bash phone/sync-photos.sh [extra rclone flags]
set -e
REMOTE="${GDRIVE_REMOTE:-gdrive}"
INBOX="${GDRIVE_INBOX:-Meals-inbox}"
SRC="${PHONE_DCIM:-/sdcard/DCIM}"
LOG="${SYNC_LOG:-$HOME/drive-sync.log}"
rclone copy "$SRC" "$REMOTE:$INBOX" \
  --include "*.{jpg,jpeg,png,webp,JPG,JPEG,PNG,WEBP}" \
  --no-traverse --ignore-existing \
  -v --log-file "$LOG" "$@"
echo "sync done: $(date -u +%FT%TZ) errors=$?"
