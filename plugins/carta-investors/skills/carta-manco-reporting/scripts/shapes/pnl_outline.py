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
                    of `key`s of the LINE rows they roll up (never another
                    aggregate's `total_key`). Budget comes from the
                    workbook's own cell (authoritative — a firm's own
                    department total does not always equal the sum of its
                    own subtotals, and we mirror what the client sees);
                    actuals are summed from constituents.
  - `children`    — for an aggregate row whose own formula names what it
                    sums, the row's direct children: a `key` for a line,
                    a `total_key` for another aggregate. `total_key`
                    identifies an aggregate row the way `key` identifies a
                    line, on its own counter: only line rows advance
                    `key_seq`, so a line's `key` — the address a recorded
                    budget-mapping decision uses — does not depend on how
                    many aggregate rows sit above it.
  - `child_signs` — one +1/-1 per `children` entry, in the same order —
                    the sign that row's own formula gives that child.
  - `children_complete`
                  — false when the formula behind `children` also adds a
                    number or a cross-sheet reference, so summing
                    `children` (even signed) won't fully explain the
                    row's own stated value.

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

from .quarter_label import match_quarter_label
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
# Precedence order for resolving a column when more than one qualifier is
# present in range: an exact "budget" match anywhere wins over a synonym at
# any distance, so a repeating [Actual, Budget, Forecast] block per quarter
# never has "Forecast" shadow the real "Budget" column just because it's
# nearer the label. Single source of truth: `_BUDGET_QUALIFIERS` below is
# derived from this tuple so a new synonym only needs to be added once.
_BUDGET_QUALIFIER_PRECEDENCE = ("budget", "proposal", "plan", "projection", "forecast")
# A qualifier of "budget" — or one of its synonyms, since firms name their
# planning column whatever they call the planning exercise itself — marks
# the planning columns; "actual" columns for prior periods often sit in the
# same header block.
_BUDGET_QUALIFIERS = frozenset(_BUDGET_QUALIFIER_PRECEDENCE)
_ACTUAL_QUALIFIER = "actual"
# A quarter label's own trailing suffix letter(s) that mark it as actuals
# (e.g. "1Q25A"), distinct from `_ACTUAL_QUALIFIER` which is a full word in
# a separate qualifier row rather than a letter tacked onto the label itself.
_ACTUAL_SUFFIX_TOKENS = frozenset({"a", "act"})
_QUALIFIER_TOKENS = frozenset({_ACTUAL_QUALIFIER}) | _BUDGET_QUALIFIERS
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


# --- Formula-derived totals tree -----------------------------------------
#
# A row whose own formula sums other same-sheet rows is a total; its
# children are whatever those rows are, line or another total. A row
# absent from the tree is placed by the keyword/indent state machine
# instead — the only path on a sheet with no live formulas this reader
# understands.
_RANGE_TERM_RX = re.compile(
    r"^(?:SUM|SUBTOTAL)\s*\(\s*(?:\d+\s*,\s*)?\$?([A-Za-z]+)\$?(\d+)\s*:"
    r"\s*\$?([A-Za-z]+)\$?(\d+)\s*\)$",
    re.IGNORECASE,
)
_CELL_TERM_RX = re.compile(r"^\$?([A-Za-z]+)\$?(\d+)$")
_SHEET_TERM_RX = re.compile(r"^(?:'[^']+'|[A-Za-z_][A-Za-z0-9_.]*)!")
_NUMERIC_TERM_RX = re.compile(r"^\d+(?:\.\d+)?$")
# A bound large enough that no real sheet's row numbers reach it — used by
# `_formula_sum_start_row` to read a formula's row references with no
# upper limit of its own.
_UNBOUNDED_ROW = 10 ** 9


def _split_top_level_terms(expr):
    """A formula's RHS split into signed terms at the `+`/`-` that sit
    outside any parentheses, so `SUM(A1:A5)-B2` splits into two terms, not
    three at the `-` inside the range."""
    terms = []
    depth = 0
    sign = 1
    i = 0
    n = len(expr)
    while i < n and expr[i] in "+-":
        if expr[i] == "-":
            sign = -sign
        i += 1
    buf_start = i
    while i < n:
        ch = expr[i]
        if ch in "([":
            depth += 1
        elif ch in ")]":
            depth -= 1
        elif ch in "+-" and depth == 0:
            terms.append((sign, expr[buf_start:i].strip()))
            sign = -1 if ch == "-" else 1
            buf_start = i + 1
        i += 1
    terms.append((sign, expr[buf_start:].strip()))
    return [(s, t) for s, t in terms if t]


def _classify_formula_term(term, min_row, max_row):
    """('rows', [row_ix, ...], is_range, is_subtotal) for a term that
    names same-sheet rows within range — `is_range` is whether it came
    from a SUM/SUBTOTAL(...) range rather than a bare cell reference, and
    `is_subtotal` is whether that range came specifically from SUBTOTAL,
    which Excel itself resolves by skipping any row in that range whose
    cell in that same column is itself a SUBTOTAL, to avoid counting a
    nested subtotal's rows twice; ('external', None, False, False) for a
    number or a cross-sheet reference (additive, but not a dependency);
    or ('bad', None, False, False) for anything this reader doesn't
    understand — a nested expression, a function other than SUM/SUBTOTAL,
    a 2-D range. 'bad' sends the whole formula to the keyword/indent
    heuristics rather than a partial, misleading read.
    """
    if _NUMERIC_TERM_RX.match(term) or _SHEET_TERM_RX.match(term):
        return ("external", None, False, False)
    m = _RANGE_TERM_RX.match(term)
    if m:
        col_a, r1, col_b, r2 = m.group(1), int(m.group(2)), m.group(3), int(m.group(4))
        if col_a.upper() != col_b.upper():
            return ("bad", None, False, False)
        lo, hi = min(r1, r2), max(r1, r2)
        is_subtotal = term.strip().upper().startswith("SUBTOTAL")
        return ("rows", [r for r in range(lo, hi + 1) if min_row <= r <= max_row], True, is_subtotal)
    m = _CELL_TERM_RX.match(term)
    if m:
        row = int(m.group(2))
        if min_row <= row <= max_row:
            return ("rows", [row], False, False)
        return ("external", None, False, False)
    return ("bad", None, False, False)


def _formula_terms(formula, min_row, max_row):
    """(terms, had_external) for this formula's own aggregation of this
    sheet, restricted to [min_row, max_row]: `terms` is the (row_ix, sign,
    is_range, is_subtotal) tuples it names — see `_classify_formula_term`
    — and `had_external` is whether it also added a number or a
    cross-sheet reference (so a tie check against `terms` alone can be
    off by that amount). Returns None — not a pair — when some term isn't
    a SUM/SUBTOTAL range, a same-sheet cell reference, a cross-sheet
    reference or a number, so this row's true aggregation can't be read
    with confidence.

    An empty `terms` list (not None) means the formula aggregates nothing
    on this sheet at all — a hardcoded number or a pure external
    reference — a leaf, not a total. Doesn't apply SUBTOTAL's own nested-
    subtotal exclusion (see `_aggregation_terms`): a formula handed here
    directly, such as Net Income's, isn't read against other rows' own
    formulas.
    """
    if not isinstance(formula, str) or not formula.startswith("="):
        return None
    terms = []
    had_external = False
    for sign, term in _split_top_level_terms(formula[1:].strip()):
        kind, value, is_range, is_subtotal = _classify_formula_term(term, min_row, max_row)
        if kind == "bad":
            return None
        if kind == "rows":
            terms.extend((r, sign, is_range, is_subtotal) for r in value)
        else:
            had_external = True
    return terms, had_external


_SUBTOTAL_PREFIX_RX = re.compile(r"^=\s*SUBTOTAL\s*\(", re.IGNORECASE)


def _aggregation_terms(wsf, layout, row_ix, lo, hi):
    """(terms, had_external, is_range) from the first column in
    `[total_col] + period_cols` whose own formula names at least one other
    same-sheet row within [lo, hi], or None when no such column exists.
    `terms` is [(child_row_ix, sign), ...].

    A term naming `row_ix` itself — a total-column formula like
    `=B4+C4+D4+E4` restating one row's own quarters across columns, not
    aggregating any other row — is dropped rather than read as a self-
    aggregate. A SUBTOTAL(...) range drops every row in it whose cell in
    that same column is itself a SUBTOTAL, the way Excel's SUBTOTAL
    function does, so a nested subtotal's lines are counted once, through
    it, not twice — checked in the exact column the range came from, since
    a row's aggregate formula can live in a different column (a dedicated
    TOTAL column, say) than the column a sibling range happens to span.
    """
    cols = list(layout["period_cols"])
    if layout.get("total_col"):
        cols = [layout["total_col"]] + cols
    for col in cols:
        f = wsf.cell(row_ix, col).value
        if not (isinstance(f, str) and f.startswith("=")):
            continue
        result = _formula_terms(f, lo, hi)
        if result is None:
            continue
        raw_terms, had_external = result
        is_range = any(is_r for _, _, is_r, _ in raw_terms)
        terms = []
        for r, sign, _, is_subtotal in raw_terms:
            if is_subtotal and _SUBTOTAL_PREFIX_RX.match(
                str(wsf.cell(r, col).value or "").strip()
            ):
                continue
            terms.append((r, sign))
        terms = [(r, s) for r, s in terms if r != row_ix]
        if terms:
            return terms, had_external, is_range
    return None


def _build_formula_tree(wsf, layout, first_row, last_row):
    """(tree, had_external_by_row): `tree[row_ix]` is the [(child_row_ix,
    sign), ...] that row's own formula aggregates on this sheet, via
    `_aggregation_terms`; `had_external_by_row` names every row whose
    formula also added a number or a cross-sheet reference, so a consumer
    summing `tree[row_ix]` knows that sum won't fully explain the row's
    own stated value.
    """
    tree = {}
    had_external_by_row = set()
    for row_ix in range(first_row, last_row + 1):
        result = _aggregation_terms(wsf, layout, row_ix, first_row, last_row)
        if result is None:
            continue
        terms, had_external, _ = result
        tree[row_ix] = terms
        if had_external:
            had_external_by_row.add(row_ix)
    return tree, had_external_by_row


def _find_net_income_row(ws, layout, first_row, last_row):
    """The first non-indented row matching `_NET_INCOME_RX` within
    [first_row, last_row], or None.
    """
    for row_ix in range(first_row, last_row + 1):
        raw = ws.cell(row_ix, layout["label_col"]).value
        if isinstance(raw, str) and raw == raw.lstrip() and _NET_INCOME_RX.match(raw.strip()):
            return row_ix
    return None


def _outline_stop_row(ws, layout, stop_label, first_row, last_row):
    """The row to bound the formula tree and the side map to: `stop_label`'s
    own row when one is given, else the first row `_find_net_income_row`
    finds (or `last_row`, when there is none). A sheet with no formulas
    this reader covers never needs either, so this rule — not full parity
    with every way `parse`'s own loop can end — is all that matters: don't
    read past a scenario block below the plan, or an earlier "Net
    Operating Income" line, into rows the tree has no business seeing.
    """
    if stop_label:
        for row_ix in range(first_row, last_row + 1):
            raw = ws.cell(row_ix, layout["label_col"]).value
            if isinstance(raw, str) and raw.strip() == stop_label:
                return row_ix
        return last_row
    return _find_net_income_row(ws, layout, first_row, last_row) or last_row


def _net_income_side_map(ws, layout, tree, net_income_row, net_income_formula,
                          first_row, last_row):
    """row_ix -> _SECTION_INCOME | _SECTION_OPEX for every row reachable,
    through `tree`, from Net Income's own formula.

    A row's side is the sign of its path from Net Income: each of Net
    Income's own terms is seeded with that term's sign times the sign of
    its own stated value (so an expense total entered as a negative
    number and added, not subtracted, still reads as Operating Expenses),
    and each step down the tree multiplies by that child's own formula
    sign. A positive accumulated sign is Income; anything else is
    Operating Expenses.

    Empty when Net Income carries no live formula, or isn't found: every
    row's side is then left to the keyword/indent state machine.
    """
    if net_income_row is None or not net_income_formula:
        return {}
    result = _formula_terms(net_income_formula, first_row, last_row)
    if result is None:
        return {}
    terms, _ = result
    if not terms:
        return {}

    side_by_row = {}
    stack = []
    for row_ix, sign, _, _ in terms:
        stated = _period_total(ws, row_ix, layout)
        value_sign = -1 if isinstance(stated, (int, float)) and stated < 0 else 1
        stack.append((row_ix, sign * value_sign))
    while stack:
        r, acc_sign = stack.pop()
        if r in side_by_row:
            continue
        side_by_row[r] = _SECTION_INCOME if acc_sign > 0 else _SECTION_OPEX
        for child_row, child_sign in tree.get(r, []):
            if child_row not in side_by_row:
                stack.append((child_row, acc_sign * child_sign))
    return side_by_row


def _peek_block_side(ws, layout, row_ix, last_row, side_by_row, lookahead=40):
    """The formula-derived side of the block a header at `row_ix` opens,
    or None when `side_by_row` doesn't cover any of it. Checked first
    against the block's own closing total — the row Net Income's formula
    actually names — then a short lookahead over its content, so a header
    whose own wording is ambiguous (no "income"/"expense" token) is
    still placed on the side its numbers actually roll up into.
    """
    if not side_by_row:
        return None
    closer = _next_total_row(ws, layout, row_ix + 1, last_row)
    if closer is not None and closer in side_by_row:
        return side_by_row[closer]
    stop = min(row_ix + lookahead, last_row)
    for r in range(row_ix + 1, stop + 1):
        if r in side_by_row:
            return side_by_row[r]
    return None


def _is_last_untagged_total(ws, layout, start_row, last_row):
    """Whether no further un-sectioned ("Total ...", `subsection is None`)
    row appears before the next header, scanning from `start_row`.

    Used only to decide whether an un-sectioned OPEX total just emitted is
    the section's real grand total or an intermediate summary (e.g.
    "Total GP Expenses"). A dept's own "Total <dept>" never reaches this
    scan — it fires with `subsection` still set — so it correctly keeps
    counting a dept-closing total in between as a reason to not be last.
    """
    for r in range(start_row, last_row + 1):
        raw = ws.cell(r, layout["label_col"]).value
        if not isinstance(raw, str):
            continue
        text = raw.strip()
        if not text:
            continue
        indented = raw != raw.lstrip()
        has_value = isinstance(_period_total(ws, r, layout), (int, float))
        if not indented and not has_value:
            return True  # a header — nothing more in this section
        if not indented and has_value and _TOTAL_RX.search(text):
            return False  # another un-sectioned total still ahead
    return True


def _formula_sum_start_row(wsf, row_ix, layout):
    """The earliest same-sheet row this row's own formula aggregates (via
    `_aggregation_terms`), or None when it isn't an aggregate — a
    hardcoded figure, a formula pulling from another tab, one
    `_aggregation_terms` can't read with confidence, or a formula naming
    only a single other row (a schedule pull, e.g. `Rent =B5`) without a
    SUM/SUBTOTAL range: a lone same-sheet reference restates another
    row's figure, it doesn't aggregate several into this one.
    """
    result = _aggregation_terms(wsf, layout, row_ix, 1, _UNBOUNDED_ROW)
    if result is None:
        return None
    terms, _, is_range = result
    rows = {r for r, _ in terms}
    if len(rows) < 2 and not is_range:
        return None
    return min(rows)


def _formula_for_row(wsf, layout, row_ix):
    """This row's own value formula, or None for a hard-coded figure.

    The total column when the sheet has one, else the first period column
    holding one — build_manco_datadir.py resolves it later, once every
    sibling row's own GL identity has settled.
    """
    cols = [layout["total_col"]] if layout.get("total_col") else list(layout["period_cols"])
    for col in cols:
        f = wsf.cell(row_ix, col).value
        if isinstance(f, str) and f.startswith("="):
            return f
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
    """The column nearest `label_col` whose qualifier reads as one of the
    budget qualifiers (Budget, Proposal, Plan, Projection, Forecast).

    The label's own column is checked FIRST, for ANY budget qualifier —
    not synonym-restricted — before any neighbor is considered. Otherwise a
    neighboring exact "budget" match can outrank the label's own column:
    for Q1-Q4 2025 (qualified "Budget") immediately followed by Q1-Q4 2026
    (qualified "Proposal"), every 2026 quarter label sits on its own
    Proposal column, but a 2025 Budget column is within the search radius
    of all four 2026 labels — so without this own-column check, all four
    2026 quarters would resolve to that same 2025 Budget column instead of
    their own Proposal column.

    Only once the label's own column is ruled out does the search fall
    back to neighbors, where an exact "budget" match anywhere within the
    search radius wins over a synonym at any distance — otherwise a
    repeating [Actual, Budget, Forecast] block per quarter can have the
    search land on a neighboring quarter's Forecast column (checked at a
    shorter distance) before it ever reaches this quarter's own Budget
    column.

    Returns None when there is no qualifier row to consult at all (a
    budget-only sheet, nothing to disambiguate from) or when no
    budget-qualified column turns up within the search radius — the caller
    decides what each of those means.
    """
    if qualifier_row is None:
        return None
    if _normalize_qualifier(ws.cell(qualifier_row, label_col).value) in _BUDGET_QUALIFIERS:
        return label_col
    for wanted in _BUDGET_QUALIFIER_PRECEDENCE:
        for dist in range(1, _BUDGET_COL_SEARCH_RADIUS + 1):
            for col in (label_col - dist, label_col + dist):
                if col < 1 or col > last_col:
                    continue
                if _normalize_qualifier(ws.cell(qualifier_row, col).value) == wanted:
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


def _resolve_period_axis(pairs, qualifier_row, ws):
    """The (col, year) pairs that make up a real bare-year or fund-life-band
    period axis, collapsing a repeated value to one column per year first.

    A firm's header can restate the same year once per qualifier column
    ("2026" over Actual, over Proposal, over Projection) rather than once
    per calendar year. Read left to right by column, distinct years must
    still strictly increase — the mark of a real period axis rather than
    coincidental numbers (an account code, a dollar amount) that happen to
    look like one — but a repeat is only resolvable when a qualifier row
    says which of the repeated columns is the budget one; that column wins
    over an actuals column with the same year. Returns None when this
    isn't a real period axis at all.
    """
    by_year: dict = {}
    for col, year in pairs:
        by_year.setdefault(year, []).append(col)

    resolved = []
    any_repeat = False
    for year, cols in by_year.items():
        if len(cols) == 1:
            resolved.append((cols[0], year))
            continue
        any_repeat = True
        if qualifier_row is None:
            return None
        # An exact "budget" match among the repeated columns wins over a
        # synonym (Proposal/Plan/Projection/Forecast) regardless of column
        # order — otherwise a leftmost-match scan can land on a Forecast
        # column that sits before the real Budget column in the same
        # repeat, e.g. [Actual, Forecast, Budget], or even a repeat with no
        # Actual column at all, e.g. [Forecast, Budget].
        budget_col = None
        for wanted in _BUDGET_QUALIFIER_PRECEDENCE:
            budget_col = next(
                (c for c in cols
                 if _normalize_qualifier(ws.cell(qualifier_row, c).value) == wanted),
                None,
            )
            if budget_col is not None:
                break
        if budget_col is None:
            return None
        resolved.append((budget_col, year))

    resolved.sort(key=lambda t: t[0])
    values = [n for _, n in resolved]
    if len(values) >= 2 and all(a < b for a, b in zip(values, values[1:])):
        return resolved
    # A single year is only a real axis when it came from a resolved
    # repeat — a qualifier row backed it as a deliberate budget column,
    # not a lone number that merely happens to look like a year.
    if len(values) == 1 and any_repeat:
        return resolved
    return None


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

    # The formula-derived totals tree, bounded to the rows `parse`'s own
    # loop below will actually read — a scenario block past the outline's
    # own bottom line, or an intermediate "Net Operating Income" summary
    # it stops at before a later literal "Net Income", must never be
    # consulted. Empty on a sheet with no live formulas this reader
    # understands — the state machine below then places every row.
    outline_last_row = _outline_stop_row(ws, layout, stop_label,
                                          layout["first_data_row"], ws.max_row)
    formula_tree, had_external_by_row = _build_formula_tree(
        wsf, layout, layout["first_data_row"], outline_last_row)
    net_income_row = _find_net_income_row(ws, layout, layout["first_data_row"], outline_last_row)
    net_income_formula = _formula_for_row(wsf, layout, net_income_row) if net_income_row else None
    side_by_row = _net_income_side_map(ws, layout, formula_tree, net_income_row,
                                        net_income_formula,
                                        layout["first_data_row"], outline_last_row)

    # A line row's own key, and a total/subtotal/summary row's own
    # `total_key`, kept in separate maps: only line rows advance `key_seq`,
    # so a line's `key` — the address a recorded budget-mapping decision
    # uses — does not depend on how many aggregate rows sit above it.
    line_key_by_row_ix: dict = {}
    total_row_by_row_ix: dict = {}

    def _apply_tree_rollup(row, row_ix):
        """Replaces `row`'s pending-list constituents with the formula
        tree's answer, when every row `row_ix`'s own formula names has
        already been emitted (as a line or as another total) — otherwise
        leaves the pending-list constituents in place, since a reference
        to a row not yet emitted (including `row_ix` itself) can't be
        resolved to a key at all.

        A child already emitted as a `line` contributes its own key. Any
        other already-emitted child is itself a total and contributes its
        own `constituents` (line keys only, by construction) rather than
        being re-read through the tree a second time — so a nested total
        this reader can't itself resolve (a hardcoded figure, a formula it
        doesn't understand) still contributes whatever its own pending-
        list scan gave it.
        """
        if row_ix not in formula_tree:
            return
        children_terms = formula_tree[row_ix]
        children_ix = [r for r, _ in children_terms]
        if not all(r in line_key_by_row_ix or r in total_row_by_row_ix for r in children_ix):
            return
        row["children"] = [
            line_key_by_row_ix.get(r) or total_row_by_row_ix[r]["total_key"]
            for r in children_ix
        ]
        row["child_signs"] = [s for _, s in children_terms]
        row["children_complete"] = row_ix not in had_external_by_row
        leaf_keys = []
        seen_rows = set()
        seen_keys = set()
        for r in children_ix:
            if r in seen_rows:
                continue
            seen_rows.add(r)
            candidate_keys = (
                [line_key_by_row_ix[r]] if r in line_key_by_row_ix
                else (total_row_by_row_ix[r].get("constituents") or [])
            )
            for key in candidate_keys:
                if key not in seen_keys:
                    seen_keys.add(key)
                    leaf_keys.append(key)
        row["constituents"] = leaf_keys

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
    total_key_seq = 0

    def _open_section(new_section):
        """Enters `new_section`, closing out whatever dept block and
        pending-line lists the previous section left open."""
        nonlocal section, subsection, subsection_section
        nonlocal pending_subtotal, pending_subsection, pending_section
        section = new_section
        subsection = subsection_section = None
        pending_subtotal, pending_subsection, pending_section = [], [], []

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
                _open_section(_SECTION_INCOME)
                rows.append({"row_kind": "section_header", "label": text,
                             "section": section, "depth": 0})
                continue
            if norm in _EXPENSE_ALIASES:
                _open_section(_SECTION_OPEX)
                rows.append({"row_kind": "section_header", "label": text,
                             "section": section, "depth": 0})
                continue
            # Not textbook wording. The formula tree wins over wording: a
            # heading with no "income"/"expense" token (e.g. "Payroll")
            # still opens the side its own numbers roll up into, per Net
            # Income's formula — checked first, so the income-by-default
            # fallback below never overrides what the tree already knows.
            word_hint = _section_hint(text)
            peeked = _peek_block_side(ws, layout, row_ix, outline_last_row, side_by_row)
            hint = word_hint
            # Failing both, open income on the first such row — a P&L
            # begins with what came in. Only applies before any section
            # has opened, so a mid-sheet note can't reset the state
            # machine, and only when the tree has no opinion at all.
            if hint is None and peeked is None and section is None and not seen_first_dept:
                hint = _SECTION_INCOME
            if peeked is not None and peeked != section:
                if word_hint is None:
                    # No wording of its own to announce a top-level
                    # section restatement — flip the section silently and
                    # fall through to the dept-opening check below, so its
                    # own closing total is read as a dept total rather
                    # than a bare firm-level one. `hint` is already None
                    # here (word_hint is None and the income-by-default
                    # fallback above only fires when peeked is None).
                    _open_section(peeked)
                else:
                    hint = peeked
            if hint is not None and (section is None or hint != section):
                _open_section(hint)
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
                total_key_seq += 1
                total_key = f"t{total_key_seq}"
                constituents = list(pending_section)
                pending_section = []
                row = {"row_kind": "total", "label": text, "total_key": total_key,
                       "section": section, "depth": 1,
                       "annual": annual, "monthly": monthly,
                       "comment": comment,
                       "constituents": constituents}
                _apply_tree_rollup(row, row_ix)
                rows.append(row)
                total_row_by_row_ix[row_ix] = row
                if not side_by_row and _TOTAL_RX.sub("", text).strip().lower() in _INCOME_ALIASES:
                    # Keyword-only fallback (no Net Income formula to
                    # consult): the Income GRAND total — "Total Income",
                    # "Total Revenue" — closes Income, so a following
                    # ambiguous header (no "expense" word either) reads as
                    # Operating Expenses instead of defaulting back to
                    # Income just because nothing explicit closed it. A
                    # subtotal within Income ("Total Mgmt Fees") does not
                    # close it. A formula-backed sheet instead relies on
                    # `_peek_block_side` above, which answers this per
                    # header from the tree itself.
                    section = _SECTION_OPEX
                continue
            if subsection is None and section == _SECTION_OPEX:
                # Firm-level opex total — rolls up every expense line
                # across all dept sub-sections (plus any un-sectioned
                # lines such as an uncategorized placeholder).
                total_key_seq += 1
                total_key = f"t{total_key_seq}"
                constituents = list(pending_section)
                if _is_last_untagged_total(ws, layout, row_ix + 1, ws.max_row):
                    pending_section = []
                row = {"row_kind": "summary", "label": text, "total_key": total_key,
                       "section": section, "depth": 0,
                       "annual": annual, "monthly": monthly,
                       "comment": comment,
                       "constituents": constituents}
                _apply_tree_rollup(row, row_ix)
                rows.append(row)
                total_row_by_row_ix[row_ix] = row
                continue
            # "Total <dept>" — closes the current dept sub-section. The
            # closing label need not repeat the sub-section's own label;
            # a block opened as an abbreviation is often closed with the
            # expanded name.
            total_key_seq += 1
            total_key = f"t{total_key_seq}"
            constituents = list(pending_subsection)
            pending_subsection = []
            pending_subtotal = []
            row = {"row_kind": "total", "label": text, "total_key": total_key,
                   "section": section, "subsection": subsection,
                   "tag_value": subsection, "depth": 1,
                   "annual": annual, "monthly": monthly,
                   "comment": comment,
                   "constituents": constituents}
            _apply_tree_rollup(row, row_ix)
            rows.append(row)
            total_row_by_row_ix[row_ix] = row
            subsection = subsection_section = None
            continue

        # A never-indented sheet only counts this as a subtotal when its own
        # formula sums preceding rows, or its wording says "Total".
        if not indented and subsection is not None and (
            any_indented or _looks_like_aggregate(wsf, row_ix, text, layout)
        ):
            total_key_seq += 1
            total_key = f"t{total_key_seq}"
            constituents = list(pending_subtotal)
            pending_subtotal = []
            row = {"row_kind": "subtotal", "label": text, "total_key": total_key,
                   "section": section, "subsection": subsection,
                   "tag_value": subsection, "depth": 2,
                   "annual": annual, "monthly": monthly,
                   "comment": comment,
                   "constituents": constituents}
            _apply_tree_rollup(row, row_ix)
            rows.append(row)
            total_row_by_row_ix[row_ix] = row
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
                if not gls:
                    formula = _formula_for_row(wsf, layout, row_ix)
                    if formula:
                        row["source_formula"] = formula
                        row["row_ix"] = row_ix
                line_key_by_row_ix[row_ix] = key
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
        mapped_vendor = _vendor_for(mapping, subsection_section, text, value_aliases)

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
            if mapped_vendor:
                row["vendor"] = mapped_vendor
        else:
            formula = _formula_for_row(wsf, layout, row_ix)
            if formula:
                row["source_formula"] = formula
                row["row_ix"] = row_ix
        rows.append(row)
        line_key_by_row_ix[row_ix] = key

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


# How many consecutive empty columns end the sheet's real, contiguous used
# block. A workbook can carry one stray far-right cell — a pasted note, a
# leftover test value — with nothing else near it; without a bound, that
# single cell makes openpyxl's own ws.max_column report thousands of
# columns, and every scan below would walk all of them for nothing.
_MAX_COL_GAP = 50


def _used_col_bound(ws, max_row, max_col, scan_rows):
    """The last column of the sheet's real, contiguous used block, scanning
    a handful of rows from the top rather than trusting `ws.max_column`
    whole — one isolated cell far to the right must not widen the header
    scan (or any other column loop) out to where it sits.
    """
    probe_rows = list(range(1, min(max_row, scan_rows + 20) + 1))
    last_used = 0
    gap = 0
    for c in range(1, max_col + 1):
        if any(ws.cell(r, c).value is not None for r in probe_rows):
            last_used = c
            gap = 0
        else:
            gap += 1
            if gap > _MAX_COL_GAP and last_used:
                break
    return last_used or max_col


def _detect_layout(ws, want_year=None, sheet_label="this sheet") -> dict:
    """Locate the budget columns, the comment column, and the period.

    Scans the top of the sheet for a row carrying period labels: quarterly,
    monthly, bare fiscal years, or fund-life bands. A nearby qualifier row
    ("Budget"/"Proposal"/"Plan"/"Projection"/"Forecast" vs. "Actual")
    resolves each period to its own budget sub-column, wherever the label
    itself happens to sit.
    """
    # Captured once: openpyxl grows max_row/max_column on any out-of-range
    # read, so the qualifier search below must not chase a moving target.
    # max_col is bounded to the sheet's contiguous used block, not the raw
    # ws.max_column, so one stray far-right cell can't widen every scan
    # below out to where it sits.
    max_row = ws.max_row
    max_col = _used_col_bound(ws, max_row, ws.max_column, _HEADER_SCAN_ROWS)
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
            mq = match_quarter_label(label) if isinstance(label, str) else None
            mt = _TOTAL_PERIOD_RX.match(label) if isinstance(label, str) else None
            mm = None if (mq or mt) else _month_index(label)
            if not (mq or mt or mm):
                continue
            label_year = (
                mq[1] if mq else
                int(mt.group(1)) if mt else
                mm[1]
            )

            own_qualifier = _normalize_qualifier(
                ws.cell(qualifier_row, c).value if qualifier_row else None
            )
            period_col = _resolve_budget_col(ws, qualifier_row, c, max_col)
            if period_col is None:
                # A non-budget qualifier with no budget sibling is safe to
                # drop unless it's the year being read — then it's ambiguous.
                if own_qualifier and own_qualifier not in _BUDGET_QUALIFIERS:
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
                suffix = (mq[2] or "").strip().lower()
                if qualifier_row is None and suffix in _ACTUAL_SUFFIX_TOKENS:
                    # No separate qualifier row to arbitrate, and the label
                    # states its own actuals suffix (e.g. "1Q25A") — never
                    # the budget axis. Leaving this column out lets an
                    # explicitly non-actuals sibling (e.g. "1Q25P") win the
                    # (year, quarter) slot below instead of whichever of the
                    # two happened to be read first.
                    continue
                by_year_q.setdefault(label_year, {}).setdefault(mq[0], period_col)
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
            "max_col":        max_col,
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

        resolved_years = _resolve_period_axis(year_cols, qualifier_row, ws)
        if resolved_years:
            years = sorted(n for _, n in resolved_years)
            year = _resolve_year(years, want_year, sheet_label, "annual")
            col = next(c for c, n in resolved_years if n == year)
            return {**base, "granularity": "annual", "period_year": year,
                    "total_col": None, "period_cols": [col]}

        resolved_bands = _resolve_period_axis(yearn_cols, qualifier_row, ws)
        if resolved_bands:
            bands = sorted(n for _, n in resolved_bands)
            band = _resolve_year(bands, want_year, sheet_label, "fund-life")
            col = next(c for c, n in resolved_bands if n == band)
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
    last_col = layout.get("max_col") or ws.max_column
    seen = 0
    for c in range(min(cols), last_col + 1):
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


def _vendor_for(mapping, section, label, aliases=None):
    """The vendor every matched mapping record agrees this line is scoped
    to — same reasoning as `_sub_account_for`, for a mapping tab that
    names which vendor a budget line's spend belongs to (e.g. a payroll
    line whose actuals should be read against one processor)."""
    vendors = set()
    for rec in (mapping or []):
        if not _section_matches((rec.get("section") or "").strip(), section, aliases):
            continue
        cat = (rec.get("category") or "").strip()
        if cat and cat == label.strip():
            vendor = (rec.get("vendor") or "").strip()
            if vendor:
                vendors.add(vendor)
    return vendors.pop() if len(vendors) == 1 else None


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
