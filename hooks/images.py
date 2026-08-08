#!/usr/bin/env python3
"""Owlcot — MkDocs hook: resolve per-page RSS/social images with offline fallback.

Runs in on_page_markdown, which is strictly before the RSS plugin generates
the feeds and before the page template renders. For every real journal entry
we overwrite page.meta["image"] with:

  - the remote hotlink (from frontmatter `image`) when it is reachable, or
  - the committed local fallback (from frontmatter `image_local`) otherwise.

The RSS plugin therefore emits an <enclosure> pointing at the remote CDN URL
while online, and at the self-hosted copy when offline or when the hotlink
dies — so the build never needs the network, and thumbnails never break.

Registered in mkdocs.yml under `hooks: [hooks/images.py]`.
"""

from __future__ import annotations

import sys
from pathlib import Path

_ROOT = Path(__file__).resolve().parent.parent
_TOOLS = _ROOT / "tools"
if str(_TOOLS) not in sys.path:
    sys.path.insert(0, str(_TOOLS))

from pick_image import DEFAULT_LOCAL, pick_image  # noqa: E402


def on_page_markdown(markdown, page, config, files):
    """Give entry pages a resolved image before RSS/template rendering."""
    url = page.url or ""
    # Real entries live under entries/; the "All Entries" index (002-welcome)
    # carries no image frontmatter and must be left untouched.
    is_entry = url.startswith("entries/")
    if not is_entry:
        return markdown

    meta = page.meta or {}
    remote = str(meta.get("image", "") or "")
    local = str(meta.get("image_local", "") or DEFAULT_LOCAL)
    if not remote and not meta.get("image_local"):
        return markdown  # not a real entry (e.g. the entries index page)

    meta["image"] = pick_image(remote, local)
    return markdown
