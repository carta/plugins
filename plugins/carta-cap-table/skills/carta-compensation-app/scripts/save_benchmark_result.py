#!/usr/bin/env python3
"""save_benchmark_result.py — normalize a Carta MCP compensation result into raw JSON.

Deterministically converts ANY of the shapes the Carta MCP emits into the plain
JSON file(s) that ``build_datadir.py`` reads. Run it after every
``compensation:get:*`` / ``compensation:export:benchmarks`` call instead of
hand-copying the printed result — that hand-copying is what makes a first build
slow and occasionally silently empty.

Shapes handled:
  * a bare JSON object (the common case — ``{"benchmarks": [...]}`` or a plan)
  * a JSON array of rows
  * the columnar bulk-export envelope — ``{"columns": [...], "rows": [[...]]}``
    plus ``jobs_covered``/``jobs_empty``/``job_offset``/``next_job_offset``/
    ``total_job_areas`` and hoisted ``geo_adjustment``/``benchmark_version`` —
    from ``compensation:export:benchmarks``. Handled by ``--export-page`` below,
    NOT by the single-dest mode: one page covers up to 12 job areas, so it fans
    out to one ``benchmark_<JOB>.json`` per job rather than one dest file.
  * the MCP content-block wrapper — e.g.
    ``[{"type":"text",...},{"type":"resource","resource":{"blob":"<base64>",...}}]``
    (or a dict with a ``content``/``result``/``rows``/``data`` key) — by
    base64-decoding the resource blob, which is itself JSON
  * the harness-persisted large-result wrapper ``{"result": "<json text>"}`` — a
    *string*-valued ``result``/``content``/``text``, which the Carta MCP writes to a
    tool-results ``.txt`` when a result exceeds the context limit

Exits non-zero (2) if it cannot find a usable payload, printing what it saw, so the
caller never silently feeds an empty file to the builder.

**Empty is not the same as failed.** A job area that genuinely has no benchmark rows
is normal (not every corp has every function). That writes an empty-but-valid file
and exits 0 with an ``EMPTY`` sentinel on stdout, so the caller can distinguish it
from a transport error and the builder can report it as an empty stem rather than
failing the whole build.

Usage:
    uv run save_benchmark_result.py <src_path> <dest.json>
    uv run save_benchmark_result.py - <dest.json>     # read the raw result from stdin
    uv run save_benchmark_result.py --export-page <src_path> <raw_dir>   # bulk export page

Exit codes: 0 captured (branch on the stdout sentinel) · 2 no payload / bad usage.
"""
import base64
import json
import pathlib
import sys

# The percentile suffixes the columnar export uses (sal_p25, eq_p50_fd, ...).
# Mirrors BENCHMARK_COLUMNS in compensation-service's columnar_serializers.py —
# the client zips columns against each row by NAME (see _export_row_to_benchmark),
# so appending a column there is safe; this only needs the suffixes it reads.
# The export also carries low/mid/high band columns, which this builder drops —
# consistent with the existing "percentiles only, bands are a corp-specific
# derived target" policy already applied to the non-export fetch path.
_EXPORT_PCT_KEYS = ("p25", "p50", "p75", "p90")

# Keys the MCP uses to nest a payload inside a wrapper. Mirrors
# carta-fund-modeling/scripts/save_query_result.py.
_CONTAINER_KEYS = ("content", "result", "results", "rows", "data")

# Keys that identify a real compensation payload once unwrapped.
_PAYLOAD_KEYS = ("benchmarks", "peer_group", "benchmark_version", "is_subscribed",
                 "job", "level", "versions")

# Markers unique to the columnar bulk-export envelope (compensation:export:benchmarks).
# Kept separate from _PAYLOAD_KEYS: "benchmark_version" alone is ambiguous (a plan
# payload also carries it hoisted), but "columns" + "jobs_covered" together only ever
# appear on an export page.
_EXPORT_PAYLOAD_KEYS = ("columns", "jobs_covered", "jobs_empty")


def _decode_blob(blob):
    """base64-decode an MCP resource blob and read it as JSON."""
    if not isinstance(blob, str):
        return None
    try:
        raw = base64.b64decode(blob, validate=False)
        return json.loads(raw.decode("utf-8"))
    except (ValueError, UnicodeDecodeError):
        return None


def _looks_like_payload(val):
    """True when val is a compensation payload rather than a transport wrapper.

    The markers are deliberately narrow. `id` and `version` were here once and
    are far too generic — a JSON-RPC envelope is a list whose first element has
    `id`, so it matched as a payload and got written verbatim, giving the builder
    one junk "row" from a wrapper. Only fields that are unique to a benchmark row
    count.
    """
    if isinstance(val, list):
        # A list of benchmark rows (each carrying job/level) is a payload.
        return bool(val) and isinstance(val[0], dict) and any(
            k in val[0] for k in ("job", "level", "salary_benchmarks"))
    if isinstance(val, dict):
        return (any(k in val for k in _PAYLOAD_KEYS)
                or _looks_like_export_page(val)
                or _looks_like_scorecard_export_page(val)
                or _looks_like_roster_page(val))
    return False


def _looks_like_export_page(val):
    """True when val is a columnar bulk-export page (compensation:export:benchmarks)."""
    return isinstance(val, dict) and all(k in val for k in _EXPORT_PAYLOAD_KEYS)


def _looks_like_scorecard_export_page(val):
    """True when val is a columnar EMPLOYEE export (compensation:export:scorecard).

    Separate from _looks_like_export_page: both are columnar, but the benchmark
    export is identified by `jobs_covered`/`jobs_empty`, which an employee export
    does not carry. `external_id` in the header is the marker that cannot appear
    in a market-band export, so the two never match each other's payloads.

    Lives here, in the shared unwrapping layer, for the same reason
    _looks_like_roster_page does: _collect_payloads only recurses into shapes
    _looks_like_payload accepts, so without this an export nested in a
    content-block array or a base64 resource.blob is unreachable.
    """
    if not isinstance(val, dict):
        return False
    columns = val.get("columns")
    return isinstance(columns, list) and isinstance(val.get("rows"), list) and "external_id" in columns


def _looks_like_roster_page(val):
    """True when val is a scorecard roster page (compensation:get:employee-scorecard).

    Recognised HERE, in the shared unwrapping layer, rather than only in
    save_roster_page.py. _collect_payloads is what walks content-block ARRAYS and
    base64 ``resource.blob`` values, and it only recurses into things
    _looks_like_payload accepts — so a roster page nested in a content-block list
    was unreachable from the roster script's own shallow fallback scan, which is
    guarded on the top level being a dict. Putting the marker here means both
    scripts pick up any new envelope shape at the same time instead of drifting.

    `employees` alone is too weak (a future non-scorecard payload could carry it),
    so pair it with one of the count fields.
    """
    if not isinstance(val, dict) or "employees" not in val:
        return False
    return any(k in val for k in ("total_results", "count"))


def _candidate_rows(candidate):
    """Row count used to rank competing payloads found in one wrapper.

    Distinct from _row_count() below, which reports for the sentinel and returns
    None for non-row payloads; this one is a plain comparable integer.
    """
    if isinstance(candidate, dict):
        rows = candidate.get("benchmarks")
        if isinstance(rows, list):
            return len(rows)
        export_rows = candidate.get("rows")
        if _looks_like_export_page(candidate) and isinstance(export_rows, list):
            return len(export_rows)
        employees = candidate.get("employees")
        if _looks_like_roster_page(candidate) and isinstance(employees, list):
            return len(employees)
        return 0
    if isinstance(candidate, list):
        return len(candidate)
    return 0


def _collect_payloads(node, depth=0, found=None):
    """Collect EVERY payload-shaped object reachable inside an MCP wrapper.

    Decodes any ``resource.blob`` (base64 JSON), parses string-valued
    text/result/content as JSON, and follows container keys.

    Collects rather than returning the first hit, because a content-block
    wrapper routinely carries more than one candidate and the first is often the
    wrong one: the ``{"type":"text"}`` summary block precedes the
    ``{"type":"resource"}`` block that holds the real rows. Returning eagerly
    captured a one-line status blurb and silently discarded 17 benchmark rows.
    The caller ranks the candidates instead.
    """
    if found is None:
        found = []
    if depth > 8:  # transport wrappers are shallow; deeper means we're lost
        return found

    if _looks_like_payload(node):
        found.append(node)
        # Keep walking: a payload-shaped node can still contain a richer one.

    if isinstance(node, dict):
        res = node.get("resource")
        if isinstance(res, dict) and res.get("blob"):
            _collect_payloads(_decode_blob(res["blob"]), depth + 1, found)
        if node.get("blob") and "resource" not in node:
            _collect_payloads(_decode_blob(node["blob"]), depth + 1, found)
        # A string-valued text/result/content is embedded JSON — this is the
        # large-result path, where the harness persists the payload as text.
        for key in ("text",) + _CONTAINER_KEYS:
            val = node.get(key)
            if isinstance(val, str) and val.strip():
                try:
                    _collect_payloads(json.loads(val), depth + 1, found)
                except ValueError:
                    pass
            elif isinstance(val, (dict, list)):
                _collect_payloads(val, depth + 1, found)

    if isinstance(node, list):
        for item in node:
            _collect_payloads(item, depth + 1, found)

    return found


def _walk_for_payload(node):
    """The richest payload inside an MCP wrapper, or None.

    "Richest" = most benchmark rows. A wrapper can legitimately contain several
    payload-shaped objects (a text summary alongside the real resource blob);
    the one with the most rows is the data, the others are commentary. Ties keep
    the first found, which preserves behaviour for single-candidate wrappers.
    """
    candidates = _collect_payloads(node)
    if not candidates:
        return None
    return max(candidates, key=_candidate_rows)


def _load(src):
    if src == "-":
        text = sys.stdin.read()
    else:
        p = pathlib.Path(src)
        if not p.exists():
            sys.exit("save_benchmark_result: source not found: %s" % src)
        text = p.read_text(encoding="utf-8", errors="replace")

    text = text.strip()
    if not text:
        sys.exit("save_benchmark_result: source is empty: %s" % src)

    try:
        return json.loads(text)
    except ValueError:
        # Not a single JSON document. The MCP sometimes prints a short preamble
        # before the payload — retry from the first brace/bracket.
        for opener in ("{", "["):
            idx = text.find(opener)
            if idx > 0:
                try:
                    return json.loads(text[idx:])
                except ValueError:
                    continue
        sys.exit("save_benchmark_result: source is not JSON (first 200 chars): %s"
                 % text[:200].replace("\n", " "))


def _row_count(payload):
    if isinstance(payload, dict):
        rows = payload.get("benchmarks")
        if isinstance(rows, list):
            return len(rows)
        return None  # a plan / subscription payload has no row count
    if isinstance(payload, list):
        return len(payload)
    return None


# ---- columnar bulk-export reconstruction (compensation:export:benchmarks) ----
#
# build_datadir.py's row reader (_row() in build_datadir.py) expects the NESTED
# per-job shape: {"job", "ladder", "level", "salary_benchmarks": {"percentiles":
# {...}, "currency_code": ...}, "tcc_benchmarks": {...}, "equity_benchmarks":
# {...}, "geo_adjustment": {...}}. Reconstructing that here — instead of teaching
# build_datadir.py a second row shape — keeps the builder's row-collection path
# (and its sweep-coverage bookkeeping) untouched and shared by both fetch paths.


def _export_row_to_benchmark(columns, row, geo_adjustment):
    """Reconstruct one nested benchmark entry from a columnar (columns, row) pair.

    Zips by COLUMN NAME, never by position — appending a column to the export is
    safe, and this must not assume today's column count stays fixed.
    """
    if len(row) != len(columns):
        return None  # caller reports the mismatch; do not guess a shorter row
    values = dict(zip(columns, row))

    def get(name):
        return values.get(name)

    salary_pcts = {p: get("sal_%s" % p) for p in _EXPORT_PCT_KEYS}
    tcc_pcts = {p: get("tcc_%s" % p) for p in _EXPORT_PCT_KEYS}
    currency = get("currency")

    equity_pcts = {}
    for p in _EXPORT_PCT_KEYS:
        equity_pcts[p] = {
            "as_shares": get("eq_%s_sh" % p),
            "as_fd_percentage": get("eq_%s_fd" % p),
            "as_notional_value": get("eq_%s_nv" % p),
        }

    return {
        "job": get("job"),
        "ladder": get("ladder"),
        "level": get("level"),
        "focus": get("focus"),
        "salary_benchmarks": {"percentiles": salary_pcts, "currency_code": currency},
        "tcc_benchmarks": {"percentiles": tcc_pcts, "currency_code": currency},
        "equity_benchmarks": {"percentiles": equity_pcts},
        # Geo is hoisted on the export response (one value for the whole page,
        # since geo is applied per-request, not per-row) — reattach it to every
        # reconstructed row so build_datadir.py's per-row `entry.get("geo_adjustment")`
        # keeps working unmodified.
        "geo_adjustment": geo_adjustment,
    }


def _write_json(path, obj):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as fh:
        json.dump(obj, fh, indent=2)


def _save_export_page(raw, raw_dir):
    """Fan an export page out into one benchmark_<JOB>.json per job it covers.

    Matches the per-job-area file the sweep has always produced (one file per
    `references/queries.md` §3 job area), so build_datadir.py needs no changes
    to its row-collection or --check coverage logic — it still just globs
    `benchmark_*.json`. A page covering several jobs therefore writes several
    files, not one.

    Returns the manifest dict recorded to export_pages.json (see main()) so the
    caller can tell a complete paged sweep from one that stopped partway.
    """
    page = _walk_for_payload(raw)
    if page is None or not _looks_like_export_page(page):
        preview = json.dumps(raw)[:300]
        sys.stderr.write(
            "save_benchmark_result: --export-page did not find a columnar export "
            "envelope in the source.\n  Saw: %s\n  Expected a dict with %s.\n"
            % (preview, ", ".join(_EXPORT_PAYLOAD_KEYS)))
        sys.exit(2)

    columns = page.get("columns")
    rows = page.get("rows")
    if not isinstance(columns, list) or not isinstance(rows, list):
        sys.exit("save_benchmark_result: export page has non-list columns/rows — "
                 "refusing to guess a shape.")

    geo_adjustment = page.get("geo_adjustment")
    covered = page.get("jobs_covered") or []
    empty = page.get("jobs_empty") or []

    # Group reconstructed rows by job, so one page covering several job areas
    # still lands as separate benchmark_<JOB>.json files.
    by_job = {}
    for i, row in enumerate(rows):
        entry = _export_row_to_benchmark(columns, row, geo_adjustment)
        if entry is None:
            sys.exit("save_benchmark_result: export row %d has %d value(s) but there are "
                     "%d columns — refusing to write a row that would shift every field."
                     % (i, len(row) if isinstance(row, list) else -1, len(columns)))
        by_job.setdefault(entry["job"], []).append(entry)

    raw_dir = pathlib.Path(raw_dir)
    written = []
    for job in covered:
        entries = by_job.get(job, [])
        _write_json(raw_dir / ("benchmark_%s.json" % job), {"benchmarks": entries})
        written.append(job)
    for job in empty:
        # Same contract as the non-export path: EMPTY is a valid, written file,
        # not a missing one — this job area genuinely has no data for this corp.
        _write_json(raw_dir / ("benchmark_%s.json" % job), {"benchmarks": []})
        written.append(job)

    total_rows = sum(len(v) for v in by_job.values())
    print("save_benchmark_result: export page captured %d job area(s) (%s), %d empty, "
          "%d row(s) total" % (len(covered), ", ".join(covered) or "-", len(empty), total_rows))

    # benchmark_version is recorded PER PAGE, not just relied on from plan.json.
    #
    # The export response hoists the version the figures were actually computed from.
    # Without it here, a sweep whose pages were fetched against different releases --
    # or against a release other than the one plan.json names -- builds successfully and
    # cites the plan's version, so year-old percentiles ship under a current citation.
    # build_datadir.py cross-checks this against plan.json and refuses to build on a
    # mismatch; it can only do that if capture keeps the value.
    bver = page.get("benchmark_version") or {}
    return {
        "job_offset": page.get("job_offset"),
        "next_job_offset": page.get("next_job_offset"),
        "total_job_areas": page.get("total_job_areas"),
        "jobs_covered": covered,
        "jobs_empty": empty,
        "benchmark_version_id": bver.get("id"),
        "benchmark_version": (
            "v%s.%s" % (bver.get("version_major"), bver.get("version_minor", 0))
            if bver.get("version_major") is not None else bver.get("version")
        ),
    }


def _record_export_manifest(raw_dir, page_manifest):
    """Append this page's manifest to export_pages.json in the raw dir.

    A single page response only reports its OWN `next_job_offset` — it has no
    memory of prior pages. build_datadir.py's completeness check (and a human
    re-running --check between waves) needs the union across every page fetched
    so far, so this accumulates rather than overwrites. The critical field is
    the LAST page's `next_job_offset`: non-null there means the sweep stopped
    before covering `total_job_areas` and must not be treated as complete.
    """
    raw_dir = pathlib.Path(raw_dir)
    manifest_path = raw_dir / "export_pages.json"
    manifest = {"pages": [], "total_job_areas": None}
    if manifest_path.exists():
        try:
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            manifest = {"pages": [], "total_job_areas": None}
    manifest.setdefault("pages", [])
    manifest["pages"].append(page_manifest)
    if page_manifest.get("total_job_areas") is not None:
        manifest["total_job_areas"] = page_manifest["total_job_areas"]
    manifest["last_next_job_offset"] = page_manifest.get("next_job_offset")
    manifest["sweep_complete"] = page_manifest.get("next_job_offset") is None
    _write_json(manifest_path, manifest)
    return manifest


def main():
    argv = sys.argv[1:]
    export_mode = "--export-page" in argv
    args = [a for a in argv if not a.startswith("-") or a == "-"]
    if len(args) != 2:
        sys.exit(__doc__)
    src, dest = args

    raw = _load(src)

    if export_mode:
        page_manifest = _save_export_page(raw, dest)
        manifest = _record_export_manifest(dest, page_manifest)
        if manifest["sweep_complete"]:
            print("save_benchmark_result: sweep COMPLETE — next_job_offset is null "
                  "(all %s job areas covered across %d page(s))."
                  % (manifest.get("total_job_areas"), len(manifest["pages"])))
        else:
            print("save_benchmark_result: sweep INCOMPLETE — next_job_offset=%s. "
                  "Fetch the next page before building."
                  % manifest["last_next_job_offset"])
        return

    payload = _walk_for_payload(raw)

    if payload is None:
        # Refuse rather than write a junk wrapper the builder would misread as
        # one row. Show what we actually saw so the caller can fix the call.
        preview = json.dumps(raw)[:300]
        sys.stderr.write(
            "save_benchmark_result: no compensation payload found in %s.\n"
            "  Saw: %s\n"
            "  Expected a dict with one of %s, or an MCP wrapper containing one.\n"
            % (src, preview, ", ".join(_PAYLOAD_KEYS)))
        sys.exit(2)

    dest_path = pathlib.Path(dest)
    _write_json(dest_path, payload)

    n = _row_count(payload)
    if n == 0:
        # Valid, just empty — this job area has no benchmark data for this corp.
        # Exit 0 so the caller does not treat it as a failure; the sentinel lets
        # it be reported honestly instead of silently.
        print("save_benchmark_result: %s EMPTY (0 rows)" % dest_path.name)
    elif n is None:
        print("save_benchmark_result: %s captured (non-row payload)" % dest_path.name)
    else:
        print("save_benchmark_result: %s captured (%d rows)" % (dest_path.name, n))


if __name__ == "__main__":
    main()
