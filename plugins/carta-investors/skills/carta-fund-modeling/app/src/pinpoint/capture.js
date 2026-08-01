// Turns a clicked/selected DOM element into a structured "anchor" describing
// what part of the app it came from, so the outer chat can scope a request to it.
//
// The owning view file is resolved via an ancestor walk for the nearest
// [data-source] under app/src/views/ — NOT the leaf stamp, since shared ui/
// primitives (components.jsx, etc.) stamp their own file and are not the edit target.
const VIEWS_RE = /\/views\//;
const CAP = 300;
const LABEL_CAP = 40;

function closestWithSource(el, predicate) {
  for (let n = el; n; n = n.parentElement) {
    const src = n.getAttribute && n.getAttribute("data-source");
    if (src && (!predicate || predicate(src))) return src;
  }
  return null;
}

function cap(s) {
  s = (s || "").trim();
  return s.length > LABEL_CAP ? s.slice(0, LABEL_CAP) + "…" : s;
}

// Derives a short, display-only pin chip label. Precomputed datum names and
// explicit text selections win outright; otherwise, for a section/container
// element, prefer its nearest heading (the section/card title) over the
// mashed-together textContent of every child.
export function deriveLabel(targetEl, datum, selectionText) {
  if (datum && datum.name) return datum.name;
  const sel = (selectionText || "").trim();
  if (sel) return cap(sel);
  let text = "";
  const tag = targetEl && targetEl.tagName;
  if (tag && /^H[1-6]$/.test(tag)) {
    text = targetEl.textContent || "";
  } else if (targetEl && targetEl.querySelector) {
    const h = targetEl.querySelector("h1,h2,h3,h4,h5,h6");
    if (h) text = h.textContent || "";
  }
  if (!text && targetEl) text = targetEl.textContent || "";
  return cap(text);
}

export function buildAnchor(targetEl, opts = {}) {
  const selectionText =
    opts.selectionText != null
      ? opts.selectionText
      : (typeof window !== "undefined" && window.getSelection
          ? String(window.getSelection())
          : "");
  const context =
    opts.context != null
      ? opts.context
      : (typeof window !== "undefined" && window.__fmContext) || {};

  const leafFile = closestWithSource(targetEl, null);
  const viewFile = closestWithSource(targetEl, (s) => VIEWS_RE.test(s));

  let datum = null;
  for (let n = targetEl; n; n = n.parentElement) {
    if (n.getAttribute && n.getAttribute("data-datum-id")) {
      datum = {
        id: n.getAttribute("data-datum-id"),
        type: n.getAttribute("data-datum-type") || null,
        name: n.getAttribute("data-datum-label") || null,
      };
      break;
    }
  }

  let section = null;
  for (let n = targetEl; n; n = n.parentElement) {
    if (n.id) { section = n.id; break; }
  }

  const sel = (selectionText || "").trim();
  const quotedText = (sel || (targetEl.textContent || "").trim()).slice(0, CAP);

  const kind = sel ? "text" : datum ? "datum" : "element";

  return {
    kind,
    source: { viewFile, leafFile },
    datum,
    section,
    quotedText,
    label: deriveLabel(targetEl, datum, selectionText),
    context,
  };
}
