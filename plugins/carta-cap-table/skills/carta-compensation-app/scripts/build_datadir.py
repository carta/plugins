#!/usr/bin/env python3
"""
build_datadir.py — corp-agnostic CTC benchmark -> console-schema transform.

Reads the raw outputs of the SKILL's compensation queries (references/queries.md)
plus a small meta.json, and writes the dashboard data dir that serve.py serves. NO
corp-specific data is embedded — every value comes from the raw query files;
missing optional data degrades to empty / "not available" states. Reusable for ANY
corporation.

Stdlib-only, Python 3.9-safe (matches serve.py constraints).

Usage:
    uv run build_datadir.py --raw <rawdir> --out <datadir> --meta <meta.json>

<rawdir> holds one JSON file per job area, each the verbatim `compensation:get:benchmark`
response (the `{"benchmarks": [...]}` envelope, or a bare list). Logical files:

    benchmark_<JOB>.json  required (>=1)  one per job area, `level` omitted so the
                          response carries every level for that job. Fetched one job
                          at a time because omitting BOTH job and level exceeds the
                          40K-char gateway budget (~22 jobs x ~17 levels) and is
                          rejected with "response too large".
    plan.json             required        `compensation:get:plan` — supplies
                          benchmark_version {id, version_major, version_minor, created}
                          and peer_group {code, label, dimension, notional_available}.
                          The peer group is REQUIRED, not cosmetic: it is what makes
                          the numbers tie out with the CTC product UI, and it drives
                          the mandatory attribution string.

meta.json carries the resolved identity: {"corporation": "<name>", "corporationId": <int>}.

Percentiles, not bands. The API returns BOTH `low/mid/high` (the corp's own target
band) and `p25/p50/p75/p90` (raw market data). This builder keeps ONLY the
percentiles — the bands are a corp-specific derived target that adds noise to a
market-benchmark view.

Equity percentiles are NESTED (`percentiles.p25.as_shares`), unlike salary/tcc which
are flat. Both shapes are normalized here so the UI reads one consistent structure.

Bulk export (`compensation:export:benchmarks`, fetched via `--export-page` in
save_benchmark_result.py) replaces the ~22 per-job-area calls with ~2 paged calls,
but produces the SAME per-job-area benchmark_<JOB>.json files this builder has
always read — see save_benchmark_result.py's "columnar bulk-export reconstruction"
section for how a columnar page is reshaped back into that per-row contract. This
builder's row-collection path is unchanged by the export.

GEO SCALARS — KNOWN GAP, do not build around it. `_row()` below carries
`geoSalaryScalar` / `geoEquityScalar` when the API returned them, but there is
currently NO command that returns a bulk per-location scalar table: `geo_adjustment`
(and its `salary_scalar`/`equity_scalar`) is hoisted PER RESPONSE, for the single
`location` param that request passed (national/no-location fetches carry no
scalars at all — see compensation:export:benchmarks' own help text). Building an
offline location dropdown that recomputes geo-adjusted figures client-side would
need a scalar keyed by location across ~400 locations, which would mean either a
~400x fetch multiplier (one export sweep per location) or a new compensation-service
endpoint that does not exist today. Do not paper over this with client-side
interpolation or a hardcoded scalar table — surface the gap instead. If a location
WAS fetched (the raw file's rows carry `geo_adjustment`), applying that one
location's scalars client-side must still follow the order below.

CLIENT-SIDE GEO -> BANDS -> ROUNDING ORDER (when a location's scalars are
available). This is a correctness requirement, not a nice-to-have: the server
applies the geo scalar to the UNROUNDED national base, THEN derives low/mid/high
bands from the geo-adjusted mid, THEN rounds (equity at 4 decimal places, cash at
a corp-configured precision). Any client-side recomputation MUST replicate that
order:
    1. geo-adjust: `national_base * salary_scalar` (or `* equity_scalar` for
       equity), on the full-precision unrounded value.
    2. derive bands from the geo-adjusted (not the national) mid.
    3. round last — equity to 4 decimal places, cash to the corp's cash
       precision (not hardcoded; comes from plan/payband config this builder
       does not currently read).
Reversing the order (rounding the national percentiles first, THEN multiplying by
the scalar, e.g. by reusing the already-rounded percentiles this builder emits)
will drift from the product UI, and the error compounds because bands derive from
the geo-adjusted mid, not the national one. This builder does not currently
implement step 1-3 itself: it has no location-keyed scalar table to drive it (see
above), and the values it emits (`salary.p50` etc.) are the NATIONAL percentiles
already at API precision — safe to display as-is, but NOT a valid input to
re-derive a different location's bands from.
"""
import argparse
import json
import pathlib
import re
import sys
import time

SCHEMA_VERSION = 1


def skill_version():
    """The `version:` from this skill's SKILL.md, or None if it cannot be read.

    Stamped into the snapshot so a warm launch can tell that the skill has moved
    on since the cache was built — a cache is only as good as the code that wrote
    it, and a build predating a capability produces a dashboard missing it with
    nothing on screen to say why.

    Resolved from this file's own location rather than ${CLAUDE_PLUGIN_ROOT},
    which is not guaranteed to be set in the script's environment.
    """
    path = pathlib.Path(__file__).resolve().parent.parent / "SKILL.md"
    try:
        text = path.read_text(encoding="utf-8")
    except OSError:
        return None
    # Frontmatter only: a `version:` further down the body is prose, not the field.
    end = text.find("\n---", 3)
    head = text[:end] if end != -1 else text
    m = re.search(r"^version:\s*(\S+)\s*$", head, re.MULTILINE)
    return m.group(1) if m else None

# Percentiles surfaced by the console. p90 is included: it is real market data the
# API returns, and HR users reference it for top-of-market offers.
PCTS = ("p25", "p50", "p75", "p90")

# The full CTC job-area vocabulary, from the `compensation:get:benchmark` command help.
# Used only to report sweep coverage — a corp legitimately may have no data for some areas,
# so this is never a hard gate, just an honest count.
ALL_JOB_AREAS = [
    "ACCOUNTING", "ADMIN", "CEO", "CORPORATE_AFFAIRS", "CUSTOMER_SUCCESS", "DATA", "DESIGN",
    "ENGINEER", "FINANCE", "HR", "IT", "LEGAL", "MANUFACTURING", "MARKETING", "OPERATIONS",
    "PRODUCT", "PROJECT_MANAGEMENT", "RESEARCH", "SALES", "STRATEGY", "SUPPORT", "OTHER",
]


def _num(x):
    """Coerce an API numeric (often a decimal STRING like "158000.00") to float.

    Returns None for absent/blank/unparseable values so the UI can render "—".
    Never returns 0 as a stand-in for missing — a real 0 and "no data" are
    different facts and conflating them fabricates a benchmark.
    """
    if x is None:
        return None
    if isinstance(x, bool):  # guard: bools are ints in Python
        return None
    if isinstance(x, (int, float)):
        return float(x)
    s = str(x).strip().replace(",", "")
    if not s or s.lower() in ("null", "none", "-", "—"):
        return None
    try:
        return float(s)
    except ValueError:
        return None


def _pcts_flat(node):
    """Salary / TCC shape: percentiles.{p25..p90} are flat numerics."""
    src = (node or {}).get("percentiles") or {}
    return {p: _num(src.get(p)) for p in PCTS}


def _pcts_equity(node):
    """Equity shape: percentiles.{p25..p90} are OBJECTS with three representations.

    Flattened to {notional, shares, fdpct} per percentile so the UI can switch
    representation without reshaping.
    """
    src = (node or {}).get("percentiles") or {}
    out = {}
    for p in PCTS:
        cell = src.get(p) or {}
        out[p] = {
            "notional": _num(cell.get("as_notional_value")),
            "shares": _num(cell.get("as_shares")),
            "fdpct": _num(cell.get("as_fd_percentage")),
        }
    return out


def _job_stem(path):
    """The job-area enum a raw file was fetched for: benchmark_<JOB>.json -> <JOB>.

    Sweep coverage keys on this, never on the `job` field inside the response —
    the stem is what the fetch loop asked for, the field is whatever came back,
    and they are not guaranteed to be the same string.
    """
    return path.name[len("benchmark_"):-len(".json")]


def _read_json(path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as e:
        sys.exit("[build_datadir] cannot read %s: %s" % (path, e))


def _unwrap_benchmarks(payload):
    """Return the benchmarks list from any of the shapes the MCP layer emits.

    Accepts the `{"benchmarks": [...]}` envelope, a bare list, or a single row
    object. Anything else yields [] and is reported by the caller as an empty stem
    rather than crashing mid-build.
    """
    if isinstance(payload, list):
        return payload
    if isinstance(payload, dict):
        for key in ("benchmarks", "results", "rows", "data"):
            v = payload.get(key)
            if isinstance(v, list):
                return v
        if payload.get("job") or payload.get("level"):
            return [payload]
    return []


def _row(entry):
    """Normalize one API benchmark entry into the console row schema."""
    salary = entry.get("salary_benchmarks") or {}
    tcc = entry.get("tcc_benchmarks") or {}
    equity = entry.get("equity_benchmarks") or {}
    geo = entry.get("geo_adjustment") or {}

    # Currency: salary first, then TCC. Never default to USD — a wrong currency
    # symbol silently misrepresents every number in the row.
    currency = salary.get("currency_code") or tcc.get("currency_code")

    return {
        "job": entry.get("job"),
        "level": entry.get("level"),
        # `ladder` is IC | LEADER as returned. The UI splits LEADER into
        # Manager vs Executive by level rank so the displayed track (and its
        # per-track level name) matches the CTC product UI.
        "ladder": entry.get("ladder"),
        "currency": currency,
        "geo": geo.get("label"),
        # salary_scalar / equity_scalar are ONLY present when the fetch that
        # produced this row passed a `location` param — geo is applied
        # per-request, not per-row, and is null for a national (no-location)
        # fetch. See build()'s docstring / SKILL.md for why there is currently
        # no bulk per-location table to build an offline dropdown from; this
        # just avoids discarding the scalar when a location WAS fetched.
        "geoSalaryScalar": _num(geo.get("salary_scalar")),
        "geoEquityScalar": _num(geo.get("equity_scalar")),
        "salary": _pcts_flat(salary),
        "tcc": _pcts_flat(tcc),
        "equity": _pcts_equity(equity),
    }


def build(rawdir, out, meta):
    rawdir = pathlib.Path(rawdir)
    out = pathlib.Path(out)

    # A sweep fetched via the paged export that stopped before `next_job_offset`
    # went null must never build — the whole point of tracking it is to refuse
    # rather than silently publish e.g. 12 of 22 job areas as if it were the full
    # matrix. This is a hard gate, independent of --check (which only warns),
    # because a build can be invoked directly without a --check pass in between.
    export_warning = _export_sweep_incomplete(rawdir)
    if export_warning:
        sys.exit("[build_datadir] refusing to build — %s. Fetch the remaining pages "
                 "(follow next_job_offset) before building." % export_warning)

    plan_path = rawdir / "plan.json"
    if not plan_path.exists():
        sys.exit("[build_datadir] missing required plan.json in %s — "
                 "the peer group and benchmark version come from it" % rawdir)
    plan = _read_json(plan_path)

    peer = plan.get("peer_group") or {}
    dimension = peer.get("dimension")
    if dimension not in ("post_money", "capital_raised", "headcount"):
        # Not a cosmetic problem: the dimension selects which *_bucket param the
        # fetch used AND the attribution phrasing. An unknown value means the
        # numbers may not tie out with the product UI, so refuse to build.
        sys.exit("[build_datadir] plan.json peer_group.dimension is %r — expected "
                 "post_money | capital_raised | headcount" % (dimension,))

    bver = plan.get("benchmark_version") or {}

    # Hard gate, same rationale as the sweep check above: refuse rather than publish
    # figures under a citation naming a release they did not come from.
    version_mismatch = _export_version_mismatch(rawdir, bver.get("id"))
    if version_mismatch:
        sys.exit("[build_datadir] refusing to build — %s." % version_mismatch)

    # Create the output dir only AFTER every refusal gate above has passed, so a
    # refused build leaves no empty dashboard dir behind for the next run (or a
    # `--check`) to trip over. Matches the sweep gate's exit-before-touching-disk
    # behaviour; nothing between here and the gates uses `out`.
    out.mkdir(parents=True, exist_ok=True)

    version_str = None
    if bver.get("version_major") is not None:
        version_str = "v%s.%s" % (bver.get("version_major"), bver.get("version_minor", 0))
    elif bver.get("version"):
        version_str = bver.get("version")

    # Attribution — assembled here so every surface (UI, export, chat) cites
    # identically. The dimension phrase is not hardcodeable: many corps are
    # capital_raised or headcount, and citing "post money" for them is simply wrong.
    #
    # This is assembled PER PEER GROUP, not once: the label is part of the citation
    # ("Companies with post money valuations between $100M-$250M"), so a dashboard that
    # let the user switch peer group while showing one fixed attribution string would
    # mis-cite every group but the default. `_attribution_for` is reused for each
    # alternate group below.
    released = ""
    created = bver.get("created") or ""
    m = re.match(r"(\d{4})-(\d{2})", str(created))
    if m:
        months = ["January", "February", "March", "April", "May", "June", "July",
                  "August", "September", "October", "November", "December"]
        released = " Benchmarks released %s %s." % (months[int(m.group(2)) - 1], m.group(1))
    attribution = _attribution_for(dimension, peer.get("label"), released)

    # ---- benchmark rows: one file per job area ----
    rows = []
    jobs_seen = []
    empty_stems = []
    # Sweep coverage is tracked by FILE STEM, not by the `job` value inside the
    # response. The stem is what the fetch loop iterates (benchmark_<JOB>.json,
    # named from the enum we requested); the `job` field is whatever the API
    # returned and is not guaranteed to match it. Mixing the two made a fetched
    # area report as MISSING — a false "PARTIAL" warning on a complete build.
    stems_fetched = set()
    for p in sorted(rawdir.glob("benchmark_*.json")):
        stems_fetched.add(_job_stem(p))
        entries = _unwrap_benchmarks(_read_json(p))
        if not entries:
            empty_stems.append(p.name)
            continue
        for e in entries:
            r = _row(e)
            if r["job"] and r["level"]:
                rows.append(r)
                if r["job"] not in jobs_seen:
                    jobs_seen.append(r["job"])

    if not rows:
        sys.exit("[build_datadir] no benchmark rows found in %s — expected at least one "
                 "benchmark_<JOB>.json with a non-empty `benchmarks` array. Refusing to "
                 "build an empty dashboard." % rawdir)

    # ---- taxonomy snapshot ----
    # There is NO compensation:list:job_types command (verified: the skills
    # explicitly warn it returns "Unknown tool"), so the taxonomy cannot be
    # enumerated from the API. Snapshotting what the benchmark responses actually
    # returned keeps the UI's dropdowns in sync with real data instead of a
    # hand-maintained browser-side constant that silently drifts.
    levels_by_ladder = {}
    for r in rows:
        levels_by_ladder.setdefault(r["ladder"] or "IC", [])
        if r["level"] not in levels_by_ladder[r["ladder"] or "IC"]:
            levels_by_ladder[r["ladder"] or "IC"].append(r["level"])

    taxonomy = {
        "schemaVersion": SCHEMA_VERSION,
        "jobs": sorted(jobs_seen),
        "levelsByLadder": levels_by_ladder,
        "source": "observed",  # derived from returned rows, not an API enum listing
    }

    currencies = sorted({r["currency"] for r in rows if r["currency"]})
    benchmarks = {
        "schemaVersion": SCHEMA_VERSION,
        "rows": rows,
        # Every distinct currency in the set, not just the first one seen. A corp
        # with international employees returns rows in several currencies, and a
        # summary that names only one of them misstates the rest.
        "currencies": currencies,
        "attribution": attribution,
        "peerGroup": {
            "code": peer.get("code"),
            "label": peer.get("label"),
            "dimension": dimension,
            "notionalAvailable": bool(peer.get("notional_available")),
        },
        "benchmarkVersion": {
            "id": bver.get("id"),
            "version": version_str,
            "created": created or None,
        },
        # equity_quantity is pinned to FOUR_YEAR_GRANT at fetch time to match the
        # CTC product UI default (the MCP default, NTM_VESTING, returns ~25% of the
        # value HR users expect — a hard tie-out failure). Recorded so the UI can
        # label the equity column truthfully.
        "equityQuantity": "FOUR_YEAR_GRANT",
    }

    # ---- alternate peer groups (optional) ----
    # Each peer_<CODE>/ subdirectory is a full matrix for a different bucket in the
    # SAME dimension, letting the UI answer "what would we look like at a higher
    # valuation?" without another MCP call. Verified against the live service: switching
    # bucket changes the figures (Engineer/Senior 1 mid was 176k / 188k / 207k across
    # three post-money buckets) while geo_adjustment, benchmark_version and job coverage
    # stay identical — which is why one hoisted version and geo block still serve the
    # whole cube and only `rows` and the citation differ per group.
    # Emitted in _PEER_LABELS order (low-to-high), NOT filesystem/glob order, so the
    # switcher reads like a scale. peer_* globbing returns alphabetical codes, which
    # would show $50M-$100M above $1M-$10M.
    alternates = {}
    found = _peer_group_dirs(rawdir)
    ordered = [c for c in _PEER_LABELS if c in found] + [c for c in found if c not in _PEER_LABELS]
    for code in ordered:
        dirpath = found[code]
        alt_rows, _alt_jobs, _alt_empty, _alt_stems = _collect_rows(dirpath)
        if not alt_rows:
            # An empty alternate is a fetch that half-failed. Skip it rather than
            # publishing a peer group that renders as a blank grid — the dropdown
            # should only offer groups that actually have data behind them.
            print("[build_datadir] WARNING: peer group %s has no rows — omitting it "
                  "from the switcher." % code)
            continue
        # Each bucket carries its OWN dimension, not the plan's. A headcount bucket
        # describes a different peer SET than a post-money one, so citing it with the
        # plan's phrase ("post money valuations between >500") would be nonsense.
        alt_dim, label = _PEER_LABELS.get(code, (dimension, code))
        alternates[code] = {
            "code": code,
            "label": label,
            "dimension": alt_dim,
            "attribution": _attribution_for(alt_dim, label, released),
            "rows": alt_rows,
        }
    if alternates:
        benchmarks["alternatePeerGroups"] = alternates
        # Grouped BY DIMENSION, each dimension's buckets in ascending order, with the
        # corp's own group in its correct position within its own dimension.
        #
        # Emitted here rather than derived in the UI because bucket rank is not
        # recoverable from a label — "$1B" sorts before "$1M" as text, and headcount
        # labels ("1-25", ">500") have no currency prefix to parse at all. _PEER_LABELS
        # is already in canonical order, so iterating it gives the sequence for free.
        #
        # The grouping is deliberate, not cosmetic. Switching bucket WITHIN a dimension
        # asks "what if we were valued higher?"; switching dimension changes the
        # definition of the peer set, which the corp's plan chose on purpose. One flat
        # list of 18 would make those look like the same kind of act.
        own_code = peer.get("code")
        by_dim = {}
        for code in list(_PEER_LABELS) + [c for c in alternates if c not in _PEER_LABELS]:
            if code not in alternates and code != own_code:
                continue
            dim = (_PEER_LABELS.get(code) or (dimension, code))[0]
            by_dim.setdefault(dim, [])
            if code not in by_dim[dim]:
                by_dim[dim].append(code)
        # The corp's own dimension leads — it is the plan's peer set and the default.
        dims = ([dimension] if dimension in by_dim else []) \
            + [d for d in by_dim if d != dimension]
        benchmarks["peerGroupDimensions"] = [
            {"dimension": d, "label": DIMENSION_LABELS.get(d, d),
             "own": d == dimension, "codes": by_dim[d]}
            for d in dims
        ]

    # Built before the snapshot so its counts can be recorded there — the snapshot is
    # what the UI reads to decide whether the Scorecard tab exists at all, and it is
    # written last as the marker of a complete build.
    roster = _build_roster(rawdir)

    counts = {"benchmarkRows": len(rows), "jobs": len(jobs_seen)}
    if roster is not None:
        counts["rosterEmployees"] = roster["reconciliation"]["rosterTotal"]

    snapshot = {
        "schemaVersion": SCHEMA_VERSION,
        "skillVersion": skill_version(),
        "builtAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "source": {
            "corporation": meta.get("corporation"),
            "corporationId": meta.get("corporationId"),
        },
        "counts": counts,
        "hasRoster": roster is not None,
        "currencies": currencies,
        "attribution": attribution,
        "benchmarkVersion": benchmarks["benchmarkVersion"],
        "peerGroup": benchmarks["peerGroup"],
    }

    def w(name, obj):
        with (out / name).open("w", encoding="utf-8") as fh:
            json.dump(obj, fh, indent=2)

    if roster is not None:
        w("roster.json", roster)

    w("benchmarks.json", benchmarks)
    w("taxonomy.json", taxonomy)
    w("snapshot.json", snapshot)  # written last: its presence marks a complete build

    summary = {
        "rows": len(rows),
        "jobs": len(jobs_seen),
        "currencies": currencies,
        "peer_group": peer.get("label"),
        "benchmark_version": version_str,
        "out": str(out),
    }
    if empty_stems:
        # Surfaced, never silent: an empty stem means that job area returned no
        # data and its rows are simply absent from the grid.
        summary["empty_stems"] = empty_stems

    if roster is not None:
        rec = roster["reconciliation"]
        # Report the per-metric scored counts, not just the roster size: they are the
        # numbers the tab shows, and printing them here is how a builder run gets
        # checked against the product UI without opening the browser.
        summary["roster"] = {
            "employees": rec["rosterTotal"],
            "defaultMetric": roster["defaultMetric"],
            "scoredPerMetric": {m: roster["bandRollup"][m]["scoredTotal"] for m in ROSTER_METRICS},
            "unscoredOnEveryMetric": rec["unscoredOnEveryMetric"],
            "scorecard": roster.get("scorecard") or {},
        }

    # A partial sweep builds fine — but say so. A dashboard showing 4 of 22 job
    # areas looks complete to someone who doesn't know what's missing, and that
    # is a worse failure than refusing to build.
    absent = [j for j in ALL_JOB_AREAS if j not in stems_fetched]
    if absent:
        summary["partial_sweep"] = {"missing_count": len(absent), "missing": absent}
    print("[build_datadir] " + json.dumps(summary))
    if absent:
        print("[build_datadir] WARNING: %d of %d job areas were never fetched — this dashboard is "
              "PARTIAL. Missing: %s" % (len(absent), len(ALL_JOB_AREAS), " ".join(absent)))

    # A regenerating scorecard is the difference between "this employee has no equity"
    # and "the scorecard we were served predates their equity" — indistinguishable in the
    # rows themselves, so it has to be said out loud.
    sc = (roster or {}).get("scorecard") or {}
    if sc.get("regenerating"):
        print("[build_datadir] WARNING: the roster was served from scorecard id %s (as of %s) "
              "while CTC was RECALCULATING. Ratings missing from that snapshot — equity "
              "especially — may exist in the pending run. Re-fetch once CTC reports it "
              "finished." % (sc.get("id"), (sc.get("asOfDate") or "?")[:10]))


# ---- peer-group switching -------------------------------------------------------

_DIMENSION_PHRASE = {
    "post_money": "post money valuations between",
    "capital_raised": "capital raised between",
    "headcount": "headcount of",
}

# Display labels per bucket code, mirroring compensation-service's own enums
# (PostMoneyBuckets / HeadcountBuckets / CapitalRaisedBuckets in
# cheatsheet_benchmarks.py). Needed because an alternate peer group is fetched by CODE
# and the response does not echo a human label back.
#
# BELOW_1M is deliberately absent: the service marks it deprecated ("no new
# corporations can use/select this bucket") and omits it from
# supported_post_money_valuation_options, so it should never reach the switcher.
#
# The dict order below is also the DISPLAY order — Python preserves insertion order and
# json.dump keeps it, so the switcher reads low-to-high. Sorting by code would put
# "$50M-$100M" before "$1M-$10M" (FIFTY < ONE alphabetically), and sorting by the label
# string is no better ("$1B" < "$1M" < "$50M" as text). A bucket's rank is not derivable
# from its name, so the ordering lives here explicitly.
# Each entry is (dimension, label). The DIMENSION matters as much as the label: a bucket
# fetched with headcount_bucket= describes a different peer SET than one fetched with
# post_money_bucket=, so the citation phrase and the switcher's grouping both key off it.
# Codes are unique across the three enums, so one flat table is unambiguous.
_PEER_LABELS = {
    # post money
    "ONE_MILLION": ("post_money", "$1M-$10M"),
    "TEN_MILLION": ("post_money", "$10M-$25M"),
    "TWENTY_FIVE_MILLION": ("post_money", "$25M-$50M"),
    "FIFTY_MILLION": ("post_money", "$50M-$100M"),
    "ONE_HUNDRED_MILLION": ("post_money", "$100M-$250M"),
    "TWO_HUNDRED_FIFTY_MILLION": ("post_money", "$250M-$500M"),
    "FIVE_HUNDRED_MILLION": ("post_money", "$500M-$1B"),
    "ONE_BILLION": ("post_money", "$1B-$10B"),
    # headcount
    "ONE_TO_TWENTY_FIVE": ("headcount", "1-25"),
    "TWENTY_FIVE_TO_HUNDRED": ("headcount", "25-100"),
    "HUNDRED_TO_FIVE_HUNDRED": ("headcount", "100-500"),
    "GREATER_THAN_FIVE_HUNDRED": ("headcount", ">500"),
    # capital raised
    "ONE_TO_TEN_MILLION": ("capital_raised", "$1M-$10M"),
    "TEN_TO_TWENTY_FIVE_MILLION": ("capital_raised", "$10M-$25M"),
    "TWENTY_FIVE_TO_FIFTY_MILLION": ("capital_raised", "$25M-$50M"),
    "FIFTY_TO_ONE_HUNDRED_MILLION": ("capital_raised", "$50M-$100M"),
    "ONE_HUNDRED_TO_TWO_HUNDRED_MILLION": ("capital_raised", "$100M-$200M"),
    "GREATER_THAN_TWO_HUNDRED_MILLION": ("capital_raised", ">$200M"),
}

DIMENSION_LABELS = {
    "post_money": "Post-money valuation",
    "capital_raised": "Capital raised",
    "headcount": "Headcount",
}


def _attribution_for(dimension, label, released):
    """The mandatory citation for one peer group.

    Assembled per group rather than once per build: the label is inside the sentence,
    so a dashboard offering a peer-group switch has to swap the citation with it or it
    mis-attributes every group except the default. That is the one thing about this
    feature that is a correctness issue rather than a convenience.
    """
    return "Data source: Companies with %s %s.%s" % (
        _DIMENSION_PHRASE[dimension], label or "—", released)


def _peer_group_dirs(rawdir):
    """{code -> path} for each alternate peer group fetched into peer_<CODE>/.

    Alternates live in subdirectories so the default group's flat benchmark_*.json
    layout is untouched — a build that fetched only the corp's own group produces
    exactly the same output it did before this feature, with no alternates key.
    """
    out = {}
    for p in sorted(pathlib.Path(rawdir).glob("peer_*")):
        if p.is_dir():
            out[p.name[len("peer_"):]] = p
    return out


def _collect_rows(dirpath):
    """Rows + coverage for one peer group's directory. Mirrors build()'s own loop."""
    rows, jobs_seen, empty_stems, stems = [], [], [], set()
    for p in sorted(pathlib.Path(dirpath).glob("benchmark_*.json")):
        stems.add(_job_stem(p))
        entries = _unwrap_benchmarks(_read_json(p))
        if not entries:
            empty_stems.append(p.name)
            continue
        for e in entries:
            r = _row(e)
            if r["job"] and r["level"]:
                rows.append(r)
                if r["job"] not in jobs_seen:
                    jobs_seen.append(r["job"])
    return rows, jobs_seen, empty_stems, stems


# ---- roster / Scorecard tab (CTCPOD-6135) ----------------------------------

# The metrics the Scorecard tab distributes over, in presentation order. Salary
# first and `overall` LAST is deliberate, not cosmetic: the overall band is null on
# ~73% of BenchmarkedEmployee rows, so a tab keyed on it renders "Low 0 / Mid 0 /
# High 0" — which reads as "nobody is below market" rather than "not scored". The
# per-metric bands are populated and are what the ticket instructs reading.
ROSTER_METRICS = ("salary", "totalCash", "ntmEquity", "overall")
_BANDS = ("LOW", "MID", "HIGH")


def _roster_rollup(rows):
    """Per-metric band distribution + the reconciliation counts.

    Each metric gets its OWN denominator, because they genuinely differ — on the
    reference corporation salary is scored for 10 of 12 employees and total cash for
    11 of 12. One shared scored/unscored pair would misreport at least one of them,
    and "10 of 12" is only trustworthy if it is computed per metric.
    """
    rollup = {}
    for metric in ROSTER_METRICS:
        counts = {b: 0 for b in _BANDS}
        scored = 0
        for row in rows:
            band = (row.get("bands") or {}).get(metric)
            if band in counts:
                counts[band] += 1
                scored += 1
        rollup[metric] = dict(
            counts,
            scoredTotal=scored,
            unscoredCount=len(rows) - scored,
        )
    return rollup


def _assert_rollup_invariants(rollup, roster_total):
    """Fail the build if the counts do not add up.

    These two identities are what make the reconciliation credible. If they can
    drift, "10 of 12 scored" is a number nobody should trust, and the honest move
    is to refuse rather than publish a distribution that quietly disagrees with
    itself.
    """
    for metric, entry in rollup.items():
        banded = sum(entry[b] for b in _BANDS)
        if banded != entry["scoredTotal"]:
            sys.exit("[build_datadir] roster rollup inconsistent for %s: "
                     "LOW+MID+HIGH=%d but scoredTotal=%d" % (metric, banded, entry["scoredTotal"]))
        if entry["scoredTotal"] + entry["unscoredCount"] != roster_total:
            sys.exit("[build_datadir] roster rollup inconsistent for %s: scored %d + unscored %d "
                     "!= roster total %d" % (metric, entry["scoredTotal"],
                                             entry["unscoredCount"], roster_total))


def _default_roster_metric(rollup):
    """Which metric the tab opens on: the first with any scored employee.

    Lives in the data rather than hardcoded in the view so a corporation with no
    salary ratings but real equity ones still opens on something populated instead
    of an empty chart.
    """
    for metric in ROSTER_METRICS:
        if rollup.get(metric, {}).get("scoredTotal"):
            return metric
    return ROSTER_METRICS[0]


# Personal fields that must never reach the published data dir. `save_roster_page` no
# longer captures these, but a raw cache written BEFORE that change still holds them —
# and a raw dir persists for 30 days, so capture-time scrubbing alone would leave every
# existing cache exposed until it expired. Stripping here too means a rebuild cleans an
# old cache instead of faithfully republishing it.
# `name` is deliberately NOT here: the engineer running this skill asked for employee
# names in the roster (see save_roster_page._roster_row). Emails and raw personal_info
# blobs are still dropped — nothing needs them, and they are pure additional exposure.
_PERSONAL_FIELDS = ("email", "personalInfo", "personal_info")


def _scrub_personal(row):
    """A roster row with every personal-identity field removed.

    Deliberately a denylist of known personal fields rather than an allowlist of wanted
    ones: an allowlist here would silently drop any NEW benchmark field the API adds,
    turning a data-model addition into missing figures on the Scorecard. The tradeoff is
    that a newly-added personal field needs adding above — which is why the roster-page
    capture drops them at the source as well, and why a test asserts on both layers.
    """
    return {k: v for k, v in row.items() if k not in _PERSONAL_FIELDS}


def _build_roster(rawdir):
    """roster.json from roster_pages.json, or None when no roster was swept.

    Returns None (rather than an empty roster) when the manifest is absent — a
    benchmarks-only data dir is a legitimate build, and the Scorecard tab simply
    does not appear for it.

    Refuses to build on an INCOMPLETE sweep, mirroring the export gate above. A
    partial roster understates how many employees sit below market, and unlike a
    partial benchmark grid there is no way for a reader to notice the absence.
    """
    manifest_path = pathlib.Path(rawdir) / "roster_pages.json"
    if not manifest_path.exists():
        return None

    manifest = _read_json(manifest_path)
    rows_by_id = manifest.get("rows") or {}
    rows = [_scrub_personal(r) for r in rows_by_id.values()]
    expected = manifest.get("total_results")

    if not manifest.get("sweep_complete"):
        sys.exit("[build_datadir] refusing to build — the roster sweep is INCOMPLETE "
                 "(%s of %s employees captured). Fetch the remaining pages before "
                 "building; a partial roster under-reports how many employees are "
                 "below market." % (len(rows), expected if expected is not None else "?"))

    if not rows:
        sys.exit("[build_datadir] roster_pages.json has no employees — refusing to "
                 "publish an empty roster. Re-run the sweep.")

    # Sort for stable output: same roster in, same file out, so a rebuild produces
    # no spurious diff. Keyed on job/level/externalId rather than a personal name —
    # names are no longer persisted (see save_roster_page._roster_row), and this
    # ordering is more useful anyway: it groups the roster the way the benchmark
    # grid is read, so peers being compared to the same market row sit together.
    rows.sort(key=lambda r: (
        r.get("jobArea") or "", r.get("level") or "", r.get("externalId") or ""))

    rollup = _roster_rollup(rows)
    _assert_rollup_invariants(rollup, len(rows))

    # Employees with no band on ANY metric appear in no distribution at all. Without
    # this count they exist only as a gap between rosterTotal and the largest
    # scoredTotal — a number a reader would have to derive, and therefore wouldn't.
    unscored_everywhere = sum(
        1 for r in rows
        if not any((r.get("bands") or {}).get(m) in _BANDS for m in ROSTER_METRICS))

    # Which scorecard these rows came from. Published so the tab can say the figures are
    # from a snapshot rather than presenting a stale one as current — an absent equity
    # rating in an old scorecard is indistinguishable from "no equity" without it.
    scorecard = manifest.get("scorecard") or {}

    return {
        "schemaVersion": 1,
        "rows": rows,
        "bandRollup": rollup,
        "defaultMetric": _default_roster_metric(rollup),
        "scorecard": scorecard,
        "reconciliation": {
            "rosterTotal": len(rows),
            "unscoredOnEveryMetric": unscored_everywhere,
            "sweepComplete": True,
            "totalResultsReported": expected,
        },
    }


def _export_version_mismatch(rawdir, plan_version_id):
    """None if every export page came from the plan's benchmark release, else a message.

    The export response hoists the `benchmark_version` its figures were computed from.
    plan.json names the release the corporation is PINNED to. Those are two different
    facts, and when they disagree the build would otherwise succeed and cite the plan's
    version over figures fetched from another release -- e.g. year-old percentiles under
    a "released last month" citation. Nothing downstream can detect that afterwards,
    because the built snapshot only carries the plan's version.

    Also catches a sweep whose pages disagree with EACH OTHER (a release published
    mid-sweep), which would splice two releases into one matrix.

    Returns None when the manifest predates this check (no recorded ids) rather than
    failing an otherwise-valid older cache -- the Step 0 gate still covers staleness.
    """
    p = rawdir / "export_pages.json"
    if not p.exists():
        return None
    try:
        manifest = json.loads(p.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None  # the sweep checker already reports an unreadable manifest
    seen = {}
    for pg in manifest.get("pages", []):
        vid = pg.get("benchmark_version_id")
        if vid is not None:
            seen[vid] = pg.get("benchmark_version") or ("id %s" % vid)
    if not seen:
        return None  # manifest written before versions were recorded
    if len(seen) > 1:
        # Always name the id alongside the label: two releases can share a
        # major.minor label, so labels alone can print "(v25.0, v25.0)" and read
        # like a bug in the checker rather than a real split.
        return ("export pages came from MORE THAN ONE benchmark release (%s) — a release "
                "was published mid-sweep, so these pages cannot be spliced into one "
                "matrix. Re-run the sweep" %
                ", ".join("%s (id %s)" % (lbl, vid) for vid, lbl in sorted(seen.items())))
    (page_id, page_label), = seen.items()
    if plan_version_id is not None and page_id != plan_version_id:
        return ("export pages were fetched from benchmark release %s (id %s) but "
                "plan.json pins the corporation to id %s — building would cite the "
                "plan's release over another release's figures. Re-run the sweep against "
                "the plan's version" % (page_label, page_id, plan_version_id))
    return None


def _export_sweep_incomplete(rawdir):
    """None if the raw dir was not fetched via the paged export, else a warning string.

    save_benchmark_result.py's ``--export-page`` mode writes export_pages.json with
    the LAST page's `next_job_offset`. Non-null there means the caller stopped
    paging before `total_job_areas` was covered — checked independently of which
    benchmark_<JOB>.json files happen to exist, because a coincidental full set of
    stems must not be read as "the sweep finished" when the manifest says otherwise.
    """
    p = rawdir / "export_pages.json"
    if not p.exists():
        return None
    try:
        manifest = json.loads(p.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return "export_pages.json is unreadable — re-run the export sweep"
    if manifest.get("sweep_complete") is False:
        pages = manifest.get("pages", [])
        areas_paged = sum(len(pg.get("jobs_covered", [])) + len(pg.get("jobs_empty", []))
                          for pg in pages)
        return ("export sweep stopped early: next_job_offset=%s, %d of %s job areas "
                 "paged through" % (manifest.get("last_next_job_offset"), areas_paged,
                                     manifest.get("total_job_areas")))
    return None


def cmd_check(rawdir):
    """Report sweep coverage without building.

    Run this between fetch waves. It answers the one question that matters mid-sweep —
    "which job areas have I actually captured?" — without the agent having to remember,
    and makes a partial sweep visible BEFORE it becomes a thin dashboard the user mistakes
    for the whole picture.
    """
    rawdir = pathlib.Path(rawdir)
    have, empty, corrupt = [], [], []
    for job in ALL_JOB_AREAS:
        p = rawdir / ("benchmark_%s.json" % job)
        if not p.exists():
            continue
        # A coverage report must survive one bad file — it exists to tell the
        # caller what still needs fetching, and aborting on a single truncated
        # response hides the status of the other 21 areas. Report it and go on.
        try:
            payload = json.loads(p.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            corrupt.append(job)
            continue
        rows = _unwrap_benchmarks(payload)
        # "Parsed but no rows" and "parsed into a shape we don't recognise" are
        # different: the first is a job area this corp genuinely has no data for,
        # the second is a malformed response that must be re-fetched.
        if rows:
            have.append(job)
        elif isinstance(payload, dict) and isinstance(payload.get("benchmarks"), list):
            empty.append(job)
        else:
            corrupt.append(job)
    missing = [j for j in ALL_JOB_AREAS if j not in have and j not in empty and j not in corrupt]
    print("captured : %d/%d  %s" % (len(have), len(ALL_JOB_AREAS), " ".join(have) or "-"))
    if empty:
        print("empty    : %d  %s" % (len(empty), " ".join(empty)))
    if corrupt:
        print("CORRUPT  : %d  %s  (unreadable or not a benchmark envelope — re-fetch)"
              % (len(corrupt), " ".join(corrupt)))
    if missing:
        print("MISSING  : %d  %s" % (len(missing), " ".join(missing)))
    print("plan.json: %s" % ("present" if (rawdir / "plan.json").exists() else "MISSING"))
    export_warning = _export_sweep_incomplete(rawdir)
    if export_warning:
        print("EXPORT SWEEP: %s" % export_warning)
    return 0 if not missing and not corrupt and not export_warning else 1


def main():
    ap = argparse.ArgumentParser(description="CTC benchmark -> console-schema transform")
    ap.add_argument("--raw", required=True)
    ap.add_argument("--out")
    ap.add_argument("--meta")
    ap.add_argument("--check", action="store_true",
                    help="report which job areas are captured so far, then exit (no build)")
    a = ap.parse_args()
    if a.check:
        raise SystemExit(cmd_check(a.raw))
    if not a.out or not a.meta:
        ap.error("--out and --meta are required unless --check is given")
    meta = _read_json(pathlib.Path(a.meta))
    build(a.raw, a.out, meta if isinstance(meta, dict) else {})


if __name__ == "__main__":
    main()
