// Company page — the deep-dive for one company, in three tabs: Summary (risk, KPIs
// with portfolio rank and reporting health, qualitative KPIs, returns, valuation,
// credit), Cap table (cap table + SOI performance) and Forecast. Notes sits under
// every tab. The tab
// lives in the URL (/company/<id>/<tab>), so a tab is a shareable link and Back
// moves between tabs; a card id from an older link opens its tab and scrolls to it.
//
// The heavy panels live in sibling modules (CapTable.jsx, ForecastPanels.jsx) and
// are imported, never copied, so each has exactly one implementation.
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { FS, sans, serif, mono, MICRO } from "../ui/theme.js";
import { withCommas } from "../ui/format.js";
import { H2, Dropdown, Segmented, TabBar, MultiSelect, KVTableRow, Badge, Btn, RollupNote, Toggle, Modal, PencilIcon, Z,
  useStickyClone, StatusLine, useDismissable, MenuItem, SearchInput, POPOVER_SHADOW, filterByLabel, ChevronDownIcon, SectionHeader } from "../ui/components.jsx";
import Chart, { fmtVal, fmtFull, shortDate, TrendSparkline, TREND_SPARK_W, InkKpiChart } from "../ui/charts.jsx";
import {
  companyOf, metricOf, metricOptions, latest, pointsFor, metricsFor,
  metricKeyByLabel, runwayLatest, forecastPoints, forecastMetricsFor, actualVsForecast,
  metricCadence, cadenceLabel, seriesPoints, latestPoint, quarterChange,
  isQualitative, isCharted, numericMetrics, MONTHS_TO_SUFFIX, ltmValue,
} from "../model/kpi.js";
import { signalsForCompany } from "../model/signals.js";
import { customSignalsForCompany } from "../model/rules.js";
import { hasCapTable, soiLines, holdingsSource, capTotals, soiHistory, hasSoiHistory, hasSoiProceeds, soiRealizationMark, soiProceedsSteps, capTableAbsence, ownershipFunds } from "../model/captable.js";
import { CompanyTags } from "../ui/tags.jsx";
import { FavoriteStar } from "../ui/favorites.jsx";
import { CapTable, Holdings, SECTION_GAP } from "./CapTable.jsx";
import { rankOf, rankSinceInvestment, sinceInvestment } from "../model/peers.js";
import { Auto, Revisions } from "./ForecastPanels.jsx";
import { leverageForCompany, LEVERAGE_DEFS } from "../model/leverage.js";
import { reportingHealth, dataQualityIssues, quartersOf, BUCKET_LABEL } from "../model/review.js";
import { COMPANY_TABS, resolveCompanySub } from "../model/companyTabs.js";
import { resolveKpiKeys, setKpiKeys, resetKpiKeys, hasKpiOverride } from "../model/kpiSnapshotConfig.js";
import { getFocus, setFocus, subscribeFocus, openPortfolio, syncCompanyToUrl, setCompanySubtab } from "../state/focus.js";
import { parseRoute, subscribeNav } from "../route.js";
import { trackClick } from "../analytics.js";

const fmtX = (m) => (m == null || !Number.isFinite(m) ? "—" : (Math.abs(m) >= 100 ? Math.round(m).toLocaleString() : m.toFixed(2)) + "×");
const fmtPct = (v) => (v == null || !Number.isFinite(v) ? "—" : (v >= 0 ? "+" : "−") + withCommas(Math.abs(v * 100).toFixed(0)) + "%");
const yearsBetween = (a, b) => { if (!a || !b) return null; const d = (new Date(b) - new Date(a)) / (365.25 * 864e5); return d > 0 ? d : null; };
// Round names come from the record as typed — "series d", "Series D", "SERIES D" all
// occur. Title-case for display so casing reads consistently across companies.
const titleCase = (s) => s.replace(/\w\S*/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase());
// Chart titles only — table/dropdown labels stay untouched. Keeps acronyms (ARR) as-is.
const lowerWord = (w) => (/^[A-Z0-9]{2,}$/.test(w) ? w : w.charAt(0).toLowerCase() + w.slice(1));
// Hyphenated compounds ("Multi-Year") have a capital after the hyphen too —
// lower each hyphen segment on its own so only the acronym-shaped ones survive.
const sentenceCase = (s) => (s || "").split(" ").map((w, i) =>
  (i === 0 ? w : w.split("-").map(lowerWord).join("-"))).join(" ");
const NEG = "var(--ink-color-global-feedback-negative-strong)";
const POS = "var(--ink-color-global-feedback-positive-strong)";
const ruleLink = { ...sans, border: "none", background: "transparent", padding: 0, cursor: "pointer",
  fontSize: "inherit", fontWeight: 600, color: "var(--ink-color-global-link-default)" };

/** The card registry, keyed by card id. Every card always renders — one with no
 *  data says what is missing and where it would come from, rather than hiding.
 *  Which tab a card sits on, and in what order, comes from companyTabs. */
const CARDS = {
  qualitative: (p) => <QualitativeBlock data={p.data} company={p.company} />,
  returns: (p) => <ReturnsBlock data={p.data} company={p.company} />,
  valuation: (p) => <ValuationBlock data={p.data} company={p.company} val={p.company.valuation} lr={p.company.lastRound} />,
  soiPerformance: (p) => <SoiPerformanceBlock data={p.data} company={p.company} />,
  kpiSnapshot: (p) => <KpiSnapshot data={p.data} company={p.company} dashboard={p.dashboard} basis={p.basis} setBasis={p.setBasis} />,
  captable: (p) => <CapCard data={p.data} company={p.company} />,
  forecast: (p) => <ForecastPanel data={p.data} company={p.company} />,
  credit: (p) => <CreditPanel data={p.data} company={p.company} dashboard={p.dashboard} />,
  signals: (p) => <RiskBlock data={p.data} company={p.company} dashboard={p.dashboard} />,
  notes: (p) => <NotesBlock company={p.company} dashboard={p.dashboard} />,
};

// Cards rendering one narrow table sit two-per-row, pairing only with an adjacent
// pairable card so unpairable ones keep their document order. The KPI snapshot's
// four columns need the full row, and the qualitative KPIs sit under it at the same width.
const PAIRABLE = new Set(["returns", "captable", "valuation"]);

function groupCardRows(cardIds) {
  const rows = [];
  let pending = null;
  for (const cid of cardIds) {
    if (PAIRABLE.has(cid)) {
      if (pending) { rows.push([pending, cid]); pending = null; }
      else pending = cid;
    } else {
      if (pending) rows.push([pending]);
      pending = null;
      rows.push([cid]);
    }
  }
  if (pending) rows.push([pending]);
  return rows;
}
// Height reserved so a deep-linked card clears the app's sticky top bar.
const ANCHOR_OFFSET = 108;

/** The company name itself is the switcher — click it to jump to another
 *  company, same as Fund Admin's own entity-name-as-picker pattern. Built from
 *  Dropdown's own primitives (useDismissable/MenuItem/SearchInput/POPOVER_SHADOW)
 *  rather than Dropdown itself, since Dropdown always renders its own bordered
 *  trigger chrome and has no way to swap in the page-title styling this needs. */
function CompanySwitcher({ options, value, onChange }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef(null);
  const panelRef = useRef(null);
  useDismissable(open, setOpen, [ref, panelRef]);
  useEffect(() => { if (!open) setQ(""); }, [open]);
  const current = options.find((o) => o.id === value);
  const shown = filterByLabel(options, q);

  return (
    <span ref={ref} className="no-print" style={{ position: "relative", display: "inline-block" }}>
      <button onClick={() => setOpen((o) => !o)} aria-haspopup="listbox" aria-expanded={open} title={current?.label}
        data-testid="company-switcher-trigger"
        style={{ display: "inline-flex", alignItems: "center", gap: 6, maxWidth: "100%", border: "none", background: "transparent",
          padding: 0, cursor: "pointer", borderRadius: 4 }}>
        {/* Long company names need maxWidth + ellipsis here — without it the name
            wraps and pushes the header row to multiple lines. */}
        <span style={{ ...serif, fontSize: FS.h2, fontWeight: 700, color: "var(--ink-color-global-text-default)",
          maxWidth: 460, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{current?.label}</span>
        <ChevronDownIcon size={18} strokeWidth={1.75} style={{ flex: "none", color: "var(--ink-color-global-text-subtle)" }} />
      </button>
      {open && (
        <div ref={panelRef} className="popin" role="listbox" style={{ position: "absolute", top: "calc(100% + 4px)", left: 0,
          minWidth: 280, maxHeight: 340, overflowY: "auto", background: "var(--ink-color-global-surface-background-default)",
          border: `1px solid var(--ink-color-global-border-subtle)`, borderRadius: 6, boxShadow: POPOVER_SHADOW,
          zIndex: Z.popover, padding: "4px 0", transformOrigin: "top left" }}>
          <div style={{ padding: "0 8px 6px" }}>
            <SearchInput placeholder="Search companies…" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: "100%" }} />
          </div>
          {shown.map((o) => (
            <MenuItem key={o.id} onClick={() => { onChange(o.id); setOpen(false); }} selected={o.id === value} checkmark>
              {o.label}
            </MenuItem>
          ))}
          {shown.length === 0 && (
            <div style={{ ...sans, fontSize: FS.small, color: MICRO, padding: "8px 12px" }}>No matches</div>
          )}
        </div>
      )}
    </span>
  );
}

export default function CompanyPage({ data, dashboard }) {
  const companies = useMemo(() => [...(data.companies || [])].sort((a, b) => a.name.localeCompare(b.name)), [data]);
  const focusId = useSyncExternalStore(subscribeFocus, getFocus, () => null);
  const routeSub = useSyncExternalStore(subscribeNav, () => parseRoute().sub[1] || null, () => null);
  const valid = companies.find((c) => c.id === focusId);
  const id = valid ? focusId : (companies[0] || {}).id;
  const company = companyOf(data, id);
  // KPI change basis — "latest" (vs the prior filing) or "since" the fund invested;
  // declared before the early return to keep hook order stable.
  const [basis, setBasis] = useState("latest");
  // Keep the company in the path so every Company URL is a valid deep link —
  // arriving at a bare /company would otherwise put the tab in the id slot.
  useEffect(() => { if (id) syncCompanyToUrl(id); }, [id]);

  const { tab, anchor } = resolveCompanySub(routeSub, COMPANY_TABS.map((t) => t.id));

  // An older link names a card rather than a tab: scroll it into view once painted.
  useEffect(() => {
    if (!anchor) return;
    const t = setTimeout(() => document.getElementById(`card-${anchor}`)?.scrollIntoView?.({ block: "start" }), 0);
    return () => clearTimeout(t);
  }, [anchor, id]);

  if (!company) return <div style={{ display: "flex", flexDirection: "column", gap: 12 }}><H2>Company</H2><div className="card" style={{ padding: 28, textAlign: "center", color: MICRO, ...sans }}>No companies.</div></div>;

  const coOpts = companies.map((c) => ({ id: c.id, label: c.name }));
  const ret = company.returns;
  const held = ret && yearsBetween(ret.firstDate, data.source?.asOf);

  // Quiet one-line identity: the fund(s) that hold it and how long we've held —
  // as text, not badges, so the top of the page reads calmly in a 30-second scan.
  const meta = [(company.funds || []).join(" · "), held ? `held ${held.toFixed(1)} yrs` : null]
    .filter(Boolean).join("  ·  ");

  const firmName = data.branding?.firmName ?? data.source?.firm;
  const selectTab = (tid) => { trackClick("PortfolioAnalytics.Company.SelectTab"); setCompanySubtab(tid, id); };
  const renderCard = (cid) => (
    <div key={cid} id={`card-${cid}`} style={{ scrollMarginTop: ANCHOR_OFFSET }}>
      {CARDS[cid]({ data, company, dashboard, basis, setBasis })}
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 36 }}>
      {/* Title block for the printed tearsheet only — hidden on screen, revealed by
          @media print (the app's header controls carry .no-print and drop away).
          display:none on screen keeps it out of the flex flow entirely. */}
      <div className="print-only" style={{ marginBottom: 14, borderBottom: "2px solid #1A1A1A", paddingBottom: 10 }}>
        <div style={{ ...serif, fontSize: FS.h3, fontWeight: 700 }}>{firmName ? `${firmName} — ` : ""}Portfolio tearsheet</div>
        <div style={{ ...sans, fontSize: FS.small, color: "var(--ink-color-global-text-subtle)", marginTop: 3 }}>
          {company.name}{data.source?.asOf ? ` · data as of ${shortDate(data.source.asOf)}` : ""}
        </div>
      </div>
      {/* header — one section, tightly grouped (gap: 12, matching Coverage's H2
          block) so the outer gap: 36 reads as space AFTER the header, not stacked
          36px gaps between every header row on top of each row's own margin. */}
      <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {/* position:relative so the star can hang in the left margin (below) without
              taking up flex space — the name's own left edge then lines up with every
              other left-aligned heading on the page (Risk & signals, KPI snapshot, …). */}
          <div style={{ position: "relative", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            {/* Positioned entirely to the left of this row's own left edge (right:
                100% = flush with that edge, plus an 8px gutter) — removed from flex
                flow, so it never shifts the name. No stopPropagation needed here,
                unlike RankedTable's star: there it sits inside the row it would
                otherwise expand; here it's a sibling of the switcher button, not
                nested inside it, so a star click can't reach it either way. */}
            <span className="no-print" style={{ position: "absolute", right: "calc(100% + 8px)", top: "50%", transform: "translateY(-50%)", lineHeight: 0 }}>
              <FavoriteStar company={company} doc={dashboard?.doc} onUpdate={dashboard?.update} />
            </span>
            {/* The name itself is the company switcher on screen (click to jump to
                another company, Fund Admin's own entity-picker pattern) — the
                printed sheet gets the plain name text with no click affordance. */}
            <span className="print-only" style={{ ...serif, fontSize: FS.h2, fontWeight: 700 }}>{company.name}</span>
            <CompanySwitcher options={coOpts} value={id}
              onChange={(v) => { trackClick("PortfolioAnalytics.Company.SelectCompany"); setFocus(v); }} />
            <span className="no-print" style={{ flex: 1 }} />
            <Btn kind="primary" data-testid="download-pdf" className="no-print"
              onClick={() => { trackClick("PortfolioAnalytics.Company.DownloadPdfClick"); window.print(); }}>
              Download PDF
            </Btn>
          </div>
          {meta && <div style={{ ...sans, fontSize: FS.small, color: "var(--ink-color-global-text-subtle)" }}>{meta}</div>}
        </div>
        {/* Tags carry the realization status + firm's own categories (sector/geo/…). */}
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          <CompanyTags company={company} />
        </div>
        <div className="no-print" data-testid="company-tabs">
          <TabBar options={COMPANY_TABS} value={tab} onChange={selectTab} />
        </div>
      </section>

      {/* Every tab renders so the printed sheet stacks them all; on screen the CSS
          hides the inactive panels. Each panel titles itself for the printout. */}
      {COMPANY_TABS.map((t) => (
        <section key={t.id} role="tabpanel" data-testid={`company-tab-${t.id}`} aria-hidden={t.id !== tab}
          className={`company-tab-panel${t.id === tab ? "" : " is-inactive"}`}>
          <div className="print-only" style={{ ...serif, fontSize: FS.h3, fontWeight: 700, margin: "18px 0 12px" }}>{t.label}</div>
          {groupCardRows(t.cards).map((group) => (
            <div key={group.join("-")} style={group.length > 1 ? { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, alignItems: "start" } : undefined}>
              {group.map(renderCard)}
            </div>
          ))}
        </section>
      ))}
      {renderCard("notes")}
    </div>
  );
}

/** Investment returns (gross) — firm-wide sums plus the per-fund deal IRR. */
function ReturnsBlock({ data, company }) {
  const ret = company.returns, irr = company.dealIrr, irrScope = company.dealIrrScope;
  const own = company.ownership;
  const byFund = own?.byFund || [];
  const [ownOpen, setOwnOpen] = useState(false);
  if (!ret) {
    return (
      <Section label="Investment returns (gross)">
        <Empty>No investment returns on file — cost, current value, MOIC and deal IRR come from Fund Admin holdings.</Empty>
      </Section>
    );
  }
  return (
    <Section label="Investment returns (gross)"
      right={data.source?.asOf ? <span style={{ ...sans, fontSize: FS.small, color: MICRO }}>as of {shortDate(data.source.asOf)}</span> : null}>
      <KVTableRow stats={[
        { label: "Cost basis", value: fmtVal(ret.cost, "Dollar") },
        { label: "Current value", value: fmtVal(ret.fmv, "Dollar") },
        { label: "Gross MOIC", value: fmtX(ret.moic) },
        { label: "Unrealized", value: fmtVal(ret.unrealized, "Dollar"), color: ret.unrealized >= 0 ? POS : NEG },
        // Every other figure here sums across the firm's funds. A deal IRR cannot:
        // Carta reports it per fund and IRRs don't add. When funds co-invested,
        // name the fund the number belongs to and show the spread.
        ...(irr != null ? [{
          label: "Deal IRR", value: fmtPct(irr), color: irr >= 0 ? POS : NEG,
          ...(irrScope ? {
            sub: `${irrScope.fund || "largest position"} · ${irrScope.funds} funds hold this`,
            hint: `${irrScope.funds} of your funds hold this company, and Carta reports a separate IRR for each `
              + `(${fmtPct(irrScope.min)} to ${fmtPct(irrScope.max)}). Shown is the fund with the largest cost basis. `
              + `The other figures here are firm-wide totals; an IRR cannot be added across funds.`,
          } : {}),
        }] : []),
        // Firm-wide FD ownership, summed across the funds that hold this company.
        // With several funds, `sub` discloses the per-fund breakdown below.
        ...(own?.pct != null ? [{
          label: "Firm ownership", value: fmtVal(own.pct, "Percentage"),
          hint: `The firm's fully-diluted ownership of this company${own.asOf ? ` as of ${own.asOf}` : ""}, `
            + `summed across every fund that holds it.`,
          ...(byFund.length > 1 ? {
            sub: <Btn kind="link" onClick={() => setOwnOpen((o) => !o)}>
              {ownOpen ? "Hide funds ▲" : `${byFund.length} funds ▾`}
            </Btn>,
          } : byFund.length === 1 ? { sub: byFund[0].fund } : {}),
        }] : []),
        ...(ret.proceeds > 0 ? [{ label: "Proceeds", value: fmtVal(ret.proceeds, "Dollar") }] : []),
      ]} />
      {ownOpen && byFund.length > 1 && (
        <div style={{ marginTop: 8 }}>
          <KVTableRow title="Ownership by fund" stats={byFund.map((f) => ({
            key: f.fund, label: f.fund, value: fmtVal(f.pct, "Percentage"),
          }))} />
        </div>
      )}
    </Section>
  );
}

/** The cap table when there is one, then Holdings whenever the firm has positions
 *  or a per-fund ownership split to show. */
function CapTablePanel({ data, company }) {
  const src = holdingsSource(data);
  const showHoldings = soiLines(company).length > 0 || ownershipFunds(company).length > 0;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: SECTION_GAP }}>
      {hasCapTable(company) && <CapTable company={company} />}
      {showHoldings && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <SectionHeader>Holdings</SectionHeader>
          <Holdings data={data} company={company} src={src} />
        </div>
      )}
    </div>
  );
}

/** The fund's most recent financing round for `company`, formatted as the same
 *  "SEED · $21.6M post · 2024-08-05" string the Overview drawer's Position card used. */
function latestRoundText(data, company) {
  const lr = company && company.lastRound;
  if (!lr) return "—";
  const cur = data.source && data.source.currency;
  const round = (lr.round || "—").toUpperCase();
  const post = lr.postMoney != null ? " · " + fmtVal(lr.postMoney, "Dollar", null, cur) + " post" : "";
  const date = lr.date ? " · " + lr.date : "";
  return `${round}${post}${date}`;
}

/** Cap table card: the panels inline on the Company page (their banner is the summary);
 *  in `drawer` mode a Position-card-aligned summary row with the panels behind a modal. */
export function CapCard({ data, company, drawer = false }) {
  const [full, setFull] = useState(false);
  const t = capTotals(company);
  const own = company.ownership;
  const absence = capTableAbsence(company);
  const noCapTable = (
    <div className="card" style={{ padding: 16, ...sans, fontSize: FS.small, color: MICRO }}>
      No cap table on file{absence ? ` — ${absence.title}` : ""}.{drawer ? " Open for positions." : ""}
    </div>
  );
  if (!drawer) {
    return (
      <Section label="Cap table">
        {!t && noCapTable}
        <div style={{ marginTop: t ? 0 : 16 }}><CapTablePanel data={data} company={company} /></div>
      </Section>
    );
  }
  const latestRoundRow = [{ label: "Latest round", value: latestRoundText(data, company) }];
  return (
    <Section label="Cap table"
      right={<Btn onClick={() => { trackClick("PortfolioAnalytics.Company.ExpandCapTable"); setFull(true); }}>View cap table</Btn>}>
      {t ? (
        <KVTableRow stats={[
          { label: "Fully diluted", value: t.fd == null ? "—" : Math.round(t.fd).toLocaleString("en-US"), hint: `${t.classes} security classes` },
          ...(own?.pct != null ? [{ label: "Firm ownership", value: fmtVal(own.pct, "Percentage"),
            hint: "The firm's fully-diluted ownership, summed across every fund that holds this company. Open the cap table for the per-fund split." }] : []),
          { label: "Outstanding", value: t.outstanding == null ? "—" : Math.round(t.outstanding).toLocaleString("en-US") },
          { label: "Cash raised", value: fmtVal(t.cashRaised, "Dollar"), hint: "Across all classes" },
          ...latestRoundRow,
        ]} />
      ) : (
        <>
          {noCapTable}
          <KVTableRow stats={latestRoundRow} />
        </>
      )}
      <Modal open={full} onClose={() => setFull(false)} title="Cap table" width={1032} labelledById="captable-title">
        <CapTablePanel data={data} company={company} />
      </Modal>
    </Section>
  );
}

// Matches Ink's real table-header cell (table.ledger th in theme.js: Inter
// Medium 14px/24px, sentence case, text-default) rather than a bold caption —
// the same type Figma's NewTable header row uses, applied to every Company
// card's own title since each one sits directly above a table.
const sectionTitle = { ...sans, fontSize: FS.value, fontWeight: 600, lineHeight: "24px", letterSpacing: "normal", color: "var(--ink-color-global-text-default)", whiteSpace: "nowrap", flexShrink: 0 };
// No bottom margin — the page is a flex column and its `gap` owns the spacing
// between cards, so a margin here would stack on top of it.
export const Section = ({ label, children, right }) => (
  <div>
    {/* Fixed 44px height keeps paired tables level; padding-left 12px matches
        the label column's inset, padding-right 0 keeps `right` flush with the table's border. */}
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "0 0 0 12px", height: 44, boxSizing: "border-box" }}>
      <div style={sectionTitle}>{label}</div>
      <span style={{ flex: 1, minWidth: 0 }} />
      <div style={{ flexShrink: 0 }}>{right}</div>
    </div>
    {children}
  </div>
);

/** SOI performance over time — the fund's mark on this company as a line chart.
 *  Value-per-share and position value (FMV vs cost) sit on wildly different
 *  scales, so a toggle picks one axis rather than crushing PPS to the floor. */
function SoiPerformanceBlock({ data, company }) {
  const [mode, setMode] = useState("pps"); // "pps" | "value"
  const pts = soiHistory(company);
  const noHistory = (
    <Section label="SOI performance">
      <Empty>No holdings history — the fund’s marks on this position over time come from Fund Admin.</Empty>
    </Section>
  );
  if (!hasSoiHistory(company)) return noHistory;

  const has = (k) => pts.some((p) => p[k] != null && Number.isFinite(p[k]));
  const line = (k, label) => ({ key: k, label, points: pts.filter((p) => p[k] != null).map((p) => ({ d: p.d, v: p[k] })) });
  // Total value = held FMV + cumulative proceeds, so a realized exit steps up to the
  // cash returned instead of crashing to zero. Absent in older builds → plain FMV line.
  const withProceeds = hasSoiProceeds(company);
  const totalLine = () => ({ key: "val", label: "Total value (FMV + proceeds)",
    points: pts.filter((p) => p.fmv != null || p.proceeds != null).map((p) => ({ d: p.d, v: (p.fmv || 0) + (p.proceeds || 0) })) });

  const modes = [
    { id: "pps", label: "Value per share", on: has("pps") },
    { id: "value", label: "Position value", on: has("fmv") || has("cost") },
  ].filter((m) => m.on);
  if (!modes.length) return noHistory;
  const active = modes.some((m) => m.id === mode) ? mode : modes[0].id;

  const valueKey = withProceeds ? "val" : "fmv";
  const valueLine = withProceeds ? totalLine() : line("fmv", "Position value (FMV)");
  const series = active === "pps"
    ? [line("pps", "Value per share")]
    : [...((has("fmv") || withProceeds) ? [valueLine] : []),
       // cost basis is the black reference line; the value line colors green/red against it
       ...(has("cost") ? [{ ...line("cost", "Cost basis"), color: "#1A1A1A" }] : [])];
  const splitReady = active === "value" && (has("fmv") || withProceeds) && has("cost");

  // Realization marker: teal for cash-back, red for a $0 write-off. It sits on the
  // value line so a full exit is legible even when the line ends at zero.
  const rz = active === "value" ? soiRealizationMark(company) : null;
  const marks = rz ? [{
    d: rz.d, series: valueKey,
    color: rz.proceeds > 0 ? "#2D9E90" : "#E52431",
    label: rz.proceeds > 0 ? `Exit · +${fmtVal(rz.proceeds, "Dollar")}` : "Exit · $0 write-off",
  }] : [];
  // Hatch the post-exit area (realized cash) and tick each later distribution, so
  // the rolling proceeds after the initial exit read as banked cash, not re-marks.
  const realized = rz && splitReady ? {
    from: rz.d, series: valueKey, against: "cost", color: "#2D9E90",
    ticks: soiProceedsSteps(company).filter((d) => d > rz.d),
  } : null;

  const subtitle = active === "pps"
    ? "Fund-admin mark per share at each snapshot"
    : withProceeds ? "Total value (FMV + proceeds) vs cost basis at each snapshot"
    : "Marked value (FMV) vs cost basis at each snapshot";

  return (
    <Section label="SOI performance"
      right={modes.length > 1 ? <Segmented options={modes} value={active} onChange={setMode} /> : null}>
      <div className="card" style={{ padding: 16 }}>
        <Chart chartId="company-soi-history" type="line" unit="Dollar" height={240} showTitle={false}
          title={`${company.name} — SOI performance`} subtitle={subtitle} series={series} marks={marks} realized={realized}
          gainLoss={splitReady ? { upper: valueKey, lower: "cost" } : null}
          lineSplit={splitReady ? { series: valueKey, against: "cost" } : null} />
        <MethodLine>
          Historical marks from fund administration (Schedule of Investments). Value per share is the
          largest equity position each period; FMV and cost sum across the firm’s positions.
          {withProceeds && " Total value adds cumulative proceeds; the hatched area is realized cash, ticked at each distribution."}
        </MethodLine>
      </div>
    </Section>
  );
}

function ValuationBlock({ data, company, val, lr }) {
  const metrics = numericMetrics(data.metrics);   // a multiple on a flag means nothing
  const recRev = metricKeyByLabel(data, /^revenue$/i);
  const [mk, setMk] = useState(() => recRev || (metrics[0] || {}).key);
  if (!val && !lr) {
    return (
      <Section label="Valuation">
        <Empty>No valuation or priced round on file — the mark comes from Fund Admin and the last round from the Carta cap table.</Empty>
      </Section>
    );
  }
  const metric = metricOf(data, mk);
  // Flow KPI (revenue/EBITDA/…) → trailing-twelve-months denominator; balance-sheet
  // KPI → latest value. Short of a full year of a flow → N/A with what's missing.
  const ltm = val ? ltmValue(company, mk, metric) : null;
  const kpi = ltm && ltm.complete ? ltm.v : null;
  const isFlow = !!(ltm && ltm.basis !== "level");   // flow → LTM sum; level → as-of latest
  const multiple = val && kpi != null && kpi > 0 ? val.impliedValuation / kpi : null;
  const incomplete = !!(ltm && !ltm.complete);
  const ltmMiss = incomplete ? `Trailing-twelve-months ${metric ? metric.label : "KPI"} needs a full year — still missing ${ltm.missing.join(", ")}.` : undefined;
  const nowVsRound = val && lr?.postMoney ? (val.impliedValuation - lr.postMoney) / lr.postMoney : null;

  return (
    <Section label="Valuation"
      right={val && <Dropdown options={metricOptions(metrics)} value={mk} onChange={setMk} minWidth={200} triggerLabel="Multiple" />}>
      <KVTableRow stats={[
        ...(val ? [
          { label: "Implied valuation", value: fmtVal(val.impliedValuation, "Dollar"),
            hint: `${fmtVal(val.pps, "Dollar")}/share × ${(val.fdShares).toLocaleString()} fully-diluted shares` },
          ...(kpi != null ? [{
            label: isFlow ? `LTM ${metric.label}` : metric.label,
            value: fmtVal(kpi, metric.unit),
            hint: isFlow ? "Last twelve months — the sum of the four quarters ending at the latest reported quarter (monthly figures are rolled up to quarters first)." : undefined,
            sub: isFlow ? null : (ltm.asOf ? `as of ${shortDate(ltm.asOf)}` : null),
          }] : []),
          { label: `${metric ? metric.label : ""} multiple`,
            value: multiple != null ? fmtX(multiple) : incomplete ? "N/A" : "—",
            hint: ltmMiss,
            sub: multiple != null ? null : incomplete ? "full year not yet reported" : "no KPI reported" },
        ] : []),
        ...(lr ? [{ label: <>Last priced round{lr.date && <span style={{ color: "var(--ink-color-global-text-subtle)" }}> {lr.date}</span>}</>,
          value: <>{lr.postMoney ? fmtVal(lr.postMoney, "Dollar") : "—"}{lr.round && <span style={{ color: "var(--ink-color-global-text-subtle)" }}> {titleCase(lr.round)}</span>}</> }] : []),
        ...(nowVsRound != null ? [{ label: "Mark vs last round", value: fmtPct(nowVsRound), color: nowVsRound >= 0 ? POS : NEG }] : []),
      ]} />
    </Section>
  );
}

/** What the company SAID, as opposed to what it counted: flags, dates and prose.
 *  Sits directly under the KPI snapshot, at the same full width, so the numbers and
 *  the words read as one block. A firm with no such KPIs anywhere never sees the card; a
 *  company that skipped them in a firm that uses them gets an empty state. */
function QualitativeBlock({ data, company }) {
  const metrics = metricsFor(data, company).filter(isQualitative);
  if (!metrics.length) {
    return (data.metrics || []).some(isQualitative)
      ? <Section label="Qualitative KPIs"><Empty>{company.name} reports no flag, date or text KPIs.</Empty></Section>
      : null;
  }
  return (
    <Section label="Qualitative KPIs">
      <KVTableRow stats={metrics.map((m) => {
        const l = latestPoint(company, m.key, m, false);
        const months = m.kind === "date" ? latest(company, m.key + MONTHS_TO_SUFFIX) : null;
        return {
          key: m.key,
          label: `${m.label} · ${cadenceLabel(metricCadence(company, m.key))}`,
          value: l ? fmtVal(l.v, m.unit, l.s, l.cur) : "—",
          sub: l && months && months.v != null
            ? <span style={{ color: months.v < 6 ? NEG : MICRO }}>{months.v.toFixed(1)} months away</span>
            : <span style={{ color: MICRO }}>{l ? `as of ${l.d}` : "not reported"}</span>,
        };
      })} />
    </Section>
  );
}

const HEADLINE = [/^revenue$/i, /recurring revenue|^arr$/i, /^ebitda$/i, /^gross profit$/i, /cash and cash equivalents/i, /^net income$/i, /^headcount$/i, /runway/i];
const BASIS_OPTIONS = [{ id: "latest", label: "Latest" }, { id: "since", label: "Since invested" }];
const fmtRank = (r) => `${r.rank} of ${r.of} · ${Math.round(r.percentile * 100)}th`;
const asOfLabel = (company, k, d) => (d ? shortDate(d, metricCadence(company, k) === "quarterly") : null);
const rankCell = (r, tip) => (r ? <span data-tip={tip} style={{ cursor: "help" }}>{fmtRank(r)}</span> : null);

/** The label cell every KPI row shares: metric name, a custom marker, cadence hint. */
function kpiRowLabel(company, m, k) {
  const badge = m.custom ? <Badge tone="muted" variant="text" style={{ marginLeft: 4 }}>custom</Badge> : null;
  return { key: k, label: <>{m.label}{badge}</>, hint: `Reported ${cadenceLabel(metricCadence(company, k)).toLowerCase()}` };
}

/** Latest filed figure, change vs the prior filing, rank on the latest value. */
function latestKpiRow(data, company, k) {
  const m = metricOf(data, k);
  const row = kpiRowLabel(company, m, k);
  const l = latestPoint(company, k, m, false);
  if (!l) return { ...row, value: "—" };
  const g = (quarterChange(company, k, m, 1, false) || {}).g ?? null;
  const r = rankOf(data, company, k);
  const vsMedian = r?.median ? ` · ${fmtPct((r.value - r.median) / Math.abs(r.median))} vs median` : "";
  return { ...row,
    value: fmtVal(l.v, m.unit, undefined, l.cur),
    delta: g == null ? null : { dir: g >= 0 ? "up" : "down", pct: Math.abs(g * 100) },
    rank: rankCell(r, r && `Portfolio median ${fmtVal(r.median, m.unit)}${vsMedian}`),
    asOf: asOfLabel(company, k, l.d) };
}

/** Latest figure, change since the first filing after the fund invested, rank on that change. */
function sinceKpiRow(data, company, k) {
  const m = metricOf(data, k);
  const row = kpiRowLabel(company, m, k);
  const s = sinceInvestment(data, company, k);
  if (!s) return { ...row, value: "—", sub: <span style={{ color: MICRO }}>not enough history since {company.returns.firstDate}</span> };
  const r = rankSinceInvestment(data, company, k);
  return { ...row,
    sub: <span style={{ color: MICRO }}>{s.reason || <>{fmtVal(s.entry.v, m.unit)} at entry · {s.entry.d}</>}</span>,
    value: fmtVal(s.now.v, m.unit),
    delta: s.change == null ? null : { dir: s.change >= 0 ? "up" : "down", pct: Math.abs(s.change * 100) },
    rank: rankCell(r, r && `Portfolio median change since investment ${fmtPct(r.median)}`),
    asOf: asOfLabel(company, k, s.now.d) };
}

/** Headline KPIs, one row each: the latest filed figure, its change, and where that
 *  puts the company in the portfolio. `basis` sets what change and rank measure. */
function KpiSnapshot({ data, company, dashboard, basis, setBasis }) {
  const [configuring, setConfiguring] = useState(false);
  const doc = dashboard?.doc;
  // Default (unconfigured) selection: the headline metrics this company reports.
  const defaultKeys = useMemo(() => {
    const out = [];
    for (const re of HEADLINE) { const k = metricKeyByLabel(data, re); if (k && latest(company, k) && !out.includes(k)) out.push(k); }
    return out;
  }, [data, company]);
  const overridden = hasKpiOverride(doc, company.id);
  const keys = resolveKpiKeys(doc, company.id, defaultKeys).filter((k) => metricOf(data, k));
  const [showAll, setShowAll] = useState(false);
  // Since-invested needs an investment date, which only fund-admin holdings carry.
  const canSince = !!company.returns?.firstDate;
  const since = basis === "since" && canSince;
  // No KPIs at all: the card still carries the reporting status, then says so plainly.
  if (!metricsFor(data, company).length) {
    return (
      <Section label="KPI snapshot">
        <ReportingStatusLine data={data} company={company} />
        <Empty>No KPI data — {company.name} has not reported KPIs into Carta Data Collection.</Empty>
      </Section>
    );
  }
  return (
    <Section label={<>KPI snapshot
        <button type="button" onClick={() => setConfiguring(true)} aria-label="Configure KPIs"
          style={{ display: "inline-flex", verticalAlign: "middle", background: "none", border: "none", padding: 0, marginLeft: 6, cursor: "pointer",
            color: "var(--ink-color-global-text-subtle)" }}>
          <PencilIcon size={14} strokeWidth={1.6} />
        </button>
        {overridden ? " •" : ""}</>}
      right={<span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
        <span data-tip={canSince
          ? "What change and rank measure: the latest filing against the one before it, or against the first figure reported after the fund invested."
          : "Since-invested needs an investment date, which comes from Fund Admin holdings."}>
          <Segmented small options={BASIS_OPTIONS} value={since ? "since" : "latest"} onChange={setBasis} disabled={!canSince} />
        </span>
        <Btn onClick={() => { trackClick("PortfolioAnalytics.Company.ExpandKpis"); setShowAll(true); }}>View all KPIs</Btn>
      </span>}>
      <Modal open={configuring} onClose={() => setConfiguring(false)} title="Which KPIs to show" width={432} labelledById="configure-kpis-title">
        <ConfigureKpis data={data} company={company} dashboard={dashboard} defaultKeys={defaultKeys} onClose={() => setConfiguring(false)} />
      </Modal>
      <ReportingStatusLine data={data} company={company} />
      {keys.length ? (
        <KVTableRow stats={keys.map((k) => (since ? sinceKpiRow(data, company, k) : latestKpiRow(data, company, k)))} />
      ) : (
        <div style={{ ...sans, fontSize: FS.small, color: MICRO }}>No KPIs selected — use Configure to add rows.</div>
      )}
      {since ? (
        <MethodLine>
          Change is from the first figure reported on or after the investment date ({company.returns.firstDate}), not a
          figure from the deal itself. Rank orders the portfolio by that same change.
        </MethodLine>
      ) : <RollupNote quarterly={false} />}
      <Modal open={showAll} onClose={() => setShowAll(false)} title="KPI history & charts" width={1032} labelledById="kpi-history-title">
        <KpiPanel data={data} company={company} />
      </Modal>
    </Section>
  );
}

/** Pick which KPIs the snapshot shows — for this company, or firm-wide as the
 *  default every company inherits. Mirrors the chart gear's scope switch.
 *  Edits are a local draft; nothing reaches `dashboard` until Save. */
function ConfigureKpis({ data, company, dashboard, defaultKeys, onClose }) {
  const doc = dashboard?.doc;
  const [scope, setScope] = useState("company"); // "company" | "global"
  const options = useMemo(() => metricsFor(data, company).map((m) => ({ id: m.key, label: m.label })), [data, company]);
  // Seed the checkboxes from the scope being edited, falling back to what's on
  // screen (the resolved set) when that scope has no override yet.
  const storedSelected = useMemo(() => {
    const cfg = doc?.kpiSnapshot || {};
    if (scope === "global" && Array.isArray(cfg.global)) return new Set(cfg.global);
    if (scope === "company" && Array.isArray(cfg.byCompany?.[company.id])) return new Set(cfg.byCompany[company.id]);
    return new Set(resolveKpiKeys(doc, company.id, defaultKeys));
  }, [doc, scope, company.id, defaultKeys]);
  const [draft, setDraft] = useState(storedSelected);
  useEffect(() => { setDraft(storedSelected); }, [scope]); // eslint-disable-line react-hooks/exhaustive-deps -- re-seed only on scope switch, not every stored-set recompute
  const overridden = hasKpiOverride(doc, company.id, scope);

  const save = () => { dashboard.update((d) => setKpiKeys(d, company.id, [...draft], scope)); onClose(); };
  const reset = () => { dashboard.update((d) => resetKpiKeys(d, company.id, scope)); onClose(); };

  return (
    <div>
      <div style={{ marginBottom: 14 }}>
        <Segmented small value={scope} onChange={setScope}
          options={[{ id: "company", label: "This company" }, { id: "global", label: "All companies" }]} />
      </div>
      <MultiSelect label="KPIs" options={options} selected={draft} onChange={setDraft} />
      <div style={{ ...sans, fontSize: FS.micro, color: MICRO, marginTop: 10 }}>
        {scope === "company"
          ? "Saves for this company — overrides the firm-wide default."
          : "Saves for the whole firm — a company with its own selection keeps it."}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 32 }}>
        <div>{overridden && <Btn kind="link" onClick={reset}>Reset to default</Btn>}</div>
        <div style={{ display: "flex", gap: 12 }}>
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn kind="primary" onClick={save}>Save</Btn>
        </div>
      </div>
    </div>
  );
}

function RiskBlock({ data, company, dashboard }) {
  const rules = dashboard?.doc?.rules || [];
  const useBuiltin = dashboard?.doc?.builtinSignals !== false;
  const signals = [...(useBuiltin ? signalsForCompany(data, company) : []), ...customSignalsForCompany(data, company, rules)];
  const runway = runwayLatest(data, company);
  return (
    <Section label="Risk & signals">
      <div className="card" style={{ padding: 16 }}>
        {runway != null && <div style={{ ...mono, fontSize: FS.bodyLg, marginBottom: signals.length ? 12 : 0 }}>
          Runway: <strong style={{ color: runway < 12 ? NEG : "var(--ink-color-global-text-default)" }}>{runway.toFixed(0)} months</strong>
        </div>}
        {signals.length === 0 ? (
          <div style={{ ...sans, fontSize: FS.small, color: MICRO }}>
            No signals firing.{" "}
            <button onClick={() => openPortfolio("signals")} style={ruleLink}>Build a custom rule →</button>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {signals.map((s, i) => (
              <div key={i} style={{ display: "flex", gap: 10, alignItems: "baseline" }}>
                <Badge tone={s.tone}>{s.tag}</Badge>
                {s.custom && <Badge tone="muted" variant="text">custom</Badge>}
                <span style={{ ...sans, fontSize: FS.small, color: "var(--ink-color-global-text-subtle)" }}>{s.detail}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </Section>
  );
}

function ForecastBlock({ data, company }) {
  const fcMetrics = forecastMetricsFor(data, company);
  const [mk, setMk] = useState(() => (metricKeyByLabel(data, /^revenue$/i) && fcMetrics.some((m) => /^revenue$/i.test(m.label)) ? metricKeyByLabel(data, /^revenue$/i) : (fcMetrics[0] || {}).key));
  const key = fcMetrics.some((m) => m.key === mk) ? mk : (fcMetrics[0] || {}).key;
  const metric = metricOf(data, key);
  const unit = metric ? metric.unit : "Number";
  const v = actualVsForecast(company, key);
  const series = [
    { key: "actual", label: "Actual", points: pointsFor(company, key).map((p) => ({ d: p.d, v: p.v })) },
    { key: "fc", label: "Company forecast", points: forecastPoints(company, key).map((p) => ({ d: p.d, v: p.v })), dashed: true },
  ];
  const hasVintages = (company.forecastVintages && Object.keys(company.forecastVintages).length) > 0;
  return (
    <Section label="Forecast vs actual" right={<Dropdown options={fcMetrics.map((m) => ({ id: m.key, label: m.label }))} value={key} onChange={setMk} minWidth={200} />}>
      <div className="card" style={{ padding: 16 }}>
        <Chart chartId="company-forecast" type="line" unit={unit} height={230} series={series} showTitle={false}
          title={`${company.name} — ${metric ? metric.label : "KPI"}: actual vs company forecast`}
          subtitle="Solid = actual reported, dashed = latest forecast the company logged" />
        {v && (
          <div style={{ ...mono, fontSize: FS.small, marginTop: 8, color: "var(--ink-color-global-text-subtle)" }}>
            {v.period}: actual <strong style={{ color: "var(--ink-color-global-text-default)" }}>{fmtVal(v.actual, unit)}</strong> vs forecast <strong style={{ color: "var(--ink-color-global-text-default)" }}>{fmtVal(v.forecast, unit)}</strong>
            <span style={{ color: v.diff >= 0 ? POS : NEG }}> ({fmtPct(v.pct)})</span>
          </div>
        )}
      </div>
      {/* The vintage matrix follows the chart's KPI, so both read the same series. */}
      {hasVintages && <div style={{ marginTop: 36 }}><Revisions data={data} company={company} metricKey={key} /></div>}
    </Section>
  );
}

const KPI_VIEW_MODES = [{ id: "table", label: "Table" }, { id: "charts", label: "Charts" }];

/** KPIs sub-tab: the full grid as a table, plus the chart wall. The table is the
 *  Dashboard pivot narrowed to one company — every metric it reports, every
 *  period, with the same roll-up and partial-quarter marks. */
function KpiPanel({ data, company }) {
  const [view, setView] = useState("table");
  const metrics = metricsFor(data, company);
  if (!metrics.length) return <Empty>This company reports no KPIs.</Empty>;
  return (
    <div>
      <ReportingStatusLine data={data} company={company} />
      <TabBar options={KPI_VIEW_MODES} value={view} onChange={setView} style={{ marginBottom: 14 }} />
      {view === "table" ? <KpiTable data={data} company={company} quarterly={false} metrics={metrics} />
        : <KpiCharts data={data} company={company} quarterly={false} forceOpen />}
    </div>
  );
}

// Whole-history direction for a KPI row's trend sparkline: first reported
// value vs the latest one, since the row plots every period, not a single
// quarter's move.
function trendDir(periods, byP) {
  const clean = periods.map((p) => byP.get(p)).filter((c) => c && Number.isFinite(c.v));
  if (clean.length < 2) return undefined;
  const first = clean[0].v, last = clean[clean.length - 1].v;
  return last === first ? undefined : last > first ? "up" : "down";
}

function KpiTable({ data, company, quarterly, metrics }) {
  const [growth, setGrowth] = useState(false);
  const [full, setFull] = useState(false);
  const wrapRef = useRef(null);
  const tableRef = useRef(null);
  const clone = useStickyClone(wrapRef, tableRef);

  const { periods, rows } = useMemo(() => {
    const set = new Set();
    const rows = metrics.map((m) => {
      const pts = seriesPoints(company, m.key, m, quarterly);
      pts.forEach((p) => set.add(p.d));
      return { m, byP: new Map(pts.map((p) => [p.d, p])) };
    });
    return { periods: [...set].sort(), rows };
  }, [company, metrics, quarterly]);

  const show = (v, unit, str, cur) => (full ? fmtFull(v, unit, str, cur) : fmtVal(v, unit, str, cur));

  const csvExport = () => {
    // A money row exports its real ISO currency, not the generic "Dollar" type;
    // non-money rows keep their unit type, which has no currency.
    const rowCurrencyOrUnit = (r) => {
      if (r.m.unit !== "Dollar") return r.m.unit;
      const p = periods.find((d) => r.byP.get(d) && r.byP.get(d).cur);
      return (p && r.byP.get(p).cur) || data.source?.currency || r.m.unit;
    };
    const head = ["KPI", "Currency / unit", ...periods].map(csvCell).join(",");
    const body = rows.map((r) => [r.m.label, rowCurrencyOrUnit(r),
      ...periods.map((p) => { const c = r.byP.get(p); return c == null ? "" : (c.s != null ? c.s : c.v); })].map(csvCell).join(","));
    const blob = new Blob([[head, ...body].join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${company.id}-kpis-${quarterly ? "quarterly" : "as-reported"}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <Section
      right={<div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <span style={{ ...sans, fontSize: FS.small, color: MICRO, display: "inline-flex", gap: 6, alignItems: "center" }}>
          Full figures <Toggle small checked={full} onChange={setFull} labels={["On", "Off"]} />
        </span>
        <span style={{ ...sans, fontSize: FS.small, color: MICRO, display: "inline-flex", gap: 6, alignItems: "center" }}>
          % change <Toggle small checked={growth} onChange={setGrowth} labels={["On", "Off"]} />
        </span>
        <Btn className="no-print" onClick={csvExport}>Export CSV</Btn>
      </div>}>
      <div ref={wrapRef} style={{ overflowX: "auto" }}>
        <table ref={tableRef} className="ledger sheet" style={{ width: "100%", ...mono }}>
          <thead>
            <tr>
              <th className="frozen-col" style={{ ...thStyle, position: "sticky", left: 0, zIndex: 2, minWidth: 190, textAlign: "left" }}>KPI</th>
              <th style={{ ...thStyle, minWidth: TREND_SPARK_W, textAlign: "left" }}>Trend</th>
              {periods.map((p) => <th key={p} style={{ ...thStyle, minWidth: 92, textAlign: "right" }}>{shortDate(p)}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.m.key}>
                <td className="frozen-col" style={{ ...tdStyle, position: "sticky", left: 0, zIndex: 1, ...sans,
                  textAlign: "left" }}>
                  {r.m.label}
                  {r.m.custom && <Badge tone="muted" variant="text" style={{ marginLeft: 4 }}>custom</Badge>}
                </td>
                <td style={{ ...tdStyle, textAlign: "left" }}>
                  {!isQualitative(r.m) && <TrendSparkline points={periods.map((p) => ({ d: p, v: r.byP.get(p)?.v }))} dir={trendDir(periods, r.byP)} />}
                </td>
                {periods.map((p, i) => {
                  const cell = r.byP.get(p);
                  if (!cell) return <td key={p} style={{ ...tdStyle, textAlign: "right", color: MICRO }}>—</td>;
                  const prev = i > 0 ? r.byP.get(periods[i - 1]) : null;
                  // A flag or a date has no meaningful percentage change.
                  const g = growth && prev && prev.v !== 0 && !isQualitative(r.m)
                    ? (cell.v - prev.v) / Math.abs(prev.v) : null;
                  return (
                    <td key={p} style={{ ...tdStyle, textAlign: "right" }}
                      data-tip={quarterly && cell.months > 1
                        ? `${cell.agg === "sum" ? "Sum of" : "Closing value of"} ${cell.months} reported periods: ${cell.parts.join(", ")}`
                        : undefined}>
                      {growth
                        ? (g == null ? <span style={{ color: MICRO }}>N/A</span>
                          : <span style={{ color: g >= 0 ? POS : NEG }}>{fmtPct(g)}</span>)
                        : show(cell.v, r.m.unit, cell.s, cell.cur)}
                      {cell.partial && <span data-tip={`Partial quarter — ${cell.months} of ${cell.expected} months reported, so this total is understated.`}
                        style={{ color: NEG, fontWeight: 700, marginLeft: 3, cursor: "help" }}>*</span>}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {clone && createPortal(
        // Column widths sum wider than the viewport; this clip box scrolls in step
        // with the table (useStickyClone drives its scrollLeft) around the natural-width table.
        <div ref={clone.scrollRef} style={{ position: "fixed", top: clone.top, left: clone.left, width: clone.width, overflow: "hidden", zIndex: Z.modal + 1 }}>
          <table className="ledger sheet sticky-clone" style={{ position: "static", ...mono }}>
            <colgroup>{clone.cols.map((w, i) => <col key={i} style={{ width: w }} />)}</colgroup>
            <thead>
              <tr>
                {/* Sticky-left pins against the clip box, matching the real table's KPI cell. */}
                <th className="frozen-col" style={{ ...thStyle, position: "sticky", left: 0, zIndex: 2, textAlign: "left" }}>KPI</th>
                <th style={{ ...thStyle, textAlign: "left" }}>Trend</th>
                {periods.map((p) => <th key={p} style={{ ...thStyle, textAlign: "right" }}>{shortDate(p)}</th>)}
              </tr>
            </thead>
          </table>
        </div>,
        document.body,
      )}
      <RollupNote quarterly={quarterly} />
    </Section>
  );
}

const csvCell = (s) => (/[",\n]/.test(String(s)) ? `"${String(s).replace(/"/g, '""')}"` : String(s));
const thStyle = { whiteSpace: "nowrap" };
const tdStyle = thStyle;

function KpiCharts({ data, company, quarterly, forceOpen }) {
  // Free text has no value to plot; flags and dates do.
  const metrics = metricsFor(data, company).filter(isCharted);
  const [open, setOpen] = useState(!!forceOpen);
  if (!metrics.length) return null;
  return (
    <Section label={`KPI charts (${metrics.length})${quarterly ? " · quarterly" : " · as reported"}`} right={forceOpen ? null : <Btn onClick={() => setOpen((o) => !o)}>{open ? "Hide" : "Show all"}</Btn>}>
      {open ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))", gap: 16 }}>
          {metrics.map((m) => (
            <div key={m.key} className="card chart-card" style={{ padding: 14 }}>
              <InkKpiChart id={m.key} title={sentenceCase(m.label)} company={company.name}
                badge={m.custom && <Badge tone="muted" variant="text" style={{ marginLeft: 4 }}>custom</Badge>}
                unit={m.unit} quarterly={quarterly} height={150}
                points={seriesPoints(company, m.key, m, quarterly).map((p) => ({ d: p.d, v: p.v, cur: p.cur, partial: p.partial }))} />
            </div>
          ))}
        </div>
      ) : (
        <div style={{ ...sans, fontSize: FS.small, color: MICRO }}>{metrics.length} reported KPIs — click Show all to chart each.</div>
      )}
    </Section>
  );
}

/* ---------- Forecast ---------- */

/** The forecast modes for this company. `Auto` needs actuals to project from; the
 *  rest need a logged forecast. */
/** Forecast tab — every mode the company has data for, behind one switch. "Actuals vs
 *  forecast" is always offered; without a logged forecast it states the gap instead. */
function ForecastPanel({ data, company }) {
  const fcMetrics = forecastMetricsFor(data, company);
  const canProject = metricsFor(data, company).length > 0;

  const modes = [
    { id: "compare", label: "Actuals vs forecast", on: true },
    { id: "auto", label: "Auto-forecast", on: canProject },
  ].filter((m) => m.on);
  const [mode, setMode] = useState("compare");
  const active = modes.some((m) => m.id === mode) ? mode : (modes[0] || {}).id;

  return (
    <div>
      {modes.length > 1 && <div style={{ marginBottom: 14 }}><Segmented options={modes} value={active} onChange={setMode} /></div>}
      {active === "compare" && (fcMetrics.length > 0
        ? <ForecastBlock data={data} company={company} />
        : (
          <Section label="Forecast vs actual">
            <Empty>
              {company.name} has not logged a forecast into Carta Data Collection.
              {canProject ? " Use Auto-forecast for a projection built from its reported actuals." : ""}
            </Empty>
          </Section>
        ))}
      {active === "auto" && <Auto data={data} company={company} />}
    </div>
  );
}


/* ---------- Peers ---------- */

const Empty = ({ children }) => (
  <div className="card" style={{ padding: 24, textAlign: "center", ...sans, fontSize: FS.small, color: MICRO }}>{children}</div>
);

/* ---------- Credit ---------- */

/** Does this company report any debt? Gates the Credit sub-tab — without debt
 *  every leverage ratio is null, and a tab of five dashes is worse than no tab.
 *  Common in debt-heavy portfolios, rare in others — most companies report none. */
function hasDebt(data, company) {
  const lev = leverageForCompany(data, company);
  return lev._inputs.debt != null;
}

function CreditPanel({ data, company, dashboard }) {
  if (!hasDebt(data, company)) {
    return (
      <Section label="Credit & leverage">
        <Empty>No debt reported — leverage ratios need Loans payable (current and long-term) among {company.name}’s KPIs.</Empty>
      </Section>
    );
  }
  const lev = leverageForCompany(data, company);
  const inp = lev._inputs;
  const ebitdaMiss = lev._missing?.ebitda || [];   // quarters still needed for LTM EBITDA
  const ebitdaMissTip = ebitdaMiss.length ? `Trailing-twelve-months EBITDA needs a full year — still missing ${ebitdaMiss.join(", ")}.` : undefined;
  const covenants = (dashboard?.doc?.covenants || []);
  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, alignItems: "start" }}>
        <Section label="Leverage multiples">
          <KVTableRow stats={LEVERAGE_DEFS.map((d) => {
            const usesEbitda = d.key === "debt_ebitda" || d.key === "netdebt_ebitda";
            const miss = lev._missing?.ebitda || [];
            const naFromLtm = usesEbitda && lev[d.key] == null && miss.length > 0;
            return {
              label: d.label,
              value: naFromLtm ? "N/A" : fmtX(lev[d.key]),
              hint: naFromLtm ? ebitdaMissTip : undefined,
            };
          })} />
          <MethodLine>
            Debt = loans payable, current + long-term. Balance-sheet inputs use the latest reported value.
          </MethodLine>
        </Section>

        <Section label="Inputs">
          <KVTableRow stats={[
            { label: "Total debt", value: fmtVal(inp.debt, "Dollar") },
            { label: "Net debt", value: fmtVal(inp.netDebt, "Dollar") },
            { label: "EBITDA (LTM)",
              value: inp.ebitda != null ? fmtVal(inp.ebitda, "Dollar") : ebitdaMiss.length ? "N/A" : "—",
              color: inp.ebitda != null && inp.ebitda < 0 ? NEG : undefined,
              hint: inp.ebitda == null && ebitdaMiss.length ? ebitdaMissTip : undefined },
            { label: "Cash", value: fmtVal(inp.cash, "Dollar") },
            { label: "Total equity", value: fmtVal(inp.equity, "Dollar") },
            { label: "Total assets", value: fmtVal(inp.assets, "Dollar") },
          ]} />
          {inp.ebitda != null && inp.ebitda < 0 && (
            <MethodLine tone="warn">
              EBITDA is negative, so Debt / EBITDA and Net Debt / EBITDA are negative numbers. A negative
              leverage ratio trivially satisfies an “at most 4×” test — read it as not meaningful, not as a pass.
            </MethodLine>
          )}
        </Section>
      </div>

      {covenants.length > 0 && (
        <Section label="Covenants">
          <div className="card" style={{ padding: 16, ...sans, fontSize: FS.small, color: MICRO }}>
            {covenants.length} covenant{covenants.length === 1 ? "" : "s"} defined.{" "}
            <button onClick={() => openPortfolio("covenants")} style={ruleLink}>Open the Formulas tab →</button>
          </div>
        </Section>
      )}
    </div>
  );
}

const MethodLine = ({ children, tone }) => (
  <div style={{ ...sans, fontSize: FS.small, marginTop: 8,
    color: tone === "warn" ? NEG : MICRO }}>{children}</div>
);

/* ---------- Data quality ---------- */

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Reporting health as one line above a KPI table: lateness against the company's
 *  own cadence, the filing facts, then missing-quarter and contradiction counts. */
function ReportingStatusLine({ data, company }) {
  const health = useMemo(() => reportingHealth(data).rows.find((r) => r.id === company.id) || null, [data, company.id]);
  const issues = useMemo(() => dataQualityIssues(data).issues.filter((i) => i.companyId === company.id), [data, company.id]);
  const missing = useMemo(() => missingQuarters(data, company), [data, company]);
  if (!health) return null;
  const tone = health.bucket === "ontime" ? "positive" : health.bucket === "overdue" || health.bucket === "never" ? "negative" : "warning";
  const status = { tone, label: BUCKET_LABEL[health.bucket],
    hint: "Lateness is judged against this company’s own cadence — an annual reporter isn’t late at six months." };
  // Nothing filed: the badge says it all; counts of zero would only add noise.
  if (!health.metricCount) return <StatusLine status={status} />;
  return (
    <StatusLine
      status={status}
      items={[
        health.cadence ? { text: `Reports ${cadenceLabel(health.cadence).toLowerCase()}` } : null,
        { text: `Last filed ${health.last || "—"}` },
        // A filing dated after the data's as-of stamp makes the gap negative — say nothing rather than "-3 months".
        health.monthsSince == null || health.monthsSince < 0 ? null : { text: `${plural(health.monthsSince, "month")} since` },
        { text: `${plural(health.metricCount, "KPI")} filed` },
        { tone: missing.gaps.length ? "warning" : "muted", text: plural(missing.gaps.length, "missing quarter"),
          hint: missing.gaps.length
            ? `No filing for ${missing.gaps.join(", ")} between ${missing.first} and ${missing.last}. Quarters before this company started reporting aren’t counted.`
            : "No gaps since this company started reporting." },
        { tone: issues.length ? "warning" : "muted", text: plural(issues.length, "contradiction"),
          hint: issues.length
            ? issues.map((i) => `${i.check} · ${i.period}: ${i.detail}`).join("\n")
              + "\nInternal contradictions in the company’s own submission — none indicates a Carta error."
            : "No contradictions found in what this company filed." },
      ]} />
  );
}

/** Quarter-ends with no data point, bounded by the company's own first and last
 *  filing — a quarter before they started reporting is not a gap. */
function missingQuarters(data, company) {
  const all = Object.values(company.series || {}).flat().map((p) => p.d).sort();
  if (!all.length) return { gaps: [], first: null, last: null };
  const first = all[0], last = all[all.length - 1];
  const filed = new Set(all);
  const gaps = quartersOf(data).filter((q) => q >= first && q <= last && !filed.has(q));
  return { gaps, first, last };
}

function NotesBlock({ company, dashboard }) {
  const notes = dashboard.doc?.notes || {};
  const value = notes[company.id] || "";
  const onChange = (e) => {
    const v = e.target.value;
    dashboard.update((d) => { d.notes = { ...(d.notes || {}), [company.id]: v }; return d; });
  };
  return (
    <Section label="Notes">
      <textarea value={value} onChange={onChange} placeholder={`Private notes on ${company.name}… (saved automatically)`}
        style={{ ...sans, width: "100%", minHeight: 90, padding: 12, borderRadius: 8, resize: "vertical", fontSize: FS.body,
          border: `1px solid var(--ink-color-global-border-default)`, background: "var(--ink-color-global-surface-background-default)", color: "var(--ink-color-global-text-default)" }} />
    </Section>
  );
}
