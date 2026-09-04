#!/usr/bin/env python3
"""save_report_insights.py — capture a corporation's report insights.

The planner needs one figure from here: the equity pool's available shares, which
the review step shows a planned draw against. Everything else in the payload is
carried through unchanged rather than filtered, because the shape is small and a
future screen asking for `equity_refresh.num_employees` should not need a new
capture.

WHERE THE POOL FIGURE COMES FROM
`efab.available_shares` is the sum of `available` across the corporation's equity
pools, straight from the equity ledger — comp-service maps the ledger's summaries
and sums them (`GetEquityPoolSummaries.execute`), then the insights endpoint reads
that sum. Nothing here recomputes it.

AN ABSENT POOL IS NOT A POOL OF ZERO
This is the whole reason the script does more than copy a number.

The endpoint reads a CACHE that a separate out-of-band job primes, so a null means
"nobody has warmed this yet", not "this company has no shares". And a corporation
whose ledger returns NO pools sums to exactly 0 — indistinguishable, in the
payload, from a company that has a pool and has genuinely exhausted it.

Both land as absent here, never as 0. A review screen that showed "0 available"
would tell someone their plan overruns a pool that, as far as we actually know,
might be empty or might be forty million. Refusing to answer is correct; guessing
is not.
"""
import json
import pathlib
import sys

# `_load` is shared — it handles the MCP's occasional preamble before the JSON.
# `_walk_for_payload` deliberately is NOT: it ranks candidates by ROW COUNT, which
# is the right rule for a columnar export and the wrong one here. This payload has
# no rows, so every candidate would tie at zero.
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from save_benchmark_result import _load  # noqa: E402


def _unwrap(node):
    """The insights object inside whatever wrapper the MCP put around it.

    Identified by its own keys rather than by position, so an extra envelope layer
    does not silently yield the wrapper itself.
    """
    if isinstance(node, dict):
        if any(k in node for k in ("efab", "equity_refresh", "equityRefresh")):
            return node
        for value in node.values():
            found = _unwrap(value)
            if found is not None:
                return found
    elif isinstance(node, list):
        for item in node:
            found = _unwrap(item)
            if found is not None:
                return found
    return None


def _pool_available(payload):
    """The pool's available shares, or None when we cannot honestly say.

    None — never 0 — when the field is missing, null, unparseable, or zero. See
    the module docstring: zero is what an absent ledger and an exhausted pool both
    produce, and the two are not the same claim.
    """
    efab = payload.get("efab") or {}
    raw = efab.get("available_shares", efab.get("availableShares"))
    if raw is None:
        return None
    try:
        value = int(raw)
    except (TypeError, ValueError):
        return None
    return value if value > 0 else None


def capture(src, raw_dir):
    payload = _unwrap(_load(src))
    if not isinstance(payload, dict):
        sys.exit(
            "save_report_insights: expected an insights object, got %s"
            % type(payload).__name__
        )

    available = _pool_available(payload)
    manifest = {
        "schemaVersion": 1,
        "source": "report-insights",
        "insights": payload,
        "poolAvailableShares": available,
    }

    out = pathlib.Path(raw_dir)
    out.mkdir(parents=True, exist_ok=True)
    (out / "report_insights.json").write_text(json.dumps(manifest, indent=2) + "\n")

    if available is None:
        # Not an error: the cache is primed out of band, so an un-warmed one is a
        # normal state. Say which it is so nobody reads the review screen's absent
        # pool bar as a bug in the app.
        sys.stderr.write(
            "save_report_insights: no usable equity pool figure "
            "(absent, null or zero) — the review step will say so rather than "
            "showing a guardrail it cannot compute.\n"
        )
        print("save_report_insights: captured insights, no pool figure")
    else:
        print("save_report_insights: captured insights, pool available %d" % available)
    return manifest


def main():
    if len(sys.argv) != 3:
        sys.exit("usage: save_report_insights.py <src.json|-> <raw_dir>")
    capture(sys.argv[1], sys.argv[2])


def main_for_test(src, raw_dir):
    """Entry point for tests, mirroring save_equity_refresh_page's hook."""
    return capture(src, raw_dir)


if __name__ == "__main__":
    main()
