import { FS, sans, inkNum, MICRO } from "../../ui/theme.js";
import { Btn, Badge, Segmented } from "../../ui/components.jsx";
import { fmtCheckIn, fmtX, fmtPct } from "../../ui/format.js";
import { MARKET_SWINGS, EXIT_SPREADS, SELECTION, SURVIVAL, objectiveOf } from "../../model/construction/monteCarlo.js";
import { GOALS, fewestCompanies } from "../../model/construction/optimize.js";
import { fmtCount } from "./fields.jsx";
import { SplitChart, CheckReserveMap, CompaniesChart, C_RANGE, C_PLAN, fmtScore } from "./MonteCarloCharts.jsx";
import DeepDive, { METRICS } from "./MonteCarloDeepDive.jsx";

const subtle = { color: "var(--ink-color-global-text-subtle)" };
const num = { ...inkNum, textAlign: "right", whiteSpace: "nowrap" };
const panel = { border: "1px solid var(--ink-color-global-border-subtle)", borderRadius: 8, padding: "14px 16px" };
const heading = { ...sans, fontSize: FS.body, fontWeight: 700, margin: "0 0 8px", display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" };

export { fmtScore };

/** One line per allocation, e.g. "Seed: 60% → 70% of capital, first check $1.0M → $1.3M". */
export function changeLines(changes, ccy) {
  const byAlloc = [];
  for (const c of changes) {
    let g = byAlloc.find((x) => x.id === c.id);
    if (!g) byAlloc.push((g = { id: c.id, name: c.name, parts: [], dropped: false }));
    if (c.field === "share" && !(c.to > 0)) g.dropped = true;
    const v = (x) => (c.field === "check" ? fmtCheckIn(x, ccy) : fmtPct(x, 0));
    const what = { share: "of capital", check: "first check", reserve: "held for follow-ons" }[c.field];
    const note = c.fromOwnership ? " (a fixed amount instead of an ownership target)" : "";
    g.parts.push(c.field === "share" ? `${v(c.from)} → ${v(c.to)} ${what}` : `${what} ${v(c.from)} → ${v(c.to)}${note}`);
  }
  return byAlloc.map((g) => (g.dropped ? `${g.name}: dropped (was ${g.parts[0].split(" → ")[0]} of capital)` : `${g.name}: ${g.parts.join(", ")}`));
}

export const changeText = (changes, ccy) => (changes.length ? changeLines(changes, ccy).join(" · ") : "Same as your plan today");

/** What a strategy changes, as short tags: "Seed 95%", "Seed $500K", "Seed 10% held", "Series A dropped". */
export function changeTags(changes, ccy) {
  const out = [];
  for (const c of changes) {
    if (c.field === "share") out.push(c.to > 0 ? `${c.name} ${fmtPct(c.to, 0)}` : `${c.name} dropped`);
    else if (c.field === "check") out.push(`${c.name} ${fmtCheckIn(c.to, ccy)} checks`);
    else out.push(`${c.name} ${fmtPct(c.to, 0)} held`);
  }
  return out;
}

export function Tags({ items }) {
  if (!items.length) return <span style={{ ...sans, fontSize: FS.micro, ...subtle }}>No changes</span>;
  return (
    <span style={{ display: "inline-flex", gap: 4, flexWrap: "wrap" }}>
      {items.map((t) => (
        <span key={t} style={{ ...sans, fontSize: FS.micro, padding: "1px 7px", borderRadius: 10, whiteSpace: "nowrap",
          background: "var(--ink-color-global-surface-lightgray-default)", color: "var(--ink-color-global-text-default)" }}>{t}</span>
      ))}
    </span>
  );
}

const lcFirst = (t) => t.charAt(0).toLowerCase() + t.slice(1);
const spreadOf = (row, metric) => (metric === "gross" ? row.summary.gross : row.summary.net);
const rowLabel = (r) => (r.base ? "Your plan today" : r.rank === 1 ? "Best option" : `Option ${r.rank}`);

/** Shared axis for range bars: every option's P10–P90 and the target, with round tick marks. */
export function rangeAxis(spreads, target) {
  const lo = Math.min(...spreads.map((s) => s.p10), target ?? Infinity, 1);
  const hi = Math.max(...spreads.map((s) => s.p90), target ?? 0, 1);
  const min = Math.max(0, Math.floor(lo * 4) / 4), max = Math.ceil(hi * 4) / 4;
  const step = max - min > 3 ? 1 : 0.5;
  const ticks = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) ticks.push(Math.round(v * 10) / 10);
  const pos = (v) => `${((v - min) / (max - min || 1)) * 100}%`;
  return { pos, ticks };
}

function AxisTicks({ axis }) {
  return (
    <div style={{ position: "relative", height: 16 }}>
      {axis.ticks.map((v) => (
        <span key={v} style={{ ...inkNum, position: "absolute", left: axis.pos(v), transform: "translateX(-50%)", fontSize: FS.micro, color: MICRO }}>{fmtX(v, v % 1 ? 1 : 0)}</span>
      ))}
    </div>
  );
}

export function RangeBar({ net, axis, target, current, height = 18 }) {
  const color = current ? C_PLAN : C_RANGE;
  const { pos } = axis;
  const mid = height / 2;
  return (
    <div style={{ position: "relative", height }} title={`Bad case ${fmtX(net.p10)} · median ${fmtX(net.p50)} · good case ${fmtX(net.p90)}`}>
      {axis.ticks.map((v) => <span key={v} style={{ position: "absolute", left: pos(v), top: 0, bottom: 0, borderLeft: "1px solid var(--ink-color-global-border-subtle)", opacity: 0.6 }} />)}
      {target != null && <span style={{ position: "absolute", left: pos(target), top: -3, bottom: -3, borderLeft: "2px dashed var(--ink-color-global-text-subtle)", opacity: 0.6 }} />}
      <span style={{ position: "absolute", left: pos(net.p10), width: `calc(${pos(net.p90)} - ${pos(net.p10)})`, top: mid - 1, height: 2, background: color, opacity: 0.7 }} />
      <span style={{ position: "absolute", left: pos(net.p25), width: `calc(${pos(net.p75)} - ${pos(net.p25)})`, top: mid - 5, height: 10, background: color, borderRadius: 5, opacity: 0.55 }} />
      <span style={{ position: "absolute", left: `calc(${pos(net.p50)} - 7px)`, top: mid - 7, width: 14, height: 14, borderRadius: 7, background: color,
        boxShadow: "0 0 0 2px var(--ink-color-global-surface-background-default)" }} />
    </div>
  );
}

function RangeLegend({ target }) {
  const item = { display: "inline-flex", alignItems: "center", gap: 5 };
  return (
    <div style={{ ...sans, fontSize: FS.micro, ...subtle, display: "flex", gap: 14, flexWrap: "wrap" }}>
      <span style={item}><span style={{ width: 9, height: 9, borderRadius: 5, background: C_RANGE }} />Median</span>
      <span style={item}><span style={{ width: 18, height: 7, borderRadius: 4, background: C_RANGE, opacity: 0.55 }} />Middle half</span>
      <span style={item}><span style={{ width: 18, height: 2, background: C_RANGE, opacity: 0.7 }} />Bad to good case (P10–P90)</span>
      <span style={item}><span style={{ width: 9, height: 9, borderRadius: 5, background: C_PLAN }} />Your plan today</span>
      {target && <span style={item}><span style={{ width: 0, height: 10, borderLeft: "2px dashed var(--ink-color-global-text-subtle)" }} />Target</span>}
    </div>
  );
}

function Compare({ out, base, pick, ccy, metric }) {
  const target = metric === "net" ? out.target : null;
  const axis = rangeAxis([spreadOf(base, metric), spreadOf(pick, metric)], target);
  const delta = spreadOf(pick, metric).p50 - spreadOf(base, metric).p50;
  const col = (row, testId) => (
    <div data-testid={testId} style={{ minWidth: 0 }}>
      <div style={{ ...sans, fontSize: FS.small, fontWeight: 700 }}>{rowLabel(row)}</div>
      <div style={{ margin: "4px 0 6px", minHeight: 20 }}>{row.base ? <span style={{ ...sans, fontSize: FS.micro, ...subtle }}>{fmtCount(row.facts.companies)} companies</span> : <Tags items={changeTags(row.changes, ccy)} />}</div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <span style={{ ...inkNum, fontSize: 30, fontWeight: 700, lineHeight: 1 }}>{fmtX(spreadOf(row, metric).p50)}</span>
        {!row.base && Math.abs(delta) >= 0.005 && <Badge tone={delta > 0 ? "positive" : "negative"}>{delta > 0 ? "+" : "−"}{fmtX(Math.abs(delta))}</Badge>}
      </div>
      <div style={{ ...sans, fontSize: FS.micro, ...subtle, marginTop: 2 }}>median {metric === "gross" ? "gross MOIC" : "net TVPI"} · average {fmtX(spreadOf(row, metric).mean)}</div>
    </div>
  );
  const metrics = [
    [`Chance of ${fmtX(out.target, 1)} net or more`, (r) => fmtPct(r.summary.chanceTarget, 0)],
    ["Chance the portfolio returns the fund", (r) => fmtPct(r.summary.chanceReturnFund, 0)],
    ["Fund returners per fund", (r) => (r.summary.returners ?? 0).toFixed(2)],
    ["Chance reserves run short", (r) => fmtPct(r.summary.chanceShort, 0)],
  ];
  const same = pick.base;
  return (
    <div data-testid="mc-compare" style={{ ...panel, padding: "18px 20px" }}>
      <div style={{ display: "grid", gridTemplateColumns: same ? "1fr" : "repeat(2, minmax(0, 1fr))", gap: 20 }}>
        {col(base, "mc-base")}
        {!same && col(pick, "mc-pick")}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "100px minmax(0, 1fr)", columnGap: 12, rowGap: 6, alignItems: "center", marginTop: 18 }}>
        <span style={{ ...sans, fontSize: FS.micro, ...subtle }}>Your plan</span><RangeBar net={spreadOf(base, metric)} axis={axis} target={target} current />
        {!same && <><span style={{ ...sans, fontSize: FS.micro, ...subtle }}>{rowLabel(pick)}</span><RangeBar net={spreadOf(pick, metric)} axis={axis} target={target} /></>}
        <span /><AxisTicks axis={axis} />
      </div>
      <table style={{ width: "100%", marginTop: 14, borderCollapse: "collapse", ...sans, fontSize: FS.small }}>
        <thead>
          <tr style={{ ...sans, fontSize: FS.micro, ...subtle }}>
            <th style={{ textAlign: "left", fontWeight: 400, padding: "0 0 4px" }} />
            <th style={{ textAlign: "right", fontWeight: 400, padding: "0 0 4px" }}>Your plan</th>
            {!same && <th style={{ textAlign: "right", fontWeight: 400, padding: "0 0 4px" }}>{rowLabel(pick)}</th>}
          </tr>
        </thead>
        <tbody>
          {metrics.map(([label, v]) => (
            <tr key={label} style={{ borderTop: "1px solid var(--ink-color-global-border-subtle)" }}>
              <td style={{ padding: "6px 0", ...subtle }}>{label}</td>
              <td style={{ ...num, padding: "6px 0", width: "22%" }}>{v(base)}</td>
              {!same && <td style={{ ...num, padding: "6px 0", width: "22%", fontWeight: 700 }}>{v(pick)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Verdict({ out, pick }) {
  const best = out.strategies[0];
  if (!best) return null;
  const obj = lcFirst(objectiveOf(out.objective).short);
  const score = (r) => fmtScore(out.objective, r.summary.score);
  let text;
  if (pick.base) text = `Your plan today scores ${score(out.base)} on ${obj}; the best option found scores ${score(best)}.`;
  else if (pick.rank !== 1) text = `Option ${pick.rank}: ${score(pick)} on ${obj}, against ${score(out.base)} today and ${score(best)} for the best.`;
  else if (best.isCurrent) text = `Your plan today is already the best option found on ${obj}.`;
  else if (out.beatsCurrentClearly) text = `Clearly better than today on ${obj}: ${score(best)} against ${score(out.base)}.`;
  else text = `Slightly ahead on ${obj} (${score(best)} against ${score(out.base)}), but too close to call: the gap is within the simulation's noise.`;
  const ties = out.strategies.filter((x) => x.tie).map((x) => x.rank);
  if (pick.rank === 1 && ties.length) text += ` Option${ties.length > 1 ? "s" : ""} ${ties.join(", ")} ${ties.length > 1 ? "are" : "is"} just as good.`;
  const b = out.base.summary;
  const skew = b.net.mean > 0 && b.net.p50 < b.net.mean * 0.85;
  return (
    <div style={{ marginBottom: 12 }}>
      <div data-testid="mc-headline" style={{ ...sans, fontSize: FS.bodyLg, fontWeight: 600 }}>{text}</div>
      {skew && (
        <div data-testid="mc-skew" style={{ ...sans, fontSize: FS.small, ...subtle, marginTop: 4 }}>
          Most simulated funds land below the plan's expected {fmtX(out.base.expected?.tvpi)}: a few big winners lift the average. {fmtPct(b.chanceAboveExpected ?? 0, 0)} reach it.
        </div>
      )}
    </div>
  );
}

function Options({ rows, out, selected, onSelect, ccy, metric }) {
  const target = metric === "net" ? out.target : null;
  const axis = rangeAxis(rows.map((r) => spreadOf(r, metric)), target);
  const cols = "28px minmax(0, 1.4fr) minmax(140px, 2fr) 56px";
  return (
    <div data-testid="mc-options">
      <div style={{ display: "grid", gridTemplateColumns: cols, gap: 12, padding: "0 12px 4px", alignItems: "end" }}>
        <span /><span style={{ ...sans, fontSize: FS.micro, ...subtle }}>Option</span><AxisTicks axis={axis} /><span style={{ ...sans, fontSize: FS.micro, ...subtle, textAlign: "right" }}>Median</span>
      </div>
      <div style={{ border: "1px solid var(--ink-color-global-border-subtle)", borderRadius: 8, overflow: "hidden" }}>
        {rows.map((r, i) => {
          const on = selected === r.key;
          return (
            <button key={r.key} type="button" data-testid={`mc-row-${r.key}`} onClick={() => onSelect(r.key)} aria-pressed={on}
              style={{ ...sans, display: "grid", gridTemplateColumns: cols, gap: 12, alignItems: "center", width: "100%", textAlign: "left", padding: "9px 12px", border: "none",
                borderTop: i ? "1px solid var(--ink-color-global-border-subtle)" : "none", cursor: "pointer",
                boxShadow: on ? "inset 3px 0 0 var(--ink-button-background-color-primary-base-default)" : "none",
                background: on ? "var(--accent-soft)" : "var(--ink-color-global-surface-background-default)", color: "var(--ink-color-global-text-default)" }}>
              <span style={{ ...inkNum, fontSize: FS.small, fontWeight: 700, ...(r.base ? subtle : {}) }}>{r.base ? "—" : r.rank}</span>
              <span style={{ minWidth: 0, display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                {r.base ? <b style={{ fontSize: FS.small }}>Your plan today</b> : <Tags items={changeTags(r.changes, ccy)} />}
                {r.rank === 1 && <Badge tone="positive">Best</Badge>}
                {r.tie && <Badge tone="warning" title="Within the noise of the simulation: too close to call against the best.">Tie</Badge>}
                {r.isCurrent && <Badge tone="neutral">Same as today</Badge>}
              </span>
              <RangeBar net={spreadOf(r, metric)} axis={axis} target={target} current={r.base} />
              <span style={{ ...num, fontWeight: 700, fontSize: FS.small }}>{fmtX(spreadOf(r, metric).p50)}</span>
            </button>
          );
        })}
      </div>
      <div style={{ marginTop: 8 }}><RangeLegend target={target} /></div>
    </div>
  );
}

const EXPLORE_TITLE = { split: "How each option splits the capital", checks: "First check against held for follow-ons", companies: "More or fewer companies" };

function Explore({ out, rows, ccy }) {
  return (
    <div data-testid="mc-section-explore">
      <div style={heading}>{EXPLORE_TITLE[out.goal]}</div>
      {out.goal === "split" && <SplitChart rows={rows} allocations={out.base.facts.allocations} />}
      {out.goal === "checks" && out.chart.heatmaps.map((m) => (
        <CheckReserveMap key={m.id} map={m} objective={out.objective} ccy={ccy} screenRuns={out.screenRuns} current={out.base.facts.allocations.find((a) => a.id === m.id)} />
      ))}
      {out.goal === "companies" && <CompaniesChart target={out.targetCompanies} points={out.chart.nearby} splitChanged={out.chart.splitChanged} />}
    </div>
  );
}

/** The run's settings in words, matching the setup's names. */
export function settingsLine(s) {
  const name = (list, id) => list.find((m) => m.id === id)?.label.toLowerCase() ?? "off";
  return [
    `${s.runs.toLocaleString("en-US")} simulated funds`,
    `market cycles ${name(MARKET_SWINGS, s.market)}`,
    `exit size spread ${name(EXIT_SPREADS, s.spread)}`,
    `follow-on picking skill ${name(SELECTION, s.selection ?? "some")}`,
    `survival boost ${name(SURVIVAL, s.survival ?? "off")}`,
  ].join(" · ");
}

export default function Results({ plan, out, stale, metric, setMetric, selected, setSelected, onEditSetup, runAgain, onApply, onSaveCopy }) {
  const ccy = plan.general.currency;
  const rows = [...out.strategies.map((s) => ({ ...s, key: `s${s.rank}` })),
    { key: "base", base: true, facts: out.base.facts, summary: out.base.summary, changes: [] }];
  // The comparison starts on the best option that differs from today's plan.
  const defaultPick = rows.find((r) => !r.base && !r.isCurrent) ?? rows[rows.length - 1];
  const pick = rows.find((r) => r.key === selected) ?? defaultPick;
  const base = rows[rows.length - 1];
  const few = out.strategies.length === 0 && out.goal === "companies" ? fewestCompanies(plan) : null;
  return (
    <div data-testid="mc-results" style={{ maxWidth: 1100, margin: "0 auto", padding: "18px 24px 28px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ ...sans, fontSize: FS.h3, fontWeight: 700 }}>{GOALS.find((g) => g.id === out.goal)?.label}</span>
          <Tags items={[`Ranked by ${lcFirst(objectiveOf(out.objective).label)}`, `${out.settings.runs.toLocaleString("en-US")} funds each`]} />
        </div>
        <span style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <Segmented small value={metric} onChange={setMetric} options={METRICS} />
          <Btn onClick={onEditSetup} data-testid="mc-edit-setup">Edit setup</Btn>
          {runAgain}
        </span>
      </div>
      {stale && (
        <div data-testid="mc-stale" style={{ ...sans, fontSize: FS.small, padding: "8px 12px", borderRadius: 6, marginBottom: 12,
          background: "var(--ink-color-global-feedback-neutral-subtle)", color: "var(--ink-color-global-text-default)" }}>
          Your plan has changed since this run. Run again to update it, then apply an option.
        </div>
      )}
      {out.strategies.length === 0 && (
        <div data-testid="mc-no-options" role="alert" style={{ ...panel, marginBottom: 14, background: "var(--ink-color-global-feedback-neutral-subtle)" }}>
          <div style={{ ...sans, fontSize: FS.bodyLg, fontWeight: 700, marginBottom: 4 }}>No strategy reached the goal, so there's nothing to compare yet</div>
          <div style={{ ...sans, fontSize: FS.small, lineHeight: 1.5 }}>
            {out.goal === "companies"
              ? `No mix of first checks and reserves backs about ${fmtCount(out.targetCompanies)} companies: the checks it would take are bigger than the round they go into.${few ? ` This plan can back no fewer than about ${Math.ceil(few.companies)}.` : ""}`
              : "Every option tried broke a limit, such as a first check bigger than its round."} Below is your plan as it is today.
          </div>
          <div style={{ marginTop: 10 }}><Btn kind="primary" onClick={onEditSetup} data-testid="mc-no-options-edit">Change the setup</Btn></div>
        </div>
      )}
      <Verdict out={out} pick={pick} />
      <Compare out={out} base={base} pick={pick} ccy={ccy} metric={metric} />
      {!pick.base && !pick.isCurrent && !stale && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "12px 0 0", alignItems: "center" }}>
          <Btn kind="primary" onClick={() => onApply(pick)} data-testid="mc-apply">Apply {pick.rank === 1 ? "the best option" : `option ${pick.rank}`} to this plan</Btn>
          <Btn onClick={() => onSaveCopy(pick)} data-testid="mc-save-copy">Save as a new plan</Btn>
          <span style={{ ...sans, fontSize: FS.micro, ...subtle }}>{changeText(pick.changes, ccy)}</span>
        </div>
      )}
      <div style={{ display: "grid", gap: 20, marginTop: 24 }}>
        <div>
          <div style={heading}>All options <span style={{ ...sans, fontWeight: 400, fontSize: FS.micro, ...subtle }}>click one to compare it and look inside</span></div>
          <Options rows={rows} out={out} selected={pick.key} onSelect={setSelected} ccy={ccy} metric={metric} />
        </div>
        {out.strategies.length > 0 && <Explore out={out} rows={rows.map((r) => ({ ...r, label: rowLabel(r) }))} ccy={ccy} />}
      </div>
      <DeepDive plan={plan} out={out} row={pick} metric={metric} label={rowLabel(pick)} />
      <div style={{ borderTop: "1px solid var(--ink-color-global-border-subtle)", marginTop: 20, paddingTop: 12 }}>
        <div style={heading}>How this was run</div>
        <ul data-testid="mc-caveats" style={{ ...sans, fontSize: FS.small, lineHeight: 1.7, margin: 0, paddingLeft: 18 }}>
          <li>{out.screened} options screened on {(out.screenRuns ?? 300).toLocaleString("en-US")} simulated funds each; the best five and your plan re-run on a fresh {out.settings.runs.toLocaleString("en-US")}.</li>
          <li>Rounds, prices and odds come from the Market step. {settingsLine(out.settings)}.</li>
          <li style={subtle}>Checks above pro-rata aren't modeled. Companies move together only through market cycles. Fees are the plan's expected amounts. Recycling is left out.</li>
        </ul>
      </div>
    </div>
  );
}
