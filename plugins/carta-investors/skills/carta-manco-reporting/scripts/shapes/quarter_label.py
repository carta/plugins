"""Quarter-label grammar shared by inspect_workbook.py (shape detection) and
pnl_outline.py (the adapter detection hands off to), so every header the
detector reads as a quarter is one the parser reads too.

Accepts either digit order ("Q1 2026", "1Q26"), a 2- or 4-digit year, any of
the separators a workbook author reaches for between the two (space, hyphen,
underscore, slash, or none at all), and a trailing qualifier letter some
firms append ("1Q25P" for "Plan", "1Q25A" for "Actual") — callers that care
which (see pnl_outline.py's `_detect_layout`) get it back as the third
tuple element.
"""

from __future__ import annotations

import re
from typing import Optional, Tuple

QUARTER_RX = re.compile(
    r"^(?:Q(?P<q_first>[1-4])|(?P<q_second>[1-4])Q)[\s\-_/]*"
    r"(?P<year>\d{2}|20\d{2})(?P<suffix>[A-Za-z]*)$",
    re.IGNORECASE,
)


def match_quarter_label(text) -> Optional[Tuple[int, int, Optional[str]]]:
    """(quarter, 4-digit year, suffix) for a quarter-label header cell like
    "Q1 2026", "1Q26" or "Q1-26"; None when `text` doesn't read as one.

    `suffix` is the trailing qualifier letter(s) the label states about
    itself ("A" for Actual, "P" for Plan, …), or None when the label states
    none — e.g. "1Q25A" matches `(1, 2025, "A")`, "Q1 2026" matches
    `(1, 2026, None)`.
    """
    if not isinstance(text, str):
        return None
    m = QUARTER_RX.match(text.strip())
    if not m:
        return None
    quarter = int(m.group("q_first") or m.group("q_second"))
    year = int(m.group("year"))
    if year < 100:
        year += 2000
    suffix = m.group("suffix") or None
    return quarter, year, suffix
