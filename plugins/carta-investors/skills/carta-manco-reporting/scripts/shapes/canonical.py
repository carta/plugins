"""Canonical fact-tree budget model, shared by every ingested shape.

Lifts the ALREADY-RESOLVED budget dict (read_excel_budget() /
_read_outline_budget() / _read_monthly_crosstab_budget() / read_budgets()'s
own output) rather than re-parsing budget.json, so the business rules baked
into those readers (a workbook's own stated total wins over summing rows,
etc.) are reused, never re-derived and risking disagreement.
"""

from __future__ import annotations

from collections import defaultdict

SCHEMA_VERSION = 2

BY_ACCOUNT = "by-account"
BY_LINE_ITEM = "by-line-item"
BY_TAG_CROSSTAB = "by-tag-crosstab"

_MIN_SCOPES_FOR_CROSSTAB = 2


def _node_facts_from_row(row, period_year):
    """(facts, comments) for one resolved row, told apart by which field it carries."""
    by_column = row.get("by_column")
    if by_column:
        facts, comments = [], {}
        for dept, entry in by_column.items():
            val = entry.get("budget") if isinstance(entry, dict) else None
            if val is not None:
                try:
                    facts.append({"period": None, "scope": {"value": dept},
                                  "amount": float(val)})
                except (TypeError, ValueError):
                    pass
            comment = entry.get("comment") if isinstance(entry, dict) else None
            if isinstance(comment, str) and comment.strip():
                comments[dept] = comment.strip()
        return facts, comments

    # A crosstab budget is YTD-only, so its facts carry period=None — "the
    # whole stated window" — rather than claiming monthly precision it
    # never had.
    scope = {"value": row["tag_value"]} if row.get("tag_value") else None
    monthly = row.get("monthly")
    if monthly:
        facts = []
        for i, v in enumerate(monthly):
            if not v:
                continue
            period = f"{period_year}-{i + 1:02d}" if period_year else None
            facts.append({"period": period, "scope": scope, "amount": float(v)})
        return facts, {}

    annual = row.get("annual")
    if annual:
        return [{"period": None, "scope": scope, "amount": float(annual)}], {}
    return [], {}


def to_canonical(resolved_budget, period_year=None):
    """Lift a resolved budget dict (must carry `rows`) into the canonical model."""
    rows = resolved_budget.get("rows") or []
    if not rows:
        return None
    period_year = period_year or resolved_budget.get("period_year")

    dims = list(resolved_budget.get("dimensions") or [])
    if not dims and any(r.get("tag_value") for r in rows):
        # An outline line's tag_value scoping has no top-level `dimensions`
        # entry today — infer the same axis so a scoped outline can also
        # project a tag-crosstab view.
        dims = ["tag_value"]

    nodes = []
    for i, row in enumerate(rows):
        facts, comments = _node_facts_from_row(row, period_year)
        gl = row.get("account_type_all") or (
            [row["account_type"]] if row.get("account_type") is not None else []
        )
        node = {
            "key": row.get("key") or f"r{i}",
            "kind": row.get("row_kind") or "line",
            "label": row.get("label"),
            "depth": row.get("depth") or 0,
            "order": i,
            "gl_codes": gl,
            "facts": facts,
        }
        if comments:
            node["comments"] = comments
        section = row.get("section")
        if section:
            node["section"] = section
        constituents = row.get("constituents") or (row.get("calculated") or {}).get("constituents")
        if constituents:
            node["constituents"] = list(constituents)
        nodes.append(node)

    return {"schema_version": SCHEMA_VERSION, "dimensions": dims, "nodes": nodes}


def _all_scopes_with_amount(nodes):
    seen = {}
    for n in nodes:
        if n["kind"] != "line":
            continue
        for f in n["facts"]:
            if f["scope"] and f["amount"]:
                seen[f["scope"]["value"]] = True
    return list(seen.keys())


def _distinct_scopes_with_amount(nodes):
    """Real breakdown values with money behind them — a firm-wide roll-up
    column ("Firm Total") is not itself one of the things being broken out.
    """
    return [v for v in _all_scopes_with_amount(nodes) if "total" not in v.strip().lower()]


def available_view_kinds(canonical):
    """Views this budget's data structurally supports — never a static claim.

    by-account: any leaf line sums down to a flat figure, always offered.
    by-line-item: needs real hierarchy (a row_kind beyond flat lines).
    by-tag-crosstab: needs 2+ scope values that each carry real budget money.
    """
    if canonical is None:
        return []
    nodes = canonical["nodes"]
    kinds = [BY_ACCOUNT]
    if any(n["kind"] != "line" for n in nodes):
        kinds.append(BY_LINE_ITEM)
    if len(_distinct_scopes_with_amount(nodes)) >= _MIN_SCOPES_FOR_CROSSTAB:
        kinds.append(BY_TAG_CROSSTAB)
    return kinds


def _sum_facts(facts):
    return sum(f["amount"] for f in facts)


def _is_income(gl_codes):
    return bool(gl_codes) and all(str(g)[:1] == "4" for g in gl_codes)


def project_to_account_rows(canonical, as_of_month=12):
    """Leaf lines, scope summed away, shaped like BudgetActualsAccounts.jsx expects.

    A line with no resolved GL code (no COA mapping, no self-stated Carta
    account) still renders here, budget-only — same as the by-line-item
    view already does for it. Dropping it instead of showing it unmapped
    would silently empty this view for any firm without a mapping.
    """
    rows = []
    for n in canonical["nodes"]:
        if n["kind"] != "line":
            continue
        monthly = [0.0] * 12
        flat = 0.0
        has_period = False
        for f in n["facts"]:
            m = None
            if f["period"] and len(f["period"]) >= 7:
                try:
                    m = int(f["period"][5:7]) - 1
                except ValueError:
                    m = None
            if m is not None and 0 <= m < 12:
                monthly[m] += f["amount"]
                has_period = True
            else:
                flat += f["amount"]
        if not n["gl_codes"] and not has_period and not flat:
            continue  # nothing to join to actuals and nothing budgeted either
        if not has_period and flat:
            # No monthly detail on this line — the amount is stated for the
            # whole window, not any one month.
            annual = round(flat, 2)
            row_monthly = [0.0] * 12
        else:
            annual = round(sum(monthly) + flat, 2)
            row_monthly = [round(v, 2) for v in monthly]
        mo = max(1, min(12, as_of_month))
        rows.append({
            "row_kind": "line",
            "label": n["label"],
            "account_type": n["gl_codes"][0] if n["gl_codes"] else None,
            "gl_codes": n["gl_codes"],
            **({"account_type_all": n["gl_codes"]} if len(n["gl_codes"]) > 1 else {}),
            "annual": annual,
            "budget_ytd": round(sum(row_monthly[:mo]), 2) if has_period else annual,
            "monthly": row_monthly,
        })
    return rows


def project_to_line_item_rows(canonical):
    """The node tree as an outline, scope summed away, shaped like BudgetActualsOutline.jsx expects."""
    rows = []
    current_section = None
    for n in canonical["nodes"]:
        section = n.get("section")
        if n["kind"] == "section_header" and n.get("label"):
            current_section = n["label"]
        total = round(_sum_facts(n["facts"]), 2) if n["facts"] else 0.0
        row = {
            "row_kind": n["kind"],
            "label": n["label"],
            "depth": n["depth"],
            "section": section or current_section,
            "annual": total,
            "monthly": [0.0] * 12,
        }
        if n["gl_codes"]:
            row["gl_codes"] = n["gl_codes"]
            row["account_type"] = n["gl_codes"][0]
        if n.get("constituents"):
            row["constituents"] = n["constituents"]
        rows.append(row)
    return rows


def project_to_tag_crosstab(canonical):
    """Leaf lines pivoted so scope values become columns, shaped like read_excel_budget()'s native output."""
    scopes = _all_scopes_with_amount(canonical["nodes"])
    rows = []
    by_scope = defaultdict(lambda: {"income": 0.0, "expense": 0.0,
                                     "by_account": defaultdict(float)})
    for n in canonical["nodes"]:
        if n["kind"] != "line":
            continue
        by_column = {}
        for f in n["facts"]:
            if not f["scope"]:
                continue
            value = f["scope"]["value"]
            by_column.setdefault(value, {"budget": 0.0})
            by_column[value]["budget"] += f["amount"]
            b = by_scope[value]
            b["by_account"][n["label"]] += f["amount"]
            if _is_income(n["gl_codes"]):
                b["income"] += f["amount"]
            else:
                b["expense"] += f["amount"]
        if not by_column:
            continue
        rows.append({
            "row_kind": "line",
            "label": n["label"],
            "gl_codes": n["gl_codes"],
            "account_type": n["gl_codes"][0] if n["gl_codes"] else None,
            "by_column": {k: {"budget": round(v["budget"], 2)} for k, v in by_column.items()},
        })

    by_tag_value = [
        {
            "tag_value": scope,
            "income_ytd": round(by_scope[scope]["income"]),
            "expenses_ytd": round(by_scope[scope]["expense"]),
            "income_annual": round(by_scope[scope]["income"]),
            "expenses_annual": round(by_scope[scope]["expense"]),
            "by_account": {n: round(v) for n, v in by_scope[scope]["by_account"].items()},
            "carta_tags": [scope],
        }
        for scope in scopes
    ]
    by_tag_value.sort(key=lambda x: ("total" in x["tag_value"].lower(), -x["expenses_ytd"]))
    return rows, by_tag_value
