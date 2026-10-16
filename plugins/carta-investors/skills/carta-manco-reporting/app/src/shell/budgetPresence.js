// Single source of truth for "does this firm have a budget" — shared by
// every nav gate that needs it. A budget counts if it has a department
// crosstab (`by_tag_value`), or it is a by-line-item/by-account budget
// (including a Carta-sourced one, which has no dimension) with rows.
//
// Handles both snapshot shapes: hosted (`snapshot.budget` is `null` with no
// budget) and local (`snapshot.budget.budgets` is `[]`). Never test
// `snapshot.budget` for truthiness directly — see build_manco_datadir.py's
// read_budgets vs. worker.js's buildBudget.
export function renderableBudgets(snapshot) {
  const budgets = snapshot?.budget?.budgets;
  if (!Array.isArray(budgets)) return [];
  return budgets.filter((b) =>
    (Array.isArray(b.by_tag_value) && b.by_tag_value.length > 0)
    || (((b.view_kinds || []).includes("by-line-item")
         || (b.view_kinds || []).includes("by-account"))
        && Array.isArray(b.rows) && b.rows.length > 0));
}

export function hasBudget(snapshot) {
  return renderableBudgets(snapshot).length > 0;
}
