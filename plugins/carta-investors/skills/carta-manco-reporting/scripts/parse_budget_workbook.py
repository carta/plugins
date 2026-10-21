#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.9"
# dependencies = ["openpyxl>=3.1"]
# ///
"""
Parse a firm's budget Excel workbook into the universal budget.json schema
consumed by build_manco_datadir.py + the carta-manco-reporting dashboard.

Dispatches to a per-shape adapter under scripts/shapes/ based on --shape.
Each adapter takes (workbook_path, sheet_name) and returns a dict conforming
to the schema below. This top-level script writes that dict as JSON to --out.

Shapes describe workbook LAYOUTS, not firms. An adapter is written once per
layout and reused by every firm whose workbook is shaped that way; nothing
about a particular firm's vocabulary belongs in one. Where a workbook's own
labels have to be reconciled (a department abbreviated in one tab and spelled
out in another), adapters resolve them against the files they were handed —
see shapes/vocab.py.

Universal budget.json schema:

    {
      "period_year": 2026,
      "source": "excel-workbook",
      "workbook_meta": {
        "filename":       "...",
        "sheet":          "...",
        "shape_adapter":  "tag-crosstab",
        "parsed_at":      "2026-07-28T21:00:00+00:00"
      },
      "dimensions": ["tag_value"],       // ordered list of dim keys used in `rows`
      "rows": [
        {
          "account_name":     "Salary",
          "account_type":     7101,        // int; primary GL code
          "account_type_all": [7101, 7102],// optional; when a row aggregates multiple GLs
          "dimension":        {"tag_value": "Investment Team"},
          "monthly":          [null, null, ..., null],  // length-12; nulls where the workbook doesn't specify
          "annual":           180000
        }
      ]
    }

`monthly` is always length-12 (Jan..Dec, one slot per month). Adapters fill
in what they have — a dept crosstab is typically a YTD single-period sheet,
so only `annual` is populated. The build script treats missing `monthly` as
evenly distributed for chart rendering.

`dimensions` names the axis a shape slices on. A dept crosstab emits
`["tag_value"]`; an outline emits `[]` and is rendered as the workbook's
own P&L instead. Shapes slicing on other axes (by fund, by portfolio
company) emit their own key, and a shape carrying two concurrent axes on
one row would emit e.g. `["fund", "portco"]` with each `rows[i].dimension`
object carrying both keys.

`validation` is added here, not by any adapter — after `module.parse()`
returns, this script runs the parse-credibility gate (`_validate_budget`,
above `main()`) and stamps its output onto the budget before writing it,
so a consumer can show provenance ("this budget tied out against its own
stated totals") instead of taking a successful exit code on faith.

Adapters registered here (extend the SHAPES dict to add more):

    tag-crosstab     → shapes/tag_crosstab.py      tag value × (actual/budget/
                                                   variance) grid
    pnl-outline      → shapes/pnl_outline.py       hierarchical income statement
                                                   with quarterly columns
    monthly-crosstab → shapes/monthly_crosstab.py  whole-ManCo, no department
                                                   axis, real Jan..Dec columns
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

# Adapters live under scripts/shapes/, a sibling package of this file.
# Adjust sys.path so `import shapes.foo` works whether the user runs
# `uv run scripts/parse_budget_workbook.py` from any cwd — the one place
# this happens; `main()`'s late adapter import relies on it too.
sys.path.insert(0, str(Path(__file__).parent))
# `totals_tree` and `vocab` are both stdlib-only (unlike the adapter
# modules themselves, which need openpyxl), so importing them here costs
# nothing even for a pure-dict caller — see `_totals_readout` and
# `_plausibility_check`.
from shapes import totals_tree  # noqa: E402
from shapes.vocab import SECTION_INCOME, SECTION_OPEX  # noqa: E402

# Adapter registry. Keys are the values passed via --shape.
SHAPES = {
    # Columns are one reporting-tag's values. Named for the layout, not for
    # one firm's use of it: the same grid holds departments on one firm and
    # cost centres or funds on another.
    "tag-crosstab":     "shapes.tag_crosstab",
    "pnl-outline":      "shapes.pnl_outline",
    "monthly-crosstab": "shapes.monthly_crosstab",
}


# A tab whose name says it covers part of a year — quarter-to-date,
# month-to-date, a named quarter. Deliberately does NOT include a bare
# "monthly", which describes a column resolution, not a period.
_SUB_YEAR_RX = re.compile(
    r"\b(qtd|mtd|ytq|q[1-4]|quarter[\s-]to[\s-]date|month[\s-]to[\s-]date|quarter)\b",
    re.IGNORECASE,
)

_MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July",
                "August", "September", "October", "November", "December"]


def _require_period_start(budget, sheet, label):
    """Refuse a part-year sheet that never said where its period begins.

    A crosstab reads its END date off its own title band but cannot state
    its start, so an unanswered start silently defaults to January — on a
    quarter-to-date tab, charging a quarter of plan with a year of spend
    and reporting the difference as variance.
    """
    if budget.get("period_start"):
        return
    end = budget.get("period_end")
    if not end:
        # Nothing states an end either — this is an annual-shaped sheet and
        # January is the honest default.
        return
    hay = f"{sheet or ''} {label or ''}"
    if not _SUB_YEAR_RX.search(hay):
        return

    year, month = int(end[:4]), int(end[5:7])
    quarter_start = f"{year}-{((month - 1) // 3) * 3 + 1:02d}-01"
    raise ValueError(
        f"{sheet!r} looks like a part-year tab (its name says so) and its "
        f"title band says it ends {end}, but nothing in the sheet says where "
        f"the period begins — so actuals would be summed from January and "
        f"compared against a shorter budget.\n"
        f"  Pass --period-start. Likely values:\n"
        f"    --period-start {quarter_start}   (the quarter ending "
        f"{_MONTH_NAMES[month - 1]} {year})\n"
        f"    --period-start {year}-{month:02d}-01   (the month ending "
        f"{_MONTH_NAMES[month - 1]} {year})\n"
        f"    --period-start {year}-01-01   (year to date)"
    )


# Where a firm's stated total disagrees with its own parts the workbook
# wins, so drift is reported and never refused. Floored so a near-zero
# total isn't judged by ratio alone.
_TIE_OUT_REL_TOL = 0.05
_TIE_OUT_ABS_TOL = 50.0


def _tie_tolerance(stated: float, computed: float) -> float:
    """How far `computed` may drift from `stated` and still count as a tie."""
    return max(_TIE_OUT_ABS_TOL, _TIE_OUT_REL_TOL * max(abs(stated), abs(computed)))


def _signed_child(sign, label, value: float) -> str:
    """One child's line in a totals breakdown: a leading `-` when its
    parent's formula subtracts it, then its label and value. Shared by
    the tie-out mismatch message (`_tie_out_check`) and the totals
    readout's leaf lines (`_totals_readout`), so the two descriptions of
    what a total's children are always render alike.
    """
    return f"{'-' if sign < 0 else ''}{label}: {value:,.2f}"


# Off by a multiple, or against a sum of the opposite sign: the
# constituents are the wrong rows, not the client's arithmetic.
_TIE_OUT_GROSS_RATIO = 2.0

# Below FAIL_RATIO, the parse likely misread the sheet's region.
# Between the two, warn only — a stopped outline isn't a bad parse.
_COVERAGE_FAIL_RATIO = 0.10
_COVERAGE_WARN_RATIO = 0.30
# Below this many source rows a ratio is noise — a five-line template
# budget can legitimately emit two or three lines.
_COVERAGE_MIN_SOURCE_ROWS = 10

_TOTAL_LABEL_RX = re.compile(r"\b(totals?|net\s+income|net\s+loss)\b", re.IGNORECASE)


def _is_zero(value) -> bool:
    return value is None or abs(float(value)) < 1e-9


def _row_values(row: dict) -> dict:
    """This row's own figures, keyed by dimension value.

    A shape with no column axis (pnl-outline, monthly-crosstab) states one
    number per row under `annual`, keyed here by `None`. A tag crosstab
    states one per column under `by_column`; each column's figure is kept
    separate rather than collapsed into a firm-wide number the workbook
    itself never states in one cell. `by_dept` is the same field under the
    name older parsed budgets on disk still carry.
    """
    if row.get("annual") is not None:
        return {None: float(row["annual"])}
    by_column = row.get("by_column") or row.get("by_dept")
    if by_column:
        return {
            value: float(entry["budget"])
            for value, entry in by_column.items()
            if entry.get("budget") is not None
        }
    return {}


def _row_is_all_zero(row: dict) -> bool:
    values = _row_values(row)
    if any(not _is_zero(v) for v in values.values()):
        return False
    return not any(not _is_zero(v) for v in (row.get("monthly") or []))


def _constituent_keys(row: dict) -> list:
    if row.get("constituents"):
        return row["constituents"]
    calc = row.get("calculated") or {}
    return calc.get("constituents") or []


def _is_additive(row: dict) -> bool:
    """False for a row the workbook derives by subtraction (net income as
    income minus expense) rather than by summing. Adding its constituents
    would report roughly double the true figure, so tie-out skips a row
    it can't honestly check rather than compare against arithmetic the
    row doesn't actually do."""
    calc = row.get("calculated") or {}
    return calc.get("kind") != "expression"


def _is_header_kind(kind) -> bool:
    return str(kind or "").endswith("header")


def _is_total_kind(kind) -> bool:
    return kind in ("total", "subtotal", "summary")


def _lines_covered_by(rows: list, i: int) -> list:
    """The line rows a section's LAST total visibly sits over.

    A grand total is often derived by a formula that names only its final
    sub-block — a mgmt-fee grand total whose cell reads `=<last fund> +
    <creator>` while it plainly covers every fund line above it. Its
    recorded `constituents` then hold that short list, so a naive tie-out
    compares the whole-section figure against one line and refuses a parse
    that is actually correct.

    This is the exact widening the outline view already applies
    (`linesCoveredBy` in BudgetActualsOutline.jsx): only the LAST total
    before the next header gets it — an earlier total covers just its own
    run and is checked against its own constituents — and it gathers every
    `line` row back to the section header. Keeping the two in lockstep is
    the point: the credibility gate and the rendered total must agree on
    which lines a grand total sums.
    """
    if not _is_total_kind(rows[i].get("row_kind")):
        return []
    # Not the section's last total — leave it to its own constituents.
    for j in range(i + 1, len(rows)):
        if _is_header_kind(rows[j].get("row_kind")):
            break
        if _is_total_kind(rows[j].get("row_kind")):
            return []
    keys = []
    for j in range(i - 1, -1, -1):
        if _is_header_kind(rows[j].get("row_kind")):
            break
        if rows[j].get("row_kind") == "line" and rows[j].get("key"):
            keys.append(rows[j]["key"])
    return keys


def _all_zero_check(rows: list) -> dict:
    """Refuse a budget whose line rows are uniformly zero or blank.

    The single most dangerous failure mode found in the field: a parse
    that exits 0, prints a plausible row count, and reports a $0 budget
    as fact because every value cell was read as nothing.
    """
    lines = [r for r in rows if r.get("row_kind") == "line"]
    zero_lines = [r for r in lines if _row_is_all_zero(r)]
    message = None
    if not lines:
        # No line rows at all is worse than all-zero ones, and the
        # coverage check waives small sheets, so nothing else catches it.
        message = (
            "no line rows were emitted at all — the adapter found a header "
            "block but no budget beneath it. Pass --skip-validation if this "
            "sheet genuinely carries no line items."
        )
    elif len(zero_lines) == len(lines):
        message = (
            f"all {len(lines)} line row(s) are zero or blank across annual "
            "and monthly figures — this reads as a broken parse, not a real "
            "budget. Pass --skip-validation if this workbook is genuinely "
            "an all-zero template."
        )
    return {
        "name": "all_zero_refusal",
        "severity": "error",
        "passed": message is None,
        "line_row_count": len(lines),
        "zero_line_row_count": len(zero_lines),
        "message": message,
    }


# A single line this large reads as a units or formula error — a
# pay-period count multiplied into a figure, say — rather than a real
# expense. A client's own Audit tab once called out pay-period cells of
# 312,886 that drove one payroll line into the trillions this way. The
# figure is in the workbook's own currency, whatever that is — the parser
# never reads a currency code, so this can't be stated as a dollar cap,
# and a low-unit-value currency (JPY, KRW) can legitimately carry larger
# raw numbers for the same real spend.
#
# The CLI help text below reads this value directly; everywhere else
# that states it as prose and can't import it — references/budget-workbook.md's
# `2.75b-iii` intro and its `plausibility` bullet, references/errors.md,
# tests/carta-investors/test_budget_validation.py's own docstring, and
# the changeset that introduced this check — has to be updated by hand
# if this changes.
_PLAUSIBILITY_LINE_CAP = 1_000_000_000.0

# Opex this many times income catches opex inflated on its own — the
# pay-period case above, where income was read correctly and only opex
# blew up. It does NOT catch a sheet uniformly inflated by one multiple
# throughout (that leaves the ratio unchanged, so tie-out and coverage
# are still the only things that could catch that case, and neither can
# tell a scaled-up sheet from a correct one). It also fires on an
# ordinary pre- or first-close ManCo plan whose fee income hasn't started
# yet — a real budget, not a units error — so a refusal here is a
# question to ask the operator, not an assumed defect.
#
# Same restated-by-hand caveat as `_PLAUSIBILITY_LINE_CAP` above.
_PLAUSIBILITY_OPEX_INCOME_RATIO = 20.0


def _plausibility_check(rows: list) -> dict:
    """Refuse a budget whose own magnitudes read as a parse or units
    error rather than a real operating plan.

    Two independent triggers, either of which refuses:
      - a line's own annual figure exceeds `_PLAUSIBILITY_LINE_CAP`
      - opex exceeds income by more than `_PLAUSIBILITY_OPEX_INCOME_RATIO`

    Reads `section` (`SECTION_INCOME` / `SECTION_OPEX`) when a row
    carries one — only the pnl-outline adapter sets it — so the
    opex/income ratio is silently skipped for a shape with no P&L section
    of its own (a dept crosstab, a whole-ManCo monthly sheet); the
    line-cap trigger applies regardless of shape.
    """
    lines = [r for r in rows if r.get("row_kind") == "line"]

    huge = []
    for r in lines:
        for val in _row_values(r).values():
            if abs(val) > _PLAUSIBILITY_LINE_CAP:
                huge.append((r.get("label"), val))
                break

    income = sum(abs(v) for r in lines if r.get("section") == SECTION_INCOME
                 for v in _row_values(r).values())
    opex = sum(abs(v) for r in lines if r.get("section") == SECTION_OPEX
               for v in _row_values(r).values())

    reasons = []
    if huge:
        shown = "; ".join(f"{label!r}: {val:,.2f}" for label, val in huge[:5])
        more = f" (+{len(huge) - 5} more)" if len(huge) > 5 else ""
        reasons.append(
            f"{len(huge)} line row(s) exceed {_PLAUSIBILITY_LINE_CAP:,.0f} "
            f"(workbook units): {shown}{more}"
        )
    if income > 0 and opex > _PLAUSIBILITY_OPEX_INCOME_RATIO * income:
        reasons.append(
            f"opex ({opex:,.2f}) is {opex / income:,.1f}x income ({income:,.2f})"
        )

    message = None
    if reasons:
        message = (
            "implausible magnitude — " + "; ".join(reasons) + ". Pass "
            "--skip-validation if this workbook's own figures are "
            "genuinely this large."
        )
    return {
        "name": "plausibility",
        "severity": "error",
        "passed": message is None,
        "message": message,
    }


def _rows_by_tree_id(rows: list) -> dict:
    """Every row, indexed by whichever tree id addresses it: a line's `key`
    or an aggregate's `total_key`. The one index every reader of a totals
    tree resolves `children` through, so the gate (`_tie_out_check`) and
    the readout (`_totals_readout`) always agree on what a child id is.
    """
    by_id = {}
    for r in rows:
        if r.get("key"):
            by_id[r["key"]] = r
        if r.get("total_key"):
            by_id[r["total_key"]] = r
    return by_id


def _tree_children_map(by_id: dict, row: dict):
    """Resolve a total's formula-derived `children` (each a line `key` or
    another total's `total_key`) to their rows, signed by `child_signs`.

    Returns `None` when the row carries no `children`, or when a child id
    doesn't resolve to an emitted row — never a partial list.

    Callers check `children_complete` themselves before calling this: a
    row whose formula adds more than its `children` (a constant or a
    cross-sheet value) can't be explained by children alone, tree or not.
    """
    children_ids = row.get("children")
    if not children_ids:
        return None
    signs = row.get("child_signs") or [1] * len(children_ids)
    resolved = [(sign, by_id.get(cid)) for sign, cid in zip(signs, children_ids)]
    if any(cr is None for _, cr in resolved):
        return None
    return resolved


def _tie_out_check(rows: list) -> dict:
    """Compare each row the workbook states as a total against the rows it
    names as constituents.

    A row carrying a formula-derived totals tree (`children`/`child_signs`
    from the pnl-outline adapter) ties out against its direct children —
    a line's `key` or another total's `total_key` — signed by
    `child_signs`, so a total of subtotals (`=N46+N50+…`) ties correctly
    and a subtraction row (Net Income = Income − Expenses) is checked with
    each child's sign.

    A row whose `children_complete` is false adds more than its `children`
    name (a constant or a cross-sheet value) and is left unchecked here —
    the same as `_totals_readout` leaves it unmarked. It never falls back
    to leaf `constituents`: the pnl-outline adapter fills `constituents`
    with the unsigned leaf keys beneath those children, flattened through
    each child total's own `constituents`, so summing it would drop both
    the sign and the term the tree is missing.

    Only a row with no `children` at all, or with a `children` id that
    doesn't resolve to an emitted row (e.g. a cross-sheet pull the adapter
    couldn't follow), takes the leaf-constituents path: a `total`/
    `subtotal`/`summary` row_kind, or a label reading like one, that
    carries `constituents` (top-level, or nested under `calculated` for a
    dept crosstab's formula-derived rows). A total whose constituents
    don't fully resolve to emitted rows is skipped rather than compared
    against a partial sum, which would be more misleading than no check
    at all. When the recorded constituents don't tie, a section's last
    total is re-summed against the line rows it actually covers
    (`_lines_covered_by`) before it's called a mismatch — the same
    widening the outline view renders, so a grand total whose formula
    named only its final sub-block (e.g. a mgmt-fee total reading
    `<funds subtotal> + <creator>`) is not refused when the lines beneath
    it do add up.

    A mismatch's `message` names what the gate actually compared the
    total against. For a row tied out via its tree, that's each signed
    child by label and value — the question is about those specific rows,
    not a verdict on the parse. A row tied out via leaf `constituents`
    uses the "line rows sum to" wording, since there's no single child to
    point at.
    """
    by_id = _rows_by_tree_id(rows)
    key_to_row = {r["key"]: r for r in rows if r.get("key")}
    comparisons = []
    for i, row in enumerate(rows):
        is_total_like = _is_total_kind(row.get("row_kind")) or bool(
            _TOTAL_LABEL_RX.search(row.get("label") or "")
        )
        if not is_total_like:
            continue
        stated_map = _row_values(row)
        if not stated_map:
            continue

        if row.get("children") and not row.get("children_complete", True):
            continue

        tree_children = _tree_children_map(by_id, row)
        covered_map: dict = {}
        children_by_dim: dict = {}
        if tree_children is not None:
            for sign, cr in tree_children:
                for dim, val in _row_values(cr).items():
                    children_by_dim.setdefault(dim, []).append(
                        {"label": cr.get("label"), "sign": sign, "value": val})
            # Derived from `children_by_dim`, not summed separately, so a
            # mismatch's listed children always add up to the figure the
            # message reports they sum to.
            computed_map = {
                dim: sum(c["sign"] * c["value"] for c in children)
                for dim, children in children_by_dim.items()
            }
        else:
            if not _is_additive(row):
                continue
            keys = _constituent_keys(row)
            if not keys:
                continue
            constituent_rows = [key_to_row[k] for k in keys if k in key_to_row]
            if len(constituent_rows) != len(keys):
                continue

            computed_map = {}
            for cr in constituent_rows:
                for dim, val in _row_values(cr).items():
                    computed_map[dim] = computed_map.get(dim, 0.0) + val

            # Fallback sum over the line rows this total visibly sits over —
            # consulted only when the recorded constituents don't tie, so it
            # can rescue a correct-but-under-recorded total without ever
            # turning a genuine mismatch into a pass.
            for cr in (key_to_row[k] for k in _lines_covered_by(rows, i)
                       if k in key_to_row):
                for dim, val in _row_values(cr).items():
                    covered_map[dim] = covered_map.get(dim, 0.0) + val

        for dim, stated in stated_map.items():
            computed = computed_map.get(dim, 0.0)
            tolerance = _tie_tolerance(stated, computed)
            if abs(stated - computed) > tolerance and dim in covered_map:
                covered = covered_map[dim]
                cov_tol = _tie_tolerance(stated, covered)
                if abs(stated - covered) <= cov_tol:
                    computed, tolerance = covered, cov_tol
            children_detail = children_by_dim.get(dim) if tree_children is not None else None
            comparisons.append({
                "label": row.get("label"),
                "row_kind": row.get("row_kind"),
                "dimension": dim,
                "stated": stated,
                "computed": round(computed, 2),
                "tolerance": round(tolerance, 2),
                "within_tolerance": abs(stated - computed) <= tolerance,
                "gross": _is_gross_mismatch(stated, computed, tolerance),
                "children": children_detail,
            })

    mismatches = [c for c in comparisons if not c["within_tolerance"]]
    gross = [c for c in mismatches if c["gross"]]
    message = None
    if mismatches:
        def _describe(m):
            head = (
                f"{m['label']!r}"
                + (f" [{m['dimension']}]" if m["dimension"] else "")
                + f": workbook states {m['stated']:,.2f}, "
            )
            if m["children"]:
                # Names exactly what the total's own formula sums, so the
                # operator can see which child is missing, zero, or on the
                # wrong side without opening the workbook — the refusal is
                # a question about those rows, not a verdict on the parse.
                breakdown = "; ".join(
                    _signed_child(c["sign"], repr(c["label"]), c["value"])
                    for c in m["children"]
                )
                return (
                    head + "its own formula's children sum to "
                    f"{m['computed']:,.2f} (tolerance {m['tolerance']:,.2f}) — "
                    f"{breakdown}"
                )
            return (
                head + f"line rows sum to {m['computed']:,.2f} "
                f"(tolerance {m['tolerance']:,.2f})"
            )

        parts = [_describe(m) for m in (gross or mismatches)]
        lead = (
            "tie-out mismatch against the workbook's own stated total — "
            if gross else
            "the workbook's own stated total differs from the sum of its "
            "parts; reporting the workbook's figure — "
        )
        message = lead + "; ".join(parts)
    return {
        "name": "tie_out",
        "severity": "error" if gross else "warning",
        "passed": not mismatches,
        "comparisons": comparisons,
        "message": message,
    }


def _is_gross_mismatch(stated: float, computed: float, tolerance: float) -> bool:
    """Whether a gap is too large for the workbook-wins rule to explain."""
    if abs(stated - computed) <= tolerance:
        return False
    if (stated > 0) != (computed > 0) and min(abs(stated), abs(computed)) > tolerance:
        return True
    smaller, larger = sorted((abs(stated), abs(computed)))
    if smaller <= tolerance:
        return True
    return larger / smaller >= _TIE_OUT_GROSS_RATIO


def _count_source_value_rows(workbook_path, sheet_name: str, max_cols: int = 200) -> int:
    """Rows in the raw sheet carrying at least one numeric cell — the
    baseline an emitted line-row count is checked against."""
    from openpyxl import load_workbook  # performance at load time

    wb = load_workbook(workbook_path, data_only=True, read_only=True)
    try:
        ws = wb[sheet_name]
        upper = min(ws.max_column or 0, max_cols)
        return sum(
            1
            for row in ws.iter_rows(min_row=1, max_row=ws.max_row, max_col=upper)
            if any(
                isinstance(c.value, (int, float)) and not isinstance(c.value, bool)
                for c in row
            )
        )
    finally:
        wb.close()


def _coverage_check(rows: list, workbook_path, sheet_name: str) -> dict:
    """Warn — or, past a much lower bar, fail — when the emitted line rows
    are an implausibly small slice of the sheet's own numeric rows."""
    line_rows = sum(1 for r in rows if r.get("row_kind") == "line")
    source_rows = _count_source_value_rows(workbook_path, sheet_name)
    if source_rows < _COVERAGE_MIN_SOURCE_ROWS:
        return {
            "name": "coverage",
            "severity": "warning",
            "passed": True,
            "line_rows": line_rows,
            "source_value_rows": source_rows,
            "ratio": None,
            "message": None,
        }

    ratio = line_rows / source_rows
    if ratio < _COVERAGE_FAIL_RATIO:
        severity, passed = "error", False
    elif ratio < _COVERAGE_WARN_RATIO:
        severity, passed = "warning", False
    else:
        severity, passed = "warning", True

    message = None
    if not passed:
        why = (
            "refusing; this looks like the wrong region of the sheet"
            if severity == "error"
            else "this is low; confirm the shape and sheet are right"
        )
        message = (
            f"emitted {line_rows} line row(s) against {source_rows} source "
            f"row(s) carrying a number ({ratio:.0%} coverage) — {why}."
        )
    return {
        "name": "coverage",
        "severity": severity,
        "passed": passed,
        "line_rows": line_rows,
        "source_value_rows": source_rows,
        "ratio": round(ratio, 4),
        "message": message,
    }


def _totals_readout(rows: list) -> str:
    """An indented summary of every root total down through its own
    `children` — what it sums, the amount, and a ✓/✗ against the signed
    sum of its direct children (`child_signs`) — built from the
    `children`/`child_signs`/`children_complete` fields the pnl-outline
    adapter's formula tree produces. Every child line, leaf or another
    total, carries the `-` its parent's formula gives it when subtracted.
    No mark at all on a total whose own `annual` isn't a number, or whose
    `children_complete` is false — its formula also adds a constant or a
    cross-sheet value alongside `children` — since neither can be checked
    against the signed sum of `children`. Empty when no row carries
    `children`: a sheet with no live formulas, or a non-outline shape.
    """
    by_id = _rows_by_tree_id(rows)
    rows_with_children = [r for r in rows if r.get("children")]
    if not rows_with_children:
        return ""
    roots = totals_tree.tree_roots(rows_with_children)

    lines = []

    def tie_mark(stated, computed):
        if not isinstance(stated, (int, float)):
            return ""
        if abs(stated - computed) <= _tie_tolerance(stated, computed):
            return " ✓"
        return f" ✗ (children sum to {computed:,.2f})"

    def render(row, depth, prefix=""):
        children = [by_id[c] for c in row.get("children", []) if c in by_id]
        signs = row.get("child_signs") or [1] * len(children)
        stated = row.get("annual")
        computed = sum(
            sign * float(c.get("annual") or 0.0) for sign, c in zip(signs, children)
        )
        amount = f"{stated:,.2f}" if isinstance(stated, (int, float)) else "—"
        # A formula with a constant or a cross-sheet term alongside its
        # row references (`children_complete` false) can never tie against
        # `children` alone, so no mark beats a false ✗ — same reasoning as
        # a non-numeric `stated` (no cached value to compare against).
        mark = tie_mark(stated, computed) if row.get("children_complete", True) else ""
        lines.append(f"{'  ' * depth}{prefix}{row.get('label')}: {amount}{mark}")
        for sign, c in zip(signs, children):
            if c.get("children"):
                render(c, depth + 1, "" if sign > 0 else "-")
            else:
                lines.append(
                    f"{'  ' * (depth + 1)}"
                    f"{_signed_child(sign, c.get('label'), float(c.get('annual') or 0.0))}"
                )

    for r in roots:
        render(r, 0)
    return "\n".join(lines)


def _validate_budget(budget: dict, workbook_path, sheet_name: str) -> dict:
    """Run the parse-credibility gate and return its machine-readable
    `validation` block: which checks ran, whether each passed, and the
    numbers compared — so a consumer can show provenance instead of
    taking a clean exit code on faith.

    Shape-agnostic by construction: every helper above reads only
    `row_kind`, `annual`, `monthly`, `by_column`, `constituents` and
    `calculated` — the vocabulary every adapter emits — never a layout
    detail specific to one of them. `_plausibility_check`'s opex/income
    trigger is the one exception: it also reads `section`, which only the
    pnl-outline adapter sets, and simply has nothing to compare for a
    shape that doesn't.
    """
    rows = budget.get("rows", [])
    checks = [
        _all_zero_check(rows),
        _tie_out_check(rows),
        _coverage_check(rows, workbook_path, sheet_name),
        _plausibility_check(rows),
    ]
    passed = not any(c["severity"] == "error" and not c["passed"] for c in checks)
    return {"checks": checks, "passed": passed}


def main() -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Parse an Excel budget workbook into a universal budget.json "
            "for consumption by the carta-manco-reporting dashboard."
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Registered shapes:\n"
            + "\n".join(f"  {name}" for name in SHAPES)
        ),
    )
    parser.add_argument("--workbook", required=True, help="Path to the .xlsx file")
    parser.add_argument(
        "--sheet",
        required=True,
        help="Sheet name inside the workbook (e.g. 'Budget vs Actuals (Dept View)')",
    )
    parser.add_argument(
        "--shape",
        required=True,
        choices=sorted(SHAPES.keys()),
        help="Which shape adapter to use",
    )
    parser.add_argument(
        "--out",
        required=True,
        help=(
            "Path to write budget.json (parent dir must exist). Multiple "
            "budgets per firm coexist by giving each a distinct filename — "
            "convention is <dashboard_dir>/budget-<slug>.json. The build "
            "script globs all budget-*.json files and emits them into "
            "snapshot.budgets as an array."
        ),
    )
    parser.add_argument(
        "--label",
        default=None,
        help=(
            "Human-readable label for this budget (shown in the sidebar "
            "sub-nav and BvA page header). Defaults to the sheet name."
        ),
    )
    parser.add_argument(
        "--period-year",
        type=int,
        default=None,
        help=(
            "Outline and monthly-crosstab shapes only. Which year to read "
            "when the tab states several, or the only year when the tab "
            "states none at all. A multi-year operating plan puts Q1..Q4 "
            "for a decade in one header row; without this the adapter "
            "refuses rather than reporting some other year's plan as this "
            "year's budget."
        ),
    )
    parser.add_argument(
        "--period-start",
        default=None,
        help=(
            "ISO date the sheet's period begins, e.g. 2026-04-01. Only needed "
            "when the sheet doesn't say. A quarter-to-date tab and a "
            "year-to-date tab routinely carry identical title bands — same "
            "heading, same 'For the Period Ending' line — so the start cannot "
            "be read from the file and a wrong guess compares a quarter's "
            "budget against a year's spend. Defaults to January 1 of the "
            "period year."
        ),
    )
    parser.add_argument(
        "--stop-label",
        default=None,
        help=(
            "Outline shapes only. Column-A label at which to stop reading. "
            "By default an outline ends after its own net-income line, since "
            "tabs commonly continue into alternate scenarios and supporting "
            "schedules; pass this when a workbook needs a different cut."
        ),
    )
    parser.add_argument(
        "--skip-validation",
        "--force",
        action="store_true",
        dest="skip_validation",
        help=(
            "Write budget.json even when the parse-credibility gate refuses "
            "it — an all-zero parse, a tie-out mismatch against the "
            "workbook's own stated total, implausibly low row coverage, or "
            "an implausible magnitude (a line over "
            f"{_PLAUSIBILITY_LINE_CAP:,.0f} in the workbook's own currency, "
            f"or opex more than {_PLAUSIBILITY_OPEX_INCOME_RATIO:g}x income). "
            "The validation block is still attached and still reports what "
            "failed. Use this only once you've manually confirmed the "
            "workbook is legitimately shaped that way, e.g. a genuine "
            "all-zero template budget."
        ),
    )
    args = parser.parse_args()

    workbook = Path(args.workbook).expanduser().resolve()
    if not workbook.exists():
        print(f"error: workbook not found: {workbook}", file=sys.stderr)
        return 2

    # Late import so a bad --shape argparse-fails before we touch openpyxl.
    # scripts/shapes/ is already on sys.path (see the module-level insert
    # near the top of this file).
    module_path = SHAPES[args.shape]
    module = __import__(module_path, fromlist=["parse"])
    if not hasattr(module, "parse"):
        print(
            f"error: adapter {module_path} is missing a `parse` function",
            file=sys.stderr,
        )
        return 3

    # Optional: resolve a sibling coa-mapping.json next to --out and pass
    # its `records` + `value_aliases` into the adapter. Adapters that don't
    # need them just ignore the kwargs (parse() accepts **_ for forward
    # compat). This keeps adapters agnostic of where their output lives on
    # disk, and gives shapes that must reconcile department labels the
    # vocabulary to reconcile against.
    out_dir = Path(args.out).expanduser().resolve().parent
    mapping_path = out_dir / "coa-mapping.json"
    mapping_records = None
    value_aliases = None
    if mapping_path.exists():
        try:
            payload = json.loads(mapping_path.read_text())
            mapping_records = payload.get("records")
            value_aliases = payload.get("value_aliases")
        except Exception:
            mapping_records = value_aliases = None

    try:
        # Pass the mapping context if the adapter accepts it — a crosstab
        # adapter reads its tag_values straight off the sheet and takes
        # neither kwarg.
        try:
            budget = module.parse(
                str(workbook), args.sheet,
                mapping_records=mapping_records,
                value_aliases=value_aliases,
                stop_label=args.stop_label,
                period_year=args.period_year,
            )
        except TypeError:
            budget = module.parse(str(workbook), args.sheet)
        # Stamp the human-readable label — falls back to sheet name.
        budget["label"] = args.label or args.sheet
        if args.period_start:
            budget["period_start"] = args.period_start
        else:
            _require_period_start(budget, args.sheet, args.label)
    except Exception as e:
        # Adapters raise ValueError for user-facing config problems
        # (wrong sheet, unrecognized shape). Everything else is a bug.
        print(f"error: adapter {args.shape} failed: {e}", file=sys.stderr)
        return 4

    validation = _validate_budget(budget, workbook, args.sheet)
    budget["validation"] = validation

    # Printed ahead of the refusal check: a refused parse exits there, and
    # its reader needs the readout to see what each mismatched total was
    # compared against, same as a successful parse does.
    if args.shape == "pnl-outline":
        readout = _totals_readout(budget.get("rows", []))
        if readout:
            print(f"totals readout:\n{readout}", file=sys.stderr)

    failed = [c for c in validation["checks"] if c["severity"] == "error" and not c["passed"]]
    if failed:
        detail = "\n".join(f"  - {c['name']}: {c['message']}" for c in failed)
        if args.skip_validation:
            print(
                f"warning: parse-credibility gate failed but writing anyway "
                f"(--skip-validation):\n{detail}",
                file=sys.stderr,
            )
        else:
            print(
                f"error: parse-credibility gate refused this parse:\n{detail}\n"
                "  Pass --skip-validation (or --force) once you've confirmed "
                "this is legitimate.",
                file=sys.stderr,
            )
            return 5
    for c in validation["checks"]:
        if c["severity"] == "warning" and not c["passed"]:
            print(f"warning: {c['name']}: {c['message']}", file=sys.stderr)

    out = Path(args.out).expanduser().resolve()
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(budget, indent=2))

    # Human-facing summary for the invoking skill to relay. Crosstab
    # budgets report dept coverage; outline and monthly-crosstab budgets
    # (dimensions == []) report their line/aggregate counts instead.
    rows_out = budget.get("rows", [])
    lines = sum(1 for r in rows_out if r.get("row_kind") == "line")
    calc = sum(1 for r in rows_out if r.get("calculated"))
    if budget.get("dimensions"):
        depts = budget.get("tag_values") or []
        detail = (
            f"{len(rows_out)} rows ({lines} line items, {calc} calculated) "
            f"across {len(depts)} depts"
        )
    elif args.shape == "monthly-crosstab":
        detail = f"{len(rows_out)} accounts (no department axis)"
    else:
        detail = f"{len(rows_out)} outline rows ({lines} line items)"
    print(
        f"parsed {detail}; period_year={budget.get('period_year')}; wrote {out}",
        file=sys.stderr,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
