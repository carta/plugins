// Coverage — find the gaps in the data. Pick metrics + a quarter window and see
// what's MISSING, two ways:
//   company   detailed company × quarter grid (✓ reported / gap / not-expected)
//   metric    aggregated metric × quarter heatmap (% of companies that reported)
//
// "Missing" = a quarter not covered by any reported point. A quarter counts as a
// GAP only once a company has started reporting that metric (≥ its first covered
// quarter) — earlier quarters are "not expected" and don't count against it, so
// pre-investment periods don't create false gaps. Trailing quarters after a
// company goes dark DO count as gaps (that's the signal you want).
import { Fragment, useCallback, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FS, sans, mono, MICRO, NOTICE } from "../ui/theme.js";
import { withCommas } from "../ui/format.js";
import { trackClick } from "../analytics.js";
import { H2, Dropdown, StatBar, Btn, Checkbox, Glossary, StickyRibbon, HintIcon,
  ChevronDownIcon, CollapseAllIcon, ExpandAllIcon, WarningTriangleIcon, useStickyClone, Z,
  FilterMenu, FilterCheckboxList, FilterRadioList,
  MenuItem, POPOVER_SHADOW, useDismissable, usePortalAnchor } from "../ui/components.jsx";
import { Heatmap } from "../ui/charts.jsx";
import { metricOptions, metricOf, pointsFor, cartaFirmUrl } from "../model/kpi.js";
import {
  coversQuarter, settledQuarter, reportingHealth, BUCKET_LABEL, dataQualityIssues, CHECKS,
} from "../model/review.js";
import { openCompany } from "../state/focus.js";

const isQuarterEnd = (d) => ["-03-", "-06-", "-09-", "-12-"].some((q) => String(d).includes(q));
const csv = (s) => (/[",\n]/.test(String(s)) ? `"${String(s).replace(/"/g, '""')}"` : String(s));
const download = (lines, name) => {
  const url = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv" }));
  const a = document.createElement("a");
  a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
};
const QT = { "03": "Q1", "06": "Q2", "09": "Q3", "12": "Q4" };
const qLabel = (p) => `${QT[String(p).slice(5, 7)] || String(p).slice(5, 7)} '${String(p).slice(2, 4)}`;

const nameBtn = { ...sans, border: "none", background: "transparent", padding: 0, cursor: "pointer", fontWeight: 600, fontSize: "inherit", color: "var(--ink-color-global-link-default)", textAlign: "left" };
const GAP_BG = "rgba(229,36,49,0.13)", GAP_FG = "var(--ink-color-global-feedback-negative-strong)";
const OK_BG = "rgba(45,158,144,0.12)", OK_FG = "var(--ink-color-global-feedback-positive-strong)";
const NA_FG = "var(--ink-color-global-border-default)";
const WARN_FG = NOTICE; // this app's one canonical warning color (Badge's `warning` tone uses the same token)

const CHECK_BY_ID = Object.fromEntries(CHECKS.map((ch) => [ch.id, ch]));
/** Same language the check itself uses (label + hint), grouped by check so one
 *  metric flagged by two different checks gets two clearly separated blocks. */
function issueTooltip(issues) {
  const byCheck = new Map();
  for (const i of issues) {
    if (!byCheck.has(i.check)) byCheck.set(i.check, []);
    byCheck.get(i.check).push(i);
  }
  return Array.from(byCheck.entries()).map(([checkId, list]) => {
    const ch = CHECK_BY_ID[checkId];
    const label = ch.label.charAt(0).toLowerCase() + ch.label.slice(1);
    const periods = list.map((i) => i.period).join(", ");
    return `Warning: ${label}\n\nAffected period${list.length === 1 ? "" : "s"}: ${periods}`;
  }).join("\n\n");
}
/** Little warning glyph next to a KPI name — hover to see which data-quality
 *  check(s) flagged it, in the check's own language. `firmUrl` is null until the
 *  company-specific deep link ships; the ledger link is left off the tooltip until then. */
const IssueWarningIcon = ({ issues, firmUrl }) => (
  <HintIcon hint={issueTooltip(issues)} label={`${issues.length} data quality issue${issues.length === 1 ? "" : "s"}`}
    icon={WarningTriangleIcon} color={WARN_FG} iconSize={13} strokeWidth={2}
    linkHref={firmUrl} linkText="Visit Carta" linkSuffix=" to edit these KPIs." />
);

/** Review — is the data all there, and does what's there check out. */
export default function Coverage({ data, dashboard }) {
  return (
    // H2 carries no margin of its own, so the gap here supplies the space under it.
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <H2>Reporting health</H2>
      <Completeness data={data} />
    </div>
  );
}

/* ================= Completeness ================= */
// One view for "is the data all there?", grouped two ways:
//   company  an expandable per-company list — each row is the company's
//            cadence-aware reporting status (the old Reporting health), and
//            expands to its company × quarter ✓/✕ grid (the old By company).
//   metric   the aggregated metric × quarter heatmap (the old By metric).

const GLOSS_COMPLETENESS = [
  { term: "A gap only counts after a company starts reporting", short: "pre-investment quarters aren't held against anyone",
    body: "A quarter counts as a gap only once a company has reported that KPI at least once — earlier quarters are \"not expected\" and don't count against it. Trailing quarters after a company goes dark DO count as gaps; that's the signal you want." },
  { term: "Late is measured against each company's own cadence", short: "an annual reporter isn't late at 6 months",
    body: "Companies report at different frequencies. Each company's status is judged against ITS OWN inferred cadence, so an annual reporter isn't flagged the moment a quarterly reporter would be. That keeps the companies that genuinely went quiet at the top." },
  { term: "Badly overdue / Never reported", short: "the two lists to chase",
    body: "\"Badly overdue\" is more than three of a company's own reporting periods late — roughly a year for a quarterly reporter. \"Never reported\" means it's in the book but has submitted no KPI data at all, usually a recent investment not yet onboarded to data collection." },
  { term: "The warning icon checks what companies reported", short: "not a Carta error",
    body: "It flags an internal contradiction in the figures a company submitted — a balance sheet that doesn't balance, a value that jumped tenfold — never a claim that Carta stored or calculated something wrong. Treat a flagged KPI as unverified, and use the tooltip to see what to ask the company about." },
  { term: "1% tolerance on accounting identities", short: "rounding is ignored",
    body: "Statements are reported rounded, so identities like assets = liabilities + equity are checked with a 1% tolerance — loose enough to ignore rounding, tight enough that a genuinely broken statement still trips it." },
  { term: "Why it matters", short: "these numbers feed everything else",
    body: "A balance sheet that doesn't balance means that company's assets, liabilities or equity is wrong — and every ratio built on them elsewhere in this app inherits the error. Treat flagged companies' affected KPIs as unverified rather than wrong." },
];

const BUCKET_TONE = { ontime: "positive", late1: "neutral", late23: "warning", overdue: "negative", never: "neutral", unknown: "neutral" };
// A compact status dot keeps the by-company grid uncluttered; the full label is
// the dot's tooltip / aria-label.
const TONE_DOT = {
  positive: "var(--ink-color-global-feedback-positive-strong)",
  negative: "var(--ink-color-global-feedback-negative-strong)",
  warning: WARN_FG,
  neutral: "var(--ink-color-global-border-strong, var(--ink-color-global-text-subtle))",
};
const GROUP_OPTS = [{ id: "company", label: "Company" }, { id: "metric", label: "KPI" }];

// The metrics a fund watches first. Alphabetical defaults surface "Exit Date
// Estimate" ahead of Revenue, which is what a glance at the heatmap should show.
const CORE_METRIC_PATTERNS = [/^revenue$/i, /ebitda/i, /^cash( and cash equivalents)?$/i, /net income/i, /gross profit/i, /headcount|employees/i];

/** Default selection for the completeness grid: core KPIs in CORE_METRIC_PATTERNS
 *  order, then the remaining options in their own order, capped at `max`. */
export function defaultCompletenessMetrics(metricOpts, max = 6) {
  const picked = [];
  for (const re of CORE_METRIC_PATTERNS) {
    const hit = metricOpts.find((o) => re.test(o.label) && !picked.includes(o.id));
    if (hit) picked.push(hit.id);
  }
  for (const o of metricOpts) if (picked.length < max && !picked.includes(o.id)) picked.push(o.id);
  return new Set(picked.slice(0, max));
}

function Completeness({ data }) {
  const metrics = data.metrics || [];
  const metricOpts = useMemo(() => metricOptions(metrics), [metrics]);
  const defaultMetrics = useMemo(() => defaultCompletenessMetrics(metricOpts), [metricOpts]);
  const [selMetrics, setSelMetrics] = useState(defaultMetrics);
  const [fund, setFund] = useState("ALL");
  const [win, setWin] = useState(8);
  const [groupBy, setGroupBy] = useState("company");
  const [gapsOnly, setGapsOnly] = useState(false);
  const [selStatuses, setSelStatuses] = useState(() => new Set()); // health-bucket filter; empty = all
  // Trailing quarters that have not settled yet. Hidden by default, one toggle to include.
  const [includeFiling, setIncludeFiling] = useState(false);

  // Sticky ribbon, per PivotDashboard: height offsets ByCompany's clone header.
  const ribbonObsRef = useRef(null);
  const [ribbonH, setRibbonH] = useState(0);
  const ribbonRef = useCallback((el) => {
    if (ribbonObsRef.current) { ribbonObsRef.current.disconnect(); ribbonObsRef.current = null; }
    if (!el) return;
    const ro = new ResizeObserver(() => setRibbonH(el.getBoundingClientRect().height));
    ro.observe(el);
    ribbonObsRef.current = ro;
  }, []);

  const allFunds = data.dimensions?.funds || [];
  const fundOpts = [{ id: "ALL", label: "All funds" }, ...allFunds.map((f, i) => ({ id: f, label: f, separatorBefore: i === 0 }))];

  // all quarter-ends ever (for each company's first-covered quarter), and the
  // visible window (trailing `win` quarters, newest-first for display).
  const allQ = useMemo(() => (data.dimensions?.periods || []).slice().sort().filter(isQuarterEnd), [data]);
  const { quarter: settledQ, settled: newestSettled } = settledQuarter(data);
  const periods = useMemo(() => {
    let ps = allQ.filter((q) => includeFiling || settledQ == null || q <= settledQ);
    if (win !== "all" && ps.length > win) ps = ps.slice(ps.length - win);
    return ps; // ascending
  }, [allQ, win, includeFiling, settledQ]);
  const newestIsFiling = settledQ != null && !newestSettled;
  const cols = periods.slice().reverse(); // newest-first for the grid columns

  const selKeys = metricOpts.filter((o) => selMetrics.has(o.id)).map((o) => o.id);
  const companies = useMemo(() => (data.companies || [])
    .filter((c) => fund === "ALL" || (c.funds || []).includes(fund)), [data, fund]);

  // Indexed by companyId+metric so a KPI row can flag itself; one issue can
  // implicate more than one metric (a balance-sheet mismatch touches three).
  const qualityIssues = useMemo(() => dataQualityIssues(data), [data]);
  const issuesByCoMetric = useMemo(() => {
    const m = new Map();
    for (const i of qualityIssues.issues) {
      for (const key of i.metricKeys) {
        const mapKey = `${i.companyId}::${key}`;
        if (!m.has(mapKey)) m.set(mapKey, []);
        m.get(mapKey).push(i);
      }
    }
    return m;
  }, [qualityIssues]);

  // one row per (company, selected metric). A metric a company has never
  // reported is all dashes, not gaps — there's no "should report" source of truth.
  const rows = useMemo(() => {
    const out = [];
    for (const c of companies) {
      const anySeries = Object.values(c.series || {});
      const firstEver = allQ.find((qd) => anySeries.some((s) => coversQuarter(s, qd))) || null;
      // Never reported anything: one summary row (not one per selected metric),
      // neutral rather than a gap — there was never a metric to miss.
      if (!firstEver) {
        const cells = {};
        for (const qd of periods) cells[qd] = "na";
        out.push({ companyId: c.id, metricKey: "__none__", metricLabel: "No KPIs reported", cells, reported: 0, gaps: 0 });
        continue;
      }
      for (const key of selKeys) {
        const pts = pointsFor(c, key);
        const cells = {}; let reported = 0, gaps = 0;
        if (!pts.length) {
          // Never reported this metric — not applicable, not a missed quarter.
          for (const qd of periods) cells[qd] = "na";
        } else {
          const firstCovered = allQ.find((qd) => coversQuarter(pts, qd)) || firstEver;
          for (const qd of periods) {
            if (firstCovered && qd < firstCovered) { cells[qd] = "na"; continue; }
            if (coversQuarter(pts, qd)) { cells[qd] = "ok"; reported++; }
            else { cells[qd] = "gap"; gaps++; }
          }
        }
        const issues = issuesByCoMetric.get(`${c.id}::${key}`) || [];
        out.push({ companyId: c.id, metricKey: key, metricLabel: (metricOf(data, key) || {}).label || key, cells, reported, gaps, issues });
      }
    }
    return out;
  }, [companies, selKeys, periods, allQ, data, issuesByCoMetric]);

  // cadence-aware reporting status per company (the old Reporting health), joined
  // to each company's grid rows so one list carries both status and detail.
  const { rows: healthRows, buckets } = useMemo(() => reportingHealth(data), [data]);
  const gridByCo = useMemo(() => {
    const m = new Map();
    for (const r of rows) { if (!m.has(r.companyId)) m.set(r.companyId, []); m.get(r.companyId).push(r); }
    return m;
  }, [rows]);
  const companyList = useMemo(() => {
    const inFund = new Set(companies.map((c) => c.id));
    return healthRows
      .filter((h) => inFund.has(h.id))
      .filter((h) => selStatuses.size === 0 || selStatuses.has(h.bucket))
      .map((h) => {
        let grid = gridByCo.get(h.id) || [];
        const gaps = grid.reduce((s, r) => s + r.gaps, 0);
        if (gapsOnly) grid = grid.filter((r) => r.gaps > 0); // hide fully-covered rows
        return { ...h, grid, gaps };
      })
      .filter((c) => !gapsOnly || c.gaps > 0);
  }, [healthRows, companies, gridByCo, selStatuses, gapsOnly]);

  // aggregated per-metric coverage (for the heatmap)
  const metricAgg = useMemo(() => selKeys.map((key) => {
    const cells = {}; let rep = 0, exp = 0;
    for (const qd of periods) {
      let covered = 0, expected = 0;
      for (const c of companies) {
        const pts = pointsFor(c, key);
        if (!pts.length) continue;
        const firstCovered = allQ.find((q) => coversQuarter(pts, q));
        if (!firstCovered || qd < firstCovered) continue; // not expected for this co yet
        expected++;
        if (coversQuarter(pts, qd)) covered++;
      }
      cells[qd] = expected ? covered / expected : null;
      rep += covered; exp += expected;
    }
    return { key, label: (metricOf(data, key) || {}).label || key, cells, pct: exp ? rep / exp : null };
  }), [selKeys, periods, companies, allQ, data]);

  const statusOpts = ["overdue", "never", "late23", "late1", "ontime"].filter((b) => buckets[b])
    .map((b) => ({ id: b, label: BUCKET_LABEL[b], sub: buckets[b] }));

  const PERIOD_OPTS = [{ id: 4, label: "4 quarters" }, { id: 8, label: "8 quarters" }, { id: 12, label: "12 quarters" }, { id: "all", label: "All quarters" }];
  const filterSections = [
    ...(allFunds.length > 0 ? [{ key: "fund", label: "Fund", value: fund, onChange: setFund, resetValue: "ALL",
      count: (v) => (v !== "ALL" ? 1 : 0),
      chipLabel: (v) => `Fund: ${fundOpts.find((o) => o.id === v)?.label || v}`,
      render: (v, setV) => <FilterRadioList name="coverage-fund" options={fundOpts} value={v} onChange={setV} /> }] : []),
    { key: "metrics", label: "KPIs", value: selMetrics, onChange: setSelMetrics, resetValue: defaultMetrics,
      count: (v) => v.size, pinned: true,
      chipLabel: (v) => `KPIs: ${v.size}`,
      render: (v, setV) => <FilterCheckboxList options={metricOpts} selected={v} onChange={setV} searchPlaceholder="Search KPIs" /> },
    { key: "periods", label: "Periods", value: win, onChange: setWin, resetValue: 8,
      count: (v) => (v !== 8 ? 1 : 0),
      chipLabel: (v) => `Periods: ${v === "all" ? "All" : v}`,
      render: (v, setV) => <FilterRadioList name="coverage-periods" options={PERIOD_OPTS} value={v} onChange={setV} /> },
    ...(groupBy === "company" ? [{ key: "status", label: "Reporting status", value: selStatuses, onChange: setSelStatuses, resetValue: new Set(),
      count: (v) => v.size,
      chipLabel: (v) => `Status (${v.size})`,
      render: (v, setV) => statusOpts.length
        ? <FilterCheckboxList options={statusOpts} selected={v} onChange={setV} searchMin={99} />
        : <p style={{ ...sans, fontSize: FS.bodyLg, color: MICRO, margin: 0 }}>No companies to filter by.</p> }] : []),
    ...(groupBy === "company" ? [{ key: "gaps", label: "Reporting gaps", value: gapsOnly, onChange: setGapsOnly, resetValue: false,
      count: (v) => (v ? 1 : 0),
      chipLabel: () => "Only with gaps",
      render: (v, setV) => <FilterRadioList name="coverage-gaps" value={v} onChange={setV} options={[
        { id: true, label: "Only show companies with reporting gaps" },
        { id: false, label: "Show all companies" },
      ]} /> }] : []),
    ...(newestIsFiling ? [{ key: "inprogress", label: "In-progress", value: includeFiling, onChange: setIncludeFiling, resetValue: false,
      count: (v) => (v ? 1 : 0),
      chipLabel: () => "In-progress",
      render: (v, setV) => (
        <label style={{ ...sans, display: "flex", alignItems: "flex-start", gap: 10, fontSize: 14, lineHeight: "20px", color: "var(--ink-color-global-text-default)", cursor: "pointer" }}>
          <Checkbox checked={v} onChange={(e) => setV(e.target.checked)} style={{ marginTop: 2 }} />
          Include in-progress quarter
        </label>
      ) }] : []),
  ];
  // Derived from `filterSections`; FilterMenu itself decides whether a
  // pinned chip's × shows, by comparing `value` against `resetValue`.
  const filterChips = filterSections
    .filter((s) => s.pinned || s.count(s.value) > 0)
    .map((s) => ({ key: s.key, label: s.chipLabel(s.value), pinned: s.pinned, onClear: () => s.onChange(s.resetValue) }));
  const resetAllFilters = () => {
    setFund("ALL"); setSelMetrics(defaultMetrics); setWin(8);
    setSelStatuses(new Set()); setGapsOnly(false); setIncludeFiling(false);
  };

  const exportGaps = () => {
    trackClick("PortfolioAnalytics.Coverage.ExportGaps");
    const lines = ["Company,KPI,Missing quarter"];
    const nameOf = new Map((data.companies || []).map((c) => [c.id, c.name]));
    for (const r of rows) for (const qd of periods) if (r.cells[qd] === "gap") lines.push([csv(nameOf.get(r.companyId) || r.companyId), csv(r.metricLabel), qd].join(","));
    download(lines, `${(data.source?.slug || "kpi")}-coverage-gaps.csv`);
  };
  const exportChase = () => {
    trackClick("PortfolioAnalytics.Coverage.ExportChaseList");
    const lines = ["Company,Last reported,Cadence,Status,Months since,KPIs reported"];
    for (const c of companyList) lines.push([csv(c.name), c.last || "", c.cadence || "", BUCKET_LABEL[c.bucket], c.monthsSince ?? "", c.metricCount].join(","));
    download(lines, `${(data.source?.slug || "kpi")}-reporting-health.csv`);
  };
  const exportIssues = () => {
    trackClick("PortfolioAnalytics.Coverage.ExportIssues");
    const lines = ["Check,Company,Period,Detail"];
    for (const ch of qualityIssues.byCheck) for (const i of ch.issues) lines.push([csv(ch.label), csv(i.company), i.period, csv(i.detail)].join(","));
    download(lines, `${(data.source?.slug || "kpi")}-data-quality.csv`);
  };

  const firmUrl = cartaFirmUrl(data);

  return (
    <div>
      <StatBar title="Reporting status" style={{ marginTop: 8, marginBottom: 16 }} basis={150} stats={[
        { label: "On time", value: buckets.ontime || 0 },
        { label: "Late", value: (buckets.late1 || 0) + (buckets.late23 || 0) },
        { label: "Badly overdue", value: buckets.overdue || 0 },
        { label: "Never reported", value: buckets.never || 0 },
        { label: "Data quality issues", value: qualityIssues.total,
          hint: `Total data quality issues found. ${qualityIssues.affected} compan${qualityIssues.affected === 1 ? "y" : "ies"} had at least one flagged period.`,
          linkHref: firmUrl, linkText: "Visit Carta", linkSuffix: " to edit these KPIs." },
      ]} />

      <StickyRibbon ref={ribbonRef}>
        <Dropdown options={GROUP_OPTS} value={groupBy} onChange={(g) => { trackClick("PortfolioAnalytics.Coverage.SetGroupBy"); setGroupBy(g); }} triggerLabel="Group by" minWidth={150} portal />
        <FilterMenu sections={filterSections} chips={filterChips} onResetAll={resetAllFilters} portal />
        <ExportMenu onExportChase={exportChase} onExportGaps={exportGaps} onExportIssues={exportIssues} />
      </StickyRibbon>

      {groupBy === "metric" ? (
        selKeys.length === 0
          ? <div className="card" style={{ padding: 28, textAlign: "center", color: MICRO, ...sans }}>Pick one or more KPIs to see their completeness.</div>
          : <ByMetric metricAgg={metricAgg} cols={cols} ribbonOffset={ribbonH} />
      ) : (
        <ByCompany companies={companyList} cols={cols} ribbonOffset={ribbonH} firmUrl={firmUrl} />
      )}

      <Glossary items={GLOSS_COMPLETENESS} style={{ marginTop: 20 }} />
    </div>
  );
}

// All three exports are always offered, regardless of the current `groupBy`.
function ExportMenu({ onExportChase, onExportGaps, onExportIssues }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const panelRef = useRef(null);
  useDismissable(open, setOpen, [ref, panelRef]);
  const anchorRect = usePortalAnchor(open, ref);
  const MENU_W = 220;
  const pos = anchorRect && { top: anchorRect.bottom + 4, left: Math.max(8, Math.min(anchorRect.right - MENU_W, window.innerWidth - MENU_W - 8)) };
  return (
    <div style={{ marginLeft: "auto" }}>
      <Btn ref={ref} size="toolbar" onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open}>
        Export <ChevronDownIcon size={16} strokeWidth={1.5} />
      </Btn>
      {open && createPortal(
        <div ref={panelRef} role="menu" className="popin" style={{ position: "fixed", top: pos?.top ?? 0, left: pos?.left ?? 0, width: MENU_W,
          visibility: pos ? "visible" : "hidden", background: "var(--ink-color-global-surface-background-default)",
          border: "1px solid var(--ink-color-global-border-subtle)", borderRadius: 6, boxShadow: POPOVER_SHADOW, zIndex: Z.popover, padding: "4px 0" }}>
          <MenuItem role="menuitem" onClick={() => { setOpen(false); onExportChase(); }}>Export chase list (CSV)</MenuItem>
          <MenuItem role="menuitem" onClick={() => { setOpen(false); onExportGaps(); }}>Export gaps (CSV)</MenuItem>
          <MenuItem role="menuitem" onClick={() => { setOpen(false); onExportIssues(); }}>Export issues (CSV)</MenuItem>
        </div>,
        document.body,
      )}
    </div>
  );
}

/* ---------- By company: flat status + coverage grid ---------- */
// Status is a left-side tag spanning each company's metric rows. Companies that
// report none of the selected metrics still show as a status-only row.
const cellStyle = (state) => {
  if (state === "ok") return { bg: OK_BG, fg: OK_FG, ch: "✓" };
  if (state === "gap") return { bg: GAP_BG, fg: GAP_FG, ch: "✕" };
  return { bg: "transparent", fg: NA_FG, ch: "—" }; // not expected
};

// Four frozen columns (chevron, company, status, KPI); Gaps and the quarters
// scroll. Every width is real/fixed (table-layout: fixed + colgroup) so rows never reflow it.
const CHEVRON_W = 28, NAME_W = 220, STATUS_W = 140, KPI_W = 200, GAPS_W = 64, QUARTER_W = 62;
const NAME_LEFT = CHEVRON_W, STATUS_LEFT = CHEVRON_W + NAME_W, KPI_LEFT = STATUS_LEFT + STATUS_W;

function ByCompany({ companies, cols, ribbonOffset = 0, firmUrl }) {
  const [collapsed, setCollapsed] = useState(() => new Set());
  const wrapRef = useRef(null);
  const tableRef = useRef(null);
  const clone = useStickyClone(wrapRef, tableRef, ribbonOffset);
  if (!companies.length) return <div className="card" style={{ padding: 28, textAlign: "center", color: MICRO, ...sans }}>No companies match this filter.</div>;

  const toggleCompany = (id) => setCollapsed((prev) => {
    const n = new Set(prev);
    n.has(id) ? n.delete(id) : n.add(id);
    return n;
  });
  // Same toggle-all convention as PivotDashboard's own company grouping.
  const collapsibleIds = companies.filter((c) => c.metricCount > 0).map((c) => c.id);
  const anyCollapsed = collapsed.size > 0;
  const toggleAll = () => setCollapsed(anyCollapsed ? new Set() : new Set(collapsibleIds));

  // Shared between the real <thead> and its floating clone so the two markups
  // can't drift apart — same pattern as PivotDashboard's renderCompanyLabel.
  const renderHead = () => (
    <tr>
      <th className="frozen-col" style={{ position: "sticky", left: 0, zIndex: 2, width: CHEVRON_W, minWidth: CHEVRON_W, textAlign: "center", boxShadow: "none" }}>
        {collapsibleIds.length > 0 && (
          <button onClick={toggleAll} aria-label={anyCollapsed ? "Expand all" : "Collapse all"}
            title={anyCollapsed ? "Expand every company" : "Collapse every company to just its first KPI"}
            style={{ border: "none", background: "transparent", padding: 0, cursor: "pointer", display: "inline-flex", alignItems: "center", height: 24, color: "var(--ink-color-global-text-subtle)" }}>
            {anyCollapsed ? <ExpandAllIcon size={16} strokeWidth={1.5} /> : <CollapseAllIcon size={16} strokeWidth={1.5} />}
          </button>
        )}
      </th>
      <th className="frozen-col" style={{ position: "sticky", left: NAME_LEFT, zIndex: 2, width: NAME_W, textAlign: "left", boxShadow: "none" }}>Company</th>
      <th className="frozen-col" style={{ position: "sticky", left: STATUS_LEFT, zIndex: 2, width: STATUS_W, textAlign: "left", boxShadow: "none" }}>Reporting status</th>
      <th className="frozen-col" style={{ position: "sticky", left: KPI_LEFT, zIndex: 2, width: KPI_W, textAlign: "left" }}>KPI</th>
      <th style={{ textAlign: "right", width: GAPS_W }}>Gaps</th>
      {cols.map((p) => <th key={p} style={{ textAlign: "center", width: QUARTER_W }}>{qLabel(p)}</th>)}
    </tr>
  );
  // No table width set: it sizes to the sum of these fixed columns, and the
  // wrapper scrolls horizontally past that — same pattern as this app's other wide tables.
  const colWidths = [CHEVRON_W, NAME_W, STATUS_W, KPI_W, GAPS_W, ...cols.map(() => QUARTER_W)];

  return (
    <div>
      <div ref={wrapRef} style={{ overflowX: "auto", overflowY: "hidden" }}>
        <table ref={tableRef} className="ledger sheet" style={{ tableLayout: "fixed" }}>
          <colgroup>{colWidths.map((w, i) => <col key={i} style={{ width: w }} />)}</colgroup>
          <thead>{renderHead()}</thead>
          <tbody>
            {companies.map((c) => {
              // A chevron only makes sense once there's something to collapse — a
              // company that has never reported anything gets none.
              const hasChevron = c.metricCount > 0;
              const isCollapsed = hasChevron && collapsed.has(c.id);
              // Collapsed shrinks all of the company's metric rows to one summary
              // row ("N KPIs hidden") — none stay visible, so N is every row.
              const hiddenCount = c.grid.length;
              const disp = !c.grid.length ? [null] : isCollapsed
                ? [{ collapsed: true, metricKey: "__collapsed__",
                    metricLabel: `${hiddenCount} KPI${hiddenCount === 1 ? "" : "s"} hidden` }]
                : c.grid;
              return (
                <Fragment key={c.id}>
                  {disp.map((r, i) => (
                    <tr key={r ? r.metricKey : "none"}>
                      {i === 0 && (
                        <td rowSpan={disp.length > 1 ? disp.length : undefined} className="frozen-col" style={{ position: "sticky", left: 0, zIndex: 1, verticalAlign: "top", textAlign: "center", boxShadow: "none" }}>
                          {hasChevron && (
                            <button onClick={() => toggleCompany(c.id)} aria-label={isCollapsed ? "Expand company" : "Collapse company"} title={isCollapsed ? "Expand" : "Collapse"}
                              style={{ border: "none", background: "transparent", padding: 0, cursor: "pointer", display: "inline-flex", alignItems: "center", height: 24, color: "var(--ink-color-global-text-subtle)" }}>
                              <ChevronDownIcon size={16} strokeWidth={1.5}
                                style={{ transform: isCollapsed ? "rotate(-90deg)" : "none", transition: "transform .12s" }} />
                            </button>
                          )}
                        </td>
                      )}
                      {i === 0 && (
                        <td rowSpan={disp.length > 1 ? disp.length : undefined} className="frozen-col" style={{ position: "sticky", left: NAME_LEFT, zIndex: 1, verticalAlign: "top", whiteSpace: "nowrap", boxShadow: "none" }}>
                          <button onClick={() => openCompany(c.id)} title={c.name} style={{ ...nameBtn, fontWeight: 400, width: "100%", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.name}</button>
                        </td>
                      )}
                      {i === 0 && (
                        <td rowSpan={disp.length > 1 ? disp.length : undefined} className="frozen-col" style={{ position: "sticky", left: STATUS_LEFT, zIndex: 1, verticalAlign: "top", textAlign: "left", boxShadow: "none" }}>
                          {/* Ink's real "mini status" pattern: dot + label, no font-size
                              of its own — inherits the ledger's 14px. */}
                          <span style={{ display: "inline-flex", alignItems: "baseline", gap: 6, ...sans, color: "var(--ink-color-global-text-default)" }}>
                            <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: "50%", display: "inline-block", position: "relative", bottom: 1, flexShrink: 0, background: TONE_DOT[BUCKET_TONE[c.bucket]] }} />
                            <span style={{ whiteSpace: "normal" }}>{BUCKET_LABEL[c.bucket]}</span>
                          </span>
                        </td>
                      )}
                      {r ? (
                        <>
                          {/* paddingLeft pinned: on a continuation row (i>0) this td is the DOM's
                              actual first child (the frozen cells render only at i===0), which
                              would otherwise pick up .sheet's larger td:first-child padding. */}
                          <td className="frozen-col" style={{ position: "sticky", left: KPI_LEFT, zIndex: 1, textAlign: "left", paddingLeft: 6, color: r.collapsed ? "var(--ink-color-global-text-subtle)" : "var(--ink-color-global-text-default)" }}>
                            <span style={{ display: "inline-flex", alignItems: "center", gap: 5, maxWidth: "100%" }}>
                              <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.metricLabel}</span>
                              {r.issues?.length > 0 && <IssueWarningIcon issues={r.issues} firmUrl={firmUrl} />}
                            </span>
                          </td>
                          <td style={{ textAlign: "right", ...mono, color: r.gaps ? "var(--ink-color-global-text-default)" : NA_FG }}>{r.collapsed ? "" : (r.gaps || "—")}</td>
                          {cols.map((p) => {
                            if (r.collapsed) return <td key={p} />;
                            const cc = cellStyle(r.cells[p]); return (
                              <td key={p} style={{ textAlign: "center", background: cc.bg, color: cc.fg, fontWeight: 700, ...mono }}>{cc.ch}</td>
                            );
                          })}
                        </>
                      ) : (
                        <td colSpan={cols.length + 2} style={{ textAlign: "left", ...sans, fontSize: FS.small, color: MICRO }}>
                          {c.metricCount === 0 ? "No KPIs reported" : "No data for selected KPIs"}
                        </td>
                      )}
                    </tr>
                  ))}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      {clone && createPortal(
        // Portaled to document.body, outside the app root's inline font-family —
        // must set its own or it silently falls back to the browser's serif default.
        <div ref={clone.scrollRef} style={{ position: "fixed", top: clone.top, left: clone.left, width: clone.width, overflow: "hidden", zIndex: Z.stickyClone, ...sans }}>
          <table className="ledger sheet sticky-clone" style={{ position: "static" }}>
            <colgroup>{clone.cols.map((w, i) => <col key={i} style={{ width: w }} />)}</colgroup>
            <thead>{renderHead()}</thead>
          </table>
        </div>,
        document.body,
      )}
    </div>
  );
}

/* ---------- By metric: aggregated completeness heatmap ---------- */
function ByMetric({ metricAgg, cols, ribbonOffset = 0 }) {
  // Heatmap expects a signed value centered on 0 (red→green). Map coverage
  // fraction f (0..1) → 2f−1 so 0% is fully red, 100% fully green, 50% neutral.
  const rows = metricAgg.map((m) => ({ id: m.key, label: m.label,
    cells: Object.fromEntries(cols.map((p) => [p, m.cells[p] == null ? null : (m.cells[p] * 2 - 1)])) }));
  const heatCols = cols.map((p) => ({ key: p, label: qLabel(p) }));
  return (
    <Heatmap chartId="coverage-heatmap" rows={rows} cols={heatCols} absMax={1} rowHeader="KPI" labelW={200}
      rowHeaderHint="Percentage of reporting companies that reported each quarter." ribbonOffset={ribbonOffset}
      valueFmt={(v) => withCommas(Math.round((v + 1) / 2 * 100)) + "%"} />
  );
}

