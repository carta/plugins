// Cross-view "focused company" — lets any view drill into a company's 360 page.
// Mirrors route.js: a module var + event + useSyncExternalStore.
//
// The URL is authoritative while you're ON the Company tab (/company/<id>/<subtab>),
// so a company deep-dive can be linked and shared. Elsewhere the tab carries no
// company, so the choice falls back to localStorage and a reload still reopens
// the last company you looked at.
import { navigate, parseRoute, subscribeNav } from "../route.js";
import { lsGet, lsSet, lsRemove } from "./storage.js";

const EVENT = "kpi:focus";
let current = lsGet("focusCo") || null;

export function getFocus() {
  const r = parseRoute();
  if (r.tab === "company" && r.sub[0]) return r.sub[0];
  return current;
}
export function setFocus(id) {
  current = id || null;
  if (id) lsSet("focusCo", id); else lsRemove("focusCo");
  // On the Company tab the id lives in the path — keep it in step, preserving
  // whichever sub-tab is open so switching company doesn't kick you to Overview.
  const r = parseRoute();
  if (r.tab === "company" && r.firm && id) navigate({ firm: r.firm, tab: "company", sub: [id, r.sub[1]] });
  window.dispatchEvent(new Event(EVENT));
}
/** Focus a company AND navigate to the Company tab (the drill-through action). */
export function openCompany(id) {
  current = id || null;
  if (id) lsSet("focusCo", id); else lsRemove("focusCo");
  const firm = parseRoute().firm;
  if (firm) navigate({ firm, tab: "company", sub: [id] });
  window.dispatchEvent(new Event(EVENT));
}
/** Record which card the Company page is scrolled to, keeping the company in the
 *  path so a deep link opens on that section (e.g. /company/<id>/captable scrolls
 *  to the Cap table card). `companyId` is the company actually on screen — pass
 *  it, because the path may not carry one yet and localStorage may hold a company
 *  from a different firm. Without it the anchor would land in the company slot
 *  (/company/captable). Jump-nav clicks pass { replace: true } so scrolling around
 *  the page doesn't pile up Back-button history. */
export function setCompanySubtab(sub, companyId, { replace = false } = {}) {
  const r = parseRoute();
  const co = r.sub[0] || companyId || current;
  if (r.tab === "company" && r.firm && co) navigate({ firm: r.firm, tab: "company", sub: [co, sub] }, { replace });
}

/** Put the on-screen company into the path without adding a history entry.
 *  Called by the Company page so a deep link is always well-formed, even when
 *  the user arrived at a bare /company. */
export function syncCompanyToUrl(companyId, sub) {
  const r = parseRoute();
  if (r.tab !== "company" || !r.firm || !companyId) return;
  if (r.sub[0] === companyId) return;
  navigate({ firm: r.firm, tab: "company", sub: [companyId, sub || r.sub[1]] }, { replace: true });
}
export function subscribeFocus(cb) {
  // getFocus() reads the URL on the Company tab, so a Back/Forward that changes
  // the path has to re-render too — not just an explicit setFocus().
  const un = subscribeNav(cb);
  window.addEventListener(EVENT, cb);
  return () => { un(); window.removeEventListener(EVENT, cb); };
}

// One-shot "open the Portfolio tab already on a given mode" intent. The Portfolio
// tab's Quadrant/Signals/Benchmarks mode is local state, not in the URL, so a
// drill-in from elsewhere stashes the desired mode here and navigates; Portfolio
// reads-and-clears it on mount. Used by Company page's "build a rule" link.
let pendingPortfolioMode = null;
export function openPortfolio(mode) {
  pendingPortfolioMode = mode || null;
  const firm = parseRoute().firm;
  if (firm) navigate({ firm, tab: "portfolio" });
}
export function takePendingPortfolioMode() {
  const m = pendingPortfolioMode; pendingPortfolioMode = null; return m;
}
