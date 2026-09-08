// The three ways CTC shows an equity figure, and when each is available.
//
// Mirrors `EquityUnitToggle` from compensation-frontend, which is the dropdown on
// /employees/list. The labels, the arithmetic and the availability rules are the
// product's; this file only applies them to the refresh planner's columns.
//
// THE PRICE IS NOT A CHOICE THIS CONSOLE MAKES
// `equityValue` is resolved server-side from the corporation's own settings — it
// is NOT a pick between the preferred price and the 409A fair market value. On
// corp 7 the endpoint returns 5.36, its preferred price, while its FMV is 8.12.
// Choosing FMV here would overstate every grant by half again and disagree with
// every other CTC surface.
//
// AN ABSENT INPUT DROPS THE UNIT
// CTC removes a unit from its dropdown when the figure behind it is missing, and
// falls back to ownership when a corporation has no valuation. It never offers a
// $0 reading. Same here: `availableUnits` returns only what can be computed, and
// a 0 counts as missing — dividing by a zero share count, or pricing at zero,
// produces a figure that reads as real and is not.

import { money } from "./format.js";

export const SHARES = "shares";
export const OWNERSHIP = "fullyDiluted";
export const VALUE = "equityValue";

/** Which units this build can actually show, in CTC's order.
 *
 *  Shares is always offered: it is the report's own figure and needs no inputs.
 */
export function availableUnits(equityUnits) {
  const units = [SHARES];
  if (equityUnits && Number(equityUnits.fullyDilutedShares) > 0) units.push(OWNERSHIP);
  if (equityUnits && Number(equityUnits.equityValue) > 0) units.push(VALUE);
  return units;
}

/** The dropdown label, matching CTC's wording.
 *
 *  The value label names its per-share price, because "Equity Value" alone does
 *  not say what it was computed at — and on a stale valuation that matters.
 */
export function unitLabel(unit, equityUnits) {
  if (unit === OWNERSHIP) return "Fully Diluted Ownership";
  if (unit === VALUE) {
    const price = equityUnits && equityUnits.equityValue;
    if (!price) return "Equity Value";
    // perSharePrice, not money(): a per-share value is often sub-cent and money()
    // rounds to whole units, which would render 0.0001 as nothing.
    return `Equity Value (${perSharePrice(price, currencyOf(equityUnits))}/share)`;
  }
  return "Shares Granted";
}

/** The ISO code the equity value is quoted in, or null when nobody told us.
 *
 *  Null is the normal case: `equity_value` is a bare decimal on the wire, not a
 *  currency-bearing money type, so the endpoint carries no code. Rendering plain
 *  digits then is honest; a "$" would be a claim about a currency we were never
 *  given. CLAUDE.md: never default to or hardcode USD.
 */
export function currencyOf(equityUnits) {
  return (equityUnits && equityUnits.currency) || null;
}

/** A per-share price, which may be sub-cent.
 *
 *  Kept separate from `formatValue` because money() rounds to whole units — right
 *  for a grant worth thousands, wrong for a price of 0.0001.
 */
export function perSharePrice(price, currency) {
  const opts = { minimumFractionDigits: 2, maximumFractionDigits: 12 };
  if (currency) {
    opts.style = "currency";
    opts.currency = currency;
  }
  try {
    return new Intl.NumberFormat(undefined, opts).format(price);
  } catch {
    // An unrecognised ISO code must not blank the label.
    return new Intl.NumberFormat(undefined,
      { minimumFractionDigits: 2, maximumFractionDigits: 12 }).format(price);
  }
}

/** A share count rendered in the chosen unit, or null when it cannot be.
 *
 *  Null — never 0 — when the input is missing. A grant shown as "$0" or "0.0000%"
 *  is a claim about its worth; a dash says we could not compute it.
 */
export function inUnit(shares, unit, equityUnits) {
  if (shares == null) return null;
  if (unit === OWNERSHIP) {
    const fd = equityUnits && Number(equityUnits.fullyDilutedShares);
    if (!fd) return null;
    return (Number(shares) / fd) * 100;
  }
  if (unit === VALUE) {
    const price = equityUnits && Number(equityUnits.equityValue);
    if (!price) return null;
    return Number(shares) * price;
  }
  return Number(shares);
}

/** Ownership at CTC's own precision.
 *
 *  Four decimals, matching `formatFullyDiluted` (`0,0.0000%`) on the scorecard. A
 *  refresh grant is often a few thousandths of a percent, and two decimals would
 *  render most of a cycle as "0.00%".
 */
export function formatOwnership(pct) {
  if (pct == null) return "—";
  return `${pct.toLocaleString("en-US", {
    minimumFractionDigits: 4, maximumFractionDigits: 4,
  })}%`;
}

/** A grant's worth, in whole units. Grants run to millions, where cents are noise.
 *
 *  Delegates to `money()`, which renders plain digits when no currency is known
 *  rather than assuming one.
 */
export function formatValue(amount, currency) {
  if (amount == null) return "—";
  return money(Math.round(amount), currency);
}

/** One entry point so a caller cannot format a figure in the wrong unit. */
export function formatInUnit(shares, unit, equityUnits, formatShares) {
  const v = inUnit(shares, unit, equityUnits);
  if (v == null) return "—";
  if (unit === OWNERSHIP) return formatOwnership(v);
  if (unit === VALUE) return formatValue(v, currencyOf(equityUnits));
  return formatShares(v);
}

/** Why a figure could not be shown in this unit, for a title attribute. */
export function unitUnavailableReason(unit, equityUnits) {
  if (unit === OWNERSHIP && !(equityUnits && Number(equityUnits.fullyDilutedShares) > 0)) {
    return "No fully diluted share count in this snapshot";
  }
  if (unit === VALUE && !(equityUnits && Number(equityUnits.equityValue) > 0)) {
    return "No per-share equity value for this corporation";
  }
  return null;
}
