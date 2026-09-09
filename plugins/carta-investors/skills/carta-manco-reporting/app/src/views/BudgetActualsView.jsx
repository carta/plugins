import { useEffect, useMemo, useState } from "react";
import { sans, INK, PAPER, LINE, FAINT, MICRO, SHADE, microCaption, FS, RED } from "../ui/theme.js";
import { H1 } from "../ui/components.jsx";
import BudgetActualsAccounts, { hasMonthlyDetail } from "./BudgetActualsAccounts.jsx";
import { glNameMap, glTooltip } from "../ui/glNames.js";
import { dimensionOf, dimensionValue, dimensionValuesAvailable,
         dimensionLabel, dimensionLabelPlural, noValueLabel } from "../ui/dimension.js";
import { LEDGER_LABEL, LEDGER_NUM, LEDGER_ROW, LEDGER_TOTAL, LEDGER_SECTION } from "../ui/ledger.js";
import { TableScroll, LEDGER_BASE, TOTAL_ROW_BG, GroupedTableHead, useStickyHeader, StickyClone } from "../ui/table.jsx";
import { Capped } from "../shell/AppShell.jsx";
import { fmtCurrencyWhole } from "../charts/chartTheme.js";
import { varianceColor, fmtVarianceWhole } from "../ui/variance.js";
import BudgetActualsOutline from "./BudgetActualsOutline.jsx";
import BudgetSourceLine from "./BudgetSourceLine.jsx";
import HoverTip from "../ui/HoverTip.jsx";
import { FiltersMenu, FilterRibbon, SimplePeriodPicker, S as periodControlsStyles } from "./BudgetPeriodControls.jsx";
import { MONTH_NAME, trueAsOfMonth, formatPeriodLabel } from "./budgetPeriods.js";
import { rowBreakouts, defaultBreakout, worthBreakingOut, UNLABELLED } from "./accountBreakout.js";
import ExportButton from "../ui/ExportButton.jsx";
import { slugify } from "../ui/exportHtml.js";
import { trackClick } from "../analytics.js";

const BVA_EXPORT_ID = "manco-export-budget-vs-actuals";

// Budget vs Actuals page. Routes between two renderers based on the
// selected budget's declared view_kinds:
//
//   by-tag-crosstab → the crosstab below. Rows = GL / P&L line items;
//     columns = the values the workbook separates its budget by (top N +
//     Firm Total, "Show all" reveals the rest), each with Actual · Budget
//     · Variance ($) · Variance (%). Actuals join client-side from
//     accountsData.entries on the firm's own dimension AND account_type.
//
//     The axis is whatever that firm keeps — a reporting-tag category, a
//     sub-account, a vendor. Which one is matched from the workbook's own
//     column headings at ingest, and the columns are labelled from the
//     firm's own data (see dimensionLabel). "by-department" is read as a
//     synonym: budgets parsed before the rename carry it.
//
//   by-line-item → <BudgetActualsOutline>, which mirrors the client's own
//     budget tab (their sections, line items and subtotals, in their
//     order) with quarterly columns.
//
// Neither path issues new SQL.

const TOP_VALUE_DEFAULT_N = 3;             // + Firm Total = 4 columns by default

// The only axes this page renders. Matching against this fixed list, not
// "isn't X or Y so it must be Z", stops an unrecognized axis from falling
// through to the department crosstab and joining actuals on the wrong tag.
export function classifyBudgetView(viewKinds) {
  const kinds = viewKinds || [];
  if (kinds.includes("by-account")) return "by-account";
  if (kinds.includes("by-line-item")) return "by-line-item";
  // "by-department" is the pre-rename input every shape adapter and every
  // build_manco_datadir.py fallback stopped writing; still accepted, never returned.
  if (kinds.includes("by-tag-crosstab") || kinds.includes("by-department")) return "by-tag-crosstab";
  return null;
}

// Whether the account view's own period toggle is on screen for this
// budget — its own chip would repeat the toggle's window and go stale the
// moment the reader changes it, unlike the outline and crosstab views,
// which have no toggle and still need the static chip to say the period.
export function ownsPeriodControl(viewKind, budget) {
  return viewKind === "by-account" && hasMonthlyDetail(budget);
}

export default function BudgetActualsView({ snapshot, accountsData, drilldown, budgetId }) {
  // The build writes the dimension beside the entries it scopes, in
  // accounts.json. Snapshot is the fallback for a cache written earlier.
  const dimension = dimensionOf(accountsData) || dimensionOf(snapshot);
  // Multi-budget: snapshot.budget.budgets[] holds every ingested budget
  // (a "Dept View · YTD Q2" crosstab alongside a "Base Case · Annual"
  // outline, say).
  // Pick the one whose id matches the sidebar's active sub-nav entry;
  // fall back to snapshot.budget for legacy single-budget snapshots.
  const budgetsList = Array.isArray(snapshot?.budget?.budgets) ? snapshot.budget.budgets : [];
  const selected = budgetsList.find(b => b.id === budgetId) || budgetsList[0];
  const budget = selected || snapshot?.budget;
  const byTagValue = budget?.by_tag_value || [];
  const viewKinds = budget?.view_kinds || ["by-tag-crosstab"];
  const [showAll, setShowAll] = useState(false);
  const [showHidden, setShowHidden] = useState(false);
  // A callback-ref, not useRef: a stable ref's identity never re-attaches
  // if the view first mounts on a non-crosstab budget. See useStickyHeader.
  const [theadEl, setTheadEl] = useState(null);
  const stickyState = useStickyHeader(theadEl);

  // Split the columns into shown / hidden based on progressive-disclosure
  // toggle. Firm Total is always shown last. The rest are already sorted by
  // expenses_ytd descending upstream (build_manco_datadir.py).
  const firmTotal = byTagValue.find(d => d.tag_value === "Firm Total") || null;
  const otherValues = byTagValue.filter(d => d.tag_value !== "Firm Total");
  const visibleValues = showAll ? otherValues : otherValues.slice(0, TOP_VALUE_DEFAULT_N);
  const columns = firmTotal ? [...visibleValues, firmTotal] : visibleValues;

  // Row axis: the workbook's own outline, straight from the adapter — its
  // section bands, groupings, subtotals and totals in its own order and at
  // its own nesting depth. Older snapshots predate the outline shape and
  // carry no rows[]; those fall back to reconstructing a flat account list
  // from the by_account maps.
  const allRows = useMemo(() => {
    const outline = (budget?.rows || []).filter(r => r.row_kind);
    return outline.length ? outline : buildRowAxis(byTagValue, firmTotal);
  }, [budget, byTagValue, firmTotal]);

  // Rows the author collapsed in Excel are theirs to not look at: they
  // hide the detail and read the rollup. We keep them in `allRows` because
  // the subtotals above them are built from them, and only filter at
  // render time.
  const hiddenCountRows = allRows.filter(r => r.hidden).length;
  const rows = useMemo(
    () => (showHidden ? allRows : allRows.filter(r => !r.hidden)),
    [allRows, showHidden]
  );

  // Per-dept actuals map: {dept: {account_type: actual_ytd}}.
  // Computed once from accountsData.entries and reused across all row cells.
  const glNames = useMemo(() => glNameMap(accountsData?.entries), [accountsData]);

  // Column budgets are one total, not a monthly split (shapes/tag_crosstab.py) —
  // widening actuals can't widen the budget figure alongside it, so it's opt-in.
  const asOfMonth = trueAsOfMonth(snapshot?.asOf);
  const statedLastMonth = budget?.period?.last_month ?? 12;
  const canExtendToToday = asOfMonth > statedLastMonth;
  const [throughToday, setThroughToday] = useState(false);
  const effectivePeriod = useMemo(() => {
    if (!throughToday || !canExtendToToday) return budget?.period;
    return { ...budget?.period, last_month: asOfMonth };
  }, [throughToday, canExtendToToday, asOfMonth, budget]);

  const tagValuesAvailable = dimensionValuesAvailable(accountsData);
  const actualsByTagValue = useMemo(
    () => computeActualsByTagValue(accountsData?.entries || [], byTagValue, effectivePeriod,
                               tagValuesAvailable, dimension),
    [accountsData, byTagValue, effectivePeriod, tagValuesAvailable, dimension]
  );

  // {row key: {dept: actual}}. Leaf lines resolve from Carta by GL code;
  // aggregate rows sum the rows their formula names, so an actual reported
  // against a subtotal is built from the same lines the workbook adds up.
  const actualsByKey = useMemo(
    () => computeActualsByKey(allRows, actualsByTagValue),
    [allRows, actualsByTagValue]
  );

  // key → label, for rendering a formula's cell references as the row
  // names a reader recognizes.
  const labelByKey = useMemo(() => {
    const m = {};
    for (const r of allRows) if (r.key) m[r.key] = r.label;
    return m;
  }, [allRows]);

  // What a row can be opened up by. Same control, same rules and the same
  // ordering as the other two layouts — a reader who learns it on one
  // report should not have to learn it again here.
  const breakouts = useMemo(() => rowBreakouts(accountsData, budget),
                            [accountsData, budget]);
  const [breakoutKey, setBreakoutKey] = useState(null);
  const breakout = useMemo(() => {
    if (breakoutKey === "none") return null;
    if (breakoutKey) return breakouts.find(b => b.key === breakoutKey) || null;
    return defaultBreakout(accountsData, breakouts, budget);
  }, [breakoutKey, breakouts, accountsData, budget]);
  const breakoutActuals = useMemo(
    () => computeBreakoutActuals(accountsData?.entries || [], byTagValue, effectivePeriod,
                                 tagValuesAvailable, dimension, breakout),
    [accountsData, byTagValue, effectivePeriod, tagValuesAvailable, dimension, breakout]
  );
  const [openRows, setOpenRows] = useState(() => new Set());
  const toggleRow = (key) => setOpenRows(prev => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  const meta = budget?.workbook_meta;

  // Outline budgets mirror the client's own budget tab (sections, their
  // line items, their subtotals, their order) rather than a dept
  // crosstab — see BudgetActualsOutline. The dept crosstab machinery
  // above is inert for these.
  const viewKind = classifyBudgetView(viewKinds);
  const isOutline = viewKind === "by-line-item";
  const isAccounts = viewKind === "by-account";
  const isTagCrosstab = viewKind === "by-tag-crosstab";
  const isRecognizedView = viewKind != null;
  // The firm's own word for what its columns are. "By Department" was one
  // client's category leaking into every client's heading.
  const columnLabel = dimensionLabel(dimension);
  const columnLabelPlural = dimensionLabelPlural(dimension);
  const headingText = isAccounts ? "By Account"
                    : isOutline ? "By Line Item"
                    : isTagCrosstab ? `By ${columnLabel}`
                    : "Unsupported View";
  // The page title itself, sentence-case rather than the eyebrow-style
  // headingText above (still used for the export's pageLabel).
  const titleText = isAccounts ? "Budget by account"
                   : isOutline ? "Budget by line item"
                   : isTagCrosstab ? `Budget by ${columnLabel.toLowerCase()}`
                   : "Budget — unsupported view";

  return (
    <div id={BVA_EXPORT_ID}>
      {/* Prose keeps the page's old width. The tables below take the
          window — see AppShell's Capped. */}
      <Capped>
      <H1
        subhead="Budget vs actuals"
        actions={
          <div data-export-exclude>
            <ExportButton
              targetId={BVA_EXPORT_ID}
              entityName={snapshot?.firmName || "ManCo"}
              pageLabel={`Budget vs Actuals — ${headingText}`}
              asOf={snapshot?.asOf}
              filenameBase={`${slugify(snapshot?.firmName) || "manco"}-budget-vs-actuals`}
              events={{ click: "MancoReporting.BudgetVsActuals.ExportHtml",
                       succeeded: "MancoReporting.BudgetVsActuals.ExportHtmlSucceeded",
                       failed: "MancoReporting.BudgetVsActuals.ExportHtmlFailed" }}
            />
          </div>
        }
      >{titleText}</H1>
      <div style={styles.metaRow}>
        {!isTagCrosstab && !isOutline && !ownsPeriodControl(viewKind, budget) && (
          <span style={styles.metaChip}>
            {throughToday && canExtendToToday
              ? formatThroughTodayLabel(budget, snapshot?.asOf)
              : formatPeriodLabel(budget, snapshot?.asOf)}
          </span>
        )}
      </div>
      </Capped>


      {isAccounts && (
        <BudgetActualsAccounts
          budget={budget}
          entries={accountsData?.entries || []}
          drilldown={accountsData ? drilldown : null}
          accountsData={accountsData}
          asOf={snapshot?.asOf}
        />
      )}

      {isOutline && (
        <BudgetActualsOutline
          // One report per budget. Without a key React keeps ONE instance
          // across a tab switch, so the breakout, the opened rows and the
          // held cell followed the reader from one budget to the other —
          // and a filter they set on one sheet silently applied to a sheet
          // with different rows, different accounts and its own default.
          key={budget?.id || budget?.label}
          dimension={dimension}
          budget={budget}
          accountsData={accountsData}
          periodYear={budget?.period_year}
          drilldown={accountsData ? drilldown : null}
          asOf={snapshot?.asOf}
        />
      )}

      {isTagCrosstab && (
        <Capped data-export-exclude>
          <FilterRibbon>
            <FiltersMenu
              breakouts={breakouts}
              breakoutKey={breakout ? breakout.key : "none"}
              onBreakoutKey={(k) => { setBreakoutKey(k); setOpenRows(new Set()); }}
              departments={otherValues.length > TOP_VALUE_DEFAULT_N ? {
                label: columnLabelPlural,
                labelPlural: columnLabelPlural.toLowerCase(),
                topN: TOP_VALUE_DEFAULT_N,
                total: otherValues.length,
                showAll,
                onChange: setShowAll,
              } : undefined}
              hiddenRows={hiddenCountRows > 0 ? {
                count: hiddenCountRows,
                checked: showHidden,
                onChange: setShowHidden,
              } : undefined}
            />
            <span style={periodControlsStyles.spacer} />
            <SimplePeriodPicker
              options={[
                { id: "stated", label: shortPeriodLabel(budget) },
                ...(canExtendToToday ? [{ id: "ytd", label: "Year to date" }] : []),
              ]}
              value={throughToday && canExtendToToday ? "ytd" : "stated"}
              onChange={(id) => {
                trackClick("MancoReporting.BudgetVsActuals.ExtendThroughToday");
                setThroughToday(id === "ytd");
              }}
            />
          </FilterRibbon>
        </Capped>
      )}

      {isTagCrosstab && (
        <TableScroll>
          <table style={LEDGER_BASE}>
            <thead ref={setTheadEl}>
              <GroupedTableHead
                labelText="Line" labelMinWidth={240}
                groups={columns.map(col => ({ key: col.tag_value, label: col.tag_value }))}
                subCols={DEPT_SUB_COLS}
              />
            </thead>
            {stickyState.floating && (
              <StickyClone stickyState={stickyState}>
                <GroupedTableHead
                  labelText="Line" labelMinWidth={240}
                  groups={columns.map(col => ({ key: col.tag_value, label: col.tag_value }))}
                  subCols={DEPT_SUB_COLS}
                  colWidths={stickyState.colWidths} subWidths={stickyState.subWidths}
                  scrollLeft={stickyState.scrollLeft || 0}
                />
              </StickyClone>
            )}
            <tbody>
              {rows.map((row, i) => (
                <BudgetRow
                  key={row.key || `${row.account_type ?? "x"}::${row.account_name}::${i}`}
                  row={row}
                  columns={columns}
                  actualsByTagValue={actualsByTagValue}
                  actualsByKey={actualsByKey}
                  labelByKey={labelByKey}
                  glNames={glNames}
                  onDrill={drilldown?.openTagValueAccount}
                  period={effectivePeriod}
                  tagValuesAvailable={tagValuesAvailable}
                  dimension={dimension}
                  breakout={breakout}
                  breakoutActuals={breakoutActuals}
                  openRows={openRows}
                  onToggleRow={toggleRow}
                />
              ))}
            </tbody>
          </table>
        </TableScroll>
      )}

      {/* isOutline renders its own BudgetSourceLine internally — see BudgetActualsOutline.jsx. */}
      {isRecognizedView && !isOutline && (
        <Capped>
          <BudgetSourceLine
            meta={meta}
            fallback={isAccounts ? "Carta's stored budget" : "the source workbook"}
          />
        </Capped>
      )}

      {!isRecognizedView && (
        <Capped>
        <p style={styles.unsupportedView}>
          This budget declares {viewKinds.length
            ? <>a view Carta doesn&#39;t render yet: <code style={styles.code}>{viewKinds.join(", ")}</code></>
            : "no view at all"}. Rendering the department crosstab anyway would join
          actuals through a tag category that was never this workbook&#39;s axis, so
          nothing renders below until this axis is supported.
        </p>
        </Capped>
      )}
    </div>
  );
}

// Sub-columns for the shared GroupedTableHead (ui/table.jsx) — one repeated
// group of 4 per column: Actual, Budget, Var $, Var %.
export const DEPT_SUB_COLS = [
  { label: "Actual" },
  { label: "Budget" },
  { label: "Var $" },
  { label: "Var %" },
];

export function BudgetRow({ row, columns, actualsByTagValue, actualsByKey, labelByKey, onDrill, period, glNames,
                    tagValuesAvailable = true, breakout = null, breakoutActuals = null,
                    openRows = null, onToggleRow = null, dimension = null }) {
  const kind = row.row_kind || "line";
  const label = row.label ?? row.account_name;

  // Structural bands carry no figures of their own — they span the table.
  if (kind === "section_header" || kind === "group_header") {
    const isSection = kind === "section_header";
    return (
      <tr>
        <td
          colSpan={1 + columns.length * 4}
          style={{
            ...(isSection ? styles.sectionHeader : styles.groupHeader),
            paddingLeft: 12 + (row.depth || 0) * 14,
          }}
        >
          {/* Pinned inside the spanning cell: the band stretches the full
              table width, so its label would otherwise scroll out of view
              and leave an unlabelled stripe. */}
          <span style={styles.bandLabel}>{label}</span>
        </td>
      </tr>
    );
  }

  const isAggregate = kind === "subtotal" || kind === "total";
  const calc = row.calculated || null;
  // A leaf line with no GL has no path to Carta actuals. Showing $0
  // against a real budget would read as "we spent nothing", when the
  // truth is we can't tell — so the actual and its variance are withheld
  // and the row says why.
  const unmapped = !isAggregate
    && row.account_type == null
    && columnBudgets(row) != null;

  // Leaf lines sum Carta actuals across every GL the workbook line maps to
  // (col A = "4170, 4175"); aggregates were resolved from their
  // constituents upstream.
  const glCodes = row.account_type_all || (row.account_type != null ? [row.account_type] : []);
  const actualsFor = (deptName) => {
    if (!deptName) return 0;
    if (isAggregate) return actualsByKey[row.key]?.[deptName] || 0;
    const bucket = actualsByTagValue[deptName];
    if (!bucket) return 0;
    let sum = 0;
    for (const gl of glCodes) sum += (bucket[gl] || 0);
    return sum;
  };
  const budgetFor = (deptCol) => budgetOf(row, deptCol, label);

  // Row is highlighted (red/green) when the Firm-Total variance exceeds
  // the highlight threshold. We measure against Firm Total (last col
  // when present) so a big single-dept miss doesn't tint the whole row.
  const firmTotalCol = columns[columns.length - 1];
  // No row-level wash. It was computed off Firm Total while each cell
  // washed on its own figure, so a row could read green whole-firm while
  // containing red departments — two signals disagreeing on one line.
  // The cells carry it.
  const polarity = row.polarity || "expense";

  // Only a leaf line opens. A subtotal has no account of its own, so its
  // children would be the children of the lines beneath it, listed twice.
  const rowKey = row.key || `${row.account_type ?? "x"}::${label}`;
  const children = !isAggregate && breakout
    ? breakoutChildren(row, columns, breakoutActuals) : [];
  const expandable = worthBreakingOut(children);
  const isOpen = expandable && !!openRows?.has(rowKey);

  const rowStyle =
      kind === "total"    ? styles.trTotal
    : kind === "subtotal" ? styles.trSubtotal
    : LEDGER_ROW;
  const labelStyle =
      kind === "total"    ? styles.tdLabelTotal
    : kind === "subtotal" ? styles.tdLabelSubtotal
    : styles.tdLabel;

  const indent = 12 + (row.depth || 0) * 14;

  return (
    <>
    <tr>
      {/* No `position: "relative"` — the caret below is a flex child, not
          absolutely positioned, so nothing here needed it. It was
          overriding labelStyle's own `position: "sticky"`
          (tdLabel/tdLabelSubtotal/tdLabelTotal) and un-freezing the
          column on horizontal scroll. */}
      <td
        style={{ ...labelStyle, ...rowStyle, paddingLeft: indent }}
        title={label}
      >
        {/* Caret and label are one flex child, not two. This cell spaces its
            children apart, so a caret added beside the label would sit at
            the far edge of the column with the label pushed away from it.
            The caret hangs back into the cell's own padding, which keeps
            every label — opening or not — on one left edge. */}
        <span style={styles.labelGroup}>
          {expandable && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onToggleRow?.(rowKey); }}
              aria-expanded={isOpen}
              aria-label={`${isOpen ? "Hide" : "Show"} ${label} by ${breakout.label}`}
              style={{ ...styles.rowCaret,
                       transform: isOpen ? "rotate(90deg)" : "none" }}
            >
              ▸
            </button>
          )}
        {/* The accounts behind a line live on its own tooltip — see the
            outline's label cell for why the codes left this column. */}
        <HoverTip text={row.account_type != null
                        ? glTooltip(row.account_type_all || [row.account_type], glNames)
                        : null}>
          {label}
        </HoverTip>
        </span>
        {calc && <CalcMarker calc={calc} labelByKey={labelByKey} />}
        {unmapped && (
          <span
            style={styles.unmapped}
            title="No Carta GL account maps to this budget line, so actuals can't be resolved for it."
          >
            unmapped
          </span>
        )}
        {isAggregate && !calc && (
          <span
            style={styles.calcMuted}
            title="The workbook totals this row, but its formula isn't recoverable from the file — the cell is typed, or computed on another sheet."
          >
            total
          </span>
        )}
      </td>
      {columns.map(col => {
        const budget = budgetFor(col);
        const actual = actualsFor(col.tag_value);
        const comment = commentOf(row, col.tag_value)
                        ?? col.comments_by_account?.[label] ?? null;

        // Aggregates aren't drillable: there's no single account behind
        // them, and opening a journal-entry list against a subtotal would
        // imply entries post there. Their provenance is the marker above.
        const canDrill = onDrill && !isAggregate && row.account_type != null
                         && (actual !== 0 || budget !== 0 || !!comment);
        // No tag data: the cell showed firm-wide actuals, so drill the
        // same way rather than filtering by a tag that never matched.
        const cartaTags = tagValuesAvailable ? col.carta_tags : [];
        const onClick = canDrill
          ? () => onDrill(col.tag_value, label, row.account_type,
                          row.account_type_all, comment, cartaTags,
                          { budget, actual, polarity, unmapped }, period,
                          null, null, dimension)
          : undefined;
        return (
          <BudgetCell
            key={col.tag_value}
            actual={actual}
            budget={budget}
            comment={comment}
            unmapped={unmapped}
            polarity={polarity}
            formula={(calc?.formula_by_column ?? calc?.formula_by_dept)?.[col.tag_value] || null}
            onClick={onClick}
            rowStyle={rowStyle}
          />
        );
      })}
    </tr>
    {isOpen && children.map(child => (
      <tr key={`${rowKey}::${child.label}`}>
        <td style={{ ...styles.tdLabel, ...LEDGER_ROW, paddingLeft: indent + 16 }}>
          <span style={child.unlabelled ? styles.childMuted : null}>
            {child.unlabelled ? noValueLabel(breakout) : child.label}
          </span>
        </td>
        {columns.map(col => (
          <ChildCells key={col.tag_value} actual={child.totals[col.tag_value] || 0} />
        ))}
      </tr>
    ))}
    </>
  );
}

// A child's four cells. Only the actual is real: the workbook budgeted the
// line above, not the values inside it, so Budget and both variances are
// withheld rather than shown as zero — a zero budget beside real spend
// reads as overspend the firm never incurred.
function ChildCells({ actual }) {
  const num = { ...styles.tdNum, ...LEDGER_ROW, ...styles.childNum };
  const firstNum = { ...num, ...styles.tdNumFirst };
  return (
    <>
      <td style={firstNum}>{actual ? fmtCurrencyWhole(actual) : "—"}</td>
      <td style={num}>—</td>
      <td style={num}>—</td>
      <td style={num}>—</td>
    </>
  );
}

// Marks a row the workbook computes, and says from what. The label is the
// affordance; the detail — the literal cell formula and the rows it names —
// rides on the tooltip so the table stays readable at 90+ rows.
function CalcMarker({ calc, labelByKey }) {
  const names = (calc.constituents || [])
    .map(k => labelByKey[k])
    .filter(Boolean);
  let reads;
  if (calc.expression) {
    reads = calc.expression
      .map(t => (t.op ? OP_GLYPH[t.op] || t.op : labelByKey[`r${t.row}`] || `row ${t.row}`))
      .join(" ");
  } else {
    reads = names.join("  +  ");
  }
  const sample = Object.values(calc.formula_by_column || calc.formula_by_dept || {})[0];
  const title = [
    "Calculated by the workbook, not entered.",
    reads && `= ${reads}`,
    sample && `Formula in the source tab: ${sample}`,
  ].filter(Boolean).join("\n\n");
  // A glyph, not a chip. This applies to every total on the sheet, and a
  // pill on each one competes with the figures. Matches the weight and
  // colour of the "*" budget-note marker already used in this table.
  return (
    <span style={styles.calcGlyph} title={title} aria-label="Calculated by the workbook">
      {calc.kind === "expression" ? "\u0192" : "\u2211"}
    </span>
  );
}

const OP_GLYPH = { "-": "−", "+": "+", "*": "×", "/": "÷" };

// Budget for a (row, column). Outline rows carry their own per-column map;
// older snapshots kept the figure on the column's by_account map instead,
// so both are read here.
// A row's per-column budgets. `by_dept` is the same field under its old
// name — a snapshot built before the rename still carries it, and reading
// both here keeps the rest of this file on one spelling.
function columnBudgets(row) {
  return row?.by_column ?? row?.by_dept ?? null;
}

function budgetOf(row, col, label) {
  if (!col) return 0;
  const budgets = columnBudgets(row);
  if (budgets) {
    const v = budgets[col.tag_value]?.budget;
    return typeof v === "number" ? v : 0;
  }
  return col.by_account?.[label] ?? 0;
}

function commentOf(row, columnName) {
  const budgets = columnBudgets(row);
  if (!columnName || !budgets) return null;
  return budgets[columnName]?.comment ?? null;
}

function BudgetCell({ actual, budget, comment, unmapped, polarity, onClick, rowStyle }) {
  const variance = actual - budget;
  const pct = budget !== 0 ? variance / budget : null;
  // Colour lives on the variance figures alone. Washing cells as well
  // put four tinted blocks behind every department on every row, which
  // reads as a heat map of the whole sheet rather than a pointer to the
  // lines that moved.
  const cellStyle = { ...styles.tdNum, ...rowStyle };
  if (onClick) cellStyle.cursor = "pointer";
  const firstCellStyle = { ...cellStyle, ...styles.tdNumFirst };
  // Same hover wash as the other budget tables (theme.js .cellopen).
  const handler = onClick ? { onClick, className: "cellopen" } : {};
  // Note glyph: superscript speech-bubble style; native title tooltip shows
  // the full comment on hover (drawer callout renders it in full on click).
  const noteTitle = comment ? `Note: ${comment}` : undefined;
  if (unmapped) {
    return (
      <>
        <td style={firstCellStyle} title="No Carta GL mapped — actual unavailable">—</td>
        <td style={cellStyle}>
          {budget === 0 ? "—" : fmtCurrencyWhole(budget)}
          {comment && (
            <span style={styles.noteGlyph} title={noteTitle} aria-label="Has budget note">*</span>
          )}
        </td>
        <td style={cellStyle}>—</td>
        <td style={cellStyle}>—</td>
      </>
    );
  }
  return (
    <>
      <td {...handler} style={firstCellStyle}>
        {actual === 0 && budget === 0 ? "—" : fmtCurrencyWhole(actual)}
      </td>
      <td {...handler} style={cellStyle}>
        {budget === 0 ? "—" : fmtCurrencyWhole(budget)}
        {comment && (
          <span style={styles.noteGlyph} title={noteTitle} aria-label="Has budget note">*</span>
        )}
      </td>
      <td {...handler} style={{ ...cellStyle, color: varianceColor(variance, polarity) }}>
        {actual === 0 && budget === 0 ? "—" : fmtVarianceWhole(variance)}
      </td>
      <td {...handler} style={{ ...cellStyle,
                                color: pct == null ? FAINT : varianceColor(variance, polarity) }}>
        {pct == null ? "—" : `${(pct * 100).toFixed(0)}%`}
      </td>
    </>
  );
}

// -----------------------------------------------------------------------

function buildRowAxis(byTagValue, firmTotal) {
  // If Firm Total is present, its by_account map already orders the rows
  // per the workbook's natural order (income first, then expense sections).
  // We iterate its keys and enrich with each row's account_type from
  // account_type_by_name and account_type_all_by_name (populated by
  // build_manco_datadir.py).
  const base = firmTotal || byTagValue[0];
  if (!base) return [];
  const nameToType = base.account_type_by_name || {};
  const nameToAll  = base.account_type_all_by_name || {};
  const seen = new Set();
  const out = [];
  const push = (name, type, all) => {
    out.push({
      account_name: name,
      account_type: type ?? null,
      account_type_all: all && all.length ? all : (type != null ? [type] : null),
    });
  };
  for (const name of Object.keys(base.by_account || {})) {
    if (seen.has(name)) continue;
    seen.add(name);
    push(name, nameToType[name], nameToAll[name]);
  }
  // Include names that appear in dept-level maps but not Firm Total
  // (rare; happens when a dept had a stray line the workbook didn't
  // aggregate). Attach them at the bottom.
  for (const dept of byTagValue) {
    if (dept === base) continue;
    const nToT = dept.account_type_by_name || {};
    const nToA = dept.account_type_all_by_name || {};
    for (const name of Object.keys(dept.by_account || {})) {
      if (seen.has(name)) continue;
      seen.add(name);
      push(name, nToT[name], nToA[name]);
    }
  }
  return out;
}

// A compact month-range label for the Period dropdown's "stated window"
// option — "Jan – Jun 2026", not the fuller day-level formatPeriodLabel text.
function shortPeriodLabel(budget) {
  const first = budget?.period?.first_month ?? 1;
  const last = budget?.period?.last_month ?? 12;
  const yr = budget?.period_year || budget?.workbook_meta?.period_year;
  return `${MONTH_NAME[first - 1]} – ${MONTH_NAME[last - 1]}${yr ? ` ${yr}` : ""}`;
}

// Labels the widened window plainly once the reader opts into it — the
// figures on screen now cover more than the tab's own stated period.
function formatThroughTodayLabel(budget, asOfIso) {
  const firstMonth = budget?.period?.first_month ?? 1;
  const [y, m, d] = String(asOfIso || "").split("-").map(Number);
  if (!y || !m) return "Period: through today";
  return `Period: ${MONTH_NAME[firstMonth - 1]} 1 – ${MONTH_NAME[m - 1]} ${d}, ${y} (through today)`;
}

// Resolve an actual for every aggregate row by summing the rows its
// formula names. Constituents can themselves be aggregates — a section
// total sums subtotals which sum lines — so this recurses, memoizing as it
// goes. A row referencing itself (directly or through a cycle) resolves to
// what it has rather than recursing forever; malformed provenance should
// degrade to a visibly wrong number, not a hung page.
// Per-constituent sign for a derived row. Pure sums are all +1; an
// expression carries its operators, so "=D12-D130" marks the second
// operand negative. Operators we can't fold into a running total
// (multiplication, division) leave the operand at +1 — the figure will be
// wrong, but visibly so, rather than silently dropped.
function expressionSigns(calc) {
  const signs = {};
  if (!calc?.expression) return signs;
  let sign = 1;
  for (const tok of calc.expression) {
    if (tok.op) {
      if (tok.op === "-") sign = -1;
      else if (tok.op === "+") sign = 1;
      continue;
    }
    signs[`r${tok.row}`] = sign;
    sign = 1;
  }
  return signs;
}

function computeActualsByKey(rows, actualsByTagValue) {
  const byKey = {};
  for (const r of rows) if (r.key) byKey[r.key] = r;

  const leafActuals = (row) => {
    const gls = row.account_type_all || (row.account_type != null ? [row.account_type] : []);
    const out = {};
    for (const [dept, bucket] of Object.entries(actualsByTagValue)) {
      let sum = 0;
      for (const gl of gls) sum += (bucket[gl] || 0);
      if (sum) out[dept] = sum;
    }
    return out;
  };

  const memo = {};
  const inFlight = new Set();
  const resolve = (key) => {
    if (memo[key]) return memo[key];
    const row = byKey[key];
    if (!row) return {};
    if (inFlight.has(key)) return leafActuals(row);
    inFlight.add(key);
    const constituents = row.calculated?.constituents || [];
    let out;
    if (!constituents.length) {
      out = leafActuals(row);
    } else {
      // Signs come from the workbook's own formula. A net-income row
      // subtracts its expense total; summing its inputs would report
      // income plus expenses as the actual, which is not a number that
      // means anything.
      const signs = expressionSigns(row.calculated);
      out = {};
      for (const ck of constituents) {
        const child = byKey[ck];
        if (!child) continue;
        const sign = signs[ck] ?? 1;
        const vals = child.calculated?.constituents?.length
          ? resolve(ck)
          : leafActuals(child);
        for (const [dept, v] of Object.entries(vals)) {
          out[dept] = (out[dept] || 0) + sign * v;
        }
      }
    }
    inFlight.delete(key);
    memo[key] = out;
    return out;
  };

  const result = {};
  for (const r of rows) {
    if (r.key && (r.row_kind === "subtotal" || r.row_kind === "total")) {
      result[r.key] = resolve(r.key);
    }
  }
  return result;
}

export function computeActualsByTagValue(entries, byTagValue, period, tagValuesAvailable = true,
                                     dimension = null) {
  // Only the months the budget covers. A budget stated through June
  // charged with spend through August reads over budget by everything
  // that came after it — the variance is the calendar, not the firm.
  // Shapes that state no period get every month, as before.
  const first = period?.first_month ?? 1;
  const last = period?.last_month ?? 12;
  //
  // For each column, sum entries whose value for the firm's own dimension
  // matches any entry in col.carta_tags (from the coa-mapping when
  // supplied; otherwise the column's own name as identity). Firm Total
  // (carta_tags: []) sums every entry regardless of value.
  //
  // Precompute reverse index tag_value → [workbook_dept, ...] so we walk
  // entries once instead of scanning every dept's carta_tags per entry.
  const out = {};
  const tagToDepts = new Map(); // carta tag → [workbook_dept, ...]
  const firmTotalDepts = []; // depts with carta_tags: [] (Firm Total)
  for (const col of byTagValue) {
    out[col.tag_value] = {};
    const tags = col.carta_tags || [];
    // No tag data at all would sum every tag-matching dept to $0 — treat
    // every dept as Firm-Total-shaped instead (firm-wide fallback).
    if (tags.length === 0 || !tagValuesAvailable) {
      firmTotalDepts.push(col.tag_value);
    } else {
      for (const t of tags) {
        if (!tagToDepts.has(t)) tagToDepts.set(t, []);
        tagToDepts.get(t).push(col.tag_value);
      }
    }
  }
  for (const e of entries) {
    const t = e.acct_type;
    if (t == null) continue;
    if (typeof e.mo === "number" && (e.mo < first || e.mo > last)) continue;
    // Firm-Total-shaped depts: every entry contributes.
    for (const dept of firmTotalDepts) {
      out[dept][t] = (out[dept][t] || 0) + (e.amount || 0);
    }
    // Value-matching columns: read the entry's value for this firm's
    // dimension and hit every column whose carta_tags include it.
    const v = dimensionValue(e, dimension);
    const deptTag = v != null ? { value: v } : null;
    if (!deptTag) continue;
    const depts = tagToDepts.get(deptTag.value);
    if (!depts) continue;
    for (const dept of depts) {
      out[dept][t] = (out[dept][t] || 0) + (e.amount || 0);
    }
  }
  return out;
}

/** Actuals per (breakout value × column), for opening a row up.
 *
 *  Partitions the entries by the chosen breakout and runs each partition
 *  through the very same column join the parent rows use — a child that
 *  totalled differently from the row above it would be worse than no
 *  child at all.
 *
 *  Actuals only. The workbook budgets the line, not the vendors inside it;
 *  splitting one budget across children invents a variance per child that
 *  the firm never planned.
 */
export function computeBreakoutActuals(entries, byTagValue, period, tagValuesAvailable,
                                       dimension, breakout) {
  if (!breakout) return null;
  const parts = new Map();
  for (const e of entries || []) {
    const v = dimensionValue(e, breakout) || UNLABELLED;
    if (!parts.has(v)) parts.set(v, []);
    parts.get(v).push(e);
  }
  const out = {};
  for (const [value, part] of parts) {
    out[value] = computeActualsByTagValue(part, byTagValue, period, tagValuesAvailable, dimension);
  }
  return out;
}

/** The children worth showing under one row, biggest first.
 *
 *  Ranked on the row's own last column (Firm Total when the workbook has
 *  one) so the order matches the figure the reader is scanning.
 */
export function breakoutChildren(row, columns, breakoutActuals) {
  if (!breakoutActuals) return [];
  const glCodes = row.account_type_all || (row.account_type != null ? [row.account_type] : []);
  if (!glCodes.length) return [];
  const rankCol = columns[columns.length - 1]?.tag_value;
  const out = [];
  for (const [value, byCol] of Object.entries(breakoutActuals)) {
    let any = false;
    const totals = {};
    for (const col of columns) {
      const bucket = byCol[col.tag_value] || {};
      let sum = 0;
      for (const gl of glCodes) sum += bucket[gl] || 0;
      totals[col.tag_value] = sum;
      if (sum) any = true;
    }
    if (any) out.push({ label: value, totals, unlabelled: value === UNLABELLED });
  }
  // Unlabelled last: it is a gap in the data, not a peer of the values.
  return out.sort((a, b) => (a.unlabelled ? 1 : 0) - (b.unlabelled ? 1 : 0)
                         || Math.abs(b.totals[rankCol] || 0) - Math.abs(a.totals[rankCol] || 0));
}

export const styles = {
  // Row under H1 holding the account-view period chip, when applicable.
  metaRow: {
    ...sans,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16,
    marginTop: 6,
    marginBottom: 10,
    flexWrap: "wrap",
  },
  metaChip: {
    fontSize: FS.body,
    fontWeight: 500,
    color: INK,
    padding: "3px 9px",
    borderRadius: 4,
    background: SHADE,
    fontVariantNumeric: "tabular-nums",
    whiteSpace: "nowrap",
  },
  // Loud on purpose — an unrecognized axis rendering nothing must read as
  // a gap to fill, not a quiet page that happens to be empty.
  unsupportedView: {
    ...sans,
    fontSize: FS.bodyLg,
    lineHeight: 1.5,
    color: RED,
    border: `1px solid ${LINE}`,
    borderRadius: 4,
    padding: "14px 18px",
    marginTop: 4,
    marginBottom: 20,
    maxWidth: 720,
  },
  code: {
    ...sans,
    fontSize: FS.body,
    padding: "1px 5px",
    borderRadius: 3,
    background: SHADE,
    color: INK,
  },
  labelGroup: { display: "inline-flex", alignItems: "center", gap: 4, minWidth: 0 },
  // Hangs back into the cell's padding so the label beside it starts where
  // every other label starts.
  rowCaret: {
    ...sans, width: 14, marginLeft: -14, flex: "0 0 auto",
    border: "none", background: "transparent", color: MICRO, cursor: "pointer",
    padding: 0, fontSize: FS.micro, lineHeight: 1, textAlign: "left",
    transition: "transform 120ms",
  },
  // Children sit under the line they belong to: same figures, quieter, so
  // the row above stays the one being read.
  childNum: { color: FAINT },
  childMuted: { color: MICRO, fontStyle: "italic" },
  // Flex is this table's own: the label pairs a name with trailing GL codes.
  tdLabel: {
    ...LEDGER_LABEL,
    display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12,
  },
  glCode: {
    fontSize: FS.micro,
    color: MICRO,
    fontVariantNumeric: "tabular-nums",
  },
  // Outline rows. Weight carries the hierarchy — line 400, subtotal 600,
  // total 700 — matching the ladder the by-line-item view established so
  // the two pages read the same way.
  sectionHeader: LEDGER_SECTION,
  groupHeader: {
    ...sans, fontSize: FS.value, fontWeight: 600, color: INK,
    padding: "8px 12px 4px", textAlign: "left",
  },
  trSubtotal: LEDGER_ROW,
  // Blue wash + 500-weight — Ink's real `.ink-table tr.is-total` recipe
  // (see ui/table.jsx's TOTAL_ROW_BG), matching BudgetActualsOutline's own
  // total-row treatment now that both tables share the same shell.
  trTotal:    LEDGER_TOTAL,
  tdLabelSubtotal: {
    ...sans, fontSize: FS.value, lineHeight: "24px", fontWeight: 500, color: INK,
    padding: "10px 12px", textAlign: "left",
    position: "sticky", left: 0, background: PAPER, zIndex: 1,
    borderRight: `1px solid ${LINE}`, whiteSpace: "nowrap",
    display: "flex", justifyContent: "space-between", alignItems: "center",
    gap: 12, minWidth: 240,
  },
  tdLabelTotal: {
    ...sans, fontSize: FS.value, lineHeight: "24px", fontWeight: 500, color: INK,
    padding: "10px 12px", textAlign: "left",
    position: "sticky", left: 0, background: TOTAL_ROW_BG, zIndex: 1,
    borderRight: `1px solid ${LINE}`, whiteSpace: "nowrap",
    display: "flex", justifyContent: "space-between", alignItems: "center",
    gap: 12, minWidth: 240,
  },
  // Provenance marker on a derived row. Regular weight and a tone-matched
  // border, per the shared Tag contract — it labels the row, it isn't a
  // status shout.
  bandLabel: { position: "sticky", left: 12, display: "inline-block" },
  calcGlyph: {
    ...sans, fontSize: FS.body, color: MICRO, cursor: "help",
    fontWeight: 400, lineHeight: 1,
  },
  unmapped: { ...sans, ...microCaption, color: MICRO },
  calcMuted: { ...sans, ...microCaption, color: MICRO },
  // borderLeft is this table's own: it repeats per department, so the
  // columns need the boundary its header row draws.
  tdNum: LEDGER_NUM,
  // Only a column's first cell (Actual) carries the divider — continues
  // the header's own group divider, one per tag rather than per sub-column.
  tdNumFirst: { borderLeft: `1px solid ${LINE}` },

  // Subtle superscript glyph in the Budget column when a workbook Comments
  // cell exists for this (row × dept). Full comment renders in the drawer;
  // native title attribute exposes it on hover too. Ink link/focus blue to
  // hint at "there's more info here" without shouting.
  noteGlyph: {
    marginLeft: 3,
    fontSize: FS.small,
    // MICRO grey, not blue. Blue is reserved for links and focus, and this
    // marker sits inside a Budget figure — colouring it like a link invites
    // a click that does nothing, and undercuts the convention the rest of
    // the table leans on. A note marker only has to be findable.
    color: MICRO,
    fontWeight: 600,
    verticalAlign: "super",
    lineHeight: 0,
    cursor: "help",
  },
};
