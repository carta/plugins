#!/usr/bin/env python3
"""manco_budgets.py — carta-manco-reporting's budget readers and figures:
Carta's own per-account budget (read_budgets, empty_budgets,
carta_variance_payload), the monthly-crosstab and outline parsed-workbook
shapes and their figures, discovering and snapshotting every workbook budget
a dashboard dir carries (find_excel_budget_files, read_excel_budget,
snapshot_budget_entry, budget_view_fields), and the KPI figures each view
kind (by-account, by-line-item, tag-crosstab) projects from a budget's
canonical rows (_crosstab_figures, cut_to_accounts).
"""

import json
import re
import sys
from collections import defaultdict
from pathlib import Path

from manco_gl_matching import backfill_account_type_from_coa
from shapes import canonical as canonical_budget
from shapes import totals_tree
from shapes.vocab import SECTION_INCOME, SECTION_OPEX

sys.path.insert(0, str(Path(__file__).resolve().parent))
import manco_paths
import report_store

def read_budgets(raw_dir, as_of_year, as_of_month):
    """Read the 12 monthly fa:list:budgets JSON files and return
    {account_type: {name: {monthly[]: [12]}}} — the shape the charts consume.

    YTD windows (income_ytd, expenses_ytd, per_account) sum months 1..as_of_month
    so the budget-side of Budget-vs-Actuals lines up with the actuals window
    (which is bounded by the same as-of month upstream).

    Returns a summary tuple: (income_ytd, expenses_ytd, income_annual_proj,
    expenses_annual_proj, per_account_budget_map).
    """
    per_account = defaultdict(lambda: {"monthly": [0.0] * 12, "type": None})
    for i in range(1, 13):
        p = raw_dir / f"budget-{as_of_year}-{i:02d}.json"
        if not p.exists():
            # Raw dirs fetched before budgets carried their year.
            p = raw_dir / f"budget-{i:02d}.json"
        if not p.exists():
            continue
        try:
            data = json.loads(p.read_text())
        except Exception:
            continue
        # fa:list:budgets returns {"budgets": [{account_id, account_name, account_type, amount, start_date}, ...], "count": N}
        for row in (data.get("budgets") or []):
            # Mapped like Query A's account column (data-fetch.md), so the
            # spend chart finds the budget under the name the actuals carry.
            name = (row.get("account_name") or "").replace("|", "/")
            if not name:
                continue
            per_account[name]["monthly"][i - 1] += float(row.get("amount") or 0.0)
            per_account[name]["type"] = row.get("account_type")

    # Clamp to [1, 12] as a safety net — as_of_month should already be valid.
    mo = max(1, min(12, int(as_of_month)))
    return _carta_budget_summary(per_account, mo, "carta-fa-list-budgets")


def _carta_budget_summary(per_account, mo, source):
    """read_budgets()'s return shape, built from its `per_account` map
    (`{name: {monthly: [12], type}}`) and YTD cutoff month `mo`. The one
    place both `read_budgets()` and `empty_budgets()` build this dict, so
    a key added to the shape is added once."""
    income_ytd    = sum(sum(a["monthly"][:mo]) for name, a in per_account.items()
                        if str(a["type"] or "")[:1] == "4")
    expenses_ytd  = sum(sum(a["monthly"][:mo]) for name, a in per_account.items()
                        if str(a["type"] or "")[:1] in ("5", "6", "7"))
    income_ann    = sum(sum(a["monthly"]) for name, a in per_account.items()
                        if str(a["type"] or "")[:1] == "4")
    expenses_ann  = sum(sum(a["monthly"]) for name, a in per_account.items()
                        if str(a["type"] or "")[:1] in ("5", "6", "7"))
    return {
        "income_ytd":    round(income_ytd),
        "expenses_ytd":  round(expenses_ytd),
        "income_annual": round(income_ann),
        "expenses_annual": round(expenses_ann),
        "per_account":   {n: sum(a["monthly"][:mo]) for n, a in per_account.items()},
        # Per-account budget rows, so a firm without a workbook still gets a
        # Budget vs Actuals page. Carta's budget carries no department or
        # tag dimension, so the only axis it can offer is the account.
        "rows":          [
            {"label": n, "account_type": a["type"],
             "gl_codes": [a["type"]] if a["type"] is not None else [],
             "annual": round(sum(a["monthly"])),
             "budget_ytd": round(sum(a["monthly"][:mo])),
             "monthly": [round(x) for x in a["monthly"]]}
            for n, a in sorted(per_account.items())
            if any(a["monthly"])
        ],
        "source":        source,
        "by_tag_value": None,
    }


def empty_budgets():
    """`_carta_budget_summary`'s shape with every figure zeroed — the
    actuals-only budget for a firm that declined one, Excel and Carta
    alike."""
    return _carta_budget_summary({}, 12, "none")


# Net income is an aggregate in the expense section's vicinity but it is
# not a total OF expenses — including it as a candidate made one firm's
# opex resolve to its bottom line. "Operating"/"Ordinary" is a common
# qualifier ("Net Operating Income") the bare pattern didn't cover.
_NET_INCOME_LABEL_RX = re.compile(r"^Net\s+(?:Operating\s+|Ordinary\s+)?(Income|Loss)\b", re.IGNORECASE)


def _monthly_crosstab_figures(rows, as_of_month):
    """The income and expense scalars and per-account budgets of a monthly-crosstab budget's
    rows: a straight sum of the flat rows by leading GL digit."""
    mo = max(1, min(12, as_of_month))

    def is_income(t):
        return str(t or "")[:1] == "4"

    income_ytd = income_ann = expenses_ytd = expenses_ann = 0.0
    for r in rows:
        monthly = r.get("monthly") or [0.0] * 12
        annual = r.get("annual") or sum(monthly)
        ytd = sum(monthly[:mo])
        if is_income(r.get("account_type")):
            income_ann += annual
            income_ytd += ytd
        else:
            expenses_ann += annual
            expenses_ytd += ytd
        r.setdefault("gl_codes", r.get("account_type_all") or
                     ([r["account_type"]] if r.get("account_type") is not None else []))
    return {
        "income_ytd": round(income_ytd), "expenses_ytd": round(expenses_ytd),
        "income_annual": round(income_ann), "expenses_annual": round(expenses_ann),
        "per_account": {r["label"]: r.get("budget_ytd", 0) for r in rows},
    }


def _read_monthly_crosstab_budget(data, path, as_of_month):
    """Normalize a monthly-crosstab budget (shapes/monthly_crosstab.py) into
    the read_budgets()-shaped envelope BudgetActualsAccounts.jsx renders.

    No department axis exists in this shape, so income/expense scalars are
    a straight sum of the flat rows by leading GL digit — no section
    hierarchy to walk, unlike the outline shape.
    """
    rows = data.get("rows") or []
    mo = max(1, min(12, as_of_month))
    figures = _monthly_crosstab_figures(rows, as_of_month)

    return {
        **figures,
        # An actuals-only budget keeps its marker; every other monthly-crosstab budget is an excel-workbook.
        "source": data["source"] if data.get("source") == report_store.ACTUALS_ONLY_SOURCE else "excel-workbook",
        "by_tag_value": None,
        "workbook_meta": data.get("workbook_meta"),
        "view_kinds": ["by-account"],
        "period_kind": "annual",
        "period_year": data.get("period_year"),
        "period": {
            "first_month": 1, "last_month": mo,
            "label": f"Jan–{_MONTH_ABBR[mo - 1]} {data.get('period_year') or ''}".strip(),
        },
        "rows": rows,
        "id": data.get("id") or manco_paths.default_budget_id(path),
        "label": data.get("label") or (data.get("workbook_meta") or {}).get("sheet") or "Budget",
    }


def _outline_figures(rows, period_kind, as_of_month):
    """An outline budget's income and expense scalars, read from its own aggregate rows
    ("Total Income", "Total Operating Expenses") rather than recomputed: those cells are the
    client's authoritative plan numbers and can legitimately differ from the sum of their
    constituents."""
    def _section_total(section):
        """The section's grand total, from the outline's own structure.

        Matching on a literal label like "Total Income" only covers one
        firm's wording — firms write "Qtrly Totals", "Total Expenses",
        "Total Mgmt Fee Including Creator", and other variants that a
        literal match would silently resolve to zero.

        With several `total`/`summary` rows in the section, a total that
        another candidate's formula-derived tree (`children`/`total_key`
        from the pnl-outline adapter) names as a child is never added: the
        tree only ever rules candidates out, since a tree the adapter
        built is read, never guessed at. A missing `total_key` in every
        other candidate's `children` never proves the remainder are
        siblings — the same grand total can equally be written over the
        leaf lines its department totals already cover (`SUBTOTAL`
        excludes a nested `SUBTOTAL` the way Excel does), in which case no
        candidate names another and the tree alone can't tell a sibling
        from a roll-up either. Whatever the tree doesn't rule out — one
        candidate, several, with or without a tree of their own — goes to
        the arithmetic check: a candidate equal to the sum of the others
        is taken as the roll-up, on the premise that a grand total is by
        construction at least as big as the sub-totals beneath it; failing
        that, the candidates are siblings covering different parts of the
        business, and are added.
        """
        cands = [r for r in rows
                 if r.get("section") == section
                 and r.get("row_kind") in ("total", "summary")
                 and isinstance(r.get("annual"), (int, float))
                 and not _NET_INCOME_LABEL_RX.match(str(r.get("label", "")))]
        if not cands:
            # No aggregate at all — add up the lines ourselves.
            return sum(float(r.get("annual") or 0.0) for r in rows
                       if r.get("section") == section and r.get("row_kind") == "line")
        if len(cands) == 1:
            return float(cands[0]["annual"])

        # A total named as another candidate's child is a part of what
        # that candidate already states, so it's dropped before anything
        # else runs — never added on top of the total that rolls it up.
        # A candidate the tree says nothing about (no `children` at all)
        # is never dropped this way: the tree can only rule candidates
        # out, not stand in for one that carries no tree of its own.
        cands = totals_tree.tree_roots(cands)
        if len(cands) == 1:
            return float(cands[0]["annual"])

        # Whatever the tree didn't rule out still goes to the arithmetic
        # check below — the tree ruling nothing out here never proves the
        # survivors are siblings: a grand total over the same leaf lines
        # its department totals already cover (a `SUBTOTAL` excluding a
        # nested `SUBTOTAL`, or a `SUM` range over lines rather than over
        # other totals) names no other candidate as its child either. One
        # of them rolls the others up, or they are siblings covering
        # different parts of the business and the section total is their
        # sum. Magnitude alone can't tell those apart — the largest of two
        # sibling totals looks exactly like a grand total sitting above a
        # small subtotal. What distinguishes them is arithmetic: a roll-up
        # equals the rest added together.
        vals = [abs(float(r["annual"])) for r in cands]
        total = sum(vals)
        for r, v in zip(cands, vals):
            rest = total - v
            if rest and abs(v - rest) <= 0.01 * max(v, rest):
                return float(r["annual"])
        # No row accounts for the others: they are siblings, so add them.
        return sum(float(r["annual"]) for r in cands)

    income_total = _section_total(SECTION_INCOME)
    opex_total = _section_total(SECTION_OPEX)

    def _section_ytd(section):
        """The section's budget through as_of_month, summed from each
        line's own monthly[] — an annual budget's total row states the
        full year, never a stopping-point partway through it.
        """
        return sum(
            sum(float(v or 0.0) for v in (r.get("monthly") or [])[:as_of_month])
            for r in rows
            if r.get("section") == section and r.get("row_kind") == "line"
        )

    if period_kind == "annual":
        income_ytd_total = _section_ytd(SECTION_INCOME)
        expenses_ytd_total = _section_ytd(SECTION_OPEX)
    else:
        income_ytd_total = income_total
        expenses_ytd_total = opex_total
    return {
        "income_ytd":       round(income_ytd_total),
        "expenses_ytd":     round(expenses_ytd_total),
        "income_annual":    round(income_total),
        "expenses_annual":  round(opex_total),
        # No per-account budget map — the dashboard's spend_by_gl chart is
        # driven by the primary budget, and an outline budget is never
        # primary in practice (it sorts after budget.json). Empty map keeps
        # the contract intact if it ever is.
        "per_account":      {},
    }


def _read_outline_budget(data, path, period_kind, as_of_month, coa_value_aliases=None):
    """Normalize an outline-shaped budget (shapes/pnl_outline.py) into the
    same envelope read_excel_budget() returns for crosstab budgets, so the
    multi-budget emitter downstream can treat both uniformly.

    Income / expense scalars are read from the outline's own aggregate
    rows ("Total Income", "Total Operating Expenses") rather than being
    recomputed — those cells are the client's authoritative plan numbers
    and can legitimately differ from the sum of their constituents.
    by_tag_value is None: an outline budget has no dept crosstab, and
    the UI keys off view_kinds to pick the outline renderer instead.
    """
    rows = data.get("rows") or []
    return {
        **_outline_figures(rows, period_kind, as_of_month),
        "source":           "excel-workbook",
        "by_tag_value":    None,
        "workbook_meta":    data.get("workbook_meta"),
        "period_kind":      period_kind,
        # Carried, not dropped: `_budget_window` reads this payload and
        # falls back to quarterly cadence without it, so a monthly budget
        # was compared over whole quarters while the period chip beside it
        # — which reads the parsed file — said otherwise.
        "period_granularity": data.get("period_granularity"),
        "period_year":      data.get("period_year"),
        "period":           _period_meta(data, period_kind, as_of_month),
        "view_kinds":       data.get("view_kinds") or ["by-line-item"],
        "rows":             rows,
        # value_aliases: workbook dept name → Carta REPORTING_TAGS
        # Department values. The outline's expense lines carry a `dept`
        # hint; the UI needs this table to translate that into the tag
        # values it filters JEs by. Crosstab budgets get the equivalent
        # per-entry as by_tag_value[].carta_tags.
        "value_aliases":     coa_value_aliases or {},
        "id":               manco_paths.default_budget_id(path),
        "label":            (data.get("label")
                             or (data.get("workbook_meta") or {}).get("sheet")
                             or "Budget"),
    }


def _budget_window(budget_payload, as_of_month):
    """The months a budget actually covers, as (first, last) 1-based, plus a
    label for the UI.

    Comparing actuals to budget requires matching the window: a budget
    stated through June is compared only through June, and a quarter-to-date
    budget is compared only over its own elapsed quarters — otherwise the
    variance reads artificially high.

    A crosstab states its own end date in its title band. An outline states
    quarters, so it is compared over whole elapsed quarters — a partial
    quarter would charge two months of spend against three months of plan.
    `period_start` comes from the ingest answer when the sheet itself is
    ambiguous; a year-to-date tab and a quarter-to-date tab can carry
    identical title bands.
    """
    end_iso = budget_payload.get("period_end")
    last = as_of_month
    if isinstance(end_iso, str) and len(end_iso) >= 7:
        try:
            last = min(int(end_iso[5:7]), as_of_month)
        except ValueError:
            pass

    first = 1
    start_iso = budget_payload.get("period_start")
    if isinstance(start_iso, str) and len(start_iso) >= 7:
        try:
            first = int(start_iso[5:7])
        except ValueError:
            pass

    if budget_payload.get("period_kind") == "annual":
        first = 1
        # Through the month the ledger reaches, whatever the cadence. A
        # firm on quarterly cadence still wants to see the quarter it is in
        # — two months of spend against three months of plan reads a little
        # under, and a reader mid-quarter expects that. Withholding the
        # figure until the quarter closes is the worse trade: it shows
        # nothing at all for two months in every three, and the operator
        # can always ask for a different range.
        last = as_of_month
    if last < first:
        return None
    return first, last


_MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
               "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


def _period_meta(data, period_kind, as_of_month):
    """The window a budget covers, in the form the UI needs.

    The build script windows the figures it computes itself, but the Budget
    vs Actuals page sums journal entries in the browser and so needs the
    same window in the payload. Without it the page charges every month on
    the books against a budget that may stop mid-year, and every line reads
    over budget by whatever came after.

    Returns None when the shape states no period — the UI then falls back
    to year-to-date, which is what it always did.
    """
    window = _budget_window({**data, "period_kind": period_kind}, as_of_month)
    if not window:
        return None
    first, last = window
    year = data.get("period_year")
    return {
        "first_month": first,
        "last_month":  last,
        "label": (f"{_MONTH_ABBR[first - 1]}–{_MONTH_ABBR[last - 1]}"
                  + (f" {year}" if year else "")),
    }


def carta_variance_payload(budgets):
    """A Carta budget in the shape build_variance_categories reads.

    Carta states no categories of its own, so each account becomes one.
    `annual` carries the YTD figure, not the year: actuals are summed over
    the same Jan..as_of window, and a full-year plan would report the
    months still to come as a firm-wide underspend.
    """
    # Carta is asked for each month separately, so its figures are stated
    # monthly, not a quarter spread evenly across the months inside it.
    return {"period_granularity": "monthly",
            "rows": [{"row_kind": "line",
                      "label": r["label"],
                      "gl_codes": r.get("gl_codes") or [],
                      "annual": r.get("budget_ytd") or 0,
                      "monthly": r.get("monthly") or []}
                     for r in (budgets.get("rows") or [])]}


def _read_workbook_ref(dashboard_dir):
    """`.workbook-ref.json`'s parsed contents, or `None` when the file is
    absent or unreadable (warning on stderr in the unreadable case).
    The one place this file is parsed, so every reader handles an
    unreadable ref the same way."""
    ref_path = Path(dashboard_dir) / ".workbook-ref.json"
    if not ref_path.exists():
        return None
    try:
        return json.loads(ref_path.read_text())
    except Exception as e:
        print(f"warn: .workbook-ref.json unreadable ({e}); ignoring it.",
              file=sys.stderr)
        return None


def find_excel_budget_files(dashboard_dir):
    """Return the firm's parsed Excel budget files, ordered so that
    budget.json (the "primary") comes first, followed by budget-<slug>.json
    variants (alphabetical). Multi-budget support: a firm can have several
    budgets coexisting (a YTD dept crosstab plus an annual plan) — each gets
    its own file, and they are emitted into snapshot.budgets as an array.

    Parsed budgets are only honoured when `.workbook-ref.json` records that
    a workbook is in use for this firm. The ref is the record of intent; the
    JSON beside it is derived output. Reading the derived files on their own
    means a budget, once ingested, renders forever even past a decline at
    the prompt. Orphans (parsed files with no ref) are reported rather than
    silently used. A ref that names its files is provenance enough on its
    own — the source workbook itself is never read here, and its later
    absence from disk (moved, renamed, deleted) says nothing about whether
    the parse is still good.
    """
    d = Path(dashboard_dir)
    primary = d / "budget.json"
    # budget-mapping.json is this dir's record of the client's own answers,
    # not a budget — it only matches the glob by an accident of naming.
    variants = sorted(p for p in d.glob("budget-*.json")
                      if p.name not in ("budget.json", "budget-mapping.json"))
    on_disk = ([primary] if primary.exists() else []) + variants

    ref = _read_workbook_ref(d)
    if ref is None:
        if on_disk and not (d / ".workbook-ref.json").exists():
            print(
                f"warn: found {len(on_disk)} parsed budget file(s) in {d} with no "
                f".workbook-ref.json to account for them; ignoring. They are "
                f"left in place — re-ingest with --budget-workbook to use them.",
                file=sys.stderr,
            )
        return []

    if ref.get("declined"):
        # The operator was asked and said this firm has no Excel budget.
        return []

    # Deliberately not checking whether ref["path"] still exists: this reads
    # only the already-parsed JSON below, and the ref is its provenance record.

    # The ref names the budgets it produced. Use those, and only those.
    # Globbing whatever is on disk means a budget from an earlier ingest
    # rides along with the current one — selecting three tabs and getting
    # four views back, with the fourth having no connection to anything the
    # operator chose this time.
    named = ref.get("budgets")
    if isinstance(named, list) and named:
        files, missing = [], []
        for entry in named:
            fname = entry.get("file") if isinstance(entry, dict) else entry
            if not fname:
                continue
            fp = d / fname
            (files if fp.exists() else missing).append(fp)
        if missing:
            print(
                f"warn: .workbook-ref.json names {len(missing)} budget file(s) that "
                f"aren't present: {', '.join(p.name for p in missing)}. Re-ingest to "
                f"restore them.",
                file=sys.stderr,
            )
        stale = [p for p in on_disk if p not in files]
        if stale:
            print(
                f"note: ignoring {len(stale)} budget file(s) the current workbook "
                f"reference doesn't name: {', '.join(p.name for p in stale)}. They are "
                f"left in place; re-ingest that sheet to bring it back.",
                file=sys.stderr,
            )
        # Primary first, then the rest in the order the ref lists them.
        files.sort(key=lambda p: (p.name != "budget.json",))
        return files

    # Legacy single-sheet ref: no `budgets` list, so fall back to what is
    # on disk. Refs written before multi-tab ingest look like this.
    files = []
    if primary.exists():
        files.append(primary)
    files.extend(variants)
    return files


def carta_budget_opted_in(dashboard_dir):
    """Whether Carta's stored budget is used when no Excel budget is in use.

    `use_carta_budget` on a declined ref decides. A declined ref without the
    key cannot tell "Skip for now" from "The budget in Carta", and is read as
    Skip: actuals only. No readable ref at all counts as opted in.
    """
    ref = _read_workbook_ref(dashboard_dir)
    if ref is None or not ref.get("declined"):
        return True
    return ref.get("use_carta_budget", False)


# A budget.json is written by the parse step and read by this one, and the
# two do not have to run in the same invocation — a cached workbook parsed
# before these fields were renamed is still on disk. Read the old spelling
# once, here, rather than testing for it at every use.
_RENAMED_ROW_FIELDS = {"by_dept": "by_column", "formula_by_dept": "formula_by_column"}


def snapshot_budget_entry(b, as_of_month):
    """One resolved budget `b` (read_excel_budget()'s or read_budgets()'s output), in the
    shape snapshot.json's budget.budgets[] carries it: the scalars the Budget vs Actuals
    sub-nav and its charts read, plus every view it structurally supports beyond its own
    native one (budget_view_fields)."""
    return {
        "id":            b.get("id") or "primary",
        "label":         b.get("label") or "Budget",
        # Report state for the app: editable, shared, read-only (see report_store.py).
        "report":        b.get("report"),
        "source":        b.get("source"),
        "income":        {"annual": b["income_annual"],   "ytd": b["income_ytd"]},
        "expenses":      {"annual": b["expenses_annual"], "ytd": b["expenses_ytd"]},
        "net":           {"annual": b["income_annual"] - b["expenses_annual"],
                          "ytd":    b["income_ytd"]    - b["expenses_ytd"]},
        "by_tag_value": b.get("by_tag_value"),
        "workbook_meta": b.get("workbook_meta"),
        "period_kind":   b.get("period_kind"),
        "period_granularity": b.get("period_granularity"),
        "period_year":   b.get("period_year"),
        "period":        b.get("period"),
        "view_kinds":    b.get("view_kinds") or ["by-tag-crosstab"],
        # rows[] carries the raw adapter output — needed for the
        # by-quarter and by-line-item views, which read monthly[12]
        # (and, for outline budgets, the section/subtotal
        # structure) directly. by_tag_value (above) is the
        # pre-aggregated shape the crosstab view uses.
        "rows":          b.get("rows") or [],
        # Outline budgets carry value_aliases at the budget level
        # (crosstab budgets carry the same info per by_tag_value
        # entry as carta_tags).
        "value_aliases":  b.get("value_aliases") or {},
        # The sharer's Budget vs Actuals filters, on a report shared with you.
        **({"view": b["view"]} if "view" in b else {}),
        # Every view this budget's data structurally supports,
        # beyond view_kinds[0] above; views[view_kinds[0]] always
        # equals rows/by_tag_value above.
        **dict(zip(("available_view_kinds", "views"),
                   budget_view_fields(b, as_of_month))),
    }


def budget_view_fields(b, as_of_month):
    """(available_view_kinds, views) for one resolved budget entry `b`.

    `views[native_kind]` reuses `b`'s own already-computed rows/by_tag_value
    verbatim — the native view never goes through a projection, so it can
    never diverge from what the budget already renders today. Every other
    view in `available_view_kinds` is a projection over the canonical model
    built from those same rows.
    """
    native_kind = (b.get("view_kinds") or [canonical_budget.BY_TAG_CROSSTAB])[0]
    c = canonical_budget.to_canonical(b)
    available = canonical_budget.available_view_kinds(c)
    if native_kind not in available:
        available = [native_kind] + available
    views = {native_kind: {"rows": b.get("rows") or [], "by_tag_value": b.get("by_tag_value")}}
    for kind in available:
        if kind in views:
            continue
        if kind == canonical_budget.BY_ACCOUNT:
            views[kind] = {"rows": canonical_budget.project_to_account_rows(c, as_of_month),
                           "by_tag_value": None}
        elif kind == canonical_budget.BY_LINE_ITEM:
            views[kind] = {"rows": canonical_budget.project_to_line_item_rows(c),
                           "by_tag_value": None}
        elif kind == canonical_budget.BY_TAG_CROSSTAB:
            rows, by_tag_value = canonical_budget.project_to_tag_crosstab(c)
            views[kind] = {"rows": rows, "by_tag_value": by_tag_value}
    return available, views


def _carry_forward_names(row):
    if not isinstance(row, dict):
        return row
    out = dict(row)
    for was, now in _RENAMED_ROW_FIELDS.items():
        if was in out and now not in out:
            out[now] = out.pop(was)
    calc = out.get("calculated")
    if isinstance(calc, dict):
        out["calculated"] = _carry_forward_names(calc)
    return out


def sync_crosstab_account_types(budget):
    """Refresh a crosstab budget's by_tag_value account_type maps from its
    rows' current `gl_codes`, after apply_budget_mapping and the other
    GL-rewriting passes (drop_foreign_gl_codes, autolink_exact_accounts,
    rehome_fee_rows_to_manco) have had their turn on it.

    read_excel_budget builds account_type_by_name / account_type_all_by_name
    once, from the workbook's own parse — before any of those passes, or a
    client's own budget-mapping.json decision, ever touch a row's GL
    identity. Left alone, a resolved crosstab line's mapped code never
    reaches the map BudgetActualsView.jsx actually joins Carta actuals
    against (see its account_type_by_name / account_type_all_by_name
    reads). No-op for a budget with no department axis (by_tag_value
    absent) or no rows.
    """
    rows = budget.get("rows") or []
    by_tag_value = budget.get("by_tag_value") or []
    if not rows or not by_tag_value:
        return
    type_by_name = defaultdict(dict)
    all_by_name = defaultdict(lambda: defaultdict(set))
    for r in rows:
        if r.get("row_kind") != "line":
            continue
        name = r.get("label")
        gls = (r.get("gl_codes") or r.get("account_type_all")
               or ([r["account_type"]] if r.get("account_type") is not None else []))
        if not name or not gls:
            continue
        for dept in (r.get("by_column") or {}):
            type_by_name[dept][name] = gls[0]
            all_by_name[dept][name].update(gls)
    for entry in by_tag_value:
        dept = entry.get("tag_value")
        if dept in type_by_name:
            entry["account_type_by_name"] = type_by_name[dept]
            entry["account_type_all_by_name"] = {
                n: sorted(s) for n, s in all_by_name[dept].items()
            }


def read_excel_budget(dashboard_dir, as_of_month, budget_file=None):
    """Load a client-supplied Excel budget from <dashboard_dir>/budget.json
    (or the file named by `budget_file`).

    Returns None when the file is absent — the caller falls back to Carta's
    fa:list:budgets payload via read_budgets(). When present, returns a
    dict shaped identically to read_budgets()'s output (income_ytd,
    expenses_ytd, income_annual, expenses_annual, per_account, source,
    by_tag_value) so downstream code can consume either interchangeably.

    Aggregation rules:
    - Firm-Total rows drive income_ytd / expenses_ytd. A workbook's Firm Total
      column is the sum-of-record for the workbook (per-dept rows may
      not add up to it — some budget lines are firm-wide and not
      dept-allocated).
    - per_account is keyed on account_name (matching read_budgets()) and
      sums the Firm Total dept across all rows with the same account_name.
      Downstream, spend_by_gl uses this map to render per-account budget
      bars on the top-10 GL chart.
    - by_tag_value is a new sidecar shape for the dimensional
      Budget-vs-Actuals view: {dept: {income_ytd, expenses_ytd,
      income_annual, expenses_annual, by_account: {name: amount}}}.
    - period_kind: workbooks emit "annual" or "ytd_through_as_of". For
      the YTD variety, the "annual" fields in the returned dict are set
      equal to YTD (no separate annual budget to render). Phase 5
      adapters with `monthly[]` populated + period_kind="annual" will
      distinguish the two properly.
    """
    p = Path(budget_file) if budget_file else Path(dashboard_dir) / "budget.json"
    if not p.exists():
        return None
    try:
        data = json.loads(p.read_text())
    except Exception as e:
        print(f"warn: {p.name} present but failed to parse: {e}", file=sys.stderr)
        return None
    resolved = _resolve_excel_budget(dashboard_dir, as_of_month, p, data)
    # A shared report carries the sharer's Budget vs Actuals filters; the app
    # opens it with them when the reader has saved none of their own. A custom
    # report's view carries its pivot, and `custom` the accounts the build cuts it to.
    for key in ("view", "custom"):
        if resolved is not None and key in data:
            resolved[key] = data[key]
    if resolved is not None and report_store.custom_gl_codes(data) is not None:
        resolved["_figure_inputs"] = {k: data[k] for k in _FIGURE_INPUTS if k in data}
    return resolved


_HEADER_KINDS = {"section_header", "subsection_header", "group_header"}


# What a budget row states as an amount: `monthly` and `annual` and `budget_ytd` are
# numbers, `by_column` maps each column (department, tag) to {budget, ...}.
_ROW_AMOUNTS = ("monthly", "annual", "budget_ytd", "by_column")


def _is_leaf_row(row):
    """A row that books accounts itself: a line, or a non-header row with no constituents
    but accounts of its own."""
    kind = canonical_budget.row_kind(row)
    return kind == "line" or (
        kind not in _HEADER_KINDS and not canonical_budget.row_constituents(row)
        and bool(canonical_budget.row_gl_codes(row, mapped_gl_first=True)))


def _sum_amounts(parts, like):
    """The amounts of `like`, re-summed from `parts` = [(row, sign)], over every amount
    field `like` or a part states. A part that was cut away is simply not in `parts`."""
    def column_budget(row, col):
        entry = (row.get("by_column") or {}).get(col)
        return (entry.get("budget") if isinstance(entry, dict) else None) or 0

    out = {}
    for field in _ROW_AMOUNTS:
        if not (like.get(field) or any(r.get(field) for r, _ in parts)):
            continue
        if field == "monthly":
            width = max([len(like.get(field) or [])] + [len(r.get(field) or []) for r, _ in parts])
            month = lambda r, i: ((r.get(field) or [])[i:i + 1] or [0])[0] or 0
            out[field] = [round(sum(sign * month(r, i) for r, sign in parts), 2) for i in range(width)]
        elif field == "by_column":
            cols = []
            for r, _ in parts:
                cols += [c for c in (r.get(field) or {}) if c not in cols]
            out[field] = {}
            for c in cols:
                kept = (like.get(field) or {}).get(c)
                out[field][c] = {**(kept if isinstance(kept, dict) else {}),
                                 "budget": round(sum(sign * column_budget(r, c) for r, sign in parts), 2)}
        else:
            out[field] = round(sum(sign * (r.get(field) or 0) for r, sign in parts), 2)
    return out


def cut_to_accounts(rows, gl_codes):
    """`rows` with only what `gl_codes` books, and no amount from anything cut away — a
    custom report's cut, the same rules as the hosted Worker's derivedPayload
    (server/reportShare.js).

    - A leaf (a line, or a non-header row with no constituents but accounts of its own)
      stays when one of its accounts is wanted.
    - A total with constituents keeps the ones that survive and goes with its last one. An
      expression goes as soon as any term is cut or changes: it depends on every term.
    - A total whose cover shrank has its amounts re-summed from what it covers now.
    - A total or summary with neither constituents nor accounts records no cover, so a cut
      can't rebuild it: it stays, as stated, only when nothing is cut. A total summing one
      (at any depth, a cycle counting as one) goes with it.
    - Net income is rebuilt as total income less total operating expenses less a state and
      local tax line, from the rows kept. It goes when either total went for want of a cover,
      or when either has no row; a total that went because nothing under it was left reads as
      zero.
    - A header stays while anything under it does."""
    wanted = set(gl_codes)
    keys = [canonical_budget.row_key(r, i) for i, r in enumerate(rows)]
    by_key = dict(zip(keys, rows))
    leaves = [r for r in rows if _is_leaf_row(r)]
    leaf_kept = lambda r: bool(wanted & set(canonical_budget.row_gl_codes(r, mapped_gl_first=True)))
    any_cut = any(not leaf_kept(r) for r in leaves)

    # Per row key: kept, shrunk (its cover lost something), amounts (the row whose figures
    # it reads), parts (surviving constituents), lost (went because it can't be rebuilt, not
    # because nothing under it was left).
    cycle = {"kept": False, "shrunk": True, "amounts": {}, "lost": True}
    settled = {}

    def settle(key):
        if key in settled:
            return settled[key]
        settled[key] = cycle
        row = by_key[key]
        own = canonical_budget.row_constituents(row)
        if _is_leaf_row(row):
            out = {"kept": leaf_kept(row), "shrunk": False, "amounts": row, "lost": False}
        elif own:
            left = [k for k in own if k in by_key and settle(k)["kept"]]
            shrunk = len(left) < len(own) or any(settled[k]["shrunk"] for k in left)
            lost_part = any(k in by_key and settled[k]["lost"] for k in own)
            kept = not lost_part and (not shrunk if canonical_budget.row_derived(row) == "expression" else bool(left))
            amounts = _sum_amounts([(settled[k]["amounts"], 1) for k in left], row) if shrunk else row
            out = {"kept": kept, "shrunk": shrunk, "amounts": amounts, "parts": left,
                   "lost": lost_part or (not kept and bool(left))}
        else:
            out = {"kept": not any_cut, "shrunk": False, "amounts": row, "lost": any_cut}
        settled[key] = out
        return out

    for key, row in zip(keys, rows):
        if canonical_budget.row_kind(row) not in _HEADER_KINDS:
            settle(key)

    if any_cut:
        def read(pick):
            for key, row in zip(keys, rows):
                if canonical_budget.row_kind(row) not in _HEADER_KINDS and pick(row):
                    return settled[key]
            return {"kept": False, "amounts": {}, "missing": True}

        labelled = lambda prefix: lambda r: str(r.get("label") or "").strip().lower().startswith(prefix)
        income = read(labelled("total income"))
        opex = read(labelled("total operating expenses"))
        salt = read(lambda r: canonical_budget.row_kind(r) == "line" and re.search("state and local tax", r.get("label") or "", re.I))
        if income.get("lost") or opex.get("lost") or income.get("missing") or opex.get("missing"):
            net = {"kept": False, "amounts": {}}
        else:
            net = {"kept": True, "_signed": [(income, 1), (opex, -1), (salt, -1)]}
        for key, row in zip(keys, rows):
            if canonical_budget.row_derived(row) == "net_income" and not _is_leaf_row(row) and not canonical_budget.row_constituents(row):
                if net["kept"]:
                    parts = [(s["amounts"], sign) for s, sign in net["_signed"] if s["kept"]]
                    settled[key] = dict(settled[key], kept=True, amounts=_sum_amounts(parts, row), rebuilt=True)
                else:
                    settled[key] = dict(settled[key], kept=False, amounts={})

    kept = lambda i: canonical_budget.row_kind(rows[i]) not in _HEADER_KINDS and settled[keys[i]]["kept"]

    def header_kept(i):
        depth = rows[i].get("depth") or 0
        for j in range(i + 1, len(rows)):
            if (rows[j].get("depth") or 0) <= depth:
                break
            if kept(j):
                return True
        return False

    out = []
    for i, row in enumerate(rows):
        if canonical_budget.row_kind(row) in _HEADER_KINDS:
            if header_kept(i):
                out.append(row)
        elif kept(i):
            state = settled[keys[i]]
            if state.get("shrunk") or state.get("rebuilt"):
                row = dict(row, **state["amounts"])
                if state.get("shrunk"):
                    row["constituents"] = state["parts"]
                    if (row.get("calculated") or {}).get("constituents"):
                        row["calculated"] = dict(row["calculated"], constituents=state["parts"])
            out.append(row)
    return out


def _crosstab_figures(rows, data, as_of_month, period_kind, coa_value_aliases):
    """A department crosstab budget's figures from its rows: the firm-level scalars, the
    per-account budgets and the per-department by_tag_value entries."""
    is_ytd_only = period_kind == "ytd_through_as_of"

    # Which department column is the sheet's roll-up. It is the column
    # the workbook totals into, so it drives the firm-level scalars and
    # per-account budgets rather than being summed with the others.
    # Named rather than assumed: workbooks label it variously, so match on
    # the word and fall back to the last column, which is where a total
    # conventionally sits.
    tag_values = data.get("tag_values") or []
    FIRM_TOTAL = next(
        (d for d in tag_values if "total" in d.strip().lower()),
        tag_values[-1] if tag_values else "Firm Total",
    )

    # A crosstab budget mirrors the workbook's own outline (see
    # shapes/tag_crosstab.py): section bands, groupings, subtotals and
    # totals alongside the leaf lines, each carrying a per-department
    # value map.
    #
    # ONLY leaf lines feed the aggregates below. The workbook's own
    # subtotals sit in the same row list, and summing them alongside the
    # rows they already roll up would count that money two, three or four
    # times over depending on how deeply the tab nests.
    line_rows = [r for r in rows if r.get("row_kind") == "line"]

    def _dept_budget(row, dept):
        entry = (row.get("by_column") or {}).get(dept) or {}
        val = entry.get("budget")
        if val is None:
            return None
        try:
            return float(val)
        except (TypeError, ValueError):
            return None

    def is_income(atype):  return str(atype or "")[:1] == "4"
    def is_expense(atype): return str(atype or "")[:1] in ("5", "6", "7")

    per_account = defaultdict(float)
    for r in line_rows:
        val = _dept_budget(r, FIRM_TOTAL)
        if val is not None:
            per_account[r["label"]] += val

    # Firm-level scalars: prefer the workbook's own total rows, which are
    # the figures the client reads off the tab. Their totals don't always
    # equal the sum of the lines beneath them, and where they disagree the
    # workbook wins — same rule the outline reader applies.
    def _workbook_total(exact_labels, needles, tag_value=None):
        tag_value = tag_value or FIRM_TOTAL
        totals = [r for r in rows if r.get("row_kind") == "total"]
        for want in exact_labels:
            for r in totals:
                if (r.get("label") or "").strip().lower() == want:
                    val = _dept_budget(r, tag_value)
                    if val is not None:
                        return val
        # No exact hit: take the LAST row mentioning the words. Section
        # totals ("Total Facilities Expense") sit at the same outline
        # depth as the sheet total and read the same way, so depth can't
        # separate them — but the sheet total comes after everything it
        # sums.
        for r in reversed(totals):
            label = (r.get("label") or "").strip().lower()
            if all(n in label for n in needles):
                val = _dept_budget(r, tag_value)
                if val is not None:
                    return val
        return None

    _INCOME_TOTALS  = (("total income", "total revenue"), ("total", "income"))
    _EXPENSE_TOTALS = (("total expenses", "total expense",
                        "total operating expenses"), ("total", "expense"))

    income_ytd = _workbook_total(*_INCOME_TOTALS)
    if income_ytd is None:
        income_ytd = sum(v for r in line_rows
                         if is_income(r.get("account_type"))
                         and (v := _dept_budget(r, FIRM_TOTAL)) is not None)
    expenses_ytd = _workbook_total(*_EXPENSE_TOTALS)
    if expenses_ytd is None:
        expenses_ytd = sum(v for r in line_rows
                           if is_expense(r.get("account_type"))
                           and (v := _dept_budget(r, FIRM_TOTAL)) is not None)

    # by_tag_value: aggregate per dept. Firm Total gets its own entry so the
    # dashboard's crosstab table can render a Firm Total column — its
    # by_account map comes from the workbook's own Firm Total column, not
    # from summing the dept-level rows (some budget lines are firm-wide
    # and don't appear on any dept column).
    by_column = defaultdict(lambda: {
        "income_ytd": 0.0, "expenses_ytd": 0.0,
        "income_annual": 0.0, "expenses_annual": 0.0,
        "by_account": defaultdict(float),
        # account_type_by_name: display-key → primary GL code, so the UI
        # can join against Carta actuals by account_type instead of
        # relying on account-name matching (Carta names diverge from
        # workbook names — e.g. workbook "Management Fees" vs Carta
        # "Management fee income").
        "account_type_by_name": {},
        # account_type_all_by_name: display-key → list of GL codes when
        # the workbook line's col A is multi-GL (e.g. "4170, 4175"), so
        # the UI sums Carta actuals across all mapped codes. Falls back
        # to [primary_gl] when the row is single-GL.
        "account_type_all_by_name": {},
        # comments_by_account: display-key → workbook Comments-column text
        # for that (dept, account) pair. Rendered in the BudgetActualsView
        # drilldown drawer as context for why a budget value was set.
        # Multiple rows in the workbook can share the same (dept, account)
        # cell (rare — usually a subtotal row + a leaf row), so join with
        # newline if that happens.
        "comments_by_account": {},
    })
    for r in line_rows:
        name = r["label"]
        acct_type = r.get("account_type")
        acct_type_all = r.get("account_type_all")
        for dept, entry in (r.get("by_column") or {}).items():
            d = by_column[dept]
            amt = _dept_budget(r, dept)
            if amt is not None:
                d["by_account"][name] += amt
                if is_income(acct_type):
                    d["income_ytd"] += amt
                elif is_expense(acct_type):
                    d["expenses_ytd"] += amt
            if acct_type is not None:
                d["account_type_by_name"][name] = acct_type
                # Union any prior list with this row's list — same account
                # name across dept-level rows could conceivably carry
                # different GL sets, though in practice this is stable.
                existing = set(d["account_type_all_by_name"].get(name, []))
                for gl in (acct_type_all or [acct_type]):
                    existing.add(gl)
                d["account_type_all_by_name"][name] = sorted(existing)
            comment = entry.get("comment")
            if isinstance(comment, str) and comment.strip():
                prior = d["comments_by_account"].get(name)
                d["comments_by_account"][name] = (
                    f"{prior}\n{comment.strip()}" if prior else comment.strip()
                )
    # Every department the workbook declares gets an entry, even one whose
    # every cell is empty — a column the client left blank is information,
    # and silently omitting it makes the table disagree with their tab.
    for dept in tag_values:
        by_column[dept]

    # Each department column carries its own total rows. Prefer them over
    # the sum of that column's leaves, for the same reason the firm-level
    # scalars do: it is the figure the client reads off their own tab, and
    # where a workbook's total disagrees with its own detail we show what
    # they see rather than quietly correcting it.
    for dept, d in by_column.items():
        col_income = _workbook_total(*_INCOME_TOTALS, tag_value=dept)
        if col_income is not None:
            d["income_ytd"] = col_income
        col_expenses = _workbook_total(*_EXPENSE_TOTALS, tag_value=dept)
        if col_expenses is not None:
            d["expenses_ytd"] = col_expenses

    by_tag_value = []
    for dept, d in by_column.items():
        entry = {
            "tag_value":       dept,
            "income_ytd":       round(d["income_ytd"]),
            "expenses_ytd":     round(d["expenses_ytd"]),
            "net_ytd":          round(d["income_ytd"] - d["expenses_ytd"]),
            "income_annual":    round(d["income_ytd"] if is_ytd_only else d["income_annual"]),
            "expenses_annual":  round(d["expenses_ytd"] if is_ytd_only else d["expenses_annual"]),
            "by_account":       {n: round(v) for n, v in d["by_account"].items()},
            "account_type_by_name": d["account_type_by_name"],
            "account_type_all_by_name": d["account_type_all_by_name"],
            "comments_by_account":  d["comments_by_account"],
            # carta_tags: which REPORTING_TAGS_JSON.Department values on
            # Carta JEs count toward this workbook dept. When the coa
            # mapping is absent, defaults to [dept] (identity — the raw
            # workbook super-header name). Firm Total gets [] as a
            # sentinel meaning "no tag filter, sum every entry" — the UI
            # reads this list length as its branch condition.
            "carta_tags":            ([] if dept == FIRM_TOTAL
                                      else (coa_value_aliases.get(dept) or [dept])),
        }
        by_tag_value.append(entry)
    # Firm Total last, all other depts sorted by expenses (biggest first).
    firm_total_entry = next((e for e in by_tag_value if e["tag_value"] == FIRM_TOTAL), None)
    other_depts = [e for e in by_tag_value if e["tag_value"] != FIRM_TOTAL]
    other_depts.sort(key=lambda x: -x["expenses_ytd"])
    by_tag_value = other_depts + ([firm_total_entry] if firm_total_entry else [])
    return {
        "income_ytd":       round(income_ytd),
        "expenses_ytd":     round(expenses_ytd),
        # For YTD-only workbooks, the "annual" bar in the UI just
        # mirrors YTD. Shapes carrying true annual data will
        # populate a distinct annual figure in Phase 5.
        "income_annual":    round(income_ytd if is_ytd_only else income_ytd),
        "expenses_annual":  round(expenses_ytd if is_ytd_only else expenses_ytd),
        "per_account":      {n: round(v) for n, v in per_account.items()},
        "by_tag_value":     by_tag_value,
    }


def _budget_shape(data):
    """Which reader a budget file takes: a department crosstab, a flat monthly crosstab, or
    an outline."""
    if data.get("dimensions"):
        return "crosstab"
    if (data.get("workbook_meta") or {}).get("shape_adapter") == "monthly-crosstab":
        return "monthly-crosstab"
    return "outline"


# What _refigure needs of a budget file besides its rows.
_FIGURE_INPUTS = ("dimensions", "tag_values", "period_kind", "workbook_meta")


def _refigure(entry, as_of_month):
    """`entry`'s income, expense, per-account and per-department figures, recomputed from
    its current rows, so a custom report's figures come from the rows it was cut to rather
    than the budget it was cut from. `entry["_figure_inputs"]` is what read_excel_budget
    kept of the file."""
    data = entry.pop("_figure_inputs", None) or {}
    rows = entry.get("rows") or []
    # Each department's carta_tags came from the workbook's alias map; keep them.
    coa_value_aliases = {e["tag_value"]: e["carta_tags"]
                         for e in entry.get("by_tag_value") or [] if e.get("carta_tags")}
    period_kind = data.get("period_kind", "annual")
    shape = _budget_shape(data)
    if shape == "crosstab":
        figures = _crosstab_figures(rows, data, as_of_month, period_kind, coa_value_aliases)
    elif shape == "monthly-crosstab":
        figures = _monthly_crosstab_figures(rows, as_of_month)
    else:
        figures = _outline_figures(rows, period_kind, as_of_month)
    entry.update(figures)
    sync_crosstab_account_types(entry)


def _resolve_excel_budget(dashboard_dir, as_of_month, p, data):
    """read_excel_budget()'s aggregation, over the already-loaded `data` read from `p`."""
    rows = data.get("rows") or []
    # Zero rows normally means nothing to ingest. A custom report is the one exception: its
    # own Actual always comes from the ledger (pivot.js's VALUE_FIELDS.actual), never from
    # its rows, so an actuals-only one (cut to zero budget rows on purpose) is still real.
    if not rows and report_store.custom_gl_codes(data) is None:
        return None
    rows = [_carry_forward_names(r) for r in rows]

    period_kind = data.get("period_kind", "annual")
    is_ytd_only = period_kind == "ytd_through_as_of"

    # Optional Chart-of-Accounts mapping — supplies value_aliases so the UI
    # can join Carta actuals to the correct workbook dept even when the
    # workbook's super-header dept names don't match Carta's raw
    # REPORTING_TAGS_JSON.Department values (e.g. workbook "Founder
    # Services" ↔ Carta tag "CS"). Falls back to identity mapping
    # (workbook_dept → [workbook_dept]) when absent.
    coa_map_path = Path(dashboard_dir) / "coa-mapping.json"
    coa_value_aliases: dict[str, list[str]] = {}
    coa_records: list = []
    if coa_map_path.exists():
        try:
            coa_data = json.loads(coa_map_path.read_text())
            coa_value_aliases = coa_data.get("value_aliases") or {}
            coa_records = coa_data.get("records") or []
        except Exception as e:
            print(f"warn: coa-mapping.json present but failed to parse: {e}", file=sys.stderr)

    # dimensions == [] means no department axis — two shapes share that,
    # told apart by shape_adapter. monthly-crosstab is a flat GL-line-item
    # list (see shapes/monthly_crosstab.py); pnl-outline mirrors the
    # workbook's own hierarchical P&L. Neither goes through the
    # tag-crosstab aggregation below.
    shape = _budget_shape(data)
    if shape != "crosstab":
        if shape == "monthly-crosstab":
            return _read_monthly_crosstab_budget(data, p, as_of_month)
        # A shared report carries the tag aliases it was built with.
        return _read_outline_budget(data, p, period_kind, as_of_month,
                                    data.get("value_aliases") or coa_value_aliases)

    # Backfill GL codes the workbook's own Budget-vs-Actuals tab left off a
    # rollup line but its COA mapping tab states for that line by name (see
    # backfill_account_type_from_coa's docstring). Crosstab only — the
    # outline branch above already returned.
    if coa_records:
        n = backfill_account_type_from_coa(rows, coa_records)
        if n:
            print(f"note: backfilled {n} GL code(s) from coa-mapping.json's "
                  f"category names onto {p.name} lines missing one.",
                  file=sys.stderr)

    # A crosstab row carries its GL identity as account_type /
    # account_type_all (see shapes/tag_crosstab.py); apply_budget_mapping,
    # drop_foreign_gl_codes, autolink_exact_accounts and
    # unresolved_budget_rows all key on gl_codes instead — the field an
    # outline row carries. Seeding it here, once, lets a crosstab row take
    # every one of those passes exactly as an outline row would, including
    # a client's own recorded decision. sync_crosstab_account_types (called
    # from main after those passes run) writes the result back the other
    # way, into account_type/account_type_all and the by_tag_value maps the
    # UI actually reads.
    for r in rows:
        if r.get("row_kind") == "line":
            r.setdefault("gl_codes", r.get("account_type_all") or
                         ([r["account_type"]] if r.get("account_type") is not None else []))

    return {
        **_crosstab_figures(rows, data, as_of_month, period_kind, coa_value_aliases),
        "source":           "excel-workbook",
        "workbook_meta":    data.get("workbook_meta"),
        # view_kinds ("by-tag-crosstab", "by-quarter") declared by the shape
        # adapter, propagated so the UI can decide which chip-toggle
        # views to expose. Default to ["by-tag-crosstab"] for older
        # snapshots that don't declare — matches current behavior.
        "view_kinds":       data.get("view_kinds") or ["by-tag-crosstab"],
        # Preserve the raw row list from the adapter so the by-quarter
        # view has access to monthly[12] per (dept, account). The
        # tag-crosstab UI derives everything from by_tag_value, but
        # the quarter view needs monthly-level detail.
        "rows":             rows,
        # Propagate period metadata from the adapter's budget.json so the
        # UI can render a period label (e.g. "Period: Jan 1 – Jun 30, 2026"
        # for YTD-only workbooks, "Period: FY2026" for annual, "Q1–Q4
        # 2026" for a quarterly shape).
        "period_kind":      period_kind,
        "period_year":      data.get("period_year"),
        # The months this budget covers, so the Budget vs Actuals page can
        # sum the same window in the browser instead of everything on the
        # books. See _period_meta.
        "period":           _period_meta(data, period_kind, as_of_month),
        # Stable id + label for multi-budget selection. id defaults to the
        # filename stem (e.g. "budget-base-case-2026" → "base-case-2026");
        # label falls back to sheet name.
        "id":               data.get("id") or manco_paths.default_budget_id(p),
        "label":            (data.get("label") or (data.get("workbook_meta") or {}).get("sheet") or "Budget"),
    }

