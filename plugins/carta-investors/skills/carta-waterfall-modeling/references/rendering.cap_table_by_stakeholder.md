# Rendering — `cap_table_by_stakeholder`

Column/row spec for `cap_table:get:cap_table_by_stakeholder` (`detail=full`). Number formatting:
`SKILL.md` §Formatting rules. **Chat only — never written to Excel.**

**Render straight through.** Flat, one row per stakeholder, pre-summed. Ownership fields arrive as
fractions (0–1): multiply by 100 before appending `%`. Quantities → integers with thousands
separators. Money → currency. Null/absent → `—`.

## Columns

| Column | Key | colType |
|---|---|---|
| Stakeholder | `stakeholder_group_name` | text |
| Outstanding | `outstanding_shares` | qty |
| Outstanding ownership | `outstanding_ownership` | pct |
| Fully diluted | `fully_diluted_shares` | qty |
| Fully diluted ownership | `fully_diluted_ownership` | pct |
| Capital contributed | `cash_raised` | currency |

## Rows

One row per entry in `stakeholders[]`, in returned order (server sorts by fully-diluted ownership
descending). `stakeholder_group_name` is a display name and is **not unique** — the same name may
appear on multiple rows; render each row as-is, don't merge.

**Paged + top-N** (this view is paginated; the share-class summary is not). Pass `page` +
`page_size` (default 25) on each call. The response carries `count` (rows in this page) and
`total` (stakeholders across all pages); `pages = ceil(total / page_size)`. Render the top rows
of the current page and, when there are more, a trailing line:
_`+ {total − shown} more ({total} total · page {page} of {pages})`_. **Never auto-fetch all
pages** — this is an opt-in view; fetch the next page only on request (`page` + 1, same
`page_size`). If a page ever returns `response too large`, halve `page_size` and re-fetch that
page (mirrors the results loop); stop at `page_size: 1`.

## Drill fields — individuals & securities (opt-in)

With `include_securities: true`, each stakeholder row additionally carries its **individuals** and
their **securities** — the backing for the holder drill (`references/cap-table.corp.md` §Holder
drill):

```
stakeholders[]: { stakeholder_group_name, outstanding_shares, outstanding_ownership,
                  fully_diluted_shares, fully_diluted_ownership, cash_raised,
                  remaining_invested_capital,
                  individuals: [ { stakeholder_id, stakeholder_name,
                      securities: [ { id, security_type, certificate_subtype,
                                      share_class_id, label, share_class_name, quantity } ] } ] }
```

Without `include_securities`, rows carry only the group-level fields above (no `individuals`).

## Discovery list (drill entry — chat only)

When the user picks **Drill into a holder**, render this command as the holder list instead of the
flat table: fetch page 1 with `include_securities: true` and print a **compact list grouped by
`stakeholder_group_name`** — one line per group, `individuals[].stakeholder_name` comma-separated.
Do **not** print securities here — but they back the drill (§Holder drill), so a holder already listed
needs **no** second fetch. Respect paging (page 1, more on request per §Rows). Listing the
names lets the user pick; only when the list is genuinely large (high `total` / many pages) ask which
group first, then list that subset. Show a name's group beside it only when two individuals share a name.

## Holder drill (chat only — never written to Excel)

Render the drilled holder as an **additional table** with two row markers, mirroring the LLC holder
drill — built from that holder's `stakeholders[]` entry, whether it came from a scoped `search` or an
already-fetched page (`references/cap-table.corp.md` §Holder drill governs when to fetch vs reuse):

- **Holder row:** `↳ {stakeholder_group_name}` — fill **Outstanding** `outstanding_shares`, **FD**
  `fully_diluted_shares`, **Capital contributed** `cash_raised` from the group row; the per-security
  columns blank.
- **Security row**, one per security across the row's `individuals[].securities[]`: `↳↳ {label}` —
  **Type** derived from `security_type` (+ `certificate_subtype`), **Share class** `share_class_name`,
  **Quantity** `quantity`; the aggregate columns blank.

Columns (markdown): `Holder / security | Type | Share class | Quantity | Outstanding | FD | Capital contributed`.

The ↳ totals are at the **group** level: for a single-stakeholder holder they are that holder's; for a
multi-person group (an org / firm) they span the whole group while the ↳↳ rows show the drilled
holder's securities — say so in one line (_"Totals are for the {group} group."_) when the row carries
more than one individual. **Strike / threshold / vesting / invested-capital are not on these rows** —
they appear in the per-security vesting drill (`references/rendering.corp_vesting_schedule.md`),
reached by dispatching each security by `(security_type, id)` (ids are unique only within a type).

## Answering on-demand questions (the drill returns more than it prints)

The rollup carries more than the drill prints. On a direct ask, read the key off the already-fetched
response (no re-fetch):

| Ask (natural language) | Key |
|---|---|
| remaining / unreturned invested capital for a holder | `stakeholders[].remaining_invested_capital` |
| a security's share-class id | `individuals[].securities[].share_class_id` |
| a security's certificate subtype | `individuals[].securities[].certificate_subtype` |

Format per `SKILL.md` §Formatting rules; null-dropped — never fabricate.
