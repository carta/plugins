import { useState, useRef, useEffect, Fragment } from "react";
import { createPortal } from "react-dom";
import { tightSans, sans, mono, FS, MICRO, NOTICE, EYEBROW_TRACKING, SMALL_1 } from "../ui/theme.js";
import { fmt$, fmtM, fmtB, fmtX, fmtPct, fmtAsOf, fmtOwn } from "../ui/format.js";

// pretty round name: "seed" → "Seed", "a" → "Series A", "pre-seed" → "Pre-seed"
const roundLabel = (r) => {
  const s = String(r || "").trim();
  if (!s) return "";
  if (/^pre[-\s]?seed$/i.test(s)) return "Pre-seed";
  if (/^seed$/i.test(s)) return "Seed";
  if (/^[a-z]\d?$/i.test(s)) return "Series " + s.toUpperCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
};
import { H1, Btn, Toggle, Num, ChevronIcon, ChevronDownIcon, HelpCircleIcon, FundPicker, Dropdown, Badge, Eyebrow, MenuItem, useDismissable, ALL_FUNDS, MethodNote, SourceNote, fundLabel, POPOVER_SHADOW, GlobalFilter, SearchInput, DeltaCaret } from "../ui/components.jsx";
import { useTableSort, SortIcon, useStickyHeader, TableScroll } from "../ui/table.jsx";
import RepriceControl from "../ui/RepriceControl.jsx";
import ConfirmDialog from "../ui/ConfirmDialog.jsx";
import { repricePosition, positionReprice, carryRateFor, companyRepriceState, exitHorizonFor,
  companyIsWaterfall, companyHasCapTable, companyReferenceExit, companyExitValueAbs, quarterOffsetDate } from "../model/reprice.js";
import { fundExitProceeds, fundProceedsCurve, preferenceSummary, normClass } from "../model/liqpref.js";
import { scenarioDealIrr, entryLegsFor, anchorIrrByRatio } from "../model/dealIrr.js";
import { xirr } from "../model/xirr.js";
import { isStaleMark, daysBetween, fundIdsOf } from "../model/funds.js";
import { zeroOutFund, resetFundToCarta, zeroOutAll, resetAllToCarta, companiesInFund, crossFundCompanies, applyReserveDilution } from "../model/slices.js";
import { FULL_RESERVE_DILUTION } from "../model/reserves.js";
import { useFirmData } from "../state/FirmData.jsx";
import { companyOwnership } from "../model/ownership.js";

// Derive a company's display status as a filterable key. Approximates the
// StatusChip logic in CompanyRow without the full per-position reprice model.
function companyStatus(c) {
  if (c.realized) return "realized";
  if (c.defunct) return "defunct";
  if (c.exited && c.includeInNav && !c.archived) return "exited-dpi";
  const cartaFv = c.positions.reduce((s, p) => s + (p.cartaFv || 0), 0);
  if (cartaFv > 0 && (
    (c.markMultiple != null && Math.abs(c.markMultiple - 1) > 1e-6) ||
    (c.valuationB != null)
  )) return "repriced";
  return "active";
}
const STATUS_META = {
  active:       { label: "Held at Carta" },
  repriced:     { label: "Repriced" },
  "exited-dpi": { label: "Exited · in DPI" },
  defunct:      { label: "Out of business" },
  realized:     { label: "Exited · realized" },
};

// Data Collection revenue/ARR — compact, with the metric's OWN currency (never
// assume USD): "12.3M USD", "1.2B EUR". Currency omitted only when absent.
const fmtRev = (v, ccy) => {
  const a = Math.abs(v);
  const s = a >= 1e9 ? (v / 1e9).toFixed(1) + "B" : a >= 1e6 ? (v / 1e6).toFixed(1) + "M" : a >= 1e3 ? (v / 1e3).toFixed(0) + "K" : String(Math.round(v));
  return ccy ? `${s} ${ccy}` : s;
};


// cap-table money — always with the cap table's OWN currency (never hardcode USD)
const fmtMoney = (v, ccy) => (v == null ? "—" : fmtRev(v, ccy));
const fmtPrice = (v, ccy) => (v == null ? "—" : `${(+v).toFixed(2)}${ccy ? " " + ccy : ""}`);
const fmtShares = (n) => (n == null ? "—" : Math.round(n).toLocaleString("en-US"));
const intX = (m) => `${(+m).toFixed(Math.abs(m % 1) > 1e-9 ? 1 : 0)}×`;

// Liquidation-preference descriptor for a share class: "1× non-part",
// "1.5× part (cap 2×)", or "—" for common / no-preference classes.
function prefDescriptor(cl) {
  if (String(cl.kind || "").toLowerCase() !== "preferred" || cl.multiplier == null) return "—";
  const part = cl.participating ? (cl.cap ? `part · cap ${intX(cl.cap)}` : "part") : "non-part";
  return `${intX(cl.multiplier)} ${part}`;
}

// The share-class stack + fund holdings for a company's Carta cap table. Preferred
// shown senior→junior, then common/other. Amounts in the cap table's own currency.
function PrefStackTable({ company }) {
  const entry = company.capTable;
  const ccy = entry.currency;
  const holdBy = {};
  for (const h of entry.fundHoldings || []) holdBy[normClass(h.className)] = h;
  const rank = (c) => (c.seniority != null ? c.seniority : String(c.kind || "").toLowerCase() === "preferred" ? 1 : 999);
  const classes = [...entry.classes].sort((a, b) => rank(a) - rank(b) || String(a.name).localeCompare(String(b.name)));
  // dense inline overrides (scoped to this popover table — not the global .ledger CSS):
  // small font, tight rows, quiet uppercase headers.
  const cell = { fontSize: FS.small, lineHeight: 1.3, padding: "2px 8px" };
  const th = { ...sans, ...cell, fontSize: FS.micro, fontWeight: 600, color: MICRO, textTransform: "uppercase", letterSpacing: EYEBROW_TRACKING };
  const numCell = { ...mono, ...cell, textAlign: "right", whiteSpace: "nowrap" };
  return (
    <table className="ledger sheet" style={{ fontSize: FS.small }}>
      <thead>
        <tr>
          <th style={{ ...th, textAlign: "left" }}>Share class</th>
          <th style={{ ...th, textAlign: "right" }}>Rank</th>
          <th style={{ ...th, textAlign: "left" }}>Liquidation preference</th>
          <th style={{ ...th, textAlign: "right" }}>Invested</th>
          <th style={{ ...th, textAlign: "right" }}>Fund holds</th>
        </tr>
      </thead>
      <tbody>
        {classes.map((cl, i) => {
          const h = holdBy[normClass(cl.name)];
          const isPref = String(cl.kind || "").toLowerCase() === "preferred" && cl.multiplier != null;
          return (
            <tr key={i}>
              <td style={{ ...cell, whiteSpace: "nowrap" }}>
                {cl.name}
                {cl.kind && <span style={{ ...sans, fontSize: FS.micro, color: MICRO, marginLeft: 6 }}>{cl.kind}</span>}
              </td>
              <td style={numCell}>{cl.seniority != null ? cl.seniority : "—"}</td>
              <td style={{ ...sans, ...cell, color: isPref ? "var(--ink-color-global-text-default)" : "var(--ink-color-global-text-subtle)" }}>{prefDescriptor(cl)}</td>
              <td style={numCell}>{fmtMoney(cl.cashRaised, ccy)}</td>
              <td style={{ ...numCell, color: h ? "var(--ink-color-global-text-default)" : "var(--ink-color-global-text-subtle)" }}>{h && h.shares > 0 ? fmtShares(h.shares) : "—"}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// Compact fund-proceeds-vs-exit-value curve — shows the preference floor at low
// exits and the convergence to as-converted pro-rata at high exits. The vertical
// marker is the current scenario exit value. X in the company's exit valuation
// ($B), Y = the fund's proceeds. Reuses the MetricTrend SVG idiom.
const WC_W = 640, WC_H = 150, WC_PL = 8, WC_PR = 12, WC_PT = 12, WC_PB = 22;
function WaterfallCurve({ company }) {
  const entry = company.capTable;
  const refExit = companyReferenceExit(company);
  const curExit = companyExitValueAbs(company);
  const maxExit = Math.max(refExit * 4, curExit * 1.4, 1);
  const pts = fundProceedsCurve(entry, maxExit, 48);
  if (pts.length < 2) return null;
  const maxY = Math.max(...pts.map((p) => p.y), 1);
  const x = (v) => WC_PL + (v / maxExit) * (WC_W - WC_PL - WC_PR);
  const y = (v) => WC_PT + (1 - v / maxY) * (WC_H - WC_PT - WC_PB);
  const path = pts.map((p, i) => `${i ? "L" : "M"}${x(p.x).toFixed(1)} ${y(p.y).toFixed(1)}`).join(" ");
  const cur = fundExitProceeds(entry, curExit).proceeds;
  const tick = (frac) => maxExit * frac;
  return (
    <svg viewBox={`0 0 ${WC_W} ${WC_H}`} style={{ width: "100%", display: "block", overflow: "visible" }}
      role="img" aria-label="Fund proceeds vs company valuation">
      <line x1={WC_PL} x2={WC_W - WC_PR} y1={y(0)} y2={y(0)} style={{ stroke: "var(--ink-color-global-border-subtle)" }} strokeWidth="1" />
      {/* linear ownership reference (dashed) for contrast: cur proceeds scaled linearly from 0 */}
      <path d={`M${x(0)} ${y(0)} L${x(maxExit)} ${y((cur / (curExit || 1)) * maxExit)}`}
        fill="none" style={{ stroke: "var(--ink-color-global-text-subtle)" }} strokeWidth="1" strokeDasharray="3 3" opacity="0.6" />
      <path d={path} fill="none" style={{ stroke: "var(--ink-color-global-link-default)" }} strokeWidth="2" strokeLinejoin="round" />
      {/* current exit marker */}
      <line x1={x(curExit)} x2={x(curExit)} y1={WC_PT} y2={y(0)} style={{ stroke: "var(--ink-button-background-color-primary-base-default)" }} strokeWidth="1" strokeDasharray="2 2" />
      <circle cx={x(curExit)} cy={y(cur)} r="3.2" style={{ fill: "var(--ink-button-background-color-primary-base-default)" }} />
      {[0, 0.25, 0.5, 0.75, 1].map((f, i) => (
        <text key={i} x={x(tick(f))} y={WC_H - 6} textAnchor={i === 0 ? "start" : f === 1 ? "end" : "middle"}
          style={{ ...sans, fontSize: FS.micro, fill: MICRO }}>{fmtB(tick(f) / 1e9)}</text>
      ))}
    </svg>
  );
}

// ── Exit-timing (realized positions): the marked value is the exit proceeds, but
// the exit DATE stays a lever — the same proceeds received later annualize to a
// lower IRR. The control drags the exit quarter; the curve plots deal IRR at each.
const EXIT_Q_MAX = 24; // up to 6 years of quarterly exit timing

const addQuarters = quarterOffsetDate; // shared so slider, chart, and horizon derivation agree

// A short exit-date label for quarter offset q: "Q3 '26".
function exitQLabel(navAsOf, q) {
  const iso = addQuarters(navAsOf, q);
  const [y, m] = iso.split("-").map(Number);
  return `Q${Math.floor(((m || 1) - 1) / 3) + 1} '${String(y).slice(2)}`;
}

// Realized deal IRR at an exit date: entry legs + one terminal = marked value + proceeds.
function realizedIrrAt(company, curFv, proceeds, exitDate) {
  const entryLegs = entryLegsFor(company.positions);
  if (!entryLegs.length) return null;
  const terminal = (curFv || 0) + (proceeds || 0);
  if (terminal <= 0) return -1;
  return xirr([...entryLegs, { date: exitDate, amount: terminal }]);
}

// This curve anchors across a varying holding period (Q0 vs. Q-offset exit), so it
// uses the ratio anchor, not dealIrr.js's additive one — see anchorIrr's comment.
const anchorExitIrr = anchorIrrByRatio;

// Deal IRR (Y) vs exit quarter (X), marker at the selected quarter. Mirrors the WaterfallCurve SVG idiom.
const ET_W = 640, ET_H = 168, ET_PL = 34, ET_PR = 12, ET_PT = 12, ET_PB = 22;
function ExitIrrCurve({ company, totalFv, curFv, proceeds, navAsOf, selectedQ }) {
  const cartaIrr = company.dealIrr ?? null;
  // Base is Carta's OWN marked value (unrepriced), exited today — a fixed
  // reference point, not the live curFv. Anchoring against the live value here
  // would make the reprice's effect cancel out of the curve (see anchorIrrByRatio's
  // comment on dealIrr.js): base and every "now" would move together, so raising
  // the mark barely shifts the readout at any exit quarter near today.
  const baseRaw = realizedIrrAt(company, totalFv, proceeds, addQuarters(navAsOf, 0));
  const pts = [];
  for (let q = 0; q <= EXIT_Q_MAX; q++) {
    const irr = anchorExitIrr(cartaIrr, baseRaw, realizedIrrAt(company, curFv, proceeds, addQuarters(navAsOf, q)));
    if (irr != null && Number.isFinite(irr)) pts.push({ q, irr });
  }
  if (pts.length < 2) return null;
  const irrs = pts.map((p) => p.irr);
  const lo = Math.min(0, ...irrs), hi = Math.max(0, ...irrs), span = hi - lo || 1;
  const x = (q) => ET_PL + (q / EXIT_Q_MAX) * (ET_W - ET_PL - ET_PR);
  const y = (v) => ET_PT + (1 - (v - lo) / span) * (ET_H - ET_PT - ET_PB);
  const path = pts.map((p, i) => `${i ? "L" : "M"}${x(p.q).toFixed(1)} ${y(p.irr).toFixed(1)}`).join(" ");
  const sel = pts.reduce((best, p) => (Math.abs(p.q - selectedQ) < Math.abs(best.q - selectedQ) ? p : best), pts[0]);
  const gridV = [lo, lo + span / 2, hi];
  return (
    <svg viewBox={`0 0 ${ET_W} ${ET_H}`} style={{ width: "100%", display: "block", overflow: "visible" }}
      role="img" aria-label="Deal IRR vs exit quarter">
      {gridV.map((v, i) => (
        <g key={i}>
          <line x1={ET_PL} x2={ET_W - ET_PR} y1={y(v)} y2={y(v)}
            style={{ stroke: "var(--ink-color-global-border-subtle)" }} strokeWidth="1" strokeDasharray={Math.abs(v) < 1e-9 ? undefined : "3 3"} opacity={Math.abs(v) < 1e-9 ? 1 : 0.6} />
          <text x={ET_PL - 5} y={y(v) + 3} textAnchor="end" style={{ ...sans, fontSize: FS.micro, fill: MICRO }}>{fmtPct(v)}</text>
        </g>
      ))}
      <path d={path} fill="none" style={{ stroke: "var(--ink-color-global-link-default)" }} strokeWidth="2" strokeLinejoin="round" />
      {/* selected exit-quarter marker */}
      <line x1={x(sel.q)} x2={x(sel.q)} y1={ET_PT} y2={y(lo)} style={{ stroke: "var(--ink-button-background-color-primary-base-default)" }} strokeWidth="1" strokeDasharray="2 2" />
      <circle cx={x(sel.q)} cy={y(sel.irr)} r="3.4" style={{ fill: "var(--ink-button-background-color-primary-base-default)" }} />
      {[0, 0.25, 0.5, 0.75, 1].map((f, i) => {
        const q = Math.round(EXIT_Q_MAX * f);
        return (
          <text key={i} x={x(q)} y={ET_H - 6} textAnchor={i === 0 ? "start" : f === 1 ? "end" : "middle"}
            style={{ ...sans, fontSize: FS.micro, fill: MICRO }}>{exitQLabel(navAsOf, q)}</text>
        );
      })}
    </svg>
  );
}

// Slider + IRR-over-time line for a realized company; persists the offset as `company.exitTimingQ`.
function ExitTimingSection({ company, totalFv, curFv, proceeds, navAsOf, locked, updateCompany, onDragStart, onDragEnd }) {
  if (!navAsOf) {
    return (
      <div style={{ marginBottom: 14 }}>
        <SubLabel>Exit timing · deal IRR over time</SubLabel>
        <div style={{ ...sans, fontSize: FS.small, color: "var(--ink-color-global-text-subtle)" }}>
          Unavailable — this fund has no NAV-as-of date in the data pull, so exit timing can't be computed.
        </div>
      </div>
    );
  }
  const selectedQ = Math.round(company.exitTimingQ ?? 0);
  const cfg = {
    value: selectedQ, min: 0, max: EXIT_Q_MAX, step: 1,
    fmtVal: (q) => exitQLabel(navAsOf, Math.round(q)),
    onChange: (q) => updateCompany(company.id, { exitTimingQ: Math.round(q) }),
  };
  const baseRaw = realizedIrrAt(company, totalFv, proceeds, addQuarters(navAsOf, 0));
  const selIrr = anchorExitIrr(company.dealIrr ?? null, baseRaw,
    realizedIrrAt(company, curFv, proceeds, addQuarters(navAsOf, selectedQ)));
  return (
    <div style={{ marginBottom: 14 }}>
      <SubLabel>Exit timing · deal IRR over time</SubLabel>
      <RepriceControl {...cfg} locked={locked} hidePresets onDragStart={onDragStart} onDragEnd={onDragEnd} />
      <div style={{ ...sans, fontSize: FS.small, color: "var(--ink-color-global-text-subtle)", margin: "6px 0 8px" }}>
        Exit at <strong style={{ ...mono, color: "var(--ink-color-global-text-default)" }}>{exitQLabel(navAsOf, selectedQ)}</strong>
        {" · deal IRR "}
        <strong style={{ ...mono, color: selIrr == null ? "var(--ink-color-global-text-subtle)" : selIrr >= 0 ? "var(--ink-color-global-feedback-positive-strong)" : "var(--ink-color-global-feedback-negative-strong)" }}>
          {selIrr == null ? "—" : fmtPct(selIrr)}
        </strong>
      </div>
      <ExitIrrCurve company={company} totalFv={totalFv} curFv={curFv} proceeds={proceeds} navAsOf={navAsOf} selectedQ={selectedQ} />
      <span style={{ ...sans, fontSize: FS.small, color: "var(--ink-color-global-text-subtle)", display: "block", marginTop: 2 }}>
        Same marked proceeds, exited later → lower annualized IRR. Drag to set the exit quarter; the marker tracks the deal IRR at that exit.
      </span>
    </div>
  );
}

export const companyFundIds = (c) =>
  c.positions.length ? [...new Set(c.positions.map((p) => p.fundId))] : [c.fundId];

// Compact stale marker for the positions ledger — the date is already shown in
// the cell, so this is just a small amber "stale" badge (age lives in the title),
// not the full StaleFlag that repeats the date.
const StalePill = ({ markDate, days }) => (
  <Badge tone="warning" title={`Mark dated ${markDate} — ${days} days old; likely conservative`}
    style={{ marginLeft: 6, verticalAlign: "middle" }}>
    Stale
  </Badge>
);

// Position-breakdown columns. "Basis" is a mark-basis descriptor, not an
// orderable quantity, so it stays non-sortable (no `get`).
const POS_COLS = [
  { label: "Position", align: "left", get: (r) => r.security || "Equity" },
  { label: "Cost", get: (r) => r.cost },
  { label: "Carta FV", get: (r) => r.cartaFv },
  { label: "Mark date", get: (r) => r.markDate || "" },
  { label: "Basis" },
  { label: "Repriced FV", get: (r) => r.repricedFv },
  { label: "Uplift", get: (r) => r.uplift },
];

function PositionsTable({ company, refDate, staleDays }) {
  const live = company.includeInNav && !company.archived;
  const rows = company.positions.map((p) => ({ ...p, ...positionReprice(company, p, { live }) }));
  const { sorted: posRows, sort: posSort, onSort: onPosSort } = useTableSort(rows, POS_COLS);
  const tot = (k) => rows.reduce((s, r) => s + (r[k] || 0), 0);
  // dense inline overrides (scoped to this popover — matches the cap-table popover):
  // small font, tight rows, quiet uppercase headers. Kept out of the global .ledger CSS.
  const cell = { fontSize: FS.small, lineHeight: 1.3, padding: "2px 8px" };
  const th = { ...sans, ...cell, fontSize: FS.micro, fontWeight: 600, color: MICRO, textTransform: "uppercase", letterSpacing: EYEBROW_TRACKING };
  const numCell = { ...mono, ...cell, textAlign: "right" };
  return (
    <table className="ledger sheet" style={{ fontSize: FS.small }}>
      <thead>
        <tr>
          {POS_COLS.map((c, i) => {
            const sortable = typeof c.get === "function";
            const align = c.align ?? "right";
            const active = sortable && posSort?.i === i;
            return (
              <th key={c.label} style={{ ...th, textAlign: align }}
                aria-sort={sortable ? (active ? (posSort.dir === "asc" ? "ascending" : "descending") : "none") : undefined}>
                {sortable ? (
                  <button type="button" className="ink-sort-btn" onClick={() => onPosSort(i)}
                    aria-label={`Sort by ${c.label}`} style={{ color: MICRO }}>
                    {align === "right" ? <><SortIcon />{c.label}</> : <>{c.label}<SortIcon /></>}
                  </button>
                ) : c.label}
              </th>
            );
          })}
        </tr>
      </thead>
      <tbody>
        {posRows.map((r) => (
          <tr key={r.id}>
            <td style={{ ...cell, whiteSpace: "nowrap" }}>{r.security || "Equity"}</td>
            <td style={numCell}>{fmt$(r.cost)}</td>
            <td style={numCell}>{fmt$(r.cartaFv)}</td>
            <td style={{ ...numCell, color: "var(--ink-color-global-text-subtle)", whiteSpace: "nowrap" }}>
              {r.markDate || "—"}
              {isStaleMark(r.markDate, refDate, staleDays) && <StalePill markDate={r.markDate} days={daysBetween(r.markDate, refDate)} />}
            </td>
            <td style={{ ...numCell, color: NOTICE }}>{r.markBasisB ? fmtB(r.markBasisB) : "—"}</td>
            <td style={{ ...numCell, fontWeight: 600 }}>{fmt$(r.repricedFv)}</td>
            <td style={{ ...numCell, color: r.uplift >= 0 ? "var(--ink-color-global-feedback-positive-strong)" : "var(--ink-color-global-feedback-negative-strong)" }}>{fmt$(r.uplift)}</td>
          </tr>
        ))}
        {rows.length > 1 && (
          <tr className="totrow">
            <td style={cell}>Total</td>
            <td style={numCell}>{fmt$(tot("cost"))}</td>
            <td style={numCell}>{fmt$(tot("cartaFv"))}</td>
            <td colSpan={2} />
            <td style={numCell}>{fmt$(tot("repricedFv"))}</td>
            <td style={{ ...numCell, color: tot("uplift") >= 0 ? "var(--ink-color-global-feedback-positive-strong)" : "var(--ink-color-global-feedback-negative-strong)" }}>{fmt$(tot("uplift"))}</td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

// A delineated block inside the company expander — a shaded, bordered panel with
// a small uppercase label — so fundamentals / scenario controls read as distinct
// sections rather than one run-on stack of margins.
function Section({ label, children, style }) {
  return (
    <div style={{ background: "var(--ink-color-global-surface-lightgray-default)", border: `1px solid var(--ink-color-global-border-subtle)`, padding: "12px 14px", marginBottom: 12, ...style }}>
      {label && <Eyebrow color={MICRO} style={{ marginBottom: 10 }}>{label}</Eyebrow>}
      {children}
    </div>
  );
}

// Small uppercase sub-label inside a Section (e.g. "Company valuation").
const SubLabel = ({ children, style }) => (
  <Eyebrow color={MICRO} style={{ marginBottom: 8, ...style }}>{children}</Eyebrow>
);

// Hover-triggered popover — a Btn-link trigger with a trailing chevron that
// reveals a portal-rendered panel below it (position:fixed off the trigger's
// own rect, so it escapes the Companies table's `overflow:auto` clip).
// Staying on either the trigger or the panel keeps it open; leaving both
// closes it after a short grace period. Single source for "See positions"
// and "Cap table & preferences" below, which used to be two copy-pasted
// show/hide/position-tracking implementations differing only in label, max
// width, panel padding, and body content.
function HoverPopover({ label, maxWidth, panelPadding, children }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const triggerRef = useRef(null);
  const timer = useRef(null);
  const show = () => {
    clearTimeout(timer.current);
    const r = triggerRef.current?.getBoundingClientRect();
    if (r) {
      const w = Math.min(maxWidth, window.innerWidth - 24);
      setPos({ left: Math.max(12, Math.min(r.left, window.innerWidth - w - 12)), top: r.bottom + 6, width: w });
    }
    setOpen(true);
  };
  const hide = () => { clearTimeout(timer.current); timer.current = setTimeout(() => setOpen(false), 150); };
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <>
      <Btn ref={triggerRef} kind="link" onMouseEnter={show} onMouseLeave={hide} onFocus={show} onBlur={hide}
        onClick={(e) => e.stopPropagation()} aria-expanded={open}
        style={{ fontSize: FS.bodyLg, cursor: "default" }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
          {label} <ChevronDownIcon size={14} strokeWidth={1.5} />
        </span>
      </Btn>
      {open && pos && createPortal(
        <div className="popin" onMouseEnter={show} onMouseLeave={hide}
          style={{ ...sans, position: "fixed", left: pos.left, top: pos.top, width: pos.width, zIndex: 60,
            background: "var(--ink-color-global-surface-background-default)", border: `1px solid var(--ink-color-global-border-subtle)`, boxShadow: "var(--shadow-hover)",
            padding: panelPadding, maxHeight: "60vh", overflow: "auto" }}>
          {children}
        </div>, document.body)}
    </>
  );
}

// A blue help-circle icon that reveals Ink's dark hover tooltip above it — the
// on-demand explainer for a toolbar control whose selected value (e.g. "Partial")
// isn't self-explanatory. Lives in-flow (not portaled) since the filter ribbon
// itself has no overflow clip, unlike HoverPopover's table-row triggers above.
function InfoTip({ label, children, width = 300 }) {
  const [open, setOpen] = useState(false);
  const show = () => setOpen(true);
  const hide = () => setOpen(false);
  return (
    <span style={{ position: "relative", display: "inline-flex", alignItems: "center" }}>
      <button type="button" aria-label={label} onMouseEnter={show} onMouseLeave={hide} onFocus={show} onBlur={hide}
        style={{ display: "flex", background: "none", border: "none", padding: 0, cursor: "default", color: "var(--ink-color-global-feedback-info-strong)" }}>
        <HelpCircleIcon size={16} strokeWidth={1.6} />
      </button>
      {open && (
        // Opens downward (toward the table), not upward — this trigger sits right
        // under the page header, where an upward tooltip has nowhere to grow and
        // clips against the viewport top. Every other popover in this toolbar
        // (Dropdown, GlobalFilter) already opens downward for the same reason.
        <div role="tooltip"
          style={{ ...sans, position: "absolute", top: "calc(100% + 8px)", left: "50%", transform: "translateX(-50%)",
            width, background: "var(--ink-color-global-brand-black)", color: "var(--ink-color-global-brand-white)",
            fontSize: FS.body, lineHeight: 1.5, padding: "10px 12px", borderRadius: "var(--ink-size-global-radius-subtle)",
            boxShadow: "var(--shadow-hover)", zIndex: 60, textAlign: "left" }}>
          {children}
          <span style={{ position: "absolute", bottom: "100%", left: "50%", transform: "translateX(-50%)",
            width: 0, height: 0, borderLeft: "6px solid transparent", borderRight: "6px solid transparent",
            borderBottom: "6px solid var(--ink-color-global-brand-black)" }} />
        </div>
      )}
    </span>
  );
}

// "See positions" hover popover — the positions ledger is reference detail, so it
// stays tucked away and appears on hover of the trigger.
function PositionsPopover({ company, refDate, staleDays }) {
  return (
    <HoverPopover label="See positions" maxWidth={680} panelPadding="6px 14px 10px">
      <PositionsTable company={company} refDate={refDate} staleDays={staleDays} />
    </HoverPopover>
  );
}

// Cap-table detail body — the preference summary line, the share-class stack and
// the source caveat. Rendered inside the hover popover below (kept out of the
// always-open expander so it doesn't hog vertical space).
function CapTableDetail({ company }) {
  const s = preferenceSummary(company.capTable);
  const ccy = company.capTable.currency;
  return (
    <>
      <div style={{ ...sans, fontSize: FS.small, color: "var(--ink-color-global-text-subtle)", marginBottom: 8 }}>
        {s.hasPrefTerms ? (
          <>
            <strong style={{ color: "var(--ink-color-global-text-default)" }}>{fmtMoney(s.totalPreference, ccy)}</strong> total liquidation preference senior to common
            {s.multMin != null && <> · {s.multMin === s.multMax ? intX(s.multMin) : `${intX(s.multMin)}–${intX(s.multMax)}`}</>}
            {s.anyParticipating ? " · participating" : " · non-participating"}
          </>
        ) : (
          <>Share classes on file; no preferred-preference terms (common / no multiple).</>
        )}
        {s.fundInvested > 0 && (
          <span style={{ marginLeft: 8 }}>· fund invested <strong style={{ color: "var(--ink-color-global-text-default)" }}>{fmtMoney(s.fundInvested, ccy)}</strong>, held at <strong style={{ color: "var(--ink-color-global-text-default)" }}>{fmtMoney(s.fundFmv, ccy)}</strong></span>
        )}
      </div>
      <PrefStackTable company={company} />
      <span style={{ ...sans, fontSize: FS.micro, color: MICRO, display: "block", marginTop: 8 }}>
        Source: Carta cap-table records. The liquidation waterfall (in Scenario controls) is a transparent pragmatic estimate from these terms — not Carta's official waterfall engine.
      </span>
    </>
  );
}

// "Cap table & preferences" hover popover — same tucked-away treatment as
// "See positions", so the share-class stack doesn't occupy the expander by default.
function CapTablePopover({ company }) {
  return (
    <HoverPopover label="Cap table & preferences" maxWidth={720} panelPadding="10px 14px 12px">
      <CapTableDetail company={company} />
    </HoverPopover>
  );
}

const StatusChip = ({ variant, children }) => (
  <span className={`tag tag--${variant}`}>{children}</span>
);

// Freezes the FV column so a reprice can't reflow the row: under auto table-layout
// only FV's header ("FV") is narrower than a large value, so it alone grew a digit
// mid-drag and shoved its neighbours. 88 = widest cell the $B roll-up yields (an
// 8-char delta ~"−$999.9M" + padding). Auto layout is kept (not fixed) so Company
// compresses on resize instead of collapsing; no-op for Invested/MOIC/Deal IRR.
const NUM_COL_MIN_W = 88;
// nowrap: a wrapped value would break the fixed two-line cellStack height.
const numTd = { ...mono, textAlign: "right", fontSize: FS.value, whiteSpace: "nowrap", minWidth: NUM_COL_MIN_W };
// FV/MOIC/Deal IRR cells can show a second (change) line when repriced — see
// StackedValue below for how the value stays centred and the row height stays
// fixed (no mid-drag jitter).
const VAL_LINE = { lineHeight: 1.1 };
const DELTA_BASE = { ...SMALL_1, fontVariantNumeric: "tabular-nums" };
const cellStack = { position: "relative", height: 34, display: "flex", flexDirection: "column", justifyContent: "center" };
// Primary value centred in the row (so it lines up with the single-line columns);
// the optional change line is hung just below it with absolute positioning so it
// doesn't lift the value off-centre. cellStack's fixed height keeps the row from
// changing height when the change line appears/disappears mid-drag.
const StackedValue = ({ children, delta, up }) => (
  <div style={cellStack}>
    <div style={{ position: "relative" }}>
      <div style={VAL_LINE}>{children}</div>
      {delta != null && (
        <div style={{ ...DELTA_BASE, display: "inline-flex", alignItems: "center", gap: 3, color: up >= 0 ? "var(--ink-color-global-feedback-positive-strong)" : "var(--ink-color-global-feedback-negative-strong)", position: "absolute", top: "100%", right: 0, whiteSpace: "nowrap" }}>
          <DeltaCaret up={up >= 0} />{delta}
        </div>
      )}
    </div>
  </div>
);

// Fixed Status-column width sized for the widest chip ("Exited · realized").
// Pinning the last column stops the table reflowing when "Show realized" toggles.
const STATUS_COL_W = 132;

// Reported-metrics time series (Carta Data Collection) — a compact line chart with
// a metric dropdown, rendered in the company expander. Values are the company's own
// reported figures (revenue/ARR/EBITDA/…), in the metric's own currency.
const MT_W = 720, MT_H = 210, MT_PL = 10, MT_PR = 16, MT_PT = 22, MT_PB = 26;
function MetricTrend({ financials }) {
  const all = (financials?.series || []).filter((s) => s.points && s.points.length);
  const [key, setKey] = useState(all[0]?.key);
  const [hoverI, setHoverI] = useState(null); // hovered column index
  if (!all.length) return null;
  const s = all.find((x) => x.key === key) || all[0];
  const pts = s.points;
  const isMoney = s.unit === "Dollar";
  const fmtV = (v) => (isMoney ? fmtRev(v, s.currency) : Math.round(v).toLocaleString());
  const vals = pts.map((p) => p.v);
  const lo = Math.min(0, ...vals), hi = Math.max(0, ...vals), span = hi - lo || 1;
  // column geometry — one bar per period, centered in its slot
  const slotW = (MT_W - MT_PL - MT_PR) / pts.length;
  const bx = (i) => MT_PL + (i + 0.5) * slotW;
  const barW = Math.min(slotW * 0.66, 26);
  const y = (v) => MT_PT + (1 - (v - lo) / span) * (MT_H - MT_PT - MT_PB);
  const last = pts[pts.length - 1];
  const hv = hoverI != null && hoverI < pts.length ? hoverI : null; // valid hovered index (pts change with metric)
  const shown = hv != null ? pts[hv] : last; // hero tracks the hovered column, else latest
  // Per-column x labels — infer cadence from the median gap between periods, then
  // label EVERY column ("Qn 'YY" for quarterly/monthly, "YYYY" for annual) instead
  // of only tagging the first bar of each year. Thin out (keeping first + last) only
  // when a long series would otherwise overlap.
  const parseD = (d) => { const [y, m, day] = (d || "").split("-").map(Number); return Date.UTC(y || 1970, (m || 1) - 1, day || 1); };
  const gaps = pts.slice(1).map((p, i) => (parseD(p.d) - parseD(pts[i].d)) / 86400000);
  const avgGap = gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length : 365;
  const annual = avgGap >= 300;
  const xLabel = (d) => {
    const [y, m] = (d || "").split("-").map(Number);
    return annual ? String(y) : `Q${Math.floor(((m || 1) - 1) / 3) + 1} '${String(y).slice(2)}`;
  };
  const labelStep = Math.max(1, Math.ceil(pts.length / 9)); // ≤ 9 labels so they never collide
  const selStyle = { ...sans, fontSize: FS.body, padding: "3px 6px", background: "var(--ink-color-global-surface-background-default)", color: "var(--ink-color-global-text-default)", border: `1px solid var(--ink-color-global-border-subtle)`, borderRadius: 4 };
  return (
    <div style={{ margin: "4px 0 16px" }}>
      {/* Headline: the SELECTED metric's value AND its period date — tracks both the
          dropdown and the hovered column (falls back to the latest period). */}
      <div style={{ display: "flex", alignItems: "flex-end", gap: 14, flexWrap: "wrap", marginBottom: 8 }}>
        <div>
          <SubLabel style={{ marginBottom: 3 }}>{s.label}</SubLabel>
          <span style={{ ...tightSans, fontSize: FS.display, fontWeight: 700, color: shown.v < 0 ? "var(--ink-color-global-feedback-negative-strong)" : "var(--ink-color-global-text-default)", lineHeight: 1 }}>{fmtV(shown.v)}</span>
          <span style={{ ...sans, fontSize: FS.small, fontWeight: 600, color: "var(--ink-color-global-text-subtle)", marginLeft: 10 }}>{shown.d}</span>
        </div>
        <span style={{ flex: 1 }} />
        <select value={s.key} onChange={(e) => { setKey(e.target.value); setHoverI(null); }} style={selStyle} aria-label="Metric">
          {all.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
        </select>
        <span style={{ ...sans, fontSize: FS.small, color: "var(--ink-color-global-text-subtle)", paddingBottom: 3 }}>
          Carta Data Collection · {pts.length} period{pts.length === 1 ? "" : "s"}
        </span>
      </div>
      {pts.length < 2 ? (
        <div style={{ ...sans, fontSize: FS.small, color: "var(--ink-color-global-text-subtle)" }}>Single reported period.</div>
      ) : (
        <svg viewBox={`0 0 ${MT_W} ${MT_H}`} style={{ width: "100%", display: "block", overflow: "visible" }} role="img" aria-label={`${s.label} over time`}
          onMouseLeave={() => setHoverI(null)}>
          <defs>
            <linearGradient id="mt-bar" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={"var(--ink-color-global-link-default)"} stopOpacity="0.95" />
              <stop offset="100%" stopColor={"var(--ink-color-global-link-default)"} stopOpacity="0.4" />
            </linearGradient>
          </defs>
          {/* baseline (dashed only when values go negative) */}
          <line x1={MT_PL} x2={MT_W - MT_PR} y1={y(0)} y2={y(0)} style={{ stroke: "var(--ink-color-global-border-subtle)" }} strokeWidth="1" strokeDasharray={lo < 0 ? "3 3" : undefined} />
          {pts.map((p, i) => ((i % labelStep === 0 || i === pts.length - 1) ? (
            <text key={"x" + i} x={bx(i)} y={MT_H - 6} textAnchor="middle" style={{ ...sans, fontSize: FS.micro, fill: hv === i ? "var(--ink-color-global-text-default)" : MICRO }}>{xLabel(p.d)}</text>
          ) : null))}
          {pts.map((p, i) => {
            const yv = y(p.v), y0 = y(0);
            const top = Math.min(yv, y0), h = Math.max(1.5, Math.abs(yv - y0));
            const isLast = i === pts.length - 1;
            // wider transparent hit area so the whole slot is hoverable, not just the bar
            return (
              <g key={i} style={{ cursor: "pointer" }} onMouseEnter={() => setHoverI(i)}>
                <rect x={bx(i) - slotW / 2} y={MT_PT} width={slotW} height={MT_H - MT_PT - MT_PB} fill="transparent" />
                <rect x={bx(i) - barW / 2} y={top} width={barW} height={h} rx="3"
                  style={{ fill: p.v < 0 ? "var(--ink-color-global-feedback-negative-strong)" : "url(#mt-bar)" }} opacity={hv == null ? (isLast ? 1 : 0.9) : (i === hv ? 1 : 0.4)} />
              </g>
            );
          })}
          {/* hovered column: value label just above the bar (below for negatives) */}
          {hv != null && (() => {
            const pv = pts[hv].v, col = pv < 0 ? "var(--ink-color-global-feedback-negative-strong)" : "var(--ink-button-background-color-primary-base-default)";
            const ly = Math.max(MT_PT - 4, Math.min(MT_H - 4, pv < 0 ? y(pv) + 15 : y(pv) - 7));
            return <text x={bx(hv)} y={ly} textAnchor="middle" style={{ ...mono, fontSize: FS.body, fontWeight: 700, fill: col }}>{fmtV(pv)}</text>;
          })()}
        </svg>
      )}
    </div>
  );
}

// Position-level aggregates + the current (slider-driven) fair value for one
// company. The single home for the `curFv` formula (live + repriceable → the
// marks move it, otherwise the Carta base) and the cartaFv/cost/proceeds
// reducers, so dealIrrOf and CompanyRow read identical values and can't drift.
// `repriceState` is the companyRepriceState() result (needs uplift + canReprice).
function companyFvState(company, { uplift, canReprice }) {
  const live = company.includeInNav && !company.archived;
  const totalFv = company.positions.reduce((s, p) => s + (p.cartaFv || 0), 0);
  const totalCost = company.positions.reduce((s, p) => s + (p.cost || 0), 0);
  const totalProceeds = company.positions.reduce((s, p) => s + (p.proceeds || 0), 0);
  const curFv = live && canReprice ? totalFv + uplift : totalFv; // uplift already vs Carta
  return { live, totalFv, totalCost, totalProceeds, curFv };
}

// A company's scenario Deal IRR — Carta's reported IRR shifted by the reprice's
// modeled effect at the fund's exit horizon. Single source of truth so the sort
// key and the rendered cell can't drift: both the sort comparator and CompanyRow
// derive it from this + the shared companyFvState. Returns null when no IRR is defined.
function dealIrrOf(company, assumptions, snapshot, updateCompany) {
  const { totalFv, totalProceeds, curFv } = companyFvState(company, companyRepriceState(company, updateCompany));
  return scenarioDealIrr({
    positions: company.positions, exitDate: exitHorizonFor(assumptions, snapshot, company.fundId),
    cartaIrr: company.dealIrr ?? null, baseValue: totalFv, repricedValue: curFv,
    proceeds: totalProceeds, realized: company.realized,
  });
}

function CompanyRow({ company, updateCompany, refDate, staleDays, assumptions, snapshot, readOnly, onOpenCompany, reload, flush, expanded, onToggle, ownership, onHoverChange, onDragStart, onDragEnd }) {
  const { cfg, dilutionCfg, uplift, canReprice } = companyRepriceState(company, updateCompany);
  // FV aggregates + curFv from the shared helper so this row and dealIrrOf agree
  const { live, totalFv, totalCost, totalProceeds, curFv } = companyFvState(company, { uplift, canReprice });
  // Reserve earmarked for THIS company (matches the sidebar total's per-company
  // term): pro-rata follow-on to defend the stake ≈ (dilution defended) × its
  // marked FV pre-dilution, where dilution defended = 30% baseline − its dilution.
  const dilutionDefended = Math.max(0, FULL_RESERVE_DILUTION - (company.futureDilution ?? 0));
  const markFvGross = company.positions.reduce((s, p) => s + positionReprice(company, p, { live: true, dilution: 0 }).repricedFv, 0);
  const companyReserve = dilutionDefended * markFvGross;
  // marginal split per fund — exact while the fund is above its LP make-whole line
  let lpSplit = 0, carrySplit = 0;
  for (const p of company.positions) {
    const u = positionReprice(company, p, { live }).uplift;
    const c = carryRateFor(assumptions, p.fundId);
    lpSplit += u * (1 - c);
    carrySplit += u * c;
  }
  const hasBasis = company.positions.some((p) => p.markBasisB);
  // Firm fully-diluted ownership + the forward "dilution guard" (ownership after
  // the company's modeled future dilution). ownInfo.pct is null when Carta has no
  // ownership on file (unconverted SAFEs / PERCENTAGE=0).
  const ownInfo = companyOwnership(company, ownership);
  const ownDiluted = ownInfo.pct != null && (company.futureDilution ?? 0) > 0;
  const repriced = canReprice && !company.archived && Math.abs(uplift) > 0.5;
  const N = 9;
  const markDate = company.positions.reduce((m, p) => ((p.markDate || "") > m ? p.markDate : m), "");

  const status = company.realized
    ? <StatusChip variant="fb-info">Exited · realized</StatusChip>
    : company.defunct
    ? <StatusChip variant="flex-gray-light">Out of business</StatusChip>
    : repriced
    ? <StatusChip variant="flex-yellow-light">Repriced</StatusChip>
    : company.exited && live
    ? <StatusChip variant="fb-info">Exited · in DPI</StatusChip>
    : <span style={{ ...mono, color: "var(--ink-color-global-text-subtle)" }}>—</span>;

  // ── unified FV / MOIC: the CURRENT (slider-driven) values, with the change
  //    vs the Carta mark shown as a green/red increment when the slider's moved.
  //    curFv / totalFv / totalCost come from companyFvState above.
  const cartaMoic = totalCost > 0 && totalFv > 0 ? totalFv / totalCost : null;
  const curMoic = company.realized
    ? (totalCost > 0 && totalProceeds > 0 ? totalProceeds / totalCost : null)
    : (totalCost > 0 && curFv > 0 ? curFv / totalCost : null);
  const moicDelta = (!company.realized && repriced && cartaMoic != null && curMoic != null) ? curMoic - cartaMoic : null;

  // ── Deal IRR: Carta's reported deal IRR, anchored, then shifted by the reprice's
  //    modeled effect at the fund's assumed exit horizon (gross of fund fees/carry).
  //    Ties out to Carta at rest; moves WITH MOIC when repriced (both are the same
  //    fact for a fixed hold), so a moving MOIC never sits beside a frozen IRR.
  const dealIrr = dealIrrOf(company, assumptions, snapshot, updateCompany);
  const irrDelta = (!company.realized && repriced && company.dealIrr != null && dealIrr != null)
    ? dealIrr - company.dealIrr : null;

  // repriced rows get a left-edge stripe (Ink NewTable.Stripe pattern) instead of a
  // full-row tint; only the expanded state still washes the whole row
  const rowBg = expanded ? "var(--ink-color-global-surface-lightgray-default)" : undefined;

  return (
    <Fragment>
      <tr onClick={onToggle} data-testid={`co-row-${company.slug}`}
        data-datum-id={company.id} data-datum-type="company" data-datum-label={company.name}
        onMouseEnter={() => onHoverChange?.(company.id)} onMouseLeave={() => onHoverChange?.(null)}
        style={{ cursor: "pointer", background: rowBg, opacity: company.defunct ? 0.6 : 1 }}>
        <td style={{ position: "relative", paddingLeft: 10 }}>
          {repriced && (
            <span aria-hidden title="Repriced" style={{ position: "absolute", left: 0, top: 0, bottom: -1, width: 4, background: "var(--stripe-repriced)" }} />
          )}
          <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
            <span aria-hidden style={{ color: "var(--ink-color-global-text-subtle)", flex: "none", display: "inline-flex",
              transform: expanded ? "rotate(90deg)" : "none", transition: "transform .12s" }}>
              {/* Ink's real NewTable.Twiddle chevron renders in a 14×14 icon box.
                  strokeWidth=1.6 matches Ink's documented disclosure-chevron weight
                  (same idea as the Dropdown carat at 1.5) rather than ChevronIcon's
                  generic 1.8 default, which was never tuned for this expand/collapse
                  context. This used to override down to size=11/strokeWidth=2.4, reading
                  visibly smaller than prod; dropped that override to match Ink's 14px box. */}
              <ChevronIcon strokeWidth={1.6} />
            </span>
            <span title={`${companyFundIds(company).join(" · ")} · ${company.positions.length} pos`}
              style={{ ...sans, fontSize: FS.value, fontWeight: 400, color: "var(--ink-color-global-text-default)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 200 }}>
              {company.name}
            </span>
            {company.financials?.series?.length > 0 && (
              <span title="Reported financials collected (Carta Data Collection) — expand to see the trend"
                aria-label="Has reported financials" style={{ flex: "none", display: "inline-flex", alignItems: "center",
                  justifyContent: "center", width: 15, height: 15, borderRadius: "50%", background: "var(--accent-soft)", color: "var(--ink-color-global-link-default)" }}>
                <svg width="9" height="9" viewBox="0 0 12 12" aria-hidden="true">
                  <path d="M2.5 6.3 L5 8.7 L9.5 3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
            )}
            {company.capTable?.available && (
              <span title={company.capTable.hasPrefTerms
                ? "Detailed cap table available — liquidation preferences modeled (expand the row, then hover “Cap table & preferences”; incorporate the liquidation waterfall in Scenario controls)"
                : "Detailed cap table available (expand the row, then hover “Cap table & preferences”)"}
                aria-label={company.capTable.hasPrefTerms ? "Detailed cap table with liquidation preferences" : "Detailed cap table available"}
                style={{ flex: "none", display: "inline-flex", alignItems: "center", justifyContent: "center",
                  width: 15, height: 15, borderRadius: 3, border: `1px solid var(--ink-color-global-link-default)`, color: "var(--ink-color-global-link-default)",
                  background: company.capTable.hasPrefTerms ? "var(--blue-soft, transparent)" : "transparent" }}>
                {/* stacked-layers glyph = the preference stack */}
                <svg width="9" height="9" viewBox="0 0 12 12" aria-hidden="true">
                  <path d="M6 1 L11 3.5 L6 6 L1 3.5 Z M1 6 L6 8.5 L11 6 M1 8.5 L6 11 L11 8.5"
                    fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" strokeLinecap="round" />
                </svg>
              </span>
            )}
          </div>
        </td>
        <td style={numTd}>{fmtM(totalCost)}</td>
        <td style={numTd}>
          <StackedValue up={uplift}
            delta={!company.realized && repriced ? fmtM(Math.abs(uplift)) : null}>
            {company.realized ? "—" : fmtM(curFv)}
          </StackedValue>
        </td>
        <td style={numTd}>{markDate ? fmtAsOf(markDate) : "—"}</td>
        <td style={numTd}>
          <StackedValue up={moicDelta ?? 0}
            delta={moicDelta != null && Math.abs(moicDelta) >= 0.05 ? fmtX(Math.abs(moicDelta), 1) : null}>
            {curMoic == null ? "—" : fmtX(curMoic, 1)}
          </StackedValue>
        </td>
        <td style={{ ...numTd, color: dealIrr == null ? "var(--ink-color-global-text-subtle)" : dealIrr >= 0 ? "var(--ink-color-global-feedback-positive-strong)" : "var(--ink-color-global-feedback-negative-strong)" }}
          title="Carta's reported deal IRR, shifted by the modeled reprice at the fund's assumed exit horizon (gross of fund fees/carry).">
          <StackedValue up={irrDelta ?? 0}
            delta={irrDelta != null && Math.abs(irrDelta) >= 0.001 ? fmtPct(Math.abs(irrDelta)) : null}>
            {dealIrr == null ? "—" : fmtPct(dealIrr)}
          </StackedValue>
        </td>
        <td style={numTd}
          title={ownInfo.pct == null
            ? "No Carta ownership on file (e.g. unconverted SAFE, or ownership not yet recorded)."
            : ownDiluted
            ? `Firm fully-diluted ownership; ${fmtOwn(ownInfo.postDilution)} after ${fmtPct(company.futureDilution)} expected future dilution.`
            : "Firm fully-diluted ownership (Carta cap-table records)."}>
          <StackedValue up={ownDiluted ? -1 : 0}
            delta={ownDiluted ? fmtOwn(ownInfo.postDilution) : null}>
            {ownInfo.pct == null ? "—" : fmtOwn(ownInfo.pct)}
          </StackedValue>
        </td>
        <td style={{ padding: "6px 12px", minWidth: 112 }} onClick={(e) => e.stopPropagation()}>
          {cfg && <RepriceControl {...cfg} uplift={uplift} locked={readOnly} compact hideReadout onDragStart={onDragStart} onDragEnd={onDragEnd} />}
        </td>
        <td style={{ textAlign: "left", width: STATUS_COL_W }}>{status}</td>
      </tr>

      {expanded && (
        <tr onMouseEnter={() => onHoverChange?.(company.id)} onMouseLeave={() => onHoverChange?.(null)}>
          <td colSpan={N} style={{ background: "var(--ink-color-global-surface-background-default)", padding: 0 }}>
            <div style={{ padding: "10px 20px 20px" }}>
              {/* headline: repriced split + ownership + details link */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 14, flexWrap: "wrap", marginBottom: 12 }}>
                <div style={{ ...sans, fontSize: FS.body, color: "var(--ink-color-global-text-subtle)" }}>
                  {repriced && (
                    <span style={{ ...mono, fontSize: FS.bodyLg, fontWeight: 700, color: uplift >= 0 ? "var(--ink-color-global-feedback-positive-strong)" : "var(--ink-color-global-feedback-negative-strong)" }}>
                      {uplift >= 0 ? "+" : "−"}{fmtM(Math.abs(uplift))} company FV
                      <span style={{ ...sans, fontSize: FS.small, color: "var(--ink-color-global-text-subtle)", fontWeight: 500, marginLeft: 8 }}>→ LP NAV {fmtM(lpSplit)} · carry {fmtM(carrySplit)}</span>
                    </span>
                  )}
                  {company.realized && <>Crystallized exit · counts in DPI, not modeled · proceeds {fmtM(totalProceeds)} · {totalCost > 0 && totalProceeds > 0 ? fmtX(totalProceeds / totalCost, 1) : "—"} realized</>}
                  {company.defunct && <>Out of business · held at Carta marks</>}
                  {ownInfo.pct != null && <span style={{ marginLeft: repriced ? 10 : 0 }}>{fmtOwn(ownInfo.pct)} fully-diluted ownership</span>}
                </div>
                {onOpenCompany && company.corpUuid && (
                  <Btn kind="link" onClick={(e) => { e.stopPropagation(); onOpenCompany(company.corpUuid); }} title="Open company page">
                    Details ↗
                  </Btn>
                )}
              </div>

              {/* ── Fundamentals: reported financials, trend, last round, positions ── */}
              <Section label="Fundamentals">
                {(fin => (fin?.series || []).some((sr) => sr.points && sr.points.length) ? (
                  <MetricTrend financials={fin} />
                ) : (
                  // No usable reported-metric series (no financials at all, or a
                  // financials object with no plottable points) — make the absence
                  // explicit rather than silently omitting the metrics area.
                  <div style={{ ...sans, fontSize: FS.body, color: "var(--ink-color-global-text-subtle)", marginBottom: 10 }}>
                    No reported financials <span style={{ color: MICRO }}>(Carta Data Collection)</span>
                  </div>
                ))(company.financials)}

                {company.lastRound && (
                  <div style={{ ...sans, fontSize: FS.body, color: "var(--ink-color-global-text-subtle)", marginBottom: 10 }}>
                    Last priced round: <strong style={{ color: "var(--ink-color-global-text-default)" }}>{roundLabel(company.lastRound.round)}</strong>
                    {company.lastRound.postMoney ? ` · ${fmtM(company.lastRound.postMoney)} post-money` : ""}
                    {company.lastRound.date ? ` · ${company.lastRound.date}` : ""}
                  </div>
                )}

                <div style={{ display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap" }}>
                  <PositionsPopover company={company} refDate={refDate} staleDays={staleDays} />
                  {companyHasCapTable(company) && <CapTablePopover company={company} />}
                </div>
              </Section>

              {/* ── Scenario controls: valuation, dilution, realize ── */}
              {cfg && (
                <Section label="Scenario controls">
                  {/* compact toggle cluster — liquidation waterfall + realize, side by side */}
                  <div style={{ marginBottom: 14 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap", rowGap: 6 }}>
                      {companyHasCapTable(company) && !company.realized && !company.defunct && (
                        <Toggle small checked={!!company.waterfallMode}
                          onChange={(val) => updateCompany(company.id, val
                            ? { waterfallMode: true, includeInNav: true, valuationB: company.valuationB ?? companyReferenceExit(company) / 1e9 }
                            : { waterfallMode: false })}
                          labels={["Liquidation waterfall applied", "Incorporate liquidation waterfall"]} locked={readOnly}
                          title="Values the fund's stake through the preference stack at the slider valuation — floors the downside, converges to ownership × value. Independent of Realize." />
                      )}
                      <Toggle small checked={!!company.exited}
                        onChange={(val) => updateCompany(company.id, { exited: val, includeInNav: true })}
                        labels={["Realized at this mark", "Realize at this mark"]} locked={readOnly}
                        title="Crystallize this holding's marked value into LP distributions (DPI) — runs the make-whole waterfall; LP NAV drops by the realized amount." />
                    </div>
                    <span style={{ ...sans, fontSize: FS.micro, color: MICRO, display: "block", marginTop: 5, lineHeight: 1.45, maxWidth: 560 }}>
                      {companyHasCapTable(company) && !company.realized && !company.defunct
                        ? <><strong style={{ color: "var(--ink-color-global-text-subtle)" }}>Waterfall</strong> values the stake through the preference stack at the slider valuation (floors downside). <strong style={{ color: "var(--ink-color-global-text-subtle)" }}>Realize</strong> crystallizes it into DPI. Independent.</>
                        : <>Realize crystallizes this holding's marked value into DPI (make-whole waterfall; LP NAV drops by the realized amount).</>}
                    </span>
                  </div>
                  {company.exited && !company.realized && (
                    <ExitTimingSection company={company} totalFv={totalFv} curFv={curFv} proceeds={totalProceeds}
                      navAsOf={snapshot?.source?.navAsOf} locked={readOnly} updateCompany={updateCompany}
                      onDragStart={onDragStart} onDragEnd={onDragEnd} />
                  )}
                  <div style={{ marginBottom: 14 }}>
                    <SubLabel>{companyIsWaterfall(company) ? "Company valuation (liquidation waterfall)" : hasBasis ? "Company valuation" : "Mark · multiple of invested cost (MOIC)"}</SubLabel>
                    <RepriceControl {...cfg} uplift={uplift} locked={readOnly} showTick
                      onReset={() => updateCompany(company.id, (c) => ({
                        valuationB: c.defaultValuationB ?? null, markMultiple: 1,
                        includeInNav: false, exited: false, exitTimingQ: 0, futureDilution: 0, waterfallMode: false,
                      }))}
                      onDragStart={onDragStart} onDragEnd={onDragEnd} />
                    {companyIsWaterfall(company) && (
                      <div style={{ marginTop: 10 }}>
                        <WaterfallCurve company={company} />
                        <span style={{ ...sans, fontSize: FS.small, color: "var(--ink-color-global-text-subtle)", display: "block", marginTop: 2 }}>
                          Fund proceeds vs company valuation (solid) vs a flat ownership × value line (dashed). Marker = the current valuation.
                        </span>
                      </div>
                    )}
                  </div>
                  {dilutionCfg && (
                    <div style={{ marginBottom: 14 }}>
                      <SubLabel>Expected future dilution</SubLabel>
                      <RepriceControl {...dilutionCfg} locked={readOnly} hidePresets onDragStart={onDragStart} onDragEnd={onDragEnd} />
                      <span style={{ ...sans, fontSize: FS.small, color: "var(--ink-color-global-text-subtle)", display: "block", marginTop: 6 }}>
                        Haircuts this company's value to the fund by the % you expect future rounds to dilute the stake — lowers TVPI and DPI.
                      </span>
                      {ownInfo.pct != null && (
                        <span style={{ ...sans, fontSize: FS.small, color: "var(--ink-color-global-text-subtle)", display: "block", marginTop: 4 }}>
                          Ownership <strong style={{ ...mono, color: "var(--ink-color-global-text-default)" }}>{fmtOwn(ownInfo.pct)}</strong>
                          {" → "}
                          <strong style={{ ...mono, color: ownDiluted ? "var(--ink-color-global-feedback-negative-strong)" : "var(--ink-color-global-text-default)" }}>{fmtOwn(ownInfo.postDilution)}</strong>
                          {ownDiluted ? ` after ${fmtPct(company.futureDilution)} expected dilution` : " — no dilution modeled"}
                        </span>
                      )}
                      {companyReserve > 0.5 && (
                        <span style={{ ...sans, fontSize: FS.small, color: "var(--ink-color-global-text-subtle)", display: "block", marginTop: 4 }}
                          title={`Estimated pro-rata follow-on to defend this stake ≈ (dilution defended) × current marked FV. Dilution defended = ${fmtPct(FULL_RESERVE_DILUTION)} baseline − ${fmtPct(company.futureDilution ?? 0)} = ${fmtPct(dilutionDefended)}; marked FV (pre-dilution) = ${fmtM(markFvGross)}.`}>
                          Reserve earmarked: <strong style={{ ...mono, color: "var(--ink-color-global-text-default)" }}>{fmtM(companyReserve)}</strong>
                          {" "}<span style={{ color: MICRO }}>— {fmtPct(dilutionDefended)} of dilution defended × {fmtM(markFvGross)} marked FV</span>
                        </span>
                      )}
                    </div>
                  )}
                </Section>
              )}

              {company.notes && <p style={{ ...sans, fontSize: FS.body, color: "var(--ink-color-global-text-subtle)", lineHeight: 1.6, marginTop: 4 }}>{company.notes}</p>}
            </div>
          </td>
        </tr>
      )}
    </Fragment>
  );
}

/** Combined write-off / reset control — one "Reset" menu instead of
 *  two separate buttons, so the same actions work on "All Funds" too. */
function ResetMenu({ onZeroOut, onReset }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useDismissable(open, setOpen, ref);
  return (
    <span ref={ref} style={{ position: "relative" }}>
      {/* size="toolbar" matches the filter ribbon's other triggers (Dropdown, SearchInput, Filters) */}
      <Btn data-testid="reset-menu" size="toolbar" onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open}>
        Reset<ChevronDownIcon size={16} strokeWidth={1.5} />
      </Btn>
      {open && (
        <div role="menu" className="popin" style={{ position: "absolute", top: "calc(100% + 6px)", right: 0, background: "var(--ink-color-global-surface-background-default)",
          border: `1px solid var(--ink-color-global-border-subtle)`, borderRadius: 6, minWidth: 190, zIndex: 50,
          boxShadow: POPOVER_SHADOW }}>
          <MenuItem role="menuitem" tint={false} onClick={() => { setOpen(false); onZeroOut(); }}>Zero out companies</MenuItem>
          <MenuItem role="menuitem" tint={false} onClick={() => { setOpen(false); onReset(); }}>Reset to Carta marks</MenuItem>
        </div>
      )}
    </span>
  );
}

// First-click direction per column — numeric/value columns lead with the
// biggest/most-recent first (desc), text and dates lead alphabetically/oldest
// first (asc). A second click on the same header reverses it.
const SORT_DEFAULT_DIR = { value: "desc", invested: "desc", az: "asc", mark: "desc", stale: "asc", irr: "desc", own: "desc" };

// Ink sortable header for the main portfolio grid. This table keeps its own
// sort machine (string keys, an always-sorted 2-state toggle, and the
// frozenOrder freeze-during-slider-drag), which the generic useTableSort does
// not model — so it stays bespoke, but shares the canonical <SortIcon> and the
// `.ink-sort-btn` styling so the header reads identically to every other table.
function SortableTh({ id, label, align = "right", sortBy, sortDir, onSort, style, hidden }) {
  const active = sortBy === id;
  const ariaSort = active ? (sortDir === "asc" ? "ascending" : "descending") : "none";
  return (
    <th style={{ textAlign: align, ...style }} aria-sort={ariaSort}>
      {/* tabIndex/aria-hidden when `hidden`: the real (non-clone) header stays scrolled
          off-screen but in the DOM while its floating clone is showing — without this,
          the off-screen buttons would still be reachable by Tab and announced by
          screen readers as an invisible, confusing duplicate of the clone's controls. */}
      <button type="button" className="ink-sort-btn" onClick={() => onSort(id)} aria-label={`Sort by ${label}`}
        tabIndex={hidden ? -1 : 0} aria-hidden={hidden || undefined}>
        {/* right-aligned (numeric) columns lead with the icon, mirroring the right-aligned data below */}
        {align === "right" ? <><SortIcon />{label}</> : <>{label}<SortIcon /></>}
      </button>
    </th>
  );
}

// The header row, factored out so the exact same markup renders both in the
// table's own <thead> and in the floating clone below — no duplicated JSX to
// drift out of sync. `colWidths` (from useStickyHeader) pins each cell to the
// real column's measured width so the clone's columns line up with the body
// beneath it (the clone table has no body rows of its own to size against).
// `hidden` is only ever passed to the REAL (in-flow) instance, and only while
// its floating clone is standing in for it — see SortableTh above.
function CompaniesHeaderRow({ sortBy, sortDir, onSort, colWidths, hidden }) {
  const w = (i) => (colWidths ? { width: colWidths[i] } : undefined);
  return (
    <tr>
      {/* paddingLeft 33 = td's own 10px + the row's chevron (14px, Ink's real
          NewTable.Twiddle size) + its 9px gap, so "Company" lines up with the
          name text, not the chevron/stripe at the cell edge */}
      <SortableTh id="az" label="Company" align="left" sortBy={sortBy} sortDir={sortDir} onSort={onSort} style={{ paddingLeft: 33, ...w(0) }} hidden={hidden} />
      <SortableTh id="invested" label="Invested" sortBy={sortBy} sortDir={sortDir} onSort={onSort} style={w(1)} hidden={hidden} />
      <SortableTh id="value" label="FV" sortBy={sortBy} sortDir={sortDir} onSort={onSort} style={w(2)} hidden={hidden} />
      <SortableTh id="stale" label="Mark" sortBy={sortBy} sortDir={sortDir} onSort={onSort} style={w(3)} hidden={hidden} />
      <SortableTh id="mark" label="MOIC" sortBy={sortBy} sortDir={sortDir} onSort={onSort} style={w(4)} hidden={hidden} />
      <SortableTh id="irr" label="Deal IRR" sortBy={sortBy} sortDir={sortDir} onSort={onSort} style={w(5)} hidden={hidden} />
      <SortableTh id="own" label="Own %" sortBy={sortBy} sortDir={sortDir} onSort={onSort} style={w(6)} hidden={hidden} />
      <th style={{ ...sans, textAlign: "left", ...w(7) }}>Reprice</th>
      <th style={{ ...sans, textAlign: "left", width: colWidths ? colWidths[8] : STATUS_COL_W }}>Status</th>
    </tr>
  );
}

export default function Companies({ portfolio, snapshot, exitHorizonOverrides, updateCompany, updateSlice, setAssumption, readOnly, onOpenCompany, reload, flush, holdingsPulled, fundScope, setFundScope, onActiveFundsChange }) {
  // fund filter is the GLOBAL scope (driven by the header picker): "all" ⇔ ALL_FUNDS
  const fundFilter = fundScope === ALL_FUNDS ? "all" : fundScope;
  const [confirm, setConfirm] = useState(null); // {title, message, confirmLabel, danger, onConfirm} or null
  const [query, setQuery] = useState("");
  const [expandedId, setExpandedId] = useState(null); // accordion: one company open at a time
  const [hoverId, setHoverId] = useState(null); // which row the pointer is over — beats expandedId when set
  // tell the Performance sidebar v2 which fund(s) the hovered/expanded company
  // touches, so it can grey out the rest while you're comparing a reprice
  const activeId = hoverId ?? expandedId;
  // a company's fund membership never changes from a reprice edit (only its
  // valuation/multiple does), so this only needs to re-run when the active
  // company changes — not on every portfolio.companies reference from a drag
  const companiesRef = useRef(portfolio.companies);
  companiesRef.current = portfolio.companies;
  useEffect(() => {
    const c = companiesRef.current.find((c) => c.id === activeId);
    onActiveFundsChange?.(c ? companyFundIds(c) : null);
    return () => onActiveFundsChange?.(null); // leaving the tab shouldn't leave funds dimmed behind
  }, [activeId, onActiveFundsChange]);
  const [sortBy, setSortBy] = useState("value");
  const [sortDir, setSortDir] = useState("desc");
  const tableRef = useRef(null);
  const sticky = useStickyHeader(tableRef);
  // While a reprice slider is being dragged, freeze the row order so the table
  // doesn't jump. The frozen order is an array of company IDs in the last-committed
  // sort; we re-sort once when the pointer is released.
  const [frozenOrder, setFrozenOrder] = useState(null);
  // click the active column's header to reverse it; click a different column
  // to switch to it at that column's sensible first-click direction
  const onSortClick = (key) => {
    setFrozenOrder(null); // re-sort now with current scenario values
    if (key === sortBy) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortBy(key); setSortDir(SORT_DEFAULT_DIR[key]); }
  };
  const [globalFilters, setGlobalFilters] = useState({ showRealized: false, statuses: [] });
  const refDate = snapshot.source.marksPulledAt;
  const staleDays = portfolio.assumptions.staleDays ?? 90;
  const FUND_IDS = fundIdsOf(snapshot);
  const { ownership } = useFirmData();

  // ── Exit horizon — the single terminal date the fund(s) are modeled to realize
  //    at current marks; drives the Deal IRR column (same assumption used on LP
  //    Returns). Quick-picks off the NAV year, matching LpReturns' horizonOpts.
  const navYr = +snapshot.source.navAsOf.slice(0, 4);
  const horizonOpts = [
    { d: `${navYr}-12-31`, label: "Exit now" },
    { d: `${navYr + 3}-12-31`, label: "+3 years" },
    { d: `${navYr + 5}-12-31`, label: "+5 years" },
    { d: `${navYr + 7}-12-31`, label: "+7 years" },
  ];
  // Highlighted value: the scoped fund's horizon; in All-Funds mode, the shared
  // value when every fund agrees, else null (mixed → nothing highlighted).
  const scopedHorizon = fundFilter === "all"
    ? (() => {
        const ds = FUND_IDS.map((id) => exitHorizonFor(portfolio.assumptions, snapshot, id));
        return ds.length && ds.every((d) => d === ds[0]) ? ds[0] : null;
      })()
    : exitHorizonFor(portfolio.assumptions, snapshot, fundFilter);
  // Persist: a specific fund sets only that fund; All Funds applies to every fund
  // so the whole grid's Deal IRR reprices to one terminal.
  const setExitHorizon = (d) => {
    // Merge onto the RAW overrides (not the effective map) so pinning one fund
    // can't freeze other funds' derived horizons as explicit picks.
    const map = { ...(exitHorizonOverrides || {}) };
    if (fundFilter === "all") FUND_IDS.forEach((id) => { map[id] = d; });
    else map[fundFilter] = d;
    setAssumption("exitHorizon", map);
  };

  // ── Reserve strategy — a one-click follow-on posture applied across the scope.
  //    Reserving to follow-on pro-rata DEFENDS ownership, so it's modeled as
  //    expected future dilution (aggressive => ~0, conservative => full). Reuses
  //    the futureDilution lever, so the value effect already flows to NAV / TVPI
  //    — no separate reserve return math. Per-company dilution slider fine-tunes.
  const RESERVE_STRATEGIES = [
    { id: "none", label: "No reserve", dilution: FULL_RESERVE_DILUTION },  // no follow-on → full dilution
    { id: "partial", label: "Partial", dilution: FULL_RESERVE_DILUTION / 2 }, // defend ~half
    { id: "full", label: "Full", dilution: 0 },                           // pro-rata defense → no dilution
  ];
  const reserveTargets = (fundFilter === "all"
    ? portfolio.companies.filter((c) => !c.archived)
    : companiesInFund(portfolio, fundFilter)
  ).filter((c) => !c.realized && !c.defunct);
  // highlight a strategy only when every scoped target is live at that dilution
  const scopedStrategy = (() => {
    if (!reserveTargets.length || !reserveTargets.every((c) => c.includeInNav)) return null;
    const match = (d) => reserveTargets.every((c) => Math.abs((c.futureDilution ?? 0) - d) < 0.001);
    return RESERVE_STRATEGIES.find((s) => match(s.dilution))?.id ?? null;
  })();
  const setReserveStrategy = (id) => {
    const s = RESERVE_STRATEGIES.find((x) => x.id === id);
    if (s) updateSlice((body) => applyReserveDilution(body, fundFilter, s.dilution));
  };

  const fvOf = (c) => c.positions.reduce((s, p) => s + (p.cartaFv || 0), 0);
  const costOf = (c) => c.positions.reduce((s, p) => s + (p.cost || 0), 0);
  // a company's uplift vs Carta in the active scenario (drives the amber row +
  // the conditional "Current value" column)
  const upliftOf = (c) => {
    if (c.realized || c.defunct) return 0;
    const liveC = c.includeInNav && !c.archived;
    return c.positions.reduce((s, p) => s + positionReprice(c, p, { live: liveC }).uplift, 0);
  };
  const markDateOf = (c) => c.positions.reduce((m, p) => ((p.markDate || "") > m ? p.markDate : m), "");
  // current (scenario) FV = Carta FV + the active reprice uplift, so FV / MOIC
  // sorts reflect the slider-driven values now shown in those columns
  const curFvOf = (c) => (c.realized ? 0 : fvOf(c) + upliftOf(c));
  // Deal IRR sort — lazy per-render cache so each company's XIRR is computed at
  // most once per sort (not once per comparison). Recreated each render, so it
  // never goes stale against a reprice. Missing IRR stays null; the comparator
  // sinks it below any real value.
  const irrCache = new Map();
  const irrOf = (c) => {
    if (!irrCache.has(c.id)) irrCache.set(c.id, dealIrrOf(c, portfolio.assumptions, snapshot, updateCompany));
    return irrCache.get(c.id);
  };
  // firm fully-diluted ownership for the Own% sort — null when Carta has none on file
  const ownOf = (c) => (ownership || {})[c.id]?.pct ?? null;
  // ascending base comparators — sortDir flips the sign, so each one only has
  // to answer "which of a, b comes first going up", not bake in a direction
  const SORTS = {
    value: (a, b) => curFvOf(a) - curFvOf(b),
    invested: (a, b) => costOf(a) - costOf(b),
    az: (a, b) => a.name.localeCompare(b.name),
    mark: (a, b) => (costOf(a) > 0 ? curFvOf(a) / costOf(a) : -1) - (costOf(b) > 0 ? curFvOf(b) / costOf(b) : -1),
    stale: (a, b) => markDateOf(a).localeCompare(markDateOf(b)),
    // null-safe: a missing IRR sorts below any real value (both null → equal),
    // avoiding a NaN comparator from arithmetic on sentinels
    irr: (a, b) => {
      const x = irrOf(a), y = irrOf(b);
      if (x == null && y == null) return 0;
      if (x == null) return -1;
      if (y == null) return 1;
      return x - y;
    },
    // null-safe like `irr`: companies with no Carta ownership sink below any real %
    own: (a, b) => {
      const x = ownOf(a), y = ownOf(b);
      if (x == null && y == null) return 0;
      if (x == null) return -1;
      if (y == null) return 1;
      return x - y;
    },
  };

  // Pre-status: fund + archived only — used for status option counts
  const preScopeFiltered = portfolio.companies
    .filter((c) => (fundFilter === "all" ? true : companyFundIds(c).includes(fundFilter)))
    .filter((c) => !c.archived);
  const statusCountMap = {};
  preScopeFiltered.forEach((c) => {
    const s = companyStatus(c);
    statusCountMap[s] = (statusCountMap[s] || 0) + 1;
  });
  const statusOptions = ["active", "repriced", "exited-dpi", "defunct", "realized"]
    .map((v) => ({ value: v, label: STATUS_META[v].label, count: statusCountMap[v] || 0 }));

  const filtered = preScopeFiltered
    // Explicit "realized" status bypasses the Show-realized gate (else: count but no rows).
    .filter((c) => globalFilters.showRealized || globalFilters.statuses.includes("realized") || !c.realized)
    .filter((c) => globalFilters.statuses.length === 0 || globalFilters.statuses.includes(companyStatus(c)))
    .filter((c) => !query || c.name.toLowerCase().includes(query.toLowerCase()));

  const companies = frozenOrder
    ? frozenOrder.map((id) => filtered.find((c) => c.id === id)).filter(Boolean)
    : [...filtered].sort((a, b) => SORTS[sortBy](a, b) * (sortDir === "asc" ? 1 : -1));

  const onSliderDragStart = () => {
    if (frozenOrder) return; // already frozen
    const sorted = [...filtered].sort((a, b) => SORTS[sortBy](a, b) * (sortDir === "asc" ? 1 : -1));
    setFrozenOrder(sorted.map((c) => c.id));
  };
  const onSliderDragEnd = () => {}; // order stays frozen until the user clicks a column header

  // the Reset menu's zero-out/reset actions — scoped to the selected fund, or
  // firm-wide across every non-archived company when "All Funds" is selected.
  const onZeroOut = () => {
    if (fundFilter === "all") {
      const total = portfolio.companies.filter((c) => !c.archived).length;
      setConfirm({
        title: "Write off all companies",
        message: `Write off all ${total} portfolio companies to $0?\n\nThen write up only the ones you believe in — dragging a company's tape revives it. “Reset to Carta marks” undoes everything.`,
        confirmLabel: "Write off all",
        danger: true,
        onConfirm: () => { updateSlice((s) => zeroOutAll(s)); setConfirm(null); },
      });
      return;
    }
    const fundName = fundLabel(snapshot.funds.find((f) => f.id === fundFilter)?.name || fundFilter);
    const targets = companiesInFund(portfolio, fundFilter);
    const spans = crossFundCompanies(portfolio, fundFilter);
    const warning = spans.length
      ? `\n\nNote: ${spans.map((c) => c.name).join(", ")} also hold${spans.length === 1 ? "s" : ""} positions in other funds — zeroing affects those positions too.`
      : "";
    setConfirm({
      title: `Write off ${fundName} companies`,
      message: `Write off all ${targets.length} companies in ${fundName} to $0?\n\nThen write up only the ones you believe in — dragging a company's tape revives it. “Reset ${fundName} to Carta” undoes everything.${warning}`,
      confirmLabel: "Write off",
      danger: true,
      onConfirm: () => { updateSlice((s) => zeroOutFund(s, fundFilter)); setConfirm(null); },
    });
  };
  const onResetToCarta = () => {
    updateSlice((s) => (fundFilter === "all" ? resetAllToCarta(s) : resetFundToCarta(s, fundFilter)));
  };

  return (
    <div>
      <H1 actions={
        <FundPicker funds={snapshot.funds} value={fundScope} onChange={(v) => {
          setFundScope(v);
          setGlobalFilters((f) => f.statuses.length ? { ...f, statuses: [] } : f);
        }} />
      }>Companies</H1>
      <MethodNote>
        Every portfolio company at this scenario's marks. Drag <strong>Reprice</strong> to mark a company up or down; click a row to expand its tape, positions and fund impact.
      </MethodNote>
      {/* filter ribbon: search · reserve strategy · exit horizon · global filter · reset */}
      <div style={{ display: "flex", gap: 16, marginTop: 8, marginBottom: 24, flexWrap: "wrap", alignItems: "center" }}>
        <SearchInput
          placeholder="Search companies…" value={query}
          onChange={(e) => setQuery(e.target.value)} aria-label="Search companies"
          style={{ minWidth: 150, flex: "1 1 150px", maxWidth: 263 }}
        />
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <Dropdown
            triggerLabel="Reserves"
            options={RESERVE_STRATEGIES.map((s) => ({ id: s.id, label: s.label }))}
            value={scopedStrategy}
            onChange={setReserveStrategy}
            locked={readOnly}
            nullLabel="Mixed"
            minWidth={190} /* fits "Reserves: No reserve" — the widest of the 3 labels + Mixed — so the
                               trigger's width doesn't jump around as the selected reserve strategy changes */
          />
          <InfoTip label="What does Partial mean?" width={300}>
            <div>Reserve strategy sets how much dry powder the fund holds back to defend ownership in follow-on rounds:</div>
            <ul style={{ margin: "6px 0 0", paddingLeft: 16 }}>
              <li><strong>Full</strong> — fund fully defends its stake: 0% assumed dilution</li>
              <li><strong>Partial</strong> — fund defends about half its stake: 15% assumed dilution</li>
              <li><strong>No reserve</strong> — fund skips follow-on entirely: 30% assumed dilution</li>
            </ul>
          </InfoTip>
        </div>
        <Dropdown
          triggerLabel="Exit"
          options={horizonOpts.map((o) => ({ id: o.d, label: o.label }))}
          value={scopedHorizon}
          onChange={setExitHorizon}
          locked={readOnly}
          nullLabel="Mixed"
          minWidth={140} /* fits "Exit: +3/5/7 years" — the widest of horizonOpts' labels —
                             so this trigger doesn't reflow when the exit horizon changes,
                             same guard as the Reserves dropdown above */
        />
        <GlobalFilter
          filters={globalFilters}
          onChange={(f) => { setGlobalFilters(f); setFrozenOrder(null); }}
          statusOptions={statusOptions}
          rightBoundarySelector='[data-testid="performance-sidebar"]'
        />
        {!readOnly && <div style={{ flex: 1, display: "flex", justifyContent: "flex-end", alignItems: "flex-end" }}><ResetMenu onZeroOut={onZeroOut} onReset={onResetToCarta} /></div>}
      </div>
      {/* scrolls in place via .table-scroll (theme.js) instead of pushing the whole
          page into horizontal scroll — see that rule's comment for why
          overflow-y:hidden keeps useStickyHeader's ancestor walk unaffected.
          tableRef stays on the <table> itself — .closest("table") resolves the
          same regardless of which element the ref points at. */}
      <TableScroll>
        <table className="ledger" ref={tableRef}>
          <thead>
            <CompaniesHeaderRow sortBy={sortBy} sortDir={sortDir} onSort={onSortClick} hidden={sticky.floating} />
          </thead>
          <tbody>
            {companies.map((c) => (
              <CompanyRow key={c.id} company={c} ownership={ownership}
                updateCompany={updateCompany} refDate={refDate} staleDays={staleDays}
                assumptions={portfolio.assumptions} snapshot={snapshot} readOnly={readOnly} onOpenCompany={onOpenCompany} reload={reload} flush={flush}
                expanded={expandedId === c.id} onToggle={() => setExpandedId(expandedId === c.id ? null : c.id)}
                onHoverChange={setHoverId} onDragStart={onSliderDragStart} onDragEnd={onSliderDragEnd} />
            ))}
            {companies.length === 0 && (
              <tr><td colSpan={9} style={{ ...sans, color: "var(--ink-color-global-text-subtle)", padding: "16px 12px" }}>No companies match.</td></tr>
            )}
          </tbody>
        </table>
      </TableScroll>
      {/* the app's font-family is set inline on the root app div, not via a global
          body/html rule — since this clone is portaled to document.body (outside
          that div), it needs its own `sans` or it falls back to the browser's
          default serif font once it floats. */}
      {/* clipped fixed-position slot + a translateX offset by the live scrollLeft —
          keeps the clone's columns aligned with the real body scrolling underneath
          it once Companies' table scrolls in place; see useStickyHeader's hEl/
          scrollLeft tracking in ui/table.jsx. */}
      {createPortal(
        <div className="sticky-clone-slot" style={{ top: sticky.top, left: sticky.left, width: sticky.width, display: sticky.floating ? "block" : "none" }}>
          <table className="ledger sticky-clone" style={{ ...sans, width: sticky.colWidths?.reduce((a, w) => a + w, 0), transform: `translateX(${-(sticky.scrollLeft || 0)}px)` }}>
            <thead>
              <CompaniesHeaderRow sortBy={sortBy} sortDir={sortDir} onSort={onSortClick} colWidths={sticky.colWidths} />
            </thead>
          </table>
        </div>,
        document.body
      )}

      <SourceNote>
        Source: Carta Fund Admin holdings (AGGREGATE_INVESTMENTS). FMV is the latest Carta mark; reprices are scenario inputs.
        Deal IRR is Carta's reported deal IRR at rest, shifted by the reprice's modeled effect at the fund's assumed exit horizon (set above, or on LP Returns) — gross of fund fees/carry, an estimate.
        Companies flagged with the cap-table badge carry Carta share-class records (SUMMARY_CAP_TABLE); expand one to see the liquidation-preference stack and, when enabled, incorporate the liquidation-preference waterfall into the fund's value — a transparent pragmatic estimate, not Carta's official waterfall engine.
      </SourceNote>

      {confirm && <ConfirmDialog {...confirm} onCancel={() => setConfirm(null)} />}
    </div>
  );
}
