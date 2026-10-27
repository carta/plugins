import { useMemo } from "react";
import { FS, sans, inkNum, MICRO } from "../../ui/theme.js";
import { fmtM, fmtX, shortCompany } from "../../ui/format.js";
import { H3, MethodNote, SourceNote, Slider, Segmented, MultiFundPicker, EmptyState, fundLabel } from "../../ui/components.jsx";
import { TableHead, useTableSort, TableScroll } from "../../ui/table.jsx";
import { fundIdsOf, ownFundHeldAs } from "../../model/funds.js";
import { exitValueImpact, fundCompanyReturns } from "../../model/sensitivity.js";
import { returnTheFundSolutions, rtfTargetBand, rtfSearch } from "../../model/returnthefund.js";
import { useScenarioModel } from "./useScenarioModel.js";
import PowerLawChart from "./PowerLawChart.jsx";
import { EXIT_IMPACT_TITLE } from "./chartTitles.js";

const TOP_N = 15;

/** Diverging bar from a baseline center: red = downside half, green = upside.
 *  `pct` maps a value to an x-position string within a shared scale. */
function SwingBar({ lowVal, highVal, baseVal, pct }) {
  const dLo = Math.min(lowVal, highVal), dHi = Math.max(lowVal, highVal);
  const redTo = Math.min(dHi, baseVal), greenFrom = Math.max(dLo, baseVal);
  return (
    <div style={{ position: "relative", height: 24, minWidth: 160 }}>
      <span style={{ position: "absolute", left: pct(baseVal), top: 0, bottom: 0, width: 1, background: "var(--ink-color-global-text-default)", opacity: 0.55 }} />
      {redTo > dLo && (
        <span data-testid="swing-bar-down" style={{ position: "absolute", top: 5, height: 14, background: "var(--local-data-viz-negative-2)",
          left: pct(dLo), width: `calc(${pct(redTo)} - ${pct(dLo)})` }} />
      )}
      {dHi > greenFrom && (
        <span data-testid="swing-bar-up" style={{ position: "absolute", top: 5, height: 14, background: "var(--local-data-viz-positive-2)",
          left: pct(greenFrom), width: `calc(${pct(dHi)} - ${pct(greenFrom)})` }} />
      )}
    </div>
  );
}

/** Exit-value impact — the top holdings driving this fund's Net TVPI.
 *  Built bottoms-up: each company's realizable value is scaled ±exitDelta and
 *  flowed through the LP make-whole waterfall, so Net TVPI (net LP total value
 *  over paid-in, net of carry) is an OUTPUT. Ranked by the size of that swing. */
function ExitImpactCard({ snapshot, portfolio, states, allMode }) {
  const t = useMemo(() => exitValueImpact(portfolio, states), [portfolio, states]);
  if (t.baseMultiple == null) return null;
  // Under All funds, leave out the firm's own funds held as companies: pooling would list that capital a second time beside the companies the other fund holds directly.
  const listed = allMode ? t.companies.filter((c) => !ownFundHeldAs(snapshot.funds, c)) : t.companies;
  const rows = listed.filter((c) => c.swing != null).slice(0, TOP_N);
  if (!rows.length) return null;
  // shared multiple scale across every endpoint + the baseline, with padding
  const vals = [t.baseMultiple, ...rows.flatMap((c) => [c.lowMultiple, c.highMultiple])];
  let lo = Math.min(...vals), hi = Math.max(...vals);
  const pad = Math.max(0.01, (hi - lo) * 0.08);
  lo -= pad; hi += pad;
  const pct = (v) => `${((v - lo) / (hi - lo)) * 100}%`;
  const pctLabel = `${(t.exitDelta * 100).toFixed(0)}%`;
  const cols = [
    { label: "Holding", align: "left" },
    { label: `−${pctLabel}` },
    { label: "Net TVPI", align: "left", labelAt: pct(t.baseMultiple) },
    { label: `+${pctLabel}`, align: "left" },
    { label: "± impact" },
  ];
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ marginBottom: 4 }}>
        <H3>{EXIT_IMPACT_TITLE}</H3>
      </div>
      <MethodNote>
        Each holding's value is scaled ±{pctLabel}, one at a time, and run through the LP make-whole waterfall; the bars rank where {allMode ? "the firm's Net TVPI across all funds" : "the fund's Net TVPI"} is most exposed, and the impacts aren't additive.
      </MethodNote>
      <TableScroll>
        <table className="ledger sheet">
          <TableHead cols={cols} />
          <tbody>
            {rows.map((c) => (
              <tr key={c.id}>
                <td style={{ ...sans, fontSize: FS.value, color: "var(--ink-color-global-text-default)", whiteSpace: "nowrap" }} title={`${c.name} · ${fmtM(c.fv)}`}>
                  {shortCompany(c.name)}
                </td>
                <td style={{ ...inkNum, textAlign: "right", fontSize: FS.value }}>{fmtX(Math.min(c.lowMultiple, c.highMultiple))}</td>
                {/* greedy column: soaks up the table's slack so the bar gets the width */}
                <td style={{ width: "100%" }}>
                  <SwingBar lowVal={c.lowMultiple} highVal={c.highMultiple} baseVal={t.baseMultiple} pct={pct} />
                </td>
                <td style={{ ...inkNum, textAlign: "left", fontSize: FS.value }}>{fmtX(Math.max(c.lowMultiple, c.highMultiple))}</td>
                <td style={{ ...inkNum, textAlign: "right", fontSize: FS.value, fontWeight: 700 }}
                  title="Net TVPI swing across this holding's ± range">±{fmtX(c.swing / 2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableScroll>
    </div>
  );
}

/** Return-the-fund backsolve — set a target fund gross MOIC; list the company
 *  combinations (each exiting at a uniform multiple on invested cost) that reach it. */
// Return-the-fund solution ranking. "#" is a display ordinal (not sortable);
// "Companies" sorts on the joined company names.
const RTF_COLS = [
  { label: "#", align: "left" },
  { label: "Companies", align: "left", get: (s) => s.companies.map((c) => c.name).join(" + ") },
  { label: "Each exits at", get: (s) => s.m },
  { label: "Combined value", get: (s) => s.companies.reduce((t, c) => t + c.neededValue, 0) },
];

const RtfHeading = () => (
  <>
    <H3>“Return the fund” analysis</H3>
    <p style={{ ...sans, fontSize: FS.small, lineHeight: "20px", color: "var(--ink-color-global-text-subtle)", margin: "0 0 12px" }}>
      Sets of live holdings whose exits would lift the fund to your target gross MOIC, lowest exit multiple first.
    </p>
  </>
);

/** Return the fund under All funds: it backsolves one fund's target, so it has no
 *  all-funds form; its heading stays over a boxed prompt to pick a fund. */
const ReturnTheFundAllFunds = () => (
  <div style={{ marginBottom: 16 }}>
    <RtfHeading />
    <div className="card empty-card">
      <EmptyState icon="pending" text="Select a fund to see an analysis of how your investments would need to perform to return the fund." />
    </div>
  </div>
);

function ReturnTheFund({ portfolio, fundId, readOnly, target, setTarget, config, setConfig }) {
  // totals (currentMoic etc.) are target-independent — used to seed & floor the slider
  // and to list the eligible movers for the company picker.
  const totals = useMemo(() => returnTheFundSolutions(portfolio, fundId, 1), [portfolio, fundId]);
  // RTF config (per fund, per scenario): which holdings may move + max combo size.
  const movers = totals.eligible || []; // every eligible holding — the picker's universe
  const { mode, maxSet, flexIds, candidateIds } = rtfSearch(config, movers);
  // `target` comes from the scenario's saved assumptions (via the parent), clamped
  // into the band that rides above the fund's current gross MOIC.
  const { min: sliderMin, max: sliderMax, step, target: t } = rtfTargetBand(totals.currentMoic, target);
  const res = useMemo(() => returnTheFundSolutions(portfolio, fundId, t, { maxSet, candidateIds }),
    [portfolio, fundId, t, maxSet, mode, config?.flexIds]); // candidateIds is derived from mode + flexIds
  const { currentMoic, gap, alreadyThere, solutions } = res;
  const { sorted: rtfRows, sort: rtfSort, onSort: onRtfSort } = useTableSort(solutions, RTF_COLS);
  const fill = (t - sliderMin) / (sliderMax - sliderMin);
  return (
    <div style={{ marginBottom: 16 }}>
      <RtfHeading />
      {/* The slider sits left; the solution-space controls sit right-aligned on the
          same row, wrapping below it on narrow widths. */}
      <div style={{ display: "flex", gap: 24, flexWrap: "wrap", alignItems: "flex-start", margin: "4px 0 14px" }}>
        <div style={{ flex: "1 1 320px", maxWidth: 440 }}>
          <Slider label="Target fund gross MOIC" value={t} min={sliderMin} max={sliderMax} step={step}
            onChange={setTarget} fmt={(v) => fmtX(v)} fill={fill} locked={readOnly}
            valueSize={FS.bodyLg} labelKind="strong" />
          <div style={{ ...sans, fontSize: FS.small, color: "var(--ink-color-global-text-subtle)", marginTop: 4 }}>
            Current gross MOIC {fmtX(currentMoic)}
            {alreadyThere ? ` — already clears ${fmtX(t)}.` : ` · needs ${fmtM(gap)} more exit value to reach ${fmtX(t)}.`}
          </div>
        </div>
        {/* Degrees of freedom on the solution space: which holdings may move, and how
            many can share one solution. Both persist per fund/scenario like the target. */}
        {!alreadyThere && (
          <div data-testid="rtf-controls" style={{ display: "flex", gap: 24, flexWrap: "wrap", alignItems: "flex-start", marginLeft: "auto" }}>
            <div>
              <div style={{ ...sans, fontSize: FS.small, color: "var(--ink-color-global-text-subtle)", marginBottom: 5 }}>Companies that can flex</div>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <Segmented small locked={readOnly} value={mode}
                  options={[{ id: "auto", label: "Auto · top holdings" }, { id: "custom", label: "Custom" }]}
                  onChange={(md) => setConfig(md === "custom" ? { mode: "custom", flexIds } : { mode: "auto" })} />
                {mode === "custom" && (
                  <MultiFundPicker label="companies" funds={movers} selected={new Set(flexIds)}
                    onChange={(set) => setConfig({ mode: "custom", flexIds: [...set] })} />
                )}
              </div>
            </div>
            <div>
              <div style={{ ...sans, fontSize: FS.small, color: "var(--ink-color-global-text-subtle)", marginBottom: 5 }}>Max companies per solution</div>
              <Segmented small locked={readOnly} value={maxSet}
                options={[1, 2, 3, 4, 5].map((n) => ({ id: n, label: String(n) }))}
                onChange={(n) => setConfig({ maxSet: n })} />
            </div>
          </div>
        )}
      </div>
      {res.poolTruncated && (
        <div style={{ ...sans, fontSize: FS.micro, color: MICRO, margin: "-6px 0 12px" }}>
          Search limited to the 14 largest-cost of your selected holdings.
        </div>
      )}
      {!alreadyThere && solutions.length === 0 && (
        <div style={{ ...sans, fontSize: FS.small, color: "var(--ink-color-global-text-subtle)", margin: "0 0 12px" }}>
          {mode === "custom" && candidateIds.length === 0
            ? "No companies selected — pick at least one holding that can flex."
            : `No combination of the selected holdings reaches ${fmtX(t)} with up to ${maxSet} ${maxSet === 1 ? "company" : "companies"} exiting — widen the selection or raise “Max companies”.`}
        </div>
      )}
      {!alreadyThere && solutions.length > 0 && (
        <TableScroll>
        <table className="ledger sheet">
          <TableHead cols={RTF_COLS} sort={rtfSort} onSort={onRtfSort} sticky />
          <tbody>
            {rtfRows.map((s, i) => (
              <tr key={i}>
                <td style={{ ...inkNum, color: MICRO }}>{i + 1}</td>
                {/* width:100% makes this the greedy column that soaks up the table's
                    slack, so the #/multiple/value columns size to their (constant)
                    content instead of a shifting slack share — otherwise every
                    column reflowed as the target slider changed the values. */}
                <td style={{ ...sans, fontSize: FS.value, color: "var(--ink-color-global-text-default)", width: "100%" }}>{s.companies.map((c) => shortCompany(c.name)).join(" + ")}</td>
                <td style={{ ...inkNum, textAlign: "right", fontSize: FS.value, fontWeight: 700 }}>{fmtX(s.m)}</td>
                <td style={{ ...inkNum, textAlign: "right", fontSize: FS.value }}
                  title={s.companies.map((c) => `${shortCompany(c.name)} → ${fmtM(c.neededValue)}`).join(" · ")}>
                  {fmtM(s.companies.reduce((t, c) => t + c.neededValue, 0))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </TableScroll>
      )}
    </div>
  );
}

/** Power Law — one of the fund's power-law charts; the Reports page's fund picker,
 *  in the jump-link bar, picks the fund. `section` picks the chart: "curve" (returns
 *  by rank), "return-the-fund" (the backsolve) or "sensitivity" (Net TVPI exposure
 *  by holding). */
export default function PowerLaw({ section, ...props }) {
  const { snapshot, portfolio, readOnly, setAssumption } = props;
  const m = useScenarioModel(props);
  // Under All funds a record that is one of the firm's own funds (a feeder investing
  // through a parallel fund) drops out: pooling would count that capital twice.
  const returns = useMemo(() => {
    if (!m.allMode) return fundCompanyReturns(portfolio, [m.fundId]);
    return fundCompanyReturns(portfolio, fundIdsOf(snapshot)).filter((c) => !ownFundHeldAs(snapshot.funds, c));
  }, [portfolio, snapshot, m.allMode, m.fundId]);
  // The Return-the-fund target lives in the scenario's assumptions (per fund), so each
  // scenario keeps its own and it persists like every other scenario setting — through
  // reloads and server restarts, not just this session.
  const rtfTarget = portfolio.assumptions?.rtfTarget?.[m.fundId];
  const setRtfTarget = (v) => setAssumption("rtfTarget", { ...(portfolio.assumptions?.rtfTarget || {}), [m.fundId]: v });
  // RTF solution-space config (which holdings flex + max combo size) — same per-fund,
  // per-scenario persistence as the target above; patch-merges so each control is independent.
  const rtfConfig = portfolio.assumptions?.rtfConfig?.[m.fundId];
  const setRtfConfig = (patch) => setAssumption("rtfConfig", {
    ...(portfolio.assumptions?.rtfConfig || {}),
    [m.fundId]: { ...(portfolio.assumptions?.rtfConfig?.[m.fundId] || {}), ...patch },
  });
  // the Net TVPI sensitivity pools every fund with paid-in capital under All funds
  const states = useMemo(() => (m.allMode ? props.fundStates : [m.fs]), [m.allMode, props.fundStates, m.fs]);
  return (
    <div>
      {section === "curve" && <PowerLawChart companies={returns} fundName={m.allMode ? "All funds" : fundLabel(m.fs.name)} allFunds={m.allMode} />}
      {/* target is stored per fund in the scenario's assumptions, so each scenario
          keeps its own and it persists like the other scenario settings. */}
      {section === "return-the-fund" && (m.allMode ? <ReturnTheFundAllFunds /> : (
        <ReturnTheFund portfolio={portfolio} fundId={m.fundId} readOnly={readOnly}
          target={rtfTarget} setTarget={setRtfTarget} config={rtfConfig} setConfig={setRtfConfig} />
      ))}
      {section === "sensitivity" && <ExitImpactCard snapshot={snapshot} portfolio={portfolio} states={states} allMode={m.allMode} />}
    </div>
  );
}
