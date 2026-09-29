#!/usr/bin/env bash
# enrol-google-workspace.sh — one-shot host enrolment for Google Workspace agent work.
#
# Idempotent. Zero writes to Google. Run from the repo root on any host
# (vps, grok, collab):
#   1. Installs the `gws` CLI if missing (npm i -g @googleworkspace/cli).
#   2. Checks the 9 gws skills + routing skill are present in this checkout.
#   3. Runs the zero-burn probe (scripts/probe-google-store.mjs): READY, or an
#      honest needsSetup naming the missing variable/folder.
#
# The phone never holds the key: there the probe reports NOT READY and the
# agent hands off (QS-3), which is correct behaviour, not a failure.
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || exit 1

SKILLS="gws-shared gws-sheets gws-sheets-read gws-sheets-append gws-drive gws-drive-upload gws-docs gws-docs-write recipe-organize-drive-folder google-workspace-routing"
fail=0

echo "== 1/3 gws binary =="
if command -v gws >/dev/null 2>&1; then
  echo "ok   gws $(gws --version 2>/dev/null | head -n1)"
else
  echo "install npm i -g @googleworkspace/cli"
  if npm install -g @googleworkspace/cli >/dev/null 2>&1 && command -v gws >/dev/null 2>&1; then
    echo "ok   gws installed"
  else
    echo "FAIL gws install (needs node 18+ and npm)"; fail=1
  fi
fi

echo "== 2/3 skills =="
for s in $SKILLS; do
  if [ -f ".agents/skills/$s/SKILL.md" ]; then
    echo "ok   $s"
  else
    echo "MISS $s (run: git pull origin main)"; fail=1
  fi
done

echo "== 3/3 zero-burn probe (no writes) =="
node scripts/probe-google-store.mjs || true

if [ "$fail" = 0 ]; then
  echo "ENROL OK"
else
  echo "ENROL INCOMPLETE (see MISS/FAIL above)"; exit 1
fi
