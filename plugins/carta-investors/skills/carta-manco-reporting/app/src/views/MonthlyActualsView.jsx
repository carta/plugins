import { Fragment, useMemo, useRef, useState } from "react";
import { sans, FAINT, FS } from "../ui/theme.js";
import { H1 } from "../ui/components.jsx";
import { fmtCurrencyWhole } from "../charts/chartTheme.js";
import { glNameMap, glTooltip, subCodeMap } from "../ui/glNames.js";
import HoverTip from "../ui/HoverTip.jsx";
import ExportButton from "../ui/ExportButton.jsx";
import ThemeToggleButton from "../ui/ThemeToggleButton.jsx";
import AskClaudeButton from "../ui/AskClaudeButton.jsx";
import { exportPropsFor } from "../ui/exportHtml.js";
import {
  TableScroll, LEDGER_BASE, useStickyHeader, StickyClone, GroupedTableHead,
} from "../ui/table.jsx";
import { LEDGER_NUM, LEDGER_ROW, LEDGER_TOTAL, LEDGER_SUMMARY, LEDGER_SECTION } from "../ui/ledger.js";
import {
  periodColumns, ytdColumn, trueAsOfMonth, cellFor, sumCells, cutoffDate, normalizeRange, labelWindow,
} from "./budgetPeriods.js";
import { prefsKeyFor } from "./budgetPrefs.js";
import { accountSections, actualByGlByMonth, accountLabel, ACCOUNT_LABEL_MIN_WIDTH } from "./accountSections.js";
import { rowBreakouts, breakoutByColumns, worthBreakingOut, opensAnything } from "./accountBreakout.js";
import BudgetPeriodControls from "./BudgetPeriodControls.jsx";
import {
  Chevron, ChildRow, pickBreakout, useOpenRows, S as ACCOUNT_S,
} from "./BudgetActualsAccounts.jsx";
import useAccountToolbar from "./useAccountToolbar.js";

const EXPORT_ID = "manco-export-monthly-actuals";
// Its own saved toolbar, apart from any budget's: this report has no
// columns to hide, and a firm that later loads a budget opens that report
// on its own defaults.
const PREFS_ID = "monthly-actuals";
const FULL_YEAR = Object.freeze({ first: 1, last: 12 });

// One section's total for one column — what its "Total <section>" row shows,
// and what Net Income is built from, so the two can never disagree.
function sectionTotal(rows, col, actualsByMonth) {
  return sumCells(rows.map((r) => cellFor(r, col, actualsByMonth))).actual;
}

// GL account actuals by month, for a firm with nothing budgeted — the one
// axis a Carta-sourced budget has too, minus the budget and variance
// columns that firm has none of. Stands in for Budget vs Actuals while this
// firm has no budget loaded, in Carta or a workbook.
export default function MonthlyActualsView({ snapshot, accountsData, drilldown, dark, onToggleTheme, chatOpen, onToggleChat }) {
  const asOf = snapshot?.asOf;
  const year = Number(String(asOf || "").slice(0, 4)) || new Date().getFullYear();
  const asOfMonth = trueAsOfMonth(cutoffDate(snapshot));
  const entries = accountsData?.entries || [];

  const actualsByMonth = actualByGlByMonth(entries);
  const nameByGl = glNameMap(entries);
  const subCodes = subCodeMap(entries);

  const rows = Array.from(actualsByMonth, ([gl]) => ({
    label: accountLabel(gl, nameByGl),
    account_type: gl,
    gl_codes: [gl],
  }));
  const sections = accountSections(rows);

  // The same toolbar Budget vs Actuals' account view has, less the Columns
  // pane: with no budget there is no budget or variance column to hide.
  const breakouts = useMemo(() => rowBreakouts(accountsData, null), [accountsData]);
  const { filters, setFilters, range, setRange, breakoutKey, setBreakoutKey } = useAccountToolbar({
    prefsKey: prefsKeyFor(accountsData, PREFS_ID),
    year, asOfMonth, defaultRange: FULL_YEAR, breakouts,
  });
  const breakout = useMemo(
    () => pickBreakout(breakouts, accountsData, null, breakoutKey),
    [breakoutKey, breakouts, accountsData]);
  const window = normalizeRange(range);

  const periodCols = periodColumns(filters.frequency, window, year, asOfMonth);
  const ytd = filters.showYtd ? ytdColumn(window, year, asOfMonth, periodCols) : null;
  const columns = ytd ? [...periodCols, ytd] : periodCols;

  const [theadEl, setTheadEl] = useState(null);
  const stickyState = useStickyHeader(theadEl);
  const scrollRef = useRef(null);

  const exportProps = exportPropsFor(snapshot, {
    targetId: EXPORT_ID, pageLabel: "Actuals by GL account",
    slug: "actuals-by-gl-account", eventPage: "MonthlyActuals",
  });

  return (
    <div id={EXPORT_ID}>
      <H1
        subhead="Monthly actuals"
        actions={
          <div data-export-exclude style={{ display: "flex", gap: 8 }}>
            {onToggleTheme && <ThemeToggleButton dark={dark} onToggle={onToggleTheme} />}
            {onToggleChat && <AskClaudeButton open={chatOpen} onToggle={onToggleChat} />}
            <ExportButton {...exportProps} />
          </div>
        }
      >Actuals by GL account</H1>
      {/* `null` accountsData means the fetch hasn't resolved (or failed) —
          distinct from an empty `entries` array, which means this ManCo has
          none. Conflating the two would say "no actuals" while the ledger
          is still loading. */}
      {!accountsData ? (
        <Note>Journal entries are not available right now.</Note>
      ) : !sections.length ? (
        <Note>No journal entries yet this year — once Carta has actuals for this ManCo, they show up here.</Note>
      ) : (
        <>
          {/* Excluded from the HTML export, as on Budget vs Actuals: inert
              controls in a static file read as clutter. */}
          <div data-export-exclude>
            <BudgetPeriodControls
              filters={filters} onFilters={setFilters}
              range={window} onRange={setRange}
              year={year} asOfMonth={asOfMonth}
              columnsPane={false}
              breakouts={breakouts} breakoutKey={breakout ? breakout.key : "none"}
              onBreakoutKey={setBreakoutKey}
            />
          </div>
          <ActualsTable
            sections={sections} columns={columns} names={nameByGl} subCodes={subCodes}
            actualsByMonth={actualsByMonth} drilldown={drilldown}
            breakout={breakout} entries={entries}
            theadRef={setTheadEl} stickyState={stickyState} scrollRef={scrollRef}
          />
        </>
      )}
    </div>
  );
}

function Note({ children }) {
  return <p style={{ ...sans, fontSize: FS.bodyLg, color: FAINT }}>{children}</p>;
}

function ActualsTable({ sections, columns, names, subCodes, actualsByMonth, drilldown,
                        breakout, entries, theadRef, stickyState, scrollRef }) {
  const head = (extra) => (
    <GroupedTableHead
      labelText="GL Account" labelMinWidth={ACCOUNT_LABEL_MIN_WIDTH}
      groups={[{ key: "months", label: "" }]}
      subCols={columns.map((c) => ({ label: c.label }))}
      {...extra}
    />
  );

  const netByColumn = columns.map((col) => {
    const incomeRows = sections.find((s) => s.polarity === "income")?.rows || [];
    const expenseRows = sections.find((s) => s.polarity === "expense")?.rows || [];
    const income = sectionTotal(incomeRows, col, actualsByMonth);
    const expense = sectionTotal(expenseRows, col, actualsByMonth);
    if (income === null && expense === null) return null;
    return (income || 0) - (expense || 0);
  });

  return (
    <TableScroll scrollRef={scrollRef}>
      <table style={LEDGER_BASE}>
        <thead ref={theadRef}>{head()}</thead>
        {stickyState.floating && (
          <StickyClone stickyState={stickyState}>
            {head({ colWidths: stickyState.colWidths, subWidths: stickyState.subWidths,
                    scrollLeft: stickyState.scrollLeft || 0 })}
          </StickyClone>
        )}
        <tbody>
          {sections.map((section) => (
            <SectionRows key={section.title} section={section} columns={columns}
                         names={names} subCodes={subCodes} actualsByMonth={actualsByMonth}
                         drilldown={drilldown} breakout={breakout} entries={entries} />
          ))}
          <tr>
            <td style={{ ...S.tdLabel, ...S.summaryCell }}>Net Income</td>
            {columns.map((col, i) => (
              <td key={col.key} style={{ ...S.tdNum, ...S.summaryCell, ...S.tdNumStrong }}>
                {fmtCell(netByColumn[i])}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </TableScroll>
  );
}

// $0 reads the same as a month with no entries at all, so both show as an
// em dash — a reader scanning for activity should not have to tell them
// apart, and a genuine $0 month is as rare as a missing one.
function fmtCell(value) {
  return value ? fmtCurrencyWhole(value) : "—";
}

function SectionRows({ section, columns, names, subCodes, actualsByMonth, drilldown,
                      breakout, entries }) {
  const [open, toggle] = useOpenRows("MancoReporting.MonthlyActuals.ExpandRow");
  const spanCols = 1 + columns.length;
  // The label cell opens the row's year to date when that column is on, and
  // the periods on screen when it is off — the figure and the months the
  // drawer lists both come from labelWindow, so they cannot disagree.
  const label = labelWindow(columns);
  const rowActual = (r) => sumCells(label.cols.map((c) => cellFor(r, c, actualsByMonth))).actual;
  return (
    <>
      <tr>
        <td colSpan={spanCols} style={S.sectionHeader}>{section.title}</td>
      </tr>
      {section.rows.map((r) => {
        const onClick = drilldown
          ? (col) => drilldown.openAccount(r.label, {
              from: "monthly-actuals",
              budget: null,
              actual: (col ? cellFor(r, col, actualsByMonth).actual : rowActual(r)) || 0,
              polarity: section.polarity,
              unmapped: false,
              months: col?.months || label.months,
              periodLabel: col && !col.exact ? col.label : null,
            })
          : undefined;
        const num = { ...S.tdNum, ...S.trLine, ...(onClick ? S.clickable : null) };
        const children = breakout && opensAnything(r, breakout)
          ? breakoutByColumns(entries, r, breakout, columns) : [];
        const expandable = worthBreakingOut(children);
        const isOpen = expandable && open.has(r.account_type);
        return (
          <Fragment key={r.account_type}>
          <tr>
            <td style={{ ...S.tdLabel, ...S.trLine, ...(onClick ? S.clickable : null) }}
                onClick={onClick ? () => onClick(null) : undefined}>
              {expandable && (
                <Chevron
                  open={isOpen} label={r.label} by={breakout.label}
                  onClick={(e) => { e.stopPropagation(); toggle(r.account_type); }}
                />
              )}
              <HoverTip text={glTooltip([r.account_type], names, null, subCodes)} style={S.labelText}>
                {r.label}
              </HoverTip>
            </td>
            {columns.map((col) => (
              <td key={col.key} style={num}
                  onClick={onClick ? () => onClick(col) : undefined}>
                {fmtCell(cellFor(r, col, actualsByMonth).actual)}
              </td>
            ))}
          </tr>
          {isOpen && children.map((c) => (
            <ChildRow key={`${r.account_type}-${c.label}`} child={c} parent={r}
                      columns={columns} breakout={breakout} polarity={section.polarity}
                      drilldown={drilldown} from="monthly-actuals" label={label} />
          ))}
          </Fragment>
        );
      })}
      <tr>
        <td style={{ ...S.tdLabel, ...S.totalCell }}>Total {section.title}</td>
        {columns.map((col) => (
          <td key={col.key} style={{ ...S.tdNum, ...S.totalCell, ...S.tdNumStrong }}>
            {fmtCell(sectionTotal(section.rows, col, actualsByMonth))}
          </td>
        ))}
      </tr>
    </>
  );
}

const S = {
  sectionHeader: LEDGER_SECTION,
  trLine: LEDGER_ROW,
  // The account view's own label cell, so the caret's gutter and the
  // breakout rows' indent (ChildRow) line up with it.
  tdLabel: ACCOUNT_S.tdLabel,
  tdNum: LEDGER_NUM,
  totalCell: { ...LEDGER_TOTAL, fontWeight: 500 },
  summaryCell: { ...LEDGER_SUMMARY, fontWeight: 500 },
  tdNumStrong: { fontWeight: 500 },
  labelText: { marginRight: 8 },
  clickable: { cursor: "pointer" },
};
