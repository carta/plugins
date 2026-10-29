import { Zap, BarChart3, Table, LayoutGrid } from "lucide-react";
import { sans, INK, PAPER, LINE, FAINT, MICRO, SHADE, FS, SIDENAV_STRIPE } from "../ui/theme.js";
import { trackClick } from "../analytics.js";
import { DownloadIcon, EyeIcon, PlusIcon, UnsharedDot, UsersIcon } from "../reports/icons.jsx";
import { BVA, CUSTOM_REPORTING } from "./reportNav.js";

// A child slug is a workbook-derived budget id, so it can never become an event id.
const NAV_EVENTS = {
  "dashboard": "MancoReporting.Nav.Dashboard",
  [BVA]: "MancoReporting.Nav.BudgetVsActuals",
  [CUSTOM_REPORTING]: "MancoReporting.Nav.CustomReporting",
  "monthly-actuals": "MancoReporting.Nav.MonthlyActuals",
};

// Silent on an unmapped slug rather than folding it into another page's count.
function trackNav(slug) {
  const id = NAV_EVENTS[slug];
  if (id) trackClick(id);
}

// Ink icon name -> Lucide component, per Ink's brand.md's mapping.
const ICONS = {
  quickaction: Zap,       // Dashboard
  company: BarChart3,     // Budget vs Actuals
  customreport: LayoutGrid, // Custom Reporting
  ledger: Table,          // Monthly Actuals
};

// SideNav icon "tile": 20x20, orange fill + dark glyph when active — see
// Ink's components-sidenav.html `.sn__icon`/`.is-active .sn__icon`.
function NavIcon({ name, active }) {
  const Icon = ICONS[name];
  if (!Icon) return null;
  return (
    <span style={active ? styles.iconTileActive : styles.iconTile}>
      <Icon size={20} strokeWidth={1.6} />
    </span>
  );
}

// Left-side vertical nav: firm mark/name, nav items (optional NavIcon per
// item), then an as-of line pinned to the bottom via a flex spacer — same
// layout carta-fund-modeling uses for its own DataStatus.
export default function Sidebar({ initials, firmName, route, items, onNavigate, asOf, lastPostedDate, footerAction, shared }) {
  // A shared report's route starts with `parentSlug`, but its row is drawn under the item
  // `afterSlug` names — that item is the one that reads as active.
  const sharedActive = !!shared?.items.some(i => sharedItemRoute(shared.parentSlug, i) === route);
  return (
    <aside style={styles.wrap}>
      <div style={styles.brand}>
        {initials ? (
          <div style={styles.firmMark} aria-hidden="true">{initials}</div>
        ) : (
          <div style={{ ...styles.firmMark, background: LINE, color: FAINT }} aria-hidden="true">
            &nbsp;
          </div>
        )}
        <div style={styles.firmName} title={firmName || ""}>
          {firmName || "Loading…"}
        </div>
      </div>

      <nav style={styles.nav}>
        {items.map(item => {
          // Parent is "active" when the current route starts with its slug.
          // Sub-nav always renders below it (Sidenav's always-open Group pattern).
          const active = sharedActive ? item.slug === shared.afterSlug
            : item.slug === route || (item.children && route?.startsWith(item.slug + "/"));
          // Only a childless leaf gets the stripe (.navitem.active);
          // a parent with children just bolds its label instead.
          const isLeafActive = active && !item.children;
          return (
            <div key={item.slug}>
              <button
                type="button"
                onClick={() => {
                  trackNav(item.slug);
                  // Clicking a parent with children jumps to its first page so the user lands
                  // on real content, not an empty page or a builder (an action row is no page).
                  const firstPage = item.children?.find(child => !child.action);
                  onNavigate(firstPage ? `${item.slug}/${firstPage.slug}` : item.slug);
                }}
                className={isLeafActive ? "navitem active" : "navitem"}
                style={{
                  ...styles.navItem,
                  fontWeight: isLeafActive || (active && item.children) ? 600 : 400,
                  ...(isLeafActive ? null : styles.navRest),
                }}
              >
                {item.icon && <NavIcon name={item.icon} active={isLeafActive} />}
                {item.label}
              </button>
              {item.children && item.children.map(child => {
                const childRoute = `${item.slug}/${child.slug}`;
                const childActive = childRoute === route;
                if (child.action) {
                  // Open, the draft takes the group's active stripe like any page.
                  return actionRow({
                    key: child.slug, icon: PlusIcon, label: child.label, active: childActive, title: child.label,
                    onClick: () => { trackClick(child.event); onNavigate(childRoute); },
                  });
                }
                return (
                  <button
                    key={child.slug}
                    type="button"
                    onClick={() => {
                      trackClick(child.event);
                      onNavigate(childRoute);
                    }}
                    className="navitem"
                    style={{
                      ...styles.navChild,
                      ...(childActive ? styles.navChildActive : styles.navChildRest),
                    }}
                    title={child.unshared ? `${child.label} · changes not shared yet`
                      : child.shared ? `${child.label} · shared` : child.label}
                  >
                    {child.shared ? (
                      <span style={styles.childRow}>
                        <span style={styles.childLabel}>{child.label}</span>
                        <UnsharedDot show={child.unshared} style={styles.childIcon}>
                          <UsersIcon size={14} />
                        </UnsharedDot>
                      </span>
                    ) : child.label}
                  </button>
                );
              })}
              {shared && shared.afterSlug === item.slug && (
                <SharedGroup {...shared} route={route} onNavigate={onNavigate} />
              )}
            </div>
          );
        })}
        {/* The item it follows is gone when no budget is visible; the group still has to
            offer loading and unhiding, or nothing could bring a budget back. */}
        {shared && !items.some(i => i.slug === shared.afterSlug) && (
          <SharedGroup {...shared} route={route} onNavigate={onNavigate} />
        )}
      </nav>

      <span style={{ flex: 1, minHeight: 10 }} />

      {/* One footer block so the wordmark and as-of line keep their own
          tight 5px gap regardless of the rail's own (near-zero) gap. */}
      <div style={styles.footer}>
        {footerAction}
        <div style={styles.wordmark}>Carta Management Company Reporting</div>
        <div style={styles.dataStatus}>Data as of {formatAsOf(asOf)}</div>
        {/* Only when the ManCo's books stop earlier than the fetch date —
            otherwise it repeats "Data as of" and says nothing new. */}
        {lastPostedDate && lastPostedDate !== asOf && (
          <div style={styles.dataStatus}>Books posted through {formatAsOf(lastPostedDate)}</div>
        )}
      </div>
    </aside>
  );
}

// Where a shared report's row goes: the one rule for its route, its stripe and the
// group that reads as active while it is open.
const sharedItemRoute = (parentSlug, item) => `${parentSlug}/${item.slug}`;

// Reports teammates shared, closing the report groups (under the item
// `afterSlug` names; their routes start with `parentSlug`): an Ink SideNav
// SectionLabel, the reports as ordinary group items, then the load action as a
// row of its own so it reads as navigation, not a stray icon.
function SharedGroup({ items, parentSlug, busy, onPull, hiddenCount, unhiding, onShowHidden, route, onNavigate }) {
  const loadLabel = busy ? "Loading…"
                  : items.length ? "Check for new shared reports" : "Load shared reports";
  return (
    <div role="group" aria-labelledby="nav-shared-label">
      <div id="nav-shared-label" style={styles.sharedLabel}>Shared with you</div>
      {items.map(item => {
        const itemRoute = sharedItemRoute(parentSlug, item);
        const active = itemRoute === route;
        return (
          <button
            key={item.slug} type="button" title={item.label}
            onClick={() => { trackClick("MancoReporting.Nav.SharedReport"); onNavigate(itemRoute); }}
            className="navitem"
            style={{ ...styles.navChild, ...(active ? styles.navChildActive : styles.navChildRest) }}
          >
            {item.label}
          </button>
        );
      })}
      {onPull && actionRow({
        icon: DownloadIcon, label: loadLabel, onClick: onPull, disabled: busy, "aria-label": loadLabel,
      })}
      {onShowHidden && actionRow({
        icon: EyeIcon, label: unhiding ? "Showing…" : `Show ${hiddenCount} hidden`, onClick: onShowHidden, disabled: unhiding,
      })}
    </div>
  );
}

// A standing action inside a group ("New custom report", "Load shared reports"): the one
// home for its look. Called as a plain function, so the button is part of the tree.
function actionRow({ key, icon: Icon, label, active = false, ...button }) {
  return (
    <button
      key={key} type="button" className="navitem" {...button}
      style={{
        ...styles.navChild,
        ...(active ? { ...styles.actionRow, ...styles.navChildActive } : { ...styles.navChildRest, ...styles.actionRow }),
      }}
    >
      <Icon size={14} />
      <span style={styles.actionText}>{label}</span>
    </button>
  );
}

function formatAsOf(iso) {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-").map(Number);
  const months = ["January","February","March","April","May","June",
                  "July","August","September","October","November","December"];
  return `${months[m - 1]} ${d}, ${y}`;
}

const SIDEBAR_WIDTH = 240; // Ink SideNav's own standard open width (--ink-sidenav-container-width-base-open)
export const SIDEBAR_WIDTH_PX = SIDEBAR_WIDTH; // consumed by AppShell for main-column margin

const styles = {
  wrap: {
    ...sans,
    position: "fixed",
    top: 0,
    left: 0,
    bottom: 0,
    width: SIDEBAR_WIDTH,
    background: PAPER,
    borderRight: `1px solid ${LINE}`,
    padding: "14px 10px 10px",
    display: "flex",
    flexDirection: "column",
    gap: 1,
    boxSizing: "border-box",
    zIndex: 20,
  },
  brand: {
    display: "flex",
    alignItems: "flex-start",
    gap: 10,
    minWidth: 0,
    padding: "0 8px 12px",
  },
  firmMark: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 32,
    height: 32,
    borderRadius: 4,
    background: INK,
    color: PAPER,
    fontSize: FS.bodyLg,
    fontWeight: 600, // Ink's type scale never exceeds weight 600
    letterSpacing: "0.02em",
    flexShrink: 0,
  },
  firmName: {
    fontSize: FS.h3,
    fontWeight: 500,
    color: INK,
    lineHeight: 1.2,
    wordBreak: "break-word",
  },
  nav: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
  },
  // Active color/box-shadow (Ink SideNav inset-stripe) live in the shared
  // `.navitem.active` CSS class — inline styles would always outrank it.
  navItem: {
    ...sans,
    display: "flex",
    alignItems: "center",
    gap: 12,
    width: "100%",
    border: "1px solid transparent",
    padding: "10px 14px",
    fontSize: FS.value,
    textAlign: "left",
    cursor: "pointer",
    lineHeight: "20px",
  },
  // No inline `background` here — the shared `.navitem`/`.navitem:hover`
  // CSS class owns it, so hover can actually override the resting value.
  navRest: { color: INK },
  // Bare 20px icon, or (active) an orange-60 tile with a dark glyph — SideNav's
  // `.sn__icon` / `.sn__item.is-active .sn__icon`.
  iconTile: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 20,
    height: 20,
    borderRadius: 3,
    flexShrink: 0,
  },
  iconTileActive: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 20,
    height: 20,
    borderRadius: 3,
    flexShrink: 0,
    background: SIDENAV_STRIPE,
    color: "#1A1A1A",
  },
  // SideNav's GroupItem: a vertical connector line down the nested list,
  // replaced by the active stripe (not doubled) on the active child.
  // Longhand-only: navChildRest/navChildActive set borderLeft/paddingLeft,
  // and mixing that with a shorthand here would trigger React's warning.
  navChild: {
    ...sans,
    borderTop: 0, borderRight: 0, borderBottom: 0,
    marginLeft: 25,
    paddingTop: 8, paddingRight: 16, paddingBottom: 8,
    fontSize: FS.bodyLg,
    textAlign: "left",
    cursor: "pointer",
    lineHeight: "20px",
    display: "block",
    width: "calc(100% - 25px)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  navChildRest: {
    color: INK, fontWeight: 400,
    borderLeft: `1px solid ${LINE}`, paddingLeft: 19,
  },
  navChildActive: {
    color: INK, fontWeight: 600, borderLeft: 0,
    boxShadow: `inset 3px 0 0 0 ${SIDENAV_STRIPE}`, paddingLeft: 20,
  },
  // Ink SideNav's SectionLabel type (600 10px/16px, uppercase, .08em, subtle),
  // set on the group's connector line so the section stays inside the group.
  sharedLabel: {
    ...sans, fontSize: FS.micro, lineHeight: "16px", fontWeight: 600, letterSpacing: "0.08em",
    textTransform: "uppercase", color: FAINT,
    marginLeft: 25, borderLeft: `1px solid ${LINE}`, padding: "16px 16px 4px 19px",
  },
  childRow: { display: "flex", alignItems: "center", gap: 8, minWidth: 0 },
  childLabel: { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" },
  childIcon: { color: FAINT, marginLeft: "auto" },
  // A standing action inside a group ("New custom report", "Load shared reports"):
  // the group's connector line, muted and a step smaller than the pages it sits under.
  actionRow: { display: "flex", alignItems: "center", gap: 8, color: FAINT, fontSize: FS.body },
  actionText: { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" },
  // Bottom-of-rail data provenance — a single quiet caption line, same
  // weight/placement as carta-fund-modeling's own DataStatus.
  // Product wordmark over the data line, matching carta-fund-modeling's
  // own rail footer — the app names itself rather than carrying a lockup.
  wordmark: {
    ...sans,
    fontSize: FS.body,
    fontWeight: 700,
    color: INK,
    letterSpacing: "-0.01em",
    lineHeight: 1.3,
  },
  footer: {
    display: "flex",
    flexDirection: "column",
    gap: 5,
    padding: "0 2px",
  },
  dataStatus: {
    ...sans,
    fontSize: FS.small,
    color: FAINT,
    lineHeight: 1.4,
  },
};
