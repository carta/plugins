#!/usr/bin/env python3
"""manco_dimensions.py — carta-manco-reporting's dimension and scope matching:
censusing a firm's reporting-tag/sub-account/vendor values, resolving which
dimension a budget's columns are scoped by, claiming a dimension value's
spend onto the budget line that names it (and reading back the client's
confirm/reject answer on a wording-derived match), the residual an unclaimed
section still reports, and scoring how well a budget line's own wording
matches a census value it did not state outright (resolve_near_scopes).
"""

from collections import Counter

from manco_labels import _label_tokens, _norm_label
from manco_mapping_store import CONFIRMED, REJECTED, _read_mapping_or_empty, mapping_section

# What a budget's columns can be scoped by. Columns are either a period
# (handled by the period machinery, not here) or a reporting-tag value —
# which category is the firm's own choice, never assumed.
#
# sub_account and vendor resolve here too, but as a deeper breakout WITHIN
# a GL account row, not as a column axis.
DIMENSION_SOURCES = ("reporting_tag", "sub_account", "vendor", "account")


COLUMN_DIMENSION_SOURCES = ("reporting_tag",)


# A row breaks out by anything on the entry — the reader's question, not
# the budget's. All four are censused so the UI can switch without a rebuild.
ROW_DIMENSION_SOURCES = DIMENSION_SOURCES


def dimension_value_of(entry, dimension):
    """The entry's value for the configured dimension, or None.

    One reader for every scoping site, so adding a source never means
    hunting for the places that reach into `tags` directly.
    """
    if not dimension:
        return None
    source = dimension.get("source") or "reporting_tag"
    if source == "reporting_tag":
        category = dimension.get("category")
        if not category:
            return None
        for t in (entry.get("tags") or []):
            if t.get("category") == category:
                return t.get("value")
        return None
    if source == "sub_account":
        return (entry.get("sub") or None)
    if source == "vendor":
        return (entry.get("vendor") or None)
    if source == "account":
        return (entry.get("account") or None)
    return None


def has_dimension_values(entries, dimension):
    """True when any entry carries a value for this dimension.

    False means scoped rows must report firm-wide; scoping against a field
    the firm never populates shows every column as $0, which reads as spend
    that never happened.
    """
    return any(dimension_value_of(e, dimension) for e in (entries or []))


def has_tag_category(entries, category):
    """True when at least one JE carries this REPORTING_TAGS_JSON category.

    False means the firm never tagged with it, so every scoped actual would
    read $0 — which is not the same claim as "they spent nothing".
    """
    return any(x.get("category") == category
               for e in (entries or []) for x in (e.get("tags") or []))


def dimension_census(entries, sources=COLUMN_DIMENSION_SOURCES, values_limit=25):
    """Dimensions this firm could break a budget out by, with their values.

    Defaults to what can be a column: a reporting-tag category, whichever
    the firm uses. Pass more sources to census a row-level breakout.
    Ordered by spend so the likeliest axis leads.
    """
    buckets = {}

    def add(key, dim, value, amt, kind):
        b = buckets.setdefault(key, {**dim, "entries": 0, "amount": 0.0, "_vals": {}})
        b["entries"] += 1
        b["amount"] += amt
        v = b["_vals"].setdefault(value, {"amount": 0.0, "expense": 0.0, "income": 0.0})
        v["amount"] += amt
        # A tag is used on both sides of the P&L — one firm tags a sponsored
        # event's costs and the sponsorship income alike. Added together
        # they read as spend twice the size of the real figure.
        if kind in ("expense", "income"):
            v[kind] += amt

    for e in (entries or []):
        amt = abs(float(e.get("amount") or 0))
        kind = e.get("kind")
        for t in ((e.get("tags") or []) if "reporting_tag" in sources else []):
            cat, val = t.get("category"), t.get("value")
            if cat and val:
                add(f"reporting_tag:{cat}",
                    {"source": "reporting_tag", "category": cat, "label": cat},
                    val, amt, kind)
        if "sub_account" in sources and e.get("sub"):
            add("sub_account", {"source": "sub_account", "label": "Sub-account"},
                e["sub"], amt, kind)
        if "vendor" in sources and e.get("vendor"):
            add("vendor", {"source": "vendor", "label": "Vendor"},
                e["vendor"], amt, kind)
        if "account" in sources and e.get("account"):
            add("account", {"source": "account", "label": "GL account"},
                e["account"], amt, kind)

    out = []
    for b in buckets.values():
        vals = sorted(b.pop("_vals").items(), key=lambda kv: -kv[1]["amount"])
        out.append({**b, "amount": round(b["amount"]), "value_count": len(vals),
                    "values": [{"value": v, "amount": round(a["amount"]),
                                "expense": round(a["expense"]),
                                "income": round(a["income"])}
                              for v, a in (vals if values_limit is None else vals[:values_limit])]})
    if "sub_account" in sources and "account" in sources:
        nested = sub_accounts_nest(entries)
        for b in out:
            if b["source"] == "account":
                b["with_sub"] = nested
            elif b["source"] == "sub_account":
                b["nested"] = nested
    return sorted(out, key=lambda b: -b["amount"])


def sub_accounts_nest(entries):
    """Whether every sub-account this firm uses sits under one GL account.

    Carta's chart of accounts hangs a sub-account off an account, so the
    account breakout can name both and the sub-account stops being its own
    question. The warehouse states no such parent, only a code per line —
    so a firm that books one sub under two accounts keeps them separate.
    """
    seen = {}
    for e in (entries or []):
        sub, acct = e.get("sub"), e.get("account")
        if not sub or not acct:
            continue
        if seen.setdefault(sub, acct) != acct:
            return False
    return bool(seen)


# One heading matching a category's values is a coincidence; a majority of
# them is the workbook telling us which category it separates its figures by.
COLUMN_MATCH_MIN = 2


COLUMN_MATCH_RATIO = 0.5


def column_headings(budgets):
    """The headings a crosstab budget separates its columns by.

    The firm total is dropped: every workbook has one, under one name or
    another, and it belongs to no category.
    """
    out = []
    for b in budgets or []:
        for v in b.get("tag_values") or []:
            if _norm_label(v) and "total" not in _norm_label(v):
                out.append(v)
    return out


def dimension_matching_columns(census, labels):
    """The category whose values ARE these column headings, or None.

    A workbook that names its columns after a category's values has said
    which category it means, more directly than any count of how many
    categories the firm keeps. Two categories fitting equally well is a
    question, not an answer, and returns None for the ingest to ask.
    """
    if not labels:
        return None
    ranked = rank_tag_categories(census, labels)
    if not ranked:
        return None
    top = ranked[0]
    if top["match_count"] < COLUMN_MATCH_MIN or top["match_ratio"] < COLUMN_MATCH_RATIO:
        return None
    if len(ranked) > 1 and ranked[1]["match_count"] >= top["match_count"]:
        return None
    return {k: top[k] for k in ("source", "category") if top.get(k)}


def resolve_dimension(configured, census, labels=None):
    """Which dimension scopes this budget — from evidence, never a default.

    A recorded choice wins. Failing that, a workbook whose column headings
    are one category's values has named that category. Failing that, a firm
    using exactly one dimension has already answered. Anything else is
    ambiguous and returns None, which scopes nothing rather than guessing
    an axis.
    """
    if configured:
        return configured
    matched = dimension_matching_columns(census, labels)
    if matched:
        return matched
    if len(census) == 1:
        c = census[0]
        return {k: c[k] for k in ("source", "category") if c.get(k)}
    return None


def resolve_tag_category(configured, census):
    """Which category scopes this budget — from evidence, never a default.

    An explicit choice recorded at ingest wins. Failing that, a firm using
    exactly one category has already answered: there is nothing to choose
    between. More than one is genuinely ambiguous and returns None, which
    scopes nothing rather than guessing a dimension and reporting another
    firm's convention as this firm's numbers.
    """
    if configured:
        return configured
    if len(census) == 1:
        return census[0]["category"]
    return None


def rank_dimensions(census, labels):
    """Rank dimensions by how well their values match a workbook's columns.

    Works on whatever the census holds — a reporting-tag category today,
    a row-level breakout when one is censused — because the evidence is
    the same either way: the values look like the headings.
    """
    return rank_tag_categories(census, labels)


def rank_tag_categories(census, labels):
    """Rank categories by how well their values match a workbook's columns.

    The evidence that a category is the one a budget breaks out by is that
    its values look like the column headings. Nothing else in the data
    says so, so this scores the overlap and the ingest asks — it never
    picks on its own.
    """
    want = {_norm_label(x) for x in (labels or []) if _norm_label(x)}
    out = []
    for c in census:
        vals = {_norm_label(v["value"]) for v in c.get("values") or []}
        hit = want & vals
        out.append({**c, "matched": sorted(hit),
                    "match_count": len(hit),
                    "match_ratio": (len(hit) / len(want)) if want else 0.0})
    return sorted(out, key=lambda c: (-c["match_count"], -c["amount"]))


# A GL account is not claimable: every entry carries one, so a line named
# after an account would claim spend the whole budget shares.
CLAIMABLE_SOURCES = ("reporting_tag", "sub_account", "vendor")


def claimable_index(census):
    """The firm's own dimension values, by normalized name.

    A name two dimensions share (a vendor also kept as a sub-account) is
    dropped: it identifies neither, and picking one moves money on a
    coin-flip.
    """
    by_norm = {}
    for dim in census or []:
        if dim.get("source") not in CLAIMABLE_SOURCES:
            continue
        for v in dim.get("values") or []:
            norm = _norm_label(v.get("value"))
            if not norm:
                continue
            by_norm.setdefault(norm, []).append({
                "source": dim["source"],
                "category": dim.get("category"),
                "value": v["value"],
            })
    return {n: c[0] for n, c in by_norm.items() if len(c) == 1}


def row_side(row):
    """Which side of the P&L a budget row reports, income or expense."""
    if (row.get("section") or "").strip().lower() == "income":
        return "income"
    gls = row.get("gl_codes") or []
    if gls and all(4000 <= g < 5000 for g in gls):
        return "income"
    return "expense"


# A value read off a line's own wording, rather than stated by the workbook
# in a column of its own. TAG_VALUE is the crosstab's own column: the firm
# wrote the value there, so an exact match on it is not an inference. A
# near match on it (resolve_near_scopes) is: the firm wrote a different
# string. An outline line's
# tag_value is a copy of the heading above it, and is matched as that
# heading — a "subsection" inference (see claim_dimension_values).
INFERRED_FROM = ("sub_account", "vendor", "label", "subsection", "section")


# The fields that are a heading the line sits under, not the line itself.
# A value that names nothing never matches one: the heading "Professional
# Expenses" is not a vendor called "Expenses". See _names_nothing.
HEADING_FIELDS = ("subsection", "section")


def _names_nothing(value, account_words):
    """Whether a firm value is made only of words that identify nothing.

    Filler ("Expenses", "Other") identifies nothing whatever the source. A
    vendor or sub-account named only in Carta's account words ("Other
    Income", "Bank Charges") is a bookkeeping catch-all. A reporting-tag
    value named like an account ("Marketing") is a cost centre the firm set
    up to slice its spend, so account words don't count against it.
    """
    return not _meaningful_words(value, account_words)


def _meaningful_words(value, account_words):
    """The words of a firm value that identify something — its own wording
    less filler, and less Carta's account words unless it is a reporting
    tag (a cost centre named like an account is still a cost centre)."""
    dead = SCOPE_STOPWORDS
    if value["source"] != "reporting_tag":
        dead = dead | (account_words or set())
    return _label_tokens(value["value"]) - dead


def inference_key(scope, field):
    """One question, however many lines it touches.

    Keyed on what the inference SAYS — this wording means this value — so a
    firm with forty lines under one heading answers once, and a line added
    next quarter inherits the answer instead of reopening it.
    """
    return "|".join([field, scope["source"], scope.get("category") or "", scope["value"]])


def _decided(decisions, scope, field):
    """The client's answer for `scope` read off `field`: "confirmed",
    "rejected", or None when nobody has been asked."""
    return (decisions or {}).get(inference_key(scope, field), {}).get("status")


def _rejected(decisions, scope, field):
    return _decided(decisions, scope, field) == REJECTED


def _confirmed(decisions, scope, field):
    return _decided(decisions, scope, field) == CONFIRMED


def _inference(scope, field, row):
    """What a line's wording was read as: one Step 4.7 question."""
    return {**scope, "field": field, "key": inference_key(scope, field),
            "label": row.get("label")}


def _rows_with_heading(rows):
    """Each row with the label of the subsection header it sits under, or
    None. A shared report's rows arrive without `subsection`, so sitting
    under a header row is how a line's copied heading is recognised there
    (see _copied_heading)."""
    heading = None
    for row in rows or []:
        kind = str(row.get("row_kind") or "")
        if kind == "subsection_header":
            heading = row.get("label")
        elif kind == "section_header":
            heading = None
        yield row, heading


def _copied_heading(row, heading):
    """Whether `row`'s tag_value is the heading above it copied down, not a
    column the firm filled in. Only pnl_outline emits subsection headers,
    it always copies the subsection onto its lines' tag_value, and that
    copy is the mapped name, which need not read like the header's own
    wording ("Prof. Exp."). A crosstab's stated column never has a
    subsection header above it."""
    return bool(row.get("tag_value")) and (row["tag_value"] == row.get("subsection")
                                           or heading is not None)


def read_inference_decisions(dashboard_dir):
    """What the client said about values read off their own wording.

        {"inferences": {"label|reporting_tag|Cost center|Marketing":
                        {"status": "rejected"}}}

    Confirmed is not asked again; rejected is not applied again. Absent
    means nobody has been asked yet.
    """
    return mapping_section(_read_mapping_or_empty(dashboard_dir), ("inferences",))


def claim_dimension_values(rows, census, aliases=None, account_names=None,
                           decisions=None):
    """Mark budget rows that report one of the firm's own dimension values.

    A section given to a value reports that spend there, so a line elsewhere
    over the same accounts is the remainder, not the whole firm. Sections
    are named for a tag, a sub-account or a vendor depending on the firm, so
    all three are matched. A partial hit is left alone: a wrong claim moves
    real money to the wrong line.
    """
    by_norm = claimable_index(census)
    account_words = generic_scope_words(account_names)
    # The client's own mapping file already states what their wording means
    # in Carta's terms. Reading it beats asking them the same question.
    alias_norm = {}
    for wording, values in (aliases or {}).items():
        vals = [v for v in (values or []) if _norm_label(v) in by_norm]
        if len(vals) == 1:
            alias_norm[_norm_label(wording)] = by_norm[_norm_label(vals[0])]

    def resolve(text, heading=False):
        norm = _norm_label(text)
        if not norm:
            return None
        if norm in by_norm:
            hit = by_norm[norm]
        elif norm in alias_norm:
            return alias_norm[norm]     # the client's own mapping file says so
        else:
            toks = _label_tokens(text)
            cands = [c for n, c in by_norm.items() if _label_tokens(n) <= toks]
            # Two values both inside one label names neither.
            hit = cands[0] if len(cands) == 1 else None
        if hit and heading and _names_nothing(hit, account_words):
            return None
        return hit

    # The words each Carta account name is made of. A label that adds nothing
    # to one of them names that account, however the firm abbreviates it.
    account_tokens = [_label_tokens(n) for n in (account_names or {}).values()]
    account_tokens = [t for t in account_tokens if t]

    claims = []
    for row, heading in _rows_with_heading(rows):
        kind = str(row.get("row_kind") or "")
        # A label that names a Carta account is that account, not a slice of
        # one. Matched on the label adding nothing of its own, rather than on
        # the two strings being equal: a firm writes "Marketing" for the
        # account Carta calls "Marketing expenses", and read as a cost centre
        # of the same name it reported one value of an account that spans
        # several. A label that DOES add something — "Rent - <office>" over
        # the account "Rent" — is naming a slice, and still claims it.
        #
        # It disqualifies the LABEL, not the row: these lines sit under a
        # heading that names a department, and a line called "Salaries"
        # under one is still that department's salaries.
        label_toks = _label_tokens(row.get("label"))
        label_is_account = bool(label_toks) and any(
            label_toks <= toks for toks in account_tokens)
        # An answer the client gave outranks anything read off the wording —
        # and is as much a claim as one the wording produced, or the line
        # beside it goes on reporting the same money.
        if row.get("scopes"):
            for sc in row["scopes"]:
                if sc not in claims:
                    claims.append(sc)
            continue
        copied = _copied_heading(row, heading)
        # An explicit "no scope" is an answer too: this line covers its
        # accounts whole, so a copied heading must not go on narrowing it.
        if row.get("scope_none"):
            if copied:
                row.pop("tag_value", None)
            continue
        # Most specific first: a line naming a sub-account or a vendor says
        # more about itself than the heading above it, and it is both at once.
        scopes, sources, inferred = [], set(), []
        rejected_copy = False
        for field, text in (("sub_account", row.get("sub_account")),
                            ("vendor", row.get("vendor")),
                            ("label", row.get("label")),
                            ("tag_value", row.get("tag_value")),
                            ("subsection", row.get("subsection")),
                            ("section", row.get("section"))):
            if field == "label" and label_is_account:
                continue
            # Read a copied heading as the heading it is.
            if field == "tag_value" and copied:
                field = "subsection"
            # A header row's own label is a heading too.
            is_heading = field in HEADING_FIELDS or (field == "label" and kind.endswith("header"))
            hit = resolve(text, heading=is_heading)
            if not hit or hit["source"] in sources:
                continue
            if field in INFERRED_FROM:
                if _rejected(decisions, hit, field):
                    rejected_copy = rejected_copy or (copied and text == row["tag_value"])
                    continue        # the client has already said this is not it
                inferred.append(_inference(hit, field, row))
            sources.add(hit["source"])
            scopes.append(hit)
            if hit not in claims:
                claims.append(hit)
        # Rejected: the line reports its accounts whole, so the copied
        # heading must not narrow it through tag_value either.
        if rejected_copy:
            row.pop("tag_value", None)
        if not scopes:
            continue
        row["scopes"] = scopes
        row["scope"] = scopes[0]
        # Which of them were read off the wording, so the gate can ask.
        if inferred:
            row["scope_inferred"] = inferred
        for sc in scopes:
            # The reporting-tag path predates scopes and carries the
            # workbook-to-Carta aliases; leave it driving that case.
            if sc["source"] == "reporting_tag":
                row["tag_value"] = sc["value"]
    return claims


def apply_dimension_residual(rows, claims, entries=None):
    """Leave a line that reports the remainder reporting only the remainder.

    A claim is subtracted from a line only where that value actually posts
    to the line's own accounts. Without that check a management-fee line
    loses spend from an expense section that shares none of its accounts.

    The report shows what was removed: money that leaves a line without
    saying where it went reads as an error in the line.
    """
    if not claims:
        return
    keyed = [(c, (c["source"], c.get("category"), c["value"])) for c in claims]
    # Which side of the P&L each value is reported on, from the rows that
    # claimed it. A value claimed by expense sections is not reported again
    # by an income line that happens to carry the same tag.
    sides = {}
    for row in rows or []:
        sc = row.get("scope")
        if sc:
            sides.setdefault((sc["source"], sc.get("category"), sc["value"]),
                             set()).add(row_side(row))
    # The accounts the claiming lines actually name. A claim displaces spend
    # only where the line making it reports — a line scoped to a person's
    # travel says nothing about that person's health insurance, which is an
    # account it does not name and another line does.
    claimed_gls = {}
    for row in rows or []:
        for sc in row.get("scopes") or []:
            key = (sc["source"], sc.get("category"), sc["value"])
            claimed_gls.setdefault(key, set()).update(row.get("gl_codes") or [])
    present = None
    if entries is not None:
        present = {}
        for e in entries:
            gl = e.get("acct_type")
            if gl is None:
                continue
            for c, key in keyed:
                if dimension_value_of(e, c) == c["value"]:
                    present.setdefault(gl, set()).add(key)

    for row in rows or []:
        if row.get("scope") or row.get("tag_value"):
            continue
        gls = row.get("gl_codes") or []
        if not gls:
            continue
        # A value claimed by expense sections is not reported again by an
        # income line that happens to carry the same tag.
        side = row_side(row)
        mine = [(c, k) for c, k in keyed
                if side in sides.get(k, {side})
                # No accounts recorded for the claim (another budget's, or a
                # line that never resolved any) leaves it applying firm-wide,
                # as it did before there was anything better to go on.
                and (not claimed_gls.get(k) or claimed_gls[k] & set(gls))]
        if not mine:
            continue
        if present is None:
            row["excluded_claims"] = [c for c, _ in mine]
            continue
        hit = [c for c, key in mine
               if any(key in present.get(g, ()) for g in gls)]
        if hit:
            row["excluded_claims"] = hit


# A budget is broken out BY a dimension when it names a real share of that
# dimension's values — a quarter of them. Below that it is one line borrowing
# one value, and the rest are not questions the budget left open.
MIN_AXIS_SHARE_DENOM = 4


def unclaimed_dimension_values(census, claims):
    """Dimension values with real spend that no budget row accounts for.

    Only within a dimension the budget demonstrably uses. Every vendor a
    firm pays is unclaimed on a budget that never names one, and asking
    about all of them buries the few that are real questions.

    Asked about rather than guessed: a wrong claim silently moves money.
    """
    if not claims:
        return []
    taken = {(c["source"], c.get("category"), c["value"]) for c in claims}
    # An axis, not an exception. A budget that names five of thirteen tags
    # is broken out by tag; one line scoped to one of sixty-six vendors is
    # answering "which of these is that person's", and every other vendor
    # the firm pays is not thereby a question about the budget.
    counts = Counter((c["source"], c.get("category")) for c in claims)
    out = []
    for dim in census or []:
        key = (dim.get("source"), dim.get("category"))
        named = counts.get(key, 0)
        total = dim.get("value_count") or len(dim.get("values") or []) or 1
        if not named or named * MIN_AXIS_SHARE_DENOM < total:
            continue
        for v in dim.get("values") or []:
            key = (dim["source"], dim.get("category"), v["value"])
            if key in taken:
                continue
            out.append({"source": dim["source"], "category": dim.get("category"),
                        "value": v["value"], "amount": v.get("amount"),
                        "expense": v.get("expense"), "income": v.get("income"),
                        "label": dim.get("label")})
    # Ranked by spend: this asks which line reports a value's costs, and a
    # value carrying mostly income would otherwise lead on a figure the
    # question is not about.
    return sorted(out, key=lambda x: -(x.get("expense") or 0))


def tag_census(entries):
    """Every reporting-tag category this firm actually uses, with its values.

    Firms tag for their own reasons — team, office, fund, initiative — and
    the budget breaks out along whichever one they chose. Nothing can be
    assumed, so this reports what is there and lets the ingest ask.
    """
    cats = {}
    for e in (entries or []):
        amt = abs(float(e.get("amount") or 0))
        for t in (e.get("tags") or []):
            cat, val = t.get("category"), t.get("value")
            if not cat or not val:
                continue
            c = cats.setdefault(cat, {"category": cat, "entries": 0,
                                      "amount": 0.0, "_vals": {}})
            c["entries"] += 1
            c["amount"] += amt
            c["_vals"][val] = c["_vals"].get(val, 0.0) + amt
    out = []
    for c in cats.values():
        vals = sorted(c.pop("_vals").items(), key=lambda kv: -kv[1])
        out.append({**c, "amount": round(c["amount"]),
                    "value_count": len(vals),
                    "values": [{"value": v, "amount": round(a)} for v, a in vals[:25]]})
    return sorted(out, key=lambda c: -c["amount"])


# How much of a value's own wording a label has to carry before the value
# is worth proposing. Half means "Atlas Prog" reaches "Atlas Program" on the
# shared word alone; below that, a single common word ("Fund", "Team")
# would propose every value a firm has.
SCOPE_SUGGEST_MIN = 0.5


# Where a near match stops being a proposal and becomes the answer. A
# label carrying the value's own distinctive word AND a shortening of the
# rest ("Atlas Prog" for "Atlas Program") is not a resemblance, it is the
# same name written shorter. Below this, with two values equally close, or
# with no spend on the line's accounts and no confirmation, the line is
# withheld and asked about instead.
SCOPE_AUTO_MIN = 0.75


# Words that carry no identity. "Comp/Salaries (all in)" against "ALL GUD
# THINGS INC" matched on "all" and "in", which says nothing about either.
SCOPE_STOPWORDS = {
    "all", "and", "the", "for", "of", "in", "to", "other", "misc", "total",
    "related", "etc", "inc", "llc", "expenses", "expense", "fees", "fee",
}


# A label saying what it ISN'T is the remainder line, not a claim on the
# value it names. "Non Atlas Related Travel" reports everything the
# program lines don't, and withholding it would blank a legitimate row.
SCOPE_NEGATIONS = {"non", "ex", "excl", "excluding", "exclude", "less", "without"}


def _abbreviates(short, long_):
    """Whether `short` reads as a shortening of `long_` — prog → program.

    Letters in order, nothing skipped at the front. Deliberately loose:
    this only decides what to OFFER, and a wrong offer costs a glance
    while a wrong claim moves real money.
    """
    if len(short) < 2 or len(short) >= len(long_) or short[0] != long_[0]:
        return False
    it = iter(long_)
    return all(ch in it for ch in short)


def score_scope_match(label, value, generic=None):
    """How much a budget line's label looks like one of the firm's values.

    `generic` are words that identify nothing here — every word Carta uses
    in an account name, plus the usual filler. Without that filter a travel
    line matched a value called "Quinn - Travel" on the word "travel", and a
    professional-fees line reached "Franchise Tax Board" through "tax".
    """
    ltoks, vtoks = _label_tokens(label), _label_tokens(value)
    if not vtoks:
        return 0.0
    dead = (generic or set()) | SCOPE_STOPWORDS
    shared = {t for t in (ltoks & vtoks) if len(t) > 2 and t not in dead}
    if not shared:
        return 0.0
    distinctive = {t for t in vtoks if t not in dead} or vtoks
    score = len(shared) / len(distinctive)
    # An unmatched word of the value that a leftover word of the label
    # shortens — the case exact and subset matching both walk past.
    for v in distinctive - shared:
        if any(_abbreviates(t, v) for t in ltoks - shared if t not in dead):
            score += 0.25
            break
    return round(min(score, 1.0), 3)


def generic_scope_words(account_names):
    """Every word Carta itself uses in an account name."""
    out = set()
    for name in (account_names or {}).values():
        out |= _label_tokens(name)
    return out


def suggest_scopes(label, census, limit=4, generic=None):
    """Values this line might be reporting, best first. Proposals only.

    Claiming stays exact — a wrong claim silently moves real money between
    lines. But a line whose label plainly names a value the matcher can't
    reach shouldn't quietly report firm-wide either, so the near ones are
    offered and a person picks.
    """
    out = []
    for c in claimable_index(census).values():
        sc = score_scope_match(label, c["value"], generic)
        if sc >= SCOPE_SUGGEST_MIN:
            out.append({**c, "score": sc})
    out.sort(key=lambda c: (-c["score"], c["value"]))
    return out[:limit]


def _has_activity(scope, gl_codes, entries):
    """Whether `scope`'s value has entries on any of these GL accounts."""
    gls = set(gl_codes or [])
    return any(e.get("acct_type") in gls and dimension_value_of(e, scope) == scope["value"]
               for e in entries or [])


def resolve_near_scopes(rows, census, account_names=None, decisions=None, entries=None):
    """Scope lines whose label names one of the firm's values inexactly.

    Exact matching walks past a workbook that shortens the value it means:
    "Atlas Prog" for "Atlas Program". Such a line has accounts but no scope,
    so it reports every dollar those accounts saw — on one firm, a line
    meaning $7K of one team's travel reported $153K of everyone's.

    One clear match applies when the value has entries on one of the line's
    own accounts in `entries` (the ledger the census was taken from) — a
    resemblance in wording alone matched "Business Meals" to an office
    pantry and seven event lines to one networking event. It is recorded
    as an inference (`scope_inferred`, field `matched_on`), so it is asked
    about like any other value read off the wording. Anything less — no
    such entries, a weaker resemblance, or two values equally close — is
    withheld and asked about, because a wrong scope moves real money
    between lines silently.

    The client's answers (`decisions`, keyed as inference_key) outrank the
    ledger: a value they confirmed for this wording is applied without the
    spend check — a confirmed programme with no spend yet this year reports
    $0, not everyone's — and one they rejected is never applied or proposed
    again. A confirmation never overrides an ambiguity: the score checks
    still apply.

    Returns (claims, applied, withheld). The claims join the exact ones so
    the residual arithmetic subtracts this spend from the untagged lines
    over the same accounts.
    """
    generic = generic_scope_words(account_names)
    claims, applied, flagged = [], 0, 0
    for row, heading in _rows_with_heading(rows):
        if row.get("row_kind") != "line" or row.get("void"):
            continue
        # A remainder line reports what the claimed lines don't.
        if _label_tokens(row.get("label")) & SCOPE_NEGATIONS:
            continue
        if row.get("scopes") or row.get("fund_match") or row.get("scope_none"):
            continue
        if not (row.get("gl_codes") or []):
            continue
        # The same places exact claiming reads, most specific first: a firm
        # that shortens a value in a section header shortens it the same
        # way it does in a line label, and the heading is where a whole
        # block of lines gets its meaning.
        cands, matched_on = [], None
        copied = _copied_heading(row, heading)
        for field in ("sub_account", "vendor", "label", "tag_value", "subsection", "section"):
            text = row.get(field)
            # A copied heading is scored as the heading, under the key the
            # exact pass uses, so one answer covers both.
            if field == "tag_value" and copied:
                field = "subsection"
            cands = [c for c in suggest_scopes(text, census, generic=generic)
                     if not _rejected(decisions, c, field)]
            if cands:
                matched_on = field
                break
        if not cands:
            continue
        top = cands[0]
        runner_up = cands[1]["score"] if len(cands) > 1 else 0.0
        hit = {k: v for k, v in top.items() if k in ("source", "category", "value")}
        backed = (_confirmed(decisions, hit, matched_on)
                  or _has_activity(hit, row["gl_codes"], entries))
        if top["score"] >= SCOPE_AUTO_MIN and runner_up < SCOPE_AUTO_MIN and backed:
            row["scopes"] = [hit]
            row["scope"] = hit
            row["scope_matched"] = round(top["score"], 3)
            row["scope_matched_on"] = matched_on
            row["scope_inferred"] = [_inference(hit, matched_on, row)]
            if hit["source"] == "reporting_tag":
                row["tag_value"] = hit["value"]
            if hit not in claims:
                claims.append(hit)
            applied += 1
            continue
        row["scope_candidates"] = cands
        row["scope_unresolved"] = True
        flagged += 1
    return claims, applied, flagged

