// "What changed" quarterly scan — the opening section of the Overview page.
import { useMemo, useState } from "react";
import { FS, sans, mono, MICRO } from "../../ui/theme.js";
import { withCommas } from "../../ui/format.js";
import { Dropdown, Segmented, Badge, SectionHeader, Modal } from "../../ui/components.jsx";
import { fmtVal } from "../../ui/charts.jsx";
import { metricOptions, metricOf, metricKeyByLabel, numericMetrics } from "../../model/kpi.js";
import { settledQuarter, isStillFiling, quartersOf, coverageAt, whatChanged } from "../../model/review.js";
import { portfolioSignals } from "../../model/signals.js";
import { customPortfolioSignals } from "../../model/rules.js";
import { openCompany } from "../../state/focus.js";

const QT = { "03": "Q1", "06": "Q2", "09": "Q3", "12": "Q4" };
export const qLabel = (p) => `${QT[String(p).slice(5, 7)] || String(p).slice(5, 7)} '${String(p).slice(2, 4)}`;

const nameBtn = { ...sans, border: "none", background: "transparent", padding: 0, cursor: "pointer", fontWeight: 400, fontSize: 14, color: "var(--ink-color-global-link-default)", textAlign: "left" };
const GAP_FG = "var(--ink-color-global-feedback-negative-strong)";
const OK_FG = "var(--ink-color-global-feedback-positive-strong)";

const GLOSS_CHANGED = [
  { term: "Why not the newest quarter?", short: "it hasn't finished filing yet",
    body: "A quarter that just closed is always under-reported — companies simply haven't submitted yet. This view therefore defaults to the newest quarter whose coverage has settled. Pick the newest quarter yourself and you'll see a warning: on this data it would report several times more companies as having 'gone dark' than actually did, purely because of filing lag." },
  { term: "Ranked by size of change, not %", short: "a % swing on a tiny base is noise",
    body: "The biggest percentage mover in a portfolio is almost always a company going from near-zero to a small number — technically +15,000%, practically irrelevant. Ranking by the absolute change surfaces what actually moves the fund. Switch to % if you want the fast-growers regardless of size." },
  { term: "Went dark", short: "reported last quarter, silent this one",
    body: "The company had reported something in the prior quarter and nothing in this one. This is the list to chase. A company that has been silent for years shows up in Reporting health instead, not here." },
];

const CARD_BORDER = "1px solid var(--ink-color-global-border-subtle)";
// alignSelf start so a short card in the 2-up grid keeps its natural height
// instead of stretching to match the tallest row neighbour.
const CARD_STYLE = { border: CARD_BORDER, borderRadius: 4, background: "var(--ink-color-global-surface-background-default)", overflow: "hidden", alignSelf: "start" };
const CARD_HEADER_BASE = { ...sans, fontSize: 14, fontWeight: 600, color: "var(--ink-color-global-text-default)", padding: "14px 16px", borderBottom: CARD_BORDER };
const CARD_NOTE_STYLE = { ...sans, fontSize: 12, color: "var(--ink-color-global-text-subtle)", lineHeight: "18px", fontWeight: 400, marginTop: 2 };

const HelpIcon = ({ hint }) => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"
    style={{ flex: "0 0 auto", marginTop: 3, color: "var(--ink-color-global-text-very-subtle, var(--ink-color-global-text-subtle))", cursor: "help" }} data-tip={hint}>
    <circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3M12 17h.01"/>
  </svg>
);

function StatGrid({ stats, style }) {
  return (
    <div style={{ ...style, border: CARD_BORDER, borderRadius: 4, padding: "16px 24px",
      display: "grid", gridTemplateColumns: `repeat(${stats.length}, minmax(0, 1fr))`, alignItems: "start" }}>
      {stats.map((s, i) => (
        <div key={i} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <div style={{ ...sans, display: "flex", alignItems: "flex-start", gap: 6,
            color: "var(--ink-color-global-text-subtle)", fontSize: 13, minHeight: 40, lineHeight: "20px", paddingRight: 12 }}>
            <span>{s.label}</span>
            {s.hint && <HelpIcon hint={s.hint} />}
          </div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
            <div style={{ ...sans, fontSize: 26, fontWeight: 600, letterSpacing: "-0.02em",
              fontVariantNumeric: "tabular-nums", lineHeight: "38px", color: "var(--ink-color-global-text-default)" }}>
              {s.value ?? "—"}
            </div>
            {s.sub && <div style={{ ...sans, fontSize: 13, color: "var(--ink-color-global-text-subtle)", fontVariantNumeric: "tabular-nums" }}>{s.sub}</div>}
          </div>
        </div>
      ))}
    </div>
  );
}

function HoverRow({ style, children }) {
  const [hovered, setHovered] = useState(false);
  return (
    <div onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
      style={{ ...style, background: hovered ? "var(--ink-color-global-surface-lightgray-default)" : "transparent" }}>
      {children}
    </div>
  );
}

export default function WhatChanged({ data, dashboard }) {
  const metrics = numericMetrics(data.metrics);
  const sq = useMemo(() => settledQuarter(data), [data]);
  const [quarter, setQuarter] = useState(sq.quarter);
  const [metricKey, setMetricKey] = useState(() => metricKeyByLabel(data, /^revenue$/i) || (metrics[0] || {}).key);
  const [rankBy, setRankBy] = useState("abs");

  const qs = useMemo(() => quartersOf(data), [data]);
  const res = useMemo(() => whatChanged(data, { quarter, metricKey }), [data, quarter, metricKey]);
  const stillFiling = useMemo(() => quarter && isStillFiling(data, quarter), [data, quarter]);
  const windowed = !!data.source?.since;
  const unit = (metricOf(data, metricKey) || {}).unit || "Number";

  const breaches = useMemo(() => {
    const built = portfolioSignals(data);
    const custom = customPortfolioSignals(data, dashboard?.doc?.rules || []);
    return [...built, ...custom];
  }, [data, dashboard?.doc?.rules]);

  const movers = useMemo(() => {
    const m = [...res.movers];
    if (rankBy === "pct") return m.filter((x) => x.pct != null).sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct));
    return m.sort((a, b) => Math.abs(b.abs) - Math.abs(a.abs));
  }, [res.movers, rankBy]);
  const ups = movers.filter((m) => (rankBy === "pct" ? m.pct : m.abs) > 0);
  const downsReal = movers.filter((m) => (rankBy === "pct" ? m.pct : m.abs) < 0);

  const downs = downsReal;
  const wentDark = res.wentDark;
  const started = res.started;

  const qOpts = qs.slice().reverse().map((q) => ({ id: q, label: qLabel(q) + (isStillFiling(data, q) ? " · still filing" : "") }));
  const pct = (g) => (g == null ? "—" : (g >= 0 ? "+" : "−") + withCommas(Math.abs(g * 100).toFixed(0)) + "%");
  const [glossOpen, setGlossOpen] = useState(false);

  const stats = [
    { label: "Companies reporting", value: coverageAt(data, quarter), sub: `of ${(data.companies || []).length}`,
      hint: "How many companies reported anything at all in the selected quarter." },
    { label: "Moved up", value: movers.filter((m) => m.abs > 0).length,
      hint: "Companies whose value rose versus the prior quarter, on the selected metric." },
    { label: "Moved down", value: movers.filter((m) => m.abs < 0).length,
      hint: "Companies whose value fell versus the prior quarter, on the selected metric." },
    { label: "Went dark", value: wentDark.length,
      hint: "Reported in the prior quarter, silent in this one. The list to chase." },
    ...(windowed ? [] : [{ label: "Started reporting", value: started.length,
      hint: "Companies whose first-ever reported quarter is this one." }]),
  ];

  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, maxWidth: 900 }}>
        <h2 style={{ ...sans, margin: 0, fontSize: 20, lineHeight: "28px", fontWeight: 600, letterSpacing: "-0.01em", color: "var(--ink-color-global-text-default)" }}>Overview</h2>
        <p style={{ ...sans, fontSize: 13, color: "var(--ink-color-global-text-subtle)", lineHeight: "20px", margin: 0 }}>
          What moved, who stopped reporting, and who just started. Defaults to{" "}
          <strong style={{ color: "var(--ink-color-global-text-default)", fontWeight: 600 }}>{qLabel(sq.quarter)}</strong> — the most recent quarter whose reporting has settled — compared against
          the quarter before it.
        </p>
      </div>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
        <Dropdown options={qOpts} value={quarter} onChange={setQuarter} triggerLabel="Quarter" minWidth={168} />
        <Dropdown options={metricOptions(metrics)} value={metricKey} onChange={setMetricKey} triggerLabel="Metric" minWidth={190} />
        <Segmented options={[{ id: "abs", label: "By size" }, { id: "pct", label: "By %" }]} value={rankBy} onChange={setRankBy} />
        <button onClick={() => setGlossOpen(true)}
          style={{ ...sans, marginLeft: "auto", border: "none", background: "transparent", padding: 0, cursor: "pointer",
            fontSize: 13, color: "var(--ink-color-global-link-default)", textDecoration: "underline", textUnderlineOffset: "2px" }}>
          What these numbers mean
        </button>
      </div>

      <Modal open={glossOpen} onClose={() => setGlossOpen(false)} title="What these numbers mean" width={560}>
        <dl style={{ margin: 0, display: "grid", gap: 16 }}>
          {GLOSS_CHANGED.map((item) => (
            <div key={item.term}>
              <dt style={{ ...sans, fontWeight: 600, fontSize: FS.body, marginBottom: 4 }}>{item.term}</dt>
              {item.short && <dd style={{ ...sans, fontSize: FS.small, color: MICRO, margin: "0 0 6px" }}>{item.short}</dd>}
              <dd style={{ ...sans, fontSize: FS.small, color: "var(--ink-color-global-text-subtle)", margin: 0, lineHeight: 1.6 }}>{item.body}</dd>
            </div>
          ))}
        </dl>
      </Modal>

      {stillFiling && (
        <p style={{ ...sans, fontSize: FS.bodyLg, color: "var(--ink-color-global-text-default)", lineHeight: 1.6, margin: 0,
          maxWidth: 920, background: "var(--ink-color-global-feedback-notice-subtle, rgba(255,196,0,.12))",
          border: `1px solid var(--ink-color-global-feedback-notice-strong, #B58100)`, borderRadius: 6, padding: "9px 12px" }}>
          ⚠ <strong>{qLabel(quarter)} is still filing.</strong> Only {coverageAt(data, quarter)} companies have reported
          so far, against {coverageAt(data, qs[qs.indexOf(quarter) - 1])} the previous quarter. The "went dark" list
          below is <em>not</em> reliable for this quarter — most of those companies are simply late, not gone.
        </p>
      )}

      <StatGrid stats={stats} />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 20 }}>
        <MoverCard title="Biggest increases" rows={ups} unit={unit} rankBy={rankBy} pct={pct} tone={OK_FG} />
        <MoverCard title="Biggest decreases" rows={downs} unit={unit} rankBy={rankBy} pct={pct} tone={GAP_FG} />
        <ListCard title="Went dark" empty="Nobody stopped reporting this quarter."
          note="Reported in the prior quarter, nothing in this one."
          rows={wentDark.map((r) => ({ id: r.id, name: r.name, right: `last: ${r.last}` }))} />
        {windowed ? (
          <ListCard title="Started reporting" rows={[]}
            note={`Not shown — only history from ${data.source.since} was fetched.`}
            empty="A company that first reported before the cutoff would look new here, so this is withheld. Re-run the skill and choose to load everything to see it." />
        ) : (
          <ListCard title="Started reporting" empty="No first-time reporters this quarter."
            note="Their first-ever reported quarter."
            rows={started.map((r) => ({ id: r.id, name: r.name, right: `${r.metricCount} KPIs` }))} />
        )}
      </div>

      {breaches.length > 0 && (
        <div style={{ ...CARD_STYLE }}>
          <SectionHeader style={{ padding: "12px 14px 4px" }}>
            Signals firing ({breaches.length})
          </SectionHeader>
          <p style={{ ...sans, fontSize: FS.bodyLg, color: MICRO, margin: "0 14px 8px", maxWidth: 900 }}>
            Companies currently matching a built-in or custom Signals rule. Edit the rules on the Portfolio tab.
          </p>
          <table className="ledger sheet" style={{ width: "100%", borderCollapse: "collapse", ...sans }}>
            <tbody>
              {breaches.slice(0, 25).map((s) => (
                <tr key={s.id} style={{ borderTop: CARD_BORDER }}>
                  <td style={{ padding: "9px 14px", width: 220 }}>
                    <button onClick={() => openCompany(s.companyId)} style={nameBtn}>{s.company}</button>
                  </td>
                  <td style={{ padding: "9px 14px" }}><Badge tone={s.tone}>{s.tag}</Badge></td>
                  <td style={{ padding: "9px 14px", ...sans, fontSize: FS.small, color: MICRO }}>{s.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

const PAGE = 5;
const toggleBtn = (onClick, label) => (
  <button onClick={onClick}
    style={{ ...sans, display: "block", width: "100%", border: "none", borderTop: CARD_BORDER,
      background: "transparent", cursor: "pointer", padding: "12px 16px", textAlign: "left",
      fontSize: 13, color: "var(--ink-color-global-link-default)" }}>
    {label}
  </button>
);

function MoverCard({ title, rows, unit, rankBy, pct, tone }) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? rows : rows.slice(0, PAGE);
  const hidden = rows.length - PAGE;
  return (
    <div style={CARD_STYLE}>
      <div style={CARD_HEADER_BASE}>{title}</div>
      {rows.length === 0 ? (
        <div style={{ ...sans, fontSize: FS.small, color: MICRO, padding: "12px 16px" }}>Nothing to show for this metric and quarter.</div>
      ) : (
        <>
          {visible.map((r) => (
            <HoverRow key={r.id} style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto 68px",
              alignItems: "center", gap: 12, borderBottom: CARD_BORDER, padding: "12px 16px" }}>
              <div><button onClick={() => openCompany(r.id)} style={nameBtn}>{r.name}</button></div>
              <div data-tip={`${fmtVal(r.prev, unit, undefined, r.curCode)} → ${fmtVal(r.cur, unit, undefined, r.curCode)}`}
                style={{ textAlign: "right", ...mono, fontSize: 14, fontWeight: 600, color: tone, whiteSpace: "nowrap", paddingRight: 8 }}>
                {rankBy === "pct" ? pct(r.pct) : (r.abs >= 0 ? "+" : "−") + fmtVal(Math.abs(r.abs), unit, undefined, r.curCode)}
              </div>
              <div style={{ textAlign: "right", ...mono, fontSize: 12, color: "var(--ink-color-global-text-subtle)", whiteSpace: "nowrap" }}>
                {rankBy === "pct" ? (r.abs >= 0 ? "+" : "−") + fmtVal(Math.abs(r.abs), unit, undefined, r.curCode) : pct(r.pct)}
              </div>
            </HoverRow>
          ))}
          {!expanded && hidden > 0 && toggleBtn(() => setExpanded(true), `Show ${hidden} more`)}
          {expanded && toggleBtn(() => setExpanded(false), "Show less")}
        </>
      )}
    </div>
  );
}

function ListCard({ title, rows, empty, note }) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? rows : rows.slice(0, PAGE);
  const hidden = rows.length - PAGE;
  return (
    <div style={CARD_STYLE}>
      <div style={{ ...CARD_HEADER_BASE, padding: "14px 16px 12px", display: "flex", flexDirection: "column", gap: 2 }}>
        <div>{title}</div>
        {note && <div style={CARD_NOTE_STYLE}>{note}</div>}
      </div>
      {rows.length === 0 ? (
        <div style={{ ...sans, fontSize: FS.small, color: MICRO, padding: "12px 16px" }}>{empty}</div>
      ) : (
        <>
          {visible.map((r) => (
            <HoverRow key={r.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center",
              gap: 12, borderBottom: CARD_BORDER, padding: "12px 16px" }}>
              <button onClick={() => openCompany(r.id)} style={nameBtn}>{r.name}</button>
              <div style={{ ...mono, fontSize: 12, color: "var(--ink-color-global-text-subtle)", whiteSpace: "nowrap" }}>{r.right}</div>
            </HoverRow>
          ))}
          {!expanded && hidden > 0 && toggleBtn(() => setExpanded(true), `Show ${hidden} more`)}
          {expanded && toggleBtn(() => setExpanded(false), "Show less")}
        </>
      )}
    </div>
  );
}
