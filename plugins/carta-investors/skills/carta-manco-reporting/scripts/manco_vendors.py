#!/usr/bin/env python3
"""manco_vendors.py — carta-manco-reporting's vendor spend: the operator's
recorded vendor-name inferences (read_vendor_config, apply_vendor_inferences),
grouping an employee's reimbursement entries under one vendor label
(group_reimbursements), and the biggest-spend-first vendor breakout the
dashboard's expense page charts (build_vendor_spend).
"""

import json
from pathlib import Path

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

