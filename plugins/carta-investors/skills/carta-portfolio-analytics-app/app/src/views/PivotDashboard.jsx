// Dashboard (default tab) — a pivot/matrix of every company × KPI down the rows
// and the period timeline across the columns. Filterable by metric, fund,
// company, period window, and granularity. Export to CSV.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FS, sans, mono, MICRO } from "../ui/theme.js";
import { trackClick } from "../analytics.js";
import { H2, Dropdown, Segmented, Toggle, SearchInput, TextInput, Btn, Badge, Modal, Eyebrow, StickyRibbon,
  ddTriggerStyle, ChevronDownIcon, CollapseAllIcon, ExpandAllIcon, DeltaText, useDismissable, useStickyClone, usePortalAnchor, Z, POPOVER_SHADOW } from "../ui/components.jsx";
import { fmtVal, fmtFull, shortDate, TrendSparkline, TREND_SPARK_W } from "../ui/charts.jsx";
import { metricsFor, metricOptions, metricOf, pointNearMonthsBack, metricCadence,
  seriesPoints, forecastSeriesPoints, forecastPeriods, forecastMetricsFor,
  isQualitative, kindRank, quarterlyMonthlyGap } from "../model/kpi.js";
import { customSignalsForCompany, OPS } from "../model/rules.js";
import { signalsForCompany, BUILTIN_SIGNALS } from "../model/signals.js";
import { availablePositionMetrics, positionMetricOptions, positionMetricOf } from "../model/position.js";
import { cellFormat, formatSummary, isGrowthBasis, isRowScope, statsOf, SCALES, RULE_COLORS } from "../model/cellFormat.js";
import { allTags, tagId, tagsFor, companyMatchesTags, hasCartaTags } from "../model/tags.js";
import { STATUS_CAT } from "../model/status.js";
import { CompanyTags } from "../ui/tags.jsx";
import { FavoriteStar } from "../ui/favorites.jsx";
import { isFavorite, favoriteCount } from "../model/favorites.js";
import { openCompany } from "../state/focus.js";
import { withCommas } from "../ui/format.js";

const EMPTY_RULES = [];
const NEG = "var(--ink-color-global-feedback-negative-strong)";
const POS = "var(--ink-color-global-feedback-positive-strong)";
// Sticky left-column widths — the KPI column's sticky offset must equal the
// company column's width, so both read from these constants (no drift).
const CO_W = 210, KPI_W = 240, POS_W = 104;
// Trend column: wide enough for the "Trend over time" header at 14px.
const TREND_W = 152;
// Chevron + gap + favorite star, reserved so a company's name starts at the
// same x whether or not its star renders. Header label and tags share this inset.
const NAME_ICONS_W = 35;
const NAME_INSET = NAME_ICONS_W + 5;
// Company-block boundary. On the cells (not the <tr>) so it paints full-width under
// border-collapse:separate; same weight/color as the header's own rule (stickyHead).
const GROUP_DIVIDER = "1px solid var(--ink-color-global-border-default)";
const GROUP_PAD_TOP = 18; // vs the normal 9px — breathing room above each company
// Right-edge divider on the last frozen column, marking where it ends and the
// scrolling period columns begin — shared so header/body/clone can't drift apart.
const LAST_FROZEN_DIVIDER = "inset -1px 0 0 var(--ink-color-global-border-default)";
// Every period column is this exact width so the grid reads as a uniform ledger.
// Prose answers are clipped to it (ellipsis + hover) rather than widening the column.
const PERIOD_W = 120;

const isQuarterEnd = (d) => ["-03-", "-06-", "-09-", "-12-"].some((q) => String(d).includes(q));

export default function PivotDashboard({ data, dashboard }) {
  const metrics = data.metrics || [];
  const allFunds = data.dimensions?.funds || [];
  // The saved doc carries your own tags; the tag filter and the row chips both
  // read it, so it has to be a dependency of the row memo.
  const dashDoc = dashboard?.doc;
  const companyById = useMemo(() => new Map((data.companies || []).map((c) => [c.id, c])), [data]);
  // The full id universes for the two default-all filters, and whether the current
  // selection still covers every one — snapshots canonicalize "all" back to [].
  const allMetricKeys = useMemo(() => metrics.map((m) => m.key), [metrics]);
  const allCompanyIds = useMemo(() => (data.companies || []).map((c) => c.id), [data]);

  // Qualitative KPIs lead each company's rows; the rest stay alphabetical. A status
  // a GP reads first must not sit 20 rows down. Drag-to-reorder still overrides this.
  const defaultKeys = (keys) => [...keys].sort((a, b) => {
    const ma = metricOf(data, a) || {}, mb = metricOf(data, b) || {};
    return kindRank(ma) - kindRank(mb) || (ma.label || "").localeCompare(mb.label || "");
  });
  // Position metrics (ownership %, MOIC, deal IRR …) are a separate axis from the
  // KPIs: they describe the firm's stake rather than the company's operations, and
  // they're single point-in-time facts, not series. Default OFF — the Dashboard's
  // job is the KPI grid, and silently prepending position rows would change what
  // every saved view means.
  const posAvailable = useMemo(() => availablePositionMetrics(data), [data]);
  const posOrder = useMemo(() => posAvailable.map((m) => m.key), [posAvailable]);
  const [selPos, setSelPos] = useState(() => new Set());
  // KPIs and Companies default to every id selected (all shown), so their filter
  // checkboxes read as ticked and a user narrows by unticking. Empty = show none.
  const [selMetrics, setSelMetrics] = useState(() => new Set(metrics.map((m) => m.key))); // metric keys shown
  const [metricOrder, setMetricOrder] = useState(() => defaultKeys(metrics.map((m) => m.key))); // row order of selected metrics
  const [showArrange, setShowArrange] = useState(false);
  // Drag-to-reorder state for the Arrange-metrics list below.
  const dragIdx = useRef(null);
  const [dragOverIdx, setDragOverIdx] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [fund, setFund] = useState("ALL");
  const [selCompanies, setSelCompanies] = useState(() => new Set((data.companies || []).map((c) => c.id))); // company ids shown; empty = show none
  const [selTags, setSelTags] = useState(() => new Set()); // tagId()s; empty = no tag filter
  const [favOnly, setFavOnly] = useState(false); // show only starred companies
  const [selSignals, setSelSignals] = useState(() => new Set()); // custom-rule ids; empty = no signal filter
  const [search, setSearch] = useState("");
  const [showSettings, setShowSettings] = useState(false); // the settings popup
  const [window, setWindow] = useState(8);          // trailing period columns
  const [qOnly, setQOnly] = useState(true);         // quarter-ends only
  // Date-column order: "desc" = latest period leftmost (default), "asc" = oldest first.
  const [dateOrder, setDateOrder] = useState("desc");
  // Off by default — the grid opens on reported actuals only, and extending the
  // timeline with estimates is an explicit choice.
  const [showFc, setShowFc] = useState(false);
  const [fullFig, setFullFig] = useState(false);    // show full numbers vs $K/$M/$B
  const [growthMode, setGrowthMode] = useState(false); // show % change annotation under each figure
  const [growthBasis, setGrowthBasis] = useState("qoq"); // "qoq" (~3mo back) | "yoy" (~12mo back)
  // Collapsed company ids; empty (default) = all expanded. Local UI state only —
  // not saved to a view, so a fresh load always opens expanded.
  const [collapsed, setCollapsed] = useState(() => new Set());

  // ---- saved views (a named snapshot of the filter config) ----
  const views = dashboard?.doc?.views || [];
  const [viewId, setViewId] = useState(null);       // null = unsaved / custom filters
  const [saving, setSaving] = useState(false);
  const [newName, setNewName] = useState("");
  // Manual filter edits break the tie to the saved view — wrap the setters.
  const onMetrics = (s) => {
    setSelMetrics(s);
    // Empty `s` means every KPI shows — keep every key in scope here too,
    // or clearing the filter would wipe any custom row order.
    const keep = s.size > 0 ? s : new Set(metrics.map((m) => m.key));
    setMetricOrder((prev) => [...prev.filter((k) => keep.has(k)), ...defaultKeys([...keep].filter((k) => !prev.includes(k)))]);
    setViewId(null);
  };
  // Drag-to-reorder: metricOrder holds exactly the selected keys in order,
  // so moving an index to a drop target is a plain splice.
  const reorderMetric = (from, to) => {
    if (from === to) return;
    setMetricOrder((prev) => {
      const a = [...prev];
      const [item] = a.splice(from, 1);
      // Removing `from` shifts later indices down by one, so a downward
      // move's target needs the same shift to land above row `to` as shown.
      a.splice(from < to ? to - 1 : to, 0, item);
      return a;
    });
    setViewId(null);
  };
  const onPos = (s) => { setSelPos(s); setViewId(null); };
  const onFund = (v) => { setFund(v); setViewId(null); };
  const onCompanies = (s) => { setSelCompanies(s); setViewId(null); };
  const onTags = (s) => { setSelTags(s); setViewId(null); };
  const onSignals = (s) => { setSelSignals(s); setViewId(null); };
  const onWindow = (v) => { trackClick("PortfolioAnalytics.Pivot.SetWindow"); setWindow(v); setViewId(null); };
  const onQOnly = (v) => { setQOnly(v); setViewId(null); };
  const onDateOrder = (v) => { setDateOrder(v); setViewId(null); };
  const applyView = (id) => {
    const v = views.find((x) => x.id === id);
    if (!v) {
      // "Default" — restore the app's actual defaults, not just clear viewId.
      setSelMetrics(new Set(allMetricKeys));
      setMetricOrder(defaultKeys(metrics.map((m) => m.key)));
      setFund("ALL");
      setSelCompanies(new Set(allCompanyIds));
      setSelTags(new Set());
      setSelSignals(new Set());
      setWindow(8);
      setQOnly(true);
      setDateOrder("desc");
      setSelPos(new Set());
      setViewId(null);
      return;
    }
    // A stored empty/absent metricKeys means "all shown" (its legacy meaning, and
    // still how snapshot() canonicalizes all) — seed every key, not an empty set.
    setSelMetrics(new Set(v.metricKeys && v.metricKeys.length ? v.metricKeys : allMetricKeys));
    const orderKeys = v.metricKeys && v.metricKeys.length ? v.metricKeys : metrics.map((m) => m.key);
    setMetricOrder(v.metricOrder && v.metricOrder.length ? v.metricOrder.filter((k) => orderKeys.includes(k)) : defaultKeys(orderKeys));
    setFund(v.fund ?? "ALL");
    // views saved before the company picker existed (or an all-canonicalized []) have
    // no explicit `companyIds` -> all companies shown
    setSelCompanies(new Set(v.companyIds && v.companyIds.length ? v.companyIds : allCompanyIds));
    // views saved before tags existed have no `tags` -> no tag filter
    setSelTags(new Set(v.tags || []));
    // a view never saves a signal selection, so switching to one always clears it —
    // otherwise a signal filter from before the switch keeps silently narrowing rows
    setSelSignals(new Set());
    setWindow(v.window ?? 8);
    setQOnly(v.qOnly !== false);
    // views saved before this option have no dateOrder -> keep the default newest-first
    setDateOrder(v.dateOrder === "asc" ? "asc" : "desc");
    // views saved before position metrics existed have no posKeys -> none selected
    setSelPos(new Set(v.posKeys || []));
    setViewId(id);
  };
  // Persist "all shown" as [] so saved views stay small and keep their legacy
  // meaning; only a real narrowing writes an explicit id list.
  const snapshot = () => ({
    metricKeys: allMetricKeys.length && allMetricKeys.every((k) => selMetrics.has(k)) ? [] : [...selMetrics],
    metricOrder: [...metricOrder], posKeys: [...selPos], fund,
    companyIds: allCompanyIds.length && allCompanyIds.every((id) => selCompanies.has(id)) ? [] : [...selCompanies],
    tags: [...selTags], window, qOnly, dateOrder,
  });
  const saveView = () => {
    const nm = newName.trim(); if (!nm) return;
    const id = "v-" + Math.random().toString(36).slice(2, 8);
    dashboard.update((doc) => { doc.views = [...(doc.views || []), { id, name: nm, ...snapshot() }]; return doc; });
    setViewId(id); setSaving(false); setNewName("");
  };
  const updateView = () => {
    if (!viewId) return;
    dashboard.update((doc) => { doc.views = (doc.views || []).map((v) => (v.id === viewId ? { ...v, ...snapshot() } : v)); return doc; });
  };
  const deleteView = () => {
    if (!viewId) return;
    dashboard.update((doc) => { doc.views = (doc.views || []).filter((v) => v.id !== viewId); return doc; });
    setViewId(null);
  };

  // ---- conditional formatting (color scales / color-code rules per metric) ----
  const formats = dashboard?.doc?.cellFormats || {};
  const [showFmt, setShowFmt] = useState(false);
  const saveFormat = (key, fmt) => dashboard.update((doc) => { doc.cellFormats = { ...(doc.cellFormats || {}), [key]: fmt }; return doc; });
  const removeFormat = (key) => dashboard.update((doc) => { const c = { ...(doc.cellFormats || {}) }; delete c[key]; doc.cellFormats = c; return doc; });

  // Built-in signals lead, then custom rules.
  // A stable fallback, not `[]` — a fresh array each render would defeat
  // the hitsByCompany memo below whenever the doc has no rules yet.
  const rules = dashboard?.doc?.rules || EMPTY_RULES;
  const hitsByCompany = useMemo(() => {
    const m = {};
    for (const c of data.companies || []) {
      const hits = [...signalsForCompany(data, c), ...customSignalsForCompany(data, c, rules)];
      if (hits.length) m[c.id] = hits;
    }
    return m;
  }, [data, rules]);

  // Actuals vs the companies' own forward estimates. Forecast mode shows only
  // periods that haven't happened yet — looking at a "forecast" for a quarter that
  // already closed is the Forecast tab's accuracy backtest, not this view's job.
  // Forecast periods strictly AFTER the data date, so an estimate can never sit on
  // top of a reported actual — they only continue the timeline past where the
  // actuals stop.
  const futurePeriods = useMemo(
    () => forecastPeriods(data, { futureOnly: true, quarterly: qOnly }), [data, qOnly]);
  const forecastable = !!data.hasForecast && futurePeriods.length > 0;
  const showForecast = showFc && forecastable;

  // period columns: keep the most-recent `window` periods, then order them per
  // dateOrder — "desc" (default) is newest-first (latest leftmost), "asc" oldest-first.
  const periods = useMemo(() => {
    let ps = (data.dimensions?.periods || []).slice().sort();
    if (qOnly) ps = ps.filter(isQuarterEnd);
    if (window !== "all" && ps.length > window) ps = ps.slice(ps.length - window);
    let fs = [];
    if (showForecast) {
      fs = qOnly ? futurePeriods.filter(isQuarterEnd) : futurePeriods.slice();
      // as many future columns as history columns — a firm forecasting to 2030
      // would otherwise add 19 columns and bury the actuals
      if (window !== "all" && fs.length > window) fs = fs.slice(0, window);
    }
    const merged = [...ps, ...fs].sort();
    return dateOrder === "asc" ? merged : merged.reverse();
  }, [data, qOnly, window, showForecast, futurePeriods, dateOrder]);
  // which visible columns are forecast territory (used for the tint + the legend)
  const futureSet = useMemo(() => new Set(showForecast ? futurePeriods : []), [showForecast, futurePeriods]);
  const periodSet = useMemo(() => new Set(periods), [periods]);

  // Position metrics get their OWN sticky column rather than a period column.
  // Parking them in the newest actual period was tried first and fails in practice:
  // with forecasts on, that column sits ~9 columns right of the frozen headers, so
  // selecting Ownership % appeared to do nothing. A dedicated column is also the
  // honest shape — these values don't belong to a quarter at all.
  const showPos = selPos.size > 0;

  // rows: one per (company, metric-it-reports) that passes the filters
  const rows = useMemo(() => {
    const out = [];
    const companies = (data.companies || [])
      .filter((c) => fund === "ALL" || (c.funds || []).includes(fund))
      .filter((c) => selCompanies.has(c.id))
      .filter((c) => companyMatchesTags(c, selTags))
      .filter((c) => !favOnly || isFavorite(dashDoc, c.id))
      .filter((c) => selSignals.size === 0 || (hitsByCompany[c.id] || []).some((h) => selSignals.has(h.ruleId)))
      .filter((c) => !search || c.name.toLowerCase().includes(search.toLowerCase()))
      .sort((a, b) => a.name.localeCompare(b.name));
    const orderIdx = new Map(metricOrder.map((k, i) => [k, i]));  // user-chosen row order (default: qualitative first, then A→Z)
    for (const c of companies) {
      const actualMetrics = metricsFor(data, c);
      const seen = new Set(actualMetrics.map((m) => m.key));
      const reported = [...actualMetrics,
        ...(showForecast ? forecastMetricsFor(data, c).filter((m) => !seen.has(m.key)) : [])]
        .filter((m) => selMetrics.has(m.key))
        .sort((a, b) => (orderIdx.has(a.key) ? orderIdx.get(a.key) : Infinity) - (orderIdx.has(b.key) ? orderIdx.get(b.key) : Infinity) || a.label.localeCompare(b.label));
      reported.forEach((m, i) => {
        // On the quarter grid, roll monthly reporters up to the quarter: FLOW
        // metrics (P&L, cash-flow movements) are SUMMED across the months, LEVEL
        // metrics (balance sheet, headcount, period-end cash) take the closing
        // value. Without this a monthly reporter's "Q2 revenue" would show only
        // June. `agg` comes from the source REPORT_TYPE at build time.
        // seriesPoints tags each quarter with {months, parts, agg, partial, expected}
        const actualPts = seriesPoints(c, m.key, m, qOnly);
        const byPeriod = {}, partsByP = {}, isFc = {};
        for (const p of actualPts) if (periodSet.has(p.d)) { byPeriod[p.d] = p.v; partsByP[p.d] = p; }
        // Forecasts only FILL FORWARD: a future column with no actual. An actual is
        // never overwritten — hence the `byPeriod[p.d] == null` guard as well as the
        // future-only period set.
        const fcPts = showForecast ? forecastSeriesPoints(c, m.key, m, qOnly) : [];
        for (const p of fcPts) {
          if (!periodSet.has(p.d) || !futureSet.has(p.d) || byPeriod[p.d] != null) continue;
          byPeriod[p.d] = p.v; partsByP[p.d] = p; isFc[p.d] = true;
        }
        // growth walks the merged timeline, so the % change across the
        // last-actual → first-forecast boundary is still computed
        const full = [...actualPts, ...fcPts.filter((p) => isFc[p.d])].sort((a, b) => (a.d < b.d ? -1 : 1));
        // keep the row only if it has at least one value in-window
        if (!Object.keys(byPeriod).length) return;
        // Calendar-aware lookback: YoY = ~12mo (±2, like the model's yoyChange); QoQ =
        // ~3mo on the quarter grid, else the metric's cadence so monthly isn't shown MoM.
        const CAD_MO = { monthly: 1, quarterly: 3, semiannual: 6, annual: 12 };
        const stepM = growthBasis === "yoy" ? 12 : (qOnly ? 3 : (CAD_MO[metricCadence(c, m.key)] || 3));
        const tol = growthBasis === "yoy" ? 2 : Math.max(1, Math.round(stepM * 0.5));
        const growthByP = {};
        // A flag, a date or prose has no percentage change to report.
        const qual = isQualitative(m);
        for (const d of Object.keys(byPeriod)) {
          const prior = qual ? null : pointNearMonthsBack(full, d, stepM, tol);
          growthByP[d] = !prior || prior.v === 0 ? null : (byPeriod[d] - prior.v) / Math.abs(prior.v);
        }
        out.push({ companyId: c.id, companyName: c.name, funds: c.funds, metricKey: m.key,
          metricLabel: m.label, unit: m.unit, derived: m.derived, custom: m.custom, agg: m.agg, byPeriod, partsByP, isFc,
          growthByP, firstOfCompany: i === 0,
          // isQual: any flag/date/prose metric — no trendline (a Yes/No or a date
          // has no line to draw). qual: text prose only, so the value cell wraps.
          isQual: qual, qual: m.kind === "text" });
      });
      // Position rows sit under the company's KPI rows. They're added independently
      // of `reported`, so selecting ONLY position metrics still returns rows — and a
      // company that reports no KPIs at all can still show its ownership and MOIC.
      if (showPos) {
        for (const key of posOrder) {
          if (!selPos.has(key)) continue;
          const pm = positionMetricOf(key);
          if (!pm) continue;
          const v = pm.value(c);
          if (v == null) continue;
          out.push({ companyId: c.id, companyName: c.name, funds: c.funds, metricKey: key,
            metricLabel: pm.label, unit: pm.unit, position: true, posAsOf: pm.asOf(c), posTip: pm.tip,
            posValue: v, byPeriod: {}, partsByP: {}, isFc: {}, growthByP: {}, firstOfCompany: false });
        }
      }
    }
    // fix firstOfCompany after filtering may have dropped a company's first metric
    let prev = null;
    for (const r of out) { r.firstOfCompany = r.companyId !== prev; prev = r.companyId; }
    return out;
  }, [data, fund, selCompanies, selTags, favOnly, selSignals, hitsByCompany, dashDoc, search, selMetrics, metricOrder, periodSet, qOnly, showForecast, futureSet,
      selPos, posOrder, showPos, growthBasis]);

  const companyCount = new Set(rows.map((r) => r.companyId)).size;
  const favTotal = favoriteCount(dashDoc);

  // Full figures overflow the tight uniform PERIOD_W and collide; when they're on,
  // widen every period column to fit the widest figure shown (~7.5px/mono char + pad).
  const periodColW = useMemo(() => {
    if (!fullFig) return PERIOD_W;
    let maxLen = 8;
    for (const r of rows) {
      if (r.qual) continue; // prose is clipped to the column by design, not sized to it
      for (const p of periods) {
        const part = r.partsByP ? r.partsByP[p] : null;
        const s = fmtFull(r.byPeriod[p], r.unit, part && part.s, part && part.cur);
        if (s && s.length > maxLen) maxLen = s.length;
      }
    }
    return Math.min(260, Math.max(PERIOD_W, Math.round(maxLen * 7.5 + 40)));
  }, [fullFig, rows, periods]);

  // ---- collapse / expand ----
  // Metric-row count per company — drives the "N metrics hidden" summary.
  const rowsPerCompany = useMemo(() => {
    const m = new Map();
    for (const r of rows) m.set(r.companyId, (m.get(r.companyId) || 0) + 1);
    return m;
  }, [rows]);
  const anyCollapsed = collapsed.size > 0;
  // Header button: collapse everything, or expand everything if anything is collapsed.
  const toggleAll = () => setCollapsed(anyCollapsed ? new Set() : new Set(rows.map((r) => r.companyId)));
  const toggleCompany = (id) => setCollapsed((prev) => {
    const n = new Set(prev);
    n.has(id) ? n.delete(id) : n.add(id);
    return n;
  });
  // Rendered rows: a collapsed company shrinks to a single header row (its first
  // metric row, flagged `collapsed`); expanded companies pass through untouched.
  const displayRows = useMemo(() => {
    const out = [];
    for (const r of rows) {
      if (!collapsed.has(r.companyId)) { out.push(r); continue; }
      if (r.firstOfCompany) out.push({ ...r, collapsed: true });
    }
    return out;
  }, [rows, collapsed]);

  // Row count per *rendered* company — drives the `rowSpan` (1 when collapsed).
  const companySpans = useMemo(() => {
    const m = new Map();
    for (const r of displayRows) m.set(r.companyId, (m.get(r.companyId) || 0) + 1);
    return m;
  }, [displayRows]);

  // Measured, not hardcoded — the header's rendered height can shift with theme/zoom.
  // Callback ref: re-attaches the observer whenever the <thead> node itself changes.
  const headObsRef = useRef(null);
  const [headH, setHeadH] = useState(0);
  const theadRef = useCallback((el) => {
    if (headObsRef.current) { headObsRef.current.disconnect(); headObsRef.current = null; }
    if (!el) return;
    const ro = new ResizeObserver(() => setHeadH(el.getBoundingClientRect().height));
    ro.observe(el);
    headObsRef.current = ro;
  }, []);
  // Same pattern for the filter ribbon above it — the thead sticks right below
  // the ribbon, and the company-name cell sticks below both.
  const ribbonObsRef = useRef(null);
  const [ribbonH, setRibbonH] = useState(0);
  const ribbonRef = useCallback((el) => {
    if (ribbonObsRef.current) { ribbonObsRef.current.disconnect(); ribbonObsRef.current = null; }
    if (!el) return;
    const ro = new ResizeObserver(() => setRibbonH(el.getBoundingClientRect().height));
    ro.observe(el);
    ribbonObsRef.current = ro;
  }, []);
  // Floating header clone (useStickyClone, per RankedTable/CompanyPage) —
  // ribbonH shifts its ceiling below the sticky filter ribbon above it.
  const wrapRef = useRef(null);
  const tableRef = useRef(null);
  const clone = useStickyClone(wrapRef, tableRef, ribbonH);
  // Only the table wrap breaks out of <main>'s 1320px cap (ribbon/title stay put).
  // Measured, not hardcoded, so it tracks #app-content regardless of layout state.
  const [wrapMaxW, setWrapMaxW] = useState(null);
  const wrapMaxWObsRef = useRef(null);
  // Callback ref: the wrap only mounts once rows exist (rows.length===0 branch
  // below), so this must re-attach on every mount, not run once like useEffect.
  const wrapCallbackRef = useCallback((el) => {
    wrapRef.current = el;
    if (wrapMaxWObsRef.current) { wrapMaxWObsRef.current.disconnect(); wrapMaxWObsRef.current = null; }
    if (!el) return;
    const mainEl = el.closest("main"), appContent = document.getElementById("app-content");
    if (!mainEl || !appContent) return;
    const update = () => {
      const cs = getComputedStyle(mainEl);
      setWrapMaxW(appContent.getBoundingClientRect().width - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(appContent);
    wrapMaxWObsRef.current = ro;
  }, []);
  // The company-name label had the same plain-sticky problem as the header
  // (wrapRef's local scroll intercepts it) — floats via the same technique.
  const activeCompany = useActiveCompanyBand(tableRef, ribbonH + headH, ribbonH);

  // min/max per metric across the visible cells — drives the color-scale gradient
  const metricStats = useMemo(() => {
    const acc = {};
    for (const r of rows) {
      let s = acc[r.metricKey] || (acc[r.metricKey] = { min: Infinity, max: -Infinity });
      for (const p in r.byPeriod) {
        const v = r.byPeriod[p];
        if (v == null || !Number.isFinite(v)) continue;
        if (v < s.min) s.min = v;
        if (v > s.max) s.max = v;
      }
    }
    return acc;
  }, [rows]);

  // Same min/max, but over each cell's % change (in percent points) — drives the
  // gradient for formats whose basis is "growth".
  const metricGrowthStats = useMemo(() => {
    const acc = {};
    for (const r of rows) {
      let s = acc[r.metricKey] || (acc[r.metricKey] = { min: Infinity, max: -Infinity });
      for (const p in r.growthByP) {
        const g = r.growthByP[p];
        if (g == null || !Number.isFinite(g)) continue;
        const pct = g * 100;
        if (pct < s.min) s.min = pct;
        if (pct > s.max) s.max = pct;
      }
    }
    return acc;
  }, [rows]);

  const exportCsv = () => {
    // Mark forecast columns in the header — exported to Excel, an estimate and an
    // actual are otherwise indistinguishable numbers.
    const head = ["Company", showPos ? "KPI / position" : "KPI", "Unit",
      ...(showPos ? ["Current", "Current as of"] : []),
      ...periods.map((p) => shortDate(p, qOnly) + (futureSet.has(p) ? " (forecast)" : ""))];
    const lines = [head.join(",")];
    for (const r of rows) {
      const cells = periods.map((p) => {
        const part = r.partsByP ? r.partsByP[p] : null;
        if (part && part.s != null) return csv(part.s);   // export what was reported
        return r.byPeriod[p] == null ? "" : r.byPeriod[p];
      });
      // In Excel a position value would otherwise look like a figure FOR that
      // quarter. Name the row for what it is and carry its real as-of date.
      const label = r.position ? `${r.metricLabel} (position)` : r.metricLabel;
      const cur = showPos
        ? [r.position && r.posValue != null ? r.posValue : "", r.position ? (r.posAsOf || "latest") : ""]
        : [];
      lines.push([csv(r.companyName), csv(label), r.unit, ...cur, ...cells].join(","));
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    // Self-describing filename: the basis and whether forecasts are included change
    // what the numbers mean, and a file called "pivot.csv" doesn't say.
    a.href = url;
    a.download = [data.source?.slug || "kpi", "kpi-pivot", qOnly ? "quarterly" : "as-reported",
      showForecast ? "with-forecast" : null,
      // a tag-filtered export is a subset of the portfolio; say so in the filename
      selTags.size ? `tagged-${selTags.size}` : null].filter(Boolean).join("-") + ".csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const metricOpts = metricOptions(metrics);
  // selMetrics holds exactly the KPIs shown (default = all), so its size is the count.
  const shownMetricsCount = selMetrics.size;
  const posOpts = positionMetricOptions(posAvailable);
  const fundOpts = useMemo(() => [{ id: "ALL", label: "All funds" },
    ...allFunds.map((f, i) => ({ id: f, label: f, separatorBefore: i === 0 }))], [allFunds]);
  const tagGroups = allTags(data);
  // How many companies carry each tag — the count shown beside its checkbox
  // in the Filters panel, e.g. "142" next to a security type.
  const tagCounts = useMemo(() => {
    const m = new Map();
    for (const c of data.companies || []) {
      for (const t of tagsFor(c)) {
        const id = tagId(t.cat, t.value);
        m.set(id, (m.get(id) || 0) + 1);
      }
    }
    return m;
  }, [data, dashDoc]);
  // Custom-rule signals that fire for at least one company — the Filters
  // panel's "Signals" section, one checkbox per rule with a live company count.
  const signalOptions = useMemo(() => {
    const counts = new Map(), labels = new Map();
    // Built-ins list unconditionally (0 count if nothing currently fires);
    // custom rules only appear once at least one company trips them.
    for (const s of BUILTIN_SIGNALS) { const id = `builtin:${s.id}`; counts.set(id, 0); labels.set(id, s.tag); }
    for (const hits of Object.values(hitsByCompany)) {
      for (const h of hits) {
        counts.set(h.ruleId, (counts.get(h.ruleId) || 0) + 1);
        labels.set(h.ruleId, h.tag);
      }
    }
    return [...counts.keys()].map((id) => ({ id, label: labels.get(id), count: counts.get(id) }));
  }, [hitsByCompany]);
  // Companies grouped by fund (dimensions order), alphabetical within each fund.
  // Listed once under the first fund so option ids stay unique.
  const companyOpts = useMemo(() => {
    const fundOrder = new Map(allFunds.map((f, i) => [f, i]));
    const firstFundOf = (c) => (c.funds || []).slice()
      .sort((a, b) => (fundOrder.get(a) ?? Infinity) - (fundOrder.get(b) ?? Infinity))[0];
    return (data.companies || [])
      .map((c) => ({ id: c.id, label: c.name, group: firstFundOf(c) || "No fund" }))
      .sort((a, b) => ((fundOrder.get(a.group) ?? Infinity) - (fundOrder.get(b.group) ?? Infinity)) || a.label.localeCompare(b.label));
  }, [data, allFunds]);

  // Count of changed settings hidden inside the popup, shown on the button.
  // Fund/Companies/KPIs/Position metrics/Tags/Favorites/Signals/Search live in
  // the Filters button and the ribbon search box, so they don't count here.
  const nonDefault =
    (window !== 8 ? 1 : 0) + (qOnly !== true ? 1 : 0) + (dateOrder !== "desc" ? 1 : 0) +
    (showFc ? 1 : 0) + (fullFig ? 1 : 0) + (growthMode ? 1 : 0) +
    (Object.keys(formats).length ? 1 : 0);

  // One header-column list, rendered both by the real <thead> and by its
  // floating clone (renderPivotHeadRow below) — keeps the two markups from drifting.
  const headColDefs = [
    { key: "company", frozen: true, left: 0, width: CO_W, align: "left", content: (
      <span style={{ display: "flex", alignItems: "center" }}>
        {companyCount > 1 ? (
          <button onClick={toggleAll} disabled={!rows.length}
            aria-label={anyCollapsed ? "Expand all" : "Collapse all"}
            title={anyCollapsed ? "Expand every company" : "Collapse every company to just its name"}
            style={{ border: "none", background: "transparent", padding: 0, cursor: rows.length ? "pointer" : "default",
              display: "inline-flex", flex: "none", color: "var(--ink-color-global-text-subtle)", lineHeight: 0 }}>
            {anyCollapsed ? <ExpandAllIcon size={16} strokeWidth={1.5} /> : <CollapseAllIcon size={16} strokeWidth={1.5} />}
          </button>
        ) : <span style={{ width: 16, flex: "none" }} />}
        {/* Aligns with where each row's name starts, past its own chevron + star. */}
        <span style={{ marginLeft: NAME_INSET - 16 }}>Company</span>
      </span>
    ) },
    { key: "kpi", frozen: true, left: CO_W, width: KPI_W, align: "left", lastFrozen: !showPos, content: selPos.size ? "KPI / position" : "KPI" },
    ...(showPos ? [{ key: "pos", frozen: true, left: CO_W + KPI_W, width: POS_W, align: "right", cursor: "help", lastFrozen: true,
        dataTip: "Current value of the position rows — ownership, returns and marks. These are point-in-time "
          + "facts with no period history, so they get their own column instead of pretending to belong to a quarter. "
          + "Hover a value for its as-of date.", content: "Current" }] : []),
    { key: "__trend", frozen: false, width: TREND_W, align: "left",
      dataTip: "Sparkline of the reported values across the periods shown, oldest to newest. "
        + "The % is the change from the oldest to the newest value; green is up, red is down. "
        + "Qualitative KPIs (Yes/No, dates, text) show no trendline.",
      content: "Trend over time" },
    ...periods.map((p) => ({
      key: p, frozen: false, width: periodColW, align: "right",
      dataTip: futureSet.has(p) ? "Forecast period — values here are the companies' own estimates." : undefined,
      background: futureSet.has(p) ? FC_HEAD_BG : undefined, content: shortDate(p, qOnly),
    })),
  ];

  // Shared between the in-place (static) label and its floating clone below,
  // so the two markups can't drift apart — same reasoning as renderPivotHeadRow.
  const renderCompanyLabel = (companyId) => (
    <>
      <span style={{ display: "flex", flexWrap: "nowrap", gap: 5, alignItems: "center", minWidth: 0 }}>
        <span style={{ display: "inline-flex", gap: 5, alignItems: "center", width: NAME_ICONS_W, flex: "none" }}>
          <button onClick={() => toggleCompany(companyId)}
            aria-label={collapsed.has(companyId) ? "Expand company" : "Collapse company"}
            title={collapsed.has(companyId) ? "Expand" : "Collapse"}
            style={{ border: "none", background: "transparent", padding: 0, cursor: "pointer",
              display: "inline-flex", color: "var(--ink-color-global-text-subtle)", lineHeight: 0 }}>
            <ChevronDownIcon size={16} strokeWidth={1.5}
              style={{ transform: collapsed.has(companyId) ? "rotate(-90deg)" : "none", transition: "transform .12s" }} />
          </button>
          <FavoriteStar company={companyById.get(companyId)} doc={dashDoc} onUpdate={dashboard?.update} compact />
        </span>
        <button onClick={() => openCompany(companyId)} title={companyById.get(companyId)?.name}
          style={{ border: "none", background: "transparent", padding: 0, cursor: "pointer", fontWeight: 600, fontSize: "inherit", fontFamily: "inherit",
            color: "var(--ink-color-global-link-default)", textAlign: "left", minWidth: 0, flex: "1 1 auto",
            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {companyById.get(companyId)?.name}
        </button>
      </span>
      {hitsByCompany[companyId] && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 3, marginTop: 5, marginLeft: NAME_INSET }}>
          {hitsByCompany[companyId].map((s) => (
            <Badge key={s.ruleId} tone={s.tone} title={s.detail} style={{ height: "auto", padding: "1px 6px", fontSize: 10, lineHeight: "16px" }}>{s.tag}</Badge>
          ))}
        </div>
      )}
      {companyById.get(companyId) && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 3, marginTop: 5, marginLeft: NAME_INSET, alignItems: "center" }}>
          <CompanyTags company={companyById.get(companyId)} compact />
        </div>
      )}
    </>
  );

  return (
    // One heading, one ribbon, one table: a single 16px table section.
    <section style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <H2>Company KPIs</H2>
      {/* The table below breaks out wider than <main> (wrapMaxW), so this
          ribbon's own flex row stays at <main>'s width so its controls don't
          drift, and the backdrop below fills the extra breakout width the
          ribbon's own box doesn't cover. */}
      <StickyRibbon ref={ribbonRef} style={{ justifyContent: "space-between" }}>
        <div style={{ position: "absolute", top: 0, bottom: 0, left: 0,
          width: wrapMaxW ?? "100%", background: "var(--ink-color-global-surface-background-default)" }} />
        <div style={{ position: "relative", display: "flex", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
          <ViewControl views={views} viewId={viewId} onApply={applyView} onUpdate={updateView} onDelete={deleteView}
            saving={saving} setSaving={setSaving} newName={newName} setNewName={setNewName} onSave={saveView} />
          <SearchInput placeholder="Search companies…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ width: 200 }} />
          <GlobalFilter tagGroups={tagGroups} tagCounts={tagCounts} selTags={selTags} onTags={onTags}
            favOnly={favOnly} setFavOnly={setFavOnly} favTotal={favTotal} hasCartaTags={hasCartaTags(data)}
            signalOptions={signalOptions} selSignals={selSignals} onSignals={onSignals}
            fundOpts={fundOpts} fund={fund} onFund={onFund}
            companyOpts={companyOpts} selCompanies={selCompanies} onCompanies={onCompanies}
            metricOpts={metricOpts} selMetrics={selMetrics} onMetrics={onMetrics}
            posOpts={posOpts} selPos={selPos} onPos={onPos} posAvailable={posAvailable} />
        </div>
        <div style={{ position: "relative", display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Btn size="toolbar" onClick={() => setShowSettings(true)}>Configure{nonDefault ? ` (${nonDefault})` : ""}</Btn>
          <Btn size="toolbar" onClick={exportCsv} disabled={!rows.length}>Export CSV</Btn>
        </div>
      </StickyRibbon>

      <Modal open={showSettings} onClose={() => setShowSettings(false)}
        title="KPI settings" width={760} minHeight={620} labelledById="dash-settings-title">
        {shownMetricsCount >= 2 && (
        <Section title="KPIs">
          <Btn onClick={() => setShowArrange((s) => !s)}>Arrange KPIs</Btn>
          {showArrange && (
            <div className="card" style={{ padding: 14, marginTop: 4, width: "100%" }}>
              <div style={{ ...sans, fontWeight: 600, fontSize: FS.bodyLg }}>Arrange KPI order</div>
              <div style={{ ...sans, fontSize: FS.small, color: MICRO, margin: "4px 0 10px" }}>Set the row order of your selected KPIs within each company (default is alphabetical).</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6, maxWidth: 480 }}>
                {metricOrder.filter((k) => selMetrics.has(k)).map((k, i) => (
                  <div key={k} draggable
                    onDragStart={() => { dragIdx.current = i; setDragging(true); }}
                    onDragEnd={() => { dragIdx.current = null; setDragging(false); setDragOverIdx(null); }}
                    onDragOver={(e) => { e.preventDefault(); setDragOverIdx(i); }}
                    onDrop={(e) => { e.preventDefault(); if (dragIdx.current != null) reorderMetric(dragIdx.current, i); setDragOverIdx(null); }}
                    style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 10px", borderRadius: 6,
                      background: "var(--ink-color-global-surface-lightgray-default)",
                      borderTop: dragOverIdx === i ? `2px solid var(--ink-color-global-link-default)` : "2px solid transparent",
                      cursor: dragging ? "grabbing" : "grab" }}>
                    <span aria-hidden="true" title="Drag to reorder" style={{ ...mono, fontSize: FS.value, color: MICRO, lineHeight: 1, cursor: "inherit" }}>⠿</span>
                    <span style={{ ...mono, fontSize: FS.small, color: MICRO, width: 22 }}>{i + 1}</span>
                    <span style={{ ...sans, fontSize: FS.body, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{(metricOf(data, k) || {}).label || k}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Section>
        )}

        <Section title="Timeline">
          {forecastable && (
            <span data-tip="Continues the timeline past the last actual with the companies' own submitted estimates. Forecasts only fill periods that haven't happened yet — a reported actual is never replaced. Shaded blue in the grid."
              style={{ ...sans, fontSize: FS.small, color: MICRO, display: "inline-flex", alignItems: "center", gap: 7, cursor: "help" }}>
              Forecast <Toggle small checked={showFc} onChange={setShowFc} labels={["On", "Off"]} />
            </span>
          )}
          <Segmented small options={[{ id: 4, label: "4" }, { id: 8, label: "8" }, { id: 12, label: "12" }, { id: "all", label: "All" }]} value={window} onChange={onWindow} />
          <span style={{ ...sans, fontSize: FS.small, color: MICRO, display: "inline-flex", alignItems: "center", gap: 7 }}>
            Quarter-ends only <Toggle small checked={qOnly} onChange={onQOnly} labels={["On", "Off"]} />
          </span>
          <span data-tip="Order of the date columns. Newest first (default) puts the latest period in the leftmost column; oldest first reads left-to-right in time."
            style={{ ...sans, fontSize: FS.small, color: MICRO, display: "inline-flex", alignItems: "center", gap: 7, cursor: "help" }}>
            Date order <Segmented small options={[{ id: "desc", label: "Newest first" }, { id: "asc", label: "Oldest first" }]} value={dateOrder} onChange={onDateOrder} />
          </span>
        </Section>

        <Section title="Display">
          <span style={{ ...sans, fontSize: FS.small, color: MICRO, display: "inline-flex", alignItems: "center", gap: 7 }}>
            Full figures <Toggle small checked={fullFig} onChange={setFullFig} labels={["On", "Off"]} />
          </span>
          <span style={{ ...sans, fontSize: FS.small, color: MICRO, display: "inline-flex", alignItems: "center", gap: 7 }}>
            Show % change <Toggle small checked={growthMode} onChange={setGrowthMode} labels={["On", "Off"]} />
          </span>
          {growthMode && (
            <span data-tip="QoQ compares each figure to ~3 months earlier (its own cadence on the as-reported grid). YoY compares to ~12 months earlier."
              style={{ ...sans, fontSize: FS.small, color: MICRO, display: "inline-flex", alignItems: "center", gap: 7, cursor: "help" }}>
              Basis <Segmented small options={[{ id: "qoq", label: "QoQ" }, { id: "yoy", label: "YoY" }]} value={growthBasis} onChange={setGrowthBasis} />
            </span>
          )}
          <Btn onClick={() => setShowFmt((s) => !s)}>Conditional formatting{Object.keys(formats).length ? ` (${Object.keys(formats).length})` : ""}</Btn>
          {showFmt && <div style={{ width: "100%" }}><FormatPanel metrics={metrics} formats={formats} onSave={saveFormat} onRemove={removeFormat} /></div>}
        </Section>
      </Modal>

      {/* The grid and its row/period count read as one unit — the count is the
          table's caption, so it sits 16px under it rather than a page-gap away.
          (The two portals below render into document.body, so they add no box.) */}
      <section style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {rows.length === 0 ? (
        <div className="card" style={{ padding: 28, textAlign: "center", color: "var(--ink-color-global-text-subtle)", ...sans }}>
          No rows for this filter. Widen the KPI selection, fund, or period window.
        </div>
      ) : (
        <div ref={wrapCallbackRef} style={{ overflowX: "auto", overflowY: "hidden", ...(wrapMaxW ? { width: wrapMaxW } : {}) }}>
          {/* width: max-content only — the table takes exactly its columns'
              required widths and never stretches to fill the wrapper; wrapRef's
              overflowX:auto scrolls it when that exceeds the visible width. */}
          <table ref={tableRef} className="pivot-table" style={{ borderCollapse: "separate", borderSpacing: 0, ...mono, fontSize: 14, width: "max-content" }}>
            <thead ref={theadRef}>
              {renderPivotHeadRow(headColDefs)}
            </thead>
            <tbody>
              {displayRows.map((r, i) => {
                // Color-scale range: "row" scope uses this company's own min/max
                // (its trend); "portfolio" (default) uses the metric's full range.
                const fmtRow = formats[r.metricKey];
                const rowGrowth = isGrowthBasis(fmtRow);
                const scaleStats = isRowScope(fmtRow)
                  ? statsOf(rowGrowth ? r.growthByP : r.byPeriod, rowGrowth ? 100 : 1)
                  : (rowGrowth ? metricGrowthStats : metricStats)[r.metricKey];
                // The very first row needs no group divider — the header's own
                // border-bottom already closes off the top of the table.
                const groupDivider = r.firstOfCompany && i !== 0 ? GROUP_DIVIDER : undefined;
                return (
                <tr key={`${r.companyId}:${r.metricKey}`}>
                  {r.firstOfCompany && (
                    <td rowSpan={companySpans.get(r.companyId)}
                      // Collapsed is one row — skip the active-band float so the name
                      // never detaches from its "N metrics hidden" sibling cell.
                      {...(!r.collapsed && { "data-company-anchor": r.companyId })}
                      // zIndex 2 (not the other sticky cells' 1) — this cell hosts the
                      // "+ tag" popover, which needs to paint over sibling row cells.
                      style={{ ...stickyCell, left: 0, maxWidth: CO_W, zIndex: 2, ...sans, padding: 0, verticalAlign: "top",
                        borderTop: groupDivider, overflow: "visible", textOverflow: "clip" }}>
                      {/* Static — floats via a portaled clone instead (see
                          useActiveCompanyBand) while it's the active company,
                          same reasoning as the header's own clone. */}
                      <div style={{ padding: `${GROUP_PAD_TOP}px 14px 9px`, fontWeight: 600, color: "var(--ink-color-global-text-default)", whiteSpace: "normal",
                        visibility: !r.collapsed && activeCompany?.id === r.companyId ? "hidden" : "visible" }}>
                        {renderCompanyLabel(r.companyId)}
                      </div>
                    </td>
                  )}
                  {/* colSpan: KPI + optional position + Trend over time + every period. */}
                  {r.collapsed && (
                    <td colSpan={1 + (showPos ? 1 : 0) + 1 + periods.length}
                      style={{ ...sans, color: MICRO, fontStyle: "italic", verticalAlign: "top",
                        padding: `${GROUP_PAD_TOP}px 14px 9px`, borderTop: groupDivider,
                        borderBottom: `1px solid var(--ink-color-global-border-subtle)` }}>
                      {(rowsPerCompany.get(r.companyId) || 0)} KPI{(rowsPerCompany.get(r.companyId) || 0) === 1 ? "" : "s"} hidden
                    </td>
                  )}
                  {!r.collapsed && (<>
                  <td className="pivot-frozen" style={{ ...stickyCell, left: CO_W, maxWidth: KPI_W, zIndex: 1, color: "var(--ink-color-global-text-subtle)", ...sans,
                      // Full string, not stickyCell's shorthand + a longhand paddingTop —
                      // React's style diff skips an unchanged shorthand, orphaning padding-top.
                      padding: r.firstOfCompany ? `${GROUP_PAD_TOP}px 14px 9px` : "9px 14px",
                      ...(!showPos && { boxShadow: LAST_FROZEN_DIVIDER }),
                      ...(r.firstOfCompany && { borderTop: groupDivider }) }}>
                    {r.metricLabel}
                    {r.custom
                      ? <Badge tone="info" title="Custom KPI (chart of accounts)" style={{ marginLeft: 6 }}>custom</Badge>
                      : r.derived && <Badge tone="info" title="Custom formula" style={{ marginLeft: 6 }}>ƒ</Badge>}
                    {r.position && (
                      <Badge tone="neutral" title={r.posTip} style={{ marginLeft: 6, cursor: "help" }}>POS</Badge>
                    )}
                  </td>
                  {showPos && (
                    <td data-tip={r.position
                        ? (r.posAsOf ? `As of ${r.posAsOf}.` : "As of the latest available snapshot.")
                          + "\nA point-in-time value — it has no period history, which is why it sits outside the timeline."
                        : undefined}
                      className="pivot-frozen"
                      style={{ ...stickyCell, left: CO_W + KPI_W, maxWidth: POS_W, zIndex: 1, textAlign: "right", whiteSpace: "nowrap",
                        fontWeight: r.position ? 600 : 400,
                        padding: r.firstOfCompany ? `${GROUP_PAD_TOP}px 14px 9px` : "9px 14px",
                        boxShadow: LAST_FROZEN_DIVIDER,
                        ...(r.firstOfCompany && { borderTop: groupDivider }),
                        color: r.position ? "var(--ink-color-global-text-default)" : "var(--ink-color-global-border-default)" }}>
                      {r.position
                        ? (fullFig ? fmtFull(r.posValue, r.unit) : fmtVal(r.posValue, r.unit))
                        : "\u00b7"}
                    </td>
                  )}
                  {/* borderBottom matches every sibling td — it is this table's
                      row rule, not backing for a panel. */}
                  <td style={{ padding: r.firstOfCompany ? `${GROUP_PAD_TOP}px 14px 9px` : "9px 14px",
                    verticalAlign: "top", width: TREND_W, maxWidth: TREND_W,
                    borderBottom: `1px solid var(--ink-color-global-border-subtle)`,
                    ...(r.firstOfCompany && { borderTop: groupDivider }) }}>
                    {r.isQual ? null : (() => {
                      const ch = trendChange(r.byPeriod, periods);
                      return (
                        // Fixed sparkline track, so the % stays on one x even on a
                        // row whose series is too short to draw.
                        <span style={{ display: "grid", gridTemplateColumns: `${TREND_SPARK_W}px auto`,
                          columnGap: 8, alignItems: "center" }}>
                          {/* Plot the reported levels, so the line's shape and its
                              endpoints agree with the % badge and the period columns. */}
                          <TrendSparkline points={periods.map((p) => ({ d: p, v: r.byPeriod[p] == null ? null : r.byPeriod[p] }))}
                            dir={ch ? ch.dir : undefined} />
                          <span style={{ ...sans, fontSize: FS.body }}><DeltaText delta={ch} /></span>
                        </span>
                      );
                    })()}
                  </td>
                  {periods.map((p) => {
                    const v = r.byPeriod[p];
                    const part = r.partsByP ? r.partsByP[p] : null;
                    // null/missing → "—" (the app's standard missing-value mark); a real reported 0 shows as its value ($0).
                    // Free text reports no number at all, so its string is the reading.
                    const missing = v == null && !(part && part.s != null);
                    const fmt = fmtRow;
                    const growth = r.growthByP[p]; // fraction | null
                    // A growth-basis format colors by the % change (in percent points),
                    // so a cell with no comparable prior period gets no fill.
                    const cf = missing || v == null ? null
                      : isGrowthBasis(fmt)
                        ? (growth == null ? null : cellFormat(growth * 100, fmt, scaleStats))
                        : cellFormat(v, fmt, scaleStats);
                    // % change runs *below* the figure (annotation), it doesn't replace it
                    const g = growthMode && !missing ? growth : undefined;
                    // Partial quarter: fewer source months rolled up than the
                    // company's cadence implies. Only flagged for SUMMED flows —
                    // a missing month understates a total, but a level metric's
                    // closing value is still valid whichever month it came from.
                    const partial = !missing && part && part.partial;
                    // A reported quarterly figure that disagrees with the company's
                    // own monthly filings for the same quarter — surface the gap.
                    const gap = !missing ? quarterlyMonthlyGap(part) : null;
                    const gapNote = gap
                      ? `ℹ Company-reported quarterly figure; its monthly filings for this quarter sum to ${fmtVal(gap.monthlySum, r.unit, null, part.cur)} (${gap.parts.join(", ")}).`
                      : "";
                    const tip = (!part || part.months == null ? "" :
                        (part.months > 1
                          ? `${part.agg === "sum" ? "Sum of" : "Closing value of"} ${part.months} reported periods: ${part.parts.join(", ")}`
                          : "") +
                        (partial ? `${part.months > 1 ? "\n" : ""}⚠ Partial quarter — only ${part.months} of ${part.expected} months reported (${part.parts.join(", ")}), so this total is understated.` : ""))
                      + (gapNote ? `${part && part.months > 1 ? "\n" : ""}${gapNote}` : "")
                        || undefined;
                    const fc = !missing && r.isFc && r.isFc[p];
                    const fcTip = fc ? "Forecast — the company's own estimate for a period that hasn't happened yet, not a reported actual." : null;
                    // Free-text prose is clamped to a few lines in the cell; surface the
                    // full answer on hover so nothing is lost to the clamp.
                    const qualTip = r.qual && !missing && part && part.s ? String(part.s) : null;
                    const baseTip = fcTip ? (tip ? `${fcTip}\n\n${tip}` : fcTip) : tip;
                    return (
                      <td key={p} data-tip={qualTip ? (baseTip ? `${qualTip}\n\n${baseTip}` : qualTip) : baseTip}
                        style={{ padding: r.firstOfCompany ? `${GROUP_PAD_TOP}px 14px 9px` : "9px 14px", verticalAlign: "top",
                        ...(r.firstOfCompany && { borderTop: groupDivider }),
                        // Prose and numbers share one uniform column: a long answer is
                        // clipped with an ellipsis (full text on hover) instead of widening it.
                        textAlign: "right",
                        whiteSpace: "nowrap",
                        maxWidth: periodColW,
                        borderBottom: `1px solid var(--ink-color-global-border-subtle)`,
                        // the forecast wash outranks conditional formatting: knowing a
                        // figure is an estimate matters more than where it sits on a heatmap
                        background: fc ? FC_BG : cf ? cf.bg : undefined,
                        fontStyle: fc ? "italic" : undefined,
                        color: fc ? "var(--ink-color-global-text-default)" : cf ? cf.fg : missing ? "var(--ink-color-global-border-default)" : "var(--ink-color-global-text-default)" }}>
                        <div style={r.qual ? TRUNCATE : undefined}>
                          {missing ? "—" : (fullFig ? fmtFull(v, r.unit, part && part.s, part && part.cur) : fmtVal(v, r.unit, part && part.s, part && part.cur))}
                          {partial && <span style={{ color: NEG, fontWeight: 700, marginLeft: 3 }} >*</span>}
                          {!partial && gap && <span style={{ color: MICRO, fontWeight: 700, marginLeft: 3 }} >ⁱ</span>}
                        </div>
                        {growthMode && !missing && (
                          <div style={{ fontSize: 11, fontWeight: 500, marginTop: 1,
                            color: cf ? cf.fg : g == null ? MICRO : g >= 0 ? POS : NEG }}>
                            {g == null ? "N/A" : (g >= 0 ? "+" : "−") + withCommas(Math.abs(g * 100).toFixed(0)) + "%"}
                          </div>
                        )}
                      </td>
                    );
                  })}
                  </>)}
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {/* Floating clone: portaled outside the app root, so it needs its own
          font (sans) — see useStickyClone's doc for the rest of the mechanism. */}
      {clone && createPortal(
        <div ref={clone.scrollRef} style={{ ...sans, position: "fixed", top: clone.top, left: clone.left, width: clone.width, overflow: "hidden", zIndex: Z.stickyClone }}>
          <table className="pivot-table" style={{ borderCollapse: "separate", borderSpacing: 0, ...mono, fontSize: 14, tableLayout: "fixed",
            width: clone.cols.reduce((sum, w) => sum + w, 0) }}>
            <thead>{renderPivotHeadRow(headColDefs, clone.cols)}</thead>
          </table>
        </div>,
        document.body
      )}
      {activeCompany && createPortal(
        // Clip box at the label's resting spot. useActiveCompanyBand sizes it and
        // sets the label's push-out offset directly, so no geometry lives in JSX.
        <div ref={activeCompany.boxRef} style={{ position: "fixed", top: ribbonH + headH, overflow: "hidden", zIndex: Z.popover }}>
          {/* fontSize is explicit — portaled outside <table>'s own fontSize:14,
              so it would otherwise fall back to the browser default. */}
          <div ref={activeCompany.innerRef} style={{ ...sans, fontSize: 14, position: "absolute", left: 0, right: 0,
            padding: `${GROUP_PAD_TOP}px 14px 9px`, fontWeight: 600, color: "var(--ink-color-global-text-default)",
            background: "var(--ink-color-global-surface-background-default)", whiteSpace: "normal" }}>
            {renderCompanyLabel(activeCompany.id)}
          </div>
        </div>,
        document.body
      )}

      <div style={{ ...sans, fontSize: FS.small, color: MICRO }}>
        {rows.length} rows · {companyCount} companies · {periods.length} periods
        {showForecast && futureSet.size > 0 && <> ·{" "}
          <span style={{ background: FC_BG, padding: "1px 6px", borderRadius: 3, fontStyle: "italic" }}>blue</span>{" "}
          = the companies' <strong>own forward estimates</strong> for periods after{" "}
          {data.source?.asOf || "the data date"} — they extend the timeline and never replace a reported actual</>}
        {selPos.size > 0 && <> · rows tagged{" "}
          <span style={{ ...sans, fontSize: 10, fontWeight: 700, border: `1px solid var(--ink-color-global-border-subtle)`,
            background: "var(--ink-color-global-surface-lightgray-default)", padding: "1px 5px", borderRadius: 3 }}>POS</span>{" "}
          are <strong>point-in-time position facts</strong> — your ownership, returns and marks. They have no period
          history, so they read in the <strong>Current</strong> column rather than the timeline; hover for the as-of date</>}
        {qOnly && <> · monthly reporters rolled up to quarters — income-statement &amp; cash-flow
          items are <strong>summed</strong>, balances (incl. period-end cash) take the <strong>closing</strong> value;
          <span style={{ color: NEG, fontWeight: 700 }}> *</span> marks a partial quarter,
          <span style={{ color: MICRO, fontWeight: 700 }}> ⁱ</span> a quarterly figure that differs from its monthly filings</>}
      </div>
      </section>
    </section>
  );
}

/** Ribbon "View" control — a Dropdown-styled trigger reading "View: <name>"
 *  that opens a panel of saved-view radios + save/update/delete. A "view"
 *  captures the metric selection/order, fund, companies, tags, and timeline
 *  window — reapplying it restores that exact filter config. */
function ViewControl({ views, viewId, onApply, onUpdate, onDelete, saving, setSaving, newName, setNewName, onSave }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const panelRef = useRef(null);
  useDismissable(open, setOpen, [ref, panelRef]);
  // Portals to <body> — the sticky ribbon above traps a nested popover otherwise.
  const anchorRect = usePortalAnchor(open, ref);
  const pos = anchorRect && { top: anchorRect.bottom + 4, left: anchorRect.left };
  const current = views.find((v) => v.id === viewId);
  const label = current ? current.name : "Default";
  return (
    <div ref={ref} style={{ position: "relative", display: "inline-block" }}>
      <button onClick={() => setOpen((o) => !o)} className={`dd-trigger${open ? " is-open" : ""}`}
        style={{ ...ddTriggerStyle({ minWidth: 170 }), cursor: "pointer" }}>
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>View: {label}</span>
        <ChevronDownIcon size={16} strokeWidth={1.5} style={{ flex: "none" }} />
      </button>
      {open && createPortal(
        <div ref={panelRef} className="popin" style={{ position: "fixed", top: pos?.top ?? 0, left: pos?.left ?? 0,
          visibility: pos ? "visible" : "hidden", ...sans, width: 280,
          background: "var(--ink-color-global-surface-background-default)", border: `1px solid var(--ink-color-global-border-subtle)`,
          borderRadius: 6, boxShadow: POPOVER_SHADOW, zIndex: Z.popover, padding: 14 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8, gap: 8 }}>
            <div style={{ ...sans, fontWeight: 600, fontSize: FS.bodyLg }}>Select from your Saved Views</div>
            {viewId && (
              <span style={{ display: "flex", gap: 8, flex: "none" }}>
                <Btn kind="link" style={{ fontSize: FS.small }} onClick={onUpdate} title="Overwrite this view with the current filters">Update</Btn>
                <Btn kind="link" style={{ fontSize: FS.small, color: NEG }} onClick={onDelete}>Delete</Btn>
              </span>
            )}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 2, marginBottom: 10 }}>
            {/* onClick (not just onChange) — a radio already checked fires no change
                event, so re-picking the current view/Default must still re-apply it
                and discard any manual edits made since. */}
            <label style={{ ...sans, display: "flex", alignItems: "center", gap: 8, padding: "6px 4px", fontSize: FS.value, cursor: "pointer" }}
              onClick={() => onApply(null)}>
              <input type="radio" name="pivot-view" checked={viewId == null} readOnly /> Default
            </label>
            {views.map((v) => (
              <label key={v.id} style={{ ...sans, display: "flex", alignItems: "center", gap: 8, padding: "6px 4px", fontSize: FS.value, cursor: "pointer" }}
                onClick={() => onApply(v.id)}>
                <input type="radio" name="pivot-view" checked={viewId === v.id} readOnly /> {v.name}
              </label>
            ))}
          </div>
          {saving ? (
            <span style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
              <TextInput placeholder="View name…" value={newName} onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") onSave(); }} autoFocus style={{ flex: 1, minWidth: 120 }} />
              <Btn kind="primary" onClick={onSave} disabled={!newName.trim()}>Save</Btn>
              <Btn onClick={() => { setSaving(false); setNewName(""); }}>Cancel</Btn>
            </span>
          ) : (
            <Btn onClick={() => setSaving(true)}>+ Add View</Btn>
          )}
          <div style={{ ...sans, fontSize: FS.micro, color: MICRO, marginTop: 8 }}>
            Save your current KPI selection and order, fund, companies, tags, and timeline window as a view.
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

// Local composed tokens the app's tokens.css doesn't carry — same light-dark()
// convention, values copied from theme-with-ink's own components-globalfilter.html.
const GF_WARM_SURFACE = "light-dark(#FBFAF9, #2D2D2D)"; // side-nav background
const GF_NAV_ACTIVE_BG = "light-dark(#E9EAEA, #394040)"; // gray-30 / gray-90
const GF_TAG_BORDER = "light-dark(#285DA3, #2C67B5)"; // blue-70 / blue-60
const GF_TAG_BG = "light-dark(#EAF0F8, transparent)"; // blue-10
const GF_BUBBLE_BG = "light-dark(#EAF0F8, rgb(18 18 18))";

/** Ribbon "Filters" control — one nav pane per tag category, plus Favorites.
 *  Ported pixel-for-pixel from theme-with-ink's resources/components-globalfilter.html. */
function GlobalFilter({ tagGroups, tagCounts, selTags, onTags, favOnly, setFavOnly, favTotal, hasCartaTags,
  signalOptions, selSignals, onSignals,
  fundOpts, fund, onFund, companyOpts, selCompanies, onCompanies,
  metricOpts, selMetrics, onMetrics, posOpts, selPos, onPos, posAvailable }) {
  const hasFav = favTotal > 0 || favOnly;
  const hasSignals = signalOptions.length > 0;
  const hasFunds = fundOpts.length > 1; // "All funds" is always entry 0
  const [open, setOpen] = useState(false);
  const [paneSearch, setPaneSearch] = useState("");
  // Every tag category gets its own section — Status leads, then Favorites, then Signals.
  const statusGroup = tagGroups.find((g) => g.cat === STATUS_CAT);
  const otherGroups = tagGroups.filter((g) => g.cat !== STATUS_CAT);
  // Exact id->category/value maps — tagId has no real separator, so
  // id.startsWith(cat) can cross-match when one category name prefixes another.
  const { catOfTagId, valueOfTagId } = useMemo(() => {
    const cat = new Map(), value = new Map();
    for (const g of tagGroups) for (const v of g.values) { const id = tagId(g.cat, v); cat.set(id, g.cat); value.set(id, v); }
    return { catOfTagId: cat, valueOfTagId: value };
  }, [tagGroups]);
  const [draftTags, setDraftTags] = useState(selTags);
  const [draftFav, setDraftFav] = useState(favOnly);
  const [draftSignals, setDraftSignals] = useState(selSignals);
  const [draftFund, setDraftFund] = useState(fund);
  const [draftCompanies, setDraftCompanies] = useState(selCompanies);
  const [draftMetrics, setDraftMetrics] = useState(selMetrics);
  const [draftPos, setDraftPos] = useState(selPos);
  // KPIs and Companies default to all-selected, so "all shown" is the full option
  // set, not an empty one. These drive the reset-to-all and the "narrowed?" chips.
  const allMetricIds = useMemo(() => metricOpts.map((o) => o.id), [metricOpts]);
  const allCompanyIds = useMemo(() => companyOpts.map((o) => o.id), [companyOpts]);
  const everyIn = (ids, set) => ids.length > 0 && ids.every((id) => set.has(id));
  const allMetricsShown = everyIn(allMetricIds, selMetrics);
  const allCompaniesShown = everyIn(allCompanyIds, selCompanies);
  // One pass over a tag-id set, not one scan per category.
  const idsByCat = (ids) => {
    const m = new Map();
    for (const id of ids) {
      const cat = catOfTagId.get(id);
      if (!cat) continue;
      if (!m.has(cat)) m.set(cat, []);
      m.get(cat).push(id);
    }
    return m;
  };
  // The committed selection — toolbar chips read this, since they're visible
  // whether or not the panel is open.
  const selIdsByCat = useMemo(() => idsByCat(selTags), [selTags, catOfTagId]);
  // The in-progress draft — nav bubbles read this, so a checkbox you tick
  // shows its count immediately instead of waiting for Apply.
  const draftIdsByCat = useMemo(() => idsByCat(draftTags), [draftTags, catOfTagId]);
  const navItems = [
    ...(hasFunds ? [{ key: "__fund", label: "Fund", count: draftFund !== "ALL" ? 1 : 0 }] : []),
    // Default-all panes: the badge counts a narrowing, so it stays hidden until the
    // draft drops below the full set (rather than always showing the total).
    { key: "__companies", label: "Companies", count: everyIn(allCompanyIds, draftCompanies) ? 0 : draftCompanies.size },
    { key: "__kpis", label: "KPIs", count: everyIn(allMetricIds, draftMetrics) ? 0 : draftMetrics.size },
    ...(posAvailable.length > 0 ? [{ key: "__posmetrics", label: "Position KPIs", count: draftPos.size }] : []),
    ...(statusGroup ? [{ key: STATUS_CAT, label: STATUS_CAT, group: statusGroup, count: (draftIdsByCat.get(STATUS_CAT) || []).length }] : []),
    ...(hasFav ? [{ key: "__favorites", label: "Favorites", count: draftFav ? 1 : 0 }] : []),
    ...(hasSignals ? [{ key: "__signals", label: "Signals", count: draftSignals.size }] : []),
    ...otherGroups.map((g) => ({ key: g.cat, label: g.cat, group: g, count: (draftIdsByCat.get(g.cat) || []).length })),
  ];
  const [activePane, setActivePane] = useState(navItems[0]?.key);
  const ref = useRef(null);
  const panelRef = useRef(null);
  useDismissable(open, setOpen, [ref, panelRef]);
  // Portals to <body> — the sticky ribbon above traps a nested popover otherwise.
  const anchorRect = usePortalAnchor(open, ref);
  const pos = anchorRect && { top: anchorRect.bottom + 4, left: anchorRect.left };
  // Re-seed the draft from the committed filters whenever the panel is
  // closed, so reopening it starts clean instead of resuming a stale draft.
  useEffect(() => {
    if (open) return;
    setDraftTags(selTags); setDraftFav(favOnly); setDraftSignals(selSignals);
    setDraftFund(fund); setDraftCompanies(selCompanies);
    setDraftMetrics(selMetrics); setDraftPos(selPos); setPaneSearch("");
  }, [open, selTags, favOnly, selSignals, fund, selCompanies, selMetrics, selPos]);

  const apply = () => {
    onTags(draftTags); setFavOnly(draftFav); onSignals(draftSignals);
    onFund(draftFund); onCompanies(draftCompanies);
    onMetrics(draftMetrics); onPos(draftPos); setOpen(false);
  };
  // Also clears the draft — the panel can be open (drafts already seeded)
  // when this fires, and the reset effect below skips re-seeding while open.
  const resetAll = () => {
    onTags(new Set()); setFavOnly(false); onSignals(new Set()); onFund("ALL"); onCompanies(new Set(allCompanyIds));
    onMetrics(new Set(allMetricIds)); onPos(new Set());
    setDraftTags(new Set()); setDraftFav(false); setDraftSignals(new Set()); setDraftFund("ALL"); setDraftCompanies(new Set(allCompanyIds));
    setDraftMetrics(new Set(allMetricIds)); setDraftPos(new Set());
  };
  const resetDraft = () => {
    setDraftTags(new Set()); setDraftFav(false); setDraftSignals(new Set());
    setDraftFund("ALL"); setDraftCompanies(new Set(allCompanyIds));
    setDraftMetrics(new Set(allMetricIds)); setDraftPos(new Set());
  };
  const toggleDraftTag = (id) => {
    const s = new Set(draftTags);
    s.has(id) ? s.delete(id) : s.add(id);
    setDraftTags(s);
  };
  const toggleDraftSignal = (id) => {
    const s = new Set(draftSignals);
    s.has(id) ? s.delete(id) : s.add(id);
    setDraftSignals(s);
  };
  const toggleDraftCompany = (id) => {
    trackClick("PortfolioAnalytics.Dashboard.PickCompany");
    const s = new Set(draftCompanies);
    s.has(id) ? s.delete(id) : s.add(id);
    setDraftCompanies(s);
  };
  const toggleDraftMetric = (id) => {
    const s = new Set(draftMetrics);
    s.has(id) ? s.delete(id) : s.add(id);
    setDraftMetrics(s);
  };
  const toggleDraftPos = (id) => {
    const s = new Set(draftPos);
    s.has(id) ? s.delete(id) : s.add(id);
    setDraftPos(s);
  };

  // One Tag per active category — "Category: value", or "Category (n)" past one pick.
  const catTags = tagGroups
    .map((g) => {
      const picked = selIdsByCat.get(g.cat) || [];
      if (!picked.length) return null;
      const label = picked.length === 1 ? `${g.cat}: ${valueOfTagId.get(picked[0])}` : `${g.cat} (${picked.length})`;
      const clear = () => { const s = new Set(selTags); for (const id of picked) s.delete(id); onTags(s); };
      return { key: g.cat, label, clear };
    })
    .filter(Boolean);
  if (fund !== "ALL") {
    const fundLabel = fundOpts.find((o) => o.id === fund)?.label || fund;
    catTags.unshift({ key: "__fund", label: `Fund: ${fundLabel}`, clear: () => onFund("ALL") });
  }
  if (!allCompaniesShown) {
    catTags.splice(fund !== "ALL" ? 1 : 0, 0, { key: "__companies", label: `Companies (${selCompanies.size})`, clear: () => onCompanies(new Set(allCompanyIds)) });
  }
  if (selSignals.size > 0) {
    const names = selSignals.size === 1 ? [...selSignals].map((id) => signalOptions.find((s) => s.id === id)?.label || id) : null;
    catTags.push({ key: "__signals", label: names ? `Signal: ${names[0]}` : `Signals (${selSignals.size})`, clear: () => onSignals(new Set()) });
  }
  if (!allMetricsShown) {
    catTags.push({ key: "__kpis", label: `KPIs (${selMetrics.size})`, clear: () => onMetrics(new Set(allMetricIds)) });
  }
  if (selPos.size > 0) {
    catTags.push({ key: "__posmetrics", label: `Position KPIs (${selPos.size})`, clear: () => onPos(new Set()) });
  }

  const tagChip = ({ key, label, clear }) => (
    <span key={key} style={{ display: "inline-flex", alignItems: "center", height: 28, padding: "0 4px 0 8px",
      fontSize: 12, lineHeight: 1, whiteSpace: "nowrap", borderRadius: 4, boxSizing: "border-box",
      border: `1px solid ${GF_TAG_BORDER}`, background: GF_TAG_BG, color: GF_TAG_BORDER, ...sans }}>
      {label}
      <button onClick={clear} aria-label={`Clear ${label} filter`}
        style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", marginLeft: 6,
          width: 16, height: 16, border: "none", borderRadius: 3, background: "transparent",
          color: "inherit", cursor: "pointer", padding: 0 }}>×</button>
    </span>
  );

  const activeItem = navItems.find((n) => n.key === activePane);
  const activeGroup = activeItem?.group;
  const filteredValues = activeGroup
    ? activeGroup.values.filter((v) => v.toLowerCase().includes(paneSearch.toLowerCase()))
    : [];
  const filteredSignals = activePane === "__signals"
    ? signalOptions.filter((s) => s.label.toLowerCase().includes(paneSearch.toLowerCase()))
    : [];
  const filteredMetricOpts = activePane === "__kpis"
    ? metricOpts.filter((o) => o.label.toLowerCase().includes(paneSearch.toLowerCase()))
    : [];
  const filteredPosOpts = activePane === "__posmetrics"
    ? posOpts.filter((o) => o.label.toLowerCase().includes(paneSearch.toLowerCase()))
    : [];
  // Companies grouped by fund, in the same order fundOpts lists them, then
  // filtered by paneSearch — same grouped-checkbox shape as a tag category.
  const companyGroups = useMemo(() => {
    if (activePane !== "__companies") return [];
    const q = paneSearch.toLowerCase();
    const byGroup = new Map();
    for (const o of companyOpts) {
      if (q && !o.label.toLowerCase().includes(q)) continue;
      if (!byGroup.has(o.group)) byGroup.set(o.group, []);
      byGroup.get(o.group).push(o);
    }
    return [...byGroup];
  }, [activePane, companyOpts, paneSearch]);
  // A handful of options scan faster than they'd search — skip the search box.
  const SEARCH_MIN = 6;
  const showPaneSearch = activeGroup ? activeGroup.values.length > SEARCH_MIN
    : activePane === "__signals" ? signalOptions.length > SEARCH_MIN
    : activePane === "__companies" ? companyOpts.length > SEARCH_MIN
    : activePane === "__kpis" ? metricOpts.length > SEARCH_MIN
    : activePane === "__posmetrics" ? posOpts.length > SEARCH_MIN : false;

  const panel = open && (
        <div ref={panelRef} className="popin" style={{ position: "fixed", top: pos?.top ?? 0, left: pos?.left ?? 0,
          visibility: pos ? "visible" : "hidden", ...sans,
          width: 560, height: 416, background: "var(--ink-color-global-surface-background-default)",
          border: `1px solid var(--ink-color-global-border-subtle)`, borderRadius: 8, boxShadow: POPOVER_SHADOW,
          zIndex: Z.popover, display: "flex", overflow: "hidden" }}>
              <nav style={{ width: 180, background: GF_WARM_SURFACE, borderRight: `1px solid var(--ink-color-global-border-subtle)`,
                padding: "8px 0", overflowY: "auto", flex: "none" }}>
                {navItems.map(({ key, label, count: c }) => (
                  <button key={key} onClick={() => { setActivePane(key); setPaneSearch(""); }}
                    style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%",
                      height: 36, padding: "0 16px", gap: 10, fontSize: 14, lineHeight: "20px", fontWeight: activePane === key ? 500 : 400,
                      color: "var(--ink-color-global-text-default)", cursor: "pointer", border: "none", textAlign: "left",
                      background: activePane === key ? GF_NAV_ACTIVE_BG : "transparent", ...sans }}
                    onMouseEnter={(e) => { if (activePane !== key) e.currentTarget.style.background = "var(--ink-color-global-surface-lightgray-default)"; }}
                    onMouseLeave={(e) => { if (activePane !== key) e.currentTarget.style.background = "transparent"; }}>
                    <span>{label}</span>
                    {c > 0 && (
                      <span style={{ display: "inline-flex", alignItems: "center", height: 18, padding: "0 8px", fontSize: 12,
                        fontWeight: 500, letterSpacing: "0.01em", borderRadius: 999, whiteSpace: "nowrap", boxSizing: "border-box",
                        border: `1px solid var(--ink-color-global-feedback-info-strong)`, background: GF_BUBBLE_BG,
                        color: "var(--ink-color-global-feedback-info-strong)", ...sans }}>{c}</span>
                    )}
                  </button>
                ))}
              </nav>
              <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                <div style={{ flex: 1, padding: "20px 24px", overflowY: "auto" }}>
                  {activeItem?.group ? (
                    <>
                      <h3 style={{ ...sans, fontSize: 14, fontWeight: 500, color: "var(--ink-color-global-text-default)", margin: "0 0 14px" }}>
                        Filter by {activeItem.label.toLowerCase()}
                      </h3>
                      {activeGroup.values.length === 0 ? (
                        <p style={{ ...sans, fontSize: FS.bodyLg, color: MICRO, margin: 0 }}>
                          {!hasCartaTags
                            ? "Carta tags come from Fund Admin holdings — this firm has none."
                            : "Nothing to filter by yet."}
                        </p>
                      ) : (
                        <>
                          {showPaneSearch && (
                            <SearchInput placeholder={`Search ${activeItem.label.toLowerCase()}`} value={paneSearch}
                              onChange={(e) => setPaneSearch(e.target.value)} style={{ width: "100%" }} />
                          )}
                          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: showPaneSearch ? 12 : 0 }}>
                            {filteredValues.map((v) => {
                              const id = tagId(activeGroup.cat, v);
                              return (
                                <label key={id} style={{ ...sans, display: "flex", alignItems: "center", gap: 10,
                                  fontSize: 14, color: "var(--ink-color-global-text-default)", cursor: "pointer" }}>
                                  <input type="checkbox" checked={draftTags.has(id)} onChange={() => toggleDraftTag(id)}
                                    style={{ width: 16, height: 16, margin: 0, accentColor: "var(--ink-color-global-border-active)", cursor: "pointer" }} />
                                  {v}
                                  <span style={{ marginLeft: "auto", color: "var(--ink-color-global-text-subtle)", fontSize: 12 }}>
                                    {tagCounts.get(id) || 0}
                                  </span>
                                </label>
                              );
                            })}
                          </div>
                        </>
                      )}
                    </>
                  ) : activePane === "__signals" ? (
                    <>
                      <h3 style={{ ...sans, fontSize: 14, fontWeight: 500, color: "var(--ink-color-global-text-default)", margin: "0 0 14px" }}>
                        Filter by signals
                      </h3>
                      {showPaneSearch && (
                        <SearchInput placeholder="Search signals" value={paneSearch}
                          onChange={(e) => setPaneSearch(e.target.value)} style={{ width: "100%" }} />
                      )}
                      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: showPaneSearch ? 12 : 0 }}>
                        {filteredSignals.map((s) => (
                          <label key={s.id} style={{ ...sans, display: "flex", alignItems: "center", gap: 10,
                            fontSize: 14, color: "var(--ink-color-global-text-default)", cursor: "pointer" }}>
                            <input type="checkbox" checked={draftSignals.has(s.id)} onChange={() => toggleDraftSignal(s.id)}
                              style={{ width: 16, height: 16, margin: 0, accentColor: "var(--ink-color-global-border-active)", cursor: "pointer" }} />
                            {s.label}
                            <span style={{ marginLeft: "auto", color: "var(--ink-color-global-text-subtle)", fontSize: 12 }}>
                              {s.count}
                            </span>
                          </label>
                        ))}
                      </div>
                    </>
                  ) : activePane === "__fund" ? (
                    <>
                      <h3 style={{ ...sans, fontSize: 14, fontWeight: 500, color: "var(--ink-color-global-text-default)", margin: "0 0 14px" }}>
                        Filter by fund
                      </h3>
                      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                        {fundOpts.map((o) => (
                          <label key={o.id} style={{ ...sans, display: "flex", alignItems: "center", gap: 10,
                            fontSize: 14, color: "var(--ink-color-global-text-default)", cursor: "pointer" }}>
                            <input type="radio" name="gf-fund" checked={draftFund === o.id} onChange={() => setDraftFund(o.id)}
                              style={{ width: 16, height: 16, margin: 0, accentColor: "var(--ink-color-global-border-active)", cursor: "pointer" }} />
                            {o.label}
                          </label>
                        ))}
                      </div>
                    </>
                  ) : activePane === "__companies" ? (
                    <>
                      <h3 style={{ ...sans, fontSize: 14, fontWeight: 500, color: "var(--ink-color-global-text-default)", margin: "0 0 14px" }}>
                        Filter by companies
                      </h3>
                      {showPaneSearch && (
                        <SearchInput placeholder="Search companies" value={paneSearch}
                          onChange={(e) => setPaneSearch(e.target.value)} style={{ width: "100%" }} />
                      )}
                      {companyGroups.length > 0 && (
                        <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
                          <Btn kind="link" style={{ fontSize: FS.small }}
                            onClick={() => setDraftCompanies(new Set([...draftCompanies, ...companyGroups.flatMap(([, opts]) => opts.map((o) => o.id))]))}>
                            Select all{paneSearch ? " matching" : ""}
                          </Btn>
                          <Btn kind="link" style={{ fontSize: FS.small }}
                            onClick={() => {
                              const visible = new Set(companyGroups.flatMap(([, opts]) => opts.map((o) => o.id)));
                              setDraftCompanies(new Set([...draftCompanies].filter((id) => !visible.has(id))));
                            }}>
                            Clear{paneSearch ? " matching" : ""}
                          </Btn>
                        </div>
                      )}
                      {companyGroups.length === 0 && (
                        <p style={{ ...sans, fontSize: FS.bodyLg, color: MICRO, margin: 0 }}>
                          {paneSearch ? `No companies match "${paneSearch}".` : "No companies to filter by."}
                        </p>
                      )}
                      {companyGroups.map(([group, opts]) => (
                        <div key={group} style={{ marginTop: 16 }}>
                          <div style={{ ...sans, fontSize: FS.micro, fontWeight: 600, color: MICRO, textTransform: "uppercase", margin: "0 0 8px" }}>{group}</div>
                          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                            {opts.map((o) => (
                              <label key={o.id} style={{ ...sans, display: "flex", alignItems: "center", gap: 10,
                                fontSize: 14, color: "var(--ink-color-global-text-default)", cursor: "pointer" }}>
                                <input type="checkbox" checked={draftCompanies.has(o.id)} onChange={() => toggleDraftCompany(o.id)}
                                  style={{ width: 16, height: 16, margin: 0, accentColor: "var(--ink-color-global-border-active)", cursor: "pointer" }} />
                                {o.label}
                              </label>
                            ))}
                          </div>
                        </div>
                      ))}
                    </>
                  ) : activePane === "__kpis" ? (
                    <>
                      <h3 style={{ ...sans, fontSize: 14, fontWeight: 500, color: "var(--ink-color-global-text-default)", margin: "0 0 14px" }}>
                        Filter by KPIs
                      </h3>
                      {showPaneSearch && (
                        <SearchInput placeholder="Search KPIs" value={paneSearch}
                          onChange={(e) => setPaneSearch(e.target.value)} style={{ width: "100%" }} />
                      )}
                      {filteredMetricOpts.length > 0 && (
                        <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
                          <Btn kind="link" style={{ fontSize: FS.small }}
                            onClick={() => setDraftMetrics(new Set([...draftMetrics, ...filteredMetricOpts.map((o) => o.id)]))}>
                            Select all{paneSearch ? " matching" : ""}
                          </Btn>
                          <Btn kind="link" style={{ fontSize: FS.small }}
                            onClick={() => {
                              const visible = new Set(filteredMetricOpts.map((o) => o.id));
                              setDraftMetrics(new Set([...draftMetrics].filter((id) => !visible.has(id))));
                            }}>
                            Clear{paneSearch ? " matching" : ""}
                          </Btn>
                        </div>
                      )}
                      {filteredMetricOpts.length === 0 && (
                        <p style={{ ...sans, fontSize: FS.bodyLg, color: MICRO, margin: 0 }}>No KPIs match "{paneSearch}".</p>
                      )}
                      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: showPaneSearch ? 12 : 0 }}>
                        {filteredMetricOpts.map((o) => (
                          <label key={o.id} style={{ ...sans, display: "flex", alignItems: "center", gap: 10,
                            fontSize: 14, color: "var(--ink-color-global-text-default)", cursor: "pointer" }}>
                            <input type="checkbox" checked={draftMetrics.has(o.id)} onChange={() => toggleDraftMetric(o.id)}
                              style={{ width: 16, height: 16, margin: 0, accentColor: "var(--ink-color-global-border-active)", cursor: "pointer" }} />
                            {o.label}
                          </label>
                        ))}
                      </div>
                    </>
                  ) : activePane === "__posmetrics" ? (
                    <>
                      <h3 style={{ ...sans, fontSize: 14, fontWeight: 500, color: "var(--ink-color-global-text-default)", margin: "0 0 14px" }}>
                        Position KPIs
                      </h3>
                      <p style={{ ...sans, fontSize: FS.small, color: MICRO, margin: "0 0 14px" }}>
                        Facts about your stake — ownership, returns and marks — rather than the company's own operations.
                        Each is a single point-in-time value, shown in the newest actual column with its own as-of date on hover.
                      </p>
                      {showPaneSearch && (
                        <SearchInput placeholder="Search position KPIs" value={paneSearch}
                          onChange={(e) => setPaneSearch(e.target.value)} style={{ width: "100%" }} />
                      )}
                      {filteredPosOpts.length === 0 && (
                        <p style={{ ...sans, fontSize: FS.bodyLg, color: MICRO, margin: 0 }}>No position KPIs match "{paneSearch}".</p>
                      )}
                      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: showPaneSearch ? 12 : 0 }}>
                        {filteredPosOpts.map((o) => (
                          <label key={o.id} style={{ ...sans, display: "flex", alignItems: "center", gap: 10,
                            fontSize: 14, color: "var(--ink-color-global-text-default)", cursor: "pointer" }}>
                            <input type="checkbox" checked={draftPos.has(o.id)} onChange={() => toggleDraftPos(o.id)}
                              style={{ width: 16, height: 16, margin: 0, accentColor: "var(--ink-color-global-border-active)", cursor: "pointer" }} />
                            {o.label}
                          </label>
                        ))}
                      </div>
                    </>
                  ) : (
                    <>
                      <h3 style={{ ...sans, fontSize: 14, fontWeight: 500, color: "var(--ink-color-global-text-default)", margin: "0 0 14px" }}>
                        Filter by favorites
                      </h3>
                      <label style={{ ...sans, display: "flex", alignItems: "center", gap: 10, fontSize: 14,
                        color: "var(--ink-color-global-text-default)", cursor: "pointer" }}>
                        <input type="checkbox" checked={draftFav} onChange={(e) => setDraftFav(e.target.checked)}
                          style={{ width: 16, height: 16, margin: 0, accentColor: "var(--ink-color-global-border-active)", cursor: "pointer" }} />
                        Show only starred companies
                      </label>
                      <p style={{ ...sans, fontSize: FS.bodyLg, color: MICRO, margin: "10px 0 0" }}>
                        On a firm's first load, the top quartile by position size (total cost basis) is
                        auto-favorited — click the star on any row or company to change the list ({favTotal} starred).
                      </p>
                    </>
                  )}
                </div>
                <div style={{ display: "flex", justifyContent: "flex-end", gap: 8,
                  padding: "12px 24px", borderTop: `1px solid var(--ink-color-global-border-subtle)` }}>
                  <Btn onClick={resetDraft}>Reset</Btn>
                  <Btn kind="primary" onClick={apply}>Apply</Btn>
                </div>
              </div>
        </div>
  );

  return (
    <div ref={ref} style={{ position: "relative", display: "inline-flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
      <button onClick={() => setOpen((o) => !o)} className={`dd-trigger${open ? " is-open" : ""}`}
        style={{ ...ddTriggerStyle({ minWidth: 110 }), cursor: "pointer" }}>
        <span>Filters</span>
        <ChevronDownIcon size={16} strokeWidth={1.5} style={{ flex: "none" }} />
      </button>

      {catTags.map(tagChip)}
      {favOnly && tagChip({ key: "__favorites", label: "Favorites only", clear: () => setFavOnly(false) })}
      {(catTags.length > 0 || favOnly) && (
        <button onClick={resetAll} style={{ height: 28, padding: "0 8px", border: "none", borderRadius: 4,
          background: "transparent", color: "var(--ink-color-global-text-default)", fontSize: 12, fontWeight: 500,
          cursor: "pointer", ...sans }}>Reset</button>
      )}

      {panel && createPortal(panel, document.body)}
    </div>
  );
}

const FieldCol = ({ label, children }) => (
  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
    <Eyebrow color={MICRO}>{label}</Eyebrow>
    {children}
  </div>
);

/** A titled group of controls inside the settings modal — a heading over a
 *  wrapping row of the controls it holds. */
const Section = ({ title, children }) => (
  <div style={{ marginBottom: 22 }}>
    <Eyebrow color={MICRO} style={{ marginBottom: 10 }}>{title}</Eyebrow>
    <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>{children}</div>
  </div>
);

/** Conditional-formatting editor: pick a metric, then either a color scale
 *  (gradient across its range) or color rules (threshold → color). */
function FormatPanel({ metrics, formats, onSave, onRemove }) {
  const [metricKey, setMetricKey] = useState("");
  const [type, setType] = useState("scale");
  const [palette, setPalette] = useState("gyr");
  const [basis, setBasis] = useState("value"); // "value" | "growth" (% change)
  const [scope, setScope] = useState("portfolio"); // "portfolio" | "row" (per company)
  const [rules, setRules] = useState([{ op: "lt", value: "", color: "red" }]);
  const growth = basis === "growth";

  const metricOpts = metricOptions(metrics);
  const configured = Object.keys(formats);
  const labelOf = (k) => (metricOf({ metrics }, k) || {}).label || k;

  const loadMetric = (k) => {
    setMetricKey(k);
    const f = formats[k];
    // Load saved options only when editing a metric that already has a format.
    // Retargeting to an unconfigured metric keeps the in-progress options, not resets them.
    if (!f) return;
    setBasis(f.basis === "growth" ? "growth" : "value");
    setScope(f.scope === "row" ? "row" : "portfolio");
    if (f.type === "rules") { setType("rules"); setRules(f.rules?.length ? f.rules.map((r) => ({ op: r.op, value: String(r.value), color: r.color })) : [{ op: "lt", value: "", color: "red" }]); }
    else if (f.type === "scale") { setType("scale"); setPalette(f.palette || "gyr"); }
  };
  const reset = () => { setMetricKey(""); setType("scale"); setPalette("gyr"); setBasis("value"); setScope("portfolio"); setRules([{ op: "lt", value: "", color: "red" }]); };

  const validRules = rules.filter((r) => r.value !== "" && Number.isFinite(Number(r.value)));
  const canSave = metricKey && (type === "scale" || validRules.length > 0);
  const save = () => {
    if (!canSave) return;
    const base = type === "scale"
      ? { type: "scale", palette, scope }
      : { type: "rules", rules: validRules.map((r) => ({ op: r.op, value: Number(r.value), color: r.color })) };
    onSave(metricKey, { ...base, basis });
    reset();
  };
  const setRule = (i, patch) => setRules((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const addRule = () => setRules((rs) => [...rs, { op: "gt", value: "", color: "green" }]);
  const rmRule = (i) => setRules((rs) => (rs.length > 1 ? rs.filter((_, j) => j !== i) : rs));

  const opOpts = OPS.map((o) => ({ id: o.id, label: o.sym }));
  const colorOpts = Object.entries(RULE_COLORS).map(([id, c]) => ({ id, label: c.label }));
  const scaleOpts = Object.entries(SCALES).map(([id, s]) => ({ id, label: s.label }));

  return (
    <div className="card" style={{ padding: 16, marginBottom: 14 }}>
      <div style={{ ...sans, fontWeight: 600, fontSize: FS.bodyLg }}>Conditional formatting</div>
      <div style={{ ...sans, fontSize: FS.small, color: MICRO, margin: "4px 0 12px" }}>
        Color a KPI’s cells by a gradient (color scale) or by threshold rules (color codes). Applies across the whole pivot.
        Set <strong>Apply to</strong> to color by each cell’s period-over-period % change (QoQ on the quarter grid, MoM otherwise) instead of the figure.
        For a color scale, <strong>Normalize</strong> chooses the gradient’s range: <em>Across portfolio</em> compares every company on one scale, while <em>Per company</em> scales each company’s own row so the colors read as that company’s trend over time.
      </div>

      {configured.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 14 }}>
          {configured.map((k) => (
            <div key={k} style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
              padding: "7px 10px", borderRadius: 6, background: "var(--ink-color-global-surface-lightgray-default)" }}>
              {formats[k].type === "scale" && <span style={{ width: 44, height: 14, borderRadius: 3, flex: "none", background: `linear-gradient(to right, ${(SCALES[formats[k].palette] || SCALES.gyr).stops.join(",")})` }} />}
              <span style={{ ...sans, fontWeight: 600, fontSize: FS.small }}>{labelOf(k)}</span>
              <span style={{ ...sans, fontSize: FS.small, color: MICRO }}>{formatSummary(formats[k])}</span>
              <span style={{ flex: 1 }} />
              <Btn kind="link" style={{ fontSize: FS.small }} onClick={() => loadMetric(k)}>Edit</Btn>
              <Btn kind="link" style={{ fontSize: FS.small, color: NEG }} onClick={() => onRemove(k)}>Remove</Btn>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
        <FieldCol label="KPI">
          <Dropdown options={metricOpts} value={metricKey || null} nullLabel="Choose a KPI…" onChange={loadMetric} minWidth={220} />
        </FieldCol>
        <FieldCol label="Format">
          <Segmented small options={[{ id: "scale", label: "Color scale" }, { id: "rules", label: "Color rules" }]} value={type} onChange={setType} />
        </FieldCol>
        <FieldCol label="Apply to">
          <Segmented small options={[{ id: "value", label: "Value" }, { id: "growth", label: "% change (QoQ/MoM)" }]} value={basis} onChange={setBasis} />
        </FieldCol>
        {type === "scale" && (
          <FieldCol label="Scale">
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <Dropdown options={scaleOpts} value={palette} onChange={setPalette} minWidth={240} />
              <span style={{ width: 90, height: 20, borderRadius: 3, flex: "none", border: "1px solid var(--ink-color-global-border-default)", background: `linear-gradient(to right, ${(SCALES[palette] || SCALES.gyr).stops.join(",")})` }} />
            </div>
          </FieldCol>
        )}
        {type === "scale" && (
          <FieldCol label="Normalize">
            <Segmented small options={[{ id: "portfolio", label: "Across portfolio" }, { id: "row", label: "Per company" }]} value={scope} onChange={setScope} />
          </FieldCol>
        )}
      </div>

      {type === "rules" && (
        <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
          {rules.map((r, i) => (
            <div key={i} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <span style={{ ...sans, fontSize: FS.small, color: MICRO }}>{growth ? "If % change" : "If value"}</span>
              <Dropdown options={opOpts} value={r.op} onChange={(v) => setRule(i, { op: v })} minWidth={64} />
              <TextInput inputMode="decimal" placeholder="0" value={r.value} onChange={(e) => setRule(i, { value: e.target.value.replace(/[^0-9.\-]/g, "") })} style={{ width: 100 }} />
              {growth && <span style={{ ...sans, fontSize: FS.small, color: MICRO }}>%</span>}
              <span style={{ ...sans, fontSize: FS.small, color: MICRO }}>→</span>
              <Dropdown options={colorOpts} value={r.color} onChange={(v) => setRule(i, { color: v })} minWidth={104} />
              <span style={{ width: 16, height: 16, borderRadius: 3, flex: "none", background: (RULE_COLORS[r.color] || {}).bg, border: "1px solid var(--ink-color-global-border-default)" }} />
              {rules.length > 1 && <Btn kind="link" style={{ color: NEG, fontSize: FS.body }} onClick={() => rmRule(i)}>×</Btn>}
            </div>
          ))}
          <div><Btn onClick={addRule}>+ Add rule</Btn></div>
          <div style={{ ...sans, fontSize: FS.micro, color: MICRO }}>Rules are checked top-to-bottom; the first match colors the cell.{growth && " Thresholds are in percent points — 10 means +10%."}</div>
        </div>
      )}

      <div style={{ display: "flex", gap: 8, marginTop: 14, alignItems: "center" }}>
        <Btn kind="primary" onClick={save} disabled={!canSave}>{formats[metricKey] ? "Update formatting" : "Apply formatting"}</Btn>
        {metricKey && <Btn onClick={reset}>Clear</Btn>}
      </div>
    </div>
  );
}

// Forecast tint — a light blue wash marking a cell as a company's own estimate
// rather than something reported. Alpha over the surface so it reads the same in
// light and dark mode, and pale enough that the figure stays legible.
const FC_BG = "rgba(56,132,255,0.10)";
// The header version must be OPAQUE: it's sticky, so a translucent fill let the
// rows scrolling underneath show through it. Layering the wash over the header's
// own surface colour keeps the theme token AND blocks what's behind.
const FC_HEAD_BG = "linear-gradient(rgba(56,132,255,0.16), rgba(56,132,255,0.16)), "
  + "var(--ink-color-global-surface-background-default)";

// Clip a long free-text answer to one line inside the value cell; the full text
// stays available on hover via the cell's data-tip.
const TRUNCATE = { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };

const csv = (s) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

/** Move from the first to the last reported value across the periods shown, oldest
 *  to newest — `periods` may be newest-first, so never trust array order. Returns
 *  `{dir, pct}` for DeltaText, or null when there's nothing meaningful to state. */
function trendChange(byPeriod, periods) {
  const pts = periods.map((p) => ({ d: p, v: byPeriod[p] }))
    .filter((x) => Number.isFinite(x.v))
    .sort((a, b) => String(a.d).localeCompare(String(b.d)));
  if (pts.length < 2) return null;
  const a = pts[0].v, b = pts[pts.length - 1].v;
  if (a === b || a === 0) return null;   // no move, or no base to express a % against
  // pct is unsigned because the arrow already carries direction, as everywhere
  // else in the app. `dir` compares the raw values, so a loss shrinking
  // (−100 → −50) correctly reads as "up". (The |a| below is belt-and-braces:
  // the outer Math.abs already makes the sign of the base irrelevant.)
  return { dir: b > a ? "up" : "down", pct: Math.abs(((b - a) / Math.abs(a)) * 100) };
}

const stickyHead = {
  // Opaque page background (not grey) — needed only because this header is sticky
  // over scrolling content; matches .sticky-clone's own backing in theme.js.
  position: "sticky", top: 0, background: "var(--ink-color-global-surface-background-default)",
  padding: "9px 14px", fontWeight: 500, color: "var(--ink-color-global-text-default)", fontSize: 14,
  borderBottom: `1px solid var(--ink-color-global-border-default)`,
  fontFamily: "inherit",
};
// No maxWidth here — each consumer sets its own from CO_W/KPI_W/POS_W, since a
// shared hardcoded value silently stops matching once any of those diverge.
const stickyCell = {
  position: "sticky", background: "var(--ink-color-global-surface-background-default)",
  padding: "9px 14px", whiteSpace: "nowrap", borderBottom: `1px solid var(--ink-color-global-border-subtle)`,
  overflow: "hidden", textOverflow: "ellipsis",
};

/** Which `[data-company-anchor]` cell straddles `targetTop`: `{ id, boxRef, innerRef }`,
 *  or null when none does or the table hasn't reached `ceiling`. The caller renders a
 *  fixed clip box (boxRef) holding the label (innerRef); the hook places both directly
 *  in the scroll event, so the next company pushing this label out never trails the
 *  scroll by a frame the way state-driven geometry would. */
function useActiveCompanyBand(tableRef, targetTop, ceiling) {
  const [id, setId] = useState(null);
  const boxRef = useRef(null), innerRef = useRef(null);
  const shownRef = useRef(null); // company whose label the box has actually rendered
  const place = useCallback(() => {
    const table = tableRef.current;
    if (!table || table.getBoundingClientRect().top >= ceiling) return null;
    for (const td of table.querySelectorAll("td[data-company-anchor]")) {
      const r = td.getBoundingClientRect();
      // Inclusive top: when one cell's bottom lands exactly on targetTop the next
      // cell's top does too, and a strict test would leave no band for that frame.
      if (r.top <= targetTop && r.bottom > targetTop) {
        const labelH = td.firstElementChild?.getBoundingClientRect().height || 0;
        const box = boxRef.current, inner = innerRef.current;
        if (box && inner) {
          // Until React has rendered the new company's label the box still shows the
          // old one; hide it for that frame — the new company's static label is on screen.
          box.style.visibility = shownRef.current === td.dataset.companyAnchor ? "visible" : "hidden";
          box.style.left = `${r.left}px`; box.style.width = `${r.width}px`; box.style.height = `${labelH}px`;
          // Rides its own cell's bottom edge out once the next company reaches it.
          inner.style.top = `${Math.min(0, r.bottom - labelH - targetTop)}px`;
        }
        return td.dataset.companyAnchor;
      }
    }
    return null;
  }, [tableRef, targetTop, ceiling]);
  // The clip box mounts one render after `id` changes — place it before that paint.
  useLayoutEffect(() => { shownRef.current = id; if (id) place(); }, [id, place]);
  useEffect(() => {
    const update = () => setId(place());
    update();
    document.addEventListener("scroll", update, { capture: true, passive: true });
    window.addEventListener("resize", update);
    const ro = new ResizeObserver(update);
    if (tableRef.current) ro.observe(tableRef.current);
    return () => {
      document.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
      ro.disconnect();
    };
  }, [tableRef, place]);
  return id ? { id, boxRef, innerRef } : null;
}

/** The pivot table's header `<tr>`, shared by the real `<thead>` and its floating
 *  clone, which passes its measured `colWidths`. Neither sticks vertically (the clone
 *  floats as a whole); frozen columns pin with sticky-left in both, since the clone's
 *  clip box is a scroll container just like the table's wrapper. */
function renderPivotHeadRow(colDefs, colWidths) {
  return (
    <tr>
      {colDefs.map((c, i) => {
        // The real header caps width only on period columns — Company/KPI/POS stay uncapped.
        const w = colWidths
          ? { width: colWidths[i], minWidth: colWidths[i], maxWidth: colWidths[i] }
          : { width: c.width, minWidth: c.width, ...(c.frozen ? {} : { maxWidth: c.width }) };
        const style = { ...stickyHead, top: undefined, textAlign: c.align, cursor: c.cursor,
          background: c.background ?? stickyHead.background,
          position: c.frozen ? "sticky" : "static",
          ...(c.frozen ? { left: c.left, zIndex: 3 } : { zIndex: 2 }),
          // Divider where frozen columns end — box-shadow, not border-right (a
          // sticky cell's own border can fail to repaint once actually stuck).
          ...(c.lastFrozen ? { boxShadow: LAST_FROZEN_DIVIDER } : {}), ...w };
        return <th key={c.key} data-tip={c.dataTip} style={style}>{c.content}</th>;
      })}
    </tr>
  );
}
