// Per-company investment-health row for the Overview ranked table + drawer.
// Pure over kpi.json. Position amounts carry the fund's reporting currency
// (data.source.currency); the cash series carries each point's own cur.
import { metricOf, metricKeyByLabel, companyOf, latest, seriesPoints, runwayLatest } from "./kpi.js";
import { ppsAsOf } from "./captable.js";

const CASH_RES = [/cash and cash equivalents/i, /period-?end cash/i];

const numOrNull = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

export function cashKeyOf(data) {
  for (const re of CASH_RES) { const k = metricKeyByLabel(data, re); if (k) return k; }
  return null;
}

/** Quarterly cash points [{d,v,cur}, ...] ascending, or []. */
export function cashSeries(data, company) {
  const k = cashKeyOf(data);
  return k ? seriesPoints(company, k, metricOf(data, k), true) : [];
}

function amount(v, cur) {
  const n = numOrNull(v);
  return n == null ? null : { value: n, cur };
}

const REPORTED_BURN_RE = /^(net )?burn/i;

/** Monthly burn from the trailing `win` quarters of cash change. Positive =
 *  cash falling (outflow). Returns { monthlyBurn, netChange, cur } or null. */
export function deriveBurn(cashPts, win = 4) {
  if (!cashPts || cashPts.length < 2) return null;
  const pts = cashPts.slice(-(win + 1));
  const netChange = pts[pts.length - 1].v - pts[0].v;
  const months = (pts.length - 1) * 3;
  return { monthlyBurn: -netChange / months, netChange, cur: pts[pts.length - 1].cur };
}

export function bandOf(months) {
  if (months == null || !Number.isFinite(months)) return null;
  if (months < 6) return "critical";
  if (months < 12) return "caution";
  if (months < 18) return "healthy";
  return "strong";
}

/** { burn, runway, band } for one company. Reported-first, derive as fallback. */
function healthOf(data, company, cashPts) {
  const cashLast = cashPts.length ? cashPts[cashPts.length - 1] : null;

  // Reported burn (monthly) wins if present.
  const burnKey = metricKeyByLabel(data, REPORTED_BURN_RE);
  const reportedBurn = burnKey ? latest(company, burnKey) : null;

  let burn = null, derivedInfo = null;
  if (reportedBurn && reportedBurn.v != null) {
    burn = { value: reportedBurn.v, cur: reportedBurn.cur, derived: false };
  } else {
    derivedInfo = deriveBurn(cashPts);
    // Cash rising / flat over the window => no meaningful burn.
    if (derivedInfo && derivedInfo.netChange < 0) {
      burn = { value: derivedInfo.monthlyBurn, cur: derivedInfo.cur, derived: true };
    }
  }

  // Runway: reported KPI first, else cash / monthly burn.
  const reportedRunway = runwayLatest(data, company);
  let runway = null;
  if (reportedRunway != null) {
    runway = { months: reportedRunway, derived: false };
  } else if (burn && burn.value > 0 && cashLast && cashLast.v != null) {
    runway = { months: cashLast.v / burn.value, derived: true };
  } else if (derivedInfo && derivedInfo.netChange >= 0) {
    runway = { cashUp: true };
  }

  const band = runway && runway.months != null ? bandOf(runway.months) : null;
  return { burn, runway, band };
}

export function buildOverviewRow(data, id) {
  const company = companyOf(data, id);
  if (!company) return null;
  const cur = data.source && data.source.currency;
  const ret = company.returns || {};
  const cashPts = cashSeries(data, company);
  const cashLast = cashPts.length ? cashPts[cashPts.length - 1] : null;
  const lr = company.lastRound;
  const health = healthOf(data, company, cashPts);
  // The fund's most recent mark per share on its equity position.
  const mark = ppsAsOf(company);
  return {
    id: company.id,
    name: company.name,
    invested: amount(ret.cost, cur),
    value: amount(ret.fmv, cur),
    pps: mark && mark.pps != null ? { value: mark.pps, cur, asOf: mark.d } : null,
    moic: numOrNull(ret.moic),
    lastRound: lr
      ? { round: lr.round || null, postMoney: numOrNull(lr.postMoney), date: lr.date || null, cur }
      : null,
    sector: ret.sector || null,
    cash: cashLast ? amount(cashLast.v, cashLast.cur) : null,
    lastResponded: company.lastResponded || null,
    burn: health.burn,
    runway: health.runway,
    band: health.band,
  };
}
