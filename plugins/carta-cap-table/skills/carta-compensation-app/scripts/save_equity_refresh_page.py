#!/usr/bin/env python3
"""save_equity_refresh_page.py — capture a columnar equity refresh export.

The Refresh-planner counterpart to ``save_roster_page.py``. Run it after the equity
refresh export call instead of hand-copying the printed result: these rows carry named
employees beside their equity holdings and vesting dates, and a retyped digit lands in a
figure the planner then presents as authoritative.

The MCP command name is deliberately not written here. carta-mcp's
``plugin-command-contract`` check fails every PR in that repo when a published skill
names a command its registry does not have, and this one is not released yet — see
SKILL.md step 2d-bis.

WHY THIS EXISTS SEPARATELY FROM THE ROSTER CAPTURE
Both are columnar employee exports, but they answer different questions and come
from different endpoints. The roster carries market positioning (bands,
compa-ratios, percentiles); this carries equity holdings and vesting. Merging them
into one capture would couple two sweeps that can legitimately succeed and fail
independently — a corporation can have a benchmarked roster with no equity
captured at all, which is a real state on production data.

THE VALUES ARE THE REPORT'S OWN
Every figure here is passed through EXACTLY as the service returned it. The point
of this data is that it ties out against CTC's Equity Refresh Report in the
product, so nothing is rounded, summed or re-derived on the way to disk. The
planner does the same addition the product's own table does (vested + unvested)
at render time, and nothing else.

ONE CALL, NO PAGING
The export returns every benchmarked employee in one response — the service
refuses rather than truncating — so there is nothing to accumulate across calls
and no overlap to dedupe. The manifest is written in one shot.
"""
import json
import pathlib
import sys

# Reuse the sibling's unwrapping rather than reimplementing it: the MCP wrapper
# shapes are identical for every compensation command, and two copies would drift
# the first time a new envelope appears.
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from save_benchmark_result import (  # noqa: E402
    _load,
    _walk_for_payload,
    _write_json,
)

# The column that identifies this payload. `external_id` alone is not enough — the
# scorecard export carries it too — so the marker is a column only this report has.
_MARKER_COLUMN = "live_award_count"


def _looks_like_equity_refresh_page(val):
    """True when val is a columnar equity refresh export.

    Keyed on a column unique to this report rather than on `columns`/`rows`
    generally, so a scorecard export handed to this script is rejected rather than
    silently decoded into rows with every field shifted.
    """
    if not isinstance(val, dict):
        return False
    columns = val.get("columns")
    return (
        isinstance(columns, list)
        and isinstance(val.get("rows"), list)
        and _MARKER_COLUMN in columns
    )


def _find_export(raw):
    """Locate the export inside whatever wrapper it arrived in."""
    if _looks_like_equity_refresh_page(raw):
        return raw
    payload = _walk_for_payload(raw)
    if _looks_like_equity_refresh_page(payload):
        return payload
    return None


def _row(columns, values):
    """One captured row: every column, keyed by name.

    Zips by COLUMN NAME, never by position, so appending a column upstream stays
    backward-compatible. Values are kept verbatim — see the module docstring.
    """
    if len(values) != len(columns):
        return None  # caller reports the mismatch; do not guess a shorter row
    row = dict(zip(columns, values))
    # Without an id the row cannot be joined to anything or referred to later.
    return row if row.get("external_id") else None


def capture(src, raw_dir):
    """Capture a whole equity refresh export as a COMPLETE sweep."""
    raw_dir = pathlib.Path(raw_dir)

    raw = _load(src)
    page = _find_export(raw)
    if page is None:
        preview = json.dumps(raw)[:300] if raw is not None else "<nothing>"
        sys.stderr.write(
            "save_equity_refresh_page: no columnar equity refresh export found in the source.\n"
            "  Saw: %s\n"
            "  Expected a dict with 'columns' (including %s) and 'rows'.\n"
            "  A scorecard export goes through save_roster_page.py instead.\n"
            % (preview, _MARKER_COLUMN)
        )
        sys.exit(2)

    columns = page.get("columns")
    rows = page.get("rows")
    if not isinstance(rows, list):
        sys.exit("save_equity_refresh_page: 'rows' is not a list — refusing to guess a shape.")

    known, malformed, skipped = {}, 0, 0
    for values in rows:
        if not isinstance(values, list):
            malformed += 1
            continue
        built = _row(columns, values)
        if built is None:
            if len(values) != len(columns):
                malformed += 1
            else:
                skipped += 1
            continue
        known[built["external_id"]] = built

    if malformed:
        # A width mismatch means the header and the rows disagree, i.e. the payload
        # is not what this decoder was written against. Publishing the rows that
        # happened to line up would put one employee's vested shares against
        # another's name.
        sys.exit(
            "save_equity_refresh_page: %d row(s) do not match the %d-column header — "
            "refusing to publish a partially-decoded report." % (malformed, len(columns))
        )

    total_results = page.get("total_results")
    if not isinstance(total_results, int):
        total_results = page.get("row_count")
    distinct = len(known)
    complete = isinstance(total_results, int) and distinct >= total_results

    manifest = {
        "columns": list(columns),
        "rows": known,
        "total_results": total_results,
        "distinct_employees": distinct,
        "sweep_complete": complete,
        # Names the shape, not the MCP command — see the module docstring.
        "source": "equity-refresh-export",
    }
    _write_json(raw_dir / "equity_refresh.json", manifest)

    if skipped:
        sys.stderr.write("save_equity_refresh_page: skipped %d row(s) with no external_id\n" % skipped)
    print(
        "save_equity_refresh_page: captured %d employee(s)%s"
        % (distinct, "" if complete else " — sweep INCOMPLETE")
    )
    if not complete:
        sys.stderr.write(
            "save_equity_refresh_page: %s of %s employees captured. build_datadir will "
            "refuse to publish a partial report.\n"
            % (distinct, total_results if total_results is not None else "?")
        )
    return manifest


def main():
    if len(sys.argv) != 3:
        sys.exit("usage: save_equity_refresh_page.py <src.json|-> <raw_dir>")
    capture(sys.argv[1], sys.argv[2])


def main_for_test(src, raw_dir):
    """Entry point for tests, mirroring save_roster_page's hook."""
    return capture(src, raw_dir)


if __name__ == "__main__":
    main()
