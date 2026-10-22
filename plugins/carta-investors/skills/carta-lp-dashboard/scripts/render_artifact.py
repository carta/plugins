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
from typing import List, Optional, Tuple

_PLUGIN_ROOT = next(p for p in Path(__file__).resolve().parents if (p / "lib" / "live_artifact_render").is_dir())
sys.path.insert(0, str(_PLUGIN_ROOT / "lib"))

from live_artifact_render import (  # noqa: E402
    LP_DOCS_CONFIG_PLACEHOLDER,
    MCP_SERVER_RE,
    UUID_RE,
    check_path_under_cwd,
    js_safe_json,
    lp_docs_config,
)

TEMPLATE = Path(__file__).resolve().parent.parent / "references" / "artifact_template.html"
CHART_JS = _PLUGIN_ROOT / "vendor" / "chart.umd.min.js"
CHART_MARKER = re.compile(r"/\*\s*__LP_DASHBOARD_CHART_JS__\s*\*/")
# The template's tab buttons are the one list of tabs; the first is the default.
TABS = tuple(re.findall(r'id="tab-(\w+)"', TEMPLATE.read_text(encoding="utf-8")))
DOCS_TEMPLATE = _PLUGIN_ROOT / "skills" / "carta-lp-documents" / "references" / "lp-docs-artifact-template.html"
DOCS_MARKUP_MARKER = "<!-- __LP_DOCS_TEMPLATE__ -->"
DOCS_SCRIPT_MARKER = "/* __LP_DOCS_SCRIPT__ */"
# How the LP Documents page's script ends: starting its first load.
DOCS_START = "fetchDocuments();"
PLACEHOLDERS = (
    "__CARTA_MCP_SERVER__", "__PORTFOLIO_ID__", "__OPEN_TAB__", "__LP_DASHBOARD_CHART_JS__",
    "__LP_DOCS_TEMPLATE__", "__LP_DOCS_SCRIPT__", LP_DOCS_CONFIG_PLACEHOLDER,
)


def documents_tab(mcp_server: str) -> Tuple[str, str]:
    """The LP Documents page split for the Documents tab: its styles, markup and config for
    the shadow root, and its script as the body of a function that returns its first load.

    Its inline handlers resolve on window, so the function puts exactly those back there.
    """
    page = DOCS_TEMPLATE.read_text(encoding="utf-8")
    style = re.search(r"<style>(.*?)</style>", page, re.S).group(1)
    # Anchored to whole lines: the page's own comments may mention <body>. The cut ends
    # after the page's own config line, which keeps its placeholder.
    markup = re.search(r"^<body>\n(.*?^<script type=\"application/json\"[^\n]*\n)", page, re.S | re.M).group(1)
    markup = markup.replace(LP_DOCS_CONFIG_PLACEHOLDER, js_safe_json(lp_docs_config(mcp_server, "Documents")))
    script = re.findall(r"<script>(.*?)</script>", page, re.S)[-1].rstrip()
    if not script.endswith(DOCS_START):
        raise ValueError("the documents script no longer ends by starting its load")
    handlers = sorted(set(re.findall(r"on(?:click|input|change)=\\?\"([A-Za-z_]\w*)\(", page)))
    body = (script[: -len(DOCS_START)]
            + "Object.assign(window, { " + ", ".join(handlers) + " });\nreturn " + DOCS_START)
    return "<style>" + style + "</style>" + markup, body


def _fail(message: str) -> int:
    print("error: " + message, file=sys.stderr)
    return 1


def main(argv: Optional[List[str]] = None) -> int:
    ap = argparse.ArgumentParser(description="Render the LP dashboard artifact.")
    ap.add_argument("--mcp-server", required=True, help="Carta connector display name")
    ap.add_argument("--portfolio-id", help="portfolio UUID; without it the page opens the login's largest portfolio")
    ap.add_argument("--tab", choices=TABS, default=TABS[0], help="the tab the page opens on")
    ap.add_argument("--out", required=True, help="output HTML path, under the working directory")
    args = ap.parse_args(argv)

    if not MCP_SERVER_RE.match(args.mcp_server):
        return _fail(
            "--mcp-server must be the connector's display name, free of quotes, "
            "angle brackets and newlines; got: {!r}".format(args.mcp_server)
        )
    if args.portfolio_id is not None and not UUID_RE.match(args.portfolio_id):
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
    html = html.replace("__OPEN_TAB__", js_safe_json(args.tab))
    html = CHART_MARKER.sub(lambda _m: CHART_JS.read_text(encoding="utf-8"), html, count=1)
    for marker in (DOCS_MARKUP_MARKER, DOCS_SCRIPT_MARKER):
        if html.count(marker) != 1:
            return _fail("template must hold {} exactly once".format(marker))
    try:
        docs_markup, docs_script = documents_tab(args.mcp_server)
    except (AttributeError, ValueError) as error:
        return _fail("the LP Documents page cannot be embedded: {}".format(error))
    html = html.replace(DOCS_MARKUP_MARKER, docs_markup).replace(DOCS_SCRIPT_MARKER, docs_script)

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
