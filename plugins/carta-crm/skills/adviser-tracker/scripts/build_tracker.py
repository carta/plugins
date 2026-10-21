#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///
"""Build the Adviser Tracker page from a saved adviser tracker result, ready to publish."""
from __future__ import annotations

import argparse
import base64
import datetime as dt
import hashlib
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


# The page (assets/skeleton.html `.tile`) draws a logo at 100% of a square tile with a border-radius of
# 25% of its side and overflow:hidden. The image sits inset in a square SVG, contained, so any aspect
# ratio fits. Corners clear the clip while _TILE_INSET / _TILE_UNITS >= (1 - 1/sqrt(2)) * radius / side
# (0.073 at 25%). The source image appears once in the SVG, because the page embeds the SVG as text.
_TILE_UNITS = 64
_TILE_INSET = 6


def fit_to_tile(data_uri: str) -> str:
    size = _TILE_UNITS - 2 * _TILE_INSET
    svg = (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {_TILE_UNITS} {_TILE_UNITS}">'
        f'<image href="{data_uri}" x="{_TILE_INSET}" y="{_TILE_INSET}" width="{size}" height="{size}" preserveAspectRatio="xMidYMid meet"/></svg>'
    )
    return "data:image/svg+xml;base64," + base64.b64encode(svg.encode("ascii")).decode("ascii")


def _decodes(data_uri: str) -> bool:
    """Whether the base64 payload has a whole length and padding. A copy that lost characters fails here, and the tile stays empty."""
    try:
        base64.b64decode(data_uri.split(",", 1)[1], validate=True)
    except ValueError:
        return False
    return True


def clean_logo(raw: object) -> dict:
    uri = raw.get("dataUri") if isinstance(raw, dict) else None
    usable = isinstance(uri, str) and _DATA_URI.match(uri) and _decodes(uri)
    return {"dataUri": fit_to_tile(uri) if usable else None}


def _is_count(value: object) -> bool:
    return isinstance(value, int) and not isinstance(value, bool) and value >= 0


def _count(value: object, where: str) -> int:
    if not _is_count(value):
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


def _mail_domains(value: object, where: str) -> list[dict]:
    if not isinstance(value, list) or not all(isinstance(v, dict) and isinstance(v.get("domain"), str) for v in value):
        raise fail("row_invalid", f"{where} must be a list of objects with a domain")
    return [{
        "domain": v["domain"],
        "company": v["company"] if isinstance(v.get("company"), str) and v["company"] else None,
        "interactions": v["interactions"] if _is_count(v.get("interactions")) else None,
    } for v in value]


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
    counts = {key: _count(raw[key], f"{where}.relationship.{key}") for key in ("interactions", "contacts") if key in raw}
    domains = {key: _mail_domains(raw[key], f"{where}.relationship.{key}") for key in ("linkedDomains", "suggestedDomains") if key in raw}
    return {
        "strength": raw["strength"],
        **counts,
        **domains,
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


def tracker_checksum(rows: list[dict]) -> str:
    """SHA-256 over each row's domain and monthly counts, the formula crm-api puts in the payload's `checksum`.

    One line per row, in row order: `<domain>\t<month>=<count>,<month>=<count>`.
    """
    text = "\n".join(
        row["adviser"]["domain"] + "\t" + ",".join(f"{m['month']}={m['count']}" for m in row["dealsByMonth"])
        for row in rows
    )
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _deals(row: dict) -> int:
    """The deals of a bank over the whole window."""
    return sum(m["count"] for m in row["dealsByMonth"])


def split_tiers(rows: list[dict], year: int) -> dict:
    """Tier 1 is the top half of the banks, rounded up, by deals created in `year`.

    Ties go to the bank with more deals over the whole window, then to the earlier name. The result does not
    depend on the order of `rows`.
    """
    def rank(row: dict) -> tuple:
        months = row["dealsByMonth"]
        return (
            -sum(m["count"] for m in months if m["month"].startswith(str(year))),
            -_deals(row),
            row["adviser"]["name"].casefold(),
            row["adviser"]["domain"],
        )

    ranked = [r["adviser"]["domain"] for r in sorted(rows, key=rank)]
    cut = (len(ranked) + 1) // 2
    return {"1": ranked[:cut], "2": ranked[cut:]}


def build_data(payload: object, as_of: dt.date, notice: str | None) -> dict:
    """The tool output plus `asOf`, `notice` and `tiersByYear`, the shape the skeleton reads."""
    if not isinstance(payload, dict) or not isinstance(payload.get("rows"), list):
        raise fail("result_invalid", "the result has no `rows` list")
    window = payload.get("window")
    window_months(window)
    rows = [clean_row(r, i) for i, r in enumerate(payload["rows"])]
    checksum = payload.get("checksum")
    if isinstance(checksum, str) and checksum != tracker_checksum(rows):
        raise fail("result_corrupt", "the deal counts differ from the tool answer, so the copy lost or changed data")
    tenant = payload.get("tenant") if isinstance(payload.get("tenant"), dict) else {}
    title = payload["title"] if isinstance(payload.get("title"), str) and payload["title"] else "M&A Adviser Tracker"
    return {
        "tenant": {"name": tenant["name"] if isinstance(tenant.get("name"), str) else "", "logo": clean_logo(tenant.get("logo"))},
        "title": title,
        "window": {"from": window["from"], "to": window["to"]},
        "asOf": as_of.isoformat(),
        "notice": notice,
        "tiersByYear": {str(year): split_tiers(rows, year) for year in range(window["from"], window["to"] + 1)},
        "rows": rows,
    }


def _row_lines(row: dict) -> list[str]:
    """The checks of one row: lines for the agent to report, never put on the page."""
    name, domain = row["adviser"]["name"], row["adviser"]["domain"]
    rel = row["relationship"]
    interactions = rel.get("interactions")
    if interactions is None:
        return []
    lines = []
    if _deals(row) > 0 and interactions == 0:
        suggested = ", ".join(f"{d['company']} ({d['domain']})" if d["company"] else d["domain"] for d in rel.get("suggestedDomains", []))
        lines.append(f"check_domain: {name} ({domain}): {_deals(row)} deals, no interactions." + (f" Possible domains: {suggested}." if suggested else " No other domain found."))
    if interactions == 0 and (rel["strength"] != "weak" or rel["topContact"] or rel["matrix"]):
        lines.append(f"check_row: {name} ({domain}): no interactions, yet it carries a strength, a contact or a matrix.")
    if interactions > 0 and rel.get("contacts") == 0:
        lines.append(f"check_row: {name} ({domain}): {interactions} interactions and no contact.")
    return lines


def check_rows(data: dict) -> list[str]:
    """One line per row of any view that fails a check: deals with no interaction, or counts that contradict each other.

    A result from an older tool carries no interaction count, so its rows are never checked.
    """
    views = data.get("views") or [data]
    return list(dict.fromkeys(line for view in views for row in view["rows"] for line in _row_lines(row)))


def json_for_script(data: dict) -> str:
    """JSON that cannot end its own script element or open an HTML comment."""
    return json.dumps(data, ensure_ascii=False, separators=(",", ":")).replace("<", "\\u003c").replace("\u2028", "\\u2028").replace("\u2029", "\\u2029")


def _logo_map(raw: object) -> tuple[dict, dict]:
    """The tenant logo and the logos by lowercase domain, from the logos tool answer."""
    if not isinstance(raw, dict) or not isinstance(raw.get("logos"), list):
        raise fail("logos_invalid", "the logos answer has no `logos` list")
    by_domain = {}
    for entry in raw["logos"]:
        if isinstance(entry, dict) and isinstance(entry.get("domain"), str):
            logo = clean_logo(entry)
            if logo["dataUri"]:
                by_domain[entry["domain"].lower()] = logo
    return clean_logo({"dataUri": raw.get("tenant")}), by_domain


def with_logos(view: dict, tenant_logo: dict, by_domain: dict) -> dict:
    """`view` with each missing logo filled from the logos answer. A logo the result already carries stays."""
    rows = [
        {**row, "adviser": {**row["adviser"], "logo": row["adviser"]["logo"] if row["adviser"]["logo"]["dataUri"] else by_domain.get(row["adviser"]["domain"].lower(), row["adviser"]["logo"])}}
        for row in view["rows"]
    ]
    tenant = view["tenant"] if view["tenant"]["logo"]["dataUri"] else {**view["tenant"], "logo": tenant_logo}
    return {**view, "tenant": tenant, "rows": rows}


def drop_logos(data: dict, detail: str) -> dict:
    """`data` unchanged. The detail goes to stderr for the agent, not into the page."""
    print(f"logos dropped: {detail}", file=sys.stderr)
    return data


def apply_logos(data: dict, logos_raw: str) -> dict:
    """`data`, and each of its views, with the logos of the logos answer. An unusable answer leaves empty tiles."""
    try:
        answer = parse_result(logos_raw)
    except SystemExit as exc:
        return drop_logos(data, str(exc))
    return apply_logo_answer(data, answer)


def apply_logo_answer(data: dict, answer: object) -> dict:
    """`data`, and each of its views, with the logos of a parsed logos answer. An unusable answer leaves empty tiles."""
    try:
        tenant_logo, by_domain = _logo_map(answer)
    except SystemExit as exc:
        return drop_logos(data, str(exc))
    out = with_logos(data, tenant_logo, by_domain)
    if "views" in data:
        out["views"] = [with_logos(view, tenant_logo, by_domain) for view in data["views"]]
    return out


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
        payload = parse_result(people_raw)
    except SystemExit as exc:
        return drop_people_view(data, str(exc))
    return with_people_payload(data, payload, as_of)


def with_people_payload(data: dict, payload: object, as_of: dt.date) -> dict:
    """`with_people_view` for a people result that is already parsed."""
    try:
        people = build_data(payload, as_of, PEOPLE_NOTICE)
    except SystemExit as exc:
        return drop_people_view(data, str(exc))
    if not people["rows"]:
        return drop_people_view(data, "it has no banks")
    if people["window"] != data["window"]:
        return drop_people_view(data, "its years differ")
    return {**data, "views": [{"key": key, "label": label, **view} for (key, label), view in zip((MANDATE_VIEW, PEOPLE_VIEW), (data, people))]}


def window_months(window: object) -> list[str]:
    """Every `YYYY-MM` of a `{from, to}` window of whole years, oldest first, as crm-api counts them."""
    if not (isinstance(window, dict) and all(isinstance(window.get(k), int) for k in ("from", "to")) and window["from"] <= window["to"]):
        raise fail("result_invalid", "`window` must carry integer `from` and `to`")
    return [f"{year}-{month:02d}" for year in range(window["from"], window["to"] + 1) for month in range(1, 13)]


def expand_build_view(view: object, tenant: object, title: object) -> dict:
    """One view of a build answer in the result's own shape: each row's `monthCounts` become `dealsByMonth`."""
    if not isinstance(view, dict) or not isinstance(view.get("rows"), list):
        raise fail("result_invalid", "the build view has no `rows` list")
    months = window_months(view.get("window"))
    rows = []
    for index, row in enumerate(view["rows"]):
        counts = row.get("monthCounts") if isinstance(row, dict) else None
        if not isinstance(counts, list) or len(counts) != len(months):
            raise fail("row_invalid", f"rows[{index}].monthCounts must hold one count per month of the window")
        rows.append({**{k: v for k, v in row.items() if k != "monthCounts"},
                     "dealsByMonth": [{"month": month, "count": count} for month, count in zip(months, counts)]})
    return {"tenant": tenant, "title": title, "window": view["window"], "rows": rows, "checksum": view.get("checksum")}


def build_from_answer(raw: str, as_of: dt.date, notice: str | None) -> dict:
    """The page data of a finished build answer: the Mandate view, the people view unless it failed, and the logos."""
    answer = parse_result(raw)
    if not isinstance(answer, dict) or answer.get("status") != "done":
        status = answer.get("status") if isinstance(answer, dict) else None
        raise fail("build_not_done", f"the build answer has status {status!r}, not 'done'")
    tenant, title = answer.get("tenant"), answer.get("title")
    data = build_data(expand_build_view(answer.get("mandate"), tenant, title), as_of, notice)
    people = answer.get("people")
    if isinstance(people, dict) and "error" in people:
        data = drop_people_view(data, str(people["error"]))
    elif people is not None:
        try:
            data = with_people_payload(data, expand_build_view(people, tenant, title), as_of)
        except SystemExit as exc:
            data = drop_people_view(data, str(exc))
    else:
        data = drop_people_view(data, "the build answer has no people view")
    if answer.get("logos") is not None:
        data = apply_logo_answer(data, answer["logos"])
    return data


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


def build_from_files(args: argparse.Namespace) -> dict:
    """The page data of a split run's saved result, people result and logos answer."""
    if not args.result:
        raise fail("no_result", "pass --build or --result")
    data = build_data(parse_result(args.result.read_text(encoding="utf-8")), args.as_of, args.notice)
    if args.people_result:
        try:
            people_raw = args.people_result.read_text(encoding="utf-8")
        except OSError as exc:
            data = drop_people_view(data, str(exc.strerror))
        else:
            data = with_people_view(data, people_raw, args.as_of)
    if args.logos:
        try:
            data = apply_logos(data, args.logos.read_text(encoding="utf-8"))
        except OSError as exc:
            data = drop_logos(data, str(exc.strerror))
    return data


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--build", type=Path, help="the saved answer of a finished build, which holds both views and the logos")
    parser.add_argument("--result", type=Path, help="the saved adviser tracker result")
    parser.add_argument("--people-result", type=Path, help="the saved result of the introducer and adviser call, for a second view")
    parser.add_argument("--logos", type=Path, help="the saved answer of the logos call, for banks whose result carries no logo")
    parser.add_argument("--notice", help="one line shown above the table, such as a check that disagreed")
    parser.add_argument("--as-of", type=dt.date.fromisoformat, default=dt.date.today(), help="the date the data is as of (default today)")
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args(argv)

    if args.build:
        if args.result or args.people_result or args.logos:
            raise fail("no_result", "pass --build alone, or --result with its optional files")
        data = build_from_answer(args.build.read_text(encoding="utf-8"), args.as_of, args.notice)
    else:
        data = build_from_files(args)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(render(data), encoding="utf-8")
    for line in check_rows(data):
        print(line, file=sys.stderr)
    print(f"wrote {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
