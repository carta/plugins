#!/usr/bin/env python3
"""manco_raw_dumps.py — carta-manco-reporting's raw-dump parsers and readers:
pipe-table and total_rows parsing, normalizing a journal-entry row, and every
read_* over --raw-dir (expense/income/reimbursement entries, the entity
roster, fund fees, the fee-schedule terms table, the cash balance, the chart
of accounts, the ManCo's reporting currency, and the fetch-completeness
check).
"""

import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import manco_banner


def parse_total_rows(text):
    """Extract the `total_rows: N` value from a pipe-table's optional
    preamble line (e.g. `total_rows: 1,842 | offset: 0 | limit: 1000 |
    format: markdown`). Returns None when the preamble is absent — single
    -page responses and hand-written fixtures both take this path, and
    callers must treat that as "nothing to check against", not zero."""
    return manco_banner.parse_banner_total(text)


def parse_pipe_table(text):
    """Parse a Carta MCP pipe-table (markdown format). Returns list[dict].

    A cell holding a raw line break splits one logical row across physical
    lines; a line is folded into the open row when the merged cell count
    does not exceed the header count. Short rows ending in `|` are padded."""
    lines = [ln for ln in text.splitlines() if ln.strip()]
    if not lines:
        return []
    start = 1 if lines[0].startswith(manco_banner.PREFIX) else 0
    headers = [h.strip().lower() for h in lines[start].split(" | ")]
    di = start + 1
    if di < len(lines) and re.fullmatch(r"[\s\-|]+", lines[di]):
        di += 1
    rows = []
    pending = None  # cells accumulated so far for the row in progress

    def _close(cells):
        cells = list(cells)
        while len(cells) < len(headers):
            cells.append("")
        rows.append(dict(zip(headers, cells[:len(headers)])))

    for line in lines[di:]:
        explicit_short_row = line.rstrip().endswith("|")
        stripped = line.rstrip().rstrip("|").rstrip()
        cells = [c.strip() for c in stripped.split(" | ")]
        if pending is None and rows and len(headers) > 1 and len(cells) == 1 and not explicit_short_row:
            # A lone one-cell line with no row in progress is the tail of a
            # newline-split description that lands in the LAST column — the
            # row holding it was already closed (it had a full cell count,
            # just with a truncated description). Fold it onto that row's
            # last column instead of letting it seed a new stray row.
            rows[-1][headers[-1]] += " " + cells[0]
            continue
        if pending is not None:
            # Only fold this line into the row in progress if the result
            # wouldn't blow past the header count — that's the signal that
            # this line is the rest of a newline-split cell, not an
            # unrelated full row that merely looked short on its own.
            merged_len = len(pending) - 1 + len(cells)
            if merged_len <= len(headers):
                pending[-1] = pending[-1] + " " + cells[0]
                pending.extend(cells[1:])
            else:
                _close(pending)
                pending = cells
        else:
            pending = cells
        if len(pending) >= len(headers):
            rows.append(dict(zip(headers, pending[:len(headers)])))
            pending = None
        elif explicit_short_row:
            _close(pending)
            pending = None
        # else: short of a full row with no trailing-pipe marker — hold it
        # open and merge the next physical line into it.
    if pending is not None:
        _close(pending)
    return rows


def _parse_tags(row):
    """Normalize tags into a list of {category, value} pairs.
    Prefers the structured REPORTING_TAGS_JSON column (an OBJECT keyed by
    category, e.g. {"cost_center":"R&D","team":"Engineering"}); falls back
    to splitting the flat REPORTING_TAGS text into value-only pairs
    (category="") when JSON is empty. Both surfaces render as pill lists in
    the UI; only JSON-sourced pairs group under category headers."""
    raw_json = (row.get("tags_json") or "").strip()
    if raw_json and raw_json not in ("null", "{}", "[]"):
        try:
            obj = json.loads(raw_json)
            if isinstance(obj, dict):
                # {category: value | [values...]} — flatten multi-value cells
                pairs = []
                for cat, val in obj.items():
                    if val is None:
                        continue
                    if isinstance(val, list):
                        for v in val:
                            if v is not None and str(v).strip():
                                pairs.append({"category": str(cat), "value": str(v)})
                    else:
                        s = str(val).strip()
                        if s:
                            pairs.append({"category": str(cat), "value": s})
                if pairs:
                    return pairs
        except (ValueError, TypeError):
            pass  # fall through to flat parsing
    # Fall back to flat comma-separated string
    flat = (row.get("tags") or "").strip()
    if not flat:
        return []
    return [{"category": "", "value": v.strip()} for v in flat.split(",") if v.strip()]


def _year_of(date):
    """Calendar year of an ISO date string; None when it does not start with one."""
    head = str(date)[:4]
    return int(head) if head.isdigit() else None


def norm_je_row(row, kind):
    """Normalize a JE-line dict from the standard SQL projection."""
    return {
        "id":          row["id"],
        "gluuid":      row.get("gluuid") or None,
        "date":        row["date"],
        # Budget vs Actuals counts an entry only toward a budget of its own
        # year, so the year travels with the month.
        "yr":          _year_of(row["date"]),
        "mo":          int(row["mo"]),
        "account":     row["account"],
        "acct_type":   int(row["acct_type"]),
        "sub":         row.get("sub") or None,
        # Carta numbers a sub-account under its account (7120.001), which
        # is what a reader reconciling against the ledger looks for.
        "sub_code":    row.get("sub_code") or None,
        "amount":      float(row["amt"]),
        "description": row.get("descr", ""),
        "vendor":      row.get("vendor") or None,
        "vendor_type": row.get("vendor_type") or None,
        "partner":     row.get("partner") or None,
        "event_type":  row.get("event_type") or None,
        "tags":        _parse_tags(row),
        "kind":        kind,
    }


def read_expense_pages(raw_dir):
    """Read one or more paginated expense files. The LLM writes them as
    je-expense-page1.txt, je-expense-page2.txt, etc.

    Guards against a silently truncated pull: if any page's `total_rows:`
    preamble declares more rows than were actually parsed across all pages,
    a later OFFSET page was likely never fetched. Refuse to build a
    dashboard from an incomplete ledger rather than silently understating
    YTD totals and misranking spend-by-GL."""
    rows = []
    declared_total = None
    for p in sorted(raw_dir.glob("je-expense-page*.txt")):
        text = p.read_text()
        n = parse_total_rows(text)
        if n is not None:
            declared_total = max(declared_total or 0, n)
        rows.extend(norm_je_row(r, "expense") for r in parse_pipe_table(text))
    if declared_total is not None and len(rows) < declared_total:
        pages_fetched = len(list(raw_dir.glob("je-expense-page*.txt")))
        if pages_fetched >= 5:
            # Query A's fetch cap (references/data-fetch.md) tops out at 5 pages / 5,000
            # rows. Advising "fetch the remaining page(s)" here would push the LLM to
            # fetch a 6th page past that cap — the opposite of the honest-failure
            # behavior the cap exists to produce.
            raise SystemExit(
                f"ManCo expenses: total_rows header says {declared_total} rows "
                f"but only {len(rows)} were parsed from {pages_fetched} page(s) — "
                f"the 5-page (5,000-row) fetch cap in references/data-fetch.md Query A "
                f"was hit before the full ledger was pulled. Do not fetch a 6th page; "
                f"tell the user this ManCo's YTD expense ledger exceeds the fetch cap "
                f"and the dashboard cannot be built from a complete pull."
            )
        raise SystemExit(
            f"ManCo expenses: total_rows header says {declared_total} rows "
            f"but only {len(rows)} were parsed from {raw_dir}/je-expense-page*.txt "
            f"— a later OFFSET page is missing. Fetch the remaining page(s) "
            f"(see references/data-fetch.md Query A) before rebuilding."
        )
    # After the guard, which counts what the pages actually carried.
    return drop_repeated_rows(rows)


def drop_repeated_rows(rows):
    """Rows a page overlap fetched twice.

    A paginated pull whose next OFFSET lands a few rows early repeats those
    rows, and the ledger then holds one journal line twice. Every chart
    counts it twice and they all still agree with each other, so nothing
    downstream can notice — only the pages themselves can.

    Identity is the whole row, not the id: a row repeated verbatim is a
    fetch artifact, while one id arriving with different content would be
    real detail this must not drop.
    """
    seen, out = set(), []
    for r in rows:
        key = json.dumps(r, sort_keys=True, default=str)
        if key in seen:
            continue
        seen.add(key)
        out.append(r)
    dropped = len(rows) - len(out)
    if dropped:
        print(f"note: {dropped} journal line(s) arrived twice from overlapping "
              f"pages and were counted once.", file=sys.stderr)
    return out


def read_reimbursement_entries(raw_dir):
    """Journal entries the firm settled through its reimbursement payable.

    A reimbursement credits a liability to the person and clears when they
    are repaid. That is the firm's own record of what the payment was —
    stronger than anything the expense side can be read for, because it
    doesn't care whether they expensed a hotel or a phone bill.

    Absent file means an older cache fetched before this query existed:
    nothing is grouped, which is the pre-existing behaviour.
    """
    f = raw_dir / "reimbursement-entries.txt"
    if not f.exists():
        return set()
    out = set()
    for r in parse_pipe_table(f.read_text()):
        gl = (r.get("gluuid") or r.get("journal_entry_gluuid") or "").strip()
        if gl:
            out.add(gl)
    return out


def read_income(raw_dir):
    f = raw_dir / "je-income.txt"
    if not f.exists():
        return []
    return [norm_je_row(r, "income") for r in parse_pipe_table(f.read_text())]


def read_manco_fee_income(raw_dir):
    """The ManCo's own fee income lines — its books, not the funds'.

    A fee has two sides: the fund expenses it, the ManCo earns it. Only the
    second is on the ManCo's trial balance, which is what this dashboard
    reports, so the fee chart reads these.
    """
    f = raw_dir / "manco-fee-income.txt"
    if not f.exists():
        return []
    return parse_pipe_table(f.read_text())


def _load_entity_list(raw_dir):
    """The entity roster (entities.json, from fa:list:entities) as entity dicts.

    The file is a bare list or {"entities": [...]}. A missing or unreadable
    file, any other shape, and any entry that is not a dict read as nothing.
    """
    try:
        data = json.loads((Path(raw_dir) / "entities.json").read_text())
    except (OSError, ValueError):
        return []
    if isinstance(data, dict):
        data = data.get("entities")
    if not isinstance(data, list):
        return []
    return [e for e in data if isinstance(e, dict)]


def read_entity_roster(raw_dir):
    """Entity `id` -> uuid and name, from fa:list:entities.

    A fee income line names the fund it bills through RELATED_ENTITY_ID,
    which is this `id`. Without the roster the line has no fund.
    """
    out = {}
    for e in _load_entity_list(raw_dir):
        try:
            eid = int(e["id"])
        except (KeyError, TypeError, ValueError):
            continue
        out[eid] = {"uuid": e.get("uuid"), "name": e.get("name"),
                    "carta_id": e.get("carta_id")}
    return out


def read_fund_fees(raw_dir):
    f = raw_dir / "fund-fees.txt"
    if not f.exists():
        return []
    return parse_pipe_table(f.read_text())


def _cell(v):
    """One warehouse cell, or None.

    The DWH's markdown output writes an absent value as the literal string
    `NULL`, which is a string like any other. Left alone it reaches a
    `float()` as a crash — and, worse, reaches a label as the word NULL,
    which reads like a real answer.
    """
    s = str(v).strip() if v is not None else ""
    return None if not s or s.upper() == "NULL" else s


def read_fee_schedule_terms(raw_dir):
    """Contracted management-fee schedule terms (FUND_ADMIN.MANAGEMENT_FEE_SCHEDULES) —
    the fund's LPA-configured rate/basis/frequency, distinct from fund_fee_entries
    (posted GL actuals). An absent file is not an error: the table only reached
    Data Explorer in TEST/PREPROD/SANDBOX/PRODUCTION as of 2026-08 and older raw
    dirs, or firms without a fetch of it yet, simply have nothing to show here.

    minimum_fee_amount/fixed_fee_amount/fee_currency are newer columns
    (carta/ds-dbt#13083) than the rest of this table - a raw file fetched before
    that column landed simply won't have them in its header, and .get() below
    degrades that to None per row rather than a KeyError."""
    f = raw_dir / "management-fee-schedules.txt"
    if not f.exists():
        return []
    terms = []
    for r in parse_pipe_table(f.read_text()):
        c = lambda k: _cell(r.get(k))
        terms.append({
            "fund":              r["fund"],
            "fund_uuid":         r["fund_uuid"],
            "period_name":       r["period_name"],
            "fee_rate":          float(c("fee_rate")) if c("fee_rate") else None,
            "calculation_base":  c("calculation_base"),
            "minimum_fee_amount": float(c("minimum_fee_amount")) if c("minimum_fee_amount") else None,
            "fixed_fee_amount":  float(c("fixed_fee_amount")) if c("fixed_fee_amount") else None,
            "fee_currency":      c("fee_currency"),
            "frequency":         c("frequency"),
            "waived":            (c("waived") or "").lower() == "true",
            "start_date":        c("start_date"),
            "end_date":          c("end_date"),
            "period_order":      int(c("period_order")) if c("period_order") else 0,
            "uses_custom_calculation_base":
                r.get("uses_custom_calculation_base", "").strip().lower() == "true",
        })
    return terms


# A missing file after a completed fetch means its save call never ran —
# different from a genuine 0-row result, which read_cash_balance already
# distinguishes via unavailable_reason.
_FETCH_REQUIRED_FILES = ("je-income.txt", "fund-fees.txt",
                         "manco-fee-income.txt")


def check_fetch_completeness(raw_dir):
    fetched_marker = raw_dir / ".fetched-at"
    if not fetched_marker.exists():
        return  # no completed Step-3 run yet — nothing to cross-check against
    missing = [name for name in _FETCH_REQUIRED_FILES if not (raw_dir / name).exists()]
    if missing:
        raise SystemExit(
            f"{raw_dir}/.fetched-at records a completed fetch, but "
            f"{', '.join(missing)} is missing — a save call never ran "
            f"this fetch (see references/data-fetch.md's 'Capture that follow-up "
            f"message' discipline). Do not build from this raw_dir: a missing "
            f"file is not the same as a genuine 0-row result, and building now "
            f"would silently understate income, or report the fee chart from "
            f"the funds' ledger instead of the ManCo's. Re-run Step 3 for "
            f"{', '.join(missing)} before rebuilding."
        )


def _cash_unavailable(reason, currency):
    """The cash block when there is no balance to report.

    `balance` is None, never 0.0: the app renders None as '—', and a ManCo
    whose balances Carta doesn't have is not a ManCo holding nothing.
    """
    return {"balance": None, "currency": currency, "by_currency": [],
            "accounts": [], "stale_account_count": 0, "unavailable_reason": reason}


def read_cash_balance(raw_dir, manco_entity_id, currency):
    """Read the ManCo's cash position from the saved fa:get:cash-balance
    response (see references/data-fetch.md).

    `balance` is the entity's own total for `currency`. Other currencies
    stay in `by_currency` and are never added to it — a sum across
    currencies means nothing (this repo's CLAUDE.md Currencies rule).
    """
    f = raw_dir / "cash-balance.json"
    if not f.exists():
        return _cash_unavailable("not-fetched", currency)
    try:
        data = json.loads(f.read_text())
    except Exception:
        return _cash_unavailable("unreadable", currency)

    entities = data.get("entities") or []
    entity = None
    for e in entities:
        if manco_entity_id is not None and e.get("entity_id") == manco_entity_id:
            entity = e
            break
    # manco_entity_id is optional, and the fetch filters to the ManCo, so a
    # response holding exactly one entity is unambiguous without it.
    if entity is None and manco_entity_id is None and len(entities) == 1:
        entity = entities[0]
    if entity is None:
        return _cash_unavailable("entity-not-in-response", currency)

    by_currency = []
    for t in (entity.get("totals_by_currency") or []):
        code = (t.get("currency_code") or "").strip().upper()
        try:
            amount = float(t.get("total_balance"))
        except (TypeError, ValueError):
            continue
        if code:
            by_currency.append({"currency_code": code, "total_balance": round(amount, 2)})

    accounts = []
    stale_count = 0
    for a in (entity.get("bank_accounts") or []):
        try:
            balance = float(a.get("balance"))
        except (TypeError, ValueError):
            balance = None
        is_stale = bool(a.get("is_stale"))
        if is_stale:
            stale_count += 1
        accounts.append({
            "bank_name":      a.get("bank_name"),
            "account_name":   a.get("account_name"),
            "balance":        None if balance is None else round(balance, 2),
            "currency_code":  (a.get("currency_code") or "").strip().upper() or None,
            "is_manual":      bool(a.get("is_manual")),
            "is_stale":       is_stale,
            "staleness_days": a.get("staleness_days"),
            "as_of_date":     a.get("as_of_date"),
        })

    if not by_currency:
        return _cash_unavailable("no-bank-accounts", currency)

    # With no reporting currency to match against, a single-currency ManCo is
    # unambiguous — its one total is the answer, and it names its own currency.
    if currency is None and len(by_currency) == 1:
        only = by_currency[0]
        return {"balance": only["total_balance"], "currency": only["currency_code"],
                "by_currency": by_currency, "accounts": accounts,
                "stale_account_count": stale_count, "unavailable_reason": None}

    match = next((t for t in by_currency if t["currency_code"] == currency), None)
    if match is None:
        block = _cash_unavailable("currency-mismatch", currency)
        block["by_currency"] = by_currency
        block["accounts"] = accounts
        block["stale_account_count"] = stale_count
        return block

    return {"balance": match["total_balance"], "currency": currency,
            "by_currency": by_currency, "accounts": accounts,
            "stale_account_count": stale_count, "unavailable_reason": None}


def read_all_accounts(raw_dir):
    """Every GL account the ManCo has ever posted to, from accounts-all.txt.

    Name resolution has to know what accounts EXIST, which is not the same
    question as what the reporting window happens to contain. A budget is
    written for spend that hasn't happened yet, so the accounts it names
    are exactly the ones most likely to be quiet this year — matching only
    against the window sends the operator a question the data can answer.
    Returns {account_type: name}, or {} when the file is absent.
    """
    f = raw_dir / "accounts-all.txt"
    if not f.exists():
        return {}
    out = {}
    for r in parse_pipe_table(f.read_text()):
        try:
            t = int(str(r.get("acct_type") or "").strip())
        except ValueError:
            continue
        n = (r.get("account") or "").strip()
        if n:
            out.setdefault(t, n)
    return out


def manco_entity_currency(raw_dir, manco_uuid):
    """The ManCo entity's own currency from the entity roster (entities.json), or None."""
    for entity in _load_entity_list(raw_dir):
        if str(entity.get("uuid")) == str(manco_uuid):
            code = entity.get("currency")
            return code if isinstance(code, str) and len(code) == 3 else None
    return None


def read_currency(raw_dir):
    """Read the ManCo's reporting currency from manco-currency.txt (a
    single-row pipe-table sourced from AGGREGATE_FUND_METRICS — see Query D
    in references/data-fetch.md). Returns an uppercase ISO code, or None if
    the file is absent or the value is empty. Callers must not default to
    USD — render '—' rather than guessing (see this repo's CLAUDE.md
    Currencies rule)."""
    f = raw_dir / "manco-currency.txt"
    if not f.exists():
        return None
    rows = parse_pipe_table(f.read_text())
    if not rows:
        return None
    code = (rows[0].get("currency") or "").strip().upper()
    return code or None

