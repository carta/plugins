# /// script
# requires-python = ">=3.9"
# dependencies = []
# ///
"""Assemble the NDA dashboard JSON from the six per-tab DWH ndjson blobs."""

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

_METADATA_HEADER_PREFIX = "total_rows:"
_NULL_STRS = {"", "null", "NULL", "Null", "—", "-", "None"}


def unwrap_envelope(text: str) -> str:
    """Unwrap a {"result": "<ndjson>"} envelope (large responses spilled to disk)."""
    stripped = text.lstrip()
    if not stripped.startswith("{"):
        return text
    try:
        outer = json.loads(stripped)
    except json.JSONDecodeError:
        return text
    if isinstance(outer, dict) and isinstance(outer.get("result"), str):
        return outer["result"]
    return text


def parse_ndjson(text: str) -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    if not text:
        return rows
    body = text
    stripped = text.lstrip()
    if stripped:
        first_line = stripped.splitlines()[0]
        if first_line.startswith(_METADATA_HEADER_PREFIX) and "\n\n" in text:
            _header, body = text.split("\n\n", 1)
    for line in body.splitlines():
        line = line.strip()
        if not line or line.startswith("(Result truncated"):
            continue
        try:
            obj = json.loads(line)
        except json.JSONDecodeError as e:
            print("WARN: skipping malformed ndjson line: %s" % e, file=sys.stderr)
            continue
        if isinstance(obj, dict):
            rows.append(obj)
    return rows


def load(path: Optional[str]) -> List[Dict[str, Any]]:
    if not path:
        return []
    body = unwrap_envelope(Path(path).read_text(encoding="utf-8"))
    return parse_ndjson(body)


def _int(v: Any) -> int:
    if v is None:
        return 0
    s = str(v).strip().replace(",", "")
    if s in _NULL_STRS:
        return 0
    try:
        return int(float(s))
    except (TypeError, ValueError):
        return 0


def _str(v: Any) -> str:
    if v is None:
        return ""
    s = str(v).strip()
    return "" if s in _NULL_STRS else s


def _date10(v: Any) -> str:
    s = _str(v)
    return s[:10] if s else ""


def _pct(n: int, total: int) -> float:
    return round(100.0 * n / total, 1) if total else 0.0


_UNKNOWN_JURIS = {"not captured", "unclear", "unknown", "n/a", "none", ""}


def _canonical_term(months: int) -> str:
    """1 year / 2 years / 18 months — normalize 12 months → "1 year"."""
    if not months:
        return ""
    m = int(months)
    if m % 12 == 0:
        y = m // 12
        return "%d year" % y if y == 1 else "%d years" % y
    return "%d month" % m if m == 1 else "%d months" % m


def main() -> None:
    ap = argparse.ArgumentParser(description="Assemble the NDA dashboard JSON.")
    ap.add_argument("--provisions", required=True)
    ap.add_argument("--jurisdictions", required=True)
    ap.add_argument("--kpi", required=True)
    ap.add_argument("--expiring", required=True)
    ap.add_argument("--restrictions", required=True)
    ap.add_argument("--counterparties", required=True)
    ap.add_argument("--firm-name", required=True)
    ap.add_argument("--firm-carta-id", required=True)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    kpi_rows = load(args.kpi)
    kpi = kpi_rows[0] if kpi_rows else {}
    total = _int(kpi.get("TOTAL_NDAS"))
    with_date = _int(kpi.get("WITH_EXEC_DATE"))

    # Provision frequency (independent shares of all NDAs)
    provisions = []
    for r in load(args.provisions):
        n = _int(r.get("N"))
        provisions.append({"provision": _str(r.get("PROVISION")), "count": n,
                           "pct": _pct(n, total)})
    provisions.sort(key=lambda x: -x["count"])

    # Governing law — drop null/blank and unknown buckets
    jurisdictions = []
    for r in load(args.jurisdictions):
        name = _str(r.get("JURISDICTION"))
        if name.lower() in _UNKNOWN_JURIS:
            continue
        n = _int(r.get("NDA_COUNT"))
        jurisdictions.append({"jurisdiction": name, "count": n, "pct": _pct(n, total)})
    jurisdictions.sort(key=lambda x: -x["count"])
    top_gov_law = jurisdictions[0]["jurisdiction"] if jurisdictions else "—"

    # Expiring (next 2 years) — normalize the term label + keep months for sorting
    expiring = []
    for r in load(args.expiring):
        months = _int(r.get("TERM_MONTHS"))
        expiring.append({
            "counterparty": _str(r.get("COUNTERPARTY")),
            "deal": _str(r.get("DEAL_NAME")),
            "executed": _date10(r.get("EXECUTED_DATE")),
            "term": _canonical_term(months) or _str(r.get("TERM_TEXT")),
            "termMonths": months,
            "expiry": _date10(r.get("EXPIRY")),
        })
    expiring.sort(key=lambda x: x["expiry"])

    # Restrictions (active, per counterparty)
    restrictions = []
    for r in load(args.restrictions):
        restrictions.append({
            "counterparty": _str(r.get("COUNTERPARTY")),
            "restrictions": _str(r.get("RESTRICTIONS")),
            "bindingUntil": _date10(r.get("BINDING_UNTIL")),
            "deals": _str(r.get("DEALS")),
            "ndaCount": _int(r.get("NDA_COUNT")),
        })
    restrictions.sort(key=lambda x: (x["bindingUntil"] == "", x["bindingUntil"]))

    # Counterparties
    counterparties = []
    for r in load(args.counterparties):
        counterparties.append({
            "counterparty": _str(r.get("COUNTERPARTY")),
            "ndaCount": _int(r.get("NDA_COUNT")),
            "govLaw": _str(r.get("GOV_LAW")),
            "deals": _str(r.get("DEALS")),
        })
    counterparties.sort(key=lambda x: -x["ndaCount"])

    has_workflow = any(e["deal"] for e in expiring) or any(c["deals"] for c in counterparties)

    now = datetime.now(timezone.utc)
    generated_at = "%s %d, %d" % (now.strftime("%b"), now.day, now.year)

    kpis = {
        "totalNdas": total,
        "counterparties": _int(kpi.get("DISTINCT_COUNTERPARTIES")),
        "restrictedCompanies": _int(kpi.get("RESTRICTED_COMPANIES")),
        "expiringNext2Years": _int(kpi.get("EXPIRING_NEXT_2_YEARS")),
        "topGovLaw": top_gov_law,
        "withExecDate": with_date,
    }

    data = {
        # render_artifact.py writes this into the page <title>; the Artifact tool finds the
        # page to refresh by that title.
        "artifact_title": "%s — NDA insights" % args.firm_name,
        "meta": {
            "firmName": args.firm_name,
            "firmCartaId": args.firm_carta_id,
            "generatedAt": generated_at,
            "hasWorkflow": has_workflow,
        },
        "kpis": kpis,
        "provisionFrequency": provisions,
        "jurisdictions": jurisdictions,
        "expiring": expiring,
        "restrictions": restrictions,
        "counterparties": counterparties,
    }

    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(data, indent=2, default=str), encoding="utf-8")
    size_kb = out_path.stat().st_size / 1024
    print("Done — %s (%.1f KB); %d NDAs, %d counterparties, %d restricted, %d expiring"
          % (out_path, size_kb, total, len(counterparties), len(restrictions), len(expiring)),
          flush=True)


if __name__ == "__main__":
    main()
