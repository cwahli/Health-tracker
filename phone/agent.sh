#!/bin/bash
# Phone-agent entrypoint: sync repo, ensure toolchain, upload, verify, report.
# Safe to re-run. Human needed ONLY if it prints HUMAN-NEEDED.
# Usage (mobile opencode): bash phone/agent.sh
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

say() { echo "[phone-agent] $*"; }
need_human() { echo "HUMAN-NEEDED: $*"; exit 3; }

# 0. Must be the phone.
[ -n "${PREFIX:-}" ] && [[ "$PREFIX" == *"com.termux"* ]] || {
  echo "Not Termux; this entrypoint is phone-only. VPS runs scripts/drive-inbox-spike.mjs instead.";
  exit 2;
}

# 1. Sync with GitHub.
if git rev-parse --is-inside-work-tree > /dev/null 2>&1; then
  BRANCH="$(git branch --show-current)"
  say "pulling $BRANCH";
  git pull --ff-only || say "pull skipped (offline or diverged — continuing with local copy)";
else
  need_human "repo not cloned. Run: git clone -b agent/snap-drive https://github.com/cwahli/Health-tracker.git tracker"
fi

# 2. Toolchain.
for bin in node rclone; do
  command -v "$bin" > /dev/null 2>&1 || {
    say "installing $bin";
    pkg update -y && pkg install -y nodejs rclone cronie termux-api;
    break;
  }
done
node scripts/drive-inbox-spike.mjs --selftest > /dev/null || {
  echo "spike harness selftest FAILED — toolchain broken";
  exit 1;
}
say "toolchain ok";

# 3. Config.
# shellcheck disable=SC1091
[ -f phone/env.sh ] && source phone/env.sh || source phone/env.example
REMOTE="${GDRIVE_REMOTE:-gdrive}"
INBOX="${GDRIVE_INBOX:-Meals-inbox}"
rclone listremotes 2>/dev/null | grep -qx "${REMOTE}:" || \
  need_human "Drive remote '$REMOTE' missing. Run: rclone config (New remote > gdrive > drive > blank client > scope 1 > auto-config Yes) and click Allow in the browser, then re-run me."
[ -d "${PHONE_DCIM:-/sdcard/DCIM}" ] || need_human "DCIM not visible. Run termux-setup-storage and accept the permission tap, then re-run me."

# 4. Upload + verify.
BEFORE="$(rclone lsf "$REMOTE:$INBOX" 2>/dev/null | wc -l)"
bash phone/sync-photos.sh
AFTER="$(rclone lsf "$REMOTE:$INBOX" 2>/dev/null | wc -l)"
say "inbox files before=$BEFORE after=$AFTER (uploaded=$((AFTER - BEFORE)))";

# 5. Schedule (idempotent).
CRON_LINE="17 */2 * * * cd $ROOT && bash phone/agent.sh >> \$HOME/phone-agent.log 2>&1"
(crontab -l 2>/dev/null | grep -v "phone/agent.sh"; echo "$CRON_LINE") | crontab -
pgrep -x crond > /dev/null 2>&1 || crond 2>/dev/null || say "crond not started (reboot or Termux:Boot will start schedule)";
say "done. branch=$(git branch --show-current) inbox=$AFTER files";
