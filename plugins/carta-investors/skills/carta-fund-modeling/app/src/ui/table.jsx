import { useState, useMemo, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { sans } from "./theme.js";

/* ── Sortable ledger table — the single source of truth for every `table.ledger`
 *   header across the app. Replaces three hand-rolled patterns (Companies'
 *   `SortableTh`+`SORTS` map, the duplicated inline `.ink-sort-btn` blocks in
 *   Overview/LpReturns, and the plain `{HEADERS.map(...)}` headers everywhere
 *   else). A view declares its columns once, calls `useTableSort`, and renders
 *   `<TableHead>` + a bespoke `<tbody>` (cells stay per-view — they carry
 *   reprice controls, bars, links, totals rows).
 *
 *   Styling lives in theme.js: `table.ledger`, the `.sheet` dense variant, and
 *   the Ink sortable-header recipe (`.ink-sort-btn`, `.ink-sort-icon`, `aria-sort`).
 *
 *   Column shape: { label, align?: "left"|"right", get?: (row)=>sortValue, defaultDir?: "asc"|"desc" }
 *   A column is sortable iff it has a `get` accessor; columns without one render
 *   as a plain (but identically-styled) label. Alignment lives here — no more
 *   inline `i === 0 ? "left" : "right"` heuristics. */

/** Wraps a `table.ledger` so it scrolls in place instead of pushing the whole
 *  page into horizontal scroll — the single owner of the `.table-scroll`
 *  convention (theme.js) so every call site shares one implementation rather
 *  than hand-copying the wrapper div (and its overflow-pairing footgun
 *  explanation) per view. `style`/`className` pass through for callers that
 *  need extra layout (e.g. `marginBottom`). */
export function TableScroll({ children, style, className }) {
  return <div className={className ? `table-scroll ${className}` : "table-scroll"} style={style}>{children}</div>;
}

const colAlign = (c) => c.align ?? "right";
const naturalDir = (c) => c.defaultDir ?? (colAlign(c) === "left" ? "asc" : "desc");

/** Dual-triangle sort glyph. Was copy-pasted byte-for-byte in Overview, LpReturns,
 *  and Companies — now defined once. The active direction darkens via the th's
 *  `aria-sort` (see `.ink-sort-icon` rules in theme.js). */
export const SortIcon = () => (
  <svg className="ink-sort-icon" width="10" height="14" viewBox="0 0 10 14" aria-hidden="true" focusable="false">
    <path className="ink-sort-icon__asc" d="M5 1L9 6H1Z" />
    <path className="ink-sort-icon__desc" d="M5 13L1 8H9Z" />
  </svg>
);

/** Sort state + sorted rows for a ledger table.
 *  `sort` is `{ i, dir }` or null (null = the caller's natural order, untouched).
 *  Clicking a header cycles: natural → default dir → reversed → back to natural.
 *  Strings compare via localeCompare; everything else numerically. Nullish values
 *  sort to the bottom regardless of direction. */
export function useTableSort(rows, cols, initial = null) {
  const [sort, setSort] = useState(initial);
  const sorted = useMemo(() => {
    if (!sort || !cols[sort.i]?.get) return rows;
    const { get } = cols[sort.i];
    const dir = sort.dir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const av = get(a), bv = get(b);
      if (av == null && bv == null) return 0;
      if (av == null) return 1;   // missing sinks to the bottom
      if (bv == null) return -1;
      const cmp = typeof av === "string" ? av.localeCompare(bv) : av - bv;
      return cmp * dir;
    });
  }, [rows, cols, sort]);
  const onSort = (i) => {
    if (!cols[i]?.get) return; // not a sortable column
    const def = naturalDir(cols[i]);
    setSort((s) => {
      if (!s || s.i !== i) return { i, dir: def };
      if (s.dir === def) return { i, dir: def === "asc" ? "desc" : "asc" };
      return null; // third click clears back to natural order
    });
  };
  return { sorted, sort, onSort };
}

const sameWidths = (a, b) => !!a && !!b && a.length === b.length && a.every((w, i) => Math.abs(w - b[i]) < 0.5);

/** Opt-in sticky-header mechanism, shared by any `table.ledger` that wants one
 *  (pass `sticky` to `TableHead`, or call this directly for a bespoke header —
 *  see Companies.jsx's own `SortableTh`/`CompaniesHeaderRow`, which doesn't fit
 *  `useTableSort`'s model and so calls this hook directly instead of going
 *  through `TableHead`).
 *
 *  Ports Ink's own StickyTableHeader technique (a fixed-position clone of the
 *  header, not plain CSS position:sticky — see carta/ink NewTable/virtualizer/
 *  StickyTableHeader.ts): once the real <thead> would otherwise scroll out from
 *  under the app's own sticky top bar, a fixed clone floats in its place, sized/
 *  positioned from live measurements each scroll/resize. React gets the simpler
 *  half of Ink's version for free — no cloneNode() or the click-forwarding hack
 *  Ink needs, since the clone is real React markup sharing the same handlers.
 *
 *  `ref` may point at the `<table>` itself OR any element inside it (e.g. a
 *  `<thead>`) — `.closest("table")` resolves either to the same element. Pass
 *  `enabled: false` (or omit `sticky` on TableHead) to skip entirely — this
 *  hook does nothing and returns a permanently-non-floating state when disabled,
 *  so opting out costs nothing. */
export function useStickyHeader(ref, enabled = true) {
  const [sticky, setSticky] = useState({ floating: false, top: 0, left: 0, width: 0, colWidths: null, scrollLeft: 0 });
  useEffect(() => {
    if (!enabled) return undefined;
    const table = ref.current?.closest("table");
    if (!table) return undefined;

    // Walks up to the nearest overflow:auto/scroll ancestor and attaches there —
    // but a `<div style={{ overflowX: "auto" }}>` wrapper (the pattern this
    // app's other `.card` table wrappers still use, e.g. Overview.jsx/Reserves.jsx)
    // computes overflowY as "auto" too (setting only overflow-x forces the browser
    // to upgrade overflow-y from "visible" to "auto" — a real CSS spec rule, not a
    // bug here), so this walk will latch onto that div instead of the page's real
    // scroller. `.table-scroll` wrappers (theme.js) set overflow-y:hidden
    // explicitly to dodge exactly that promotion, so this walk correctly skips
    // past them to the page's real scroller.
    let scrollEl = table.parentElement;
    while (scrollEl && scrollEl !== document.body) {
      const cs = getComputedStyle(scrollEl);
      if (cs.overflowY === "auto" || cs.overflowY === "scroll") break;
      scrollEl = scrollEl.parentElement;
    }
    const target = scrollEl && scrollEl !== document.body ? scrollEl : window;

    // Separately, find the nearest horizontal-scroll ancestor (a `.table-scroll`
    // wrapper, if the table has one) — this is the "viewport slot" the floating
    // clone must clip to and shift within, so a table that scrolls in place
    // (see theme.js's `.table-scroll`) keeps its floating header's columns
    // aligned with the body underneath instead of freezing at the pre-scroll
    // position. `hEl` is null for tables with no horizontal wrapper, in which
    // case the clone behaves exactly as before (full table width, no offset).
    let hEl = table.parentElement;
    while (hEl && hEl !== document.body) {
      const cs = getComputedStyle(hEl);
      if (cs.overflowX === "auto" || cs.overflowX === "scroll") break;
      hEl = hEl.parentElement;
    }
    if (!hEl || hEl === document.body) hEl = null;

    const measure = () => {
      const thead = table.querySelector("thead");
      if (!thead) return;
      const topbarH = document.querySelector('[data-testid="app-topbar"]')?.getBoundingClientRect().height || 0;
      const tableRect = table.getBoundingClientRect();
      const headH = thead.getBoundingClientRect().height;
      const floating = tableRect.top < topbarH && tableRect.bottom > topbarH + headH;
      if (!floating) {
        setSticky((s) => (s.floating ? { ...s, floating: false } : s));
        return;
      }
      // The clip window the clone renders into: the horizontal-scroll wrapper's
      // own (unscrolled) box if there is one, else the table's own rect — same
      // as the pre-scroll-wrapper behavior.
      const slotRect = hEl ? hEl.getBoundingClientRect() : tableRect;
      const scrollLeft = hEl ? hEl.scrollLeft : 0;
      const colWidths = [...thead.querySelectorAll("th")].map((th) => th.getBoundingClientRect().width);
      setSticky((s) => (s.floating && s.top === topbarH && s.left === slotRect.left && s.width === slotRect.width && s.scrollLeft === scrollLeft && sameWidths(s.colWidths, colWidths)
        ? s // nothing actually moved — skip the re-render
        : { floating: true, top: topbarH, left: slotRect.left, width: slotRect.width, colWidths, scrollLeft }));
    };

    // rAF-batched, matching Ink's own StickyTableHeader.ts scroll handler — a raw
    // scroll listener can fire many times per frame; this collapses each burst to
    // at most one measure+setState per animation frame.
    let frame = null;
    const update = () => {
      if (frame != null) return;
      frame = requestAnimationFrame(() => { frame = null; measure(); });
    };

    update();
    target.addEventListener("scroll", update, { passive: true });
    // `target`'s own scroll listener only fires for vertical page scroll — a
    // `.table-scroll` wrapper's horizontal scroll is a separate element and
    // separate event, so it needs its own listener to keep the clone in sync.
    hEl?.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    // Observe the table AND each header cell — the table is typically pinned to
    // width:100% (theme.js), so its own border-box never resizes when a column's
    // rendered width shifts purely from content; only the individual <th> boxes
    // do. Without this, `colWidths` could go stale until the next scroll/resize.
    const ro = new ResizeObserver(update);
    ro.observe(table);
    table.querySelectorAll("thead th").forEach((th) => ro.observe(th));
    return () => {
      if (frame != null) cancelAnimationFrame(frame);
      target.removeEventListener("scroll", update);
      hEl?.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      ro.disconnect();
    };
  }, [ref, enabled]);
  return sticky;
}

/** The `<thead>` for a ledger table. Sortable columns render an Ink sort button;
 *  the rest render a plain label. Pair with `useTableSort` and a bespoke `<tbody>`.
 *
 *  A column may carry an optional `help` string; when present it becomes the
 *  header cell's native `title` tooltip (hover to see a column's formula/meaning).
 *
 *  Pass `sticky` to pin the header under the app's top bar once the table scrolls
 *  past it — opt-in, off by default, and a no-op for every existing caller that
 *  doesn't pass it. See `useStickyHeader` above for the mechanism. */
export function TableHead({ cols, sort, onSort, sticky }) {
  const theadRef = useRef(null);
  const stickyState = useStickyHeader(theadRef, !!sticky);

  const renderRow = (hidden, colWidths) => (
    <tr>
      {cols.map((c, i) => {
        const sortable = typeof c.get === "function";
        const active = sortable && sort?.i === i;
        const ariaSort = !sortable ? undefined : active ? (sort.dir === "asc" ? "ascending" : "descending") : "none";
        const width = colWidths ? { width: colWidths[i] } : undefined;
        return (
          <th key={c.label} aria-sort={ariaSort} title={c.help} style={{ textAlign: colAlign(c), ...width }}>
            {sortable ? (
              <button type="button" className="ink-sort-btn" onClick={() => onSort(i)} aria-label={`Sort by ${c.label}`}
                tabIndex={hidden ? -1 : 0} aria-hidden={hidden || undefined}>
                {/* right-aligned (numeric) columns lead with the icon, mirroring the
                    right-aligned data below — same as Companies.jsx's own SortableTh */}
                {colAlign(c) === "right" ? <><SortIcon />{c.label}</> : <>{c.label}<SortIcon /></>}
              </button>
            ) : c.label}
          </th>
        );
      })}
    </tr>
  );

  return (
    <>
      <thead ref={theadRef}>{renderRow(sticky && stickyState.floating, null)}</thead>
      {/* the app's font-family is set inline on the root app div, not via a global
          body/html rule — since this clone is portaled to document.body (outside
          that div), it needs its own `sans` or it falls back to the browser's
          default serif font once it floats.

          className mirrors the REAL table's own classes (e.g. the `.sheet` dense
          variant's tighter padding) rather than hardcoding "ledger" — otherwise a
          `.sheet` table's clone silently falls back to the regular 12px padding,
          shifting every header label a few pixels off the column it floats over. */}
      {/* outer div is the fixed, clipped "viewport slot" (matches the table's own
          .table-scroll wrapper, or the table itself when there's no such wrapper);
          the inner table is shifted left by the wrapper's live scrollLeft so its
          columns stay aligned with the real body scrolling underneath — see
          useStickyHeader's hEl/scrollLeft tracking above. */}
      {sticky && createPortal(
        <div className="sticky-clone-slot" style={{ top: stickyState.top, left: stickyState.left, width: stickyState.width, display: stickyState.floating ? "block" : "none" }}>
          <table className={`${theadRef.current?.closest("table")?.className || "ledger"} sticky-clone`}
            style={{ ...sans, width: stickyState.colWidths?.reduce((a, w) => a + w, 0), transform: `translateX(${-(stickyState.scrollLeft || 0)}px)` }}>
            <thead>{renderRow(false, stickyState.colWidths)}</thead>
          </table>
        </div>,
        document.body
      )}
    </>
  );
}
