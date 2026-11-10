#!/usr/bin/env python3
"""manco_variance.py — carta-manco-reporting's budget-vs-actuals variance:
Carta's own per-account variance rows (variance_payload), and ranking a
workbook budget's categories by how far their actuals missed plan
(build_variance_categories), resolving which scope wins when two budget
lines both claim a shared entry (_variance_claim_specificity,
_resolve_variance_claim_conflicts).
"""

from manco_budgets import _MONTH_ABBR, _budget_window
from manco_dimensions import dimension_value_of, has_dimension_values
from manco_labels import is_income_section

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

