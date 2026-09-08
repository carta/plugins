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

`app/build.mjs` rebuilds `webapp/vendor/` and preserves the tracker across that rebuild.
It is hand-vendored, not generated, so nothing else would put it back.

## Firm, user and environment

`GET /api/telemetry-context` (`scripts/serve.py`) returns `{firmId, environment, userId}`.

- `firmId` becomes an `iglu:com.carta/firm/jsonschema/1-1-0` context on every event, so
  telemetry joins on the real Carta id rather than a slugified firm name. It is omitted
  entirely when the id does not resolve — a placeholder would pollute the firm dimension.
- `userId` comes from `serve.py --user-id`, which is **optional**. A launch that omits it
  emits events with no user attached, so measure the unattributed share before trusting
  any per-user figure.
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
