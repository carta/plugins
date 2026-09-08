import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { sans, FAINT, GLOBAL_CSS, FS } from "./ui/theme.js";
import AppShell from "./shell/AppShell.jsx";
import { parseRoute, navigate as navigateRoute, subscribeNav } from "./shell/route.js";
import DashboardView from "./views/DashboardView.jsx";
import BudgetActualsView from "./views/BudgetActualsView.jsx";
import DrilldownDrawer from "./views/DrilldownDrawer.jsx";
import useDrilldown from "./state/useDrilldown.js";
import { setDisplayCurrency } from "./charts/chartTheme.js";
import { assignCategoricalColors, assignExpenseCategoryColors } from "./ui/categoricalColors.js";
import { trackRender } from "./analytics.js";

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
const VIEW_NAMES = { "dashboard": "Dashboard", "budget-vs-actuals": "BudgetVsActuals" };

function slugify(name) {
  return String(name || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

// "not_ready" means the skill has not written snapshot.json yet — a handoff race, not a
// break. Counting the two together would hide whichever is rarer.
function reportSnapshotError(reason) {
  trackRender(reason === "not_ready" ? "MancoReporting.App.DataNotReady" : "MancoReporting.App.SnapshotError");
}

export default function App() {
  const [snapshot, setSnapshot] = useState(null);
  const [accountsData, setAccountsData] = useState(null);
  // Rebuilt inline, this handed the drawer a new array every render, which
  // recomputed its whole filter chain and reset the entry list as it grew.
  const topCategoryNames = useMemo(() => topCategoryNamesFor(accountsData), [accountsData]);
  const [error, setError] = useState(null);
  const drilldown = useDrilldown();
  const firmSlug = slugify(displayFirmName(snapshot?.firmName));
  const [route, navigate] = usePathRoute(firmSlug);

  useEffect(() => {
    // Parallel fetch snapshot + accounts (accounts is optional; drill-downs
    // just don't render if it's absent).
    fetch("/api/snapshot")
      .then(r => r.json())
      .then(data => {
        if (data?.error) { reportSnapshotError(data.error); setError(data.error); return; }
        // Older cached snapshots (pre-currency field) omit `currency`;
        // setDisplayCurrency() no-ops on a falsy code, leaving the USD default.
        setDisplayCurrency(data?.currency);
        if (data?.feeSchedule?.funds) assignCategoricalColors(data.feeSchedule.funds);
        setSnapshot(data);
      })
      .catch(e => { reportSnapshotError(String(e)); setError(String(e)); });

    fetch("/api/accounts")
      .then(r => r.json())
      .then(data => {
        // Optional to render, but losing it disables every drill-down — so the UI
        // stays silent and telemetry does not.
        if (data?.error) { trackRender("MancoReporting.App.AccountsUnavailable"); return; }
        if (data?.monthly_categories?.categories) assignExpenseCategoryColors(data.monthly_categories.categories);
        setAccountsData(data);
      })
      .catch(() => trackRender("MancoReporting.App.AccountsUnavailable"));
  }, []);

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
  // sees them all. The parent BvA nav slug hides itself when no
  // dimensional budget exists at all.
  // Renderable when it has a dept crosstab, an outline, or — for a
  // Carta-sourced budget, which has no dimension — per-account rows.
  const budgetsList = Array.isArray(snapshot?.budget?.budgets)
                      ? snapshot.budget.budgets.filter(b =>
                          (Array.isArray(b.by_tag_value) && b.by_tag_value.length > 0)
                          || (((b.view_kinds || []).includes("by-line-item")
                               || (b.view_kinds || []).includes("by-account"))
                              && Array.isArray(b.rows) && b.rows.length > 0))
                      : [];
  const hasDimensionalBudget = budgetsList.length > 0;
  const budgetChildren = budgetsList.map(b => ({ slug: b.id, label: b.label || b.id }));
  // `icon` is a lookup key into Sidebar.jsx's ICONS map (Lucide glyphs, per
  // Ink's brand.md's Ink-icon stand-in mapping).
  const navItems = [
    { slug: "dashboard",         label: "Dashboard",         icon: "quickaction" },
    { slug: "budget-vs-actuals", label: "Budget vs Actuals", icon: "company",
      hidden:   () => !hasDimensionalBudget,
      children: budgetChildren },
  ].filter(item => !item.hidden || !item.hidden(snapshot));

  // The tab segment reads "budget-vs-actuals" or "budget-vs-actuals/<id>" —
  // peel off the parent slug and budget id so the switch below renders either.
  const [routeParent, routeChild] = String(route || "").split("/", 2);
  const validParents = new Set(navItems.map(i => i.slug));
  const activeParent = validParents.has(routeParent) ? routeParent : "dashboard";
  // Default budget = the first available when BvA is active but no child specified.
  const activeBudgetId = routeChild
                       || (activeParent === "budget-vs-actuals" && budgetChildren[0]?.slug);
  const activeRoute = activeBudgetId ? `${activeParent}/${activeBudgetId}` : activeParent;

  // Waits for the snapshot: until it lands, Budget vs Actuals is filtered out of
  // navItems and activeParent falls back to "dashboard" — a page nobody opened.
  useEffect(() => {
    if (snapshot) trackRender(`MancoReporting.${VIEW_NAMES[activeParent]}.View`);
  }, [snapshot, activeParent]);

  // Waits for the snapshot, so it means "this firm has no dimensional budget" rather
  // than "the snapshot has not arrived yet".
  useEffect(() => {
    if (snapshot && !hasDimensionalBudget) trackRender("MancoReporting.App.BudgetVsActualsHidden");
  }, [snapshot, hasDimensionalBudget]);

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
  };

  return (
    <>
      <style>{GLOBAL_CSS}</style>
      <AppShell sidebarProps={sidebarProps}>
        {error === "not_ready" && (
          <p style={{ ...sans, fontSize: FS.bodyLg, color: FAINT }}>
            Waiting for data — the skill hasn&#39;t written snapshot.json into the dashboard dir yet.
          </p>
        )}
        {error && error !== "not_ready" && (
          <p style={{ ...sans, fontSize: FS.bodyLg, color: "var(--red)" }}>Error: {error}</p>
        )}
        {!error && !snapshot && (
          <p style={{ ...sans, fontSize: FS.bodyLg, color: FAINT }}>Loading…</p>
        )}
        {snapshot && activeParent === "dashboard" && (
          <DashboardView
            snapshot={snapshot}
            accountsData={accountsData}
            drilldown={accountsData ? drilldown : null}
          />
        )}
        {snapshot && activeParent === "budget-vs-actuals" && (
          <BudgetActualsView
            snapshot={snapshot}
            accountsData={accountsData}
            drilldown={accountsData ? drilldown : null}
            budgetId={activeBudgetId}
          />
        )}
      </AppShell>

      <DrilldownDrawer
        selection={drilldown.selection}
        onClose={drilldown.close}
        entries={accountsData?.entries || []}
        fundFeeEntries={accountsData?.fund_fee_entries || []}
        feeScheduleTerms={accountsData?.fee_schedule_terms || []}
        spendByGL={snapshot?.spendByGL}
        buildJournalUrl={buildJournalUrlFor(snapshot)}
        topCategoryNames={topCategoryNames}
        asOf={snapshot?.asOf}
        onDrillAccountForMonth={drillAccountForMonthFor(snapshot, drilldown)}
      />
    </>
  );
}

// Build a Carta booking-interface deep-link from the snapshot's cartaIds.
// URL format (verified via _links.web_url on fa:list:entities and matched
// against BOOKING_BASE patterns in cash-reconciliation + ramp skills):
//   https://app.carta.com/investors/firm/{firm}/portfolio/fund/{fund}/fund-accounting/booking-interface/view/{gluuid}/
//
// Always routes through the ManCo's own carta_id, even for fund-fee entries
// booked on a fund's books — a link into a fund's own navigation context
// requires the viewer to have access to that fund, which a ManCo-side
// reader of this dashboard may not have.
const CARTA_BASE_URL = "https://app.carta.com";
function buildJournalUrlFor(snapshot) {
  const ids = snapshot?.cartaIds;
  if (!ids?.firm || !ids?.manco_fund) return () => null;
  return (entry) => {
    if (!entry?.gluuid) return null;
    return `${CARTA_BASE_URL}/investors/firm/${ids.firm}/portfolio/fund/${ids.manco_fund}/fund-accounting/booking-interface/view/${entry.gluuid}/`;
  };
}

// Given a (month, account) pair from the month-side GL breakdown row click,
// open a single-month date-range-category drill. Reuses the existing
// date-range-category kind so the sub-drill matches the shape we already
// render for breakdown-pane clicks.
function drillAccountForMonthFor(snapshot, drilldown) {
  const asOf = snapshot?.asOf;
  if (!asOf || !drilldown?.openDateRangeCategory) return null;
  const yr = Number(asOf.slice(0, 4));
  return (month, account) => {
    const mm = String(month).padStart(2, "0");
    const lastDay = new Date(yr, month, 0).getDate();
    const start = `${yr}-${mm}-01`;
    const end   = `${yr}-${mm}-${String(lastDay).padStart(2, "0")}`;
    drilldown.openDateRangeCategory(start, end, account);
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
  const cleaned = firmName.replace(/,?\s+(LLC|LP|L\.P\.|L\.L\.C\.|Inc\.?|Ltd\.?|Corp\.?)$/i, "");
  const tokens = cleaned.split(/[\s-]+/).filter(Boolean);
  return tokens.slice(0, 3).map(t => t.charAt(0)).join("");
}

function displayFirmName(firmName) {
  if (!firmName) return "";
  return firmName.replace(/,?\s+(LLC|LP|L\.P\.|L\.L\.C\.|Inc\.?|Ltd\.?|Corp\.?)$/i, "");
}
