import { GREEN, RED, FAINT } from "./theme.js";
import { fmtCurrencyShort, fmtCurrencyWhole } from "../charts/chartTheme.js";

// Budget-vs-actuals variance presentation, shared by the two BvA tables and
// the drill-down drawer.
//
// It lives in one place because the sign rule is the easy thing to get
// subtly wrong: the drawer opens off a table cell, so if it read the sign
// its own way a reader could see the same variance called favourable in the
// table and unfavourable two inches to the right.

// Colour for a variance figure. Direction depends on which side of the P&L
// the row sits on: beating an expense budget is good, missing an income one
// is not. Reading both the same way renders a revenue shortfall as
// favourable.
// Zero is what the reader is shown as zero, not what the float holds. Fee
// arithmetic lands cents off, and a column of ties printed "$0" in three
// colours: grey, red for a shortfall of 29 cents, green for a penny over.
function displaysAsZero(variance, decimals) {
  return fmtCurrencyShort(Math.abs(Number(variance) || 0), decimals)
      === fmtCurrencyShort(0, decimals);
}

export function varianceColor(variance, polarity = "expense", decimals) {
  if (displaysAsZero(variance, decimals)) return FAINT;
  const favourable = polarity === "income" ? variance > 0 : variance < 0;
  return favourable ? GREEN : RED;
}

// Which side of the P&L an outline row sits on. The dept crosstab's rows
// carry an explicit `polarity` from the adapter; the outline's don't, so it
// is inferred from the workbook's own section and label text.
export function rowPolarity(row) {
  const income = /\b(income|revenue)\b/i.test(row?.section || "")
                 || /^net\s+(income|profit|loss)\b/i.test(row?.label || "");
  return income ? "income" : "expense";
}

// The variance figure itself. Over budget reads as a bare magnitude, under
// budget in parentheses — the sign is direction, not favourability, which
// the colour carries.
export function fmtVariance(variance, decimals) {
  if (displaysAsZero(variance, decimals)) return fmtCurrencyShort(0, decimals);
  const magnitude = fmtCurrencyShort(Math.abs(variance), decimals);
  return variance > 0 ? magnitude : `(${magnitude})`;
}

// Same rule, to the dollar — Budget vs Actuals and the drawer it opens.
export function fmtVarianceWhole(variance) {
  if (displaysAsZero(variance)) return fmtCurrencyWhole(0);
  const magnitude = fmtCurrencyWhole(Math.abs(variance));
  return variance > 0 ? magnitude : `(${magnitude})`;
}
