# Rendering — waterfall results (`*_results` shape)

Column/row spec for the **waterfall results** (per-entity allocations + breakpoints),
the `…:get:niagara_results` response shape. Number formatting (currency / % / MOIC /
IRR) is in `SKILL.md` **§Formatting rules**; Excel cell formatting + metadata band in
`references/excel-output.md`.

## Allocations table (always — grouping `BY_HOLDER`)

Render one table per entity in `ordered` (`results.niagara_results.md` §Step 6b). Multi-entity adds
a `### {display name}` subheader above each table; single-entity omits the
subheader. Each entity's Total row uses **that entity's own** `grand_totals` —
there is no graph-wide Total across entities (proceeds at the root flow down
through the chain).

The rules below apply within each per-entity table.

Sort the accumulated `allocations` by `.allocated_proceeds.proceeds` descending.
Columns and their `colType` (drives number format + width): `Group / Interest`
(text), `Proceeds` (currency), `% of Proceeds` (pct), `Invested Capital`
(currency), `Participating Qty` (qty), `MOIC` (moic), `IRR` (pct).

For each `allocations[i]` (a holder group), emit one **group row**
followed by one sub-row per `allocations[i].interest_allocations[j]`:

**Group row** — first column = `allocations[i].group_name` (the holder name):

| Column            | Source                                                                                                          |
| ----------------- | --------------------------------------------------------------------------------------------------------------- |
| Proceeds          | `allocations[i].allocated_proceeds.proceeds`                                                                    |
| % of Proceeds     | `allocations[i].allocated_proceeds.percentage_of_total`                                                         |
| Invested Capital  | `allocations[i].total_invested_capital`                                                                         |
| Participating Qty | `allocations[i].allocated_proceeds.units`                                                                       |
| MOIC              | `allocations[i].moic` (render `—` if `null`)                                                                    |
| IRR               | If `allocations[i].interest_allocations.length == 1`, use `interest_allocations[0].irr_percentage`; else `—`    |

**Sub-row (BY_HOLDER)** — first column = `"{type_name} — {interest_label}"`
(e.g. "Class A Units — A-1"), built from `interest_allocations[j].type_name`
and `interest_allocations[j].interest_label`. Prefix with `↳ ` or indent.

| Column            | Source                                                           |
| ----------------- | ---------------------------------------------------------------- |
| Proceeds          | `interest_allocations[j].allocated_proceeds.proceeds`            |
| % of Proceeds     | `interest_allocations[j].allocated_proceeds.percentage_of_total` |
| Invested Capital  | `interest_allocations[j].invested_capital`                       |
| Participating Qty | `interest_allocations[j].allocated_proceeds.units`               |
| MOIC              | `interest_allocations[j].moic` (render `—` if `null`)            |
| IRR               | `interest_allocations[j].irr_percentage` (render `—` if `null`)  |

**Total row** — final row, bolded. Pull from `grand_totals` (present on
every page response):

| Column            | Source                                  |
| ----------------- | --------------------------------------- |
| Group / Interest  | `"Total"`                               |
| Proceeds          | **root**: the EQUITY_VALUE you ran with. **Sub-entity**: the sum of `allocated_proceeds.proceeds` over that node's rows — the proceeds that flowed down to this entity, **not** the exit value. |
| % of Proceeds     | `100.00%` (of this entity's own total)  |
| Invested Capital  | `grand_totals.total_invested_capital`   |
| Participating Qty | `grand_totals.participating_units`      |
| MOIC / IRR        | blank                                   |

Apply `SKILL.md` §Formatting rules.

**"Other holders" rollup.** Results may include one aggregate row for collapsed holders,
identified by `interest_allocations[j].holder_id == "other-holders"` — a whole group in
`BY_HOLDER`, sub-rows in `BY_TYPE`. Render it like any other group/sub-row (`group_name` /
`type_name` as returned; `MOIC`/`IRR` may be `—`); one per entity. Key off `holder_id` —
`group_id` isn't returned. Not a firm holding — see `results.niagara_results.md`
§Firm-holders filter.

### Answering on-demand questions (the response carries more than it prints)

The allocations response carries two decomposition fields on every interest-allocation row, every
group, and `grand_totals` that the **Allocations table above does not print**. Never add them as
default columns. On a direct ask, read the key off the already-fetched page (no re-fetch, no recompute):

| Ask (natural language) | Key | Level |
|---|---|---|
| return of capital / invested capital to return / capital still owed | `invested_capital_to_return` | interest row |
| return of capital for a whole holder group | `total_invested_capital_to_return` | group |
| return of capital across the entity | `invested_capital_to_return` | `grand_totals` |
| preferred return to pay / accrued preferred still owed | `preferred_return_to_pay` | interest row |
| preferred return to pay for a whole holder group | `total_preferred_return_to_pay` | group |
| preferred return to pay across the entity | `preferred_return_to_pay` | `grand_totals` |

Format per `SKILL.md` §Formatting rules; null-dropped — never fabricate.

## Breakpoints table (chat: on request · excel: always, on the Waterfall tab)

Each node has its own cached `breakpoints[]` from Step 6. Render in
declared order — no sort.

| Column                 | Source                              |
| ---------------------- | ----------------------------------- |
| Breakpoint             | `breakpoints[i].name`               |
| From                   | `breakpoints[i].from`               |
| To                     | `breakpoints[i].to`                 |
| Proceeds in tier       | `breakpoints[i].proceeds_in_tier`   |
| Remaining proceeds     | `breakpoints[i].remaining_proceeds` |
| Participating quantity | `breakpoints[i].participating_units`|
| Proceeds per unit      | `breakpoints[i].proceeds_per_unit`  |
| Invested Capital       | `breakpoints[i].total_invested_capital` |

`colType`: `Breakpoint` text; `Participating quantity` qty; all others (From, To,
Proceeds in tier, Remaining proceeds, Proceeds per unit, Invested Capital) currency.

Apply `SKILL.md` §Formatting rules.

**Multi-entity**: render one table per node, under a `### {entity name}`
subheader, in the same root-first order. If the user targeted one entity
by name (see `references/follow-up.md`), render only that entity's breakpoints.
