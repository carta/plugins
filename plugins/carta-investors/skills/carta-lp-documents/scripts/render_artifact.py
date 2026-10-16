#!/usr/bin/env -S uv run
# /// script
# requires-python = ">=3.9"
# dependencies = []
# ///
"""Render the LP documents artifact: fill in its config block and page title.

The title is fixed, so a returning LP's publish finds and updates the same page; the
page names the portfolio itself from the documents it loads. Values are escaped here
rather than by the model, so nothing in them can break the page's JS.
"""
from __future__ import annotations

import argparse
import datetime
import html
import json
import re
import sys
from pathlib import Path
from typing import List, Optional

_PLUGIN_ROOT = next(p for p in Path(__file__).resolve().parents if (p / "lib" / "live_artifact_render").is_dir())
sys.path.insert(0, str(_PLUGIN_ROOT / "lib"))

from live_artifact_render import MCP_SERVER_RE, check_path_under_cwd, js_safe_json  # noqa: E402

TEMPLATE = Path(__file__).resolve().parent.parent / "references" / "lp-docs-artifact-template.html"
CONFIG_PLACEHOLDER = "__LP_DOCS_CONFIG__"
TITLE_PLACEHOLDER = "__LP_DOCS_TITLE__"
TITLE = "LP Documents"


def _fail(message: str) -> int:
    print("error: " + message, file=sys.stderr)
    return 1


def main(argv: Optional[List[str]] = None) -> int:
    ap = argparse.ArgumentParser(description="Render the LP documents artifact.")
    ap.add_argument("--mcp-server", required=True, help="Carta connector display name")
    ap.add_argument("--out", required=True, help="output HTML path, under the working directory")
    args = ap.parse_args(argv)

    if not MCP_SERVER_RE.match(args.mcp_server):
        return _fail(
            "--mcp-server must be the connector's display name, free of quotes, "
            "angle brackets and newlines; got: {!r}".format(args.mcp_server)
        )
    out = check_path_under_cwd(Path(args.out), "--out")
    if out is None:
        return 1

    page = TEMPLATE.read_text(encoding="utf-8")
    for placeholder in (CONFIG_PLACEHOLDER, TITLE_PLACEHOLDER):
        if page.count(placeholder) != 1:
            return _fail("template must hold {} exactly once".format(placeholder))

    title = TITLE
    config = {"server": args.mcp_server, "title": title, "generated": datetime.date.today().isoformat()}
    page = page.replace(CONFIG_PLACEHOLDER, js_safe_json(config))
    page = page.replace(TITLE_PLACEHOLDER, html.escape(title))

    leftover = sorted(set(re.findall(r"__(?:LP_DOCS_[A-Z_]+|CARTA_MCP_SERVER)__|TEMPLATE_[A-Z_]+", page)))
    if leftover:
        return _fail("{} still present after substitution".format(", ".join(leftover)))
    if re.search(r"<script[^>]+src=", page, re.IGNORECASE):
        return _fail("an external script survived; it would be CSP-blocked at runtime")

    out.write_text(page, encoding="utf-8")
    print(json.dumps({"out": str(out), "title": title}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
