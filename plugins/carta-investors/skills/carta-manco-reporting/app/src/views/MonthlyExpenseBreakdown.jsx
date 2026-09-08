import { useEffect, useMemo, useState } from "react";
import { sans, INK, PAPER, LINE, FAINT, MICRO, BORDER_DEFAULT, BLUE, FS } from "../ui/theme.js";
import { Eyebrow } from "../ui/components.jsx";
import { fmtCurrencyExact } from "../charts/chartTheme.js";
import { trackClick } from "../analytics.js";

const DEFAULT_VISIBLE = 10;

// Neutral gray dot for accounts that aren't in the top-8 chart categories.
const TAIL_DOT_COLOR = "#c3c2b7";

// Interactive companion to the Monthly Expenses by Category chart.
// Aggregates ALL expense entries within `dateRange = {start, end}` (ISO dates)
// grouped by account. Row click opens the drilldown drawer scoped to the
// same date range + category.
export default function MonthlyExpenseBreakdown({
  monthlyCategories,
  accountsData,
  onSelect,
  dateRange,
}) {
  // Map top-8 category names → their chart colors so we can reuse them
  // as row dots for the biggest accounts. Everything else gets the neutral
  // tail-color, matching the "Other" segment in the chart above.
  const colorMap = useMemo(() => {
    const m = new Map();
    for (const c of (monthlyCategories?.categories || [])) {
      if (c.name !== "Other") m.set(c.name, c.color);
    }
    return m;
  }, [monthlyCategories]);

  // Aggregate expense entries within the date range by account.
  const rows = useMemo(() => {
    if (!dateRange?.start || !dateRange?.end) return [];
    const entries = accountsData?.entries || [];
    const totals = new Map();
    for (const e of entries) {
      if (e.kind !== "expense") continue;
      if (e.date < dateRange.start || e.date > dateRange.end) continue;
      totals.set(e.account, (totals.get(e.account) || 0) + e.amount);
    }
    return [...totals.entries()]
      .filter(([, amt]) => amt !== 0)
      .map(([name, amount]) => ({
        name,
        amount,
        color: colorMap.get(name) || TAIL_DOT_COLOR,
        isTopCategory: colorMap.has(name),
      }))
      .sort((a, b) => b.amount - a.amount);
  }, [accountsData, dateRange, colorMap]);

  const rangeTotal = rows.reduce((s, r) => s + r.amount, 0);
  const rangeLabel = formatRangeLabel(dateRange);

  // Collapse the long tail by default — top 10 rows, then "Show N more".
  // Reset back to collapsed whenever the range changes so switching to a
  // narrower period doesn't leave the user staring at a giant expanded list.
  const [expanded, setExpanded] = useState(false);
  useEffect(() => { setExpanded(false); }, [dateRange?.start, dateRange?.end]);

  const hiddenCount = Math.max(0, rows.length - DEFAULT_VISIBLE);
  const visibleRows = expanded ? rows : rows.slice(0, DEFAULT_VISIBLE);
  const hiddenTotal = rows.slice(DEFAULT_VISIBLE).reduce((s, r) => s + r.amount, 0);

  return (
    <div style={S.wrap}>
      {/* Breakdown eyebrow + total for the current range */}
      <div style={S.controlsRow}>
        <Eyebrow>Break down · {rangeLabel}</Eyebrow>
        <span style={S.totalLabel}>
          <span style={{ color: MICRO }}>Total</span>
          <span style={S.totalValue}>{fmtCurrencyExact(rangeTotal)}</span>
        </span>
      </div>

      {/* Column header for the rows */}
      <div style={S.tableHeader}>
        <span style={S.headerCategory}>Category</span>
        <span style={S.headerAmount}>Amount</span>
        <span style={S.headerPct}>% of range</span>
        <span style={S.headerArrow} aria-hidden="true" />
      </div>

      {/* Category rows */}
      <ul style={S.list}>
        {visibleRows.map((r) => {
          const pct = rangeTotal ? (r.amount / rangeTotal) * 100 : 0;
          return (
            <li key={r.name} style={S.itemWrap}>
              <button
                style={S.itemBtn}
                onClick={() => { trackClick("MancoReporting.Dashboard.SelectExpenseCategory"); onSelect?.({ category: r.name }); }}
                title={`Drill into ${r.name} — ${rangeLabel}`}
              >
                <span style={{ ...S.dot, background: r.color }} />
                <span style={S.itemName}>{r.name}</span>
                <span style={S.itemAmount}>{fmtCurrencyExact(r.amount)}</span>
                <span style={S.itemPct}>{pct.toFixed(1)}%</span>
                <span style={S.itemArrow}>→</span>
              </button>
            </li>
          );
        })}
        {rows.length === 0 && (
          <li style={{ ...sans, fontSize: FS.body, color: MICRO, padding: "8px 0" }}>
            No expenses recorded for {rangeLabel}.
          </li>
        )}
      </ul>

      {hiddenCount > 0 && (
        <button
          type="button"
          style={S.toggleBtn}
          onClick={() => { trackClick("MancoReporting.Dashboard.ExpandExpenseCategory"); setExpanded(v => !v); }}
          aria-expanded={expanded}
        >
          <Chevron open={expanded} />
          <span style={S.toggleLabel}>
            {expanded
              ? "Show fewer categories"
              : `Show ${hiddenCount} more`}
          </span>
          {!expanded && (
            <span style={S.toggleMeta}>
              {fmtCurrencyExact(hiddenTotal)} · {((hiddenTotal / rangeTotal) * 100).toFixed(1)}%
            </span>
          )}
        </button>
      )}
    </div>
  );
}

function Chevron({ open }) {
  return (
    <svg
      width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"
      style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform 120ms ease", flexShrink: 0 }}
    >
      <path d="M2 3.5 L5 6.5 L8 3.5" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// Human-friendly summary of the current date range. Uses "Month YYYY" when
// the range covers exactly one calendar month, otherwise compact "MMM D – MMM D, YYYY".
function formatRangeLabel(dr) {
  if (!dr?.start || !dr?.end) return "";
  const [sy, sm, sd] = dr.start.split("-").map(Number);
  const [ey, em, ed] = dr.end.split("-").map(Number);
  const monthNames = ["January","February","March","April","May","June",
                      "July","August","September","October","November","December"];
  const abbr = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const lastDay = new Date(sy, sm, 0).getDate();
  if (sy === ey && sm === em && sd === 1 && ed === lastDay) {
    return `${monthNames[sm - 1]} ${sy}`;
  }
  return `${abbr[sm - 1]} ${sd} – ${abbr[em - 1]} ${ed}, ${ey}`;
}

const S = {
  wrap: {
    ...sans,
    marginTop: 20,
    paddingTop: 16,
    borderTop: `1px solid ${LINE}`,
    color: INK,
  },
  controlsRow: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    flexWrap: "wrap",
    marginBottom: 12,
  },
  totalLabel: {
    ...sans,
    marginLeft: "auto",
    display: "inline-flex",
    alignItems: "baseline",
    gap: 8,
    fontSize: FS.small,
    fontWeight: 600,
    letterSpacing: "0.06em",
    textTransform: "uppercase",
  },
  totalValue: {
    color: INK,
    fontSize: FS.value,
    fontVariantNumeric: "tabular-nums",
    letterSpacing: "normal",
    textTransform: "none",
    fontWeight: 600, // Ink's type scale never exceeds weight 600 (was 700)
  },
  tableHeader: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "6px 4px",
    borderBottom: `1px solid ${BORDER_DEFAULT}`,
    fontSize: FS.small,
    fontWeight: 500,
    color: INK,
  },
  headerCategory: {
    marginLeft: 20,
    flex: 1,
    minWidth: 0,
  },
  headerAmount: {
    width: 110,
    textAlign: "right",
    fontVariantNumeric: "tabular-nums",
  },
  headerPct: {
    width: 72,
    textAlign: "right",
    fontVariantNumeric: "tabular-nums",
  },
  headerArrow: {
    width: 18,
  },
  list: {
    listStyle: "none",
    margin: 0,
    padding: 0,
    background: PAPER,
  },
  itemWrap: {
    borderBottom: `1px solid ${LINE}`,
  },
  itemBtn: {
    ...sans,
    display: "flex",
    alignItems: "center",
    gap: 10,
    width: "100%",
    padding: "8px 4px",
    background: "transparent",
    border: "none",
    cursor: "pointer",
    fontSize: FS.bodyLg,
    color: INK,
    textAlign: "left",
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 2,
    flexShrink: 0,
  },
  itemName: {
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    color: INK,
  },
  itemAmount: {
    width: 110,
    textAlign: "right",
    fontVariantNumeric: "tabular-nums",
    fontWeight: 500,
    color: INK,
    whiteSpace: "nowrap",
  },
  itemPct: {
    width: 72,
    textAlign: "right",
    fontVariantNumeric: "tabular-nums",
    color: FAINT,
    fontWeight: 400,
    whiteSpace: "nowrap",
  },
  itemArrow: {
    width: 18,
    textAlign: "right",
    color: BLUE,
    fontSize: FS.value,
  },
  toggleBtn: {
    ...sans,
    display: "flex",
    alignItems: "center",
    gap: 8,
    width: "100%",
    padding: "10px 4px",
    marginTop: 2,
    background: "transparent",
    border: "none",
    borderTop: `1px solid ${LINE}`,
    cursor: "pointer",
    color: BLUE,
    fontSize: FS.body,
    fontWeight: 500,
    textAlign: "left",
  },
  toggleLabel: {
    color: BLUE,
    fontWeight: 500,
  },
  toggleMeta: {
    marginLeft: "auto",
    color: MICRO,
    fontVariantNumeric: "tabular-nums",
    fontWeight: 400,
  },
};
