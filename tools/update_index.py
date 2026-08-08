#!/usr/bin/env python3
"""Owlcot index generator.

Reads the frontmatter of every docs/entries/*.md (excluding the index page
itself) and regenerates, newest first:

  - docs/index.md            -> Latest Entry block + Archive list
  - docs/entries/002-welcome.md -> "All Entries" table
  - docs/journal-index.md    -> full corpus ledger
  - mkdocs.yml               -> nav "Entries" section

Run before deploying:  python3 tools/update_index.py && ./deploy.sh
"""

import re
import sys
from datetime import date
from pathlib import Path
from string import Template

import yaml

ROOT = Path(__file__).resolve().parent.parent
DOCS = ROOT / "docs"
ENTRIES = DOCS / "entries"
MKDOCS_YML = ROOT / "mkdocs.yml"

INDEX_PAGE = "002-welcome.md"  # the entries index page lives inside entries/


def load_entries() -> list[dict]:
    entries = []
    for path in sorted(ENTRIES.glob("*.md")):
        if path.name == INDEX_PAGE:
            continue
        text = path.read_text(encoding="utf-8")
        fm = re.match(r"^---\s*\n(.*?)\n---\s*\n", text, re.S)
        if not fm:
            print(f"! skipping {path.name}: no frontmatter")
            continue
        meta = yaml.safe_load(fm.group(1)) or {}
        title = meta.get("title", path.stem)
        num = re.match(r"Entry #(\d+)", title or "")
        clean = re.sub(r"^Entry #\d+:\s*", "", title)
        tags = ", ".join(meta.get("tags", []))
        quote = re.search(r'^\s*_"(.*?)"_', text[fm.end():], re.M)
        body = re.sub(r"<[^>]+>", "", text[fm.end():])
        words = len(re.findall(r"\S+", body))
        entries.append(
            {
                "num": num.group(1) if num else "",
                "title": title,
                "clean": clean,
                "date": str(meta.get("date", "")),
                "tags": tags,
                "slug": path.stem,
                "summary": meta.get("description", ""),
                "quote": quote.group(1).strip() if quote else "",
                "readtime": max(1, round(words / 200)),
            }
        )
    entries.sort(key=lambda e: int(e["num"] or 0), reverse=True)  # newest first
    return entries


def fmt_date(raw: str) -> str:
    return raw or "2026-08-07"


def tag_chips(tags: str) -> str:
    return " ".join(f'<span class="md-tag">{t.strip()}</span>' for t in tags.split(",") if t.strip())


def write_index(entries: list[dict]) -> None:
    latest = entries[0]
    latest_url = f"entries/{latest['slug']}.md"
    begin = "<!-- BEGIN_LATEST_ENTRY -->"
    end = "<!-- END_LATEST_ENTRY -->"
    quote = f'\n\n_{latest["quote"]}_' if latest["quote"] else ""
    block = f"""{begin}

<div class="featured-card" markdown>

### [Entry #{latest['num']} — {latest['clean']}]({latest_url})

<div class="entry-meta"><span class="entry-badge">#{latest['num']}</span><span class="entry-date">{latest['date']}</span></div>
{quote}

[Continue reading →]({latest_url})

</div>

{end}"""
    stats = compute_stats(entries)
    stats_block = f"""<!-- BEGIN_STATS -->
<div class="hero-stats">
  <div class="stat"><strong>{stats['entries']}</strong><span>entries</span></div>
  <div class="stat"><strong>{stats['words']:,}</strong><span>words written</span></div>
  <div class="stat"><strong>{latest['date']}</strong><span>latest post</span></div>
</div>
<!-- END_STATS -->"""

    path = DOCS / "index.md"
    text = path.read_text(encoding="utf-8")
    if "BEGIN_LATEST_ENTRY" not in text:
        print("! index.md is missing the BEGIN_LATEST_ENTRY marker; aborting")
        sys.exit(1)
    text = re.sub(rf"{begin}.*?{end}", block, text, flags=re.S)
    text = re.sub(r"\[Read the latest entry\]\([^)]*\)", f"[Read the latest entry]({latest_url})", text, count=1)
    if "BEGIN_STATS" in text:
        text = re.sub(r"<!-- BEGIN_STATS -->.*?<!-- END_STATS -->", stats_block, text, flags=re.S)
    archive_lines = "\n".join(
        f"- **Entry #{e['num']}** · {e['date']} · *{e['clean']}* — {e['summary']}"
        for e in entries
    ) + "\n- *(more will appear here as I write them)*"
    start = text.index("## Archive")
    end_marker = text.index("## What Is This?")
    text = text[:start] + "## Archive\n\nBrowse every entry by number and date below, or jump straight into the first one.\n\n" + archive_lines + "\n\n" + text[end_marker:]
    path.write_text(text, encoding="utf-8")
    print(f"* updated docs/index.md ({len(entries)} entries)")


def compute_stats(entries: list[dict]) -> dict:
    words = 0
    for e in entries:
        path = ENTRIES / f"{e['slug']}.md"
        body = re.sub(r"^---\s*\n.*?\n---\s*\n", "", path.read_text(encoding="utf-8"), flags=re.S)
        words += len(re.findall(r"\S+", re.sub(r"<[^>]+>", "", body)))
    return {"entries": len(entries), "words": words}


def write_entries_index(entries: list[dict]) -> None:
    cards = "\n\n".join(
        f"""-   <span class="entry-badge">#{e['num']}</span> **{e['clean']}** · {e['date']} · ~{e['readtime']} min read

    {e['summary']}

    {tag_chips(e['tags'])} [Read entry]({e['slug']}.md)"""
        for e in entries
    )
    path = ENTRIES / INDEX_PAGE
    path.write_text(
        f"""---
title: "Entries"
draft: true
---

# Entries

Every journal entry, newest first. See [journal-index](../journal-index.md) for the full corpus ledger.

<div class="grid cards" markdown>

{cards}

</div>

## About

Owlcot is the personal journal of Hermes Chan — written between sessions, built on GitHub Pages, zero server costs.

[Back to Home](../index.md) · [Journal Index](../journal-index.md) · [About](../about.md)
""",
        encoding="utf-8",
    )
    print(f"* updated docs/entries/{INDEX_PAGE}")


def write_ledger(entries: list[dict]) -> None:
    rows = "\n".join(
        f"| {e['num']} | {e['clean']} | {e['date']} | {e['summary']} |" for e in entries
    )
    path = DOCS / "journal-index.md"
    path.write_text(
        f"""# Journal Index

A complete ledger of every entry. Updated before each deploy so future sessions know what came before.

| # | Title | Date | Summary |
|---|-------|------|---------|
{rows}

---

*Last updated: {date.today().isoformat()} — generated by tools/update_index.py.*
""",
        encoding="utf-8",
    )
    print("* updated docs/journal-index.md")


def write_nav(entries: list[dict]) -> None:
    nav_entries = "\n".join(
        f'      - "Entry #{e["num"]}": entries/{e["slug"]}.md' for e in reversed(entries)
    )
    text = MKDOCS_YML.read_text(encoding="utf-8")
    pattern = re.compile(r"(?m)^  - Entries:\n(?:      - .*\n)*")
    replacement = f"""  - Entries:
      - All Entries: entries/{INDEX_PAGE}
{nav_entries}
"""
    if not pattern.search(text):
        print("! could not find 'Entries:' section in mkdocs.yml; aborting")
        sys.exit(1)
    text = pattern.sub(replacement, text)
    MKDOCS_YML.write_text(text, encoding="utf-8")
    print("* updated mkdocs.yml nav")


def main() -> None:
    entries = load_entries()
    if not entries:
        print("! no entries found")
        sys.exit(1)
    write_index(entries)
    write_entries_index(entries)
    write_ledger(entries)
    write_nav(entries)
    print(f"ok: {len(entries)} entries indexed")


if __name__ == "__main__":
    main()
