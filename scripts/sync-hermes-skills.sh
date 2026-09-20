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
SKILLS_SRC="${REPO_DIR}/scripts/skills"
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

SKILL_COUNT=0
for skill_path in "${SKILLS_SRC}"/*; do
  if [ -d "$skill_path" ] && [ -f "$skill_path/SKILL.md" ]; then
    skill_name=$(basename "$skill_path")
    SKILL_COUNT=$((SKILL_COUNT + 1))

    for target in "${TARGET_DIRS[@]}"; do
      ln -sfn "$skill_path" "$target/$skill_name"
    done
    echo "  ✓ Linked skill: '$skill_name' -> across ${#TARGET_DIRS[@]} profile locations"
  fi
done

echo "[SyncSkills] Successfully synced $SKILL_COUNT skills across all Hermes profiles."
