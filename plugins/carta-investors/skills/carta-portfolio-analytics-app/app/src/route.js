// URL routing for the Portfolio Analytics app.
//
// Shape: /firm/<slug>/<page>?t=<token>
//   - The firm slug AND the page both live in the PATH, so a reload reopens the
//     exact firm + page you were on. The ?t= auth token (and any other query) is
//     always preserved across navigation — main.jsx captured it once at load, but
//     keeping it in the URL means a hard reload re-authenticates too.
//   - Path-based (History API), not a hash: serve.py serves index.html for
//     unknown paths (SPA fallback), so assets and routes still resolve from
//     root at this nested depth.
//
// The URL is the single source of truth — Root subscribes for the firm, App for
// the page — via useSyncExternalStore(subscribeNav, parse...). history.pushState
// fires no event of its own, so navigate() dispatches NAV_EVENT to notify them.

export const NAV_EVENT = "cpa:navigate";

const EMPTY_ROUTE = { firm: null, tab: null, sub: [] };

/** Parse the current path into { firm, tab, sub }.
 *
 *  `sub` holds any segments after the tab — the Company tab uses
 *  `[companyId, subtab]` so a company deep-dive is a shareable link. Tabs that
 *  don't use it simply get an empty array. */
export function parseRoute() {
  if (typeof window === "undefined") return EMPTY_ROUTE;
  const segs = window.location.pathname.replace(/^\/+/, "").split("/").filter(Boolean);
  if (segs[0] === "firm" && segs[1]) {
    return {
      firm: decodeURIComponent(segs[1]),
      tab: segs[2] || null,
      sub: segs.slice(3).map(decodeURIComponent),
    };
  }
  return EMPTY_ROUTE;
}

function urlFor({ firm, tab, sub }) {
  const url = new URL(window.location.href); // preserves ?t= and any other query
  // Drop trailing blanks so `sub: [id, null]` yields /company/<id>, not /company/<id>/
  const tail = (sub || []).filter((s) => s != null && s !== "").map(encodeURIComponent);
  url.pathname = firm
    ? `/firm/${encodeURIComponent(firm)}${tab ? `/${tab}` : ""}${tab && tail.length ? "/" + tail.join("/") : ""}`
    : "/";
  return url;
}

/** Navigate to { firm, tab, sub? }. Omitting `sub` clears any sub-path, which is
 *  what switching top-level tabs should do. Defaults to a history push (Back
 *  returns to the previous page); pass { replace: true } for redirects that
 *  shouldn't stack. */
export function navigate({ firm, tab, sub }, { replace = false } = {}) {
  const url = urlFor({ firm, tab, sub });
  if (url.href === window.location.href) return;
  window.history[replace ? "replaceState" : "pushState"]({}, "", url);
  window.dispatchEvent(new Event(NAV_EVENT));
}

/** Subscribe to every URL change: browser back/forward (popstate) and our own
 *  pushState/replaceState (NAV_EVENT). For useSyncExternalStore. */
export function subscribeNav(cb) {
  window.addEventListener("popstate", cb);
  window.addEventListener(NAV_EVENT, cb);
  return () => {
    window.removeEventListener("popstate", cb);
    window.removeEventListener(NAV_EVENT, cb);
  };
}
