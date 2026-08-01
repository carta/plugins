// Investment cadence — how many NEW companies the firm backs per month and
// year, per fund and firm-wide. A company counts once per fund, at the month
// of the fund's first check (follow-ons aren't new investments). Fed by
// pacing.json (served at /api/pacing); lineage in references/queries.md §3.

/** "YYYY-MM" months between two month strings (b - a). */
export function monthDiff(a, b) {
  const [ay, am] = a.split("-").map(Number);
  const [by, bm] = b.split("-").map(Number);
  return (by - ay) * 12 + (bm - am);
}

/** Add n months to a "YYYY-MM" string. */
export function addMonths(ym, n) {
  const [y, m] = ym.split("-").map(Number);
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
}

export function daysBetween(isoA, isoB) {
  return Math.round((new Date(isoB) - new Date(isoA)) / 86400000);
}

/** New companies firm-wide in the window (fromYm..toYm inclusive). */
export function countInWindow(monthly, fromYm, toYm) {
  let n = 0;
  for (const series of Object.values(monthly))
    for (const [ym, c] of series) if (ym >= fromYm && ym <= toYm) n += c;
  return n;
}

/** Per-fund cadence: total companies, deployment window, average pace. */
export function fundCadence(series) {
  if (!series.length) return null;
  const companies = series.reduce((s, [, c]) => s + c, 0);
  const first = series[0][0];
  const last = series[series.length - 1][0];
  const activeMonths = monthDiff(first, last) + 1;
  return {
    companies,
    first,
    last,
    activeMonths,
    perMonth: companies / activeMonths,
    perYear: (companies / activeMonths) * 12,
  };
}

/** Quarter key for a month: "2024-05" → "2024-Q2". */
export const quarterOf = (ym) => `${ym.slice(0, 4)}-Q${Math.floor((+ym.slice(5) - 1) / 3) + 1}`;

/**
 * Stacked quarterly series for the chart: every quarter from the first check
 * to asOf, with per-fund counts. [{q, byFund: {<fundId>: n, ...}, total}]
 */
export function quarterlySeries(monthly, asOfYm) {
  const firsts = Object.values(monthly).filter((s) => s.length).map((s) => s[0][0]);
  if (!firsts.length) return [];
  let ym = firsts.sort()[0].slice(0, 5) + "01"; // start of the first year
  const out = new Map();
  while (ym <= asOfYm) {
    out.set(quarterOf(ym), { q: quarterOf(ym), byFund: {}, total: 0 });
    ym = addMonths(ym, 3);
  }
  for (const [fid, series] of Object.entries(monthly)) {
    for (const [m, c] of series) {
      const row = out.get(quarterOf(m));
      if (!row) continue;
      row.byFund[fid] = (row.byFund[fid] || 0) + c;
      row.total += c;
    }
  }
  return [...out.values()];
}

/** Trailing 4-quarter average overlaid on the bars (same units: companies/quarter). */
export function trailingAvg(quarters, span = 4) {
  return quarters.map((row, i) => {
    const win = quarters.slice(Math.max(0, i - span + 1), i + 1);
    return { q: row.q, avg: win.reduce((s, r) => s + r.total, 0) / win.length };
  });
}
