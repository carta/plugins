import { useMemo } from "react";
import { FS, sans, inkNum, MICRO } from "../../ui/theme.js";
import { fmtM, fmtX } from "../../ui/format.js";
import { H1, H3, MethodNote, SourceNote, FundPicker, Slider, Segmented, MultiFundPicker, fundLabel, SectionChips } from "../../ui/components.jsx";
import { TableHead, useTableSort, TableScroll } from "../../ui/table.jsx";
import { exitValueImpact, fundCompanyReturns } from "../../model/sensitivity.js";
import { returnTheFundSolutions } from "../../model/returnthefund.js";
import { useScenarioModel } from "./useScenarioModel.js";
import PowerLawChart from "./PowerLawChart.jsx";

const shortCo = (n) => n.replace(/\s*\(.*\)/, "").replace(/,? (Inc|Corp|Co|LLC|Ltd)\.?,?( dba .*)?$/i, "");
const TOP_N = 15;

/** Diverging bar from a baseline center: red = downside half, green = upside.
 *  `pct` maps a value to an x-position string within a shared scale. */
function SwingBar({ lowVal, highVal, baseVal, pct }) {
  const dLo = Math.min(lowVal, highVal), dHi = Math.max(lowVal, highVal);
  const redTo = Math.min(dHi, baseVal), greenFrom = Math.max(dLo, baseVal);
  return (
    <div style={{ position: "relative", flex: 1, height: 22 }}>
      <span style={{ position: "absolute", left: pct(baseVal), top: -2, bottom: -2, width: 1.5, background: "var(--ink-color-global-text-default)", opacity: 0.55 }} />
      {redTo > dLo && (
        <span style={{ position: "absolute", top: 4, height: 14, borderRadius: 3, background: "rgba(229,36,49,.45)",
          left: pct(dLo), width: `calc(${pct(redTo)} - ${pct(dLo)})` }} />
      )}
      {dHi > greenFrom && (
        <span style={{ position: "absolute", top: 4, height: 14, borderRadius: 3, background: "rgba(45,158,144,.5)",
          left: pct(greenFrom), width: `calc(${pct(dHi)} - ${pct(greenFrom)})` }} />
      )}
    </div>
  );
}

/** Exit-value impact — the top holdings driving this fund's Net TVPI.
 *  Built bottoms-up: each company's realizable value is scaled ±exitDelta and
 *  flowed through the LP make-whole waterfall, so Net TVPI (net LP total value
 *  over paid-in, net of carry) is an OUTPUT. Ranked by the size of that swing. */
function ExitImpactCard({ snapshot, portfolio, fs }) {
  const t = useMemo(() => exitValueImpact(snapshot, portfolio, fs), [snapshot, portfolio, fs]);
  if (t.baseMultiple == null) return null;
  const rows = t.companies.filter((c) => c.swing != null).slice(0, TOP_N);
  if (!rows.length) return null;
  // shared multiple scale across every endpoint + the baseline, with padding
  const vals = [t.baseMultiple, ...rows.flatMap((c) => [c.lowMultiple, c.highMultiple])];
  let lo = Math.min(...vals), hi = Math.max(...vals);
  const pad = Math.max(0.01, (hi - lo) * 0.08);
  lo -= pad; hi += pad;
  const pct = (v) => `${((v - lo) / (hi - lo)) * 100}%`;
  return (
    <div className="card" style={{ padding: "18px 22px 14px", marginBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap", marginBottom: 4 }}>
        <H3>Top holdings by Net TVPI impact</H3>
        <span style={{ ...sans, fontSize: FS.small, color: "var(--ink-color-global-text-subtle)" }}>
          Net TVPI around {fmtX(t.baseMultiple)} · top {Math.min(TOP_N, t.count)} of {t.count} holdings
        </span>
      </div>
      <MethodNote>
        Each holding's value is scaled ±{(t.exitDelta * 100).toFixed(0)}% and run through the LP make-whole waterfall; the bars rank where the fund's Net TVPI is most exposed.
      </MethodNote>
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "4px 0 6px", ...sans, fontSize: FS.micro, fontWeight: 600,
        color: MICRO }}>
        <span style={{ width: 150, flex: "none" }}>Holding</span>
        <span style={{ width: 54, textAlign: "right", flex: "none" }}>−{(t.exitDelta * 100).toFixed(0)}%</span>
        <span style={{ flex: 1, textAlign: "center" }}>Net TVPI</span>
        <span style={{ width: 54, textAlign: "left", flex: "none" }}>+{(t.exitDelta * 100).toFixed(0)}%</span>
        <span style={{ width: 64, textAlign: "right", flex: "none" }}>± impact</span>
      </div>
      {rows.map((c, i) => (
        <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 0",
          borderTop: `1px solid var(--ink-color-global-border-subtle)` }}>
          <span style={{ ...sans, fontSize: FS.body, fontWeight: 500, color: "var(--ink-color-global-text-default)", width: 150, flex: "none",
            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={`${c.name} · ${fmtM(c.fv)}`}>
            <span style={{ ...inkNum, color: MICRO, marginRight: 7 }}>{i + 1}</span>{shortCo(c.name)}
          </span>
          <span style={{ ...inkNum, fontSize: FS.small, color: "var(--ink-color-global-text-subtle)", width: 54, textAlign: "right", flex: "none" }}>{fmtX(Math.min(c.lowMultiple, c.highMultiple))}</span>
          <SwingBar lowVal={c.lowMultiple} highVal={c.highMultiple} baseVal={t.baseMultiple} pct={pct} />
          <span style={{ ...inkNum, fontSize: FS.small, color: "var(--ink-color-global-text-subtle)", width: 54, textAlign: "left", flex: "none" }}>{fmtX(Math.max(c.lowMultiple, c.highMultiple))}</span>
          <span style={{ ...inkNum, fontSize: FS.body, fontWeight: 700, color: "var(--ink-color-global-text-default)", width: 64, textAlign: "right", flex: "none" }}
            title="Net TVPI swing across this holding's ± range">±{fmtX(c.swing / 2)}</span>
        </div>
      ))}
      <SourceNote>
        Source: Carta Fund Admin. Each holding is scaled ±{(t.exitDelta * 100).toFixed(0)}% and flowed through the make-whole waterfall, one at a time — so the impacts rank exposure and aren't additive.
      </SourceNote>
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

const RTF_STEP = 0.25, RTF_HEADROOM = 10; // slider ceiling rides this many × above current

function ReturnTheFund({ portfolio, fundId, readOnly, target, setTarget, config, setConfig }) {
  // totals (currentMoic etc.) are target-independent — used to seed & floor the slider
  // and to list the eligible movers for the company picker.
  const totals = useMemo(() => returnTheFundSolutions(portfolio, fundId, 1), [portfolio, fundId]);
  const curMoic = totals.currentMoic || 1;
  // RTF config (per fund, per scenario): which holdings may move + max combo size.
  const cfg = config || {};
  const mode = cfg.mode === "custom" ? "custom" : "auto";
  const maxSet = cfg.maxSet ?? 3;
  const movers = totals.eligible || []; // every eligible holding — the picker's universe
  const autoPoolIds = [...movers].sort((a, b) => b.cost - a.cost).slice(0, 12).map((e) => e.id);
  const flexIds = cfg.flexIds ?? autoPoolIds; // seed custom from today's auto pool, then prune
  const candidateIds = mode === "custom" ? flexIds : null;
  // The slider is a fixed band that rides above the fund's current gross MOIC: the
  // floor is the nearest clean 0.25 step ABOVE current (e.g. 1.75× for a 1.51× fund),
  // and the ceiling is RTF_HEADROOM (10×) above that floor. Anchoring to current means
  // the target is always > current — so there are always solutions and the table never
  // blanks — and it keeps working no matter how high current is (a company repriced
  // enough to push the fund past 10× still gets a usable band above it).
  const sliderMin = Math.max(1, Math.floor(curMoic / RTF_STEP) * RTF_STEP + RTF_STEP);
  const sliderMax = sliderMin + RTF_HEADROOM;
  // `target` comes from the scenario's saved assumptions (via the parent); until this
  // scenario's slider has been dragged it's undefined → fall back to a seed just above
  // current. Clamp into the band either way.
  const t = Math.min(sliderMax, Math.max(sliderMin, target ?? Math.max(2, Math.ceil(curMoic))));
  const res = useMemo(() => returnTheFundSolutions(portfolio, fundId, t, { maxSet, candidateIds }),
    [portfolio, fundId, t, maxSet, mode, cfg.flexIds]); // candidateIds is derived from mode + flexIds
  const { currentMoic, gap, alreadyThere, solutions } = res;
  const { sorted: rtfRows, sort: rtfSort, onSort: onRtfSort } = useTableSort(solutions, RTF_COLS);
  const fill = (t - sliderMin) / RTF_HEADROOM;
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap", marginBottom: 4 }}>
        <H3>Return the fund</H3>
        <span style={{ ...sans, fontSize: FS.small, color: "var(--ink-color-global-text-subtle)" }}>which holdings, at what exit, lift the fund to a target gross MOIC</span>
      </div>
      <MethodNote>
        Gross terms (value ÷ invested cost, before fees and carry). Set a target fund gross MOIC; each row is a set of live
        holdings (up to your “Max companies” setting) that, if each exits at the same multiple on invested cost, together get the
        fund there — ranked by the lowest multiple needed. By default the search flexes the fund's largest holdings; switch to
        Custom to choose exactly which holdings may move. Other holdings stay at current marks; realized / written-off holdings can't move.
      </MethodNote>
      <div style={{ maxWidth: 440, margin: "4px 0 14px" }}>
        <Slider label="Target fund gross MOIC" value={t} min={sliderMin} max={sliderMax} step={RTF_STEP}
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
        <div style={{ display: "flex", gap: 24, flexWrap: "wrap", alignItems: "flex-start", margin: "0 0 14px" }}>
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
                <td style={{ ...sans, fontSize: FS.value, color: "var(--ink-color-global-text-default)", width: "100%" }}>{s.companies.map((c) => shortCo(c.name)).join(" + ")}</td>
                <td style={{ ...inkNum, textAlign: "right", fontSize: FS.value, fontWeight: 700 }}>{fmtX(s.m)}</td>
                <td style={{ ...inkNum, textAlign: "right", fontSize: FS.value }}
                  title={s.companies.map((c) => `${shortCo(c.name)} → ${fmtM(c.neededValue)}`).join(" · ")}>
                  {fmtM(s.companies.reduce((t, c) => t + c.neededValue, 0))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </TableScroll>
      )}
      <SourceNote>
        Source: Carta Fund Admin holdings (invested cost + value at current marks, incl. realized proceeds). Each combo assumes its
        companies exit at the same gross multiple — one illustrative path, not the only one. Company names confidential.
      </SourceNote>
    </div>
  );
}

/** Power Law tab — portfolio sensitivity: which holdings drive the fund's Net TVPI. */
export default function PowerLaw(props) {
  const { snapshot, portfolio, setFundScope, readOnly, setAssumption } = props;
  const m = useScenarioModel(props);
  const returns = useMemo(() => fundCompanyReturns(portfolio, m.fundId), [portfolio, m.fundId]);
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
  return (
    <div>
      <H1 actions={<FundPicker funds={snapshot.funds} value={m.fundId} onChange={setFundScope} includeAll={false} />}>Power Law</H1>
      <p style={{ ...sans, fontSize: FS.small, color: "var(--ink-color-global-text-subtle)", margin: "0 0 16px" }}>
        At Carta marks: {fmtX(m.cartaNet)} Net TVPI on total incl. future calls
      </p>
      <SectionChips sections={[["pl-chart", "Power law"], ["pl-return", "Return the fund"], ["pl-sensitivity", "Sensitivity"]]} />
      <section id="pl-chart" style={{ scrollMarginTop: 64 }}>
        <PowerLawChart companies={returns} fundName={fundLabel(m.fs.name)} />
      </section>
      <section id="pl-return" style={{ scrollMarginTop: 64 }}>
        {/* target is stored per fund in the scenario's assumptions, so each scenario
            keeps its own and it persists like the other scenario settings. */}
        <ReturnTheFund portfolio={portfolio} fundId={m.fundId} readOnly={readOnly}
          target={rtfTarget} setTarget={setRtfTarget} config={rtfConfig} setConfig={setRtfConfig} />
      </section>
      <section id="pl-sensitivity" style={{ scrollMarginTop: 64 }}>
        <ExitImpactCard snapshot={snapshot} portfolio={portfolio} fs={m.fs} />
      </section>
    </div>
  );
}
