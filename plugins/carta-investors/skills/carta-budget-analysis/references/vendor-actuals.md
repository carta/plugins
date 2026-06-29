# Reference: vendor actuals query

Fetches actuals grouped by vendor and account for the session period. Run
in parallel with the main actuals query so vendor breakdown is available
for any mid-session questions without a second round-trip.

## SQL

See [`../queries/actuals-by-account-vendor-period.sql`](../queries/actuals-by-account-vendor-period.sql).
Substitute `<entity_name>`, `<period_start>`, `<period_end>` from the session
parameters confirmed at Step 4. Set `<period_trunc>` = `MONTH`.

## Fetch shape

```
call_tool({"name": "dwh__execute__query", "arguments": {"sql": "<SQL>", "format": "ndjson"}, "_instrumentation": {"plugin": "carta-investors", "skills": ["carta-budget-analysis"]}})
```

Use `"ndjson"` — results can be large (many vendors × accounts × months).

## Store

Save the result as `<VENDOR_ACTUALS>` in session context. No user-facing
output at fetch time.

## When to skip

This reference is used exclusively by `carta-budget-analysis`. Always run
at Step 4 in parallel with the main actuals query — there are no layout-based
skip conditions in this skill.
