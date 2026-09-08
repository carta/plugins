#!/usr/bin/env python3
"""manco_paths.py — cache-dir resolver for the carta-manco-reporting skill.

Mirrors fund-modeling's fm_paths.py, but keyed by (firm, manco) instead of
firm alone. Every firm's ManCos each get their own dashboard dir, so a firm
with two ManCos doesn't have them share one snapshot.

Subcommands:
  resolve <firm> <manco>    → JSON with raw_dir, dashboard_dir, snapshot_age_days,
                              raw_age_days, raw_as_of, firm_slug, manco_slug, and
                              the year/max_mo/as_of window Step 3 queries against
  list-dashboards           → list every cached (firm, manco) with age
  find-by-id <manco-uuid>   → find a cached ManCo by its uuid; used to detect a
                              re-invocation of the same ManCo across firm names
  detect-surface            → classify the runtime surface as local vs sandboxed
                              (the skill launches a localhost server + browser,
                              which only works in a local Claude Code session —
                              not Cowork or a Claude Code cloud session)

snapshot_age_days is the age of the last datadir rebuild (Step 4), which runs
on every invocation. raw_age_days is the age of the last actual DWH fetch
(Step 3), from the raw_dir/.fetched-at marker — the freshness signal that
actually gates whether Step 3 should re-run.

Cache root: $XDG_CACHE_HOME/manco-reporting/ (defaults to ~/.cache/manco-reporting/).
Deliberately outside the plugin's own dir so multiple engineers on the same
machine, or repeated `carta sync-marketplace` refreshes, don't collide.

Slug: firm+manco names normalized to lowercase-hyphenated ASCII. Idempotent —
passing an already-slugified value re-slugs to itself. Non-Latin names hash
into a stable synthetic slug so no two firms collapse onto one.

Stdlib-only, Python 3.9-safe. No third-party imports.
"""

import argparse
import datetime
import hashlib
import json
import os
import pathlib
import re
import time
import unicodedata


def reporting_window(today=None):
    """The year, month and as-of date Step 3 scopes its queries to.

    Resolved here, not by the caller, so two runs on the same day cannot
    scope to different months. `max_mo` is the current, partial month — it
    matches `as_of` and the cash balance.
    """
    day = today or datetime.date.today()
    return {"year": day.year, "max_mo": day.month, "as_of": day.isoformat()}


def budget_file(year, month):
    """Budget filenames carry their year: a January run against a December
    cache would otherwise read last year's plan against this year's actuals,
    inside the TTL and with nothing to signal it."""
    return "budget-{}-{:02d}.json".format(year, month)


def slugify(name):
    if not name:
        return ""
    ascii_name = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode("ascii")
    slug = re.sub(r"[^a-z0-9]+", "-", ascii_name.lower()).strip("-")
    if not slug:
        # Non-Latin script or all-symbol name — hash a normalized key so distinct
        # firms keep distinct, stable dirs instead of collapsing onto one.
        h = hashlib.sha1(name.strip().casefold().encode("utf-8")).hexdigest()[:12]
        slug = f"firm-{h}"
    return slug


def cache_root():
    base = os.environ.get("XDG_CACHE_HOME") or os.path.expanduser("~/.cache")
    return pathlib.Path(base) / "manco-reporting"


def dashboard_dir_for(firm_slug, manco_slug):
    return cache_root() / firm_slug / manco_slug


def raw_dir_for(firm_slug, manco_slug):
    return dashboard_dir_for(firm_slug, manco_slug) / "raw"


def snapshot_age_days(dashboard_dir):
    p = dashboard_dir / "snapshot.json"
    if not p.exists():
        return None
    return round((time.time() - p.stat().st_mtime) / 86400.0, 1)


def raw_age_days(raw_dir):
    """Age of the last actual DWH fetch, in days — NOT snapshot.json's age.
    Step 4 rewrites snapshot.json on every invocation, including warm-cache
    ones that skip Step 3, so snapshot_age_days is always ~0 and can never
    gate a refetch. raw_dir/.fetched-at is written once, at the end of Step
    3's actual fetch, and is the only reliable freshness signal."""
    p = raw_dir / ".fetched-at"
    if not p.exists():
        return None
    return round((time.time() - p.stat().st_mtime) / 86400.0, 1)


def raw_as_of(raw_dir):
    """The <AS_OF> date recorded in the fetch marker, or None if Step 3 has
    never run for this raw_dir."""
    p = raw_dir / ".fetched-at"
    if not p.exists():
        return None
    return p.read_text().strip() or None


_JE_FILES = ["je-expense-page1.txt", "je-income.txt", "fund-fees.txt",
             "cash-balance.json"]


def _budget_max_age(month, max_mo):
    """A closed month's budget is history and is fetched once. The open
    months are the ones a firm is still editing, so they expire weekly."""
    return 365.0 if month < max_mo else 7.0


def max_age_days(window=None):
    """How long each of Step 3's files stays usable, in days.

    These follow from what the data is: journal entries move daily, a
    reporting currency is set at onboarding, a budget month settles once it
    closes. `refresh` overrides all of it.
    """
    w = window or reporting_window()
    ages = {name: 1.0 for name in _JE_FILES}
    for month in range(1, 13):
        ages[budget_file(w["year"], month)] = _budget_max_age(month, w["max_mo"])
    ages["manco-currency.txt"] = 3650.0
    # The chart of accounts changes when a firm adds an account, not daily.
    ages["accounts-all.txt"] = 30.0
    # A fee schedule changes when a fund's LPA is amended, not daily — same
    # cadence as the chart of accounts.
    ages["management-fee-schedules.txt"] = 30.0
    return ages


def raw_inventory(raw_dir, window=None):
    """Each file's age and whether it is past its life above.

    `raw_age_days` is None whenever the marker is absent, which is also
    true of a still-current directory whose run was interrupted — so it
    cannot say what is actually on disk. This can.

    Says nothing about budgets an Excel workbook will override: only
    Step 3 knows what Step 2.75 did.
    """
    if not raw_dir.exists():
        return None
    now = time.time()
    out = {}
    for name, limit in max_age_days(window).items():
        f = raw_dir / name
        if not f.exists():
            out[name] = {"age_days": None, "stale": True}
            continue
        age = round((now - f.stat().st_mtime) / 86400.0, 1)
        out[name] = {"age_days": age, "stale": age >= limit}
    # Extra pages exist only for firms whose ledger needed them, so an
    # absent page is not a gap. Present ones age with the query they
    # belong to.
    for f in sorted(raw_dir.glob("je-expense-page*.txt")) + sorted(raw_dir.glob("fund-fees-page*.txt")):
        if f.name in out:
            continue
        age = round((now - f.stat().st_mtime) / 86400.0, 1)
        out[f.name] = {"age_days": age, "stale": age >= 1.0}
    return out


def needs_fetch(inventory):
    """The filenames Step 3 should actually request, or "all" when there is
    no raw dir yet to compare against."""
    if inventory is None:
        return "all"
    return sorted(n for n, v in inventory.items() if v["stale"])


def cmd_resolve(args):
    firm_slug  = slugify(args.firm)
    manco_slug = slugify(args.manco) if args.manco else ""
    dashboard  = dashboard_dir_for(firm_slug, manco_slug)
    raw        = raw_dir_for(firm_slug, manco_slug)
    window     = reporting_window()
    inventory  = raw_inventory(raw, window)
    print(json.dumps({
        "firm_slug":         firm_slug,
        "manco_slug":        manco_slug,
        "dashboard_dir":     str(dashboard),
        "raw_dir":           str(raw),
        "snapshot_age_days": snapshot_age_days(dashboard),
        "raw_age_days":      raw_age_days(raw),
        "raw_as_of":         raw_as_of(raw),
        "raw_inventory":     inventory,
        "needs_fetch":       needs_fetch(inventory),
        "exists":            dashboard.exists(),
        **window,
    }, indent=2))


def cmd_list(_args):
    root = cache_root()
    if not root.exists():
        print(json.dumps({"dashboards": []}, indent=2))
        return
    items = []
    for firm_dir in sorted(root.iterdir()):
        if not firm_dir.is_dir():
            continue
        for manco_dir in sorted(firm_dir.iterdir()):
            if not manco_dir.is_dir():
                continue
            snap = manco_dir / "snapshot.json"
            firm_name = manco_name = None
            if snap.exists():
                try:
                    d = json.loads(snap.read_text())
                    firm_name  = d.get("firmName")
                    manco_name = d.get("entityLabel")
                except Exception:
                    pass
            accts = manco_dir / "accounts.json"
            firm_uuid = firm_carta_id = manco_uuid = manco_carta_id = manco_entity_id = None
            carta_environment = None
            if accts.exists():
                try:
                    d = json.loads(accts.read_text())
                    firm_uuid          = d.get("firm_uuid")
                    firm_carta_id      = d.get("firm_carta_id")
                    manco_uuid         = d.get("manco_uuid")
                    manco_carta_id     = d.get("manco_carta_id")
                    manco_entity_id    = d.get("manco_entity_id")
                    carta_environment  = d.get("carta_environment")
                except Exception:
                    pass
            items.append({
                "firm_slug":         firm_dir.name,
                "manco_slug":        manco_dir.name,
                "firm_name":         firm_name,
                "manco_name":        manco_name,
                "firm_uuid":         firm_uuid,
                "firm_carta_id":     firm_carta_id,
                "manco_uuid":        manco_uuid,
                "manco_carta_id":    manco_carta_id,
                "manco_entity_id":   manco_entity_id,
                "carta_environment": carta_environment,
                "dashboard_dir":     str(manco_dir),
                "raw_dir":           str(manco_dir / "raw"),
                "snapshot_age_days": snapshot_age_days(manco_dir),
                "raw_age_days":      raw_age_days(manco_dir / "raw"),
            })
    print(json.dumps({"dashboards": items}, indent=2))


def cmd_find_by_id(args):
    """Scan cached ManCos and return the one whose snapshot's manco_uuid matches.
    Lets the caller detect that "Acme-v Capital" and "acme v" resolve to the
    same on-disk dir even if the user typed a different name."""
    needle = args.manco_uuid.strip().lower()
    root = cache_root()
    if not root.exists():
        print(json.dumps({"match": None}, indent=2))
        return
    for firm_dir in root.iterdir():
        for manco_dir in firm_dir.iterdir() if firm_dir.is_dir() else []:
            accts = manco_dir / "accounts.json"
            if not accts.exists():
                continue
            try:
                d = json.loads(accts.read_text())
            except Exception:
                continue
            if str(d.get("manco_uuid", "")).lower() == needle:
                snap_p = manco_dir / "snapshot.json"
                snap = json.loads(snap_p.read_text()) if snap_p.exists() else {}
                print(json.dumps({
                    "match": {
                        "firm_slug":         firm_dir.name,
                        "manco_slug":        manco_dir.name,
                        "firm_name":         snap.get("firmName"),
                        "manco_name":        snap.get("entityLabel"),
                        "dashboard_dir":     str(manco_dir),
                        "snapshot_age_days": snapshot_age_days(manco_dir),
                    }
                }, indent=2))
                return
    print(json.dumps({"match": None}, indent=2))


def detect_surface():
    """Classify the runtime surface as "local" or "sandboxed".

    Step 5 launches serve.py, which binds 127.0.0.1 and auto-opens the
    user's default browser. That only works when Claude Code runs on the
    user's own machine (a local terminal, or Claude Desktop set to run
    locally). In a sandboxed session — Cowork, or a Claude Code *cloud*
    session — the server binds inside a remote container the user can't
    reach and there is no local browser to open, so the dashboard URL goes
    nowhere. Detecting that lets the skill exit gracefully instead of
    handing back a dead URL. Ported from carta-fund-modeling's fm_paths.py,
    same signals, same OR-of-any-fires logic.

    Sandboxed if ANY signal fires — no single one covers every surface:
      - CLAUDE_CODE_REMOTE is truthy — a Claude Code cloud session.
      - $HOME is the Cowork session root (/sessions/<name>).
      - the /mnt/outputs sandbox mount exists — some remote-container surfaces.

    An explicit MANCO_REPORTING_SURFACE=local|sandboxed override wins
    (tests / unusual installs).

    Returns (surface, signals): surface is "local"/"sandboxed"; signals is
    a dict of the raw probe values for diagnostics.
    """
    home = os.environ.get("HOME") or str(pathlib.Path.home())
    remote = (os.environ.get("CLAUDE_CODE_REMOTE") or "").strip().lower()
    signals = {
        "claude_code_remote": os.environ.get("CLAUDE_CODE_REMOTE") or "unset",
        "home_sessions": "yes" if home.startswith("/sessions/") else "no",
        "mnt_outputs": "yes" if pathlib.Path("/mnt/outputs").is_dir() else "no",
        "override": (os.environ.get("MANCO_REPORTING_SURFACE") or "").strip().lower() or "unset",
    }

    if signals["override"] in ("local", "sandboxed"):
        return signals["override"], signals

    is_sandboxed = (
        remote in ("1", "true", "yes", "on")
        or signals["home_sessions"] == "yes"
        or signals["mnt_outputs"] == "yes"
    )
    return ("sandboxed" if is_sandboxed else "local"), signals


def cmd_detect_surface(_args):
    surface, signals = detect_surface()
    print(json.dumps({"surface": surface, "signals": signals}, indent=2))


def main():
    p = argparse.ArgumentParser()
    sub = p.add_subparsers(dest="cmd", required=True)

    r = sub.add_parser("resolve", help="resolve firm+manco → cache paths")
    r.add_argument("firm")
    r.add_argument("manco", nargs="?", default="", help="omit for firm-only slug")
    r.set_defaults(fn=cmd_resolve)

    sub.add_parser("list-dashboards", help="list all cached (firm, manco) dashboards").set_defaults(fn=cmd_list)

    f = sub.add_parser("find-by-id", help="find cached ManCo by uuid")
    f.add_argument("manco_uuid")
    f.set_defaults(fn=cmd_find_by_id)

    sub.add_parser("detect-surface", help="classify local vs sandboxed runtime surface").set_defaults(fn=cmd_detect_surface)

    args = p.parse_args()
    args.fn(args)


if __name__ == "__main__":
    main()
