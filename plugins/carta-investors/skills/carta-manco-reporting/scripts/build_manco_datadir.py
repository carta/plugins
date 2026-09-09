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
  cash-balance.json          — fa:get:cash-balance response for the ManCo entity
  budget-<year>-01.json .. -12.json — fa:list:budgets per-month payloads (may be empty; all 12 months)

Written to --dashboard-dir:
  snapshot.json — KPI-level dashboard payload (firmName, ops, cash, budget, feeSchedule, monthlyCashflow, spendByGL)
  accounts.json — per-account rollup + full entry list + fund-fee entries

Stdlib-only, Python 3.9-safe.
"""

import argparse
import glob
import json
import re
import sys
from collections import Counter, defaultdict
from datetime import date as _date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from shapes import canonical as canonical_budget

MONTH_LABELS_FULL_YEAR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul",
                          "Aug", "Sep", "Oct", "Nov", "Dec"]


# --- Parsers ---------------------------------------------------------------

def parse_total_rows(text):
    """Extract the `total_rows: N` value from a pipe-table's optional
    preamble line (e.g. `total_rows: 1842 | offset: 0 | limit: 1000 |
    format: markdown`). Returns None when the preamble is absent — single
    -page responses and hand-written fixtures both take this path, and
    callers must treat that as "nothing to check against", not zero."""
    lines = [ln for ln in text.splitlines() if ln.strip()]
    if not lines or not lines[0].startswith("total_rows:"):
        return None
    m = re.match(r"total_rows:\s*(\d+)", lines[0])
    return int(m.group(1)) if m else None


def parse_pipe_table(text):
    """Parse a Carta MCP pipe-table (markdown format). Returns list[dict]."""
    lines = [ln for ln in text.splitlines() if ln.strip()]
    if not lines:
        return []
    start = 1 if lines[0].startswith("total_rows:") else 0
    headers = [h.strip().lower() for h in lines[start].split(" | ")]
    di = start + 1
    if di < len(lines) and re.fullmatch(r"[\s\-|]+", lines[di]):
        di += 1
    rows = []
    for line in lines[di:]:
        stripped = line.rstrip().rstrip("|").rstrip()
        cells = [c.strip() for c in stripped.split(" | ")]
        while len(cells) < len(headers):
            cells.append("")
        cells = cells[:len(headers)]
        rows.append(dict(zip(headers, cells)))
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


def norm_je_row(row, kind):
    """Normalize a JE-line dict from the standard SQL projection."""
    return {
        "id":          row["id"],
        "gluuid":      row.get("gluuid") or None,
        "date":        row["date"],
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


def _norm_label(v):
    return " ".join(str(v or "").strip().lower().replace("&", "and").split())


def _label_tokens(v):
    return set(re.findall(r"[a-z0-9]+", _norm_label(v)))


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


_LABEL_GL_RX = re.compile(r"\s*(\d{3,5})\b")
_GL_NAME_STOPWORDS = {"and", "the", "of", "fee", "fees", "income", "expense",
                      "expenses", "other", "misc"}


def drop_foreign_gl_codes(rows, account_name_by_type):
    """Un-map a line whose GL number is its own chart of accounts, not Carta's.

    An outline line reading "4001 - Fund I Mgmt Fee" is read as stating a
    Carta account. It states the workbook's, and the two numberings need
    not agree: that firm's 4001 is a management fee, Carta's is bank
    interest. Joining anyway reports one account's spend against another,
    which no one can see on the page.
    """
    for row in rows or []:
        gls = row.get("gl_codes") or []
        if len(gls) != 1:
            continue
        label = str(row.get("label") or "")
        m = _LABEL_GL_RX.match(label)
        if not m or int(m.group(1)) != gls[0]:
            continue        # the code came from a mapping, not the label
        carta = account_name_by_type.get(gls[0])
        stated = _label_tokens(label[m.end():]) - _GL_NAME_STOPWORDS
        known = _label_tokens(carta) - _GL_NAME_STOPWORDS if carta else set()
        # Carta has no such account, or calls it something else entirely.
        if not known or not (stated & known):
            row["gl_codes"] = []


def row_side(row):
    """Which side of the P&L a budget row reports, income or expense."""
    if (row.get("section") or "").strip().lower() == "income":
        return "income"
    gls = row.get("gl_codes") or []
    if gls and all(4000 <= g < 5000 for g in gls):
        return "income"
    return "expense"


def _norm_account(value):
    """A label reduced to the form account matching compares on."""
    if not isinstance(value, str):
        return ""
    return " ".join(re.sub(r"[^a-z0-9]+", " ", value.lower()).split())


# A value read off a line's own wording, rather than stated by the workbook
# in a column of its own. TAG_VALUE is the crosstab's own column: the firm
# wrote the value there, so nothing was inferred.
INFERRED_FROM = ("sub_account", "label", "subsection", "section")


def inference_key(scope, field):
    """One question, however many lines it touches.

    Keyed on what the inference SAYS — this wording means this value — so a
    firm with forty lines under one heading answers once, and a line added
    next quarter inherits the answer instead of reopening it.
    """
    return "|".join([field, scope["source"], scope.get("category") or "", scope["value"]])


def read_inference_decisions(dashboard_dir):
    """What the client said about values read off their own wording.

        {"inferences": {"label|reporting_tag|Cost center|Marketing":
                        {"status": "rejected"}}}

    Confirmed is not asked again; rejected is not applied again. Absent
    means nobody has been asked yet.
    """
    path = Path(dashboard_dir) / "budget-mapping.json"
    if not path.exists():
        return {}
    try:
        return (json.loads(path.read_text()).get("inferences") or {})
    except Exception:
        return {}


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
    # The client's own mapping file already states what their wording means
    # in Carta's terms. Reading it beats asking them the same question.
    alias_norm = {}
    for wording, values in (aliases or {}).items():
        vals = [v for v in (values or []) if _norm_label(v) in by_norm]
        if len(vals) == 1:
            alias_norm[_norm_label(wording)] = by_norm[_norm_label(vals[0])]

    def resolve(text):
        norm = _norm_label(text)
        if not norm:
            return None
        if norm in by_norm:
            return by_norm[norm]
        if norm in alias_norm:
            return alias_norm[norm]
        toks = _label_tokens(text)
        cands = [c for n, c in by_norm.items() if _label_tokens(n) <= toks]
        # Two values both inside one label names neither.
        return cands[0] if len(cands) == 1 else None

    # The words each Carta account name is made of. A label that adds nothing
    # to one of them names that account, however the firm abbreviates it.
    account_tokens = [_label_tokens(n) for n in (account_names or {}).values()]
    account_tokens = [t for t in account_tokens if t]

    claims = []
    for row in rows or []:
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
        # Most specific first: a line naming a sub-account says more about
        # itself than the heading above it, and it is both at once.
        scopes, sources, inferred = [], set(), []
        for field, text in (("sub_account", row.get("sub_account")),
                            ("label", row.get("label")),
                            ("tag_value", row.get("tag_value")),
                            ("subsection", row.get("subsection")),
                            ("section", row.get("section"))):
            if field == "label" and label_is_account:
                continue
            hit = resolve(text)
            if not hit or hit["source"] in sources:
                continue
            if field in INFERRED_FROM:
                key = inference_key(hit, field)
                if (decisions or {}).get(key, {}).get("status") == "rejected":
                    continue        # the client has already said this is not it
                inferred.append({**hit, "field": field, "key": key,
                                 "label": row.get("label")})
            sources.add(hit["source"])
            scopes.append(hit)
            if hit not in claims:
                claims.append(hit)
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


def autolink_exact_accounts(rows, account_names):
    """Resolve a line that names one Carta account and nothing else.

    "Rent - <office>" is the account "Rent" for a sub-account the row is
    already scoped to. Once that scope's own words are taken out, what is
    left is an account name — and when exactly one Carta account carries
    it, there is nothing for a client to decide.

    Exact names only, and only when unique. Anything less is a resemblance,
    and a resemblance is what the gate exists to ask about.
    """
    # Punctuation is the workbook's own joinery — a dash, a slash, a
    # parenthesis around the office. Comparing account names through it
    # made the match depend on which separator the author happened to use.
    def bare(v):
        return " ".join(re.sub(r"[^a-z0-9]+", " ", _norm_label(v)).split())

    by_name = {}
    for gl, name in (account_names or {}).items():
        norm = bare(name)
        if norm:
            by_name.setdefault(norm, set()).add(gl)

    linked = 0
    for row in rows or []:
        if row.get("gl_codes") or row.get("fund_match"):
            continue
        text = str(row.get("label") or "")
        for sc in row.get("scopes") or []:
            # The scope's words identify the slice, not the account.
            text = re.sub(re.escape(str(sc.get("value") or "")), " ", text,
                          flags=re.I)
        norm = bare(text)
        gls = by_name.get(norm)
        if norm and gls and len(gls) == 1:
            row["gl_codes"] = sorted(gls)
            row["gl_auto_exact"] = True
            linked += 1
    return linked


def borrow_accounts_from_namesake(rows):
    """Give a scoped line the accounts of the identically-labelled line.

    A workbook that repeats a label across sections is describing the same
    spend cut two ways — the same rent, once for one department and once
    for another. Only the first carries the accounts; the second is left
    with a scope and nothing to apply it to, so it reports zero.

    Exact label equality within one budget, never a resemblance: the author
    wrote the same words for the same thing.
    """
    donors = {}
    for row in rows or []:
        gls = row.get("gl_codes") or []
        if gls:
            donors.setdefault(_norm_label(row.get("label")), gls)
    borrowed = 0
    for row in rows or []:
        if row.get("gl_codes") or row.get("fund_match") or not row.get("scopes"):
            continue
        gls = donors.get(_norm_label(row.get("label")))
        if gls:
            row["gl_codes"] = list(gls)
            row["gl_from_namesake"] = True
            borrowed += 1
    return borrowed


def read_account_decisions(dashboard_dir):
    """What the client said about accounts no budget line reports.

        {"accounts": {"7105": {"status": "not_expected"}}}

    An account they have already placed, or told us not to expect in the
    budget, is not asked about again. Assigning it to a line is recorded on
    that line's own `gl_codes` instead — the line is what reports it.
    """
    path = Path(dashboard_dir) / "budget-mapping.json"
    if not path.exists():
        return {}
    try:
        return (json.loads(path.read_text()).get("accounts") or {})
    except Exception:
        return {}


# A fund_match line reports the ManCo's own aggregate management-fee-income
# account by fund name, not by gl_codes — see BudgetActualsOutline.jsx.
_MANAGEMENT_FEE_INCOME_RX = re.compile(r"management\s+fee", re.IGNORECASE)


def unaccounted_accounts(rows, entries, account_names=None, decided=None,
                         window=None):
    """Accounts carrying activity that no budget line reports.

    Two ways an account goes unreported, and a reader can see neither:
    no line names it, or the only lines that do are scoped to values it
    carries beyond them, leaving the rest to nobody. Both are money the
    report cannot show, which is worse than money it shows twice.

    `window` is the (first, last) months the budget covers, and entries
    outside it are not this budget's to report. Without it a budget stated
    through June is charged August spend and the account looks unreported
    when it is merely out of period — on one real firm that was ten of
    thirty-two accounts, including its rent. Same window the variance chart
    compares over, for the same reason.

    Ranked by expense, following the same reasoning as the unclaimed-value
    question: an account carrying mostly income would otherwise lead on a
    figure the question is not about.
    """
    first, last = window if window else (None, None)
    naming = {}
    fund_matched = False
    for row in rows or []:
        if row.get("row_kind") != "line" or row.get("void"):
            continue
        for gl in row.get("gl_codes") or []:
            naming.setdefault(gl, []).append(row)
        if row.get("fund_match"):
            fund_matched = True

    totals, names = {}, dict(account_names or {})
    for e in entries or []:
        gl = e.get("acct_type")
        if gl is None:
            continue
        if first is not None and not (first <= (e.get("mo") or 0) <= last):
            continue
        amt = float(e.get("amount") or 0)
        t = totals.setdefault(gl, {"amount": 0.0, "expense": 0.0, "income": 0.0,
                                   "unreported": 0.0, "entries": 0})
        t["amount"] += amt
        t["entries"] += 1
        kind = e.get("kind")
        if kind in ("expense", "income"):
            t[kind] += abs(amt)
        names.setdefault(gl, e.get("account"))
        lines = naming.get(gl)
        if not lines:
            # A fund's own line already reports this account's activity —
            # it just does it by fund name, not by gl_codes.
            if fund_matched and _MANAGEMENT_FEE_INCOME_RX.search(names.get(gl) or ""):
                continue
            t["unreported"] += amt          # nothing names this account
            continue
        # A line with no scope reports the whole account, so nothing is left.
        if any(not (r.get("scopes") or []) for r in lines):
            continue
        # Otherwise only the values those lines are scoped to are reported.
        claimed = any(dimension_value_of(e, sc) == sc["value"]
                      for r in lines for sc in r.get("scopes") or [])
        if not claimed:
            t["unreported"] += amt

    out = []
    for gl, t in totals.items():
        if str(gl) in (decided or {}):
            continue
        if round(t["unreported"]) == 0:
            continue
        out.append({"account_type": gl, "name": names.get(gl),
                    "unreported": round(t["unreported"]),
                    "activity": round(t["amount"]),
                    "expense": round(t["expense"]), "income": round(t["income"]),
                    "named_by_a_scoped_line": bool(naming.get(gl))})
    return sorted(out, key=lambda x: -(x["expense"] or 0))


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
    return rows


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
_FETCH_REQUIRED_FILES = ("je-income.txt", "fund-fees.txt")


def check_fetch_completeness(raw_dir):
    fetched_marker = raw_dir / ".fetched-at"
    if not fetched_marker.exists():
        return  # no completed Step-3 run yet — nothing to cross-check against
    missing = [name for name in _FETCH_REQUIRED_FILES if not (raw_dir / name).exists()]
    if missing:
        raise SystemExit(
            f"{raw_dir}/.fetched-at records a completed fetch, but "
            f"{', '.join(missing)} is missing — Query B/C's save call never ran "
            f"this fetch (see references/data-fetch.md's 'Capture that follow-up "
            f"message' discipline). Do not build from this raw_dir: a missing "
            f"file is not the same as a genuine 0-row result, and building now "
            f"would silently understate income/fund-fees. Re-run Step 3 for "
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
            name = row.get("account_name")
            if not name:
                continue
            per_account[name]["monthly"][i - 1] += float(row.get("amount") or 0.0)
            per_account[name]["type"] = row.get("account_type")

    # Clamp to [1, 12] as a safety net — as_of_month should already be valid.
    mo = max(1, min(12, int(as_of_month)))
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
        "source":        "carta-fa-list-budgets",
        "by_tag_value": None,
    }


# Net income is an aggregate in the expense section's vicinity but it is
# not a total OF expenses — including it as a candidate made one firm's
# opex resolve to its bottom line. "Operating"/"Ordinary" is a common
# qualifier ("Net Operating Income") the bare pattern didn't cover.
_NET_INCOME_LABEL_RX = re.compile(r"^Net\s+(?:Operating\s+|Ordinary\s+)?(Income|Loss)\b", re.IGNORECASE)


def _read_monthly_crosstab_budget(data, path, as_of_month):
    """Normalize a monthly-crosstab budget (shapes/monthly_crosstab.py) into
    the read_budgets()-shaped envelope BudgetActualsAccounts.jsx renders.

    No department axis exists in this shape, so income/expense scalars are
    a straight sum of the flat rows by leading GL digit — no section
    hierarchy to walk, unlike the outline shape.
    """
    rows = data.get("rows") or []
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
        "source": "excel-workbook",
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
        "id": (data.get("id")
               or (path.stem.replace("budget-", "", 1) if path.stem.startswith("budget-") else "primary")),
        "label": data.get("label") or (data.get("workbook_meta") or {}).get("sheet") or "Budget",
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

    def _section_total(section):
        """The section's grand total, from the outline's own structure.

        This used to look for the literal labels "Total Income" and "Total
        Operating Expenses", which is one firm's wording. Firms write
        "Qtrly Totals", "Total Expenses", "Total Mgmt Fee Including
        Creator" — all of which resolved to zero, so the dashboard showed
        a budget of nothing while displaying the lines it was made of.

        A `summary` row is the firm's own bottom-line for the section and
        wins outright. Otherwise take the largest total in the section: a
        grand total is by construction at least as big as the sub-totals
        beneath it, so this picks the roll-up over its parts without
        needing to know what the firm calls it.
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

        # Several aggregates. Either one of them rolls the others up, or
        # they are siblings covering different parts of the business and
        # the section total is their sum. Magnitude alone can't tell those
        # apart — the largest of two sibling totals looks exactly like a
        # grand total sitting above a small subtotal. What distinguishes
        # them is arithmetic: a roll-up equals the rest added together.
        vals = [abs(float(r["annual"])) for r in cands]
        total = sum(vals)
        for r, v in zip(cands, vals):
            rest = total - v
            if rest and abs(v - rest) <= 0.01 * max(v, rest):
                return float(r["annual"])
        # No row accounts for the others: they are siblings, so add them.
        return sum(float(r["annual"]) for r in cands)

    income_total = _section_total("Income")
    opex_total = _section_total("Operating Expenses")

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
        income_ytd_total = _section_ytd("Income")
        expenses_ytd_total = _section_ytd("Operating Expenses")
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
        "id":               (path.stem.replace("budget-", "", 1)
                             if path.stem.startswith("budget-") else "primary"),
        "label":            (data.get("label")
                             or (data.get("workbook_meta") or {}).get("sheet")
                             or "Budget"),
    }


def _budget_window(budget_payload, as_of_month):
    """The months a budget actually covers, as (first, last) 1-based, plus a
    label for the UI.

    Actuals were previously summed year-to-date regardless of what the budget
    covered, so a budget stated through June was charged spend through
    August and every variance read high. Worse, a quarter-to-date budget was
    compared against eight months of spend.

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


VOID = "void"
REMOVED = "removed"


def read_budget_mapping(dashboard_dir):
    """Per-row mapping decisions the client made, keyed by budget row key.

    Keyed by `row_address` — a row's own key where it has one, otherwise
    its section/subsection/label path.

        {"rows": {"r7": {"fund": "<a fund the firm has>"},
                  "r9": {"gl_codes": [7110, 7105]},
                  "r11": {"scope": {"source": "reporting_tag",
                                    "category": "TAGS",
                                    "value": "<a tag value>"}},
                  "r12": {"status": "void"},
                  "r13": {"status": "removed"}}}

    Written by the skill's resolution gate. Similarity between a workbook's
    wording and Carta's is a hint, not an answer — one near miss puts one
    fund's fees on another — so an unresolved row is asked about and the
    answer recorded here rather than inferred again on every build.
    """
    path = Path(dashboard_dir) / "budget-mapping.json"
    if not path.exists():
        return {}
    try:
        return (json.loads(path.read_text()).get("rows") or {})
    except Exception:
        return {}


def row_address(row):
    """How a recorded decision names a row.

    `key` covers the line rows the adapters number. Everything else — the
    subtotals and totals a workbook builds its own sections from — has no
    key, and those are exactly the rows a client picks when asked which
    line reports a value. Position is not an address: a row inserted above
    would silently re-point every answer below it.
    """
    if row.get("key"):
        return row["key"]
    parts = [row.get("section"), row.get("subsection"), row.get("label")]
    return "/".join(_norm_label(x) for x in parts if _norm_label(x))


def assign_row_addresses(rows, budget_id=None):
    """Give every row an address, unique within its budget.

    Every shape adapter numbers rows from 1 per parse, so two different
    budgets can produce the same `bare_addr` ("r17") for unrelated lines.
    `addr` adds a `budget_id` prefix to disambiguate; `bare_addr` (no
    prefix) survives alongside it so a decision recorded before this
    prefix existed still resolves — see `apply_budget_mapping`.
    """
    seen = {}
    for row in rows or []:
        base = row_address(row)
        seen[base] = seen.get(base, 0) + 1
        bare = base if seen[base] == 1 else f"{base}#{seen[base]}"
        row["bare_addr"] = bare
        row["addr"] = f"{budget_id}::{bare}" if budget_id else bare
    return rows


def record_budget_mapping(dashboard_dir, answers):
    """Merge answers into the dir's mapping file, never replacing it.

    This file is the only record of decisions a client made — which fund a
    fee line means, which account a category covers, what is budget-only.
    Nothing else holds them, and they cost a conversation each. Write the
    whole file and one careless run erases work nobody can reconstruct.

    Returns the number of rows added or changed.
    """
    path = Path(dashboard_dir) / "budget-mapping.json"
    payload = {"rows": {}}
    if path.exists():
        try:
            payload = json.loads(path.read_text()) or {"rows": {}}
        except Exception:
            # An unreadable file is not an empty one. Refuse rather than
            # start a fresh one over the top of it.
            raise RuntimeError(f"{path} exists but could not be read; "
                               f"not overwriting it")
    rows = payload.setdefault("rows", {})
    changed = sum(1 for k, v in (answers or {}).items() if rows.get(k) != v)
    rows.update(answers or {})
    path.write_text(json.dumps(payload, indent=2))
    return changed


def apply_budget_mapping(rows, mapping, budget_id=None, ambiguous_bare_addrs=None):
    """Apply recorded decisions. Returns the rows that survive.

    `removed` drops the row entirely; `void` keeps it visible and marks it,
    so a blank reads as a decision rather than as missing data.

    A decision keyed by the new, budget-prefixed `addr` always applies —
    it can only ever name one row in one budget. A decision keyed by the
    old bare address or key applies too, UNLESS `ambiguous_bare_addrs`
    names it: that means two budgets in this build share that bare
    address, so a bare-keyed decision can't be told which one it was
    for. Silently applying it to both risks moving GL codes or a fund
    match onto a line nobody chose it for — leaving both unresolved, so
    the operator is asked again, costs less than that.
    """
    assign_row_addresses(rows, budget_id=budget_id)
    if not mapping:
        return rows
    ambiguous = ambiguous_bare_addrs or set()
    out = []
    for row in rows:
        decision = mapping.get(row["addr"])
        if decision is None and row["bare_addr"] not in ambiguous:
            decision = mapping.get(row["bare_addr"]) or mapping.get(row.get("key"))
        decision = decision or {}
        status = decision.get("status")
        if status == REMOVED:
            continue
        if status == VOID:
            row["void"] = True
        if decision.get("fund"):
            row["fund_match"] = decision["fund"]
        # An empty list is an answer, not a missing one: on a per-fund line
        # it says the line is the net of every account the fund posts to.
        if decision.get("gl_codes") is not None:
            row["gl_codes"] = [int(g) for g in decision["gl_codes"]]
        if decision.get("scope"):
            row["scope"] = decision["scope"]
            # `scopes` is what the row's actuals, the drawer and the near-scope
            # matcher all read. Recording only the singular left an answered
            # line reporting firm-wide and still flagged as unanswered.
            row["scopes"] = [decision["scope"]]
            if (decision["scope"].get("source") or "reporting_tag") == "reporting_tag":
                row["tag_value"] = decision["scope"]["value"]
        elif decision.get("tag_value"):
            row["tag_value"] = decision["tag_value"]
        out.append(row)
    return out


_COMPONENT_SPLIT_RX = re.compile(r"\s*(?:\+|/|,|&| and )\s*", re.I)
_QUALIFIER_RX = re.compile(r"\((?:[^)]*)\)|<\s*\$?[\d.,]+\s*[kKmM]?|\d+\s*%")


def _parenthetical_components(label):
    """The things a bracketed aside names, offered alongside the label.

    A line called "Other (Printing/Postage/Couriers)" states its accounts
    nowhere else, and one called "Connectivity (Telephone)" names its
    account only in the brackets. Added to the components rather than
    replacing them, so a bracket that merely qualifies — "(all in)",
    "(Employer)" — costs a candidate nobody matches instead of losing the
    name beside it.
    """
    out = []
    for inner in re.findall(r"\(([^)]*)\)", str(label or "")):
        parts = [p.strip() for p in _COMPONENT_SPLIT_RX.split(inner) if p.strip()]
        out.extend(parts)
    return out


def _label_components(label):
    """The distinct things a budget line names.

    "Payroll Taxes (Employer) + Workers Comp" is two accounts wearing one
    label. Resolving it to the first alone reads as mapped while half the
    line stays out, which is the failure a reader cannot see.
    """
    bare = _QUALIFIER_RX.sub(" ", str(label or ""))
    parts = [p.strip() for p in _COMPONENT_SPLIT_RX.split(bare) if p.strip()]
    parts = parts or [str(label or "").strip()]
    for extra in _parenthetical_components(label):
        if extra not in parts:
            parts.append(extra)
    return parts


_INCOME_BAND = (4000, 4999)
# Same leading-digit convention as is_income/is_expense below: 1-3 is a
# balance-sheet account (asset/liability/equity), not income or expense.
_BALANCE_SHEET_LEAD_DIGITS = ("1", "2", "3")


def _band_allows(gl, section):
    """Whether an account is on the same side of the books as the line.

    A line filed under spend can mean neither an income account nor a
    balance-sheet one ("Bank charges" was matching "Bank", a cash account).
    Unknown section allows everything.
    """
    if section is None or not isinstance(gl, int):
        return True
    in_income = _INCOME_BAND[0] <= gl <= _INCOME_BAND[1]
    if is_income_section(section):
        return in_income
    return not in_income and str(gl)[:1] not in _BALANCE_SHEET_LEAD_DIGITS


def _token_doc_freq(account_names):
    """How many distinct account names use each token.

    A word naming only one or two accounts identifies them; a word naming
    several ("services", "travel", "insurance") is a category suffix that
    two different accounts can share without being the same account.
    """
    freq = {}
    for name in (account_names or {}).values():
        for tok in _label_tokens(name) - _GL_NAME_STOPWORDS:
            freq[tok] = freq.get(tok, 0) + 1
    return freq


# A shared word naming this many or fewer accounts counts as an identifier
# rather than a category suffix — see _token_doc_freq and _names_resemble.
_GENERIC_TOKEN_MAX_ACCOUNTS = 2


def _names_resemble(want, have, doc_freq):
    """Beyond exact subset/superset: resemble on a specific shared word.

    "Bank & Filing Fees"/"Bank charges" share only "bank", a rare word —
    a resemblance. "PR Services"/"Payroll services" share only "services",
    a common one — not.
    """
    overlap = want & have
    if not overlap:
        return False
    if len(overlap) < min(len(want), len(have)) / 2:
        return False
    return any(doc_freq.get(t, 0) <= _GENERIC_TOKEN_MAX_ACCOUNTS for t in overlap)


def suggest_gl_accounts(label, mapping_records, account_names, limit=3,
                        section=None):
    """Carta accounts a budget line might mean — proposed, never applied.

    The client's mapping names lines more briefly than their budget does,
    so an exact match leaves real coverage on the table while a loose one
    joins the wrong account silently. These are offered for confirmation
    instead: the operator answers once and the answer is recorded.
    """
    by_cat = {}
    for rec in mapping_records or []:
        cat, gl = _norm_label(rec.get("category")), rec.get("gl")
        if cat and isinstance(gl, int):
            by_cat.setdefault(cat, set()).add(gl)
    doc_freq = _token_doc_freq(account_names)

    out, seen = [], set()

    def offer(gl, why, component):
        if gl in seen or not _band_allows(gl, section):
            return
        seen.add(gl)
        out.append({"gl": gl, "name": account_names.get(gl),
                    "why": why, "component": component})

    for comp in _label_components(label):
        norm = _norm_label(comp)
        if not norm:
            continue
        cats = [c for c in by_cat if c == norm] or \
               [c for c in by_cat if norm.startswith(c + " ") or c.startswith(norm + " ")]
        for c in sorted(cats, key=len, reverse=True)[:1]:
            for gl in sorted(by_cat[c]):
                offer(gl, "the mapping's nearest line", comp)
        want = _label_tokens(comp) - _GL_NAME_STOPWORDS
        if want:
            for gl, name in sorted(account_names.items()):
                have = _label_tokens(name) - _GL_NAME_STOPWORDS
                # One name has to sit inside the other. Sharing a word is
                # not a resemblance: "PR Services" and "Payroll services"
                # share "services" and are different accounts.
                if have and (want <= have or have <= want):
                    offer(gl, "a Carta account named alike", comp)
    if not out:
        # Nothing contains anything: the line and the account are the same
        # shape with a word swapped — "LP portal expenses" against the
        # firm's "LP meeting expenses". The subset rule refuses that on
        # purpose, because sharing a word is not a resemblance and a wrong
        # join moves real money. But refusing it silently leaves the gate
        # asking "which account?" with nothing to point at, and the
        # operator answering by hand every run. Offered last, only when
        # nothing else was, and still only as a proposal.
        want = _label_tokens(label) - _GL_NAME_STOPWORDS
        if want:
            for gl, name in sorted(account_names.items()):
                have = _label_tokens(name) - _GL_NAME_STOPWORDS
                # A specific shared word ("bank") can catch a candidate the
                # fuzzy match below scores too low to find on its own.
                if have and _names_resemble(want, have, doc_freq):
                    offer(gl, "a Carta account with a similar name (word match)", None)
        for gl, name, ratio in _accounts_by_resemblance(label, account_names):
            offer(gl, f"a Carta account with a similar name ({ratio:.0%})", None)
            if len(out) >= limit:
                break
    return out[:limit * max(1, len(_label_components(label)))]


# How alike two names have to read before one is worth offering for the
# other. Measured on a real firm: the line the operator wanted scored .70
# and the next candidate .61, so this sits below the answer and above most
# of the noise — and everything it admits is a proposal a person confirms.
_ACCOUNT_RESEMBLANCE_MIN = 0.6


def _accounts_by_resemblance(label, account_names):
    """Carta accounts whose name reads like this line's, best first."""
    import difflib

    def norm(v):
        return " ".join(re.sub(r"[^a-z0-9]+", " ", str(v or "").lower()).split())

    want = norm(label)
    if not want:
        return []
    scored = []
    for gl, name in (account_names or {}).items():
        other = norm(name)
        if not other:
            continue
        ratio = difflib.SequenceMatcher(None, want, other).ratio()
        if ratio >= _ACCOUNT_RESEMBLANCE_MIN:
            scored.append((ratio, gl, name))
    scored.sort(key=lambda x: (-x[0], x[1]))
    return [(gl, name, ratio) for ratio, gl, name in scored]


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


_TOTAL_KINDS = ("total", "subtotal", "summary")


def mark_widened_totals(rows):
    """Name the lines a section's closing total really covers.

    A workbook's formula can name fewer lines than the total visibly sits
    over — one firm's grand total referenced the single line beside it, so
    eleven funds reported as one. Only the total that closes a section is
    considered; an earlier one covers its own run and its formula stays the
    authority there.

    Structure only, so the report and the build agree on which totals moved
    rather than each deciding for itself.
    """
    widened = 0
    for i, row in enumerate(rows or []):
        if row.get("row_kind") not in _TOTAL_KINDS:
            continue
        if not isinstance(row.get("constituents"), list):
            continue
        # A total with no constituents but accounts of its own is a leaf
        # wearing a total's name; it reports itself, not the lines above.
        if not row["constituents"] and (row.get("gl_codes") or []):
            continue
        closes = True
        for later in rows[i + 1:]:
            k = later.get("row_kind") or ""
            if k.endswith("header"):
                break
            if k in _TOTAL_KINDS:
                closes = False
                break
        if not closes:
            continue
        covered = []
        for earlier in reversed(rows[:i]):
            k = earlier.get("row_kind") or ""
            if k.endswith("header"):
                break
            if k == "line" and earlier.get("key"):
                covered.append(earlier["key"])
        row["covered_lines"] = covered
        if len(covered) > len(row["constituents"]):
            widened += 1
    return widened


def gaps_sentence(counts):
    """One line naming what the report cannot say for itself.

    Absences a reader can see are not worth a sentence; these are not
    visible without hovering a particular row, and one of them is a figure
    this report states differently from the client's own workbook.
    """
    parts = []
    if counts.get("unresolved"):
        parts.append(f"{counts['unresolved']} budget line(s) need a mapping decision")
    if counts.get("budget_only"):
        parts.append(f"{counts['budget_only']} are budget-only by choice")
    if counts.get("widened"):
        parts.append(f"{counts['widened']} total(s) summed from the lines above them, "
                     f"where the workbook's own formula covered fewer")
    if counts.get("unclaimed"):
        parts.append(f"{counts['unclaimed']} tracked value(s) no budget line accounts for")
    if counts.get("inferred"):
        parts.append(f"{counts['inferred']} value(s) read from the workbook's own "
                     f"wording and applied, awaiting your confirmation")
    if counts.get("unaccounted"):
        parts.append(f"{counts['unaccounted']} account(s) carry spend no budget "
                     f"line reports")
    return " · ".join(parts) or None


# How much of a value's own wording a label has to carry before the value
# is worth proposing. Half means "Atlas Prog" reaches "Atlas Program" on the
# shared word alone; below that, a single common word ("Fund", "Team")
# would propose every value a firm has.
SCOPE_SUGGEST_MIN = 0.5

# Where a near match stops being a proposal and becomes the answer. A
# label carrying the value's own distinctive word AND a shortening of the
# rest ("Atlas Prog" for "Atlas Program") is not a resemblance, it is the
# same name written shorter. Below this, or with two values equally close,
# the line is withheld and asked about instead.
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


def resolve_near_scopes(rows, census, account_names=None):
    """Scope lines whose label names one of the firm's values inexactly.

    Exact matching walks past a workbook that shortens the value it means:
    "Atlas Prog" for "Atlas Program". Such a line has accounts but no scope,
    so it reports every dollar those accounts saw — on one firm, a line
    meaning $7K of one team's travel reported $153K of everyone's.

    One clear match applies, marked so the reader can see it was matched
    by name rather than stated. Anything less — a weaker resemblance, or
    two values equally close — is withheld and asked about, because a
    wrong scope moves real money between lines silently.

    Returns (claims, applied, withheld). The claims join the exact ones so
    the residual arithmetic subtracts this spend from the untagged lines
    over the same accounts.
    """
    generic = generic_scope_words(account_names)
    claims, applied, flagged = [], 0, 0
    for row in rows or []:
        if row.get("row_kind") != "line" or row.get("void"):
            continue
        # A remainder line reports what the claimed lines don't.
        if _label_tokens(row.get("label")) & SCOPE_NEGATIONS:
            continue
        if row.get("scopes") or row.get("fund_match"):
            continue
        if not (row.get("gl_codes") or []):
            continue
        # The same places exact claiming reads, most specific first: a firm
        # that shortens a value in a section header shortens it the same
        # way it does in a line label, and the heading is where a whole
        # block of lines gets its meaning.
        cands, matched_on = [], None
        for field in ("sub_account", "label", "tag_value", "subsection", "section"):
            cands = suggest_scopes(row.get(field), census, generic=generic)
            if cands:
                matched_on = field
                break
        if not cands:
            continue
        top = cands[0]
        runner_up = cands[1]["score"] if len(cands) > 1 else 0.0
        if top["score"] >= SCOPE_AUTO_MIN and runner_up < SCOPE_AUTO_MIN:
            hit = {k: v for k, v in top.items() if k in ("source", "category", "value")}
            row["scopes"] = [hit]
            row["scope"] = hit
            row["scope_matched"] = round(top["score"], 3)
            row["scope_matched_on"] = matched_on
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


def unresolved_budget_rows(rows, mapping_records=None, account_names=None,
                           fund_names=None):
    """Budget lines that will render with no actuals, and what each needs.

    Surfaced so the gap is a question the client answers, not a zero they
    have to notice. A line already marked void or removed is a settled
    decision and is not asked about again.
    """
    out = []
    for row in rows:
        if row.get("row_kind") != "line" or row.get("void"):
            continue
        if row.get("scope_unresolved"):
            out.append({"key": row.get("key"), "addr": row.get("addr"),
                        "label": row.get("label"), "needs": "scope",
                        "hint": row.get("tag_value"),
                        "suggestions": row.get("scope_candidates") or []})
            continue
        if row.get("fund_match") or (row.get("gl_codes") or []):
            continue
        # An income line the roster backfill couldn't place needs a fund;
        # anything else needs a GL account.
        needs = "fund" if row.get("section") == "Income" else "gl_account"
        entry = {"key": row.get("key"), "addr": row.get("addr"),
                 "label": row.get("label"), "needs": needs,
                 "hint": row.get("tag_value")}
        accounts = suggest_gl_accounts(row.get("label"), mapping_records,
                                       account_names or {},
                                       section=row.get("section"))
        if needs == "gl_account":
            entry["suggestions"] = accounts
        else:
            entry["suggestions"] = suggest_funds(row.get("label"), fund_names)
            # Not every income line is a fund's — a firm earns interest too.
            # Second-choice, so one near fund still pre-fills the table.
            entry["also"] = accounts
        out.append(entry)
    return out


def unconfirmed_inferences(rows, decisions=None):
    """Values read off a line's wording that nobody has confirmed.

    One entry per inference, not per line: "lines whose wording names
    <value> mean <value>" is one question however many rows it touches, and
    a line added next quarter inherits the answer rather than reopening it.
    """
    decided = decisions or {}
    out = {}
    for row in rows or []:
        for inf in row.get("scope_inferred") or []:
            if decided.get(inf["key"], {}).get("status") in ("confirmed", "rejected"):
                continue
            e = out.setdefault(inf["key"], {
                "key": inf["key"], "source": inf["source"],
                "category": inf.get("category"), "value": inf["value"],
                "field": inf["field"], "lines": [],
            })
            if row.get("label") and row["label"] not in e["lines"]:
                e["lines"].append(row["label"])
    return sorted(out.values(), key=lambda x: -len(x["lines"]))


_ASK_ORDER = {"fund": 0, "fund_account": 1, "gl_account": 2, "scope": 3}

# Below this, an account is still shown but is not its own question.
# Measured across three real firms: a $1,000 floor halves the rows on the
# worst of them while still covering 99% of the unreported money, and
# everything under it across all three came to sixteen accounts and $4,912.
# The small ones are not hidden — see `account_rows`.
_ACCOUNT_ASK_FLOOR = 1000

_ASK_WANTS = {"fund": "which fund", "fund_account": "which half of the fee",
              "gl_account": "which account(s)", "scope": "which value",
              "account_line": "which line reports it",
              "account_line_bulk": "are any of these expected",
              "inference": "is this what the wording means"}


_FIELD_SAID = {"label": "the line's own name", "sub_account": "the line's sub-account",
               "subsection": "the heading above it", "section": "the section it is in"}


def account_rows(unaccounted, start=1, floor=_ACCOUNT_ASK_FLOOR):
    """The accounts question, in the same numbered table as the rest.

    A budget line is asked which value it means; an account is asked which
    line reports it — the same conversation from the other end, so it reads
    as one pass rather than a second interrogation.

    Accounts under `floor` are gathered into one row instead of one each.
    They are listed in it by name and amount, not counted: a reader deciding
    that thirteen accounts totalling a few thousand are not expected wants
    to see which thirteen, and answering that thirteen times is how a gate
    stops being read. The floor changes how an account is asked about, never
    whether it is shown.
    """
    out, small = [], []
    for a in unaccounted or []:
        if abs(a.get("unreported") or 0) < floor:
            small.append(a)
            continue
        out.append({
            "n": start + len(out),
            "addr": f"account:{a['account_type']}",
            "line": f"{a['account_type']} {a.get('name') or ''}".strip(),
            "section": ("part of it, beyond the lines that name it"
                        if a.get("named_by_a_scoped_line") else "no line names it"),
            "needs": "account_line",
            "wants": _ASK_WANTS["account_line"],
            "proposed": None,
            "why": None,
            "answer": None,
            "amount": a.get("unreported"),
            "options": [],
        })
    if small:
        total = sum(abs(a.get("unreported") or 0) for a in small)
        out.append({
            "n": start + len(out),
            "addr": "accounts:under-floor",
            "line": f"{len(small)} small account(s)",
            "section": "each listed below — small enough to answer together",
            "needs": "account_line_bulk",
            "wants": _ASK_WANTS["account_line_bulk"],
            "proposed": None,
            "why": None,
            "answer": None,
            "amount": round(total),
            "options": [],
            # Printed in full under the row. The count is the summary; this
            # is the answer to "which ones?", which the reader needs before
            # they can dispose of the lot in one line.
            "accounts": [{"account_type": a["account_type"], "name": a.get("name"),
                          "unreported": a.get("unreported")} for a in small],
        })
    return out


def inference_rows(inferences, start=1):
    """Each inference as one row of the same numbered table.

    Pre-filled with the value the build applied, so an operator who agrees
    changes nothing — the answer only has to be typed where it is wrong.
    """
    out = []
    for inf in inferences or []:
        lines = inf["lines"]
        shown = ", ".join(lines[:3]) + (f" +{len(lines) - 3} more" if len(lines) > 3 else "")
        out.append({
            "n": start + len(out),
            "addr": f"inference:{inf['key']}",
            "line": shown,
            "section": f"matched on {_FIELD_SAID.get(inf['field'], inf['field'])}",
            "needs": "inference",
            "wants": _ASK_WANTS["inference"],
            "proposed": inf["value"],
            "why": f"applied to {len(lines)} line(s) on this wording alone",
            "answer": {"status": "confirmed"},
            "options": [inf["value"], "not that value"],
        })
    return out


def _ask_option(sug):
    """One candidate, as the words the table shows for it."""
    if sug.get("fund"):
        return sug["fund"]
    if sug.get("gl") is not None:
        return f"{sug.get('name') or sug['gl']} ({sug['gl']})"
    return str(sug.get("value") or sug.get("label") or "")


def _budget_section_label(row):
    """The row's own P&L section, plus department sub-section when nested —
    distinct from `tab_name`, which names the sheet, not the P&L placement."""
    section = row.get("section")
    if not section:
        return None
    subsection = row.get("subsection")
    return f"{section} ▸ {subsection}" if subsection else section


def mapping_table(rows, asks, proposals=None, tab_name=None):
    """Every open question about one budget, as one numbered table.

    A firm arrives with dozens of these and they are all the same kind of
    question. Asked one at a time they are an afternoon, and the operator
    stops reading them; read together, in the workbook's own order, the
    answer to most of them is visible at a glance.

    `proposals[addr]` pre-fills a row where the build worked the answer
    out. Everything else leads with its nearest candidate.

    `tab_name` is the workbook's own sheet name (`workbook_meta.sheet`),
    printed verbatim so the operator can trace a row to its exact source —
    never a reworded `--label`, and never the row's own P&L section
    heading, which shares no vocabulary with "which tab is this from" (see
    `budget_section` for that instead).
    """
    by_addr = {}
    for a in asks or []:
        by_addr.setdefault(a.get("addr") or a.get("key"), []).append(a)
    out = []
    for row in rows or []:
        for ask in sorted(by_addr.get(row.get("addr"), []),
                          key=lambda a: _ASK_ORDER.get(a.get("needs"), 9)):
            sugs = ask.get("suggestions") or []
            picked = (proposals or {}).get(row.get("addr")) if ask.get("needs") == "fund_account" else None
            out.append({
                "n": len(out) + 1,
                "addr": row.get("addr"),
                "line": row.get("label"),
                "section": tab_name,
                "budget_section": _budget_section_label(row),
                "needs": ask.get("needs"),
                "wants": ("which fund, or which account"
                          if ask.get("needs") == "fund" and ask.get("also")
                          else _ASK_WANTS.get(ask.get("needs"), ask.get("needs"))),
                "proposed": picked["label"] if picked else (
                    _ask_option(sugs[0]) if len(sugs) == 1 else None),
                "why": (picked or (sugs[0] if len(sugs) == 1 else {})).get("why"),
                "answer": ({"gl_codes": picked["gl_codes"]} if picked else None),
                "options": [_ask_option(s) for s in sugs + (ask.get("also") or [])],
            })
    return out


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
        amt = abs(float(r.get("amount") or 0))
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
    top = vendors[:VENDOR_TOP_N]
    return {
        "vendors": [{**v, "amount": round(v["amount"]),
                     "inferred_amount": round(v["inferred_amount"])} for v in top],
        "aggregated_count": sum(1 for v in vendors if v.get("aggregated")),
        # What the chart does not show, so the page can say so rather than
        # implying the top N is the whole of it.
        "other_amount": round(sum(v["amount"] for v in vendors[VENDOR_TOP_N:])),
        "other_count": max(0, len(vendors) - VENDOR_TOP_N),
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


def is_income_section(section):
    """Whether a workbook files a line under income rather than spend.

    The firm's own heading, not a guess from the GL code. A management fee
    posts to an account whose code begins with a 6 on some charts, which
    reads as an expense to any prefix test.
    """
    t = (section or "").strip().lower()
    return "income" in t or "revenue" in t


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

    # Department-scoped actuals, for outline rows that state a department.
    # An outline routinely repeats a line once per team — four "Salaries"
    # rows, all on the same GL — so joining on GL alone hands each of them
    # the firm-wide total and every one reads as a massive overrun. The BvA
    # page already scopes these by the Department reporting tag; this does
    # the same.
    aliases = value_aliases or {}
    dimension = dimension or ({"source": "reporting_tag", "category": tag_category}
                              if tag_category else None)
    tag_values_available = has_dimension_values(entries, dimension)
    actual_by_gl_tag = {}
    for e in (entries or []):
        if e.get("kind") != "expense":
            continue
        mo = e.get("mo")
        if not isinstance(mo, int):
            continue
        t = e.get("acct_type")
        if t is None:
            continue
        tag = dimension_value_of(e, dimension)
        if not tag:
            continue
        actual_by_gl_tag.setdefault((int(t), tag), [0.0] * 13)[mo] += float(e.get("amount") or 0)

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
    for r in rows:
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
        actual = None
        if tags and tag_values_available:
            scoped, found = 0.0, False
            for g in gls:
                for tag in tags:
                    series = actual_by_gl_tag.get((int(g), tag))
                    if series:
                        found = True
                        scoped += sum(series[first:last + 1])
            if found:
                actual = scoped
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
            # How this figure was narrowed, so the panel a reader opens can
            # be narrowed the same way. Without them the drawer answered a
            # wider question than the bar asked and the two disagreed on
            # screen.
            "carta_tags":      list(tags) if (tags and tag_values_available) else None,
            "excluded_claims": claims or None,
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


def find_excel_budget_files(dashboard_dir):
    """Return the firm's parsed Excel budget files, ordered so that
    budget.json (the "primary") comes first, followed by budget-<slug>.json
    variants (alphabetical). Multi-budget support: a firm can have several
    budgets coexisting (a YTD dept crosstab plus an annual plan) — each gets
    its own file, and they are emitted into snapshot.budgets as an array.

    Parsed budgets are only honoured when `.workbook-ref.json` records that
    a workbook is in use for this firm. The ref is the record of intent; the
    JSON beside it is derived output. Reading the derived files on their own
    means a budget, once ingested, renders forever — surviving a decline at
    the prompt, and surviving the source workbook being deleted. Orphans are
    reported rather than silently used, because a budget appearing with no
    provenance is worse than none appearing at all.
    """
    d = Path(dashboard_dir)
    primary = d / "budget.json"
    # budget-mapping.json is this dir's record of the client's own answers,
    # not a budget — it only matches the glob by an accident of naming.
    variants = sorted(p for p in d.glob("budget-*.json")
                      if p.name not in ("budget.json", "budget-mapping.json"))
    on_disk = ([primary] if primary.exists() else []) + variants

    ref_path = d / ".workbook-ref.json"
    if not ref_path.exists():
        if on_disk:
            print(
                f"warn: found {len(on_disk)} parsed budget file(s) in {d} with no "
                f".workbook-ref.json to account for them; ignoring. They are "
                f"left in place — re-ingest with --budget-workbook to use them.",
                file=sys.stderr,
            )
        return []

    try:
        ref = json.loads(ref_path.read_text())
    except Exception as e:
        print(f"warn: .workbook-ref.json unreadable ({e}); ignoring parsed budgets.",
              file=sys.stderr)
        return []

    if ref.get("declined"):
        # The operator was asked and said this firm has no Excel budget.
        return []

    src = ref.get("path")
    if src and not Path(src).expanduser().exists():
        print(
            f"warn: the workbook this firm's budget was parsed from is no longer at "
            f"{src}; ignoring the parsed budget rather than showing figures whose "
            f"source can't be confirmed.",
            file=sys.stderr,
        )
        return []

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


_WS_RX = re.compile(r"\s+")


def _normalize_category_label(s):
    return _WS_RX.sub(" ", (s or "").strip().lower())


def backfill_account_type_from_coa(rows, coa_records):
    """Fill in a missing GL code on a tag-crosstab budget line from the
    firm's own COA mapping, when the mapping names that exact line item.

    A line whose own column A carries no GL code has no path to Carta
    actuals (BudgetActualsView.jsx renders it "unmapped" and withholds the
    actual/variance) even when the firm's own "Carta GL Account to Budget
    Line Mapping" tab already states the GL for that line under a different
    tab. A client typing the GL for "Team Events" only on their mapping tab,
    and leaving the Budget-vs-Actuals tab's "Team Events" row blank because
    its own GL-bearing child rows are named differently, is not an edge
    case — it's how rollup lines are usually authored.

    Matches `coa_records[].category` against `rows[].label` by name
    (normalized). Only applies when: the row has no account_type or
    account_type_all yet (never overrides a code the workbook itself
    stated); and the match is unambiguous — either one record for that
    category, or several that all name the same GL(s). A category that maps
    to genuinely different GLs across tag_values is left unmapped rather
    than guessed.

    Returns the number of rows backfilled, for the build's stderr summary.
    """
    by_category = defaultdict(list)
    for rec in coa_records:
        cat = _normalize_category_label(rec.get("category"))
        if cat:
            by_category[cat].append(rec)

    backfilled = 0
    for row in rows:
        if row.get("row_kind") != "line":
            continue
        if row.get("account_type") is not None or row.get("account_type_all"):
            continue
        matches = by_category.get(_normalize_category_label(row.get("label")))
        if not matches:
            continue
        gl_sets = {tuple(sorted(m.get("gl_all") or [m["gl"]]))
                   for m in matches if m.get("gl") is not None}
        if len(gl_sets) != 1:
            continue  # ambiguous — same label maps to different GLs; don't guess
        gls = list(gl_sets.pop())
        row["account_type"] = gls[0]
        if len(gls) > 1:
            row["account_type_all"] = gls
        backfilled += 1
    return backfilled


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
        if (row.get("row_kind") != "line" or row.get("section") != "Income"
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


# A budget.json is written by the parse step and read by this one, and the
# two do not have to run in the same invocation — a cached workbook parsed
# before these fields were renamed is still on disk. Read the old spelling
# once, here, rather than testing for it at every use.
_RENAMED_ROW_FIELDS = {"by_dept": "by_column", "formula_by_dept": "formula_by_column"}


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

    rows = data.get("rows") or []
    if not rows:
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
    if not (data.get("dimensions") or []):
        shape_adapter = (data.get("workbook_meta") or {}).get("shape_adapter")
        if shape_adapter == "monthly-crosstab":
            return _read_monthly_crosstab_budget(data, p, as_of_month)
        return _read_outline_budget(data, p, period_kind, as_of_month, coa_value_aliases)

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
        "source":           "excel-workbook",
        "by_tag_value":    by_tag_value,
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
        "id":               (data.get("id")
                             or (p.stem.replace("budget-", "", 1) if p.stem.startswith("budget-") else "primary")),
        "label":            (data.get("label") or (data.get("workbook_meta") or {}).get("sheet") or "Budget"),
    }


# --- Assemble --------------------------------------------------------------

def build(args):
    raw       = Path(args.raw_dir)
    dashboard = Path(args.dashboard_dir)
    dashboard.mkdir(parents=True, exist_ok=True)

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
    month_labels = MONTH_LABELS_FULL_YEAR[:max_mo]
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
        if yr == args.as_of_year:
            fund_totals[uuid] += amt

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
        })

    # --- Fee schedule terms (contracted rate/basis/frequency, not actuals) -----
    fee_schedule_terms = read_fee_schedule_terms(raw)

    years = sorted({e["yr"] for e in fund_fee_entries})
    ytd_year = args.as_of_year
    fee_labels = [str(y) if y != ytd_year else f"{y} YTD" for y in years]
    fee_funds = []
    displayed = [display_name_by_uuid[u] for u in top_fund_uuids] + ["Other funds"]
    for fund_name in displayed:
        per_year = {y: 0.0 for y in years}
        for e in fund_fee_entries:
            if e["display_fund"] == fund_name:
                per_year[e["yr"]] += e["amount"]
        if not any(per_year.values()):
            continue
        fee_funds.append({
            "name":  fund_name,
            "data":  [round(per_year[y], 2) for y in years],
        })
    fee_schedule = {"labels": fee_labels, "funds": fee_funds}

    # --- Fee projections (future years from schedule × inferred committed capital) -----
    proj_labels, proj_funds = _build_fee_projections(
        fund_fee_entries, fee_schedule_terms, top_fund_uuids,
        display_name_by_uuid, ytd_year, args.as_of,
    )
    if proj_labels:
        fee_schedule["projectedLabels"] = proj_labels
        fee_schedule["projectedFunds"] = proj_funds

    # --- Budget + spend-by-GL -----
    #
    # The "YTD Top Categories of Spend" chart advertises "Top 10 expense
    # accounts" in Overview.jsx's section subtitle. The chart component itself
    # doesn't cap client-side, so cap here — expense_accounts is already
    # sorted biggest-first. Firms with dozens of expense accounts
    # Ventures with ~40) would otherwise render every account in the "top"
    # chart, contradicting the title.
    SPEND_BY_GL_TOP_N = 10
    as_of_month = int(args.as_of.split("-")[1])
    # Excel-first, multi-budget: parse every budget-*.json file in the
    # dashboard dir. When one or more exist, the FIRST becomes the
    # "primary" that drives dashboard-side charts (spend_by_gl,
    # income/expenses/net scalars); ALL of them are emitted into
    # snapshot.budgets for the BvA page's sub-nav switcher. When none
    # exist, fall back to Carta's fa:list:budgets payload.
    excel_files = find_excel_budget_files(dashboard)
    excel_budgets = [b for b in
                     (read_excel_budget(dashboard, as_of_month, budget_file=f) for f in excel_files)
                     if b is not None]
    # Recorded decisions first: a client's explicit answer outranks any
    # automatic match, and backfill_fund_match_from_roster skips a row that
    # already has one.
    #
    # A bare address ("r17") that appears in more than one of this firm's
    # budgets is ambiguous — a decision recorded under it before addresses
    # were budget-prefixed can't be told which budget it was for, so it is
    # not applied to either (see apply_budget_mapping).
    _bare_addr_budgets = defaultdict(set)
    for _b in excel_budgets:
        assign_row_addresses(_b.get("rows") or [])
        for _r in (_b.get("rows") or []):
            _bare_addr_budgets[_r["bare_addr"]].add(_b.get("id") or "primary")
    _ambiguous_bare_addrs = {a for a, ids in _bare_addr_budgets.items() if len(ids) > 1}

    _row_mapping = read_budget_mapping(dashboard)
    for _b in excel_budgets:
        _b["rows"] = apply_budget_mapping(_b.get("rows") or [], _row_mapping,
                                          budget_id=_b.get("id"),
                                          ambiguous_bare_addrs=_ambiguous_bare_addrs)

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

    if excel_budgets:
        budgets = excel_budgets[0]  # primary drives the top-line KPIs
    else:
        budgets = read_budgets(raw, args.as_of_year, as_of_month)
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
        drop_foreign_gl_codes(_b.get("rows") or [], _carta_account_names)

    # A section given to a dimension value reports that spend; the untagged
    # lines over the same accounts report the rest. Without this, both do.
    _claim_census = dimension_census(all_rows, sources=CLAIMABLE_SOURCES,
                                     values_limit=None)
    _claims = []
    _inference_decisions = read_inference_decisions(dashboard)
    for _b in excel_budgets:
        for c in claim_dimension_values(_b.get("rows") or [], _claim_census,
                                        _aliases, _carta_account_names,
                                        _inference_decisions):
            if c not in _claims:
                _claims.append(c)
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
                                            _carta_account_names)
        _scope_applied += _a
        _scope_flagged += _f
        for c in _near:
            if c not in _claims:
                _claims.append(c)
    if _scope_applied:
        print(f"note: {_scope_applied} line(s) matched a value by name "
              f"(a shortened spelling of it).", file=sys.stderr)
    if _scope_flagged:
        print(f"note: {_scope_flagged} line(s) name a value that could not be "
              f"matched; their actuals are withheld pending an answer.",
              file=sys.stderr)

    # Asked only about what nothing above could resolve — a gate that
    # repeats a question already answered teaches the operator to skim it.
    _unresolved = []
    _widened = 0
    for _b in excel_budgets:
        _widened += mark_widened_totals(_b.get("rows") or [])
    # budget_id/budget_label: two budgets' rows can share a bare address
    # ("r17") and even a label, so an entry can't say which budget it's
    # from without this — see assign_row_addresses.
    for _b in excel_budgets:
        _unresolved.extend(
            {**entry, "budget_id": _b.get("id"), "budget_label": _b.get("label")}
            for entry in unresolved_budget_rows(
                _b.get("rows") or [], _coa_records, _carta_account_names, fund_names)
        )
    # Accounts each fund's own fee entries post to, so a fund named twice
    # can be told apart by which of them each line means.
    _fund_accounts = {}
    for e in fund_fee_entries:
        f, t, n = e.get("fund"), e.get("acct_type"), e.get("account")
        if f and t is not None and n:
            _fund_accounts.setdefault(f, {}).setdefault(t, n)
    for _b in excel_budgets:
        _unresolved.extend(
            {**entry, "budget_id": _b.get("id"), "budget_label": _b.get("label")}
            for entry in funds_reported_twice(_b.get("rows") or [], _fund_accounts)
        )
    # One numbered table over every budget, in workbook order, with the
    # fee halves the money already settles pre-filled.
    _mapping_table = []
    for _b in excel_budgets:
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
    _inferences = []
    for _b in excel_budgets:
        _inferences.extend(unconfirmed_inferences(_b.get("rows") or [],
                                                  _inference_decisions))
    _mapping_table.extend(inference_rows(_inferences))
    # Spend the report cannot show at all: an account no line names, or the
    # part of one that the scoped lines naming it do not cover. Asked over
    # every budget's lines at once — an account reported by one budget's
    # line is reported.
    _all_budget_rows = [r for _b in excel_budgets for r in (_b.get("rows") or [])]
    # Over the months the budgets cover, not the months the ledger runs to.
    # Widest window among them: an entry any budget could report is not
    # unreported. Charging out-of-period spend against a budget that stops
    # earlier is how an account that is properly covered reads as a gap.
    # A budget with no whole period yet states no window; if none of them
    # do, there is nothing to hold the ledger to and every entry is read,
    # which is the behaviour before this scoping existed.
    _wins = [w for w in (_budget_window(_b, max_mo) for _b in excel_budgets) if w]
    _window = ((min(w[0] for w in _wins), max(w[1] for w in _wins))
               if _wins else None)
    _unaccounted = unaccounted_accounts(_all_budget_rows, all_rows,
                                        _carta_account_names,
                                        read_account_decisions(dashboard),
                                        window=_window)
    _mapping_table.extend(account_rows(_unaccounted))
    for _i, _row in enumerate(_mapping_table, 1):
        _row["n"] = _i
    for _b in excel_budgets:
        apply_dimension_residual(_b.get("rows") or [], _claims, all_rows)
    _unclaimed = unclaimed_dimension_values(_claim_census, _claims)

    _gaps = {
        "unresolved": len(_unresolved),
        "budget_only": sum(1 for _b in excel_budgets
                           for r in (_b.get("rows") or []) if r.get("void")),
        "widened": _widened,
        "unclaimed": len(_unclaimed),
        "inferred": len(_inferences),
        "unaccounted": len(_unaccounted),
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
            built = build_variance_categories(raw_budget, accounts, ft, as_of_month,
                                             entries=all_rows, value_aliases=variance_aliases,
                                             dimension=dimension,
                                             coa_types=set(_coa_all) or None)
            if not built:
                continue
            built["id"] = parsed.get("id")
            built["label"] = parsed.get("label") or built.get("budget_label")
            sets.append(built)
        if sets:
            variance_categories = {"budgets": sets, "default_id": sets[0].get("id")}
    elif budgets.get("rows"):
        built = build_variance_categories(carta_variance_payload(budgets),
                                          accounts, "Firm Total",
                                          as_of_month, entries=all_rows)
        if built:
            built["id"] = "carta"
            built["label"] = "Carta budget"
            variance_categories = {"budgets": [built], "default_id": "carta"}

    vendor_spend = build_vendor_spend(all_rows, _vendor_map, _vendor_agg)

    # --- Currency -----
    # None when manco-currency.txt is absent (e.g. an older raw dir fetched
    # before Query D existed) — the app must render '—' in that case, never
    # assume USD.
    currency = read_currency(raw)

    # --- Cash -----
    # Reads the currency: it picks which per-currency total the dashboard shows.
    cash = read_cash_balance(raw, args.manco_entity_id, currency)

    # --- Assemble snapshot.json -----
    # Without a workbook the firm still has whatever budget it keeps in
    # Carta. That has no department or tag dimension, so the account is the
    # only axis it can offer — but a per-account Budget vs Actuals is still
    # the page the operator came for, and it was previously not rendered at
    # all.
    selectable_budgets = excel_budgets
    if not selectable_budgets and (budgets.get("rows") or []):
        selectable_budgets = [{
            **budgets,
            "id":         "carta",
            "label":      "Carta budget",
            "view_kinds": ["by-account"],
            # The app dates its period columns from this.
            "period_year": args.as_of_year,
            "period": {
                "first_month": 1,
                "last_month":  as_of_month,
                "label": f"Jan\u2013{_MONTH_ABBR[as_of_month - 1]} {args.as_of_year}",
            },
        }]

    snapshot = {
        "firmName":    args.firm_name,
        "entityLabel": args.manco_name,
        "asOf":        args.as_of,
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
            "budgets":       [{
                "id":            b.get("id") or "primary",
                "label":         b.get("label") or "Budget",
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
                # Every view this budget's data structurally supports,
                # beyond view_kinds[0] above; views[view_kinds[0]] always
                # equals rows/by_tag_value above.
                **dict(zip(("available_view_kinds", "views"),
                           budget_view_fields(b, as_of_month))),
            } for b in selectable_budgets],
        },
    }

    accounts_data = {
        "asOf":            args.as_of,
        "manco_uuid":      args.manco_uuid,
        # Lets a later run reopen this (firm, manco) from cache with no MCP call.
        "firm_uuid":       args.firm_uuid,
        "firm_carta_id":   args.firm_carta_id,
        "manco_carta_id":  args.manco_carta_id,
        "manco_entity_id": args.manco_entity_id,
        "carta_environment": getattr(args, "carta_environment", "production"),
        "accounts":   accounts,
        "monthly_categories": monthly_categories,
        "entries":            all_rows,
        "fund_fee_entries":   fund_fee_entries,
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
                   help="from Step 1's <SERVER>-name classification (firm-resolution.md) — "
                        "served to the browser's Snowplow tracker; defaults to production")
    args = p.parse_args()
    if not args.as_of_year:
        args.as_of_year = int(args.as_of.split("-")[0])
    build(args)


if __name__ == "__main__":
    main()
