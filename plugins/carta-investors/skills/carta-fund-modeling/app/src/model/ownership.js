// Ownership helpers — fully-diluted ownership per Carta cap-table records
// (FUND_CORPORATION_OWNERSHIP.PERCENTAGE), plus the fund-level capital-weighted
// average and the forward "dilution guard" (ownership after the modeled future
// dilution). All pure; the `ownership` argument is the company-ownership.json
// map: { [companyId]: { pct, asOf, byFund: { [fundId]: pct } } }.

/** Clamp a dilution fraction to a sane retained-ownership multiplier in [0, 1]. */
const retained = (dilution) => Math.max(0, 1 - (dilution || 0));

/**
 * A company's firm-total fully-diluted ownership (summed across the firm's funds,
 * matching the grid's existing `own.pct`) and its value after the company's
 * modeled future dilution. Returns nulls when Carta has no ownership on file
 * (unconverted SAFEs, PERCENTAGE=0 — omitted from company-ownership.json).
 */
export function companyOwnership(company, ownership) {
  const entry = (ownership || {})[company.id];
  const pct = entry && typeof entry.pct === "number" ? entry.pct : null;
  const postDilution = pct == null ? null : pct * retained(company.futureDilution);
  return { pct, postDilution, asOf: entry?.asOf ?? null };
}

/** The fund's own cost basis in a company (sum of that fund's position costs). */
function fundCostIn(company, fundId) {
  return (company.positions || []).reduce(
    (s, p) => s + (p.fundId === fundId ? p.cost || 0 : 0),
    0,
  );
}

/**
 * Capital-weighted average fully-diluted ownership for one fund across its
 * portfolio companies: Σ(own_fund_c · cost_fund_c) / Σ(cost_fund_c), using the
 * fund's OWN ownership slice (`byFund[fundId]`), not the firm-summed `pct`.
 * With `{ dilution: true }` each company's ownership is haircut by its expected
 * future dilution — so a Reserve-strategy sweep moves this figure, answering
 * "are we staying ahead of dilution?" at the fund level.
 *
 * Weighting stays within a single fund (one reporting currency); it never sums
 * cost across funds/currencies. Returns null when no weighted ownership exists.
 */
export function fundAvgOwnership(companies, ownership, fundId, { dilution = false } = {}) {
  let weighted = 0;
  let weight = 0;
  for (const c of companies || []) {
    if (c.archived || c.realized) continue;
    const entry = (ownership || {})[c.id];
    const own = entry?.byFund?.[fundId];
    if (typeof own !== "number") continue;
    const cost = fundCostIn(c, fundId);
    if (cost <= 0) continue;
    const factor = dilution ? retained(c.futureDilution) : 1;
    weighted += own * factor * cost;
    weight += cost;
  }
  return weight > 0 ? weighted / weight : null;
}
