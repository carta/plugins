/*
 * calc.js — investor-dashboard client-side scenario engine.
 *
 * Pure functions, no DOM, no network. Works as a browser global (window.Calc)
 * and as a Node module (module.exports) so it can be unit-tested headless.
 *
 * IMPORTANT: this is a TRANSPARENT ESTIMATE — a simplified European whole-fund
 * waterfall. It is NOT Carta's official Niagara engine. See references/calc-spec.md
 * for every formula and the assumptions/exclusions. Do not replace these pure
 * functions with a server/MCP call (the browser cannot reach the Carta MCP).
 *
 * Data model (see calc-spec.md for the authoritative contract):
 *   baseline = {
 *     fund: { name, currency },
 *     terms: { carryPct, hurdlePct, gpCommitPct, catchUp, distributionType },
 *     capital: { committedCapital, contributedCapital, cumulativeDistributions,
 *                totalMgmtFees, dryPowder, fundSize, fundStartDate, avgCheckSize },
 *     deals: [ { id, name, invested, fmv, realized, ownershipPct, investmentDate,
 *                status, moic } ],
 *     cashflows: [ { date: 'YYYY-MM-DD', amount } ]   // LP-net; <0 contribution, >0 distribution
 *   }
 *   scenario = {
 *     termOverrides: { carryPct?, hurdlePct?, gpCommitPct?, catchUp? },
 *     deals: { [dealId]: { followOnReserve?, exitValuation?, exitDate?, exitMultipleOnReserve? } },
 *     avgCheckSize?
 *   }
 */
(function (root, factory) {
  var mod = factory();
  if (typeof module === 'object' && module.exports) module.exports = mod;
  else root.Calc = mod;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DEFAULT_TERMS = {
    carryPct: 0.20,
    hurdlePct: 0.08,
    gpCommitPct: 0.02,
    catchUp: true,
    distributionType: 'european'
  };

  var DAY_MS = 24 * 60 * 60 * 1000;

  function num(x, fallback) {
    var n = typeof x === 'string' ? parseFloat(x) : x;
    return (typeof n === 'number' && isFinite(n)) ? n : (fallback === undefined ? 0 : fallback);
  }

  function parseDate(s) {
    if (!s) return null;
    if (s instanceof Date) return s;
    var d = new Date(s + (String(s).length === 10 ? 'T00:00:00Z' : ''));
    return isNaN(d.getTime()) ? null : d;
  }

  function yearsBetween(a, b) {
    var da = parseDate(a), db = parseDate(b);
    if (!da || !db) return 0;
    return (db.getTime() - da.getTime()) / (365.25 * DAY_MS);
  }

  function mergeTerms(baseTerms, overrides) {
    var t = {};
    var src = baseTerms || {};
    for (var k in DEFAULT_TERMS) t[k] = (src[k] !== undefined && src[k] !== null) ? src[k] : DEFAULT_TERMS[k];
    if (overrides) {
      for (var o in overrides) {
        if (overrides[o] !== undefined && overrides[o] !== null && overrides[o] !== '') t[o] = overrides[o];
      }
    }
    // numeric coercion
    t.carryPct = num(t.carryPct, DEFAULT_TERMS.carryPct);
    t.hurdlePct = num(t.hurdlePct, DEFAULT_TERMS.hurdlePct);
    t.gpCommitPct = num(t.gpCommitPct, DEFAULT_TERMS.gpCommitPct);
    return t;
  }

  /* ---- per-deal projection under a scenario ---- */
  function projectDeal(deal, sc) {
    sc = sc || {};
    var invested = num(deal.invested);
    var fmv = num(deal.fmv);
    var realized = num(deal.realized);
    var ownership = num(deal.ownershipPct); // fraction (0..1)
    var reserve = Math.max(0, num(sc.followOnReserve));
    var hasExit = sc.exitValuation !== undefined && sc.exitValuation !== null && sc.exitValuation !== '';
    var investedTotal = invested + reserve;

    var exitProceeds = 0;   // NEW projected exit cash to the fund (excludes already-realized)
    var residualFMV = 0;    // remaining carrying value if not exited

    if (hasExit) {
      var exitVal = num(sc.exitValuation);
      var baseProceeds = ownership * exitVal; // proceeds on the existing position
      // follow-on participates at an assumed multiple; default = this deal's projected exit multiple
      var dealMultiple = invested > 0 ? (baseProceeds / invested) : 1;
      var reserveMultiple = (sc.exitMultipleOnReserve !== undefined && sc.exitMultipleOnReserve !== null && sc.exitMultipleOnReserve !== '')
        ? num(sc.exitMultipleOnReserve) : dealMultiple;
      var reserveProceeds = reserve * reserveMultiple;
      exitProceeds = baseProceeds + reserveProceeds;
      residualFMV = 0;
    } else {
      // held at mark; follow-on added at cost
      exitProceeds = 0;
      residualFMV = fmv + reserve;
    }

    var dealValue = realized + exitProceeds + residualFMV; // total value attributable to the deal
    return {
      id: deal.id,
      name: deal.name,
      invested: invested,
      reserve: reserve,
      investedTotal: investedTotal,
      realized: realized,
      exitProceeds: exitProceeds,
      residualFMV: residualFMV,
      dealValue: dealValue,
      exitDate: hasExit ? (sc.exitDate || null) : null,
      moic: investedTotal > 0 ? dealValue / investedTotal : 0,
      hasExit: hasExit
    };
  }

  /* ---- European whole-fund waterfall on a distributable amount ---- */
  function runWaterfall(distributable, contributed, terms, prefYears) {
    var carry = terms.carryPct;
    var hurdle = terms.hurdlePct;
    var gpCommit = terms.gpCommitPct;
    var lpShare = 1 - gpCommit;
    var rem = Math.max(0, distributable);

    // Tier 1 — return of capital (pro-rata LP/GP by commitment)
    var roc = Math.min(rem, contributed);
    rem -= roc;

    // Tier 2 — preferred return (hurdle), compounded over prefYears, on contributed capital
    var prefTarget = contributed * (Math.pow(1 + hurdle, Math.max(0, prefYears)) - 1);
    var pref = Math.min(rem, prefTarget);
    rem -= pref;

    // Tier 3 — GP catch-up to carry % of profits-above-ROC (full catch-up)
    var catchUpPaid = 0;
    if (terms.catchUp && carry > 0 && carry < 1) {
      var catchUpTarget = (carry / (1 - carry)) * pref;
      catchUpPaid = Math.min(rem, catchUpTarget);
      rem -= catchUpPaid;
    }

    // Tier 4 — carried-interest split
    var gpSplit = rem * carry;
    var lpSplit = rem - gpSplit;

    var gpCarry = catchUpPaid + gpSplit; // promote
    var netProceedsLP = (roc + pref) * lpShare + lpSplit;
    var netProceedsGP = (roc + pref) * gpCommit + gpCarry;

    return {
      distributable: distributable,
      tiers: { returnOfCapital: roc, preferredReturn: pref, gpCatchUp: catchUpPaid, gpSplit: gpSplit, lpSplit: lpSplit },
      gpCarry: gpCarry,
      netProceedsLP: netProceedsLP,
      netProceedsGP: netProceedsGP,
      contributedLP: contributed * lpShare,
      contributedGP: contributed * gpCommit
    };
  }

  /* ---- IRR (XIRR-style) via bisection over dated cashflows ---- */
  function xirr(flows) {
    // flows: [{date, amount}] with at least one negative and one positive
    var cf = (flows || []).filter(function (f) { return parseDate(f.date) && isFinite(num(f.amount)); });
    if (cf.length < 2) return null;
    var hasNeg = false, hasPos = false;
    cf.forEach(function (f) { if (f.amount < 0) hasNeg = true; if (f.amount > 0) hasPos = true; });
    if (!hasNeg || !hasPos) return null;
    var t0 = parseDate(cf[0].date);
    function npv(rate) {
      var s = 0;
      for (var i = 0; i < cf.length; i++) {
        var yrs = (parseDate(cf[i].date).getTime() - t0.getTime()) / (365.25 * DAY_MS);
        s += num(cf[i].amount) / Math.pow(1 + rate, yrs);
      }
      return s;
    }
    var lo = -0.9999, hi = 10.0;
    var flo = npv(lo), fhi = npv(hi);
    if (flo * fhi > 0) return null; // no sign change in range
    for (var it = 0; it < 200; it++) {
      var mid = (lo + hi) / 2;
      var fm = npv(mid);
      if (Math.abs(fm) < 1e-7) return mid;
      if (flo * fm < 0) { hi = mid; fhi = fm; } else { lo = mid; flo = fm; }
    }
    return (lo + hi) / 2;
  }

  /* ---- top-level: compute everything for a (baseline, scenario) pair ---- */
  function compute(baseline, scenario) {
    baseline = baseline || {};
    scenario = scenario || {};
    var cap = baseline.capital || {};
    var terms = mergeTerms(baseline.terms, scenario.termOverrides);
    var deals = baseline.deals || [];
    var scDeals = scenario.deals || {};

    var perDeal = deals.map(function (d) { return projectDeal(d, scDeals[d.id] || {}); });

    var totalInvested = 0, newExitProceeds = 0, residualNAV = 0, totalReserves = 0;
    var exitDates = [];
    perDeal.forEach(function (p) {
      totalInvested += p.investedTotal;
      newExitProceeds += p.exitProceeds;
      residualNAV += p.residualFMV;
      totalReserves += p.reserve;
      if (p.hasExit && p.exitDate) exitDates.push(p.exitDate);
    });

    var contributed = num(cap.contributedCapital);
    var histDistributions = num(cap.cumulativeDistributions);
    var totalDistributions = histDistributions + newExitProceeds;
    var totalValue = totalDistributions + residualNAV; // at-liquidation value
    var distributable = totalValue;

    // pref accrual horizon: to the terminal exit date if any, else current fund age
    var fundStart = cap.fundStartDate || (deals.length ? deals.map(function (d) { return d.investmentDate; }).filter(Boolean).sort()[0] : null);
    var terminalExit = exitDates.length ? exitDates.sort()[exitDates.length - 1] : null;
    var prefYears;
    if (fundStart && terminalExit) prefYears = yearsBetween(fundStart, terminalExit);
    else if (cap.fundAgeYears !== undefined) prefYears = num(cap.fundAgeYears);
    else if (fundStart) prefYears = yearsBetween(fundStart, new Date().toISOString().slice(0, 10));
    else prefYears = 0;

    var wf = runWaterfall(distributable, contributed, terms, prefYears);

    // gross + net multiples
    var grossMOIC = totalInvested > 0 ? totalValue / totalInvested : 0;
    var netTVPI = wf.contributedLP > 0 ? wf.netProceedsLP / wf.contributedLP : 0;
    // projected DPI at full liquidation == netTVPI (everything distributed); historical DPI from baseline
    var dpiProjected = netTVPI;

    // ---- Net IRR (LP) ----
    var lpShare = 1 - terms.gpCommitPct;
    var histFlows = (baseline.cashflows || []).map(function (f) { return { date: f.date, amount: num(f.amount) }; });
    var histLPDistributions = histFlows.reduce(function (s, f) { return s + (f.amount > 0 ? f.amount : 0); }, 0);
    var projFlows = [];
    var incrementalLP = wf.netProceedsLP - histLPDistributions;
    if (incrementalLP > 0) {
      // distribute the incremental LP proceeds across exit dates, weighted by each deal's exit proceeds
      var weights = perDeal.filter(function (p) { return p.hasExit && p.exitDate && p.exitProceeds > 0; });
      var wsum = weights.reduce(function (s, p) { return s + p.exitProceeds; }, 0);
      if (wsum > 0) {
        weights.forEach(function (p) { projFlows.push({ date: p.exitDate, amount: incrementalLP * (p.exitProceeds / wsum) }); });
      } else {
        var termDate = terminalExit || new Date(Date.now()).toISOString().slice(0, 10);
        projFlows.push({ date: termDate, amount: incrementalLP });
      }
    }
    var irrFlows;
    var irrApproximate = false;
    if (histFlows.length >= 1) {
      irrFlows = histFlows.concat(projFlows);
    } else {
      // no dated history — approximate: single contribution at fund start, terminal LP distribution
      irrApproximate = true;
      var start = fundStart || new Date(Date.now() - 365 * DAY_MS).toISOString().slice(0, 10);
      var end = terminalExit || new Date(Date.now()).toISOString().slice(0, 10);
      irrFlows = [{ date: start, amount: -(contributed * lpShare) }, { date: end, amount: wf.netProceedsLP }];
    }
    var netIRR = xirr(irrFlows);

    // ---- deals remaining ----
    var avgCheck = num(scenario.avgCheckSize, num(cap.avgCheckSize, 0));
    if (!avgCheck) {
      var activeCount = deals.length || 1;
      var sumInvested = deals.reduce(function (s, d) { return s + num(d.invested); }, 0);
      avgCheck = sumInvested / activeCount;
    }
    var dryPowder = num(cap.dryPowder);
    var capacity = Math.max(0, dryPowder - totalReserves);
    var dealsRemaining = avgCheck > 0 ? Math.floor(capacity / avgCheck) : 0;

    return {
      terms: terms,
      perDeal: perDeal,
      totals: {
        totalInvested: totalInvested,
        newExitProceeds: newExitProceeds,
        residualNAV: residualNAV,
        totalDistributions: totalDistributions,
        totalValue: totalValue,
        totalReserves: totalReserves
      },
      waterfall: wf,
      metrics: {
        grossMOIC: grossMOIC,
        netTVPI: netTVPI,
        dpiProjected: dpiProjected,
        netIRR: netIRR,
        netIRRApproximate: irrApproximate
      },
      capacity: {
        dryPowder: dryPowder,
        reservesPlanned: totalReserves,
        capitalForNewDeals: capacity,
        avgCheckSize: avgCheck,
        dealsRemaining: dealsRemaining
      }
    };
  }

  // Baseline = the "budget": no scenario inputs (held at marks, no extra reserves).
  function computeBaseline(baseline) {
    return compute(baseline, { deals: {} });
  }

  // Convenience: baseline + scenario + per-metric deltas for budget-vs-forecast.
  function computeDiff(baseline, scenario) {
    var b = computeBaseline(baseline);
    var f = compute(baseline, scenario);
    function d(path) {
      var bv = path(b), fv = path(f);
      return { budget: bv, forecast: fv, delta: (num(fv) - num(bv)) };
    }
    return {
      budget: b,
      forecast: f,
      deltas: {
        grossMOIC: d(function (x) { return x.metrics.grossMOIC; }),
        netTVPI: d(function (x) { return x.metrics.netTVPI; }),
        netIRR: d(function (x) { return x.metrics.netIRR; }),
        netProceedsLP: d(function (x) { return x.waterfall.netProceedsLP; }),
        gpCarry: d(function (x) { return x.waterfall.gpCarry; }),
        dealsRemaining: d(function (x) { return x.capacity.dealsRemaining; })
      }
    };
  }

  return {
    DEFAULT_TERMS: DEFAULT_TERMS,
    mergeTerms: mergeTerms,
    projectDeal: projectDeal,
    runWaterfall: runWaterfall,
    xirr: xirr,
    compute: compute,
    computeBaseline: computeBaseline,
    computeDiff: computeDiff,
    _util: { num: num, parseDate: parseDate, yearsBetween: yearsBetween }
  };
});
