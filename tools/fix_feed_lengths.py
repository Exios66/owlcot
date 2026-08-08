#!/usr/bin/env python3
"""Owlcot — post-build fixup for RSS enclosure lengths.

The RSS plugin fetches each remote image over HTTP to learn its byte-length.
Remote CDNs (Wikimedia Commons in particular) rate-limit bursty requests, so
some enclosures come out as `length="None"`, which is invalid RSS 2.0.

This step resolves those lengths itself — one request at a time, with a small
delay and a cache under .cache/ — so the published feeds are always valid and
builds stay deterministic offline. Run after `mkdocs build`.

Usage:  python3 tools/fix_feed_lengths.py
"""

from __future__ import annotations

import json
import re
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CACHE_DIR = ROOT / ".cache"
CACHE_FILE = CACHE_DIR / "owlcot_image_lengths.json"
FEEDS = ["site/feed_rss_created.xml", "site/feed_rss_updated.xml"]
UA = "owlcot-build/1.0 (+https://github.com/Exios66/owlcot)"
MKDOCS_YML = ROOT / "mkdocs.yml"

# <enclosure url="..." type="..." length="None" />
ENCLOSURE_RE = re.compile(r'<enclosure\s+url="([^"]+)"\s+type="([^"]+)"\s+length="None"\s*/>')


def site_base() -> str:
    text = MKDOCS_YML.read_text(encoding="utf-8")
    m = re.search(r"(?m)^site_url:\s*(.+)$", text)
    return m.group(1).strip().rstrip("/") if m else "https://exios66.github.io/owlcot"


def local_size(url: str, base: str) -> int | None:
    """Byte size of the committed copy for a self-hosted enclosure URL."""
    prefix = base + "/"
    if not url.startswith(prefix):
        return None
    rel = url[len(prefix):]
    if ".." in rel or rel.startswith("/"):
        return None
    candidate = ROOT / "docs" / rel
    if candidate.is_file():
        return candidate.stat().st_size
    return None


def load_cache() -> dict:
    if CACHE_FILE.exists():
        try:
            return json.loads(CACHE_FILE.read_text(encoding="utf-8"))
        except Exception:
            pass
    return {}


def save_cache(cache: dict) -> None:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    CACHE_FILE.write_text(json.dumps(cache, indent=2), encoding="utf-8")


def fetch_length(url: str) -> int | None:
    """Single sequential attempt at learning a remote image's byte length."""
    try:
        req = urllib.request.Request(url, method="HEAD", headers={"User-Agent": UA})
        with urllib.request.urlopen(req, timeout=20) as resp:
            n = resp.headers.get("Content-Length")
            if n:
                return int(n)
    except Exception:
        pass
    try:
        req = urllib.request.Request(
            url, method="GET", headers={"User-Agent": UA, "Range": "bytes=0-0"}
        )
        with urllib.request.urlopen(req, timeout=20) as resp:
            resp.read(1024)
            cr = resp.headers.get("Content-Range") or ""
            m = re.search(r"/\s*(\d+)", cr)
            if m:
                return int(m.group(1))
    except Exception:
        pass
    return None


def fix() -> int:
    cache = load_cache()
    base = site_base()
    changed = 0
    for feed in FEEDS:
        path = ROOT / feed
        if not path.exists():
            continue
        text = path.read_text(encoding="utf-8")

        def repl(match: re.Match) -> str:
            url, mime = match.group(1), match.group(2)
            size = local_size(url, base)
            if size is None:
                if url not in cache:
                    cache[url] = fetch_length(url)
                    save_cache(cache)
                    if cache[url]:
                        time.sleep(0.6)
                size = cache[url]
            if size:
                return f'<enclosure url="{url}" type="{mime}" length="{size}" />'
            return match.group(0)

        new = ENCLOSURE_RE.sub(repl, text)
        if new != text:
            path.write_text(new, encoding="utf-8")
            changed += 1
    return changed


if __name__ == "__main__":
    changed = fix()
    if changed:
        print(f"ok: resolved enclosure lengths in {changed} feed file(s)")
    else:
        print("ok: feed enclosure lengths already complete")
    sys.exit(0)
