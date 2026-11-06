"""The `total_rows: N | offset: N | limit: N` banner the Carta MCP warehouse tool puts above a
result, read in one place. The tool writes `total_rows` with thousands separators from 1,000 up
(`total_rows: 1,000 | offset: 0 | limit: 1000`); every count here reads either form.

`total_rows` counts the rows the query returned, after its own SQL LIMIT, so a `LIMIT 1000` page
reports at most 1,000."""

import re

PREFIX = "total_rows:"
_COUNT = r"(\d{1,3}(?:,\d{3})+|\d+)(?![\d,])"
_TOTAL_RE = re.compile(rf"{PREFIX}\s*{_COUNT}")
BANNER_RE = re.compile(
    rf"{PREFIX}\s*{_COUNT}\s*\|\s*offset:\s*{_COUNT}\s*\|\s*limit:\s*{_COUNT}")


def to_int(count):
    return int(count.replace(",", ""))


def parse_banner_total(text):
    """The banner's `total_rows`, or None when the first non-blank line is not a banner."""
    first = next((ln for ln in text.splitlines() if ln.strip()), "")
    m = _TOTAL_RE.match(first)
    return to_int(m.group(1)) if m else None
