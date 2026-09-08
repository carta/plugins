"""
Dept-crosstab adapter — a budget laid out as a department grid.

Target shape: a wide crosstab whose rows are hierarchical P&L / GL line
items and whose columns are per-department (Actual, Budget, Variance, %)
blocks. This is the common "Budget vs Actuals by department" tab.

Layout, all of it discovered from the file rather than hardcoded:
  Title band   Merged cells across the sheet width, above the header block.
  Dept row     Department super-headers, one per column block. Located by
               `_DEPT_ROW`; a department owns the columns from its own
               anchor up to the next anchor.
  Sub-detail   An optional second header row refining a department. Ignored
               for detection — the super-header is the department name.
  Sub-header   One of {Actual, Budget, Budget Variance, % of Budget,
               Comments} per column within each department block.
  Data rows    Col A = GL account_type (int), or comma-separated ints for
               multi-GL lines (e.g. "4170, 4175"), or None for
               subtotal/section-header rows. Col B = indented line name.

We mirror the tab's own outline. Rows keep the workbook's line items, in
the workbook's order, at the workbook's nesting depth — its section
headers, its groupings, its subtotals and its totals — with each
department's budget hanging off the row as a column value. Emitting only
the GL-coded lines would flatten a five-level hierarchy into a bare
account list and discard every subtotal the client reads the tab by.

Each row carries `row_kind`:

    section_header   a top-level band ("Income", "Operating Expenses")
    group_header     a grouping with no number of its own ("Salaries")
    line             a leaf item, usually GL-coded
    subtotal         an intermediate sum ("Total Salaries & Bonuses")
    total            a section or sheet-level sum ("Total Expenses")

and, where the workbook computes the row, a `calculated` block recording
the formula and which rows feed it — so the UI can show that a figure is
derived rather than entered, and from what.

A row counts as calculated only when its formula stays on this tab.
Leaf lines commonly pull their actuals from another sheet
(`=INDEX('Internal - P & L'!…)`); that's a parallel path to the same
numbers we source from Carta, and marking it would put a badge on nearly
every row while telling the reader nothing they can act on. A GL-coded
row is still marked when it sums other rows — some workbooks give a
subtotal its own account code.

Rows carrying no GL, no value, and no valued descendants are dropped:
workbooks accumulate scaffolding rows that exist only to hold a label.

Departments carrying only Actual/Budget/Variance (no % column) are handled;
so are tag_values with an extra Comments column. Both are found by
scanning sub-header positions within each department's own span rather
than assuming a fixed block width.

A department name repeated in the super-header row — common when a tab
carries both a per-person detail block and an aggregated block for the same
team — collapses to the last occurrence, which is the aggregate. Per-person
detail columns can be reintroduced as a separate dimension if a firm asks
for it.

Orphan sub-header columns with no department super-header above them
(a workbook authoring gap, seen in real files) are skipped with a stderr
warning; we never emit a row with a null dimension.
"""

from __future__ import annotations

import re
import sys
from datetime import datetime, timezone
from pathlib import Path

from openpyxl import load_workbook

from .gl_column import find_gl_header_column


# Row landmarks in the crosstab header block. Used only as a last resort —
# `_locate_header_rows` detects the real rows first; two real workbooks
# carry the sub-header one row higher than these values assume.
_DEPT_ROW = 5      # dept super-header
_SUBHEADER_ROW = 7  # Actual / Budget / Variance / % / Comments row
_FIRST_DATA_ROW = 8
_HEADER_SCAN_ROWS = 15           # how far down to look for the super-header row
_SUBHEADER_OFFSETS = (1, 2, 3)  # rows below a candidate super-header to check


def parse(workbook_path: str | Path, sheet_name: str, **_) -> dict:
    """Parse a tag-crosstab sheet into the universal budget.json shape.

    Returns a dict conforming to the schema documented in
    parse_budget_workbook.py — the caller writes it to disk.
    """
    wb_path = Path(workbook_path)
    wb = load_workbook(wb_path, data_only=True, read_only=False)
    if sheet_name not in wb.sheetnames:
        raise ValueError(
            f"Sheet {sheet_name!r} not found in {wb_path.name}. "
            f"Available: {wb.sheetnames}"
        )
    ws = wb[sheet_name]
    # A second load, formulas intact. openpyxl surfaces either the cached
    # value or the formula per load, never both, so aggregate rows need
    # the sheet read twice to report what they are AND how they got there.
    wsf = load_workbook(wb_path, data_only=False, read_only=False)[sheet_name]

    dept_row, subheader_row = _locate_header_rows(ws) or (_DEPT_ROW, _SUBHEADER_ROW)
    first_data_row = subheader_row + 1

    dept_blocks = _find_dept_blocks(ws, dept_row, subheader_row)
    if not dept_blocks:
        raise ValueError(
            f"No super-headers found in {sheet_name!r}. Scanned the first "
            f"{_HEADER_SCAN_ROWS} rows for one carrying two or more names "
            f"with a 'Budget' sub-header {_SUBHEADER_OFFSETS[0]}-"
            f"{_SUBHEADER_OFFSETS[-1]} rows beneath it, then fell back to "
            f"row {_DEPT_ROW}/{_SUBHEADER_ROW}. tag-crosstab needs a "
            "per-value column layout — a sheet with no such breakdown is "
            "likely pnl-outline (a hierarchical P&L, quarterly or monthly "
            "columns) or monthly-crosstab (a flat account list, real Jan-Dec "
            "columns). Re-run inspect_workbook.py and re-confirm the shape "
            "with the operator rather than retrying this one."
        )

    # A dedicated "Account #"-style column outranks column A when the
    # header names one — some workbooks give column A to a label instead.
    gl_col = find_gl_header_column(ws, range(1, subheader_row + 1)) or 1

    scanned = _scan_rows(ws, wsf, dept_blocks, first_data_row, gl_col)
    depth_of = _depth_scale(r["indent"] for r in scanned)
    kept = _drop_scaffolding(scanned)

    # Row number → emitted key, so a formula's cell references resolve to
    # the rows the reader can actually see.
    key_of = {r["row_ix"]: f"r{r['row_ix']}" for r in kept}

    rows: list[dict] = []
    for r in kept:
        row = {
            "key": key_of[r["row_ix"]],
            "row_kind": r["row_kind"],
            "label": r["label"],
            "depth": depth_of[r["indent"]],
        }
        if r["hidden"]:
            row["hidden"] = True
        if r["polarity"]:
            row["polarity"] = r["polarity"]
        if r["gl_codes"]:
            row["account_type"] = r["gl_codes"][0]
            if len(r["gl_codes"]) > 1:
                # Multi-GL lines ("4170, 4175") keep the full list so the
                # build script can match Carta actuals across every code.
                row["account_type_all"] = r["gl_codes"]
        if r["by_column"]:
            row["by_column"] = r["by_column"]
        if r["calculated"]:
            calc = dict(r["calculated"])
            calc["constituents"] = [
                key_of[n] for n in calc.pop("constituent_rows") if n in key_of
            ]
            row["calculated"] = calc
        rows.append(row)

    return {
        "period_year": _guess_period_year(ws),
        "tag_values": list(dept_blocks.keys()),
        # A dept crosstab is typically a "For the Period Ending <date>"
        # YTD snapshot, not a full-year budget. Consumers must NOT treat
        # rows[].annual as an annualized figure — it is
        # YTD-through-the-workbook\'s-as-of.
        "period_kind": "ytd_through_as_of",
        # The date the sheet itself says it runs through. Actuals are scoped
        # to it so both sides cover the same weeks.
        "period_end": _period_end(ws),
        # None on most crosstabs — see _period_start's own docstring for
        # why that's expected, not a parse miss.
        "period_start": _period_start(ws),
        "source": "excel-workbook",
        "workbook_meta": {
            "filename": wb_path.name,
            "sheet": sheet_name,
            "shape_adapter": "tag-crosstab",
            "parsed_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        },
        "dimensions": ["tag_value"],
        # view_kinds signals which layouts the UI can render for this
        # budget. A dept crosstab is YTD-only — no per-period detail to
        # slice by quarter — so only the dept crosstab makes sense.
        "view_kinds": ["by-tag-crosstab"],
        "rows": rows,
    }


_CELL_RX  = re.compile(r"\$?([A-Z]{1,3})\$?(\d+)")
_RANGE_RX = re.compile(r"\$?[A-Z]{1,3}\$?(\d+)\s*:\s*\$?[A-Z]{1,3}\$?(\d+)")
_TOTAL_LABEL_RX = re.compile(r"^(total|net)\b", re.IGNORECASE)


def _scan_rows(ws, wsf, dept_blocks, first_data_row: int, gl_col: int = 1) -> list[dict]:
    """Read every data row into an intermediate record.

    Classification happens here because it needs both loads of the sheet:
    the values decide whether a row carries numbers, the formulas decide
    whether it is derived.
    """
    out: list[dict] = []
    section = None
    for row_ix in range(first_data_row, ws.max_row + 1):
        raw_label = ws.cell(row_ix, 2).value
        label = str(raw_label).rstrip() if raw_label is not None else ""
        gl_codes = _parse_gl_codes(ws.cell(row_ix, gl_col).value)
        if not label.strip() and not gl_codes:
            continue

        # Column-B leading whitespace is the workbook's own outline level.
        indent = len(label) - len(label.lstrip())

        by_column: dict[str, dict] = {}
        for dept, cols in dept_blocks.items():
            budget_val = ws.cell(row_ix, cols["budget"]).value
            comment_val = (
                ws.cell(row_ix, cols["comment"]).value if cols.get("comment") else None
            )
            has_comment = isinstance(comment_val, str) and comment_val.strip()
            if budget_val is None and not has_comment:
                continue
            entry: dict = {}
            if budget_val is not None:
                try:
                    entry["budget"] = float(budget_val)
                except (TypeError, ValueError):
                    pass
            if has_comment:
                # A comment without a budget still tells the reader why a
                # line is empty (a hiring-delay note against a blank cell,
                # say), so it survives on its own.
                entry["comment"] = comment_val.strip()
            if entry:
                by_column[dept] = entry

        calculated = _calculated_for(wsf, row_ix, dept_blocks)
        # A grouping row often carries a literal 0 in every column rather
        # than an empty cell, so "has a number" can't mean "is a line" —
        # it has to mean a number that says something.
        has_value = any(e.get("budget") for e in by_column.values())

        titled_total = bool(_TOTAL_LABEL_RX.match(label.strip()))
        if calculated:
            kind = "total" if titled_total else "subtotal"
        elif titled_total and has_value and not gl_codes:
            # Says "Total" but we couldn't recover a formula — the cell is
            # typed, or computed on another sheet. It is still an aggregate
            # of the rows above it, and calling it a line would add it to
            # the very rows it sums. It just carries no provenance.
            #
            # A GL code overrides the label: workbooks post real accounts
            # under names like "Total Rent or Lease (all offices)", where
            # the rows above are empty scaffolding and this row holds the
            # money. Demoting it would drop that spend entirely.
            kind = "total"
        elif gl_codes or has_value:
            kind = "line"
        else:
            kind = "group_header" if indent else "section_header"

        if kind == "section_header":
            section = label.strip()

        # Whether a figure beating its budget is good news. Spending over
        # plan is bad; earning over plan is good, and colouring both the
        # same way reports a revenue shortfall as favourable. Read from the
        # GL prefix where there is one, else from the section the row sits
        # under, else from the label for a bottom-line row.
        out.append({
            "row_ix": row_ix,
            "label": label.strip(),
            # Rows the author collapsed in Excel. They still feed the
            # subtotals above them, so they are emitted rather than
            # dropped — but a reader of the tab does not see them.
            "hidden": bool(
                ws.row_dimensions[row_ix].hidden
                if row_ix in ws.row_dimensions else False
            ),
            "polarity": _polarity(gl_codes, section, label.strip()),
            "indent": indent,
            "gl_codes": gl_codes,
            "by_column": by_column,
            "calculated": calculated,
            "row_kind": kind,
            "has_value": has_value,
        })
    return out


_INCOME_SECTION_RX = re.compile(r"\b(income|revenue)\b", re.IGNORECASE)
_BOTTOM_LINE_RX = re.compile(r"^net\s+(income|profit|loss)\b", re.IGNORECASE)


def _polarity(gl_codes, section, label):
    """"income" when exceeding budget is good news, "expense" when it isn't.

    A bottom-line row is judged as income: earning more than planned is
    favourable there too, whatever the rows above it did.
    """
    if _BOTTOM_LINE_RX.match(label):
        return "income"
    for gl in gl_codes:
        head = str(gl)[:1]
        if head == "4":
            return "income"
        if head in ("5", "6", "7", "8"):
            return "expense"
    if section and _INCOME_SECTION_RX.search(section):
        return "income"
    return "expense"


def _calculated_for(wsf, row_ix, dept_blocks) -> dict | None:
    """Describe how the workbook derives this row, or None if it doesn't.

    Only formulas that stay on this tab count. A leaf line pulling its
    actuals from another sheet is not a subtotal, and badging it would
    tell the reader nothing they can follow on the page in front of them.

    Formulas across department columns are structurally identical — same
    row references, different column letter — so constituent rows are read
    once from whichever column has one, while the literal formula is kept
    per department for the drill-down to quote back.
    """
    per_dept: dict[str, str] = {}
    for dept, cols in dept_blocks.items():
        f = wsf.cell(row_ix, cols["budget"]).value
        if isinstance(f, str) and f.startswith("=") and "!" not in f:
            per_dept[dept] = f
    if not per_dept:
        return None

    # Prefer a formula that names other rows. A firm-total column is
    # typically the sum of the department columns on its own row
    # ("=D30+AC30+AI30+AO30"), which describes the same row across the
    # sheet rather than the rows feeding it.
    sample = None
    rows: list[int] = []
    for f in per_dept.values():
        candidate = [n for n in _formula_rows(f) if n != row_ix]
        if candidate:
            sample, rows = f, candidate
            break
    if sample is None:
        # Every column merely aggregates sideways. A firm-total column
        # sums the department columns on EVERY row, leaf lines included,
        # so treating that as derivation would badge the whole sheet. It
        # describes the column, not the row.
        return None
    pure = _is_pure_sum(sample)
    calc = {
        "kind": "sum" if pure else "expression",
        "formula_by_column": per_dept,
        "constituent_rows": rows,
    }
    if not pure:
        # A net-income line subtracts. Listing its inputs joined by "+"
        # would state the opposite of what the workbook computes, so the
        # operators are preserved for the UI to render literally.
        calc["expression"] = _operator_form(sample)
    return calc


def _formula_rows(formula: str) -> list[int]:
    """Row numbers a within-tab formula references, in reading order.

    Ranges expand ("C9:C11" → 9, 10, 11) so a subtotal over a block lists
    every row it covers rather than just its endpoints.
    """
    seen: list[int] = []

    def add(n: int) -> None:
        if n not in seen:
            seen.append(n)

    consumed: list[tuple[int, int]] = []
    for m in _RANGE_RX.finditer(formula):
        consumed.append(m.span())
        start, end = int(m.group(1)), int(m.group(2))
        for n in range(min(start, end), max(start, end) + 1):
            add(n)
    for m in _CELL_RX.finditer(formula):
        if any(s <= m.start() < e for s, e in consumed):
            continue
        add(int(m.group(2)))
    return seen


def _operator_form(formula: str) -> list[dict]:
    """Break a non-additive formula into ordered operand/operator tokens.

    "=D12-D130" becomes [{row: 12}, {op: "-"}, {row: 130}], so the UI can
    render the workbook's actual arithmetic against row labels instead of
    assuming addition.
    """
    body = formula.lstrip("=")
    tokens: list[dict] = []
    pos = 0
    for m in _CELL_RX.finditer(body):
        between = body[pos:m.start()].strip()
        for ch in between:
            if ch in "+-*/":
                tokens.append({"op": ch})
        tokens.append({"row": int(m.group(2))})
        pos = m.end()
    return tokens


def _is_pure_sum(formula: str) -> bool:
    """True when the formula only adds — SUM/SUBTOTAL over ranges, or a
    chain of additions. A subtraction (a net-income line) is an expression:
    calling it a sum of its parts would misstate what it does."""
    body = formula.lstrip("=")
    if re.fullmatch(r"(SUM|SUBTOTAL)\(.*\)", body, re.IGNORECASE):
        return True
    return "-" not in body and "*" not in body and "/" not in body


def _depth_scale(indents, tolerance: int = 1) -> dict[int, int]:
    """Map raw column-B indent widths onto contiguous levels.

    Workbooks indent by eye, so the widths that appear are arbitrary and
    unevenly spaced. Widths within `tolerance` of each other are the same
    level — sibling rows routinely differ by a space or two without the
    author intending a nesting change — and a wider gap starts a new one.
    Ranking this way preserves the hierarchy that was drawn while giving
    the UI a level it can turn into padding.
    """
    ordered = sorted(set(indents))
    scale: dict[int, int] = {}
    level = 0
    for i, width in enumerate(ordered):
        if i and width - ordered[i - 1] > tolerance:
            level += 1
        scale[width] = level
    return scale


def _drop_scaffolding(scanned: list[dict]) -> list[dict]:
    """Remove rows holding a label and nothing else.

    A row survives if it carries a number, a GL code, or is derived — or
    if it heads a run of deeper rows that do. That last case is what keeps
    a section header above its own contents while discarding the dead
    placeholder rows workbooks accumulate.
    """
    keep = [False] * len(scanned)
    for i, r in enumerate(scanned):
        if r["has_value"] or r["gl_codes"] or r["calculated"]:
            keep[i] = True
    # A row named by a surviving formula stays, even when it carries
    # nothing itself. Dropping it would leave the subtotal above it
    # citing fewer inputs than the workbook actually adds up, which reads
    # as a discrepancy in our output rather than an empty cell in theirs.
    cited = set()
    for i, r in enumerate(scanned):
        if keep[i] and r["calculated"]:
            cited.update(r["calculated"]["constituent_rows"])
    for i, r in enumerate(scanned):
        if r["row_ix"] in cited:
            keep[i] = True
    for i, r in enumerate(scanned):
        if keep[i]:
            continue
        for j in range(i + 1, len(scanned)):
            if scanned[j]["indent"] <= r["indent"]:
                break          # left this row's subtree
            if keep[j]:
                keep[i] = True
                break
    return [r for i, r in enumerate(scanned) if keep[i]]


def _collect_anchors(ws, row: int) -> list[tuple[int, str]]:
    """(col, text) for every non-empty string cell in `row` — a dept
    super-header's candidate anchors."""
    anchors: list[tuple[int, str]] = []
    for c in range(1, ws.max_column + 1):
        v = ws.cell(row, c).value
        if isinstance(v, str) and v.strip():
            anchors.append((c, v.strip()))
    return anchors


def _anchor_spans(anchors: list[tuple[int, str]], max_column: int) -> list[tuple[int, int]]:
    """Column span [start, end) each anchor owns, up to the next anchor."""
    cols = [c for c, _ in anchors] + [max_column + 1]
    return [(cols[i], cols[i + 1]) for i in range(len(anchors))]


def _spans_have_budget(ws, row: int, spans: list[tuple[int, int]]) -> bool:
    """Whether any span carries a literal 'Budget' cell in `row`."""
    for start, end in spans:
        for c in range(start, end):
            v = ws.cell(row, c).value
            if isinstance(v, str) and v.strip().lower() == "budget":
                return True
    return False


def _locate_header_rows(ws) -> tuple[int, int] | None:
    """Find the dept super-header row and, below it, the row that actually
    carries a 'Budget' sub-header — or None if no such pair exists.

    A row of two or more spaced-out text cells looks like a super-header,
    but so does a title band or a stray label row. What's specific to a
    real one is a nearby row below it naming 'Budget' within each
    candidate's own column span — checked across a small offset window
    because two real workbooks carry that row one line higher than others.
    A lone anchor is skipped: its "span" is the whole row width, which
    would match a 'Budget' cell anywhere below it regardless of layout.
    """
    max_dept_row = min(ws.max_row, _HEADER_SCAN_ROWS)
    for dept_row in range(1, max_dept_row + 1):
        anchors = _collect_anchors(ws, dept_row)
        if len(anchors) < 2:
            continue
        spans = _anchor_spans(anchors, ws.max_column)
        for offset in _SUBHEADER_OFFSETS:
            subheader_row = dept_row + offset
            if subheader_row > ws.max_row:
                break
            if _spans_have_budget(ws, subheader_row, spans):
                return dept_row, subheader_row
    return None


def _find_dept_blocks(ws, dept_row: int = _DEPT_ROW,
                       subheader_row: int = _SUBHEADER_ROW) -> dict[str, dict[str, int]]:
    """Walk `dept_row` → `subheader_row` and derive
    {dept_name: {budget_col, actual_col, ...}}.

    A dept "owns" the columns from its own anchor col up to (but not
    including) the next anchor col in `dept_row`. Within that span we
    locate the col whose sub-header value equals 'Budget' — that's the col
    we sample for `annual`. Depts with no Budget sub-header are skipped
    with a warning.

    A department name appearing twice collapses to the LAST occurrence,
    which is the aggregate block; an earlier block of the same name is
    per-person detail. Detail columns can be reintroduced as a separate
    dimension if a firm asks for it.
    """
    anchors = _collect_anchors(ws, dept_row)
    if not anchors:
        return {}

    spans = _anchor_spans(anchors, ws.max_column)
    seen: dict[str, dict[str, int]] = {}
    for (anchor_col, dept), (span_start, span_end) in zip(anchors, spans):
        # A dept's span can contain MULTIPLE Actual/Budget/Variance/%
        # sub-blocks, only the first of which carries real values (a
        # second is typically decorative or scratch). Take the FIRST
        # match per sub-header, not the last, so we don't silently pick
        # an empty column. The Comments column is optional — many dept
        # blocks don't have one; that's fine, we just won't emit
        # `comment` for those rows.
        budget_col = None
        actual_col = None
        comment_col = None
        for c in range(span_start, span_end):
            sub = ws.cell(subheader_row, c).value
            if isinstance(sub, str):
                s = sub.strip().lower()
                if s == "budget" and budget_col is None:
                    budget_col = c
                elif s == "actual" and actual_col is None:
                    actual_col = c
                elif s == "comments" and comment_col is None:
                    comment_col = c
        if budget_col is None:
            print(
                f"[tag_crosstab] warn: {dept!r} at col {anchor_col} has no "
                f"'Budget' sub-header in row {subheader_row}; skipping.",
                file=sys.stderr,
            )
            continue
        # A repeated dept name → keep the later block (the aggregate).
        seen[dept] = {
            "anchor":  anchor_col,
            "budget":  budget_col,
            "actual":  actual_col,
            "comment": comment_col,
        }
    return seen


_GL_CODE_RX = re.compile(r"\d{3,5}")


def _parse_gl_codes(value) -> list[int]:
    """Extract GL account codes from col A. Handles ints, floats-that-are-ints,
    and comma-separated strings like '4170, 4175'."""
    if value is None:
        return []
    if isinstance(value, int):
        return [value]
    if isinstance(value, float):
        if value.is_integer():
            return [int(value)]
        return []
    if isinstance(value, str):
        codes = [int(m) for m in _GL_CODE_RX.findall(value)]
        return codes
    return []


def _clean_label(value) -> str:
    """Strip the leading whitespace that indents nested lines in col B."""
    if value is None:
        return ""
    return str(value).strip()


_PERIOD_END_RX = re.compile(
    r"period\s+ending\s+([A-Z][a-z]+)\s+(\d{1,2}),?\s+(20\d{2})", re.IGNORECASE)
_MONTHS = ["january", "february", "march", "april", "may", "june", "july",
           "august", "september", "october", "november", "december"]


def _period_end(ws):
    """The date the sheet says it runs through, as ISO, or None.

    A crosstab states its own as-of in the title band ("For the Period
    Ending June 30, 2026"). Reading it matters because actuals are otherwise
    summed to today: a budget stated through June compared against spend
    through August charges the budget five weeks it never covered, and every
    variance reads high.

    What the band does NOT say is where the period STARTS. A year-to-date
    and a quarter-to-date tab can carry identical title bands — seen in a
    real workbook, where the only difference was the tab name. The start is
    asked for at ingest instead of guessed.
    """
    for r in range(1, 6):
        for c in range(1, 4):
            v = ws.cell(r, c).value
            if not isinstance(v, str):
                continue
            m = _PERIOD_END_RX.search(v)
            if not m:
                continue
            month = _MONTHS.index(m.group(1).lower()) + 1 if m.group(1).lower() in _MONTHS else None
            if not month:
                continue
            return f"{int(m.group(3)):04d}-{month:02d}-{int(m.group(2)):02d}"
    return None


_PERIOD_BEGINNING_RX = re.compile(
    r"\bbeginning\s+([A-Z][a-z]+)\s+(\d{1,2}),?\s+(20\d{2})", re.IGNORECASE,
)


def _period_start(ws):
    """The date the sheet itself says its period begins, as ISO, or None.

    None is the common case: most title bands state only an end (see
    _period_end) and never a start, which is why _require_period_start
    asks rather than guesses.
    """
    for r in range(1, 6):
        for c in range(1, 4):
            v = ws.cell(r, c).value
            if not isinstance(v, str):
                continue
            m = _PERIOD_BEGINNING_RX.search(v)
            if not m:
                continue
            month = _MONTHS.index(m.group(1).lower()) + 1 if m.group(1).lower() in _MONTHS else None
            if not month:
                continue
            return f"{int(m.group(3)):04d}-{month:02d}-{int(m.group(2)):02d}"
    return None


def _guess_period_year(ws) -> int | None:
    """Best-effort year extraction from the sub-title band
    (\'For the Period Ending <month> <day>, <year>\')."""
    for r in (2, 3):
        v = ws.cell(r, 2).value
        if isinstance(v, str):
            m = re.search(r"20\d{2}", v)
            if m:
                return int(m.group(0))
    return None
