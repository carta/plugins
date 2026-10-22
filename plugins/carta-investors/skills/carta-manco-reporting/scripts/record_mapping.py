#!/usr/bin/env python3
"""record_mapping.py — CLI onto a ManCo dashboard dir's mapping state.

`query` is a read-only subcommand family:

  query unresolved   <dashboard-dir>   budget lines with no actuals yet
  query inferences   <dashboard-dir>   wording-derived matches awaiting confirm/reject
  query unaccounted  <dashboard-dir>   accounts with spend no budget line reports
  query entries      <dashboard-dir> [--account] [--sub-account] [--vendor] [--tag]

Every query reads fields `build_manco_datadir.py` already wrote to
`accounts.json`; nothing here re-derives them. `query` never writes.

The write subcommands are the only way Step 4.7's answers reach
`budget-mapping.json`. Each merges through `update_mapping()` under the
file's lock and stamps the answer with `--source` (required) and the time it
was recorded; an answer identical to the one on file writes nothing:

  answer            <dashboard-dir> <addr> [--fund <name>] [--gl <code> ... | --net]
                                            | (--budget-only | --remove
                                               | --fee-source omit|fund_ledger) [--note <text>]
  scope             <dashboard-dir> <addr> (--none | --vendor X | --sub X | --tag C=V)
  confirm-inference <dashboard-dir> <key> [--lines <n>]
  reject-inference  <dashboard-dir> <key>
  fund              <dashboard-dir> (--entry <id> | --memo <text>) --fund <fund_uuid>
  not-expected      <dashboard-dir> <gl>

Stdlib-only, Python 3.9-safe.
"""

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_manco_datadir as build  # noqa: E402


def _read_json(path):
    """A missing file inside an existing dashboard dir reads as empty — a
    cold dashboard dir (no build yet) is a normal state to query. A missing
    dashboard dir, or a file that fails to parse, is an error: either means
    the CLI cannot actually answer the query, and staying silent about that
    would look like "everything resolved" to whoever is reading the output."""
    path = Path(path)
    if not path.parent.is_dir():
        sys.exit(f"record_mapping.py: no such dashboard dir: {path.parent}")
    try:
        return json.loads(path.read_text())
    except FileNotFoundError:
        return {}
    except ValueError as e:
        sys.exit(f"record_mapping.py: {path} is not valid JSON: {e}")


def load_accounts(dashboard_dir):
    """`accounts.json` — the build's own computed state. Single source for
    unresolved rows, inferences, unaccounted accounts and entries."""
    return _read_json(Path(dashboard_dir) / "accounts.json")


def load_mapping_rows(dashboard_dir):
    """`budget-mapping.json`'s `rows` — the operator's own recorded answers,
    same shape `record_budget_mapping()` merges into (build_manco_datadir.py)."""
    return _read_json(Path(dashboard_dir) / "budget-mapping.json").get("rows") or {}


def query_unresolved(accounts):
    """Budget lines that will render with no actuals, and what each needs —
    `unresolved_budget_rows()`'s own output, already written to accounts.json."""
    return accounts.get("unresolvedBudgetRows") or []


def query_inferences(accounts):
    """Wording-derived matches nobody has confirmed or rejected yet.

    These travel inside `mappingTable` (`inference_rows()`'s rows, folded in
    alongside the other mapping asks by `build_manco_datadir.py`) rather than
    their own top-level key, so the filter is on `needs == "inference"`.
    """
    return [row for row in (accounts.get("mappingTable") or [])
            if row.get("needs") == "inference"]


def query_unaccounted(accounts):
    """Accounts carrying activity that no budget line reports —
    `unaccounted_accounts()`'s own output."""
    return accounts.get("unaccountedAccounts") or []


def _contains(haystack, needle):
    return bool(needle) and needle.lower() in (haystack or "").lower()


def _entry_matches(entry, account=None, sub_account=None, vendor=None, tag=None):
    """One entry's own fields, matched the way an operator thinks of them:
    an account by GL code or by name substring, a sub-account/vendor by
    substring, a tag by bare value or `category=value`."""
    if account:
        gl = entry.get("acct_type")
        if str(account) != str(gl) and not _contains(entry.get("account"), account):
            return False
    if sub_account and not (_contains(entry.get("sub"), sub_account)
                             or _contains(entry.get("sub_code"), sub_account)):
        return False
    if vendor and not _contains(entry.get("vendor"), vendor):
        return False
    if tag:
        category, has_category, value = tag.partition("=")
        tags = entry.get("tags") or []
        if has_category:
            if not any(t.get("category") == category and t.get("value") == value
                       for t in tags):
                return False
        elif not any(_contains(t.get("value"), tag) for t in tags):
            return False
    return True


def query_entries(accounts, account=None, sub_account=None, vendor=None, tag=None):
    """Journal-entry lines from `accounts.json["entries"]`, filtered.

    With no filter at all, returns every entry — callers that want that
    should say so explicitly rather than get it by accident of omitted flags.
    """
    return [e for e in (accounts.get("entries") or [])
            if _entry_matches(e, account, sub_account, vendor, tag)]


_STAMP_KEYS = ("source", "recorded_at")


def _now():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def stamped(fields, source):
    """`fields` as an answer stamped with who gave it and when."""
    return {**fields, "source": source, "recorded_at": _now()}


def _decision_fields(prior):
    """An answer already on file, without its stamp — what a new answer to
    the same row merges onto (a scope answer keeps the row's GL codes, a GL
    answer keeps its scope), and what an unchanged restatement equals."""
    if prior is None:
        return {}
    if not isinstance(prior, dict):
        prior = build.fund_answer(prior)
    return {k: v for k, v in prior.items() if k not in _STAMP_KEYS}


# What an `answer` states whole: a new one replaces all three, so a corrected
# line never keeps the fund or accounts of the answer it corrects.
_LINE_DECISION_KEYS = ("fund", "gl_codes", "status")


def answer_fields(prior, gl_codes=None, net=False, fund=None, budget_only=False,
                  remove=False, fee_source=None, note=None):
    """A row's decision: its fund and GL account(s) together (`net` is every
    account its fund posts to — an empty list), budget-only, or removed.
    `fee_source` — how to report a fee offset the ManCo books no account for —
    is the one answer that leaves the line's fund and accounts as found.
    The row's `scope`, `fee_source` and `notes` carry over either way."""
    fields = _decision_fields(prior)
    if fee_source:
        fields["fee_source"] = fee_source
    else:
        for key in _LINE_DECISION_KEYS:
            fields.pop(key, None)
        if budget_only or remove:
            fields["status"] = build.REMOVED if remove else build.VOID
        else:
            if fund:
                fields["fund"] = fund
            if net:
                fields["gl_codes"] = []
            elif gl_codes:
                fields["gl_codes"] = [int(g) for g in gl_codes]
    if note:
        fields["notes"] = note
    return fields


def scope_value(none=False, vendor=None, sub=None, tag=None):
    """The `scope` a row answer records — the shape apply_budget_mapping reads.
    `None` is an answer too: the line covers its accounts whole."""
    if none:
        return None
    if vendor:
        return {"source": "vendor", "value": vendor}
    if sub:
        return {"source": "sub_account", "value": sub}
    category, sep, value = (tag or "").partition("=")
    if not (sep and category and value):
        raise ValueError(f"--tag takes 'category=value', got {tag!r}")
    return {"source": "reporting_tag", "category": category, "value": value}


def known_row_addrs(dashboard_dir):
    """The address of every line of the operator's own budgets the last build
    read — addressed the way the build and copy_budget_mapping address them.
    A decision recorded under any other address is never applied, so it is
    refused instead of written."""
    out = set()
    for budget in build._last_build_own_budgets(dashboard_dir):
        rows = [dict(r) for r in budget.get("rows") or []]
        build.assign_row_addresses(rows, budget_id=budget.get("id"))
        out.update(r["addr"] for r in rows)
    return out


def open_inference(accounts, key):
    """The mapping-table row for an inference nobody has answered yet."""
    addr = build.INFERENCE_ADDR_PREFIX + key
    return next((r for r in query_inferences(accounts) if r.get("addr") == addr), None)


def inference_ack_refusal(row, lines):
    """Why a confirmation can't be recorded yet, or None when it can.

    An inference that reaches many rows, or matches on a one-word value,
    moves enough money to be confirmed only with its row count stated back
    (`--lines`) — the count the gate showed the operator.
    """
    if "line_count" not in row:
        return ("accounts.json predates line counts on inferences; rebuild "
                "(Step 4) before confirming")
    if row.get("needs_line_ack") and lines != row["line_count"]:
        return (f"this inference touches {row['line_count']} line(s); confirm it "
                f"only once the operator has seen that count, with "
                f"--lines {row['line_count']}")
    return None


def _refuse(message):
    sys.exit(f"record_mapping.py: {message}")


def plan_write(args, dashboard_dir):
    """What one write subcommand records: `(section, key, decide, report)`.

    `decide(prior)` is called inside the mapping file's lock with the answer
    already on file under `key` (None when there is none). It returns the
    new answer's decision fields, or exits with the reason it is refused.
    Anything it needs from the last build is read here, before the lock.
    `report` is printed alongside the recorded answer.
    """
    if args.command in ("answer", "scope"):
        known = known_row_addrs(dashboard_dir)

        def decide(prior):
            if prior is None and args.addr not in known:
                _refuse(f"no budget line has addr {args.addr!r} in the last build; "
                        f"`query unresolved` lists the open ones")
            if args.command == "answer":
                return answer_fields(prior, gl_codes=args.gl, net=args.net, fund=args.fund,
                                     budget_only=args.budget_only, remove=args.remove,
                                     fee_source=args.fee_source, note=args.note)
            try:
                value = scope_value(none=args.none, vendor=args.vendor, sub=args.sub, tag=args.tag)
            except ValueError as e:
                _refuse(e)
            return {**_decision_fields(prior), "scope": value}

        return ("rows",), args.addr, decide, {}

    if args.command in ("confirm-inference", "reject-inference"):
        row = open_inference(load_accounts(dashboard_dir), args.key)
        confirming = args.command == "confirm-inference"

        def decide(prior):
            if row is None and prior is None:
                _refuse(f"{args.key!r} is not an open inference; `query inferences` lists them")
            # A confirmation is recorded only against a row whose count was
            # checked, or as a restatement of one already confirmed. A
            # rejected inference scopes no line, so no rebuild brings its
            # count back: it stays rejected (scope the lines instead).
            if confirming and row is None and _decision_fields(prior) != {"status": build.CONFIRMED}:
                _refuse(f"{args.key!r} is not open in the last build, so its line "
                        f"count can't be shown; it can't be confirmed")
            if confirming and row is not None:
                refusal = inference_ack_refusal(row, args.lines)
                if refusal:
                    _refuse(refusal)
            return {"status": build.CONFIRMED if confirming else build.REJECTED}

        return ("inferences",), args.key, decide, {"line_count": (row or {}).get("line_count")}

    if args.command == "fund":
        section = ("fund_attribution", "by_id" if args.entry else "by_memo")
        return section, args.entry or args.memo, lambda prior: {"fund": args.fund}, {}

    return ("accounts",), str(args.gl), lambda prior: {"status": build.NOT_EXPECTED}, {}


def record(args):
    """Record one write subcommand's answer; exits with the reason on refusal.

    An answer identical to the one on file writes nothing: restating an
    answer is not giving it, so the one on file keeps its own stamp.
    """
    dashboard_dir = args.dashboard_dir
    if not Path(dashboard_dir).is_dir():
        _refuse(f"no such dashboard dir: {dashboard_dir}")
    section, key, decide, report = plan_write(args, dashboard_dir)
    recorded = {}

    def compute(mapping):
        prior = build.mapping_section(mapping, section).get(key)
        fields = decide(prior)
        if prior is not None and _decision_fields(prior) == fields:
            recorded["answer"] = prior
            return {}
        recorded["answer"] = stamped(fields, args.source)
        return {key: recorded["answer"]}

    try:
        changed = build.update_mapping(dashboard_dir, section, compute)
    except RuntimeError as e:
        _refuse(e)
    return {"section": ".".join(section), "key": key, "answer": recorded["answer"],
            "changed": changed, **report}


def _add_dashboard_dir_arg(parser):
    parser.add_argument("dashboard_dir", help="a ManCo dashboard dir (built by build_manco_datadir.py)")


def _add_write_command(commands, name, help_text):
    parser = commands.add_parser(name, help=help_text)
    _add_dashboard_dir_arg(parser)
    parser.add_argument(
        "--source", required=True, choices=build.MAPPING_SOURCES,
        help="'operator' for an answer the operator gave; 'operator-delegated' "
             "for one made on their behalf ('do your best')")
    return parser


def build_parser():
    parser = argparse.ArgumentParser(
        prog="record_mapping.py",
        description="Query and record a ManCo dashboard dir's budget-mapping state.")
    commands = parser.add_subparsers(dest="command", required=True)

    answer = _add_write_command(commands, "answer", "record a budget line's GL account(s) or fund, "
                                                    "or that it is budget-only or removed")
    answer.add_argument("addr", help="the line's addr, as accounts.json gives it")
    answer.add_argument("--fund", help="the fund a fee line means, by name; restate it with "
                                       "--gl or --net on a line that reports one fund")
    answer_kind = answer.add_mutually_exclusive_group()
    answer_kind.add_argument("--gl", type=int, action="append", help="a GL code; repeat for more")
    answer_kind.add_argument("--net", action="store_true",
                             help="a fund line: the net of every account its fund posts to")
    answer_kind.add_argument("--budget-only", action="store_true",
                             help="no Carta account: the line renders budget-only")
    answer_kind.add_argument("--remove", action="store_true",
                             help="drop the line from the report entirely")
    answer_kind.add_argument("--fee-source", choices=("omit", "fund_ledger"),
                             help="how to report a fee offset the ManCo books no account for")
    answer.add_argument("--note", help="why, when the answer came from somewhere a later "
                                       "reader can't see (the workbook's own formula)")

    scope = _add_write_command(commands, "scope", "record which slice of its accounts a line reports")
    scope.add_argument("addr", help="the line's addr, as accounts.json gives it")
    scope_kind = scope.add_mutually_exclusive_group(required=True)
    scope_kind.add_argument("--none", action="store_true", help="the line covers its accounts whole")
    scope_kind.add_argument("--vendor", help="a vendor's name")
    scope_kind.add_argument("--sub", help="a sub-account's name")
    scope_kind.add_argument("--tag", help="a reporting tag, as 'category=value'")

    confirm = _add_write_command(commands, "confirm-inference",
                                 "confirm a value read off the workbook's wording")
    confirm.add_argument("key", help="the inference key (its addr minus 'inference:')")
    confirm.add_argument("--lines", type=int,
                         help="the inference's line count, as the operator was shown it")

    reject = _add_write_command(commands, "reject-inference",
                                "reject a value read off the workbook's wording")
    reject.add_argument("key", help="the inference key (its addr minus 'inference:')")

    fund = _add_write_command(commands, "fund", "record which fund a fee line's memo names")
    fund_by = fund.add_mutually_exclusive_group(required=True)
    fund_by.add_argument("--entry", help="one journal entry, by gluuid or id")
    fund_by.add_argument("--memo", help="every entry carrying this exact memo")
    fund.add_argument("--fund", required=True, help="the fund's uuid")

    not_expected = _add_write_command(commands, "not-expected",
                                      "record that an account's spend is not expected in the budget")
    not_expected.add_argument("gl", type=int, help="the account's GL code")

    query = commands.add_parser(
        "query", help="read-only lookups against accounts.json / budget-mapping.json")
    query_kinds = query.add_subparsers(dest="query_kind", required=True)

    unresolved = query_kinds.add_parser(
        "unresolved", help="budget lines with no actuals yet, and what each needs")
    _add_dashboard_dir_arg(unresolved)

    inferences = query_kinds.add_parser(
        "inferences", help="wording-derived matches awaiting confirm/reject")
    _add_dashboard_dir_arg(inferences)

    unaccounted = query_kinds.add_parser(
        "unaccounted", help="accounts with spend no budget line reports")
    _add_dashboard_dir_arg(unaccounted)

    entries = query_kinds.add_parser(
        "entries", help="journal-entry lines, filterable by account, sub-account, vendor or tag")
    _add_dashboard_dir_arg(entries)
    entries.add_argument("--account", help="GL code, or a substring of the account name")
    entries.add_argument("--sub-account", help="substring of the sub-account name or code")
    entries.add_argument("--vendor", help="substring of the vendor name")
    entries.add_argument("--tag", help="a tag value, or 'category=value'")

    return parser


def _check_answer_args(parser, args):
    """An `answer` states something, and a fund goes with accounts or alone —
    never with budget-only, removed, or a fee-offset answer."""
    if args.command != "answer":
        return
    exclusive = args.budget_only or args.remove or args.fee_source
    if not (args.fund or args.gl or args.net or exclusive):
        parser.error("answer needs one of --gl, --net, --fund, --budget-only, "
                     "--remove or --fee-source")
    if args.fund and exclusive:
        parser.error("--fund goes with --gl or --net, not --budget-only, --remove "
                     "or --fee-source")


def main(argv=None):
    parser = build_parser()
    args = parser.parse_args(argv)
    _check_answer_args(parser, args)

    if args.command == "query":
        accounts = load_accounts(args.dashboard_dir)
        if args.query_kind == "unresolved":
            result = query_unresolved(accounts)
        elif args.query_kind == "inferences":
            result = query_inferences(accounts)
        elif args.query_kind == "unaccounted":
            result = query_unaccounted(accounts)
        else:
            result = query_entries(accounts, account=args.account,
                                    sub_account=args.sub_account,
                                    vendor=args.vendor, tag=args.tag)
        print(json.dumps(result, indent=2))
        return 0

    print(json.dumps(record(args), indent=2))
    return 0



if __name__ == "__main__":
    sys.exit(main())
