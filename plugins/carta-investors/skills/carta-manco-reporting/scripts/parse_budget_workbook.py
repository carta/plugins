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


def _tie_out_check(rows: list) -> dict:
    """Compare each row the workbook states as a total against the sum of
    the line rows it names as constituents.

    Only rows the adapter itself pointed at other rows for are checked —
    a `total`/`summary` row_kind, or a label reading like one, that also
    carries `constituents` (top-level, or nested under `calculated` for a
    dept crosstab's formula-derived rows). A total whose constituents
    don't fully resolve to emitted rows is skipped rather than compared
    against a partial sum, which would be more misleading than no check
    at all.
    """
    key_to_row = {r["key"]: r for r in rows if r.get("key")}
    comparisons = []
    for row in rows:
        is_total_like = row.get("row_kind") in ("total", "summary") or bool(
            _TOTAL_LABEL_RX.search(row.get("label") or "")
        )
        if not is_total_like or not _is_additive(row):
            continue
        stated_map = _row_values(row)
        if not stated_map:
            continue
        keys = _constituent_keys(row)
        if not keys:
            continue
        constituent_rows = [key_to_row[k] for k in keys if k in key_to_row]
        if len(constituent_rows) != len(keys):
            continue

        computed_map: dict = {}
        for cr in constituent_rows:
            for dim, val in _row_values(cr).items():
                computed_map[dim] = computed_map.get(dim, 0.0) + val

        for dim, stated in stated_map.items():
            computed = computed_map.get(dim, 0.0)
            tolerance = max(
                _TIE_OUT_ABS_TOL,
                _TIE_OUT_REL_TOL * max(abs(stated), abs(computed)),
            )
            comparisons.append({
                "label": row.get("label"),
                "row_kind": row.get("row_kind"),
                "dimension": dim,
                "stated": stated,
                "computed": round(computed, 2),
                "tolerance": round(tolerance, 2),
                "within_tolerance": abs(stated - computed) <= tolerance,
                "gross": _is_gross_mismatch(stated, computed, tolerance),
            })

    mismatches = [c for c in comparisons if not c["within_tolerance"]]
    gross = [c for c in mismatches if c["gross"]]
    message = None
    if mismatches:
        parts = [
            f"{m['label']!r}"
            + (f" [{m['dimension']}]" if m["dimension"] else "")
            + f": workbook states {m['stated']:,.2f}, line rows sum to "
              f"{m['computed']:,.2f} (tolerance {m['tolerance']:,.2f})"
            for m in (gross or mismatches)
        ]
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


def _validate_budget(budget: dict, workbook_path, sheet_name: str) -> dict:
    """Run the parse-credibility gate and return its machine-readable
    `validation` block: which checks ran, whether each passed, and the
    numbers compared — so a consumer can show provenance instead of
    taking a clean exit code on faith.

    Shape-agnostic by construction: every helper above reads only
    `row_kind`, `annual`, `monthly`, `by_column`, `constituents` and
    `calculated` — the vocabulary every adapter emits — never a layout
    detail specific to one of them.
    """
    rows = budget.get("rows", [])
    checks = [
        _all_zero_check(rows),
        _tie_out_check(rows),
        _coverage_check(rows, workbook_path, sheet_name),
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
            "workbook's own stated total, or implausibly low row coverage. "
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
    module_path = SHAPES[args.shape]
    # Adapters live under scripts/shapes/, which is a sibling package of
    # this file. Adjust sys.path so `import shapes.foo` works whether the
    # user runs `uv run scripts/parse_budget_workbook.py` from any cwd.
    sys.path.insert(0, str(Path(__file__).parent))
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
