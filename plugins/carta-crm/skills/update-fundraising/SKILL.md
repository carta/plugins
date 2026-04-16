---
name: update-fundraising
description: >
  Updates an existing fundraising record in the Carta CRM.
  Use this skill when the user says things like "update a fundraising", "edit fundraising",
  "update fundraising details", "change fundraising amount", "update fundraising stage",
  "update fundraising fields", or "/update-fundraising".
  Accepts a fundraising ID or company name (will search if no ID provided).
  Only the fields explicitly provided are changed — all other fields are left untouched.
allowed-tools:
  - Bash(curl *)
  - AskUserQuestion
---

## Overview

Partially update an existing fundraising using `PATCH /v1/fundraisings/{id}`.
Only fields provided in the request body are modified — this is a partial update,
not a replacement. First resolve the fundraising ID, then collect what to change,
then make the API call.

## Step 1 — Resolve the fundraising ID

If the user provided a fundraising ID directly, use it and skip to Step 3.

If only a company name or keyword was given, search for the fundraising first:

```bash
curl -s "https://api.listalpha.com/v1/fundraisings?search=<name>&limit=10" \
  -H "Authorization: ${LISTALPHA_API_KEY}"
```

If multiple fundraisings match, present the list to the user and ask them to confirm which one to update (show name, key fields, and ID for each).

## Step 2 — Fetch custom fields (if needed)

If the user wants to update custom fields but didn't specify field keys, fetch the schema first:

```bash
curl -s "https://api.listalpha.com/v1/fundraisings/custom-fields" \
  -H "Authorization: ${LISTALPHA_API_KEY}"
```

Use the returned field keys and labels to map the user's input to the correct `fields` object.

## Step 3 — Collect what to update

Ask the user what they want to change. The fundraising record supports:

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Fundraising round name or title |
| `fields` | object | Custom field values keyed by field name |

If the user has already specified what to change in their message, extract it directly without re-asking.

**Important:** Only include fields that are explicitly being changed. Omit everything else.

## Step 4 — Update the fundraising via API

Build the request body with only the fields being changed:

```json
{
  "name": "<updated name>",
  "fields": {
    "<field_key>": "<value>"
  }
}
```

Make the API call:

```bash
curl -s -X PATCH "https://api.listalpha.com/v1/fundraisings/<id>" \
  -H "Authorization: ${LISTALPHA_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '<json_body>'
```

## Step 5 — Report result

On success (HTTP 200), respond with a summary of what changed:
> "Fundraising **{name}** updated (ID: `{id}`). {Changed: amount updated, stage changed, etc.}"

On error:
- **401** — API key is invalid or missing
- **400** — Check that field keys are valid
- **404** — No fundraising found with that ID — suggest running `/search-fundraisings` first
- **500** — Server error; try again or contact support

## Updating multiple fundraisings

If the user wants to apply the same change to multiple fundraisings, repeat Steps 1 and 4–5 for each. Summarize at the end:
> "Updated N fundraisings: [list of names]"

## Reference

See `references/api-reference.md` for full endpoint details.
