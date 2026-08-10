# Journal entries — column contract

The Carta DWH journal-entries table is denormalized. Every row
carries enough metadata to classify and aggregate without joins.

| Column | Type | Notes |
|---|---|---|
| `FIRM_ID` | UUID | Firm-level scope. Filter on this. |
| `FUND_NAME` | string | Entity display name. **Never used for P&L grouping.** Used in the `WHERE` clause only, to narrow the consolidation to the entities the user picked (see below). |
| `EFFECTIVE_DATE` | date | The date the entry hits the books. **Use this**, not `POSTED_DATE`. |
| `ACCOUNT_TYPE` | string | Numeric string, e.g. `'5200'`. Leading digit drives classification (see below). |
| `ACCOUNT_NAME` | string | Human label. Use directly as the row label — don't rename. Section assignment is display-only (see `section-map.md`). |
| `AMOUNT` | decimal | Single signed column. Revenue (4xxx) stored as **negative** credits. Expenses (5xxx+) stored as **positive** debits. |

## Classification for P&L

| Leading digit | Section | Sign treatment |
|---|---|---|
| `4xxx` | Revenue | Multiply by `-1` for positive display |
| `5xxx` – `9xxx` | Expenses | Keep as-is |
| `1xxx`, `2xxx`, `3xxx` | Balance Sheet | **Exclude** — SQL filter `ACCOUNT_TYPE >= '4000'` handles this |

## Net Income sign

`Revenue (positive)` − `Expenses (positive)` = profit positive, loss
negative. Apply the `*-1` to revenue **before** computing net income.

## FUND_NAME filters, it never groups

The P&L produces a single consolidated Actual column per block (Period and
YTD). The `GROUP BY ACCOUNT_TYPE, ACCOUNT_NAME` rolls the same COA account up
across every in-scope entity into one row — that is what makes the report
*consolidating*.

`FUND_NAME` belongs in the `WHERE` clause, controlled by `<ENTITY_SCOPE>`:

- `<ENTITY_SCOPE> = all` → omit the predicate entirely; sum across every entity
  under the firm.
- `<ENTITY_SCOPE>` is a list → `AND FUND_NAME IN ('<name>', …)`. Escape embedded
  single quotes by doubling them (`O''Brien Capital`); entity legal names
  routinely contain apostrophes, commas, and periods.

Narrowing the scope changes which entities are summed, not the shape of the
result. Adding `FUND_NAME` to the `GROUP BY` would produce per-entity columns —
a different report; clarify before building that.

## Period semantics

Both blocks come from `<PERIOD_START>`, `<PERIOD_END>`, and
`<YTD_START>` (= January 1 of `<PERIOD_END>`'s year):

- **Period**: `EFFECTIVE_DATE BETWEEN <PERIOD_START> AND <PERIOD_END>` — any
  span the user asked for: a month, a quarter, a year, or an arbitrary range.
  **Do not assume a single calendar month.**
- **YTD**: `EFFECTIVE_DATE BETWEEN <YTD_START> AND <PERIOD_END>`

Both are queried in one round trip using `SUM(CASE WHEN … THEN AMOUNT ELSE
0 END)` aggregates.

**Outer-filter trap.** The outer `EFFECTIVE_DATE` predicate must span
`<WINDOW_START>` → `<PERIOD_END>`, where `<WINDOW_START>` is the *earlier* of
`<PERIOD_START>` and `<YTD_START>`. When the period begins before January 1 of
the end year, an outer filter starting at `<YTD_START>` silently drops the part
of the period that falls in the prior year, and the Period column comes back
understated with no error.

For the same reason the `HAVING` clause must test **both** blocks for non-zero
activity: an account can have period activity and zero YTD activity.

## Why no COA join

`ACCOUNT_TYPE` and `ACCOUNT_NAME` are denormalized onto every JE row.
There's no need to join against a chart of accounts table. Don't write
joins.
