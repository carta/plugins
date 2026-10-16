import { useRef, useState } from "react";
import { sans, FAINT, FS } from "../ui/theme.js";
import { fmtCurrencyWhole } from "../charts/chartTheme.js";
import { glNameMap, glTooltip } from "../ui/glNames.js";
import HoverTip from "../ui/HoverTip.jsx";
import {
  TableScroll, LEDGER_BASE, useStickyHeader, StickyClone, GroupedTableHead,
} from "../ui/table.jsx";
import { LEDGER_LABEL, LEDGER_NUM, LEDGER_ROW, LEDGER_TOTAL, LEDGER_SUMMARY, LEDGER_SECTION } from "../ui/ledger.js";
import { periodColumns, ytdColumn, trueAsOfMonth, cellFor, sumCells } from "./budgetPeriods.js";
import { accountSections, actualByGlByMonth, accountLabel, ACCOUNT_LABEL_MIN_WIDTH } from "./accountSections.js";

// One section's total for one column — what its "Total <section>" row shows,
// and what Net Income is built from, so the two can never disagree.
function sectionTotal(rows, col, actualsByMonth) {
  return sumCells(rows.map((r) => cellFor(r, col, actualsByMonth))).actual;
}

// GL account actuals by month, for a firm with nothing budgeted — the one
// axis a Carta-sourced budget has too, minus the budget and variance
// columns that firm has none of. Stands in for Budget vs Actuals while this
// firm has no budget loaded, in Carta or a workbook.
export default function MonthlyActualsView({ snapshot, accountsData, drilldown }) {
  const asOf = snapshot?.asOf;
  const year = Number(String(asOf || "").slice(0, 4)) || new Date().getFullYear();
  const asOfMonth = trueAsOfMonth(asOf);
  const entries = accountsData?.entries || [];

  const actualsByMonth = actualByGlByMonth(entries);
  const nameByGl = glNameMap(entries);

  const rows = Array.from(actualsByMonth, ([gl]) => ({
    label: accountLabel(gl, nameByGl),
    account_type: gl,
    gl_codes: [gl],
  }));
  const sections = accountSections(rows);

  const monthCols = periodColumns("monthly", { first: 1, last: 12 }, year, asOfMonth);
  const ytd = ytdColumn({ first: 1, last: 12 }, year, asOfMonth, monthCols);
  const columns = ytd ? [...monthCols, ytd] : monthCols;

  const [theadEl, setTheadEl] = useState(null);
  const stickyState = useStickyHeader(theadEl);
  const scrollRef = useRef(null);

  // `null` means the fetch hasn't resolved (or failed) — distinct from an
  // empty `entries` array, which means it resolved and this ManCo has none.
  // Conflating the two would tell a reader "no actuals" while the ledger is
  // still loading.
  if (!accountsData) {
    return (
      <p style={{ ...sans, fontSize: FS.bodyLg, color: FAINT }}>
        Journal entries are not available right now.
      </p>
    );
  }

  if (!sections.length) {
    return (
      <p style={{ ...sans, fontSize: FS.bodyLg, color: FAINT }}>
        No journal entries yet this year — once Carta has actuals for this ManCo, they show up here.
      </p>
    );
  }

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
        <thead ref={setTheadEl}>{head()}</thead>
        {stickyState.floating && (
          <StickyClone stickyState={stickyState}>
            {head({ colWidths: stickyState.colWidths, subWidths: stickyState.subWidths,
                    scrollLeft: stickyState.scrollLeft || 0 })}
          </StickyClone>
        )}
        <tbody>
          {sections.map((section) => (
            <SectionRows key={section.title} section={section} columns={columns}
                         names={nameByGl} actualsByMonth={actualsByMonth} drilldown={drilldown} />
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

function SectionRows({ section, columns, names, actualsByMonth, drilldown }) {
  const spanCols = 1 + columns.length;
  return (
    <>
      <tr>
        <td colSpan={spanCols} style={S.sectionHeader}>{section.title}</td>
      </tr>
      {section.rows.map((r) => {
        const ytdCol = columns.find((c) => c.ytd);
        const ytdThroughAsOf = ytdCol ? cellFor(r, ytdCol, actualsByMonth).actual : null;
        const onClick = drilldown
          ? (col) => drilldown.openAccount(r.label, {
              from: "monthly-actuals",
              budget: null,
              actual: (col ? cellFor(r, col, actualsByMonth).actual : ytdThroughAsOf) || 0,
              polarity: section.polarity,
              unmapped: false,
              months: col?.months || null,
              periodLabel: col && !col.ytd ? col.label : null,
            })
          : undefined;
        const num = { ...S.tdNum, ...S.trLine, ...(onClick ? S.clickable : null) };
        return (
          <tr key={r.account_type}>
            <td style={{ ...S.tdLabel, ...S.trLine, ...(onClick ? S.clickable : null) }}
                onClick={onClick ? () => onClick(null) : undefined}>
              <HoverTip text={glTooltip([r.account_type], names)} style={S.labelText}>
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
  tdLabel: { ...LEDGER_LABEL, minWidth: ACCOUNT_LABEL_MIN_WIDTH },
  tdNum: LEDGER_NUM,
  totalCell: { ...LEDGER_TOTAL, fontWeight: 500 },
  summaryCell: { ...LEDGER_SUMMARY, fontWeight: 500 },
  tdNumStrong: { fontWeight: 500 },
  labelText: { marginRight: 8 },
  clickable: { cursor: "pointer" },
};
