import { sans, INK, PAPER, LINE, FAINT, MICRO, GREEN, RED, BORDER_DEFAULT, FS } from "../../ui/theme.js";
import { Tag, Eyebrow } from "../../ui/components.jsx";
import { fmtCurrencyExact, fmtCurrencyShort } from "../../charts/chartTheme.js";

// Follows the carta-budget-analysis drill-down-line pattern:
// - Variance stats (actual vs budget, absolute $ diff, % diff, status pill)
// - Pacing bar (visual actual/budget)
// - Programmatic narrative — 2-3 sentences on the driver
// - Vendor concentration summary
//
// Renders only when we have a budget line for this account (from
// snapshot.spendByGL). Otherwise the drill-down falls back to plain
// summary stats.
export default function BudgetInsight({ account, agg, budgetLine, monthsElapsed = 7 }) {
  if (!budgetLine || !budgetLine.budget) return null;

  const actual = Math.abs(agg?.total ?? 0);
  const budget = budgetLine.budget;
  const diff   = actual - budget;
  const pctVar = budget ? (diff / budget) * 100 : 0;

  const status = classify(pctVar);
  const insights = buildInsights({ account, agg, actual, budget, diff, pctVar, monthsElapsed });

  return (
    <div>
      <Eyebrow style={{ marginBottom: 8 }}>Budget insight</Eyebrow>

      {/* Stats grid */}
      <div style={S.statsGrid}>
        <Stat label="YTD Actual"   value={fmtCurrencyExact(actual)} />
        <Stat label="YTD Budget"   value={fmtCurrencyExact(budget)} />
        <Stat
          label="Variance"
          value={(diff >= 0 ? "+" : "−") + fmtCurrencyShort(Math.abs(diff), 1)}
          valueColor={diff > 0 ? RED : diff < 0 ? GREEN : INK}
        />
        <Stat
          label="% of budget"
          value={(budget ? (actual / budget) * 100 : 0).toFixed(0) + "%"}
          valueColor={status.color}
        />
      </div>

      {/* Pacing bar */}
      <div style={{ marginTop: 12 }}>
        <PacingBar actual={actual} budget={budget} status={status} />
        <div style={S.pacingLabels}>
          <span style={{ color: MICRO }}>0</span>
          <span style={{ color: MICRO }}>{fmtCurrencyShort(budget, 0)} (budget)</span>
        </div>
      </div>

      {/* Status pill + bulleted insights */}
      <div style={S.insightsWrap}>
        <div style={S.insightsHeader}>
          <Tag tone={status.tone} style={{ fontSize: FS.small }}>
            {status.label}
          </Tag>
        </div>
        <ul style={S.insightsList}>
          {insights.map((it, i) => (
            <li key={i} style={S.insightRow}>
              <span style={{ ...S.insightLabel, color: MICRO }}>{it.label}</span>
              <span style={S.insightValue}>{it.value}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

// -- helpers ---------------------------------------------------------------

// Classify pacing based on variance %.
// Thresholds match common variance-analysis conventions: ±5% = on-track.
function classify(pctVar) {
  if (pctVar > 20)  return { label: "Well over budget", tone: "negative", color: RED };
  if (pctVar > 5)   return { label: "Over budget",     tone: "negative", color: RED };
  if (pctVar < -20) return { label: "Well under budget", tone: "positive", color: GREEN };
  if (pctVar < -5)  return { label: "Under budget",    tone: "positive", color: GREEN };
  return { label: "On pace",                 tone: "neutral",  color: INK };
}

// Structured insights — each entry becomes a labelled row in the drawer.
// Each insight has {label, value} — label is a short caption on the left,
// value is the emphasized figure/text on the right.
function buildInsights({ account, agg, actual, budget, diff, pctVar, monthsElapsed }) {
  const items = [];
  const overBudget  = pctVar > 5;
  const underBudget = pctVar < -5;

  // Direction
  if (overBudget) {
    items.push({
      label: "Variance",
      value: `${fmtCurrencyShort(Math.abs(diff), 1)} (${pctVar.toFixed(0)}%) over YTD budget`,
    });
  } else if (underBudget) {
    items.push({
      label: "Variance",
      value: `${fmtCurrencyShort(Math.abs(diff), 1)} (${Math.abs(pctVar).toFixed(0)}%) under YTD budget`,
    });
  } else {
    items.push({
      label: "Variance",
      value: `On pace (±${Math.abs(pctVar).toFixed(1)}%)`,
    });
  }

  // Vendor concentration — only if top vendor has meaningful share
  const topVendor = agg?.top_vendors?.[0];
  if (topVendor && actual > 0) {
    const share = (topVendor.amount / actual) * 100;
    if (share >= 30) {
      const entryWord = topVendor.count === 1 ? "entry" : "entries";
      items.push({
        label: "Top vendor",
        value: `${topVendor.name} — ${share.toFixed(0)}% (${fmtCurrencyShort(topVendor.amount, 1)}, ${topVendor.count} ${entryWord})`,
      });
    }
  }

  // Sub-account concentration (SUB_ACCOUNT_NAME — office/location/sub-ledger,
  // meaning varies by firm) — same 30%-share threshold as vendor concentration.
  const topSub = agg?.top_subs?.[0];
  if (topSub && actual > 0) {
    const share = (topSub.amount / actual) * 100;
    if (share >= 30) {
      const entryWord = topSub.count === 1 ? "entry" : "entries";
      items.push({
        label: "Top sub-account",
        value: `${topSub.name} — ${share.toFixed(0)}% (${fmtCurrencyShort(topSub.amount, 1)}, ${topSub.count} ${entryWord})`,
      });
    }
  }

  // Single-month spike — read from agg.monthly to find a dominant month
  const monthly = agg?.monthly ?? [];
  const maxMonth = monthly.reduce((m, v, i) => (v > monthly[m] ? i : m), 0);
  const maxVal = monthly[maxMonth] || 0;
  const monthShare = actual > 0 ? (maxVal / actual) * 100 : 0;
  if (monthShare >= 50 && monthly.length > 1) {
    const monthName = ["January","February","March","April","May","June","July"][maxMonth] || `Month ${maxMonth+1}`;
    items.push({
      label: "Timing",
      value: `${monthName} alone represents ${monthShare.toFixed(0)}% of YTD spend`,
    });
  }

  // Run-rate projection for accounts under-pacing
  if (underBudget && monthsElapsed > 0 && monthsElapsed < 12) {
    const projected    = (actual / monthsElapsed) * 12;
    const annualBudget = budget * (12 / monthsElapsed);
    if (projected < annualBudget * 0.85) {
      items.push({
        label: "Run rate",
        value: `Projecting ~${fmtCurrencyShort(projected, 1)} annual vs ~${fmtCurrencyShort(annualBudget, 1)} implied budget`,
      });
    }
  }

  return items;
}

function Stat({ label, value, valueColor }) {
  return (
    <div style={S.stat}>
      <div style={{ ...S.statLabel, color: MICRO }}>{label}</div>
      <div style={{ ...S.statValue, color: valueColor || INK }}>{value}</div>
    </div>
  );
}

function PacingBar({ actual, budget, status }) {
  const overshoot = actual > budget;
  const pctFill = budget > 0 ? Math.min(actual / budget, 1) * 100 : 0;
  const overFill = overshoot && budget > 0 ? Math.min((actual - budget) / budget, 0.5) * 100 : 0;
  return (
    <div style={S.pacingTrack}>
      <div
        style={{
          ...S.pacingFill,
          width: `${pctFill}%`,
          background: status.color,
        }}
      />
      {overshoot && (
        <div
          style={{
            ...S.pacingOverFill,
            width: `${overFill}%`,
            background: RED,
          }}
        />
      )}
    </div>
  );
}

const S = {
  statsGrid: {
    ...sans,
    display: "grid",
    gridTemplateColumns: "repeat(4, 1fr)",
    gap: 10,
    padding: "10px 0",
  },
  stat: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
  },
  // 9px snapped to FS.micro (10) — a 1px-off near-duplicate of the shared
  // micro-caption scale, not a deliberate sub-micro size.
  statLabel: {
    fontSize: FS.micro,
    fontWeight: 600,
    letterSpacing: "0.06em",
    textTransform: "uppercase",
  },
  // Snapped from an off-scale 15px to FS.h3 (16px, Ink's heading-3/4 step) —
  // the nearest Ink step, confirmed not a deliberate choice. Weight capped at
  // 600 (Ink's max — was 700, which no Ink text style ever uses).
  statValue: {
    fontSize: FS.h3,
    fontWeight: 600,
    fontVariantNumeric: "tabular-nums",
    whiteSpace: "nowrap",
  },
  pacingTrack: {
    position: "relative",
    width: "100%",
    height: 8,
    borderRadius: 4,
    background: LINE,
    overflow: "hidden",
  },
  pacingFill: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    transition: "width 300ms ease",
  },
  pacingOverFill: {
    position: "absolute",
    left: "100%",
    top: 0,
    bottom: 0,
    transition: "width 300ms ease",
  },
  pacingLabels: {
    ...sans,
    display: "flex",
    justifyContent: "space-between",
    fontSize: FS.micro,
    marginTop: 4,
    fontVariantNumeric: "tabular-nums",
  },
  insightsWrap: {
    ...sans,
    marginTop: 12,
    padding: "12px 14px",
    background: PAPER,
    border: `1px solid ${LINE}`,
    borderRadius: 4,
  },
  insightsHeader: {
    marginBottom: 10,
  },
  insightsList: {
    listStyle: "none",
    margin: 0,
    padding: 0,
    display: "flex",
    flexDirection: "column",
    gap: 8,
  },
  insightRow: {
    display: "grid",
    gridTemplateColumns: "80px 1fr",
    gap: 12,
    alignItems: "baseline",
    fontSize: FS.bodyLg,
    lineHeight: 1.4,
  },
  insightLabel: {
    fontSize: FS.micro,
    fontWeight: 600,
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    whiteSpace: "nowrap",
  },
  insightValue: {
    color: INK,
    fontVariantNumeric: "tabular-nums",
    wordBreak: "break-word",
  },
};
