#!/usr/bin/env python3
"""save_roster_page.py — normalize a Carta MCP scorecard page into raw roster JSON.

The Scorecard-tab counterpart to ``save_benchmark_result.py``: same capture
contract, same unwrapping, different payload. Run it after every
``compensation:get:employee-scorecard`` call instead of hand-copying the printed
result. A roster page is employee names, salaries and compa-ratios — retyping one
risks a wrong digit landing in a figure the dashboard then presents as
authoritative.

Shapes handled (delegated to ``save_benchmark_result``'s unwrapping helpers, so
both scripts stay in step):
  * a bare ``{"employees": [...], "count": N, "total_results": M}`` response
  * the MCP content-block wrapper / base64 ``resource.blob``
  * the harness-persisted ``{"result": "<json text>"}`` string wrapper
  * the REST-shaped variant where each entry nests employee fields under
    ``employee_image`` and ratings under ``benchmark`` (what the service returns
    directly, versus the flatter shape the MCP formatter emits)

WHY THIS ACCUMULATES RATHER THAN OVERWRITES
A scorecard response reports ``count`` (this page) and ``total_results`` (the
roster), but has no memory of prior pages — and pages are documented to return
OVERLAPPING rows. So neither "did I finish" nor "how many distinct employees do I
have" can be answered from one response. This script keeps a single
``roster_pages.json`` holding every employee seen so far, keyed by
``ids.external_id``, plus the paging state.

Re-running the same page is idempotent: rows are keyed by external_id, and each
page entry is keyed by the SET of ids it returned, so a repeat replaces its entry
rather than appending a second one. That matters because the "fetch the next page"
hint counts recorded pages — an append-only list would name a page number that
skips one.

De-duplication is by ``external_id`` and happens HERE rather than at build time,
so the running distinct count is correct between pages and a sweep can be judged
complete the moment it is, rather than after a build attempt.

**Refuses to under-report.** If the accumulated distinct count is below
``total_results`` the manifest records ``sweep_complete: false``, and
``build_datadir.py`` declines to publish a roster in that state. A partial roster
would understate how many employees sit below market, which is worse than no
roster at all.

TWO CAPTURE MODES
``--export-scorecard`` consumes a columnar ``compensation:export:scorecard`` page:
every benchmarked employee in ONE response, so the manifest is written in a single
shot with nothing to accumulate and no overlap to dedupe. Without the flag the
script consumes a PAGED ``compensation:get:employee-scorecard`` response and
accumulates as described above. Both produce the same ``roster_pages.json``
schema, so ``build_datadir.py`` is indifferent to which was used — and the export
decoder reconstructs the nested shape and feeds it through the same
``_roster_row``, so there is one row definition rather than two that can drift.

Usage:
    uv run save_roster_page.py <src_path> <raw_dir>
    uv run save_roster_page.py - <raw_dir>          # read the raw result from stdin
    uv run save_roster_page.py --export-scorecard <src_path> <raw_dir>

Exit codes: 0 captured (branch on the stdout sentinel) · 2 no payload / bad usage.
"""
import json
import pathlib
import sys

# Reuse the sibling's unwrapping rather than reimplementing it: the MCP wrapper
# shapes are identical for every compensation command, and two copies would drift
# the first time a new envelope appears.
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from save_benchmark_result import (  # noqa: E402
    _load,
    _looks_like_roster_page,
    _looks_like_scorecard_export_page,
    _walk_for_payload,
    _write_json,
)

# The per-metric ratings the Scorecard tab reads. Order matters: it is the order
# the rollup and the metric picker present, salary first (see the plan's
# "distribution is PER METRIC" decision). `score` is the OVERALL band and is
# deliberately last — it is null on ~73% of rows, so it can never be the default.
_RATING_FIELDS = (
    ("salary", "salary_rating"),
    ("totalCash", "total_cash_rating"),
    ("ntmEquity", "ntm_equity_rating"),
    ("overall", "score"),
)


def _find_roster_page(raw):
    """Locate the scorecard payload inside whatever wrapper it arrived in.

    Delegates to _walk_for_payload, which recurses through content-block ARRAYS,
    base64 ``resource.blob`` values and string-valued result/content keys. That
    only works because _looks_like_payload now recognises a roster page too — see
    the note on _looks_like_roster_page. Before that, a page nested in a
    content-block list was unreachable and this exited 2.
    """
    if _looks_like_roster_page(raw):
        return raw
    payload = _walk_for_payload(raw)
    if _looks_like_roster_page(payload):
        return payload
    return None


def _employee_fields(entry):
    """Employee identity/pay, from either response shape.

    The MCP formatter emits these at the top level of each entry; the REST
    endpoint nests them under `employee_image`. Reading both means a page captured
    from either source produces the same roster row — worth handling because the
    two are easy to confuse and the failure would be a roster of empty names.
    """
    if not isinstance(entry, dict):
        return {}
    if "employee_image" in entry and isinstance(entry["employee_image"], dict):
        merged = dict(entry["employee_image"])
        # `benchmark` lives on the outer entry in the REST shape.
        for key in ("benchmark", "benchmark_compare_to"):
            if key in entry:
                merged[key] = entry[key]
        return merged
    return entry


def _external_id(fields):
    ids = fields.get("ids")
    if isinstance(ids, dict):
        ext = ids.get("external_id")
        if isinstance(ext, str) and ext:
            return ext
    return None


def _band_of(benchmark, field):
    """The band letter for one metric, or None when that metric is unscored.

    `score` is a bare string; every other rating is an object carrying its own
    `score`. Both are nullable and a null is MEANINGFUL — it means this metric was
    not scored for this employee, which the reconciliation counts rather than
    treating as zero.
    """
    if not isinstance(benchmark, dict):
        return None
    node = benchmark.get(field)
    if node is None:
        return None
    if isinstance(node, str):
        return node or None
    if isinstance(node, dict):
        band = node.get("score")
        return band if isinstance(band, str) and band else None
    return None


def _metric_detail(benchmark, field):
    """Everything the API reports for ONE metric, or None when it is unscored.

    Beyond the band and the compa-ratio, the response carries the market mid
    (`target.yearly_amount`), the employee's `percentile`, and the gap to mid in both
    dollars and percent. Those were being discarded, which left the tab able to say
    "below market, 0.47" but not "$73,000 below a market mid of $138,000" — the second
    is what a reader can act on, and it was already on the wire.

    Every figure is passed through EXACTLY as returned (decimal strings, not floats).
    Re-deriving any of them — even the dollar gap, which looks like plain subtraction —
    would drift from the product UI as soon as the server changed its geo-adjustment
    order or rounding, and the drift would look like data rather than a bug.
    """
    if not isinstance(benchmark, dict):
        return None
    node = benchmark.get(field)
    # `score` (the overall band) is a bare string with no detail to unpack.
    if not isinstance(node, dict):
        return None
    diff = node.get("difference_from_mid") if isinstance(node.get("difference_from_mid"), dict) else {}
    target = node.get("target") if isinstance(node.get("target"), dict) else {}
    detail = {
        "band": node.get("score") or None,
        "compaRatio": node.get("compa_ratio"),
        "percentile": node.get("percentile"),
        "marketMid": target.get("yearly_amount"),
        "diffFromMid": diff.get("yearly_amount"),
        "diffPct": diff.get("percentage"),
        "currency": node.get("currency_code"),
    }
    # An all-null detail carries no more information than the absent key it came from,
    # and publishing it would make "unscored" indistinguishable from "scored with no
    # figures" downstream.
    return detail if any(v is not None for v in detail.values()) else None


def _roster_row(entry):
    """One accumulated roster row. Keeps the API's own numbers verbatim.

    Compa-ratios are NEVER recomputed here — the API returns them, and a
    locally-derived ratio would diverge from the product UI the moment the
    server's rounding or geo-adjustment order changed.

    `name` carries `personal_info.full_name`, at the explicit request of the
    engineer running this skill — a roster you cannot put a name to is hard to
    act on in a real comp review.

    BE AWARE OF WHAT THAT MEANS. This file is a plaintext local cache that also
    feeds a CSV export, so a name here puts a named salary and a
    below/above-market judgement on disk and into any spreadsheet shared from
    it. That is among the most sensitive combinations Carta holds. It stays
    local (serve.py is localhost-bound and token-gated) and it must not be
    committed, pasted into a ticket, or uploaded.

    `externalId` is kept alongside regardless: it is the HRIS id a reader joins
    on, and it is the safe identifier to quote when discussing a row.
    """
    fields = _employee_fields(entry)
    ext = _external_id(fields)
    if ext is None:
        return None
    benchmark = fields.get("benchmark") if isinstance(fields.get("benchmark"), dict) else {}
    role = ((fields.get("title") or {}).get("role")) or {}
    bands = {name: _band_of(benchmark, field) for name, field in _RATING_FIELDS}
    ratios = {}
    for name, field in _RATING_FIELDS:
        node = benchmark.get(field)
        ratios[name] = node.get("compa_ratio") if isinstance(node, dict) else None
    return {
        "externalId": ext,
        "name": (fields.get("personal_info") or {}).get("full_name"),
        "title": (fields.get("title") or {}).get("official_title"),
        "jobArea": role.get("job"),
        "level": role.get("level"),
        "leader": role.get("leader"),
        "focus": role.get("focus") or None,
        "location": fields.get("location"),
        "salary": fields.get("salary"),
        "totalCash": fields.get("total_cash"),
        # The employee's own equity holding, for the Equity column's value.
        #
        # UNVERIFIED SHAPE — every equity field is null on every employee of every corp
        # reachable so far (the served scorecard is a stale pre-equity snapshot), so this
        # captures the raw nodes rather than picking fields out of them. `equity_v2` is
        # preferred when both exist, on the assumption that a v2 supersedes a v1; the UI
        # renders defensively and shows an em dash for anything it cannot read.
        #
        # Do NOT normalise this into a single number until a populated response has been
        # seen: an equity value has three legitimate representations (notional value, FD
        # %, shares — see EQUITY_REPS in model/format.js), and guessing which one the
        # scorecard reports would silently mislabel a unit.
        "equity": fields.get("equity_v2") or fields.get("equity"),
        # The variable component, which is what makes total cash exceed salary
        # ($325k salary + $90k target bonus = $415k total cash on the reference
        # roster). Kept because "why is this person's total cash above their
        # salary?" is otherwise unanswerable from this file.
        #
        # NOT captured: `total_annual_compensation`. It measured identical to
        # `total_cash` on every employee where both were present, and was null on
        # the rest — a duplicate column, not a missing value. `equity`/`equity_v2`
        # are likewise skipped: null for every employee on every corp reachable so
        # far (see the regenerating-scorecard note below), so there is no shape to
        # design against yet and guessing one would be worse than omitting it.
        "targetVariable": fields.get("target_variable"),
        "bands": bands,
        "compaRatios": ratios,
        # Per-metric detail (mid, percentile, gap). `bands`/`compaRatios` are kept
        # alongside rather than replaced: the rollup and the CSV read them directly, and
        # `overall` is a bare string that has no detail node at all.
        "metrics": {name: _metric_detail(benchmark, field) for name, field in _RATING_FIELDS},
    }


def _find_scorecard_export(raw):
    """Locate a columnar employee export inside whatever wrapper it arrived in.

    The shape marker lives in save_benchmark_result so the unwrapping layer can
    recurse into it — see _looks_like_scorecard_export_page there.
    """
    if _looks_like_scorecard_export_page(raw):
        return raw
    payload = _walk_for_payload(raw)
    if _looks_like_scorecard_export_page(payload):
        return payload
    return None


def _rating_node(values, prefix, target_keys):
    """Rebuild one nested rating block from its columnar `<prefix>_*` fields.

    Returns None when the metric is unscored, matching the absent key the nested
    response uses — `_metric_detail` and `_band_of` both already treat that as
    "not scored", so unscored employees keep flowing through unchanged.

    `difference_from_mid` is NOT reconstructed. The export does not carry the gap
    columns, and deriving `actual - mid` here would put a locally-computed figure
    where every other number is the server's own. The nested endpoint applies geo
    adjustment and rounding on its side, so a subtraction done here would drift
    from the product UI and read as data rather than as a bug. Downstream this
    surfaces as a null gap, which the UI already renders for unscored metrics.
    """
    percentile = values.get("%s_percentile" % prefix)
    score = values.get("%s_score" % prefix)
    compa = values.get("%s_compa_ratio" % prefix)
    target = {k: values.get(v) for k, v in target_keys.items()}
    target = {k: v for k, v in target.items() if v is not None}
    if percentile is None and score is None and compa is None and not target:
        return None
    node = {"score": score, "percentile": percentile, "compa_ratio": compa}
    if target:
        node["target"] = target
    currency = values.get("currency")
    if currency is not None:
        node["currency_code"] = currency
    return node


def _export_row_to_entry(columns, row):
    """Reconstruct one nested scorecard entry from a columnar (columns, row) pair.

    Zips by COLUMN NAME, never by position, so appending a column to the export
    stays backward-compatible.

    The reconstructed entry is fed through `_roster_row` rather than being
    flattened here directly. That keeps ONE definition of a roster row: the export
    and the paged endpoint produce byte-identical rows, and a change to the row
    shape cannot land in one path and be forgotten in the other.
    """
    if len(row) != len(columns):
        return None  # caller reports the mismatch; do not guess a shorter row
    values = dict(zip(columns, row))

    benchmark = {
        "score": values.get("score"),
        "salary_rating": _rating_node(values, "sal", {"yearly_amount": "sal_target"}),
        "total_cash_rating": _rating_node(values, "tcc", {"yearly_amount": "tcc_target"}),
        "ntm_equity_rating": _rating_node(
            values, "eq", {"fully_diluted_percentage": "eq_target_fd", "shares": "eq_target_shares"}
        ),
    }
    geo_label = values.get("geo_label")
    if geo_label is not None or values.get("geo_salary_scalar") is not None:
        benchmark["geo_adjustment"] = {
            "label": geo_label,
            "salary_scalar": values.get("geo_salary_scalar"),
            "equity_scalar": values.get("geo_equity_scalar"),
        }

    currency = values.get("currency")
    return {
        "employee_image": {
            "ids": {"external_id": values.get("external_id")},
            "personal_info": {"full_name": values.get("full_name")},
            "title": {
                "official_title": values.get("official_title"),
                "role": {
                    "job": values.get("job"),
                    "level": values.get("level"),
                    "leader": values.get("leader"),
                    "focus": values.get("focus"),
                },
            },
            "location": {
                "home_location": {
                    "city": values.get("home_city"),
                    "state": values.get("home_state"),
                    "country": values.get("home_country"),
                }
            },
            "salary": {"amount": values.get("salary"), "currency": currency},
            "total_cash": {"amount": values.get("total_cash"), "currency": currency},
            "equity_v2": {
                "annualized_ntm": {
                    "fd_percentage": values.get("eq_ntm_fd"),
                    "shares": values.get("eq_ntm_shares"),
                    "notional_value": values.get("eq_ntm_nv"),
                },
                "total_grant": {
                    "fd_percentage": values.get("eq_total_fd"),
                    "shares": values.get("eq_total_shares"),
                    "notional_value": values.get("eq_total_nv"),
                },
            },
        },
        "benchmark": benchmark,
    }


def capture_export(src, raw_dir):
    """Capture a whole-employee-list columnar export as a COMPLETE sweep.

    The export returns every benchmarked employee in one response (the service
    refuses rather than truncating), so unlike the paged path there is nothing to
    accumulate across calls and no overlap to dedupe. The manifest is written in
    one shot with `sweep_complete` derived the same way, so `build_datadir.py`
    needs no knowledge of which path produced it.
    """
    raw_dir = pathlib.Path(raw_dir)

    raw = _load(src)
    page = _find_scorecard_export(raw)
    if page is None:
        preview = json.dumps(raw)[:300] if raw is not None else "<nothing>"
        sys.stderr.write(
            "save_roster_page: no columnar scorecard export found in the source.\n"
            "  Saw: %s\n"
            "  Expected a dict with 'columns' (including external_id) and 'rows'.\n"
            "  A PAGED employee-scorecard response goes through this script WITHOUT\n"
            "  --export-scorecard.\n" % preview)
        sys.exit(2)

    columns = page.get("columns")
    rows = page.get("rows")
    if not isinstance(rows, list):
        sys.exit("save_roster_page: 'rows' is not a list — refusing to guess a shape.")

    known, malformed, skipped = {}, 0, 0
    for row in rows:
        if not isinstance(row, list) or len(row) != len(columns):
            malformed += 1
            continue
        entry = _export_row_to_entry(columns, row)
        built = _roster_row(entry) if entry is not None else None
        if built is None:
            skipped += 1
            continue
        known[built["externalId"]] = built

    if malformed:
        # A width mismatch means the header and the rows disagree, i.e. the
        # payload is not what this decoder was written against. Publishing the
        # rows that happened to line up would put a partial roster on disk under
        # a COMPLETE flag, which is the one thing this script must never do.
        sys.exit(
            "save_roster_page: %d row(s) do not match the %d-column header — refusing "
            "to publish a partially-decoded roster." % (malformed, len(columns)))

    total_results = page.get("total_results")
    if not isinstance(total_results, int):
        total_results = page.get("row_count")
    distinct = len(known)
    complete = isinstance(total_results, int) and distinct >= total_results

    manifest = {
        "rows": known,
        "pages": [{
            "source": "compensation:export:scorecard",
            "returned": len(rows),
            "added": distinct,
            "duplicates": 0,
            "skipped_no_id": skipped,
            "total_results": total_results,
        }],
        "total_results": total_results,
        "distinct_employees": distinct,
        "sweep_complete": complete,
        # The export carries no scorecard-status block, so nothing is asserted
        # about staleness here. `regenerating: None` is "not reported", distinct
        # from the paged path's False, which means "reported, and not running".
        "scorecard": {
            "id": None, "asOfDate": None, "benchmarkVersion": None,
            "status": None, "underConstruction": None, "regenerating": None,
        },
    }
    _write_json(raw_dir / "roster_pages.json", manifest)

    skip_note = ", %d skipped (no external_id)" % skipped if skipped else ""
    print("save_roster_page: export captured %d employee(s)%s — %d distinct"
          % (len(rows), skip_note, distinct))
    if complete:
        print("save_roster_page: sweep COMPLETE — %d of %d employees captured."
              % (distinct, total_results))
    elif isinstance(total_results, int):
        print("save_roster_page: sweep INCOMPLETE — %d of %d employees. The export is "
              "meant to return every employee in one call, so a short response means "
              "the service filtered or capped it — do not build on this."
              % (distinct, total_results))
    else:
        print("save_roster_page: sweep INCOMPLETE — response carried no total_results "
              "or row_count, so completeness cannot be judged.")


def _load_manifest(path):
    if not path.exists():
        return {"rows": {}, "pages": [], "total_results": None}
    try:
        manifest = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {"rows": {}, "pages": [], "total_results": None}
    manifest.setdefault("rows", {})
    manifest.setdefault("pages", [])
    manifest.setdefault("total_results", None)
    return manifest


def main():
    flags = [a for a in sys.argv[1:] if a.startswith("-") and a != "-"]
    argv = [a for a in sys.argv[1:] if not a.startswith("-") or a == "-"]
    unknown = [f for f in flags if f != "--export-scorecard"]
    if unknown:
        sys.exit("save_roster_page: unknown flag(s): %s" % " ".join(unknown))
    if len(argv) != 2:
        sys.exit("usage: save_roster_page.py [--export-scorecard] <src_path|-> <raw_dir>")
    if "--export-scorecard" in flags:
        capture_export(argv[0], argv[1])
    else:
        capture(argv[0], argv[1])


# Tests call this directly rather than patching sys.argv, so a failing assertion
# points at the capture logic instead of at argument plumbing.
def main_for_test(src, raw_dir):
    return capture(src, raw_dir)


def main_for_test_export(src, raw_dir):
    return capture_export(src, raw_dir)


def capture(src, raw_dir):
    raw_dir = pathlib.Path(raw_dir)

    raw = _load(src)
    page = _find_roster_page(raw)
    if page is None:
        preview = json.dumps(raw)[:300] if raw is not None else "<nothing>"
        sys.stderr.write(
            "save_roster_page: no scorecard page found in the source.\n"
            "  Saw: %s\n"
            "  Expected a dict with 'employees' plus 'total_results' or 'count'.\n" % preview)
        sys.exit(2)

    employees = page.get("employees")
    if not isinstance(employees, list):
        sys.exit("save_roster_page: 'employees' is not a list — refusing to guess a shape.")

    manifest_path = raw_dir / "roster_pages.json"
    manifest = _load_manifest(manifest_path)
    known = manifest["rows"]

    added, duplicates, skipped = 0, 0, 0
    page_ids = []
    for entry in employees:
        row = _roster_row(entry)
        if row is None:
            # No external_id means nothing can dedupe it, so counting it would make
            # the distinct total unreliable in whichever direction it was wrong.
            skipped += 1
            continue
        if row["externalId"] in known:
            duplicates += 1
        else:
            added += 1
        known[row["externalId"]] = row
        page_ids.append(row["externalId"])

    total_results = page.get("total_results")
    if isinstance(total_results, int):
        manifest["total_results"] = total_results

    # Record WHICH scorecard these rows came from, and whether a recalculation was in
    # flight when we read it.
    #
    # `employees` is served from the last COMPLETED scorecard. When
    # `is_scorecard_regenerating` is true, that completed snapshot can be well behind
    # the corporation's real state — and ratings absent from the old run (equity in
    # particular) read downstream as "this employee has no equity" rather than "this
    # scorecard predates their equity". On the reference corporation the served
    # scorecard was ~2 months stale with a recalculation running, which is exactly how
    # a fully-populated corporation shows up as equity-less.
    #
    # Captured rather than hard-failed: a stale scorecard is still real data and
    # blocking the build on a background job would make the skill unusable while any
    # recalculation ran. The build surfaces it instead.
    scorecard = page.get("scorecard") if isinstance(page.get("scorecard"), dict) else {}
    manifest["scorecard"] = {
        "id": scorecard.get("id"),
        "asOfDate": scorecard.get("as_of_date"),
        "benchmarkVersion": scorecard.get("benchmark_version"),
        "status": scorecard.get("status"),
        "underConstruction": scorecard.get("under_construction"),
        # Any of the three means the figures on hand may be superseded.
        "regenerating": bool(
            page.get("is_scorecard_regenerating")
            or page.get("is_active_scorecard_regenerating")
            or page.get("is_plan_scorecard_regenerating")
        ),
    }

    # Identify a page by the SET of employees it returned, so re-running the same
    # page replaces its entry instead of appending a second one. Without this the
    # rows dict was idempotent but `pages` was not, and the INCOMPLETE message —
    # which derives the next page number from len(pages) — would tell the agent to
    # fetch page 4 when page 3 was the next unvisited one. Overlapping pages have
    # different id sets, so they still record separately, which is correct.
    fingerprint = ",".join(sorted(page_ids))
    entry = {
        "fingerprint": fingerprint,
        "count": page.get("count"),
        "total_results": total_results,
        "returned": len(employees),
        "added": added,
        "duplicates": duplicates,
        "skipped_no_id": skipped,
    }
    for i, prior in enumerate(manifest["pages"]):
        if prior.get("fingerprint") == fingerprint:
            manifest["pages"][i] = entry
            break
    else:
        manifest["pages"].append(entry)

    distinct = len(known)
    expected = manifest["total_results"]
    complete = isinstance(expected, int) and distinct >= expected
    manifest["distinct_employees"] = distinct
    manifest["sweep_complete"] = complete
    _write_json(manifest_path, manifest)

    dup_note = ", %d duplicate(s) re-seen" % duplicates if duplicates else ""
    skip_note = ", %d skipped (no external_id)" % skipped if skipped else ""
    print("save_roster_page: page captured %d employee(s), %d new%s%s — %d distinct so far"
          % (len(employees), added, dup_note, skip_note, distinct))

    if expected is None:
        print("save_roster_page: sweep INCOMPLETE — response carried no total_results, "
              "so completeness cannot be judged. Re-fetch a page without filters.")
    elif complete:
        print("save_roster_page: sweep COMPLETE — %d of %d employees captured."
              % (distinct, expected))
    else:
        print("save_roster_page: sweep INCOMPLETE — %d of %d employees. Fetch the next "
              "page (page=%s) before building."
              % (distinct, expected, (len(manifest["pages"]) + 1)))


if __name__ == "__main__":
    main()
