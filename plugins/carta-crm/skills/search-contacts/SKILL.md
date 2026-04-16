---
name: search-contacts
description: >
  Searches for and retrieves contact (people) records from the Carta CRM.
  Use this skill when the user says things like "find a contact", "search contacts",
  "look up a person", "show me contact details for [name]", "get contact by ID",
  "list contacts", "find people at [company]", "search people", or "/search-contacts".
  Returns contact details including ID, name, email, title, company, and tags.
  The contact ID returned can be used with the update-contact skill.
allowed-tools:
  - Bash(curl *)
  - AskUserQuestion
---

## Overview

Search for contacts in the Carta CRM using `GET /v1/contacts` (filtered list) or
`GET /v1/contacts/{id}` (single contact by ID). Return results in a readable summary
and always include the contact ID so the user can reference it for updates.

## Step 1 — Determine search mode

Based on the user's request, choose one of two modes:

- **By ID** — user provided a contact ID (a hex string like `64f1a2b3c4d5e6f7a8b9c0d1`) → use `GET /v1/contacts/{id}`
- **By search / filter** — user provided a name, email, or keyword → use `GET /v1/contacts` with query params

If it's unclear, default to **By search / filter** and ask the user for a search term.

## Step 2 — Execute the search

**By ID:**
```bash
curl -s "https://api.listalpha.com/v1/contacts/<id>" \
  -H "Authorization: ${LISTALPHA_API_KEY}"
```

**By search / filter:**

```bash
curl -s "https://api.listalpha.com/v1/contacts?search=<term>&limit=20" \
  -H "Authorization: ${LISTALPHA_API_KEY}"
```

Available query parameters:

| Param | Type | Description |
|-------|------|-------------|
| `search` | string | Contact name, email, or keyword |
| `listId` | string | Filter by list ID |
| `limit` | integer | Max results (default to 20 unless user specifies) |
| `offset` | integer | Skip N results for pagination |

Omit any params the user did not specify.

## Step 3 — Present results

For each contact returned, display:

```
Contact: <name> (ID: `<id>`)
  Title: <title> at <company>
  Email: <emailDetail>
  Phone: <phone>
  LinkedIn: <linkedIn>
  Tags: <tags>
  Notes: <notes>
```

Omit any fields that are blank or not present.

If no contacts are found:
> "No contacts found matching your search. Try a different name, email, or keyword."

If multiple results are returned, list them all and note the total count.

Always surface the contact ID prominently — the user will need it to run `/update-contact`.

## Error handling

- **401** — API key is invalid or missing
- **404** — No contact found with that ID
- **400 / 500** — Show the error message from the response

## Reference

See `references/api-reference.md` for full endpoint details.
