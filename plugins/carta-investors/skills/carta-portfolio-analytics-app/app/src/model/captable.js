// Cap table — the capital structure of a portfolio company, and where the firm
// sits inside it. Pure functions over `company.capTable.classes` as written by
// build_kpi_datadir.py from FUND_ADMIN.SUMMARY_CAP_TABLE.
//
// What this is NOT: a waterfall engine. It reads the terms Carta has RECORDED on
// each share class and does the arithmetic those terms imply. A real liquidation
// also turns on the charter, side letters, pay-to-play, accrued-but-unpaid
// dividends and the deal structure — none of which are in this data. Every
// derived figure below is labelled as an indication, and anything that would
// require an assumption returns null instead of a confident number.

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

// Security-class buckets. `type` comes straight from SUMMARY_CAP_TABLE
// (share_class | option_plan | warrant_block | note_block).
export const CLASS_GROUPS = [
  { id: "share_class", label: "Share classes" },
  { id: "option_plan", label: "Option plans" },
  { id: "warrant_block", label: "Warrants" },
  { id: "note_block", label: "Convertibles & SAFEs" },
];

export const capTableOf = (company) => (company && company.capTable) || null;
export const hasCapTable = (company) => !!(capTableOf(company) && capTableOf(company).classes.length);

/** Why a company has no cap table, by its entity kind (kpi.json `entityKind`). */
export const CAP_TABLE_ABSENCE = {
  "carta-customer": { title: "Cap table not shared" },
  paper: { title: "Paper company" },
  "gl-issuer": { title: "General-ledger issuer" },
};

/** { title } for a company with no cap table and a known kind; else null. */
export function capTableAbsence(company) {
  if (!company || hasCapTable(company)) return null;
  return CAP_TABLE_ABSENCE[company.entityKind] || null;
}

/** The firm's per-fund fully-diluted ownership split (the fdshares stem), in the
 *  order recorded; [] when the company has none. */
export const ownershipFunds = (company) =>
  ((company && company.ownership && company.ownership.byFund) || []).filter((f) => f && f.fund);

/** One fund's fully-diluted ownership of the company, or null when the split
 *  does not name that fund. */
export function fundOwnership(company, fund) {
  const hit = ownershipFunds(company).find((f) => f.fund === fund);
  return hit && hit.pct != null ? hit.pct : null;
}

/** True for a preferred share class — the only kind that carries preferences. */
export const isPreferred = (c) => c.type === "share_class" && /preferred/i.test(c.kind || "");
export const isCommon = (c) => c.type === "share_class" && /common/i.test(c.kind || "");

/**
 * Classes grouped for display, each group sorted the way a cap table reads:
 * preferred by seniority (most senior first), then common, then everything else
 * by size. Convertibles come last — they aren't in the fully-diluted count yet.
 */
export function groupedClasses(company) {
  const ct = capTableOf(company);
  if (!ct) return [];
  const out = [];
  for (const g of CLASS_GROUPS) {
    const rows = ct.classes.filter((c) => c.type === g.id);
    if (!rows.length) continue;
    rows.sort((a, b) => {
      const sa = a.seniority == null ? 99 : a.seniority;
      const sb = b.seniority == null ? 99 : b.seniority;
      if (sa !== sb) return sa - sb;
      return (b.fd || 0) - (a.fd || 0);
    });
    out.push({ ...g, rows });
  }
  return out;
}

/** Company totals. `fdPct` is reported per class; summing it is the reconciliation. */
export function capTotals(company) {
  const ct = capTableOf(company);
  if (!ct) return null;
  let fd = 0, outstanding = 0, authorized = 0, pct = 0, cash = 0;
  for (const c of ct.classes) {
    fd += num(c.fd) || 0;
    outstanding += num(c.outstanding) || 0;
    authorized += num(c.authorized) || 0;
    pct += num(c.fdPct) || 0;
    cash += num(c.cashRaised) || 0;
  }
  return {
    asOf: ct.asOf, classes: ct.classes.length,
    fd, outstanding, authorized, cashRaised: cash,
    pctSum: pct,
    // The per-class percentages are computed upstream against the company's own
    // FD total, so they should sum to 1. Surfacing the miss beats hiding it.
    reconciles: Math.abs(pct - 1) <= 0.0005,
  };
}

/**
 * Liquidation preference for one class: shares × OIP × multiple.
 *
 * Returns null when the original issue price isn't recorded — a preference
 * invented from a default multiplier is a made-up dollar figure, and this number
 * is used to judge whether common is under water. A missing multiplier DOES
 * default to 1× because that is what "no multiple recorded" means in the data
 * model (the field is only populated when a class carries preferences at all).
 */
export function preferenceOf(c) {
  if (!isPreferred(c)) return null;
  const shares = num(c.outstanding), oip = num(c.oip);
  if (shares == null || oip == null) return null;
  const mult = num(c.multiplier) == null ? 1 : num(c.multiplier);
  return shares * oip * mult;
}

/**
 * The preference stack in payout order.
 *
 * Classes sharing a seniority rank are PARI PASSU — they're paid together and
 * share pro rata if proceeds fall short, so they're grouped into one tier rather
 * than arbitrarily ordered against each other. `cumulative` is the total that has
 * to be paid before the NEXT tier sees anything.
 */
export function preferenceStack(company) {
  const ct = capTableOf(company);
  if (!ct) return [];
  const byRank = new Map();
  for (const c of ct.classes) {
    const pref = preferenceOf(c);
    if (pref == null) continue;
    const rank = c.seniority == null ? 99 : c.seniority;
    if (!byRank.has(rank)) byRank.set(rank, { rank, classes: [], amount: 0 });
    const t = byRank.get(rank);
    t.classes.push({ name: c.name, amount: pref, participating: c.participating, cap: num(c.preferenceCap) });
    t.amount += pref;
  }
  const tiers = [...byRank.values()].sort((a, b) => a.rank - b.rank);
  let run = 0;
  for (const t of tiers) { run += t.amount; t.cumulative = run; t.pariPassu = t.classes.length > 1; }
  return tiers;
}

/** Total dollars ahead of common, or null when nothing is computable. */
export function totalPreference(company) {
  const tiers = preferenceStack(company);
  if (!tiers.length) return null;
  return tiers[tiers.length - 1].cumulative;
}

/**
 * How the preference stack compares to what the company is currently worth.
 *
 * Uses the fund's own mark (implied valuation) when there is one, else the last
 * round's post-money — and says which, because they mean different things: the
 * mark moves with the fund's valuation policy, the post-money is a historical
 * transaction price. `coverage` > 1 means the current value clears the stack.
 */
export function overhang(company) {
  const pref = totalPreference(company);
  if (pref == null || pref <= 0) return null;
  const mark = num(company.valuation && company.valuation.impliedValuation);
  const post = num(company.lastRound && company.lastRound.postMoney);
  const base = mark != null ? mark : post;
  if (base == null || base <= 0) return { pref, base: null, basis: null, coverage: null, residual: null };
  return {
    pref,
    base,
    basis: mark != null ? "implied valuation" : "last round post-money",
    basisDate: mark != null
      ? (company.valuation && company.valuation.ppsAsOf) || null
      : (company.lastRound && company.lastRound.date) || null,
    coverage: base / pref,
    residual: base - pref,   // what would be left for common, before conversion
  };
}

/** One-line plain-English reading of a class's terms. */
export function rightsSummary(c) {
  if (!isPreferred(c)) return null;
  const bits = [];
  const mult = num(c.multiplier);
  bits.push(`${mult == null ? "1" : trimNum(mult)}× liquidation preference`);
  if (c.participating === true) {
    bits.push(num(c.preferenceCap) != null
      ? `participating, capped at ${trimNum(c.preferenceCap)}×`
      : "fully participating (uncapped)");
  } else if (c.participating === false) {
    bits.push("non-participating");
  }
  const cpn = num(c.dividendCoupon);
  if (cpn != null && cpn > 0) {
    const t = (c.dividendType || "").toLowerCase();
    bits.push(`${trimNum(cpn)}% ${t === "cumulative" ? "cumulative" : t === "non-cumulative" ? "non-cumulative" : ""} dividend`.replace(/\s+/g, " ").trim());
  }
  const cr = num(c.conversionRatio);
  if (cr != null && Math.abs(cr - 1) > 1e-9) bits.push(`converts ${trimNum(cr)}:1`);
  return bits.join(" · ");
}

const trimNum = (v) => {
  if (v == null) return "—";
  const s = Number(v).toFixed(2);
  return s.replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
};

/** Companies that have a cap table, for the picker. */
export function capTableCompanies(data) {
  return ((data && data.companies) || [])
    .filter(hasCapTable)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Which holdings source this firm has. Fund-admin firms get per-asset Schedule of
 * Investments lines; firms without one show nothing here rather than a guess.
 */
export function holdingsSource(data) {
  if (data && data.hasSoi) return "soi";
  return null;
}

/** SOI lines for a company, newest investment first. */
export function soiLines(company) {
  const rows = [...((company && company.soi) || [])];
  rows.sort((a, b) => String(b.investmentDate || "").localeCompare(String(a.investmentDate || "")));
  return rows;
}

/**
 * SOI performance history: value-per-share (pps), position value (fmv), cost
 * basis and cumulative proceeds over time, oldest first. Built from
 * AGGREGATE_INVESTMENTS_HISTORY. Empty when the firm has no fund-admin history or
 * the company has fewer than two snapshots (a single point cannot draw a line).
 */
export function soiHistory(company) {
  const rows = (company && company.soiHistory) || [];
  return [...rows].sort((a, b) => String(a.d || "").localeCompare(String(b.d || "")));
}

/** Does this company have a drawable SOI performance series? */
export const hasSoiHistory = (company) => soiHistory(company).length >= 2;

/** Do any SOI snapshots carry a proceeds figure? Pre-rebuild data has none, so
 *  the chart falls back to plotting FMV alone. */
export const hasSoiProceeds = (company) => soiHistory(company).some((p) => p && p.proceeds != null);

const soiZero = (v) => v == null || Math.abs(v) < 1;

/** The snapshot where the position realized to a zero FMV mark and never recovers.
 *  Returns { d, proceeds } for that exit, or null while still held. `proceeds` is
 *  the cumulative proceeds AT the exit — equal to the total-value line's height
 *  there, so marker label and dot agree; later distributions raise the line past it.
 *  Cash-back and $0 write-off both qualify. */
export function soiRealizationMark(company) {
  const pts = soiHistory(company);
  if (pts.length < 2) return null;
  let idx = -1;
  for (let i = 1; i < pts.length; i++) {
    if (soiZero(pts[i].fmv) && pts[i - 1].fmv != null && pts[i - 1].fmv > 1) { idx = i; break; }
  }
  if (idx < 0) return null;
  // A later real mark means this was a temporary dip, not a realization.
  if (pts.slice(idx).some((p) => p.fmv != null && p.fmv > 1)) return null;
  const proceeds = pts[idx].proceeds;
  return { d: pts[idx].d, proceeds: typeof proceeds === "number" ? proceeds : 0 };
}

/** Dates where cumulative proceeds stepped up — each a realized distribution
 *  (initial exit, then any later escrow/earnout). Lets the chart tick the rolling
 *  cadence of cash coming back, not just the first exit. */
export function soiProceedsSteps(company) {
  const out = [];
  let prev = 0;
  for (const p of soiHistory(company)) {
    const pr = p && p.proceeds;
    if (typeof pr === "number" && pr > prev + 1) { out.push(p.d); prev = pr; }
  }
  return out;
}

/** All value-per-share marks for a company, ascending: its SOI history plus the
 *  latest fund valuation mark. Deduped by date, with the canonical valuation mark
 *  winning ties. Lets a caller resolve the price/share as of any date. */
export function ppsMarks(company) {
  const byD = new Map();
  for (const p of soiHistory(company)) if (p && p.pps != null) byD.set(p.d, { d: p.d, pps: p.pps });
  const v = company && company.valuation;
  if (v && v.pps != null && v.ppsAsOf) byD.set(v.ppsAsOf, { d: v.ppsAsOf, pps: v.pps });
  return [...byD.values()].sort((a, b) => String(a.d).localeCompare(String(b.d)));
}

/** The value-per-share as of `asOf` (the latest mark dated on/before it), or null
 *  when the company had no mark by then. `asOf` null → the latest mark. */
export function ppsAsOf(company, asOf = null) {
  const marks = ppsMarks(company);
  if (!marks.length) return null;
  if (!asOf) return marks[marks.length - 1];
  let out = null;
  for (const m of marks) { if (m.d <= asOf) out = m; else break; }
  return out;
}

/** SOI totals — cost, value and proceeds across the company's assets. */
export function soiTotals(company) {
  const rows = soiLines(company);
  if (!rows.length) return null;
  const sum = (k) => rows.reduce((s, r) => s + (num(r[k]) || 0), 0);
  const cost = sum("cost"), value = sum("value"), proceeds = sum("proceeds");
  return { lines: rows.length, cost, value, proceeds, unrealized: sum("unrealized"),
           moic: cost > 0 ? (value + proceeds) / cost : null };
}
