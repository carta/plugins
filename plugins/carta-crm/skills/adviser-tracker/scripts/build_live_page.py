#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///
"""Write the live Adviser Tracker page: the same page as the skeleton, loading its data from Carta when it opens."""
from __future__ import annotations

import argparse
import html
import re
import sys
from pathlib import Path

ASSETS = Path(__file__).resolve().parent.parent / "assets"

TITLE_SLOT = "<title>Adviser Tracker</title>"
# One title for every tracker artifact, so a republish finds its artifact and replaces it.
PAGE_TITLE = "M&A Adviser Tracker"
DEFAULT_CONNECTOR = "Carta"

_DATA_TAG = re.compile(r'(<script type="application/json" id="tracker-data">)(.*?)(</script>)', re.S)
# The page script reads its data once at the top and ends with one render call. The live page hands it the data later.
_SCRIPT_HEAD = "(function () {\n  var all = JSON.parse(document.getElementById('tracker-data').textContent);"
_SCRIPT_TAIL = "  render();\n})();\n</script>"

_STATUS_STYLE = """<style>
#live-status { position: fixed; inset: 0; z-index: 100; display: flex; align-items: center; justify-content: center; background: #fff; font-family: system-ui, sans-serif; color: #1f2937; text-align: center; }
#live-status[hidden], #live-refresh[hidden] { display: none; }
#live-status h1 { font-size: 20px; margin: 0 0 8px; }
#live-status p { margin: 0 0 16px; max-width: 420px; color: #4b5563; }
#live-status button, #live-refresh button { font: inherit; padding: 6px 14px; border: 1px solid #d1d5db; border-radius: 6px; background: #fff; cursor: pointer; }
#live-refresh { position: fixed; right: 12px; bottom: 12px; z-index: 50; padding: 6px 10px; border-radius: 8px; background: rgba(255,255,255,.92); border: 1px solid #e5e7eb; font: 12px system-ui, sans-serif; color: #4b5563; }
</style>
<div id="live-status">Loading your adviser tracker</div>
<div id="live-refresh" hidden></div>
"""


def fail(code: str, message: str) -> "SystemExit":
    return SystemExit(f"{code}: {message}")


def render(connector: str, organization: str) -> str:
    skeleton = (ASSETS / "skeleton.html").read_text(encoding="utf-8")
    if len(_DATA_TAG.findall(skeleton)) != 1 or TITLE_SLOT not in skeleton or skeleton.count(_SCRIPT_HEAD) != 1 or skeleton.count(_SCRIPT_TAIL) != 1:
        raise fail("template_invalid", "the skeleton lacks its data element, its title or the page script frame")
    page_data = (ASSETS / "page-data.js").read_text(encoding="utf-8")
    loader = (ASSETS / "live-loader.js").read_text(encoding="utf-8")

    page = _DATA_TAG.sub(lambda m: m.group(1) + "{}" + m.group(3), skeleton)
    page = page.replace(_SCRIPT_HEAD, "window.__startTracker = function (all) {")
    page = page.replace(_SCRIPT_TAIL, "  render();\n};\n</script>\n<script>\n" + page_data + "\n</script>\n<script>\n" + loader + "\n</script>")
    title = f"{PAGE_TITLE} - {organization}" if organization else PAGE_TITLE
    meta = f'<meta name="carta-connector" content="{html.escape(connector, quote=True)}">\n'
    page = page.replace(TITLE_SLOT, meta + f"<title>{html.escape(title)}</title>")
    return page.replace("<body>", "<body>\n" + _STATUS_STYLE, 1)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--connector", default=DEFAULT_CONNECTOR, help="the display name of the Carta connector the page reads through")
    parser.add_argument("--organization", default="", help="the organization the title names")
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args(argv)

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(render(args.connector.strip() or DEFAULT_CONNECTOR, args.organization.strip()), encoding="utf-8")
    print(f"wrote {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
