#!/usr/bin/env python3
"""manco_gl_matching.py — carta-manco-reporting's chart-of-accounts and GL
matching: translating a workbook's own GL codes through Carta's chart and
dropping codes a firm's own books don't carry, linking a budget row to an
account by an exact or near-exact name match, the client's recorded answer
for a row apply_budget_mapping resolves against, scoring how well a label
resembles an account's name when none of the exact passes do
(suggest_gl_accounts), and resolving a workbook formula's own cell
references into the GL codes its referenced rows carry.
"""

import difflib
import json
import re
from collections import defaultdict
from pathlib import Path

from manco_labels import _label_tokens, _norm_label, is_income_section
from manco_mapping_store import (
    REMOVED, VOID, _read_mapping_or_empty, _recorded_decision,
    ambiguous_bare_addrs, assign_row_addresses, mapping_section,
)
from shapes import formula_infer, vocab

_LABEL_GL_RX = re.compile(r"\s*(\d{3,5})\b")


_GL_NAME_STOPWORDS = {"and", "the", "of", "fee", "fees", "income", "expense",
                      "expenses", "other", "misc"}


_LABEL_PREFIX_RX = re.compile(r"^\s*([^\s].*?)\s*[-–—:]\s+")


def translate_own_codes_from_coa(rows, coa_records):
    """Fill in `gl_codes` for a budget line stated in the firm's own chart
    of accounts, when the mapping tab records that code's Carta equivalent.

    A firm's own code can coincidentally fall in Carta's leading-4-to-7-
    digit income/expense range (`pnl_outline._native_gl_code`'s own
    signal for "this label states a Carta account") — nothing about a
    firm's numbering has to avoid Carta's, since the two schemes are
    unrelated. `own_code` on a coa-mapping.json record is the one place
    that distinction is actually made, so this pass runs ahead of
    `drop_foreign_gl_codes`: a translated line has a real `gl` behind it,
    not a guess to be second-guessed by a name-token comparison.

    Only a line with no `gl_codes` yet is touched — never overrides a code
    a stronger pass (the mapping's own category match, or an operator's
    recorded decision) already settled.
    """
    by_own_code = {}
    for rec in coa_records or []:
        code = str(rec.get("own_code") or "").strip().lower()
        gl = rec.get("gl")
        if code and isinstance(gl, int):
            by_own_code.setdefault(code, gl)
    if not by_own_code:
        return 0
    translated = 0
    for row in rows or []:
        if row.get("row_kind") != "line" or row.get("gl_codes"):
            continue
        label = str(row.get("label") or "")
        m = _LABEL_PREFIX_RX.match(label)
        prefix = (m.group(1) if m else label).strip().lower()
        gl = by_own_code.get(prefix)
        if gl is None:
            continue
        row["gl_codes"] = [gl]
        translated += 1
    return translated


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
    return mapping_section(_read_mapping_or_empty(dashboard_dir), ("accounts",))


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
    out = []
    for row in rows:
        decision = _recorded_decision(mapping, row, ambiguous_bare_addrs) or {}
        status = decision.get("status")
        if status == REMOVED:
            continue
        if status == VOID:
            row["void"] = True
        if decision.get("fund"):
            row["fund_match"] = decision["fund"]
        # How to report a fee offset the ManCo books no account for:
        # "omit" or "fund_ledger". See fee_offset_asks.
        if decision.get("fee_source"):
            row["fee_source"] = decision["fee_source"]
        # An empty list is an answer, not a missing one: on a per-fund line
        # it says the line is the net of every account the fund posts to.
        if decision.get("gl_codes") is not None:
            row["gl_codes"] = [int(g) for g in decision["gl_codes"]]
            # An operator's own answer is never re-flagged as zero-activity —
            # see zero_activity_mapped_rows.
            row["gl_decided"] = True
        if "scope" in decision and not decision["scope"]:
            # An explicit null is an answer: this line covers its accounts
            # whole, whatever sub-account or tag the entries happen to carry.
            # Absent, the line is merely unanswered and gets asked about.
            row["scope_none"] = True
        elif decision.get("scope"):
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


# Same leading-digit convention build()'s is_income/is_expense use: 1-3 is a
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
                        section=None, activity_by_gl=None, subaccount_gls=None):
    """Carta accounts a budget line might mean — proposed, never applied.

    The client's mapping names lines more briefly than their budget does,
    so an exact match leaves real coverage on the table while a loose one
    joins the wrong account silently. These are offered for confirmation
    instead: the operator answers once and the answer is recorded.

    `activity_by_gl` (gl -> YTD activity) ranks a candidate the ManCo has
    actually spent from ahead of one with the same name but no activity —
    the difference between "Other fees" (zero activity) and the account
    the line really means. `subaccount_gls` (normalized name -> set of gl)
    proposes the account a same-named vendor or sub-account posts to, which
    a name match on the account's own category alone can miss.
    """
    by_cat = {}
    for rec in mapping_records or []:
        cat, gl = _norm_label(rec.get("category")), rec.get("gl")
        if cat and isinstance(gl, int):
            by_cat.setdefault(cat, set()).add(gl)
    doc_freq = _token_doc_freq(account_names)
    subaccount_gls = subaccount_gls or {}

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
        for gl in sorted(subaccount_gls.get(norm, ())):
            offer(gl, f'a sub-account or vendor named "{comp}" posts here', comp)
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
        for gl, name, ratio in _accounts_by_resemblance(label, account_names, activity_by_gl):
            offer(gl, f"a Carta account with a similar name ({ratio:.0%})", None)
            if len(out) >= limit:
                break
    if activity_by_gl:
        # Stable sort: an account with activity leads, but candidates tie
        # on that in the order they were found above — a name match still
        # outranks a resemblance guess among equally "live" accounts.
        out.sort(key=lambda o: 0 if activity_by_gl.get(o["gl"]) else 1)
    return out[:limit * max(1, len(_label_components(label)))]


# How alike two names have to read before one is worth offering for the
# other. Measured on a real firm: the line the operator wanted scored .70
# and the next candidate .61, so this sits below the answer and above most
# of the noise — and everything it admits is a proposal a person confirms.
_ACCOUNT_RESEMBLANCE_MIN = 0.6


def _accounts_by_resemblance(label, account_names, activity_by_gl=None):
    """Carta accounts whose name reads like this line's, best first.

    An account with YTD activity ranks ahead of one with none at the same
    resemblance — two accounts can read equally alike, but only one of them
    is an account the firm actually uses.
    """
    want = vocab.normalize(str(label or ""))
    if not want:
        return []
    scored = []
    for gl, name in (account_names or {}).items():
        other = vocab.normalize(str(name or ""))
        if not other:
            continue
        ratio = difflib.SequenceMatcher(None, want, other).ratio()
        if ratio >= _ACCOUNT_RESEMBLANCE_MIN:
            scored.append((ratio, gl, name))
    scored.sort(key=lambda x: (0 if activity_by_gl and activity_by_gl.get(x[1]) else 1,
                               -x[0], x[1]))
    return [(gl, name, ratio) for ratio, gl, name in scored]


def _formula_row_index(excel_budgets):
    """`{(sheet_name, row_ix): row}` across every parsed budget for this
    firm, so a formula on one sheet can resolve against another's rows."""
    index = {}
    for b in excel_budgets:
        sheet = (b.get("workbook_meta") or {}).get("sheet")
        if not sheet:
            continue
        for r in b.get("rows") or []:
            if r.get("row_ix") is not None:
                index[(sheet, r["row_ix"])] = r
    return index


def _index_row_gl_codes(index, sheet_name):
    return lambda row_ix: (index.get((sheet_name, row_ix)) or {}).get("gl_codes") or []


def _dashboard_workbook_path(dashboard_dir):
    """The source workbook `.workbook-ref.json` recorded, if it is still
    there to read.

    Best-effort only, for the raw-label fallback below — a moved, renamed,
    or deleted workbook just means that fallback finds nothing, same as if
    it were never attempted. This does not affect the existing parsed-JSON
    pipeline (`find_excel_budget_files`), which deliberately never checks
    this path exists at all.
    """
    if not dashboard_dir:
        return None
    try:
        ref = json.loads((Path(dashboard_dir) / ".workbook-ref.json").read_text())
    except (OSError, ValueError):
        return None
    path = ref.get("path")
    return path if path and Path(path).is_file() else None


def _raw_row_label(workbook_path, sheet_name, row_ix, _cache):
    """The text one column left of an arbitrary row on a sheet this build
    never parsed as a budget of its own — the label convention this
    plugin's own budget shapes already assume everywhere else.

    `_cache` (a plain dict the caller owns for one `resolve_formula_gl_evidence`
    run) keeps this to one `load_workbook` per source file regardless of how
    many rows get looked up. Silent on any failure — a missing file, a
    renamed sheet, or a blank cell all just mean no label to match; nothing
    here is asserted to succeed.
    """
    if not workbook_path or not sheet_name:
        return None
    if workbook_path not in _cache:
        try:
            from openpyxl import load_workbook
            _cache[workbook_path] = load_workbook(
                workbook_path, read_only=True, data_only=True)
        except Exception:
            _cache[workbook_path] = None
    wb = _cache[workbook_path]
    if wb is None or sheet_name not in wb.sheetnames:
        return None
    try:
        value = wb[sheet_name].cell(row=row_ix, column=1).value
    except Exception:
        return None
    text = str(value).strip() if value not in (None, "") else ""
    return text or None


def resolve_formula_gl_evidence(excel_budgets, known_gl_codes=None,
                                 account_names=None, dashboard_dir=None):
    """Fill in `formula_gl_codes` for a row whose formula sums other rows'
    GL identity, or whose `SUMIF`/`SUMIFS` names a literal GL code.

    Run after autolink/native-code/mapping-file resolution — a referenced
    row's `gl_codes` is only as complete as whatever ran ahead of this.
    `formula_infer` itself reads parsed JSON, not the live workbook — but a
    referenced row it still can't identify (no `gl_codes` of its own,
    typically because the row lives on a sheet this build never parsed as
    a budget) gets one further, optional try here: read that row's own
    label straight off the source workbook and match it against Carta's
    chart of accounts, exactly as a budget line's own label is matched
    elsewhere. Only ever on an unambiguous single match — a label that
    reads like more than one account, or none, is left for Step 4.7 to
    ask about, the same as before this existed.
    """
    index = _formula_row_index(excel_budgets)
    workbook_path = _dashboard_workbook_path(dashboard_dir)
    workbook_cache = {}
    for b in excel_budgets:
        sheet = (b.get("workbook_meta") or {}).get("sheet")
        for row in b.get("rows") or []:
            if row.get("gl_codes") or not row.get("source_formula"):
                continue
            formula = row["source_formula"]
            other_sheet = formula_infer.referenced_sheet(formula)
            other_lookup = None
            if other_sheet and other_sheet != "__ambiguous__":
                other_lookup = _index_row_gl_codes(index, other_sheet)
            result = formula_infer.infer_gl_codes(
                formula,
                row_gl_codes=_index_row_gl_codes(index, sheet),
                other_sheet_row_gl_codes=({other_sheet: other_lookup} if other_lookup else None),
                known_gl_codes=known_gl_codes,
            )
            resolved = set(result["resolved"])
            unresolved_rows = result.get("unresolved_rows") or []
            if unresolved_rows and account_names and workbook_path:
                label_sheet = other_sheet if other_sheet and other_sheet != "__ambiguous__" else sheet
                for r in unresolved_rows:
                    label = _raw_row_label(workbook_path, label_sheet, r, workbook_cache)
                    resolved.update(_label_gl_codes_if_unambiguous(label, account_names))
            if resolved:
                row["formula_gl_codes"] = sorted(resolved)


def _label_gl_codes_if_unambiguous(label, account_names):
    """A referenced row's own raw label, matched to exactly one Carta
    account — never a guess between two, never picked from none.

    Reuses `suggest_gl_accounts`'s name-matching rather than a second
    matcher: the standard for "unambiguous" here is the same one
    `mapping_table()` already applies to a budget line's own label.
    """
    if not label or not account_names:
        return []
    candidates = suggest_gl_accounts(label, None, account_names)
    return [candidates[0]["gl"]] if len(candidates) == 1 else []


def _formula_gl_suggestions(row, account_names):
    """Formula-derived GL candidates for a line with no GL code of its own.

    Filtered to codes Carta actually has — a formula resolving to a code
    outside the roster is not a real account to propose.
    """
    codes = [c for c in (row.get("formula_gl_codes") or []) if c in account_names]
    return [{"gl": c, "name": account_names.get(c),
             "why": "read off your workbook's own formula", "component": None}
            for c in codes]


def _merge_formula_and_name_suggestions(formula_accounts, name_accounts):
    """Formula evidence outranks a name match, but disagreement between the
    two is surfaced, never silently resolved either way — see
    `mapping_table()`'s single-suggestion rule for what "returned alone"
    (one candidate list) buys a row versus every candidate kept.
    """
    if len(formula_accounts) == 1:
        only = formula_accounts[0]
        agrees = not name_accounts or (
            len(name_accounts) == 1 and name_accounts[0].get("gl") == only.get("gl")
        )
        if agrees:
            return formula_accounts
    seen = {a.get("gl") for a in formula_accounts}
    return formula_accounts + [a for a in name_accounts if a.get("gl") not in seen]


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

