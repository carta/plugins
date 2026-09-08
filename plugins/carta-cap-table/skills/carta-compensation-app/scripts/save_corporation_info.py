#!/usr/bin/env python3
"""save_corporation_info.py — capture a corporation's equity unit inputs.

The planner can show a grant three ways, matching CTC's own Equity Unit dropdown:
as shares, as fully diluted ownership, or as an equity value. The last two need
figures the equity refresh report does not carry — the fully diluted share count
and the corporation's per-share equity value — and both live on the corporation
info endpoint instead.

WHICH PRICE, AND WHY IT IS NOT A CHOICE
`equity_value` is resolved server-side from the corporation's own settings. It is
NOT a client-side pick between the preferred price and the 409A fair market value:
picking one here would produce a number that disagrees with every other CTC
surface. Measured on corp 7, the endpoint returns 5.36, which is its preferred
price, while its FMV is 8.12 — a console that chose FMV would overstate the same
grant by half again.

The two raw prices are carried through as well, because the console shows which
basis it used and cannot say that from the resolved figure alone.

AN ABSENT PRICE DROPS THE UNIT, IT DOES NOT ZERO IT
A corporation with no valuation returns `equity_value: null` — corp 245 does. CTC
handles this by removing the unit from its dropdown rather than offering a
$0 reading, and falls back to ownership. This capture records the absence
faithfully so the app can do the same; a 0 here would be a claim that every grant
is worthless.
"""
import json
import pathlib
import sys

# `_load` handles the MCP's occasional preamble before the JSON. The columnar
# unwrapper is deliberately not reused: it ranks candidates by row count, and this
# payload has no rows.
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from save_benchmark_result import _load  # noqa: E402


def _unwrap(node):
    """The corporation info object inside whatever wrapper the MCP put around it.

    Identified by its own keys rather than by position, so an extra envelope layer
    does not silently yield the wrapper itself.
    """
    if isinstance(node, dict):
        if "data" in node and isinstance(node.get("data"), dict):
            inner = node["data"]
            if any(k in inner for k in ("fullyDilutedShares", "fully_diluted_shares", "corporation")):
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


def _num(payload, *names):
    """The first present key as a float, or None.

    None — never 0 — for absent, null or unparseable. Zero is a real share count
    and a real price; conflating it with "not captured" is how a unit ends up
    offered with nothing behind it.
    """
    for name in names:
        if name in payload and payload[name] is not None:
            try:
                return float(payload[name])
            except (TypeError, ValueError):
                return None
    return None


def capture(src, raw_dir):
    payload = _unwrap(_load(src))
    if not isinstance(payload, dict):
        sys.exit(
            "save_corporation_info: expected a corporation info object, got %s"
            % type(payload).__name__
        )

    inner = payload.get("data") or {}
    equity_value = _num(payload, "equityValue", "equity_value")
    manifest = {
        "schemaVersion": 1,
        "source": "corporation-info",
        "equityValue": equity_value,
        "fullyDilutedShares": _num(inner, "fullyDilutedShares", "fully_diluted_shares"),
        # Carried so the console can name the basis it is showing. Not used for the
        # arithmetic — `equityValue` is the resolved figure and the only one that
        # agrees with the rest of CTC.
        "lastPreferredPrice": _num(inner, "lastPreferredPrice", "last_preferred_price"),
        "lastFairMarketValue": _num(inner, "lastFairMarketValue", "last_fair_market_value"),
        "asOf": inner.get("asOf") or inner.get("as_of"),
        # The currency the per-share value is quoted in, when the endpoint says so.
        #
        # It does not today: `equity_value` is an EquityPriceField, a bare decimal,
        # unlike the CurrencyMoneySerializer the salary figures use. CTC's own
        # formatPerSharePrice defaults to "$" for the same reason. Captured as None
        # rather than assumed to be USD — the console renders plain digits without
        # it, which is honest, where a "$" would be a claim about a currency nobody
        # told us. See CTCPOD-6249.
        "currency": inner.get("currency") or inner.get("currencyCode"),
    }

    out = pathlib.Path(raw_dir)
    out.mkdir(parents=True, exist_ok=True)
    (out / "corporation_info.json").write_text(json.dumps(manifest, indent=2) + "\n")

    bits = []
    if manifest["fullyDilutedShares"]:
        bits.append("{:,.0f} fully diluted".format(manifest["fullyDilutedShares"]))
    if equity_value:
        bits.append("${}/share".format(equity_value))
    if not bits:
        # Not an error: a corporation with no valuation is a real state, and the
        # console drops the units it cannot compute rather than showing zeroes.
        sys.stderr.write(
            "save_corporation_info: no fully diluted count and no equity value — "
            "the planner will offer share counts only.\n"
        )
    print("save_corporation_info: captured %s" % (", ".join(bits) or "no equity units"))
    return manifest


def main():
    if len(sys.argv) != 3:
        sys.exit("usage: save_corporation_info.py <src.json|-> <raw_dir>")
    capture(sys.argv[1], sys.argv[2])


def main_for_test(src, raw_dir):
    """Entry point for tests, mirroring save_report_insights's hook."""
    return capture(src, raw_dir)


if __name__ == "__main__":
    main()
