---
name: carta-loan-dashboard
description: >
  Loan portfolio dashboard as a persistent Cowork artifact — KPI tiles and every
  loan in the portfolio, data from Carta via the MCP. This is the LOAN portfolio
  (borrowers, advances, commitments). Do NOT use for LP investment portfolios.

  Triggers: "loan dashboard", "loan ops dashboard", "loan portfolio",
  "show my loans", "pull up my loan portfolio", "what are my outstanding loans",
  "how much have we drawn across our loans".
version: 1.0.0
model: inherit
allowed-tools:
  - mcp__carta__call_tool
  - mcp__carta__welcome
  - mcp__claude_ai_Carta__call_tool
  - mcp__claude_ai_Carta__welcome
  - mcp__2827383e-1775-4df3-b6ff-04d5392f6d18__call_tool
  - mcp__2827383e-1775-4df3-b6ff-04d5392f6d18__welcome
  # Step 2: find the firm the user names (list_contexts) and switch to it (set_context).
  - mcp__carta__list_contexts
  - mcp__claude_ai_Carta__list_contexts
  - mcp__2827383e-1775-4df3-b6ff-04d5392f6d18__list_contexts
  - mcp__carta__set_context
  - mcp__claude_ai_Carta__set_context
  - mcp__2827383e-1775-4df3-b6ff-04d5392f6d18__set_context
  - Artifact
  - AskUserQuestion
  - read_skill
  - Read
  - Write
  - Bash(carta workspace cache *)
  - Bash(command -v *)
  - Bash(jq *)
  - Bash(uv run *)
  - Bash(find *)
  - Bash(mkdir -p *)
---

<!-- carta:plugin-version -->
<carta-plugin>carta-investors:6.57.5</carta-plugin>

[PATTERN carta-writing-style v0.0.2]
[PATTERN etiquette v0.0.6]
[PATTERN text v0.0.8]
[PATTERN tables v0.0.12]
[PATTERN carta-watermark v0.0.10]
[PATTERN base v0.1.0]

# Loan Dashboard Skill

Creates (or updates) a persistent Cowork artifact showing the user's loan portfolio: KPI tiles + a table of the portfolio's active loans. The artifact **fetches its own rows from Carta every time it is opened**, so it never goes stale; the skill injects only configuration — the MCP tool name, the resolved table and column names, and the firm label. The skill is identity-agnostic — RAP scopes which loans are visible via the firm context; neither the skill nor the artifact adds a firm filter.

The artifact's aggregate SQL groups by currency, so a cross-currency total is not expressible: it renders one currency at a time and names which. That guard has to live where the numbers are fetched.

## Steps

Steps 2–4 each carry a network round-trip (the schema-validation query alone runs ~20–55s depending on whether the fallback probe fires). Post a one-line status after each — connecting, resolving schema, validating data, rendering, publishing — so the user isn't staring at silence during the wait.

### 1. Identify the Carta connector
Scan the tools available in the conversation (system-reminder blocks) for `mcp__claude_ai_<connector>__call_tool` that also has a matching `…__welcome`. None found → tell the user you checked the conversation's tool list for a Carta connector (`call_tool` + matching `welcome`) and found none, point them to connect one via their claude.ai connector settings, and stop (error table: *No connector found*). Exactly one → use it. Multiple → ask the user which.

Keep that connector's **display name** as `<CARTA_MCP_SERVER>`. That single string is all the artifact needs: the runtime addresses a connector by display name and the tool names are bare verbs (`call_tool`, `welcome`), so nothing has to be derived or kept in sync. Never substitute a UUID or an `mcp__…__` tool name — the runtime rejects both.

### 2. Call welcome to verify the connection
Call `mcp__<SERVER>__welcome(_instrumentation={"plugin": "carta-investors", "skills": ["carta-loan-dashboard"]})` — every run, including a refresh of an existing dashboard. It verifies the Carta session is live and resolves identity/firm context; every other Carta command is gated behind it and returns a reminder instead of data. If it fails, tell the user what `welcome` returned, that the dashboard cannot resolve firm/identity context without it, and to retry once their Carta session is confirmed live — then stop (error table: *`welcome` fails*). Read the resolved firm context from the result.

Read the environment from the result too (`env_line`, e.g. "Connected to Carta `production`") and bind `<lo_base_url>` from it — production `https://loan-operations.app.carta.com`, sandbox `https://loan-operations.sandbox.carta.team`. Never hardcode one: a production URL handed to a sandbox viewer looks like a working link and opens someone else's environment. Any other environment, or one that does not resolve: omit `lo_base_url` — the artifact then renders names unlinked rather than guessing a host.

**Resolve the firm the user means, even if another firm is active.** Row access follows the active firm, so pick the firm before any query runs. Call `list_contexts`, passing the name if the user gave one:

```text
list_contexts({"firm_name": "<firm_name>"})
```

Read `firms` and `active_firm_id` from the structured result. For a Carta staff account the name is a search across all firms. For everyone else it is ignored and you get their own firms, so match the name yourself.

- **User named a firm, exactly one match** → use it. Say which firm you're building for; don't ask again.
- **Several match** → ask with `AskUserQuestion`, one option per firm.
- **None match** → tell the user you searched their firms for "<firm_name>" and found no match, list the firms they can access (up to five), and stop (error table: *Named firm not found*).
- **No firm named** → call `list_contexts` with no arguments and take the single firm, or the one whose `is_active` is true. Show it and confirm it's the one they want, in the same turn. With several firms and none active, ask. An empty list is normal for a staff account — staff can reach every firm, so they have no default — so ask which firm rather than stopping.

If that firm is not already active, switch to it before going on:

```text
set_context({"firm_id": "<firm_uuid>"})
```

This also changes the user's active firm in Carta, which is why it only happens when the firm is not already active. Carry the firm's name into Step 5's `firm_name` and its UUID into `firm_context_id`. The artifact re-pins the context itself on every load, because the viewer's connector opens on whatever firm they last used, not on yours — that UUID comes from `list_contexts` and is **not** the `LENDING_FIRM_ID` on the warehouse rows, so never derive one from the other.

Every Carta tool call in this skill carries `_instrumentation` — it records the invocation for telemetry. Include it on `welcome` and on every `call_tool` below.

### 3. Resolve the schema (optimistic — probe only on failure)
The loan schema is known and stable. Resolving it with an upfront `dwh__list__tables` + `SELECT * FROM … LIMIT 1` probe on **every** run is avoidable latency (measured: ~21s probe + ~34s retry on a column-name mismatch = ~55s, ~31% of wall time). **Bind the placeholders to the confirmed schema below and query it directly (Step 4). Do NOT probe up front. Fall back to discovery only when a query actually errors.**

**Why raw SQL, not `dwh__execute__question`.** The house tool ladder runs `fa:*` commands → `dwh__execute__question` → semantic-layer SQL → raw `dwh__execute__query`, and this skill sits at the bottom of it on purpose. The template is a fixed contract: every value must arrive under the exact alias Step 5 parses. A natural-language question returns whatever shape it picks, so it cannot hold that contract.

Confirmed schema (data-explorer / datashare layer exposed via the MCP, verified live):
- Tables: `<loan_table>` = `LOAN_OPS.LOAN`, `<obl_table>` = `LOAN_OPS.PAYMENT_OBLIGATION`, `<adv_table>` = `LOAN_OPS.ADVANCE`, `<memo_table>` = `LOAN_OPS.MEMO`, `<company_table>` = `LOAN_OPS.COMPANY`
- Columns: `<committed>`=`TOTAL_COMMITMENT`, `<drawn>`=`TOTAL_DRAWN_AMOUNT`, `<outstanding>`=`OUTSTANDING_PRINCIPAL`, `<currency>`=`CURRENCY_CODE`, `<active>`=`IS_ACTIVE`, `<firm_name>`=`LENDING_FIRM_NAME`, `<loan_name>`=`LOAN_NAME`, `<borrower>`=`BORROWER_NAME`, `<lead_lender>`=`LEAD_LENDER_NAME`, `<loan_id>`=`LOAN_ID`, `<closing>`=`CLOSING_DATE`, `<loan_nano_id>`=`LOAN_NANO_ID`, `<lending_firm_id>`=`LENDING_FIRM_ID`
- Company columns (the deep link's org segment): `<slug>`=`SLUG`, `<is_lending_firm>`=`IS_LENDING_FIRM`, and `LENDING_FIRM_ID` for the join
- Obligation columns: `<due_date>`=`DUE_DATE`, `<is_paid>`=`IS_PAID`, `<amount>`=`AMOUNT`, `<amount_currency>`=`AMOUNT_CURRENCY`, `<obl_loan_id>`=`LOAN_ID`, `<obl_type>`=`TYPE`, `<obl_projected>`=`IS_PROJECTED`, `<obl_memo_id>`=`MEMO_ID`
- Interest terms live on the obligation, not the loan: `<rate>`=`RATE`, `<credit_spread>`=`CREDIT_SPREAD`, `<benchmark_name>`=`BENCHMARK_NAME`, `<benchmark_rate>`=`BENCHMARK_RATE`, `<benchmark_floor>`=`BENCHMARK_FLOOR`, `<day_count>`=`DAY_COUNT_CONVENTION`, `<is_pik>`=`IS_PIK`, `<period_end>`=`PERIOD_END_DATE`. **These rates are decimal fractions** (`0.115` = 11.5%) — the artifact formats them as percentages and must not multiply by 100.
- Memo columns: `<memo_id>`=`MEMO_ID`, `<memo_due>`=`DUE_DATE`, `<memo_status>`=`STATUS`

**Two layers, because the context alone cannot be trusted.** Pinning `set_context` decides
which firm the warehouse *starts* answering for, but that scope is per-user state shared
across a session and can be rewritten **while a load is still running** — and these
dashboards page across many calls. A context scope alone has served another firm's rows
mid-load before. So the firm is also pinned
in the SQL and every returned page is checked against it:

- `firm_warehouse_id` — the firm as identified **on the warehouse rows**
  (`LENDING_FIRM_ID`). Injected as `AND <alias>.LENDING_FIRM_ID = '<id>'` on every
  firm-bearing query, and selected as `firm_id` so it can be verified.
- Every page is checked; a row from another firm **refuses the render** rather than
  painting it, because that means the scope moved mid-load and no retry fixes it.

**`firm_warehouse_id` and `firm_context_id` are DIFFERENT IDs for the same firm.** Neither
can be derived from the other —
read the context id from `list_contexts` and the row id from the warehouse
(`SELECT DISTINCT LENDING_FIRM_ID, LENDING_FIRM_NAME FROM <loan_table>` under the pinned
context). Getting them the wrong way round pins nothing and silently matches no rows.

Detail queries keyed by loan or memo id inherit the guard: those ids come from an
already-verified page, so a scope change makes them return nothing rather than another
firm's rows.

**`LOAN_OPS` row access follows the session's ACTIVE FIRM — probing unscoped as staff is convenient but is also the trap.** Unscoped, staff reads every firm at once, so the schema and the numbers look right while you build. Scoped to a firm, you read that firm's rows and no others. The same `SELECT COUNT(*) FROM LOAN_OPS.LOAN` returns a different firm's loans depending on which firm is active. A 0-row query returns no headers, so the schema becomes unreadable — probe unscoped, then pin the target firm for the artifact (Step 5's `firm_context_id`). `dwh__list__tables` does not enumerate `LOAN_OPS` at all, and both `SHOW` and `INFORMATION_SCHEMA` are blocked — probe tables by name with `SELECT * FROM <table> LIMIT 1`.

`<loan_id>` is the paging tiebreaker: the artifact fetches the whole portfolio with `offset`, which needs a total order or rows shuffle across page boundaries. If it does not resolve, the artifact falls back to `<loan_name>`.

**Fallback — trigger ONLY on a query error (warehouse layers diverge; the synonyms exist only to recover, never to pre-empt):**
- *Loan table not found* (the Step-4 query errors that `LOAN_OPS.LOAN` is unknown): call `call_tool({"name": "dwh__list__tables", "arguments": {}, "_instrumentation": {"plugin": "carta-investors", "skills": ["carta-loan-dashboard"]}})`, set `<loan_table>` to the datashare loan view (`LOAN` or ends `_LOAN`, e.g. `LOAN_OPS.LOANOPS_DATASHARE_LOAN`); re-run. If that returns no loan view at all, tell the user loan data isn't available in this context and stop (error table: *Loan table not found*).
- *Unknown column* (a layer names a money column differently): probe `SELECT * FROM <loan_table> LIMIT 1` (format markdown) and resolve — `<committed>` → first present of `TOTAL_COMMITMENT`, `TOTAL_COMMITTED_AMOUNT`; `<drawn>` → first present of `TOTAL_DRAWN_AMOUNT`, `TOTAL_DRAWN`; re-run. If a concept still has no matching column, drop its tile/column rather than erroring (error table: *Unknown column, no fallback match*).

**Error table — what to tell the user.** The steps point here by row name, so the wording each failure uses lives in one place:

| Symptom | Cause | Tell user |
|---|---|---|
| No connector found (Step 1) | No `call_tool`/`welcome` pair in the conversation's tool list | No Carta connector is available; connect one via claude.ai connector settings |
| `welcome` fails (Step 2) | Carta session not live, or identity/firm context unresolved | What `welcome` returned; the dashboard can't resolve firm context without it; retry once the session is confirmed live |
| Named firm not found (Step 2) | The name matches none of the firms the user can access | Which name was searched, which firms they can access, and to try again with one of those |
| Loan table not found (Step 3) | `LOAN_OPS.LOAN` unknown at this warehouse layer, and `dwh__list__tables` found no loan view either | Loan data isn't available in this context |
| Unknown column, no fallback match (Step 3) | Warehouse layer names a concept differently and no synonym resolved | That tile/column is dropped rather than shown wrong; portfolio totals still render |
| Zero rows in scope (Step 4) | The pinned firm has no loans | There are no loans in scope; the artifact still renders its empty state |
| Row from another firm mid-page (artifact) | Session's active firm changed while a page was still loading | The render is refused rather than painted; reopen the dashboard to reload under the current firm |

### 4. Validate the binding with one query
The artifact runs the real queries itself. Run this one **once, here**, for two reasons: it proves the
Step-3 names resolve (this is the error that triggers Step 3's fallback), and it proves RAP returns rows
before an artifact exists to show them.

```text
call_tool({"name": "dwh__execute__query",
           "arguments": {"sql": "<SQL>", "format": "markdown"},
           "_instrumentation": {"plugin": "carta-investors", "skills": ["carta-loan-dashboard"]}})
```
The param key is `sql`, **not** `query` — the trailing `query` in the tool name is not the param name.
`format` accepts `"markdown"` / `"ndjson"`; `"csv"` is not supported. `markdown` is right at this size —
`ndjson` returns an on-disk blob whose path must be captured and resolved. SELECT-only. No firm filter —
RAP scopes rows.

It is the same aggregate the artifact runs, **grouped by currency** so no total ever spans two:
```sql
SELECT <currency> AS currency_code, COUNT(*) AS total_loans,
       COUNT_IF(<active>) AS active_loans,
       SUM(<committed>) AS total_committed,
       SUM(<drawn>) AS total_drawn,
       SUM(<outstanding>) AS total_outstanding
FROM <loan_table>
GROUP BY <currency>
ORDER BY total_loans DESC;
```
Do **not** parse this into the artifact — it re-fetches on open, and a baked copy would go stale.
Zero rows → say there are no loans in scope; the artifact still renders, with its empty state (error table: *Zero rows in scope*).
If a resolved column is absent, drop it (and the dependent tile) rather than erroring.

**This query validates `<loan_table>` only — deliberately, not by oversight.** The other five tables in Step 5's config (`obligation_table`, `advance_table`, `structure_table`, `memo_table`, `company_table`) are read by the artifact itself, not by this skill, so validating them here would mean a second and third round-trip on every run — the same latency Step 3 already avoids for the loan table. Each of those tables follows the same drop-rather-than-error contract as the loan table's columns: a table or column that fails to resolve at artifact render time drops its dependent tile (as documented per-table above — e.g. `obligation_table` drops the Scheduled Payments tile) rather than failing the whole dashboard.

### 5. Assemble the config
The artifact needs the resolved names, not the numbers. Build exactly this:
```text
{ mcp_server: "<CARTA_MCP_SERVER>", loan_table: "<loan_table>", firm_name: "<firm resolved in step 2>",
  firm_context_id: "<firm UUID from list_contexts>",
  firm_warehouse_id: "<LENDING_FIRM_ID from the warehouse>",
  obligation_table: "<obl_table>", advance_table: "<adv_table>", structure_table: "<str_table>",
  memo_table: "<memo_table>", company_table: "<company_table>", lo_base_url: "<lo_base_url>",
  columns: { currency, active, committed, drawn, outstanding, loan_name, borrower, lead_lender, loan_id,
             loan_nano_id, lending_firm_id, slug, is_lending_firm,
             loan_tranche_count, loan_lender_count,
             due_date, is_paid, amount, amount_currency, obl_loan_id, obl_type,
             obl_projected, obl_memo_id, obl_advance_id, memo_id, memo_due, memo_status,
             rate, credit_spread, benchmark_name, benchmark_rate, benchmark_floor, day_count, is_pik, period_end,
             adv_loan_id, adv_name, adv_date, adv_amount, adv_id, adv_structure_id,
             closing, period_start, adv_maturity, adv_outstanding, adv_active,
             str_loan_id, str_id, str_name, str_type, str_committed, str_drawn, str_outstanding,
             str_advance_count, str_tranche_count, str_lender_count, str_closing,
             str_draw_period_end, str_currency, str_active,
             adv_currency, adv_principal_repaid, adv_interest_repaid, adv_pik_repaid,
             adv_pik_compounded } }
```
**Confirmed against `LOAN_OPS` on 2026-08-17 — these are read, not guessed:**

- `<loan_table>` = `LOAN_OPS.LOAN` — `LOAN_NAME`, `BORROWER_NAME`, `LENDING_FIRM_NAME`, `LEAD_LENDER_NAME`, `AGENT_NAME`, `CLOSING_DATE`, `TOTAL_COMMITMENT`, `TOTAL_DRAWN_AMOUNT`, `OUTSTANDING_PRINCIPAL`, `CURRENCY_CODE`, `TRANCHE_COUNT`, `LENDER_COUNT`, `IS_ACTIVE`, `LOAN_ID`, **`LOAN_NANO_ID`**, `LENDING_FIRM_ID`, `BORROWER_ID`, `LEAD_LENDER_ID`, `AGENT_ID`, `CREATED_AT`, `UPDATED_AT`, `_PK`, `LAST_REFRESHED_AT`. It carries **no maturity, draw-period or amortization column** — do not look for one here.
- `<str_table>` = `LOAN_OPS.STRUCTURE` — `STRUCTURE_NAME`, `STRUCTURE_TYPE`, `COMMITTED_AMOUNT`, `DRAWN_AMOUNT`, `OUTSTANDING_PRINCIPAL`, `ADVANCE_COUNT`, `TRANCHE_COUNT`, `LENDER_COUNT`, `CLOSING_DATE`, **`DRAW_PERIOD_END_DATE`**, `CURRENCY_CODE`, **`IS_ACTIVE`**, `STRUCTURE_ID`, `LOAN_ID`, plus the fee and prepayment terms (`LATE_FEE_FRACTION`, `LATE_FEE_GRACE_PERIOD_DAYS`, `PAYMENT_APPLICATION_ORDER`, `BUSINESS_DAY_ADJUSTMENT`, `BUSINESS_DAY_CALENDAR`, `PAYMENT_FLOAT_DAYS`, `PREPAYMENTS_ACCEPTED`, `INTEREST_BALANCE_PHASE_OF_DAY`, `IS_EFFECTIVE_DATE_INCLUDED`, `PREPAYMENT_PRINCIPAL_INVERSED`). No undrawn or amortization column.
- `<adv_table>` = `LOAN_OPS.ADVANCE` — `ADVANCE_NAME`, **`EFFECTIVE_DATE`** (the draw date), **`DISBURSED_AMOUNT`**, **`MATURITY_DATE`**, `COMMITTED_AMOUNT`, `OUTSTANDING_PRINCIPAL`, `PRINCIPAL_REPAID`, `INTEREST_REPAID`, `PIK_COMPOUNDED`, `PIK_REPAID`, `DEFAULT_REPAID`, `CURRENCY_CODE`, **`IS_ACTIVE`**, `TRANCHE_COUNT`, `LENDER_COUNT`, `ADVANCE_ID`, `STRUCTURE_ID`, `LOAN_ID`. This is the **only** maturity column in `LOAN_OPS`.
- `<obl_table>` = `LOAN_OPS.PAYMENT_OBLIGATION` — additionally carries `STATUS`, **`IS_PROJECTED`**, **`MEMO_ID`**, `PAID_AT`, `IS_HISTORICAL_IMPORT`, `OUTSTANDING_PRINCIPAL`, `BENCHMARK_DATE`, `BENCHMARK_CEILING`, `BENCHMARK_CREDIT_ADJUSTMENT`, `PIK_PROPORTION`, `PIK_ACCRUAL_DATE`, `PIK_COMPOUNDING_DATE`.
- `<memo_table>` = `LOAN_OPS.MEMO` — the distribution / funding notice a payment goes out on. `TYPE` ∈ {`LenderDistribution`, `Borrower`, `LenderFundingNotice`, `BorrowerFundingNotice`}, `STATUS` ∈ {`Draft`, `Confirmed`}, `DUE_DATE`, `AMOUNT`, `PRINCIPAL`, `INTEREST`, `FEES`, `OUTSTANDING`, the `*_REPAID` columns, `NOTES`, `APPROVED_AT`, `RELEASED_AT`, `CONFIRMED_AT`, `IS_PREPAYMENT`, `IS_CONFIRMED`, `MEMO_ID`, `LOAN_ID`, `ADVANCE_ID`.
- `LOAN_OPS.TRANCHE` — `TRANCHE_NAME`, `PRIORITY`, `COMMITTED_AMOUNT`, `OUTSTANDING_PRINCIPAL`, `LENDER_COUNT`, `START_DATE`, `END_DATE`, `IS_OPEN`, `TRANCHE_ID`, `ADVANCE_ID`, `STRUCTURE_ID`, `LOAN_ID`. **No rate and no amortization column** — both were checked here specifically.

**There is no such thing as a tranche rate.** The rate belongs to the *structure*, and `PAYMENT_OBLIGATION` carries `ADVANCE_ID` but **no `TRANCHE_ID`**, so an obligation cannot be attributed to a tranche even in principle. Tranches differ by `PRIORITY`, `COMMITTED_AMOUNT` and lenders — a unitranche's First Out and Last Out split the *claim*, not the coupon. Do not go looking for a per-tranche rate; the datashare is not hiding one.

**The tranche counts are accurate — trust them.** `STRUCTURE.TRANCHE_COUNT` and `LOAN.TRANCHE_COUNT` reconcile against actual `TRANCHE` rows. A unitranche structure carries 2 (First Out / Last Out), and a loan's count sums its structures. A count of 1 where you expect 2 is a *fixture* problem, not a warehouse one.

Amortization settings entered in the app are schedule-builder inputs only: they generate the payment obligations but are not stored, so no amortization start reaches the warehouse.
- `LOAN_OPS.PAYMENT_APPLICATION` — cash actually applied: `TYPE`, `AMOUNT`, `DUE_DATE`, `PERIOD_START_DATE`, `PERIOD_END_DATE`, **`APPLIED_AT`**, `PAYMENT_OBLIGATION_ID`, `MEMO_ID`, `MANUAL_BANK_TRANSACTION_ID`. Not read by the dashboard yet; the repaid balances on `ADVANCE` already carry inception-to-date.
- `LOAN_OPS.SIMULATION_PAYMENT_OBLIGATION` — `SIMULATION_NAME`, `DUE_DATE`, `TYPE`, `AMOUNT`, `AMOUNT_CURRENCY`, `IS_PIK`, `SIMULATION_ID`, `LOAN_ID`, `ADVANCE_ID`, `TRANCHE_ID`, `PARENT_OBLIGATION_ID`.

**These do not exist** — confirmed by name probe, do not look for them again: `FEE`, `COMMITMENT_PERIOD`, `INTEREST_RATE_PERIOD`, `BENCHMARK`, `COVENANT`, `AMENDMENT`, `TRANSFER`, `TRANCHE_RATE`, `DEFAULT_EVENT`, `LOAN_DOCUMENT`.

**The loan name links into Loan Operations.** The route is `/org/<company_slug>/loans/<loan_nano_id>/overview`, and it resolves a **nanoid** with no UUID fallback, so `LOAN_ID` will not substitute.

- The column is **`LOAN_NANO_ID`** on `LOAN_OPS.LOAN` — *not* `NANOID`. Grepping for `NANOID` finds nothing and reads as "still missing"; it is not. Values are 10 characters.
- The slug is `COMPANY.SLUG`, joined **per loan** on `LENDING_FIRM_ID`, never fetched once and applied to every row: a viewer can hold loans across more than one lending firm, and one global slug would point those rows at another firm's org. **`COMPANY` holds MANY rows per `LENDING_FIRM_ID`** — one per associated company, every borrower and lender entity included — so `IS_LENDING_FIRM = TRUE` is what keeps this join 1:1, and it belongs in the `ON` clause. Each firm has exactly one `IS_LENDING_FIRM` row. Without that restriction the join multiplies every loan by the firm's company count.
- `<company_table>` = `LOAN_OPS.COMPANY`, with `<slug>`=`SLUG`, `<is_lending_firm>`=`IS_LENDING_FIRM`, `<lending_firm_id>`=`LENDING_FIRM_ID` (present on both tables).

`lo_base_url` comes from the environment `welcome` reports, never hardcoded — production `https://loan-operations.app.carta.com`, sandbox `https://loan-operations.sandbox.carta.team`; any other environment omits it. The artifact re-validates it as a plain https origin before it reaches an `href` and drops every link if it does not match, so a bad value degrades to plain text rather than rendering a URL it cannot vouch for. Same for the segments: a row whose nanoid or slug is missing renders its name unlinked.

**A link is not an access grant.** RAP scopes which loans a viewer can read in the warehouse; loan-operations app access is a separate grant, so a viewer without it lands on a 403. The link is rendered anyway — the alternative is hiding a working link from everyone who does have access, and the failure is legible when it happens.

**Undrawn is per structure, and the rule depends on the structure type.** This mirrors how Loan Operations computes undrawn; a loan's undrawn is the **sum of its structures'**, never a loan-level subtraction:

1. If the structure has a `DRAW_PERIOD_END_DATE` and it has passed, undrawn is **0** — nothing is available regardless of the arithmetic.
2. `STRUCTURE_TYPE = 'Revolver'` → **committed − outstanding**. The commitment returns on repayment, like a credit card.
3. `TermLoan` and `DelayedDrawTermLoan` → **committed − drawn**. A DDTL's commitment reduces as draws occur and is not restored, so `DRAWN_AMOUNT` (cumulative disbursements) is the right subtrahend.

"Committed" here is the **floored** commitment the utilization rule below defines — `max(COMMITTED_AMOUNT, used)`, not the raw column. Both measures read it through one helper on purpose: an add-on that reads as fully drawn must not also report capacity remaining, and the raw column makes that subtraction negative.

A structure carries **`IS_ACTIVE`**; an inactive one offers no capacity whatever its arithmetic says, so it contributes 0. There is **no undrawn column** on `STRUCTURE` — this stays a derivation because the warehouse does not record the answer.

One known divergence from the engine: Loan Operations measures a revolver against outstanding **excluding compounded PIK**, and `STRUCTURE.OUTSTANDING_PRINCIPAL` includes it. On a revolver that has PIK'd this understates undrawn by the compounded amount, and there is no PIK-excluded outstanding column on `STRUCTURE` to correct it with.

Revolvers are rare in the current book, so the revolver branch and the PIK divergence above are rarely exercised — keep both. Term loans typically carry no draw period end.

**Negative undrawn is reachable, and the commitment floor is what prevents it.** A term-loan structure can draw past `COMMITTED_AMOUNT` when an add-on is booked as advances without raising the structure's commitment, which makes the raw subtraction negative. The floor resolves it to 0 — correctly, since a fully drawn structure has no capacity left. It is not a display clamp: the subtraction itself is taken against the floored commitment, so the figure the panel totals and the figure it prints are the same one.

**Utilization is used ÷ commitment, and the commitment is floored at the amount drawn.** Used follows the same per-type split as undrawn — a revolver's use is `OUTSTANDING_PRINCIPAL`, a term loan's is `DRAWN_AMOUNT` — summed from the structures, never read off the loan.

It deliberately does **not** inherit undrawn's draw-period and inactive zeroing: those say no capacity remains, which is a fact about availability, not about how much was drawn. Zeroing here would report a half-drawn term loan whose draw period lapsed as fully utilized.

The denominator is `max(COMMITTED_AMOUNT, used)` per structure, because **an add-on advance does not update the structure's commitment**. When the upsize is booked as advances, `COMMITTED_AMOUNT` stays at its original figure and the raw ratio renders over 100%. Correct **per structure before summing**, never at the loan level: a loan can pair an over-drawn structure with an under-drawn one, and a loan-level max lets the second absorb the first. The footer total applies the same correction, or it would disagree with the column above it.

**The warehouse cannot do better than that floor, so do not go looking.** Every advance carries `COMMITTED_AMOUNT` equal to its own `DISBURSED_AMOUNT`, so `SUM(ADVANCE.COMMITTED_AMOUNT)` just reproduces `STRUCTURE.DRAWN_AMOUNT` — undrawn add-on capacity is recorded nowhere in `LOAN_OPS`. A *partially* drawn add-on therefore still reads 100% when its true figure is lower; only a commitment-bearing column upstream could separate the two. With the floor in place no structure in the book computes over 100%, so the column needs no over-100 state.

**The effective rate is dated by the memo it was billed on.** `PAYMENT_OBLIGATION.MEMO_ID` joins to `MEMO`, and that memo's `DUE_DATE` is the business date the rate went out under — this is the literal "as of the last memo". Only `Confirmed` memos count; a `Draft` memo carries no dates at all. **Do not use `MEMO.CONFIRMED_AT`** — every row holds the same warehouse backfill timestamp, so it would date every rate in the book to a single day.

Most loans have a memo-linked interest rate. For a loan that has never been memo'd the artifact falls back to the period in force — `PERIOD_START_DATE <= CURRENT_DATE`, latest first, never `PERIOD_END_DATE` which would date the rate years into the future — and labels the row "as of period start" so the two bases are never confused.

**Most unpaid obligations are `IS_PROJECTED`** — the engine's forward schedule, not a bill anyone has been sent. The next-payment figure groups by `IS_PROJECTED` so a forecast is never totalled with a bill, prefers the billed row on a tie, and labels a projected one on screen. The payment-window tiles carry a matching billed-only sum for the same reason. `MEMO_ID` is populated on exactly the non-projected rows, so the two agree.

**There is no amortization-start column anywhere in `LOAN_OPS`** — not `LOAN`, `STRUCTURE`, `ADVANCE` or `TRANCHE`, and `COMMITMENT_PERIOD` / `AMENDMENT` do not exist. Do not derive it from the first `Principal` obligation: on a bullet loan that single row is the maturity repayment, so the derivation would label a non-amortizing loan as amortizing from its final payment date. The panel does not offer the field.

**Read recorded balances; do not re-derive them.** Inception-to-date principal, interest and
PIK are columns on `ADVANCE` (`PRINCIPAL_REPAID`, `INTEREST_REPAID`, `PIK_REPAID`,
`PIK_COMPOUNDED`) — sum those per loan rather than adding up paid obligations, which
re-derives the same figure and misses any repayment with no scheduled obligation row. Fees
have no repaid column, so they remain a `PAYMENT_OBLIGATION` sum filtered to `TYPE = 'Fee'`.

**The loan name opens a side panel.** The name is the control — a button styled as a link, per the house rule that entity names are the anchor and never a separate "Open" column — and it carries `aria-controls` and `aria-expanded`. Clicking anywhere else on the row opens the same panel.

The panel is **non-modal on purpose**: no scrim, no `aria-modal`, no focus trap and no scroll lock, so the table stays live and a reader can click one loan after another without closing first. Claiming any of those while the page still works would be worse than not claiming them. It overlays the table, and reserves width for itself only above 1700px, where the whole table still fits beside it — reserving below that pushes the money columns into the table's own horizontal scroll, so they are no more visible than when covered, while squeezing the KPI tiles until their labels wrap. Escape, the close button, and clicking the name again all dismiss it. Focus is never pulled into the panel, and is only moved back to the name if it was inside the panel when it closed.

**Scope is a picker, not tabs**, listing one structure per option. A loan can carry dozens, and a tab strip at that count either squeezes each label to an unreadable sliver or scrolls the control out of reach; a `<select>` holds its size at any count and keeps native type-ahead. It sits outside the scrolling body so it cannot scroll away, and hides when there is only one structure. **The loan roll-up is not offered as a scope** — the table row already carries the loan's headline figures — but it remains the fallback for a loan whose structures did not resolve, so the panel is never empty.

Every scope renders **a summary band over four sections**: outstanding, undrawn, effective rate and next payment lead at display size, then key terms, key dates (with composition folded to one line), payments, and the schedule of draws. One renderer serves both scopes — two had already drifted apart. The sections are flat, separated by a hairline: the panel is itself a bordered, shadowed surface, so boxing each group inside it was a container within a container that spent a quarter of the panel's height on chrome and gave `Day count` the same voice as the commitment. Figures right-align so their decimal points line up down the column.

Scoping works because `ADVANCE` carries `STRUCTURE_ID` and `PAYMENT_OBLIGATION` carries `ADVANCE_ID`: an obligation reaches its structure through its advance. The per-structure rows arrive in the **same** result sets as the loan ones, so this costs no extra queries — each set is fetched once for the whole currency and indexed twice. Opening a loan or switching scope issues nothing.

The loan roll-up sums recorded balances, takes the earliest next payment, and picks the rate the warehouse would have picked for the loan alone — memo-dated first, then latest. **A loan's structures can carry different rates**, which is why the rate is only ever shown per structure now.

Two things do not scope below the loan, and say so rather than reading as zero:
- **Fees** — nearly all `Fee` obligations have no `ADVANCE_ID`, so they cannot be attributed to a structure. Structure panels render "loan-level only", and the loan total is only reachable through the no-structures fallback.
- **Composition counts** in the roll-up come from `LOAN.TRANCHE_COUNT` / `LENDER_COUNT`, not from summing structures.

**The panel names its currency.** Every figure in it is a bare symbol, and `$` spans USD, CAD and AUD; the heading that names the currency is outside a surface people screenshot, so the panel carries its own label.

Hover follows Ink: a surface gets a hover state only when it is a button or link (`.ink-tile--clickable`). The clickable loan row, the loan name and the close button have one; the panel's read-only fact sections deliberately do not, or they would promise a click that does nothing.

Return measures are out of scope for this dashboard and are handled by a separate skill.

`obligation_table` powers the Scheduled Payments tile — unpaid obligations due in the next 10 / 30 / 60 / 90 days, summed per currency in one query so the picker re-queries nothing. Every window is a column in that one query, so adding one costs no extra round-trip. If the table does not resolve, the artifact drops that tile rather than failing.

**The currency picker offers only currencies with active loans.** The aggregate counts the whole portfolio, but the table lists active loans only, so a currency whose loans are all inactive offered a switch that emptied the table and changed nothing else. With one such currency left the picker hides entirely, and the dashboard opens on a currency that has rows rather than on the largest by loan count.

The loans table lists **active loans only** (`<active> = TRUE`); the KPI tiles still describe the whole portfolio, so the Active Loans tile names both counts.

The artifact pages the loan query itself — `limit`/`offset` are `dwh__execute__query` arguments, never SQL — at 500 rows a page, stopping on a short page, up to 40 pages (20,000 loans). Past that it says so on screen rather than showing a silent subset.

`columns` holds the names resolved in Step 3 (e.g. `"committed": "TOTAL_COMMITMENT"`) — the artifact
builds its SQL from them, so it needs no discovery of its own. It knows its own tool names
(`call_tool`, `welcome`), so only the connector name is passed.

### 6. Render the artifact (deterministic — via `render_artifact.py`)
The step-5 config is small; the artifact template is ~20 KB. To keep the template **out of your context and out of your output** (re-emitting it — or hand-writing the escape in a heredoc — is the dominant render cost and a frequent failure), a bundled script reads the template itself and performs the escape + substitution. **You write only the small config file and run the script — never load or emit the template, and never hand-author the escaping.**

**6a. Locate the workspace and the script** (one Bash block; `${CLAUDE_PLUGIN_ROOT}` is NOT substituted in Cowork, so probe both runtimes):
```bash
if [ -d "$HOME/mnt/outputs" ] && [ -w "$HOME/mnt/outputs" ]; then WORKDIR="$HOME/mnt/outputs/carta-loan-dashboard"
elif command -v carta >/dev/null 2>&1; then WORKDIR="$(carta workspace cache carta-loan-dashboard | jq -r .)"
else WORKDIR="${TMPDIR:-/tmp}/carta-loan-dashboard"; fi
mkdir -p "$WORKDIR"
if [ -n "${CLAUDE_PLUGIN_ROOT:-}" ] && [ -d "$CLAUDE_PLUGIN_ROOT/skills/carta-loan-dashboard" ]; then
  SKILL_DIR="$CLAUDE_PLUGIN_ROOT/skills/carta-loan-dashboard"
else
  SKILL_DIR="$(find "$HOME/mnt/.remote-plugins" -maxdepth 3 -type d -name carta-loan-dashboard 2>/dev/null | head -1)"
fi
```
If `uv`/Bash is unavailable or `$SKILL_DIR/../../scripts/render_artifact.py` does not resolve (a hosted surface that blocks subprocess), use the **inline fallback (6e)**.

**6b. Write the config.** `Write` the step-5 config as compact JSON to `$WORKDIR/loan-data.json`. (You are writing a small config file — never the template.)

**6c. Render.**
```bash
uv run "$SKILL_DIR/../../scripts/render_artifact.py" --workdir "$WORKDIR" --template "$SKILL_DIR/references/artifact_template.html" --out loan-dashboard.html
```
The shared renderer reads the template you point it at, applies the XSS-safe `\uXXXX` escaping, substitutes the single placeholder, writes the finished HTML, and prints its absolute path to stdout. Branch on the exit code — do not re-derive the result:

| RC | meaning | next move |
|----|---------|-----------|
| 0 | HTML written; path on stdout | continue to 6d |
| 1 | config file missing / bad JSON | re-check 6b, retry once |
| 4 | bundled template not found | use the inline fallback (6e) |
| 14 | template token count is not exactly 1 (drift) | stop; tell the user the bundled template has drifted out of sync and needs a fix from the skill's maintainer; offer to escalate or file a feature request rather than retrying |

If the RC=1 retry also fails, stop — tell the user the config write to `$WORKDIR/loan-data.json` isn't succeeding, and offer to escalate or file a feature request rather than retrying further.

**6d. Publish the artifact.** `Artifact({action: "list", scope: "mine"})`; if a **Loan Portfolio Dashboard** artifact is already published, keep its `url` and tell the user you're refreshing the existing dashboard in place (not creating a new one) before you publish over it. That is the title the template's own `<title>` sets, and the tag always wins over the `title` parameter — so the list shows that name, and looking for anything else silently matches nothing and publishes a duplicate every run. Then publish the path the script printed — one call either way, `url` being the only difference:

```
Artifact({
  file_path: "<path printed by the script>",
  url: "<url from the list — omit entirely on a first publish>",
  title: "Loan Portfolio Dashboard",
  description: "Loan portfolio dashboard — KPIs + every loan, fetched live from Carta.",
  icon: "bank",
  label: "Refreshed for <firm_name>",
  capabilities: {
    mcp: { servers: [{ server: "<CARTA_MCP_SERVER>", tools: ["call_tool", "welcome", "set_context"] }] }
  }
})
```

All three tools **must** be in the grant, or the page loads and every fetch rejects with `not_in_manifest`. Keep `title` and `icon` stable across redeploys, and restate the whole `capabilities` object every time — a non-empty object replaces the stored grant. Give the user the URL, say the dashboard pulls fresh numbers each time they open it, briefly. Do nothing else after.

**6e. Inline fallback** (only when 6a's probe finds no script or the runtime blocks subprocess): load the template with `read_skill(file_path="references/artifact_template.html")`, escape the compact config JSON exactly as the template's header comment documents (the `\uXXXX` form for `&` `<` `>` `'` — **not** HTML entities; a raw `</script>` in the firm name would otherwise inject HTML = stored XSS), replace the single `__LOAN_DATA__` placeholder, then publish as in 6d.
