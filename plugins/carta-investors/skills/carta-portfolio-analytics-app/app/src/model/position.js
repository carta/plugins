// Position metrics — the non-KPI facts about the FIRM'S STAKE in a company, as
// opposed to the company's own reported operating KPIs.
//
// These come from fund admin (holdings, marks, deal IRR) and the cap table
// (fully-diluted ownership), not from Data Collection. Most of them already
// appear on the Company page scorecard; this registry is what lets the Dashboard
// pull the same numbers in as rows next to the KPI rows.
//
// THE KEY DIFFERENCE FROM A KPI: a KPI is a time series — a value per period. A
// position metric is a SINGLE point-in-time fact ("we own 12.1% as of 2026-08-04").
// It has no history here, so it cannot be spread across the period columns. The
// Dashboard renders each one in the newest ACTUAL column and states its real
// as-of date in the tooltip; see positionRows() in PivotDashboard.
//
// Availability is per firm and never assumed:
//   - fund-admin firms get everything;
//   - a firm with only cap-table portcos still gets Ownership % and Post-money;
//   - a firm with neither (pure Data Collection) gets an empty list and the
//     Dashboard hides the picker entirely.

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Each entry: value(company) -> number|null, asOf(company) -> "YYYY-MM-DD"|null. */
export const POSITION_METRICS = [
  {
    key: "POS_OWNERSHIP", label: "Ownership %", unit: "Percentage", group: "Cap table",
    value: (c) => num(c.ownership && c.ownership.pct),
    asOf: (c) => (c.ownership && c.ownership.asOf) || null,
    tip: "The firm's FULLY-DILUTED ownership of this company, summed across every fund that holds it. "
       + "From the cap table (Carta cap-table portcos only), not from fund admin — so firms without fund "
       + "administration still get this one. A company with no cap-table position linked reads “—”, not 0%.",
  },
  {
    key: "POS_MOIC", label: "Gross MOIC", unit: "Ratio", group: "Returns",
    value: (c) => num(c.returns && c.returns.moic),
    asOf: (c) => null,
    tip: "Gross multiple on invested capital: (current value + proceeds) ÷ cost basis. Gross of fees and "
       + "carry — this is deal-level performance, not what an LP nets.",
  },
  {
    key: "POS_IRR", label: "Deal IRR", unit: "Percentage", group: "Returns",
    value: (c) => num(c.dealIrr),
    asOf: (c) => null,
    tip: "Annualised gross return on this position, from fund admin's deal IRR. Sanitised at build time: "
       + "an exact 0 and anything above 5× are dropped as placeholders rather than shown as real figures.",
  },
  {
    key: "POS_COST", label: "Cost basis", unit: "Dollar", group: "Returns",
    value: (c) => num(c.returns && c.returns.cost),
    asOf: (c) => null,
    tip: "Total invested across every position the firm's funds hold in this company.",
  },
  {
    key: "POS_FMV", label: "Current value", unit: "Dollar", group: "Returns",
    value: (c) => num(c.returns && c.returns.fmv),
    asOf: (c) => null,
    tip: "Remaining value of the position at the latest mark. Excludes proceeds already distributed — "
       + "MOIC adds those back in.",
  },
  {
    key: "POS_PROCEEDS", label: "Proceeds", unit: "Dollar", group: "Returns",
    value: (c) => num(c.returns && c.returns.proceeds),
    asOf: (c) => null,
    tip: "Cash already realised out of this position.",
  },
  {
    key: "POS_UNREALIZED", label: "Unrealized gain/loss", unit: "Dollar", group: "Returns",
    value: (c) => num(c.returns && c.returns.unrealized),
    asOf: (c) => null,
    tip: "Mark-to-market gain or loss still on paper.",
  },
  {
    key: "POS_IMPLIED_VAL", label: "Implied valuation", unit: "Dollar", group: "Valuation",
    value: (c) => num(c.valuation && c.valuation.impliedValuation),
    asOf: (c) => (c.valuation && c.valuation.ppsAsOf) || null,
    tip: "Latest price per share (the fund's mark) × fully-diluted shares (the cap table). An implied "
       + "company valuation, not a round price — it moves whenever the mark moves.",
  },
  {
    key: "POS_PPS", label: "Price per share", unit: "Dollar", group: "Valuation",
    value: (c) => num(c.valuation && c.valuation.pps),
    asOf: (c) => (c.valuation && c.valuation.ppsAsOf) || null,
    tip: "The fund's most recent mark per share on its equity position.",
  },
  {
    key: "POS_POSTMONEY", label: "Post-money (last round)", unit: "Dollar", group: "Valuation",
    value: (c) => num(c.lastRound && c.lastRound.postMoney),
    asOf: (c) => (c.lastRound && c.lastRound.date) || null,
    tip: "Post-money valuation of the most recent financing round. A historical price at a point in "
       + "time — the tooltip's as-of date is the round date, which may be years old.",
  },
  {
    key: "POS_MARK_VS_ROUND", label: "Mark vs last round", unit: "Percentage", group: "Valuation",
    value: (c) => {
      const v = c.valuation && c.valuation.impliedValuation;
      const pm = c.lastRound && c.lastRound.postMoney;
      if (!num(v) || !num(pm) || pm === 0) return null;
      return (v - pm) / Math.abs(pm);
    },
    asOf: (c) => (c.valuation && c.valuation.ppsAsOf) || null,
    tip: "How far the current implied valuation sits above or below the last round's post-money. "
       + "Needs both a mark and a round, so it is blank wherever either is missing.",
  },
];

export const positionMetricOf = (key) => POSITION_METRICS.find((m) => m.key === key) || null;
export const isPositionKey = (key) => /^POS_/.test(String(key || ""));

/**
 * The position metrics this firm can actually populate, with a company count.
 * Gated on real data rather than on a "hasReturns" flag, so a firm that has
 * holdings but no IRR feed doesn't get an all-blank Deal IRR row offered to it.
 */
export function availablePositionMetrics(data) {
  const cos = (data && data.companies) || [];
  if (!cos.length) return [];
  const out = [];
  for (const m of POSITION_METRICS) {
    let n = 0;
    for (const c of cos) if (m.value(c) != null) n++;
    if (n > 0) out.push({ ...m, count: n });
  }
  return out;
}

/** Dropdown options, grouped with a separator between groups. */
export function positionMetricOptions(available) {
  let last = null;
  return (available || []).map((m) => {
    const sep = last !== null && m.group !== last;
    last = m.group;
    return { id: m.key, label: `${m.label} · ${m.count}`, separatorBefore: sep };
  });
}
