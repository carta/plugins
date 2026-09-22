// The Overview's flat, click-to-sort company table over every row.
import { useState, useMemo, useRef, useLayoutEffect, Fragment } from "react";
import { createPortal } from "react-dom";
import { FS, sans } from "../../ui/theme.js";
import { Badge, CalcMark, Table, SortableTh, ChevronRightIcon, CollapseAllIcon, ExpandAllIcon, DeltaText, FilterIcon, useStickyClone, Z } from "../../ui/components.jsx";
import { fmtVal, TrendSparkline, TREND_SPARK_W, indexedSwing, sharedScaleRef } from "../../ui/charts.jsx";
import { FavoriteStar } from "../../ui/favorites.jsx";
import { buildOverviewRow } from "../../model/overviewRow.js";
import { companyOf } from "../../model/kpi.js";
import { readColumns, DEFAULT_COLUMNS, columnLabel, metricColumnValue, positionColumnValue, columnSortValue, columnCategories, entityKindLabel } from "../../model/overviewColumns.js";
import { signalHitsByCompany } from "../../model/signals.js";
import { filterFor } from "../../model/overviewFilters.js";
import { openCompany } from "../../state/focus.js";
import { trackClick } from "../../analytics.js";
import CompanyDrawer from "./CompanyDrawer.jsx";
import ColumnFilterPopover from "./ColumnFilterPopover.jsx";

// Sticky chevron/Company group, pinned while the row scrolls horizontally.
// Base look comes from the shared `.ledger` recipe via `Table`; only position is local.
const STICKY_BG = "var(--ink-color-global-surface-background-default)";
const CHEVRON_W = 20;

// The header row is also pinned vertically, above the body's left-sticky
// cells (zIndex 2), so it stays visible while the body scrolls underneath.
const stickyTh = { position: "sticky", top: 0, background: STICKY_BG, zIndex: 3 };
// 14px icon matches the app's other button icons (e.g. `.ink-btn svg`); the
// button itself carries no size beyond centering its icon.
// No fixed box here: the chevron lives in a sticky, width-locked column
// (CHEVRON_W) whose offsets the company column is positioned against, so sizing
// the button would push that column and desync the sticky header clone.
const chevronBtn = { border: "none", background: "transparent", padding: 0, cursor: "pointer",
  display: "inline-flex", alignItems: "center", justifyContent: "center", color: "var(--ink-color-global-text-subtle)" };

// Hard widths, not minWidths: a min lets a long value push the delta and the
// sparkline right, so sparklines would start on a different x in every row.
const METRIC_GAP = 20, VALUE_W = 76, DELTA_W = 60;
const CELL_GUTTER = 16; // `table.ledger td`'s padding-right in theme.js
// The name column's floor is the spec's own minmax(200px, 1.6fr). Its ceiling is
// a share of the viewport, so it grows on a wide screen without dominating it.
const COMPANY_MIN_W = 200, COMPANY_MAX_SHARE = 1 / 3;
// Breathing room per data column before any slack is shared out.
const DATA_COL_GAP = 12;
// Left inset for a cell that can't take its gutter from the previous column's
// padding-right: the first data column (frozen keyline, see theme.js) and any
// left-aligned column, whose text would otherwise butt against the right-aligned
// number before it. Matches the spec's own padding-left on "Last responded".
const PAD_L = 16;
const needsLeftPad = (col, i) => i === 0 || colAlign(col) !== "right";
const metricValueSlot = { width: VALUE_W, flex: "none", textAlign: "right", fontVariantNumeric: "tabular-nums" };
const metricDeltaSlot = { width: DELTA_W, flex: "none", textAlign: "right" };
// amount | % change + caret | sparkline. The fixed tracks are what put every
// sparkline on one x. `delta` is per-column, so a column without one drops that
// track rather than reserving 60px it never fills — the column still aligns.
const metricGrid = (withDelta) => ({ display: "grid",
  gridTemplateColumns: withDelta ? `${VALUE_W}px ${DELTA_W}px auto` : `${VALUE_W}px auto`,
  columnGap: METRIC_GAP, alignItems: "center", verticalAlign: "middle" });

/** Width available to the table, so the name column can be clamped against it
 *  instead of taking every spare pixel. `mounted` re-runs the effect once the
 *  element exists — the ref alone is stable, so a table that renders empty first
 *  would never get an observer attached. */
function useAvailWidth(ref, mounted) {
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setW(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, mounted]);
  return w;
}

/** Spreads `total` across columns by raising them all to one common width, so a
 *  narrow column catches up instead of every column growing by the same amount
 *  and keeping its head start. A column already wider than that level keeps its
 *  own width. Returns the bases unchanged when there is nothing spare. */
function levelledWidths(base, total) {
  const held = base.map(() => false);
  for (;;) {
    const heldSum = base.reduce((s, w, i) => s + (held[i] ? w : 0), 0);
    const free = held.filter((h) => !h).length;
    if (!free) break;
    const level = (total - heldSum) / free;
    const over = base.map((w, i) => !held[i] && w > level);
    if (!over.some(Boolean)) return base.map((w, i) => (held[i] ? w : Math.max(w, level)));
    over.forEach((o, i) => { if (o) held[i] = true; });
  }
  return base;
}

/** Exactly what a metric column's fixed slots occupy, or null for columns whose
 *  width should still be measured. The table is `width: 100%`, so auto layout
 *  hands surplus space to whichever column has the most content — that used to
 *  be this one, and the measure step then locked the stretched width in. */
function metricColWidth(col) {
  if (!col.spark && !col.delta) return null;
  return VALUE_W
    + (col.spark ? (col.delta ? METRIC_GAP + DELTA_W : 0) + METRIC_GAP + TREND_SPARK_W
      : col.delta ? METRIC_GAP + DELTA_W : 0)
    + CELL_GUTTER;
}

// Both use the shared `.frozen-col` recipe so hover repaints them to the edge.
// Chevron opts out of its divider (boxShadow:none) — nothing there to divide.
const stickyChevronTh = { ...stickyTh, left: 0, width: CHEVRON_W, zIndex: 4, boxShadow: "none" };
const stickyCompanyTh = { ...stickyTh, left: CHEVRON_W, zIndex: 4 };
const stickyChevronTd = { position: "sticky", left: 0, width: CHEVRON_W, zIndex: 2, textAlign: "center", boxShadow: "none" };
const stickyCompanyTd = { position: "sticky", left: CHEVRON_W, zIndex: 2 };

// One builtin column's cell, keyed by builtin id, reading the row's health
// object `h` (from buildOverviewRow).
const BUILTIN_CELL = {
  burn: (h) => h?.burn
    ? <>{fmtVal(h.burn.value, "Dollar", null, h.burn.cur)}{h.burn.derived && <CalcMark title="Burn = −trailing avg QoQ change in cash, per month" />}</>
    : "—",
  runway: (h) => h?.runway?.cashUp
    ? <span title="Cash was flat or rising over recent quarters — no net burn, so runway isn't applicable">Not burning</span>
    : h?.runway?.months != null
      ? <>{Math.round(h.runway.months)}mo{h.runway.derived && <CalcMark title="Runway = cash ÷ monthly burn" />}</>
      : "—",
  band: (h) => h?.band
    ? <Badge tone={{ strong: "positive", healthy: "info", caution: "warning", critical: "negative" }[h.band]}>{h.band[0].toUpperCase() + h.band.slice(1)}</Badge>
    : "—",
  invested: (h) => h?.invested ? fmtVal(h.invested.value, "Dollar", null, h.invested.cur) : "—",
  value: (h) => h?.value ? fmtVal(h.value.value, "Dollar", null, h.value.cur) : "—",
  moic: (h) => (h?.moic != null ? h.moic.toFixed(2) + "×" : "—"),
  lastResponded: (h) => h?.lastResponded || "—",
  entityKind: (h, company) => entityKindLabel(company?.entityKind) || "—",
};

// Tabular builtin columns read right-aligned so their figures line up. The date
// joins them: left-aligned, its value hugs the number in the column before it
// while its own column runs on empty, breaking the rhythm the others share.
const RIGHT_ALIGN_BUILTIN = new Set(["invested", "value", "moic", "lastResponded"]);

/** Header/cell text-align for a column — right for numeric builtins, left otherwise. */
function colAlign(col) {
  return col.kind === "builtin" && RIGHT_ALIGN_BUILTIN.has(col.key) ? "right" : "left";
}

const chip = { display: "inline-flex", alignItems: "center", height: 20, padding: "0 8px", fontSize: 11, borderRadius: 4,
  border: "1px solid var(--ink-color-global-border-subtle)", background: "var(--ink-color-global-surface-lightgray-default)", whiteSpace: "nowrap" };
const chipRow = { display: "inline-flex", gap: 4, flexWrap: "wrap" };

/** One column's cell, by kind. `ctx` is { dashDoc, hitsByCompany, scaleByCol }. */
function renderCell(col, data, company, h, dashboard, ctx) {
  if (col.kind === "builtin") return (BUILTIN_CELL[col.key] || (() => "—"))(h, company);
  if (!company) return "—";
  if (col.kind === "position") return positionColumnValue(data, company, col).text;
  if (col.kind === "fund") {
    const funds = [...columnCategories(col, data, company, h, ctx)];
    return funds.length ? <span style={chipRow}>{funds.map((f) => <span key={f} style={chip}>{f}</span>)}</span> : "—";
  }
  if (col.kind === "tag") { const vals = [...columnCategories(col, data, company, h, ctx)]; return vals.length ? vals.join(", ") : "—"; }
  if (col.kind === "favorite") {
    // The same star the Company page uses, so a click here flips doc.favorites too.
    return dashboard?.update ? <FavoriteStar company={company} doc={dashboard.doc} onUpdate={dashboard.update} compact /> : "—";
  }
  if (col.kind === "signal") {
    const hits = (ctx.hitsByCompany || {})[company.id] || [];
    return hits.length
      ? <span style={chipRow}>{hits.map((s) => <Badge key={s.ruleId} tone={s.tone} title={s.detail}>{s.tag}</Badge>)}</span>
      : "—";
  }
  const v = metricColumnValue(data, company, col); // metric (reported or custom)
  return (
    // verticalAlign middle: an inline-flex baseline-aligns by default, which can
    // grow the line box and shift the panel off the row it is meant to fill.
    col.spark ? (
      <span style={metricGrid(!!col.delta)}>
        <span style={metricValueSlot}>{v.text}</span>
        {col.delta ? <span style={{ textAlign: "right" }}><DeltaText delta={v.delta} /></span> : null}
        {/* justifySelf start, so a short series still begins at the track edge. */}
        <span style={{ justifySelf: "start", display: "inline-flex", alignItems: "center" }}>
          {v.series ? <TrendSparkline points={v.series} dir={v.delta?.dir}
            scaleRef={ctx?.scaleByCol?.[col.id]} /> : null}
        </span>
      </span>
    ) : (
    <span style={{ display: "inline-flex", gap: METRIC_GAP, alignItems: "center", verticalAlign: "middle" }}>
      <span style={metricValueSlot}>{v.text}</span>
      {col.delta ? <span style={metricDeltaSlot}><DeltaText delta={v.delta} /></span> : null}
    </span>
    )
  );
}

/** Comparator for the active sort column's resolved values (columnSortValue).
 *  Nulls sort last regardless of direction; numbers compare numerically,
 *  everything else via localeCompare. */
function cmp(a, b, dir) {
  const aNull = a == null, bNull = b == null;
  if (aNull && bNull) return 0;
  if (aNull) return 1;
  if (bNull) return -1;
  const base = typeof a === "number" && typeof b === "number" ? a - b : String(a).localeCompare(String(b));
  return dir === "asc" ? base : -base;
}

// Sentinel sort id for the pinned Company column, which isn't in `columns`.
const NAME_SORT = "__company";

/** Width-lock identity: ids plus spark/delta flags, since either widens a metric cell.
 *  A string, not `columns` — readColumns returns a new array each render. */
export const columnsWidthKey = (columns) =>
  columns.map((c) => `${c.id}:${c.spark ? 1 : 0}:${c.delta || ""}`).join("|");

/** The header funnel: reports its own rect on click so the popover can anchor
 *  under it wherever the header is (real thead or the floating sticky clone). */
function FilterHeaderButton({ col, label, active, open, onOpen }) {
  return (
    <button type="button" className={`col-filter-btn${active ? " is-active" : ""}${open ? " is-open" : ""}`}
      aria-label={`Filter ${label}`} aria-pressed={active} title={active ? `Filtered — ${label}` : `Filter ${label}`}
      onClick={(e) => { e.stopPropagation(); onOpen(col, e.currentTarget.getBoundingClientRect()); }}>
      <FilterIcon size={12} />
    </button>
  );
}

/** Flat, click-to-sort table over every company. `rows` is `[{id,name}]`;
 *  `data` resolves each row's cells via buildOverviewRow/companyOf; `dashboard`
 *  resolves the configured column stack (readColumns), defaulting to
 *  DEFAULT_COLUMNS when absent. Default order is Company A→Z; clicking a
 *  column header cycles none→desc→asc→none. `filterApi` (optional)
 *  `{ filters, setFilter(kind,key,cond), companiesExcept(kind,key) }` puts a
 *  filter funnel on every data column header; without it the table is read-only.
 *  `expandedRows` + `onExpandedRowsChange` (optional) make the open-row set controlled. */
export default function RankedTable({ rows = [], data, dashboard, filterApi, expandedRows: controlledRows, onExpandedRowsChange }) {
  const [sort, setSort] = useState(null); // { id, dir: "desc"|"asc" } | null
  // Controlled when the host passes onExpandedRowsChange (Overview lifts the set so
  // its Expand all button can drive it); otherwise the table keeps its own set.
  const [ownRows, setOwnRows] = useState(() => new Set());
  const expandedRows = onExpandedRowsChange ? (controlledRows || new Set()) : ownRows;
  const setExpandedRows = onExpandedRowsChange || setOwnRows;
  const toggleRow = (id) => {
    const next = new Set(expandedRows);
    if (next.has(id)) next.delete(id); else next.add(id);
    setExpandedRows(next);
  };
  // Reads the rows actually on screen, so a filter that hides the only open row
  // flips the header twiddle back to "expand".
  const anyOpen = rows.some((r) => expandedRows.has(r.id));
  const toggleAll = () => {
    trackClick(anyOpen ? "PortfolioAnalytics.Overview.CollapseAll" : "PortfolioAnalytics.Overview.ExpandAll");
    setExpandedRows(anyOpen ? new Set() : new Set(rows.map((r) => r.id)));
  };
  const twiddle = (
    <button onClick={toggleAll} disabled={!rows.length}
      aria-label={anyOpen ? "Collapse all" : "Expand all"}
      title={anyOpen ? "Collapse every company's detail" : "Expand every company's detail"}
      style={{ border: "none", background: "transparent", padding: 0, cursor: rows.length ? "pointer" : "default",
        display: "inline-flex", flex: "none", color: "var(--ink-color-global-text-subtle)", lineHeight: 0 }}>
      {anyOpen ? <CollapseAllIcon size={16} strokeWidth={1.5} /> : <ExpandAllIcon size={16} strokeWidth={1.5} />}
    </button>
  );

  const columns = dashboard ? readColumns(dashboard.doc, data) : DEFAULT_COLUMNS;
  const rules = dashboard?.doc?.rules;
  const hitsByCompany = useMemo(() => (data ? signalHitsByCompany(data, rules || []) : {}), [data, rules]);
  // One sparkline domain per spark column, measured across the rows on screen.
  // Per-row scaling made every series fill its own box, so magnitude was invisible.
  const scaleByCol = useMemo(() => {
    if (!data) return {};
    const out = {};
    for (const col of columns) {
      if (col.kind !== "metric" || !col.spark) continue;
      // `rows`, not the sorted `ordered`: same set, and `ordered` depends on
      // ctx, which would make this circular. A max does not care about order.
      const swings = rows.map((r) => {
        const co = companyOf(data, r.id);
        return co ? indexedSwing(metricColumnValue(data, co, col).series) : null;
      });
      out[col.id] = sharedScaleRef(swings);
    }
    return out;
  }, [data, columns, rows]);
  const ctx = useMemo(() => ({ dashDoc: dashboard?.doc, hitsByCompany, scaleByCol }), [dashboard?.doc, hitsByCompany, scaleByCol]);
  const [filterOpen, setFilterOpen] = useState(null); // { col, rect } | null — the open funnel popover
  const openFilter = (col, rect) => setFilterOpen({ col, rect });
  const funnelFor = (col) => filterApi && (
    <FilterHeaderButton col={col} label={columnLabel(col, data)} open={filterOpen?.col.id === col.id}
      active={!!filterFor(filterApi.filters, col.kind, col.key)} onOpen={openFilter} />
  );

  const cycleSort = (id) => setSort((cur) => {
    if (!cur || cur.id !== id) return { id, dir: "desc" };
    if (cur.dir === "desc") return { id, dir: "asc" };
    return null;
  });

  const ordered = useMemo(() => {
    const base = [...rows].sort((a, b) => a.name.localeCompare(b.name));
    if (!sort) return base;
    if (sort.id === NAME_SORT) return base.sort((a, b) => cmp(a.name, b.name, sort.dir));
    const col = columns.find((c) => c.id === sort.id);
    if (!col) return base;
    const val = (r) => {
      if (!data) return null;
      return columnSortValue(col, data, companyOf(data, r.id), buildOverviewRow(data, r.id), ctx);
    };
    return base.sort((a, b) => cmp(val(a), val(b), sort.dir));
  }, [rows, columns, sort, data, ctx]);

  const wrapRef = useRef(null);
  const tableRef = useRef(null);
  const clone = useStickyClone(wrapRef, tableRef);
  const avail = useAvailWidth(wrapRef, rows.length > 0);

  // Locks column widths so an expanded drawer's colspan can't reflow them; the lock
  // drops and re-measures when cell shapes can change (stack, spark/delta, new data).
  const columnsKey = columnsWidthKey(columns);
  const [colWidths, setColWidths] = useState(null);
  useLayoutEffect(() => { setColWidths(null); }, [columnsKey, data]);
  useLayoutEffect(() => {
    if (colWidths) return;
    let cancelled = false;
    // Measuring before the web font loads locks in fallback-font (narrower)
    // widths permanently — wait for the real font metrics first.
    const measure = () => {
      if (cancelled) return;
      const ths = tableRef.current?.querySelector("thead")?.querySelectorAll("th");
      if (!ths?.length) return;
      setColWidths([...ths].map((th) => th.getBoundingClientRect().width));
    };
    if (document.fonts?.ready) document.fonts.ready.then(measure);
    else measure();
    return () => { cancelled = true; };
  });

  if (rows.length === 0) {
    return <div style={{ ...sans, fontSize: FS.small, color: "var(--ink-color-global-text-subtle)", padding: "6px 10px" }}>No companies</div>;
  }

  // Name column takes its share of the width; the data columns then level up to
  // fill the rest, so they span the table as one evenly spaced group.
  const chevW = colWidths ? colWidths[0] : 0;
  const dataBase = !colWidths ? [] : columns.map((col, i) =>
    (metricColWidth(col) ?? colWidths[i + 2]) + DATA_COL_GAP + (needsLeftPad(col, i) ? PAD_L : 0));
  const dataBaseTotal = dataBase.reduce((a, b) => a + b, 0);
  const minTableW = chevW + COMPANY_MIN_W + dataBaseTotal;
  const companyWidth = Math.max(COMPANY_MIN_W, Math.min(avail * COMPANY_MAX_SHARE, avail - chevW - dataBaseTotal));
  const dataWidths = levelledWidths(dataBase, Math.max(dataBaseTotal, avail - chevW - companyWidth));

  // Unbounded height — the page scrolls; overflowX steals plain sticky, so
  // useStickyClone above floats a synced header clone instead (see its doc).
  return (
    <div ref={wrapRef} style={{ overflowX: "auto" }}>
      <Table ref={tableRef} style={colWidths ? { tableLayout: "fixed", minWidth: minTableW } : undefined}>
        {colWidths && (
          <colgroup>
            <col style={{ width: chevW }} />
            <col style={{ width: companyWidth }} />
            {columns.map((col, i) => <col key={col.id} style={{ width: dataWidths[i] }} />)}
          </colgroup>
        )}
        <thead>
          <tr>
            <th className="frozen-col" style={stickyChevronTh}>{twiddle}</th>
            <SortableTh sortId={NAME_SORT} sort={sort} onSort={cycleSort} className="frozen-col" style={stickyCompanyTh}>Company</SortableTh>
            {columns.map((col) => (
              <SortableTh key={col.id} sortId={col.id} sort={sort} onSort={cycleSort}
                title={columnLabel(col, data)} align={colAlign(col)} after={funnelFor(col)}
                style={colAlign(col) === "right" ? stickyTh : { ...stickyTh, paddingLeft: PAD_L }}>
                {columnLabel(col, data)}
              </SortableTh>
            ))}
          </tr>
        </thead>
        <tbody>
          {ordered.map((r) => {
            const isOpen = expandedRows.has(r.id);
            const company = data ? companyOf(data, r.id) : null;
            const h = data ? buildOverviewRow(data, r.id) : null;
            return (
              <Fragment key={r.id}>
                <tr onClick={() => toggleRow(r.id)} className={isOpen ? "row-open" : undefined} style={{ cursor: "pointer" }}>
                  <td className="frozen-col" style={stickyChevronTd}>
                    <button data-testid={`expand-${r.id}`}
                      onClick={(e) => { e.stopPropagation(); toggleRow(r.id); }} style={chevronBtn}
                      aria-label={isOpen ? "Collapse company detail" : "Expand company detail"}>
                      {/* One glyph that rotates, so opening a row animates instead of
                          swapping two different icons. */}
                      <ChevronRightIcon size={14} strokeWidth={2.2}
                        style={{ transform: isOpen ? "rotate(90deg)" : "none", transition: "transform .12s ease" }} />
                    </button>
                  </td>
                  <td className="frozen-col" style={stickyCompanyTd}>
                    <span style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0, paddingRight: 16 }}>
                      {/* stopPropagation so toggling the star never also expands the row */}
                      <span onClick={(e) => e.stopPropagation()} style={{ lineHeight: 0, flex: "none" }}>
                        <FavoriteStar company={company} doc={dashboard?.doc} onUpdate={dashboard?.update} compact />
                      </span>
                      <button onClick={(e) => { e.stopPropagation(); openCompany(r.id); }} title={r.name}
                        style={{ border: "none", background: "transparent", padding: 0, minWidth: 0,
                        cursor: "pointer", font: "inherit", color: "var(--ink-color-global-link-default)", textAlign: "left",
                        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {r.name}
                      </button>
                    </span>
                  </td>
                  {columns.map((col) => (
                    <td key={col.id} className={colAlign(col) === "right" && filterApi ? "num-gutter" : undefined}
                      style={colAlign(col) === "right" ? { textAlign: "right" } : { paddingLeft: PAD_L }}>
                      {renderCell(col, data, company, h, dashboard, ctx)}
                    </td>
                  ))}
                </tr>
                {isOpen && (
                  <tr className="no-row-hover drawer-open">
                    <td colSpan={2 + columns.length}>
                      <CompanyDrawer data={data} id={r.id} />
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </Table>
      {clone && createPortal(
        // Clip box scrolls in step with the table (useStickyClone drives its scrollLeft).
        // Portaled outside App.jsx's root div, so it must set its own font.
        <div ref={clone.scrollRef} style={{ ...sans, position: "fixed", top: clone.top, left: clone.left, width: clone.width, overflow: "hidden", zIndex: Z.popover }}>
          <table className="ledger sticky-clone" style={{ position: "static" }}>
            <colgroup>{clone.cols.map((w, i) => <col key={i} style={{ width: w }} />)}</colgroup>
            <thead>
              <tr>
                {/* Same sticky-left styles as the real header: the clip box is a
                    scroll container, so they pin against it just like in the table. */}
                <th className="frozen-col" style={stickyChevronTh}>{twiddle}</th>
                <SortableTh sortId={NAME_SORT} sort={sort} onSort={cycleSort} className="frozen-col" style={stickyCompanyTh}>Company</SortableTh>
                {columns.map((col) => (
                  <SortableTh key={col.id} sortId={col.id} sort={sort} onSort={cycleSort}
                    title={columnLabel(col, data)} align={colAlign(col)} after={funnelFor(col)}
                    style={colAlign(col) === "right" ? undefined : { paddingLeft: PAD_L }}>
                    {columnLabel(col, data)}
                  </SortableTh>
                ))}
              </tr>
            </thead>
          </table>
        </div>,
        document.body,
      )}
      {filterOpen && filterApi && (
        <ColumnFilterPopover spec={filterOpen.col} data={data} ctx={ctx}
          filter={filterFor(filterApi.filters, filterOpen.col.kind, filterOpen.col.key)}
          otherCompanies={filterApi.companiesExcept(filterOpen.col.kind, filterOpen.col.key)}
          anchorRect={filterOpen.rect}
          onApply={(cond) => filterApi.setFilter(filterOpen.col.kind, filterOpen.col.key, cond)}
          onClose={() => setFilterOpen(null)} />
      )}
    </div>
  );
}
