"""How a report's sheets and columns are shown: the name a blank header gets, which columns are
hidden by default, and the tab name Excel accepts for a sheet.

Shared by report_processor.py, excel_exporter.py and build_template_definition.py, so a saved
template holds what the screen and the workbook show. Stdlib only and Python 3.9-safe: the
template script imports it under the system interpreter.
"""

import re


def normalize_columns(columns):
    """Give unnamed columns a stable synthetic name matching the artifact engine.
    Marks them with _synthetic so the Excel export can restore the blank header."""
    result = []
    for i, col in enumerate(columns):
        if not col["name"]:
            result.append({**col, "name": f"Column {i + 1}", "_synthetic": True})
        else:
            result.append(col)
    return result


_ID_NAME_RE    = re.compile(r"(^id$|\bid$)", re.IGNORECASE)
_EMAIL_NAME_RE = re.compile(r"\bemail\b", re.IGNORECASE)
_UUID_RE       = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.IGNORECASE
)
_HASH_RE  = re.compile(r"^[0-9a-f]{24,}$", re.IGNORECASE)
_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

_SAMPLE_ROWS = 20


def _column_values_match(rows, idx, pattern, sample_size=_SAMPLE_ROWS):
    """True if every non-null sampled value in column idx matches pattern."""
    sample = [row[idx] for row in rows[:sample_size] if idx < len(row) and row[idx] not in (None, "")]
    if not sample:
        return False
    return all(pattern.match(str(v).strip()) for v in sample)


def detect_hidden_columns(columns, rows):
    """Tag columns that carry no end-user meaning with 'hidden': true.

    Detection is name- and value-based, never magnitude-based — a numeric ID
    column looks identical to a legitimate count/amount column by size alone,
    so guessing from magnitude would false-positive on real report data.
    Columns are tagged, not removed; they stay selectable in the Columns panel.
    """
    result = []
    for i, col in enumerate(columns):
        if col.get("hidden"):
            result.append(col)
            continue
        name  = col.get("name") or ""
        ctype = col.get("type")
        hide  = False

        if _ID_NAME_RE.search(name):
            hide = True
        elif _EMAIL_NAME_RE.search(name) and ctype in ("string", "text", None):
            hide = True
        elif ctype in ("string", "text", None):
            if _column_values_match(rows, i, _UUID_RE) or \
               _column_values_match(rows, i, _HASH_RE) or \
               _column_values_match(rows, i, _EMAIL_RE):
                hide = True

        result.append({**col, "hidden": True} if hide else col)
    return result


_EXCEL_INVALID = str.maketrans("", "", "[]\\/?*:")


def excel_sheet_name(name):
    """The tab name Excel accepts: its forbidden characters dropped, trimmed, at most 31 characters."""
    return (name.translate(_EXCEL_INVALID).strip() or "Sheet")[:31]
