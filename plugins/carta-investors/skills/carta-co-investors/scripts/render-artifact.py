# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///
"""Render the co-investor Live Artifact for one firm.

long-comment-ok: positional-argument contract for a CLI entry point
Usage:
    uv run render-artifact.py <output> <artifact_id> <mcp_server> \\
        <firm_uuid> <firm_name> <firm_carta_id> <base_url> [vehicles_file]
"""

import html
import json
import re
import sys
from pathlib import Path

TEMPLATE = Path(__file__).resolve().parent.parent / "references" / "artifact.html"
CANONICAL = Path(__file__).resolve().parent.parent / "canonical-investors.json"

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
    """Resolve p, or return None if it escapes CWD or lands in /tmp.

    A prompt-injected LLM could pass an arbitrary path; this is the enforcement.
    """
    resolved = p.resolve()
    if not resolved.is_relative_to(Path.cwd().resolve()):
        print(f"error: {label} must be under the current working directory: {resolved}", file=sys.stderr)
        return None
    if resolved.is_relative_to(Path("/tmp").resolve()):
        print(f"error: {label} must not be under /tmp: {resolved}", file=sys.stderr)
        return None
    return resolved


def load_vehicle_names(path: Path):
    """Read the firm's own vehicle names, or return None on error."""
    if not path.is_file():
        print(f"error: vehicles_file not found or not a regular file: {path}", file=sys.stderr)
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        print(f"error: vehicles_file is not valid JSON: {e}", file=sys.stderr)
        return None
    if not isinstance(data, list):
        print(f"error: vehicles_file must contain a JSON array, got {type(data).__name__}", file=sys.stderr)
        return None
    for i, name in enumerate(data):
        if not isinstance(name, str) or not name.strip():
            print(f"error: vehicle name #{i} must be a non-empty string, got {name!r}", file=sys.stderr)
            return None
    return [n.strip() for n in data]


def load_canonical_groupings():
    """Read the groupings the page uses to collapse one firm's many vehicles.

    Embedding these is what removes the old step where the agent hand-assembled a
    SQL CASE from this file and a dropped WHEN split one firm into several rows.
    """
    if not CANONICAL.is_file():
        print(f"error: canonical-investors.json not found at {CANONICAL}", file=sys.stderr)
        return None
    try:
        data = json.loads(CANONICAL.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        print(f"error: canonical-investors.json is not valid JSON: {e}", file=sys.stderr)
        return None
    groupings = data.get("groupings") if isinstance(data, dict) else None
    if not isinstance(groupings, list) or not groupings:
        print("error: canonical-investors.json must hold a non-empty 'groupings' list", file=sys.stderr)
        return None
    for i, g in enumerate(groupings):
        if not isinstance(g, dict) or not isinstance(g.get("canonical"), str):
            print(f"error: grouping #{i} is missing a string 'canonical'", file=sys.stderr)
            return None
        patterns = g.get("patterns")
        if not isinstance(patterns, list) or not all(isinstance(p, str) for p in patterns):
            print(f"error: grouping #{i} 'patterns' must be a list of strings", file=sys.stderr)
            return None
    return groupings


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
    if len(sys.argv) not in (8, 9):
        print(
            "usage: render-artifact.py <output> <artifact_id> <mcp_server> "
            "<firm_uuid> <firm_name> <firm_carta_id> <base_url> [vehicles_file]",
            file=sys.stderr,
        )
        return 2

    output, artifact_id, mcp_server, firm_uuid, firm_name, firm_carta_id, base_url = sys.argv[1:8]
    vehicles_file = sys.argv[8] if len(sys.argv) == 9 else None

    if not validate_args(artifact_id, mcp_server, firm_uuid, firm_name, firm_carta_id, base_url):
        return 1

    out_path = check_path_under_cwd(Path(output), "output path")
    if out_path is None:
        return 1

    # The firm's own name always matches; the file only adds vehicles named
    # differently from it.
    vehicle_names = [firm_name.strip()]
    if vehicles_file is None:
        # The firm name alone rarely matches its funds ("Acme Ventures" vs "Acme
        # Fund VI, LP"), so without this list the firm tops its own report.
        print(
            "warning: no vehicles_file — only the firm name will be excluded from "
            "the co-investor list. Pass every fa:list:entities name.",
            file=sys.stderr,
        )
    else:
        vehicles_path = check_path_under_cwd(Path(vehicles_file), "vehicles_file path")
        if vehicles_path is None:
            return 1
        extra = load_vehicle_names(vehicles_path)
        if extra is None:
            return 1
        vehicle_names.extend(n for n in extra if n not in vehicle_names)

    groupings = load_canonical_groupings()
    if groupings is None:
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
        "canonical_groupings": groupings,
        "firm_vehicle_names": vehicle_names,
    }

    content = content.replace("{{STATE_JSON}}", js_safe_json(state_obj))
    content = content.replace("{{TITLE}}", html.escape(f"{firm_name} — Co-Investor Analysis"))
    content = content.replace("{{FIRM_UUID}}", firm_uuid)
    content = content.replace("{{CARTA_MCP_SERVER}}", mcp_server)

    out_path.write_text(content, encoding="utf-8")
    print(out_path)
    return 0


if __name__ == "__main__":
    sys.exit(main())
