# Excel output — Waterfall Modeling

Canonical spec for writing to the workbook when `<SURFACE>` is `excel` (Claude
for Excel). The run flow and strict cap-table-first order live in `SKILL.md`; the
table column/row definitions in the **command-matched** `references/rendering.<noun>.md`
(cap table by `cap_table_command`'s noun, results by `get_command`'s noun);
this file covers only the workbook write — mechanics, the metadata band, and the
two tabs (**Cap Table** and **Waterfall**).

`carta-valuations-excel` writes with the same conventions, from its own
[`references/excel-output.md`](../../carta-valuations-excel/references/excel-output.md) —
a change here to layout, number formats, widths, or tab classification belongs there too.

## Write mechanics

**Step 1, before anything else: read the target tab and classify it** — empty or
Carta's own → **Carta-standard** layout (below); the user's own populated table →
**Adapt mode** (end of section). The classify read is the **first action of the write
path**; skipping it is what clobbers a user's template. **Step 2:** build + write.

**Two write paths** — which one, the page sizes, and the fetch cadence all live in the
command's results doc (`references/results.<get_command noun>.md`) §Excel — fetch & write
order; don't re-derive them here:

- **Fast path** (small) — hold the pages in context, write both tabs in one `execute_office_js`.
- **Streaming** (large) — stash pages to blobs (below), then one write.
- **On any oversize while on the fast path, switch to streaming** and re-fetch that
  entity — a wrong guess costs a retry, never a corrupt sheet.

Either way: **every row, sub-row, and tier is written verbatim** — trim only genuinely
unrendered *scalar fields*; never drop, aggregate, or sample rows or tiers. Where a
command's allocations table nests **sub-rows** under a parent row (see that command's render
spec §Sub-row — e.g. per-interest lines under a holder), keep every sub-row: dropping them
leaves a parent roll-up with nothing beneath it, the exact bug to avoid. "Trim fields" never
means rows, sub-rows, holders, or tiers. The **final write is one `execute_office_js`**,
built programmatically (loop rows; the cap table lays out per its render doc), atomic —
nothing written until every page is in hand, so a failed fetch never leaves a half-written
sheet. Round numbers to 2 dp.

**How fetched data reaches the workbook — there is exactly one way.** To write any
fetched data (breakpoints or an allocation page) you serialize it as a **JSON literal
inside the `execute_office_js` code** — that is the only mechanism. There is **no**
placeholder or template substitution (no `%%…%%`, nothing gets swapped in for you); you
**cannot** call an MCP tool or read a fetch result from the Python/`code_execution`
sandbox (Carta tools are **not** bridged there — fetching and stashing included; don't
attempt, test, or re-litigate it per page); and you
**never** re-fetch data just to write it. A large one-time literal (~35 KB for a big tier
list) is **expected and fine** — emit it once and move on. Don't deliberate this; it's the
step, not a problem to route around.

**Streaming mechanics (large path).** `blobs.setJSON`/`getJSON` persist across
`execute_office_js` calls — a blob written in one call is readable in the next:

- **Breakpoints** stash from the first results call that carries them, in the **same turn
  as that fetch, before you snip/archive any tool result** — serialize **all tiers in
  full**; **never a placeholder or partial stub to fill later** (archived results return
  only capped slices, so a stub or a snip-first both force a re-fetch). Emitting ~35 KB
  once costs tokens but is expected — **do it, don't split it, don't stub it.** Never
  re-fetch them to write.
- **The cap table is not streamed** — it's one fetch: hold it in context and write it as
  the Cap Table block; never stash it to a blob.
- **Allocation pages** append to the entity's blob as a JSON literal — a copy, not a
  retyped grid, sub-rows intact. Too big to trim? Stash it raw and shrink `page_size` on
  the *next* fetch — never drop rows to fit.
- **Key blobs by `execution_id`** (`wf:<execution_id>:bp:<node_id>`, `:alloc:<node_id>`)
  and clear stale `wf:*` keys on the first stash.
- The final write reads `wf:<execution_id>:*` instead of the held pages; everything else
  (verbatim rows, one atomic write) is identical to the fast path.

Each block is `{ values, colTypes, headerRows, merges }`; assemble all of them as:
```
{ captable: { values, colTypes, headerRows, merges } | null,
  entities: [ { display_name, is_root,
    bp:    { values, colTypes, headerRows, merges },
    alloc: { values, colTypes, headerRows, merges } }, … ] }
```
- `values` — 2-D array: header row(s), data rows, Total. **Every row the same length**
  (the column count) — pad section-label rows with trailing `''` (a ragged array
  throws); span a label via `merges`, not a narrow write.
- `colTypes[i]` — `currency|qty|pct|moic|text` per column; drives number format + width.
- `headerRows` — `1` (allocations, breakpoints) or `2` (cap-table merged header).
- `merges` — `[r0,c0,r1,c1]` rects (cap-table header spans; the B2 title bar); `[]` otherwise.

- Do every workbook op through `execute_office_js` — **never** the Python/code
  sandbox. Call shape: the up-front existence check, then (large path only) one
  batch-stash call per fetch wave, then **one** final build+write. The fast path has no
  stash calls — existence check, then the single write.
- **One writer helper, reused per block.** Define **one** `write(block)` taking
  `{values, colTypes, headerRows, merges}` and reuse it for every block — **Cap
  Table first, then the Waterfall block(s)**. The cap table is **not** special:
  it's a block with `headerRows: 2` and `merges`; the same helper writes it — don't
  fork a cap-table path. Per block: `block.values` as one 2-D `range.values`, then
  `merges`, then format (number format + width, below), header fill + centering,
  borders. Never cell-by-cell. Build the range from the array —
  `sheet.getRangeByIndexes(r0, c0, block.values.length, block.values[0].length)` — so
  dimensions always match.
- **Writing onto merged ranges — order matters.** Setting `range.values` on an
  already-merged range **throws**. When a tab carries merged cells (the cap
  table's two-row header) and you re-write it, follow this order on each reused
  range: **unmerge first**, then assign `range.values`, then re-apply the merges,
  then format. Never set values while a range is still merged.
- **Load before read.** Reading any Office.js property — a sheet's `.name` /
  `.address`, a range's `.values`, a named item's `.isNullObject` — before you've
  `load()`-ed it and `context.sync()`-ed **throws `PropertyNotLoaded`**. In the
  up-front existence check, load the property first, then read it.
- **Number formats — apply in the write pass via a 1×1 broadcast, never in a
  later fix-up pass.** Per column, assign a **single 1×1 `[[fmt]]` array to the
  whole column range** — Excel broadcasts it, so no N×M grid; pick `fmt` from a
  **lookup map** keyed by `colTypes[i]` (a `{colType: fmt}` object, **not** a
  nested ternary — ternary chains keep mis-parenthesizing). Format strings by type:
  - Currency cells: USD accounting format
    `_([$$-en-US]* #,##0.00_);_([$$-en-US]* (#,##0.00);_([$$-en-US]* "-"??_);_(@_)`
    — never a bare `$` (Excel renders it as the user's locale symbol).
  - Percent / IRR cells: `0.00"%"` — the API returns these **already ×100**
    (e.g. `40.98` = 40.98%), so the `%` is a **literal** (quoted); do **not**
    use `0.00%`, which multiplies by 100 again.
  - MOIC cells: `0.00"x"`. Quantity cells: `#,##0`.
- **Column widths — fixed by `colType`, points; never `autofitColumns()`**
  (computed/auto widths kept producing `####`) from a lookup map:
  `{ currency:160, qty:95, pct:66, irr:66, moic:88, text:200 }[colType]` (currency
  over-provisioned for large breakpoint bounds like the "To" tiers; `moic` sized to
  fit the long "Return multiple" header, not just the value). **Width is per
  Excel column, not per block:** stacked tables (breakpoints + allocations) share
  columns, and the last block to set one wins — so a narrow `pct` column shrinks a
  wide currency column sharing it (the `####` "To"). **Build one width map —
  `width[colIndex] = max` of every stacked block's colType-width at that Excel column — and
  apply it once, after all blocks are written** (by column index from B); take the **max**,
  never let a block's own widths overwrite (the last write wins and shrinks the first). Set it via
  `sheet.getRangeByIndexes(0, colIndex, 1, 1).format.columnWidth = points` — there is
  no `getColumnByIndex`. `####` is never acceptable.
- **Never read the workbook back after writing — skip the verification pass
  entirely.** This bars *every* post-write read: re-reading written cells, a
  "quick sanity check on the totals", confirming the data "tied out", anything.
  The engine already returned correct figures and the write IS the output, so a
  post-write read is a wasted round-trip.
- **Existing tab — the tab's current state decides the layout (auto-detect; don't
  make the user ask).** In the up-front existence read, classify the target tab:
  - **Empty / new** → write the **Carta-standard** layout (below).
  - **Carta's own** — a `CartaTab__{TabKey}` named range points at this sheet, or
    (Cap Table) `B3 == "Source: Carta — Waterfall Modeling"`. (`{TabKey}` = the tab
    name with spaces / non-`[A-Za-z0-9_]` → `_`, since named ranges reject spaces:
    `Cap Table` → `CartaTab__Cap_Table`.) → Carta-standard; clear **only the block
    you write** (never `getUsedRange()`) and replace **in place** — don't delete +
    re-add the sheet.
  - **The user's own populated table** — not ours, but the tab has a **header row
    plus data rows** (any labels/format). Detect this **structurally** — a header
    row of column labels with value rows beneath, including group/subtotal/total
    rows — **not** by matching specific column names. → **Adapt mode** (below).
  - **Not ours and not adaptable** — unrelated content you can't map → never clobber;
    write to a new `"{TabName} (Carta)"` tab.
  - **Never-clobber floor (enforced in the write code, not just here).** Before the
    write helper clears or writes a tab, it re-checks that tab's used range; if it is
    **non-empty and not Carta's**, it must **not** overwrite — adapt onto it if its
    structure was read, else write to a new `"{TabName} (Carta)"` tab. This guard
    lives in the write code, so it holds even if the Step-1 classify was skipped: a
    skip can never destroy the user's data.
  - **Provenance marks Carta-standard tabs only (best-effort).** When you write the
    **Carta-standard** layout, register `CartaTab__{TabKey}` via `names.add` (only if
    absent; if the add fails for any reason, skip and continue — a convenience, never
    a gate). The marker means "Carta owns this layout," so in **Adapt mode do NOT
    register it** (the tab is in the user's format, not ours), and if the tab already
    carried a `CartaTab__{TabKey}` from a prior Carta run, **remove it** — leaving it
    would make a later run clobber their reformatted tab.
  - Address sheets by known name; load before reading (see **Load before read**).
- Reserve **rows 1–5** on every tab. The data block and the metadata band share
  the **same left edge — column B**: the band is B1–B4 and the table starts at
  **B6** (column A stays empty as a thin left margin). (Logo at E1:E3 is deferred —
  leave column E clear for now.)
- No inline chat table in `excel` — the workbook is the output.

### Adapt mode — update values in place, don't rebuild

Everything above is the **Carta-standard** layout — used for an empty tab or Carta's
own. **Adapt mode** is entered **automatically** — never ask permission; filling a user's
existing template in their format is expected, not an imposition — when the target tab
already holds the user's own table (classified above), or when they explicitly ask to
match a layout; not on a fresh or Carta tab.

Adapt mode is **not** a re-layout. The tab already has the structure, labels, titles,
colors, and number formats the user wants (usually from a prior run). You only **drop
the new numbers into the cells that already hold them, and touch nothing else.**

- **Write cell values only — never formatting.** Set `range.values` on the specific
  cells whose numbers change; **never** write fills, fonts, borders, widths, number
  formats, the navy header, the metadata band, or any static text. Excel keeps every
  format you don't touch, so the user's colors and number formats are preserved **by
  not writing them** — the existing number format also renders your raw value
  correctly, so there's nothing to set.
- **Map each engine value to its existing cell by meaning**, using the tab's own row
  labels + column headers — **orientation doesn't matter** (you're updating cells in
  place, not laying out a matrix). The render spec is only a **data dictionary** (which
  engine field is which), never a layout. If a cell/column's meaning is **ambiguous**,
  **ask via `AskUserQuestion`** ("what does column X hold?") — don't guess.
- **Titles/labels with an embedded number** (e.g. _"Modeled exit proceeds of
  $150.00M"_) → **swap only the number**, keep the wording → _"…$100.00M"_. Never
  rewrite the sentence or replace it with the Carta metadata band.
- **Structure delta — values change, layout follows:**
  - **Same** rows/tiers/holders as what's there (the common re-run case) → pure value
    substitution. This is the reliable path.
  - **Fewer** rows than present (e.g. fewer breakpoint tiers) → clear/delete the surplus
    rows; keep the styling on the rows that remain.
  - **More** rows than present (e.g. more breakpoint tiers) → **insert** the extra rows and
    write them; **don't ask** — the user asked to write, so write. Excel shifts anything below
    the table downward, so nothing is overwritten; state it in one line.
- Cells/columns you have no data for → leave untouched; add no columns they don't have.
- The write is **targeted value updates (plus any row inserts/deletes) in one
  `execute_office_js`** — not the Carta-standard `blocks` build, and no formatting pass.

## Cell formatting (both tabs)

- **Title:** merge the **B2** title cell across the data-block width; bold.
- **Header row(s):** bold, **white text on Carta navy fill `#1B2E50`**, centered.
  Cap Table's two-row merged header: apply to both header rows.
- **Data rows:** white fill, no zebra striping — borders separate rows.
- **Numeric / currency / percent cells:** right-aligned.
- **Borders:** thin around the data block — Office.js `style = "Continuous"`,
  then `weight = "Thin"` (never `style: "Thin"`).

## Metadata band (all tabs)

A 4-row text band in **column B**, rows 1–4 (row 5 blank):

- **B1** — firm name; bold.
- **B2** — `"{company} — Cap Table"` (Cap Table) / `"{company} —
  Waterfall Results"` (Waterfall) / `"{company} — Vesting"` (Vesting).
- **B3** — Cap Table & Vesting: `"Source: Carta — Waterfall Modeling"`. Waterfall:
  `"Exit value: {EQUITY_VALUE, compact currency} | Date: {WATERFALL_DATE, ISO}"`.
- **B4** — Cap Table: execution timestamp (when the run executed). Waterfall & Vesting:
  retrieved timestamp (when the tab was written).

## "Cap Table" tab

- Write the **root's summary only** — fetched with the root id (see the cap-table detail doc
  for the active `cap_table_command` noun). Sub-entity / consolidated cap tables are out of scope.
- **Lay out per the `cap_table_command` noun's render doc** (rendering map, top of `SKILL.md`) —
  its column list, row order, and `colType`s. Header shape follows the doc:
  - **Flat column list** (e.g. `cap_table_by_share_class` — share-class / warrant / option-pool
    rows + Total) → a single header row (`headerRows: 1`), no column-group merges (only the B2
    title merge).
  - **Grouped matrix** (e.g. `llc_cap_table_summary`) → the two-row **merged + centered** header
    per that doc's Excel form (`headerRows: 2` + `merges`).

  Same generic `write(block)` helper either way — the block differs only in `headerRows` / `merges`.
- When you write the Cap Table block, **cache `cap_table_end_row = 6 + capTableBlock.values.length`** —
  the convertibles block (below) and the on-request liquidation-preference augmentation position
  themselves from this cached integer, never a sheet read.
- **Convertibles (corp cap tables) — a default block beneath the cap-table block.** When the corp's
  `note_blocks` fetch (`cap-table.corp.md` §Convertibles) returns a **non-empty** `note_blocks`, build
  the block from `references/rendering.note_blocks.md` and stack it under the cap-table block on the
  **Cap Table** tab, **in the same first `execute_office_js`** — it's a default companion, not an
  on-request drill. One block with its own sub-header row (`headerRows: 1`, `merges: []`), starting at
  `cap_table_end_row + 2` (one blank row below); `colTypes` per that render doc's column list (Round
  `text`, the four money columns `currency`); number formats and widths come from the existing lookup
  maps. Provenance range: `CartaTab__Cap_Table_Convertibles`. Empty `note_blocks` → write nothing.
  Corp-only — never coexists with the LLC liquidation-preference append.
- **The deeper holder view is chat-only, never written to the workbook by default** — it renders in
  chat; write it to the sheet only if the user explicitly asks. No light prompt in the sheet.

## On-request drill-writes — shared rules (liquidation preferences & vesting)

The two augmentations below each run **after** their chat render as a **second `execute_office_js`** — never
part of the default write, never auto-written. This is the only place a tab is written a second time; it
stays non-brittle by obeying these rules — **all mandatory**. Each section below adds only its own specifics.

- **Additive only.** Write only the block you own; never touch cells another write produced.
- **Never read the workbook back to *verify*** — no post-write "did it tie out" pass (same rule as the first
  write). This bars verification reads, **not** the up-front locate/classify read the write path performs.
- **Idempotent via a `CartaTab__…` provenance named range.** Mark the block on first write; a re-request
  **unmerges + overwrites that block in place** (clear only the block you write) — never a duplicate write.
- **User's own tab → Adapt (per §Adapt mode above), else the section's fallback; never clobber the user's
  data.** Each section names its adapt-condition, its render doc (the data dictionary), and its fallback.
- **Reuse `write(block)` verbatim** — same `{values, colTypes, headerRows, merges}` shape and the same
  number-format / column-width lookup maps.

## Liquidation preferences (Cap Table tab, on request)

Reached when the user accepts the Excel offer in `cap-table.llc.md` §Liquidation preferences — appends the
liq-pref block(s) below the cap-table block. Obeys the **shared drill-write rules** above; specifics:

- **Position — append below, with a locate fallback.** The block starts at `cap_table_end_row + 2`. Resolve
  that row in order: (1) the integer **cached this session** when the cap-table block was written — no read;
  (2) if `CartaTab__Cap_Table_LiqPref` exists, it's a re-request → overwrite that block **in place**;
  (3) otherwise **locate** the cap table's end — the `CartaTab__Cap_Table` named-range address, else the
  tab's used range — and append below. **Never** overwrite/delete existing rows to make room, and **never
  add columns to the share-class rows** (locating each class row, joining by name, rewriting the merged
  header is the brittle path — forbidden). Provenance range: `CartaTab__Cap_Table_LiqPref`.
- **User's own Cap Table tab → adapt if it has liq-pref columns** (match classes by
  `interestTypeId`→`typeName`), **else append below** as above. Either way liq-pref reaches the sheet; a
  second adapt pass on a tab you already filled is fine (different columns).

Build the block(s) from `references/rendering.llc_liquidation_preferences.md` — the same two tables the
chat render uses (Economics, then Dividends). Each is one block with its own sub-header row
(`headerRows: 1`, `merges: []`); stack them under the cap-table block, the second one blank row below
the first. `colTypes` per that render doc's column list; currency / percent formats and widths come from
the existing lookup maps. Don't re-write the tab's metadata band — it's already there from the initial
write. After writing, state **one line** citing the block (e.g. _"Added liquidation preferences below
the cap table — `<citation:Cap Table!A…>`."_).

## Vesting schedule ("Vesting" tab, on request)

Reached when the user accepts the Excel offer in `cap-table.llc.md` §Vesting schedule (after a holder drill
— the `interestId` comes from `holderRows[].interests[]`). Obeys the **shared drill-write rules** above;
specifics:

- **Own new tab.** Vesting never touches the Cap Table or Waterfall tabs. Provenance range:
  `CartaTab__Vesting`, holding **one** block = every interest added this session, stacked; a later "add"
  **rewrites the whole block in place** (re-emitting all sections from held data) — never append by reading
  the sheet.
- **User's own "Vesting" tab → adapt only when exactly ONE interest goes to that tab**, else a new
  `"Vesting (Carta)"` tab. The Carta-standard layout stacks one section per interest, so mapping a second
  interest onto the first's rows is ambiguous — for multiple interests, `AskUserQuestion` (adapt which one /
  keep the Carta-standard multi-section tab).

The **Carta-standard** layout (empty / Carta's own tab):

- **Metadata band** per §Metadata band (Vesting variant); the table starts at **B6** (rows 1–5 reserved,
  column A a thin margin — as on the other tabs).
- **One section per drilled interest added to the tab**, in root/drill order (mirrors the Waterfall
  tab's per-entity sections). Each section is the render doc's **caption** as a full-width label row
  (padded + merged — a narrow row throws), then the per-tranche table block from
  `references/rendering.llc_interest_vesting_schedule.md`
  (`headerRows: 1`; `colTypes` per that doc's columns — `qty` for Nominal / Vested / Unvested, `text` for
  the rest, incl. the ISO-date Service start / end columns). Stack sections one blank row apart; a single
  interest still gets its caption.
- After writing, state **one line** citing the tab (e.g. _"Wrote the vesting schedule to the **Vesting**
  tab — `<citation:Vesting!A1>`."_).

## "Waterfall" tab

- One self-contained section per entity in `ordered` (root-first) — a single-node
  command (e.g. `core_results`) has one section — in order:
  1. the **breakpoints** table (`references/rendering.<get_command noun>.md`
     §Breakpoints table) — cached from the first results call, no extra fetch;
  2. the **BY_HOLDER allocations** table below it
     (`references/rendering.<get_command noun>.md` §Allocations table — rows +
     Total, per that doc's layout).
- Single-entity / single-node omits the section label.
- Don't write BY_TYPE or firm-filtered cuts — those stay inline
  (`references/follow-up.md`).
- After writing, state **one line** citing the tab (e.g. _"Wrote the waterfall
  to the **Waterfall** tab — `<citation:Waterfall!A1>`."_) — no inline tables, no
  BLUF lead, and **no analytical wrap-up** (no "top of the stack", no MOIC/IRR
  commentary, no ranking — that prose is what makes the model skip the menu).
  Then **immediately call `AskUserQuestion`** for the Follow-up prompt per
  [`references/follow-up.md`](references/follow-up.md) — its **excel** option set
  (already omits "Show breakpoints", since they're on the Waterfall tab). Never
  ask in prose.
