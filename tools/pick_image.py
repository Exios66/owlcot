#!/usr/bin/env python3
"""Owlcot — shared remote-vs-local image picker.

For every journal entry we define two images:

  image        remote hotlink (primary), e.g. a Wikimedia/Unsplash CDN URL
  image_local  committed fallback copy under docs/assets/images/entries/

pick_image() returns the remote URL when it is reachable (HTTP 200), and the
local fallback path when the network is unavailable or the hotlink has gone
stale (hotlink rot). Probe results are cached per process so a single build
never hammers the network, and builds stay deterministic offline.

Imported by both tools/update_index.py (site cards) and hooks/images.py
(RSS enclosures + og:image).
"""

from __future__ import annotations

import logging
import urllib.request

TIMEOUT = 3.0

DEFAULT_LOCAL = "assets/images/entries/default.jpg"

_CACHE: dict[str, str] = {}

_log = logging.getLogger("owlcot.images")


def remote_reachable(url: str, timeout: float = TIMEOUT) -> bool:
    """Cheap reachability probe. Any failure or non-2xx means 'not reachable'."""
    if not url:
        return False
    # Some servers reject HEAD; fall back to a tiny ranged GET.
    attempts = (
        ("HEAD", {"Range": "bytes=0-0"}),
        ("GET", {"Range": "bytes=0-0"}),
    )
    for method, extra in attempts:
        try:
            headers = {"User-Agent": "owlcot-build/1.0 (+https://github.com/Exios66/owlcot)"}
            headers.update(extra)
            req = urllib.request.Request(url, method=method, headers=headers)
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                if 200 <= resp.status < 400:
                    return True
        except Exception:
            continue
    return False


def pick_image(remote: str = "", local: str = DEFAULT_LOCAL, timeout: float = TIMEOUT) -> str:
    """Return the remote URL when reachable, otherwise the local fallback path."""
    remote = (remote or "").strip()
    local = (local or DEFAULT_LOCAL).strip()
    if not remote:
        return local

    key = f"{remote}\x00{local}"
    if key in _CACHE:
        return _CACHE[key]

    chosen = remote if remote_reachable(remote, timeout) else local
    if chosen == local:
        _log.warning("remote image unreachable (%s); using local fallback %s", remote, local)
    _CACHE[key] = chosen
    return chosen
