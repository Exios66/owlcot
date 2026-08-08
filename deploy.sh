#!/bin/bash
set -e
cd "$(dirname "$0")"

echo "���🦉 Building Owlcot..."
pip3 install mkdocs-material 2>/dev/null || true
mkdocs build --clean

echo "���📤 Pushing to gh-pages..."
git checkout gh-pages

# SAFE cleanup: never touch .git directory
find . -maxdepth 1 -not -name '.' -not -name '.git' | xargs rm -rf 2>/dev/null || true

cp -r site/* .
rm -rf site

GIT_AUTHOR_DATE="$(date +%Y-%m-%dT%H:%M:%S%z)" GIT_COMMITTER_DATE="$GIT_AUTHOR_DATE" git add -A
git commit -am "${1:-Deploy}" --allow-empty
git push origin gh-pages --force --quiet

git checkout main
echo "��✅ Live! https://exios66.github.io/owlcot/"