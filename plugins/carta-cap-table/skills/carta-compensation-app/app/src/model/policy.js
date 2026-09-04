// Refresh grant policy — the settings, and what they produce per employee.
//
// Pure, no React.
//
// PERCENTAGES ARE FRACTIONS ON THE WIRE. The corporation's policy stores 0.30 for
// 30%, and every function here takes and returns PERCENT numbers (30, not 0.30).
// The conversion happens once, at `policyToSettings`, so no other code has to
// remember which side of the boundary it is on — mixing the two silently produces
// a grant a hundred times too small.

/** The corporation's stored policy -> the settings the form edits. */
export function policyToSettings(policy) {
  if (!policy) return null;
  return {
    targetPct: Number(policy.tenure_grant_adjustment) * 100,
    cadenceMonths: Number(policy.frequency_months),
    rangeBelowPct: Number(policy.tenure_grant_range_min) * 100,
    rangeAbovePct: Number(policy.tenure_grant_range_max) * 100,
    tenureMinMonths: Number(policy.tenure_eligibility_months),
  };
}

/** Total months -> the {years, months} pair the product's own settings edit.
 *
 *  Both fields are stored as a single month count. CTC's Plan Settings modal splits
 *  them into two inputs (`Math.floor(m / 12)` and `m % 12`), so this console does
 *  the same rather than asking for a number the product never asks for.
 */
export function splitMonths(total) {
  const m = Math.max(0, Number(total) || 0);
  return { years: Math.floor(m / 12), months: m % 12 };
}

/** The inverse: {years, months} -> the total this model and the API store. */
export function joinMonths({ years, months }) {
  return (Math.max(0, Number(years) || 0) * 12) + Math.max(0, Number(months) || 0);
}

/** Months -> "every 1 year", "every 18 months", for the policy sentence. */
export function cadenceLabel(months) {
  if (!months) return "—";
  if (months % 12 === 0) {
    const years = months / 12;
    return `${years} year${years === 1 ? "" : "s"}`;
  }
  return `${months} months`;
}

/** Rescale the target so the ANNUALIZED rate survives a cadence change.
 *
 *  30% every 12 months is 30%/year. Asking for it every 24 months and leaving the
 *  target at 30% halves what people actually receive — the PRD calls this out as
 *  the current tool's worst bottleneck, because today it means editing every
 *  employee's number by hand.
 *
 *      30% @ 12mo -> 6mo  =>  30 x  6/12 = 15%
 *      30% @ 12mo -> 24mo =>  30 x 24/12 = 60%
 *
 *  Only ever called when the CADENCE changes. Editing the target directly must
 *  change the annualized rate — that is what editing it means — and rescaling
 *  there would make the pair impossible to set.
 */
export function scaleTargetForCadence(targetPct, fromMonths, toMonths) {
  if (!fromMonths || !toMonths) return targetPct;
  const scaled = (targetPct * toMonths) / fromMonths;
  // One decimal: 30% @ 12mo -> 7mo is 17.5%, and rounding to a whole number would
  // quietly change the rate the user asked to preserve.
  return Math.round(scaled * 10) / 10;
}

/** The annualized rate a target/cadence pair represents. Null when cadence is 0. */
export function annualizedRate(targetPct, cadenceMonths) {
  if (!cadenceMonths) return null;
  return (targetPct * 12) / cadenceMonths;
}

/** Shares for one employee at a given target %, or null when unknowable.
 *
 *  Null — never 0 — when the employee has no benchmark. 64% of a real roster has
 *  one; for the rest "0 shares" would be a claim that their role's market target
 *  is nothing, rather than that we do not know it.
 */
export function targetShares(row, targetPct) {
  const bench = row && row.four_year_grant_benchmark_num_shares;
  if (bench == null) return null;
  return Math.round(Number(bench) * (targetPct / 100));
}

/** What to show in the grant column, and whether it is the product's own figure.
 *
 *  At the corporation's policy this is `refresh_grant_num_shares` VERBATIM — the
 *  report's own answer, which honours per-employee overrides the console cannot
 *  see. Only once the user changes the target does the console compute one, and
 *  that value is flagged so the UI can label it.
 */
export function grantForRow(row, settings, policySettings) {
  const atPolicy = policySettings != null
    && Math.abs(settings.targetPct - policySettings.targetPct) < 1e-9;
  if (atPolicy) {
    const own = row && row.refresh_grant_num_shares;
    return { shares: own == null ? null : Number(own), modelled: false };
  }
  return { shares: targetShares(row, settings.targetPct), modelled: true };
}

/** The recommended corridor around a target: [target-below%, target+above%]. */
export function grantRange(shares, belowPct, abovePct) {
  if (shares == null) return { min: null, max: null };
  return {
    min: Math.round(shares * (1 - belowPct / 100)),
    max: Math.round(shares * (1 + abovePct / 100)),
  };
}

/** Is this employee eligible under the tenure rule?
 *
 *  Returns a reason rather than a bare false, so the UI can say WHY someone is
 *  excluded instead of silently dropping them.
 *
 *  Unknown tenure is NOT eligible. Treating a missing hire date as satisfying a
 *  policy gate would put someone in a cycle on the strength of absent data.
 */
export function eligibility(row, settings, tenureMonthsFn) {
  if (!settings.tenureMinMonths) return { eligible: true, reason: null };
  const months = tenureMonthsFn(row);
  if (months == null) return { eligible: false, reason: "no hire date recorded" };
  if (months < settings.tenureMinMonths) {
    return { eligible: false, reason: `${months} months' tenure` };
  }
  return { eligible: true, reason: null };
}

/** Totals for the preview tile.
 *
 *  Employees with no benchmark contribute to NEITHER the total nor the average,
 *  and are counted separately. Averaging nulls as zero would understate the cost
 *  of a cycle — which is the number someone takes to a CFO.
 */
export function planTotals(rows, settings, policySettings) {
  let total = 0;
  let counted = 0;
  let noBenchmark = 0;
  for (const row of rows) {
    const { shares } = grantForRow(row, settings, policySettings);
    if (shares == null) noBenchmark += 1;
    else { total += shares; counted += 1; }
  }
  return {
    employees: rows.length,
    totalShares: total,
    avgShares: counted ? Math.round(total / counted) : null,
    counted,
    noBenchmark,
  };
}
