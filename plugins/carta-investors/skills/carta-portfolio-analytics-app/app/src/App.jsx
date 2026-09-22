import { useState, useEffect, useRef, useMemo, useSyncExternalStore } from "react";
import { FS, serif, sans, GLOBAL_CSS, MICRO } from "./ui/theme.js";
import { Mark, SunIcon, MoonIcon, useDismissable, Eyebrow, TooltipLayer, Dropdown, TextInput } from "./ui/components.jsx";
import UpdateDataButton from "./ui/UpdateDataButton.jsx";
import { capTableCompanies } from "./model/captable.js";
import { getFocus, openPortfolio } from "./state/focus.js";
import { setDisplayCurrency, fmtAsOf, fmtRelative, oldestDatasetFetch } from "./ui/format.js";
import { parseRoute, navigate, subscribeNav } from "./route.js";
import useKpi from "./state/useKpi.js";
import useDashboard from "./state/useDashboard.js";
import useNow from "./state/useNow.js";
import { trackClick, trackRender } from "./analytics.js";
import { lsGet, lsSet } from "./state/storage.js";
import { ChartPrefsProvider } from "./state/chartPrefs.js";
import { setChartContext, TrendSparklineDefs } from "./ui/charts.jsx";
import { withCustomMetrics } from "./model/derived.js";
import { withCurrency, presentCurrencies, DEFAULT_CURRENCY } from "./model/currency.js";
import { seedDefaultFormulas } from "./model/formula.js";
import { seedFavorites } from "./model/favorites.js";
import Overview from "./views/Overview.jsx";
import PivotDashboard from "./views/PivotDashboard.jsx";
import Coverage from "./views/Coverage.jsx";
import CompanyPage from "./views/CompanyPage.jsx";
import Portfolio from "./views/Portfolio.jsx";
import Formulas from "./views/Formulas.jsx";

const I = ({ d, extra, viewBox = "0 0 24 24", color = "var(--ink-color-global-text-subtle)", size = 17 }) => (
  <svg width={size} height={size} viewBox={viewBox} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={{ flex: "none", color }}>
    <path d={d} />{extra && <path d={extra} />}
  </svg>
);
// Route ids are stable; labels are what the sidebar shows. The Portfolio tab's mode
// switch also hosts Benchmarks — the old standalone `benchmarks` tab folded in as a
// mode — so old /benchmarks and /captable links redirect to their current homes (see
// App below).
// Icon sourcing: "overview" uses Ink's own SideNav reference bolt icon
// (theme-with-ink/resources/components-sidenav.html), drawn on a 20x20 grid, hence
// the viewBox override. The rest are Lucide glyphs (Ink's canonical icon stand-in,
// see theme-with-ink/brand.md) on the app's native 24x24 grid, picked with the user
// via AskUserQuestion. "company" (Lucide building-2) and "formulas" (Lucide
// calculator) were already correct pre-retrofit, so they're untouched.
// "company" is a second-level page (a company's own deep-dive), not a top-level
// section — it has no nav row of its own (`navHidden`) and is reached only by
// clicking a company name. While it's open, the "Company KPIs" row highlights
// instead, since that's the closest top-level section it belongs under.
const TABS = [
  { id: "overview",   label: "Overview",         icon: "M11 3 4 11h6l-1 6 7-8h-6l1-6z",                                                                                                                                              extra: null, viewBox: "0 0 20 20" },
  { id: "dashboard",  label: "Company KPIs",     icon: "M18 20V10M12 20V4M6 20V14",                                                                                                                                                  extra: null },
  { id: "portfolio",  label: "Insights",         icon: "M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5M9 18h6M10 22h4",                                                       extra: null },
  { id: "review",     label: "Reporting health", icon: "M10 2.5l6 2v5c0 3.5-2.5 6.5-6 8-3.5-1.5-6-4.5-6-8v-5l6-2zM7.5 10l2 2 3.5-4", extra: null, viewBox: "0 0 20 20" },
  { id: "company",    label: "Company",          icon: "M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18ZM6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2M10 6h4M10 10h4M10 14h4M10 18h4",                 extra: null, navHidden: true },
  { id: "formulas",   label: "Custom formulas",  icon: "M5 2h14a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2ZM8 6h8M8 10h.01M12 10h.01M16 10h.01M8 14h.01M12 14h.01M16 14v4M8 18h.01M12 18h.01",               extra: null },
];
const TAB_IDS = TABS.map((t) => t.id);
const TAB_LABEL = Object.fromEntries(TABS.map((t) => [t.id, t.label]));
const NAV_TABS = TABS.filter((t) => !t.navHidden);
// The nav row that should read as active while a hidden (second-level) tab is open.
const NAV_ALIAS = { company: "dashboard" };
const isNavActive = (tab, id) => (NAV_ALIAS[tab] || tab) === id;
const DEFAULT_TAB = "overview";

function useTabRoute(firm) {
  const raw = useSyncExternalStore(subscribeNav, () => parseRoute().tab, () => null);
  const tab = TAB_IDS.includes(raw) ? raw : DEFAULT_TAB;
  const setTab = (t) => { if (parseRoute().tab !== t) navigate({ firm, tab: t }); };
  return [tab, setTab];
}

function useNarrow() {
  const [narrow, setNarrow] = useState(typeof window !== "undefined" && window.innerWidth < 1020);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 1020px)");
    const fn = () => setNarrow(mq.matches);
    fn(); mq.addEventListener("change", fn);
    return () => mq.removeEventListener("change", fn);
  }, []);
  return narrow;
}

// Background, border-radius, active box-shadow (left stripe), and active font-weight
// are left to the .navitem / .navitem.active CSS rules (theme.js GLOBAL_CSS) — not set
// here — so the CSS :hover rule isn't shadowed by a higher-specificity inline style,
// and the active stripe's inset box-shadow isn't clipped to a rounded corner that only
// the JS side knew about.
// Padding matches .sn__item exactly (10px 14px) — Ink's own comment there notes it
// centers a 20px icon in the 48px closed rail.
const navItemStyle = { ...sans, display: "flex", alignItems: "center", gap: 12, width: "100%", textAlign: "left",
  fontSize: FS.value, lineHeight: "20px", padding: "10px 14px", border: "none",
  cursor: "pointer", color: "var(--ink-color-global-text-default)" };

// Sidebar action buttons sit at the bottom of the nav, so their popovers open
// upward from there; chrome buttons open downward from the top bar.
const popoverAnchor = (inSidebar) => (inSidebar
  ? { left: 0, bottom: "calc(100% + 8px)" }
  : { right: 0, top: "calc(100% + 8px)" });
const popoverWrapStyle = (inSidebar) => ({ position: "relative", lineHeight: inSidebar ? "normal" : 0, display: inSidebar ? "block" : "inline-block" });

// Bordered chips (not plain list rows) so the sidebar actions read as buttons,
// distinct from the NavItem tabs above them.
const sidebarActionStyle = { ...sans, display: "flex", alignItems: "center", gap: 8, width: "100%", textAlign: "left",
  fontSize: 13, fontWeight: 400, padding: "0 12px", height: 40, border: "1px solid var(--ink-color-global-border-subtle)",
  borderRadius: 4, cursor: "pointer", background: "var(--ink-color-global-surface-background-default)",
  color: "var(--ink-color-global-text-default)" };

function NavItem({ id, label, icon, extra, viewBox, active, onClick }) {
  return (
    <button onClick={onClick} data-testid={`tab-${id}`} className={`navitem${active ? " active" : ""}`} style={navItemStyle}>
      {/* Ink's SideNav gives the active row's icon its own orange tile (dark glyph on
          top) — the tile's background lives in CSS (.navitem.active .navitem-icon),
          but the glyph color has to go through I's own color prop, since I sets it
          via inline style, which a CSS descendant selector can't override. */}
      <span className="navitem-icon"><I d={icon} extra={extra} viewBox={viewBox} size={20} color={active ? "var(--ink-color-global-brand-black)" : undefined} /></span>{label}
    </button>
  );
}

const iconBtn = { display: "inline-flex", alignItems: "center", justifyContent: "center", width: 40, height: 40,
  border: `1px solid var(--ink-color-global-border-subtle)`, borderRadius: 4,
  background: "var(--ink-color-global-surface-background-default)", color: "var(--ink-color-global-text-subtle)", cursor: "pointer", lineHeight: 0 };

/** Global currency control: exclude currencies from every view, and convert KPI
 *  values to one target using rates you enter (blank = left as reported). */
function CurrencyMenu({ present, fundCurrency, value, onChange, variant }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useDismissable(open, setOpen, ref);
  if (!present.length) return null; // single-currency firm — nothing to control
  const inSidebar = variant === "sidebar";

  const target = value.target || fundCurrency;
  const excluded = new Set(value.excluded || []);
  const rates = value.rates || {};
  const active = (value.excluded || []).length > 0 || Object.keys(rates).some((k) => k !== target && rates[k] > 0);
  const targetOpts = [...new Set([fundCurrency, ...present])].filter(Boolean).map((c) => ({ id: c, label: c }));

  // Rates are quoted against the target, so a target change invalidates them.
  const setTarget = (t) => { trackClick("PortfolioAnalytics.Currency.SetTarget"); onChange({ ...value, target: t, rates: {}, excluded: (value.excluded || []).filter((c) => c !== t) }); };
  const setRate = (cur, raw) => {
    const n = parseFloat(raw), next = { ...rates };
    if (raw === "" || !Number.isFinite(n) || n <= 0) delete next[cur]; else next[cur] = n;
    onChange({ ...value, target, rates: next });
  };
  const toggleExcl = (cur) => {
    const s = new Set(excluded); s.has(cur) ? s.delete(cur) : s.add(cur);
    onChange({ ...value, excluded: [...s] });
  };

  const rowLbl = { ...sans, fontSize: FS.small, color: "var(--ink-color-global-text-default)" };
  const note = { ...sans, fontSize: FS.micro, color: "var(--ink-color-global-text-subtle)", lineHeight: 1.5 };
  return (
    <span ref={ref} style={popoverWrapStyle(inSidebar)}>
      <button onClick={() => setOpen((o) => !o)} title="Currency & FX conversion" aria-label="Currency settings"
        className={inSidebar ? "sidebar-action" : undefined}
        style={inSidebar ? sidebarActionStyle : { ...iconBtn, width: "auto", padding: "0 11px", gap: 6, ...sans, fontSize: FS.body, fontWeight: 600, color: "var(--ink-color-global-text-default)" }}>
        {inSidebar && <I d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />}
        {inSidebar ? `Currency: ${target}` : target}
        {active && <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--ink-button-background-color-primary-base-default)" }} />}
      </button>
      {open && (
        <div className="popin" style={{ position: "absolute", ...popoverAnchor(inSidebar), width: 288, maxHeight: 460, overflowY: "auto",
          background: "var(--ink-color-global-surface-background-default)", border: `1px solid var(--ink-color-global-border-subtle)`, borderRadius: 8, padding: 14, boxShadow: "var(--shadow-hover)", zIndex: 40 }}>
          <Eyebrow style={{ marginBottom: 8 }}>Convert to</Eyebrow>
          <Dropdown options={targetOpts} value={target} onChange={setTarget} minWidth={120} />
          <p style={{ ...note, margin: "8px 0 10px" }}>Enter each currency's rate to {target}. Blank = left as reported (not converted).</p>
          {present.filter((c) => c !== target && !excluded.has(c)).map((cur) => (
            <div key={cur} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
              <span style={{ ...rowLbl, width: 58 }}>1 {cur}</span>
              <span style={rowLbl}>=</span>
              <TextInput value={rates[cur] ?? ""} onChange={(e) => setRate(cur, e.target.value)} placeholder="rate" inputMode="decimal"
                style={{ width: 78, height: 30 }} />
              <span style={{ ...rowLbl, color: "var(--ink-color-global-text-subtle)" }}>{target}</span>
            </div>
          ))}
          <div style={{ height: 1, background: "var(--ink-color-global-border-subtle)", margin: "10px 0" }} />
          <Eyebrow style={{ marginBottom: 8 }}>Exclude from all views</Eyebrow>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 14px" }}>
            {present.map((cur) => (
              <label key={cur} style={{ ...rowLbl, display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                <input type="checkbox" checked={excluded.has(cur)} onChange={() => toggleExcl(cur)} />{cur}
              </label>
            ))}
          </div>
          {active && (
            <button onClick={() => { trackClick("PortfolioAnalytics.Currency.Reset"); onChange({ ...DEFAULT_CURRENCY }); }} style={{ ...sans, marginTop: 12, border: "none", background: "transparent",
              color: "var(--ink-color-global-link-default)", cursor: "pointer", padding: 0, fontSize: FS.small }}>Reset currency settings</button>
          )}
        </div>
      )}
    </span>
  );
}

/** Sidebar freshness line. Freshness = when we last PULLED, not the KPI reporting period.
 *  Datasets can be fetched separately, so summarize with the oldest so the line never
 *  overclaims; the Update-data panel breaks it down per dataset. Its own component + useNow
 *  so the "Xm ago" label ticks live without re-rendering the whole app. */
function DataStatusLine({ source }) {
  useNow();
  const oldestFetch = oldestDatasetFetch(source?.datasets);
  return (
    <div style={{ ...sans, fontSize: 12, lineHeight: "17px", color: "var(--ink-color-global-text-subtle)" }}>
      {oldestFetch
        ? `Data fetched ${fmtRelative(oldestFetch)} from Carta Fund Admin & Data Collection`
        : `Data as of ${fmtAsOf(source?.asOf)} from Carta Data Collection`}
      {source?.since && (
        <div data-tip={`Only KPI history from ${source.since} onwards was fetched. Re-run the skill and choose "Everything" to widen it.`}
          style={{ marginTop: 3, cursor: "help" }}>
          History from {fmtAsOf(source.since)} ⓘ
        </div>
      )}
    </div>
  );
}

export default function App({ firm }) {
  const { data: rawData, error } = useKpi(firm);
  const dashboard = useDashboard(firm);
  // Custom metrics splice in as derived KPIs (Formulas itself gets rawData). Key the
  // memo on slice CONTENT — update() clones the doc, so identity changes on any edit.
  const customMetrics = dashboard.doc?.customMetrics || [];
  const customKey = JSON.stringify(customMetrics);
  // Convert BEFORE custom metrics so formulas compute on converted values.
  const currency = dashboard.doc?.currency || DEFAULT_CURRENCY;
  const currencyKey = JSON.stringify(currency);
  const data = useMemo(
    () => withCustomMetrics(withCurrency(rawData, currency), customMetrics),
    [rawData, customKey, currencyKey],
  );
  // Seed the built-in formulas (Gross Profit Margin %) the first time a firm's doc loads, so
  // the derived KPI is already available everywhere instead of waiting for someone
  // to open the builder. seedDefaultFormulas returns null once there's nothing to
  // add, and update() skips the write on null — so this settles after one pass.
  // Seed once per firm (App is keyed by firm, so the ref resets on firm change).
  // Without the guard this effect re-fires on every later doc edit — because its
  // dep dashboard.doc changes identity on every edit — re-running seedDefaultFormulas
  // and cloning the whole doc for a guaranteed no-op.
  const seededRef = useRef(false);
  useEffect(() => {
    if (seededRef.current) return;
    if (!dashboard.doc || !rawData || !(rawData.metrics || []).length) return;
    seededRef.current = true;
    // One pass seeds both: the built-in formula and the top-quartile-by-cost-basis
    // favorites. Each seeder returns a fresh doc or null (nothing to do); chain
    // them so favorites build on the formula-seeded doc, and return null only when
    // neither added anything, so update() skips the write.
    dashboard.update((d) => {
      const afterFormulas = seedDefaultFormulas(d, rawData.metrics);
      const afterFavorites = seedFavorites(afterFormulas || d, rawData.companies);
      return afterFavorites || afterFormulas;
    });
  }, [dashboard.doc, rawData]);

  // Shared by the chart export stamp, the tab title, and the header below —
  // branding name > raw source label > the `firm` prop/slug.
  const resolvedFirmName = data?.branding?.firmName || data?.source?.firm || firm;

  // Stamp the firm + as-of date onto every chart EXPORT. A downloaded PNG lands in
  // a deck with no page around it, so it has to carry whose numbers it is itself.
  useEffect(() => {
    if (!data) return;
    setChartContext({
      firm: resolvedFirmName || "",
      asOf: fmtAsOf(data.source?.asOf) || "",
    });
  }, [data, resolvedFirmName]);

  // Browser tab title: prefix with the firm name once it's known, so a user with
  // several firms' dashboards open in different tabs can tell them apart.
  useEffect(() => {
    document.title = resolvedFirmName ? `${resolvedFirmName} | Carta Portfolio Analytics` : "Carta Portfolio Analytics";
  }, [resolvedFirmName]);

  const [tab, setTab] = useTabRoute(firm);
  // Nav-click tracking is separate from setTab itself — setTab is also called from
  // route normalization and the captable/benchmarks redirects below, which aren't nav clicks.
  const selectTab = (id) => { trackClick(`PortfolioAnalytics.Nav.${TAB_LABEL[id]}`); setTab(id); };
  // Fires once per view becoming active, however it got there (nav click, redirect,
  // back/forward, or a direct link).
  useEffect(() => { trackRender(`PortfolioAnalytics.${TAB_LABEL[tab]}.View`); }, [tab]);
  const narrow = useNarrow();
  const contentRef = useRef(null);
  // #app-content persists across tabs, so its scroll offset must be reset here.
  useEffect(() => { contentRef.current?.scrollTo(0, 0); }, [tab]);

  useEffect(() => { if (!parseRoute().tab) navigate({ firm, tab: DEFAULT_TAB }, { replace: true }); }, [firm]);

  // The Cap table tab was retired — the Company page's Cap table sub-tab renders
  // the same panels. Send old links there instead of letting useTabRoute's unknown-
  // tab fallback drop them silently on the Overview tab.
  useEffect(() => {
    if (parseRoute().tab !== "captable" || !data) return;
    const co = getFocus() || (capTableCompanies(data)[0] || {}).id || (data.companies || [])[0]?.id;
    navigate({ firm, tab: "company", sub: [co, "captable"] }, { replace: true });
  }, [firm, data]);

  // Benchmarks folded into the Portfolio tab as a mode. Redirect old /benchmarks
  // links there, else useTabRoute drops them on the Overview tab.
  useEffect(() => {
    if (parseRoute().tab === "benchmarks") openPortfolio("benchmarks");
  }, [firm]);

  const [dark, setDark] = useState(() => lsGet("theme") === "dark");
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    lsSet("theme", dark ? "dark" : "light");
  }, [dark]);

  if (data) setDisplayCurrency(data.source?.currency);

  if (error) {
    return <Center><div style={{ fontSize: FS.bodyLg }}>Couldn’t load KPI data ({error}). Try “Refresh KPI data”.</div></Center>;
  }
  if (!data) {
    return <Center><Mark size={56} style={{ margin: "0 auto", opacity: 0.9 }} /><div style={{ marginTop: 12, fontSize: FS.bodyLg }}>Loading KPI data…</div></Center>;
  }

  const toggleTheme = () => { trackClick("PortfolioAnalytics.Chrome.ToggleTheme"); setDark((d) => !d); };
  const themeToggleLabel = dark ? "Switch to light mode" : "Switch to dark mode";
  const themeToggle = (
    <button onClick={toggleTheme} title={themeToggleLabel} aria-label="Toggle theme" style={iconBtn}>
      {dark ? <SunIcon size={16} /> : <MoonIcon size={16} />}
    </button>
  );
  const themeToggleSidebar = (
    <button onClick={toggleTheme} title={themeToggleLabel} aria-label="Toggle theme" className="sidebar-action" style={sidebarActionStyle}>
      {dark ? <SunIcon size={16} /> : <MoonIcon size={16} />}{themeToggleLabel}
    </button>
  );
  const currencyMenu = (
    <CurrencyMenu present={presentCurrencies(rawData)} fundCurrency={data.source?.currency || "USD"}
      value={currency} onChange={(next) => dashboard.update((d) => { d.currency = next; return d; })} />
  );
  const currencyMenuSidebar = (
    <CurrencyMenu variant="sidebar" present={presentCurrencies(rawData)} fundCurrency={data.source?.currency || "USD"}
      value={currency} onChange={(next) => dashboard.update((d) => { d.currency = next; return d; })} />
  );

  const sidebar = (
    // Ink's SideNav has no side padding on the rail — nav rows are full-bleed. Logo
    // and footer chrome carry their own inset instead (see below).
    <aside className="no-print" style={{ width: 228, flex: "none", background: "var(--ink-color-global-surface-background-default)", borderRight: `1px solid var(--ink-color-global-border-subtle)`,
      display: "flex", flexDirection: "column", justifyContent: "space-between", gap: 32, padding: "16px 0", position: "sticky", top: 0, height: "100vh", boxSizing: "border-box", zIndex: 30 }}>
      {/* Logo + nav are one group (20px apart), the footer actions the other;
          space-between pushes them to opposite ends. */}
      <div style={{ display: "flex", flexDirection: "column", gap: 20, flex: 1, minHeight: 0 }}>
        {/* Left inset matches the nav rows (navItemStyle's 14px) so the logo's left
            edge lines up with the tab icons below it. The logo's centre lines up with
            the firm name's first line: top-anchored, then nudged up by half the
            difference between the logo and one text line — (20px line − 30px logo) / 2
            = −5px — so a one-line name centres on the logo and a two-line name hangs
            its second line below. */}
        <div style={{ padding: "4px 14px", display: "flex", alignItems: "flex-start", gap: 12 }}>
          <Mark size={30} style={{ flex: "none", transform: "translateY(-5px)" }} />
          <div style={{ minWidth: 0 }}>
            <div style={{ ...sans, fontSize: 14, fontWeight: 600, lineHeight: "20px", letterSpacing: "-0.01em", color: "var(--ink-color-global-text-default)", wordBreak: "break-word" }}>{resolvedFirmName}</div>
          </div>
        </div>
        {/* Only the nav list scrolls, so sidebar action popovers below aren't
            clipped or scrolled with it. No side padding — items go full-bleed.
            No gap between rows either — matches theme-with-ink's .sn__groups,
            which relies on each item's own padding, not a list gap. */}
        <div style={{ minHeight: 0, overflowY: "auto", display: "flex", flexDirection: "column" }}>
          {NAV_TABS.map((t) => (
            <NavItem key={t.id} id={t.id} label={t.label} icon={t.icon} extra={t.extra} viewBox={t.viewBox}
              active={isNavActive(tab, t.id)} onClick={() => selectTab(t.id)} />
          ))}
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: "0 12px" }}>
        {currencyMenuSidebar}
        {themeToggleSidebar}
        <div style={{ padding: "4px 12px 0", display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={{ ...sans, fontSize: 13, fontWeight: 600, color: "var(--ink-color-global-text-default)" }}>Portfolio Analytics</div>
          <DataStatusLine source={data.source} />
        </div>
        <UpdateDataButton variant="sidebar" datasets={data.source?.datasets} builtAt={data.source?.builtAt} />
      </div>
    </aside>
  );

  const narrowHeader = (
    <div className="no-print" style={{ borderBottom: `1px solid var(--ink-color-global-border-subtle)`, background: "var(--ink-color-global-surface-background-default)", padding: "12px 18px", display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <Mark size={24} />
        <span style={{ ...serif, fontSize: FS.h3, fontWeight: 700, color: "var(--ink-color-global-text-default)" }}>{resolvedFirmName}</span>
        <span style={{ flex: 1 }} />{currencyMenu}<UpdateDataButton datasets={data.source?.datasets} builtAt={data.source?.builtAt} />{themeToggle}
      </div>
      <div style={{ display: "flex", gap: 4, overflowX: "auto", alignItems: "center" }}>
        {NAV_TABS.map((t) => {
          const active = isNavActive(tab, t.id);
          return (
            <button key={t.id} onClick={() => selectTab(t.id)} style={{ ...sans, fontSize: FS.body, fontWeight: active ? 600 : 500, padding: "7px 13px", border: "none", borderRadius: 4, cursor: "pointer", whiteSpace: "nowrap",
              background: active ? "var(--ink-color-global-surface-lightgray-default)" : "transparent", color: active ? "var(--ink-button-background-color-primary-base-default)" : "var(--ink-color-global-text-subtle)" }}>{t.label}</button>
          );
        })}
      </div>
    </div>
  );

  return (
    <div style={{ ...sans, minHeight: "100vh", background: "var(--ink-color-global-surface-background-default)", color: "var(--ink-color-global-text-default)" }}>
      <style>{GLOBAL_CSS}</style>
      <TrendSparklineDefs />
      <ChartPrefsProvider dashboard={dashboard}>
      <TooltipLayer />
      <div id="app-screen" style={{ display: "flex", alignItems: "flex-start", gap: 0, padding: 0, height: "100vh", overflow: "clip" }}>
        {!narrow && sidebar}
        <div ref={contentRef} id="app-content" style={{ flex: 1, minWidth: 0, height: "100vh", overflowY: "auto" }}>
          {narrow && narrowHeader}
          <main style={{ padding: narrow ? "22px 18px 48px" : "28px 40px 64px" }}>
            {/* The page's section rhythm lives here, not in each view: every view's
                top-level <section> is a flex item, so 36px between sections is
                guaranteed and no view needs a margin of its own. */}
            <div key={tab} className="pagein" style={{ display: "flex", flexDirection: "column", gap: 36 }}>
              {tab === "overview" && <Overview data={data} dashboard={dashboard} />}
              {tab === "dashboard" && <PivotDashboard data={data} dashboard={dashboard} />}
              {tab === "review" && <Coverage data={data} dashboard={dashboard} />}
              {tab === "company" && <CompanyPage data={data} dashboard={dashboard} />}
              {tab === "portfolio" && <Portfolio data={data} dashboard={dashboard} />}
              {tab === "formulas" && <Formulas data={rawData} dashboard={dashboard} />}
            </div>
          </main>
        </div>
      </div>
      </ChartPrefsProvider>
    </div>
  );
}

function Center({ children }) {
  return (
    <div style={{ ...sans, minHeight: "100vh", background: "var(--ink-color-global-surface-background-default)", color: "var(--ink-color-global-text-subtle)", display: "grid", placeItems: "center" }}>
      <div style={{ textAlign: "center" }}>{children}</div>
    </div>
  );
}
