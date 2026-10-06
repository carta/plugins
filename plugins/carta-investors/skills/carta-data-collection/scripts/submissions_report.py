"""Turn data_collection__list__submissions pages into the submission tracker.

Reads one or more saved page results (the call_tool output as written to a file)
and emits the Step 3 report as markdown: the header line, the tracker table
sorted most-missing first, and the gaps by item. Pure files→stdout: this script
never calls the Carta API. The model reads the pages, saves each to a file, runs
this, and pastes the result — the table and the counts are then arithmetic, not
transcription.

    python3 submissions_report.py page1.json page2.json --period "Q2 2026"

Names come from the pages themselves: the company on each row, metrics and
documents from the top-level names maps. A code the pages do not name is left
as-is and listed under "unnamed" in the JSON summary printed to stderr, so the
model can resolve it with list__metrics or list__document_types and rerun.
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from typing import Any

FILE_LABELS = {
    "AOI": "Articles of Incorporation",
    "CAP": "Cap table",
    "BS": "Balance sheet",
    "PL": "P&L",
    "CFS": "Cash flow statement",
    "FCST": "Forecasts",
    "DECK": "Board deck / investor update",
    "KPI": "KPIs",
}

# The firm's view of the request, in the user's words. Mirrors the table in
# references/status-and-overdue.md Step 2.
STATUS_LABELS = {
    "overdue": "Past due",
    "requested": "Nothing back yet",
    "collecting": "Started",
    "processing": "Started",
    "requires review": "Needs your review",
    "updated": "Answered",
    "not updated": "Closed without data",
}

UNLISTED = "No longer in the portfolio"


def _fail(message: str) -> None:
    print(json.dumps({"error": message}), file=sys.stderr)
    raise SystemExit(2)


def _load_pages(paths: list[str]) -> tuple[list[dict[str, Any]], dict[str, dict[str, str]]]:
    rows: list[dict[str, Any]] = []
    names: dict[str, dict[str, str]] = {"metrics": {}, "documents": {}}
    for path in paths:
        try:
            with open(path, encoding="utf-8") as handle:
                data = json.load(handle)
        except (OSError, json.JSONDecodeError) as exc:
            _fail(f"{path}: {exc}")
        # call_tool wraps the command result as {"result": "<json string>"}; a page
        # saved from that has to be unwrapped. A page saved as the result itself is
        # already a dict with "results".
        if isinstance(data, dict) and isinstance(data.get("result"), str):
            data = json.loads(data["result"])
        if not isinstance(data, dict) or not isinstance(data.get("results"), list):
            _fail(f"{path}: expected a page with a 'results' list")
        rows.extend(r for r in data["results"] if isinstance(r, dict))
        page_names = data.get("names") if isinstance(data.get("names"), dict) else {}
        for kind in ("metrics", "documents"):
            found = page_names.get(kind)
            if isinstance(found, dict):
                names[kind].update({str(k): str(v) for k, v in found.items()})
    return rows, names


def _label(code: str, names: dict[str, dict[str, str]], unnamed: set[str]) -> str:
    if code in FILE_LABELS:
        return FILE_LABELS[code]
    if code.startswith("doc:"):
        name = names["documents"].get(code[4:])
    else:
        name = names["metrics"].get(code)
    if name:
        return name
    unnamed.add(code)
    return code


def _company(row: dict[str, Any]) -> str:
    return str(row.get("company") or UNLISTED)


def _status(row: dict[str, Any]) -> str:
    raw = str(row.get("status") or "").replace("_", " ")
    return STATUS_LABELS.get(raw, raw.capitalize() or "—")


def render(rows: list[dict[str, Any]], names: dict[str, dict[str, str]], period: str) -> tuple[str, dict[str, Any]]:
    unnamed: set[str] = set()
    complete = sum(1 for r in rows if not r.get("missing"))
    lines = [
        f"**{period}** — {len(rows)} companies asked · {complete} sent everything · "
        f"{len(rows) - complete} missing something",
        "",
        "| Company | Status | Received | Missing |",
        "|---|---|---|---|",
    ]
    ordered = sorted(rows, key=lambda r: (-len(r.get("missing") or []), _company(r).lower()))
    for row in ordered:
        required = set(row.get("missing_required") or [])
        received = ", ".join(_label(c, names, unnamed) for c in row.get("received") or []) or "—"
        missing = (
            ", ".join(
                f"{_label(c, names, unnamed)} **(required)**" if c in required else _label(c, names, unnamed)
                for c in row.get("missing") or []
            )
            or "—"
        )
        lines.append(f"| {_company(row)} | {_status(row)} | {received} | {missing} |")

    gaps: Counter[str] = Counter()
    who: dict[str, list[str]] = {}
    for row in rows:
        for code in row.get("missing") or []:
            gaps[code] += 1
            who.setdefault(code, []).append(_company(row))
    if gaps:
        lines += ["", f"**Gaps — {period}**"]
        for code, count in gaps.most_common():
            companies = sorted(who[code], key=str.lower)
            shown = ", ".join(companies[:5])
            more = f", and {len(companies) - 5} more" if len(companies) > 5 else ""
            lines.append(f"- {_label(code, names, unnamed)}: missing from {count} of {len(rows)} companies — {shown}{more}")

    unlisted = [r.get("entity_id") for r in rows if not r.get("company")]
    summary = {
        "companies": len(rows),
        "complete": complete,
        "unnamed_codes": sorted(unnamed),
        "unlisted_entity_ids": unlisted,
    }
    return "\n".join(lines), summary


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("pages", nargs="+", help="Saved list__submissions page results")
    parser.add_argument("--period", required=True, help='The period label for the header, e.g. "Q2 2026"')
    args = parser.parse_args(argv)
    rows, names = _load_pages(args.pages)
    markdown, summary = render(rows, names, args.period)
    print(markdown)
    print(json.dumps(summary), file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
