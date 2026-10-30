#!/usr/bin/env python3
"""Package a built workbook budget as one JSON file for the hosted app's "Import budget".

A fallback path, for whichever audience the build's own sweep (own_sync.py) didn't deliver
this budget to: that sweep only mirrors a budget privately to its owner's own hosted
session (and can fail there too — a refused push, see own_sync.py's docstring), so
colleagues still need this export, shared through "Import budget" rather than own_sync's
Share. The hosted app's "Import budget" control
(app/src/shell/importBudgetFeature.js's IMPORT_BUDGET_ENABLED) is off by default, so this
file has nowhere to go unless that flag is on.

Reads snapshot.json and accounts.json from --dashboard-dir. The hosted app builds each
budget's share payload itself from what this exports. Exits 2 when nothing is safe to export.
Keep SCHEMA_VERSION equal to BUDGET_BUNDLE_SCHEMA in server/worker.js.
"""

import argparse
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

SCHEMA_VERSION = 1


class NothingToExport(Exception):
    pass


def _slug(name):
    return re.sub(r"[^a-z0-9]+", "-", (name or "").lower()).strip("-") or "firm"


def _load(dashboard_dir, name):
    path = Path(dashboard_dir) / name
    try:
        return json.loads(path.read_text())
    except FileNotFoundError:
        raise NothingToExport("%s is missing; build the dashboard first." % path)
    except ValueError as e:
        raise NothingToExport("%s is not valid JSON: %s" % (path, e))


def _unmapped_lines(budgets):
    """Budget lines with no GL code: they render in the hosted app with no actuals."""
    return sum(
        1
        for b in budgets
        for r in (b.get("rows") or [])
        if r.get("row_kind") == "line" and not r.get("void") and not r.get("gl_codes")
    )


def _own_variance(variance, own_ids):
    """varianceByCategory, limited to the budgets this bundle actually carries.

    The build also computes a variance set for every report shared with you, so the
    local dashboard can switch to it — those sets have no business in the hosted bundle,
    same as the `report` metadata the budgets above are stripped of.
    """
    if not variance:
        return variance
    kept = [b for b in (variance.get("budgets") or []) if b.get("id") in own_ids]
    if not kept:
        return None
    default_id = variance.get("default_id")
    if default_id not in own_ids:
        default_id = kept[0].get("id")
    return dict(variance, budgets=kept, default_id=default_id)


def build_bundle(snapshot, accounts, exported_at=None):
    budget = snapshot.get("budget") or {}
    raw_budgets = [b for b in (budget.get("budgets") or []) if b.get("rows")]
    if budget.get("source") != "excel-workbook" or not raw_budgets:
        raise NothingToExport(
            "This dashboard has no workbook budget (source is %r). "
            "Parse a budget tab and rebuild before exporting." % budget.get("source")
        )
    # Reports shared with you stay out of the hosted bundle: `report` carries
    # recipient names and emails that have no business in Worker KV, and the
    # hosted app has no way to show "read-only, not yours" for a budget anyway.
    budgets = [
        {k: v for k, v in b.items() if k != "report"}
        for b in raw_budgets
        if not (b.get("report") or {}).get("read_only")
    ]
    if not budgets:
        raise NothingToExport(
            "Every budget on this dashboard was shared with you, not your own — "
            "nothing of yours to export."
        )
    budget = dict(budget, budgets=budgets)
    # The bundle is stored and shown next to the firm's live numbers; a guessed
    # currency would put one firm's budget under another's symbol.
    currency = (snapshot.get("currency") or "").strip().upper()
    if not re.fullmatch(r"[A-Z]{3}", currency):
        raise NothingToExport(
            "The snapshot has no currency (manco-currency.txt was not fetched). "
            "Re-run the data fetch; the export will not assume one."
        )
    firm_uuid = (accounts.get("firm_uuid") or "").strip()
    if not firm_uuid:
        raise NothingToExport("accounts.json has no firm_uuid; rebuild the dashboard.")

    workbook = next(
        ((b.get("workbook_meta") or {}).get("filename") for b in budgets
         if (b.get("workbook_meta") or {}).get("filename")),
        None,
    )
    return {
        "schema_version": SCHEMA_VERSION,
        "firm_uuid": firm_uuid,
        "currency": currency,
        "as_of": snapshot.get("asOf"),
        "exported_at": exported_at or datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "workbook": workbook,
        "budget": budget,
        "varianceByCategory": _own_variance(snapshot.get("varianceByCategory"), {b["id"] for b in budgets if b.get("id")}),
        # Which field on a journal entry carries this firm's tag/sub-account/vendor
        # breakout, read from the local chart-of-accounts resolution — the hosted
        # Worker has no coa-mapping of its own to resolve this itself.
        "tagCategory": accounts.get("tagCategory"),
        "dimension": accounts.get("dimension"),
        "tagValuesAvailable": accounts.get("tagValuesAvailable"),
    }


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--dashboard-dir", required=True)
    p.add_argument("--out", help="Output file. Default: <dashboard-dir>/manco-budget-<firm-slug>.json")
    args = p.parse_args(argv)

    try:
        snapshot = _load(args.dashboard_dir, "snapshot.json")
        accounts = _load(args.dashboard_dir, "accounts.json")
        bundle = build_bundle(snapshot, accounts)
    except NothingToExport as e:
        print("export_budget_bundle: %s" % e, file=sys.stderr)
        return 2

    out = Path(args.out) if args.out else Path(args.dashboard_dir) / ("manco-budget-%s.json" % _slug(snapshot.get("firmName")))
    # Compact, not indented: indentation alone can nearly triple the file's size (nesting
    # depth), and the Worker, the only reader, rejects anything over 4 MB; nobody edits this
    # file by hand.
    out.write_text(json.dumps(bundle, separators=(",", ":")))

    unmapped = _unmapped_lines(bundle["budget"]["budgets"])
    if unmapped:
        print("export_budget_bundle: %d budget line(s) have no GL code and will show no actuals." % unmapped, file=sys.stderr)
    print(json.dumps({
        "path": str(out),
        "budgets": [{"id": b.get("id"), "label": b.get("label")} for b in bundle["budget"]["budgets"]],
        "currency": bundle["currency"],
        "as_of": bundle["as_of"],
        "unmapped_lines": unmapped,
        "bytes": out.stat().st_size,
    }))
    return 0


if __name__ == "__main__":
    sys.exit(main())
