#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///
"""Stamp the CRM Home page fetched from Carta, ready to publish."""
from __future__ import annotations

import argparse
import html
import json
import re
import sys
from pathlib import Path

# artifact-boot.ts reads this to learn which connector to call. A wrong name fails every card.
CONNECTOR_META = "carta-connector"

# The bundle this copy came from. The page compares it against the manifest's `viewBuildId`
# and tells the reader to rebuild when the two disagree.
BUILD_META = "carta-home-build"

# The manifest tool the page fetches for itself. Its absence means this is not the Home.
HOME_TOOL = "get_crm_home"

# crm-api builds the page from its own entry so these never ship. Checked anyway, because
# publishing puts the result behind a stable URL that anyone given it can open.
FORBIDDEN = ("DEMO_DATA", "renderAdviserProfile", "renderSearchList")

_TITLE = re.compile(r"<title>.*?</title>", re.IGNORECASE | re.DOTALL)
_HEAD_OPEN = re.compile(r"<head[^>]*>", re.IGNORECASE)


def _meta_tag(name: str) -> re.Pattern[str]:
    return re.compile(rf'<meta\s+name="{name}"[^>]*>', re.IGNORECASE)


def page_html(raw: str) -> str:
    """The page, from either a `read_resource` result or a plain HTML file.

    A large resource read is saved to a file rather than returned inline, so the path handed
    to this script usually holds the JSON envelope and not the page.
    """
    stripped = raw.lstrip()
    if not stripped.startswith("{"):
        return raw
    try:
        contents = json.loads(stripped)["contents"]
        if not contents:
            raise SystemExit("resource_empty: the read returned no contents")
        return contents[0]["text"]
    except (ValueError, KeyError, IndexError, TypeError) as error:
        raise SystemExit(f"resource_unreadable: {error}") from error


def _write_meta(page: str, name: str, value: str) -> str:
    """Set one meta tag, replacing any tag of that name already there.

    Replacing rather than appending is what makes re-stamping a published page safe: two tags
    of one name would leave the page choosing between them.
    """
    tag = f'<meta name="{name}" content="{html.escape(value, quote=True)}">'
    existing = _meta_tag(name)
    if existing.search(page):
        return existing.sub(tag, page, count=1)
    head = _HEAD_OPEN.search(page)
    if not head:
        raise SystemExit("no_head: the page has no <head> to stamp")
    return page[: head.end()] + "\n    " + tag + page[head.end() :]


def stamp(page: str, connector: str, organization: str, build_id: str | None = None) -> str:
    """Write the connector, the build id and the title into the page."""
    if HOME_TOOL not in page:
        raise SystemExit(f"not_the_home: the page never calls {HOME_TOOL}")
    for marker in FORBIDDEN:
        if marker in page:
            raise SystemExit(f"wrong_bundle: the page carries {marker}, so it is not Home-only")

    page = _write_meta(page, CONNECTOR_META, connector)
    # Absent against an unversioned server. The page then says nothing about being behind,
    # which is the right answer when there is no id to compare.
    if build_id:
        page = _write_meta(page, BUILD_META, build_id)

    title = f"<title>Carta CRM Home - {html.escape(organization)}</title>"
    if not _TITLE.search(page):
        raise SystemExit("no_title: the page has no <title> for the artifact name")
    return _TITLE.sub(title, page, count=1)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--resource", required=True, help="read_resource output, or an HTML file")
    parser.add_argument("--connector", required=True, help="the Carta connector's display name")
    parser.add_argument("--organization", required=True, help="names the published artifact")
    parser.add_argument("--out", required=True, help="where to write the page to publish")
    parser.add_argument(
        "--build-id",
        help="the manifest's viewBuildId; without it the page carries no staleness notice",
    )
    args = parser.parse_args()

    raw = Path(args.resource).read_text(encoding="utf-8")
    page = stamp(page_html(raw), args.connector, args.organization, args.build_id)
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(page, encoding="utf-8")

    print(f"wrote {out} ({len(page):,} bytes)")
    print(f"  connector: {args.connector}")
    print(f"  title:     Carta CRM Home - {args.organization}")
    print(f"  build:     {args.build_id or 'unversioned — no staleness banner'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
