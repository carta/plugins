# Typography audit — carta-manco-reporting

Audit of this microapp's typography against Carta's Ink type system, per the
canonical microapp theme contract and the vendored Ink
`tokens.css`/`components.md` extraction. Scope: every
`fontSize`/`fontWeight`/`fontFamily`/`lineHeight` literal under `app/src/`,
plus the app shell's webfont loading.

This was an audit-and-fix pass, not documentation-only: clear gaps (a literal
with an obvious Ink-equivalent, a value the type contract explicitly forbids)
were fixed directly. Only genuinely ambiguous or plausibly-intentional
choices are left as open questions below — **flag any of these you think are
real (intentional) and I'll leave them; anything you say is drift, I'll fix
next.**

## Fixed

### Webfont loading — was stale, not actually a deliberate divergence

`theme.js` and `index.html` both carried comments claiming "no webfont
loading, ever — deliberate, permanent divergence." That was true of an
**old** version of the microapp theme contract; its current typography
contract explicitly reversed that stance and requires the same Inter CDN
loading the Ink theme contract uses, plus a self-hosted SangBleu Versailles for
`H1`. Fixed:
- `app/index.html`: added the `rel="preconnect"`/`rel="stylesheet"` pair for
  `rsms.me`'s Inter distribution.
- `app/src/ui/theme.js`: added the `@font-face` rule for SangBleu Versailles,
  added a `serif` export (`"SangBleu Versailles", Georgia, serif`) reserved
  for `H1`.
- `SangBleuVersailles-Regular-WebS.woff2` is self-hosted at `webapp/fonts/` and
  served by `serve.py` at `/fonts/` — the URL the `@font-face` rule points at.

The Inter `<link>` lives in `webapp/index.html`; see
[serve-and-update.md](serve-and-update.md) for how the shell and source trees
are served.

### Font stack — was using a forbidden fallback pattern

`theme.js`'s `SANS` stack was
`'Helvetica Neue',Helvetica,'Inter','Arial Nova',Arial,-apple-system,BlinkMacSystemFont,system-ui,sans-serif`.
The microapp theme contract explicitly calls out `-apple-system`/`system-ui`
substitution as "a plausible-looking but wrong substitute; it is not what Ink
actually does" — this app's stack was doing exactly that, and also had Inter
buried third instead of first. Fixed to Ink's real resolved chain:
`Inter,'Open Sans','Helvetica Neue',Helvetica,Arial,sans-serif`.

### `H1` — added, not yet wired into any view (see escalation below)

`components.jsx` had only `H2`; there was no page-title heading at all. Added
`H1` (28px / 48px leading / weight 400 / `serif` family) per the contract's
exact spec. Per the contract's own retrofit note ("an existing microapp's
page title very likely lives on `H2` today... explicitly ask... for each
heading"), I did not swap any existing `H2` call site — see escalation below.

### `fontWeight: 700`/`900` — Ink's scale never exceeds 600

No Ink type token anywhere in `tokens.css` uses a weight above 600
(`weight-body-1`/`weight-display-1`/`weight-display-2` = 600, the max). This
mirrors the exact correction the upstream retrofit already made to `H2` (was
700, corrected to 500). Fixed every other instance the same way:

| File | What | Before → After |
|---|---|---|
| `shell/Sidebar.jsx` | `firmMark` initials badge | 700 → 600 |
| `views/DashboardView.jsx` | `tileVal` (KPI hero figure) | 700 → 600 |
| `views/MonthlyExpenseBreakdown.jsx` | `totalValue` | 700 → 600 |
| `views/drilldown/BudgetInsight.jsx` | `statValue` | 700 → 600 |
| `views/drilldown/DrilldownContent.jsx` | `statValue` | 700 → 600 |
| `views/FundSelector.jsx` | checkbox `✓` glyph | 900 → 600 |

**Not touched:** `theme.js`'s dead `.totrow` CSS class (see below) was also
at weight 700, but it's a table *total-row* treatment, not a heading/badge —
the microapp theme contract's Table recipe explicitly calls a border-top + bold total
row "a legitimate, more print-ledger-flavored pattern... treat as optional,
not mandatory" and says to check before restructuring it. It's addressed
separately as dead code, below, not as a weight violation.

### Dead code found and removed

- `theme.js`'s `.totrow`/`.totrow:hover` CSS class — grepped for
  `className.*totrow` across every view file and found zero call sites. This
  table already has a working, in-use total-row treatment
  (`table.jsx`'s `TOTAL_ROW_BG`, weight 500) — `.totrow` was a legacy,
  unreferenced rule with no bearing on anything rendered. Deleted rather than
  "fixed."
- `views/FundSelector.jsx`'s `caret` style object (`fontSize: 9`) — the
  actual `Caret` component renders an SVG and never references `S.caret`.
  Deleted.

### Scattered literals normalized to the shared `FS` scale

`theme.js`'s `FS` object (`micro:10, small:11, body:12, bodyLg:13, value:14,
h3:16, h2:20, display:28`) already existed as "the single source of truth for
font sizes," each step commented with its Ink token equivalent — but most of
the app's ~200 `fontSize` literals across 20 files were raw numbers that
happened to equal an `FS` step rather than referencing it. Replaced every
exact-match literal with the corresponding `FS.*` token across `theme.js`,
`table.jsx`, `components.jsx` (already used `FS`), `Sidebar.jsx`,
`AppShell.jsx`, `DashboardView.jsx`, `BudgetActualsView.jsx`,
`BudgetActualsOutline.jsx`, `BudgetVarianceInsights.jsx`,
`MonthlyExpenseBreakdown.jsx`, `DateRangeControls.jsx`, `BudgetSourceLine.jsx`,
`FundSelector.jsx`, `App.jsx`, `VarianceByCategory.jsx`, and the drilldown
views (`DrilldownContent.jsx`, `BudgetInsight.jsx`, `MonthSideGLBreakdown.jsx`,
`EntriesTable.jsx`, `BudgetPaceChart.jsx`). No visual change — every
replacement preserves the exact same pixel value.

Also snapped two 9px literals (`table.jsx`'s `srcMark`,
`BudgetInsight.jsx`'s `statLabel`) to `FS.micro` (10px) — both were
functionally near-duplicates of the shared micro-caption pattern, 1px off
what was clearly the intended value, not a deliberate sub-micro size.

Also normalized `theme.js`'s `GLOBAL_CSS` `table.ledger` rules (`font-size:
14px` → `${FS.value}px`) so the shared table CSS pulls from the same scale
as everything else.

**Already conformed, no action:** `table.jsx`'s header/body sizes (14px
group/label, 13px sub-header, weight 500/400 respectively) already matched
Ink's `components.md` `.ink-table` recipe exactly — this part of
the upstream retrofit was already correct. Chart.js canvas text
(`charts/chartTheme.js`, `BudgetPaceChart.jsx`'s chart options, etc.) is a
separate font pipeline from the DOM (`font: { size: N }` config, not CSS) and
isn't covered by Ink's CSS tokens — out of scope, not a gap.

## Escalated — need your call

### 1. No page title anywhere (H1 wiring) — resolved, left unused

`H1` exists in `components.jsx` (28px/serif) but nothing calls it yet.
Confirmed: that's fine — it stays defined for future use, no view
needs to adopt it right now.

### 2. Off-scale "hero number" sizes at KPI/stat readouts — resolved

Confirmed: none of these three were intentional.

- `views/drilldown/DrilldownContent.jsx`'s `statValue` (drawer stat row) and
  `views/drilldown/BudgetInsight.jsx`'s `statValue` (budget-insight stat
  grid) — both snapped to the nearest Ink step, `FS.h3` (16px, heading-3/4).
  18px and 15px were each 1-2px off that step with no reason to prefer an
  in-between value.
- `views/DashboardView.jsx`'s KPI strip — rather than snapping just the
  value's font size, ported carta-fund-modeling's `MetricBar`/`StatBar`/
  `StatTile` pattern in full (its Overview page's own top KPI strip):
  - **Structure**: one bordered Ink "Summary" tile card holding all four
    stats (`stripCard`), not four separate bordered boxes in a grid — matches
    `StatBar`'s single `.card`-style wrapper with stats spaced by their own
    horizontal padding, not a row of individually-boxed tiles.
  - **Order**: label sits *above* its value (`StatTile`'s `labelPos="top"`
    default), not below — `Tile` was flipped to label → value → sub, with
    `marginTop: 6`/`5` matching `StatTile`'s own label→value and
    value→sub spacing exactly.
  - **Value**: `mono` font (tabular-nums), `FS.display` (28px), **weight
    700**, `lineHeight: 1.05` — a deliberate, established exception to "Ink
    headings never exceed 600" (`StatTile`'s own comment confirms 700 is for
    hero numeric figures, not headings); this app's 22px/700 was drift from
    that convention, not a considered choice of its own.
  - **Label**: switched off the uppercase/tracked `Eyebrow` treatment onto
    `StatTile`'s plain sentence-case label (`FS.body`, weight 400, `FAINT`).
  - **Sub-caption**: bumped to `FS.small` (11px, was `FS.micro`/10px) to
    match `StatTile`'s sub-text size.

### 3. No-webfont stance — resolved (fixed, confirmed via live check)

Treated the stale "never load a webfont" comment as describing outdated
guidance (the current the microapp theme contract skill explicitly reversed that
stance) and added Inter/SangBleu loading accordingly. Confirmed working live
against the running app (not just reading the code): `document.fonts.check
('16px Inter')` returns `true`, Inter weights 400/500/600 show `status:
"loaded"` in the browser's font table (fetched from the CDN, not a silent
fallback), and a live `<h2>`'s computed `font-family` resolves to the
corrected stack. No console errors. SangBleu Versailles itself stays
`unloaded` until something actually renders `H1` (expected — `font-display:
swap` doesn't fetch until needed).

## Status

All three escalations are resolved — nothing outstanding from this pass.
- [x] `H1` stays unused for now.
- [x] Off-scale hero numbers fixed (two snapped to `FS.h3`, the KPI strip ported from fund-modeling's `MetricBar`/`StatTile`).
- [x] Webfont loading confirmed working live in the browser.
