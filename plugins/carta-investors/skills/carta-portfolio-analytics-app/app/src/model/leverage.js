// Leverage ratios computed from the reported balance-sheet / income KPIs. The
// five classic leverage multiples that are computable from this dataset (there is
// no interest-expense metric, so interest coverage is intentionally omitted).
import { metricKeyByLabel, latest, metricOf, ltmValue } from "./kpi.js";

// Levels (debt, cash, equity, assets) take the latest reported point.
const val = (data, company, re) => { const k = metricKeyByLabel(data, re); const l = k ? latest(company, k) : null; return l ? l.v : null; };
const div = (a, b) => (a == null || b == null || b === 0 ? null : a / b);

// EBITDA is a flow → its leverage denominator is trailing-twelve-months. `v` is null
// (ratio N/A) until a full year is reported; `missing` names the quarters still needed.
function ltmEbitda(data, company) {
  const k = metricKeyByLabel(data, /^ebitda\.?$/i);
  if (!k) return { v: null, missing: [] };
  const ltm = ltmValue(company, k, metricOf(data, k));
  return ltm ? { v: ltm.complete ? ltm.v : null, missing: ltm.missing } : { v: null, missing: [] };
}

// Total interest-bearing debt = current + long-term loans payable (skip missing).
function totalDebt(data, company) {
  const cur = val(data, company, /^loans payable,?\s*current$/i);
  const ltc = val(data, company, /^loans payable,?\s*less current$/i);
  if (cur == null && ltc == null) return null;
  return (cur || 0) + (ltc || 0);
}

export const LEVERAGE_DEFS = [
  { key: "debt_ebitda", label: "Debt / EBITDA", hint: "Total debt ÷ EBITDA" },
  { key: "netdebt_ebitda", label: "Net Debt / EBITDA", hint: "(Debt − cash) ÷ EBITDA" },
  { key: "debt_equity", label: "Debt / Equity", hint: "Total debt ÷ total equity" },
  { key: "debt_assets", label: "Debt / Assets", hint: "Total debt ÷ total assets" },
  { key: "assets_equity", label: "Assets / Equity", hint: "Equity multiplier" },
];

/** The five leverage ratios for one company (null where an input is missing/zero). */
export function leverageForCompany(data, company) {
  const debt = totalDebt(data, company);
  const ebitdaLtm = ltmEbitda(data, company);
  const ebitda = ebitdaLtm.v;
  const cash = val(data, company, /cash and cash equivalents/i) ?? val(data, company, /period-?end cash/i);
  const equity = val(data, company, /^total equity$/i);
  const assets = val(data, company, /^total assets$/i);
  const netDebt = debt == null ? null : debt - (cash || 0);
  return {
    debt_ebitda: div(debt, ebitda),
    netdebt_ebitda: div(netDebt, ebitda),
    debt_equity: div(debt, equity),
    debt_assets: div(debt, assets),
    assets_equity: div(assets, equity),
    _inputs: { debt, ebitda, cash, equity, assets, netDebt },
    // Quarters still needed before EBITDA ratios compute (empty when a full year is in).
    _missing: { ebitda: ebitdaLtm.missing },
  };
}
