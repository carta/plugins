#!/usr/bin/env python3
"""fetch_logos.py — download portfolio-company logo images for the fund-modeling app.

Takes the JSON result of the Carta MCP ``fa__list__portco_logos`` call (a list of
per-company entries, each carrying a corporation id and a presigned image URL —
see SKILL.md Step 2b) and downloads every image straight into
``<raw_dir>/logos/<corporation_uuid>.<ext>``. ``build_datadir.py``'s ``load_logos()``
reads that directory and embeds each image as a ``data:`` URI on its matching
company, so the presigned URL itself never has to stay valid past this one fetch.

Best-effort by design — logos are a cosmetic enhancement, not a required stem. A
company with no logo, an expired/broken URL, or a download error is skipped (logged
to stderr) rather than failing the whole build; ``build_datadir.py`` has no gate on
this directory the way it does for the required DWH stems.

Files are named by ``corporation_uuid`` (not ``corporation_id``) because that's
what build_datadir.py's load_logos() joins against -- every company object it
writes carries a ``corpUuid``, never the integer corporation_id. A real
fa:list:portco_logos row carries both fields, so the id-column lookup below
must prefer the uuid one; picking the integer id first would name every file
after a value nothing downstream ever matches against, silently dropping every
logo. Entries are matched by flexible key names, using build_datadir.py's own
``col()`` lookup (imported below) rather than a second copy of it, since the
exact response shape isn't pinned down for every deployment:
  id column:  corporation_uuid | corp_uuid | corporation_id | corp_id | id
  url column: logo_url | presigned_url | download_url | url

``<raw_dir>/logos/`` is cleared and re-fetched wholesale on every run rather than
merged with whatever's already there — a stale file from a prior run (e.g. a
company's logo URL now serving a different content-type, leaving both an old
and new extension on disk) would otherwise sit next to the fresh one, and
build_datadir.py's directory scan has no way to know which of two files for the
same corporation_uuid is current.

Usage:
    uv run fetch_logos.py <portco_logos.json> <raw_dir>
"""

import argparse
import json
import os
import re
import shutil
import sys
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import urlparse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import save_query_result as sqr  # noqa: E402 - reuse its MCP-envelope unwrapping below
from build_datadir import col, EXT_MIME  # noqa: E402 - reuse its column lookup + the shared extension set

ID_KEYS = ("corporation_uuid", "corp_uuid", "corporation_id", "corp_id", "id")
URL_KEYS = ("logo_url", "presigned_url", "download_url", "url")

# The file_key lands directly in a filesystem path (<raw_dir>/logos/<file_key><ext>);
# the MCP response is trusted-first-party but not sanitized upstream, so a
# malformed corporation_uuid/id must not be able to escape logos/ via a "/" or "..".
# The extension itself is never taken from the row/URL at all -- see _image_ext below.
# _UUID_RE below is the only shape check needed: it's strictly narrower than any
# path-safety charset (hex digits and hyphens only), so a separate "no slashes"
# guard would never reject anything _UUID_RE doesn't already reject.

# build_datadir.py's load_logos() joins strictly on corporation UUID (every
# company object carries a corpUuid, never the integer corporation_id) — so a
# file_key that isn't UUID-shaped can NEVER match a company no matter which
# ID_KEYS candidate produced it. Reject it up front rather than spending a
# fetch+write on a logo that's guaranteed to end up orphaned with no one ever
# told why.
_UUID_RE = re.compile(
    r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
)

# A firm-uploaded "logo" that's actually a multi-MB marketing photo is still
# only ever rendered at 32x32px (Overview.jsx's activity-feed avatar) — cap the
# embedded bytes generously rather than let one oversized asset bloat every
# dashboard load. 500KB is far above any real brand-mark logo.
MAX_LOGO_BYTES = 500_000

# Minimal magic-byte sniff so a corrupt/truncated download (interrupted fetch,
# an HTML error page saved under an image-looking name) never gets written to
# disk as a "logo": build_datadir.py's load_logos() only checks this file's
# extension (see EXT_MIME there), not its bytes, and the browser has no fallback
# once a broken data: URI reaches Overview.jsx. This also doubles as the
# authoritative extension source: a real logo's presigned URL path is often the
# company's bare domain (e.g. ".../joinmidi.com"), not a filename, so the URL's
# own "extension" can't be trusted at all — reading the real format from the
# bytes themselves sidesteps the URL entirely.
_MAGIC = (
    (b"\x89PNG\r\n\x1a\n", ".png"),
    (b"\xff\xd8\xff", ".jpg"),
    (b"GIF87a", ".gif"),
    (b"GIF89a", ".gif"),
    (b"BM", ".bmp"),
)


def _image_ext(data):
    """The real extension for `data`, sniffed from its magic bytes -- or None
    if it doesn't look like a decodable image at all. Every return value is
    validated against build_datadir.py's EXT_MIME (imported above) rather than
    trusted on its own -- so a sniff added here for a new format without also
    adding it to EXT_MIME fails LOUD (this file skips the download and logs why)
    instead of build_datadir.py's load_logos() silently dropping the file later
    with no signal at all."""
    ext = None
    for sig, cand in _MAGIC:
        if data.startswith(sig):
            ext = cand
            break
    else:
        if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
            ext = ".webp"
        else:
            head = data[:256].lstrip().lower()
            if head.startswith(b"<?xml") or head.startswith(b"<svg"):
                ext = ".svg"
    return ext if ext in EXT_MIME else None


def entries_from(payload):
    """Flatten the fa:list:portco_logos result into row dicts, reusing
    save_query_result.py's MCP-envelope unwrapping (content-block lists, base64
    resource blobs, the harness's ``{"result": "<json text>"}`` string wrapper)
    instead of a second, hand-rolled copy of the same problem -- see
    save_batch_result.py for the established `import save_query_result` pattern."""
    if sqr._looks_like_content_blocks(payload):
        rows = sqr._walk_for_rows(payload)
    else:
        rows = sqr._rows_from_json_value(payload)
    return [r for r in rows if isinstance(r, dict)]


def _fetch_one(row):
    """Download one row's logo. Returns (file_key, dest_bytes, dest_name) on
    success, or None -- every failure mode is a skip, never an exception, since
    this runs inside a thread pool and one bad row must not sink the batch."""
    if not isinstance(row, dict):
        return None
    file_key = col(row, *ID_KEYS)  # corporation_uuid whenever the row has one
    url = col(row, *URL_KEYS)
    if not file_key or not url:
        return None
    file_key = str(file_key)
    if not _UUID_RE.match(file_key):
        print(
            "[fetch_logos] SKIP %r: not a corporation UUID (only corporation_uuid/"
            "corp_uuid can ever match a company downstream)" % file_key,
            file=sys.stderr,
        )
        return None
    if urlparse(url).scheme not in ("http", "https"):
        print("[fetch_logos] SKIP non-http(s) URL for %s" % file_key, file=sys.stderr)
        return None
    try:
        with urllib.request.urlopen(url, timeout=15) as resp:
            data = resp.read(MAX_LOGO_BYTES + 1)
    except Exception as e:  # noqa: BLE001 - best-effort fetch, any failure just skips this logo
        print("[fetch_logos] SKIP %s: %s" % (file_key, e), file=sys.stderr)
        return None
    if not data:
        return None
    if len(data) > MAX_LOGO_BYTES:
        print("[fetch_logos] SKIP %s: exceeds %d bytes" % (file_key, MAX_LOGO_BYTES), file=sys.stderr)
        return None
    ext = _image_ext(data)
    if ext is None:
        print("[fetch_logos] SKIP %s: not a recognizable image" % file_key, file=sys.stderr)
        return None
    return file_key, data, file_key + ext


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("src", help="JSON file: the fa__list__portco_logos tool result")
    ap.add_argument("raw_dir", help="the SKILL's raw_dir; images land in <raw_dir>/logos/")
    a = ap.parse_args()

    with open(a.src, encoding="utf-8") as fh:
        payload = json.load(fh)
    rows = entries_from(payload)
    if not rows:
        print("[fetch_logos] no entries found in %s — nothing to fetch" % a.src, file=sys.stderr)
        return

    out_dir = os.path.join(a.raw_dir, "logos")
    shutil.rmtree(out_dir, ignore_errors=True)  # drop stale files from any prior run
    os.makedirs(out_dir, exist_ok=True)

    fetched, skipped = 0, 0
    with ThreadPoolExecutor(max_workers=min(8, len(rows))) as pool:
        for result in pool.map(_fetch_one, rows):
            if result is None:
                skipped += 1
                continue
            _file_key, data, name = result
            with open(os.path.join(out_dir, name), "wb") as fh:
                fh.write(data)
            fetched += 1

    print("[fetch_logos] %d fetched, %d skipped -> %s" % (fetched, skipped, out_dir))


if __name__ == "__main__":
    main()
