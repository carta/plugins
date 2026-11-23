---
name: carta-stock-comp-expense
description: >-
  Give a company's ASC 718 stock comp (SBC) expense for a period from the expense reports
  Carta already ran. Use for SBC expense, "book Q3 SBC", expense through a date or its journal
  entry. Never estimates expense from grants.
when_to_use: >-
  Use when asked for stock-based compensation or stock comp expense, ASC 718 or SBC expense,
  the latest expense report, expense through a date ("through 9/30", "for Q3"), what to book
  for SBC this quarter, the journal entry or debit/credit for stock comp, expense by department
  or cost center, or to calculate SBC expense from grant data. Not for a grant's vesting
  schedule (carta-grant-vesting) or 409A and FMV (carta-valuation-history).
allowed-tools:
  - mcp__carta__call_tool
  - mcp__carta__read_tool
  - mcp__carta__list_contexts
  - mcp__carta__set_context
  - mcp__carta__list_accounts
  - mcp__claude_ai_Carta__call_tool
  - mcp__claude_ai_Carta__read_tool
  - mcp__claude_ai_Carta__list_contexts
  - mcp__claude_ai_Carta__set_context
  - mcp__claude_ai_Carta__list_accounts
  - mcp__2827383e-1775-4df3-b6ff-04d5392f6d18__call_tool
  - mcp__2827383e-1775-4df3-b6ff-04d5392f6d18__read_tool
  - mcp__2827383e-1775-4df3-b6ff-04d5392f6d18__list_contexts
  - mcp__2827383e-1775-4df3-b6ff-04d5392f6d18__set_context
  - mcp__2827383e-1775-4df3-b6ff-04d5392f6d18__list_accounts
  - AskUserQuestion
  - Read
---

<!-- carta:plugin-version -->
<carta-plugin>carta-cap-table:6.119.1</carta-plugin>

<!-- Part of the official Carta AI Agent Plugin -->

# Stock Comp Expense

Give the ASC 718 stock-based compensation expense from the reports the company already ran in
Carta's Financial Reporting.

**Never estimate ASC 718 expense yourself.** Not from grants, vesting schedules, fair values or
any other data, and not as a "rough" or "approximate" figure. The expense depends on fair value
assumptions, forfeiture rates, attribution and modifications that only the report applies, and a
figure you work out will not match the company's books or its auditor. If no report covers the
period, say so and point to running one.

## When to Use

- "What's our stock comp expense for Q3?" / "SBC expense through 9/30"
- "Get the latest SBC expense report"
- "Book Q3 stock-based compensation expense"
- "What's the journal entry for stock comp this quarter?"
- "Calculate this month's ASC 718 expense from our grants"

## Prerequisites

Do not call `list_accounts` or ask which company before the first read: Carta finds the company. Reuse the company already resolved in this conversation unless this prompt names or numbers another. Else send the numeric id the user gave, else the company name as the user said it, else no `company` (Carta uses the user's only company). On an error, and for later calls, follow `${CLAUDE_PLUGIN_ROOT}/references/find-the-company.md` (the plugin's own `references/`, not this skill's; read it by that path, do not search for it). Its reads are cap table reads: reuse `meta.company.id` on later calls.

## Data Retrieval

```
read_tool({"name": "cap_table__list__expense_reports", "arguments": {"company": company}})
```

One row per report, from every Financial Reporting scenario, latest period first:

```json
{
  "results": [
    {
      "id": 42,
      "name": "Q3 2026",
      "scenario_id": 7,
      "scenario_name": "Default",
      "period_start": "2026-07-01",
      "period_end": "2026-09-30",
      "status": "ready",
      "expense_recognized": {"amount": "12500.00", "currency": "USD"},
      "is_final": true
    }
  ],
  "next": null,
  "meta": {"web_url": "<the Financial Reporting page in Carta>"}
}
```

## Workflow

### Step 1 — Read the reports

Call `cap_table__list__expense_reports` first, for every question this skill covers, before any
other read. Do not read grants, RSUs, vesting or valuations (`cap_table__list__grants`,
`cap_table__list__rsus`, `cap_table__get__grant_vesting`, `cap_table__get__rsu_vesting`,
`cap_table__get__valuations`) to answer an expense question.

When the period asked isn't on the page and the response has a `next`, send it as `after` and
read the next page before saying no report covers it.

### Step 2 — Pick the period

- A quarter, month or year ("Q3", "September", "2026"): use the row whose `period_start` and
  `period_end` are its bounds (Q3 2026 is Jul 1 – Sep 30, 2026, unless the row Carta named for
  that period, such as "Q3 2026" or "FY2026" for a company with another fiscal year, has other
  bounds). A
  row that ends on the same date but starts on another (a monthly or year-to-date report) is
  not that period: list such rows with their own periods and follow *No row for the period
  asked*. Never pro-rate a report.
- Only an end date ("through 9/30"): show every row ending on that date with its own period,
  and ask which one the user means. With one such row, use it and name its period.
- Always name the report's own period (`period_start` – `period_end`) with its expense.
- No period named: the latest row whose `status` is `ready`.
- Several scenarios with a row for that period: prefer the one marked final (`is_final`), and
  name the scenario. If none is final, show each scenario's row and ask which one the user books.

### Step 3 — Answer

Give `expense_recognized` with its own `currency`, the period, the scenario and whether the
report is final. Then link `meta.web_url`, where the full report and its Expense Details file
(per-award lines, cost center split) are.

## What the read does not hold

The read gives the total expense for each period. It has no lines per award, no split by
department or cost center and no journal entry. For those, say they are in the report's Expense
Details file in Carta and give `meta.web_url`. Never build them yourself from grant data.

## Gates

**Required inputs**: none before the first read. The company comes from Prerequisites.

**AI computation**: No — this skill presents Carta's calculated expense, never its own.

## Presentation

**BLUF lead**: the period's expense with its currency, e.g. "Stock comp expense for Jul 1 – Sep
30, 2026 is USD 12,500.00 (Default scenario, final)."

**Date format**: MMM d, yyyy (e.g. "Sep 30, 2026").

**Currency**: format each amount with its own `currency`. Never hardcode `$` and never default
to USD. Never add amounts in different currencies.

For several periods, a table, latest first:

| Period | Scenario | Expense | Status | Final |
|---|---|---|---|---|
| Jul 1 – Sep 30, 2026 | Default | USD 12,500.00 | Ready | Yes |

## Error Handling

| Situation | What to do |
|---|---|
| `workflow_unavailable` | The company doesn't have Financial Reporting. Say Carta's Financial Reporting calculates ASC 718 expense from the cap table, and give the link in the error's `fix`. Do not estimate the expense instead, and do not retry. |
| No row for the quarter, month or year asked, or only rows for a different period (a month, year to date) | Say no report covers exactly that period. List the reports nearest to it with their own periods and expense, never relabelled as the period asked, and give `meta.web_url` to run a report for that period in Carta. |
| Only an end date asked and no row ends on it | Say no report ends on that date, list the nearest reports with their own periods, and give `meta.web_url` to run one in Carta. |
| `status` is `running` | Say the report is still calculating and give `meta.web_url`. Do not quote a number. |
| `status` is `failed` | Say the report failed, and give `meta.web_url` to review it. |
| 403 or access denied | Say the user's role can't see Financial Reporting for this company. Do not retry. |
| Company error | Follow *Company errors* in `${CLAUDE_PLUGIN_ROOT}/references/find-the-company.md`. |

## Caveats

- This skill reads reports; it cannot run or recalculate one. Running a report happens in Carta.
- A report that isn't final can still change if it is recalculated. Say so when you quote it.
