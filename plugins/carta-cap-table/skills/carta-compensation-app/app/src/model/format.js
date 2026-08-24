// Value formatting for benchmark figures.
//
// Pure — no React. The rules here are contractual, not cosmetic:
//   * A missing value renders as an em dash, NEVER as 0 or a blank cell. "$0" is a
//     factual claim about the market; "—" is the truth when the API returned nothing.
//   * Currency is never assumed to be USD. A row whose currency the API didn't
//     supply renders unsymbolized, because stamping "$" on a EUR figure silently
//     misstates it.

const EM_DASH = "—";

/** True when a value carries no information (absent/blank/NaN). 0 is a REAL value. */
export function isBlank(v) {
  return v === null || v === undefined || v === "" || (typeof v === "number" && !isFinite(v));
}

/**
 * Format a money figure.
 *
 * Whole dollars — benchmark salaries are never meaningfully sub-dollar, and cents
 * add noise to a grid meant for scanning. `currency` null → digits with no symbol.
 */
export function money(v, currency) {
  if (isBlank(v)) return EM_DASH;
  const opts = { maximumFractionDigits: 0, minimumFractionDigits: 0 };
  if (currency) {
    opts.style = "currency";
    opts.currency = currency;
  }
  try {
    return new Intl.NumberFormat(undefined, opts).format(v);
  } catch {
    // An unrecognized ISO code must not blank the cell — fall back to plain digits.
    return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(v);
  }
}

/** Format a share count (integer, thousands-separated). */
export function shares(v) {
  if (isBlank(v)) return EM_DASH;
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(v);
}

/**
 * Format a fully-diluted percentage.
 *
 * The API returns a FRACTION (0.0004 = 0.04%), not a percent. Three decimals keeps
 * small early-stage grants legible — 0.040% rather than a rounded-to-nothing 0.0%.
 */
export function fdPct(v) {
  if (isBlank(v)) return EM_DASH;
  return (v * 100).toFixed(3) + "%";
}

/**
 * Format a compa-ratio (actual pay ÷ market target).
 *
 * Two decimals to match what the CTC product UI shows, so a reader comparing this
 * table against the product sees the same figure. Note this is coarser than fdPct's
 * three: 1.004 and 1.006 both render "1.00", so a difference either side of exactly-
 * at-market is not visible here. That is accepted — the raw value stays in
 * roster.json and the CSV export, which is where a precise comparison belongs.
 *
 * Coerces before rounding: the paged capture path returns compa-ratios as decimal
 * strings while the bulk export returns JSON numbers, and both reach this function.
 * A value that is not numeric at all renders as an em dash rather than the string
 * "NaN", which would otherwise look like real data in a pay column.
 */
export function ratio(v) {
  const n = Number(v);
  if (isBlank(v) || !isFinite(n)) return EM_DASH;
  return n.toFixed(2);
}

/** Dispatch equity formatting by representation. */
export function equityValue(cell, rep, currency) {
  if (!cell) return EM_DASH;
  if (rep === "shares") return shares(cell.shares);
  if (rep === "fdpct") return fdPct(cell.fdpct);
  return money(cell.notional, currency);
}

export const EQUITY_REPS = [
  { value: "notional", label: "Notional value" },
  { value: "fdpct", label: "FD %" },
  { value: "shares", label: "Shares" },
];

export { EM_DASH };
