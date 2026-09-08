"""
P&L outline adapter — a budget laid out as a hierarchical income statement.

Where the tag-crosstab adapter (tag_crosstab.py) reads a grid of
department columns, this one reads a workbook tab that reads top to bottom
like an operating plan: income lines, then expense lines grouped by team,
each group closed by its own subtotals and total, then a bottom summary.

The right way to render such a tab is to mirror the workbook's own outline —
the firm's line items, in the firm's order, with the firm's subtotals —
rather than re-projecting it into a crosstab it was never shaped as.

Emitted shape is therefore an OUTLINE, not a (dept × account) grid:

    section_header    "Income"
      line            "Fund II"                    (fund_match backfilled later)
      line            "4100 - Client Services"     gl_codes=[4175]
      total           "Total Income"
    section_header    "Operating Expenses"
      subsection      "CS"                         tag_value="Client Services"
        line          "Salaries"                   gl_codes=[7101] tag_value=…
        subtotal      "Salaries, Benefits, and Payroll Taxes"
        …
        total         "Total Client Services"
      subsection      "Investment" …
    summary           "Total Operating Expenses"
    summary           "State and Local Taxes"
    summary           "Net Income"

Join hints per row so the UI can resolve actuals:
  - `fund_match`  — per-fund management-fee lines join against
                    accounts.json's fund_fee_entries. A ManCo's own
                    fee-income GL typically aggregates every fund and cannot
                    be split, so fund-side JEs are the only correct source.
                    NOT set here: this adapter has no view of the ManCo's
                    real fund roster, so a workbook's own fund shorthand
                    ("Fund II") can't be told apart from an ordinary income
                    line at parse time. build_manco_datadir.py's
                    `backfill_fund_match_from_roster` resolves it afterward,
                    once the real fund names are known.
  - `gl_codes`    — Carta GL account_type list; resolved via coa-mapping,
                    or natively when the label states its own Carta code.
  - `dept`        — department name for expense lines, so the UI can
                    constrain the GL match by REPORTING_TAGS Department.
  - `constituents`— for aggregate rows (subtotal/total/summary), the list
                    of `key`s of the line rows they roll up. Budget comes
                    from the workbook's own cell (authoritative — a firm's
                    own department total does not always equal the sum of
                    its own subtotals, and we mirror what the client sees);
                    actuals are summed from constituents.

Nothing about one firm's workbook is hardcoded here. Everything the parser
needs is discovered from the file it is handed:

  Header block  Located by scanning the first rows for period labels
                ("Q1 <year>" … "TOTAL <year>"). The qualifier row above it
                distinguishes budget columns from actual/forecast columns
                that often sit alongside them, so a tab carrying both is
                read correctly. `period_year` comes from those labels.
  Comment col   The header cell reading "Comments" or "Notes", when present.
  Sections      A non-indented row with no value opens a section. Standard
                P&L vocabulary (income/revenue, operating expenses) marks
                the two top-level sections; any other such row inside the
                expense section opens a department sub-section.
  Departments   Sub-section labels resolve onto the coa-mapping's own
                section vocabulary (see vocab.py), so an abbreviation in
                the budget tab still finds its mapped GL accounts.
  End of budget The outline stops after its first net-income line. Tabs
                commonly continue into alternate scenarios, cash-flow
                schedules and per-fund breakouts; those are supplementary
                analyses, not the budget. `--stop-label` overrides.

Line items are not reliably distinguishable by indentation alone — income
lines are frequently written flush-left while expense lines are indented —
so the parser runs a section state machine rather than trusting indent.
"""

from __future__ import annotations

import re
from datetime import date, datetime, timezone
from pathlib import Path

from openpyxl import load_workbook

from .vocab import tag_value_for_section, match_section

# Standard P&L section vocabulary. These are accounting terms, not any one
# firm's wording; a tab using different terms still parses, its sections
# just resolve by position (the first valueless row opens income).
_INCOME_ALIASES = {"income", "revenue", "revenues", "total revenue"}
_EXPENSE_ALIASES = {
    "operating expenses", "operating expense", "expenses", "expense", "opex",
}

_SECTION_INCOME = "Income"
_SECTION_OPEX = "Operating Expenses"

_HEADER_SCAN_ROWS = 12          # how far down to look for the period header
_QUARTER_RX = re.compile(r"^Q([1-4])\s+(20\d{2})$", re.IGNORECASE)
_TOTAL_PERIOD_RX = re.compile(r"^TOTAL\s+(20\d{2})$", re.IGNORECASE)
_COMMENT_HEADERS = {"comments", "comment", "notes", "note"}

# Monthly header labels, alternative to the quarterly ones above — same
# qualifier-row convention, twelve columns instead of four. Year is optional.
_MONTH_NAMES = ["jan", "feb", "mar", "apr", "may", "jun",
                "jul", "aug", "sep", "oct", "nov", "dec"]
_MONTH_FULL = ["january", "february", "march", "april", "may", "june",
               "july", "august", "september", "october", "november", "december"]
_MONTH_RX = re.compile(
    r"^(" + "|".join(_MONTH_NAMES + _MONTH_FULL) + r")"
    r"[\s\-_/]*(\d{2}|\d{4})?$",
    re.IGNORECASE,
)
_YEARLESS = object()  # by_year_m bucket for month headers stating no year
# A qualifier of "budget" marks the planning columns; actual/forecast
# columns for prior periods often sit in the same header block.
_BUDGET_QUALIFIER = "budget"
_QUALIFIER_TOKENS = ("budget", "actual", "forecast")
# The qualifier row isn't always directly above the label row (a real
# client file puts a date row in between), so a window finds it either way.
_QUALIFIER_ROW_WINDOW = 3
# A period's label sits over whichever sub-column the firm centered it on —
# often Actual, not Budget — so nearby columns must be searched too.
_BUDGET_COL_SEARCH_RADIUS = 4

# One column per calendar year ("2024", "FY2024") or per year-since-fund-
# inception ("Year 1" .. "Year N"), with no quarterly/monthly breakdown.
_BARE_YEAR_RX = re.compile(r"^(?:FY\s*)?(\d{4})$", re.IGNORECASE)
_YEAR_N_RX = re.compile(r"^Year\s+(\d+)$", re.IGNORECASE)
_BARE_YEAR_MIN, _BARE_YEAR_MAX = 1990, 2100

# An aggregate row announces itself with the word "total" somewhere in a
# non-indented label. Anchoring to the start only caught one house style;
# a firm writing "Qtrly Totals" got its section total read as another line
# item and counted twice into the section it was summing.
_TOTAL_RX = re.compile(r"\bTotals?\b", re.IGNORECASE)

# Section headers, for tabs that don't use the textbook words. Checked as
# substrings, after the exact aliases above, so "Mgmt Fees (Net)" opens
# income and "Main Fund Expenses" opens expenses. A budget is still a
# budget when its author calls the revenue section something else.
_INCOME_TOKENS = ("revenue", "income", "fee")
_EXPENSE_TOKENS = ("expense", "expenses", "cost", "spend", "opex")



# How far past a bare label to look for figures before calling it a spacer.
_HEADS_CONTENT_LOOKAHEAD = 6


def _heads_content(ws, row_ix, layout, last_row):
    """True when a value-less row is followed by rows carrying figures.

    Distinguishes a grouping header from a spacer or a trailing note
    without reading its wording, which is firm-specific.
    """
    stop = min(row_ix + _HEADS_CONTENT_LOOKAHEAD, last_row)
    for probe in range(row_ix + 1, stop + 1):
        if isinstance(_period_total(ws, probe, layout), (int, float)):
            return True
    return False


def _any_label_indented(ws, label_col, first_row, last_row):
    """Whether this sheet uses indentation as a structural signal at all.

    Some firms flush every label left and rely on wording and formulas
    instead — telling that up front lets the row loop stop trusting
    indentation on those sheets rather than misreading every value row.
    """
    for r in range(first_row, last_row + 1):
        raw = ws.cell(r, label_col).value
        if isinstance(raw, str) and raw != raw.lstrip():
            return True
    return False


_SUM_PREFIX_RX = re.compile(r"^=\s*(?:SUM|SUBTOTAL)\s*\(", re.IGNORECASE)
_FIRST_CELL_REF_RX = re.compile(r"[A-Za-z]+\$?(\d+)")


def _formula_sum_start_row(wsf, row_ix, layout):
    """The earliest row this row's own SUM/SUBTOTAL formula references, or
    None when it isn't one — a hardcoded figure, or a formula pulling from
    another tab, neither of which is an aggregate of rows on this sheet.
    """
    cols = list(layout["period_cols"])
    if layout.get("total_col"):
        cols = [layout["total_col"]] + cols
    for col in cols:
        f = wsf.cell(row_ix, col).value
        if isinstance(f, str) and _SUM_PREFIX_RX.match(f.strip()):
            m = _FIRST_CELL_REF_RX.search(f)
            if m:
                return int(m.group(1))
    return None


def _looks_like_aggregate(wsf, row_ix, text, layout):
    """Whether a value row is positively an aggregate, independent of
    indentation: its wording says "Total", or its own formula sums rows
    that come before it on this sheet.
    """
    if _TOTAL_RX.search(text):
        return True
    start = _formula_sum_start_row(wsf, row_ix, layout)
    return start is not None and start < row_ix


def _next_total_row(ws, layout, start_row, last_row):
    """Nearest row at or after `start_row` whose label reads as a Total and
    carries a value — the aggregate that would close a block starting at
    `start_row`, if one does.
    """
    for r in range(start_row, last_row + 1):
        raw = ws.cell(r, layout["label_col"]).value
        if not isinstance(raw, str):
            continue
        text = raw.strip()
        if text and _TOTAL_RX.search(text) and isinstance(_period_total(ws, r, layout), (int, float)):
            return r
    return None


def _opens_dept_block(ws, wsf, layout, row_ix, last_row):
    """Whether a valueless, non-indented row genuinely opens a department
    block rather than being a placeholder sitting inside one already open.

    A real department's own Total sums from the row right after its
    header; a placeholder ("Fundraising expenses", "Further New Hires")
    sits inside a SUM range that already started earlier, so the
    workbook's own formula — not the row's wording — is the tell. Sheets
    with no live formulas fall back to whether any figure follows at all.
    """
    total_row = _next_total_row(ws, layout, row_ix + 1, last_row)
    if total_row is not None:
        start = _formula_sum_start_row(wsf, total_row, layout)
        if start is not None:
            return start >= row_ix
    return _heads_content(ws, row_ix, layout, last_row)


def _section_hint(text):
    """Which top-level section a header opens, or None."""
    t = text.lower()
    if any(tok in t for tok in _EXPENSE_TOKENS):
        return _SECTION_OPEX
    if any(tok in t for tok in _INCOME_TOKENS):
        return _SECTION_INCOME
    return None
# One optional qualifier: "Net Operating Income", "Net Ordinary Loss".
# Only consulted in the bottom-summary position, past every department
# block, so an income LINE named this way never reaches it.
_NET_INCOME_RX = re.compile(r"^Net\s+(?:\w+\s+)?(?:Income|Loss)\b", re.IGNORECASE)

# Mapping rows filed under a cross-cutting section apply to every
# department (a single firm-wide bonus account feeding each team's
# Bonuses line, say), so they survive the per-department filter.
_ALL_DEPTS_TOKENS = {"all departments", "all depts", "all", "shared"}


def _month_index(text):
    """(month 0-11, year|None) when `text` reads as a month label, else None.

    A workbook that types its header as a real date hands openpyxl a date,
    not the string "Jan" — the same column to a reader, invisible to a regex.
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


def _normalize_qualifier(v):
    return re.sub(r"\s+", " ", str(v).strip().lower()) if isinstance(v, str) else ""


def _find_qualifier_row(ws, header_row, last_col, last_row):
    """The row carrying Budget/Actual/Forecast sub-column labels, if any.

    Scores every row in a small window around `header_row` by how many
    cells read as one of those tokens, and keeps the highest scorer — so a
    stray "budget" mention elsewhere on the sheet can't outrank the real
    qualifier row, and the row is found whether it sits one above the
    label row or, as in a real client file, two below it. `last_col`/
    `last_row` bound the probe to the sheet's real extent — openpyxl grows
    `max_row`/`max_column` on any out-of-range read, so probing past them
    would silently inflate the sheet on every call.
    """
    best_row, best_hits = None, 0
    lo = max(1, header_row - _QUALIFIER_ROW_WINDOW)
    hi = min(header_row + _QUALIFIER_ROW_WINDOW, last_row)
    for r in range(lo, hi + 1):
        if r == header_row:
            continue
        hits = sum(
            1 for c in range(1, last_col + 1)
            if _normalize_qualifier(ws.cell(r, c).value) in _QUALIFIER_TOKENS
        )
        if hits > best_hits:
            best_row, best_hits = r, hits
    return best_row


def _resolve_budget_col(ws, qualifier_row, label_col, last_col):
    """The column nearest `label_col` whose qualifier reads Budget.

    Returns None when there is no qualifier row to consult at all (a
    budget-only sheet, nothing to disambiguate from) or when no Budget
    column turns up within the search radius — the caller decides what
    each of those means.
    """
    if qualifier_row is None:
        return None
    for dist in range(_BUDGET_COL_SEARCH_RADIUS + 1):
        cols = (label_col,) if dist == 0 else (label_col - dist, label_col + dist)
        for col in cols:
            if col < 1 or col > last_col:
                continue
            if _normalize_qualifier(ws.cell(qualifier_row, col).value) == _BUDGET_QUALIFIER:
                return col
    return None


def _bare_year_or_ordinal(v):
    """("year", 2025) for a bare fiscal-year header cell, ("yearn", 3) for
    a fund-life band ("Year 3"), else None.

    The two are kept apart because only the first states a real calendar
    year; "Year N" counts from the fund's own inception.
    """
    if isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        if float(v).is_integer() and _BARE_YEAR_MIN <= int(v) <= _BARE_YEAR_MAX:
            return "year", int(v)
        return None
    if not isinstance(v, str):
        return None
    text = v.strip()
    m = _BARE_YEAR_RX.match(text)
    if m:
        n = int(m.group(1))
        return ("year", n) if _BARE_YEAR_MIN <= n <= _BARE_YEAR_MAX else None
    m = _YEAR_N_RX.match(text)
    return ("yearn", int(m.group(1))) if m else None


def _strictly_increasing_cols(pairs):
    """True when, read left to right by column, the values strictly
    increase — the mark of a real period axis rather than coincidental
    numbers (an account code, a dollar amount) that happen to look like one.
    """
    ordered = sorted(pairs, key=lambda t: t[0])
    values = [n for _, n in ordered]
    return len(values) >= 2 and all(a < b for a, b in zip(values, values[1:]))


def parse(workbook_path, sheet_name, mapping_records=None,
          value_aliases=None, stop_label=None, period_year=None, **_):
    wb_path = Path(workbook_path)
    wb = load_workbook(wb_path, data_only=True, read_only=False)
    if sheet_name not in wb.sheetnames:
        raise ValueError(
            f"Sheet {sheet_name!r} not found in {wb_path.name}. "
            f"Available: {wb.sheetnames}"
        )
    ws = wb[sheet_name]
    # A second load, formulas intact — telling a row's own SUM from a leaf
    # line needs the formula, which a data_only load never keeps.
    wsf = load_workbook(wb_path, data_only=False, read_only=False)[sheet_name]
    mapping = mapping_records or []
    layout = _detect_layout(ws, want_year=period_year, sheet_label=repr(sheet_name))
    any_indented = _any_label_indented(ws, layout["label_col"], layout["first_data_row"], ws.max_row)

    # Section vocabulary the coa-mapping filed its rows under, and the
    # department names the rest of the pipeline keys on.
    sections: list[str] = []
    for rec in mapping:
        s = (rec.get("section") or "").strip()
        if s and s not in sections:
            sections.append(s)
    vocabulary = list(value_aliases.keys()) if value_aliases else []

    rows: list[dict] = []
    section = None          # "Income" | "Operating Expenses" | None (bottom summary)
    subsection = None       # canonical dept name, when inside a dept block
    subsection_section = None   # the mapping section that dept resolved from
    seen_first_dept = False # once true, a non-dept non-indented row after the
                            # last dept total belongs to the bottom summary
    # Line keys pending rollup into the next subtotal / dept total /
    # section total. Reset at the appropriate boundaries.
    pending_subtotal: list[str] = []
    pending_subsection: list[str] = []
    pending_section: list[str] = []
    key_seq = 0

    for row_ix in range(layout["first_data_row"], ws.max_row + 1):
        raw = ws.cell(row_ix, layout["label_col"]).value
        if raw is None:
            continue
        label = str(raw)
        text = label.strip()
        if not text:
            continue
        if stop_label and text == stop_label:
            break

        indented = label != label.lstrip()
        total_val = _period_total(ws, row_ix, layout)
        has_value = isinstance(total_val, (int, float))
        comment = _comment_at(ws, row_ix, layout["comment_col"])

        # --- Section header --------------------------------------------
        # Non-indented, carries no number: opens either a top-level P&L
        # section or, inside the expense section, a department block.
        if not indented and not has_value:
            norm = text.lower()
            if norm in _INCOME_ALIASES:
                section = _SECTION_INCOME
                subsection = subsection_section = None
                pending_subtotal, pending_subsection, pending_section = [], [], []
                rows.append({"row_kind": "section_header", "label": text,
                             "section": section, "depth": 0})
                continue
            if norm in _EXPENSE_ALIASES:
                section = _SECTION_OPEX
                subsection = subsection_section = None
                pending_subtotal, pending_subsection, pending_section = [], [], []
                rows.append({"row_kind": "section_header", "label": text,
                             "section": section, "depth": 0})
                continue
            # Not textbook wording. Fall back to what the header suggests,
            # and failing that open income on the first such row — a P&L
            # begins with what came in. Only applies before any section has
            # opened, so a mid-sheet note can't reset the state machine.
            hint = _section_hint(text)
            if hint is None and section is None and not seen_first_dept:
                hint = _SECTION_INCOME
            if hint is not None and (section is None or hint != section):
                section = hint
                subsection = subsection_section = None
                pending_subtotal, pending_subsection, pending_section = [], [], []
                rows.append({"row_kind": "section_header", "label": text,
                             "section": section, "depth": 0})
                continue
            if section == _SECTION_OPEX and _opens_dept_block(ws, wsf, layout, row_ix, ws.max_row):
                # A department sub-section. The label may be the firm's own
                # abbreviation, resolved onto the mapping's canonical name.
                subsection_section = match_section(text, sections)
                subsection = (
                    tag_value_for_section(subsection_section, vocabulary)
                    if subsection_section else ""
                ) or text
                seen_first_dept = True
                pending_subtotal, pending_subsection = [], []
                rows.append({"row_kind": "subsection_header", "label": text,
                             "section": section, "subsection": subsection,
                             "tag_value": subsection, "depth": 1})
                continue
            # Not textbook wording, and not inside the expense section. It
            # is still a header if rows carrying figures follow it — firms
            # name these after their own structure (a firm-chosen section name) rather
            # than in P&L vocabulary, and dropping them silently reparents
            # everything beneath onto whatever header came before.
            if (not _row_states_figures(ws, row_ix, layout)
                    and _heads_content(ws, row_ix, layout, ws.max_row)):
                rows.append({"row_kind": "section_header", "label": text,
                             "section": section, "depth": 0})
                continue
            if not _row_states_figures(ws, row_ix, layout):
                # A title band, a spacer, a trailing note. Nothing to emit.
                continue
            # Otherwise it states figures without budgeting any: fall
            # through and let it be the line it is.

        if not has_value:
            if not _row_states_figures(ws, row_ix, layout):
                # A label with no number and no structural role — skip.
                continue
            # Budgeted nothing, but the firm listed it and their own sheet
            # carries its actuals. It is a line at zero, and it has to stay
            # one: as a heading it reports no account at all, so its spend
            # belongs to nobody and appears nowhere on the page.
            total_val = 0.0

        annual = float(total_val)
        monthly = _period_to_monthly(ws, row_ix, layout)

        # --- Aggregate rows (Total …) ----------------------------------
        if not indented and _TOTAL_RX.search(text):
            if subsection is None and section == _SECTION_INCOME:
                constituents = list(pending_section)
                pending_section = []
                rows.append({"row_kind": "total", "label": text,
                             "section": section, "depth": 1,
                             "annual": annual, "monthly": monthly,
                             "comment": comment,
                             "constituents": constituents})
                continue
            if subsection is None and section == _SECTION_OPEX:
                # Firm-level opex total — rolls up every expense line
                # across all dept sub-sections (plus any un-sectioned
                # lines such as an uncategorized placeholder).
                constituents = list(pending_section)
                pending_section = []
                rows.append({"row_kind": "summary", "label": text,
                             "section": section, "depth": 0,
                             "annual": annual, "monthly": monthly,
                             "comment": comment,
                             "constituents": constituents})
                continue
            # "Total <dept>" — closes the current dept sub-section. The
            # closing label need not repeat the sub-section's own label;
            # a block opened as an abbreviation is often closed with the
            # expanded name.
            constituents = list(pending_subsection)
            pending_subsection = []
            pending_subtotal = []
            rows.append({"row_kind": "total", "label": text,
                         "section": section, "subsection": subsection,
                         "tag_value": subsection, "depth": 1,
                         "annual": annual, "monthly": monthly,
                         "comment": comment,
                         "constituents": constituents})
            subsection = subsection_section = None
            continue

        # A never-indented sheet only counts this as a subtotal when its own
        # formula sums preceding rows, or its wording says "Total".
        if not indented and subsection is not None and (
            any_indented or _looks_like_aggregate(wsf, row_ix, text, layout)
        ):
            constituents = list(pending_subtotal)
            pending_subtotal = []
            rows.append({"row_kind": "subtotal", "label": text,
                         "section": section, "subsection": subsection,
                         "tag_value": subsection, "depth": 2,
                         "annual": annual, "monthly": monthly,
                         "comment": comment,
                         "constituents": constituents})
            continue

        # A sheet with no department blocks never sets seen_first_dept, so
        # its bottom line would fall through and render as an ordinary line
        # item — a large budget with no account and no actual behind it.
        if (not indented and subsection is None
                and not seen_first_dept and _NET_INCOME_RX.match(text)):
            rows.append({"row_kind": "summary", "label": text,
                         "section": section, "depth": 0,
                         "annual": annual, "monthly": monthly,
                         "comment": comment, "derived": "net_income"})
            if stop_label is None:
                break
            continue

        # --- Bottom-summary lines --------------------------------------
        # Non-indented, has a value, past the dept blocks — an
        # uncategorized placeholder, a tax line, the net-income line.
        if not indented and seen_first_dept and subsection is None:
            key_seq += 1
            key = f"r{key_seq}"
            is_net_income = bool(_NET_INCOME_RX.match(text))
            gls = [] if is_net_income else _gl_codes_for(mapping, None, text,
                                                         value_aliases)
            row = {"row_kind": "summary" if is_net_income else "line",
                   "key": key, "label": text,
                   "section": section, "depth": 0 if is_net_income else 1,
                   "annual": annual, "monthly": monthly,
                   "comment": comment,
                   "gl_codes": gls}
            if is_net_income:
                # Net Income is derived, not summed from constituents —
                # the UI computes income − opex − taxes.
                row["derived"] = "net_income"
                row.pop("gl_codes", None)
                row.pop("key", None)
            else:
                pending_section.append(key)
            rows.append(row)
            if is_net_income and stop_label is None:
                # The budget ends at its own bottom line. Anything below is
                # a supplementary schedule — an alternate scenario, a cash
                # forecast, a per-fund breakout — not part of the plan.
                break
            continue

        # --- Line item --------------------------------------------------
        key_seq += 1
        key = f"r{key_seq}"
        gls = (_gl_codes_for(mapping, None, text, value_aliases)
               if section == _SECTION_INCOME
               else _gl_codes_for(mapping, subsection_section, text, value_aliases))
        mapped_sub = _sub_account_for(mapping, subsection_section, text, value_aliases)

        row = {
            "row_kind": "line",
            "key": key,
            "label": text,
            "section": section,
            "depth": 2 if section == _SECTION_OPEX else 1,
            "annual": annual,
            "monthly": monthly,
            "comment": comment,
        }
        if subsection:
            row["subsection"] = subsection
            row["tag_value"] = subsection
        if gls:
            row["gl_codes"] = gls
            if mapped_sub:
                row["sub_account"] = mapped_sub
        rows.append(row)

        pending_subtotal.append(key)
        pending_subsection.append(key)
        pending_section.append(key)

    return {
        "period_year": layout["period_year"],
        "period_kind": "annual",
        # "quarterly" (interpolated) or "monthly" (real per-month figures).
        "period_granularity": layout["granularity"],
        "source": "excel-workbook",
        "workbook_meta": {
            "filename": wb_path.name,
            "sheet": sheet_name,
            "shape_adapter": "pnl-outline",
            "parsed_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        },
        # Outline shape — rendered as the workbook's own P&L, not a dept
        # crosstab. The dept crosstab view is deliberately NOT offered for
        # this shape; dept context lives in the outline's sub-section
        # headers instead.
        "dimensions": [],
        "view_kinds": ["by-line-item"],
        "rows": rows,
    }


def _resolve_year(full_years, want_year, sheet_label, granularity):
    """Which year to read, given the candidate years a header row states.

    A header can carry many years in one row (Q1 2026 .. Q4 2038); picking
    blindly would label a multi-year plan as a single year.
    """
    if want_year is not None:
        if want_year not in full_years:
            raise ValueError(
                f"{sheet_label} states {granularity} budgets for "
                f"{', '.join(str(y) for y in full_years)}, but not {want_year}."
            )
        return want_year
    if len(full_years) == 1:
        return full_years[0]
    raise ValueError(
        f"{sheet_label} covers several years "
        f"({', '.join(str(y) for y in full_years)}); pass --period-year to "
        "say which one to read. Reading the first would report a prior "
        "year's plan as this year's budget."
    )


def _detect_layout(ws, want_year=None, sheet_label="this sheet") -> dict:
    """Locate the budget columns, the comment column, and the period.

    Scans the top of the sheet for a row carrying period labels: quarterly,
    monthly, bare fiscal years, or fund-life bands. A nearby qualifier row
    ("Budget"/"Actual"/"Forecast") resolves each period to its own Budget
    sub-column, wherever the label itself happens to sit.
    """
    # Captured once: openpyxl grows max_row/max_column on any out-of-range
    # read, so the qualifier search below must not chase a moving target.
    max_row, max_col = ws.max_row, ws.max_column
    for r in range(1, min(_HEADER_SCAN_ROWS, max_row) + 1):
        by_year_q: dict[int, dict[int, int]] = {}
        by_year_m: dict = {}
        totals: dict[int, int] = {}
        year_cols: list[tuple[int, int]] = []
        yearn_cols: list[tuple[int, int]] = []
        comment_col = None
        qualifier_row = _find_qualifier_row(ws, r, max_col, max_row)
        for c in range(1, max_col + 1):
            v = ws.cell(r, c).value
            bare = _bare_year_or_ordinal(v)
            if bare:
                (year_cols if bare[0] == "year" else yearn_cols).append((c, bare[1]))
            if isinstance(v, date):
                label = v
            elif isinstance(v, str):
                label = v.strip()
            else:
                continue
            if isinstance(label, str) and label.lower() in _COMMENT_HEADERS \
                    and comment_col is None:
                comment_col = c
                continue
            mq = _QUARTER_RX.match(label) if isinstance(label, str) else None
            mt = _TOTAL_PERIOD_RX.match(label) if isinstance(label, str) else None
            mm = None if (mq or mt) else _month_index(label)
            if not (mq or mt or mm):
                continue
            label_year = (
                int(mq.group(2)) if mq else
                int(mt.group(1)) if mt else
                mm[1]
            )

            own_qualifier = _normalize_qualifier(
                ws.cell(qualifier_row, c).value if qualifier_row else None
            )
            period_col = _resolve_budget_col(ws, qualifier_row, c, max_col)
            if period_col is None:
                # A non-Budget qualifier with no Budget sibling is safe to
                # drop unless it's the year being read — then it's ambiguous.
                if own_qualifier and own_qualifier != _BUDGET_QUALIFIER:
                    if want_year is not None and label_year in (None, want_year):
                        raise ValueError(
                            f"{sheet_label}: the {label!r} column's own "
                            f"qualifier reads {own_qualifier!r}, and no "
                            "Budget column sits near enough to use instead — "
                            "reading it as the budget would silently report "
                            "that qualifier's figures as the plan."
                        )
                    continue
                period_col = c

            if mq:
                by_year_q.setdefault(label_year, {}).setdefault(int(mq.group(1)), period_col)
            elif mt:
                totals.setdefault(label_year, period_col)
            else:
                midx, _ = mm
                by_year_m.setdefault(label_year if label_year is not None else _YEARLESS, {}) \
                    .setdefault(midx, period_col)

        full_q = sorted(y for y, q in by_year_q.items() if len(q) == 4)
        full_m = sorted(y for y, m in by_year_m.items()
                        if y is not _YEARLESS and len(m) == 12)
        yearless_full = len(by_year_m.get(_YEARLESS, {})) == 12

        # A missing total column means the periods should be summed.
        base = {
            "comment_col":    comment_col,
            "label_col":      _label_col(ws, r),
        }
        base["first_data_row"] = _first_data_row(ws, r, base["label_col"])

        if full_q:
            year = _resolve_year(full_q, want_year, sheet_label, "quarterly")
            return {**base, "granularity": "quarterly", "period_year": year,
                    "total_col": totals.get(year),
                    "period_cols": [by_year_q[year][q] for q in (1, 2, 3, 4)]}

        if full_m:
            year = _resolve_year(full_m, want_year, sheet_label, "monthly")
            return {**base, "granularity": "monthly", "period_year": year,
                    "total_col": totals.get(year),
                    "period_cols": [by_year_m[year][m] for m in range(12)]}

        if yearless_full:
            if want_year is None:
                raise ValueError(
                    f"{sheet_label} carries monthly budget columns (Jan..Dec) "
                    "that don't state a year, and nothing else on the sheet "
                    "does either. Pass --period-year to say which one this is."
                )
            return {**base, "granularity": "monthly", "period_year": want_year,
                    "total_col": totals.get(want_year),
                    "period_cols": [by_year_m[_YEARLESS][m] for m in range(12)]}

        if _strictly_increasing_cols(year_cols):
            years = sorted(n for _, n in year_cols)
            year = _resolve_year(years, want_year, sheet_label, "annual")
            col = next(c for c, n in year_cols if n == year)
            return {**base, "granularity": "annual", "period_year": year,
                    "total_col": None, "period_cols": [col]}

        if _strictly_increasing_cols(yearn_cols):
            bands = sorted(n for _, n in yearn_cols)
            band = _resolve_year(bands, want_year, sheet_label, "fund-life")
            col = next(c for c, n in yearn_cols if n == band)
            return {**base, "granularity": "annual", "period_year": band,
                    "total_col": None, "period_cols": [col]}

    raise ValueError(
        f"Could not locate the budget header row in {sheet_label} — expected "
        "a row carrying quarterly period labels ('Q1 <year>' … 'Q4 <year>'), "
        "monthly period labels ('Jan' … 'Dec'), bare fiscal years (2024, "
        "FY2024) or fund-life bands ('Year 1' … 'Year N') within the first "
        f"{_HEADER_SCAN_ROWS} rows. Is this the right sheet / shape?"
    )


def _label_col(ws, header_row: int, scan: int = 40) -> int:
    """The column holding row labels.

    Usually A, but a workbook that indents its whole outline one column —
    or reserves A for a code that is blank on most rows — puts them in B.
    Assuming A reads such a sheet as entirely empty and reports it as
    unparseable, which is what a sample size of one workbook taught us.

    Picks whichever of the first three columns carries the most text below
    the header.
    """
    counts = {c: 0 for c in (1, 2, 3)}
    for r in range(header_row + 1, min(ws.max_row, header_row + scan) + 1):
        for c in counts:
            v = ws.cell(r, c).value
            if isinstance(v, str) and v.strip():
                counts[c] += 1
                break
    best = max(counts, key=lambda c: (counts[c], -c))
    return best if counts[best] else 1


def _first_data_row(ws, header_row: int, label_col: int = 1) -> int:
    """First row below the header block carrying a label."""
    for r in range(header_row + 1, ws.max_row + 1):
        v = ws.cell(r, label_col).value
        if isinstance(v, str) and v.strip():
            return r
    return header_row + 1


def _comment_at(ws, row_ix, comment_col):
    if not comment_col:
        return None
    v = ws.cell(row_ix, comment_col).value
    return v.strip() if isinstance(v, str) and v.strip() else None


def _period_total(ws, row_ix, layout):
    """The row's figure for the whole period: the workbook's own total
    column when it has one, else the sum of its period columns."""
    tc = layout.get("total_col")
    if tc:
        v = ws.cell(row_ix, tc).value
        return v if isinstance(v, (int, float)) else None
    vals = [ws.cell(row_ix, c).value for c in layout["period_cols"]]
    nums = [v for v in vals if isinstance(v, (int, float))]
    return sum(nums) if nums else None


# How many figures a row states before it counts as one of the sheet's own
# lines. One is a placeholder or a note; a line of this budget states a
# figure per period, or at least a budget and what came in against it.
_MIN_ROW_FIGURES = 2


def _row_states_figures(ws, row_ix, layout):
    """Whether the row carries figures across the period region.

    `_period_total` reads the BUDGET columns only, which is right for the
    figure but wrong for deciding what a row IS. A line the firm listed and
    budgeted nothing for has empty budget cells and real Actual/Variance
    ones — an account with no plan, not a heading. A true section band
    ("Income", "Operating Expenses") states nothing anywhere.
    """
    cols = layout.get("period_cols") or []
    if not cols:
        return False
    seen = 0
    for c in range(min(cols), ws.max_column + 1):
        v = ws.cell(row_ix, c).value
        if isinstance(v, (int, float)) and not isinstance(v, bool):
            seen += 1
            if seen >= _MIN_ROW_FIGURES:
                return True
    return False


def _period_to_monthly(ws, row_ix, layout):
    """The row's monthly[12] figures — read directly when the header stated
    real months, spread evenly when it stated quarters, or left at zero
    for a bare-year/fund-life column that states no month-level split.
    """
    monthly = [0.0] * 12
    if layout["granularity"] == "annual":
        return monthly
    cols = layout["period_cols"]
    if layout["granularity"] == "monthly":
        for i, col in enumerate(cols):
            v = ws.cell(row_ix, col).value
            try:
                monthly[i] = float(v) if v is not None else 0.0
            except (TypeError, ValueError):
                monthly[i] = 0.0
        return monthly
    for i, qcol in enumerate(cols):
        v = ws.cell(row_ix, qcol).value
        try:
            q = float(v) if v is not None else 0.0
        except (TypeError, ValueError):
            q = 0.0
        per_month = round(q / 3.0, 2)
        monthly[i * 3]     = per_month
        monthly[i * 3 + 1] = per_month
        monthly[i * 3 + 2] = per_month
    return monthly


_NATIVE_GL_RX = re.compile(r"^([4-7]\d{3})\b")


def _native_gl_code(label):
    """A Carta GL account number the label states about itself (e.g. "4100
    - Client Fees") — four digits, leading 4-7, income/expense's own range.
    Stricter than `_gl_codes_for`'s mapping-lookup code so it doesn't
    misread a year or a plan name ("401k") off of arbitrary label text."""
    m = _NATIVE_GL_RX.match(label)
    return int(m.group(1)) if m else None


def _section_matches(rec_section, section, aliases):
    """Whether a mapping row and a budget row describe the same department.

    The two tabs of one workbook name departments to suit their own
    readers — one writes the short form, the other the full one — so an
    exact comparison skips most of the mapping. `aliases` is the
    reconciliation the mapping parse already derived.
    """
    if not section:
        return True
    a, b = _norm_dept(rec_section), _norm_dept(section)
    if a == b or a in _ALL_DEPTS_TOKENS:
        return True
    for wording, values in (aliases or {}).items():
        names = {_norm_dept(wording)} | {_norm_dept(v) for v in (values or [])}
        if a in names and b in names:
            return True
    return False


def _norm_dept(v):
    return " ".join(str(v or "").strip().lower().replace("&", "and").split())


def _sub_account_for(mapping, section, label, aliases=None):
    """The sub-account every matched mapping record agrees this line is.

    Two different ones mean the line spans them, which is not a scope.
    """
    subs = set()
    for rec in (mapping or []):
        if not _section_matches((rec.get("section") or "").strip(), section, aliases):
            continue
        cat = (rec.get("category") or "").strip()
        if cat and cat == label.strip():
            sub = (rec.get("sub_account") or "").strip()
            if sub:
                subs.add(sub)
    return subs.pop() if len(subs) == 1 else None


def _gl_codes_for(mapping, section, label, aliases=None):
    """Match a workbook line label to Carta GL codes: try the coa-mapping
    first (strict — equals the category, carries its leading code, or is
    one "+"-joined component; a loose substring match would pull "Salaries,
    Benefits, and Payroll Taxes (shared)"'s GL onto every "Salaries" line).
    With no mapping hit, fall back to a GL code the label states about
    itself — see `_native_gl_code`.
    """
    # Income and summary lines are commonly written as "4100 - <name>"; the
    # mapping's category cell carries the same code, so match on that first —
    # far more precise than name matching.
    code = None
    m = re.match(r"(\d{3,5})\b", label)
    if m:
        code = m.group(1)

    out, seen = [], set()
    for rec in (mapping or []):
        rec_section = (rec.get("section") or "").strip()
        if not _section_matches(rec_section, section, aliases):
            continue
        cat = (rec.get("category") or "").strip()
        if not cat:
            continue
        components = [c.strip() for c in cat.split("+")]
        # A label opening with a number states the workbook's own chart of
        # accounts, which need not be Carta's. The mapping names the line
        # without it, so compare both forms.
        bare = re.sub(r"^\s*\d{3,5}\s*[-–—:.]?\s*", "", label).strip()
        hit = (
            (code and code in cat)
            or cat == label
            or cat == bare
            or label in components
            or bare in components
        )
        if not hit:
            continue
        gl = rec.get("gl")
        if isinstance(gl, int) and gl not in seen:
            seen.add(gl)
            out.append(gl)
    if out:
        return sorted(out)

    native = _native_gl_code(label)
    return [native] if native is not None else []
