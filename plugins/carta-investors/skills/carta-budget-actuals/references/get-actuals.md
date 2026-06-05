# Reference: canonical actuals query

Every budget skill pulls actuals through this helper, not inline SQL.

## SQL

See [`../queries/actuals-by-account-month.sql`](../queries/actuals-by-account-month.sql). Substitute `<entity_name>`, `<period_start>`, `<period_end>`:

```sql
SELECT
    ACCOUNT_TYPE                                                AS gl_code,
    ACCOUNT_NAME                                                AS account_name,
    DATE_TRUNC('MONTH', EFFECTIVE_DATE)                         AS period_month,
    SUM(CASE WHEN LEFT(ACCOUNT_TYPE, 1) = '4' THEN -AMOUNT
             ELSE AMOUNT END)                                   AS signed_amount
FROM <journal_entries_table>
WHERE FUND_NAME = '<entity_name>'
  AND ACCOUNT_TYPE >= '4000'
  AND EFFECTIVE_DATE BETWEEN '<period_start>' AND '<period_end>'
GROUP BY 1, 2, 3
ORDER BY 1, 3;
```

## Fetch shape — exact parameter names

```
fetch(command="dwh:execute:query", params={"sql": "<SQL>", "format": "ndjson"})
fetch(command="dwh:get:table_schema", params={"table_name": "<journal_entries_table>"})
```

- Query parameter is `sql`, NOT `query`.
- Schema parameter is `table_name`, NOT `table`.
- `format` accepts `"ndjson"` and `"markdown"`. `"csv"` is not supported.

## Hard rules (apply on the first query)

1. **Source table:** only the Carta DWH journal-entries table. Don't probe others or fall back to a generic external DWH.
2. **Entity scoping:** `WHERE FUND_NAME = '<entity_name>'`. Never `FIRM_NAME ILIKE` (pulls every fund + SPV under the firm).
3. **Books date:** `EFFECTIVE_DATE`, not `POSTED_DATE`.
4. **Sign convention:** `AMOUNT` is signed. Revenue (`4xxx`) flip via `LEFT(ACCOUNT_TYPE,1) = '4'`. Don't use `NORMAL_BALANCE`.
5. **Scope to P&L:** `ACCOUNT_TYPE >= '4000'` — excludes balance-sheet (1xxx/2xxx/3xxx).
6. **Reversals:** preserve negative postings as-is.

## ManCo pre-flight sanity check

The calling SKILL.md treats this as a named gate (Gate 5 in `carta-budget-actuals`).

For management-company entities, scan returned `account_name` values for:
- `Interest expense`
- `Realized gain` / `Unrealized gain` / `Realized loss` / `Unrealized loss`
- `Audit fees`
- `Dead deal`
- `LOC fees` / `LOC interest`
- `Management fees` (expense side)

If **any** appear, the scope is wrong. **Halt before any write.** Tell the user: *"I'm stopping before writing to your workbook because fund-level accounts showed up in the management-company result. Please confirm the exact ManCo entity name and I'll retry."* Offer retry.

## Sparse-history check

After grouping by `account_name`, count distinct months with non-zero `signed_amount`. If **< 6**, flag `low-confidence — sparse history`. Soft warning — not a halt.

Caller surfaces in the Gate 5 preview Source column and as cell comments on written rows.
