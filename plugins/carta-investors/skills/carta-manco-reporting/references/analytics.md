# Analytics events

Snowplow UI events through `@carta/mcp-ui-tracker`, vendored at
`webapp/vendor/mcp-ui-tracker.global.js`. `app/src/analytics.js` holds the wiring and
exports `trackClick` / `trackRender`, matching `carta-fund-modeling`'s own module.

## Conventions

Ids read `MancoReporting.<Area>.<Specific>` and are **literals at the call site**. A page
or dialog becoming visible is a `render` of `<Area>.View`; everything else is a `click`.

Where an id needs a lookup, the map lives beside its use — `App.jsx`'s `VIEW_NAMES`,
`DrilldownDrawer.jsx`'s `DRILL_NAMES`, `Sidebar.jsx`'s `NAV_EVENTS` — the shape
fund-modeling uses for `TAB_VIEW_NAMES` and `useShare.js`'s `EVENT`.

Two rules the maps exist to enforce:

1. **Never interpolate customer data into an id.** A Budget-vs-Actuals child slug *is* a
   budget id read out of the firm's own Excel workbook. Putting it in an id makes the
   catalogue unbounded, breaks cross-firm aggregation, and writes firm-identifying text
   into a field nobody reviews. Interpolating a *mapped* name is fine; interpolating the
   raw slug is the bug.
2. **One event per user act.** A drill-down cell click is already
   `Drilldown.Open.OutlineCell`; a dialog opening is already its `.View`. Two events for
   one act double every rate computed from them.

One view event per route becoming active, fired from a single effect in `App.jsx` — it
waits for the snapshot, because until that lands Budget-vs-Actuals is filtered out of
`navItems` and the route resolver falls back to `dashboard`. A page component must not
fire its own `.View` as well.

Three more shapes the catalogue uses:

- **Where a drill came from.** A drill kind with more than one entry point carries a
  mapped suffix: `Drilldown.Open.<Kind>.<Source>`, built by `drillOpenEvent` in
  `DrilldownDrawer.jsx` from the selection's `from` (or a department drill's `origin`)
  through `DRILL_SOURCES`. Callers pass a fixed token (`"dashboard"`, `"chart"`), never a
  label. A kind with one entry point, or an unmapped token, keeps the plain
  `Drilldown.Open.<Kind>`, so `Open.<Kind>%` still counts every drill of that kind. A new
  entry point for an existing kind gets a new `DRILL_SOURCES` entry.
- **What the reader was not shown.** A card or list the firm's data cannot fill is left
  out rather than rendered empty, so its absence is a `render` of `<Area>.<Thing>Hidden`
  or `<Area>.<Thing>Empty`. Without it, a card nobody saw reads as a card nobody used.
- **Once, not per frame.** Renders fire from an effect keyed on the thing that changed
  (the selection, the budget, the date range). A hover or a scroll reports its first
  occurrence (`Dashboard.CashDetailHover` on opening, `Drilldown.EntriesLoadMore` once per
  list), never each event.

## Changing the app — instrument it in the same change

Every change to `app/src` that adds or changes something a user can see or do must add
or update its event in the same change. That covers a control, a page, a panel, a drill
entry point, or a state that shows or hides content. Before calling the change done:

1. **Name it** per the conventions above: a literal id at the call site, or a mapped name
   from a lookup beside it. Never customer data.
2. **Check it is one event per act.** If the act already reaches a `.View` or a
   `Drilldown.Open.*`, do not add a second event. Extend the map instead.
3. **Catalogue it.** Add a row to the catalogue below, or update the row when the
   meaning changes. Remove the row when the control goes. Renaming an id breaks every
   query built on it, so do it only when the old name is wrong, and call the rename out.

## Event catalogue

Every row spells the full id, prefix included.

### App

| Id | Action | Fires when |
|---|---|---|
| `MancoReporting.App.Load` | render | The bundle mounted (`main.jsx`), after the tracker initialised. |
| `MancoReporting.App.AuthFailed` | render | The dashboard token was rejected and the auth-error page showed. |
| `MancoReporting.App.DataNotReady` | render | `/api/snapshot` answered `not_ready`: the skill has not written the snapshot yet. |
| `MancoReporting.App.SnapshotError` | render | The snapshot failed or returned any other error. |
| `MancoReporting.App.AccountsUnavailable` | render | `/api/accounts` failed. Every drill-down is disabled for the session. |
| `MancoReporting.App.BudgetVsActualsHidden` | render | The firm has no budget loaded, so Budget vs Actuals is not offered — Monthly Actuals is offered in its place. |
| `MancoReporting.App.ToggleTheme` | click | Light/dark toggle, on either page. |
| `MancoReporting.App.ImportBudget` | click | "Import budget" in the sidebar (hosted app only): opens the file picker for an exported budget bundle. |
| `MancoReporting.App.RemoveBudget` | click | "Remove" beside an uploaded budget: restores Carta's stored budget. |
| `MancoReporting.App.DownloadBudget` | click | The download icon beside an uploaded budget's note: saves the stored bundle as JSON, to fix and import again. |

### Navigation

| Id | Action | Fires when |
|---|---|---|
| `MancoReporting.Nav.Dashboard` | click | Sidebar → Dashboard. |
| `MancoReporting.Nav.BudgetVsActuals` | click | Sidebar → Budget vs Actuals. |
| `MancoReporting.Nav.MonthlyActuals` | click | Sidebar → Monthly Actuals. Shown only while this firm has no budget. |
| `MancoReporting.Nav.BudgetVsActualsBudget` | click | Sidebar → one budget under Budget vs Actuals. The budget id stays out of the event. |
| `MancoReporting.Nav.SharedReport` | click | Sidebar → a report someone shared with you, under "Shared with you". The report id stays out of the event. |
| `MancoReporting.Nav.LoadSharedReports` | click | Sidebar → "Load shared reports" (or "Check for new shared reports"). |
| `MancoReporting.Nav.ShowHiddenReports` | click | Sidebar → "Show N hidden" under "Shared with you". |
| `MancoReporting.Nav.AutoLoadSharedReportsFailed` | render | The hosted app's own check for new shared reports (on open, or when the tab came back) failed. Nothing shown to the user; "Load shared reports" still retries. |

### Dashboard

| Id | Action | Fires when |
|---|---|---|
| `MancoReporting.Dashboard.CashDetailHover` | click | The cash-balance-by-account card opened (hover or focus). |
| `MancoReporting.Dashboard.CashUnavailable` | render | The Cash Balance tile has no balance to show. |
| `MancoReporting.Dashboard.VendorSpendHidden` | render | Top Vendors left out: no vendor spend. |
| `MancoReporting.Dashboard.FeeIncomeHidden` | render | Management Fee Income left out: no fee schedule. |
| `MancoReporting.Dashboard.BudgetChartHidden` | render | YTD Budget vs Actuals chart left out: no budget totals. |
| `MancoReporting.Dashboard.SpendByGLHidden` | render | No variance chart and no GL spend to stand in for it. |
| `MancoReporting.Dashboard.FundSelectorOpen` | click | Fee-income fund filter opened (not when closed). |
| `MancoReporting.Dashboard.SelectFunds` | click | A fund ticked or unticked in that filter. |
| `MancoReporting.Dashboard.SelectAllFunds` | click | "Select all" in that filter. |
| `MancoReporting.Dashboard.ToggleProjections` | click | Fee-income projections shown or hidden. |
| `MancoReporting.Dashboard.VarianceBudgetSelect` | click | The variance chart switched to another budget. |
| `MancoReporting.Dashboard.VarianceSideToggle` | click | The variance chart flipped between Overspend and Underspend. |
| `MancoReporting.Dashboard.VarianceEmpty` | render | The variance chart has no categories on the chosen side. |
| `MancoReporting.DateRangePanel.View` | render | The monthly-expenses date-range popover opened. |
| `MancoReporting.Dashboard.DateRangePreset` | click | A date-range preset picked. |
| `MancoReporting.Dashboard.DateRangeCustom` | click | A start or end date typed. |
| `MancoReporting.Dashboard.ExpandExpenseCategory` | click | The expense breakdown's "Show N more" / "Show less". |
| `MancoReporting.Dashboard.ExpenseBreakdownEmpty` | render | The expense breakdown has nothing in the chosen range. |

### Budget vs Actuals

| Id | Action | Fires when |
|---|---|---|
| `MancoReporting.BudgetVsActuals.LayoutAccounts` | render | The budget rendered by account. Fires again when a budget switch changes the layout. |
| `MancoReporting.BudgetVsActuals.LayoutOutline` | render | The budget rendered as the workbook's own outline. |
| `MancoReporting.BudgetVsActuals.LayoutCrosstab` | render | The budget rendered as the department (tag) crosstab. |
| `MancoReporting.BudgetVsActuals.UnsupportedView` | render | The budget declares a view the app cannot render. |
| `MancoReporting.BudgetVsActuals.PeriodChange` | click | The Period (frequency) dropdown changed. |
| `MancoReporting.BudgetPeriodPanel.View` | render | A period popover opened: the month-range picker or the crosstab's period picker. |
| `MancoReporting.BudgetVsActuals.PeriodPreset` | click | A date-range preset picked in the month-range picker. |
| `MancoReporting.BudgetVsActuals.PeriodCustom` | click | The From or To month changed by hand. |
| `MancoReporting.BudgetVsActuals.ExtendThroughToday` | click | Crosstab period picked: the budget's own window or year to date. |
| `MancoReporting.BudgetVsActuals.FiltersClear` | click | The toolbar Reset: every filter back to default. |
| `MancoReporting.BudgetVsActuals.FilterChipRemove` | click | An applied-filter chip dismissed. |
| `MancoReporting.BudgetFilterPanel.View` | render | The Filters panel opened. |
| `MancoReporting.BudgetVsActuals.FilterTabColumns` | click | Filters panel → Columns tab (clicked or reached by arrow key). |
| `MancoReporting.BudgetVsActuals.FilterTabYtd` | click | Filters panel → Year-to-Date tab. |
| `MancoReporting.BudgetVsActuals.FilterTabBreakouts` | click | Filters panel → Break outs tab. |
| `MancoReporting.BudgetVsActuals.FilterTabDepartments` | click | Filters panel → departments (top N / all) tab. |
| `MancoReporting.BudgetVsActuals.FilterTabHiddenRows` | click | Filters panel → Hidden rows tab. |
| `MancoReporting.BudgetVsActuals.ToggleHideColumn` | click | Draft: hide or show the Actual, Budget or Variance column. |
| `MancoReporting.BudgetVsActuals.ToggleShowYtd` | click | Draft: YTD column on or off. |
| `MancoReporting.BudgetVsActuals.BreakoutChange` | click | Draft: break rows out by another dimension. |
| `MancoReporting.BudgetVsActuals.ToggleShowAll` | click | Draft: top-N versus all departments. |
| `MancoReporting.BudgetVsActuals.ToggleShowHidden` | click | Draft: show rows hidden in the workbook. |
| `MancoReporting.BudgetVsActuals.FilterReset` | click | The panel's Reset (draft only). |
| `MancoReporting.BudgetVsActuals.FilterApply` | click | The panel's Apply. |
| `MancoReporting.BudgetVsActuals.AccountsExpandRow` | click | By-account layout: an account row expanded or collapsed. |
| `MancoReporting.BudgetVsActuals.OutlineToggleGroup` | click | Outline layout: a section collapsed or expanded. |
| `MancoReporting.BudgetVsActuals.OutlineToggleLine` | click | Outline layout: a line's breakout expanded or collapsed. |
| `MancoReporting.BudgetVsActuals.CrosstabExpandRow` | click | Crosstab layout: a row's breakout expanded or collapsed. |

The Period, Filters and date-range ids above also fire from Monthly Actuals, which shares
that toolbar; `MancoReporting.MonthlyActuals.View` tells the two pages apart.

### Monthly Actuals

| Id | Action | Fires when |
|---|---|---|
| `MancoReporting.MonthlyActuals.ExpandRow` | click | An account row's breakout expanded or collapsed. |

### Budget reports and sharing

| Id | Action | Fires when |
|---|---|---|
| `MancoReporting.ReportMenu.Duplicate` | click | Report menu (⋯) → Duplicate. |
| `MancoReporting.ReportMenu.Rename` | click | Rename dialog → Save. |
| `MancoReporting.ReportMenu.Hide` | click | Report menu → Hide. |
| `MancoReporting.ReportMenu.Delete` | click | "Delete this copy" / "Remove from my reports" confirmed. |
| `MancoReporting.ReportNotice.Duplicate` | click | "Duplicate" on a report shared with you. |
| `MancoReporting.ReportNotice.ShareUpdate` | click | The cloud-upload icon (tooltip "Share update") beside "Changes not shared yet" — pushes the changes to the same people without opening the Share dialog. |
| `MancoReporting.ShareDialog.View` | render | The Share panel opened, for a new or an already shared report. |
| `MancoReporting.ShareDialog.Share` | click | Share, Update or Save changes in the Share dialog. |
| `MancoReporting.ShareDialog.Overwrite` | click | "Overwrite with my version" after the shared copy changed on Carta. |
| `MancoReporting.ShareDialog.AddPerson` | click | A person added from the list of people who can see the entity. |
| `MancoReporting.ShareDialog.RemovePerson` | click | A person's access removed (takes effect on save). |
| `MancoReporting.ShareDialog.RefreshPeople` | click | "Refresh" under the people list: asks Carta again instead of using the list saved within the last day. |
| `MancoReporting.ShareDialog.StopSharing` | click | "Stop sharing for everyone" confirmed. |
| `MancoReporting.ShareDialog.ShareAsNew` | click | "Share as new" after the shared copy was deleted. |
| `MancoReporting.ShareDialog.KeepPrivate` | click | "Keep private" after the shared copy was deleted. |
| `MancoReporting.ShareDialog.ShareTab` | click | The Share tab of the Share panel. |
| `MancoReporting.ShareDialog.ExportTab` | click | The Export tab of the Share panel (the HTML download itself is `BudgetVsActuals.ExportHtml`). |
| `MancoReporting.ShareDialog.GeneralAccessPeople` | click | General access set to "Only people you add". |
| `MancoReporting.ShareDialog.GeneralAccessEveryone` | click | General access set to everyone at the firm who can view the entity's accounting. |
| `MancoReporting.ShareDialog.CopyFixPrompt` | click | Copy on the Claude install/sign-in prompt shown in the Share panel: a failed share, publish-as-new, delete, or people lookup whose error names the `claude` CLI itself as the problem. |
| `MancoReporting.ShareDialog.SignIn` | click | "Sign in to Claude" shown in the Share panel for a `not_logged_in` error (a failed share, publish-as-new, delete, or people lookup). |
| `MancoReporting.ShareStatus.CopyPrompt` | click | Copy on the ask-Claude prompt for a failed shared-reports load. |
| `MancoReporting.ShareStatus.CopyFixPrompt` | click | Copy on the Claude install/sign-in prompt for a failed shared-reports load whose error names the `claude` CLI itself as the problem. |
| `MancoReporting.ShareStatus.SignIn` | click | "Sign in to Claude" shown for a failed shared-reports load coded `not_logged_in`. |

### Drill-down drawer

| Id | Action | Fires when |
|---|---|---|
| `MancoReporting.Drilldown.Close` | click | Drawer closed by ×, Escape or clicking outside. |
| `MancoReporting.Drilldown.ProjectedYear` | render | The drill is a projected fee year: a schedule summary, no entries. |
| `MancoReporting.Drilldown.ScheduleOnly` | render | The year has schedule figures but no ledger entries. |
| `MancoReporting.Drilldown.EmptyEntries` | render | "No journal entries in this slice." |
| `MancoReporting.Drilldown.EntriesLoadMore` | click | The reader scrolled past the first chunk of entries (once per list). |
| `MancoReporting.Drilldown.OpenJournalEntry` | click | "View journal entry" link to Carta. |
| `MancoReporting.Drilldown.ExpandGLBreakdown` | click | A month drill's GL breakdown expanded or collapsed. |
| `MancoReporting.DrilldownFilterPanel.View` | render | The drawer's Filters panel opened. |
| `MancoReporting.Drilldown.TabTags` | click | Drawer filters → Tags tab. |
| `MancoReporting.Drilldown.TabAccounts` | click | Drawer filters → Accounts tab. |
| `MancoReporting.Drilldown.ToggleTagFilter` | click | Draft: a reporting-tag value ticked or unticked. |
| `MancoReporting.Drilldown.ToggleAccountFilter` | click | Draft: an account ticked or unticked. |
| `MancoReporting.Drilldown.FilterReset` | click | The drawer panel's Reset (draft only). |
| `MancoReporting.Drilldown.FilterApply` | click | The drawer panel's Apply. |
| `MancoReporting.Drilldown.FilterApplyOnClose` | click | The drawer filter committed by clicking away or pressing Escape. |
| `MancoReporting.Drilldown.FilterChipRemove` | click | An applied drawer-filter chip dismissed. |

### Composed ids

Built from a map, so no single literal holds them. `App.jsx`'s `VIEW_NAMES` and
`DrilldownDrawer.jsx`'s `DRILL_NAMES` / `DRILL_SOURCES` are the source of truth. Update
this table with the map. The `ExportHtml` ids are composed by `ui/exportHtml.js`'s
`exportPropsFor` from each page's `eventPage`; `analyticsCatalogue.test.js` reads every
`eventPage:` literal in the source and fails when a page's three rows are missing here,
or when a row here names a page nothing emits.

| Id | Action | Fires when |
|---|---|---|
| `MancoReporting.Dashboard.View` | render | Dashboard route became active. |
| `MancoReporting.BudgetVsActuals.View` | render | Budget vs Actuals route became active. |
| `MancoReporting.MonthlyActuals.View` | render | Monthly Actuals route became active. |
| `MancoReporting.Drilldown.Open.Account.Dashboard` | render | Account drill from the Dashboard's spend-by-GL chart. |
| `MancoReporting.Drilldown.Open.Account.BudgetVsActuals` | render | Account drill from a Budget vs Actuals by-account row or cell. |
| `MancoReporting.Drilldown.Open.Account.MonthlyActuals` | render | Account drill from a Monthly Actuals row or cell. |
| `MancoReporting.Drilldown.Open.DepartmentAccount.BudgetVsActuals` | render | Crosstab (department × account) cell drill. |
| `MancoReporting.Drilldown.Open.DepartmentAccount.DashboardVariance` | render | Dashboard variance-chart bar drill. |
| `MancoReporting.Drilldown.Open.DateRangeCategory.Chart` | render | Monthly-expenses chart bar drill (that month). |
| `MancoReporting.Drilldown.Open.DateRangeCategory.Breakdown` | render | Expense breakdown row drill (the picked range). |
| `MancoReporting.Drilldown.Open.Vendor` | render | Top Vendors bar drill. |
| `MancoReporting.Drilldown.Open.MonthSide` | render | Income/expense cashflow bar drill. |
| `MancoReporting.Drilldown.Open.FundYear` | render | Fee-income bar drill. |
| `MancoReporting.Drilldown.Open.OutlineCell` | render | Outline-layout cell drill. |
| `MancoReporting.Drilldown.Open.OutlineTotal` | render | Outline-layout total drill. |
| `MancoReporting.Drilldown.Open.Other` | render | A drill kind missing from `DRILL_NAMES`, which is a bug to fix. |
| `MancoReporting.Dashboard.ExportHtml` | click | Dashboard: Export pressed. |
| `MancoReporting.Dashboard.ExportHtmlSucceeded` | click | Dashboard: the export file was produced. |
| `MancoReporting.Dashboard.ExportHtmlFailed` | click | Dashboard: the export threw, or its target was missing. |
| `MancoReporting.BudgetVsActuals.ExportHtml` | click | Budget vs Actuals: Export pressed. |
| `MancoReporting.BudgetVsActuals.ExportHtmlSucceeded` | click | Budget vs Actuals: the export file was produced. |
| `MancoReporting.BudgetVsActuals.ExportHtmlFailed` | click | Budget vs Actuals: the export threw, or its target was missing. |
| `MancoReporting.MonthlyActuals.ExportHtml` | click | Monthly Actuals: Export pressed. |
| `MancoReporting.MonthlyActuals.ExportHtmlSucceeded` | click | Monthly Actuals: the export file was produced. |
| `MancoReporting.MonthlyActuals.ExportHtmlFailed` | click | Monthly Actuals: the export threw, or its target was missing. |

`Drilldown.Open.Account`, `.DepartmentAccount` and `.DateRangeCategory` without a suffix
still fire for an entry point `DRILL_SOURCES` does not map. There is no separate click
event for a breakdown-row click — `Drilldown.Open.DateRangeCategory.Breakdown` already
counts it.

## The transport

`webapp/index.html` loads the tracker as a global `<script>`, setting
`window.mcpUiTracker`. Every `track*` call no-ops when that global or its transport is
missing, so telemetry can never break the dashboard — and a broken transport is therefore
invisible unless something says so. Three things do:

- `analytics.js` logs one `console.warn` the first time an event is dropped.
- `serve.py`'s startup banner names the file when it is absent.
- `tests/carta-investors/test_microapp_asset_paths.py` asserts every shell asset resolves
  on disk **and** that the tracker is JavaScript rather than markup.

That last assertion exists because a missing bundle does not 404. `serve.py` answers an
unknown path with the SPA fallback, so the request returns `200 OK` with `text/html` and
the bytes of `index.html`. The network tab looks healthy; the browser throws
`Unexpected token '<'` and leaves `window.mcpUiTracker` undefined.

`app/build.mjs` removes and rewrites only the bundles it generates, so the tracker, which is
hand-vendored rather than generated, stays in place across a rebuild. It warns if the file is missing.

## Firm, user and environment

`GET /api/telemetry-context` (`scripts/serve.py`) returns `{firmId, environment, userId}`.

- `firmId` becomes an `iglu:com.carta/firm/jsonschema/1-1-0` context on every event, so
  telemetry joins on the real Carta id rather than a slugified firm name. It is omitted
  entirely when the id does not resolve — a placeholder would pollute the firm dimension.
- `userId` comes from `<dashboard_dir>/.user-id` (`manco_paths.read_user_id`) — written by
  `serve.py --user-id` at launch, or earlier by the build-path flow in
  `${CLAUDE_PLUGIN_ROOT}/references/launch-user-id.md`, whichever ran last. It's **optional**:
  a dashboard nothing has written it for yet emits events with no user attached, so measure
  the unattributed share before trusting any per-user figure.
- `environment` is `nonprod` only when stated explicitly; anything else means production.

## Not instrumented

Deliberate gaps, all blocked on the same decision — a payload needs an agreed iglu
schema, and `buildUiEvent` discards every key but `elementId` on a render:

- **Time to first render**, which would need a duration on the event.
- **A launch capability summary** (budget count, view kinds, currency), which would need an
  object. The two capability facts with clear action attached are events already:
  `App.AccountsUnavailable` and `App.BudgetVsActualsHidden`.
- **The skill side.** `build_manco_datadir.py`, `parse_budget_workbook.py` and
  `parse_coa_mapping.py` emit nothing; `serve.py` only serves telemetry context. Ingest
  failures and unmapped-line counts are printed to the operator and then discarded.
