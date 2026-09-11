import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { sans, INK, PAPER, LINE, FAINT, MICRO, FS } from "./theme.js";

/** Shared shell for the two Budget-vs-Actuals crosstabs (BudgetActualsView's
 *  crosstab grid, BudgetActualsOutline's by-line-item outline) — both
 *  render a sticky-first-column, horizontally-scrollable table with a
 *  two-row grouped header (a super-header per group — department or quarter —
 *  over a repeated Actual/Budget/Var sub-header). Cell rendering (currency
 *  formatting, variance coloring, drilldown handlers, row-kind styling) stays
 *  per-view — only the scroll/sticky/header-shell structure is shared here,
 *  matching carta-fund-modeling's own ui/table.jsx convention. Unlike that
 *  file, this one has no `useTableSort`/sortable-header support — neither
 *  budget table has user-driven column sorting today, so none was added. */

/** Ink's own `.ink-table tr.is-total` fill (Ink's components.md) —
 *  `--ink-color-global-brand-blue-10`, #EAF0F8. carta-fund-modeling's own
 *  `.totrow` independently landed on the same blue (its
 *  `--ink-color-global-feedback-info-subtle`) rather than a gray wash — two
 *  independent reads of the same Ink recipe agreeing on blue. */
export const TOTAL_ROW_BG = "#EAF0F8";

/** Base `<table>` style both budget tables share — 14px per Ink's
 *  `.ink-table` recipe (Ink's real NewTable), not a smaller size either view
 *  drifted to on its own. */
export const LEDGER_BASE = {
  ...sans,
  borderCollapse: "separate",
  borderSpacing: 0,
  minWidth: "100%",
  fontSize: FS.value,
  fontVariantNumeric: "tabular-nums",
};

/** Horizontal-scroll wrapper — the single owner of the overflow-pairing
 *  footgun explanation (see useStickyHeader below) so each table doesn't
 *  re-derive it. `overflowY: hidden` (not the default "visible") stops the
 *  browser's overflow-pairing rule from auto-promoting this div to
 *  `overflow-y: auto` once overflow-x is constrained — which would make
 *  useStickyHeader's ancestor walk latch onto this div instead of the page's
 *  real scroller, and the sticky header would never float. */
export function TableScroll({ children, style, scrollRef }) {
  return (
    <div ref={scrollRef} style={{ overflowX: "auto", overflowY: "hidden", background: PAPER, ...style }}>
      {children}
    </div>
  );
}

const sameWidths = (a, b) => !!a && !!b && a.length === b.length && a.every((w, i) => Math.abs(w - b[i]) < 0.5);

/** Sticky-header mechanism ported from carta-fund-modeling's ui/table.jsx —
 *  Ink's real StickyTableHeader technique: a fixed-position CLONE of the
 *  header (real React markup, not a cloneNode()), sized/positioned from live
 *  measurements, rather than plain CSS `position: sticky` on the <thead>
 *  itself. Plain sticky only sticks within this table's own scroll
 *  container, which here is the whole page — a plain sticky <thead> would
 *  stop tracking once the table itself scrolled out from under it; the
 *  clone floats independently at the very top of the viewport instead.
 *
 *  `node` may be the `<table>` itself or any element inside it (e.g. the
 *  `<thead>`) — `.closest("table")` resolves either to the same element.
 *  Takes the live DOM node directly (state-held via a callback ref at the
 *  call site), not a ref object: a plain `useRef` never changes identity,
 *  so an effect keyed on it only ever runs once — dead on arrival for any
 *  `<thead>` that mounts conditionally (e.g. a table that only renders for
 *  one of several tab/view states). Keying on the node itself makes the
 *  effect re-run exactly when the element actually mounts or unmounts.
 *  `enabled: false` makes this a permanent no-op, so a table that doesn't
 *  want a floating header costs nothing by not calling this at all. */
export function useStickyHeader(node, enabled = true) {
  const [sticky, setSticky] = useState({ floating: false, top: 0, left: 0, width: 0, colWidths: null, subWidths: null, scrollLeft: 0 });
  useEffect(() => {
    if (!enabled) return undefined;
    const table = node?.closest("table");
    if (!table) return undefined;

    // Walk up to the nearest overflow:auto/scroll ancestor — this table's
    // own vertical scroller is the page itself (TableScroll only sets
    // overflow-x), so this typically resolves to `window`.
    let scrollEl = table.parentElement;
    while (scrollEl && scrollEl !== document.body) {
      const cs = getComputedStyle(scrollEl);
      if (cs.overflowY === "auto" || cs.overflowY === "scroll") break;
      scrollEl = scrollEl.parentElement;
    }
    const target = scrollEl && scrollEl !== document.body ? scrollEl : window;

    // Separately, the nearest horizontal-scroll ancestor (TableScroll's own
    // overflow-x: auto div) — the clip window the clone renders into, and
    // what it shifts within so its columns stay aligned with the real body
    // scrolling underneath.
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
      // No topbar to dodge — the clone floats flush at the very top of the
      // viewport (top: 0) once the table's real header scrolls above it.
      const tableRect = table.getBoundingClientRect();
      const headH = thead.getBoundingClientRect().height;
      const floating = tableRect.top < 0 && tableRect.bottom > headH;
      if (!floating) {
        setSticky((s) => (s.floating ? { ...s, floating: false } : s));
        return;
      }
      const slotRect = hEl ? hEl.getBoundingClientRect() : tableRect;
      const scrollLeft = hEl ? hEl.scrollLeft : 0;
      // Measured per header ROW, not as one flat list. This head has two:
      // the label and the group spans on top, the sub-columns beneath. A
      // flat list conflated them — the clone pinned its group spans and
      // left "Actual"/"Budget"/"Var $" to lay themselves out on their own
      // text, so they drifted off the figures they head. It also summed
      // both rows for the clone's width, counting the data columns twice.
      // Indexed, not destructured: `rows` is an HTMLCollection, which is
      // not iterable, and the throw lands in a rAF callback where it takes
      // the whole sticky header down without a word.
      const topRow = thead.rows[0];
      const subRow = thead.rows[1];
      const widthsOf = (row) =>
        Array.from(row?.cells || [], (c) => c.getBoundingClientRect().width);
      const colWidths = widthsOf(topRow);
      // subRow's first cell is the label column, not a sub-column — drop it.
      const subWidths = widthsOf(subRow).slice(1);
      setSticky((s) => (s.floating && s.top === 0 && s.left === slotRect.left && s.width === slotRect.width && s.scrollLeft === scrollLeft && sameWidths(s.colWidths, colWidths) && sameWidths(s.subWidths, subWidths)
        ? s
        : { floating: true, top: 0, left: slotRect.left, width: slotRect.width, colWidths, subWidths, scrollLeft }));
    };

    // rAF-batched — a raw scroll listener can fire many times per frame.
    let frame = null;
    const update = () => {
      if (frame != null) return;
      frame = requestAnimationFrame(() => { frame = null; measure(); });
    };

    update();
    target.addEventListener("scroll", update, { passive: true });
    hEl?.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
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
  }, [node, enabled]);
  return sticky;
}

/** Portal target for a floating sticky-header clone — pair with
 *  useStickyHeader's returned state: `{stickyState.floating && <StickyClone
 *  stickyState={stickyState}>{...}</StickyClone>}`. */
export function StickyClone({ stickyState, children }) {
  return createPortal(
    <div className="sticky-clone-slot" style={{ top: stickyState.top, left: stickyState.left, width: stickyState.width }}>
      <table style={{ ...LEDGER_BASE, borderCollapse: "separate", width: stickyState.colWidths?.reduce((a, w) => a + w, 0), transform: `translateX(${-(stickyState.scrollLeft || 0)}px)` }}>
        <thead>{children}</thead>
      </table>
    </div>,
    document.body
  );
}

/** One group's slice of the sub-column widths.
 *
 *  The header has two rows over the same columns: the label and the group
 *  spans on top, the sub-columns beneath. The floating clone has to pin
 *  both — pinning only the spans leaves "Actual"/"Budget"/"Var $" to lay
 *  themselves out on their own labels, which is narrower than the figures
 *  they head, so they drift left of the column as you scroll.
 */
export function subWidthsFor(subWidths, groupIndex, perGroup) {
  if (!subWidths || !perGroup) return undefined;
  const from = groupIndex * perGroup;
  const slice = subWidths.slice(from, from + perGroup);
  // A short measurement is worse than none: half-pinned cells put the rest
  // of the row somewhere new again.
  return slice.length === perGroup ? slice : undefined;
}

/** Two-row grouped header — a sticky, rowSpan=2 label column, then one
 *  `<th colSpan={subCols.length}>` per group, then a repeated sub-header row
 *  (Actual/Budget/Var $, each optionally captioned with a
 *  provenance mark). Both budget tables hand-rolled a near-identical version
 *  of this before; `groups`/`subCols` parametrize the difference (a firm's
 *  own column values vs. quarters).
 *
 *  `colWidths`/`subWidths`/`scrollLeft`, when given, pin each <th> in both
 *  rows to a live-measured width and counter-translate the sticky label
 *  column — see
 *  useStickyHeader's header doc for why. Pass them through when rendering
 *  inside a <StickyClone>; omit for the real (non-floating) header. */
export function GroupedTableHead({ labelText, labelMinWidth = 320, groups, subCols, colWidths, subWidths, scrollLeft = 0 }) {
  return (
    <>
      <tr>
        {/* labelText sits on row 2 now, level with Actual/Budget/Var. */}
        <th
          style={{
            ...styles.thTop, minWidth: labelMinWidth,
            position: "sticky", left: 0, zIndex: 2, borderRight: `1px solid ${LINE}`,
            ...(colWidths ? { width: colWidths[0] } : null),
            ...(scrollLeft ? { transform: `translateX(${scrollLeft}px)` } : null),
          }}
        />
        {groups.map((g, i) => (
          <th key={g.key} data-col-key={g.key} colSpan={subCols.length} style={{ ...styles.thGroup, ...(colWidths ? { width: colWidths[i + 1] } : null) }}>
            {g.label}
          </th>
        ))}
      </tr>
      <tr>
        <th
          style={{
            ...styles.thLabel, minWidth: labelMinWidth,
            ...(colWidths ? { width: colWidths[0] } : null),
            ...(scrollLeft ? { transform: `translateX(${scrollLeft}px)` } : null),
          }}
        >
          {labelText}
        </th>
        {groups.map((g, i) => (
          <SubHeaderCells
            key={g.key}
            subCols={subCols}
            // This group's slice of the sub-column widths. Without it the
            // clone re-flows these on their own labels and they stop
            // sitting over the figures they head.
            widths={subWidthsFor(subWidths, i, subCols.length)}
          />
        ))}
      </tr>
    </>
  );
}

function SubHeaderCells({ subCols, widths }) {
  return (
    <>
      {subCols.map((c, i) => (
        <th key={i} style={{ ...styles.thSub,
                             // Continues thGroup's own divider; not repeated per sub-column.
                             ...(i === 0 ? { borderLeft: `1px solid ${LINE}` } : null),
                             ...(c.align === "left" ? { textAlign: "left" } : null),
                             ...(widths?.[i] != null ? { width: widths[i] } : null) }}>
          {c.label}
          {c.mark && <span style={styles.srcMark} title={c.markTitle}>{c.mark}</span>}
        </th>
      ))}
    </>
  );
}

const styles = {
  thTop: { background: PAPER },
  // Ink Heading 3 (16px / 28px leading / weight 500) — ink-font-global-*-heading-3.
  thGroup: {
    ...sans, fontSize: FS.h3, lineHeight: "28px", fontWeight: 500, color: INK,
    padding: "0 8px",
    borderLeft: `1px solid ${LINE}`,
    background: PAPER, textAlign: "center", whiteSpace: "nowrap",
  },
  // Ink Body 2 (14px / 24px leading / weight 500) — ink-font-global-*-body-2.
  thSub: {
    ...sans, fontSize: FS.value, lineHeight: "24px", fontWeight: 500, color: FAINT,
    padding: "0 8px",
    borderBottom: `1px solid ${LINE}`,
    background: PAPER, textAlign: "right", whiteSpace: "nowrap",
  },
  thLabel: {
    ...sans, fontSize: FS.value, fontWeight: 500, color: INK,
    padding: "8px 12px", textAlign: "left",
    borderBottom: `1px solid ${LINE}`,
    position: "sticky", left: 0, background: PAPER, zIndex: 2,
    // Matches the frozen column's own borderRight below it (LEDGER_LABEL) —
    // without it the rule only starts once the header scrolls past.
    borderRight: `1px solid ${LINE}`,
  },
  // Source marker on the Actual / Budget sub-headers — sized/coloured to sit
  // under the column label as a caption rather than beside it as a second
  // label. Inlined rather than pulled from theme.js's microCaption: this is
  // the one spot that also needs MICRO for color, and importing both here
  // just to build one literal is more indirection than the two-line style
  // deserves.
  // 9px snapped to FS.micro (10) — a 1px-off near-duplicate of the shared
  // micro-caption scale, not a deliberate sub-micro size.
  srcMark: {
    fontSize: FS.micro, fontWeight: 400, letterSpacing: ".04em",
    textTransform: "uppercase", cursor: "help", color: MICRO,
    marginLeft: 5,
  },
};
