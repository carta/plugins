import { sans, INK, PAPER, LINE, BORDER_DEFAULT, FS } from "./theme.js";
import { TOTAL_ROW_BG } from "./table.jsx";

// The one recipe the three budget tables follow, so their geometry cannot
// drift apart. Rules live on the CELL, never the row: LEDGER_BASE sets
// `borderCollapse: separate`, under which a <tr> border never paints.

// Matches GroupedTableHead's own labelMinWidth default. The label column
// and its header have to agree or the columns sit off their titles.
export const LABEL_MIN_WIDTH = 320;

// The frozen first column. Opaque background is load-bearing: a sticky
// cell inheriting a transparent background lets the figures scroll under it.
export const LEDGER_LABEL = {
  ...sans, fontSize: FS.value, lineHeight: "24px", color: INK,
  padding: "10px 12px", textAlign: "left", whiteSpace: "nowrap",
  minWidth: LABEL_MIN_WIDTH,
  position: "sticky", left: 0, background: PAPER, zIndex: 1,
  borderRight: `1px solid ${LINE}`,
};

// A figure. No borderLeft — the only vertical rule is the frozen column's
// own borderRight.
export const LEDGER_NUM = {
  ...sans, fontSize: FS.value, lineHeight: "24px", color: INK,
  padding: "10px 8px", textAlign: "right", whiteSpace: "nowrap",
  minWidth: 66,
};

// Ink's `.ink-table` gives every row a separator.
export const LEDGER_ROW = { borderBottom: `1px solid ${LINE}` };

// Ink's `.ink-table tr.is-total` wash. The heavier top rule is this
// app's own, marking where a section's detail ends. Weight stays local:
// each table ranks its own tiers.
export const LEDGER_TOTAL = {
  background: TOTAL_ROW_BG,
  borderTop: `1px solid ${BORDER_DEFAULT}`, borderBottom: `1px solid ${LINE}`,
};

// A report's closing line, one notch above a section total.
export const LEDGER_SUMMARY = {
  background: TOTAL_ROW_BG,
  borderTop: `2px solid ${LINE}`, borderBottom: `1px solid ${LINE}`,
};

// A full-width band naming a section. White, not a grey fill — Carta's
// tables mark a header with a bold label and a rule.
export const LEDGER_SECTION = {
  ...sans, fontSize: FS.value, lineHeight: "24px", fontWeight: 600, color: INK,
  padding: "10px 12px", paddingLeft: 0,
  letterSpacing: "0.06em", textTransform: "uppercase", background: PAPER,
  borderTop: `1px solid ${LINE}`, borderBottom: `1px solid ${LINE}`,
};
