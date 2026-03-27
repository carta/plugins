---
name: stakeholders
description: List stakeholders for a company. Use when asked who the stakeholders are, stakeholder list, shareholders, investors, or holders.
---

# Stakeholders

List stakeholders (shareholders, investors, employees) for a company.

## Prerequisites

You need the `corporation_id`. Get it from `list_accounts` if you don't have it.

## Which Command to Use

- **"Who are the stakeholders?"** → `cap_table:get:stakeholders` (names, emails, roles — no ownership data)
- **"What does everyone own?"** → `cap_table:get:cap_table_by_stakeholder` (holdings, ownership %, FD shares)

Default to `cap_table:get:stakeholders` unless the user asks about ownership, shares, or percentages.

## Data Retrieval

```
fetch("cap_table:get:stakeholders", { corporation_id })
```

Supports `search` param to filter by name or email.

## Key Fields

- `full_name`: stakeholder display name
- `email`: contact email
- `event_relationship`: role (e.g. founder, employee, investor)
- `kind`: stakeholder type

## Step 1 — Fetch Stakeholders

```
fetch("cap_table:get:stakeholders", { corporation_id })
```

## Step 2 — Present Results

| Name | Email | Role | Type |
|------|-------|------|------|
| ... | ... | ... | ... |

If the user then asks about ownership, follow up with:

```
fetch("cap_table:get:cap_table_by_stakeholder", { corporation_id })
```
