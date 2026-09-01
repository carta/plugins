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

// Linear interpolation between two fetched percentiles.
function lerp(a, b, t) {
  if (isBlank(a) || isBlank(b)) return null;
  return Math.round(a + (b - a) * t);
}

function lerpEquity(a, b, t) {
  if (!a || !b) return null;
  return {
    notional: lerp(a.notional, b.notional, t),
    shares: lerp(a.shares, b.shares, t),
    fdpct: (isBlank(a.fdpct) || isBlank(b.fdpct))
      ? null : Number((a.fdpct + (b.fdpct - a.fdpct) * t).toFixed(6)),
  };
}

// Fill in every derived (fetched:false) percentile on a row from its bracket.
// Called at load time so benchmarks.json on disk stays server-truth only.
export function fillDerivedPercentiles(row, percentiles) {
  for (const p of percentiles) {
    if (p.fetched) continue;
    // Skip null/absent metric objects (e.g. no-equity role) — nothing to interpolate from,
    // and mutating null→{} would trip assertProvenance's null guard downstream.
    if (row.salary != null) row.salary[p.key] = lerp(row.salary[p.lo], row.salary[p.hi], p.t);
    if (row.tcc != null) row.tcc[p.key] = lerp(row.tcc[p.lo], row.tcc[p.hi], p.t);
    if (row.equity != null) row.equity[p.key] = lerpEquity(row.equity[p.lo], row.equity[p.hi], p.t);
  }
  return row;
}

// Throws if a fetched row × fetched percentile cell has no value.
// Catches hand-added benchmarks that skip the provenance markers.
export function assertProvenance(row, percentiles) {
  const rowProv = row.provenance || "fetched";
  for (const p of percentiles) {
    if (!p.fetched) continue;
    if (rowProv !== "fetched") continue;
    for (const metric of ["salary", "tcc", "equity"]) {
      if (row[metric] == null) continue; // null/absent metric is valid (e.g. no-equity role)
      const v = row[metric][p.key];
      if (v === undefined) {
        throw new Error(
          `Missing ${metric}.${p.key} on ${row.job}/${row.ladder}/${row.level}: ` +
          `row and percentile both claim fetched, but no value is present. ` +
          `Either mark the row provenance:"estimated" or add ${p.key} to PERCENTILES with fetched:false.`,
        );
      }
    }
  }
}
