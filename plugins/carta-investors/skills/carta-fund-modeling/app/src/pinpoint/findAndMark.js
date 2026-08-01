// Locates a pinned anchor's element in the live DOM and draws a visible mark
// on it. Keyed on `datum.id` first (stable across re-renders), falling back
// to a text match within `section` (or the whole document). Best-effort:
// never throws, returns null when nothing matches. Re-invoked after every
// iframe reload (via the outer->app `highlight` bridge message) so the mark
// survives Branch-2 reloads.
export const MARK_CLASS = "fm-pinpoint-mark";
let current = null;
let styleInjected = false;

function ensureStyle() {
  if (styleInjected || typeof document === "undefined") return;
  const s = document.createElement("style");
  s.textContent =
    "." + MARK_CLASS + "{outline:2px solid var(--ink-color-global-border-focus-default," +
    "#285DA3);outline-offset:2px;border-radius:2px;transition:outline-color .15s ease;}";
  document.head.appendChild(s);
  styleInjected = true;
}

function clearMark() {
  if (current) { current.classList.remove(MARK_CLASS); current = null; }
}

function findByText(scope, text) {
  const q = String(text).trim();
  if (!q) return null;
  const nodes = scope.querySelectorAll("*");
  // Prefer an exact trimmed match; fall back to the first element containing it.
  let contains = null;
  for (const n of nodes) {
    const tc = (n.textContent || "").trim();
    if (tc === q) return n;
    if (!contains && tc.includes(q)) contains = n;
  }
  return contains;
}

export function findAndMark(anchor) {
  clearMark();
  if (!anchor) return null;
  ensureStyle();
  let el = null;
  if (anchor.datum && anchor.datum.id) {
    const id = anchor.datum.id;
    const sel = "[data-datum-id=\"" + String(id).replace(/"/g, '\\"') + "\"]";
    el = document.querySelector(sel);
  }
  if (!el && anchor.quotedText) {
    const view = anchor.source && anchor.source.viewFile;
    const scope =
      (view && document.querySelector('[data-source="' + String(view).replace(/"/g, '\\"') + '"]')) ||
      (anchor.section && document.getElementById(anchor.section)) ||
      document.body;
    el = findByText(scope, anchor.quotedText);
  }
  if (el) { el.classList.add(MARK_CLASS); current = el; }
  return el;
}
