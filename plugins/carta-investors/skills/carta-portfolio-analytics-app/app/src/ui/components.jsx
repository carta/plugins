import { useState, useEffect, useLayoutEffect, useMemo, useRef, useCallback, forwardRef, Fragment } from "react";
import { createPortal } from "react-dom";
import { FS, serif, sans, mono, MICRO, NOTICE, NOTICE_TINT, EASE, GRAD_DARK } from "./theme.js";

// Popovers must outrank the modal backdrop: a dropdown opened inside a Modal
// portals to <body> too, so a lower popover paints behind the backdrop and is unclickable.
export const Z = { stickyRibbon: 4, stickyClone: 10, modal: 1000, popover: 1100, tooltip: 9999 };

const findScrollParent = (from) => {
  let el = from?.parentElement;
  while (el && el !== document.body) {
    const cs = getComputedStyle(el);
    if (/(auto|scroll)/.test(cs.overflowY) && el.scrollHeight > el.clientHeight) return el;
    el = el.parentElement;
  }
  return null;
};
// `wrap` only actually scrolls horizontally when it owns its own overflow-x
// wrapper; otherwise the page/scroll-parent does, and wrap.scrollLeft stays 0.
const hScrollerOf = (wrap, sp) => (wrap.scrollWidth > wrap.clientWidth ? wrap : sp || wrap);
const sameClone = (a, b) => a === b || (a && b && a.top === b.top && a.left === b.left && a.width === b.width
  && a.cols.length === b.cols.length && a.cols.every((w, i) => w === b.cols[i]));

/** Floating clone of a table's `<thead>`, portaled to `<body>` as `position:fixed`
 *  while `wrapRef` straddles the page's real scroll ceiling; `offset` (px) lowers that
 *  ceiling below a sticky ribbon. Returns `{ top, left, width, cols, scrollRef }` or
 *  `null`. Put `scrollRef` on the clone's fixed `overflow:hidden` clip box: its
 *  scrollLeft is mirrored from the table inside the scroll event itself (React state
 *  would land a frame late), and frozen cells pin with `position:sticky; left`. */
export function useStickyClone(wrapRef, tableRef, offset = 0) {
  const [clone, setClone] = useState(null);
  const scrollRef = useRef(null);
  const syncX = useCallback(() => {
    const wrap = wrapRef.current, box = scrollRef.current;
    if (wrap && box) box.scrollLeft = hScrollerOf(wrap, findScrollParent(wrap)).scrollLeft;
  }, [wrapRef]);
  // The clip box mounts one render after the clone appears — catch its offset up then.
  useLayoutEffect(() => { if (clone) syncX(); }, [clone, syncX]);
  useEffect(() => {
    const update = () => {
      syncX();
      const wrap = wrapRef.current, table = tableRef.current;
      const thead = table?.querySelector("thead");
      const sp = wrap && findScrollParent(wrap);
      let next = null;
      if (wrap && thead && sp) {
        const ceiling = sp.getBoundingClientRect().top + offset;
        const wrapRect = wrap.getBoundingClientRect();
        if (wrapRect.top < ceiling && wrapRect.bottom > ceiling) {
          const cols = [...thead.querySelectorAll("th")].map((th) => th.getBoundingClientRect().width);
          next = { top: ceiling, left: wrapRect.left, width: wrap.clientWidth, cols };
        }
      }
      // Same geometry → same object, so a scroll that changes nothing re-renders nothing.
      setClone((prev) => (sameClone(prev, next) ? prev : next));
    };
    update();
    document.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    // Catches column-width/height changes from a prop change (e.g. a column
    // picker toggle) rather than only scroll/resize, so cached widths never go stale.
    const ro = new ResizeObserver(update);
    if (wrapRef.current) ro.observe(wrapRef.current);
    if (tableRef.current) ro.observe(tableRef.current);
    // Also watch the scroll container itself — a sibling section above the
    // table growing/shrinking shifts the ceiling without resizing wrap/table.
    const sp0 = findScrollParent(wrapRef.current);
    if (sp0) ro.observe(sp0);
    return () => {
      document.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
      ro.disconnect();
    };
  }, [wrapRef, tableRef, offset, syncX]);
  return clone && { ...clone, scrollRef };
}

/** Dismiss-on-outside-click + Escape for a popover/menu. Pass the open flag, the
 *  useState setter, and a ref (or array of refs) covering every element a click
 *  inside should NOT dismiss; while `open`, a mousedown outside all of them or an
 *  Escape keypress calls `setOpen(false)`. The single source for the
 *  dismiss-on-outside-click behavior every dropdown/menu popover in the app
 *  needs. Accepts multiple refs so a popover portaled to document.body
 *  (outside its trigger's own DOM subtree) can pass both its trigger ref and
 *  its portaled panel ref instead of hand-rolling the same listener pair inline. */
export function useDismissable(open, setOpen, refs, opts = {}) {
  useEffect(() => {
    if (!open) return;
    const refList = Array.isArray(refs) ? refs : [refs];
    // A popover portaled to <body> (e.g. a MultiSelect menu inside a Modal) sits
    // outside every ref; `insideSelector` lets its matches also count as inside.
    const inside = (t) => refList.some((r) => r.current && r.current.contains(t))
      || (opts.insideSelector && t.closest && t.closest(opts.insideSelector));
    const onDoc = (e) => { if (!inside(e.target)) setOpen(false); };
    const onEsc = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onEsc);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onEsc); };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps -- setOpen/refs are stable
}

/** Hairline SF-style icons — consistent stroke, no emoji anywhere. */
const icon = (paths) => ({ size = 14, strokeWidth = 1.8, style }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" style={{ flex: "none", display: "block", ...style }}>
    {paths.map((d, i) => <path key={i} d={d} />)}
  </svg>
);
// Carta wordmark, boxed — the app's brand mark, the same for every client. The
// single path draws the outline box and the letters, themed to the default text
// colour so it reads near-black in light and inverts cleanly in dark. The viewBox
// is cropped to the artwork's own bounds (the source SVG pads it inside a larger
// canvas), so the drawn box's edges sit flush with the element — its left edge can
// then line up with the nav icons. `size` is the height; width follows the cropped
// artwork's 301.09×131.28 aspect ratio.
const CARTA_LOGO_VB = "44.32 46.99 301.09 131.28";
const CARTA_LOGO_AR = 301.09 / 131.28;
const CARTA_LOGO_PATH = "M44.32,46.99v131.28h301.09V46.99H44.32z M337.41,170.27H52.32V54.99h285.09V170.27z M87.87,115.91c0-14.85,12.47-23.57,23.66-23.57c8.01,0,15.48,3.02,19.48,9.98l-7.48,4.36c-1.29-1.96-3.05-3.56-5.12-4.66c-2.07-1.1-4.38-1.67-6.73-1.65c-6.58,0-14.41,5.16-14.41,15.39c0,9.98,7.48,15.48,15.03,15.48c5.25,0,9.61-2.94,12.19-7.48l7.65,3.55c-4.33,7.83-12.07,12-21.05,12C99.79,139.3,87.87,130.57,87.87,115.91z M158.86,139.3c6.22,0,12.09-2.76,15.12-6.76v5.51h9.24V93.49h-9.24v5.52c-2.88-4.04-8.89-6.67-15.12-6.67c-13.61,0-23.13,9.96-23.13,23.48C135.73,129.07,145.34,139.3,158.86,139.3z M159.75,100.79c8.54,0,14.4,6.4,14.4,15.03c0,8.63-5.87,15.03-14.4,15.03c-8.72,0-14.59-6.49-14.59-15.21C145.16,107.11,151.21,100.79,159.75,100.79z M229.91,102.1h-7.11v-8.9h7.2V80.04h9.52v13.16h9.87v8.9h-9.87v35.93h-9.61V102.1z M275.73,139.3c6.23,0,12.1-2.76,15.13-6.76v5.51h9.25V93.49h-9.25v5.52c-2.88-4.04-8.89-6.67-15.13-6.67c-13.6,0-23.12,9.96-23.12,23.48C252.61,129.07,262.21,139.3,275.73,139.3z M276.63,100.79c8.53,0,14.41,6.4,14.41,15.03c0,8.63-5.88,15.03-14.41,15.03c-8.72,0-14.59-6.49-14.59-15.21C262.04,107.11,268.09,100.79,276.63,100.79z M202.36,137.99h-9.61V93.43h8.8v7.74c1.82-5.03,5.67-8.45,10.77-8.45c1.1-0.02,2.21,0.1,3.29,0.35v8.62c-7.18-0.84-13.25,4.18-13.25,15.66V137.99z";
export function Mark({ size = 30, style }) {
  return (
    <svg height={size} width={size * CARTA_LOGO_AR} viewBox={CARTA_LOGO_VB}
      role="img" aria-label="Carta" style={{ display: "block", ...style }}>
      <path d={CARTA_LOGO_PATH} style={{ fill: "var(--ink-color-global-text-default)" }} />
    </svg>
  );
}
// Ink's Dropdown.Trigger caret — a real chevron-down (not the right-chevron
// rotated 90°), static since this app's popovers always open downward. Ink
// only rotates this for an upward (top-*) placement, which this app's
// popovers never use.
export const ChevronDownIcon = icon(["M6 9l6 6 6-6"]);
// Lucide chevron-right — the "forward" glyph per brand.md's Ink→Lucide icon map,
// used for a collapsed table-row disclosure (ChevronDownIcon is the expanded state).
export const ChevronRightIcon = icon(["M9 18l6-6-6-6"]);
// Lucide "fold-vertical"/"unfold-vertical" — Ink's own collapse-all/expand-all
// glyphs (NewTable's TwiddleExpandAll), per brand.md's Ink→Lucide icon map.
export const CollapseAllIcon = icon(["M12 22v-6", "M12 8V2", "M4 12H2", "M10 12H8", "M16 12h-2", "M22 12h-2", "m15 19-3-3-3 3", "m15 5-3 3-3-3"]);
export const ExpandAllIcon = icon(["M12 22v-6", "M12 8V2", "M4 12H2", "M10 12H8", "M16 12h-2", "M22 12h-2", "m15 19-3 3-3-3", "m15 5-3-3-3 3"]);
// Lucide "external-link" — Ink's "open in new" glyph per brand.md's Ink→Lucide icon map.
export const ExternalLinkIcon = icon(["M15 3h6v6", "M10 14 21 3", "M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h6"]);
// Lucide "x" — Ink's "close"/dismiss glyph (Banner close control) per brand.md's Ink→Lucide icon map.
export const CloseIcon = icon(["M18 6 6 18", "m6 6 12 12"]);
// Lucide "trending-up" — chart-going-up glyph, the leading icon for the
// fund-modeling hand-off callout (replaces an inline emoji, per the no-emoji rule above).
export const TrendingUpIcon = icon(["M16 7h6v6", "m22 7-8.5 8.5-5-5L2 17"]);
export const SearchIcon = icon(["M3 11a8 8 0 1 0 16 0a8 8 0 1 0 -16 0", "M21 21l-4.35-4.35"]);
// Lucide "filter" — the funnel every Overview column header carries.
export const FilterIcon = icon(["M22 3H2l8 9.46V19l4 2v-8.54L22 3z"]);
// Lucide "pencil" — Ink's "edit"/"pencil" glyph per brand.md's Ink→Lucide icon map.
export const PencilIcon = icon([
  "M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z",
  "m15 5 4 4",
]);
export const RefreshIcon = icon(["M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8M21 3v5h-5M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16M8 16H3v5"]);
// Lucide "check-circle-2" — the refresh "new data ready" state.
export const CheckCircleIcon = icon(["M22 11.08V12a10 10 0 1 1-5.93-9.14", "M22 4 12 14.01l-3-3"]);
// Lucide "alert-circle" — the refresh error state.
export const AlertCircleIcon = icon(["M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z", "M12 8v4", "M12 16h.01"]);
// Carta's standard "warning" glyph — lucide's triangle-alert, hand-copied (no lucide bundle here).
export const WarningTriangleIcon = icon(["m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3", "M12 9v4", "M12 17h.01"]);
export const SunIcon = icon(["M12 17a5 5 0 100-10 5 5 0 000 10z", "M12 1v2", "M12 21v2", "M4.2 4.2l1.4 1.4", "M18.4 18.4l1.4 1.4", "M1 12h2", "M21 12h2", "M4.2 19.8l1.4-1.4", "M18.4 5.6l1.4-1.4"]);
export const MoonIcon = icon(["M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"]);
// Stacked up/down carets; theme.js's `.ink-sort-icon__asc`/`__desc` + `th[aria-sort]`
// color the active direction, per the canonical Ink sortable-header recipe.
export function SortCaretIcon({ size = 8, style }) {
  return (
    <svg width={size} height={size * 1.4} viewBox="0 0 10 14" className="ink-sort-icon" style={{ flex: "none", display: "block", ...style }} aria-hidden="true">
      <path className="ink-sort-icon__asc" d="M5 1L9 6H1Z" />
      <path className="ink-sort-icon__desc" d="M5 13L1 8H9Z" />
    </svg>
  );
}
// Info/help glyph — needs a circle + dot the shared `icon()` factory (paths-only)
// can't express, so it's hand-rolled like `Mark` above rather than forced through it.
export const HelpCircleIcon = ({ size = 14, strokeWidth = 1.8, style }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" style={{ flex: "none", display: "block", ...style }}>
    <circle cx="12" cy="12" r="9" />
    <path d="M9.5 9a2.5 2.5 0 0 1 4.9.8c0 1.7-2.4 2.2-2.4 3.7" />
    <path d="M12 17.5h.01" />
  </svg>
);

/** Standard "(?)" hover-hint trigger — carta-fund-modeling's InfoTip default
 *  trigger button (16px icon, cursor:default), wired to this app's shared
 *  TooltipLayer via data-tip rather than a per-instance popover. `icon`/`color`/
 *  `iconSize`/`strokeWidth` swap the glyph for a non-info variant (e.g. a
 *  warning triangle); `label` overrides the button's aria-label when it should
 *  differ from the tooltip text itself (e.g. an issue count instead of the hint). */
export const HintIcon = ({ hint, label, icon: Icon = HelpCircleIcon, color = "var(--ink-color-global-feedback-info-strong)", iconSize = 16, strokeWidth = 1.6, linkHref, linkText, linkSuffix, style }) => (
  <button type="button" aria-label={label ?? hint} data-tip={hint}
    data-tip-link-href={linkHref} data-tip-link-text={linkText} data-tip-link-suffix={linkSuffix}
    style={{ display: "inline-flex", background: "none", border: "none", padding: 0, cursor: "default",
      color, ...style }}>
    <Icon size={iconSize} strokeWidth={strokeWidth} />
  </button>
);

export const Eyebrow = ({ children, color = "var(--ink-color-global-text-subtle)", style }) => (
  <div style={{ ...sans, fontSize: FS.micro, letterSpacing: "0.09em", textTransform: "uppercase", color, fontWeight: 600, ...style }}>
    {children}
  </div>
);

/** A genuine card/chart section headline — sentence-case, bold, full-contrast.
 *  Distinct from Eyebrow (a small-caps caption for a field/group), which reads
 *  as a faint label rather than a title. */
export const SectionHeader = ({ children, style }) => (
  <div style={{ ...sans, fontSize: FS.value, fontWeight: 600, color: "var(--ink-color-global-text-default)", ...style }}>
    {children}
  </div>
);

/** Ink's real Heading 2 — 20px/36/500, sans, sentence case, text-default — per
 *  tokens.css's `heading-2-desktop` spec. Matches fund-modeling's `Heading2`
 *  exactly (same sibling micro-app pattern for a titled stat strip). */
const HEADING2_STYLE = { ...sans, fontSize: FS.h2, lineHeight: "36px", fontWeight: 500, color: "var(--ink-color-global-text-default)" };

export const Heading2 = ({ children, style }) => (
  <div style={{ ...HEADING2_STYLE, ...style }}>
    {children}
  </div>
);

// Page heading. No vertical margin of its own — every page lays its sections out
// as a flex column and the `gap` owns the spacing, so a margin here would stack
// on top of it and desync one page from the next.
export const H2 = ({ children, right, actions, id }) => (
  <div id={id} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap", scrollMarginTop: 20 }}>
    <h2 style={{ ...sans, fontSize: 20, lineHeight: "28px", fontWeight: 600, letterSpacing: "-0.01em", margin: 0, color: "var(--ink-color-global-text-default)" }}>{children}</h2>
    <span style={{ display: "flex", gap: 10, alignItems: "baseline" }}>
      {right && <span style={{ ...sans, fontSize: FS.small, color: "var(--ink-color-global-text-subtle)" }}>{right}</span>}
      {actions}
    </span>
  </div>
);

/** A filter/toolbar row pinned to the top of the scroll container, above a
 *  scrollable table (Coverage.jsx, PivotDashboard.jsx). Padding follows Ink's
 *  vertical spacing scale (small=12 above, normal=16 below) — one clean gap
 *  to the table, not a margin+padding pair stacked into an off-grid total.
 *  Forward the ref to a `ResizeObserver` so a caller can offset a floating
 *  table-header clone below this ribbon's measured height (see
 *  `useStickyClone`'s `offset` param). */
export const StickyRibbon = forwardRef(function StickyRibbon({ children, style }, ref) {
  return (
    <div ref={ref} style={{ position: "sticky", top: 0, zIndex: Z.stickyRibbon,
      display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center",
      padding: "12px 0 16px", background: "var(--ink-color-global-surface-background-default)",
      ...style }}>
      {children}
    </div>
  );
});

/** Coverage note — tells the user exactly which companies were left out of a
 *  view and why (e.g. "3 companies not shown — no cap-table valuation"). Pass the
 *  excluded company names and a short reason. Lists up to `max` names, then
 *  "+N more". Renders nothing when nothing was excluded, so views can drop it in
 *  unconditionally. Keeps the app honest: a shorter table always says why. */
export const ExcludedNote = ({ names = [], reason, max = 6, style }) => {
  if (!names.length) return null;
  const shown = names.slice(0, max).join(", ");
  const more = names.length > max ? ` +${names.length - max} more` : "";
  return (
    <p style={{ ...sans, fontSize: FS.micro, color: "var(--ink-color-global-text-subtle)", lineHeight: 1.6, margin: "10px 0 0", maxWidth: 920, ...style }}>
      <strong>{names.length}</strong> {names.length === 1 ? "company" : "companies"} not shown — {reason}: {shown}{more}
    </p>
  );
};

/** A grey-fill, no-stroke suggestion chip — Material's "suggestion chip"
 *  treatment, reused for MultiSelect's quick picks below. */
const suggestionChipStyle = { ...sans, fontSize: FS.small, fontWeight: 500, padding: "4px 10px",
  borderRadius: 14, border: "none", color: "var(--ink-color-global-text-default)", cursor: "pointer" };

/** Shared case-insensitive label filter for every searchable option list
 *  (MultiSelect, Dropdown, FilterCheckboxList) — one matching rule to change. */
export const filterByLabel = (options, q) => {
  if (!q) return options;
  const needle = q.toLowerCase();
  return options.filter((o) => o.label.toLowerCase().includes(needle));
};

/** Compact multi-select popover (checkbox list + search + all/clear). Generic —
 *  used by the Dashboard pivot and the Coverage tab. `selected` is a Set (or any
 *  iterable), `options` = [{id,label}], `onChange` gets a new Set. `quickPicks`
 *  (optional) renders a row of suggestion chips under the search field —
 *  `[{label, ids}]`, each replacing the selection with that id list on click.
 *  `emptyLabel` (default "None") is the summary shown for an empty selection. */
export function MultiSelect({ label, options, selected, onChange, minWidth = 200, quickPicks, emptyLabel = "None" }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef(null);
  const panelRef = useRef(null);
  // The dropdown portals to <body> (below), so it lives outside the trigger's DOM
  // subtree — dismiss-on-outside-click must treat clicks in EITHER as "inside".
  useDismissable(open, setOpen, [ref, panelRef]);
  // Anchor the fixed-positioned panel to the trigger's viewport rect; recompute
  // while open so it tracks scroll/resize.
  const [pos, setPos] = useState(null);
  useEffect(() => {
    if (!open) return;
    const place = () => {
      const t = ref.current;
      if (!t) return;
      const r = t.getBoundingClientRect();
      const width = 280;
      setPos({ top: r.bottom + 4, left: Math.max(8, Math.min(r.left, window.innerWidth - width - 8)), width });
    };
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => { window.removeEventListener("scroll", place, true); window.removeEventListener("resize", place); };
  }, [open]);
  const sel = selected instanceof Set ? selected : new Set(selected);
  const shown = filterByLabel(options, q);
  // `emptyLabel` lets a filter whose empty set means "no filter" say "All companies"
  // rather than "None"; pickers where empty means nothing-chosen keep the default.
  const summary = sel.size === 0 ? emptyLabel : sel.size === options.length ? "All" : `${sel.size} of ${options.length}`;
  const toggle = (id) => { const n = new Set(sel); n.has(id) ? n.delete(id) : n.add(id); onChange(n); };
  const linkBtn = { ...sans, border: "none", background: "transparent", color: "var(--ink-color-global-link-default)", cursor: "pointer", fontSize: FS.small, padding: 0 };
  return (
    <div ref={ref} style={{ position: "relative", display: "inline-block" }}>
      <button onClick={() => setOpen((o) => !o)} className="dd-trigger" style={{ ...ddTriggerStyle({ minWidth }), cursor: "pointer" }}>
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}: {summary}</span>
        <ChevronDownIcon size={16} strokeWidth={1.5} style={{ flex: "none" }} />
      </button>
      {/* Portaled to <body> + position:fixed so it escapes any ancestor
          `overflow`/`maxHeight` clipping (e.g. Overview's scrollable Columns
          popover) — the same pattern Modal/TooltipLayer use. */}
      {open && createPortal(
        <div ref={panelRef} className="popin" style={{ position: "fixed", top: pos?.top ?? 0, left: pos?.left ?? 0, width: pos?.width ?? 280,
          visibility: pos ? "visible" : "hidden", maxHeight: 360, overflowY: "auto",
          background: "var(--ink-color-global-surface-background-default)", border: `1px solid var(--ink-color-global-border-subtle)`, borderRadius: 6,
          boxShadow: "var(--shadow-hover)", zIndex: Z.popover, padding: 8 }}>
          <SearchInput placeholder={`Search ${label.toLowerCase()}…`} value={q} onChange={(e) => setQ(e.target.value)} style={{ width: "100%", marginBottom: 6 }} />
          {/* "Select all" reads as a suggestion chip like any quick pick; Clear
              stays link-styled text, but sits inline in the same row. */}
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6, padding: "0 2px 8px" }}>
            {quickPicks && quickPicks.map((qp) => (
              <button key={qp.label} type="button" className="suggestion-chip" style={suggestionChipStyle}
                onClick={() => onChange(new Set(qp.ids))}>{qp.label}</button>
            ))}
            <button type="button" className="suggestion-chip" style={suggestionChipStyle}
              onClick={() => onChange(new Set(options.map((o) => o.id)))}>Select all</button>
            <button type="button" onClick={() => onChange(new Set())} style={linkBtn}>Clear</button>
          </div>
          {shown.map((o, i) => (
            <Fragment key={o.id}>
              {/* Optional `group` on an option draws a heading each time it changes,
                  so a grouped list (tag categories) needs no separate component. */}
              {o.group && o.group !== (shown[i - 1] || {}).group && (
                <Eyebrow style={{ padding: "8px 4px 3px" }}>{o.group}</Eyebrow>
              )}
              <label style={{ ...sans, display: "flex", alignItems: "center", gap: 8, padding: "8px 4px", fontSize: FS.value, lineHeight: "20px", cursor: "pointer", color: "var(--ink-color-global-text-default)" }}>
                <input type="checkbox" checked={sel.has(o.id)} onChange={() => toggle(o.id)} />
                <span style={{ flex: "1 1 auto", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{o.label}</span>
                {o.sub && <span style={{ flex: "none", color: "var(--ink-color-global-text-subtle)" }}>{o.sub}</span>}
              </label>
            </Fragment>
          ))}
          {shown.length === 0 && <div style={{ ...sans, fontSize: FS.small, color: MICRO, padding: 4 }}>No matches</div>}
        </div>,
        document.body,
      )}
    </div>
  );
}

/** Basis switch: normalize monthly reporters onto quarters, or show as reported.
 *  Quarterly is the default because it's the only way a monthly reporter and a
 *  quarterly reporter are comparable on a flow metric. `hintIcon` moves the
 *  explanation from a hover tooltip on the whole control to a separate (?)
 *  beside it, for a ribbon where the control itself needs to stay hoverable
 *  for other reasons (e.g. sitting next to same-row siblings). */
const BASIS_HINT = "Quarterly: monthly reporters rolled up to quarters — income-statement & cash-flow items summed, balances take the closing value.\n\nAs reported: each company's figures exactly as reported (a monthly reporter shows one month).";

export const BasisToggle = ({ quarterly, onChange, hintIcon, style }) => {
  // The hintIcon variant is this app's Companies-ribbon usage, so it takes the
  // ribbon's own 36px toolbar height instead of the default small (32px) size.
  const segmented = <Segmented small={!hintIcon} toolbar={hintIcon} options={[{ id: "q", label: "Quarterly" }, { id: "r", label: "As reported" }]}
    value={quarterly ? "q" : "r"} onChange={(v) => onChange(v === "q")} />;
  return hintIcon
    ? <span style={{ display: "inline-flex", alignItems: "center", gap: 6, ...style }}>{segmented}<HintIcon hint={BASIS_HINT} /></span>
    : <span data-tip={BASIS_HINT} style={{ display: "inline-flex", alignItems: "center", gap: 6, ...style }}>{segmented}</span>;
};

/** Footnote explaining the quarterly roll-up + the partial-quarter marker. */
export const RollupNote = ({ quarterly, style }) => (
  <p style={{ ...sans, fontSize: FS.micro, color: "var(--ink-color-global-text-subtle)", lineHeight: 1.6, margin: "10px 0 0", maxWidth: 920, ...style }}>
    {quarterly ? <>Figures are on a <strong>quarterly</strong> basis so monthly and quarterly reporters are
      comparable — income-statement &amp; cash-flow items are <strong>summed</strong> across the months, balances
      (incl. period-end cash) take the <strong>closing</strong> value.{" "}
      <span style={{ color: "var(--ink-color-global-feedback-negative-strong)", fontWeight: 700 }}>*</span> marks a
      partial quarter (a summed flow missing some months, so it's understated).</>
      : <>Figures are exactly <strong>as reported</strong> — a monthly reporter shows a single month, so totals
      aren't directly comparable to a quarterly reporter's.</>}
  </p>
);

/** Marks a figure as calculated (derived), not reported. Tooltip names the math. */
export function CalcMark({ title }) {
  return (
    <span data-testid="calc-mark" title={title} aria-label={title || "calculated"}
      style={{ marginLeft: 3, fontStyle: "italic", cursor: "help",
        color: "var(--ink-color-global-text-subtle)" }}>
      ƒ
    </span>
  );
}

/** iOS-style switch. `disabled` renders it inert and muted. */
export function Toggle({ checked, onChange, labels = ["On", "Off"], disabled, small, title }) {
  const muted = disabled;
  // `small` = a denser switch for tight control clusters
  const tw = small ? 30 : 38, th = small ? 18 : 22, kn = small ? 14 : 18;
  return (
    <button
      onClick={(e) => { e.stopPropagation(); if (!disabled) onChange(!checked); }}
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      title={title}
      style={{ ...sans, display: "inline-flex", alignItems: "center", gap: small ? 6 : 8, fontSize: small ? FS.small : FS.body, fontWeight: 500,
        border: "none", background: "transparent", color: checked ? "var(--ink-color-global-text-default)" : "var(--ink-color-global-text-subtle)",
        cursor: disabled ? "default" : "pointer", opacity: muted ? 0.45 : 1, padding: 0, whiteSpace: "nowrap" }}
    >
      <span style={{ position: "relative", width: tw, height: th, borderRadius: th / 2, flex: "none",
        background: checked ? "var(--ink-button-background-color-primary-base-default)" : "var(--track)", transition: `background .1s ${EASE}` }}>
        <span style={{ position: "absolute", top: 2, left: checked ? tw - kn - 2 : 2, width: kn, height: kn, borderRadius: kn / 2,
          background: "var(--ink-color-global-surface-background-default)", transition: `left .1s ${EASE}` }} />
      </span>
      {checked ? labels[0] : labels[1]}
    </button>
  );
}

// `kind="link"` is chromeless inline text (no border/bg/fixed height) — the
// single source for the app's ~8 hand-rolled "See positions ▾"/"Edit Waterfall"/
// "Select all"-style buttons. Its fontSize/color still come through the trailing
// `style` spread, so callers keep their own size (bodyLg/small/body) and can mute
// the color (e.g. "Revert to Carta configuration") same as before.
/** The Companies filter ribbon's shared 36px/12px/14px chrome — Dropdown's trigger,
 *  SearchInput, and Btn's `size="toolbar"` variant below all read from this ONE
 *  object, so a new ribbon control can't quietly drift on height/padding/font the
 *  way the Filters/Reset buttons once did (they were hand-tuned per call site
 *  before landing here — height and font-size got copied, padding didn't). */
const TOOLBAR_CONTROL_STYLE = { height: 40, padding: "0 12px", fontSize: 14, lineHeight: "20px" };
export const Btn = forwardRef(({ children, onClick, kind = "ghost", size = "small", style, disabled, title, className, ...rest }, ref) => {
  const isLink = kind === "link";
  // `title`/`className` are destructured out (not left in `rest`) so a caller
  // that passes either can never silently clobber the computed value or the
  // kind-based chrome via JSX's later-attribute-wins spread order — the
  // computed and caller-supplied values are merged explicitly instead.
  const kindClassName = kind === "primary" ? "btn-primary" : isLink ? undefined : "btn-ghost";
  // `size="small"` (default) is Ink's real small-button recipe (32px, 0 7px).
  // `size="comfortable"` restores this app's
  // pre-Ink-match auto-height/8px-16px look for contexts a 32px pill reads as
  // cramped in (modal dialogs) — was hand-rolled as an identical inline style
  // override at several dialog Btn call sites; use the
  // prop instead of re-deriving the override at a new call site. `size="toolbar"`
  // is for a Btn sitting in the Companies filter ribbon alongside Dropdown/
  // SearchInput controls — see TOOLBAR_CONTROL_STYLE above.
  const nonLinkBase = { borderRadius: 4, border: "none", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8,
    background: kind === "primary" ? GRAD_DARK : "var(--ink-color-global-surface-background-default)" };
  return (
    <button
      ref={ref}
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      className={className ? [kindClassName, className].filter(Boolean).join(" ") : kindClassName}
      title={title}
      {...rest}
      style={{
        ...sans, fontSize: FS.body, fontWeight: isLink ? 600 : size === "toolbar" ? 400 : 500,
        cursor: disabled ? "default" : "pointer",
        boxShadow: "none",
        opacity: disabled ? 0.45 : 1,
        whiteSpace: "nowrap",
        ...(isLink
          ? { height: "auto", padding: 0, borderRadius: 0, border: "none", background: "none" }
          : size === "comfortable"
          ? { ...nonLinkBase, height: "auto", padding: "8px 16px" }
          : size === "toolbar"
          ? { ...nonLinkBase, ...TOOLBAR_CONTROL_STYLE }
          : { ...nonLinkBase, height: 32, padding: "0 7px" }),
        color: isLink ? "var(--ink-color-global-link-default)"
          : kind === "primary" ? "var(--grad-dark-text)"
          : kind === "danger" ? "var(--ink-color-global-feedback-negative-strong)"
          : "var(--ink-color-global-text-default)",
        ...style,
      }}
    >
      {children}
    </button>
  );
});

/** Segmented control — Ink's ButtonGroup recipe: a bordered container, segments
 *  share 1px hairline dividers, selected segment
 *  is a primary-button fill (black/white text, inverting in dark mode). CSS
 *  lives in theme.js (.seg-group/.seg-btn) — the per-segment hover/selected
 *  border-overlap and divider suppression need real :hover/:has(), not
 *  achievable with inline styles alone.
 *  `disabled` renders it inert (real HTML disabled, Ink's disabled-group
 *  colors) and dimmed. */
export function Segmented({ options, value, onChange, small, toolbar, disabled }) {
  const muted = disabled;
  return (
    <div className={`seg-group${small ? " is-sm" : ""}${toolbar ? " is-toolbar" : ""}${disabled ? " is-disabled" : ""}`} role="group"
      style={{ opacity: muted ? 0.5 : 1 }}>
      {options.map((o) => {
        const opt = typeof o === "string" ? { id: o, label: o } : o;
        const on = value === opt.id;
        return (
          <button
            key={opt.id}
            type="button"
            className={`seg-btn${on ? " is-selected" : ""}`}
            onClick={() => { if (!disabled) onChange(opt.id); }}
            disabled={disabled}
            aria-pressed={on}
            style={{ ...sans, cursor: disabled ? "default" : "pointer" }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

/** Ink's standard underline Tab recipe (theme-with-ink components.md "## Tab") —
 *  for switching between peer views in place, as opposed to Segmented's boxed
 *  look for a mutually-exclusive setting. `options` = [{id, label}]. */
export function TabBar({ options, value, onChange, style }) {
  return (
    <nav className="ink-tabs" role="tablist" style={style}>
      {options.map((o) => (
        <button key={o.id} type="button" role="tab" aria-selected={value === o.id}
          className={`ink-tab${value === o.id ? " is-active" : ""}`}
          onClick={() => onChange(o.id)}>
          {o.label}
        </button>
      ))}
    </nav>
  );
}

/** A single row inside a dropdown/menu popover — Ink's Dropdown.Button /
 *  Dropdown.Checkbox recipe (single-select: 14px/20px Inter, 8px/12px padding;
 *  multi-select checkbox rows: 14px/24px Inter, 6px/12px padding — see `dense`).
 *  The shared recipe behind every dropdown/menu's option rows in the app.
 *  Hover highlight is CSS-driven (`.menu-item:hover`)
 *  so every menu gets the same feedback without each caller wiring its own
 *  onMouseEnter/onMouseLeave.
 *  Text is always weight 400 / full `text-default`, regardless of hover,
 *  selected, or checked state — confirmed against Ink's real Dropdown.Item
 *  component: every state variant (Default/Hover/Keyboard-focus/Disabled for
 *  Checkbox/Radio/Text) renders Regular weight; only the transient mouse-down
 *  state bumps to Medium/500, unrelated to selection. Ink conveys checked/
 *  selected state entirely via the checkbox/radio glyph — never bold, never a
 *  dimmed label.
 *  `dense` switches to the multi-select checkbox-row metrics (6px vertical
 *  padding, 24px line-height, no fixed min-height) instead of the
 *  single-select default (8px padding, 20px line-height, 36px min-height).
 *  `selected` only affects the checkmark and the optional row tint — not
 *  weight. `tint` (defaults to `selected`) washes the row background with
 *  the same lightgray-hover tint hover uses (Ink: selected and hover share
 *  one tint) — set `tint={false}` for a checkbox-style list where checked
 *  state is conveyed by the leading checkbox, not a row tint.
 *  `checkmark` renders Ink's trailing check glyph when
 *  the row is the current single-select value (a composition on top of
 *  the real Ink primitives — Ink's raw Text-type Dropdown.Item has no
 *  built-in "this is the selected one" state of its own).
 *  `leading` renders before the label (a checkbox/color swatch). */
export function MenuItem({ children, onClick, selected, tint = selected, checkmark, dense, leading, style, role = "option" }) {
  return (
    <button role={role} aria-selected={role === "option" ? selected : undefined} onClick={onClick} className="menu-item"
      style={{ ...sans, display: "flex", alignItems: "center", gap: 10, width: "100%", textAlign: "left", whiteSpace: "nowrap",
        padding: dense ? "6px 12px" : "8px 12px", minHeight: dense ? undefined : 36, border: "none", borderRadius: 4, cursor: "pointer",
        boxSizing: "border-box", fontSize: 14, lineHeight: dense ? "24px" : "20px", fontWeight: 400,
        color: "var(--ink-color-global-text-default)",
        background: tint ? "var(--ink-color-global-surface-lightgray-hover)" : "transparent",
        ...style }}>
      {leading}
      <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{children}</span>
      {checkmark && selected && (
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden style={{ flex: "none", color: "var(--ink-color-global-text-default)" }}>
          <path d="M2.5 7.5l3 3 6-7" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </button>
  );
}

/** Shared Ink Dropdown.Trigger chrome (36px, border-default, hover/open-focus
 *  glow via the `.dd-trigger` class) — single source for every Dropdown-style
 *  trigger in the app, so they can't drift out of sync (they're all Ink
 *  Dropdown variants and should look identical at rest). Reads TOOLBAR_CONTROL_STYLE (defined above, next
 *  to Btn) for height/padding/font — the same object Btn's `size="toolbar"`
 *  reads, so a Dropdown and a Btn sitting in the same ribbon can't drift.
 *  `extra` merges in per-caller sizing (e.g. Dropdown's minWidth/maxWidth). */
export const ddTriggerStyle = (extra) => ({
  ...sans, display: "inline-flex", alignItems: "center", justifyContent: "space-between", gap: 8,
  ...TOOLBAR_CONTROL_STYLE, boxSizing: "border-box", border: `1px solid var(--ink-color-global-border-default)`,
  borderRadius: 4, background: "var(--ink-color-global-surface-background-default)",
  color: "var(--ink-color-global-text-default)", cursor: "pointer", fontWeight: 400,
  ...extra,
});

/** Ink's real dropdown/menu popover elevation (two-layer shadow, 6px radius) —
 *  single source for every dropdown/menu popover in the app,
 *  so every "click a trigger, see a small menu" popover in the app stays
 *  visually identical instead of hand-rolling a close-but-not-quite shadow. */
export const POPOVER_SHADOW = "0 8px 24px rgba(20,24,24,.12), 0 2px 6px rgba(20,24,24,.08)";

/** Ink's Dropdown compound component (Trigger + Box + Button), single-select.
 *  Generic: knows nothing
 *  about funds. `options` is `[{id, label, separatorBefore?}]`; a
 *  `separatorBefore: true` option gets a hairline divider above it (e.g. an
 *  "All ___" option separated from the real list below it).
 *  `value`/`onChange` behave like a native select. `minWidth`/`maxWidth` size
 *  the trigger (and the popover, which matches the trigger's width).
 *  `triggerLabel` prefixes the trigger text as "{triggerLabel}: {value}" (a
 *  self-labeling trigger, per Carta's dropdown convention, instead of a
 *  separate uppercase label row above the control) — the popover's own
 *  option rows are unaffected. `nullLabel` renders in place of an option
 *  label when `value` is `null`/doesn't match any option (a "Mixed" state
 *  across a scope with no single current value) instead of silently
 *  falling back to the first option. */
// A chart header pairs its title (24px line box) with this trigger; the app's
// usual 36px toolbar chrome forces `align-items: flex-end` to push the whole
// title down to match it (see theme-with-ink/charts.md's title-row note), so a
// chart-header trigger uses this shorter chrome instead — same border/radius
// recipe as ddTriggerStyle, just sized to the row it actually shares.
const COMPACT_TRIGGER_STYLE = { height: 24, padding: "0 8px", fontSize: 12, lineHeight: "16px" };

/** Shared by every `portal` popover (Dropdown, FilterMenu, PivotDashboard's
 *  GlobalFilter): tracks an anchor's on-screen rect so a body-portaled panel
 *  can position itself as position:fixed. This is what a `portal` mode
 *  escapes to — a z-indexed sticky ancestor (e.g. a sticky filter ribbon)
 *  otherwise traps the panel below unrelated content despite its own
 *  z-index, because the ancestor's stacking context caps the whole subtree. */
export function usePortalAnchor(open, anchorRef) {
  const [rect, setRect] = useState(null);
  useEffect(() => {
    if (!open) return;
    const place = () => {
      const el = anchorRef.current;
      if (!el) return;
      setRect(el.getBoundingClientRect());
    };
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => { window.removeEventListener("scroll", place, true); window.removeEventListener("resize", place); };
  }, [open, anchorRef]);
  return rect;
}

// `portal` renders the menu on <body> as position:fixed (the MultiSelect pattern) so a
// Dropdown inside a scrolling popover isn't clipped by that popover's overflow box.
export function Dropdown({ options, value, onChange, minWidth = 260, maxWidth = 460, testId, triggerLabel, nullLabel, compact, portal, searchable }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef(null);
  const panelRef = useRef(null);
  useDismissable(open, setOpen, [ref, panelRef]);
  const anchorRect = usePortalAnchor(open && !!portal, ref);
  const pos = anchorRect && { top: anchorRect.bottom + 4, left: Math.max(8, Math.min(anchorRect.left, window.innerWidth - anchorRect.width - 8)), width: anchorRect.width };

  const current = value != null ? options.find((o) => o.id === value) : undefined;
  const label = current ? current.label : (nullLabel ?? options[0]?.label);
  const shown = searchable ? filterByLabel(options, q) : options;
  // Search state belongs to this one open/close cycle, not across it — a
  // stale filter from a prior open would otherwise hide the current value.
  useEffect(() => { if (!open) setQ(""); }, [open]);

  const placement = portal
    ? { position: "fixed", top: pos?.top ?? 0, left: pos?.left ?? 0, minWidth: pos?.width ?? minWidth, visibility: pos ? "visible" : "hidden" }
    : { position: "absolute", top: "calc(100% + 4px)", left: 0, minWidth: "100%" };
  const menu = open && (
    <div ref={panelRef} className="popin" role="listbox" style={{ ...placement,
      maxHeight: 340, overflowY: "auto", background: "var(--ink-color-global-surface-background-default)", border: `1px solid var(--ink-color-global-border-subtle)`, borderRadius: 6,
      boxShadow: POPOVER_SHADOW, zIndex: Z.popover, padding: "4px 0", transformOrigin: "top left" }}>
      {searchable && (
        <div style={{ padding: "0 8px 6px" }}>
          <SearchInput placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: "100%" }} />
        </div>
      )}
      {shown.map((o) => {
        const on = o.id === value;
        return (
          <MenuItem key={o.id} onClick={() => { onChange(o.id); setOpen(false); }} selected={on} checkmark
            style={{ borderTop: o.separatorBefore ? `1px solid var(--ink-color-global-border-subtle)` : "none",
              marginTop: o.separatorBefore ? 4 : 0, paddingTop: o.separatorBefore ? 10 : 8 }}>
            {o.label}
          </MenuItem>
        );
      })}
      {searchable && shown.length === 0 && (
        <div style={{ ...sans, fontSize: FS.small, color: MICRO, padding: "8px 12px" }}>No matches</div>
      )}
    </div>
  );

  return (
    <div ref={ref} style={{ position: "relative", display: "inline-block" }}>
      <button onClick={() => setOpen((o) => !o)} aria-haspopup="listbox" aria-expanded={open} data-testid={testId}
        className={`dd-trigger${open ? " is-open" : ""}`}
        style={{ ...ddTriggerStyle({ minWidth, maxWidth, ...(compact ? COMPACT_TRIGGER_STYLE : null) }), cursor: "pointer" }}>
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{triggerLabel ? `${triggerLabel}: ${label}` : label}</span>
        <ChevronDownIcon size={compact ? 12 : 16} strokeWidth={1.5} style={{ flex: "none" }} />
      </button>
      {portal ? (menu && createPortal(menu, document.body)) : menu}
    </div>
  );
}

// Shared visual language for FilterMenu's popover — one warm side-nav panel
// with an active-row highlight, a blue "active filter" chip, and a blue count
// bubble. Exported so any filter popover in the app (including PivotDashboard's
// own GlobalFilter) reads identically instead of re-deriving these colors.
export const GF_WARM_SURFACE = "light-dark(#FBFAF9, #2D2D2D)"; // side-nav background
export const GF_NAV_ACTIVE_BG = "light-dark(#E9EAEA, #394040)"; // gray-30 / gray-90
export const GF_TAG_BORDER = "light-dark(#285DA3, #2C67B5)"; // blue-70 / blue-60
export const GF_TAG_BG = "light-dark(#EAF0F8, transparent)"; // blue-10
export const GF_BUBBLE_BG = "light-dark(#EAF0F8, rgb(18 18 18))";

/** Set-aware equality — the only composite value type a FilterMenu section
 *  value takes on today (everything else is a primitive, `===` is enough). */
const valuesEqual = (a, b) => {
  if (a instanceof Set && b instanceof Set) {
    if (a.size !== b.size) return false;
    for (const v of a) if (!b.has(v)) return false;
    return true;
  }
  return a === b;
};

/** Shared multi-section filter popover: a "Filters" trigger, active-filter
 *  chips, and a nav/pane panel when open. Draft/apply staging — edits apply
 *  only on "Apply". `sections`: `[{key, label, value, onChange, count(value),
 *  render(draftValue, setDraftValue), resetValue?}]`. `chips`: `[{key, label,
 *  onClear, pinned?}]` — a `pinned` chip always shows, but its × only once
 *  `value` differs from `resetValue`. `onResetAll` needs no Apply. */
export function FilterMenu({ sections, chips = [], onResetAll, triggerLabel = "Filters", portal }) {
  const [open, setOpen] = useState(false);
  const [activeKey, setActiveKey] = useState(sections[0]?.key);
  const [draft, setDraft] = useState(() => Object.fromEntries(sections.map((s) => [s.key, s.value])));
  const ref = useRef(null);
  const panelRef = useRef(null);
  useDismissable(open, setOpen, [ref, panelRef]);
  // Same `portal` escape hatch as Dropdown — see usePortalAnchor's doc comment.
  const anchorRect = usePortalAnchor(open && !!portal, ref);
  const pos = anchorRect && { top: anchorRect.bottom + 4, left: anchorRect.left };
  const sectionsByKey = useMemo(() => new Map(sections.map((s) => [s.key, s])), [sections]);
  // Re-seed the draft on open; while open, merge in any newly-appeared
  // section key so a changed `sections` list never leaves one missing.
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open && !wasOpen.current) {
      setDraft(Object.fromEntries(sections.map((s) => [s.key, s.value])));
      setActiveKey((k) => (sectionsByKey.has(k) ? k : sections[0]?.key));
    } else if (open) {
      setDraft((d) => {
        const missing = sections.filter((s) => !(s.key in d));
        return missing.length ? { ...d, ...Object.fromEntries(missing.map((s) => [s.key, s.value])) } : d;
      });
    }
    wasOpen.current = open;
  }, [open, sections, sectionsByKey]);
  const active = sectionsByKey.get(activeKey) || sections[0];
  const setDraftFor = (key, v) => setDraft((d) => ({ ...d, [key]: v }));
  const apply = () => { for (const s of sections) s.onChange(draft[s.key]); setOpen(false); };
  const resetValueOf = (s) => (s.resetValue !== undefined ? s.resetValue : s.value);
  const resetDraft = () => setDraft(Object.fromEntries(sections.map((s) => [s.key, resetValueOf(s)])));

  // Chips and the top-level Reset act on applied state directly (no Apply
  // needed) — resync any open draft too, or Apply would re-apply stale values.
  const chip = ({ key, label, onClear, pinned }) => {
    const s = sectionsByKey.get(key);
    const clearable = !pinned || (s && !valuesEqual(s.value, s.resetValue));
    return (
      <span key={key} style={{ display: "inline-flex", alignItems: "center", height: 28,
        padding: clearable ? "0 4px 0 8px" : "0 8px",
        fontSize: 12, lineHeight: 1, whiteSpace: "nowrap", borderRadius: 4, boxSizing: "border-box",
        border: `1px solid ${GF_TAG_BORDER}`, background: GF_TAG_BG, color: GF_TAG_BORDER, ...sans }}>
        {label}
        {clearable && (
          <button onClick={() => { onClear(); if (s) setDraftFor(key, resetValueOf(s)); }}
            aria-label={`Clear ${label} filter`}
            style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", marginLeft: 6,
              width: 16, height: 16, border: "none", borderRadius: 3, background: "transparent",
              color: "inherit", cursor: "pointer", padding: 0 }}>×</button>
        )}
      </span>
    );
  };

  const placement = portal
    ? { position: "fixed", top: pos?.top ?? 0, left: pos?.left ?? 0, visibility: pos ? "visible" : "hidden" }
    : { position: "absolute", top: "calc(100% + 4px)", left: 0 };
  const panel = open && (
        <div ref={panelRef} className="popin" style={{ ...placement,
          width: 510, height: 380, background: "var(--ink-color-global-surface-background-default)",
          border: `1px solid var(--ink-color-global-border-subtle)`, borderRadius: 8, boxShadow: POPOVER_SHADOW,
          zIndex: Z.popover, display: "flex", overflow: "hidden", ...(portal ? sans : null) }}>
          <nav style={{ width: 200, background: GF_WARM_SURFACE, borderRight: `1px solid var(--ink-color-global-border-subtle)`,
            padding: "8px 0", overflowY: "auto", flex: "none" }}>
            {sections.map(({ key, label, count }) => (
              <button key={key} onClick={() => setActiveKey(key)}
                style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%",
                  height: 36, padding: "0 16px", gap: 10, fontSize: 14, lineHeight: "20px", fontWeight: activeKey === key ? 500 : 400,
                  color: "var(--ink-color-global-text-default)", cursor: "pointer", border: "none", textAlign: "left",
                  background: activeKey === key ? GF_NAV_ACTIVE_BG : "transparent", ...sans }}
                onMouseEnter={(e) => { if (activeKey !== key) e.currentTarget.style.background = "var(--ink-color-global-surface-lightgray-default)"; }}
                onMouseLeave={(e) => { if (activeKey !== key) e.currentTarget.style.background = "transparent"; }}>
                <span>{label}</span>
                {count(draft[key]) > 0 && (
                  <span style={{ display: "inline-flex", alignItems: "center", height: 18, padding: "0 8px", fontSize: 12,
                    fontWeight: 500, letterSpacing: "0.01em", borderRadius: 999, whiteSpace: "nowrap", boxSizing: "border-box",
                    border: `1px solid var(--ink-color-global-feedback-info-strong)`, background: GF_BUBBLE_BG,
                    color: "var(--ink-color-global-feedback-info-strong)", ...sans }}>{count(draft[key])}</span>
                )}
              </button>
            ))}
          </nav>
          <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
            <div style={{ flex: 1, padding: "20px 24px", overflowY: "auto" }}>
              {active && (
                <>
                  <h3 style={{ ...sans, fontSize: 14, fontWeight: 500, color: "var(--ink-color-global-text-default)", margin: "0 0 14px" }}>
                    {active.label}
                  </h3>
                  {active.render(draft[active.key], (v) => setDraftFor(active.key, v))}
                </>
              )}
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8,
              padding: "12px 24px", borderTop: `1px solid var(--ink-color-global-border-subtle)` }}>
              <Btn onClick={resetDraft}>Reset</Btn>
              <Btn kind="primary" onClick={apply}>Apply</Btn>
            </div>
          </div>
        </div>
  );

  return (
    <div ref={ref} style={{ position: "relative", display: "inline-flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
      <button onClick={() => setOpen((o) => !o)} className={`dd-trigger${open ? " is-open" : ""}`}
        style={{ ...ddTriggerStyle({ minWidth: 110 }), cursor: "pointer" }}>
        <span>{triggerLabel}</span>
        <ChevronDownIcon size={16} strokeWidth={1.5} style={{ flex: "none" }} />
      </button>

      {chips.map(chip)}
      {onResetAll && chips.some((c) => !c.pinned) && (
        // Distinct label from the in-panel footer's "Reset" (which only
        // clears the open draft) — this one clears every applied filter now.
        <button onClick={onResetAll} style={{ height: 28, padding: "0 8px", border: "none", borderRadius: 4,
          background: "transparent", color: "var(--ink-color-global-text-default)", fontSize: 12, fontWeight: 500,
          cursor: "pointer", ...sans }}>Reset all</button>
      )}

      {portal ? (panel && createPortal(panel, document.body)) : panel}
    </div>
  );
}

/** Shared checkbox input, fixed at 16px. Flex items shrink by default, so a
 *  plain `<input>` in a row beside a wrapped multi-line label visibly shrank —
 *  `flexShrink: 0` (not just `width`) is what actually prevents that. */
export function Checkbox({ checked, onChange, style, ...rest }) {
  return (
    <input {...rest} type="checkbox" checked={checked} onChange={onChange}
      style={{ width: 16, height: 16, flex: "0 0 16px", margin: 0,
        accentColor: "var(--ink-color-global-border-active)", cursor: "pointer", ...style }} />
  );
}

/** Checkbox-list pane content for a FilterMenu section. `options`:
 *  `[{id, label, sub?}]`; `selected`: a Set; `onChange(nextSet)`. Shows an
 *  inline search box once options exceed `searchMin` (a handful of options
 *  scan faster than they'd search). */
export function FilterCheckboxList({ options, selected, onChange, searchMin = 8, searchPlaceholder = "Search" }) {
  const [q, setQ] = useState("");
  const shown = filterByLabel(options, q);
  const toggle = (id) => { const n = new Set(selected); n.has(id) ? n.delete(id) : n.add(id); onChange(n); };
  return (
    <>
      {options.length > searchMin && (
        <SearchInput placeholder={searchPlaceholder} value={q} onChange={(e) => setQ(e.target.value)} style={{ width: "100%", marginBottom: 10 }} />
      )}
      {shown.length > 0 && (
        <div style={{ display: "flex", gap: 10, marginBottom: 10 }}>
          <Btn kind="link" style={{ fontSize: FS.small }} onClick={() => onChange(new Set([...selected, ...shown.map((o) => o.id)]))}>
            Select all{q ? " matching" : ""}
          </Btn>
          <Btn kind="link" style={{ fontSize: FS.small }} onClick={() => { const visible = new Set(shown.map((o) => o.id)); onChange(new Set([...selected].filter((id) => !visible.has(id)))); }}>
            Clear{q ? " matching" : ""}
          </Btn>
        </div>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {shown.map((o) => (
          <label key={o.id} style={{ ...sans, display: "flex", alignItems: "flex-start", gap: 10,
            fontSize: 14, lineHeight: "20px", color: "var(--ink-color-global-text-default)", cursor: "pointer" }}>
            <Checkbox checked={selected.has(o.id)} onChange={() => toggle(o.id)} style={{ marginTop: 2 }} />
            <span style={{ flex: "1 1 auto" }}>{o.label}</span>
            {o.sub != null && <span style={{ color: "var(--ink-color-global-text-subtle)", fontSize: 12 }}>{o.sub}</span>}
          </label>
        ))}
        {shown.length === 0 && <p style={{ ...sans, fontSize: FS.bodyLg, color: MICRO, margin: 0 }}>No matches.</p>}
      </div>
    </>
  );
}

/** Radio-list pane content for a FilterMenu section — options `[{id, label}]`,
 *  single-select like a native radio group. */
export function FilterRadioList({ name, options, value, onChange }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {options.map((o) => (
        <label key={o.id} style={{ ...sans, display: "flex", alignItems: "flex-start", gap: 10,
          fontSize: 14, lineHeight: "20px", color: "var(--ink-color-global-text-default)", cursor: "pointer" }}>
          <input type="radio" name={name} checked={value === o.id} onChange={() => onChange(o.id)}
            style={{ width: 16, height: 16, flex: "0 0 16px", margin: 0, marginTop: 2,
              accentColor: "var(--ink-color-global-border-active)", cursor: "pointer" }} />
          <span style={{ flex: "1 1 auto" }}>{o.label}</span>
        </label>
      ))}
    </div>
  );
}

/** Labelled `.tape` range slider — the single source for the app's numeric
 *  planning inputs (e.g. the Forecast tab's bias weight). A header row (label +
 *  formatted value) sits over the track. `.tape` styling lives in theme.js.
 *
 *  Props: label, value, min, max, step, onChange(number), fmt(value)=>string.
 *  Optional — accent (tape fill + default value color; e.g. an AllocBar segment
 *  color), valueColor (override the value-text color), valueSize (default small),
 *  labelKind "subtle" (default) | "strong" (600-weight, default-text label),
 *  fill (0..1 override when the caller drives the fill directly), disabled (inert),
 *  title, and style (the wrapper — carries per-call flex sizing). */
export function Slider({ label, hint, value, min, max, step, onChange, fmt, accent, valueColor, valueSize = FS.small,
  labelKind = "subtle", fill, disabled, title, style }) {
  const muted = disabled;
  const pct = fill != null
    ? Math.max(0, Math.min(1, fill)) * 100
    : (max > min ? ((value - min) / (max - min)) * 100 : 0);
  return (
    <div style={{ opacity: muted ? 0.6 : 1, ...style }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 4 }}>
        <span style={{ ...sans, fontSize: FS.small, fontWeight: labelKind === "strong" ? 600 : 400, display: "inline-flex", alignItems: "center", gap: 4,
          color: labelKind === "strong" ? "var(--ink-color-global-text-default)" : "var(--ink-color-global-text-subtle)" }}>
          {label}{hint && <HintIcon hint={hint} iconSize={14} />}
        </span>
        <span style={{ ...mono, fontSize: valueSize, fontWeight: 700, color: valueColor ?? accent ?? "var(--ink-color-global-text-default)" }}>{fmt(value)}</span>
      </div>
      <input className="tape" type="range" min={min} max={max} step={step} value={value} disabled={disabled}
        aria-label={label} title={title}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        style={{ "--fill": pct + "%", "--tape-accent": accent ?? "var(--ink-color-global-link-default)",
          cursor: disabled ? "default" : "pointer" }} />
    </div>
  );
}

/** Big-figure stat tile — a label, a large value, and an optional sub/delta line.
 *  The single source for the app's hand-rolled stat tiles across views.
 *  Chrome-less
 *  by design — the caller supplies the surrounding card/divider layout; this owns
 *  only the label+value+sub block so the type ramp lives in one place.
 *
 *  Props: label, value (node or string), sub
 *  (node rendered below, e.g. a vs-baseline delta). Optional — color (value color),
 *  labelPos "top" (label above value — the eyebrow scorecard look) | "bottom"
 *  (value above label — the display-figure look), size "display" (default) | "h3"
 *  (compact), serif (serif display look instead of tabular mono), labelTone
 *  "eyebrow" (uppercase micro, default for top) | "strong" (600-weight default-text)
 *  | "muted" (micro subtle) | "plain" (12px/400 sentence-case, Ink's real Tile
 *  label style — text-subtle, which is Ink's gray-80 in this app's palette),
 *  align, style. */
/** One app-wide tooltip, driven by a `data-tip` attribute rather than per-element
 *  state. Mounted once in App; it delegates mouseover/focus on the document, so a
 *  call site only writes `data-tip="…"` on any element — including the hundreds of
 *  cells in the pivot/coverage/heatmap grids, where a stateful per-cell wrapper
 *  would be far too heavy.
 *
 *  This exists because the app previously leaned on the native `title` attribute,
 *  which browsers render inconsistently and only after a ~1s hover — users saw the
 *  help cursor and no explanation. Rendering our own means the tooltip appears
 *  immediately, wraps long text properly, and is styled like the rest of the app.
 *  Portaled to <body> and `position: fixed` so it escapes the `overflow: hidden`
 *  cards that wrap most tables. */
export function TooltipLayer() {
  const [tip, setTip] = useState(null);
  const [caretOffset, setCaretOffset] = useState(0);
  const boxRef = useRef(null);
  // A ref mirror of `tip`, read inside the native-event `hide` handler below —
  // that closure is created once and would otherwise see a stale `tip` value.
  const tipRef = useRef(null);
  const closeTimer = useRef(null);
  const setTipState = (next) => { tipRef.current = next; setTip(next); };
  useEffect(() => {
    const find = (t) => (t && t.closest ? t.closest("[data-tip]") : null);
    const show = (e) => {
      const el = find(e.target);
      const text = el && el.getAttribute("data-tip");
      if (!text) return;
      clearTimeout(closeTimer.current);
      const r = el.getBoundingClientRect();
      // flip below the trigger when there isn't room above it (top-of-page rows)
      const below = r.top < 150;
      const anchorX = r.left + r.width / 2;
      const x = Math.min(Math.max(anchorX, 180), window.innerWidth - 180);
      const linkHref = el.getAttribute("data-tip-link-href");
      const linkText = el.getAttribute("data-tip-link-text");
      // anchorX (the real trigger center) is kept alongside the clamped x so
      // the caret can be re-centered on it once the box's real width is known.
      setTipState({ text, below, x, anchorX, y: below ? r.bottom + 8 : r.top - 8,
        link: linkHref && linkText ? { href: linkHref, text: linkText, suffix: el.getAttribute("data-tip-link-suffix") || "" } : null });
    };
    // Cursor headed straight for the bubble (relatedTarget inside it)? Skip the
    // timer race entirely. Otherwise fall back to a grace-period timer.
    const hide = (e) => {
      if (!find(e.target)) return;
      if (!tipRef.current?.link) { setTipState(null); return; }
      if (boxRef.current?.contains(e.relatedTarget)) return;
      closeTimer.current = setTimeout(() => setTipState(null), 500);
    };
    const clear = () => { clearTimeout(closeTimer.current); setTipState(null); };
    document.addEventListener("mouseover", show);
    document.addEventListener("focusin", show);
    document.addEventListener("mouseout", hide);
    document.addEventListener("focusout", hide);
    window.addEventListener("scroll", clear, true);
    window.addEventListener("resize", clear);
    return () => {
      clearTimeout(closeTimer.current);
      document.removeEventListener("mouseover", show);
      document.removeEventListener("focusin", show);
      document.removeEventListener("mouseout", hide);
      document.removeEventListener("focusout", hide);
      window.removeEventListener("scroll", clear, true);
      window.removeEventListener("resize", clear);
    };
  }, []);
  // The box's width is content-driven (short text renders far narrower than
  // maxWidth), so the caret cap must come from the real measured width.
  useLayoutEffect(() => {
    if (!tip || !boxRef.current) { setCaretOffset(0); return; }
    const halfWidth = boxRef.current.getBoundingClientRect().width / 2;
    const cap = Math.max(0, halfWidth - 10); // keep the triangle's point on the box
    setCaretOffset(Math.max(-cap, Math.min(cap, tip.anchorX - tip.x)));
  }, [tip]);
  // Ink's real Tooltip recipe (theme-with-ink's .ink-tooltip). Caret flips
  // since this tooltip, unlike that recipe's fixed placement, can sit above or below.
  const caret = (
    <span style={{ position: "absolute", left: `calc(50% + ${caretOffset}px)`, transform: "translateX(-50%)",
      ...(tip?.below
        ? { bottom: "100%", borderLeft: "5px solid transparent", borderRight: "5px solid transparent", borderBottom: "5px solid var(--ink-color-global-surface-darkgray-default)" }
        : { top: "100%", borderLeft: "5px solid transparent", borderRight: "5px solid transparent", borderTop: "5px solid var(--ink-color-global-surface-darkgray-default)" }) }} />
  );
  return createPortal(
    <>
      <style>{`[data-tip]:not(button):not(a){cursor:help}`}</style>
      {tip && (
        <div ref={boxRef} role="tooltip"
          // Only a link-bearing tip needs real pointer events / hover persistence —
          // every other (linkless) tip keeps its old instant-hide, no-interaction behavior.
          onMouseEnter={tip.link ? () => clearTimeout(closeTimer.current) : undefined}
          onMouseLeave={tip.link ? () => { closeTimer.current = setTimeout(() => setTipState(null), 500); } : undefined}
          style={{
            position: "fixed", left: tip.x, top: tip.y, zIndex: Z.tooltip, pointerEvents: tip.link ? "auto" : "none",
            transform: `translate(-50%, ${tip.below ? "0" : "-100%"})`,
            maxWidth: 340, padding: "6px 8px", borderRadius: "var(--ink-size-global-radius-subtle)",
            background: "var(--ink-color-global-surface-darkgray-default)", color: "var(--ink-color-global-brand-white)",
            boxShadow: "var(--ink-elevation-global-shadow-medium)",
            ...sans, fontSize: 12, fontWeight: 400, lineHeight: 1.5,
            whiteSpace: "pre-wrap", textAlign: "left",
          }}>
          {tip.text}
          {tip.link && (
            <>
              {"\n\n"}
              <a href={tip.link.href} target="_blank" rel="noopener noreferrer"
                style={{ color: "var(--ink-color-global-brand-white)", textDecoration: "underline" }}>{tip.link.text}</a>
              {tip.link.suffix}
            </>
          )}
          {caret}
        </div>
      )}
    </>,
    document.body,
  );
}

/** Centered modal dialog; Escape or outside-click closes it.
 *  Portals to document.body so it escapes any ancestor `overflow`/`maxHeight`
 *  clipping. Backdrop sits above the pivot sticky headers (2–3) but below
 *  popovers (Z.popover) so dropdowns opened inside the modal stay clickable. */
export function Modal({ open, onClose, title, subtitle, children, width = 760, minHeight, labelledById }) {
  const panelRef = useRef(null);
  // `.popin` is the shared class on every portaled popover; a click inside one
  // (e.g. selecting a KPI in a MultiSelect menu) must not dismiss the Modal.
  useDismissable(open, onClose, panelRef, { insideSelector: ".popin" });
  if (!open) return null;
  return createPortal(
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: Z.modal,
      background: "rgba(20,24,24,.44)", display: "flex", alignItems: "flex-start",
      justifyContent: "center", padding: "6vh 16px", overflowY: "auto" }}>
      <div ref={panelRef} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true"
        aria-labelledby={labelledById}
        style={{ background: "var(--ink-color-global-surface-background-default)",
          border: `1px solid var(--ink-color-global-border-default)`, borderRadius: 10,
          boxShadow: POPOVER_SHADOW, width: `min(${width}px, 100%)`, maxWidth: width,
          maxHeight: "88vh", minHeight: minHeight ? `min(${minHeight}px, 88vh)` : undefined,
          display: "flex", flexDirection: "column" }}>
        <div style={{ position: "sticky", top: 0, zIndex: 1, display: "flex", alignItems: "flex-start",
          justifyContent: "space-between", gap: 12, padding: "16px 20px",
          borderBottom: `1px solid var(--ink-color-global-border-subtle)`,
          background: "var(--ink-color-global-surface-background-default)", borderRadius: "10px 10px 0 0" }}>
          <div>
            <h2 id={labelledById} style={{ ...sans, fontSize: 24, fontWeight: 500, lineHeight: "32px", letterSpacing: "-0.01em", margin: 0,
              color: "var(--ink-color-global-text-default)" }}>{title}</h2>
            {subtitle && <div style={{ ...sans, fontSize: FS.small, color: MICRO, marginTop: 4 }}>{subtitle}</div>}
          </div>
          <button onClick={onClose} aria-label="Close settings"
            style={{ border: "none", background: "transparent", cursor: "pointer", padding: 4, lineHeight: 1,
              fontSize: 20, color: "var(--ink-color-global-text-subtle)" }}>×</button>
        </div>
        <div style={{ padding: 20, overflowY: "auto", flex: 1 }}>{children}</div>
      </div>
    </div>,
    document.body,
  );
}

/** Glossary / "what am I looking at" card. A stack of term → plain-English
 *  definition rows, collapsed by default so it never competes with the numbers
 *  it explains. `items` = [{term, short, body}] — `short` is the one-line gloss
 *  shown next to the term, `body` the fuller "how to read it" paragraph. Used by
 *  the Forecast tab, where the stats (MAPE, bias, beat-naive) are jargon to
 *  anyone who hasn't done forecast backtesting before. */
export function Glossary({ title = "What these numbers mean", items = [], defaultOpen = false, style }) {
  if (!items.length) return null;
  return (
    // No bottom margin — pages are gapped flex columns and own the spacing.
    <details open={defaultOpen} className="card" style={{ padding: "12px 16px", ...style }}>
      <summary style={{ ...sans, fontSize: FS.small, fontWeight: 600, cursor: "pointer",
        color: "var(--ink-color-global-text-default)", listStyle: "revert" }}>{title}</summary>
      <dl style={{ margin: "12px 0 4px", display: "grid", gap: 12 }}>
        {items.map((it) => (
          <div key={it.term}>
            <dt style={{ ...sans, fontSize: FS.small, fontWeight: 600, color: "var(--ink-color-global-text-default)" }}>
              {it.term}{it.short ? <span style={{ fontWeight: 400, color: "var(--ink-color-global-text-subtle)" }}> — {it.short}</span> : null}
            </dt>
            {it.body && <dd style={{ ...sans, fontSize: FS.small, lineHeight: 1.6, margin: "3px 0 0",
              color: "var(--ink-color-global-text-subtle)", maxWidth: 900 }}>{it.body}</dd>}
          </div>
        ))}
      </dl>
    </details>
  );
}

export function StatTile({ label, value, sub, color = "var(--ink-color-global-text-default)",
  labelPos = "top", size = "display", serif: useSerif, labelTone, align = "left", hint,
  linkHref, linkText, linkSuffix, labelLines, style }) {
  const tone = labelTone ?? (labelPos === "top" ? "eyebrow" : "strong");
  const valStyle = useSerif
    ? { ...serif, fontSize: size === "h3" ? FS.h3 : FS.display, fontWeight: 700, color, letterSpacing: "-0.01em", lineHeight: 1.1, fontVariantNumeric: "tabular-nums" }
    : { ...mono, fontSize: size === "h3" ? FS.h3 : FS.display, fontWeight: 700, color, letterSpacing: "-0.02em", lineHeight: 1.05 };
  // a `hint` adds the standard "(?)" hover trigger carrying a plain-English definition.
  const labelText = hint
    ? <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>{label}<HintIcon hint={hint} linkHref={linkHref} linkText={linkText} linkSuffix={linkSuffix} /></span>
    : label;
  const labelEl = tone === "eyebrow"
    ? <Eyebrow color={MICRO} style={{ whiteSpace: "nowrap" }}>{labelText}</Eyebrow>
    : <div style={tone === "muted"
        ? { ...sans, fontSize: FS.micro, color: "var(--ink-color-global-text-subtle)" }
        : tone === "plain"
        ? { ...sans, fontSize: FS.body, fontWeight: 400, color: "var(--ink-color-global-text-subtle)" }
        : { ...sans, fontSize: FS.small, fontWeight: 600, color: "var(--ink-color-global-text-default)" }}>{labelText}</div>;
  // `labelLines` reserves a fixed label height and bottom-anchors the text, so a
  // wrapping label doesn't push its value below single-line neighbours in a row.
  const labelBox = labelPos === "top" && labelLines
    ? <div style={{ display: "flex", flexDirection: "column", justifyContent: "flex-end", minHeight: `calc(${labelLines} * 1.3em)`, fontSize: FS.body }}>{labelEl}</div>
    : labelEl;
  const valueEl = <div style={{ ...valStyle, marginTop: labelPos === "top" ? 6 : 0 }}>{value}</div>;
  const subEl = sub != null && (
    <div style={{ ...sans, fontSize: FS.small, color: "var(--ink-color-global-text-subtle)", marginTop: labelPos === "top" ? 5 : 2 }}>{sub}</div>
  );
  return (
    <div style={{ textAlign: align, ...style }}>
      {labelPos === "top" ? <>{labelBox}{valueEl}{subEl}</> : <>{valueEl}<div style={{ marginTop: 5 }}>{labelEl}{subEl}</div></>}
    </div>
  );
}

/** Bordered "Summary" stat row — the single source for the app's hand-rolled
 *  headline stat bars, matching Ink's real Tile/Summary pattern (ink.carta.com/
 *  components/Tile): one bordered card, equal-width key-value pairs on a
 *  plain gap (no divider hairlines between them — the Figma export has none),
 *  each a big value over its label.
 *
 *  `title` renders as a `Heading2` (Ink's real 20px/500 sentence-case heading) —
 *  matching fund-modeling's own `StatBar`-equivalent title exactly, and the
 *  sibling apps' broader convergence away from a small-caps Eyebrow treatment
 *  here (manco-reporting moved its stat labels off Eyebrow for the same
 *  reason). A small-caps Eyebrow reads as a caption for something else
 *  nearby, not as the title of its own card — wrong for a strip whose title
 *  IS the card's identity.
 *  `bare` skips the card border/padding entirely (just the divided stat row)
 *  for callers that already sit inside their own card.
 *
 *  Ink's real order is label-above-value (confirmed in the Figma export —
 *  "Carried interest accrued" sits above "$12,260.20"); StatBar defaults to
 *  `labelPos="top"` to match. `labelTone` defaults to `"plain"` — Ink's real
 *  label is 12px/regular-weight sentence case, NOT the uppercase small-caps
 *  eyebrow look StatTile otherwise defaults to for top-positioned labels.
 *  No card in this bar should render small caps; if a future call site
 *  really wants the eyebrow look it must opt in explicitly.
 *
 *  Ink's Tile has no hover elevation (unlike this app's other `.card`s, which
 *  lift on hover) — the card wrapper below adds `stat-bar` to suppress it
 *  (`.card.stat-bar:hover` in theme.js).
 *
 *  Props: stats (array of StatTile prop objects — label, value, sub, color;
 *  a `key` falls back to `label`), title, bare, style (card/row wrapper),
 *  itemStyle (per-stat override), labelPos/labelTone/serif/size (forwarded
 *  to every StatTile, default "top"/"plain"/true/"display" — a per-stat value
 *  of the same name overrides), basis (each item's flex-basis + min-width in
 *  px, default 150 — tune per call site to match its stat count/label length),
 *  gap (real CSS gap on the row, default 0 — every call site spaces stats via
 *  each StatTile's own padding instead; set `gap` explicitly if a caller
 *  zeroes that padding on a `bare` row, so removing
 *  padding doesn't leave stats with no separation at all). */
export function StatBar({ stats, title, bare, style, itemStyle, labelPos = "top", labelTone = "plain", serif = true, size, basis = 150, gap = 0, labelLines }) {
  const row = (
    <div style={{ display: "flex", flexWrap: "wrap", gap, ...(bare ? style : undefined) }}>
      {stats.map((s, i) => (
        <StatTile key={s.key ?? s.label ?? i} label={s.label} value={s.value} sub={s.sub} color={s.color} hint={s.hint}
          linkHref={s.linkHref} linkText={s.linkText} linkSuffix={s.linkSuffix}
          labelPos={s.labelPos ?? labelPos} serif={s.serif ?? serif} labelTone={s.labelTone ?? labelTone} size={s.size ?? size}
          labelLines={s.labelLines ?? labelLines}
          style={{ flex: `1 1 ${basis}px`, minWidth: basis, padding: "0 20px", ...itemStyle }} />
      ))}
    </div>
  );
  if (bare) return row;
  return (
    <div className="card stat-bar" style={{ padding: "18px 8px", ...style }}>
      {title && <Heading2 style={{ margin: "2px 20px 9px" }}>{title}</Heading2>}
      {row}
    </div>
  );
}

/** QoQ/YoY delta, e.g. "▲ 12%" or "▼ 8%" — plain colored caret + figure, no
 *  pill. `delta` is { dir: "up"|"down", pct: number } (pct already ×100);
 *  null/undefined renders nothing. The single source for this shape — also
 *  used by the Overview's RankedTable. */
export function DeltaText({ delta }) {
  if (!delta) return null;
  const up = delta.dir === "up";
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 3, fontVariantNumeric: "tabular-nums",
      color: up ? "var(--ink-color-global-feedback-positive-strong)" : "var(--ink-color-global-feedback-negative-strong)" }}>
      <span aria-hidden="true" style={{ fontSize: FS.micro, lineHeight: 1 }}>{up ? "▲" : "▼"}</span>
      {Math.round(delta.pct)}%
    </span>
  );
}

/** Small key-value table — a `label | value` row per stat, in a plain
 *  bordered box (never `.card`/`.panel`; see `.kv-table-wrap` in theme.js).
 *  `rows` takes the same shape as `StatBar`'s `stats`, plus two optional
 *  fields: `delta` (rendered via `DeltaText` right of the value) and `asOf`
 *  (its own trailing column — added only when at least one row sets it, so
 *  a table with no dates doesn't carry a permanently empty column). */
export function KVTable({ rows, title, style }) {
  const showAsOf = rows.some((r) => r.asOf != null);
  // A rank column appears only when some row carries a rank (the KPI snapshot).
  const showRank = rows.some((r) => r.rank != null);
  // Only reserve a fixed value-width when this table actually has deltas —
  // otherwise every row's own value stays free to size to its own content.
  const showDelta = rows.some((r) => r.delta);
  return (
    <div className="kv-table-wrap" style={style}>
      {title && <Eyebrow color={MICRO} style={{ margin: "12px 16px 0" }}>{title}</Eyebrow>}
      <table className="ledger sheet kv">
        <colgroup>
          <col style={{ width: 280 }} />
          <col />
          {showRank && <col />}
          {showAsOf && <col />}
        </colgroup>
        <tbody>
          {/* no-row-hover: a key-value table isn't a data grid — hovering a row here
              doesn't affect anything, so the highlight only adds noise. This is the
              same exclusion the accordion's detail row uses (theme.js), which the
              general tr:hover rule's own :not(.no-row-hover) clause already honors —
              no specificity fight to win, unlike a table-scoped override rule would need. */}
          {rows.map((r, i) => (
            <tr key={r.key ?? (typeof r.label === "string" ? r.label : i)} className="no-row-hover">
              <td className="kv-label">
                <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                  {r.label}
                  {r.hint && <HintIcon hint={r.hint} />}
                </span>
                {r.sub != null && <div className="kv-sub">{r.sub}</div>}
              </td>
              <td className="kv-value" style={{ color: r.color }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                  <span style={showDelta ? { minWidth: 64, textAlign: "right" } : undefined}>{r.value}</span>
                  {r.delta && <DeltaText delta={r.delta} />}
                </span>
              </td>
              {showRank && <td className="kv-rank">{r.rank ?? "—"}</td>}
              {showAsOf && <td className="kv-asof">{r.asOf != null ? `as of ${r.asOf}` : "—"}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** One compact line of status facts under a card header: a leading status Badge,
 *  then dot-separated items. An item with a `tone` renders as a mini Badge (a
 *  count chip); `hint` puts the detail behind a hover tip. */
export function StatusLine({ status, items = [], style }) {
  const cells = items.filter(Boolean);
  return (
    <div className="status-line" style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 8,
      ...sans, fontSize: FS.small, color: MICRO, marginBottom: 10, ...style }}>
      {status && <Badge tone={status.tone} title={status.hint}>{status.label}</Badge>}
      {cells.map((it, i) => (
        <Fragment key={i}>
          {(i > 0 || status) && <span aria-hidden="true">·</span>}
          {it.tone
            ? <Badge tone={it.tone} title={it.hint}>{it.text}</Badge>
            : <span data-tip={it.hint} style={it.hint ? { cursor: "help" } : undefined}>{it.text}</span>}
        </Fragment>
      ))}
    </div>
  );
}

/** Drop-in `StatBar` replacement: same `stats` prop, rendered as one
 *  `KVTable` (no internal splitting — pairing sections into a 2-per-row
 *  layout is the page's job, not this component's). */
export function KVTableRow({ stats, title, style }) {
  if (!stats?.length) return null;
  return <KVTable rows={stats} title={title} style={style} />;
}

// Tone → { fg, border, bg } for Badge's default chrome. Modeled on Ink's REAL
// Tag component: border = tone-strong, background = tone-subtle tint, per Ink's
// semantic Tag variants. `warning` uses Ink's real "feedback-notice" semantic
// Tag variant ("Requires Action") — brand-yellow-80/-20, not a custom color;
// see NOTICE/NOTICE_TINT in theme.js for the full derivation.
const BADGE_TONE = {
  neutral:  { fg: "var(--ink-color-global-text-subtle)", border: "var(--ink-color-global-border-subtle)", bg: "var(--ink-color-global-surface-lightgray-default)" },
  info:     { fg: "var(--ink-color-global-link-default)", border: "var(--ink-color-global-link-default)", bg: "var(--accent-soft)" },
  positive: { fg: "var(--ink-color-global-feedback-positive-strong)", border: "var(--ink-color-global-feedback-positive-strong)", bg: "var(--ink-color-global-feedback-positive-subtle)" },
  negative: { fg: "var(--ink-color-global-feedback-negative-strong)", border: "var(--ink-color-global-feedback-negative-strong)", bg: "var(--ink-color-global-feedback-negative-subtle)" },
  warning:  { fg: NOTICE, border: NOTICE, bg: NOTICE_TINT },
  strong:   { fg: "var(--ink-color-global-text-default)", border: "var(--ink-color-global-text-default)", bg: "var(--ink-color-global-surface-lightgray-default)" },
  // `neutral`'s fg (text-subtle) is the raw Ink token — near-invisible on dark
  // surfaces (see MICRO's own doc comment in theme.js). `muted` uses the app's
  // corrected MICRO override instead, for annotation badges that want a quiet
  // gray without falling back to the broken raw token.
  muted:    { fg: MICRO, border: "var(--ink-color-global-border-subtle)", bg: "var(--ink-color-global-surface-lightgray-default)" },
};

/** Small semantic pill — the single source for the app's status/annotation tags
 *  (SPV, PROJ, RESERVE-LIGHT, EXITED, MANAGING, activity lanes,
 *  etc.), built as Ink's real Tag component at `size="mini"`: 20px height,
 *  0 8px padding, 11px/500/line-height 20, border-radius 4px, no forced uppercase.
 *  `variant="text"` is NOT an Ink Tag — it's a bare chromeless inline
 *  annotation (MANAGING, EXITED) for when even a mini tag reads as too heavy.
 *  Props: children, tone (neutral|info|positive|negative|warning|strong),
 *  variant ("text" | undefined), title, style. */
export function Badge({ children, tone = "neutral", variant, title, style }) {
  const t = BADGE_TONE[tone] || BADGE_TONE.neutral;
  if (variant === "text")
    return (
      <span data-tip={title} style={{ ...sans, display: "inline-flex", alignItems: "center", fontSize: FS.micro,
        fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", whiteSpace: "nowrap", color: t.fg, ...style }}>
        {children}
      </span>
    );
  return (
    <span data-tip={title} style={{ ...sans, display: "inline-flex", alignItems: "center", height: 20, padding: "0 8px",
      fontSize: 11, fontWeight: 500, lineHeight: "20px", letterSpacing: 0, whiteSpace: "nowrap", boxSizing: "border-box",
      borderRadius: 4, color: t.fg, background: t.bg, border: `1px solid ${t.border}`, ...style }}>
      {children}
    </span>
  );
}

/** One-line label that never wraps: at rest the overflow is an ellipsis; while
 *  hovered the text glides left just far enough to read the end, then snaps back
 *  on mouse-out. `speed` is px/s. Only scrolls when the text actually overflows.
 *  `hoverParent` binds the hover to the enclosing row, so drifting off the 20px
 *  text line inside a taller row doesn't reset the scroll. */
export function MarqueeLabel({ children, speed = 40, title, hoverParent = false, style }) {
  const outer = useRef(null), inner = useRef(null);
  const [shift, setShift] = useState(0);
  const enter = () => { const o = outer.current, i = inner.current; if (o && i) setShift(Math.max(0, i.scrollWidth - o.clientWidth)); };
  const leave = () => setShift(0);
  useEffect(() => {
    if (!hoverParent) return;
    const p = outer.current?.parentElement;
    if (!p) return;
    p.addEventListener("mouseenter", enter); p.addEventListener("mouseleave", leave);
    return () => { p.removeEventListener("mouseenter", enter); p.removeEventListener("mouseleave", leave); };
  }, [hoverParent]);
  // The inner inline-block owns the ellipsis at rest and is what moves: a transform
  // runs on the compositor, so a busy main thread can't make the glide stutter.
  return (
    <span ref={outer} title={title} {...(hoverParent ? {} : { onMouseEnter: enter, onMouseLeave: leave })}
      style={{ display: "block", minWidth: 0, overflow: "hidden", whiteSpace: "nowrap", ...style }}>
      <span ref={inner} style={{ display: "inline-block", verticalAlign: "top", maxWidth: shift ? "none" : "100%",
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", transform: `translateX(-${shift}px)`,
        // A short delay so merely passing the pointer across a list doesn't set every row moving.
        transition: shift ? `transform ${shift / speed}s linear 0.4s` : "none" }}>
        {children}
      </span>
    </span>
  );
}

/** Ink's real Input/TextInput field: 36px height, 4px radius, 10px L/R padding,
 *  14px/20px Inter, border-default at rest, border-active on hover,
 *  border-focus-default + a 4px border-focus-light ring on focus — via the
 *  `.ink-input` class in theme.js. The shared primitive behind `SearchInput`
 *  below; use directly for any other plain text field that needs to match Ink
 *  exactly. Accepts layout props (flex, minWidth, etc.) and style overrides via
 *  `style`; forwards a ref to the underlying `<input>`. */
export const TextInput = forwardRef(({ style, className, ...props }, ref) => (
  <input
    ref={ref}
    className={className ? `ink-input ${className}` : "ink-input"}
    style={{ ...sans, ...TOOLBAR_CONTROL_STYLE, padding: "0 10px" /* Ink's real Input padding — narrower
      than TOOLBAR_CONTROL_STYLE's 12px (a Dropdown-trigger measurement); height/fontSize/lineHeight
      still come from the shared constant so this can't drift from the ribbon's other controls */,
      background: "var(--ink-color-global-surface-background-default)", color: "var(--ink-color-global-text-default)",
      boxSizing: "border-box", ...style }}
    {...props}
  />
));

/** Search field — `TextInput` with a leading magnifying-glass icon, matching
 *  Ink's own filter search field (same 36px input, icon inset at 10px,
 *  text padded to clear it) rather than a bare placeholder with no icon. Native
 *  `type="search"` still supplies the browser's own clear-x affordance; only
 *  its default magnifying-glass-less chrome and 12px padding were non-canonical
 *  before. Accepts layout props (flex, minWidth, etc.) via `style`. */
export function SearchInput({ placeholder, value, onChange, style, ...props }) {
  // `-webkit-appearance:none` (needed so our own border-radius renders instead of
  // the browser's native rounded search pill — see theme.js .ink-input) also drops
  // the native clear-x as an unfixable side effect, so this renders its own instead
  // of relying on browser chrome that can't coexist with a custom border-radius.
  const clear = () => onChange({ target: { value: "" } });
  return (
    <div style={{ position: "relative", display: "inline-flex", ...style }}>
      <SearchIcon size={14} strokeWidth={1.8}
        style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)",
          color: "var(--ink-color-global-text-subtle)", pointerEvents: "none" }} />
      <TextInput
        type="search"
        placeholder={placeholder}
        value={value}
        onChange={onChange}
        style={{ paddingLeft: 32, paddingRight: value ? 28 : undefined, width: "100%" }}
        {...props}
      />
      {value && (
        <button type="button" onClick={clear} aria-label="Clear search"
          style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)",
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            width: 16, height: 16, padding: 0, border: "none", borderRadius: 2,
            background: "transparent", color: "var(--ink-color-global-text-subtle)",
            cursor: "pointer", fontSize: 14, lineHeight: 1 }}>×</button>
      )}
    </div>
  );
}

/** The canonical `.ledger` table shell — one place for the `width:100%`/
 *  `borderCollapse:collapse` boilerplate every view repeats inline. `sheet`/
 *  `roomy` map to theme.js's density modifiers; extra `className`/`style`
 *  merge on top (e.g. a sticky-header wrapper keeps its own inline styles). */
export const Table = forwardRef(({ sheet, roomy, className, style, children, ...rest }, ref) => (
  <table ref={ref} className={["ledger", sheet && "sheet", sheet && roomy && "roomy", className].filter(Boolean).join(" ")}
    style={style} {...rest}>
    {children}
  </table>
));

/** A sortable `.ledger` header cell — the shared click target, `aria-sort`,
 *  and `SortCaretIcon` every table should use instead of a hand-rolled
 *  unicode arrow. `sort` is `{ id, dir: "asc"|"desc" } | null`; `onSort(id)`
 *  should cycle it (this app's convention: none→desc→asc→none). `after` is a
 *  sibling control (e.g. a filter button) rendered beside the sort button, so
 *  clicking it never reads as a sort. */
export function SortableTh({ children, sortId, sort, onSort, align = "left", title, style, className, after }) {
  const active = sort?.id === sortId;
  const ariaSort = active ? (sort.dir === "asc" ? "ascending" : "descending") : "none";
  // Label, then caret, then `after` — the same order whatever the alignment, so a
  // right-aligned numeric column reads like its left-aligned neighbours.
  return (
    <th aria-sort={ariaSort} title={title} className={className} style={{ textAlign: align, ...style }}>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 4, justifyContent: align === "right" ? "flex-end" : "flex-start" }}>
        <button type="button" className="ink-sort-btn" onClick={() => onSort(sortId)}>
          {children}
          <SortCaretIcon />
        </button>
        {after}
      </span>
    </th>
  );
}
