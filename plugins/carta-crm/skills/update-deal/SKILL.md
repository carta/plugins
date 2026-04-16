---
name: update-deal
description: >
  Updates an existing deal record in the Carta CRM.
  Use this skill when the user says things like "update a deal", "move deal to [stage]",
  "change deal stage", "edit deal", "update deal fields", "add a tag to deal",
  "assign deal lead", "update company info on deal", "link contacts to deal",
  or "/update-deal".
  Accepts a deal ID or company name (will search if no ID provided).
  Only the fields explicitly provided are changed — all other fields are left untouched.
allowed-tools:
  - Bash(curl *)
  - AskUserQuestion
---

## Overview

Partially update an existing deal using `PATCH /v1/deals/{id}`.
Only fields provided in the request body are modified — this is a partial update,
not a replacement. First resolve the deal ID, then collect what to change,
then make the API call.

## Step 1 — Resolve the deal ID

If the user provided a deal ID directly, use it and skip to Step 3.

If only a company name or description was given, search for the deal first:

```bash
curl -s "https://api.listalpha.com/v1/deals?search=<company name>&limit=10" \
  -H "Authorization: ${LISTALPHA_API_KEY}"
```

If multiple deals match, present the list to the user and ask them to confirm which one to update (show company name, stage, and ID for each).

## Step 2 — Fetch pipeline context (if moving stages)

If the user wants to move the deal to a different stage or pipeline, fetch pipelines to resolve names to IDs:

```bash
curl -s "https://api.listalpha.com/v1/deals/pipelines" \
  -H "Authorization: ${LISTALPHA_API_KEY}"
```

Present the available pipelines and stages by name. Skip this step if the user already provided a `stageId` directly.

## Step 3 — Collect what to update

Ask the user what they want to change. Any combination of the following fields can be updated:

| Field | Type | Description |
|-------|------|-------------|
| `stageId` | string | Move deal to a different stage |
| `company.name` | string | Update the associated company name |
| `company.url` | string | Update company URL — triggers auto-enrichment |
| `comment` | string | Replace the deal comment/notes |
| `tags` | array | Replace the full tags array |
| `dealLead` | string | User ID to assign as deal lead |
| `addedAt` | date-time | ISO 8601 date the deal was added |
| `fields` | object | Custom field values keyed by field ID |
| `people.advisers` | array | Contact IDs linked as advisers |
| `people.introducer` | array | Contact IDs linked as introducers |
| `people.management` | array | Contact IDs linked as management |

If the user has already specified what to change in their message, extract it directly without re-asking.

**Important:** Only include fields that are explicitly being changed. Omit everything else.

## Step 4 — Fetch custom fields (if updating custom fields)

If the user wants to update custom fields but didn't specify field keys, fetch the schema first:

```bash
curl -s "https://api.listalpha.com/v1/deals/custom-fields" \
  -H "Authorization: ${LISTALPHA_API_KEY}"
```

Use the returned field keys and labels to map the user's input to the correct `fields` object.

## Step 5 — Update the deal via API

Build the request body with only the fields being changed:

```json
{
  "stageId": "<stage id>",
  "company": {
    "name": "<company name>",
    "url": "<company url>"
  },
  "comment": "<updated comment>",
  "tags": ["<tag1>", "<tag2>"],
  "dealLead": "<user id>",
  "addedAt": "<ISO 8601 date>",
  "fields": {
    "<field_key>": "<value>"
  },
  "people": {
    "advisers": ["<contact id>"],
    "introducer": ["<contact id>"],
    "management": ["<contact id>"]
  }
}
```

Omit any top-level key that is not being updated. Omit `company` if neither name nor URL is changing. Omit `people` if no contact links are changing.

Make the API call:

```bash
curl -s -X PATCH "https://api.listalpha.com/v1/deals/<id>" \
  -H "Authorization: ${LISTALPHA_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '<json_body>'
```

## Step 6 — Report result

On success (HTTP 200), respond with a summary of what changed:
> "Deal for **{company name}** updated (ID: `{id}`). {Changed: stage → Diligence, tags updated, etc.}"

On error:
- **401** — API key is invalid or missing
- **400** — Check that field keys, stage IDs, and contact IDs are valid
- **404** — No deal found with that ID — suggest running `/search-deals` first
- **500** — Server error; try again or contact support

## Updating multiple deals

If the user wants to apply the same change to multiple deals, repeat Steps 1 and 5–6 for each. Summarize at the end:
> "Updated N deals: [list of company names]"

## Reference

See `references/api-reference.md` for full endpoint details.
