# /// script
# requires-python = ">=3.9"
# ///
"""Build the Carta Audit Home page: stamp the Carta connector's name into the template."""
import argparse
import json
import re
import sys
from pathlib import Path

TEMPLATE = Path(__file__).resolve().parent.parent / "resources" / "audit-home.template.html"
SERVER_TOKEN = "{{CARTA_MCP_SERVER}}"


def build(server: str) -> str:
    server = server.strip()
    if not server or any(c in server for c in "\r\n"):
        raise ValueError("--mcp-server must be the connector's name on one line")
    html = TEMPLATE.read_text(encoding="utf-8")
    if html.count(SERVER_TOKEN) != 1:
        raise ValueError(f"template must hold {SERVER_TOKEN} exactly once")
    # The token sits inside a JS string literal, so escape the name the way JSON would.
    html = html.replace(SERVER_TOKEN, json.dumps(server)[1:-1])
    leftover = re.findall(r"\{\{[A-Z_]+\}\}", html)
    if leftover:
        raise ValueError(f"unreplaced placeholders: {sorted(set(leftover))}")
    return html


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mcp-server", required=True, help="the Carta connector's name, e.g. Carta")
    parser.add_argument("--out", required=True, help="where to write the built page")
    args = parser.parse_args(argv)
    try:
        html = build(args.mcp_server)
    except ValueError as err:
        print(f"error: {err}", file=sys.stderr)
        return 1
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(html, encoding="utf-8")
    print(out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
