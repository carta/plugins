# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///
"""Render the SPA-audit Live Artifact for one firm.

long-comment-ok: positional-argument contract for a CLI entry point
Usage:
    uv run render-artifact.py <output> <artifact_id> <mcp_server> \\
        <firm_uuid> <firm_name> <firm_carta_id> <base_url>
"""

import html
import re
import sys
from pathlib import Path

_LIB = next(p for p in Path(__file__).resolve().parents if (p / "lib" / "live_artifact_render").is_dir()) / "lib"
sys.path.insert(0, str(_LIB))

from live_artifact_render import (  # noqa: E402
    ARTIFACT_ID_RE,
    BASE_URL_RE,
    CARTA_ID_RE,
    MCP_SERVER_RE,
    UUID_RE,
    check_path_under_cwd,
    js_safe_json,
)

TEMPLATE = Path(__file__).resolve().parent.parent / "references" / "artifact.html"

PLACEHOLDERS = (
    "{{TITLE}}",
    "{{STATE_JSON}}",
    "{{FIRM_UUID}}",
    "{{CARTA_MCP_SERVER}}",
)


def validate_args(artifact_id, mcp_server, firm_uuid, firm_name, firm_carta_id, base_url) -> bool:
    checks = (
        (UUID_RE.match(firm_uuid), f"firm_uuid is not a valid UUID: {firm_uuid!r}"),
        (MCP_SERVER_RE.match(mcp_server),
         f"mcp_server must be the Carta connector's display name — non-empty and free "
         f"of quotes, angle brackets and newlines; got: {mcp_server!r}"),
        (ARTIFACT_ID_RE.match(artifact_id), f"artifact_id is not a valid kebab-case slug: {artifact_id!r}"),
        (CARTA_ID_RE.match(firm_carta_id),
         f"firm_carta_id must be the numeric organization pk (digits only); got: {firm_carta_id!r}"),
        (BASE_URL_RE.match(base_url),
         f"base_url must be a plain https origin with no path (e.g. https://app.carta.com); "
         f"got: {base_url!r}"),
        (firm_name.strip(), "firm_name must be non-empty"),
    )
    for ok, message in checks:
        if not ok:
            print(f"error: {message}", file=sys.stderr)
            return False
    return True


def main() -> int:
    if len(sys.argv) != 8:
        print(
            "usage: render-artifact.py <output> <artifact_id> <mcp_server> "
            "<firm_uuid> <firm_name> <firm_carta_id> <base_url>",
            file=sys.stderr,
        )
        return 2

    output, artifact_id, mcp_server, firm_uuid, firm_name, firm_carta_id, base_url = sys.argv[1:8]

    if not validate_args(artifact_id, mcp_server, firm_uuid, firm_name, firm_carta_id, base_url):
        return 1

    out_path = check_path_under_cwd(Path(output), "output path")
    if out_path is None:
        return 1

    if not TEMPLATE.is_file():
        print(f"error: template artifact.html not found at {TEMPLATE}", file=sys.stderr)
        return 1

    content = TEMPLATE.read_text(encoding="utf-8")
    missing = [p for p in PLACEHOLDERS if p not in content]
    if missing:
        print(f"error: template missing required placeholders: {missing}", file=sys.stderr)
        return 1

    state_obj = {
        "firm_name": firm_name,
        "firm_carta_id": firm_carta_id,
        "base_url": base_url,
    }

    replacements = {
        "{{STATE_JSON}}": js_safe_json(state_obj),
        "{{TITLE}}": html.escape(f"{firm_name} — SPA coverage audit"),
        "{{FIRM_UUID}}": firm_uuid,
        "{{CARTA_MCP_SERVER}}": mcp_server,
    }
    # Single pass over the original text: a value (e.g. firm_name) can contain
    # placeholder-shaped text without being re-scanned by a later substitution.
    placeholder_pattern = re.compile("|".join(re.escape(p) for p in PLACEHOLDERS))
    content = placeholder_pattern.sub(lambda m: replacements[m.group(0)], content)

    out_path.write_text(content, encoding="utf-8")
    print(out_path)
    return 0


if __name__ == "__main__":
    sys.exit(main())
