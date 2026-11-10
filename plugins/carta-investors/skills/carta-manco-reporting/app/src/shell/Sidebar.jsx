import { Zap, BarChart3, Table, LayoutGrid } from "lucide-react";
import { sans, INK, PAPER, LINE, FAINT, MICRO, SHADE, FS, BLUE, SIDENAV_STRIPE } from "../ui/theme.js";
import { trackClick } from "../analytics.js";
import { CartaLogo } from "../ui/components.jsx";
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

// Left-side vertical nav: Carta mark, firm name (+ "Switch firm" when `canSwitchFirm` — see
// App.jsx's own comment for exactly who that is), nav items (optional NavIcon per item), then
// an as-of line pinned to the bottom via a flex spacer — same layout carta-fund-modeling uses
// for its own DataStatus.
export default function Sidebar({ firmName, canSwitchFirm, onChooseFirm, route, items, onNavigate, asOf, lastPostedDate, footerAction, shared, userName, onSignOut, signOutLabel, signOutBusy }) {
  // A shared report's route starts with `parentSlug`, but its row is drawn under the item
  // `afterSlug` names — that item is the one that reads as active.
  const sharedActive = !!shared?.items.some(i => sharedItemRoute(shared.parentSlug, i) === route);
  return (
    <aside style={styles.wrap}>
      <div style={styles.brand}>
        <CartaLogo size={28} style={{ flex: "none", marginTop: 2 }} />
        <div style={{ minWidth: 0 }}>
          <div style={styles.firmName} title={firmName || ""}>
            {firmName || "Loading…"}
          </div>
          {canSwitchFirm && (
            <button type="button" onClick={onChooseFirm} data-testid="switch-firm" style={styles.switchFirm}>
              Switch firm
            </button>
          )}
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

      <span style={{ flex: "0 0 10px" }} />

      {/* Same horizontal inset (FOOTER_INSET_X) as the footer block below, so a footer
          action lines up with the wordmark and date lines rather than sitting flush with the rail edge. */}
      <div style={styles.footerAction}>{footerAction}</div>

      {/* Same divider + wordmark/as-of layout as carta-fund-modeling's own sidebar
          footer: a hairline rule separating any action controls above from the
          product identity below, then the wordmark and data-status lines keeping
          their own tight 5px gap regardless of the rail's own (near-zero) gap. The
          gap above the rule is the divider's own margin-top only — nothing above it
          (footerAction included) may carry a bottom margin, or the two would stack. */}
      <div style={styles.divider} />
      <div style={styles.footer}>
        <div style={styles.wordmark}>Carta Management Company Reporting</div>
        <div style={styles.dataStatus}>Data as of {formatAsOf(asOf)}</div>
        {/* Only when the ManCo's books stop earlier than the fetch date —
            otherwise it repeats "Data as of" and says nothing new. */}
        {lastPostedDate && lastPostedDate !== asOf && (
          <div style={styles.dataStatus}>Books posted through {formatAsOf(lastPostedDate)}</div>
        )}
        {/* The footer's last row — userName and onSignOut are both unset on the local dev
            server (no sign-in there), and independently of each other otherwise: a failed
            /api/me lookup still leaves a real session to sign out of, so onSignOut can be set
            with no name to show. The name always renders as its own div, even empty, so
            justify-content: space-between still pins Sign out to the right with no name. */}
        {(userName || onSignOut) && (
          <div style={styles.signedInRow}>
            <div style={{ ...styles.dataStatus, ...styles.signedInName }} title={userName || undefined}>
              {userName ? `Signed in as ${userName}` : ""}
            </div>
            {onSignOut && (
              <button type="button" onClick={onSignOut} disabled={signOutBusy} data-testid="sign-out" style={styles.signOut}>
                {signOutLabel}
              </button>
            )}
          </div>
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

// Shared by footerAction and footer below, so a footer action can't drift out of
// horizontal line with the wordmark/date block by one of the two paddings changing alone.
const FOOTER_INSET_X = 2;

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
  firmName: {
    fontSize: FS.h3,
    fontWeight: 500,
    color: INK,
    lineHeight: 1.2,
    wordBreak: "break-word",
  },
  // Matches carta-fund-modeling's own sidebar "Switch firm" link: chromeless inline text,
  // underlined so it reads as a link rather than a caption.
  switchFirm: {
    ...sans,
    display: "block",
    border: "none",
    background: "none",
    padding: 0,
    marginTop: 2,
    fontSize: FS.small,
    color: BLUE,
    textDecoration: "underline",
    cursor: "pointer",
  },
  // Grows to fill the space between brand and footer, and scrolls its own
  // content — the rail itself is `position: fixed` (viewport-height), so with
  // no overflow here a long item list (many custom reports, many shared
  // reports) just clips past the fixed box with no way to reach it.
  nav: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
    flex: "1 1 auto",
    minHeight: 0,
    overflowY: "auto",
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
  // FS.small, a step under fund-modeling's FS.body: "Carta Management Company
  // Reporting" is ~221px bold at 12px against the footer's 216px, so 12px wraps it.
  wordmark: {
    ...sans,
    fontSize: FS.small,
    fontWeight: 700,
    color: INK,
    letterSpacing: "-0.01em",
    lineHeight: 1.3,
  },
  // footer's own horizontal inset, with no vertical margin — the gap to the divider
  // below is the divider's own margin-top, not a margin here.
  footerAction: {
    padding: `0 ${FOOTER_INSET_X}px`,
  },
  // Matches carta-fund-modeling's own sidebar footer: a hairline rule, margin-top only,
  // the 9px gap below it coming from the footer block's own top padding (not a second
  // margin) so the two don't stack.
  divider: {
    height: 1,
    background: LINE,
    margin: "9px 8px 0",
  },
  footer: {
    display: "flex",
    flexDirection: "column",
    gap: 5,
    padding: `9px ${FOOTER_INSET_X}px 0`,
  },
  dataStatus: {
    ...sans,
    fontSize: FS.small,
    color: FAINT,
    lineHeight: 1.4,
  },
  signedInRow: {
    display: "flex",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: 8,
  },
  // The signed-in name on the left, truncated to one line so a long name never pushes
  // Sign out off the 240px rail; the full name is in its title.
  signedInName: {
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  // A footer-weight link: same shape as switchFirm's, muted (FAINT, not BLUE) so it reads as
  // a quiet account action rather than competing with the nav above it.
  signOut: {
    ...sans,
    display: "block",
    flexShrink: 0,
    border: "none",
    background: "none",
    padding: 0,
    fontSize: FS.small,
    color: FAINT,
    textDecoration: "underline",
    cursor: "pointer",
  },
};
