---
name: carta-stakeholders
description: List stakeholders for a company. Use when asked who the stakeholders are, stakeholder list, shareholders, investors, or holders.
allowed-tools:
  - mcp__carta__fetch
  - mcp__carta__list_contexts
  - mcp__carta__set_context
  - mcp__carta__list_accounts
  - AskUserQuestion
---

<!-- Part of the official Carta AI Agent Plugin -->

# Stakeholders

List stakeholders (shareholders, investors, employees) for a company.

## When to Use

- "Who are the stakeholders?"
- "Show me the shareholder list"
- "List all investors in this company"
- "Who holds equity?"
- "What does everyone own?"
- "Show employee option holders"

## Prerequisites

You need the `corporation_id`. Get it from `list_accounts` if you don't have it.

## Data Retrieval

- **"Who are the stakeholders?"** → `cap_table:get:stakeholders` (names, emails, roles — no ownership data)
- **"What does everyone own?"** → `cap_table:get:cap_table_by_stakeholder` (holdings, ownership %, FD shares)

Default to `cap_table:get:stakeholders` unless the user asks about ownership, shares, or percentages.

```
fetch("cap_table:get:stakeholders", { "corporation_id": corporation_id })
```

Supports `search` param to filter by name or email.

> **Detail mode**: This command supports `detail=summary` (aggregate counts and breakdowns, fast even for thousands of stakeholders) and `detail=full` (individual records with names, emails, roles). Choose the right mode upfront based on user intent — see Workflow. For ownership data, `cap_table:get:cap_table_by_stakeholder` is the right command.

## Key Fields

- `full_name`: stakeholder display name
- `email`: contact email
- `event_relationship`: role (e.g. founder, employee, investor)
- `kind`: stakeholder type

## Workflow

### Step 1 — Fetch Stakeholders

Choose detail mode based on the user's intent — do NOT default to summary then re-fetch:

- **Aggregate questions** ("how many stakeholders?", "stakeholder breakdown by role"): omit `detail` — summary mode returns counts and breakdowns instantly, even for thousands of stakeholders.

  ```
  fetch("cap_table:get:stakeholders", { "corporation_id": corporation_id })
  ```

- **Individual records** ("show me stakeholders", "list shareholders", "who holds equity?", any request for names/emails): use `detail=full` directly — skip summary, the user wants records.

  ```
  fetch("cap_table:get:stakeholders", { "corporation_id": corporation_id, "detail": "full", "page_size": "25" })
  ```

When in doubt, prefer `detail=full` — most stakeholder queries want to see names.

### Step 2 — Present Results

| Name | Email | Role | Type |
|------|-------|------|------|
| ... | ... | ... | ... |

If the user then asks about ownership, follow up with:

```
fetch("cap_table:get:cap_table_by_stakeholder", { "corporation_id": corporation_id, "detail": "full" })
```

### Point-in-time ownership

`cap_table:get:cap_table_by_stakeholder` accepts an optional `as_of_date` (ISO `YYYY-MM-DD` or `MM/DD/YYYY`) to return holdings as of that date:

```
fetch("cap_table:get:cap_table_by_stakeholder", { "corporation_id": corporation_id, "detail": "full", "as_of_date": "2026-03-31" })
```

Use this whenever the user's question is anchored to a specific date ("ownership at Q1 close", "who held shares on 3/31"). `cap_table:get:stakeholders` (the contact-info command) does **not** support `as_of_date` — it only reflects current roster.

## Gates

**Required inputs**: `corporation_id`.
If missing, call `AskUserQuestion` before proceeding (see carta-interaction-reference §4.1).

**AI computation**: No — this skill presents Carta data directly.

## Presentation

**Format**: Table

**BLUF lead**: Lead with the total count of stakeholders before showing the table.

**Sort order**: By `full_name` ascending (alphabetical).

If the user asks about ownership after seeing the stakeholder list, switch to `cap_table:get:cap_table_by_stakeholder` and present holdings data.

## Caveats

- The stakeholders endpoint returns contact/role information only — no ownership or share counts. Use `cap_table:get:cap_table_by_stakeholder` for ownership data.
- The `search` param filters server-side; prefer it over client-side filtering for large stakeholder lists.
- A stakeholder may appear with multiple `event_relationship` values if they hold different security types.
