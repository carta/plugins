"""Find the compensation payload inside whatever envelope an MCP client saved.

Shared by the compensation capture scripts that import it, so that a page one of
them accepts is a page the others accept too, and all of them pick the same one
out of a multi-block envelope.

Shapes handled:
  * a bare JSON object or a JSON array of rows
  * the columnar bulk-export envelope — ``{"columns": [...], "rows": [[...]]}``
    plus ``jobs_covered``/``jobs_empty``/``job_offset``/``next_job_offset``/
    ``total_job_areas`` — from ``compensation:export:benchmarks``
  * the MCP content-block wrapper — e.g.
    ``[{"type":"text",...},{"type":"resource","resource":{"blob":"<base64>",...}}]``
    (or a dict with a ``content``/``result``/``rows``/``data`` key) — by
    base64-decoding the resource blob, which is itself JSON
  * the harness-persisted large-result wrapper ``{"result": "<json text>"}`` — a
    *string*-valued ``result``/``content``/``text``, which the Carta MCP writes to a
    tool-results ``.txt`` when a result exceeds the context limit
"""
import base64
import json

# Keys the MCP uses to nest a payload inside a wrapper. Mirrors
# carta-fund-modeling/scripts/save_query_result.py.
CONTAINER_KEYS = ("content", "result", "results", "rows", "data")

# Keys that identify a real compensation payload once unwrapped.
PAYLOAD_KEYS = ("benchmarks", "peer_group", "benchmark_version", "is_subscribed",
                "has_ctc_access", "job", "level", "versions")

# Markers unique to the columnar bulk-export envelope (compensation:export:benchmarks).
# Kept separate from PAYLOAD_KEYS: "benchmark_version" alone is ambiguous (a plan
# payload also carries it hoisted), but "columns" + "jobs_covered" together only ever
# appear on an export page.
EXPORT_PAYLOAD_KEYS = ("columns", "jobs_covered", "jobs_empty")

# The percentile suffixes the columnar bulk export uses, and the short column name it
# gives each figure at that percentile (sal_p25, eq_p50_fd, …). Mirrors
# BENCHMARK_COLUMNS in compensation-service's columnar_serializers.py. Declared here
# because both export-page readers need the same vocabulary: save_benchmark_result.py
# reads values out by these names, export_benchmarks.py maps them onto its own field
# keys. A renamed column is one edit here; a new percentile or figure also needs
# export_benchmarks.py's build_columns() and save_benchmark_result.py's
# _export_row_to_benchmark, which choose what each output carries.
EXPORT_PCT_KEYS = ("p25", "p50", "p75", "p90")


def export_pct_columns(pct):
    """Short export column names at one percentile, keyed by the figure each carries.

    The figure key doubles as the field-key prefix the CSV and workbook use, so a
    caller that needs the long form builds it as ``"<figure>_<pct>"``.
    """
    return {
        "salary": "sal_%s" % pct,
        "tcc": "tcc_%s" % pct,
        "equity_fd_pct": "eq_%s_fd" % pct,
        "equity_shares": "eq_%s_sh" % pct,
        "equity_notional": "eq_%s_nv" % pct,
    }


def decode_blob(blob):
    """base64-decode an MCP resource blob and read it as JSON."""
    if not isinstance(blob, str):
        return None
    try:
        raw = base64.b64decode(blob, validate=False)
        return json.loads(raw.decode("utf-8"))
    except (ValueError, UnicodeDecodeError):
        return None


def looks_like_payload(val):
    """True when val is a compensation payload rather than a transport wrapper.

    Markers are fields unique to a compensation payload. Generic keys such as
    `id` or `version` would match a JSON-RPC envelope — a list whose first
    element carries `id` — and write the wrapper itself out as a row.
    """
    if isinstance(val, list):
        # A list of benchmark rows (each carrying job/level) is a payload.
        return bool(val) and isinstance(val[0], dict) and any(
            k in val[0] for k in ("job", "level", "salary_benchmarks"))
    if isinstance(val, dict):
        return (any(k in val for k in PAYLOAD_KEYS)
                or looks_like_location_list(val)
                or looks_like_export_page(val)
                or looks_like_scorecard_export_page(val)
                or looks_like_roster_page(val))
    return False


def looks_like_location_list(val):
    """compensation:get:benchmark_locations: {"count", "locations": [{label, location, …}]}."""
    locs = val.get("locations")
    return (isinstance(locs, list) and "count" in val
            and (not locs or (isinstance(locs[0], dict) and "location" in locs[0])))


def looks_like_export_page(val):
    """True when val is a columnar bulk-export page (compensation:export:benchmarks)."""
    return isinstance(val, dict) and all(k in val for k in EXPORT_PAYLOAD_KEYS)


def looks_like_scorecard_export_page(val):
    """True when val is a columnar EMPLOYEE export (compensation:export:scorecard).

    Separate from looks_like_export_page: both are columnar, but the benchmark
    export is identified by `jobs_covered`/`jobs_empty`, which an employee export
    does not carry. `external_id` in the header is the marker that cannot appear
    in a market-band export, so the two never match each other's payloads.

    Lives here, in the shared unwrapping layer, for the same reason
    looks_like_roster_page does: collect_payloads only recurses into shapes
    looks_like_payload accepts, so without this an export nested in a
    content-block array or a base64 resource.blob is unreachable.
    """
    if not isinstance(val, dict):
        return False
    columns = val.get("columns")
    return isinstance(columns, list) and isinstance(val.get("rows"), list) and "external_id" in columns


def looks_like_roster_page(val):
    """True when val is a scorecard roster page (compensation:get:employee-scorecard).

    Recognised here, in the shared unwrapping layer, because collect_payloads is
    what walks content-block arrays and base64 ``resource.blob`` values and it
    only recurses into shapes looks_like_payload accepts. A roster page nested in
    a content-block list is therefore reachable only from here, and every script
    that imports this module picks up a new envelope shape at the same time.

    `employees` alone is too weak (a future non-scorecard payload could carry it),
    so pair it with one of the count fields.
    """
    if not isinstance(val, dict) or "employees" not in val:
        return False
    return any(k in val for k in ("total_results", "count"))


def candidate_rows(candidate):
    """Row count used to rank competing payloads found in one wrapper."""
    if isinstance(candidate, dict):
        rows = candidate.get("benchmarks")
        if isinstance(rows, list):
            return len(rows)
        export_rows = candidate.get("rows")
        if looks_like_export_page(candidate) and isinstance(export_rows, list):
            return len(export_rows)
        employees = candidate.get("employees")
        if looks_like_roster_page(candidate) and isinstance(employees, list):
            return len(employees)
        return 0
    if isinstance(candidate, list):
        return len(candidate)
    return 0


def collect_payloads(node, depth=0, found=None):
    """Collect EVERY payload-shaped object reachable inside an MCP wrapper.

    Decodes any ``resource.blob`` (base64 JSON), parses string-valued
    text/result/content as JSON, and follows container keys.

    Collects rather than returning the first hit, because a content-block
    wrapper routinely carries more than one candidate and the first is often the
    wrong one: the ``{"type":"text"}`` summary block precedes the
    ``{"type":"resource"}`` block that holds the real rows, so the first hit is a
    status blurb and the rows behind it are lost. The caller ranks the
    candidates instead.
    """
    if found is None:
        found = []
    if depth > 8:  # transport wrappers are shallow; deeper means we're lost
        return found

    if looks_like_payload(node):
        found.append(node)
        # Keep walking: a payload-shaped node can still contain a richer one.

    if isinstance(node, dict):
        res = node.get("resource")
        if isinstance(res, dict) and res.get("blob"):
            collect_payloads(decode_blob(res["blob"]), depth + 1, found)
        if node.get("blob") and "resource" not in node:
            collect_payloads(decode_blob(node["blob"]), depth + 1, found)
        # A string-valued text/result/content is embedded JSON — this is the
        # large-result path, where the harness persists the payload as text.
        for key in ("text",) + CONTAINER_KEYS:
            val = node.get(key)
            if isinstance(val, str) and val.strip():
                try:
                    collect_payloads(json.loads(val), depth + 1, found)
                except ValueError:
                    pass
            elif isinstance(val, (dict, list)):
                collect_payloads(val, depth + 1, found)

    if isinstance(node, list):
        for item in node:
            collect_payloads(item, depth + 1, found)

    return found


def walk_for_payload(node):
    """The richest payload inside an MCP wrapper, or None.

    "Richest" = most benchmark rows. A wrapper can legitimately contain several
    payload-shaped objects (a text summary alongside the real resource blob);
    the one with the most rows is the data, the others are commentary. Ties keep
    the first found, which preserves behaviour for single-candidate wrappers.
    """
    candidates = collect_payloads(node)
    if not candidates:
        return None
    return max(candidates, key=candidate_rows)


def find_export_page(node):
    """The columnar export page with the most rows inside an MCP wrapper, or None.

    Narrows to export pages BEFORE ranking, which is what separates it from
    walk_for_payload: an envelope that also carries a richer payload-shaped
    object — a longer `benchmarks` list, say — would otherwise rank that object
    first and the export page would be missed. Both --export-page readers call
    this, so the page one accepts is the page the other accepts.
    """
    pages = [p for p in collect_payloads(node) if looks_like_export_page(p)]
    return max(pages, key=candidate_rows) if pages else None
