import { useMemo } from "react";
import { FS, sans, mono, SIDEBAR_PANEL_BG } from "./theme.js";
import { fmtM, fmtX, fmtPct } from "./format.js";
import { Num, Btn, ALL_FUNDS, fundLabel, DeltaCaret } from "./components.jsx";
import { scenarioFund, firmBaseRollup } from "../model/funds.js";
import { scenarioRow, exitDateIrr } from "../model/scenarios.js";
import { waterfallCfgFor, exitHorizonFor } from "../model/reprice.js";
import { reservesEarmarked } from "../model/reserves.js";

/** Plain label/value row — quiet grey label left, black value right, an
 *  optional colored delta (caret + figure) inline after the value. Matches
 *  the "Live preview of returns" sidebar design spec: flat sentence-case 12px
 *  rows, no uppercase micro-labels and no headline/secondary tiering between
 *  metrics.
 *  When `onClick` is given, the label doubles as a deep link into Returns.
 *  When `forceDelta` is set (Firm impact rows only), the delta always renders
 *  — even a zero/negligible change shows "0.00×" with a neutral grey caret,
 *  per the design spec, instead of disappearing below `eps`.
 *  When `alignCols` is set (Firm impact rows only), the value gets a
 *  fixed-width right-aligned column, so — per the design mockup — every row's
 *  delta caret starts at the same x position instead of trailing loosely
 *  right after each row's own value width. The delta text itself stays
 *  left-aligned directly after its caret (not right-padded), matching the design. */
function Row({ label, value, fmt, delta, eps = 0.5, forceDelta = false, alignCols = false, onClick, title }) {
  const labelEl = onClick ? (
    <Btn kind="link" onClick={onClick} title={title}
      style={{ fontSize: 12, lineHeight: "20px", color: "var(--ink-color-global-text-subtle)", fontWeight: 400, textAlign: "left" }}
      onMouseEnter={(e) => { e.currentTarget.style.color = "var(--ink-color-global-text-default)"; e.currentTarget.style.textDecoration = "underline"; }}
      onMouseLeave={(e) => { e.currentTarget.style.color = "var(--ink-color-global-text-subtle)"; e.currentTarget.style.textDecoration = "none"; }}>
      {label}
    </Btn>
  ) : (
    <span style={{ ...sans, fontSize: 12, lineHeight: "20px", color: "var(--ink-color-global-text-subtle)" }}>{label}</span>
  );
  const showDelta = delta != null && (forceDelta || Math.abs(delta) > eps);
  const isNeutral = delta != null && Math.abs(delta) <= eps;
  const deltaColor = isNeutral ? "var(--ink-color-global-text-subtle)" : delta >= 0 ? "var(--ink-color-global-feedback-positive-strong)" : "var(--ink-color-global-feedback-negative-strong)";
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "1px 0" }}>
      {labelEl}
      <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ ...mono, fontSize: 12, fontWeight: 500, lineHeight: "24px", color: "var(--ink-color-global-text-default)",
          ...(alignCols ? { minWidth: 64, textAlign: "right" } : {}) }}>
          <Num value={value} fmt={fmt} />
        </span>
        {showDelta && (
          // The row itself is `justify-content: space-between`, so the whole
          // value+delta group is anchored to the row's RIGHT edge — meaning if the
          // delta text's own width varies row to row, the group's total width varies
          // too, which shifts the caret (its left edge) left/right despite the fixed
          // value column before it. Reserving a fixed `minWidth` on the delta text
          // (without right-aligning it) keeps the group's total width constant, so
          // the caret lands at the same x on every row — while the number itself
          // still sits left-aligned directly after its caret, per the design spec.
          <span style={{ display: "flex", alignItems: "center", gap: 6, color: deltaColor }}>
            <DeltaCaret up={delta >= 0} />
            <span style={{ ...mono, fontSize: 12, fontWeight: 500, lineHeight: "24px",
              ...(alignCols ? { minWidth: 52 } : {}) }}>{fmt(Math.abs(delta))}</span>
          </span>
        )}
      </span>
    </div>
  );
}

/** Net LP IRR / GP carry — ported from the Returns scorecard
 *  (src/views/returns/*), computed per fund instead of the page's single
 *  scoped fund. Both are driven off Net TVPI (LP NAV + distributions over
 *  total paid-in INCLUDING scheduled future calls), an intermediate value
 *  not shown on its own here. Per-fund rows show no deltas (only the Firm
 *  impact rollup does), so this only solves the current-scenario figures —
 *  no baseline XIRR/waterfall-inverse solve to throw away unused.
 *  Exit horizon (a single terminal date, not just a year) matches the app-wide
 *  convention set in useScenarioModel.js — same `exitHorizonFor`/`exitDateIrr`
 *  every Returns tab now uses. */
function fundExitMetrics(snapshot, portfolio, f) {
  const fund = scenarioFund(snapshot, f.id);
  if (!(fund.paidInTotal > 0)) return null;
  const exitDate = exitHorizonFor(portfolio.assumptions, snapshot, f.id);
  const wf = waterfallCfgFor(portfolio.assumptions, snapshot, f.id);
  const netTvpi = (f.lpNav + f.lpDistributed) / fund.paidInTotal;
  const netLpIrr = netTvpi > 0 ? exitDateIrr(fund, exitDate, netTvpi) : null;
  const gpCarry = netTvpi > 0 ? scenarioRow(fund, netTvpi, wf).gpCarry : null;
  return { thisYear: exitDate ? exitDate.slice(0, 4) : null, netLpIrr, gpCarry };
}

/** One fund's block — name, then a flat, uniform list of rows (NAV, TVPI, Net
 *  LP IRR, DPI, LP distributions, Carried interest). No headline/secondary
 *  tiering between metrics, and no vs-baseline deltas (those live only in the
 *  Firm impact rollup above), per the design spec. */
function FundCard({ f, snapshot, portfolio, onOpenFundSection, isLast }) {
  // fundExitMetrics runs an XIRR solve + a waterfall-inverse bisection — cache
  // per fund so hover/dimming-only re-renders (dimmed toggles constantly while
  // comparing a reprice) don't re-run the numeric solvers
  const m = useMemo(
    () => fundExitMetrics(snapshot, portfolio, f),
    [snapshot, portfolio, f]
  );
  const name = fundLabel(f.name);
  const openExit = onOpenFundSection && (() => onOpenFundSection(f.id, null));
  const exitTitle = `Open ${name} in Returns`;
  return (
    <div style={{ padding: "8px 0", borderBottom: isLast ? "none" : `1px solid var(--ink-color-global-border-subtle)` }}>
      <div style={{ ...sans, fontSize: 12, fontWeight: 500, lineHeight: "20px", color: "var(--ink-color-global-text-default)", marginBottom: 2,
        whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
        {name}
      </div>
      <Row label="NAV" value={f.lpNav} fmt={fmtM} onClick={openExit} title={exitTitle} />
      <Row label="TVPI" value={f.tvpi} fmt={(n) => fmtX(n)} onClick={openExit} title={exitTitle} />
      <Row label={`Net LP IRR · exit ${m?.thisYear ?? "—"}`} value={m?.netLpIrr} fmt={(n) => fmtPct(n)}
        onClick={onOpenFundSection && (() => onOpenFundSection(f.id, "lp-returns"))}
        title={`Open ${name} in Returns · LP returns`} />
      <Row label="DPI" value={f.dpi} fmt={(n) => fmtX(n)}
        onClick={onOpenFundSection && (() => onOpenFundSection(f.id, "lp-returns"))}
        title={`Open ${name} in Returns · LP returns`} />
      <Row label="LP distributions" value={f.lpDistributed} fmt={fmtM}
        onClick={onOpenFundSection && (() => onOpenFundSection(f.id, "lp-returns"))}
        title={`Open ${name} in Returns · LP returns`} />
      {/* Accrued carry (mark-to-market) — the SAME quantity summed into the Firm
          impact "Carried interest" above, so per-fund carry reconciles with the firm
          rollup (Σ fund = firm) and zeroing a company moves both by the same amount.
          The at-exit GP carry (full waterfall + catch-up) lives in the Returns · GP
          returns tab this row links to; it isn't the current-state figure this panel
          otherwise shows. */}
      <Row label="Carried interest" value={f.accruedCarry + f.carryBanked} fmt={fmtM}
        onClick={onOpenFundSection && (() => onOpenFundSection(f.id, "gp-returns"))}
        title={`Open ${name} in Returns · GP returns`} />
    </div>
  );
}

/** Performance sidebar v2 — persistent right-hand panel on the Companies tab.
 *  Consolidates the firm metric strip, the per-company fund-impact grey box,
 *  and adds the Returns scorecard's Net TVPI / Net LP IRR / GP carry per
 *  fund so none of that has to live inline in the table anymore. Read-only.
 *  Styled to match the "Live preview of returns" sidebar design spec: flat
 *  panel, #F8F8F8 content slots, sentence-case semibold section titles, plain
 *  12px rows. */
export default function PerformanceSidebarV2({ fundStates, firmAgg, firmLpDelta, firmGpCarry, sliceName, fundScope, snapshot, portfolio, onOpenFundSection, activeFundIds }) {
  // Base list respects the global fund-scope picker. When a company is
  // hovered/expanded on the Companies table (activeFundIds set), narrow the
  // list to only the fund(s) that company actually touches — rather than
  // showing every fund with the irrelevant ones greyed out.
  const scopedFunds = fundScope === ALL_FUNDS ? fundStates : fundStates.filter((f) => f.id === fundScope);
  const funds = activeFundIds != null ? scopedFunds.filter((f) => activeFundIds.includes(f.id)) : scopedFunds;
  const sectionBox = { background: SIDEBAR_PANEL_BG, padding: "8px 12px" };
  const sectionHeading = { ...sans, fontSize: 14, fontWeight: 600, lineHeight: "24px", color: "var(--ink-color-global-text-default)", marginBottom: 8 };

  // Firm-wide vs-baseline deltas — always over the FULL firm (fundStates, not the
  // fund-scope-filtered `funds` used for the Fund impact list below), same scope
  // App.jsx already uses for firmLpDelta. firmBaseRollup() is firmRollup()'s
  // baseline counterpart (model/funds.js) — keeps this rollup math in one place
  // rather than re-summing fundStates ad hoc here.
  const firmBase = firmBaseRollup(fundStates);
  // Reserve capital earmarked by the current dilution posture (firm-wide) — a
  // modeled estimate of pro-rata follow-on need.
  const reserves = reservesEarmarked(portfolio);
  return (
    <aside data-testid="performance-sidebar" style={{ width: 340, flex: "none", borderLeft: `1px solid var(--ink-color-global-border-subtle)`, padding: 20,
      position: "sticky", top: 0, height: "100vh", overflowY: "auto", scrollbarGutter: "stable",
      background: "var(--ink-color-global-surface-background-default)" }}>
      <div style={{ ...sans, fontSize: 16, fontWeight: 500, color: "var(--ink-color-global-text-default)", lineHeight: "28px" }}>Returns preview</div>
      <div style={{ ...sans, fontSize: FS.small, color: "var(--ink-color-global-text-subtle)", marginTop: 3, marginBottom: 12 }}>
        Scenario: <strong style={{ color: "var(--ink-color-global-text-default)", fontWeight: 600 }}>{sliceName}</strong>
      </div>

      <div style={{ ...sectionBox, marginBottom: 20 }}>
        <div style={sectionHeading}>Firm impact</div>
        {/* never sum across currencies — hide the combined firm totals for a mixed-currency firm */}
        {firmAgg.mixedCurrency ? (
          <div style={{ ...sans, fontSize: FS.small, color: "var(--ink-color-global-text-subtle)", lineHeight: 1.45, margin: "2px 0 6px" }}>
            Firm totals aren't shown — this firm's funds report in multiple currencies, which can't be summed. See per-fund figures below.
          </div>
        ) : (
          <>
            <Row label="LP NAV" value={firmAgg.lpNav} fmt={fmtM} delta={firmLpDelta} forceDelta alignCols />
            <Row label="TVPI" value={firmAgg.tvpi} fmt={(n) => fmtX(n)} delta={firmAgg.tvpi - firmBase.tvpi} eps={0.005} forceDelta alignCols />
            <Row label="DPI" value={firmAgg.dpi} fmt={(n) => fmtX(n)} delta={firmAgg.dpi - firmBase.dpi} eps={0.005} forceDelta alignCols />
            <Row label="LP distributions" value={firmAgg.lpDistributed} fmt={fmtM} delta={firmAgg.lpDistributed - firmBase.lpDistributed} forceDelta alignCols />
            <Row label="Carried interest" value={firmGpCarry} fmt={fmtM} delta={firmGpCarry - firmBase.gpCarry} forceDelta alignCols />
            {reserves.total > 0.5 && (
              <Row label="Reserves earmarked" value={reserves.total} fmt={fmtM} alignCols />
            )}
          </>
        )}
      </div>

      <div style={sectionBox}>
        <div style={sectionHeading}>Fund impact</div>
        {funds.map((f, i) => (
          <FundCard key={f.id} f={f} snapshot={snapshot} portfolio={portfolio}
            onOpenFundSection={onOpenFundSection} isLast={i === funds.length - 1} />
        ))}
      </div>
    </aside>
  );
}
