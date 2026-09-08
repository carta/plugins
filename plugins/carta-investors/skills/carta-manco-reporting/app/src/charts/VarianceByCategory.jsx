import { useState, useMemo } from "react";
import { fmtCurrencyShort } from "./chartTheme.js";
import { InkBarChart, escapeHtml } from "../ui/components.jsx";
import { sans, INK, FAINT, MICRO, GREEN, RED, LINE, SHADE, PAPER, BORDER_DEFAULT, FS } from "../ui/theme.js";
import { trackClick } from "../analytics.js";

// Budget categories ranked by how far actuals ran from plan.
//
// Keyed on the firm's OWN budget categories, not Carta's GL account names.
// The two vocabularies barely overlap — a workbook says "Gross Wages and
// Salaries" where Carta says "Salaries and benefits" — so the join runs on
// GL codes, which both sides carry. That is the same join the Budget vs
// Actuals page uses, and it is why this chart can show a budget at all where
// the GL-keyed spend chart showed almost none.
//
// Expenses only. "Overspend" and "underspend" are expense words, and income
// variance already appears on the three-bar chart and the BvA page.

const TOP_N = 8;
// Pale neutral for the plan, saturated for what actually happened — the
// same pairing SpendByGL.jsx uses, so the two read consistently.
const BUDGET_BAR = "var(--local-series-blue-pale)";

export default function VarianceByCategory({ varianceByCategory, onSelect, title, sub }) {
  const [side, setSide] = useState("over");

  // A firm can ingest several budgets. Which one this chart used to reflect
  // was a silent consequence of which tab happened to be selected first at
  // ingest, and the choice is not cosmetic: a quarterly budget can be
  // charted over time in the drill-down, a year-to-date snapshot cannot.
  const budgets = varianceByCategory?.budgets || [];
  const [budgetId, setBudgetId] = useState(
    () => varianceByCategory?.default_id || budgets[0]?.id || null);
  const active = budgets.find(b => b.id === budgetId) || budgets[0] || null;

  const { rows, overCount, underCount } = useMemo(() => {
    const all = active?.categories || [];
    const over = all.filter(c => c.variance > 0);
    const under = all.filter(c => c.variance < 0);
    const picked = (side === "over" ? over : under).slice(0, TOP_N);
    return { rows: picked, overCount: over.length, underCount: under.length };
  }, [active, side]);

  // Budget and actual as a pair, not a single variance magnitude — a $238K
  // overrun reads differently against an $892K budget than a $50K one.
  const actualColour = side === "over" ? RED : GREEN;

  const chartEl = rows.length > 0 && (
    <InkBarChart
      id="variance-by-category"
      height={Math.max(240, rows.length * 46 + 60)}
      orientation="horizontal"
      layout="grouped"
      series={[
        { name: "Budget", color: BUDGET_BAR, values: rows.map((r) => r.budget) },
        { name: "Actual", color: actualColour, values: rows.map((r) => r.actual) },
      ]}
      labels={rows.map((r) => r.name)}
      legend
      onSelect={onSelect ? (_seriesIndex, i) => onSelect(rows[i], active?.period || null) : undefined}
      formatValue={fmtCurrencyShort}
      // Both bars share one tooltip carrying the variance, so the reader
      // doesn't have to subtract two hovers in their head.
      renderTooltip={(i) => {
        const r = rows[i];
        const pct = r.budget ? Math.round((r.variance / r.budget) * 100) : null;
        return (
          `<div class="ink-chart__tip-head">${escapeHtml(r.name)}</div>` +
          `<div class="ink-chart__tip-row"><span class="ink-chart__tip-sw" style="background:${BUDGET_BAR}"></span>` +
          `<span class="ink-chart__tip-name">Budget</span><span class="ink-chart__tip-val">${fmtCurrencyShort(r.budget)}</span></div>` +
          `<div class="ink-chart__tip-row"><span class="ink-chart__tip-sw" style="background:${actualColour}"></span>` +
          `<span class="ink-chart__tip-name">Actual</span><span class="ink-chart__tip-val">${fmtCurrencyShort(r.actual)}</span></div>` +
          `<div class="ink-chart__tip-row"><span class="ink-chart__tip-name">` +
          `${r.variance > 0 ? "Over" : "Under"} by ${fmtCurrencyShort(Math.abs(r.variance))}` +
          (pct === null ? "" : ` (${pct > 0 ? "+" : ""}${pct}%)`) +
          `</span></div>`
        );
      }}
      padding={{ top: 8, right: 16, bottom: 28, left: 160 }}
      ariaLabel={`Budget categories ranked by ${side === "over" ? "overspend" : "underspend"}.`}
    />
  );

  if (!active?.categories?.length) return null;

  const ex = active.excluded || {};
  const excludedTotal = (ex.no_gl_mapping || 0) + (ex.no_budget || 0)
                      + (ex.off_book || 0);

  return (
    <>
      {title && (
        budgets.length > 1 ? (
          <div className="ink-chart__header-row">
            <div className="ink-chart__header-text">
              <p className="ink-chart__title">{title}</p>
              {sub && <p className="ink-chart__sub">{sub}</p>}
            </div>
            <div data-export-exclude className="ink-chart__header-control" style={styles.budgetControl}>
              <label style={styles.budgetLabel} htmlFor="variance-budget">Budget</label>
              <select
                id="variance-budget"
                value={active.id}
                onChange={(e) => { trackClick("MancoReporting.Dashboard.VarianceBudgetSelect"); setBudgetId(e.target.value); }}
                style={styles.select}
              >
                {budgets.map(b => (
                  <option key={b.id} value={b.id}>
                    {b.label}{b.budget_period === "monthly" ? " — monthly"
                      : b.budget_period === "quarterly" ? " — quarterly" : " — period total"}
                  </option>
                ))}
              </select>
            </div>
          </div>
        ) : (
          <>
            <p className="ink-chart__title">{title}</p>
            {sub && <p className="ink-chart__sub">{sub}</p>}
          </>
        )
      )}
      {!title && sub && <p className="ink-chart__sub">{sub}</p>}
      {budgets.length > 1 && (
        <p style={styles.budgetHint}>
          {/* The window matters more than the granularity: actuals are
              summed over exactly these months, so a reader comparing this
              against Carta directly knows which period to pull. */}
          Comparing {active.period?.label || "the budget period"}
          {active.budget_period === "monthly"
            ? " · states its budget by month"
            : active.budget_period === "quarterly"
            ? " · states its budget by quarter"
            : " · a single period total"}
        </p>
      )}

      <div style={styles.toggleRow}>
        <div style={styles.toggle} role="group" aria-label="Variance direction">
          <button type="button" onClick={() => { trackClick("MancoReporting.Dashboard.VarianceSideToggle"); setSide("over"); }}
                  style={{ ...styles.toggleBtn, ...(side === "over" ? styles.toggleOn : null) }}>
            Overspend <span style={styles.count}>{overCount}</span>
          </button>
          <button type="button" onClick={() => { trackClick("MancoReporting.Dashboard.VarianceSideToggle"); setSide("under"); }}
                  style={{ ...styles.toggleBtn, ...(side === "under" ? styles.toggleOn : null) }}>
            Underspend <span style={styles.count}>{underCount}</span>
          </button>
        </div>
        {rows.length === TOP_N && (
          <span style={styles.hint}>
            Top {TOP_N} of {side === "over" ? overCount : underCount} by dollar variance
          </span>
        )}
      </div>

      {rows.length === 0 ? (
        <p style={styles.empty}>
          No {side === "over" ? "over" : "under"}spent categories in this budget.
        </p>
      ) : chartEl}

      {/* Say what isn't here. A chart covering 28 of 54 budget lines while
          looking complete invites the reader to assume the rest are on plan. */}
      {excludedTotal > 0 && (
        <p style={styles.excluded}>
          {excludedTotal} budget {excludedTotal === 1 ? "line is" : "lines are"} not shown
          {ex.no_budget ? ` — ${ex.no_budget} carry no budget` : ""}
          {ex.no_budget && ex.no_gl_mapping ? "," : ""}
          {ex.no_gl_mapping ? ` ${ex.no_gl_mapping} have no Carta GL account mapped` : ""}
          {ex.off_book && (ex.no_budget || ex.no_gl_mapping) ? "," : ""}
          {/* Named rather than folded into "no GL account mapped": these
              ARE mapped, to an account this management company does not
              have. A reader who goes looking for the mapping will find one. */}
          {ex.off_book ? ` ${ex.off_book} are mapped to an account outside this entity's ledger` : ""}.
        </p>
      )}
    </>
  );
}

const styles = {
  budgetControl: {
    display: "flex", alignItems: "center", gap: 8,
  },
  budgetLabel: { ...sans, fontSize: FS.small, color: FAINT, fontWeight: 500 },
  select: {
    ...sans, fontSize: FS.body, color: INK, background: PAPER,
    border: `1px solid ${BORDER_DEFAULT}`, borderRadius: 4,
    padding: "5px 8px", cursor: "pointer",
  },
  budgetHint: { ...sans, fontSize: FS.small, color: MICRO, margin: "0 0 10px" },
  toggleRow: {
    display: "flex", alignItems: "center", gap: 12,
    marginBottom: 12, flexWrap: "wrap",
  },
  toggle: { display: "inline-flex", border: `1px solid ${LINE}`, borderRadius: 4, overflow: "hidden" },
  toggleBtn: {
    ...sans, fontSize: FS.body, fontWeight: 500, color: FAINT,
    background: PAPER, border: "none", padding: "6px 12px", cursor: "pointer",
    display: "inline-flex", alignItems: "center", gap: 6,
  },
  // Active is brand-black, not blue — blue is links and focus in this system.
  toggleOn: { background: SHADE, color: INK },
  count: { ...sans, fontSize: FS.micro, color: MICRO, fontVariantNumeric: "tabular-nums" },
  hint: { ...sans, fontSize: FS.small, color: MICRO },
  empty: { ...sans, fontSize: FS.body, color: FAINT, margin: "12px 0" },
  excluded: { ...sans, fontSize: FS.small, color: MICRO, margin: "10px 0 0" },
};
