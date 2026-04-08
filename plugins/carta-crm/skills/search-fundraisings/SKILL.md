---
name: search-fundraisings
description: >
  Searches for and retrieves fundraising records from the Carta CRM.
  Use this skill when the user says things like "find a fundraising", "search fundraisings",
  "look up a fundraising round", "show fundraising details for [company]", "get fundraising by ID",
  "list fundraisings", "what fundraisings do we have", or "/search-fundraisings".
  Returns fundraising details including ID, name, amount, stage, and associated company.
  The fundraising ID returned can be used with the update-fundraising skill.
allowed-tools:
  - Bash
---

## Overview

Search for fundraisings in the Carta CRM using `GET /v1/fundraisings` (filtered list) or
`GET /v1/fundraisings/{id}` (single record by ID). Return results in a readable summary
and always include the fundraising ID so the user can reference it for updates.

## Step 1 — Determine search mode

Based on the user's request, choose one of two modes:

- **By ID** — user provided a fundraising ID (a hex string like `64f1a2b3c4d5e6f7a8b9c0d1`) → use `GET /v1/fundraisings/{id}`
- **By search / filter** — user provided a company name, round type, or keyword → use `GET /v1/fundraisings` with query params

If it's unclear, default to **By search / filter** and ask the user for a search term.

## Step 2 — Execute the search

**By ID:**
```bash
curl -s "https://api.listalpha.com/v1/fundraisings/<id>" \
  -H "Authorization: ${LISTALPHA_API_KEY}"
```

**By search / filter:**

```bash
curl -s "https://api.listalpha.com/v1/fundraisings?search=<term>&limit=20" \
  -H "Authorization: ${LISTALPHA_API_KEY}"
```

Available query parameters:

| Param | Type | Description |
|-------|------|-------------|
| `search` | string | Company name or keyword |
| `limit` | integer | Max results (default to 20 unless user specifies) |
| `offset` | integer | Skip N results for pagination |

Omit any params the user did not specify.

## Step 3 — Present results

For each fundraising returned, display all non-empty fields in a readable summary, including the ID prominently. The exact field shape depends on the tenant's custom field configuration — display whatever the API returns.

If no fundraisings are found:
> "No fundraisings found matching your search. Try a different company name or keyword."

If multiple results are returned, list them all and note the total count.

Always surface the fundraising ID prominently — the user will need it to run `/update-fundraising`.

## Error handling

- **401** — API key is invalid or missing
- **404** — No fundraising found with that ID
- **400 / 500** — Show the error message from the response

## Reference

See `references/api-reference.md` for full endpoint details.
