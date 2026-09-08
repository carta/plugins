"""Monthly-crosstab adapter — a whole-ManCo budget, no department axis, real
Jan..Dec columns instead of tag_crosstab.py's YTD or pnl_outline.py's
quarterly-interpolated figures.

Emits a flat per-account list (dimensions: [], view_kinds: ["by-account"]) —
the same shape read_budgets() emits for a Carta-native budget, so this reuses
BudgetActualsAccounts.jsx as-is rather than a new, unvalidated frontend view.
Section headers and the workbook's own subtotals are dropped: that view
rebuilds Income/Expense from each row's account_type prefix and never reads
a hierarchy. Only the Budget column is read per month; actuals always come
from Carta journal entries, matching every other adapter here.

Not validated against a real customer workbook. Fails loudly (ValueError)
rather than guessing when the expected layout isn't found, same as
tag_crosstab.py and pnl_outline.py.
"""

from __future__ import annotations

import re
from datetime import date, datetime, timezone
from pathlib import Path

from openpyxl import load_workbook

from .gl_column import find_gl_header_column

_HEADER_SCAN_ROWS = 20
_MONTH_NAMES = ["jan", "feb", "mar", "apr", "may", "jun",
                "jul", "aug", "sep", "oct", "nov", "dec"]
_MONTH_FULL = ["january", "february", "march", "april", "may", "june",
               "july", "august", "september", "october", "november", "december"]

# "Jan", "January", "Jan-26", "Jan-2026", "Jan 2026", "Jan26".
_MONTH_RX = re.compile(
    r"^(" + "|".join(_MONTH_NAMES + _MONTH_FULL) + r")"
    r"[\s\-_/]*(\d{2}|\d{4})?$",
    re.IGNORECASE,
)

_SUBHEADERS = {"actual", "budget", "budget variance", "% of budget", "comments"}
_TOTAL_LABEL_RX = re.compile(r"^(total|net)\b", re.IGNORECASE)
_GL_CODE_RX = re.compile(r"\d{3,5}")


def _month_index(text):
    """(month 0-11, year|None), or None if `text` isn't a month label.

    A header typed as a real date arrives as a date, not the string "Jan".
    """
    if isinstance(text, date):
        return text.month - 1, text.year
    if not isinstance(text, str):
        return None
    m = _MONTH_RX.match(text.strip())
    if not m:
        return None
    name = m.group(1).lower()
    idx = _MONTH_NAMES.index(name) if name in _MONTH_NAMES else _MONTH_FULL.index(name)
    year_txt = m.group(2)
    if not year_txt:
        return idx, None
    year = int(year_txt)
    return idx, (year + 2000 if year < 100 else year)


def _detect_month_row(ws):
    """First row carrying all 12 month labels agreeing on one year (or none)."""
    max_col = min(ws.max_column, 120)
    for r in range(1, min(_HEADER_SCAN_ROWS, ws.max_row) + 1):
        cols, years = {}, set()
        for c in range(1, max_col + 1):
            v = ws.cell(r, c).value
            if isinstance(v, str) and not v.strip():
                continue
            hit = _month_index(v)
            if hit is None:
                continue
            idx, year = hit
            if idx in cols:
                continue
            cols[idx] = c
            if year is not None:
                years.add(year)
        if len(cols) == 12 and len(years) <= 1:
            return {"row": r, "cols": cols, "year": years.pop() if years else None}
    return None


def _find_subheader_row(ws, month_row, max_scan=4):
    """Row below the month labels carrying Actual/Budget/... markers."""
    for r in range(month_row + 1, min(month_row + 1 + max_scan, ws.max_row) + 1):
        for c in range(1, min(ws.max_column, 120) + 1):
            v = ws.cell(r, c).value
            if isinstance(v, str) and v.strip().lower() in _SUBHEADERS:
                return r
    return None


def _month_budget_cols(ws, subheader_row, month_cols):
    """Which column in each month's span carries the 'Budget' sub-header."""
    budget_col = {}
    ordered = sorted(month_cols.items())
    anchors = [c for _, c in ordered] + [ws.max_column + 1]
    for i, (midx, anchor) in enumerate(ordered):
        for c in range(anchor, anchors[i + 1]):
            v = ws.cell(subheader_row, c).value
            if isinstance(v, str) and v.strip().lower() == "budget":
                budget_col[midx] = c
                break
    return budget_col


def _looks_like_codes(ws, col, first_row, scan=40):
    """Whether a column holds GL codes rather than money or prose.

    A code is a bare integer; a budget is rarely one, and never one on most
    of its rows at once. Requiring a majority keeps a stray round figure
    from promoting a money column into the account key.
    """
    codes = seen = 0
    for r in range(first_row, min(ws.max_row, first_row + scan) + 1):
        v = ws.cell(r, col).value
        if v is None or (isinstance(v, str) and not v.strip()):
            continue
        seen += 1
        if isinstance(v, int) or (isinstance(v, str) and v.strip().isdigit()):
            codes += 1
    return seen > 0 and codes * 2 > seen


# How many figures a row states before it counts as part of the crosstab.
# One is a scratch note beside the table; a row of this grid states a
# figure per period, or at least a budget and what came in against it.
_MIN_ROW_FIGURES = 2


def _row_has_figures(ws, row_ix, first_col):
    """Whether a row states figures across the period columns.

    Read over every column, not just the Budget ones: a line the firm has
    not budgeted still belongs on the page when it carries actuals, and
    dropping it would hide real spend behind a blank.

    But more than one of them. A single number loose in the period region
    is a note somebody left beside the table, and admitting those turned
    twenty-five scratch rows into twenty-five budget accounts — which is
    precisely the "wrong region of the sheet" the credibility gate exists
    to refuse.
    """
    seen = 0
    for c in range(first_col, ws.max_column + 1):
        v = ws.cell(row_ix, c).value
        if isinstance(v, (int, float)) and not isinstance(v, bool):
            seen += 1
            if seen >= _MIN_ROW_FIGURES:
                return True
    return False


def _parse_gl_codes(value):
    if value is None:
        return []
    if isinstance(value, int):
        return [value] if 100 <= value <= 99999 else []
    if isinstance(value, float):
        return [int(value)] if value.is_integer() and 100 <= value <= 99999 else []
    if isinstance(value, str):
        return [int(m) for m in _GL_CODE_RX.findall(value)]
    return []


def _label_col(ws, header_row, scan=40):
    """Column holding row labels — usually B, detected rather than assumed."""
    counts = {c: 0 for c in (1, 2, 3)}
    for r in range(header_row + 1, min(ws.max_row, header_row + scan) + 1):
        for c in counts:
            v = ws.cell(r, c).value
            if isinstance(v, str) and v.strip() and not _parse_gl_codes(v):
                counts[c] += 1
                break
    best = max(counts, key=lambda c: (counts[c], -c))
    return best if counts[best] else 2


def parse(workbook_path, sheet_name, period_year=None, **_):
    wb_path = Path(workbook_path)
    wb = load_workbook(wb_path, data_only=True, read_only=False)
    if sheet_name not in wb.sheetnames:
        raise ValueError(
            "Sheet %r not found in %s. Available: %s"
            % (sheet_name, wb_path.name, wb.sheetnames)
        )
    ws = wb[sheet_name]

    layout = _detect_month_row(ws)
    if layout is None:
        raise ValueError(
            "Could not locate a row carrying all twelve month labels "
            "('Jan'..'Dec') within the first %d rows of %r. Is this the "
            "right sheet / shape?" % (_HEADER_SCAN_ROWS, sheet_name)
        )

    year = layout["year"]
    if year is None:
        if period_year is None:
            raise ValueError(
                "%r's month labels don't state a year, and nothing else on "
                "the sheet does either. Pass --period-year." % (sheet_name,)
            )
        year = period_year
    elif period_year is not None and period_year != year:
        raise ValueError(
            "%r's month labels state %d, but --period-year %d was passed."
            % (sheet_name, year, period_year)
        )

    subheader_row = _find_subheader_row(ws, layout["row"])
    if subheader_row is None:
        raise ValueError(
            "Found month labels in row %d of %r, but no Actual/Budget "
            "sub-header row beneath it. Is this the right sheet / shape?"
            % (layout["row"], sheet_name)
        )

    budget_col = _month_budget_cols(ws, subheader_row, layout["cols"])
    missing = [m for m in range(12) if m not in budget_col]
    if missing:
        names = ", ".join(_MONTH_NAMES[m].capitalize() for m in missing)
        raise ValueError(
            "%r is missing a 'Budget' sub-header under: %s."
            % (sheet_name, names)
        )

    label_col = _label_col(ws, subheader_row)
    first_data_row = subheader_row + 1
    first_month_col = min(layout["cols"].values())
    # A dedicated "Account #"-style header outranks any guess — some
    # workbooks give column A to a label and post GL codes elsewhere.
    gl_col = find_gl_header_column(ws, range(1, subheader_row + 1))
    if gl_col is None:
        # The neighbouring column of a month crosstab holds January's money,
        # and a budget of 4,067 parses as a GL code as readily as 4067 does.
        gl_col = 1 if label_col != 1 else 2
    # Whatever named or guessed it, a GL column has to hold GL codes. A
    # column headed "Account" can hold account NAMES — and then "401k match"
    # parses as account 401, a code the firm does not have, on a row whose
    # own name would have resolved it exactly.
    if not _looks_like_codes(ws, gl_col, first_data_row):
        gl_col = None

    rows = []
    for row_ix in range(first_data_row, ws.max_row + 1):
        raw_label = ws.cell(row_ix, label_col).value
        label = str(raw_label).strip() if raw_label is not None else ""
        gl_codes = _parse_gl_codes(ws.cell(row_ix, gl_col).value) if gl_col else []
        # A sheet with no GL column keys its rows by account name, which the
        # build resolves against the firm's own chart of accounts. Section
        # headers and the workbook's own subtotals are still dropped — the
        # by-account view rebuilds both for itself.
        if _TOTAL_LABEL_RX.match(label):
            continue
        if not gl_codes and not label:
            continue
        # A section band ("Income", "Operating Expenses") carries a label and
        # not one figure anywhere across the year. Keyed by GL code it never
        # reached this far; keyed by name it looks like an account until you
        # notice the row is empty.
        if not gl_codes and not _row_has_figures(ws, row_ix, first_month_col):
            continue

        monthly = [0.0] * 12
        for m in range(12):
            v = ws.cell(row_ix, budget_col[m]).value
            try:
                monthly[m] = float(v) if v is not None else 0.0
            except (TypeError, ValueError):
                monthly[m] = 0.0
        annual = round(sum(monthly), 2)
        if not label and not annual:
            continue

        row = {
            "row_kind": "line",
            "label": label or ("GL " + str(gl_codes[0])),
            "account_type": gl_codes[0] if gl_codes else None,
            "annual": annual,
            "budget_ytd": annual,
            "monthly": [round(v, 2) for v in monthly],
        }
        if len(gl_codes) > 1:
            row["account_type_all"] = gl_codes
        rows.append(row)

    if not rows:
        raise ValueError(
            "Found the month/sub-header layout in %r, but no row carried a "
            "label or a GL code beneath it. Is this the right sheet / shape?"
            % (sheet_name,)
        )

    return {
        "period_year": year,
        "period_kind": "annual",
        "source": "excel-workbook",
        "workbook_meta": {
            "filename": wb_path.name,
            "sheet": sheet_name,
            "shape_adapter": "monthly-crosstab",
            "parsed_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        },
        "dimensions": [],
        "view_kinds": ["by-account"],
        "rows": rows,
    }
