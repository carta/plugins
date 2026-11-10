#!/usr/bin/env python3
"""manco_fees.py — carta-manco-reporting's fund-fee attribution: reading which
fund a cross-fund fee memo names (and learning it from the bank account a
line posts through when the memo alone can't say), the ManCo's recorded
overrides for a line a memo can't resolve, fee projections from the
contracted schedule, rehoming a fee row onto the ManCo's own account,
fund-name suggestions for an unresolved budget line, and matching a budget
line's "Fund II"-style wording to the fund's real Carta name.
"""

import re
from collections import Counter, defaultdict
from datetime import date as _date

from manco_mapping_store import _read_mapping_or_empty, mapping_section
from shapes.vocab import SECTION_INCOME

# A fund's series suffix, which is the whole of what tells two funds of one
# family apart: "Fund III" from "Fund II", "IV" from "I". A sibling line
# tacks text straight onto the series with no space — a parallel vehicle
# ("VII-A") or a side pocket named in words ("VII - Entrepreneurs Fund") —
# so the terminator accepts a bare "-" as well as a comma, space or the
# end of the name.
_FUND_SERIES_RX = re.compile(r"\b([IVXL]+|\d+)\b\s*(?:,|$|\s|-)", re.IGNORECASE)


def _fund_series_info(name):
    """The legal-suffix-free name, its series, and any text tacked after it.

    All three come from one parse so the shorthand pattern below and the
    tie-break in `infer_fund_from_memo` always agree on what counts as a
    "sibling suffix": text left over after the series itself, once
    trailing legal boilerplate (", L.P.") is gone. "Fund VII" leaves
    nothing; "Fund VII-A" leaves "-A"; "Fund VII - Entrepreneurs Fund"
    leaves "- Entrepreneurs Fund".
    """
    bare = _FUND_LEGAL_SUFFIX_RX.sub("", name or "").strip(" ,")
    m = list(_FUND_SERIES_RX.finditer(bare + " "))
    if not m:
        return bare, None, ""
    last = m[-1]
    return bare, last.group(1), bare[last.end(1):].strip()


def _flex_suffix_pattern(raw_tail):
    """`raw_tail` as a regex, tolerant of the spacing around its own "-".

    "-A" and " - A" and "-  A" all name the same sibling, so the hyphen
    matches with slack on either side while every other character stays
    literal.
    """
    parts = re.split(r"(\s*-\s*|\s+)", raw_tail)
    out = []
    for p in parts:
        if not p:
            continue
        elif p.strip() == "-":
            out.append(r"\s*-\s*")
        elif p.isspace():
            out.append(r"\s+")
        else:
            out.append(re.escape(p))
    return "".join(out)


def _memo_fund_patterns(name):
    """The ways a journal memo might name this fund, most specific first.

    A memo rarely repeats a fund's legal name. It writes the series ("Fund
    III"), the house shorthand ("UVFIII") — initials of the name's own
    words with the series appended — or, for a sibling line, the series
    plus its own suffix ("Fund VII-A"). All three are derived from the
    roster name, so no firm's vocabulary is hardcoded.
    """
    bare, series, raw_tail = _fund_series_info(name)
    words = [w for w in re.findall(r"[A-Za-z0-9]+", bare)]
    if not words:
        return []
    pats = [re.escape(bare)]
    if series:
        initials = "".join(w[0] for w in words if w.lower() != series.lower())
        pats.append(re.escape(f"{initials}{series}"))
        pats.append(r"fund\s+" + re.escape(series))
        if raw_tail:
            sep = "" if raw_tail.startswith("-") else r"\s+"
            pats.append(r"fund\s+" + re.escape(series) + sep + _flex_suffix_pattern(raw_tail))
    return pats


def infer_fund_from_memo(descr, candidates):
    """Which fund a memo names, or None.

    `candidates` is [(uuid, name)]. Longest match wins, so "Fund III"
    never resolves as "Fund I": a shorter series is only accepted when no
    longer one matches the same text. A bare series ("Fund VII") matches
    every sibling in that family equally, since none of them write a
    suffix the memo didn't — among those equal-length ties, the fund
    whose own name carries no sibling suffix wins, since the memo names
    only what a suffix-free fund is. A tie left standing after that (no
    suffix-free fund, or more than one) is not guessed at: no fund is
    named, and the line surfaces as a question instead.
    """
    text = f" {(descr or '')} "
    best_len = 0
    tied = []
    for uuid, name in candidates:
        _, _, raw_tail = _fund_series_info(name)
        matched_len = 0
        for pat in _memo_fund_patterns(name):
            m = re.search(rf"(?<![A-Za-z0-9]){pat}(?![A-Za-z0-9])", text, re.IGNORECASE)
            if m and len(m.group(0)) > matched_len:
                matched_len = len(m.group(0))
        if matched_len == 0:
            continue
        if matched_len > best_len:
            best_len = matched_len
            tied = [(uuid, name, bool(raw_tail))]
        elif matched_len == best_len:
            tied.append((uuid, name, bool(raw_tail)))
    if len(tied) == 1:
        return tied[0][0], tied[0][1]
    if len(tied) > 1:
        no_suffix = [t for t in tied if not t[2]]
        if len(no_suffix) == 1:
            return no_suffix[0][0], no_suffix[0][1]
    return None


# Only digits behind ACCOUNT or a "**" mask. A bare number is a document id
# or the period's own year, and matching those attributes a line at random.
_MEMO_ACCOUNT_RX = re.compile(
    r"(?:ACCOUNT\s+X*(\d{4,})|\*\*\s*(\d{4,}))", re.IGNORECASE)


# The ManCo's own receiving account fails both bars: every fund's fees land
# there, so no one fund dominates it.
_ACCOUNT_MIN_LINES = 5


_ACCOUNT_MIN_SHARE = 0.8


def memo_bank_accounts(descr):
    """The last four digits of every bank account a memo names."""
    return {(a or b)[-4:] for a, b in _MEMO_ACCOUNT_RX.findall(descr or "")}


def learn_bank_accounts(rows, fund_of):
    """Which fund each bank account belongs to, learned from named lines.

    `fund_of(row)` gives the fund a line already names, or None. An account
    is only claimed when one fund holds nearly all of its lines: a fund's
    own account reads that way, and the ManCo's receiving account cannot.
    """
    tally = {}
    for row in rows:
        uuid = fund_of(row)
        if not uuid:
            continue
        for acct in memo_bank_accounts(row.get("descr")):
            tally.setdefault(acct, {})
            tally[acct][uuid] = tally[acct].get(uuid, 0) + 1
    learned = {}
    for acct, funds in tally.items():
        uuid, n = max(funds.items(), key=lambda kv: kv[1])
        total = sum(funds.values())
        if n >= _ACCOUNT_MIN_LINES and n / total >= _ACCOUNT_MIN_SHARE:
            learned[acct] = uuid
    return learned


def _build_fee_projections(fund_fee_entries, fee_schedule_terms, top_fund_uuids,
                           display_name_by_uuid, ytd_year, as_of_str):
    """Project annual fees through each fund's own schedule end date.

    Infers committed capital from the latest actual quarterly fee ÷ (rate/4).
    """
    if not fee_schedule_terms:
        return [], []

    # Index schedule periods by fund_uuid for fast lookup.
    schedules = {}
    for t in fee_schedule_terms:
        if t["fee_rate"] is None or t["uses_custom_calculation_base"] or t["waived"]:
            continue
        uid = t["fund_uuid"]
        schedules.setdefault(uid, []).append({
            "start": _date.fromisoformat(t["start_date"]),
            "end":   _date.fromisoformat(t["end_date"]),
            "rate":  t["fee_rate"],
        })

    def rate_on(uid, d):
        for p in schedules.get(uid, []):
            if p["start"] <= d <= p["end"]:
                return p["rate"]
        return None

    # Infer committed capital from the most recent positive quarterly fee entry
    # and the schedule rate that applied on that entry's date.
    committed = {}
    for uid in top_fund_uuids:
        entries = sorted(
            (e for e in fund_fee_entries if e["fund_uuid"] == uid and e["amount"] > 0),
            key=lambda e: (e["yr"], e["mo"]), reverse=True,
        )
        for e in entries:
            r = rate_on(uid, _date(e["yr"], e["mo"], 15))
            if r and r > 0:
                committed[uid] = e["amount"] / (r / 4)
                break

    if not committed:
        return [], []

    # Project through whichever committed fund's schedule ends latest —
    # a fund's LPA step-downs can run a decade or more past the as-of year.
    last_year = max(
        p["end"].year for uid in committed for p in schedules.get(uid, [])
    )
    future_years = list(range(ytd_year + 1, max(last_year, ytd_year) + 1))
    proj_funds = []
    for uid in top_fund_uuids:
        if uid not in committed:
            continue
        cap = committed[uid]
        name = display_name_by_uuid.get(uid)
        if not name:
            continue
        proj_data = []
        for yr in future_years:
            r = rate_on(uid, _date(yr, 7, 1))
            proj_data.append(round(cap * r, 2) if r else None)
        if any(v is not None for v in proj_data):
            proj_funds.append({
                "name": name,
                "data": proj_data,
                "committedCapital": round(cap),
            })

    if not proj_funds:
        return [], []

    return [str(y) for y in future_years], proj_funds


def _fund_schedules(fee_schedule_terms):
    """fund_uuid -> its live fee periods, and a lookup for the one on a date.

    A waived period, or one on a basis this builder cannot compute, carries
    no rate it could apply, so it is left out entirely.
    """
    schedules = {}
    for t in fee_schedule_terms or []:
        if t["fee_rate"] is None or t["uses_custom_calculation_base"] or t["waived"]:
            continue
        # An open-ended period has no end date, and it is the one most
        # likely in force now — treat it as running to the far future.
        schedules.setdefault(t["fund_uuid"], []).append({
            "start": _date.fromisoformat(t["start_date"]),
            "end": (_date.fromisoformat(t["end_date"]) if t["end_date"]
                    else _date(9999, 12, 31)),
            "rate": t["fee_rate"], "name": t.get("period_name"),
            "basis": t.get("calculation_base"),
        })

    def period_on(uid, d):
        for p in schedules.get(uid, []):
            if p["start"] <= d <= p["end"]:
                return p
        return None

    return schedules, period_on


def _infer_committed(entries, period_on, fund_uuids, ytd_year):
    """fund_uuid -> committed capital, back-solved from a posted fee.

    Size the fund off the fee it bills repeatedly, not off its latest
    entry: a quarter in progress posts a stub, a catch-up a multiple.
    """
    committed = {}
    for uid in fund_uuids:
        by_rate = {}
        for e in sorted((e for e in entries
                         if e["fund_uuid"] == uid and e["amount"] > 0),
                        key=lambda e: (e["yr"], e["mo"])):
            p = period_on(uid, _date(e["yr"], e["mo"], 15))
            if p and p["rate"] > 0:
                by_rate.setdefault(p["rate"], []).append(round(e["amount"], 2))
        # Prefer the rate in force now; fall back to any rate with history.
        rate_now = (period_on(uid, _date(ytd_year, 7, 1)) or {}).get("rate")
        rate = rate_now if rate_now in by_rate else next(iter(by_rate), None)
        if rate:
            amounts = by_rate[rate]
            modal = max(amounts, key=lambda a: (amounts.count(a),
                                                amounts.index(a)))
            committed[uid] = modal / (rate / 4)
    return committed


def _quarter_estimate(period_on, uid, cap, yr, q):
    """What the schedule says one quarter is worth, or None if uncovered."""
    start = _date(yr, 3 * (q - 1) + 1, 1)
    end = _date(yr, 3 * q, _QUARTER_LAST_DAY[q])
    p = period_on(uid, start) or period_on(uid, end)
    if not p or not p["rate"]:
        return None
    return p, round(cap * p["rate"] / 4, 2)


def _allocate_manco_fees(manco_entries, fee_schedule_terms, fund_uuids,
                         ytd_year, committed_entries, years=()):
    """Split the ManCo's booked fee income across the funds it billed.

    The booked dollars are always the amount; the schedule only decides
    whose they were, for a line that does not name its fund. So a year
    totals what the ManCo booked, even where it cannot say per fund.
    """
    _, period_on = _fund_schedules(fee_schedule_terms)
    committed = _infer_committed(committed_entries, period_on,
                                 fund_uuids, ytd_year)

    by_fund_year, unlinked, booked_quarters, unattributed = {}, {}, set(), {}
    conversions = {}
    # Which quarters a fund's share was split out of, and on what terms —
    # the only account of a year the ManCo booked without naming the fund.
    detail = {}
    for e in manco_entries:
        q = (e["mo"] - 1) // 3 + 1
        key = (e["fund_uuid"], e["yr"])
        if e["fund_uuid"]:
            by_fund_year[key] = by_fund_year.get(key, 0.0) + e["amount"]
            if e["amount"] > 0:
                booked_quarters.add((e["fund_uuid"], e["yr"], q))
        else:
            unlinked[(e["yr"], q)] = unlinked.get((e["yr"], q), 0.0) + e["amount"]

    for (yr, q), amt in unlinked.items():
        if not amt:
            continue
        # An onboarding entry holds every pre-Carta year on one date. It
        # is not that quarter's income, and it dwarfs the chart.
        scheduled = 0.0
        for uid in fund_uuids:
            cap = committed.get(uid)
            if not cap:
                continue
            est = _quarter_estimate(period_on, uid, cap, yr, q)
            if est:
                scheduled += est[1]
        if scheduled > 0 and amt > CONVERSION_MULTIPLE * scheduled:
            conversions[yr] = conversions.get(yr, 0.0) + amt
            continue
        # Neither the line nor its description says whose this was.
        # Spreading it across the funds by schedule would put a figure
        # under a fund's name that nothing attributes to it.
        unattributed[yr] = unattributed.get(yr, 0.0) + amt

    # A year the ManCo booked nothing for at all — its books start later
    # than the chart does. The schedule is the only account of it.
    booked_years = ({e["yr"] for e in manco_entries if e["amount"]}
                    - set(conversions))
    for yr in years:
        if yr in booked_years or yr >= ytd_year:
            continue
        for uid in fund_uuids:
            cap = committed.get(uid)
            if not cap:
                continue
            for q in (1, 2, 3, 4):
                est = _quarter_estimate(period_on, uid, cap, yr, q)
                if not est:
                    continue
                p, amount = est
                by_fund_year[(uid, yr)] = by_fund_year.get((uid, yr), 0.0) + amount
                detail.setdefault((uid, yr), []).append({
                    "quarterLabel": f"Q{q} {yr}",
                    "periodName": p["name"],
                    "startDate": _date(yr, 3 * (q - 1) + 1, 1).isoformat(),
                    "endDate": _date(yr, 3 * q, _QUARTER_LAST_DAY[q]).isoformat(),
                    "feeRate": p["rate"],
                    "basis": p["basis"],
                    "amount": amount,
                })

    for quarters in detail.values():
        quarters.sort(key=lambda x: x["quarterLabel"])
    return by_fund_year, booked_quarters, unattributed, detail, conversions


def _expected_remaining_this_year(fund_fee_entries, fee_schedule_terms, top_fund_uuids,
                                  display_name_by_uuid, ytd_year,
                                  booked_quarters=None):
    """What each fund's schedule still expects this year, by quarter.

    The YTD bar reports what posted. A fund billing quarterly has quarters
    of the current year still to come, and the schedule already says what
    they are -- without them the year reads as a shortfall against every
    prior one, and the drawer answers "what happened" where the reader is
    asking "what is still coming".

    A quarter counts as remaining when the fund's schedule covers it at a
    live rate and no fee has posted for it this year. The schedule, not the
    billing history -- the fee entries this builder reads are clipped to the
    as-of month so that each year compares like for like year to date, which
    means a quarter later in the year than the as-of date is absent from
    *every* year in the dataset. A history rule reading those entries could
    never predict such a quarter for any fund, and would under-claim by a
    quarter for all of them. The schedule has no such blind spot.
    """
    if not fee_schedule_terms:
        return []
    _, period_on = _fund_schedules(fee_schedule_terms)
    committed = _infer_committed(fund_fee_entries, period_on,
                                 top_fund_uuids, ytd_year)

    out = []
    for uid in top_fund_uuids:
        cap = committed.get(uid)
        name = display_name_by_uuid.get(uid)
        if not cap or not name:
            continue
        # Any posting marks the quarter billed, so a part-booked quarter is
        # not topped up. The quarter-end review and lock settles it.
        if booked_quarters is not None:
            posted = {q for (u, y, q) in booked_quarters
                      if u == uid and y == ytd_year}
        else:
            posted = {(e["mo"] - 1) // 3 + 1 for e in fund_fee_entries
                      if e["fund_uuid"] == uid and e["yr"] == ytd_year
                      and e["amount"] > 0}
        quarters = []
        for q in sorted({1, 2, 3, 4} - posted):
            est = _quarter_estimate(period_on, uid, cap, ytd_year, q)
            if not est:
                continue
            p, amount = est
            quarters.append({
                "quarterLabel": f"Q{q} {ytd_year}",
                "periodName": p["name"],
                "startDate": _date(ytd_year, 3 * (q - 1) + 1, 1).isoformat(),
                "endDate": _date(ytd_year, 3 * q, _QUARTER_LAST_DAY[q]).isoformat(),
                "feeRate": p["rate"],
                "basis": p["basis"],
                "amount": amount,
            })
        if quarters:
            out.append({
                "name": name,
                "committedCapital": round(cap),
                "amount": round(sum(q["amount"] for q in quarters), 2),
                "quarters": quarters,
            })
    return out


_QUARTER_LAST_DAY = {1: 31, 2: 30, 3: 30, 4: 31}


# How far past a quarter's scheduled fees an unattributed entry may run
# before it is read as an onboarding balance rather than that quarter's
# income.
CONVERSION_MULTIPLE = 3


def read_fund_attribution(dashboard_dir):
    """Operator overrides for which fund a fee line's memo names.

    Shares `budget-mapping.json` with `read_budget_mapping`, under its own
    top-level key so the two never collide:

        {"fund_attribution": {"by_id":   {"<gluuid or id>": {"fund": "<fund_uuid>", ...}},
                               "by_memo": {"<memo text, exact>": {"fund": "<fund_uuid>", ...}}}}

    Each answer is returned as its fund uuid alone.

    `infer_fund_from_memo` reads a memo; it does not read an operator's
    mind. A tie it can't break, or a memo it can't parse at all, is
    answered here instead of by hand-editing the raw fetch — that hand
    edit is invisible on the next rebuild, this is not. `by_id` forces one
    journal entry; `by_memo` forces every entry carrying that exact
    description, which is how one wording shared by many lines (a
    migrated year, a lump transfer) is fixed in a single answer.
    """
    mapping = _read_mapping_or_empty(dashboard_dir)

    def funds(by):
        return {k: fund_answer(v).get("fund")
                for k, v in mapping_section(mapping, ("fund_attribution", by)).items()}

    return {"by_id": funds("by_id"), "by_memo": funds("by_memo")}


def fund_answer(value):
    """A fund_attribution answer as a dict: record_mapping.py writes
    `{"fund": uuid, "source": …}`; a hand-written one is the bare uuid."""
    return value if isinstance(value, dict) else {"fund": value}


def resolve_fund_attribution(row, candidates, overrides):
    """Which fund a fee line names: an operator's override first, else its
    memo.

    The single place `_named_fund` and `_manco_fund` both call, so the
    override and the memo tie-break never drift into two answers for the
    same line.
    """
    by_id = (overrides or {}).get("by_id") or {}
    by_memo = (overrides or {}).get("by_memo") or {}
    names = dict(candidates)
    key = row.get("gluuid") or row.get("id")
    if key is not None and str(key) in by_id:
        uuid = by_id[str(key)]
        return uuid, names.get(uuid)
    descr = row.get("descr")
    if descr and descr in by_memo:
        uuid = by_memo[descr]
        return uuid, names.get(uuid)
    return infer_fund_from_memo(descr, candidates)


def rehome_fee_rows_to_manco(rows, manco_fee_accounts, foreign_fee_accounts,
                             unmatched_foreign=()):
    """Point a fee row at the ManCo's own fee account, never a fund's.

    This report is the ManCo's. A mapping that sends one of its lines to
    an account on a fund's ledger makes the fund's books answer for the
    ManCo's, so the figure and its journals belong to another entity.

    An account in `unmatched_foreign` has no counterpart on the ManCo at
    all — a waiver it nets inside fee income rather than booking beside
    it. There is no sound rewrite for that, so the row is left for the
    operator to decide in the mapping step.
    """
    if not manco_fee_accounts:
        return []
    notes = []
    for row in rows:
        gl = row.get("gl_codes") or []
        foreign = [g for g in gl if g in foreign_fee_accounts]
        if not foreign:
            continue
        orphan = [g for g in foreign if g in unmatched_foreign]
        if orphan:
            # Answered already? Honour it. Otherwise ask.
            if row.get("fee_source") == "fund_ledger":
                row["cross_entity_gl"] = orphan
                notes.append(
                    f"{row.get('label') or row.get('addr')}: reporting "
                    f"{orphan} from the funds' ledger, as recorded.")
            elif row.get("fee_source") == "omit":
                row["gl_codes"] = sorted(set(gl) - set(orphan))
                row["no_manco_equivalent"] = orphan
            else:
                row["fee_offset_unresolved"] = orphan
            continue
        row["gl_codes"] = sorted(set(gl) - set(foreign) | set(manco_fee_accounts))
        row["rehomed_from"] = foreign
        notes.append(
            f"{row.get('label') or row.get('addr')}: fee mapping pointed at "
            f"{foreign} on a fund's ledger; reporting the ManCo's "
            f"{sorted(manco_fee_accounts)} instead."
        )
    return notes


def fee_offset_asks(rows, manco_fee_accounts):
    """The offsets the ManCo books no account for, as mapping questions.

    A workbook can break a fee into gross and waiver where the ManCo
    records only the net. Neither answer is ours to pick: leaving it out
    understates a line the reader can see in their own workbook, and
    filling it from the funds reports another entity's books here.
    """
    out = []
    for row in rows or []:
        orphan = row.get("fee_offset_unresolved")
        if not orphan:
            continue
        out.append({
            "key": row.get("key"), "addr": row.get("addr"),
            "label": row.get("label"), "needs": "fee_offset",
            "hint": f"{orphan} on the funds' ledger",
            "suggestions": [
                {"value": "omit", "label": "Leave out — the ManCo nets it "
                 f"into {sorted(manco_fee_accounts)}",
                 "why": "the fee line above already reports it net"},
                {"value": "fund_ledger",
                 "label": f"Report {orphan} from the funds' ledger",
                 "why": "the only place the offset is booked separately"},
            ],
        })
    return out


def suggest_funds(label, fund_names, limit=4):
    """Funds a budget line might mean — proposed, never applied.

    A workbook writes a fund as briefly as its own readers need, and often
    abbreviates: a short form for a longer fund name. Neither the token
    match nor its subset relaxation reaches that, so these lines arrive at
    the gate with nothing offered and are answered by hand every time.

    Prefixes count here and nowhere else. A proposal a person confirms can
    afford to be generous; the automatic match cannot.
    """
    want = {t for t, _ in _fund_match_tokens(label)}
    if not want:
        return []
    out = []
    for name in fund_names or []:
        have = {t for t, _ in _fund_match_tokens(name)}
        if not have:
            continue
        if want <= have:
            out.append((0, name))
            continue
        # Every word of the line is at least the start of one of the
        # fund's — "opp" for "opportunity", never "opportunity" for "opp".
        if all(any(h.startswith(w) for h in have) for w in want):
            out.append((1, name))
    out.sort(key=lambda x: (x[0], x[1]))
    return [{"fund": n, "why": ("names the fund" if r == 0 else "abbreviates it")}
            for r, n in out[:limit]]


_MONTH_Q = {m: (m - 1) // 3 + 1 for m in range(1, 13)}


def fund_quarter_totals(fund_fee_entries, year):
    """What each fund posted, by account and quarter, in one year.

        {fund: {acct_type: {"name": str, "q": {1: total, ...}}}}
    """
    out = {}
    for e in fund_fee_entries or []:
        fund, acct, mo = e.get("fund"), e.get("acct_type"), e.get("mo")
        if not fund or acct is None or mo not in _MONTH_Q:
            continue
        if year and int(e.get("yr") or 0) != int(year):
            continue
        slot = out.setdefault(fund, {}).setdefault(
            acct, {"name": e.get("account") or str(acct), "q": {}})
        slot["q"][_MONTH_Q[mo]] = slot["q"].get(_MONTH_Q[mo], 0.0) + float(e.get("amount") or 0)
    return out


def propose_fund_account(row, accounts):
    """Which half of a fund's fee a line means, judged on the money.

    A workbook's wording does not say whether a line is the fee, the
    offset against it, or the net of both — but its budget does. Compared
    over the quarters that carry postings, the right half matches and the
    others are out by multiples.

    Returns the nearest candidate, or None when two are equally near.
    """
    if not accounts:
        return None
    posted = sorted({q for a in accounts.values() for q in a["q"]})
    if not posted:
        return None
    monthly = row.get("monthly") or []
    if len(monthly) < 12:
        return None
    budget = abs(sum(float(monthly[m - 1] or 0)
                     for q in posted for m in range(q * 3 - 2, q * 3 + 1)))
    if not budget:
        return None
    cands = [{"gl_codes": [gl], "label": a["name"],
              "total": abs(sum(a["q"].get(q, 0.0) for q in posted))}
             for gl, a in sorted(accounts.items())]
    if len(cands) > 1:
        cands.append({"gl_codes": [], "label": "net of all of them",
                      "total": abs(sum(a["q"].get(q, 0.0)
                                       for a in accounts.values() for q in posted))})
    cands.sort(key=lambda c: abs(c["total"] - budget))
    best = cands[0]
    runner = cands[1] if len(cands) > 1 else None
    off = abs(best["total"] - budget)
    if runner and abs(runner["total"] - budget) <= off * 2:
        return None        # two halves equally near: the money does not say
    return {"gl_codes": best["gl_codes"], "label": best["label"],
            "why": ("matches this line's budget over the quarters posted"
                    if off <= 0.01 * budget else "nearest this line's budget")}


def funds_reported_twice(rows, fund_accounts=None):
    """Funds a budget names in more than one section.

    Both lines resolve from the same journal entries, so both report the
    same money — unless each names the account it means. A firm's fees and
    the offsets against them are separate Carta accounts, and a budget that
    lists a fund twice is usually separating exactly those.

    Two lines landing on the SAME account is the same double count as two
    naming none, so both are asked about. An answer only settles the pair
    when the accounts it gives them differ.

    Returns one entry per (fund, row) needing an account, with the accounts
    that fund actually posts to as the candidates. An account another line
    of the same fund already holds alone is not offered again.
    """
    by_fund = {}
    for row in rows or []:
        f = row.get("fund_match")
        if f:
            by_fund.setdefault(f, []).append(row)
    out = []
    for fund, lines in by_fund.items():
        if len(lines) < 2:
            continue
        accounts = sorted((fund_accounts or {}).get(fund, {}).items())
        if len(accounts) < 2:
            continue        # nothing to tell the two lines apart with
        claims = {}
        for row in lines:
            claims.setdefault(tuple(sorted(row.get("gl_codes") or [])), []).append(row)
        settled = {gl for claim, rs in claims.items() if len(rs) == 1 for gl in claim}
        for claim, dupes in claims.items():
            if len(dupes) < 2:
                continue
            free = [(gl, name) for gl, name in accounts if gl not in settled]
            for row in dupes:
                out.append({
                    "addr": row.get("addr"), "label": row.get("label"),
                    "section": row.get("subsection") or row.get("section"),
                    "fund": fund, "needs": "fund_account",
                    "reported_twice": bool(claim),
                    # Naming none of them is the fund's net, and a workbook
                    # reporting a fee net of its offset means that.
                    "suggestions": [{"gl": gl, "name": name,
                                     "why": "an account this fund posts to"}
                                    for gl, name in (free or accounts)]
                    + [{"gl_codes": [], "label": "net of all of them",
                        "why": "the fee less its offset"}],
                })
    return out


_FUND_LEGAL_SUFFIX_RX = re.compile(
    r",?\s*\(?(LLC|L\.L\.C\.|LP|L\.P\.|Ltd\.?|Inc\.?|Corp\.?)\)?\.?\s*$", re.IGNORECASE
)


# Generic PE/VC/accounting vocabulary that never distinguishes one fund from
# another — stripped from both sides before comparing. A GL code prefixing a
# budget line ("4002 - Fund II Mgmt Fee") isn't a word at all; digit tokens
# get the same treatment in `_fund_match_tokens`.
_FUND_FILLER_WORDS = {"fund", "funds", "ventures", "capital", "partners",
                       "management", "mgmt", "fee", "fees", "net", "income",
                       "co", "company", "the", "group"}


def _fund_match_tokens(name):
    """Order-independent token signature for fuzzy fund-name matching.

    Counts, not a plain set: a fund lettered "A" with annex "A-A" tokenizes
    to ["a"] vs ["a", "a"] — a plain set would collapse both to {a}.
    """
    s = _FUND_LEGAL_SUFFIX_RX.sub("", name or "")
    toks = [t for t in re.findall(r"[a-z0-9]+", s.lower())
            if t not in _FUND_FILLER_WORDS and not t.isdigit()]
    return tuple(sorted(Counter(toks).items()))


def backfill_fund_match_from_roster(rows, fund_names):
    """Resolve an outline income line naming a related fund (e.g. "Fund II")
    to that fund's real Carta name, so the UI can join it to
    accounts.json's fund_fee_entries — see pnl_outline.py's docstring on
    why a ManCo's own aggregate mgmt-fee GL can't be split per fund.

    No firm-specific pattern is hardcoded: a firm's own shorthand is matched
    against its ACTUAL fund roster (`fund_names`, from Carta journal
    entries) by normalized token set (`_fund_match_tokens`), not a guessed
    "Fund <roman numeral>" phrasing. A match is only accepted when exactly
    one real fund reduces to the row's token set — ambiguous or absent
    matches are left alone rather than guessed.

    Returns the number of rows backfilled, for the build's stderr summary.
    """
    by_tokens = defaultdict(set)
    for name in fund_names:
        toks = _fund_match_tokens(name)
        if toks:
            by_tokens[toks].add(name)

    backfilled = 0
    for row in rows:
        if (row.get("row_kind") != "line" or row.get("section") != SECTION_INCOME
                or row.get("fund_match")):
            continue
        toks = _fund_match_tokens(row.get("label"))
        if not toks:
            continue
        matches = by_tokens.get(toks)
        if not matches:
            # A workbook names a fund as briefly as its own readers need
            # ("Fund II"), where Carta carries the firm's name too. Accept
            # the row's tokens sitting inside exactly one fund's.
            # set(), not `<` on the tuples themselves: that compares them
            # lexicographically, and "Fund II" reads as less than every
            # fund, so every row looked ambiguous.
            want = set(toks)
            matches = {n for t, names in by_tokens.items() if want < set(t)
                       for n in names}
        if not matches or len(matches) != 1:
            continue  # no fund, or several fit — don't guess
        row["fund_match"] = next(iter(matches))
        backfilled += 1
    return backfilled

