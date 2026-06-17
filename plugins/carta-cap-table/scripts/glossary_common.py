"""
Shared Google Sheets fetch + parse logic for Carta cap-table field definitions.
Consumed by update-glossary.py (merge+sort+render to glossary.md) and
update-stonly-glossary.py (per-section, source-ordered records for Stonly sync).
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request

SHEETS_BASE = "https://sheets.googleapis.com/v4/spreadsheets"
COLUMN_HEADER_MARKER = "carta field"


def gcloud_token() -> str:
    try:
        result = subprocess.run(
            ["gcloud", "auth", "print-access-token"],
            capture_output=True,
            text=True,
            check=True,
        )
        return result.stdout.strip()
    except FileNotFoundError:
        print(
            "ERROR: gcloud is not installed or not on PATH.\n"
            "Install it:\n"
            "  macOS:   brew install --cask google-cloud-sdk\n"
            "  Windows: winget install Google.CloudSDK\n"
            "Then run: gcloud auth login --enable-gdrive-access",
            file=sys.stderr,
        )
        sys.exit(1)
    except subprocess.CalledProcessError as exc:
        print(
            f"ERROR: gcloud auth failed — {exc}\n"
            "Run: gcloud auth login --enable-gdrive-access",
            file=sys.stderr,
        )
        sys.exit(1)


def http_get(url: str, token: str) -> dict:
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
    try:
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode(errors="replace")
        print(f"ERROR: GET {url} → {exc.code}\n{detail}", file=sys.stderr)
        sys.exit(2)
    except urllib.error.URLError as exc:
        print(f"ERROR: GET {url} → network error: {exc.reason}", file=sys.stderr)
        sys.exit(2)


def list_visible_tabs(token: str, sheet_id: str) -> list[str]:
    url = f"{SHEETS_BASE}/{sheet_id}?fields=sheets.properties"
    data = http_get(url, token)
    return [
        s["properties"]["title"]
        for s in data.get("sheets", [])
        if not s["properties"].get("hidden", False)
    ]


def read_tab(token: str, sheet_id: str, tab: str) -> list[list[str]]:
    range_ = urllib.parse.quote(f"'{tab}'!A1:ZZ1000000")
    url = f"{SHEETS_BASE}/{sheet_id}/values/{range_}"
    return http_get(url, token).get("values", [])


def normalize_tabs(header: str) -> str:
    """Convert a section header into a short, clean Tabs string.

    Examples:
      "Summary tab"                                        → "Summary"
      "Intermediate and Detailed tabs"                     → "Intermediate, Detailed"
      "Securities ledgers by type and class - Share classes tabs" → "Share classes"
      "Equity Plan - Available report"                     → "Available"
    """
    # Take the part after " - " when present (descriptive prefix before a dash)
    if " - " in header:
        header = header.split(" - ", 1)[1]
    # Strip trailing "tab(s)" or "report" (case-insensitive)
    header = re.sub(r"\s+tabs?\s*$", "", header, flags=re.IGNORECASE)
    header = re.sub(r"\s+report\s*$", "", header, flags=re.IGNORECASE)
    # Convert " and " separators to ", "
    header = re.sub(r"\s+and\s+", ", ", header, flags=re.IGNORECASE)
    return header.strip()


def parse_tab_records(values: list[list[str]]) -> list[dict]:
    """Return pre-merge ordered records from one sheet tab's values.

    Each record: {field, type, section, definition}
    - section: the single, unmerged section heading at the row's parse position (never comma-joined)
      Contrast with parse_tab_rows's 'tabs' key, which merges duplicate (field, definition) pairs
      across sections into one comma-joined string.
    - No merging — rows with same (field, definition) under different sections are kept as separate entries
    - Source order is preserved
    Returns only rows that have both field and definition non-empty.
    """
    records: list[dict] = []
    current_section = ""

    for row in values:
        cells = [c.strip() for c in row]
        non_empty = [c for c in cells if c]

        if not non_empty:
            continue

        first = cells[0] if cells else ""

        if first.lower() == COLUMN_HEADER_MARKER:
            continue

        if len(non_empty) == 1:
            current_section = normalize_tabs(first)
            continue

        field = first
        definition = cells[1] if len(cells) > 1 else ""
        ftype = cells[2] if len(cells) > 2 else ""

        if not field or not definition:
            continue

        records.append({
            "field": field,
            "type": ftype,
            "section": current_section,
            "definition": definition,
        })

    return records
