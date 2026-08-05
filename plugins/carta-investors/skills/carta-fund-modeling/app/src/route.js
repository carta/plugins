// URL routing for the fund-modeling app.
//
// Shape: /firm/<slug>/<page>
//   - The firm slug and the page both live in the PATH. A reload therefore
//     reopens the exact firm and page you were on.
//   - The /api auth token is not in the URL — it lives in localStorage (see dash-token.js).
//   - Path-based (History API), not a hash: serve.py and Vite dev both serve
//     index.html for unknown paths (SPA fallback), and vite `base: "/"` makes
//     assets resolve from root at this nested depth.
//
// The URL is the single source of truth — Root subscribes for the firm, App for
// the page — via useSyncExternalStore(subscribeNav, parse...). history.pushState
// fires no event of its own, so navigate() dispatches NAV_EVENT to notify them.

export const NAV_EVENT = "fm:navigate";

/** Parse the current path into { firm, tab }. Either may be null. */
export function parseRoute() {
  if (typeof window === "undefined") return { firm: null, tab: null };
  const segs = window.location.pathname.replace(/^\/+/, "").split("/").filter(Boolean);
  if (segs[0] === "firm" && segs[1]) {
    return { firm: decodeURIComponent(segs[1]), tab: segs[2] || null };
  }
  return { firm: null, tab: null };
}

function urlFor({ firm, tab }) {
  const url = new URL(window.location.href);
  url.pathname = firm ? `/firm/${encodeURIComponent(firm)}${tab ? `/${tab}` : ""}` : "/";
  return url;
}

/** Navigate to { firm, tab }. Defaults to a history push (Back returns to the
 *  previous page); pass { replace: true } for redirects that shouldn't stack. */
export function navigate({ firm, tab }, { replace = false } = {}) {
  const url = urlFor({ firm, tab });
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
