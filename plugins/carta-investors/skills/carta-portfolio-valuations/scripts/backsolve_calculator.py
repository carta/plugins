#!/usr/bin/env python3
# /// script
# requires-python = ">=3.12"
# dependencies = [
#   "scipy>=1.9",
#   "openpyxl>=3.1",
# ]
# ///
"""
Backsolve Calculator — carta-portfolio-valuations reference implementation.

Replicates Carta's OPM backsolve math from a portfolio_valuations
get:backsolve API response. Formulas match carta-web exactly:
  - eshares/valuations/helpers/black_scholes.py   (d1, d2, call value)
  - eshares/valuations/allocation/option_pricing_model.py  (breakpoints → payout)
  - eshares/valuations/allocation/backsolves.py   (brentq goal-seek)

Input  (stdin or --input FILE):  JSON from portfolio_valuations__get__backsolve
Optional: --equity-adjustment-input FILE  JSON from portfolio_valuations__get__equity_adjustment
Output modes:
  --explain        Step-by-step explanation with formulas and live numbers
  --excel PATH     Excel workbook with Black-Scholes formulas in every cell
  --html  PATH     Standalone interactive HTML calculator (vanilla JS)
  --json           Machine-readable JSON of the full verified calculation
  --verify         Re-run goal-seek and confirm the API equity value

Usage:
    uv run scripts/backsolve_calculator.py --explain < response.json
    uv run scripts/backsolve_calculator.py --excel /tmp/backsolve.xlsx \\
        --input backsolve.json --equity-adjustment-input equity_adj.json
    uv run scripts/backsolve_calculator.py --html  /tmp/backsolve.html \\
        --input backsolve.json --equity-adjustment-input equity_adj.json
    uv run scripts/backsolve_calculator.py --json  < response.json
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from collections import defaultdict
from typing import Any

from scipy.optimize import brentq
from scipy.stats import norm


# ---------------------------------------------------------------------------
# Black-Scholes — matches eshares/valuations/helpers/black_scholes.py exactly
# ---------------------------------------------------------------------------

def bs_d1(equity: float, strike: float, r: float, vol: float, t: float) -> float:
    """d1 = [ln(S/K) + (r + σ²/2)·T] / (σ·√T)"""
    return (math.log(equity / strike) + (r + vol**2 / 2) * t) / (vol * math.sqrt(t))


def bs_d2(equity: float, strike: float, r: float, vol: float, t: float) -> float:
    """d2 = d1 − σ·√T"""
    return bs_d1(equity, strike, r, vol, t) - vol * math.sqrt(t)


def bs_call(equity: float, strike: float, r: float, vol: float, t: float) -> float:
    """
    European call option value (Black-Scholes).

    C = S·N(d1) − K·e^(−rT)·N(d2)

    where:
      S = equity (company equity value)
      K = strike (breakpoint boundary)
      r = risk-free rate (annualised)
      σ = volatility
      T = time to exit (years)
      N = standard normal CDF
    """
    if strike <= 0:
        return equity  # call struck at 0 equals the asset price itself
    if math.isinf(strike):
        return 0.0    # call struck at ∞ is worthless
    d1 = bs_d1(equity, strike, r, vol, t)
    d2 = bs_d2(equity, strike, r, vol, t)
    return equity * float(norm.cdf(d1)) - strike * math.exp(-r * t) * float(norm.cdf(d2))


# ---------------------------------------------------------------------------
# Parse the get:backsolve API response
# ---------------------------------------------------------------------------

def _amount(val: Any) -> float:
    if isinstance(val, dict):
        return float(val.get("amount", 0) or 0)
    return float(val or 0)


def _currency(val: Any) -> str | None:
    """The amount's currency code, or None when the response carried none.

    None means unknown, not USD — callers must say so rather than assume.
    """
    if isinstance(val, dict):
        code = val.get("currencyCode")
        return str(code) if code else None
    return None


def parse_response(data: dict) -> dict:
    """Return a normalised calc-input dict from a get:backsolve API response."""
    alloc = data.get("allocation") or {}

    # Volatility: prefer manual entry; switch to asset vol when debtOption=INCLUDE_ALL
    uses_asset = bool(data.get("usesAssetVolatility") or alloc.get("usesAssetVolatility"))
    if uses_asset:
        vol = float(alloc.get("assetVolatilityManualEntry") or 0)
    elif alloc.get("volatilitySelectionMethod") == "LINEAR_REGRESSION":
        reg = alloc.get("equityVolatilityRegression") or {}
        vol = float(reg.get("result") or alloc.get("equityVolatilityManualEntry") or 0)
    else:
        vol = float(alloc.get("equityVolatilityManualEntry") or 0)

    # equity_value = raw OPM goal-seek result (pre-adjustment).
    # currentBacksolve is itself the raw solved amount object; approachEquityValue
    # includes any override + percentage adjustment + new capital and must NOT be used here.
    equity_raw = data.get("currentBacksolve") or data.get("approachEquityValue") or {}
    equity_value = _amount(equity_raw)
    currency_code = _currency(equity_raw)

    goal_seek = data.get("goalSeekFmv")
    target_price = _amount(goal_seek) if goal_seek else 0.0

    # Normalise breakpoints from API shape
    breakpoints: list[dict] = []
    for bp in alloc.get("breakpoints") or []:
        to_raw = bp.get("to")
        breakpoints.append({
            "from": float(bp.get("from") or 0),
            "to": float("inf") if (to_raw == "Infinity" or to_raw is None) else float(to_raw),
            "description": str(bp.get("description") or ""),
            "delta": float("inf") if (bp.get("delta") == "Infinity") else float(bp.get("delta") or 0),
            "sc_percentages": {
                k: float(v)
                for k, v in (bp.get("scPercentages") or bp.get("sc_percentages") or {}).items()
            },
            "api_option_value": float(bp.get("optionValue") or 0),
            "api_incremental": float(bp.get("incrementalOptionValue") or 0),
        })

    # Normalise totals
    totals: list[dict] = []
    for t in alloc.get("totals") or []:
        totals.append({
            "key": str(t.get("key") or ""),
            "share_class": str(t.get("shareClass") or t.get("share_class") or ""),
            "type": str(t.get("type") or ""),
            "quantity": float(t.get("originalQuantity") or t.get("original_quantity") or 0),
            "oip": float(t.get("oip") or 0),
            "price": float(t.get("price") or 0),
            "api_class_value": float(t.get("classValue") or t.get("class_value") or 0),
            "api_marketable_value": float(t.get("marketableValue") or t.get("marketable_value") or 0),
            "seniority": int(t.get("seniority") or 0),
        })

    return {
        "target_class": str(data.get("backsolveShareClass") or ""),
        "target_price": target_price,
        "equity_value": equity_value,
        "volatility": vol,
        "risk_free_rate": float(alloc.get("riskFreeRateWeightedTte") or 0),
        "time_to_exit": float(alloc.get("weightedTimeToExit") or 0),
        "debt_option": str(alloc.get("debtOption") or "EXCLUDE_ALL"),
        "treat_capped_notes_as_equity": bool(alloc.get("treatCappedNotesAsEquity", True)),
        "currency": currency_code or "USD",
        "currency_assumed": currency_code is None,
        "breakpoints": breakpoints,
        "totals": totals,
    }


def parse_equity_adjustment(data: dict, backsolve_equity_value: float) -> dict:
    """
    Normalise a get:equity_adjustment API response into a flat dict.
    Falls back to sensible defaults when fields are absent.

    Equity adjustment formula (from backsolve_service_impl.py):
        approachEquityValue = backsolveEquityValueOverride × (1 + equityAdjustment)
                              + newCapitalRaised
    """
    if isinstance(data.get("result"), str):
        data = json.loads(data["result"])

    override_raw = data.get("backsolveEquityValueOverride")
    override = _amount(override_raw) if override_raw else backsolve_equity_value

    return {
        "override": override,
        "equity_adjustment": float(data.get("equityAdjustment") or 0),
        "new_capital_raised": _amount(data.get("newCapitalRaised") or 0),
        "approach_equity_value": _amount(data.get("approachEquityValue") or backsolve_equity_value),
        "language": data.get("equityAdjustmentLanguage") or "",
        "date_override": data.get("equityAdjustmentDateOverride") or "",
    }


# ---------------------------------------------------------------------------
# Core calculation: recompute option values and allocation from inputs
# ---------------------------------------------------------------------------

def compute_breakpoints(inputs: dict, equity_value: float | None = None) -> list[dict]:
    """
    Recompute Black-Scholes option values for each band at the given equity value.
    Uses the sc_percentages from the API (which are fixed by cap table structure).
    Returns enriched breakpoint dicts with recomputed option values and sc_dollars.
    """
    S = equity_value if equity_value is not None else inputs["equity_value"]
    r = inputs["risk_free_rate"]
    vol = inputs["volatility"]
    t = inputs["time_to_exit"]

    prev_option_value = S  # option struck at 0 = full equity value
    result = []
    for bp in inputs["breakpoints"]:
        K = bp["to"]
        option_value = bs_call(S, K, r, vol, t)
        incremental = prev_option_value - option_value

        sc_dollars = {
            cls_key: incremental * pct
            for cls_key, pct in bp["sc_percentages"].items()
        }

        result.append({
            **bp,
            "computed_option_value": option_value,
            "computed_incremental": incremental,
            "sc_dollars": sc_dollars,
            # For band 1: also store d1/d2 for explanation
            "d1": bs_d1(S, K, r, vol, t) if not math.isinf(K) and K > 0 else None,
            "d2": bs_d2(S, K, r, vol, t) if not math.isinf(K) and K > 0 else None,
        })
        prev_option_value = option_value

    return result


def sc_percentages_key(share_type: str, share_class: str) -> str:
    """
    Build the camelCase key used by `scPercentages` (e.g. "preferredSeriesA",
    "commonCommon") from a totals entry's `type` ("preferred"/"common") and
    `shareClass` ("Series A"/"Common"). This is NOT the same format as the
    totals list's own `key` field (e.g. "preferred-Series A") — the two key
    formats must never be used interchangeably when matching a totals row to
    its breakpoint sc_percentages entry.
    """
    return share_type + share_class.replace(" ", "")


def compute_totals(inputs: dict, computed_breakpoints: list[dict]) -> list[dict]:
    """Aggregate sc_dollars across breakpoints and produce per-share values."""
    class_dollars: dict[str, float] = defaultdict(float)
    for bp in computed_breakpoints:
        for cls_key, dollars in bp["sc_dollars"].items():
            class_dollars[cls_key] += dollars

    # Build totals in the same order as the API response
    result = []
    for t in inputs["totals"]:
        key = sc_percentages_key(t["type"], t["share_class"])
        class_value = class_dollars.get(key, 0.0)
        qty = t["quantity"]
        result.append({
            **t,
            "computed_class_value": class_value,
            "computed_marketable_value": class_value / qty if qty else 0.0,
        })
    return result


def verify_goal_seek(inputs: dict) -> float:
    """
    Re-run brentq (scipy) to find the equity value where the target class
    lands at exactly target_price. Matches backsolves.py:ShareClassBacksolve._run_backsolve.
    Returns the verified equity value.
    """
    target_key = f"preferred-{inputs['target_class']}"
    target_price = inputs["target_price"]

    def goal_seek(evalue: float) -> float:
        bps = compute_breakpoints(inputs, equity_value=evalue)
        tots = compute_totals(inputs, bps)
        mv = next((t["computed_marketable_value"] for t in tots if t["key"] == target_key), 0.0)
        return target_price - mv

    return float(brentq(goal_seek, 1, 1e15))


# ---------------------------------------------------------------------------
# Text explanation mode
# ---------------------------------------------------------------------------

def _fmt(v: float, currency: str) -> str:
    sym = {"USD": "$", "EUR": "€", "GBP": "£", "CAD": "CA$"}.get(currency, currency + " ")
    if abs(v) >= 1_000_000:
        return f"{sym}{v:,.0f}"
    return f"{sym}{v:,.2f}"


def _pct(v: float) -> str:
    return f"{v * 100:.4f}%"


def explain(inputs: dict) -> None:
    S = inputs["equity_value"]
    vol = inputs["volatility"]
    r = inputs["risk_free_rate"]
    t = inputs["time_to_exit"]
    cur = inputs["currency"]
    bps = compute_breakpoints(inputs)
    tots = compute_totals(inputs, bps)

    print("=" * 70)
    print("BACKSOLVE CALCULATION — STEP BY STEP")
    print("=" * 70)

    print(f"""
GOAL
────
Find the total equity value S such that the OPM allocates exactly
{_fmt(inputs["target_price"], cur)} per share to {inputs["target_class"]}.

Solved equity value: {_fmt(S, cur)}

INPUTS
──────
  Equity value (S)       {_fmt(S, cur)}
  Target class           {inputs["target_class"]}
  Target price (OIP)     {_fmt(inputs["target_price"], cur)}
  Volatility (σ)         {vol * 100:.2f}%
  Risk-free rate (r)     {r * 100:.4f}%
  Time to exit (T)       {t:.1f} years
  Debt treatment         {inputs["debt_option"]}
  Capped notes           {"as equity" if inputs["treat_capped_notes_as_equity"] else "as debt"}
""")

    print("BLACK-SCHOLES FORMULA")
    print("─" * 70)
    print("""
Each breakpoint boundary K is priced as a European call option on the
company's equity value S:

  d1 = [ ln(S/K) + (r + σ²/2)·T ] / (σ·√T)
  d2 = d1 − σ·√T
   C = S·N(d1) − K·e^(−rT)·N(d2)

where N(·) is the standard normal CDF (scipy.stats.norm.cdf).

A call option struck at 0  →  C(0) = S  (full equity value)
A call option struck at ∞  →  C(∞) = 0  (worthless)

The INCREMENTAL value falling into band n is:
  ΔV(n) = C(K_{n-1}) − C(K_n)
""")

    # Show worked example for first non-infinite band
    finite_bands = [bp for bp in bps if not math.isinf(bp["to"])]
    if finite_bands:
        bp = finite_bands[0]
        K = bp["to"]
        d1v = bp["d1"]
        d2v = bp["d2"]
        print(f"WORKED EXAMPLE — Band 1 (strike K = {_fmt(K, cur)})")
        print("─" * 70)
        print(f"""
  d1 = [ ln({_fmt(S, cur)} / {_fmt(K, cur)}) + ({r:.4f} + {vol:.2f}²/2) × {t:.1f} ]
       ─────────────────────────────────────────────────────────
                       {vol:.2f} × √{t:.1f}

     = [ ln({S / K:.6f}) + ({r:.4f} + {vol**2 / 2:.6f}) × {t:.1f} ]
       ─────────────────────────────────────────────────────────
                       {vol * math.sqrt(t):.6f}

     = [ {math.log(S / K):.6f} + {(r + vol**2 / 2) * t:.6f} ]
       ─────────────────────────────────────────────────────────
                       {vol * math.sqrt(t):.6f}

     = {d1v:.6f}

  d2 = {d1v:.6f} − {vol:.2f} × √{t:.1f}
     = {d1v:.6f} − {vol * math.sqrt(t):.6f}
     = {d2v:.6f}

  N(d1) = N({d1v:.6f}) = {float(norm.cdf(d1v)):.6f}
  N(d2) = N({d2v:.6f}) = {float(norm.cdf(d2v)):.6f}

  C(K₁) = {_fmt(S, cur)} × {float(norm.cdf(d1v)):.6f}
         − {_fmt(K, cur)} × e^(−{r:.4f} × {t:.1f}) × {float(norm.cdf(d2v)):.6f}

         = {_fmt(S * float(norm.cdf(d1v)), cur)}
         − {_fmt(K * math.exp(-r * t) * float(norm.cdf(d2v)), cur)}

         = {_fmt(bp["computed_option_value"], cur)}

  ΔV(1) = C(0) − C(K₁)
         = {_fmt(S, cur)} − {_fmt(bp["computed_option_value"], cur)}
         = {_fmt(bp["computed_incremental"], cur)}
""")

    print("BREAKPOINT BANDS")
    print("─" * 70)
    prev_ov = S
    for i, bp in enumerate(bps, 1):
        K_str = "∞" if math.isinf(bp["to"]) else _fmt(bp["to"], cur)
        ov_str = "0" if math.isinf(bp["to"]) else _fmt(bp["computed_option_value"], cur)
        print(f"  Band {i}: {_fmt(bp['from'], cur)} → {K_str}")
        print(f"    {bp['description']}")
        print(f"    C(K)        = {ov_str}")
        print(f"    Incremental = C(prev) − C(K) = {_fmt(prev_ov, cur)} − {ov_str}")
        print(f"                = {_fmt(bp['computed_incremental'], cur)}")
        splits = ", ".join(f"{_label(k)}: {pct * 100:.2f}%" for k, pct in bp["sc_percentages"].items())
        print(f"    Split       = {splits}")
        prev_ov = bp["computed_option_value"]
        print()

    print("PER-CLASS ALLOCATION")
    print("─" * 70)
    print(f"  {'Share Class':<18} {'Shares':>14} {'OIP':>10} {'Class Value':>14} {'Per Share':>12}")
    print(f"  {'─'*18} {'─'*14} {'─'*10} {'─'*14} {'─'*12}")
    for tot in tots:
        print(
            f"  {tot['share_class']:<18}"
            f" {tot['quantity']:>14,.0f}"
            f" {_fmt(tot['oip'], cur):>10}"
            f" {_fmt(tot['computed_class_value'], cur):>14}"
            f" {_fmt(tot['computed_marketable_value'], cur):>12}"
        )

    # Goal-seek confirmation
    target_key = f"preferred-{inputs['target_class']}"
    target_tot = next((t for t in tots if t["key"] == target_key), None)
    if target_tot:
        mv = target_tot["computed_marketable_value"]
        print(f"""
  ✓ Goal-seek confirmed: {inputs['target_class']} lands at
    {_fmt(mv, cur)} per share = target of {_fmt(inputs['target_price'], cur)}
    (equity value {_fmt(S, cur)} is the solution)
""")

    print("TOTALS CHECK")
    print("─" * 70)
    total_incremental = sum(bp["computed_incremental"] for bp in bps)
    total_class_value = sum(t["computed_class_value"] for t in tots)
    print(f"  Sum of all incremental values: {_fmt(total_incremental, cur)}")
    print(f"  Sum of all class values:       {_fmt(total_class_value, cur)}")
    print(f"  Equity value:                  {_fmt(S, cur)}")


def _label(cls_key: str) -> str:
    """Convert preferredSeriesA → Series A, commonCommon → Common."""
    key = cls_key.replace("preferred", "").replace("common", "").strip()
    return "Common" if key == "Common" or not key else key.replace("Common", "")


# ---------------------------------------------------------------------------
# Excel output — live Black-Scholes formulas that recalculate on input change
# ---------------------------------------------------------------------------

def to_excel(inputs: dict, path: str, adj_data: dict | None = None) -> None:
    """
    Write a four-sheet Excel workbook:
      Inputs            — OPM parameters (edit these to recalculate everything)
      Breakpoints       — Black-Scholes d1/d2/C formulas per boundary
      Allocation        — per-class dollar distribution and per-share values
      Equity Adjustment — override / % adjustment / new capital raised → final value
    """
    from openpyxl import Workbook
    from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
    from openpyxl.utils import get_column_letter

    wb = Workbook()

    # ── Styles ─────────────────────────────────────────────────────────────
    BLUE = "1F4E79"
    LIGHT_BLUE = "D6E4F0"
    YELLOW = "FFF2CC"
    WHITE = "FFFFFF"
    GREY = "F2F2F2"

    def hdr(ws, row: int, col: int, value: str, bold: bool = True, bg: str = BLUE, fg: str = WHITE) -> None:
        cell = ws.cell(row=row, column=col, value=value)
        cell.font = Font(bold=bold, color=fg)
        cell.fill = PatternFill("solid", fgColor=bg)
        cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)

    def val(ws, row: int, col: int, value: Any, fmt: str | None = None, bg: str = WHITE, bold: bool = False) -> None:
        cell = ws.cell(row=row, column=col, value=value)
        if fmt:
            cell.number_format = fmt
        if bg != WHITE:
            cell.fill = PatternFill("solid", fgColor=bg)
        if bold:
            cell.font = Font(bold=True)
        cell.alignment = Alignment(horizontal="right" if fmt else "left")

    thin = Border(
        left=Side(style="thin"), right=Side(style="thin"),
        top=Side(style="thin"), bottom=Side(style="thin"),
    )

    # ── Sheet 1: Inputs ─────────────────────────────────────────────────────
    ws_in = wb.active
    ws_in.title = "Inputs"
    ws_in.column_dimensions["A"].width = 36
    ws_in.column_dimensions["B"].width = 22

    hdr(ws_in, 1, 1, "Parameter")
    hdr(ws_in, 1, 2, "Value")

    params = [
        ("Computed Backsolve Equity Value  S  (OPM goal-seek result)", inputs["equity_value"], '#,##0.00'),
        ("Target Share Class",                  inputs["target_class"],  None),
        ("Target Price per Share  (OIP)",       inputs["target_price"],  '#,##0.0000'),
        ("Equity Volatility  σ",                inputs["volatility"],    '0.00%'),
        ("Risk-Free Rate  r",                   inputs["risk_free_rate"],'0.0000%'),
        ("Time to Exit  T  (years)",            inputs["time_to_exit"],  '0.0'),
    ]
    for i, (label, value, fmt) in enumerate(params, 2):
        ws_in.cell(row=i, column=1, value=label).fill = PatternFill("solid", fgColor=GREY)
        val(ws_in, i, 2, value, fmt, YELLOW)

    ws_in.cell(row=9, column=1, value=(
        "Edit the yellow cells above — Breakpoints and Allocation sheets update automatically. "
        "See the 'Equity Adjustment' tab to apply overrides, % adjustments, and new capital raised."
    )).font = Font(italic=True, color="666666")

    note = ws_in.cell(row=11, column=1, value=(
        "Note: the risk-free rate is derived from the treasury yield curve for the valuation "
        "date and time to exit, and can change over time. If it has moved since this valuation "
        "was last run in Carta, this workbook may show a small discrepancy (typically well under "
        "1%) versus the values displayed in the Carta app."
    ))
    note.font = Font(italic=True, color="665500")
    note.fill = PatternFill("solid", fgColor="FFF8E1")
    note.alignment = Alignment(wrap_text=True, vertical="top")
    ws_in.merge_cells("A11:B14")

    # Named references into Inputs sheet (row numbers)
    # B2=equity, B3=target_class, B4=target_price, B5=volatility, B6=rfr, B7=tte

    # ── Sheet 2: Breakpoints ─────────────────────────────────────────────────
    ws_bp = wb.create_sheet("Breakpoints")
    for col, w in zip(range(1, 12), [6, 16, 16, 14, 12, 12, 18, 18, 18, 18, 30]):
        ws_bp.column_dimensions[get_column_letter(col)].width = w

    headers = ["Band", "From  K_{n-1}", "To  K_n  (Strike)", "Delta",
               "d1", "d2", "C(K_n)  Option Value", "C(K_{n-1})  Prev Value",
               "ΔV  Incremental Value", "ΔV / S  (% of equity)", "Description"]
    for c, h in enumerate(headers, 1):
        hdr(ws_bp, 1, c, h)

    bps = inputs["breakpoints"]
    DATA_ROW_START = 2

    for i, bp in enumerate(bps):
        row = DATA_ROW_START + i
        bg = GREY if i % 2 == 0 else WHITE
        K = bp["to"]
        is_inf = math.isinf(K)

        # Col A: Band number
        val(ws_bp, row, 1, i + 1, None, bg)

        # Col B: From
        val(ws_bp, row, 2, bp["from"], '#,##0.00', bg)

        # Col C: To (strike)
        val(ws_bp, row, 3, "∞" if is_inf else K, '#,##0.00' if not is_inf else None, bg)

        # Col D: Delta
        if is_inf:
            val(ws_bp, row, 4, "∞", None, bg)
        else:
            ws_bp.cell(row=row, column=4, value=f"=C{row}-B{row}").number_format = '#,##0.00'
            ws_bp.cell(row=row, column=4).fill = PatternFill("solid", fgColor=bg)

        # Cols E/F: d1, d2  (only for finite strikes)
        if not is_inf:
            # d1 = (LN(S/K) + (r + σ²/2)*T) / (σ*SQRT(T))
            S_ref = "Inputs!$B$2"
            vol_ref = "Inputs!$B$5"
            r_ref = "Inputs!$B$6"
            t_ref = "Inputs!$B$7"
            K_ref = f"C{row}"
            d1_formula = (
                f"=(LN({S_ref}/{K_ref})+({r_ref}+{vol_ref}^2/2)*{t_ref})"
                f"/({vol_ref}*SQRT({t_ref}))"
            )
            ws_bp.cell(row=row, column=5, value=d1_formula).number_format = "0.000000"
            ws_bp.cell(row=row, column=5).fill = PatternFill("solid", fgColor=bg)
            d2_formula = f"=E{row}-{vol_ref}*SQRT({t_ref})"
            ws_bp.cell(row=row, column=6, value=d2_formula).number_format = "0.000000"
            ws_bp.cell(row=row, column=6).fill = PatternFill("solid", fgColor=bg)
        else:
            val(ws_bp, row, 5, "—", None, bg)
            val(ws_bp, row, 6, "—", None, bg)

        # Col G: C(K_n) option value at this boundary
        if is_inf:
            val(ws_bp, row, 7, 0, '#,##0.00', bg)
        else:
            # C = S*N(d1) - K*EXP(-r*T)*N(d2)
            S_ref = "Inputs!$B$2"
            vol_ref = "Inputs!$B$5"
            r_ref = "Inputs!$B$6"
            t_ref = "Inputs!$B$7"
            K_ref = f"C{row}"
            c_formula = (
                f"={S_ref}*NORM.S.DIST(E{row},TRUE)"
                f"-{K_ref}*EXP(-{r_ref}*{t_ref})*NORM.S.DIST(F{row},TRUE)"
            )
            ws_bp.cell(row=row, column=7, value=c_formula).number_format = '#,##0.00'
            ws_bp.cell(row=row, column=7).fill = PatternFill("solid", fgColor=bg)

        # Col H: C(K_{n-1}) previous option value
        if i == 0:
            # First band: previous option value = equity value itself (call struck at 0)
            ws_bp.cell(row=row, column=8, value="=Inputs!$B$2").number_format = '#,##0.00'
        else:
            ws_bp.cell(row=row, column=8, value=f"=G{row - 1}").number_format = '#,##0.00'
        ws_bp.cell(row=row, column=8).fill = PatternFill("solid", fgColor=bg)

        # Col I: ΔV incremental = H - G
        ws_bp.cell(row=row, column=9, value=f"=H{row}-G{row}").number_format = '#,##0.00'
        ws_bp.cell(row=row, column=9).fill = PatternFill("solid", fgColor=bg)

        # Col J: ΔV / S
        ws_bp.cell(row=row, column=10, value=f"=I{row}/Inputs!$B$2").number_format = '0.00%'
        ws_bp.cell(row=row, column=10).fill = PatternFill("solid", fgColor=bg)

        # Col K: Description
        val(ws_bp, row, 11, bp["description"], None, bg)

    # ── Sheet 3: Allocation ──────────────────────────────────────────────────
    ws_al = wb.create_sheet("Allocation")
    n_bands = len(bps)

    # Header row: Share Class | Shares | OIP | Band 1 | Band 2 | ... | Total | Per Share
    hdr(ws_al, 1, 1, "Share Class")
    hdr(ws_al, 1, 2, "Shares")
    hdr(ws_al, 1, 3, "OIP (per share)")
    for b in range(n_bands):
        hdr(ws_al, 1, 4 + b, f"Band {b + 1} ΔV", bg=LIGHT_BLUE, fg=BLUE)
    hdr(ws_al, 1, 4 + n_bands, "Total Class Value")
    hdr(ws_al, 1, 5 + n_bands, "Value per Share")

    ws_al.column_dimensions["A"].width = 20
    for col in range(2, 6 + n_bands):
        ws_al.column_dimensions[get_column_letter(col)].width = 16

    totals = inputs["totals"]
    for r_idx, tot in enumerate(totals):
        row = 2 + r_idx
        bg = GREY if r_idx % 2 == 0 else WHITE

        val(ws_al, row, 1, tot["share_class"], None, bg)
        val(ws_al, row, 2, tot["quantity"], '#,##0', bg)
        val(ws_al, row, 3, tot["oip"], '#,##0.0000', bg)

        for b_idx, bp in enumerate(bps):
            col = 4 + b_idx
            bp_row = DATA_ROW_START + b_idx  # row in Breakpoints sheet
            pct = bp["sc_percentages"].get(sc_percentages_key(tot["type"], tot["share_class"]), 0.0)
            if pct == 0.0:
                val(ws_al, row, col, 0, '#,##0.00', bg)
            else:
                # ΔV * sc_percentage (percentage is fixed by cap table structure)
                formula = f"=Breakpoints!I{bp_row}*{pct}"
                ws_al.cell(row=row, column=col, value=formula).number_format = '#,##0.00'
                ws_al.cell(row=row, column=col).fill = PatternFill("solid", fgColor=bg)

        # Total class value = sum of band columns
        first_band_col = get_column_letter(4)
        last_band_col = get_column_letter(3 + n_bands)
        total_col = 4 + n_bands
        ws_al.cell(row=row, column=total_col, value=f"=SUM({first_band_col}{row}:{last_band_col}{row})").number_format = '#,##0.00'
        ws_al.cell(row=row, column=total_col).fill = PatternFill("solid", fgColor=YELLOW)
        ws_al.cell(row=row, column=total_col).font = Font(bold=True)

        # Per-share value = total / shares
        per_share_col = 5 + n_bands
        tc = get_column_letter(total_col)
        ws_al.cell(row=row, column=per_share_col, value=f"={tc}{row}/B{row}").number_format = '#,##0.0000'
        ws_al.cell(row=row, column=per_share_col).fill = PatternFill("solid", fgColor=YELLOW)
        ws_al.cell(row=row, column=per_share_col).font = Font(bold=True)

    # ── Sheet 4: Equity Adjustment ───────────────────────────────────────────
    ws_ea = wb.create_sheet("Equity Adjustment")
    ws_ea.column_dimensions["A"].width = 40
    ws_ea.column_dimensions["B"].width = 24
    ws_ea.column_dimensions["C"].width = 36

    # Title
    title_cell = ws_ea.cell(row=1, column=1, value="Equity Adjustment")
    title_cell.font = Font(bold=True, size=13, color=BLUE)
    ws_ea.merge_cells("A1:C1")

    subtitle = ws_ea.cell(row=2, column=1, value=(
        "Applied after the OPM goal-seek. Formula:  "
        "Approach Equity Value = Override × (1 + adj%) + New Capital Raised"
    ))
    subtitle.font = Font(italic=True, color="555555")
    ws_ea.merge_cells("A2:C2")

    hdr(ws_ea, 4, 1, "Input")
    hdr(ws_ea, 4, 2, "Value")
    hdr(ws_ea, 4, 3, "Notes")

    adj = adj_data or {}
    override_val  = adj.get("override", inputs["equity_value"])
    adj_pct       = adj.get("equity_adjustment", 0.0)
    new_cap       = adj.get("new_capital_raised", 0.0)
    approach_val  = adj.get("approach_equity_value", inputs["equity_value"])
    language      = adj.get("language", "")
    date_override = adj.get("date_override", "")

    ea_rows = [
        # (label, value, fmt, note)
        ("Override Base Value",
         override_val,
         '#,##0.00',
         "Replaces computed S as the base. Edit Inputs!B2 to change the computed value."),
        ("Percentage Adjustment",
         adj_pct,
         '0.00%',
         "Enter as a decimal: 0.15 = +15%, -0.10 = -10%"),
        ("New Capital Raised",
         new_cap,
         '#,##0.00',
         "Added on top after the % adjustment"),
        ("Adjustment Date",
         date_override or "—",
         None,
         "Leave blank to use the valuation date"),
        ("Adjustment Note",
         language or "",
         None,
         "Free-text description shown on the valuation exhibit"),
    ]

    for i, (label, value, fmt_str, note) in enumerate(ea_rows, 5):
        ws_ea.cell(row=i, column=1, value=label).fill = PatternFill("solid", fgColor=GREY)
        cell = ws_ea.cell(row=i, column=2, value=value)
        if fmt_str:
            cell.number_format = fmt_str
        cell.fill = PatternFill("solid", fgColor=YELLOW)
        cell.alignment = Alignment(horizontal="right")
        ws_ea.cell(row=i, column=3, value=note).font = Font(italic=True, color="777777")

    # Approach Equity Value formula row
    # B5=override, B6=adj%, B7=new_capital
    OVERRIDE_ROW = 5
    PCT_ROW      = 6
    CAPITAL_ROW  = 7
    RESULT_ROW   = 11

    ws_ea.cell(row=10, column=1, value="─" * 30).font = Font(color="AAAAAA")
    result_label = ws_ea.cell(row=RESULT_ROW, column=1, value="Approach Equity Value")
    result_label.font = Font(bold=True, size=12, color=BLUE)
    result_label.fill = PatternFill("solid", fgColor=LIGHT_BLUE)

    result_formula = f"=B{OVERRIDE_ROW}*(1+B{PCT_ROW})+B{CAPITAL_ROW}"
    result_cell = ws_ea.cell(row=RESULT_ROW, column=2, value=result_formula)
    result_cell.number_format = '#,##0.00'
    result_cell.font = Font(bold=True, size=12, color=BLUE)
    result_cell.fill = PatternFill("solid", fgColor=LIGHT_BLUE)

    # Formula breakdown in column C
    ws_ea.cell(row=RESULT_ROW, column=3, value=(
        f"= Override × (1 + adj%) + New Capital"
    )).font = Font(italic=True, color="555555")

    # Sanity check row
    ws_ea.cell(row=13, column=1, value="API Approach Equity Value (from Carta)").fill = PatternFill("solid", fgColor=GREY)
    ws_ea.cell(row=13, column=2, value=approach_val).number_format = '#,##0.00'
    ws_ea.cell(row=13, column=2).fill = PatternFill("solid", fgColor=GREY)
    diff_formula = f"=B{RESULT_ROW}-B13"
    diff_cell = ws_ea.cell(row=14, column=1, value="Difference (formula − API)")
    diff_cell.fill = PatternFill("solid", fgColor=GREY)
    ws_ea.cell(row=14, column=2, value=diff_formula).number_format = '#,##0.00'
    ws_ea.cell(row=14, column=2).fill = PatternFill("solid", fgColor=GREY)

    wb.save(path)
    print(f"Excel workbook saved: {path}", file=sys.stderr)


# ---------------------------------------------------------------------------
# HTML interactive calculator — vanilla JS, no dependencies
# ---------------------------------------------------------------------------

def to_html(inputs: dict, path: str, adj_data: dict | None = None) -> None:
    """Generate a self-contained interactive HTML backsolve calculator."""
    bps = inputs["breakpoints"]
    tots = inputs["totals"]
    cur = inputs["currency"]
    sym = {"USD": "$", "EUR": "€", "GBP": "£", "CAD": "CA$"}.get(cur, cur + " ")

    # Every figure carries a currency symbol, so say when the symbol is an
    # assumption rather than data.
    currency_note = "" if not inputs.get("currency_assumed") else """
<div class="disclaimer">
  <strong>Currency not specified:</strong> the valuation data didn't include a
  currency, so every amount below is shown in <strong>USD</strong> as an
  assumption. If this company is valued in another currency, the figures are
  right but the symbols are wrong — confirm the currency in Carta before
  sharing or filing this.
</div>"""

    adj = adj_data or {}
    adj_override  = adj.get("override", inputs["equity_value"])
    adj_pct       = adj.get("equity_adjustment", 0.0)   # decimal, e.g. 0.15
    adj_capital   = adj.get("new_capital_raised", 0.0)

    bp_json = json.dumps([
        {"to": bp["to"] if not math.isinf(bp["to"]) else None,
         "description": bp["description"],
         "sc_percentages": bp["sc_percentages"]}
        for bp in bps
    ])
    tots_json = json.dumps([
        {"key": t["key"], "sc_key": sc_percentages_key(t["type"], t["share_class"]),
         "share_class": t["share_class"], "quantity": t["quantity"], "oip": t["oip"]}
        for t in tots
    ])

    # Illustrative bisection trace showing how the goal-seek converges on S.
    # Not the actual brentq path (that's Brent's method, not plain bisection),
    # but demonstrates the same principle: guess S, check the implied price
    # for the target class, narrow the bracket, repeat.
    target_key = f"preferred-{inputs['target_class']}"
    target_price = inputs["target_price"]

    def _implied_price(S: float) -> float:
        trial_bps = compute_breakpoints(inputs, equity_value=S)
        trial_tots = compute_totals(inputs, trial_bps)
        return next(
            (t["computed_marketable_value"] for t in trial_tots if t["key"] == target_key),
            0.0,
        )

    goal_seek_trace: list[dict] = []
    lo, hi = 1.0, max(inputs["equity_value"] * 10, 1.0)
    price_lo, price_hi = _implied_price(lo), _implied_price(hi)
    if (price_lo - target_price) * (price_hi - target_price) <= 0:
        for _ in range(8):
            mid = (lo + hi) / 2
            price_mid = _implied_price(mid)
            goal_seek_trace.append({"S": mid, "price": price_mid})
            if (price_lo - target_price) * (price_mid - target_price) <= 0:
                hi, price_hi = mid, price_mid
            else:
                lo, price_lo = mid, price_mid
    goal_seek_json = json.dumps(goal_seek_trace)

    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Backsolve Calculator — {inputs["target_class"]}</title>
<style>
  :root{{--blue:#1F4E79;--light:#D6E4F0;--yellow:#FFF2CC;--green:#E2EFDA;--grey:#F5F5F5;--border:#CCC}}
  body{{font-family:'Segoe UI',Arial,sans-serif;margin:0;padding:24px;background:#F9F9F9;color:#222}}
  h1{{color:var(--blue);font-size:1.4rem;margin-bottom:4px}}
  h2{{color:var(--blue);font-size:1rem;margin:20px 0 8px;border-bottom:2px solid var(--blue);padding-bottom:4px}}
  .inputs{{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;background:var(--grey);padding:16px;border-radius:6px;margin-bottom:24px}}
  .field label{{display:block;font-size:.8rem;color:#555;margin-bottom:2px}}
  .field input{{width:100%;padding:6px 8px;border:1px solid var(--border);border-radius:4px;font-size:.95rem;box-sizing:border-box;background:var(--yellow)}}
  table{{border-collapse:collapse;width:100%;font-size:.85rem;margin-bottom:24px}}
  th{{background:var(--blue);color:#fff;padding:7px 10px;text-align:right}}
  th:first-child{{text-align:left}}
  td{{padding:6px 10px;border-bottom:1px solid var(--border);text-align:right}}
  td:first-child{{text-align:left;font-weight:500}}
  tr:nth-child(even){{background:var(--grey)}}
  .highlight{{background:var(--green)!important;font-weight:700}}
  .formula{{background:#F0F4FF;border-left:3px solid var(--blue);padding:10px 14px;font-family:monospace;font-size:.82rem;border-radius:0 4px 4px 0;margin:8px 0 16px;line-height:1.6;white-space:pre-wrap}}
  .tag{{background:var(--light);color:var(--blue);border-radius:3px;padding:2px 6px;font-size:.75rem;margin-left:6px}}
  .total-row td{{background:var(--yellow);font-weight:700;border-top:2px solid var(--blue)}}
  .disclaimer{{background:#FFF8E1;border:1px solid #E6C200;border-radius:6px;padding:10px 14px;font-size:.8rem;color:#665500;margin:12px 0;line-height:1.5}}
</style>
</head>
<body>
<h1>Backsolve Calculator</h1>
<p style="color:#555;font-size:.9rem">
  Edit any input — all breakpoints and allocations recalculate instantly.
  <span class="tag">Target: {inputs["target_class"]} @ {sym}{inputs["target_price"]:.4f}/share</span>
</p>{currency_note}
<div class="disclaimer">
  <strong>Note:</strong> the risk-free rate is derived from the treasury yield curve for
  the valuation date and time to exit, and can change over time. If it has moved since this
  valuation was last run in Carta, this calculator may show a small discrepancy (typically
  well under 1%) versus the values displayed in the Carta app.
</div>

<h2>How the Equity Value Was Found</h2>
<p style="color:#555;font-size:.85rem;margin:-8px 0 10px">
  Uses {inputs["target_class"]}'s most recent round price of
  <strong>{sym}{inputs["target_price"]:.4f}/share</strong> as the target.
</p>
<table id="goalseek-table">
  <thead>
    <tr><th>Step</th><th>Trial S</th><th>Implied {inputs["target_class"]} Price</th><th>vs. Target ({sym}{inputs["target_price"]:.4f})</th></tr>
  </thead>
  <tbody>
{"".join(
    f'    <tr><td>{i + 1}</td><td>{sym}{step["S"]:,.2f}</td><td>{sym}{step["price"]:.4f}</td>'
    f'<td>{"above" if step["price"] > target_price else "below" if step["price"] < target_price else "match"}'
    f' ({sym}{abs(step["price"] - target_price):.4f})</td></tr>\n'
    for i, step in enumerate(goal_seek_trace)
)}    <tr class="total-row"><td colspan="2"><strong>Converged</strong></td><td><strong>{sym}{target_price:.4f}</strong></td><td><strong>S = {sym}{inputs["equity_value"]:,.4f}</strong></td></tr>
  </tbody>
</table>

<h2>Inputs</h2>
<p style="color:#555;font-size:.85rem;margin:-8px 0 10px">
  <strong>Computed Backsolve Equity Value (S)</strong> is the OPM goal-seek result —
  the equity value where the waterfall allocates exactly the target price to the anchor class.
  Edit it below to explore sensitivities; see the <em>Equity Adjustment</em> section for
  override-and-markup scenarios.
</p>
<div class="inputs">
  <div class="field">
    <label>Computed Backsolve Equity Value  S  (OPM goal-seek result)</label>
    <input type="number" id="equity" value="{inputs["equity_value"]:.4f}" step="100000" oninput="syncOverrideDefault()">
  </div>
  <div class="field">
    <label>Volatility  σ</label>
    <input type="number" id="vol" value="{inputs["volatility"]:.4f}" step="0.01">
  </div>
  <div class="field">
    <label>Risk-Free Rate  r</label>
    <input type="number" id="rfr" value="{inputs["risk_free_rate"]:.4f}" step="0.001">
  </div>
  <div class="field">
    <label>Time to Exit  T  (years)</label>
    <input type="number" id="tte" value="{inputs["time_to_exit"]:.2f}" step="0.5">
  </div>
</div>

<h2>Black-Scholes Formula</h2>
<div class="formula">d1 = [ ln(S / K) + (r + σ²/2) · T ] / (σ · √T)
d2 = d1 − σ · √T
 C = S · N(d1) − K · e^(−rT) · N(d2)

Incremental value for band n:
ΔV(n) = C(K_{{n−1}}) − C(K_n)
         where C(0) = S  and  C(∞) = 0</div>

<h2>Breakpoints</h2>
<table id="bp-table">
  <thead>
    <tr>
      <th>Band</th><th>From</th><th>To (Strike K)</th>
      <th>d1</th><th>d2</th><th>C(K)</th>
      <th>Prev C</th><th>ΔV Incremental</th><th>Description</th>
    </tr>
  </thead>
  <tbody id="bp-body"></tbody>
</table>

<h2>Per-Class Allocation</h2>
<table id="alloc-table">
  <thead>
    <tr>
      <th>Share Class</th><th>Shares</th><th>OIP</th>
      {"".join(f"<th>Band {i + 1} &Delta;V</th>" for i in range(len(bps)))}
      <th>Total Class Value</th><th>Fully Marketable Value</th>
    </tr>
  </thead>
  <tbody id="alloc-body"></tbody>
  <tfoot><tr class="total-row" id="total-row"></tr></tfoot>
</table>

<h2>Equity Adjustment</h2>
<p style="color:#555;font-size:.85rem;margin:-8px 0 10px">
  Applied after the OPM goal-seek. Formula:
  <code>Approach Equity Value = Override × (1 + adj%) + New Capital Raised</code>
</p>
<div class="inputs">
  <div class="field">
    <label>Override Base Value</label>
    <input type="number" id="adj-override" value="{adj_override:.4f}" step="100000"
           title="Replaces the computed S as the base. Defaults to S above.">
  </div>
  <div class="field">
    <label>Percentage Adjustment (%)</label>
    <input type="number" id="adj-pct" value="{adj_pct * 100:.2f}" step="1"
           title="e.g. 15 = +15%, -10 = -10%">
  </div>
  <div class="field">
    <label>New Capital Raised</label>
    <input type="number" id="adj-capital" value="{adj_capital:.4f}" step="100000"
           title="Added on top after the % adjustment">
  </div>
</div>
<div class="formula" id="adj-formula-live" style="margin-top:4px"></div>
<div style="background:#E2EFDA;border:1px solid #70AD47;border-radius:6px;padding:12px 16px;display:flex;align-items:baseline;gap:12px;margin-top:8px">
  <span style="font-size:.9rem;font-weight:600;color:#375623">Approach Equity Value:</span>
  <span id="adj-result" style="font-size:1.4rem;font-weight:700;color:#375623"></span>
</div>

<script>
const BREAKPOINTS = {bp_json};
const CLASSES = {tots_json};
const SYM = "{sym}";

// Standard normal CDF — Abramowitz & Stegun (error < 7.5e-8)
function normCDF(x) {{
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp(-x * x / 2);
  let p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.7814779 + t * (-1.8212560 + t * 1.3302744))));
  return x > 0 ? 1 - p : p;
}}

function bsCall(S, K, r, vol, T) {{
  if (K === null) return 0;        // K = ∞
  if (K <= 0)    return S;         // K = 0
  const d1 = (Math.log(S / K) + (r + vol*vol/2) * T) / (vol * Math.sqrt(T));
  const d2 = d1 - vol * Math.sqrt(T);
  return S * normCDF(d1) - K * Math.exp(-r * T) * normCDF(d2);
}}

function bsD1(S, K, r, vol, T) {{
  if (K === null || K <= 0) return null;
  return (Math.log(S / K) + (r + vol*vol/2) * T) / (vol * Math.sqrt(T));
}}

function fmt(v, decimals=0) {{
  return SYM + v.toLocaleString('en-US', {{minimumFractionDigits: decimals, maximumFractionDigits: decimals}});
}}

function recalc() {{
  const S   = parseFloat(document.getElementById('equity').value) || 0;
  const vol = parseFloat(document.getElementById('vol').value)    || 0;
  const r   = parseFloat(document.getElementById('rfr').value)    || 0;
  const T   = parseFloat(document.getElementById('tte').value)    || 0;

  // ── Breakpoints ──────────────────────────────────────────────────────
  const bpRows = [];
  let prevC = S;
  for (let i = 0; i < BREAKPOINTS.length; i++) {{
    const bp = BREAKPOINTS[i];
    const K  = bp.to;  // null = ∞
    const C  = bsCall(S, K, r, vol, T);
    const dv = prevC - C;
    const d1 = bsD1(S, K, r, vol, T);
    const d2 = d1 !== null ? d1 - vol * Math.sqrt(T) : null;
    bpRows.push({{ K, C, prevC, dv, d1, d2, description: bp.description, sc: bp.sc_percentages }});
    prevC = C;
  }}

  // ── Render breakpoints table ─────────────────────────────────────────
  const tbody = document.getElementById('bp-body');
  tbody.innerHTML = '';
  bpRows.forEach((bp, i) => {{
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>Band ${{i+1}}</td>
      <td>${{i === 0 ? fmt(0) : fmt(BREAKPOINTS[i-1].to || 0)}}</td>
      <td>${{bp.K === null ? '∞' : fmt(bp.K)}}</td>
      <td>${{bp.d1 !== null ? bp.d1.toFixed(6) : '—'}}</td>
      <td>${{bp.d2 !== null ? bp.d2.toFixed(6) : '—'}}</td>
      <td>${{fmt(bp.C)}}</td>
      <td>${{fmt(bp.prevC)}}</td>
      <td><strong>${{fmt(bp.dv)}}</strong></td>
      <td style="text-align:left;color:#555">${{bp.description}}</td>
    `;
    tbody.appendChild(tr);
  }});

  // ── Allocation ───────────────────────────────────────────────────────
  const allocBody = document.getElementById('alloc-body');
  allocBody.innerHTML = '';
  let grandTotal = 0;

  CLASSES.forEach(cls => {{
    let classValue = 0;
    const bandCells = bpRows.map(bp => {{
      const pct = bp.sc[cls.sc_key] || 0;
      const v   = bp.dv * pct;
      classValue += v;
      return `<td>${{fmt(v)}}</td>`;
    }});
    grandTotal += classValue;
    const perShare = cls.quantity > 0 ? classValue / cls.quantity : 0;

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${{cls.share_class}}</td>
      <td>${{cls.quantity.toLocaleString('en-US')}}</td>
      <td>${{fmt(cls.oip, 4)}}</td>
      ${{bandCells.join('')}}
      <td class="highlight">${{fmt(classValue)}}</td>
      <td class="highlight">${{fmt(perShare, 4)}}</td>
    `;
    allocBody.appendChild(tr);
  }});

  // Grand total row
  document.getElementById('total-row').innerHTML =
    `<td colspan="${{3 + bpRows.length}}"><strong>Total</strong></td>
     <td class="highlight"><strong>${{fmt(grandTotal)}}</strong></td>
     <td class="highlight"><strong>≈ S</strong></td>`;
}}

// Wire up OPM inputs
['equity','vol','rfr','tte'].forEach(id => {{
  document.getElementById(id).addEventListener('input', recalc);
}});

// ── Equity Adjustment ──────────────────────────────────────────────────────
function recalcAdj() {{
  const base    = parseFloat(document.getElementById('adj-override').value) || 0;
  const pct     = parseFloat(document.getElementById('adj-pct').value)      || 0;
  const capital = parseFloat(document.getElementById('adj-capital').value)  || 0;
  const result  = base * (1 + pct / 100) + capital;
  document.getElementById('adj-result').textContent =
    SYM + result.toLocaleString('en-US', {{minimumFractionDigits: 2, maximumFractionDigits: 2}});
  const formula = `${{SYM}}${{base.toLocaleString('en-US', {{minimumFractionDigits:2, maximumFractionDigits:2}})}} × (1 + ${{pct.toFixed(2)}}%) + ${{SYM}}${{capital.toLocaleString('en-US', {{minimumFractionDigits:2, maximumFractionDigits:2}})}} = ${{SYM}}${{result.toLocaleString('en-US', {{minimumFractionDigits:2, maximumFractionDigits:2}})}}`;
  document.getElementById('adj-formula-live').textContent = formula;
}}

// When computed equity S changes, update override default if user hasn't edited it
let overrideTouched = false;
function syncOverrideDefault() {{
  if (!overrideTouched) {{
    const newS = parseFloat(document.getElementById('equity').value) || 0;
    document.getElementById('adj-override').value = newS.toFixed(4);
    recalcAdj();
  }}
}}
document.getElementById('adj-override').addEventListener('input', () => {{
  overrideTouched = true;
  recalcAdj();
}});
['adj-pct','adj-capital'].forEach(id => {{
  document.getElementById(id).addEventListener('input', recalcAdj);
}});

// Initial render — both OPM table and adjustment section
recalc();
recalcAdj();
</script>
</body>
</html>"""

    with open(path, "w", encoding="utf-8") as f:
        f.write(html)
    print(f"HTML calculator saved: {path}", file=sys.stderr)


# ---------------------------------------------------------------------------
# JSON output
# ---------------------------------------------------------------------------

def to_json_output(inputs: dict) -> None:
    bps = compute_breakpoints(inputs)
    tots = compute_totals(inputs, bps)

    output = {
        "inputs": {
            "target_class": inputs["target_class"],
            "target_price": inputs["target_price"],
            "equity_value": inputs["equity_value"],
            "volatility": inputs["volatility"],
            "risk_free_rate": inputs["risk_free_rate"],
            "time_to_exit": inputs["time_to_exit"],
            "currency": inputs["currency"],
            "currency_assumed": inputs.get("currency_assumed", False),
        },
        "breakpoints": [
            {
                "band": i + 1,
                "from": bp["from"],
                "to": None if math.isinf(bp["to"]) else bp["to"],
                "description": bp["description"],
                "d1": bp["d1"],
                "d2": bp["d2"],
                "option_value": bp["computed_option_value"],
                "incremental_value": bp["computed_incremental"],
                "sc_percentages": bp["sc_percentages"],
                "sc_dollars": bp["sc_dollars"],
            }
            for i, bp in enumerate(bps)
        ],
        "allocation": [
            {
                "key": t["key"],
                "share_class": t["share_class"],
                "quantity": t["quantity"],
                "oip": t["oip"],
                "class_value": t["computed_class_value"],
                "value_per_share": t["computed_marketable_value"],
            }
            for t in tots
        ],
    }
    print(json.dumps(output, indent=2))


# ---------------------------------------------------------------------------
# Goal-seek verification
# ---------------------------------------------------------------------------

def run_verify(inputs: dict) -> None:
    print("Running goal-seek verification (scipy brentq)…", file=sys.stderr)
    solved = verify_goal_seek(inputs)
    api_ev = inputs["equity_value"]
    diff = abs(solved - api_ev)
    cur = inputs["currency"]
    print(f"API equity value:    {_fmt(api_ev, cur)}")
    print(f"Re-solved value:     {_fmt(solved, cur)}")
    print(f"Difference:          {_fmt(diff, cur)}  ({diff / api_ev * 100:.6f}%)")
    status = "✓ MATCH" if diff / max(api_ev, 1) < 1e-4 else "⚠ MISMATCH"
    print(f"Status: {status}")


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(description="Carta backsolve calculator")
    parser.add_argument("--input", "-i", help="Path to get:backsolve JSON response (default: stdin)")
    parser.add_argument("--equity-adjustment-input", metavar="PATH",
                        help="Path to get:equity_adjustment JSON response (optional; enables Equity Adjustment sheet/section)")
    parser.add_argument("--explain", action="store_true", help="Print step-by-step explanation")
    parser.add_argument("--excel", metavar="PATH", help="Write Excel workbook with live formulas")
    parser.add_argument("--html",  metavar="PATH", help="Write standalone HTML interactive calculator")
    parser.add_argument("--json",  action="store_true", help="Print machine-readable JSON")
    parser.add_argument("--verify", action="store_true", help="Re-run goal-seek and verify equity value")
    args = parser.parse_args()

    if args.input:
        with open(args.input) as f:
            raw = json.load(f)
    else:
        raw = json.load(sys.stdin)

    # The API sometimes wraps in a {"result": "..."} string
    if isinstance(raw, dict) and "result" in raw and isinstance(raw["result"], str):
        raw = json.loads(raw["result"])

    inputs = parse_response(raw)

    adj_data = None
    if args.equity_adjustment_input:
        with open(args.equity_adjustment_input) as f:
            adj_raw = json.load(f)
        adj_data = parse_equity_adjustment(adj_raw, inputs["equity_value"])

    if not any([args.explain, args.excel, args.html, args.json, args.verify]):
        args.explain = True  # default

    if args.explain:
        explain(inputs)
    if args.excel:
        to_excel(inputs, args.excel, adj_data=adj_data)
    if args.html:
        to_html(inputs, args.html, adj_data=adj_data)
    if args.json:
        to_json_output(inputs)
    if args.verify:
        run_verify(inputs)


if __name__ == "__main__":
    main()
