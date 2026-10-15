import { ownShare } from "../reports/reportState.js";

// The report a budget shows. The live listing wins over the snapshot's copy: it
// moves the moment a share settles, before the rebuilt snapshot lands.
export const reportFor = (budget, reportsApi) =>
  (reportsApi && budget?.id && reportsApi.byId(budget.id)) || budget?.report || null;

// The Budget vs Actuals sidebar entries: your own reports under the group, the ones
// others shared with you for its "Shared with you" section. Report data counts only
// while the server offers reports; otherwise every budget is a plain entry, as
// without reports at all.
export function budgetNavChildren(budgets, reportsApi) {
  const reportOf = (b) => (reportsApi?.available ? reportFor(b, reportsApi) : null);
  const own = budgets.filter(b => !reportOf(b)?.read_only)
    .map(b => {
      const own = ownShare(reportOf(b));
      return { slug: b.id, label: b.label || b.id, shared: !!own, unshared: !!own?.dirty };
    });
  const sharedWithYou = budgets.filter(b => reportOf(b)?.read_only)
    .map(b => ({ slug: b.id, label: b.label || b.id }));
  return { own, sharedWithYou };
}
