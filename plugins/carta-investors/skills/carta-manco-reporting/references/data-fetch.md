# Fetching journal entries from the warehouse

Step 3 in full: fetching journal-entry and budget data directly in this skill's own
context via `<SERVER>` (Step 1) — no subagent dispatch. `carta-investors:carta-fund-modeling`,
another live-MCP microapp fetching a comparable volume of DWH data, uses the same
direct-call pattern; a dispatched subagent's `tools:` list is a closed set with no
cross-server wildcard, so it can never reach an MCP connector namespaced under an
opaque ID (e.g. Claude Desktop's per-org connector) the way this skill's own,
unrestricted tool surface can.

> Steps referenced here that are documented elsewhere: **Step 2.5** → [budget-ingest.md](budget-ingest.md); **Step 2.75** → [budget-ingest.md](budget-ingest.md).

## Step 2.6 — The chart of accounts, before the budget questions

**SILENT.** One query, run once Step 2 has confirmed the entity and Step 2.5
has resolved `raw_dir` — and before anything in Step 2.75.

It is the same Query E documented under Step 3, moved earlier and issued on
its own. The reason it moves: every question Step 2.75 asks about a workbook
is a question about how that workbook's rows relate to Carta's accounts, and
until this file exists nothing in the run can tell. With it in hand,
`inspect_workbook.py --accounts` reports a `row_axis` per sheet — whether a
sheet's rows name Carta's accounts or the firm's own categories — measured
rather than asked about.

It is cheap where the rest of Step 3 is not: one `DISTINCT` over a single
entity, tens of rows, no paging, no year window. Running it early costs one
round-trip on a cold run and nothing at all on a warm one.

**Skip it when `<raw_dir>/accounts-all.txt` already exists and Step 2.5 does
not list it in `needs_fetch`.** A warm cache already holds it from a previous
run, and its staleness age is 30 days — a chart of accounts is not something
a firm rewrites between two invocations on the same afternoon.

Issue Query E exactly as written under Step 3 below, then save it alone:

```bash
S="${CLAUDE_PLUGIN_ROOT}/skills/carta-manco-reporting/scripts/save_query_result.py"
uv run "$S" --from-session 'DISTINCT ACCOUNT_TYPE' "<raw_dir>/accounts-all.txt"
```

`<raw_dir>` and `needs_fetch` both come from Step 2.5's `manco_paths.py
resolve` output.

**A firm whose warehouse returns nothing here gets no measurement, not a
guess.** The file is absent, `--accounts` is omitted, `row_axis` comes back
`null`, and Step 2.75 asks what it has always asked. This is a real case, not
a hypothetical: one firm's warehouse data has gone missing entirely, and the
run has to stay correct for them.

When this step runs, **Step 3 omits Query E and its save line** — the file is
already on disk.

## Step 3 — Fetch from the warehouse

**SILENT** — no user-facing output in this step, beyond the one cache line below.

When `needs_fetch` is empty, say one line — *"Cache is current; nothing to refetch."* —
and go to Step 4.

Otherwise, run the fetch below using `<SERVER>` and `<FIRM_UUID>` (Step 1),
`<MANCO_UUID>` / `<MANCO_ENTITY_ID>` (Step 2), and `raw_dir`, `needs_fetch`,
`<YEAR>`, `<MAX_MO>` and `<AS_OF>` — all from Step 2.5's `manco_paths.py resolve`
output.

**`<YEAR>`, `<MAX_MO>` and `<AS_OF>` are read from `resolve`, never computed
by hand.** They come back as `year`, `max_mo` and `as_of` on that same JSON.
Deriving them yourself is how two runs on the same day end up scoping to
different months and building two different dashboards for one firm, with
no error in between.

**Parallel with Step 2.75b.** When the cache is cold (this step runs) and a workbook
is being parsed (Step 2.75b will run), issue this step's `call_tool` block and Step
2.75b's `parse_budget_workbook.py` Bash calls in the **same tool-use message** — the
two are independent once Step 2.75a has confirmed the workbook and sheets.

### Verify the firm context before spending a single DWH call on it

`set_context` in Step 1 can silently no-op or land on the wrong firm, and a stray
tool call between Step 2 and here can drift it too. Every query below scopes by
UUID and returns an *empty result, with no error*, when the session's active firm
doesn't match — four empty pages read exactly like "this ManCo has no data" unless
something catches it first:

```
mcp__<SERVER>__list_contexts()
```

Find the entry marked active (however this MCP surfaces that — an `is_active: true`
field, an `(active)` suffix on the firm's line, etc.) and compare its firm UUID
against `<FIRM_UUID>`. If they don't match, retry
`mcp__<SERVER>__set_context(firm_id="<FIRM_UUID>")` once; if the second attempt
still doesn't match, stop and tell the user:

> "The Carta session's active firm changed mid-run — please re-invoke the skill."

Do not proceed to the queries below on a persistent mismatch — every one of them
would scope to the wrong firm and come back empty with no error, which is exactly
the failure this check exists to catch before it costs four DWH round-trips instead
of one.

### Determine scope

Parse `needs_fetch`:
- `all` → fetch every file
- Otherwise → only issue calls whose output file appears in the list

Skip the budget calls below when Step 2.75 ended with a workbook in play, even if
`budget-<YEAR>-01.json` through `budget-<YEAR>-12.json` appear in `needs_fetch`.

### Issue the parallel fetch block

**Issue every call in a SINGLE tool-use message.** Splitting into multiple messages
turns a ~4s parallel fanout into 20+ seconds of sequential waiting.

Run Queries A–D via `mcp__<SERVER>__call_tool` with `name="dwh__execute__query"` and
`arguments={"sql": "...", "format": "markdown"}`. Run cash balance and budget calls
via `mcp__<SERVER>__call_tool` as shown below. All go in **one assistant message** as
parallel tool calls.

#### Query A — ManCo expenses → `je-expense-page1.txt`

```sql
SELECT JOURNAL_ENTRY_LINE_ID AS id, JOURNAL_ENTRY_GLUUID AS gluuid, EFFECTIVE_DATE AS date,
       MONTH(EFFECTIVE_DATE) AS mo, ACCOUNT_NAME AS account, ACCOUNT_TYPE AS acct_type,
       COALESCE(SUB_ACCOUNT_NAME, '') AS sub,
       COALESCE(SUB_ACCOUNT_TYPE, '') AS sub_code, AMOUNT AS amt,
       COALESCE(JOURNAL_ENTRY_DESCRIPTION, '') AS descr, COALESCE(VENDOR_NAME, '') AS vendor,
       COALESCE(VENDOR_TYPE, '') AS vendor_type,
       COALESCE(PARTNER_NAME, '') AS partner, COALESCE(EVENT_TYPE, '') AS event_type,
       COALESCE(REPORTING_TAGS, '') AS tags,
       COALESCE(TO_VARCHAR(REPORTING_TAGS_JSON), '') AS tags_json
FROM JOURNAL_ENTRIES
WHERE FUND_UUID = '<MANCO_UUID>'
  AND YEAR(EFFECTIVE_DATE) = <YEAR>
  AND MONTH(EFFECTIVE_DATE) <= <MAX_MO>
  AND ACCOUNT_TYPE >= 5000
ORDER BY EFFECTIVE_DATE, ACCOUNT_TYPE
LIMIT 1000
```

#### Query A2 — entries settled through the reimbursement payable → `reimbursement-entries.txt`

A reimbursement credits a liability to the person and clears when they are
repaid. That booking is the firm's own record of what the payment was, and
it beats reading the expense side: it doesn't care whether they expensed a
hotel or a phone bill, and it never mistakes a food-delivery company for an
employee.

**Resolve the account from the firm's own chart, never by number.** One
firm's `2151` is another's something else, and the same mistake as
hardcoding a tag category. Match on a liability account whose name carries
the word:

```sql
SELECT DISTINCT JOURNAL_ENTRY_GLUUID AS gluuid
FROM JOURNAL_ENTRIES
WHERE FUND_UUID = '<MANCO_UUID>'
  AND YEAR(EFFECTIVE_DATE) = <YEAR>
  AND MONTH(EFFECTIVE_DATE) <= <MAX_MO>
  AND ACCOUNT_TYPE < 4000
  AND ACCOUNT_NAME ILIKE '%reimburs%'
```

One column, one row per entry. The build joins it to the expense lines on
`gluuid` — a field they already carry — and groups those lines under
"Employee reimbursements" (see [budget-ingest.md](budget-ingest.md) Step
4.6). A firm with no such account returns nothing, and nothing is grouped.

#### Query B — ManCo income → `je-income.txt`

Same SELECT as Query A (including `tags_json`), but `ABS(AMOUNT) AS amt` and
`ACCOUNT_TYPE >= 4000 AND ACCOUNT_TYPE < 5000`, `LIMIT 1000`. Income keeps its
upper bound — 4000-4999 is the income band; expenses start at 5000, so
Query A's `>= 5000` (no upper bound) picks up everything above it.

#### Query C — Fund-side management fee entries → `fund-fees.txt`

```sql
SELECT JOURNAL_ENTRY_LINE_ID AS id, JOURNAL_ENTRY_GLUUID AS gluuid,
       FUND_NAME AS fund, FUND_UUID AS fund_uuid,
       EFFECTIVE_DATE AS date, YEAR(EFFECTIVE_DATE) AS yr, MONTH(EFFECTIVE_DATE) AS mo,
       ACCOUNT_NAME AS account, ACCOUNT_TYPE AS acct_type,
       COALESCE(SUB_ACCOUNT_NAME, '') AS sub,
       COALESCE(SUB_ACCOUNT_TYPE, '') AS sub_code, AMOUNT AS amt,
       COALESCE(JOURNAL_ENTRY_DESCRIPTION, '') AS descr, COALESCE(VENDOR_NAME, '') AS vendor,
       COALESCE(VENDOR_TYPE, '') AS vendor_type,
       COALESCE(PARTNER_NAME, '') AS partner, COALESCE(EVENT_TYPE, '') AS event_type,
       COALESCE(REPORTING_TAGS, '') AS tags,
       COALESCE(TO_VARCHAR(REPORTING_TAGS_JSON), '') AS tags_json
FROM JOURNAL_ENTRIES
WHERE FIRM_ID = '<FIRM_UUID>'
  AND FUND_UUID != '<MANCO_UUID>'
  AND YEAR(EFFECTIVE_DATE) BETWEEN <YEAR>-5 AND <YEAR>
  AND MONTH(EFFECTIVE_DATE) <= <MAX_MO>
  AND ACCOUNT_TYPE >= 5000
  AND (LOWER(ACCOUNT_NAME) LIKE '%management fee%' OR LOWER(ACCOUNT_NAME) LIKE '%mgmt fee%')
ORDER BY yr DESC, EFFECTIVE_DATE
LIMIT 1000
```

**The name filter is what this query can and cannot answer.** It carries
every half of a management fee — the fee, its offset, a true-up — because
each is named for it, and the budget's per-fund fee lines resolve against
all of them. It carries nothing else a ManCo charges its funds. Measured on
one firm: deal fees, real money, invisible here. So a workbook breaking out
**income other than management fees per fund** has a line with no actuals
behind it, and the mapping gate can neither propose nor resolve it — the
gap is in what was fetched, not in what was matched. Dropping the filter is
not the fix: on that same firm it takes the fund side from 242 rows to
5,578, over a window this query already pages at a thousand.

**Every query here uses `LIMIT 1000` because that is the page the transport
returns.** A larger `LIMIT` in the SQL does not produce a larger page — the
response still comes back `limit: 1000`, so rows past the thousandth are
dropped while the pagination rule below, keyed to the SQL's number, never
fires. Matching the two is what keeps a truncated pull loud.

#### Query D — ManCo reporting currency → `manco-currency.txt`

`Query returned no results.` is a normal answer here, not a failure: a ManCo
is not always carried in `AGGREGATE_FUND_METRICS`. Save the empty result as-is
and carry on. The build then names the currency from `cash-balance.json`, which
states it per entity, and renders `—` rather than guessing when a ManCo holds
more than one.

```sql
SELECT fund_reporting_currency AS currency
FROM FUND_ADMIN.AGGREGATE_FUND_METRICS
WHERE fund_uuid = '<MANCO_UUID>'
QUALIFY ROW_NUMBER() OVER (PARTITION BY fund_uuid ORDER BY month_end_date DESC, last_refreshed_at DESC) = 1
```

#### Query E — every account the ManCo has ever used → `accounts-all.txt`

**Normally already fetched by Step 2.6.** Issue it here only when that step
skipped it and the file is still missing. The query is unchanged either way;
it is documented here because this is where the rest of its family lives.

Unfiltered by year, unlike every other query here. Budget lines are matched
to Carta accounts by name, and a budget names the spend a firm expects —
which is exactly the spend that may not have happened yet this year. Scoped
to the reporting window, an account dormant in `<YEAR>` looks to the matcher
like an account that doesn't exist, and its budget line becomes a question
the operator has to answer about data Carta already holds.

```sql
SELECT DISTINCT ACCOUNT_TYPE AS acct_type, ACCOUNT_NAME AS account
FROM JOURNAL_ENTRIES
WHERE FUND_UUID = '<MANCO_UUID>'
  AND ACCOUNT_NAME IS NOT NULL
ORDER BY ACCOUNT_TYPE
```

The build merges this with the window's own entries and lets the window win
on wording, so an account renamed since is known by the name it carries now.
An absent file is not an error — the build falls back to the window alone,
which is what an older raw dir contains.

#### Query F — Management fee schedule terms → `management-fee-schedules.txt`

Contracted LPA terms (rate, calculation base, period dates, frequency), not
posted actuals — those are Query C. Unfiltered by year, like Query E: the
schedule spans a fund's full life, and a period outside the reporting window
is exactly the one a reader opens this table to check.

```sql
SELECT fund_name AS fund, fund_id AS fund_uuid, period_name, fee_rate,
       calculation_base, minimum_fee_amount, fixed_fee_amount, fee_currency,
       frequency, waived, start_date, end_date,
       period_order, uses_custom_calculation_base
FROM FUND_ADMIN.MANAGEMENT_FEE_SCHEDULES
WHERE firm_id = '<FIRM_UUID>'
ORDER BY fund_name, period_order
```

`minimum_fee_amount`/`fixed_fee_amount`/`fee_currency` are newer columns
(carta/ds-dbt#13083) than the rest of this table — an "invalid identifier"
compilation error naming one of them, on an environment where the base
table exists but hasn't rebuilt with the new columns yet, is covered by
the same non-fatal handling below as the whole-table-missing case: skip
saving, continue, don't retry.

**This query alone may fail with a compilation error (e.g. "object does not
exist") rather than an empty result, in an environment the table hasn't
reached yet — treat that specific error as a normal absence, not the hard
failure the "Reading the result" section describes for every other query
here.** Skip saving `management-fee-schedules.txt` and continue; a missing
file behaves exactly like an older raw dir predating this fetch (Step 4
shows no fee-schedule terms for that fund without complaint). Do not retry
this one query and do not let its failure abort Queries A–E, cash balance,
or budgets.

#### Cash balance → `cash-balance.json`

```
mcp__<SERVER>__call_tool(name="fa__get__cash-balance", arguments={
  "firm_uuid":  "<FIRM_UUID>",
  "as_of_date": "<AS_OF>",
  "entity_ids": [<MANCO_ENTITY_ID>]
})
```

`entity_ids` takes the **integer** `<MANCO_ENTITY_ID>` — not the UUID, not `carta_id`.

#### Budget fetches (only when no workbook is in play) → `budget-<YEAR>-01.json` .. `budget-<YEAR>-12.json`

For each month M from 1 to 12 — **all twelve, not just up to `<MAX_MO>`**, and
only those `needs_fetch` names. The months after `<MAX_MO>` are not padding:
they carry the annual budget totals and the full-year row in the Budget vs
Actuals outline. Fetching only through `<MAX_MO>` turns annual figures into
YTD figures, with nothing on the page to say so.

Months already closed are fetched once and then kept for a year, so a routine
refresh asks only for `<MAX_MO>` through 12. That is `needs_fetch`'s job — issue
what it names, nothing more.

```
mcp__<SERVER>__call_tool(name="fa__list__budgets", arguments={
  "fund_uuid":  "<MANCO_UUID>",
  "start_date": "<YEAR>-<M zero-padded>-01",
  "end_date":   "<YEAR>-<M zero-padded>-<last day of month>"
})
```

Include all 12 in the same parallel message as the DWH queries — not a second message.

### Save all results

**Never retype a result.** Every response is already written to the session
log, verbatim, the moment it arrives. `--from-session` reads it back from
there by matching text from the **request** you sent, so the bytes that
reach `<raw_dir>` are the bytes Carta returned. Copying a payload out of the
conversation by hand — one row or two hundred — is the hand-reconstruction
that silently changes a firm's numbers, and it is never necessary.

**This also saves Step 2's `fa__list__entities` response**, as
`entities.json` — the roster Step 4 reads each fund's own `carta_id` from
for the fee-chart drill-down link (Query C carries no such column). If that
call has scrolled out of the session log (a long Step 2.75 gap, or a
compaction), re-issue `fa__list__entities` fresh right before this save —
it's a cheap, idempotent call, unlike Queries A–F.

One Bash call saves everything. It runs the writes concurrently, so this is
a couple of seconds regardless of how many stems came back:

```bash
S="${CLAUDE_PLUGIN_ROOT}/skills/carta-manco-reporting/scripts/save_query_result.py"
R="<raw_dir>"
uv run "$S" --from-session "FUND_UUID = '<MANCO_UUID>'" \
            --from-session 'ACCOUNT_TYPE >= 5000'        "$R/je-expense-page1.txt" &
uv run "$S" --from-session 'ACCOUNT_TYPE >= 4000'        "$R/je-income.txt" &
uv run "$S" --from-session "FUND_UUID != '<MANCO_UUID>'" "$R/fund-fees.txt" &
uv run "$S" --from-session 'DISTINCT ACCOUNT_TYPE'          "$R/accounts-all.txt" &  # only if Step 2.6 skipped it
uv run "$S" --from-session 'AGGREGATE_FUND_METRICS'      "$R/manco-currency.txt" &
uv run "$S" --from-session 'MANAGEMENT_FEE_SCHEDULES'    "$R/management-fee-schedules.txt" &
uv run "$S" --from-session 'fa__get__cash-balance'       "$R/cash-balance.json" &
uv run "$S" --from-session '<YEAR>-01-01'                "$R/budget-<YEAR>-01.json" &
uv run "$S" --from-session 'fa__list__entities'          "$R/entities.json" &
wait
```

One line per stem `needs_fetch` named, with the budget line repeated for each
month fetched.

**The needles must single out one call.** Each is matched as a plain
substring of the request, all of them must match the same call, and the most
recent match wins. One needle is rarely enough: `ACCOUNT_TYPE >= 5000` reads
like Query A but names Query C as well, and `FUND_UUID = '<MANCO_UUID>'`
names Query A and Query B — either one alone writes another query's rows
into the file, and the dashboard renders them without complaint. Query A
therefore takes both. The script warns when more than one call matched;
treat that warning as a failed save and re-run with another needle. For a
pagination page, add its offset: `--from-session 'OFFSET 1000'`.

Issue this as your **very next action** once the responses are in — no
narration, no status update, no other tool call in between. A context
compaction landing in that gap takes the results with it. If you resume
mid-fetch and a stem is missing, re-run that query rather than reconstructing
it: `--from-session` still works on anything the log already holds.

`save_query_result.py` prints a warning when a saved page holds fewer rows
than the query found. Act on it — that is the pagination trigger below.

### Pagination

After saving page 1, check the `total_rows:` banner in the saved file.

**Query A**: If `total_rows: N` where N ≥ 1000, fetch `LIMIT 1000 OFFSET 1000` → save
with `--append` to `je-expense-page2.txt`. Continue (OFFSET 2000 → page3, etc.) until
a page returns fewer rows than the limit. **Maximum 5 pages (5,000 rows).** If page 5
still has `total_rows` above 5,000, stop fetching that stem and surface it as
truncated (below).

**Query C**: Same pattern starting from `total_rows: N` ≥ 1000. `LIMIT 1000 OFFSET 1000`
→ `fund-fees-page2.txt`. **Maximum 5 pages (5,000 rows).** Same honest-failure rule.

**Do not**, on hitting either cap: raise `LIMIT` above 1,000 to fit more rows
in fewer pages (the transport pages at 1,000 whatever the SQL asks, so a higher
number drops rows rather than returning them); narrow the `FUND_UUID` or
date-range filter to duck under the cap; or hand `build_manco_datadir.py` a
partial pull and call it done without surfacing `status: "truncated"` to the
user. Each of those turns a
loud, honest truncation back into the silent wrong-data bug this cap exists to
catch — the dashboard would show a firm's real numbers as if they were complete.

Pagination pages are fetched and saved sequentially — each offset waits on the prior
page's `total_rows`.

### Write `.fetched-at`

```
Write("<raw_dir>/.fetched-at", "<AS_OF>")
```

### Reading the result

On a clean fetch, proceed to Step 4.

On a pagination cap hit (Query A or C still shows `total_rows` above the cap after
5 pages), tell the user in one plain-English line that the ledger is larger than
the cap covers, then proceed to Step 4 — the build script handles a partial pull,
but the user should know the dashboard reflects only the first N rows. Don't fetch
a 6th page.

On a hard failure — the firm-context check above fails persistently, or a query
errors outright — surface the reason to the user and stop. Do not proceed to
Step 4 with incomplete data, and do not fabricate a missing file.
