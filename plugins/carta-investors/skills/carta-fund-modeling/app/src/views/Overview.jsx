import { useMemo } from "react";
import { FS, inkNum, sans } from "../ui/theme.js";
import { fmt$, fmtX, fmtPct, fmtOwn } from "../ui/format.js";
import { Num, SourceNote, H1, H2, fundNameOnly } from "../ui/components.jsx";
import { TableHead, useTableSort, TableScroll } from "../ui/table.jsx";
import { gpCarryOf, baseGpCarryOf } from "../model/funds.js";
import { fundAvgOwnership } from "../model/ownership.js";
import { concentrationAcrossAll } from "../model/concentration.js";
import { useFirmData } from "../state/FirmData.jsx";
import { trackClick } from "../analytics.js";
import { UP, DOWN } from "./overview/WidgetCard.jsx";
import PerformanceHero, { NavByFundCard, hasTrend } from "./overview/PerformanceHero.jsx";
import { DryPowderWidget, CarryWidget } from "./overview/CapitalWidgets.jsx";
import TopHoldings from "./overview/TopHoldings.jsx";
import BenchmarksWidget from "./overview/BenchmarksWidget.jsx";

const RT = { ...inkNum, textAlign: "right", fontSize: FS.value };

// Fund-table columns — label + a value accessor for sorting. Text columns sort
// ascending-first, numeric columns descending-first (useTableSort's naturalDir);
// a third click clears back to reported order. Accessors return null (not a
// sentinel) for missing metrics so useTableSort sinks them to the bottom in
// either direction, consistent with every other column.
// Fund-table columns. Built via a factory so the "Avg Own %" column can sort on
// the per-fund capital-weighted ownership (which lives outside the fundState, in
// the ownership extras) — `avgOwnOf(f)` returns that scenario value for sorting.
const makeFundCols = (avgOwnOf) => [
  { label: "Fund", align: "left", get: (f) => fundNameOnly(f.name) },
  { label: "Vintage", get: (f) => f.vintage ?? 0 },
  { label: "Committed", get: (f) => f.committed },
  { label: "LP Paid-In", get: (f) => f.lpPaidIn },
  { label: "LP Distributions", get: (f) => f.lpDistributed },
  { label: "LP NAV", get: (f) => f.lpNav },
  { label: "DPI", get: (f) => f.dpi },
  { label: "RVPI", get: (f) => f.rvpi },
  { label: "TVPI", get: (f) => f.tvpi },
  { label: "Gross MOIC", get: (f) => f.grossMoic ?? null },
  { label: "Avg Own %", get: (f) => avgOwnOf(f) },
  { label: "Net LP IRR", get: (f) => f.netLpIrr ?? null },
  { label: "GP Carry", get: gpCarryOf },
  { label: "GP NAV", get: (f) => f.gpCapitalNavLive },
];

// A numeric cell that surfaces its scenario move vs the Carta baseline ON HOVER:
// the value tints green/red with a ▲/▼ caret when it changed, and the tooltip
// spells out baseline → scenario (Δ). Consistent treatment across every
// reprice-reactive column so they all react the same way (Net LP IRR is the one
// column the model never restates from marks, so it isn't a DeltaTd).
function DeltaTd({ cur, base, fmt, eps = 0, bold }) {
  if (cur == null) return <td style={{ ...RT, fontWeight: bold ? 700 : 400, color: "var(--ink-color-global-text-subtle)" }}>—</td>;
  const delta = cur - (base ?? cur);
  const changed = base != null && Math.abs(delta) > eps;
  const up = delta >= 0;
  const tip = changed ? `${fmt(base)} → ${fmt(cur)}  (Δ ${up ? "+" : "−"}${fmt(Math.abs(delta))})` : undefined;
  return (
    <td style={{ ...RT, fontWeight: bold ? 700 : 400 }} title={tip}>
      <span style={{ display: "inline-flex", alignItems: "baseline", justifyContent: "flex-end", gap: 4,
        color: changed ? (up ? UP : DOWN) : "var(--ink-color-global-text-default)" }}>
        {changed && <span aria-hidden style={{ fontSize: FS.micro, lineHeight: 1 }}>{up ? "▲" : "▼"}</span>}
        <Num value={cur} fmt={fmt} />
      </span>
    </td>
  );
}
// Widths in the dashboard's 12-column grid; each row sums to FULL. The hero's summary
// card takes a third of the row and the chart card the rest, or the full row with no
// chart to draw. The widget row is in quarters, Concentration first (taking what the
// fixed-width widgets leave) and Carry accrued second. Every card stays wider than tall, and below 1180px,
// where spans 3-5 take half the row, the cards pair up.
const FULL = 12, SUMMARY_SPAN = 4, CARRY_SPAN = 3, BENCH_SPAN = 3, DRY_SPAN = 3;

/** Firm Overview — a dashboard: the performance hero (firm figures and LP NAV by
 *  fund), a row of compact widgets that each preview a tab (a headline
 *  figure, one small chart and a "View →" link to the full analysis), then the
 *  fund-by-fund table. `firm` is App's live firm rollup, shared with the Companies
 *  sidebar.
 *  `onNavigate(tab, fundId?, section?)` opens another tab, landing a per-fund tab on `fundId`
 *  and scrolling to the element with id `section`. */
export default function Overview({ fundStates, snapshot, portfolio, firm, onOpenFund, onNavigate }) {
  const firmRvpi = firm.lpPaidIn > 0 ? firm.lpNav / firm.lpPaidIn : 0;

  const { ownership } = useFirmData();

  // Capital-weighted average fully-diluted ownership per fund. `avgNow` applies
  // each company's expected future dilution (so a Reserve-strategy sweep moves it
  // — the fund-level "are we staying ahead of dilution?" signal); `avgBase` is the
  // undiluted figure the DeltaTd compares against.
  const avgNow = useMemo(() => Object.fromEntries(
    fundStates.map((f) => [f.id, fundAvgOwnership(portfolio.companies, ownership, f.id, { dilution: true })])
  ), [fundStates, portfolio.companies, ownership]);
  const avgBase = useMemo(() => Object.fromEntries(
    fundStates.map((f) => [f.id, fundAvgOwnership(portfolio.companies, ownership, f.id, { dilution: false })])
  ), [fundStates, portfolio.companies, ownership]);
  const fundCols = useMemo(() => makeFundCols((f) => avgNow[f.id] ?? null), [avgNow]);

  // fund-table sort — defaults to Fund name A-Z; a third click on any header clears
  // to the reported (unsorted) row order, same as every other useTableSort caller
  const { sorted: sortedFunds, sort: fundSort, onSort: onFundSort } = useTableSort(fundStates, fundCols, { i: 0, dir: "asc" });
  const holdings = useMemo(() => concentrationAcrossAll(snapshot, portfolio), [snapshot, portfolio]);
  const mixed = firm.mixedCurrency;
  const firmName = snapshot.branding?.firmName ?? snapshot.source?.firm;
  // what the widget row leaves after its fixed-width widgets: Concentration takes it
  const restSpan = FULL - CARRY_SPAN - BENCH_SPAN - DRY_SPAN;
  // the chart sums LP NAV across funds, so a mixed-currency firm doesn't get one
  const trend = hasTrend(snapshot) && !firm.mixedCurrency;

  return (
    <div>
      <H1>Firm Overview</H1>

      <div className="ov-bento" style={{ marginBottom: 32 }}>
        <PerformanceHero firm={firm} onNavigate={onNavigate} span={trend ? SUMMARY_SPAN : FULL} />
        {trend && <NavByFundCard snapshot={snapshot} fundStates={fundStates} firmLpNav={firm.lpNav} firmName={firmName} span={FULL - SUMMARY_SPAN} />}

        <TopHoldings concentration={holdings} hasCompanies={portfolio.companies.length > 0} mixed={mixed} onNavigate={onNavigate} span={restSpan} />
        <CarryWidget firm={firm} snapshot={snapshot} fundStates={fundStates} onNavigate={onNavigate} span={CARRY_SPAN} />
        <BenchmarksWidget fundStates={fundStates} firmName={firmName} onNavigate={onNavigate} span={BENCH_SPAN} />
        <DryPowderWidget snapshot={snapshot} portfolio={portfolio} mixed={mixed} firmName={firmName} onNavigate={onNavigate}
          span={DRY_SPAN} />
      </div>

      <H2>Funds</H2>
      {/* ── fund-by-fund detail: its own surface ──
          scrolls in place via .table-scroll (theme.js) instead of pushing the
          whole page into horizontal scroll — see that rule's comment for why
          overflow-y:hidden keeps useStickyHeader's ancestor walk unaffected. */}
      <TableScroll>
        <table className="ledger sheet roomy">
          <TableHead cols={fundCols} sort={fundSort} onSort={onFundSort} sticky />
          <tbody>
              {sortedFunds.map((f) => {
                const fundName = fundNameOnly(f.name);
                // No NAV close: render dashes; a repriced $0 would look like a booked figure.
                const dash = f.hasNav === false
                  ? <td style={{ ...RT, color: "var(--ink-color-global-text-subtle)" }} title="No month-end NAV close booked yet">—</td>
                  : null;
                return (
                <tr key={f.id} data-datum-id={f.id} data-datum-type="fund" data-datum-label={fundName}
                  onClick={() => { trackClick("FundModeling.Overview.OpenFund"); onOpenFund(f.id); }}
                  style={{ cursor: "pointer" }} title="Open scenarios">
                  <td style={{ minWidth: 220, maxWidth: 320 }}
                    title={fundName}>
                    <span style={{ ...sans, fontWeight: 400, fontSize: FS.value, color: "var(--ink-color-global-text-default)", lineHeight: 1.25, whiteSpace: "normal", wordBreak: "break-word" }}>{fundName}</span>
                  </td>
                  <td style={{ color: "var(--ink-color-global-text-default)", textAlign: "right" }}>{f.vintage ?? "—"}</td>
                  <td style={RT}>{fmt$(f.committed)}</td>
                  <td style={RT}>{fmt$(f.lpPaidIn)}</td>
                  {dash ?? <DeltaTd cur={f.lpDistributed} base={f.baseLpDistributed} fmt={fmt$} eps={0.5} />}
                  {dash ?? <DeltaTd cur={f.lpNav} base={f.baseLpNav} fmt={fmt$} eps={0.5} />}
                  {dash ?? <DeltaTd cur={f.dpi} base={f.lpPaidIn > 0 ? f.baseLpDistributed / f.lpPaidIn : 0} fmt={(n) => fmtX(n)} eps={0.005} />}
                  {dash ?? <DeltaTd cur={f.rvpi} base={f.lpPaidIn > 0 ? f.baseLpNav / f.lpPaidIn : 0} fmt={(n) => fmtX(n)} eps={0.005} />}
                  {dash ?? <DeltaTd cur={f.tvpi} base={f.baseTvpi} fmt={(n) => fmtX(n)} eps={0.005} />}
                  <DeltaTd cur={f.grossMoic} base={f.baseGrossMoic} fmt={(n) => fmtX(n)} eps={0.005} />
                  {/* Avg Own % — capital-weighted fund ownership; the delta is the dilution
                      guard (scenario dilution vs the undiluted baseline) */}
                  <DeltaTd cur={avgNow[f.id]} base={avgBase[f.id]} fmt={fmtOwn} eps={0.0001} />
                  {/* Net LP IRR — Carta booked; reprices never restate it, so no scenario delta */}
                  <td style={RT}>{f.netLpIrr == null ? "—" : fmtPct(f.netLpIrr)}</td>
                  <DeltaTd cur={gpCarryOf(f)} base={baseGpCarryOf(f)} fmt={fmt$} eps={0.5} />
                  {dash ?? <DeltaTd cur={f.gpCapitalNavLive} base={f.gpCapitalNav} fmt={fmt$} eps={0.5} />}
                </tr>
              );})}
              <tr className="totrow">
                <td style={{ whiteSpace: "nowrap" }}>
                  <span style={{ ...sans, fontSize: FS.value, color: "var(--ink-color-global-text-default)" }}>Count: {sortedFunds.length}</span>
                </td>
                <td />
                {/* never sum across currencies — a mixed-currency firm has no combined total */}
                <td style={RT}>{firm.mixedCurrency ? "—" : fmt$(firm.committed)}</td>
                <td style={RT}>{firm.mixedCurrency ? "—" : fmt$(firm.lpPaidIn)}</td>
                <td style={RT}>{firm.mixedCurrency ? "—" : <Num value={firm.lpDistributed} fmt={fmt$} />}</td>
                <td style={RT}>{firm.mixedCurrency ? "—" : <Num value={firm.lpNav} fmt={fmt$} />}</td>
                <td style={RT}>{firm.mixedCurrency ? "—" : fmtX(firm.dpi)}</td>
                <td style={RT}>{firm.mixedCurrency ? "—" : fmtX(firmRvpi)}</td>
                <td style={RT}>{firm.mixedCurrency ? "—" : <Num value={firm.tvpi} fmt={(n) => fmtX(n)} />}</td>
                <td style={{ ...RT, color: "var(--ink-color-global-text-subtle)" }}>—</td>
                {/* Avg Own % — a per-fund ratio; no meaningful firm-wide roll-up (never
                    average ownership across funds/currencies), so the total stays blank */}
                <td style={{ ...RT, color: "var(--ink-color-global-text-subtle)" }}>—</td>
                <td style={{ ...RT, color: "var(--ink-color-global-text-subtle)" }}>—</td>
                <td style={RT}>{firm.mixedCurrency ? "—" : <Num value={firm.gpCarry} fmt={fmt$} />}</td>
                <td style={RT}>{firm.mixedCurrency ? "—" : <Num value={firm.gpCapitalNavLive} fmt={fmt$} />}</td>
              </tr>
            </tbody>
          </table>
      </TableScroll>

      <SourceNote>
        Source: Carta Fund Admin. Reprices flow to LP NAV / DPI / RVPI / TVPI but don't restate Carta's Net LP IRR.
        {!firm.mixedCurrency && firm.secondaryProceeds > 0.5 && (
          <> Distributions include <strong>{fmt$(firm.secondaryProceeds)}</strong> from modeled partial sales
          {firm.recycled > 0.5 && <> ({fmt$(firm.recycled)} recycled, not distributed)</>}
          {firm.realizedLoss > 0.5 && <>, realizing {fmt$(firm.realizedLoss)} below the marks</>}.</>
        )}
      </SourceNote>
    </div>
  );
}
