// Ink's data-viz sequence (Ink's charts.md): tint-3 hues, then
// positive/negative. Index 8 ("Other") has no data-viz token, so it stays
// a literal hex — matches MonthlyExpenseBreakdown.jsx's TAIL_DOT_COLOR.
export const CATEGORICAL_COLORS = [
  "var(--ink-color-global-data-viz-blue-3)",
  "var(--ink-color-global-data-viz-turquoise-3)",
  "var(--ink-color-global-data-viz-brown-3)",
  "var(--ink-color-global-data-viz-yellow-3)",
  "var(--ink-color-global-data-viz-lime-3)",
  "var(--ink-color-global-data-viz-positive-3)",
  "var(--ink-color-global-data-viz-negative-3)",
  "var(--ink-color-global-brand-blue-40)",
  "#c3c2b7",
];

/** Colors `items` by position in this list. Call it AFTER dropping any
 *  zero-data candidates — coloring by a pre-filter index instead can bump
 *  a later item onto CATEGORICAL_COLORS' green/red by pure accident. */
export function assignCategoricalColors(items) {
  items.forEach((item, i) => {
    item.color = CATEGORICAL_COLORS[i % CATEGORICAL_COLORS.length];
  });
  return items;
}

/** Colors expense `categories`: entries keep the sequence in order, except
 *  an entry named "Other" always gets the reserved gray slot (index 8)
 *  regardless of its position in the list. Non-Other entries are colored
 *  by raw array index, so "Other" must be the last element when present —
 *  callers must not reorder `categories` before calling this. */
export function assignExpenseCategoryColors(categories) {
  categories.forEach((c, i) => {
    c.color = c.name === "Other" ? CATEGORICAL_COLORS[8] : CATEGORICAL_COLORS[i];
  });
  return categories;
}
