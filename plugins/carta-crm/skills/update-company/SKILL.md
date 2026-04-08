---
name: update-company
description: >
  Updates an existing company record in the Carta CRM.
  Use this skill when the user says things like "update a company", "edit company",
  "update company details", "change company name", "update company website",
  "update company fields", "add a tag to company", or "/update-company".
  Accepts a company ID or name (will search if no ID provided).
  Only the fields explicitly provided are changed — all other fields are left untouched.
allowed-tools:
  - Bash
---

## Overview

Partially update an existing company using `PATCH /v1/companies/{id}`.
Only fields provided in the request body are modified — this is a partial update,
not a replacement. First resolve the company ID, then collect what to change,
then make the API call.

## Step 1 — Resolve the company ID

If the user provided a company ID directly, use it and skip to Step 3.

If only a name or description was given, search for the company first:

```bash
curl -s "https://api.listalpha.com/v1/companies?search=<name>&limit=10" \
  -H "Authorization: ${LISTALPHA_API_KEY}"
```

If multiple companies match, present the list to the user and ask them to confirm which one to update (show name and ID for each).

## Step 2 — Collect what to update

Ask the user what they want to change. Any combination of the following fields can be updated:

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Company name |
| `fields` | object | Custom field values — keyed by field name (e.g. `website`, `location`, `industry`, `about`, `tags`) |

If the user has already specified what to change in their message, extract it directly without re-asking.

**Important:** Only include fields that are explicitly being changed. Omit everything else.

## Step 3 — Fetch custom fields (if updating custom fields)

If the user wants to update custom fields but didn't specify field keys, fetch the schema first:

```bash
curl -s "https://api.listalpha.com/v1/companies/custom-fields" \
  -H "Authorization: ${LISTALPHA_API_KEY}"
```

Use the returned field keys and labels to map the user's input to the correct `fields` object.

## Step 4 — Update the company via API

Build the request body with only the fields being changed:

```json
{
  "name": "<updated name>",
  "fields": {
    "website": "<url>",
    "location": "<location>",
    "industry": "<industry>",
    "about": "<description>",
    "tags": ["<tag1>", "<tag2>"]
  }
}
```

Omit `name` if it is not being changed. Omit `fields` entirely if no custom fields are being changed. Only include the specific keys within `fields` that are being updated.

Make the API call:

```bash
curl -s -X PATCH "https://api.listalpha.com/v1/companies/<id>" \
  -H "Authorization: ${LISTALPHA_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '<json_body>'
```

## Step 5 — Report result

On success (HTTP 200), respond with a summary of what changed:
> "Company **{name}** updated (ID: `{id}`). {Changed: website updated, tags added, etc.}"

On error:
- **401** — API key is invalid or missing
- **400** — Check that field keys are valid
- **404** — No company found with that ID — suggest running `/search-companies` first
- **500** — Server error; try again or contact support

## Updating multiple companies

If the user wants to apply the same change to multiple companies, repeat Steps 1 and 4–5 for each. Summarize at the end:
> "Updated N companies: [list of names]"

## Reference

See `references/api-reference.md` for full endpoint details.
