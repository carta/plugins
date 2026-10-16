#!/usr/bin/env python3
"""Package a built workbook budget as one JSON file for the hosted app's "Import budget".

Reads snapshot.json, accounts.json and each budget's .reports/<id>.share.json from
--dashboard-dir. Exits 2 when nothing is safe to export.
Keep SCHEMA_VERSION equal to BUDGET_BUNDLE_SCHEMA in server/worker.js.
"""

import argparse
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

import report_payload
import report_store

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


def _share_for_budget(dashboard_dir, budget_id):
    """The budget's share payload, ready to upload — or None, with the reason on stderr.

    A budget the last build never got as far as sharing (a brand-new workbook row, or one
    whose share_payload build raised) has no share.json yet; the bundle still exports,
    just without that one budget's `share` field.
    """
    if dashboard_dir is None or not budget_id:
        return None
    store = report_store.ReportStore(dashboard_dir)
    try:
        payload = store.read_share_payload(budget_id)
        report_payload.validate(payload)
    except report_store.ReportEditError:
        print(
            "export_budget_bundle: %s has no readable share payload (%s missing or "
            "unreadable); rebuild the dashboard to produce it. Exporting it without sharing."
            % (budget_id, store.share_payload_path(budget_id)),
            file=sys.stderr,
        )
        return None
    except report_payload.PayloadError as e:
        print("export_budget_bundle: %s's share payload is invalid (%s); exporting it without sharing." % (budget_id, e), file=sys.stderr)
        return None
    return {
        "schema_version": report_payload.SCHEMA_VERSION,
        "payload": payload,
        "fingerprint": report_store.payload_fingerprint(payload),
    }


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


def build_bundle(snapshot, accounts, dashboard_dir=None, exported_at=None):
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
    for b in budgets:
        share = _share_for_budget(dashboard_dir, b.get("id"))
        if share is not None:
            b["share"] = share
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
        bundle = build_bundle(snapshot, accounts, dashboard_dir=args.dashboard_dir)
    except NothingToExport as e:
        print("export_budget_bundle: %s" % e, file=sys.stderr)
        return 2

    out = Path(args.out) if args.out else Path(args.dashboard_dir) / ("manco-budget-%s.json" % _slug(snapshot.get("firmName")))
    # Compact, not indented: report_payload's 256 KB-per-payload cap is measured on this
    # form, and indentation alone can nearly triple a payload's size (nesting depth). The
    # Worker, the only reader, rejects anything over 4 MB; nobody edits this file by hand.
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
