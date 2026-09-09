import { useCallback, useState } from "react";

// Ephemeral drill-down selection state. `selection` is null (closed) or one of:
//   { kind: "account", name: "Software" }
//   { kind: "month-side", month: 4, side: "expense" | "income" }
export default function useDrilldown() {
  const [selection, setSelection] = useState(null);

  // `context` carries the row's own budget when the drill starts from a
  // budget table. Without it the drawer falls back to looking the account
  // up in the top-10 spend list, so anything outside it loses its budget.
  // `context` may narrow the account: `months` to the column that was
  // clicked, `childScope` to one value of a breakout beneath the row.
  // Neither is required — the dashboard opens a whole account with neither.
  const openAccount = useCallback((name, context) => {
    setSelection({ kind: "account", name, ...(context || {}) });
  }, []);

  const openVendor = useCallback((vendor) => {
    setSelection({ kind: "vendor", vendor });
  }, []);

  // For the breakdown pane driven by DateRangeControls. `start`/`end` are
  // ISO YYYY-MM-DD strings (inclusive on both ends).
  const openDateRangeCategory = useCallback((start, end, category, color) => {
    setSelection({ kind: "date-range-category", start, end, category, color });
  }, []);

  const openMonthSide = useCallback((month, side) => {
    setSelection({ kind: "month-side", month, side });
  }, []);

  // `extra` carries projected-bar metadata: isProjected, projectedAmounts, committedCapital.
  const openFundYear = useCallback((fund, yearLabel, extra = {}) => {
    setSelection({ kind: "fund-year", fund, yearLabel, ...extra });
  }, []);

  // For the Budget-vs-Actuals crosstab. `dept` is the workbook's dept label
  // (matched against REPORTING_TAGS_JSON.Department on JE rows). `account`
  // is the workbook's account_name (for the drawer title) and `accountType`
  // is the primary GL code — plus `accountTypeAll` for multi-GL rows like
  // "4170, 4175" so the drill sums across all matching Carta codes.
  // dept === "Firm Total" skips the tag filter (matches all entries by acct_type).
  // `cell` carries the figures the clicked cell was showing —
  // { budget, actual, polarity, unmapped }. The click came off a
  // budget-vs-actuals comparison, so the drawer has to be able to restate
  // that comparison rather than only the actual side of it, and it restates
  // the table's own numbers instead of recomputing them.
  const openTagValueAccount = useCallback((tagValue, account, accountType, accountTypeAll, comment, cartaTags, cell, period, origin, excludedClaims, dimension, scopes) => {
    setSelection({
      kind: "department-account",
      tag_value: tagValue, account,
      // Where the click came from. The Budget vs Actuals page clicks a real
      // (department × account) cell; the variance chart clicks a budget
      // category with no department at all and passes the Firm Total
      // sentinel. Same filtering, different thing to call it.
      origin: origin || "department-cell",
      // The months the budget covers, so the entry list matches the cell
      // that was clicked. Without it the drawer shows spend the cell
      // deliberately excluded and the totals disagree on screen.
      period: period || null,
      accountType,
      accountTypeAll: accountTypeAll || (accountType != null ? [accountType] : []),
      // Which Carta REPORTING_TAGS_JSON.Department values map to this
      // workbook dept. Coa-mapping-derived (e.g. workbook "Founder
      // Services" → ["GAP"]); falls back to [dept] for identity when
      // no mapping is present. Empty [] means "no tag filter — sum all
      // entries" (Firm Total's semantic).
      cartaTags: Array.isArray(cartaTags) ? cartaTags
                 : (tagValue === "Firm Total" ? [] : [tagValue]),
      // What else the line states — a sub-account, a vendor. The tag half
      // travels as cartaTags above, which predates these.
      scopes: scopes || null,
      // Which dimension the tag values above belong to. Without it the
      // reader that resolves a value returns nothing and the tag filter
      // matches no entry at all — invisible while every caller passed the
      // Firm Total sentinel, because an empty tag list never asks.
      dimension: dimension || null,
      // Spend a line beside this one reports, which the figure that was
      // clicked already leaves out. Same rule, so the list adds up to the
      // bar rather than to a wider question nobody asked.
      excludedClaims: excludedClaims || null,
      // Optional workbook Comments-column text. Displayed as context in
      // the drawer so users see WHY a budget was set to a given amount.
      comment: comment || null,
      ...budgetSide(cell),
    });
  }, []);

  // For the Budget-vs-Actuals outline view (client's own P&L, see
  // BudgetActualsOutline). A cell is (row × quarter); the row carries
  // whichever join hint applies:
  //   glCodes + cartaTags → ManCo JEs at those GLs, scoped by Department tag
  //   glCodes alone       → ManCo JEs at those GLs, firm-wide
  //   fundMatch           → fund-side management-fee JEs for that fund
  // `quarter` is "Q1".."Q4" or "Total" (no month constraint).
  // `comment` is the workbook's own Comments-column text for the row —
  // the budget rationale, surfaced in the drawer.
  const openOutlineCell = useCallback((opts) => {
    setSelection({
      kind: "outline-cell",
      // Which cell the table should hold lit. A label is not an identity:
      // one workbook names the same fund in two sections.
      cellKey:   opts.cellKey || null,
      label:     opts.label,
      quarter:   opts.quarter || "Total",
      glCodes:   opts.glCodes || [],
      cartaTags: opts.cartaTags || null,   // null = firm-wide, no tag filter
      // What else narrows the row — a sub-account, a vendor. Dropping it
      // here showed a whole account's entries behind a slice of it.
      scopes:    opts.scopes || null,
      // Values another line reports. The row's own figure leaves them out,
      // so a drawer that kept them would contradict the cell it opened from.
      excludedClaims: opts.excludedClaims || null,
      fundMatch: opts.fundMatch || null,
      // A breakout row under the line — one value of one dimension, on top
      // of everything the line itself is filtered by.
      childScope: opts.childScope || null,
      comment:   opts.comment || null,
      tag_value: opts.tag_value || null,
      dimension: opts.dimension || null,
      periodYear: opts.periodYear || null,
      ...budgetSide(opts),
    });
  }, []);

  const close = useCallback(() => setSelection(null), []);

  // A subtotal or total: the lines it sums, each carrying the same fields a
  // single cell would. The drawer unions them rather than inventing a
  // filter of its own, so what it shows is exactly what was added up.
  const openOutlineTotal = useCallback((opts) => {
    setSelection({
      kind: "outline-total",
      cellKey:    opts.cellKey || null,
      label:      opts.label,
      quarter:    opts.quarter || "Total",
      members:    opts.members || [],
      dimension:  opts.dimension || null,
      periodYear: opts.periodYear || null,
      comment:    opts.comment || null,
      ...budgetSide(opts),
    });
  }, []);

  return { selection, openOutlineTotal, openAccount, openVendor, openDateRangeCategory, openMonthSide, openFundYear, openTagValueAccount, openOutlineCell, close };
}

// The budget half of a budget-vs-actuals cell, normalized onto the
// selection. `budget: null` is the signal the drawer reads to decide
// whether a comparison exists at all — drill kinds outside these two have
// no budget concept and must not sprout empty stat blocks. `unmapped` says
// the row has no Carta GL behind it: there is a budget to show but no
// actual, and subtracting one from a zero we don't have would print a
// variance equal to the whole budget.
function budgetSide(cell) {
  return {
    budget:   typeof cell?.budget === "number" ? cell.budget : null,
    actual:   typeof cell?.actual === "number" ? cell.actual : null,
    polarity: cell?.polarity === "income" ? "income" : "expense",
    unmapped: !!cell?.unmapped,
    // Present only when the workbook states a time axis (quarter or month).
    // Absent for a YTD-snapshot budget, charted as a pace reference instead.
    quarterlyBudget: Array.isArray(cell?.quarterlyBudget) ? cell.quarterlyBudget : null,
    monthlyBudget: Array.isArray(cell?.monthlyBudget) ? cell.monthlyBudget : null,
  };
}
