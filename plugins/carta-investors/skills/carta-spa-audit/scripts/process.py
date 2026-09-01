# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///
"""
process.py — assemble spa-audit JSON from the server-aggregated DWH responses.

Reads the NDJSON responses written by the skill's DWH MCP calls (all issued
with ``format="ndjson"``) and produces the JSON data file consumed by
generate_artifact.py.

Why these queries:
- Query A (audit) returns one row per portfolio company with bucket
  assignment, cost basis, and first invested date. Used for the four stat
  tiles + main table.
- Query D (drill-down) returns one row per portfolio company with all its
  SPAs + per-SPA purchaser breakdowns nested as a compact JSON string
  (short keys n/t/sh/pp/a for purchasers, num/sc/td/ud/cc/ex/p for SPAs).
  Used to populate the drawer when a user clicks a company row.
- Query T (optional, ``--status``) returns one row per equity position, used
  to build the company→live/exited map behind the artifact's filter tabs.

Coverage counts (spa_companies, total_companies) come from CLI flags
rather than ndjson — they're scalar values from two trivial queries.

NDJSON wire shape (carta-mcp >= PR #367, after #366 paginated cap):

    total_rows: 33 | offset: 0 | limit: 1000 | format: ndjson
    <blank line>
    {"COL1": val, "COL2": val, ...}
    {"COL1": val, "COL2": val, ...}

Types are preserved: integers stay integers, NULL is JSON null (not the
string "NULL"), booleans round-trip, decimal.Decimal lands as a JSON
number, and Snowflake ARRAYs land as JSON arrays.

Usage:
    uv run process.py \\
        --audit  "$QUERY_A_BLOB" \\
        --rounds "$QUERY_D_BLOB" \\
        --firm-id "0021beba-…" \\
        --firm-name "Acme Capital Partners" \\
        --firm-carta-id 1234567 \\
        --spa-companies 13 \\
        --total-companies 19 \\
        --out "$WORKSPACE/carta-spa-audit-data.json"

stdlib-only by design — no PyPI fetches at runtime, so it works inside
network-isolated sandboxes (e.g. Cowork) where uv cannot reach github.com.
"""

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


# ---------------------------------------------------------------------------
# NDJSON parser — same wire shape as carta-co-investors, same parser logic.
# ---------------------------------------------------------------------------

_METADATA_HEADER_PREFIX = "total_rows:"
_NULL_STRS = {"", "null", "NULL", "Null", "—", "-"}


def parse_ndjson(text: str) -> list[dict[str, Any]]:
    """Parse a carta-mcp NDJSON response into a list of row dicts.

    Format:
      Line 1:  ``total_rows: N | offset: O | limit: L | format: ndjson``
      Line 2:  blank.
      Line 3+: one compact JSON object per row.

    A single malformed line is logged and skipped rather than aborting
    the whole pipeline — earlier well-formed rows are still useful when
    a transport-layer truncation strikes.
    """
    rows: list[dict[str, Any]] = []
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
        if not line:
            continue
        if line.startswith("(Result truncated"):
            continue
        try:
            obj = json.loads(line)
        except json.JSONDecodeError as e:
            print(f"WARN: skipping malformed NDJSON line: {e}", file=sys.stderr)
            continue
        if isinstance(obj, dict):
            rows.append(obj)
    return rows


# ---------------------------------------------------------------------------
# Value coercion
# ---------------------------------------------------------------------------

def _to_int(v: Any) -> int | None:
    if v is None:
        return None
    s = str(v).strip().replace(",", "")
    if s in _NULL_STRS:
        return None
    try:
        return int(float(s))
    except (TypeError, ValueError):
        return None


def _to_float(v: Any) -> float | None:
    if v is None:
        return None
    s = str(v).strip().replace(",", "")
    if s in _NULL_STRS:
        return None
    try:
        return float(s)
    except (TypeError, ValueError):
        return None


def _to_bool(v: Any) -> bool:
    if isinstance(v, bool):
        return v
    if v is None:
        return False
    return str(v).strip().lower() in {"true", "1", "yes", "t"}


def _clean_currency(v: Any) -> str | None:
    """Return an ISO-4217 code, or None when the extraction didn't yield one.

    The extractor occasionally emits prose instead of a code ("Canadian
    dollars", "GBP and USD"). Those are not safe to attach to an amount, so
    they degrade to None rather than being guessed at.
    """
    if v is None:
        return None
    s = str(v).strip().upper()
    if s in _NULL_STRS:
        return None
    return s if len(s) == 3 and s.isalpha() else None


# ---------------------------------------------------------------------------
# Date formatting
# ---------------------------------------------------------------------------

_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
          "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


def _format_month_year(val: Any) -> str:
    """Format a date as `Mmm yyyy` (month-level — first invested standard)."""
    if val is None:
        return "—"
    s = str(val).strip()
    if not s or s in _NULL_STRS:
        return "—"
    try:
        dt = datetime.fromisoformat(s[:10])
        return f"{_MONTHS[dt.month - 1]} {dt.year}"
    except (ValueError, IndexError):
        return s


def _format_full_date(val: Any) -> str:
    """Format a date as `Mmm D, yyyy` (day-level — used for transaction/upload dates)."""
    if val is None:
        return "—"
    s = str(val).strip()
    if not s or s in _NULL_STRS:
        return "—"
    try:
        dt = datetime.fromisoformat(s[:10])
        return f"{_MONTHS[dt.month - 1]} {dt.day}, {dt.year}"
    except (ValueError, IndexError):
        return s


# ---------------------------------------------------------------------------
# Enrichment assembly (Query E — funds / region tag / SOI valuation)
# ---------------------------------------------------------------------------

def build_enrichment_lookup(enrichment_rows: list[dict]) -> dict[str, dict]:
    """Build a dict keyed by ISSUER_NAME with fund, region, and SOI data.

    Each row from Query E (FUND_ADMIN.AGGREGATE_INVESTMENTS) has:
      COMPANY       — ISSUER_NAME (investment side)
      FUNDS         — ARRAY_AGG of distinct FUND_NAME values. An array rather
                      than a delimited string because fund names routinely
                      contain the delimiter ("Acme Ventures Fund I, L.P.")
      REGION_TAG    — first element of the '  Region' tag array (2 leading
                      spaces in the key, as stored in Snowflake TAGS_JSON)
      SOI_VALUATION — SUM(REMAINING_VALUE) — current fair-market value

    Any column may be NULL for fully-exited positions; the lookup gracefully
    returns an empty list / empty string / None for those.
    """
    out: dict[str, dict] = {}
    for row in enrichment_rows:
        company = (row.get("COMPANY") or "").strip()
        if not company:
            continue
        funds_raw = row.get("FUNDS")
        region_raw = (row.get("REGION_TAG") or "").strip()
        soi_raw = row.get("SOI_VALUATION")
        out[company] = {
            "funds": [
                str(f).strip() for f in funds_raw if str(f).strip()
            ] if isinstance(funds_raw, list) else [],
            "regionTag": region_raw if region_raw else "—",
            "soiValuation": _to_float(soi_raw),
        }
    return out


# ---------------------------------------------------------------------------
# Live/exited status map (Query T)
# ---------------------------------------------------------------------------

def build_company_status(status_rows: list[dict]) -> dict[str, bool]:
    """Build a company-name → live/exited map from Query T rows.

    Each row has ISSUER_NAME and IS_ACTIVE_INVESTMENT (bool). When a company
    appears more than once (multiple fund positions), it is considered live if
    *any* position is active — a realised tranche does not retire the company.
    """
    out: dict[str, bool] = {}
    for row in status_rows:
        name = (row.get("ISSUER_NAME") or "").strip()
        if not name:
            continue
        active = _to_bool(row.get("IS_ACTIVE_INVESTMENT"))
        # Once true (live), keep true even if later rows disagree.
        out[name] = out.get(name, False) or active
    return out


# ---------------------------------------------------------------------------
# Bucket assembly (Query A)
# ---------------------------------------------------------------------------

# Maps SQL-side bucket strings to JSON keys used in the artifact.
_BUCKET_KEY = {
    "1. Missing SPA":         "missing",
    "2. SPA not executed":    "unexecuted",
    "3. Executed SPA":        "executed",
    "4. No SPA needed":       "notNeeded",
}


def build_buckets(audit_rows: list[dict], enrichment_lookup: dict[str, dict] | None = None) -> dict[str, list[dict]]:
    """Group audit rows into the four bucket arrays.

    Each row goes into exactly one bucket. Within each bucket, rows are
    sorted by cost basis DESC (NULL/zero last) and then by company name
    for a deterministic tiebreaker — Snowflake's parallel-partition
    behavior can break the SQL ORDER BY, so we re-sort in Python.

    ``drillDownKey`` carries the SPA-side issuer name from Query A
    (column ``SPA_NAME``, populated by the fuzzy-match join). The audit
    table shows the investment-side ISSUER_NAME, but the drill-down
    dict is keyed by the SPA-side ISSUER_NAME — these often differ
    (e.g. investment ``Polaris Robotics`` vs SPA ``Polaris Robotics,
    Inc.``), so the artifact's drawer lookup needs the SPA-side key.
    If ``SPA_NAME`` is null (Missing SPA or No SPA needed), the field
    is omitted and the drawer is non-clickable for that row.
    """
    out: dict[str, list[dict]] = {
        "missing": [],
        "unexecuted": [],
        "executed": [],
        "notNeeded": [],
    }
    for row in audit_rows:
        bucket_label = (row.get("SPA_BUCKET") or "").strip()
        bucket_key = _BUCKET_KEY.get(bucket_label)
        if not bucket_key:
            print(
                f"WARN: unknown bucket label {bucket_label!r} for "
                f"{row.get('COMPANY')!r}, skipping",
                file=sys.stderr,
            )
            continue
        spa_name = (row.get("SPA_NAME") or "").strip()
        entry = {
            "company": (row.get("COMPANY") or "").strip(),
            "firstInvested": _format_month_year(row.get("FIRST_INVESTED")),
            "costBasis": _to_float(row.get("TOTAL_COST_BASIS")) or 0.0,
        }
        if spa_name:
            entry["drillDownKey"] = spa_name
        # Enrich with fund membership, geography tag, and SOI valuation
        # from AGGREGATE_INVESTMENTS (Query E). All three default gracefully
        # when enrichment_lookup is absent or the company has no active position.
        enrich = (enrichment_lookup or {}).get(entry["company"]) or {}
        entry["funds"] = enrich.get("funds") or []
        entry["regionTag"] = enrich.get("regionTag", "—")
        entry["soiValuation"] = enrich.get("soiValuation")  # None for fully exited
        out[bucket_key].append(entry)

    # Sort each bucket: by cost basis DESC (treat None as 0), then by name.
    for key, rows in out.items():
        rows.sort(key=lambda r: (-(r["costBasis"] or 0.0), r["company"]))

    return out


# ---------------------------------------------------------------------------
# Drill-down assembly (Query D)
# ---------------------------------------------------------------------------

def build_companies(rounds_rows: list[dict], buckets: dict[str, list[dict]]) -> dict[str, dict]:
    """Decode Query D: each row has ISSUER_NAME and SPAS_JSON (a JSON string).

    The JSON uses short keys to minimise payload:
      SPA:        num=number, sc=shareClass, td=transactionDate,
                  ud=uploadDate, cc=currency, ex=executed, p=purchasers
      Purchaser:  n=name, t=entityType, sh=shares, pp=pricePerShare, a=amountPaid

    Currency is per SPA, so every amount inside one SPA shares it. Amounts are
    never totalled across SPAs, which may be denominated differently.

    Also enriches each company entry with `bucket`, `firstInvested`, and
    `costBasis` from the audit-row data so the drawer can render the
    summary header without a second lookup.
    """
    # Build a fast lookup: company -> (bucket_key, firstInvested, costBasis)
    company_meta: dict[str, tuple[str, str, float]] = {}
    for bucket_key, rows in buckets.items():
        for row in rows:
            company_meta[row["company"]] = (
                bucket_key,
                row["firstInvested"],
                row["costBasis"],
            )

    out: dict[str, dict] = {}
    for row in rounds_rows:
        company = (row.get("ISSUER_NAME") or "").strip()
        if not company:
            continue
        spas_raw = row.get("SPAS_JSON") or ""
        if not spas_raw or (isinstance(spas_raw, str) and spas_raw.strip() in _NULL_STRS):
            continue

        # SPAS_JSON arrives as a JSON-encoded string (TO_JSON output).
        if isinstance(spas_raw, str):
            try:
                spas_data = json.loads(spas_raw)
            except json.JSONDecodeError as e:
                print(f"WARN: could not parse SPAS_JSON for {company}: {e}", file=sys.stderr)
                continue
        else:
            spas_data = spas_raw

        spas: list[dict] = []
        for spa in spas_data:
            purchasers: list[dict] = []
            for p in spa.get("p") or []:
                purchasers.append({
                    "name": p.get("n") or "",
                    "entityType": p.get("t") or "—",
                    "shares": _to_int(p.get("sh")),
                    "pricePerShare": _to_float(p.get("pp")),
                    "amountPaid": _to_float(p.get("a")),
                })
            spas.append({
                "num": _to_int(spa.get("num")) or 0,
                "shareClass": spa.get("sc") or "—",
                "transactionDate": _format_full_date(spa.get("td")),
                "uploadDate": _format_full_date(spa.get("ud")),
                # None when the document stated no currency. Never coerce to a
                # default — the renderer marks these amounts as unstated.
                "currency": _clean_currency(spa.get("cc")),
                "executed": _to_bool(spa.get("ex")),
                "purchasers": purchasers,
            })

        meta = company_meta.get(company, ("", "—", 0.0))
        out[company] = {
            "bucket": meta[0] or "missing",
            "firstInvested": meta[1],
            "costBasis": meta[2],
            "spas": spas,
        }

    return out


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Assemble spa-audit JSON from the two DWH NDJSON responses."
    )
    parser.add_argument(
        "--audit", required=True,
        help="NDJSON blob file from Query A (the main bucket audit query). "
             "Resolved readable path — not a file the skill wrote.",
    )
    parser.add_argument(
        "--rounds", required=True,
        help="NDJSON blob file from Query D (the per-company drill-down). "
             "Resolved readable path — not a file the skill wrote.",
    )
    parser.add_argument(
        "--enrichment", required=False, default=None,
        help="NDJSON blob file from Query E (AGGREGATE_INVESTMENTS — funds, "
             "region tag, SOI valuation). Optional; skipped if absent.",
    )
    parser.add_argument("--firm-id", required=True, help="Firm UUID (36 chars).")
    parser.add_argument("--firm-name", required=True)
    parser.add_argument("--firm-carta-id", required=True)
    parser.add_argument("--spa-companies", type=int, required=True,
                        help="Count of distinct companies with at least one SPA on file.")
    parser.add_argument("--total-companies", type=int, required=True,
                        help="Count of distinct portfolio companies (investments).")
    parser.add_argument("--pending-extraction-docs", type=int, default=0,
                        help="Count of uploaded SPA documents pending Document AI "
                             "extraction. Currently a stub — wire up Query P once "
                             "the DOCUMENT_AI_DOCUMENT.document_type filter is "
                             "confirmed against the live schema. Default 0.")
    parser.add_argument("--orphaned-spas", type=int, default=0,
                        help="Count of SPA issuer names with no fuzzy-match "
                             "(Jaro-Winkler >= 90) to any investment in "
                             "AGGREGATE_INVESTMENTS. Surfaced as a header-subtitle "
                             "FYI pill — these SPAs have nowhere to land in the "
                             "four-bucket audit. Default 0.")
    parser.add_argument("--orphaned-spa-names", type=str, default="[]",
                        help="JSON array of the actual SPA issuer names that couldn't be "
                             "fuzzy-matched to any portfolio company. Listed in the unmatched "
                             "SPA pill tooltip. Pass '[]' (default) when names are unavailable.")
    parser.add_argument(
        "--status", action="append", default=[],
        help="NDJSON blob file from Query T (ISSUER_NAME + IS_ACTIVE_INVESTMENT). "
             "Optional — when omitted, companyStatus is excluded from the output "
             "and the live/exited filter in the artifact is disabled.",
    )
    parser.add_argument("--out", required=True)
    args = parser.parse_args()

    print("Parsing NDJSON responses…", flush=True)
    audit_rows = parse_ndjson(Path(args.audit).read_text(encoding="utf-8"))
    rounds_rows = parse_ndjson(Path(args.rounds).read_text(encoding="utf-8"))
    print(f"  Query A: {len(audit_rows)} audit rows", flush=True)
    print(f"  Query D: {len(rounds_rows)} company rows with drill-down data", flush=True)
    status_rows: list[dict[str, Any]] = []
    for path in args.status:
        # Not truncation-checked like A and D: a short status map only narrows the
        # Live/Exited tabs, so it must not abort the whole report.
        status_rows.extend(parse_ndjson(Path(path).read_text(encoding="utf-8")))
    if status_rows:
        print(f"  Query T: {len(status_rows)} investment rows", flush=True)

    if not audit_rows:
        print("ERROR: Query A returned no rows.", file=sys.stderr)
        sys.exit(1)

    enrichment_lookup: dict[str, dict] = {}
    if args.enrichment:
        enrichment_rows = parse_ndjson(Path(args.enrichment).read_text(encoding="utf-8"))
        print(f"  Query E: {len(enrichment_rows)} enrichment rows", flush=True)
        enrichment_lookup = build_enrichment_lookup(enrichment_rows)
    else:
        print("  Query E: skipped (--enrichment not provided)", flush=True)

    print("Assembling buckets…", flush=True)
    buckets = build_buckets(audit_rows, enrichment_lookup)
    counts = {k: len(v) for k, v in buckets.items()}
    print(
        f"  missing={counts['missing']}, unexecuted={counts['unexecuted']}, "
        f"executed={counts['executed']}, notNeeded={counts['notNeeded']}",
        flush=True,
    )

    print("Decoding per-company SPA documents…", flush=True)
    companies = build_companies(rounds_rows, buckets)
    print(f"  {len(companies)} companies with drill-down data", flush=True)

    company_status: dict[str, bool] | None = None
    if status_rows:
        print("Building live/exited status map…", flush=True)
        company_status = build_company_status(status_rows)
        live = sum(1 for v in company_status.values() if v)
        exited = len(company_status) - live
        print(f"  {live} live, {exited} exited across {len(company_status)} companies", flush=True)

    now = datetime.now(timezone.utc)
    generated_at = f"{_MONTHS[now.month - 1]} {now.day}, {now.year}"

    try:
        orphaned_spa_names: list[str] = json.loads(args.orphaned_spa_names)
        if not isinstance(orphaned_spa_names, list):
            orphaned_spa_names = []
    except (json.JSONDecodeError, AttributeError):
        orphaned_spa_names = []

    data = {
        "meta": {
            "firmId": args.firm_id,
            "firmName": args.firm_name,
            "firmCartaId": args.firm_carta_id,
            "generatedAt": generated_at,
        },
        "coverage": {
            "totalCompanies": args.total_companies,
            "spaCompanies": args.spa_companies,
            "pendingExtractionDocs": args.pending_extraction_docs,
            "orphanedSpas": args.orphaned_spas,
            "orphanedSpaNames": orphaned_spa_names,
        },
        "buckets": buckets,
        "companies": companies,
    }
    if company_status is not None:
        data["companyStatus"] = company_status

    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(data, indent=2, default=str), encoding="utf-8")
    size_kb = out_path.stat().st_size / 1024
    print(f"Done — {out_path} ({size_kb:.1f} KB)", flush=True)


if __name__ == "__main__":
    main()
