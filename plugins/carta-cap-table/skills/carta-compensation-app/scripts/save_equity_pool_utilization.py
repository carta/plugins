#!/usr/bin/env python3
"""Capture Equity Pool figures for the CTC microapp from the carta-web utilization endpoint."""

import json
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from save_benchmark_result import _load  # noqa: E402


def _unwrap(node):
    """Walk into whatever wrapper the MCP put around the payload."""
    if isinstance(node, dict):
        if any(
            k in node
            for k in (
                "totalEquityAvailable",
                "totalReservedShares",
                "totalReserved",
                "usedShares",
            )
        ):
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


def _pool_num(payload, *names):
    """Return a positive int for the first usable name, or None. Zero is treated as absent."""
    for name in names:
        if name in payload and payload[name] is not None:
            try:
                value = int(float(payload[name]))
            except (TypeError, ValueError):
                continue
            return value if value > 0 else None
    return None


def capture(src, raw_dir):
    payload = _unwrap(_load(src))
    if not isinstance(payload, dict):
        sys.exit(
            "save_equity_pool_utilization: expected a utilization object, got %s"
            % type(payload).__name__
        )

    reserved = _pool_num(payload, "totalReservedShares", "total_reserved_shares")
    available = _pool_num(payload, "totalEquityAvailable", "total_equity_available")
    fully_diluted = _pool_num(payload, "fullyDilutedShares", "fully_diluted_shares")
    # Prefer the wire's derived usedShares; fall back to local derivation when both inputs are usable.
    used = _pool_num(payload, "usedShares", "used_shares")
    if used is None and reserved is not None and available is not None:
        diff = reserved - available
        used = diff if diff > 0 else None

    manifest = {
        "schemaVersion": 1,
        "source": "equity-pool-utilization",
        "utilization": payload,
        "poolAvailableShares": available,
        "poolReservedShares": reserved,
        "poolUsedShares": used,
        "poolFullyDilutedShares": fully_diluted,
    }

    out = pathlib.Path(raw_dir)
    out.mkdir(parents=True, exist_ok=True)
    (out / "equity_pool_utilization.json").write_text(json.dumps(manifest, indent=2) + "\n")

    if reserved is None or available is None:
        sys.stderr.write(
            "save_equity_pool_utilization: no usable equity pool figure "
            "(absent, null or zero) — the review step will say so rather than "
            "showing a guardrail it cannot compute.\n"
        )
        print("save_equity_pool_utilization: captured, no pool figure")
    else:
        print(
            "save_equity_pool_utilization: captured, pool reserved %d, available %d, used %d"
            % (reserved, available, used or 0)
        )
    return manifest


def main():
    if len(sys.argv) != 3:
        sys.exit("usage: save_equity_pool_utilization.py <src.json|-> <raw_dir>")
    capture(sys.argv[1], sys.argv[2])


def main_for_test(src, raw_dir):
    return capture(src, raw_dir)


if __name__ == "__main__":
    main()
