#!/usr/bin/env python3
"""record_mapping.py — CLI onto a ManCo dashboard dir's mapping state.

`query` is a read-only subcommand family:

  query unresolved   <dashboard-dir>   budget lines with no actuals yet
  query inferences   <dashboard-dir>   wording-derived matches awaiting confirm/reject
  query unaccounted  <dashboard-dir>   accounts with spend no budget line reports
  query entries      <dashboard-dir> [--account] [--sub-account] [--vendor] [--tag]

Every query reads fields `build_manco_datadir.py` already wrote to
`accounts.json`; nothing here re-derives them. `query` never writes.

Stdlib-only, Python 3.9-safe.
"""

import argparse
import json
import sys
from pathlib import Path


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


def _add_dashboard_dir_arg(parser):
    parser.add_argument("dashboard_dir", help="a ManCo dashboard dir (built by build_manco_datadir.py)")


def build_parser():
    parser = argparse.ArgumentParser(
        prog="record_mapping.py",
        description="Query and (in a later version) record a ManCo dashboard "
                     "dir's budget-mapping state.")
    commands = parser.add_subparsers(dest="command", required=True)

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


def main(argv=None):
    args = build_parser().parse_args(argv)

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

    return 1


if __name__ == "__main__":
    sys.exit(main())
