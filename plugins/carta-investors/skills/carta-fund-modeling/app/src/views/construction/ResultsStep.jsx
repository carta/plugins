import { useMemo, useState } from "react";
import { FS, sans } from "../../ui/theme.js";
import { StatBar, EmptyState, Badge, Segmented, Btn, InfoTip } from "../../ui/components.jsx";
import { fmtMIn, fmtX, fmtPct, fmtOwn } from "../../ui/format.js";
import { stepLabel } from "../../model/construction/plan.js";
import { lightSensitivity } from "../../model/construction/engine.js";
import { peerBand } from "../../model/construction/riskMarket.js";
import { StepHeader, LiquidationTip, fmtCount, cellNum, fmtYm } from "./fields.jsx";
import { ReturnsChart, DeploymentChart } from "./charts.jsx";
import { whatItTakes } from "../../model/construction/light.js";
import { EVERGREEN_YEARS } from "../../model/construction/feeTiers.js";
import { Funnel, FundWaterfall } from "./ResultsParts.jsx";
import SummaryReport from "./SummaryReport.jsx";

export function OutcomeTable({ result, ccy }) {
  return (
    <div className="card" data-testid="results-outcomes" style={{ padding: "14px 18px", marginBottom: 12, overflowX: "auto" }}>
      <table className="ledger" style={{ minWidth: 560 }}>
        <thead><tr><th style={{ textAlign: "left" }}>Outcome</th><th>Companies</th><th>Invested</th><th>Gross multiple</th><th>Proceeds at exit</th></tr></thead>
        <tbody>{result.allocations.map((a) => (
          <tr key={a.id}>
            <td>{a.name}</td>
            <td style={cellNum}>{fmtCount(a.initialDeals)}</td>
            <td style={cellNum}>{fmtMIn(a.capital, ccy)}</td>
            <td style={cellNum}>{fmtX(a.moic)}</td>
            <td style={cellNum}>{fmtMIn(a.capital * (a.moic ?? 0), ccy)}</td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

/** Light plans: what one unicorn has to return, by itself, to pay back the whole fund. */
export function ReturnTheFund({ plan }) {
  const w = whatItTakes(plan.light, plan.general.committed);
  if (!w || !(w.invested > 0)) return null;
  const ccy = plan.general.currency;
  const nm = w.label.toLowerCase();
  return (
    <div className="card" data-testid="return-the-fund" style={{ padding: "14px 18px", margin: "16px 0 12px" }}>
      <StatBar title="Return the fund" serif={false} stats={[
        { key: "need", label: `${w.label} exit needed`, value: fmtX(w.multipleToReturnFund, 1) },
        { key: "inv", label: `Invested per ${nm}`, value: fmtMIn(w.invested, ccy) },
        { key: "fund", label: "Fund to return", value: fmtMIn(plan.general.committed, ccy) },
        { key: "yours", label: `At your ${fmtX(w.multiple, 0)}`, value: `${fmtX(w.fundMultiple)} the fund` },
      ]} />
      <div data-testid="return-the-fund-note" style={{ ...sans, fontSize: FS.small, color: "var(--ink-color-global-text-subtle)", marginTop: 8 }}>
        One {nm} has to return {fmtX(w.multipleToReturnFund, 1)} on the {fmtMIn(w.invested, ccy)} invested in it (first check plus follow-on) to pay back the fund's {fmtMIn(plan.general.committed, ccy)} of commitments on its own.{" "}
        {w.needed === 1 ? `At the ${fmtX(w.multiple, 0)} you've assumed, one ${nm} does it.` : w.needed ? `At the ${fmtX(w.multiple, 0)} you've assumed, it takes ${w.needed} ${nm}s.` : ""}
      </div>
    </div>
  );
}

const SENSITIVITY_METRICS = [
  { id: "tvpi", label: "Net TVPI", fmt: (v) => fmtX(v) },
  { id: "netIrr", label: "Net IRR", fmt: (v) => (v == null ? "—" : fmtPct(v, 1)) },
  { id: "grossMoic", label: "Gross MOIC", fmt: (v) => fmtX(v) },
];

const BLUE = "var(--ink-color-global-data-viz-blue-3)";
const mix = (color, pct) => `color-mix(in srgb, ${color} ${pct}%, transparent)`;
const pctText = (v) => (v == null ? "—" : v < 0.005 ? "<1%" : `${Math.round(v * 100)}%`);

/** Light plans: returns by unicorn count and multiple; `risk` adds each count's odds, loss/target marks and peer or S&P shading. */
export function SensitivityGrid({ plan, compact = false, risk = null }) {
  const s = useMemo(() => lightSensitivity(plan), [plan]);
  const [metric, setMetric] = useState("tvpi");
  const [shade, setShade] = useState("range");
  if (!s) return null;
  const m = SENSITIVITY_METRICS.find((x) => x.id === metric);
  const odds = risk?.odds;
  const peers = risk?.peers?.thresholds?.[metric] ? risk.peers : null;
  const spRate = metric === "netIrr" ? risk?.spRate ?? null : null;
  const mode = shade === "peers" && peers ? "peers" : shade === "public" && spRate != null ? "public" : "range";
  const explainer = `${m.label} if the fund gets a different number of ${s.label.toLowerCase()}s, or they return a different multiple. Other outcomes stay as entered; the rest of the companies fail. The outlined cell is this plan.`;
  // Compact: each cell shaded on one blue ramp by its value, so the grid reads as a heatmap.
  const vals = s.rows.flatMap((r) => r.cells.filter(Boolean).map((c) => c[metric])).filter((v) => v != null);
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const ramp = (v) => (compact && v != null && hi > lo ? mix(BLUE, Math.round(6 + ((v - lo) / (hi - lo)) * 44)) : undefined);
  const PEER_FILL = [undefined, mix(BLUE, 14), mix(BLUE, 30), mix(BLUE, 52)];
  const fill = (v) => {
    if (mode === "peers") return PEER_FILL[peerBand(v, peers.thresholds[metric])];
    if (mode === "public") return v == null ? undefined : v >= spRate ? mix("var(--ink-color-global-data-viz-positive-3)", 26) : mix("var(--ink-color-global-data-viz-negative-3)", 18);
    return ramp(v);
  };
  const head = { ...sans, fontSize: FS.small, color: "var(--ink-color-global-text-subtle)", fontWeight: 600 };
  const shadeOptions = [{ id: "range", label: "Plan range" }, ...(peers ? [{ id: "peers", label: "Peers", testId: "shade-peers" }] : []), ...(spRate != null ? [{ id: "public", label: "S&P", testId: "shade-public" }] : [])];
  const target = risk?.odds?.target;
  return (
    <div className="card" data-testid="sensitivity" style={{ padding: "14px 18px", margin: compact ? "0 0 16px" : "16px 0 12px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 4 }}>
        <div style={{ ...sans, fontSize: FS.bodyLg, fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 6 }}>
          Sensitivity: {s.label.toLowerCase()}s{compact && <InfoTip label="About the sensitivity grid" portal>{explainer}</InfoTip>}
        </div>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          {shadeOptions.length > 1 && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
              <span style={{ ...sans, fontSize: FS.small, color: "var(--ink-color-global-text-subtle)" }}>Shade by</span>
              <Segmented small value={mode} options={shadeOptions} onChange={setShade} />
            </span>
          )}
          <Segmented small value={metric} options={SENSITIVITY_METRICS.map(({ id, label }) => ({ id, label }))} onChange={setMetric} />
        </span>
      </div>
      {!compact && <div style={{ ...sans, fontSize: FS.small, color: "var(--ink-color-global-text-subtle)", marginBottom: 10 }}>{explainer}</div>}
      <div style={{ overflowX: "auto" }}>
        <table className="ledger" style={{ minWidth: 520 }}>
          <thead>
            <tr>
              <th style={{ ...head, textAlign: "left" }} rowSpan={2}>{s.label}s</th>
              {odds && <th style={{ ...head, textAlign: "right" }} rowSpan={2} title={`Chance the fund ends up with exactly this many ${s.label.toLowerCase()}s`}>Chance</th>}
              <th style={{ ...head, textAlign: "center" }} colSpan={s.multiples.length}>{s.label} gross multiple</th>
            </tr>
            <tr>{s.multiples.map((x) => <th key={x} style={{ fontWeight: x === s.current.multiple ? 700 : 500 }}>{fmtX(x, x % 1 ? 1 : 0)}</th>)}</tr>
          </thead>
          <tbody>{s.rows.map((r) => (
            <tr key={r.count} data-testid={`sens-row-${r.count}`}>
              <td style={{ fontWeight: r.count === s.current.count ? 700 : 500 }}>{r.count}</td>
              {odds && <td data-testid={`sens-chance-${r.count}`} style={{ ...cellNum, color: "var(--ink-color-global-text-subtle)" }}>{pctText(odds.byCount[r.count] ?? 0)}</td>}
              {r.cells.map((c, j) => {
                const here = r.count === s.current.count && s.multiples[j] === s.current.multiple;
                const loses = c && risk && c.tvpi != null && c.tvpi < 1;
                const hits = c && target > 0 && c.grossMoic != null && c.grossMoic >= target - 1e-9;
                return (
                  <td key={j} data-testid={here ? "sens-current" : undefined} aria-current={here || undefined}
                    title={c ? [loses ? "LPs get back less than they paid in" : null, hits ? `Reaches the ${fmtX(target)} gross target` : null].filter(Boolean).join(". ") || undefined : "More survivors than companies"}
                    style={{ ...cellNum, background: c ? fill(c[metric]) : undefined, fontWeight: here ? 700 : 400, outline: here ? "2px solid var(--ink-button-background-color-primary-base-default)" : "none", outlineOffset: -2,
                      color: !c ? "var(--ink-color-global-text-subtle)" : loses ? "var(--ink-color-global-feedback-negative-strong)" : "var(--ink-color-global-text-default)" }}>
                    {c ? m.fmt(c[metric]) : "—"}{hits && <span data-testid="sens-hit" aria-label="reaches target" style={{ marginLeft: 4, fontSize: FS.micro, color: "var(--ink-color-global-feedback-positive-strong)" }}>✓</span>}
                  </td>
                );
              })}
            </tr>
          ))}</tbody>
        </table>
      </div>
      {risk && (
        <div data-testid="sens-legend" style={{ ...sans, fontSize: FS.micro, color: "var(--ink-color-global-text-subtle)", marginTop: 8, display: "grid", gap: 4 }}>
          <div>{target > 0 ? <><span style={{ color: "var(--ink-color-global-feedback-positive-strong)" }}>✓</span> reaches the {fmtX(target)} gross target · </> : null}<span style={{ color: "var(--ink-color-global-feedback-negative-strong)" }}>Red</span> net TVPI is under 1.0×, so LPs lose money.</div>
          {mode === "peers" && (
            <div data-testid="sens-peer-legend">
              Shaded by rank among Carta's {peers.label} funds: lightest from the median ({m.fmt(peers.thresholds[metric][0].value)}), then top quartile ({m.fmt(peers.thresholds[metric][1].value)}), darkest top decile ({m.fmt(peers.thresholds[metric][2].value)}).
              Those funds are still maturing, so treat this as a yardstick for the plan's final result, not a forecast.
            </div>
          )}
          {mode === "public" && <div data-testid="sens-public-legend">Green beats the S&amp;P 500's long-run {fmtPct(spRate, 1)} a year; red falls short of it. A simple yearly rate, not a same-cash-flow comparison.</div>}
        </div>
      )}
    </div>
  );
}

/** Finalizing opens the model view; the steps stay editable afterwards. */
function FinalizeBar({ plan, onFinalize }) {
  if (!onFinalize) return null;
  return (
    <div data-testid="finalize-bar" className="card" style={{ ...sans, padding: "14px 18px", marginBottom: 16, display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap",
      background: "var(--accent-soft)" }}>
      <div style={{ flex: 1, minWidth: 240 }}>
        <div style={{ fontSize: FS.bodyLg, fontWeight: 600 }}>{plan.finalizedAt ? "Back to the model" : "Happy with this plan?"}</div>
        <div style={{ fontSize: FS.small, color: "var(--ink-color-global-text-subtle)", marginTop: 2 }}>
          {plan.finalizedAt ? "Your changes are already in the model." : "Finalize it to open the full model view."} You can always come back to these steps to keep adjusting and iterating.
        </div>
      </div>
      <Btn kind="primary" size="comfortable" onClick={onFinalize} data-testid="finalize-plan">{plan.finalizedAt ? "View model" : "Finalize model"}</Btn>
    </div>
  );
}

export default function ResultsStep({ plan, result, onStep, onFinalize, snapshot, companies }) {
  const ccy = plan.general.currency;
  if (!result?.ok) {
    const blocked = result?.blockedBy ?? [];
    return (
      <div data-testid="results-step">
        <StepHeader title="Summary" />
        <EmptyState icon="pending" text="Finish these steps to see the summary">
          <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
            {blocked.map((id) => (
              <button key={id} onClick={() => onStep(id)} data-testid={`fix-${id}`} className="btn-ghost" style={{ ...sans, fontSize: FS.small, padding: "6px 12px", borderRadius: 4, cursor: "pointer", border: "1px solid var(--ink-color-global-border-subtle)", background: "transparent", color: "var(--ink-color-global-text-default)" }}>{stepLabel(id)}</button>
            ))}
          </div>
        </EmptyState>
      </div>
    );
  }
  const t = result.totals;
  const light = plan.mode === "light";
  return (
    <div data-testid="results-step">
      <StepHeader title="Summary">
        Everything this plan assumes, with the outcome it produces. Net figures are after fees, expenses and carry; gross figures are before them. The full analysis is in the model view once you finalize.
      </StepHeader>
      {result.warnings.map((w) => (
        <div key={w} role="alert" style={{ ...sans, fontSize: FS.small, marginBottom: 10, display: "flex", gap: 8, alignItems: "center" }}>
          <Badge tone="warning">CHECK</Badge>{w}
        </div>
      ))}
      <SummaryReport plan={plan} result={result} snapshot={snapshot} companies={companies} />
      <div data-testid="results-end-note" style={{ ...sans, fontSize: FS.micro, color: "var(--ink-color-global-text-subtle)", margin: "0 0 16px", display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
        {t.liquidatedAt ? (
          <>
            <span>Companies still held when the fund ends ({fmtYm(t.liquidatedAt)}) are sold at {light ? "their value on that date" : "their last round's post-money valuation"}: {fmtMIn(t.liquidation, ccy)} of this plan's proceeds.</span>
            <LiquidationTip endLabel={fmtYm(t.liquidatedAt)} light={light} />
          </>
        ) : (
          <span>Evergreen: holdings still active at the end of the modeled {EVERGREEN_YEARS} years are valued at {light ? "their value on that date" : "their last round's post-money valuation"}. RVPI is the LPs' share of that value after carry.</span>
        )}
      </div>
      <FinalizeBar plan={plan} onFinalize={onFinalize} />
    </div>
  );
}
