import { useMemo } from "react";
import { FS, sans, inkNum, SIDEBAR_PANEL_BG } from "./theme.js";
import { fmtM, fmtX, fmtPct } from "./format.js";
import { Num, Btn, ALL_FUNDS, fundLabel, DeltaCaret } from "./components.jsx";
import { scenarioFund, firmBaseRollup } from "../model/funds.js";
import { scenarioRow, exitDateIrr } from "../model/scenarios.js";
import { waterfallCfgFor, exitHorizonFor } from "../model/reprice.js";
import { reservesEarmarked, baseReservesEarmarked } from "../model/reserves.js";

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
 *  left-aligned directly after its caret (not right-padded), matching the design.
 *  When `dim` is true, the row fades (an inert, "this metric doesn't react to
 *  what you're currently dragging" treatment). Callers precompute this from a
 *  static affects-map (which slider touches which metric — see Companies.jsx's
 *  `draggingSlider` and ReturnsPreviewContent's per-row `dim` calls below)
 *  rather than by watching whether the value visibly moved: a slow drag can
 *  take many renders to cross a rounding boundary even though it's genuinely
 *  affecting the metric, so "did it move since the last render" is not a
 *  reliable signal — only "can this control possibly affect this metric" is. */
function Row({ label, value, fmt, delta, eps = 0.5, forceDelta = false, alignCols = false, onClick, title, dim = false }) {
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
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "1px 0",
      opacity: dim ? 0.35 : 1, transition: "opacity 120ms ease" }}>
      {labelEl}
      <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ ...inkNum, fontSize: 12, fontWeight: 500, lineHeight: "24px", color: "var(--ink-color-global-text-default)",
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
            <span style={{ ...inkNum, fontSize: 12, fontWeight: 500, lineHeight: "24px",
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
 *  not shown on its own here. Also solves the SAME metrics at the fund's
 *  baseline (Carta-booked) net TVPI, so the per-fund rows can show a
 *  vs-baseline delta exactly like the Firm impact rollup above.
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
  const baseNetTvpi = (f.baseLpNav + f.baseLpDistributed) / fund.paidInTotal;
  const baseNetLpIrr = baseNetTvpi > 0 ? exitDateIrr(fund, exitDate, baseNetTvpi) : null;
  return { thisYear: exitDate ? exitDate.slice(0, 4) : null, netLpIrr, gpCarry, baseNetLpIrr };
}

/** One fund's block — name, then a flat, uniform list of rows (NAV, TVPI, Net
 *  LP IRR, DPI, LP distributions, Carried interest, Reserves earmarked), each
 *  with a vs-baseline delta — same convention as the Firm impact rollup above,
 *  just per fund. */
function FundCard({ f, snapshot, portfolio, onOpenFundSection, isLast, reserves, baseReserves, draggingSlider, distributionsAffected }) {
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
  const baseDpi = f.lpPaidIn > 0 ? f.baseLpDistributed / f.lpPaidIn : 0;
  // NAV/TVPI/Net LP IRR/Carried interest/Reserves earmarked all cascade off the
  // repriced FV, which BOTH the Mark and Dilution sliders feed — affected by
  // either, so they never dim. DPI/LP distributions only move once this
  // company's proceeds actually reach the fund's distribution waterfall (i.e.
  // it's realized/exited) — see `distributionsAffected` (Companies.jsx).
  const dimDistributions = draggingSlider != null && !distributionsAffected;
  return (
    <div style={{ padding: "8px 0", borderBottom: isLast ? "none" : `1px solid var(--ink-color-global-border-subtle)` }}>
      <div style={{ ...sans, fontSize: 12, fontWeight: 500, lineHeight: "20px", color: "var(--ink-color-global-text-default)", marginBottom: 2,
        whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
        {name}
      </div>
      <Row label="NAV" value={f.lpNav} fmt={fmtM} delta={f.lpNav - f.baseLpNav} forceDelta alignCols onClick={openExit} title={exitTitle} />
      <Row label="TVPI" value={f.tvpi} fmt={(n) => fmtX(n)} delta={f.tvpi - f.baseTvpi} eps={0.005} forceDelta alignCols onClick={openExit} title={exitTitle} />
      <Row label={`Net LP IRR · exit ${m?.thisYear ?? "—"}`} value={m?.netLpIrr} fmt={(n) => fmtPct(n)}
        delta={m?.netLpIrr != null && m?.baseNetLpIrr != null ? m.netLpIrr - m.baseNetLpIrr : null} eps={0.001} forceDelta alignCols
        onClick={onOpenFundSection && (() => onOpenFundSection(f.id, "lp-returns"))}
        title={`Open ${name} in Returns · LP returns`} />
      <Row label="DPI" value={f.dpi} fmt={(n) => fmtX(n)} delta={f.dpi - baseDpi} eps={0.005} forceDelta alignCols
        onClick={onOpenFundSection && (() => onOpenFundSection(f.id, "lp-returns"))}
        title={`Open ${name} in Returns · LP returns`} dim={dimDistributions} />
      <Row label="LP distributions" value={f.lpDistributed} fmt={fmtM} delta={f.lpDistributed - f.baseLpDistributed} forceDelta alignCols
        onClick={onOpenFundSection && (() => onOpenFundSection(f.id, "lp-returns"))}
        title={`Open ${name} in Returns · LP returns`} dim={dimDistributions} />
      {/* Accrued carry (mark-to-market) — the SAME quantity summed into the Firm
          impact "Carried interest" above, so per-fund carry reconciles with the firm
          rollup (Σ fund = firm) and zeroing a company moves both by the same amount.
          The at-exit GP carry (full waterfall + catch-up) lives in the Returns · GP
          returns tab this row links to; it isn't the current-state figure this panel
          otherwise shows. Baseline has no banked carry (exit toggles are scenario-only
          edits), so the delta compares against `baseAccruedCarry` alone — same
          convention firmBaseRollup uses for the firm-wide figure. */}
      <Row label="Carry" value={f.accruedCarry + f.carryBanked} fmt={fmtM}
        delta={(f.accruedCarry + f.carryBanked) - f.baseAccruedCarry} forceDelta alignCols
        onClick={onOpenFundSection && (() => onOpenFundSection(f.id, "gp-returns"))}
        title={`Open ${name} in Returns · GP returns`} />
      {/* Always visible (even at $0) rather than disappearing once dilution is
          fully defended against — a $0 earmark is meaningful information, not
          an absence of one. */}
      <Row label="Reserves earmarked" value={reserves?.byFund?.[f.id] || 0} fmt={fmtM}
        delta={(reserves?.byFund?.[f.id] || 0) - (baseReserves?.byFund?.[f.id] || 0)} forceDelta alignCols />
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
/** The sidebar's actual content (Returns-preview heading + Firm/Fund impact
 *  sections), with no outer chrome of its own — factored out so the Companies
 *  detail modal can render the exact same "Returns preview" a company's
 *  changes produce, scoped to just that company's own fund(s) via
 *  `activeFundIds`, without inheriting the sidebar's page-level sticky/
 *  fixed-width positioning (which only makes sense beside the page, not
 *  inside a modal card). */
/** @param companyImpact optional [{key, label, value, fmt, delta, eps}] — when
 *  given, a "Company impact" section renders first (above Fund/Firm impact),
 *  scoped to a single company's own FV/LP NAV/Carry/ownership figures (see
 *  Companies.jsx's `companyImpactRows`).
 *  @param draggingSlider optional "mark" | "dilution" | null — which scenario
 *  slider (if any) is actively being dragged (Companies.jsx tracks this via
 *  RepriceControl's `onDraggingChange`). Every row EXCEPT "Fully-diluted
 *  ownership" (dilution-only — the Mark/Company-valuation slider never touches
 *  it) is affected by both sliders, so only that one row's dim depends on
 *  WHICH slider is dragging.
 *  @param distributionsAffected optional bool — this company's DPI/LP
 *  distributions rows only move once it's actually realized/exited (only then
 *  does its reprice reach the fund's distribution waterfall); see FundCard. */
export function ReturnsPreviewContent({ fundStates, firmAgg, firmLpDelta, firmGpCarry, fundScope, snapshot, portfolio, onOpenFundSection, activeFundIds, companyImpact, draggingSlider, distributionsAffected }) {
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
  // Reserve capital earmarked by the current dilution posture — a modeled
  // estimate of pro-rata follow-on need. Lives in Company/Fund impact (below),
  // not Firm impact — see baseReservesEarmarked for the vs-baseline delta.
  const reserves = reservesEarmarked(portfolio);
  const baseReserves = baseReservesEarmarked(portfolio);
  return (
    <>
      <div style={{ ...sans, fontSize: 16, fontWeight: 500, color: "var(--ink-color-global-text-default)", lineHeight: "28px", marginBottom: 12 }}>Returns preview</div>

      {companyImpact && (
        <div style={{ ...sectionBox, marginBottom: 20 }}>
          <div style={sectionHeading}>Company impact</div>
          {companyImpact.map((it) => (
            <Row key={it.key} label={it.label} value={it.value} fmt={it.fmt} delta={it.delta} eps={it.eps} forceDelta alignCols
              dim={it.key === "own" ? draggingSlider === "mark" : false} />
          ))}
        </div>
      )}

      <div style={{ ...sectionBox, marginBottom: 20 }}>
        <div style={sectionHeading}>Fund impact</div>
        {funds.map((f, i) => (
          <FundCard key={f.id} f={f} snapshot={snapshot} portfolio={portfolio}
            onOpenFundSection={onOpenFundSection} isLast={i === funds.length - 1}
            reserves={reserves} baseReserves={baseReserves}
            draggingSlider={draggingSlider} distributionsAffected={distributionsAffected} />
        ))}
      </div>

      <div style={sectionBox}>
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
            <Row label="DPI" value={firmAgg.dpi} fmt={(n) => fmtX(n)} delta={firmAgg.dpi - firmBase.dpi} eps={0.005} forceDelta alignCols
              dim={draggingSlider != null && !distributionsAffected} />
            <Row label="LP distributions" value={firmAgg.lpDistributed} fmt={fmtM} delta={firmAgg.lpDistributed - firmBase.lpDistributed} forceDelta alignCols
              dim={draggingSlider != null && !distributionsAffected} />
            <Row label="Carry" value={firmGpCarry} fmt={fmtM} delta={firmGpCarry - firmBase.gpCarry} forceDelta alignCols />
          </>
        )}
      </div>
    </>
  );
}
