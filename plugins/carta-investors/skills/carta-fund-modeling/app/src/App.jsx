import { useState, useMemo, useEffect, useRef, useSyncExternalStore } from "react";
import usePortfolio from "./state/usePortfolio.js";
import { computeFundStates, firmRollup, firmBaseRollup } from "./model/funds.js";
import { effectiveExitHorizons } from "./model/reprice.js";
import { FS, tightSans, sans, GLOBAL_CSS, GRAD_DARK, MICRO, SMALL_1 } from "./ui/theme.js";
import { Btn, LockIcon, Mark, SunIcon, MoonIcon, ChatIcon, ALL_FUNDS, Num, StatBar, Eyebrow, Heading2, H3, DeltaCaret } from "./ui/components.jsx";
import { fmtAsOf, fmtM, fmtX, setDisplayCurrency } from "./ui/format.js";
import UpdateDataButton from "./ui/UpdateDataButton.jsx";
import Overview from "./views/Overview.jsx";
import Companies from "./views/Companies.jsx";
import PowerLaw from "./views/returns/PowerLaw.jsx";
import LpReturns from "./views/returns/LpReturns.jsx";
import GpEconomics from "./views/returns/GpEconomics.jsx";
import Reserves from "./views/Reserves.jsx";
import CohortStanding from "./views/CohortStanding.jsx";
import Report from "./views/Report.jsx";
import ScenarioDialog from "./ui/ScenarioDialog.jsx";
import ConfirmDialog from "./ui/ConfirmDialog.jsx";
import { warn, WarnToast, BASELINE_LOCKED_MSG } from "./ui/warn.jsx";
import { parseRoute, navigate, subscribeNav } from "./route.js";
import { fmContext } from "./pinpoint/fmContext.js";
import { postToOuter, onFromOuter } from "./bridge-client.js";
import { trackClick, trackRender } from "./analytics.js";

const I = ({ d, extra }) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ flex: "none" }}>
    <path d={d} />{extra && <path d={extra} />}
  </svg>
);
// Ink-style line icons — a fresh, distinct set. Each is [icon, extra?].
const TABS = [
  ["overview", "Firm Overview", "M4 18a8 8 0 0116 0", "M12 18l5-5"],
  ["companies", "Companies", "M12 3l9 5-9 5-9-5z", "M3 13l9 5 9-5"],
  ["lp-returns", "LP Returns", "M3 16l5-5 4 4 8-8", "M16 7h4v4"],
  ["gp-economics", "GP Economics", "M4 7h16", "M9 7v13M15 7v13"],
  ["reserves", "Reserves", "M4 7h13v10H4z", "M17 10h3v4h-3"],
  ["power-law", "Power Law", "M4 20h16", "M4 20C10 20 13 5 20 4"],
  ["cohort", "Benchmarks", "M5 19a9 9 0 1114 0", "M12 19l5-6"],
  ["export", "Export", "M7 3h7l4 4v13a1 1 0 01-1 1H7a1 1 0 01-1-1V4a1 1 0 011-1z", "M14 3v4h4"],
];
const TAB_IDS = TABS.map(([id]) => id);
const DEFAULT_TAB = "overview";

// PascalCase view names for analytics IDs (FundModeling.<ViewName>.*) — keyed
// by the same tab id used in routing/TABS above.
const TAB_VIEW_NAMES = {
  overview: "Overview",
  companies: "Companies",
  "power-law": "PowerLaw",
  "lp-returns": "LpReturns",
  "gp-economics": "GpEconomics",
  reserves: "Reserves",
  cohort: "CohortStanding",
  export: "Export",
};

// The active page is the third path segment (/firm/<slug>/<page>) — see route.js.
// The URL is the source of truth: useSyncExternalStore re-reads it on any nav
// (our own pushState + browser back/forward). setTab pushes /firm/<slug>/<page>,
// keeping the firm in the path and the ?t=/?frame= query intact. An unknown/missing
// page segment falls back to Overview.
function useTabRoute(firm) {
  const raw = useSyncExternalStore(subscribeNav, () => parseRoute().tab, () => null);
  const tab = TAB_IDS.includes(raw) ? raw : DEFAULT_TAB;
  const setTab = (t) => {
    if (parseRoute().tab === t) return;
    navigate({ firm, tab: t }); // push — Back returns to the previous page
  };
  return [tab, setTab];
}

function useNarrow() {
  const [narrow, setNarrow] = useState(typeof window !== "undefined" && window.innerWidth < 1020);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 1020px)");
    const fn = () => setNarrow(mq.matches);
    fn(); // sync immediately — initial guess used a strict < on innerWidth
    mq.addEventListener("change", fn);
    return () => mq.removeEventListener("change", fn);
  }, []);
  return narrow;
}

/** Live firm key-metrics strip — recomputes from the firm rollup so any
 *  valuation/carry/exit edit updates these instantly. Shown only on Firm Overview.
 *  Titled "Firm metrics" inside the card via StatBar's `title` prop, matching
 *  the design spec's "Summary" tile (title + key values inside one bordered card). */
function MetricBar({ firm, firmBase, firmLpDelta, firmGpCarry, narrow }) {
  // Horizontal padding matches <main>'s own narrow/wide padding (App.jsx's maxWidth:1320
  // block below) so this card's edges line up with the page content under it — both boxes
  // share the same 1320 maxWidth and box-sizing:border-box, so padding parity is what aligns them.
  const pad = narrow ? "6px 18px 16px" : "6px 40px 16px";
  // Never sum across currencies: when the firm's funds span reporting currencies,
  // a combined firm total is meaningless — don't show one.
  if (firm.mixedCurrency) {
    return (
      <div style={{ maxWidth: 1320, padding: pad }}>
        <div className="card stat-bar" style={{ padding: "18px 24px" }}>
          <Heading2 style={{ margin: "2px 0 12px" }}>Firm metrics</Heading2>
          <div style={{ ...sans, fontSize: FS.body, color: "var(--ink-color-global-text-subtle)" }}>
            Firm-level totals aren't shown — this firm's funds report in multiple currencies, which can't be summed. Open a fund on the Companies, LP Returns or GP Economics tabs for per-fund figures.
          </div>
        </div>
      </div>
    );
  }
  // each metric shows its move vs the baseline scenario (green/red) — the delta uses
  // the metric's own formatter (× for TVPI, $ for the rest) and its own epsilon.
  const tvpiDelta = firm.tvpi - firmBase.tvpi;
  const items = [
    { label: "LP NAV", value: firm.lpNav, fmt: fmtM, delta: firmLpDelta, dfmt: (n) => fmtM(n), eps: 0.5 },
    { label: "TVPI", value: firm.tvpi, fmt: (n) => fmtX(n), delta: tvpiDelta, dfmt: (n) => n.toFixed(2) + "×", eps: 0.005 },
    { label: "GP carry", value: firmGpCarry, fmt: fmtM, delta: firmGpCarry - firmBase.gpCarry, dfmt: (n) => fmtM(n), eps: 0.5 },
    { label: "LP distributions", value: firm.lpDistributed, fmt: fmtM, delta: firm.lpDistributed - firmBase.lpDistributed, dfmt: (n) => fmtM(n), eps: 0.5 },
  ];
  return (
    <div style={{ maxWidth: 1320, padding: pad }}>
    <StatBar title="Firm metrics" serif={false} itemStyle={{ padding: "0 16px" }} stats={items.map((it) => ({
      key: it.label,
      label: it.label,
      value: <Num value={it.value} fmt={it.fmt} />,
      sub: it.delta != null && Math.abs(it.delta) > it.eps
        ? <span style={{ ...SMALL_1, display: "inline-flex", alignItems: "center", gap: 4, fontVariantNumeric: "tabular-nums", color: it.delta >= 0 ? "var(--ink-color-global-feedback-positive-strong)" : "var(--ink-color-global-feedback-negative-strong)" }}>
            <DeltaCaret up={it.delta >= 0} />{it.dfmt(Math.abs(it.delta))} vs Baseline
          </span>
        : <span style={{ display: "block", height: 15 }} />,
    }))} />
    </div>
  );
}

function NavItem({ id, label, icon, extra, active, onClick }) {
  return (
    <button
      onClick={onClick}
      data-testid={`tab-${id}`}
      className={`navitem${active ? " active" : ""}`}
      style={{ ...sans, display: "flex", alignItems: "center", gap: 10, width: "100%", textAlign: "left",
        fontSize: FS.bodyLg, fontWeight: active ? 600 : 500, padding: "6.5px 12px", border: "1px solid transparent",
        borderRadius: 4, cursor: "pointer", background: active ? "var(--accent-soft)" : "transparent",
        color: active ? "var(--ink-button-background-color-primary-base-default)" : "var(--ink-color-global-text-subtle)" }}
    >
      <I d={icon} extra={extra} />
      {label}
    </button>
  );
}

function ScenarioItem({ slice, active, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`navitem sliceitem${active ? " active" : ""}`}
      title={slice.locked ? "Baseline mirrors reported figures and stays locked" : `Created ${slice.createdAt}`}
      style={{ ...sans, display: "flex", alignItems: "center", gap: 9, width: "100%", textAlign: "left",
        fontSize: FS.bodyLg, fontWeight: active ? 650 : 500, padding: "5.5px 12px", border: "1px solid transparent",
        borderRadius: 4, cursor: "pointer", background: "transparent",
        color: active ? "var(--ink-color-global-link-default)" : "var(--ink-color-global-text-subtle)" }}
    >
      <span aria-hidden style={{ width: 14, display: "inline-flex", justifyContent: "center", color: active ? "var(--ink-color-global-feedback-positive-strong)" : MICRO }}>
        {slice.locked
          ? <LockIcon size={11.5} strokeWidth={2} />
          : <span style={{ width: slice.color ? 8 : 5, height: slice.color ? 8 : 5, borderRadius: "50%",
              background: slice.color || "currentColor", alignSelf: "center" }} />}
      </span>
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{slice.name}</span>
    </button>
  );
}

/** Footer of the sidebar: the data's as-of date and an Update-data button that
 *  pops a slick reminder of the phrase to say (the refresh runs through Claude,
 *  not the app, so this surfaces the instruction). No save chrome — scenario
 *  edits persist silently. */
/** Bottom-of-rail data provenance — a single quiet line (the app wordmark sits
 *  just above it, and the Update-data control is now a top-bar icon). */
function DataStatus({ asOf }) {
  return (
    <div style={{ padding: "6px 9px 2px" }}>
      <div style={{ ...sans, fontSize: FS.micro, color: "var(--ink-color-global-text-subtle)", lineHeight: 1.4 }}>
        Data as of {fmtAsOf(asOf)} from Carta Fund Admin
      </div>
    </div>
  );
}

export default function App({ firm, onChooseFirm }) {
  const { snapshot, doc, slice, selectSlice, createSlice, renameSlice, deleteSlice, update, updateCompany, setAssumption, reload, flush, pauseAutosave, resumeAutosave } =
    usePortfolio(firm, { onLockedEdit: () => warn(BASELINE_LOCKED_MSG) });
  // firm display currency — data-driven from the firm's reporting currency
  // (never hardcoded USD); drives fmt$/fmtM/fmtB across the app.
  setDisplayCurrency(snapshot?.source?.currency);
  const [tab, setTab] = useTabRoute(firm);
  // Nav-click tracking is separate from setTab itself — setTab is also called
  // from drill-downs (openFund/openFundSection) and the per-fund-tab auto-select,
  // which aren't user nav clicks.
  const selectTab = (id) => {
    trackClick(`FundModeling.Nav.${TAB_VIEW_NAMES[id]}`);
    setTab(id);
  };
  // Fires once per view becoming active, however it got there (nav click,
  // drill-down, back/forward, or a direct link).
  useEffect(() => {
    trackRender(`FundModeling.${TAB_VIEW_NAMES[tab]}.View`);
  }, [tab]);
  // Normalize a bare /firm/<slug> to /firm/<slug>/overview so the URL always names
  // the page shown (a reload of the bare firm path lands here first).
  useEffect(() => {
    if (!parseRoute().tab) navigate({ firm, tab: DEFAULT_TAB }, { replace: true });
  }, [firm]);
  // The iframe's own URL is invisible; hand firm+page to the shell to show in the
  // browser bar and re-seed on reload (see OuterShell's "route" handler).
  useEffect(() => { postToOuter("route", { firm, tab }); }, [firm, tab]);
  // Browser tab title names the firm being modeled, so switching between
  // firm tabs (or firm test boxes) is identifiable at a glance. The app runs
  // inside the outer shell's iframe, so setting document.title here has no
  // effect on the visible tab — forward the name to the outer shell, which
  // owns the top-level document.
  useEffect(() => {
    const name = snapshot?.branding?.firmName ?? snapshot?.source?.firm;
    postToOuter("title", { firmName: name });
  }, [snapshot]);
  const [fundScope, setFundScope] = useState(ALL_FUNDS); // global fund scope: "ALL" or a fund id; shared across views
  // Ambient context for pinpoint anchors — "where the user was" (firm/tab/scenario
  // slice/fund scope/currency) so a pinned data question narrows to the right slice.
  useEffect(() => {
    if (typeof window !== "undefined") {
      window.__fmContext = fmContext({
        firm, tab,
        sliceId: slice?.id, sliceName: slice?.name,
        fundScope, currency: snapshot?.source?.currency,
      });
    }
  }, [firm, tab, slice, fundScope, snapshot]);
  // Chat-turn soft lock registry — the outer shell (via bridge-client.js) pauses
  // autosave for the duration of a chat turn and resumes + reloads once it ends,
  // so an in-flight Claude edit and the user's own scenario edits can't race.
  useEffect(() => {
    if (typeof window !== "undefined") {
      window.__fmPortfolioCtl = { pauseAutosave, resumeAutosave, reload, flush };
    }
  }, [pauseAutosave, resumeAutosave, reload, flush]);
  // Mirrors the outer shell's chat rail state so the topbar toggle can label
  // itself "Ask Claude" vs "Close chat panel". The rail starts closed (the shell
  // persists the user's choice), and re-posts on every iframe load, so this
  // initial value only matters for the brief window before the first message
  // (and when running frameless).
  const [chatOpen, setChatOpen] = useState(false);
  useEffect(() => onFromOuter("chat-state", (p) => setChatOpen(!!(p && p.open))), []);
  const [scenarioDialog, setScenarioDialog] = useState(null); // {mode:"new"|"rename"} or null
  const [confirm, setConfirm] = useState(null); // {title, message, confirmLabel, danger, onConfirm} or null
  const narrow = useNarrow();
  const contentRef = useRef(null); // the app's scrollable content div — window.scrollTo is a no-op here
  // reset scroll to top on every tab switch, not just the drill-down callbacks below
  useEffect(() => {
    contentRef.current?.scrollTo({ top: 0 });
  }, [tab]);

  // dark mode — opt-in via the toggle and persisted; defaults to LIGHT (ignores
  // the OS preference) so the dashboard always opens light unless the user chose dark.
  const [dark, setDark] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem("theme") === "dark";
  });
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    try { localStorage.setItem("theme", dark ? "dark" : "light"); } catch { /* private mode */ }
  }, [dark]);
  const toggleTheme = () => setDark((d) => !d);
  const markStyle = dark ? { filter: "invert(1)", mixBlendMode: "screen" } : { mixBlendMode: "multiply" };

  const fundStates = useMemo(
    () => (snapshot && slice ? computeFundStates(snapshot, slice) : null),
    [snapshot, slice]
  );
  // the locked Baseline · Carta slice — its assumptions anchor the Returns
  // scorecard's "vs baseline" comparison
  const baseSlice = useMemo(
    () => doc?.slices?.find((s) => s.locked) ?? doc?.slices?.find((s) => s.id === "baseline") ?? doc?.slices?.[0],
    [doc]
  );
  // Active slice with its exit-horizon map augmented by per-company exit-timing
  // sliders, so a chosen exit quarter flows into every horizon-driven fund metric
  // (an explicit fund pick still wins). MUST stay above the `!fundStates` early
  // return — a hook after a conditional return breaks the hook count (React #310).
  const effSlice = useMemo(() => {
    if (!snapshot || !slice) return slice;
    const exitHorizon = effectiveExitHorizons(snapshot, slice);
    return { ...slice, assumptions: { ...slice.assumptions, exitHorizon } };
  }, [snapshot, slice]);

  // The Returns family (Power Law / LP Returns / GP Economics) is per-entity: when
  // landing on one with the firm-wide "All Funds" scope, auto-select the first fund
  // so the page (and its picker) name a real entity instead of silently falling back.
  const PER_FUND_TABS = ["power-law", "lp-returns", "gp-economics"];
  useEffect(() => {
    if (PER_FUND_TABS.includes(tab) && fundScope === ALL_FUNDS && snapshot?.funds?.length) {
      setFundScope(snapshot.funds[0].id);
    }
  }, [tab, fundScope, snapshot]);

  if (!fundStates) {
    return (
      <div style={{ ...sans, minHeight: "100vh", background: "var(--ink-color-global-surface-background-default)", color: "var(--ink-color-global-text-subtle)", display: "grid", placeItems: "center" }}>
        <div style={{ textAlign: "center" }}>
          <Mark size={56} style={{ margin: "0 auto", opacity: 0.9 }} />
          <div style={{ marginTop: 12, fontSize: FS.bodyLg }}>Loading fund data…</div>
        </div>
      </div>
    );
  }

  const locked = !!slice.locked;
  // Row drill-down lands on LP Returns (the default returns view for a fund).
  const openFund = (id) => { if (id) setFundScope(id); setTab("lp-returns"); contentRef.current?.scrollTo({ top: 0 }); };
  // Deep-link from the Performance sidebar: LP-returns label → LP Returns tab,
  // GP-returns (GP carry) label → GP Economics tab. Each section is now its own
  // tab, so selecting the tab lands the user directly on it (no in-page scroll).
  const openFundSection = (id, sectionId) => {
    if (id) setFundScope(id);
    setTab(sectionId === "gp-returns" ? "gp-economics" : "lp-returns");
    contentRef.current?.scrollTo({ top: 0 });
  };

  // live firm rollup for the persistent metric bar — reflects this slice's marks
  const firmAgg = firmRollup(fundStates);
  const firmBase = firmBaseRollup(fundStates); // Carta baseline — for vs-Carta deltas
  const firmLpDelta = fundStates.reduce((s, f) => s + (f.lpNav - f.baseLpNav), 0);
  // GP carry = carried interest only (accrued that survives the make-whole +
  // carry banked from exits). The GP's own capital NAV (gpCapitalNavLive) is the
  // GP commitment, NOT carry — it's shown separately as the Overview "GP NAV"
  // column — so it's excluded here. This makes the header/sidebar "GP carry"
  // tie out to the Overview GP Carry column exactly.
  const firmGpCarry = firmAgg.accruedCarry + firmAgg.carryBanked;

  const onNewSlice = () => setScenarioDialog({ mode: "new" });
  const onRename = () => setScenarioDialog({ mode: "rename" });
  const onDelete = () =>
    setConfirm({
      title: "Delete scenario",
      message: `Delete “${slice.name}”? This can't be undone.`,
      confirmLabel: "Delete scenario",
      danger: true,
      onConfirm: () => { deleteSlice(slice.id); setConfirm(null); },
    });
  const holdingsPulled = doc.seededFrom?.holdings?.pulledAt;
  const statusLine = `Data as of ${fmtAsOf(snapshot.source.navAsOf)}`;

  // The fund-scope dropdown now lives inside the two pages it drives (Companies,
  // Returns) — not the global chrome — since selection is page context, not
  // app-wide. `fundScope` stays shared state so the selection carries between
  // them and the Overview drill-down (openFund) still works.
  const themeToggle = (
    <button onClick={toggleTheme} data-testid="theme-toggle"
      title={dark ? "Switch to light mode" : "Switch to dark mode"}
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 40, height: 40,
        border: `1px solid var(--ink-color-global-border-subtle)`, borderRadius: 4, background: "var(--ink-color-global-surface-background-default)", color: "var(--ink-color-global-text-subtle)", cursor: "pointer", lineHeight: 0 }}>
      {dark ? <SunIcon size={16} /> : <MoonIcon size={16} />}
    </button>
  );

  // Opens/closes the chat rail in the outer shell — the app itself only owns
  // the toggle button; OuterShell holds the open/closed state and ChatPanel.
  const chatToggleLabel = chatOpen ? "Close chat panel" : "Ask Claude";
  const chatToggle = (
    <button onClick={() => postToOuter("toggle-chat")} data-testid="chat-toggle"
      title={chatToggleLabel} aria-label={chatToggleLabel} aria-expanded={chatOpen}
      style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 40, height: 40,
        border: `1px solid var(--ink-color-global-border-subtle)`, borderRadius: 4, background: "var(--ink-color-global-surface-background-default)", color: "var(--ink-color-global-text-subtle)", cursor: "pointer", lineHeight: 0 }}>
      <ChatIcon size={16} />
    </button>
  );

  const sliceTools = !locked && (
    <span style={{ display: "flex", gap: 6 }}>
      <Btn onClick={onRename} style={{ height: "auto", padding: "6px 13px", fontSize: FS.small }}>Rename</Btn>
      <Btn kind="danger" onClick={onDelete} style={{ height: "auto", padding: "6px 13px", fontSize: FS.small }}>Delete scenario</Btn>
    </span>
  );

  // ── full sidebar — firm header, tab nav (icon + label), scenarios, data status ──
  const sidebar = (
    <aside style={{ width: 232, flex: "none", background: "var(--ink-color-global-surface-background-default)", borderRight: `1px solid var(--ink-color-global-border-subtle)`,
      display: "flex", flexDirection: "column", gap: 1, padding: "14px 10px 10px",
      position: "sticky", top: 0, height: "100vh", overflowY: "auto" }}>
      <div style={{ padding: "0 8px 12px", display: "flex", alignItems: "flex-start", gap: 10 }}>
        <Mark branding={snapshot.branding} size={28} style={{ flex: "none", marginTop: 1 }} />
        <div style={{ minWidth: 0 }}>
          <H3 as="div" style={{ lineHeight: 1.2, wordBreak: "break-word" }}>{snapshot.branding?.firmName ?? snapshot.source.firm}</H3>
        </div>
      </div>
      {TABS.map(([id, label, icon, extra]) => (
        <NavItem key={id} id={id} label={label} icon={icon} extra={extra} active={tab === id} onClick={() => selectTab(id)} />
      ))}
      <div style={{ height: 1, background: "var(--ink-color-global-border-subtle)", margin: "9px 8px" }} />
      <div style={{ display: "flex", alignItems: "center", gap: 7, padding: "0 8px 4px" }}>
        <Eyebrow color={MICRO}>Scenarios</Eyebrow>
        <button onClick={onNewSlice} data-testid="new-slice" title="New scenario — copied from the current one" aria-label="New scenario"
          className="addslice" style={{ width: 18, height: 18, borderRadius: 4, border: "none", background: "var(--accent-soft)",
            color: "var(--ink-button-background-color-primary-base-default)", cursor: "pointer", display: "grid", placeItems: "center", fontSize: FS.bodyLg, fontWeight: 600, lineHeight: 1, padding: 0 }}>+</button>
      </div>
      {doc.slices.map((s) => (
        <ScenarioItem key={s.id} slice={s} active={s.id === slice.id} onClick={() => selectSlice(s.id)} />
      ))}
      <span style={{ flex: 1, minHeight: 10 }} />
      <div style={{ height: 1, background: "var(--ink-color-global-border-subtle)", margin: "6px 8px 0" }} />
      <div style={{ padding: "9px 9px 0" }}>
        <span style={{ ...tightSans, fontSize: FS.body, fontWeight: 700, color: "var(--ink-color-global-text-default)", letterSpacing: "-0.01em" }}>Carta Fund Modeling</span>
      </div>
      <DataStatus asOf={snapshot.source.navAsOf} />
    </aside>
  );

  // ── top context bar + live metrics (wide layout) ──
  const topBar = (
    <div data-testid="app-topbar" style={{ position: "sticky", top: 0, zIndex: 20, background: "var(--ink-color-global-surface-background-default)", borderBottom: `1px solid var(--ink-color-global-border-subtle)` }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 24px", flexWrap: "wrap" }}>
        <span style={{ ...sans, fontSize: FS.body, color: "var(--ink-color-global-text-subtle)" }}>Scenario: <strong style={{ color: "var(--ink-color-global-text-default)", fontWeight: 700 }}>{slice.name}</strong></span>
        {sliceTools}
        <span style={{ flex: 1 }} />
        <UpdateDataButton />
        {themeToggle}
        {chatToggle}
      </div>
      {tab === "overview" && <MetricBar firm={firmAgg} firmBase={firmBase} firmLpDelta={firmLpDelta} firmGpCarry={firmGpCarry} narrow={false} />}
    </div>
  );

  const narrowHeader = (
    <div style={{ borderBottom: `1px solid var(--ink-color-global-border-subtle)`, background: "var(--ink-color-global-surface-background-default)", padding: "12px 18px", display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <Mark branding={snapshot.branding} size={24} />
        <H3>{snapshot.branding?.firmName ?? snapshot.source.firm}</H3>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: FS.micro, color: "var(--ink-color-global-text-subtle)" }}>{statusLine}</span>
        <UpdateDataButton />
        {themeToggle}
        {chatToggle}
      </div>
      <div style={{ display: "flex", gap: 4, overflowX: "auto" }}>
        {TABS.map(([id, label]) => (
          <button key={id} onClick={() => selectTab(id)} data-testid={`tab-${id}`}
            style={{ ...sans, fontSize: FS.body, fontWeight: tab === id ? 600 : 500, padding: "7px 13px", border: "none",
              borderRadius: 4, cursor: "pointer", whiteSpace: "nowrap",
              background: tab === id ? "var(--ink-color-global-surface-lightgray-default)" : "transparent", color: tab === id ? "var(--ink-button-background-color-primary-base-default)" : "var(--ink-color-global-text-subtle)" }}>
            {label}
          </button>
        ))}
      </div>
      <div style={{ display: "flex", gap: 6, overflowX: "auto", alignItems: "center" }}>
        {doc.slices.map((s) => (
          <button key={s.id} onClick={() => selectSlice(s.id)}
            style={{ ...sans, fontSize: FS.bodyLg, fontWeight: s.id === slice.id ? 600 : 500, padding: "6px 13px", borderRadius: 4,
              border: `1px solid ${s.id === slice.id ? "var(--ink-color-global-text-default)" : "var(--ink-color-global-border-subtle)"}`, cursor: "pointer", whiteSpace: "nowrap",
              background: s.id === slice.id ? "var(--ink-color-global-text-default)" : "var(--ink-color-global-surface-background-default)", color: s.id === slice.id ? "var(--ink-color-global-surface-background-default)" : "var(--ink-color-global-text-subtle)",
              display: "inline-flex", alignItems: "center", gap: 6 }}>
            {s.locked
              ? <LockIcon size={11} strokeWidth={2} />
              : s.color && <span style={{ width: 8, height: 8, borderRadius: "50%", background: s.color, flex: "none" }} />}
            {s.name}
          </button>
        ))}
        <button onClick={onNewSlice} data-testid="new-slice"
          style={{ ...sans, fontSize: FS.bodyLg, fontWeight: 600, padding: "6px 13px", borderRadius: 4, border: `1px dashed var(--ink-color-global-border-subtle)`,
            background: "transparent", color: "var(--ink-button-background-color-primary-base-default)", cursor: "pointer", whiteSpace: "nowrap" }}>
          + New scenario
        </button>
      </div>
    </div>
  );

  return (
    <div style={{ ...sans, minHeight: "100vh", background: "var(--ink-color-global-surface-background-default)", color: "var(--ink-color-global-text-default)" }}>
      <style>{GLOBAL_CSS}</style>
      <WarnToast />

      <div id="app-screen" style={{ display: "flex", alignItems: "flex-start", gap: 0, padding: 0, height: "100vh", overflow: "clip" }}>
        {!narrow && sidebar}

        <div ref={contentRef} style={{ flex: 1, minWidth: 0, height: "100vh", overflowY: "auto" }}>
          {narrow ? narrowHeader : topBar}
          {narrow && tab === "overview" && <MetricBar firm={firmAgg} firmBase={firmBase} firmLpDelta={firmLpDelta} firmGpCarry={firmGpCarry} narrow={true} />}

          <main style={{ maxWidth: 1320, padding: narrow ? "22px 18px 48px" : "28px 40px 64px" }}>
            <div key={tab} className="pagein">
              {tab === "overview" && (
                <Overview fundStates={fundStates} snapshot={snapshot} portfolio={slice}
                  sliceName={slice.name} onOpenFund={openFund} />
              )}
              {tab === "reserves" && (
                <Reserves snapshot={snapshot} portfolio={slice}
                  setAssumption={setAssumption} readOnly={locked} />
              )}
              {tab === "companies" && (
                <Companies portfolio={effSlice} snapshot={snapshot}
                  exitHorizonOverrides={slice.assumptions.exitHorizon || {}}
                  updateCompany={updateCompany} updateSlice={update} setAssumption={setAssumption}
                  readOnly={locked} reload={reload} flush={flush}
                  holdingsPulled={holdingsPulled} fundScope={fundScope} setFundScope={setFundScope}
                  fundStates={fundStates} firmAgg={firmAgg} firmLpDelta={firmLpDelta} firmGpCarry={firmGpCarry}
                  sliceName={slice.name} onOpenFundSection={openFundSection} />
              )}
              {(tab === "power-law" || tab === "lp-returns" || tab === "gp-economics") && (() => {
                const returnsProps = {
                  snapshot, portfolio: effSlice, fundStates,
                  baseAssumptions: baseSlice.assumptions,
                  exitHorizonOverrides: slice.assumptions.exitHorizon || {},
                  fundScope, setFundScope, setAssumption, readOnly: locked,
                };
                if (tab === "power-law") return <PowerLaw {...returnsProps} />;
                if (tab === "lp-returns") return <LpReturns {...returnsProps} />;
                return <GpEconomics {...returnsProps} />;
              })()}
              {tab === "cohort" && <CohortStanding snapshot={snapshot} fundStates={fundStates} portfolio={slice} />}
              {tab === "export" && <Report doc={doc} snapshot={snapshot} baseSlice={baseSlice} />}
            </div>
          </main>
        </div>
      </div>

      {scenarioDialog && (
        <ScenarioDialog
          mode={scenarioDialog.mode}
          initialName={scenarioDialog.mode === "rename" ? slice.name : (locked ? "Experiment" : `${slice.name} copy`)}
          initialColor={scenarioDialog.mode === "rename" ? (slice.color ?? null) : null}
          fromName={slice.name}
          onCancel={() => setScenarioDialog(null)}
          onSubmit={(name, color) => {
            if (scenarioDialog.mode === "rename") renameSlice(slice.id, name, color);
            else createSlice(name, { color });
            setScenarioDialog(null);
          }}
        />
      )}

      {confirm && <ConfirmDialog {...confirm} onCancel={() => setConfirm(null)} />}
    </div>
  );
}
