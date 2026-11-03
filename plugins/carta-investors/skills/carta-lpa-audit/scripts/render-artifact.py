# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///
"""Render the LPA-audit Live Artifact for one firm.

long-comment-ok: positional-argument contract for a CLI entry point
Usage:
    uv run render-artifact.py <output> <artifact_id> <mcp_server> \\
        <firm_uuid> <firm_name> <firm_carta_id> <base_url> <fund_names_file>
"""

import html
import json
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


ENTITY_TYPE_MAX = 80
# A fund's Carta reporting currency; process.py's parse_firm_entities applies the same rule.
CURRENCY_RE = re.compile(r"^[A-Z]{3}$")


def _load_entity(i: int, item):
    """Normalize one fund-file entry to {name, carta_id, entity_type, currency}, or None on error.

    An entry is a bare name, or an object from fa__list__entities. carta_id lands in
    an href, so it must be digits; entity_type is display text, so it must be short;
    currency, the fund's Carta reporting currency, must be an ISO code.
    """
    if isinstance(item, str):
        item = {"name": item}
    if not isinstance(item, dict):
        print(f"error: fund #{i} must be a name or an object, got {item!r}", file=sys.stderr)
        return None
    name = item.get("name")
    if not isinstance(name, str) or not name.strip():
        print(f"error: fund #{i} needs a non-empty string name, got {name!r}", file=sys.stderr)
        return None
    carta_id = item.get("carta_id")
    if carta_id is not None:
        if isinstance(carta_id, bool) or not CARTA_ID_RE.match(str(carta_id)):
            print(f"error: fund #{i} carta_id must be digits only, got {carta_id!r}", file=sys.stderr)
            return None
        carta_id = str(carta_id)
    entity_type = item.get("entity_type")
    if entity_type is not None and (
        not isinstance(entity_type, str) or not entity_type.strip() or len(entity_type) > ENTITY_TYPE_MAX
    ):
        print(f"error: fund #{i} entity_type must be a short non-empty string, got {entity_type!r}", file=sys.stderr)
        return None
    currency = item.get("currency")
    if currency is not None:
        if not isinstance(currency, str) or not CURRENCY_RE.match(currency.strip().upper()):
            print(f"error: fund #{i} currency must be a three-letter ISO code, got {currency!r}", file=sys.stderr)
            return None
        currency = currency.strip().upper()
    return {
        "name": name.strip(),
        "carta_id": carta_id,
        "entity_type": entity_type.strip() if entity_type else None,
        "currency": currency,
    }


def load_funds(path: Path):
    """Read the firm's entities as [{name, carta_id, entity_type, currency}], or return None on error."""
    if not path.is_file():
        print(f"error: fund_names_file not found or not a regular file: {path}", file=sys.stderr)
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        print(f"error: fund_names_file is not valid JSON: {e}", file=sys.stderr)
        return None
    if not isinstance(data, list) or not data:
        print(f"error: fund_names_file must contain a non-empty JSON array, got {type(data).__name__}", file=sys.stderr)
        return None
    funds = []
    for i, item in enumerate(data):
        entity = _load_entity(i, item)
        if entity is None:
            return None
        funds.append(entity)
    return funds


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
    if len(sys.argv) != 9:
        print(
            "usage: render-artifact.py <output> <artifact_id> <mcp_server> "
            "<firm_uuid> <firm_name> <firm_carta_id> <base_url> <fund_names_file>",
            file=sys.stderr,
        )
        return 2

    output, artifact_id, mcp_server, firm_uuid, firm_name, firm_carta_id, base_url, fund_names_file = sys.argv[1:9]

    if not validate_args(artifact_id, mcp_server, firm_uuid, firm_name, firm_carta_id, base_url):
        return 1

    out_path = check_path_under_cwd(Path(output), "output path")
    if out_path is None:
        return 1

    # A zero-fund LPA audit is a Step-1-level stop condition per SKILL.md (the
    # agent never reaches render with an empty fa__list__entities result), so
    # this file is required, not optional — unlike carta-co-investors' vehicles
    # file, there's no reasonable "warn and fall back to just the firm name"
    # degradation for an LPA audit with no known funds to audit.
    fund_names_path = check_path_under_cwd(Path(fund_names_file), "fund_names_file")
    if fund_names_path is None:
        return 1
    funds = load_funds(fund_names_path)
    if funds is None:
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
        # Every entity is matched; firm_funds adds what the page needs to link and filter.
        "firm_fund_names": [f["name"] for f in funds],
        "firm_funds": funds,
    }

    replacements = {
        "{{STATE_JSON}}": js_safe_json(state_obj),
        "{{TITLE}}": html.escape(f"{firm_name} — LPA coverage audit"),
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
