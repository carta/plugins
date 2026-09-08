import { useEffect, useMemo, useState } from "react";
import { sans, INK, LINE, FAINT, MICRO, BLUE, FS } from "../ui/theme.js";
import { LEDGER_BASE } from "../ui/table.jsx";
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

  const openCategory = (name) => {
    trackClick("MancoReporting.Dashboard.SelectExpenseCategory");
    onSelect?.({ category: name });
  };

  return (
    <div style={S.wrap}>
      {/* DateRangeControls above already shows the picked range. */}
      <div style={S.controlsRow}>
        <span style={S.totalRow}>
          <span style={S.totalLabel}>Total</span>
          <span style={S.totalValue}>{fmtCurrencyExact(rangeTotal)}</span>
        </span>
      </div>

      <table className="ledger sheet" style={LEDGER_BASE}>
        <thead>
          <tr>
            <th style={S.thCategory}>Category</th>
            <th style={S.thNum}>Amount</th>
            <th style={S.thNum}>% of range</th>
            <th style={S.thArrow} aria-hidden="true" />
          </tr>
        </thead>
        <tbody>
          {visibleRows.map((r) => {
            const pct = rangeTotal ? (r.amount / rangeTotal) * 100 : 0;
            return (
              <tr
                key={r.name}
                style={S.row}
                tabIndex={0}
                role="button"
                title={`Drill into ${r.name} — ${rangeLabel}`}
                onClick={() => openCategory(r.name)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openCategory(r.name); } }}
              >
                <td>
                  <span style={S.tdCategory}>
                    <span style={{ ...S.dot, background: r.color }} />
                    <span style={S.itemName}>{r.name}</span>
                  </span>
                </td>
                <td style={S.tdNum}>{fmtCurrencyExact(r.amount)}</td>
                <td style={{ ...S.tdNum, color: FAINT }}>{pct.toFixed(1)}%</td>
                <td style={S.tdArrow}>→</td>
              </tr>
            );
          })}
          {rows.length === 0 && (
            <tr>
              <td colSpan={4} style={{ ...sans, fontSize: FS.body, color: MICRO, padding: "8px 2px" }}>
                No expenses recorded for {rangeLabel}.
              </td>
            </tr>
          )}
        </tbody>
      </table>

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
  totalRow: {
    ...sans,
    marginLeft: "auto",
    display: "inline-flex",
    alignItems: "baseline",
    gap: 8,
  },
  totalLabel: {
    fontSize: FS.body,
    fontWeight: 400,
    color: MICRO,
  },
  totalValue: {
    color: INK,
    fontSize: FS.value,
    fontVariantNumeric: "tabular-nums",
    fontWeight: 600, // Ink's type scale never exceeds weight 600 (was 700)
  },
  thCategory: {
    textAlign: "left",
  },
  thNum: {
    textAlign: "right",
    fontVariantNumeric: "tabular-nums",
  },
  thArrow: {
    width: 18,
  },
  row: {
    cursor: "pointer",
  },
  tdCategory: {
    display: "flex",
    alignItems: "center",
    gap: 10,
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
  tdNum: {
    textAlign: "right",
    fontVariantNumeric: "tabular-nums",
    fontWeight: 500,
    color: INK,
    whiteSpace: "nowrap",
  },
  tdArrow: {
    width: 18,
    textAlign: "right",
    color: BLUE,
    fontSize: FS.value,
  },
  // table.ledger's last row has no border-bottom (theme.js), so this is
  // the only divider between the table and the toggle — not a duplicate.
  toggleBtn: {
    ...sans,
    display: "flex",
    alignItems: "center",
    gap: 8,
    width: "100%",
    padding: "10px 4px",
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
