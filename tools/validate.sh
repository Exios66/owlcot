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

echo "🔧 Resolving feed enclosure lengths..."
python3 tools/fix_feed_lengths.py

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

echo "🔍 Verifying entry fallback images..."
if ! python3 - <<'PY'
import re
import sys
from pathlib import Path

import yaml

bad = []
for p in sorted(Path("docs/entries").glob("*.md")):
    if p.name == "002-welcome.md":
        continue
    fm = re.match(r"^---\s*\n(.*?)\n---\s*\n", p.read_text(encoding="utf-8"), re.S)
    meta = yaml.safe_load(fm.group(1)) if fm else {}
    local = (meta or {}).get("image_local", "")
    if not local:
        bad.append(f"{p.name}: missing image_local")
    elif not (Path("docs") / local).exists():
        bad.append(f"{p.name}: image_local not found -> {local}")
if bad:
    for b in bad:
        print("  ✗ " + b)
    sys.exit(1)
print("  ✓ all entries have a local fallback image")
PY
then
  echo "  ✗ entry fallback image check failed"
  FAIL=1
fi

if [ "$FAIL" -ne 0 ]; then
  echo "❌ Validation failed."
  exit 1
fi

echo "✅ All checks passed."
