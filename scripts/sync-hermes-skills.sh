#!/usr/bin/env bash
# scripts/sync-hermes-skills.sh
#
# Automatically syncs and symlinks shared repo skills into all Hermes profiles:
# - Default profile (~/.hermes/skills/)
# - All existing and new profiles (~/.hermes/profiles/*/skills/)
#
# Usage:
#   bash scripts/sync-hermes-skills.sh

set -e

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SKILLS_SRC="${REPO_DIR}/scripts/skills/common"
HERMES_DIR="${HOME}/.hermes"

if [ ! -d "$SKILLS_SRC" ]; then
  echo "[SyncSkills] Error: Skills directory not found at $SKILLS_SRC"
  exit 1
fi

echo "=========================================================="
echo " [Hermes Shared Skills Sync]"
echo " Source: $SKILLS_SRC"
echo " Destination: $HERMES_DIR"
echo "=========================================================="

mkdir -p "${HERMES_DIR}/skills"
mkdir -p "${HERMES_DIR}/shared_skills"

# Target skill directories to sync into
TARGET_DIRS=("${HERMES_DIR}/skills" "${HERMES_DIR}/shared_skills")

if [ -d "${HERMES_DIR}/profiles" ]; then
  for prof in "${HERMES_DIR}/profiles/"*; do
    if [ -d "$prof" ]; then
      mkdir -p "$prof/skills"
      TARGET_DIRS+=("$prof/skills")
    fi
  done
fi

# Clean up orchestrator-dispatcher symlink from profiles that must not dispatch
# (QA + meal_audit + the packer bug_ticket — intake never dispatches).
for no_dispatch_prof in qa_meal qa_biomarker qa_onboarding meal_audit bug_ticket; do
  if [ -d "${HERMES_DIR}/profiles/$no_dispatch_prof/skills" ]; then
    rm -f "${HERMES_DIR}/profiles/$no_dispatch_prof/skills/orchestrator-dispatcher"
  fi
done

SKILL_COUNT=0
for skill_path in "${SKILLS_SRC}"/*; do
  if [ -d "$skill_path" ] && [ -f "$skill_path/SKILL.md" ]; then
    skill_name=$(basename "$skill_path")
    SKILL_COUNT=$((SKILL_COUNT + 1))

    for target in "${TARGET_DIRS[@]}"; do
      # Do not link orchestrator-dispatcher into QA, meal_audit, or bug_ticket profiles
      if [ "$skill_name" = "orchestrator-dispatcher" ] && [[ "$target" =~ /profiles/(qa_|meal_audit|bug_ticket) ]]; then
        continue
      fi
      ln -sfn "$skill_path" "$target/$skill_name"
    done
    echo "  ✓ Linked skill: '$skill_name' -> profile locations (filtered for QA/meal_audit/bug_ticket)"
  fi
done


# BOT-14: Compatibility symlinks in ~/.hermes/shared_skills/ for legacy paths
mkdir -p "${HERMES_DIR}/shared_skills/social-media"
ln -sfn "${SKILLS_SRC}/telegram-photo" "${HERMES_DIR}/shared_skills/social-media/telegram-media-delivery"
mkdir -p "${HERMES_DIR}/shared_skills/autonomous-ai-agents"
ln -sfn "${SKILLS_SRC}/bug-ticket" "${HERMES_DIR}/shared_skills/autonomous-ai-agents/opencode"

echo "[SyncSkills] Successfully synced $SKILL_COUNT skills across all Hermes profiles (plus legacy shared_skills links)."
