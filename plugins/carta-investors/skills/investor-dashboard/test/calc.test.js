/* Headless unit checks for calc.js — run: node test/calc.test.js */
var assert = require('assert');
var fs = require('fs');
var path = require('path');
var Calc = require('../web/js/calc.js');

var baseline = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'baseline.json'), 'utf8'));

var failures = 0;
function check(name, fn) {
  try { fn(); console.log('  ok  - ' + name); }
  catch (e) { failures++; console.log('  FAIL- ' + name + '\n        ' + e.message); }
}
function approx(a, b, tol) { return Math.abs(a - b) <= (tol === undefined ? 1e-6 : tol); }

console.log('calc.js unit checks');

// 1. Waterfall tiers sum to distributable; LP+GP = distributable.
check('waterfall tiers sum to distributable and LP+GP split is exact', function () {
  var terms = Calc.mergeTerms(baseline.terms, {});
  var wf = Calc.runWaterfall(100000000, 60000000, terms, 5);
  var t = wf.tiers;
  var sumTiers = t.returnOfCapital + t.preferredReturn + t.gpCatchUp + t.gpSplit + t.lpSplit;
  assert(approx(sumTiers, 100000000, 1e-3), 'tiers sum ' + sumTiers);
  assert(approx(wf.netProceedsLP + wf.netProceedsGP, 100000000, 1e-3), 'LP+GP ' + (wf.netProceedsLP + wf.netProceedsGP));
});

// 2. Below return-of-capital: no carry, all to partners pro-rata.
check('no carry when distributable < contributed', function () {
  var terms = Calc.mergeTerms(baseline.terms, {});
  var wf = Calc.runWaterfall(40000000, 60000000, terms, 5);
  assert(approx(wf.gpCarry, 0), 'gpCarry should be 0, got ' + wf.gpCarry);
  assert(approx(wf.tiers.returnOfCapital, 40000000), 'roc');
});

// 3. Full catch-up: after catch-up + split, GP promote ~= carry% of profit above ROC.
check('GP promote approximates carry% of profit above return of capital', function () {
  var terms = Calc.mergeTerms({ carryPct: 0.2, hurdlePct: 0.08, gpCommitPct: 0, catchUp: true }, {});
  var contributed = 50000000, distributable = 150000000;
  var wf = Calc.runWaterfall(distributable, contributed, terms, 5);
  var profitAboveRoc = distributable - wf.tiers.returnOfCapital; // pref+catchup+splits
  assert(approx(wf.gpCarry / profitAboveRoc, 0.2, 1e-6), 'promote share = ' + (wf.gpCarry / profitAboveRoc));
});

// 4. XIRR solves a known series (~ -100 now, +120 in 1 year => 20%).
check('xirr converges on a known 20% series', function () {
  var irr = Calc.xirr([{ date: '2024-01-01', amount: -100 }, { date: '2025-01-01', amount: 120 }]);
  assert(irr !== null && approx(irr, 0.20, 1e-3), 'irr=' + irr);
});

// 5. Baseline compute: gross MOIC = totalValue/totalInvested, identity holds.
check('baseline compute identities', function () {
  var b = Calc.computeBaseline(baseline);
  var expGross = b.totals.totalValue / b.totals.totalInvested;
  assert(approx(b.metrics.grossMOIC, expGross), 'grossMOIC');
  assert(b.metrics.netTVPI > 0, 'netTVPI positive');
  assert(b.capacity.dealsRemaining >= 0, 'deals >= 0');
});

// 6. Deals remaining drops as reserves are added.
check('deals remaining decreases with follow-on reserves', function () {
  var b = Calc.computeBaseline(baseline);
  var f = Calc.compute(baseline, { deals: { d2: { followOnReserve: 10000000 } } });
  assert(f.capacity.dealsRemaining < b.capacity.dealsRemaining, 'expected fewer deals: base ' + b.capacity.dealsRemaining + ' vs ' + f.capacity.dealsRemaining);
  assert(approx(f.capacity.capitalForNewDeals, b.capacity.dryPowder - 10000000), 'capacity');
});

// 7. A large exit (clearing return-of-capital + hurdle) raises gross MOIC, net TVPI, and triggers carry.
check('big exit increases gross MOIC/net TVPI and generates GP carry', function () {
  // d1 at 8% ownership exiting at $1B => $80M proceeds, pushing the fund well above contributed+pref.
  var diff = Calc.computeDiff(baseline, { deals: { d1: { exitValuation: 1000000000, exitDate: '2027-06-01' } } });
  assert(diff.deltas.grossMOIC.delta > 0, 'gross MOIC delta ' + diff.deltas.grossMOIC.delta);
  assert(diff.deltas.netTVPI.delta > 0, 'net TVPI delta ' + diff.deltas.netTVPI.delta);
  assert(diff.deltas.gpCarry.delta > 0, 'gp carry delta ' + diff.deltas.gpCarry.delta);
  // sanity: baseline (underwater vs contributed) has zero carry
  assert(diff.budget.waterfall.gpCarry === 0, 'baseline carry should be 0, got ' + diff.budget.waterfall.gpCarry);
});

console.log(failures === 0 ? '\nALL PASSED' : '\n' + failures + ' FAILED');
process.exit(failures === 0 ? 0 : 1);
