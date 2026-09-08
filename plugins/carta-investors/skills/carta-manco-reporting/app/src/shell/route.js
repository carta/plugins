// Path-based routing (/firm/<slug>/<tab...>), matching carta-fund-modeling's
// own URL shape. `tab` is every segment after the slug, joined with "/" —
// Budget-vs-Actuals nests a second one (the selected budget id).

export const NAV_EVENT = "manco:navigate";

/** Parse the current path into { firm, tab }. Either may be null. */
export function parseRoute() {
  if (typeof window === "undefined") return { firm: null, tab: null };
  const segs = window.location.pathname.replace(/^\/+/, "").split("/").filter(Boolean);
  if (segs[0] === "firm" && segs[1]) {
    return { firm: decodeURIComponent(segs[1]), tab: segs.slice(2).join("/") || null };
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
