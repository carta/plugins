# Rendering — waterfall results (`core_results` shape)

Column/row spec for the **core (legacy) waterfall results** (share-class allocations +
breakpoints), the `…:get:core_results` response shape. Number formatting (currency / % /
MOIC / IRR) is in `SKILL.md` **§Formatting rules**; Excel cell formatting + metadata band
in `references/excel-output.md`.

Core results are single-node — one corporation, no entity graph. One table per grouping;
no per-entity subheaders. Each row is flat (no sub-rows).

## Allocations table (always — grouping `BY_HOLDER`)

Sort the accumulated `allocations` by `.value_of_holdings` descending. One row per
stakeholder. Columns and their `colType`: `Stakeholder` (text), `Securities` (text),
`Outstanding shares` (qty), `Cost` (currency), `Projected payout` (currency), `Return
multiple` (moic), `IRR` (pct).

| Column | Source |
| --- | --- |
| Stakeholder | `allocations[i].organization_name` |
| Securities | `allocations[i].participating_securities` (the securities this holder is paid on, by name; join with `, `; `—` if empty) |
| Outstanding shares | `allocations[i].outstanding_shares` |
| Cost | `allocations[i].cost_of_holdings` |
| Projected payout | `allocations[i].value_of_holdings` |
| Return multiple | `allocations[i].return_multiple` (render `—` if `null`) |
| IRR | `allocations[i].irr` (render `—` if `null`) |

**"Other holders" row.** Results may include one aggregate row for collapsed holders:
`key` `"OTHER_HOLDERS"`, `organization_name` `"Other holders"`, no securities (`—`),
`irr` `—`. Render it like any other row (it sorts with the rest). Not a firm holding —
see `results.core_results.md` §Firm-holders filter. BY_HOLDER only.

**Total row** — final row, bolded. Pull from `grand_totals`:

| Column | Source |
| --- | --- |
| Stakeholder | `"Total"` |
| Outstanding shares | `grand_totals.outstanding_shares` |
| Cost | `grand_totals.cost_of_holdings` |
| Projected payout | `grand_totals.value_of_holdings` |
| Return multiple / IRR | blank |

Apply `SKILL.md` §Formatting rules.

## Allocations table (grouping `BY_TYPE`)

Sort by `.value_of_share_class` descending. One row per share class. Columns: `Share
class` (text), `Outstanding` (qty), `Value per share` (currency), `Cost` (currency),
`Projected proceeds` (currency), `Return multiple` (moic).

| Column | Source |
| --- | --- |
| Share class | `allocations[i].share_class_name` |
| Outstanding | `allocations[i].original_quantity` |
| Value per share | `allocations[i].value_per_share` |
| Cost | `allocations[i].cost_of_share_class` |
| Projected proceeds | `allocations[i].value_of_share_class` |
| Return multiple | `allocations[i].return_multiple` (render `—` if `null`) |

**Total row** — bolded, from `grand_totals`:

| Column | Source |
| --- | --- |
| Share class | `"Total"` |
| Outstanding | `grand_totals.original_quantity` |
| Cost | `grand_totals.cost_of_share_class` |
| Projected proceeds | `grand_totals.value_of_share_class` |
| Value per share / Return multiple | blank |

### Answering on-demand questions (the response carries more than it prints)

Fields on every row the tables above don't print. Never add them as default columns.
On a direct ask, read the key off the already-fetched page:

| Ask (natural language) | Key | Row |
|---|---|---|
| share-class type (preferred / common / …) | `share_class_type` | BY_TYPE |
| seniority / stack rank | `seniority` | BY_TYPE |

Format per `SKILL.md` §Formatting rules; null-dropped — never fabricate.

## Breakpoints table (chat: on request · excel: always, on the Waterfall tab)

`breakpoints[]` is cached from page 1 (Step 6a). Render in declared order — no sort.

| Column | Source |
| --- | --- |
| Description | `breakpoints[i].description` |
| From | `breakpoints[i].from_value` |
| To | `breakpoints[i].to_value` |
| Delta | `breakpoints[i].delta` |
| Value in tier | `breakpoints[i].value_in_tier` |

`colType`: `Description` text; all others currency.

Apply `SKILL.md` §Formatting rules. Single-node — one table, no subheader.
