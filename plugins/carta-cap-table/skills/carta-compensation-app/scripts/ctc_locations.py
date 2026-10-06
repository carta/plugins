#!/usr/bin/env python3
# /// script
# requires-python = ">=3.9"
# ///
"""Which locations the Benchmarks tab can offer, and how to ask Carta for each.

The CTC product's Benchmarks page lists every supported location and re-fetches
from the server when one is picked; the server applies the geo scalar, the
threshold clamp, bands and rounding. This console does the same. The build saves
the full list (`compensation:get:benchmark_locations`, read by catalog()), and
serve.py fetches a picked location on demand through location_fetch.py, with the
same `location` value the product sends. Every figure shown is still the server's.

Locations the corporation's own employees are benchmarked in are fetched ahead of
time, so the common picks open at once. The roster supplies that list: each
employee row carries the geo label the server used for them ("Tulsa, OK",
"Charlotte-Concord-Gastonia, NC-SC", "GBR").

    ctc_locations.py plan --raw <raw_dir>

prints one line per location still to fetch and creates its geo_<slug>/
directory with a location.json the builder reads back. Locations already
fetched (the default sweep at the top of the raw dir, or a complete geo_<slug>/)
are skipped, so re-running after a partial sweep lists only what is left.
"""
from __future__ import annotations

import argparse
import json
import pathlib
import re
import sys
from typing import Dict, List, Optional

# The product's own parse of a geo label into city/state, copied from the CTC
# frontend's useLocationFilter (compensation-service carries the same regex for the
# same reason). Matching it exactly is what makes a location here fetch the same
# figures as picking it on the Benchmarks page.
_METRO_RE = re.compile(r"(([A-Za-zÀ-ÖØ-öø-ÿ .–']+)(?:-|,|\/).*?([A-Z]{2}))")

# Canadian metros sit in the US-style geo table; the product marks them as Canada
# by province, and the server routes them through its Canada path on that basis.
_CANADIAN_PROVINCES = ("QC", "ON", "BC")


def location_param(label):
    # type: (str) -> Optional[str]
    """The `location` value the product sends for a geo label, or None if unparseable.

    "Tulsa, OK"                     -> "Tulsa,OK,USA"
    "Charlotte-Concord-Gastonia, NC-SC" -> "Charlotte,NC,USA"
    "Montreal, QC"                  -> "Montreal,QC,CAN"
    "GBR" (international)           -> ",,GBR"
    """
    label = (label or "").strip()
    if not label:
        return None
    if re.fullmatch(r"[A-Z]{3}", label):
        return ",,%s" % label
    m = _METRO_RE.search(label)
    if m is None:
        return None
    city, state = m.group(2).strip(), m.group(3)
    country = "CAN" if state in _CANADIAN_PROVINCES else "USA"
    return "%s,%s,%s" % (city, state, country)


CATALOG_FILE = "location_catalog.json"


def catalog(raw_dir):
    # type: (pathlib.Path) -> List[dict]
    """Every location the plan's geo adjustment version supports, in the product's order.

    Read from the saved `compensation:get:benchmark_locations` response. Each entry
    carries the `location` value the export takes, as carta-mcp derived it from the
    server's own city/state/country. Empty when the build didn't save the list
    (an older build, or a Carta MCP without that command).
    """
    p = pathlib.Path(raw_dir) / CATALOG_FILE
    if not p.exists():
        return []
    try:
        payload = json.loads(p.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        print("[ctc_locations] %s is unreadable; offering fetched locations only" % p,
              file=sys.stderr)
        return []
    raw = payload.get("locations") if isinstance(payload, dict) else payload
    out = []
    seen = set()
    for loc in raw if isinstance(raw, list) else []:
        if not isinstance(loc, dict):
            continue
        param = loc.get("location")
        if not param or param in seen:
            continue
        seen.add(param)
        out.append({
            "location": param,
            "label": loc.get("label") or param,
            "international": loc.get("country") not in ("USA", "US"),
            "region": loc.get("region"),
            "currency": loc.get("currency_code"),
        })
    return sorted(out, key=lambda e: (e["international"], e["label"].lower()))


def is_international(label):
    # type: (str) -> bool
    param = location_param(label) or ""
    return not param.endswith(",USA")


def slug(label):
    # type: (str) -> str
    """Directory-safe key for a location: geo_<slug>/."""
    s = re.sub(r"[^a-z0-9]+", "-", (label or "").lower()).strip("-")
    return s or "unknown"


def roster_locations(raw_dir):
    # type: (pathlib.Path) -> Dict[str, int]
    """{geo label -> employee count} from the captured roster. Empty if none."""
    p = pathlib.Path(raw_dir) / "roster_pages.json"
    if not p.exists():
        return {}
    rows = json.loads(p.read_text(encoding="utf-8")).get("rows") or {}
    counts = {}  # type: Dict[str, int]
    for row in (rows.values() if isinstance(rows, dict) else rows):
        label = ((row or {}).get("geo") or {}).get("label")
        if label:
            counts[label] = counts.get(label, 0) + 1
    return counts


def default_location_label(raw_dir):
    # type: (pathlib.Path) -> Optional[str]
    """The geo label of the default sweep (the flat benchmark_*.json files)."""
    for p in sorted(pathlib.Path(raw_dir).glob("benchmark_*.json")):
        try:
            payload = json.loads(p.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        for entry in payload.get("benchmarks") or []:
            label = (entry.get("geo_adjustment") or {}).get("label")
            if label:
                return label
    return None


def _sweep_complete(dirpath):
    # type: (pathlib.Path) -> bool
    p = dirpath / "export_pages.json"
    if not p.exists():
        return False
    try:
        return json.loads(p.read_text(encoding="utf-8")).get("sweep_complete") is True
    except (OSError, ValueError):
        return False


def order_key(label):
    # US metros first, then international — the product's order.
    return (is_international(label), label.lower())


def plan(raw_dir):
    # type: (pathlib.Path) -> List[dict]
    """The locations still to fetch, each with its directory prepared."""
    raw_dir = pathlib.Path(raw_dir)
    default = default_location_label(raw_dir)
    todo = []
    for label, employees in sorted(roster_locations(raw_dir).items(),
                                   key=lambda kv: order_key(kv[0])):
        if label == default:
            continue
        param = location_param(label)
        if param is None:
            print("[ctc_locations] skipping unparseable geo label %r" % label, file=sys.stderr)
            continue
        dirpath = raw_dir / ("geo_" + slug(label))
        if _sweep_complete(dirpath):
            continue
        dirpath.mkdir(exist_ok=True)
        (dirpath / "location.json").write_text(json.dumps(
            {"label": label, "location": param, "employees": employees}, indent=2))
        todo.append({"label": label, "location": param, "dir": str(dirpath),
                     "employees": employees})
    return todo


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("plan", help="list the location sweeps still to run")
    p.add_argument("--raw", required=True)
    args = ap.parse_args()

    if args.cmd == "plan":
        raw = pathlib.Path(args.raw)
        if not (raw / "roster_pages.json").exists():
            print("locations=none reason=no_roster")
            return
        todo = plan(raw)
        print("default=%s" % (default_location_label(raw) or "none"))
        for t in todo:
            print("location=%s\tdir=%s\temployees=%d\tlabel=%s"
                  % (t["location"], t["dir"], t["employees"], t["label"]))
        print("to_fetch=%d" % len(todo))


if __name__ == "__main__":
    main()
