#!/usr/bin/env python3
# /// script
# requires-python = ">=3.12"
# dependencies = []
# ///
"""
Fetch Carta cap-table field definitions from the canonical Google Sheet and write
plugins/carta-cap-table/skills/carta-field-definitions/glossary.md.

Sheet structure (as of the canonical definitions sheet):
  - Each sheet tab = one report section (e.g. "Cap Table Report", "Securities Ledger")
  - Within each tab, section-header rows (single-cell, non-column-header) name the
    sub-tabs (e.g. "Summary tab", "Intermediate and Detailed tabs") — these become
    the Tabs column in the output.
  - Column headers: "Carta Field", "Carta Field Definition",
    "Carta Field Data Response Types (if applicable)"
  - Data rows: 3 cells following a column-header row.
  - Empty rows separate sections.

Output glossary.md schema (one section per sheet tab):
  ## <Tab Name>
  | Field | Type | Tabs | Definition |
  |---|---|---|---|
  | ... | ... | ... | ... |

  Fields are sorted alphabetically within each section.

Usage:
  uv run --no-project --script update-glossary.py \\
      --sheet-id 1AbC...XYZ \\
      --output path/to/glossary.md

Prints a single JSON line on stdout:
  {"output": "...", "rows_written": N, "sections": ["Cap Table Report", ...]}

Exit codes: 0 = success, 1 = auth error, 2 = sheet/data error.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import tempfile

from glossary_common import (
    COLUMN_HEADER_MARKER,
    gcloud_token,
    http_get,
    list_visible_tabs,
    normalize_tabs,
    read_tab,
)


def parse_tab_rows(values: list[list[str]]) -> list[dict]:
    """Parse rows from one sheet tab into field records.

    Returns a list of dicts with keys: field, type, tabs, definition.
    Section headers (single-cell rows) set the sub-tab context for the rows
    that follow. Rows with identical (field, definition) that appear under
    different section headers are merged into one row with comma-joined Tabs,
    matching the existing glossary.md format the carta-field-definitions skill
    expects. Rows with the same field name but genuinely different definitions
    are kept as separate entries.
    """
    raw_records: list[dict] = []
    current_tabs = ""

    for row in values:
        cells = [c.strip() for c in row]
        non_empty = [c for c in cells if c]

        if not non_empty:
            continue

        first = cells[0] if cells else ""

        if first.lower() == COLUMN_HEADER_MARKER:
            continue

        if len(non_empty) == 1:
            current_tabs = normalize_tabs(first)
            continue

        field = first
        definition = cells[1] if len(cells) > 1 else ""
        ftype = cells[2] if len(cells) > 2 else ""

        if not field or not definition:
            continue

        raw_records.append({
            "field": field,
            "type": ftype,
            "tabs": current_tabs,
            "definition": definition,
        })

    # Merge rows that share identical (field, definition) by joining their Tabs
    # values. Preserve insertion order of first occurrence for stable output.
    merged: dict[tuple[str, str], dict] = {}
    merge_order: list[tuple[str, str]] = []
    for rec in raw_records:
        key = (rec["field"], rec["definition"])
        if key in merged:
            existing_tabs = merged[key]["tabs"]
            new_tab = rec["tabs"]
            if new_tab and new_tab not in existing_tabs.split(", "):
                merged[key]["tabs"] = f"{existing_tabs}, {new_tab}" if existing_tabs else new_tab
        else:
            merged[key] = dict(rec)
            merge_order.append(key)

    return [merged[k] for k in merge_order]


def escape_pipe(text: str) -> str:
    return text.replace("|", "\\|")


def render_glossary(sections: dict[str, list[dict]]) -> str:
    lines = ["# Carta Cap Table Field Definitions Glossary", ""]
    for report_name, records in sections.items():
        if not records:
            continue
        lines.append(f"## {report_name}")
        lines.append("")
        lines.append("| Field | Type | Tabs | Definition |")
        lines.append("|---|---|---|---|")
        for rec in records:
            field = escape_pipe(rec["field"])
            ftype = escape_pipe(rec["type"])
            tabs = escape_pipe(rec["tabs"])
            definition = escape_pipe(rec["definition"])
            lines.append(f"| {field} | {ftype} | {tabs} | {definition} |")
        lines.append("")
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(description="Sync field definitions from a Google Sheet.")
    parser.add_argument("--sheet-id", required=True, help="Google Sheet ID (not the full URL).")
    parser.add_argument("--output", required=True, help="Destination glossary.md path.")
    args = parser.parse_args()

    token = gcloud_token()

    tab_names = list_visible_tabs(token, args.sheet_id)
    if not tab_names:
        print(f"ERROR: no visible tabs found on sheet {args.sheet_id}", file=sys.stderr)
        return 2

    sections: dict[str, list[dict]] = {}
    for tab_name in tab_names:
        values = read_tab(token, args.sheet_id, tab_name)
        records = parse_tab_rows(values)
        if records:
            # Sort alphabetically by field name within each report section
            records.sort(key=lambda r: r["field"].lower())
            sections[tab_name] = records

    if not sections:
        print("ERROR: no field rows found after parsing.", file=sys.stderr)
        return 2

    content = render_glossary(sections)

    tmp_dir = os.path.dirname(os.path.abspath(args.output))
    with tempfile.NamedTemporaryFile("w", encoding="utf-8",
                                     dir=tmp_dir, delete=False, suffix=".tmp") as tmp:
        tmp.write(content)
        tmp_path = tmp.name
    os.replace(tmp_path, args.output)

    rows_written = sum(len(r) for r in sections.values())
    print(json.dumps({
        "output": args.output,
        "rows_written": rows_written,
        "sections": list(sections.keys()),
    }))
    return 0


if __name__ == "__main__":
    sys.exit(main())
