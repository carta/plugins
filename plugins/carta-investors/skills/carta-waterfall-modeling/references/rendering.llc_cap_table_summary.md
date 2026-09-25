# Rendering — LLC cap table (`llc_cap_table_summary` shape)

Column/row spec for the **independent LLC cap table** (`portfolio_valuations:get:llc_cap_table_summary`
response). Number formatting is in `SKILL.md` **§Formatting rules**; Excel cell formatting +
metadata band in `references/excel-output.md`.

**Render straight through — no data prep.** The response is already flat and pre-summed: every
grouping, percentage, subtotal, and derived value is computed in the MCP. Loop and place; do **not**
walk a tree, recompute, multiply/divide percentages, or derive any value. Quantities arrive as
decimal strings — render as integers with thousands separators. Percentages arrive as numbers
already ×100 (e.g. `49.81` → `49.81%`; just append `%`). Money arrives as decimal strings — currency
per the Formatting rules.

## Which view

The response's `view` field is `OVERVIEW_GROUPS` (issuer has holder groups) or `SHARE_CLASS_SUMMARY`
(no holder groups). They differ only in whether group rows are present (below). **Layout** depends on
surface + width — see **§Chat vs Excel: matrix vs narrow summary** — but the field reads are the same
either way. There is no separate "holder" or "interest" view — the holder drill is **additive**
(`holderRows`, chat only — see the last section).

## Chat vs Excel: matrix vs narrow summary

The wide matrix below is `8 + 2×len(interestTypeColumns)` columns — fine in Excel, but unreadable
inline once an issuer has many interest types. Pick the layout by surface and width:

- **Excel** — always the full wide matrix.
- **Chat, `interestTypeColumns.length ≤ 5`** — the full wide matrix, inline.
- **Chat, `interestTypeColumns.length > 5`** — the **narrow summary**: the same rows and field reads
  as the wide matrix, but keep only the label plus the row's **Total** `Out Qty` / `Out %`, its
  **FD %**, and **Invested** — drop the per-type two-column groups (the group×type cross-tab lives in
  Excel and the holder drill) and the FD Qty / Returned / Unreturned columns. Five columns, within the
  6-column chat cap.

## Cap table rendering (both views)

A matrix reproducing the cap-table view. **Columns** come from `interestTypeColumns` (the ordered
list of interest-type names) — one two-column group per type. Left to right:

- `Holders and Interests` — the row label. → **text**
- For each name in `interestTypeColumns`, in order: a two-column group for that type —
  **Out Qty** and **Out %**. → **qty**, **pct**
- A trailing **Total** group — **Out Qty** and **Out %** (from the row's total cell). → **qty**, **pct**
- A **Fully Diluted** group — **FD Qty** and **FD %** (from the row's total cell). → **qty**, **pct**
- Three **money** columns from the row's total cell: **Invested**, **Returned invested capital**,
  **Unreturned invested capital**. → **currency** (each). Leave blank where the field is absent
  (e.g. the pool row).

**Field reads** — a cell (a `groups[].total`, an `interestTypes[]` entry, `grandTotal`, or a
`typeBreakdowns[]` entry) carries these keys **directly** (no `.cell` nesting):

| Column | key |
|---|---|
| Out Qty | `outstandingQuantity` |
| Out % | `outstandingPercentage` |
| FD Qty | `fullyDiluted` |
| FD % | `fullyDilutedOwnershipPercentage` |
| Invested | `investedCapital` |
| Returned invested capital | `returnedInvestedCapital` |
| Unreturned invested capital | `unreturnedInvestedCapital` |

`colType` per column: `Holders and Interests` → text; every Qty column (Out Qty, FD Qty) → qty;
every % column (Out %, FD %) → pct; the three money columns → currency.

**Two-row header — a type name is never repeated per column** (never emit `{typeName} Qty` /
`{typeName} %`):

- **Excel:** top header row carries each `{typeName}` **merged and centered** across its two columns
  (same for "Total" and "Fully Diluted" over their pairs); the second header row carries the
  `Out Qty` / `Out %` (and `FD Qty` / `FD %`) sub-labels. `Holders and Interests` and the three money
  columns are single columns — **merge them vertically** across both header rows. Data starts below
  the two header rows. (This is `headerRows: 2` + `merges` — the same block shape the `write(block)`
  helper already handles.)
- **Inline (markdown):** markdown can't merge, so put each `{typeName}` in the header row above its
  **Out Qty** column and leave the next cell blank (same for "Total" / "Fully Diluted"); the
  `Out Qty` / `Out %` sub-labels go in the row beneath. The name sits over its pair without repeating.

### Rows

**A row's `typeBreakdowns` is sparse** — it lists only the types that row actually holds (each tagged
with `typeId`). To fill the matrix, match each `typeBreakdowns[].typeId` to its column by pairing with
`interestTypes[]` (same order as `interestTypeColumns`); for any type column the row has no entry for,
leave the cell **blank** (not `—`).

**`view == OVERVIEW_GROUPS`** — emit rows top-down:

- One **holder-group** row per entry in `groups[]` (in returned order): label = `rowName`, rendered
  **bold** (no marker). Fill its type columns from `typeBreakdowns` (by `typeId`); fill Total / Fully
  Diluted / money from `total`.
- Then one **`{typeName}` sub-total** row per entry in `interestTypes[]` (label `{typeName} sub-total`).
  The entry's own fields fill **both its own type column and the Total / Fully Diluted / money columns**.
- An **All units remaining in pool** row from `equityPlanPool` — fully-diluted columns only
  (`fullyDiluted` → FD Qty, `fullyDilutedOwnershipPercentage` → FD %); leave Out, Total, and money blank.
- A bold **Grand total** row from `grandTotal` (money columns included).

**`view == SHARE_CLASS_SUMMARY`** (no holder groups) — identical matrix, just no group rows:

- Skip the group rows. The **`{typeName}` sub-total** rows (one per `interestTypes[]` entry) **are** the
  table — each fills its own type column plus Total / Fully Diluted / money.
- Then the **All units remaining in pool** row and the bold **Grand total** row, same as above.

No vesting columns and no per-interest value/MOIC columns in this table — those live in the holder
drill (below) and are answered on request from the payload.

## Holder drill (chat only — never written to Excel)

When the response carries `holderRows` (the user drilled into one or more holders via `holder_ids` —
see `references/cap-table.llc.md` §Holder drill), render it as an **additional markdown table beneath the summary** in
chat (the Excel sheet is summary-only). Same columns as the matrix above, **plus** four appended
columns.

Per entry in `holderRows` (each is a distinct holder — same-name holders in different groups appear
as separate entries, each with its own `holderGroup`):

- A **holder** row: label `↳ {holderName} ({holderGroup})`, from `grandTotal` (fill type columns from
  the entry's `typeBreakdowns` by `typeId`; Total / FD / money from `grandTotal`). Appended columns blank.
- One **interest** row per entry in `interests[]`: label `↳↳ {interestName}`. Fill its ownership pair
  under its `typeId` column, plus Total / FD / money, plus the four appended columns:

| Appended column | key | colType |
|---|---|---|
| Pref Accrued | `unpaidPreferredReturnAmount` | currency |
| Pref Returned | `paidPreferredReturnAmount` | currency |
| Vested | `vestedQuantityTimeOnly` / `vestedQuantityPerformanceOnly` / `vestedQuantityTimeAndPerformance` rendered as `a / b / c` | text |
| Unvested | `unvestedQuantityTimeOnly` / `unvestedQuantityPerformanceOnly` / `unvestedQuantityTimeAndPerformance` rendered as `a / b / c` | text |

Pref columns are blank on non-preferred interests (those fields are null-dropped from the payload).

### Answering on-demand questions (the drill returns more than it prints)

Each `interests[]` entry carries fields **beyond** the printed columns. When a user asks for one of
these for a specific holder/interest (e.g. "what's the strike price on Jane's B-1?"), resolve the
holder → **drill it** (`references/cap-table.llc.md` §Holder drill, `holder_ids`), then read the key off the interest — no extra table,
no recompute. Map the natural-language ask to the key:

| Ask (natural language) | Key |
|---|---|
| strike / exercise price | `strikePrice` |
| original issue price / OIP | `originalIssuePrice` |
| principal amount | `principalAmount` |
| MOIC / multiple of invested capital / return multiple | `multipleOfInvestedCapital` |
| distribution threshold / hurdle | `thresholdValue`, `thresholdValueType` |
| threshold gain / loss | `thresholdGainOrLoss` |
| equity conversion ratio | `equityConversionRatio` |
| current accrued value | `currentAccruedValue` |
| preferred return accrued / paid | `unpaidPreferredReturnAmount`, `paidPreferredReturnAmount` |
| vesting plan / schedule | `vestingPlanTemplateName` |
| vesting start / issuance / termination date | `vestingStartDate`, `issuanceDate`, `terminationDate` |
| total vested / unvested units (the single total, not the printed time/perf/dual split) | `vestedQuantity`, `unvestedQuantity` |
| accrual / compounding period, day-count convention | `accrualPeriod`, `compoundingPeriod`, `dayCountConvention` |
| a custom field, asked by its name (e.g. "Grant Category") | `customFields[]` — match the ask to `name`, answer its `value` |

These live **on the interest** — not on the summary or the holder-total row, so a summary-only
fetch has none of them; you **must** drill (`holder_ids`) to read them. Drill the **holder that owns
the interest in the ask**: resolve which holder from context (the name in the question, or the holder
just drilled or under discussion); if it's genuinely unclear which holder they mean, **ask before
drilling** rather than guessing.

Format per `SKILL.md` §Formatting rules; null-dropped — never fabricate.
