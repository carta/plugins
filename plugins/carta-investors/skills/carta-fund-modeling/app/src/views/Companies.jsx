import { useState, useRef, Fragment } from "react";
import { createPortal } from "react-dom";
import { tightSans, sans, inkNum, FS, MICRO, NOTICE, SMALL_1, SMALL_2 } from "../ui/theme.js";
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
import { H1, Btn, Toggle, Num, ChevronDownIcon, HelpCircleIcon, FundPicker, Dropdown, Badge, Eyebrow, MenuItem, useDismissable, ALL_FUNDS, MethodNote, SourceNote, fundLabel, POPOVER_SHADOW, GlobalFilter, SearchInput, DeltaCaret, Modal, EmptyState } from "../ui/components.jsx";
import { useTableSort, SortIcon, useStickyHeader, TableScroll, TableHead } from "../ui/table.jsx";
import RepriceControl from "../ui/RepriceControl.jsx";
import ConfirmDialog from "../ui/ConfirmDialog.jsx";
import { repricePosition, positionReprice, carryRateFor, companyRepriceState, exitHorizonFor,
  companyIsWaterfall, companyHasCapTable, companyReferenceExit, companyExitValueAbs, quarterOffsetDate, quartersBetween } from "../model/reprice.js";
import { fundExitProceeds, fundProceedsCurve, normClass } from "../model/liqpref.js";
import { scenarioDealIrr } from "../model/dealIrr.js";
import { isStaleMark, daysBetween, fundIdsOf } from "../model/funds.js";
import { zeroOutFund, resetFundToCarta, zeroOutAll, resetAllToCarta, companiesInFund, crossFundCompanies, applyReserveDilution } from "../model/slices.js";
import { FULL_RESERVE_DILUTION, companyBaseReserve } from "../model/reserves.js";
import { useFirmData } from "../state/FirmData.jsx";
import { companyOwnership } from "../model/ownership.js";
import { trackClick } from "../analytics.js";
import { ReturnsPreviewContent } from "../ui/PerformanceSidebarV2.jsx";

// A position's "Mark date": prefer the last revaluation (fmvDate), fall back to
// the investment date (markDate) when it was never remarked.
const positionMarkDate = (p) => p.fmvDate || p.markDate || "";

// Rounds a fraction to the SAME decimal precision fmtOwn will display it at
// (1 decimal place as a percent when ≥1%, else 2) — so subtracting two
// ownership fractions AFTER rounding gives a delta that matches what the two
// visible endpoint labels imply, instead of a raw-difference delta that can
// round to a different figure than "displayed A" − "displayed B".
function roundToOwnDisplay(p) {
  if (p == null || !Number.isFinite(p)) return p;
  const decimals = p >= 0.01 ? 1 : 2;
  const scale = 10 ** (decimals + 2);
  return Math.round(p * scale) / scale;
}

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
// Plain (unsortable) columns for PrefStackTable — same col shape TableHead takes
// everywhere else in the app (label/align), just with no `get` accessor.
const CAP_TABLE_COLS = [
  { label: "Share class", align: "left" },
  { label: "Rank" },
  { label: "Liquidation preference", align: "left" },
  { label: "Invested" },
  { label: "Fund holds" },
];

function PrefStackTable({ company }) {
  const entry = company.capTable;
  const ccy = entry.currency;
  const holdBy = {};
  for (const h of entry.fundHoldings || []) holdBy[normClass(h.className)] = h;
  const rank = (c) => (c.seniority != null ? c.seniority : String(c.kind || "").toLowerCase() === "preferred" ? 1 : 999);
  const classes = [...entry.classes].sort((a, b) => rank(a) - rank(b) || String(a.name).localeCompare(String(b.name)));
  return (
    <table className="ledger">
      <TableHead cols={CAP_TABLE_COLS} />
      <tbody>
        {classes.map((cl, i) => {
          const h = holdBy[normClass(cl.name)];
          const isPref = String(cl.kind || "").toLowerCase() === "preferred" && cl.multiplier != null;
          return (
            <tr key={i}>
              <td style={{ whiteSpace: "nowrap" }}>
                {cl.name}
                {cl.kind && <span style={{ ...sans, fontSize: FS.micro, color: MICRO, marginLeft: 6 }}>{cl.kind}</span>}
              </td>
              <td style={{ ...inkNum, textAlign: "right" }}>{cl.seniority != null ? cl.seniority : "—"}</td>
              <td style={{ color: isPref ? "var(--ink-color-global-text-default)" : "var(--ink-color-global-text-subtle)" }}>{prefDescriptor(cl)}</td>
              <td style={{ ...inkNum, textAlign: "right" }}>{fmtMoney(cl.cashRaised, ccy)}</td>
              <td style={{ ...inkNum, textAlign: "right", color: h ? "var(--ink-color-global-text-default)" : "var(--ink-color-global-text-subtle)" }}>{h && h.shares > 0 ? fmtShares(h.shares) : "—"}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// Fund-proceeds-vs-exit-value curve — shows the preference floor at low exits
// and the convergence to as-converted pro-rata at high exits, plus a dashed
// linear-ownership reference and a marker at the current scenario exit value.
// X is the company's exit valuation ($B), Y is the fund's proceeds ($B). Sized
// to fill the trailing column width (viewBox scales via width: 100%). Axis
// titles (not just tick numbers) so the two dashed lines' meaning — the
// vertical "you are here" guide vs. the diagonal linear-ownership reference —
// reads from the chart itself rather than needing the legend explained.
const WC_W = 640, WC_H = 170, WC_PL = 62, WC_PR = 12, WC_PT = 14, WC_PB = 40;
// One step below FS.micro (the app's existing floor, 10px) — chart tick labels
// are the smallest text in the app, smaller than the eyebrows/footnotes micro covers.
const WC_TICK_FS = 9;
// A run of consecutive curve points whose proceeds are flat (within `eps` of
// each other) — the regions where dragging company valuation further doesn't
// move fund proceeds at all, because the liquidation-preference stack ahead of
// this holding (or, at the top, a participation cap) absorbs the difference.
// Only worth shading if the run spans a meaningful slice of the domain — a
// couple of adjacent samples matching by chance isn't a real flat region.
function flatRegions(pts, maxExit) {
  const eps = Math.max(1, Math.max(...pts.map((p) => p.y)) * 0.001);
  const regions = [];
  let start = 0;
  for (let i = 1; i <= pts.length; i++) {
    const brokeRun = i === pts.length || Math.abs(pts[i].y - pts[start].y) > eps;
    if (brokeRun) {
      const end = i - 1;
      if (pts[end].x - pts[start].x > maxExit * 0.03) regions.push({ x0: pts[start].x, x1: pts[end].x, y: pts[start].y });
      start = i;
    }
  }
  return regions;
}

function WaterfallCurve({ company }) {
  const entry = company.capTable;
  const refExitB = companyReferenceExit(company) / 1e9; // billions
  // Mirrors repriceConfig's waterfall-mode slider max EXACTLY (reprice.js) — a
  // stable, company-intrinsic domain, never the currently-dragged exit value.
  // Keeps the marker tracking the slider correctly, same principle as
  // reprice.js's `ref` computation.
  const maxExit = Math.max(1, (refExitB || 1) * 8) * 1e9;
  const curExit = companyExitValueAbs(company);
  const pts = fundProceedsCurve(entry, maxExit, 48);
  const [hoverFlatIdx, setHoverFlatIdx] = useState(null);
  if (pts.length < 2) return null;
  const maxY = Math.max(...pts.map((p) => p.y), 1);
  const x = (v) => WC_PL + (v / maxExit) * (WC_W - WC_PL - WC_PR);
  const y = (v) => WC_PT + (1 - v / maxY) * (WC_H - WC_PT - WC_PB);
  const path = pts.map((p, i) => `${i ? "L" : "M"}${x(p.x).toFixed(1)} ${y(p.y).toFixed(1)}`).join(" ");
  const cur = fundExitProceeds(entry, curExit).proceeds;
  const ticks = [0, 0.25, 0.5, 0.75, 1];
  const flats = flatRegions(pts, maxExit);
  return (
    <div style={{ position: "relative" }}>
      <svg viewBox={`0 0 ${WC_W} ${WC_H}`} style={{ width: "100%", display: "block", overflow: "visible" }}
        role="img" aria-label={`Fund proceeds vs company valuation — currently ${fmtB(curExit / 1e9)}`}>
        {/* Flat regions — no proceeds movement as valuation moves through here — get a
            light gray band so the "why isn't this changing" spans are obvious at a glance,
            not just discoverable by dragging the slider back and forth. The hover
            explanation renders as an HTML overlay below (anchored in chart-percentage
            space, not viewport space — SVG has no room for a real tooltip, and the usual
            viewport-relative tooltip math fights the fixed-size modal this chart lives in). */}
        {flats.map((f, i) => (
          <rect key={`flat${i}`} x={x(f.x0)} y={WC_PT} width={Math.max(1, x(f.x1) - x(f.x0))} height={y(0) - WC_PT}
            style={{ fill: i === hoverFlatIdx ? "var(--ink-color-global-surface-lightgray-hover)" : "var(--ink-color-global-surface-lightgray-default)" }}
            onMouseEnter={() => setHoverFlatIdx(i)} onMouseLeave={() => setHoverFlatIdx(null)} />
        ))}
        <line x1={WC_PL} x2={WC_W - WC_PR} y1={y(0)} y2={y(0)} style={{ stroke: "var(--ink-color-global-border-subtle)" }} strokeWidth="1" />
        <line x1={WC_PL} x2={WC_PL} y1={WC_PT} y2={y(0)} style={{ stroke: "var(--ink-color-global-border-subtle)" }} strokeWidth="1" />
        {/* Y-axis ticks + title ("Fund proceeds") — the vertical axis this curve rises on */}
        {ticks.map((f, i) => (
          <line key={`yt${i}`} x1={WC_PL - 4} x2={WC_PL} y1={y(maxY * f)} y2={y(maxY * f)} style={{ stroke: "var(--ink-color-global-border-subtle)" }} strokeWidth="1" />
        ))}
        {ticks.map((f, i) => (
          <text key={`y${i}`} x={WC_PL - 10} y={y(maxY * f) + 3} textAnchor="end"
            style={{ ...sans, fontSize: WC_TICK_FS, fill: MICRO }}>{fmtB((maxY * f) / 1e9)}</text>
        ))}
        <text x={10} y={(WC_PT + y(0)) / 2} textAnchor="middle"
          transform={`rotate(-90 10 ${(WC_PT + y(0)) / 2})`}
          style={{ ...sans, fontSize: FS.micro, fill: MICRO }}>Fund proceeds</text>
        {/* X-axis ticks + title ("Company valuation") — the horizontal axis you drag the slider along */}
        {ticks.map((f, i) => (
          <line key={`xt${i}`} x1={x(maxExit * f)} x2={x(maxExit * f)} y1={y(0)} y2={y(0) + 4} style={{ stroke: "var(--ink-color-global-border-subtle)" }} strokeWidth="1" />
        ))}
        {ticks.map((f, i) => (
          <text key={`x${i}`} x={x(maxExit * f)} y={WC_H - WC_PB + 14} textAnchor={i === 0 ? "start" : f === 1 ? "end" : "middle"}
            style={{ ...sans, fontSize: WC_TICK_FS, fill: MICRO }}>{fmtB((maxExit * f) / 1e9)}</text>
        ))}
        <text x={WC_PL + (WC_W - WC_PL - WC_PR) / 2} y={WC_H - 6} textAnchor="middle"
          style={{ ...sans, fontSize: FS.micro, fill: MICRO }}>Company valuation</text>
        {/* data-viz turquoise, not the link-blue — this curve isn't a clickable/interactive
            element, and blue here would visually imply otherwise. */}
        <path d={path} fill="none" style={{ stroke: "var(--ink-color-global-data-viz-turquoise-3)" }} strokeWidth="2" strokeLinejoin="round" />
        {/* current exit marker — the moving dot is enough to show where on the curve
            we're looking; a vertical guide down to the axis was redundant with it. */}
        <circle cx={x(curExit)} cy={y(cur)} r="3.2" style={{ fill: "var(--ink-color-global-data-viz-turquoise-3)" }} />
      </svg>
      {/* Anchored in chart-percentage space (not viewport space, unlike InfoTip's portal
          mode) so it tracks the SVG's responsive scaling and stays put regardless of where
          the modal sits on screen. Sits to the right of the shaded region, vertically
          centered on it, with a left-pointing caret per the design spec — not a downward
          caret over the region itself. */}
      {hoverFlatIdx != null && flats[hoverFlatIdx] && (() => { const f = flats[hoverFlatIdx]; return (
        <div role="tooltip" style={{ ...sans, position: "absolute", pointerEvents: "none", zIndex: 200,
          left: `${(x(f.x1) / WC_W) * 100}%`, top: `${((WC_PT + y(0)) / 2 / WC_H) * 100}%`,
          transform: "translate(12px, -50%)",
          width: 220, background: "var(--ink-color-global-brand-black)", color: "var(--ink-color-global-brand-white)",
          fontSize: FS.body, lineHeight: "16px", padding: "10px 14px", borderRadius: "var(--ink-size-global-radius-subtle)",
          boxShadow: "var(--shadow-hover)" }}>
          {f.y <= 0.01
            ? "Liquidation preferences ahead of this position absorb these proceeds — the fund receives nothing here."
            : "Proceeds are capped in this range — participation limits absorb any further upside."}
          <span style={{ position: "absolute", left: -6, top: "50%", transform: "translateY(-50%)",
            borderTop: "6px solid transparent", borderBottom: "6px solid transparent",
            borderRight: "6px solid var(--ink-color-global-brand-black)" }} />
        </div>
      ); })()}
    </div>
  );
}

// Seeds valuationB when switching a company into waterfall mode: reuse an
// existing positive exit value, or fall back to the company's reference exit.
// A written-off company (valuationB: 0) must NOT reuse that 0 — it would zero
// out the waterfall's exit input and collapse every position's FV instantly.
// Shared by the waterfall Toggle and ValuationModeChange's dropdown so both
// switch-to-waterfall paths seed identically, always from the latest company
// state (callers pass this straight to updateCompany's functional form).
const waterfallSeed = (c) => ({ waterfallMode: true, includeInNav: true, valuationB: c.valuationB > 0 ? c.valuationB : companyReferenceExit(c) / 1e9 });

// ── Exit-timing (realized positions): the marked value is the exit proceeds, but
// the exit DATE stays a lever — the same proceeds received later annualize to a
// lower IRR. The control drags the exit quarter to set it.
const EXIT_Q_MAX = 24; // up to 6 years of quarterly exit timing

const addQuarters = quarterOffsetDate; // shared so slider, chart, and horizon derivation agree

// A short exit-date label for quarter offset q: "Q3 '26".
function exitQLabel(navAsOf, q) {
  const iso = addQuarters(navAsOf, q);
  const [y, m] = iso.split("-").map(Number);
  return `Q${Math.floor(((m || 1) - 1) / 3) + 1} '${String(y).slice(2)}`;
}

// Dropdown for a realized company's assumed exit quarter; persists the offset as
// `company.exitTimingQ`. Until the user picks one, it defaults to the fund-wide
// exit horizon (the "Exit: +N years" master strategy), not today — `defaultExitQ`
// carries that (computed at the call site from `exitHorizonFor`).
function ExitTimingSection({ company, navAsOf, locked, updateCompany, defaultExitQ = 0, onDragStart, onDragEnd }) {
  if (!navAsOf) {
    return (
      <div style={{ marginBottom: 14 }}>
        <PlainLabel>Exit timing</PlainLabel>
        <div style={{ ...sans, fontSize: FS.small, color: "var(--ink-color-global-text-subtle)" }}>
          Unavailable — this fund has no NAV-as-of date in the data pull, so exit timing can't be computed.
        </div>
      </div>
    );
  }
  const selectedQ = Math.round(company.exitTimingQ ?? defaultExitQ);
  // A dropdown of all 25 quarters (Q0-Q24) instead of a drag slider — the exit
  // quarter is a discrete pick, not a continuous value, so a list reads more
  // directly than dragging to the right tick.
  const options = Array.from({ length: EXIT_Q_MAX + 1 }, (_, q) => ({ id: q, label: exitQLabel(navAsOf, q) }));
  return (
    <Dropdown options={options} value={selectedQ} triggerLabel="Exit timing" locked={locked} minWidth={0} maxWidth={220}
      onChange={(q) => {
        onDragStart?.();
        trackClick("FundModeling.Companies.SetExitQuarter");
        updateCompany(company.id, { exitTimingQ: q });
        onDragEnd?.();
      }} />
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
  { label: "Mark date", get: (r) => positionMarkDate(r) },
  { label: "Basis" },
  { label: "Repriced FV", get: (r) => r.repricedFv },
  { label: "Uplift", get: (r) => r.uplift },
];

function PositionsTable({ company, refDate, staleDays }) {
  const live = company.includeInNav && !company.archived;
  const rows = company.positions.map((p) => ({ ...p, ...positionReprice(company, p, { live }) }));
  const { sorted: posRows, sort: posSort, onSort: onPosSort } = useTableSort(rows, POS_COLS);
  const tot = (k) => rows.reduce((s, r) => s + (r[k] || 0), 0);
  const numCell = { ...inkNum, textAlign: "right" };
  return (
    <table className="ledger">
      <TableHead cols={POS_COLS} sort={posSort} onSort={onPosSort} />
      <tbody>
        {posRows.map((r) => {
          const md = positionMarkDate(r);
          return (
          <tr key={r.id}>
            <td style={{ whiteSpace: "nowrap" }}>{r.security || "Equity"}</td>
            <td style={numCell}>{fmt$(r.cost)}</td>
            <td style={numCell}>{fmt$(r.cartaFv)}</td>
            <td style={{ ...numCell, color: "var(--ink-color-global-text-subtle)", whiteSpace: "nowrap" }}>
              {md || "—"}
              {isStaleMark(md, refDate, staleDays) && <StalePill markDate={md} days={daysBetween(md, refDate)} />}
            </td>
            <td style={{ ...numCell, color: NOTICE }}>{r.markBasisB ? fmtB(r.markBasisB) : "—"}</td>
            <td style={{ ...numCell, fontWeight: 600 }}>{fmt$(r.repricedFv)}</td>
            <td style={{ ...numCell, color: r.uplift >= 0 ? "var(--ink-color-global-feedback-positive-strong)" : "var(--ink-color-global-feedback-negative-strong)" }}>{fmt$(r.uplift)}</td>
          </tr>
          );
        })}
        {rows.length > 1 && (
          <tr className="totrow">
            <td>Total</td>
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
// Small uppercase sub-label inside a Section (e.g. "Company valuation").
const SubLabel = ({ children, style }) => (
  <Eyebrow color={MICRO} style={{ marginBottom: 8, ...style }}>{children}</Eyebrow>
);

// Sentence-case sub-label matching the accordion stat strip's own label style
// (StatTile's "plain" tone) — for sub-labels sitting right below that strip,
// where the SubLabel eyebrow's small-caps would read as a style mismatch.
const PlainLabel = ({ children, style }) => (
  <div style={{ ...sans, fontSize: FS.body, fontWeight: 400, color: "var(--ink-color-global-text-subtle)", marginBottom: 8, ...style }}>{children}</div>
);

// Ink dark hover tooltip — reusable for any trigger element. Defaults match the
// Reserves toolbar's "Partial" usage (own HelpCircleIcon button, in-flow, opens
// downward); pass `trigger` + `portal` for triggers that live inside an
// overflow-clipped ancestor, e.g. a table row (see HoverPopover above for why
// table-row popovers need portaling to escape the Companies table's overflow clip).
function InfoTip({ label, children, width = 300, trigger, portal = false, placement = "bottom" }) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false); // stays true after first show so opacity can transition back to 0 on hide
  const [pos, setPos] = useState(null);
  const triggerRef = useRef(null);
  const show = () => {
    setMounted(true);
    setOpen(true);
    if (portal) {
      const r = triggerRef.current?.getBoundingClientRect();
      if (r) {
        const w = Math.min(width, window.innerWidth - 24);
        const top = placement === "top" ? r.top - 8 : r.bottom + 8;
        setPos({ left: Math.max(w / 2 + 12, Math.min(r.left + r.width / 2, window.innerWidth - w / 2 - 12)), top, width: w });
      }
    }
  };
  const hide = () => setOpen(false);

  const triggerEl = trigger ?? (
    <button type="button" aria-label={label} style={{ display: "flex", background: "none", border: "none", padding: 0, cursor: "default", color: "var(--ink-color-global-feedback-info-strong)" }}>
      <HelpCircleIcon size={16} strokeWidth={1.6} />
    </button>
  );

  const caret = (
    <span style={{ position: "absolute", left: "50%", transform: "translateX(-50%)",
      ...(placement === "top"
        ? { top: "100%", borderLeft: "6px solid transparent", borderRight: "6px solid transparent", borderTop: "6px solid var(--ink-color-global-brand-black)" }
        : { bottom: "100%", borderLeft: "6px solid transparent", borderRight: "6px solid transparent", borderBottom: "6px solid var(--ink-color-global-brand-black)" }) }} />
  );

  // Ink's canonical recipe fades the tooltip in/out (transition: opacity 0.1s) rather than
  // mount/unmount — stay mounted once shown (see `mounted`) so hide() can animate to opacity 0
  // instead of disappearing instantly. The global prefers-reduced-motion reset (see EASE usage
  // elsewhere in this file) neutralizes this transition automatically for users who need it.
  // Font size/leading and radius match theme-with-ink's canonical Tooltip recipe
  // (components.md: 12px/16px, radius-subtle) — that skill is the styling target for this
  // app, not the live @carta/ink package's own token values.
  const tooltipBody = (
    <div role="tooltip"
      style={{ ...sans, background: "var(--ink-color-global-brand-black)", color: "var(--ink-color-global-brand-white)",
        fontSize: FS.body, lineHeight: "16px", padding: "10px 14px", borderRadius: "var(--ink-size-global-radius-subtle)",
        boxShadow: "var(--shadow-hover)", zIndex: portal ? 200 : 60, textAlign: "left",
        opacity: open ? 1 : 0, transition: "opacity 0.1s", pointerEvents: "none",
        ...(portal
          ? { position: "fixed", left: pos?.left, top: pos?.top, width: pos?.width, transform: `translate(-50%, ${placement === "top" ? "-100%" : "0"})` }
          : { position: "absolute", [placement === "top" ? "bottom" : "top"]: "calc(100% + 8px)", left: "50%", transform: "translateX(-50%)", width }) }}>
      {children}
      {caret}
    </div>
  );

  return (
    <span ref={triggerRef} style={{ position: portal ? undefined : "relative", display: "inline-flex", alignItems: "center" }}
      onMouseEnter={show} onMouseLeave={hide} onFocus={show} onBlur={hide}>
      {triggerEl}
      {mounted && (portal ? (pos && createPortal(tooltipBody, document.body)) : tooltipBody)}
    </span>
  );
}

// Circular badge shell for a small Ink icon glyph — shared by the row-level InfoTip
// triggers below (financials/cap-table). Circle fill + icon color follow Bubble's
// info tone; `path`/`fillRule`/`clipRule` are the one thing each glyph varies.
function IconBadge({ label, path, fillRule, clipRule }) {
  return (
    <span aria-label={label} tabIndex={0} style={{ flex: "none", display: "inline-flex", alignItems: "center",
      justifyContent: "center", width: 20, height: 20, borderRadius: "50%", background: "var(--ink-color-global-feedback-info-subtle)",
      color: "var(--ink-color-global-feedback-info-strong)" }}>
      <svg width="12" height="12" viewBox="0 0 22 22" aria-hidden="true">
        <path fill="currentColor" fillRule={fillRule} clipRule={clipRule} d={path} />
      </svg>
    </span>
  );
}

// Cap-table detail body — the preference summary line, the share-class stack and
// the source caveat. Rendered inside the Cap table modal (see CompanyRow) so it
// doesn't occupy the always-open expander by default.
function CapTableDetail({ company }) {
  return (
    <TableScroll>
      {company.lastRound && (
        <div style={{ ...sans, fontSize: FS.body, color: "var(--ink-color-global-text-subtle)", marginBottom: 12 }}>
          Last priced round: <strong style={{ color: "var(--ink-color-global-text-default)" }}>{roundLabel(company.lastRound.round)}</strong>
          {company.lastRound.postMoney ? ` · ${fmtM(company.lastRound.postMoney)} post-money` : ""}
          {company.lastRound.date ? ` · ${company.lastRound.date}` : ""}
        </div>
      )}
      <PrefStackTable company={company} />
      {/* Explains why the Company-valuation dropdown doesn't show on Scenario
          inputs for this company (see companyReferenceExit) — the cap table is
          where a reader can actually see the missing data (no lastRound above,
          every class's OIP blank below), so the explanation lives here. */}
      {companyReferenceExit(company) <= 0 && (
        <SourceNote>
          No priced round or original issue price (OIP) data — you won't be able to reprice this company based on company valuation.
        </SourceNote>
      )}
    </TableScroll>
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
const numTd = { ...inkNum, textAlign: "right", fontSize: FS.value, whiteSpace: "nowrap", minWidth: NUM_COL_MIN_W };
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
            return <text x={bx(hv)} y={ly} textAnchor="middle" style={{ ...inkNum, fontSize: FS.body, fontWeight: 700, fill: col }}>{fmtV(pv)}</text>;
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

function CompanyRow({ company, updateCompany, refDate, staleDays, assumptions, portfolio, snapshot, readOnly, onOpenCompany, reload, flush, expanded, onToggle, ownership, onHoverChange, onDragStart, onDragEnd, fundStates, firmAgg, firmLpDelta, firmGpCarry, sliceName, fundScope, onOpenFundSection }) {
  // which detail sub-modal is open — 'captable' | 'financials' | 'positions' | null
  const [openModal, setOpenModal] = useState(null);
  // Which scenario slider (if any) is actively being dragged — "mark" | "dilution" |
  // null. Real pointer-down through pointer-up only (RepriceControl's
  // `onDraggingChange`, distinct from onDragStart/onDragEnd, which also fire on
  // instant chip/reset clicks). Drives the Returns-preview panel's fade treatment:
  // NOT by watching whether a row's value visibly moved (a slow drag can take many
  // renders to cross a rounding boundary even though it IS affecting the metric —
  // that read the fade as "unaffected" when it was really just "hasn't ticked over
  // yet"), but from a precomputed affects-map of which slider touches which row
  // (see ReturnsPreviewContent/FundCard's `dim` props in PerformanceSidebarV2.jsx).
  const [draggingSlider, setDraggingSlider] = useState(null);
  const { cfg, dilutionCfg, uplift, canReprice } = companyRepriceState(company, updateCompany);
  // FV aggregates + curFv from the shared helper so this row and dealIrrOf agree
  const { live, totalFv, totalCost, totalProceeds, curFv } = companyFvState(company, { uplift, canReprice });
  // Reserve earmarked for THIS company (matches the sidebar total's per-company
  // term): pro-rata follow-on to defend the stake ≈ (dilution defended) × its
  // marked FV pre-dilution, where dilution defended = 30% baseline − its dilution.
  const dilutionDefended = Math.max(0, FULL_RESERVE_DILUTION - (company.futureDilution ?? 0));
  const markFvGross = company.positions.reduce((s, p) => s + positionReprice(company, p, { live: true, dilution: 0 }).repricedFv, 0);
  const companyReserve = dilutionDefended * markFvGross;
  // Baseline counterpart for the Company-impact delta — shares its formula
  // with reserves.js's baseReservesEarmarked via companyBaseReserve, so the
  // two never drift apart.
  const companyReserveBase = companyBaseReserve(company);
  // marginal split per fund — exact while the fund is above its LP make-whole line
  let lpSplit = 0, carrySplit = 0, baseLp = 0, baseCarry = 0;
  for (const p of company.positions) {
    const u = positionReprice(company, p, { live }).uplift;
    const c = carryRateFor(assumptions, p.fundId);
    lpSplit += u * (1 - c);
    carrySplit += u * c;
    baseLp += (p.cartaFv || 0) * (1 - c);
    baseCarry += (p.cartaFv || 0) * c;
  }
  // Company's LP NAV / carry, split from the same marginal per-fund carry rate as
  // lpSplit/carrySplit above — an approximation (ignores the fund's preferred-return
  // hurdle) that ties out to FV exactly: curLp + curCarry === curFv.
  const curLp = baseLp + lpSplit;
  const curCarry = baseCarry + carrySplit;
  const hasBasis = company.positions.some((p) => p.markBasisB);
  // Firm fully-diluted ownership + the forward "dilution guard" (ownership after
  // the company's modeled future dilution). ownInfo.pct is null when Carta has no
  // ownership on file (unconverted SAFEs / PERCENTAGE=0).
  const ownInfo = companyOwnership(company, ownership);
  const ownDiluted = ownInfo.pct != null && (company.futureDilution ?? 0) > 0;
  const repriced = canReprice && !company.archived && Math.abs(uplift) > 0.5;

  // ── Accordion summary strip: FV / LP NAV / Carry, each a current (scenario)
  //    value + its change vs the Carta mark (same StatBar the firm-level
  //    MetricBar uses), plus ownership when a detailed Carta cap table is on
  //    file. Ownership's headline is the post-dilution figure — the same
  //    "current scenario value" convention as the other three tiles — with the
  //    pre-dilution Carta-on-file pct as the reference delta (signed negative,
  //    since dilution only ever reduces ownership).
  // Feeds the modal's Returns-preview sidebar (Company impact section) — raw
  // numeric value + fmt fn, matching the Row component Firm/Fund impact
  // already use there, rather than the pre-formatted strings a StatBar needs.
  //
  // Company impact's own Deal IRR row (below) prioritizes THIS company's exit
  // timing over the fund-wide horizon when it's been set (Realize toggled on,
  // with its own exit-timing slider) — the table's dealIrr (further down)
  // always uses the fund-wide horizon, matching its column-wide comparability.
  // Falls back to the same fund-wide horizon dealIrrOf uses when no
  // per-company timing exists, so an un-realized company shows the same
  // figure either way.
  const companyExitDate = company.exited && company.exitTimingQ != null
    ? quarterOffsetDate(snapshot?.source?.navAsOf, company.exitTimingQ)
    : exitHorizonFor(assumptions, snapshot, company.fundId);
  const companyDealIrr = scenarioDealIrr({
    positions: company.positions, exitDate: companyExitDate,
    cartaIrr: company.dealIrr ?? null, baseValue: totalFv, repricedValue: curFv,
    proceeds: totalProceeds, realized: company.realized,
  });
  const companyDealIrrDelta = company.dealIrr != null && companyDealIrr != null
    ? companyDealIrr - company.dealIrr : null;
  const companyImpactRows = [
    { key: "fv", label: "Fair value", value: company.realized ? null : curFv, fmt: fmtM,
      delta: company.realized ? null : uplift, eps: 0.5 },
    { key: "lpnav", label: "LP NAV", value: company.realized ? null : curLp, fmt: fmtM,
      delta: company.realized ? null : lpSplit, eps: 0.5 },
    { key: "carry", label: "Carry", value: company.realized ? null : curCarry, fmt: fmtM,
      delta: company.realized ? null : carrySplit, eps: 0.5 },
    { key: "dealIrr", label: `Deal IRR · exit ${companyExitDate ? companyExitDate.slice(0, 4) : "—"}`,
      value: companyDealIrr, fmt: fmtPct, delta: companyDealIrrDelta, eps: 0.001 },
    // The delta is computed from pct/postDilution rounded to fmtOwn's OWN display
    // precision first, not the raw difference — otherwise "3.6% → 2.5%" (each
    // independently rounded) can show a delta like "▼1.0%" instead of the "1.1%"
    // the two visible endpoints imply, since the underlying unrounded values
    // (e.g. 3.55% and 2.55%) round differently on their own than their exact
    // difference does. Rounding first keeps the displayed numbers self-consistent.
    companyHasCapTable(company) && { key: "own", label: "Fully-diluted ownership",
      value: ownInfo.pct == null ? null : ownInfo.postDilution, fmt: fmtOwn,
      delta: ownInfo.pct == null ? null : -(roundToOwnDisplay(ownInfo.pct) - roundToOwnDisplay(ownInfo.postDilution)), eps: 0.0001 },
    { key: "reserve", label: "Reserves earmarked",
      value: company.realized || company.defunct || company.archived ? null : companyReserve, fmt: fmtM,
      delta: company.realized || company.defunct || company.archived ? null : companyReserve - companyReserveBase, eps: 0.5 },
  ].filter(Boolean);
  // gates the Financials button — same "usable reported-metric series" check the
  // trend chart itself applies inside the modal
  const hasFinancials = (company.financials?.series || []).some((sr) => sr.points && sr.points.length);
  const markDate = company.positions.reduce((m, p) => { const d = positionMarkDate(p); return d > m ? d : m; }, "");

  const status = company.realized
    ? <StatusChip variant="fb-info">Exited · realized</StatusChip>
    : company.defunct
    ? <StatusChip variant="flex-gray-light">Out of business</StatusChip>
    : repriced
    ? <StatusChip variant="flex-yellow-light">Repriced</StatusChip>
    : company.exited && live
    ? <StatusChip variant="fb-info">Exited · in DPI</StatusChip>
    : <span style={{ ...inkNum, color: "var(--ink-color-global-text-subtle)" }}>—</span>;

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

  return (
    <Fragment>
      {/* repriced rows get a left-edge stripe (Ink NewTable.Stripe pattern) instead
          of a full-row tint. Clicking the row opens the company's detail in a
          modal (see `expanded &&` further down) rather than expanding inline. */}
      <tr onClick={onToggle} data-testid={`co-row-${company.slug}`}
        data-datum-id={company.id} data-datum-type="company" data-datum-label={company.name}
        onMouseEnter={() => onHoverChange?.(company.id)} onMouseLeave={() => onHoverChange?.(null)}
        style={{ cursor: "pointer", opacity: company.defunct ? 0.6 : 1 }}>
        <td style={{ position: "relative", paddingLeft: 10 }}>
          {repriced && (
            <span aria-hidden title="Repriced" style={{ position: "absolute", left: 0, top: 0, bottom: -1, width: 4, background: "var(--stripe-repriced)" }} />
          )}
          <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
            <span title={`${companyFundIds(company).join(" · ")} · ${company.positions.length} pos`}
              style={{ ...sans, fontSize: FS.value, fontWeight: 400, color: "var(--ink-color-global-text-default)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 200 }}>
              {company.name}
            </span>
            {company.financials?.series?.length > 0 && (
              <InfoTip portal placement="top" trigger={
                <IconBadge label="Has reported financials" fillRule="evenodd" clipRule="evenodd"
                  path="M11.8 2.65q1.13.1 2.07.52 1.26.59 2.03 1.62t.88 2.4v.42h-1.66l-.03-.21-.02-.15a3 3 0 0 0-.62-1.62 3.4 3.4 0 0 0-1.4-1.06 5 5 0 0 0-1.25-.3v5.9l.47.1q2.5.55 3.65 1.6l.27.25-.04.02q.9 1.02.9 2.63 0 1.38-.75 2.44-.75 1.04-2.09 1.6-1.08.46-2.42.53v1.68h-1.55v-1.7a8 8 0 0 1-2.18-.5 5 5 0 0 1-1.94-1.35l-.2-.26A4.6 4.6 0 0 1 5 14.78v-.41h1.65l.03.2.02.15v.01q.11.93.67 1.6.57.69 1.54 1.08l.18.06q.54.18 1.16.24v-6.2l-.18-.04a7.5 7.5 0 0 1-3.5-1.58 3.7 3.7 0 0 1-1.15-2.83v-.02q0-1.3.74-2.31a5 5 0 0 1 2-1.57 7 7 0 0 1 2.1-.51V.97h1.54zm.01 15.1q.91-.06 1.61-.33l.23-.1a3 3 0 0 0 1.2-.95q.51-.67.51-1.56v-.01q0-1.15-.77-1.8a6.5 6.5 0 0 0-2.75-1.15h-.03zM10.27 4.26q-.75.08-1.33.3-.86.38-1.34 1v.01q-.47.6-.47 1.46 0 1.09.77 1.75.74.64 2.37 1.05z" />
              }>
                Financials available through Carta Data Collection
              </InfoTip>
            )}
            {company.capTable?.available && (
              <InfoTip portal placement="top" trigger={
                <IconBadge label={company.capTable.hasPrefTerms ? "Detailed cap table with liquidation preferences" : "Detailed cap table available"}
                  fillRule="evenodd" clipRule="evenodd"
                  path="M13.8 2a.7.7 0 0 0-1-.7l-10.4 2c-.4 0-.6.3-.6.7v16c0 .4.3.8.7.8H20c.4 0 .8-.4.8-.8v-9.7c0-.4-.3-.7-.7-.8l-6.4-.8V2Zm0 8.2v9h5.4V11l-5.4-.7Zm-1.6-7.3-9 1.7v14.7h2V12h1.5v7.3h2V7h1.6v12.3h2V2.9Z" />
              }>
                {company.capTable.hasPrefTerms
                  ? "Cap table and liquidation preferences available"
                  : "Cap table available"}
              </InfoTip>
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
        <td style={{ textAlign: "left", width: STATUS_COL_W }}>{status}</td>
      </tr>

      {expanded && (
        <Modal title={company.name} subtitle={sliceName && `Scenario: ${sliceName}`} width="xlarge"
          onClose={() => { setOpenModal(null); onToggle(); }}>
          <div style={{ display: "flex", gap: 28 }}>
          <div style={{ flex: "1 1 auto", minWidth: 0 }}>
              {/* headline: last-round context + details link (the FV/LP NAV/Carry/
                  ownership figures live in the sidebar's Company impact section) */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 14, flexWrap: "wrap", marginBottom: 12 }}>
                <div style={{ flex: "1 1 420px" }}>
                  {/* last-round context lives in the Cap table tab (cap-table data belongs
                      there, not in the modal headline) */}
                  {(company.realized || company.defunct) && (
                    <div style={{ ...sans, fontSize: FS.body, color: "var(--ink-color-global-text-subtle)" }}>
                      {company.realized && <>Crystallized exit · counts in DPI, not modeled · proceeds {fmtM(totalProceeds)} · {totalCost > 0 && totalProceeds > 0 ? fmtX(totalProceeds / totalCost, 1) : "—"} realized</>}
                      {company.defunct && <>Out of business · held at Carta marks</>}
                    </div>
                  )}
                </div>
                {onOpenCompany && company.corpUuid && (
                  <Btn kind="link" onClick={(e) => { e.stopPropagation(); trackClick("FundModeling.Companies.OpenDetailsClick"); onOpenCompany(company.corpUuid); }} title="Open company page">
                    Details ↗
                  </Btn>
                )}
              </div>

              {/* Tabs switch what renders below, in place, rather than opening a
                  separate stacked modal — same shell, same size, just a different
                  peer view of this company. Ink's standard underline Tab recipe
                  (theme-with-ink components.md "## Tab" — see the .ink-tabs/
                  .ink-tab rules in theme.js's GLOBAL_CSS), not a bespoke style. */}
              <nav className="ink-tabs" role="tablist" style={{ marginBottom: 16 }}>
                {[
                  { id: null, label: "Scenario inputs" },
                  { id: "positions", label: "Positions" },
                  { id: "captable", label: "Cap table" },
                  { id: "financials", label: "Financials" },
                ].map((t) => {
                  const active = openModal === t.id;
                  return (
                    <button key={t.label} type="button" role="tab" aria-selected={active}
                      className={`ink-tab${active ? " is-active" : ""}`}
                      onClick={(e) => { e.stopPropagation(); setOpenModal(t.id); }}>
                      {t.label}
                    </button>
                  );
                })}
              </nav>

              {openModal === "captable" && (
                companyHasCapTable(company)
                  ? <CapTableDetail company={company} />
                  : <EmptyState type="page" icon="setup" text="No detailed cap table on file for this company." />
              )}
              {openModal === "financials" && (
                hasFinancials
                  ? <MetricTrend financials={company.financials} />
                  : <EmptyState type="page" icon="pending" text="No reported financials on file for this company (Carta Data Collection)." />
              )}
              {openModal === "positions" && (
                <TableScroll><PositionsTable company={company} refDate={refDate} staleDays={staleDays} /></TableScroll>
              )}

              {/* ── Scenario controls: valuation, dilution, realize ── */}
              {!openModal && cfg && (
                <div>
                  <div>
                    {/* Realize + its Exit-timing dropdown float top-right, OUT of normal
                        flow (position: absolute) — a flex sibling column would shrink the
                        slider's own width to "remaining space" (it no longer reaches the
                        full content width, unlike the Dilution slider below), and would
                        still grow the shared row's height when the dropdown appears,
                        pushing the value down. Absolute positioning avoids both: the label
                        + RepriceControl block below renders at full width, undisturbed. */}
                    <div style={{ position: "relative", marginBottom: 24 }}>
                      <div style={{ position: "absolute", top: 0, right: 0, display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <Toggle small checked={!!company.exited}
                            onChange={(val) => {
                              trackClick("FundModeling.Companies.ToggleRealize");
                              updateCompany(company.id, { exited: val, includeInNav: true });
                            }}
                            labels={Array(2).fill(`Realize at ${cfg.fmtVal(cfg.value)} ${companyIsWaterfall(company) || hasBasis ? "valuation" : "MOIC"}`)}
                            locked={readOnly} textColor="var(--ink-color-global-text-default)"
                            title="Crystallize this holding's marked value into LP distributions (DPI) — runs the make-whole waterfall; LP NAV drops by the realized amount." />
                          <InfoTip label="What does Realize mean?" width={320}>
                            <div>Realize crystallizes this holding's marked value into LP distributions (DPI) — runs the make-whole waterfall; LP NAV drops by the realized amount.</div>
                            {companyHasCapTable(company) && !company.realized && !company.defunct && (
                              <div style={{ marginTop: 6 }}>Independent of <strong>Waterfall</strong>, which values the stake through the preference stack at the slider valuation instead of the flat mark.</div>
                            )}
                          </InfoTip>
                        </div>
                        {/* Realize is a toggle, not a checkbox — reads as "flip this on to
                            crystallize" like the other mark-adjacent switches (e.g. Waterfall).
                            Its label names the actual lever being pulled (MOIC vs. dollar
                            valuation) rather than the generic "this mark" — GPs/CFOs talk
                            about an exit in terms of company valuation, not MOIC (a per-fund
                            derived return, not the deal itself), so waterfall/hasBasis's $
                            slider reads "valuation" and the plain multiple slider reads "MOIC". */}
                        {company.exited && !company.realized && (
                          <ExitTimingSection company={company}
                            navAsOf={snapshot?.source?.navAsOf} locked={readOnly} updateCompany={updateCompany}
                            defaultExitQ={Math.max(0, Math.min(EXIT_Q_MAX,
                              quartersBetween(snapshot?.source?.navAsOf, exitHorizonFor(assumptions, snapshot, company.fundId))))}
                            onDragStart={onDragStart} onDragEnd={onDragEnd} />
                        )}
                      </div>
                      {/* MOIC and Company valuation (liquidation waterfall) share one label
                          row — a caret dropdown swaps between them instead of a separate
                          toggle switch below. hasBasis companies (a $-basis mark on file)
                          keep the old plain label; that's a different, data-driven slider
                          mode this control doesn't apply to. The dropdown itself doesn't
                          render at all (falls back to the plain label below) when there's no
                          priced round or OIP on file — switching to Company valuation would
                          otherwise seed a $0 reference exit, and a control with nothing
                          reachable behind it reads better absent than shown-but-greyed-out. */}
                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
                        {!hasBasis && companyHasCapTable(company) && !company.realized && !company.defunct && companyReferenceExit(company) > 0 ? (
                          <ValuationModeChange company={company} updateCompany={updateCompany}
                            locked={readOnly}
                            label={companyIsWaterfall(company) ? "Company valuation" : "MOIC"}
                            infoTip={companyIsWaterfall(company) && (
                              <InfoTip label="What does Company valuation mean?" width={320}>
                                Values the fund's stake through the preference stack (see Cap table) at the slider valuation — floors the downside, converges to ownership × value. Independent of Realize. A transparent pragmatic estimate from the cap table's terms — not Carta's official waterfall engine.
                              </InfoTip>
                            )} />
                        ) : (
                          <PlainLabel style={{ marginBottom: 0 }}>
                            {hasBasis ? (companyIsWaterfall(company) ? "Company valuation (liquidation waterfall)" : "Company valuation")
                              : (companyIsWaterfall(company) ? "Company valuation" : "MOIC")}
                          </PlainLabel>
                        )}
                      </div>
                      <RepriceControl {...cfg} uplift={uplift} locked={readOnly} hidePresets showTick resetLabel="Carta mark"
                        trackId="FundModeling.Reprice.SetValue"
                        onReset={() => {
                          trackClick("FundModeling.Companies.ResetRepriceClick");
                          updateCompany(company.id, (c) => {
                            // Resets the MARK back to Carta — not Realize (one of the mark chips
                            // itself, so it must behave like any other mark change: never flips
                            // Realize off), and not the valuation MODE either — flipping the mode
                            // on reset would silently switch a company back to MOIC from Company
                            // valuation mode when "Carta mark" is clicked. In dollar mode (waterfall
                            // or hasBasis) reset valuationB to
                            // cfg.resetValue — the same reference exit / cartaRef repriceConfig
                            // already computed for THIS mode — instead of the MOIC-mode-only
                            // `defaultValuationB`. Preserve `exited`, and keep includeInNav/
                            // exitTimingQ consistent with whatever that stays.
                            const inDollarMode = companyIsWaterfall(c) || hasBasis;
                            return {
                              valuationB: inDollarMode ? (cfg.resetValue ?? null) : (c.defaultValuationB ?? null),
                              markMultiple: 1,
                              includeInNav: !!c.exited, exitTimingQ: c.exited ? c.exitTimingQ : 0,
                              futureDilution: 0,
                            };
                          });
                        }}
                        onDragStart={onDragStart} onDragEnd={onDragEnd} onDraggingChange={(d) => setDraggingSlider(d ? "mark" : null)} />
                    </div>
                    {/* Waterfall toggle + curve run below the full-width slider */}
                    {hasBasis && companyHasCapTable(company) && !company.realized && !company.defunct && (() => {
                      const hasReferenceExit = companyReferenceExit(company) > 0;
                      return (
                        <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 10 }}>
                          <Toggle small checked={!!company.waterfallMode} disabled={!hasReferenceExit}
                            onChange={(val) => {
                              trackClick("FundModeling.Companies.ToggleWaterfall");
                              updateCompany(company.id, val ? waterfallSeed : { waterfallMode: false });
                            }}
                            labels={["Liquidation waterfall applied", "Incorporate liquidation waterfall"]} locked={readOnly}
                            title={hasReferenceExit
                              ? "Values the fund's stake through the preference stack at the slider valuation — floors the downside, converges to ownership × value. Independent of Realize."
                              : "No priced round or OIP data available for Company valuation mode"} />
                          <InfoTip label="What does the liquidation waterfall toggle do?" width={320}>
                            Values the fund's stake through the preference stack (see Cap table) at the slider valuation — floors the downside, converges to ownership × value. Independent of Realize. A transparent pragmatic estimate from the cap table's terms — not Carta's official waterfall engine.
                          </InfoTip>
                        </div>
                      );
                    })()}
                    {companyIsWaterfall(company) && (
                      <div style={{ marginTop: 10 }}>
                        <WaterfallCurve company={company} />
                      </div>
                    )}
                  </div>
                  {dilutionCfg && (
                    <div style={{ marginBottom: 14 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <PlainLabel style={{ marginBottom: 0 }}>Expected future dilution</PlainLabel>
                        <InfoTip label="What does expected future dilution mean?" width={300}>
                          Haircuts this company's value to the fund by the % you expect future rounds to dilute the stake — lowers TVPI and DPI.
                        </InfoTip>
                      </div>
                      <div style={{ marginTop: 8 }}>
                        <RepriceControl {...dilutionCfg} locked={readOnly} hidePresets hideTick
                          trackId="FundModeling.Companies.SetFutureDilution"
                          onDragStart={onDragStart} onDragEnd={onDragEnd} onDraggingChange={(d) => setDraggingSlider(d ? "dilution" : null)} />
                      </div>
                      {/* Reserve-earmarked readout now sits below the (full-width) slider
                          instead of beside it — no more trailing column to share. */}
                      <div style={{ marginTop: 8 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <div style={{ ...sans, fontSize: FS.value, color: "var(--ink-color-global-text-subtle)" }}>
                            <strong style={{ ...inkNum, fontSize: FS.value, color: "var(--ink-color-global-text-default)" }}>{fmtM(companyReserve)}</strong> reserve earmarked
                          </div>
                          <InfoTip label="What does reserve earmarked mean?" width={320}>
                            {fmtPct(dilutionDefended)} of dilution defended × {fmtM(markFvGross)} marked FV
                          </InfoTip>
                        </div>
                        {ownInfo.pct != null && (
                          <div style={{ ...sans, fontSize: FS.small, color: "var(--ink-color-global-text-subtle)", marginTop: 4 }}>
                            Ownership <strong style={{ ...inkNum, color: "var(--ink-color-global-text-default)" }}>{fmtOwn(ownInfo.pct)}</strong>
                            {" → "}
                            <strong style={{ ...inkNum, color: ownDiluted ? "var(--ink-color-global-feedback-negative-strong)" : "var(--ink-color-global-text-default)" }}>{fmtOwn(ownInfo.postDilution)}</strong>
                            {ownDiluted ? ` after ${fmtPct(company.futureDilution)} expected dilution` : " — no dilution modeled"}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {!openModal && company.notes && <p style={{ ...sans, fontSize: FS.body, color: "var(--ink-color-global-text-subtle)", lineHeight: 1.6, marginTop: 4 }}>{company.notes}</p>}
          </div>
          {fundStates && firmAgg && (
            <div style={{ flex: "0 0 300px" }}>
              <ReturnsPreviewContent fundStates={fundStates} firmAgg={firmAgg} firmLpDelta={firmLpDelta} firmGpCarry={firmGpCarry}
                fundScope={fundScope} snapshot={snapshot} portfolio={portfolio}
                onOpenFundSection={onOpenFundSection} activeFundIds={companyFundIds(company)}
                companyImpact={companyImpactRows} draggingSlider={draggingSlider}
                distributionsAffected={!!company.exited && !company.realized} />
            </div>
          )}
          </div>
        </Modal>
      )}
    </Fragment>
  );
}

/** Caret trigger beside the Mark label — lets MOIC and Company valuation
 *  (liquidation waterfall) share one control instead of a label plus a
 *  separate toggle switch. Selecting "Company valuation" does exactly what
 *  the old waterfall Toggle's onChange did (same valuationB seeding logic);
 *  selecting "MOIC" turns waterfallMode back off. */
function ValuationModeChange({ company, updateCompany, locked, label, infoTip }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useDismissable(open, setOpen, ref);
  const isWaterfall = companyIsWaterfall(company);
  const select = (waterfall) => {
    setOpen(false);
    if (locked || waterfall === isWaterfall) return;
    updateCompany(company.id, waterfall ? waterfallSeed : { waterfallMode: false });
  };
  const toggle = () => setOpen((o) => !o);
  const linkColor = locked ? "var(--ink-color-global-text-disabled)" : "var(--ink-color-global-link-default)";
  return (
    // Label and caret are two separate buttons (both toggle the same dropdown) so
    // `infoTip` — a hover tooltip, not a dropdown trigger — can sit visually
    // between them ("Company valuation (?) ⌄") without living inside either
    // button (a nested button would eat its own click as a toggle). The
    // popover's `left: 0` is relative to THIS span, so it aligns with the
    // label's own left edge rather than the caret's (well to the label's right).
    <span ref={ref} style={{ position: "relative", display: "inline-flex", alignItems: "center", gap: 4 }}>
      <button onClick={toggle} disabled={locked} aria-haspopup="menu" aria-expanded={open}
        title={locked ? undefined : "Change valuation mode"}
        style={{ display: "inline-flex", alignItems: "center", background: "none", border: "none", padding: 0,
          cursor: locked ? "not-allowed" : "pointer" }}>
        <span style={{ ...sans, fontSize: FS.body, fontWeight: 400, color: linkColor }}>{label}</span>
      </button>
      {infoTip}
      <button onClick={toggle} disabled={locked} aria-haspopup="menu" aria-expanded={open}
        title={locked ? undefined : "Change valuation mode"}
        style={{ display: "inline-flex", alignItems: "center", background: "none", border: "none", padding: 0,
          cursor: locked ? "not-allowed" : "pointer" }}>
        <ChevronDownIcon size={16} strokeWidth={1.5}
          style={{ color: linkColor, transition: "transform .12s ease", transform: open ? "rotate(180deg)" : "rotate(0deg)" }} />
      </button>
      {open && (
        <div role="menu" className="popin" style={{ position: "absolute", top: "calc(100% + 6px)", left: 0, background: "var(--ink-color-global-surface-background-default)",
          border: `1px solid var(--ink-color-global-border-subtle)`, borderRadius: 6, minWidth: 190, zIndex: 50,
          boxShadow: POPOVER_SHADOW }}>
          <MenuItem role="menuitem" selected={!isWaterfall} checkmark onClick={() => select(false)}>MOIC</MenuItem>
          <MenuItem role="menuitem" selected={isWaterfall} checkmark onClick={() => select(true)}>Company valuation</MenuItem>
        </div>
      )}
    </span>
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
          <MenuItem role="menuitem" tint={false} onClick={() => { setOpen(false); trackClick("FundModeling.Companies.ZeroOutClick"); onZeroOut(); }}>Zero out companies</MenuItem>
          <MenuItem role="menuitem" tint={false} onClick={() => { setOpen(false); trackClick("FundModeling.Companies.ResetToCartaClick"); onReset(); }}>Reset to Carta marks</MenuItem>
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
      {/* paddingLeft 10 matches the row's own td paddingLeft, so "Company" lines
          up with the name text, not the repriced-stripe at the cell edge */}
      <SortableTh id="az" label="Company" align="left" sortBy={sortBy} sortDir={sortDir} onSort={onSort} style={{ paddingLeft: 10, ...w(0) }} hidden={hidden} />
      <SortableTh id="invested" label="Invested" sortBy={sortBy} sortDir={sortDir} onSort={onSort} style={w(1)} hidden={hidden} />
      <SortableTh id="value" label="FV" sortBy={sortBy} sortDir={sortDir} onSort={onSort} style={w(2)} hidden={hidden} />
      <SortableTh id="stale" label="Mark" sortBy={sortBy} sortDir={sortDir} onSort={onSort} style={w(3)} hidden={hidden} />
      <SortableTh id="mark" label="MOIC" sortBy={sortBy} sortDir={sortDir} onSort={onSort} style={w(4)} hidden={hidden} />
      <SortableTh id="irr" label="Deal IRR" sortBy={sortBy} sortDir={sortDir} onSort={onSort} style={w(5)} hidden={hidden} />
      <SortableTh id="own" label="Own %" sortBy={sortBy} sortDir={sortDir} onSort={onSort} style={w(6)} hidden={hidden} />
      <th style={{ ...sans, textAlign: "left", width: colWidths ? colWidths[7] : STATUS_COL_W }}>Status</th>
    </tr>
  );
}

export default function Companies({ portfolio, snapshot, exitHorizonOverrides, updateCompany, updateSlice, setAssumption, readOnly, onOpenCompany, reload, flush, holdingsPulled, fundScope, setFundScope, fundStates, firmAgg, firmLpDelta, firmGpCarry, sliceName, onOpenFundSection }) {
  // fund filter is the GLOBAL scope (driven by the header picker): "all" ⇔ ALL_FUNDS
  const fundFilter = fundScope === ALL_FUNDS ? "all" : fundScope;
  const [confirm, setConfirm] = useState(null); // {title, message, confirmLabel, danger, onConfirm} or null
  const [query, setQuery] = useState("");
  const [expandedId, setExpandedId] = useState(null); // which company's detail modal is open, if any
  const [hoverId, setHoverId] = useState(null); // which row the pointer is over
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
  const markDateOf = (c) => c.positions.reduce((m, p) => { const d = positionMarkDate(p); return d > m ? d : m; }, "");
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

  const bySort = (a, b) => SORTS[sortBy](a, b) * (sortDir === "asc" ? 1 : -1);
  // A freeze pins the order of the rows it captured and nothing more: a company
  // it never saw (a different fund scope, a search since cleared) still sorts in
  // normally. Letting the freeze pick the rows instead would blank the table
  // whenever the scope moved to a fund sharing none of the frozen companies.
  const companies = (() => {
    if (!frozenOrder) return [...filtered].sort(bySort);
    const rank = new Map(frozenOrder.map((id, i) => [id, i]));
    return [...filtered].sort((a, b) => {
      const ra = rank.get(a.id);
      const rb = rank.get(b.id);
      if (ra != null && rb != null) return ra - rb;
      if (ra != null) return -1;
      if (rb != null) return 1;
      return bySort(a, b);
    });
  })();

  const onSliderDragStart = () => {
    if (frozenOrder) return; // already frozen
    setFrozenOrder([...filtered].sort(bySort).map((c) => c.id));
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
          setFrozenOrder(null); // a new scope is a new set of rows — sort them fresh
          setGlobalFilters((f) => f.statuses.length ? { ...f, statuses: [] } : f);
        }} />
      }>Companies</H1>
      <MethodNote>
        Every portfolio company at this scenario's marks. Click a row to open its tape, positions and fund impact.
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
                assumptions={portfolio.assumptions} portfolio={portfolio} snapshot={snapshot} readOnly={readOnly} onOpenCompany={onOpenCompany} reload={reload} flush={flush}
                expanded={expandedId === c.id} onToggle={() => {
                  const next = expandedId === c.id ? null : c.id;
                  if (next) trackClick("FundModeling.Companies.ExpandCompany");
                  setExpandedId(next);
                }}
                onHoverChange={setHoverId} onDragStart={onSliderDragStart} onDragEnd={onSliderDragEnd}
                fundStates={fundStates} firmAgg={firmAgg} firmLpDelta={firmLpDelta} firmGpCarry={firmGpCarry}
                sliceName={sliceName} fundScope={fundScope} onOpenFundSection={onOpenFundSection} />
            ))}
            {companies.length === 0 && (
              <tr><td colSpan={8} style={{ ...sans, color: "var(--ink-color-global-text-subtle)", padding: "16px 12px" }}>No companies match.</td></tr>
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
