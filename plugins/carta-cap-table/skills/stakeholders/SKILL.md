---
name: stakeholders
description: List stakeholders for a company. Use when asked who the stakeholders are, stakeholder list, shareholders, investors, or holders.
---

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
fetch("cap_table:get:stakeholders", { corporation_id })
```

Supports `search` param to filter by name or email.

## Key Fields

- `full_name`: stakeholder display name
- `email`: contact email
- `event_relationship`: role (e.g. founder, employee, investor)
- `kind`: stakeholder type

## Workflow

### Step 1 — Fetch Stakeholders

```
fetch("cap_table:get:stakeholders", { corporation_id })
```

### Step 2 — Present Results

| Name | Email | Role | Type |
|------|-------|------|------|
| ... | ... | ... | ... |

If the user then asks about ownership, follow up with:

```
fetch("cap_table:get:cap_table_by_stakeholder", { corporation_id })
```

## Gates

**Required inputs**: `corporation_id`.
If missing, call `AskUserQuestion` before proceeding (see interaction-reference §4.1).

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
