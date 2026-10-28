import { sans, LINE, FAINT, FS, INK } from "../../ui/theme.js";
import { TableScroll, LEDGER_BASE, GroupedTableHead, drillCellProps } from "../../ui/table.jsx";
import { LEDGER_SECTION } from "../../ui/ledger.js";
import { ACCOUNT_LABEL_MIN_WIDTH } from "../accountSections.js";
import { Chevron as RowCaret, S as ACCOUNT_TABLE } from "../BudgetActualsAccounts.jsx";
import { ROW_TOTAL_KEY, TOTAL_KEY, VALUE_FIELDS } from "./pivot.js";

// Geometry of the account table this grid borrows: a row level indents one child step past its
// parent, and the caret hangs in the label's own left padding.
const CARET_GUTTER = ACCOUNT_TABLE.tdLabel.paddingLeft;
const INDENT_STEP = ACCOUNT_TABLE.childLabel.paddingLeft - ACCOUNT_TABLE.tdLabel.paddingLeft;

// Worded from the Values the builder offers.
const VALUE_LABELS = Object.values(VALUE_FIELDS).map(f => f.label);
const VALUES_PROMPT = `Tick ${VALUE_LABELS.slice(0, -1).join(", ")} or ${VALUE_LABELS.at(-1)} under Values to see numbers.`;

// The report grid, shared between "report" and "configure" modes so a
// save never changes what the numbers look like — only the chrome around it.
// Measure split renders as sub-columns under each period — Actual, Budget,
// Var $ side by side, the same shape Budget vs Actuals itself renders.
export function ReportGrid({ rowFieldLabel, visibleRows, visibleCols, colLabels, zones, showTotal, interactive,
                      sortCol, sortDir, toggleSort, hideRow, hideCol, toggleCollapse, collapsedKeys,
                      cellsFor, footerCellsFor, sections, onDrillCell, hoverCell, onHoverCell, heldCell }) {
  if (zones.values.length === 0) {
    return (
      <p style={styles.empty}>
        {VALUES_PROMPT}
      </p>
    );
  }

  // Rows read as Budget vs Actuals' account table does: the caret hangs in the label's
  // gutter, and a child row is indented one step further with faint figures.
  function renderRow(node) {
    const expandable = !!node.children?.length;
    const indent = ACCOUNT_TABLE.tdLabel.paddingLeft + node.depth * INDENT_STEP;
    const cells = (colKey, clickable) => {
      const cellKey = `${node.key}::${colKey}`;
      return (
        <ValueCells key={colKey} cells={cellsFor(node, colKey)} child={node.depth > 0}
                    onClick={clickable ? () => onDrillCell(node, colKey) : undefined}
                    hovered={hoverCell === cellKey} held={heldCell === cellKey}
                    onHover={clickable ? (on) => onHoverCell?.(on ? cellKey : null) : undefined} />
      );
    };
    return (
      <tr key={node.key}>
        <td style={{ ...ACCOUNT_TABLE.tdLabel, ...ACCOUNT_TABLE.trLine, paddingLeft: indent }}>
          {expandable && (
            <span style={{ ...styles.caretSlot, left: indent - CARET_GUTTER }}>
              <RowCaret open={!collapsedKeys.has(node.key)} label={node.value} by={rowFieldLabel}
                       onClick={() => toggleCollapse(node.key)} />
            </span>
          )}
          <span style={ACCOUNT_TABLE.labelText}>{node.value}</span>
          {interactive && (
            <button type="button" onClick={() => hideRow(node.key)} style={styles.hideBtn}
                    title={`Hide row: ${node.value}`}>&times;</button>
          )}
        </td>
        {visibleCols.map(c => cells(c, !!onDrillCell && node.data.has(c)))}
        {showTotal && cells(ROW_TOTAL_KEY, !!onDrillCell && visibleCols.some(c => node.data.has(c)))}
      </tr>
    );
  }

  const subCols = zones.values.map(vf => ({ label: VALUE_FIELDS[vf]?.label || vf }));
  const n = subCols.length;
  const colSpan = 1 + visibleCols.length * n + (showTotal ? n : 0);

  return (
    <TableScroll>
      <table style={LEDGER_BASE}>
        <thead>
          <GroupedTableHead
            labelText={rowFieldLabel} labelMinWidth={ACCOUNT_LABEL_MIN_WIDTH}
            groups={[
              ...visibleCols.map(c => ({
                key: c,
                label: interactive ? (
                  <ColHeadLabel c={c} label={colLabels.get(c) || c} sortCol={sortCol} sortDir={sortDir}
                                toggleSort={toggleSort} hideCol={hideCol} />
                ) : (colLabels.get(c) || c),
              })),
              ...(showTotal ? [{ key: TOTAL_KEY + "group", label: "Total" }] : []),
            ]}
            subCols={subCols}
          />
        </thead>
        <tbody>
          {sections ? sections.map(sec => (
            <SectionRows key={sec.title} section={sec} colSpan={colSpan} renderRow={renderRow}
                         visibleCols={visibleCols} showTotal={showTotal} />
          )) : visibleRows.map(renderRow)}
          {visibleRows.length === 0 && (
            <tr>
              <td colSpan={colSpan} style={styles.empty}>
                Add a field to Rows to start building your view.
              </td>
            </tr>
          )}
        </tbody>
        {visibleRows.length > 0 && !sections && (
          <tfoot>
            <TotalRow label="Total" cellsFor={footerCellsFor} visibleCols={visibleCols} showTotal={showTotal} />
          </tfoot>
        )}
      </table>
    </TableScroll>
  );
}

// One income-statement section: its band, its rows, and "Total <section>" — the shape
// Budget vs Actuals' own account table gives the same accounts.
export function SectionRows({ section, colSpan, renderRow, visibleCols, showTotal }) {
  return (
    <>
      <tr>
        <td colSpan={colSpan} style={LEDGER_SECTION}>
          <span style={ACCOUNT_TABLE.bandLabel}>{section.title}</span>
        </td>
      </tr>
      {section.rows.map(renderRow)}
      <TotalRow label={`Total ${section.title}`} cellsFor={section.cellsFor} visibleCols={visibleCols} showTotal={showTotal} />
    </>
  );
}

// A total row, styled as "Total Income" is on Budget vs Actuals' account table.
export function TotalRow({ label, cellsFor, visibleCols, showTotal }) {
  return (
    <tr>
      <td style={{ ...ACCOUNT_TABLE.tdLabel, ...ACCOUNT_TABLE.totalCell }}>{label}</td>
      {visibleCols.map(c => <ValueCells key={c} cells={cellsFor(c)} total />)}
      {showTotal && <ValueCells cells={cellsFor(ROW_TOTAL_KEY)} total />}
    </tr>
  );
}

export function ColHeadLabel({ c, label, sortCol, sortDir, toggleSort, hideCol }) {
  return (
    <div style={styles.colHeadInGroup}>
      <button type="button" onClick={() => toggleSort(c)} style={styles.sortBtn}
              title={sortCol === c ? (sortDir === -1 ? "Sort ascending" : "Remove sort") : "Sort descending"}>
        {label}
        {sortCol === c && <span style={styles.sortArrow}>{sortDir === -1 ? " ↓" : " ↑"}</span>}
      </button>
      <button type="button" onClick={() => hideCol(c)} style={styles.hideBtn} title={`Hide column: ${label}`}>&times;</button>
    </div>
  );
}

// One row's worth of sub-columns (Actual / Budget / Var $, whichever are in
// Values) for a single period — mirrors Budget vs Actuals' own cell triplet.
// A shared onClick spans every sub-column of one figure, same as
// BudgetActualsView's BudgetCell — they're one drill, not three.
export function ValueCells({ cells, total, child, onClick, hovered, held, onHover }) {
  const numStyle = total
    ? { ...ACCOUNT_TABLE.tdNum, ...ACCOUNT_TABLE.totalCell, ...ACCOUNT_TABLE.tdNumStrong }
    : { ...ACCOUNT_TABLE.tdNum, ...ACCOUNT_TABLE.trLine, ...(child ? ACCOUNT_TABLE.childNum : null),
        ...(onClick ? ACCOUNT_TABLE.clickable : null) };
  const handler = drillCellProps({ onClick, hovered, held, onHover });
  return (
    <>
      {cells.map((cell, i) => (
        <td key={i} {...handler}
            style={{ ...numStyle, ...(i === 0 ? { borderLeft: `1px solid ${LINE}` } : null),
                     ...(cell.color ? { color: cell.color } : null) }}>
          {cell.text}
        </td>
      ))}
    </>
  );
}

const styles = {
  empty: { ...sans, fontSize: FS.bodyLg, color: FAINT, padding: "24px 12px" },
  caretSlot: { position: "absolute", top: 0, bottom: 0, width: CARET_GUTTER },
  colHeadInGroup: { display: "flex", alignItems: "center", justifyContent: "center", gap: 4 },
  sortBtn: {
    ...sans, fontSize: FS.value, fontWeight: 600, color: INK, background: "none",
    border: "none", padding: 0, cursor: "pointer", whiteSpace: "nowrap",
  },
  sortArrow: { color: FAINT, fontWeight: 400 },
  hideBtn: {
    ...sans, fontSize: FS.bodyLg, color: FAINT, background: "none", border: "none",
    padding: "0 2px", cursor: "pointer", lineHeight: 1, flexShrink: 0, opacity: 0.5,
  },
};
