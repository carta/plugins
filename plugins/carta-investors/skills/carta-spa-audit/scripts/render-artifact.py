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
import json
import re
import sys
from pathlib import Path

TEMPLATE = Path(__file__).resolve().parent.parent / "references" / "artifact.html"

PLACEHOLDERS = (
    "{{TITLE}}",
    "{{STATE_JSON}}",
    "{{FIRM_UUID}}",
    "{{CARTA_MCP_SERVER}}",
)

UUID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
    re.IGNORECASE,
)
# Connector display names are viewer-facing text, so reject only what would escape
# the JS string literal they land in.
MCP_SERVER_RE = re.compile(r"^[^\r\n\'\"<>\\]{1,120}$")
ARTIFACT_ID_RE = re.compile(r"^[a-z0-9][a-z0-9-]*[a-z0-9]$")
CARTA_ID_RE = re.compile(r"^[0-9]{1,19}$")
# The page concatenates this into an href, so a quote or javascript: scheme would
# land inside the link. Require a plain https origin.
BASE_URL_RE = re.compile(r"^https://[A-Za-z0-9.\-]+(:[0-9]{1,5})?$")


def js_safe_json(obj) -> str:
    """JSON-encode for embedding in a <script> block.

    A <script type="application/json"> block closes on the first </script> in its
    content, so an unescaped name could close the block early and leak its tail.
    """
    return (
        json.dumps(obj, ensure_ascii=False)
        .replace("<", "\\u003c")
        .replace(">", "\\u003e")
        .replace("&", "\\u0026")
        .replace("'", "\\u0027")
    )


def check_path_under_cwd(p: Path, label: str):
    """Resolve p, or return None if it escapes CWD.

    A prompt-injected LLM could pass an arbitrary path; this is the enforcement.
    """
    resolved = p.resolve()
    if not resolved.is_relative_to(Path.cwd().resolve()):
        print(f"error: {label} must be under the current working directory: {resolved}", file=sys.stderr)
        return None
    return resolved


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
