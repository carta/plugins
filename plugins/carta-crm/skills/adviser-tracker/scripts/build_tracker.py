#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///
"""Build the Adviser Tracker page from a saved adviser tracker result, ready to publish."""
from __future__ import annotations

import argparse
import datetime as dt
import html
import json
import re
import sys
from pathlib import Path

SKELETON = Path(__file__).resolve().parent.parent / "assets" / "skeleton.html"

# The skeleton renders from the JSON in this one element. Its sample content is replaced whole.
_DATA_TAG = re.compile(r'(<script type="application/json" id="tracker-data">)(.*?)(</script>)', re.S)
TITLE_SLOT = "<title>Adviser Tracker</title>"

# The error text the tool starts with when adviser tracking is not set up for the organization.
NOT_CONFIGURED_PREFIX = "adviser-tracker-not-configured:"

STRENGTHS = ("strong", "moderate", "weak")

# Only raster and SVG images a browser renders without a network fetch. Anything else becomes null,
# and the page shows an empty tile, because the page sits behind a stable URL.
_DATA_URI = re.compile(r"^data:image/(?:png|webp|jpeg|svg\+xml);base64,[A-Za-z0-9+/]+={0,2}$")
_MONTH = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")


def fail(code: str, message: str) -> "SystemExit":
    return SystemExit(f"{code}: {message}")


def parse_result(raw: str) -> dict:
    """The tool payload, from plain JSON, the MCP result envelope or the saved `{"result": "<json>"}` file."""
    try:
        value = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise fail("result_not_json", str(exc))
    if isinstance(value, dict) and isinstance(value.get("result"), str):
        return parse_result(value["result"])
    if isinstance(value, dict) and isinstance(value.get("structuredContent"), dict):
        return value["structuredContent"]
    if isinstance(value, dict) and isinstance(value.get("content"), list):
        text = next((c.get("text") for c in value["content"] if isinstance(c, dict) and c.get("type") == "text"), None)
        if text is None:
            raise fail("result_empty", "the result carries no text content")
        if text.startswith(NOT_CONFIGURED_PREFIX):
            raise fail("not_configured", text)
        try:
            return json.loads(text)
        except json.JSONDecodeError as exc:
            raise fail("result_not_json", str(exc))
    return value


def clean_logo(raw: object) -> dict:
    uri = raw.get("dataUri") if isinstance(raw, dict) else None
    return {"dataUri": uri if isinstance(uri, str) and _DATA_URI.match(uri) else None}


def _count(value: object, where: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise fail("row_invalid", f"{where} must be a non-negative integer")
    return value


def _number(value: object, where: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise fail("row_invalid", f"{where} must be a number")
    return value


def _person(value: object, where: str) -> dict:
    if not isinstance(value, dict) or not isinstance(value.get("name"), str):
        raise fail("row_invalid", f"{where}.name is required")
    return {"name": value["name"]}


def clean_months(months: object, where: str) -> list[dict]:
    if not isinstance(months, list):
        raise fail("row_invalid", f"{where}.dealsByMonth must be a list")
    out = []
    for entry in months:
        month = entry.get("month") if isinstance(entry, dict) else None
        if not (isinstance(month, str) and _MONTH.match(month)):
            raise fail("row_invalid", f"{where}.dealsByMonth entries need a YYYY-MM month")
        out.append({"month": month, "count": _count(entry.get("count"), f"{where}.dealsByMonth.count")})
    return out


def clean_relationship(raw: object, where: str) -> dict:
    if not isinstance(raw, dict) or raw.get("strength") not in STRENGTHS:
        raise fail("row_invalid", f"{where}.relationship.strength must be one of {', '.join(STRENGTHS)}")
    top = raw.get("topContact")
    matrix = raw.get("matrix") or []
    if not isinstance(matrix, list):
        raise fail("row_invalid", f"{where}.relationship.matrix must be a list")
    cells = []
    for cell in matrix:
        if not isinstance(cell, dict) or cell.get("strength") not in STRENGTHS:
            raise fail("row_invalid", f"{where}.relationship.matrix entries need a strength")
        last = cell.get("lastInteraction")
        cells.append({
            "teammate": _person(cell.get("teammate"), f"{where}.matrix.teammate"),
            "contact": _person(cell.get("contact"), f"{where}.matrix.contact"),
            "interactions": _count(cell.get("interactions"), f"{where}.matrix.interactions"),
            "lastInteraction": last if isinstance(last, str) else None,
            "strength": cell["strength"],
        })
    return {
        "strength": raw["strength"],
        "topContact": None if top is None else {
            **_person(top, f"{where}.topContact"),
            "interactions": _count(top.get("interactions"), f"{where}.topContact.interactions"),
        },
        "matrix": cells,
    }


def clean_row(row: object, index: int) -> dict:
    """One row in the tool's own shape, with only the fields the page reads."""
    where = f"rows[{index}]"
    if not isinstance(row, dict):
        raise fail("row_invalid", f"{where} must be an object")
    adviser = row.get("adviser")
    if not isinstance(adviser, dict) or not isinstance(adviser.get("name"), str) or not adviser["name"].strip():
        raise fail("row_invalid", f"{where}.adviser.name is required")
    if not isinstance(adviser.get("domain"), str) or not adviser["domain"]:
        raise fail("row_invalid", f"{where}.adviser.domain is required")
    fees = row.get("fees") or []
    if not isinstance(fees, list) or not all(isinstance(f, dict) for f in fees):
        raise fail("row_invalid", f"{where}.fees must be a list of objects")
    reason = row.get("feeUnavailableReason")
    company_id = adviser.get("companyId")
    return {
        "adviser": {
            "companyId": company_id if isinstance(company_id, str) else None,
            "name": adviser["name"],
            "domain": adviser["domain"],
            "logo": clean_logo(adviser.get("logo")),
        },
        "dealsByMonth": clean_months(row.get("dealsByMonth"), where),
        "relationship": clean_relationship(row.get("relationship"), where),
        "fees": [
            {"currency": f["currency"].upper() if isinstance(f.get("currency"), str) and f["currency"] else None,
             "amount": _number(f.get("amount"), f"{where}.fees.amount")}
            for f in fees
        ],
        "feeUnavailableReason": reason if isinstance(reason, str) and reason else None,
        "notesCount": _count(row.get("notesCount", 0), f"{where}.notesCount"),
    }


def split_tiers(rows: list[dict], last_year: int) -> dict:
    """Tier 1 is the top half of the banks, rounded up, by deals created over the whole window.

    Ties go to the bank with more deals in `last_year`, then to the earlier name. The result does not depend
    on the order of `rows`, and it does not change with the year the page shows.
    """
    def rank(row: dict) -> tuple:
        months = row["dealsByMonth"]
        return (
            -sum(m["count"] for m in months),
            -sum(m["count"] for m in months if m["month"].startswith(str(last_year))),
            row["adviser"]["name"].casefold(),
            row["adviser"]["domain"],
        )

    ranked = [r["adviser"]["domain"] for r in sorted(rows, key=rank)]
    cut = (len(ranked) + 1) // 2
    return {"1": ranked[:cut], "2": ranked[cut:]}


def build_data(payload: object, as_of: dt.date, notice: str | None) -> dict:
    """The tool output plus `asOf`, `notice` and `tiers`, the shape the skeleton reads."""
    if not isinstance(payload, dict) or not isinstance(payload.get("rows"), list):
        raise fail("result_invalid", "the result has no `rows` list")
    window = payload.get("window")
    if not (isinstance(window, dict) and all(isinstance(window.get(k), int) for k in ("from", "to")) and window["from"] <= window["to"]):
        raise fail("result_invalid", "`window` must carry integer `from` and `to`")
    rows = [clean_row(r, i) for i, r in enumerate(payload["rows"])]
    tenant = payload.get("tenant") if isinstance(payload.get("tenant"), dict) else {}
    title = payload["title"] if isinstance(payload.get("title"), str) and payload["title"] else "M&A Adviser Tracker"
    return {
        "tenant": {"name": tenant["name"] if isinstance(tenant.get("name"), str) else "", "logo": clean_logo(tenant.get("logo"))},
        "title": title,
        "window": {"from": window["from"], "to": window["to"]},
        "asOf": as_of.isoformat(),
        "notice": notice,
        "tiers": split_tiers(rows, window["to"]),
        "rows": rows,
    }


def json_for_script(data: dict) -> str:
    """JSON that cannot end its own script element or open an HTML comment."""
    return json.dumps(data, ensure_ascii=False, separators=(",", ":")).replace("<", "\\u003c").replace("\u2028", "\\u2028").replace("\u2029", "\\u2029")


MANDATE_VIEW = ("mandate", "By mandate")
PEOPLE_VIEW = ("dealPeople", "By introducer & adviser")
PEOPLE_NOTICE = "Banks are counted from the introducers and advisers on each deal. A deal counts for the bank where one of them works today."
PEOPLE_DROPPED = "The introducer and adviser view is not shown."


def drop_people_view(data: dict, detail: str) -> dict:
    """`data` with the fixed notice line. The detail goes to stderr for the agent, not into the page."""
    print(f"people view dropped: {detail}", file=sys.stderr)
    return add_notice(data, PEOPLE_DROPPED)


def with_people_view(data: dict, people_raw: str, as_of: dt.date) -> dict:
    """`data` plus a `views` list when the people result is sound, else `data` with a notice line.

    A people result that fails the same checks as the main result, has no rows, or does not share the
    main window is dropped. The Mandate page is still built.
    """
    try:
        people = build_data(parse_result(people_raw), as_of, PEOPLE_NOTICE)
    except SystemExit as exc:
        return drop_people_view(data, str(exc))
    if not people["rows"]:
        return drop_people_view(data, "it has no banks")
    if people["window"] != data["window"]:
        return drop_people_view(data, "its years differ")
    return {**data, "views": [{"key": key, "label": label, **view} for (key, label), view in zip((MANDATE_VIEW, PEOPLE_VIEW), (data, people))]}


def add_notice(data: dict, line: str) -> dict:
    return {**data, "notice": f"{data['notice']} {line}" if data["notice"] else line}


def render(data: dict) -> str:
    skeleton = SKELETON.read_text(encoding="utf-8")
    if len(_DATA_TAG.findall(skeleton)) != 1 or TITLE_SLOT not in skeleton:
        raise fail("template_invalid", "the skeleton lacks its one data element or its title")
    tenant = data["tenant"]["name"]
    title = f"{data['title']} - {tenant}" if tenant else data["title"]
    page = _DATA_TAG.sub(lambda m: m.group(1) + json_for_script(data) + m.group(3), skeleton)
    return page.replace(TITLE_SLOT, f"<title>{html.escape(title)}</title>")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--result", type=Path, help="the saved adviser tracker result")
    parser.add_argument("--people-result", type=Path, help="the saved result of the introducer and adviser call, for a second view")
    parser.add_argument("--notice", help="one line shown above the table, such as a check that disagreed")
    parser.add_argument("--as-of", type=dt.date.fromisoformat, default=dt.date.today(), help="the date the data is as of (default today)")
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args(argv)

    if not args.result:
        raise fail("no_result", "pass --result")
    data = build_data(parse_result(args.result.read_text(encoding="utf-8")), args.as_of, args.notice)
    if args.people_result:
        try:
            people_raw = args.people_result.read_text(encoding="utf-8")
        except OSError as exc:
            data = drop_people_view(data, str(exc.strerror))
        else:
            data = with_people_view(data, people_raw, args.as_of)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(render(data), encoding="utf-8")
    print(f"wrote {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
