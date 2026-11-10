#!/usr/bin/env python3
"""manco_gaps.py — carta-manco-reporting's gap detection: spend an account
has posted that no budget line reports (unaccounted_accounts), a GL account
any budget line fails to cover after every resolution pass
(unresolved_budget_rows, native_mapping_coverage), which lines a section's
closing total really covers (mark_widened_totals), the client's
wording-derived matches still awaiting a confirm/reject answer
(unconfirmed_inferences), the ledger activity window those checks run over
(latest_posted_date, gl_activity_totals, gl_names_by_subaccount,
zero_activity_mapped_rows), the numbered tables Step 4.7 asks the operator
through (account_rows, inference_rows, mapping_table), and the one-line
summary of what a build still can't account for (gaps_sentence).
"""

import re

from manco_dimensions import _meaningful_words, dimension_value_of
from manco_fees import suggest_funds
from manco_gl_matching import (
    _formula_gl_suggestions, _merge_formula_and_name_suggestions,
    suggest_gl_accounts,
)
from manco_labels import _norm_label
from manco_mapping_store import CONFIRMED, REJECTED
from shapes import totals_tree
from shapes.vocab import SECTION_INCOME

# A fund_match line reports the ManCo's own aggregate management-fee-income
# account by fund name, not by gl_codes — see BudgetActualsOutline.jsx.
_MANAGEMENT_FEE_INCOME_RX = re.compile(r"management\s+fee", re.IGNORECASE)


def _in_window(entry, window):
    """Whether an entry's month falls inside (first, last), or `window` is None."""
    if window is None:
        return True
    first, last = window
    return first <= (entry.get("mo") or 0) <= last


def latest_posted_date(entries, as_of):
    """The latest entry date in `entries`, never later than `as_of`.

    `_on_or_before` already clips a build's own `entries` to `as_of`, so
    this cap is unreachable from a real build — kept anyway, and tested in
    isolation, because the raw dumps this reads from bound rows by month
    alone (`MONTH(EFFECTIVE_DATE) <= <max month>`, see
    references/data-fetch.md), and a caller one step earlier in the
    pipeline could hand this an entry dated later in the fetch month than
    `as_of`. `server/worker.js`'s `buildData` (its own `lastPostedDate`)
    carries the same cap on the hosted side, where that earlier clip does
    not exist.
    """
    return min(max(r["date"] for r in entries if r.get("date")), as_of)


def gl_activity_totals(entries, window=None):
    """Spend or income posted to each GL account, within `window` if given.

    Shared by `suggest_gl_accounts` (an account the firm has actually used
    outranks one with the same name but none) and
    `zero_activity_mapped_rows` (a mapped account that never posted is the
    same gap from the other side).
    """
    totals = {}
    for e in entries or []:
        gl = e.get("acct_type")
        if gl is None or not _in_window(e, window):
            continue
        totals[gl] = totals.get(gl, 0.0) + abs(float(e.get("amount") or 0))
    return totals


def gl_names_by_subaccount(entries):
    """GL accounts a vendor or sub-account of this name has posted to.

    Keyed by normalized name, so a budget line reading "Office Pantry" can
    be offered the account its namesake sub-account actually posts to, even
    when that account's own category name reads nothing alike.
    """
    out = {}
    for e in entries or []:
        gl = e.get("acct_type")
        if gl is None:
            continue
        for key in (dimension_value_of(e, {"source": "sub_account"}), e.get("vendor")):
            norm = _norm_label(key)
            if norm:
                out.setdefault(norm, set()).add(gl)
    return out


def zero_activity_mapped_rows(rows, activity_by_gl, account_names=None):
    """Budget lines mapped to account(s) with no activity in the window.

    The line resolved — it carries `gl_codes` — but nothing posted there,
    which reads as a correct $0 variance rather than the wrong account. Only
    flagged when every one of a line's accounts is silent: a fee line
    naming both a fee and its offset legitimately has one side quiet some
    periods. A line whose `gl_codes` came from an operator's own answer
    (`gl_decided`) is never flagged — the operator already said this is the
    account, and re-asking it every build because the account stays quiet
    would never let the answer stick.
    """
    out = []
    for row in rows or []:
        if row.get("row_kind") != "line" or row.get("void") or row.get("gl_decided"):
            continue
        gl_codes = row.get("gl_codes") or []
        if not gl_codes or any(activity_by_gl.get(gl) for gl in gl_codes):
            continue
        out.append({
            "key": row.get("key"), "addr": row.get("addr"),
            "label": row.get("label"), "needs": "zero_activity_account",
            "suggestions": [{"gl": gl, "name": (account_names or {}).get(gl),
                            "why": "currently mapped, no activity this window"}
                           for gl in gl_codes],
        })
    return out


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
        if gl is None or not _in_window(e, window):
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
    ids = {r[f] for r in rows or [] for f in ("key", "total_key") if r.get(f)}
    for i, row in enumerate(rows or []):
        if row.get("row_kind") not in _TOTAL_KINDS:
            continue
        if not isinstance(row.get("constituents"), list):
            continue
        # A total whose own formula tree states what it sums is read from
        # that tree — the outline view never widens it, so neither does this.
        if totals_tree.has_usable_tree(row, ids):
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
    if counts.get("zero_activity"):
        parts.append(f"{counts['zero_activity']} mapped line(s) show zero "
                     f"activity this window")
    if counts.get("delegated"):
        parts.append(f"{counts['delegated']} answer(s) made on your behalf "
                     f"(operator-delegated)")
    if counts.get("unattributed"):
        parts.append(f"{counts['unattributed']} answer(s) with no recorded source "
                     f"(written before or outside record_mapping.py)")
    return " · ".join(parts) or None


def unresolved_budget_rows(rows, mapping_records=None, account_names=None,
                           fund_names=None, activity_by_gl=None,
                           subaccount_gls=None):
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
        needs = "fund" if row.get("section") == SECTION_INCOME else "gl_account"
        entry = {"key": row.get("key"), "addr": row.get("addr"),
                 "label": row.get("label"), "needs": needs,
                 "hint": row.get("tag_value")}
        accounts = suggest_gl_accounts(row.get("label"), mapping_records,
                                       account_names or {},
                                       section=row.get("section"),
                                       activity_by_gl=activity_by_gl,
                                       subaccount_gls=subaccount_gls)
        if needs == "gl_account":
            formula_accounts = _formula_gl_suggestions(row, account_names or {})
            entry["suggestions"] = _merge_formula_and_name_suggestions(formula_accounts, accounts)
            # Feeds the "Read the formula to figure this out" option in
            # budget-unresolved.md.
            if row.get("source_formula") and not formula_accounts:
                entry["source_formula"] = row["source_formula"]
        else:
            entry["suggestions"] = suggest_funds(row.get("label"), fund_names)
            # Not every income line is a fund's — a firm earns interest too.
            # Second-choice, so one near fund still pre-fills the table.
            entry["also"] = accounts
        out.append(entry)
    return out


# A mapping tab, the workbook's own formulas and GL codes are combined
# before this ever runs (see backfill_account_type_from_coa,
# translate_own_codes_from_coa, resolve_formula_gl_evidence and the
# autolink pass). Below half the budget still left with neither an actual
# nor a candidate is the signal that those together weren't enough — see
# `native_mapping_coverage`.
_MAPPING_FILE_COVERAGE_FLOOR = 0.5


def native_mapping_coverage(excel_budgets, mapping_table):
    """How much of a firm's budget the native mapping (mapping tab +
    formulas + the workbook's own GL codes) already accounts for, and
    whether that's thin enough to ask for a mapping file over.

    `resolved` is a line the build could actually join to an actual —
    `gl_codes`/`account_type`/`account_type_all`, or a fund match on an
    income line. `proposed` is one `mapping_table` pre-filled a candidate
    for (a formula- or name-matched account, still awaiting confirmation).
    Together they're what Step 4.7's table lets the operator confirm or
    correct in one pass; a budget where neither covers half its lines is
    one that pass can't fix on its own — the honest options table needs
    a file, not more per-row guessing.
    """
    proposed_addrs = {row.get("addr") for row in (mapping_table or [])
                       if row.get("proposed")}
    lines = resolved = proposed = 0
    for b in excel_budgets or []:
        for row in b.get("rows") or []:
            if row.get("row_kind") != "line" or row.get("void"):
                continue
            lines += 1
            if (row.get("gl_codes") or row.get("account_type") is not None
                    or row.get("account_type_all") or row.get("fund_match")):
                resolved += 1
            elif row.get("addr") in proposed_addrs:
                proposed += 1
    needs_mapping_file = bool(lines) and (resolved + proposed) < lines * _MAPPING_FILE_COVERAGE_FLOOR
    return {"lines": lines, "resolved": resolved, "proposed": proposed,
            "needsMappingFile": needs_mapping_file}


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
            if decided.get(inf["key"], {}).get("status") in (CONFIRMED, REJECTED):
                continue
            e = out.setdefault(inf["key"], {
                "key": inf["key"], "source": inf["source"],
                "category": inf.get("category"), "value": inf["value"],
                "field": inf["field"], "lines": [], "row_count": 0,
            })
            # Every row the answer reaches, two lines of one label included;
            # `lines` is only the labels to show.
            e["row_count"] += 1
            if row.get("label") and row["label"] not in e["lines"]:
                e["lines"].append(row["label"])
    return sorted(out.values(), key=lambda x: -x["row_count"])


_ASK_ORDER = {"fund": 0, "fund_account": 1, "gl_account": 2, "scope": 3,
              "fee_offset": 4, "zero_activity_account": 5}


# Below this, an account is still shown but is not its own question.
# Measured across three real firms: a $1,000 floor halves the rows on the
# worst of them while still covering 99% of the unreported money, and
# everything under it across all three came to sixteen accounts and $4,912.
# The small ones are not hidden — see `account_rows`.
_ACCOUNT_ASK_FLOOR = 1000


_ASK_WANTS = {"fund": "which fund", "fund_account": "which half of the fee",
              "gl_account": "which account(s)", "scope": "which value",
              "fee_offset": "how to report the offset",
              "account_line": "which line reports it",
              "account_line_bulk": "are any of these expected",
              "inference": "is this what the wording means",
              "zero_activity_account": "is this the right account"}


_FIELD_SAID = {"label": "the line's own name", "sub_account": "the line's sub-account",
               "tag_value": "the line's tag column",
               "vendor": "the line's vendor",
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


# An inference reaching more rows than this is confirmed only with its count
# stated back — see `needs_line_ack` in inference_rows.
_INFERENCE_ACK_MAX_LINES = 10


# An inference's mapping-table address is this prefix and its key.
INFERENCE_ADDR_PREFIX = "inference:"


def inference_rows(inferences, start=1, account_words=None):
    """Each inference as one row of the same numbered table.

    Pre-filled with the value the build applied, so an operator who agrees
    changes nothing — the answer only has to be typed where it is wrong.

    `line_count` is the number of budget rows the answer reaches — across
    every one of the firm's own budgets, two rows of one label counted
    twice. `needs_line_ack` marks an inference whose confirmation moves
    enough money to be stated line count first: more than
    `_INFERENCE_ACK_MAX_LINES` rows, or a value of one meaningful word
    (`_meaningful_words`, read with Carta's `account_words`).
    record_mapping.py's `confirm-inference` refuses one without
    `--lines <line_count>`.
    """
    out = []
    for inf in inferences or []:
        lines = inf["lines"]
        count = inf["row_count"]
        shown = ", ".join(lines[:3]) + (f" +{len(lines) - 3} more" if len(lines) > 3 else "")
        out.append({
            "n": start + len(out),
            "addr": INFERENCE_ADDR_PREFIX + inf["key"],
            "line": shown,
            "section": f"matched on {_FIELD_SAID.get(inf['field'], inf['field'])}",
            "needs": "inference",
            "wants": _ASK_WANTS["inference"],
            "proposed": inf["value"],
            "why": f"applied to {count} line(s) on this wording alone",
            "answer": {"status": CONFIRMED},
            "options": [inf["value"], "not that value"],
            "line_count": count,
            "needs_line_ack": (count > _INFERENCE_ACK_MAX_LINES
                               or len(_meaningful_words(inf, account_words)) <= 1),
        })
    return out


def _row_answer(row, answer):
    """`answer` as one whole decision for `row`: GL codes on a line that
    reports one fund carry that fund too, since an answer states the line's
    fund and accounts together."""
    if answer and "gl_codes" in answer and row.get("fund_match"):
        return {"fund": row["fund_match"], **answer}
    return answer


def _ask_answer(sug):
    """The decision one candidate stands for, in the shape a row answer
    records it — `fund`, `gl_codes`, or the full `scope`."""
    if sug.get("fund"):
        return {"fund": sug["fund"]}
    if sug.get("gl") is not None:
        return {"gl_codes": [sug["gl"]]}
    if sug.get("source"):
        return {"scope": {k: sug[k] for k in ("source", "category", "value")
                          if sug.get(k) is not None}}
    return None


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
            # A quiet account is never a confident answer, however few of
            # them there are — the account IS the mapping already on the
            # row, so "one suggestion" here means "nothing changed", not
            # "clearly resolved". Always asked, never pre-filled.
            quiet = ask.get("needs") == "zero_activity_account"
            sole = sugs[0] if len(sugs) == 1 and not quiet else None
            out.append({
                "n": len(out) + 1,
                "addr": row.get("addr"),
                "line": row.get("label"),
                "tab": tab_name,
                "budget_section": _budget_section_label(row),
                "needs": ask.get("needs"),
                "wants": ("which fund, or which account"
                          if ask.get("needs") == "fund" and ask.get("also")
                          else _ASK_WANTS.get(ask.get("needs"), ask.get("needs"))),
                "proposed": picked["label"] if picked else (_ask_option(sole) if sole else None),
                "why": (picked or sole or {}).get("why"),
                # What "Yes, confirm all" records for this row.
                "answer": _row_answer(row, {"gl_codes": picked["gl_codes"]} if picked
                                      else _ask_answer(sole) if sole else None),
                "options": [_ask_option(s) for s in sugs + (ask.get("also") or [])],
            })
    return out

