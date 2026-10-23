import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { sans, FAINT, GLOBAL_CSS, FS } from "./ui/theme.js";
import AppShell from "./shell/AppShell.jsx";
import { parseRoute, navigate as navigateRoute, subscribeNav } from "./shell/route.js";
import DashboardView from "./views/DashboardView.jsx";
import BudgetActualsView from "./views/BudgetActualsView.jsx";
import MonthlyActualsView from "./views/MonthlyActualsView.jsx";
import BudgetImport from "./shell/BudgetImport.jsx";
import DrilldownDrawer from "./views/DrilldownDrawer.jsx";
import useDrilldown from "./state/useDrilldown.js";
import useReports, { REPORT_ACTIONS } from "./state/useReports.js";
import useLoadFirm from "./state/useLoadFirm.js";
import { useHostedApp } from "./shell/hostedApp.js";
import { budgetNavChildren } from "./shell/reportNav.js";
import { hasBudget, renderableBudgets } from "./shell/budgetPresence.js";
import ShareStatus, { pulledMessage } from "./reports/ShareStatus.jsx";
import { setDisplayCurrency } from "./charts/chartTheme.js";
import { assignCategoricalColors, assignExpenseCategoryColors } from "./ui/categoricalColors.js";
import { displayFirmName } from "./ui/firmName.js";
import { trackClick, trackRender } from "./analytics.js";

// This server only ever hosts one firm — the URL's firm segment is cosmetic,
// corrected to the real slug once the snapshot resolves it, never looked up.
function usePathRoute(firmSlug) {
  const rawTab = useSyncExternalStore(subscribeNav, () => parseRoute().tab, () => null);
  const route = rawTab || "dashboard";

  useEffect(() => {
    if (!firmSlug) return;
    const current = parseRoute();
    if (current.firm !== firmSlug) {
      navigateRoute({ firm: firmSlug, tab: current.tab || route }, { replace: true });
    }
  }, [firmSlug, route]);

  const setRoute = (next) => {
    if (parseRoute().tab === next) return;
    navigateRoute({ firm: firmSlug, tab: next });
  };
  return [route, setRoute];
}

// Slug -> the name its events carry. A Budget-vs-Actuals child slug is a
// workbook-derived budget id, so it never reaches an id.
const VIEW_NAMES = { "dashboard": "Dashboard", "budget-vs-actuals": "BudgetVsActuals", "monthly-actuals": "MonthlyActuals" };

// Floor between resurface refetches: a flurry of tab switches skips the refetch instead of repeating it.
export const RESURFACE_REFRESH_MIN_MS = 60_000;

function slugify(name) {
  return String(name || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

// Means the skill has not written snapshot.json yet — a handoff race, not a break.
// Counting the two together in telemetry would hide whichever is rarer.
const NOT_READY = "not_ready";
function reportSnapshotError(reason) {
  trackRender(reason === NOT_READY ? "MancoReporting.App.DataNotReady" : "MancoReporting.App.SnapshotError");
}

export default function App() {
  const [snapshot, setSnapshot] = useState(null);
  const [accountsData, setAccountsData] = useState(null);
  // Rebuilt inline, this handed the drawer a new array every render, which
  // recomputed its whole filter chain and reset the entry list as it grew.
  const topCategoryNames = useMemo(() => topCategoryNamesFor(accountsData), [accountsData]);
  // notReady is a handoff race (the skill hasn't written snapshot.json yet; the
  // auto-load below is already running) and renders the load-status line. error is a
  // real failure and renders the error banner. At most one of them is set.
  const [notReady, setNotReady] = useState(false);
  const [error, setError] = useState(null);
  // The one place that sets either: every snapshot/load-firm outcome narrows to this
  // single call so the "at most one" invariant above can't drift out of sync at a site
  // that forgets the other half of the pair.
  const setSnapshotError = useCallback((e) => {
    const isNotReady = e === NOT_READY;
    setNotReady(isNotReady);
    setError(isNotReady ? null : e);
  }, []);
  // Pairs a snapshot-fetch failure with its telemetry so neither call site has to
  // remember both halves on its own.
  const failSnapshot = useCallback((e) => { reportSnapshotError(e); setSnapshotError(e); }, [setSnapshotError]);
  const drilldown = useDrilldown();
  const firmSlug = slugify(displayFirmName(snapshot?.firmName));
  const [route, navigate] = usePathRoute(firmSlug);

  // Opt-in and persisted; defaults to light.
  const [dark, setDark] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem("theme") === "dark";
  });
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    try { localStorage.setItem("theme", dark ? "dark" : "light"); } catch { /* private mode */ }
  }, [dark]);
  const toggleTheme = () => { trackClick("MancoReporting.App.ToggleTheme"); setDark((d) => !d); };

  // Parallel fetch snapshot + accounts (accounts is optional; drill-downs
  // just don't render if it's absent). Returns its promise so a report change
  // (which the server has already rebuilt both into) can await the refetch.
  // A background refetch that fails at the network level while a snapshot is
  // shown keeps that snapshot up and only records the failure.
  const lastFetchRef = useRef(0);
  const snapshotRef = useRef(null);
  const fetchData = useCallback(({ background = false } = {}) => {
    lastFetchRef.current = Date.now();
    return Promise.all([
      fetch("/api/snapshot")
        .then(r => r.json())
        .then(data => {
          if (data?.error) {
            failSnapshot(data.error);
            return;
          }
          if (data?.ops) {
            data.ops.total_income = data.ops.total_income ?? data.ops.ytdIncome ?? 0;
            data.ops.total_expenses = data.ops.total_expenses ?? data.ops.ytdExpenses ?? 0;
            data.ops.net = data.ops.net ?? (data.ops.total_income - data.ops.total_expenses);
          }
          setDisplayCurrency(data?.currency);
          if (data?.feeSchedule?.funds) assignCategoricalColors(data.feeSchedule.funds);
          snapshotRef.current = data;
          setSnapshot(data);
          setSnapshotError(null);
        })
        .catch(e => {
          const reason = e?.message || String(e);
          if (background && snapshotRef.current) { reportSnapshotError(reason); return; }
          failSnapshot(reason);
        }),

      fetch("/api/accounts")
        .then(r => r.json())
        .then(data => {
          if (data?.error) { trackRender("MancoReporting.App.AccountsUnavailable"); return; }
          if (data?.monthly_categories?.categories) assignExpenseCategoryColors(data.monthly_categories.categories);
          setAccountsData(data);
        })
        .catch(() => trackRender("MancoReporting.App.AccountsUnavailable")),
    ]);
  }, [failSnapshot]);
  const reportsApi = useReports({ onChanged: fetchData });
  const hostedApp = useHostedApp();
  const hiddenReports = reportsApi.reports.filter(r => r.hidden);
  const [shareNotice, setShareNotice] = useState(null); // see ShareStatus
  // One run at a time: each unhide moves the listing's version, so a second run would send a stale one.
  const [unhiding, setUnhiding] = useState(false);

  const loadShared = async () => {
    trackClick("MancoReporting.Nav.LoadSharedReports");
    setShareNotice({ status: "running", op: REPORT_ACTIONS.PULL });
    try {
      const result = await reportsApi.runShareOp(REPORT_ACTIONS.PULL);
      setShareNotice({ status: "done", op: REPORT_ACTIONS.PULL, message: pulledMessage(result) });
    } catch (e) {
      setShareNotice({ status: "error", op: REPORT_ACTIONS.PULL, message: e.message });
    }
  };
  const unhideAll = async () => {
    trackClick("MancoReporting.Nav.ShowHiddenReports");
    setUnhiding(true);
    try {
      for (const r of hiddenReports) {
        await reportsApi.act(r.id, REPORT_ACTIONS.HIDE, { hidden: false });
      }
    } catch (e) {
      setShareNotice({ status: "error", op: REPORT_ACTIONS.HIDE, message: e.message });
    } finally {
      setUnhiding(false);
    }
  };

  useEffect(() => { fetchData(); }, [fetchData]);

  // Refetch when the tab becomes visible again, so a long-open tab picks up actuals
  // the server has refreshed since; RESURFACE_REFRESH_MIN_MS throttles it. A network
  // failure leaves the page as it was.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - lastFetchRef.current < RESURFACE_REFRESH_MIN_MS) return;
      fetchData({ background: true });
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [fetchData]);

  // Auto-load: when the snapshot comes back not_ready, drive /api/load-firm's SSE
  // progress stream. /api/reports can depend on the firm just loaded, and the read on
  // mount ran before it had, so reload it too once the firm is in.
  const { loadStatus, loadError } = useLoadFirm(notReady, () => { fetchData(); reportsApi.reload(); });

  // A failure from the load itself (not a transient "still building") is a real error,
  // not "still loading" — leaving notReady set would read as a load that never finishes.
  useEffect(() => {
    if (loadError) setSnapshotError(loadError);
  }, [loadError, setSnapshotError]);

  // Tab title names the firm, mirroring carta-fund-modeling. No iframe here,
  // so document.title is set directly instead of posted to an outer shell.
  useEffect(() => {
    const name = displayFirmName(snapshot?.firmName);
    document.title = name ? `${name} | Carta Mgmt Company Reporting` : "Carta Mgmt Company Reporting";
  }, [snapshot]);

  // Route registry. Entries with `hidden(snapshot)` returning true are
  // omitted from the sidebar. Budget-vs-Actuals renders a sub-nav item
  // per Excel-sourced budget (snapshot.budget.budgets[]), so a firm with
  // several budgets (a YTD dept crosstab plus an annual outline, say)
  // sees them all. The parent BvA nav slug hides itself when this firm
  // has no budget at all.
  const budgetsList = renderableBudgets(snapshot);
  const firmHasBudget = hasBudget(snapshot);
  const { own: budgetChildren, sharedWithYou: sharedChildren } = budgetNavChildren(budgetsList, reportsApi);
  // `icon` is a lookup key into Sidebar.jsx's ICONS map (Lucide glyphs, per
  // Ink's brand.md's Ink-icon stand-in mapping).
  const navItems = [
    { slug: "dashboard",         label: "Dashboard",         icon: "quickaction" },
    { slug: "budget-vs-actuals", label: "Budget vs Actuals", icon: "company",
      hidden:   () => !firmHasBudget,
      children: budgetChildren },
    // Actuals by GL account, no budget columns — stands in for Budget vs
    // Actuals only while this firm has nothing budgeted, in Carta or a
    // workbook. The two never show together.
    { slug: "monthly-actuals",   label: "Monthly Actuals",   icon: "ledger",
      hidden:   () => firmHasBudget },
  ].filter(item => !item.hidden || !item.hidden(snapshot));

  // The tab segment reads "budget-vs-actuals" or "budget-vs-actuals/<id>" —
  // peel off the parent slug and budget id so the switch below renders either.
  const [routeParent, routeChild] = String(route || "").split("/", 2);
  const validParents = new Set(navItems.map(i => i.slug));
  const activeParent = validParents.has(routeParent) ? routeParent : "dashboard";
  // Default budget = the first available when BvA is active but no child specified.
  const activeBudgetId = routeChild
                       || (activeParent === "budget-vs-actuals" && (budgetChildren[0] || sharedChildren[0])?.slug);
  const activeRoute = activeBudgetId ? `${activeParent}/${activeBudgetId}` : activeParent;

  // Waits for the snapshot: until it lands, Budget vs Actuals is filtered out of
  // navItems and activeParent falls back to "dashboard" — a page nobody opened.
  useEffect(() => {
    if (snapshot) trackRender(`MancoReporting.${VIEW_NAMES[activeParent]}.View`);
  }, [snapshot, activeParent]);

  // Waits for the snapshot, so it means "this firm has no budget" rather
  // than "the snapshot has not arrived yet".
  useEffect(() => {
    if (snapshot && !firmHasBudget) trackRender("MancoReporting.App.BudgetVsActualsHidden");
  }, [snapshot, firmHasBudget]);

  const sidebarProps = {
    initials: firmInitials(snapshot?.firmName),
    firmName: displayFirmName(snapshot?.firmName),
    route: activeRoute,
    items: navItems,
    onNavigate: navigate,
    // Bottom-of-rail data provenance — carta-fund-modeling's own
    // placement (App.jsx's DataStatus, under the sidebar's wordmark) for
    // this exact line, moved off the topbar entirely once "Powered by
    // Carta" was dropped from it and left it with nothing else to show.
    asOf: snapshot?.asOf,
    // The ManCo's own books can stop earlier than the fetch date — see
    // Sidebar.jsx, which only prints this when it differs from asOf.
    lastPostedDate: snapshot?.lastPostedDate,
    footerAction: snapshot && <BudgetImport hosted={hostedApp} budgetUpload={snapshot.budgetUpload} onChanged={fetchData} />,
    shared: (() => {
      const onPull = reportsApi.can(REPORT_ACTIONS.PULL) ? loadShared : null;
      const onShowHidden = hiddenReports.length > 0 && reportsApi.can(REPORT_ACTIONS.HIDE) ? unhideAll : null;
      // The section renders exactly when at least one of its rows would: a shared child,
      // the pull row, or the show-hidden row. Each row's own gate (onPull, onShowHidden,
      // sharedChildren) is computed once, here, so this condition can't drift from what
      // SharedGroup (Sidebar.jsx) actually renders.
      if (!(snapshot && reportsApi.available && (sharedChildren.length || onPull || onShowHidden))) return null;
      return {
        items: sharedChildren,
        parentSlug: "budget-vs-actuals",
        busy: shareNotice?.status === "running",
        onPull,
        hiddenCount: hiddenReports.length,
        unhiding,
        onShowHidden,
      };
    })(),
  };

  return (
    <>
      <style>{GLOBAL_CSS}</style>
      <AppShell sidebarProps={sidebarProps}>
        {notReady && (
          <p style={{ ...sans, fontSize: FS.bodyLg, color: FAINT }}>
            {loadStatus || "· Loading fund data…"}
          </p>
        )}
        {error && (
          <p style={{ ...sans, fontSize: FS.bodyLg, color: "var(--red)" }}>Error: {error}</p>
        )}
        {!error && !notReady && !snapshot && (
          <p style={{ ...sans, fontSize: FS.bodyLg, color: FAINT }}>{loadStatus || "Loading…"}</p>
        )}
        {snapshot && activeParent === "dashboard" && (
          <DashboardView
            snapshot={snapshot}
            accountsData={accountsData}
            drilldown={accountsData ? drilldown : null}
            dark={dark}
            onToggleTheme={toggleTheme}
          />
        )}
        {snapshot && activeParent === "budget-vs-actuals" && (
          <BudgetActualsView
            snapshot={snapshot}
            accountsData={accountsData}
            drilldown={accountsData ? drilldown : null}
            budgetId={activeBudgetId}
            dark={dark}
            onToggleTheme={toggleTheme}
            reportsApi={reportsApi}
            onOpenReport={(id) => navigate(id ? `budget-vs-actuals/${id}` : "budget-vs-actuals")}
            onShareDone={(message) => setShareNotice({ status: "done", op: REPORT_ACTIONS.SHARE, message })}
          />
        )}
        {snapshot && activeParent === "monthly-actuals" && (
          <MonthlyActualsView
            snapshot={snapshot}
            accountsData={accountsData}
            drilldown={accountsData ? drilldown : null}
            dark={dark}
            onToggleTheme={toggleTheme}
          />
        )}
      </AppShell>

      <ShareStatus
        notice={shareNotice}
        progress={reportsApi.shareJob?.progress}
        firmName={displayFirmName(snapshot?.firmName)}
        hosted={hostedApp}
        onDismiss={() => setShareNotice(null)}
      />

      <DrilldownDrawer
        selection={drilldown.selection}
        onClose={drilldown.close}
        entries={accountsData?.entries || []}
        fundFeeEntries={accountsData?.fund_fee_entries || []}
        mancoFeeEntries={accountsData?.manco_fee_entries || []}
        feeScheduleTerms={accountsData?.fee_schedule_terms || []}
        spendByGL={snapshot?.spendByGL}
        buildJournalUrl={buildJournalUrlFor(snapshot)}
        topCategoryNames={topCategoryNames}
        asOf={snapshot?.asOf}
        onDrillAccountForMonth={drillAccountForMonthFor(snapshot, accountsData, drilldown)}
      />
    </>
  );
}

// Build a Carta booking-interface deep-link from the snapshot's cartaIds.
// URL format (verified via _links.web_url on fa:list:entities and matched
// against BOOKING_BASE patterns in cash-reconciliation + ramp skills):
//   https://app.carta.com/investors/firm/{firm}/portfolio/fund/{fund}/fund-accounting/booking-interface/view/{gluuid}/
//
// Routes to the entity the entry is booked on. Substituting another —
// the ManCo's id on a fund's entry — opens a real journal inside the
// wrong entity's page, which reads as that entity having booked it.
const CARTA_BASE_URL = "https://app.carta.com";
export function buildJournalUrlFor(snapshot) {
  const ids = snapshot?.cartaIds;
  if (!ids?.firm) return () => null;
  return (entry) => {
    const entity = entry?.entity_carta_id ?? ids.manco_fund;
    if (!entry?.gluuid || !entity) return null;
    return `${CARTA_BASE_URL}/investors/firm/${ids.firm}/portfolio/fund/${entity}/fund-accounting/booking-interface/view/${entry.gluuid}/`;
  };
}

// Given a (month, account) pair from the month-side GL breakdown row click,
// open a single-month date-range-category drill. Reuses the existing
// date-range-category kind so the sub-drill matches the shape we already
// render for breakdown-pane clicks.
function drillAccountForMonthFor(snapshot, accountsData, drilldown) {
  const asOf = snapshot?.asOf;
  if (!asOf || !drilldown?.openDateRangeCategory) return null;
  const yr = Number(asOf.slice(0, 4));
  const categories = accountsData?.monthly_categories?.categories || [];
  return (month, account) => {
    const mm = String(month).padStart(2, "0");
    const lastDay = new Date(yr, month, 0).getDate();
    const start = `${yr}-${mm}-01`;
    const end   = `${yr}-${mm}-${String(lastDay).padStart(2, "0")}`;
    const color = categories.find(c => c.name === account)?.color;
    drilldown.openDateRangeCategory(start, end, account, color);
  };
}

function topCategoryNamesFor(accountsData) {
  const cats = accountsData?.monthly_categories?.categories || [];
  return cats.filter(c => c.name !== "Other").map(c => c.name);
}

// Firm initials for the sidebar mark. Strip common legal-entity suffixes so
// the mark reads as the brand rather than the entity type. Splits on spaces
// AND hyphens (so "North-star Capital" produces N + s + C). Capped at 3
// characters — same as carta-fund-modeling's own Mark — so the badge stays a
// square instead of stretching into a rectangle for a 4+-word firm name.
function firmInitials(firmName) {
  if (!firmName) return "";
  const cleaned = displayFirmName(firmName);
  const tokens = cleaned.split(/[\s-]+/).filter(Boolean);
  return tokens.slice(0, 3).map(t => t.charAt(0)).join("");
}
