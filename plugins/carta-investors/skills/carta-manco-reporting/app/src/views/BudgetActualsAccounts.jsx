import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { sans, FAINT, MICRO, FS, LINE } from "../ui/theme.js";
import { fmtCurrencyWhole } from "../charts/chartTheme.js";
import { varianceColor, fmtVarianceWhole } from "../ui/variance.js";
import { glNameMap, glTooltip, subCodeMap } from "../ui/glNames.js";
import HoverTip from "../ui/HoverTip.jsx";
import { CollapseCaret } from "../ui/components.jsx";
import {
  TableScroll, LEDGER_BASE, useStickyHeader, StickyClone, GroupedTableHead,
} from "../ui/table.jsx";
import { LEDGER_LABEL, LEDGER_NUM, LEDGER_ROW, LEDGER_TOTAL, LEDGER_SECTION } from "../ui/ledger.js";
import BudgetSourceLine from "./BudgetSourceLine.jsx";
import BudgetPeriodControls from "./BudgetPeriodControls.jsx";
import { noValueLabel } from "../ui/dimension.js";
import { rowBreakouts, defaultBreakout, breakoutByColumns, worthBreakingOut, opensAnything } from "./accountBreakout.js";
import {
  DEFAULT_FILTERS, cellFor, detectPreset, monthsInRange, normalizeRange,
  periodColumns, rangeOfPeriod, rangePresets, subColumns, sumCells, trueAsOfMonth, ytdColumn,
} from "./budgetPeriods.js";
import {
  canPersist, localStore, prefsKeyFor, readPrefs, restoreBreakoutKey,
  restoreFilters, restoreRange, toPrefs, writePrefs,
} from "./budgetPrefs.js";
import { trackClick } from "../analytics.js";

// Narrower than the other two budget tables' shared LABEL_MIN_WIDTH (320):
// GL account names here run short ("Audit fees", "Management fee income"),
// so the full-width column was mostly blank space.
export const ACCOUNT_LABEL_MIN_WIDTH = 220;

// The four sub-columns every budget table in this app shows. No source
// marks: both columns are Carta's, unlike the workbook views.
export const ACCOUNT_SUB_COLS = [
  { label: "Actual" },
  { label: "Budget" },
  { label: "Var $" },
  { label: "Var %" },
];

// Var % is dropped per month: against a small monthly budget it swings to
// three figures on a rounding difference and drowns the columns beside it.
export const MONTH_SUB_COLS = [
  { label: "Actual" },
  { label: "Budget" },
  { label: "Var $" },
];

/** Whether Carta gave this budget a month-by-month split worth showing.
 *
 *  A budget stated as one annual figure still has a `monthly` array, with
 *  the whole year in January — so more than one month must carry a figure.
 */
export function hasMonthlyDetail(budget) {
  const rows = budget?.rows || [];
  return rows.some((r) => {
    if (!Array.isArray(r.monthly)) return false;
    const months = r.monthly.filter((v) => typeof v === "number" && v !== 0);
    return months.length > 1;
  });
}

/** Actuals per GL account per month, as a Map<gl, number[12]>. */
export function actualByGlByMonth(entries) {
  const out = new Map();
  for (const e of entries || []) {
    const gl = e.acct_type;
    if (gl == null || typeof e.mo !== "number") continue;
    if (e.mo < 1 || e.mo > 12) continue;
    if (!out.has(gl)) out.set(gl, new Array(12).fill(0));
    out.get(gl)[e.mo - 1] += e.amount || 0;
  }
  return out;
}

/** The calendar year the budget covers. */
export function budgetYear(budget, asOf) {
  return budget?.period_year || Number(String(asOf || "").slice(0, 4)) || null;
}

/** The breakout in force: the reader's own pick, else the one the budget
 *  implies, else the account axis these rows are already built on. */
export function pickBreakout(breakouts, accountsData, budget, key) {
  if (key === "none") return null;
  if (key) return breakouts.find(b => b.key === key) || null;
  return defaultBreakout(accountsData, breakouts, budget)
      || breakouts.find(b => b.source === "account") || null;
}

// Budget vs Actuals for a Carta-sourced budget. Carta's budget has no
// department dimension, so the account is the only axis available.
export default function BudgetActualsAccounts({ budget, entries, drilldown, accountsData, asOf }) {
  const period = budget?.period;
  const monthly = hasMonthlyDetail(budget);
  const year = budgetYear(budget, asOf);
  // Never past the true as-of date, whatever the budget itself claims to cover.
  const statedLastMonth = Math.min(12, Math.max(1, period?.last_month ?? 12));
  const asOfMonth = Math.min(statedLastMonth, trueAsOfMonth(asOf));

  // What an account row can be opened up by, and which opens first. The
  // census sits beside the entries it describes, in accounts.json; the
  // budget decides which of them leads.
  const breakouts = useMemo(() => rowBreakouts(accountsData, budget),
                            [accountsData, budget]);

  const store = useMemo(() => localStore(), []);
  const key = prefsKeyFor(accountsData, budget);
  const presets = useMemo(() => rangePresets(year, asOfMonth), [year, asOfMonth]);

  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [range, setRange] = useState(() => rangeOfPeriod(period));
  const [breakoutKey, setBreakoutKey] = useState(null);
  const breakout = useMemo(
    () => pickBreakout(breakouts, accountsData, budget, breakoutKey),
    [breakoutKey, breakouts, accountsData, budget]);

  // Restored on the render the ManCo's own data arrives, not at mount: the
  // view renders before it, when there is no reader to have a preference.
  const restoredFor = useRef(null);
  const [restored, setRestored] = useState(false);
  useEffect(() => {
    if (!key || restoredFor.current === key) return;
    restoredFor.current = key;
    const saved = readPrefs(store, key);
    if (saved) {
      setFilters(restoreFilters(saved));
      setRange(restoreRange(saved, presets, rangeOfPeriod(period)));
      setBreakoutKey(restoreBreakoutKey(saved, breakouts));
    }
    setRestored(true);
  }, [store, key, presets, period, breakouts]);

  useEffect(() => {
    if (!canPersist(key, restoredFor.current)) return;
    writePrefs(store, key, toPrefs(filters, range, detectPreset(range, presets), breakoutKey));
  }, [store, key, filters, range, presets, breakoutKey]);

  // The window every figure outside the period columns is measured over.
  // Without monthly detail there is only one window the budget can state.
  const window = useMemo(
    () => (monthly ? normalizeRange(range) : rangeOfPeriod(period)),
    [monthly, range, period]);
  const windowMonths = useMemo(() => monthsInRange(window), [window]);

  // Actuals over the window on screen — spend outside it would read as
  // overspend that is really the calendar.
  const actualByGl = useMemo(() => {
    const out = new Map();
    for (const e of entries || []) {
      const t = e.acct_type;
      if (t == null) continue;
      if (typeof e.mo === "number" && (e.mo < window.first || e.mo > window.last)) continue;
      out.set(t, (out.get(t) || 0) + (e.amount || 0));
    }
    return out;
  }, [entries, window]);

  const nameByGl = useMemo(() => glNameMap(entries), [entries]);
  // Sub-account codes, so a line mapped to one names it rather than
  // naming the parent account and leaving the reader to guess.
  const subCodes = useMemo(() => subCodeMap(entries), [entries]);

  const sections = useMemo(() => {
    const rows = (budget?.rows || []).map(r => {
      const actual = (r.gl_codes || []).reduce((s, gl) => s + (actualByGl.get(gl) || 0), 0);
      const budgeted = windowBudget(r, windowMonths, monthly);
      return { ...r, actual, budgeted, variance: actual - budgeted };
    });

    // Spend on an account the budget never named. Omitting it would leave
    // the page's totals short of the KPI strip, and unbudgeted spend is
    // the thing a budget review most wants to surface.
    const named = new Set(rows.flatMap(r => r.gl_codes || []));
    for (const [gl, actual] of actualByGl) {
      if (named.has(gl) || !actual) continue;
      rows.push({
        label: nameByGl.get(gl) || `GL ${gl}`,
        account_type: gl, gl_codes: [gl],
        budget_ytd: 0, budgeted: 0, actual, variance: actual, unbudgeted: true,
      });
    }
    const income = rows.filter(r => String(r.account_type ?? "")[0] === "4");
    const expense = rows.filter(r => String(r.account_type ?? "")[0] !== "4");
    // GL code ascending, the order an income statement is read in. The
    // variance ranking lives in the insights strip below the table.
    const byCode = (a, b) =>
      (a.account_type ?? 0) - (b.account_type ?? 0) || a.label.localeCompare(b.label);
    return [
      { title: "Income", polarity: "income", rows: income.sort(byCode) },
      { title: "Operating Expenses", polarity: "expense", rows: expense.sort(byCode) },
    ].filter(s => s.rows.length);
  }, [budget, actualByGl, nameByGl, windowMonths, monthly]);

  // Rows budgeted to zero are skipped: every $1 of unbudgeted spend would
  // read as "infinite % over" and take the whole ranking.
  const insights = useMemo(() => sections.flatMap(
    s => s.rows.filter(r => r.budgeted).map(r => ({
      name: r.label, budget: r.budgeted, actual: r.actual,
      variance: r.variance, pct: r.variance / r.budgeted,
      polarity: s.polarity,
    }))), [sections]);

  // Callback-ref-held node — see useStickyHeader's doc for why a plain
  // useRef object doesn't work here.
  const [theadEl, setTheadEl] = useState(null);
  const stickyState = useStickyHeader(theadEl);

  const actualsByMonth = useMemo(
    () => (monthly ? actualByGlByMonth(entries) : new Map()), [monthly, entries]);

  const columns = useMemo(() => {
    if (!monthly) {
      return [{ key: "period", label: period?.label || "Year to date",
                months: windowMonths, future: false, exact: true }];
    }
    const cols = periodColumns(filters.frequency, window, year, asOfMonth);
    if (!filters.showYtd) return cols;
    const ytd = ytdColumn(window, year, asOfMonth, cols);
    if (!ytd) return cols;
    // The window's own total, when that is what year-to-date comes to. Read
    // off the row it keeps the page tying to the KPI strip above it.
    const exact = sameMonths(ytd.months, windowMonths);
    return [...cols, { ...ytd, exact }];
  }, [monthly, filters, window, windowMonths, year, asOfMonth, period]);

  const subCols = useMemo(
    () => subColumns(filters.hidden, columns.length === 1), [filters.hidden, columns]);

  // Anchor to the current month's column. A filter change can reflow
  // columns over several frames, so poll until the position holds steady.
  const scrollRef = useRef(null);
  useEffect(() => {
    if (!restored) return;
    const container = scrollRef.current;
    if (!container || columns.length < 2) return;
    const currentCol = columns.find(c => !c.ytd && c.months.includes(asOfMonth));
    if (!currentCol) return;
    let timerId;
    let lastLeft = null;
    let stableTicks = 0;
    let ticksLeft = 30; // ~500ms budget; a stalled layout just skips the anchor
    // setTimeout, not requestAnimationFrame — rAF can be suspended entirely
    // for a backgrounded/unfocused tab, which would silently kill the anchor.
    const measure = () => {
      const th = container.querySelector(`th[data-col-key="${currentCol.key}"]`);
      const labelTh = container.querySelector("thead th");
      ticksLeft -= 1;
      // A mid-transition DOM (old columns gone, new ones not painted yet)
      // is not a dead end — retry rather than abandoning the whole anchor.
      if (!th || !labelTh) { if (ticksLeft > 0) timerId = setTimeout(measure, 16); return; }
      const left = th.getBoundingClientRect().left;
      stableTicks = (lastLeft !== null && Math.abs(left - lastLeft) < 0.5) ? stableTicks + 1 : 0;
      lastLeft = left;
      if (stableTicks < 2 && ticksLeft > 0) { timerId = setTimeout(measure, 16); return; }
      const contRect = container.getBoundingClientRect();
      const labelWidth = labelTh.getBoundingClientRect().width;
      container.scrollLeft = Math.max(0, container.scrollLeft + (left - contRect.left - labelWidth));
    };
    timerId = setTimeout(measure, 16);
    return () => clearTimeout(timerId);
  }, [restored, columns, asOfMonth]);

  if (!sections.length) return null;

  const cellOf = (row, col) => (col.exact
    ? { budget: row.budgeted, actual: row.actual, variance: row.variance }
    : cellFor(row, col, actualsByMonth));

  const head = (extra) => (
    <GroupedTableHead
      labelText="Account" labelMinWidth={ACCOUNT_LABEL_MIN_WIDTH}
      groups={columns} subCols={subCols} {...extra}
    />
  );

  return (
    <>
    {/* Always rendered, so Filters (and the breakouts inside it) stay
        reachable; only the Period control needs monthly detail to mean
        anything. Excluded from the HTML export — inert controls with
        nothing behind them just read as clutter in a static file. */}
    <div data-export-exclude>
    <BudgetPeriodControls
      filters={filters} onFilters={setFilters}
      range={window} onRange={setRange}
      year={year} asOfMonth={asOfMonth}
      frequencyEnabled={monthly}
      breakouts={breakouts} breakoutKey={breakout ? breakout.key : "none"}
      onBreakoutKey={setBreakoutKey}
    />
    </div>
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
          {sections.map(section => (
            <SectionRows
              key={section.title} section={section} drilldown={drilldown} names={nameByGl}
              subCodes={subCodes} columns={columns} subCols={subCols} cellOf={cellOf}
              breakout={breakout} entries={entries}
            />
          ))}
        </tbody>
      </table>
    </TableScroll>
    <BudgetSourceLine fallback="the budget loaded in Carta" />
    </>
  );
}

function sameMonths(a, b) {
  return a.length === b.length && a.every((m, i) => m === b[i]);
}

/** A row's budget over the months on screen. Without monthly detail the
 *  budget states one window only, and that is the figure it stated. */
function windowBudget(row, months, monthly) {
  if (!monthly || !Array.isArray(row.monthly)) return row.budget_ytd || 0;
  return months.reduce((s, m) => s + (row.monthly[m - 1] || 0), 0);
}

function SectionRows({ section, drilldown, names, subCodes, columns, subCols, cellOf,
                      breakout, entries }) {
  const [open, setOpen] = useState(() => new Set());
  const toggle = (key) => {
    trackClick("MancoReporting.BudgetVsActuals.AccountsExpandRow");
    setOpen(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };
  const spanCols = 1 + columns.length * subCols.length;
  return (
    <>
      <tr>
        <td colSpan={spanCols} style={S.sectionHeader}>
          {/* Pinned so the band's label doesn't scroll off with the table. */}
          <span style={S.bandLabel}>{section.title}</span>
        </td>
      </tr>

      {section.rows.map(r => {
        // Takes the column that was clicked, so the entry list covers the
        // months that cell covers. The label cell passes none and opens the
        // row's whole window, as it always did.
        const onClick = drilldown
          ? (col) => drilldown.openAccount(r.label, {
              budget: col ? cellOf(r, col).budget : r.budgeted,
              actual: col ? cellOf(r, col).actual : r.actual,
              polarity: section.polarity,
              unmapped: false,
              months: col?.months || null,
              periodLabel: col && !col.exact ? col.label : null,
            })
          : undefined;
        // The rule sits on each <td>, not the <tr> — LEDGER_BASE collapses
        // borders separately, so a row-level border never paints.
        const num = { ...S.tdNum, ...S.trLine, ...(onClick ? S.clickable : null) };
        const key = `${r.account_type}-${r.label}`;
        const children = breakout && opensAnything(r, breakout)
          ? breakoutByColumns(entries, r, breakout, columns) : [];
        const expandable = worthBreakingOut(children);
        const isOpen = expandable && open.has(key);
        return (
          <Fragment key={key}>
          <tr>
            {/* The caret hangs in the gutter: inline it pushed this row's
                label out of line with every row that has none.
                No `position: "relative"` here — S.tdLabel already carries
                `position: "sticky"` (see LEDGER_LABEL), which is enough of
                a containing block for the chevron's `position: absolute`;
                adding "relative" on top overrode the sticky and un-froze
                the column on horizontal scroll. */}
            <td style={{ ...S.tdLabel, ...S.trLine,
                         ...(onClick ? S.clickable : null) }}
                onClick={onClick ? () => onClick(null) : undefined}>
              {expandable && (
                <Chevron
                  open={isOpen} label={r.label} by={breakout.label}
                  onClick={(e) => { e.stopPropagation(); toggle(key); }}
                />
              )}
              {/* Same decision as the outline: the codes move onto the
                  label's own tooltip and the names take their place. A code
                  beside every row is a column of numbers nobody reads until
                  they need one, and the browser's own tooltip did not
                  survive a hover in a table this dense. */}
              <HoverTip
                text={glTooltip(r.gl_codes?.length ? r.gl_codes : [r.account_type],
                                names, r.scopes, subCodes)}
                style={S.labelText}
              >
                {r.label}
              </HoverTip>
              <span style={S.labelMeta}>
                {r.unbudgeted && (
                  <HoverTip text="No budget line in Carta for this account.">
                    <span style={S.unbudgeted}>not budgeted</span>
                  </HoverTip>
                )}
              </span>
            </td>
            {columns.map(col => (
              <Cells key={col.key} cell={cellOf(r, col)} subCols={subCols}
                     polarity={section.polarity} numStyle={num}
                     onClick={onClick ? () => onClick(col) : undefined} />
            ))}
          </tr>
          {isOpen && children.map(c => (
            <ChildRow
              key={`${key}-${c.label}`} child={c} parent={r} columns={columns}
              subCols={subCols} breakout={breakout} polarity={section.polarity}
              drilldown={drilldown}
            />
          ))}
          </Fragment>
        );
      })}

      <tr>
        <td style={{ ...S.tdLabel, ...S.totalCell }}>Total {section.title}</td>
        {columns.map(col => (
          <Cells key={col.key} cell={sumCells(section.rows.map(r => cellOf(r, col)))}
                 subCols={subCols} polarity={section.polarity}
                 numStyle={{ ...S.tdNum, ...S.totalCell, ...S.tdNumStrong }} />
        ))}
      </tr>
    </>
  );
}

function Chevron({ open, label, by, onClick }) {
  return (
    <button
      type="button" data-export-exclude onClick={onClick} aria-expanded={open}
      aria-label={`${open ? "Hide" : "Show"} ${label} by ${by}`}
      style={S.chevron}
    >
      <CollapseCaret collapsed={!open} />
    </button>
  );
}

// Budget and Var stay blank: repeating the parent's figures would read as
// each child having been budgeted that amount. See breakoutByColumns.
export function ChildRow({ child, parent, columns, subCols, breakout, polarity, drilldown }) {
  // The value this row IS, as a filter rather than a note. It used to ride
  // along as `breakout`, which nothing downstream read — so every child of
  // an account opened the same panel, totalling the whole account rather
  // than the row that was clicked.
  const scope = { ...breakout, value: child.unlabelled ? null : child.label };
  const onClick = drilldown
    ? (col) => drilldown.openAccount(parent.label, {
        // No budget, not a zero one. The workbook budgets the account, not
        // the vendors inside it, and a zero here printed a variance equal to
        // the whole figure — the same invented comparison the outline's
        // breakout rows already refuse.
        budget: null,
        actual: col ? (child.cells.get(col.key) ?? 0) : totalOf(child),
        polarity, unmapped: false,
        childScope: scope,
        months: col?.months || null,
        periodLabel: col && !col.exact ? col.label : null,
      })
    : undefined;
  const num = { ...S.tdNum, ...S.trLine, ...S.childNum, ...(onClick ? S.clickable : null) };
  return (
    <tr>
      <td style={{ ...S.tdLabel, ...S.trLine, ...S.childLabel, ...(onClick ? S.clickable : null) }}
          onClick={onClick ? () => onClick(null) : undefined}>
        <span style={{ ...S.labelText, ...(child.unlabelled ? S.childMuted : null) }}>
          {child.unlabelled ? noValueLabel(breakout) : child.label}
        </span>
      </td>
      {columns.map(col => subCols.map((sc, i) => (
        <td key={`${col.key}-${sc.type}`}
            style={i === 0 ? { ...num, borderLeft: `1px solid ${LINE}` } : num}
            onClick={sc.type === "actual" && onClick ? () => onClick(col) : undefined}>
          {/* A month this value never touched is an em dash, the same as on
              the row above — $0 reads as a month that was measured. */}
          {sc.type === "actual" && !col.future && child.cells.has(col.key)
            ? fmtCurrencyWhole(child.cells.get(col.key)) : "—"}
        </td>
      )))}
    </tr>
  );
}

function totalOf(child) {
  let sum = 0;
  for (const v of child.cells.values()) sum += v;
  return sum;
}

// An empty period is an em dash, not three zeros: a quarterly-billed account
// is empty most months and would read as twelve columns of real data.
function Cells({ cell, subCols, polarity, numStyle, onClick }) {
  const empty = cell.actual === null || blank(cell.actual, cell.budget);
  const vColor = empty ? MICRO : varianceColor(cell.variance, polarity);
  // Same hover wash the other budget tables use (theme.js .cellopen).
  const h = onClick ? { onClick, className: "cellopen" } : {};
  return (
    <>
      {subCols.map((sc, i) => {
        // Continues the header's own month divider (table.jsx's thGroup).
        const style = i === 0 ? { ...numStyle, borderLeft: `1px solid ${LINE}` } : numStyle;
        if (sc.type === "budget") {
          return <td key={sc.type} {...h} style={style}>
            {cell.budget ? fmtCurrencyWhole(cell.budget) : "—"}
          </td>;
        }
        if (sc.type === "actual") {
          return <td key={sc.type} {...h} style={style}>
            {empty ? "—" : fmtCurrencyWhole(cell.actual)}
          </td>;
        }
        if (sc.type === "pct") {
          return <td key={sc.type} {...h} style={{ ...style, color: vColor }}>
            {empty ? "—" : pctOf(cell.variance, cell.budget)}
          </td>;
        }
        return <td key={sc.type} {...h} style={{ ...style, color: vColor }}>
          {empty ? "—" : fmtVarianceWhole(cell.variance)}
        </td>;
      })}
    </>
  );
}

// Nothing on either side is an em dash, not a row of zeros.
export function blank(actual, budget) {
  return !actual && !budget;
}

// A variance against no budget is not a percentage of anything.
export function pctOf(variance, budget) {
  if (!budget) return "—";
  const p = (variance / Math.abs(budget)) * 100;
  return `${p > 0 ? "+" : ""}${p.toFixed(0)}%`;
}

// Mirrors BudgetActualsOutline's recipe so the two tables read as one report.
export const S = {
  sectionHeader: LEDGER_SECTION,
  // left:12 matches the frozen column's own inset — see BudgetActualsView's bandLabel.
  bandLabel: { position: "sticky", left: 12, display: "inline-block" },
  trLine: LEDGER_ROW,
  // Narrower than LEDGER_LABEL's shared 320px — see ACCOUNT_LABEL_MIN_WIDTH.
  // paddingLeft is the outline's depth-1 indent, reserving its 20px caret
  // gutter on every row so labels stay in line whether or not one has a caret.
  tdLabel: { ...LEDGER_LABEL, minWidth: ACCOUNT_LABEL_MIN_WIDTH, paddingLeft: 26 },
  tdNum: LEDGER_NUM,
  totalCell: { ...LEDGER_TOTAL, fontWeight: 500 },
  tdNumStrong: { fontWeight: 500 },
  labelText: { marginRight: 8 },
  labelMeta: { display: "inline-flex", alignItems: "center", gap: 6 },
  unbudgeted: { ...sans, fontSize: FS.micro, fontStyle: "italic", color: MICRO, cursor: "help" },
  clickable: { cursor: "pointer" },
  controls: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: 24 },
  // The outline's lineCaret, verbatim: same 5px hit-area padding, same
  // inherited row color, and left = tdLabel's indent - 20.
  chevron: {
    ...sans, position: "absolute", left: 6, top: "50%", transform: "translateY(-50%)",
    display: "flex", border: "none", background: "transparent", borderRadius: 4,
    color: "inherit", cursor: "pointer", padding: "0 5px 0 0",
  },
  // Indent carries the hierarchy; the sticky label column has no room for
  // a second device, and a bolder parent would fight the section header.
  childLabel: { paddingLeft: 48 },
  childNum: { color: FAINT },
  childMuted: { fontStyle: "italic", color: MICRO },
};
