// The firm this page names in its URL: a deep link (?firm=<slug>), or an earlier pick this
// page wrote there itself (useLoadFirm.js's choose()). Every request this page sends to a
// route whose firm comes from the server's requestedSlug — a read (/api/snapshot,
// /api/accounts, /api/reports, /api/reports/share-status) or a write (/api/reports/*,
// /api/reports/share-op) — must agree on this firm, so they all go
// through this one module rather than each reading window.location on its own. Without that,
// a write could land on whatever firm another tab most recently loaded instead of the one
// this page is showing (requestedSlug falls back to the session's active-firm, shared across
// every tab, when a request carries no ?firm=).

/** The firm named by this page's own ?firm=, or null. */
export function deepLinkFirmSlug() {
  if (typeof window === "undefined") return null;
  return new URL(window.location.href).searchParams.get("firm") || null;
}

/** The firm uuid named by this page's own ?firmUuid=, or null — set alongside ?firm= when a
 * same-named-firm pick needs to stay pinned across a reload (see useLoadFirm.js's choose()). */
export function deepLinkFirmUuid() {
  if (typeof window === "undefined") return null;
  return new URL(window.location.href).searchParams.get("firmUuid") || null;
}

// Writes `slug` as this page's ?firm=, with no history entry — the same page, now naming a
// firm — so a later retry or a reload resolves to it instead of re-showing the chooser.
// firmUuid, when given, is written alongside it as ?firmUuid= so a reload of an ambiguous slug
// (one two Carta firms share) resolves straight back to the firm the user actually picked
// instead of showing the chooser again.
export function setFirmParam(slug, firmUuid) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  url.searchParams.set("firm", slug);
  if (firmUuid) url.searchParams.set("firmUuid", firmUuid);
  else url.searchParams.delete("firmUuid");
  window.history.replaceState(window.history.state, "", url);
}

/** `path`, with this page's ?firm= (and ?firmUuid=, when this page has one) appended; `path`
 * unchanged when there is no ?firm= to carry. Every firm-scoped request needs both: a route
 * with no chooser UI (resolveRouteFirm, server/worker.js) must see the same pin the page
 * itself resolved to, or an ambiguous slug it can't ask the user about reads as not yet ready
 * instead of denied. */
export function withFirmParam(path) {
  const slug = deepLinkFirmSlug();
  if (!slug) return path;
  const firmUuid = deepLinkFirmUuid();
  let out = `${path}${path.includes("?") ? "&" : "?"}firm=${encodeURIComponent(slug)}`;
  if (firmUuid) out += `&firmUuid=${encodeURIComponent(firmUuid)}`;
  return out;
}

/** The href for this page naming `slug` (and `firmUuid`, when given) — same param names
 * setFirmParam writes, for a caller that navigates with a full page load instead of patching
 * history in place (App.jsx's "Switch firm" from an already-loaded dashboard). */
export function firmHref(slug, firmUuid) {
  const url = new URL("/", typeof window === "undefined" ? "https://example.com" : window.location.origin);
  url.searchParams.set("firm", slug);
  if (firmUuid) url.searchParams.set("firmUuid", firmUuid);
  return `${url.pathname}${url.search}`;
}
