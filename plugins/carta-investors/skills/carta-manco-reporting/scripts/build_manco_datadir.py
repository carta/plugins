#!/usr/bin/env python3
"""build_manco_datadir.py — assemble snapshot.json + accounts.json from raw MCP query dumps.

The skill's flow (SKILL.md):
  1. Resolve firm/ManCo over Carta MCP → firm_uuid, manco_uuid, carta_ids
  2. Run 4 SQL queries (via `dwh__execute__query`) + the cash-balance call
     (via `fa__get__cash-balance`) + monthly budget calls (via
     `fa__list__budgets`). Save each result verbatim under the raw dir as
     pipe-tables / JSON.
  3. Run THIS script to parse those raw dumps into the two JSON files the
     React app reads.

Keeping the fetch (LLM in SKILL.md, has MCP access) separate from the
assembly (this pure Python script, deterministic) makes the pipeline
debuggable: rerun the script with a fixed raw dir and the output is stable.

Expected files under --raw-dir (relative paths):
  reimbursement-entries.txt  — (optional) gluuids of entries settled through
                               the firm's reimbursement payable
  je-expense-page1.txt       — ACCOUNT_TYPE >= 5000 JE lines, first 1000 rows
  je-expense-page2.txt       — (optional) rows 1000+; the LLM writes it only when total_rows > 1000
  je-income.txt              — ACCOUNT_TYPE 4000-4999 JE lines
  fund-fees.txt              — cross-fund mgmt fee JEs 2021 onwards
  manco-fee-income.txt       — the ManCo's own mgmt fee income, with the
                               related-entity key that names the fund
  cash-balance.json          — fa:get:cash-balance response for the ManCo entity
  budget-<year>-01.json .. -12.json — fa:list:budgets per-month payloads (may be empty; all 12 months)

Written to --dashboard-dir:
  snapshot.json — KPI-level dashboard payload (firmName, ops, cash, budget, feeSchedule, monthlyCashflow, spendByGL)
  accounts.json — per-account rollup + full entry list + fund-fee entries

Stdlib-only, Python 3.9-safe.
"""

import argparse
import json
import re
import subprocess
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import manco_paths
import report_store
from manco_labels import is_income_section
from manco_mapping_store import (
    _read_mapping_or_empty,
    ambiguous_bare_addrs, assign_row_addresses,
    mapping_provenance, read_budget_mapping,
)
from manco_raw_dumps import (
    _parse_tags,
    check_fetch_completeness, manco_entity_currency, read_all_accounts,
    read_cash_balance, read_currency, read_entity_roster, read_expense_pages,
    read_fee_schedule_terms, read_fund_fees, read_income,
    read_manco_fee_income, read_reimbursement_entries,
)
from manco_fees import (
    _allocate_manco_fees, _build_fee_projections, _expected_remaining_this_year,
    backfill_fund_match_from_roster, fee_offset_asks, fund_quarter_totals,
    learn_bank_accounts, memo_bank_accounts, propose_fund_account,
    read_fund_attribution, rehome_fee_rows_to_manco, resolve_fund_attribution,
    funds_reported_twice,
)
from manco_dimensions import (
    CLAIMABLE_SOURCES, ROW_DIMENSION_SOURCES,
    apply_dimension_residual, claim_dimension_values, column_headings,
    dimension_census, dimension_value_of, generic_scope_words,
    has_dimension_values, read_inference_decisions, resolve_dimension,
    resolve_near_scopes, unclaimed_dimension_values,
)
from manco_gl_matching import (
    apply_budget_mapping, autolink_exact_accounts, backfill_account_type_from_coa,
    borrow_accounts_from_namesake, drop_foreign_gl_codes,
    read_account_decisions, resolve_formula_gl_evidence,
    translate_own_codes_from_coa,
)
from manco_gaps import (
    account_rows, gaps_sentence, gl_activity_totals, gl_names_by_subaccount,
    inference_rows, latest_posted_date, mapping_table,
    mark_widened_totals, native_mapping_coverage, unaccounted_accounts,
    unconfirmed_inferences, unresolved_budget_rows, zero_activity_mapped_rows,
)
from shapes import canonical as canonical_budget
from shapes import totals_tree
from shapes.vocab import SECTION_INCOME, SECTION_OPEX


BUILD_ARGS_FILE = ".build-args.json"


def record_build_args(dashboard_dir, argv):
    """The arguments this build ran with, so the app server can rebuild after a
    change made in the app exactly the way the skill last built."""
    try:
        (Path(dashboard_dir) / BUILD_ARGS_FILE).write_text(json.dumps({"argv": list(argv)}))
    except OSError:
        pass


def rebuild(dashboard_dir, timeout=None):
    """Re-run this build exactly the way it last ran (.build-args.json) → (ok, message).
    The dashboard server calls it after a change made in the app, and the pull from chat
    after loading shared reports."""
    try:
        argv = json.loads((Path(dashboard_dir) / BUILD_ARGS_FILE).read_text())["argv"]
    except (OSError, ValueError, KeyError):
        return False, "relaunch this dashboard from Claude once so it can rebuild after a change"
    script = Path(__file__).resolve()
    try:
        done = subprocess.run([sys.executable, str(script)] + [str(a) for a in argv],
                              cwd=str(script.parent), capture_output=True, text=True, timeout=timeout)
    except (OSError, subprocess.TimeoutExpired) as e:
        return False, "the rebuild didn't finish: %s" % e
    if done.returncode != 0:
        tail = (done.stderr or "").strip().splitlines()[-1:] or ["unknown error"]
        return False, "the rebuild failed: %s" % tail[0][:300]
    return True, "rebuilt"


def build_argv(args):
    """The canonical CLI argv for this build, derived from parsed `args`.
    Any call site (a test, an in-process rebuild) may have a different
    sys.argv, so argv must come from the args object, not the process state."""
    argv = [
        "--firm-name", str(args.firm_name),
        "--firm-uuid", str(args.firm_uuid),
        "--firm-carta-id", str(args.firm_carta_id),
        "--manco-name", str(args.manco_name),
        "--manco-uuid", str(args.manco_uuid),
        "--manco-carta-id", str(args.manco_carta_id),
        "--raw-dir", str(args.raw_dir),
        "--dashboard-dir", str(args.dashboard_dir),
        "--as-of", str(args.as_of),
    ]
    if getattr(args, "manco_entity_id", None) is not None:
        argv += ["--manco-entity-id", str(args.manco_entity_id)]
    if getattr(args, "as_of_year", None) is not None:
        argv += ["--as-of-year", str(args.as_of_year)]
    if getattr(args, "carta_environment", None):
        argv += ["--carta-environment", str(args.carta_environment)]
    if getattr(args, "no_sync_sweep", False):
        # Carried into the replay so a rebuild() (serve.py's own, or Step 5.4's
        # post-import one) keeps skipping the sweep too.
        argv += ["--no-sync-sweep"]
    return argv


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


VENDOR_TOP_N = 12


def read_vendor_config(dashboard_dir):
    """Per-firm vendor presentation, written by the skill, never inferred here.

    `mappings` are approved description→vendor decisions keyed by entry id: judging
    that "Software for Daily.co on Ramp" means Daily.co needs a reader, and a
    regex attempting it yields categories and month labels as vendors.

    `aggregate_accounts` are GL codes whose vendors roll up under the account
    name instead of being listed individually — partner compensation, where
    the spend belongs in the total but the names do not belong on a chart.
    Chosen by the operator: no code or flag marks these, only the firm's own
    account naming.
    """
    path = Path(dashboard_dir) / "vendor-config.json"
    if not path.exists():
        return {}, set(), False
    try:
        payload = json.loads(path.read_text())
    except Exception:
        return {}, set(), False
    mappings = {}
    for row in (payload.get("mappings") or []):
        eid, vendor = row.get("entry_id"), (row.get("vendor") or "").strip()
        if eid and vendor:
            mappings[eid] = vendor
    naming = bool(payload.get("name_reimbursement_individuals"))
    aggregate = set()
    for gl in (payload.get("aggregate_accounts") or []):
        try:
            aggregate.add(int(gl))
        except (TypeError, ValueError):
            continue
    return mappings, aggregate, naming


def apply_vendor_inferences(rows, mappings):
    """Put approved vendor decisions on the entries themselves.

    An approved inference is a decision about an entry, so it belongs
    everywhere that entry's vendor appears — the chart, the row breakout,
    the census that decides whether a vendor breakout is worth offering,
    and the drawer's filter. Folding it into one chart and nowhere else
    leaves the same spend named in one view and "Not specified" in the
    next, with nothing on the page to explain the difference.

    Marked, never merged: `vendor_inferred` keeps a judged name separable
    from one the ledger recorded, all the way to the surface that shows it.
    """
    if not mappings:
        return 0
    applied = 0
    for r in rows:
        if (r.get("vendor") or "").strip():
            continue
        name = (mappings.get(r.get("id")) or "").strip()
        if not name:
            continue
        r["vendor"] = name
        r["vendor_inferred"] = True
        applied += 1
    return applied


# Carta's own classification of who a vendor record is. An individual who
# invoices — consulting, professional fees — is booked as a plain Vendor and
# stays named like any supplier; this is the other kind.
REIMBURSEMENT_TYPE = "Reimbursement Individual"
REIMBURSEMENT_LABEL = "Employee reimbursements"


def group_reimbursements(rows, name_individuals=False, entry_ids=None):
    """Collect reimbursed individuals under one name.

    A reimbursement names who was repaid, not who was paid: the hotel, the
    restaurant, the carrier are nowhere in Carta. Listing the person beside
    real suppliers reads as "we spent $2,750 with this employee", which is
    not what happened, and puts staff names on a chart a client may see.

    Grouped, never dropped — the spend is real and belongs in the total.
    The person stays on the entry as `reimbursed_to` so a reader who needs
    to know still can, and a firm that wants them named says so once
    (`name_reimbursement_individuals`) rather than losing the distinction.

    Rewritten on the entry itself, so the chart, the breakout and the
    census all answer the same way.
    """
    if name_individuals:
        return 0
    booked = entry_ids or set()
    grouped = 0
    for r in rows:
        flagged = ((r.get("vendor_type") or "") == REIMBURSEMENT_TYPE
                   or (r.get("gluuid") or "") in booked)
        if not flagged:
            continue
        name = (r.get("vendor") or "").strip()
        if not name or name == REIMBURSEMENT_LABEL:
            continue
        r["reimbursed_to"] = name
        r["vendor"] = REIMBURSEMENT_LABEL
        r["vendor_reimbursement"] = True
        grouped += 1
    return grouped


def build_vendor_spend(rows, inferred=None, aggregate_accounts=None):
    """Expense spend by vendor, biggest first.

    Ledger vendors and approved inferences are kept apart all the way to the
    chart: a bar that blends what Carta recorded with what we guessed, and
    says so nowhere, is a number presented as fact.
    """
    inferred = inferred or {}
    aggregate_accounts = aggregate_accounts or set()
    by_name, unattributed = {}, 0.0
    for r in rows:
        if r.get("kind") != "expense":
            continue
        # Signed, as every other chart sums it. A refund posts negative, and
        # abs() added it to the vendor it came back from.
        amt = float(r.get("amount") or 0)
        if not amt:
            continue
        # An aggregated account reports under its own name, so the spend
        # still counts toward the total without naming who received it.
        if r.get("acct_type") in aggregate_accounts:
            name = (r.get("account") or "").strip() or "Other"
            b = by_name.setdefault(name, {"vendor": name, "amount": 0.0, "count": 0,
                                          "inferred_amount": 0.0, "aggregated": True})
            b["amount"] += amt
            b["count"] += 1
            continue
        name = (r.get("vendor") or "").strip()
        # The mark, not the absence of a name: rows arrive here already
        # carrying their approved inference (see apply_vendor_inferences),
        # and a name alone can no longer tell the two apart.
        source = "inferred" if r.get("vendor_inferred") else "ledger"
        if not name:
            name = inferred.get(r.get("id"), "").strip()
            source = "inferred"
        if not name:
            unattributed += amt
            continue
        b = by_name.setdefault(name, {"vendor": name, "amount": 0.0,
                                      "count": 0, "inferred_amount": 0.0})
        b["amount"] += amt
        b["count"] += 1
        if source == "inferred":
            b["inferred_amount"] += amt

    vendors = sorted(by_name.values(), key=lambda v: -v["amount"])
    total = sum(v["amount"] for v in vendors) + unattributed
    if not total:
        return None
    # A vendor refunded more than it charged has no bar to draw on a spend
    # chart, and ranks last in any case. It stays in the arithmetic below.
    spending = [v for v in vendors if v["amount"] > 0]
    top = spending[:VENDOR_TOP_N]
    rest = spending[VENDOR_TOP_N:] + [v for v in vendors if v["amount"] <= 0]
    return {
        "vendors": [{**v, "amount": round(v["amount"]),
                     "inferred_amount": round(v["inferred_amount"])} for v in top],
        "aggregated_count": sum(1 for v in vendors if v.get("aggregated")),
        # What the chart does not show, so the page can say so rather than
        # implying the top N is the whole of it.
        "other_amount": round(sum(v["amount"] for v in rest)),
        "other_count": len(rest),
        "unattributed_amount": round(unattributed),
        "total_expense": round(total),
        "inferred_total": round(sum(v["inferred_amount"] for v in vendors)),
    }


def variance_payload(raw_budget, parsed):
    """The budget the variance chart should read, given both copies of it.

    Metadata always comes from the file — it states the period, and nothing
    downstream rewrites that. Rows are the question.

    An outline budget states its GL mapping nowhere but the client's own
    answers, which live in budget-mapping.json and are merged into the
    parsed rows upstream. Reading the file threw every one of them away: no
    row could be joined to actuals, so the chart returned nothing and the
    page silently fell back to the GL spend ranking, as though a firm with a
    fully mapped budget had no budget at all.

    A crosstab keeps the file's rows. Theirs carry a column per value and
    take their figure from the firm-total column; the parsed copy is
    flattened one row per value, which would hand every one of them the
    firm-wide actual and read as a dozen identical overruns. Their GL codes
    arrive by the caller's backfill instead.
    """
    rows = (raw_budget or {}).get("rows") or []
    if any(r.get("by_column") is not None for r in rows):
        return raw_budget
    if not (parsed or {}).get("rows"):
        return raw_budget
    return {**raw_budget, "rows": parsed["rows"]}


def _variance_claim_specificity(scopes):
    """Ranks which category wins a shared entry — a vendor/fund scope
    outranks a bare department tag, the bucket it was carved out of."""
    extra = sum(1 for sc in scopes if (sc.get("source") or "reporting_tag") != "reporting_tag")
    has_tag = any((sc.get("source") or "reporting_tag") == "reporting_tag" for sc in scopes)
    return extra * 2 + (1 if has_tag else 0)


def _resolve_variance_claim_conflicts(claims_pool):
    """Stop two categories from both counting the same entry.

    Each category's own scopes narrowed it correctly on its own — a
    department bucket and a vendor carved out of it can both be exactly
    right and still land on the same entry, the way "Other Taxes / Entity
    Fees" (Operations) and "State and Local Taxes" (one vendor) both did
    over gl 7070. Only the more specific category (_variance_claim_specificity,
    tied broken by the bigger budget, then by workbook order) keeps it;
    every other claimant has it subtracted back out of its own total.
    """
    by_entry = {}
    for entry, matched, scopes, order in claims_pool:
        specificity = _variance_claim_specificity(scopes)
        for e in matched:
            by_entry.setdefault(id(e), []).append(
                (entry, float(e.get("amount") or 0), specificity, order))
    # Sum each loser's full lost amount before rounding once, not per entry.
    lost = {}
    for claimants in by_entry.values():
        if len(claimants) < 2:
            continue
        ranked = sorted(claimants, key=lambda c: (-c[2], -abs(c[0]["budget"]), c[3]))
        for entry, amt, _specificity, _order in ranked[1:]:
            lost.setdefault(id(entry), [entry, 0.0])[1] += amt
    for entry, amt in lost.values():
        entry["actual"] = round(entry["actual"] - amt)
        entry["variance"] = round(entry["actual"] - entry["budget"])


def build_variance_categories(budget_payload, accounts, firm_total_key, as_of_month=12,
                              entries=None, value_aliases=None, tag_category=None,
                              dimension=None, coa_types=None):
    """Rank the firm's own budget categories by how far actuals ran from plan.

    Keyed on the WORKBOOK's categories, not Carta's GL account names. The two
    vocabularies barely overlap — a workbook says "Gross Wages and Salaries"
    where Carta says "Salaries and benefits" — so a name-based join returns
    almost nothing. Both sides carry GL codes, so that is what this joins on,
    the same way the Budget-vs-Actuals page already does.

    Expenses only. "Overspend" and "underspend" are expense words, and income
    variance already has two homes: the three-bar chart and the BvA page.

    A category is reportable only when it has both a GL mapping (or actuals
    cannot be found) and a budget (or there is nothing to vary from). The
    counts of what fell out are returned so the UI can say so — a chart
    showing 28 of 54 lines while looking complete is worse than one that
    admits the gap.
    """
    if not budget_payload:
        return None
    rows = budget_payload.get("rows") or []
    if not rows:
        return None

    window = _budget_window(budget_payload, as_of_month)
    if not window:
        return None
    first, last = window

    # long-comment-ok: names the defect this join exists to prevent
    # Scoped actuals, for lines stating which slice of an account they cover.
    # An outline repeats a line once per slice — four "Salaries" rows on one
    # GL, three "Rent - <office>" rows on another — so joining on GL alone
    # hands each of them the firm-wide total and every one reads as an
    # overrun. Narrow by all of a line's scopes, as the BvA page does: a
    # firm cuts spend by a tag, a sub-account or a vendor, often at once.
    aliases = value_aliases or {}
    dimension = dimension or ({"source": "reporting_tag", "category": tag_category}
                              if tag_category else None)
    tag_values_available = has_dimension_values(entries, dimension)

    entries_by_gl = {}
    for e in (entries or []):
        if e.get("kind") != "expense":
            continue
        if not isinstance(e.get("mo"), int):
            continue
        t = e.get("acct_type")
        if t is None:
            continue
        entries_by_gl.setdefault(int(t), []).append(e)

    _available = {}

    def dimension_available(scope):
        """Whether the firm records the dimension this scope cuts by.

        One it has never recorded would narrow every line to nothing, so a
        known-wide figure is the better answer — the same call the tag path
        has always made.
        """
        key = (scope.get("source"), scope.get("category"))
        if key not in _available:
            _available[key] = has_dimension_values(entries, scope)
        return _available[key]

    def scope_values(scope):
        """The Carta values a scope covers.

        Reporting tags carry the workbook-to-Carta aliases: a value the
        client has since confirmed carries Carta's wording finds nothing
        under the workbook's own.
        """
        if (scope.get("source") or "reporting_tag") == "reporting_tag":
            return aliases.get(scope["value"]) or [scope["value"]]
        return [scope["value"]]

    def scoped_total(gls, scopes):
        """Spend on these accounts carrying every one of a line's values.

        Every, not any: "Rent - <office>" under a department heading is that
        department's rent for that office, and either filter on its own
        reports more than the line does.

        Presence is judged over the year and the total over the budget's
        window, so a scope resolving outside the window reports the zero it
        is rather than a firm-wide figure the line never covered.

        Returns the entries actually summed too — two categories can each
        correctly narrow to their own scope and still land on the same
        entry (a department bucket and a vendor carved out of it, over the
        same account), and the conflict pass below needs to know which.
        """
        total, found, matched = 0.0, False, []
        for g in gls:
            for e in entries_by_gl.get(int(g), ()):
                if any(dimension_value_of(e, sc) not in scope_values(sc)
                       for sc in scopes):
                    continue
                found = True
                if first <= e["mo"] <= last:
                    total += float(e.get("amount") or 0)
                    matched.append(e)
        return total, found, matched

    def claimed_total(gls, claims):
        """Spend on these accounts that a line beside this one reports.

        Read off the entries rather than the account rollups, because a
        claim can be any dimension — a tag value, a sub-account, a vendor —
        and only the entry knows which of them it carries.
        """
        if not claims:
            return 0.0
        want = {int(g) for g in gls}
        out = 0.0
        for e in (entries or []):
            if e.get("kind") != "expense" or int(e.get("acct_type") or -1) not in want:
                continue
            mo = e.get("mo")
            if not isinstance(mo, int) or not (first <= mo <= last):
                continue
            if any(dimension_value_of(e, c) == c.get("value") for c in claims):
                out += float(e.get("amount") or 0)
        return out

    actual_by_gl = {}
    for a in accounts:
        if a.get("gl_group") != "expense":
            continue
        t = a.get("type")
        if t is None:
            continue
        # Sum only the months the budget covers. `ytd_total` is the whole
        # year to date and is the wrong number for any budget that does not
        # also run to today.
        monthly = a.get("monthly") or []
        amt = sum(float(monthly[i] or 0) for i in range(first - 1, min(last, len(monthly))))
        actual_by_gl[int(t)] = actual_by_gl.get(int(t), 0.0) + amt

    label_counts = {}
    for r in rows:
        if r.get("row_kind") == "line":
            label_counts[r["label"]] = label_counts.get(r["label"], 0) + 1

    cats, no_gl, no_budget, off_book = [], 0, 0, 0
    # (entry dict, matched entries, scopes, row order) per scoped category —
    # the conflict pass below needs all four.
    claims_pool = []
    for order, r in enumerate(rows):
        if r.get("row_kind") != "line":
            continue
        # Overspend and underspend are expense words, and the workbook says
        # which of its lines are income. A management fee line reached this
        # chart because its account code begins with a 6, sat against a real
        # budget with nothing found for it, and read as 100% underspent.
        if is_income_section(r.get("section")):
            continue
        # The two shapes name their GL field differently: a crosstab carries
        # account_type / account_type_all, an outline carries gl_codes.
        gls = (r.get("account_type_all")
               or r.get("gl_codes")
               or ([r["account_type"]] if r.get("account_type") is not None else []))
        # An account this management company has never posted to is not an
        # account of theirs — a fund-side one, usually. Nothing here can
        # find its spend, so it can only report zero against a real budget.
        # Keyed on every account they have ever had, NOT on the accounts
        # this year's entries mention: a budgeted account nobody has spent
        # from yet is a real hundred-percent underspend and has to stay.
        if coa_types is not None and gls:
            known = [g for g in gls if int(g) in coa_types]
            if not known:
                off_book += 1
                continue
            gls = known
        # Expense side only.
        if not any(str(g)[:1] in ("5", "6", "7") for g in gls):
            if not gls:
                have = (((r.get("by_column") or {}).get(firm_total_key) or {}).get("budget")
                        if r.get("by_column") is not None else r.get("annual"))
                if have:
                    no_gl += 1
            continue
        # Two emitted shapes carry the figure differently: a crosstab hangs
        # it off the firm-total column, an outline states it once per row.
        if r.get("by_column") is not None:
            budget = ((r.get("by_column") or {}).get(firm_total_key) or {}).get("budget")
        else:
            budget = r.get("annual")
        if not budget:
            no_budget += 1
            continue
        # Falls back to firm-wide when the mapping has no Carta tag, or the
        # firm's JEs never carry one — a known-wide number beats a silent 0.
        dept = r.get("tag_value")
        # The alias map keys on the workbook's own wording. A value the
        # client has since confirmed carries Carta's wording instead and
        # finds nothing there, so it has to stand for itself — three of one
        # firm's four department rows were reading the firm-wide total under
        # a department's name, each one a several-hundred-percent overrun
        # that was really everybody's spend.
        tags = (aliases.get(dept) or [dept]) if dept else None
        # A crosstab states its value as tag_value and carries no scopes of
        # its own, so the configured dimension supplies the one it means.
        scopes = [sc for sc in (r.get("scopes") or []) if dimension_available(sc)]
        if not scopes and dept and dimension and tag_values_available:
            scopes = [{**dimension, "value": dept}]
        actual, narrowed, matched = None, False, None
        if scopes:
            scoped, found, matched = scoped_total(gls, scopes)
            if found:
                actual, narrowed = scoped, True
        claims = r.get("excluded_claims") or []
        if actual is None:
            # Nothing posts under that value. A known-wide number beats a
            # silent 0, which is the same choice this made before.
            actual = sum(actual_by_gl.get(int(g), 0.0) for g in gls)
            # Minus what the line beside it reports. Both lines cover the
            # same accounts, and without this the same money appeared in two
            # bars of the same chart — once under the line that excludes it
            # and again under the line that owns it.
            actual -= claimed_total(gls, claims)
        # The tag half travels as carta_tags, which predates the others.
        narrow_tags = list(tags) if (narrowed and tags) else None
        narrow_scopes = ([sc for sc in scopes
                          if (sc.get("source") or "reporting_tag") != "reporting_tag"]
                         or None) if narrowed else None
        entry = {
            # A label repeated across tag_values is ambiguous on its own —
            # four rows reading "Salaries" tell the reader nothing about
            # which team overspent.
            "name":     f"{r['label']} — {dept}" if dept and label_counts.get(r["label"], 0) > 1
                        else r["label"],
            "gl_codes": [int(g) for g in gls],
            "budget":   round(float(budget)),
            "actual":   round(actual),
            "variance": round(actual - float(budget)),
            # What narrowed this figure, so the drawer narrows the same way.
            "carta_tags":      narrow_tags,
            "scopes":          narrow_scopes,
            "excluded_claims": (claims or None) if not narrowed else None,
        }
        monthly = r.get("monthly") or []
        if any(monthly):
            if budget_payload.get("period_granularity") == "monthly":
                # Real monthly figures the workbook stated directly.
                entry["monthly_budget"] = [round(v) for v in monthly]
            else:
                # The adapter spread each quarter evenly across its months, so
                # re-collapse to quarters rather than passing that spread on
                # as if it were monthly detail the workbook stated.
                entry["quarterly_budget"] = [
                    round(sum(monthly[i * 3:(i + 1) * 3])) for i in range(4)
                ]
        cats.append(entry)
        if narrowed and matched:
            claims_pool.append((entry, matched, scopes, order))

    _resolve_variance_claim_conflicts(claims_pool)

    if not cats:
        return None
    # Biggest dollar miss first. A $400K salary overrun matters more than a
    # 300% overrun on a $2K line, and dollars are what a controller triages.
    cats.sort(key=lambda c: -abs(c["variance"]))

    # How finely this budget states time, so the UI charts it at the
    # workbook's own resolution. A crosstab has no time axis at all.
    period = "none"
    if budget_payload.get("period_kind") == "annual" and any(
            any(r.get("monthly") or []) for r in rows):
        period = ("monthly" if budget_payload.get("period_granularity") == "monthly"
                   else "quarterly")
    return {
        "categories": cats,
        "period": {
            "first_month": first,
            "last_month":  last,
            "label": (f"{_MONTH_ABBR[first - 1]}\u2013{_MONTH_ABBR[last - 1]} "
                      f"{budget_payload.get('period_year') or ''}").strip(),
        },
        "excluded":   {"no_gl_mapping": no_gl, "no_budget": no_budget,
                       "off_book": off_book},
        "source":     budget_payload.get("source"),
        "budget_label": budget_payload.get("label"),
        "budget_period": period,
        "tag_values_available": tag_values_available,
    }


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


# --- Assemble --------------------------------------------------------------

def _spawn_sync_sweep(dashboard_dir):
    """Best-effort, fire-and-forget: push any new or changed own-sync reports to
    Carta after this build, without this process waiting on it. own_sync.main()
    never fails the build — no known user id yet, no usable Claude CLI, no
    Carta connector that CLI can reach, or nothing changed all exit 0. Why is
    written to <dashboard_dir>/own_sync.log, and to own_sync_status.json under
    own_sync._record_blocked's rule, diagnostic only. A report that fails to push is
    skipped and noted in <dashboard_dir>/own_sync.log rather than raised, so a
    maintainer can see why one report never shows up on the hosted microapp
    without that detail vanishing into a detached process nobody reads. This
    truncates the log on every build, not just the first one to spawn a sweep
    for a dashboard — a build that finishes while an earlier sweep is still
    running erases that sweep's own record.

    Must be a genuinely detached OS process, not a thread: rebuild() re-invokes
    this very script via subprocess.run(..., capture_output=True), which blocks
    until every fd it handed the child is closed. A thread would die with (or
    block the exit of) this process, and an inherited stdout/stderr pipe would
    keep that subprocess.run() call waiting on the sweep's own exit instead of
    this build's.
    """
    script = Path(__file__).resolve().parent / "own_sync.py"
    log_path = manco_paths.own_sync_log_file(dashboard_dir)
    try:
        log = open(log_path, "w")
    except OSError:
        return  # best-effort — a build must never fail because the sweep's log couldn't open
    try:
        subprocess.Popen(
            [sys.executable, str(script), "--data-dir", str(dashboard_dir)],
            cwd=str(script.parent),
            stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=log,
            start_new_session=True,
        )
    except OSError:
        pass  # best-effort — a build must never fail because the sweep couldn't launch
    finally:
        log.close()  # the child's own dup'd fd keeps writing after this one closes


def build(args):
    raw       = Path(args.raw_dir)
    dashboard = Path(args.dashboard_dir)
    dashboard.mkdir(parents=True, exist_ok=True)
    record_build_args(dashboard, build_argv(args))
    # Before the post-build own-sync sweep reads it. Never in build_argv: a rebuild must not
    # put back whoever ran the last build over the operator a later launch recorded.
    manco_paths.write_user_id(dashboard, getattr(args, "user_id", None))

    check_fetch_completeness(raw)
    expense_rows = read_expense_pages(raw)
    income_rows  = read_income(raw)
    if not (expense_rows or income_rows):
        raise SystemExit(f"No JE rows parsed from {raw}. Check the raw dumps.")

    # Nothing after the date the report states it is as of. The raw dumps are
    # fetched to a month boundary and normally stop there on their own, so
    # this changes nothing on a healthy run — but a build handed an earlier
    # --as-of than the data was summing spend the header said the report did
    # not cover, and every figure on the page disagreed with the line above
    # it while looking entirely reasonable. Clipped at the source, before
    # anything is counted, so the KPIs, the cashflow, the spend ranking and
    # the budget windows all read the same ledger.
    def _on_or_before(rows):
        return [r for r in rows if (r.get("date") or "") <= args.as_of]

    _before = len(expense_rows) + len(income_rows)
    expense_rows, income_rows = _on_or_before(expense_rows), _on_or_before(income_rows)
    all_rows = expense_rows + income_rows
    if len(all_rows) != _before:
        print(f"note: {_before - len(all_rows)} journal line(s) dated after "
              f"{args.as_of} left out; the report is as of that date.",
              file=sys.stderr)
    if not all_rows:
        raise SystemExit(f"No JE rows on or before {args.as_of}. "
                         f"Check --as-of against the raw dumps.")

    # Determine month coverage. Default to Jan..Jul (the 7-month
    # window). If later data appears, extend labels dynamically.
    max_mo = max(r["mo"] for r in all_rows)
    month_labels = _MONTH_ABBR[:max_mo]
    months = max_mo

    # --- per-account rollup -----
    per_acct = defaultdict(lambda: {"monthly": [0.0] * months, "total": 0.0,
                                    "count": 0, "type": None, "gl_group": None})
    for r in all_rows:
        a = per_acct[r["account"]]
        a["monthly"][r["mo"] - 1] += r["amount"]
        a["total"] += r["amount"]
        a["count"] += 1
        a["type"] = r["acct_type"]
        a["gl_group"] = r["kind"]

    accounts = [{
        "name": name, "type": a["type"], "gl_group": a["gl_group"],
        "ytd_total":  round(a["total"], 2),
        "monthly":    [round(v, 2) for v in a["monthly"]],
        "entry_count": a["count"],
        "top_vendors": [], "top_tags": [], "top_partners": [],
    } for name, a in per_acct.items()]
    # Expenses first, then income; within each group biggest-first.
    accounts.sort(key=lambda a: (a["gl_group"] != "expense", -a["ytd_total"]))

    # --- Top-8 expense categories + Other -----
    expense_accounts = [a for a in accounts if a["gl_group"] == "expense"]
    top8 = expense_accounts[:8]
    categories = [
        {"name": a["name"], "data": a["monthly"]}
        for a in top8
    ]
    other_monthly = [0.0] * months
    for a in expense_accounts[8:]:
        for i, v in enumerate(a["monthly"]):
            other_monthly[i] += v
    if any(other_monthly):
        categories.append({"name": "Other", "data": [round(v, 2) for v in other_monthly]})
    monthly_categories = {"labels": month_labels, "categories": categories}

    # --- Monthly cashflow -----
    m_income  = [0.0] * months
    m_expense = [0.0] * months
    for r in income_rows:  m_income[r["mo"] - 1]  += r["amount"]
    for r in expense_rows: m_expense[r["mo"] - 1] += r["amount"]
    monthly_cashflow = {
        "labels":   month_labels,
        "income":   [round(v, 2) for v in m_income],
        "expenses": [round(v, 2) for v in m_expense],
    }

    # --- Fund-fee entries + feeSchedule chart -----
    #
    # Firm-agnostic: no hardcoded fund list. Group fund-side management-fee
    # JEs by FUND_UUID, top N by YTD fee volume, tail into "Other funds".
    fund_fee_rows = read_fund_fees(raw)
    fund_fee_entries = []
    fund_totals = defaultdict(float)      # fund_uuid → YTD (current year) fee $
    fund_name_by_uuid = {}
    for r in fund_fee_rows:
        yr = int(r["yr"])
        amt = float(r["amt"])
        uuid = r["fund_uuid"]
        name = r["fund"]
        fund_name_by_uuid[uuid] = name
        # Every year, not just this one: a fund that has finished billing
        # still owns its share of the years it did bill.
        fund_totals[uuid] += amt

    # A fund the ManCo bills need not appear on the fund side at all.
    # Rank it on what the ManCo booked against it, so it is not missed.
    roster = read_entity_roster(raw)
    manco_fee_rows = read_manco_fee_income(raw)
    # Every fund the roster knows, as a memo might write it.
    _memo_candidates = [(v["uuid"], v["name"]) for v in roster.values()
                        if v.get("uuid") and v.get("name")]
    roster_name_by_uuid = dict(_memo_candidates)
    # An operator's answer for a line the memo ties or can't name at all.
    _fund_overrides = read_fund_attribution(dashboard)

    def _keyed_fund(row):
        """The fund a ManCo fee line names outright, through its key."""
        try:
            ent = roster.get(int(row.get("related_entity_id") or 0)) or {}
        except (TypeError, ValueError):
            ent = {}
        return ent.get("uuid")

    def _named_fund(row):
        """The fund a line names by key or in words, before any account."""
        return _keyed_fund(row) or (
            resolve_fund_attribution(row, _memo_candidates, _fund_overrides)
            or (None,))[0]

    # Learned from the lines that name a fund, then read back onto those that
    # do not: a fee wired from a fund's own account was that fund's fee.
    _bank_accounts = learn_bank_accounts(manco_fee_rows, _named_fund)

    def _manco_fund(row):
        """The fund a ManCo fee line bills: its key, else memo, else account."""
        uuid = _keyed_fund(row)
        if uuid:
            return uuid, roster_name_by_uuid.get(uuid), False
        hit = resolve_fund_attribution(row, _memo_candidates, _fund_overrides)
        if hit:
            return hit[0], hit[1], True
        for acct in memo_bank_accounts(row.get("descr")):
            uuid = _bank_accounts.get(acct)
            if uuid:
                return uuid, roster_name_by_uuid.get(uuid), True
        return None, None, False

    for r in manco_fee_rows:
        uid, nm, _ = _manco_fund(r)
        try:
            amt = float(r["amt"])
        except (TypeError, ValueError):
            continue
        if not uid:
            continue
        fund_name_by_uuid.setdefault(uid, nm or uid)
        fund_totals[uid] += amt

    _carta_id_by_uuid = {v["uuid"]: v.get("carta_id")
                         for v in roster.values() if v.get("uuid")}

    TOP_N_FUNDS = 8
    top_fund_uuids = [u for u, _ in sorted(fund_totals.items(), key=lambda kv: -kv[1])[:TOP_N_FUNDS]]
    display_name_by_uuid = {u: fund_name_by_uuid.get(u, u) for u in top_fund_uuids}

    def display_fund(row):
        return display_name_by_uuid.get(row["fund_uuid"], "Other funds")

    for r in fund_fee_rows:
        fund_fee_entries.append({
            "id":            r["id"],
            "gluuid":        r["gluuid"],
            # The real, never-bucketed fund name — see backfill_fund_match_from_roster.
            "fund":          r["fund"],
            "fund_uuid":     r["fund_uuid"],
            "date":          r["date"],
            "yr":            int(r["yr"]),
            "mo":            int(r["mo"]),
            "account":       r["account"],
            "acct_type":     int(r["acct_type"]),
            "sub":           r.get("sub") or None,
            "amount":        float(r["amt"]),
            "description":   r.get("descr", ""),
            "vendor":        r.get("vendor") or None,
            "partner":       r.get("partner") or None,
            "event_type":    r.get("event_type") or None,
            # Same structured {category, value} shape Query A/B entries carry
            # (via _parse_tags), so the frontend's normalizeTags() doesn't have
            # to special-case fund-fee rows to a flat-string fallback.
            "tags":          _parse_tags(r),
            "display_fund":  display_fund(r),
            # The entity this journal is booked on — never another one.
            "entity_carta_id": _carta_id_by_uuid.get(r["fund_uuid"]),
        })

    # --- Fee schedule terms (contracted rate/basis/frequency, not actuals) -----
    fee_schedule_terms = read_fee_schedule_terms(raw)

    # --- ManCo-side fee income: the anchor for the fee chart -----
    # Only this side is on the trial balance the dashboard reports. Each
    # line names the fund it bills through RELATED_ENTITY_ID.
    manco_fee_entries = []
    for r in manco_fee_rows:
        _uid, _nm, _inferred = _manco_fund(r)
        ent = {"uuid": _uid, "name": _nm} if _uid else {}
        uuid = _uid or ""
        manco_fee_entries.append({
            "id":            r["id"],
            "gluuid":        r["gluuid"],
            "fund":          ent.get("name") or "",
            "fund_uuid":     uuid,
            "date":          r["date"],
            "yr":            int(r["yr"]),
            "mo":            int(r["mo"]),
            "account":       r["account"],
            "acct_type":     int(r["acct_type"]),
            "sub":           None,
            "amount":        float(r["amt"]),
            "description":   r.get("descr", ""),
            "vendor":        None,
            "partner":       None,
            "event_type":    r.get("event_type") or None,
            "tags":          [],
            "display_fund":  display_name_by_uuid.get(uuid, "Other funds")
                             if uuid else "Unattributed",
            # The line named no fund of its own; this one was read off its
            # description. Carried so the reader is told, never silently.
            "fund_inferred": _inferred,
            # Booked on the ManCo, whichever fund it bills.
            "entity_carta_id": args.manco_carta_id,
        })

    # A raw dir fetched before the ManCo query existed has no such file.
    # Fall back to the fund side rather than report a wholly estimated year.
    manco_anchored = bool(manco_fee_entries)
    series_entries = manco_fee_entries if manco_anchored else fund_fee_entries

    # Which fee accounts are the ManCo's own, and which sit on a fund's
    # ledger. A budget row of this report may only name the first kind.
    manco_fee_accounts = {e["acct_type"] for e in manco_fee_entries
                          if e.get("acct_type") is not None}
    foreign_fee_accounts = {e["acct_type"] for e in fund_fee_entries
                            if e.get("acct_type") is not None} - manco_fee_accounts

    # An offset nets negative. Without one of its own the ManCo records
    # it inside fee income, where the fee line already reports it.
    def _nets_negative(entries, acct):
        return sum(e["amount"] for e in entries
                   if e.get("acct_type") == acct) < 0
    _manco_has_contra = any(_nets_negative(manco_fee_entries, a)
                            for a in manco_fee_accounts)
    unmatched_foreign = set() if _manco_has_contra else {
        a for a in foreign_fee_accounts if _nets_negative(fund_fee_entries, a)
    }

    ytd_year = args.as_of_year
    years = sorted({e["yr"] for e in fund_fee_entries}
                   | {e["yr"] for e in series_entries})
    fee_labels = [str(y) if y != ytd_year else f"{y} YTD" for y in years]

    if manco_anchored:
        by_fund_year, booked_quarters, unattributed, alloc_detail, conversions = \
            _allocate_manco_fees(
                manco_fee_entries, fee_schedule_terms, top_fund_uuids,
                ytd_year, fund_fee_entries, years,
            )
        schedule_basis = {}
        for (uid, yr), quarters in alloc_detail.items():
            name = display_name_by_uuid.get(uid)
            if name:
                schedule_basis.setdefault(name, {})[str(yr)] = quarters
        per_year_by_name = {}
        for (uid, yr), amt in by_fund_year.items():
            name = display_name_by_uuid.get(uid, "Other funds")
            per_year_by_name.setdefault(name, {})[yr] = \
                per_year_by_name.setdefault(name, {}).get(yr, 0.0) + amt
        if any(unattributed.values()):
            per_year_by_name["Unattributed"] = unattributed
    else:
        booked_quarters = {
            (e["fund_uuid"], e["yr"], (e["mo"] - 1) // 3 + 1)
            for e in series_entries if e["fund_uuid"] and e["amount"] > 0
        }
        schedule_basis = {}
        per_year_by_name = {}
        for e in series_entries:
            per_year_by_name.setdefault(e["display_fund"], {}).setdefault(e["yr"], 0.0)
            per_year_by_name[e["display_fund"]][e["yr"]] += e["amount"]

    fee_funds = []
    displayed = ([display_name_by_uuid[u] for u in top_fund_uuids]
                 + ["Other funds", "Unattributed"])
    for fund_name in displayed:
        per_year = per_year_by_name.get(fund_name) or {}
        data = [round(per_year.get(y, 0.0), 2) for y in years]
        if not any(data):
            continue
        fee_funds.append({"name": fund_name, "data": data})
    fee_schedule = {"labels": fee_labels, "funds": fee_funds}
    if schedule_basis:
        fee_schedule["scheduleBasis"] = schedule_basis

    # --- Fee projections (future years from schedule × inferred committed capital) -----
    proj_labels, proj_funds = _build_fee_projections(
        fund_fee_entries, fee_schedule_terms, top_fund_uuids,
        display_name_by_uuid, ytd_year, args.as_of,
    )
    if proj_labels:
        fee_schedule["projectedLabels"] = proj_labels
        fee_schedule["projectedFunds"] = proj_funds

    # What the schedule still expects in the YTD year itself.
    expected = _expected_remaining_this_year(
        fund_fee_entries, fee_schedule_terms, top_fund_uuids,
        display_name_by_uuid, ytd_year,
        # A quarter counts as billed when the ManCo booked it, which is
        # what the chart reports.
        booked_quarters=booked_quarters,
    )
    if expected:
        fee_schedule["expectedRemaining"] = expected

    # --- Budget + spend-by-GL -----
    #
    # The "YTD Top Categories of Spend" chart advertises "Top 10 expense
    # accounts" in Overview.jsx's section subtitle. The chart component itself
    # doesn't cap client-side, so cap here — expense_accounts is already
    # sorted biggest-first. Firms with dozens of expense accounts
    # Ventures with ~40) would otherwise render every account in the "top"
    # chart, contradicting the title.
    SPEND_BY_GL_TOP_N = 10
    # The latest entry date in the ledger — a ManCo's own books can stop
    # posting before the fetch date, and every `as_of_month` use below is the
    # budget's own YTD/variance window, never the actuals themselves, so
    # clamping it here is the one place that fixes every one of them.
    last_posted_date = latest_posted_date(all_rows, args.as_of)
    as_of_month = int(args.as_of.split("-")[1])
    if max_mo < as_of_month:
        print(f"note: books post only through {last_posted_date}; the budget "
              f"window stops there, not the {args.as_of} fetch date.",
              file=sys.stderr)
        as_of_month = max_mo
    # Excel-first, multi-budget: parse every budget-*.json file in the
    # dashboard dir. When one or more exist, the FIRST becomes the
    # "primary" that drives dashboard-side charts (spend_by_gl,
    # income/expenses/net scalars); ALL of them are emitted into
    # snapshot.budgets for the BvA page's sub-nav switcher. When none
    # exist, fall back to Carta's fa:list:budgets payload.
    # Every budget reaches the build as a report (report_store.py): a workbook
    # budget, read from its file on every build, a duplicate holding its own
    # copy, or a report someone else shared. excel_files stays aligned with
    # excel_budgets — the variance pass below re-reads each file beside its
    # parsed budget.
    _reports = report_store.ReportStore(dashboard)
    excel_files, excel_budgets = [], []
    for _f, _meta in _reports.build_inputs(find_excel_budget_files(dashboard)):
        _parsed = read_excel_budget(dashboard, as_of_month, budget_file=_f)
        if _parsed is None:
            continue
        _parsed["report"] = _meta
        _parsed["read_only"] = _meta["read_only"]
        excel_files.append(_f)
        excel_budgets.append(_parsed)
    # A report shared with you arrives with its GL codes already resolved; the
    # local mapping file answers questions about your own budgets, not theirs.
    _own_budgets = [_b for _b in excel_budgets if not _b.get("read_only")]
    for _b in excel_budgets:
        if _b.get("read_only"):
            assign_row_addresses(_b.get("rows") or [], budget_id=_b.get("id"))
    # Recorded decisions first: a client's explicit answer outranks any
    # automatic match, and backfill_fund_match_from_roster skips a row that
    # already has one.
    _ambiguous_bare_addrs = ambiguous_bare_addrs(_own_budgets)

    _row_mapping = read_budget_mapping(dashboard)
    _fee_offset_asks = []
    for _b in _own_budgets:
        _b["rows"] = apply_budget_mapping(_b.get("rows") or [], _row_mapping,
                                          budget_id=_b.get("id"),
                                          ambiguous_bare_addrs=_ambiguous_bare_addrs)
        _rehomed = rehome_fee_rows_to_manco(_b.get("rows") or [],
                                            manco_fee_accounts, foreign_fee_accounts,
                                            unmatched_foreign)
        for _note in _rehomed:
            print(f"note: {_note}")
        _fee_offset_asks.extend(
            {**entry, "budget_id": _b.get("id"), "budget_label": _b.get("label")}
            for entry in fee_offset_asks(_b.get("rows") or [], manco_fee_accounts)
        )

    # A line's own GL number is only Carta's when Carta agrees it is.
    # Seed from every account the ManCo has ever used, then let the window's
    # own entries win on wording — an account renamed since is known here by
    # the name it carries today.
    # Kept separately from the map below, which is augmented with this
    # year's entries for wording. Membership of THIS set is the only honest
    # answer to "does this entity have that account" — the augmented one
    # would say no to every account they simply have not spent from yet.
    _coa_all = read_all_accounts(raw)
    _carta_account_names = dict(_coa_all)
    for e in all_rows:
        t, n = e.get("acct_type"), e.get("account")
        if t is not None and n:
            _carta_account_names[t] = n
    _activity_by_gl = gl_activity_totals(all_rows)
    _subaccount_gls = gl_names_by_subaccount(all_rows)
    # The widest window among the budgets' own windows: an entry any budget
    # could report is not unreported. `None` when no budget states a whole
    # period, which reads every entry.
    _wins = [w for w in (_budget_window(_b, max_mo) for _b in excel_budgets) if w]
    _window = ((min(w[0] for w in _wins), max(w[1] for w in _wins))
               if _wins else None)
    _aliases, _coa_records = {}, []
    _coa_alias_path = Path(dashboard) / "coa-mapping.json"
    if _coa_alias_path.exists():
        try:
            _coa_payload = json.loads(_coa_alias_path.read_text())
            _aliases = _coa_payload.get("value_aliases") or {}
            _coa_records = _coa_payload.get("records") or []
        except Exception:
            _aliases, _coa_records = {}, []

    # Outline budgets only — see backfill_fund_match_from_roster's docstring.
    fund_names = list(fund_name_by_uuid.values())
    if fund_names:
        n_fund_matched = sum(
            backfill_fund_match_from_roster(b.get("rows") or [], fund_names)
            for b in excel_budgets if "by-line-item" in (b.get("view_kinds") or [])
        )
        if n_fund_matched:
            print(f"note: matched {n_fund_matched} outline income line(s) to a real "
                  f"fund by name.", file=sys.stderr)

    # A custom report is a cut of another budget, never the one the dashboard leads with:
    # a firm whose only budget is Carta's keeps it as primary beside its custom reports.
    _leading = [_b for _b in excel_budgets if report_store.custom_gl_codes(_b) is None]
    if _leading:
        budgets = _leading[0]  # primary drives the top-line KPIs
    elif carta_budget_opted_in(dashboard):
        budgets = read_budgets(raw, args.as_of_year, as_of_month)
    else:
        # "Skip for now" means actuals-only — a budget explicitly declined,
        # not a Carta fallback.
        budgets = empty_budgets()

    # When no workbook budget leads, Carta's own budget does, listed first and the variance
    # default, with any custom reports made from it after it. It is also recorded under its
    # own snapshot key, so a custom report can still be made from it.
    carta_entry = None
    if not _leading and (budgets.get("rows") or []):
        carta_entry = {
            **budgets,
            "id":         report_store.CARTA_BUDGET_ID,
            "label":      "Carta budget",
            "view_kinds": ["by-account"],
            # The app dates its period columns from this.
            "period_year": args.as_of_year,
            "period": {
                "first_month": 1,
                "last_month":  as_of_month,
                "label": f"Jan\u2013{_MONTH_ABBR[as_of_month - 1]} {args.as_of_year}",
            },
        }
    total_income   = sum(m_income)
    total_expense  = sum(m_expense)
    spend_by_gl = [{"name": a["name"],
                    "actual": round(a["ytd_total"]),
                    "budget": round(budgets["per_account"].get(a["name"], 0.0))}
                   for a in expense_accounts[:SPEND_BY_GL_TOP_N]]

    # Budget categories ranked by variance — replaces the GL-keyed spend chart
    # on the dashboard when a workbook is in play. Firms without one keep
    # spend_by_gl, which is still a useful ranking on its own.
    # One variance set per ingested budget, not just the first. Which budget
    # the dashboard used to be a silent consequence of which tab happened to
    # be selected first at ingest — and the choice matters, because a
    # quarterly budget can be charted over time and a YTD snapshot cannot.
    # Which reporting-tag category the budget's columns are scoped by —
    # the firm's own choice, recorded at ingest. None means it is still
    # unresolved, and scoped rows report firm-wide rather than inventing
    # a dimension.
    _configured_dimension = None
    _coa_top = Path(dashboard) / "coa-mapping.json"
    if _coa_top.exists():
        try:
            _coa_json = json.loads(_coa_top.read_text())
            _configured_dimension = _coa_json.get("dimension")
            if not _configured_dimension and _coa_json.get("tag_category"):
                # Recorded before a dimension could be anything but a tag.
                _configured_dimension = {"source": "reporting_tag",
                                         "category": _coa_json["tag_category"]}
        except Exception:
            pass
    # Approved vendor decisions go on the entries before anything reads them
    # — the census below included, since whether a vendor breakout is worth
    # offering depends on how much spend actually carries a vendor.
    _vendor_map, _vendor_agg, _name_individuals = read_vendor_config(dashboard)
    _inferred_n = apply_vendor_inferences(all_rows, _vendor_map)
    if _inferred_n:
        print(f"note: applied {_inferred_n} approved vendor inference(s) "
              f"from vendor-config.json.", file=sys.stderr)
    _reimb_n = group_reimbursements(all_rows, _name_individuals,
                                    read_reimbursement_entries(raw))
    if _reimb_n:
        print(f"note: grouped {_reimb_n} reimbursement line(s) under "
              f"\"{REIMBURSEMENT_LABEL}\".", file=sys.stderr)

    _census = dimension_census(all_rows)
    # The workbook's own column headings are evidence about which category
    # it breaks out by — stronger than counting how many the firm keeps.
    _column_labels = column_headings(excel_budgets)
    dimension = resolve_dimension(_configured_dimension, _census, _column_labels)
    if dimension and not _configured_dimension and _column_labels:
        print(f"note: matched the budget's columns to the "
              f"{dimension.get('category') or dimension.get('source')} "
              f"values on this firm's entries.", file=sys.stderr)
    tag_category = (dimension or {}).get("category")

    for _b in excel_budgets:
        _n_own_code = translate_own_codes_from_coa(_b.get("rows") or [], _coa_records)
        if _n_own_code:
            print(f"note: translated {_n_own_code} budget line(s) from the "
                  f"firm's own chart-of-accounts code to Carta's GL, per "
                  f"coa-mapping.json.", file=sys.stderr)
        drop_foreign_gl_codes(_b.get("rows") or [], _carta_account_names)

    # A section given to a dimension value reports that spend; the untagged
    # lines over the same accounts report the rest. Without this, both do.
    _claim_census = dimension_census(all_rows, sources=CLAIMABLE_SOURCES,
                                     values_limit=None)
    # long-comment-ok: states which scope a claim may and may not displace
    # Per budget, never pooled. Two budgets are two readings of one firm's
    # spend -- a line-item plan beside an opex-by-bucket one -- and each has
    # to report every account in full. Pooled, a bucket line's claim was
    # subtracted from the other budget's line over the same account, where
    # nothing reported it and the money left the page.
    _claims_by_budget = {id(_b): [] for _b in excel_budgets}
    _inference_decisions = read_inference_decisions(dashboard)
    for _b in excel_budgets:
        _own = _claims_by_budget[id(_b)]
        for c in claim_dimension_values(_b.get("rows") or [], _claim_census,
                                        _aliases, _carta_account_names,
                                        _inference_decisions):
            if c not in _own:
                _own.append(c)
    _linked = 0
    for _b in excel_budgets:
        _linked += autolink_exact_accounts(_b.get("rows") or [],
                                           _carta_account_names)
        # A budget keyed by account NAME arrives with no account_type, and
        # the by-account view splits income from expenses on that number's
        # leading digit. Left unset, a firm's fee income filed itself under
        # operating expenses.
        for _r in _b.get("rows") or []:
            if _r.get("account_type") is None and len(_r.get("gl_codes") or []) == 1:
                _r["account_type"] = _r["gl_codes"][0]
    if _linked:
        print(f"note: {_linked} line(s) name exactly one Carta account.",
              file=sys.stderr)
    _borrowed = 0
    for _b in excel_budgets:
        _borrowed += borrow_accounts_from_namesake(_b.get("rows") or [])
    if _borrowed:
        print(f"note: {_borrowed} scoped line(s) took their accounts from an "
              f"identically-named line.", file=sys.stderr)

    # Lines that name a value the matcher couldn't reach. After the linking
    # passes, so a line only counts as scope-unresolved once it actually has
    # accounts it would otherwise report firm-wide from.
    _scope_applied = _scope_flagged = 0
    for _b in excel_budgets:
        _near, _a, _f = resolve_near_scopes(_b.get("rows") or [], _claim_census,
                                            _carta_account_names, _inference_decisions,
                                            all_rows)
        _scope_applied += _a
        _scope_flagged += _f
        _own = _claims_by_budget[id(_b)]
        for c in _near:
            if c not in _own:
                _own.append(c)
    if _scope_applied:
        print(f"note: {_scope_applied} line(s) matched a value by name "
              f"(a shortened spelling of it).", file=sys.stderr)
    if _scope_flagged:
        print(f"note: {_scope_flagged} line(s) name a value that could not be "
              f"matched; their actuals are withheld pending an answer.",
              file=sys.stderr)

    # After every other resolution pass, so a bucket line's formula reads
    # its referenced rows' most complete GL identity, not their parse-time one.
    # _own_budgets only: a shared-in row's formula referred to its creator's
    # own workbook, which this recipient's dashboard_dir doesn't carry.
    resolve_formula_gl_evidence(
        _own_budgets, known_gl_codes=_carta_account_names.keys(),
        account_names=_carta_account_names, dashboard_dir=dashboard)

    # A crosstab row's mapped/resolved gl_codes only reaches the UI through
    # by_tag_value's account_type maps, which were built once at parse time —
    # before any of the passes above ran. Write the settled identity back.
    for _b in excel_budgets:
        sync_crosstab_account_types(_b)

    # Asked only about what nothing above could resolve — a gate that
    # repeats a question already answered teaches the operator to skim it.
    _unresolved = list(_fee_offset_asks)
    _widened = 0
    for _b in excel_budgets:
        _widened += mark_widened_totals(_b.get("rows") or [])
    # budget_id/budget_label: two budgets' rows can share a bare address
    # ("r17") and even a label, so an entry can't say which budget it's
    # from without this — see assign_row_addresses.
    for _b in _own_budgets:
        _unresolved.extend(
            {**entry, "budget_id": _b.get("id"), "budget_label": _b.get("label")}
            for entry in unresolved_budget_rows(
                _b.get("rows") or [], _coa_records, _carta_account_names, fund_names,
                activity_by_gl=_activity_by_gl, subaccount_gls=_subaccount_gls)
        )
    # Accounts each fund's own fee entries post to, so a fund named twice
    # can be told apart by which of them each line means.
    _fund_accounts = {}
    for e in fund_fee_entries:
        f, t, n = e.get("fund"), e.get("acct_type"), e.get("account")
        if f and t is not None and n:
            _fund_accounts.setdefault(f, {}).setdefault(t, n)
    for _b in _own_budgets:
        _unresolved.extend(
            {**entry, "budget_id": _b.get("id"), "budget_label": _b.get("label")}
            for entry in funds_reported_twice(_b.get("rows") or [], _fund_accounts)
        )
    # The opposite gap, from the mapping's own side: a line that resolved
    # to an account nothing posted to in this window reads as a correct $0
    # variance with nothing to flag it. Computed here, before the mapping
    # table below, so it merges into that table by addr like any other ask.
    _activity_by_gl_windowed = gl_activity_totals(all_rows, window=_window)
    _zero_activity = []
    for _b in _own_budgets:
        _zero_activity.extend(
            {**entry, "budget_id": _b.get("id"), "budget_label": _b.get("label")}
            for entry in zero_activity_mapped_rows(
                _b.get("rows") or [], _activity_by_gl_windowed, _carta_account_names)
        )
    _unresolved.extend(_zero_activity)
    # One numbered table over every budget, in workbook order, with the
    # fee halves the money already settles pre-filled.
    _mapping_table = []
    for _b in _own_budgets:
        _qt = fund_quarter_totals(fund_fee_entries, _b.get("period_year"))
        _proposals = {}
        for _r in _b.get("rows") or []:
            _p = (propose_fund_account(_r, _qt.get(_r.get("fund_match"), {}))
                  if _r.get("fund_match") else None)
            if _p:
                _proposals[_r.get("addr")] = _p
        _tab_name = (_b.get("workbook_meta") or {}).get("sheet") or _b.get("label")
        _mapping_table.extend(mapping_table(_b.get("rows") or [], _unresolved, _proposals,
                                            tab_name=_tab_name))
    # Values read off the client's own wording. Applied, so the report is
    # whole, and asked, so nobody finds out months later that a heading was
    # taken to mean something the client never said.
    # One pass over every budget of the firm's own: an answer is recorded by
    # inference key alone, so it reaches the same wording in all of them.
    _inferences = unconfirmed_inferences(
        [r for _b in _own_budgets for r in (_b.get("rows") or [])], _inference_decisions)
    _mapping_table.extend(inference_rows(
        _inferences, account_words=generic_scope_words(_carta_account_names)))
    # _own_budgets only: a shared-in budget's rows arrive already resolved by
    # its creator, so counting them here would read as native-mapping coverage
    # this firm's own workbook doesn't actually have.
    _native_mapping = native_mapping_coverage(_own_budgets, _mapping_table)
    # Spend the report cannot show at all: an account no line names, or the
    # part of one that the scoped lines naming it do not cover. Asked over
    # every budget's lines at once — an account reported by one budget's
    # line is reported.
    #
    # No workbook means Carta's own per-account budget is the only budget
    # there is, and it names accounts too (carta_variance_payload's rows,
    # one per budgeted account, gl_codes == [account_type]) — without this
    # fallback every account with activity reads as "no line names it",
    # Payroll included, the moment the firm declines a workbook. Scoped to
    # _own_budgets like the passes above: a shared-in report's rows already
    # went through its creator's own gap analysis, not this viewer's.
    _all_budget_rows = ([r for _b in _own_budgets for r in (_b.get("rows") or [])]
                        if _own_budgets else carta_variance_payload(budgets)["rows"])
    # No budget rows at all (Excel declined and Carta's budget opted out,
    # or Carta has none either) means there is no budget for an account to
    # miss — asking which line reports it would be asking about lines that
    # don't exist.
    _unaccounted = (unaccounted_accounts(_all_budget_rows, all_rows,
                                         _carta_account_names,
                                         read_account_decisions(dashboard),
                                         window=_window)
                    if _all_budget_rows else [])
    _mapping_table.extend(account_rows(_unaccounted))
    for _i, _row in enumerate(_mapping_table, 1):
        _row["n"] = _i
    for _b in excel_budgets:
        apply_dimension_residual(_b.get("rows") or [], _claims_by_budget[id(_b)], all_rows)
    # The gap report stays firm-wide: a value any budget accounts for is not
    # a value the firm has left unreported.
    _all_claims = [c for _b in excel_budgets for c in _claims_by_budget[id(_b)]]
    _claims = [c for i, c in enumerate(_all_claims) if c not in _all_claims[:i]]
    _unclaimed = unclaimed_dimension_values(_claim_census, _claims)

    # An unreadable file applies no answers, so it has none to attribute either.
    _provenance = mapping_provenance(_read_mapping_or_empty(dashboard))

    _gaps = {
        "unresolved": len(_unresolved) - len(_zero_activity),
        "budget_only": sum(1 for _b in _own_budgets
                           for r in (_b.get("rows") or []) if r.get("void")),
        "widened": _widened,
        "unclaimed": len(_unclaimed),
        "inferred": len(_inferences),
        "unaccounted": len(_unaccounted),
        "zero_activity": len(_zero_activity),
        "delegated": len(_provenance["delegated"]),
        "unattributed": len(_provenance["unattributed"]),
    }
    # The one line Step 5 reads back to the operator. Everything else here
    # is a note for whoever is watching a build; this is for the person who
    # asked for the report.
    _sentence = gaps_sentence(_gaps)
    if _sentence:
        print(f"gaps: {_sentence}.", file=sys.stderr)
    if _unaccounted:
        print(f"note: {len(_unaccounted)} account(s) carry activity no budget "
              f"line reports.", file=sys.stderr)
    if _unclaimed:
        print(f"note: {len(_unclaimed)} dimension value(s) no budget line "
              f"accounts for.", file=sys.stderr)

    # What a GL account row can be opened up by. Censused over every source
    # so the reader picks, rather than the budget's own axis deciding.
    _row_census = dimension_census(all_rows, sources=ROW_DIMENSION_SOURCES)
    _row_dimension = None
    if _coa_top.exists():
        try:
            _row_dimension = json.loads(_coa_top.read_text()).get("row_dimension")
        except Exception:
            pass

    # A custom report holds only the accounts its owner kept. Its rows are cut here and every
    # figure it carries is worked out again from them, before the snapshot entry and the
    # payload own_sync pushes read it. The variance chart reads the file's rows, so it is
    # cut separately below.
    for _b in excel_budgets:
        _kept = report_store.custom_gl_codes(_b)
        if _kept is not None:
            _b["rows"] = cut_to_accounts(_b.get("rows") or [], _kept)
            _refigure(_b, as_of_month)

    variance_categories = None
    if excel_budgets:
        # Read the mapping here rather than borrowing read_excel_budget's
        # local. Department-scoped rows need the workbook-dept → Carta-tag
        # aliases, and reaching into another function's scope for them is
        # how this silently fell back to firm-wide actuals.
        variance_aliases: dict[str, list[str]] = {}
        variance_coa_records: list = []
        _coa = Path(dashboard) / "coa-mapping.json"
        if _coa.exists():
            try:
                _coa_data = json.loads(_coa.read_text())
                variance_aliases = _coa_data.get("value_aliases") or {}
                variance_coa_records = _coa_data.get("records") or []
            except Exception:
                variance_aliases = {}
        sets = []
        for f, parsed in zip(excel_files, excel_budgets):
            ft = next((d["tag_value"] for d in (parsed.get("by_tag_value") or [])
                       if "total" in d["tag_value"].strip().lower()), "Firm Total")
            try:
                raw_budget = json.loads(f.read_text())
            except Exception:
                continue
            # This is a separate load from read_excel_budget()'s, so its
            # backfill from coa-mapping.json's category names has to be
            # re-applied here too — see backfill_account_type_from_coa.
            # Crosstab only: an outline's rows key on gl_codes, which this
            # backfill doesn't touch, and which variance_payload restores
            # from the client's own answers instead.
            if variance_coa_records and (raw_budget.get("dimensions") or []):
                backfill_account_type_from_coa(raw_budget.get("rows") or [],
                                               variance_coa_records)
            raw_budget = variance_payload(raw_budget, parsed)
            _kept = report_store.custom_gl_codes(parsed)
            if _kept is not None:
                raw_budget = {**raw_budget, "rows": cut_to_accounts(raw_budget.get("rows") or [], _kept)}
            built = build_variance_categories(raw_budget, accounts, ft, as_of_month,
                                             entries=all_rows,
                                             value_aliases=(parsed.get("value_aliases") or {})
                                             if parsed.get("read_only") else variance_aliases,
                                             dimension=dimension,
                                             coa_types=set(_coa_all) or None)
            if not built:
                continue
            built["id"] = parsed.get("id")
            built["label"] = parsed.get("label") or built.get("budget_label")
            sets.append(built)
        if sets:
            variance_categories = {"budgets": sets, "default_id": sets[0].get("id")}
    if carta_entry:
        built = build_variance_categories(carta_variance_payload(budgets),
                                          accounts, "Firm Total",
                                          as_of_month, entries=all_rows)
        if built:
            built["id"] = report_store.CARTA_BUDGET_ID
            built["label"] = "Carta budget"
            others = (variance_categories or {}).get("budgets") or []
            variance_categories = {"budgets": [built, *others], "default_id": report_store.CARTA_BUDGET_ID}

    vendor_spend = build_vendor_spend(all_rows, _vendor_map, _vendor_agg)

    # --- Currency -----
    # Query D is empty for a ManCo not in AGGREGATE_FUND_METRICS. Cash then names
    # the currency only when it holds exactly one; else None, never assumed USD.
    currency = read_currency(raw)

    # --- Cash -----
    # Reads the currency: it picks which per-currency total the dashboard shows.
    cash = read_cash_balance(raw, args.manco_entity_id, currency)
    if currency is None:
        currency = cash["currency"]

    # --- Report share payloads -----
    # What each of your reports would be shared as, written beside its build
    # input so the app server can publish without rebuilding. Reuses the same
    # currency the dashboard itself landed on above (query, then cash); the
    # ManCo entity's own stands in only when both of those came back empty —
    # a stated source, never a guess.
    # A payload that can't be built is skipped, never a failed build: the
    # dashboard matters more than one report's share, which says it isn't ready.
    # A report you shared is marked changed once its payload moves away from the
    # one you sent, so the app offers to share the update.
    _report_currency = currency or manco_entity_currency(raw, args.manco_uuid)
    for _b in _own_budgets:
        # Last build's payload goes first, so one that can't be rebuilt reads as not
        # ready instead of sharing stale rows.
        _reports.discard_share_payload(_b["id"])
        try:
            _payload = canonical_budget.share_payload(_b, _report_currency, fallback_year=args.as_of_year)
            # A custom report's pivot travels in its view, so the hosted app shows the
            # same report once own_sync pushes it.
            if (_payload is not None and report_store.custom_gl_codes(_b) is not None
                    and isinstance(_b.get("view"), dict)):
                _payload = dict(_payload, view=_b["view"])
            if _payload is not None:
                _reports.write_share_payload(_b["id"], _payload)
                _b["report"] = _reports.mark_if_payload_moved(_b["id"], _payload) or _b.get("report")
        except Exception as e:
            print(f"[build] share payload for {_b.get('id')!r} skipped: {e}", file=sys.stderr)

    # --- Assemble snapshot.json -----
    # Without a workbook the firm still has whatever budget it keeps in
    # Carta. That has no department or tag dimension, so the account is the
    # only axis it can offer — but a per-account Budget vs Actuals is still
    # the page the operator came for, and it was previously not rendered at
    # all.
    selectable_budgets = ([carta_entry] if carta_entry else []) + excel_budgets

    snapshot = {
        "firmName":    args.firm_name,
        "entityLabel": args.manco_name,
        "asOf":        args.as_of,
        # The ledger's own latest entry date, for the sidebar's "Books
        # posted through" line — distinct from `asOf`, the fetch date.
        "lastPostedDate": last_posted_date,
        "currency":    currency,
        "cartaEnvironment": getattr(args, "carta_environment", "production"),
        "cartaIds":    {"firm": args.firm_carta_id, "manco_fund": args.manco_carta_id},
        "ops":         {"total_income": round(total_income, 2),
                        "total_expenses": round(total_expense, 2)},
        "cash":        dict(cash, fund_count=len(top_fund_uuids) or 1),
        "spendByGL":   {"accounts": spend_by_gl},
        "vendorSpend": vendor_spend,
        "varianceByCategory": variance_categories,
        "feeSchedule": fee_schedule,
        "monthlyCashflow": monthly_cashflow,
        "budget": {
            "income":   {"annual": budgets["income_annual"],   "ytd": budgets["income_ytd"]},
            "expenses": {"annual": budgets["expenses_annual"], "ytd": budgets["expenses_ytd"]},
            "net":      {"annual": budgets["income_annual"] - budgets["expenses_annual"],
                         "ytd":    budgets["income_ytd"]    - budgets["expenses_ytd"]},
            # source: "excel-workbook" when a client budget.json was found,
            # else "carta-fa-list-budgets". Drives the source caption in
            # BudgetVsActuals and gates the new Budget-vs-Actuals page in
            # the left nav.
            "source":        budgets.get("source"),
            # Dimensional slice — populated only when the workbook adapter
            # emits by_tag_value (the tag-crosstab shape). null for
            # Carta-fa:list:budgets-sourced firms; the dashboard hides the
            # Budget-vs-Actuals nav entry in that case.
            "by_tag_value": budgets.get("by_tag_value"),
            # Provenance for the source caption in the UI.
            "workbook_meta": budgets.get("workbook_meta"),
            # Period metadata for the BvA page header — "ytd_through_as_of"
            # renders as "Period: Jan 1 – <asOf>", "annual" as
            # "Period: FY<year>". Absent for Carta-sourced budgets.
            "period_kind":   budgets.get("period_kind"),
            "period_year":   budgets.get("period_year"),
            # The months this budget covers, as {first_month, last_month,
            # label}. The BvA page sums journal entries in the browser and
            # windows them with this; without it a budget stated through
            # June is charged with spend through today.
            "period":        budgets.get("period"),
            # Multi-budget: all Excel budgets found in the dashboard dir,
            # each carrying its own {id, label, by_tag_value, workbook_meta,
            # period_kind, period_year, income/expenses/net}. The UI sub-nav
            # under "Budget vs Actuals" renders one entry per budgets[i].
            # snapshot.budget above stays populated with the primary (first)
            # for backwards compat with Dashboard-page charts that read
            # scalar income/expenses/net without knowing about multi-budget.
            "budgets":       [snapshot_budget_entry(b, as_of_month) for b in selectable_budgets],
            report_store.CARTA_BUDGET_ID: snapshot_budget_entry(carta_entry, as_of_month) if carta_entry else None,
        },
    }

    accounts_data = {
        "asOf":            args.as_of,
        "manco_uuid":      args.manco_uuid,
        # Lets a later run reopen this (firm, manco) from cache with no identity lookup over the MCP.
        "firm_uuid":       args.firm_uuid,
        "firm_carta_id":   args.firm_carta_id,
        "manco_carta_id":  args.manco_carta_id,
        "manco_entity_id": args.manco_entity_id,
        "carta_environment": getattr(args, "carta_environment", "production"),
        "accounts":   accounts,
        "monthly_categories": monthly_categories,
        "entries":            all_rows,
        "fund_fee_entries":   fund_fee_entries,
        # The fee chart's own drilldown: the ManCo's entries, which are the
        # ones its trial balance holds and the ones its deep links open.
        "manco_fee_entries":  manco_fee_entries,
        # Contracted LPA terms per fund/period (rate, basis, frequency) —
        # empty when management-fee-schedules.txt was never fetched (older
        # raw dirs, or a Data Explorer environment that doesn't have the
        # MANAGEMENT_FEE_SCHEDULES table yet). Distinct from fund_fee_entries,
        # which is posted GL actuals.
        "fee_schedule_terms": fee_schedule_terms,
        # False means no JE ever carries the scoping tag — the UI must fall
        # back to firm-wide actuals rather than show every column as $0.
        "tagValuesAvailable": has_dimension_values(all_rows, dimension),
        # Which category the budget's columns are scoped by, and every
        # category this firm actually uses, so the UI and the next ingest
        # can work from what exists rather than an assumption.
        # Lines that will render with no actuals, and what each needs, so
        # the gap is a question rather than a zero to be noticed.
        "unresolvedBudgetRows": _unresolved,
        # The same questions as one numbered table to confirm in a pass.
        # Accounts with activity the report cannot show, for the gate to ask
        # about — where the money belongs, or that it is not expected here.
        "unaccountedAccounts": _unaccounted,
        "mappingTable":  _mapping_table,
        # How much of the budget the mapping tab + formulas + the
        # workbook's own GL codes already cover, and whether that's thin
        # enough to ask for a mapping file over — see Step 4.6.
        "nativeMapping": _native_mapping,
        "dimension":     dimension,
        "dimensions":    _census,
        "tagCategory":   tag_category,
        # What a GL account row can be opened up by, and the reader's
        # recorded preference for which one opens first.
        "rowDimensions": _row_census,
        "rowDimension":  _row_dimension,
        # Dimension values with spend that no budget line accounts for — a
        # question for the client, not something to guess at.
        "unclaimedValues": _unclaimed,
        # Which recorded answers the model made on the operator's behalf, and
        # which carry no source at all — Step 4.7 lists both back.
        "mappingProvenance": _provenance,
        "gaps": _gaps,
    }

    (dashboard / "snapshot.json").write_text(json.dumps(snapshot, indent=2))
    (dashboard / "accounts.json").write_text(json.dumps(accounts_data, indent=2))

    # Sanity summary — stderr, so the caller can suppress it. Do not import
    # sys here: that makes it a local, and every earlier note above raises.
    print(f"firm:          {args.firm_name}", file=sys.stderr)
    print(f"manco:         {args.manco_name}", file=sys.stderr)
    print(f"YTD income:    ${total_income:>15,.2f}", file=sys.stderr)
    print(f"YTD expenses:  ${total_expense:>15,.2f}", file=sys.stderr)
    print(f"YTD net:       ${total_income - total_expense:>15,.2f}", file=sys.stderr)
    if cash["balance"] is None:
        print(f"Cash bal:      unavailable ({cash['unavailable_reason']})", file=sys.stderr)
    else:
        stale = f", {cash['stale_account_count']} stale" if cash["stale_account_count"] else ""
        print(f"Cash bal:      {cash['balance']:>15,.2f} {cash['currency'] or ''}{stale}",
              file=sys.stderr)
    print(f"Expense accts: {len(expense_accounts)}", file=sys.stderr)
    print(f"Fund-fee funds displayed: {len(fee_funds)} (of {len(fund_totals)} total)", file=sys.stderr)
    print(f"Fund-fee years: {fee_labels}", file=sys.stderr)
    print(f"Wrote: {dashboard}/snapshot.json + accounts.json", file=sys.stderr)

    if not getattr(args, "no_sync_sweep", False):
        _spawn_sync_sweep(dashboard)


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--firm-name",       required=True)
    p.add_argument("--firm-uuid",       required=True)
    p.add_argument("--firm-carta-id",   required=True, type=int)
    p.add_argument("--manco-name",      required=True)
    p.add_argument("--manco-uuid",      required=True)
    p.add_argument("--manco-carta-id",  required=True, type=int)
    p.add_argument("--manco-entity-id", type=int,
                   help="integer Fund PK (fa:list:entities' `id`) — picks the ManCo "
                        "out of cash-balance.json")
    p.add_argument("--raw-dir",         required=True, help="dir holding raw MCP query dumps")
    p.add_argument("--dashboard-dir",   required=True, help="dir to write snapshot.json + accounts.json")
    p.add_argument("--as-of",           required=True, help="ISO date, e.g. 2026-07-15")
    p.add_argument("--as-of-year",      type=int, help="year for YTD calculations (default: parsed from --as-of)")
    p.add_argument("--carta-environment", default="production", choices=["production", "nonprod"],
                   help="from Step 1's <SERVER>-name classification (firm-lookup.md) — "
                        "served to the browser's Snowplow tracker; defaults to production")
    # Not type=int: a malformed id must degrade to "no user", not fail the build.
    p.add_argument("--user-id", default=None,
                   help="the operator's Carta user pk (get_current_user), saved as <dashboard-dir>/.user-id "
                        "so whatever pushes this dashboard's own reports to the hosted app next — the "
                        "session itself, or own_sync.py's own sweep for a build made without "
                        "--no-sync-sweep — knows whose reports these are")
    p.add_argument("--no-sync-sweep", action="store_true",
                   help="skip the detached claude-CLI own-sync sweep this build would otherwise spawn — "
                        "the skill pushes each report itself, through its own Carta connector, when "
                        "the user asks for it (serve-and-update.md Step 5.2)")
    args = p.parse_args()
    if not args.as_of_year:
        args.as_of_year = int(args.as_of.split("-")[0])
    build(args)


if __name__ == "__main__":
    main()
