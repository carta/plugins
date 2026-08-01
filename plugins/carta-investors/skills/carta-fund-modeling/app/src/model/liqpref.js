// Liquidation-preference waterfall — a pure, transparent estimate of what a fund's
// stake in a portfolio company is worth at a given exit (company equity) value,
// honoring the preference stack instead of the flat `ownership% × value` line.
//
// Data source: Carta SUMMARY_CAP_TABLE per share class (build_datadir.py §15 →
// company-captable.json). Each class carries seniority, preference multiple,
// participation (+ cap), original issue price, conversion ratio, share count and
// cash raised. The fund's own holdings by class (AGGREGATE_INVESTMENTS →
// fundHoldings) make the result fund-specific.
//
// PRAGMATIC model (see plan): preferred paid by seniority tiers; non-participating
// preferred elect max(preference, as-converted) via a fixed-point conversion
// decision; participating preferred take preference + pro-rata residual (capped);
// common + converted + everything-with-shares split the residual pro-rata by
// as-converted shares. SAFEs / notes / pools / warrants fold to common-equivalent
// through their conversion ratio when they carry a share count; shareless
// instruments are out of the pro-rata pool. NOT Carta's official waterfall engine —
// label it an estimate wherever it surfaces.

/** Normalize a share-class / holding name so "Series B Preferred Stock" (holdings)
 *  matches "Series B Preferred" (cap table): lowercase, drop punctuation and the
 *  trailing "stock"/"shares" noise words. */
export function normClass(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/\bstock\b|\bshares?\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Per-class liquidation preference $ — multiplier × cash raised, falling back to
 *  original issue price × shares. 0 when the class has no preference (common,
 *  option pools, warrants). */
function preferenceOf(c) {
  const mult = c.multiplier != null && c.multiplier > 0 ? c.multiplier : (isPreferred(c) ? 1 : 0);
  if (!mult) return 0;
  const invested = investedOf(c);
  return invested > 0 ? mult * invested : 0;
}

/** Capital invested into a class — cash raised, else OIP × shares. */
function investedOf(c) {
  if (c.cashRaised != null && c.cashRaised > 0) return c.cashRaised;
  if (c.oip != null && c.oip > 0 && c.shares != null && c.shares > 0) return c.oip * c.shares;
  return 0;
}

function isPreferred(c) {
  return String(c.kind || "").toLowerCase() === "preferred";
}

/** As-converted common shares a class contributes to the residual pro-rata pool.
 *  Uses the class share count × conversion ratio; 0 for shareless instruments
 *  (SAFEs / notes without a share count) — they stay out of the pool. */
function asConvShares(c) {
  if (c.shares == null || !(c.shares > 0)) return 0;
  const conv = c.conversion != null && c.conversion > 0 ? c.conversion : 1;
  return c.shares * conv;
}

/** Effective seniority for the preference stack: lower = more senior (paid first).
 *  Carta encodes preferred = 1, common = 2. Preferred with a null rank sorts as
 *  senior; everything else (common/options/warrants) sorts junior. */
function seniorityOf(c) {
  if (c.seniority != null) return c.seniority;
  return isPreferred(c) ? 1 : 999;
}

/**
 * Distribute an exit equity value `exit` across the cap-table `classes`, returning
 * a map of className → { proceeds, shares, converted } for EVERY class with shares.
 * Pure and deterministic. `exit` is in the company's own currency (absolute).
 */
export function waterfallProceeds(classes, exit) {
  const E = Math.max(0, exit || 0);
  const entries = (classes || []).map((c) => ({
    name: c.name,
    pref: preferenceOf(c),
    invested: investedOf(c),
    participating: !!c.participating,
    // cap is a multiple of invested capital; total (pref + participation) is bounded by cap×invested
    cap: c.cap != null && c.cap > 0 ? c.cap : null,
    seniority: seniorityOf(c),
    asConv: asConvShares(c),
    shares: c.shares != null && c.shares > 0 ? c.shares : 0,
    preferred: isPreferred(c),
  }));

  // Which preferred classes elect to convert to common. Solved by fixed point: a
  // class converts when its as-converted pool proceeds beat its non-converted take
  // (preference, plus capped participation for participating classes — so a
  // participation cap that bites triggers conversion too). Converting drops its
  // preference and adds its shares to the pool, lowering everyone's per-share
  // proceeds — so iterate to a stable set. A seen-set guard stops any 2-cycle.
  const converted = new Set();
  const seen = new Set();
  let result = null;
  for (let iter = 0; iter < 64; iter++) {
    result = allocate(entries, E, converted);
    let changed = false;
    for (const e of entries) {
      if (!e.preferred || e.pref <= 0) continue;
      const asCommon = result.perShare * e.asConv; // pool proceeds if it converted
      const take = result.byName[e.name] || 0; // its current allocated take
      if (!converted.has(e.name)) {
        if (asCommon > take + 1e-6) { converted.add(e.name); changed = true; }
      } else if (!e.participating && e.pref > asCommon + 1e-6) {
        // a non-participating class only reverts when the flat preference wins
        converted.delete(e.name); changed = true;
      }
    }
    if (!changed) break;
    const key = [...converted].sort().join("|");
    if (seen.has(key)) break; // oscillation guard — take the current set
    seen.add(key);
  }

  const out = {};
  for (const e of entries) {
    if (e.shares <= 0) continue; // can't attribute shareless instruments to a holding
    out[e.name] = {
      proceeds: round2(result.byName[e.name] || 0),
      shares: e.shares,
      converted: converted.has(e.name),
    };
  }
  return out;
}

/** One allocation pass given a fixed `converted` set. Returns per-class $ and the
 *  residual per-(as-converted)-share used to test conversion elections. */
function allocate(entries, E, converted) {
  // Tier 1 — pay preferences (participating + non-converting non-participating
  // preferred), most senior first, pro-rated within a tier when cash is short.
  const prefClasses = entries.filter((e) => e.pref > 0 && !converted.has(e.name));
  const tiers = new Map();
  for (const e of prefClasses) {
    const t = tiers.get(e.seniority) || [];
    t.push(e);
    tiers.set(e.seniority, t);
  }
  const byName = {};
  let remaining = E;
  for (const sen of [...tiers.keys()].sort((a, b) => a - b)) {
    const tier = tiers.get(sen);
    const tierTotal = tier.reduce((s, e) => s + e.pref, 0);
    const pay = Math.min(remaining, tierTotal);
    for (const e of tier) byName[e.name] = (pay * e.pref) / tierTotal;
    remaining -= pay;
    if (remaining <= 0) break;
  }

  // Tier 2 — residual splits pro-rata by as-converted shares across the pool:
  // common + converted preferred + participating preferred (their upside above pref).
  const pool = entries.filter(
    (e) => e.asConv > 0 && (!e.preferred || converted.has(e.name) || e.participating),
  );
  const poolShares = pool.reduce((s, e) => s + e.asConv, 0);
  const perShare = poolShares > 0 && remaining > 0 ? remaining / poolShares : 0;
  for (const e of pool) {
    let part = perShare * e.asConv;
    // participation cap: total (pref already paid + participation) ≤ cap × invested
    if (e.participating && !converted.has(e.name) && e.cap != null && e.invested > 0) {
      const capTotal = e.cap * e.invested;
      const already = byName[e.name] || 0;
      part = Math.max(0, Math.min(part, capTotal - already));
    }
    byName[e.name] = (byName[e.name] || 0) + part;
  }
  return { byName, perShare };
}

/**
 * The fund's proceeds at an exit equity value, from its per-class holdings. Each
 * class's total proceeds are attributed to the fund by its share of that class.
 *
 * Attribution uses the fund's **capital fraction** (holding cost ÷ class cash
 * raised) rather than a share-count ratio: Carta's fund-accounting
 * COUNT_REMAINING_SHARES and the cap table's OUTSTANDING_SHARES are frequently on
 * different per-share bases (splits, secondary basis), so a share ratio can wildly
 * over/understate; invested-capital fraction is unit-robust and, because both
 * preference and participation scale with capital contributed, economically sound.
 * Falls back to the share ratio for classes with no cash raised (e.g. common).
 * Holdings with no matching class contribute 0.
 */
export function fundExitProceeds(entry, exit) {
  if (!entry || !entry.classes || !entry.fundHoldings) return { proceeds: 0, byHolding: [] };
  const alloc = waterfallProceeds(entry.classes, exit);
  const allocByNorm = {};
  for (const k of Object.keys(alloc)) allocByNorm[normClass(k)] = alloc[k];
  const classByNorm = {};
  for (const c of entry.classes) classByNorm[normClass(c.name)] = c;

  let total = 0;
  const byHolding = [];
  for (const h of entry.fundHoldings) {
    const nk = normClass(h.className);
    const a = allocByNorm[nk];
    const cls = classByNorm[nk];
    let frac = 0;
    if (a) {
      if (cls && cls.cashRaised > 0 && h.cost > 0) frac = Math.min(1, h.cost / cls.cashRaised);
      else if (a.shares > 0 && h.shares > 0) frac = Math.min(1, h.shares / a.shares);
    }
    const proceeds = a ? a.proceeds * frac : 0;
    total += proceeds;
    byHolding.push({ className: h.className, shares: h.shares, proceeds: round2(proceeds), converted: !!(a && a.converted) });
  }
  return { proceeds: round2(total), byHolding };
}

/**
 * A sampled fund-proceeds-vs-exit-value polyline for the UI curve, with the
 * preference-floor kink (total preference) inserted so the floor→participation
 * elbow renders crisply. `maxExit` bounds the x-axis; `steps` sets sample density.
 * Returns [{ x, y }] sorted by x (x = exit equity value, y = fund proceeds).
 */
export function fundProceedsCurve(entry, maxExit, steps = 40) {
  if (!entry || !(maxExit > 0)) return [];
  const xs = new Set([0]);
  for (let i = 1; i <= steps; i++) xs.add((maxExit * i) / steps);
  // insert kinks: cumulative preference tier sums (where the floor stops filling)
  let cum = 0;
  for (const s of prefTierSums(entry.classes)) {
    cum += s;
    if (cum > 0 && cum < maxExit) { xs.add(cum); xs.add(cum * 1.0001); }
  }
  return [...xs]
    .sort((a, b) => a - b)
    .map((x) => ({ x, y: fundExitProceeds(entry, x).proceeds }));
}

/** Total-preference tier sums (senior→junior) — used to seed curve kinks. */
function prefTierSums(classes) {
  const tiers = new Map();
  for (const c of classes || []) {
    const pref = preferenceOf(c);
    if (pref <= 0) continue;
    const sen = seniorityOf(c);
    tiers.set(sen, (tiers.get(sen) || 0) + pref);
  }
  return [...tiers.keys()].sort((a, b) => a - b).map((k) => tiers.get(k));
}

/**
 * Display summary for a company's cap table: total liquidation preference (the
 * aggregate downside floor senior to common), the fund's total invested/held, and
 * the preference multiple range. Currency comes straight from the entry — never
 * assume USD, never sum across currencies (a cap table is single-currency).
 */
export function preferenceSummary(entry) {
  if (!entry || !entry.classes) return null;
  let totalPref = 0;
  let anyParticipating = false;
  const mults = [];
  for (const c of entry.classes) {
    const p = preferenceOf(c);
    if (p > 0) {
      totalPref += p;
      if (c.participating) anyParticipating = true;
      if (c.multiplier != null && c.multiplier > 0) mults.push(c.multiplier);
    }
  }
  const fundInvested = (entry.fundHoldings || []).reduce((s, h) => s + (h.cost || 0), 0);
  const fundFmv = (entry.fundHoldings || []).reduce((s, h) => s + (h.fmv || 0), 0);
  return {
    currency: entry.currency || null,
    totalPreference: round2(totalPref),
    anyParticipating,
    multMin: mults.length ? Math.min(...mults) : null,
    multMax: mults.length ? Math.max(...mults) : null,
    fundInvested: round2(fundInvested),
    fundFmv: round2(fundFmv),
    hasPrefTerms: totalPref > 0,
  };
}

function round2(x) {
  return Math.round((x + Number.EPSILON) * 100) / 100;
}
