import { useEffect, useMemo, useState } from "react";
import Cashflow from "../charts/Cashflow.jsx";
import BudgetVsActuals from "../charts/BudgetVsActuals.jsx";
import FeeIncome from "../charts/FeeIncome.jsx";
import VarianceByCategory from "../charts/VarianceByCategory.jsx";
import SpendByGL from "../charts/SpendByGL.jsx";
import VendorSpend from "../charts/VendorSpend.jsx";
import MonthlyExpensesByCategory from "../charts/MonthlyExpensesByCategory.jsx";
import MonthlyExpenseBreakdown from "./MonthlyExpenseBreakdown.jsx";
import FundSelector from "./FundSelector.jsx";
import FeeYearFilter from "./FeeYearFilter.jsx";
import DateRangeControls from "./DateRangeControls.jsx";
import { fmtCurrencyShort, displayCurrency } from "../charts/chartTheme.js";
import { dimensionOf } from "../ui/dimension.js";
import { Capped } from "../shell/AppShell.jsx";
import { sans, inkNum, INK, PAPER, LINE, FAINT, MICRO, GREEN, RED, FS } from "../ui/theme.js";
import { H2, HoverCard } from "../ui/components.jsx";
import CashDetailCard from "./CashDetailCard.jsx";
import { hasCashDetail } from "../ui/cashDetail.js";
import ExportButton from "../ui/ExportButton.jsx";
import { slugify } from "../ui/exportHtml.js";
import { trackClick } from "../analytics.js";

const DASHBOARD_EXPORT_ID = "manco-export-dashboard";

// KPI summary strip — one bordered card holding all four stats, matching
// carta-fund-modeling's MetricBar/StatBar "Summary" tile pattern exactly:
// a single Ink Tile card (not one card per stat), each stat's label sitting
// ABOVE its value, spaced by an unbroken flex row rather than a grid of
// separate boxes.
function KpiStrip({ ops, cash }) {
  const netIncome = ops.total_income - ops.total_expenses;
  const netIsPos  = netIncome >= 0;
  return (
    <div style={styles.stripCard}>
      <Tile
        value={fmtCurrencyShort(ops.total_income)}
        label="Total Income"
        sub="All ManCo income line items YTD (management fees and other income)"
      />
      <Tile
        value={fmtCurrencyShort(ops.total_expenses)}
        label="Total Expenses"
        sub="All ManCo operating costs YTD"
        valueColor={RED}
      />
      <Tile
        value={(netIsPos ? "" : "(") + fmtCurrencyShort(Math.abs(netIncome)) + (netIsPos ? "" : ")")}
        label="Net Income"
        sub="Total income less total expenses"
        valueColor={netIsPos ? GREEN : RED}
      />
      <Tile
        value={fmtCurrencyShort(cash.balance)}
        label="Cash Balance"
        sub={cashSubtitle(cash)}
        detail={hasCashDetail(cash) ? <CashDetailCard cash={cash} /> : null}
        detailLabel="Cash balance by account"
        // Last tile in the strip — a left-anchored card runs off its edge.
        detailAlign="right"
      />
    </div>
  );
}

// A missing balance, a stale manual account, and cash held in a currency
// left out of the total all read as a plain number without this line.
export function cashSubtitle(cash) {
  const REASONS = {
    "not-fetched":            "Not fetched — refresh the dashboard",
    "unreadable":             "Carta's response could not be read — refresh the dashboard",
    "entity-not-in-response": "Carta returned no balances for this ManCo",
    "no-bank-accounts":       "No bank accounts on this ManCo in Carta",
    "currency-mismatch":      "No balance in this ManCo's reporting currency",
  };
  if (cash.balance == null) {
    return REASONS[cash.unavailable_reason] || "Cash position unavailable";
  }

  const parts = ["ManCo entity cash position"];
  // The tile's number carries the app-wide currency symbol. When the cash
  // block reports a different currency, say so or the symbol is a lie.
  if (cash.currency && cash.currency !== displayCurrency()) {
    parts.push(`reported in ${cash.currency}`);
  }
  if (cash.stale_account_count > 0) {
    const n = cash.stale_account_count;
    parts.push(`${n} manual account${n === 1 ? "" : "s"} out of date`);
  }
  const others = (cash.by_currency || []).filter((t) => t.currency_code !== cash.currency);
  if (others.length) {
    parts.push(`also holds ${others.map((t) => t.currency_code).join(", ")}`);
  }
  return parts.join(" · ");
}

// Label-above-value order, per StatTile's `labelPos="top"` default (Ink's
// real Tile spec) — label, then value (marginTop: 6), then sub (marginTop: 5).
function Tile({ value, label, sub, valueColor, detail, detailLabel, detailAlign }) {
  const shown = <span style={{ ...styles.tileVal, color: valueColor || INK }}>{value}</span>;
  return (
    <div style={styles.tile}>
      <div style={styles.tileLabel}>{label}</div>
      <div>
        {detail
          ? <HoverCard card={detail} label={detailLabel} align={detailAlign}>{shown}</HoverCard>
          : shown}
      </div>
      <div style={styles.tileSub}>{sub}</div>
    </div>
  );
}

// The chart's own in-card title+sub (Ink's charts.md header) is
// the one header now — title/description here are for the rare Section
// that wraps something other than an Ink chart.
function Section({ title, description, legend, note, children }) {
  return (
    <section style={styles.section}>
      {title && <H2>{title}</H2>}
      {title && <div style={styles.sectionDivider} />}
      <div style={styles.card}>
        {description && <div style={styles.cardTitle}>{description}</div>}
        {children}
        {legend && <div style={styles.chartLegend}>{legend}</div>}
        {note && <div style={styles.chartNote}>{note}</div>}
      </div>
    </section>
  );
}

function LegendItem({ color, label }) {
  return (
    <div style={styles.legendItem}>
      <div style={{ ...styles.legendDot, background: color }} />
      {label}
    </div>
  );
}

function LineLegendItem({ color, label }) {
  return (
    <div style={styles.legendItem}>
      <span style={{ display: "inline-block", width: 18, height: 2, background: color, borderRadius: 1, marginRight: 5 }} />
      {label}
    </div>
  );
}

// Month abbreviations shared by the YTD window labels below. Kept local to
// this file since these are the only strings that need them.
const MONTH_ABBR = ["Jan","Feb","Mar","Apr","May","Jun",
                    "Jul","Aug","Sep","Oct","Nov","Dec"];

// "Jan – Apr 2026" — for section descriptions that name the YTD window once.
function ytdWindowLabel(asOfIso) {
  if (!asOfIso) return "";
  const [y, m] = asOfIso.split("-").map(Number);
  return `Jan – ${MONTH_ABBR[m - 1]} ${y}`;
}
// "Jan–Apr" — for phrases like "…filtered to Jan–Apr each year".
function ytdShortLabel(asOfIso) {
  if (!asOfIso) return "";
  const m = Number(asOfIso.split("-")[1]);
  return `Jan–${MONTH_ABBR[m - 1]}`;
}


/** Whether these variance categories came from Carta's own budget rather
 *  than an ingested workbook. */
export function isCartaBudget(varianceByCategory) {
  return varianceByCategory?.default_id === "carta";
}

/** Where the categories on the variance chart come from. */
export function varianceCategorySource(v) {
  return isCartaBudget(v)
    ? "Categories are the Carta GL accounts the firm's budget is written against."
    : "Categories come from the firm's own budget workbook; actuals are matched to them by Carta GL account.";
}

/** The provenance line under the variance chart. */
export function varianceCategoryNote(v) {
  return isCartaBudget(v)
    ? "Budget from the firm's own Carta budget. Actuals from ManCo entity journal entries, joined to it on GL account."
    : "Budget from the firm's Excel workbook — pick which one above when several are ingested. Actuals from ManCo entity journal entries, joined on GL account rather than account name, because the workbook's category names and Carta's account names rarely match.";
}

// What the chart leaves out. A vendor chart covering 43% of spend looks
// complete unless it says otherwise, and on some firms most expense
// carries no vendor at all.
export function vendorNote(v) {
  const parts = ["Expense journal entries grouped by the vendor Carta recorded."];
  if (v.other_count > 0) {
    parts.push(`${v.other_count} smaller vendor${v.other_count === 1 ? "" : "s"} totalling ${fmtCurrencyShort(v.other_amount, 0)} are not charted.`);
  }
  if (v.unattributed_amount > 0) {
    const pct = Math.round((v.unattributed_amount / v.total_expense) * 100);
    parts.push(`${fmtCurrencyShort(v.unattributed_amount, 0)} (${pct}% of expense) has no vendor on the entry and is not shown — card and reimbursement lines often name only a category.`);
  }
  if (v.aggregated_count > 0) {
    parts.push(`${v.aggregated_count} account${v.aggregated_count === 1 ? " is" : "s are"} grouped under the account name rather than naming individuals; the spend is still counted.`);
  }
  if (v.inferred_total > 0) {
    parts.push(`${fmtCurrencyShort(v.inferred_total, 0)} was inferred from entry descriptions and approved during setup, not recorded as a vendor in Carta.`);
  }
  return parts.join(" ");
}

export default function DashboardView({ snapshot, accountsData, drilldown }) {
  const { ops, cash, monthlyCashflow, budget, feeSchedule, spendByGL } = snapshot;
  const vendorSpend = snapshot.vendorSpend;
  const varianceByCategory = snapshot.varianceByCategory;
  // Same rule SpendByGL uses to drop its budget series, so the chart and
  // the copy around it can never disagree about whether a budget exists.
  const spendHasBudget = (spendByGL?.accounts || []).some(a => (a.budget ?? 0) > 0);
  const monthlyCategories = accountsData?.monthly_categories;
  // The dimension the build scoped its figures on, so a drill filtered by
  // one of its values knows where to read that value from.
  const dimension = dimensionOf(accountsData) || dimensionOf(snapshot);
  const asOf = snapshot?.asOf || "2026-07-15";
  const ytdWindow = ytdWindowLabel(asOf);
  const ytdShort  = ytdShortLabel(asOf);

  // Lifted date-range state for the breakdown pane. Default = YTD through
  // the snapshot's as-of date.
  const [dateRange, setDateRange] = useState(() => ({
    start: `${asOf.slice(0, 4)}-01-01`,
    end: asOf,
  }));

  const onCashflowSelect = drilldown
    ? ({ month, side }) => drilldown.openMonthSide(month, side)
    : undefined;
  const onVendorSelect = drilldown
    ? ({ vendor }) => drilldown.openVendor(vendor)
    : undefined;
  const onSpendSelect = drilldown
    ? ({ name }) => drilldown.openAccount(name)
    : undefined;
  // A variance bar is a budget category, which can span several GL accounts
  // ("Travel" covering airfare, hotels and taxis). Drill on the category's
  // full GL set rather than its name — the workbook's label is not a Carta
  // account name and would resolve to nothing.
  // This chart has no department axis — every category is firm-wide — so
  // the drill is opened with the Firm Total sentinel (empty tag list =
  // no tag filter). `origin` marks where the click came from so the
  // drawer can name a budget category as such, instead of reporting the
  // sentinel back to the reader as though it were a department.
  const onVarianceSelect = drilldown
    ? (cat, period) => drilldown.openTagValueAccount(
        "Firm Total", cat.name, cat.gl_codes?.[0] ?? null, cat.gl_codes || [],
        // However the bar was narrowed, narrow the panel the same way: the
        // tag values it was scoped to, or the claims a neighbouring line
        // owns. Opened with neither, a scoped bar answered every
        // department's spend against a figure showing one.
        null, cat.carta_tags || [],
        { budget: cat.budget, actual: cat.actual, polarity: "expense", unmapped: false,
          quarterlyBudget: cat.quarterly_budget || null,
          monthlyBudget: cat.monthly_budget || null },
        period, "budget-category", cat.excluded_claims || null, dimension,
      )
    : undefined;
  // Chart click: open the drill for that single month's category. Does NOT
  // move the top-level date range — the chart keeps showing whatever range
  // the user picked (default YTD). The picker is the only thing that
  // changes which bars are visible.
  const onMonthlyCatSelect = ({ month, category }) => {
    if (!drilldown) return;
    const yr = Number(asOf.slice(0, 4));
    const start = `${yr}-${String(month).padStart(2, "0")}-01`;
    const end = `${yr}-${String(month).padStart(2, "0")}-${new Date(yr, month, 0).getDate()}`;
    drilldown.openDateRangeCategory(start, end, category);
  };
  // Breakdown-row click: drill into the category using the current date range.
  const onBreakdownSelect = ({ category }) => {
    if (drilldown) drilldown.openDateRangeCategory(dateRange.start, dateRange.end, category);
  };
  const onFeeIncomeSelect = drilldown
    ? ({ fund, yearLabel, isProjected }) => {
        if (!isProjected) {
          drilldown.openFundYear(fund, yearLabel);
          return;
        }
        const projLabels = feeSchedule?.projectedLabels || [];
        const projFunds  = feeSchedule?.projectedFunds  || [];
        const projIdx    = projLabels.indexOf(yearLabel);
        const colorByName = Object.fromEntries(
          (feeSchedule?.funds || []).map(f => [f.name, f.color])
        );
        const projectedAmounts = projFunds
          .map(pf => ({
            name: pf.name,
            amount: projIdx >= 0 ? (pf.data[projIdx] ?? 0) : 0,
            color: colorByName[pf.name] ?? "#999",
          }))
          .filter(pf => pf.amount > 0)
          .sort((a, b) => b.amount - a.amount);
        const committedCapital = projFunds.find(pf => pf.name === fund)?.committedCapital ?? null;
        drilldown.openFundYear(fund, yearLabel, { isProjected: true, projectedAmounts, committedCapital });
      }
    : undefined;

  const allFundNames = useMemo(
    () => new Set((feeSchedule?.funds || []).map(f => f.name)),
    [feeSchedule]
  );
  const [selectedFunds, setSelectedFunds] = useState(allFundNames);
  useEffect(() => { setSelectedFunds(allFundNames); }, [allFundNames]);

  const [feeYearStartIdx, setFeeYearStartIdx] = useState(0);
  const [showProjections, setShowProjections] = useState(true);
  // Reset year filter and projection toggle when snapshot changes.
  useEffect(() => { setFeeYearStartIdx(0); setShowProjections(true); }, [feeSchedule]);

  return (
    // The page no longer caps its own width; this view keeps the width it
    // has always had. Only the budget tables want more.
    <Capped id={DASHBOARD_EXPORT_ID}>
      <div data-export-exclude style={styles.exportRow}>
        <ExportButton
          targetId={DASHBOARD_EXPORT_ID}
          entityName={snapshot?.firmName || "ManCo"}
          pageLabel="Dashboard"
          asOf={snapshot?.asOf}
          filenameBase={`${slugify(snapshot?.firmName) || "manco"}-dashboard`}
          events={{ click: "MancoReporting.Dashboard.ExportHtml",
                   succeeded: "MancoReporting.Dashboard.ExportHtmlSucceeded",
                   failed: "MancoReporting.Dashboard.ExportHtmlFailed" }}
        />
      </div>
      <KpiStrip ops={ops} cash={cash} />

      <Section
        legend={
          <>
            <LegendItem color="var(--blue)" label="Income" />
            <LegendItem color="var(--ink-color-global-data-viz-turquoise-3)" label="Expenses" />
            <LineLegendItem color="var(--local-series-blue-dark)" label="Net operating income" />
          </>
        }
      >
        <Cashflow
          monthlyCashflow={monthlyCashflow}
          onSelect={onCashflowSelect}
          title="Monthly P&L"
          sub="Income and expenses booked to the management company by effective date. Line shows monthly net operating income. Click an income or expense stack to drill in."
          asOf={asOf}
        />
      </Section>

      <div style={styles.row}>
        <div style={styles.rowCol}>
          <Section
            legend={
              <>
                <LegendItem color="var(--local-series-blue-dark)" label="Annual budget" />
                <LegendItem color="var(--local-series-blue-tint)" label="YTD budget" />
                <LegendItem color="var(--blue)" label="YTD actuals" />
              </>
            }
            note={`Budget sourced from Carta Fund Admin via the budget tool. YTD budget = sum of monthly budget rows ${ytdShort} ${asOf.slice(0,4)}, matching the actuals window.`}
          >
            <BudgetVsActuals
              budget={budget}
              ops={ops}
              title="YTD Budget vs Actuals"
              sub="Annual budget, YTD budget, and YTD actuals across Income, Expenses, and Net Operating Income."
              compact
            />
          </Section>
        </div>

        {vendorSpend?.vendors?.length > 0 && (
          <div style={styles.rowCol}>
            <Section
              legend={
                vendorSpend.inferred_total > 0 ? (
                  <>
                    <LegendItem color="var(--ink-color-global-data-viz-lime-3)" label="From Carta" />
                    <LegendItem color="var(--local-series-lime-tint)" label="Inferred from description" />
                  </>
                ) : null
              }
              note={vendorNote(vendorSpend)}
            >
              <VendorSpend
                vendorSpend={vendorSpend}
                onSelect={onVendorSelect}
                title="Top Vendors by Spend"
                sub={`Expense spend by vendor, ${ytdWindow}. Click any bar to drill into that vendor's journal entries.`}
                compact
              />
            </Section>
          </div>
        )}
      </div>

      <Section
        note={`Fees sourced from fund-level journal entries, filtered to ${ytdShort} each year to match the YTD period selection.`}
      >
        <FeeIncome
          feeSchedule={feeSchedule}
          selectedFunds={selectedFunds}
          yearStartIdx={feeYearStartIdx}
          showProjections={showProjections}
          onSelect={onFeeIncomeSelect}
          title="Management Fee Income by Fund"
          sub={`Year-to-date management fees received from each fund entity (${ytdShort}), for each year. Click a stack segment to drill into that fund's fee payments.`}
          headerControl={
            <div data-export-exclude style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <FeeYearFilter
                labels={feeSchedule.labels}
                startIdx={feeYearStartIdx}
                onChange={setFeeYearStartIdx}
              />
              <FundSelector
                funds={feeSchedule.funds}
                selected={selectedFunds}
                onChange={setSelectedFunds}
              />
              {(feeSchedule.projectedLabels?.length > 0) && (
                <button
                  style={{
                    ...sans, display: "inline-flex", alignItems: "center", gap: 6,
                    padding: "6px 12px", fontSize: FS.body, fontWeight: 500,
                    color: showProjections ? PAPER : INK,
                    background: showProjections ? INK : PAPER,
                    border: `1px solid ${INK}`, borderRadius: 4, cursor: "pointer",
                  }}
                  onClick={() => { trackClick("MancoReporting.Dashboard.ToggleProjections"); setShowProjections((v) => !v); }}
                >
                  {showProjections ? "Hide projections" : "Show projections"}
                </button>
              )}
            </div>
          }
        />
      </Section>

      {/* With an ingested workbook, rank the firm's own budget categories by
          variance. Without one there is nothing to vary from, so the GL-keyed
          spend ranking stays — it is useful on its own merits. */}
      {/* A firm that budgets in Carta has no workbook, and telling it the
          categories came from one names a file it never sent. */}
      {varianceByCategory?.budgets?.length ? (
        <Section
          note={varianceCategoryNote(varianceByCategory)}
        >
          <VarianceByCategory
            varianceByCategory={varianceByCategory}
            onSelect={onVarianceSelect}
            title="Top Categories of Variance"
            // No window named here. This chart compares over the months the
            // BUDGET covers, which is not the dashboard's year-to-date —
            // a quarterly budget stops at the last whole quarter — and the
            // chart states its own period a line below. Naming the wrong
            // one here had it contradicting itself on screen.
            sub={`Budget categories furthest from plan. ${varianceCategorySource(varianceByCategory)} Click any bar to drill into the underlying journal entries.`}
          />
        </Section>
      ) : (
        <Section
          legend={
            spendHasBudget ? (
              <>
                <LegendItem color="var(--local-series-blue-pale)" label="YTD Budget" />
                <LegendItem color="var(--ink-color-global-data-viz-lime-3)" label="YTD Actual" />
                <LegendItem color="var(--local-mark-negative)" label="Over budget" />
              </>
            ) : (
              <LegendItem color="var(--ink-color-global-data-viz-lime-3)" label="YTD Actual" />
            )
          }
          note={`Actuals from ManCo entity journal entries (account types 6000–7999).${
            spendHasBudget
              ? " Budget from Carta Fund Admin. Accounts with no budget line show actuals only."
              : ""
          }`}
        >
          <SpendByGL
            spendByGL={spendByGL}
            onSelect={onSpendSelect}
            title="YTD Top Categories of Spend"
            sub={`Top 10 expense accounts for the management company entity, ${ytdWindow}.${
              spendHasBudget
                ? " Budget sourced from Carta's budget tool. Red bars indicate over-budget actuals."
                : " This firm has no budget loaded, so the chart shows actuals only."
            } Click any bar to drill into the underlying journal entries.`}
          />
        </Section>
      )}

      {monthlyCategories && (
        <Section note="Expense actuals from ManCo entity journal entries (account types 5000 and up), grouped by GL account and month.">
          <MonthlyExpensesByCategory
            monthlyCategories={monthlyCategories}
            entries={accountsData?.entries}
            dateRange={dateRange}
            onSelect={onMonthlyCatSelect}
            title="Monthly Expenses by Category"
            sub="Expense stack month-over-month for the ManCo entity's top-8 GL accounts, plus an aggregated 'Other' bucket. Click any segment to drill into that month's entries for that category."
            headerControl={<div data-export-exclude><DateRangeControls value={dateRange} onChange={setDateRange} asOf={asOf} /></div>}
          />
          <div style={styles.chartLegend}>
            {monthlyCategories.categories.map(c => (
              <LegendItem key={c.name} color={c.color} label={c.name} />
            ))}
          </div>
          <MonthlyExpenseBreakdown
            monthlyCategories={monthlyCategories}
            accountsData={accountsData}
            onSelect={onBreakdownSelect}
            dateRange={dateRange}
          />
        </Section>
      )}
    </Capped>
  );
}

const styles = {
  exportRow: {
    display: "flex",
    justifyContent: "flex-end",
    marginBottom: 12,
  },
  // One bordered Ink "Summary" tile card holding all four stats — matches
  // carta-fund-modeling's MetricBar/StatBar exactly: single `.card`-style
  // border/background, a flex row of stats (not a grid of separate boxed
  // tiles), each stat spaced by its own horizontal padding rather than a
  // row gap (StatBar's own convention — see components.jsx's StatBar).
  stripCard: {
    display: "flex",
    flexWrap: "wrap",
    border: `1px solid ${LINE}`,
    background: PAPER,
    padding: "18px 8px",
    marginBottom: 28,
  },
  tile: {
    flex: "1 1 200px",
    minWidth: 200,
    padding: "0 20px",
  },
  // Plain sentence-case label (Ink's real Tile label style, per StatTile —
  // not the uppercase/tracked Eyebrow treatment this tile used before),
  // sitting ABOVE its value per StatTile's `labelPos="top"` default.
  tileLabel: {
    ...sans,
    fontSize: FS.body,
    fontWeight: 400,
    color: FAINT,
    whiteSpace: "nowrap",
  },
  // Matches carta-fund-modeling's MetricBar/StatTile KPI-value recipe exactly
  // (ui/components.jsx's StatTile, inkNum branch) — display-scale (28px),
  // weight 700, tabular-nums figures — rather than snapping to the
  // nearest heading step. This app's own off-scale 22px/700 was drift from
  // that sibling app's convention, not a considered choice of its own; the
  // 700 weight here is a deliberate, established exception to "Ink headings
  // never exceed 600" — it's a hero KPI figure, not a heading. marginTop: 6
  // matches StatTile's own label-to-value spacing exactly.
  tileVal: {
    ...inkNum,
    display: "inline-block",
    fontSize: FS.display,
    fontWeight: 700,
    lineHeight: 1.05,
    whiteSpace: "nowrap",
    marginTop: 6,
  },
  // marginTop: 5 matches StatTile's own value-to-sub spacing exactly.
  tileSub: {
    ...sans,
    fontSize: FS.small,
    color: MICRO,
    marginTop: 5,
  },
  sectionDivider: {
    borderTop: `1px solid ${LINE}`,
    marginBottom: 16,
  },
  // Shared row for two half-width charts. Default stretch equalizes height.
  row: {
    display: "flex",
    gap: 24,
  },
  rowCol: {
    flex: "1 1 0",
    minWidth: 0,
    display: "flex",
  },
  section: {
    marginBottom: 40,
    display: "flex",
    flexDirection: "column",
    flex: 1,
  },
  card: {
    padding: "16px 20px 20px",
    border: `1px solid ${LINE}`,
    background: PAPER,
    flex: 1,
  },
  cardTitle: {
    fontSize: FS.bodyLg,
    color: FAINT,
    lineHeight: 1.4,
    marginBottom: 12,
  },
  chartLegend: {
    display: "flex",
    gap: 16,
    flexWrap: "wrap",
    fontSize: FS.small,
    color: FAINT,
    marginBottom: 12,
  },
  legendItem: {
    display: "flex",
    alignItems: "center",
    gap: 5,
  },
  legendDot: {
    width: 10,
    height: 10,
    borderRadius: 2,
    flexShrink: 0,
  },
  chartNote: {
    fontSize: FS.micro,
    color: MICRO,
    marginTop: 8,
    textAlign: "right",
  },
};
