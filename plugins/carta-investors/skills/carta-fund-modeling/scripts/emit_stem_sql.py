#!/usr/bin/env python3
"""emit_stem_sql.py — emit ready-to-run DWH stem queries with IN-lists filled in.

Reads the fund id list from the raw dir and prints, per stem, the exact
``dwh__execute__query`` arguments (``sql`` with its ``fund_uuid`` IN-list
substituted, plus ``limit`` and ``format``). This removes the last hand-templating
step from Step 2: the LLM captures the §0 directory once, runs this emitter, and
pastes each printed ``arguments`` object straight into ``call_tool`` — no SQL
authored or IN-list pasted by hand.

Id source (under --raw): ``<raw_dir>/_enumerate.ndjson`` — the §0 entity directory
result as captured by ``save_query_result.py`` (its ``fund_uuid`` column, in order),
else ``<raw_dir>/fund_uuids.txt`` — one uuid per line. Nothing else seeds an
IN-list; every stem is fund-scoped, including the three corporation-filtered ones
(`financing`, `captable`, `corporations`), which reach their corporation scope via
a subquery over FUND_CORPORATION_OWNERSHIP rather than an id list read back out of
a previously-fetched stem (see ``stem_queries._CORP_SCOPE``). There is therefore no
ordering dependency between stems — the whole manifest emits and fetches in one wave.

Usage:
  uv run emit_stem_sql.py --raw <raw_dir> [--all] [--wave 1] [--stem <name>] [--wide]
  uv run emit_stem_sql.py --directory --firm-uuid <firm_uuid>

``--directory`` prints the §0 firm directory query (stem_queries.DIRECTORY_SQL) with
the firm uuid filled in — run it first and capture the result to
``<raw_dir>/_enumerate.ndjson``; that file then seeds every stem below.

``--wide`` emits `SELECT *` superset queries (see stem_queries.WIDE) that reliably
persist to a tool-results file, so small-firm results are captured by path instead
of coming back inline and needing a stdin pipe.
Prints JSON: for --stem, one ``{"sql","limit","format"}`` object; otherwise a
``{stem: {...}}`` map (optionally filtered by --wave).

Stdlib-only, Python 3.9-safe. The SQL itself lives in stem_queries.py.
"""
import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import stem_queries as sq


def _fund_uuids(raw):
    # The captured directory wins over a hand-written list: a stale fund_uuids.txt
    # left by an earlier build must not shadow a fresh enumeration.
    ids = sq.directory_fund_uuids(os.path.join(raw, "_enumerate.ndjson"))
    if ids:
        return ids
    try:
        with open(os.path.join(raw, "fund_uuids.txt"), encoding="utf-8", errors="replace") as fh:
            lines = fh.read().splitlines()
    except OSError:
        return []
    seen, out = set(), []
    for u in lines:
        u = u.strip()
        if u and u not in seen:
            seen.add(u)
            out.append(u)
    return out


def emit(raw, stems, wide=False):
    """Return (out_map, missing) where out_map is {stem: {sql, limit, format}} and
    missing lists stems skipped for lack of ids (no fund ids under ``raw``). When
    ``wide`` is set, stems with a WIDE variant emit the superset query that reliably
    persists to a file (captured by path, not inline)."""
    fund_uuids = _fund_uuids(raw)
    out, missing = {}, []
    for stem in stems:
        if not fund_uuids:
            missing.append(stem)
            continue
        sql, limit, fmt = sq.render(stem, fund_uuids, wide=wide)
        out[stem] = {"sql": sql, "limit": limit, "format": fmt}
    return out, missing


def batches(out_map, max_n):
    """Group the emitted ``{stem: {sql,limit,format}}`` map into ``dwh__execute__queries``
    batches of at most ``max_n`` queries, preserving manifest order.

    Each batch aligns ``stems[i]`` with ``queries[i]`` so ``save_batch_result.py`` can
    map result[i] back to its stem. ``limit`` is batch-level = the max declared limit in
    the chunk: the DWH clamps every limit to 10,000 anyway, and every stem is bounded by
    its own QUALIFY/GROUP well under that, so handing a small stem a larger cap only ever
    returns *more*-complete rows, never wrong ones — which lets arbitrary stems share one
    batch even if the tool takes a single batch-level limit. ``format`` is ndjson (all
    stems are)."""
    items = list(out_map.items())
    out = []
    for i in range(0, len(items), max_n):
        chunk = items[i:i + max_n]
        out.append({
            "batch": len(out) + 1,
            "format": "ndjson",
            "limit": max(spec["limit"] for _, spec in chunk),
            "stems": [s for s, _ in chunk],
            "queries": [spec["sql"] for _, spec in chunk],
        })
    return out


def main(argv):
    ap = argparse.ArgumentParser(description="Emit ready-to-run DWH stem queries.")
    ap.add_argument("--raw", help="raw dir holding _enumerate.ndjson (or fund_uuids.txt)")
    ap.add_argument("--directory", action="store_true",
                    help="emit the §0 firm directory query for --firm-uuid instead of stems")
    ap.add_argument("--firm-uuid", help="firm uuid for --directory")
    ap.add_argument("--stem", help="emit a single stem (prints its arguments object)")
    # Every stem is fund-scoped and therefore wave 1; the flag is kept so an explicit
    # `--wave 1` still works, but `--wave 2` is rejected rather than silently emitting
    # an empty map (which a caller could misread as "nothing left to fetch").
    ap.add_argument("--wave", type=int, choices=(1,),
                    help="restrict to one fetch wave (all stems are wave 1)")
    ap.add_argument("--all", action="store_true", help="emit every stem (the default)")
    ap.add_argument("--wide", action="store_true",
                    help="emit SELECT*-superset queries that reliably persist to a file "
                         "(so small-firm results are captured by path, not inline)")
    ap.add_argument("--batch", action="store_true",
                    help="group all stems into dwh__execute__queries batches (see --max); "
                         "prints a JSON list of {stems, queries, limit, format}. Pair with "
                         "save_batch_result.py to split the indexed response back per stem.")
    ap.add_argument("--max", type=int, default=10, metavar="N",
                    help="max queries per --batch (default 10, the execute_queries cap)")
    ap.add_argument("--skip", action="append", default=[], metavar="STEM",
                    help="exclude a stem from the emitted map (repeatable); "
                         "use when a stem was already handled outside the normal wave "
                         "(e.g. gp_carry after the opt-in check)")
    a = ap.parse_args(argv[1:])

    if a.directory:
        if not a.firm_uuid:
            sys.stderr.write("emit_stem_sql: --directory requires --firm-uuid\n")
            return 2
        sql, limit, fmt = sq.render_directory(a.firm_uuid)
        sys.stdout.write(json.dumps({"sql": sql, "limit": limit, "format": fmt},
                                    ensure_ascii=False) + "\n")
        return 0
    if not a.raw:
        sys.stderr.write("emit_stem_sql: --raw is required\n")
        return 2
    if a.batch and a.stem:
        sys.stderr.write("emit_stem_sql: --batch and --stem are mutually exclusive\n")
        return 2
    if a.batch and a.max < 1:
        sys.stderr.write("emit_stem_sql: --max must be >= 1\n")
        return 2
    if a.batch and a.wide:
        # The aggregate batch response always exceeds the inline threshold and persists
        # to a file, so the SELECT*-superset trick is unnecessary here — emit narrow.
        sys.stderr.write("emit_stem_sql: --wide is ignored with --batch "
                         "(the batched response persists to a file regardless)\n")

    skip = set(a.skip)
    for s in skip:
        if s not in sq.STEMS:
            sys.stderr.write("emit_stem_sql: --skip %r unknown (known: %s)\n"
                             % (s, ", ".join(sorted(sq.STEMS))))
            return 2

    if a.stem:
        if a.stem not in sq.STEMS:
            sys.stderr.write("emit_stem_sql: unknown stem %r (known: %s)\n"
                             % (a.stem, ", ".join(sorted(sq.STEMS))))
            return 2
        if a.stem in skip:
            sys.stderr.write("emit_stem_sql: --stem %r is also in --skip; nothing to emit\n" % a.stem)
            return 2
        stems = [a.stem]
    else:
        stems = [s for s, spec in sq.STEMS.items()
                 if (a.wave is None or spec["wave"] == a.wave) and s not in skip]

    out, missing = emit(a.raw, stems, wide=(a.wide and not a.batch))
    for stem in missing:
        sys.stderr.write("emit_stem_sql: %s skipped — no fund ids in _enumerate.ndjson "
                         "or fund_uuids.txt (write an empty %s.ndjson)\n" % (stem, stem))
    if a.batch:
        sys.stderr.write("emit_stem_sql: note — financials (§14) is not in the manifest; "
                         "run it as its own query or append it to a batch's queries.\n")
        sys.stdout.write(json.dumps(batches(out, a.max), ensure_ascii=False, indent=2) + "\n")
        return 0
    if a.stem:
        if a.stem not in out:
            return 2  # missing ids for the one requested stem
        sys.stdout.write(json.dumps(out[a.stem], ensure_ascii=False) + "\n")
    else:
        sys.stdout.write(json.dumps(out, ensure_ascii=False, indent=2) + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
