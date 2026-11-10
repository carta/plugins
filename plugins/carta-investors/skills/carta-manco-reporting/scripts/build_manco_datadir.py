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
from manco_budgets import (
    _MONTH_ABBR, _budget_window, _refigure,
    carta_budget_opted_in, carta_variance_payload, cut_to_accounts,
    empty_budgets, find_excel_budget_files, read_budgets, read_excel_budget,
    snapshot_budget_entry, sync_crosstab_account_types,
)
from manco_vendors import (
    REIMBURSEMENT_LABEL, apply_vendor_inferences, build_vendor_spend,
    group_reimbursements, read_vendor_config,
)
from manco_variance import build_variance_categories, variance_payload
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


def rollup_actuals(all_rows, income_rows, expense_rows, max_mo):
    """The dashboard's actuals-only KPIs, independent of any budget: a
    per-account rollup sorted biggest-first within expense/income, the
    top-8-expenses-plus-Other monthly chart, and monthly income/expense
    cashflow. `max_mo` sets the month coverage — Jan..max_mo — every figure
    here reports over.

    Returns (accounts, expense_accounts, monthly_categories, monthly_cashflow,
    m_income, m_expense) — the last two are monthly_cashflow's income/expenses
    before rounding, which build()'s own YTD totals sum instead of summing the
    rounded per-month figures.
    """
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
    return accounts, expense_accounts, monthly_categories, monthly_cashflow, m_income, m_expense


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
    accounts, expense_accounts, monthly_categories, monthly_cashflow, m_income, m_expense = (
        rollup_actuals(all_rows, income_rows, expense_rows, max_mo))

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
