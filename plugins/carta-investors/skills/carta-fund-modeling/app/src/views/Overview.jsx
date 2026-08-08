import { useMemo, useState } from "react";
import { FS, inkNum, sans, MICRO } from "../ui/theme.js";
import { fmt$, fmtM, fmtX, fmtPct, fmtAsOf, fmtOwn } from "../ui/format.js";
import { Num, SourceNote, H1, H3, SectionChips, Segmented, Badge, Bubble, Avatar, fundNameOnly, MultiFundPicker } from "../ui/components.jsx";
import { TableHead, useTableSort, TableScroll } from "../ui/table.jsx";
import { firmRollup } from "../model/funds.js";
import { fundAvgOwnership } from "../model/ownership.js";
import { quarterlySeries, trailingAvg } from "../model/pacing.js";
import { concentrationAcrossAll } from "../model/concentration.js";
import { recentActivity } from "../model/activity.js";
import { useFirmData } from "../state/FirmData.jsx";
import { trackClick } from "../analytics.js";

// ── pacing chart (lifted from the former Pacing view) ──
// Categorical fund palette using Ink data-viz token hex values. SVG fill attributes
// need literal hex (CSS vars don't resolve as SVG presentation attributes), so we
// inline the resolved values from --ink-color-global-data-viz-* tokens.
const PALETTE = [
  "#1A1A1A", // brand-black (lead fund — no data-viz token; Carta primary)
  "#285DA3", // data-viz-blue-3
  "#2D9E90", // data-viz-positive-3 (teal)
  "#DDB31F", // data-viz-yellow-3
  "#58B8BC", // data-viz-turquoise-3
  "#94B524", // data-viz-lime-3
  "#B29990", // data-viz-brown-3
  "#656B6B", // data-viz-neutral-3
  "#E52431", // data-viz-negative-3
  "#CECFCF", // brand-gray-30 (10th slot fallback)
];
const W = 960, H = 300, PL = 34, PR = 12, PT = 18, PB = 30;

function CadenceChart({ quarters, trail, FUNDS, FUND_TINT }) {
  const yMax = Math.max(4, ...quarters.map((r) => r.total)) + 1;
  const slot = (W - PL - PR) / quarters.length;
  const bw = Math.min(16, slot * 0.62);
  const x = (i) => PL + i * slot + slot / 2;
  const y = (n) => PT + (1 - n / yMax) * (H - PT - PB);
  const years = quarters.map((r, i) => ({ i, yr: r.q.slice(0, 4), q: r.q.slice(5) })).filter((t) => t.q === "Q1");
  const trailPath = trail.map((t, i) => `${i ? "L" : "M"} ${x(i)} ${y(t.avg)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", display: "block" }} role="img"
      aria-label="New companies backed per quarter, by fund">
      {[3, 6, 9].filter((n) => n < yMax).map((n) => (
        <g key={n}>
          <line x1={PL} x2={W - PR} y1={y(n)} y2={y(n)} style={{ stroke: "var(--ink-color-global-border-subtle)" }} strokeWidth="1" />
          <text x={PL - 7} y={y(n) + 3} textAnchor="end" style={{ ...inkNum, fontSize: FS.micro, fill: MICRO }}>{n}</text>
        </g>
      ))}
      <line x1={PL} x2={W - PR} y1={y(0)} y2={y(0)} style={{ stroke: "var(--ink-color-global-border-subtle)" }} strokeWidth="1" />
      {years.map((t) => (
        <text key={t.yr} x={x(t.i)} y={H - PB + 17} textAnchor="middle" style={{ ...sans, fontSize: FS.micro, fill: MICRO }}>{t.yr}</text>
      ))}
      {quarters.map((r, i) => {
        let acc = 0;
        return (
          <g key={r.q}>
            <title>{`${r.q.replace("-", " ")} · ${r.total} new compan${r.total === 1 ? "y" : "ies"}`}</title>
            {FUNDS.map((fid) => {
              const n = r.byFund[fid] || 0;
              if (!n) return null;
              const y1 = y(acc + n), h = y(acc) - y(acc + n);
              acc += n;
              return <rect key={fid} x={x(i) - bw / 2} y={y1} width={bw} height={Math.max(h - 1, 1.5)} rx="2.5" fill={FUND_TINT[fid]} />;
            })}
          </g>
        );
      })}
      <path d={trailPath} fill="none" style={{ stroke: "var(--ink-color-global-text-default)" }} strokeWidth="1.8" strokeLinejoin="round" opacity="0.75" strokeDasharray="1 0" />
      {(() => {
        const last = trail[trail.length - 1];
        if (!last) return null;
        const cx = x(trail.length - 1), cy = y(last.avg);
        const label = `${last.avg.toFixed(1)}/qtr · trailing yr`;
        const lw = label.length * 6.2 + 14;
        return (
          <g>
            <circle cx={cx} cy={cy} r="5" style={{ fill: "var(--ink-color-global-surface-background-default)", stroke: "var(--ink-color-global-text-default)" }} strokeWidth="2" />
            <rect x={Math.min(cx + 9, W - PR - lw)} y={Math.max(cy - 25, PT)} width={lw} height="19" rx="9.5" style={{ fill: "var(--ink-color-global-text-default)" }} />
            <text x={Math.min(cx + 9, W - PR - lw) + lw / 2} y={Math.max(cy - 25, PT) + 13} textAnchor="middle"
              style={{ ...inkNum, fontSize: FS.micro, fontWeight: 600, fill: "var(--ink-color-global-surface-background-default)" }}>{label}</text>
          </g>
        );
      })()}
    </svg>
  );
}

/** Investment pacing — new companies per quarter, by fund. Summary chart only
 *  (the full ledger lived in the old Pacing tab). Hidden if no pacing data. */
function PacingCard({ funds = [] }) {
  const { pacing: pacingData } = useFirmData();
  const nameOf = Object.fromEntries(funds.map((f) => [f.id, f.name]));
  const monthly = pacingData?.monthly;
  const asOfYm = (pacingData?.pulledAt || "").slice(0, 7);
  const newCount = (fid) => (monthly[fid] || []).reduce((s, [, c]) => s + c, 0);
  const FUNDS = monthly ? Object.keys(monthly).filter((fid) => monthly[fid]?.length).sort((a, b) => newCount(b) - newCount(a)) : [];
  const FUND_TINT = Object.fromEntries(FUNDS.map((fid, i) => [fid, PALETTE[i % PALETTE.length]]));
  const quarters = useMemo(() => (monthly ? quarterlySeries(monthly, asOfYm) : []), [monthly, asOfYm]);
  const trail = useMemo(() => trailingAvg(quarters), [quarters]);
  if (!monthly || !FUNDS.length || !quarters.length) return null;
  return (
    <div className="card" style={{ padding: "18px 22px 14px", marginTop: 18 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 14, flexWrap: "wrap", marginBottom: 6 }}>
        <H3>Investment pacing</H3>
        <span style={{ ...sans, fontSize: FS.small, color: "var(--ink-color-global-text-subtle)" }}>new companies per quarter</span>
        <span style={{ flex: 1 }} />
        {FUNDS.map((fid) => (
          <span key={fid} style={{ ...sans, fontSize: FS.small, color: "var(--ink-color-global-text-subtle)", display: "inline-flex", alignItems: "center", gap: 5 }}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: FUND_TINT[fid], display: "inline-block" }} />
            {shortFund(nameOf[fid] || fid)}
          </span>
        ))}
        <span style={{ ...sans, fontSize: FS.small, color: "var(--ink-color-global-text-subtle)", display: "inline-flex", alignItems: "center", gap: 5 }}>
          <span style={{ width: 18, borderTop: `2px solid var(--ink-color-global-text-default)`, display: "inline-block", opacity: 0.75 }} />
          trailing-year pace
        </span>
      </div>
      <CadenceChart quarters={quarters} trail={trail} FUNDS={FUNDS} FUND_TINT={FUND_TINT} />
    </div>
  );
}

/** Concentration — read-only power-law of who carries the firm's value at this
 *  scenario's marks. Firm-wide; no what-if interaction. */
// Firm-wide aggregations can't be summed across currencies — a mixed-currency
// firm gets this notice instead of a meaningless combined total.
const MixedCurrencyNote = ({ title }) => (
  <div className="card" style={{ padding: "18px 22px", marginTop: 18 }}>
    <H3 as="div" style={{ marginBottom: 6 }}>{title}</H3>
    <div style={{ ...sans, fontSize: FS.body, color: "var(--ink-color-global-text-subtle)" }}>
      Not shown — this firm's funds report in multiple currencies, which can't be summed into a firm-wide total.
    </div>
  </div>
);

function ConcentrationCard({ snapshot, portfolio, mixed }) {
  const c = concentrationAcrossAll(snapshot, portfolio);
  if (!c) return null;
  if (mixed) return <MixedCurrencyNote title="Concentration" />;
  const irrById = Object.fromEntries((portfolio.companies || []).map((cp) => [cp.id, cp.dealIrr]));
  const top = c.holdings.slice(0, 10);
  const maxFv = top[0].fv;
  const shortName = (n) => n.replace(/\s*\(.*\)/, "").replace(/,? (Inc|Corp|Co|LLC|Ltd)\.?,?( dba .*)?$/i, "");
  return (
    <div className="card" style={{ padding: "18px 22px 16px", marginTop: 18 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
        <H3>Concentration</H3>
        <span style={{ ...sans, fontSize: FS.small, color: "var(--ink-color-global-text-subtle)" }}>top {top.length} holdings · {(c.top5 * 100).toFixed(0)}% of firm value in the top 5</span>
        <span style={{ flex: 1 }} />
        <span style={{ ...sans, fontSize: FS.small, color: "var(--ink-color-global-text-subtle)" }}>{c.count} companies held</span>
      </div>
      <div>
        {/* column headers — the row shows two percentages (Deal IRR and share of
            firm value) plus a fair-value figure, indistinguishable without labels */}
        {(() => {
          const ch = { ...sans, fontSize: FS.micro, fontWeight: 600, color: MICRO, whiteSpace: "nowrap" };
          return (
            <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "0 0 8px", borderBottom: `1px solid var(--ink-color-global-border-subtle)` }}>
              <span aria-hidden style={{ width: 26, flex: "none" }} />
              <span style={{ ...ch, width: 200, flex: "none" }}>Company</span>
              <span aria-hidden style={{ flex: 1 }} />
              <span style={{ ...ch, width: 52, textAlign: "right", flex: "none" }} title="Deal IRR">IRR</span>
              <span style={{ ...ch, width: 54, textAlign: "right", flex: "none" }} title="Share of firm value">Share</span>
              <span style={{ ...ch, width: 58, textAlign: "right", flex: "none" }} title="Fair value">FV</span>
            </div>
          );
        })()}
        {top.map((h, i) => {
          const last = i === top.length - 1;
          return (
            <div key={h.id} data-datum-id={h.id} data-datum-type="company" data-datum-label={h.name}
              style={{ display: "flex", alignItems: "center", gap: 14, padding: "11px 0",
              borderBottom: last ? "none" : `1px solid var(--ink-color-global-border-subtle)` }}>
              <span style={{ ...inkNum, fontSize: FS.small, fontWeight: 600, color: "var(--ink-color-global-text-subtle)", flex: "none",
                width: 26, height: 26, borderRadius: "50%", border: `1px solid var(--ink-color-global-border-subtle)`, background: "var(--ink-color-global-surface-background-default)",
                display: "flex", alignItems: "center", justifyContent: "center" }}>{i + 1}</span>
              <span style={{ ...sans, fontSize: FS.bodyLg, fontWeight: i < 5 ? 600 : 500, color: h.defunct ? "var(--ink-color-global-text-subtle)" : "var(--ink-color-global-text-default)",
                width: 200, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", flex: "none" }}>
                {shortName(h.name)}
                {h.exited && <Badge variant="text" tone="info" style={{ marginLeft: 5 }}>EXITED</Badge>}
              </span>
              <div style={{ flex: 1, height: 10, background: "var(--ink-color-global-surface-lightgray-default)", borderRadius: 2, overflow: "hidden" }}>
                <div style={{ width: `${Math.max(2, (h.fv / maxFv) * 100)}%`, height: "100%", borderRadius: 2,
                  background: i < 5 ? "var(--ink-button-background-color-primary-base-default)" : "var(--ink-color-global-surface-lightgray-active)" }} />
              </div>
              <span style={{ ...inkNum, fontSize: FS.small, color: irrById[h.id] == null ? "var(--ink-color-global-text-subtle)" : irrById[h.id] >= 0 ? "var(--ink-color-global-feedback-positive-strong)" : "var(--ink-color-global-feedback-negative-strong)", width: 52, textAlign: "right", flex: "none" }}
                title="Deal IRR">
                {irrById[h.id] == null ? "—" : fmtPct(irrById[h.id])}
              </span>
              <span style={{ ...inkNum, fontSize: FS.body, fontWeight: 700, color: "var(--ink-color-global-text-default)", width: 54, textAlign: "right", flex: "none" }}>
                {((h.fv / c.total) * 100).toFixed(1)}%
              </span>
              <span style={{ ...inkNum, fontSize: FS.small, color: "var(--ink-color-global-text-subtle)", width: 58, textAlign: "right", flex: "none" }}>{fmtM(h.fv)}</span>
            </div>
          );
        })}
      </div>
      <SourceNote>
        Source: Carta Fund Admin holdings — shares of firm-wide value at this scenario's marks.
      </SourceNote>
    </div>
  );
}

// pretty round name (mirrors the Companies helper): "a" → "Series A", "seed" → "Seed"
const roundLabel = (r) => {
  const s = String(r || "").trim();
  if (!s) return "";
  if (/^pre[-\s]?seed$/i.test(s)) return "Pre-seed";
  if (/^seed$/i.test(s)) return "Seed";
  if (/^[a-z]\d?$/i.test(s)) return "Series " + s.toUpperCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
};

/** Recent activity — the firm's latest investments as cards: which fund, how
 *  much, when, and the company's latest priced round for context. Firm-wide, so
 *  a mixed-currency firm gets the notice instead (amounts can't share a symbol). */
// Recent-activity lanes: filter label + per-card tag + accent color. Order is the
// filter-tab order; the model tags each event with one of these `type`s.
const ACTIVITY_META = {
  investment: { label: "New", feedLabel: "New investment", bubble: "positive" },
  followOn: { label: "Follow-on", feedLabel: "Follow-on investment", bubble: "notice" },
  valuation: { label: "Valuations", feedLabel: "Valuation update", bubble: "info" },
  exit: { label: "Exits", feedLabel: "Exit", bubble: "neutral" },
};
const ACTIVITY_ORDER = ["investment", "followOn", "valuation", "exit"];
const ACTIVITY_LIMIT = 12; // rows shown per active filter

// The headline amount per lane: exits show proceeds, valuations the current mark,
// investments/follow-ons the check size.
const activityAmount = (r) => (r.type === "exit" ? r.proceeds : r.type === "valuation" ? r.mark : r.cost);

// Feed-row avatar fallback: first letter of up to the first two MEANINGFUL
// words ("Acme Health, Inc." → "AH", legal suffix excluded). A single
// remaining word (e.g. "BrightLeaf, Inc." → "BrightLeaf") falls back to its
// camelCase humps ("BrightLeaf" → "BL", "MyPlatform" → "MP") so one-word,
// compound-brand names still read as two distinct initials.
const LEGAL_SUFFIXES = new Set(["inc", "incorporated", "corp", "corporation", "co", "llc", "llp", "lp", "ltd", "limited", "pbc", "plc", "pc"]);
const initialsOf = (name) => {
  const base = name.replace(/\(.*\)/, ""); // drop a trailing "(dba X)" / "(acquired Y)" parenthetical
  const words = (base.match(/[A-Za-z0-9]+/g) || []).filter((w) => !LEGAL_SUFFIXES.has(w.toLowerCase()));
  if (words.length === 0) return "";
  if (words.length === 1) {
    const humps = words[0].match(/[A-Z][a-z0-9]*/g) || [];
    return (humps.length >= 2 ? humps.slice(0, 2).map((w) => w[0]).join("") : words[0].slice(0, 2)).toUpperCase();
  }
  return words.slice(0, 2).map((w) => w[0]).join("").toUpperCase();
};

// Deterministic pick of an initials-avatar color per company, so a feed of many
// different companies doesn't render as a wall of identical gray circles — the
// same company always lands on the same color. Drawn from PALETTE (above) —
// the same categorical data-viz hues the fund charts use — skipping index 0
// (brand-black, the charts' "lead fund" special case) and the trailing
// brand-gray-30 fallback slot, neither of which is a real data-viz color.
const INITIALS_COLORS = PALETTE.slice(1, 9);
const colorFor = (name) => {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  return INITIALS_COLORS[Math.abs(h) % INITIALS_COLORS.length];
};

// Feed-row avatar: Ink's real Avatar (see ui/components.jsx) at its standard
// 38px size, always the round circle — a real logo renders via `imageUrl`,
// never Ink's separate non-circular `variant="company"` box. Avatar itself
// degrades to `initials` if the logo is missing or fails to load (a corrupt/
// truncated file fetch_logos.py's own validation makes rare, not impossible),
// so a non-empty `initials` is always passed here even when a logo is present.
function FeedAvatar({ logo, name }) {
  return (
    <Avatar imageUrl={logo || undefined}
      initials={initialsOf(name) || name.slice(0, 2).toUpperCase() || "?"} initialsColor={colorFor(name)}
      // nudge down to the company-name text's visual top (its 28px line-height
      // has ~6px of leading above the actual glyph-cap top) rather than the
      // row's box top, which sits a few px above where the name text starts
      style={{ marginTop: 6 }} />
  );
}

// The per-lane context line under the fund/security chips. Valuation rows
// match the design spec's "Multiplier" row exactly: "{moic}× MOIC" in the inherited
// subtle/regular tone, gap-12, then an arrow + colored medium-weight delta
// group (gap-4 between the arrow and its text, matching the DeltaTd caret
// spacing used in the fund table above) — no "Mark"/"·" framing.
function ActivityContext({ r }) {
  let content;
  if (r.type === "valuation") {
    const up = (r.gain || 0) >= 0;
    const deltaColor = up ? "var(--ink-color-global-feedback-positive-strong)" : "var(--ink-color-global-feedback-negative-strong)";
    content = (
      <span style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <span>{fmtX(r.moic)} MOIC</span>
        <span style={{ display: "inline-flex", alignItems: "baseline", gap: 4, color: deltaColor, fontWeight: 500 }}>
          <span aria-hidden style={{ fontSize: FS.micro, lineHeight: 1 }}>{up ? "▲" : "▼"}</span>
          <span>{fmtM(Math.abs(r.gain || 0))} vs cost</span>
        </span>
      </span>
    );
  } else if (r.type === "exit") {
    content = <>Realized <strong style={{ color: "var(--ink-color-global-text-default)", fontWeight: 600 }}>{fmtX(r.moic)}</strong> on {fmtM(r.cost)} cost</>;
  } else if (r.round) {
    content = <>Latest round: <strong style={{ color: "var(--ink-color-global-text-default)", fontWeight: 600 }}>{roundLabel(r.round)}</strong>{r.postMoney ? ` · ${fmtM(r.postMoney)} post-money valuation` : ""}</>;
  }
  if (!content) return null;
  return <div style={{ ...sans, fontSize: FS.body, lineHeight: "20px", color: "var(--ink-color-global-text-subtle)" }}>{content}</div>;
}

function RecentActivityCard({ rows, mixed }) {
  const [filter, setFilter] = useState("all");
  if (!rows.length) return null;
  // amounts can't share a symbol across currencies — keep the firm-wide guard
  if (mixed) return <MixedCurrencyNote title="Recent portfolio activity" />;

  // only offer tabs for lanes that actually have events; "All" is always present
  const present = ACTIVITY_ORDER.filter((t) => rows.some((r) => r.type === t));
  const options = [{ id: "all", label: "All" }, ...present.map((t) => ({ id: t, label: ACTIVITY_META[t].label }))];
  const active = options.some((o) => o.id === filter) ? filter : "all";
  const shown = (active === "all" ? rows : rows.filter((r) => r.type === active)).slice(0, ACTIVITY_LIMIT);

  return (
    <div style={{ marginTop: 18 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
        <H3>Recent portfolio activity</H3>
        <span style={{ marginLeft: "auto" }}><Segmented small options={options} value={active} onChange={setFilter} /></span>
      </div>
      <div style={{ display: "flex", flexDirection: "column" }}>
        {shown.map((r, ri) => {
          const meta = ACTIVITY_META[r.type];
          const last = ri === shown.length - 1;
          return (
          <div key={r.key} style={{ display: "flex", gap: 12, alignItems: "flex-start",
            padding: "16px 0", borderBottom: last ? "none" : "1px solid var(--ink-color-global-border-subtle)" }}>
            <FeedAvatar logo={r.logo} name={r.name} />
            <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ display: "flex", flexDirection: "column" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <span style={{ ...sans, fontSize: FS.h3, lineHeight: "28px", fontWeight: 500, color: "var(--ink-color-global-text-default)" }}>{r.name}</span>
                  <Bubble variant={meta.bubble}>{meta.feedLabel}</Bubble>
                  <span style={{ marginLeft: "auto" }} />
                  <span style={{ ...sans, fontSize: FS.value, lineHeight: "24px", color: "var(--ink-color-global-text-subtle)", whiteSpace: "nowrap" }}>{r.date ? fmtAsOf(r.date) : "—"}</span>
                </div>
                {r.fundNames.length > 0 && (
                  <span style={{ ...sans, fontSize: FS.value, lineHeight: "24px", color: "var(--ink-color-global-text-subtle)" }}>{r.fundNames.map(fundNameOnly).join(", ")}</span>
                )}
              </div>
              <div style={{ display: "flex", flexDirection: "column" }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
                  <span style={{ ...sans, fontSize: FS.value, lineHeight: "24px", fontWeight: 500, color: "var(--ink-color-global-text-default)" }}>{fmtM(activityAmount(r))}</span>
                  {r.securities && r.securities.length > 0 && (
                    <span style={{ ...sans, fontSize: FS.value, lineHeight: "24px", color: "var(--ink-color-global-text-subtle)" }}>{r.securities.join(", ")}</span>
                  )}
                </div>
                <ActivityContext r={r} />
              </div>
            </div>
          </div>
        );})}
      </div>
    </div>
  );
}

/** LP NAV over time, stacked by fund, with the firm TVPI as an overlaid line on
 *  a secondary axis. Columns come from snapshot.navSeries[].byFund (per-fund
 *  ending LP NAV per quarter); the LATEST column reacts to the active scenario —
 *  each fund's segment shifts by its own reprice, and the TVPI endpoint by the
 *  firm TVPI delta. History stays booked. */
const TW = 960, TH = 230, TPL = 48, TPR = 70, TPT = 18, TPB = 34;
const shortFund = (name) => { const m = (name || "").match(/\(([^)]+)\)\s*$/); return (m ? m[1] : name).replace(/,\s*\d{4}\s*$/, "").trim(); };
function TrendCard({ snapshot, fundStates, firmNow }) {
  const [hoverI, setHoverI] = useState(null);
  const rawSeries = snapshot.navSeries || [];
  if (rawSeries.length < 2) return null;

  // Stable fund order (snapshot.funds is sorted by committed desc → biggest at
  // the base of each stack) + the shared pacing palette by index. Colors are keyed
  // to the FULL list so a fund keeps its color as others are toggled on/off.
  const fundList = snapshot.funds || [];
  const colorOf = {}, nameOf = {};
  fundList.forEach((f, i) => { colorOf[f.id] = PALETTE[i % PALETTE.length]; nameOf[f.id] = f.name; });
  // Entity multi-select — default all shown. Which fund segments the chart stacks.
  const [shownIds, setShownIds] = useState(() => new Set(fundList.map((f) => f.id)));
  const shown = fundList.filter((f) => shownIds.has(f.id));
  const allShown = shown.length === fundList.length;
  const fsById = Object.fromEntries((fundStates || []).map((f) => [f.id, f]));
  // "today" deltas vs Carta, for the endpoint ▲/▼ — from the firm rollup so they
  // agree with the header + table (null when mixed-currency / no override).
  const navDelta = firmNow ? firmNow.nav - firmNow.navBase : 0;
  const tvpiDelta = firmNow ? firmNow.tvpi - firmNow.tvpiBase : 0;
  const repriced = Math.abs(navDelta) > 0.5 || Math.abs(tvpiDelta) > 0.005;

  const lastIdx = rawSeries.length - 1;
  // One column per quarter. Negative fund NAVs can't stack → segments clamp at 0
  // (rare, tiny). The LAST column is authoritative from the live scenario: its
  // segments are per-fund scenario LP NAV and its firm NAV / TVPI come straight
  // from the firm rollup, so the endpoint ties out to the header + fund table.
  // The NAV shown (bar height + endpoint label) is the sum of the SELECTED funds'
  // segments. When every fund is shown we keep the authoritative firm rollup
  // (firmNow.nav / p.nav) so the endpoint still ties out to the header + fund
  // table; a filtered view scales the label to the selected total instead. The
  // TVPI overlay stays firm-wide (a firm metric — not re-derivable per subset).
  const cols = rawSeries.map((p, idx) => {
    const isLast = idx === lastIdx;
    const per = (f) => (isLast && firmNow && fsById[f.id]) ? fsById[f.id].lpNav : (p.byFund?.[f.id] || 0);
    const segs = shown.map((f) => ({ id: f.id, v: Math.max(0, per(f)) })).filter((s) => s.v > 0);
    const total = segs.reduce((s, x) => s + x.v, 0);
    const firmFull = isLast && firmNow ? firmNow.nav : p.nav;
    return { date: p.date, segs, total, firmNav: allShown ? firmFull : total, tvpi: isLast && firmNow ? firmNow.tvpi : p.tvpi };
  });

  const maxNav = Math.max(1, ...cols.map((c) => Math.max(c.total, c.firmNav)));
  const maxTvpi = Math.max(1, ...cols.map((c) => c.tvpi || 0));
  const n = cols.length;
  const slot = (TW - TPL - TPR) / n;
  const bw = Math.min(20, slot * 0.64);
  const cx = (i) => TPL + i * slot + slot / 2;
  const yNav = (v) => TPT + (1 - v / maxNav) * (TH - TPT - TPB);
  const yTvpi = (v) => TPT + (1 - v / maxTvpi) * (TH - TPT - TPB);
  const y0 = yNav(0);
  const tvpiLine = cols.map((c, i) => c.tvpi == null ? "" : `${i && cols[i - 1].tvpi != null ? "L" : "M"} ${cx(i)} ${yTvpi(c.tvpi)}`).join(" ");
  const rawYearTicks = cols.map((c, i) => ({ i, yr: c.date.slice(0, 4) })).filter((t, idx, arr) => idx === 0 || t.yr !== arr[idx - 1].yr);
  // Drop a partial leading year's label when it would collide with the next year's.
  const yearTicks = rawYearTicks.length > 1 && cx(rawYearTicks[1].i) - cx(rawYearTicks[0].i) < 26 ? rawYearTicks.slice(1) : rawYearTicks;
  const lastC = cols[n - 1];

  // right-margin endpoint labels — stack them apart if they'd collide
  const LBL_FS = 12, LBL_GAP = 16;
  const bandTop = TPT + LBL_FS, bandBot = TH - TPB;
  const clampY = (y) => Math.max(bandTop, Math.min(bandBot, y));
  let navLblY = clampY(yNav(lastC.total));
  let tvpiLblY = lastC.tvpi != null ? clampY(yTvpi(lastC.tvpi)) : null;
  if (tvpiLblY != null && Math.abs(navLblY - tvpiLblY) < LBL_GAP) {
    const top = Math.max(bandTop, Math.min(Math.min(navLblY, tvpiLblY), bandBot - LBL_GAP));
    navLblY = top; tvpiLblY = top + LBL_GAP;
  }

  const hc = hoverI != null ? cols[hoverI] : null;
  const tipLeft = hc ? Math.max(7, Math.min(93, (cx(hoverI) / TW) * 100)) : 0;
  const lab = { ...sans, fontSize: FS.micro, fill: MICRO };
  return (
    <div className="card" style={{ padding: "18px 22px 12px", height: "100%", display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 8 }}>
        <H3>LP NAV by fund &amp; TVPI</H3>
        <span style={{ flex: 1 }} />
        <MultiFundPicker funds={fundList} selected={shownIds} onChange={setShownIds} colorOf={colorOf} />
      </div>
      <div style={{ position: "relative" }}>
        <svg viewBox={`0 0 ${TW} ${TH}`} style={{ width: "100%", display: "block", overflow: "visible" }} role="img" aria-label="LP NAV by fund and TVPI over time">
          <line x1={TPL} x2={TW - TPR} y1={y0} y2={y0} style={{ stroke: "var(--ink-color-global-border-subtle)" }} strokeWidth="1" />
          {yearTicks.map((t) => (
            <text key={t.yr + t.i} x={cx(t.i)} y={TH - TPB + 22} textAnchor="middle" style={lab}>{t.yr}</text>
          ))}
          {/* stacked columns */}
          {cols.map((c, i) => {
            let acc = 0;
            const dim = hoverI != null && hoverI !== i;
            return (
              <g key={c.date} style={{ cursor: "pointer" }} onMouseEnter={() => setHoverI(i)} onMouseLeave={() => setHoverI(null)}>
                <rect x={cx(i) - slot / 2} y={TPT} width={slot} height={TH - TPT - TPB} fill="transparent" />
                {c.segs.map((s) => {
                  const yTop = yNav(acc + s.v), h = Math.max(0.6, yNav(acc) - yNav(acc + s.v));
                  acc += s.v;
                  return (
                    <rect key={s.id} x={cx(i) - bw / 2} y={yTop} width={bw} height={h} fill={colorOf[s.id]}
                      opacity={dim ? 0.38 : (i === n - 1 ? 1 : 0.9)}>
                      <title>{`${shortFund(nameOf[s.id])} · ${fmtM(s.v)} (${c.date})`}</title>
                    </rect>
                  );
                })}
              </g>
            );
          })}
          {/* TVPI overlay (secondary axis) */}
          <path d={tvpiLine} fill="none" style={{ stroke: "var(--ink-color-global-text-default)" }} strokeWidth="2" strokeDasharray="5 3" strokeLinejoin="round" opacity="0.9" />
          {lastC.tvpi != null && <circle cx={cx(n - 1)} cy={yTvpi(lastC.tvpi)} r="3.5" style={{ fill: "var(--ink-color-global-text-default)" }} />}
          {/* endpoint labels */}
          <text x={TW - TPR + 8} y={navLblY + 4} style={{ ...inkNum, fontSize: LBL_FS, fontWeight: 700, fill: "var(--ink-color-global-text-default)" }}>
            {fmtM(lastC.firmNav)}{allShown && repriced && Math.abs(navDelta) > 0.5 && <tspan style={{ fill: navDelta >= 0 ? "var(--ink-color-global-feedback-positive-strong)" : "var(--ink-color-global-feedback-negative-strong)" }}> {navDelta >= 0 ? "▲" : "▼"}</tspan>}
          </text>
          {lastC.tvpi != null && <text x={TW - TPR + 8} y={tvpiLblY + 4} style={{ ...inkNum, fontSize: LBL_FS, fontWeight: 700, fill: "var(--ink-color-global-text-default)" }}>
            {fmtX(lastC.tvpi)}{repriced && Math.abs(tvpiDelta) > 0.005 && <tspan style={{ fill: tvpiDelta >= 0 ? "var(--ink-color-global-feedback-positive-strong)" : "var(--ink-color-global-feedback-negative-strong)" }}> {tvpiDelta >= 0 ? "▲" : "▼"}</tspan>}
          </text>}
        </svg>
        {hc && (
          <div style={{ position: "absolute", top: 0, left: `${tipLeft}%`, transform: "translateX(-50%)", pointerEvents: "none",
            background: "var(--ink-color-global-surface-background-default)", border: `1px solid var(--ink-color-global-border-subtle)`, borderRadius: 8, padding: "8px 12px", boxShadow: "0 6px 18px rgba(16,24,40,.14)", whiteSpace: "nowrap" }}>
            <div style={{ ...sans, fontSize: FS.small, color: "var(--ink-color-global-text-subtle)", marginBottom: 3 }}>{hc.date}</div>
            <div style={{ ...inkNum, fontSize: FS.bodyLg, fontWeight: 700, color: "var(--ink-color-global-text-default)" }}>{fmtM(hc.firmNav)} <span style={{ ...sans, fontSize: FS.micro, color: "var(--ink-color-global-text-subtle)", fontWeight: 500 }}>LP NAV</span></div>
            <div style={{ ...inkNum, fontSize: FS.bodyLg, fontWeight: 700, color: "var(--ink-color-global-text-default)" }}>{hc.tvpi == null ? "—" : fmtX(hc.tvpi)} <span style={{ ...sans, fontSize: FS.micro, color: "var(--ink-color-global-text-subtle)", fontWeight: 500 }}>TVPI</span></div>
            {hc.segs.length > 0 && (
              <div style={{ marginTop: 6, paddingTop: 6, borderTop: `1px solid var(--ink-color-global-border-subtle)`, display: "flex", flexDirection: "column", gap: 3 }}>
                {[...hc.segs].sort((a, b) => b.v - a.v).map((s) => (
                  <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "space-between" }}>
                    <span style={{ ...sans, fontSize: FS.micro, color: "var(--ink-color-global-text-subtle)", display: "inline-flex", alignItems: "center", gap: 5 }}>
                      <span style={{ width: 8, height: 8, borderRadius: 2, background: colorOf[s.id], display: "inline-block", flex: "none" }} />
                      {shortFund(nameOf[s.id])}
                    </span>
                    <span style={{ ...inkNum, fontSize: FS.micro, fontWeight: 600, color: "var(--ink-color-global-text-default)" }}>{fmtM(s.v)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
      {/* legend below the chart — fund colors + the TVPI overlay */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 14, flexWrap: "wrap", margin: "10px 0 2px" }}>
        {shown.map((f) => (
          <span key={f.id} style={{ ...sans, fontSize: FS.micro, color: "var(--ink-color-global-text-subtle)", display: "inline-flex", alignItems: "center", gap: 5 }}>
            <span style={{ width: 9, height: 9, borderRadius: 2, background: colorOf[f.id], display: "inline-block", flex: "none" }} />
            {shortFund(f.name)}
          </span>
        ))}
        <span style={{ ...sans, fontSize: FS.micro, color: "var(--ink-color-global-text-subtle)", display: "inline-flex", alignItems: "center", gap: 5 }}>
          <span style={{ width: 16, height: 2, background: "var(--ink-color-global-text-default)", borderRadius: 1, display: "inline-block" }} /> TVPI
        </span>
      </div>
      <SourceNote>
        Source: Carta Fund Admin (MONTHLY_NAV_CALCULATIONS), per-fund LP NAV at quarter-ends. TVPI = (LP NAV + distributions) ÷ contributions, firm-wide. The latest column reflects this scenario's marks (▲/▼ vs Baseline); earlier columns are booked history. Use the fund selector to choose which entities stack — NAV totals follow the selection; the TVPI line stays firm-wide.
      </SourceNote>
    </div>
  );
}

const RT = { ...inkNum, textAlign: "right", fontSize: FS.value };

// Fund-table columns — label + a value accessor for sorting. Text columns sort
// ascending-first, numeric columns descending-first (useTableSort's naturalDir);
// a third click clears back to reported order. Accessors return null (not a
// sentinel) for missing metrics so useTableSort sinks them to the bottom in
// either direction, consistent with every other column.
// Fund-table columns. Built via a factory so the "Avg Own %" column can sort on
// the per-fund capital-weighted ownership (which lives outside the fundState, in
// the ownership extras) — `avgOwnOf(f)` returns that scenario value for sorting.
const makeFundCols = (avgOwnOf) => [
  { label: "Fund", align: "left", get: (f) => fundNameOnly(f.name) },
  { label: "Vintage", get: (f) => f.vintage ?? 0 },
  { label: "Committed", get: (f) => f.committed },
  { label: "LP Paid-In", get: (f) => f.lpPaidIn },
  { label: "LP Distributions", get: (f) => f.lpDistributed },
  { label: "LP NAV", get: (f) => f.lpNav },
  { label: "DPI", get: (f) => f.dpi },
  { label: "RVPI", get: (f) => f.rvpi },
  { label: "TVPI", get: (f) => f.tvpi },
  { label: "Gross MOIC", get: (f) => f.grossMoic ?? null },
  { label: "Avg Own %", get: (f) => avgOwnOf(f) },
  { label: "Net LP IRR", get: (f) => f.netLpIrr ?? null },
  { label: "GP Carry", get: (f) => (f.accruedCarry || 0) + (f.carryBanked || 0) },
  { label: "GP NAV", get: (f) => f.gpCapitalNavLive },
];

// GP carry a fund holds at this scenario's marks: booked accrued carry that
// survives the LP make-whole + carry crystallized from any exit toggles.
const gpCarryOf = (f) => (f.accruedCarry || 0) + (f.carryBanked || 0);

// A numeric cell that surfaces its scenario move vs the Carta baseline ON HOVER:
// the value tints green/red with a ▲/▼ caret when it changed, and the tooltip
// spells out baseline → scenario (Δ). Consistent treatment across every
// reprice-reactive column so they all react the same way (Net LP IRR is the one
// column the model never restates from marks, so it isn't a DeltaTd).
function DeltaTd({ cur, base, fmt, eps = 0, bold }) {
  if (cur == null) return <td style={{ ...RT, fontWeight: bold ? 700 : 400, color: "var(--ink-color-global-text-subtle)" }}>—</td>;
  const delta = cur - (base ?? cur);
  const changed = base != null && Math.abs(delta) > eps;
  const up = delta >= 0;
  const tip = changed ? `${fmt(base)} → ${fmt(cur)}  (Δ ${up ? "+" : "−"}${fmt(Math.abs(delta))})` : undefined;
  return (
    <td style={{ ...RT, fontWeight: bold ? 700 : 400 }} title={tip}>
      <span style={{ display: "inline-flex", alignItems: "baseline", justifyContent: "flex-end", gap: 4,
        color: changed ? (up ? "var(--ink-color-global-feedback-positive-strong)" : "var(--ink-color-global-feedback-negative-strong)") : "var(--ink-color-global-text-default)" }}>
        {changed && <span aria-hidden style={{ fontSize: FS.micro, lineHeight: 1 }}>{up ? "▲" : "▼"}</span>}
        <Num value={cur} fmt={fmt} />
      </span>
    </td>
  );
}
export default function Overview({ fundStates, snapshot, portfolio, onOpenFund }) {
  const firm = firmRollup(fundStates);
  const firmRvpi = firm.lpPaidIn > 0 ? firm.lpNav / firm.lpPaidIn : 0;
  const firmGpCarry = firm.accruedCarry + firm.carryBanked + firm.gpCapitalNavLive;
  // Authoritative "today" figures for the trend's last column, so its endpoint
  // ties out EXACTLY to the header metric bar + the fund table (rather than the
  // navSeries quarter-end, which lags the nav-as-of month). Never cross
  // currencies — a mixed-currency firm gets no override (null).
  const firmBaseLpNav = fundStates.reduce((s, f) => s + (f.baseLpNav || 0), 0);
  const firmBaseTvpi = firm.lpPaidIn > 0
    ? fundStates.reduce((s, f) => s + (f.baseLpNav || 0) + (f.baseLpDistributed || 0), 0) / firm.lpPaidIn
    : 0;
  const firmNow = firm.mixedCurrency ? null
    : { nav: firm.lpNav, navBase: firmBaseLpNav, tvpi: firm.tvpi, tvpiBase: firmBaseTvpi };

  // which sections exist → drives the chip nav
  const { pacing, ownership } = useFirmData();

  // Capital-weighted average fully-diluted ownership per fund. `avgNow` applies
  // each company's expected future dilution (so a Reserve-strategy sweep moves it
  // — the fund-level "are we staying ahead of dilution?" signal); `avgBase` is the
  // undiluted figure the DeltaTd compares against.
  const avgNow = useMemo(() => Object.fromEntries(
    fundStates.map((f) => [f.id, fundAvgOwnership(portfolio.companies, ownership, f.id, { dilution: true })])
  ), [fundStates, portfolio.companies, ownership]);
  const avgBase = useMemo(() => Object.fromEntries(
    fundStates.map((f) => [f.id, fundAvgOwnership(portfolio.companies, ownership, f.id, { dilution: false })])
  ), [fundStates, portfolio.companies, ownership]);
  const fundCols = useMemo(() => makeFundCols((f) => avgNow[f.id] ?? null), [avgNow]);

  // fund-table sort — defaults to Fund name A-Z; a third click on any header clears
  // to the reported (unsorted) row order, same as every other useTableSort caller
  const { sorted: sortedFunds, sort: fundSort, onSort: onFundSort } = useTableSort(fundStates, fundCols, { i: 0, dir: "asc" });
  const hasPacing = !!(pacing?.monthly && Object.values(pacing.monthly).some((a) => a && a.length));
  const hasConc = !!concentrationAcrossAll(snapshot, portfolio);
  const activityRows = useMemo(
    () => recentActivity(portfolio.companies, snapshot.funds, snapshot.source?.navAsOf),
    [portfolio, snapshot]
  );
  const sections = [
    ["ov-summary", "Summary"],
    activityRows.length && ["ov-activity", "Recent activity"],
    hasPacing && ["ov-pacing", "Pacing"],
    hasConc && ["ov-concentration", "Concentration"],
  ].filter(Boolean);

  return (
    <div>
      <H1>Firm Overview</H1>
      <SectionChips sections={sections} />

      <section id="ov-summary" style={{ scrollMarginTop: 64 }}>
      {/* firm NAV/TVPI trend — the firm scorecard now lives in the persistent top metric bar */}
      <div style={{ marginBottom: 16 }}>
        <TrendCard snapshot={snapshot} fundStates={fundStates} firmNow={firmNow} />
      </div>

      {/* ── fund-by-fund detail: its own surface ──
          scrolls in place via .table-scroll (theme.js) instead of pushing the
          whole page into horizontal scroll — see that rule's comment for why
          overflow-y:hidden keeps useStickyHeader's ancestor walk unaffected. */}
      <TableScroll>
        <table className="ledger sheet roomy">
          <TableHead cols={fundCols} sort={fundSort} onSort={onFundSort} sticky />
          <tbody>
              {sortedFunds.map((f) => {
                const fundName = fundNameOnly(f.name);
                return (
                <tr key={f.id} data-datum-id={f.id} data-datum-type="fund" data-datum-label={fundName}
                  onClick={() => { trackClick("FundModeling.Overview.OpenFund"); onOpenFund(f.id); }}
                  style={{ cursor: "pointer" }} title="Open scenarios">
                  <td style={{ minWidth: 220, maxWidth: 320 }}
                    title={fundName}>
                    <span style={{ ...sans, fontWeight: 400, fontSize: FS.value, color: "var(--ink-color-global-text-default)", lineHeight: 1.25, whiteSpace: "normal", wordBreak: "break-word" }}>{fundName}</span>
                  </td>
                  <td style={{ color: "var(--ink-color-global-text-default)", textAlign: "right" }}>{f.vintage ?? "—"}</td>
                  <td style={RT}>{fmt$(f.committed)}</td>
                  <td style={RT}>{fmt$(f.lpPaidIn)}</td>
                  <DeltaTd cur={f.lpDistributed} base={f.baseLpDistributed} fmt={fmt$} eps={0.5} />
                  <DeltaTd cur={f.lpNav} base={f.baseLpNav} fmt={fmt$} eps={0.5} />
                  <DeltaTd cur={f.dpi} base={f.lpPaidIn > 0 ? f.baseLpDistributed / f.lpPaidIn : 0} fmt={(n) => fmtX(n)} eps={0.005} />
                  <DeltaTd cur={f.rvpi} base={f.lpPaidIn > 0 ? f.baseLpNav / f.lpPaidIn : 0} fmt={(n) => fmtX(n)} eps={0.005} />
                  <DeltaTd cur={f.tvpi} base={f.baseTvpi} fmt={(n) => fmtX(n)} eps={0.005} />
                  <DeltaTd cur={f.grossMoic} base={f.baseGrossMoic} fmt={(n) => fmtX(n)} eps={0.005} />
                  {/* Avg Own % — capital-weighted fund ownership; the delta is the dilution
                      guard (scenario dilution vs the undiluted baseline) */}
                  <DeltaTd cur={avgNow[f.id]} base={avgBase[f.id]} fmt={fmtOwn} eps={0.0001} />
                  {/* Net LP IRR — Carta booked; reprices never restate it, so no scenario delta */}
                  <td style={RT}>{f.netLpIrr == null ? "—" : fmtPct(f.netLpIrr)}</td>
                  <DeltaTd cur={gpCarryOf(f)} base={f.baseAccruedCarry} fmt={fmt$} eps={0.5} />
                  <DeltaTd cur={f.gpCapitalNavLive} base={f.gpCapitalNav} fmt={fmt$} eps={0.5} />
                </tr>
              );})}
              <tr className="totrow">
                <td style={{ whiteSpace: "nowrap" }}>
                  <span style={{ ...sans, fontSize: FS.value, color: "var(--ink-color-global-text-default)" }}>Count: {sortedFunds.length}</span>
                </td>
                <td />
                {/* never sum across currencies — a mixed-currency firm has no combined total */}
                <td style={RT}>{firm.mixedCurrency ? "—" : fmt$(firm.committed)}</td>
                <td style={RT}>{firm.mixedCurrency ? "—" : fmt$(firm.lpPaidIn)}</td>
                <td style={RT}>{firm.mixedCurrency ? "—" : <Num value={firm.lpDistributed} fmt={fmt$} />}</td>
                <td style={RT}>{firm.mixedCurrency ? "—" : <Num value={firm.lpNav} fmt={fmt$} />}</td>
                <td style={RT}>{firm.mixedCurrency ? "—" : fmtX(firm.dpi)}</td>
                <td style={RT}>{firm.mixedCurrency ? "—" : fmtX(firmRvpi)}</td>
                <td style={RT}>{firm.mixedCurrency ? "—" : <Num value={firm.tvpi} fmt={(n) => fmtX(n)} />}</td>
                <td style={{ ...RT, color: "var(--ink-color-global-text-subtle)" }}>—</td>
                {/* Avg Own % — a per-fund ratio; no meaningful firm-wide roll-up (never
                    average ownership across funds/currencies), so the total stays blank */}
                <td style={{ ...RT, color: "var(--ink-color-global-text-subtle)" }}>—</td>
                <td style={{ ...RT, color: "var(--ink-color-global-text-subtle)" }}>—</td>
                <td style={RT}>{firm.mixedCurrency ? "—" : <Num value={firm.accruedCarry + firm.carryBanked} fmt={fmt$} />}</td>
                <td style={RT}>{firm.mixedCurrency ? "—" : <Num value={firm.gpCapitalNavLive} fmt={fmt$} />}</td>
              </tr>
            </tbody>
          </table>
      </TableScroll>

      <SourceNote>
        Source: Carta Fund Admin. Reprices flow to LP NAV / DPI / RVPI / TVPI but don't restate Carta's Net LP IRR.
      </SourceNote>
      </section>

      {activityRows.length > 0 && <section id="ov-activity" style={{ scrollMarginTop: 64 }}><RecentActivityCard rows={activityRows} mixed={firm.mixedCurrency} /></section>}
      {hasPacing && <section id="ov-pacing" style={{ scrollMarginTop: 64 }}><PacingCard funds={snapshot.funds} /></section>}
      {hasConc && <section id="ov-concentration" style={{ scrollMarginTop: 64 }}><ConcentrationCard snapshot={snapshot} portfolio={portfolio} mixed={firm.mixedCurrency} /></section>}
    </div>
  );
}
