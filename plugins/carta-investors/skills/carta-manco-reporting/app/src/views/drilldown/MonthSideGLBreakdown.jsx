import { useState } from "react";
import { sans, INK, PAPER, LINE, FAINT, MICRO, BORDER_DEFAULT, BLUE, FS } from "../../ui/theme.js";
import { ChartTitle } from "../../ui/components.jsx";
import { fmtCurrencyExact } from "../../charts/chartTheme.js";
import { trackClick } from "../../analytics.js";

// GL-account rollup for the month-side drill (Monthly Cashflow chart).
// Summed by GL account, sorted desc, with a chevron toggle for the tail.
// Rows are display-only — the journal-entry table below the drill already
// shows per-account detail (each row's Account column), so an in-row click
// to drill into "account × month" was redundant. Previously rendered as a
// button with a → arrow; now static.
const DEFAULT_VISIBLE = 10;

export default function MonthSideGLBreakdown({ rows, sideLabel }) {
  const [expanded, setExpanded] = useState(false);

  const total = rows.reduce((s, r) => s + r.amount, 0);
  const hiddenCount = Math.max(0, rows.length - DEFAULT_VISIBLE);
  const visibleRows = expanded ? rows : rows.slice(0, DEFAULT_VISIBLE);
  const hiddenTotal = rows.slice(DEFAULT_VISIBLE).reduce((s, r) => s + r.amount, 0);

  if (!rows.length) return null;

  return (
    <div>
      <div style={S.headerRow}>
        <ChartTitle>GL account breakdown</ChartTitle>
        <span style={S.headerHint}>{rows.length} account{rows.length === 1 ? "" : "s"}</span>
      </div>

      <div style={S.tableHeader}>
        <span style={S.headerCategory}>Account</span>
        <span style={S.headerAmount}>Amount</span>
        <span style={S.headerPct}>% of {sideLabel || "month"}</span>
      </div>

      <ul style={S.list}>
        {visibleRows.map((r, i) => {
          const pct = total ? (r.amount / total) * 100 : 0;
          const isLast = i === visibleRows.length - 1;
          return (
            <li key={r.name} style={isLast ? { ...S.itemWrap, borderBottom: "none" } : S.itemWrap}>
              <div style={S.itemRow}>
                <span style={S.itemName}>{r.name}</span>
                <span style={S.itemAmount}>{fmtCurrencyExact(r.amount)}</span>
                <span style={S.itemPct}>{pct.toFixed(1)}%</span>
              </div>
            </li>
          );
        })}
      </ul>

      {hiddenCount > 0 && (
        <button
          type="button"
          style={S.toggleBtn}
          onClick={() => { trackClick("MancoReporting.Drilldown.ExpandGLBreakdown"); setExpanded(v => !v); }}
          aria-expanded={expanded}
        >
          <Chevron open={expanded} />
          <span style={S.toggleLabel}>
            {expanded ? "Show fewer accounts" : `Show ${hiddenCount} more`}
          </span>
          {!expanded && (
            <span style={S.toggleMeta}>
              {fmtCurrencyExact(hiddenTotal)} · {((hiddenTotal / total) * 100).toFixed(1)}%
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

const S = {
  headerRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "baseline",
    marginBottom: 8,
  },
  headerHint: {
    ...sans,
    fontSize: FS.micro,
    color: MICRO,
    fontWeight: 500,
  },
  tableHeader: {
    ...sans,
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
    flex: 1,
    minWidth: 0,
  },
  headerAmount: {
    width: 110,
    textAlign: "right",
    fontVariantNumeric: "tabular-nums",
  },
  headerPct: {
    width: 90,
    textAlign: "right",
    fontVariantNumeric: "tabular-nums",
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
  itemRow: {
    ...sans,
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "8px 4px",
    fontSize: FS.bodyLg,
    color: INK,
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
    width: 90,
    textAlign: "right",
    fontVariantNumeric: "tabular-nums",
    color: FAINT,
    fontWeight: 400,
    whiteSpace: "nowrap",
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
