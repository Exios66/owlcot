#!/usr/bin/env python3
"""Owlcot — shared remote-vs-local image picker.

For every journal entry we define two images:

  image        remote hotlink (primary), e.g. a Wikimedia/Unsplash CDN URL
  image_local  committed fallback copy under docs/assets/images/entries/

pick_image() returns the remote URL when it is reachable (HTTP 200), and the
local fallback path when the network is unavailable or the hotlink has gone
stale (hotlink rot). Probe results are cached per process AND on disk
(.cache/owlcot_image_probe.json, gitignored) so that back-to-back runs — e.g.
update_index.py, then validate.sh inside deploy.sh — see the same network and
produce identical generated files. Wikimedia rate-limits bursty probes, which
used to make consecutive runs flip between remote/local URLs in the committed
sources ("thumbnail churn").

The disk cache is short-TTL only (default 6 hours): a genuinely dead hotlink
is picked up again within a day, while same-day builds stay deterministic.

Imported by both tools/update_index.py (site cards) and hooks/images.py
(RSS enclosures + og:image).
"""

from __future__ import annotations

import json
import logging
import time
import urllib.request
from pathlib import Path

TIMEOUT = 3.0

DEFAULT_LOCAL = "assets/images/entries/default.jpg"

CACHE_PATH = Path(__file__).resolve().parent.parent / ".cache" / "owlcot_image_probe.json"
CACHE_TTL_SECONDS = 6 * 60 * 60  # 6 hours

_CACHE: dict[str, str] = {}
_DISK_CACHE_LOADED = False

_log = logging.getLogger("owlcot.images")


def _load_disk_cache() -> None:
    global _DISK_CACHE_LOADED
    if _DISK_CACHE_LOADED:
        return
    _DISK_CACHE_LOADED = True
    if not CACHE_PATH.exists():
        return
    try:
        raw = json.loads(CACHE_PATH.read_text())
        now = time.time()
        for key, entry in raw.items():
            # Old format stored plain strings — treat them as fresh "remote".
            if isinstance(entry, str):
                _CACHE[key] = entry
                continue
            chosen = entry.get("chosen")
            ts = entry.get("ts", 0)
            if chosen is not None and (now - ts) <= CACHE_TTL_SECONDS:
                _CACHE[key] = chosen
    except Exception:  # corrupt cache is never fatal — just re-probe
        pass


def _save_disk_cache() -> None:
    try:
        CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
        payload = {key: {"chosen": chosen, "ts": time.time()} for key, chosen in _CACHE.items()}
        CACHE_PATH.write_text(json.dumps(payload))
    except Exception:
        pass


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
    _load_disk_cache()
    if key in _CACHE:
        return _CACHE[key]

    chosen = remote if remote_reachable(remote, timeout) else local
    if chosen == local:
        _log.warning("remote image unreachable (%s); using local fallback %s", remote, local)
    _CACHE[key] = chosen
    _save_disk_cache()
    return chosen
