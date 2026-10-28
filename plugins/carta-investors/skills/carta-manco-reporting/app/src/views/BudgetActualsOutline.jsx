import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { sans, inkNum, INK, PAPER, LINE, BORDER_DEFAULT, FAINT, MICRO, SHADE, BLUE, FS } from "../ui/theme.js";
import { Bubble, CollapseCaret, NoteIcon } from "../ui/components.jsx";
import { TableScroll, LEDGER_BASE, TOTAL_ROW_BG, useStickyHeader, StickyClone, GroupedTableHead, drillCellProps } from "../ui/table.jsx";
import { childDisplayLabel, glNameMap, glTooltip, subCodeMap, subOfChildLabel } from "../ui/glNames.js";
import { dimensionValue, dimensionValuesAvailable, rowTagScope } from "../ui/dimension.js";
import { NEST_STEP } from "../ui/nesting.js";
import { LEDGER_LABEL, LEDGER_NUM, LEDGER_ROW, LEDGER_TOTAL, LEDGER_SUMMARY } from "../ui/ledger.js";
import { fmtCurrencyWhole } from "../charts/chartTheme.js";
import { varianceColor, rowPolarity, fmtVarianceWhole } from "../ui/variance.js";
import BudgetSourceLine from "./BudgetSourceLine.jsx";
import HoverTip from "../ui/HoverTip.jsx";
import { FiltersMenu, FilterRibbon, PeriodDropdown } from "./BudgetPeriodControls.jsx";
import {
  rowBreakouts, defaultBreakout, breakoutBuckets, worthBreakingOut, opensAnything, childKey, childScope,
} from "./accountBreakout.js";
import { fundMatchRegex } from "./drilldown/util.js";
import { trackClick } from "../analytics.js";
import {
  trueAsOfMonth, FREQUENCIES, MONTH_ABBR, monthsInRange, periodColumns,
} from "./budgetPeriods.js";
import { prefsKeyFor } from "./budgetPrefs.js";
import useViewToolbar from "./useViewToolbar.js";

// Budget vs Actuals — outline renderer.
//
// Mirrors the client's own budget tab line-for-line: their sections, their
// line items, their subtotals, in their order. Used for outline-shaped
// budgets (shapes/pnl_outline.py), which are a hierarchical P&L rather
// than a (dept × account) crosstab.
//
// Columns follow the workbook's own time axis: months when it states
// months (with a Period control to roll them up into quarters or the
// year), quarters otherwise — then a Total, each with Actual · Budget · Var $.
//
// Actuals resolution is per-row-type:
//   fund_match  → fund-side management-fee JEs (accounts.json's
//                 fund_fee_entries). The ManCo's own GL 4160 aggregates
//                 Fund II + Fund III and can't be split, so per-fund
//                 budget lines have to join against fund-side entries.
//   gl_codes + dept → ManCo JEs at those GLs, constrained to the dept's
//                 Carta REPORTING_TAGS Department values.
//   gl_codes only → ManCo JEs at those GLs, firm-wide (income + summary
//                 lines aren't dept-scoped in the workbook).
//   neither     → unmapped. Renders "—" with an explicit marker rather
//                 than a misleading $0.
//
// Two lines can both count the SAME entry — a department bucket and a
// vendor-carved-out line over the same account, say. The more specific
// line keeps it (claimSpecificity); the other renders "—" and names it,
// so a subtotal summing both never double-counts.
//
// Aggregate rows (subtotal / total / summary) take their BUDGET from the
// workbook's own cell — authoritative, and legitimately not always equal
// to the sum of its constituents (a firm's own department total often
// drifts from its own subtotals) — while their ACTUAL is summed from the
// constituent line rows the adapter recorded.

// Actuals are summed per calendar month once; every column then adds up
// the months it covers, so changing the Period never re-reads the ledger.
const MONTHS = monthsInRange({ first: 1, last: 12 });
const BUCKET_KEYS = [...MONTHS, "Total"];

/** The column groups one frequency draws, each followed by the year's Total.
 *
 *  `short` names the period without its year, for the drawer's title.
 */
export function outlineColumns(frequency, year) {
  const total = { key: "Total", label: `Total ${year || ""}`.trim(), short: null, months: MONTHS };
  // The year's single column is the Total already.
  if (frequency === "annually") return [total];
  const periods = periodColumns(frequency, { first: 1, last: 12 }, year || "").map(c => {
    const key = c.key.toUpperCase();
    return { key, label: c.label.trim(), months: c.months,
             short: c.months.length === 1 ? MONTH_ABBR[c.months[0] - 1] : key };
  });
  return [...periods, total];
}

/** Which periods a budget can be read in. Only a workbook that states each
 *  month can be broken out by month: one stating quarters spreads each
 *  evenly across its months, and showing that spread as months would
 *  present our arithmetic as the firm's plan. */
export function outlineFrequencies(budget) {
  return budget?.period_granularity === "monthly" ? FREQUENCIES : null;
}

/** The workbook's own resolution, unless the reader picked another it supports. */
export function outlineFrequency(budget, picked) {
  const offered = outlineFrequencies(budget);
  if (!offered) return "quarterly";
  return offered.some(f => f.key === picked) ? picked : "monthly";
}

export default function BudgetActualsOutline({ budget, accountsData, periodYear, drilldown,
                                              dimension = null, asOf }) {
  const rows = budget?.rows || [];
  const valueAliases = budget?.value_aliases || {};
  const tagValuesAvailable = dimensionValuesAvailable(accountsData);

  // What a line can be opened up by. Anchored on what this workbook already
  // breaks out — a line naming several Carta accounts opens by account.
  const breakouts = useMemo(() => rowBreakouts(accountsData, budget),
                            [accountsData, budget]);
  // Kept across reloads and in the URL, as the other two layouts keep their toolbars.
  const { breakoutKey, setBreakoutKey, frequency: pickedFrequency, setFrequency } = useViewToolbar({
    prefsKey: prefsKeyFor(accountsData, budget?.id), breakouts, sharedView: budget?.view,
  });
  const breakout = useMemo(() => {
    if (breakoutKey === "none") return null;
    if (breakoutKey) return breakouts.find(b => b.key === breakoutKey) || null;
    return defaultBreakout(accountsData, breakouts, budget);
  }, [breakoutKey, breakouts, accountsData, budget]);
  // The cell group under the cursor. Held here rather than in CSS because
  // a figure is three sibling cells and :hover reaches only one of them.
  const [hoverCell, setHoverCell] = useState(null);
  const glNames = useMemo(() => glNameMap(accountsData?.entries), [accountsData]);
  const subCodes = useMemo(() => subCodeMap(accountsData?.entries), [accountsData]);

  // A breakout that is on is a question already asked, so the rows arrive
  // open rather than as a second click on every one. That holds for all of
  // them — the accounts and sub-accounts under a GL breakout, the vendors
  // under a vendor one, the values under a reporting tag.
  //
  // And however the breakout got here: on a sheet whose rows ARE accounts
  // it is the default, so the report opens expanded; on a sheet of the
  // firm's own categories nothing is chosen for the reader, but the moment
  // they pick one they get the same expanded view.
  const opensByDefault = !!breakout;
  // The rows whose state DIFFERS from that default, not the rows that are
  // open. Storing "open" instead would make every row a toggle the reader
  // has to undo when the default is already open.
  const [flipped, setFlipped] = useState(() => new Set());
  const toggleLine = (key) => {
    trackClick("MancoReporting.BudgetVsActuals.OutlineToggleLine");
    setFlipped(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };
  // A breakout change is a new question; carrying the previous one's
  // exceptions into it opens and closes rows the reader never touched.
  useEffect(() => { setFlipped(new Set()); }, [breakout?.key]);

  // Actuals per line-row key, bucketed by month. Computed once; aggregate
  // rows then sum their children (or constituents) out of this map.
  // Totals drill by naming the lines they sum, so they need to find them —
  // through another total's `total_key` too, when a formula tree nests.
  const rowByKey = useMemo(() => rowsByTreeId(rows), [rows]);


  const lineActuals = useMemo(
    () => computeLineActuals(rows, accountsData, valueAliases, periodYear, dimension),
    [rows, accountsData, valueAliases, periodYear, dimension]
  );
  const actualsByKey = lineActuals.actuals;
  // Spend these lines handed to a tag-reporting line elsewhere, kept so the
  // report can show it rather than let it leave the page unexplained.
  const elsewhereByKey = lineActuals.elsewhere;
  // Which line now carries a row's actual, when it shares an account +
  // scope with another and lost the tie — see computeLineActuals.
  const sharedWithByKey = lineActuals.sharedWith || {};
  // Entries each line lost to a more specific line in the tie-break, so the
  // drill panel can drop the same ones the row's own figure already does.
  const excludedEntriesByKey = lineActuals.excludedEntries || {};

  // Aggregate rows resolve from their formula tree when it is usable, else
  // from constituents; see computeAggregates.
  const aggregatesAndShort = useMemo(
    () => {
      const short = new Set();
      const agg = computeAggregates(rows, actualsByKey, short);
      return { agg, short };
    },
    [rows, actualsByKey]
  );
  const aggregates = aggregatesAndShort.agg;
  // Totals whose own formula named fewer lines than they sit over.
  const widenedTotals = aggregatesAndShort.short;

  // A "subtotal" row is a heading and a rollup collapsed into one row — its
  // label announces the cluster of lines above it AND carries their sum.
  // That reads fine in a spreadsheet but is an awkward affordance in a UI
  // (a group whose only "header" sits at the bottom of its own children).
  // displayRows splits the two roles back apart for rendering only: a
  // label-only header row is inserted before the cluster's first line, and
  // the original subtotal row — unchanged, still driving every lookup below
  // — is shown with "Total" in place of its full label. Aggregation and
  // key generation (rowAggKey) still run against the real `rows` array
  // farther up, never against this display-only list.
  const displayRows = useMemo(() => withGroupHeaders(rows), [rows]);

  // A section with no subsection layer (Income) reads one indent step
  // shallower than one that has subsections (Operating Expenses); bump it.
  const flatSections = useMemo(() => {
    const withSubsection = new Set(
      rows.filter(r => r.row_kind === "subsection_header").map(r => r.section)
    );
    return new Set(
      rows.filter(r => r.section && !withSubsection.has(r.section)).map(r => r.section)
    );
  }, [rows]);

  // Every key that feeds ANY subtotal, so those lines can indent one notch
  // deeper than their sibling lines that don't belong to a cluster (e.g.
  // "Consulting" sits directly under "Investment" with no subtotal of its
  // own, so it stays at the department's base indent; "Salaries" feeds
  // "Salaries, Benefits, and Payroll Taxes" and indents under it).
  const constituentKeys = useMemo(() => {
    const keys = new Set();
    for (const row of rows) {
      if (row.row_kind === "subtotal" && Array.isArray(row.constituents)) {
        for (const k of row.constituents) keys.add(k);
      }
    }
    return keys;
  }, [rows]);

  const feeBreakdown = useMemo(() => feeBreakdownRows(rows), [rows]);

  // Collapse — keyed on each header's own index within displayRows (stable
  // across re-renders of the same budget; recomputed, and any stale index
  // implicitly dropped, whenever displayRows itself changes). A header's
  // "range" is every row up to the next header at the same or shallower
  // depth, so collapsing "Investment" (depth 0... actually 1) hides its
  // nested group headers too, without their own collapsed state mattering
  // while they're hidden.
  const [collapsed, setCollapsed] = useState(() => new Set());
  // depthRanges is a coarse OUTER bound only — "the next header at the
  // same or shallower depth" — used to cap how far a header's closing-row
  // search can look, not the collapse range itself. Using it directly as
  // the collapse range was the bug: a header's real range has to end at
  // ITS OWN closing total/summary/subtotal row, which is a plain (non-
  // header) row. "Other Expense" (nested under Investment) has no sibling
  // header after it — the next actual header-kind row is "Founder
  // Services", one level shallower, on the OTHER department — so the
  // depth-only bound ran straight through "Total Investment" and folded
  // it into "Other Expense"'s own collapse range.
  const depthRanges = useMemo(() => computeHeaderRanges(displayRows), [displayRows]);

  // Precise end per header: search forward (bounded by depthRanges, so an
  // unrelated later section can't accidentally label-match) for the ONE
  // row that is this header's own rollup — a subtotal row sharing its
  // exact label (group_header was synthesized from that row), or a
  // total/summary row literally labeled "Total <header label>". That
  // row's own index + 1 is both the true end of what collapsing hides and
  // the row whose figures surface inline on the header itself.
  const { ranges, closingRowByHeaderIdx } = useMemo(
    () => resolveHeaderRanges(displayRows, depthRanges),
    [depthRanges, displayRows]
  );

  // Reverse of closingRowByHeaderIdx, keyed by the closing ROW itself (not
  // the header) — every row_kind that can close a header ("Total X" via
  // subtotal, "Total Investment" via total, "Total Operating Expenses" /
  // "Net Income" via summary) has to align with the HEADER it closes, not
  // with its own `depth` field. Depth alone can't carry this: "Total
  // Investment" and "Total Operating Expenses" are both depth 1 despite
  // needing different indents (40 vs 26) — only the header they actually
  // close (found by label match above) pins that down correctly.
  const closingRowIndent = useMemo(() => {
    const map = new Map();
    for (const [headerIdx, r] of closingRowByHeaderIdx) {
      const header = displayRows[headerIdx];
      map.set(r, headerLabelIndent(header, flatSections.has(header.section)));
    }
    return map;
  }, [closingRowByHeaderIdx, displayRows, flatSections]);

  const hiddenIdx = useMemo(() => {
    const hidden = new Set();
    for (const idx of collapsed) {
      const end = ranges.get(idx);
      if (end == null) continue;
      for (let j = idx + 1; j < end; j++) hidden.add(j);
    }
    return hidden;
  }, [collapsed, ranges]);
  const toggleCollapsed = (idx) => {
    trackClick("MancoReporting.BudgetVsActuals.OutlineToggleGroup");
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx); else next.add(idx);
      return next;
    });
  };

  const yr = periodYear || budget?.period_year || "";

  const frequencies = outlineFrequencies(budget);
  const frequency = outlineFrequency(budget, pickedFrequency);
  const columns = useMemo(() => outlineColumns(frequency, yr), [frequency, yr]);

  // Groups (one per period) + sub-columns (Actual/Budget/Var $, each with a
  // provenance mark) for the shared GroupedTableHead — see ui/table.jsx.
  const groups = columns.map(c => ({ key: c.key, label: c.label }));
  const subCols = [
    { label: "Actual" },
    { label: "Budget" },
    { label: "Var $" },
  ];

  // Callback-ref-held node — see useStickyHeader's doc for why a plain
  // useRef object doesn't work here.
  const [theadEl, setTheadEl] = useState(null);
  const stickyState = useStickyHeader(theadEl);

  // Anchor the scroll to the current period's column, once per Period
  // choice. Table layout can take a few ticks to settle, so poll until it
  // holds steady.
  const scrollRef = useRef(null);
  const anchoredRef = useRef(null);
  useEffect(() => {
    if (anchoredRef.current === frequency) return;
    const container = scrollRef.current;
    if (!container) return;
    const asOfMonth = trueAsOfMonth(asOf);
    const currentKey = columns.find(c => c.short && c.months.includes(asOfMonth))?.key || "Total";
    let timerId;
    let lastLeft = null;
    let stableTicks = 0;
    let ticksLeft = 30; // ~500ms budget; a stalled layout just skips the anchor
    const measure = () => {
      const th = container.querySelector(`th[data-col-key="${currentKey}"]`);
      const labelTh = container.querySelector("thead th");
      ticksLeft -= 1;
      if (!th || !labelTh) { if (ticksLeft > 0) timerId = setTimeout(measure, 16); return; }
      const left = th.getBoundingClientRect().left;
      stableTicks = (lastLeft !== null && Math.abs(left - lastLeft) < 0.5) ? stableTicks + 1 : 0;
      lastLeft = left;
      if (stableTicks < 2 && ticksLeft > 0) { timerId = setTimeout(measure, 16); return; }
      anchoredRef.current = frequency;
      const contRect = container.getBoundingClientRect();
      const labelWidth = labelTh.getBoundingClientRect().width;
      container.scrollLeft = Math.max(0, container.scrollLeft + (left - contRect.left - labelWidth));
    };
    timerId = setTimeout(measure, 16);
    return () => clearTimeout(timerId);
  }, [asOf, frequency, columns]);

  return (
    <>
    <div data-export-exclude>
      <FilterRibbon>
        {frequencies && (
          <PeriodDropdown options={frequencies} value={frequency} onChange={setFrequency} />
        )}
        <FiltersMenu breakouts={breakouts} breakoutKey={breakout ? breakout.key : "none"}
                     onBreakoutKey={setBreakoutKey} />
      </FilterRibbon>
    </div>
    <TableScroll scrollRef={scrollRef}>
      <table style={LEDGER_BASE}>
        <thead ref={setTheadEl}>
          <GroupedTableHead labelText="Line item" groups={groups} subCols={subCols} />
        </thead>
        {/* Floating clone — portaled to document.body so it can sit fixed
            below AppShell's own sticky topbar regardless of where this
            table lives in the DOM. Only mounted while genuinely floating
            (the table's real header has scrolled up under the topbar but
            the table's own body hasn't scrolled past entirely). */}
        {stickyState.floating && (
          <StickyClone stickyState={stickyState}>
            <GroupedTableHead
              labelText="Line item" groups={groups} subCols={subCols}
              colWidths={stickyState.colWidths} subWidths={stickyState.subWidths}
              scrollLeft={stickyState.scrollLeft || 0}
            />
          </StickyClone>
        )}
        <tbody>
          {displayRows.map((row, i) => {
            if (hiddenIdx.has(i)) return null;
            const isHeader = row.row_kind === "section_header" || row.row_kind === "subsection_header" || row.row_kind === "group_header";
            return (
              <OutlineRow
                key={`${i}-${row.label}`}
                row={row}
                actualsByKey={actualsByKey}
                glNames={glNames}
                subCodes={subCodes}
                aggregates={aggregates}
                valueAliases={valueAliases}
                tagValuesAvailable={tagValuesAvailable}
                periodYear={yr}
                columns={columns}
                monthlyBudgets={!!frequencies}
                onDrill={drilldown?.openOutlineCell}
                onDrillTotal={drilldown?.openOutlineTotal}
                hoverCell={hoverCell}
                heldCell={drilldown?.selection?.cellKey || null}
                onHoverCell={setHoverCell}
                rowByKey={rowByKey}
                asTotal={row.row_kind === "subtotal"}
                extraIndent={row.key ? constituentKeys.has(row.key) : false}
                sectionFlat={row.section ? flatSections.has(row.section) : false}
                breakdownChild={feeBreakdown.has(row)}
                collapsed={isHeader ? collapsed.has(i) : undefined}
                onToggleCollapse={isHeader ? () => toggleCollapsed(i) : undefined}
                closingRow={isHeader ? closingRowByHeaderIdx.get(i) : undefined}
                alignIndent={!isHeader ? closingRowIndent.get(row) : undefined}
                breakout={breakout}
                entries={accountsData?.entries}
                dimension={dimension}
                widened={widenedTotals.has(rowAggKey(row))}
                elsewhere={row.key ? elsewhereByKey[row.key] : undefined}
                sharedWithLabel={row.key ? sharedWithByKey[row.key] : undefined}
                excludedEntries={row.key ? excludedEntriesByKey[row.key] : undefined}
                excludedEntriesByKey={excludedEntriesByKey}
                open={row.key
                  ? (flipped.has(row.key) ? !opensByDefault : opensByDefault)
                  : false}
                onToggleLine={row.key ? () => toggleLine(row.key) : undefined}
              />
            );
          })}
        </tbody>
      </table>
    </TableScroll>
    <BudgetSourceLine meta={budget?.workbook_meta} />
    </>
  );
}

// Inserts a label-only header row before the first line of every subtotal's
// own cluster (per its `constituents` — the authoritative list of which
// rows it sums, not just "whatever's immediately above it"). Only the
// FIRST constituent gets one, so a cluster never gets duplicate headers.
// Purely a display transform: the real `rows` array (and every lookup keyed
// off it — actualsByKey, aggregates, rowAggKey) is untouched.
export function withGroupHeaders(rows) {
  const openerFor = new Map();
  for (const row of rows) {
    if (row.row_kind === "subtotal" && Array.isArray(row.constituents) && row.constituents.length) {
      const firstKey = row.constituents[0];
      if (!openerFor.has(firstKey)) openerFor.set(firstKey, row);
    }
  }
  const out = [];
  for (const row of rows) {
    const opener = row.key ? openerFor.get(row.key) : undefined;
    if (opener) {
      out.push({
        row_kind: "group_header",
        label: opener.label,
        depth: opener.depth,
        section: opener.section,
        subsection: opener.subsection,
      });
    }
    out.push(row);
  }
  return out;
}

// The rows that break a management-fee income line down by fund, as a Set
// of row objects: the fund lines (fund_match, set by the build's roster
// match) directly under it in the same section, plus the aggregate row
// right after them that is not a "Total ..." closer — the remainder
// (fee income less the fund rows), which reads as the residual child.
const MGMT_FEE_LABEL_RX = /management\s+fee/i;
export function feeBreakdownRows(rows) {
  const out = new Set();
  let parent = null;
  let fundsSeen = 0;
  for (const row of rows) {
    const kind = row.row_kind;
    if (kind === "line" && !row.fund_match && MGMT_FEE_LABEL_RX.test(row.label || "")) {
      parent = row;
      fundsSeen = 0;
    } else if (parent && kind === "line" && row.fund_match && row.section === parent.section) {
      out.add(row);
      fundsSeen++;
    } else {
      if (parent && fundsSeen && (kind === "subtotal" || kind === "total")
          && row.section === parent.section && !/^total\b/i.test(row.label || "")) {
        out.add(row);
      }
      parent = null;
    }
  }
  return out;
}

// Each tier nests one step (14) under its own parent tier:
//   section_header    (Income, Operating Expenses) → 12 + 14
//   subsection_header (Investment)                 → 12 + 14*2   (under a section)
//   group_header       (Salaries, Benefits...)      → 12 + 14*3   (under a subsection)
// group_header is a CHILD of subsection_header (Investment), not a
// sibling of its plain lines — "Salaries, Benefits, and Payroll Taxes"
// etc. read as nested categories within Investment, one visible step in
// from "Investment" itself. Shared by the header branch (for the header's
// own label) AND by the plain-row branch (for a closing total/summary/
// subtotal row, which has to align with the header it closes — see
// closingRowIndent below, not with its own raw `depth` field, which two
// different-tier closers can share despite needing different indents:
// "Total Investment" and "Total Operating Expenses" are both depth 1).
// `bump`: this header's own section has no subsection layer (see
// flatSections) — its closing row aligns one step deeper to match.
export function headerLabelIndent(header, bump = false) {
  const kind = header.row_kind;
  const base = kind === "section_header"    ? 12 + 14
             : kind === "subsection_header" ? 12 + 14 * 2
             :                                 12 + 14 * 3;
  return bump ? base + 14 : base;
}

// Every header's collapse range: from just after it to the next header at
// the same or shallower depth (or the end of the list). A stack keyed on
// depth handles arbitrary nesting in one forward pass — pushing a new
// header closes out (assigns an end index to) every open header at least
// as deep as it, the same rule an outline's own indentation already
// encodes. Non-header rows never touch the stack; they just ride inside
// whichever header is currently open above them.
export function computeHeaderRanges(displayRows) {
  const isHeader = (k) => k === "section_header" || k === "subsection_header" || k === "group_header";
  const ranges = new Map();
  const stack = [];
  for (let i = 0; i < displayRows.length; i++) {
    const row = displayRows[i];
    if (!isHeader(row.row_kind)) continue;
    const depth = row.depth || 0;
    while (stack.length && stack[stack.length - 1].depth >= depth) {
      const top = stack.pop();
      ranges.set(top.idx, i);
    }
    stack.push({ idx: i, depth });
  }
  while (stack.length) {
    const top = stack.pop();
    ranges.set(top.idx, displayRows.length);
  }
  return ranges;
}

// The precise per-header end + closing row, bounded by computeHeaderRanges'
// coarse depth-only end. This is where the "Other Expense swallowed Total
// Investment" bug actually lived: depthRanges alone can't stop at a
// header's own closing total/summary/subtotal row (those aren't
// header-kind, so the depth-only pass walks straight through them to the
// next real header) — this pass narrows that outer bound down to the
// exact row via label matching, both for what collapsing hides AND for
// which row's figures surface inline on the collapsed header.
export function resolveHeaderRanges(displayRows, depthRanges) {
  const ranges = new Map();
  const closingRowByHeaderIdx = new Map();
  for (const [headerIdx, depthEnd] of depthRanges) {
    const header = displayRows[headerIdx];
    let end = depthEnd;
    for (let j = headerIdx + 1; j < depthEnd; j++) {
      const r = displayRows[j];
      const isMine =
        (r.row_kind === "subtotal" && r.label === header.label) ||
        (["total", "summary"].includes(r.row_kind) && r.label === `Total ${header.label}`);
      if (isMine) {
        closingRowByHeaderIdx.set(headerIdx, r);
        end = j + 1;
        break;
      }
    }
    ranges.set(headerIdx, end);
  }
  return { ranges, closingRowByHeaderIdx };
}

// A collapsed header, showing the figures of the row it closes (rather than
// nothing) — split out of OutlineRow because it's a genuinely different
// row shape (normal-width label column + real numeric cells) from both the
// full-width label-only band (collapsed=false) and a plain data row.
function CollapsedHeaderRow({ row, style, labelIndent, closingRow, aggregates, columns,
                              onToggleCollapse }) {
  const closingActuals = aggregates[rowAggKey(closingRow)] || emptyBuckets();
  return (
    <tr>
      {/* Not colSpan here — this is a normal-width label column like any
          data row, so it needs the same sticky/fixed-width structural
          properties tdLabel_ etc. carry (the header `style` only ever had
          to fill a full-width band before now). */}
      <td style={{
        ...style, paddingLeft: 0,
        position: "sticky", left: 0, zIndex: 1, minWidth: 320,
        borderRight: `1px solid ${LINE}`,
        background: style.background || PAPER,
      }}>
        <button
          type="button"
          onClick={onToggleCollapse}
          style={{ ...styles.collapseToggle, position: "relative", left: 0, paddingLeft: labelIndent, display: "block" }}
          aria-expanded={false}
          aria-label={`Expand ${row.label}`}
        >
          <span data-export-exclude style={{ ...styles.collapseCaretSlot, left: labelIndent - 20 }}>
            <CollapseCaret collapsed={true} />
          </span>
          {row.label}
        </button>
      </td>
      {columns.map(col => {
        const budgetV = columnBudget(closingRow, col);
        const actualV = columnActual(closingActuals, col);
        const variance = actualV - budgetV;
        // `style` here is the header's own td style (sectionHeader/
        // subsectionHeader/groupHeader) — same border-collapse:separate
        // reasoning as OutlineRow's plain-row branch: the border has to sit
        // on this <td> directly, so it's spread in rather than left on <tr>.
        const numStyle = { ...styles.tdNum, ...style, ...styles.tdNumStrong };
        return (
          <Fragment3
            key={col.key}
            a={(actualV === 0 && budgetV === 0) ? "—" : fmtCurrencyWhole(actualV)}
            b={budgetV === 0 ? "—" : fmtCurrencyWhole(budgetV)}
            v={(actualV === 0 && budgetV === 0) ? "—" : fmtVarianceWhole(variance)}
            vColor={varianceColor(variance, rowPolarity(closingRow))}
            numStyle={numStyle}
          />
        );
      })}
    </tr>
  );
}

function OutlineRow({ row, actualsByKey, aggregates, valueAliases, tagValuesAvailable = true,
                     periodYear, columns, monthlyBudgets = false, onDrill, asTotal, extraIndent, sectionFlat, breakdownChild, collapsed, onToggleCollapse,
                     closingRow, alignIndent, glNames, subCodes,
                     breakout, entries, dimension, open, onToggleLine, elsewhere,
                     widened, onDrillTotal, rowByKey, sharedWithLabel,
                     excludedEntries, excludedEntriesByKey,
                     hoverCell, heldCell, onHoverCell }) {
  const kind = row.row_kind;

  // Structural headers span the full width — no numbers of their own.
  // group_header is display-only (see withGroupHeaders) and sits one notch
  // lighter than subsectionHeader — it opens a cluster of lines within a
  // department, not the department itself — and indents to match the
  // lines it introduces rather than sitting at the department's own margin.
  if (kind === "section_header" || kind === "subsection_header" || kind === "group_header") {
    const style =
        kind === "section_header"    ? styles.sectionHeader
      : kind === "group_header"      ? styles.groupHeader
      :                                 styles.subsectionHeader;
    const labelIndent = headerLabelIndent(row);
    // Collapsed AND a closing row was found: keep the header's own label
    // (not colSpan — a normal-width label cell, like any data row) and
    // fill the rest of the row with THAT row's own figures, so collapsing
    // a section doesn't take its total down with it. Expanded, or no
    // closing row exists (shouldn't happen for a well-formed outline, but
    // degrades to the old label-only band rather than showing nothing).
    if (collapsed && closingRow) {
      return (
        <CollapsedHeaderRow
          row={row} style={style} labelIndent={labelIndent}
          closingRow={closingRow} aggregates={aggregates} columns={columns}
          onToggleCollapse={onToggleCollapse}
        />
      );
    }

    return (
      <tr>
        <td
          colSpan={1 + columns.length * 3}
          style={style}
        >
          {/* Pinned inside the spanning cell: the band stretches the full
              table width, so its label would otherwise scroll out of view
              and leave an unlabelled stripe. The whole label+caret run is
              the click target, not just the glyph — a caret alone is a
              small, easy-to-miss target for something every header does.
              The caret is positioned absolutely so it hangs in the gutter
              left of the label rather than sharing the label's own flex
              flow — that's what let it push the label text off-alignment
              with the children below in the first place. */}
          <button
            type="button"
            onClick={onToggleCollapse}
            style={{ ...styles.collapseToggle, ...styles.bandLabel, left: 0, paddingLeft: labelIndent }}
            aria-expanded={!collapsed}
            aria-label={`${collapsed ? "Expand" : "Collapse"} ${row.label}`}
          >
            {/* 20 ≈ caret width (14) + a small gap (6) — sits just left of
                the label's own text start (labelIndent), not at a fixed
                far-left column. */}
            <span data-export-exclude style={{ ...styles.collapseCaretSlot, left: labelIndent - 20 }}>
              <CollapseCaret collapsed={collapsed} />
            </span>
            {row.label}
          </button>
        </td>
      </tr>
    );
  }

  // A leaf-like subtotal resolves from its own accounts, so look there
  // before the constituent-summed aggregates.
  const actuals = kind === "line"
    ? (actualsByKey[row.key] || emptyBuckets())
    : (actualsByKey[rowAggKey(row)] || aggregates[rowAggKey(row)] || emptyBuckets());

  // "void" is a decision the client recorded: this line has no Carta
  // counterpart and they chose to leave it blank. "unmapped" is the
  // unanswered case. A reader needs to tell those apart — one is settled,
  // the other is a question nobody has answered yet.
  const voided = kind === "line" && row.void === true;
  const hasGls = (row.gl_codes || []).length > 0;
  // A line whose label names one of the firm's own values that the matcher
  // couldn't resolve. It HAS accounts, so left alone it would report every
  // dollar they saw rather than this slice of them — on one firm, 20x the
  // real figure. Withheld like an unmapped line: a blank is a question, a
  // wrong number is an answer.
  const scopeUnresolved = kind === "line" && !voided && row.scope_unresolved === true;
  // A fee offset the ManCo books no account for. Until the mapping step
  // is answered there is no figure to report, and once answered "omit"
  // there is deliberately none — a blank is a question, a wrong number is
  // an answer, and the funds' figure here would be another entity's.
  const offsetPending = kind === "line"
    && ((row.fee_offset_unresolved || []).length > 0
        || (row.no_manco_equivalent || []).length > 0);
  const unmapped = kind === "line" && !voided
    && (scopeUnresolved || offsetPending
        || (!row.fund_match && !(row.gl_codes || []).length));
  // A more specific line absorbed EVERY entry this one had. A partial
  // loss keeps real actual instead — see the elsewhereNote call below.
  const shared = kind === "line" && !voided && !unmapped && sharedWithLabel
    && Math.abs(actuals.Total || 0) < 0.005 ? sharedWithLabel : null;

  // Why this row's figure doesn't read like a normal one — the workbook's
  // own comment is a separate thing, on its own icon/tooltip below.
  const rowNote = [
    unmapped && !scopeUnresolved
      && "No Carta account is mapped to this line, so there is no actual to compare.",
    scopeUnresolved && `This line names something the report couldn't match to one of ${
      (row.scope_candidates || []).length ? "these values" : "the firm's values"}, so its `
      + `actuals are withheld rather than reported across every account it touches.`
      + ((row.scope_candidates || []).length
          ? `\nDid you mean: ${(row.scope_candidates || []).map(c => c.value).join(" · ")}?`
          : ""),
    voided && "Budget-only by choice: this line has no Carta counterpart.",
    // A waiver the ManCo nets into fee income rather than booking beside
    // it. Blank is the honest figure; unexplained it reads as a load
    // failure, which is what sent the last reader looking for the bug.
    (row.no_manco_equivalent || []).length > 0
      && `The management company books no separate account for this — it nets `
        + `it into management fee income, which the fee lines above already `
        + `report. Showing it here would count the same amount twice.`,
    (row.cross_entity_gl || []).length > 0
      && `This figure comes from the funds' own ledger (${
          row.cross_entity_gl.join(", ")}), not the management company's, `
        + `because the management company books no separate account for it.`,
    (row.fee_offset_unresolved || []).length > 0
      && `The management company books no account for this offset. Answer `
        + `this line in the mapping step to leave it out or report it from `
        + `the funds' ledger.`,
    shared && `Same Carta account and scope as "${shared}" — Carta can't tell the two `
      + `apart, so the actual is reported there instead of here.`,
    widened && "This workbook's formula sums fewer lines than this total covers. The figure covers all of them.",
    // Spend on this line's accounts that a scoped line elsewhere already
    // reports. It used to sit under the row as its own line, which read as
    // a component of the figure rather than as spend deliberately kept out
    // of it — and it doubled the height of every row that had one.
    elsewhereNote(elsewhere, row, sharedWithLabel),
  ].filter(Boolean).join("\n") || null;

  const rowStyle =
      kind === "total"    ? styles.trTotal
    : kind === "summary"  ? styles.trSummary
    : kind === "subtotal" ? styles.trSubtotal
    : styles.trLine;

  const labelStyle =
      kind === "total"    ? styles.tdLabelTotal
    : kind === "summary"  ? styles.tdLabelSummary
    : kind === "subtotal" ? styles.tdLabelSubtotal
    : styles.tdLabel_;

  // Lines that feed a subtotal indent one notch past their siblings that
  // don't — visually nesting them under the cluster header inserted above
  // them, rather than reading as flush with unrelated dept-level lines
  // (e.g. "Consulting", which rolls straight into "Total Investment" with
  // no subtotal of its own).
  // 26, not one plain indent-step (14) — the group header above sits
  // behind a caret + button padding that already eats ~21px of visual
  // space, so a bare +14 landed a constituent line's text at roughly the
  // SAME visual start as its own header's text, reading as flush rather
  // than nested. +26 clears that and reads as a clear child indent.
  // alignIndent (closingRowIndent, computed in the parent) overrides the
  // plain depth formula for ANY row that closes a header — "Total X"
  // (subtotal), "Total Investment" (total), "Total Operating Expenses" /
  // "Net Income" (summary) alike. This has to come from the header it
  // closes, not its own `depth` field: "Total Investment" and "Total
  // Operating Expenses" are both depth 1 despite needing different
  // indents (40 vs 26) — only label-matching against the real header
  // (closingRowByHeaderIdx) tells them apart.
  const baseIndent = alignIndent != null
    ? alignIndent
    : 12 + (row.depth || 0) * 14 + (extraIndent ? 28 : 0) + (sectionFlat ? 14 : 0);
  // One step under the management-fee line it breaks down.
  const indent = baseIndent + (breakdownChild ? NEST_STEP : 0);

  // Only real lines open: an aggregate has no single set of entries behind
  // it, and a fund-matched fee line resolves from fund-side JEs, which this
  // breakout does not read.
  // The row's own reporting-tag scope first, else the shared dimension —
  // the same precedence computeLineActuals uses, so a click's drawer
  // reports the same slice the cell above it summed.
  const rowScope = rowTagScope(row, dimension, tagValuesAvailable);
  const tagFilter = (row.tag_value && rowScope)
    ? new Set(valueAliases[row.tag_value] || [row.tag_value]) : null;
  const children = (breakout && kind === "line" && !row.fund_match && !unmapped && !voided
                    && opensAnything(row, breakout))
    ? breakoutBuckets(entries, row, breakout, {
        tagFilter, dimension: rowScope || dimension, bucketOf: monthBucket,
        bucketKeys: MONTHS,
        excludeClaims: row.excluded_claims,
        excludeEntries: excludedEntries,
      })
    : [];
  const expandable = !!onToggleLine && worthBreakingOut(children);
  const monthlyBudget = drillMonthlyBudget(row, monthlyBudgets);
  const isOpen = expandable && open;

  return (
    // rowStyle is spread into EACH <td> below (label and numeric alike),
    // not just left on this <tr> — the table uses `border-collapse:
    // separate` (tableScroll/table styles), under which a border set on
    // <tr> itself is silently dropped by every browser; only borders on
    // the actual <td>/<th> elements render. Leaving it tr-only is what
    // made every row-separator fix look like it "didn't take."
    <Fragment>
    <tr>
      {/* The caret hangs in the gutter, not in the text flow: inline, it
          pushed a row's label out of line with every row that has none.
          No `position: "relative"` here — labelStyle already carries
          `position: "sticky"` (see tdLabel_), which is enough of a
          containing block for the caret's `position: absolute`; adding
          "relative" on top overrode the sticky and un-froze the column. */}
      <td style={{ ...labelStyle, ...rowStyle, paddingLeft: indent }}>
        {/* Same CollapseCaret used for the section-header collapse toggle
            below — not a hand-drawn "▸", which read as a different control
            from the one styling every other expand/collapse in this app. */}
        {expandable && (
          <button
            type="button"
            data-export-exclude
            onClick={(e) => { e.stopPropagation(); onToggleLine(); }}
            aria-expanded={isOpen}
            aria-label={`${isOpen ? "Hide" : "Show"} ${row.label} by ${breakout.label}`}
            // -20 matches the section-header caret's own offset; -13 was
            // tuned for the old slimmer "▸" and crowded this SVG into the text.
            style={{ ...styles.lineCaret, left: indent - 20 }}
          >
            <CollapseCaret collapsed={!isOpen} />
          </button>
        )}
        {/* The accounts a line covers, plus why its figure doesn't read
            like a normal row's, live on the label's own tooltip. The
            workbook's own comment is separate, on its own icon below. */}
        <HoverTip text={[hasGls ? glTooltip(row.gl_codes, glNames, row.scopes, subCodes,
                                            children.map(c => subOfChildLabel(c.label))
                                                    .filter(Boolean)) : null, rowNote]
          .filter(Boolean).join("\n\n") || null}>
          {asTotal ? `Total ${row.label}` : row.label}
        </HoverTip>
        <span style={styles.labelMeta}>
          {/* Ink's real Bubble spec, unmodified — no size override. A
              previous pass shrank it (10px/15px) to fit the dense row,
              which is exactly what made it look off: a Bubble at the
              wrong scale isn't Ink's Bubble anymore. */}
          {row.fund_match && (
            <Bubble tone="info">{row.fund_match}</Bubble>
          )}
          {row.comment && (
            <HoverTip text={`Budget note: ${row.comment}`}>
              <NoteIcon aria-label={`Budget note: ${row.comment}`} />
            </HoverTip>
          )}
        </span>
      </td>
      {columns.map(col => {
        const budgetV = columnBudget(row, col);
        const actualV = columnActual(actuals, col);
        const variance = actualV - budgetV;

        // A total has no accounts of its own, but it does have the lines it
        // summed — so it drills to those, unioned. Unmapped lines still
        // have nothing to resolve.
        const isAgg = kind === "subtotal" || kind === "total" || kind === "summary";
        const members = isAgg && onDrillTotal && rowByKey
          ? totalMembers(row, rowByKey, valueAliases, tagValuesAvailable, dimension,
                         excludedEntriesByKey) : [];
        const canDrillTotal = members.length > 0 && actualV !== 0;
        const canDrill = !!onDrill && kind === "line" && !unmapped && !shared
                         && (actualV !== 0 || !!row.comment);
        const onClickTotal = canDrillTotal
          ? () => onDrillTotal({
              cellKey:    outlineCellKey(row, col.key),
              label:      asTotal ? `Total ${row.label}` : row.label,
              ...drillPeriod(col),
              members,
              dimension,
              periodYear,
              budget:     budgetV,
              actual:     actualV,
              polarity:   rowPolarity(row),
              monthlyBudget,
            })
          : undefined;
        const onClick = canDrill
          ? () => onDrill({
              cellKey:    outlineCellKey(row, col.key),
              label:      row.label,
              ...drillPeriod(col),
              glCodes:    row.gl_codes || [],
              scopes:     row.scopes || null,
              excludedClaims: row.excluded_claims || null,
              excludedEntries: excludedEntries || null,
              cartaTags:  (row.tag_value && rowScope)
                          ? (valueAliases[row.tag_value] || [row.tag_value]) : null,
              fundMatch:  row.fund_match || null,
              // Answered to the funds' ledger: the drawer reads there too,
              // or its journals would not add up to the cell above them.
              crossEntityGl: row.cross_entity_gl || null,
              comment:    row.comment || null,
              tag_value:  row.tag_value || null,
              dimension,
              periodYear,
              // The cell's own figures ride along so the drawer can restate
              // the comparison the click came from using the same numbers,
              // and read their sign the same way.
              budget:     budgetV,
              actual:     actualV,
              polarity:   rowPolarity(row),
              monthlyBudget,
              unmapped,
            })
          : undefined;
        const numStyle = {
          ...styles.tdNum,
          ...rowStyle,
          ...(kind === "total" || kind === "summary" ? styles.tdNumStrong : null),

          ...(canDrill || canDrillTotal ? { cursor: "pointer" } : null),
        };
        const cellKey = outlineCellKey(row, col.key);
        return (
          <Fragment3
            key={col.key}
            onClick={onClick || onClickTotal}
            hovered={hoverCell === cellKey}
            held={heldCell === cellKey}
            onHover={(on) => onHoverCell?.(on ? cellKey : null)}
            a={
              unmapped || shared ? "—"
              : (actualV === 0 && budgetV === 0) ? "—"
              : fmtCurrencyWhole(actualV)
            }
            b={budgetV === 0 ? "—" : fmtCurrencyWhole(budgetV)}
            v={
              unmapped || shared ? "—"
              : (actualV === 0 && budgetV === 0) ? "—"
              : fmtVarianceWhole(variance)
            }
            vColor={unmapped || shared ? FAINT : varianceColor(variance, rowPolarity(row))}
            numStyle={numStyle}
          />
        );
      })}
    </tr>
    {isOpen && children.map(c => (
      <OutlineChildRow
        key={`${row.key}-${childKey(c)}`} child={c} indent={indent + 26 + (c.nested ? NEST_STEP : 0)}
        row={row} breakout={breakout} periodYear={periodYear} columns={columns}
        dimension={dimension}
        cartaTags={(row.tag_value && rowScope)
                   ? (valueAliases[row.tag_value] || [row.tag_value]) : null}
        onDrill={onDrill} hoverCell={hoverCell} heldCell={heldCell}
        onHoverCell={onHoverCell}
      />
    ))}
    </Fragment>
  );
}

/** What this line's accounts saw that a scoped line elsewhere reports.
 *
 *  Said on the label's tooltip rather than as a row of its own: it is not
 *  part of this figure, it is the reason the figure is smaller than the
 *  accounts behind it.
 */
export function elsewhereNote(elsewhere, row, sharedWithLabel) {
  const amount = elsewhere?.Total;
  if (!amount) return null;
  const names = (row?.excluded_claims || []).map(c => c.value).filter(Boolean);
  const dest = names.length ? names.join(", ") : sharedWithLabel;
  if (!dest) return null;
  return `${fmtCurrencyWhole(amount)} on this line's accounts is reported under `
       + `${dest}, so it is not counted here.`;
}

// A child carries actuals and no budget: the workbook budgets the line, not
// the vendors or accounts inside it, and prorating would invent a variance.
export function OutlineChildRow({ child, indent, row, breakout, periodYear, columns, dimension,
                          cartaTags, onDrill, hoverCell, heldCell, onHoverCell }) {
  // Every breakout row reads as a figure a reader can open, so they all
  // look alike. "Not specified" was greyed and inert, which read as a
  // number that did not count rather than one nobody had labelled.
  const numStyle = { ...styles.tdNum, ...styles.trLine, ...styles.childNum };
  const canDrill = !!onDrill && !!breakout;
  // Named after the axis it is missing from — "Not specified" read the same
  // under every breakout and told a reader nothing about which one.
  // The account breakout labels a child "<account> · <sub>" so two
  // accounts' sub-accounts stay apart in the data. On screen the row above
  // already says which account this is when the child nests under it, so
  // the prefix repeats it — the reader wants the half they do not have. The
  // label keeps its full form everywhere it identifies rather than displays:
  // the drill scope, the cell key, and the drawer title below.
  const label = childDisplayLabel(child, breakout);
  return (
    <tr>
      <td style={{ ...styles.tdLabel_, ...styles.trLine, paddingLeft: indent }}>
        {/* Italic still, because it names an absence rather than something
            the firm typed — but in the same ink as every row beside it. */}
        <span style={child.unlabelled ? styles.childUnlabelled : null}>{label}</span>
      </td>
      {columns.map(col => {
        const actualV = columnActual(child.buckets, col);
        const cellKey = `${outlineCellKey(row, col.key)}|${childKey(child)}`;
        const onClick = (canDrill && actualV !== 0)
          ? () => onDrill({
              cellKey,
              // The line it belongs to, then the value it is: a reader who
              // opened "<line> · <value>" should see that, not one or other.
              label:      `${row.label} · ${label}`,
              ...drillPeriod(col),
              glCodes:    row.gl_codes || [],
              scopes:     row.scopes || null,
              // The line's own scope still applies: this row is a slice of
              // that figure, not a fresh question about the same accounts.
              cartaTags,
              // And so do its exclusions. The bucket beneath the line is
              // computed with them; without them here the panel counted
              // spend the line beside it reports, and opened a row reading
              // one figure onto a list totalling another.
              excludedClaims: row.excluded_claims || null,
              // The absence of a value is a filter like any other: entries
              // this dimension says nothing about. Carried as null rather
              // than the words on the row, which are a label, not a value
              // any entry holds.
              childScope: childScope(child, breakout),
              dimension,
              periodYear,
              // Breakout rows are actuals only — prorating the line's budget
              // across its values would invent a variance for each of them.
              budget:     null,
              actual:     actualV,
            })
          : undefined;
        return (
          <Fragment3
            key={col.key}
            onClick={onClick}
            hovered={hoverCell === cellKey}
            held={heldCell === cellKey}
            onHover={onClick ? (on) => onHoverCell?.(on ? cellKey : null) : undefined}
            a={actualV ? fmtCurrencyWhole(actualV) : "—"}
            b="—" v="—" vColor={MICRO} bColor={MICRO}
            numStyle={{ ...numStyle, ...(onClick ? { cursor: "pointer" } : null) }}
          />
        );
      })}
    </tr>
  );
}

// Three <td>s per period. Named oddly because React fragments can't carry
// keys through a .map into <tr> without a wrapper, and a wrapper element
// would break table semantics.
function Fragment3({ a, b, v, vColor, bColor, numStyle, onClick, hovered, held, onHover }) {
  const h = drillCellProps({ onClick, hovered, held, onHover });
  // Continues the header's own period divider (table.jsx's thGroup).
  const firstStyle = { ...numStyle, borderLeft: `1px solid ${LINE}` };
  return (
    <>
      <td {...h} style={firstStyle}>{a}</td>
      <td {...h} style={bColor ? { ...numStyle, color: bColor } : numStyle}>{b}</td>
      <td {...h} style={{ ...numStyle, color: vColor }}>{v}</td>
    </>
  );
}

// -----------------------------------------------------------------------

function emptyBuckets() {
  const b = {};
  for (const k of BUCKET_KEYS) b[k] = 0;
  return b;
}

/** The bucket an entry's month lands in, or null for a month outside the year. */
function monthBucket(mo) {
  const m = Number(mo);
  return Number.isInteger(m) && m >= 1 && m <= 12 ? m : null;
}

/** A row's actual over one column: the sum of the months it covers. */
export function columnActual(buckets, col) {
  if (!buckets) return 0;
  if (col.key === "Total") return buckets.Total || 0;
  return col.months.reduce((sum, m) => sum + (buckets[m] || 0), 0);
}

/** The monthly plan a drill charts against, when the workbook states one.
 *  Otherwise the drawer falls back to its even-spread pace line. */
export function drillMonthlyBudget(row, monthlyBudgets) {
  return monthlyBudgets && Array.isArray(row?.monthly) && row.monthly.length === 12
    ? row.monthly : null;
}

/** What a drill carries about the column it opened from. A Total covers the
 *  whole year and so names no period and constrains no month. */
function drillPeriod(col) {
  return col.key === "Total"
    ? { periodLabel: null, months: null }
    : { periodLabel: col.short, months: col.months };
}

/** Which cell group a click or a hover is about.
 *
 *  Keyed on the row's own identity, never its label: a workbook can name
 *  the same fund in two sections, and a label match lights the wrong money.
 */
export function outlineCellKey(row, columnKey) {
  return `${row?.key || rowAggKey(row)}|${columnKey}`;
}

export function rowAggKey(row) {
  // Aggregate rows are identified by label + section + subsection, which
  // is unique within a workbook outline (the same subtotal label repeats
  // across depts, but never within one).
  return `${row.section || ""}|${row.subsection || ""}|${row.label}`;
}

// A row naming a vendor or fund is a deliberate carve-out; a bare
// department tag is the broad bucket it was carved out of. Ranks which
// row wins when both would count the same entry (see the conflict pass
// in computeLineActuals) — higher wins.
function claimSpecificity(row) {
  const extra = (row.scopes || []).filter(sc => sc.source !== "reporting_tag");
  return extra.length * 2 + (row.tag_value ? 1 : 0);
}

export function computeLineActuals(rows, accountsData, valueAliases, periodYear,
                                   dimension = null) {
  const entries = accountsData?.entries || [];
  const fundFees = accountsData?.fund_fee_entries || [];
  const mancoFees = accountsData?.manco_fee_entries || [];
  const yr = String(periodYear || "");
  // No JE this firm has carries a Department tag: a dept-scoped row would
  // sum to $0 forever, so treat it as firm-wide like an unscoped row.
  const tagValuesAvailable = dimensionValuesAvailable(accountsData);
  const out = {};
  const elsewhereOut = {};
  // Entries a "line" row's own bucket actually counted, not ceded to
  // `elsewhere`. The conflict pass below re-walks these lists.
  const claimedByRow = new Map();

  for (const row of rows) {
    // A subtotal covering no lines but naming accounts is a leaf wearing a
    // subtotal's label — summing its (empty) constituents reports zero
    // against a real budget.
    const leafLike = row.row_kind !== "line"
      && !(row.constituents || []).length && (row.gl_codes || []).length;
    if ((row.row_kind !== "line" && !leafLike) || (!row.key && !leafLike)) continue;
    const bucket = emptyBuckets();
    const elsewhere = emptyBuckets();
    const claimed = [];

    if (row.fund_match) {
      // Per-fund management fee. The ManCo's own entries by default —
      // this is its report — and the funds' only where the mapping step
      // recorded that answer for an offset it books no account for.
      const crossEntity = (row.cross_entity_gl || []).length > 0;
      const feeRows = crossEntity ? fundFees
                                  : (mancoFees.length ? mancoFees : fundFees);
      const rx = fundMatchRegex(row.fund_match);
      // A fund's fees and the offsets against them are different Carta
      // accounts. A line naming one reports that one: two sections can
      // name the same fund and mean different halves of it.
      const only = new Set(row.gl_codes || []);
      const mine = [];
      for (const e of feeRows) {
        if (yr && String(e.yr ?? "") !== yr) continue;
        if (!rx.test(e.fund || "")) continue;
        if (only.size && !only.has(e.acct_type)) continue;
        if (!monthBucket(e.mo)) continue;
        mine.push(e);
      }
      // A line naming only the offset measures a reduction, which the
      // workbook budgets as a positive. A net line is mixed, so it is not.
      const contra = mine.length && mine.every(e => Number(e.amount ?? e.amt ?? 0) < 0);
      for (const e of mine) {
        const raw = Number(e.amount ?? e.amt ?? 0) || 0;
        const amt = contra ? -raw : raw;
        bucket[monthBucket(e.mo)] += amt;
        bucket.Total += amt;
      }
    } else if ((row.gl_codes || []).length) {
      const gls = new Set(row.gl_codes);
      // Values another line reports are not this line's to report too.
      const claims = row.excluded_claims || [];
      // Dept-scoped expense lines filter by the Carta Department tag;
      // income/summary lines are firm-wide. The row's own reporting-tag
      // scope wins over the workbook-wide dimension — a dimension the
      // workbook never resolved must not un-filter a row that names its own.
      const scope = rowTagScope(row, dimension, tagValuesAvailable);
      const tags = (row.tag_value && scope)
        ? new Set(valueAliases[row.tag_value] || [row.tag_value]) : null;
      // A line can be scoped by more than one thing at once — one
      // department's rent for one office. It means the intersection.
      const extra = (row.scopes || []).filter(sc => sc.source !== "reporting_tag");
      for (const e of entries) {
        if (!gls.has(e.acct_type)) continue;
        const mo = monthBucket(e.mo);
        if (!mo) continue;
        const amt = Number(e.amount ?? 0) || 0;
        if (extra.length
            && !extra.every(sc => dimensionValue(e, sc) === sc.value)) continue;
        if (tags) {
          const v = dimensionValue(e, scope);
          if (v == null || !tags.has(v)) continue;
        } else if (claims.length && claims.some(c => dimensionValue(e, c) === c.value)) {
          elsewhere[mo] += amt;
          elsewhere.Total += amt;
          continue;
        }
        bucket[mo] += amt;
        bucket.Total += amt;
        claimed.push({ entry: e, mo, amt });
      }
    }
    const slot = row.key || rowAggKey(row);
    out[slot] = bucket;
    if (elsewhere.Total) elsewhereOut[slot] = elsewhere;
    if (row.row_kind === "line" && !row.fund_match && claimed.length) {
      claimedByRow.set(row, claimed);
    }
  }

  // Group every claim by the entry it landed on. Where more than one row
  // claimed the same entry, only the most specific keeps it (claimSpecificity).
  const sharedWith = {};
  const claimsByEntry = new Map();
  for (const [row, claimed] of claimedByRow) {
    for (const c of claimed) {
      if (!claimsByEntry.has(c.entry)) claimsByEntry.set(c.entry, []);
      claimsByEntry.get(c.entry).push({ row, ...c });
    }
  }
  const lostBucketByRow = new Map();  // loser's row.key -> months lost
  const lostToWinner = new Map();     // loser's row.key -> Map(winner label -> amount)
  // Entries a row's own filter still matches but which a more specific row
  // claimed instead, keyed by the losing row's key. A drill panel re-running
  // that same filter has to drop these, or it lists money the cell's own
  // figure no longer includes.
  const excludedEntries = {};
  for (const claimants of claimsByEntry.values()) {
    if (claimants.length < 2) continue;
    const ranked = [...claimants].sort((a, b) => {
      const bySpecificity = claimSpecificity(b.row) - claimSpecificity(a.row);
      if (bySpecificity !== 0) return bySpecificity;
      const byBudget = Math.abs(b.row.annual || 0) - Math.abs(a.row.annual || 0);
      return byBudget !== 0 ? byBudget : rows.indexOf(a.row) - rows.indexOf(b.row);
    });
    const [winner, ...losers] = ranked;
    for (const loser of losers) {
      out[loser.row.key][loser.mo] -= loser.amt;
      out[loser.row.key].Total -= loser.amt;
      if (!lostBucketByRow.has(loser.row.key)) lostBucketByRow.set(loser.row.key, emptyBuckets());
      const lost = lostBucketByRow.get(loser.row.key);
      lost[loser.mo] += loser.amt;
      lost.Total += loser.amt;
      if (!lostToWinner.has(loser.row.key)) lostToWinner.set(loser.row.key, new Map());
      const byWinner = lostToWinner.get(loser.row.key);
      byWinner.set(winner.row.label, (byWinner.get(winner.row.label) || 0) + loser.amt);
      if (!excludedEntries[loser.row.key]) excludedEntries[loser.row.key] = [];
      excludedEntries[loser.row.key].push(loser.entry);
    }
  }
  // A row left at zero renders "—" (OutlineRow's `shared`), not a note. One
  // with real leftover actual gets the lost slice folded into `elsewhere`.
  for (const [loserKey, byWinner] of lostToWinner) {
    let best = null;
    for (const [label, amt] of byWinner) if (!best || amt > best.amt) best = { label, amt };
    sharedWith[loserKey] = best.label;
    if (Math.abs(out[loserKey]?.Total || 0) < 0.005) continue;
    const lost = lostBucketByRow.get(loserKey);
    const existing = elsewhereOut[loserKey];
    if (existing) for (const k of BUCKET_KEYS) existing[k] += lost[k] || 0;
    else elsewhereOut[loserKey] = lost;
  }

  return { actuals: out, elsewhere: elsewhereOut, sharedWith, excludedEntries };
}

const isHeaderKind = (k) => String(k || "").endsWith("header");
const isTotalKind = (k) => k === "total" || k === "subtotal" || k === "summary";

/** Every row of the outline, keyed by the id a formula tree's `children`
 *  name it by: a line's `key`, or a total's `total_key`. */
export function rowsByTreeId(rows) {
  const m = new Map();
  for (const r of rows) {
    if (r.key) m.set(r.key, r);
    if (r.total_key) m.set(r.total_key, r);
  }
  return m;
}

/** A total's direct children with the sign its own formula gives each, when
 *  the figure can be read from them: every `children` id names a row of
 *  this outline, and the formula adds nothing beyond them
 *  (`children_complete`). Null otherwise — no tree at all (an older bundle,
 *  the Worker's own Carta budget, a typed-in sheet) or one that can't
 *  explain the row on its own — and the caller keeps the constituent path.
 *  Whether a row is a total is read from its `children`, never its label.
 */
export function usableTree(row, rowById) {
  const ids = row?.children;
  if (!Array.isArray(ids) || !ids.length || row.children_complete === false) return null;
  const kids = ids.map(id => rowById.get(id));
  if (kids.some(k => !k)) return null;
  const signs = row.child_signs || [];
  return kids.map((child, i) => ({ child, sign: signs[i] < 0 ? -1 : 1 }));
}

/** The keys of the lines a total without a usable tree sums — the one
 *  rule both its figure (computeAggregates) and its drawer (totalMembers)
 *  read: the lines it was widened to cover, or its formula's own, whichever
 *  is wider. covered_lines alone would miss lines when a formula names more
 *  lines than the run above it. Returns `row.constituents` itself when the
 *  formula's own set wins, so a caller can tell the total wasn't widened. */
function summedLineKeys(row, covered = row?.covered_lines || []) {
  const constituents = row?.constituents || [];
  return covered.length > constituents.length ? covered : constituents;
}

/** The leaf line keys a total's figure sums, read down through its tree, or
 *  null when any of them is subtracted along the way: a drawer is a union
 *  of entries and cannot show a difference, so a signed total (Net Income)
 *  doesn't drill. A child total with no usable tree contributes its own
 *  summedLineKeys. */
function treeLeafKeys(row, rowById, seen = new Set()) {
  const tree = usableTree(row, rowById);
  if (!tree) return summedLineKeys(row);
  if (seen.has(row)) return [];
  seen.add(row);
  const keys = [];
  for (const { child, sign } of tree) {
    if (sign < 0) return null;
    const sub = child.row_kind === "line" ? [child.key] : treeLeafKeys(child, rowById, seen);
    if (sub === null) return null;
    keys.push(...sub);
  }
  return [...new Set(keys)];
}

/** The line rows a total's figure was summed from, as drill members.
 *
 *  Same keys the aggregate itself used — its tree's leaf lines, or without
 *  one summedLineKeys — so the drawer holds exactly what the figure holds. A line with nothing
 *  behind it contributes nothing. `rowByKey` maps tree ids (see
 *  rowsByTreeId).
 */
export function totalMembers(row, rowByKey, valueAliases = {}, tagValuesAvailable = true,
                             dimension = null, excludedEntriesByKey = {}) {
  const keys = treeLeafKeys(row, rowByKey) || [];
  const out = [];
  for (const k of keys) {
    const r = rowByKey.get(k);
    if (!r) continue;
    const glCodes = r.gl_codes || [];
    // A per-fund line resolves against the fund-side dataset by fund name,
    // so it belongs in the total whether or not it also names an account.
    if (!glCodes.length && !r.fund_match) continue;
    // Its own reporting-tag scope first, else the shared dimension — the
    // same precedence computeLineActuals uses, so a total's drill members
    // report the same slice the figure above them summed.
    const scope = rowTagScope(r, dimension, tagValuesAvailable);
    out.push({
      glCodes,
      scopes: r.scopes || null,
      excludedClaims: r.excluded_claims || null,
      cartaTags: (r.tag_value && scope)
        ? (valueAliases[r.tag_value] || [r.tag_value]) : null,
      fundMatch: r.fund_match || null,
      tag_value: r.tag_value || null,
      // Entries this line lost to a more specific line in the tie-break —
      // carried along so a total's drawer, which recurses into each
      // member's own filter, drops them the same way the line's own cell
      // does.
      excludedEntries: excludedEntriesByKey[k] || null,
    });
  }
  return out;
}

/** Every line row in the section a total closes.
 *
 *  Only meaningful for the LAST total before the next header — a section's
 *  grand total, which a reader takes to cover the whole section including
 *  the subtotals within it. An earlier total covers its own run, and this
 *  says nothing about those.
 */
export function linesCoveredBy(rows, i) {
  if (!isTotalKind(rows[i]?.row_kind)) return [];
  // Not the section's last total: leave it to its own formula.
  for (let j = i + 1; j < rows.length; j += 1) {
    if (isHeaderKind(rows[j].row_kind)) break;
    if (isTotalKind(rows[j].row_kind)) return [];
  }
  const keys = [];
  for (let j = i - 1; j >= 0; j -= 1) {
    if (isHeaderKind(rows[j].row_kind)) break;
    if (rows[j].row_kind === "line" && rows[j].key) keys.push(rows[j].key);
  }
  return keys;
}

/** Actuals per aggregate row (keyed by rowAggKey), bucketed by month.
 *
 *  A total with a usable formula tree (usableTree) reports the sum of its
 *  children's actuals, each with the sign its formula gives it, read down
 *  through nested totals — Net Income included, which is just another
 *  total in the tree. Each line child's actual is computeLineActuals' own,
 *  so its reporting-tag scope and tie-break exclusions carry through
 *  unchanged. Without a usable tree a total sums its constituents (widened
 *  to the lines it visibly covers), and Net Income falls back to
 *  Total Income − Total Operating Expenses − State and Local Taxes, found
 *  by label.
 */
export function computeAggregates(rows, actualsByKey, shortfalls) {
  const out = {};
  const rowById = rowsByTreeId(rows);
  // Constituent-summed aggregates first, for every total the tree doesn't
  // cover; a tree total may name one of these as a child.
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    if (usableTree(row, rowById)) continue;
    if (!Array.isArray(row.constituents)) continue;
    if (!row.constituents.length && (row.gl_codes || []).length) continue;
    // A formula naming fewer lines than the total visibly sits over
    // reports one line's figure as the section's. Sum what it covers, and
    // let the row say it did — a total that is quietly wrong is the worst
    // thing on the page, because everything else invites checking.
    // The build names the lines when it can, so the report and the
    // read-out that precedes it cannot disagree about which totals moved.
    const covered = Array.isArray(row.covered_lines)
      ? row.covered_lines : linesCoveredBy(rows, i);
    const keys = summedLineKeys(row, covered);
    if (keys !== row.constituents && shortfalls) shortfalls.add(rowAggKey(row));
    const bucket = emptyBuckets();
    for (const k of keys) {
      const src = actualsByKey[k];
      if (!src) continue;
      for (const k of BUCKET_KEYS) bucket[k] += src[k] || 0;
    }
    out[rowAggKey(row)] = bucket;
  }

  // Tree totals, each child's figure signed by its own formula. A child
  // total without a usable tree reads what it reports on its own row —
  // its own accounts when it has them, else its constituent sum above.
  const treeActuals = (row, seen) => {
    const slot = rowAggKey(row);
    if (seen.has(row)) return emptyBuckets();   // a cycle contributes nothing
    if (out[slot]) return out[slot];
    seen.add(row);
    const bucket = emptyBuckets();
    for (const { child, sign } of usableTree(row, rowById)) {
      const src = child.row_kind === "line"
        ? actualsByKey[child.key]
        : usableTree(child, rowById)
          ? treeActuals(child, seen)
          : (actualsByKey[rowAggKey(child)] || out[rowAggKey(child)]);
      if (!src) continue;
      for (const k of BUCKET_KEYS) bucket[k] += sign * (src[k] || 0);
    }
    out[slot] = bucket;
    return bucket;
  };
  for (const row of rows) {
    if (row.row_kind !== "line" && usableTree(row, rowById)) treeActuals(row, new Set());
  }

  // Derived rows (Net Income) with no usable tree = Total Income − Total
  // Operating Expenses − any standalone summary lines between them (e.g.
  // State and Local Taxes), found by label.
  const byLabel = (needle) =>
    rows.find(r => String(r.label || "").trim().toLowerCase().startsWith(needle));
  const incomeRow = byLabel("total income");
  const opexRow   = byLabel("total operating expenses");
  const saltRow   = rows.find(r =>
    r.row_kind === "line" && /state and local tax/i.test(r.label || ""));

  for (const row of rows) {
    if (row.derived !== "net_income" || usableTree(row, rowById)) continue;
    const bucket = emptyBuckets();
    const inc  = incomeRow ? out[rowAggKey(incomeRow)] : null;
    const opex = opexRow   ? out[rowAggKey(opexRow)]   : null;
    const salt = saltRow   ? actualsByKey[saltRow.key] : null;
    for (const k of BUCKET_KEYS) {
      bucket[k] = (inc?.[k] || 0) - (opex?.[k] || 0) - (salt?.[k] || 0);
    }
    out[rowAggKey(row)] = bucket;
  }
  return out;
}

/** A row's budget over one column. A row with no monthly figures states
 *  only the year, so only the Total column carries it. */
export function columnBudget(row, col) {
  if (!Array.isArray(row.monthly)) {
    return col.key === "Total" ? (row.annual || 0) : 0;
  }
  let sum = 0;
  for (const m of col.months) {
    const v = row.monthly[m - 1];
    if (typeof v === "number") sum += v;
  }
  return sum;
}

export const styles = {
  breakoutBar: { ...sans, display: "flex", flexWrap: "wrap", alignItems: "center",
                 gap: 6, margin: "0 0 10px" },
  breakoutLabel: { fontSize: FS.micro, color: MICRO, textTransform: "uppercase",
                   letterSpacing: "0.04em", marginRight: 2 },
  breakoutBtn: { ...sans, fontSize: FS.body, padding: "4px 10px", borderRadius: 4,
                 border: `1px solid ${LINE}`, background: "transparent",
                 color: FAINT, cursor: "pointer" },
  breakoutBtnActive: { color: INK, borderColor: INK, fontWeight: 500 },
  // Matches collapseToggle below: inherited text color, not a hardcoded
  // grey, and the same 5px hit-area padding.
  lineCaret: { ...sans, position: "absolute", display: "flex",
               border: "none", background: "transparent", borderRadius: 4,
               color: "inherit", cursor: "pointer", padding: "0 5px 0 0" },
  // A figure that opens its entries, like the line above it. The budget and
  // variance columns beside it stay muted: those belong to the line, and a
  // breakout row has none of its own.
  childNum: {},
  childUnlabelled: { fontStyle: "italic" },
  bandLabel: { position: "sticky", left: 12, display: "inline-block" },
  // Transparent, borderless toggle — same construction as Ink's own
  // `.ink-table__sort-btn` (Ink's components.md): no resting
  // fill, sized to its own label rather than a fixed control height,
  // `margin`/`padding` cancel so the label still lands flush at the
  // header's own inset.
  // `paddingLeft` (set per-header in OutlineRow, from `labelIndent`) is what
  // actually positions the label text — this is now a position: relative
  // anchor for collapseCaretSlot, not a flex container with its own gap.
  collapseToggle: {
    ...sans, position: "relative", display: "inline-block",
    paddingTop: 0, paddingBottom: 0, paddingRight: 5, margin: 0,
    background: "transparent", border: 0, borderRadius: 4,
    font: "inherit", color: "inherit", cursor: "pointer",
  },
  // `left` is set per-row (OutlineRow, from labelIndent) — NOT a fixed 0.
  // A fixed 0 anchors every header's caret to one shared far-left column
  // regardless of how deep its label sits, which reads as carets stranded
  // away from their own labels for anything but the shallowest header. The
  // caret has to move WITH its label — just staying close beside it,
  // never sharing the label's own flex flow (which is what let it push
  // the label off the indent its children use in the first place).
  collapseCaretSlot: {
    position: "absolute", top: "50%",
    transform: "translateY(-50%)", display: "inline-flex",
  },
  // Top-level P&L section ("Income", "Operating Expenses").
  // paddingLeft: 0 on all three header TDs below is deliberate — the
  // label's actual horizontal position comes ENTIRELY from the sticky
  // button's own paddingLeft (labelIndent, computed in OutlineRow), the
  // same single-source-of-truth model line rows already use (their
  // `paddingLeft: indent` overrides this same shorthand's left component).
  // Leaving the TD's own left padding in place double-applied an offset on
  // top of labelIndent, which is what made a header's label land somewhere
  // other than where its children's labels actually sit.
  // Shared by all three header tiers — same size/weight/padding rhythm as
  // every data row (Ink's .ink-table recipe: 10px 12px, 24px line-height).
  // paddingLeft: 0 is deliberate: the label's actual horizontal position
  // comes ENTIRELY from the sticky button's own paddingLeft (labelIndent,
  // computed in OutlineRow) — leaving the TD's own left padding in place
  // double-applied an offset on top of labelIndent, which is what made a
  // header's label land somewhere other than where its children sit.
  _headerBase: {
    ...sans, fontSize: FS.value, lineHeight: "24px", fontWeight: 600, color: INK,
    padding: "10px 12px", paddingLeft: 0,
    borderBottom: `1px solid ${LINE}`,
  },
  // Top-level P&L section ("Income", "Operating Expenses"). White, not
  // SHADE — Carta's own tables use a plain white header band (bold label +
  // rule), not a gray fill; gray here read backwards relative to how every
  // other Carta table treats a header row.
  get sectionHeader() {
    return {
      ...this._headerBase,
      letterSpacing: "0.06em", textTransform: "uppercase",
      background: PAPER, borderTop: `1px solid ${LINE}`,
    };
  },
  // Dept sub-section within Operating Expenses.
  get subsectionHeader() {
    return { ...this._headerBase, borderTop: `1px solid ${LINE}` };
  },
  // A cluster header WITHIN a department (e.g. "Salaries, Benefits, and
  // Payroll Taxes" opening its own four lines) — one notch lighter than
  // subsectionHeader: no top rule, no shaded fill. It's introducing a
  // handful of lines, not a whole department, so it shouldn't compete with
  // subsectionHeader's weight.
  get groupHeader() {
    return this._headerBase;
  },
  // Ink's `.ink-table` gives EVERY row a border-bottom (border-subtle) —
  // "each row has a line separator" — with only the table's own last row
  // going bare. `trSummary` (Net Income) is the actual last row this table
  // ever renders, so it keeps its own emphasis rule instead.
  trLine:     LEDGER_ROW,
  trSubtotal: LEDGER_ROW,
  // A real section/department grand total ("Total Investment") — Ink's own
  // `.ink-table tr.is-total` recipe: a light BLUE wash (TOTAL_ROW_BG), not
  // gray, at font-weight 500 (not a heavier custom weight) — see
  // TOTAL_ROW_BG's comment for the second, independent source agreeing on
  // blue. Border-bottom restored (every row gets one); the extra top rule
  // on BORDER_DEFAULT is this app's own addition, marking where the
  // department's detail ends.
  trTotal:    LEDGER_TOTAL,
  // borderBottom restored — trSummary isn't always the table's true last
  // row ("Total Operating Expenses" uses it too, with "State and Local
  // Taxes" and "Net Income" still to come after), so dropping it left a
  // gap in the "every row separates" rule wherever it wasn't actually last.
  trSummary:  LEDGER_SUMMARY,
  // Shared by every label-column cell (line, subtotal, total, summary) —
  // sticky-pinned first column, same box model throughout. Only weight
  // and background vary per tier, which the four getters below layer on.
  // Flex is this table's own: its label cell pairs a name with trailing
  // GL codes and note markers.
  _tdLabelBase: {
    ...LEDGER_LABEL,
    display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12,
  },
  get tdLabel_() {
    return this._tdLabelBase;
  },
  get tdLabelSubtotal() {
    return { ...this._tdLabelBase, fontWeight: 500 };
  },
  // background overrides to TOTAL_ROW_BG — matches trTotal/trSummary's own
  // tint; the sticky label column must carry its own opaque fill (it's
  // pinned above the scrolling body), so if it doesn't repeat the row's
  // tint the pinned column reads as a cutout in an otherwise-tinted row.
  get tdLabelTotal() {
    return { ...this._tdLabelBase, fontWeight: 500, background: TOTAL_ROW_BG };
  },
  // 600/TOTAL_ROW_BG, NOT a bigger fontSize — 14 matches every header/body
  // size in the table (a previous 15 read as one notch bigger than
  // "Operating Expenses" itself, inconsistent rather than extra emphasis).
  get tdLabelSummary() {
    return { ...this._tdLabelBase, fontWeight: 600, background: TOTAL_ROW_BG };
  },
  labelMeta: {
    display: "inline-flex", alignItems: "center", gap: 6, flexShrink: 0,
  },
  // GL account number(s), trailing the label. FAINT (Ink text-subtle,
  // #656B6B) — not MICRO (Ink text-disabled, #A7AAAA), which reads too
  // faint at this size to be reliably legible as a real account number.
  glCode: { ...inkNum, fontSize: FS.value, color: FAINT, flexShrink: 0 },
  unmapped: {
    fontSize: FS.micro, fontStyle: "italic", color: MICRO, cursor: "help",
  },
  noteGlyph: {
    // MICRO grey, not blue. Blue is reserved for links and focus, and this
    // marker sits inside a Budget figure — colouring it like a link invites
    // a click that does nothing, and undercuts the convention the rest of
    // the table leans on. A note marker only has to be findable.
    fontSize: FS.small, fontWeight: 600, color: MICRO,
    verticalAlign: "super", lineHeight: 0, cursor: "help",
  },
  // No borderLeft — the one separator after the frozen label column comes
  // from that column's own borderRight (tdLabel_ etc.); vertical rules
  // between every numeric column added noise the header row doesn't need
  // to match (thGroup/thSub keep theirs — those genuinely mark Q1/Q2/...
  // boundaries, which is a real grouping the body rows don't repeat).
  tdNum: LEDGER_NUM,
  // 600, not the previous 700 — Ink's own is-total recipe is 500; this
  // stays one notch above that only to keep the total/summary distinction
  // this table already carries in the label column (500 vs 600).
  tdNumStrong: { fontWeight: 600 },
};
