import { FS, sans, inkNum, NOTICE_TINT } from "../../ui/theme.js";
import { Btn, Segmented, TextInput, CloseIcon } from "../../ui/components.jsx";
import { fmtMIn, fmtX, fmtPct } from "../../ui/format.js";
import { addMonthsYm, deriveGeneral } from "../../model/construction/plan.js";
import { lightPortfolio, validateOutcomes, whatItTakes, outcomeTimeline, setOutcomeMode, SHAPES, shapeOf, setShape, solveOutcomes, STRETCH, OUTCOMES, MULTIPLE_STEP, topOutcome, addOutcome, removeOutcome } from "../../model/construction/light.js";
import { StepHeader, NumInput, PctInput, ErrorLine, LiquidationTip, cellNum, errStyle, fmtCount, fmtYm } from "./fields.jsx";

function ExitWindow({ row, start }) {
  if (!row) return <span style={{ color: "var(--ink-color-global-text-subtle)" }}>—</span>;
  const from = fmtYm(addMonthsYm(start, row.from)), to = fmtYm(addMonthsYm(start, row.to));
  // Years only in the cell; the months are in the tooltip.
  const yr = (s) => String(s).slice(-4);
  const text = yr(from) === yr(to) ? yr(from) : `${yr(from)}–${yr(to).slice(-2)}`;
  if (!row.afterEnd) return <span title={`${from} – ${to}`}>{text}</span>;
  return (
    <span style={{ color: "var(--ink-color-global-feedback-negative-strong)", fontWeight: 600 }}
      title={`${from} – ${to}. ${row.afterEnd === "all" ? "Every exit in this group lands after the fund ends" : "Some exits in this group land after the fund ends"}`}>
      ⚠ {text}
    </span>
  );
}

/** A smooth line through points (Catmull-Rom as cubic Béziers), clamped so it never dips below the baseline. */
function smoothPath(pts, floor) {
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const [p0, p1, p2, p3] = [pts[i - 1] ?? pts[i], pts[i], pts[i + 1], pts[i + 2] ?? pts[i + 1]];
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, Math.min(floor, p1[1] + (p2[1] - p0[1]) / 6)];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, Math.min(floor, p2[1] - (p3[1] - p1[1]) / 6)];
    d += ` C${c1[0]},${c1[1]} ${c2[0]},${c2[1]} ${p2[0]},${p2[1]}`;
  }
  return d;
}

const SHORT = ["Failed", "Low", "Med", "Large", "Unicorn"];
const RETURNS = "var(--ink-color-global-link-default)";
const COMPANIES = "var(--ink-color-global-text-subtle)";

/** Two curves over the outcomes on one 0-100% scale: dashed grey is where companies land, filled blue is where gross proceeds come from. */
export function ShapeChart({ shape, selected }) {
  const W = 200, H = 64, padX = 18, top = 6, n = shape.shares.length;
  const proceeds = shape.shares.map((v, i) => v * shape.multiples[i]);
  const total = proceeds.reduce((a, b) => a + b, 0) || 1;
  const returns = proceeds.map((v) => v / total);
  const max = Math.max(...shape.shares, ...returns);
  const x = (i) => padX + (i * (W - 2 * padX)) / (n - 1);
  const y = (v) => top + (1 - v / max) * (H - top);
  const line = (vals) => smoothPath(vals.map((v, i) => [x(i), y(v)]), H);
  const ret = line(returns);
  const gid = `shape-fill-${shape.id}`;
  return (
    <svg data-testid={`shape-chart-${shape.id}`} width="100%" viewBox={`0 0 ${W} ${H + 16}`} role="img"
      aria-label={`${shape.label}: companies ${shape.shares.map((v, i) => `${OUTCOMES[i].label} ${fmtPct(v, 0)}`).join(", ")}; returns ${returns.map((v, i) => `${OUTCOMES[i].label} ${fmtPct(v, 0)}`).join(", ")}`}
      style={{ display: "block", overflow: "visible", maxWidth: 260 }}>
      <defs>
        <linearGradient id={gid} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={RETURNS} stopOpacity={selected ? 0.35 : 0.22} />
          <stop offset="100%" stopColor={RETURNS} stopOpacity={0.02} />
        </linearGradient>
      </defs>
      <line x1={0} x2={W} y1={H} y2={H} stroke="var(--ink-color-global-border-default)" strokeWidth={1} />
      <path d={`${ret} L${x(n - 1)},${H} L${x(0)},${H} Z`} fill={`url(#${gid})`} />
      <path d={line(shape.shares)} fill="none" stroke={COMPANIES} strokeWidth={1.5} strokeDasharray="3 3" strokeLinecap="round" />
      <path d={ret} fill="none" stroke={RETURNS} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      {returns.map((v, i) => (
        <g key={i}>
          <title>{`${OUTCOMES[i].label}: ${fmtPct(shape.shares[i], 0)} of companies, ${fmtPct(v, 0)} of returns (about ${fmtX(shape.multiples[i], 1)})`}</title>
          <rect x={x(i) - (W - 2 * padX) / (2 * (n - 1))} y={0} width={(W - 2 * padX) / (n - 1)} height={H} fill="transparent" />
          <circle cx={x(i)} cy={y(v)} r={2.5} fill={RETURNS} stroke="var(--ink-color-global-surface-background-default)" strokeWidth={1.5} />
        </g>
      ))}
      {SHORT.map((t, i) => (
        <text key={t} x={x(i)} y={H + 12} textAnchor="middle" style={{ ...sans, fontSize: 9 }}
          fill="var(--ink-color-global-text-subtle)">{t}</text>
      ))}
    </svg>
  );
}

function ShapeLegend() {
  const item = (swatch, label) => (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>{swatch}{label}</span>
  );
  return (
    <div data-testid="shape-legend" style={{ ...sans, fontSize: FS.small, color: "var(--ink-color-global-text-subtle)", display: "flex", gap: 16, flexWrap: "wrap", marginTop: 8 }}>
      {item(<svg width="18" height="8"><line x1="1" x2="17" y1="4" y2="4" stroke={RETURNS} strokeWidth="2" strokeLinecap="round" /></svg>, "Share of returns")}
      {item(<svg width="18" height="8"><line x1="1" x2="17" y1="4" y2="4" stroke={COMPANIES} strokeWidth="1.5" strokeDasharray="3 3" strokeLinecap="round" /></svg>, "Share of companies")}
    </div>
  );
}

function TargetLine({ plan, update, book, projected, lateExits }) {
  const l = plan.light;
  const shape = shapeOf(l.shape);
  const target = l.targetMoic;
  const solved = solveOutcomes(l);
  const solvedMoic = solved.k != null ? lightPortfolio({ ...l, outcomes: solved.outcomes }).grossMoic : null;
  // 0.5× steps can leave a small gap even when solved, so only flag one Re-solve would close.
  const gap = book.grossMoic != null && target > 0 ? Math.abs(book.grossMoic - target) : null;
  const floor = solvedMoic != null ? Math.abs(solvedMoic - target) : 0;
  const off = gap != null && gap > Math.max(0.02, floor + 0.005);
  // How far the shape's base multiples had to move to hit the target.
  const k = shape ? solved.k : null;
  const stretch = k != null && (k < STRETCH.low || k > STRETCH.high);
  return (
    <div data-testid="outcome-shape" style={{ marginBottom: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 8 }}>
        <span style={{ ...sans, fontSize: FS.small, fontWeight: 600 }}>Return shape</span>
        <ShapeLegend />
      </div>
      <div role="group" aria-label="Return shape" style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        {SHAPES.map((x) => {
          const on = l.shape === x.id;
          return (
            <button key={x.id} type="button" data-testid={`shape-${x.id}`} aria-pressed={on} title={x.description}
              onClick={() => update((p) => setShape(p.light, x.id))}
              style={{ ...sans, textAlign: "left", cursor: "pointer", padding: "12px 14px 10px", borderRadius: 8, flex: "1 1 190px", minWidth: 0,
                background: on ? "var(--ink-color-global-surface-background-underlay)" : "var(--ink-color-global-surface-background-default)",
                color: "var(--ink-color-global-text-default)",
                border: `${on ? 2 : 1}px solid ${on ? "var(--ink-color-global-text-default)" : "var(--ink-color-global-border-default)"}`,
                margin: on ? 0 : 1, transition: "border-color .15s, background .15s" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, marginBottom: 2 }}>
                <span style={{ fontSize: FS.small, fontWeight: 600 }}>{x.label}</span>
                {on && <span aria-hidden style={{ fontSize: FS.micro, fontWeight: 600 }}>✓</span>}
              </div>
              <div style={{ fontSize: FS.micro, color: "var(--ink-color-global-text-subtle)", marginBottom: 8, minHeight: 28 }}>{x.tagline}</div>
              <ShapeChart shape={x} selected={on} />
            </button>
          );
        })}
      </div>
      <div data-testid="outcome-target-status" role={off ? "alert" : undefined}
        style={{ ...sans, fontSize: FS.small, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginTop: 12,
          padding: "8px 12px", borderRadius: 6, background: off || stretch ? NOTICE_TINT : "var(--ink-color-global-surface-background-underlay)" }}>
        <span style={{ fontWeight: 600, color: off ? "var(--ink-color-global-text-default)" : "var(--ink-color-global-feedback-positive-strong)" }}>
          {off ? "Off target" : "✓ On target"}
        </span>
        <span>Implied <strong data-testid="implied-moic">{fmtX(book.grossMoic)}</strong> vs target <strong>{fmtX(target)}</strong> gross</span>
        {projected != null && fmtX(projected) !== fmtX(book.grossMoic) && (
          <span data-testid="projected-moic">· <strong>{fmtX(projected)}</strong> projected{lateExits ? ", after holdings still open at the fund's end are sold" : ""}</span>
        )}
        {!shape && <span style={{ color: "var(--ink-color-global-text-subtle)" }}>· Custom table: pick a shape to solve a new one</span>}
        {shape && l.outcomesEdited && <span style={{ color: "var(--ink-color-global-text-subtle)" }}>· Edited by hand</span>}
        {off && <Btn onClick={() => update((p) => setShape(p.light, p.light.shape))} data-testid="resolve-outcomes">Re-solve</Btn>}
        {!off && stretch && <span data-testid="stretch-note">· A stretch for this shape: multiples moved {k > 1 ? "up" : "down"} {fmtPct(Math.abs(k - 1), 0)}</span>}
      </div>
    </div>
  );
}

export function WhatItTakes({ plan }) {
  const w = whatItTakes(plan.light, plan.general.committed);
  const top = topOutcome(plan.light);
  const topCount = lightPortfolio(plan.light).groups.find((g) => g.id === top?.id)?.count;
  if (!w || !(w.perCompany > 0) || !(topCount > 0)) return null;
  const nm = w.label.toLowerCase();
  const ccy = plan.general.currency;
  return (
    <div data-testid="what-it-takes" style={{ ...sans, fontSize: FS.small, color: "var(--ink-color-global-text-default)", marginTop: 14 }}>
      <strong>What it takes:</strong> one {nm} at {+w.multiple.toFixed(2)}× returns {fmtMIn(w.perCompany, ccy)}, {fmtX(w.fundMultiple)} the fund.{" "}
      {w.needed === 1 ? `A single ${nm} returns the whole fund.` : `It takes ${w.needed} ${nm}s to return the whole fund.`}
    </div>
  );
}

// Fixed-width cells keep each unit or share in the same slot down a column.
const CELL = 64;
const MULT_CELL = 78; // room for a multiple like "11.5"
const subtle = "var(--ink-color-global-text-subtle)";
const pair = { display: "flex", alignItems: "center", gap: 8 };
const aside = { ...sans, fontSize: FS.small, color: subtle, whiteSpace: "nowrap", minWidth: 32, textAlign: "left" };
// Read-only values sit in a box shaped like the inputs, so the columns stay straight.
const lockedBox = { ...inkNum, display: "inline-flex", alignItems: "center", boxSizing: "border-box", width: CELL, minWidth: CELL, flexShrink: 0, height: 36,
  padding: "0 12px", borderRadius: 4, background: "var(--ink-color-global-surface-background-underlay)", color: subtle };

export default function OutcomesStep({ plan, update, result }) {
  const l = plan.light;
  const g = plan.general;
  const ccy = g.currency;
  const errors = validateOutcomes(l);
  const book = lightPortfolio(l);
  const timeline = outcomeTimeline(l, g);
  const byCount = l.outcomeMode !== "pct";
  const edit = (id, patch) => update((p) => { Object.assign(p.light.outcomes.find((o) => o.id === id), patch); p.light.outcomesEdited = true; });
  const rename = (id, label) => update((p) => { p.light.outcomes.find((o) => o.id === id).label = label; });
  const survivorTiers = l.outcomes.filter((o) => o.id !== "failed").length;
  const setCount = (id, v) => edit(id, { share: v == null ? null : l.companies > 0 ? v / l.companies : 0 });
  const total = book.groups.reduce((s, o) => s + (o.share || 0), 0);
  const totalCount = book.groups.reduce((s, o) => s + o.count, 0);
  const late = book.groups.filter((o) => timeline.rows[o.id]?.afterEnd && o.count > 0);
  const endLabel = fmtYm(deriveGeneral(g).endDate);
  return (
    <div data-testid="outcomes-step">
      <StepHeader title="Outcomes">
        Pick a return shape and the table is solved to hit your target. Edit any row to fine-tune. Each of the {fmtCount(l.companies)} companies lands in one outcome. Failed companies return nothing and get no follow-ons. Every other group returns its gross multiple on everything invested in it, first check plus follow-on.
      </StepHeader>
      <TargetLine plan={plan} update={update} book={book} projected={result?.ok ? result.metrics.grossMoic : null} lateExits={late.length > 0} />
      <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "20px 0 10px", flexWrap: "wrap" }}>
        <span style={{ ...sans, fontSize: FS.small, color: subtle, marginRight: "auto" }}>{ccy ? `Amounts in ${ccy}` : ""}</span>
        <span style={{ ...sans, fontSize: FS.small, color: subtle }}>Enter as</span>
        <Segmented small value={byCount ? "count" : "pct"} options={[{ id: "count", label: "Companies" }, { id: "pct", label: "Percentage" }]}
          onChange={(v) => update((p) => setOutcomeMode(p.light, v))} />
      </div>
      {late.length > 0 && (
        <div role="alert" data-testid="timeline-warning" style={{ ...sans, fontSize: FS.small, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap",
          padding: "8px 12px", margin: "0 0 12px", borderRadius: 4, background: NOTICE_TINT, color: "var(--ink-color-global-text-default)" }}>
          <span>
            {late.map((o) => o.label).join(", ")} exits land after the fund ends ({endLabel}), so they're sold at their value then.
          </span>
          <LiquidationTip endLabel={endLabel} light />
        </div>
      )}
      <div style={{ overflowX: "auto" }}>
        <table className="ledger" style={{ minWidth: 600, tableLayout: "fixed", width: "100%" }}>
          <colgroup>
            <col style={{ width: "17%" }} /><col style={{ width: "17%" }} /><col style={{ width: "15%" }} /><col style={{ width: "10%" }} />
            <col style={{ width: "11%" }} /><col style={{ width: "12%" }} /><col style={{ width: "12%" }} /><col style={{ width: "6%" }} />
          </colgroup>
          <thead><tr>
            <th style={{ textAlign: "left" }}>Outcome</th>
            <th style={{ textAlign: "left" }}>{byCount ? "Companies" : "% of companies"}</th>
            <th style={{ textAlign: "left" }} title="Gross multiple on everything invested in each company">Multiple</th>
            <th style={{ textAlign: "left" }} title="Years from first check to exit">Years</th>
            <th style={{ textAlign: "right" }} title="Invested per company: first check plus follow-on">Per co.</th>
            <th style={{ textAlign: "right" }}>Proceeds</th>
            <th style={{ textAlign: "left", paddingLeft: 16 }} title="When this group's exits land">Exits</th>
            <th aria-label="Remove" />
          </tr></thead>
          <tbody>
            {book.groups.map((o) => [
              <tr key={o.id} data-testid={`outcome-${o.id}`}>
                <td>
                  <TextInput value={l.outcomes.find((x) => x.id === o.id)?.label ?? o.label} onChange={(e) => rename(o.id, e.target.value)} aria-label={`Name of ${o.label}`} data-testid={`name-${o.id}`}
                    placeholder={o.label} style={{ width: "100%", fontWeight: 500 }} />
                  {o.id === "failed" && <div style={{ ...sans, fontSize: FS.micro, color: subtle, marginTop: 2 }}>the rest</div>}
                </td>
                <td>
                  <span style={pair}>
                    {o.id === "failed"
                      ? <span data-testid="share-failed" title="The companies that don't survive" style={lockedBox}>
                          {byCount ? o.count : fmtPct(o.share, 1)}
                        </span>
                      : byCount
                      ? <NumInput width={CELL} value={o.share == null ? null : o.share * (l.companies || 0)} decimals={2} step={1} onChange={(v) => setCount(o.id, v)} testId={`share-${o.id}`} ariaLabel={`${o.label} companies`} />
                      : <PctInput width={CELL} value={o.share} onChange={(v) => edit(o.id, { share: v })} testId={`share-${o.id}`} ariaLabel={`${o.label} share of companies`} />}
                    <span data-testid={byCount ? `pct-${o.id}` : `count-${o.id}`} title={byCount ? "Share of the fund's companies" : "Rounded to whole companies"} style={aside}>
                      {byCount ? fmtPct(o.share, 0) : o.count}
                    </span>
                  </span>
                </td>
                <td>
                  <span style={pair}>
                    {o.id === "failed"
                      ? <span style={{ ...lockedBox, width: MULT_CELL, minWidth: MULT_CELL }}>0</span>
                      : <NumInput width={MULT_CELL} value={o.multiple} decimals={2} step={MULTIPLE_STEP} onChange={(v) => edit(o.id, { multiple: v })} testId={`mult-${o.id}`} ariaLabel={`${o.label} gross multiple`} />}
                    <span style={{ ...aside, minWidth: 0 }}>×</span>
                  </span>
                </td>
                <td><NumInput width={CELL} value={o.exitYears} decimals={2} onChange={(v) => edit(o.id, { exitYears: v })} testId={`years-${o.id}`} ariaLabel={`${o.label} years to exit`} /></td>
                <td style={cellNum}>{fmtMIn(o.perCompany, ccy)}</td>
                <td style={cellNum} data-testid={`proceeds-${o.id}`}>{fmtMIn(o.proceeds, ccy)}</td>
                <td style={{ ...cellNum, textAlign: "left", paddingLeft: 16 }}><ExitWindow row={o.count > 0 ? timeline.rows[o.id] : null} start={g.startDate} /></td>
                <td style={{ textAlign: "right" }}>
                  {o.id !== "failed" && (
                    <button type="button" onClick={() => update((p) => { removeOutcome(p.light, o.id); })} disabled={survivorTiers <= 1} data-testid={`remove-${o.id}`} aria-label={`Remove ${o.label}`}
                      title={survivorTiers <= 1 ? "A portfolio needs at least one tier that survives" : `Remove ${o.label}`}
                      style={{ border: "none", background: "transparent", cursor: survivorTiers <= 1 ? "default" : "pointer", opacity: survivorTiers <= 1 ? 0.3 : 1, padding: 6, borderRadius: 4, display: "inline-flex", color: subtle }}>
                      <CloseIcon size={14} />
                    </button>
                  )}
                </td>
              </tr>,
              errors[o.id] && <tr key={`${o.id}-e`}><td colSpan={8} style={errStyle} role="alert">{errors[o.id]}</td></tr>,
            ])}
            <tr data-testid="outcome-total" style={{ fontWeight: 600 }}>
              <td>Total</td>
              <td><span style={pair}><span style={{ ...inkNum, width: CELL, paddingLeft: 12 }}>{byCount ? totalCount : fmtPct(total, 1)}</span><span style={{ ...aside, fontWeight: 600 }}>{byCount ? fmtPct(total, 0) : totalCount}</span></span></td>
              <td><span style={{ ...inkNum, paddingLeft: 12 }}>{fmtX(book.grossMoic)}</span></td>
              <td /><td style={cellNum}>{fmtMIn(book.deployed, ccy)}</td><td style={cellNum}>{fmtMIn(book.proceeds, ccy)}</td><td /><td />
            </tr>
          </tbody>
        </table>
      </div>
      <div style={{ marginTop: 10 }}>
        <Btn onClick={() => update((p) => { addOutcome(p.light); })} data-testid="add-tier">+ Add tier</Btn>
        <span style={{ ...sans, fontSize: FS.micro, color: subtle, marginLeft: 10 }}>A new tier starts with no companies. Rename or remove any tier; the table then stays as you build it instead of following a preset shape.</span>
      </div>
      <ErrorLine>{errors.total}</ErrorLine>
      <WhatItTakes plan={plan} />
    </div>
  );
}
