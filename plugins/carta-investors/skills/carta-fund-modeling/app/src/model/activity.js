// Recent-activity feed for the Overview tab. Built entirely from the position-level
// data the builder writes (see build_datadir.py): each position carries its
// investment_date (markDate), latest FMV effective date (fmvDate), last-update date
// (updateDate), invested cost, current mark (cartaFv), realized proceeds, security
// type, and fundId. From that we derive four event lanes the UI lets you filter:
//
//   investment  — a company's FIRST dated check (new position)
//   followOn    — a LATER dated check into a company already held
//   valuation   — a live company's latest remark (mark vs cost), dated by fmvDate
//   exit        — a realized company's proceeds, dated by updateDate (proxy: Fund
//                 Admin exposes no explicit realization date) or undated
//
// Positions with no recorded date fall back to the snapshot's navAsOf in the
// builder, so those dates are treated as "no real event" and dropped.

const LATER = (a, b) => (!a ? b : !b ? a : a > b ? a : b); // max of two ISO dates, null-safe

/** Distinct fund ids + display names touched by a set of positions, in first-seen order. */
function collectFunds(positions, fundName) {
  const ids = [], names = [];
  for (const p of positions || []) {
    if (p.fundId != null && !ids.includes(p.fundId)) {
      ids.push(p.fundId);
      names.push(fundName[p.fundId] ?? p.fundId);
    }
  }
  return { ids, names };
}

/** Distinct security types across a set of positions (e.g. "Series A Preferred", "SAFE"). */
function securitiesOf(positions) {
  const out = [];
  for (const p of positions || []) {
    if (p.security && !out.includes(p.security)) out.push(p.security);
  }
  return out;
}

/** Firm activity across every lane, newest first. Each event carries a `type`
 *  (investment | followOn | valuation | exit) so the card can filter client-side.
 *  Returns the full pool (unlimited) — the card slices per active filter.
 *  @param companies portfolio.companies (the active slice's registry)
 *  @param funds snapshot.funds (for display names)
 *  @param navAsOf snapshot.source.navAsOf — the builder's missing-date fallback */
export function recentActivity(companies, funds, navAsOf) {
  const fundName = Object.fromEntries((funds || []).map((f) => [f.id, f.name]));
  const events = [];

  for (const c of companies || []) {
    const positions = c.positions || [];
    const cost = c.costBasis || 0;
    const allSecs = securitiesOf(positions);

    // ---- investment / follow-on: real checks, grouped by date across funds ----
    const byDate = new Map();
    for (const p of positions) {
      const date = p.markDate;
      const amt = p.cost || 0;
      // drop non-events: navAsOf is the builder's missing-date fallback; a
      // zero/negative cost isn't a real check
      if (!date || date === navAsOf || amt <= 0) continue;
      let row = byDate.get(date);
      if (!row) { row = { date, cost: 0, pos: [] }; byDate.set(date, row); }
      row.cost += amt;
      row.pos.push(p);
    }
    // ascending so the earliest check is the "investment"; the rest are follow-ons
    [...byDate.values()]
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
      .forEach((row, i) => {
        const { ids, names } = collectFunds(row.pos, fundName);
        events.push({
          key: `${c.id}@inv@${row.date}`, type: i === 0 ? "investment" : "followOn",
          companyId: c.id, name: c.name, logo: c.logoDataUri ?? null, date: row.date, cost: row.cost,
          fundIds: ids, fundNames: names, securities: securitiesOf(row.pos),
          round: c.lastRound?.round ?? null, postMoney: c.lastRound?.postMoney ?? null,
        });
      });

    const { ids, names } = collectFunds(positions, fundName);

    if (c.realized && (c.proceeds || 0) > 0) {
      // ---- exit: realized proceeds, dated by the last-update proxy (may be undated) ----
      let d = null;
      for (const p of positions) d = LATER(d, p.updateDate || p.fmvDate);
      events.push({
        key: `${c.id}@exit`, type: "exit", companyId: c.id, name: c.name, logo: c.logoDataUri ?? null,
        date: d && d !== navAsOf ? d : null,
        proceeds: c.proceeds, cost, moic: cost > 0 ? c.proceeds / cost : null,
        fundIds: ids, fundNames: names, securities: allSecs,
      });
    } else {
      // ---- valuation update: a live company's latest remark, dated by fmvDate ----
      // Fund Admin seeds a fresh position's fmvDate to its own markDate until a real
      // re-mark happens, so a brand-new check often produces a same-day "valuation"
      // event with mark === cost (moic 1.0x, zero gain) — pure noise duplicating the
      // investment/follow-on card already shown for that date. Drop it; a later, real
      // re-mark still gets its own event once fmvDate actually moves past the check.
      // Checked PER POSITION dated `d`, not on the company-wide aggregate — an older
      // position's real gain/loss could otherwise cancel out a fresh position's zero
      // gain in the totals and wrongly suppress a genuinely newsworthy re-mark.
      let d = null, mark = 0;
      for (const p of positions) { d = LATER(d, p.fmvDate); mark += p.cartaFv || 0; }
      const isNoOpOnCheckDate = d && byDate.has(d) &&
        positions.every((p) => p.fmvDate !== d || (p.cartaFv || 0) === (p.cost || 0));
      if (mark > 0 && d && d !== navAsOf && !isNoOpOnCheckDate) {
        events.push({
          key: `${c.id}@val`, type: "valuation", companyId: c.id, name: c.name, logo: c.logoDataUri ?? null, date: d,
          mark, cost, gain: mark - cost, moic: cost > 0 ? mark / cost : null,
          fundIds: ids, fundNames: names, securities: allSecs,
        });
      }
    }
  }

  const size = (e) => e.cost || e.proceeds || e.mark || 0;
  return events.sort((a, b) => {
    const ad = a.date || "", bd = b.date || "";
    return ad < bd ? 1 : ad > bd ? -1 : size(b) - size(a);
  });
}
