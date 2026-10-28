import { useEffect, useMemo, useState } from "react";
import { sans, INK, PAPER, LINE, FAINT, FS } from "../ui/theme.js";
import { useOutsideClose } from "../ui/useOutsideClose.js";
import { displayFirmName } from "../ui/firmName.js";
import { H1, Btn, Tag, Chevron, Bubble, TOOLBAR_CONTROL_STYLE } from "../ui/components.jsx";
import ExportButton from "../ui/ExportButton.jsx";
import ThemeToggleButton from "../ui/ThemeToggleButton.jsx";
import ReportActions, { hasSharePanel } from "../reports/ReportActions.jsx";
import { REPORT_ACTIONS, actSaved } from "../state/useReports.js";
import { reportFor } from "../shell/reportNav.js";
import { exportPropsFor } from "../ui/exportHtml.js";
import { FilterRibbon } from "./BudgetPeriodControls.jsx";
import { ReportGrid } from "./customReport/ReportGrid.jsx";
import { FieldsPanel } from "./customReport/FieldsPanel.jsx";
import { MultiSelect, ValueChecklist } from "./customReport/MultiSelect.jsx";
import {
  VALUE_FIELDS, ROW_TOTAL_KEY, TOTAL_KEY, buildFields, buildBudgetLookup, buildReportGrid, applyCut,
  cutOf, selectedValues, summarize, sortedTree, flattenTree, defaultRowsFor, glOf, budgetInfoFor, actualFor,
  valueCell, totalCells, footerPolarityOf, sectionsOf, isBudgetComparable, entriesForCol, drilldownScopes, scopeEntries,
} from "./customReport/pivot.js";

const REPORT_EXPORT_ID = "manco-export-custom-report";

// How a source's own page lays its rows out; see defaultRowsFor.
const rowsFromSource = (snapshot, budgetId) => defaultRowsFor(buildBudgetLookup(snapshot, budgetId));

function emptySavedState(snapshot, availableBudgets, seedBudgetId) {
  const source = availableBudgets.find(b => b.id === seedBudgetId) || availableBudgets[0] || null;
  return {
    label: "",
    zones: { filters: [], columns: ["month"], rows: rowsFromSource(snapshot, source?.id), values: ["actual", "budget", "variance"] },
    filterSelections: {},
    budgetId: source?.id || null,
    hiddenRows: [],
    hiddenCols: [],
  };
}

// `budget` is a saved custom report — a budget whose view carries the pivot — or null
// for a draft, which starts from `seedBudgetId`'s figures.
export default function CustomReportView({
  snapshot, accountsData, drilldown, budget, seedBudgetId, reportsApi, hosted, onOpenReport, onShareDone, onCancel,
  dark, onToggleTheme,
}) {
  const savedReport = useMemo(
    () => (budget?.view?.pivot ? { ...budget.view.pivot, label: budget.label, id: budget.id, budgetId: budget.id } : null),
    [budget]);
  const report = budget ? reportFor(budget, reportsApi) : null;
  // Saving sends derive (a new report) or edit (a saved one), so it needs a server that serves
  // that action. Only the owner's copy edits here: one synced from the local dashboard is edited
  // there (it reads as an uploaded budget on the hosted app); one shared with you, never.
  const canSave = !!reportsApi?.available && (savedReport
    ? reportsApi.can(REPORT_ACTIONS.EDIT) && !!report?.editable && report?.origin === "copy"
    : reportsApi.can(REPORT_ACTIONS.DERIVE));
  const allEntries = accountsData?.entries || [];
  // Every report can be a source — plain budgets first, then custom ones, which a new
  // report cuts down further. A saved report is never its own source here: it has
  // "This report's data only" for that.
  const allBudgets = snapshot?.budget?.budgets || [];
  const availableBudgets = [...allBudgets.filter(b => !b.view?.pivot), ...allBudgets.filter(b => b.view?.pivot)]
    .filter(b => b.id !== budget?.id);
  // What an edit cuts the report from: the source it is linked to while this user can still
  // see it, else the report's own data (a copy of one shared with them starts there).
  const linkedSource = availableBudgets.find(b => b.id === report?.custom?.from)?.id;
  const initial = savedReport
    ? { ...savedReport, budgetId: linkedSource || savedReport.id }
    : emptySavedState(snapshot, availableBudgets, seedBudgetId);

  // "report" shows the saved view with the same chrome as any other Budget
  // vs Actuals page; "configure" shows the drag-and-drop field builder.
  const [mode, setMode] = useState(savedReport ? "report" : "configure");
  const [budgetId, setBudgetId] = useState(initial.budgetId || null);
  // A saved report's figures are its own cut budget; the builder shows the source it cuts from.
  const lookupId = mode === "report" && savedReport ? savedReport.id : budgetId;
  const budgetLookup = useMemo(() => (lookupId ? buildBudgetLookup(snapshot, lookupId) : null),
                               [snapshot, lookupId]);
  const fields = useMemo(() => buildFields(accountsData, budgetLookup), [accountsData, budgetLookup]);
  const fieldKeys = Object.keys(fields);
  const savedCut = savedReport?.cut;
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filtersRef = useOutsideClose(filtersOpen, () => setFiltersOpen(false));

  // A field the current fields don't carry (a since-removed tag category, or the Budget line
  // field once the Source has no lines) is dropped rather than crashing what reads it. Stored
  // zones stay as set; every read goes through the sanitized `zones`, which follows `fields`.
  const sanitizeZones = (z) => ({
    filters: z.filters.filter(f => fields[f]),
    columns: z.columns.filter(f => fields[f]),
    rows: z.rows.filter(f => fields[f]),
    values: z.values.filter(f => fields[f]),
  });

  const [reportName, setReportName] = useState(initial.label || "");
  const [rawZones, setZones] = useState(initial.zones);
  const zones = useMemo(() => sanitizeZones(rawZones), [rawZones, fields]);
  const [filterSelections, setFilterSelections] = useState(() => initial.filterSelections || {});
  // Same Reset/Apply draft contract as the real FiltersMenu, so closing
  // without Apply never touches the committed filterSelections.
  const [filterDraft, setFilterDraft] = useState(filterSelections);
  const [activeFilterPane, setActiveFilterPane] = useState(zones.filters[0] || null);
  useEffect(() => {
    if (filtersOpen) return;
    setFilterDraft(filterSelections);
    setActiveFilterPane(p => (zones.filters.includes(p) ? p : zones.filters[0] || null));
  }, [filtersOpen, filterSelections, zones.filters.join(",")]);
  // A saved report shows only the data it was saved with. The builder shows its source's:
  // a plain budget's whole ledger, or what a custom one was cut to — its owner's edit
  // starts there, with the saved cut loaded back as filters and hidden rows to undo.
  const sourceCut = allBudgets.find(b => b.id === budgetId)?.view?.pivot?.cut;
  // A line-item source covers only the accounts its lines do, as its own page shows.
  const entries = useMemo(
    () => applyCut(scopeEntries(allEntries, budgetLookup), fields, mode === "report" ? savedCut : sourceCut),
    [mode, allEntries, fields, savedCut, sourceCut, budgetLookup]);
  const [sortCol, setSortCol] = useState(null);
  const [sortDir, setSortDir] = useState(-1); // -1 desc, 1 asc
  const [hiddenRows, setHiddenRows] = useState(() => new Set(savedCut?.hidden?.keys || []));
  const [hiddenCols, setHiddenCols] = useState(() => new Set(initial.hiddenCols || []));
  const [collapsedKeys, setCollapsedKeys] = useState(() => new Set());
  const [dragOverZone, setDragOverZone] = useState(null);
  // The cell group under the cursor — lifted here, not CSS, since a figure's
  // sub-columns are sibling <td>s and :hover only ever reaches one of them.
  const [hoverCell, setHoverCell] = useState(null);


  // A changed layout starts clean: sorting, hidden rows and columns and collapsed rows are
  // keyed to the old one.
  function resetLayout() {
    setSortCol(null);
    setHiddenRows(new Set());
    setHiddenCols(new Set());
    setCollapsedKeys(new Set());
  }

  function moveField(fieldKey, fromZone, targetZone, insertIndex) {
    const isValueField = !!fields[fieldKey]?.isValue;
    if (isValueField !== (targetZone === "values")) return; // wrong zone for this field kind
    setZones(raw => {
      const prev = sanitizeZones(raw);
      const next = { ...prev };
      if (fromZone) next[fromZone] = next[fromZone].filter(f => f !== fieldKey);
      // A field lays the table out one way: placing it in Rows takes it out of Columns, and back.
      const other = { rows: "columns", columns: "rows" }[targetZone];
      if (other) next[other] = next[other].filter(f => f !== fieldKey);
      const arr = next[targetZone];
      const idx = insertIndex == null ? arr.length : Math.min(insertIndex, arr.length);
      if (!arr.includes(fieldKey)) arr.splice(idx, 0, fieldKey);
      return next;
    });
    resetLayout();
  }

  function removeField(fieldKey, fromZone) {
    setZones(raw => { const prev = sanitizeZones(raw); return { ...prev, [fromZone]: prev[fromZone].filter(f => f !== fieldKey) }; });
    resetLayout();
  }

  // Values are on/off measures, kept in one order (Actual, Budget, Var $) whichever is ticked first.
  function toggleValue(valueKey) {
    if (zones.values.includes(valueKey)) return removeField(valueKey, "values");
    const order = Object.keys(VALUE_FIELDS);
    const at = zones.values.filter(v => order.indexOf(v) < order.indexOf(valueKey)).length;
    moveField(valueKey, null, "values", at);
  }

  // A hidden row is gone from the report, not just from view: its figures leave every total.
  const shownEntries = useMemo(
    () => applyCut(entries, fields, cutOf({ ...zones, filters: [] }, {}, hiddenRows)),
    [entries, fields, zones, hiddenRows]);
  const { tree, cols, colLabels } = useMemo(
    () => buildReportGrid(shownEntries, fields, zones, filterSelections),
    [shownEntries, fields, zones, filterSelections]
  );

  const usesBudget = zones.values.includes("budget") || zones.values.includes("variance");
  const colFieldKey = zones.columns[0] || null;

  // Rows led by GL account read as an income statement, as Budget vs Actuals' own table
  // does: Income, then Operating Expenses, each in GL code order with its own total.
  // Rows led by the source's own lines keep that budget's order, as its page lists them.
  const sectioned = zones.rows[0] === "account" || zones.rows[0] === "line";
  const lineOrder = (n) => budgetLookup?.byLine.get(n.value)?.order ?? Infinity;
  const orderedTree = sortCol ? sortedTree(tree, sortCol, sortDir)
                    : zones.rows[0] === "line" ? [...tree].sort((a, b) => lineOrder(a) - lineOrder(b))
                    : sectioned ? [...tree].sort((a, b) => glOf(a) - glOf(b)) : tree;
  const visibleRows = useMemo(
    () => flattenTree(orderedTree, collapsedKeys, hiddenRows),
    [orderedTree, collapsedKeys, hiddenRows]
  );
  const visibleCols = cols.filter(c => !hiddenCols.has(c));
  const visibleColSet = useMemo(() => new Set(visibleCols), [visibleCols]);
  const hasHidden = hiddenRows.size > 0 || hiddenCols.size > 0;

  function toggleSort(col) {
    if (sortCol !== col) { setSortCol(col); setSortDir(-1); }
    else if (sortDir === -1) setSortDir(1);
    else { setSortCol(null); setSortDir(-1); }
  }
  function hideRow(key) { setHiddenRows(prev => new Set([...prev, key])); }
  function hideCol(c) { setHiddenCols(prev => new Set([...prev, c])); }
  // A new report still laid out as its source's page follows a new source's layout; one
  // its owner has arranged keeps their rows. Rows hidden under the old source go either way.
  function changeSource(id) {
    const rowsOf = (bid) => rowsFromSource(snapshot, bid).join();
    if (!savedReport && zones.rows.join() === rowsOf(budgetId)) {
      setZones(z => ({ ...z, rows: rowsFromSource(snapshot, id) }));
    }
    setHiddenRows(new Set());
    setBudgetId(id);
  }

  // Configure mode only: undoes the hiding until the next Save makes it the report's cut.
  function restoreAll() {
    setHiddenRows(new Set());
    setHiddenCols(new Set());
  }
  function toggleCollapse(key) {
    setCollapsedKeys(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  const showTotal = zones.columns.length > 0;

  // Budget resolves only while the cut leaves whole accounts to compare; see isBudgetComparable.
  const shownCut = cutOf(zones, filterSelections, hiddenRows);
  const budgetCtx = { lookup: usesBudget && isBudgetComparable(shownCut) ? budgetLookup : null, colFieldKey, visibleCols };
  const budgetOf = (node, colKey) => budgetInfoFor(node, colKey, budgetCtx);
  const actualOf = (node, colKey) => actualFor(node, colKey, visibleCols);
  const cellsFor = (node, colKey) => zones.values.map(vf => valueCell(vf, actualOf(node, colKey), budgetOf(node, colKey)));
  const totalFor = (nodes, polarity) => (colKey) => totalCells(nodes, colKey, zones.values, polarity, actualOf, budgetOf);
  const topRows = visibleRows.filter(n => n.depth === 0);
  const footerCellsFor = totalFor(topRows, footerPolarityOf(topRows));
  // Each section's total sums its own top-level rows.
  const sections = sectioned
    ? sectionsOf(visibleRows).map(sec => ({ ...sec, cellsFor: totalFor(sec.rows.filter(n => n.depth === 0), sec.polarity) }))
    : null;

  // Reuses the grid's own budget/actual figures, so the drawer can't
  // disagree with the number the click came from.
  function onDrillCell(node, colKey) {
    if (!drilldown?.openCustomReport) return;
    const cellEntries = entriesForCol(node, zones.columns, fields, colKey, visibleColSet);
    if (!cellEntries.length) return;
    const budgetInfo = budgetOf(node, colKey);
    const colLabel = colKey === ROW_TOTAL_KEY || colKey === TOTAL_KEY ? null : (colLabels.get(colKey) || colKey);
    drilldown.openCustomReport(cellEntries, {
      cellKey: `${node.key}::${colKey}`,
      label: colLabel ? `${node.value} — ${colLabel}` : node.value,
      scopes: drilldownScopes(node, fields),
      budget: budgetInfo?.amt,
      actual: actualOf(node, colKey),
      polarity: budgetInfo?.polarity,
    });
  }

  // A saved report is edited in place, cut afresh from its source; a draft becomes a new
  // report made from its budget. Either way only the accounts left in the cut keep their
  // budget lines.
  async function persist(name) {
    const cut = cutOf(zones, filterSelections, hiddenRows);
    const glCodes = [...new Set(applyCut(entries, fields, cut).map(e => e.acct_type).filter(Number.isInteger))];
    const body = { name, pivot: { zones, filterSelections, hiddenCols: [...hiddenCols], cut }, gl_codes: glCodes };
    // actSaved: a save whose page didn't refresh still counts as saved, so it isn't sent twice.
    if (savedReport) return actSaved(reportsApi, savedReport.id, REPORT_ACTIONS.EDIT, { ...body, from: budgetId });
    return actSaved(reportsApi, budgetId, REPORT_ACTIONS.DERIVE, body);
  }
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  async function handleSave() {
    if (!reportName.trim() || !canSave || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      const { report: saved, notice } = await persist(reportName.trim());
      if (notice) onShareDone?.(notice);
      if (savedReport) setMode("report");
      else if (saved?.id) onOpenReport(saved.id);
      else onCancel?.();
    } catch (e) {
      setSaveError(e.message);
    } finally {
      setSaving(false);
    }
  }

  function handleCancel() {
    if (savedReport) {
      setReportName(savedReport.label || "");
      setZones(savedReport.zones);
      setFilterSelections(savedReport.filterSelections || {});
      setHiddenRows(new Set(savedCut?.hidden?.keys || []));
      setHiddenCols(new Set(savedReport.hiddenCols || []));
      setBudgetId(initial.budgetId);
      setMode("report");
    } else {
      onCancel?.();
    }
  }

  // Distinct values a filter field takes, for its value checklist: sorted, with the
  // no-value case ("No vendor") always last rather than wherever it would sort to.
  const filterOptions = (fieldKey) => {
    const { get, none } = fields[fieldKey];
    const values = [...new Set(entries.map(get))].sort();
    return values.includes(none) ? [...values.filter(v => v !== none), none] : values;
  };

  const titleText = savedReport ? savedReport.label : "New custom report";
  const sourceOptions = [
    ...availableBudgets.map(b => ({ id: b.id, label: b.label || b.id })),
    ...(savedReport ? [{ id: savedReport.id, label: "This report's data only" }] : []),
  ];
  const exportProps = exportPropsFor(snapshot, {
    targetId: REPORT_EXPORT_ID, pageLabel: `Budget vs Actuals — ${titleText}`, slug: "custom-report", eventPage: "CustomReport",
  });
  const rowFieldLabel = fields[zones.rows[0]]?.label || "Rows";

  // Hide/sort/× only render in configure mode — a saved report reads like
  // any other Budget vs Actuals table, apart from the collapse chevron.
  const gridProps = {
    rowFieldLabel, visibleRows, visibleCols, colLabels, zones, showTotal, interactive: mode === "configure",
    sortCol, sortDir, toggleSort, hideRow, hideCol, toggleCollapse, collapsedKeys, cellsFor, footerCellsFor, sections,
    onDrillCell: drilldown?.openCustomReport ? onDrillCell : null,
    hoverCell, onHoverCell: setHoverCell, heldCell: drilldown?.selection?.cellKey || null,
  };

  return (
    <div id={REPORT_EXPORT_ID}>
      <H1
        actions={
          mode === "report" ? (
            <div data-export-exclude style={{ display: "flex", gap: 8 }}>
              {onToggleTheme && <ThemeToggleButton dark={dark} onToggle={onToggleTheme} />}
              {reportsApi?.available && report && (
                <ReportActions
                  report={report} reportsApi={reportsApi} firmName={displayFirmName(snapshot?.firmName)}
                  exportProps={exportProps} accountsData={accountsData} hosted={hosted}
                  onOpenReport={onOpenReport} onShareDone={onShareDone}
                  onEditCustomReport={canSave ? () => setMode("configure") : null}
                />
              )}
              {!(reportsApi?.available && hasSharePanel(report)) && <ExportButton {...exportProps} />}
            </div>
          ) : (
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                type="text"
                placeholder="Report name"
                value={reportName}
                onChange={e => setReportName(e.target.value)}
                style={styles.nameInput}
              />
              <Btn small kind="primary" onClick={handleSave} disabled={!reportName.trim() || !canSave || saving}>
                {savedReport ? "Save" : "Save report"}
              </Btn>
              <Btn small onClick={handleCancel} disabled={saving}>Cancel</Btn>
            </div>
          )
        }
      >
        {titleText}
      </H1>

      {saveError && <p role="alert" style={styles.saveError}>{saveError}</p>}

      {mode === "report" && zones.filters.length > 0 && (
        <FilterRibbon>
          {zones.filters.length > 0 && (
            <div ref={filtersRef} style={styles.filtersWrap}>
              <Btn kind="ghost" size="toolbar" onClick={() => setFiltersOpen(o => !o)}
                   aria-haspopup="dialog" aria-expanded={filtersOpen}
                   className={filtersOpen ? "is-open" : undefined}>
                Filters <Chevron rotate={filtersOpen ? 180 : 0} />
              </Btn>
              {filtersOpen && (
                <div className="gf-panel" style={styles.panelPos} role="dialog" aria-label="Filters">
                  <div className="gf-panel__menu" role="tablist" aria-orientation="vertical" aria-label="Filters">
                    {zones.filters.map(f => (
                      <button key={f} type="button" role="tab" aria-selected={activeFilterPane === f}
                              className={`gf-navitem${activeFilterPane === f ? " gf-navitem--active" : ""}`}
                              onClick={() => setActiveFilterPane(f)}>
                        {fields[f].label}
                        {selectedValues(filterDraft[f]).length > 0 && (
                          <Bubble tone="info">{selectedValues(filterDraft[f]).length}</Bubble>
                        )}
                      </button>
                    ))}
                  </div>
                  <div className="gf-panel__right">
                    <div className="gf-panel__view" role="tabpanel">
                      {activeFilterPane && (
                        <>
                          <h3 className="gf-view__title">Filter by {fields[activeFilterPane].label}</h3>
                          <ValueChecklist
                            options={filterOptions(activeFilterPane)}
                            selected={selectedValues(filterDraft[activeFilterPane])}
                            onChange={vals => setFilterDraft(prev => ({ ...prev, [activeFilterPane]: vals }))} />
                        </>
                      )}
                    </div>
                    <div className="gf-actions">
                      <button type="button" className="gf-btn gf-btn--ghost"
                              onClick={() => setFilterDraft(Object.fromEntries(zones.filters.map(f => [f, []])))}>
                        Reset
                      </button>
                      <button type="button" className="gf-btn gf-btn--primary"
                              onClick={() => { setFilterSelections(filterDraft); setFiltersOpen(false); }}>
                        Apply
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
          {zones.filters.filter(f => selectedValues(filterSelections[f]).length).map(f => (
            <Tag key={f} tone="info" style={styles.filterChip}>
              {fields[f].label}: {summarize(selectedValues(filterSelections[f]))}
              <button type="button" className="tag-close-btn" aria-label={`Clear ${fields[f].label}`}
                      onClick={() => setFilterSelections(prev => ({ ...prev, [f]: [] }))}>
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
                  <path d="M2 2L8 8M8 2L2 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </button>
            </Tag>
          ))}
        </FilterRibbon>
      )}

      {mode === "report" && <ReportGrid {...gridProps} />}

      {mode === "configure" && (
        <>
          {zones.filters.length > 0 && (
            <div style={styles.filterRow}>
              {zones.filters.map(f => (
                <div key={f} style={styles.filterField}>
                  <span style={styles.configLabel} id={`report-filter-${f}`}>{fields[f].label}</span>
                  <MultiSelect
                    labelId={`report-filter-${f}`} label={fields[f].label} options={filterOptions(f)}
                    selected={selectedValues(filterSelections[f])}
                    onChange={vals => setFilterSelections(prev => ({ ...prev, [f]: vals }))} />
                </div>
              ))}
            </div>
          )}

          {(sourceOptions.length > 0 || hasHidden) && (
            <div style={styles.filterRow}>
              {sourceOptions.length > 0 && (
                <label style={styles.filterField}
                       title={usesBudget ? "" : "Tick Budget or Var $ under Values to use this"}>
                  <span style={styles.configLabel}>Source</span>
                  <select aria-label="Source" value={budgetId || ""} onChange={e => changeSource(e.target.value)} style={styles.select}>
                    {sourceOptions.map(b => <option key={b.id} value={b.id}>{b.label}</option>)}
                  </select>
                </label>
              )}
              {hasHidden && (
                <button onClick={restoreAll} style={styles.restoreBtn} type="button">
                  Restore hidden ({hiddenRows.size + hiddenCols.size})
                </button>
              )}
            </div>
          )}

          <div style={styles.body}>
            <div style={styles.tableCol}>
              <ReportGrid {...gridProps} />
            </div>
            <FieldsPanel
              fields={fields}
              fieldKeys={fieldKeys}
              zones={zones}
              onToggleValue={toggleValue}
              onMoveField={moveField}
              onRemoveField={removeField}
              dragOverZone={dragOverZone}
              setDragOverZone={setDragOverZone}
            />
          </div>
        </>
      )}
    </div>
  );
}

const styles = {
  saveError: { ...sans, color: "var(--red)", fontSize: FS.body, margin: "0 0 12px" },
  nameInput: {
    ...sans, fontSize: FS.body, color: INK, background: PAPER,
    border: `1px solid ${LINE}`, borderRadius: 4, padding: "6px 8px", width: 180,
  },
  filtersWrap: { position: "relative", display: "inline-flex", alignItems: "center" },
  panelPos: { position: "absolute", top: "calc(100% + 6px)", left: 0, zIndex: 40 },
  filterChip: { gap: 4, paddingRight: 4, fontWeight: 500 },
  filterRow: { display: "flex", alignItems: "center", gap: 16, marginBottom: 14, flexWrap: "wrap" },
  filterField: { display: "flex", alignItems: "center", gap: 6 },
  // Ink form label: sentence case, the control's own type size.
  configLabel: { ...sans, fontSize: FS.bodyLg, lineHeight: "20px", fontWeight: 500, color: INK, whiteSpace: "nowrap" },
  // Ink input: interactive border, 4px radius, toolbar height.
  select: {
    ...sans, ...TOOLBAR_CONTROL_STYLE, color: INK, background: PAPER, boxSizing: "border-box",
    border: "1px solid var(--ink-color-global-border-default)", borderRadius: 4, cursor: "pointer",
  },
  restoreBtn: {
    ...sans, fontSize: FS.body, color: FAINT, background: "none",
    border: `1px solid ${LINE}`, borderRadius: 4, padding: "5px 10px", cursor: "pointer",
  },
  body: { display: "flex", gap: 20, alignItems: "flex-start" },
  tableCol: { flex: 1, minWidth: 0 },
};
