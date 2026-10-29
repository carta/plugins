import { ownShare } from "../reports/reportState.js";

// The report a budget shows. The live listing wins over the snapshot's copy: it
// moves the moment a share settles, before the rebuilt snapshot lands.
export const reportFor = (budget, reportsApi) =>
  (reportsApi && budget?.id && reportsApi.byId(budget.id)) || budget?.report || null;

// The two report sections' nav slugs, which their routes start with.
export const BVA = "budget-vs-actuals";
export const CUSTOM_REPORTING = "custom-reporting";

// A saved custom report is a budget whose view carries the pivot it was built with.
export const isCustomReportBudget = (budget) => !!budget?.view?.pivot;

// The sidebar's report entries: your own imported budgets under Budget vs Actuals, your
// own custom reports under Custom Reporting, and the ones others shared with you (either
// kind) for "Shared with you", the group that closes the report sections; their routes
// stay under Budget vs Actuals. Report data counts only while
// the server offers reports; otherwise every budget is a plain entry, as without reports
// at all.
export function budgetNavChildren(budgets, reportsApi) {
  const reportOf = (b) => (reportsApi?.available ? reportFor(b, reportsApi) : null);
  const entry = (b) => {
    const own = ownShare(reportOf(b));
    return { slug: b.id, label: b.label || b.id, shared: !!own, unshared: !!own?.dirty };
  };
  const mine = budgets.filter(b => !reportOf(b)?.read_only);
  const own = mine.filter(b => !isCustomReportBudget(b)).map(entry);
  const customReports = mine.filter(isCustomReportBudget).map(entry);
  const sharedWithYou = budgets.filter(b => reportOf(b)?.read_only)
    .map(b => ({ slug: b.id, label: b.label || b.id }));
  return { own, customReports, sharedWithYou };
}
