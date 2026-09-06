#!/usr/bin/env bash
set -euo pipefail

if [ -f "../convex/_generated/api.js" ] || [ -f "../../tasky/convex/_generated/api.js" ] || [ -f "tasky-checkout/convex/_generated/api.js" ]; then
  exit 0
fi

TASKY_REPO_URL="${TASKY_REPO_URL:-https://github.com/dwetterau/tasky.git}"
git clone --depth 1 "${TASKY_REPO_URL}" tasky-checkout
