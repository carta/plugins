#!/usr/bin/env -S uv run
# /// script
# requires-python = ">=3.9"
# dependencies = []
# ///
"""Render the LP dashboard artifact: substitute its two values and inline Chart.js.

Chart.js is inlined because the runtime CSP forbids external scripts; a CDN link
blocks silently and every chart stays blank. Running it here also keeps the
template and the chart bundle out of the model's context.
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path
from typing import List, Optional

_PLUGIN_ROOT = next(p for p in Path(__file__).resolve().parents if (p / "lib" / "live_artifact_render").is_dir())
sys.path.insert(0, str(_PLUGIN_ROOT / "lib"))

from live_artifact_render import MCP_SERVER_RE, UUID_RE, check_path_under_cwd, js_safe_json  # noqa: E402

TEMPLATE = Path(__file__).resolve().parent.parent / "references" / "artifact_template.html"
CHART_JS = _PLUGIN_ROOT / "vendor" / "chart.umd.min.js"
CHART_MARKER = re.compile(r"/\*\s*__LP_DASHBOARD_CHART_JS__\s*\*/")
PLACEHOLDERS = ("__CARTA_MCP_SERVER__", "__PORTFOLIO_ID__", "__LP_DASHBOARD_CHART_JS__")


def _fail(message: str) -> int:
    print("error: " + message, file=sys.stderr)
    return 1


def main(argv: Optional[List[str]] = None) -> int:
    ap = argparse.ArgumentParser(description="Render the LP dashboard artifact.")
    ap.add_argument("--mcp-server", required=True, help="Carta connector display name")
    ap.add_argument("--portfolio-id", required=True, help="portfolio UUID")
    ap.add_argument("--out", required=True, help="output HTML path, under the working directory")
    args = ap.parse_args(argv)

    if not MCP_SERVER_RE.match(args.mcp_server):
        return _fail(
            "--mcp-server must be the connector's display name, free of quotes, "
            "angle brackets and newlines; got: {!r}".format(args.mcp_server)
        )
    if not UUID_RE.match(args.portfolio_id):
        return _fail("--portfolio-id is not a UUID: {!r}".format(args.portfolio_id))
    out = check_path_under_cwd(Path(args.out), "--out")
    if out is None:
        return 1
    if not CHART_JS.is_file():
        return _fail("Chart.js bundle not found at {}".format(CHART_JS))

    html = TEMPLATE.read_text(encoding="utf-8")
    if not CHART_MARKER.search(html):
        return _fail("template has no __LP_DASHBOARD_CHART_JS__ marker; every chart would stay blank")

    # Placeholders sit bare in the template (`const X = __X__;`), so the JSON literal
    # supplies the quotes — an apostrophe in a value can never close the string.
    html = html.replace("__CARTA_MCP_SERVER__", js_safe_json(args.mcp_server))
    html = html.replace("__PORTFOLIO_ID__", js_safe_json(args.portfolio_id))
    html = CHART_MARKER.sub(lambda _m: CHART_JS.read_text(encoding="utf-8"), html, count=1)

    leftover = [p for p in PLACEHOLDERS if p in html]
    if leftover:
        return _fail("{} still present after substitution".format(", ".join(leftover)))
    if re.search(r"<script[^>]+src=", html, re.IGNORECASE):
        return _fail("an external script survived; it would be CSP-blocked at runtime")

    out.write_text(html, encoding="utf-8")
    print(out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
