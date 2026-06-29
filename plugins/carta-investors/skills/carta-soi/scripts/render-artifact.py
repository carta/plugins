# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///
"""
render-artifact.py — render the firm-level SOI Live Artifact with the firm's
full fund list embedded for the dropdown.

Every invocation rebuilds the artifact from scratch. The skill enumerates the
firm's funds via fa:list:entities, writes them to a JSON file, and calls this
script with the file path. There is no prior-state recovery, no merge, and no
state persisted outside the rendered HTML.

Doing the substitution in a script (rather than asking the LLM to Read → modify
→ Write the ~30KB template) keeps byte-level work off the model token path,
cutting tokens and latency.

Usage:
    uv run render-artifact.py <template> <output> <artifact_id> \\
        <mcp_tool> <firm_uuid> <firm_name> <funds_file> <initial_fund_uuid>

<funds_file> is a path to a JSON file whose contents are a non-empty list of
{"uuid": "...", "name": "...", "currency": "..."} dicts (currency is optional). It is a path (not a positional JSON
string) because legitimate fund names contain apostrophes ("O'Reilly Capital",
"St. James's Place Holdings"), JSON does not escape ', and shell single-quoting
needed to preserve JSON's embedded double quotes terminates on the first '.
The tempfile bridge eliminates that hazard.

Embedded state block (in the rendered HTML, consumed at runtime by artifact.html):
    <script type="application/json" id="soi-funds-state">
    {"firm_uuid": "...", "firm_name": "...", "funds": [{"uuid": "...", "name": "...", "currency": "..."}]}
    </script>

On success, one line is printed to stdout: the absolute output path. The
calling skill no longer needs a verb signal — it attempts
mcp__cowork__create_artifact, falling back to mcp__cowork__update_artifact on
"already exists".

Output path and funds-file path are constrained to live under CWD and not under
/tmp. SKILL.md says the same thing in prose, but a prompt-injected LLM could
pass an arbitrary path; the bounds checks are the actual enforcement.
"""

import html
import json
import re
import sys
from pathlib import Path

PLACEHOLDERS = (
    "{{FUNDS_JSON}}",
    "{{INITIAL_FUND_UUID}}",
    "{{MCP_TOOL_NAME}}",
    "{{FIRM_NAME}}",
    "{{FIRM_UUID}}",
)

UUID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
    re.IGNORECASE,
)
MCP_TOOL_RE = re.compile(r"^mcp__[a-z0-9_-]+__[a-z_]+$", re.IGNORECASE)
ARTIFACT_ID_RE = re.compile(r"^[a-z0-9][a-z0-9-]*[a-z0-9]$")


def js_safe_json(obj) -> str:
    """JSON-encode for embedding inside a <script> block.

    Even a <script type="application/json"> block is closed by the FIRST
    </script> in its content, so a fund name containing </script> would close
    our state block early and leak its tail. Escape `<`, `>`, `&`, `'` to
    their \\uXXXX form — still valid JSON, no longer hostile in HTML.
    """
    return (
        json.dumps(obj, ensure_ascii=False)
        .replace("<", "\\u003c")
        .replace(">", "\\u003e")
        .replace("&", "\\u0026")
        .replace("'", "\\u0027")
    )


def check_path_under_cwd(p: Path, label: str) -> "Path | None":
    """Return the resolved path if it lives under CWD and not under /tmp;
    otherwise print an error and return None. Used for both <output> and
    <funds_file> — the same bounds protect against a prompt-injected LLM
    asking us to write or read arbitrary filesystem locations.
    """
    resolved = p.resolve()
    cwd = Path.cwd().resolve()
    tmp = Path("/tmp").resolve()
    if not resolved.is_relative_to(cwd):
        print(
            f"error: {label} must be under the current working directory: {resolved}",
            file=sys.stderr,
        )
        return None
    if resolved.is_relative_to(tmp):
        print(f"error: {label} must not be under /tmp: {resolved}", file=sys.stderr)
        return None
    return resolved


def load_funds(funds_file: Path) -> "list | None":
    """Read and validate the funds list. Return the list, or None on error
    (after printing a message to stderr). On success the returned list contains
    {uuid, name} dicts with an optional currency field.
    """
    if not funds_file.is_file():
        print(f"error: funds_file not found or not a regular file: {funds_file}", file=sys.stderr)
        return None
    try:
        data = json.loads(funds_file.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        print(f"error: funds_file is not valid JSON: {e}", file=sys.stderr)
        return None
    if not isinstance(data, list):
        print(f"error: funds_file must contain a JSON array, got {type(data).__name__}", file=sys.stderr)
        return None
    if len(data) == 0:
        print("error: funds list must be non-empty", file=sys.stderr)
        return None
    for i, entry in enumerate(data):
        if not isinstance(entry, dict):
            print(f"error: fund entry #{i} is not an object: {entry!r}", file=sys.stderr)
            return None
        allowed_keys = {"uuid", "name", "currency"}
        required_keys = {"uuid", "name"}
        extra = entry.keys() - allowed_keys
        missing = required_keys - entry.keys()
        if extra or missing:
            print(
                f"error: fund entry #{i} must have 'uuid' and 'name' (and optionally 'currency'), got {sorted(entry.keys())}",
                file=sys.stderr,
            )
            return None
        if not isinstance(entry["uuid"], str) or not UUID_RE.match(entry["uuid"]):
            print(f"error: fund entry #{i} has invalid uuid: {entry['uuid']!r}", file=sys.stderr)
            return None
        if not isinstance(entry["name"], str) or entry["name"] == "":
            print(f"error: fund entry #{i} has invalid name: {entry['name']!r}", file=sys.stderr)
            return None
    return data


def main() -> int:
    if len(sys.argv) != 9:
        print(
            "usage: render-artifact.py <template> <output> <artifact_id> "
            "<mcp_tool> <firm_uuid> <firm_name> <funds_file> <initial_fund_uuid>",
            file=sys.stderr,
        )
        return 2

    (template, output, artifact_id, mcp_tool,
     firm_uuid, firm_name, funds_file, initial_fund_uuid) = sys.argv[1:]

    if not UUID_RE.match(firm_uuid):
        print(f"error: firm_uuid is not a valid UUID: {firm_uuid!r}", file=sys.stderr)
        return 1
    if not UUID_RE.match(initial_fund_uuid):
        print(f"error: initial_fund_uuid is not a valid UUID: {initial_fund_uuid!r}", file=sys.stderr)
        return 1
    if not MCP_TOOL_RE.match(mcp_tool):
        print(f"error: mcp_tool_name is not a valid MCP tool slug: {mcp_tool!r}", file=sys.stderr)
        return 1
    if not ARTIFACT_ID_RE.match(artifact_id):
        print(f"error: artifact_id is not a valid kebab-case slug: {artifact_id!r}", file=sys.stderr)
        return 1

    out_path = check_path_under_cwd(Path(output), "output path")
    if out_path is None:
        return 1

    funds_path = check_path_under_cwd(Path(funds_file), "funds_file path")
    if funds_path is None:
        return 1

    funds = load_funds(funds_path)
    if funds is None:
        return 1

    if not any(f["uuid"] == initial_fund_uuid for f in funds):
        print(
            f"error: initial_fund_uuid {initial_fund_uuid} is not present in funds_file",
            file=sys.stderr,
        )
        return 1

    src = Path(template)
    if not src.is_file():
        print(f"error: template not found: {template}", file=sys.stderr)
        return 1

    content = src.read_text(encoding="utf-8")
    missing = [p for p in PLACEHOLDERS if p not in content]
    if missing:
        print(
            f"error: template missing required placeholders: {missing}",
            file=sys.stderr,
        )
        return 1

    state_obj = {
        "firm_uuid": firm_uuid,
        "firm_name": firm_name,
        "funds": funds,
    }

    content = content.replace("{{FUNDS_JSON}}", js_safe_json(state_obj))
    content = content.replace("{{INITIAL_FUND_UUID}}", initial_fund_uuid)
    content = content.replace("{{MCP_TOOL_NAME}}", mcp_tool)
    content = content.replace("{{FIRM_NAME}}", html.escape(firm_name))
    content = content.replace("{{FIRM_UUID}}", firm_uuid)

    out_path.write_text(content, encoding="utf-8")
    print(out_path)
    return 0


if __name__ == "__main__":
    sys.exit(main())
