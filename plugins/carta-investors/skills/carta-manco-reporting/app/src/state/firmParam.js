// The firm this page names in its URL: a deep link (?firm=<slug>), or an earlier pick this
// page wrote there itself (useLoadFirm.js's choose()). Every request this page sends to a
// route whose firm comes from the server's requestedSlug — a read (/api/snapshot,
// /api/accounts, /api/reports, /api/reports/share-status) or a write (/api/reports/*,
// /api/reports/share-op, /api/budget-upload) — must agree on this firm, so they all go
// through this one module rather than each reading window.location on its own. Without that,
// a write could land on whatever firm another tab most recently loaded instead of the one
// this page is showing (requestedSlug falls back to the session's active-firm, shared across
// every tab, when a request carries no ?firm=).

/** The firm named by this page's own ?firm=, or null. */
export function deepLinkFirmSlug() {
  if (typeof window === "undefined") return null;
  return new URL(window.location.href).searchParams.get("firm") || null;
}

// Writes `slug` as this page's ?firm=, with no history entry — the same page, now naming a
// firm — so a later retry or a reload resolves to it instead of re-showing the chooser.
export function setFirmParam(slug) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  url.searchParams.set("firm", slug);
  window.history.replaceState(window.history.state, "", url);
}

/** `path`, with this page's ?firm= appended when it names one; `path` unchanged otherwise. */
export function withFirmParam(path) {
  const slug = deepLinkFirmSlug();
  if (!slug) return path;
  return `${path}${path.includes("?") ? "&" : "?"}firm=${encodeURIComponent(slug)}`;
}
