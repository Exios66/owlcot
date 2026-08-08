#!/bin/bash
# Owlcot — local validation pipeline (GitHub-Actions-free CI equivalent).
#
# Runs every check the old CI workflow did, locally, in one shot:
#   1. Regenerate all indexes from entry frontmatter
#   2. Strict build (warnings fail the build)
#   3. Verify the generated site is complete
#
# Usage:  tools/validate.sh
set -e
cd "$(dirname "$0")/.."

echo "🦉 Regenerating indexes..."
python3 tools/update_index.py

echo "🔨 Building (strict)..."
mkdocs build --strict --clean

echo "🔍 Verifying generated site..."
FAIL=0
check() {
  if [ ! -f "$1" ]; then
    echo "  ✗ missing: $1"
    FAIL=1
  fi
}
check site/index.html
check site/about.html
check site/tags.html
check site/robots.txt
check site/sitemap.xml
check site/feed_rss_created.xml
check site/assets/images/favicon.svg
check site/assets/js/reading-time.js
check site/entries/002-nine-one-and-five-sessions.html

if grep -rq "PLACEHOLDER" site/; then
  echo "  ✗ PLACEHOLDER text leaked into the build"
  FAIL=1
fi

if [ "$FAIL" -ne 0 ]; then
  echo "❌ Validation failed."
  exit 1
fi

echo "✅ All checks passed."
