// Results pieces shared by the plain (Light) page and the tabbed (Advanced) dashboard.
import { FS, sans } from "../../ui/theme.js";
import { fmtMIn, fmtX, fmtPct, fmtOwn } from "../../ui/format.js";
import { fmtCount, cellNum } from "./fields.jsx";
import { waterfallTerms } from "../../model/construction/plan.js";

export function Funnel({ a, ccy }) {
  return (
    <div className="card" style={{ padding: "14px 18px", marginBottom: 12 }}>
      <div style={{ ...sans, fontSize: FS.bodyLg, fontWeight: 600, marginBottom: 2 }}>{a.name}</div>
      <div style={{ ...sans, fontSize: FS.small, color: "var(--ink-color-global-text-subtle)", marginBottom: 8 }}>
        {fmtCount(a.initialDeals)} initial checks of {fmtMIn(a.initialCheck, ccy)} · {fmtOwn(a.entryOwnership)} entry ownership · expected {fmtX(a.moic)}
      </div>
      <div style={{ overflowX: "auto" }}>
        <table className="ledger" style={{ minWidth: 560 }}>
          <thead><tr><th style={{ textAlign: "left" }}>Round</th><th>Companies reaching it</th><th>Exit here</th><th>Fail here</th><th>Go on to raise</th><th>Ownership</th></tr></thead>
          <tbody>{a.funnel.map((f) => (
            <tr key={f.stage}>
              <td>{f.name}</td>
              <td style={cellNum}>{fmtCount(f.reached)}</td>
              <td style={cellNum}>{fmtCount(f.exited)}</td>
              <td style={cellNum}>{fmtCount(f.failed)}</td>
              <td style={cellNum}>{fmtCount(f.graduated)}</td>
              <td style={cellNum}>{fmtOwn(f.ownership)}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </div>
  );
}

/** The fund's actual cash flows, split tier by tier over its whole life. */
export function FundWaterfall({ plan, result }) {
  const wf = result.waterfall;
  const w = plan.waterfall;
  const ccy = plan.general.currency;
  const { european, prefOn, catchupOn } = waterfallTerms(w);
  const p = wf.parts;
  const bandName = (i) => {
    const b = wf.bands[i], next = wf.bands[i + 1];
    return wf.bands.length > 1 ? `Carried interest, ${fmtX(b.fromMultiple, 2).replace(/\.?0+×$/, "×")}${next ? ` to ${fmtX(next.fromMultiple, 2).replace(/\.?0+×$/, "×")}` : " and up"} (${fmtPct(b.rate, 0)})` : `Carried interest (${fmtPct(b.rate, 0)})`;
  };
  const rows = [
    { key: "roc", label: european ? "Tier 1: Return of capital" : "Tier 1: Return of each deal's capital", lp: p.roc, gp: 0 },
    ...(prefOn ? [{ key: "pref", label: "Tier 2: Preferred return", lp: p.pref, gp: 0 }] : []),
    ...(catchupOn ? [{ key: "catchup", label: "Tier 3: GP catch-up", lp: p.catchupLp, gp: p.catchupGp }] : []),
    ...wf.bands.map((b, i) => ({ key: `carry-${i}`, label: `Tier ${european ? 4 : 2}: ${bandName(i)}`, lp: p.carryLp[i], gp: p.carryGp[i] })),
    ...(wf.clawback > 0 ? [{ key: "clawback", label: "Clawback: GP returns carry above its share", lp: wf.clawback, gp: -wf.clawback }] : []),
    ...(wf.unrealized.lp + wf.unrealized.gp > 0.5 ? [{ key: "unrealized", label: "Still held at the end (not yet paid out)", lp: wf.unrealized.lp, gp: wf.unrealized.gp }] : []),
  ];
  const total = wf.paidOut + wf.unrealized.lp + wf.unrealized.gp;
  const profit = total - wf.paidIn;
  const cell = (v) => (Math.abs(v) < 0.5 ? "—" : fmtMIn(v, ccy));
  return (
    <div className="card" data-testid="results-waterfall" style={{ padding: "14px 18px", margin: "16px 0 12px" }}>
      <div style={{ ...sans, fontSize: FS.bodyLg, fontWeight: 600, marginBottom: 2 }}>Waterfall</div>
      <div data-testid="results-waterfall-intro" style={{ ...sans, fontSize: FS.small, color: "var(--ink-color-global-text-subtle)", marginBottom: 10 }}>
        Partners paid in {fmtMIn(wf.paidIn, ccy)} and the fund paid out {fmtMIn(wf.paidOut, ccy)} over its life
        {wf.unrealized.lp + wf.unrealized.gp > 0.5 ? `, with ${fmtMIn(wf.unrealized.lp + wf.unrealized.gp, ccy)} still held at the end` : ""}. This is how it was split, tier by tier.
      </div>
      <div style={{ overflowX: "auto" }}>
        <table className="ledger" style={{ minWidth: 520 }}>
          <thead><tr><th style={{ textAlign: "left" }}>Tier</th><th>To LPs</th><th>To GP</th></tr></thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key} data-testid={`results-wf-${row.key}`}>
                <td>{row.label}</td><td style={cellNum}>{cell(row.lp)}</td><td style={cellNum}>{cell(row.gp)}</td>
              </tr>
            ))}
            <tr data-testid="results-wf-total" style={{ fontWeight: 700 }}>
              <td>Total</td><td style={cellNum}>{fmtMIn(wf.lp, ccy)}</td><td style={cellNum}>{fmtMIn(wf.gp, ccy)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div data-testid="results-waterfall-summary" style={{ ...sans, fontSize: FS.body, marginTop: 10 }}>
        LPs get <strong>{fmtMIn(wf.lp, ccy)}</strong> ({fmtX(wf.paidIn > 0 ? wf.lp / wf.paidIn : null)} what partners paid in).{" "}
        {profit > 0
          ? <>The GP earns <strong>{fmtMIn(wf.gp, ccy)}</strong> of carry, {fmtPct(wf.gp / profit, 1)} of the {fmtMIn(profit, ccy)} profit.</>
          : <>The fund makes no profit, so the GP earns no carry.</>}
      </div>
      <div style={{ ...sans, fontSize: FS.micro, color: "var(--ink-color-global-text-subtle)", marginTop: 6 }}>
        LPs here include the GP's own commitment, which the waterfall treats like LP money. Paid in includes capital called for fees and expenses.
      </div>
    </div>
  );
}
