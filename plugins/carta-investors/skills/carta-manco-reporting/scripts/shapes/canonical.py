"""Canonical fact-tree budget model, shared by every ingested shape.

Lifts the ALREADY-RESOLVED budget dict (read_excel_budget() /
_read_outline_budget() / _read_monthly_crosstab_budget() / read_budgets()'s
own output) rather than re-parsing budget.json, so the business rules baked
into those readers (a workbook's own stated total wins over summing rows,
etc.) are reused, never re-derived and risking disagreement.
"""

from __future__ import annotations

from collections import defaultdict

SCHEMA_VERSION = 1

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


def to_canonical(resolved_budget, period_year=None, *, mapped_gl_first=False):
    """Lift a resolved budget dict (must carry `rows`) into the canonical model.

    `mapped_gl_first` takes each line's gl_codes (the mapping's answer, which can
    name several accounts) over the accounts its adapter stated. Sharing wants
    that (see share_payload); the views keep the stated accounts.
    """
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
        if mapped_gl_first:
            gl = list(row.get("gl_codes") or []) or gl
        node = {
            # A row the adapter didn't number (headers, some summaries) gets "~<index>":
            # adapter keys never start with "~", so the two can't collide.
            "key": row.get("key") or f"~{i}",
            "kind": row.get("row_kind") or "line",
            "label": row.get("label"),
            "depth": row.get("depth") or 0,
            "order": i,
            "gl_codes": gl,
            "facts": facts,
        }
        # A crosstab comments per department; every other layout comments per
        # line, keyed "" for the whole line.
        line_comment = row.get("comment")
        if not comments and isinstance(line_comment, str) and line_comment.strip():
            comments = {"": line_comment.strip()}
        if comments:
            node["comments"] = comments
        section = row.get("section")
        if section:
            node["section"] = section
        calculated = row.get("calculated") or {}
        constituents = row.get("constituents") or calculated.get("constituents")
        if constituents:
            node["constituents"] = list(constituents)
        # How a derived row is recomputed after an edit: net income is income
        # minus expense, and a formula row can't be rebuilt by summing.
        if row.get("derived"):
            node["derived"] = row["derived"]
        elif calculated.get("kind") == "expression":
            node["derived"] = "expression"
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


def _month_index(period):
    if period and len(period) >= 7:
        try:
            month = int(period[5:7])
        except ValueError:
            return None
        if 1 <= month <= 12:
            return month - 1
    return None


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
            m = _month_index(f["period"])
            if m is not None:
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


_ADAPTER_FOR_VIEW = {
    BY_LINE_ITEM: "pnl-outline",
    BY_ACCOUNT: "monthly-crosstab",
    BY_TAG_CROSSTAB: "tag-crosstab",
}


def _source_key(node):
    """The adapter's own key, or None for a row the adapter didn't number (see to_canonical)."""
    key = node.get("key")
    return None if not key or key.startswith("~") else key


def _gl_fields(node):
    gl = list(node.get("gl_codes") or [])
    out = {"gl_codes": gl}
    if gl:
        out["account_type"] = gl[0]
    if len(gl) > 1:
        out["account_type_all"] = gl
    return out


def _outline_row(node):
    """One parsed-budget row for an outline or monthly budget."""
    monthly = [0.0] * 12
    whole_window = 0.0
    has_period = False
    tag_value = None
    for fact in node["facts"]:
        index = _month_index(fact.get("period"))
        if index is None:
            whole_window += fact["amount"]
        else:
            monthly[index] += fact["amount"]
            has_period = True
        if fact.get("scope") and tag_value is None:
            tag_value = fact["scope"].get("value")
    row = {
        "row_kind": node["kind"],
        "label": node.get("label"),
        "depth": node.get("depth") or 0,
        "annual": round(sum(monthly) + whole_window, 2),
        # A header carries no amounts, as the adapters emit it.
        "monthly": [round(v, 2) for v in monthly] if has_period else [],
    }
    key = _source_key(node)
    if key:
        row["key"] = key
    if node.get("section"):
        row["section"] = node["section"]
    comment = (node.get("comments") or {}).get("")
    row["comment"] = comment
    if node.get("constituents"):
        row["constituents"] = list(node["constituents"])
    if node.get("derived") == "net_income":
        row["derived"] = "net_income"
    if tag_value:
        row["tag_value"] = tag_value
    row.update(_gl_fields(node))
    return row


def _crosstab_row(node):
    """One parsed-budget row for a tag-crosstab: scope values become columns."""
    comments = node.get("comments") or {}
    by_column = {}
    for fact in node["facts"]:
        scope = (fact.get("scope") or {}).get("value")
        if scope is None:
            continue
        entry = by_column.setdefault(scope, {"budget": 0.0})
        entry["budget"] = round(entry["budget"] + fact["amount"], 2)
    for scope, text in comments.items():
        if scope:
            by_column.setdefault(scope, {"budget": None})["comment"] = text
    row = {
        "row_kind": node["kind"],
        "label": node.get("label"),
        "depth": node.get("depth") or 0,
        "by_column": by_column,
        "comment": comments.get(""),
    }
    key = _source_key(node)
    if key:
        row["key"] = key
    if node.get("section"):
        row["section"] = node["section"]
    # A formula row's operators don't survive the canonical model, so only a plain
    # sum keeps its breakdown — an expression shown as a sum would state the
    # opposite of what the workbook computes.
    if node.get("constituents") and node.get("derived") != "expression":
        row["calculated"] = {"kind": "sum", "constituents": list(node["constituents"])}
    row.update(_gl_fields(node))
    return row


def budget_from_canonical(payload, *, report_id, name):
    """A shared report's payload, back in the parsed-budget shape build_manco_datadir reads.

    `payload` is the share envelope: {period_year, period_granularity, currency,
    native_view_kind, period_kind?, value_aliases?, budget: {dimensions, nodes}}.
    The result renders like any imported budget; `read_only` marks it as a report
    someone else shared, so nothing asks mapping questions about it.
    """
    body = payload["budget"]
    native = payload["native_view_kind"]
    nodes = sorted(body["nodes"], key=lambda n: n.get("order", 0))
    crosstab = native == BY_TAG_CROSSTAB
    rows = [(_crosstab_row if crosstab else _outline_row)(n) for n in nodes]
    budget = {
        "id": report_id,
        "label": name,
        "period_year": payload["period_year"],
        "period_kind": payload.get("period_kind") or "annual",
        "period_granularity": payload.get("period_granularity"),
        "source": "shared-report",
        "workbook_meta": {"shape_adapter": _ADAPTER_FOR_VIEW.get(native, "pnl-outline")},
        "dimensions": list(body.get("dimensions") or []) if crosstab else [],
        "view_kinds": [native],
        "rows": rows,
        "read_only": True,
    }
    if crosstab:
        scopes = []
        for node in nodes:
            for fact in node["facts"]:
                value = (fact.get("scope") or {}).get("value")
                if value is not None and value not in scopes:
                    scopes.append(value)
        budget["tag_values"] = scopes
    if payload.get("value_aliases"):
        budget["value_aliases"] = payload["value_aliases"]
    return budget


def _native_view_kind(canonical):
    """The view a budget with no recorded view_kinds is read back as.

    budget_from_canonical's crosstab path keeps only scoped, whole-window facts.
    A department-scoped outline also names a dimension, but its facts are monthly
    and some lines are unscoped, so only a budget whose every fact is scoped and
    whole-window is read back as a crosstab.
    """
    facts = [f for n in canonical["nodes"] for f in n["facts"]]
    crosstab = bool(canonical["dimensions"]) and bool(facts) and all(
        f.get("scope") and f.get("period") is None for f in facts
    )
    return BY_TAG_CROSSTAB if crosstab else BY_LINE_ITEM


def share_payload(budget, currency):
    """The payload a report is shared with: the canonical body in its envelope.

    `budget` is a resolved budget entry (after mapping); each node's gl_codes are
    the mapping's answers, so a recipient sees the sharer's mapped accounts.
    `currency` is the ManCo's own; sharing needs one.
    """
    canonical = to_canonical(budget, mapped_gl_first=True)
    if canonical is None:
        return None
    payload = {
        "period_year": budget.get("period_year"),
        "period_granularity": budget.get("period_granularity"),
        "period_kind": budget.get("period_kind") or "annual",
        "currency": currency,
        "native_view_kind": (budget.get("view_kinds") or [_native_view_kind(canonical)])[0],
        "budget": {"dimensions": canonical["dimensions"], "nodes": canonical["nodes"]},
    }
    if budget.get("value_aliases"):
        payload["value_aliases"] = budget["value_aliases"]
    return payload
