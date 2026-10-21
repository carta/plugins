"""The formula-derived totals tree's shared vocabulary: `children` (a line's
`key` or another total's `total_key`), `child_signs`, `children_complete`,
and `total_key` itself. The pnl-outline adapter (`pnl_outline.py`) is what
populates these fields; this module holds the one piece of logic every
reader of them needs, so it isn't copied into each reader and risks
diverging. Stdlib-only — unlike `pnl_outline.py`, which needs `openpyxl` to
read a workbook, nothing here does, so a pure-dict caller (the tie-out
gate's test suite, `build_manco_datadir.py`'s "Stdlib-only" contract) never
pulls in a dependency it has no use for.
"""

from __future__ import annotations


def tree_roots(rows: list) -> list:
    """The rows in `rows` (identified by `total_key`) that no other row in
    this same list names in its `children` — the top of each row's own
    formula tree, within whatever subset of the budget's rows is passed.

    Only a `children` id that matches another row's own `total_key` in
    `rows` counts as naming it: a leaf line key, or an id belonging to a
    row outside this list, never removes a row from its own roots. The
    one place this is worked out, so a reader of the totals tree
    (`_totals_readout` in parse_budget_workbook.py) and a consumer that
    sums a total from the tree (`_section_total` in
    build_manco_datadir.py) always agree on what a child id resolves to.
    """
    total_keys = {r.get("total_key") for r in rows if r.get("total_key")}
    named = {cid for r in rows for cid in (r.get("children") or [])
             if cid in total_keys}
    return [r for r in rows if r.get("total_key") not in named]


def has_usable_tree(row: dict, ids: set) -> bool:
    """Whether `row`'s own formula tree states what it sums: `children` is
    non-empty, every id in it is in `ids` (the budget's line `key`s and
    total `total_key`s), and `children_complete` isn't false. The rule the
    outline view reads a total's actuals by (`usableTree` in
    app/src/views/BudgetActualsOutline.jsx) — such a total is summed from
    its tree and never widened to the lines it sits over.
    """
    children = row.get("children") or []
    return (bool(children) and row.get("children_complete", True) is not False
            and all(c in ids for c in children))
