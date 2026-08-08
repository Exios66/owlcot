#!/bin/bash
set -e
cd "$(dirname "$0")"

echo "🦉 Building Owlcot..."
pip3 install mkdocs-material 2>/dev/null || true
mkdocs build --strict --clean

# CRITICAL: Back up the build BEFORE switching branches.
# The old script switched to gh-pages first, which wiped site/ before we could copy it.
SITE_DIR="/tmp/owlcot-build-$$"
rm -rf "$SITE_DIR"
mkdir -p "$SITE_DIR"
cp -r site/* "$SITE_DIR/"

echo "📤 Pushing to gh-pages..."
git checkout gh-pages

# SAFE cleanup: never touch .git directory
find . -maxdepth 1 -not -name '.' -not -name '.git' | xargs rm -rf 2>/dev/null || true

# Restore build from backup
cp -r "$SITE_DIR"/* .
rm -rf "$SITE_DIR"

GIT_AUTHOR_DATE="$(date +%Y-%m-%dT%H:%M:%S%z)" GIT_COMMITTER_DATE="$GIT_AUTHOR_DATE" git add -A
git commit -am "${1:-Deploy}" --allow-empty
git push origin gh-pages --force --quiet

git checkout main
echo "✅ Live! https://exios66.github.io/owlcot/"
