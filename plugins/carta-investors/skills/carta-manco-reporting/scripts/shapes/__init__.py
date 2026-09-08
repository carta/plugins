"""
Shape adapters for parse_budget_workbook.py.

Each adapter module exposes `parse(workbook_path, sheet_name, **ctx) -> dict`
that emits the shared universal budget schema (see parse_budget_workbook.py's
docstring for the schema shape).

One module per workbook LAYOUT, not per firm. An adapter is written once for
a way of laying a budget out and reused by every firm whose workbook is
shaped that way — so an adapter must never hardcode one firm's tag_values,
line-item names, sheet coordinates or stopping points. Everything it needs is
discovered from the workbook it is handed, with label reconciliation handled
by `vocab.py`. Supporting a genuinely new layout is a new module here plus a
`--shape <name>` entry in parse_budget_workbook.py's dispatch.

Shipped adapters:

    tag_crosstab  department × (actual/budget/variance) grid, YTD
    pnl_outline    hierarchical income statement with quarterly columns

Layouts not yet covered: multi-year quarterly time-series, and monthly
per-year sheets with per-fund or per-portfolio-company row groups.
"""
