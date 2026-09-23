#!/usr/bin/env bash
# scripts/run-playwright-headless.sh
# Headless Playwright test runner with container & Termux optimizations

set -eo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

FILTER="${1:-}"

export CI="${CI:-1}"
export PLAYWRIGHT_TEST_BASE_URL="${PLAYWRIGHT_TEST_BASE_URL:-http://localhost:3000}"

echo "=========================================================="
echo " [Playwright Runner] Running tests headlessly..."
echo " Filter: ${FILTER:-all}"
echo " Base URL: $PLAYWRIGHT_TEST_BASE_URL"
echo "=========================================================="

if [ -n "$FILTER" ]; then
  npx playwright test "$FILTER" --reporter=list
else
  npx playwright test --reporter=list
fi
