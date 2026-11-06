# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///
"""
render-artifact.py — render the firm's Portfolio Ownership Live Artifact.

The skill lists the firm's funds and SPVs, writes them to a JSON file, and calls this
script with its path. The script embeds that list, the ownership query
(references/ownership.sql, the same text the skill's chat answers run) and the opening
as-of date into references/artifact.html, and writes the page. The page runs the query
itself on load and whenever the viewer picks another date.

Usage:
    uv run render-artifact.py <output> <artifact_id> <mcp_server> <firm_uuid> \\
        <firm_name> <funds_file> [--as-of YYYY-MM-DD]

<funds_file> holds a non-empty JSON array of {"uuid", "name"} objects, each optionally
with "fund_family_name" and "vintage_date" (YYYY-MM-DD). It is a file rather than an
argument because fund names carry apostrophes that shell quoting mangles.

--as-of opens the page on a past date. Without it the page opens on the viewer's today,
computed in the browser, so a page published one day still opens on the current date.

Output and funds file must sit under the working directory: the skill says so too, but
this check is the enforcement. On success the absolute output path is printed.
"""

import datetime
import html
import json
import re
import sys
from pathlib import Path

_LIB = next(p for p in Path(__file__).resolve().parents if (p / "lib" / "live_artifact_render").is_dir()) / "lib"
sys.path.insert(0, str(_LIB))

from live_artifact_render import (  # noqa: E402
    ARTIFACT_ID_RE,
    MCP_SERVER_RE,
    UUID_RE,
    check_path_under_cwd,
    fill_placeholders,
    inline_tracker,
    js_safe_json,
)

SKILL = "carta-portfolio-ownership"
REFERENCES = Path(__file__).resolve().parent.parent / "references"
TEMPLATE = REFERENCES / "artifact.html"
OWNERSHIP_SQL = REFERENCES / "ownership.sql"

PLACEHOLDERS = ("{{STATE_JSON}}", "{{CARTA_MCP_SERVER}}", "{{FIRM_NAME}}", "{{FIRM_UUID}}")
# The page substitutes these into the query at run time; a template without them would
# silently query every fund on the warehouse's default date.
SQL_PARAMS = ("<FUND_UUIDS>", "<AS_OF_DATE>")

DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
USAGE = (
    "usage: render-artifact.py <output> <artifact_id> <mcp_server> <firm_uuid> "
    "<firm_name> <funds_file> [--as-of YYYY-MM-DD]"
)


def fail(message: str) -> int:
    print(f"error: {message}", file=sys.stderr)
    return 1


def parse_as_of(value: str) -> "str | None":
    """Return value when it is a real calendar date no later than today, else None."""
    if not DATE_RE.match(value):
        return None
    try:
        day = datetime.date.fromisoformat(value)
    except ValueError:
        return None
    return value if day <= datetime.date.today() else None


def funds_error(data: object) -> "str | None":
    """Describe what is wrong with the funds list, or None when it is usable."""
    if not isinstance(data, list) or not data:
        return "funds_file must hold a non-empty JSON array"
    allowed = {"uuid", "name", "fund_family_name", "vintage_date"}
    for i, entry in enumerate(data):
        if not isinstance(entry, dict):
            return f"fund entry #{i} is not an object"
        extra = entry.keys() - allowed
        if extra:
            return f"fund entry #{i} has unexpected keys {sorted(extra)}"
        if not isinstance(entry.get("uuid"), str) or not UUID_RE.match(entry["uuid"]):
            return f"fund entry #{i} has an invalid uuid: {entry.get('uuid')!r}"
        if not isinstance(entry.get("name"), str) or not entry["name"]:
            return f"fund entry #{i} has an invalid name: {entry.get('name')!r}"
        family = entry.get("fund_family_name")
        if family is not None and (not isinstance(family, str) or not family):
            return f"fund entry #{i} has an invalid fund_family_name: {family!r}"
        vintage = entry.get("vintage_date")
        if vintage is not None and (not isinstance(vintage, str) or not DATE_RE.match(vintage)):
            return f"fund entry #{i} has an invalid vintage_date (want YYYY-MM-DD): {vintage!r}"
    return None


def main() -> int:
    args = sys.argv[1:]
    initial_as_of = ""
    if len(args) == 8 and args[6] == "--as-of":
        initial_as_of = parse_as_of(args[7]) or ""
        if not initial_as_of:
            return fail(f"--as-of must be a past or current date as YYYY-MM-DD; got {args[7]!r}")
        args = args[:6]
    if len(args) != 6:
        print(USAGE, file=sys.stderr)
        return 2

    output, artifact_id, mcp_server, firm_uuid, firm_name, funds_file = args

    if not UUID_RE.match(firm_uuid):
        return fail(f"firm_uuid is not a valid UUID: {firm_uuid!r}")
    if not MCP_SERVER_RE.match(mcp_server):
        return fail(
            "mcp_server must be the Carta connector's display name, free of quotes, "
            f"angle brackets and newlines; got {mcp_server!r}"
        )
    if not ARTIFACT_ID_RE.match(artifact_id):
        return fail(f"artifact_id is not a valid kebab-case slug: {artifact_id!r}")
    if not firm_name.strip():
        return fail("firm_name is empty")

    out_path = check_path_under_cwd(Path(output), "output path")
    if out_path is None:
        return 1
    funds_path = check_path_under_cwd(Path(funds_file), "funds_file path")
    if funds_path is None:
        return 1
    if not funds_path.is_file():
        return fail(f"funds_file not found: {funds_path}")
    try:
        funds = json.loads(funds_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        return fail(f"funds_file is not valid JSON: {e}")
    problem = funds_error(funds)
    if problem:
        return fail(problem)

    sql = OWNERSHIP_SQL.read_text(encoding="utf-8")
    missing_params = [p for p in SQL_PARAMS if p not in sql]
    if missing_params:
        return fail(f"ownership.sql is missing parameters {missing_params}")

    content = inline_tracker(TEMPLATE.read_text(encoding="utf-8"), SKILL)
    missing = [p for p in PLACEHOLDERS if p not in content]
    if missing:
        return fail(f"template missing required placeholders: {missing}")

    state = {
        "firm_uuid": firm_uuid,
        "firm_name": firm_name,
        "artifact_id": artifact_id,
        "funds": funds,
        "ownership_sql": sql,
        "initial_as_of": initial_as_of,
    }
    values = {
        "{{STATE_JSON}}": js_safe_json(state),
        "{{CARTA_MCP_SERVER}}": mcp_server,
        "{{FIRM_UUID}}": firm_uuid,
        "{{FIRM_NAME}}": html.escape(firm_name),
    }
    content = fill_placeholders(content, values)

    out_path.write_text(content, encoding="utf-8")
    print(out_path)
    return 0


if __name__ == "__main__":
    sys.exit(main())
