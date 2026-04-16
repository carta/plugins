---
name: search-investors
description: >
  Searches for and retrieves investor records from the Carta CRM.
  Use this skill when the user says things like "find an investor", "search investors",
  "look up an investor", "show me investor details for [name]", "get investor by ID",
  "list investors", "what investors do we have", or "/search-investors".
  Returns investor details including ID, name, and custom fields.
  The investor ID returned can be used with the update-investor skill.
allowed-tools:
  - Bash(curl *)
  - AskUserQuestion
---

## Overview

Search for investors in the Carta CRM using `GET /v1/investors` (filtered list) or
`GET /v1/investors/{id}` (single investor by ID). Return results in a readable summary
and always include the investor ID so the user can reference it for updates.

## Step 1 — Determine search mode

Based on the user's request, choose one of two modes:

- **By ID** — user provided an investor ID (a hex string like `64f1a2b3c4d5e6f7a8b9c0d1`) → use `GET /v1/investors/{id}`
- **By search / filter** — user provided a name or keyword → use `GET /v1/investors` with query params

If it's unclear, default to **By search / filter** and ask the user for a search term.

## Step 2 — Execute the search

**By ID:**
```bash
curl -s "https://api.listalpha.com/v1/investors/<id>" \
  -H "Authorization: ${LISTALPHA_API_KEY}"
```

**By search / filter:**

Build a query string from the available parameters and call:

```bash
curl -s "https://api.listalpha.com/v1/investors?search=<term>&limit=20" \
  -H "Authorization: ${LISTALPHA_API_KEY}"
```

Available query parameters:

| Param | Type | Description |
|-------|------|-------------|
| `search` | string | Investor name or keyword |
| `limit` | integer | Max results (default to 20 unless user specifies) |
| `offset` | integer | Skip N results for pagination |

Omit any params the user did not specify.

## Step 3 — Present results

For each investor returned, display:

```
Investor: <name> (ID: `<id>`)
  Website: <website>
  Location: <location>
  Industry: <industry>
  About: <about>
  Tags: <tags>
  Added: <createdAt>
```

Omit any fields that are blank or not present.

If no investors are found:
> "No investors found matching your search. Try a different name or keyword."

If multiple results are returned, list them all and note the total count.

Always surface the investor ID prominently — the user will need it to run `/update-investor`.

## Error handling

- **401** — API key is invalid or missing
- **404** — No investor found with that ID
- **400 / 500** — Show the error message from the response

## Reference

See `references/api-reference.md` for full endpoint details.
